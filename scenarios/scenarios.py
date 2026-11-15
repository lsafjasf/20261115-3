"""Three fixed scenarios plus deterministic per-frame mutations.

Each scenario populates a fresh :class:`~collision.world.World` with a mix of
circles and rotated rectangles. ``mutate_world`` applies the same scripted
motion / scaling / deletion to every backend so the brute-force reference and
the spatial index always see an identical world.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass
from typing import List

from collision import World


@dataclass(frozen=True)
class ScenarioSpec:
    name: str
    count: int
    world_size: float
    description: str


SCENARIOS: List[ScenarioSpec] = [
    ScenarioSpec(
        name="sparse_grid",
        count=400,
        world_size=1600.0,
        description="400 bodies spread across a large field, low density",
    ),
    ScenarioSpec(
        name="dense_mix",
        count=600,
        world_size=700.0,
        description="600 mixed circles and rotated rects in a compact arena",
    ),
    ScenarioSpec(
        name="clustered_dynamic",
        count=500,
        world_size=900.0,
        description="500 bodies forming dense clusters with live add/remove",
    ),
]


def _seed_for(spec: ScenarioSpec) -> int:
    # Stable seed derived from the scenario name.
    return abs(hash(("scenario", spec.name))) % (2 ** 32)


def build_world(spec: ScenarioSpec, backend: str,
                cell_size: float = 64.0) -> World:
    rng = random.Random(_seed_for(spec))
    world = World(backend=backend, cell_size=cell_size)
    extent = spec.world_size

    for index in range(spec.count):
        x = rng.uniform(0.0, extent)
        y = rng.uniform(0.0, extent)
        if rng.random() < 0.5:
            radius = rng.uniform(8.0, 22.0)
            world.add_circle(x, y, radius)
        else:
            hw = rng.uniform(10.0, 26.0)
            hh = rng.uniform(8.0, 20.0)
            angle = rng.uniform(0.0, math.pi)
            world.add_rect(x, y, hw, hh, angle)

    if spec.name == "clustered_dynamic":
        # Pack a third of the bodies into two tight clusters to create
        # high local occupancy (worst-ish case for the broad phase).
        centers = [(extent * 0.3, extent * 0.35),
                   (extent * 0.7, extent * 0.65)]
        bodies = list(world.bodies.values())
        for index, body in enumerate(bodies[: spec.count // 3]):
            center = centers[index % 2]
            body.move_to(
                center[0] + rng.uniform(-60.0, 60.0),
                center[1] + rng.uniform(-60.0, 60.0),
            )
    return world


def mutate_world(spec: ScenarioSpec, world: World, frame: int,
                 max_frames: int) -> List[int]:
    """Apply one deterministic frame of motion, scaling and deletion.

    Returns the ids removed during this frame.
    """
    rng = random.Random(_seed_for(spec) + frame + 1)
    extent = spec.world_size
    removed: List[int] = []

    # The clustered scenario continuously removes and re-adds bodies, which
    # exercises index deletion/insertion every single frame.
    churn = 8 if spec.name == "clustered_dynamic" else 2
    bodies = list(world.bodies.values())
    for body in rng.sample(bodies, min(churn, len(bodies))):
        removed.append(body.body_id)
        world.remove(body)

    for body in list(world.bodies.values()):
        dx = rng.uniform(-18.0, 18.0)
        dy = rng.uniform(-18.0, 18.0)
        nx = (body.x + dx) % extent
        ny = (body.y + dy) % extent
        body.move_to(nx, ny)
        if body.shape == "rect":
            body.rotate_to(body.angle + rng.uniform(-0.25, 0.25))
        if rng.random() < 0.05:
            factor = rng.uniform(0.7, 1.3)
            body.set_scale(max(0.4, min(1.8, body.scale * factor)))

    # Re-add as many fresh bodies as were removed, keeping the population
    # roughly stationary and the insertion path covered.
    for _ in removed:
        x = rng.uniform(0.0, extent)
        y = rng.uniform(0.0, extent)
        if rng.random() < 0.5:
            world.add_circle(x, y, rng.uniform(8.0, 22.0))
        else:
            world.add_rect(x, y, rng.uniform(10.0, 26.0),
                           rng.uniform(8.0, 20.0),
                           rng.uniform(0.0, math.pi))
    return removed
