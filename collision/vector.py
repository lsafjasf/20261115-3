"""Minimal 2D vector helpers operating on plain ``(x, y)`` tuples.

Tuples are immutable and allocation-cheap, which keeps the broad-phase hot
loop fast without pulling in numpy.
"""

from __future__ import annotations

import math
from typing import Tuple

Vec2 = Tuple[float, float]


def add(a: Vec2, b: Vec2) -> Vec2:
    return (a[0] + b[0], a[1] + b[1])


def sub(a: Vec2, b: Vec2) -> Vec2:
    return (a[0] - b[0], a[1] - b[1])


def mul(a: Vec2, s: float) -> Vec2:
    return (a[0] * s, a[1] * s)


def dot(a: Vec2, b: Vec2) -> float:
    return a[0] * b[0] + a[1] * b[1]


def cross(a: Vec2, b: Vec2) -> float:
    """Scalar cross product of two 2D vectors."""
    return a[0] * b[1] - a[1] * b[0]


def length(a: Vec2) -> float:
    return math.hypot(a[0], a[1])


def length_sq(a: Vec2) -> float:
    return a[0] * a[0] + a[1] * a[1]


def normalize(a: Vec2) -> Vec2:
    mag = math.hypot(a[0], a[1])
    if mag == 0.0:
        return (0.0, 0.0)
    inv = 1.0 / mag
    return (a[0] * inv, a[1] * inv)


def rotate(a: Vec2, angle: float) -> Vec2:
    """Rotate vector ``a`` by ``angle`` radians (counter-clockwise)."""
    c = math.cos(angle)
    s = math.sin(angle)
    return (a[0] * c - a[1] * s, a[0] * s + a[1] * c)


def perp(a: Vec2) -> Vec2:
    """Left hand perpendicular of ``a`` (same length)."""
    return (-a[1], a[0])


def dist(a: Vec2, b: Vec2) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def dist_sq(a: Vec2, b: Vec2) -> float:
    dx = a[0] - b[0]
    dy = a[1] - b[1]
    return dx * dx + dy * dy


def clamp(x: float, lo: float, hi: float) -> float:
    if x < lo:
        return lo
    if x > hi:
        return hi
    return x
