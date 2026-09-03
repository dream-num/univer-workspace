# Univer Workspace 架构

Univer Workspace 是仓库 `apps/workspace` 中的一个 private package。React Web 应用、产品 API、
Univer Collaboration Endpoint 和后台任务由同一个 Node 进程部署，共享静态资源目录和
SQLite 数据目录。

## 技术栈

| 关注点 | 选择 |
| --- | --- |
| 前端 | React、TypeScript、Vite |
| UI | Base UI、Tailwind CSS、应用 UI Primitive |
| 路由 | TanStack Router 文件路由 |
| 服务端状态 | TanStack Query |
| Web 本地状态 | React 本地状态 |
| HTTP | Express 5 |
| 产品实时失效 | 认证 WebSocket、TanStack Query invalidation |
| 产品数据库 | Node `node:sqlite`、显式 SQL schema |
| API 客户端 | `openapi-typescript`、`openapi-fetch` |
| API 文档 | OpenAPI 3.1、Redocly CLI、Scalar |
| 单元与集成测试 | Vitest |

OpenAPI 是独立的 HTTP 契约，用于文档、Web API 类型生成和契约检查，不参与 Express
运行时路由。每个服务端业务模块显式注册自己的 Router。

## 目录

```text
apps/workspace/
├── web/
│   ├── index.html
│   └── src/
│       ├── app/
│       │   ├── entry.tsx
│       │   ├── providers.tsx
│       │   └── styles/
│       ├── routes/
│       │   └── TanStack Router 文件路由
│       ├── features/
│       │   ├── auth/
│       │   ├── nodes/
│       │   ├── editor/
│       │   ├── resources/
│       │   ├── permissions/
│       │   ├── spaces/
│       │   ├── trash/
│       │   ├── views/
│       │   └── worktrees/
│       └── shared/
│           └── api/
├── server/
│   └── src/
│       ├── main.ts
│       ├── app.ts
│       ├── config.ts
│       ├── db/
│       │   ├── database.ts
│       │   ├── initialize.ts
│       │   ├── legacy-v0/
│       │   ├── migrations/
│       │   └── schema.sql
│       ├── middleware/
│       │   └── errors.ts
│       ├── modules/
│       │   ├── access/
│       │   ├── identity/
│       │   ├── spaces/
│       │   ├── nodes/
│       │   ├── resources/
│       │   ├── blobs/
│       │   ├── exchange/
│       │   ├── univer-assets/
│       │   ├── operations/
│       │   ├── trash/
│       │   ├── permissions/
│       │   ├── worktrees/
│       │   └── views/
│       ├── integrations/
│       │   ├── blob/
│       │   └── univer/
│       └── jobs/
│           └── operation-recovery.ts
├── contracts/
│   └── http/
│       ├── openapi.yaml
│       ├── paths/
│       └── schemas/
├── generated/
│   └── http/
│       ├── openapi.bundled.yaml
│       └── schema.d.ts
├── test/
│   └── integration/
├── docs/
│   ├── adr/
│   ├── architecture.md
│   ├── application-design.md
│   └── data-model.md
├── Dockerfile
├── package.json
├── redocly.yaml
├── tsconfig.web.json
├── tsconfig.server.json
└── vite.config.ts
```

`web` 和 `server` 是同一 package 的两个编译入口：

- Vite 把 Web 应用构建到 `dist/public`。
- TypeScript 把服务端构建到 `dist/server`。
- Node 进程挂载产品 API、Collaboration Endpoint、API 文档和 Web 静态资源。
- Docker 镜像只包含 production dependencies、`dist` 和数据库 schema。

## Web 应用

`routes` 对应 URL 和页面组合，`features` 按用户能力组织，`shared` 保存无业务归属的
基础代码。依赖方向为：

```text
shared → features → routes → app
```

低层目录不能导入高层目录。Feature 通过 `index.ts` 暴露公开内容，其他 Feature 不导入
其内部文件。

应用 UI Primitive 提供工作台表单、菜单、弹窗和反馈组件。`shared/ui` 保存统一行为与
视觉封装。Univer 编辑器相关的创建、销毁、协同 Scope 和只读状态全部封装在
`features/editor`。

TanStack Query 管理 Session、Node、Resource、Recent、Trash、Permission、Worktree 和 Operation
等服务端状态。Dialog、表单输入和当前选中项使用 React 本地状态，不引入额外全局状态库。

Worktree 页面使用一条用户级 `/api/worktree-events` WebSocket 接收粗粒度缓存失效信号。
连接通过现有的一次性 Collaboration Session Ticket 认证；首次连接和收到变更信号时使
`worktrees` 及可能被 Worktree 合入改变的 Node、Recent、Owned、Shared Query 失效并重新读取
权威产品 API，不把 WebSocket payload 当作产品数据。

Worktree Compare 按当前选中的单个 Unit 请求一次性数据包。Server 在同一请求中物化当前
Trunk 与 Worktree 状态并调用五类 SDK comparison adapter；Browser 使用返回的最终 UnitData
创建两个无 Collaboration 连接的本地只读 Univer，并展示标准化变更列表。该流程不创建
Comparison Session，也不承诺不同 Unit 请求属于同一历史切面。

## 服务端

`main.ts` 读取配置、创建应用并监听端口；`app.ts` 创建 Express 实例并挂载中间件、业务
Router、Collaboration Endpoint、API 文档和静态资源。

业务代码按 Module 组织。例如：

```text
modules/nodes/
├── nodes.router.ts
├── nodes.service.ts
├── nodes.repository.ts
├── nodes.types.ts
└── index.ts
```

这些文件按需要创建，不要求每个 Module 拥有相同文件：

- Router 只负责 HTTP 输入输出和调用 Module。
- Service 只在存在业务流程、权限组合或 transaction 时创建。
- Repository 封装本 Module 的 SQL 和 row mapping。
- Policy 保存可独立表达和测试的授权规则。
- `index.ts` 是 Module 的公开入口。

不建立全局 `controllers`、`services`、`repositories` 和 `models` 目录。数据库 row、
Express Request/Response 和 Univer SDK class 不进入业务 Module 的公开 Interface。

Univer 集中在 `integrations/univer`，向业务 Module 提供产品语义的 Interface，不对 SDK
方法做一一对应的空壳封装。外部 OAuth Provider 位于 Identity Module，并通过
`GitHubOAuthProvider` / `DiscordOAuthProvider` Interface 在测试中替换。Identity Router
为部署注册的 OAuth client 提供通用 authorize/token 交接：authorize 复用
`workspace_session`，未登录时回到现有登录流程；token 只兑换一次性、短期、绑定 PKCE
和已注册 redirect URI 的 code。Workspace Session 仍是唯一的身份权威来源，现有登录、
Cookie、OAuth callback 和产品 API 保持原有行为；外部 client 只通过通用 OAuth 协议
接入，代码不感知其业务身份。

跨产品数据库和 Collaboration Service 的写入由 `operations` Module 持久化和恢复，不用
一次 SQLite transaction 假装覆盖两个系统。

Collaboration Gateway 同时组合 Core、Comment、History 与 Worktree Endpoint。Comment Service 使用
同一 `COLLABORATION_DATABASE_FILE` 中由 Comment Adapter 独立拥有的表，并通过 Identity
Module 批量解析评论作者资料。五类 Unit 的评论读取都要求打开权限；新增、回复、编辑和 solved
状态要求内容编辑权限；删除还要求评论作者或 Resource Owner/Admin。Browser 只在 Trunk Scope
按 Unit 类型注册标准 Thread Comment UI 和统一远程 datasource。

History Service 使用同一文件中由 History Adapter 独立拥有的派生索引，并通过 Identity Module
批量解析版本作者。现有 Collaboration Runtime 统一装配 History Adapter、Service、live attachment
和 lifecycle；其内部 compatibility backfill 只在服务启动时按产品 `univer_resources` 映射为启用
History 前的已有 Unit 补建索引。正常读取不触发扫描或修复，正常提交由 Service attachment 增量
索引。History Endpoint 复用 Unit 打开权限；恢复版本仍通过普通 Collaboration changeset 写入并
要求内容编辑权限。Browser 按 Unit 类型只为 Trunk Sheet、Doc、Slide、Base 和 Board 注册标准
SDK History UI，Worktree 与 Merge Preview 不注册。

Worktree Compare 复用 History package 公开的 injector-free comparison engine，但不是 History
Endpoint。输入由 Collaboration Service 和 Worktree Service 在请求内物化，响应通过产品
OpenAPI 返回；snapshot、changeset 和 revision 不进入产品数据库。

Worktree Service 在 Collaboration 与产品写入均完成后调用专用 Change Feed。Change Feed
不是通用应用 Event Bus；它只向该 Worktree 变更前后可发现的已连接用户发送不含 Worktree
身份或内容的失效信号。实时发送失败不改变已经完成的产品写入，客户端重连后通过首帧统一
失效查询，从产品 API 恢复当前状态。

## 产品数据库

产品数据库使用 Node `node:sqlite`。`db/schema.sql` 定义完整 V6 结构，`initialize.ts`
负责在业务 Module 初始化前识别数据库状态：空数据库应用 V6；V6 校验指纹；V5/V4/V3/V2/V1/V0
先生成一致性备份，再调用隔离的一次性迁移器。

- 应用数据目录为 `.data/`。
- 容器内数据目录为 `/app/univer-workspace/.data`。
- 默认数据库文件为 `.data/univer-workspace.sqlite`。
- 部署和普通重启均保留数据库；V6 不重复备份或迁移。
- 普通进程重启不清理数据库。
- 每个测试使用独立的临时数据库文件或内存数据库。

产品数据库保存产品元数据、`unit_id`、Tree Blob 与 Univer Asset 元数据，不保存对象字节、
snapshot、changeset 或 revision。Tree Blob 和内嵌 Asset 共用注入的 `BlobStore`；当前实现是
本地目录，未来可替换为 `S3BlobStore` 或迁移包装器。Univer Collaboration Database Adapter
独立管理 snapshot、changeset 与 revision；Comment Database Adapter 在同一文件中独立管理
评论正文、回复和 solved 状态；History Database Adapter 在同一文件中保存可从 Trunk Unit 与
changeset 重建的版本索引。Workspace 在 Trunk 和 Worktree 的 `submitChangeset` middleware 中
以服务端当前 Unix 秒覆盖 `changeset.createTime`；该字段表示服务端开始处理本次提交的时间，
不是数据库事务的精确提交时间。两者不把协作内容写入产品数据库。

Office Exchange Module 使用已发布的 `@univerjs-pro/exchange-node` 将 Office 字节与 Univer
数据互转。`/universer-api/exchange/**`、Exchange File Upload 和签名下载遵循 Universer
协议形状，不进入产品 OpenAPI。导入为 Unit 时通过 Resource Module 创建 Personal Space
根目录下的正式 Node/Resource/Unit；导出时通过 Collaboration Service 固定当前 Trunk head，
读取包含 Sheet blocks 的恢复材料，再由 `UnitSnapshotMaterializer` 补全 snapshot 后交给 Exchange
Node。转换源文件、JSON snapshot
和导出文件是 `BlobStore` 中的临时对象，任务元数据只存在当前进程并在两小时后过期；它们
不写入产品数据库，也不改变 Collaboration Database Adapter 的所有权边界。

## OpenAPI

```text
contracts/http/openapi.yaml + paths + schemas
  ├── Redocly lint
  ├── bundle → generated/http/openapi.bundled.yaml
  ├── openapi-typescript → generated/http/schema.d.ts
  ├── openapi-fetch → React typed client
  └── Scalar → interactive API documentation
```

源契约与生成物分目录，生成物不手工修改。Express 路由和输入校验显式编写，不由 OpenAPI
文件动态驱动。

## 测试

- 跨 Module、数据库 schema、权限和 Collaboration Endpoint 测试放在
  `test/integration`。
- CI 依次执行 OpenAPI 生成检查、typecheck、集成测试、生产构建和生产入口导入检查。

## 约束

- 不把单一 Workspace 应用继续拆成更多内部 packages。
- 不做 SSR。
- 不引入 Redux、Zustand 或 MobX。
- 不使用完整 FSD 七层。
- 不建立 BaseRepository、BaseService、依赖注入容器或 Event Bus。
- 不生成服务端业务代码。
- 目录随真实代码创建，不预先建立空层。
