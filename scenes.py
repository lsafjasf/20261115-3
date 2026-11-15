"""五个场景的素材清单与带缓存的资源加载器。"""

from __future__ import annotations

import time
from typing import Callable, Dict, List, Tuple

from assets import Asset, generate_audio, generate_texture
from lru_cache import LRUCache

# 每个场景： (场景名, [纹理参数...], [音频参数...])
# 相邻场景共享部分素材（统一环境音、通用底纹），体现缓存复用价值。
SCENES: List[Tuple[str, List[Tuple], List[Tuple]]] = [
    ("森林", [(256, 0.30, "green"), (512, 0.10, "leaf")],
             [(2.0, 22050, "birds"), (1.0, 22050, "wind")]),
    ("沙漠", [(256, 0.30, "sand"), (512, 0.05, "dune")],
             [(1.0, 22050, "wind"), (1.5, 22050, "heat")]),
    ("海洋", [(256, 0.30, "blue"), (512, 0.20, "wave")],
             [(2.5, 22050, "surf"), (1.0, 22050, "wind")]),
    ("雪山", [(256, 0.30, "white"), (512, 0.15, "ice")],
             [(1.0, 22050, "wind"), (2.0, 22050, "blizzard")]),
    ("火山", [(256, 0.30, "red"), (512, 0.40, "lava")],
             [(1.8, 22050, "rumble"), (1.0, 22050, "wind")]),
]


class AssetManager:
    """通过 LRU 缓存加载场景素材：命中复用，未命中才生成。"""

    def __init__(self, capacity: int = 64) -> None:
        self.cache = LRUCache(capacity)
        self.generated = 0
        self.reused = 0
        self.gen_time_ms = 0.0
        self.wait_ms = 0.0

    def _load(self, kind, params, factory):
        key = (kind, params)
        cached = self.cache.get(key)
        if cached is not None:
            self.reused += 1
            return cached, True
        asset = factory(*params)
        self.cache.put(key, asset, asset.size_bytes)
        self.generated += 1
        self.gen_time_ms += asset.gen_ms
        return asset, False

    def load_scene(self, index: int) -> Dict:
        name, textures, audios = SCENES[index]
        start = time.perf_counter()
        assets: List[Asset] = []
        hits = 0
        for params in textures:
            asset, hit = self._load("texture", params, generate_texture)
            assets.append(asset)
            hits += hit
        for params in audios:
            asset, hit = self._load("audio", params, generate_audio)
            assets.append(asset)
            hits += hit
        wait = (time.perf_counter() - start) * 1000
        self.wait_ms += wait
        return {"scene": name, "assets": assets, "hits": hits,
                "misses": len(assets) - hits, "wait_ms": wait}

    def invalidate_texture(self, params: Tuple) -> bool:
        """参数变化时：旧键失效，下次加载按新参数重新生成。"""
        return self.cache.invalidate(("texture", params))

    def invalidate_audio(self, params: Tuple) -> bool:
        return self.cache.invalidate(("audio", params))
