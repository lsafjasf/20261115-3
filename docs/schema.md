# Project schema v1

## 根对象

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `schemaVersion` | integer | 是 | 当前仅支持 `1` |
| `project` | object | 是 | 工程主体 |

根对象中的其他字段会作为未知字段保留。

## project

| 字段 | 类型 | 必填 | 默认值/限制 |
| --- | --- | --- | --- |
| `id` | string | 是 | 1–128 字符 |
| `name` | string | 是 | 1–200 字符 |
| `description` | string | 否 | `""`，最多 5000 字符 |
| `createdAt` | ISO 8601 string | 否 | `null` |
| `updatedAt` | ISO 8601 string | 否 | `null` |
| `settings` | object | 否 | 使用下列默认设置 |
| `nodes` | array | 是 | 最多 2000 项 |
| `edges` | array | 是 | 最多 10000 项 |
| `assets` | array | 否 | `[]`，最多 2000 项 |

## settings

| 字段 | 类型 | 默认值 | 允许值 |
| --- | --- | --- | --- |
| `theme` | string | `"system"` | `system`, `light`, `dark` |
| `autosave` | boolean | `true` | — |
| `gridSize` | integer | `20` | 5–200 |
| `snapToGrid` | boolean | `true` | — |
| `locale` | string | `"zh-CN"` | 最多 32 字符 |

## nodes[]

| 字段 | 类型 | 必填 | 默认值/限制 |
| --- | --- | --- | --- |
| `id` | string | 是 | 1–128 字符，节点内唯一 |
| `type` | string | 否 | `"task"`；`task`, `note`, `milestone` |
| `title` | string | 是 | 1–240 字符 |
| `x` | number | 否 | `0`；±1,000,000 |
| `y` | number | 否 | `0`；±1,000,000 |
| `width` | number | 否 | `160`；1–100,000 |
| `height` | number | 否 | `96`；1–100,000 |
| `tags` | string[] | 否 | `[]`；最多 20 项，每项最多 40 字符 |
| `data` | object | 否 | `{}`，内容自由 |

## edges[]

| 字段 | 类型 | 必填 | 默认值/限制 |
| --- | --- | --- | --- |
| `id` | string | 是 | 1–128 字符，连线内唯一 |
| `from` | string | 是 | 必须引用存在的节点 ID |
| `to` | string | 是 | 必须引用存在的节点 ID |
| `label` | string | 否 | `""`，最多 240 字符 |
| `data` | object | 否 | `{}`，内容自由 |

## assets[]

| 字段 | 类型 | 必填 | 默认值/限制 |
| --- | --- | --- | --- |
| `id` | string | 是 | 1–128 字符，资源内唯一 |
| `name` | string | 否 | `"未命名资源"`，最多 200 字符 |
| `kind` | string | 否 | `"other"`；`image`, `document`, `audio`, `video`, `other` |
| `path` | string | 是 | 1–2048 字符 |
| `sizeBytes` | integer | 否 | `0`；非负安全整数 |
| `metadata` | object | 否 | `{}`，内容自由 |

## 安全默认值原则

- 仅对可选字段补默认值；缺失必填字段仍使整个导入失败。
- 类型错误或越界值会产生错误，同时用安全值继续构造，避免校验代码自身崩溃。
- 任一错误都会使 `ok=false` 且 `project=null`，页面不会应用半成品数据。
- `data` 和 `metadata` 是显式自由对象，内部键不参与未知字段告警。
- 超过数组上限的数组不会被逐项遍历，避免超大文件阻塞页面。

## 未知字段

除上述字段和自由对象内容外，其他键都记录为：

```js
{
  path: "$.project.nodes[0].futureNodeField",
  value: { "accent": "violet" }
}
```

它们同时产生 `UNKNOWN_FIELD_PRESERVED` 警告。`exportProjectDocument(project, unknownFields)` 会把值写回相同路径。
