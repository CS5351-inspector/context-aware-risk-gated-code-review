# Sprint 2 模型调用与预算指导书

李宗蔚 · FubieLee · C 模块 · 2026-11-17

使用 DeepSeek 时直接从 [第 10 节部署与验收](#10-deepseek-部署验证与交付) 开始。

## 1. 从哪里开始

这次的工作接在已合并的 PR #2、PR #8 和小组集成 PR #11 之后。开发起点是小组主分支提交 `6595d3d`，功能分支为 `feat/sprint2-model-budget`。从下面三个入口看本次交付。[PR #2](https://github.com/CS5351-inspector/context-aware-risk-gated-code-review/pull/2) · [PR #8](https://github.com/CS5351-inspector/context-aware-risk-gated-code-review/pull/8) · [PR #11](https://github.com/CS5351-inspector/context-aware-risk-gated-code-review/pull/11)

| 交付 | 打开哪里 | 你能核对什么 |
| --- | --- | --- |
| 模型适配与预算代码 | [真实模型入口](../src/review/live-model.ts)、[模型调度](../src/review/model-review.ts) | 两种模式发给哪个模型，怎样停止、重试、记账 |
| 冻结配置 | [SPRINT2_MODEL_CONFIG.json](SPRINT2_MODEL_CONFIG.json) | 模型、推理强度、分词器、超时和各项上限 |
| 运行记录 | [SPRINT2_MODEL_RUNS.json](SPRINT2_MODEL_RUNS.json) | 每个场景的输入版本、耗时、次数、usage、覆盖及失败原因 |
| 边界测试 | [真实适配器测试](../test/live-model.test.ts)、[调度测试](../test/model-review.test.ts) | 对应可重跑的断言 |
| 操作与原理 | 本手册第 2～9 节 | 项目的文件分工、每段改动、验收与提交步骤 |

`sprint2.docx` 要求 C 负责模型调用、超时、有限重试、token 预算和可复现记录。统一截止时间与 GitHub 发布来自 A，固定版本的上下文来自 B，风险与批准规则来自 D，报告来自 E，完整的模型对照评测由 F 负责。C 交给他们的是 `findings`、`omissions`、`analyzedFiles` 和 `metrics`。

Sprint 1 的响应校验防止坏输出被当成正常无发现，覆盖修复保留已有结果并披露遗漏。Sprint 2 将这些判断带进已接通的流水线，同时让每次模型尝试及其消耗可以复查。

## 2. 项目按职责怎样划分

~~~mermaid
flowchart TD
    A["GitHub 事件与固定 SHA<br/>inspector-action.ts"] --> B["统一时钟与组织流程<br/>pipeline.ts"]
    B --> C["Context 模式收集代码证据<br/>context.ts"]
    B --> D["Diff-only 直接送改动"]
    C --> E["两种模式共用 reviewFiles"]
    D --> E
    E --> F["检查文件、时间、调用、token"]
    F --> G["OpenAI 兼容 SDK 请求<br/>Chat.completeReview"]
    G --> H["校验响应、转换 Finding、记录尝试"]
    H --> I["A 汇总覆盖，D 计算门禁，E 输出报告"]
~~~

| 区域 | 文件与作用 |
| --- | --- |
| GitHub | `.github/workflows/inspector-signal.yml` 收集目标演示 PR 的事件。`inspector-live.yml` 解析目标、检出可信版本、启动真实审查并上传收据。`test-build.yml` 跑测试、构建与产物比对。`cr.yml` 是独立的旧演示入口。 |
| 真实流水线 | `src/inspector-action.ts` 读环境、建立全局时钟、接模型和 GitHub 端口。`src/pipeline.ts` 按输入、上下文、模型、风险和门禁组织流程。 |
| A 输入与发布 | `src/review/snapshot.ts` 固定 PR 版本、整理文件和 patch。`github.ts` 封装 GitHub API。`publication.ts` 发布报告与提交状态。`config.ts` 验证项目配置的数字边界。 |
| B 上下文 | `src/review/context.ts` 从指定 head 读取改动附近的行与直接导入的定义，去重并限制读取；返回证据和遗漏。 |
| C 模型 | `src/chat.ts` 用 SDK 传输并校验响应。`src/review/live-model.ts` 构建真实审查函数并提供分词器。`model-review.ts` 执行调度。`model-types.ts` 从共用类型选出模型必需字段。`findings.ts` 验证 patch 行号和证据引用，转换结构化意见。 |
| D 决策与 E 报告 | `src/review/risk.ts` 判断风险；`gate.ts` 结合覆盖、风险和审批得出决定。`sprint2.ts` 保存团队预算与阈值，也提供报告渲染。 |
| 共用约定 | `src/review/contracts.ts` 定义输入、证据、Finding、遗漏、预算、指标和模块接口。 |
| 旧入口 | `src/bot.ts` 是历史 Probot/Action 审查入口。`src/github-action.cjs`、`src/aws-lambda.cjs`、`src/index.ts` 分别为 Action、Lambda、服务端入口。`action.yml` 指向对应打包产物。新演示工作流单独构建 `inspector-action.ts`。 |
| 测试与数据 | `test/` 放 Jest 测试。`test/fixtures/sprint1/` 放固定边界输入。`evaluation/` 放 F 的评测桥接、样例、量化和人工标注流程。 |
| 工具与编译 | `scripts/sprint2-model-smoke.ts` 运行本轮样例。`package.json` 注册命令，`package-lock.json` 锁定依赖。`tsconfig.json` 是 TS 配置，`rollup.config.mjs` 构建旧入口，`action/` 保存供 GitHub 使用的生成文件。 |

## 3. 为什么要更新真实模型入口

旧的 Sprint 2 工作流把用于 GitHub 的 `GITHUB_TOKEN` 交给 GitHub Models。2026-11-17 试跑时，旧推理端点返回 HTTP 200 和 4 字节的 `text/plain`，适配器没有收到 `choices` 或 `usage`，所以记录 `INVALID_OUTPUT`。GitHub 已于 2026-07-30 退役 Models 推理 API。[退役公告](https://github.blog/changelog/2026-07-30-github-models-is-now-retired/)

本次将可信演示工作流连接到 **OpenAI 兼容 Chat Completions 服务**。本机现有服务的模型清单包含 `gpt-5.4-mini`，因此冻结这个请求名以及 `reasoning_effort: "none"`。两种模式都用同一模型、JSON 响应格式和输出上限。请求名是模型别名，成功返回时另记 `attempts[].responseModel`，方便核对服务端实际返回的型号。[模型支持的参数](https://developers.openai.com/api/docs/models/gpt-5.4-mini)

| 取值项 | 冻结值 | 作用 |
| --- | --- | --- |
| 模型、推理强度 | `gpt-5.4-mini`，`none` | 为两个模式固定相同的生成设置 |
| 输出格式、长度 | `json_object`，`max_completion_tokens = 800` | 约束响应形状和输出额度，C 再验证业务字段 |
| 支持文件 | 每个 PR 最多 5 | 超出时逐文件记录 `FILE_BUDGET` |
| 调用 | 整个 PR 最多 7 次，单文件允许 1 次重试 | 初次和重试都计入 7，SDK 重试设为 0 |
| 时间 | 240 秒总应用时间，30 秒反馈预留，单次最多 30 秒 | 网络请求与退避共享分析窗口 |
| token | 每次估算最多 8,000，含 800 输出额度 | 估算输入最多 7,200 才能发出请求 |
| 上下文 | 变更附近 4 行余量、每文件最多 2 次定义查找、每段定义最多 60 行 | B 控制补充证据的量 |

`maxInputTokens` 是原有字段名。现有代码用它表示**一次请求的估计输入加输出窗口**。7 次请求的估计预留总量最多为 `7 × 8,000 = 56,000`。实际消耗看逐次服务返回的 `usage`。`js-tiktoken` 的 `o200k_base` 统计整个消息正文，再加 64 token 封装余量。这是本轮采用的估算余量，服务端额外封装可能不同。[tiktoken 模型分词映射](https://github.com/openai/tiktoken/blob/main/tiktoken/model.py)

## 4. 按文件读每段修改

### 4.1 `src/review/live-model.ts` 定义固定参数和真实适配器

先读 `LIVE_MODEL_SETTINGS`。`Object.freeze` 冻结模型和推理强度，调用时只需把服务地址和对应凭据传给适配器。`LIVE_TOKENIZER` 是会写进运行收据的计数器版本。首次运行 `countReviewTokens` 才初始化编码器，后续请求复用。`encode(prompt, [], [])` 把代码中的特殊标记当普通文本，计数覆盖提示模板、文件路径、patch 和 Context 片段。

再读 `validateEndpoint`。`new URL` 解析配置好的 API 根地址。它要求 HTTPS，并检查地址里没有用户名、密码、查询或片段。输入已退役的 `models.github.ai` 会立即报错。函数去掉末尾多余斜杠，SDK 随后添加 `/chat/completions`。

最后读 `createLiveReview`。它检查空凭据，创建一次固定配置的 `Chat`，然后返回 `(input, snippets, budget) => reviewFiles(...)`。返回函数记住这个客户端、分词器和 A 的取消信号。这样 `pipeline.ts` 可以按它原来的模块接口调用 C。

### 4.2 `src/chat.ts` 把固定配置落实成 SDK 请求

| 代码位置 | 做了什么 |
| --- | --- |
| `FixedChatSettings` | 保存根地址、模型名和推理参数。组装后交给 `Chat`。 |
| `constructor(apikey, fixed?)` | 收到固定设置时复制一份，并为该 SDK 客户端设置 `maxRetries: 0`。已有调用仍可以只传第一个参数，保持原有环境变量配置方式。 |
| `model` 与 `reasoningEffortOption` | 有固定配置时用该模型和推理强度。对于 GPT-5 系列走已有推理模型路径，选用 `max_completion_tokens`。 |
| `effectiveParameters` | 返回实际生成参数和 JSON 响应格式，供 C 记入收据。固定客户端的输出上限由调度器传入的预算决定。 |
| `completeReview` | 把完整 prompt 装进唯一的 `user` 消息。把 `signal`、`timeout` 和 SDK 重试限制作为请求选项传入。只有这一处执行真实 `chat.completions.create`。 |

SDK 默认会对某些网络问题自动重试。C 必须知道每一次尝试的数量，因此固定客户端和每次调用的选项都把 SDK 重试设为 0。外层预算才能准确控制重试。[OpenAI Node SDK 重试说明](https://github.com/openai/openai-node#retries)

### 4.3 `src/review/model-review.ts` 决定发不发、等多久、要不要重试

从 `reviewFiles` 函数头跟一遍。

1. **检查输入。** `validateBudget` 要求正数上限、非负重试次数，并检查反馈时间与输出额度的预留有空间。随后确认模式、版本和文件名无重复。
2. **接上 A 的截止时间。** `deadline` 从传来的剩余应用时间减去反馈预留。若全局还剩 32 秒，保留 30 秒反馈后，当前请求最多拿 2 秒，即 `min(30 秒, 2 秒)`。A 的取消信号也可以提前结束 C。
3. **选取证据。** Diff-only 使用空数组，Context 使用 B 的片段。`validSnippets` 验证 ID、版本、行数和文本类型。`patchLines` 核对 patch 完整性。解析和分词之前先检查已经耗尽的调用数或时间。
4. **实际分词。** `buildModelPrompt` 拼出完整消息。`countInputTokens` 执行分词。输入估算达到 `7,200` 可以发，达到 `7,201` 时记录 `TOKEN_BUDGET`，该文件的调用次数为 0。
5. **发起一次尝试。** 建立 `ModelAttempt`，先加 `metrics.calls`，再用 `request` 同时开始 SDK 调用和本地计时。超时路径调用 `AbortController.abort()`，`finally` 清定时器和事件监听。
6. **处理返回与重试。** `convertFindings` 对返回做结构、行号和证据检查。限流、服务端错误、连接中断和超时可以重试。HTTP 401／403 与无效响应保留错误并停止这个文件的尝试。每次重试先检查次数和时间，等待取指数退避和 `Retry-After` 中较大的一个。取消信号可以打断等待。
7. **记入结果。** `finally` 记录本次耗时、估算 token、剩余请求时限和服务返回的用量。`addUsage` 汇总同一项 token。任一次用量缺失，总值保持 `null`。之后其他文件可以继续在同一份预算内分析。

Sprint 2 还修正了 SDK 异常识别。当前版本的 `APIConnectionError` 和 `APIConnectionTimeoutError` 实例可能带有 `name = "Error"`。`failure` 通过错误类型识别连接故障和超时，同时兼容按名字报错的离线适配器。先判断超时子类，才能保留 `TIMEOUT` 原因。

举一个可直接对照测试的流程。两个文件共享 2 次调用。文件 A 第一次遇到 429，第二次成功，它用完了 2 次。文件 B 记录 `CALL_BUDGET`，且不会再运行分词器。A 的第二次有实际 usage，第一次未知，所以两次合计仍是 `null`。整体覆盖为 `PARTIAL`。

### 4.4 `src/review/contracts.ts` 解释为什么同时有两种 token

| 字段 | 含义 |
| --- | --- |
| `metrics.calls` | 调度器实际发起的尝试数，包含重试 |
| `attempts[].file`、`attempt` | 处理哪个文件，它是该文件的第几次尝试 |
| `timeoutMs`、`durationMs` | 给这次请求的时间上限、实际经历的时间 |
| `estimatedInputTokens`、`reservedOutputTokens` | 发送前估计的完整输入、给模型预留的输出额度 |
| `inputTokens`、`outputTokens` | 服务在 completion 里报告的实际 usage，允许 `null` |
| `responseModel` | 服务返回的 model 字段，未收到时为 `null` |
| `outcome` | 该次尝试的结果，例如 `RATE_LIMIT` 或 `INVALID_OUTPUT` |
| `omissions[].reason` | 文件为什么最终未完成，例如首次限流后又因总数用完而停止时，尝试是 `RATE_LIMIT`，最终遗漏是 `CALL_BUDGET` |

`attempts` 和 `tokenizerId` 在共用类型里是可选字段，因此历史缓存和其他模块的旧记录仍能读取。C 的本轮返回包含 `attempts`，即使它是空数组。`metrics.durationMs` 在 C 内代表模型阶段，A 汇总时记入应用已用时间。每次尝试的耗时独立保留。

### 4.5 `src/inspector-action.ts` 与工作流怎样接上线

| 修改 | 执行时发生什么 |
| --- | --- |
| 工作流变量 `INSPECTOR_MODEL_BASE_URL` | 从小组仓库的 Actions Variables 读模型服务根地址。 |
| 工作流 secret `INSPECTOR_MODEL_API_KEY` | 只传给执行可信 runner 的步骤。`GITHUB_TOKEN` 继续供 GitHub 读取和状态发布。 |
| 真实分析分支 | 调用 `createLiveReview(modelKey, modelEndpoint, analysis.signal)`。A 传入原有全局取消信号，模型缺凭据或地址不合法时能进入既有失败反馈。 |
| 缓存身份 | 服务地址的 SHA-256 参与缓存内部键。配置变更后旧记录不满足同一服务身份；可手动运行一次完整分析刷新收据。 |
| 工作流权限 | 移除了退役的 `models: read`。现有目标分支和可信执行链仍由 A 的工作流管理。 |

### 4.6 `scripts/sprint2-model-smoke.ts` 如何复现

| 代码段 | 作用 |
| --- | --- |
| `sourceBefore`、`sourceAfter`、`units` | 构造两份无真实仓库内容的 TS 文件。改动使折扣由 `toFraction(percent)` 变成 `toFraction(percent / 100)`。依赖函数自己也做一次除法。 |
| `makeSnapshot` | 生成补丁、文件列表和内容指纹。两模式共用相同的 base/head。这里的 SHA 标记本地内容，真实 PR SHA 由 A 的适配器读取。 |
| `fixtureCases` | 定义成功、限流恢复、连接恢复、无效输出、挂起请求和三种超限。每个既定场景写明预期状态和调用数。 |
| `fakeResponse` | 在 SDK 的 fetch 层返回固定响应或中断。这样 SDK 的真实请求构造、错误包装和重试开关仍会被执行。 |
| `runScenario` | 逐次记录 fetch 的 HTTP 状态，使用团队真实的 pipeline 和 B 的检索函数。缺少 `units.js` 时返回 `ENOENT`，B 才能按自己的规则读取 `units.ts`。Context 必须检索到直接定义。 |
| `main` | 无参数时运行离线场景。`--config` 生成冻结快照。`--live` 读取当前 shell 的服务地址与凭据，以同一模型配置跑两种模式。 |
| `package.json` 的脚本 | 先用 esbuild 编译 TypeScript 到忽略的 `.cache`，再用 Node 启动。常规 npm 测试无需模型密钥。 |

### 4.7 其余文件为什么出现

| 文件 | 核对重点 |
| --- | --- |
| `test/live-model.test.ts` | 错误地址和空凭据发不出请求。两模式使用相同实际 SDK 参数。分词计算到临界值仍可发，少一个 token 的额度则拒绝。 |
| `test/model-review.test.ts` | SDK 实际错误类型、重试共享上限、无效响应保留 usage、请求时限按剩余时间裁剪，以及原有证据和超时场景。 |
| `docs/SPRINT2_GATE_ADR.md` | 将团队架构说明里的模型与窗口口径更新到本轮配置。 |
| `docs/SPRINT2_MODEL_CONFIG.json` | 从运行设置导出的冻结配置，包含模型、分词器和预算。这份 JSON 为交接记录，程序从 TS 配置读取。 |
| `docs/SPRINT2_MODEL_RUNS.json` | 保存离线实际输出、真实拒绝与历史服务失败。`null` 是未收到该项用量。 |
| `action/index.cjs` | ncc 构建的 JavaScript 入口，其中包含更新后的 `Chat`。 |
| `action/src/chat.d.ts` | 生成的 Chat 公开类型，含固定模型设置和构造方式。 |
| `action/src/review/contracts.d.ts` | 生成的共用类型，含每次调用的记录字段。 |
| `action/src/review/live-model.d.ts` | 生成的真实适配器签名，调用时传 API 密钥、根地址和可选的取消信号。 |
| `action/src/review/model-review.d.ts` | 生成的 C 调度接口和运行期参数类型，含 tokenizer 标识。 |

## 5. 对照这次记录

离线场景只把 SDK 传输换成可控结果。下面的 status、调用和覆盖来自运行脚本。实际测量的毫秒数和每次请求的 usage 在 JSON 中。离线的用量是场景注入值。

| 场景 | 观察结果 | 看哪组字段 |
| --- | --- | --- |
| 两个正常场景 | 各 `COMPLETE`、1 次、覆盖 1/1 | `diff-only-ok`、`context-ok` |
| 限流恢复 | `429 → 200`，2 次，`COMPLETE` | 第一次 usage 为 `null`，总 usage 也未知 |
| 连接恢复 | 无 HTTP 状态 → 200，2 次，`COMPLETE` | 第一次 `SERVICE_ERROR`，第二次 `RESPONSE` |
| 无效输出 | 200、1 次、`FAILED` | `INVALID_OUTPUT`，仍可看到响应携带的 usage |
| 超时 | 1 次、`FAILED` | 注入 50 ms 单次上限，`TIMEOUT` |
| 调用用尽 | 429、1 次、`FAILED` | 限额 1，阻止重试，记录 `CALL_BUDGET` |
| token 超限 | 0 次、`FAILED` | 限额降到 801，含 800 输出额度，记录 `TOKEN_BUDGET` |
| 文件超限 | 5 次、`PARTIAL`、覆盖 5/6 | 第六个文件记录 `FILE_BUDGET` |

2026-11-17 11:39（中国标准时间）真实请求使用同一个 `gpt-5.4-mini` 参数、合成输入和同一 head。两种模式都收到 HTTP 403，服务明确提示当前凭据无可用额度。两个请求各计 1 次，均为 `FAILED / SERVICE_ERROR`，usage 为 `null`，覆盖为 0/1。真实成功记录和发布到演示 PR 的收据仍待有效凭据。[运行记录](SPRINT2_MODEL_RUNS.json)

这个样例的发送前估算为 Diff-only 272、Context 437。多出的 165 来自 Context 中的本地窗口和直接定义两段内容。对折扣为 `20` 的输入，沿着依赖函数手算可以确认预期值 `0.2` 被改成 `0.002`。目前只能量化这次输入估算增量和提供了哪些证据。服务拒绝了真实请求，因此模型是否能发现问题、真实 token 和耗时表现仍待测量。

## 6. 按顺序复现本地操作

### 第一步　确认工作区和安装环境

在 Windows PowerShell 逐行执行。路径含中文，用引号包住。看到下一条 `PS ...>` 再输下一行。

~~~powershell
Set-Location -LiteralPath 'F:\个人培养方案\个人资料\港城\CS5351-code-review-workshop\sprint2-model-budget'
git status --short --branch
git log -3 --oneline
node --version
npm.cmd ci
~~~

`status` 显示分支和未提交文件。`log -3` 显示最近三笔提交。小组 CI 使用 Node 24。`npm ci` 从锁文件安装依赖。Windows 上 npm 可能重写已有 `yarn.lock` 的平台条目，提交时按实际文件范围筛选。

这次新目录是通过 `git fetch upstream main` 和 `git worktree add --no-track -b feat/sprint2-model-budget <新目录> upstream/main` 建立的。`fetch` 获取小组主分支，`worktree add` 生成与旧目录分开的检出，`-b` 创建新分支，`--no-track` 等首次推送后再建立跟踪关系。你现在可以使用已建好的目录。

### 第二步　运行边界测试

~~~powershell
npm.cmd run typecheck
npm.cmd test -- --runInBand test/live-model.test.ts test/model-review.test.ts test/pipeline.test.ts
npm.cmd test -- --runInBand
npm.cmd run test:evaluation
~~~

`typecheck` 检查 TypeScript 接口及字段。`npm test` 后的 `--` 把选项交给 Jest，`--runInBand` 按一个进程运行。第二行先定位 C 与 A 的相关测试，第三行跑全仓。`test:evaluation` 另行检查 F 的评测数据、桥接和验证规则。CI 用 Ubuntu 运行这一套。

### 第三步　复现实验配置和离线结果

~~~powershell
npm.cmd run --silent smoke:model-budget -- --config
npm.cmd run --silent smoke:model-budget
~~~

第一行输出冻结配置，对照 [配置快照](SPRINT2_MODEL_CONFIG.json)。第二行输出九个场景的 JSON。核对 `analysisStatus`、`calls`、`httpStatuses`、`omissions`。耗时会按机器和首次分词器初始化变化。取消与预算的预期是场景中的断言。

### 第四步　使用已开通的 API 凭据运行两种真实模式

API 根地址示例为 `https://api.openai.com/v1`，使用兼容服务时填服务提供的根地址。它需要支持 `gpt-5.4-mini` 的 Chat Completions。在 PowerShell 里用环境变量交给脚本，服务器凭据在输入时遮蔽。

~~~powershell
$env:OPENAI_BASE_URL = Read-Host '模型 API 根地址'
$env:OPENAI_API_KEY = [System.Net.NetworkCredential]::new('', (Read-Host '模型 API Key' -AsSecureString)).Password
npm.cmd run --silent smoke:model-budget -- --live
Remove-Item Env:OPENAI_API_KEY
~~~

`--live` 只运行合成折扣样例的 Diff-only 与 Context，每个样例一个待审文件，最多 1 次重试。你应看到两次 `COMPLETE`、两个 provider usage 与 `responseModel`。HTTP 403 需要核对该模型的权限和计费，脚本记录失败并以非零退出码结束。若网络需要 Windows 系统代理，先用同一个终端的代理设置确认 Node 能访问所选服务。

请保存两轮的 `headSha`、`metrics.effectiveParameters`、`tokenizerId`、覆盖、findings 和 omissions。拿到真实样本后再比较消耗和发现。一个样例的结果用于验证流程，团队的正式对照分析走 [F 的评测说明](../evaluation/docs/ADAPTERS.md)。

### 第五步　构建与检查产物

在 Ubuntu 或 WSL 的 Node 24 工作副本执行以下命令。用 Linux 重建是为了和小组 CI 使用相同环境并复现字节结果。

~~~bash
npm ci
npm run build
node --check action/index.cjs
git diff --stat -- action
~~~

`build` 由 Rollup 处理 TS 入口，再用 ncc 生成 Action 产物。`node --check` 检查 JavaScript 语法。修改源文件后重建一次，核对生成文件，暂存预期产物。再构建一次，然后运行 `git diff --exit-code -- action` 和 `git ls-files --others --exclude-standard action`。这两个检查分别要求已追踪文件和未追踪文件都没有新的差异。真实 Sprint 2 runner 还由工作流使用 esbuild 单独生成。

本次在 Ubuntu Node 24 通过 **471 项 Jest、43 项评测、9 个离线场景、类型检查与两次构建一致性检查**。Windows 上 Jest 和类型检查通过，F 的评测数据子进程曾出现 Windows 退出码 `3221226505`，完整评测结果以 Ubuntu 和 GitHub Checks 为准。

## 7. 理解这次 Git 提交与 PR

本次在小组仓库创建 `feat/sprint2-model-budget`，使该分支能出现在小组 **Branches** 页面。代码从当前小组 `main` 分出来，PR 的 base 是小组 `main`，compare 是同一仓库里的 `feat/sprint2-model-budget`。历史 PR #2、PR #8 继续作为上一轮的贡献记录。

- `git diff` 对比工作区与暂存区。先看具体源码，确认修改范围。
- `git add -- 指定文件` 选出将进入提交的文件。`git diff --cached --name-only` 检查暂存范围，`git diff --cached --check` 检查冲突标记和空白。
- `git commit -m "..."` 把暂存区记录为一个本地版本。`git log -1 --oneline` 查看提交号。
- `git push -u upstream feat/sprint2-model-budget` 将该分支推到小组仓库，并设置跟踪分支。`upstream` 是小组仓库，`origin` 是你的 Fork，先用 `git remote -v` 确认。
- GitHub 的 **Pull requests → New pull request** 将小组 `main` 设为 base，新分支设为 compare。创建 PR 后，**Files changed** 看改动，**Checks** 看检查，**Conversation** 看讨论。之后 push 到同一个小组分支，就会更新同一份 PR。[GitHub 创建 PR](https://docs.github.com/en/pull-requests/how-tos/create-pull-requests/creating-a-pull-request)

## 8. 小组怎样完成真实演示验收

1. 在小组仓库 **Settings → Secrets and variables → Actions** 配置一个有效的 `INSPECTOR_MODEL_API_KEY` secret，以及配对的 `INSPECTOR_MODEL_BASE_URL` variable。先用第 6 节的本地样例确认这一对配置拿得到 completion。
2. PR 合入小组 `main` 后，从小组 **Actions → Inspector live review → Run workflow** 选择同仓库、目标为 `sprint2-demo` 的开放演示 PR。用固定的 PR head/base 各跑一次 Context 和 Diff-only。
3. 从 run 的 **Artifacts** 下载 `inspector-receipt-…`。看 `newModelCalls` 区分新请求与缓存。看 `applicationDurationMs` 和逐次 `durationMs` 了解应用与调用耗时，runner 排队、安装时间另从 Actions 时间线记录。
4. 将两种模式的 run 链接、提交 SHA、覆盖、遗漏、usage 和发现交给 F。A 用真实 PR 的状态和发布收据完成门禁验收。[小组验收矩阵](SPRINT2_GATE_ACCEPTANCE.md)

## 9. 用两个问答检查自己能否说明改动

**为什么一次 429 后成功，总 usage 还是未知？** 两次都计入调用预算。成功响应能提供第二次用量，429 没给第一次用量，不能把已知的第二次数字当成总量。

**为什么到了 30 秒反馈预留就停止？** 运行期还有 GitHub 查询、生成报告和发布状态。C 在 A 交下来的剩余预算里先留这段时间，再为每次 API 请求取更小的可用时限。必要输入没完成时，结果带上明确遗漏，供后续门禁处理。

## 10. DeepSeek 部署、验证与交付

使用 DeepSeek 时，从本节开始。适配和测试已纳入同一份 [Sprint 2 PR #14](https://github.com/CS5351-inspector/context-aware-risk-gated-code-review/pull/14)。原来的 GPT 路线及其历史实测记录可在第 3～8 节查阅。

### 10.1 这次改了哪些文件

| 文件 | 修改和作用 |
| --- | --- |
| `src/review/live-model.ts` | 用 HTTPS 根地址选择模型配置。根地址为 DeepSeek 官方地址时，固定 `deepseek-flash`、关闭思考模式，并换用其分词器。传给 C 的时间与重试参数沿用统一预算。 |
| `src/chat.ts` | 原有 OpenAI SDK 负责 HTTP。DeepSeek 请求包含 `thinking: { type: 'disabled' }`、`response_format: { type: 'json_object' }` 和 `max_tokens`。`outputLimitField` 让运行记录和真实请求使用相同的输出字段。 |
| `src/review/deepseek-tokenizer.ts` | 固定 DeepSeek 公布的 `DeepSeek-V4.1-Flash-1017` 分词快照和两个公开文件的 SHA-256。读取时解压、验哈希，再初始化分词器。正文按该词表计算，另预留 64 个封装 token；服务返回的 `usage` 用于实际用量。 |
| `assets/deepseek/` | 随仓库交付两个官方分词文件的压缩版和 MIT 许可证。GitHub runner 可以直接读取，避免运行时连接分词文件站点。 |
| `scripts/sprint2-model-smoke.ts` | 新增 `--deepseek`。单独使用时模拟 HTTP，配合 `--live` 时只往 DeepSeek 官方 API 发送两轮合成样例。 |
| `.github/workflows/inspector-live.yml` | DeepSeek 部署从已有的 Actions 变量和密钥读取配置，并使用仓库中的分词文件。 |
| `package.json`、`package-lock.json`、`yarn.lock` | 固定分词库版本。npm 流水线和原来走 Yarn 的 Dockerfile 各有对应锁文件。 |
| `test/live-model.test.ts` | 核对两模式参数一致、每次 SDK 调用没有内部重试，以及 tokenizer 缺失、地址错误和 token 超限的行为。 |
| `action/` | 更新生成的运行包和类型声明，与 Ubuntu 上重建结果保持一致。 |

当前官方模型名是 `deepseek-flash`。提供商可能更新该别名指向的版本，运行时可从 `responseModel` 观察响应字段。本地分词文件固定在 `08c8657`，实际用量以服务返回为准。[DeepSeek API 入口与模型说明](https://api-docs.deepseek.com/) · [Chat Completions 参数](https://api-docs.deepseek.com/api/create-chat-completion/) · [官方分词器快照](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash-1017/tree/08c8657f02291e11b6f6b63e0e16014f8e748518)

### 10.2 先确认离线结果

在新工作区用 **Windows PowerShell** 逐行执行。

~~~powershell
Set-Location -LiteralPath 'F:\个人培养方案\个人资料\港城\CS5351-code-review-workshop\sprint2-model-budget'
npm.cmd ci
npm.cmd run --silent smoke:model-budget -- --deepseek --config
npm.cmd run --silent smoke:model-budget -- --deepseek
~~~

`--config` 打印冻结设置，`--deepseek` 离线试跑应输出九条记录。本次合成样例的两个正常场景都为 `COMPLETE`，各 1 次请求，覆盖 1/1。实际分词加封装余量的发送前估算为 Diff-only **288**、Context **463**。Context 多出的两段包含本地窗口和依赖定义。离线 `usage` 是固定响应的值。[DeepSeek 冻结配置](SPRINT2_MODEL_DEEPSEEK_CONFIG.json) · [离线运行记录](SPRINT2_MODEL_DEEPSEEK_RUNS.json)

### 10.3 调用真实 API 并验证

在同一个 PowerShell 窗口用遮蔽输入运行以下命令。保留命令里的 `'DeepSeek API Key'` 作为提示文字，看到提示后粘贴完整 Key 并按 Enter。验证样例里的代码全部是预先构造的折扣计算。

~~~powershell
$env:DEEPSEEK_API_KEY = [System.Net.NetworkCredential]::new('', (Read-Host 'DeepSeek API Key' -AsSecureString)).Password
npm.cmd run --silent smoke:model-budget -- --deepseek --live | Tee-Object -FilePath '.cache/deepseek-live.json'
Remove-Item Env:DEEPSEEK_API_KEY
~~~

| 收据字段 | 该怎样看 |
| --- | --- |
| `transport` | `deepseek-api` 代表这份收据来自真实调用。 |
| `runs[].httpStatuses` | `[200]` 表示收到一次成功 HTTP 响应。遇到瞬时故障，可能有两项。继续核对审查状态。 |
| `analysisStatus`、`coverage` | 两个模式都期望 `COMPLETE` 且覆盖 1/1。若收到 200 但输出无效，收据会保留 `FAILED` 或 `PARTIAL` 及遗漏原因。 |
| `metrics.model`、`attempts[].responseModel` | 第一项是请求的 `deepseek-flash`，第二项是服务实际返回的型号字段。 |
| `metrics.inputTokens`、`metrics.outputTokens` | 服务已返回数字时，才可作为实际用量。估算看每次尝试的 `estimatedInputTokens`，耗时用 `durationMs`。 |
| `headSha`、`effectiveParameters` | 比较两种模式时，保持同一合成输入和模型参数，只改变给模型的证据。 |

遇到 401 时核对官方 API Key；402 时检查平台余额；429 会走项目的有限重试。错误状态与已有覆盖都保存在收据里。[DeepSeek 错误码](https://api-docs.deepseek.com/quick_start/error_codes/)

2026-11-17 13:29（中国标准时间）的官方端点试跑中，两种模式各发起 1 次调用并收到 HTTP 401。独立的 `/models` 查询也返回 `authentication_error`。这两份记录的覆盖都是 0/1，实际 token 用量为 `null`。真实成功的验收仍待通过认证的凭据。[真实失败记录](SPRINT2_MODEL_DEEPSEEK_RUNS.json)

### 10.4 部署到小组演示并交付

1. 本机真实试跑得到两份成功收据后，先核对该分支的 [PR #14](https://github.com/CS5351-inspector/context-aware-risk-gated-code-review/pull/14) 和 **Checks → Test and Build**。
2. 选择获准用于团队演示的 API Key。在小组仓库 **Settings → Secrets and variables → Actions** 新建仓库级 Secret `INSPECTOR_MODEL_API_KEY` 和 Variable `INSPECTOR_MODEL_BASE_URL`。Variable 填 `https://api.deepseek.com`，Secret 填配套的 DeepSeek API Key。[GitHub Actions Secrets 文档](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)
3. 由小组按流程将 #14 合入 `main`。**Inspector live review** 运行主分支上的可信版本，选择同仓库中目标为 `sprint2-demo` 的开放演示 PR，并对同一个提交分别运行 Context 和 Diff-only。
4. 打开各 run 的 **Artifacts** 获取 `inspector-receipt-…`。向组员交付 PR 链接、冻结配置、两条 Actions run 链接、各自收据和同一个审查 SHA。写明 `reusedAnalysis` 与 `newModelCalls`，便于确认这次是否真正产生新请求。
