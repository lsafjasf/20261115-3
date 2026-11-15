"""End-to-end equivalence of brute / grid / SAP contact results."""

import math
import random
import unittest

from collision import Body, World


def _make_body(body_id: int, rng: random.Random):
    x, y = rng.uniform(-150, 150), rng.uniform(-150, 150)
    if rng.random() < 0.5:
        return Body.circle(body_id, x, y, rng.uniform(5, 18))
    return Body.rect(body_id, x, y, rng.uniform(6, 20),
                     rng.uniform(5, 16), rng.uniform(0, math.pi))


def _clone_body(template: Body, body_id: int) -> Body:
    if template.shape == "circle":
        body = Body.circle(body_id, template.x, template.y, template.r)
    else:
        body = Body.rect(body_id, template.x, template.y,
                         template.hw, template.hh, template.angle)
    body.scale = template.scale
    body.recompute()
    return body


def _snapshot(world: World):
    snapshot = {}
    for manifold in world.detect():
        key = tuple(sorted((manifold.a, manifold.b)))
        snapshot[key] = sorted(
            (round(c.point[0], 8), round(c.point[1], 8),
             round(c.normal[0], 8), round(c.normal[1], 8),
             round(c.penetration, 8))
            for c in manifold.contacts
        )
    return snapshot


class EquivalenceTests(unittest.TestCase):
    def test_all_backends_identical_through_churn(self):
        rng = random.Random(2024)
        worlds = {name: World(backend=name, cell_size=32.0)
                  for name in ("brute", "grid", "sap")}
        specs = [_make_body(body_id, rng) for body_id in range(150)]
        for world in worlds.values():
            for body in specs:
                world._add(_clone_body(body, body.body_id))

        for frame in range(30):
            reference = _snapshot(worlds["brute"])
            for name in ("grid", "sap"):
                self.assertEqual(_snapshot(worlds[name]), reference,
                                 f"{name} diverged on frame {frame}")

            # Plan the whole frame once, then replay it on every backend.
            move_rng = random.Random(8000 + frame)
            delete_rng = random.Random(9000 + frame)
            ordered_ids = sorted(worlds["brute"].bodies)
            moves = []
            for body_id in ordered_ids:
                moves.append((
                    body_id,
                    move_rng.uniform(-12, 12),
                    move_rng.uniform(-12, 12),
                    move_rng.uniform(-0.2, 0.2),
                    move_rng.random() < 0.08,
                    move_rng.uniform(0.8, 1.2),
                ))
            victim_id = delete_rng.choice(ordered_ids)
            replacement = _make_body(victim_id, delete_rng)

            for world in worlds.values():
                for body_id, dx, dy, spin, rescale, factor in moves:
                    body = world.bodies[body_id]
                    body.translate(dx, dy)
                    if body.shape == "rect":
                        body.rotate_to(body.angle + spin)
                    if rescale:
                        body.set_scale(
                            max(0.4, min(1.8, body.scale * factor)))
                world.remove(world.bodies[victim_id])
                world._add(_clone_body(replacement, victim_id))


if __name__ == "__main__":
    unittest.main()
