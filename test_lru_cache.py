"""LRU 缓存行为测试：命中复用、参数失效、清空无残留、容量淘汰。"""

from lru_cache import LRUCache


def test_hit_reuses_value():
    c = LRUCache(4)
    c.put(("texture", (256, 0.3, "green")), "tex-A", 100)
    assert c.get(("texture", (256, 0.3, "green"))) == "tex-A"
    assert c.hits == 1 and c.misses == 0
    assert c.memory_bytes == 100


def test_param_change_invalidates():
    c = LRUCache(4)
    old_key = ("texture", (256, 0.3, "green"))
    new_key = ("texture", (512, 0.3, "green"))
    c.put(old_key, "tex-A", 100)
    assert c.get(new_key) is None
    assert c.invalidate(old_key) is True
    assert c.get(old_key) is None
    assert c.invalidate(old_key) is False
    assert c.size == 0 and c.memory_bytes == 0


def test_lru_eviction_order():
    c = LRUCache(2)
    c.put("a", 1, 10)
    c.put("b", 2, 10)
    c.get("a")
    c.put("c", 3, 10)
    assert c.get("b") is None
    assert c.get("a") == 1
    assert c.get("c") == 3
    assert c.memory_bytes == 20


def test_clear_leaves_no_residual_nodes():
    freed = []
    c = LRUCache(8, on_evict=freed.append)
    for i in range(6):
        c.put(("audio", (i,)), f"wav-{i}", 50)
    assert c.node_count() == 6
    c.clear()
    assert c.size == 0
    assert c.node_count() == 0
    assert c._head is None and c._tail is None
    assert len(c._map) == 0
    assert c.memory_bytes == 0
    assert sorted(freed) == [f"wav-{i}" for i in range(6)]
    c.put("x", 1, 5)
    assert c.get("x") == 1


def test_overwrite_same_key_replaces_node():
    c = LRUCache(4)
    c.put("k", "v1", 10)
    c.put("k", "v2", 20)
    assert c.size == 1 and c.node_count() == 1
    assert c.get("k") == "v2"
    assert c.memory_bytes == 20
