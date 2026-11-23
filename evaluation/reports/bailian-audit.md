# 百炼评估执行与计费证据审计

归档核验（主流程）：两组原始计划、运行记录及响应已原样复制到 [pilot](bailian-2026-11-22/pilot/) 与 [development](bailian-2026-11-22/development/)，对归档目录分别运行 `verifyRuns`，12/12 与 40/40 均通过；没有改写冻结计划或响应。

审计日期：2026-11-22。范围为本地冻结配置、实现、执行记录及全部已落盘原始响应；没有发起模型请求、读取凭据或改变冻结实现。此审计不属于缺陷质量人审，不产生 gold/novel/false-positive 裁决。

## 当前结论

Pilot 的 12/12 与 full development 的 40/40 个计划运行均已执行；逐条核对全部 52 个原始响应，没有发现模型版本、参数、用量、CNY 估算或时限边界不一致。Pilot 为 10 complete、1 partial、1 failed；full 为 39 complete、1 failed。所有异常保留，无择优重跑。两组成本合计 0.095090 CNY，低于总授权 30 CNY；它是配置费率估算，不是实付账单。

主比较仅采用 full 的 40 次；pilot 保持独立诊断。质量裁决仍为 pending，不将调用成功或通过格式/坐标校验视为缺陷判断正确。

## 冻结配置与边界

- 模型请求值与每个响应实际返回值均为 `deepseek-v4.1-flash-1017`，不是仅依据请求字段推定返回模型。
- 有效参数逐条等于冻结配置：`enable_thinking:false`、`response_format:{type:"json_object"}`、`max_tokens:800`、SDK `maxRetries:0`。应用预算允许 `maxRetries:1`；两者含义不同。Pilot 实际每个运行只有一次调用，没有重试或择优重跑。
- B1 为无检索上下文；B2 为 actual-retrieval，context version 为 `sha256:f931b0b8be81db2aaa98df301d2348cf2f51c03102e1583274762ff73774b143`。本次不是 oracle 对照。
- 每次请求 30,000 ms；analysis 240,000 ms，publish reserve 30,000 ms；worker 250,000 ms；最多 7 次模型调用/运行。Pilot 全局 wall 上限 3,060,000 ms；full 上限 10,060,000 ms。
- 所有金额单位为人民币元（CNY）：pilot 上限 6 元、full 上限 24 元，总授权上限 30 元。不是美元或人民币分。
- 冻结费率为输入 2 CNY / 百万 token、输出 8 CNY / 百万 token。按公开峰值、未缓存费率作保守估算，不是实际账单，也不推定账户折扣/抵扣/时段费率。本审计只重算冻结费率，未独立重新查询线上价格。

## Pilot 全量检查（12/12 原始响应）

| 项目 | 已验证结果 |
| --- | --- |
| 覆盖 | DEV-001、002、005、006、009、010；每例 B1/B2 各一次；共 6 对、12 运行 |
| 条件与样例类型 | 每个条件各 2 cross-file、2 diff-sufficient、2 clean-only；包含 faulty、fixed、clean |
| 状态 | 10 complete / 1 partial / 1 failed；0 not-executed；计划完整 |
| 实际调用 | 12 次；响应均 `finish_reason:stop` |
| 输入 / 输出 | 4,395 / 1,714 token；所有 raw usage、attempt usage、run aggregate 均一致 |
| 总 token 校验 | 12/12 响应的 `total_tokens = prompt_tokens + completion_tokens` |
| CNY 估算 | `(4395×2 + 1714×8)/1000000 = 0.022502` 元 |
| 保守预留 | 5.9136 CNY；不超过冻结 6 CNY 上限；记录没有将 CNY 填入 cost_usd |
| reasoning 内容 | 12 个响应均存在 `reasoning_content` 字段，均为空；未观察到非空 reasoning 文本 |
| Token 估计余量 | 每次 estimatedInputTokens 比 provider prompt_tokens 多 60；所有 estimated input + 800 均 ≤ 8,000 |
| 请求 / 运行耗时 | attempt 677–2,549 ms；外部 worker 运行 995–2,873 ms；总起止跨度 21,943 ms |

独立重算逐次 raw usage → attempt → metrics → runs 的输入、输出、调用数量及费用，同时检查模型、有效参数、tokenizer、输出 cap、时间 cap、条件及原始文件哈希。`verifyRuns` 通过；当前实现哈希与冻结计划相同。空 reasoning 字段仅支持“未返回可见 reasoning 内容”，不能证明服务端内部没有任何推理。

异常记录未删除：

- `DEV-006/B1/1`：partial，`UNVERIFIED_FINDING`，保留 1 条已通过验证的 finding；worker error 为 null。
- `DEV-009/B2/1`：failed，`INVALID_OUTPUT`，无通过验证的 finding；模型正常返回并计入用量，worker error 为 null。

以上是 C 层对输出的验证结果，不能改写为适配器调用失败，也不能把 complete 状态视为模型判断正确。任何 precision/recall 结论仍需证据充分的人工裁决。

## Tokenizer 与审计限制

冻结 tokenizer 为 `@huggingface/tokenizers@0.2.0/DeepSeek-V4.1-Flash-1017@08c8657f02291e11b6f6b63e0e16014f8e748518+chat-allowance-64`。所有 raw metrics 的 tokenizerId 与其一致；本地压缩资源解压后的 SHA-256 均与实现常量一致：

- tokenizer.json：`c90dfa01249db1be4245780a052ede752e1361c612ac6d08e2bdada7d599476b`
- tokenizer_config.json：`6ac8c8dc065ed118161d02dd532749ae3f52c243deac27872134fae2f50d8547`

它是模型正文分词器加 64 token 消息封装余量，配置明确 `token_count_is_exact:false`。本审计核对冻结标识、资源及记录的估计/实际差值；原始请求 prompt 未作为 raw receipt 保存，因此未独立重建每条消息全文并重新计数。小型合成 development 数据、单次 trial、component 边界不能证明真实 PR 泛化或完整产品效益。Pilot 和 full 有样例重叠，不得把两组当独立新样例简单合并为正式证据。

## Pilot 证据标识

- plan_id：`b291ef3179490919d28097fe117c13f17f9fcc46cee2cba17cf95d456d270a95`
- runs 对象 SHA-256（按工具 JSON 序列化）：`1773959e427da75e48b702d9c45b24eeef10cf9de43cabb03cc64f3d40f961c8`
- implementation SHA-256：`52cc3a94c47b6d0f6723e9872a4eeb24636a8c12feaa34a952c02bacb9d9e713`
- dataset SHA-256：`0af0b804120de301c07c633fad2d6f8978b183291b9654769946eda93fc53e5a`
- adapter SHA-256：`122d28d12dd2fe7a79895bc216b1a0023ccd210619a7b7dc4adaebf34f93f88e`
- bridge SHA-256：`cc798fbb4ef48875cc13872a69380ec94ef2a9bb85324c4a112d5a9f35f77105`

来源：`evaluation/runs/bailian-pilot/plan.json`、`runs.json`、`raw/0001.json`–`raw/0012.json`；冻结 provider 实现、cost/runner 验证实现及 tokenizer 资源。


## Full development 全量检查（40/40 原始响应）

full 的冻结实现、数据集、adapter、bridge SHA-256 与 pilot 相同；当前实现仍与冻结值一致。`verifyRuns` 通过，40 个计划运行全部落盘且 completed_plan 为 true；没有 not-executed、漏配对或未知用量。

| 项目 | 已验证结果 |
| --- | --- |
| 覆盖 | DEV-001 至 DEV-020；20 对、每例 B1/B2 各一次；development 单次 trial |
| 每条件类别 | 8 cross-file、8 diff-sufficient、4 clean-only |
| 每条件变体 | 8 faulty、8 fixed、4 clean |
| 状态 | 39 complete / 1 failed；B1 为 19 complete + 1 failed，B2 为 20 complete |
| 实际调用 | 40 次，无重试；40 个响应均 `finish_reason:stop` |
| 模型及参数 | 40/40 actual returned model 精确匹配；effectiveParameters 与冻结配置一致 |
| reasoning 内容 | 40/40 存在 reasoning_content 字段，均为空；未观察到非空 reasoning 文本 |
| 输入 / 输出 | 14,170 / 5,531 token；raw、attempt、metrics、run 全部一致；40/40 total_tokens 等式成立 |
| CNY 估算 | `(14170×2 + 5531×8)/1000000 = 0.072588` 元 |
| 保守预留 | 19.712 CNY（JSON 二进制浮点显示 19.712000000000003）；低于 24 CNY 上限 |
| Token 估计余量 | 40/40 estimated input 比 provider input 多 60；所有 input estimate + 800 ≤ 8,000，实际 output ≤ 800 |
| 请求 / 运行耗时 | attempt 638–4,783 ms；外部 worker 975–5,105 ms；总起止跨度 75,513 ms |
| 输出数量 | B1 保留 17 条、B2 保留 16 条 findings；这是输出计数，不是 TP 数 |

分条件用量与成本：

| 条件 | 输入 token | 输出 token | CNY 估算 |
| --- | ---: | ---: | ---: |
| B1 | 5,606 | 2,828 | 0.033836 |
| B2 | 8,564 | 2,703 | 0.038752 |

唯一异常 `DEV-020/B1/1` 为 failed / INVALID_OUTPUT，worker error 为 null；正常返回的 provider usage 已计入，C 层没有保留 finding。它属于实验观测，不得删去或补跑成成功样本。

全量计费对账：pilot 0.022502 + full 0.072588 = **0.095090 CNY**；输入合计 18,565、输出合计 7,245，共 25,810 token、52 次调用。两阶段保守预留 5.9136 + 19.712 = **25.6256 CNY**，分别不超过 6 / 24 CNY，总计不超过 30 CNY。两组只合并计算资源消耗，不合并质量评分。

## Full 证据标识与归档

- plan_id：`8892d9c68195daea3200ac1db7e40fb2d79b4a2c39bf05a0a4854e4388ca1727`
- runs 对象 SHA-256（按工具 JSON 序列化）：`baa707c96c4c7be4c9104f7408a85c7f318a6e6ed523e119ded6dc1178f5dddf`
- 其余冻结哈希同上方 Pilot 证据标识。
- 审计来源：`evaluation/runs/bailian-development/plan.json`、`runs.json`、`raw/0001.json`–`raw/0040.json`。
- 主流程归档目标为 `evaluation/reports/bailian-2026-11-22/pilot` 与 `evaluation/reports/bailian-2026-11-22/development`；本审计依据原始 runs 目录完成，归档副本由主流程另行校验，不在此预先声称已完成。

所有 52 个原始响应均纳入元数据、用量及边界审计；未进行人工缺陷裁决，也未把 AI 质量判断录为人工确认。最终 precision / recall 必须以人工确认的 atomic judgments 为依据。
