# 模型响应校验：避免错误 LGTM

2026-11-03 续作：新增 C 模块独立入口（双模式、Finding/证据、共享预算与有限重试），详见 [代码原理与对接](C_MODEL_RELIABILITY_ZH.md)、[GitHub 工作流手册](C_GITHUB_WORKFLOW_ZH.md) 和 [文件地图](C_FILE_MAP_ZH.md)。下文保留 2026-10-26 的原始实现范围和验证记录；新入口尚待 A 接入统一 bot 流水线。

对应 [TODO.md](TODO.md) 中“模型审查与 Findings”的输出校验子任务，以及 [TECH_SPEC.md](TECH_SPEC.md) 中空响应、无 findings、分析失败必须区分的约束。

## 行为

非空 patch 的模型响应必须正常结束（`finish_reason: stop`）、没有 refusal、包含非空内容，并通过 JSON 与字段校验。

| 响应 | 处理 |
| --- | --- |
| `{"reviews": []}` | 有效、明确的无 findings 结果 |
| `{"reviews": [{"lgtm": false, "review_comment": "Potential null access"}]}` | 有效 finding；未给位置时沿用正文反馈 |
| `{"lgtm": true, "review_comment": ""}` | 兼容旧版单条结果 |
| `choices: []`、空 content、refusal | 抛出 `InvalidReviewResponseError` |
| `finish_reason: length/content_filter/tool_calls` 或缺失 | 抛出 `InvalidReviewResponseError`，即使 content 恰好是合法 JSON |
| JSON 语法错误、`{}`、裸数组或缺字段 | 抛出 `InvalidReviewResponseError` |
| `lgtm: "false"`、非字符串评论或 hunk header | 抛出 `InvalidReviewResponseError` |
| `lgtm: false` 但没有实质评论，或 `lgtm: true` 却附带实质评论 | 抛出 `InvalidReviewResponseError` |
| 数组中同时有合法和非法项 | 整体拒绝，避免静默丢失潜在 finding |

`hunk_header` 仍是可选字符串。已有 `createInlineReviewComment` 验证它是否属于当前 patch；位置不可靠的 finding 仍进入正文。错误消息只包含校验原因，不回显模型原文。

## 失败如何传播

`Chat.codeReview` 校验失败 → `bot.ts` 原有 catch 继续抛出 → 跳过 `pulls.createReview` → GitHub Action 原有 `onError` 将退出码设为 1。因此失败响应不会形成新的 LGTM 评论。

这里没有把异常伪装成普通 finding，也没有实现完整的 `ReviewResult`、PARTIAL/FAILED 状态、risk gate 或 GitHub required status。后续模块可按错误类型转成覆盖状态。空 patch 的旧接口行为、缺失/超大 patch 的跳过逻辑、过期审查和证据引用规则仍需后续任务处理；本模块不能证明整个 PR 被充分审查。

## 复现

使用 Node 24，在仓库根目录执行：

```sh
npm ci
npm test -- --runInBand
npm run build
node --check action/index.cjs
```

Windows PowerShell 中使用 `npm.cmd`；原有 build 脚本使用 `rm -rf`，可在 Git Bash 执行，或明确指定 Git Bash 作为脚本 shell：

```powershell
npm.cmd run build --script-shell='C:\Program Files\Git\bin\bash.exe'
```

独立的 `.github/workflows/test-build.yml` 在普通 PR 上运行相同的 test/build，不需要模型凭据。它与现有的模型审查 workflow 分开；现有 `cr.yml` 仍调用上游 Action，切换本组增强版属于后续集成任务。

## 验证记录

2026-10-26，Windows、Git 2.54、Node 24.14、npm 11.9、TypeScript 4.9.5：

- 原有 2 个测试套件：52/52 通过。
- 新增 35 项测试在原版 `src/chat.ts` 上：30 项失败、5 项通过；替换回实现后，共 4 套件、87/87 通过。
- 新增 PR handler 测试验证非法响应不会调用 `pulls.createReview`；显式空 findings 仍能发布正常结果。
- `npm run build` 成功，更新 `action/index.cjs` 与 `action/src/chat.d.ts`。模型 API 全部使用固定 mock，未调用付费服务。
- `tsc --noEmit --incremental false --checkJs false` 通过；完整 `tsc` 仍报告基线已有的 6 个 `.cjs` 类型错误。已在未修改的原版适配器上复现同样错误，不将其描述为完整类型检查通过。

基线 `npm ci` 因缺少 21 个 esbuild 0.17.11 平台可选包而失败，补齐锁文件后安装成功。没有更改已有包版本或 `package.json`。
