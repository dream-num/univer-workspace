# 执行层与渲染服务的多租户安全设计（阶段 G）

> 状态：设计稿，已按第一轮对抗评审修订（2026-11-09），待签字。本文是[阶段计划](stages.zh-CN.md)阶段 G 交付物 1，说明如何满足[架构](architecture.zh-CN.md#10-执行层安全门禁要求)第 10 节的七条要求。
> 文中“当前”指 `main` `26c1b69d` 的代码事实，附路径；“设计”“将”指尚未实现的行为。沙箱原型的实测数据见附录 A，评审后的补充实验见附录 C，两者的脚本都是一次性的，没有提交。评审发现与处理见 14.1 节。
> 决策编号 D1 到 D14 见 [README](README.zh-CN.md)。

## 1. 要解决的问题

D4 接受在服务端执行模型生成的代码。阶段 D、E 的执行方式只适用于本地和内部单用户环境，当前代码在多用户下有这些缺口：

| # | 缺口 | 代码事实 | 违反的要求 |
| --- | --- | --- | --- |
| 1 | worker 进程持有用户的完整 Workspace session | `apps/mcp/src/executor/runtime.ts` 的 `resolveCredential` 把 `workspace_session=<session>` 作为 `init.credential` 交给 worker；`packages/client-core/src/content-worker.ts` 用它构造 `WorkspaceHttp` | 1、2 |
| 2 | worker 能访问执行层能访问的任何网络目标，包括 Workspace 的全部路由 | worker 直接连接 `WORKSPACE_TRANSPORT_URL`，没有网络隔离 | 2、5 |
| 3 | 同一 uid 的 worker 能读执行层的 `/proc/1/environ`，其中有内部令牌和 license key | [架构 6.4](architecture.zh-CN.md#64-凭据) 已记录；`apps/mcp/src/shared/config-executor.ts` 从环境变量读取全部密钥 | 1 |
| 4 | worker 按用户复用，不区分 scope、客户端和授权 | `packages/client-core/src/runtime-target.ts` 的 `workspaceRuntimeKey` 只追加 `caller.userId`；`reuseExecutorWorker` 只检查 grant 是否临近过期 | 2 |
| 5 | worker 之间、worker 与父进程之间共享文件系统、`/tmp`、进程视图和内核 uid；worker 能创建子进程和线程 | worker 由上游池直接 `fork`，没有命名空间，与父进程同为 uid 1000 | 1、3、6 |
| 6 | 单个 worker 没有内存和 CPU 上限；一个用户可以占满池 | 池只有 `EXECUTOR_MAX_WORKERS` 和操作超时；跨 key 排队是全局 FIFO（`packages/client-core/src/content-runtime.ts`） | 3、4 |
| 7 | Office、Typst 作业子进程解析不可信字节，但没有网络隔离 | [架构 D4 节](architecture.zh-CN.md#d4-office-作业进程)；`apps/mcp/src/executor/jobs/run.ts` | 1、5 |
| 8 | 执行层父进程会无凭据地访问 Workspace 返回的任意跨域 URL | `packages/client-core/src/http.ts` 的 `content()` 对非同源 URL 直接 `fetch` | 5 |
| 9 | 渲染服务跨用户复用 Chromium 页面，且以 `--no-sandbox` 启动 | `apps/mcp/src/renderer/pool.ts`；[架构 7.1](architecture.zh-CN.md#71-渲染服务) | 1 |
| 10 | Office 导出用量存在每个作业的临时目录，作业结束即删除 | `jobs/run.ts` 的 `jobEnvironment` | 阶段 G 的 C7 门禁 |

当前唯一的保护是执行层在 `NODE_ENV=production` 时拒绝启动（`config-executor.ts`）。这条检查只匹配这个精确字符串，`Production`、`prod`、`staging` 或不设置时执行层照常以不安全方式启动（14.1 节 S8）。本文设计替代它的保护：第一个修复 PR 先把它改为默认拒绝（第 7 节），最后一个 PR 再换成完整的启动检查。

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
    凭据与出网代理 ◀── B2 Unix socket + capability ── worker（不可信，独立 uid、命名空间、Node 权限模型）
    │                                                作业子进程（不可信输入，同样的隔离，B3）
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

2026-11-09 在原型实测后确定，本文在此基础上设计，不重新讨论。G3、G4、G7 按第一轮对抗评审修订（14.1 节），修订依据是附录 C 的实验。

| # | 决策 | 依据 |
| --- | --- | --- |
| G1 | 执行层和渲染服务的容器运行在 gVisor `runsc` 下，使用默认参数 | 附录 A 的 Q2、Q3：全部原生路径与 Chromium 在 runsc 下可用；runsc 下 Chromium 自带沙箱可用，runc 需要放宽 seccomp |
| G2 | worker 按敌对进程对待。真实的 Workspace 凭据不进入 worker。执行层父进程运行凭据与出网代理，worker 只持有一个每 worker 的 capability | 第 1 节缺口 1、2 |
| G3 | 每个 worker 和作业子进程运行在包装器里：独立的内核 uid（每个进程树一个，`RLIMIT_NPROC` 按它计数），命名空间（user、pid、net、mount、ipc），逐个挂载点只读重挂，所有可写挂载都是 `noexec` 的私有 tmpfs，prlimit 限制 AS、CPU、NPROC、FSIZE，node 以 Node 权限模型运行（不授予子进程、worker 线程、WASI 与 inspector 权限），线程池固定大小。包装器通过 `process.execPath` 接入，因为上游池不提供 spawn 选项。这是一个隔离的、有删除条件的 workaround | 附录 A 的 Q3、Q4；附录 C 的 E1、E2 |
| G4 | 墙钟上限由执行层以 SIGKILL 杀死 worker 进程树来执行，不依赖 SIGTERM。执行层容器的 1 号进程是 `tini`，负责回收被杀包装器留下的僵尸进程 | 附录 A：包装器内 node 是 pid 命名空间的 1 号进程，忽略 SIGTERM；附录 C 的 E2：node 作 1 号进程时每次 SIGKILL 留下一个僵尸，`--init` 时为 0 |
| G5 | 密钥不进入任何进程环境变量。worker 环境里没有密钥；执行层和渲染服务启动时从文件读取 | 第 1 节缺口 3 |
| G6 | 渲染服务在 runsc 下开启 Chromium 沙箱（去掉 `--no-sandbox`），并恢复每任务隔离 | 第 1 节缺口 9 |
| G7 | 默认即安全：不论 `NODE_ENV` 取什么值，任何不安全配置都让对应角色拒绝启动；放宽只能经一个显式的本地开发开关，而该开关在 gVisor 或 Kubernetes 中被拒绝 | 要求 7；14.1 节 S8 |
| G8 | 独立评审：先由不同模型家族做对抗评审，再由用户指定的人签字 | 阶段 G 验收标准 |
| G9 | 门禁旅程必须在 runsc 上运行。`verify-uvw` 增加在 Linux 主机 `minsky-ubuntu-remote`（已安装并注册 runsc）上运行执行层和渲染服务的方式 | 9.3 节 |

## 4. 执行层设计

### 4.1 进程与隔离层次

```text
executor 容器（runsc，容器级 --memory、--cpus；只保留 SETUID、SETGID、SETPCAP、KILL 四个 capability）
└─ tini（1 号进程，回收僵尸）
   └─ 执行层父进程 node（容器内 root，gVisor 之内）
      ├─ 内部 RPC 服务（只接受网关→执行层令牌）
      ├─ 凭据与出网代理：/run/univer-mcp/proxy.sock（新）
      ├─ 资源采样器：每 500 ms 按 uid 汇总 CPU 与 RSS（新，4.7 节）
      ├─ worker 池（上游 @univer-cli/univer-collaboration-runtime-pool）
      │   └─ fork → process.execPath = ns-worker 包装器（新）
      │        └─ setpriv 换成 uid 100000+包装器 pid，prlimit（NPROC、AS、CPU、FSIZE）
      │             └─ unshare user+pid+net+mount+ipc，逐个挂载点只读，noexec 私有 tmpfs
      │                  └─ node --permission worker（pid 命名空间 1 号进程，只有 lo）
      │                       └─ 127.0.0.1:<端口> 转发到 proxy.sock
      └─ 作业子进程：fork 时显式 execPath = ns-job 包装器（新）
           └─ 同样的 uid 规则、rlimit、命名空间与权限模型，没有代理 socket，没有网络
```

执行层父进程以容器内 root 运行，是为了能把每个 worker 换到自己的 uid（`setpriv` 需要 `CAP_SETUID`、`CAP_SETGID`，清空 bounding set 需要 `CAP_SETPCAP`）并向不同 uid 的进程发 SIGKILL（`CAP_KILL`）。它仍在 gVisor 之内，容器只保留这四个 capability。附录 C 的 E2 在这组 capability 下跑通了全部步骤。

### 4.2 worker 包装器

包装器是镜像内的一个 shell 脚本（设计为 `apps/mcp/docker/ns-worker.sh`，新），参考实现见附录 C.6，它在 runsc 下以上述 capability 跑通了真实上游池、headless Univer 与 Rust 公式。执行层在创建 worker 池之前设置 `process.execPath` 指向它，上游池 fork worker 时于是先执行包装器。设计要点：

- **独立 uid。** 包装器先用 `setpriv --reuid=U --regid=U --clear-groups --inh-caps=-all --bounding-set=-all` 换到 `U = 100000 + 包装器自己的 pid`。包装器存活期间它的 pid 唯一；包装器被 SIGKILL 时，`--kill-child` 同时杀死命名空间内的整棵树，孤儿由 tini 回收，之后 pid 才可能复用，所以不需要分配表。uid 让三件事不再依赖挂载命名空间：`RLIMIT_NPROC` 按 uid 计数，一个 worker 的 fork 或线程洪水只耗尽自己的配额；worker 读不到父进程（root）的 0600 文件；worker 不能向其他 worker 或父进程发信号。附录 C 的 E2 实测：两个 worker 各自 uid、`RLIMIT_NPROC=64` 时，A 洪水到 57 个进程被 EAGAIN 拒绝，B 仍能创建 10 个子进程和一个 worker 线程，父进程正常 fork；同一 uid 的对照组中 B 一个也创建不了。
- **命名空间。** 换 uid 之后，`unshare --user --map-root-user --net --pid --fork --kill-child --mount --mount-proc --ipc`，再以 `unshare --user --map-user=5000 --map-group=5000` 降到非 root。`--ipc` 避免 worker 之间经 System V 共享内存通信，由 MG5 验证。bwrap 的 `--unshare-net` 在 runsc 下失败（RTM_NEWADDR），所以不用 bwrap（附录 A）。
- **文件系统。** 先 `mount --make-rprivate /`，再对 `/proc/self/mountinfo` 中除 `/proc`、`/sys`、`/dev` 以外的每个挂载点执行 `mount -o remount,bind,ro`，任何一个失败即退出。不用 `mount --rbind / /`：runsc 下它之后的嵌套 `unshare --user` 返回 EPERM（14.1 节 S7a）。然后在 `/tmp`、`/var/tmp`、`/dev/shm`、`/home/node` 上挂空 tmpfs，选项 `nosuid,nodev,noexec`、64 MiB。密钥目录（4.10 节）与 license 用量目录（第 6 节）不再需要遮盖：它们属于其他 uid，权限是 0700 或 0400。代理 socket 所在的 `/run/univer-mcp` 保持可见。
- **noexec 是权限模型的前提。** Node 权限模型下 worker 必须有 `--allow-addons`（Rust 公式引擎与 exchange-node 是原生扩展，不授予时公式计算失败，附录 C 的 E1）。`--allow-addons` 允许 `process.dlopen` 加载任何路径的 `.node` 文件，不检查文件读权限：在可执行的挂载上，worker 把一个原生扩展复制进自己的可写目录后能加载它（E1，macOS 与 runsc 下都成功）。可写目录在 `noexec` 挂载上时加载失败（E1，runsc 下 `ERR_DLOPEN_FAILED`）。所以每个可写挂载都必须是 `noexec`，自检逐个验证。
- **Node 权限模型。** node 参数为 `--permission --allow-fs-read=<应用目录>/ --allow-fs-read=/tmp/ --allow-fs-write=/tmp/ --allow-addons`，不授予 `--allow-child-process`、`--allow-worker`、`--allow-wasi`、`--allow-inspector`。附录 C 的 E1 在 runsc 下实测：headless Univer、Facade 脚本、Rust 公式、exchange-node 往返与 Typst 编译全部通过，不需要 worker 线程或 WASI；`child_process.spawn`、`execSync`、`fork`、`process.binding('spawn_sync')`、`new Worker`、WASI、`inspector.open` 和读 `/etc/passwd` 都返回 `ERR_ACCESS_DENIED`。效果是一个 worker 就是一个进程，每进程的 rlimit 因此成为每个 worker 的上限。Node 文档说明权限模型不是对抗恶意代码的边界，所以本文把它当作第一层：它的漏洞、或原生扩展中可由脚本触发的内存错误，会让 worker 重新能创建进程，此时由独立 uid 的 `RLIMIT_NPROC`、命名空间和 gVisor 兜底，内存上的后果见 4.7 节的剩余风险。
- **rlimit、堆与线程。** `prlimit` 设置 `RLIMIT_NPROC`（`EXECUTOR_WORKER_NPROC`，默认 64；它计数线程，worker 在 runsc 下有 15 个线程，E1）、`RLIMIT_AS`（`EXECUTOR_WORKER_AS_MB`）、`RLIMIT_CPU`（`EXECUTOR_WORKER_CPU_SECONDS`）、`RLIMIT_FSIZE`。node 参数加 `--max-old-space-size=<EXECUTOR_WORKER_HEAP_MB>` 与 `--v8-pool-size=1`，环境加 `UV_THREADPOOL_SIZE=1`、`MALLOC_ARENA_MAX=2`。E1 实测：主线程空转加 8 个 pbkdf2 时，默认线程池用 4.39 个核，固定后 1.78 个核；加载 Univer 并计算后的 VmSize 从约 2.0 GiB（2007816 kB）降到约 1.1 GiB（1155444 kB），worker 在 `RLIMIT_AS` 1.5 GiB 下正常运行。这些值经 `pool.env` 传给包装器，对池内所有 worker 相同，不是密钥。数值见 4.7 节。
- **代理入口。** worker 的网络命名空间里只有 `lo`。MCP 的 worker 入口（`apps/mcp/src/executor/worker.ts`）在交给 Client Core 之前，在 `127.0.0.1:<EXECUTOR_PROXY_PORT>` 上启动一个用 `node:net` 写的转发器，把连接原样接到 `/run/univer-mcp/proxy.sock`。socket 文件权限为 0666，认证靠 capability，不靠文件权限；E2 中不同 uid 的 worker 经它得到 200。所有 worker 的 `transportOrigin` 因此都是 `http://127.0.0.1:<EXECUTOR_PROXY_PORT>`，HTTP 与协同 WebSocket 都经它到达代理（`content-worker.ts` 中两者都由 `transportOrigin` 改写）。不需要修改 Client Core 的 worker，也不需要新依赖。本地开发开关（第 7 节）打开且 `EXECUTOR_WORKER_ISOLATION=none` 时，包装器只加权限模型参数，不换 uid、不建命名空间（macOS 的 runc 拒绝 `unshare`，附录 A），worker 入口不启动转发器，代理直接在同一回环端口上监听。
- **pid 登记。** 包装器把自己在外层的 pid（`$$`）经环境变量交给 node。worker 入口在运行任何用户代码之前，用自己的 capability 向代理登记这个 pid；代理只接受每个 capability 的第一次登记，并检查该 pid 的父进程是执行层、uid 等于 `100000 + pid`。执行层据此执行墙钟 SIGKILL（4.7 节）、空闲 CPU 检查（4.5 节）和按 uid 的资源采样（4.7 节）。
- **自检。** 执行层启动时用包装器运行一个自检入口，结果用于第 7 节的拒绝启动检查：uid 不等于父进程且等于 `100000 + pid`；`RLIMIT_NPROC`、`RLIMIT_AS`、`RLIMIT_CPU` 与配置一致；只有 `lo`；直接连接 `WORKSPACE_TRANSPORT_URL` 失败；`/proc` 只看到自己的进程；父进程 environ 与密钥文件不可读；`/tmp` 私有；根目录与其他挂载只读；每个可写挂载都是 `noexec`，且复制进去的原生扩展 `process.dlopen` 失败；`child_process.spawn`、`process.binding('spawn_sync')`、`new Worker` 返回 `ERR_ACCESS_DENIED`；代理 socket 可达。

**Workaround 说明。** `process.execPath` 是进程级全局状态。原因：上游池没有 spawn、execPath 或每 worker 参数选项，也不返回子进程句柄。影响范围：执行层父进程里所有不显式传 `execPath` 的 `fork`。作业子进程因此必须显式传入自己的包装器（4.9 节），执行层也不得新增其他 fork。删除条件：上游池提供 spawn 选项并返回子进程或 pid（第 12 节 U1），届时去掉 `process.execPath` 覆盖和 pid 登记，包装器改由 spawn 选项接入。workaround 只存在于执行层启动代码和 worker 入口两处。

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
  outerPid: number | null;                      // 4.2 节的登记；uid 为 100000 + outerPid
  revoked: boolean;                             // 销毁或被执行层杀死后为 true，此后 capability 一律 403
}

type CallPolicy =                               // 按 key 保存；只由 C14 在同 key 链内的操作开始与结束时切换
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

1. **capability 取代 session。** `resolveCredential` 不再返回 session，改为生成 capability 并登记 `WorkerBinding`。worker 的 `init.credential` 是 `workspace_session=<capability>`。两条路径作废 capability：池销毁 worker 时（C12 的退役回调，见 4.11 节），以及执行层自己杀死 worker 时（空闲 CPU、墙钟、资源采样，4.5、4.7 节）。后一条由执行层在发 SIGKILL 的同一步把 binding 置为 `revoked` 并关闭它的 WebSocket，不等池发现 worker 已死。
2. **策略绑定到操作，而不是在调用前切换。** 执行层不在调用 Client Core 之前设置策略。Client Core 对同一个 key 的操作串行执行（`runForRuntimeKey`），执行层若在进入 Client Core 之前切换，排队的写调用会把正在运行的读调用的策略改成 `write`，读调用结束时的 `idle` 又会落到刚开始的写调用上（14.1 节 X1、O1，用真实 Client Core 复现）。设计：Client Core 在同 key 链内、一个操作真正开始时调用 C14 钩子，传入 key、caller 与操作类型（`read`、`write`、`export`），并在 lease 释放或作废后调用它返回的结束函数。代理在钩子里把该 key 的策略设为这个操作的 `active`（`export` 按 `read` 处理，session、requestId 与 deadline 取自 caller 携带的 grant），在结束函数里设为 `idle`。因为同 key 链一次只放行一个操作，`active` 策略总属于 worker 正在执行的那个操作；`exchange.export`、`htmlView`、渲染数据等走 `exportUnitData` 的调用同样经过钩子。验证：G4a 增加一个 Client Core 测试，以真实上游池并发发起同 key 的读和写，worker 内看到的策略分别是 `read`、`write`；MG20 在执行层上重复同一场景。
3. **注入 session。** 代理按 cookie 找到 binding，拒绝 `revoked` 的 binding，再按 binding 的 key 找到当前 `CallPolicy`，用其中的 session 替换 cookie，转发到 `WORKSPACE_TRANSPORT_URL`。`Origin` 由代理设为身份 origin，不取 worker 的值。请求头只转发 `accept`、`accept-encoding`、`content-type`、`content-length`、`if-match`、`idempotency-key`，执行层另加 `x-request-id`。响应去掉 `set-cookie`。
4. **ticket 替身。** W2（`/universer-api/user/session-ticket`）由代理在本地回答：返回一个绑定该 capability、一次性、60 秒有效的替身 ticket，形状与真实响应相同（由 4.6 节的抓包确认）。真实 ticket 只在代理打开上游 WebSocket 时使用，不离开父进程。
5. **路由表。** 表来自附录 B 的路由清单。不匹配任何一行的请求返回 403，记录一行 `mcp.proxy_denied` 日志（route、reason、key 的哈希、request id，不记路径中的 ID 以外的内容）和 `mcp_executor_proxy_denied_total{route,reason}`。

| 路由 | 匹配 | active write | active read | idle |
| --- | --- | --- | --- | --- |
| W1 `GET /api/worktrees/{wt}` | `wt` 等于 binding 的 Worktree | 允许 | 允许 | 拒绝 |
| W2 session ticket | 固定路径 | 本地替身 | 本地替身 | 本地替身 |
| W3 至 W5 快照读取 | 前缀等于 binding 的范围，`type`、`unitId` 等于目标 | 允许 | 允许 | 只允许 W5 `fetchmissing`（重连后的 pull） |
| W6 `POST .../comb/{type}/unit/{unitId}/new_changes` | 前缀、`type`、`unitId` 等于目标；body 的 `unitID`、`changeset.unitID`、`type`、`changeset.type` 与路径一致；body 不超过 16 MiB | 仅当 binding 含 `write` scope | 拒绝 | 拒绝 |
| W7 协同 WebSocket | 路径固定为 binding 范围的 `/comb/connect` | 4.6 节 | 4.6 节 | 4.6 节 |
| W8 至 W12 引用 Unit 读取 | `GET`，前缀为 trunk 或 binding 的 Worktree | 4.4 节 | 4.4 节 | 拒绝 |

路径里的 `unitId` 与 body 里的 `unitID` 都由敌对进程写出，而服务端以哪一个为准没有确认，所以 W6 两处都校验。16 MiB 是本文选择的上限，不是测得的值，实现时以 Workspace 协同端点的实际 body 上限为准，取较小者。

6. **父进程自己的写入。** `executeAndCommit` 在提交前用 `init.credential` 和 `init.transportOrigin` 构造 `WorkspaceHttp` 上传内嵌图片（`content-runtime.ts`，路由 P8）。capability 和 worker 侧的回环地址在父进程里不可用，所以 Client Core 将增加一个宿主侧 HTTP 选项（4.11 节），执行层传入以 grant 的 session、真实传输地址和 4.8 节的出网守卫构造的 `WorkspaceHttp`。

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

**常驻代码在两次调用之间能做什么。** 操作结束时，C14 的结束函数把 key 的策略切到 `idle`：

- HTTP：只放行 W2 替身和目标的 W5 `fetchmissing`，让上游客户端在断线后能重连并 pull。拒绝 W1、W3、W4、W6 和 W8 至 W12。常驻代码因此只能读到目标 Unit 的更新，这是同一主体本来就能读的数据。
- WebSocket：连接保持，worker 发往服务端的帧仍按 4.6 节过滤。
- CPU：4.7 节的资源采样器按 uid 汇总该 worker 所有进程的 `utime + stime + cutime + cstime`，不只看 worker 的 node 进程。只看 node 进程时，worker 派生的子进程在 3 秒空闲内烧掉 2650 ms CPU 而 node 只增加 10 ms（14.1 节 O3、S1）；按 uid 汇总时同样的子进程被完整计入（附录 C 的 E2：worker node +0 ms，uid 合计 +2580 ms）。一次空闲期内合计增长超过 `EXECUTOR_IDLE_CPU_MS`（默认 1000 ms，策略值）即 SIGKILL 该 worker 树，并计入 `mcp_executor_worker_kills_total{reason="idle_cpu"}`。
- 墙钟：空闲 TTL 仍为 `EXECUTOR_IDLE_TTL_MS`（默认 60 秒），到期由池回收。
- 内存：受 `RLIMIT_AS` 与堆上限约束，与 active 时相同。

**杀死之后的下一次调用。** 上游池只在 worker 的下一次操作时才发现它已死：执行层 SIGKILL 一个空闲 worker 后，下一次调用以 `COLLABORATION_WORKER_CRASHED` 失败，再下一次才冷启动，而池的 `destroy-start`、`instance-failed` 事件也要到那次失败才触发（14.1 节 S4，用真实 Client Core 复现）。同样的情况也发生在内核因 `RLIMIT_CPU` 杀死 worker、或脚本让 worker 自己退出时。设计分两步：

1. 执行层自己的杀死路径（空闲 CPU、墙钟、资源采样）在发 SIGKILL 的同时把 binding 置为 `revoked`（4.3 节第 1 点），旧 capability 立即失效，不依赖池的事件。
2. Client Core 增加 C15：一个操作在缓存命中的 worker 上发出第一个请求（`synchronize` 的 `getState`）就得到 `COLLABORATION_WORKER_CRASHED` 或 `COLLABORATION_WORKER_CLOSED` 时，作废该 lease，在同一操作内冷启动重试一次。此时用户代码还没有在这次操作中运行，也没有提交任何变更，所以重试不会重复副作用。冷启动重新调用 `resolveCredential`，worker 拿到新的 capability。

验证：G4a 增加一个 Client Core 测试，以真实上游池 SIGKILL 空闲 worker 后再次调用，调用成功且是冷启动；MG12 增加“杀死后的下一次调用成功”。

考虑过在空闲时对 worker 发 SIGSTOP、调用前 SIGCONT。没有采用：上游池与 worker 之间的 IPC 和协同心跳在冻结期间的行为未知，可能让池把 worker 判为故障。空闲 CPU 检查只依赖 `/proc`，由 MG12 在 gVisor 下验证，并验证一个正常空闲的 worker 在 60 秒内不被误杀。

### 4.6 协同 WebSocket（问题 3）

W7 的 URL 是 `{PFX}/comb/connect?sessionTicket=<ticket>`，单元只出现在帧里（HELLO、JOIN `rooms:[{roomID}]`、HEARTBEAT，附录 B）。ticket 只绑定用户。

| 方案 | 做法 | 结果 |
| --- | --- | --- |
| A 只依赖服务端 `joinUnit` | 代理固定路径，帧原样转发 | 服务端只检查用户能否读该 Unit。worker 能加入用户能读的任何 room；如果协同协议允许经 WebSocket 提交变更，worker 能绕过 W6 的检查写入同一前缀下的其他 Unit |
| B 路径固定加帧过滤 | 代理固定路径；解析 worker 发往服务端的每一帧，只放行抓包确认过的帧类型；JOIN 的 room 集合必须等于 `{目标 unitId}`；未知类型或解析失败即关闭连接 | 不依赖对服务端协议的假设，失败时拒绝 |

**选择 B。** 服务端发往 worker 的帧不过滤，因为 worker 只加入了目标 room。代理接受 worker 的升级请求后，用替身 ticket 找到 binding，自己取真实 ticket（以 session 调 W2），再打开到 `WORKSPACE_TRANSPORT_URL` 上同一固定路径的上游连接。代理用 `ws` 包实现服务端与上游客户端，版本取锁文件中已有的 `8.21.3`，在 `apps/mcp/package.json` 中精确声明。

帧格式尚未抓取。实现按以下顺序确认，作为 PR G4b 的第一步：

1. 给代理加一个只用于本地验证的记录模式，全部放行，同时记录每个 HTTP 请求的方法、路由形状和每个 WebSocket 帧的类型与字段名，不记录内容。该模式只在本地开发开关下可用（第 7 节）。
2. 用该模式跑完整的执行层旅程矩阵（MX1 至 MX15、MH、MM、MT、MV、MR10 至 MR12），在 trunk 与 Worktree、Sheet、Doc、Slide、引用 Unit 的文档上各跑一次，并制造一次断线重连。
3. 把观察到的帧类型、字段和 HTTP 形状写进本文附录 B，同时回答附录 B 末尾列出的未决问题，再据此写路由表与帧白名单。
4. 如果帧不是可解析的文本或已知编码，代理不放行该连接，worker 在需要协同连接的操作上失败。届时向上游 Collaboration SDK 要协议说明（第 12 节 U4），不退回方案 A。

### 4.7 资源上限与公平（问题 4）

gVisor 下没有每进程的 cgroup：runsc 的 cgroupfs 是普通 tmpfs，写入不生效；容器级 `--memory`、`--cpus` 生效（附录 A 的 Q4）。硬上限因此只有每进程的 rlimit、V8 堆上限和容器级限制；执行层的采样与 SIGKILL 是事后控制。评审实测了两件事，决定了本节的形状：

- 每进程的 rlimit 管不住一个能创建进程和线程的 worker。`RLIMIT_AS` 为 2 GiB 时，worker 派生的子进程 RSS 合计 2888 MiB；一个 worker 用 8 个 libuv 线程平均占 3.59 个核（14.1 节 X2）。
- runsc 下容器达到内存上限时，整个沙箱被杀，包括父进程和所有用户的 worker：`exit=137 oom=true`；runc 下只杀占用最多的进程（14.1 节 S2）。所以一个用户让容器 OOM，等于中断该执行层上的所有用户。

设计因此先让一个 worker 只是一个进程（4.2 节的 Node 权限模型），再让容器内全部硬上限之和小于容器上限：

| 控制 | 设计 | 依据 |
| --- | --- | --- |
| 一个 worker 一个进程 | worker 与作业不能创建子进程或 worker 线程（4.2 节）。每进程的 `RLIMIT_AS`、`RLIMIT_CPU` 于是等于每个 worker 的上限 | 附录 C 的 E1 |
| 每用户在途调用上限 | `EXECUTOR_MAX_ACTIVE_PER_USER`，默认 2。执行层在进入 Client Core 的槽位队列之前按用户排队，超过排队时间返回可重试的 `workspace-executor-timeout` | 与[架构 3.3](architecture.zh-CN.md#33-mcp-会给-workspace-server-带来的压力)建议的每用户 2 个并发一致。每个用户在全局 FIFO 里最多占 2 个位置，忙碌槽位不会被一个用户占满（MG8 的基线） |
| 每用户 worker 上限 | Client Core 增加 `maxWorkersPerCaller`（C13，按 `caller.userId` 计，含空闲 worker），MCP 设为 2。用户已有 2 个 worker 又打开新的 key 时，Client Core 在被淘汰 key 的同 key 链内作废该用户自己最久未用的空闲 worker，而不是让上游池淘汰全局最久未用的那个 | 上游池满时已经会为新 key 淘汰全局最久未用的空闲 worker（14.1 节 S5、O7：`destroy-start:userA-unit1:lru`，alice 的两个空闲 worker 占满池时 bob 33 ms 内冷启动）。空闲 worker 不会挡住新 key；真正的问题是一个用户轮换 Unit 时淘汰其他用户的热 worker，迫使他们冷启动（runsc 下约 784 ms，附录 A） |
| 每用户作业上限 | `EXECUTOR_MAX_JOBS_PER_USER`，默认 1；全局 `EXECUTOR_MAX_JOBS` 仍为 2 | 当前一个用户能占满两个作业槽 |
| 单次调用墙钟 | 池的操作超时 `EXECUTOR_OPERATION_TIMEOUT_MS`（25 秒）。执行层在调用 deadline 后 1 秒仍未返回时，SIGKILL 该 worker 已登记的外层 pid，并作废其 capability（4.5 节） | SIGKILL 包装器的 pid 会杀死整棵树，忙碌的子进程在 SIGKILL 后 0 至 6 ms 内退出（附录 A）。上游池 1.4.0 发布产物中，请求超时路径对 fork 出的子进程（即包装器）调用 `kill("SIGKILL")`；执行层补的这一次覆盖池超时之外的卡住情形 |
| 单 worker CPU 总量 | `RLIMIT_CPU` 作为 worker 生命周期内的 CPU 秒数预算，`EXECUTOR_WORKER_CPU_SECONDS` 默认 300（策略值）；采样器按 uid 汇总的 CPU 超过同一预算时也 SIGKILL。用完后下一次调用经 C15 冷启动 | prlimit 的 CPU 上限在 runsc 下生效（附录 A）。它是累计值，不是速率；按 uid 汇总覆盖权限模型被绕过后的多进程情形 |
| 单 worker 核数 | `UV_THREADPOOL_SIZE=1`，`--v8-pool-size=1` | E1：主线程空转加 8 个 pbkdf2，默认 4.39 个核，固定后 1.78 个核。Rust 公式引擎自己的线程在重负载下用几个核未测，PR G5 测量 |
| 单 worker 内存 | `EXECUTOR_WORKER_AS_MB` 默认 2048，`EXECUTOR_WORKER_HEAP_MB` 默认 1024，`MALLOC_ARENA_MAX=2` | E1：加载 Univer 并计算后 VmSize 约 2.0 GiB，加 `MALLOC_ARENA_MAX=2` 后约 1.1 GiB，`RLIMIT_AS` 1.5 GiB 下正常运行。原设计的 2048 MiB 在没有 arena 上限时几乎没有余量。真实 Unit 的 VmSize 未测，PR G5 测量后调整 |
| 作业子进程 | `EXECUTOR_JOB_AS_MB` 默认 1536（策略值，PR G5 测量后调整），堆仍为 `EXECUTOR_JOB_HEAP_MB`（256），CPU 秒数等于作业预算，与 worker 相同的 uid、权限模型和线程池设置 | 架构 D4 节 |
| 进程数 | 每个 worker 与作业一个独立 uid，`RLIMIT_NPROC` 按该 uid 计数，`EXECUTOR_WORKER_NPROC` 默认 64 | E2：同一 uid 时 A 的洪水让 B 的 fork 与 `new Worker` 全部失败（14.1 节 S3）；独立 uid 时 A 停在 57 个进程，B 与父进程不受影响 |
| 按 uid 的资源采样 | 执行层每 500 ms 读 `/proc`，按 uid 汇总每个 worker 与作业所有进程的 CPU（`utime + stime + cutime + cstime`）和 RSS。RSS 合计超过该进程的 AS 上限即 SIGKILL，计入 `mcp_executor_worker_kills_total{reason="rss"}`；CPU 用于 4.5 节的空闲检查和上面的 CPU 总量 | 正常 worker 只有一个进程，RSS 小于 AS，所以这条检查只在权限模型被绕过时触发。它是事后控制，500 ms 内的快速分配仍可能先碰到容器上限 |

**容器预算。** 按“容器内全部硬上限之和小于容器上限”来定预算，而不是按单个用户的最坏情况：

```text
容器内存上限 ≥ EXECUTOR_PARENT_BUDGET_MB                       1024（父进程，预算值）
             + EXECUTOR_MAX_WORKERS × EXECUTOR_WORKER_AS_MB     4 × 2048 = 8192
             + EXECUTOR_MAX_JOBS × EXECUTOR_JOB_AS_MB           2 × 1536 = 3072
             = 12288 MiB，取 12 GiB
```

AS 是 gVisor 下唯一的每进程硬上限，所以预算按 AS 计。worker 的 RSS 远小于 AS（[架构 6.2](architecture.zh-CN.md#62-worker-池)：单 worker RSS 中位数 244.2 MiB），容器上限的大部分是预留，不是常驻；Kubernetes 中 request 可以按常驻内存给，limit 按本预算给。父进程是可信代码，没有 AS 上限，1024 MiB 是预算值（[架构 6.2](architecture.zh-CN.md#62-worker-池) 的常驻值为 417 MiB），父进程另设 `--max-old-space-size`。执行层启动时检查这条不等式：runsc 下 `os.totalmem()` 返回容器的内存上限（附录 C 的 E5：`--memory=3g` 时为 3072 MiB），不满足即拒绝启动（第 7 节）。MG7 验证一个用户无论怎样分配都只杀死自己的 worker，执行层容器不重启。

CPU 方面，一个用户最多同时运行 2 个 worker 和 1 个作业。脚本刻意使用 libuv 线程池时每个进程约 1.8 个核（E1），合计约 5.4 个核；普通脚本主要占主线程的 1 个核。CPU 争用只让其他用户变慢，不会让他们失败。

**剩余风险。** 两项，都由每租户沙箱消除：每个用户（或每个 worker）一个 gVisor 沙箱，容器级 cgroup 即成为每租户限制，代价是每次冷启动多一次沙箱启动（runsc 下 `docker run true` 中位数 263 ms，附录 A）以及每个沙箱自己的 Sentry 内存。

1. 没有每 worker 的 CPU 速率限制。一个用户能在自己的配额内持续占用约 5 个核，使同一执行层上其他用户变慢。阶段 H 的限流（每用户并发与每分钟写入）降低持续占用。
2. Node 权限模型被绕过（Node 的漏洞，或原生扩展中可由脚本触发的内存错误）时，一个 worker 能创建最多 `RLIMIT_NPROC` 个任务，每个进程各有 AS 上限，合计可以超过预算。采样器在 500 ms 内杀死它，但更快的分配可能先触发容器 OOM，而 runsc 下容器 OOM 中断该执行层上的所有用户。是否接受这项剩余风险由产品负责人决定（14.3 节）。

### 4.8 父进程出网（问题 5）

`WorkspaceHttp.content()` 对非同源的签名 URL 不带凭据直接请求任意 http(s) 主机（`packages/client-core/src/http.ts`）。当前 Workspace 的 `resolveContentUrl` 只返回同源相对路径（`apps/workspace/server/src/modules/univer-assets/univer-assets.service.ts`），所以这个分支今天不会触发；但执行层父进程不应依赖服务端永远这样做。

设计：

1. 执行层所有对外请求都经 `dispatch.ts` 里同一个注入的 fetcher（grant 校验器的 fetcher 也改为复用它）。fetcher 只放行 origin 等于 `WORKSPACE_TRANSPORT_URL` 或 `MCP_RENDERER_URL` 的请求，其余抛出 `workspace-egress-refused`，不发出请求。一个守卫覆盖所有调用方，不需要逐个修改。
2. 不改 Client Core 的 `content()`，CLI 行为不变（[README 4.1](README.zh-CN.md#41-cliappscli)）。Markdown 路径已经只接受同源内容端点（`packages/client-core/src/markdown-assets.ts`），本守卫与之一致。
3. 网络层：执行层容器的出网策略只允许到 Workspace 与渲染服务（第 8 节），作为第二道防线。第 7 节的启动探针只能发现“完全没有出网策略”，不能证明策略恰好是这两个目标；第 8 节说明由谁证明后者。

### 4.9 作业子进程

Office 导入导出、Typst 编译、Markdown 物化在作业子进程里解析不可信字节（A3）。设计：

- `jobs/run.ts` 的 `fork` 显式传入 `execPath` 指向 `ns-job` 包装器。独立 uid、命名空间、逐个挂载点只读、`noexec` 私有 tmpfs、rlimit、Node 权限模型与线程池设置都与 worker 相同（附录 C 的 E1 在这些条件下跑通了 exchange-node 往返与 Typst 编译）；没有代理 socket，网络命名空间里只有 `lo`。
- `HOME`、`TMPDIR` 继续指向私有临时目录（现在由父进程在 `/tmp` 下创建，包装器内改为子进程自己的 tmpfs）。
- 导入、Typst 与 Markdown 作业的 uid 是 `100000 + 包装器 pid`。导出作业例外：它以固定的 `EXECUTOR_EXPORT_UID`（默认 99999）运行，这个 uid 拥有 license 用量目录（第 6 节），每个副本同一时间最多一个导出作业。原因是 exchange-node 创建的用量目录只有创建者能打开：附录 C 的 E5 中，第二个 uid 即使在同一个组、目录设了 setgid，导出也返回 `LICENSE_USAGE_STORAGE_ERROR`（`PermissionDenied`）。串行化还顺带消除了“同一目录并发写是否安全”这个未知（第 6 节）。因为同一时间只有一个导出作业，它们共用 uid 不会互相耗尽 `RLIMIT_NPROC`。
- 导出作业的包装器把用量目录重挂为 `rw,nosuid,nodev,noexec`，其他挂载点仍只读；其他作业和 worker 中该目录与其他挂载一样只读，而且属于其他 uid、权限 0700，读不到。用量目录可写，所以它也必须 `noexec`，否则导出作业能从那里加载原生扩展（4.2 节）。
- 作业照旧只收到 license 与 license key，不收到 session、grant 或 Workspace 地址（架构 D4 节）。license key 对作业子进程可见是必要的：转换在子进程内调用 exchange-node。被攻破的作业能读到它，这是第 10 节列出的剩余风险。
- SIGKILL 作用于包装器的外层 pid，整个树一起退出。

### 4.10 密钥与内部令牌

- 每个密钥以 `<NAME>_FILE` 环境变量给出文件路径，进程启动时读取并只保存在内存里。涉及 `MCP_OAUTH_CLIENT_SECRET`（网关）、内部令牌、`METRICS_TOKEN`、`UNIVER_LICENSE_KEY`。设置了明文变量即拒绝启动（第 7 节）。
- 密钥文件放在 `/run/secrets/univer-mcp`，属于 root、权限 0400。worker 与作业的 uid 不同，读不到（附录 C 的 E2：worker 读 root 的 0600 文件返回 EACCES），不再需要在该目录上挂空 tmpfs。
- 内部令牌按调用方向拆成两个：`MCP_EXECUTOR_TOKEN_FILE`（网关调用执行层，网关与执行层持有）和 `MCP_RENDERER_TOKEN_FILE`（执行层调用渲染服务，执行层与渲染服务持有）。渲染服务不再持有能调用执行层的令牌，Chromium 逃逸后拿到的令牌没有用处。当前三个角色共用一个 `MCP_INTERNAL_TOKEN`（`apps/mcp/docker/compose.verify.yml`）。
- worker 的显式环境变量保持只有 `NODE_ENV` 加 4.2 节的非密钥限制值。

### 4.11 Client Core 的改动

C10 至 C14 是增量选项，默认等于现在的行为，CLI 不改调用（[README 4.1](README.zh-CN.md#41-cliappscli)）。C15 改变所有调用方的一条失败路径：空闲期间死去的 worker 不再让下一次调用失败，CLI 同样受益，G4a 因此跑 CLI 测试与打包验证。

| # | 改动 | 原因 |
| --- | --- | --- |
| C10 | `createWorkspaceContentRuntime` 增加宿主侧 HTTP 选项，用于提交前的内嵌图片上传；不传时沿用 `init.credential` 与 `init.transportOrigin` | 4.3 节第 6 点 |
| C11 | `WorkspaceRuntimeCaller` 增加可选 `partition`，追加到运行时 key | 4.5 节 |
| C12 | 运行时增加 worker 退役回调（`destroy-start`、`instance-failed` 时调用，参数为 key） | 池销毁 worker 时，代理据此作废 capability 与 pid 登记。它不覆盖执行层自己的杀死路径，后者由执行层直接作废（4.3 节第 1 点） |
| C13 | 池选项 `maxWorkersPerCaller`：调用者达到上限时，在同 key 链内作废该调用者自己最久未用的空闲 worker | 4.7 节。上游池为新 key 淘汰全局最久未用的空闲 worker 的行为已存在，不需要 Client Core 重做 |
| C14 | 每操作钩子 `onOperation({ key, caller, kind })`，在同 key 链内、操作开始获取 worker 之前调用，返回的函数在 lease 释放或作废后调用；`kind` 为 `read`、`write`、`export` | 4.3 节第 2 点，把代理策略绑定到操作 |
| C15 | 缓存命中的 worker 在本次操作的第一个请求上返回 `COLLABORATION_WORKER_CRASHED` 或 `COLLABORATION_WORKER_CLOSED` 时，作废 lease 并在同一操作内冷启动重试一次 | 4.5 节，空闲期间死去的 worker 不再让下一次调用失败 |

C14 与 C15 都改变同 key 链内的执行顺序，G4a 用真实上游池和测试 worker 验证：并发的同 key 读写各自看到自己的操作类型；SIGKILL 空闲 worker 后的下一次调用成功且是冷启动；CLI 不传这两个选项时行为与现在相同（C15 对 CLI 也生效，它只在操作尚未运行用户代码时重试）。

## 5. 渲染服务设计

### 5.1 Chromium 沙箱

`@univer-cli/univer-render-runtime` 固定传入 `--no-sandbox`。在上游提供开关之前（第 12 节 U2），每个 runtime 的 `browserExecutablePath` 经一个符号链接指向镜像内的包装脚本（设计为 `apps/mcp/docker/chromium.sh`，新；链接的做法见 5.3 节），它去掉 `--no-sandbox` 后以新会话启动 `/usr/bin/chromium`。原型在 runsc 下证明了这种包装器可用，且 Chromium 的 renderer 进程处于独立的 user、net 命名空间并启用 seccomp（附录 A 的 Q2）。runc 下沙箱启动失败（“No usable sandbox”），所以 macOS 上的本地运行需要显式的 `RENDERER_CHROMIUM_SANDBOX=0`，该值只在本地开发开关下被接受（第 7 节）。

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
- 每个 runtime 用自己的浏览器路径区分。渲染服务为每个 runtime 创建一个私有目录（例如 `/tmp/univer-render/<runtime id>/`），在其中放一个指向 5.1 节包装脚本的符号链接 `chromium`，并把它作为该 runtime 的 `browserExecutablePath` 传给 `createUniverRenderRuntime`。包装脚本把自己的 pid 写进 `$(dirname "$0")/browser.pid`，再 `exec setsid /usr/bin/chromium "$@"`，于是浏览器主进程的 pid 等于进程组 ID 和会话 ID。后台关闭 2 秒未完成时，渲染服务向该进程组发 SIGKILL，然后删除该目录。不用 `createUniverRenderRuntime` 的 `env`：它只用于定位浏览器，不传给浏览器进程（14.1 节 S6）。附录 C 的 E3 验证了两点：两个并发 runtime 的包装脚本各自看到自己的 `$0`；runsc 下 Chromium 的 zygote、renderer、GPU 与 utility 进程都在浏览器的进程组里，两个 crashpad 进程有自己的会话，向进程组发 SIGKILL 后 1 秒内没有存活的 Chromium 进程。MG17 在真实负载下重复这项检查。
- 每任务关闭（5.2 节）走同一条路径，所以正常任务结束后也不会遗留浏览器进程。
- MG17 复现 7.1.2 的两种触发条件，要求在 deadline 之前应答，5 秒内没有该 runtime 的 Chromium 进程。

### 5.4 网络与凭据

渲染服务只接受执行层的请求，没有任何出网，包括 DNS（第 8 节）。它只持有渲染方向的内部令牌和指标令牌（4.10 节），不持有用户凭据（[架构 7.1](architecture.zh-CN.md#71-渲染服务)）。

## 6. license 用量存储（C7，问题 6）

exchange-node 的 README 要求进程有“可写的本地持久存储”记录导出用量，存储不可用时返回 `LICENSE_USAGE_STORAGE_ERROR`，并说明商业导出按 License ID 分别计数。README 没有说明存储位置是否可配置、多个进程或多个副本能否共享同一目录。当前每个作业使用私有临时目录（架构 D4 节，`jobs/run.ts` 的 `jobEnvironment` 把 `HOME`、`XDG_STATE_HOME` 都设为它），用量在作业结束时丢失。

**实测的存储位置与计数方式**（附录 C 的 E5）：

- Linux 上 SDK 写到 `$XDG_STATE_HOME/univer-exchange-license/`，内含 `installation.marker`、`usage.key`、`usage.lock`、`usage.state`，另有 `executions/` 目录（评审者 O6 的运行中出现）。macOS 上写到 `$HOME/Library/Application Support/univer-exchange-license/`。
- 这个目录只有创建它的 uid 能打开；另一个 uid 即使在同组、目录设了 setgid，也得到 `LICENSE_USAGE_STORAGE_ERROR`（`PermissionDenied`）。
- 执行层随镜像带的 license 查询用量得到 `{"licenseStatus":"valid","limit":null,"used":null,"remaining":null}`（14.1 节 O6），看不到计数。
- 不配置 license 时是免费模式：`getExportQuota` 返回 `limit: 10` 与实际的 `used`，周期从该目录第一次使用起算一个月。免费额度记在这个目录里，新的目录就是新的 10 次：本机默认目录本月已经 `used=10`，换成新的 `XDG_STATE_HOME` 后导出照常成功。

设计：

1. **位置。** 一个专用卷挂到执行层的 `MCP_LICENSE_USAGE_DIRECTORY`（例如 `/var/lib/univer-mcp/license-usage`），只用于这件事。它不是产品数据卷，不与网关的暂存卷共享，要求 6 不受影响。导出作业的 `XDG_STATE_HOME` 指向该卷，`HOME`、`TMPDIR` 仍指向私有临时目录。
2. **所有者与可见范围。** 卷属于 `EXECUTOR_EXPORT_UID`，权限 0700。只有导出作业以这个 uid 运行，并在包装器里把该目录重挂为 `rw,nosuid,nodev,noexec`（4.9 节）；worker、导入作业、Typst 与 Markdown 作业的 uid 不同，读不到它。
3. **同一副本内的并发。** 每个副本同一时间最多一个导出作业（作业队列里一个导出专用的锁）。这由上面的 uid 约束决定，也让“两个进程并发写同一目录是否安全”不再需要回答。代价是每个副本的导出吞吐降为一个作业槽，由 9.4 节测量。
4. **多副本。** SaaS 中每个执行层副本一个独立的持久卷（StatefulSet 的 `volumeClaimTemplates`），不共享。各副本分别计数，同一 License ID 的总用量是各副本之和。是否接受按副本计数由产品负责人决定（14.3 节）。
5. **持久性。** 启动检查（第 7 节）拒绝 `tmpfs`、`ramfs`、`overlay` 等不持久的文件系统类型，要求它是独立挂载点、属于 `EXECUTOR_EXPORT_UID` 且可写，并在目录为空时写入一个标记文件 `.univer-mcp-volume`（随机 ID 与创建时间）。启动检查只能排除明显不持久的类型；卷是否真的跨容器重建保留，由 MG19 验证标记与计数在重建后仍在。评审中 O5 用 `--tmpfs` 挂载通过了原设计的设备号检查（`dev(dir)=36 dev(parent)=21 fstype=tmpfs`），所以设备号检查不够。

验证（MG19）。MG19 不能用随镜像带的 license 观察计数（它报告 `used: null`），也不消耗任何商业 license。设计用免费模式：导出作业在 `MCP_EXPORT_LICENSE_MODE=free` 时不收到 license 与 key，SDK 按免费模式计数；每次运行使用一个新建的卷，因此有确定的 10 次额度，不依赖任何人本月的用量。`MCP_EXPORT_LICENSE_MODE` 不放宽隔离，只决定导出用哪个 license，它在 gVisor 下也可用，`/healthz` 与启动日志写出当前值。步骤，合计不超过每个卷 10 次：

1. 新建卷，启动执行层，查询用量为 `used=0`；连续导出 3 次，再查询，`used=3`。
2. 删除并重建执行层容器（卷保留），标记文件与 `used=3` 不变。
3. 在导出过程中 SIGKILL 作业子进程，再在导出过程中 SIGKILL 整个容器；之后的查询与导出返回成功或 SDK 文档化的错误码，不出现 `LICENSE_USAGE_STATE_INVALID`，`used` 为 4 至 6 之间与已完成导出次数一致的值。
4. 同一副本内同时发起 2 个导出，两个都成功，第二个在导出锁上等待，`used` 增加 2。
5. 两个副本（`compose.verify.yml` 已有 `executor-b`）各自一个新卷，各导出 1 次，各自 `used=1`，互不影响。
6. 把卷换成 `--tmpfs` 挂载，执行层拒绝启动并写出失败的检查名。

用免费模式验证的是存储机制：位置、所有者、持久性、并发与崩溃后的状态。它不能验证商业 license 按 License ID 计数的语义；如果产品负责人要求用商业 license 做这项验证，需要提供一个会报告用量的测试 license（14.3 节）。

**上游阻塞。** 如果产品负责人要求同一 License ID 在所有副本之间共享一个计数，就需要上游提供共享用量后端（第 12 节 U3）。在那之前的退路是网关把 `exchange.export` 固定路由到一个指定副本（rendezvous 使用常量 key），由该副本的一个卷记录全部用量，代价是导出吞吐只有一个作业槽。未通过 MG19 之前，不发布多用户 Office 导出（阶段 G 验收标准）。

## 7. 拒绝不安全配置（要求 7）

默认即安全，不读 `NODE_ENV`。当前的拒绝只匹配精确字符串 `NODE_ENV=production`，评审者用 `Production`、`prod`、`staging` 和不设置都让执行层与网关以不安全方式启动（14.1 节 S8）。设计：

- **一个本地开发开关。** `MCP_LOCAL_DEVELOPMENT=1` 是唯一能放宽检查的变量，只接受值 `1`，其他值视为配置错误。下表“本地开发开关下”一列列出它允许的全部放宽，表外没有其他放宽。
- **放宽变量离不开开关。** 任何放宽变量被设置而开关未设置，对应角色拒绝启动。每个放宽变量只接受表中列出的值，未知值同样拒绝。
- **开关本身被生产标志拒绝。** 运行在 gVisor 下（`os.release()` 含 `gvisor`）或 Kubernetes 中（存在 `KUBERNETES_SERVICE_HOST`）时，设置开关即拒绝启动。所以 runsc 验证拓扑与生产只能使用安全配置。
- **分两步落地。** PR G3 先把执行层的 `NODE_ENV=production` 检查换成“未设置开关即拒绝启动”，网关的 `MCP_DEV_SESSION_PASSTHROUGH` 同样要求开关；在完整的隔离落地之前，执行层只有不安全的 `session` 模式，这一步让它在任何未显式声明本地开发的环境里都起不来。PR G9 加入下表的全部检查，并启用“gVisor 或 Kubernetes 中拒绝开关”这条规则；在此之前 runsc 验证主机上的运行需要开关。

启动顺序：解析配置，运行自检，全部通过后才监听端口；任一失败则以非零码退出，日志写出失败的检查名，不写密钥。`/healthz` 只在监听后存在，所以 Kubernetes 看到的是 CrashLoop，而不是降级运行。开关生效时，`/healthz` 返回的 JSON 列出生效的放宽项，`verify-uvw doctor` 显示它们。

| 角色 | 检查 | 本地开发开关下 |
| --- | --- | --- |
| 全部 | 密钥只来自 `*_FILE`；明文环境变量出现即失败；文件存在、非空、不被其他用户可写 | 可接受明文环境变量 |
| 全部 | 内部令牌至少 32 字符；网关→执行层与执行层→渲染服务两个令牌不相等 | 不放宽 |
| 网关 | `MCP_DEV_SESSION_PASSTHROUGH` 为空（已实现，改为依赖开关） | 可设置 |
| 执行层、渲染服务 | 运行在 gVisor 下：`os.release()` 含 `gvisor`（附录 A 测得 `4.19.0-gvisor`） | 可不在 gVisor 下 |
| 执行层 | `MCP_EXECUTOR_CREDENTIALS=proxy`。阶段 D 的 `session` 模式（worker 直接持有 session）在 PR G9 中删除 | G9 之前可为 `session` |
| 执行层 | `EXECUTOR_WORKER_ISOLATION=namespace`；4.2 节的 worker 包装器自检与作业包装器自检全部通过 | 可为 `none`（只加权限模型参数，4.2 节） |
| 执行层 | 1 号进程不是执行层自己（`/proc/1/comm` 为 `tini` 或 `docker-init`）；进程的有效 capability 恰好是 SETUID、SETGID、SETPCAP、KILL | 隔离为 `none` 时不检查 capability |
| 执行层 | 内存预算：父进程预算加 `EXECUTOR_MAX_WORKERS × EXECUTOR_WORKER_AS_MB` 加 `EXECUTOR_MAX_JOBS × EXECUTOR_JOB_AS_MB` 不超过 `os.totalmem()`（4.7 节） | 不放宽 |
| 执行层 | 出网探针：父进程连接 `MCP_EGRESS_PROBE_TARGETS`（默认 `169.254.169.254:80` 与一个公网地址）必须在 2 秒内失败；连接 Workspace 与渲染服务必须成功 | 可跳过 |
| 执行层 | `MCP_LICENSE_USAGE_DIRECTORY` 已设置；文件系统类型不在 `tmpfs`、`ramfs`、`overlay` 之列；是独立挂载点；属于 `EXECUTOR_EXPORT_UID` 且可写；标记文件存在或目录为空时写入（第 6 节） | 可接受任意可写目录 |
| 执行层 | `EXECUTOR_PROXY_RECORD` 未设置（4.6 节的记录模式） | 可设置 |
| 渲染服务 | `RENDERER_CHROMIUM_SANDBOX` 未设置为 `0`；启动一个备用 runtime，检查 Chromium renderer 进程的 `/proc/<pid>/status` 中 `Seccomp` 为 2 且 user 命名空间与浏览器主进程不同（附录 A 的检查方式） | 可为 `0` |
| 渲染服务 | 出网探针：连接 `MCP_EGRESS_PROBE_TARGETS` 必须失败；解析一个公网域名必须失败 | 可跳过 |

**出网探针能证明什么。** 探针只能证明被探测的那几个目标不可达，因而能发现“完全没有出网策略”或“策略漏了云元数据地址”。它不能证明出网恰好只到 Workspace 与渲染服务：评审中，runsc 容器在 internal 网络上，元数据地址与 1.1.1.1 都返回 ENETUNREACH，同一网络上的邻居 `172.18.0.2:5432` 却能连上（14.1 节 O4）。允许清单由网络策略本身给出，证明分两部分：

- 规格：第 8 节的表是 NetworkPolicy 必须满足的规格，阶段 H 的 Helm release 以默认拒绝出网加两条显式放行实现它，评审时对照本表检查。
- 外部验证：MG4 与 MG18 从执行层和渲染服务容器内枚举所在网络上的每个其他容器地址、网络网关和宿主转发点，并解析一个公网域名；只有表中允许的目标能连上，渲染服务的解析失败。这项枚举只在验证拓扑中运行，不在生产启动时运行。

## 8. 网络与挂载（要求 5、6）

| 角色 | 入站 | 出站 | 挂载 |
| --- | --- | --- | --- |
| 网关 | ingress | Workspace、执行层 | 暂存卷 |
| 执行层父进程 | 只有网关 | Workspace（`WORKSPACE_TRANSPORT_URL`）、渲染服务；`WORKSPACE_TRANSPORT_URL` 使用域名时另放行集群 DNS。父进程是可信代码，所有请求经 4.8 节的守卫，所以不检查它的解析结果 | license 用量卷、密钥文件 |
| worker、作业子进程 | 无 | 无（只有 `lo`，worker 另有代理 socket） | 无；全部挂载只读，`noexec` 私有 tmpfs；导出作业另可写 license 用量卷（`noexec`） |
| 渲染服务 | 只有执行层 | 无 | 密钥文件 |

执行层和渲染服务都不挂载 Workspace 的数据卷或网关的暂存卷。Kubernetes 的 NetworkPolicy 与卷属于阶段 H 的 Helm release，本表是它们必须满足的规格。本地验证由 `verify-uvw` 的 compose 网络与 `doctor` 模拟，MG4、MG9 与 MG18 验证；第 7 节说明启动探针与这些旅程各自能证明什么。

## 9. 验证（问题 7、8）

### 9.1 七条要求与旅程

MG1 至 MG11 定义在 `.agents/skills/verify-uvw/features/mcp-security.md`（G1，#266）：MG1 凭据与 scope，MG2 环境变量密钥，MG3 子进程与 Node 内置模块，MG4 网络可达，MG5 跨用户 `/proc` 与 tmp，MG6 失控 CPU，MG7 内存耗尽，MG8 池公平，MG9 挂载，MG10 配置失败即关闭，MG11 渲染服务共享。MG1、MG3 不写成攻击脚本，而是作为防线测试随 G4b、G5 交付（代理拒绝白名单之外的路由、worker 初始化数据里没有 session、包装器自检），它们在 `main` 上的基线由代码给出（`packages/client-core/src/content-worker.ts` 把 session 作为 `credential` 交给 worker）。#266 在 `main` 26c1b69d 上的基线：MG6、MG9 受控；MG2、MG4、MG5、MG7、MG8、MG10、MG11 暴露。MG12 至 MG20 由本文新增（9.2 节）。

每条旅程先在当前 `main` 上记录“暴露”，再由对应 PR 变为“受控”（第 11 节）。门禁结果必须来自 runsc 拓扑（9.3 节）。

| 要求 | 旅程 |
| --- | --- |
| 1 读不到其他用户的数据或凭据 | MG1、MG2、MG5、MG9、MG11、MG13、MG16、MG17 |
| 2 权限不超过本次调用所需与授予的 scope | MG1、MG12、MG13、MG14、MG15、MG20 |
| 3 不能中断或拖垮其他用户 | MG3、MG6、MG7、MG8、MG12 |
| 4 CPU、内存、墙钟上限，超限终止并回收 | MG6、MG7、MG12、MG16、MG17 |
| 5 只访问必需的网络目标 | MG4、MG14、MG18 |
| 6 不挂载产品数据卷 | MG9 |
| 7 安全配置错误拒绝启动 | MG10 |
| C7 门禁 | MG19 |

#266 中几条旅程的通过条件在新设计下需要补充：

- MG1：worker 内只能找到 capability，找不到 session；从 worker 外重放 capability 失败（代理只在 Unix socket 上接受它）；W6 对其他 Unit、其他 Worktree、路径与 body 不一致的请求都返回 403；读调用中的 W6 返回 403；替身 ticket 不能在代理之外使用；被执行层杀死的 worker 的旧 capability 返回 403。
- MG3：分两层验证。权限模型层：worker 与作业内 `child_process` 的各个入口、`process.binding('spawn_sync')`、`new Worker`、WASI、`inspector.open` 返回 `ERR_ACCESS_DENIED`，复制到每个可写目录的原生扩展 `process.dlopen` 失败。uid 层：用一个只在验证中使用、不加权限模型参数的包装器变体重复附录 C 的 E2，worker A 的 fork 洪水不影响 worker B 和父进程创建进程与线程。
- MG6、MG12、MG16：每次 SIGKILL 之后，执行层容器内的僵尸进程数为 0。
- MG7：一个 worker 用 Buffer、ArrayBuffer 与 V8 堆分配直到失败，并尝试创建子进程；只有它自己的 worker 被杀死（`RLIMIT_AS` 或资源采样），执行层容器不重启，同时进行的另一个用户的调用成功。
- MG8：#266 的场景是 A 用 12 秒的脚本占住全部 worker 槽位，B 在 5 秒排队超时后得到 `workspace-runtime-busy`；在 `EXECUTOR_MAX_ACTIVE_PER_USER=2` 下 B 应在排队期限内开始。另加一个场景对应 C13：B 先在一个 Unit 上留下热 worker，A 以 2 个并发轮流对 6 个不同 Unit 调用；之后 B 的调用是热启动（`executor: warm`），A 的 worker 数始终不超过 2。
- MG10：`NODE_ENV` 为 `Production`、`prod`、`staging` 或不设置时，未设置本地开发开关的执行层与网关拒绝启动；设置任一放宽变量而不设开关时拒绝启动；在 runsc 拓扑中设置开关时拒绝启动（PR G9 之后）。

### 9.2 新增旅程

| # | 名称 | 步骤 | 通过条件 |
| --- | --- | --- | --- |
| MG12 | 空闲 worker 滥用 | 脚本留下 `setInterval`，在调用返回后尝试 W1、W3、W6、W8 和一个忙循环；另起一个只做正常调用的 worker 空闲 60 秒；忙循环的 worker 被杀后，同一用户对同一 Unit 再调用一次 | 空闲期的 HTTP 尝试全部 403 并有 `mcp.proxy_denied`；忙循环在约 1 秒 CPU 后被杀，`mcp_executor_worker_kills_total{reason="idle_cpu"}` 加 1；正常空闲 worker 不被杀；杀死后的下一次调用成功且是冷启动（`executor: cold_start`），旧 capability 返回 403；僵尸进程数为 0 |
| MG13 | 跨授权与 scope 的复用 | 同一用户用只读 PAT 在 Unit 上留下常驻代码，再用全 scope PAT 对同一 Unit `execute`；吊销第一个 PAT 后再调用 | 第二次调用是冷启动（`executor: cold_start`），常驻代码没有在写调用期间出现任何请求；吊销后第一个 PAT 的 worker 不再收到任何 active 窗口 |
| MG14 | WebSocket 越权 | worker 内自行打开到代理的 WebSocket，JOIN 其他 Unit 的 room，发送未知类型的帧，用替身 ticket 连接其他前缀 | 越权 JOIN 与未知帧使连接被关闭；其他前缀的升级请求 403；目标 Unit 的正常协同不受影响 |
| MG15 | 引用 Unit 读取 | 文档引用另一 Unit；分别用含 `read` 与只含 `write` 的授权 `execute`；脚本直接请求其他 Worktree 前缀的快照 | 含 `read` 时引用加载成功；只含 `write` 时引用读取 403、目标 Unit 正常；其他 Worktree 前缀一律 403 |
| MG16 | 作业子进程隔离 | 导入一个触发长时间解析的文件，在作业中尝试出网、读父进程 environ、读密钥目录、写 `/tmp` 以外的路径 | 只有 `lo`；读取全部失败；超出预算时整棵树在 deadline 内被 SIGKILL；临时目录被清理 |
| MG17 | Chromium 沙箱与故障恢复 | 截图后检查 Chromium 各进程的 seccomp 与命名空间；任务进行中 SIGKILL 页面所在的 renderer 进程；任务进行中让页面卡住直到超时；连续两个用户的截图 | renderer 进程 `Seccomp: 2` 且 userns 与浏览器主进程不同；两种故障都在 deadline 前返回可重试错误，5 秒内没有该 runtime 的 Chromium 进程（包括 crashpad），runtime 目录已删除；两个用户的任务使用不同的浏览器进程 |
| MG18 | 执行层父进程出网 | 用测试替身让 sign-url 返回跨域 URL；从父进程连接云元数据地址与公网地址 | 跨域 URL 得到 `workspace-egress-refused` 且没有发出请求；网络层连接失败 |
| MG19 | license 用量存储 | 第 6 节的六个步骤，免费模式，每次运行新建卷 | 第 6 节 |
| MG20 | 同 key 并发调用的策略 | 同一授权（含 `read`、`write`）对同一 Unit 同时发起一个慢的 `inspect` 和一个 `execute`；`inspect` 的脚本在运行中尝试 W6；另对同一 Unit 同时发起 `exchange.export` 与 `execute` | `inspect` 期间的 W6 返回 403；`execute` 的 W6 成功并提交；代理日志中每个被转发的请求都带发起它的操作的 `requestId` 与 effect；阶段 D、E 中同一 Unit 的并发旅程照常通过 |

每条旅程按 `features/mcp.md` 的既有格式写成可重复执行的脚本，证据进入本次运行目录，不含 token、cookie 或 capability。

### 9.3 runsc 验证拓扑

新增 `VERIFY_UVW_SANDBOX_HOST=<hc machine 名>`，默认不设置。设置后：

```text
macOS（不变）
  Workspace Server 127.0.0.1:3920、Vite 5973、uvw、agent-browser、opencode、verify-uvw mcp 客户端
  Docker Desktop：gateway 容器
     │ MCP_EXECUTOR_URLS = http://host.docker.internal:<L>
     ▼
  ssh -N -L <L>:<执行层容器 IP>:3000 -R <R>:127.0.0.1:3920  minsky-ubuntu-remote（verify-uvw 持有，down 时关闭）
     │
minsky-ubuntu-remote（Linux aarch64，Docker + runsc）
  compose 项目 verify-uvw-<run-id>-sandbox，经 DOCKER_HOST=ssh://<主机> 管理
  internal 网络（docker network create --internal），没有任何发布端口
    executor 容器（runtime: runsc，init: true）
      WORKSPACE_TRANSPORT_URL = http://<网络网关地址>:<F>
    renderer 容器（runtime: runsc，init: true）
  宿主转发进程：监听 <网络网关地址>:<F>，连到 127.0.0.1:<R>（ssh -R 的出口）
```

- 两个容器只在 internal 网络上，所以没有公网出网，第 7 节的出网探针能通过。internal 网络上的发布端口从宿主访问不到（14.1 节 S7b），所以入站不用 `-p`：verify-uvw 在 compose 启动后用 `docker inspect` 读执行层容器的 IP，ssh 的 `-L` 直接转发到这个 IP。附录 C 的 E4 实测：宿主能访问 internal 网络上的容器 IP，macOS 经 `ssh -L <本地端口>:<容器 IP>:8080` 得到容器的响应，容器内连接 1.1.1.1 与 169.254.169.254 都返回 ENETUNREACH。
- Linux 上的容器不能访问宿主只监听 `127.0.0.1` 的进程（[本地验证](local-verification.zh-CN.md) R5），所以执行层到 Workspace 需要一个转发点：宿主上的转发进程（`socat` 或等价的一行脚本）只绑定在 internal 网络的网关地址上，不对局域网开放，也不需要修改 sshd 的 `GatewayPorts`。评审中 S7b 的复现确认容器能连到绑定在网关地址上的宿主进程。PR G2 写回 `local-verification.zh-CN.md`。
- `doctor` 新增检查：两个容器内 `uname -r` 含 `gvisor`；执行层只能到达转发点与渲染服务；渲染服务没有任何出网；隧道往返时延（写入证据，供 9.4 节使用）。
- 镜像在远端构建（`docker build` 经 ssh 发送构建上下文），两台机器都是 arm64。
- 选择拆分拓扑，而不是整个运行都放到 Linux：后者需要在 Linux 上运行 Workspace、Vite、浏览器与 opencode，而且网关容器同样受 R5 限制。拆分拓扑保留 macOS 上已验收的全部客户端旅程。

**macOS Docker Desktop 上能证明什么。** Docker Desktop 是 runc 加默认 seccomp：`unshare` 被拒绝，Chromium 沙箱无法启动（附录 A）。本地运行因此需要本地开发开关、`EXECUTOR_WORKER_ISOLATION=none` 与 `RENDERER_CHROMIUM_SANDBOX=0`，此时 worker 与执行层共享网络和 uid，代理在 TCP 回环上监听，包装器只加 Node 权限模型参数。

| 能证明 | 不能证明 |
| --- | --- |
| 代理的策略逻辑：capability、替身 ticket、路由表、W6 校验、帧过滤、空闲策略、复用 key、策略绑定到操作（MG1、MG12 的 HTTP 部分、MG13、MG14、MG15 的策略结果、MG20） | worker 不能绕过代理（没有网络命名空间时它能直接连 Workspace） |
| Node 权限模型拒绝子进程、worker 线程与非白名单文件（MG3 的权限模型层；权限模型是纯 Node 的检查，E1 在 macOS 与 runsc 下结果相同） | 独立 uid 与 `RLIMIT_NPROC` 的隔离（MG3 的 uid 层）、`noexec` 挡住 `dlopen`（macOS 上私有目录可执行，E1 中 dlopen 成功） |
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
| 热 `inspect`、热小 `execute` | 代理多一跳 HTTP、WebSocket 帧过滤；`UV_THREADPOOL_SIZE=1` 与 `--v8-pool-size=1` | 未测 |
| 单 worker RSS 与 VmSize | 堆上限、AS 与 `MALLOC_ARENA_MAX` | 小工作簿计算后 VmSize 约 1.1 GiB（附录 C 的 E1）；真实 Unit 未测，同时用于 4.7 节调整 AS 与容器预算 |
| 导出吞吐 | 每个副本同一时间一个导出作业（4.9 节） | 未测 |
| 1、2、4 个 writer 的持续写入吞吐与 p50、p95 | 代理对 W6 与 WebSocket 的开销 | 未测 |
| 截图、打印、lint 的单次延迟 | 每任务 runtime 与备用 runtime | runsc 下首次截图约 2.4 秒（附录 A）；7.1.1 节本机预热首次使用 1646 ms、热 584 ms（Sheet 截图） |
| `compile_svg` 量字 | 每任务 runtime | 7.1.1 节热 `measureText` 3 ms、预热首次 60 ms |
| 渲染吞吐（1、2 个 runtime） | 每个任务启动一个浏览器的 CPU | 未测 |

结果写回架构 6.2、3.3、7.1.1 节，作为单独的小节，不覆盖原基线。是否可以接受由评审者与产品负责人确认（阶段 G 验收标准）；本文不预设阈值。

## 10. 剩余风险

| 风险 | 条件 | 消除办法 |
| --- | --- | --- |
| 一个用户在配额内持续占用约 5 个核，使同一执行层上其他用户变慢 | gVisor 下没有每进程 cgroup，也没有 CPU 速率限制（4.7 节） | 每租户沙箱；阶段 H 的限流降低持续占用 |
| 绕过 Node 权限模型的 worker 创建多个进程，内存合计超过预算；采样器杀死它之前容器 OOM，runsc 下整个执行层沙箱被杀，所有用户的在途调用失败 | Node 权限模型的漏洞，或原生扩展中可由脚本触发的内存错误（4.2、4.7 节） | 每租户沙箱。是否接受由产品负责人决定（14.3 节） |
| 渲染服务容器 OOM 时整个渲染沙箱被杀，所有在途渲染任务失败 | 恶意或超大的渲染数据让 Chromium 用尽容器内存；Chromium 进程没有每进程上限 | 每任务一个渲染沙箱；在此之前执行层把渲染失败作为可重试错误返回 |
| 同一执行层容器内所有 worker 共享一个 gVisor Sentry；Sentry 逃逸可读取父进程内存中在途调用的 session | gVisor 漏洞 | 每租户沙箱 |
| 被攻破的作业子进程能读到 license key，导出作业能篡改或清空本副本的用量记录；用量卷丢失后换上的空卷能通过启动检查，计数从零开始 | 原生解析器漏洞；卷的运维事故 | 上游让 license 校验与用量记录留在父进程（U3） |
| 同一用户、同一授权、同一 scope 集合内，前一次调用留下的代码影响后续调用的结果 | 设计接受，4.5 节 | 不复用 worker（放弃热缓存） |
| 空闲 worker 在被检测前最多消耗约 1 秒 CPU | 4.5 节的采样间隔与阈值 | 上游池支持冻结空闲 worker |

## 11. PR 计划

按 [README](README.zh-CN.md) 与根 `AGENTS.md` 的规则组织：互相依赖的组成 stack，其余各自从 `main` 开分支。先合入探针旅程，每个后续 PR 把列出的旅程从“暴露”变为“受控”，所以每个 PR 都能单独验证。

| PR | 标题 | 要求 | 旅程由暴露变为受控 | 依赖 | 主要文件 |
| --- | --- | --- | --- | --- | --- |
| G1 | `test(mcp): add stage G isolation baseline journey`（[#266](https://github.com/dream-num/univer-workspace/pull/266)） | 全部 | 记录 MG2、MG4 至 MG11 在 `main` 上的基线；MG1、MG3 随修复 PR 以防线测试交付 | 无 | `.agents/skills/verify-uvw/features/mcp-security.md`、`bin/mcp-security-probes.mjs` |
| G2 | `test(verify-uvw): run the executor and renderer on a gVisor host` | 全部 | 记录 MG12 至 MG20 的基线；A 组性能 | G1 | `bin/verify-uvw`、`features/mcp.md`、`apps/mcp/docker/compose.verify.yml`、`local-verification.zh-CN.md` |
| G3 | `fix(mcp): fail closed by default, read secrets from files and confine egress` | 1、5、7 | MG2、MG18；MG10 中 `NODE_ENV` 变体的部分 | G2 | `apps/mcp/src/shared/config*.ts`、`executor/dispatch.ts`、`executor/credentials.ts`、`renderer/server.ts`、`gateway/executor/`、`compose.verify.yml`、`.agents/skills/verify-uvw/bin/verify-uvw`、`apps/mcp/README.md` |
| G4a | `feat(client-core): add per-operation and worker retirement hooks to the content runtime` | 2、3 | 无（为 G4b 准备）。C10、C11、C12、C14、C15；以真实上游池验证并发同 key 读写的操作类型与杀死后的冷启动重试；CLI 测试与打包验证通过 | 无 | `packages/client-core/src/content-runtime.ts`、`runtime-target.ts` |
| G4b | `feat(mcp): broker worker Workspace access through a credential proxy` | 1、2 | MG1、MG13、MG14、MG15、MG20，MG12 的 HTTP 部分与杀死后的调用 | G3、G4a | `apps/mcp/src/executor/proxy/`（新）、`executor/runtime.ts`、`executor/credentials.ts`、`executor/worker.ts`、`gateway/executor/grants.ts`、`gateway/auth.ts`、`shared/executor-protocol.ts`、`apps/mcp/package.json` |
| G5 | `feat(mcp): run workers and conversion jobs under their own uids in namespaces` | 1、3、4、5、6 | MG3、MG4、MG5、MG6、MG7、MG9、MG16，MG12 的 CPU 与僵尸部分 | G4b | `apps/mcp/docker/ns-worker.sh`、`ns-job.sh`（新）、`apps/mcp/Dockerfile`（安装 `tini` 作 ENTRYPOINT，执行层以 root 运行）、`compose.verify.yml`（capability、`init`）、`executor/resources.ts`（新，按 uid 采样）、`executor/server.ts`、`executor/worker.ts`、`executor/jobs/run.ts`、`shared/config-executor.ts` |
| G6 | `feat(mcp): cap workers, calls and jobs per user` | 3 | MG8 | G2 | `packages/client-core/src/content-runtime.ts`、`apps/mcp/src/executor/dispatch.ts`、`executor/jobs/queue.ts` |
| G7 | `feat(mcp): isolate each render task and enable the Chromium sandbox` | 1、3、4 | MG11、MG17 | G2 | `apps/mcp/src/renderer/pool.ts`、`renderer/server.ts`、`shared/renderer-protocol.ts`、`executor/renderer-client.ts`、`apps/mcp/docker/chromium.sh`（新） |
| G8 | `feat(mcp): persist Office export license usage on a dedicated volume` | C7 | MG19 | G5 | `executor/jobs/run.ts`、`executor/jobs/queue.ts`（导出锁）、`ns-job.sh`（导出 uid 与可写用量目录）、`shared/config-executor.ts`、`compose.verify.yml` |
| G9 | `feat(mcp): refuse to start on insecure configuration` | 7 | MG10 | G3 至 G8 | 各角色的 `server.ts` 与 `shared/config*.ts`；第 7 节的全部检查；开关在 gVisor 或 Kubernetes 中被拒绝；删除 `MCP_EXECUTOR_CREDENTIALS=session` 与 G3 的“未设开关即拒绝” |
| G10 | `docs(mcp): record stage G verification and performance` | 全部 | 全部旅程在 runsc 上重跑；阶段 D、E 验收重跑；B 组性能 | G9 | 第 13 节列出的文档 |

G4b 的第一步是 4.6 节的抓包，结果写入本文附录 B。G5 只能在 runsc 拓扑上验收。G3、G4a、G6、G7 只依赖探针旅程（G1、G2），可以从 `main` 各自开分支并行实施；G6 与 G4a 都修改 `content-runtime.ts`，后合入的一个需要 rebase。

## 12. 上游需求

| # | 上游 | 需求 | 在此之前的做法 |
| --- | --- | --- | --- |
| U1 | Univer CLI SDK `@univer-cli/univer-collaboration-runtime-pool` | 每 worker 的 spawn 选项（可执行文件、参数、环境），返回子进程或 pid；在文档中写明操作超时使用 SIGKILL（1.4.0 的实现如此）；worker 退出时立即作废实例并发出事件，而不是等下一次操作 | `process.execPath` 指向包装器，worker 入口登记外层 pid，执行层自行 SIGKILL 并作废 capability；Client Core 对死去的缓存 worker 冷启动重试（4.2、4.5、4.7 节） |
| U2 | Univer CLI SDK `@univer-cli/univer-render-runtime` | 不硬编码 `--no-sandbox`，提供沙箱开关；支持注入浏览器或每任务创建 BrowserContext；暴露浏览器 pid 或强制关闭 | 包装脚本去掉 `--no-sandbox` 并记录 pid；每任务一个 runtime（5.1 至 5.3 节） |
| U3 | `@univerjs-pro/exchange-node` | 可配置的用量存储位置（现在由 `XDG_STATE_HOME` 决定）；多进程、多副本共享的用量后端，或对同一目录多个 uid 并发写入的明确保证；让用量记录不需要转换进程持有可写目录；商业 license 的用量查询返回计数 | 每副本独立卷，导出以固定 uid 运行并在副本内串行；退路是导出固定到一个副本（第 6 节） |
| U4 | Univer Collaboration SDK | 协同 WebSocket 帧协议的说明（类型、字段、哪些帧可以改变文档） | 抓包得到的白名单，未知帧关闭连接（4.6 节） |

## 13. 实现后需要更新的文档

本次只在 [README](README.zh-CN.md) 第 6 节的文档索引中加入本文，并在[阶段计划](stages.zh-CN.md)阶段 G 交付物 1 处指向本文。实现完成后（PR G10）更新：

- `architecture.zh-CN.md`：3.2 节表格中执行层和渲染服务的运行时改为已确认的 gVisor，渲染服务不出网；4.2 节最后一条指向本文；6.2 节的 key、每用户上限与新的 `EXECUTOR_*` 变量；6.4 节改为代理与 capability 的摘要；7.1 节去掉临时偏离与 `--no-sandbox`，写入每任务 runtime；7.1.2 节删除已修复的“故障后迟迟不应答”；9.1 节 C7 的状态与新增的 C10 至 C15；第 10 节标注已满足并指向本文；第 11 节的新变量（`*_FILE`、两个内部令牌、`MCP_LOCAL_DEVELOPMENT`、`EXECUTOR_WORKER_*`、`EXECUTOR_JOB_AS_MB`、`EXECUTOR_EXPORT_UID`、`EXECUTOR_PARENT_BUDGET_MB`、`EXECUTOR_MAX_ACTIVE_PER_USER`、`EXECUTOR_MAX_JOBS_PER_USER`、`EXECUTOR_IDLE_CPU_MS`、`EXECUTOR_PROXY_PORT`、`EXECUTOR_PROXY_RECORD`、`EXECUTOR_WORKER_ISOLATION`、`RENDERER_CHROMIUM_SANDBOX`、`MCP_LICENSE_USAGE_DIRECTORY`、`MCP_EXPORT_LICENSE_MODE`、`MCP_EGRESS_PROBE_TARGETS`），删除 `MCP_INTERNAL_TOKEN`；D4 节的作业包装器与用量存储；新增 9.4 节的复测结果。
- `stages.zh-CN.md`：阶段 G 各验收条目的证据，以及阶段 D、E 重跑的记录。
- `apps/mcp/README.md`：配置项；部署要求（runsc、`tini` 作 1 号进程、执行层的四个 capability、按第 4.7 节公式给出的容器内存上限、网络策略、license 用量卷与其所有者、密钥文件、每副本卷）；删除“Stage G 之前仅限单用户”的说明；`mcp_executor_proxy_denied_total`、`mcp_executor_worker_kills_total` 指标。
- `apps/mcp/AGENTS.md`：删除“Until Stage G passes”与渲染池跨用户复用两条；新增规则：worker 永不收到 session；代理路由表是 worker 的唯一放行清单，新增 worker 路由必须先进表并有旅程；代理策略只在 C14 钩子里切换；执行层不得新增未显式传 `execPath` 的 `fork`；worker 与作业以 Node 权限模型运行，包装器里每个可写挂载都是 `noexec`；新增放宽项必须进第 7 节的表并依赖本地开发开关；渲染 runtime 不跨任务复用。
- `local-verification.zh-CN.md`：9.3 节的拓扑与转发点的实测结论。
- `DREAMNUM.md`：部署交接新增 gVisor、`tini`、capability、网络策略与 license 用量卷的要求时更新（根 `AGENTS.md` 的规则）。

## 14. 评审记录

按 G8，先由不同模型家族做对抗评审，再由用户指定的人签字。评审者在此记录发现、复现方式和对本文的修订。

### 14.1 对抗评审

2026-11-09 评审 cc8ea219。三位评审者：Codex gpt-6-astra xhigh（被 OpenAI 的网络安全过滤器提前中止，其发现由协调者重跑）、Claude sonnet high、Claude opus high。每条发现都由协调者在 cc8ea219 上重跑并确认。复现脚本是一次性的，没有提交。

| 发现 | 评审者（模型） | 问题与证据 | 处理 |
| --- | --- | --- | --- |
| X1、O1 | Codex gpt-6-astra；Claude opus | 执行层在进入 Client Core 之前按 key 切换策略，而 Client Core 自己串行执行同 key 操作：排队的写调用把运行中读调用的策略改为 `write`（`read_call_observed_policy=write`）；opus 以真实 Client Core 复现，写调用随后在 `idle` 下运行，同一 Unit 的正常并发调用也会失败 | 已解决。策略由 C14 在同 key 链内按操作绑定（4.3 节第 2 点）。G4a 的 Client Core 测试与 MG20 验证 |
| X2、S1、S2、S3、O3 | Codex gpt-6-astra；Claude sonnet；Claude opus | worker 能创建进程和线程，每进程的限制都被绕过：AS 2 GiB 下子进程 RSS 合计 2888 MiB；一个 worker 平均 3.59 个核；子进程在 2 秒 CPU 上限下烧掉 12 秒，空闲采样只看到 node 的 70 ms；runsc 下容器 OOM 杀死整个沙箱（`exit=137 oom=true`），runc 只杀占用者；共享 uid 的 `RLIMIT_NPROC` 让 A 的洪水使 B 的 exec 与 `new Worker` 失败 | 已解决，另有一项待决定的剩余风险。E1 选定 Node 权限模型加 `noexec`，一个 worker 只是一个进程；E2 选定每个 worker 一个 uid，`RLIMIT_NPROC` 互不影响，CPU 与 RSS 按 uid 汇总；线程池固定后 1.78 个核；容器预算改为全部硬上限之和并在启动时检查（4.2、4.7 节）。权限模型被绕过时容器仍可能 OOM，见 14.3 节第 1 项 |
| O2 | Claude opus | 镜像以 node 作 1 号进程，不回收孤儿：runsc 下 30 次 SIGKILL 包装器留下 30 个僵尸，`RLIMIT_NPROC` 为 50 时无法再创建 worker | 已解决。`tini` 作 1 号进程（决策 G4；PR G5 的 Dockerfile）。E2：`--init` 时 SIGKILL 后僵尸数为 0，不加时为 2 至 3。MG6、MG12、MG16 检查僵尸数 |
| S4 | Claude sonnet | 执行层 SIGKILL 空闲 worker 后，下一次调用以 `COLLABORATION_WORKER_CRASHED` 失败，第三次才成功；C12 的回调不在杀死时触发，capability 仍有效 | 已解决。执行层的杀死路径直接作废 capability；C15 在同一操作内冷启动重试（4.5 节）。MG12 增加“杀死后的下一次调用成功” |
| S5、O7 | Claude sonnet；Claude opus | 上游池为新 key 淘汰全局最久未用的空闲 worker（`destroy-start:userA-unit1:lru`；alice 的两个空闲 worker 占满池时 bob 33 ms 冷启动），原设计 4.7 节的依据不成立 | 已解决。删除该依据与 C13 中重复的一半。C13 只保留“调用者达到上限时淘汰自己的空闲 worker”，针对一个用户轮换 Unit 淘汰他人热 worker（4.7 节）。MG8 增加对应场景 |
| S6 | Claude sonnet | `createUniverRenderRuntime({ env })` 的 `env` 不进入浏览器进程（`MARK_PER_RUNTIME_ENV=<unset>`），5.3 节的进程组文件无法按 runtime 区分 | 已解决。每个 runtime 一个 `browserExecutablePath` 符号链接，包装脚本按 `$0` 所在目录记录 pid 并 `setsid`（5.3 节）。E3：并发的两个 runtime 各自看到自己的 `$0`；runsc 下向进程组发 SIGKILL 后 1 秒内没有存活的 Chromium 进程 |
| S7a | Claude sonnet | runsc 下 `mount --rbind / /` 之后嵌套 `unshare --user --map-user=5000` 返回 EPERM | 已解决。改为逐个挂载点 `remount,bind,ro` 加 tmpfs（4.2 节）。E1 与附录 C.6 的参考包装器在 runsc 下跑通 |
| S7b | Claude sonnet | internal 网络上的发布端口从宿主访问不到，而第 7 节要求执行层没有公网出网，9.3 节的拓扑无法按原文运行 | 已解决。入站改为 `ssh -L` 到容器 IP（9.3 节）。E4：macOS 经 ssh 得到容器响应，容器连接 1.1.1.1 与元数据地址返回 ENETUNREACH |
| S8 | Claude sonnet | 拒绝启动只匹配 `NODE_ENV=production`：`Production`、`prod`、`staging` 与不设置时执行层与网关以不安全方式启动 | 已解决。默认即安全，唯一的本地开发开关，开关在 gVisor 或 Kubernetes 中被拒绝；G3 先落地“未设开关即拒绝”（第 7 节）。MG10 增加这些变体 |
| O4 | Claude opus | runsc 容器在 internal 网络上，两个探针目标 ENETUNREACH，邻居 `172.18.0.2:5432` 却 `CONNECTED`；DNS 没有检查。出网自检不能证明允许清单 | 已解决。第 7 节写明探针能与不能证明什么；允许清单由第 8 节的网络策略规格与 MG4、MG18 的枚举证明；渲染服务增加 DNS 探针 |
| O5 | Claude opus | 用量目录检查接受 tmpfs：`--tmpfs` 挂载得到 `dev(dir)=36 dev(parent)=21 fstype=tmpfs writable` | 已解决。增加文件系统类型黑名单、所有者检查与标记文件；持久性由 MG19 的容器重建步骤证明（第 6 节）。卷丢失后换上的空卷仍能通过启动检查，列入第 10 节 |
| O6 | Claude opus | 随镜像的 license 查询用量得到 `"used":null`，MG19 无法观察计数；免费模式报告 `limit 10`；用量在 `$XDG_STATE_HOME/univer-exchange-license/` | 已解决。第 6 节记录位置与计数方式；MG19 改用免费模式和每次新建的卷（E5：新卷 `used` 由 0 变为 2）。E5 另发现用量目录只有创建者 uid 能打开，导出因此以固定 uid 在副本内串行运行（4.9 节） |

评审中确认成立、本文继续依赖的前提：gVisor 下 uid 5000 不能卸载遮盖用的 tmpfs 或只读绑定；包装器内的回环可用；`os.release()` 的 gvisor 检查在 runsc 下成立；上游池 fork 时不传 `execPath`，覆盖能拦截它，其他 `@univer-cli` 与 exchange 代码不使用 `process.execPath`。

### 14.2 签字

| 评审者 | 日期 | 结论 | 条件 |
| --- | --- | --- | --- |
| | | | |

### 14.3 需要决定的事项

以下几项只能由产品负责人或部署负责人决定。每项给出选项和本文的建议。

1. **要求 3 的剩余风险（4.7 节）。** Node 权限模型被绕过时，一个 worker 能创建多个进程，可能在采样器反应之前让执行层容器 OOM，runsc 下这会中断该执行层上的所有用户；另外一个用户能占用约 5 个核。选项：A 接受，依靠权限模型、独立 uid 与采样器三层，把每租户沙箱排进后续阶段；B 在阶段 G 内改为每个 worker 一个 runsc 沙箱，每次冷启动至少多 263 ms（附录 A），每个沙箱另有 Sentry 内存，执行层要改为管理沙箱。建议 A：触发它需要 Node 权限模型的漏洞或原生扩展的内存错误，并且要在 500 ms 内分配到容器上限；后果是可用性（在途调用失败、容器重启），不是数据泄露。
2. **执行层以容器内 root 运行（4.1 节）。** 每 worker 一个 uid 需要 `CAP_SETUID`、`CAP_SETGID`、`CAP_SETPCAP`、`CAP_KILL`，执行层因此以 root 运行（仍在 gVisor 内），不满足 Kubernetes Pod Security Standards 的 restricted 级别（要求 `runAsNonRoot`）。选项：A 接受，执行层所在命名空间使用 baseline 级别；B 执行层以非 root 运行，放弃独立 uid，只保留权限模型，权限模型被绕过时 S3 的 fork 洪水重新成立。建议 A。同一项还包括执行层容器内存上限从 8 GiB 提高到约 12 GiB（limit；request 可按常驻内存给，4.7 节）。
3. **license 用量按副本计数（第 6 节）。** 选项：A 接受各副本分别计数，同一 License ID 的总用量是各副本之和；B 导出固定路由到一个副本，导出吞吐只有一个作业槽；C 等待上游共享用量后端（U3）。另外每个副本同一时间只运行一个导出作业（4.9 节），吞吐影响由 9.4 节测量。建议 A。
4. **MG19 使用的 license（第 6 节）。** 选项：A 免费模式加每次新建的卷，确定、不消耗任何人的额度，但不验证商业 license 的计数语义；B 产品负责人提供一个会报告用量的测试 license 和它的额度。建议 A 作为阶段 G 的门禁，B 在拿到测试 license 后补做一次。

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

原型没有测：runsc 下热调用的延迟与吞吐、真实 Univer worker 的 VmPeak、Kubernetes RuntimeClass、KVM 平台、经 `pool.env` 的堆上限、runsc 下 `--read-only` 根文件系统。这些由 9.4 节、MG7 与 PR G5 补测。runsc 下容器达到内存上限时杀死整个沙箱，这一点已由评审测得（14.1 节 S2）。

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
| P8 | POST | `/universer-api/worktrees/{wt}/stream/file/upload?assign={unitId}` | 提交前的内嵌图片上传（4.3 节第 6 点） | 写 |
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

## 附录 C. 评审后的补充实验（2026-11-09）

本附录记录 14.1 节的修订所依据的实验。脚本在本机 `/tmp/g-rev-*` 与 minsky 上的临时目录中，没有提交；实验容器、网络和镜像在结束后删除。

- macOS：`feat-mcp` 工作区已安装的依赖，Node 24.19.0，darwin-arm64。脚本经 Client Core 的 `package.json` 解析包，与附录 A 的原型脚本方式相同。
- minsky：附录 A 的主机。镜像 `g-rev-mcp:cc8ea219` 由 `apps/mcp/Dockerfile` 在 cc8ea219 上构建（代码与 `main` `26c1b69d` 相同），Node 24.22.2；`--runtime=runsc`，容器内 `uname -r` 为 `4.19.0-gvisor`。

### C.1 E1 Node 权限模型

问题：worker 与作业在 `--permission` 下，不授予 `--allow-child-process`，能否完成真实工作；逃逸入口是否都被拒绝；是否需要 `--allow-worker`。

runsc 下的命令（容器内以镜像用户 uid 1000 运行，每个探针都经 C.6 的包装器去掉 `setpriv`、`prlimit`、线程池与 arena 设置后的版本）：

```sh
docker run --rm --runtime=runsc --network none --memory=4g -v <脚本目录>:/g:ro g-rev-mcp:cc8ea219 sh /g/e1-run.sh
```

node 参数：`--permission --allow-fs-read=/app/ --allow-fs-read=/g/ --allow-fs-read=/tmp/ --allow-fs-write=/tmp/ --allow-addons`。macOS 上的对照用同样的参数，路径换成工作区与私有目录，没有命名空间。

| 探针 | macOS，无命名空间 | runsc，命名空间包装器与 `noexec` tmpfs |
| --- | --- | --- |
| headless Univer、Facade 脚本、Rust 公式（D1=6、D2=12） | 通过 | 通过 |
| exchange-node xlsx 往返 | 通过 | 通过 |
| Typst 编译 | 通过（私有目录必须在 `--allow-fs-read` 中，否则 `ERR_ACCESS_DENIED`） | 通过 |
| 不授予 `--allow-addons` | 公式引擎与 exchange-node 报 `Cannot load native addon because loading addons is disabled`，Typst 失败 | 未测 |
| `child_process` 的 `spawn`、`execSync`、`fork`；`process.binding` 的 `spawn_sync`、`process_wrap`、`fs`；`new Worker`；WASI；`inspector.open`；读 `/etc/passwd`；写私有目录以外 | 全部 `ERR_ACCESS_DENIED` | 全部 `ERR_ACCESS_DENIED` |
| 把原生扩展复制进可写私有目录后 `process.dlopen` | 成功（`exports=6`），且不需要该目录的读权限 | `ERR_DLOPEN_FAILED`；同一容器内不经包装器、目录在可执行挂载上时成功（`exports=11`） |
| 真实上游池经 `process.execPath` 包装器 fork worker，worker 内 headless Univer 计算 `=SUM(A1:B1)*2` | 未测 | `d1=6`；worker 内 `spawn`、`spawnSync`、`new Worker`、读 `/etc/passwd` 全部拒绝 |

线程、核数与虚拟内存（runsc，真实上游池的 worker 在加载 Univer 并计算之后，从执行层读 `/proc/<pid>/status`；空闲的普通 node 有 7 个线程）：

| 设置 | Threads | VmSize |
| --- | --- | --- |
| 默认 | 18 | 2158080 kB |
| `--v8-pool-size=1` | 15 | 1936764 kB |
| `UV_THREADPOOL_SIZE=1` 加 `--v8-pool-size=1` | 15 | 2007816 kB |
| 再加 `MALLOC_ARENA_MAX=2` | 15 | 1155444 kB |
| 再在 `RLIMIT_AS` 1.5 GiB 下运行 | 15 | 1077852 kB，计算成功 |

核数：worker 主线程空转，同时在 libuv 线程池上跑 8 个 pbkdf2。默认设置下 1.00 秒墙钟用了 4.40 秒 CPU，平均 4.39 个核；`UV_THREADPOOL_SIZE=1` 加 `--v8-pool-size=1` 时 3.65 秒墙钟用了 6.51 秒 CPU，平均 1.78 个核。

结论：权限模型下真实工作全部可用，不需要 `--allow-worker` 或 `--allow-wasi`。原生扩展必需，所以 `--allow-addons` 必需；它让 `dlopen` 能加载可写目录里的任意扩展，因此每个可写挂载必须是 `noexec`，这一点只在 Linux 的包装器里成立。Node 文档说明权限模型不是对抗恶意代码的边界，本文把它作为第一层（4.2 节）。

### C.2 E2 每个 worker 一个 uid

问题：执行层在 gVisor 内以 root 运行时，能否让每个 worker 以自己的真实 uid 运行，使 `RLIMIT_NPROC`、`/proc` 与文件所有权按 worker 区分；代理的 Unix socket 是否仍可用。

包装器先 `setpriv --reuid=U --regid=U --clear-groups --inh-caps=-all --bounding-set=-all`（`U = 100000 + 包装器 pid`），再 `prlimit --nproc=64`，再进入命名空间。父进程 fork worker A 与 B；A 创建 `sleep` 子进程直到失败；之后 B 创建 10 个子进程和一个 worker 线程，经 `/run/g/proxy.sock`（root 创建，权限 0666）发 HTTP 请求，读 root 的 0600 文件；父进程 `spawnSync` 10 次；最后 worker C 派生一个忙循环子进程，父进程比较 C 的 node 进程 CPU 与 C 的 uid 下全部进程的 CPU。对照组让所有 worker 使用同一个 uid。

```sh
docker run --rm --runtime=runsc --user 0:0 --network none --memory=3g -e E2_NPROC=64 -v <脚本目录>:/e2:ro g-rev-mcp:cc8ea219 node /e2/e2-parent.cjs
docker run --rm --runtime=runsc --user 0:0 --network none --memory=3g -e E2_NPROC=64 -e E2_FIXED_UID=100000 -v <脚本目录>:/e2:ro g-rev-mcp:cc8ea219 node /e2/e2-parent.cjs
docker run --rm --init --runtime=runsc --user 0:0 --cap-drop ALL --cap-add SETUID --cap-add SETGID --cap-add SETPCAP --cap-add KILL --network none --memory=3g -e E2_NPROC=64 -v <脚本目录>:/e2:ro g-rev-mcp:cc8ea219 node /e2/e2-parent.cjs
```

输出（第三条命令；第一条除最后一行外相同，最后一行为 `zombies in container after SIGKILLs: 3`）：

```text
== distinct uid per worker (100000 + wrapper pid), RLIMIT_NPROC=64, kernel 4.19.0-gvisor, executor uid 0
A wrapper pid 10 kernel uid 100010; B wrapper pid 20 kernel uid 100020
A flood: {"kind":"flood","innerUid":"5000","spawned":57,"stoppedBy":"EAGAIN(pid undefined)"}
B after A's flood: {"kind":"probe","spawn10":{"spawned":10,"stoppedBy":null},"newWorkerThread":"ok","socketHttp":"200 proxy-ok","rootOwned0600Secret":"denied EACCES"}
executor parent spawnSync x10 after A's flood: ok 10
C spawned a busy child; over 3 s: worker node process +0 ms CPU, all processes of uid 100108 +2580 ms CPU
zombies in container after SIGKILLs: 0
```

对照组（第二条命令）：

```text
== control: every worker uid 100000, RLIMIT_NPROC=64, kernel 4.19.0-gvisor, executor uid 0
A flood: {"kind":"flood","innerUid":"5000","spawned":50,"stoppedBy":"EAGAIN(pid undefined)"}
B after A's flood: {"kind":"probe","spawn10":{"spawned":0,"stoppedBy":"EAGAIN(pid undefined)"},"newWorkerThread":"failed ERR_WORKER_INIT_FAILED","socketHttp":"200 proxy-ok","rootOwned0600Secret":"denied EACCES"}
zombies in container after SIGKILLs: 2
```

结论：runsc 下 root 执行层能以 `setpriv` 给每个 worker 一个 uid，只需四个 capability；uid 之后的 `unshare --user` 与挂载照常可用；`RLIMIT_NPROC` 按 uid 隔离；按 uid 汇总 CPU 能看到子进程；不同 uid 经 0666 的 Unix socket 访问代理不受影响。uid 不限制内存：一个能创建进程的 worker 仍能有多个各自满 AS 的进程，所以内存仍依赖 E1 的权限模型。

### C.3 E3 渲染 runtime 的进程键

macOS 上用一个假浏览器脚本作为两个并发 runtime 的 `browserExecutablePath`，路径分别是 `/tmp/g-rev-e3/rt-a/chromium` 与 `rt-b/chromium`，两者都是指向同一脚本的符号链接。脚本把 `$0` 写进所在目录：

```text
rt-a/browser.pid: launched_as=/tmp/g-rev-e3/rt-a/chromium pid=85183 args=38
rt-b/browser.pid: launched_as=/tmp/g-rev-e3/rt-b/chromium pid=85182 args=38
```

runsc 下用镜像内的真实 Chromium（沙箱开启）：包装脚本记录 pid 后 `exec setsid /usr/bin/chromium --headless=new ...`，4 秒后列出进程，再向进程组发 SIGKILL：

```sh
docker run --rm --init --runtime=runsc --network none --memory=3g -v <脚本目录>:/g3:ro g-rev-mcp:cc8ea219 node /g3/e3-chromium.cjs
```

```text
browser pid 10; chromium processes: browser pid=10 pgrp=10 sid=10; renderer pid=111 pgrp=10 sid=10; renderer pid=120 pgrp=10 sid=10; renderer pid=123 pgrp=10 sid=10; browser pid=25 pgrp=24 sid=24; browser pid=27 pgrp=26 sid=26; zygote pid=31 pgrp=10 sid=10; zygote pid=32 pgrp=10 sid=10; zygote pid=34 pgrp=10 sid=10; gpu-process pid=55 pgrp=10 sid=10; utility pid=56 pgrp=10 sid=10; utility pid=73 pgrp=10 sid=10
renderer Seccomp: 2,2,2
1 s after SIGKILL to process group 10: live chromium processes = 0
```

pid 25 与 27 的命令行没有 `--type=`，在自己的会话里，推断是 crashpad 处理进程；它们在浏览器被杀后自行退出。

### C.4 E4 验证拓扑

```sh
docker network create --internal g-rev-int
docker run -d --runtime=runsc --network g-rev-int node:24-bookworm node -e '<监听 8080，并连接 1.1.1.1:443 与 169.254.169.254:80>'
curl http://<容器 IP>:8080/                                   # 在 minsky 上
ssh -f -N -L 127.0.0.1:18931:<容器 IP>:8080 minsky-ubuntu-remote   # 在 macOS 上
curl http://127.0.0.1:18931/
```

```text
gateway 172.18.0.1 container 172.18.0.2
1.1.1.1 ENETUNREACH
169.254.169.254 ENETUNREACH
host -> container IP:8080: executor-up
Mac -> ssh -L 18931 -> 172.18.0.2:8080: executor-up
```

### C.5 E5 license 用量与容器内存上限

免费模式、新的 `XDG_STATE_HOME`，导出 2 次前后查询用量：

```sh
docker run --rm --runtime=runsc --network none -e XDG_STATE_HOME=/tmp/state -e HOME=/tmp/home -v <脚本目录>:/g:ro g-rev-mcp:cc8ea219 node /g/quota.cjs
```

```text
free mode, fresh XDG_STATE_HOME, before: {"licenseStatus":"not_configured","expiresAt":null,"observedAt":"2026-11-09T09:22:24.647182719Z","limit":10,"used":0,"reserved":0,"remaining":10,"periodStart":"2026-11-09T00:00:00Z","periodEnd":"2026-12-09T00:00:00Z"}
after 2 exports: {"licenseStatus":"not_configured","expiresAt":null,"observedAt":"2026-11-09T09:22:24.664886024Z","limit":10,"used":2,"reserved":0,"remaining":8,"periodStart":"2026-11-09T00:00:00Z","periodEnd":"2026-12-09T00:00:00Z"}
files: /tmp/state/univer-exchange-license/installation.marker /tmp/state/univer-exchange-license/usage.key /tmp/state/univer-exchange-license/usage.lock /tmp/state/univer-exchange-license/usage.state
```

macOS 上默认位置的用量本月已满（`limit=10, used=10`），同一脚本换成新的 `XDG_STATE_HOME`、`HOME` 后导出成功，文件出现在 `$HOME/Library/Application Support/univer-exchange-license/`。

三个不同 uid 共用一个用量目录：root 创建 `/vol/usage`，属组 99998，权限 2770；每个 uid 以 `setpriv --groups=99998`、`umask 007` 导出一次：

```text
uid 100001 exported; used=1 remaining=9
uid 100002 failed: LICENSE_USAGE_STORAGE_ERROR Export usage open failed at directory: PermissionDenied (commit status: not_started). Storage directory: /vol/usage/univer-exchange-license.
uid 100003 failed: LICENSE_USAGE_STORAGE_ERROR Export usage open failed at directory: PermissionDenied (commit status: not_started). Storage directory: /vol/usage/univer-exchange-license.
```

容器内存上限在 runsc 内可见：`--memory=3g` 时 `os.totalmem()` 为 3072 MiB，不加 `--memory` 时为 12017 MiB（主机内存）；`/sys/fs/cgroup/memory.max` 不存在。

### C.6 参考包装器

PR G5 的 `ns-worker.sh` 从这个形状开始。它在 runsc 下以 root 执行层、上述四个 capability 和 `--init` 运行：

```sh
#!/bin/sh
U=$((100000 + $$))
exec setpriv --reuid=$U --regid=$U --clear-groups --inh-caps=-all --bounding-set=-all \
	prlimit --nproc=64 --as=$((2048 * 1048576)) --cpu=300 --fsize=$((64 * 1048576)) -- \
	unshare --user --map-root-user --net --pid --fork --kill-child --mount --mount-proc --ipc sh -c '
	mount --make-rprivate / || exit 110
	for mp in $(awk "{print \$5}" /proc/self/mountinfo | sort -r); do
		case "$mp" in /proc*|/sys*|/dev*) continue;; esac
		mount -o remount,bind,ro "$mp" 2>/dev/null || { echo "remount ro $mp failed" >&2; exit 111; }
	done
	for d in /tmp /var/tmp /dev/shm /home/node; do
		mount -t tmpfs -o size=64m,mode=1777,nosuid,nodev,noexec tmpfs $d || exit 113
	done
	exec env UV_THREADPOOL_SIZE=1 MALLOC_ARENA_MAX=2 unshare --user --map-user=5000 --map-group=5000 /usr/local/bin/node \
		--v8-pool-size=1 --permission --allow-fs-read=/app/ --allow-fs-read=/tmp/ --allow-fs-write=/tmp/ \
		--allow-addons --disable-warning=SecurityWarning "$@"' sh "$@"
```

实验中 `--allow-fs-read` 另含脚本目录 `/g/`。结果：

```text
== kernel 4.19.0-gvisor, executor uid 0, pid 1 is docker-init
pool worker via /g/ns-final.sh: {"d1":6,...,"permission":"child denied","probes":{"spawn":"denied ERR_ACCESS_DENIED","spawnSync":"denied ERR_ACCESS_DENIED","worker":"denied ERR_ACCESS_DENIED","readEtcShadow":"denied ERR_ACCESS_DENIED"}}
worker node threads seen from the executor: unshare pid 16 Threads 1 VmSize 10340 kB; MainThread pid 17 Threads 15 VmSize 1079928 kB
copied addon into writable private tmp
dlopen from private tmp: denied ERR_DLOPEN_FAILED
{"test":"typst","ok":true,"jsBytes":14987,"diagnostics":0,"previews":1,"ms":286}
after 10 worker SIGKILLs: zombies in container = 0
```

### C.7 两种做法的比较

| | Node 权限模型（E1） | 每 worker 一个 uid（E2） |
| --- | --- | --- |
| 管住什么 | 子进程、worker 线程、WASI、inspector、白名单外的文件；于是一个 worker 只有一个进程，每进程的 AS 与 CPU 上限成为每 worker 上限 | `RLIMIT_NPROC`、文件所有权、`/proc` 与信号按 worker 区分；CPU 与 RSS 可按 uid 汇总 |
| 管不住什么 | Node 文档说明它不是对抗恶意代码的边界；它的漏洞或原生扩展的内存错误让 worker 重新能创建进程；`--allow-addons` 下必须靠 `noexec` 挡住 `dlopen` | 内存：能创建进程的 worker 仍能有多个各自满 AS 的进程 |
| 复杂度 | 包装器多一组 node 参数和读写白名单；每个可写挂载 `noexec` | 执行层以 root 运行并保留四个 capability；包装器多 `setpriv`；导出作业改为固定 uid 并串行；Pod Security 只能用 baseline |
| macOS 与 runc 上能证明什么 | 权限检查是纯 Node 的，macOS 上结果与 runsc 相同；但 macOS 上私有目录可执行，`dlopen` 绕过只在 Linux 包装器里被挡住 | 本地运行不换 uid（隔离为 `none`），只能在 runsc 拓扑上证明 |

两者解决的问题不同，所以本文两者都用：权限模型给出“一个 worker 一个进程”，内存预算和 CPU 上限依赖它；独立 uid 在权限模型失效时把进程与线程的耗尽限制在该 worker 自己的 uid 内，并让文件隔离不再只依赖挂载命名空间。
