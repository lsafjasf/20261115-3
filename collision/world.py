"""Collision world owning bodies and their spatial index.

The world supports three detection backends that share the exact same narrow
phase, so their contact results are identical by construction:

* ``"brute"`` -- O(n^2) all-pairs AABB rejection, the reference.
* ``"grid"``  -- uniform spatial hash grid broad phase.
* ``"sap"``   -- sweep and prune broad phase.

Mutations (move / scale / rotate / remove) update the active broad phase
incrementally; no full rebuild is required between frames.
"""

from __future__ import annotations

from typing import Dict, List, Tuple

from .body import AABB, Body
from .grid import SpatialGrid, aabb_overlap
from .narrow import Contact, Manifold, collide
from .sap import SweepAndPrune


class World:
    def __init__(self, backend: str = "grid", cell_size: float = 64.0):
        if backend not in ("brute", "grid", "sap"):
            raise ValueError(f"unknown backend: {backend}")
        self.backend = backend
        self.bodies: Dict[int, Body] = {}
        self._next_id = 0
        self.grid = SpatialGrid(cell_size)
        self.sap = SweepAndPrune()
        # Stats filled by the latest detect() call.
        self.last_candidate_pairs = 0
        self.last_narrow_tests = 0

    # ------------------------------------------------------------------ #
    # Body management
    # ------------------------------------------------------------------ #
    def add_circle(self, x: float, y: float, radius: float,
                   user_data: object = None) -> Body:
        body = Body.circle(self._next_id, x, y, radius, user_data)
        return self._add(body)

    def add_rect(self, x: float, y: float, hw: float, hh: float,
                 angle: float = 0.0, user_data: object = None) -> Body:
        body = Body.rect(self._next_id, x, y, hw, hh, angle, user_data)
        return self._add(body)

    def _add(self, body: Body) -> Body:
        body._world = self
        self.bodies[body.body_id] = body
        self._next_id += 1
        if self.backend == "grid":
            self.grid.add(body)
        elif self.backend == "sap":
            self.sap.insert(body.body_id, body)
        return body

    def remove(self, body: Body) -> None:
        body_id = body.body_id if isinstance(body, Body) else body
        body = self.bodies.pop(body_id, None)
        if body is None:
            return
        body._world = None
        if self.backend == "grid":
            self.grid.remove(body_id)
        elif self.backend == "sap":
            self.sap.remove(body_id)

    def clear(self) -> None:
        self.bodies.clear()
        self.grid.clear()
        self.sap.clear()
        self._next_id = 0

    def set_backend(self, backend: str) -> None:
        if backend not in ("brute", "grid", "sap"):
            raise ValueError(f"unknown backend: {backend}")
        self.backend = backend
        if backend == "grid":
            self.grid.clear()
            for body in self.bodies.values():
                self.grid.add(body)
        elif backend == "sap":
            self.sap.rebuild(self.bodies)

    # ------------------------------------------------------------------ #
    # Index hooks invoked by Body after any transform change.
    # ------------------------------------------------------------------ #
    def _on_body_moved(self, body: Body, old_aabb: AABB) -> None:
        if body.aabb == old_aabb:
            return
        if self.backend == "grid":
            self.grid.update(body)
        elif self.backend == "sap":
            self.sap.update(body)

    # ------------------------------------------------------------------ #
    # Broad phase
    # ------------------------------------------------------------------ #
    def candidate_pairs(self) -> List[Tuple[int, int]]:
        if self.backend == "brute":
            return self._brute_pairs()
        if self.backend == "grid":
            return list(self.grid.candidate_pairs(self.bodies))
        return self.sap.candidate_pairs(self.bodies)

    def _brute_pairs(self) -> List[Tuple[int, int]]:
        ids = sorted(self.bodies)
        pairs: List[Tuple[int, int]] = []
        for i in range(len(ids)):
            box_a = self.bodies[ids[i]].aabb
            for j in range(i + 1, len(ids)):
                if aabb_overlap(box_a, self.bodies[ids[j]].aabb):
                    pairs.append((ids[i], ids[j]))
        return pairs

    # ------------------------------------------------------------------ #
    # Full detection pass
    # ------------------------------------------------------------------ #
    def detect(self) -> List[Manifold]:
        if self.backend == "sap" and not self.sap._order and self.bodies:
            self.sap.rebuild(self.bodies)
        pairs = self.candidate_pairs()
        self.last_candidate_pairs = len(pairs)
        manifolds: List[Manifold] = []
        narrow_tests = 0
        for id_a, id_b in pairs:
            narrow_tests += 1
            manifold = collide(self.bodies[id_a], self.bodies[id_b])
            if manifold is not None and manifold.touching:
                manifolds.append(manifold)
        self.last_narrow_tests = narrow_tests
        return manifolds

    def all_contacts(self) -> List[Contact]:
        contacts: List[Contact] = []
        for manifold in self.detect():
            contacts.extend(manifold.contacts)
        return contacts

    def __len__(self) -> int:
        return len(self.bodies)
