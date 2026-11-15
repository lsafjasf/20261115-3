"""Narrow phase: exact shape tests and contact manifold generation.

Shapes are either circles or convex polygons (rotated rectangles). The
separating axis theorem (SAT) decides overlap; contact points are then built
with the standard clipping routine for polygon/polygon and closest-feature
logic for anything involving a circle.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

from . import vector as v
from .body import Body

EPS = 1e-9


@dataclass(frozen=True)
class Contact:
    """A single contact point between two bodies.

    ``normal`` points from body ``a`` toward body ``b``; ``penetration`` is
    positive when the shapes overlap. ``point`` is the world-space contact.
    """
    a: int
    b: int
    point: v.Vec2
    normal: v.Vec2
    penetration: float


@dataclass
class Manifold:
    a: int
    b: int
    contacts: List[Contact] = field(default_factory=list)

    @property
    def touching(self) -> bool:
        return bool(self.contacts)


# ---------------------------------------------------------------------- #
# SAT primitives
# ---------------------------------------------------------------------- #
def _project(vertices: List[v.Vec2], axis: v.Vec2) -> Tuple[float, float]:
    lo = hi = v.dot(vertices[0], axis)
    for point in vertices[1:]:
        projection = v.dot(point, axis)
        if projection < lo:
            lo = projection
        elif projection > hi:
            hi = projection
    return lo, hi


def _polygon_axes(vertices: List[v.Vec2]) -> List[v.Vec2]:
    # Rectangles cache their two unique normals; keep only distinct axes.
    axes: List[v.Vec2] = []
    count = len(vertices)
    for i in range(count):
        edge = v.sub(vertices[(i + 1) % count], vertices[i])
        axis = v.normalize(v.perp(edge))
        if all(abs(v.dot(axis, existing)) < 1.0 - 1e-9 for existing in axes):
            axes.append(axis)
    return axes


def _overlap(lo_a: float, hi_a: float, lo_b: float, hi_b: float) -> float:
    return min(hi_a, hi_b) - max(lo_a, lo_b)


# ---------------------------------------------------------------------- #
# Shape accessors
# ---------------------------------------------------------------------- #
def _polygon_vertices(body: Body) -> List[v.Vec2]:
    return body.world_vertices()


def _axes_for(body: Body, vertices: List[v.Vec2]) -> List[v.Vec2]:
    if body.shape == "rect":
        return list(body.world_axes())
    return _polygon_axes(vertices)


# ---------------------------------------------------------------------- #
# Public entry point
# ---------------------------------------------------------------------- #
def collide(body_a: Body, body_b: Body) -> Optional[Manifold]:
    if body_a.shape == "circle" and body_b.shape == "circle":
        return _circle_circle(body_a, body_b)
    if body_a.shape == "circle":
        return _circle_polygon(body_a, body_b)
    if body_b.shape == "circle":
        manifold = _circle_polygon(body_b, body_a)
        if manifold is None:
            return None
        # Flip ordering and normals back to (body_a, body_b).
        return _flip_manifold(manifold, body_a.body_id, body_b.body_id)
    return _polygon_polygon(body_a, body_b)


def _flip_manifold(manifold: Manifold, id_a: int, id_b: int) -> Manifold:
    flipped = Manifold(id_a, id_b)
    for contact in manifold.contacts:
        flipped.contacts.append(Contact(
            a=id_a,
            b=id_b,
            point=contact.point,
            normal=(-contact.normal[0], -contact.normal[1]),
            penetration=contact.penetration,
        ))
    return flipped


# ---------------------------------------------------------------------- #
# Circle / circle
# ---------------------------------------------------------------------- #
def _circle_circle(a: Body, b: Body) -> Optional[Manifold]:
    delta = v.sub(b.position, a.position)
    distance_sq = v.length_sq(delta)
    radius_a = a.radius()
    radius_b = b.radius()
    radius_sum = radius_a + radius_b
    if distance_sq > radius_sum * radius_sum + EPS:
        return None

    if distance_sq > EPS:
        distance = math.sqrt(distance_sq)
        normal = (delta[0] / distance, delta[1] / distance)
        penetration = radius_sum - distance
    else:
        # Coincident centres: pick an arbitrary but stable axis.
        normal = (1.0, 0.0)
        penetration = radius_sum
        distance = 0.0

    point = (a.x + normal[0] * radius_a, a.y + normal[1] * radius_a)
    if distance_sq <= EPS:
        point = a.position
    return Manifold(a.body_id, b.body_id, [
        Contact(a.body_id, b.body_id, point, normal, penetration)
    ])


# ---------------------------------------------------------------------- #
# Circle / polygon
# ---------------------------------------------------------------------- #
def _circle_polygon(circle: Body, polygon: Body) -> Optional[Manifold]:
    vertices = _polygon_vertices(polygon)
    axes = _axes_for(polygon, vertices)
    center = circle.position
    radius = circle.radius()

    # Axis from the closest polygon vertex to the circle centre.
    closest_vertex = min(vertices, key=lambda p: v.dist_sq(p, center))
    toward = v.sub(center, closest_vertex)
    if v.length_sq(toward) > EPS:
        axes.append(v.normalize(toward))

    best_overlap = math.inf
    best_axis: Optional[v.Vec2] = None
    contained = True
    for axis in axes:
        plo, phi = _project(vertices, axis)
        center_projection = v.dot(center, axis)
        clo, chi = center_projection - radius, center_projection + radius
        overlap = _overlap(plo, phi, clo, chi)
        if overlap < -EPS:
            return None
        # The circle is fully contained only if its projection lies inside
        # the polygon projection on every tested axis.
        if clo < plo - EPS or chi > phi + EPS:
            contained = False
        if overlap < best_overlap:
            best_overlap = overlap
            best_axis = axis

    assert best_axis is not None
    # Orient normal so it points from the circle toward the polygon.
    if v.dot(best_axis, v.sub(polygon.position, center)) < 0.0:
        best_axis = (-best_axis[0], -best_axis[1])

    # Closest point on the polygon boundary to the circle centre.
    closest_point = _closest_point_on_polygon(center, vertices)
    delta = v.sub(closest_point, center)
    if v.length_sq(delta) > EPS and not contained:
        outward = v.normalize(delta)
        point = v.add(center, v.mul(outward, radius))
        penetration = radius - v.length(delta)
        normal = outward  # circle -> polygon
    else:
        # Centre inside the polygon (fully contained): push out along the
        # SAT axis toward the nearest face.
        point = center
        normal = best_axis
        if contained:
            penetration = radius + best_overlap
        else:
            penetration = max(best_overlap, EPS)

    if penetration < -EPS:
        return None
    return Manifold(circle.body_id, polygon.body_id, [
        Contact(circle.body_id, polygon.body_id, point, normal,
                max(penetration, 0.0))
    ])


def _closest_point_on_polygon(point: v.Vec2,
                              vertices: List[v.Vec2]) -> v.Vec2:
    best = vertices[0]
    best_distance_sq = math.inf
    count = len(vertices)
    for i in range(count):
        start = vertices[i]
        end = vertices[(i + 1) % count]
        candidate = _closest_point_on_segment(point, start, end)
        distance_sq = v.dist_sq(candidate, point)
        if distance_sq < best_distance_sq:
            best_distance_sq = distance_sq
            best = candidate
    return best


def _closest_point_on_segment(point: v.Vec2, start: v.Vec2,
                              end: v.Vec2) -> v.Vec2:
    segment = v.sub(end, start)
    length_sq = v.length_sq(segment)
    if length_sq <= EPS:
        return start
    t = v.dot(v.sub(point, start), segment) / length_sq
    t = v.clamp(t, 0.0, 1.0)
    return v.add(start, v.mul(segment, t))


# ---------------------------------------------------------------------- #
# Polygon / polygon (SAT + incident-face clipping)
# ---------------------------------------------------------------------- #
def _polygon_polygon(a: Body, b: Body) -> Optional[Manifold]:
    vertices_a = _polygon_vertices(a)
    vertices_b = _polygon_vertices(b)
    axes_a = _axes_for(a, vertices_a)
    axes_b = _axes_for(b, vertices_b)
    axes = axes_a + axes_b

    best_overlap = math.inf
    best_index = -1
    flip = False
    for index, axis in enumerate(axes):
        alo, ahi = _project(vertices_a, axis)
        blo, bhi = _project(vertices_b, axis)
        overlap = _overlap(alo, ahi, blo, bhi)
        if overlap < -EPS:
            return None
        if overlap < best_overlap:
            best_overlap = overlap
            best_index = index
            # Reference face should belong to body A; note if it was B's axis.
            flip = index >= len(axes_a)

    reference_normal = axes[best_index]
    if flip:
        reference_normal = (-reference_normal[0], -reference_normal[1])
    # Normal must point from A toward B.
    if v.dot(reference_normal, v.sub(b.position, a.position)) < 0.0:
        reference_normal = (-reference_normal[0], -reference_normal[1])

    reference_vertices = vertices_a if not flip else vertices_b
    incident_vertices = vertices_b if not flip else vertices_a
    incident = _incident_face(incident_vertices, reference_normal)
    reference_index = _face_index(reference_vertices, reference_normal)
    contacts = _clip_contact(
        reference_vertices, reference_index, reference_normal, incident,
    )
    manifold = Manifold(a.body_id, b.body_id)
    for point in contacts:
        manifold.contacts.append(Contact(
            a.body_id, b.body_id, point, reference_normal, best_overlap
        ))
    if not manifold.contacts:
        # Degenerate configuration: fall back to a single midpoint contact.
        midpoint = v.mul(v.add(a.position, b.position), 0.5)
        manifold.contacts.append(Contact(
            a.body_id, b.body_id, midpoint, reference_normal, best_overlap
        ))
    return manifold


def _face_index(vertices: List[v.Vec2], normal: v.Vec2) -> int:
    best_index = 0
    best_dot = -math.inf
    count = len(vertices)
    for i in range(count):
        edge = v.sub(vertices[(i + 1) % count], vertices[i])
        face_normal = v.normalize(v.perp(edge))
        score = v.dot(face_normal, normal)
        if score > best_dot:
            best_dot = score
            best_index = i
    return best_index


def _incident_face(vertices: List[v.Vec2],
                   reference_normal: v.Vec2) -> List[v.Vec2]:
    # The incident face normal is the one most anti-parallel to reference.
    opposite = (-reference_normal[0], -reference_normal[1])
    index = _face_index(vertices, opposite)
    count = len(vertices)
    return [vertices[index], vertices[(index + 1) % count]]


def _clip_contact(reference_vertices: List[v.Vec2], reference_index: int,
                  collision_normal: v.Vec2,
                  incident: List[v.Vec2]) -> List[v.Vec2]:
    count = len(reference_vertices)
    v1 = reference_vertices[reference_index]
    v2 = reference_vertices[(reference_index + 1) % count]
    tangent = v.normalize(v.sub(v2, v1))
    # Outward normal of the CCW reference face: right perpendicular of the
    # edge direction. ``collision_normal`` points A -> B and is only used by
    # the caller; clipping depth needs the face's own outward normal.
    face_normal = (tangent[1], -tangent[0])

    # Clip the incident edge against the two side planes of the reference face.
    clipped = _clip_to_line(incident, tangent, v.dot(tangent, v1))
    if len(clipped) < 2:
        return []
    clipped = _clip_to_line(clipped, (-tangent[0], -tangent[1]),
                            -v.dot(tangent, v2))
    if len(clipped) < 2:
        return []

    reference_distance = v.dot(face_normal, v1)
    points: List[v.Vec2] = []
    for point in clipped:
        depth = reference_distance - v.dot(face_normal, point)
        if depth >= -EPS:
            # Project the incident point onto the reference face.
            points.append(v.add(point, v.mul(face_normal, depth)))
    return _dedupe_points(points)


def _dedupe_points(points: List[v.Vec2]) -> List[v.Vec2]:
    unique: List[v.Vec2] = []
    for point in points:
        if all(v.dist_sq(point, existing) > 1e-12 for existing in unique):
            unique.append(point)
    return unique


def _clip_to_line(points: List[v.Vec2], normal: v.Vec2,
                  offset: float) -> List[v.Vec2]:
    if len(points) < 2:
        return []
    result: List[v.Vec2] = []
    count = len(points)
    for i in range(count):
        current = points[i]
        previous = points[i - 1]
        current_inside = v.dot(normal, current) - offset >= -EPS
        previous_inside = v.dot(normal, previous) - offset >= -EPS
        if current_inside:
            if not previous_inside:
                result.append(_line_intersection(previous, current,
                                                  normal, offset))
            result.append(current)
        elif previous_inside:
            result.append(_line_intersection(previous, current,
                                              normal, offset))
    return result


def _line_intersection(start: v.Vec2, end: v.Vec2, normal: v.Vec2,
                       offset: float) -> v.Vec2:
    direction = v.sub(end, start)
    denominator = v.dot(normal, direction)
    if abs(denominator) <= EPS:
        return start
    t = (offset - v.dot(normal, start)) / denominator
    return v.add(start, v.mul(direction, t))
