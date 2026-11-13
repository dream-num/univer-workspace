# 执行后端协议

> 状态：草稿，待评审。这是 [阶段 G0](stages.zh-CN.md#阶段-g0受信用户先行开放与执行后端协议) 第二步的第 1 项交付物。
> 本文规定网关与执行后端（执行层、渲染服务）之间的协议，它不假设后端怎样部署。代码事实附路径，路径相对仓库根目录。
> 每条规则标一个状态。“已实现”指当前代码已经这样做。“本阶段实现”指 G0 第二步的后续 PR 落地，代码还没有这样做。“预留”指协议留出位置，本阶段不实现。

## 1. 协议覆盖两个调用方向

| 调用方向 | 调用方模块 | 被调用方入口 | 操作目录 | 调用方认证 | 调用者凭据 |
| --- | --- | --- | --- | --- | --- |
| 网关调用执行层 | `apps/mcp/src/gateway/executor/client.ts` | `apps/mcp/src/executor/server.ts` | `opSpecs`（`apps/mcp/src/shared/executor-protocol.ts`） | `MCP_EXECUTOR_TOKEN`（第 10 节） | 有 |
| 执行层调用渲染服务 | `apps/mcp/src/executor/renderer-client.ts` | `apps/mcp/src/renderer/server.ts` | `rendererOpSpecs`（`apps/mcp/src/shared/renderer-protocol.ts`） | `MCP_RENDERER_TOKEN`（第 10 节） | 无 |

- 网关不直接调用渲染服务（第 13 节）。（已实现）
- 抽象的单位是这份线上协议，加上网关里的后端客户端模块 `apps/mcp/src/gateway/executor/`：`client.ts` 发送调用，`capabilities.ts` 读取能力，`router.ts` 选择实例，`grants.ts` 签发调用者凭据。连接参数在 `apps/mcp/src/gateway/tools/executor-tool.ts` 的 `createExecutorLinks` 里组装。没有插件框架，也没有只有一个实现的适配器接口。将来接入 serverless 型后端时，平台相关的调用细节（认证方式、租户头、端点）只改这些文件，不改工具定义。两项预留会超出这些文件：按引用传递负载要改带负载的工具（`import`、`export`、`screenshot`、`print_pdf` 等）如何准备和取回字节；按目标限定的凭据要改 `executor-tool.ts` 签发凭据的时机，因为今天凭据在知道操作和目标之前就签发了。
- 工具只通过 `executorTool`（`apps/mcp/src/gateway/tools/executor-tool.ts`）调用后端。工具声明它依赖的操作名，不接触传输。（已实现）

## 2. 操作目录就是协议

每个操作在目录里声明下列字段（`apps/mcp/src/shared/executor-protocol.ts` 的 `OpSpec`）。

| 字段 | 含义 |
| --- | --- |
| `name` | 操作名，也是请求路径的最后一段 |
| `effect`、`effectFor` | 读或写。`effectFor` 按输入细分，例如只有 `apply: true` 时才是写 |
| `payload` | 二进制负载的方向，`none`、`request` 或 `response` |
| `rerun` | 后端允许重跑的原因，`revision`、`auth` 或空（第 8 节） |
| `queueFor` | 是否进入同一用户、同一路由键的 FIFO 队列（第 7 节） |
| `limits.requestBytes`、`limits.responseBytes` | 整个请求帧、响应帧的字节上限，包括 JSON 头和负载 |
| `limits.budgetMs` | 单次调用截止时间的上限 |
| `input`、`output` | 输入和输出的 zod schema |
| `route` | 路由键 `{scope, unitId}`（第 7 节） |

规则如下。

- 目录与传输方式无关。第 4 节的路径、头部和帧只是今天的传输，换传输时目录不变。（已实现）
- 调用方和被调用方从同一个模块导入目录。执行层的处理函数满足目录的映射类型（`apps/mcp/src/executor/dispatch.ts` 的 `dispatchers`），少一个操作就通不过类型检查。（已实现）
- 被调用方用 `input` 解析输入。调用方用 `output` 解析输出。（已实现）
- 渲染服务目录只有 `name`、`payload`、`limits`、`input`、`output`。渲染服务不访问 Workspace，所以没有读写效果、重跑原因和路由键。（已实现）

### 2.1 执行层操作

预算 240 秒即 `JOB_DEADLINE_MS`（`4 * 60_000`）。路由键一列中 `<worktree>` 指 `worktree:<worktreeId>`。

| 操作 | 效果 | 负载 | 重跑 | 请求帧 | 响应帧 | 预算 | 路由键 scope，unitId | 排队 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `htmlView.validate` | 读 | none | auth | 4 MiB | 64 KiB | 30 秒 | `htmlView.validate`，null | 否 |
| `htmlView.create` | 写 | none | auth | 4 MiB | 64 KiB | 30 秒 | `htmlView.create`，`idempotencyKey` | 否 |
| `markdown.compile` | `apply` 时写，否则读 | request | 无 | 64 MiB | 8 MiB | 30 秒 | 有 `worktreeId` 时 `<worktree>`，否则 `markdown.compile`；依次取 `unitId`、`idempotencyKey`，都没有时为 null | 否 |
| `markdown.export` | 读 | response | auth | 4 MiB | 64 MiB | 30 秒 | `<worktree>`，`unitId` | 否 |
| `typst.compile` | `apply` 时写，否则读 | request | 无 | 64 MiB | 8 MiB | 240 秒 | 有 `worktreeId` 时 `<worktree>`，否则 `typst.compile`；`idempotencyKey` 或 null | 否 |
| `svg.compile` | `apply` 时写，否则读 | request | auth | 64 MiB | 8 MiB | 30 秒 | 有 `worktreeId` 时 `<worktree>`，否则 `svg.compile`；`unitId` 或 null | `apply` 时 |
| `exchange.import` | 写 | request | 无 | 64 MiB | 64 KiB | 240 秒 | `exchange.import`，`idempotencyKey` | 否 |
| `exchange.export` | 读 | response | auth | 64 KiB | 128 MiB | 240 秒 | `<worktree>`，`unitId` | 否 |
| `content.execute` | 写 | none | revision、auth | 12 MiB | 8 MiB | 30 秒 | `<worktree>`，`unitId` | 是 |
| `content.inspect` | 读 | none | auth、revision | 256 KiB | 8 MiB | 30 秒 | `trunk` 或 `<worktree>`，`unitId` | 是 |
| `content.sheet-lens` | 读 | none | auth、revision | 256 KiB | 1 MiB | 30 秒 | `trunk` 或 `<worktree>`，`unitId` | 是 |
| `render.screenshot` | 读 | response | auth、revision | 256 KiB | 64 MiB | 240 秒 | `trunk` 或 `<worktree>`，`unitId` | 是 |
| `render.printPdf` | 读 | response | auth、revision | 64 KiB | 128 MiB | 240 秒 | `trunk` 或 `<worktree>`，`unitId` | 是 |
| `render.lint` | 读 | none | auth、revision | 64 KiB | 8 MiB | 30 秒 | `<worktree>`，`unitId` | 是 |
| `diagnostics.probe` | 读 | none | 无 | 16 KiB | 16 KiB | 10 秒 | 空字符串，null | 否 |

### 2.2 渲染服务操作

| 操作 | 负载 | 请求帧 | 响应帧 | 预算 |
| --- | --- | --- | --- | --- |
| `screenshot` | response | 64 MiB | 64 MiB | 30 秒 |
| `printPdf` | response | 64 MiB | 128 MiB | 30 秒 |
| `lint` | none | 64 MiB | 8 MiB | 30 秒 |
| `measureText` | none | 4 MiB | 16 KiB | 10 秒 |

## 3. 后端声明能力，网关只列出能完成的工具

### 3.1 能力端点

- 后端提供 `GET /rpc/v1/capabilities`，要求调用方认证（第 10 节）。响应是 JSON `{v, operations}`，按 `executorCapabilitiesSchema` 解析。`v` 为正整数，`operations` 为字符串数组，最多 256 项。（执行层已实现）
- 后端排空时停止接受新连接，新请求得到连接拒绝；正在处理请求的连接上的后续请求返回 503，两种情况网关都按“没有送达”处理（第 7 节）。空闲的 keep-alive 连接被直接关闭，调用方此时得到连接重置。网关不把重置算作“没有送达”，所以执行层滚动重启时，恰好落在空闲连接上的写入可能得到 `workspace-result-unknown`。这是已知问题，改动排空方式属于后续工作，不在本阶段验收内。（执行层已实现）
- 渲染服务提供同一个端点，响应形状相同，`operations` 取自 `rendererOpSpecs`。（已实现）
- 执行层只在渲染服务声明了对应操作时，才声明 `render.*`。渲染服务的 `v` 与执行层不同时，按没有声明处理（第 12 节）。（已实现）

| 执行层操作 | 需要渲染服务声明 |
| --- | --- |
| `render.screenshot` | `screenshot` |
| `render.printPdf` | `printPdf` |
| `render.lint` | `lint` |

- `svg.compile` 只在渲染服务声明了 `measureText` 时才用真实字体量字，否则用估算量字。它不受渲染服务影响是否可见。（已实现）

### 3.2 网关计算可用操作集合

以下规则都已实现，代码在 `apps/mcp/src/gateway/executor/capabilities.ts`。

- 网关在启动时和之后每 60 秒读取每个执行层的能力。每次请求 5 秒超时，不跟随重定向。
- `v` 等于网关的 `PROTOCOL_VERSION` 时，网关记录这个执行层的操作集合，丢弃目录里没有的操作名。`v` 不同时，网关删除这个执行层的记录。
- 请求失败时，网关保留这个执行层上一次的记录。
- 可用操作集合是所有已记录执行层的交集。只有已记录的执行层进入路由候选。
- 第一次读取成功之前，集合为空。
- 工具用 `executorOperations` 声明必须全部可用的操作，用 `executorAnyOperations` 声明至少一个可用的操作（`apps/mcp/src/gateway/tools/registry.ts` 的 `toolAvailable`）。依赖不满足的工具不进入 `tools/list`，调用它与调用不存在的工具相同。
- 不在执行层白名单内的用户得到空集合。这是部署策略，借用同一个机制（9.3 节）。

### 3.3 就绪

- 版本与网关不兼容的执行层不计入可用操作集合，也不进入路由。（已实现）
- `executor` 检查在网关启动后第一次记录到兼容的执行层时通过，此后一直通过。之后执行层停机或改报不同的版本，网关仍然就绪，依赖执行层的工具随可用操作集合隐藏或返回可重试的错误。（已实现）
- 网关带上这条规则之后，两种发布顺序都不会中断服务。先发布执行层时，旧网关保持就绪，执行层的工具暂时隐藏，直到新网关发布。先发布网关时，新网关一直等不到兼容的执行层，不会就绪，滚动发布停住，旧网关继续服务。

## 4. 传输是 HTTP POST 加二进制帧

### 4.1 请求

以下规则都已实现。

- 调用方发送 `POST /rpc/v1/<操作名>`。
- 请求带三个头。
  - `authorization: Bearer <令牌>`
  - `content-type: application/vnd.univer.mcp-frame+v1`（`FRAME_CONTENT_TYPE`）
  - `x-mcp-rpc-version: 1`
- 调用方不跟随重定向，3xx 按非 200 处理。

### 4.2 帧格式

帧由三段依次组成（`apps/mcp/src/shared/frame.ts`）。（已实现）

1. 4 字节大端无符号整数，表示 JSON 头的字节数。
2. JSON 头，UTF-8 编码。非法 UTF-8 使帧无效。
3. 负载字节，可以为空。

头长度为 0，或者大于剩余字节数时，帧无效。

### 4.3 请求头字段

| 字段 | 执行层 | 渲染服务 | 规则 |
| --- | --- | --- | --- |
| `v` | 有 | 有 | 等于 `PROTOCOL_VERSION`，今天为 1 |
| `op` | 有 | 有 | 与请求路径中的操作名相同 |
| `requestId` | 有 | 有 | 匹配 `^[a-zA-Z0-9._-]{1,128}$`。执行层把它作为 `x-request-id` 发给 Workspace，并作为渲染请求的 `requestId` |
| `deadlineMs` | 有 | 有 | 正整数，不超过该操作的 `budgetMs`。执行层还要求不超过 `JOB_DEADLINE_MS` |
| `grant` | 有 | 无 | 调用者凭据（第 9 节） |
| `input` | 有 | 有 | 按目录的 `input` 解析 |

Schema 是 `requestHeaderSchema` 和 `rendererRequestHeaderSchema`。（已实现）

### 4.4 响应

- 被调用方完成操作时返回 200 和一个帧，`content-type` 同请求。（已实现）
- JSON 头按 `ok` 区分。成功为 `{ok: true, output, meta}`，失败为 `{ok: false, error, meta}`（`responseHeaderSchema`）。（已实现）
- 只有 `payload: "response"` 的操作在响应里带负载。其他操作的响应带负载时，网关按无效响应处理，返回 `workspace-internal-error`。（已实现）
- 只有 `payload: "request"` 的操作接受请求负载。其他操作的请求带负载时，被调用方返回 400。渲染服务的操作都不接受请求负载。（已实现）
- `meta` 按 `opMetaSchema`（`apps/mcp/src/shared/usage.ts`）解析。`executor` 为 `cold_start`、`warm` 或 `none`；`cost` 有 `worker_cpu_ms`、`worker_peak_rss_mb`、`render_pages`、`export_bytes`、`upload_bytes`、`committed_revisions` 六项；`repo`、`unitType` 可选。`executor` 为 `none` 时六项必须全为 0。失败的响应同样带 `meta`，网关据此记录失败调用的 worker 成本。（已实现）
- `content.sheet-lens` 的 `meta` 还可带 `cache`（`hit` 或 `miss`）和 `timings`（非负毫秒数的键值表）。当前阶段名为 `exportMs`、`prepareMs`、`operationMs`、`totalMs`；命中缓存时导出与准备耗时为 0。两字段缺省时省略，不含文档内容或参数原文。缓存命中不需要 worker 时，`executor` 可为 `none`，`unitType` 仍是 `sheet`。（已实现）

### 4.5 大小上限

以下规则都已实现。

- 调用方在发送前用 `requestBytes` 检查编码后的请求帧。超过时不发送，返回 `workspace-request-too-large`。
- 被调用方先看 `content-length`，再在读取请求体时计数。任一超过 `requestBytes` 时返回 413 `workspace-request-too-large`，不执行操作。
- 被调用方编码后的响应帧超过 `responseBytes` 时，改为返回 `workspace-result-too-large` 的失败信封。例外是已提交的 `content.execute`，它保留 `committed`、`revision`、`status`，去掉 `value`，加上 `valueTruncated: true`（`apps/mcp/src/shared/execute-result.ts`）。（已实现）
- 其他写操作成功后结果超过上限时，失败信封带 `detail.committed: true` 和 `retryable: false`，消息要求读回当前状态，不要重复这次写入。（已实现）
- 调用方读取的响应超过 `responseBytes` 时停止读取。网关对写操作返回 `workspace-result-unknown`，对读操作返回 `workspace-result-too-large`。执行层读渲染服务的响应时返回 `workspace-result-too-large`。

## 5. 小负载内联，大负载预留按引用传递

- 负载内联在二进制帧里，上限就是目录中各操作的帧上限。今天最大的是 `exchange.export` 和 `render.printPdf` 的 128 MiB 响应帧。（已实现）
- 协议预留两种按引用传递的方式，即预签名地址和暂存对象 ID。实现时，操作目录为每个方向分别声明内联上限和每种引用方式的上限。（预留）
- 常驻型后端继续内联。本阶段没有任何操作接受引用。

## 6. 调用同步完成，截止时间是协议字段

### 6.1 同步调用

- 一次调用是一个 HTTP 请求和它的响应。后端不返回任务句柄，也不回调调用方。（已实现）
- 后端在两次调用之间不保存正确性所依赖的状态。热 worker、渲染 runtime 和凭据校验缓存都可以丢弃。（已实现）
- 协议不依赖后端进程在一次调用之后继续存活。（已实现）

### 6.2 截止时间

- `deadlineMs` 是调用方还愿意等待的毫秒数，从被调用方开始收到请求时算起，上传请求体的时间也计入。它是必填字段。（已实现）
- 执行层的实际截止时间是开始收到请求的时刻加上 `min(deadlineMs, budgetMs)`（`apps/mcp/src/executor/dispatch.ts`）。渲染服务用 `deadlineMs` 限制等待 runtime 和执行操作的总时间（`apps/mcp/src/renderer/server.ts`）。（已实现）
- 调用方从自己的截止时间里扣除余量后再发送。下表的 T 是调用方算出的剩余预算。（已实现）

| 调用方 | T | 不发送的条件 | 发送的 `deadlineMs` | HTTP 超时 |
| --- | --- | --- | --- | --- |
| 网关 | `min(budgetMs, deadlineAt - now - 500)` | T 不超过 1500 毫秒时返回 `workspace-executor-timeout`，`detail` 为 `{retryable: true, started: false}`，`outcome` 为 `tool_error`（请求没有发出） | T - 1500 | T |
| 执行层 | `min(渲染操作的 budgetMs, deadlineAt - now - 1000)` | T 不超过 1000 毫秒时返回 `workspace-renderer-timeout` | T - 1000 | T |

- 网关普通调用的 `deadlineAt` 是请求开始后 30 000 毫秒（`apps/mcp/src/gateway/server.ts`）。长任务的 `deadlineAt` 见 6.5 节。（已实现）

### 6.3 截止时间已到

- `deadlineMs` 必须为正，所以截止时间已到的请求无法表示。`deadlineMs` 不是正整数或超过预算时，帧无效，被调用方返回 400，不执行操作。（已实现）
- 截止时间在执行中到达时，执行层按 `apps/mcp/src/executor/errors.ts` 的 `timeoutError` 返回，`outcome` 为 `timeout`。（已实现）
  - 读操作返回 `workspace-executor-timeout`，`retryable: true`。
  - 写操作还在排队或尚未开始写入时，返回 `workspace-executor-timeout`，带 `started: false`。
  - 写操作已经开始时，返回 `workspace-result-unknown`，`retryable: false`。
  - `content.execute` 在取得 Unit 队列的 lease 之前都算没有开始，包括校验调用者凭据的阶段。（已实现）

### 6.4 取消不是协议保证

- 协议只保证调用方在截止时间之后不再等待。被调用方能否中途停下工作，由实现决定。
- 常驻型今天的行为如下。
  - 执行层在截止时间中止本次调用的信号。还在队列里的调用不会取得 lease，返回 `started: false`（[架构 6.5](architecture.zh-CN.md#65-错误与结果边界)）。
  - 转换子进程在预算耗尽时被 SIGKILL（[架构 D4](architecture.zh-CN.md#d4-office-作业进程)）。
  - 已经取得 lease 的 worker 继续运行，超时的写入返回 `workspace-result-unknown`。
  - 执行层不监听调用方断开连接。调用方中止请求不会停止执行层上的操作（`apps/mcp/src/executor/dispatch.ts` 只在截止时间中止）。
  - 渲染服务在操作超时时丢弃该 runtime（[架构 7.1](architecture.zh-CN.md#71-渲染服务)）。

### 6.5 长任务的状态在网关

- `import`、`export`、`compile_typst`、`screenshot`、`print_pdf` 五个工具是长任务（`apps/mcp/src/gateway/jobs/model.ts`）。任务记录由网关持有，见 [架构 D5](architecture.zh-CN.md#d5-网关任务生命周期) 和 [工具规格第 7 节](tools.zh-CN.md#7-长任务)。（已实现）
- 对后端来说，长任务只是一次 `deadlineMs` 更长的同步调用。预算为 240 秒的操作有 `exchange.import`、`exchange.export`、`typst.compile`、`render.screenshot`、`render.printPdf`。（已实现）
- 任务的 `deadlineAt` 是创建时刻加 240 秒，并且不晚于调用者凭据的 `expiresAt` 减 5 秒，但不短于同步预算（`apps/mcp/src/gateway/jobs/store.ts`）。（已实现）
- 网关等待同步预算（默认 30 秒，`MCP_SYNC_BUDGET_MS` 可以调低）后返回 `{job_id, status: "running"}`，这次后端调用在网关里继续。网关重启会丢失在途调用。超过 `deadlineAt` 的记录，`job_get` 读到时按超时或结果未知回答，网关不会自动重新执行。客户端用同一个 `idempotency_key` 重试时会重新执行，导入靠确定性的 `unitId` 保证不会建出第二个 Unit（[工具规格第 7 节](tools.zh-CN.md#7-长任务)）。（已实现）
- 后端不保存任何任务状态。（已实现）

## 7. 路由键只是性能提示

- `route(input)` 返回 `{scope, unitId}`。网关用 NUL 连接用户 ID、`scope` 和 `unitId` 作为键，`unitId` 为 null 时用 `requestId` 代替。网关对键和每个执行层地址的 SHA-256 做 rendezvous hashing，得到候选顺序（`apps/mcp/src/gateway/executor/router.ts`）。（已实现）
- 任何实例都必须能正确处理任何请求。每次操作都先 pull，再检查 `baseRevision` 等于目标 revision（`packages/client-core/src/content-runtime.ts` 的 `synchronize`），所以冷实例能从 Workspace 重建状态。路由只影响热缓存是否命中（[架构 6.3](architecture.zh-CN.md#63-路由与状态)）。（已实现）
- `queueFor` 的 FIFO 队列只在一个实例内有效（`apps/mcp/src/executor/dispatch.ts` 的 `createUnitQueue`），键是用户 ID、`scope` 和 `unitId`。协议不保证不同实例之间的顺序，revision 冲突由第 8 节的重跑处理。（已实现）
- 网关只在确定请求没有送达时换下一个候选。没有送达指连接错误 `ECONNREFUSED`、`ENOTFOUND`、`EAI_AGAIN`、`EHOSTUNREACH`、`ENETUNREACH`、`UND_ERR_CONNECT_TIMEOUT`，或者被调用方返回 503。这样的实例在之后 5 秒内不再作为候选，除非所有实例都处在这 5 秒内，那时按原顺序全部重试。（已实现）
- 执行层调用渲染服务只有一个地址，不使用路由键。（已实现）

## 8. 只按目录重跑，写操作不由别人重试

### 8.1 后端按目录重跑

以下规则都已实现，代码在 `apps/mcp/src/executor/dispatch.ts` 和 `apps/mcp/src/executor/runtime.ts`。

- 执行层只为目录 `rerun` 中列出的原因重跑。
- 这两个原因只在脚本运行前、提交前标记。`revision` 指 worker 打开或 pull 时出现 `workspace-result-mismatch` 或 `workspace-runtime-target-stale`。`auth` 指缓存的 worker 持有另一个已被拒绝的 session。
- `auth` 最多重跑一次。`revision` 对读操作最多三次，每次先等待 25 到 100 毫秒的随机退避；对写操作最多一次。
- 重跑前截止时间至少还剩 5000 毫秒，否则返回原错误。
- 每次重跑计入 `mcp_executor_reruns_total{reason}`，worker 成本计入同一个 `meta`。

### 8.2 不得自行重试写操作

- 写请求送达之后，调用方、后端和二者之间的托管平台都不得再次发送或再次执行它。唯一的例外是 8.1 节的重跑。（网关、执行层已实现）
- 网关在请求送达之后也不重试读操作，它返回可重试的 `workspace-executor-timeout`，由客户端决定是否重试。（已实现）
- 执行层调用渲染服务不重试，超时和连接失败返回可重试的错误（`apps/mcp/src/executor/renderer-client.ts`）。（已实现）

### 8.3 提交结果不确定时返回 `workspace-result-unknown`

- 下列情况返回 `workspace-result-unknown`，`detail.retryable` 为 `false`。（已实现）
  - 执行层上，写操作开始后到达截止时间。
  - 执行层上，写操作中 worker 操作超时或崩溃。
  - 执行层上，提交得到 `workspace-submit-retry-exhausted`，或者提交阶段出现没有 code 的错误（[架构 6.5](architecture.zh-CN.md#65-错误与结果边界)）。
  - 网关已经发送写请求，之后连接断开或超时（`apps/mcp/src/gateway/executor/client.ts`）。
  - 网关读到的写操作响应超过 `responseBytes`。
- 超时引起时 `outcome` 为 `timeout`，其他为 `tool_error`。消息提示调用者用同一个 `idempotency_key` 重试，或者先检查当前状态（`apps/mcp/src/shared/errors.ts`）。（已实现）
- `htmlView.create` 和 `exchange.import` 的输入必须带 `idempotencyKey`，`markdown.compile` 和 `typst.compile` 在 `apply` 时可以带。它也参与这些操作的路由键（2.1 节）。（已实现）

## 9. 调用者凭据的类型不由协议固定

### 9.1 字段

- 执行层请求头的 `grant` 字段是调用者凭据。它只放在帧体里，不放在 URL 或 HTTP 头里。（已实现）
- 协议只定义这个字段，不固定它的类型。字段按 `kind` 区分，被调用方拒绝不认识的 `kind`。今天 `executorGrantSchema` 只有 `session` 一种，其他 `kind` 使请求头无效，返回 400。（已实现）
- `session` 的形状为 `{kind: "session", userId, session, expiresAt}`，由网关根据用户的认证结果签发（`apps/mcp/src/gateway/executor/grants.ts`）。（已实现）
- 将来可以增加一种由 Workspace 签发、只对本次调用的目标有效的凭据（[架构第 10 节](architecture.zh-CN.md#10-执行层安全门禁要求) 第 2 条）。（预留）

### 9.2 被调用方的义务

以下规则都已实现，代码在 `apps/mcp/src/executor/credentials.ts`。

- 访问 Workspace 或开始工作之前，执行层确认凭据属于声明的 `userId`。今天它经 `WORKSPACE_TRANSPORT_URL` 调用 whoami，按 session 的 SHA-256 缓存到 `expiresAt`，最多 10 000 条，共用的校验有自己的 10 秒超时。
- 凭据过期、与 session 不符或被 Workspace 拒绝时，返回 `workspace-authentication-required`，`outcome` 为 `auth_error`。
- `userId` 进入每个 worker 键。一次请求的全部 runtime 调用绑定同一个调用者（[架构 6.4](architecture.zh-CN.md#64-凭据)）。
- 渲染服务不接收调用者凭据，也没有到 Workspace 的路径。

### 9.3 白名单是部署策略，不是协议

- `MCP_EXECUTOR_ALLOWED_USER_IDS` 不属于协议。别的部署可以换一种策略，不需要改协议。
- 网关给白名单外的用户空的操作集合（3.2 节）。执行层在访问 Workspace 之前拒绝白名单外的 `userId`，返回 `workspace-permission-denied`。（已实现）

## 10. 每个调用方向各用一个令牌

| 调用方向 | 变量 | 状态 |
| --- | --- | --- |
| 网关调用执行层 | `MCP_EXECUTOR_TOKEN` | 已实现 |
| 执行层调用渲染服务 | `MCP_RENDERER_TOKEN` | 已实现 |

- 两个值必须不同，执行层在两者相同时拒绝启动。只持有其中一个令牌的一方，不能冒充另一个方向的调用方。（已实现）
- 在此之前三个角色共用 `MCP_INTERNAL_TOKEN`，PR #279 删除它。
- 协议只要求被调用方能验证调用方。被调用方在处理能力端点和任何操作之前验证，失败时返回 401，code 为 `workspace-executor-unauthorized` 或 `workspace-renderer-unauthorized`。常驻型用 Bearer 令牌，比较两边的 SHA-256 并用 `timingSafeEqual`（`apps/mcp/src/shared/bearer.ts`）。（已实现）
- serverless 型可以改用平台签名，只要被调用方能验证调用方。（预留）
- 调用方把 401 当作部署故障，不当作调用者的错误。网关返回 `workspace-executor-unavailable`，执行层返回 `workspace-renderer-unavailable`，`outcome` 都是 `internal_error`。网关不因 401 换候选。（已实现）
- `/healthz` 和 `/metrics` 不属于本协议。

## 11. 错误分为传输拒绝和应用失败

### 11.1 传输拒绝

被调用方用非 200 状态码拒绝请求，响应体是 JSON `{error: {code, message, detail: null}}`，`message` 等于 `code`，没有 `outcome` 和 `meta`。（已实现）

| 状态码 | 执行层 code | 渲染服务 code | 原因 |
| --- | --- | --- | --- |
| 401 | `workspace-executor-unauthorized` | `workspace-renderer-unauthorized` | 调用方认证失败 |
| 503 | `workspace-executor-unavailable` | `workspace-renderer-unavailable` | 后端正在排空 |
| 404 | `workspace-executor-operation-unknown` | `workspace-renderer-operation-unknown` | 操作名不在目录里，或方法不是 POST |
| 426 | `workspace-executor-version-mismatch` | `workspace-renderer-version-mismatch` | `x-mcp-rpc-version` 或帧头 `v` 不同 |
| 415 | `workspace-executor-frame-invalid` | `workspace-renderer-frame-invalid` | `content-type` 不对 |
| 413 | `workspace-request-too-large` | `workspace-request-too-large` | 请求帧超过 `requestBytes` |
| 400 | `workspace-executor-frame-invalid` | `workspace-renderer-frame-invalid` | 帧无法解析、头字段无效、`op` 与路径不符，或带了不该有的负载 |
| 500 | `workspace-internal-error` | `workspace-internal-error` | 处理中的意外异常 |

- 认证最先检查，所以令牌错误时，即使操作名未知也返回 401。（已实现）
- 4xx 和 503 都在操作执行之前返回。500 不保证操作没有执行。（已实现）

### 11.2 应用失败

- 被调用方返回 200 和帧，JSON 头为 `{ok: false, error, meta}`。（已实现）
- `error` 有四个字段（`wireErrorSchema`）。`code` 和 `message` 为字符串，`detail` 为任意 JSON，`outcome` 为 `tool_error`、`auth_error`、`timeout` 或 `internal_error`。（已实现）
- 执行层去掉 `detail` 中的本机绝对路径（`apps/mcp/src/shared/errors.ts` 的 `jsonOrNull`）。（已实现）

常见的应用失败如下。

| code | outcome | 含义 |
| --- | --- | --- |
| `workspace-argument-invalid` | `tool_error` | 输入不符合目录的 `input` |
| `workspace-authentication-required` | `auth_error` | 调用者凭据无效或过期 |
| `workspace-permission-denied` | `tool_error` | 用户不在执行层白名单内 |
| `workspace-executor-timeout` | `timeout`；网关发送前就用尽预算时为 `tool_error` | 截止时间到达，`detail.retryable` 为 `true`，未开始时带 `started: false` |
| `workspace-result-unknown` | `timeout` 或 `tool_error` | 写入可能已经提交（8.3 节） |
| `workspace-result-too-large` | `tool_error` | 响应超过 `responseBytes` |
| `workspace-runtime-busy` | `tool_error` | worker 已满，可重试 |
| `workspace-script-failed` | `tool_error` | 用户脚本抛出没有 code 的错误 |
| `workspace-renderer-busy` | `tool_error` | 渲染 runtime 已满，可重试 |
| `workspace-renderer-timeout` | `timeout` | 渲染超时，可重试 |
| `workspace-renderer-not-configured` | `tool_error` | 部署没有渲染服务，不可重试 |
| `workspace-internal-error` | `internal_error` | 内部错误，不带细节 |

### 11.3 调用方如何处理结果

网关的处理在 `apps/mcp/src/gateway/executor/client.ts`。（已实现）

| 结果 | 网关返回 |
| --- | --- |
| 未送达，或 503 | 换下一个候选。全部失败时返回 `workspace-executor-unavailable`，`internal_error` |
| 413 | `workspace-request-too-large`，`tool_error` |
| 426 | `workspace-executor-version-mismatch`，`tool_error` |
| 其他非 200 | `workspace-executor-unavailable`，`internal_error`，不换候选 |
| 已发送，之后断开或超时 | 写返回 `workspace-result-unknown`；读返回 `workspace-executor-timeout`，`outcome` 为 `timeout`，`detail` 带 `retryable: true` 和原因 |
| 200 帧无法解析或不符合 schema | `workspace-internal-error`，`internal_error` |
| `ok: false` | 原样转交信封和 `meta` |

执行层调用渲染服务的处理在 `apps/mcp/src/executor/renderer-client.ts`。连接失败或 503 返回可重试的 `workspace-renderer-unavailable`。超时返回可重试的 `workspace-renderer-timeout`。413 返回 `workspace-request-too-large`。426 返回 `workspace-renderer-version-mismatch`，`outcome` 为 `internal_error`。其他非 200 返回 `workspace-renderer-unavailable`，`outcome` 为 `internal_error`。（已实现）

## 12. 版本不兼容的后端被排除

- 协议版本是 `PROTOCOL_VERSION`（`apps/mcp/src/shared/executor-protocol.ts`），今天为 1，渲染服务协议使用同一个常量。兼容指相等。（已实现）
- 版本出现在三处，即请求头 `x-mcp-rpc-version`（代码中写为字面量 `"1"`）、帧头 `v`、能力响应 `v`。（已实现）
- 调用时版本不同，被调用方返回 426（11.1 节）。（已实现）
- 能力响应的 `v` 不同时，网关把这个后端排除出可用操作集合和路由。（已实现）网关是否就绪按 3.3 节的规则，只取决于启动后是否记录到过兼容的执行层。（已实现）
- 能力响应里有目录中没有的操作名时，网关忽略这些名字。（已实现）

## 13. 执行层调用渲染服务，网关不编排

- `render.*` 和 `svg.compile` 是执行层的操作。执行层用调用者凭据加载 Unit，组装渲染数据，然后不带凭据调用渲染服务（`apps/mcp/src/executor/ops/render-screenshot.ts`、`render-print-pdf.ts`、`render-lint.ts`）。（已实现）
- `render.screenshot`、`render.printPdf`、`render.lint` 分别调用一次 `screenshot`、`printPdf`、`lint`。`svg.compile` 不估算量字时，每量一行调用一次 `measureText`（`apps/mcp/src/executor/ops/svg-compile.ts`）。（已实现）
- 没有配置渲染服务时，执行层不声明 `render.*`，`svg.compile` 改用估算量字。直接调用渲染操作时，执行层先加载 Unit，再返回 `workspace-renderer-not-configured`；Unit 读不到时先返回读取错误。（已实现）可用渲染能力按 3.1 节的声明判断。
- 渲染服务返回的 `render_pages` 计入执行层这次调用的 `meta`。网关只看到一次调用。（已实现）
- 这条调用链留在后端内部。网关不调用渲染服务，也不为渲染编排步骤。

## 14. 这些约定为什么不挡住 serverless 型实现

这一节解释上面的规则为什么这样写。它是说明，不是规格。

- **能力由后端声明。** 网关按后端的声明决定工具是否可见，而不是按配置了哪些地址推断。一个不能运行 Chromium 的部署不声明 `render.*` 就行，网关的工具代码不变。
- **后端无状态，调用同步且有截止时间。** 函数实例可能在任何一次调用之后被回收。长任务的记录在网关，每次调用自带截止时间，所以丢失一个实例只多一次冷启动，不丢任务。
- **路由键只是提示。** serverless 平台自己选择实例。协议本来就把路由当作缓存亲和，实例随机分配只影响速度，不影响正确性。
- **大负载可以按引用传递。** 今天 64 MiB、128 MiB 的内联帧超过函数平台的同步请求上限（第 16 节）。现在预留引用方式，将来的差异主要落在操作目录和 `executorTool` 里，带负载的工具只改准备和取回字节的方式（第 1 节）。
- **写操作不由别人重试。** 有的平台默认重试异步调用。把这条写进协议，它就成了对部署的要求，而不是今天 HTTP 客户端碰巧不重试。
- **调用者凭据不固定类型。** 平台隔离不能限制脚本用用户的 session 做什么。字段不固定类型，以后换成按目标限定的凭据不需要改帧。
- **认证只要求可验证。** 平台可以用自己的签名代替 Bearer 令牌。按方向区分令牌，让每个方向可以独立换成平台签名。
- **取消不是保证。** 函数调用难以中途取消。协议从不依赖取消，只依赖截止时间。
- **渲染留在后端内部。** 渲染服务无论怎样部署，网关和执行层之间的协议都不变。

## 15. 契约测试必须覆盖的检查

契约测试把下列检查写成测试，任何后端实现都必须通过。今天它们在常驻型执行层和渲染服务上运行。（已实现）

后端必须通过的检查如下。

| 检查 | 请求 | 期望 | 证明的规则 |
| --- | --- | --- | --- |
| 能力端点的形状 | 正确令牌的 `GET /rpc/v1/capabilities` | 200，JSON 符合 `{v, operations}`，`v` 为 1，每个操作名都在该角色的目录里，`render.*` 符合 3.1 节的条件 | 3.1 节。渲染服务部分已实现 |
| 能力端点的认证 | 不带令牌，或令牌错误 | 401 和对应的 `unauthorized` code，不返回能力 | 3.1 节，第 10 节。渲染服务部分已实现 |
| 帧格式 | 合法帧；不足 4 字节；头长度为 0；头长度大于剩余字节；头不是合法 UTF-8 或 JSON | 合法帧被处理，其余返回 400 `frame-invalid` | 4.2 节 |
| 请求头 | `content-type` 错误；`op` 与路径不符；不接受负载的操作带了负载 | 分别返回 415、400、400 | 4.1、4.3、4.4 节 |
| 请求大小上限 | `content-length` 超过 `requestBytes`；不带 `content-length`、流式发送超过 `requestBytes` 的请求体 | 413 `workspace-request-too-large`，操作没有执行 | 4.5 节 |
| 响应大小上限 | 结果超过 `responseBytes` 的操作 | 200，失败信封 `workspace-result-too-large`；已提交的 `content.execute` 带 `valueTruncated: true` | 4.5 节 |
| 已提交写入的结果过大 | 一次 `apply` 成功、结果超过 `responseBytes` 的 `svg.compile` | 失败信封 `workspace-result-too-large`，`detail.committed` 为 `true`，`retryable` 为 `false` | 4.5 节。已实现 |
| 版本不一致 | `x-mcp-rpc-version: 2`；帧头 `v` 为 2 | 426 和对应的 `version-mismatch` code | 第 12 节 |
| 未知操作 | `POST /rpc/v1/` 加一个不在目录里的名字；对目录里的操作发 GET | 404 和对应的 `operation-unknown` code | 2.1、2.2 节，11.1 节 |
| 错误信封的形状 | 输入不符合目录 schema 的合法帧 | 200，`ok: false`，`error` 有四个字段，code 为 `workspace-argument-invalid`，`outcome` 为 `tool_error`，`meta` 符合 `opMetaSchema` | 4.4 节，11.2 节 |
| 截止时间已到 | `deadlineMs` 为 0；`deadlineMs` 为预算加 1 | 400 `frame-invalid`，操作没有执行 | 6.3 节 |
| 传输拒绝与应用失败 | 上面的拒绝请求，与一次应用失败对比 | 拒绝为非 200、JSON `{error}`、没有 `meta`；应用失败为 200 帧并带 `meta` | 第 11 节 |
| 写操作只执行一次 | 对一个 Worktree 中的 Unit 发送一次合法的 `content.execute`，脚本每次运行都改变内容（例如把一个单元格加 1），记录前后的 revision | revision 正好增加 1，响应只有一个 | 8.2 节 |
| 按截止时间回答 | 对 `content.execute` 写入；Workspace 替身永不应答；`deadlineMs` 为 2000，请求体在 1500 毫秒内慢慢上传 | 从开始发送起不晚于 `deadlineMs` 加 1000 毫秒得到 `workspace-executor-timeout` 和 `started: false` | 6.2、6.3 节。已实现 |
| 用错方向的令牌 | 用 `MCP_RENDERER_TOKEN` 调用执行层；用 `MCP_EXECUTOR_TOKEN` 调用渲染服务 | 都返回 401 | 第 10 节 |

网关一侧的检查如下。

| 检查 | 做法 | 期望 | 证明的规则 |
| --- | --- | --- | --- |
| 版本不兼容的执行层被排除 | 两个执行层中一个在能力响应里返回 `v: 2`；唯一的执行层从启动起返回 `v: 2`；唯一的执行层在网关就绪后改报 `v: 2` 并等到下一次刷新 | 第一种只把兼容的执行层计入路由，`/readyz` 返回 200；第二种 `/readyz` 返回 503 并指出 `executor`；第三种依赖执行层的工具不在 `tools/list` 中，`/readyz` 仍为 200 | 3.3 节，第 12 节。第三种已实现 |
| 写操作不重试 | 一个收下写请求后断开连接的执行层 | 它只收到一次请求，工具返回 `workspace-result-unknown` | 8.2、8.3 节 |

## 16. 将来的 serverless 实现思路

> 这一节只记录 G0 讨论中的思路，不做设计，也不做推荐。本阶段不实现。

- **隔离单元。** 将来考虑“每个租户一个实例，空闲回收”，由平台提供隔离，而不是在 MCP 代码里自己实现。
  - AWS Lambda 在 2025 年 11 月推出 tenant isolation mode。函数设置 `TenancyConfig.TenantIsolationMode=PER_TENANT`，每次调用带租户 ID，不同租户不共享执行环境，同一租户可以复用。所有租户仍共用函数的执行角色。
  - 阿里云函数计算在 2025 年 7 月推出实例隔离和会话隔离。一个请求或一个会话独占一个实例，需要 2 核以上规格，并发度固定为 1。自定义容器是否支持会话隔离，文档没有明说（推断支持）。
  - FaaS 默认会把同一个实例复用给不同请求，不开启上述功能就没有租户隔离。
- **负载大小。** 这会直接影响协议设计，也是第 5 节预留按引用传递的原因。
  - Lambda 同步调用的请求和响应各上限 6 MB，不能调整。流式响应最大 200 MB。
  - 函数计算的同步请求体上限 32 MB。
  - 今天执行层的 RPC 帧，导入为 64 MiB，导出为 128 MiB（[架构 D4](architecture.zh-CN.md#d4-office-作业进程)）。
  - 所以协议要允许大文件按引用传递，例如预签名地址。
- **部署。** 同一个镜像可以在多处运行。Lambda 借助 Lambda Web Adapter，在镜像里加一个扩展，不在 Lambda 时不启动。函数计算用自定义容器的 Web 函数。云厂商相关的代码只在网关一侧的一小段调用适配上，比如租户 ID 头或会话头。
- **平台隔离解决不了的部分。** [架构第 10 节](architecture.zh-CN.md#10-执行层安全门禁要求) 的第 2 条要求脚本的权限不超过本次调用所需。脚本拿到的仍是用户的 session。将来倾向由 Workspace 签发只对本次目标有效的凭据，而不是在 MCP 里做代理。
- **其他代价。**
  - 平台的环境变量对代码可见。Lambda 还会把执行角色的临时凭据放进环境变量。
  - 到 Workspace 的网络必须同区域、互通，包括协同 WebSocket。
  - 平台有配额。函数计算单地域默认 300 个实例。
  - 冷启动按租户计算。热调用约 14 毫秒，冷打开约 1.5 秒（[架构 6.2](architecture.zh-CN.md#62-worker-池)，Docker Desktop 实测）。
  - 函数调用难以中途取消。
  - 异步调用默认会重试，而 `execute` 的提交不能重试。

参考来源：

- [AWS Lambda tenant isolation mode（AWS Compute Blog）](https://aws.amazon.com/blogs/compute/building-multi-tenant-saas-applications-with-aws-lambdas-new-tenant-isolation-mode)
- [TenancyConfig API](https://docs.aws.amazon.com/lambda/latest/api/API_TenancyConfig.html)
- [Lambda 200 MB 流式响应](https://aws.amazon.com/about-aws/whats-new/2025/07/aws-lambda-response-streaming-200-mb-payloads)
- [boto3 invoke 负载限制](https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/lambda/client/invoke.html)
- [AWS Lambda Web Adapter](https://github.com/aws/aws-lambda-web-adapter)
- [函数计算实例隔离](https://www.alibabacloud.com/help/zh/functioncompute/overview-of-instance-isolation)
- [函数计算会话隔离](https://help.aliyun.com/zh/functioncompute/session-isolation-configuration)
- [函数计算同步调用](https://help.aliyun.com/zh/functioncompute/fc-3-0/user-guide/synchronous-invocations)
- [函数计算配额](https://help.aliyun.com/zh/functioncompute/limits-of-usage)
