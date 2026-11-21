# FC HeaderField 亲和方案

> 方案已确定（2026-11-21）：**会话隔离 + 多 gateway 确定性派生 + `EXECUTOR_MAX_JOBS=1`**。gateway 侧亲和与 FC executor 装配已实现（[`apps/mcp/src/executor-fc`](../../../apps/mcp/src/executor-fc/README.md)）；平台细节仍待落地验证（见第 6 节）。这里的 FC 指阿里云函数计算。
> 配套的 WebSocket 方案见 [serverless-fc.zh-CN.md](serverless-fc.zh-CN.md)。
> 性能数字来自本地 Docker Desktop 基线（[架构 6.2 / 7.1.1](architecture.zh-CN.md)），不是生产结论。
> FC 的产品行为以官方文档为准，本文引用处均已标注链接。

## 1. 目的与结论

把 `apps/mcp` 的 **executor** 迁到 FC，并用 **HTTP + HeaderField 亲和** 把同一个 `(userId, scope, unitId)` 钉到同一个实例。

已确定的方案：

1. **隔离模式：会话隔离。** 一个 key 一个实例，单实例 Session 数=1；HeaderField 亲和随会话隔离自动启用。
2. **多 gateway 副本：确定性派生。** `epoch` 放共享存储，`sid = hash(runtimeKey + ":" + epoch)`；401 时原子 `INCR epoch` 后重试一次，所有副本算出同一个 ID。
3. **worker / conversion：一个实例一个 worker，`EXECUTOR_MAX_WORKERS=1`、`EXECUTOR_MAX_JOBS=1`。** 去掉多 worker 池；每个实例一次只跑一个转换。
4. **顺序：实例内 per-key FIFO。** 亲和不串行，会话隔离也不串行；同一 Session 的并发请求仍要靠 FIFO。
5. **WebSocket 不用于 gateway → executor。** 对比与理由见 [WebSocket 方案](serverless-fc.zh-CN.md)。
6. **10 秒级调用间隔**下，会话亲和最合适：实例在两次调用之间浅休眠，下次热唤醒；长连接反而在空闲期间持续计费。

---

## 2. FC 机制速览

### 2.1 运行形态

- 推荐 **自定义容器**（Custom Container）：复用现有镜像和 HTTP server，监听 `0.0.0.0:9000` 或自定义端口。
- HTTP 触发器支持 GET/POST/PUT/DELETE，也支持 WebSocket（函数作为 WebSocket Server）。

### 2.2 实例隔离

| 模式           | 行为                                              | 对 executor 的意义                        |
| -------------- | ------------------------------------------------- | ----------------------------------------- |
| 不隔离（默认） | 一个实例按并发复用，可累积处理多个请求            | 等价于现在的共享 executor，隔离最弱       |
| **请求隔离**   | 一个请求独占一个实例，**强制单实例并发=1**        | 一个 invocation 一个 op，不需要 worker 池 |
| **会话隔离**   | 一个会话独占一个实例，**强制单实例 Session 数=1** | 一个 key 一个实例，per-key actor          |

**本方案选择会话隔离。** 请求隔离和“不隔离 + 亲和”不采用：前者每次调用都冷启动，后者隔离最弱；理由见 3.8 和 4。

限制：

- 请求隔离和会话隔离都要求**实例规格 ≥ 2 vCPU**。
- 请求隔离与会话隔离不能同时开启。
- 请求隔离下会话亲和不可用。
- 会话隔离会自动开启会话亲和，Session 数固定为 1。
- 异步请求不支持会话能力（亲和与隔离都不支持）。

来源：[实例隔离概述](https://help.aliyun.com/zh/functioncompute/overview-of-instance-isolation)、[实例隔离配置实践](https://help.aliyun.com/zh/functioncompute/instance-isolation-configuration-practices)。

### 2.3 会话亲和

四种类型：

- Cookie 亲和（服务端植入 `x-fc-cookie-session-id`）；
- **HeaderField 亲和**（自定义请求头，本文使用；会话隔离会自动开启它）；
- MCP SSE 亲和；
- MCP Streamable HTTP 亲和。

通用限制：

- 单实例最大并发度固定 **200**，不可调；
- 每个 Session 占 1 个 Session 配额，每个请求占 1 个请求配额；
- 多个 Session 共享 200 的请求配额，耗尽返回 **429**；
- 单实例可并发 Session 数默认 20、最大 200；
- HeaderField：Header 名 5–40 字符、字母开头、不能以 `x-fc-` 开头；Header 值 1–64 字符、字母/数字/下划线开头，后续只能包含字母、数字、下划线、连字符；
- 未传 Header 时服务端生成会话 ID，并通过响应头返回；传了合法 ID 则以该值作为会话标识；
- Session 无效或过期返回 **401**，HeaderField 值非法返回 **400**。

来源：[会话亲和通用限制及原理说明](https://help.aliyun.com/zh/functioncompute/cookie-affinity-feature-1)、[HeaderField 亲和](https://help.aliyun.com/zh/functioncompute/headerfield-affinity)。

### 2.4 Session 的两个计时器

| 计时器                   | 默认值             | 起点             | 请求是否刷新                     |
| ------------------------ | ------------------ | ---------------- | -------------------------------- |
| Session Idle（空闲超时） | 1800 秒（30 分钟） | 最后一次请求时间 | **会**，每次请求更新最后活跃时间 |
| Session 生命周期（TTL）  | 21600 秒（6 小时） | Session 创建时间 | **不会**，绝对上限               |

- 10–20 秒一次的调用间隔远小于 Idle，**30 分钟空闲超时不会触发**。
- 唯一会断的是 **6 小时 TTL**，每 6 小时一次重建（冷启动）。
- Session 过期后继续携带旧 ID 不会“复活”，只会继续 401；需要新 Session（确定性派生通过 `INCR epoch` 生成新 ID；必要时回退为不带 Header 创建）。

### 2.5 超时、计费与生命周期

- 函数最长执行 **24 小时**；HTTP 和 WebSocket 都受函数执行超时约束。
- 活跃实例按 vCPU/内存计费；请求结束后可转入**浅休眠**：vCPU 不计费、内存计费，下次请求热唤醒。
- 最小实例数 ≥ 1 可以避免冷启动；浅休眠是“保活 + 省 vCPU”的组合。
- 30 分钟 idle 期间**只付内存，不付 vCPU**；Session 过期释放后停止计费（`min instances = 0` 时）。

来源：[超时 FAQ](https://www.alibabacloud.com/help/en/functioncompute/what-can-i-do-if-my-function-exceeds-the-timeout-period-1)、[最小实例数 vs 预留实例](https://help.aliyun.com/zh/functioncompute/differences-between-minimum-number-of-instances-and-snapshots-or-reserved-instances)。

### 2.6 与本项目相关的版本限制

- FC 的 **MCP SSE / MCP Streamable HTTP 亲和**标注支持 MCP `2025-03-26` / `2025-06-18`；本项目 gateway 使用 `2025-11-25` 和 `2026-07-28`。这两类亲和是给“把 MCP Server 托管在 FC 上”用的，**不适用于 gateway → executor 这一跳**。
- 内置运行时不支持 MCP SSE 亲和；MCP 运行时只支持 MCP 亲和。自定义容器没有这个限制。

来源：[MCP Streamable HTTP 亲和](https://help.aliyun.com/zh/functioncompute/mcp-streamable-http-affinity)、[MCP SSE 亲和](https://help.aliyun.com/zh/functioncompute/mcp-sse-affinity)。

---

## 3. 方案：HTTP + HeaderField 亲和

### 3.1 拓扑

```text
MCP client ──Streamable HTTP──▶ gateway（长驻，公网）
                                   │
                                   │ HTTP + HeaderField: x-executor-key
                                   ▼
                              FC executor（自定义容器）
                                   ├─ 单 Univer runtime（会话隔离时）
                                   └─ 可选 conversion child
                                   │
                                   ▼
                              Workspace（HTTP + 协同 WS）
```

- gateway 继续长驻：MCP 协议、认证、staging、`job_get`、限流都在这里。
- executor 用 FC 自定义容器；renderer 不建议迁 FC（Chromium 3 GiB、冷启动约 3 秒、CPU 密集），继续长驻。
- 长任务仍由 gateway 的 `ToolJobs` 转成 `job_id`，`job_get` 轮询。

### 3.2 key 与 Header

```text
runtimeKey = (userId, scope, unitId)
headerName = "x-executor-key"
headerValue = "k" + sha256(runtimeKey.join("\0")).hex.slice(0, 32)
```

- Header 名满足 5–40 字符、字母开头、不以 `x-fc-` 开头。
- Header 值满足 1–64 字符、字母开头、只含字母/数字/下划线/连字符；不能直接放 `unit:<id>`（冒号非法），所以用哈希。
- 同一个 key 在 gateway 的多副本上必须算出同一个值，否则会建出多个 Session。

### 3.3 Session 生命周期状态机

已确定使用确定性派生，不依赖响应头回读：

```text
epoch = shared.get("epoch:" + runtimeKey) ?? 0
sid   = "k" + sha256(runtimeKey + ":" + epoch).hex.slice(0, 32)

请求带 Header x-executor-key: sid
  ├─ 200 → 继续使用
  └─ 401（平台 Session 失效）
           → shared.INCR("epoch:" + runtimeKey)
           → 用新 epoch 重算 sid
           → 重试一次
```

伪代码：

```ts
async function callWithAffinity(key: string, request: Request): Promise<Response> {
  const epoch = (await epochs.get(key)) ?? 0;
  let sid = deriveSessionId(key, epoch);
  let response = await post(request, sid);

  if (response.status === 401 && isFcSessionError(response)) {
    const next = await epochs.increment(key); // atomic INCR
    sid = deriveSessionId(key, next);
    response = await post(request, sid);
  }
  return response;
}

function deriveSessionId(key: string, epoch: number): string {
  return "k" + sha256(`${key}:${epoch}`).hex.slice(0, 32);
}
```

要点：

- 所有 gateway 副本用同一个 `epoch` 算出同一个 `sid`，不需要读响应头，也不需要各副本自己维护 Session 映射。
- `epoch` 必须放在**共享、原子递增**的存储里（Redis/DB）；这是 gateway 唯一的共享状态。
- 401 重试只针对 **FC 平台级 Session 401**；应用自己的 401（Workspace 认证失败）不能盲目重试。
- 平台级 401 发生在函数执行之前，请求未进入函数，重试是安全的；写操作不会重复提交。
- 前提：FC 接受客户端传入的、未绑定的合法 Session ID。若实测过期后新派生 ID 仍被拒绝，回退为“不带 Header 创建，再把返回值写入共享映射”；见第 6 节。

### 3.4 多 gateway 副本

**已确定：确定性派生。**

```text
epoch = shared.get("epoch:" + runtimeKey) ?? 0
sid   = "k" + sha256(runtimeKey + ":" + epoch).hex.slice(0, 32)
```

- 所有 gateway 对同一个 key 算出同一个 `sid`，不需要读响应头；
- 401 时对 epoch 做原子 `INCR`，重算 `sid`，重试一次；
- 只需要共享一个很小的 epoch 状态。

要求：

- epoch 存储必须共享且原子递增；
- 同一 epoch 下所有副本算出同一个 `sid`，避免同一 key 建出多个 Session；
- epoch 不设过期，或过期时间远大于 Session TTL，避免网关长时间空闲后 epoch 回退；
- 并发 401 时多个副本可能各自 `INCR` 到不同 epoch，产生两个 `sid`；用按 key 的短锁或 CAS 收敛，至少避免长期双 Session。

**不采用：每个副本各自维护 `key → sessionId` 缓存。** 这会让同一个 key 建出多个 Session，落到多个实例，亲和、串行和缓存全部失效。

### 3.5 并发与顺序

**HeaderField 亲和只解决“落到哪个实例”，不解决“谁先谁后”。**

FC 的并发模型：

- 单实例最大并发 200；
- 同一个 Session 下可以同时跑多个请求，直到 200 用完；
- 会话隔离只把“单实例 Session 数”固定为 1，**不会把同一个 Session 的请求串行化**。

因此同一 key 的并发请求会在同一个 Node 进程里并发执行，`await` 处互相交错。要保证顺序，需要应用层：

1. **实例内 per-key FIFO**（推荐，现有代码已有）：[`createUnitQueue()`](../../../apps/mcp/src/executor/dispatch.ts)。
2. **gateway 侧分布式锁**：适用于请求隔离（无亲和）或 Session 漂移窗口。
3. **队列层保证**：SQS FIFO 的 `MessageGroupId`、Kafka partition、Temporal `workflowId`。

注意：

- 确定性派生下，两个副本同时首次请求会算出同一个 `sid`；如果 FC 对未绑定 ID 的并发创建有竞态，需要 gateway 锁兜底，并以实测为准。
- Session 过期/漂移时，同一个 key 可能短暂落到两个实例；Workspace 的 revision CAS 会拒绝第二个提交，但 `content.execute` 对冲突**不自动重试**，用户会看到 `WORKSPACE_RUNTIME_CONFLICT`。
- 需要严格顺序的写路径，建议 gateway 锁 + 实例内 FIFO 双保险。

### 3.6 长任务

- FC 函数最长 24 小时，4 分钟的 import/export/Typst/render 不需要拆。
- 但 gateway 的 30 秒同步预算仍然存在：超过 30 秒转 `job_id`，`job_get` 轮询。
- **异步请求不支持会话亲和/隔离**：如果长任务走 FC 异步调用，不能依赖 key 亲和，顺序只能靠队列或锁。
- 结果回传：FC 需要把结果写到 gateway staging 或 OSS，再让 `job_get` 取；不能直接依赖同步 HTTP 响应。

### 3.6.1 与 MCP Tasks 的区别

MCP 2025-11-25 引入了**实验性的 Tasks utility**：`tools/call` 可以携带 `task` 字段，服务端返回 `CreateTaskResult`，客户端通过 `tasks/get` 轮询、`tasks/result` 取结果、`tasks/cancel` 取消，工具通过 `execution.taskSupport` 声明 `required` / `optional` / `forbidden`（[Tasks](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks)）。

本仓库**没有使用**它：

- gateway 没有声明 `tasks` capability；
- 返回的是普通工具结果 `structuredContent: { job_id, status }`，不是 `CreateTaskResult`；
- 轮询走普通工具 `job_get`，不是 `tasks/get` / `tasks/result`。

30 秒同步预算是 gateway 自己的 `MCP_SYNC_BUDGET_MS`，不是协议行为。两者可以共存：将来若接入 MCP Tasks，`job_get` 可以保留为不支持 Tasks 的客户端的回退。

### 3.7 worker 与 conversion

已确定：

| 项目                   | 配置                  | 理由                                                |
| ---------------------- | --------------------- | --------------------------------------------------- |
| 隔离模式               | 会话隔离              | 一个 key 一个实例，Session 数=1                     |
| worker 池              | **去掉**              | 一个 FC 实例只服务一个 key，单 worker 足够          |
| `EXECUTOR_MAX_WORKERS` | `1`                   | 保留配置项时固定 1；新实现可直接移除池              |
| conversion 队列        | `EXECUTOR_MAX_JOBS=1` | 每个实例一次只跑一个转换，避免 2×256 MiB 堆         |
| conversion child       | 保留 1 个             | `--max-old-space-size`、原生泄漏随进程退出、SIGKILL |

为什么不是多 worker / 多 job：

- 会话隔离下，一个实例只服务一个 Session；多 worker 只会增加内存和状态，不会提高该 key 的吞吐。
- 一个 key 的操作由实例内 FIFO 串行；转换并发 2 只会让一个实例同时持有两个原生转换进程，内存和故障域都变大。
- 请求隔离（每次一个请求）也会让 worker 池失去意义，但它每次调用都冷启动，不作为本方案。

### 3.8 10 秒间隔与容量

10 秒一次、每次 14 ms（热）意味着：

- Session Idle 30 分钟永远不会触发；
- 实例在两次调用之间进入浅休眠：vCPU 不计费、内存计费，下一次热唤醒；
- 唯一的强制冷启动是 6 小时 TTL。

容量估算：

```text
并发 key 容量 ≈ 活跃 key 数（会话隔离时一个 key 一个实例）
每实例内存 ≈ 1 GiB（单 worker）～ 2 GiB（含转换子进程）
总内存 ≈ 活跃 key 数 × 每实例内存
```

对比：

| 方案                        | 状态     | 1 个热 key                                   | 100 个活跃 key（每 10 秒一次）                            |
| --------------------------- | -------- | -------------------------------------------- | --------------------------------------------------------- |
| 常驻 executor（现状）       | 对比     | 固定 ~1.4 GiB（4 worker × 250 MiB + 父进程） | 4 个 worker 装不下 100 个 key，命中率约 4%，大量冷启动    |
| FC 会话隔离                 | **已选** | 1 个实例，浅休眠，热唤醒                     | 100 个实例 × 1–2 GiB 内存连续计费                         |
| FC 请求隔离                 | 不采用   | 每次冷启动 1.5 s+                            | 按请求，每次冷启动                                        |
| FC 不隔离 + 亲和 + N worker | 不采用   | 1 个实例，N 个 key 共享                      | 实例数 ≈ 活跃 key / 每实例 key 数，命中率取决于 worker 数 |

结论：

- 本方案选择**会话隔离**：少量活跃 key（个位数到几十）最合适。
- 大量稀疏 key（上百）时 per-key 实例成本线性上涨；需要分层（热 key 长驻、冷 key 请求隔离）或重新评估是否值得上 FC。
- **请求隔离不采用**：每次调用 1.5 s+ 冷启动，10 秒节奏下不可接受。
- **10 秒节奏本身不构成使用 WebSocket 的理由**；它说明负载“几乎常热”，FC 的缩容收益有限，常驻 executor 可能更简单。

### 3.9 失败语义

| 情况                | FC 行为         | gateway 应对                                    |
| ------------------- | --------------- | ----------------------------------------------- |
| Session 过期/无效   | 401             | 原子 `INCR epoch`，用新派生 ID 重试一次         |
| Header 值非法       | 400             | 修正 key 派生，不重试                           |
| 单实例 200 并发耗尽 | 429             | 退避重试；评估调小每实例 Session 数             |
| 实例达到地域上限    | 429             | 退避 + 申请配额                                 |
| 函数执行超时        | 连接/请求被终止 | 写操作返回 `workspace-result-unknown`，先查状态 |
| 实例回收/冻结       | 连接断开        | 重连；协同 WS 重新 ticket + revision 校验       |

`INCR epoch` 后如果新派生 ID 仍返回 401，回退为“不带 Header 创建，并把返回的 Session ID 写入共享映射”；这一行为需要 FC 实测确认（见第 6 节）。

写操作的重试规则不变：

- 平台不得自动重试写；Temporal/队列/FC 异步调用的重试都要显式关闭或依赖幂等键。
- 提交阶段不确定时返回 `workspace-result-unknown`，让调用方先查当前状态。

### 3.10 代码改动清单

| 现状                                                       | FC HeaderField 方案（已确定）                             |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| `MCP_EXECUTOR_URLS` 多地址 + `ExecutorRouter` + rendezvous | 单个 FC HTTP 触发器地址；删除 router                      |
| `ExecutorCapabilities` 轮询多副本                          | 单端点，保留版本/能力发现                                 |
| worker 池 + `EXECUTOR_MAX_WORKERS=4`                       | 去掉池；一个 FC 实例一个 worker，`EXECUTOR_MAX_WORKERS=1` |
| `ConversionJobQueue` + `EXECUTOR_MAX_JOBS=2`               | `EXECUTOR_MAX_JOBS=1`，一次一个转换                       |
| `/rpc/v1/<op>` 同步                                        | 短操作同步；长操作 FC 异步 + `job_get`                    |
| 无 Session 管理                                            | 确定性派生 `sid` + 共享 epoch + 401 重试                  |
| gateway 无状态                                             | 仍无状态；依赖共享 epoch 存储                             |
| 实例内 Sheet Lens 缓存                                     | 保留在实例内，接受冷启动重建                              |
| 协同 WS 常驻                                               | 会话隔离下保活 + 重连 + revision 校验                     |

---

## 4. 推荐落法

```text
MCP client ──Streamable HTTP──▶ gateway（长驻）
                                   │
                                   ├─ HTTP + HeaderField ──▶ FC executor
                                   │     └─ 实例内 createUnitQueue
                                   │
                                   └─ HTTP ──▶ renderer（长驻，Chromium）
```

- **gateway → executor：会话隔离 + HTTP HeaderField + 确定性派生 + 实例内 per-key FIFO。**
- **worker / conversion：** 去掉 worker 池，一个 FC 实例一个 worker；`EXECUTOR_MAX_JOBS=1`。
- **executor → Workspace：出站 WS。** 会话隔离下保活 + 重连 + revision 校验。
- **长任务：异步调用 + `job_get` 轮询。** 不要用 WS 长连接等结果。
- **WebSocket 不用于 gateway → executor**，理由见 [WebSocket 方案](serverless-fc.zh-CN.md)。

### 决策表

| 决策       | 选择                                                  |
| ---------- | ----------------------------------------------------- |
| 隔离模式   | **会话隔离**（一个 key 一个实例，Session 数=1）       |
| 路由       | HTTP + HeaderField，key 确定性派生                    |
| worker     | 去掉池；一个实例一个 worker，`EXECUTOR_MAX_WORKERS=1` |
| conversion | `EXECUTOR_MAX_JOBS=1`                                 |
| 顺序       | 实例内 per-key FIFO                                   |
| 长任务     | 异步 + `job_get`                                      |
| WebSocket  | 不用于 gateway → executor                             |

---

## 5. 与本仓库现状的差距

1. **路由**：`MCP_EXECUTOR_URLS` + `ExecutorRouter` + rendezvous 假设地址可枚举；FC 只有一个端点，需要删除 router，把亲和交给 FC。
2. **能力发现**：`ExecutorCapabilities` 从“多副本交集”退化为“单逻辑后端”，版本不兼容排除仍然保留。
3. **认证**：继续用 `MCP_EXECUTOR_TOKEN` 或 FC 的 Bearer/签名认证；FC 环境变量对代码可见，不能让用户代码读到长期 token。
4. **Session 管理**：gateway 需要新增确定性派生 + 共享 epoch + 401 重试。
5. **worker 配置**：去掉 worker 池，一个 FC 实例一个 worker，`EXECUTOR_MAX_WORKERS=1`。
6. **转换队列**：`EXECUTOR_MAX_JOBS=1`，一次一个转换。
7. **长任务**：FC 异步调用需要新的结果回传路径（staging/OSS），`ToolJobs` 仍留在 gateway。
8. **渲染**：renderer 不建议迁 FC，继续长驻容器/ECS。
9. **协同 WS**：FC 下实例生命周期更短，需要重连和 revision 校验；现有 `synchronize()` 已经每次 pull，是基础。
10. **Sheet Lens 缓存**：实例内缓存随实例释放，百万格建模约 4.5 秒会重复发生；需要接受或外置缓存。

---

## 6. 待确认问题

1. **过期后的新派生 ID**：FC 是否接受客户端传入的、未绑定的合法 Session ID；如果过期后新派生 ID 仍被拒绝，需要回退为“不带 Header 创建 + 共享映射”。
2. **TTL/Idle 可配置范围**：6 小时和 30 分钟之外能调到多少；是否能用 SessionAPI 主动续期/轮换。
3. **异步调用**：FC 异步调用如何把结果送回 gateway；是否支持回调/目标；平台重试策略是否能关闭。
4. **网络**：FC 出站到 Workspace 协同 WS 的稳定性；VPC/NAT/固定 IP 需求；连接在冻结/唤醒后的行为。
5. **配额**：最大实例数、2 vCPU 规格的成本、单账号并发配额。
6. **计费**：浅休眠内存计费的实际单价；与常驻容器对比。
7. **安全**：FC 实例隔离是否满足多租户要求；grant 是否仍需按任务限定；环境变量可见性。
8. **平台重试**：FC HTTP 触发器/异步调用是否会自动重试；写操作如何确保不重复。
9. **首次并发**：确定性派生下，两个 gateway 副本同时首次请求会算出同一个 `sid`；FC 是否只创建一个 Session，需要实测。
10. **会话隔离与 HeaderField 组合**：会话隔离下 Session 数=1，HeaderField 值变化是否一定落到新实例；key 哈希必须稳定。
11. **多 gateway 的 `job_get`**：`ToolJobs` 的内存 completion 和 staging sidecar 如何跨副本；`job_get` 必须能在任意副本读到 running/succeeded/failed，不能只在创建副本上有效。

---

## 7. TODO（落地清单）

已确定方向：会话隔离、确定性派生、`EXECUTOR_MAX_JOBS=1`；以下为实现项：

- [x] executor 的 worker pool 收成单槽：`executor-fc/executor.ts` 强制 `EXECUTOR_MAX_WORKERS=1`；
      池本身仍在 Client Core 内，只是固定为一个槽位（3.7 允许的形态）
- [x] 实例内 FIFO：复用 `executor/dispatch.ts` 的 `createUnitQueue()`，其 key 正是 `(userId, scope, unitId)`
- [x] gateway 请求 `MCP_EXECUTOR_URLS` 时携带亲和 key：`x-executor-key` 默认发送，多地址与 rendezvous 保留
- [x] gateway 的确定性派生与 epoch 维护：`MCP_EXECUTOR_EPOCH_STORE=memory|redis`，默认内存
- [ ] gateway 多实例时 `job_get` 的正常：`ToolJobs` 仍是进程内 Map，需要粘性会话或外置 job 记录

---

## 8. 参考

- [实例隔离概述](https://help.aliyun.com/zh/functioncompute/overview-of-instance-isolation)
- [实例隔离配置实践](https://help.aliyun.com/zh/functioncompute/instance-isolation-configuration-practices)
- [会话亲和通用限制及原理说明](https://help.aliyun.com/zh/functioncompute/cookie-affinity-feature-1)
- [HeaderField 亲和](https://help.aliyun.com/zh/functioncompute/headerfield-affinity)
- [Cookie 亲和](https://help.aliyun.com/zh/functioncompute/cookie-affinity-configuration)
- [超时 FAQ](https://www.alibabacloud.com/help/en/functioncompute/what-can-i-do-if-my-function-exceeds-the-timeout-period-1)
- [最小实例数 vs 预留实例](https://help.aliyun.com/zh/functioncompute/differences-between-minimum-number-of-instances-and-snapshots-or-reserved-instances)
- [MCP Tasks（2025-11-25）](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks)

仓库内相关文档：

- [架构](architecture.zh-CN.md)
- [执行后端协议](backend-protocol.zh-CN.md)
- [阶段计划](stages.zh-CN.md)
- [FC WebSocket 方案](serverless-fc.zh-CN.md)
