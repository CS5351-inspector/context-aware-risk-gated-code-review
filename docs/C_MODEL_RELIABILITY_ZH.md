# C 模块：模型与可靠性实现、原理及对接说明

本文件解释这次交付的代码，不把尚未完成的全组集成当成已上线功能。阅读前可先完成 [GitHub 工作流手册](C_GITHUB_WORKFLOW_ZH.md)。全部文件职责见 [文件地图](C_FILE_MAP_ZH.md)。

## 1. 本次做到了什么，离上线还差什么

已有 PR #2 修复了空 choices、空 content、拒答、截断和字段错误被误当成正常结果的问题。本次保留这些检查，并增加一个可以离线调用和测试的 C 模块入口：

```text
A 固定的 ModelInput + B 的 ContextSnippet[] + Budget + 真实 token 计数器
  → reviewFiles（每个 PR 调用一次）
  → 共用 prompt 与 Chat 适配器
  → 超时/限流/有限重试
  → 响应信封校验 → Review JSON 校验 → Finding 转换与来源检查
  → ModelAnalysis（findings / omissions / analyzedFiles / metrics）
  → A 汇总 B 与 C 的覆盖状态 → D 风险门禁 → E 报告
```

可交付的小功能是：**审查结果附带可核对的证据引用，以及不会把失败包装成成功的资源调度**。这是可靠性上的改进，不是模型识别缺陷准确率的实验结论。

当前生产 `bot.ts` 仍调用旧 `Chat.codeReview(patch)`；它会使用共用响应校验与修复后的数值参数，但没有自动使用新 `reviewFiles`。A 需要先统一 #3/#5 的接口，再将新入口放进统一流水线。这里不擅自接管 A 的快照、B 的检索、D 的权限判断或 E 的发布守卫。新的超时/重试保证适用于 `reviewFiles`，不能声称旧 bot 已获得所有新能力。

## 2. 先认识输入输出

### 2.1 四种数据各自表示什么

| 数据 | 来自谁 | 意思 |
| --- | --- | --- |
| ModelInput | A | 固定 headSha、diffBaseSha、模式和改动文件 |
| ContextSnippet | B | 一段有 ID、文件、版本、行区间的真实代码 |
| Finding | C | 一条结构化审查意见；标明位置、级别、引用与验证状态 |
| ModelAnalysis | C | 本次所有 findings、缺失记录、成功分析文件和调用记录 |

`headSha` 是被审查提交；`diffBaseSha` 是实际比较基准，通常与 merge-base 有关；它不保证等于最新 main。`baseSha` 是目标分支快照，完整 PR 输入由 A 管理，C 最小输入只取其需要的两个版本。RIGHT 新侧证据用 headSha，LEFT 旧侧证据用 diffBaseSha。

TypeScript interface 只帮助写代码时检查形状；网络返回 JSON 在运行时仍可能是 `null`、字符串或错误字段。因此原始模型响应使用 `unknown`，验证之后再交给后续模块。`unknown` 表示“还不知道是什么”，比 `any` 强迫调用方先检查。

### 2.2 输入例子

```typescript
// A 提供固定版本；示例 SHA 仅用于离线说明，真实调用须使用真实提交 SHA。
const input = {
  headSha: 'head-1',
  diffBaseSha: 'merge-base-1',
  mode: 'context' as const,
  changedFiles: [{
    path: 'src/a.ts', status: 'modified', supported: true,
    patch: '@@ -1 +1 @@\n-old();\n+newCall();',
  }],
};
```

`as const` 让 TypeScript 把 mode 推断为固定字符串 `'context'`，而非任意 string。`supported` 是 A 的范围声明，C 还会复核：首版只支持新增/修改的 `.ts/.js`，不包括 `.tsx`、删除、重命名和任意文件。A 必须在 scope 中列出被排除的文件。若 A 把实际不支持的文件误标 supported，C 会产生 required omission，不静默跳过。

### 2.3 为什么 Finding 不继续用一句字符串

```json
{
  "id": "src/a.ts:1",
  "file": "src/a.ts",
  "side": "RIGHT",
  "line": 2,
  "severity": "high",
  "message": "Check behavior.",
  "evidenceIds": ["ctx-1"],
  "validation": "VERIFIED"
}
```

结构化字段让 D 可以读 severity，让 E 可以决定行内评论还是正文，让 F 可以计算位置/引用是否合法。ID 在同次输入的文件内稳定编号，不保证跨提交语义去重；跨运行的摘要标记和发布去重仍由 A/E 处理。

## 3. 按代码块阅读 src/chat.ts

### 3.1 旧 Review 与字段校验

`Review` 保留 `lgtm`、`review_comment`、可选 `hunk_header`。LGTM 是 “Looks Good To Me”，表示这次输出没有提出问题，不等于程序一定正确。`isRecord` 排除 null 和数组；`isReview` 要求 lgtm 是真正的 boolean，评论是真正的 string；`false` 必须有文字，`true` 不能同时藏着问题评论。

`parseReviewResponse` 先 `JSON.parse`，支持旧单条 Review 和 `{reviews:[...]}`。`every` 要求每项都合法，不能过滤掉错误项后假装其他部分完整。`{"reviews":[]}` 是明确无 findings；`{}`、空文本和 API 没有 choices 都不是无 findings。

### 3.2 共用信封校验 readReviewContent

模型 API 的 JSON 有两层：外层 completion 信封，内层 content 字符串里的审查 JSON。`readReviewContent` 检查 choices[0]、message、`finish_reason === 'stop'`、无 refusal、content 非空。即使内层 JSON 看似完整，`finish_reason: length` 仍说明生成撞上上限，不能接受为完整分析。

错误类 `InvalidReviewResponseError` 区分“模型输出不符合协议”和普通网络错误。错误信息只包含通用原因，不把原始模型输出、源码或密钥回显到日志。

### 3.3 参数修复与共用适配器

原表达式类似 `+(env || 0) || 1`，显式 0 会因为 JavaScript 把 0 看作 falsy 而变成 1。新的 `numericOption` 只在环境变量未配置时使用默认值，对 0 予以保留，对空字符串、NaN 和越界值报错。`max_tokens` 也要求正整数。

`effectiveParameters` 返回实际发送的模型名、非 reasoning 模型采样参数、最大输出和 reasoning_effort 等，不包含 API Key。reasoning 模型沿用已有参数选择规则，不强塞不适用的采样参数；模型/参数兼容性仍需针对实际 provider 做烟雾测试。

`completeReview` 是新旧入口共用的 API 适配器。C 传入 AbortSignal、timeout、maxRetries=0 和输出上限；旧 `codeReview` 不传新选项以保留调用约定。`maxRetries=0` 是关键：若 SDK 自己也重试，外层说“重试 1 次”可能变成更多 HTTP 请求。

本地安装的 OpenAI SDK README 的 Retries/Timeouts 小节记录了默认重试与超时行为；以项目锁定依赖和本地代码为准。

## 4. 按代码块阅读 src/review/model-review.ts

### 4.1 ModelClient：把外部依赖变成可以替换的接口

`ModelClient` 只需要读取有效参数与调用 completion。真实 `Chat` 和测试的 mock 都能满足它。这叫依赖注入：调度逻辑不需要知道 API Key 或 SDK 如何初始化，测试也不必发真实网络请求。

`Promise<T>` 表示未来会得到一个 T；`async` 函数自动返回 Promise；`await` 等待其完成，失败时进入 catch。超时和重试属于控制 Promise 的调度逻辑。

### 4.2 buildModelPrompt：控制变量

两种模式用完全相同的任务说明、JSON 协议、模型参数和 prompt 版本。diff-only 把 context 设为 `[]`，context 模式提供 B 的片段；不要同时换模型、temperature 或任务说明，否则对比不能归因于上下文。

payload 用 `JSON.stringify` 编码，文件、patch、context 的边界清晰。代码与注释被声明为不可信数据，不能作为指令执行。这种提示约束只是防护的一部分，不能证明消除了 prompt injection；后续仍需通过输出验证、无副作用模型入口和 GitHub 权限边界控制影响。

### 4.3 validateBudget：预算是整个调用的契约

| 字段 | 意思 | 示例候选值 |
| --- | --- | --- |
| maxFiles | 本次最多处理几个必要文件 | 5 |
| maxCalls | 所有文件加重试的总调用上限 | 4 |
| maxRetries | 每个文件额外重试次数 | 1，即最多初次+1次 |
| requestTimeoutMs | 单次请求最多等待的毫秒数 | 1000 用于测试；真实值需试跑 |
| analysisTimeoutMs | 本次分析与预留合计的时间上限 | 5000 用于测试 |
| publishReserveMs | 留给 GitHub 反馈的时间 | 100 用于测试 |
| maxInputTokens | 本入口保守采用的上下文窗口额度 | 4000 用于测试 |
| reservedOutputTokens | 预留并发给 API 的输出 token 上限 | 200 用于测试 |

上表来自离线测试参数，不能当作生产推荐值。`Ms` 为毫秒，1000ms=1秒。`maxRetries=1` 不表示无限持续尝试。所有字段先检查是否为有效整数，非法配置直接报错。

`runtime.remainingMs` 可由 A 传入整次 PR 真正剩余的时间；C 的 deadline 使用“自身上限与 PR 剩余时间中的较小值，再减发布预留”。如果 B 已耗时，不应该给 C 重新发一整份总时间。

### 4.4 token 预算为什么要由调用方提供计数器

token 是模型分词后的单位，既不是字符也不是字节；中文、英文和代码的切分不同。本入口要求 `countInputTokens(prompt)`，它必须使用目标模型对应的 tokenizer，并把消息封装开销计入返回值。代码检查“完整 prompt 的输入 token + 输出预留 ≤ 配置窗口”才允许请求。

测试中的计数器固定返回 100，**仅测试预算分支**，不能拿去做真实预算。A 需要接入准确计数器；没有这项集成就不能宣称生产 token 预算已经验证。`maxInputTokens` 字段名来自候选接口，本入口将其更保守地用于输入加输出总额度；冻结接口时应明确这一语义。

### 4.5 validSnippets：先核对 B 给的元数据

片段 ID 必须唯一，文件名非空，ref 只能是 headSha 或 diffBaseSha，起止行必须有效，code 的行数必须吻合。无效片段不送模型，相关文件产生 `INVALID_EVIDENCE`。diff-only 根本不发送片段。

C 无法仅凭字符串证明 code 真来自 GitHub：B 必须按固定 ref 读取真实文件。C 检查的是“元数据自洽与引用关系”，而非再次实现 B 的网络读取。必要上下文读取失败要通过 B 的 omissions 传给 A 汇总。

### 4.6 request：同时取消 HTTP 和结束等待

`AbortController` 生成取消信号；超时定时器调用 `abort()` 请求 SDK 中止网络。`Promise.race([HTTP, deadline])` 接受先结束的一方，避免客户端没有响应时本地一直等。`finally` 清理定时器，防止完成后仍残留等待。

取消信号不能保证 provider 服务端完全停止执行或不收费。因此请求超时后没有返回 usage，记录必须是未知。真实 Chat 支持 signal；其他自定义 ModelClient 也必须履行取消约定，否则 race 虽结束本地等待，后台请求仍可能继续。

### 4.7 failure 和有限重试

| 情况 | 默认行为 | 原因 |
| --- | --- | --- |
| 429 | 预算内有限重试 | 限流可能暂时恢复 |
| 5xx、APIConnectionError | 预算内有限重试 | 服务或连接可能短暂异常 |
| 请求超时 | 预算内有限重试 | 仍受单次和总时间约束 |
| 400、401、403 | 不重试 | 参数或权限问题通常不会靠等待修复 |
| JSON/字段错误、拒答、截断 | 不重试 | 明确披露，避免通过反复采样掩盖协议失败 |

等待使用指数退避：250ms、500ms 等，上限 4000ms；若服务返回 `Retry-After`，等待至少达到该值。该头可为秒数或 HTTP 日期。若要求等待时间超过剩余预算，则停止，不能提前违反限流规则再试。调用次数在实际调用前递增，因此失败尝试也会消耗额度。

当前是串行文件处理、无随机抖动的演示实现。大规模并发场景可在后续增加集中调度与 jitter，但不能因此虚称已解决企业级吞吐问题。

### 4.8 reviewFiles 和 metrics

一次 PR 只调用一次 reviewFiles；在函数内部遍历文件并共享 deadline/calls。每个失败文件留下 required omission；其他文件继续分析，已得到的 findings 保留。`analyzedFiles` 表示得到结构上可用响应的文件；如果其中引用未验证，仍会有 required omission，因此不能简单用文件数量判断完整。

metrics 记录模型、有效参数、promptVersion、耗时、调用数和 usage。usage 来自 API 的 prompt_tokens/completion_tokens。没有 usage 或请求失败时累加总值为 null，不能填 0；如果一次失败尝试可能已计费，总用量就不可知。零次请求时计数 0 是确定的零消耗，不是未知。

## 5. 按代码块阅读 src/review/findings.ts

### 5.1 patchLines：行号不是字符串搜索

```diff
@@ -10,2 +20,2 @@
-old
+new
 common
```

`-10,2` 表示旧侧从第 10 行起共 2 行；`+20,2` 表示新侧从第 20 行起共 2 行。`-` 只推进 LEFT，`+` 只推进 RIGHT，空格上下文行推进两侧。本例 LEFT 可见 10、11；RIGHT 可见 20、21。Finding 的 side+line 必须是相应集合中的行。

解析器还检查 hunk 声明的行数与实际内容是否一致；必要 patch 被截断不能当作完整分析。它面向单文件 unified diff，不是任意二进制补丁或 combined merge diff 解析器。完整文件快照及获取失败仍由 A/B 负责。

### 5.2 convertFindings：字段、位置、证据分层检查

1. 用共用 `readReviewContent` 检查 API 信封。
2. 用 `parseReviewResponse` 检查 Review JSON 基础字段，保留旧协议兼容性。
3. 对非 LGTM 项严格检查 file、side、line、severity、evidenceIds；file 只能是本次正在审查的文件，side/级别必须是真正字符串，行号只能正整数或 null。
4. 核对行号是否在相应侧 patch 内。错误坐标清空为 null，并标 UNVERIFIED，不猜一个位置。
5. 核对 evidenceIds 是否来自实际发给模型的片段，且 ref 与 Finding 的 side 相符。错误引用移除并留下 required omission。
6. 生成 Finding，保留原 message 和 severity，不生成链接，不因另一文件失败而删除已有 high。

| validation | 解释 | 报告应如何展示 |
| --- | --- | --- |
| VERIFIED | 结构、已给出的位置及引用通过本模块检查 | 可展示有效来源；仍需人判断缺陷是否真实 |
| UNLOCATED | 模型主动 line=null，其他字段合法 | 放正文，披露无精确位置 |
| UNVERIFIED | 坐标错误、引用错误或旧格式信息不足 | 明显标记未验证，不能伪装成可靠行内证据 |

显式 line=null 的可用正文意见只产生 optional `UNLOCATED_FINDING`，不必把整个分析判失败；伪造行号或引用则是 required omission。context 模式允许只基于 patch 的 finding，其 evidenceIds 可以是 []；不能为了“有引用”让模型编造 context ID。

旧格式只有 lgtm/comment 时仍保留意见，但缺少可靠级别和证据。本适配器暂用 medium、RIGHT、line=null 并标 UNVERIFIED+required omission；这只是兼容默认值，不是对真实严重性的测量。D 应结合未验证状态和覆盖不足处理，不能将默认 medium 当成确定安全结论。

### 5.3 状态如何汇总

`deriveModelStatus` 是供 A 参考的保守汇总助手：

| 情形 | 状态 |
| --- | --- |
| 至少一份可用结果，所有必要文件成功且没有 required omission | COMPLETE |
| 至少一份可用结果，但必要文件/证据/上下文缺失 | PARTIAL |
| 没有可用分析结果 | FAILED |

有效空 reviews 属于可用结果。全部被排除时，本助手按已发布 TECH_SPEC 的三状态返回 FAILED；PR #5 提出了 NOT_APPLICABLE，但尚待团队决定。A 冻结该策略后统一修改，不要多个模块各自发明状态。

COMPLETE 表示声明范围内完成必要分析，不等于整个仓库无缺陷。analysisStatus、risk 与 gate 是三件事：C 返回覆盖，D 决定风险和有效人工审批，GitHub required status 的实际配置才决定是否阻止合并。

## 6. 给 A/B/D/E/F 的具体对接说明

### 6.1 与 #5 候选接口的关系

2026-11-03 核对 #5 的 `37f1c7db0937593810cf77893dab3c0d405a49ab`：本地 ModelInput 取 ReviewInput 的字段子集；ContextSnippet.reason 接受 string（候选枚举可赋值）；ModelBudget 取 Budget 的字段子集；ModelAnalysis 的返回字段与候选对齐。未复制风险/权限等无关类型。它仍然是**待 A 冻结的最小边界**，不能宣称 #5 已被团队采纳。

冻结后优先删除重复类型，改成 import 共享类型。不要仅靠 `as any` 压掉不兼容。#3 当前 uses `filename`，#5 uses `path`；#3 的 repo 是 string、#5 是对象；scope、omissions 和 gate 状态也不同，必须明确适配。

### 6.2 A 在统一流水线调用一次

以下是对接示意，`input/context/budget/countTokensIncludingMessages/remainingPrMs` 均需来自 A/B 已验证的真实实现，不是可以凭空运行的变量：

```typescript
// 初始化放在整次 PR 的分析阶段，不要在每个文件里重置总预算。
const chat = new Chat(apiKeyFromSecret);
const model = await reviewFiles(chat, input, context.snippets, budget, {
  countInputTokens: countTokensIncludingMessages,
  remainingMs: remainingPrMs,
});

// 汇总 B 和 C 的必要缺失，之后把完整对象交给 D/E。
const analysisStatus = deriveModelStatus(input, model, context.omissions);
const analysis = {
  ...model,
  analysisStatus,
  omissions: [...context.omissions, ...model.omissions],
  snippets: context.snippets,
  scope: {
    supportedFiles: input.changedFiles.filter(f => f.supported).map(f => f.path),
    analyzedFiles: model.analyzedFiles,
    excludedFiles: input.changedFiles.filter(f => !f.supported).map(f => f.path),
  },
};
```

实际 import：Chat 在 `src/chat.ts`；reviewFiles/deriveModelStatus 在 `src/review/model-review.ts`，仓库现有源代码使用 `.js` 后缀引用 TS 模块。A 应在自己的集成 PR 中完成输入校验、supported/exclusionReason、真实 tokenizer、统一总预算和版本守卫。

### 6.3 各角色拿什么、验证什么

| 对接方 | 本次可以拿到 | 仍需他负责 |
| --- | --- | --- |
| A | reviewFiles、ModelAnalysis、deriveModelStatus | 公共类型冻结、一次性 PR 调用、真实 token 计数、总时间、bot 接入和发布守卫 |
| B | 明确的 ContextSnippet 字段和验证规则 | 按 head/diffBase 读取真实代码；必要/可选缺失说明 |
| D | findings 的 severity/validation，coverage omissions | 风险规则、权限、有效批准、命名 status，未验证结果不得被当成完整低风险分析 |
| E | side/line/evidenceIds/validation、耗时/usage | 仅用真实片段生成 SHA 链接；null 行回正文；未知用量显示未知 |
| F | 固定故障与协议测试 | 真实语义准确率、误报/漏报、独立样本、人工耗时，不把 mock 通过率当效果 |

发布前还要重读当前 head，若与本次 headSha 不同不得给新提交写成功；这项是 A/E 的统一发布责任，不由模型返回值决定。

## 7. 测试与本次验证记录

2026-11-03，在已有依赖环境运行：

- `npm.cmd test -- --runInBand`：5 个套件，148/148 通过，其中本次新增 61 个边界测试，原 87 个仍通过。
- `npx.cmd tsc --noEmit --incremental false --checkJs false`：通过。
- `npm.cmd run build --script-shell='C:/Program Files/Git/bin/bash.exe'`：通过，更新 Action 打包入口与声明。
- `node --check action/index.cjs`：通过。
- 完整 `tsc --noEmit --incremental false`：仍有已知基线 6 项 CJS 类型错误；未描述为全量通过。

边界测试覆盖两侧行号、错误文件/类型、旧格式、空数组、空响应、截断、错误引用、失效版本、片段行数、总调用和文件数、token 预留、未知用量、必要/可选缺失、部分失败、401/403、429/5xx、Retry-After 和挂起请求取消。

测试使用虚拟时钟，不实际等待长时间；Jest 29.0 没有新版异步 timer API，因此用微任务排空加同步推进时钟。测试没有调用付费模型，没有证明模型的语义缺陷检出率，也没有证明真实 GitHub gate 的闭环。

## 8. 你应该能口头解释的五个设计取舍

1. 为什么有效空数组与空响应不同？前者明确完成了输出协议，后者没有可用分析。
2. 为什么重试必须同时受次数和总时间约束？次数限制不能阻止一次请求挂很久；单次超时也不能阻止大量文件累计超时。
3. 为什么 usage=null？失败请求可能已收费，缺失信息不能假造为零。
4. 为什么验证过证据仍要人工看？只能证明位置和引用关系，不证明模型推理正确。
5. 为什么不把所有修改塞进 bot？接口与发布守卫由 A 统一，C 应给出可替换且可独立验证的模块，避免并行开发中互相覆盖。
