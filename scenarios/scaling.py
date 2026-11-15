"""Scaling experiment: brute force O(n^2) vs spatial grid O(n).

Generates uniform-density worlds at increasing body counts and times a single
collision pass for each backend. The density is held constant so the expected
grid cost grows linearly while brute force grows quadratically.
"""

from __future__ import annotations

import math
import random
import time
from typing import Dict, List

from collision import World

COUNTS = (100, 200, 400, 800, 1200)


def _build(count: int, backend: str) -> World:
    # World area scales with count -> constant bodies per unit area.
    extent = 40.0 * math.sqrt(count)
    rng = random.Random(4242)
    world = World(backend=backend, cell_size=64.0)
    for _ in range(count):
        x, y = rng.uniform(0.0, extent), rng.uniform(0.0, extent)
        if rng.random() < 0.5:
            world.add_circle(x, y, rng.uniform(8.0, 18.0))
        else:
            world.add_rect(x, y, rng.uniform(8.0, 18.0),
                           rng.uniform(6.0, 14.0),
                           rng.uniform(0.0, math.pi))
    return world


def _time_detect(world: World, repeats: int = 5) -> float:
    world.detect()  # warm up
    start = time.perf_counter()
    for _ in range(repeats):
        world.detect()
    return (time.perf_counter() - start) * 1000.0 / repeats


def run() -> List[Dict[str, float]]:
    rows: List[Dict[str, float]] = []
    for count in COUNTS:
        row: Dict[str, float] = {"count": count}
        for backend in ("brute", "grid", "sap"):
            world = _build(count, backend)
            row[f"{backend}_ms"] = round(_time_detect(world), 3)
            row[f"{backend}_candidates"] = world.last_candidate_pairs
        row["grid_speedup"] = round(row["brute_ms"] / row["grid_ms"], 2)
        rows.append(row)
    return rows


def print_table() -> None:
    print(f"{'bodies':>7} {'brute ms':>10} {'grid ms':>10} {'sap ms':>10} "
          f"{'brute pairs':>12} {'grid pairs':>11} {'speedup':>8}")
    for row in run():
        print(f"{row['count']:7d} {row['brute_ms']:10.3f} "
              f"{row['grid_ms']:10.3f} {row['sap_ms']:10.3f} "
              f"{row['brute_candidates']:12d} "
              f"{row['grid_candidates']:11d} "
              f"{row['grid_speedup']:7.2f}x")


if __name__ == "__main__":
    print_table()
