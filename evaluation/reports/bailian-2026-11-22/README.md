# 百炼真实对照：一页测量总结

本轮已完成 **6 例试跑 × 2 模式 + 20 例完整对照 × 2 模式，共 52 次真实模型调用**。用户已确认样例、标准答案及全部模型输出判断建议，人工复核状态已登记为 reviewed，不记录复核人或日期。试跑用于检查接口，以下质量指标只使用后续完整对照，不合并或择优挑选重复结果。此次评分没有新增模型调用。

## 最终质量指标与结论

| 指标 | Diff-only（B1） | 真实 Context（B2） |
| --- | ---: | ---: |
| 已知缺陷召回率（根因去重） | 8/8 = 100% | 8/8 = 100% |
| 正确主张根因 | 8 | 8 |
| 非命中主张（误报与范围外合计） | 12 | 8 |
| 未决主张 | 1 | 1 |
| 可行动主张精确率范围 | 8/21–9/21 = 38.10%–42.86% | 8/17–9/17 = 47.06%–52.94% |
| 正常／修复快照成功率 | 2/11 = 18.18% | 4/11 = 36.36% |
| 正确原子主张的位置符合率 | 9/9 = 100% | 9/9 = 100% |
| 正确原子主张的严重度一致率 | 2/9 = 22.22% | 2/9 = 22.22% |

**本轮 Context 没有增加已知缺陷发现数，但非命中主张更少，正常／修复样例成功率更高；同时消耗更多输入 token 和费用。** 两种模式都倾向于把部分中等严重度问题评得更高。100% 仅指这 8 个已知缺陷的召回率，不是整体准确率，也不是对真实项目的泛化保证。

口径说明：按冻结规则拆分原子主张、按根因去重；范围外的实质建议仍计入可行动主张精确率的分母。每组各 1 条 Object.hasOwn 旧运行时兼容性判断仍为 unresolved，用户认可“不确定”不等于确认其正确，因此精确率给出上下界；这些范围不是统计置信区间。每组原有 12 个无已知缺陷快照，各排除 1 个未决样例后剩 11 个，成功要求完整分析且没有主张；B1 的格式失败仍算未成功。位置和严重度按 9 个正确原子主张计算，其中包含同一缓存根因的两个后果，不能当成 9 个独立缺陷。

已知缺陷召回率差为 0 个百分点；8 家族 bootstrap 在本轮产生 [0,0] 的退化区间，因为所有观测差都为零，这不能证明两种方法总体等效。评测仍是单次、合成 development 组件实验，机器标记保持 `EXPLORATORY_OR_INCOMPLETE`；不升级为 formal/heldout。

## 固定配置与一致性

同一北京百炼业务空间、`deepseek-v4.1-flash-1017`、`enable_thinking:false`、JSON 输出、800 输出 token、30 秒单次超时、SDK 自动重试关闭、C 最多重试一次。52 个返回 model 均匹配指定快照，返回的 reasoning_content 均为空；不把未返回的 reasoning token 数推定为 0。

小组 RelayCore 的关闭思考参数是 `thinking.type=disabled`，百炼使用等价的服务参数；不能据同名模型保证两家底层部署和随机输出完全一致。此次 B1/B2 都使用百炼，不能将耗时或费用与 RelayCore 历史运行混为同一次实验。配置映射与来源见 [百炼接入说明](../../docs/BAILIAN_COMPARISON.md)。

代码基线为 `8961812`，精确执行源码另由计划中的 `implementation_sha256` 固定；运行发生在本次百炼适配修改提交前，源码指纹记录这些修改。样例仍为 reviewed development，不是独立 heldout。

## 完整对照观测

| 指标 | Diff-only（B1） | 真实 Context（B2） |
| --- | ---: | ---: |
| 已运行快照 | 20 | 20 |
| 完整分析 / 失败 | 19 / 1 | 20 / 0 |
| 模型调用 / 重试 | 20 / 0 | 20 / 0 |
| 经 C 验证保留的 findings | 17 | 16 |
| provider 输入 token | 5,606 | 8,564 |
| provider 输出 token | 2,828 | 2,703 |
| worker 耗时 p50（最近秩） | 1.745 秒 | 1.608 秒 |
| 单次请求耗时 p50（最近秩） | 1.438 秒 | 1.288 秒 |
| 费用估算（人民币） | 0.033836 元 | 0.038752 元 |

Context 增加 2,958 输入 token，减少 125 输出 token，估算多花 0.004916 元；findings 数量不代表正确缺陷数。每个条件只运行一次，不能凭这组延迟观察承诺 Context 更快；质量指标采用上面的已确认人工判断。

费用按 [百炼 1017 快照北京忙时原价](https://help.aliyun.cn/zh/model-studio/deepseek-v4-1-flash)估算，未应用缓存或闲时优惠，不等同账户账单。试跑 0.022502 元，完整对照 0.072588 元，**合计 0.095090 元**；52 次 usage 均有记录。用户总预算 30 元，分配试跑 6 元、完整对照 24 元；配对保守预留合计 25.6256 元，实际估算明显低于预算。

## 失败与覆盖边界

- 完整对照 `DEV-020/B1/1` 为 `INVALID_OUTPUT`，保留失败及 usage，没有重跑择优或当作安全成功。
- 试跑另有 `DEV-006/B1/1` 的 `UNVERIFIED_FINDING`（部分完成）、`DEV-009/B2/1` 的 `INVALID_OUTPUT`（失败），单独留存。
- 覆盖当前 12 家族／20 快照、8 个已知缺陷根因。B2 使用真实检索；输入含相同的公开需求，部分 diff 本身已有判断线索，不能预设跨文件样例一定需要 Context。
- 计时为本地 worker、检索和 C 请求，不包括 GitHub runner 排队、安装、报告发布或门禁操作；这些属于另外的 Action 验收。此次没有实际触发超时或调用/token 上限，不能声称所有资源边界均已现场验收。
- 可靠性总体证据继续引用 [团队验收矩阵](../../../docs/SPRINT2_GATE_ACCEPTANCE.md)；F 的组件试跑不替代 A/D 的权限、批准历史、旧 SHA 和发布失败验收。

## 复核与复算

用户已确认 [AI 输出判断建议](review/AI_SUGGESTIONS.md) 无差异，确认记录在 [confirmed-packets.json](review/confirmed-packets.json)，解盲后的逐条标签在 [labels-reviewed.json](development/labels-reviewed.json)。原始 AI 草稿和 `summary-pending` 保留为历史中间产物；最终报告使用 `summary-reviewed`，两条未决判断保留，不猜测裁决。

- [完整对照原始记录](development/runs.json) / [固定计划](development/plan.json) / [最终指标 JSON](development/summary-reviewed/summary.json) / [独立指标审计](FINAL_METRIC_AUDIT.md)
- [试跑原始记录](pilot/runs.json) / [独立用量与一致性审计](../bailian-audit.md)
- [可复算测量 JSON](measurements.json)。仓库根目录执行 `node evaluation/reports/bailian-2026-11-22/recompute.cjs` 可重新生成相同测量结果；工具先核对原始输出摘要和固定计划。

最终质量指标复算（使用新的输出目录，避免覆盖证据）：

```sh
node evaluation/cli.cjs score --runs evaluation/reports/bailian-2026-11-22/development --labels evaluation/reports/bailian-2026-11-22/development/labels-reviewed.json --out evaluation/runs/bailian-reviewed-recomputed
```

内容源或标签修改后需新版本和一致重算，原始响应不覆盖。API 密钥没有写入这些记录或仓库。
