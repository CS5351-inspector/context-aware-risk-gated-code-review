# Sprint 1 公共接口与离线样例

这是一套供小组评审的公共契约候选与离线验收数据，不是已经接入 GitHub 的新机器人。没有修改现有 bot/chat/workflow，也没有调用付费模型。以下字段、政策和候选预算需要小组确认；未替团队更改 TODO.md 或 TECH_SPEC.md。

## 先按这个顺序阅读

1. `src/review/contracts.ts`：共同表单。专业上是领域数据模型及模块契约；只有 TypeScript 类型，不会自动发请求或检查 JSON。
2. `test/fixtures/sprint1/manifest.json`：场景目录。按 id、owners、split 找需要的例子。
3. `test/fixtures/sprint1/development/context-bug/scenario.json`：完整贯穿例子。
4. 同目录 `base/`、`head/` 下的 `.txt`：实际代码快照，扩展名保留为文本，避免被 Jest/构建器当作项目业务源码。`src/caller.ts.txt` 的逻辑路径仍是 `src/caller.ts`。
5. `test/support/sprint1-fixture.ts`：读取 JSON、模拟指定版本文件读取和模型尝试的测试工具。
6. `test/review/sprint1-fixtures.test.ts` 和 `sprint1-integrity.test.ts`：样例检查和反例检查；不代表生产模块已经实现。
7. `docs/SPRINT1_INTERFACES.md`：公共契约、错误语义、版本约束、分工及与其他 PR 的对齐方案。

## A-F 的接口与交付边界

字母与 Sprint 1 分工一致：A 基建，B 上下文，C 模型，D 风险门禁，E 报告，F 评测。JSON 的 owners 仍用小写字母。

- A：CollectInput、ReviewInput、ReadFileAtRef、DeriveAnalysisStatus、PublishResult。管理 GitHub、版本、总预算、状态汇总和统一发布守卫。公共契约由 A 维护、相关模块负责人共同评审。
- B：CollectContext、ContextSnippet、ContextResult。通过 A 的读取接口选择上下文，记录去重、裁剪和缺失。
- C：ReviewFiles、ModelAnalysis、Finding、RunMetrics。解析并校验模型输出，处理有限重试和每文件分析结果。
- D：CalculateRisk、DecideGate、ApprovalReview、GateContext。离线计算风险与有效批准；发布状态时复用 A 的版本检查与 GitHub 适配。
- E：RenderReport。将结果变成 Markdown，提供摘要更新/截断策略；实际发布与 D 共用 A 的版本和并发守卫。
- F：维护 manifest、scenario.json 和代码快照；标准答案由相关模块负责人复核。各成员自己负责模块测试，F 组织集成和效果评价。

## 共同表单用 Python 怎么理解

`interface ReviewInput` 可以先理解成一种约定好字段的 dict：必须有 repo、headSha 等键；`: string` 是“这个值应该是字符串”。`type CalculateRisk = (...) => RiskResult` 是“接收哪些参数、返回什么”的函数签名，不是风险算法本身。

- ReviewInput：这次检查哪份 PR、哪个版本、哪些文件。
- ContextSnippet：提供给模型的相关代码，含版本、真实行号、选择理由。
- ModelAnalysis：模型阶段的发现、遗漏和运行记录。
- AnalysisResult：a 汇总后的分析状态及范围，不含最终门禁。
- ReviewResult：整次报告所需数据，包括风险和门禁。
- ApprovalReview：完整按时间排序的审阅历史；普通 COMMENTED 不应直接抹掉先前批准。
- PublicationReceipt：GitHub 是否真的接受发布。决策 PASS 与“发布成功”是两回事。
- Budget：总调用、token、超时等候选限制；类型声明不会自动扣减预算。

`unknown` 表示还没有校验的数据。模型和 JSON 输入不能因为写了 TypeScript 类型就自动变可信。使用者必须实现实际运行时校验。

## 场景 JSON 的各部分

- input：模拟 GitHub 输入。SHA 是 40 位合成测试值，不能拿去请求真实 GitHub。
- config：原始配置，可能故意无效，例如负数批准人数；正式模块需要先校验。
- snapshots：逻辑文件路径＋ref 对应哪个真实 `.txt` 快照，或模拟读取错误。
- modelAttempts：模拟提供商的 content/choices/usage 及错误序列；是原始内容层，不是规范化 Finding，也不是完整 OpenAI HTTP 报文。
- gateContext：被审查 head、PR 作者、发布前当前 head 和完整审阅记录；前三者分别用于版本绑定、排除作者自批和过期判断。
- preflight：注入的已测 token 数、剩余调用次数及可选剩余分析时间。短代码的 token-budget 场景不声称真正有 6001 token，是专门测试预算分支。
- github：已有评论 id、模拟发布权限错误。
- expected.context：B 应产生的片段和遗漏。
- expected.result：各模块最终应该共同得到的结果，是验收标准，不是机器人真实运行输出。
- expected.publication：a 发布阶段的预期回执，不能用 gate PASS 冒充发布成功。
- expected.report：e 的语义要求，不锁定整段排版；MOCK/head/status/risk/gate 必须可见。长摘要应保留关键结论并提示查看完整产物。

## 如何用同一个例子协作

打开 context-bug：base 的 canDelete 直接返回 isAllowed；head 增加了 !。rules.ts 说明只有 admin 得到 true。因此反转后管理员不能删除，普通角色反而能删除。

B 应返回 C0（本地窗口）和 C1（rules 中定义）；C 从原始模型内容校验出 F1；D 得到 HIGH 和等待批准的门禁；E 显示 MOCK、版本和等待理由；A 统一发布 pending。

打开 high-approved：同一个 HIGH 问题获得当前版本有效批准，Gate 变 PASS，Risk 仍 HIGH。不要把它改成 LOW。

## 本套样例明确采用的建议策略

1. 支持新增/修改 .ts/.js；删除、重命名等暂不进入模型分析，但所有文件都参加路径/规模风险扫描。
2. 试跑配置是最多 5 文件、局部前后各 20 行、每文件 1 定义/最多 80 行、输入 6000 token、输出预留 1000、最多 7 次调用、单次 30 秒、分析 240 秒、发布预留 30 秒、可重试一次。数字未经效果验证。
3. 两个重叠局部窗口合并；超过 80 行的可选定义在本套样例里整体省略并记 CONTEXT_BUDGET。团队如选择截取，须同步更新预期。
4. COMPLETE 表示必要分析完成，不代表没有 bug。没有支持文件用新增候选状态 NOT_APPLICABLE，默认人工确认。此状态尚未写入原技术规范。
5. 保留下来的 high finding（包括 UNVERIFIED/UNLOCATED）或敏感路径先判 HIGH；否则必要分析不全判 UNKNOWN；其次 medium finding 或规模阈值判 MEDIUM；其余 LOW。HIGH 表示人工审查优先级，不证明缺陷真实存在。规模阈值 >=200 增删行、>=3 文件。
6. 位置或证据有问题时保留可解析 finding 并披露 validation，清除无效证据 ID；必要校验失败产生 required omission，使分析 PARTIAL。显式 line=null 是允许的正文建议，UNLOCATED 披露本身不使分析不完整。无法归属本次输入文件或整个输出格式无效时拒绝该条；没有可用分析则 FAILED。验证通过只说明结构/引用/位置有效，不说明模型论证一定正确。
7. Gate 顺序：无效配置 ERROR；旧 head STALE；有效请求修改 WAITING；HIGH/UNKNOWN/不完整/不适用须当前版本人工批准；其余 COMPLETE LOW/MEDIUM 自动通过。ERROR/STALE 不能靠批准数量覆盖。
8. 作者、Bot、read/triage 权限和旧提交批准不计入。COMMENTED 保留先前有效批准；DISMISSED 撤销，CHANGES_REQUESTED 优先于其他人的批准。这里只规定团队严格演示策略，不概括 GitHub 所有默认行为。
9. 人工接管后允许 Gate PASS，但 FAILED/PARTIAL 和 UNKNOWN/HIGH 仍保留。
10. 空 choices、空 content、无效 JSON/字段/证据不得当成有效空 findings。合法的 {"findings": []} 可以表示成功且未发现问题。
11. 长报告摘要上限按 JS string.length 计 12000 UTF-16 code units；完整 Finding 保留到 JSON 产物，不靠截断原始发现达到限制。
12. unknown usage 为 null。重试消耗调用预算。elapsedMs 是固定逻辑时间，不是真等待，也不是实测服务延迟。
13. 同 SHA 的评论更新、写入失败等是发布端的验收要求；离线工具不会连接 GitHub，也没有替 a 实现这些流程。
14. invalid-config/fork-pr 预检退出时，为完整表单暂用 FAILED/UNKNOWN；Gate ERROR 原因说明它不是模型调用失败。正式 UI 应优先显示该预检原因。

## 怎么跑、这些测试能证明什么

```sh
npm test -- --runInBand test/review/ --no-cache
npm test -- --runInBand --no-cache
```

不需要安装依赖、不需要 API Key。Jest/TypeScript 缓存可能写磁盘；只读执行环境可能需要运行权限。

现有测试检查 JSON、代码快照、行号、diff 的 base→head 重放、关键门禁预期约束，并用篡改数据的反例验证检查会拒绝不一致输入。mock 只读取模拟输入，不读取标准答案。它们不证明 B 的真实检索、C 的真实校验、D 的风险门禁和 A 的发布已实现。

各成员实现后，应新增测试：调用自己的真实模块，再把输出与 expected 对比。不能直接 return expected 让测试变绿。测试工具的 JSON as 类型转换只是开发便利，不替代真实输入验证。

学习用法示例：

```typescript
import { manifest, loadFixture, fixtureDirectory, createSnapshotReader, createScriptedModel } from '../support/sprint1-fixture';
const entry = manifest.scenarios.find(x => x.id === 'context-bug')!;
const fixture = loadFixture(entry);
const read = createSnapshotReader(fixture, fixtureDirectory(entry));
const code = await read('src/rules.ts', fixture.input.headSha);
const model = createScriptedModel(fixture);
const raw = await model.complete('src/caller.ts');
// C 接下来需要自己解析/验证 raw.content；D 需要自己计算 risk/gate。
```

## 场景目录

55 个公开场景：52 个 development、3 个 reserved。reserved 只是供回归使用的公开保留样例；原称 holdout，现已更名，不能作为严格盲测。它们主要检验可靠性和流程，不是 55 个独立语义缺陷。正式模型评价应与 evaluation/ 的开发数据、独立新增的未调参样例分别统计。

- `clean-context`（b/c/e/f；development）：正常上下文审查，没有问题。预期 `COMPLETE / LOW / PASS`。
- `clean-diff-only`（c/f；development）：diff-only 使用同样输出协议，允许无上下文证据。预期 `COMPLETE / LOW / PASS`。
- `context-bug`（b/c/d/e/f；development）：跨文件权限问题，HIGH 等待批准。预期 `COMPLETE / HIGH / WAITING`。
- `high-approved`（a/d/e；development）：当前提交有效批准后放行，风险仍为 HIGH。预期 `COMPLETE / HIGH / PASS`。
- `approval-old-head`（a/d/f；development）：旧提交批准不计入。预期 `COMPLETE / HIGH / WAITING`。
- `approval-author`（a/d/f；development）：作者不能批准自己的 PR。预期 `COMPLETE / HIGH / WAITING`。
- `approval-bot`（a/d/f；development）：机器人批准不计入。预期 `COMPLETE / HIGH / WAITING`。
- `approval-readonly`（a/d/f；development）：只读成员批准不计入。预期 `COMPLETE / HIGH / WAITING`。
- `approval-dismissed`（a/d/f；development）：批准已撤销，不计入。预期 `COMPLETE / HIGH / WAITING`。
- `approval-comment-preserved`（d/f；development）：普通评论保留之前的有效批准。预期 `COMPLETE / HIGH / PASS`。
- `changes-requested`（a/d/f；development）：请求修改优先于其他人的批准。预期 `COMPLETE / HIGH / WAITING`。
- `new-head`（a/d/f；development）：新提交后重新分析，旧批准不能放行。预期 `COMPLETE / HIGH / WAITING`。
- `stale-run`（a/d/e/f；development）：发布时 head 已改变，旧任务不得发布成功。预期 `COMPLETE / LOW / STALE`。
- `invalid-config`（a/d；development）：负数批准数量是配置错误，不是人工可放行情况。预期 `FAILED / UNKNOWN / ERROR`。
- `empty-choices`（c/d/f；development）：provider 没有 choices，不能 LGTM。预期 `FAILED / UNKNOWN / WAITING`。
- `empty-content`（c/d/f；development）：provider 返回空字符串，不能 LGTM。预期 `FAILED / UNKNOWN / WAITING`。
- `invalid-json`（c/d/f；development）：provider 返回非 JSON。预期 `FAILED / UNKNOWN / WAITING`。
- `invalid-fields`（c/d/f；development）：JSON 可解析但 severity 不合法。预期 `FAILED / UNKNOWN / WAITING`。
- `invalid-evidence`（c/d/f；development）：引用不存在的 C404 时清除引用、标记 UNVERIFIED，保留高风险提示。预期 `PARTIAL / HIGH / WAITING`。
- `unknown-human-override`（a/d/e；development）：失败后人工接管，状态仍 FAILED 和 UNKNOWN。预期 `FAILED / UNKNOWN / PASS`。
- `timeout`（a/c/f；development）：请求超时且有限重试用完。预期 `FAILED / UNKNOWN / WAITING`。
- `rate-limit-recovered`（c/f；development）：429 后一次重试成功。预期 `COMPLETE / LOW / PASS`。
- `service-error`（c/f；development）：暂时性服务错误一次重试后仍失败。预期 `FAILED / UNKNOWN / WAITING`。
- `missing-patch`（a/c/d；development）：必要 diff 缺失，不能报告完整审查。预期 `FAILED / UNKNOWN / WAITING`。
- `head-file-read-failed`（a/b/f；development）：必要 head 文件读取失败，不回退到其他版本。预期 `FAILED / UNKNOWN / WAITING`。
- `optional-context-missing`（b/e/f；development）：可选定义缺失，披露但不误判整体失败。预期 `COMPLETE / LOW / PASS`。
- `context-budget`（b/f；development）：可选定义超过 80 行上限，裁剪并记录。预期 `COMPLETE / LOW / PASS`。
- `context-dedup`（b/f；development）：两个 hunk 的局部窗口重叠，只返回一份范围。预期 `COMPLETE / LOW / PASS`。
- `partial-high`（a/c/d/e/f；development）：一个文件成功 HIGH，另一文件失败，保留已知 HIGH。预期 `PARTIAL / HIGH / WAITING`。
- `unlocated-finding`（c/d/e；development）：显式 line=null 的建议保留正文并标记 UNLOCATED；可用分析已完成。预期 `COMPLETE / HIGH / WAITING`。
- `not-applicable`（a/d/e/f；development）：只有 Markdown，未分析不等于 LGTM。预期 `NOT_APPLICABLE / LOW / WAITING`。
- `sensitive-path`（a/d/e/f；development）：只有 workflow 变更，仍扫描敏感路径。预期 `NOT_APPLICABLE / HIGH / WAITING`。
- `removed-file`（a/d/f；development）：删除 TS 文件不进入 Sprint 1 模型范围。预期 `NOT_APPLICABLE / LOW / WAITING`。
- `fork-pr`（a/d/f；development）：fork 输入明确错误，不得自动进入付费分析或放行。预期 `FAILED / UNKNOWN / ERROR`。
- `file-budget`（a/b/c/f；development）：六个支持文件，只分析前五个，剩余记录 PARTIAL。预期 `PARTIAL / UNKNOWN / WAITING`。
- `token-budget`（a/c/f；development）：已测输入超 token 预算，禁止调用。预期 `FAILED / UNKNOWN / WAITING`。
- `call-budget`（a/c/f；development）：没有剩余模型调用次数，不继续重试或调用。预期 `FAILED / UNKNOWN / WAITING`。
- `size-boundary`（d/f；development）：恰好 200 改动行也触发 MEDIUM。预期 `COMPLETE / MEDIUM / PASS`。
- `duplicate-run`（a/e/f；development）：已有机器人摘要，更新原评论而不是新增。预期 `COMPLETE / LOW / PASS`。
- `publish-forbidden`（a/e/f；development）：决策通过但 GitHub 写入失败，不能报告发布成功。预期 `COMPLETE / LOW / PASS`。
- `long-report`（a/e/f；development）：完整 findings 保留，摘要有界且指向完整运行产物。预期 `COMPLETE / MEDIUM / PASS`。
- `reserved-zero`（b/c/f；reserved）：公开保留样例：零值应被保留，不能被默认值覆盖。预期 `COMPLETE / MEDIUM / PASS`。
- `reserved-clean`（c/f；reserved）：公开保留样例：无缺陷的等价表达式。预期 `COMPLETE / LOW / PASS`。
- `reserved-malformed`（c/f；reserved）：公开保留样例：合法 JSON 但 findings 不是数组。预期 `FAILED / UNKNOWN / WAITING`。
- `approval-duplicate`（a/d/f；development）：同一人重复批准仍只计一人，要求两人时继续等待。预期 `COMPLETE / HIGH / WAITING`。
- `approval-two-people`（a/d/f；development）：两名不同有效审阅者达到两人批准要求。预期 `COMPLETE / HIGH / PASS`。
- `changes-resolved`（a/d/f；development）：同一审阅者请求修改后重新批准，解除阻塞。预期 `COMPLETE / HIGH / PASS`。
- `distinct-diff-base`（a/b/f；development）：目标分支快照不同于真正 diff 基准，不能混用。预期 `COMPLETE / LOW / PASS`。
- `context-bug-diff-only`（c/f；development）：同一跨文件问题的 diff-only 配对输入，不提供上下文证据。预期 `COMPLETE / HIGH / WAITING`。
- `invalid-file`（c/f；development）：模型提及不在本次输入的文件，不能计作有效发现。预期 `FAILED / UNKNOWN / WAITING`。
- `invalid-line`（c/e/f；development）：越界行号清空并标记 UNVERIFIED，保留高风险提示及必要校验遗漏。预期 `PARTIAL / HIGH / WAITING`。
- `renamed-file`（a/d/f；development）：重命名 TS 文件明确排除模型分析。预期 `NOT_APPLICABLE / LOW / WAITING`。
- `unsupported-tsx`（a/d/f；development）：TSX 在 Sprint 1 明确排除范围。预期 `NOT_APPLICABLE / LOW / WAITING`。
- `analysis-budget`（a/b/c/f；development）：整个分析阶段预算耗尽，不再发请求。预期 `FAILED / UNKNOWN / WAITING`。
- `added-file`（a/c/f；development）：新增 JS 文件，空旧侧与新增行号一致。预期 `COMPLETE / LOW / PASS`。

## 对应原 TODO 的边界

- 第 9/10 行：仍需原版真实 PR 记录、工程 CI 和构建；本次不做。
- 第 11 行：提供公共契约、固定响应和离线工具，但业务模块串联尚未完成。
- 第 15–17 行：提供版本、检索、去重/裁剪预期；真实检索未实现。
- 第 21–23 行：提供双模式协议及空响应、字段、证据、超时、限流、预算案例；模型适配/校验/重试未实现。
- 第 27–29 行：提供规则与批准历史样例；风险引擎、门禁发布和真实解锁未实现。
- 第 33–35 行：提供报告字段和重复/长报告/权限/旧任务预期；真实渲染及发布未实现。
- 第 39 行：建立小型开发/评价起始样例；须扩充并由成员复核答案。
- 第 40 行：新增样例完整性和测试工具测试，不替代未来业务模块/集成测试。
- 第 41 行：未做真实模型效果、人工时间或成本实验，不宣称效率提升。

本轮不能把以上整条大任务直接标为完成；应将“契约和固定样例”作为子任务验收。
