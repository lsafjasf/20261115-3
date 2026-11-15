# 节点编辑器：生命周期与缓存清理

模拟音频 / 图形节点反复删除与重建的场景。删除节点时会显式释放
三类资源，保证长时间运行后内存不随循环次数增长。

## 资源清理点

1. 事件监听：每个节点的订阅都返回退订函数并登记在 `_disposers`，
   `removeNode` 先调用 `bus.offAllFor(node)`，再执行 `node.dispose()`
   逐个退订；`_runNode` 内还有 `nodes.has(id)` 与 `alive` 双重守卫，
   已删除节点不可能再收到 `tick` 更新。
2. 连接引用：删除前遍历该节点的全部输入 / 输出边，断开时同时清除
   对端 `inputs` / `outputs` 中的反向引用，避免双向引用导致的泄漏。
3. 中间缓冲：每个节点持有 `Float32Array` 工作缓冲，`dispose()` 将
   `buffer` 置空并清空连接表，释放类型数组的后备内存。

## 界面指标

顶部实时显示：当前节点数、连接数、事件监听数、估算缓存量
（缓冲字节 + 边与监听的记账开销）和累计处理帧数。

## 运行方式

```bash
# 固定脚本：50 次增删循环，比较首尾资源数量
node --expose-gc scripts/soak-test.js
# 或 npm run soak

# 浏览器 UI 逻辑的无头冒烟测试
node scripts/app-smoke.js

# 浏览器界面（零依赖静态服务器）
PORT=9823 node scripts/serve.js
# 打开 http://127.0.0.1:9823/
```

## 目录结构

- `src/event-bus.js`：可完全退订的事件总线
- `src/node.js`：节点、工作缓冲与 `dispose`
- `src/node-graph.js`：图、连接清理、`tick` 分发与资源估算
- `public/`：浏览器界面与渲染
- `scripts/soak-test.js`：固定的 50 次循环首尾对比脚本
- `scripts/app-smoke.js`：UI 无头冒烟测试
- `scripts/serve.js`：静态文件服务器
