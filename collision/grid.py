"""Uniform spatial hash grid broad phase.

The plane is partitioned into square cells of side ``cell_size``. A body is
stored in *every* cell its AABB overlaps (usually one, up to four for a body
larger than a cell). Candidate pairs are emitted once by walking every cell
and pairing its members.

The grid is hash based rather than a dense 2D array, so bodies may live at
arbitrary (including negative) coordinates without preallocating a world-sized
matrix.
"""

from __future__ import annotations

from typing import Dict, Iterator, List, Set, Tuple

from .body import AABB, Body


def aabb_overlap(a: AABB, b: AABB) -> bool:
    """Strict/conservative AABB overlap (touching counts as overlap)."""
    return not (a[2] < b[0] or b[2] < a[0] or a[3] < b[1] or b[3] < a[1])


Cell = Tuple[int, int]


class SpatialGrid:
    def __init__(self, cell_size: float = 64.0):
        if cell_size <= 0.0:
            raise ValueError("cell_size must be positive")
        self.cell_size = float(cell_size)
        # cell coordinate -> set of body ids currently covering the cell.
        self._cells: Dict[Cell, Set[int]] = {}
        # body id -> set of cells the body currently occupies.
        self._membership: Dict[int, Set[Cell]] = {}

    # ------------------------------------------------------------------ #
    # Cell helpers
    # ------------------------------------------------------------------ #
    def _cells_for(self, aabb: AABB) -> List[Cell]:
        inv = 1.0 / self.cell_size
        x0 = int(_floor(aabb[0] * inv))
        y0 = int(_floor(aabb[1] * inv))
        x1 = int(_floor(aabb[2] * inv))
        y1 = int(_floor(aabb[3] * inv))
        cells: List[Cell] = []
        for cx in range(x0, x1 + 1):
            for cy in range(y0, y1 + 1):
                cells.append((cx, cy))
        return cells

    # ------------------------------------------------------------------ #
    # Index maintenance
    # ------------------------------------------------------------------ #
    def add(self, body: Body) -> None:
        if body.body_id in self._membership:
            return
        cells = set(self._cells_for(body.aabb))
        self._membership[body.body_id] = cells
        for cell in cells:
            bucket = self._cells.get(cell)
            if bucket is None:
                self._cells[cell] = {body.body_id}
            else:
                bucket.add(body.body_id)

    def remove(self, body_id: int) -> None:
        cells = self._membership.pop(body_id, None)
        if cells is None:
            return
        for cell in cells:
            bucket = self._cells.get(cell)
            if bucket is None:
                continue
            bucket.discard(body_id)
            if not bucket:
                del self._cells[cell]

    def update(self, body: Body) -> None:
        """Re-index a body after its AABB changed.

        Only cells that were actually entered/left are touched, so a body that
        stays inside the same cell costs effectively nothing.
        """
        new_cells = set(self._cells_for(body.aabb))
        old_cells = self._membership.get(body.body_id)
        if old_cells is None:
            self.add(body)
            return
        if new_cells == old_cells:
            return
        for cell in old_cells - new_cells:
            bucket = self._cells.get(cell)
            if bucket is not None:
                bucket.discard(body.body_id)
                if not bucket:
                    del self._cells[cell]
        for cell in new_cells - old_cells:
            bucket = self._cells.get(cell)
            if bucket is None:
                self._cells[cell] = {body.body_id}
            else:
                bucket.add(body.body_id)
        self._membership[body.body_id] = new_cells

    def clear(self) -> None:
        self._cells.clear()
        self._membership.clear()

    # ------------------------------------------------------------------ #
    # Queries
    # ------------------------------------------------------------------ #
    def query_point(self, x: float, y: float) -> List[int]:
        inv = 1.0 / self.cell_size
        cell = (int(_floor(x * inv)), int(_floor(y * inv)))
        return list(self._cells.get(cell, ()))

    def query_aabb(self, aabb: AABB) -> Set[int]:
        found: Set[int] = set()
        for cell in self._cells_for(aabb):
            found.update(self._cells.get(cell, ()))
        return found

    def candidate_pairs(self, bodies: Dict[int, Body]) -> Iterator[Tuple[int, int]]:
        """Yield every unique ``(low_id, high_id)`` pair sharing a cell.

        A final AABB rejection keeps pairs whose AABBs merely share a cell
        corner from reaching the narrow phase.
        """
        seen: Set[Tuple[int, int]] = set()
        for bucket in self._cells.values():
            if len(bucket) < 2:
                continue
            ids = bucket
            for id_a in ids:
                box_a = bodies[id_a].aabb
                for id_b in ids:
                    if id_b <= id_a:
                        continue
                    key = (id_a, id_b)
                    if key in seen:
                        continue
                    seen.add(key)
                    if aabb_overlap(box_a, bodies[id_b].aabb):
                        yield key

    def cell_count(self) -> int:
        return len(self._cells)

    def __len__(self) -> int:
        return len(self._membership)


def _floor(value: float) -> float:
    # Local import keeps the hot path attribute lookup short.
    import math
    return math.floor(value)

