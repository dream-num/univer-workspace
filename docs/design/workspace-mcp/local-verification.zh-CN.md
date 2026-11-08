# 本地验证环境：Docker 原型与 `verify-uvw` 扩展

> 状态：已评审，2026-11-07。阶段 A 的实现以本文为准。
> 本文是 [阶段计划](stages.zh-CN.md) 阶段 A 交付物 3 的规格，覆盖 D13 的实现方式。
> 文中标注“实测”的结论来自 2026-11-07 的原型，过程和数据见附录 A。原型代码是一次性的，没有提交。
> 初稿经过两名对抗评审者的实测审查，查出的 17 个问题都已在本稿修正，见附录 C。

## 1. 评审确认的决定

2026-11-07 评审。R1 按评审意见改为 opencode，R2 到 R6 采纳原建议。以后推翻其中任何一条，先改本节，再改正文。

| # | 事项 | 决定 | 理由与影响 |
| --- | --- | --- | --- |
| R1 | 用哪个真实 agent 验证 MCP | 一律用本机 opencode，模型 `console-deepseek/deepseek-flash#high`，即 reasoning effort 为 high（界面上显示为 “DeepSeek V4.1 Flash 1017”，provider “Personal / DeepSeek”）。不用 Claude Code。`verify-uvw` 为每次运行生成一个目录，里面只有一个 `opencode.json`，在这个目录里执行 `opencode run` | 评审决定。opencode 的后台服务按目录加载项目配置，所以不需要修改开发者的全局配置（实测，附录 A.6）。阶段 A 验收条目“Claude Code 通过 `verify-uvw env` 给出的 `claude mcp add` 命令连上本地 MCP”相应改写，见第 8 节 |
| R2 | 列表类工具的 `structuredContent` 形状 | 两版协议都返回以名词为键的对象，例如 `repo_list` 返回 `{"repos": [...]}` | 2025-11-25 规定 `structuredContent` 必须是 JSON 对象，2026-07-28 允许任意 JSON 值。工具直接返回数组时，v2 SDK 对 2025-11-25 客户端自动包成 `{"result": [...]}`，对 2026-07-28 客户端保持数组（实测，附录 A.4）。同一个工具的结果形状于是随协议版本变化。显式使用名词键可以让两版协议得到同一个形状。[工具规格](tools.zh-CN.md) 1.2 节“产品命令返回裸对象或数组”需要随本文一起修订。对齐比较因此先在 MCP 一侧取出名词键，见 6.6 节 |
| R3 | MCP SDK | 网关使用 v2 SDK：`@modelcontextprotocol/server` 2.4.0 与 `@modelcontextprotocol/node` 2.1.2。`verify-uvw` 的客户端使用 `@modelcontextprotocol/client` 2.4.0。全部精确版本 | v1 的 `@modelcontextprotocol/sdk` 1.32.2 最高只支持 2025-11-25。v2 用同一个处理函数服务两版协议（实测，附录 A.3） |
| R4 | 开发认证的 session 来源 | `verify-uvw user` 另外调用一次 `POST /api/auth/cli/password/login`，把得到的 session 写入本次运行的 `home/mcp-session`。不读取 `uvw` 的 `session.json` | `session.json` 是 CLI 私有的存储格式（`apps/cli/AGENTS.md`）。独立的 session 让 `uvw auth logout` 之类的 CLI 旅程不会使 MCP 的证据失效。这个路由签发 `agent` 来源的 session，与 `uvw` 相同 |
| R5 | 本地原型支持的 Docker 环境 | 只支持 macOS 上的 Docker Desktop。在其他环境下设置 `VERIFY_UVW_MCP=1` 时，`up` 在启动 Workspace 之前报错退出 | Linux Docker Engine 上，容器无法访问宿主只监听 `127.0.0.1` 的进程。OrbStack 没有实测 |
| R6 | MCP 是否默认启动 | 阶段 A 中 MCP 按需启动：只有设置 `VERIFY_UVW_MCP=1` 时，`up` 才构建镜像并启动网关。不设置时，所有命令与扩展前完全相同 | 默认启动会让现有用法失效：没有 Docker Desktop 的机器上 `up` 直接失败，每次 `up` 多出一次镜像构建，`SKILL.md` 中并行运行的示例会在 3930 端口上冲突。D13 要求“启动验证实例时一起启动 MCP”，在设置这个变量时成立。附录 A.5 测得热构建耗时后，可以再讨论是否改为默认启动。阶段 A 验收条目里的 `verify-uvw up` 相应写作 `VERIFY_UVW_MCP=1 verify-uvw up` |

## 2. 拓扑

```text
宿主 macOS
  Workspace Server   127.0.0.1:3920    verify-uvw 启动，监听地址不变
  Vite（Browser）    127.0.0.1:5973    代理 /api，身份 origin 就是它
  uvw                                  经 5973 访问 Workspace
  verify-uvw mcp 客户端、opencode ──▶ 127.0.0.1:3930/mcp
                                          │ Docker Desktop 端口发布，只绑定 127.0.0.1
Docker Desktop 虚拟机                      ▼
  compose 项目 verify-uvw-<run-id>，默认网络
    gateway 容器  0.0.0.0:3000
      WORKSPACE_ORIGIN        = http://127.0.0.1:5973
      WORKSPACE_TRANSPORT_URL = http://host.docker.internal:3920
        │
        └──▶ host.docker.internal:3920 ──▶ 宿主 127.0.0.1:3920（Workspace Server）
```

端口都可以用环境变量改，见 6.1 节。图中是默认值。

### 2.1 容器访问宿主 Workspace 的方式

这是 [README](README.zh-CN.md) 第 8 节要求回填的事项。结论（实测，附录 A.1、A.2）：

- 容器用 `http://host.docker.internal:<server 端口>` 直接访问 Workspace Server。Docker Desktop 把这个地址转发到宿主的回环接口，Server 不需要改成监听 `0.0.0.0`。
- Server 看到的对端地址是 `127.0.0.1`，`Host` 请求头是 `host.docker.internal:<端口>`。Server 不检查 `Host`、`Origin` 和 `Referer`，响应体里没有依赖 `Host` 的绝对 URL。同一个 session 经容器和经宿主读取 `/api/spaces`，响应字节完全相同。
- 不能经过 Vite（5973）。Vite 的 `server.allowedHosts` 拒绝 `host.docker.internal`，返回 403。本文不修改 `apps/workspace/vite.config.ts`，因为那是产品的开发配置。
- `network_mode: host` 不可用。在 Docker Desktop 上它指向虚拟机自己的回环接口，连接被拒绝。
- compose 默认创建的项目网络（用户自定义 bridge）里，`host.docker.internal` 照常可用，不需要 `extra_hosts`。

Server 只监听 `127.0.0.1` 是有意保留的。改成 `0.0.0.0` 会把带一次性账户的验证实例暴露到局域网。

### 2.2 身份 origin 与传输地址

网关需要 `packages/client-core` 的 C1（[架构](architecture.zh-CN.md) 9.1 节）：

- 身份 origin 是 `$ORIGIN`（`http://127.0.0.1:<web 端口>`），与 `uvw` 的 `workspace.origin` 相同。它用于展示给用户的 URL、仓库引用里的 URL 解析、`Origin` 请求头、运行时 key 和 `whoami` 返回的 `origin`。
- 传输地址只决定 fetch 实际发往哪里。

C1 的要求：`WorkspaceHttp` 内部继续以身份 origin 构造和校验所有 URL，包括 Server 返回的 Asset 签名 URL，只在发出请求的那一刻把 origin 换成传输地址。不传传输地址时，请求与现在逐字节相同。

阶段 A 验证 `WorkspaceHttp` 的请求路径，`whoami`、`repo_list`、`repo_view` 与 `uvw --json` 逐字段相同（附录 C）。D1b 通过 Client Core 的 `transportOrigin` 宿主选项把 HTTP 与协同 WebSocket 都指向容器可达的地址，保留原 Workspace origin 作为产品身份。`doctor` 使用真实会话获取票据并打开协同 WebSocket，见下文。

## 3. 镜像

### 3.1 Dockerfile

`apps/mcp/Dockerfile` 沿用 `apps/workspace/Dockerfile` 的做法：

- 构建上下文是仓库根目录，复用根目录的 `.dockerignore`。
- 基础镜像 `ARG BASE_IMAGE=node:24-bookworm-slim`，与 Workspace 相同，满足根 `package.json` 的 `engines.node >=24`。
- 构建阶段先复制根目录的 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`.npmrc`、`patches/`，以及 `apps/mcp/package.json` 和 `packages/client-core/package.json`。缺少 `patches/` 时，`pnpm install` 在应用 filter 之前就因为找不到补丁文件失败（实测）。
- 然后执行 `pnpm install --frozen-lockfile --filter @univerjs/univer-workspace-mcp...`，再复制源码：根目录的 `tsconfig*.json`，`apps/mcp` 和 `packages/client-core` 的全部非忽略文件（包括 `render-runtime/`），以及 `apps/cli/skill-data`（构建时复制进 `dist/skill-data`，网关运行时不读取 `apps/cli`）。
- 然后执行 `pnpm --filter @univerjs/univer-workspace-mcp... build` 和 `pnpm --filter @univerjs/univer-workspace-mcp deploy --legacy --prod --config.allow-unused-patches=true`，与 Workspace 相同。原生绑定随 `deploy` 进入 `node_modules`，不单独处理（实测：`node:24-bookworm-slim` 中 `deploy` 出的 `client-core` 带 linux-arm64 绑定，可以正常导入）。
- 上面列出的路径就是镜像的构建输入。`verify-uvw` 用同一份路径列表计算源码摘要（6.2 节）。修改 Dockerfile 的 `COPY` 时同步修改这份列表，`apps/mcp/AGENTS.md` 写明这条约束。
- 运行阶段设置 `NODE_ENV=production`、`HOST=0.0.0.0`、`PORT=3000`，以 `node` 用户运行 `node dist/main.js`。阶段 A 不声明 `VOLUME`。
- 不设置 `MCP_ROLE` 的默认值。缺少它或取值未知时，进程报错退出。

包名 `@univerjs/univer-workspace-mcp` 是建议值，与 `@univerjs/univer-workspace`、`@univerjs/univer-workspace-client-core` 一致。

### 3.2 本地构建

- `up` 每次都执行 `docker build -f apps/mcp/Dockerfile -t univer-workspace-mcp:verify-<run-id> .`，依赖 BuildKit 的层缓存加速，不自己判断是否需要重建。
- 构建读取工作区文件，包含未提交的改动。构建开始前，`verify-uvw` 计算构建输入的源码摘要：对 3.1 节路径列表下 `git ls-files -co --exclude-standard` 列出的每个文件，按路径排序后对“路径和内容”整体求 SHA-256。摘要写入 `mcp-build.json`，同时记录 `GIT_HEAD`。
- 镜像带两个 label：`org.opencontainers.image.revision=<GIT_HEAD>`，`dev.univer.verify-uvw.run=<run-id>`。
- 构建输出写入 `logs/mcp-build.log`。
- 冷构建和热构建的耗时在阶段 A 实现后测量，回填到附录 A.5。

## 4. compose 文件

`apps/mcp/docker/compose.verify.yml` 只供 `verify-uvw` 使用。所有取值来自 `verify-uvw` 传入的环境变量，缺少任何一个时 compose 报错：

```yaml
name: ${VERIFY_UVW_MCP_PROJECT:?}
services:
  gateway:
    image: ${VERIFY_UVW_MCP_IMAGE:?}
    environment:
      MCP_ROLE: gateway
      NODE_ENV: development
      MCP_DEV_SESSION_PASSTHROUGH: "1"
      HOST: 0.0.0.0
      PORT: "3000"
      WORKSPACE_ORIGIN: ${VERIFY_UVW_ORIGIN:?}
      WORKSPACE_TRANSPORT_URL: http://host.docker.internal:${VERIFY_UVW_SERVER_PORT:?}
      MCP_PUBLIC_URL: http://127.0.0.1:${VERIFY_UVW_MCP_PORT:?}/mcp
      METRICS_TOKEN: ${VERIFY_UVW_METRICS_TOKEN:?}
      LOG_LEVEL: info
    ports:
      - "127.0.0.1:${VERIFY_UVW_MCP_PORT:?}:3000"
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
      interval: 1s
      retries: 30
```

- 端口只发布在 `127.0.0.1`。
- 不挂载任何卷。阶段 D 引入暂存存储时再加，并且只挂载本次运行目录下的子目录。
- D1b 在同一个文件里增加 `executor`，阶段 E 再增加 `renderer`。它们不发布端口，网关按服务名访问。阶段 E 的“渲染服务没有到 Workspace 的路由”用 `internal: true` 的网络实现，需要届时实测这种网络能否阻断 `host.docker.internal`。
- 容器加固（只读根文件系统、去掉 capability 等）属于阶段 G，本文件不提前加。

D1b 使用同一镜像增加 `executor` 服务，没有 published ports；gateway 通过
`http://executor:3000` 调用，启动依赖 executor healthy。`up` 在本次 run 的
`home/internal-token` 生成 0600 令牌文件，compose 两侧使用同一令牌。
Dockerfile COPY 与 `MCP_BUILD_INPUTS` 路径不变，新增 executor 源文件在原输入目录内。

`doctor` 验证 executor 健康、镜像身份和无发布端口；从 gateway 容器发出无 bearer
和错误 bearer 的 RPC，均应为 401。注册用户后，`diagnostics.probe` 经 transport URL
执行 whoami、获取 session ticket 并打开真实协同 WebSocket。doctor 检查 executor
日志无凭据以及 worker 子进程环境无内部令牌、metrics 令牌、license 和 license key。
MX1 在执行后再次运行 doctor，保留 worker 环境证据。`mcp-logs` 包含两种角色，
`down` 分别保存 gateway 与 executor 日志，并移除整个 compose 项目。

`mcp --expect-event '<jq expression>'` 可对单次调用的事件增加断言。基础规则接受
`cold_start|warm|none`，成本非负，`none` 时全部为 0。MX1 至 MX4 覆盖编辑、CLI 对照、
ready 错误、停机错误和 Browser 截图。

## 5. 网关为本地验证提供的行为

这些行为是 `apps/mcp` 对 `verify-uvw` 的约定。实现与本节不一致时，以修改本节的评审结论为准。

### 5.1 端点

| 端点 | 行为 |
| --- | --- |
| `GET /healthz` | 进程存活即返回 200。不访问 Workspace |
| `GET /metrics` | 行为与 Workspace 的 `METRICS_TOKEN` 相同。未配置令牌时 404，令牌不符时 401 和 `WWW-Authenticate: Bearer`，令牌正确时返回 Prometheus 文本 |
| `POST /mcp`、`GET /mcp` | Streamable HTTP。用 v2 SDK 的 `createMcpHandler` 无状态地服务 2026-07-28 和 2025-11-25 两版协议（R3） |

### 5.2 `/mcp` 的请求检查

网关在把请求交给 SDK 之前依次检查：

1. `Host` 必须等于 `MCP_PUBLIC_URL` 的 host，否则返回 403。请求带 `Origin` 时，它必须等于 `MCP_PUBLIC_URL` 的 origin，否则返回 403。两版协议都要求服务端校验 `Origin`，用来防止 DNS rebinding。
2. 缺少 `Authorization: Bearer <value>` 时，返回 401 和 `WWW-Authenticate: Bearer resource_metadata="<MCP_PUBLIC_URL 的 origin>/.well-known/oauth-protected-resource/mcp"`。
3. （阶段 F）`<value>` 以 `uvw_pat_` 或 `uvw_at_` 开头且配置了机密客户端时，网关把它作为 `subject_token` 做 token exchange，下游只使用换来的短时效 session，scope 来自换取结果；`invalid_grant` 返回与第 2 步相同的 401，其他失败返回 500。其余 Bearer 只在 `MCP_DEV_SESSION_PASSTHROUGH=1` 时按下面的开发认证处理，以 `uvw_pat_`、`uvw_at_` 开头的值永远不会被当作 session。
   开发认证模式下，网关把 `<value>` 当作 Workspace session，以 `cookie: workspace_session=<value>` 调用 `GET /api/session`。响应的 `authenticated` 不为 `true` 时，返回与第 2 步相同的 401。这一步对应 [架构](architecture.zh-CN.md) 4.2 节“token exchange 兼作校验”，阶段 F 用真正的 token exchange 替换它。阶段 A 不缓存校验结果。
4. `?toolsets=` 含未知名字时返回 400，响应体列出合法名字。

### 5.3 请求 ID

- 请求带 `x-request-id` 且符合 `^[a-zA-Z0-9._-]{1,128}$` 时，网关使用它，否则生成 UUID。规则与 Workspace 的 `apps/workspace/server/src/middleware/logging.ts:32-39` 相同。
- 网关在响应头里回写 `x-request-id`，把它作为用量事件的 `request_id`，并在这次请求发往 Workspace 的每个请求上带同一个 `x-request-id`。
- 结果是一次工具调用可以在网关日志和 Workspace 的 `server.log` 里用同一个 ID 找到，`verify-uvw mcp` 依靠这一点收集证据。

### 5.4 用量事件

- 网关只在 stdout 输出日志，格式是 pino JSON。用量事件是其中 `event` 为 `mcp.tool_call` 的行，字段见 [架构](architecture.zh-CN.md) 8.1 节。
- 只为通过认证的 `tools/call` 产生事件。开发认证的 `auth_kind` 和 `client_id` 都是 `dev`；PAT 为 `pat` 与 PAT ID，OAuth access token 为 `oauth` 与 OAuth `client_id`。非执行层工具仍为 `executor: "none"` 且六项 cost 为 0；执行层工具使用 runtime observer 的 `cold_start` 或 `warm`，记录 worker 墙钟毫秒数与提交 revision 数。`none` 必须对应全零 cost。
- 8.1 节的每个字段都必须出现在事件里。下列字段不能为 `null`：`ts`、`request_id`、`user_id`、`auth_kind`、`client_id`、`tool`、`toolset`、`outcome`、`duration_ms`、`executor`、`cost` 及其六个字段。其余字段可以为 `null`，含义如下：

  | 字段 | 为 `null` 的情况 |
  | --- | --- |
  | `trace_id` | 请求的 `_meta` 没有 `traceparent` |
  | `client_name`、`client_version` | 协议为 2025-11-25。无状态服务下 `initialize` 和 `tools/call` 由两个独立实例处理，`tools/call` 拿不到 `clientInfo`（实测）。2026-07-28 的每个请求都在 `_meta` 里带 `clientInfo`，所以不能为 `null` |
  | `repo`、`unit_type` | 工具不涉及仓库或 Unit |
  | `error_code` | `outcome` 不是 `tool_error`。`outcome` 为 `tool_error` 时，它等于工具结果 `structuredContent.code`，不论是否以 `workspace-` 开头。Client Core 会原样传递 Workspace 自己的错误码，例如仓库不存在时的 `NOT_FOUND`，CLI 打印的也是这个码（实测） |

- 2025-11-25 下也想区分客户端，可以在阶段 H 改用 `User-Agent`。阶段 A 不做。
- 认证失败（`outcome: auth_error`）的事件在阶段 F 验收。阶段 A 的客户端在 `initialize` 或 `server/discover` 时就收到 401，请求到不了 `tools/call`。
- 日志里不能出现 Bearer 的值、session 值或工具参数原文。`verify-uvw` 每次调用后都检查这一条，见 6.3 节。

### 5.5 生产环境拒绝开发认证

`NODE_ENV=production` 且 `MCP_DEV_SESSION_PASSTHROUGH` 非空时，网关在监听端口之前退出，退出码非 0，stderr 写明这两个变量。

## 6. `verify-uvw` 命令

### 6.1 新的环境变量与运行记录

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `VERIFY_UVW_MCP` | 不设置 | 只在 `up` 时读取。`1` 表示本次运行启动 MCP（R6）。不设置或取其他值时不启动，所有现有命令的行为和输出与扩展前相同，MCP 命令报错退出 |
| `VERIFY_UVW_MCP_PORT` | `3930` | 网关发布到宿主的端口。启动 MCP 的并行运行要与 `VERIFY_UVW_SERVER_PORT`、`VERIFY_UVW_WEB_PORT` 一起指定。`SKILL.md` 的“Parallel runs”一节补上这个变量 |

`run.env` 增加以下变量，`down` 之后保留：

| 变量 | 内容 |
| --- | --- |
| `MCP_ENABLED` | `0` 或 `1`。扩展之前创建的运行没有这个变量，脚本按 `${MCP_ENABLED:-0}` 读取，所以 `doctor` 和 `down` 照常处理旧运行 |
| `MCP_PORT` | 发布端口 |
| `MCP_PROJECT` | `verify-uvw-<run-id>`。只在启动 MCP 时检查 run id 是否符合 compose 项目名规则（`^[a-z0-9][a-z0-9_-]*$`），不符合时 `up` 在启动 Workspace 之前报错 |
| `MCP_IMAGE`、`MCP_IMAGE_ID` | 本次运行的镜像 tag 和镜像 ID |

本次运行目录增加：

| 路径 | 内容 | `down` 之后保留 |
| --- | --- | --- |
| `home/mcp-session` | 开发认证用的 session 值（R4），权限 0600 | 否 |
| `home/opencode-<随机后缀>/opencode.json` | opencode 的项目配置（R1），权限 0600。每次 `user` 换一个新目录 | 否 |
| `home/opencode-dir` | 当前 opencode 目录的路径 | 否 |
| `home/metrics-token` | `up` 随机生成的指标令牌，权限 0600 | 否 |
| `home/mcp-oauth-secret` | `up` 随机生成的网关机密客户端密钥（阶段 F），权限 0600。同一个值写入 Workspace 的 `OAUTH_CLIENTS_JSON` 和网关的 `MCP_OAUTH_CLIENT_SECRET` | 否 |
| `home/mcp-token`、`home/mcp-token-id` | `mcp-token` 创建的 PAT（权限 0600）及其 ID。`user` 默认创建一个 | 否 |
| `mcp-build.json` | 构建开始时间、`GIT_HEAD`、构建输入的源码摘要、镜像 ID | 是 |
| `logs/mcp-build.log` | `docker build` 输出 | 是 |
| `logs/mcp-gateway.log` | `down` 时导出的网关完整日志 | 是 |

### 6.2 现有命令的变化

**`up`。** 不设置 `VERIFY_UVW_MCP=1` 时与现在完全相同。设置时，在现有步骤前后增加：

1. 预检。`docker info` 能连上，`OperatingSystem` 是 `Docker Desktop`，`MCP_PORT` 空闲，run id 符合项目名规则。任何一项不满足都在启动 Workspace 之前退出，并给出修复方法。
2. 照旧启动 Workspace Server 和 Vite，等待就绪。
3. 计算源码摘要，写入 `mcp-build.json`，再执行 3.2 节的构建。构建失败时输出日志末尾 40 行，以非 0 退出，提示先 `down`。这时 Workspace 仍在运行，与现在 Vite 启动失败时的处理一致。
4. 生成 `home/metrics-token`，以 6.1 节的变量执行 `docker compose -p $MCP_PROJECT -f apps/mcp/docker/compose.verify.yml up -d --wait --wait-timeout 60`。
5. 在宿主上等待 `http://127.0.0.1:$MCP_PORT/healthz` 返回 200。
6. 就绪输出增加一行 `mcp:      http://127.0.0.1:<port>/mcp`。

**`doctor`。** `MCP_ENABLED` 不为 `1` 时，输出和退出码与现在相同。为 `1` 时增加下列检查，每项一行 `ok` 或 `FAIL`。新增的每条 `docker` 命令都要处理失败，失败时输出 `FAIL` 行并继续，不能让 `set -e` 提前结束脚本：

| 检查 | 失败时的提示 |
| --- | --- |
| `docker info` 可用，且是 Docker Desktop | 启动 Docker Desktop |
| 按 3.2 节重新计算的源码摘要等于 `mcp-build.json` 中的值。增加、删除、修改任何构建输入（包括 `package.json`、`pnpm-workspace.yaml`、`tsconfig*.json`、`render-runtime/`）都会改变摘要 | 镜像与工作区不一致：`down`，然后 `up` |
| 项目里 `gateway` 容器在运行且健康，镜像 ID 等于 `MCP_IMAGE_ID` | `down`，然后 `up` |
| `docker compose port gateway 3000` 等于 `127.0.0.1:$MCP_PORT`，宿主上 `/healthz` 返回 200 | 端口被占用或映射错误 |
| 容器的 `WORKSPACE_ORIGIN` 等于 `$ORIGIN`，`WORKSPACE_TRANSPORT_URL` 指向本次运行的 Server 端口 | 配置漂移：`down`，然后 `up` |
| 在容器内请求 `$WORKSPACE_TRANSPORT_URL/api/session` 返回 200 | 容器访问不到宿主 Workspace，见 2.1 节 |
| 不带令牌请求 `/metrics` 返回 401，带 `home/metrics-token` 的值返回 200 | 网关指标未受保护或令牌未生效 |
| `user` 之后：经 MCP 调用 `whoami`（不记录证据）返回本次运行的用户 | 运行 `user` |
| `user` 之后：网关日志不包含 `home/mcp-session` 的值 | 网关泄露了凭据，这是阻断性缺陷 |

端口归属的检查方式与 Workspace 不同。宿主上监听 `MCP_PORT` 的是 Docker Desktop 的后台进程，不是本次运行启动的 PID，所以改用 compose 的端口映射和镜像 ID 证明归属。

**`up`（阶段 F）。** 启动 MCP 时，Workspace Server 的 `OAUTH_CLIENTS_JSON` 带一个机密客户端 `univer-workspace-mcp-gateway`（`tokenExchange: true`、随机密钥、`redirectUris: ["http://127.0.0.1/unused"]`、`scopes: ["identity"]`），网关容器收到 `MCP_OAUTH_CLIENT_ID` 和 `MCP_OAUTH_CLIENT_SECRET`，同时保留 `MCP_DEV_SESSION_PASSTHROUGH=1`。

**Workspace MCP OAuth 授权。** 仅在 MCP 启用时，`up` 在 Server 的 `env -i` 环境中增加
`MCP_RESOURCE_URLS=http://127.0.0.1:<MCP_PORT>/mcp` 和
`PUBLIC_ORIGIN=http://127.0.0.1:<WEB_PORT>`，取值随本次运行的端口变化。前者声明 MCP
资源，后者作为 OAuth issuer 和浏览器授权地址的 origin。MO1 要求 Server 包含 PR #216 的
MCP OAuth 授权实现；没有该实现的 Server 会忽略这两个变量，不能通过 MO1。授权服务器元数据
通过 Vite 的 `$ORIGIN/.well-known/oauth-authorization-server` 读取。

**`doctor`（阶段 F）。** 增加两项：用 PAT 经网关调用 `whoami` 返回本次运行的用户（证明 token exchange 可用）；网关日志不包含 session、PAT 和网关密钥。

**`user`。** 现有行为不变。`MCP_ENABLED=1` 时再执行下列步骤，重复运行会覆盖旧的 session；PAT 已存在时不重新创建：

1. 用本次运行的用户名和 `user.pw` 调用 `POST $ORIGIN/api/auth/cli/password/login`，从 `Set-Cookie` 里取出 `workspace_session` 的值，写入 `home/mcp-session`。
2. 新建目录 `home/opencode-<8 位十六进制随机数>`，写入下面的 `opencode.json`，再把目录路径写入 `home/opencode-dir`：

```json
{"$schema":"https://opencode.ai/config.json",
 "mcp":{"verify-uvw":{"type":"remote","url":"http://127.0.0.1:3930/mcp","enabled":true,"headers":{"Authorization":"Bearer <home/mcp-session 的值>"}}},
 "permission":{"edit":"deny","bash":"deny","webfetch":"deny"}}
```

3. `home/mcp-token` 不存在时执行一次 `mcp-token`。

每次换新目录，是因为 opencode 的后台服务按目录缓存配置。同一个目录里改写 `opencode.json` 后，后台服务仍然使用旧配置（实测）。`permission` 禁止编辑文件、执行命令和抓取网页，模型只能调用 MCP 工具。不使用 `--auto`，因为它会自动批准模型的全部操作。

**`env`。** `MCP_ENABLED=1` 时增加：

```bash
export MCP_URL=http://127.0.0.1:3930/mcp
export MCP_PROJECT=verify-uvw-<run-id>
export MCP_IMAGE=univer-workspace-mcp:verify-<run-id>
export MCP_OPENCODE_DIR=/tmp/verify-uvw/<run-id>/home/opencode-<随机后缀>
export MCP_OPENCODE_MODEL=console-deepseek/deepseek-flash#high
# opencode: (cd "$MCP_OPENCODE_DIR" && opencode run --format json -m "$MCP_OPENCODE_MODEL" "<prompt>" < /dev/null)
```

不用 `--standalone`，也不自己启动 `opencode serve`。opencode 2.0.26 的这两种私有服务在本机启动后不监听端口、不写日志，并且不响应 SIGTERM，只能用 `kill -9` 结束（实测）。所以只用后台服务。

**`down`。** `MCP_ENABLED=1` 时，在现有步骤之前执行下列步骤。任何一步失败都只警告，不中断后面的清理：

1. `docker compose -p $MCP_PROJECT logs --no-color --timestamps > logs/mcp-gateway.log`。
2. `docker compose -p $MCP_PROJECT -f apps/mcp/docker/compose.verify.yml down --volumes --remove-orphans`。
3. `docker image rm univer-workspace-mcp:verify-<run-id>`，只删除这个 tag。构建缓存保留，供下次构建使用。
4. 按 label `com.docker.compose.project=$MCP_PROJECT` 列出剩余的容器、网络和卷，镜像按 tag 列出。全部为空时输出 `ok    MCP resources removed`，否则逐个列出并给出删除命令。

`down` 只操作带本次项目 label 或本次 tag 的资源，不执行 `docker system prune`，也不按名字或端口删除容器。

### 6.3 `mcp`

```text
verify-uvw mcp [--protocol 2026-07-28|2025-11-25] [--auth pat|dev|none|invalid] [--toolsets <list>] <label> <tool> [<json 参数>]
```

- `label` 必须符合 `^[A-Za-z0-9._-]{1,64}$`。`json 参数` 默认 `{}`，必须是 JSON 对象。
- `--protocol` 默认 `2026-07-28`。opencode 2.0.26 只协商 2025-11-25（实测），2026-07-28 只能由 `verify-uvw` 自己的客户端覆盖，所以默认测它。`2026-07-28` 用 `versionNegotiation: { mode: { pin: '2026-07-28' } }`。`2025-11-25` 用默认的 `legacy` 模式，连接后核对协商结果，不是 `2025-11-25` 就按传输错误处理。
- `--auth pat` 读取 `home/mcp-token` 作为 Bearer，事件必须是 `auth_kind: pat` 且 `client_id` 等于 `home/mcp-token-id`。`home/mcp-token` 存在时这是默认值，否则默认 `dev`。`mcp-tools` 同样按此选择。
- `--auth dev` 读取 `home/mcp-session` 作为 Bearer，事件必须是 `auth_kind: dev`、`client_id: dev`。`none` 不带 `Authorization`。`invalid` 带一个随机值。
- `--toolsets` 原样放进 URL 的 `?toolsets=`。
- 每次调用生成 `x-request-id`：`<label>.<8 位十六进制随机数>`。

实现是 `.agents/skills/verify-uvw/bin/mcp-call.mjs`，由 `verify-uvw` 用 `node` 调用。它用 `createRequire(apps/mcp/package.json)` 解析 `@modelcontextprotocol/client`，保证客户端版本就是 `apps/mcp` 锁定的版本。`apps/mcp` 把它列为 devDependency。

`mcp-call.mjs` 给 `StreamableHTTPClientTransport` 传入一个包装过的 `fetch`，记录每个响应的状态码、`WWW-Authenticate` 和非 2xx 时的响应体。必须这样做，因为 SDK 的错误对象不带响应头，并且错误码不可靠（实测）：

- 2026-07-28 下的 401 报为 `CLIENT_HTTP_AUTHENTICATION`，2025-11-25 下的同一个 401 报为 `CLIENT_HTTP_NOT_IMPLEMENTED`。
- 2026-07-28 的 pin 模式下，`?toolsets=nope` 的 400 只报为 `ERA_NEGOTIATION_FAILED`，状态码和响应体都丢失。

所以退出码按包装层记录的 HTTP 状态判断，不按 SDK 的错误码判断。

证据写入 `$EVIDENCE`，与 `cli` 命令的文件名对齐：

| 文件 | 内容 |
| --- | --- |
| `<label>.cmd` | `verify-uvw mcp` 的完整调用、MCP URL、协议版本、认证方式。不含任何凭据 |
| `<label>.out` | 成功时是 `structuredContent`，两格缩进的 JSON。HTTP 非 2xx 时是 `{"status":<状态码>,"www_authenticate":<值或 null>,"body":<响应体文本>}` |
| `<label>.result.json` | 完整的 `CallToolResult`，加上协商出的协议版本和 `x-request-id` |
| `<label>.err`、`<label>.exit` | stderr 和退出码 |
| `<label>.event.json` | 网关日志中 `request_id` 等于本次 ID 的 `mcp.tool_call` 事件 |
| `<label>.gateway.log` | 网关日志中带本次 ID 的全部行 |
| `<label>.workspace.log` | `logs/server.log` 中 `req.id` 等于本次 ID 的全部行。开发认证模式下每次调用都会访问 Workspace（5.2 节第 3 步），所以这个文件为空就按证据不合格处理（退出码 5）。PAT 认证下，命中交换缓存且不需要 Workspace 的调用（参数错误、scope 不足、`tools/list`、`whoami`）合法地没有 Workspace 请求，这个文件可以为空 |

退出码：

| 码 | 含义 |
| --- | --- |
| 0 | 工具成功，证据齐全 |
| 1 | 工具返回 `isError: true` |
| 2 | 用法错误 |
| 3 | 协议或传输错误：连接失败、JSON-RPC 错误、协议版本不符、401 以外的 HTTP 非 2xx |
| 4 | HTTP 401，与 `uvw` 的退出码 4 含义相同 |
| 5 | 工具调用已完成（退出码本应是 0 或 1），但证据不合格：缺少用量事件，事件不符合 5.4 节，`.workspace.log` 为空，或者网关日志里出现了本次使用的 Bearer 值 |

退出码 5 让每一次工具调用都自动核对用量事件和凭据泄露，成功和失败的调用都包括在内，后续阶段不需要另写检查。

### 6.3.1 `mcp-token`

```text
verify-uvw mcp-token [--scopes read,write,...] [--name <名称>]
```

用 `home/mcp-session` 的会话调用 `POST $ORIGIN/api/auth/tokens`（`{ name, scopes? }`，缺省名称 `verify-uvw-<run-id>`，缺省全部 scope），把明文 PAT 写入 `home/mcp-token`、PAT ID 写入 `home/mcp-token-id`（均为 0600，覆盖旧值），只向标准输出打印 PAT ID。吊销用同一个会话调用 `DELETE $ORIGIN/api/auth/tokens/<id>`。

### 6.4 `mcp-tools`

```text
verify-uvw mcp-tools [--protocol …] [--toolsets <list>] <label>
```

调用 `tools/list`。`<label>.out` 是工具数组，每项保留 `name`、`description`、`annotations`、`inputSchema`、`outputSchema`，顺序与服务端返回的顺序一致。其他证据文件与 `mcp` 相同，没有 `.event.json`。

### 6.5 `mcp-logs`

```text
verify-uvw mcp-logs
```

输出网关当前的日志，即 `docker compose logs --no-color --no-log-prefix gateway`。用于查找不由 `verify-uvw mcp` 发起的调用，例如 opencode 的调用。

### 6.6 MCP 结果与 CLI 结果的比较

阶段 A 不提供专门的比较命令，比较写在 `features/mcp.md` 里，用 `jq` 完成：

1. 在 MCP 一侧取出名词键（R2），例如 `repo_list` 的 `.repos`。CLI 一侧原样使用，`uvw repo list --json` 本来就是数组。
2. 删除 MCP 一侧每个对象上的 `url` 字段（[工具规格](tools.zh-CN.md) 1.2 节）。CLI 的输出没有 `url` 字段（实测）。
3. 两边都用 `jq -S` 排序后 `diff`。

阶段 B 有约 30 个工具要做同样的比较，届时把这三步收进一个脚本，并把工具规格第 4 节的有意差异写成脚本里的显式列表。

## 7. `features/mcp.md`

新增 `features/mcp.md`，遵守 `features/README.md` 的格式约定（一个 H1、一段用户可见行为、四个固定的 H2），并在 `features/README.md` 的功能列表里加一行。阶段 A 的旅程如下，每步的证据名用 `mcp-<步骤>` 前缀。

| # | 步骤 | 命令要点 | 通过条件 |
| --- | --- | --- | --- |
| M1 | 环境 | `VERIFY_UVW_MCP=1 $V up`，`$V user`，`$V doctor > $EVIDENCE/mcp-doctor.txt; echo $? > $EVIDENCE/mcp-doctor.exit` | 退出码 0，没有 `FAIL` 行，6.2 节表中的每一项都有对应的 `ok` 行 |
| M2 | 身份，新协议 | `$V mcp mcp-whoami whoami`，`$V cli mcp-whoami-cli auth status --json` | 退出码 0。两个 `.out` 的 `subject` 相同，MCP 一侧的 `origin` 等于 `$ORIGIN`，不是 `host.docker.internal`。`.event.json` 的 `client_name` 不为 `null` |
| M3 | 身份，旧协议 | `$V mcp --protocol 2025-11-25 mcp-whoami-legacy whoami` | 退出码 0，`.result.json` 的协议版本是 `2025-11-25`，`.out` 与 M2 相同，`.event.json` 的 `client_name` 为 `null` |
| M4 | 仓库列表 | 先按 `features/issues.md` 建一个 Team Space，再 `$V mcp mcp-repo-list repo_list`，`$V cli mcp-repo-list-cli repo list --json` | 退出码 0。按 6.6 节比较没有差异，列表里有 Personal 和 Team 两种 Space |
| M5 | 仓库详情 | 对 Personal 和 Team Space 各执行一次 `repo_view`（参数 `{"repo":"<owner>/<slug>"}`）和 `$V cli … repo view <owner>/<slug> --json`。仓库引用必须写在 `--json` 前面，否则 `--json` 会把它当成字段列表 | 退出码 0，按 6.6 节比较没有差异 |
| M6 | 工具失败 | `$V mcp mcp-repo-missing repo_view '{"repo":"verify-<run-id>/no-such-repo"}'`，`$V cli mcp-repo-missing-cli repo view verify-<run-id>/no-such-repo --json` | MCP 退出码 1，CLI 退出码 1。`.out` 的 `code` 等于 CLI stderr 开头的错误码。`.event.json` 的 `outcome` 为 `tool_error`，`error_code` 等于同一个错误码 |
| M7 | 工具列表 | `$V mcp-tools mcp-tools-core`，`$V mcp-tools --toolsets all mcp-tools-all`，`$V mcp-tools --toolsets nope mcp-tools-unknown` | 前两次退出码 0，都只有 `whoami`、`repo_list`、`repo_view`，顺序固定，三个注解齐全。第三次退出码 3，`.out` 的 `status` 为 400，`body` 列出合法的 toolset |
| M8 | 未认证 | `$V mcp --auth none mcp-unauth whoami`，`$V mcp --auth invalid mcp-badtoken whoami`，两种协议各一次 | 四次退出码都是 4，`.out` 的 `status` 为 401，`www_authenticate` 含 `resource_metadata` |
| M9 | Origin 校验 | `curl -sS -o /dev/null -w '%{http_code}' -H 'Origin: http://evil.example' -H "Authorization: Bearer $(cat <run>/home/mcp-session)" -X POST "$MCP_URL"`，输出写入 `mcp-origin.txt` | 403 |
| M10 | 生产环境拒绝 | `cid=$(docker run -d --network none -e MCP_ROLE=gateway -e NODE_ENV=production -e MCP_DEV_SESSION_PASSTHROUGH=1 "$MCP_IMAGE")`，每秒查一次 `docker inspect -f '{{.State.Running}}' $cid`，最多 20 秒。然后把 `docker logs $cid` 和 `{{.State.ExitCode}}` 写入 `mcp-prod-refuse.{out,exit}`，最后 `docker rm -f $cid`。macOS 默认没有 `timeout` 命令，所以不用它 | 20 秒内容器已停止，退出码非 0，日志提到两个变量名 |
| M11 | opencode | 记下当前时间，`(cd "$MCP_OPENCODE_DIR" && opencode run --format json -m "$MCP_OPENCODE_MODEL" "Call the whoami tool from the verify-uvw MCP server once and reply with its result." < /dev/null) > $EVIDENCE/mcp-opencode-whoami.jsonl`，退出码写入 `mcp-opencode-whoami.exit`。再从 `$V mcp-logs` 取出这个时间之后 `tool` 为 `whoami` 的事件，写入 `mcp-opencode-whoami.event.json` | 退出码 0。有一个 `tool_use` 片段的 `part.state.metadata.metadata.toolCalls` 包含 `{"tool":"verify-uvw.whoami","status":"completed"}`，它的输出含本次运行的用户名。恰好一条对应事件，`outcome` 为 `ok`，`client_name` 为 `null`（opencode 使用 2025-11-25，见 5.4 节） |
| M12 | 清理 | 记下开发者 3020、5173 上监听进程的 PID，`$V down \| tee $EVIDENCE/mcp-down.txt`，再查一次 PID | `down` 输出 `ok    MCP resources removed`。开发者实例的 PID 前后相同，或者前后都不存在 |

阶段 F 增加认证旅程 MA1 到 MA5。M2 到 MS11 默认用 PAT 认证，事件期望从 `dev` 改为 `pat`；M9 和 M11 仍用开发 session。

| # | 步骤 | 通过条件 |
| --- | --- | --- |
| MA1 | 默认 PAT 调用 `whoami` | 退出码 0，事件 `auth_kind` 为 `pat`，`client_id` 等于 `home/mcp-token-id` |
| MA2 | `curl` 取 `/.well-known/oauth-protected-resource/mcp` | 200，`resource` 等于 `$MCP_URL`，`authorization_servers` 等于 `[$ORIGIN]`，带 `Cache-Control: public, max-age=300` |
| MA3 | `$V mcp-token --scopes read` 后调用 `issue_create` | 退出码 1，`.out` 的 `code` 为 `workspace-scope-required`，事件 `error_code` 相同 |
| MA4 | 吊销 PAT（`DELETE /api/auth/tokens/<id>`）后再调用一次 | 退出码 4，`status` 为 401（网关缓存最多 30 秒；吊销会删除下游 session，下一次工具调用得到 401 并驱逐缓存） |
| MA5 | `--auth dev` 调用 `whoami` | 退出码 0，事件 `auth_kind` 为 `dev`，`client_id` 为 `dev` |
| MO1 | opencode 只配置 MCP URL，通过浏览器授权后调用 `whoami` 和 `repo_list` | 未认证 POST 返回 401 和资源元数据 challenge；资源与授权服务器元数据匹配本次运行；授权页显示四个 scope；取消 `worktree:merge` 后 callback 只含 `read write publish`；opencode 输出 `Connected to ws`，run 退出码 0；两条工具事件的 `auth_kind` 为 `oauth`，`client_id` 等于 authorize URL 中动态注册的客户端，`user_id` 等于本次用户，`outcome` 为 `ok` |

MO1 的完整 Bash 脚本位于 [MCP 旅程](../../../.agents/skills/verify-uvw/features/mcp.md)，放在
MA5 后、M12 前。它在 `$RUN/home` 下新建临时目录，写入无 Authorization header 的 `ws`
配置，并将 `XDG_DATA_HOME`、`XDG_CONFIG_HOME`、`XDG_STATE_HOME`、`XDG_CACHE_HOME`
全部指向该目录。脚本选择空闲端口，通过 `opencode service set port <port>` 配置独立的托管服务，
避免连接开发者默认的 49374 服务。`opencode mcp auth ws --print-logs < /dev/null` 在后台等待，
agent-browser 使用本次运行的 session，以 `user.pw` 登录后打开日志中的 authorize URL。
保存取消合并权限后的 `mcp-oauth-consent.png`、脱敏的授权与 callback URL、opencode 输出、退出码
和 `mcp-oauth-events.json`。原始输出和 OAuth 存储只存在权限受限的临时目录；EXIT、INT、TERM
trap 停止 auth 进程和独立服务，脱敏 code、token 和 state，再删除临时目录，失败时也执行。
不把 MO1 的独立 XDG 配置用于 M11；M11 保留开发 session 路径。

opencode 的 `--format json` 输出只有 `step_start`、`tool_use`、`text`、`step_finish` 四类片段，不含开发者的插件、skills 或凭据（实测），所以整份保存。opencode 把 MCP 工具包在代码模式的 `execute` 工具里调用，所以检查 `toolCalls`，不检查 `tool_use` 的工具名。M11 的会话会进入开发者本机 opencode 的会话历史；MO1 的会话历史保存在独立 XDG 目录，随 trap 清理。

M2 到 M6 的每次工具调用都由 6.3 节的退出码 5 自动核对用量事件和凭据，成功（M2 到 M5）和失败（M6）两种结果都包括在内。M11 的事件由人工核对。所以“每次工具调用都产生一条字段齐全的事件”由这些步骤共同证明，不单列一步。M7 和 M8 不产生事件，因为请求没有到达 `tools/call`。

## 8. 阶段 A 验收条目与证据的对应

| 验收条目（[阶段计划](stages.zh-CN.md)） | 证据 |
| --- | --- |
| `up` 同时启动 Workspace 和网关，`doctor` 全部通过 | M1。按 R6 写作 `VERIFY_UVW_MCP=1 verify-uvw up` |
| `mcp whoami` 返回本次运行的用户 | M2、M3 |
| `repo_list` 与 `uvw repo list --json` 一致 | M4，按 R2 和 6.6 节比较 |
| 真实 agent 连上本地 MCP 并调用 `whoami` | M11。按 R1 用 opencode 和 `console-deepseek/deepseek-flash#high`，不用 Claude Code |
| 不带 Bearer 得到 401 和 `WWW-Authenticate` | M8 |
| 生产环境拒绝开发认证 | M10 |
| 每次工具调用产生一条字段齐全的事件 | M2 到 M6 的 `.event.json` 和不为 5 的退出码，M11 的事件 |
| `down` 清理干净，不影响开发者实例 | M12 |
| CLI 测试与打包验证通过，产物不含 `apps/mcp` | 不在 `verify-uvw` 里，输出都保存到 `$EVIDENCE/mcp-cli-package.txt`。执行 `pnpm --filter univer-workspace-cli test` 和 `pnpm package:workspace-cli`。确认 `apps/cli/package-dist` 存在，再在其中搜索 `@univerjs/univer-workspace-mcp`、`@modelcontextprotocol` 和 `MCP_DEV_SESSION_PASSTHROUGH`，结果为空。目录不存在时这一条不通过 |
| C1 的默认行为不变（[README](README.zh-CN.md) 4.1 节） | `pnpm --filter univer-workspace-cli test` 不运行 `packages/client-core/test`，所以另外执行 `pnpm --filter @univerjs/univer-workspace-client-core test`，其中包含 C1 新增的测试：不传传输地址时请求 URL 和请求头与改动前相同 |
| `verify-uvw` 的 CLI 旅程结果与改动前一致（README 4.1 节） | 不设置 `VERIFY_UVW_MCP` 跑一遍 `features/README.md` 列出的旅程，证据与改动前的一次运行对照 |

按 R1、R2、R6，同一个 PR 同步修改了需求文档：`stages.zh-CN.md` 阶段 A 的条目改用 opencode 和 `VERIFY_UVW_MCP=1`，`repo_list` 的“一致”注明按 6.6 节比较；`tools.zh-CN.md` 1.2 节改为列表结果以名词为键；README 的决策表增加 D14。

## 9. 不变的部分

- 不设置 `VERIFY_UVW_MCP=1` 时，`up`、`doctor`、`user`、`env`、`cli`、`uvw`、`down` 的行为、输出和退出码与扩展前完全相同，扩展前创建的运行也照常处理。
- 设置时，现有输出行保持原样，只增加新行。`features/` 下现有的旅程不需要修改。
- 不修改 `apps/workspace`、`apps/cli` 和 `apps/workspace/vite.config.ts`。
- Workspace Server 仍然只监听 `127.0.0.1`。

## 10. 留给后续阶段

| 事项 | 阶段 |
| --- | --- |
| 暂存目录挂载（executor 与容器内 HTTP / 协同 WebSocket doctor 已在 D1b 实现） | D |
| compose 增加 `renderer`；实测 `internal: true` 网络能否阻断 `host.docker.internal` | E |
| `verify-uvw mcp-token` 生成 PAT，`mcp --auth pat`；认证失败事件的验收；本地验证默认改用 PAT | F |
| 容器加固与沙箱运行时 | G |
| 把 6.6 节的比较步骤收进脚本 | B |

## 附录 A. 原型实测（2026-11-07）

环境：macOS，Docker Desktop，Engine 24.0.5（linux/arm64），客户端 29.8.2，Claude Code 2.1.301，opencode 2.0.26。
Workspace 用 `verify-uvw` 启动在 3921/5974（3920/5973 被另一个会话的运行占用），`VERIFY_UVW_ROOT=/tmp/verify-uvw-mcpproto`。容器使用 `node:22-bookworm-slim`。

### A.1 容器访问宿主回环接口

宿主上用 Node 起一个只监听 `127.0.0.1:39201` 的 HTTP 服务，回显 `Host` 和对端地址：

| 方式 | 结果 |
| --- | --- |
| 默认 bridge，`http://host.docker.internal:39201` | 成功。`host` 为 `host.docker.internal:39201`，对端 `127.0.0.1` |
| `--add-host=host.docker.internal:host-gateway` | 成功，结果同上 |
| 用户自定义网络（compose 默认） | 成功，结果同上 |
| `--network host`，`http://127.0.0.1:39201` | `ECONNREFUSED` |
| OrbStack 上下文 | 未测，OrbStack 没有运行 |

### A.2 容器访问真实的 Workspace Server

`verify-uvw up` 和 `user` 之后，用 `uvw` 的 session cookie 从容器请求：

| 请求 | 结果 |
| --- | --- |
| `host.docker.internal:3921/api/session`，带 cookie | 200，`authenticated: true` |
| `host.docker.internal:3921/api/spaces`，带 cookie | 200，与宿主经 5974 的响应逐字节相同 |
| `host.docker.internal:3921/api/spaces`，不带 cookie | 401 |
| `host.docker.internal:5974/api/session` | 403，`Blocked request. This host ("host.docker.internal") is not allowed.` |

### A.3 v2 SDK 同时服务两版协议

宿主上用 `@modelcontextprotocol/server` 2.4.0 的 `createMcpHandler` 加 `@modelcontextprotocol/node` 2.1.2 的 `toNodeHandler` 起服务，在交给 SDK 之前检查 Bearer。客户端用 `@modelcontextprotocol/client` 2.4.0：

| 客户端设置 | 协商结果 | 服务端看到的 `MCP-Protocol-Version` |
| --- | --- | --- |
| `mode: 'legacy'` | `2025-11-25`，era `legacy` | `2025-11-25`，含一次 `GET /mcp` |
| `mode: { pin: '2026-07-28' }` | `2026-07-28`，era `modern` | `2026-07-28` |
| `mode: 'auto'` | `2026-07-28`，era `modern` | `2026-07-28` |
| 不带 `Authorization` 的 `POST /mcp` | 401，`WWW-Authenticate` 原样返回 | 请求没有到达 SDK |
| Claude Code 2.1.301，`--mcp-config` 带 `headers`（R1 之前的方案，已不使用） | 调用成功，Bearer 原样到达 | `2026-07-28` |
| opencode 2.0.26，目录级 `opencode.json`，`type: remote` 带 `headers` | 调用成功，Bearer 原样到达，`initialize` 的 `clientInfo` 为 `{"name":"opencode","version":"2.0.26"}` | `2025-11-25`，含一次 `GET /mcp` |

v1 的 `@modelcontextprotocol/sdk` 最新版是 1.32.2，`SUPPORTED_PROTOCOL_VERSIONS` 最高到 `2025-11-25`。

### A.4 `structuredContent` 的形状

- 2025-11-25 的 tools 规范：“Structured content is returned as a JSON object in the `structuredContent` field of a result.”
- 2026-07-28 的 tools 规范：“This can be any JSON value (object, array, string, number, boolean, or null) that conforms to the tool's `outputSchema` if one is defined.”，并给出了数组 `outputSchema` 的示例。
- v2 SDK 接受数组 `outputSchema`，并按协议版本改写结果。同一个返回数组的工具，2025-11-25 客户端收到 `{"result":[{"id":"a"}]}`，`tools/list` 里的 `outputSchema` 也被改成 `object`。2026-07-28 客户端收到 `[{"id":"a"}]`（评审者实测，本文作者复现）。
- 所以数组结果不会让 2025-11-25 客户端出错，但同一个工具在两版协议下形状不同。R2 用显式名词键消除这个差异，M3 才能要求两版协议的 `.out` 相同。

### A.5 阶段 A 实现后的测量（2026-11-08）

每项只测了一次，是单次观测，不是统计值：

| 项目 | 值 |
| --- | --- |
| 镜像冷构建耗时（`--no-cache`） | 未测得。两次尝试都在下载 npm 依赖时超时（分别在 226 秒和 301 秒失败） |
| 只改 `apps/mcp/src` 后的热构建耗时 | 140 秒。依赖安装层命中缓存，`pnpm deploy` 一步重新解析并链接生产依赖，占了大部分时间 |
| 构建输入完全不变时的构建耗时 | 11 秒 |
| `VERIFY_UVW_MCP=1 verify-uvw up` 全程 | 88 秒，其中包括 rebase 改动源码时间戳之后的镜像重建 |
| `docker compose up` 到 `/healthz` 返回 200 的耗时 | 1.9 秒 |
| 镜像大小 | 729,493,628 字节（696 MiB） |

热构建的 140 秒主要花在 `pnpm deploy` 上。如果它拖慢日常验证，可以把 `deploy` 拆到只依赖 manifest 的一层，再单独复制构建产物。这是可选的优化，阶段 A 没有做。

### A.6 opencode

opencode 2.0.26，模型 `console-deepseek/deepseek-flash`，对 A.3 的临时 MCP 服务（记录每个请求的方法、协议版本和 `clientInfo`）：

| 做法 | 结果 |
| --- | --- |
| 在只含 `opencode.json` 的新目录里执行 `opencode run --format json`，经后台服务 | 成功。请求依次为 `initialize`（`clientInfo` 为 `opencode` 2.0.26）、`notifications/initialized`、`GET /mcp`、`tools/list`、`tools/call`，协议 2025-11-25 |
| 同一个目录改写 `opencode.json` 后再运行 | 后台服务沿用旧配置，MCP 服务没有收到请求 |
| `opencode.json` 里用 `"tools": {"*": false, "verify-uvw_*": true}` 只放行 MCP 工具 | MCP 工具也被关掉，模型回答“没有可用的工具” |
| `opencode run --standalone`，带或不带自定义配置 | 卡住，没有输出，90 秒后被 `timeout` 结束 |
| `opencode serve --port …` | 不监听端口，日志为空，不响应 SIGTERM，只能 `kill -9` |
| `--format json` 的输出 | 只有 `step_start`、`tool_use`、`text`、`step_finish`。工具调用记录在 `tool_use` 的 `part.state.metadata.metadata.toolCalls`，例如 `{"tool":"verify-uvw.whoami","status":"completed"}`。搜索 `skills`、`memory`、`hook`、`apiKey` 都没有结果 |

模型在一次运行里把 bash 调用当作纯文本输出，没有形成工具调用。`permission` 禁止了 bash，所以这个错误不会产生副作用，只会让那次运行失败。M11 的通过条件看 `toolCalls`，不看模型的文字。

## 附录 B. 放弃的做法

| 做法 | 放弃的原因 |
| --- | --- |
| Workspace Server 改为监听 `0.0.0.0` | Docker Desktop 下不需要（A.1、A.2），而且会把带一次性账户的实例暴露到局域网 |
| 网关经 Vite（5973）访问 Workspace | Vite 拒绝 `host.docker.internal`（A.2）。放开 `allowedHosts` 要改产品的开发配置 |
| 用 `fetcher` 选项在网关里改写请求地址，不做 C1 | 能工作，但每个宿主都要自己处理 Asset 签名 URL 和协同请求的改写，阶段 D 还要再做一遍。C1 把它收在 `WorkspaceHttp` 一处 |
| 用 Claude Code 验证 | 评审决定改用 opencode（R1）。`claude mcp add` 还会写入开发者的 `~/.claude.json` |
| `opencode run --standalone`，或者自己启动 `opencode serve` 并用 `--server` 连接 | 私有服务不监听、不写日志、不响应 SIGTERM（附录 A.6） |
| `opencode run --auto` | 自动批准模型的全部操作，包括执行命令。改用配置中的 `permission` 只放行 MCP 工具 |
| 用 `OPENCODE_CONFIG` 指定配置文件 | 后台服务在 `opencode run` 之前就已启动，读不到调用方的环境变量。这一点是推断，没有单独测，私有服务又不可用，所以没有采用 |
| 读取 `uvw` 的 `session.json` 作为开发认证 | 依赖 CLI 的私有存储格式，并且让 MCP 的证据随 CLI 的登录状态变化（R4） |
| 挂载源码、在容器里用 `tsx` 运行网关 | 启动更快，但验证的不是要部署的镜像 |
| 每次运行共用一个镜像 tag | 并行运行会互相覆盖 tag。每次运行一个 tag，`down` 时删除，构建缓存不受影响 |

## 附录 C. 对抗评审的结论

初稿（提交 `1bedc64`）交给两名评审者，要求每个问题都用实际运行证明。两人分别使用 Claude Opus 和 Claude Sonnet，各自使用独立的端口和临时目录。本文作者重跑了其中可以重跑的命令，结果一致。下表列出全部问题和本稿的修改：

| 问题 | 证据 | 本稿的修改 |
| --- | --- | --- |
| SDK 的错误对象不带响应头，401 的错误码随协议版本不同 | 401 的错误数据只有 `status`、`statusText`、`text`。2025-11-25 下错误码是 `CLIENT_HTTP_NOT_IMPLEMENTED` | 6.3 节：包装 `fetch`，按 HTTP 状态定退出码 |
| pin 模式下 400 只表现为 `ERA_NEGOTIATION_FAILED` | `?toolsets=nope` 实测 | 6.3 节：同上；退出码 3 包括 401 以外的非 2xx；M7 |
| 2025-11-25 下工具拿不到 `clientInfo` | 无状态服务中 `getClientVersion()` 返回 `undefined` | 5.4 节：列出必填字段和可以为 `null` 的字段；M2、M3、M11 |
| Workspace 日志字段是 `req.id`，不是 `reqId` | `server.log` 实际行 | 6.3 节 `.workspace.log` 的筛选条件，以及为空时按证据不合格处理 |
| `doctor \| tee` 丢失退出码，脚本提前退出时 M1 仍然通过 | 构造的失败运行：0 行 `FAIL`，退出码 1 | M1 记录退出码，并要求每项检查都有 `ok` 行；`doctor` 的 `docker` 命令不能触发 `set -e` |
| 没有失败调用的事件验证，“M2 到 M7 证明事件”不成立 | 阅读 M 表 | 新增 M6，改写事件证明的说明 |
| Claude Code 连接失败时 `-p` 仍然退出 0 | 对 401 的服务端实测 | M11 要求有完成状态的工具调用和对应事件，不只看退出码。R1 改用 opencode 后照样适用 |
| 打包检查在目录不存在时也会通过 | 阅读 | 第 8 节写明 `apps/cli/package-dist`，目录不存在时不通过 |
| Dockerfile 的复制步骤漏了 `patches/` 等文件 | 缺少 `patches/` 时 `pnpm install` 报 ENOENT | 3.1 节逐个列出构建输入 |
| 按修改时间判断镜像是否过期会漏掉删除文件、`package.json`、`pnpm-workspace.yaml`、`tsconfig` 和 `render-runtime/` | 在复制出的目录里逐项修改后，检查仍然报告 `ok` | 3.2 节、6.2 节改为比较构建输入的内容摘要 |
| 默认启动 MCP 会破坏现有用法；旧运行的 `run.env` 没有 `MCP_ENABLED`，`set -u` 下脚本出错 | 对真实 `run.env` 实测 `unbound variable` | R6：按需启动；6.1 节：`${MCP_ENABLED:-0}`，项目名只在启动 MCP 时检查，`SKILL.md` 补端口变量 |
| `--verbose` 让 Claude 会话记录带上开发者的私人配置 | `init` 事件含插件、skills、记忆路径和 5229 字符的 hook 输出 | R1 改用 opencode，它的 JSON 输出不含这些内容（附录 A.6） |
| macOS 默认没有 `timeout` | 只用系统 `PATH` 时 `timeout: command not found` | M10 改用 `docker run -d` 和轮询 |
| R2 的理由不完整：SDK 已经为 2025-11-25 客户端包装数组 | 附录 A.4 | 改写 R2 和附录 A.4，结论不变 |
| 6.6 节没有说明取名词键只适用于 MCP 一侧；`uvw repo view --json <ref>` 会把仓库引用当成字段 | `jq '.repos'` 作用在 CLI 数组上报错；`Unknown --json field` | 6.6 节、M5 |
| C1 的默认路径没有验证；README 4.1 要求的 CLI 旅程没有重跑 | `univer-workspace-cli` 的测试只覆盖 `apps/cli/test` | 第 8 节增加 Client Core 测试和 CLI 旅程两行 |
| `METRICS_TOKEN` 写在 `down` 之后保留的 `run.env` 里 | 阅读 | 改存 `home/metrics-token`，`down` 时删除 |

评审者确认成立的部分：容器经 `host.docker.internal` 访问宿主回环接口（HTTP 和 WebSocket 升级），Vite 拒绝该 Host，compose 文件原样可用（`--wait`、`port`、只带 `-p` 的 `logs`、按 label 清理），`cli/password/login` 的 session 在容器内有效，并且在 `uvw auth logout` 之后依然有效。另外还确认了以下几点：

- v2 SDK 的版本存在，并能服务两版协议。
- `createRequire` 能解析客户端包。
- 只在发出请求时替换地址，`whoami`、`repo_list`、`repo_view` 的结果就与 `uvw --json` 相同。
- `node:24-bookworm-slim` 中 `deploy` 出的 Client Core 能加载原生绑定。
- 对 Claude Code 的会话记录和 Workspace 的 `server.log` 做了检查，都没有发现 session 泄露。
