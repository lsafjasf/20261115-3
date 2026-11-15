"""Command line interface for dub alignment edits and export."""

from __future__ import annotations

import argparse
import json

from .model import Project
from .render import export_all, build_vtt


def load_project(path: str) -> Project:
    with open(path, encoding="utf-8") as fh:
        return Project.from_dict(json.load(fh))


def save_project(project: Project, path: str) -> None:
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(project.to_dict(), fh, ensure_ascii=False, indent=2)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="dubalign")
    sub = parser.add_subparsers(dest="cmd", required=True)

    edit = sub.add_parser("edit", help="edit one sentence without touching others")
    edit.add_argument("project")
    edit.add_argument("segment_id")
    edit.add_argument("--start", type=float)
    edit.add_argument("--rate", type=float)
    edit.add_argument("--pause", type=float)
    edit.add_argument("--out", required=True)

    exp = sub.add_parser("export", help="render WAV + WebVTT + project JSON")
    exp.add_argument("project")
    exp.add_argument("--wav", required=True)
    exp.add_argument("--vtt", required=True)
    exp.add_argument("--json", dest="json_path", required=True)

    vtt = sub.add_parser("vtt", help="print WebVTT for a project")
    vtt.add_argument("project")

    args = parser.parse_args(argv)
    if args.cmd == "edit":
        project = load_project(args.project)
        match = next((s for s in project.segments if s.id == args.segment_id), None)
        if match is None:
            parser.error(f"unknown segment {args.segment_id}")
        if args.start is not None:
            match.target_start = args.start
        if args.rate is not None:
            match.rate = args.rate
        if args.pause is not None:
            match.pause_after = args.pause
        errors = project.validate()
        if errors:
            parser.error("; ".join(errors))
        save_project(project, args.out)
        print(f"edited {args.segment_id} -> {args.out}")
        return 0

    project = load_project(args.project)
    if args.cmd == "vtt":
        print(build_vtt(project), end="")
        return 0

    payload = export_all(project, args.wav, args.vtt, args.json_path)
    print(f"exported {args.wav}, {args.vtt}, {args.json_path}")
    for item in payload["rendered"]:
        print(
            f"  {item['id']}: start={item['target_start']:.3f}s "
            f"rate={item['rate_requested']} (measured {item['rate_measured']:.4f}) "
            f"dur={item['rendered_duration']:.3f}s pause={item['pause_after']}s"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
