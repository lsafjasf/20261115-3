"""Validation tests for the sketch-to-vector pipeline.

Run with: .venv/bin/python -m tests.test_pipeline
"""

from __future__ import annotations

import os
import sys
import xml.etree.ElementTree as ET
from math import hypot

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from vectorize.pipeline import ProcessParams, process, render_overlay
from sample_data.generate_sample import make_sample

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "out")


def rasterize_graph(result, color=255) -> np.ndarray:
    """Rasterise the vector graph back to a binary mask for shape comparison."""
    canvas = np.zeros((result.height, result.width), np.uint8)
    for edge in result.graph.edges:
        pts = np.array(edge.path, dtype=np.int32)
        thickness = max(1, int(round(edge.width)))
        cv2.polylines(canvas, [pts], edge.a == edge.b, color, thickness)
    return canvas


def iou(a: np.ndarray, b: np.ndarray, dilate: int = 3) -> float:
    kernel = np.ones((dilate, dilate), np.uint8)
    a2 = cv2.dilate(a, kernel)
    b2 = cv2.dilate(b, kernel)
    inter = np.logical_and(a2, b2).sum()
    union = np.logical_or(a2, b2).sum()
    return float(inter) / float(union)


def point_to_polyline_distance(point, polyline) -> float:
    """Minimum distance from a point to every segment of a polyline."""
    px, py = point
    best = float("inf")
    for (x1, y1), (x2, y2) in zip(polyline, polyline[1:]):
        dx, dy = x2 - x1, y2 - y1
        denom = dx * dx + dy * dy
        t = 0.0 if denom == 0 else ((px - x1) * dx + (py - y1) * dy) / denom
        t = max(0.0, min(1.0, t))
        qx, qy = x1 + t * dx, y1 + t * dy
        best = min(best, hypot(px - qx, py - qy))
    return best


def main() -> int:
    os.makedirs(OUT_DIR, exist_ok=True)
    image = make_sample()
    cv2.imwrite(os.path.join(OUT_DIR, "00_sample_input.png"), image)
    failures: list[str] = []

    def check(name: str, condition: bool, detail: str = "") -> None:
        status = "PASS" if condition else "FAIL"
        print(f"[{status}] {name} {detail}")
        if not condition:
            failures.append(name)

    # ---- Case A: permissive pruning; Case B: aggressive min length ---------
    params_a = ProcessParams(threshold=128, noise_size=12, skeletonize=1, min_length=6)
    params_b = ProcessParams(threshold=128, noise_size=12, skeletonize=1, min_length=40)
    result_a = process(image, params_a)
    result_b = process(image, params_b)

    check(
        "两组参数节点数量不同",
        result_b.node_count < result_a.node_count,
        f"A={result_a.node_count} 节点/{result_a.edge_count} 路径, "
        f"B={result_b.node_count} 节点/{result_b.edge_count} 路径",
    )
    check(
        "提高最小长度后路径数减少",
        result_b.edge_count < result_a.edge_count,
        f"{result_a.edge_count} -> {result_b.edge_count}",
    )

    # ---- Contour stability: same main shape despite different node counts --
    raster_a = rasterize_graph(result_a)
    raster_b = rasterize_graph(result_b)
    contours_a, _ = cv2.findContours(raster_a, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    contours_b, _ = cv2.findContours(raster_b, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    hu_distance = cv2.matchShapes(
        max(contours_a, key=cv2.contourArea),
        max(contours_b, key=cv2.contourArea),
        cv2.CONTOURS_MATCH_I1,
        0.0,
    )
    shape_iou = iou(raster_a, raster_b)
    check("轮廓 Hu 矩距离稳定 (<0.05)", hu_distance < 0.05, f"distance={hu_distance:.5f}")
    check("矢量覆盖 IoU 稳定 (>0.90)", shape_iou > 0.90, f"IoU={shape_iou:.4f}")

    # ---- Isolated noise filtered -------------------------------------------
    check(
        "孤立噪点连通域被大量滤除",
        result_a.removed_noise_components >= 15,
        f"removed={result_a.removed_noise_components}",
    )
    result_no_filter = process(
        image, ProcessParams(threshold=128, noise_size=1, skeletonize=1, min_length=0)
    )
    check(
        "噪点过滤面积越大，剩余路径越少",
        result_a.edge_count < result_no_filter.edge_count,
        f"filtered={result_a.edge_count}, unfiltered={result_no_filter.edge_count}",
    )

    # ---- Genuine 1px thin line must survive --------------------------------
    # The RDP-simplified path is a straight segment, so measure point-to-line.
    thin_points = [(200 + t, 200 + t) for t in (10, 40, 70, 100, 120)]
    hit = 0
    for point in thin_points:
        closest = min(
            point_to_polyline_distance(point, edge.path)
            for edge in result_b.graph.edges
        )
        if closest <= 2.5:
            hit += 1
    check("1px 细线在强剪枝后仍然保留 (>=4/5 采样点)", hit >= 4, f"hits={hit}/5")

    # ---- Crossing topology preserved: a degree>=3 junction near X centre ---
    degree: dict[tuple[int, int], int] = {}
    for edge in result_a.graph.edges:
        degree[edge.a] = degree.get(edge.a, 0) + 1
        if edge.a != edge.b:
            degree[edge.b] = degree.get(edge.b, 0) + 1
    junctions = [p for p, d in degree.items() if d >= 3]
    near_x_center = any(abs(p[0] - 110) <= 6 and abs(p[1] - 110) <= 6 for p in junctions)
    check("X 交叉点保留为度>=3 的节点", near_x_center, f"junctions={len(junctions)}")

    # ---- Threshold sensitivity ---------------------------------------------
    result_dark = process(image, ProcessParams(threshold=120, noise_size=12, min_length=6))
    result_light = process(image, ProcessParams(threshold=240, noise_size=12, min_length=6))
    check(
        "阈值变化会改变二值化结果",
        result_light.edge_count != result_dark.edge_count
        or result_light.node_count != result_dark.node_count,
        f"dark={result_dark.edge_count} 路径, light={result_light.edge_count} 路径",
    )

    # ---- Skeleton toggle ----------------------------------------------------
    result_filled = process(
        image, ProcessParams(threshold=128, noise_size=12, skeletonize=0, min_length=6)
    )
    check("关闭骨架化仍可产出矢量路径", result_filled.edge_count > 0)

    # ---- SVG is well-formed and exportable ---------------------------------
    for tag, result in (("A", result_a), ("B", result_b)):
        root = ET.fromstring(result.svg)
        ns = "{http://www.w3.org/2000/svg}"
        paths = root.findall(f"{ns}path")
        check(f"方案{tag} SVG 合法且含 path 元素", len(paths) == result.edge_count)
        with open(os.path.join(OUT_DIR, f"lineart_{tag}.svg"), "w", encoding="utf-8") as fh:
            fh.write(result.svg)

    # ---- Overlay preview renders -------------------------------------------
    overlay_a = render_overlay(image, result_a.graph)
    overlay_b = render_overlay(image, result_b.graph)
    check("叠加预览尺寸与原图一致", overlay_a.shape == image.shape + (3,))
    cv2.imwrite(os.path.join(OUT_DIR, "01_overlay_A.png"), overlay_a)
    cv2.imwrite(os.path.join(OUT_DIR, "02_overlay_B.png"), overlay_b)
    cv2.imwrite(os.path.join(OUT_DIR, "03_vector_raster_A.png"), raster_a)
    cv2.imwrite(os.path.join(OUT_DIR, "04_vector_raster_B.png"), raster_b)

    print("\n方案 A (min_length=6):", result_a.node_count, "节点,",
          result_a.edge_count, "路径,", result_a.vertex_count, "顶点,",
          "滤除噪点", result_a.removed_noise_components)
    print("方案 B (min_length=40):", result_b.node_count, "节点,",
          result_b.edge_count, "路径,", result_b.vertex_count, "顶点")
    print(f"轮廓 Hu 距离={hu_distance:.5f}, IoU={shape_iou:.4f}")
    print("输出已写入", OUT_DIR)

    if failures:
        print("\n失败项:", ", ".join(failures))
        return 1
    print("\n全部测试通过 ✔")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
