"""Rigid bodies used by the collision world.

Two shapes are supported:

* ``"circle"``          -- a disc with radius ``r``.
* ``"rect"``            -- a rectangle with half extents ``(hw, hh)`` that can
                           be rotated by ``angle`` radians.

Every body caches an axis aligned bounding box (``aabb``). The AABB is the
only information the broad phase needs, and it is recomputed lazily whenever a
transform changes so that the spatial index never works with stale bounds.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

from . import vector as v

AABB = Tuple[float, float, float, float]  # (min_x, min_y, max_x, max_y)
_CACHE_SENTINEL = object()


@dataclass
class Body:
    body_id: int
    shape: str
    x: float = 0.0
    y: float = 0.0
    angle: float = 0.0
    # Radius for circles; half width / half height for rects (local space).
    r: float = 0.0
    hw: float = 0.0
    hh: float = 0.0
    scale: float = 1.0
    user_data: object = None
    aabb: AABB = (-1.0, -1.0, 1.0, 1.0)
    # Back reference set by World when the body is inserted.
    _world: Optional["object"] = field(default=None, repr=False)
    # Cached derived geometry, invalidated on every transform change.
    _cached_vertices: object = field(default=_CACHE_SENTINEL, repr=False)
    _cached_axes: object = field(default=_CACHE_SENTINEL, repr=False)

    # ------------------------------------------------------------------ #
    # Construction
    # ------------------------------------------------------------------ #
    @classmethod
    def circle(cls, body_id: int, x: float, y: float, radius: float,
               user_data: object = None) -> "Body":
        body = cls(body_id=body_id, shape="circle", x=x, y=y, r=radius,
                   user_data=user_data)
        body.recompute()
        return body

    @classmethod
    def rect(cls, body_id: int, x: float, y: float, hw: float, hh: float,
             angle: float = 0.0, user_data: object = None) -> "Body":
        body = cls(body_id=body_id, shape="rect", x=x, y=y, hw=hw, hh=hh,
                   angle=angle, user_data=user_data)
        body.recompute()
        return body

    # ------------------------------------------------------------------ #
    # Mutating transforms -- each one keeps AABB + spatial index in sync.
    # ------------------------------------------------------------------ #
    def move_to(self, x: float, y: float) -> None:
        self.x = float(x)
        self._after_transform()


    def translate(self, dx: float, dy: float) -> None:
        self.x += dx
        self.y += dy
        self._after_transform()

    def rotate_to(self, angle: float) -> None:
        self.angle = float(angle)
        self._after_transform()

    def set_scale(self, scale: float) -> None:
        if scale <= 0.0:
            raise ValueError("scale must be positive")
        self.scale = float(scale)
        self._after_transform()

    def recompute(self) -> None:
        """Recompute the cached AABB from the current transform."""
        self.aabb = self.compute_aabb()
        self._cached_vertices = _CACHE_SENTINEL
        self._cached_axes = _CACHE_SENTINEL

    def _after_transform(self) -> None:
        old = self.aabb
        self.recompute()
        if self._world is not None:
            self._world._on_body_moved(self, old)

    # ------------------------------------------------------------------ #
    # Geometry
    # ------------------------------------------------------------------ #
    @property
    def position(self) -> v.Vec2:
        return (self.x, self.y)

    def radius(self) -> float:
        """Effective world-space radius (circles only)."""
        return self.r * self.scale

    def half_extents(self) -> Tuple[float, float]:
        """Effective world-space half extents (rects only)."""
        return (self.hw * self.scale, self.hh * self.scale)

    def compute_aabb(self) -> AABB:
        if self.shape == "circle":
            radius = self.radius()
            return (self.x - radius, self.y - radius,
                    self.x + radius, self.y + radius)
        hw, hh = self.half_extents()
        c = abs(math.cos(self.angle))
        s = abs(math.sin(self.angle))
        # Projection of the rotated local axes onto the global X/Y axes.
        extent_x = hw * c + hh * s
        extent_y = hw * s + hh * c
        return (self.x - extent_x, self.y - extent_y,
                self.x + extent_x, self.y + extent_y)

    def world_vertices(self) -> List[v.Vec2]:
        """Rectangle corners in world space, CCW starting at (-hw, -hh)."""
        if self.shape != "rect":
            raise ValueError("world_vertices is only valid for rects")
        if self._cached_vertices is not _CACHE_SENTINEL:
            return self._cached_vertices
        hw, hh = self.half_extents()
        center = (self.x, self.y)
        vertices = [
            v.add(center, v.rotate((-hw, -hh), self.angle)),
            v.add(center, v.rotate((hw, -hh), self.angle)),
            v.add(center, v.rotate((hw, hh), self.angle)),
            v.add(center, v.rotate((-hw, hh), self.angle)),
        ]
        self._cached_vertices = vertices
        return vertices

    def world_axes(self) -> List[v.Vec2]:
        """Unit face normals of a rectangle in world space."""
        if self._cached_axes is not _CACHE_SENTINEL:
            return self._cached_axes
        vertices = self.world_vertices()
        axes = []
        for i in range(len(vertices)):
            edge = v.sub(vertices[(i + 1) % len(vertices)], vertices[i])
            axes.append(v.normalize(v.perp(edge)))
        self._cached_axes = axes
        return axes
