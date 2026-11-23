# Sprint2 评测证据核查与执行边界

核查日期：2026-11-22。代码基线：`0c1a0b6c01df0b22145ab0cd3077f79b71eea6d4`。本页是证据核查材料；用户已确认 20 个开发样例与 AI 输出一致，不代表已经完成真实模型输出评分或正式验收。

本轮流程：**先 AI 生成结果，然后由我人工复核。** 本轮只需用户本人复核，记录已复核状态、证据和内容指纹，不记录姓名或复核日期。20 个样例已登记 reviewed，但仍属于 development；真实模型输出评分和独立 heldout 实验没有完成。

## 1. 分工与证据矩阵

F 负责样例、实验、人工评分、可复算结果和验收证据汇总。A/D 负责可靠性实现及真实门禁验收，B 负责检索，C 负责模型和资源控制，E 负责产品审查报告。F 不重复实现这些模块，也不以自己的评分器代替门禁验收。

| 材料 | 已有事实 | 能说明什么 | 不能据此宣称什么 |
| --- | --- | --- | --- |
| [评测数据与工具](../README.md)、[原始控制实验](../reports/control-v0.2/) | 12 家族、20 快照、8 个缺陷根因；113 次行为检查，其中 17 次是预期的合同违反。当前 20 例已获单人确认，标签为 reviewed；历史控制记录仍对应旧 provisional 快照 | 样例行为可复现；运行、留痕、评分管道可执行 | 17 个独立缺陷、独立 heldout 成绩、真实模型成绩 |
| [GPT 路线记录](../../docs/SPRINT2_MODEL_RUNS.json) | `offline` 是 9 个模拟场景；`live` 两种模式均 HTTP 403；`previousProvider` 返回无效内容 | 模拟预算/重试分支与真实服务失败有记录 | 模拟成功就是模型成功；403 能评价缺陷发现能力 |
| [DeepSeek 路线记录](../../docs/SPRINT2_MODEL_DEEPSEEK_RUNS.json) | 9 个模拟场景；真实 `liveAttempts` 两种模式均 HTTP 401 | 本地分词/故障路径和鉴权失败证据 | 真实成功评测或模型质量结论 |
| [RelayCore 本地记录](../../docs/SPRINT2_MODEL_RELAYCORE_RUNS.json) | `discount-double-conversion-v1` 真实调用：首版两模式各 1 finding；加输出守卫后 Diff-only 失败、Context 完成且 1 finding | 一个缺陷 fixture 的真实响应和资源限制观测 | 已人工判定正确、普遍的 Context 增益；也不能把不同实现版本的两次试跑混为同一轮 |
| [PR #12 真实 Action 对照](https://github.com/CS5351-inspector/context-aware-risk-gated-code-review/actions/runs/44686165232) | 一个 clean 文件，同一 head，两模式各一次；均完成、1 次模型调用、0 finding；Context 确实读取相关定义 | 真实集成链路可用，正常文件上的单次资源观测 | 缺陷召回率、误报率的稳定估计或显著性能优势 |
| [HIGH 生命周期记录](../../docs/SPRINT2_GATE_ACCEPTANCE.md#high-risk-approval-lifecycle-observations) | PR #16：普通 Write 批准、换 head、撤销、请求修改的真实状态转换；Markdown policy-only，0 模型调用；后续通过手动重跑协调 | 记录所列权限、SHA、状态和合并按钮行为 | 有模型参与的完整 HIGH 链路；自动审批事件/缓存复用验收；所有并发安全 |
| [可靠性验收矩阵](../../docs/SPRINT2_GATE_ACCEPTANCE.md) | LOW、HIGH 若干转换已有证据；MEDIUM、部分故障和自动审批复用等仍待真实验证 | 可以直接沿用的验收索引 | 两项非功能需求全部通过 |

RelayCore 记录的版本必须保留：首跑 `47f167d69dd6af8fb53cc05e3ac2a76f688ff053`，输出守卫版 `a5e7867b11aaa905b8d560bb44d1087321f77870`。首跑 Diff-only 输出 1740 token，超过配置的 800；守卫版该模式输出 4019 后被标为 `FAILED/TOKEN_BUDGET`，Context 完成，输入/输出为 454/366。失败请求也可能已经产生费用，不能把丢弃响应理解为未发生调用。

## 2. 评分与盲评审查

本次读取了 `lib/score.cjs`、`lib/plan.cjs`、`lib/runner.cjs`、`cli.cjs`、`adapters/production.ts` 和 [现有协议](PROTOCOL.md)。以下机制已经具备，应继续使用：

- **失败不删除**：已启动的 failed/partial 样例仍计入已知缺陷召回分母；clean success 要求 complete 且没有报告问题。预算未启动的 `not_executed` 单列，不能当成功或当一次真实请求。
- **未知不补零**：worker 失败的 calls/usage/cost 保持 null；汇总同时展示已知小计与未知次数。没有 findings 时 precision 是 N/A，不是 100%。
- **按根因去重**：同一已知缺陷多次出现只计一个命中。新发现影响 precision，但不加入冻结答案的 recall 分母；不计算混合分母 F1。
- **未判定保留范围**：unresolved 产生 precision 上下界，不能自动变成误报或正确。`out_of_scope` 按当前协议仍占 actionable precision 分母，人工评分前要理解这个约定。
- **保持配对**：同 case/trial 的两种条件成对安排，冻结 seed、数据与实现指纹。按家族、分层重采样，不把 buggy/fixed 当两个独立缺陷。当前只有 4 个跨文件缺陷家族；区间只作探索性描述。
- **盲评包隔离**：`blind` 隐去 condition/provider，映射单独保存在 `private/`。只向评分者交付 `review/`，不要同时展示原始分组结果。措辞仍可能暴露条件，不能称完全盲法。
- **答案变动需成对重算**：若 clean 样例出现确认的新缺陷，先修改版本并一致重算两种模式；工具会标出需要重分类的样例，避免只调整有利的一边。

这些机制不能证明人的判断正确。AI 可以给出建议；只有用户实际确认的部分才能登记已复核，本次样例确认不覆盖尚未生成的模型回答。没有 findings 的样例也要检查预期缺陷是否确实成立，避免“未输出所以无须核对答案”。

## 3. 正式试跑前必须处理的口径

| 事项 | 本次发现 | 执行要求 |
| --- | --- | --- |
| token 预算 | Sprint2 配置使用对应模型 tokenizer，加 `chatFramingAllowance:64`；旧评测文档称 exact 不准确 | 将请求预算计数称为“模型内容分词 + 消息封装余量估算”；实际 usage 单独取 provider，未知保持 null。不得冒充计费精确 token |
| 耗时拆分 | 基线桥接将 `metrics.durationMs` 覆盖为检索到 C 完成的总耗时，不能把它当 C 独占耗时 | 本次已增加 `modelDurationMs`、`contextDurationMs`，继续以 durationMs 表示桥接总耗时；旧记录缺失拆分保持未知，不能回填推测值 |
| Action 与组件范围 | PR #12 Context 应用耗时含发布；组件 runner 耗时含进程启动、检索、C，未执行报告/门禁发布 | 两模式采用同一组件边界作核心比较；Action 另列 queue/setup/application/publication，不把两个边界的总耗时相减归因于 Context |
| 输入提示 | 评测桥接给两种模式都追加 public requirement；生产 Action 没有同样的评测后缀 | 冻结 `inspector-c-v1+public-requirement-v1`，明确是“带公开需求说明的组件评测”。需求可能泄露判断线索，不能把跨文件分类当成已证明必须检索 |
| 实际检索 | B2 必须走真实 B；B2-oracle 是全量允许源码诊断 | 不把 oracle 报为 Context 实测。保存 snippets、读取 ref、遗漏与预算；验证行范围及源内容一致 |
| 数据隔离 | 桥接 read port 限定 head，provider 仍是可信本地代码而非 OS 沙箱 | provider 不读取 gold、兄弟版本或整仓库；仅向模型提供被冻结的输入。不要让工具型模型自行浏览评测目录 |
| 费用 | 旧 runner 需要日期明确、模型匹配的费率才允许 live 计划 | 不编造免费费率或账户余额。不确定时先完成离线准备；确认实际渠道费率和上限后冻结 live 配置。费用是估算，不是账单 |
| 数据规模 | 当前 20 例是人工设计的开发样例，一轮单次试跑 | 不宣称真实项目泛化、稳定 p95 或显著提升；先如实报告每例结果及样本限制 |

本次已检查耗时字段及 token 文案修正落盘。交叉审查还发现并由适配器作者修正了两处接入问题：准备器总 token 预留漏加输出余量，导致最后若干配对无法启动；真实 worker 在 `.cache` 工作目录运行时找不到 tokenizer 相对路径资产。准备器现按 runner 同一公式预留，并将原始压缩资产复制到 worker 目录，由 C 的固定 SHA 检查继续校验内容。最终完整测试以统一构建后的验证记录为准。

## 4. F 的下一轮最小交付

1. 人工复核 AI 生成的逐例解释，争议样例修正后重新验证；保留真实复核状态。
2. 冻结本轮已确认样例、同一代码 SHA、模型与有效参数、公开需求后缀、真实 B 版本、计时口径及预算。先选择少量案例跑通，再按预先约定扩展。
3. 保存每次调用原始响应、C findings、检索片段、缺失信息、耗时及 usage；既保留成功也保留失败。真实模型运行不能由模拟 smoke 替代。
4. 先 AI 生成输出判定建议，再由我人工复核；记录 review_status 与逐条 evidence 后用同一 scorer 重算，报告未判定条目。
5. 一页总结分别给出效果、资源、失败与限制；可靠性表引用 A/D 的具体 PR、SHA、run、review 和状态证据，待验证项继续标记待验证。不要把 F 的组件实验称为完整产品门禁验收。

## 5. 本次核查覆盖与验证记录

- 已阅读本页所引三份模型运行 JSON、RelayCore 配置、可靠性矩阵及上述评分/运行/盲评源码；没有重新触发 GitHub Action，也没有付费模型调用。
- `node evaluation/validate.cjs` 本次通过：12 家族、20 快照、113 次行为检查、17 次预期合同违反、当时 0 已审核快照（审核元数据迁移后的状态以本轮最终验证为准）。
- 单人审核规则迁移后运行 `npm run test:evaluation`：数据验证、严格 TypeScript 检查、桥接重新构建及 54 项测试全部通过；项目 482 项测试、构建与 Action 生成文件一致性检查也通过。新增检查覆盖单人确认、陈旧记录拒绝、待复核评分拒绝、全部 20 案例的双模式接入，以及独立 worker 中的 tokenizer 资源加载。模型响应为脚本化，不是真实推理。完整记录见 [准备验证报告](../reports/sprint2-preparation/VERIFICATION.md)。
- 上述检查只能验证现有行为和代码约束，不替代人工答案复核、真实服务复现或可靠性现场验收。
- 本次另只读检查了新增适配器、配置准备器、测试及执行说明；24 份新增复核／执行 Markdown 的本地链接有效，初始复核包列出 118 个源文件。单人审核元数据迁移后，现收据覆盖 138 个文件（增加 20 份内容绑定复核记录）；保留原有摘要供核对，需求、源码、标准答案及行为检查语义未改变。该覆盖不等于再次独立审核全部 20 例语义；逐例源码语义审查覆盖由复核包自身记录。

已核查的模型原始记录 SHA-256（文件改动后需重核）：

| 文件 | SHA-256 |
| --- | --- |
| `docs/SPRINT2_MODEL_RUNS.json` | `9745ceacdfd00947fdecd28b55785a806bf359ca24e825dd0e34e4a8a75ee3d7` |
| `docs/SPRINT2_MODEL_DEEPSEEK_RUNS.json` | `632a78b76f81445080c45748fc17f57037bf55130a32361e192c940cb1e71a18` |
| `docs/SPRINT2_MODEL_RELAYCORE_RUNS.json` | `005fe9d81736e9a9794cb9b147f43e16e818b36e47fe4c4ae827fe573be030da` |
