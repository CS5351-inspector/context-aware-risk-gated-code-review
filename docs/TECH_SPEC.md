# inspector 技术规范

范围：GitHub TS/JS Pull Request 的 Context-Aware 审查与可解释风险管理。本文区分正确性约束、团队策略和待验证参数，不预先承诺效率提升。

## 运行与构建

沿用现有 TypeScript、Jest 和构建流程。固定基线的 Action runtime 为 Node 24，入口为 `action/index.cjs`；修改源码后重新构建并提交对应产物。工程 CI 明确执行 test/build，模型 API 烟雾测试单独运行。保留原 LICENSE 和上游归属。

## 提交与证据

一次审查固定目标分支快照 `baseSha`、实际 diff 比较基准 `diffBaseSha` 和被审查版本 `headSha`。PR diff 的比较基准可能是 merge-base，不应直接用后来变化的 main 代替。

新增侧代码和证据使用 `headSha`；旧侧及删除行证据使用实际 diff 基准。片段记录 `ref`，finding 记录 `side`（LEFT/RIGHT）与正确的行坐标。报告和 gate 绑定被审查的 `headSha`；发布前核对当前 head，过期运行不得放行新提交。

## 分析范围与状态

`COMPLETE` 表示声明支持范围内的必要分析完成，不代表整个仓库已充分审查。声明不支持的文件类型，以及可选上下文因预算裁剪，应披露范围，不必全部转为失败。

必要 diff、必要证据缺失或部分模型调用失败为 `PARTIAL`；没有可用分析结果为 `FAILED`。无 findings、空响应和分析失败分别表示。输出校验失败不得直接生成 LGTM。已发现的 HIGH 保留；分析不足且无法形成完整风险判断时显示 UNKNOWN。

## 统一数据

| 对象 | 最小字段 |
| --- | --- |
| PR 输入 | repo、prNumber、baseSha、diffBaseSha、headSha、diff、changedFiles |
| ContextSnippet | id、file、ref、startLine、endLine、code、reason |
| Finding | id、file、side、line（可空）、severity、message、evidenceIds |
| ReviewResult | headSha、mode、analysisStatus、scope、omissions、findings、risk、gate |
| 运行记录 | 模型及有效参数、prompt/规则版本、耗时、usage（缺失标未知） |

`severity` 为 low/medium/high；`mode` 为 diff-only/context。risk 与 gate 分开保存，risk 包含等级、因素和规则版本，gate 包含状态、理由及批准条件。位置或证据未验证的结果应明确标记或降级，不编造链接。

## 上下文与资源预算

文件数、上下文大小、模型输入 token、调用次数、超时和重试均配置化。字节或行数限制用于约束读取量，不能代替模型的 token 上限；应预留输出 token 和请求开销。

5 个文件、200 行、40 KB、90 秒等数值仅可作为试跑候选，不是已验证的推荐值。基线按文件调用模型，因此必须先确定调用预算按文件还是整个 PR 计算，再决定是否批处理。重试消耗总流程剩余预算，并预留 GitHub 反馈时间。对比实验前测量并冻结配置。

## 风险与门禁

风险规则是审查优先级的启发式判断，不是缺陷概率。阈值、敏感路径和所需批准数量配置化，报告实际触发理由。风险等级 LOW/MEDIUM/HIGH/UNKNOWN 与分析覆盖分开。

| 条件 | 默认演示行为 |
| --- | --- |
| COMPLETE + LOW/MEDIUM | Gate 通过；仍满足仓库普通 PR 规则 |
| HIGH、UNKNOWN 或必要分析 PARTIAL/FAILED | 等待配置数量的有效人工批准，满足后通过 |
| 无效配置 | 明确错误；修复配置并重跑 |
| 新提交、批准撤销或有效请求修改 | 重新评估，旧运行不能放行新提交 |

真正限制合并需要命名状态 `inspector/risk-gate` 与仓库 required status 规则共同生效。等待用 pending，可发布的运行错误用 failure；状态写入失败时记录错误并使流程失败，不报告发布成功。使用普通 Write 成员验收，记录管理员绕过条件。

## 人工批准策略

仅计仓库 Write 或更高权限的人类 reviewer，排除作者和 Bot，按有效 review 状态计算。`COMMENTED` 不算新批准，也不应仅因出现评论而删除原有有效批准；有效 `CHANGES_REQUESTED` 或撤销必须反映到门禁。

第一版演示可采用严格策略：只接受当前 head SHA 的批准，新提交要求重新批准。这是团队可选策略，不是 GitHub 所有批准行为的通用定义；评测应记录因此增加的批准次数和等待时间。

## 验证与完成标准

原版固定 commit 单独保留。受控 Diff-only 与 Context 比较使用同样样本、模型、有效参数和共同 prompt，只改变上下文供给；完整产品另测风险门禁和人工审阅。开发样例与独立评价样例分开，保留失败和负结果。

人工效率至少同时记录审阅耗时及判断正确性，避免仅以评论数量或 AI 延迟推断效率。风险规则与 gate 生命周期分别测试，不把“符合自己写的规则”当成规则能正确预测风险的证据。

自动测试使用固定响应，不依赖付费 API；API Key 使用 Secrets。可靠性验证失败/过期结果不产生错误放行；效率验证资源预算和实测开销。完成需真实 PR 链路、有效人工解锁、新提交重算、测试/build 通过，以及另一成员能按 README 复现。

## 核查依据

固定基线：`8bd66227f057f21e847a8c27c9b356c25271d292`。源码核查日期：2026-10-13；测试和构建实际结果由开发任务记录。

- [package.json](https://github.com/CS5351-inspector/context-aware-risk-gated-code-review/blob/8bd66227f057f21e847a8c27c9b356c25271d292/package.json)：已有 test/build。
- [Action 配置](https://github.com/CS5351-inspector/context-aware-risk-gated-code-review/blob/8bd66227f057f21e847a8c27c9b356c25271d292/action.yml)：Node 24 和打包入口。
- [现有 workflow](https://github.com/CS5351-inspector/context-aware-risk-gated-code-review/blob/8bd66227f057f21e847a8c27c9b356c25271d292/.github/workflows/cr.yml)：审查调用上游 Action。
- [chat.ts](https://github.com/CS5351-inspector/context-aware-risk-gated-code-review/blob/8bd66227f057f21e847a8c27c9b356c25271d292/src/chat.ts)：仅 JSON 解析、空 choices 的 LGTM、非 reasoning 模型 temperature=0 的默认表达式等需验证和修正的路径。
- [bot.ts](https://github.com/CS5351-inspector/context-aware-risk-gated-code-review/blob/8bd66227f057f21e847a8c27c9b356c25271d292/src/bot.ts)：按文件审查、跳过 patch 和空反馈报告等需扩展覆盖记录的路径；API 异常已有重抛，不应概括成所有错误都被吞掉。
- [GitHub 分支保护](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)：required checks 与 review 条件。
- [GitHub PR 的比较基准](https://docs.github.com/en/pull-requests/reference/branches#three-dot-and-two-dot-git-diff-comparisons)：PR 使用 merge-base 到 head 的三点比较。
