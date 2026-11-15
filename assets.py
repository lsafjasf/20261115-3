"""本地素材生成器：按参数确定性地生成纹理与音频，并估算内存占用。

生成耗时与参数规模成正比，用于模拟真实生成开销；
参数完全决定键，参数一变键就变，从而触发缓存失效。
"""

from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass
from typing import Hashable, Tuple


@dataclass
class Asset:
    kind: str            # "texture" | "audio"
    params: Tuple        # 生成参数（决定缓存键）
    payload: bytes       # 生成的内容
    size_bytes: int      # 内存估算
    gen_ms: float        # 本次生成耗时（毫秒）

    @property
    def key(self) -> Hashable:
        return (self.kind, self.params)


def _digest(kind: str, params: Tuple, length: int) -> bytes:
    seed = repr((kind, params)).encode("utf-8")
    out = b""
    counter = 0
    while len(out) < length:
        out += hashlib.sha256(seed + counter.to_bytes(4, "big")).digest()
        counter += 1
    return out[:length]


def generate_texture(resolution: int, noise: float, palette: str) -> Asset:
    """纹理：resolution^2 像素，RGBA 4 字节/像素。"""
    params = (resolution, round(noise, 4), palette)
    size = resolution * resolution * 4
    start = time.perf_counter()
    payload = _digest("texture", params, min(size, 4096))  # 采样载荷，避免大内存
    elapsed = (time.perf_counter() - start) * 1000
    elapsed += size / 1e6 * 8  # 模拟与像素数成正比的生成开销
    return Asset("texture", params, payload, size, elapsed)


def generate_audio(duration_s: float, sample_rate: int, waveform: str) -> Asset:
    """音频：16bit 单声道 PCM。"""
    params = (round(duration_s, 3), sample_rate, waveform)
    size = int(duration_s * sample_rate) * 2
    start = time.perf_counter()
    payload = _digest("audio", params, min(size, 4096))
    elapsed = (time.perf_counter() - start) * 1000
    elapsed += size / 1e6 * 5  # 模拟与采样数成正比的生成开销
    return Asset("audio", params, payload, size, elapsed)
