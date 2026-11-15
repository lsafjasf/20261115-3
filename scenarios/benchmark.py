"""Compare brute force against the grid and SAP broad phases.

For every scenario the runner replays the identical mutation script on three
independent worlds (one per backend), then asserts that:

1. the set of touching body pairs is identical, and
2. every contact point / normal / penetration agrees numerically.

Timing covers the whole per-frame collision pass (broad phase + narrow phase),
which is the "draw time" cost a renderer would block on before drawing.
"""

from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Tuple

from .scenarios import SCENARIOS, ScenarioSpec, build_world, mutate_world

BACKENDS = ("brute", "grid", "sap")
POINT_TOL = 1e-6


@dataclass
class FrameStats:
    frame: int
    bodies: int
    candidate_pairs: int
    narrow_tests: int
    touching_pairs: int
    contact_points: int
    draw_ms: float


def _signature(manifolds) -> Dict[Tuple[int, int], list]:
    """Normalize manifolds into a comparable, order-independent structure."""
    signature: Dict[Tuple[int, int], list] = {}
    for manifold in manifolds:
        key = (min(manifold.a, manifold.b), max(manifold.a, manifold.b))
        contacts = sorted(
            (
                (round(c.point[0], 9), round(c.point[1], 9),
                 round(c.normal[0], 9), round(c.normal[1], 9),
                 round(c.penetration, 9))
                for c in manifold.contacts
            )
        )
        signature[key] = contacts
    return signature


def _assert_equal(reference: dict, candidate: dict, backend: str,
                  frame: int) -> None:
    ref_keys = set(reference)
    cand_keys = set(candidate)
    if ref_keys != cand_keys:
        missing = ref_keys - cand_keys
        extra = cand_keys - ref_keys
        raise AssertionError(
            f"[{backend}] frame {frame}: pair mismatch "
            f"(missing {sorted(missing)[:5]}, extra {sorted(extra)[:5]})"
        )
    for key in ref_keys:
        ref_contacts = reference[key]
        cand_contacts = candidate[key]
        if len(ref_contacts) != len(cand_contacts):
            raise AssertionError(
                f"[{backend}] frame {frame} pair {key}: contact count "
                f"{len(cand_contacts)} != {len(ref_contacts)}"
            )
        for ref_point, cand_point in zip(ref_contacts, cand_contacts):
            for ref_value, cand_value in zip(ref_point, cand_point):
                if abs(ref_value - cand_value) > POINT_TOL:
                    raise AssertionError(
                        f"[{backend}] frame {frame} pair {key}: contact "
                        f"mismatch {cand_point} != {ref_point}"
                    )


def run_scenario(spec: ScenarioSpec, frames: int,
                 cell_size: float = 64.0) -> Dict[str, List[FrameStats]]:
    worlds = {
        backend: build_world(spec, backend, cell_size=cell_size)
        for backend in BACKENDS
    }
    results: Dict[str, List[FrameStats]] = {b: [] for b in BACKENDS}

    # Warm up allocators / branch predictors without recording timing.
    for world in worlds.values():
        world.detect()

    for frame in range(frames):
        signatures = {}
        for backend in BACKENDS:
            world = worlds[backend]
            start = time.perf_counter()
            manifolds = world.detect()
            elapsed_ms = (time.perf_counter() - start) * 1000.0
            signatures[backend] = _signature(manifolds)
            results[backend].append(FrameStats(
                frame=frame,
                bodies=len(world),
                candidate_pairs=world.last_candidate_pairs,
                narrow_tests=world.last_narrow_tests,
                touching_pairs=len(manifolds),
                contact_points=sum(len(m.contacts) for m in manifolds),
                draw_ms=elapsed_ms,
            ))

        reference = signatures["brute"]
        for backend in ("grid", "sap"):
            _assert_equal(reference, signatures[backend], backend, frame)

        # Identical deterministic mutation for every backend.
        for backend in BACKENDS:
            mutate_world(spec, worlds[backend], frame, frames)

    return results


def summarize(results: Dict[str, List[FrameStats]]) -> Dict[str, dict]:
    summary = {}
    for backend, stats in results.items():
        timings = sorted(s.draw_ms for s in stats)
        mid = len(timings) // 2
        summary[backend] = {
            "mean_draw_ms": sum(timings) / len(timings),
            "median_draw_ms": timings[mid],
            "p95_draw_ms": timings[min(len(timings) - 1, int(len(timings) * 0.95))],
            "avg_candidate_pairs": sum(s.candidate_pairs for s in stats) / len(stats),
            "avg_narrow_tests": sum(s.narrow_tests for s in stats) / len(stats),
            "avg_touching_pairs": sum(s.touching_pairs for s in stats) / len(stats),
            "avg_contact_points": sum(s.contact_points for s in stats) / len(stats),
            "avg_bodies": sum(s.bodies for s in stats) / len(stats),
        }
    return summary


def run_all(frames: int = 30, cell_size: float = 64.0,
            artifact_path: Path | None = None) -> dict:
    report = {"frames": frames, "cell_size": cell_size, "scenarios": {}}
    for spec in SCENARIOS:
        results = run_scenario(spec, frames, cell_size)
        summary = summarize(results)
        brute_mean = summary["brute"]["mean_draw_ms"]
        for backend in ("grid", "sap"):
            mean = summary[backend]["mean_draw_ms"]
            summary[backend]["speedup_vs_brute"] = brute_mean / mean
        summary["brute"]["speedup_vs_brute"] = 1.0
        report["scenarios"][spec.name] = {
            "description": spec.description,
            "count": spec.count,
            "summary": summary,
            "frames": [
                {
                    backend: asdict(results[backend][frame])
                    for backend in BACKENDS
                }
                for frame in range(frames)
            ],
        }

    if artifact_path is not None:
        artifact_path.parent.mkdir(parents=True, exist_ok=True)
        artifact_path.write_text(json.dumps(report, indent=2))
    return report
