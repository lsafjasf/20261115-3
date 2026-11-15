"""Broad phase index correctness under move / scale / delete churn."""

import math
import random
import unittest

from collision import World
from collision.grid import aabb_overlap


def _brute_force_pairs(world: World):
    ids = sorted(world.bodies)
    pairs = set()
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            a = world.bodies[ids[i]]
            b = world.bodies[ids[j]]
            if aabb_overlap(a.aabb, b.aabb):
                pairs.add((ids[i], ids[j]))
    return pairs


class SpatialIndexTests(unittest.TestCase):
    def _populate(self, world: World, rng: random.Random, n: int = 120):
        for _ in range(n):
            x = rng.uniform(-200.0, 200.0)
            y = rng.uniform(-200.0, 200.0)
            if rng.random() < 0.5:
                world.add_circle(x, y, rng.uniform(6.0, 18.0))
            else:
                world.add_rect(x, y, rng.uniform(8.0, 20.0),
                               rng.uniform(6.0, 16.0),
                               rng.uniform(0.0, math.pi))

    def test_grid_matches_brute_force_after_churn(self):
        rng = random.Random(1234)
        world = World(backend="grid", cell_size=40.0)
        self._populate(world, rng)

        for frame in range(40):
            for body in list(world.bodies.values()):
                body.move_to(rng.uniform(-200.0, 200.0),
                             rng.uniform(-200.0, 200.0))
                if body.shape == "rect":
                    body.rotate_to(rng.uniform(0.0, math.pi))
                if rng.random() < 0.1:
                    body.set_scale(rng.uniform(0.5, 1.7))

            # Delete a random batch and add replacements.
            victims = rng.sample(list(world.bodies.values()),
                                 min(10, len(world.bodies)))
            for victim in victims:
                world.remove(victim)
            self._populate(world, rng, n=len(victims))

            indexed = set(world.candidate_pairs())
            self.assertEqual(indexed, _brute_force_pairs(world),
                             f"frame {frame} mismatch")

            # Every indexed body must be reachable through its cells.
            self.assertEqual(len(world.grid), len(world.bodies))

    def test_sap_matches_brute_force_after_churn(self):
        rng = random.Random(99)
        world = World(backend="sap")
        self._populate(world, rng)
        for frame in range(25):
            for body in list(world.bodies.values()):
                body.translate(rng.uniform(-15.0, 15.0),
                               rng.uniform(-15.0, 15.0))
            victim = rng.choice(list(world.bodies.values()))
            world.remove(victim)
            world.add_circle(rng.uniform(-200.0, 200.0),
                             rng.uniform(-200.0, 200.0), 10.0)
            self.assertEqual(set(world.candidate_pairs()),
                             _brute_force_pairs(world),
                             f"frame {frame} mismatch")

    def test_removal_drops_every_cell_reference(self):
        world = World(backend="grid", cell_size=20.0)
        body = world.add_circle(0.0, 0.0, 5.0)
        world.add_circle(3.0, 3.0, 5.0)
        occupied = set()
        for bucket in world.grid._cells.values():
            occupied.update(bucket)
        self.assertIn(body.body_id, occupied)
        world.remove(body)
        for bucket in world.grid._cells.values():
            self.assertNotIn(body.body_id, bucket)
        self.assertNotIn(body.body_id, world.grid._membership)

    def test_oversized_body_spans_multiple_cells(self):
        world = World(backend="grid", cell_size=10.0)
        body = world.add_rect(0.0, 0.0, 25.0, 25.0)
        self.assertGreater(len(world.grid._membership[body.body_id]), 1)
        # A point query inside its extent must still find it.
        self.assertIn(body.body_id, world.grid.query_point(20.0, 20.0))


if __name__ == "__main__":
    unittest.main()
