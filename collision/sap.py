"""Sweep and prune broad phase (sort and sweep on the X axis).

Each body contributes an AABB interval ``[min_x, max_x]``. The interval start
events are sorted, then swept in order: an interval opening only has to be
tested against currently *open* intervals, because any interval that already
closed cannot overlap it on X. Surviving pairs are checked on Y as well.

The sort is stable, so coherent motion between frames turns the sort into a
near-linear insertion pass.
"""

from __future__ import annotations

from typing import Dict, List, Tuple

from .body import Body
from .grid import aabb_overlap


class SweepAndPrune:
    def __init__(self) -> None:
        # Sorted list of (min_x, body_id); maintained across frames.
        self._order: List[Tuple[float, int]] = []

    def rebuild(self, bodies: Dict[int, Body]) -> None:
        """Sort all bodies from scratch (first frame / bulk change)."""
        self._order = sorted(
            ((body.aabb[0], body_id) for body_id, body in bodies.items()),
            key=lambda item: item[0],
        )

    def insert(self, body_id: int, body: Body) -> None:
        self._order.append((body.aabb[0], body_id))
        self._order.sort(key=lambda item: item[0])

    def remove(self, body_id: int) -> None:
        for index, (_, other_id) in enumerate(self._order):
            if other_id == body_id:
                del self._order[index]
                return

    def update(self, body: Body) -> None:
        # Bodies are keyed by id; resort to restore sorted order.
        for index, (_, body_id) in enumerate(self._order):
            if body_id == body.body_id:
                self._order[index] = (body.aabb[0], body.body_id)
                break
        self._order.sort(key=lambda item: item[0])

    def clear(self) -> None:
        self._order.clear()

    def candidate_pairs(self, bodies: Dict[int, Body]) -> List[Tuple[int, int]]:
        active: List[int] = []
        pairs: List[Tuple[int, int]] = []
        seen: set = set()
        get_bodies = bodies
        for min_x, body_id in self._order:
            box = get_bodies[body_id].aabb
            # Drop intervals whose right edge is before this opening edge.
            write = 0
            for index in range(len(active)):
                other = active[index]
                if get_bodies[other].aabb[2] >= min_x:
                    active[write] = other
                    write += 1
            del active[write:]
            for other in active:
                low, high = (other, body_id) if other < body_id else (body_id, other)
                if (low, high) in seen:
                    continue
                seen.add((low, high))
                if aabb_overlap(box, get_bodies[other].aabb):
                    pairs.append((low, high))
            active.append(body_id)
        return pairs
