"""Headless scene renderer with a measured draw-time budget.

The renderer mirrors what a 2D engine does each frame:

1. ask the world for candidate pairs (broad phase),
2. run the narrow phase to obtain contact manifolds,
3. emit draw commands for every body, every candidate-pair link and every
   contact point.

Drawing is simulated by appending structured commands to a list instead of
touching a GPU, which keeps the benchmark deterministic while still charging
the per-primitive work a real renderer would pay. The returned :class:`RenderStats`
exposes the total draw-time and the candidate/final contact counts.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Dict, List

from collision import World


@dataclass
class RenderStats:
    bodies: int
    candidate_pairs: int
    narrow_tests: int
    touching_pairs: int
    contact_points: int
    draw_commands: int
    draw_ms: float


class Renderer:
    def __init__(self, world: World, show_candidates: bool = True,
                 show_contacts: bool = True):
        self.world = world
        self.show_candidates = show_candidates
        self.show_contacts = show_contacts
        self.commands: List[Dict[str, Any]] = []

    # ------------------------------------------------------------------ #
    # Draw command emitters
    # ------------------------------------------------------------------ #
    def _command(self, kind: str, **payload: Any) -> None:
        payload["kind"] = kind
        self.commands.append(payload)

    def draw_bodies(self) -> None:
        for body in self.world.bodies.values():
            if body.shape == "circle":
                self._command("circle", x=body.x, y=body.y,
                              radius=body.radius())
            else:
                self._command("rect", vertices=body.world_vertices())

    def draw_candidates(self, pairs) -> None:
        if not self.show_candidates:
            return
        for id_a, id_b in pairs:
            a = self.world.bodies[id_a]
            b = self.world.bodies[id_b]
            self._command("candidate", start=a.position, end=b.position)

    def draw_contacts(self, manifolds) -> None:
        if not self.show_contacts:
            return
        for manifold in manifolds:
            for contact in manifold.contacts:
                self._command(
                    "contact",
                    point=contact.point,
                    normal=contact.normal,
                    penetration=contact.penetration,
                    pair=(contact.a, contact.b),
                )

    # ------------------------------------------------------------------ #
    # Frame rendering
    # ------------------------------------------------------------------ #
    def render_frame(self) -> RenderStats:
        """Run one full frame and return its draw-time statistics."""
        self.commands = []
        start = time.perf_counter()

        candidates = self.world.candidate_pairs()
        manifolds = self.world.detect()

        self.draw_bodies()
        self.draw_candidates(candidates)
        self.draw_contacts(manifolds)

        draw_ms = (time.perf_counter() - start) * 1000.0
        return RenderStats(
            bodies=len(self.world),
            candidate_pairs=len(candidates),
            narrow_tests=self.world.last_narrow_tests,
            touching_pairs=len(manifolds),
            contact_points=sum(len(m.contacts) for m in manifolds),
            draw_commands=len(self.commands),
            draw_ms=draw_ms,
        )

    def contact_report(self) -> List[Dict[str, Any]]:
        """Serializable list of final contact points for the current frame."""
        report = []
        for manifold in self.world.detect():
            for contact in manifold.contacts:
                report.append({
                    "pair": [contact.a, contact.b],
                    "point": [round(contact.point[0], 6),
                              round(contact.point[1], 6)],
                    "normal": [round(contact.normal[0], 6),
                               round(contact.normal[1], 6)],
                    "penetration": round(contact.penetration, 6),
                })
        return report

    def candidate_report(self) -> List[List[int]]:
        """Serializable list of broad-phase candidate id pairs."""
        return [list(pair) for pair in self.world.candidate_pairs()]
