"""带键 LRU 缓存：哈希表 + 双向链表，O(1) 命中复用 / 失效 / 清空。"""

from __future__ import annotations

from typing import Any, Callable, Dict, Hashable, Optional


class _Node:
    __slots__ = ("key", "value", "size", "prev", "next")

    def __init__(self, key: Hashable, value: Any, size: int) -> None:
        self.key = key
        self.value = value
        self.size = size
        self.prev: Optional[_Node] = None
        self.next: Optional[_Node] = None


class LRUCache:
    """按 (资源类型, 参数元组) 为键的 LRU 缓存。

    - get 命中时把节点移到链表头部并复用资源；
    - 参数变化产生新键，旧键可显式 invalidate 或被容量淘汰；
    - clear 后哈希表与链表均清空，不留下残留节点。
    """

    def __init__(self, capacity: int, on_evict: Optional[Callable[[Any], None]] = None) -> None:
        if capacity <= 0:
            raise ValueError("capacity must be positive")
        self.capacity = capacity
        self._map: Dict[Hashable, _Node] = {}
        self._head: Optional[_Node] = None  # 最近使用
        self._tail: Optional[_Node] = None  # 最久未用
        self._on_evict = on_evict
        self.hits = 0
        self.misses = 0
        self._bytes = 0

    # ---- 链表内部操作 ----
    def _detach(self, node: _Node) -> None:
        if node.prev is not None:
            node.prev.next = node.next
        else:
            self._head = node.next
        if node.next is not None:
            node.next.prev = node.prev
        else:
            self._tail = node.prev
        node.prev = None
        node.next = None

    def _push_front(self, node: _Node) -> None:
        node.next = self._head
        node.prev = None
        if self._head is not None:
            self._head.prev = node
        self._head = node
        if self._tail is None:
            self._tail = node

    def _remove(self, node: _Node) -> None:
        self._detach(node)
        del self._map[node.key]
        self._bytes -= node.size
        if self._on_evict is not None:
            self._on_evict(node.value)

    # ---- 对外接口 ----
    def get(self, key: Hashable) -> Optional[Any]:
        node = self._map.get(key)
        if node is None:
            self.misses += 1
            return None
        self.hits += 1
        self._detach(node)
        self._push_front(node)
        return node.value

    def put(self, key: Hashable, value: Any, size: int) -> None:
        node = self._map.get(key)
        if node is not None:  # 同键覆盖：先移除旧节点
            self._remove(node)
        node = _Node(key, value, size)
        self._map[key] = node
        self._push_front(node)
        self._bytes += size
        while len(self._map) > self.capacity:
            assert self._tail is not None
            self._remove(self._tail)

    def invalidate(self, key: Hashable) -> bool:
        """参数变化时精确失效对应键。"""
        node = self._map.get(key)
        if node is None:
            return False
        self._remove(node)
        return True

    def clear(self) -> None:
        """清空缓存：释放所有资源，链表与哈希表均不残留节点。"""
        node = self._head
        while node is not None:
            nxt = node.next
            if self._on_evict is not None:
                self._on_evict(node.value)
            node.prev = None
            node.next = None
            node = nxt
        self._map.clear()
        self._head = None
        self._tail = None
        self._bytes = 0

    # ---- 统计 ----
    @property
    def size(self) -> int:
        return len(self._map)

    @property
    def memory_bytes(self) -> int:
        return self._bytes

    @property
    def hit_rate(self) -> float:
        total = self.hits + self.misses
        return self.hits / total if total else 0.0

    def node_count(self) -> int:
        """遍历链表计数，用于验证 clear 后无残留节点。"""
        count = 0
        node = self._head
        while node is not None:
            count += 1
            node = node.next
        return count
