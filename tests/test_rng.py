import json
import unittest

from game.rng import RandomSystem, ReplayMismatch, stream_checksum
from game.world import generate_world
from game.savegame import build_save, world_fingerprint, load_game


class RngTests(unittest.TestCase):
    def test_same_seed_reproduces_streams(self):
        a = RandomSystem(123)
        b = RandomSystem(123)
        for _ in range(5):
            a.stream("map").randint(0, 99)
            a.stream("quest").choice(["x", "y"])
        for _ in range(5):
            b.stream("map").randint(0, 99)
            b.stream("quest").choice(["x", "y"])
        self.assertEqual(
            [e.result for e in a.stream("map").entries],
            [e.result for e in b.stream("map").entries],
        )

    def test_streams_are_independent(self):
        base = RandomSystem(7)
        base_world = generate_world(base)
        changed = RandomSystem(7)
        changed_world = generate_world(changed, extra_map_calls=4)
        self.assertEqual(base_world["quests"], changed_world["quests"])
        self.assertEqual(base_world["audio"], changed_world["audio"])
        self.assertEqual(base_world["map"]["tiles"], changed_world["map"]["tiles"])
        self.assertGreater(
            changed.stream("map").calls, base.stream("map").calls
        )

    def test_snapshot_replay_roundtrip(self):
        rng = RandomSystem(99)
        world = generate_world(rng)
        save = build_save(99, rng, world)
        replayed = RandomSystem.from_snapshot(save["rng"])
        rebuilt = generate_world(replayed)
        replayed.verify_replay_complete()
        self.assertEqual(world_fingerprint(rebuilt), save["world_fingerprint"])
        self.assertEqual(replayed.summary(), rng.summary())
        self.assertTrue(json.dumps(save))  # JSON-serializable

    def test_tampering_is_detected(self):
        rng = RandomSystem(55)
        world = generate_world(rng)
        save = build_save(55, rng, world)
        save["rng"]["streams"]["quest"][0]["result"] = "__tampered__"
        bad_rng = RandomSystem.from_snapshot(save["rng"])
        with self.assertRaises(ReplayMismatch):
            generate_world(bad_rng)

    def test_different_seeds_diverge(self):
        w1 = generate_world(RandomSystem(1))
        w2 = generate_world(RandomSystem(2))
        self.assertNotEqual(
            world_fingerprint(w1), world_fingerprint(w2)
        )

    def test_checksum_stable_and_distinct(self):
        rng = RandomSystem(31)
        generate_world(rng)
        summaries = rng.summary()
        checksums = {line["stream"]: line["checksum"] for line in summaries}
        self.assertEqual(len(set(checksums.values())), 3)
        self.assertEqual(
            checksums["map"], stream_checksum(rng.stream("map").entries)
        )


if __name__ == "__main__":
    unittest.main()
