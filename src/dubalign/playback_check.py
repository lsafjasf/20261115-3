"""Playback verification: timeline measurements plus optional live playback.

The CI/container used for this task has no sound card, so verification works on
two levels:
  1. deterministic checks on the rendered WAV (where speech actually starts,
     where silence gaps are, measured rate, cross-segment isolation);
  2. best-effort live playback through whatever audio backend is available.
Per-sentence WAV clips are also written for manual listening.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess

import numpy as np

from .audio import read_wav, write_wav
from .model import Project
from .render import render_project


def _voiced_regions(samples: np.ndarray, sr: int, frame_ms: float = 20.0,
                    threshold: float = 0.01) -> list[tuple[float, float]]:
    win = max(1, int(sr * frame_ms / 1000.0))
    n = (samples.size // win) * win
    blocks = samples[:n].reshape(-1, win)
    level = np.sqrt(np.mean(np.square(blocks), axis=1))
    voiced = level > threshold
    regions = []
    start = None
    for i, flag in enumerate(voiced):
        if flag and start is None:
            start = i
        elif not flag and start is not None:
            regions.append((start * win / sr, i * win / sr))
            start = None
    if start is not None:
        regions.append((start * win / sr, samples.size / sr))
    return regions


def verify(project: Project, wav_path: str, clips_dir: str) -> dict:
    timeline, rendered = render_project(project)
    on_disk, disk_sr = read_wav(wav_path)
    assert disk_sr == project.sample_rate
    assert on_disk.size == timeline.size, "exported WAV does not match render"

    os.makedirs(clips_dir, exist_ok=True)
    sr = project.sample_rate
    checks = []
    for r in sorted(rendered, key=lambda x: x.segment.target_start):
        seg = r.segment
        clip_path = os.path.join(clips_dir, f"{seg.id}_clip.wav")
        write_wav(clip_path, r.samples, sr)
        regions = _voiced_regions(r.samples, sr)
        first_voice = regions[0][0] if regions else float("nan")
        gap_before = _gap_before(timeline, r.start_sample, sr)
        gap_after = _gap_after(timeline, r.start_sample + r.samples.size, sr)
        checks.append(
            {
                "id": seg.id,
                "clip": clip_path,
                "target_start_seconds": seg.target_start,
                "actual_start_sample": r.start_sample,
                "actual_start_seconds": round(r.start_sample / sr, 4),
                "start_error_ms": round((r.start_sample / sr - seg.target_start) * 1000, 3),
                "requested_rate": seg.rate,
                "measured_rate": round(r.measured_rate, 5),
                "rate_error_pct": round(abs(r.measured_rate - seg.rate) / seg.rate * 100, 4),
                "within_tolerance": abs(seg.rate - 1.0) <= project.tolerance + 1e-9,
                "rendered_duration_seconds": round(r.measured_duration, 4),
                "pause_after_requested_seconds": seg.pause_after,
                "silence_gap_after_measured_seconds": round(gap_after, 3),
                "silence_gap_before_measured_seconds": round(gap_before, 3),
                "first_voice_offset_in_clip_seconds": round(first_voice, 3),
                "rms": round(r.rms, 5),
            }
        )
    return {
        "sample_rate": sr,
        "total_seconds": round(timeline.size / sr, 4),
        "wav": wav_path,
        "clips_dir": clips_dir,
        "segments": checks,
    }


def _gap_before(timeline: np.ndarray, start_sample: int, sr: int,
                max_seconds: float = 3.0) -> float:
    limit = min(start_sample, int(max_seconds * sr))
    if limit == 0:
        return round(start_sample / sr, 3)
    window = timeline[start_sample - limit : start_sample]
    regions = _voiced_regions(window, sr)
    if not regions:
        return round(limit / sr, 3)
    return round(limit / sr - regions[-1][1], 3)


def _gap_after(timeline: np.ndarray, end_sample: int, sr: int,
               max_seconds: float = 3.0) -> float:
    limit = min(timeline.size - end_sample, int(max_seconds * sr))
    if limit <= 0:
        return 0.0
    window = timeline[end_sample : end_sample + limit]
    regions = _voiced_regions(window, sr)
    if not regions:
        return round(limit / sr, 3)
    return round(regions[0][0], 3)


def attempt_playback(wav_path: str) -> dict:
    ffmpeg = _ffmpeg_path()
    if ffmpeg:
        cmd = [ffmpeg, "-hide_banner", "-loglevel", "error",
               "-i", wav_path, "-f", "pulse", "default"]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if proc.returncode == 0:
            return {"player": "ffmpeg/pulse(WSLg)", "played": True, "stderr": ""}
        pulse_error = proc.stderr.strip()[:300]
    else:
        pulse_error = "static ffmpeg unavailable"
    players = [
        ("ffplay", ["ffplay", "-nodisp", "-autoexit", "-loglevel", "error", wav_path]),
        ("aplay", ["aplay", "-q", wav_path]),
        ("paplay", ["paplay", wav_path]),
    ]
    for name, cmd in players:
        if shutil.which(cmd[0]) is None:
            continue
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        return {
            "player": name,
            "played": proc.returncode == 0,
            "stderr": proc.stderr.strip()[:300],
        }
    return {
        "player": None,
        "played": False,
        "reason": "no usable audio backend",
        "pulse_error": pulse_error,
    }


def _ffmpeg_path() -> str | None:
    try:
        from imageio_ffmpeg import get_ffmpeg_exe

        return get_ffmpeg_exe()
    except Exception:
        return shutil.which("ffmpeg")


def run(project_path: str, wav_path: str, out_dir: str) -> dict:
    with open(project_path, encoding="utf-8") as fh:
        project = Project.from_dict(json.load(fh))
    report = verify(project, wav_path, os.path.join(out_dir, "clips"))
    report["live_playback"] = attempt_playback(wav_path)
    report_path = os.path.join(out_dir, "playback_report.json")
    with open(report_path, "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)
    return report
