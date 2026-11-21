# executor-fc

FC（阿里云函数计算）HeaderField 会话亲和。设计依据
[`docs/design/workspace-mcp/fc-headerfield.zh-CN.md`](../../../docs/design/workspace-mcp/fc-headerfield.zh-CN.md)：
会话隔离 + 多 gateway 确定性派生 Session ID + `EXECUTOR_MAX_JOBS=1`。

常驻 executor（`src/executor`）的代码没有改动。本目录提供三部分：

1. **gateway 侧亲和**：把 `(userId, scope, unitId)` 确定性派生为 `x-executor-key` 的值，并在平台
   判定 Session 失效（401）时推进 `epoch` 后重试一次。
2. **epoch 存储**：进程内 `MemoryEpochStore`（默认）与共享 `RedisEpochStore`，由配置选择。
3. **executor 侧装配**：把常驻 executor 装配成 FC 容器的形态（单 worker、单转换、`0.0.0.0:9000`）。

## 文件

| 文件                   | 角色     | 说明                                                                    |
| ---------------------- | -------- | ----------------------------------------------------------------------- |
| `affinity.ts`          | gateway  | `affinityKey()`、`deriveSessionId()`、Header 名/值的 FC 合法性校验      |
| `epoch-store.ts`       | gateway  | `EpochStore` 接口、`EpochStoreSettings` 与 `MemoryEpochStore`           |
| `redis-epoch-store.ts` | gateway  | `RedisEpochStore`、`createRedisEpochStore()`、`RedisEpochStoreError`    |
| `session.ts`           | gateway  | 按 key 的 Session 派生与 `renew()`；并发续期合并为一次自增              |
| `transport.ts`         | gateway  | 带亲和头的请求封装：401 续期重试一次、429 有界退避，其余原样返回        |
| `executor.ts`          | executor | `parseFcExecutorConfig()` / `createExecutorFc()`，强制单 worker、单 job |
| `main.ts`              | executor | FC 自定义容器入口（`node dist/executor-fc/main.js`）                    |
| `index.ts`             | gateway  | 只导出 gateway 侧模块，避免把 headless 依赖带进 gateway 进程            |

`executor.ts` 与 `main.ts` 会加载 `src/executor/server.js`（进而加载 Client Core 的 headless runtime），
所以它们**不在** `index.ts` 的导出里。`test/import-boundaries.test.ts` 约束这条分界。

## 在 gateway 中的位置

已经接线，不需要额外改动：

- [`gateway/executor/client.ts`](../gateway/executor/client.ts)：每次调用用
  `affinityKey({ userId, scope, unitId })` 派生 Session，通过 `connection.transport.request(...)` 发送，
  自动带上 `x-executor-key`。多地址 `MCP_EXECUTOR_URLS`、rendezvous 路由和“只在已知未投递时 failover”
  全部保留（[`router.ts`](../gateway/executor/router.ts) 未改）；`transport` 按每次请求的 URL 发送。
- [`gateway/tools/executor-tool.ts`](../gateway/tools/executor-tool.ts)：创建 `createAffinityTransport`，
  放进 `ExecutorConnection`；未显式传 store 时默认进程内实现。
- [`gateway/executor/epochs.ts`](../gateway/executor/epochs.ts)：按配置创建 memory 或 Redis store，
  由 `gateway/server.ts` 在关闭时 `close()`。
- [`shared/config.ts`](../shared/config.ts)：解析 `MCP_EXECUTOR_EPOCH_STORE`、`MCP_EXECUTOR_REDIS_URL`、
  `MCP_EXECUTOR_REDIS_KEY_PREFIX`。

不是 FC 的部署：header 照常发送，常驻 executor 忽略未知请求头，行为与之前一致。

## Session 生命周期

```text
epoch = epochs.get(key) ?? 0
sid   = "k" + sha256(`${key}:${epoch}`).hex.slice(0, 32)

请求带 x-executor-key: sid
  ├─ 200 → 继续使用（同一 key 的所有 gateway 副本算出同一个 sid）
  └─ 401 且判定为平台 Session 失效
           → epochs.increment(key)（同进程并发合并为一次）
           → 用新 sid 重试一次
```

- Header 值 33 个字符、首字符 `k`、只含 `[0-9a-f]`，满足 FC 的 1–64 字符与字符集限制；Header 名
  `x-executor-key` 满足 5–40 字符、字母开头、不以 `x-fc-` 开头。
- `unitId` 为 `null` 时键里用空串占位，保持稳定。不要沿用“每次请求生成一个值”的兜底：那样会每次
  建一个新 Session，亲和、串行和实例内缓存全部失效。
- 只有**平台级 401** 才重试。判定默认是“401 响应体不是 executor 自己的 `workspace-*` 错误信封”：
  executor 的操作失败一律是 HTTP 200 + 帧内错误，它唯一的 401 是 bearer 不匹配（部署故障，不该重试）。
  平台错误体实测确认后可用 `retryOnSessionError` 收紧。
- `400`（Header 值非法）不重试；`429`（单实例并发耗尽或地域配额）做指数退避，默认 2 次，受
  `deadlineAt` 约束；网络错误不重试，交给调用方保持“写操作是否已提交”的既有语义。

## epoch 存储

默认 `MCP_EXECUTOR_EPOCH_STORE=memory`：

- 进程内 Map，`increment` 没有 await 间隙，因此按 key 原子；
- epoch 不过期（设计 3.4），映射按 LRU 限制在 10 万键；
- 单副本或本地开发足够；多副本会各自算出不同的 epoch，产生多个 Session。

`MCP_EXECUTOR_EPOCH_STORE=redis` 时使用 `MCP_EXECUTOR_REDIS_URL`（`redis://` 或 `rediss://`）：

- 键是 `MCP_EXECUTOR_REDIS_KEY_PREFIX`（默认 `mcp:executor-epoch:`）+ `sha256(routing key)` 的十六进制，
  用户 ID、Unit ID 和 NUL 分隔符都不进入 Redis，键长固定。epoch 不设 TTL。
- 惰性连接：第一次读、自增或 `ready` 时才建立连接并 `PING` 校验；失败不会被缓存，下一次调用会重试，
  所以短暂故障可以自愈。
- gateway 启动不阻塞在 Redis 上：首次连接失败只打一条 warning，只有 executor-backed 工具会失败。
- 读 epoch 发生在发送请求之前，因此 Redis 故障时 gateway 返回 `workspace-executor-unavailable`，
  `detail.cause` 为 `"epoch-store"` 且 `retryable: true`；**写操作不会被误报成“可能已提交”**。
- 多副本并发 401 可能各自推进到不同 epoch，`INCR` 的原子性保证单调向前，不会长期双 Session。

## executor 侧

- `MCP_FC_HOST` / `MCP_FC_PORT`（默认 `0.0.0.0` / `9000`）；`HOST` / `PORT` 不读取。
- `EXECUTOR_MAX_WORKERS=1`、`EXECUTOR_MAX_JOBS=1` 由 `fcExecutorConfig()` 强制，环境变量写大了
  也只会被压回 1，并在 `main.ts` 打一行提示。worker 池本身仍由 Client Core 管理，只是固定为一个槽位。
- 认证、grant 校验、whoami 缓存、`/healthz`（免鉴权，供 FC 探活）、`/metrics` 全部沿用常驻 executor。
  FC 的会话隔离只保证“落到哪个实例”，不保证同一 Session 的请求串行；实例内顺序仍由
  `src/executor/dispatch.ts` 的 `createUnitQueue()` 提供，它的 key 正是 `(userId, scope, unitId)`，
  与亲和键一致。`queueFor` 为假的编译类操作不串行，与现状相同。
- 顶层异步请求（FC 异步调用）不支持会话亲和；长任务仍由 gateway 的 `job_id` + `job_get` 承担。

## 未实现（设计里明确留待验证或后续工作）

- FC 异步调用的结果回传路径（staging / OSS），见设计 3.6 与 6.3。4 分钟的同步调用在 FC 上可行，
  只有改成“202 + 回调”时才需要。
- “新派生 ID 仍被拒绝时回退为不带 Header 创建 + 写入共享映射”的兜底，见设计 3.3 与 6.1；需要平台实测
  结论，不回退就是现在的行为：持续 401。
- 多 gateway 副本的 `job_get`（设计 6.11）：`ToolJobs` 仍是进程内 Map，需要粘性会话或外置 job 记录。
- 常驻 renderer 保持不变（设计 3.1）。

## 验证

```bash
pnpm --filter @univerjs/univer-workspace-mcp typecheck
pnpm --filter @univerjs/univer-workspace-mcp test
pnpm --filter @univerjs/univer-workspace-mcp build
```

相关测试：

- `test/executor-fc-affinity.test.ts`：派生、epoch、续期合并、401/429/400 语义、配置钳制；
- `test/executor-fc-epoch.test.ts`：epoch 配置、memory/Redis 实现、gateway 发送亲和头与 401 续期、
  Redis 故障时不误报“可能已提交”。

对一个已经跑起来的 FC executor 做冒烟测试（不需要 gateway）：

```bash
# 仓库根目录；只验传输、鉴权、能力发现与 Workspace 可达性
MCP_EXECUTOR_TOKEN=<token> node apps/mcp/scripts/smoke-executor-fc.mjs \
  --url http://127.0.0.1:9000
```

脚本（[scripts/smoke-executor-fc.mjs](../../scripts/smoke-executor-fc.mjs)）先验 `/healthz`、鉴权、
`/metrics`、能力目录、404/415/426/400/413、过期 grant 的帧内错误、`x-executor-key` 兼容性，再用一个
伪造 session 确认 executor 真的能访问 Workspace（得到鉴权拒绝而不是网络错误）。加
`--renderer-url` / `--renderer-token` 会直接问 renderer 要能力，用来区分“没配 renderer”和
“renderer 不可达或版本不匹配”。

验 Unit 与渲染需要一个真实 Workspace session 和一个 Worktree 里的 Unit：

```bash
MCP_EXECUTOR_TOKEN=<token> node apps/mcp/scripts/smoke-executor-fc.mjs \
  --url http://127.0.0.1:9000 \
  --workspace https://workspace.univer.plus \
  --session "<workspace_session cookie>" \
  --worktree-id <worktree> --unit-id <unit> \
  [--unit-type sheet|doc|slide|board|base]
```

脚本按 Unit 类型决定跑哪些操作：`content.inspect`（所有类型）、`content.sheet-lens`（Sheet）、
`render.screenshot` 与 `render.printPdf`（Base 不打印 PDF）、`render.lint`（仅 Slide）。断言看真实输出：
inspect 的 `kind`/`unitId`、Sheet Lens 的文本与 revision、截图的 PNG 签名与 `images[].offset + size`、
PDF 的 `%PDF-` 头与 `pageCount`、lint 的覆盖页与 findings。`--skip-render` 跳过三个渲染操作；
`--unit-type` 省略时从 inspect 的 `kind` 推断。

跑脚本的机器解析不到 Workspace 时（例如容器里用 `--add-host` 指了固定 IP），可以省掉 `--workspace`
改传 `--user-id`：executor 自己解析 Workspace，本地只负责签发 grant。`--session` / `--user-id` 也可以
从 `WORKSPACE_SESSION` / `WORKSPACE_USER_ID` 传入，避免出现在命令行参数里。

退出码：`0` 必测项全过，`1` 有必测项失败，`2` 连不上入口或参数非法。
