# 百炼 DeepSeek 对照实验

本轮真实调用及模型输出人工复核已经完成，最终指标、结论及原始证据见 [测量总结](../reports/bailian-2026-11-22/README.md)。以下配置、预算和命令说明对应实际执行；两条已确认应保持不确定的主张仍记为 unresolved。

本轮使用阿里云百炼的 `deepseek-v4.1-flash-1017`，对应小组记录的同名固定快照。两种评测条件均走同一百炼业务空间和参数；服务提供方不同于小组历史 RelayCore 记录，不能把跨供应商的延迟、费用或结果混入同一配对实验。相同模型 ID 不证明两家服务的底层部署或随机输出完全一致。

## 参数对应关系

| 项目 | 小组 RelayCore | 本轮百炼 |
| --- | --- | --- |
| 模型 | deepseek-v4.1-flash-1017 | 相同固定 ID；没有降级到其他快照 |
| 关闭思考 | thinking.type = disabled | enable_thinking = false（Node.js 请求体顶层） |
| 输出 | response_format.type = json_object | 相同 |
| 输出限制 | max_tokens = 800 | 相同 |
| 单次超时 | 30 秒 | 相同；剩余总预算不足时进一步缩短 |
| 重试 | SDK 关闭，项目最多 1 次 | 相同，复用 C 的重试与失败处理 |
| 计数 | 同模型 tokenizer + 64 封装余量 | 相同预算估算；实际 usage 单独保存 |

C 的 `reviewFiles` 继续负责提示词、解析、证据验证、重试和预算；仅新增百炼传输适配器，将关闭思考字段映射为该服务的正式参数。B2 使用生产 `collectContext`；B1 不传入检索上下文。两种模式都追加相同的公开行为要求，输出边界是组件 findings，不是完整门禁/报告系统。

## 来源与费用

- [百炼 DeepSeek API 文档](https://help.aliyun.cn/zh/model-studio/deepseek-api)：业务空间与地域专用地址、参数用法。
- [模型快照与原价](https://help.aliyun.cn/zh/model-studio/deepseek-v4-1-flash)：固定 1017 快照及各地域费率。核查日期为 2026-11-22。

采用北京地域的公开忙时、未命中缓存价格估算：输入 2 元／百万 token，输出 8 元／百万 token。缓存或闲时可能更便宜；这不是账户实际账单。CNY 原生记录在 `cost_currency` / `cost_amount` 中，不能写入美元字段。usage 未知则费用未知。

本轮总支出上限为用户确认的 30 元：先给 6 快照试跑预留 6 元，后续 20 快照实验最多预留 24 元。两轮各自生成配置和计划，保留原始记录，不挑选较好的重复结果拼接成绩。runner 对全部配对按最坏调用/token 预算预留；该估算不能保证供应商绝不会超出输出约束，因此超限响应应保留并停止相关调用，未知费用不能当零。

## 冻结与运行

在仓库根目录执行。`BASE_URL` 必须是已确认的官方业务空间完整地址；`CAP.json` 仅含本轮分配的 `max_cost`（CNY）。凭据从安全本地环境的 `DASHSCOPE_API_KEY` 读取，不写入配置、日志或仓库。

```sh
node evaluation/build-adapter.cjs
node evaluation/adapters/bailian-prepare.cjs pilot BASE_URL evaluation/runs/bailian-pilot-config.json CAP.json
node evaluation/cli.cjs plan --config evaluation/runs/bailian-pilot-config.json --out evaluation/runs/bailian-pilot-plan.json
node evaluation/cli.cjs run --plan evaluation/runs/bailian-pilot-plan.json --adapter evaluation/.cache/bailian-provider.cjs --live --out evaluation/runs/bailian-pilot
```

完整实验将 `pilot` 改为 `development` 并使用新的配置、计划、输出目录及剩余预算。开始前检查固定模型、关闭思考、JSON 信封、usage 和实际返回的 model；不自动切换服务或模型来掩盖失败。原始输出里的 reasoning/usage 字段用于核查服务行为，不当作人工评分。

## 评分与交付

样例与模型输出均已由用户完成单人复核。AI 在隐藏模式的评分包上给出建议，用户确认后输出评分状态改为 reviewed；两条仍无法确定的运行时兼容性主张保留 unresolved，以精确率上下界表达，不强行裁决。

汇总需包含逐次输出、覆盖与遗漏、模型调用/重试、实际 usage、失败原因、检索/C/worker 耗时，以及可复算配置和数据指纹。组件实验不含 GitHub 排队、安装或发布；这些如需验收，应单列 A 的真实 Action 证据。真实运行完成后再补测量报告，不能用离线测试替代模型成绩。
