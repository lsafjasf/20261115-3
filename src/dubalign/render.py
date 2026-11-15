"""Rendering pipeline: independent per-sentence processing and export."""

from __future__ import annotations

import json
from dataclasses import dataclass

import numpy as np

from .audio import read_wav, write_wav, time_stretch, rms, leading_silence
from .model import Project, Segment


@dataclass
class RenderedSegment:
    segment: Segment
    samples: np.ndarray
    start_sample: int
    measured_rate: float
    measured_duration: float
    leading_silence: float
    rms: float


def render_segment(seg: Segment, sr: int) -> RenderedSegment:
    """Process one sentence only, using its own source WAV."""
    source, source_sr = read_wav(seg.source_wav)
    if source_sr != sr:
        raise ValueError(
            f"{seg.id}: source sample rate {source_sr} != project rate {sr}"
        )
    result = time_stretch(source, sr, seg.stretch_factor)
    start_sample = int(round(seg.target_start * sr))
    return RenderedSegment(
        segment=seg,
        samples=result.samples,
        start_sample=start_sample,
        measured_rate=result.input_seconds / result.output_seconds,
        measured_duration=result.output_seconds,
        leading_silence=leading_silence(result.samples, sr),
        rms=rms(result.samples),
    )


def render_project(project: Project) -> tuple[np.ndarray, list[RenderedSegment]]:
    errors = project.validate()
    if errors:
        raise ValueError("invalid project: " + "; ".join(errors))

    rendered = [render_segment(seg, project.sample_rate) for seg in project.segments]
    total = max(
        (r.start_sample + r.samples.size + int(round(r.segment.pause_after * project.sample_rate)))
        for r in rendered
    )
    timeline = np.zeros(total, dtype=np.float64)
    for r in rendered:
        end = r.start_sample + r.samples.size
        timeline[r.start_sample:end] += r.samples  # independent placement
    return timeline, rendered


def _vtt_timestamp(seconds: float) -> str:
    if seconds < 0:
        seconds = 0.0
    ms = int(round(seconds * 1000.0))
    h, rem = divmod(ms, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, milli = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}.{milli:03d}"


def build_vtt(project: Project) -> str:
    lines = ["WEBVTT", ""]
    for seg in sorted(project.segments, key=lambda s: s.target_start):
        start = seg.target_start
        end = seg.target_start + seg.rendered_duration
        lines.append(f"{_vtt_timestamp(start)} --> {_vtt_timestamp(end)}")
        lines.append(seg.text)
        lines.append("")
    return "\n".join(lines).rstrip("\n") + "\n"


def build_project_json(
    project: Project,
    rendered: list[RenderedSegment],
    wav_path: str,
    vtt_path: str,
) -> dict:
    data = project.to_dict()
    data["exports"] = {"wav": wav_path, "vtt": vtt_path}
    data["rendered"] = [
        {
            "id": r.segment.id,
            "target_start": r.segment.target_start,
            "rate_requested": r.segment.rate,
            "rate_measured": round(r.measured_rate, 6),
            "stretch_factor": round(r.segment.stretch_factor, 6),
            "source_duration": round(r.segment.source_duration, 6),
            "rendered_duration": round(r.measured_duration, 6),
            "pause_after": r.segment.pause_after,
            "start_sample": r.start_sample,
            "end_sample": r.start_sample + r.samples.size,
            "leading_silence_seconds": round(r.leading_silence, 6),
            "rms": round(r.rms, 6),
        }
        for r in sorted(rendered, key=lambda r: r.segment.target_start)
    ]
    return data


def export_all(
    project: Project,
    wav_path: str,
    vtt_path: str,
    json_path: str,
) -> dict:
    timeline, rendered = render_project(project)
    write_wav(wav_path, timeline, project.sample_rate)
    with open(vtt_path, "w", encoding="utf-8") as fh:
        fh.write(build_vtt(project))
    payload = build_project_json(project, rendered, wav_path, vtt_path)
    with open(json_path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    return payload
