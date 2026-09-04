# Univer Observer 架构

## 定位

Univer Observer 是仓库内的第三个对外应用。它与 Univer Workspace 保持同一源码版本，但拥有独立的
进程、端口、域名、GitHub OAuth App、Session Cookie、SQLite 和 Docker 镜像。

Observer 第一版提供部署总览、Operation 与存储摘要，以及按时间、Workspace User、Unit、Trunk 或
Worktree 筛选的 Changeset 活动。频率可以切换为 Changeset Count、Mutation Count 或 Mutation Size。
普通 HTTP 请求统计不在第一版范围内。

## 进程与数据流

```text
Browser
  │ Observer Session
  ▼
Observer Server :3030
  ├─ 读写 Observer SQLite：Member、Session、访问历史
  ├─ 只读 Product SQLite：标签、Operation、存储摘要
  └─ Worker 只读 Collaboration SQLite：Changeset 活动

Workspace Server :3020
  ├─ 独占 Product SQLite 写入与迁移
  └─ 通过 Collaboration SDK 独占协同写入与迁移
```

Observer 不调用 Workspace HTTP API，也不复用 Workspace Server 的内存对象。两者可以部署在同一台
主机，但必须作为不同进程或容器启动。生产环境可把 Workspace 数据卷只读挂载给 Observer，并把
Observer 自身 `.data` 挂载为另一个可写卷。

## 只读数据库边界

Product Reader 使用 Node SQLite `readOnly` 打开产品数据库，并设置 `PRAGMA query_only = ON`。启动时
验证当前产品 Schema 版本和 Observer 查询依赖的表；不匹配时拒绝启动，不执行 Workspace 迁移。

Changeset Reader 在 Worker Thread 中以同样的只读模式打开 Collaboration SQLite。它只读取 Unit ID
和持久化 Changeset JSON 中的 `createTime`、`userID`、Mutation 数组长度及 `mutationSize`，不把
Payload 或 Mutation 内容返回 HTTP 层。Adapter Schema 不兼容时查询明确失败。

直接读取 SQLite 是有意的版本耦合：Observer 与 Workspace 从同一仓库版本交付，换取不复制分析数据
且查询权威最新历史。Workspace 与 Collaboration Adapter 仍独占各自数据库的 Schema 和写入所有权。

## 查询保护

- Changeset 时间范围默认一小时，最大 30 天；
- 查询在 Worker Thread 中执行，不阻塞 HTTP Event Loop；
- `OBSERVER_QUERY_TIMEOUT_MS` 限制单次查询时间；
- `OBSERVER_MAX_CONCURRENT_QUERIES` 限制单进程同时运行的 Changeset 查询；
- 超出并发返回 503，超时返回 504；
- 第一版不增加 Collaboration 索引、不缓存或复制汇总。

响应与页面都显示 Collaboration 查询、产品补全和服务端总耗时，并返回 `Server-Timing`。这些耗时
不包含 Browser 到 Server 的网络时间。

## Changeset 语义

Observer 只统计已经持久化到以下历史表的 Changeset：

- Trunk：`collaboration_changesets`；
- Worktree：`collaboration_worktree_changesets`。

缺少权威 `createTime` 的旧记录不进入时间桶，并单独报告数量。缺少 `mutationSize` 的记录仍参与
Changeset Count 和 Mutation Count，但不进入 Mutation Size 总量；页面显示覆盖数量和覆盖率，不把
缺失值当作零，也不回填历史。

Mutation Size 由 Workspace Collaboration commit middleware 负责写入，语义是最终 Mutations 数组
紧凑 JSON 的 UTF-8 字节数：

```ts
Buffer.byteLength(JSON.stringify(changeset.mutations), "utf8")
```

该写入属于 Workspace，不属于 Observer。

## 产品补全与 Operation

Product Reader 只用全局只读查询补全 Workspace User 和 Unit 展示名称；无法解析的历史 ID 仍显示。
Observer Member 不因此获得 Workspace 内容访问权，接口也不返回 Unit Payload。

Operation 摘要直接读取产品 `operations` 表：

- 执行中：Pending 且 Lease 未过期；
- 等待中：Pending 且下一次尝试位于未来；
- 到期积压：Pending、已经到期且没有有效 Lease；
- 失败：终态 Failed；
- 错误分布：按 Operation Kind 和错误码分组。

## 身份与授权

Observer 只接受自己的 `univer_observer_session` Cookie。Workspace Session、User、Space Role、Node
Grant 或 Workspace OAuth 绑定都不能授权 Observer。

仓库不预置 GitHub 身份。Member 表为空时，部署者必须提交 `OBSERVER_SETUP_TOKEN` 并完成 GitHub
OAuth；首位 Member、Session 和访问历史在一个事务中创建。初始化完成后，环境中残留的 Token 永久
失去权限。后续所有 Member 权限相同，可添加和移除 Member，但不能移除最后一位。

授权键是稳定 GitHub Numeric User ID。Login、Display Name 和 Avatar 只用于展示，GitHub Access
Token 不持久化。

## HTTP 与 Browser

Observer Browser 使用根路径：

```text
/
/changesets
/members
/login
/setup
```

Observer 自己拥有 `/api/**` OpenAPI contract 和 `/api-docs`，不向 Workspace 产品 OpenAPI 添加路由。
数据接口全部验证 Observer Session；隐藏导航不构成授权。

## 非目标

- 不替代 Prometheus、日志、Trace 或主机监控；
- 不统计第一版普通 HTTP 请求；
- 不修改 Workspace User、内容、Operation、Blob 或部署配置；
- 不展示 Changeset Payload、Mutation Data、Snapshot 或文档正文；
- 不拥有 Workspace 或 Collaboration Schema 迁移。
