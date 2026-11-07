# 本地验证环境：Docker 原型与 `verify-uvw` 扩展

> 状态：待评审。评审通过后，阶段 A 的实现以本文为准。整理日期 2026-11-07。
> 本文是 [阶段计划](stages.zh-CN.md) 阶段 A 交付物 3 的规格，覆盖 D13 的实现方式。
> 文中标注“实测”的结论来自 2026-11-07 的原型，过程和数据见附录 A。原型代码是一次性的，没有提交。

## 1. 需要评审确认的事项

正文按下列建议编写。评审结论如果不同，先改本节，再改正文。

| # | 事项 | 建议 | 影响 |
| --- | --- | --- | --- |
| R1 | Claude Code 的接入方式 | `verify-uvw` 为每次运行写一个 MCP 配置文件，用 `claude --mcp-config <文件> --strict-mcp-config` 接入，不用 `claude mcp add` | `claude mcp add` 会写入开发者的 `~/.claude.json`，在 `down` 之后依然存在，违反 `verify-uvw` 不改动开发者状态的约定。阶段 A 的验收条目“通过 `verify-uvw env` 给出的 `claude mcp add` 命令连上本地 MCP”需要相应改写，见 8 节 |
| R2 | 列表类工具的 `structuredContent` 形状 | 两版协议都返回以名词为键的对象，例如 `repo_list` 返回 `{"repos": [...]}` | 2025-11-25 规定 `structuredContent` 必须是 JSON 对象，2026-07-28 允许任意 JSON 值（附录 A.4）。[工具规格](tools.zh-CN.md) 1.2 节“产品命令返回裸对象或数组”对数组结果不成立，需要随本文一起修订。对齐比较因此先取出名词键，见 6.4 节 |
| R3 | MCP SDK | 网关使用 v2 SDK：`@modelcontextprotocol/server` 2.4.0 与 `@modelcontextprotocol/node` 2.1.2。`verify-uvw` 的客户端使用 `@modelcontextprotocol/client` 2.4.0。全部精确版本 | v1 的 `@modelcontextprotocol/sdk` 1.32.2 最高只支持 2025-11-25。v2 用同一个处理函数服务两版协议（实测，附录 A.3） |
| R4 | 开发认证的 session 来源 | `verify-uvw user` 另外调用一次 `POST /api/auth/cli/password/login`，把得到的 session 写入本次运行的 `home/mcp-session`。不读取 `uvw` 的 `session.json` | `session.json` 是 CLI 私有的存储格式（`apps/cli/AGENTS.md`）。独立的 session 让 `uvw auth logout` 之类的 CLI 旅程不会使 MCP 的证据失效。这个路由签发 `agent` 来源的 session，与 `uvw` 相同 |
| R5 | 本地原型支持的 Docker 环境 | 只支持 macOS 上的 Docker Desktop。其他环境下 `up` 拒绝启动 MCP，并提示用 `VERIFY_UVW_MCP=0` 跳过 | Linux Docker Engine 上，容器无法访问宿主只监听 `127.0.0.1` 的进程。OrbStack 没有实测 |

## 2. 拓扑

```text
宿主 macOS
  Workspace Server   127.0.0.1:3920    verify-uvw 启动，监听地址不变
  Vite（Browser）    127.0.0.1:5973    代理 /api，身份 origin 就是它
  uvw                                  经 5973 访问 Workspace
  verify-uvw mcp 客户端、Claude Code ──▶ 127.0.0.1:3930/mcp
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

阶段 A 只验证 `WorkspaceHttp` 的请求路径。协同 WebSocket 由协同 SDK 直接连接（`packages/client-core/src/content-worker.ts:62-68`），不经过 `WorkspaceHttp`，需要阶段 D 在 `WorkspaceRuntimeTarget` 上补传输地址。经 `host.docker.internal` 的 WebSocket 没有实测，阶段 D 的 `doctor` 要加一项检查。

## 3. 镜像

### 3.1 Dockerfile

`apps/mcp/Dockerfile` 沿用 `apps/workspace/Dockerfile` 的做法：

- 构建上下文是仓库根目录，复用根目录的 `.dockerignore`。
- 基础镜像 `ARG BASE_IMAGE=node:24-bookworm-slim`，与 Workspace 相同，满足根 `package.json` 的 `engines.node >=24`。
- 构建阶段先复制 manifest 和 `pnpm-lock.yaml`，执行 `pnpm install --frozen-lockfile --filter @univerjs/univer-workspace-mcp...`，再复制 `apps/mcp` 和 `packages/client-core` 的源码。
- 然后执行 `pnpm --filter @univerjs/univer-workspace-mcp... build` 和 `pnpm --filter @univerjs/univer-workspace-mcp deploy --legacy --prod`。原生绑定随 `deploy` 进入 `node_modules`，不单独处理。
- 运行阶段设置 `NODE_ENV=production`、`HOST=0.0.0.0`、`PORT=3000`，以 `node` 用户运行 `node dist/main.js`。阶段 A 不声明 `VOLUME`。
- 不设置 `MCP_ROLE` 的默认值。缺少它或取值未知时，进程报错退出。

包名 `@univerjs/univer-workspace-mcp` 是建议值，与 `@univerjs/univer-workspace`、`@univerjs/univer-workspace-client-core` 一致。

### 3.2 本地构建

- `up` 每次都执行 `docker build -f apps/mcp/Dockerfile -t univer-workspace-mcp:verify-<run-id> .`，依赖 BuildKit 的层缓存加速，不自己判断是否需要重建。
- 构建读取工作区文件，包含未提交的改动。`run.env` 记录 `GIT_HEAD`，`mcp-build.json` 另外记录 `git status --porcelain` 的 SHA-256，用来说明证据对应的源码状态。
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
- 阶段 D、E 在同一个文件里增加 `executor` 和 `renderer` 服务。它们不发布端口，网关按服务名访问。阶段 E 的“渲染服务没有到 Workspace 的路由”用 `internal: true` 的网络实现，需要届时实测这种网络能否阻断 `host.docker.internal`。
- 容器加固（只读根文件系统、去掉 capability 等）属于阶段 G，本文件不提前加。

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
3. 开发认证模式下，网关把 `<value>` 当作 Workspace session，以 `cookie: workspace_session=<value>` 调用 `GET /api/session`。响应的 `authenticated` 不为 `true` 时，返回与第 2 步相同的 401。这一步对应 [架构](architecture.zh-CN.md) 4.2 节“token exchange 兼作校验”，阶段 F 用真正的 token exchange 替换它。阶段 A 不缓存校验结果。
4. `?toolsets=` 含未知名字时返回 400，响应体列出合法名字。

### 5.3 请求 ID

- 请求带 `x-request-id` 且符合 `^[a-zA-Z0-9._-]{1,128}$` 时，网关使用它，否则生成 UUID。规则与 Workspace 的 `apps/workspace/server/src/middleware/logging.ts:32-39` 相同。
- 网关在响应头里回写 `x-request-id`，把它作为用量事件的 `request_id`，并在这次请求发往 Workspace 的每个请求上带同一个 `x-request-id`。
- 结果是一次工具调用可以在网关日志和 Workspace 的 `server.log` 里用同一个 ID 找到，`verify-uvw mcp` 依靠这一点收集证据。

### 5.4 用量事件

- 网关只在 stdout 输出日志，格式是 pino JSON。用量事件是其中 `event` 为 `mcp.tool_call` 的行，字段见 [架构](architecture.zh-CN.md) 8.1 节。
- 阶段 A 只为通过认证的 `tools/call` 产生事件。`auth_kind` 为 `dev`，`client_id` 为 `dev`，`executor` 为 `none`，`cost` 的六个字段都是 0。
- 认证失败（`outcome: auth_error`）的事件在阶段 F 验收。阶段 A 的客户端在 `initialize` 或 `server/discover` 时就收到 401，请求到不了 `tools/call`。
- 日志里不能出现 Bearer 的值、session 值或工具参数原文。`verify-uvw` 每次调用后都检查这一条，见 6.3 节。

### 5.5 生产环境拒绝开发认证

`NODE_ENV=production` 且 `MCP_DEV_SESSION_PASSTHROUGH` 非空时，网关在监听端口之前退出，退出码非 0，stderr 写明这两个变量。

## 6. `verify-uvw` 命令

### 6.1 新的环境变量与运行记录

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `VERIFY_UVW_MCP` | `1` | `0` 表示本次运行不启动 MCP。此时所有现有命令的行为和输出与扩展前相同，MCP 命令报错退出 |
| `VERIFY_UVW_MCP_PORT` | `3930` | 网关发布到宿主的端口。并行运行时与 `VERIFY_UVW_SERVER_PORT`、`VERIFY_UVW_WEB_PORT` 一起指定 |

`run.env` 增加以下变量，`down` 之后保留：

| 变量 | 内容 |
| --- | --- |
| `MCP_ENABLED` | `0` 或 `1` |
| `MCP_PORT` | 发布端口 |
| `MCP_PROJECT` | `verify-uvw-<run-id>`。run id 不符合 compose 项目名规则（`^[a-z0-9][a-z0-9_-]*$`）时，`up` 报错 |
| `MCP_IMAGE`、`MCP_IMAGE_ID` | 本次运行的镜像 tag 和镜像 ID |
| `METRICS_TOKEN` | `up` 随机生成。容器删除后即失效 |

本次运行目录增加：

| 路径 | 内容 | `down` 之后保留 |
| --- | --- | --- |
| `home/mcp-session` | 开发认证用的 session 值（R4），权限 0600 | 否 |
| `home/claude-mcp.json` | Claude Code 的 MCP 配置（R1），权限 0600 | 否 |
| `mcp-build.json` | 构建开始时间、`GIT_HEAD`、工作区状态摘要、镜像 ID | 是 |
| `logs/mcp-build.log` | `docker build` 输出 | 是 |
| `logs/mcp-gateway.log` | `down` 时导出的网关完整日志 | 是 |

### 6.2 现有命令的变化

**`up`。** 在现有步骤前后增加：

1. 预检。`docker info` 能连上，`OperatingSystem` 是 `Docker Desktop`，`MCP_PORT` 空闲。任何一项不满足都在启动 Workspace 之前退出，并提示修复方法或 `VERIFY_UVW_MCP=0`。
2. 照旧启动 Workspace Server 和 Vite，等待就绪。
3. 写入 `mcp-build.json` 的开始时间，再执行 3.2 节的构建。构建失败时输出日志末尾 40 行并退出，提示先 `down`。
4. 以 6.1 节的变量执行 `docker compose -p $MCP_PROJECT -f apps/mcp/docker/compose.verify.yml up -d --wait --wait-timeout 60`。
5. 在宿主上等待 `http://127.0.0.1:$MCP_PORT/healthz` 返回 200。
6. 就绪输出增加一行 `mcp:      http://127.0.0.1:<port>/mcp`。

**`doctor`。** `MCP_ENABLED=0` 时只多输出一行 `info  MCP disabled for this run`。否则增加下列检查，每项一行 `ok` 或 `FAIL`：

| 检查 | 失败时的提示 |
| --- | --- |
| `docker info` 可用，且是 Docker Desktop | 启动 Docker Desktop |
| `apps/mcp`、`packages/client-core/src`、`pnpm-lock.yaml` 中没有比 `mcp-build.json` 记录的开始时间更新的文件（忽略 `node_modules` 和 `dist`） | 镜像是旧代码：`down`，然后 `up` |
| 项目里 `gateway` 容器在运行且健康，镜像 ID 等于 `MCP_IMAGE_ID` | `down`，然后 `up` |
| `docker compose port gateway 3000` 等于 `127.0.0.1:$MCP_PORT`，宿主上 `/healthz` 返回 200 | 端口被占用或映射错误 |
| 容器的 `WORKSPACE_ORIGIN` 等于 `$ORIGIN`，`WORKSPACE_TRANSPORT_URL` 指向本次运行的 Server 端口 | 配置漂移：`down`，然后 `up` |
| 在容器内请求 `$WORKSPACE_TRANSPORT_URL/api/session` 返回 200 | 容器访问不到宿主 Workspace，见 2.1 节 |
| 不带令牌请求 `/metrics` 返回 401 | 网关指标未受保护 |
| `user` 之后：经 MCP 调用 `whoami`（不记录证据）返回本次运行的用户 | 运行 `user` |
| `user` 之后：网关日志不包含 `home/mcp-session` 的值 | 网关泄露了凭据，这是阻断性缺陷 |

端口归属的检查方式与 Workspace 不同。宿主上监听 `MCP_PORT` 的是 Docker Desktop 的后台进程，不是本次运行启动的 PID，所以改用 compose 的端口映射和镜像 ID 证明归属。

**`user`。** 现有行为不变。`MCP_ENABLED=1` 时再执行两步，重复运行会覆盖旧值：

1. 用本次运行的用户名和 `user.pw` 调用 `POST $ORIGIN/api/auth/cli/password/login`，从 `Set-Cookie` 里取出 `workspace_session` 的值，写入 `home/mcp-session`。
2. 写入 `home/claude-mcp.json`：

```json
{"mcpServers":{"verify-uvw":{"type":"http","url":"http://127.0.0.1:3930/mcp","headers":{"Authorization":"Bearer <home/mcp-session 的值>"}}}}
```

**`env`。** `MCP_ENABLED=1` 时增加：

```bash
export MCP_URL=http://127.0.0.1:3930/mcp
export MCP_PROJECT=verify-uvw-<run-id>
export MCP_IMAGE=univer-workspace-mcp:verify-<run-id>
export MCP_CLAUDE_CONFIG=/tmp/verify-uvw/<run-id>/home/claude-mcp.json
# Claude Code: claude -p "<prompt>" --strict-mcp-config --mcp-config "$MCP_CLAUDE_CONFIG"
```

`--mcp-config` 接受多个值，会吞掉它后面的位置参数，所以提示词要写在它前面（实测）。

**`down`。** 在现有步骤之前执行，任何一步失败都只警告，不中断后面的清理：

1. `docker compose -p $MCP_PROJECT logs --no-color --timestamps > logs/mcp-gateway.log`。
2. `docker compose -p $MCP_PROJECT -f apps/mcp/docker/compose.verify.yml down --volumes --remove-orphans`。
3. `docker image rm univer-workspace-mcp:verify-<run-id>`，只删除这个 tag。构建缓存保留，供下次构建使用。
4. 按 label `com.docker.compose.project=$MCP_PROJECT` 列出剩余的容器、网络和卷，镜像按 tag 列出。全部为空时输出 `ok    MCP resources removed`，否则逐个列出并给出删除命令。

`down` 只操作带本次项目 label 或本次 tag 的资源，不执行 `docker system prune`，也不按名字或端口删除容器。

### 6.3 `mcp`

```text
verify-uvw mcp [--protocol 2026-07-28|2025-11-25] [--auth dev|none|invalid] [--toolsets <list>] <label> <tool> [<json 参数>]
```

- `label` 必须符合 `^[A-Za-z0-9._-]{1,64}$`。`json 参数` 默认 `{}`，必须是 JSON 对象。
- `--protocol` 默认 `2026-07-28`，与 Claude Code 2.1.301 协商出的版本相同（实测）。`2026-07-28` 用 `versionNegotiation: { mode: { pin: '2026-07-28' } }`。`2025-11-25` 用默认的 `legacy` 模式，连接后核对协商结果，不是 `2025-11-25` 就按传输错误处理。
- `--auth dev` 读取 `home/mcp-session` 作为 Bearer。`none` 不带 `Authorization`。`invalid` 带一个随机值。
- `--toolsets` 原样放进 URL 的 `?toolsets=`。
- 每次调用生成 `x-request-id`：`<label>.<8 位十六进制随机数>`。

实现是 `.agents/skills/verify-uvw/bin/mcp-call.mjs`，由 `verify-uvw` 用 `node` 调用。它用 `createRequire(apps/mcp/package.json)` 解析 `@modelcontextprotocol/client`，保证客户端版本就是 `apps/mcp` 锁定的版本。`apps/mcp` 把它列为 devDependency。

证据写入 `$EVIDENCE`，与 `cli` 命令的文件名对齐：

| 文件 | 内容 |
| --- | --- |
| `<label>.cmd` | `verify-uvw mcp` 的完整调用、MCP URL、协议版本、认证方式。不含任何凭据 |
| `<label>.out` | 成功时是 `structuredContent`，两格缩进的 JSON，与 `cli` 的 `.out` 可以直接比较。HTTP 401 时是 `{"status":401,"www_authenticate":"…"}` |
| `<label>.result.json` | 完整的 `CallToolResult`，加上协商出的协议版本和 `x-request-id` |
| `<label>.err`、`<label>.exit` | stderr 和退出码 |
| `<label>.event.json` | 网关日志中 `request_id` 等于本次 ID 的 `mcp.tool_call` 事件 |
| `<label>.gateway.log` | 网关日志中带本次 ID 的全部行 |
| `<label>.workspace.log` | `logs/server.log` 中 `reqId` 等于本次 ID 的全部行 |

退出码：

| 码 | 含义 |
| --- | --- |
| 0 | 工具成功，证据齐全 |
| 1 | 工具返回 `isError: true` |
| 2 | 用法错误 |
| 3 | 协议或传输错误：连接失败、JSON-RPC 错误、协议版本不符 |
| 4 | HTTP 401，与 `uvw` 的退出码 4 含义相同 |
| 5 | 调用本身成功，但证据不合格：缺少用量事件，事件缺少 8.1 节的字段，或者网关日志里出现了本次使用的 Bearer 值 |

退出码 5 让每一次 MCP 调用都自动核对用量事件和凭据泄露，后续阶段不需要另写检查。

### 6.4 `mcp-tools`

```text
verify-uvw mcp-tools [--protocol …] [--toolsets <list>] <label>
```

调用 `tools/list`。`<label>.out` 是工具数组，每项保留 `name`、`description`、`annotations`、`inputSchema`、`outputSchema`，顺序与服务端返回的顺序一致。其他证据文件与 `mcp` 相同，没有 `.event.json`。

### 6.5 `mcp-logs`

```text
verify-uvw mcp-logs
```

输出网关当前的日志，即 `docker compose logs --no-color --no-log-prefix gateway`。用于查找不由 `verify-uvw mcp` 发起的调用，例如 Claude Code 的调用。

### 6.6 MCP 结果与 CLI 结果的比较

阶段 A 不提供专门的比较命令，比较写在 `features/mcp.md` 里，用 `jq` 完成：

1. 取出名词键（R2），例如 `repo_list` 的 `.repos`。
2. 删除 MCP 一侧每个对象上的 `url` 字段（[工具规格](tools.zh-CN.md) 1.2 节）。
3. 两边都用 `jq -S` 排序后 `diff`。

阶段 B 有约 30 个工具要做同样的比较，届时把这三步收进一个脚本，并把工具规格第 4 节的有意差异写成脚本里的显式列表。

## 7. `features/mcp.md`

新增 `features/mcp.md`，遵守 `features/README.md` 的格式约定（一个 H1、一段用户可见行为、四个固定的 H2），并在 `features/README.md` 的功能列表里加一行。阶段 A 的旅程如下，每步的证据名用 `mcp-<步骤>` 前缀。

| # | 步骤 | 命令要点 | 通过条件 |
| --- | --- | --- | --- |
| M1 | 环境 | `$V up`，`$V user`，`$V doctor \| tee $EVIDENCE/mcp-doctor.txt` | 没有 `FAIL` 行 |
| M2 | 身份，新协议 | `$V mcp mcp-whoami whoami`，`$V cli mcp-whoami-cli auth status --json` | 退出码 0。两个 `.out` 的 `subject` 相同，MCP 一侧的 `origin` 等于 `$ORIGIN`，不是 `host.docker.internal` |
| M3 | 身份，旧协议 | `$V mcp --protocol 2025-11-25 mcp-whoami-legacy whoami` | 退出码 0，`.result.json` 的协议版本是 `2025-11-25`，`.out` 与 M2 相同 |
| M4 | 仓库列表 | 先按 `features/issues.md` 建一个 Team Space，再 `$V mcp mcp-repo-list repo_list`，`$V cli mcp-repo-list-cli repo list --json` | 按 6.6 节比较没有差异，列表里有 Personal 和 Team 两种 Space |
| M5 | 仓库详情 | 对 Personal 和 Team Space 各执行一次 `repo_view` 和 `uvw repo view --json` | 按 6.6 节比较没有差异 |
| M6 | 工具列表 | `$V mcp-tools mcp-tools-core`，`$V mcp-tools --toolsets all mcp-tools-all`，再加一次 `--toolsets nope` | 前两次都只有 `whoami`、`repo_list`、`repo_view`，顺序固定，三个注解齐全。`nope` 得到 400 |
| M7 | 未认证 | `$V mcp --auth none mcp-unauth whoami`，`$V mcp --auth invalid mcp-badtoken whoami` | 两次退出码都是 4，`.out` 的 `www_authenticate` 含 `resource_metadata` |
| M8 | Origin 校验 | `curl -sS -o /dev/null -w '%{http_code}' -H 'Origin: http://evil.example' -H "Authorization: Bearer $(cat …/home/mcp-session)" -X POST "$MCP_URL"`，输出写入 `mcp-origin.txt` | 403 |
| M9 | 生产环境拒绝 | `timeout 20 docker run --rm --network none -e MCP_ROLE=gateway -e NODE_ENV=production -e MCP_DEV_SESSION_PASSTHROUGH=1 "$MCP_IMAGE"`，输出和退出码写入 `mcp-prod-refuse.{out,exit}` | 退出码非 0 且不是 124，输出提到两个变量名 |
| M10 | Claude Code | `claude -p "Call the whoami tool from the verify-uvw MCP server and print its result." --strict-mcp-config --allowedTools mcp__verify-uvw__whoami --output-format stream-json --verbose --mcp-config "$MCP_CLAUDE_CONFIG" < /dev/null > $EVIDENCE/mcp-claude-whoami.jsonl`，再从 `$V mcp-logs` 中取出对应事件写入 `mcp-claude-whoami.event.json` | 会话记录里有 `whoami` 的调用和本次运行的用户名，事件的 `client_name` 是 Claude Code 的 `clientInfo` |
| M11 | 清理 | 记下开发者 3020、5173 上监听进程的 PID，`$V down \| tee $EVIDENCE/mcp-down.txt`，再查一次 PID | `down` 输出 `ok    MCP resources removed`。开发者实例的 PID 前后相同，或者前后都不存在 |

M2 到 M7 每一步都以退出码 0 或 4 结束，同时得到用量事件和凭据检查（6.3 节退出码 5）。所以“每次工具调用都产生一条 `mcp.tool_call` 事件”由这些步骤共同证明，不单列一步。

## 8. 阶段 A 验收条目与证据的对应

| 验收条目（[阶段计划](stages.zh-CN.md)） | 证据 |
| --- | --- |
| `up` 同时启动 Workspace 和网关，`doctor` 全部通过 | M1 |
| `mcp whoami` 返回本次运行的用户 | M2、M3 |
| `repo_list` 与 `uvw repo list --json` 一致 | M4，按 R2 和 6.6 节比较 |
| Claude Code 连上本地 MCP 并调用 `whoami` | M10。条目中的 `claude mcp add` 按 R1 改为 `--mcp-config` |
| 不带 Bearer 得到 401 和 `WWW-Authenticate` | M7 |
| 生产环境拒绝开发认证 | M9 |
| 每次工具调用产生一条字段齐全的事件 | M2 到 M7 的 `.event.json`，以及退出码不是 5 |
| `down` 清理干净，不影响开发者实例 | M11 |
| CLI 测试与打包验证通过，产物不含 `apps/mcp` | 不在 `verify-uvw` 里。执行 `pnpm --filter univer-workspace-cli test` 和 `pnpm package:workspace-cli`，再在产物目录里搜索 `@univerjs/univer-workspace-mcp` 和 `@modelcontextprotocol`，结果为空。输出保存到 `$EVIDENCE/mcp-cli-package.txt` |

R1 获批后，`stages.zh-CN.md` 阶段 A 的对应条目改为“Claude Code 通过 `verify-uvw env` 给出的 `--mcp-config` 命令连上本地 MCP”。这个修改与本文放在同一个 PR。

## 9. 不变的部分

- `VERIFY_UVW_MCP=0` 时，`up`、`doctor`、`user`、`env`、`cli`、`uvw`、`down` 的行为和输出与扩展前完全相同。
- `VERIFY_UVW_MCP=1` 时，现有输出行保持原样，只增加新行。`features/` 下现有的旅程不需要修改。
- 不修改 `apps/workspace`、`apps/cli` 和 `apps/workspace/vite.config.ts`。
- Workspace Server 仍然只监听 `127.0.0.1`。

## 10. 留给后续阶段

| 事项 | 阶段 |
| --- | --- |
| compose 增加 `executor`、暂存目录挂载；`doctor` 检查容器内的协同 WebSocket | D |
| compose 增加 `renderer`；实测 `internal: true` 网络能否阻断 `host.docker.internal` | E |
| `verify-uvw mcp-token` 生成 PAT，`mcp --auth pat`；认证失败事件的验收；本地验证默认改用 PAT | F |
| 容器加固与沙箱运行时 | G |
| 把 6.6 节的比较步骤收进脚本 | B |

## 附录 A. 原型实测（2026-11-07）

环境：macOS，Docker Desktop，Engine 24.0.5（linux/arm64），客户端 29.8.2，Claude Code 2.1.301。
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
| Claude Code 2.1.301，`--mcp-config` 带 `headers` | 调用成功，Bearer 原样到达 | `2026-07-28` |

v1 的 `@modelcontextprotocol/sdk` 最新版是 1.32.2，`SUPPORTED_PROTOCOL_VERSIONS` 最高到 `2025-11-25`。

### A.4 `structuredContent` 的形状

- 2025-11-25 的 tools 规范：“Structured content is returned as a JSON object in the `structuredContent` field of a result.”
- 2026-07-28 的 tools 规范：“This can be any JSON value (object, array, string, number, boolean, or null) that conforms to the tool's `outputSchema` if one is defined.”，并给出了数组 `outputSchema` 的示例。
- v2 SDK 在注册时接受数组 `outputSchema`。SDK 接受不代表 2025-11-25 的客户端能处理数组，所以 R2 建议两版协议都返回对象。

### A.5 待回填的测量

阶段 A 实现后测量并填写：

| 项目 | 值 |
| --- | --- |
| 镜像冷构建耗时（无缓存） | 待测 |
| 只改 `apps/mcp/src` 后的热构建耗时 | 待测 |
| `docker compose up` 到 `/healthz` 返回 200 的耗时 | 待测 |
| 镜像大小 | 待测 |

## 附录 B. 放弃的做法

| 做法 | 放弃的原因 |
| --- | --- |
| Workspace Server 改为监听 `0.0.0.0` | Docker Desktop 下不需要（A.1、A.2），而且会把带一次性账户的实例暴露到局域网 |
| 网关经 Vite（5973）访问 Workspace | Vite 拒绝 `host.docker.internal`（A.2）。放开 `allowedHosts` 要改产品的开发配置 |
| 用 `fetcher` 选项在网关里改写请求地址，不做 C1 | 能工作，但每个宿主都要自己处理 Asset 签名 URL 和协同请求的改写，阶段 D 还要再做一遍。C1 把它收在 `WorkspaceHttp` 一处 |
| `claude mcp add` | 写入开发者的 `~/.claude.json`，`down` 之后仍然存在（R1） |
| 读取 `uvw` 的 `session.json` 作为开发认证 | 依赖 CLI 的私有存储格式，并且让 MCP 的证据随 CLI 的登录状态变化（R4） |
| 挂载源码、在容器里用 `tsx` 运行网关 | 启动更快，但验证的不是要部署的镜像 |
| 每次运行共用一个镜像 tag | 并行运行会互相覆盖 tag。每次运行一个 tag，`down` 时删除，构建缓存不受影响 |
