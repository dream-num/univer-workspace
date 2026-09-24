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

启动入口通过仅依赖 Node 内置模块的 `startup-logging.ts` 同步写出阶段 JSON 日志，并以动态 import 标记应用/SDK 模块加载。日志覆盖迁移与监听前初始化，字段与排障查询见应用 README 的 Startup diagnostics。

## Web 应用

`features/html-views` 打开 `.univer.html` Blob，通过私有 `workspace-html-viewer`
与 Agent 共享 SDK `renderHtmlView` 的 React 适配、检查元数据和基础 Univer 工厂。应用各自拥有来源授权
以及路由或 Sidecar 退出保存适配，底层组合三个独立 SDK package：
`binding-engine` 以一个 Engine 管理一个主 Sheet Unit 的加载、坐标读写和同步确认，`html-view` 解析模板，
`html-view-renderer` 管理 iframe、DOM、交互及内置检查面板。宿主负责来源访问检查、身份与引用策略，公共工厂负责 Engine 加载和释放；Renderer 只消费已加载 Engine。
共享 `workspace-html-viewer/engine` 工厂统一基础 Univer 装配、只读写入保护和加载取消生命周期；
宿主注入来源授权结果、身份/license、协同配置与引用 Provider。
设计与当前状态见 [Univer HTML Views](../../../docs/design/html-views/README.md)。

`routes` 对应 URL 和页面组合，`features` 按用户能力组织，`shared` 保存无业务归属的
基础代码。依赖方向为：

```text
shared → features → routes → app
```

低层目录不能导入高层目录。Feature 通过 `index.ts` 暴露公开内容，其他 Feature 不导入
其内部文件。

应用 UI Primitive 提供工作台表单、菜单、弹窗和反馈组件。`shared/ui` 保存统一行为与
视觉封装。Univer 编辑器相关的创建、销毁、协同 Scope 和只读状态全部封装在
`features/editor`：目录根保存跨类型的编辑器框架（Resource 分发、协同 Editor、比较渲染与
快照 adapter），`features/editor/units/<type>/` 保存五类 Unit（sheet、doc、slide、board、base）
各自的编辑器入口与 preset，`features/editor/features/` 保存跨类型共享能力（exchange、
thread comment、license、assets），`features/editor/workarounds/` 集中保存上游 SDK workaround。

Worktree 审阅保留 Agent 草稿作为默认视图，并通过 `packages/unit-comparison-viewer` 提供可选的结构化
双栏比较。该 package 只消费已解码的 UnitData 和语义 comparison result，不请求数据或装配 Univer Runtime；Web 通过
`features/editor/comparison-univer.ts` 注入与应用编辑器一致的渲染 preset、locale、theme 和只读
命令边界。Server 在已认证的 `/universer-api/worktrees/:worktreeId/units/:unitId/comparison` 内部端点
物化 Trunk 与 Worktree 状态、解码五类 Unit，并通过对应 History SDK adapter 生成比较结果。该端点
属于 Univer 应用内部集成边界，不进入产品 OpenAPI。

Worktree 审阅 Header 以当前选中文档名为标题。`worktree-review-header.tsx` 接收显示数据、控件与回调，
负责居中与自然换行；查询、权限和操作状态留在 `worktree-review-panel.tsx`。合并状态提示与预览来源
切换属于当前文档内容区，在结构化对比中隐藏预览来源切换。

TanStack Query 管理 Session、Node、Resource、Recent、Trash、Permission、Worktree 和 Operation
等服务端状态。Dialog、表单输入和当前选中项使用 React 本地状态，不引入额外全局状态库。

Worktree 页面使用一条用户级 `/api/worktree-events` WebSocket 接收粗粒度缓存失效信号。
连接通过现有的一次性 Collaboration Session Ticket 认证；首次连接和收到变更信号时使
`worktrees` 及可能被 Worktree 合入改变的 Node、Recent、Owned、Shared Query 失效并重新读取
权威产品 API，不把 WebSocket payload 当作产品数据。

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
Module 批量解析评论作者资料。五类 Unit 的评论读取、新增、回复、solved 和编辑都要求打开
权限，不要求内容编辑权限；`UnitAction.Comment` 与 `View` 放在同一组。编辑正文由 Comment Service
限定为作者本人，删除还要求评论作者或 Resource Owner/Admin。未登录请求只放行评论列表。Browser 只在 Trunk Scope
按 Unit 类型注册标准 Thread Comment UI 和统一远程 datasource。

History Service 使用同一文件中由 History Adapter 独立拥有的派生索引，并通过 Identity Module
批量解析版本作者。现有 Collaboration Runtime 统一装配 History Adapter、Service 和 lifecycle；SDK 1.0.0 的
History Service 自行订阅 Core 创建与提交事件，并在读取时从 Core 创建事实与 changeset 追赶分段索引。
启动入口先通过独立的 `integrations/univer/migrations` 边界备份并迁移协同数据库，再装配 Runtime。
History Endpoint 复用 Unit 打开权限；恢复版本仍通过普通 Collaboration changeset 写入并
要求内容编辑权限。Browser 按 Unit 类型只为 Trunk Sheet、Doc、Slide、Base 和 Board 注册标准
SDK History UI，Worktree 与 Merge Preview 不注册。

Worktree Service 在 Collaboration 与产品写入均完成后调用专用 Change Feed。Change Feed
不是通用应用 Event Bus；它只向该 Worktree 变更前后可发现的已连接用户发送不含 Worktree
身份或内容的失效信号。实时发送失败不改变已经完成的产品写入，客户端重连后通过首帧统一
失效查询，从产品 API 恢复当前状态。

## 服务观测

`app.ts` 注册 `middleware/logging.ts` 和 `middleware/metrics.ts` 中的请求中间件。
Pino 输出 JSON 日志，HTTP 元数据按白名单记录 request ID、method、URL 路径部分、
statusCode 和耗时。prom-client 按 method、路由模板和 status_code 采集 HTTP 请求数与耗时。
Express 直接使用 `req.route?.path`，标签对应 Router 内注册的模板，例如 `/nodes/:id`。

`integrations/univer/collaboration-gateway.ts` 注册 Transport 观测中间件，在响应完成时
通过 SDK 的 `ctx.route?.path` 读取完整路由模板；路由匹配前结束的请求和未知路径统一归为
`unmatched`。Express 和 SDK 中间件各自在入口开始计时，在响应完成时写入同一个 Histogram。
请求进入 SDK 时标记统计归属，由 SDK 中间件完成采集；Express 中间件负责其余 HTTP 请求。
配置、认证与部署方式见 [观测说明](../../../observability/README.md)。

## 产品数据库

产品数据库使用 Node `node:sqlite`。`db/schema.sql` 定义完整 V7 结构，`initialize.ts`
负责在业务 Module 初始化前识别数据库状态：空数据库应用 V7；V7 校验指纹；V6/V5/V4/V3/V2/V1/V0
先生成一致性备份，再调用隔离的一次性迁移器。

- 应用数据目录为 `.data/`。
- 容器内数据目录为 `/app/univer-workspace/.data`。
- 默认数据库文件为 `.data/univer-workspace.sqlite`。
- 部署和普通重启均保留数据库；V7 不重复备份或迁移。
- 普通进程重启不清理数据库。
- 每个测试使用独立的临时数据库文件或内存数据库。

产品数据库保存产品元数据、`unit_id`、Tree Blob 与 Univer Asset 元数据，不保存对象字节、
snapshot、changeset 或 revision。Tree Blob 和内嵌 Asset 共用注入的 `BlobStore`；当前实现是
本地目录，未来可替换为 `S3BlobStore` 或迁移包装器。Univer Collaboration Database Adapter
独立管理 snapshot、changeset 与 revision；Comment Database Adapter 在同一文件中独立管理
评论正文、回复和 solved 状态；History Database Adapter 在同一文件中保存可从 Core 创建事实与
changeset 重建的分段索引。SDK 1.0.0 的 Core/Worktree SQLite Adapter 在写入时以当前 Unix 秒覆盖
`changeset.createTime`，并返回实际保存的 changeset；重复提交保留原时间。两者不把协作内容写入产品数据库。

Office Exchange Module 使用已发布的 `@univerjs-pro/exchange-node` 将 Office 字节与 Univer
数据互转。`/universer-api/exchange/**`、Exchange File Upload 和签名下载遵循 Universer
协议形状，不进入产品 OpenAPI。导入为 Unit 时通过 Resource Module 创建 Personal Space
根目录下的正式 Node/Resource/Unit；导出时通过 Collaboration Service 固定当前 Trunk head，
读取包含 Sheet blocks 的恢复材料，再由 `UnitSnapshotMaterializer` 补全 snapshot 后交给 Exchange
Node。导出组装通过公开 SDK 解码 Unit，并以请求用户的 Trunk 权限读取图片 Asset；
只在导出副本内恢复 Base64 图片，母版、背景和序列化 drawing resources 同样处理。
缺失、无权限或无效的图片会使该导出任务失败，不修改协同数据或 Asset 的存储身份。
转换源文件、JSON snapshot
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

- 不为单一 Workspace 应用内的普通 Feature 增加 package；跨应用同步的独立组件必须有明确的 consumer
  和宿主集成边界。
- 不做 SSR。
- 不引入 Redux、Zustand 或 MobX。
- 不使用完整 FSD 七层。
- 不建立 BaseRepository、BaseService、依赖注入容器或 Event Bus。
- 不生成服务端业务代码。
- 目录随真实代码创建，不预先建立空层。

## 匿名查看

Node 与 Space 页面复用现有查询、目录与只读编辑器，未登录时使用轻量访客布局，不加载工作台
导航、Space 列表或 Worktree 事件连接。登录入口保留当前 URL（含沉浸视图参数）。
身份仍由 Session API 判断；SDK 的访客显示身份不赋予任何权限。服务端在明确开放的读取入口
传入匿名身份，统一由 Access Resolver 根据链接分享和 Space 公开可读判定 viewer 权限。
HTML 与引用来源继续分别鉴权，无专用匿名授权规则。

## HTML native Office preview

The Browser's `features/html-views` owns a narrow template navigation bridge and
one clipped native preview surface per HTML viewer. The shared HTML viewer and
SDK continue to own the binding runtime, sandbox and save lifecycle. Template
messages are pinned to the renderer frame and source generation; they carry only
Unit identity, geometry and bounded navigation, never URLs or authority.

`features/resources/native-unit-open.ts` resolves and opens each target through
existing product APIs. `/preview/$unitId` repeats authorization and mounts the
standard ResourceEditor with the server-selected editor mode in an independent browsing context, isolating
Office UI Facades from the persistent HTML Binding Engine. Target replacement
cancels pending lookup; frame removal disposes the native runtime. All targets
are Trunk; draft selection and editing belong to the existing file/review routes.
`features/editor/preview.ts` is the public navigation-contract entry; actual
Facade navigation stays inside the editor frame. Details and the page interface
are in [native preview](../../../docs/design/html-views/native-preview.md).
## Collaborator presence lifecycle

The editor observes room membership through the published SDK `MemberService`.
SDK 1.0.0-rc.0's `subscribeCollaborators` Facade can dereference `members$` before
the room exists, terminating the observer during editor initialization. The small
`workarounds/collaboration-members.ts` adapter treats an absent room as empty
presence, switches to a replacement room when emitted, and disposes on unmount.
Remove this adapter when the SDK Facade passes the delayed-room and replacement
regressions without it. OT, room creation and transport remain SDK responsibilities.

Native preview chrome offers an authenticated Slides snapshot export, separate from
HTML's sandboxed navigation messages. Only the same-origin parent, current frame
token, Unit and bounded request ID can start it; concurrent requests coalesce and
late completion after disposal is ignored. The host renders progress/errors and a
copy-link action without adding a toolbar inside the native content. Preview
compaction and Slide zoom are local view configuration, not Unit mutations.
