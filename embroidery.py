"""Two-color seamless embroidery pattern generator.

The module builds a four-edge continuous (torus-tiled) embroidery motif,
turns vector paths into needle stitches, runs manufacturing checks
(long jump stitches, excessive back stitches, four-edge seams) and
exports layered SVG and PNG artifacts without third-party dependencies.
"""

from __future__ import annotations

import json
import math
import os
import zlib
from dataclasses import dataclass, field

# ---------------------------------------------------------------------------
# Design / manufacturing parameters (millimetres)
# ---------------------------------------------------------------------------
TILE = 100.0
CENTER = (TILE / 2.0, TILE / 2.0)

STITCH_TARGET = 2.4
STITCH_MIN = 1.2
STITCH_MAX = 3.0
JUMP_MAX = 10.0
BACKSTITCH_COS = -0.5
BACKSTITCH_RATIO_MAX = 0.05

R_PROTECT = 16.0          # protected radius around the center motif
MOTIF_OUTER = 13.0
SEAM_EPS = 0.05

COLOR_A = (196, 45, 60)   # crimson
COLOR_B = (32, 96, 168)   # indigo
NEEDLE_COLOR = (38, 34, 38)
CANVAS_COLOR = (246, 241, 232)

# density acceptance bands
POINT_DENSITY_BAND = (0.10, 0.45)   # needle points per mm^2
THREAD_DENSITY_BAND = (0.20, 1.00)  # mm of thread per mm^2


# ---------------------------------------------------------------------------
# Vector helpers
# ---------------------------------------------------------------------------
def vadd(a, b):
    return (a[0] + b[0], a[1] + b[1])


def vsub(a, b):
    return (a[0] - b[0], a[1] - b[1])


def vscale(a, k):
    return (a[0] * k, a[1] * k)


def vdot(a, b):
    return a[0] * b[0] + a[1] * b[1]


def vlen(a):
    return math.hypot(a[0], a[1])


def wrap_value(v, tile=TILE):
    return v - tile * math.floor(v / tile)


def wrap_point(p, tile=TILE):
    return (wrap_value(p[0], tile), wrap_value(p[1], tile))


def segment_point_distance(a, b, p):
    """Distance from point p to segment a-b."""
    ab = vsub(b, a)
    denom = vdot(ab, ab)
    if denom == 0.0:
        return vlen(vsub(p, a))
    t = max(0.0, min(1.0, vdot(vsub(p, a), ab) / denom))
    closest = vadd(a, vscale(ab, t))
    return vlen(vsub(p, closest))


def resample_polyline(points, step, closed=False):
    """Resample a polyline so consecutive samples are ~step apart."""
    if len(points) < 2:
        return list(points)
    pts = list(points)
    if closed:
        pts.append(points[0])
    cum = [0.0]
    for a, b in zip(pts, pts[1:]):
        cum.append(cum[-1] + vlen(vsub(b, a)))
    total = cum[-1]
    if total < step * 0.5:
        return list(points)
    out = [pts[0]]
    target = step
    seg = 0
    while target < total - 1e-9:
        while cum[seg + 1] < target:
            seg += 1
        a, b = pts[seg], pts[seg + 1]
        span = cum[seg + 1] - cum[seg]
        t = 0.0 if span == 0 else (target - cum[seg]) / span
        out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
        target += step
    if not closed and vlen(vsub(out[-1], pts[-1])) >= step * 0.75:
        out.append(pts[-1])
    return out


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------
@dataclass
class Stitch:
    a: tuple
    b: tuple
    color: tuple
    run_id: int
    motif: bool = False


@dataclass
class SeamLink:
    exit_pt: tuple          # point on the leaving edge
    entry_pt: tuple         # wrapped continuation on the opposite edge
    direction: tuple
    chain_id: int = -1


@dataclass
class Layout:
    tile: float
    line_width: float
    stitch_len: float
    runs: list = field(default_factory=list)       # list[list[points]]
    run_colors: list = field(default_factory=list)
    run_motif: list = field(default_factory=list)
    stitches: list = field(default_factory=list)
    seam_links: list = field(default_factory=list)
    chain_ids: list = field(default_factory=list)

    def all_points(self):
        pts = []
        for run in self.runs:
            pts.extend(run)
        return pts

# ---------------------------------------------------------------------------
# Center motif: eight-petal rosette inside the protected zone
# ---------------------------------------------------------------------------
def petal_polyline(angle, outer, inner_radius, samples=24):
    """One petal as a closed lens curve centred along ``angle``."""
    half = math.radians(16.0)
    pts = []
    for i in range(samples + 1):
        t = math.pi * i / samples
        radius = inner_radius + (outer - inner_radius) * math.sin(t)
        theta = angle - half * math.cos(t)
        pts.append((CENTER[0] + radius * math.cos(theta),
                    CENTER[1] + radius * math.sin(theta)))
    for i in range(samples, -1, -1):
        t = math.pi * i / samples
        radius = inner_radius + (outer - inner_radius) * math.sin(t)
        theta = angle + half * math.cos(t)
        pts.append((CENTER[0] + radius * math.cos(theta),
                    CENTER[1] + radius * math.sin(theta)))
    return pts


def circle_polyline(radius, samples=64):
    return [(CENTER[0] + radius * math.cos(2 * math.pi * i / samples),
             CENTER[1] + radius * math.sin(2 * math.pi * i / samples))
            for i in range(samples)]


def build_motif_runs(stitch_len):
    """Return (runs, colors): 4 crimson + 4 indigo petals plus a center ring."""
    runs, colors = [], []
    for k in range(8):
        angle = math.radians(45.0 * k + 22.5)
        outline = petal_polyline(angle, MOTIF_OUTER, 2.6)
        runs.append(resample_polyline(outline, stitch_len, closed=True))
        colors.append(COLOR_A if k % 2 == 0 else COLOR_B)
    ring = resample_polyline(circle_polyline(3.6), stitch_len, closed=True)
    runs.append(ring)
    colors.append(COLOR_A)
    return runs, colors


# ---------------------------------------------------------------------------
# Torus lattice: two diagonal families, wrapped across tile edges
# ---------------------------------------------------------------------------
def _walk_wrapped(start, direction, steps, tile):
    """Walk straight through the torus, emitting wrapped points plus the
    unwrapped coordinates so crossing events can be reconstructed."""
    raw, wrapped = [], []
    p = start
    for _ in range(steps + 1):
        raw.append(p)
        wrapped.append(wrap_point(p, tile))
        p = vadd(p, direction)
    return raw, wrapped


def build_lattice_runs(spacing, line_width, stitch_len, protected_radius):
    """Two diagonal line families forming an edge-continuous lattice."""
    runs, colors, seam_links, chain_ids = [], [], [], []
    diag = math.sqrt(2.0)
    # each slope +/-1 torus orbit is a closed loop of length tile*sqrt(2)
    invariant_step = spacing * diag
    count = max(1, int(round(TILE / invariant_step)))
    n_steps = int(math.ceil(tile_cross(1.0) / stitch_len)) + 1
    for family, (dx, dy) in enumerate(((1.0, 1.0), (-1.0, -1.0))):
        for k in range(count):
            chain_id = family * 1000 + k
            invariant = (k + 0.5) * TILE / count
            # solve y - x == invariant (family 0) or y + x == invariant
            start = (stitch_len,
                     wrap_value(stitch_len + invariant)) if dx > 0 \
                else (stitch_len,
                      wrap_value(invariant - stitch_len))
            direction = (dx * stitch_len / diag, dy * stitch_len / diag)
            raw, wrapped = _walk_wrapped(start, direction, n_steps, TILE)
            edge_runs, links = _split_on_edges(raw, wrapped, direction)
            for link in links:
                link.chain_id = chain_id
            seam_links.extend(_dedup_links(links))
            for run in edge_runs:
                resampled = resample_polyline(run, stitch_len)
                for kept in _filter_protected(
                        resampled, protected_radius + line_width / 2.0):
                    polished = resample_polyline(kept, stitch_len)
                    total = sum(vlen(vsub(b, a))
                                for a, b in zip(polished, polished[1:])) \
                        if len(polished) > 1 else 0.0
                    if len(polished) > 1 and total >= stitch_len * 0.75:
                        runs.append(polished)
                        colors.append(COLOR_A if family == 0 else COLOR_B)
                        chain_ids.append(chain_id)
    return runs, colors, seam_links, chain_ids


def _dedup_links(links):
    unique, seen = [], set()
    for link in links:
        key = (tuple(round(v, 2) for v in link.exit_pt),
               tuple(round(v, 2) for v in link.entry_pt),
               tuple(round(v, 3) for v in link.direction),
               link.chain_id)
        if key in seen:
            continue
        seen.add(key)
        unique.append(link)
    return unique


def tile_cross(spacing):
    return TILE * math.sqrt(2.0)


def _split_on_edges(raw, wrapped, direction):
    """Split a wrapped walk at the exact tile edges on every wrap."""
    runs, links = [], []
    current = [wrapped[0]]
    for i in range(1, len(raw)):
        crossings = _edge_crossings(raw[i - 1], raw[i])
        crossing = bool(crossings)
        if crossing:
            for exit_pt, entry_pt in crossings:
                links.append(SeamLink(exit_pt, entry_pt, direction))
            current.append(crossings[0][0])
            runs.append(current)
            current = [crossings[-1][1]]
        current.append(wrapped[i])
    runs.append(current)
    return [r for r in runs if len(r) > 1], links


def _edge_crossings(raw_prev, raw_next):
    """Interpolate every axis crossing of one wrapping segment."""
    crossings = []
    for ax in (0, 1):
        delta = raw_next[ax] - raw_prev[ax]
        if abs(delta) < 1e-12:
            continue
        boundary = math.floor(raw_next[ax] / TILE) * TILE if delta > 0 \
            else math.ceil(raw_next[ax] / TILE) * TILE
        t = (boundary - raw_prev[ax]) / delta
        if 0.0 < t < 1.0:
            crossings.append((t, ax, boundary))
    crossings.sort()
    results = []
    for t, ax, boundary in crossings:
        pt = tuple(raw_prev[a] + (raw_next[a] - raw_prev[a]) * t
                   for a in (0, 1))
        exit_pt = list(wrap_point(pt))
        entry = list(exit_pt)
        exit_pt[ax] = 0.0 if pt[ax] >= boundary else TILE
        entry[ax] = TILE - SEAM_EPS if exit_pt[ax] == 0.0 else SEAM_EPS
        results.append((tuple(exit_pt), tuple(entry)))
    return results


def _filter_protected(run, keep_outside_radius):
    """Split a run wherever a stitch enters the protected center disk."""
    pieces, current = [], [run[0]]
    for a, b in zip(run, run[1:]):
        if segment_point_distance(a, b, CENTER) >= keep_outside_radius:
            current.append(b)
        else:
            if len(current) > 1:
                pieces.append(current)
            current = [b]
    if len(current) > 1:
        pieces.append(current)
    return pieces


# ---------------------------------------------------------------------------
# Layout assembly
# ---------------------------------------------------------------------------
def build_layout(line_width=1.6, spacing=7.7, stitch_len=STITCH_TARGET,
                 protected_radius=R_PROTECT):
    layout = Layout(TILE, line_width, stitch_len)
    motif_runs, motif_colors = build_motif_runs(stitch_len)
    lattice_runs, lattice_colors, seam_links, lattice_chain = build_lattice_runs(
        spacing, line_width, stitch_len, protected_radius)

    layout.runs = motif_runs + lattice_runs
    layout.run_colors = motif_colors + lattice_colors
    layout.run_motif = [True] * len(motif_runs) + [False] * len(lattice_runs)
    layout.chain_ids = list(range(-1, -(len(motif_runs) + 1), -1))
    layout.chain_ids.extend(lattice_chain)

    # seam links only count when both sides stay outside the protected disk
    for link in seam_links:
        if (vlen(vsub(link.exit_pt, CENTER)) >= protected_radius and
                vlen(vsub(link.entry_pt, CENTER)) >= protected_radius):
            layout.seam_links.append(link)

    for run_id, (run, color, is_motif) in enumerate(zip(
            layout.runs, layout.run_colors, layout.run_motif)):
        clean = [run[0]]
        for pt in run[1:]:
            if vlen(vsub(pt, clean[-1])) > 1e-9:
                clean.append(pt)
        layout.runs[run_id] = clean
        run = clean
        for a, b in zip(run, run[1:]):
            if vlen(vsub(b, a)) >= STITCH_MIN:
                layout.stitches.append(Stitch(a, b, color, run_id, is_motif))
    insert_bridge_stitches(layout)
    return layout


# Manufacturing checks
# ---------------------------------------------------------------------------
def check_stitch_lengths(layout):
    """Every physical needle-to-needle segment must stay in band."""
    records = []
    for st in layout.stitches:
        if st.color == NEEDLE_COLOR:
            continue
        length = vlen(vsub(st.b, st.a))
        records.append((length, st))
    records.sort(key=lambda item: item[0], reverse=True)
    longest = records[0][0] if records else 0.0
    over_band = [r for r in records if r[0] > STITCH_MAX + 1e-9]
    under_band = [r for r in records if r[0] < STITCH_MIN - 1e-9]
    return {
        "longest_mm": round(longest, 3),
        "shortest_mm": round(records[-1][0], 3) if records else 0.0,
        "band_mm": [STITCH_MIN, STITCH_MAX],
        "over_limit": len(over_band),
        "under_limit": len(under_band),
        "pass": bool(records) and not over_band and not under_band,
    }


def check_jumps(layout):
    """Travel moves between ordered runs after bridge insertion."""
    order = _full_order(layout)
    moves = []
    for prev_id, next_id in zip(order, order[1:]):
        start, end = layout.runs[prev_id][-1], layout.runs[next_id][0]
        gap = vlen(vsub(end, start))
        moves.append((gap, prev_id, next_id))
    longest = max((m[0] for m in moves), default=0.0)
    return {
        "longest_jump_mm": round(longest, 3),
        "jump_limit_mm": JUMP_MAX,
        "over_limit": sum(1 for m in moves if m[0] > JUMP_MAX),
        "pass": longest <= JUMP_MAX,
    }


def _full_order(layout):
    """Chain-aware order with bridge runs interleaved by their endpoints."""
    sequence = getattr(layout, "_sew_sequence", None)
    if sequence is None:
        return _chain_aware_order(layout)
    return [item[1] for item in sequence]


def insert_bridge_stitches(layout):
    """Split travel moves longer than JUMP_MAX into bridge segments."""
    order = _chain_aware_order(layout)
    bridge_color = NEEDLE_COLOR
    expanded, added = [], 0
    for prev_id, next_id in zip(order, order[1:]):
        expanded.append(("run", prev_id))
        start = layout.runs[prev_id][-1]
        end = layout.runs[next_id][0]
        gap = vlen(vsub(end, start))
        pieces = math.ceil(gap / JUMP_MAX)
        if pieces <= 1:
            continue
        run_id = len(layout.runs)
        run = [start]
        for k in range(1, pieces):
            t = k / pieces
            run.append((start[0] + (end[0] - start[0]) * t,
                        start[1] + (end[1] - start[1]) * t))
        run.append(end)
        layout.runs.append(run)
        layout.run_colors.append(bridge_color)
        layout.run_motif.append(False)
        layout.chain_ids.append(-1000 - run_id)
        for a, b in zip(run, run[1:]):
            layout.stitches.append(Stitch(a, b, bridge_color, run_id, False))
            added += 1
        expanded.append(("bridge", run_id))
    expanded.append(("run", order[-1]))
    layout._sew_sequence = expanded
    return added
def _chain_aware_order(layout):
    """Order runs so pieces of one wrapped chain stay consecutive."""
    chains = {}
    for idx, chain in enumerate(layout.chain_ids):
        if layout.run_motif[idx] or chain <= -1000:
            continue
        chains.setdefault(chain, []).append(idx)
    ordered = [i for i, m in enumerate(layout.run_motif) if m]
    anchor = layout.runs[ordered[-1]][-1] if ordered else (0.0, 0.0)
    groups = list(chains.values())
    while groups:
        def group_cost(group):
            ends = []
            for idx in group:
                ends.append(vlen(vsub(anchor, layout.runs[idx][0])))
                ends.append(vlen(vsub(anchor, layout.runs[idx][-1])))
            return min(ends)
        group = min(groups, key=group_cost)
        remaining = list(group)
        while remaining:
            nxt = min(remaining, key=lambda i: min(
                vlen(vsub(anchor, layout.runs[i][0])),
                vlen(vsub(anchor, layout.runs[i][-1]))))
            run = layout.runs[nxt]
            if vlen(vsub(anchor, run[-1])) < vlen(vsub(anchor, run[0])):
                run.reverse()
            anchor = run[-1]
            ordered.append(nxt)
            remaining.remove(nxt)
        groups.remove(group)
    return ordered


def check_backstitches(layout):
    """A back stitch reverses direction within the same run."""
    total, backs = 0, 0
    per_run = {}
    for run_id, run in enumerate(layout.runs):
        count = 0
        for a, b, c in zip(run, run[1:], run[2:]):
            u, v = vsub(b, a), vsub(c, b)
            lu, lv = vlen(u), vlen(v)
            if lu < 1e-9 or lv < 1e-9:
                continue
            total += 1
            if vdot(u, v) / (lu * lv) < BACKSTITCH_COS:
                backs += 1
                count += 1
        per_run[run_id] = count
    ratio = backs / total if total else 0.0
    return {
        "back_stitches": backs,
        "directional_stitches": total,
        "ratio": round(ratio, 4),
        "ratio_limit": BACKSTITCH_RATIO_MAX,
        "pass": ratio <= BACKSTITCH_RATIO_MAX,
    }


def check_seams(layout):
    """Four-edge continuity: every wrap link exits/enters matching edges."""
    bad, edges = 0, {"left-to-right": 0, "right-to-left": 0,
                     "bottom-to-top": 0, "top-to-bottom": 0}
    for link in layout.seam_links:
        ex, en = link.exit_pt, link.entry_pt
        dx, dy = link.direction
        # x axis wraps between the left/right vertical edges
        if ex[0] >= TILE - SEAM_EPS and en[0] <= SEAM_EPS:
            edges["right-to-left" if dx > 0 else "left-to-right"] += 1
        elif ex[0] <= SEAM_EPS and en[0] >= TILE - SEAM_EPS:
            edges["left-to-right" if dx < 0 else "right-to-left"] += 1
        # y axis wraps between the top/bottom horizontal edges
        if ex[1] >= TILE - SEAM_EPS and en[1] <= SEAM_EPS:
            edges["bottom-to-top" if dy > 0 else "top-to-bottom"] += 1
        elif ex[1] <= SEAM_EPS and en[1] >= TILE - SEAM_EPS:
            edges["top-to-bottom" if dy < 0 else "bottom-to-top"] += 1
        vert_ok = (ex[0] >= TILE - SEAM_EPS and en[0] <= SEAM_EPS) or \
                  (ex[0] <= SEAM_EPS and en[0] >= TILE - SEAM_EPS)
        horz_ok = (ex[1] >= TILE - SEAM_EPS and en[1] <= SEAM_EPS) or \
                  (ex[1] <= SEAM_EPS and en[1] >= TILE - SEAM_EPS)
        if not (vert_ok or horz_ok):
            bad += 1
    total = len(layout.seam_links)
    return {
        "seam_links": total,
        "edges": edges,
        "malformed": bad,
        "pass": total > 0 and bad == 0 and all(v > 0 for v in edges.values()),
    }


# ---------------------------------------------------------------------------
# Density metrics and scaling validation
# ---------------------------------------------------------------------------
def density_metrics(layout):
    points = []
    decorative_stitches = []
    for run_id, run in enumerate(layout.runs):
        if layout.chain_ids and layout.chain_ids[run_id] <= -1000:
            continue
        points.extend(run)
    for st in layout.stitches:
        if st.color != NEEDLE_COLOR:
            decorative_stitches.append(st)
    unique = _dedup_points(points)
    thread_len = sum(vlen(vsub(st.b, st.a))
                     for st in decorative_stitches)
    area = layout.tile ** 2
    return {
        "needle_points": len(unique),
        "stitches": len(decorative_stitches),
        "thread_length_mm": round(thread_len, 2),
        "point_density": round(len(unique) / area, 4),
        "thread_density": round(thread_len / area, 4),
        "tile_mm": layout.tile,
    }


def _dedup_points(points, eps=1e-6):
    grid, unique = {}, []
    cell = max(eps * 2.0, 1e-6)
    for pt in points:
        key = (int(pt[0] // cell), int(pt[1] // cell))
        duplicate = False
        for gx in (key[0] - 1, key[0], key[0] + 1):
            for gy in (key[1] - 1, key[1], key[1] + 1):
                for q in grid.get((gx, gy), ()):
                    if vlen(vsub(pt, q)) <= eps:
                        duplicate = True
        if not duplicate:
            unique.append(pt)
            grid.setdefault(key, []).append(pt)
    return unique


def density_pass(metrics):
    pd_ok = POINT_DENSITY_BAND[0] <= metrics["point_density"] <= POINT_DENSITY_BAND[1]
    td_ok = THREAD_DENSITY_BAND[0] <= metrics["thread_density"] <= THREAD_DENSITY_BAND[1]
    return pd_ok and td_ok


def relayout_for_width(line_width):
    """Re-space the lattice when line width changes; the motif disk is
    protected and its exclusion radius grows with the thread width."""
    spacing = max(5.5, line_width * 4.8)
    protected = R_PROTECT + line_width * 0.5
    return build_layout(line_width=line_width, spacing=spacing,
                        protected_radius=protected)


def scale_naive(layout, factor):
    """Scale coordinates only (what a naive export would do)."""
    scaled = Layout(layout.tile * factor, layout.line_width * factor,
                    layout.stitch_len * factor)
    for run, color, is_motif in zip(layout.runs, layout.run_colors,
                                    layout.run_motif):
        scaled.runs.append([(p[0] * factor, p[1] * factor) for p in run])
        scaled.run_colors.append(color)
        scaled.run_motif.append(is_motif)
    for st in layout.stitches:
        scaled.stitches.append(Stitch(
            tuple(c * factor for c in st.a),
            tuple(c * factor for c in st.b), st.color, st.run_id, st.motif))
    scaled.seam_links = [
        SeamLink(tuple(c * factor for c in l.exit_pt),
                 tuple(c * factor for c in l.entry_pt), l.direction)
        for l in layout.seam_links]
    return scaled


def scale_relayout(factor):
    """Re-generate at the new tile size, keeping density inside the band."""
    global TILE, CENTER, R_PROTECT
    saved = (TILE, CENTER, R_PROTECT)
    TILE = saved[0] * factor
    CENTER = (TILE / 2.0, TILE / 2.0)
    R_PROTECT = saved[2] * factor
    # on small tiles widen the lattice spacing so density stays in band
    spacing = 7.7 * factor if factor >= 1.0 else 7.7 / math.sqrt(factor)
    try:
        layout = build_layout(line_width=1.6 * factor,
                              spacing=spacing,
                              stitch_len=STITCH_TARGET,
                              protected_radius=R_PROTECT)
    finally:
        TILE, CENTER, R_PROTECT = saved
    return layout


def scaling_study(base_layout, factors=(0.5, 0.75, 1.0, 1.5, 2.0)):
    rows = []
    for factor in factors:
        naive = scale_naive(base_layout, factor)
        rebuilt = scale_relayout(factor)
        n_metrics, r_metrics = density_metrics(naive), density_metrics(rebuilt)
        n_lengths = check_stitch_lengths(naive)
        r_lengths = check_stitch_lengths(rebuilt)
        rows.append({
            "scale": factor,
            "tile_mm": round(base_layout.tile * factor, 2),
            "naive": {
                "stitch_len_mm": n_lengths["longest_mm"],
                "point_density": n_metrics["point_density"],
                "thread_density": n_metrics["thread_density"],
                "density_pass": density_pass(n_metrics),
                "stitch_band_pass": n_lengths["pass"],
            },
            "relayout": {
                "stitch_len_mm": r_lengths["longest_mm"],
                "point_density": r_metrics["point_density"],
                "thread_density": r_metrics["thread_density"],
                "density_pass": density_pass(r_metrics),
                "stitch_band_pass": r_lengths["pass"],
            },
        })
    return rows


# ---------------------------------------------------------------------------
# SVG export (three named layers)
# ---------------------------------------------------------------------------
def _rgb(color):
    return "rgb(%d,%d,%d)" % color


def render_svg(layout, path, tiles=1):
    tile = layout.tile
    size = tile * tiles
    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size:.2f}mm" '
        f'height="{size:.2f}mm" viewBox="0 0 {size:.2f} {size:.2f}">',
        '<defs>',
        f'<pattern id="canvas-weave" width="4" height="4" '
        f'patternUnits="userSpaceOnUse">'
        f'<rect width="4" height="4" fill="{_rgb(CANVAS_COLOR)}"/>'
        f'<path d="M0 0H4 M0 0V4" stroke="#ddd2c0" stroke-width="0.3"/></pattern>',
        '</defs>',
        '<g id="layer-canvas" inkscape:groupmode="layer" '
        'inkscape:label="canvas">',
        f'<rect x="0" y="0" width="{size:.2f}" height="{size:.2f}" '
        f'fill="url(#canvas-weave)"/>',
    ]
    for tx in range(tiles):
        for ty in range(tiles):
            ox, oy = tx * tile, ty * tile
            parts.append(
                f'<rect x="{ox}" y="{oy}" width="{tile:.2f}" '
                f'height="{tile:.2f}" fill="none" stroke="#b9ac93" '
                'stroke-width="0.25" stroke-dasharray="2 2"/>')
            for frac in (0.0, 0.5, 1.0):
                for edge in ("h", "v"):
                    if edge == "h":
                        x1, y1 = ox + frac * tile, oy
                        x2, y2 = x1, oy + 2.0
                    else:
                        x1, y1 = ox, oy + frac * tile
                        x2, y2 = ox + 2.0, y1
                    parts.append(
                        f'<line x1="{x1:.2f}" y1="{y1:.2f}" '
                        f'x2="{x2:.2f}" y2="{y2:.2f}" '
                        'stroke="#7a6f57" stroke-width="0.3"/>')
    parts.append('</g>')

    parts.append('<g id="layer-thread" inkscape:groupmode="layer" '
                 'inkscape:label="thread">')
    for tx in range(tiles):
        for ty in range(tiles):
            ox, oy = tx * tile, ty * tile
            for st in layout.stitches:
                if st.color == NEEDLE_COLOR:
                    continue
                parts.append(
                    f'<line x1="{ox + st.a[0]:.3f}" y1="{oy + st.a[1]:.3f}" '
                    f'x2="{ox + st.b[0]:.3f}" y2="{oy + st.b[1]:.3f}" '
                    f'stroke="{_rgb(st.color)}" '
                    f'stroke-width="{layout.line_width:.2f}" '
                    'stroke-linecap="round" opacity="0.92"/>')
    parts.append('</g>')
    parts.append('<g id="layer-jump" inkscape:groupmode="layer" '
                 'inkscape:label="jump-bridges">')
    for tx in range(tiles):
        for ty in range(tiles):
            ox, oy = tx * tile, ty * tile
            for st in layout.stitches:
                if st.color != NEEDLE_COLOR:
                    continue
                parts.append(
                    f'<line x1="{ox + st.a[0]:.3f}" y1="{oy + st.a[1]:.3f}" '
                    f'x2="{ox + st.b[0]:.3f}" y2="{oy + st.b[1]:.3f}" '
                    'stroke="rgb(120,110,120)" stroke-width="0.35" '
                    'stroke-dasharray="1.2 1.2" opacity="0.55"/>')
    parts.append('</g>')

    parts.append('<g id="layer-needle" inkscape:groupmode="layer" '
                 'inkscape:label="needle">')
    r = max(0.35, layout.line_width * 0.18)
    for tx in range(tiles):
        for ty in range(tiles):
            ox, oy = tx * tile, ty * tile
            for pt in _dedup_points(layout.all_points()):
                parts.append(
                    f'<circle cx="{ox + pt[0]:.3f}" cy="{oy + pt[1]:.3f}" '
                    f'r="{r:.2f}" fill="{_rgb(NEEDLE_COLOR)}"/>')
    parts.append('</g>')
    parts.append('</svg>')
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(parts))


# ---------------------------------------------------------------------------
# Pure-stdlib PNG writer
# ---------------------------------------------------------------------------
def write_png(path, width, height, rgba_rows):
    """rgba_rows: list of rows; each row is bytes length width*4."""
    def chunk(tag, data):
        out = struct_pack(">I", len(data)) + tag + data
        return out + struct_pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = bytearray()
    for row in rgba_rows:
        raw.append(0)  # filter type 0
        raw.extend(row)
    ihdr = struct_pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    blob = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) +
            chunk(b"IDAT", zlib.compress(bytes(raw), 9)) +
            chunk(b"IEND", b""))
    with open(path, "wb") as fh:
        fh.write(blob)


def struct_pack(fmt, *values):
    import struct
    return struct.pack(fmt, *values)


# ---------------------------------------------------------------------------
# Scanline rasterizer (coverage-based anti-aliasing)
# ---------------------------------------------------------------------------
class Raster:
    def __init__(self, size_mm, px_per_mm=10.0, background=CANVAS_COLOR):
        self.size_mm = size_mm
        self.ppm = px_per_mm
        self.px = int(round(size_mm * px_per_mm))
        n = self.px * self.px
        self.cov = bytearray(n)
        self.r = bytearray(background[0] for _ in range(n))
        self.g = bytearray(background[1] for _ in range(n))
        self.b = bytearray(background[2] for _ in range(n))

    def _blend_span(self, y, x0, x1, color, alpha):
        if y < 0 or y >= self.px:
            return
        x0 = max(0, min(self.px, x0))
        x1 = max(0, min(self.px, x1))
        for x in range(x0, x1):
            idx = y * self.px + x
            a = alpha
            inv = 255 - a
            self.r[idx] = (color[0] * a + self.r[idx] * inv) // 255
            self.g[idx] = (color[1] * a + self.g[idx] * inv) // 255
            self.b[idx] = (color[2] * a + self.b[idx] * inv) // 255

    def line(self, a, b, width_mm, color, alpha=235):
        radius = width_mm * 0.5 * self.ppm
        ax, ay = a[0] * self.ppm, a[1] * self.ppm
        bx, by = b[0] * self.ppm, b[1] * self.ppm
        y0 = max(0, int(math.floor(min(ay, by) - radius - 1)))
        y1 = min(self.px - 1, int(math.ceil(max(ay, by) + radius + 1)))
        for y in range(y0, y1 + 1):
            cy = y + 0.5
            xc, half = _capsule_span(ax, ay, bx, by, radius, cy)
            if xc is None:
                continue
            lo = int(math.floor(xc - half - 0.5))
            hi = int(math.ceil(xc + half - 0.5))
            # crude coverage ramp on the two edge pixels
            self._blend_span(y, lo + 1, hi, color, alpha)
            for x in (lo, hi):
                if 0 <= x < self.px:
                    dist = abs((x + 0.5) - xc)
                    edge = max(0.0, min(1.0, radius + 0.5 - dist))
                    self._blend_span(y, x, x + 1, color, int(alpha * edge))

    def dot(self, center, radius_mm, color):
        radius = radius_mm * self.ppm
        cx, cy = center[0] * self.ppm, center[1] * self.ppm
        y0 = max(0, int(math.floor(cy - radius - 1)))
        y1 = min(self.px - 1, int(math.ceil(cy + radius + 1)))
        for y in range(y0, y1 + 1):
            dy = (y + 0.5) - cy
            if abs(dy) > radius + 1:
                continue
            half = math.sqrt(max(0.0, (radius + 0.5) ** 2 - dy * dy))
            self._blend_span(y, int(math.floor(cx - half)),
                             int(math.ceil(cx + half)), color, 255)

    def frame(self, tile_mm):
        color = (150, 138, 112)
        n = int(round(self.size_mm / tile_mm))
        for k in range(n + 1):
            p = k * tile_mm * self.ppm
            i = max(0, min(self.px - 1, int(round(p))))
            for x in range(self.px):
                idx = i * self.px + x
                self.r[idx], self.g[idx], self.b[idx] = color
            for y in range(self.px):
                idx = y * self.px + i
                self.r[idx], self.g[idx], self.b[idx] = color

    def save(self, path):
        rows = []
        for y in range(self.px):
            row = bytearray(self.px * 4)
            base = y * self.px
            for x in range(self.px):
                idx = base + x
                row[x * 4:x * 4 + 4] = bytes(
                    (self.r[idx], self.g[idx], self.b[idx], 255))
            rows.append(bytes(row))
        write_png(path, self.px, self.px, rows)


def _capsule_span(ax, ay, bx, by, radius, cy):
    """Return (center_x, half_width_px) of the capsule cross-section."""
    dx, dy = bx - ax, by - ay
    length2 = dx * dx + dy * dy
    if length2 < 1e-12:
        if abs(cy - ay) > radius:
            return None, 0.0
        half = math.sqrt(max(0.0, radius ** 2 - (cy - ay) ** 2))
        return ax, half
    t = max(0.0, min(1.0, ((cy - ay) * dy) / length2))
    px, py = ax + t * dx, ay + t * dy
    perp = abs(cy - py)
    if perp > radius:
        return None, 0.0
    half = math.sqrt(max(0.0, radius ** 2 - perp * perp))
    return px, half


def render_png(layout, path, tiles=1, px_per_mm=6.0):
    size = layout.tile * tiles
    img = Raster(size, px_per_mm)
    for tx in range(tiles):
        for ty in range(tiles):
            ox, oy = tx * layout.tile, ty * layout.tile
            for st in layout.stitches:
                if st.color == NEEDLE_COLOR:
                    img.line((ox + st.a[0], oy + st.a[1]),
                             (ox + st.b[0], oy + st.b[1]),
                             0.35, (120, 110, 120), alpha=110)
                    continue
                img.line((ox + st.a[0], oy + st.a[1]),
                         (ox + st.b[0], oy + st.b[1]),
                         layout.line_width, st.color)
            for pt in _dedup_points(layout.all_points()):
                img.dot((ox + pt[0], oy + pt[1]),
                        max(0.32, layout.line_width * 0.16), NEEDLE_COLOR)
    img.frame(layout.tile)
    img.save(path)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main(out_dir="artifacts"):
    os.makedirs(out_dir, exist_ok=True)
    base = build_layout()
    checks = {
        "stitch_length": check_stitch_lengths(base),
        "jump_stitch": check_jumps(base),
        "back_stitch": check_backstitches(base),
        "four_edge_seam": check_seams(base),
    }
    base_metrics = density_metrics(base)

    width_study = {}
    for width in (1.0, 1.6, 2.4, 3.2):
        alt = relayout_for_width(width)
        protected = R_PROTECT + width * 0.5
        exclusion = protected + width * 0.5
        width_study[f"{width:.1f}mm"] = {
            "spacing_mm": round(max(5.5, width * 4.8), 2),
            "protected_radius_mm": round(protected, 2),
            "center_violations": _protected_violations(
                alt, exclusion),
            **density_metrics(alt),
            "density_pass": density_pass(density_metrics(alt)),
        }

    report = {
        "parameters": {
            "tile_mm": TILE,
            "line_width_mm": base.line_width,
            "stitch_target_mm": STITCH_TARGET,
            "stitch_band_mm": [STITCH_MIN, STITCH_MAX],
            "jump_limit_mm": JUMP_MAX,
            "backstitch_ratio_limit": BACKSTITCH_RATIO_MAX,
            "protected_radius_mm": R_PROTECT,
            "colors": {"A": COLOR_A, "B": COLOR_B},
        },
        "base_metrics": base_metrics,
        "checks": checks,
        "all_checks_pass": all(item["pass"] for item in checks.values()),
        "density_bands": {
            "point_density": POINT_DENSITY_BAND,
            "thread_density": THREAD_DENSITY_BAND,
        },
        "line_width_relayout": width_study,
        "scaling_study": scaling_study(base),
    }
    report["scaling_relayout_all_pass"] = all(
        row["relayout"]["density_pass"] and row["relayout"]["stitch_band_pass"]
        for row in report["scaling_study"])

    render_svg(base, os.path.join(out_dir, "pattern.svg"))
    render_svg(base, os.path.join(out_dir, "pattern_2x2.svg"), tiles=2)
    render_png(base, os.path.join(out_dir, "pattern.png"))
    render_png(base, os.path.join(out_dir, "pattern_2x2.png"), tiles=2)
    with open(os.path.join(out_dir, "validation_report.json"), "w",
              encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)
    return report


def _protected_violations(layout, limit):
    violations = 0
    for st in layout.stitches:
        if st.motif:
            continue
        if st.color == NEEDLE_COLOR:
            continue
        if segment_point_distance(st.a, st.b, CENTER) < limit - 1e-9:
            violations += 1
    return violations


if __name__ == "__main__":
    summary = main()
    print(json.dumps({
        "all_checks_pass": summary["all_checks_pass"],
        "scaling_relayout_all_pass": summary["scaling_relayout_all_pass"],
        "base_metrics": summary["base_metrics"],
        "checks": summary["checks"],
    }, ensure_ascii=False, indent=2))
