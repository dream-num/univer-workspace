# FC WebSocket 方案

> 讨论稿，未采纳，不属于任何阶段计划。这里的 FC 指阿里云函数计算。
> 配套的 HeaderField 方案见 [fc-headerfield.zh-CN.md](fc-headerfield.zh-CN.md)（已确定：会话隔离 + 确定性派生 + `EXECUTOR_MAX_JOBS=1`），其中包括 FC 实例隔离、会话计时器、计费和落地 TODO。
> FC 的产品行为以官方文档为准，本文引用处均已标注链接。

## 1. 结论

1. **gateway → executor 不使用 WebSocket。** FC 的 WebSocket 本质是“长连接的 HTTP 调用”，按连接时长计费、受函数执行超时约束、会占住实例和并发度；它没有替应用解决同 key 串行和在途请求丢失。
2. **gateway → executor 采用 HTTP + HeaderField 亲和 + 实例内 per-key FIFO**，详见 [HeaderField 方案](fc-headerfield.zh-CN.md)。
3. **WebSocket 仍然存在于 executor → Workspace 的协同链路**，但那是出站连接，不是 FC 的 WebSocket 触发器。FC 下需要处理断线重连和 revision 校验。
4. **WS 只适合流式/交互场景**：执行中持续推送进度、日志、中间结果，或服务端主动推送。这套 MCP 的工具调用是一次请求-响应，用不上。

---

## 2. FC 的 WebSocket 是什么

- HTTP 触发器配置后，函数可以当 WebSocket Server；
- 自定义容器监听 `0.0.0.0`，默认端口 9000；
- **连接受函数执行超时约束**，超时强制关闭，客户端收到 **1006**；
- 计费按连接时长，不是按消息：并发=1 时从连接到断开；并发>1 时从第一条连接到最后一条断开，多条连接不重复计费；
- 连接期间占用实例和并发度；
- 空闲连接可能被 NAT 等中间节点断开，需要 ping/pong 保活；
- 连接本身固定在实例上，这是它唯一的“亲和性”；
- 异步调用不支持会话能力；WS 连接本身是长连接，亲和由连接固定，不依赖会话亲和/隔离。

来源：[WebSocket 触发](https://help.aliyun.com/zh/functioncompute/configure-an-http-trigger-for-a-function-that-is-triggered-by-websocket-requests-1)、[超时 FAQ](https://www.alibabacloud.com/help/en/functioncompute/what-can-i-do-if-my-function-exceeds-the-timeout-period-1)。

---

## 3. gateway → executor 的 WS 设计草图

```text
gateway ── WS /rpc（header: x-executor-key）──▶ FC instance
  → { id, op, input }
  ← { id, output } 或 { id, error }
  ← { id, progress } 可选
```

- 每个 key 一条连接，消息按连接顺序处理；
- 需要 requestId、响应匹配、超时、取消、背压；
- 连接断开时，在途请求要么重发（可能重复执行），要么返回 `workspace-result-unknown`；
- 多条连接无法保证跨连接顺序，仍要 per-key FIFO。

---

## 4. 为什么不用它做 gateway → executor

1. **计费模型反了**：连接空闲也计费，等于把按请求变成按会话常驻，和常驻 executor 没区别，却多了 FC 的超时和断线限制。
2. **顺序没有真正解决**：TCP 只保证连接内有序；多路复用后仍需 FIFO；一个 20 秒的 `execute` 会队头阻塞后续请求。
3. **在途请求丢失**：断线时已发出未完成的请求是“可能已执行”，正是 `workspace-result-unknown` 的场景，需要幂等/查状态。
4. **gateway 变成有状态**：连接池、重连、滚动发布迁移，和现有无状态设计冲突。
5. **现有协议要重写**：帧、deadline、能力发现、版本不兼容排除、`notDelivered` 语义都要另做一套。
6. **没有额外正确性收益**：HTTP + HeaderField 亲和 + 实例内 FIFO 已经能达到同样的顺序保证，复杂度低得多。

---

## 5. 什么时候 WS 有价值

- 执行过程中持续推送进度、日志、中间结果；
- 服务端主动推送（例如协同编辑实时变更）；
- 低延迟、高频小消息。

对这套 MCP：

- 进度可以用 MCP 的 Streamable HTTP/SSE 或 `job_get`；
- 工具调用是一次请求-响应，没有高频小消息；
- 实时协同已经由 executor → Workspace 的 WS 负责，不需要 gateway → executor 再来一条。

---

## 6. executor → Workspace 的 WS

这是**出站 WS**，不是 FC 的 WS 触发器，但 FC 下要处理：

| 模式 | 协同 WS 行为 |
| --- | --- |
| 请求隔离 | 每次 invocation 新建连接，用完即弃；握手/ticket 成本加到每次调用 |
| 会话隔离 | Session 内保活；空闲 30 分钟或 TTL 6 小时销毁；冻结/回收时断开，唤醒后重连 |
| FC 异步调用 | 不支持会话亲和，每次重建；长任务期间连接可能因执行超时断开 |

重连后必须：

- 重新拉 snapshot / 重新 ticket；
- 用 `synchronize()` 的 pull + revision 校验补齐断线期间的变化；
- 写操作在提交阶段不确定时返回 `workspace-result-unknown`。

---

## 7. 与 HeaderField 的对比

| 维度 | HeaderField：HTTP | WebSocket |
| --- | --- | --- |
| 顺序 | 实例内 FIFO | 连接内有序，多路复用仍需 FIFO |
| 计费 | 按请求 | 按连接时长 |
| 实例占用 | 请求结束释放/浅休眠 | 连接期间一直占用 |
| 断线 | 无状态，可重试 | 在途请求丢失或需 resume |
| 超时 | 函数执行超时 | 同样受执行超时，1006 |
| 扩展 | 请求级 | 连接级，扩容要重连 |
| gateway 状态 | 无状态 | 有状态（连接池） |
| 复杂度 | 低 | 高（多路复用、心跳、重连、背压） |
| 适用 | 请求-响应 | 流式、交互、长任务进度 |

---

## 8. 推荐落法

```text
MCP client ──Streamable HTTP──▶ gateway（长驻）
                                   │
                                   ├─ HTTP + HeaderField ──▶ FC executor
                                   │     └─ 实例内 createUnitQueue
                                   │
                                   └─ HTTP ──▶ renderer（长驻，Chromium）
```

- **gateway → executor：HeaderField 方案。** HTTP + 亲和 + 实例内 per-key FIFO，见 [fc-headerfield.zh-CN.md](fc-headerfield.zh-CN.md)。
- **executor → Workspace：出站 WS。** 请求隔离下每次重连；会话隔离下保活 + 重连 + revision 校验。
- **长任务：异步调用 + `job_get` 轮询。** 不要用 WS 长连接等结果，细节见 HeaderField 文档 3.6 节。
- **只有确实需要执行中持续推送时**再考虑 WS/SSE，优先用 MCP 已有的 Streamable HTTP，不要自造内部 WS 协议。

---

## 9. 待确认问题（WS 相关）

平台通用的实例隔离、会话计时器、HeaderField、计费与 TODO 见 [HeaderField 方案](fc-headerfield.zh-CN.md)；以下是 WS 特有的：

1. **冻结/唤醒行为**：FC 实例冻结或回收后，已建立的 WebSocket 是否立即断开，还是等执行超时强制关闭。
2. **连接数与配额**：单实例能同时承载多少条 WS 连接；是否与 200 并发度共享配额。
3. **计费对比**：WS 长连接按连接时长计费，与“会话隔离 + 浅休眠内存计费”的实际成本差多少。
4. **协同 WS 稳定性**：executor 出站到 Workspace 的 WS 在 FC 的 VPC/NAT 下是否会被中间节点断开，需要多频繁的 ping/pong。
5. **平台重试**：WebSocket 触发失败时 FC 是否重试；写操作如何避免重复。
6. **MCP 传输**：客户端到 gateway 的 MCP 使用 Streamable HTTP；若未来要支持 WS 传输，需要先确认 MCP 协议版本和客户端支持。

---

## 10. 参考

- [WebSocket 触发](https://help.aliyun.com/zh/functioncompute/configure-an-http-trigger-for-a-function-that-is-triggered-by-websocket-requests-1)
- [超时 FAQ](https://www.alibabacloud.com/help/en/functioncompute/what-can-i-do-if-my-function-exceeds-the-timeout-period-1)
- [实例隔离概述](https://help.aliyun.com/zh/functioncompute/overview-of-instance-isolation)
- [会话亲和通用限制及原理说明](https://help.aliyun.com/zh/functioncompute/cookie-affinity-feature-1)

仓库内相关文档：

- [架构](architecture.zh-CN.md)
- [执行后端协议](backend-protocol.zh-CN.md)
- [阶段计划](stages.zh-CN.md)
- [FC HeaderField 方案](fc-headerfield.zh-CN.md)
