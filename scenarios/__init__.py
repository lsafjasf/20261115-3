"""Deterministic benchmark / correctness scenarios."""

from .scenarios import (
    SCENARIOS,
    ScenarioSpec,
    build_world,
    mutate_world,
)

__all__ = ["SCENARIOS", "ScenarioSpec", "build_world", "mutate_world"]
