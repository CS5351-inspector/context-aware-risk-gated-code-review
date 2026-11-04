# Sprint 1 模块契约候选 v1

状态：供小组评审，不是已经通过的团队决定。代码模型以 `src/review/contracts.ts` 为候选唯一来源；本 PR 不修改 bot/chat/workflow、不实现生产 gate，也不把 TODO 大任务标为完成。

## 接口与契约

接口规定函数的参数与返回类型；契约还规定前置条件、输出保证、错误含义、预算、版本、证据和副作用。TypeScript interface 不自动验证运行时 JSON。

## 范围与关联工作

首版候选范围：GitHub Actions、同仓库 PR、新增/修改 .ts/.js、局部代码与一种有限直接定义检索。其他文件必须披露；整个 PR 的文件清单仍参与风险扫描。fork/删除/重命名的模型审查不在当前候选范围，不能默默当成分析完成。

55 个场景是公开的离线可靠性输入和标准答案，不是观测到的模型表现，不是 55 个真实缺陷。52 个 development 加 3 个 reserved；reserved 不作盲测。PR #4 的 evaluation 数据用于语义缺陷和对照实验，与本资产分开使用、分开计数。真实独立评价集仍需新增。

## A-F 模块边界

- A（repo owner/基建负责人）：公共类型和配置入口、PR 版本快照、GitHub 读取、总预算、汇总状态、统一版本/并发守卫和发布。owner 身份与实际 GitHub 权限需要另行确认。
- B（上下文）：接收 ReviewInput，使用 ReadFileAtRef，返回 ContextResult。代码片段需有 ref、真实起止行和 reason。
- C（模型可靠性）：接收输入与片段，返回 ModelAnalysis。校验 raw JSON、位置、证据；每文件失败形成 omission，不能回报 LGTM。API 运行信息不混入标准答案。
- D（风险门禁）：读取全 PR 规模/路径、完整性、有效 findings、作者、被审查与当前 head、审阅历史，返回 RiskResult/GateResult。不得从普通评论内容取可信 gate 结论。
- E（报告）：接收 ReviewResult，返回文本，区分分析状态/风险/门禁/发布成功。摘要更新与状态写入必须共用 A 的守卫。
- F（评测）：提供固定样例、反例、人工复核及受控实验；各模块自己写测试，F 不代替全组写全部测试。

建议成员对接：PR #2 作者继续 C；PR #4 作者继续 F；PR #3 作者先协助 A 收尾基线/CI/骨架，再承担 B。D 需熟悉权限与状态机的成员，E 可由代码经验较少成员负责。此为分工建议，待确认。

## 交接顺序和函数

A 收集 ReviewInput → B.collectContext → C.reviewFiles → A.deriveAnalysisStatus → D.calculateRisk / decideGate → E.renderReport → A.publishResult。

签名见 contracts.ts。A 必须先验证配置；非法配置不能作为合法 ReviewConfig 传入模块。所有网络/JSON 输入先用 unknown 表示，再由归属模块验证。

## 必要语义

1. ReviewInput.headSha 是被审查版本；diffBaseSha 是实际 diff 基准，不能拿 baseSha 或后来更新的 main 替代。新侧读 headSha，旧侧读 diffBaseSha。ReadFileAtRef 失败必须明确，不得静默返回最新版。
2. GateContext.reviewedHeadSha 必须与 ReviewInput.headSha 相同；prAuthor 必须与 input.author 相同；currentHeadSha 在发布前从 GitHub 重读。这样 D 才能排除作者自批、识别旧运行。
3. Finding.validation 仅表示结构、位置、引用校验状态，不证明模型推理正确。line=null 的问题回退正文并披露；不能编造链接。运行结果中的 snippets 允许引用 head 或 diff 基准，但必须与 side/来源一致。
4. 模型有效空 findings 与空响应完全不同。全成功返回空 findings 可 COMPLETE；必要分析未完成且有可用结果为 PARTIAL；没有可用分析为 FAILED；候选新增状态 NOT_APPLICABLE 用于无支持范围文件，需团队决定是否纳入规范。
5. scope 分为 supportedFiles/analyzedFiles/excludedFiles。omissions 每项含阶段、原因和 required。裁剪可选上下文通常不降级；必要 diff/文件/调用失败必须影响状态。
6. 风险 LOW/MEDIUM/HIGH/UNKNOWN 与门禁 PASS/WAITING/ERROR/STALE 独立；HIGH 经人工批准可 PASS，但仍是 HIGH。已知有效 HIGH 不被其他缺失覆盖为 UNKNOWN。
7. 严格演示批准只计当前 head、非作者的人类 Write+ 成员，按有效历史去重；COMMENTED 不清除批准，撤销/有效请求修改影响门禁。配置无效/过期不能靠批准覆盖。
8. PublicationReceipt 是外部发布回执。Gate PASS 不代表 GitHub 已写入成功。发布失败必须明确；旧结果不得写新 head 的 success，也不能覆盖当前摘要。仅取消旧任务不足以证明不存在竞争。
9. Budget 是候选上限，不是已实现的调度器。A 管整次 PR 剩余时间与发布预留，C 管整次 reviewFiles 的调用计数和重试，B 披露读取/裁剪；不能每个文件各自重复领满额预算。未知 usage 为 null。
10. 本 PR 只含类型和离线工具，没有注册新的 webhook，也没有部署风险门禁。自动测试不使用模型凭据。仓库 required status 配置是后续实际验收项。

## 与 PR #2/#3/#4 的兼容决策

- #2 保留现有 Review/lgtm 协议；C 后续通过显式适配把它转成 Finding，不能仅改类型名字。空响应校验应保留。
- #3 的 src/types.ts 与本候选重复：合并前由 A、B、C、D、E 确认一个规范来源。需要统一 repo 字符串/对象、filename/path、scope/omissions 结构和 gate 状态。建议确认后 #3 引用统一模型；本 PR 不抢改其未合并文件。
- #4 的 evaluation schema 是实验数据格式，可以独立保留，用 exporter/adapter 转成 ReviewInput。不能把 B2-oracle 当成真实上下文检索效果。
- 当前候选状态、人工接管、预算和风险阈值应经小组评审后冻结；不能因为 JSON 中已有预期就当成规则已验证有效。

## 合入前检查

- [ ] A 和各模块负责人确认字段、函数和角色边界。
- [ ] D 确认 NOT_APPLICABLE、人工接管、请求修改和严格 head 批准策略。
- [ ] C 确认空/无效输出与部分失败的标准化形式。
- [ ] F 和另一成员复核样例预期；把协议模拟与语义 gold 分开。
- [ ] 测试/类型检查通过，PR diff 只含契约、样例及说明。

## 本次修正与验证边界

补 GateContext 的作者/被审查 head；按 A基建/B上下文/C模型/D风险/E报告/F评测统一 owners；公开 holdout 改为 reserved；删除文件的 diff 使用 /dev/null；新增 base→head diff 重放及篡改数据的反例测试；检查人工批准的必要约束。

test/support/sprint1-integrity.ts 是针对受控 LF 文本样例的检查，不是任意 Git diff 的生产解析器，也不是生产 Gate 算法。测试通过只证明这些数据和工具在覆盖范围内自洽。
