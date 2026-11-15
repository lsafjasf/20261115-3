"""World generation driven by three independent random sub-streams.

Each concern only draws from its own stream, so inserting an extra map call
cannot shift quest or audio output (and vice versa).
"""

from __future__ import annotations

from typing import Any

from .rng import RandomSystem

WIDTH = 12
HEIGHT = 8

TERRAIN = ["grass", "forest", "water", "mountain", "sand"]
TERRAIN_WEIGHTS = [46, 24, 12, 8, 10]
POI_KINDS = ["shrine", "village", "ruins", "tower", "camp"]

QUEST_TYPES = ["collect", "hunt", "escort"]
QUEST_TARGETS = ["herbs", "crystals", "relics", "boars", "wolves", "merchants"]

SOUND_EVENTS = ["footstep", "wind", "combat", "ui_click", "ambient"]
SOUND_PALETTES = ["synth", "orchestral", "chiptune", "percussive"]


def generate_world(
    rng: RandomSystem, extra_map_calls: int = 0
) -> dict[str, Any]:
    """Generate the full world and return a JSON-serializable description."""
    return {
        "width": WIDTH,
        "height": HEIGHT,
        "map": _generate_map(rng, extra_map_calls),
        "quests": _generate_quests(rng),
        "audio": _generate_audio(rng),
    }


def _generate_map(rng: RandomSystem, extra_calls: int) -> dict[str, Any]:
    stream = rng.stream("map")
    tiles = [
        stream.weighted(TERRAIN, TERRAIN_WEIGHTS)
        for _ in range(WIDTH * HEIGHT)
    ]
    spawn_candidates = stream.shuffle([0, 1, 2, 3, 4])
    points_of_interest = []
    for index in range(5):
        points_of_interest.append(
            {
                "id": index,
                "kind": stream.choice(POI_KINDS),
                "x": stream.randint(0, WIDTH - 1),
                "y": stream.randint(0, HEIGHT - 1),
            }
        )
    # Extra draws intentionally used to prove stream isolation.
    padding = [stream.randint(0, 99) for _ in range(extra_calls)]
    return {
        "tiles": tiles,
        "spawn_order": spawn_candidates,
        "points_of_interest": points_of_interest,
        "extra_calls": padding,
    }


def _generate_quests(rng: RandomSystem) -> list[dict[str, Any]]:
    stream = rng.stream("quest")
    quests: list[dict[str, Any]] = []
    for index in range(4):
        kind = stream.choice(QUEST_TYPES)
        target = stream.choice(QUEST_TARGETS)
        quests.append(
            {
                "id": index,
                "kind": kind,
                "target": target,
                "count": stream.randint(1, 9),
                "reward_gold": stream.randint(20, 200),
                "difficulty": stream.weighted(
                    ["easy", "normal", "hard"], [3, 5, 2]
                ),
            }
        )
    return quests


def _generate_audio(rng: RandomSystem) -> list[dict[str, Any]]:
    stream = rng.stream("audio")
    variants: list[dict[str, Any]] = []
    for event in SOUND_EVENTS:
        palette = stream.choice(SOUND_PALETTES)
        pitch = round(stream.uniform(0.8, 1.25), 4)
        loop = stream.chance(0.35)
        variants.append(
            {
                "event": event,
                "palette": palette,
                "pitch": pitch,
                "loop": loop,
                "variant_id": stream.randint(1000, 9999),
            }
        )
    return variants
