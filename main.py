"""演示：五个场景间切换两轮，界面实时显示命中率与内存估算。"""

from __future__ import annotations

from scenes import SCENES, AssetManager


def fmt_bytes(n: int) -> str:
    if n >= 1 << 20:
        return f"{n / (1 << 20):.2f} MiB"
    if n >= 1 << 10:
        return f"{n / (1 << 10):.2f} KiB"
    return f"{n} B"


def render_panel(mgr: AssetManager, last: dict) -> None:
    cache = mgr.cache
    bar_width = 30
    filled = int(bar_width * cache.hit_rate)
    bar = "#" * filled + "-" * (bar_width - filled)
    print("  +---------------- 缓存面板 ----------------+")
    print(f"  | 命中率  [{bar}] {cache.hit_rate * 100:6.2f}%")
    print(f"  | 命中/未命中  {cache.hits} / {cache.misses}")
    print(f"  | 缓存条目     {cache.size} / {cache.capacity}")
    print(f"  | 内存估算     {fmt_bytes(cache.memory_bytes)}")
    scene = last["scene"]
    print(f"  | 本次切换     {scene} 命中 {last['hits']} "
          f"未命中 {last['misses']} 等待 {last['wait_ms']:.2f} ms")
    print("  +------------------------------------------+")


def main() -> None:
    mgr = AssetManager(capacity=64)
    rounds = 2
    print(f"开始在 {len(SCENES)} 个场景间切换 {rounds} 轮：\n")
    for r in range(1, rounds + 1):
        print(f"== 第 {r} 轮 ==")
        for i in range(len(SCENES)):
            info = mgr.load_scene(i)
            render_panel(mgr, info)
        print()

    total_assets = sum(len(t) + len(a) for _, t, a in SCENES) * rounds
    print("== 汇总 ==")
    print(f"素材请求总数   {total_assets}")
    print(f"实际生成       {mgr.generated} 次，耗时 {mgr.gen_time_ms:.2f} ms")
    print(f"缓存复用       {mgr.reused} 次")
    print(f"整体命中率     {mgr.cache.hit_rate * 100:.2f}%")
    print(f"缓存内存估算   {fmt_bytes(mgr.cache.memory_bytes)}")
    print(f"切换总等待     {mgr.wait_ms:.2f} ms")

    # 参数变化 -> 旧键失效演示
    print("\n== 参数失效验证 ==")
    old_params = (256, 0.30, "green")
    ok = mgr.invalidate_texture(old_params)
    print(f"森林底纹参数变为 (256, 0.30, 'moss')，旧键失效: {ok}")
    print(f"失效后缓存条目 {mgr.cache.size}，内存 {fmt_bytes(mgr.cache.memory_bytes)}")

    # 清空缓存 -> 无残留节点验证
    print("\n== 清空缓存验证 ==")
    mgr.cache.clear()
    print(f"clear 后: 条目 {mgr.cache.size}，链表节点 {mgr.cache.node_count()}，"
          f"head/tail = {mgr.cache._head}/{mgr.cache._tail}，"
          f"内存 {mgr.cache.memory_bytes} B")


if __name__ == "__main__":
    main()
