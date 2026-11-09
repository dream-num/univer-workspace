# 执行层与渲染服务的多租户安全设计（阶段 G）

> 状态：设计稿，待评审（2026-11-09）。本文是[阶段计划](stages.zh-CN.md)阶段 G 交付物 1，说明如何满足[架构](architecture.zh-CN.md#10-执行层安全门禁要求)第 10 节的七条要求。
> 文中“当前”指 `main` `26c1b69d` 的代码事实，附路径；“设计”“将”指尚未实现的行为。沙箱原型的实测数据见附录 A，原型脚本是一次性的，没有提交。
> 决策编号 D1 到 D14 见 [README](README.zh-CN.md)。

## 1. 要解决的问题

D4 接受在服务端执行模型生成的代码。阶段 D、E 的执行方式只适用于本地和内部单用户环境，当前代码在多用户下有这些缺口：

| # | 缺口 | 代码事实 | 违反的要求 |
| --- | --- | --- | --- |
| 1 | worker 进程持有用户的完整 Workspace session | `apps/mcp/src/executor/runtime.ts` 的 `resolveCredential` 把 `workspace_session=<session>` 作为 `init.credential` 交给 worker；`packages/client-core/src/content-worker.ts` 用它构造 `WorkspaceHttp` | 1、2 |
| 2 | worker 能访问执行层能访问的任何网络目标，包括 Workspace 的全部路由 | worker 直接连接 `WORKSPACE_TRANSPORT_URL`，没有网络隔离 | 2、5 |
| 3 | 同一 uid 的 worker 能读执行层的 `/proc/1/environ`，其中有内部令牌和 license key | [架构 6.4](architecture.zh-CN.md#64-凭据) 已记录；`apps/mcp/src/shared/config-executor.ts` 从环境变量读取全部密钥 | 1 |
| 4 | worker 按用户复用，不区分 scope、客户端和授权 | `packages/client-core/src/runtime-target.ts` 的 `workspaceRuntimeKey` 只追加 `caller.userId`；`reuseExecutorWorker` 只检查 grant 是否临近过期 | 2 |
| 5 | worker 之间、worker 与父进程之间共享文件系统、`/tmp` 和进程视图 | worker 由上游池直接 `fork`，没有命名空间 | 1、6 |
| 6 | 单个 worker 没有内存和 CPU 上限；一个用户可以占满池 | 池只有 `EXECUTOR_MAX_WORKERS` 和操作超时；跨 key 排队是全局 FIFO（`packages/client-core/src/content-runtime.ts`） | 3、4 |
| 7 | Office、Typst 作业子进程解析不可信字节，但没有网络隔离 | [架构 D4 节](architecture.zh-CN.md#d4-office-作业进程)；`apps/mcp/src/executor/jobs/run.ts` | 1、5 |
| 8 | 执行层父进程会无凭据地访问 Workspace 返回的任意跨域 URL | `packages/client-core/src/http.ts` 的 `content()` 对非同源 URL 直接 `fetch` | 5 |
| 9 | 渲染服务跨用户复用 Chromium 页面，且以 `--no-sandbox` 启动 | `apps/mcp/src/renderer/pool.ts`；[架构 7.1](architecture.zh-CN.md#71-渲染服务) | 1 |
| 10 | Office 导出用量存在每个作业的临时目录，作业结束即删除 | `jobs/run.ts` 的 `jobEnvironment` | 阶段 G 的 C7 门禁 |

当前唯一的保护是执行层在 `NODE_ENV=production` 时拒绝启动（`config-executor.ts`）。本文设计替代它的保护，最后一个 PR 才移除这条拒绝。

## 2. 威胁模型

### 2.1 资产

| 资产 | 所在位置 |
| --- | --- |
| 用户的下游 Workspace session（10 分钟，带用户全部权限） | 网关缓存、执行层父进程（RPC frame 中的 grant） |
| 其他用户的文档数据 | worker 内存、作业子进程、渲染页面、暂存存储 |
| 内部 RPC 令牌、OAuth 机密客户端密钥、指标令牌、`UNIVER_LICENSE_KEY` | 各角色进程 |
| 执行层、渲染服务的可用性 | 容器的 CPU、内存、worker 与 runtime 槽位 |
| Workspace Server 的可用性与数据完整性 | 单副本（[架构 3.3](architecture.zh-CN.md#33-mcp-会给-workspace-server-带来的压力)） |
| 集群内网与云元数据端点 | 执行层和渲染服务所在网络 |
| Office 导出的 license 用量记录 | 执行层（第 6 节） |

### 2.2 攻击者

- **A1 任何已认证的 MCP 用户。** `execute`、`inspect` 的脚本在 worker 里运行，按 `prepareContentExecutionProgram` 的 README，运行时不判断代码是否安全，也不提供进程级沙箱。本文因此假设 A1 完全控制自己 worker 进程内的代码执行。
- **A2 被提示注入的模型。** 它通过合法用户的客户端调用工具，能力与 A1 相同，但只在受害者授予的 scope 之内。要求 2 限制的正是 A2 的破坏范围。
- **A3 恶意文件内容。** 上传的 xlsx、docx、Typst、Markdown，以及文档里的图片与文字，攻击作业子进程中的原生解析器和 Chromium。
- **A4 已被攻破的作业子进程或 Chromium 渲染进程。** 它试图横向移动到父进程、其他用户的进程或网络。

### 2.3 信任边界

```text
网关（可信，持有 OAuth 客户端密钥与 session 缓存）
  │ B1 内部 RPC：网关→执行层令牌，grant 在 frame body
  ▼
gVisor 沙箱（B6）
  执行层父进程（可信，持有在途调用的 session）
    凭据与出网代理 ◀── B2 Unix socket + capability ── worker（不可信，命名空间）
    │                                                作业子进程（不可信输入，命名空间，B3）
    │ B4 内部 RPC：执行层→渲染服务令牌，只传渲染数据
    ▼
gVisor 沙箱（B6）
  渲染服务 Node 进程（可信，不持有用户凭据）
    Chromium（B5 Chromium 自带沙箱，页面数据不可信）

B7：网络策略。worker、作业子进程、渲染服务没有出网；执行层父进程只能到 Workspace 与渲染服务。
Workspace Server 是身份、ACL、协同与存储的唯一权威，不在本文的攻击面内。
```

### 2.4 不在范围内

- 攻破 Workspace Server、集群节点或 gVisor 本身（Sentry 逃逸）。后者是剩余风险，见第 10 节。
- 同一用户、同一授权、同一 scope 集合内，前一次调用留下的代码影响后一次调用。这与 CLI 的 daemon worker 跨调用常驻相同，见 4.5 节。
- 跨进程的侧信道（例如 Spectre 类攻击）。

## 3. 已定的决策

2026-11-09 在原型实测后确定，本文在此基础上设计，不重新讨论。

| # | 决策 | 依据 |
| --- | --- | --- |
| G1 | 执行层和渲染服务的容器运行在 gVisor `runsc` 下，使用默认参数 | 附录 A 的 Q2、Q3：全部原生路径与 Chromium 在 runsc 下可用；runsc 下 Chromium 自带沙箱可用，runc 需要放宽 seccomp |
| G2 | worker 按敌对进程对待。真实的 Workspace 凭据不进入 worker。执行层父进程运行凭据与出网代理，worker 只持有一个每 worker 的 capability | 第 1 节缺口 1、2 |
| G3 | 每个 worker 和作业子进程运行在命名空间包装器里（user、pid、net、mount），私有 tmpfs `/tmp`，应用目录只读，父进程的 home 与密钥目录不可见，prlimit 限制 AS 与 CPU。包装器通过 `process.execPath` 接入，因为上游池不提供 spawn 选项。这是一个隔离的、有删除条件的 workaround | 附录 A 的 Q3、Q4 |
| G4 | 墙钟上限由执行层以 SIGKILL 杀死 worker 进程树来执行，不依赖 SIGTERM | 附录 A：包装器内 node 是 pid 命名空间的 1 号进程，忽略 SIGTERM |
| G5 | 密钥不进入任何进程环境变量。worker 环境里没有密钥；执行层和渲染服务启动时从文件读取 | 第 1 节缺口 3 |
| G6 | 渲染服务在 runsc 下开启 Chromium 沙箱（去掉 `--no-sandbox`），并恢复每任务隔离 | 第 1 节缺口 9 |
| G7 | 生产环境下，任何不安全配置都让对应角色拒绝启动 | 要求 7 |
| G8 | 独立评审：先由不同模型家族做对抗评审，再由用户指定的人签字 | 阶段 G 验收标准 |
| G9 | 门禁旅程必须在 runsc 上运行。`verify-uvw` 增加在 Linux 主机 `minsky-ubuntu-remote`（已安装并注册 runsc）上运行执行层和渲染服务的方式 | 9.3 节 |

## 4. 执行层设计

### 4.1 进程与隔离层次

```text
executor 容器（runsc，容器级 --memory、--cpus）
└─ 执行层父进程 node（uid 1000）
   ├─ 内部 RPC 服务（只接受网关→执行层令牌）
   ├─ 凭据与出网代理：/run/univer-mcp/proxy.sock（新）
   ├─ worker 池（上游 @univer-cli/univer-collaboration-runtime-pool）
   │   └─ fork → process.execPath = ns-worker 包装器（新）
   │        └─ unshare user+pid+net+mount+ipc，私有 /tmp，只读根，prlimit
   │             └─ node worker（pid 命名空间 1 号进程，只有 lo）
   │                  └─ 127.0.0.1:<端口> 转发到 proxy.sock
   └─ 作业子进程：fork 时显式 execPath = ns-job 包装器（新）
        └─ 同样的命名空间与 rlimit，没有代理 socket，没有网络
```

### 4.2 worker 包装器

包装器是镜像内的一个 shell 脚本（设计为 `apps/mcp/docker/ns-worker.sh`，新），形状来自附录 A 的 `ns-node.sh`。执行层在创建 worker 池之前设置 `process.execPath` 指向它，上游池 fork worker 时于是先执行包装器。设计要点：

- **命名空间。** `unshare --user --map-root-user --net --pid --fork --kill-child --mount --mount-proc --ipc`，再以 `unshare --user --map-user=5000 --map-group=5000` 降到非 root。原型没有加 `--ipc`；本设计加上，避免 worker 之间经 System V 共享内存通信，由 MG5 验证。bwrap 的 `--unshare-net` 在 runsc 下失败（RTM_NEWADDR），所以不用 bwrap（附录 A）。
- **文件系统。** userns 里的 uid 5000 只是外观，内核 uid 仍是 1000，worker 能读父进程拥有的 0600 文件（附录 A 的 caveat）。文件隔离因此只靠挂载命名空间：先把根目录递归重新挂载为只读，再在 `/tmp`、`/var/tmp`、`/dev/shm`、`/home/node`、密钥目录（4.10 节）和 license 用量目录（第 6 节）上挂空 tmpfs。`/tmp` 设 `nosuid,nodev,noexec`、64 MiB。代理 socket 所在的 `/run/univer-mcp` 保持可见。
- **rlimit 与堆。** 包装器以 `prlimit` 设置 `RLIMIT_AS`（`EXECUTOR_WORKER_AS_MB`）、`RLIMIT_CPU`（`EXECUTOR_WORKER_CPU_SECONDS`）、`RLIMIT_FSIZE`，并在 node 参数前加 `--max-old-space-size=<EXECUTOR_WORKER_HEAP_MB>`。这些值经 `pool.env` 传给包装器，对池内所有 worker 相同，不是密钥。数值见 4.7 节。
- **代理入口。** worker 的网络命名空间里只有 `lo`。MCP 的 worker 入口（`apps/mcp/src/executor/worker.ts`）在交给 Client Core 之前，在 `127.0.0.1:<EXECUTOR_PROXY_PORT>` 上启动一个用 `node:net` 写的转发器，把连接原样接到 `/run/univer-mcp/proxy.sock`。所有 worker 的 `transportOrigin` 因此都是 `http://127.0.0.1:<EXECUTOR_PROXY_PORT>`，HTTP 与协同 WebSocket 都经它到达代理（`content-worker.ts` 中两者都由 `transportOrigin` 改写）。不需要修改 Client Core 的 worker，也不需要新依赖。`EXECUTOR_WORKER_ISOLATION=none`（只用于 macOS 本地运行，9.3 节）时没有网络命名空间，worker 入口不启动转发器，代理直接在执行层容器的同一回环端口上监听，worker 的 `transportOrigin` 不变。
- **pid 登记。** 包装器把自己在外层的 pid（`$$`）经环境变量交给 node。worker 入口在运行任何用户代码之前，用自己的 capability 向代理登记这个 pid；代理只接受每个 capability 的第一次登记，并检查该 pid 的父进程是执行层。执行层据此执行墙钟 SIGKILL（4.7 节）和空闲 CPU 检查（4.5 节）。
- **自检。** 执行层启动时用包装器运行一个自检入口，结果用于第 7 节的拒绝启动检查：只有 `lo`；直接连接 `WORKSPACE_TRANSPORT_URL` 失败；`/proc` 只看到自己的进程；父进程 environ 不可读；密钥目录为空；`/tmp` 私有；根目录只读；`/proc/self/limits` 与配置一致；代理 socket 可达。

**Workaround 说明。** `process.execPath` 是进程级全局状态。原因：上游池没有 spawn、execPath 或每 worker 参数选项，也不返回子进程句柄。影响范围：执行层父进程里所有不显式传 `execPath` 的 `fork`。作业子进程因此必须显式传入自己的包装器（4.9 节），执行层也不得新增其他 fork。删除条件：上游池提供 spawn 选项并返回子进程或 pid（第 12 节 U1），届时去掉 `process.execPath` 覆盖和 pid 登记。workaround 只存在于执行层启动代码和 worker 入口两处。

### 4.3 凭据与出网代理

代理运行在执行层父进程内，监听 `/run/univer-mcp/proxy.sock`。它是 worker 唯一能到达的网络目标。

数据形状：

```ts
type WorkerCapability = string;                 // 256 位随机值，以 workspace_session cookie 的形式出现

interface WorkerBinding {                       // 每个 worker 一条，在 resolveCredential 时创建
  readonly key: string;                         // 运行时 key，含用户、授权与 scope 集合（4.5 节）
  readonly userId: string;
  readonly grantId: string;                     // "<subject.kind>:<subject.id>"，PAT id 或 OAuth grant id
  readonly scopes: ReadonlySet<ToolScope>;
  readonly target: WorkspaceRuntimeTarget;      // origin、scope（trunk 或 worktree）、unitId、unitType
  outerPid: number | null;                      // 4.2 节的登记
}

type CallPolicy =                               // 按 key 切换；执行层在 runtime 调用前后设置
  | { readonly kind: "active"; readonly effect: "read" | "write"; readonly requestId: string;
      readonly session: string; readonly deadlineAt: number }
  | { readonly kind: "idle"; readonly session: string; readonly expiresAt: number };

interface RouteRule {                           // 路由表的一行，默认拒绝
  readonly id: "W1" | "W2" | "W3" | "W4" | "W5" | "W6" | "W7" | "W8-12";
  readonly method: "GET" | "POST";
  readonly match: (path: URL, binding: WorkerBinding) => boolean;
  readonly allowed: (policy: CallPolicy, binding: WorkerBinding) => boolean;
}
```

行为：

1. **capability 取代 session。** `resolveCredential` 不再返回 session，改为生成 capability 并登记 `WorkerBinding`。worker 的 `init.credential` 是 `workspace_session=<capability>`。worker 被销毁时（新的 Client Core 钩子，见 4.11 节）作废 capability。
2. **注入 session。** 代理按 cookie 找到 binding，再按 binding 的 key 找到当前 `CallPolicy`，用其中的 session 替换 cookie，转发到 `WORKSPACE_TRANSPORT_URL`。`Origin` 由代理设为身份 origin，不取 worker 的值。请求头只转发 `accept`、`accept-encoding`、`content-type`、`content-length`、`if-match`、`idempotency-key`，执行层另加 `x-request-id`。响应去掉 `set-cookie`。
3. **ticket 替身。** W2（`/universer-api/user/session-ticket`）由代理在本地回答：返回一个绑定该 capability、一次性、60 秒有效的替身 ticket，形状与真实响应相同（由 4.6 节的抓包确认）。真实 ticket 只在代理打开上游 WebSocket 时使用，不离开父进程。
4. **路由表。** 表来自附录 B 的路由清单。不匹配任何一行的请求返回 403，记录一行 `mcp.proxy_denied` 日志（route、reason、key 的哈希、request id，不记路径中的 ID 以外的内容）和 `mcp_executor_proxy_denied_total{route,reason}`。

| 路由 | 匹配 | active write | active read | idle |
| --- | --- | --- | --- | --- |
| W1 `GET /api/worktrees/{wt}` | `wt` 等于 binding 的 Worktree | 允许 | 允许 | 拒绝 |
| W2 session ticket | 固定路径 | 本地替身 | 本地替身 | 本地替身 |
| W3 至 W5 快照读取 | 前缀等于 binding 的范围，`type`、`unitId` 等于目标 | 允许 | 允许 | 只允许 W5 `fetchmissing`（重连后的 pull） |
| W6 `POST .../comb/{type}/unit/{unitId}/new_changes` | 前缀、`type`、`unitId` 等于目标；body 的 `unitID`、`changeset.unitID`、`type`、`changeset.type` 与路径一致；body 不超过 16 MiB | 仅当 binding 含 `write` scope | 拒绝 | 拒绝 |
| W7 协同 WebSocket | 路径固定为 binding 范围的 `/comb/connect` | 4.6 节 | 4.6 节 | 4.6 节 |
| W8 至 W12 引用 Unit 读取 | `GET`，前缀为 trunk 或 binding 的 Worktree | 4.4 节 | 4.4 节 | 拒绝 |

路径里的 `unitId` 与 body 里的 `unitID` 都由敌对进程写出，而服务端以哪一个为准没有确认，所以 W6 两处都校验。16 MiB 是本文选择的上限，不是测得的值，实现时以 Workspace 协同端点的实际 body 上限为准，取较小者。

5. **父进程自己的写入。** `executeAndCommit` 在提交前用 `init.credential` 和 `init.transportOrigin` 构造 `WorkspaceHttp` 上传内嵌图片（`content-runtime.ts`，路由 P8）。capability 和 worker 侧的回环地址在父进程里不可用，所以 Client Core 将增加一个宿主侧 HTTP 选项（4.11 节），执行层传入以 grant 的 session、真实传输地址和 4.8 节的出网守卫构造的 `WorkspaceHttp`。

worker 在新设计下能拿到的东西只有：capability、自己的目标、`UNIVER_LICENSE`（headless Univer 需要它；按 D7 它不涉及授权，且同一类开发 license 随 CLI 产物发布，本文不把它当作密钥）和代理 socket。

### 4.4 引用 Unit 的读取（问题 1）

W8 至 W12 读取文档里 ResourceRef 指向的 Unit。`refUnitId` 来自文档内容，可以是用户能读的任何 Unit；前缀是宿主 Worktree（已映射时）或 trunk（附录 B）。

| 方案 | 做法 | 代价 |
| --- | --- | --- |
| A 父进程预先解析引用集 | 父进程读取目标 Unit，解析 ResourceRef，只放行这些 Unit | 要在父进程里解析上游拥有的文档格式；脚本在本次调用中新加的引用读不到，行为与 CLI 不同；文档格式变化会静默放错或拒错 |
| B 有 `read` scope 时放行只读快照 GET | 代理放行 trunk 或本 Worktree 前缀下 W8 至 W12 形状的 `GET`，仅当 binding 含 `read` scope；服务端仍以用户自己的 session 做 ACL | 脚本能读用户能读的任何 Unit |

**选择 B。** 判断依据是要求 2 的两半：

- “不超过用户授予的 scope。” 持有 `read` scope 的客户端本来就能对用户能读的任何 Unit 调用 `inspect`、`export`。脚本经 B 读到的数据，没有超出同一个 token 已有的能力。没有 `read` scope 的授权（例如只勾了 `write`）只能读目标 Unit，W8 至 W12 一律拒绝。
- “不超过本次工具调用所需。” 加载引用是 `execute`、`inspect` 的既有语义，CLI 的 worker 同样按文档内容加载引用。脚本读到的数据只能流向两处：写回本次目标 Unit（经 W6，在用户自己的 Worktree 里），或作为工具结果返回同一个客户端。两处的接收者都已有读取权限。worker 没有其他出口（4.2 节）。

B 不允许其他 Worktree 的前缀，不允许任何非 GET。W12 `/resources` 是否被实际使用，由 4.6 节的抓包确认；未出现的形状不进路由表。

### 4.5 worker 复用与空闲（问题 2）

**复用必须匹配的内容。** 当前 key 是 `workspace:<origin>:<scope>:<unitId>:<unitType>:caller:<userId>`，同一用户的不同 session、客户端和 scope 共用 worker。危险的情形之一是，一个只读授权（例如被提示注入的客户端 B）在 worker 里留下常驻代码，之后同一用户带 `write` 的调用复用这个 worker，常驻代码在写调用的 active 窗口里经 W6 写入。另一个情形是吊销。PAT 1 被吊销后，它留下的代码仍在 PAT 2 的调用中运行。

设计：key 增加 `grantId` 与排序后的 scope 集合。`grantId` 取 token exchange 返回的 `subject.kind` 与 `subject.id`（`apps/mcp/src/gateway/auth.ts`）。对 OAuth，`subject.id` 是 `oauth_grants` 的行 ID，refresh 后不变；对 PAT 是 PAT ID（`apps/workspace/server/src/modules/identity/access-tokens.ts`）。开发认证用 `dev:<session 的 SHA-256>`。网关的 grant 因此增加 `grantId`、`clientId`、`scopes` 三个字段（`apps/mcp/src/gateway/executor/grants.ts`、`apps/mcp/src/shared/executor-protocol.ts`）。Client Core 的 `caller` 增加可选的 `partition`，追加到 key 末尾；不传时 key 与现在相同，CLI 不变。

同一用户、同一授权、同一 scope 集合、同一 Unit 的调用共享一个 worker。这一组调用本来就是同一个主体、同一组权限，与 CLI daemon 的 worker 跨调用常驻相同。读写调用在同一 key 上仍然共享 worker，因为 key 不含 effect；读调用的 active 策略拒绝 W6。

**常驻代码在两次调用之间能做什么。** 调用结束后执行层把 key 的策略切到 `idle`：

- HTTP：只放行 W2 替身和目标的 W5 `fetchmissing`，让上游客户端在断线后能重连并 pull。拒绝 W1、W3、W4、W6 和 W8 至 W12。常驻代码因此只能读到目标 Unit 的更新，这是同一主体本来就能读的数据。
- WebSocket：连接保持，worker 发往服务端的帧仍按 4.6 节过滤。
- CPU：执行层每秒读取一次已登记 worker 的 node 进程的 `utime + stime`（经 `/proc` 找到外层 pid 之下的 node 进程）。一次空闲期内增长超过 `EXECUTOR_IDLE_CPU_MS`（默认 1000 ms，策略值）即 SIGKILL 该 worker 树，并计入 `mcp_executor_worker_kills_total{reason="idle_cpu"}`。下一次调用冷启动。
- 墙钟：空闲 TTL 仍为 `EXECUTOR_IDLE_TTL_MS`（默认 60 秒），到期由池回收。
- 内存：受 `RLIMIT_AS` 与堆上限约束，与 active 时相同。

考虑过在空闲时对 worker 发 SIGSTOP、调用前 SIGCONT。没有采用：上游池与 worker 之间的 IPC 和协同心跳在冻结期间的行为未知，可能让池把 worker 判为故障。空闲 CPU 检查只依赖 `/proc`，由 MG12 在 gVisor 下验证，并验证一个正常空闲的 worker 在 60 秒内不被误杀。

### 4.6 协同 WebSocket（问题 3）

W7 的 URL 是 `{PFX}/comb/connect?sessionTicket=<ticket>`，单元只出现在帧里（HELLO、JOIN `rooms:[{roomID}]`、HEARTBEAT，附录 B）。ticket 只绑定用户。

| 方案 | 做法 | 结果 |
| --- | --- | --- |
| A 只依赖服务端 `joinUnit` | 代理固定路径，帧原样转发 | 服务端只检查用户能否读该 Unit。worker 能加入用户能读的任何 room；如果协同协议允许经 WebSocket 提交变更，worker 能绕过 W6 的检查写入同一前缀下的其他 Unit |
| B 路径固定加帧过滤 | 代理固定路径；解析 worker 发往服务端的每一帧，只放行抓包确认过的帧类型；JOIN 的 room 集合必须等于 `{目标 unitId}`；未知类型或解析失败即关闭连接 | 不依赖对服务端协议的假设，失败时拒绝 |

**选择 B。** 服务端发往 worker 的帧不过滤，因为 worker 只加入了目标 room。代理接受 worker 的升级请求后，用替身 ticket 找到 binding，自己取真实 ticket（以 session 调 W2），再打开到 `WORKSPACE_TRANSPORT_URL` 上同一固定路径的上游连接。代理用 `ws` 包实现服务端与上游客户端，版本取锁文件中已有的 `8.21.3`，在 `apps/mcp/package.json` 中精确声明。

帧格式尚未抓取。实现按以下顺序确认，作为 PR G4b 的第一步：

1. 给代理加一个只用于本地验证的记录模式，全部放行，同时记录每个 HTTP 请求的方法、路由形状和每个 WebSocket 帧的类型与字段名，不记录内容。生产拒绝该模式。
2. 用该模式跑完整的执行层旅程矩阵（MX1 至 MX15、MH、MM、MT、MV、MR10 至 MR12），在 trunk 与 Worktree、Sheet、Doc、Slide、引用 Unit 的文档上各跑一次，并制造一次断线重连。
3. 把观察到的帧类型、字段和 HTTP 形状写进本文附录 B，同时回答附录 B 末尾列出的未决问题，再据此写路由表与帧白名单。
4. 如果帧不是可解析的文本或已知编码，代理不放行该连接，worker 在需要协同连接的操作上失败。届时向上游 Collaboration SDK 要协议说明（第 12 节 U4），不退回方案 A。

### 4.7 资源上限与公平（问题 4）

gVisor 下没有每进程的 cgroup：runsc 的 cgroupfs 是普通 tmpfs，写入不生效；容器级 `--memory`、`--cpus` 生效（附录 A 的 Q4）。可用的控制只有 rlimit、V8 堆上限、执行层的调度与 SIGKILL，以及容器级限制。设计：

| 控制 | 设计 | 依据 |
| --- | --- | --- |
| 每用户在途调用上限 | `EXECUTOR_MAX_ACTIVE_PER_USER`，默认 2。执行层在进入 Client Core 的槽位队列之前按用户排队，超过排队时间返回可重试的 `workspace-executor-timeout` | 与[架构 3.3](architecture.zh-CN.md#33-mcp-会给-workspace-server-带来的压力)建议的每用户 2 个并发一致。每个用户在全局 FIFO 里最多占 2 个位置，FIFO 因此近似公平 |
| 每用户 worker 上限与空闲淘汰 | Client Core 池增加 `maxWorkersPerCaller`（按 `caller.userId` 计，含空闲 worker），MCP 设为 2。用户达到上限时先淘汰自己最久未用的空闲 worker；池满且队首是其他用户时，淘汰全局最久未用的空闲 worker | 推断，未实测：Client Core 的槽位只计在途 key，池满时 `acquireLease` 对容量错误退避重试到期限（`content-runtime.ts`），说明上游池不会为新 key 主动淘汰空闲 worker，一个用户的空闲 worker 可能占满池直到 TTL 到期。MG8 确认 |
| 每用户作业上限 | `EXECUTOR_MAX_JOBS_PER_USER`，默认 1；全局 `EXECUTOR_MAX_JOBS` 仍为 2 | 当前一个用户能占满两个作业槽 |
| 单次调用墙钟 | 池的操作超时 `EXECUTOR_OPERATION_TIMEOUT_MS`（25 秒）。执行层在调用 deadline 后 1 秒仍未返回时，SIGKILL 该 worker 已登记的外层 pid | SIGKILL 包装器的 pid 会杀死整棵树，忙碌的子进程在 SIGKILL 后 0 至 6 ms 内退出（附录 A）。上游池超时时用哪个信号尚未确认，所以执行层自己补一次 SIGKILL |
| 单 worker CPU 总量 | `RLIMIT_CPU` 作为 worker 生命周期内的 CPU 秒数预算，`EXECUTOR_WORKER_CPU_SECONDS` 默认 300（策略值）。用完后 worker 被内核杀死，下一次调用冷启动 | prlimit 的 CPU 上限在 runsc 下生效（附录 A）。它是累计值，不是速率 |
| 单 worker 内存 | `EXECUTOR_WORKER_AS_MB` 默认 2048，`EXECUTOR_WORKER_HEAP_MB` 默认 1024 | node 空闲时 VmSize 约 0.95 至 1.0 GB，AS 1024 MB 时能启动，2048 MB 时还能再分配 512 MB（附录 A）。真实 Unit 的 VmPeak 未测，PR G5 测量后调整 |
| 作业子进程 | AS 同上，堆仍为 `EXECUTOR_JOB_HEAP_MB`（256），CPU 秒数等于作业预算 | 架构 D4 节 |
| 进程数 | 包装器设置 `RLIMIT_NPROC` | 内核 uid 在所有 worker 与父进程之间共享，`RLIMIT_NPROC` 可能按 uid 合并计数。MG3 必须证明一个 worker 的 fork 洪水不阻止其他 worker 和父进程 fork；若不能证明，PR G5 改用 Node 权限模型禁止 worker 创建子进程（`--permission`，不授予 `--allow-child-process`），并保持 `/tmp` 为 `noexec` |

**容器预算。** RSS 不超过 AS，但 AS 不是 RSS 的紧上界。按“单个用户不能让执行层容器 OOM”来定预算：

```text
容器内存 ≥ 父进程 417 MiB
          + 单用户最坏占用：2 个 worker × 2048 + 1 个作业 × 2048 = 6144 MiB
          + 其余槽位按常驻基线：2 个 worker × 310 + 1 个作业 × 512 = 1132 MiB
          ≈ 7.5 GiB，取 8 GiB（EXECUTOR_MAX_WORKERS=4）
```

417 MiB 与 310 MiB 来自[架构 6.2](architecture.zh-CN.md#62-worker-池)的常驻内存表，512 MiB 的作业基线是预算假设。这是算术，不是测量；runsc 下容器达到内存上限时内核杀单个进程还是整个沙箱，原型没有测（附录 A 只测了单进程容器，返回 137），由 MG7 测量。CPU 方面，一个用户最多同时运行 2 个 worker 和 1 个作业，约 3 个核；执行层容器给 6 vCPU 时，其他用户至少保留约 3 个核。

**剩余风险。** 没有每 worker 的 CPU 速率限制和 RSS 限制。一个用户能在自己的配额内持续占用约 3 个核和最多约 6 GiB 内存，使同一执行层上其他用户变慢；多个用户串通可以让容器 OOM，导致该执行层上所有在途调用失败、容器重启。消除它的办法是每租户沙箱：每个用户（或每个 worker）一个 gVisor 沙箱，容器级 cgroup 即成为每租户限制。代价是每次冷启动多一次沙箱启动（runsc 下 `docker run true` 中位数 263 ms，附录 A），以及每个沙箱自己的 Sentry 内存。阶段 H 的限流（每用户并发与每分钟写入）进一步降低持续占用。

### 4.8 父进程出网（问题 5）

`WorkspaceHttp.content()` 对非同源的签名 URL 不带凭据直接请求任意 http(s) 主机（`packages/client-core/src/http.ts`）。当前 Workspace 的 `resolveContentUrl` 只返回同源相对路径（`apps/workspace/server/src/modules/univer-assets/univer-assets.service.ts`），所以这个分支今天不会触发；但执行层父进程不应依赖服务端永远这样做。

设计：

1. 执行层所有对外请求都经 `dispatch.ts` 里同一个注入的 fetcher（grant 校验器的 fetcher 也改为复用它）。fetcher 只放行 origin 等于 `WORKSPACE_TRANSPORT_URL` 或 `MCP_RENDERER_URL` 的请求，其余抛出 `workspace-egress-refused`，不发出请求。一个守卫覆盖所有调用方，不需要逐个修改。
2. 不改 Client Core 的 `content()`，CLI 行为不变（[README 4.1](README.zh-CN.md#41-cliappscli)）。Markdown 路径已经只接受同源内容端点（`packages/client-core/src/markdown-assets.ts`），本守卫与之一致。
3. 网络层：执行层容器的出网策略只允许到 Workspace 与渲染服务（第 8 节），作为第二道防线。第 7 节的出网自检验证这一层确实存在。

### 4.9 作业子进程

Office 导入导出、Typst 编译、Markdown 物化在作业子进程里解析不可信字节（A3）。设计：

- `jobs/run.ts` 的 `fork` 显式传入 `execPath` 指向 `ns-job` 包装器。命名空间、只读根、私有 `/tmp`、rlimit 与 worker 相同；没有代理 socket，网络命名空间里只有 `lo`。
- `HOME`、`TMPDIR` 继续指向私有临时目录（现在由父进程在 `/tmp` 下创建，包装器内改为子进程自己的 tmpfs）。导出作业另外挂载 license 用量目录（第 6 节），其他作业不挂载。
- 作业照旧只收到 license 与 license key，不收到 session、grant 或 Workspace 地址（架构 D4 节）。license key 对作业子进程可见是必要的：转换在子进程内调用 exchange-node。被攻破的作业能读到它，这是第 10 节列出的剩余风险。
- SIGKILL 作用于包装器的外层 pid，整个树一起退出。

### 4.10 密钥与内部令牌

- 每个密钥以 `<NAME>_FILE` 环境变量给出文件路径，进程启动时读取并只保存在内存里。涉及 `MCP_OAUTH_CLIENT_SECRET`（网关）、内部令牌、`METRICS_TOKEN`、`UNIVER_LICENSE_KEY`。生产环境设置了明文变量即拒绝启动（第 7 节）。
- 密钥文件放在 `/run/secrets/univer-mcp`。worker 与作业的包装器在该目录上挂空 tmpfs，所以即使内核 uid 相同也读不到。
- 内部令牌按调用方向拆成两个：`MCP_EXECUTOR_TOKEN_FILE`（网关调用执行层，网关与执行层持有）和 `MCP_RENDERER_TOKEN_FILE`（执行层调用渲染服务，执行层与渲染服务持有）。渲染服务不再持有能调用执行层的令牌，Chromium 逃逸后拿到的令牌没有用处。当前三个角色共用一个 `MCP_INTERNAL_TOKEN`（`apps/mcp/docker/compose.verify.yml`）。
- worker 的显式环境变量保持只有 `NODE_ENV` 加 4.2 节的非密钥限制值。

### 4.11 Client Core 的改动

全部是增量选项，默认等于现在的行为，CLI 不改调用（[README 4.1](README.zh-CN.md#41-cliappscli)）。

| # | 改动 | 原因 |
| --- | --- | --- |
| C10 | `createWorkspaceContentRuntime` 增加宿主侧 HTTP 选项，用于提交前的内嵌图片上传；不传时沿用 `init.credential` 与 `init.transportOrigin` | 4.3 节第 5 点 |
| C11 | `WorkspaceRuntimeCaller` 增加可选 `partition`，追加到运行时 key | 4.5 节 |
| C12 | 运行时增加 worker 退役回调（`destroy-start`、`instance-failed` 时调用，参数为 key） | 代理据此作废 capability 与 pid 登记 |
| C13 | 池选项 `maxWorkersPerCaller` 与空闲淘汰 | 4.7 节 |

## 5. 渲染服务设计

### 5.1 Chromium 沙箱

`@univer-cli/univer-render-runtime` 固定传入 `--no-sandbox`。在上游提供开关之前（第 12 节 U2），`UNIVER_RENDER_BROWSER` 指向镜像内的包装脚本（设计为 `apps/mcp/docker/chromium.sh`，新），它去掉 `--no-sandbox` 后 `exec /usr/bin/chromium`。原型在 runsc 下证明了这种包装器可用，且 Chromium 的 renderer 进程处于独立的 user、net 命名空间并启用 seccomp（附录 A 的 Q2）。runc 下沙箱启动失败（“No usable sandbox”），所以 macOS 上的本地运行需要显式的 `RENDERER_CHROMIUM_SANDBOX=0`，生产拒绝该值（第 7 节）。

### 5.2 每任务隔离

| 方案 | 每任务成本 | 隔离 | 是否依赖上游 |
| --- | --- | --- | --- |
| A 每任务一个 runtime（一个 Chromium） | runsc 下首次截图约 2.4 秒（启动约 1.2 秒，首次渲染约 1.2 秒，附录 A）；本机热截图为 584 ms（[架构 7.1.1](architecture.zh-CN.md#711-容量测量2026-11-09)） | 进程级，任务之间不共享浏览器 | 否 |
| B 常驻浏览器，每任务一个 BrowserContext | 未测；不需要启动浏览器，但每个 context 要重新加载渲染页面 | 按 Chromium 的进程模型，renderer 进程不跨 BrowserContext 共享（推断，未在本仓库实测）；浏览器主进程与 GPU 进程共享 | 是，`createUniverRenderRuntime` 不能注入浏览器或 context |

**选择 A，现在实现；B 作为上游提供 BrowserContext 选项后的切换目标。** A 不等上游，隔离更强，代价可以测量；切到 B 是性能改进，不是安全前提，切换前须在 runsc 上测量并重跑 MG11。

A 的具体做法：

- **任务的定义。** 一个任务是一次执行层请求（同一个 `requestId`，属于同一个用户）。`compile_svg` 在一次请求里逐行调用 `measureText`（[架构 2.2](architecture.zh-CN.md#22-去向)），这些调用共享该任务的 runtime。渲染 RPC 头增加 `task: { id, deadlineAt }`；执行层在处理函数结束时发送 `task.end`。渲染服务在收到 `task.end` 或 deadline 到达时关闭该 runtime，不归还给池。截图、打印、lint 是单次调用，调用结束即关闭。
- **备用 runtime。** 池在后台预先启动从未使用过的 runtime，任务取走一个，用完关闭，再启动替补。备用数计入 `RENDERER_MAX_RUNTIMES`，内存预算与 7.1.1 节相同（默认 2 个 runtime，3 GiB 容器）。每任务的延迟因此接近 7.1.1 节“预热 runtime 首次使用”一列，而不是冷 runtime 一列，具体数值由 9.4 节测量。
- 池的“输入错误归还 runtime”分支删除：任何结束都关闭。

### 5.3 故障后先应答，再强杀进程树

[架构 7.1.2](architecture.zh-CN.md#712-已知问题与后续)的第一条：超时或 runtime 故障时，池先 `await` 关闭再抛错，请求超过 40 秒不应答，被丢弃的浏览器还存活约 2 分钟。设计：

- 池在超时或故障时立即抛错，关闭在后台进行。
- 5.1 节的包装脚本把 Chromium 放进一个新的进程组，并把组 ID 写入每个 runtime 独有的文件（路径经 `createUniverRenderRuntime` 的 `env` 传入，`env` 是每个 runtime 独立的）。后台关闭 2 秒未完成时，渲染服务向该进程组发 SIGKILL。Chromium 的沙箱子进程在自己的 pid 命名空间里，预期随 zygote 退出（推断），由 MG17 验证没有遗留。
- 每任务关闭（5.2 节）走同一条路径，所以正常任务结束后也不会遗留浏览器进程。
- MG17 复现 7.1.2 的两种触发条件，要求在 deadline 之前应答，5 秒内没有该 runtime 的 Chromium 进程。

### 5.4 网络与凭据

渲染服务只接受执行层的请求，没有任何出网，包括 DNS（第 8 节）。它只持有渲染方向的内部令牌和指标令牌（4.10 节），不持有用户凭据（[架构 7.1](architecture.zh-CN.md#71-渲染服务)）。

## 6. license 用量存储（C7，问题 6）

exchange-node 的 README 要求进程有“可写的本地持久存储”记录导出用量，存储不可用时返回 `LICENSE_USAGE_STORAGE_ERROR`，并说明商业导出按 License ID 分别计数。README 没有说明存储位置是否可配置、多个进程或多个副本能否共享同一目录。当前每个作业使用私有临时目录（架构 D4 节），用量在作业结束时丢失。

设计：

1. **位置。** 一个专用卷挂到执行层的 `MCP_LICENSE_USAGE_DIRECTORY`（例如 `/var/lib/univer-mcp/license-usage`），只用于这件事。它不是产品数据卷，不与网关的暂存卷共享，要求 6 不受影响。实现先确认 SDK 写到哪里：用不同的 `HOME`、`XDG_STATE_HOME` 运行一次导出并列出新文件。导出作业把确认后的那个变量指向该卷，`HOME` 等其他变量仍指向私有临时目录。
2. **可见范围。** 只有导出作业的包装器挂载该目录；worker、导入作业、Typst 与 Markdown 作业都看不到它（4.2、4.9 节）。
3. **同一副本内的并发。** 如果下面验证的第 4 步显示两个并发导出写同一目录会损坏记录，执行层在每个副本内串行化导出作业（作业队列里一个导出专用的锁）。
4. **多副本。** SaaS 中每个执行层副本一个独立的持久卷（StatefulSet 的 `volumeClaimTemplates`），不共享。各副本分别计数，同一 License ID 的总用量是各副本之和。

验证（MG19）：

1. 记录用量查询结果，连续导出 N 次，再查询，差值为 N。
2. 重启执行层容器，查询结果不变。
3. 在导出过程中 SIGKILL 作业子进程，以及 SIGKILL 整个容器；之后的查询与导出返回成功或 SDK 文档化的错误码，不出现 `LICENSE_USAGE_STATE_INVALID`，计数为 N 或 N+1。
4. 同一副本内并发导出 2 个，计数正确。
5. 两个副本（`compose.verify.yml` 已有 `executor-b`）各自导出，各自的计数独立，互不损坏。
6. 本地验证使用的 license 必须有足够的导出配额；exchange-node README 写明免费额度每月 10 次，旅程开始前查询余额，不足时停止并报告，不消耗生产 license。

**上游阻塞。** 如果产品负责人要求同一 License ID 在所有副本之间共享一个计数，或验证的第 4、5 步表明并发写不安全且无法在副本内串行化解决，就需要上游提供共享用量后端或对同一目录多进程写入的保证（第 12 节 U3）。在那之前的退路是网关把 `exchange.export` 固定路由到一个指定副本（rendezvous 使用常量 key），由该副本的一个卷记录全部用量，代价是导出吞吐只有一个副本的作业槽。未通过 MG19 之前，不发布多用户 Office 导出（阶段 G 验收标准）。

## 7. 拒绝不安全配置（要求 7）

镜像的 `NODE_ENV` 默认为 `production`（`apps/mcp/Dockerfile`），所以忘记配置时得到生产行为。每一项放宽都是一个显式变量，默认值是安全值；`NODE_ENV=production` 时设置任何放宽值都拒绝启动。

启动顺序：解析配置，运行自检，全部通过后才监听端口；任一失败则以非零码退出，日志写出失败的检查名，不写密钥。`/healthz` 只在监听后存在，所以 Kubernetes 看到的是 CrashLoop，而不是降级运行。非生产环境下，放宽项生效时 `/healthz` 返回的 JSON 列出 `insecure` 项，`verify-uvw doctor` 显示它们。

| 角色 | 检查 | 生产下失败即拒绝启动 |
| --- | --- | --- |
| 全部 | 密钥只来自 `*_FILE`；明文环境变量出现即失败；文件存在、非空、不被其他用户可写 | 是 |
| 全部 | 内部令牌至少 32 字符；网关→执行层与执行层→渲染服务两个令牌不相等 | 是 |
| 网关 | `MCP_DEV_SESSION_PASSTHROUGH` 为空（已实现） | 是 |
| 执行层、渲染服务 | 运行在 gVisor 下：`os.release()` 含 `gvisor`（附录 A 测得 `4.19.0-gvisor`） | 是 |
| 执行层 | `MCP_EXECUTOR_CREDENTIALS=proxy`。阶段 D 的 `session` 模式（worker 直接持有 session）在 PR G9 中删除 | 是 |
| 执行层 | `EXECUTOR_WORKER_ISOLATION=namespace`；4.2 节的 worker 包装器自检与作业包装器自检全部通过 | 是 |
| 执行层 | 出网自检：父进程连接 `MCP_EGRESS_PROBE_TARGETS`（默认 `169.254.169.254:80` 与一个公网地址）必须在 2 秒内失败；连接 Workspace 与渲染服务必须成功 | 是 |
| 执行层 | `MCP_LICENSE_USAGE_DIRECTORY` 已设置、可写，且是一个独立挂载点（设备号与父目录不同） | 是 |
| 渲染服务 | `RENDERER_CHROMIUM_SANDBOX` 未设置为 `0`；启动一个备用 runtime，检查 Chromium renderer 进程的 `/proc/<pid>/status` 中 `Seccomp` 为 2 且 user 命名空间与浏览器主进程不同（附录 A 的检查方式） | 是 |
| 渲染服务 | 出网自检：连接 `MCP_EGRESS_PROBE_TARGETS` 必须失败 | 是 |

当前执行层在 `NODE_ENV=production` 时一律拒绝启动。这条拒绝保留到 PR G9，由上表替代。

## 8. 网络与挂载（要求 5、6）

| 角色 | 入站 | 出站 | 挂载 |
| --- | --- | --- | --- |
| 网关 | ingress | Workspace、执行层 | 暂存卷 |
| 执行层父进程 | 只有网关 | Workspace（`WORKSPACE_TRANSPORT_URL`）、渲染服务；DNS 只在集群 DNS 必需时放行 | license 用量卷、密钥文件 |
| worker、作业子进程 | 无 | 无（只有 `lo`，worker 另有代理 socket） | 无；只读根，私有 tmpfs |
| 渲染服务 | 只有执行层 | 无 | 密钥文件 |

执行层和渲染服务都不挂载 Workspace 的数据卷或网关的暂存卷。Kubernetes 的 NetworkPolicy 与卷属于阶段 H 的 Helm release，本表是它们必须满足的规格。本地验证由 `verify-uvw` 的 compose 网络与 `doctor` 模拟，MG4 与 MG9 验证。

## 9. 验证（问题 7、8）

### 9.1 七条要求与旅程

MG1 至 MG11 定义在 `.agents/skills/verify-uvw/features/mcp-security.md`（G1，#266）：MG1 凭据与 scope，MG2 环境变量密钥，MG3 子进程与 Node 内置模块，MG4 网络可达，MG5 跨用户 `/proc` 与 tmp，MG6 失控 CPU，MG7 内存耗尽，MG8 池公平，MG9 挂载，MG10 配置失败即关闭，MG11 渲染服务共享。MG1、MG3 不写成攻击脚本，而是作为防线测试随 G4b、G5 交付（代理拒绝白名单之外的路由、worker 初始化数据里没有 session、包装器自检），它们在 `main` 上的基线由代码给出（`packages/client-core/src/content-worker.ts` 把 session 作为 `credential` 交给 worker）。#266 在 `main` 26c1b69d 上的基线：MG6、MG9 受控；MG2、MG4、MG5、MG7、MG8、MG10、MG11 暴露。MG12 至 MG19 由本文新增（9.2 节）。

每条旅程先在当前 `main` 上记录“暴露”，再由对应 PR 变为“受控”（第 11 节）。门禁结果必须来自 runsc 拓扑（9.3 节）。

| 要求 | 旅程 |
| --- | --- |
| 1 读不到其他用户的数据或凭据 | MG1、MG2、MG5、MG9、MG11、MG13、MG16、MG17 |
| 2 权限不超过本次调用所需与授予的 scope | MG1、MG12、MG13、MG14、MG15 |
| 3 不能中断或拖垮其他用户 | MG3、MG6、MG7、MG8、MG12 |
| 4 CPU、内存、墙钟上限，超限终止并回收 | MG6、MG7、MG12、MG16、MG17 |
| 5 只访问必需的网络目标 | MG4、MG14、MG18 |
| 6 不挂载产品数据卷 | MG9 |
| 7 安全配置错误拒绝启动 | MG10 |
| C7 门禁 | MG19 |

MG1 在新设计下的通过条件需要补充：worker 内只能找到 capability，找不到 session；从 worker 外重放 capability 失败（代理只在 Unix socket 上接受它）；W6 对其他 Unit、其他 Worktree、路径与 body 不一致的请求都返回 403；读调用中的 W6 返回 403；替身 ticket 不能在代理之外使用。

### 9.2 新增旅程

| # | 名称 | 步骤 | 通过条件 |
| --- | --- | --- | --- |
| MG12 | 空闲 worker 滥用 | 脚本留下 `setInterval`，在调用返回后尝试 W1、W3、W6、W8 和一个忙循环；另起一个只做正常调用的 worker 空闲 60 秒 | 空闲期的 HTTP 尝试全部 403 并有 `mcp.proxy_denied`；忙循环在约 1 秒 CPU 后被杀，`mcp_executor_worker_kills_total{reason="idle_cpu"}` 加 1；正常空闲 worker 不被杀 |
| MG13 | 跨授权与 scope 的复用 | 同一用户用只读 PAT 在 Unit 上留下常驻代码，再用全 scope PAT 对同一 Unit `execute`；吊销第一个 PAT 后再调用 | 第二次调用是冷启动（`executor: cold_start`），常驻代码没有在写调用期间出现任何请求；吊销后第一个 PAT 的 worker 不再收到任何 active 窗口 |
| MG14 | WebSocket 越权 | worker 内自行打开到代理的 WebSocket，JOIN 其他 Unit 的 room，发送未知类型的帧，用替身 ticket 连接其他前缀 | 越权 JOIN 与未知帧使连接被关闭；其他前缀的升级请求 403；目标 Unit 的正常协同不受影响 |
| MG15 | 引用 Unit 读取 | 文档引用另一 Unit；分别用含 `read` 与只含 `write` 的授权 `execute`；脚本直接请求其他 Worktree 前缀的快照 | 含 `read` 时引用加载成功；只含 `write` 时引用读取 403、目标 Unit 正常；其他 Worktree 前缀一律 403 |
| MG16 | 作业子进程隔离 | 导入一个触发长时间解析的文件，在作业中尝试出网、读父进程 environ、读密钥目录、写 `/tmp` 以外的路径 | 只有 `lo`；读取全部失败；超出预算时整棵树在 deadline 内被 SIGKILL；临时目录被清理 |
| MG17 | Chromium 沙箱与故障恢复 | 截图后检查 Chromium 各进程的 seccomp 与命名空间；杀掉页面进程；让容器 OOM 杀一个 Chromium 进程；连续两个用户的截图 | renderer 进程 `Seccomp: 2` 且 userns 与浏览器主进程不同；两种故障都在 deadline 前返回可重试错误，5 秒内没有遗留 Chromium；两个用户的任务使用不同的浏览器进程 |
| MG18 | 执行层父进程出网 | 用测试替身让 sign-url 返回跨域 URL；从父进程连接云元数据地址与公网地址 | 跨域 URL 得到 `workspace-egress-refused` 且没有发出请求；网络层连接失败 |
| MG19 | license 用量存储 | 第 6 节的六个步骤 | 第 6 节 |

每条旅程按 `features/mcp.md` 的既有格式写成可重复执行的脚本，证据进入本次运行目录，不含 token、cookie 或 capability。

### 9.3 runsc 验证拓扑

新增 `VERIFY_UVW_SANDBOX_HOST=<hc machine 名>`，默认不设置。设置后：

```text
macOS（不变）
  Workspace Server 127.0.0.1:3920、Vite 5973、uvw、agent-browser、opencode、verify-uvw mcp 客户端
  Docker Desktop：gateway 容器
     │ MCP_EXECUTOR_URLS = http://host.docker.internal:<L>
     ▼
  ssh -N -L <L>:127.0.0.1:<E> -R <R>:127.0.0.1:3920  minsky-ubuntu-remote（verify-uvw 持有，down 时关闭）
     │
minsky-ubuntu-remote（Linux aarch64，Docker + runsc）
  compose 项目 verify-uvw-<run-id>-sandbox，经 DOCKER_HOST=ssh://<主机> 管理
    executor 容器（runtime: runsc）发布到 127.0.0.1:<E>
      WORKSPACE_TRANSPORT_URL 指向一个转发点，转发点连到 127.0.0.1:<R>
    renderer 容器（runtime: runsc），只在 internal 网络上
```

- Linux 上的容器不能访问宿主只监听 `127.0.0.1` 的进程（[本地验证](local-verification.zh-CN.md) R5），所以执行层到 Workspace 需要一个转发点。候选是宿主网络中的转发进程，绑定在 compose 网络的网关地址上，不对局域网开放，也不需要修改 sshd 的 `GatewayPorts`。PR G2 实测后选定，写回 `local-verification.zh-CN.md`。
- `doctor` 新增检查：两个容器内 `uname -r` 含 `gvisor`；执行层只能到达转发点与渲染服务；渲染服务没有任何出网；隧道往返时延（写入证据，供 9.4 节使用）。
- 镜像在远端构建（`docker build` 经 ssh 发送构建上下文），两台机器都是 arm64。
- 选择拆分拓扑，而不是整个运行都放到 Linux：后者需要在 Linux 上运行 Workspace、Vite、浏览器与 opencode，而且网关容器同样受 R5 限制。拆分拓扑保留 macOS 上已验收的全部客户端旅程。

**macOS Docker Desktop 上能证明什么。** Docker Desktop 是 runc 加默认 seccomp：`unshare` 被拒绝，Chromium 沙箱无法启动（附录 A）。本地运行因此需要 `EXECUTOR_WORKER_ISOLATION=none` 与 `RENDERER_CHROMIUM_SANDBOX=0`，此时 worker 与执行层共享网络，代理在 TCP 回环上监听。

| 能证明 | 不能证明 |
| --- | --- |
| 代理的策略逻辑：capability、替身 ticket、路由表、W6 校验、帧过滤、空闲策略、复用 key（MG1、MG12 的 HTTP 部分、MG13、MG14、MG15 的策略结果） | worker 不能绕过代理（没有网络命名空间时它能直接连 Workspace） |
| 密钥不在环境变量里、内部令牌拆分、父进程出网守卫的代码路径（MG2、MG18 的代码部分） | 跨 worker 的 `/proc`、`/tmp`、挂载隔离（MG5、MG9） |
| 每用户上限与公平（MG8）、license 用量的重启与多副本（MG19） | rlimit 在包装器内的效果、墙钟 SIGKILL 杀死整棵树（MG6、MG7、MG16） |
| 生产配置在 runc 上拒绝启动（MG10 的 gVisor 检查一项） | Chromium 沙箱（MG17）、gVisor 的系统调用面、网络策略（MG4） |
| 功能回归：阶段 D、E 旅程在放宽配置下仍通过 | runsc 下的性能（9.4 节） |

阶段 D、E 的全部验收必须在 runsc 拓扑上重新通过；macOS 上的结果只作为开发反馈。

### 9.4 性能复测（问题 8）

基线是[架构 6.2](architecture.zh-CN.md#62-worker-池)（冷 `inspect` 中位数 1501.9 ms，热 `inspect` 14.4 ms，热小 `execute` 14.7 ms，单 worker RSS 中位数 244.2 MiB）、[架构 3.3](architecture.zh-CN.md#33-mcp-会给-workspace-server-带来的压力)（1、2、4、8 个 writer 的持续写入）和[架构 7.1.1](architecture.zh-CN.md#711-容量测量2026-11-09)（渲染的冷、热、吞吐与内存）。这些数字来自 macOS Docker Desktop，硬件与拓扑都不同，不能直接相减。

复测在 9.3 节的拓扑上做两组，命令与 JSON 字段沿用 `.agents/skills/verify-uvw/bin/mcp-bench.mjs` 与 `renderer-bench.mjs`：

- A 组：在 PR G2 上测量，即 runc 下当前 `main` 的执行层与渲染服务（worker 直接持有 session、没有包装器、渲染池复用 runtime）。
- B 组：runsc 加本文的全部设计。

报告 B 相对 A 的差值，并附隧道往返时延，读者可以据此扣除网络部分。要复测的量：

| 量 | 预期的变化来源 | 已有的线索 |
| --- | --- | --- |
| 冷 worker 打开 | runsc 与包装器 | 原型中 Univer worker 冷启动中位数 497 ms（runc）对 784 ms（runsc），包装器另加约 0（499 对 775，附录 A） |
| 热 `inspect`、热小 `execute` | 代理多一跳 HTTP、WebSocket 帧过滤 | 未测 |
| 单 worker RSS 与 VmPeak | 堆上限与 AS | 未测；同时用于 4.7 节调整 AS |
| 1、2、4 个 writer 的持续写入吞吐与 p50、p95 | 代理对 W6 与 WebSocket 的开销 | 未测 |
| 截图、打印、lint 的单次延迟 | 每任务 runtime 与备用 runtime | runsc 下首次截图约 2.4 秒（附录 A）；7.1.1 节本机预热首次使用 1646 ms、热 584 ms（Sheet 截图） |
| `compile_svg` 量字 | 每任务 runtime | 7.1.1 节热 `measureText` 3 ms、预热首次 60 ms |
| 渲染吞吐（1、2 个 runtime） | 每个任务启动一个浏览器的 CPU | 未测 |

结果写回架构 6.2、3.3、7.1.1 节，作为单独的小节，不覆盖原基线。是否可以接受由评审者与产品负责人确认（阶段 G 验收标准）；本文不预设阈值。

## 10. 剩余风险

| 风险 | 条件 | 消除办法 |
| --- | --- | --- |
| 一个用户在配额内持续占用约 3 个核、最多约 6 GiB 内存，使同一执行层上其他用户变慢 | gVisor 下没有每进程 cgroup（4.7 节） | 每租户沙箱；阶段 H 的限流降低持续占用 |
| 多个用户串通让执行层容器 OOM，所有在途调用失败 | 同上 | 每租户沙箱 |
| 同一执行层容器内所有 worker 共享一个 gVisor Sentry；Sentry 逃逸可读取父进程内存中在途调用的 session | gVisor 漏洞 | 每租户沙箱 |
| 被攻破的作业子进程能读到 license key，导出作业能篡改本副本的用量记录 | 原生解析器漏洞 | 上游让 license 校验与用量记录留在父进程（U3） |
| 同一用户、同一授权、同一 scope 集合内，前一次调用留下的代码影响后续调用的结果 | 设计接受，4.5 节 | 不复用 worker（放弃热缓存） |
| 空闲 worker 在被检测前最多消耗约 1 秒 CPU | 4.5 节的采样间隔与阈值 | 上游池支持冻结空闲 worker |

## 11. PR 计划

按 [README](README.zh-CN.md) 与根 `AGENTS.md` 的规则组织：互相依赖的组成 stack，其余各自从 `main` 开分支。先合入探针旅程，每个后续 PR 把列出的旅程从“暴露”变为“受控”，所以每个 PR 都能单独验证。

| PR | 标题 | 要求 | 旅程由暴露变为受控 | 依赖 | 主要文件 |
| --- | --- | --- | --- | --- | --- |
| G1 | `test(mcp): add stage G isolation baseline journey`（[#266](https://github.com/dream-num/univer-workspace/pull/266)） | 全部 | 记录 MG2、MG4 至 MG11 在 `main` 上的基线；MG1、MG3 随修复 PR 以防线测试交付 | 无 | `.agents/skills/verify-uvw/features/mcp-security.md`、`bin/mcp-security-probes.mjs` |
| G2 | `test(verify-uvw): run the executor and renderer on a gVisor host` | 全部 | 记录 MG12 至 MG19 的基线；A 组性能 | G1 | `bin/verify-uvw`、`features/mcp.md`、`apps/mcp/docker/compose.verify.yml`、`local-verification.zh-CN.md` |
| G3 | `fix(mcp): read secrets from files and confine executor egress` | 1、5 | MG2、MG18 | G2 | `apps/mcp/src/shared/config*.ts`、`executor/dispatch.ts`、`executor/credentials.ts`、`renderer/server.ts`、`gateway/executor/`、`compose.verify.yml`、`apps/mcp/README.md` |
| G4a | `feat(client-core): host HTTP, caller partitions and worker retirement hooks` | 2 | 无（为 G4b 准备；CLI 测试与打包验证通过） | 无 | `packages/client-core/src/content-runtime.ts`、`runtime-target.ts` |
| G4b | `feat(mcp): broker worker Workspace access through a credential proxy` | 1、2 | MG1、MG13、MG14、MG15，MG12 的 HTTP 部分 | G3、G4a | `apps/mcp/src/executor/proxy/`（新）、`executor/runtime.ts`、`executor/credentials.ts`、`executor/worker.ts`、`gateway/executor/grants.ts`、`gateway/auth.ts`、`shared/executor-protocol.ts`、`apps/mcp/package.json` |
| G5 | `feat(mcp): run workers and conversion jobs in namespaces with limits` | 1、3、4、5、6 | MG3、MG4、MG5、MG6、MG7、MG9、MG16，MG12 的 CPU 部分 | G4b | `apps/mcp/docker/ns-worker.sh`、`ns-job.sh`（新）、`apps/mcp/Dockerfile`、`executor/server.ts`、`executor/worker.ts`、`executor/jobs/run.ts`、`shared/config-executor.ts` |
| G6 | `feat(mcp): cap workers, calls and jobs per user` | 3 | MG8 | G2 | `packages/client-core/src/content-runtime.ts`、`apps/mcp/src/executor/dispatch.ts`、`executor/jobs/queue.ts` |
| G7 | `feat(mcp): isolate each render task and enable the Chromium sandbox` | 1、3、4 | MG11、MG17 | G2 | `apps/mcp/src/renderer/pool.ts`、`renderer/server.ts`、`shared/renderer-protocol.ts`、`executor/renderer-client.ts`、`apps/mcp/docker/chromium.sh`（新） |
| G8 | `feat(mcp): persist Office export license usage on a dedicated volume` | C7 | MG19 | G5 | `executor/jobs/run.ts`、`ns-job.sh`、`shared/config-executor.ts`、`compose.verify.yml` |
| G9 | `feat(mcp): refuse to start on insecure configuration` | 7 | MG10 | G3 至 G8 | 各角色的 `server.ts` 与 `shared/config*.ts`；删除 `MCP_EXECUTOR_CREDENTIALS=session` 与执行层对生产环境的一律拒绝 |
| G10 | `docs(mcp): record stage G verification and performance` | 全部 | 全部旅程在 runsc 上重跑；阶段 D、E 验收重跑；B 组性能 | G9 | 第 13 节列出的文档 |

G4b 的第一步是 4.6 节的抓包，结果写入本文附录 B。G5 只能在 runsc 拓扑上验收。G3、G4a、G6、G7 只依赖探针旅程（G1、G2），可以从 `main` 各自开分支并行实施；G6 与 G4a 都修改 `content-runtime.ts`，后合入的一个需要 rebase。

## 12. 上游需求

| # | 上游 | 需求 | 在此之前的做法 |
| --- | --- | --- | --- |
| U1 | Univer CLI SDK `@univer-cli/univer-collaboration-runtime-pool` | 每 worker 的 spawn 选项（可执行文件、参数、环境），返回子进程或 pid；说明操作超时时使用的信号 | `process.execPath` 指向包装器，worker 入口登记外层 pid，执行层自行 SIGKILL（4.2、4.7 节） |
| U2 | Univer CLI SDK `@univer-cli/univer-render-runtime` | 不硬编码 `--no-sandbox`，提供沙箱开关；支持注入浏览器或每任务创建 BrowserContext；暴露浏览器 pid 或强制关闭 | 包装脚本去掉 `--no-sandbox` 并记录 pid；每任务一个 runtime（5.1 至 5.3 节） |
| U3 | `@univerjs-pro/exchange-node` | 可配置的用量存储位置；多进程、多副本共享的用量后端，或对同一目录并发写入的明确保证；让用量记录不需要转换进程持有可写目录 | 每副本独立卷，必要时副本内串行化导出；退路是导出固定到一个副本（第 6 节） |
| U4 | Univer Collaboration SDK | 协同 WebSocket 帧协议的说明（类型、字段、哪些帧可以改变文档） | 抓包得到的白名单，未知帧关闭连接（4.6 节） |

## 13. 实现后需要更新的文档

本次只在 [README](README.zh-CN.md) 第 6 节的文档索引中加入本文，并在[阶段计划](stages.zh-CN.md)阶段 G 交付物 1 处指向本文。实现完成后（PR G10）更新：

- `architecture.zh-CN.md`：3.2 节表格中执行层和渲染服务的运行时改为已确认的 gVisor，渲染服务不出网；4.2 节最后一条指向本文；6.2 节的 key、每用户上限与新的 `EXECUTOR_*` 变量；6.4 节改为代理与 capability 的摘要；7.1 节去掉临时偏离与 `--no-sandbox`，写入每任务 runtime；7.1.2 节删除已修复的“故障后迟迟不应答”；9.1 节 C7 的状态与新增的 C10 至 C13；第 10 节标注已满足并指向本文；第 11 节的新变量（`*_FILE`、两个内部令牌、`EXECUTOR_WORKER_*`、`EXECUTOR_MAX_ACTIVE_PER_USER`、`EXECUTOR_MAX_JOBS_PER_USER`、`EXECUTOR_IDLE_CPU_MS`、`EXECUTOR_PROXY_PORT`、`EXECUTOR_WORKER_ISOLATION`、`RENDERER_CHROMIUM_SANDBOX`、`MCP_LICENSE_USAGE_DIRECTORY`、`MCP_EGRESS_PROBE_TARGETS`），删除 `MCP_INTERNAL_TOKEN`；D4 节的作业包装器与用量存储；新增 9.4 节的复测结果。
- `stages.zh-CN.md`：阶段 G 各验收条目的证据，以及阶段 D、E 重跑的记录。
- `apps/mcp/README.md`：配置项；部署要求（runsc、网络策略、license 用量卷、密钥文件、每副本卷）；删除“Stage G 之前仅限单用户”的说明；`mcp_executor_proxy_denied_total`、`mcp_executor_worker_kills_total` 指标。
- `apps/mcp/AGENTS.md`：删除“Until Stage G passes”与渲染池跨用户复用两条；新增规则：worker 永不收到 session；代理路由表是 worker 的唯一放行清单，新增 worker 路由必须先进表并有旅程；执行层不得新增未显式传 `execPath` 的 `fork`；渲染 runtime 不跨任务复用。
- `local-verification.zh-CN.md`：9.3 节的拓扑与转发点的实测结论。
- `DREAMNUM.md`：部署交接新增 gVisor、网络策略与 license 用量卷的要求时更新（根 `AGENTS.md` 的规则）。

## 14. 评审记录

按 G8，先由不同模型家族做对抗评审，再由用户指定的人签字。评审者在此记录发现、复现方式和对本文的修订。

### 14.1 对抗评审

| 评审者（模型） | 日期 | 问题 | 复现 | 修订 |
| --- | --- | --- | --- | --- |
| | | | | |

### 14.2 签字

| 评审者 | 日期 | 结论 | 条件 |
| --- | --- | --- | --- |
| | | | |

## 附录 A. 沙箱原型实测（2026-11-09）

主机 `minsky-ubuntu-remote`：OrbStack Linux 虚拟机，内核 `7.0.11-orbstack`，aarch64，12 vCPU，12 GiB，cgroup v2，Docker 29.5.3，没有 `/dev/kvm`。镜像为 `main` `26c1b69d` 的 `apps/mcp/Dockerfile`（Node 24.22.2、Chromium 156.0.8078.79、Univer 1.4.0、用户 `node` uid 1000）。runsc `release-20261102.0`，平台 systrap。安装 runsc 需要二进制旁的 `gvisor-bin/` 目录。原型脚本与原始输出没有提交，PR G2 把其中的检查改写为 `doctor` 与 MG 旅程。

| 问题 | 结论 |
| --- | --- |
| Q1 注册 runsc | 可行，systrap 与 ptrace 平台都可用 |
| Q2 兼容性 | headless Univer 加 Rust 公式、exchange-node xlsx 往返、Typst、render-runtime 截图在 runc 与 runsc 下都通过。runsc 下 Chromium 以默认参数开启沙箱可用，renderer 进程 `Seccomp: 2`、user 与 net 命名空间独立；runc 下沙箱启动失败（“No usable sandbox”），需要放宽 seccomp 或 `SYS_ADMIN` |
| Q3 命名空间 | runsc 默认权限下，uid 1000 能 `unshare` user、pid、net、mount；经 `process.execPath` 指向包装器 fork 的 Node 子进程 IPC 正常（json 与 advanced）；网络隔离的子进程能经路径式 Unix socket 访问父进程的 HTTP 服务。runc 需要放宽 seccomp 并 `systempaths=unconfined`。bwrap 的 `--unshare-net` 在 runsc 下失败，`unshare -n` 可用 |
| Q4 资源上限 | `RLIMIT_AS`、`RLIMIT_CPU`、`RLIMIT_NPROC`、`RLIMIT_FSIZE` 与 `--max-old-space-size` 在两种运行时下生效。每 worker 的 cgroup 在 runsc 下不可能（cgroupfs 是普通 tmpfs）。容器级 `--memory`、`--cpus` 在 runsc 下生效；`--pids-limit=24` 让 runsc 沙箱无法启动。SIGKILL 让忙碌的子进程在 0 至 6 ms 内退出 |
| Q5 时间 | Univer worker 冷启动中位数 497 ms（runc）对 784 ms（runsc），经包装器 499 对 775 ms。首次 Chromium 截图 1668 ms（runc）对 2362 ms（runsc），runsc 开启沙箱 2420 ms。`docker run true` 在 runsc 下中位数 263 ms |

经包装器 fork 的子进程在 runsc 下：只有 `lo`；`/proc` 只看到自己；父进程 cmdline 返回 ENOENT；`/tmp` 私有；`/app` 只读；父进程环境变量中的密钥不出现在任何 environ 中（不经包装器的对照组能读到）；连接 1.1.1.1 返回 ENETUNREACH；父进程的回环 TCP 返回 ECONNREFUSED；路径式 Unix socket 的 HTTP 返回 200；抽象 socket 不可达。SIGKILL 包装器 pid 杀死整棵树；SIGTERM 被忽略（node 是 pid 命名空间的 1 号进程）。

带限制的包装器（`prlimit --as=3GiB --cpu=2`）：CPU 上限杀死了忙循环的 worker（父进程看到退出码 1，不是信号）；AS 上限让一次 4 GB 分配失败，worker 存活。空闲 node 的 VmSize：runc 约 1.0 GB，runsc 约 0.95 GB；AS 512 MB 时 node 无法启动，1024 与 2048 MB 可以。包装器运行时 `unshare` 打印 `sigprocmask unblock failed: Invalid argument`，不影响结果，PR G5 确认其来源。

原型发现的注意事项，已体现在正文：userns 里的 uid 只是外观，文件隔离要靠挂载命名空间（4.2 节）；`process.execPath` 是进程级的（4.2、4.9 节）；runsc 下没有每 worker 的 CPU 速率与 RSS 限制（4.7 节）；Chromium 没有在命名空间包装器内测试（本文不把它放进包装器，5.1 节）。

原型没有测：runsc 下热调用的延迟与吞吐、真实 Univer worker 的 VmPeak、Kubernetes RuntimeClass、KVM 平台、经 `pool.env` 的堆上限、runsc 下 `--read-only` 根文件系统、runsc 下容器内存上限时杀进程的范围。这些由 9.4 节、MG7 与 PR G5 补测。

## 附录 B. worker 与执行层父进程的 Workspace 路由

2026-11-09 的只读代码调查，结论经抽查，行号未逐条核对。`PFX` 是 `/universer-api`（trunk）或 `/universer-api/worktrees/{wt}`（Worktree），见 `packages/client-core/src/content-worker.ts`。`{type}`：doc=1、sheet=2、slide=3、base=5、board=6。`/universer-api/**` 由上游协同端点提供（`apps/workspace/server/src/integrations/univer/collaboration-gateway.ts`），不在 `apps/workspace/contracts/http` 中，所以路由表只能来自上游 README 与实际抓包。

### B.1 worker

| # | 方法 | 路径 | 用途 | 读写 | 目标标识 |
| --- | --- | --- | --- | --- | --- |
| W1 | GET | `/api/worktrees/{wt}` | Worktree 范围启动时读取成员、修订号与 Unit 映射（`reference-host.ts`）。trunk 不调用 | 读 | 路径中的 `wt` |
| W2 | GET | `/universer-api/user/session-ticket` | 打开与每次重连 | 读 | 无，ticket 只绑定用户 |
| W3 | GET | `{PFX}/snapshot/{type}/unit/{unitId}/rev/{n}` | 打开与加载 | 读 | 路径 |
| W4 | GET | `{PFX}/snapshot/{type}/unit/{unitId}/block/{blockId}` | Sheet 块 | 读 | 路径 |
| W5 | GET | `{PFX}/snapshot/{type}/unit/{unitId}/fetchmissing?from=&to=` | pull | 读 | 路径 |
| W6 | POST | `{PFX}/comb/{type}/unit/{unitId}/new_changes`，body `{changeset:{unitID,type,memberID,revision,userID}, memberID, type, unitID}` | 提交，worker 唯一的写 | 写 | 路径与 body |
| W7 | GET 升级 | `{PFX}/comb/connect?sessionTicket=<ticket>` | 协同连接；帧 HELLO、JOIN `rooms:[{roomID: unitId}]`、HEARTBEAT。不带 cookie，以 ticket 认证；由全局 `WebSocket` 建立，只有 `transportOrigin` 能改写它 | 通道 | 只在帧中 |
| W8 至 W12 | GET | `{refPFX}/snapshot/{type}/unit/{refUnitId}/rev/{rev}`、`/block/{blockId}`、`/snapshot/block/{type}/unit/{refUnitId}/block/{blockId}`、`/fetchmissing`、`/resources?resourceId=` | 引用 Unit 加载；`refPFX` 为已映射时的宿主 Worktree，否则 trunk | 读 | 用户能读的任何 Unit |

worker 不调用 Space、Node、Blob、Asset 或 exchange 路由。

### B.2 执行层父进程

父进程以 grant 的 session 发出请求（`apps/mcp/src/executor/dispatch.ts`）。这些请求由可信代码发出，不经代理，受 4.8 节的出网守卫约束。

| # | 方法 | 路径 | 操作 | 读写 |
| --- | --- | --- | --- | --- |
| P1 | GET | `/api/session` | grant 校验 | 读 |
| P2 | GET | `/api/worktrees/{wt}` | 目标解析 | 读 |
| P3 | GET | `/universer-api/snapshot/{type}/unit/{unitId}/rev/0` | trunk 目标解析，按类型依次探测，最多 5 次 | 读 |
| P5 | GET ticket 加 WebSocket 连接，不发帧 | | `diagnostics.probe` | 读 |
| P6 | POST | `/api/worktrees/{wt}/units` | `exchange.import`、Markdown 与 Typst 编译的 apply、HTML 创建 | 写 |
| P8 | POST | `/universer-api/worktrees/{wt}/stream/file/upload?assign={unitId}` | 提交前的内嵌图片上传（4.3 节第 5 点） | 写 |
| P9 | GET | `.../file/{assetId}/sign-url`，再 GET 返回的 URL | 导出、渲染、Markdown 的 Asset 读取（4.8 节） | 读 |
| P10 至 P14 | POST、PUT、GET | `/api/blob-upload-sessions*`、`/api/resources/{id}` | `htmlView.create` | 读写 |
| P15、P16 | GET | `/api/spaces/lookup?owner=&slug=`、`/api/spaces` | 仓库归属的回退查找 | 读 |

### B.3 待抓包确认

由 PR G4b 第一步回答（4.6 节），结果写回本附录：

1. W12 `/resources` 是否实际被调用，还是 404 后被容忍。
2. Worktree 范围路由的确切形状（目前来自上游 README，不是代码）。
3. WebSocket 帧的格式（HELLO、JOIN、HEARTBEAT、ACK 及其他）。
4. headless Univer 或 license 插件是否发出其他出网请求（阻断代理以外的全部出网，跑完整操作矩阵）。
5. 上游运行时中 URL 段的顺序。
6. 服务端是否要求 `x-univer-host` 请求头。
7. W2 的响应形状（替身 ticket 需要与之相同）。
