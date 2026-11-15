import pytest

from dubalign.model import Project, Segment


def _seg(seg_id, start=0.0, duration=1.0, rate=1.0, pause=0.0):
    return Segment(
        id=seg_id,
        text=f"text {seg_id}",
        source_wav=f"{seg_id}.wav",
        source_start=start,
        source_duration=duration,
        target_start=start,
        rate=rate,
        pause_after=pause,
    )


def test_tolerance_accepts_boundary_rates():
    project = Project("p", 24000, 0.10, [_seg("a", rate=0.9), _seg("b", start=2.0, rate=1.1)])
    assert project.validate() == []


def test_tolerance_rejects_rate_too_fast():
    project = Project("p", 24000, 0.10, [_seg("a", rate=0.89)])
    errors = project.validate()
    assert any("exceeds tolerance" in e for e in errors)


def test_tolerance_rejects_rate_too_slow():
    project = Project("p", 24000, 0.10, [_seg("a", rate=1.11)])
    assert any("exceeds tolerance" in e for e in project.validate())


def test_overlap_detected_after_slowdown():
    # a lasts 1s at rate 1; b starts 0.5s later -> overlap
    project = Project("p", 24000, 0.10, [_seg("a"), _seg("b", start=0.5)])
    assert any("overlap" in e for e in project.validate())


def test_duplicate_ids_rejected():
    project = Project("p", 24000, segments=[_seg("a"), _seg("a", start=5.0)])
    assert any("unique" in e for e in project.validate())


def test_rendered_duration_reflects_rate():
    seg = _seg("a", duration=2.0, rate=0.9)
    assert seg.stretch_factor == pytest.approx(1 / 0.9)
    assert seg.rendered_duration == pytest.approx(2.0 / 0.9)


def test_round_trip_survives_extra_fields(tmp_path):
    payload = Project("p", 24000, segments=[_seg("a")]).to_dict()
    payload["segments"][0]["measured_leading_silence"] = 0.13
    project = Project.from_dict(payload)
    assert project.segments[0].id == "a"
