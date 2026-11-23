# Sprint2 评测接入与试跑准备

状态：接入真实 B/C 的本地实验准备。流程为**先 AI 生成结果，然后由我人工复核**。20 个样例已经由用户确认；未来模型回答的人工判断仍待真实运行后完成。本文件不是模型质量结论。

## 使用已有实现

`adapters/sprint2-provider.ts` 直接使用 B 的 `collectContext`、C 的 `Chat`、当前 RelayCore 模型设置和 DeepSeek tokenizer。它不重新实现检索、重试或模型响应解析，也不访问 gold。实验边界是 C 的 validated findings，不是包含 E 报告与 D 门禁的整条 Action。

`adapters/sprint2-prepare.cjs` 从 `docs/SPRINT2_MODEL_RELAYCORE_CONFIG.json` 读取当前固定模型和预算，编译本地 provider 并冻结其 SHA-256 与 B 源文件版本。准备器同时将仓库 tokenizer 压缩资产复制到 worker 的忽略缓存目录；C 使用前校验解压后的固定 SHA-256，避免 worker 工作目录不同而找不到资源。总实现指纹由现有 planner 保存。源码、配置或样例修改后必须重新 build / prepare / plan。

计数方法为**匹配模型的正文分词器 + 64 个消息封装预留 token**。这不是精确的 provider 完整请求 token 数；实际消耗以响应 usage 为准，未知值不补零。RelayCore 以前出现过超过输出上限的响应，C 的拒收与停止逻辑可以限制后续请求，不能撤销已经产生的账单。

## 先准备，不调用模型

在仓库根目录运行：

```sh
npm ci
node evaluation/build-adapter.cjs
node evaluation/adapters/sprint2-prepare.cjs pilot evaluation/runs/sprint2-pilot-draft.json
```

草稿故意保留 `pricing:null` 和 `max_cost_usd:null`，现有 planner 会拒绝执行。不能把缺失费率写成 0，也不能借用其他供应商价格。准备程序不读取凭据、不发送 API 请求。

预选 pilot 为 DEV-001/002（跨文件缺陷及修复）、DEV-005/006（diff 可见缺陷及修复）、DEV-009/010（正常变更），每个快照两种模式各一次，共 12 次评测运行。样例复核已完成，这份名单按预先设计保留；如需改名单，应在看到模型结果前修改生成器并重新冻结。`development` 档使用全部 20 快照，共 40 次运行。它们都属于 development，一次运行不保证只有一次模型调用。总 token 上限按 runner 的保守预留公式 `运行数 × maxCalls × (maxInputTokens + reservedOutputTokens)` 设置；这不是实耗或账单，墙钟预算另留 60 秒启动余量。

## 冻结真实试跑

由用户/C 确认账户适用的费率及本轮最高支出，准备本地 JSON，包含：

- `max_cost_usd`：明确允许的正数金额。
- `pricing_source`：账户价格依据/链接与适用条件。
- `pricing`：`model`、`currency:"USD"`、`checked_at`、`input_per_million`、`output_per_million`。

模型必须与固定配置一致。费率用于停止规则及费用估计，不代表 provider 账单；若涉及缓存等价格类别，应事先采用有依据的保守上界并写明假设。不要填虚构示例数字作为实际配置。

```sh
node evaluation/adapters/sprint2-prepare.cjs pilot evaluation/runs/sprint2-pilot-ready.json /path/to/approved-pricing.json
node evaluation/cli.cjs plan --config evaluation/runs/sprint2-pilot-ready.json --out evaluation/runs/sprint2-pilot-plan.json
# 人工确认配置和账户预算后，在本地安全环境设置 INSPECTOR_MODEL_API_KEY。
node evaluation/cli.cjs run --plan evaluation/runs/sprint2-pilot-plan.json --adapter evaluation/.cache/sprint2-provider.cjs --live --out evaluation/runs/sprint2-pilot
```

凭据仅在 `createClient` 中从环境读取，不写入配置/日志。provider 仅接受冻结的 RelayCore endpoint 与模型；不能悄悄切换供应商。各次输出保留失败和 unknown。生成器拒绝覆盖配置，runner 拒绝覆盖运行证据。

若已修改样例或代码，旧计划不能继续复用。两个模式使用相同公开行为要求；模式差别仅为是否提供真实 B 检索片段。不得用 oracle 全量源码冒充真实 Context。

## 验证与结果限制

```sh
node evaluation/build-adapter.cjs
node --test evaluation/tests/sprint2-adapter.test.cjs
```

该测试使用真实 B 检索、真实 C 处理和真实本地 tokenizer，但提供**脚本化模型响应**，不进行网络推理。它验证 20 个快照在 B1/B2 两种模式的接入、预期跨文件定义检索、缺凭据失败、配置缺费率失败与时间字段。它不证明任何真实模型能发现缺陷。

组件指标分别保留 `contextDurationMs`、`modelDurationMs` 和桥接总耗时 `durationMs`，不含 GitHub runner 排队、安装和报告发布。不能将这组组件耗时直接与 Action 的含发布总耗时混合比较。最终评分需要保存原始模型输出，并由用户完成实际判断；未判断项不能自动视为正确或错误。
