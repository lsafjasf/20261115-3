"""Load-only entry point used to verify restoration from a fresh process."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .savegame import load_game


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("save_path", type=Path)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    result = load_game(args.save_path)
    payload = {
        "seed": result["seed"],
        "fingerprint": result["fingerprint"],
        "summary": result["replayed_summary"],
        "map_head": result["world"]["map"]["tiles"][:12],
        "spawn_order": result["world"]["map"]["spawn_order"],
        "quests": result["world"]["quests"],
        "audio": result["world"]["audio"],
    }
    text = json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2)
    if args.out:
        args.out.write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
