"""Tileable per-pixel texture editor (pure standard library).

Layers: base color, noise, cracks, wear. Every brush stroke is applied on a
torus (wrap-around), so edits crossing an edge appear identically on the
opposite edge and the texture stays tileable.
"""

from __future__ import annotations

import json
import math
import random
import struct
import zlib
from dataclasses import dataclass, field


# --------------------------------------------------------------------------- #
# Minimal PNG codec (8-bit RGB / RGBA, filter type 0 on write)
# --------------------------------------------------------------------------- #
def write_png(path: str, width: int, height: int, rgb: bytes, alpha: bytes | None = None) -> None:
    channels = 4 if alpha is not None else 3
    color_type = 6 if alpha is not None else 2
    raw = bytearray()
    if alpha is not None:
        for y in range(height):
            row = y * width * 3
            arow = y * width
            raw.append(0)
            for x in range(width):
                raw += rgb[row + x * 3: row + x * 3 + 3]
                raw.append(alpha[arow + x])
    else:
        for y in range(height):
            raw.append(0)
            raw += rgb[y * width * 3: (y + 1) * width * 3]

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, color_type, 0, 0, 0)
    payload = b"\x89PNG\r\n\x1a\n"
    payload += chunk(b"IHDR", ihdr)
    payload += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    payload += chunk(b"IEND", b"")
    with open(path, "wb") as fh:
        fh.write(payload)


def read_png(path: str) -> tuple[int, int, bytes, bytes | None]:
    """Read an 8-bit RGB/RGBA PNG written by this module (filter 0)."""
    with open(path, "rb") as fh:
        blob = fh.read()
    assert blob[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    pos = 8
    width = height = bit_depth = color_type = 0
    idat = bytearray()
    while pos < len(blob):
        (length,) = struct.unpack(">I", blob[pos:pos + 4])
        tag = blob[pos + 4:pos + 8]
        data = blob[pos + 8:pos + 8 + length]
        pos += 12 + length
        if tag == b"IHDR":
            width, height, bit_depth, color_type = struct.unpack(">IIBB", data[:10])
            assert bit_depth == 8 and color_type in (2, 6)
        elif tag == b"IDAT":
            idat += data
        elif tag == b"IEND":
            break
    channels = 4 if color_type == 6 else 3
    inflated = zlib.decompress(bytes(idat))
    stride = width * channels
    rgb = bytearray(width * height * 3)
    alpha = bytearray(width * height) if channels == 4 else None
    prev = bytearray(stride)
    for y in range(height):
        ftype = inflated[y * (stride + 1)]
        line = bytearray(inflated[y * (stride + 1) + 1: (y + 1) * (stride + 1)])
        assert ftype == 0, "this reader only supports filter-0 PNGs"
        prev = line
        base = y * width * 3
        for x in range(width):
            s = x * channels
            rgb[base + x * 3: base + x * 3 + 3] = line[s:s + 3]
            if alpha is not None:
                alpha[y * width + x] = line[s + 3]
    return width, height, bytes(rgb), bytes(alpha) if alpha is not None else None


# --------------------------------------------------------------------------- #
# Helpers
 # --------------------------------------------------------------------------- #
def _clamp(v: int) -> int:
    return 0 if v < 0 else 255 if v > 255 else v


def _smoothstep(t: float) -> float:
    return t * t * (3.0 - 2.0 * t)


def _value_noise(size: int, cell: int, rng: random.Random) -> list[list[float]]:
    """Seamless value noise on a toroidal grid (values in 0..1).

    Grid coordinates are continuous and wrapped periodically, so samples
    at x=size-1 and x=0 (likewise y) are neighbors sharing an edge.
    """
    gw = max(1, size // cell)
    grid = [[rng.random() for _ in range(gw)] for _ in range(gw)]
    out = [[0.0] * size for _ in range(size)]
    for y in range(size):
        gy = (y / size) * gw
        y0 = int(gy) % gw
        fy = _smoothstep(gy - int(gy))
        for x in range(size):
            gx = (x / size) * gw
            x0 = int(gx) % gw
            fx = _smoothstep(gx - int(gx))
            x1 = (x0 + 1) % gw
            y1 = (y0 + 1) % gw
            top = grid[y0][x0] * (1 - fx) + grid[y0][x1] * fx
            bot = grid[y1][x0] * (1 - fx) + grid[y1][x1] * fx
            out[y][x] = top * (1 - fy) + bot * fy
    return out


def _torus_points(size: int, cx: float, cy: float, radius: int):
    """Yield (x, y, falloff 0..1) for a soft disc on the torus.

    Each destination cell inside the disc is visited once. Distance is
    measured with the shortest wrapped path, so a disc crossing an edge
    deposits the identical falloff on the opposite edge.
    """
    r2 = radius * radius
    span = min(radius, size // 2)
    for yy in range(size):
        wy = yy - cy
        wy -= size * round(wy / size)
        if abs(wy) > span:
            continue
        for xx in range(size):
            wx = xx - cx
            wx -= size * round(wx / size)
            d2 = wx * wx + wy * wy
            if d2 > r2:
                continue
            yield xx, yy, _smoothstep(1.0 - d2 / r2)


# --------------------------------------------------------------------------- #
# Layers
# --------------------------------------------------------------------------- #
@dataclass
class Layer:
    name: str
    size: int
    visible: bool = True
    opacity: int = 255
    blend: str = "normal"
    params: dict = field(default_factory=dict)
    strokes: list = field(default_factory=list)

    def render(self) -> tuple[bytearray, bytearray]:
        raise NotImplementedError

    def to_dict(self) -> dict:
        return {
            "type": type(self).__name__,
            "name": self.name,
            "visible": self.visible,
            "opacity": self.opacity,
            "blend": self.blend,
            "params": self.params,
            "strokes": self.strokes,
        }


class BaseLayer(Layer):
    """Flat base color; the brush paints RGB directly onto pixels."""

    def __init__(self, size: int, color=(120, 90, 60), name="base"):
        super().__init__(name, size, blend="normal",
                         params={"color": list(color)})
        self.pixels = bytearray(size * size * 3)
        for i in range(size * size):
            self.pixels[i * 3:i * 3 + 3] = bytes(color)

    def stroke(self, cx: float, cy: float, radius: int, color, strength: float = 1.0):
        self.strokes.append({"x": cx, "y": cy, "r": radius,
                             "color": list(color), "strength": strength})
        for x, y, fall in _torus_points(self.size, cx, cy, radius):
            k = (y * self.size + x) * 3
            a = fall * strength
            for c in range(3):
                old = self.pixels[k + c]
                self.pixels[k + c] = _clamp(round(old * (1 - a) + color[c] * a))

    def render(self):
        alpha = bytearray(b"\xff" * self.size * self.size)
        return bytearray(self.pixels), alpha


class _MaskLayer(Layer):
    """Common machinery for effect layers driven by a 0..255 strength mask."""

    def __init__(self, name, size, opacity, blend, params, mask_full=True):
        super().__init__(name, size, opacity=opacity, blend=blend, params=params)
        fill = 255 if mask_full else 0
        self.mask = bytearray([fill]) * (size * size)

    def stroke(self, cx: float, cy: float, radius: int, strength: float):
        """strength > 0 builds the effect up, < 0 erases it (toroidal)."""
        self.strokes.append({"x": cx, "y": cy, "r": radius, "strength": strength})
        for x, y, fall in _torus_points(self.size, cx, cy, radius):
            i = y * self.size + x
            delta = round(fall * strength * 255)
            v = self.mask[i] + delta
            self.mask[i] = 0 if v < 0 else 255 if v > 255 else v


class NoiseLayer(_MaskLayer):
    """Seamless value noise, multiplied toward a tint color (grime/granule)."""

    def __init__(self, size: int, seed: int, cell: int = 16,
                 amount: int = 60, tint=(40, 30, 22), name="noise"):
        super().__init__(name, size, opacity=255, blend="multiply",
                         params={"seed": seed, "cell": cell,
                                 "amount": amount, "tint": list(tint)})
        rng = random.Random(seed)
        self._field = _value_noise(size, cell, rng)

    def render(self):
        size = self.size
        rgb = bytearray(size * size * 3)
        amount = self.params["amount"]
        tint = self.params["tint"]
        for i in range(size * size):
            n = self._field[i // size][i % size]
            m = self.mask[i] / 255.0
            factor = 1.0 - (n * amount / 255.0) * m
            for c in range(3):
                rgb[i * 3 + c] = _clamp(round(tint[c] + (255 - tint[c]) * factor))
        return rgb, bytearray(self.mask)


class CrackLayer(_MaskLayer):
    """Seamless jagged cracks along random toroidal polylines."""

    def __init__(self, size: int, seed: int, count: int = 6, jitter: int = 10,
                 color=(22, 16, 12), width: int = 1, name="cracks"):
        super().__init__(name, size, opacity=255, blend="normal",
                         params={"seed": seed, "count": count,
                                 "jitter": jitter, "color": list(color),
                                 "width": width},
                         mask_full=False)
        rng = random.Random(seed)
        for _ in range(count):
            self._grow_crack(size, rng, jitter, width)

    def _grow_crack(self, size, rng, jitter, width):
        steps = rng.randint(size // 4, size // 2)
        angle = rng.uniform(0, 6.2831853)
        x = rng.uniform(0, size)
        y = rng.uniform(0, size)
        for _ in range(steps):
            angle += rng.uniform(-0.6, 0.6)
            x = (x + rng.uniform(1.5, 3.5) * _cos(angle)) % size
            y = (y + rng.uniform(1.5, 3.5) * _sin(angle)) % size
            jx = rng.randint(-jitter // 2, jitter // 2)
            jy = rng.randint(-jitter // 2, jitter // 2)
            px, py = int(x) % size, int(y) % size
            for ox, oy, fall in _torus_points(size, px + jx, py + jy, width):
                i = oy * size + ox
                self.mask[i] = max(self.mask[i], round(255 * fall))

    def render(self):
        size = self.size
        color = self.params["color"]
        rgb = bytearray(size * size * 3)
        for i in range(size * size):
            rgb[i * 3:i * 3 + 3] = bytes(color)
        return rgb, bytearray(self.mask)


class WearLayer(_MaskLayer):
    """Lightened chipped/abraded patches, grown from random seeds."""

    def __init__(self, size: int, seed: int, spots: int = 10,
                 radius: int = 6, lighten: int = 70, name="wear"):
        super().__init__(name, size, opacity=255, blend="screen",
                         params={"seed": seed, "spots": spots,
                                 "radius": radius, "lighten": lighten},
                         mask_full=False)
        rng = random.Random(seed)
        for _ in range(spots):
            cx, cy = rng.uniform(0, size), rng.uniform(0, size)
            r = rng.randint(max(1, radius // 2), radius)
            for ox, oy, fall in _torus_points(size, cx, cy, r):
                i = oy * size + ox
                self.mask[i] = max(self.mask[i], round(255 * fall * rng.uniform(0.6, 1.0)))

    def render(self):
        size = self.size
        lighten = self.params["lighten"]
        rgb = bytearray(size * size * 3)
        for i in range(size * size):
            m = self.mask[i] / 255.0
            v = round(lighten * m)
            rgb[i * 3:i * 3 + 3] = bytes((_clamp(v),) * 3)
        return rgb, bytearray(self.mask)


def _cos(a: float) -> float:
    return math.cos(a)


def _sin(a: float) -> float:
    return math.sin(a)


# --------------------------------------------------------------------------- #
# Document: ordered layers, compositing, export / import
# --------------------------------------------------------------------------- #
LAYER_TYPES = {
    "BaseLayer": BaseLayer,
    "NoiseLayer": NoiseLayer,
    "CrackLayer": CrackLayer,
    "WearLayer": WearLayer,
}


class TextureDocument:
    def __init__(self, size: int):
        self.size = size
        self.layers: list[Layer] = []

    def add(self, layer: Layer) -> Layer:
        self.layers.append(layer)
        return layer

    def set_visible(self, name: str, visible: bool) -> None:
        for layer in self.layers:
            if layer.name == name:
                layer.visible = visible
                return
        raise KeyError(name)

    @staticmethod
    def _blend_pixel(mode: str, dst: tuple[int, int, int],
                     src: tuple[int, int, int]) -> tuple[int, int, int]:
        if mode == "normal":
            return src
        if mode == "multiply":
            return tuple(_clamp(d * s // 255) for d, s in zip(dst, src))
        if mode == "screen":
            return tuple(_clamp(255 - (255 - d) * (255 - s) // 255)
                         for d, s in zip(dst, src))
        raise ValueError(mode)

    def composite(self) -> tuple[bytearray, bytearray]:
        size = self.size
        n = size * size
        rgb = bytearray(b"\x00" * (n * 3))
        alpha = bytearray(n)
        for layer in self.layers:
            if not layer.visible:
                continue
            lrgb, lalpha = layer.render()
            layer_op = layer.opacity / 255.0
            for i in range(n):
                a = lalpha[i] / 255.0 * layer_op
                if a <= 0.0:
                    continue
                k = i * 3
                src = tuple(lrgb[k + c] for c in range(3))
                dst = tuple(rgb[k + c] for c in range(3))
                blended = self._blend_pixel(layer.blend, dst, src)
                out_a = a + (alpha[i] / 255.0) * (1 - a)
                if out_a <= 0.0:
                    continue
                for c in range(3):
                    premix = blended[c] * a + dst[c] * (alpha[i] / 255.0) * (1 - a)
                    rgb[k + c] = _clamp(round(premix / out_a))
                alpha[i] = _clamp(round(out_a * 255))
        return rgb, alpha

    def export_png(self, path: str) -> None:
        rgb, alpha = self.composite()
        write_png(path, self.size, self.size, bytes(rgb), bytes(alpha))

    def export_params(self, path: str) -> None:
        data = {
            "size": self.size,
            "layers": [layer.to_dict() for layer in self.layers],
        }
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2, sort_keys=True)

    @classmethod
    def from_params(cls, path: str) -> "TextureDocument":
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        doc = cls(data["size"])
        for spec in data["layers"]:
            cls_type = LAYER_TYPES[spec["type"]]
            p = spec["params"]
            if spec["type"] == "BaseLayer":
                layer = cls_type(data["size"], color=tuple(p["color"]),
                                 name=spec["name"])
            elif spec["type"] == "NoiseLayer":
                layer = cls_type(data["size"], p["seed"], p["cell"],
                                 p["amount"], tuple(p["tint"]), spec["name"])
            elif spec["type"] == "CrackLayer":
                layer = cls_type(data["size"], p["seed"], p["count"],
                                 p["jitter"], tuple(p["color"]), p["width"],
                                 spec["name"])
            else:  # WearLayer
                layer = cls_type(data["size"], p["seed"], p["spots"],
                                 p["radius"], p["lighten"], spec["name"])
            layer.visible = spec["visible"]
            layer.opacity = spec["opacity"]
            layer.blend = spec["blend"]
            for stroke in spec["strokes"]:
                if spec["type"] == "BaseLayer":
                    layer.stroke(stroke["x"], stroke["y"], stroke["r"],
                                 tuple(stroke["color"]), stroke["strength"])
                else:
                    layer.stroke(stroke["x"], stroke["y"], stroke["r"],
                                 stroke["strength"])
            doc.add(layer)
        return doc
