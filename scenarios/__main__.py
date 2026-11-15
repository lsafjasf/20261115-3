"""CLI entry: ``python -m scenarios [--frames N] [--json PATH]``."""

from __future__ import annotations

import argparse
from pathlib import Path

from .benchmark import BACKENDS, run_all


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frames", type=int, default=30,
                        help="mutated frames replayed per scenario")
    parser.add_argument("--cell-size", type=float, default=64.0)
    parser.add_argument("--json", type=Path, default=None,
                        help="optional path for the full JSON report")
    args = parser.parse_args()

    report = run_all(args.frames, args.cell_size, args.json)
    for name, payload in report["scenarios"].items():
        print(f"\n=== {name} ({payload['count']} bodies) ===")
        print(payload["description"])
        header = f"{'backend':<7} {'mean ms':>9} {'median':>9} {'p95':>9} {'cand/frame':>11} {'tests/frame':>12} {'speedup':>8}"
        print(header)
        for backend in BACKENDS:
            stats = payload["summary"][backend]
            print(
                f"{backend:<7} {stats['mean_draw_ms']:9.3f} "
                f"{stats['median_draw_ms']:9.3f} {stats['p95_draw_ms']:9.3f} "
                f"{stats['avg_candidate_pairs']:11.1f} "
                f"{stats['avg_narrow_tests']:12.1f} "
                f"{stats['speedup_vs_brute']:7.2f}x"
            )
    if args.json is not None:
        print(f"\nJSON report written to {args.json}")


if __name__ == "__main__":
    main()
