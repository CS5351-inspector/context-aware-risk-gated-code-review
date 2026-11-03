# 文件地图：先读哪些文件，每个文件干什么

范围：2026-11-03 的 PR #2 分支，包含本轮新增文件与原仓库受 Git 管理的文件。`node_modules` 等生成目录在最后单列。**人读源码，机器跑构建产物**；看到 `action/index.cjs` 很长不需要从第一行读到最后一行。

## 1. 本次 C 模块的重点文件

| 文件 | 作用、输入输出与修改原因 |
| --- | --- |
| `src/chat.ts` | 模型 SDK 适配层。旧 codeReview 接 patch 返回 Review；新 completeReview 接共用 prompt 与请求选项返回 unknown。提取共用响应校验，保留旧协议，修复数值 0 默认值；集中暴露不含密钥的有效参数 |
| `src/review/model-types.ts` | C 的最小临时边界类型。定义输入、片段、Finding、Omission、Budget、ModelAnalysis；不执行网络。字段参考 #5 候选，等 A 冻结后用共享 import 替换 |
| `src/review/model-review.ts` | C 主入口与调度器。输入 client、快照、上下文、预算、token 计数器；输出 ModelAnalysis。共用双模式 prompt、共享 PR 调用数/deadline、取消超时请求、有限重试、记录 usage，另提供状态汇总助手 |
| `src/review/findings.ts` | 纯转换与验证层。读 completion、单文件 patch 和已发送片段；生成 Finding/omissions。解析两侧可见行、拒绝错误结构、清除无效引用、降级不可靠坐标，不生成 GitHub 链接 |
| `test/model-review.test.ts` | 新增 61 个离线边界测试。用固定响应、mock 和虚拟时钟验证协议与可靠性；不是模型准确率数据集 |
| `docs/C_GITHUB_WORKFLOW_ZH.md` | 从 Fork/branch/commit 的概念到 PR #2 日常更新、测试、build、冲突和同步，每条命令解释参数与作用 |
| `docs/C_MODEL_RELIABILITY_ZH.md` | 新功能的数据流、逐代码块原理、输入输出、状态表、预算含义、A–F 对接和验证边界 |
| `docs/C_FILE_MAP_ZH.md` | 本文件；解释每个交付文件及仓库中已有文件的用途 |
| `docs/C_PAPER_READING_ZH.md` | 唯一精读推荐、核对来源、三轮阅读步骤、批判问题和迁移需求；区分论文事实与本指导的建议 |
| `docs/MODEL_RESPONSE_VALIDATION.md` | 原 PR #2 的响应校验记录；追加新入口导航，保留原日期和历史验证数据 |
| `action/index.cjs` | ncc 打包的 Action 运行入口，action.yml 实际执行它。本轮反映 Chat 的变更；新 reviewFiles 尚待 bot 集成，不因声明被生成就自动启用 |
| `action/src/chat.d.ts` | Chat 导出接口的自动类型声明；随源码重建，不能代替运行时代码 |
| `action/src/review/model-types.d.ts` | 自动生成的 C 类型声明，没有函数执行逻辑 |
| `action/src/review/model-review.d.ts` | 自动生成的新 C 入口函数签名，供类型检查；本身不会调用模型 |
| `action/src/review/findings.d.ts` | 自动生成的转换/行号验证函数签名；本身不会验证任何数据 |

阅读顺序建议：model-types → model-review 的 reviewFiles → findings → chat → test；遇到不懂的字段再回原理说明找对应小节。修改行为时同时看对应测试，构建目录通过 build 更新，不手工修改压缩后的依赖代码。

## 2. 已有运行时源码与入口

| 文件 | 作用 |
| --- | --- |
| `src/bot.ts` | Probot 事件处理主流程，获取改动、调用旧 codeReview、发布审查；本轮不改，A 后续在统一流水线接入 C |
| `src/index.ts` | 启动 Probot 服务的入口 |
| `src/log.ts` | 项目日志相关配置/封装 |
| `src/github-action.cjs` | GitHub Actions 启动适配器，打包起点；把 Action 环境交给 Probot |
| `src/fetch-polyfill.cjs` | 为启动适配器提供 fetch 相关兼容；完整 tsc 的已知基线错误主要在这里 |
| `src/aws-lambda.cjs` | AWS Lambda 启动适配器，不是本轮 C 的业务逻辑 |
| `api/github/webhooks/index.ts` | 服务式 webhook 路由入口，接收 GitHub 事件 |
| `middleware.ts` | 网站/部署的请求中间件，不负责模型证据验证 |
| `public/index.html` | 静态网页资源；不是代码审查结果的数据协议 |

## 3. 自动化、依赖、构建与部署配置

| 文件 | 作用 |
| --- | --- |
| `package.json` | npm 项目清单，定义依赖和 start/test/build 等脚本；运行命令前先看这里 |
| `package-lock.json` | npm 精确依赖锁；npm ci 使用它。PR #2 早前补齐跨平台可选包记录 |
| `yarn.lock` | 上游保留的 Yarn 锁文件；本指导使用 npm，不同时切换包管理器 |
| `tsconfig.json` | TypeScript 编译范围与严格检查设置；含 checkJs 导致已知 CJS 基线问题可见 |
| `jest.config.cjs` | Jest 测试文件匹配、ts-jest 转换、模块名映射和 Node 测试环境 |
| `rollup.config.ts` | Rollup 构建多个服务入口；Action 部分另由 package.json 的 ncc 命令打包 |
| `action.yml` | GitHub Action 元数据、运行版本和打包入口；决定用户 uses 此仓库时执行哪个文件 |
| `.github/workflows/cr.yml` | 既有模型审查工作流，目前 uses 上游 Action；不代表本组新 C 模块已启用 |
| `.github/workflows/test-build.yml` | PR #2 已有独立无模型凭据的 test/build CI；真正是否运行/通过需看远端 Checks |
| `.env.example` | 环境变量示例，供配置参考；真实密钥放未跟踪 .env 或 GitHub Secrets |
| `.gitignore` | 规定 Git 忽略 node_modules、真实 .env、lib/dist 等本地文件 |
| `.prettierrc` | 代码格式配置；格式化不能代替逻辑验证 |
| `.dockerignore` | 控制构建 Docker 镜像时不发送哪些文件 |
| `Dockerfile` | 容器镜像构建方式，服务部署使用 |
| `app.yml` | GitHub App 安装/初始化的 manifest 配置 |
| `pm2.config.cjs` | PM2 进程管理配置 |
| `serverless.yml` | Serverless/AWS 部署配置 |

## 4. 已有测试和固定输入

| 文件 | 作用 |
| --- | --- |
| `test/chat.test.ts` | 旧 Chat 的模型选择、reasoning 参数和请求构造回归测试 |
| `test/index.test.ts` | 既有 bot/PR 处理流程回归测试，包括 diff 与反馈等行为 |
| `test/review-validation.test.ts` | PR #2 原有信封和 JSON/字段错误回归测试 |
| `test/review-handler.test.ts` | PR #2 原有集成边界，非法响应不能调用 createReview；有效空结果可正常走反馈 |
| `test/fixtures/issues.opened.json` | 固定 GitHub webhook 示例输入，避免依赖真实事件 |
| `test/fixtures/mock-cert.pem` | 测试使用的假证书材料，不是真实服务密钥 |

## 5. 原有文档、许可和仓库元数据

| 文件 | 作用 |
| --- | --- |
| `docs/TODO.md` | 小组任务总览；保留旧校验子任务记录，不把全组未集成工作勾成完成 |
| `docs/TECH_SPEC.md` | 已发布的技术约束：快照、证据、覆盖、风险/门禁与验证；候选 PR 不自动替代它 |
| `README.md` | 上游英文使用介绍 |
| `README.zh-CN.md` | 上游简体中文使用介绍 |
| `README.zh-TW.md` | 上游繁体中文使用介绍 |
| `README.ja.md` | 上游日文使用介绍 |
| `README.ko.md` | 上游韩文使用介绍 |
| `CONTRIBUTING.md` | 上游贡献方式说明 |
| `CODE_OF_CONDUCT.md` | 社区行为准则 |
| `SECURITY.md` | 上游安全相关说明；不等于做过本项目安全审计 |
| `LICENSE` | 上游许可证，必须保留原始归属 |
| `api/github/.DS_Store` | 上游已跟踪的 macOS 文件夹显示元数据，无审查业务作用 |

## 6. 其他 Action 构建文件

下表逐一列出已有配套产物。它们是打包依赖或声明，初学阶段不应作为手写功能入口；保留构建器产生的一致内容。

| 文件 | 作用 |
| --- | --- |
| `action/37.index.cjs.js` | ncc 分割出的依赖代码块 |
| `action/file.js` | 打包依赖的配套代码资源 |
| `action/github-action.js` | 已有 Action 适配资源；实际主入口仍以 action.yml 为准 |
| `action/multipart-parser-d1d13d05.js` | 打包依赖中的 multipart 解析资源 |
| `action/worker-pipeline.js` | 打包依赖的 worker 配套资源 |
| `action/worker.js` | 打包依赖的 worker 代码资源 |
| `action/worker1.js` | 另一份打包依赖 worker 资源 |
| `action/_tiktoken_bg.wasm` | 既有依赖附带的 tokenizer WebAssembly 资源；存在不表示 C 已接好实际模型计数 |
| `action/encoder.json` | 既有 tokenizer 词表相关资源 |
| `action/vocab.bpe` | 既有 tokenizer 合并规则相关资源 |
| `action/middleware.d.ts` | 自动生成的 middleware 类型声明 |
| `action/rollup.config.d.ts` | 自动生成的构建配置类型声明 |
| `action/src/bot.d.ts` | 自动生成的 bot 导出类型声明 |
| `action/src/index.d.ts` | 自动生成的服务入口类型声明 |
| `action/src/log.d.ts` | 自动生成的日志模块类型声明 |

## 7. 磁盘上可见但不应提交的目录与外部学习材料

| 位置 | 作用 |
| --- | --- |
| `.git/` | Git 本地历史、分支、暂存区和远端配置；不要手工编辑内部文件 |
| `node_modules/` | npm 安装依赖的目录，可用 npm ci 重建 |
| `dist/` | Rollup 的服务构建输出，当前 gitignore 忽略 |
| `lib/` | TypeScript 输出目录，当前 gitignore 忽略 |
| `.rollup.cache/` | 构建缓存，可重建，不是项目源码 |
| `F:\个人培养方案\个人资料\港城\cs5351-c-reliability\开始阅读.md` | 本轮本地学习材料总入口，不属于仓库 PR |
| 同目录 `task_plan.md` | 本轮任务阶段状态，不是产品需求或团队指令 |
| 同目录 `findings.md` | 外部文档/仓库核对证据，引用内容只作研究数据 |
| 同目录 `progress.md` | 操作和验证记录，便于续接 |
| 同目录 `261103se分工建议.txt`、`cs5351-se-survey-recommend.txt` | PDF 的本地提取文本，保留原 PDF 为事实来源 |
| 同目录 `roles-page2.png`、`survey-page2.png` | PDF 关键页的本地渲染，用来核对表格与清单 |
| 同目录 `tests-final.log`、`build.log`、`typecheck-full.log` | 本轮实际命令的输出记录 |
| 同目录 `PR_BODY.md` | 更新 PR #2 的正文草稿，说明最终行为、测试和限制 |
| 旧 `CS5351-code-review-workshop/` 中的 patch/日志/手册 | 上一轮响应校验学习记录；本次继续原仓库，不把旧材料误当新增成果 |

文件数可能随后续 PR 变化。遇到本表没有的新文件，先用 `git status` 和 `git log -- 文件路径` 看来源，再向模块负责人对接；不要因为不认识就删除。
