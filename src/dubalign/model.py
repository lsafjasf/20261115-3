"""Project data model for sentence-level dub alignment.

A project holds the source sentence segments plus per-segment user edits.
Every segment is rendered independently from its own source WAV, so changing
one segment can never alter any other segment's audio or timeline position.
"""

from __future__ import annotations

import math
import dataclasses
from dataclasses import dataclass, field, asdict


DEFAULT_TOLERANCE = 0.10  # allowed |rate - 1|, i.e. +/-10% speech rate


@dataclass
class Segment:
    id: str
    text: str
    source_wav: str
    source_start: float  # seconds, position in the original source timeline
    source_duration: float
    target_start: float  # seconds, desired start on the picture timeline
    rate: float = 1.0  # 1 = original speed; <1 faster, >1 slower
    pause_after: float = 0.0  # seconds of silence inserted after this sentence

    def validate(self, tolerance: float) -> list[str]:
        errors: list[str] = []
        if self.source_duration <= 0:
            errors.append(f"{self.id}: source_duration must be positive")
        if self.target_start < 0:
            errors.append(f"{self.id}: target_start must be >= 0")
        if self.pause_after < 0:
            errors.append(f"{self.id}: pause_after must be >= 0")
        if not math.isfinite(self.rate) or self.rate <= 0:
            errors.append(f"{self.id}: rate must be a positive number")
        elif abs(self.rate - 1.0) > tolerance + 1e-9:
            errors.append(
                f"{self.id}: rate {self.rate:.3f} exceeds tolerance "
                f"1.0 +/- {tolerance:.2f}"
            )
        return errors

    @property
    def stretch_factor(self) -> float:
        # rate is the user-facing playback-speed multiplier (0.9 = 10% faster).
        return 1.0 / self.rate

    @property
    def rendered_duration(self) -> float:
        return self.source_duration * self.stretch_factor

    @property
    def end(self) -> float:
        return self.target_start + self.rendered_duration + self.pause_after


@dataclass
class Project:
    name: str
    sample_rate: int
    tolerance: float = DEFAULT_TOLERANCE
    segments: list[Segment] = field(default_factory=list)

    def validate(self) -> list[str]:
        errors: list[str] = []
        ids = [s.id for s in self.segments]
        if len(ids) != len(set(ids)):
            errors.append("segment ids must be unique")
        for seg in self.segments:
            errors.extend(seg.validate(self.tolerance))
        if not any("unique" in e for e in errors):
            ordered = sorted(self.segments, key=lambda s: s.target_start)
            for prev, nxt in zip(ordered, ordered[1:]):
                if nxt.target_start < prev.target_start + prev.rendered_duration:
                    errors.append(
                        f"overlap: {prev.id} speech ends at "
                        f"{prev.target_start + prev.rendered_duration:.3f}s but "
                        f"{nxt.id} starts at {nxt.target_start:.3f}s"
                    )
        return errors

    def to_dict(self) -> dict:
        data = asdict(self)
        data["schema"] = "dubalign/project-1"
        return data

    @classmethod
    def from_dict(cls, data: dict) -> "Project":
        allowed = {f.name for f in dataclasses.fields(Segment)}
        segs = [
            Segment(**{k: v for k, v in item.items() if k in allowed})
            for item in data.get("segments", [])
        ]
        return cls(
            name=data["name"],
            sample_rate=int(data["sample_rate"]),
            tolerance=float(data.get("tolerance", DEFAULT_TOLERANCE)),
            segments=segs,
        )
