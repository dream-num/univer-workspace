# 架构

> 本文描述目标架构，以及每个阶段落地到哪一步。代码事实附路径，路径相对仓库根目录。
> 决策编号（D1 到 D13）见 [README](README.zh-CN.md)。

## 1. 组件总览

```text
              ChatGPT / Claude / Cursor / VS Code / WorkBuddy
                          │  MCP Streamable HTTP，Bearer token
                          ▼
        https://space.univer.ai/mcp   （ingress 按路径转发）
                          │
┌─────────────────────────▼──────────────────────────┐
│ 网关（gateway）  无状态，可多副本                      │
│  · MCP 协议（2025-11-25 与 2026-07-28 两版）          │
│  · 认证：校验用户 token，换取下游凭据                  │
│  · 纯 HTTP 工具：repo、issue、label、pr、search、      │
│    space、unit、blob、asset                         │
│  · 参考类工具：api、skills、resources（进程内库）      │
│  · 文件进出：上传会话、签名下载                        │
│  · 用量事件、指标、限流                               │
└───────┬─────────────────────────────┬──────────────┘
        │ 内部 RPC                     │ 内部 RPC
┌───────▼──────────────────┐   ┌──────▼─────────────┐
│ 执行层（executor）         │   │ 渲染服务（renderer）│
│  · headless Univer 子进程池 │──▶│  · Chromium 常驻池  │
│  · execute、inspect、导出   │   │  · 截图、PDF、lint  │
│  · Office、Markdown、      │   │  · 不访问 Workspace │
│    Typst、SVG、HTML View   │   └────────────────────┘
└───────┬──────────────────┘
        │ HTTP 与协同 WebSocket，以用户身份
        ▼
Workspace Server（独立部署，单副本，身份、ACL、协同、存储的唯一权威）
```

三种角色来自同一个应用 `apps/mcp`、同一个镜像，通过环境变量 `MCP_ROLE=gateway|executor|renderer` 选择入口。
三者各自独立部署和扩缩容（D11）。

MCP Server 不连接任何数据库（D12）。它保存的状态只有三类，全部可以丢弃：

- 网关内存里的下游凭据缓存。
- 执行层的 worker 热缓存。
- 暂存存储里带 TTL 的上传文件和导出结果。

## 2. `uvw` 的本机组件去哪里

### 2.1 `uvw` 在本机做了什么

| 本机组件 | 职责 | 代码位置 |
| --- | --- | --- |
| CLI 进程 | 命令解析；纯 HTTP 命令；Office 转换；Markdown、Typst、SVG 编译；启动 Chromium；Blob 和 Asset 传输 | `apps/cli/src/program.ts`、`apps/cli/src/product-commands.ts` |
| daemon | 长驻进程，经 unix socket 只提供三个 RPC：`runtime.execute-read`、`runtime.export-unit-data`、`runtime.execute-and-commit`。不会因空闲退出 | `apps/cli/src/runtime/daemon.ts:15-45` |
| 运行时池 | 按 key 缓存的子进程池，每个 Unit 一个子进程。空闲 5 分钟回收，持续使用的不回收。最多 20 个。打开和操作各 30 秒超时。满了报 `COLLABORATION_POOL_CAPACITY_EXCEEDED`，跨 key 不排队 | `@univer-cli/univer-collaboration-runtime-pool`、`@univer-cli/generic-keyed-instance-pool`（默认值从发布包解码） |
| worker 子进程 | headless Univer 加协同客户端。保持协同 WebSocket。每次操作先 pull 并检查修订号，再执行脚本，最后提交 changeset，冲突最多重试 3 次 | `packages/client-core/src/content-worker.ts`、`packages/client-core/src/content-runtime.ts:105-305` |
| Markdown 创建 | 执行层现有作业子进程 | 标准 headless factory 导入 Rust formula engine。编译保留在 executor，创建时在 job child 中物化；块更新使用绑定的 `executeAndCommit`，回读使用 `executeRead` 和认证 Asset 请求 |
| Chromium | 每次截图、PDF、lint 冷启动一次 | `packages/client-core/src/screenshot.ts`、`print-pdf.ts`、`layout-lint.ts`；`@univer-cli/univer-render-runtime` |
| 本地磁盘 | session、配置、daemon socket、资源缓存、浏览器缓存、输入输出路径 | `apps/cli/src/config.ts:46-77` |

### 2.2 去向

| 本机组件 | 云端去向 | 变化 |
| --- | --- | --- |
| CLI 命令解析与输出 | 网关的工具分发 | 工具 schema 取代 Commander 参数，`structuredContent` 取代 `--json` 输出 |
| 纯 HTTP 命令 | 网关进程内直接调用 `client-core/product` | 与 CLI 共用同一套 feature 代码 |
| daemon 与 unix socket | 删除 | 网关通过内部 RPC 调用执行层，执行层直接实现那三个操作 |
| 运行时池与 worker | 执行层 | key 加入用户身份；跨 key 排队；参数可配置；见第 6 节 |
| CLI 进程内的 Office、Markdown、Typst、SVG 处理 | 执行层及现有作业子进程 | Office 转换、Typst 编译与文档物化加载原生绑定，在 job child 中运行。SVG 编译保留在 executor：estimateTextSize 时只运行 JavaScript 编译与内置量字；默认实字体量度时由 executor 注入的 runtime 逐行调用渲染服务的 measureText，executor 自身不启动浏览器；apply 使用绑定 runtime |
| Chromium | 渲染服务 | 目标是常驻浏览器池加每任务一个 BrowserContext；阶段 E 实际是复用的 runtime 池，见 7.1 节 |
| session 文件 | 不存在 | 下游凭据由网关按请求换取，见第 4 节 |
| `--file` 输入、`--out` 输出 | 暂存存储加签名 URL | 见第 5 节和[工具规格](tools.zh-CN.md) |
| 资源缓存、Chromium 二进制、render-runtime 页面 | 打进镜像，只读共享 | 不区分用户 |
| `@univer-cli/api-reference`（约 7.3 MB） | 网关进程内加载 | 作为库复用 |
| `apps/cli/skill-data`（约 260 KB） | 网关的工具和 MCP resource | 构建时从 `apps/cli/skill-data` 复制。readCommand 改写为工具调用 |
| CLI 的 license 解析 | 各角色由环境变量注入 | 宿主注入机制已经存在（`apps/cli/src/runtime/daemon.ts:21`、`apps/cli/src/program.ts:126`）。license 没有授权限制（D7） |

## 3. 部署拓扑

### 3.1 为什么和 Workspace Server 分开部署

Workspace Server 的现状：

- 单个 Node 进程承载 HTTP API、协同 OT、WebSocket、快照物化 worker pool、Office 交换和后台任务（`apps/workspace/server/src/main.ts:11-42`、`app.ts`）。
- 存储是本地 SQLite（WAL）和本地磁盘 BlobStore，挂在一个 Docker 卷上（`apps/workspace/Dockerfile:67`）。
- 新旧版本不能同时写同一个 SQLite。升级说明要求单副本、`Recreate` 策略（`apps/workspace/README.md:419-447`）。
- OAuth 授权码、CLI 待批准登录、导出任务、WebSocket 票据都只存在进程内存（`app.ts:372`、`modules/identity/identity.service.ts:193-194`、`modules/exchange/exchange.service.ts:148-150`）。

分开部署的理由：

1. **扩缩容。** Workspace Server 不能多副本。MCP 的执行负载随用户量增长，必须能独立扩容（D11）。
2. **资源隔离。** 每个 worker 启动约 1 秒（`apps/workspace/server/src/integrations/univer/unit-store.ts` 的注释），内存未测。同进程或同容器会与 OT、物化、导出争抢资源。
3. **发布隔离。** Workspace 的发布伴随数据库迁移，MCP 不应该随之中断，也不应该被它的节奏拖住。
4. **数据隔离。** 执行模型生成代码的进程，不能挂载存放全部产品数据的卷（D4、D12）。

### 3.2 SaaS 拓扑

| 部署单元 | 副本 | 运行时 | 对外暴露 | 说明 |
| --- | --- | --- | --- | --- |
| `colla-workspace`（现有） | 1 | 普通 | `space.univer.ai` 的其余路径 | 不变 |
| `colla-workspace-mcp-gateway` | 2 起，按 CPU 扩容 | 普通 | `space.univer.ai/mcp`、`/.well-known/oauth-protected-resource/mcp` | 无状态 |
| `colla-workspace-mcp-executor` | 按内存扩容 | gVisor（阶段 G 确认） | 不暴露，只接受网关的内部请求 | 有可丢弃的热缓存 |
| `colla-workspace-mcp-renderer` | 按任务队列扩容 | 沙箱运行时（阶段 G 确认） | 不暴露 | 不访问 Workspace |

- 三个 MCP 角色是三个 Deployment。Kubernetes 的 `runtimeClassName` 只能按 Pod 设置，执行层和渲染服务的沙箱运行时不能和网关共用一个 Pod。
- 镜像沿用 `.github/workflows/push.yml` 的构建与 dispatch 流程，在 `dream-num/helm-chart-private` 中新增 release。部署区域与对应的 Workspace 实例一致。
- 网关调用 Workspace 时走集群内部地址，对用户展示的链接用公网地址。这需要 `client-core` 区分两个地址，见 9.1 节。
- 发布顺序：先 Workspace Server，后 MCP。MCP 与 Workspace 使用同一个源码 tag 和同一个 SDK baseline。网关启动时读取 Workspace 版本，低于要求时拒绝就绪。

### 3.3 MCP 会给 Workspace Server 带来的压力

MCP 可以水平扩展，但每次编辑最终都落到单副本的 Workspace Server 上，包括 OT 应用、快照物化和导出。
网关需要按用户限制并发执行数和每分钟写入次数，并限制执行层协同连接总数。

2026-11-08 的本地 Docker Desktop 基线使用第 6.2 节的环境。一个用户在同一 Worktree 的不同 Sheet 上连续执行单格写入。每次调用确认一个 revision，写入不同单元格，结束后逐格 `inspect` 读回。Sheet 在计时前扩至 100000 行，仅填入实际写入的稀疏单元格。每个并发档跑 5 轮，每轮发起写入 30 秒；速率分母包含最后在途请求完成的时间。客户端耗时包含 MCP 连接、调用和关闭。

| 并发 writer / Unit 数 | 5 轮确认写入 / 读回数 | 写入/s 中位数、范围 | 写入/min 中位数、范围 | 全部调用 p50 / p95（ms） | 错误数 |
| --- | --- | --- | --- | --- | --- |
| 1 | 3314 / 3314 | 22.71，19.52 至 23.04 | 1362.6，1171.2 至 1382.2 | 42.0 / 74.8 | 0 |
| 2 | 6880 / 6880 | 46.24，44.19 至 46.74 | 2774.1，2651.6 至 2804.6 | 41.5 / 60.0 | 0 |
| 4 | 11970 / 11970 | 82.24，66.46 至 84.33 | 4934.2，3987.3 至 5060.0 | 43.6 / 88.9 | 0 |
| 8 | 12784 / 12784 | 87.76，69.89 至 91.93 | 5265.7，4193.5 至 5515.8 | 85.8 / 152.6 | 0 |
| 16 | 11164 / 11164 | 76.05，58.00 至 79.80 | 4562.7，3479.9 至 4788.1 | 196.5 / 369.3 | 0 |

上述 p50、p95 的样本数等于各档确认写入数，均无失败调用。Workspace Server CPU 按各轮进程 CPU 时间差除以采样墙钟时间计算，再列出 5 轮中位数与范围。executor 与 gateway CPU 来自五轮内 `docker stats` 的全部观测值；100% 相当于一个逻辑核。Server RSS 采样受计时前扩行的残留分配及后续回收影响，不作为持续写入的稳态内存列出。

| 并发 writer | Server CPU 中位数、范围（%） | executor CPU 中位数、范围（%） | gateway CPU 中位数、范围（%） | 每容器 CPU 观测数 |
| --- | --- | --- | --- | --- |
| 1 | 25.0，22.2 至 30.3 | 88.2，9.2 至 161.0 | 18.3，7.2 至 67.1 | 56 |
| 2 | 36.0，34.1 至 37.3 | 173.7，10.2 至 240.4 | 23.7，4.1 至 84.0 | 54 |
| 4 | 62.4，55.8 至 65.3 | 337.6，9.3 至 410.4 | 37.9，7.9 至 96.0 | 54 |
| 8 | 82.2，66.7 至 84.3 | 439.8，308.0 至 522.5 | 51.4，31.3 至 94.1 | 50 |
| 16 | 91.2，78.8 至 91.9 | 463.8，39.6 至 527.6 | 55.1，15.6 至 138.1 | 50 |

同一用户的 8 个 writer 写同一 Unit 另跑 5 轮，每轮 30 秒。共确认并读回 3417 次写入，错误数 0。速率中位数 22.63/s，范围 21.16 至 24.50/s；每分钟中位数 1357.9，范围 1269.6 至 1469.9。3417 次调用的 p50/p95 为 360.2/445.9 ms，范围 69.5 至 813.2 ms。Server CPU 五轮中位数 30.3%，范围 28.1 至 32.5%。该场景受同一 user、scope、Unit 的 FIFO 串行约束，吞吐接近单 writer，排队增加调用耗时。

4、8、16 writer 的速率区间重叠。现有数据没有证明增加到 8 或 16 可提高吞吐上限；各档按顺序运行、未交错，后期背景负载漂移也影响这一比较，实际 preflight load 见第 6.2 节。8 writer 时 executor 与 gateway 的 CPU 中位数之和约为 `439.8% + 51.4% = 491.2%`，相当于共享 VM 的 6 vCPU 中约 4.9 个，是已测资源中最接近饱和的预算。因此共享 VM CPU 是瓶颈的首要候选。这是两个中位数之和，不是同时采样总 CPU 的中位数；最大容量与瓶颈的唯一归因仍未定论，尚缺主线程、磁盘等待和 Docker VM 调度的分解。压测还同时改变 Worktree 内 Unit 数量，不能把结果直接视为 Workspace Server 的独立极限。

单独的 8-writer、10 秒计数器剖析不纳入吞吐表。该次运行确认并读回 822 个 revision，错误数 0。Server 与造压进程各一个 CPU 时间窗口分别为 78.8%、20.0%；4 个容器观测中，executor CPU 中位数 442.1%，范围 127.8% 至 513.2%，gateway 中位数 66.0%，范围 8.7% 至 69.7%。100% 表示一个逻辑核。执行侧已有较高 CPU 消耗，造压进程未占满一个核；这些计数器仍不足以区分 Server、VM 调度、目录解析与存储等待的主导比例。

另有一次完整运行在 2-worker 准备阶段遇到 `workspace-result-unknown` 网络错误。它未进入持续写入计时，未计入上表；相同 Unit 的独立重读成功，完整复跑的该阶段通过。原始失败与成功事件均保留，网络根因未定论。

阶段 H 建议先采用每用户 **2 个并发执行、240 次写请求/分钟**。2 个并发是为多用户聚合负载保留余量的策略选择，不是数据选出的最优值；2 和 4 writer 的五轮运行均无错误。240 来自最慢单 writer 的 `19.5205 × 60 × 25% = 292.8`，再向下取整到每分钟 60 的倍数。25% 是起步余量假设，不是测得的最优值。按每用户持续用满 240 次/分钟计算，约 `5265.7 / 240 ≈ 21.9`，即 22 个用户就会接近本地 8-writer 节点的吞吐中位数。这里只做总量算术，未验证 22 个用户的并发执行与常驻 worker 成本，不能当作支持用户数。

这些建议以一次提交一个 revision 的小 `execute` 为单位。复杂 Unit、单次大脚本、Office 转换、多用户总量及生产沙箱开销未覆盖。单用户限额不能代替全节点容量控制。阶段 H 必须在生产硬件与最终隔离配置上重测并校准默认值。

## 4. 认证

### 4.1 现状

- Workspace 已有授权码加 PKCE 的 OAuth 流程（`apps/workspace/server/src/modules/identity/oauth-authorization-router.ts`），`apps/agent` 用它登录。
- 客户端是 `OAUTH_CLIENTS_JSON` 里的静态配置，回调地址精确匹配（`apps/workspace/server/src/config.ts:133-182`）。
- 只支持 `grant_type=authorization_code`。`state` 必须符合 `^[A-Za-z0-9_-]{32,256}$`。授权码 60 秒有效，存在内存里。
- token 端点返回的 `access_token` 是 7 天有效的登录 session，由 `issueSession(user, "agent")` 签发，调用方必须以 `workspace_session` cookie 发送（`oauth-authorization-router.ts:152-166`）。`issueSession` 不接受自定义有效期。
- 产品 API 和协同端点只认 cookie，不认 `Authorization: Bearer`。服务端没有 Origin 或 CSRF 检查，也没有通用限流。
- 没有授权服务器元数据、受保护资源元数据、动态注册、refresh token。
- `login_sessions` 表只有 `id`、`secret_hash`、`user_id`、`created_at`、`expires_at`、`write_source`（`apps/workspace/server/src/db/schema.sql:36-44`），没有 scope。

### 4.2 目标模型

```text
MCP 客户端 ──OAuth（授权码 + PKCE，resource=…/mcp）──▶ Workspace 授权服务器
     │  access token：受众是 MCP，带 scope，1 小时；附 refresh token
     │  或：PAT（D9）
     ▼
网关 ──token exchange──▶ Workspace
     │  下游凭据：同一用户、短时效的登录 session，以 cookie 发送
     │  网关按 scope 决定是否允许本次工具调用
     ▼
Workspace 产品 API 与协同端点
```

要点：

- **不透传。** 用户交给 MCP 的 token 不直接发给 Workspace 产品 API。这是 MCP 安全规范的要求。
- **token exchange 兼作校验。** 网关把收到的 access token 或 PAT 作为 `subject_token` 提交给 Workspace，换回下游凭据。换取失败即视为认证失败。
  网关按 token 摘要缓存换取结果，最长 30 秒且不超过下游凭据的有效期，避免每次调用都换取。
  token 吊销时它派生的下游凭据一并失效，所以访问 Workspace 的下一次调用返回 401 并清除缓存；
  不访问 Workspace 的调用（例如 `whoami`、`api_find`）在缓存剩余时间内仍会成功。这个最长 30 秒的窗口是
  产品负责人在 2026-11-09 接受的取舍：这类调用不读写用户的 Workspace 数据。
- **scope 由网关执行。** 下游凭据仍是普通登录 session，带用户的全部权限。网关在调用工具前检查 scope。
  Workspace 产品 API 第一阶段不需要逐路由识别 scope。执行层如何持有和使用下游凭据，由阶段 G 的安全设计最终确定。
- **认证失败的表现。** 网关返回 HTTP 401 和 `WWW-Authenticate`（带 `resource_metadata`），让客户端重新走 OAuth。这对应 CLI 的退出码 4。

### 4.3 scope

| scope | 允许 | 对应工具 |
| --- | --- | --- |
| `read` | 所有只读工具 | `whoami`、`*_list`、`*_view`、`inspect`、`export`、`screenshot` 等 |
| `write` | Worktree 内的写入，以及 Issue、Label 写入 | `pr_create`、`unit_*`、`execute`、`import`、`issue_*` 等 |
| `publish` | 不经 Worktree 的直接写入 | `blob_upload`、`blob_replace`、`html_view_create`、`space_node`、`repo_create`、`repo_edit` |
| `worktree:merge` | 合并和丢弃 Worktree | `pr_merge`、`pr_discard` |

同意页逐项列出 scope，默认全部勾选，用户可以取消。PAT 默认授予全部 scope（D9）。
现有的 `identity` 和 `session` scope 保留给现有客户端，语义不变。

### 4.4 Workspace Server 需要的改动（阶段 F）

| # | 改动 | 说明 |
| --- | --- | --- |
| F1 | `GET /.well-known/oauth-authorization-server`（RFC 8414） | 声明 `client_id_metadata_document_supported: true`（`MCP_CIMD_ENABLED=0` 时不声明）、`authorization_response_iss_parameter_supported: true`，`token_endpoint_auth_methods_supported` 含 `none`，`code_challenge_methods_supported` 含 `S256`。MCP 客户端的每个授权响应都带 `iss`（RFC 9207） |
| F2 | Client ID Metadata Documents | `client_id` 可以是 https URL。已登录用户授权时拉取并校验该文档，回调规则与 DCR 相同，不写产品库。抓取器防 SSRF：拒绝特殊用途地址、不跟随重定向、5 KB、5 秒、每用户 1 个并发、全局 32 个。Claude Code、VS Code、opencode 在 F1 声明支持时走这条路。设计与评审见 [cimd.zh-CN.md](cimd.zh-CN.md) |
| F3 | 动态客户端注册 `POST /api/auth/register`（RFC 7591） | 兼容仍依赖 DCR 的客户端（Cursor、Copilot）。注册结果需要持久化，属于 Workspace 产品数据。回调地址限于 loopback `http`、`https`、反向域名私有 scheme，以及白名单里的私有 scheme（目前只有 Cursor 用的 `cursor`，2026-11-09 产品决定） |
| F4 | `resource` 参数（RFC 8707） | 签发的 token 绑定受众，只对 MCP 有效 |
| F5 | MCP 用的 access token 与 refresh token | 新的 token 类型，哈希后存入 Workspace 产品库，可吊销。refresh token 轮换。access token 1 小时，refresh token 30 天（可调） |
| F6 | 新 scope 与同意页 | 见 4.3 节。现有客户端的同意页不变 |
| F7 | `state` 校验 | 对新类型的客户端按 OAuth 规范放宽，现有客户端的规则不变。需要先确认各 MCP 客户端实际发送的 `state` 格式 |
| F8 | token exchange（RFC 8693） | `grant_type=urn:ietf:params:oauth:grant-type:token-exchange`。只对机密客户端 `univer-workspace-mcp-gateway` 开放。输入 access token 或 PAT，输出下游凭据和用户信息 |
| F9 | 短时效登录 session | `issueSession` 增加可选的有效期参数，默认值等于现在的 `SESSION_TTL_MS`，现有调用不变。下游凭据使用 10 分钟（可调） |
| F10 | PAT | 产品库新表，字段建议：`id`、`user_id`、`name`、`token_hash`、`scopes`、`created_at`、`expires_at`（可空）、`last_used_at`、`revoked_at`。接口：列出、创建（明文只返回一次）、吊销。默认全部 scope，默认不过期（D9） |
| F11 | Browser 设置页 | “连接到 AI 助手”（见阶段 H）与 PAT 管理 |

F3、F5、F10 涉及 schema 改动，遵守 `apps/workspace/AGENTS.md`，运行 `verify-db-migration`。所有接口变更同步到 `apps/workspace/contracts/http` 并运行 `api:verify`。

### 4.5 MCP 网关需要的认证能力

- `GET /.well-known/oauth-protected-resource/mcp`（RFC 9728），指向 Workspace 授权服务器。
- 未认证或 token 失效时返回 401 和 `WWW-Authenticate: Bearer resource_metadata="…"`。
- 网关作为机密客户端 `univer-workspace-mcp-gateway` 调用 token exchange，凭据由环境变量注入。

### 4.6 原型期的开发认证（阶段 A 到 E）

为了不让 MCP 的原型等待阶段 F，网关提供一个开发认证模式：

- 开启条件：环境变量 `MCP_DEV_SESSION_PASSTHROUGH=1`。`NODE_ENV=production` 时如果设置了它，网关拒绝启动。
- 行为：把 `Authorization: Bearer <value>` 中的值当作 Workspace 登录 session，直接作为下游凭据使用。
- 来源：`verify-uvw user` 登录后，session 保存在本次运行的 `UNIVER_HOME` 中。`verify-uvw` 的 MCP 命令从那里读取并带上，规格见阶段 A 编写的 `local-verification.zh-CN.md`。
- 阶段 F 完成后，这个模式只保留在本地验证里，SaaS 部署的配置中不得出现。

## 5. 存储

### 5.1 暂存存储

MCP 不连数据库（D12），但需要临时存放上传文件和导出结果。按 D8，做法与 Workspace 的 BlobStore 一致：

- 一个 `StagingStore` 接口，加一个本地文件系统实现。参照 `apps/workspace/server/src/app.ts:241-245` 的 `LocalBlobStore` 用法。
- 目录由 `MCP_STAGING_DIRECTORY` 指定。本地验证用本次运行目录下的子目录。SaaS 挂载一个所有网关副本共享的卷。
- 每个对象带所有者（用户 ID）、用途、大小、媒体类型和过期时间。元数据以 sidecar 文件保存在同一目录，不使用数据库。
- sidecar 保存 `id`、`kind`、`owner`、`purpose`、`fileName`、`mediaType`、`size`、`maxBytes`、`sha256`、`state`、`createdAt`、`expiresAt` 和 `tokenHash`，通过临时文件加 rename 原子写入。目录必须为当前 uid 所有的 0700 私有目录，文件 0600。上传声明的 `size` 可省略，表示大小上限；有效上限为声明值与用途上限的较小值。PUT 的 Content-Length 可省略（允许 chunked），提供时不得超过有效上限。流式计数同样受此上限约束，成功后 `size` 和 `sha256` 记录实际字节，pending 变为 ready，拒绝第二次 PUT。
- 每用户暂存字节（上传、下载与进行中的流之和）默认上限 2 GiB，`MCP_STAGING_USER_MAX_BYTES` 可配置；pending 上传默认最多 20 个，`MCP_STAGING_USER_MAX_PENDING_UPLOADS` 可配置。工具超额报 `workspace-staging-quota-exceeded`，PUT 超额返回 429。计数在每个副本内维护，启动及每分钟扫描刷新每个有效 sidecar 的 state、size 与 expiry。本副本正在持锁的对象保留流中的计数；其他副本的并发 reservation 与流中字节在下次扫描前仍是近似值，共享卷上的严格总配额仍需协调。
- 后台在启动和每分钟清理过期对象，参照 `apps/workspace/server/src/jobs/blob-maintenance.ts`。上传对象 1 小时过期，导出结果 15 分钟过期。损坏 sidecar 按 mtime 超过上传 TTL 后连同 data 删除，并只记录一次带对象 ID、无路径、无 token 的错误；不可读条目隔离并记录对象 ID，不终止启动或扫描。文件消失的竞争可忽略。清理跳过不足 2 小时的锁，避免清理跨过过期点的消费；锁写入随机 ownership token，释放只删除 token 仍匹配的锁，保留后继者的锁；超过 2 小时的孤立空锁也清理。释放已消失的锁不改变消费成功结果。
- 执行层和渲染服务不直接访问暂存存储。网关读出文件交给它们，或从它们那里收回结果再写入。

### 5.2 网关的文件端点

| 端点 | 用途 |
| --- | --- |
| `PUT /mcp/files/uploads/{uploadId}` | 用签名 URL 上传。校验签名、大小上限、所有者 |
| `GET /mcp/files/uploads/{uploadId}/page` | 浏览器上传页，给不能自己执行 PUT 的客户端（claude.ai、ChatGPT 对话） |
| `GET /mcp/files/downloads/{downloadId}` | 用签名 URL 下载 |

先用 `new URL(request.url ?? "/", publicUrl).pathname` 统一 WHATWG 路径归一化，再选择文件端点或 MCP adapter，处理端复用同一路径。文件端点处理原始 Node 字节流，不做 UTF-8 解码；归一化后属于 MCP 的请求仍受 4 MiB JSON 上限限制。Node `requestTimeout` 为 30 分钟，显式设置 `headersTimeout` 为 60 秒。`MCP_MAX_CONNECTIONS` 配置每副本连接上限，默认 1024。文件端点提前响应未完成的请求体时发送 `Connection: close`，响应结束后销毁请求，避免慢速请求体长期占用连接。

这些端点与 Workspace 同域。下载一律带 `Content-Disposition: attachment`、`X-Content-Type-Options: nosniff` 和 `Content-Security-Policy: sandbox; default-src 'none'`，
上传页不渲染任何用户内容；413 明示文件太大。下载结果保留原 Node 名，attachment 文件名替换路径分隔符与控制字符，并截为 180 字符。Asset 文件名根据媒体类型添加扩展名。下载同时带 `Cache-Control: private, no-store`。文件端点保留 Host 检查，使用 256-bit 随机 capability token，sidecar 只存 SHA-256，常量时间比较；链接持有者可访问，无需 bearer。工具消费上传仍验证 owner、purpose 和 ready。做法参照 `apps/workspace/server/src/modules/univer-assets/univer-assets.router.ts:147-152`。
导出的 HTML、SVG、Markdown 可能包含任意内容，不能在 Workspace 的同源下以内联方式打开。

## 6. 执行层

### 6.1 职责

- 内部 RPC 暴露命名领域操作（首批为 `content.execute`、`content.inspect`、`diagnostics.probe`），内部组合 `executeAndCommit`、`executeRead`、`exportUnitData`，复用 `packages/client-core/src/content-runtime.ts`。
- 执行需要 headless Univer 的作业：Office 导入导出、Markdown 编译与回读、Typst 编译、SVG 编译、HTML View 校验、渲染数据组装。
- HTML View 的 `htmlView.validate` 和 `htmlView.create` 在执行层组合 Client Core；使用绑定调用者的 runtime 导出 trunk Sheets。创建在同一写操作内上传校验时复制的字节，保证内容一致；Blob 幂等恢复由既有上传 workflow 负责。HTML 输入上限 512 KiB UTF-8，RPC frame 上限 4 MiB，预算 30 秒。成功创建的 transfer 字节在 gateway 计入，未加载 worker 时保留 `executor: none` 且 worker 成本为零。
- 对网关暴露内部 RPC。不对外暴露端口。

### 6.2 worker 池

| 参数 | CLI 默认 | 执行层 | 说明 |
| --- | --- | --- | --- |
| key | `workspace:<origin>:<scope>:<unitId>:<unitType>` | 通过必填 `caller.userId` 加入用户 ID | Client Core 已支持调用者隔离；executor 在一次请求的全部 runtime 调用中绑定同一调用者 |
| 最大 worker 数 | 20 | `EXECUTOR_MAX_WORKERS`，默认 4 | 本地空白 Sheet 常驻基线与内存预算见下表；默认 4 保持不变 |
| 空闲回收 | 5 分钟 | `EXECUTOR_IDLE_TTL_MS`，默认 60 秒 | 空闲 worker 仍保持协同连接，应尽快释放 |
| 跨 key 排队 | 没有，直接报错 | 排队，`EXECUTOR_QUEUE_TIMEOUT_MS` 后返回可重试错误 | 默认 5 秒 |
| 打开与操作超时 | 30 秒 | `EXECUTOR_OPERATION_TIMEOUT_MS`，默认 25 秒 | 留出余量，保证网关能在 30 秒同步预算内返回 |
| 子进程环境变量 | 继承父进程 | 显式传入 `{ NODE_ENV: "production" }` | Client Core 转交 `pool.env`；executor 不让子进程继承内部 token、OAuth secret 或 license key |

2026-11-08 本地 Docker Desktop 基线。宿主为 M2 Pro、10 逻辑 CPU、32 GiB 内存；Docker 报告 6 vCPU、11.68 GiB 内存，gateway 与 executor 共享。SDK 为 1.4.0。Workspace Server 运行 tsx 源码，gateway 与 executor 使用构建镜像和开发认证，worker 使用 production 环境。不是生产硬件容量结论，阶段 H 须在最终沙箱与生产硬件上重测。

测量时设置 `EXECUTOR_MAX_WORKERS=16`、`EXECUTOR_IDLE_TTL_MS=300000`，不修改产品默认值。每轮开始前要求没有其他 verify 栈，宿主一分钟 load 不超过 5。实际持续写入轮次的 preflight 一分钟 load 为 3.9 至 5.0，五分钟 load 最高 7.4；这里的 quiet 仅指通过该阈值，不表示没有背景工作。并发档按 1、2、4、8、16 顺序运行，再跑同 Unit 场景，没有交错，后期背景负载漂移落在后面的档位。因此第 3.3 节的 4、8、16 速率区间重叠结论受该顺序与负载变化限制。

复跑命令与 JSON 字段见[容量测量流程](../../../.agents/skills/verify-uvw/features/mcp.md#executor-capacity-benchmark)。[汇总脚本](../../../.agents/skills/verify-uvw/bin/mcp-bench-summary.py)保留 Python 统计实现；从仓库根目录运行 `python3 .agents/skills/verify-uvw/bin/mcp-bench-summary.py <bench.json> --markdown`，可从完整运行的原始 JSON 重现第 3.3、6.2 节的五张测量与内存预算表。省略 `--markdown` 则输出含样本数和原始精度统计值的汇总 JSON。内存预算表中的余量、子进程预留与保守建议仍是策略假设。

| 场景 | 次数 | 网关耗时中位数、范围、p95（ms） | `worker_cpu_ms` 中位数、范围（ms） | 错误数 |
| --- | --- | --- | --- | --- |
| 冷 worker `inspect`，每次使用新 Unit | 10 | 1501.9，1462.6 至 2031.6；不足 20 次不报 p95 | 23.7，7.5 至 30.7 | 0 |
| 热 worker `inspect` | 50 | 14.4，8.7 至 30.5；p95 25.7 | 3.2，2.2 至 10.4 | 0 |
| 热 worker 小 `execute` | 50 | 14.7，12.2 至 88.4；p95 22.3 | 8.4，6.9 至 77.9 | 0 |

冷调用均有 `executor: cold_start` 事件，热调用均有 `warm` 事件；50 次写入全部读回。`worker_cpu_ms` 是取得 lease 后的调用墙钟时间，排队与冷打开在计时之前，不能用它代替冷启动耗时或 CPU 消耗。表中网关冷调用包含目标解析、worker 打开与执行。冷打开的 CPU 热点尚未单独采样，瓶颈未定论。

下表为容器内 `/proc/<pid>/status` 的常驻 RSS。每档重启 executor，在不同空白 Sheet 上打开 worker，等待 3 秒，再取 5 个快照。错误数均为 0；每个快照都验证存活 worker 数。

| 热 worker 数 | 快照数 / worker RSS 观测数 | 单 worker RSS 中位数、范围（MiB） | 父进程 RSS 中位数、范围（MiB） |
| --- | --- | --- | --- |
| 1 | 5 / 5 | 244.2，244.2 至 244.2 | 416.8，416.7 至 416.8 |
| 2 | 5 / 10 | 243.7，243.6 至 243.8 | 387.0，387.0 至 387.0 |
| 4 | 5 / 20 | 253.0，246.1 至 309.9 | 386.1，386.1 至 386.1 |
| 8 | 5 / 40 | 242.1，236.0 至 280.9 | 390.6，390.6 至 390.7 |

这是空白 Sheet 的内存基线，不是 5 次独立启动。按所有样本最大值向上取整，单 worker 取 310 MiB、父进程取 417 MiB。先留 25% 总内存余量，再为两个转换子进程合计预留 1024 MiB。子进程预留是预算假设，包含默认两个 256 MiB JS heap 及额外原生分配余量，尚未测得 Office 原生内存峰值。

| executor 容器预算 | worker 可用内存计算（MiB） | 内存估算上限 | 保守建议 |
| --- | --- | --- | --- |
| 4 GiB | `4096 × 0.75 - 417 - 1024 = 1631` | `floor(1631 / 310) = 5` | 4 个，保留当前默认值 |
| 8 GiB | `8192 × 0.75 - 417 - 1024 = 4703` | `floor(4703 / 310) = 15` | 8 个，先采用已采样的常驻数量 |

上述 4 GiB、8 GiB 是内存预算外推，没有对容器施加这两个硬限制。RSS 包含共享页；大 Unit、公式、转换子进程峰值及 CPU 容量仍需另测。此处没有证据要求修改产品默认 4；内存可容纳的常驻数量也不保证等量并发执行能力。

### 6.3 路由与状态

- MCP 2026-07-28 版去掉了 session，客户端也不保证复用连接。热 worker 只能是可丢弃的缓存。
- 每次操作都会先 pull 并检查 `baseRevision === target.revision`（`packages/client-core/src/content-runtime.ts` 的 `synchronize`），所以任意执行层副本都能从 Workspace 重建状态。热缓存只影响速度，不影响正确性。
- 网关按 `(用户 ID, scope, unitId)` 一致性哈希选择执行层副本。副本增减时只损失部分缓存。
- 同一 key 的操作串行，这是现有行为（`runForRuntimeKey` 加池内 FIFO）。
- 操作表声明重试策略；执行层重新解析目标并重试，网关不持有 revision。`content.execute` 对脚本执行前（worker 打开或 pull 阶段，不可能发生在提交之后）的 `workspace-result-mismatch` 与 `workspace-runtime-target-stale` 重试一次；幂等的 `content.inspect` 最多重试三次，每次等待 25 到 100 ms 随机退避。`content.execute`、`content.inspect`、`exchange.export`、`htmlView.validate` 和 `htmlView.create` 对持有不同 session 的热 worker 的 401 重建后重试一次（htmlView 的 401 只可能来自上传前的校验读取）；当前 session 自身被拒绝则返回认证错误（被撤销的 session 在 trunk 协同端点上表现为 403，持有不同 session 的 worker 的 403 同样按 stale 处理）。`content.execute` 与 `content.inspect` 在执行层共用按 user、scope、Unit 分组的 FIFO 队列，读写和纯读取都依次执行，避免同一用户的持续写入与读取争抢 revision。worktree inspect 和 execute 的 route 相同，trunk inspect 使用独立 scope。排队时间计入原 deadline，排队超时返回 `workspace-executor-timeout`（`started: false`）。其他用户、副本或未进入该队列的写入仍可能造成 revision 冲突，由读重试兜底；单靠重试无法保证持续写入下的读取成功。无法重试时（操作未声明 auth、剩余不足 5 秒或已重试过）返回可重试的 `workspace-executor-timeout`（`started: false`），不返回认证错误，客户端保持登录。auth 最多重试一次，revision 读最多三次、写最多一次，且原 deadline 至少剩余 5 秒，读退避后再次检查。commit 阶段的不确定写入不重试。重试的 worker 时间计入同一用量事件，原因记录到日志和 `mcp_executor_reruns_total{reason}`。
- 网关使用 rendezvous hashing。只对连接拒绝、DNS 失败或明确未接收的传输拒绝切换副本；已发送写入的断连或超时返回 `workspace-result-unknown`。

### 6.4 凭据

阶段 D 沿用 `client-core` 现有的方式：网关把下游凭据随请求交给执行层，执行层在创建 worker 时传入。这个方式只适用于本地原型和内部单用户环境。
首批 grant 为 `{kind:"session",userId,session,expiresAt}`，只放在 RPC frame body。执行层的一个 resolver 读取凭据，并通过 `caller.grant` 传给 Client Core；所有 worker 调用绑定必填 userId。生产环境只在设置了 `MCP_EXECUTOR_ALLOWED_USER_IDS` 时接受 session grants（第 10 节）。执行层先通过 transport URL 的 whoami 验证 session 所属 userId，以 session 的 SHA-256 缓存到 grant.expiresAt，最多 10,000 条；不匹配或 401 拒绝认证。每次复用前检查创建 worker 的 grant，距过期不超过 60 秒时销毁并用当前 grant 重建。显式 worker env 阻止环境变量继承，但同 uid 子进程仍可能读取执行层 `/proc/1/environ`，阶段 G 必须解决。
多用户环境下执行层如何持有凭据，由阶段 G 的安全设计决定。阶段 D 的实现要把凭据的获取集中在一个接口后面，方便阶段 G 替换。


### 6.5 错误与结果边界

已提交的 execute 超过 100,000 字符或 RPC 响应字节上限时保留 committed、revision、status，省略 value 并返回
valueTruncated: true；文本确认已提交，不提示重试写入。未提交结果仍返回 workspace-result-too-large。
排队时取消不会取得 lease，返回 workspace-executor-timeout，detail.started 为 false、retryable 为 true；
取得 lease 后继续运行，超时写入仍为 workspace-result-unknown。未确认 submit 和无 code 的 commit 错误同样
返回 result-unknown，detail.cause 保留原因；除 timeout 外 outcome 为 tool_error。
用户脚本的无 code 错误在 runtime 边界标记，由执行层返回 workspace-script-failed、CLI 原始 message 和 name。
其他无 code 错误保持 internal_error。失败 envelope 也携带 meta，用于记录 worker 用量。

## 7. 渲染服务与大文件

### 7.1 渲染服务

- 输入是执行层组装好的渲染数据（`UniverRenderUnit`），输出是 PNG、PDF 或 lint 报告。
- 不访问 Workspace，不持有任何用户凭据。图片资产必须在执行层内联后再交给它。
- 目标：常驻浏览器池，每个任务一个 BrowserContext，任务结束即销毁，不跨用户复用。
- 当前（2026-11-09 产品负责人决定，阶段 G 收口）：`createUniverRenderRuntime` 只接受 `renderPageRoot`、浏览器路径、`env`、`license` 和 `signal`，不能注入浏览器或 BrowserContext。阶段 E 因此只能用长驻的 runtime 池代替“每任务一个 BrowserContext”：每个 runtime 自带一个 Chromium 和一个页面，跨请求、跨用户复用，这是对上一条的临时偏离。runtime 的每个方法都带完整的 unit，runtime 在两次调用之间不保存请求状态，但浏览器页面是共享的。阶段 G 必须恢复每任务隔离（换用支持 BrowserContext 的渲染入口，或每任务一个 runtime），在那之前渲染服务只用于本机和内部单用户环境。
- 池参数：最多 `RENDERER_MAX_RUNTIMES` 个 runtime（默认 2，依据与容器内存预算见 7.1.1 节），按需创建，一次请求独占一个 runtime。排队超过 `RENDERER_QUEUE_TIMEOUT_MS`（默认 5000）返回可重试的 `workspace-renderer-busy`。操作超过 `RENDERER_OPERATION_TIMEOUT_MS`（默认 25000），或抛出浏览器、runtime 故障时，关闭并丢弃该 runtime，下一次请求重新创建；输入错误（unit 数据无效、不支持的类型）不影响 runtime，归还给池。关闭服务时关闭全部 runtime。
- 渲染服务的内部 RPC 沿用执行层的帧格式、Bearer 校验和错误信封，不带用户 grant。操作为 `screenshot`、`printPdf`、`lint`、`measureText`，协议定义在 `apps/mcp/src/shared/renderer-protocol.ts`，执行层之后从这里导入。
- 页面只来自镜像内的 render-runtime 产物，不访问外部网络。
- 现有启动参数含 `--no-sandbox`（`@univer-cli/univer-render-runtime` README）。在沙箱运行时下如何处理由阶段 G 确定。

#### 7.1.1 容量测量（2026-11-09）

回答两个问题：`RENDERER_MAX_RUNTIMES=2` 与渲染容器内存预算是否是合理默认值；复用 runtime 的页面是否需要“用满 N 次就回收”的守卫。

环境同 6.2：本机 Docker Desktop，宿主 M2 Pro、10 逻辑 CPU；Docker 报告 6 vCPU、11.68 GiB，gateway、executor、renderer 与宿主上的其他工作共享，Chromium 为镜像内的 Linux arm64 版本，无 GPU。宿主不是安静的：每轮开始前一分钟 load 中位数 5.4（范围 3.3 至 8.6，共 63 次），其中 36 次高于 5（逻辑 CPU 的一半，即脚本的 quiet 阈值），启动时占 CPU 最多的是 Docker 虚拟机（约 37%）和 WindowServer（约 19%）。吞吐的两个设置按重复轮次交替顺序运行，所以背景负载对两边的影响相同，但绝对数字仍带本机噪声。不是生产硬件结论，阶段 H 须在最终沙箱与生产硬件上重测。

方法。调用方在 executor 容器内直接请求 renderer 的 RPC，因此不含网关、执行层和 Workspace 的时间；每次调用都检查输出确实产生（截图含 PNG 签名，PDF 以 `%PDF` 开头且有页数，量字返回行数）。输入为 40 行 8 列的 Sheet（范围 A1:H40）、40 段的 Doc（截图为一张高图，打印为 6 页）和一行中英混排文字。1859 次调用没有错误。每轮 renderer 容器都重建（`verify-uvw renderer-restart <n>`），内存从渲染容器内读 `/proc`，并读 cgroup。

| 术语 | 含义 |
| --- | --- |
| 冷 runtime | 池已有的 runtime 都在用时新启动的 runtime，含 Chromium 启动、页面加载和首次渲染。测量时与另一个调用并发 |
| 预热 runtime 首次使用 | 启动时预热的 runtime 上的第一次渲染，页面是新的 |
| 热 | 同一 runtime 上的后续渲染 |
| RSS | 每个进程都计入共享页，会高估 |
| PSS | 共享页按映射进程均摊 |
| cgroup anon | 容器被计费的匿名内存，不含文件缓存。这个内核没有 `memory.peak`，峰值取 250 ms 采样的最大值，会低估瞬时峰值 |

延迟（毫秒，中位数，范围）。冷与首次使用各 5 次独立重启；热为 5 个块各 20 次顺序调用，取块中位数的中位数。

| 操作 | 冷 runtime | 预热 runtime 首次使用 | 热，块中位数的中位数 | 热，全部调用 p50 / p95 | 输出 |
| --- | --- | --- | --- | --- | --- |
| screenshot Sheet | 3125，2639 至 3333 | 1646，1614 至 1911 | 584，568 至 601 | 582 / 923 | 645 KB PNG |
| screenshot Doc | 2941，2807 至 3320 | 1804，1694 至 2143 | 992，981 至 1022 | 991 / 1220 | 3.3 MB PNG |
| print_pdf Doc | 3222，3029 至 3515 | 1949，1916 至 2129 | 1208，1193 至 1259 | 1210 / 1372 | 1.5 MB PDF，6 页 |
| measureText | 1251，1084 至 2600 | 60，55 至 87 | 3，2 至 3 | 3 / 7 | 无载荷 |

吞吐：4 个调用方闭环，预热 4 秒后计 20 秒窗口内完成的调用，每个设置 5 轮，中位数与范围。

| 操作 | `RENDERER_MAX_RUNTIMES` | 次/秒 | 负载下单次调用 ms | renderer 容器 CPU %（每轮中位数的中位数；每轮峰值的中位数） | 压测端 CPU % | 错误 / 调用 |
| --- | --- | --- | --- | --- | --- | --- |
| screenshot Sheet | 1 | 1.75，1.70 至 1.75 | 2266 | 74；101 | 8 | 0 / 193 |
| screenshot Sheet | 2 | 3.40，3.00 至 3.50 | 1136 | 122；372 | 9 | 0 / 352 |
| screenshot Sheet | 4（补充） | 6.45，5.25 至 6.75 | 586 | 256；537 | 11 | 0 / 648 |
| print_pdf Doc | 1 | 0.80，0.80 至 0.80 | 4746 | 98；131 | 8 | 0 / 100 |
| print_pdf Doc | 2 | 1.60，1.40 至 1.60 | 2482 | 187；311 | 9 | 0 / 174 |
| print_pdf Doc | 4（补充） | 2.05，1.20 至 2.50 | 1769 | 436；530 | 14 | 0 / 215 |

2 个 runtime 相对 1 个：Sheet 截图逐轮配对的比值中位数 1.94 倍（1.76 至 2.00），print_pdf 2.00 倍（1.75 至 2.00）。4 个 runtime（补充一组，宿主一分钟 load 中位数 10.7、范围 5.8 至 15.8，高于主测量）：相对 2 个，Sheet 截图约 1.9 倍，print_pdf 只有约 1.3 倍。

**限制因素。** 一个 runtime 同一时刻只渲染一个请求，在 Chromium 的页面线程上约占一个核：单 runtime 时 renderer 容器 CPU 为 74%（Sheet）和 98%（打印）。池从 1 增到 2 个 runtime，吞吐提高 1.94 倍（Sheet）和 2.00 倍（打印），容器 CPU 提高 1.65 倍和 1.9 倍，所以 1 到 2 个 runtime 受“每个 runtime 一个页面线程”限制，不受 Node、压测端（CPU 8% 至 9%）或排队限制（没有 `workspace-renderer-busy`）。到 4 个 runtime，打印的容器 CPU 中位数 436%、峰值 530%，接近 Docker 虚拟机的 6 vCPU，且宿主同时有其他负载，这时 CPU 成为限制，吞吐不再随 runtime 数线性增长；Sheet 截图更轻，4 个时仍接近线性。结论：默认 2 对本机合理，它只占约 2 个 vCPU；调大只在渲染容器有更多 CPU 时有收益，而且每个 runtime 的内存成本见下。

内存（MiB）。树是一个 runtime 的 Chromium 进程，Node 进程由所有 runtime 共享。

| 时刻 | 活 runtime | Node RSS | 单树 RSS | 单树 PSS | cgroup anon |
| --- | --- | --- | --- | --- | --- |
| 空闲，启动预热，未渲染 | 1 | 121 | 1028 | 511 | 339 |
| 空闲，每个 runtime 渲染过一次（Sheet 截图） | 2 | 141 | 1204 | 555 | 901 |
| 空闲，每个 runtime 渲染过一次（Doc 打印） | 2 | 162 | 1320 | 662 | 1031 |
| 负载下采样峰值，Sheet 截图 | 1 / 2 / 4 | 150 / 157 / 203 | 1337 / 1344 / 1363 | 813 / 705 / 656 | 650 / 1204 / 2258 |
| 负载下采样峰值，Doc 打印 | 1 / 2 / 4 | 168 / 162 / 171 | 1761 / 1883 / 1920 | 1196 / 1185 / 1201 | 915 / 1629 / 2946 |

RSS 把共享的 Chromium 库和字体页在每个进程里重复计入，两个 runtime 的 RSS 合计约为 cgroup anon 的 2.2 至 2.8 倍，不能当预算。以 cgroup anon 为准：Node 约 170 MiB，每个 runtime 打印 6 页 Doc 时采样峰值约 730 MiB（`(1629 - 162) / 2`），Sheet 截图约 520 MiB。

| renderer 容器预算 | 计算（MiB） | 采样峰值 | 实测 |
| --- | --- | --- | --- |
| 2 GiB，2 个 runtime | 无法满足 0.75 余量：`170 + 2 × 730 = 1630`，`1630 / 0.75 = 2173`，约 2.1 GiB | Doc 打印 1.4 至 1.6 GiB | 施加 2048 MiB 硬限制，5 轮 Doc 打印中 3 轮触发 cgroup OOM（共 4 次 OOM kill），一次调用超过 40 秒没有应答；Sheet 截图 5 轮无错误 |
| 3 GiB，2 个 runtime | 同上，余量 0.75 时需约 2.1 GiB | 同上 | 施加 3072 MiB 硬限制，Sheet 截图与 Doc 打印各 5 轮，0 错误、0 OOM、0 个 runtime 被丢弃 |
| 4 GiB，4 个 runtime | `(170 + 4 × 740) / 0.75 = 4180`，略超 4 GiB | Doc 打印 2.8 至 3.0 GiB（中位数 2.88） | 补充组没有施加限制，预算为外推 |

建议：默认 2 个 runtime 时给 renderer 容器 3 GiB，这是唯一实测通过的预算；2 GiB 会在 Doc 打印下被 OOM 杀进程。若调到 4 个 runtime，预算至少 4.5 GiB 并重测。余量系数 0.75 沿用 6.2 节，仍是策略假设。预算没有覆盖更大的输入（整页噪声图的 1920×1080 Slide、接近 1677 万像素上限的 Doc 截图）；Chromium 对这类输入的峰值更高，上线前须另测。

复用：把池限制为 1 个 runtime，让 200 次顺序渲染全部落在同一个页面上，每 25 次渲染取 3 个快照，取中位数。每个操作 1 次完整运行，没有错误，没有新建或丢弃 runtime（`mcp_renderer_runtime_creations_total` 增量为 0）。

| 操作 | 0 次 | 25 次 | 50 次 | 100 次 | 150 次 | 200 次 | 50 至 200 次的变化 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| screenshot Sheet，cgroup anon | 340 | 538 | 541 | 516 | 533 | 534 | -7 |
| screenshot Doc，cgroup anon | 345 | 511 | 482 | 496 | 510 | 492 | +10 |
| print_pdf Doc，cgroup anon | 336 | 531 | 581 | 585 | 875 | 598 | +17 |
| 每块 25 次的中位延迟 ms（Sheet / Doc / 打印） | n/a | 567 / 995 / 1177 | 591 / 999 / 1192 | 576 / 988 / 1212 | 589 / 983 / 1249 | 584 / 1000 / 1216 | 无漂移 |

前 25 至 50 次渲染把页面工作集撑起来（cgroup anon 增加约 170 至 245 MiB），之后进入平台；50 至 200 次渲染的净变化在 -7 至 +17 MiB，不随次数增长，延迟也没有漂移。Doc 打印在第 150 次出现一次 +290 MiB 的瞬时高点，下一次采样回落，说明峰值要为这类瞬时增长留余量，不说明泄漏。**结论：200 次渲染内没有证据表明复用的页面持续增长，本 PR 不加“用满 N 次回收”的守卫。** 200 次不能证明数千次后也有界；回收守卫列为后续，触发条件见下。

**对用户可见延迟的占比。** 暖的 `screenshot` 工具调用（网关事件 `duration_ms` 按请求 ID 与 renderer 日志的 `duration_ms` 关联，各 10 次）：Sheet 593 ms 中 renderer 占 558 ms（94%），Doc 926 ms 中 renderer 占 882 ms（95%）。渲染服务就是 `screenshot` 的延迟，执行层与网关合计约 35 至 45 ms。

复跑：`node .agents/skills/verify-uvw/bin/renderer-bench.mjs --output <json>`，汇总用 `python3 .agents/skills/verify-uvw/bin/renderer-bench-summary.py <json> --markdown`，步骤和各场景的含义见[渲染服务测量](../../../.agents/skills/verify-uvw/features/mcp.md#renderer-capacity-benchmark)。本节的原始 JSON 是主测量一份（冷、热、吞吐 1 与 2、复用）、4 个 runtime 一份、2048 与 3072 MiB 限制各一份和端到端一份。主测量和 4 个 runtime 那一份用的是 `renderer-bench.mjs` 加入 `--memory-limit` 之前的版本（`scriptSha256` 为 `8501c746…`），其余三份用当前版本；据作者说明场景代码没有改动，旧版本不在 git 中，无法逐行核对，独立复测的热延迟与吞吐中位数与本节相差不超过 5%。

#### 7.1.2 已知问题与后续

每条给出触发条件。

- **故障后的请求迟迟不应答。** 超时或 runtime 故障时，池先 `await` 上游 runtime 的关闭再抛错，所以应答要等关闭完成。验收时实测：杀掉存活浏览器的页面进程，或容器 OOM 杀掉一个 Chromium 进程，请求超过 40 秒没有应答（deadline 28 秒、操作超时 25 秒），被丢弃 runtime 的浏览器在丢弃后仍存活约 2 分钟（`ps` 每 30 秒一次，120 秒时还在，150 秒时消失）。条件：操作超时或 Chromium 子进程死亡而浏览器主进程存活。建议在阶段 G 恢复每任务隔离时一并处理：先应答、后台关闭并强杀进程树。浏览器主进程被杀时没有这个问题（MR9：立即返回可重试的 `workspace-renderer-failed`）。
- **回收守卫。** 200 次渲染内没有增长，不加。触发条件：把同一脚本的 `--soak-renders` 提到 2000 以上，Doc 打印或截图在平台之后每 1000 次渲染 cgroup anon 增长超过 50 MiB（该阈值是本次的选择，不是测得的），或阶段 H 的内存面板显示 renderer 内存在两次重启之间持续上升。
- **renderer 进程经 `shared/errors.ts` 间接加载 client-core 的产品模块。** import 边界测试只检查直接导入。条件：`shared/errors.ts` 再被其他模块引入产品代码时，边界测试不会发现。
- **Chromium 空闲时死亡后，最多 `RENDERER_MAX_RUNTIMES` 次调用先失败再得到新 runtime。** 每次失败都是可重试错误。MR9 在池里只有 1 个空闲 runtime 时失败 1 次。条件：池里有多个空闲 runtime 同时死亡。
- **冷启动 runtime 不能被中断。** deadline 短于冷启动（约 3 秒，含首次渲染）的请求会在启动结束之后才失败。条件：调用方给出很短的 deadline。
- **Sheet 默认截图范围不包含网格外的图片。** 条件：图片锚在默认范围之外，需显式给 `range`。这一条由实现者提供，本次验收没有复测。
- **Doc skill 的示例使用 `api.Enum.DocsImageWrappingStyle`，SDK 没有这个枚举。** 条件：agent 照抄示例。这一条由实现者提供，本次验收没有复测。
- **Doc 截图是一张高图，约 4 页以上超过 16,777,216 像素上限。** 实测 60 段（`pdfPages` 4，1920×7421）成功，7 页的 Doc 报 `workspace-render-input-invalid`、`PIXEL_LIMIT_EXCEEDED`；`uvw screenshot` 对同一 Unit 同样报 `PIXEL_LIMIT_EXCEEDED`，所以这是上游行为，MCP 与 CLI 一致。agent 需要多页 Doc 时应改用 `print_pdf`。
- **内存预算没有覆盖大输入。** 条件：Slide 页面含大图或 Doc 截图接近像素上限；上线前用真实大小的 Unit 重测，并同时压测 `RENDERER_MAX_RUNTIMES` 与容器预算。

### 7.2 trunk 渲染需要补的路径

现有代码只为 Worktree 范围内联图片，trunk 范围直接返回原始数据（`packages/client-core/src/render-unit.ts:102`）。
CLI 在本机渲染时 Chromium 可以自己加载图片，渲染服务不行。阶段 E 需要为 trunk 补上内联路径。
如果 Workspace 没有按 trunk 读取 Asset 的接口，需要在 Workspace 新增，并同步 HTTP contract。

### 7.3 大文件导入的限制

`uvw import` 先在本地把 Office 文件转换为 UnitData，再通过 `POST /api/worktrees/:id/units` 提交（`packages/client-core/src/office-exchange.ts:102-128`、`unit.ts:85-86`）。
这个路由的 JSON 上限是 1 MiB（`apps/workspace/server/src/modules/worktrees/worktrees.router.ts:10`）。DSH 插件因此把转换结果限制在 900 KiB（`packages/dsh-univer-workspace-plugin/src/provider/local-exchange.ts:32`）。
`exchange.service.ts:41` 的 50 MiB 只适用于服务端的 trunk 导入任务，与这条路径无关。

所以 CLI 和 MCP 现在都导入不了较大的 Office 文件。MCP 首版保持与 CLI 相同的上限，在工具描述和错误信息里说明。
2026-11-08，产品负责人决定把大文件导入移至后续阶段，阶段 D 保留 900 KiB 序列化 UnitData 上限，不阻塞其余执行层验收。后续与 Workspace 维护者比较以下候选方案，尚未选择或实现：

- 单独放宽创建 Unit 路由的 JSON 上限。
- 先创建空 Unit，再分批写入内容。
- 提供以 Worktree 为目标的服务端导入 job。
- 将 UnitData 存为 Blob，在创建 Unit 时引用该 Blob。

这些方案需要明确权限、幂等重试、失败恢复和资源回收边界，再单独实施。

## 8. 用量统计

MCP 不连数据库（D12），所以第一版的“统计接口”由两部分组成：版本化的用量事件，以及 Prometheus 指标。
聚合、报表和以后的计费都从这两份数据里取（D5）。

### 8.1 用量事件

网关在每次工具调用结束时，向 stdout 输出一行 JSON，`event` 字段为 `mcp.tool_call`，`schema_version` 为 `1`。
事件格式写入 `apps/mcp/README.md`，作为对外的稳定约定。字段：

| 字段 | 说明 |
| --- | --- |
| `ts`、`request_id`、`trace_id` | 时间、请求 ID、追踪 ID（来自 `_meta` 的 `traceparent`，如有） |
| `user_id` | 用户 |
| `auth_kind` | `oauth`、`pat`、`dev` |
| `client_id` | OAuth 客户端 ID 或 PAT 的 ID |
| `client_name`、`client_version` | 请求里的 `clientInfo` |
| `tool`、`toolset` | 工具与所属 toolset |
| `repo`、`unit_type` | 解析后的仓库与 Unit 类型（没有则为空） |
| `outcome` | `ok`、`tool_error`、`auth_error`、`rate_limited`、`timeout`、`internal_error` |
| `error_code` | 工具错误的错误码，与返回给客户端的 `code` 相同。Workspace 自己的错误码（如 `NOT_FOUND`）原样记录 |
| `duration_ms` | 网关总耗时 |
| `executor` | `cold_start`、`warm`、`none` |
| `cost` | 成本单位：`worker_cpu_ms`、`worker_peak_rss_mb`、`render_pages`、`export_bytes`、`upload_bytes`、`committed_revisions` |

事件不包含工具参数原文、文档内容或任何凭据。首批执行工具的 `worker_cpu_ms` 是 Client Core observe 报告的 worker 墙钟耗时，不是 CPU 测量；`worker_peak_rss_mb` 暂为 0。非执行工具保持原事件格式与零成本。

### 8.2 指标

网关、执行层、渲染服务各自暴露 `/metrics`，用 Bearer 令牌保护，做法与 Workspace 的 `METRICS_TOKEN` 一致（`apps/workspace/server/src/middleware/metrics.ts`）。
标签保持低基数，不带用户 ID：

| 指标 | 标签 |
| --- | --- |
| `mcp_tool_calls_total` | `tool`、`client`、`outcome` |
| `mcp_tool_duration_seconds` | `tool` |
| `mcp_rate_limited_total` | `tool` |
| `mcp_executor_workers` | `state`（`idle`、`busy`、`loading`） |
| `mcp_executor_cold_starts_total` | 无 |
| `mcp_executor_queue_wait_seconds` | 无 |
| `mcp_executor_collaboration_connections` | 无 |
| `mcp_renderer_jobs_total` | `kind`、`outcome` |
| `mcp_renderer_runtimes` | `state`（`idle`、`busy`） |
| `mcp_renderer_runtime_creations_total`、`mcp_renderer_runtime_discards_total` | 无 |
| `mcp_staging_bytes` | `purpose` |

Grafana 面板沿用 `observability/` 的方案，新增一个 MCP 面板。

## 9. `client-core` 改造

所有改动都是增量的。新选项有默认值，默认值等于现在的行为，CLI 不改调用也保持原样（兼容性标准 4.1）。

### 9.1 清单

| # | 改动 | 原因 | 阶段 |
| --- | --- | --- | --- |
| C1 | `WorkspaceHttp` 区分身份 origin 和传输地址。身份 origin 用于生成和解析展示给用户的 URL，传输地址用于实际请求。默认两者相同 | 网关和执行层走集群内部地址；本地验证从容器访问宿主 | A |
| C2 | 运行时 key 加入调用者身份。`resolveCredential` 接收调用者上下文 | key 不含用户，`initByKey` 按 key 缓存凭据（`content-runtime.ts:69, 194-216`），`resolveCredential` 拿不到调用者（`content-runtime.ts:51-54`） | C |
| C3 | 池参数可配置：最大数量、空闲 TTL、操作超时、跨 key 排队 | 见 6.2 节 | C |
| C4 | 子进程环境变量显式传入 | 见 6.2 节 | C |
| C5 | Office 导入导出、Markdown、Typst、SVG、HTML View 提供 Buffer 或字符串接口 | 现有实现以文件路径为输入输出（`office-exchange.ts:102-177`、`markdown-source.ts`、`typst.ts`、`svg.ts`、`files.ts`）。DSH 插件已用 Buffer 方式（`local-exchange.ts:145, 180`），可以参考 | C |
| C6 | Office 交换按操作传入 license，不再调用进程级 `configureExchange` | `exchange-node` README 说明支持按操作传入，且不修改默认值 | C |
| C7 | Office 导出用量存储的目录可配置 | `exchange-node` README 要求进程有可写的本地持久存储记录导出用量，否则返回 `LICENSE_USAGE_STORAGE_ERROR` | C |
| C8 | trunk 渲染的图片内联 | 见 7.2 节 | E |
| C9 | 凭据获取集中在一个接口后面 | 见 6.4 节，为阶段 G 替换做准备 | D |

### 9.2 不需要改的

- Typst 编译期间对 `Math.random` 的替换已经用 `AsyncLocalStorage` 限定在调用上下文内，注释说明就是为长驻并发宿主设计的（`packages/client-core/src/typst-materialize.ts:8-14`）。
- license 的宿主注入机制已经存在。
- DSH 插件不使用 `client-core` 的运行时池，C2 到 C4 不影响它。

## 10. 执行层安全：门禁要求

D4 接受在服务端执行模型生成的代码。CLI 里这些代码跑在用户自己的机器上；搬到服务端后，风险由我们承担。
`prepareContentExecutionProgram` 的 README 写明它不判断代码是否安全，也不提供进程级沙箱。

对抗审查已经确认，阶段 D 沿用的现有执行方式不足以支撑多用户环境。具体的安全设计是阶段 G 的交付物，需要单独评审。
阶段 G 已于 2026-11-09 搁置（见 [阶段计划](stages.zh-CN.md)）。在 G 通过之前，执行层和渲染服务不对公众开放。
阶段 G0 在生产环境用执行层白名单 `MCP_EXECUTOR_ALLOWED_USER_IDS` 代替这道门禁：只有白名单内互相信任的用户能使用共享执行层，
其他用户只看到不依赖执行层的工具。白名单不满足下面任何一条要求，它只限制谁承担这些风险。

阶段 G 的设计必须满足以下要求，并给出可复现的验证结果：

1. 一个用户的脚本读不到其他用户的文档数据或凭据。
2. 脚本能使用的 Workspace 权限，不超过本次工具调用所需，也不超过用户授予的 scope。
3. 一个用户的执行不能中断或拖垮其他用户的执行。
4. 每次执行都有 CPU、内存、墙钟时间的上限，超限即终止并回收。
5. 执行层和渲染服务只能访问完成任务所必需的网络目标。
6. 执行层和渲染服务不挂载任何产品数据卷。
7. 安全相关的配置错误会让服务拒绝启动，不能静默降级。

## 11. 配置项

| 变量 | 角色 | 说明 |
| --- | --- | --- |
| `MCP_ROLE` | 全部 | `gateway`、`executor`、`renderer` |
| `PORT`、`HOST` | 全部 | 监听地址 |
| `WORKSPACE_ORIGIN` | 网关、执行层 | 身份 origin，用于展示和解析 URL，例如 `https://space.univer.ai` |
| `WORKSPACE_TRANSPORT_URL` | 网关、执行层 | 实际请求地址，默认等于 `WORKSPACE_ORIGIN` |
| `MCP_PUBLIC_URL` | 网关 | MCP 的公网地址，例如 `https://space.univer.ai/mcp` |
| `MCP_EXECUTOR_URLS`、`MCP_RENDERER_URL` | 网关、执行层 | 内部服务地址 |
| `MCP_EXECUTOR_TOKEN` | 网关、执行层 | 网关调用执行层（含 capability discovery）的令牌，至少 32 字符。网关与 `MCP_EXECUTOR_URLS` 同时设置或同时不设；执行层必填 |
| `MCP_RENDERER_TOKEN` | 执行层、渲染服务 | 执行层调用渲染服务的令牌，至少 32 字符。执行层与 `MCP_RENDERER_URL` 同时设置或同时不设，且必须与 `MCP_EXECUTOR_TOKEN` 不同；渲染服务必填，网关不持有 |
| `MCP_STAGING_DIRECTORY` | 网关 | 暂存存储目录 |
| `MCP_OAUTH_CLIENT_ID`、`MCP_OAUTH_CLIENT_SECRET` | 网关 | token exchange 用的机密客户端，两者同时设置或同时不设。启用 PAT 与 OAuth access token 认证 |
| `MCP_DEV_SESSION_PASSTHROUGH` | 网关 | 开发认证，生产环境禁止（4.6 节）。与上一行至少设置一项，本地验证两者同时设置 |
| `MCP_EXECUTOR_ALLOWED_USER_IDS` | 网关、执行层 | 逗号分隔的 Workspace 用户 ID，只有这些用户能使用执行层（第 10 节）。生产环境的执行层必须设置；配置了执行层的网关在生产环境也必须设置。非生产环境不设置时所有用户都能使用执行层 |
| `UNIVER_LICENSE`、`UNIVER_LICENSE_KEY` | 执行层、渲染服务 | license 注入。渲染服务只读取 `UNIVER_LICENSE`，未设置时使用与执行层相同的内置开发 license |
| `EXECUTOR_*` | 执行层 | 见 6.2 节 |
| `RENDERER_MAX_RUNTIMES` | 渲染服务 | 同时存在的 runtime（每个一个 Chromium）上限，默认 2 |
| `RENDERER_QUEUE_TIMEOUT_MS` | 渲染服务 | 等待空闲 runtime 的最长时间，默认 5000；超时返回可重试错误 |
| `RENDERER_OPERATION_TIMEOUT_MS` | 渲染服务 | 单次渲染操作和 runtime 启动的超时，默认 25000；超时即丢弃该 runtime |
| `UNIVER_RENDER_BROWSER` | 渲染服务 | Chromium 可执行文件。镜像设为 `/usr/bin/chromium`（Debian 包，含 `fonts-noto-cjk` 与 `fonts-liberation`） |
| `METRICS_TOKEN` | 网关、渲染服务 | 指标端点令牌。执行层的 `/metrics` 与它的 RPC 共用调用方令牌 |
| `LOG_LEVEL` | 全部 | 日志级别，日志格式与 Workspace 一致（pino JSON） |

每个已实现角色提供 `GET /healthz`，只检查进程存活。网关另有 `GET /readyz`：Workspace 可达，配置了 OAuth 时网关的机密客户端能做 token exchange（用网关的客户端凭据、不带 subject token 调用 token 端点，Workspace 校验凭据和 exchange 权限之后、查找 token 之前返回 `invalid_request` 才算通过，所以 `MCP_OAUTH_CLIENT_SECRET` 配错时网关不就绪），配置了执行层时至少一个执行层返回了兼容的能力（`GET /rpc/v1/capabilities`），三者都满足才就绪。Workspace 没有版本接口，按版本号拒绝就绪（3.2 节）暂缓。

## 12. `apps/mcp` 的代码组织建议

```text
apps/mcp/
  AGENTS.md            边界与约束（阶段 A 新建）
  README.md            运行、配置、用量事件格式、对外端点
  Dockerfile           一个镜像，三种角色
  docker/
    compose.verify.yml 本地验证用（见 `local-verification.zh-CN.md`）
  src/
    main.ts            按 MCP_ROLE 选择入口
    gateway/           MCP 协议、认证、工具注册、文件端点、用量事件
      tools/           每个 toolset 一个目录，工具定义与 uvw 一一对应
    executor/          内部 RPC、worker 池宿主、作业子进程
    renderer/          内部 RPC、浏览器池
    shared/            内部 RPC 协议类型、错误映射、配置解析
  test/
```

- 工具定义只做参数解析和结果映射，业务逻辑调用 `client-core` 已有的 feature，不复制 CLI 的实现。
- `apps/mcp` 依赖 `@univerjs/univer-workspace-client-core`（workspace 协议）和 MCP 官方 TypeScript SDK（精确版本）。不依赖 `apps/cli`。
- skills 内容在构建时从 `apps/cli/skill-data` 复制进 `apps/mcp` 的产物，保证与 CLI 版本一致。

内部工具与请求失败仅记录错误类名及安全的 code、syscall 和 request ID，不记录错误消息、堆栈、路径或参数。客户端中止只记录一次 info 级失败。下载的 Workspace 媒体类型无法解析时使用 application/octet-stream；数据与 sidecar 大小不一致属于内部完整性错误。

文件工具在 gateway 内记录 `upload_bytes`（消费上传）和 `export_bytes`（写入下载），`executor: none` 时允许这两项非零，其他成本仍为零。

### D4 Office 作业进程

`exchange.import` 和 `exchange.export` 通过相同的操作表、二进制 RPC 与 `executorTool` 分发。
执行层父进程构造 `WorkspaceUnitExchangeFeature`，注入转换函数并使用 `licenseMode: per-operation`。
父进程保留 HTTP、目标解析、图片解析、runtime 与创建 Unit；只有转换在 `executor/jobs/entry` 中运行。
每次转换 fork 一个新进程，使用 advanced serialization 传递字节，并在请求剩余预算耗尽时 SIGKILL。
子进程不接收 session、grant 或 Workspace 地址，也不继承 internal token 或 Node 启动参数。
license 与 key 只随转换数据交给作业，不传给池 worker。

子进程的 `HOME`、`XDG_STATE_HOME`、`TMPDIR` 指向私有临时目录，退出后删除。
这提供 C7 尚未完成时的可写 usage storage 环境，不保证持久化配额统计。
`LICENSE_USAGE_STORAGE_ERROR` 保留 SDK 的错误码与信息，不自动重试。
此处没有网络隔离，仍仅供本地和内部单用户环境使用，Stage G 的安全门禁不变。

导入创建 Unit 前计算最终 initialData 的 JSON UTF-8 字节数，超过 900 KiB 时拒绝，
返回 `workspace-import-too-large` 以及 `size`、`maxBytes`，避免 units 路由的模糊 413。
CLI 默认路径没有新增限制。导入请求帧为 64 MiB，导出响应帧为 128 MiB。

### D5 网关任务生命周期

网关为 import/export/compile_typst 持有 running、succeeded、failed 判别联合，内存缓存与 staging 的私有
`.job.json` sidecar 同步，开始和结束均原子写入。记录包含随机 id、userId、tool、可选 key、
createdAt、deadlineAt、expiresAt，以及仅在成功时存在的 result 或仅在失败时存在的 error。
共享 staging 的副本可读取结果，并通过同用户、同工具、同 key 的短期 reservation lock 防止重复启动。
转换进程、队列和 SIGKILL 仍属于 executor；只有 exchange.import、exchange.export、typst.compile、render.screenshot、render.printPdf 允许四分钟 RPC 期限（`JOB_DEADLINE_MS`）。
同步预算默认三十秒，MCP_SYNC_BUDGET_MS 可降低；超过预算只结束同步等待，原执行继续。
网关重启会丢失在途调用；过 deadlineAt 的记录按读超时或写结果未知回答，不重新执行。
结果保留十五分钟，由 staging sweeper 清理。原工具事件延迟到执行结束后发出一次，
携带实际成本；去重重试不发第二个转换事件。job_get 保持普通只读工具的零成本事件。

D5 的 key 绑定参数：job 记录和 reservation 保存规范化后的工具参数 SHA-256。同 key 但上传、Worktree、Space、Unit、格式等任一参数不同，
在任务 running 或结果未过期期间返回 `workspace-idempotency-conflict` 且不启动任何转换，与 Workspace 对复用 Idempotency-Key 的 409 一致；参数相同则沿用 join/回放。
reservation lock 只保护毫秒级临界区，10 秒后视为过期，崩溃的持有者最多延迟重试 10 秒；上传传输锁仍按两小时清理。
任务 deadlineAt 不晚于调用者授权过期时间减 5 秒（过短的授权仍得到同步预算，由执行层按原行为拒绝过期授权）。
持有未完成 completion 的网关在 deadlineAt 之后仍报告 running 并保留 key；该 completion（含执行层返回后的下载或 Workspace 响应映射）受 deadline 约束，到期按失败收敛，所以不会先报 failed 再报 succeeded。

D5 的 key 只去重 running 和 succeeded。failed sidecar 不再保留 key，旧版带 key 的失败记录也不参与 reservation。
超过 deadlineAt 的 running 记录同样不阻止重试。成功重试直接返回原工具结果；外部副本重新读取 sidecar 后按实际状态回答。
复用调用通过 MCP 响应的 _meta["univer.workspace.deduplicated"] 标记说明没有第二条转换事件，structuredContent 保持原工具结果。
