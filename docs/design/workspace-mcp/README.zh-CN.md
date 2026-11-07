# Univer Workspace 远程 MCP Server：工程需求

> 状态：需求已定稿，待实施。整理日期 2026-11-07。
> 本目录是实施者的入口。背景调研见 [低门槛 Agent 入口调研](../low-friction-agent-entry.zh-CN.md)，它只记录当时的推理，不是实施依据。

## 1. 要解决的问题

Univer Workspace 现在有两个 agent 入口，门槛都偏高：

- **Workspace Agent（`apps/agent`，基于 DSH）** 要单独下载桌面应用，是一个独立入口，不是用户平时用的 agent。
- **`univer-workspace-cli`（`uvw`）** 依赖 Node、npm、原生绑定和终端，只适合开发者，也只能在能执行 shell 的 agent 里用。

很多 Workspace 用户不是开发者。他们平时用的 agent 是 ChatGPT、claude.ai、手机端、WorkBuddy 这类，没有本机 shell。

**目标：** 用户在自己的 agent 里填一个 URL，在浏览器里登录一次，不安装任何东西，就能完成 `uvw` 能做的事。

**做法：** 新增一个远程 MCP Server。它是继 `uvw` 和 DSH 插件之后的第三个 Node-hosted Workspace Client。
原来在用户本机运行的 daemon、headless Univer、Office 交换、Typst、Chromium，全部搬到我们的云端执行。
大模型推理仍由用户自己的 agent 完成，我们只负责执行工具。

## 2. 已确定的决策

| # | 决策 | 来源 |
| --- | --- | --- |
| D1 | MCP Server 是新的 Node-hosted Workspace Client，构建在 `packages/client-core` 上，不放进 Workspace Server | 第一轮讨论 |
| D2 | 能力对齐 `uvw`，只保留形态带来的不可避免差异，差异清单见 [工具规格](tools.zh-CN.md) | 第二轮讨论 |
| D3 | 先做 SaaS（`space.univer.ai`），私有化以后再做 | 第二轮讨论 |
| D4 | 接受在服务端执行模型生成的代码 | 第二轮讨论 |
| D5 | 先做用量统计，计费策略以后设计 | 第二轮讨论 |
| D6 | DSH Agent 继续作为完整的独立产品，本项目不改动它 | 第二轮讨论 |
| D7 | Univer license 没有授权问题。这是 Univer 团队自己的项目，服务端多租户运行 headless Univer 不受限制 | 第三轮讨论 |
| D8 | MCP 的临时文件存储沿用 Workspace Server 的方式，即存储接口加本地文件系统实现 | 第三轮讨论 |
| D9 | 个人访问令牌（PAT）按宽松原则设计。默认授予全部 scope，默认不过期，可以随时吊销 | 第三轮讨论 |
| D10 | `admin` toolset 默认对 Team Space Owner 开放 | 第三轮讨论 |
| D11 | Workspace Server 和 MCP Server 分开部署，MCP Server 单独扩缩容 | 第三轮讨论 |
| D12 | MCP Server 是执行层，不连接任何数据库，包括 Workspace 的数据库和它自己的数据库。它只通过 Workspace 的 HTTP API 和协同协议工作 | 第三轮讨论 |
| D13 | 原型阶段用本机 Docker 服务模拟远程 MCP Server，并扩展 `verify-uvw` skill，让它在启动验证实例时一起启动 MCP Server | 第三轮讨论 |
| D14 | 本地测试 MCP 功能一律用本机 opencode，模型 `console-deepseek/deepseek-flash`（DeepSeek V4.1 Flash 1017，provider “Personal / DeepSeek”），不用 Claude Code。阶段 H 在各真实客户端里的验收不受影响 | 2026-11-07 评审 `local-verification.zh-CN.md` |

后续讨论如果推翻其中任何一条，在这张表里追加新行并注明日期，不要直接改旧行。

## 3. 范围

### 3.1 要做

- 新应用 `apps/mcp`。它包含 MCP 网关和执行层两个进程入口，打成一个 Docker 镜像，以两种角色部署。
- 渲染服务，为截图、PDF 和版式检查提供 Chromium。它可以是同一个镜像的第三种角色。
- 对齐 `uvw` 的工具集，约 54 个工具，按 toolset 分组。
- `packages/client-core` 的多租户改造。所有改动都是增量的，CLI 行为不变。
- Workspace Server 的认证扩展：OAuth 元数据、客户端注册、refresh token、scope、token exchange、PAT。
- 用量统计：结构化用量事件和 Prometheus 指标。
- `verify-uvw` skill 扩展：启动 MCP Server，并提供调用 MCP 工具、记录证据的命令。
- SaaS 部署：独立的 Helm release，ingress 把 `/mcp` 路径转发到 MCP 网关。
- Workspace Browser 里的“连接到 AI 助手”设置页和 PAT 管理页。

### 3.2 不做

- 不改 DSH Agent（`apps/agent`）、DSH 插件（`packages/dsh-*`）和 `packages/dsh-runtime`。
- 不改 `uvw` 的命令、输出和打包产物。CLI 产物不包含 MCP 代码。
- 不做私有化部署的 MCP 方案，包括内网隧道和本机 MCP。
- 不做计费，只记录用量。
- MCP 不保存任何持久数据，没有数据库，也没有用户配置存储。
- 不做 MCP Apps（对话内嵌 UI）、agent 型工具（由我们的服务端 agent 完成整个任务）和 WebMCP，以后单独立项。
- 不提交 Claude、ChatGPT 等平台的连接器目录。等 SaaS 稳定后单独做。

## 4. 兼容性标准

这些标准适用于每一个 PR。违反任何一条的 PR 都不能合入。

### 4.1 CLI（`apps/cli`）

- `uvw` 的命令、参数、退出码、`--json` 输出和错误形状不变。
- `pnpm --filter univer-workspace-cli test` 通过。
- `pnpm package:workspace-cli` 成功，产物经 `verify-package.mjs` 校验。产物中不出现 `apps/mcp` 的代码或依赖。
- `client-core` 新增的选项都有默认值，默认值等于现在的行为。CLI 不需要修改任何调用就能保持原样。
- 用 `verify-uvw` 跑一遍 `features/README.md` 里的 CLI 旅程，结果与改动前一致。

### 4.2 DSH Agent 与 DSH 插件

- 本项目不修改 `apps/agent`、`packages/dsh-univer-workspace-plugin`、`packages/dsh-univer-workspace-skin-plugin`、`packages/dsh-runtime` 下的任何文件。
- DSH 插件有自己的一份运行时 key 逻辑（`packages/dsh-univer-workspace-plugin/src/runtime/target.ts`），不使用 `client-core` 的运行时池，所以 `client-core` 的改动不会影响它。实施者不要顺手统一这两份实现。
- 现有 OAuth 客户端 `univer-workspace-harness` 的流程不变。`session` scope 照旧返回登录 session token。

### 4.3 Workspace Server 与 Browser

- 现有 HTTP 接口的行为不变。HTTP contract 只做新增，不改既有字段的含义。每次修改都运行 `pnpm --filter @univerjs/univer-workspace api:verify`。
- cookie 认证照旧可用。新增的 Bearer 和 PAT 认证与 cookie 并存。
- 数据库 schema 的改动遵守 `apps/workspace/AGENTS.md`，并运行 `verify-db-migration` skill 的完整迁移矩阵。
- 所有 `@univerjs/*`、`@univerjs-pro/*`、`@univer-cli/*` 依赖继续使用同一个 SDK baseline（根 `AGENTS.md`）。`apps/mcp` 不引入第二个版本。
- 不引入新的 React 运行时，不引用 `@deepseek-ai/*` 包。

### 4.4 仓库

- `apps/mcp` 是 private package，不发布到 npm。
- 新增 `apps/mcp` 的 PR 同时更新根 `AGENTS.md` 的仓库结构、根 `README.md`、`DREAMNUM.md`，并新建 `apps/mcp/AGENTS.md` 和 `apps/mcp/README.md`。
- 相互依赖的 PR 用 GitHub stacked PR 组织，标题和提交信息遵循 Conventional Commits（根 `AGENTS.md`）。

## 5. 阶段总览

详细内容见 [阶段计划](stages.zh-CN.md)。每个阶段都以 `verify-uvw` 里的真实运行结果作为验收证据。

```text
A 骨架与本地验证环境 ──▶ B 产品工具（纯 HTTP）──────────────┐
        │                                                 │
        ├──▶ C client-core 多租户改造 ──▶ D 执行层 ──▶ E 渲染服务 │
        │                                    │            │
        └──▶ F Workspace 认证 ────────────────┼────────────┤
                                             ▼            ▼
                                   G 执行层安全设计与评审（门禁）
                                             │
                                             ▼
                                   H SaaS 部署与开放
                                             │
                                             ▼
                                   I 来源归因（可选）
```

| 阶段 | 目标 | 依赖 | 主要改动位置 |
| --- | --- | --- | --- |
| A | `apps/mcp` 骨架、Docker 镜像、`verify-uvw` 能启动 MCP 并调用工具 | 无 | `apps/mcp`、`.agents/skills/verify-uvw` |
| B | `core` 和 `admin` 中不需要运行时的工具全部可用，与 `uvw` 输出一致 | A | `apps/mcp` |
| C | `client-core` 支持多用户宿主，CLI 行为不变 | A | `packages/client-core` |
| D | 执行层上线：`execute`、`inspect`、导入导出、Markdown、Typst、SVG、HTML View | B、C | `apps/mcp`、`packages/client-core` |
| E | 渲染服务：`screenshot`、`print_pdf`、`lint` | D | `apps/mcp`、`packages/client-core` |
| F | Workspace 支持 MCP 标准的 OAuth 和 PAT；MCP 去掉开发用认证 | A | `apps/workspace`、`apps/mcp` |
| G | 执行层多租户安全设计、实现与独立评审 | D、E、F | `apps/mcp`，可能涉及上游 Univer CLI SDK |
| H | SaaS 部署、限流、设置页、真实客户端验收 | G | Helm 私有仓库、`apps/workspace/web`、`apps/mcp` |
| I | Workspace 活动统计区分 MCP 与 CLI | H | `apps/workspace` |

B、C、F 可以在 A 之后并行推进。G 是对外开放前的硬门禁：G 没有通过，MCP 只能在本地原型和内部单用户环境运行。

## 6. 文档索引

| 文档 | 内容 | 什么时候读 |
| --- | --- | --- |
| [架构](architecture.zh-CN.md) | 组件划分、部署拓扑、本机组件的去向、认证、存储、统计、`client-core` 改造 | 开始任何阶段之前 |
| [工具规格](tools.zh-CN.md) | 工具映射、命名与输出约定、差异、结果大小、文件进出、长任务 | 阶段 B、D、E |
| [阶段计划](stages.zh-CN.md) | 每个阶段的交付物、验收标准、不做什么 | 每个阶段开始时 |
| [本地验证环境](local-verification.zh-CN.md) | Docker 原型和 `verify-uvw` 扩展的规格。由阶段 A 的实施者在动手前编写，范围见阶段计划的阶段 A | 阶段 A，以及每次验收 |

## 7. 术语

| 术语 | 含义 |
| --- | --- |
| 网关 | MCP Server 的前端进程。负责 MCP 协议、认证、纯 HTTP 工具、文件进出、用量记录。无状态 |
| 执行层 | MCP Server 的执行进程。托管 headless Univer 子进程，取代 CLI 的 daemon。有可丢弃的热缓存 |
| 渲染服务 | 托管 Chromium 的进程，只接收已经组装好的渲染数据 |
| worker | 执行层里一个承载单个 Unit 的子进程，来自 `@univer-cli/univer-collaboration-runtime-pool` |
| toolset | 一组工具。客户端通过 URL 参数选择启用哪些 toolset |
| 下游凭据 | MCP 以用户身份调用 Workspace 时使用的凭据，与用户交给 MCP 的 token 不是同一个 |
| 暂存存储 | MCP 存放上传文件和导出结果的临时文件存储，有 TTL，不是产品数据 |

## 8. 仍需在实施中确认的事项

以下事项不影响开工，在对应阶段内由实施者通过实验确定，并把结论补回本文档：

| 事项 | 阶段 | 确认方式 |
| --- | --- | --- |
| 单个 worker 的冷启动时间、常驻内存、单节点可承载数量 | A、D | 在 `verify-uvw` 里测量，记录到架构文档 |
| Docker Desktop 下容器访问宿主 `127.0.0.1` 上 Workspace 的方式 | A | 实测后写入 `local-verification.zh-CN.md` |
| 各 MCP 客户端的工具数量上限、结果大小上限、超时 | B、H | 在真实客户端里实测 |
| Workspace Server 在持续 agent 写入下的 OT 延迟和可承受速率 | D | 压测 |
| Univer、原生绑定、Chromium 在 gVisor 下的兼容性 | G | 实测 |
| 大文件 Office 导入的提交通道 | D | 与 Workspace 维护者确定方案（见架构文档 7.3 节） |
| 执行层多租户安全设计 | G | 指定一名设计者和一名独立评审者。设计要满足架构文档第 10 节的七条要求 |
