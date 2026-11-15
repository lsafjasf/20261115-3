"""End-to-end demonstration and verification of the texture editor.

1. Builds a 128x128 document with base / noise / cracks / wear layers.
2. Paints brush strokes that deliberately cross all four edges (toroidal).
3. Exports PNG + layer parameters, re-imports and exports again to prove
   byte-identical, deterministic output.
4. Checks tiled seam continuity numerically and writes a magnified
   2x2 tiled inspection PNG.
5. Toggles each layer's visibility and confirms other layers are unaffected.
"""

from __future__ import annotations

import hashlib
import os

import texture_editor as te
from texture_editor import TextureDocument, read_png, write_png

SIZE = 128
OUT = os.path.join(os.path.dirname(__file__), "artifacts")


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        h.update(fh.read())
    return h.hexdigest()


def build_document() -> TextureDocument:
    doc = TextureDocument(SIZE)
    base = doc.add(te.BaseLayer(SIZE, color=(150, 110, 72), name="base"))
    doc.add(te.NoiseLayer(SIZE, seed=20261115, cell=14, amount=55,
                          tint=(45, 32, 24), name="noise"))
    doc.add(te.CrackLayer(SIZE, seed=4242, count=7, jitter=8,
                          color=(20, 14, 10), width=1, name="cracks"))
    doc.add(te.WearLayer(SIZE, seed=99, spots=12, radius=7,
                         lighten=75, name="wear"))

    # Base-color brush work, including strokes straddling every edge.
    base.stroke(30, 30, 12, (110, 78, 48), strength=0.8)
    base.stroke(2, 64, 10, (96, 64, 40), strength=0.75)
    base.stroke(64, 1, 9, (172, 132, 92), strength=0.7)
    base.stroke(127, 127, 11, (88, 58, 38), strength=0.8)
    base.stroke(95, 80, 7, (186, 148, 104), strength=0.6)

    # Local edits on effect layers; negative strength erases.
    doc.layers[1].stroke(40, 90, 14, 0.9)
    doc.layers[1].stroke(0, 10, 12, 0.85)
    doc.layers[1].stroke(70, 70, 8, -0.8)
    doc.layers[2].stroke(10, 110, 6, 1.0)
    doc.layers[2].stroke(120, 5, 7, 1.0)
    doc.layers[2].stroke(50, 50, 5, -1.0)
    doc.layers[3].stroke(20, 40, 9, 1.0)
    doc.layers[3].stroke(126, 64, 10, 0.9)
    doc.layers[3].stroke(85, 110, 6, -0.9)
    return doc


def write_tiled_inspection(png_path: str, out_path: str,
                           repeats: int = 2, scale: int = 4) -> None:
    w, h, rgb, _alpha = read_png(png_path)
    tw, th = w * repeats, h * repeats
    tiled = bytearray(tw * th * 3)
    for ty in range(th):
        for tx in range(tw):
            src = ((ty % h) * w + (tx % w)) * 3
            dst = (ty * tw + tx) * 3
            tiled[dst:dst + 3] = rgb[src:src + 3]
    up = bytearray(tw * th * scale * scale * 3)
    uw = tw * scale
    for y in range(th * scale):
        for x in range(tw * scale):
            src = ((y // scale) * tw + (x // scale)) * 3
            dst = (y * uw + x) * 3
            up[dst:dst + 3] = tiled[src:src + 3]
    write_png(out_path, uw, th * scale, bytes(up))


def seam_stats(png_path: str) -> dict:
    w, h, rgb, _alpha = read_png(png_path)

    def px(x, y):
        k = (y * w + x) * 3
        return tuple(rgb[k:k + 3])

    def diff(a, b):
        return sum(abs(p - q) for p, q in zip(a, b)) / 3.0

    vertical = [diff(px(w - 1, y), px(0, y)) for y in range(h)]
    horizontal = [diff(px(x, h - 1), px(x, 0)) for x in range(w)]
    interior_v = [diff(px(x, y), px(x + 1, y))
                  for y in range(0, h, 4) for x in range(0, w - 1, 4)]
    interior_h = [diff(px(x, y), px(x, y + 1))
                  for y in range(0, h - 1, 4) for x in range(0, w, 4)]
    return {
        "vertical_seam_mean": round(sum(vertical) / h, 3),
        "horizontal_seam_mean": round(sum(horizontal) / w, 3),
        "vertical_seam_max": round(max(vertical), 3),
        "horizontal_seam_max": round(max(horizontal), 3),
        "interior_adjacent_mean": round(
            (sum(interior_v) + sum(interior_h)) /
            (len(interior_v) + len(interior_h)), 3),
    }


def verify_export_consistency(doc: TextureDocument) -> dict:
    png1 = os.path.join(OUT, "texture.png")
    params1 = os.path.join(OUT, "texture_params.json")
    png2 = os.path.join(OUT, "texture_reexport.png")
    params2 = os.path.join(OUT, "texture_params_reexport.json")
    doc.export_png(png1)
    doc.export_params(params1)
    restored = TextureDocument.from_params(params1)
    restored.export_png(png2)
    restored.export_params(params2)
    h1, h2 = sha256_file(png1), sha256_file(png2)
    p1, p2 = sha256_file(params1), sha256_file(params2)
    return {
        "png_hash_a": h1,
        "png_hash_b": h2,
        "png_identical": h1 == h2,
        "params_identical": p1 == p2,
    }


def verify_visibility_independence(doc: TextureDocument) -> list[dict]:
    baseline = {layer.name: bytes(layer.render()[0]) for layer in doc.layers}
    results = []
    for target in doc.layers:
        doc.set_visible(target.name, False)
        for layer in doc.layers:
            if layer.name == target.name:
                continue
            results.append({
                "hidden": target.name,
                "unchanged_layer": layer.name,
                "pixels_identical":
                    bytes(layer.render()[0]) == baseline[layer.name],
            })
        doc.set_visible(target.name, True)
    return results


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    doc = build_document()

    consistency = verify_export_consistency(doc)
    stats = seam_stats(os.path.join(OUT, "texture.png"))
    write_tiled_inspection(os.path.join(OUT, "texture.png"),
                           os.path.join(OUT, "texture_tiled_4x.png"))
    visibility = verify_visibility_independence(doc)

    print("== export consistency ==")
    for key, value in consistency.items():
        print(f"  {key}: {value}")
    print("== seam continuity (mean per-channel delta) ==")
    for key, value in stats.items():
        print(f"  {key}: {value}")
    print("== layer visibility independence ==")
    for row in visibility:
        print(f"  hide {row['hidden']:7s} -> {row['unchanged_layer']:7s} "
              f"unchanged={row['pixels_identical']}")

    assert consistency["png_identical"], "two PNG exports differ"
    assert consistency["params_identical"], "two param exports differ"
    assert all(row["pixels_identical"] for row in visibility)
    seam_mean = (stats["vertical_seam_mean"]
                 + stats["horizontal_seam_mean"]) / 2
    assert seam_mean <= stats["interior_adjacent_mean"] * 1.25, stats
    print("\nALL CHECKS PASSED")


if __name__ == "__main__":
    main()
