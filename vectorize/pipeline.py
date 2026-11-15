"""End-to-end pipeline: grayscale sketch -> clean vector line art."""

from __future__ import annotations

from dataclasses import dataclass, asdict
from math import hypot

import cv2
import numpy as np

from .skeleton import zhang_suen_skeleton
from .graph import build_graph, prune_graph, simplify_edges, estimate_widths, Edge, SkeletonGraph


@dataclass
class ProcessParams:
    # Pixels darker than threshold (0-255) are treated as ink.
    threshold: int = 128
    # Connected components smaller than this pixel count are isolated noise.
    noise_size: int = 12
    # 0 = no skeletonisation (contour mode), 1 = Zhang-Suen centre lines.
    skeletonize: int = 1
    # Paths shorter than this (pixels) are dropped; junction edges are kept.
    min_length: float = 8.0

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class ProcessResult:
    svg: str
    width: int
    height: int
    node_count: int
    edge_count: int
    vertex_count: int
    removed_noise_components: int
    params: ProcessParams
    graph: object = None


def _denoise(mask: np.ndarray, noise_size: int) -> tuple[np.ndarray, int]:
    """Remove small isolated components without touching thin long lines."""
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    removed = 0
    clean = np.zeros_like(mask)
    for label in range(1, count):
        area = int(stats[label, cv2.CC_STAT_AREA])
        if area < max(1, noise_size):
            removed += 1
            continue
        clean[labels == label] = 1
    return clean, removed


def encode_svg(width: int, height: int, edges: list[Edge], stroke: str = "#111111") -> str:
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}">',
        '<rect width="100%" height="100%" fill="white"/>',
    ]
    for edge in sorted(edges, key=lambda e: (e.a, e.b)):
        pts = edge.path
        if len(pts) < 2:
            continue
        d = f"M{pts[0][0]:.2f},{pts[0][1]:.2f} " + " ".join(
            f"L{x:.2f},{y:.2f}" for x, y in pts[1:]
        )
        if edge.a == edge.b and len(pts) >= 3:
            d += " Z"
        parts.append(
            f'<path d="{d}" fill="none" stroke="{stroke}" '
            f'stroke-width="{edge.width:.2f}" stroke-linecap="round" '
            f'stroke-linejoin="round"/>'
        )
    parts.append("</svg>")
    return "\n".join(parts)


def process(image: np.ndarray, params: ProcessParams) -> ProcessResult:
    if image.ndim == 3:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    else:
        gray = image
    height, width = gray.shape

    # 1. Threshold: dark pixels become foreground ink.
    _, binary = cv2.threshold(
        gray, int(params.threshold), 255, cv2.THRESH_BINARY_INV
    )
    mask = (binary > 0).astype(np.uint8)

    # 2. Noise removal via connected-component area (thin lines stay intact).
    mask, removed = _denoise(mask, int(params.noise_size))

    # 3. Skeletonise or keep the filled shapes; distance map gives stroke width.
    distance = cv2.distanceTransform(mask, cv2.DIST_L2, 5)
    if int(params.skeletonize) == 1:
        skel = zhang_suen_skeleton(mask)
    else:
        skel = mask.copy()

    # 4. Graph extraction, length-based pruning and polyline simplification.
    graph = build_graph(skel)
    estimate_widths(graph, distance)
    graph = prune_graph(graph, float(params.min_length))
    diagonal = hypot(width, height)
    simplify_edges(graph, epsilon=max(0.6, diagonal * 0.002))

    svg = encode_svg(width, height, graph.edges)
    vertex_count = sum(max(0, len(edge.path) - 1) for edge in graph.edges)
    return ProcessResult(
        svg=svg,
        width=width,
        height=height,
        node_count=len(graph.nodes),
        edge_count=len(graph.edges),
        vertex_count=vertex_count,
        removed_noise_components=removed,
        params=params,
        graph=graph,
    )


def render_overlay(
    original: np.ndarray, graph: SkeletonGraph
) -> np.ndarray:
    """Composite the vector result (red) on a faded original for preview."""
    if original.ndim == 2:
        base = cv2.cvtColor(original, cv2.COLOR_GRAY2BGR)
    else:
        base = original.copy()
    faded = (base.astype(np.float32) * 0.35 + 255 * 0.65).astype(np.uint8)
    for edge in graph.edges:
        points = np.array(edge.path, dtype=np.int32)
        thickness = max(1, int(round(edge.width)))
        cv2.polylines(faded, [points], edge.a == edge.b, (40, 40, 220), thickness)
    return faded
