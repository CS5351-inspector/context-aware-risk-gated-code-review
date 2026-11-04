# Sprint 1 集成与接手说明

CS5351 · Group 2 inspector · 2026-11-04

本次按群聊的 A–F 边界整合 PR #2–#5，保留各作者的原始提交。当前交付是可测试的模块和集成基础；真实 Context-Aware + Risk-Gated GitHub 全链路尚未完成。这里是当前状态入口，原候选文档保留为设计记录。

## 各 PR 的处理

| PR / 原作者 | 保留的成果 | 集成时修正 |
| --- | --- | --- |
| #2 · FubieLee | C 双模式模型调用、校验、预算和重试；旧协议兼容 | 有效 high 与无效条目混合时保留 high，并标必要遗漏；推理模型输出预算字段；类型改为引用公共契约 |
| #3 · transparent-white | 基线记录、lock 修复、CI 和可注入流水线的起点 | 移除重复 CI；不再默认注入 mock 或固定 COMPLETE；旧类型入口转为公共契约 re-export |
| #4 · peizhiHe29 | 6 个语义家族、10 个快照、反例、导出脚本 | 验证未声明的依赖变化和 gold 行号；接入统一 CI；保留 provisional / B2-oracle 边界 |
| #5 · ayame2847 | 公共领域模型、55 个公开可靠性场景、完整性工具 | 去掉重复 analyzedFiles 字段；对齐 C 的四类结果；补批准、证据版本、HIGH 保留等反例检查 |

这些测试检查覆盖范围内的行为。55 个可靠性场景不是 55 个真实缺陷，也不是生产 gate 的验收结果；52 development + 3 reserved 都公开，不能称独立盲测。#4 与 #5 分开计数。

## 唯一接口来源

- `src/review/contracts.ts`：当前集成契约 v1；修改字段要同时更新调用方和测试。
- `src/types.ts`：兼容导出，不再定义第二套字段。
- `src/review/model-types.ts`：从公共类型派生 C 所需最小投影。
- `src/pipeline.ts`：显式注入 B/C/D；汇总 scope、omissions、状态和剩余分析时间。diff-only 不调用 B。
- `src/review/config.ts`：在 provider 调用前验证配置；作者身份必须与快照相符。
- `src/review/snapshot.ts`：固定三种 SHA，检查观测到的输入变化、文件数量与读取版本。
- `src/review/publication.ts`：共享发布守卫；只向被审查 SHA 写状态，先写 pending/failure 清除旧放行，再发报告，最后才可能写 success；报告按运行单独创建。
- `src/mocks.ts`：显式离线样例；结果标 `provider=mock`，发布器拒绝发布这种结果。

C 的实际函数为 `reviewFiles(client, input, snippets, budget, runtime)`。接入流水线时用闭包注入 client 和准确 token 计数器；见 `test/pipeline.test.ts` 的 C 集成测试。测试中的固定 token 数只用于 mock，不可用于 live 计费或预算。

空 findings 只有在声明范围完成分析时才是 COMPLETE。必要缺失且有可用分析为 PARTIAL，无可用分析为 FAILED；无支持文件为 NOT_APPLICABLE，不能称“代码审查通过”。必要遗漏不删除已经保留的 high finding。D 的完整风险/批准算法仍需实现。

## 下一步各模块只接自己的部分

| 模块 | 当前接手人（按聊天） | 下一步可交付项与验收 |
| --- | --- | --- |
| A 架构/基建 | 庞剑峰 Jianfeng Pang | 用这些端口接真实 GitHub 读取/写入；与 D 完成同 SHA 审阅事件串行化、撤销后的重算；B/D/E 可用后接入 Action；在专用演示分支配置并验证 required status |
| B 上下文 | 陆馨怡 Xinyi Lu / transparent-white | 用 `ReadFileAtRef` 获取附近代码和一种直接定义；去重、裁剪并区分必要遗漏与可选裁剪；给同一 PR 的双模式集成样例。#3 的基建贡献继续保留 |
| C 模型可靠性 | 李宗蔚 Zongwei Li / FubieLee | 基于已合入模块补真实适配器/tokenizer 的配置验证；与 B 验证 LEFT/RIGHT 证据；记录一次受控真实调用及错误案例，保持模型参数一致 |
| D 风险门禁 | 待认领 | 实现纯函数风险规则和严格当前 SHA 的有效批准；排除作者/bot/read-only、处理 COMMENTED/撤销/请求修改；A 结对检查放行逻辑 |
| E 报告 | 待认领 | 实现 `RenderReport`：证据、遗漏、无行号、长度限制和下一步；调用 A 发布端口，不复制 SHA 检查；首版按运行发布，先不做共享评论覆盖 |
| F 评测 | peizhiHe29（真实姓名待组内确认） | 第二人复核 provisional gold，记录复核人和分歧；新增独立评价样例；运行同参数 diff-only / 实际 B context 对照，记录正确发现、误报、耗时、成本和人工审阅时间 |

各成员负责自己模块测试；F 负责评价资产与实验，不承担全组所有测试。D/E 尚未指定人员，不按姓名猜能力。

## 运行与 CI

推荐 Node 24、npm，执行：

```sh
npm ci
npm run typecheck
npm test -- --runInBand
npm run test:evaluation
npm run build
node --check action/index.cjs
```

`typecheck` 检查 TypeScript 源码，显式关闭上游 CJS 的 checkJs；不声称旧 JS 已通过静态检查。Rollup 配置改为原生 `.mjs`，避免仅为加载配置而启动 TypeScript watcher 后无法退出；源码类型由独立 typecheck 负责。统一的 Test and Build CI 同时验证两套测试资产，并检查已提交的 Action 构建产物是否一致。质量 CI 只需要 contents:read，不需要模型密钥。

`Legacy Code Review (opt-in)` 保留上游真实模型演示；只有同仓库 PR 且仓库变量 `ENABLE_LEGACY_REVIEW=true` 时运行。它仍调用旧 bot 路径，不能作为增强版风险门禁或正式质量检查。目前没有自动启用变量或部署增强 gate。

## 真实接线前必须补的边界

1. 输入端口目前用两次 metadata 检查可观测的变化，不提供 GitHub 多个 API 的原子快照证明。真实适配器须使用提交固定的 diff/本地 git，或用固定 blob 校验 patch，处理分页期间 force-push 又回到原 SHA 的情况。
2. 发布器隔离不同 head；同一个 SHA 上的批准、撤销和并发运行还需要 A+D 的事件串行化及发布前重新计算批准。仅取消 workflow 不能当成原子锁。
3. GitHub 无“比较 head 并写入”的原子接口，因此报告明确写入被审查 SHA；旧运行可能留下旧版本报告，但不能覆盖当前共享摘要，也不能给新 SHA 写 success。
4. B/D/E、GitHub 端口、准确 token 计数和 live 调用还未全部接入 `src/bot.ts`。因此不要把全部 TODO 勾完成、启用生产风险 gate 或宣称效率已提高。
5. 报告采用按运行创建，暂不保证重复事件去重；共享摘要 upsert 留到具备并发一致性方案后再做。

这符合课设的可追溯协作方式：保留 PR/复核/测试证据，在下一个 sprint 演示实际链路，再用独立评价数据验证收益。可靠性与版本一致性是非功能需求的实现依据，模型效果仍是待验证假设。

## 本次本地复核结果

2026-11-04：Jest 10 suites / 290 tests 通过；evaluation 10/10 测试通过，50 次行为检查、8 次预期违约；TypeScript 检查、完整构建、Action 语法检查通过。无真实模型调用。GitHub 的最终 CI 结果以集成 PR 的 Checks 为准。
