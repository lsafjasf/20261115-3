"""End-to-end demo: generate, save, then load twice and verify equality."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from .rng import RandomSystem
from .savegame import load_game, save_game, world_fingerprint
from .world import generate_world


def _print_summary(title: str, summary: list[dict[str, Any]]) -> None:
    print(f"\n== {title} ==")
    for line in summary:
        ops = ", ".join(f"{op}x{count}" for op, count in line["ops"].items())
        print(
            f"  stream={line['stream']:<6} calls={line['calls']:<4} "
            f"ops={ops:<22} checksum={line['checksum']}"
        )


def _print_world_brief(world: dict[str, Any]) -> None:
    tiles = world["map"]["tiles"]
    print("\n== World brief ==")
    print(f"  map: {world['width']}x{world['height']}, "
          f"terrain head={tiles[:6]}")
    print(f"  spawn_order={world['map']['spawn_order']}")
    for poi in world["map"]["points_of_interest"][:3]:
        print(f"  poi: {poi}")
    for quest in world["quests"][:2]:
        print(f"  quest: {quest}")
    for sound in world["audio"][:2]:
        print(f"  audio: {sound}")


def demonstrate_isolation(seed: int) -> None:
    """Add extra map draws and show quest/audio stay identical."""
    base_rng = RandomSystem(seed)
    base_world = generate_world(base_rng, extra_map_calls=0)

    changed_rng = RandomSystem(seed)
    changed_world = generate_world(changed_rng, extra_map_calls=5)

    map_same = base_world["map"]["tiles"] == changed_world["map"]["tiles"]
    quest_same = base_world["quests"] == changed_world["quests"]
    audio_same = base_world["audio"] == changed_world["audio"]
    print("\n== Stream isolation (5 extra map-only calls added) ==")
    print(f"  map main layout unchanged : {map_same}")
    print(f"  map call count {base_rng.stream('map').calls} -> "
          f"{changed_rng.stream('map').calls}")
    print(f"  quest stream unchanged    : {quest_same}")
    print(f"  audio stream unchanged    : {audio_same}")
    assert map_same and quest_same and audio_same


def run(seed: int, save_path: Path) -> None:
    print(f"master seed: {seed}")
    print(f"save file  : {save_path}")

    rng = RandomSystem(seed)
    world = generate_world(rng, extra_map_calls=0)
    save_game(save_path, seed, rng, world)
    print(f"world fingerprint: {world_fingerprint(world)[:16]}...")
    _print_summary("Stream summary (fresh generation)", rng.summary())
    _print_world_brief(world)

    demonstrate_isolation(seed)

    # Two independent loads, each rebuilt from the saved call sequence.
    load_one = load_game(save_path)
    load_two = load_game(save_path)
    _print_summary("Stream summary (load #1 replay)", load_one["replayed_summary"])

    checks = {
        "map tiles": (
            load_one["world"]["map"]["tiles"]
            == load_two["world"]["map"]["tiles"]
            == world["map"]["tiles"]
        ),
        "map POIs": (
            load_one["world"]["map"]["points_of_interest"]
            == load_two["world"]["map"]["points_of_interest"]
            == world["map"]["points_of_interest"]
        ),
        "quests": (
            load_one["world"]["quests"]
            == load_two["world"]["quests"]
            == world["quests"]
        ),
        "audio variants": (
            load_one["world"]["audio"]
            == load_two["world"]["audio"]
            == world["audio"]
        ),
        "fingerprints": (
            load_one["fingerprint"]
            == load_two["fingerprint"]
            == world_fingerprint(world)
        ),
        "stream summaries": (
            load_one["replayed_summary"]
            == load_two["replayed_summary"]
            == rng.summary()
        ),
    }
    print("\n== Two-load verification ==")
    for name, ok in checks.items():
        print(f"  {name:<18} identical across both loads: {ok}")
        assert ok, name
    print("\nAll checks passed: reopening restores the exact same world.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=int, default=20261115)
    parser.add_argument(
        "--save",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "artifacts" / "save.json",
    )
    args = parser.parse_args()
    args.save.parent.mkdir(parents=True, exist_ok=True)
    run(args.seed, args.save)


if __name__ == "__main__":
    main()
