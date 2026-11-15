"""End-to-end demo: render a mutating scene on every backend and compare.

Run with ``python -m render.demo``. It verifies that the grid/SAP renderers
produce the exact same candidate pairs and contact points as brute force, and
prints the draw-time difference.
"""

from __future__ import annotations

import json
from pathlib import Path

from scenarios.scenarios import SCENARIOS, build_world, mutate_world

from .renderer import Renderer


def _normalize_contacts(report):
    return sorted((item["pair"], item["point"], item["normal"],
                   item["penetration"]) for item in report)


def run(frames: int = 15, artifact: Path | None = None) -> dict:
    spec = SCENARIOS[1]  # dense_mix: the most contact-heavy scenario.
    backends = ("brute", "grid", "sap")
    worlds = {name: build_world(spec, name) for name in backends}
    renderers = {name: Renderer(worlds[name]) for name in backends}

    frame_records = []
    totals = {name: {"draw_ms": 0.0, "frames": 0} for name in backends}
    for frame in range(frames):
        frame_data = {"frame": frame}
        reports = {}
        for name in backends:
            stats = renderers[name].render_frame()
            reports[name] = {
                "candidates": renderers[name].candidate_report(),
                "contacts": renderers[name].contact_report(),
            }
            frame_data[name] = stats.__dict__
            totals[name]["draw_ms"] += stats.draw_ms
            totals[name]["frames"] += 1

        reference_contacts = _normalize_contacts(reports["brute"]["contacts"])
        reference_candidates = {tuple(pair)
                                for pair in reports["brute"]["candidates"]}
        for name in ("grid", "sap"):
            assert {tuple(pair) for pair in reports[name]["candidates"]} == \
                reference_candidates
            assert _normalize_contacts(reports[name]["contacts"]) == \
                reference_contacts

        frame_records.append(frame_data)
        for name in backends:
            mutate_world(spec, worlds[name], frame, frames)

    summary = {}
    brute_avg = totals["brute"]["draw_ms"] / frames
    for name in backends:
        average = totals[name]["draw_ms"] / frames
        summary[name] = {
            "avg_draw_ms": round(average, 4),
            "speedup_vs_brute": round(brute_avg / average, 3),
        }

    output = {
        "scenario": spec.name,
        "frames": frames,
        "summary": summary,
        "sample_frame": frame_records[0],
        "sample_contacts": reports["brute"]["contacts"][:10],
        "sample_candidates": reports["brute"]["candidates"][:10],
    }
    if artifact is not None:
        artifact.parent.mkdir(parents=True, exist_ok=True)
        artifact.write_text(json.dumps(output, indent=2))
    return output


def main() -> None:
    artifact = Path("artifacts/render_demo.json")
    output = run(artifact=artifact)
    print(f"Scenario: {output['scenario']} ({output['frames']} frames)")
    print(f"{'backend':<8} {'avg draw ms':>13} {'speedup':>10}")
    for name, stats in output["summary"].items():
        print(f"{name:<8} {stats['avg_draw_ms']:13.3f} "
              f"{stats['speedup_vs_brute']:9.2f}x")
    print("\nSample candidate pairs:", output["sample_candidates"])
    print("Sample contacts:")
    for contact in output["sample_contacts"]:
        print(" ", contact)
    print(f"\nFull report: {artifact}")


if __name__ == "__main__":
    main()
