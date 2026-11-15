"""Apply the three requested sentence-level adjustments and export artifacts."""

from __future__ import annotations

import json
import os

from .model import Project
from .render import export_all


# Each sentence demonstrates one adjustment dimension:
#   s1: move the audio start point (dub was late vs. the picture)
#   s2: change playback speed within tolerance (dub was too slow)
#   s3: insert a pause after the sentence
EDITS = {
    "s1": {"target_start": 0.050},  # start point: pulled earlier
    "s2": {"rate": 0.92},  # speed: 8% slower, within +/-10% tolerance
    "s3": {"target_start": 11.800, "pause_after": 0.600},  # pause after speech
}


def apply(source_project: str, out_dir: str) -> dict:
    os.makedirs(out_dir, exist_ok=True)
    with open(source_project, encoding="utf-8") as fh:
        project = Project.from_dict(json.load(fh))

    for seg in project.segments:
        change = EDITS[seg.id]
        for key, value in change.items():
            setattr(seg, key, value)

    errors = project.validate()
    if errors:
        raise SystemExit("adjustment rejected: " + "; ".join(errors))

    project_json = os.path.join(out_dir, "project.json")
    payload = export_all(
        project,
        os.path.join(out_dir, "dub_adjusted.wav"),
        os.path.join(out_dir, "dub_adjusted.vtt"),
        project_json,
    )
    with open(project_json, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    return payload


if __name__ == "__main__":
    import sys

    src = sys.argv[1] if len(sys.argv) > 1 else "artifacts/source/source_project.json"
    out = sys.argv[2] if len(sys.argv) > 2 else "artifacts/export"
    result = apply(src, out)
    print(json.dumps(result["rendered"], ensure_ascii=False, indent=2))
