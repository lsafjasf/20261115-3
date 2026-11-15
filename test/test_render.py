import json

import numpy as np
import pytest

from dubalign.audio import write_wav, read_wav
from dubalign.model import Project, Segment
from dubalign.render import render_project, build_vtt, export_all
from dubalign.playback_check import verify


SR = 24000


def _speech_like(seed, seconds):
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    env = 0.5 + 0.5 * np.sin(2 * np.pi * 3 * t)
    return (0.2 * env * np.sin(2 * np.pi * (180 + 20 * seed) * t)
            + 0.02 * rng.normal(size=n)).astype(np.float64)


@pytest.fixture
def project(tmp_path):
    segments = []
    cursor = 0.2
    for idx, duration in enumerate((1.0, 1.2, 0.9)):
        sid = f"s{idx + 1}"
        wav = tmp_path / f"{sid}.wav"
        write_wav(str(wav), _speech_like(idx, duration), SR)
        segments.append(
            Segment(sid, f"句子{idx}", str(wav), cursor, duration, cursor,
                    rate=1.0, pause_after=0.0)
        )
        cursor += duration + 0.3
    return Project("unit", SR, 0.10, segments)


def test_render_places_each_segment_at_target_sample(project):
    timeline, rendered = render_project(project)
    for r in rendered:
        assert r.start_sample == int(round(r.segment.target_start * SR))
        assert timeline.size >= r.start_sample + r.samples.size


def test_measured_rate_matches_request_within_numeric_error(project):
    project.segments[1].rate = 0.92
    _, rendered = render_project(project)
    s2 = next(r for r in rendered if r.segment.id == "s2")
    assert abs(s2.measured_rate - 0.92) / 0.92 < 0.002


def test_editing_one_segment_never_changes_others(project):
    _, baseline = render_project(project)
    base = {r.segment.id: (r.start_sample, r.samples.copy()) for r in baseline}

    project.segments[0].target_start = 0.0
    project.segments[0].rate = 0.95
    _, changed = render_project(project)

    for r in changed:
        if r.segment.id == "s1":
            continue
        old_start, old_samples = base[r.segment.id]
        assert r.start_sample == old_start
        assert np.array_equal(r.samples, old_samples)


def test_pause_after_extends_timeline_with_silence(project):
    project.segments[2].pause_after = 0.5
    timeline, rendered = render_project(project)
    last = max(rendered, key=lambda r: r.start_sample)
    expected_end = last.start_sample + last.samples.size + int(0.5 * SR)
    assert timeline.size == expected_end
    assert np.all(timeline[last.start_sample + last.samples.size :] == 0.0)


def test_vtt_follows_new_timeline(project):
    project.segments[0].target_start = 0.05
    vtt = build_vtt(project)
    assert vtt.startswith("WEBVTT")
    assert "00:00:00.050 -->" in vtt


def test_export_writes_all_three_artifacts(project, tmp_path):
    wav = tmp_path / "out.wav"
    vtt = tmp_path / "out.vtt"
    js = tmp_path / "out.json"
    payload = export_all(project, str(wav), str(vtt), str(js))
    assert wav.exists() and vtt.exists() and js.exists()
    data, sr = read_wav(str(wav))
    assert sr == SR and data.size > 0
    saved = json.loads(js.read_text(encoding="utf-8"))
    assert saved["schema"] == "dubalign/project-1"
    assert {r["id"] for r in payload["rendered"]} == {"s1", "s2", "s3"}


def test_verify_report_checks_rates_and_starts(project, tmp_path):
    wav = tmp_path / "out.wav"
    export_all(project, str(wav), str(tmp_path / "x.vtt"), str(tmp_path / "x.json"))
    report = verify(project, str(wav), str(tmp_path / "clips"))
    for item in report["segments"]:
        assert item["start_error_ms"] == 0.0
        assert item["within_tolerance"] is True
        assert item["rate_error_pct"] < 0.5
