# Sprint 2 — Context 检索契约与演示（B 模块）

Group 2 · inspector · B 上下文 · 桃喜芒芒 (transparent-white)

本文档是 B（上下文检索）与 C（真实模型 review）之间的字段对齐说明，并附一个「从指定提交读取相关定义」的可复现案例。字段的唯一来源是 `src/review/contracts.ts`。

## 1. 证据字段：`ContextSnippet` → `Finding.evidenceIds`

B 产出的每个 `ContextSnippet` 是模型 finding 的「证据」。C 的 `Finding.evidenceIds` 通过 `id` 引用它。

| 字段 | 含义 | 约束 |
| --- | --- | --- |
| `id` | 唯一证据 id（`C0`/`C1`…） | 一次运行内稳定且不重复；`evidenceIds` 不得悬空 |
| `file` | 仓库内相对路径 | 来自 head 或 diffBase 版本 |
| `ref` | 该片段实际读取的提交 SHA | 只能是 `input.headSha` 或 `input.diffBaseSha` |
| `startLine` / `endLine` | 行号闭区间 | 对应 `ref` 版本的真实行号 |
| `code` | 该区间原文 | `\n` 连接，不含末尾换行 |
| `reason` | `local-window`（改动附近）或 `direct-definition`（import 的直接定义） | — |

LEFT/RIGHT 约定（`test/review/sprint1-integrity.test.ts:79` 已锁死，C 必须保持一致）：

- RIGHT 侧 finding 的证据必须引用 `headSha`；LEFT 侧引用 `diffBaseSha`。
- 证据 `ref` 与 finding `side` 不匹配会被判失败，不能借 head 内容冒充 LEFT。

## 2. 必要遗漏 vs 可选裁剪：`Omission.required`

`Omission.required` 区分「必要内容缺失」与「可选裁剪」，B 只产生以下四种 reason：

| reason | required | 含义 | 对结果的影响 |
| --- | --- | --- | --- |
| `FILE_READ_FAILED` | **true** | head 文件读取失败（ENOENT/403/其它） | 必要缺失 |
| `FILE_BUDGET` | **true** | 超过 `maxFiles` | 必要缺失 |
| `CONTEXT_BUDGET` | false | 定义/窗口超过预算被裁剪 | 已尽力，可接受 |
| `OPTIONAL_CONTEXT_UNAVAILABLE` | false | 可选定义读不到或无法解析 | 可接受 |

关键约定（`src/pipeline.ts:20` `deriveAnalysisStatus`）：

- 任一 `required: true` 的 omission → `analysisStatus = PARTIAL`（无任何可分析文件时为 `FAILED`）。
- 因此「必要内容缺失」绝不会被解释为 `COMPLETE` / 安全通过，必须走人工接管或明确失败。

## 3. 演示：从指定提交读取相关定义

以 `clean-context` fixture（`test/fixtures/sprint1/development/clean-context/`）为例，说明 B 如何在**固定 head SHA** 上取回跨文件定义。

PR 改 `src/caller.ts`：

```diff
--- a/src/caller.ts
+++ b/src/caller.ts
@@ -1,5 +1,5 @@
 import { isAllowed } from "./rules.js";

 export function canDelete(role: string) {
-  return isAllowed(role);
+  return Boolean(isAllowed(role));
 }
```

head 版本（`ref = headSha`）的文件内容：

```ts
// src/caller.ts
import { isAllowed } from "./rules.js";

export function canDelete(role: string) {
  return Boolean(isAllowed(role));
}
```

```ts
// src/rules.ts
export function isAllowed(role: string) {
  return role === "admin";
}
```

`collectContext` 在 `headSha` 上读取，产出两条证据：

| id | file | ref | 行号 | reason | 说明 |
| --- | --- | --- | --- | --- | --- |
| `C0` | `src/caller.ts` | `headSha` | 1–5 | `local-window` | 改动行附近 |
| `C1` | `src/rules.ts` | `headSha` | 1–3 | `direct-definition` | `isAllowed` 的直接定义 |

路径解析：`import { isAllowed } from "./rules.js"` 来自 `.ts` 文件，`resolveCandidates` 先试 `rules.js`（不存在，ENOENT），再回退到 `rules.ts`，命中 `export function isAllowed`，按 `headSha` 读取。

复现：`npx jest test/review/context.test.ts -t "clean-context"`。真实 CommonJS 导出（`require`/`exports.*`）的「从冻结快照读取定义」案例见同一测试文件的 `DEV-001`、`DEV-003`、`DEV-011`、`DEV-013`。

## 4. 与 C（李宗蔚）的核对点

1. `Finding.evidenceIds` 是否严格引用 `ContextSnippet.id`，且遵守 LEFT=`diffBaseSha` / RIGHT=`headSha` 的约束。
2. C 的 `ModelAnalysis.omissions` 与 B 的 `ContextResult.omissions` 在 `pipeline.ts:115` 合并后，`required: true` 是否被 C 侧同样保留（不覆盖、不降级为可选）。
3. C 是否还需要 B 在 snippet 之外提供额外元数据（如每个 snippet 的 token 估计、来源说明）；当前 B 只提供契约内字段。
