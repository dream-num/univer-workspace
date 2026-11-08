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
| Chromium | 每次截图、PDF、lint 冷启动一次 | `packages/client-core/src/screenshot.ts`、`print-pdf.ts`、`layout-lint.ts`；`@univer-cli/univer-render-runtime` |
| 本地磁盘 | session、配置、daemon socket、资源缓存、浏览器缓存、输入输出路径 | `apps/cli/src/config.ts:46-77` |

### 2.2 去向

| 本机组件 | 云端去向 | 变化 |
| --- | --- | --- |
| CLI 命令解析与输出 | 网关的工具分发 | 工具 schema 取代 Commander 参数，`structuredContent` 取代 `--json` 输出 |
| 纯 HTTP 命令 | 网关进程内直接调用 `client-core/product` | 与 CLI 共用同一套 feature 代码 |
| daemon 与 unix socket | 删除 | 网关通过内部 RPC 调用执行层，执行层直接实现那三个操作 |
| 运行时池与 worker | 执行层 | key 加入用户身份；跨 key 排队；参数可配置；见第 6 节 |
| CLI 进程内的 Office、Markdown、Typst、SVG 处理 | 执行层的作业子进程 | 它们解析用户提供的文件，并加载原生绑定，所以不在网关里执行，也不在池的父进程里执行 |
| Chromium | 渲染服务 | 常驻浏览器池，每个任务一个 BrowserContext，任务结束即销毁 |
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
系统的容量瓶颈大概率是 Workspace Server。网关的限流同时承担保护它的职责：

- 按用户限制并发执行数和每分钟写入次数。
- 执行层的协同连接总数设上限，纳入指标。
- 阶段 D 压测出 Workspace Server 可承受的 agent 写入速率，据此设定默认限额。

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
  网关按 token 摘要缓存下游凭据直到过期，避免每次调用都换取。
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
| F1 | `GET /.well-known/oauth-authorization-server`（RFC 8414） | 声明 `client_id_metadata_document_supported: true`，`token_endpoint_auth_methods_supported` 含 `none`，`code_challenge_methods_supported` 含 `S256` |
| F2 | Client ID Metadata Documents | `client_id` 可以是 https URL。授权时拉取并校验该文档中的 `redirect_uris`。Claude 在 F1 声明支持时走这条路 |
| F3 | 动态客户端注册 `POST /api/auth/register`（RFC 7591） | 兼容仍依赖 DCR 的客户端（Cursor、Copilot）。注册结果需要持久化，属于 Workspace 产品数据 |
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
- 后台定时清理过期对象，参照 `apps/workspace/server/src/jobs/blob-maintenance.ts`。上传对象 1 小时过期，导出结果 15 分钟过期。
- 执行层和渲染服务不直接访问暂存存储。网关读出文件交给它们，或从它们那里收回结果再写入。

### 5.2 网关的文件端点

| 端点 | 用途 |
| --- | --- |
| `PUT /mcp/files/uploads/{uploadId}` | 用签名 URL 上传。校验签名、大小上限、所有者 |
| `GET /mcp/files/uploads/{uploadId}/page` | 浏览器上传页，给不能自己执行 PUT 的客户端（claude.ai、ChatGPT 对话） |
| `GET /mcp/files/downloads/{downloadId}` | 用签名 URL 下载 |

这些端点与 Workspace 同域。下载一律带 `Content-Disposition: attachment`、`X-Content-Type-Options: nosniff` 和 `Content-Security-Policy: sandbox; default-src 'none'`，
上传页不渲染任何用户内容。做法参照 `apps/workspace/server/src/modules/univer-assets/univer-assets.router.ts:147-152`。
导出的 HTML、SVG、Markdown 可能包含任意内容，不能在 Workspace 的同源下以内联方式打开。

## 6. 执行层

### 6.1 职责

- 内部 RPC 暴露命名领域操作（首批为 `content.execute`、`content.inspect`、`diagnostics.probe`），内部组合 `executeAndCommit`、`executeRead`、`exportUnitData`，复用 `packages/client-core/src/content-runtime.ts`。
- 执行需要 headless Univer 的作业：Office 导入导出、Markdown 编译与回读、Typst 编译、SVG 编译、HTML View 校验、渲染数据组装。
- 对网关暴露内部 RPC。不对外暴露端口。

### 6.2 worker 池

| 参数 | CLI 默认 | 执行层 | 说明 |
| --- | --- | --- | --- |
| key | `workspace:<origin>:<scope>:<unitId>:<unitType>` | 通过必填 `caller.userId` 加入用户 ID | Client Core 已支持调用者隔离；executor 在一次请求的全部 runtime 调用中绑定同一调用者 |
| 最大 worker 数 | 20 | `EXECUTOR_MAX_WORKERS`，默认 4 | 暂用保守值，尚未实测容量；部署时按节点内存设定 |
| 空闲回收 | 5 分钟 | `EXECUTOR_IDLE_TTL_MS`，默认 60 秒 | 空闲 worker 仍保持协同连接，应尽快释放 |
| 跨 key 排队 | 没有，直接报错 | 排队，`EXECUTOR_QUEUE_TIMEOUT_MS` 后返回可重试错误 | 默认 5 秒 |
| 打开与操作超时 | 30 秒 | `EXECUTOR_OPERATION_TIMEOUT_MS`，默认 25 秒 | 留出余量，保证网关能在 30 秒同步预算内返回 |
| 子进程环境变量 | 继承父进程 | 显式传入 `{ NODE_ENV: "production" }` | Client Core 转交 `pool.env`；executor 不让子进程继承内部 token、OAuth secret 或 license key |

### 6.3 路由与状态

- MCP 2026-07-28 版去掉了 session，客户端也不保证复用连接。热 worker 只能是可丢弃的缓存。
- 每次操作都会先 pull 并检查 `baseRevision === target.revision`（`content-runtime.ts:283-305`），所以任意执行层副本都能从 Workspace 重建状态。热缓存只影响速度，不影响正确性。
- 网关按 `(用户 ID, scope, unitId)` 一致性哈希选择执行层副本。副本增减时只损失部分缓存。
- 同一 key 的操作串行，这是现有行为（`runForRuntimeKey` 加池内 FIFO）。
- 操作表声明重试策略；后续韧性变更由执行层重新解析目标并重试，网关不持有 revision。当前首批操作的 `rerun` 为空，原样返回 `workspace-result-mismatch`。
- 网关使用 rendezvous hashing。只对连接拒绝、DNS 失败或明确未接收的传输拒绝切换副本；已发送写入的断连或超时返回 `workspace-result-unknown`。

### 6.4 凭据

阶段 D 沿用 `client-core` 现有的方式：网关把下游凭据随请求交给执行层，执行层在创建 worker 时传入。这个方式只适用于本地原型和内部单用户环境。
首批 grant 为 `{kind:"session",userId,session,expiresAt}`，只放在 RPC frame body。执行层的一个 resolver 读取凭据，并通过 `caller.grant` 传给 Client Core；所有 worker 调用绑定必填 userId。生产拒绝 session grants。执行层先通过 transport URL 的 whoami 验证 session 所属 userId，以 session 的 SHA-256 缓存到 grant.expiresAt，最多 10,000 条；不匹配或 401 拒绝认证。每次复用前检查创建 worker 的 grant，距过期不超过 60 秒时销毁并用当前 grant 重建。显式 worker env 阻止环境变量继承，但同 uid 子进程仍可能读取执行层 `/proc/1/environ`，阶段 G 必须解决。
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
- 常驻浏览器池，每个任务一个 BrowserContext，任务结束即销毁，不跨用户复用。
- 页面只来自镜像内的 render-runtime 产物，不访问外部网络。
- 现有启动参数含 `--no-sandbox`（`@univer-cli/univer-render-runtime` README）。在沙箱运行时下如何处理由阶段 G 确定。

### 7.2 trunk 渲染需要补的路径

现有代码只为 Worktree 范围内联图片，trunk 范围直接返回原始数据（`packages/client-core/src/render-unit.ts:102`）。
CLI 在本机渲染时 Chromium 可以自己加载图片，渲染服务不行。阶段 E 需要为 trunk 补上内联路径。
如果 Workspace 没有按 trunk 读取 Asset 的接口，需要在 Workspace 新增，并同步 HTTP contract。

### 7.3 大文件导入的限制

`uvw import` 先在本地把 Office 文件转换为 UnitData，再通过 `POST /api/worktrees/:id/units` 提交（`packages/client-core/src/office-exchange.ts:102-128`、`unit.ts:85-86`）。
这个路由的 JSON 上限是 1 MiB（`apps/workspace/server/src/modules/worktrees/worktrees.router.ts:10`）。DSH 插件因此把转换结果限制在 900 KiB（`packages/dsh-univer-workspace-plugin/src/provider/local-exchange.ts:32`）。
`exchange.service.ts:41` 的 50 MiB 只适用于服务端的 trunk 导入任务，与这条路径无关。

所以 CLI 和 MCP 现在都导入不了较大的 Office 文件。MCP 首版保持与 CLI 相同的上限，在工具描述和错误信息里说明。
放宽上限需要 Workspace 提供更大的提交通道，例如单独放宽这个路由的上限，或提供分块提交。这由 Workspace 维护者在阶段 D 决定，属于 Workspace 的改动。

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
在 G 通过之前，执行层和渲染服务只能在本地原型和内部单用户环境运行。

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
| `MCP_INTERNAL_TOKEN` | 全部 | 内部 RPC 的共享令牌 |
| `MCP_STAGING_DIRECTORY` | 网关 | 暂存存储目录 |
| `MCP_OAUTH_CLIENT_ID`、`MCP_OAUTH_CLIENT_SECRET` | 网关 | token exchange 用的机密客户端，两者同时设置或同时不设。启用 PAT 与 OAuth access token 认证 |
| `MCP_DEV_SESSION_PASSTHROUGH` | 网关 | 开发认证，生产环境禁止（4.6 节）。与上一行至少设置一项，本地验证两者同时设置 |
| `UNIVER_LICENSE`、`UNIVER_LICENSE_KEY` | 执行层、渲染服务 | license 注入 |
| `EXECUTOR_*` | 执行层 | 见 6.2 节 |
| `METRICS_TOKEN` | 全部 | 指标端点令牌 |
| `LOG_LEVEL` | 全部 | 日志级别，日志格式与 Workspace 一致（pino JSON） |

每个已实现角色提供 `GET /healthz`。当前 healthz 仅检查进程存活，执行层可达性由 verify-uvw doctor 验证；Workspace 版本与 readiness 检查尚未实现。

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
