"""Deterministic random system with independent named sub-streams.

One master seed derives one independent stream per game concern (map, quest,
audio...). Adding or removing a call inside one stream never shifts the layout
produced by the others, because every stream owns its own SplitMix64 state and
its own call counter.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

MASK64 = (1 << 64) - 1


def splitmix64(state: int) -> tuple[int, int]:
    """One SplitMix64 step, returning (next_state, output)."""
    state = (state + 0x9E3779B97F4A7C15) & MASK64
    z = state
    z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & MASK64
    z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & MASK64
    z = z ^ (z >> 31)
    return state, z


def _derive(seed: int, label: str) -> int:
    """Derive a stream's initial state from the master seed and its name."""
    h = seed & MASK64
    for byte in label.encode("utf-8"):
        h = splitmix64(h ^ byte)[0]
    return splitmix64(h)[1]


@dataclass
class CallEntry:
    stream: str
    op: str
    args: list[Any]
    result: Any

    def to_dict(self) -> dict[str, Any]:
        return {
            "stream": self.stream,
            "op": self.op,
            "args": self.args,
            "result": self.result,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "CallEntry":
        return cls(
            stream=data["stream"],
            op=data["op"],
            args=list(data["args"]),
            result=data["result"],
        )


class ReplayMismatch(RuntimeError):
    """Raised when a replayed call does not reproduce the recorded result."""


class RandomStream:
    """An independent SplitMix64 stream with a per-stream call counter."""

    def __init__(
        self,
        name: str,
        seed: int,
        system: "RandomSystem | None" = None,
        replay_log: "list[CallEntry] | None" = None,
    ) -> None:
        self.name = name
        self.seed = seed
        self.state = _derive(seed, name)
        self.calls = 0
        self.entries: list[CallEntry] = []
        self._system = system
        self._replay = replay_log
        self._replay_idx = 0

    def _next_u64(self) -> int:
        self.state, value = splitmix64(self.state)
        self.calls += 1
        return value

    def _record(self, op: str, args: list[Any], result: Any) -> Any:
        if self._replay is not None:
            if self._replay_idx >= len(self._replay):
                raise ReplayMismatch(
                    f"stream {self.name!r}: extra call {op!r} beyond replay log"
                )
            expected = self._replay[self._replay_idx]
            if (
                expected.op != op
                or expected.args != args
                or expected.result != result
            ):
                raise ReplayMismatch(
                    f"stream {self.name!r} call #{self._replay_idx} {op}: "
                    f"replayed {result!r} != recorded {expected.result!r}"
                )
            self._replay_idx += 1
        entry = CallEntry(self.name, op, args, result)
        self.entries.append(entry)
        if self._system is not None:
            self._system._append(entry)
        return result

    def u64(self) -> int:
        value = self._next_u64()
        return self._record("u64", [], value)

    def randint(self, low: int, high: int) -> int:
        if high < low:
            raise ValueError("high must be >= low")
        value = low + self._next_u64() % (high - low + 1)
        return self._record("randint", [low, high], value)

    def uniform(self, low: float, high: float) -> float:
        value = low + (self._next_u64() / (1 << 64)) * (high - low)
        return self._record("uniform", [low, high], value)

    def chance(self, probability: float) -> bool:
        value = (self._next_u64() / (1 << 64)) < probability
        return self._record("chance", [probability], value)

    def choice(self, sequence: list[Any]) -> Any:
        if not sequence:
            raise ValueError("cannot choose from an empty sequence")
        index = self._next_u64() % len(sequence)
        return self._record("choice", [list(sequence)], sequence[index])

    def weighted(self, items: list[Any], weights: list[float]) -> Any:
        if len(items) != len(weights) or not items:
            raise ValueError("items and weights must be non-empty and equal length")
        total = sum(weights)
        roll = (self._next_u64() / (1 << 64)) * total
        upto = 0.0
        for index, weight in enumerate(weights):
            upto += weight
            if roll < upto:
                return self._record("weighted", [list(weights)], items[index])
        return self._record("weighted", [list(weights)], items[-1])

    def shuffle(self, sequence: list[Any]) -> list[Any]:
        result = list(sequence)
        for index in range(len(result) - 1, 0, -1):
            swap = self._next_u64() % (index + 1)
            result[index], result[swap] = result[swap], result[index]
        return self._record("shuffle", [list(sequence)], result)

    def verify_replay_complete(self) -> None:
        if self._replay is not None and self._replay_idx != len(self._replay):
            raise ReplayMismatch(
                f"stream {self.name!r}: {len(self._replay) - self._replay_idx} "
                "recorded calls were never replayed"
            )


def stream_checksum(entries: list[CallEntry]) -> str:
    """Stable FNV-1a style checksum over a stream's recorded call sequence."""
    h = 0xCBF29CE484222325
    for entry in entries:
        payload = (
            entry.op
            + "|"
            + repr(entry.args)
            + "="
            + repr(entry.result)
            + ";"
        ).encode("utf-8")
        for byte in payload:
            h ^= byte
            h = (h * 0x100000001B3) & MASK64
    return f"{h:016x}"


class RandomSystem:
    """Holds the master seed, named sub-streams and the global call log."""

    def __init__(
        self, seed: int, replay: dict[str, list[CallEntry]] | None = None
    ):
        self.seed = int(seed)
        self._replay = replay
        self.streams: dict[str, RandomStream] = {}
        self.global_log: list[CallEntry] = []

    def stream(self, name: str) -> RandomStream:
        if name not in self.streams:
            replay_log = None
            if self._replay is not None:
                if name not in self._replay:
                    raise ReplayMismatch(f"stream {name!r} missing from replay log")
                replay_log = self._replay[name]
            self.streams[name] = RandomStream(
                name, self.seed, system=self, replay_log=replay_log
            )
        return self.streams[name]

    def _append(self, entry: CallEntry) -> None:
        self.global_log.append(entry)

    def verify_replay_complete(self) -> None:
        if self._replay is not None:
            missing = set(self._replay) - set(self.streams)
            if missing:
                raise ReplayMismatch(f"streams never replayed: {sorted(missing)}")
        for sub in self.streams.values():
            sub.verify_replay_complete()

    def summary(self) -> list[dict[str, Any]]:
        """Per-stream summary: call count, op histogram and checksum."""
        lines: list[dict[str, Any]] = []
        for name in sorted(self.streams):
            sub = self.streams[name]
            histogram: dict[str, int] = {}
            for entry in sub.entries:
                histogram[entry.op] = histogram.get(entry.op, 0) + 1
            lines.append(
                {
                    "stream": name,
                    "calls": sub.calls,
                    "ops": dict(sorted(histogram.items())),
                    "checksum": stream_checksum(sub.entries),
                }
            )
        return lines

    def snapshot(self) -> dict[str, Any]:
        per_stream: dict[str, list[dict[str, Any]]] = {}
        for name, sub in self.streams.items():
            per_stream[name] = [entry.to_dict() for entry in sub.entries]
        return {
            "seed": self.seed,
            "total_calls": len(self.global_log),
            "streams": per_stream,
            "summary": self.summary(),
        }

    @classmethod
    def from_snapshot(cls, data: dict[str, Any]) -> "RandomSystem":
        replay: dict[str, list[CallEntry]] = {}
        for name, raw_entries in data["streams"].items():
            replay[name] = [CallEntry.from_dict(item) for item in raw_entries]
        return cls(data["seed"], replay=replay)
