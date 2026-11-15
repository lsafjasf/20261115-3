"""Prove that editing one sentence leaves every other sentence bit-identical."""

from __future__ import annotations

import copy
import json

import numpy as np

from .model import Project
from .render import render_project


def run(project_path: str) -> dict:
    with open(project_path, encoding="utf-8") as fh:
        base = Project.from_dict(json.load(fh))

    _, base_render = render_project(base)
    baseline = {
        r.segment.id: (r.start_sample, r.samples.copy()) for r in base_render
    }

    results = []
    for target in base.segments:
        modified = copy.deepcopy(base)
        seg = next(s for s in modified.segments if s.id == target.id)
        # Safe edits that cannot introduce an overlap: earlier start, faster
        # speech, shorter trailing pause.
        seg.target_start = max(0.0, seg.target_start - 0.15)
        seg.rate = 1.07
        seg.pause_after = max(0.0, seg.pause_after - 0.1)
        _, rendered = render_project(modified)
        for r in rendered:
            if r.segment.id == target.id:
                continue
            old_start, old_samples = baseline[r.segment.id]
            results.append(
                {
                    "edited": target.id,
                    "untouched": r.segment.id,
                    "start_sample_unchanged": r.start_sample == old_start,
                    "samples_bit_identical": bool(np.array_equal(r.samples, old_samples)),
                }
            )
    return {"isolation_checks": results,
            "all_isolated": all(
                c["start_sample_unchanged"] and c["samples_bit_identical"] for c in results
            )}


if __name__ == "__main__":
    import sys

    print(json.dumps(run(sys.argv[1] if len(sys.argv) > 1 else "artifacts/export/project.json"),
                     ensure_ascii=False, indent=2))
