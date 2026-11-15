"""Turn a 1-pixel skeleton into a graph and extract vector polyline paths."""

from __future__ import annotations

from dataclasses import dataclass, field
from math import hypot

import numpy as np

_OFFSETS = (
    (-1, -1), (-1, 0), (-1, 1),
    (0, -1),           (0, 1),
    (1, -1),  (1, 0),  (1, 1),
)


def _neighbours(coord: tuple[int, int], skel_set: set[tuple[int, int]]):
    r, c = coord
    return [
        (r + dr, c + dc)
        for dr, dc in _OFFSETS
        if (r + dr, c + dc) in skel_set
    ]


def path_length(points: list[tuple[float, float]]) -> float:
    total = 0.0
    for (x1, y1), (x2, y2) in zip(points, points[1:]):
        total += hypot(x2 - x1, y2 - y1)
    return total


def rdp(points: list[tuple[float, float]], epsilon: float) -> list[tuple[float, float]]:
    """Ramer-Douglas-Peucker polyline simplification."""
    if len(points) < 3:
        return list(points)
    start, end = np.array(points[0], float), np.array(points[-1], float)
    line = end - start
    norm = float(np.hypot(*line))
    if norm == 0.0:
        dists = [float(np.hypot(*(np.array(p, float) - start))) for p in points]
    else:
        dists = [
            float(
                abs(line[0] * (p[1] - start[1]) - line[1] * (p[0] - start[0]))
                / norm
            )
            for p in points
        ]
    index = int(np.argmax(dists))
    if dists[index] > epsilon:
        left = rdp(points[: index + 1], epsilon)
        right = rdp(points[index:], epsilon)
        return left[:-1] + right
    return [points[0], points[-1]]


@dataclass
class Edge:
    a: tuple[int, int]
    b: tuple[int, int]
    path: list[tuple[int, int]]
    length: float = 0.0
    width: float = 1.0


@dataclass
class SkeletonGraph:
    nodes: set[tuple[int, int]] = field(default_factory=set)
    edges: list[Edge] = field(default_factory=list)


def build_graph(skel: np.ndarray) -> SkeletonGraph:
    """Build a node/edge graph from a binary skeleton image.

    All internal coordinates are skeleton pixels ``(row, col)``; they are
    converted to SVG geometry ``(x, y)`` only on the returned edge paths.
    """
    rows, cols = np.nonzero(skel > 0)
    skel_set: set[tuple[int, int]] = set(zip(rows.tolist(), cols.tolist()))
    degree: dict[tuple[int, int], int] = {
        p: len(_neighbours(p, skel_set)) for p in skel_set
    }
    raw_nodes = {p for p, d in degree.items() if d != 2}

    # Merge 8-connected junction/endpoint pixels into single node clusters so
    # that a thick crossing centre becomes one node instead of many 1px edges.
    cluster_of: dict[tuple[int, int], tuple[int, int]] = {}
    clusters: list[list[tuple[int, int]]] = []
    seen_cluster: set[tuple[int, int]] = set()
    for seed in sorted(raw_nodes):
        if seed in seen_cluster:
            continue
        stack = [seed]
        members: list[tuple[int, int]] = []
        while stack:
            pixel = stack.pop()
            if pixel in seen_cluster or pixel not in raw_nodes:
                continue
            seen_cluster.add(pixel)
            members.append(pixel)
            stack.extend(_neighbours(pixel, raw_nodes))
        centroid = (
            round(sum(p[0] for p in members) / len(members)),
            round(sum(p[1] for p in members) / len(members)),
        )
        clusters.append(members)
        for pixel in members:
            cluster_of[pixel] = centroid

    def node_key(pixel: tuple[int, int]) -> tuple[int, int]:
        return cluster_of.get(pixel, pixel)

    graph = SkeletonGraph()
    graph.nodes.update(set(cluster_of.values()))
    visited_regular: set[tuple[int, int]] = set()
    visited_direct: set[frozenset[tuple[int, int]]] = set()

    for node in sorted(raw_nodes):
        key_node = node_key(node)
        for nxt in _neighbours(node, skel_set):
            key_nxt = node_key(nxt)
            if key_nxt == key_node:
                continue  # internal pixel of the same junction cluster
            if nxt in raw_nodes:
                key = frozenset((key_node, key_nxt))
                if key in visited_direct:
                    continue
                visited_direct.add(key)
                graph.edges.append(Edge(key_node, key_nxt, [key_node, key_nxt]))
                continue
            if nxt in visited_regular:
                continue
            prev, cur = node, nxt
            path = [key_node, cur]
            visited_regular.add(cur)
            while cur not in raw_nodes:
                ahead = [q for q in _neighbours(cur, skel_set) if q != prev]
                if not ahead:
                    break
                nxt_pixel = ahead[0]
                prev, cur = cur, nxt_pixel
                path.append(cur)
                if cur not in raw_nodes:
                    visited_regular.add(cur)
            end_key = node_key(cur)
            path[-1] = end_key
            graph.edges.append(Edge(key_node, end_key, path))

    # Closed loops made only of degree-2 pixels (e.g. a skeletonised blob).
    leftovers = skel_set - visited_regular - raw_nodes
    for seed in sorted(leftovers):
        if seed in visited_regular:
            continue
        seed_key = seed
        graph.nodes.add(seed_key)
        start_neighbours = _neighbours(seed, skel_set)
        prev, cur = seed, start_neighbours[0]
        path = [seed_key, cur]
        visited_regular.add(cur)
        while cur != seed and cur not in raw_nodes:
            ahead = [q for q in _neighbours(cur, skel_set) if q != prev]
            if not ahead:
                break
            prev, cur = cur, ahead[0]
            path.append(cur if cur != seed else seed_key)
            if cur != seed:
                visited_regular.add(cur)
        graph.edges.append(Edge(seed_key, seed_key, path))

    for edge in graph.edges:
        # Convert (row, col) skeleton pixels to (x, y) SVG geometry.
        edge.path = [(c, r) for r, c in edge.path]
        edge.length = path_length(edge.path)
    graph.nodes = {(c, r) for r, c in graph.nodes}
    return graph


def estimate_widths(graph: SkeletonGraph, distance: np.ndarray) -> None:
    """Attach a median stroke width (pixels) to every edge via distance map."""
    for edge in graph.edges:
        values = [
            float(distance[int(round(y)), int(round(x))]) * 2.0
            for x, y in edge.path
        ]
        edge.width = max(1.0, float(np.median(values)))


def prune_graph(graph: SkeletonGraph, min_length: float) -> SkeletonGraph:
    """Trim short spurs without breaking genuine strokes or thin lines.

    A spur is a dangling chain from a leaf (degree 1) to the first junction
    (degree >= 3). When the leaf-to-junction distance is below ``min_length``
    the chain is detached at the junction. Open strokes whose leaf reaches
    another leaf or runs longer than the limit stay intact, as do junction
    edges and closed loops, so crossings and thin lines never disconnect.
    """
    remaining = list(graph.edges)
    # Degenerate 1-pixel self loops created inside merged junction clusters.
    remaining = [edge for edge in remaining if edge.a != edge.b or len(edge.path) >= 3]
    min_length = float(min_length)
    while True:
        adjacency: dict[tuple[int, int], list[int]] = {}
        for idx, edge in enumerate(remaining):
            adjacency.setdefault(edge.a, []).append(idx)
            if edge.a != edge.b:
                adjacency.setdefault(edge.b, []).append(idx)
        drop_chain: list[int] | None = None
        for node, edge_indices in adjacency.items():
            if len(edge_indices) != 1:
                continue
            first_idx = edge_indices[0]
            if remaining[first_idx].a == remaining[first_idx].b:
                continue
            chain = [first_idx]
            prev_node, cur_node = node, (
                remaining[first_idx].b
                if remaining[first_idx].a == node
                else remaining[first_idx].a
            )
            total = remaining[first_idx].length
            while len(adjacency.get(cur_node, [])) == 2:
                next_idx = next(i for i in adjacency[cur_node] if i != chain[-1])
                chain.append(next_idx)
                total += remaining[next_idx].length
                cur_node = (
                    remaining[next_idx].b
                    if remaining[next_idx].a == cur_node
                    else remaining[next_idx].a
                )
            if len(adjacency.get(cur_node, [])) >= 3 and total < min_length:
                drop_chain = chain
                break
        if drop_chain is None:
            break
        drop_set = set(drop_chain)
        remaining = [edge for idx, edge in enumerate(remaining) if idx not in drop_set]

    # Drop connected components whose longest edge is below the threshold.
    adjacency: dict[tuple[int, int], list[int]] = {}
    for idx, edge in enumerate(remaining):
        adjacency.setdefault(edge.a, []).append(idx)
        if edge.a != edge.b:
            adjacency.setdefault(edge.b, []).append(idx)
    keep = [False] * len(remaining)
    seen: set[tuple[int, int]] = set()
    for edge in remaining:
        start = edge.a
        if start in seen:
            continue
        stack = [start]
        component: list[int] = []
        while stack:
            node = stack.pop()
            if node in seen:
                continue
            seen.add(node)
            for edge_idx in adjacency.get(node, []):
                component.append(edge_idx)
                other = remaining[edge_idx].b if remaining[edge_idx].a == node else remaining[edge_idx].a
                if other not in seen:
                    stack.append(other)
        component = list(set(component))
        longest = max((remaining[i].length for i in component), default=0.0)
        if longest >= min_length:
            for edge_idx in component:
                keep[edge_idx] = True

    pruned = [edge for edge, ok in zip(remaining, keep) if ok]
    live_nodes: set[tuple[int, int]] = set()
    for edge in pruned:
        live_nodes.add(edge.a)
        live_nodes.add(edge.b)
    return SkeletonGraph(nodes=live_nodes, edges=pruned)


def simplify_edges(graph: SkeletonGraph, epsilon: float) -> None:
    """Apply RDP in place; ``epsilon`` scales with image diagonal."""
    for edge in graph.edges:
        edge.path = rdp(edge.path, epsilon)
