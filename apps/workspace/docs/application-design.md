# Univer Workspace 应用层设计

本文定义产品 HTTP、Univer Collaboration Endpoint 与 V20 Node/Resource/Asset 数据模型之间的
模块边界。具体 HTTP 契约以 `contracts/http/openapi.yaml` 为准。

## 模块

```text
React
  ├── Product HTTP
  │     └── Application Modules
  │           ├── Identity
  │           ├── Spaces
  │           ├── Nodes
  │           ├── Resources
  │           ├── Blobs / BlobStore
  │           ├── Office Exchange
  │           ├── Univer Assets / File Gateway
  │           ├── Permissions / Trash / Views
  │           ├── Issues
  │           ├── Worktrees
  │           └── Operations
  ├── Worktree Change Feed
  │     └── Authenticated WebSocket cache invalidation
  │
  └── Univer Collaboration Client
        └── Collaboration Endpoint
              ├── Login Session Authenticator
              ├── Collaboration Access Resolver
              └── Univer Collaboration Service
```

Product HTTP 与 Collaboration Endpoint 是两个入口，共享身份和权限模块，但不互相发起
HTTP 回调。Application Module 通过进程内 Interface 调用 Collaboration Service。

Worktree Change Feed 是第三个窄入口，只传播产品缓存失效信号。它复用 Collaboration
Endpoint 签发的一次性 Session Ticket，但不传播 snapshot、changeset、产品字段或权限结果。

## 数据库启动边界

`db/initialize.ts` 在创建业务 Repository 前打开数据库。磁盘数据库先经过可整体删除的
`db/migrations` 准备阶段：

- Fresh：创建 V20；
- V20：校验 Schema 指纹；
- V19/V18/V17/V16/V15/V14/V13/V12/V11/V10/V9/V8/V7/V6/V5/V4/V3/V2/V1：一致性备份后逐版本迁移到 V20；
- V0：一致性备份后直接迁移到 V20；
- 其他状态：拒绝启动。

旧表读取只允许存在于这个可整体删除的迁移包中。Identity、Node、Resource、权限、
Worktree 等业务模块只编译和运行 V20 Query。

V7 扩展 Operation 和 Object Deletion Job 枚举；V8 仅新增内容权限对象与协作者表；V9 仅新增 Issue 相关表，均不改写现有业务表。

V10 仅新增 `space_stars`，以 `(space_id, user_id)` 唯一约束表达收藏关系。Spaces Module 复用
Session 与 Access Resolver，公开读取者和已有成员均可 Star；收藏不会新增成员或授权。
`GET/PUT/DELETE /api/spaces/{spaceId}/star` 全部要求登录和当前 Space 访问权，PUT/DELETE 幂等，
写入与读取最新计数在同一产品事务中完成，不使用 Operation 或协同库。计数从关系表计算。
失去访问权时保留收藏记录，但三个接口均不可访问；重新获得访问权后仍能读取自己的状态。
`SpaceView.owner` 只投影已有 Space Owner 的 ID、username，不增加 Repository 实体或改变所有权。

V11 为 `spaces` 增加纯文本 `description`（至多 350 字符）。`SpaceView.description` 随 `GET /api/spaces`、
`GET /api/spaces/{spaceId}` 返回，`PATCH /api/spaces/{spaceId}` 可修改，权限与重命名 Space 相同；空字符串清除。
Browser 的 Code tab 在 About 区展示该简介，Settings 提供编辑入口。简介不替代 HTML 页面，也不进入协同库。
V13 扩展 External Identity Provider，允许 Google 登录。
V14 为邮箱验证码登录在 `users` 上新增可空的 `email` 列（部分唯一索引 `users_email`）与
`email_login_codes`：验证码只保存 scrypt Hash，十分钟过期、单次使用并限制尝试与请求频率；
验证成功后才在同一事务中创建 User、Personal Space、`users.email` 和 Session。邮件发送由 `EmailSender` 接口承担，配置层提供 SMTP（含 SES SMTP）与
仅写入 Server 日志的 console Provider，产品模块不依赖具体邮件厂商。
V12 为 Team Space 增加 `slug`、为 Worktree 增加仓库级 `number`，供 Browser 与 CLI 以 `owner/slug` 和 `#N` 寻址。
Spaces Module 在创建时校验或生成 slug（`POST /api/team-spaces` 的 `slug` 可选，供 DSH 插件等未更新的调用方继续使用），
`PATCH /api/spaces/{spaceId}` 可修改，`GET /api/spaces/lookup?owner=&slug=` 解析 `owner/slug` 与 `owner/personal`，
不可见与不存在同样返回 404。`SpaceView.slug/fullName` 由服务端统一计算。Team Worktree 与 Issue 共用 Space 编号序列，
Issue 分配逻辑与 Worktree 创建都在 `BEGIN IMMEDIATE` 事务内取最大值；编号不跨越产品库与协同库事务。
`GET /api/spaces/{spaceId}/worktrees/{number}` 按编号读取 Worktree，`GET /api/worktrees` 增加可重复的 `state` 过滤
（状态来自协同服务，故按候选批次扫描至页满）。产品模型仍使用 Space 与 Worktree，Repository 与 Pull request 只是展示名称。
Browser 的公共 Repository Header 与 Tabs 供 Code、Issues、PR、Pages 和 Settings 页面复用；
不改 tab 内部内容，Watch/Fork 和没有对应能力的 GitHub tab 不渲染。

V15 增加 `space_pins` 与 `space_stars_user` 索引，使用已有备份、事务回滚、指纹、外键和完整性检查流程。
所有列表入口均要求 Session。`GET /api/spaces` 只返回本人拥有或加入的 Space；
`/api/spaces/starred` 返回当前仍可见的收藏；`/api/spaces/explore` 返回本人未拥有或加入的公开 Space。
Explore 当前不分页，按收藏总数倒序、名称与 ID 排序。公开链接、匿名访问、Node Grant 和详情权限不变。
`SpaceView.affiliation` 由 `SpaceAccess` 推导为 `owner | member | none`，本人列表只允许前两种。

Access Module 维护共享的 Space 可见性 SQL、列和 Membership Join，以及纯函数 `spaceAccessFromRow`。
Spaces Repository 的 `listViews` 只接受 `mine | starred | explore | pins`，每种范围只执行一次 SQL，
复用访问投影和角色推导。所有 SpaceView 由一个 `toSpaceView` 构造。

`GET/PUT/DELETE /api/spaces/pins` 管理当前用户有序侧栏选择。可固定本人拥有或加入的 Space，以及已收藏的公开 Space。
GET 过滤不符合条件的存储行，没有剩余行则返回本人列表前 8 个，`customized = false`。
PUT 校验 1 至 12 个唯一 ID，在同一事务中检查资格并完整替换；无效输入统一返回字段 `spaceIds` 的 400。
DELETE 删除选择并返回默认列表；两个写方法均幂等。返回 `limit = 12` 供客户端使用。

V16 仅新增可空的 `login_sessions.write_source`、`worktrees.created_via` 和 `issues.created_via`，
CHECK 允许 `browser` 或 `agent`，`NULL` 表示未知；无默认值、回填或新索引。
Session 签发时写入来源，HTTP Worktree 与 Issue 创建时复制该来源，摘要以 `createdVia` 返回；
`NULL` 映射为 `unknown`，Worktree Operation 重试保留首次预留的来源。

Password 注册、`POST /api/auth/password/login`、Email 登录和 GitHub/Google/Discord OAuth
回调签发 `browser` Session。CLI device exchange、`POST /api/auth/cli/password/login`、
OAuth `POST /api/auth/token` 的 Session scope 和 Discord bot-login 签发 `agent` Session。
CLI password 路由与 Browser password 路由使用相同凭据及响应，额外设置 `Cache-Control: no-store`。
`agent` 仅表示非 Browser 登录入口，不推断谁在输入。Session JSON 不暴露来源；历史行不回填。

迁移前验证并备份 V15，事务失败回滚，成功后校验 V16 指纹，重复启动不重复备份。

V17 允许 `univer_resources` 与 `worktree_node_intents` 的 `unit_type` 取 `pdf`：SQLite 不能修改 CHECK，两张表在同一事务内重建，保留全部行、`univer_resources_kind_guard` 触发器与 `content_permission_objects` 的入向外键，沿用备份（`.v16-backup-…sqlite`）、回滚、指纹、外键和完整性检查流程。

V18 为 MCP 远程接入持久化 OAuth Grant、动态注册 Client 与 Personal Access Token（`oauth_grants`、`oauth_refresh_history`、`oauth_clients`、`personal_access_tokens`），并在 `login_sessions` 追加可空的 `issued_for_pat_id`、`issued_for_grant_id`，标记下游登录 Session 由哪个 Token 换取、Token 吊销时一并删除。迁移只追加表与列，不重建表，沿用备份（`.v17-backup-…sqlite`）、回滚、指纹、外键和完整性检查流程。Refresh Token 轮换时退役的哈希进入 `oauth_refresh_history`：60 秒宽限期内出示只失败不吊销，之后出示则吊销整个 Grant；OAuth Token 必须绑定 `resource`。Token 服务（`modules/identity/access-tokens.ts`）通过两组 HTTP 入口使用：登录用户用 `GET`/`POST /api/auth/tokens` 与 `DELETE /api/auth/tokens/:id` 管理自己的 PAT（明文只在创建时返回；由 token exchange 换出的 Session 不能创建 PAT、批准 CLI 登录、完成 OAuth 授权或关联外部身份，统一由 `requireInteractiveSession` 返回 403，避免产生比 Token 活得更久的访问）；机密网关 Client 在 `OAUTH_CLIENTS_JSON` 中设置 `tokenExchange: true` 后，可在 `POST /api/auth/token` 以 RFC 8693 `token-exchange` 把 PAT 或 MCP OAuth access token（须带与 Grant 一致的 `resource`）换成最长 10 分钟的下游登录 Session（不超过 Token 剩余有效期与部署 Session 时长）。吊销检查与 Session 写入在同一个数据库事务内完成，吊销 Token 会删除其下游 Session。现有 Browser、CLI 与 Agent 登录以及 `authorization_code` 授权的行为不变。设置 `MCP_RESOURCE_URLS`（并以 `PUBLIC_ORIGIN` 作为 issuer）后，MCP Client 走标准 OAuth：`GET /.well-known/oauth-authorization-server` 发现元数据，`POST /api/auth/register` 动态注册公共 Client（只接受 loopback http、https 与反向域名私有 scheme 的回调，不签发 secret，总数达到 `MCP_MAX_REGISTERED_CLIENTS` 后返回 503），授权时必须带 PKCE `S256` 与 `MCP_RESOURCE_URLS` 中的 `resource`，loopback 回调忽略端口匹配；同意页逐项列出四个 MCP scope，默认全选、可取消；`POST /api/auth/token` 的 `authorization_code` 与 `refresh_token` 签发、轮换绑定该 `resource` 的 Grant，`POST /api/auth/revoke` 吊销 Grant 及其下游 Session。授权码只能尝试一次，重放已兑换的授权码会吊销它签发的 Grant。未设置时这些入口都不存在，静态 Client 在两种情况下都保持原有规则。第一方 `POST /api/auth/agent-token` 仅接受交互式 Cookie Session，以 `univer-workspace-agents` 身份签发一小时的 `uvw_at_`，只允许无重复且顺序不限的 `[read]` 或 `[read, write]`，绑定经 `MCP_RESOURCE_URLS` 校验的 `PUBLIC_ORIGIN` 下 `/mcp`，返回 `201 { token, expiresAt, scopes, resource }` 与 `Cache-Control: no-store`，不返回 Refresh Token、不进入 PAT 列表，匿名、Token 换出的 Session、非法 scopes 和未配置的同源 MCP resource 分别返回 401、403、400 和 503，网关交换流程与 V18 Schema 不变。

PAT 或 MCP OAuth Grant 吊销、登录退出及 Session 到期都会以 1008 关闭该 Session
已打开的协同和 Worktree change-feed WebSocket。同一用户其他登录 Session 的连接继续使用。
Session 删除后，先前签发但尚未使用的票据建立的连接也会立即关闭。Token exchange 签发的
Session 仍可获取协同票据；票据按具体 Session 绑定，不把用户 ID 当作会话有效性的凭据。

`GET /api/spaces/{spaceId}/activity?timeZone=<IANA>` 要求 Session 与有效 IANA 时区，返回规范化
时区、截至该时区今天的 14 个日桶和窗口内最新 20 条事件。`opened` 按 `browser`、`agent`、
`unknown` 汇总 Pull request 与 Issue 创建；`merged` 仅统计协同服务确认已合入的 Worktree。
事件类型为 `pull-opened`、`pull-merged`、`issue-opened`、`issue-closed`，合入与关闭的来源均为
`unknown`，不从创建来源推断。日桶使用时区的日历日期计算，跨月、闰日与 DST 不依赖固定 24 小时间隔。

Worktrees 模块复用列表候选查询与 discoverability，Issues 模块复用 `requireSpace`；Team Space
只汇总调用者可发现的 Worktree 与该 Space 的 Issue。Personal Space 仅向 Owner 返回其 User
Worktree，不调用 Issues 模块，其他用户得到 404。每个来源最多汇总 1000 行，另读一行判断截断；
协同状态查询按处理时间倒序最多 200 次。截断或任何协同查询失败时 `complete` 为 `false`，
失败或超限行不贡献合入计数，创建事件仍可返回。未来可由 merge 写入产品侧 `merged_at` 消除逐行查询。

## Collaboration SDK 升级边界

启动时先准备产品数据库，再运行隔离的 `prepareCollaborationDatabase`，最后构造应用 Service
（自 SDK 1.0.0 起；SDK 1.4.0 增加 Core v2→v3）。Core/Worktree/History 的 schema 和迁移由已发布 SDK 拥有；Workspace 负责停写
部署、迁移期间的协同文件排他锁、一致性备份、从产品 Node 与 Worktree node intent 只读补充
Unit 创建事实、迁移副本验证和原子替换。组件版本为 Core 3、Worktree 3、History 2；
Comment 1 不变。产品数据库先准备到 V20，协同迁移再从中读取创建事实。任何组件迁移失败均不发布副本，原库与备份保留，启动失败。
当前版本重复启动只读取组件版本，不再次执行协同库完整性与外键全库扫描、迁移或备份；迁移前仍校验源库，迁移后仍校验副本。History 的事件订阅、分段和读取时追赶由 SDK 自行管理，
不再从产品 Resource 查询执行旧 History backfill。升级与回退步骤见应用 README。

启动诊断按模块加载、产品库准备、协同库准备和应用初始化分阶段记录；协同迁移进一步标记备份、创建事实读取、各 SDK 迁移、校验及替换。阶段日志不改变迁移顺序和失败传播，OOM 时以同一 startupId 的最后未完成阶段定位范围。

## Login Session Authenticator

需要登录的产品 HTTP、Changeset 与 Worktree 入口使用同一 Login Session：

```ts
interface LoginSessionAuthenticator {
  authenticate(cookieHeader: string | undefined):
    | { authenticated: false }
    | {
        authenticated: true;
        userId: string;
        sessionId: string;
      };
}
```

它只证明身份，不携带或缓存 Space、Node、Resource、Worktree Role。

Node、Resource 打开、按 Unit 查询、Blob 与 Trunk Asset 的指定读取接口也接受匿名访问者。
匿名身份以保留的 `ANONYMOUS_USER_ID`（`workspace:anonymous`）进入 Access Resolver，仅由 Link Sharing 或 Space 公开可读提供 viewer 权限；
所有写入和管理入口继续要求登录。匿名 Resource Open 不写 Recent。
SDK HTTP 的匿名入口集中由现有 Transport 中间件按方法和路径白名单放行，再由原有资源权限检查鉴权。
Trunk 协同协议使用固定的访客显示身份及每连接独立的 member ID，复用短期、一次性 Session Ticket；
该身份不对应产品 User，票据存储和连接生命周期沿用原实现。Snapshot、Comment/History 读取和
Unit 加入继续使用现有资源权限检查；Link Sharing 变更保留既有连接失效行为。Space 公开设置、
节点移动和删除不新增主动断连，既有订阅可能继续接收更新，断开后重连会重新鉴权。
没有新增票据代理、匿名连接登记、轮询、持久化 Session 或数据库迁移。

Workspace CLI 通过 Browser 确认的 Device Flow 获取同一种 Login Session。Server 在进程内
保存有容量上限、十分钟过期的待授权请求；已登录 Browser 确认人类可核对的验证码后，高熵
Device Code 只能兑换一次，并为 CLI 创建独立、持久化的 `login_sessions` 行。Server 重启可以
取消尚未确认或兑换的请求，但不影响已经签发的 CLI Session。Browser Cookie、密码、邮箱验证码、
GitHub、Google 和 Discord Token 都不会经过 Agent。

## Access Resolver

产品 HTTP 与 Collaboration Endpoint 共用：

```ts
interface AccessResolver {
  resolveSpace(userId: string, spaceId: string): SpaceAccess | null;
  resolveNode(userId: string, nodeId: string): NodeAccess | null;
  resolveResource(userId: string, resourceId: string): ResourceAccess | null;
  resolveUnit(userId: string, unitId: string): ResourceAccess | null;
}
```

返回值包含有效 Role 和服务端 Capability；`null` 表示目标不可发现。Resolver 内部统一
处理：

- Space Owner 与 Team Membership；
- Node 祖先链上的 Direct Grant 和 Link Sharing；
- Trash 状态；
- Node/Resource 以及对应 Univer/Blob 扩展映射；
- Resource Node 是否有子 Node（与内容访问彼此独立）。

`SpaceAccess.member` 区分 Space Owner/成员与只靠 `public_read` 得到 `viewer` 的读者。Issue 写入按它判断，
SpaceView 的 affiliation 也由该事实推导，权限判断仍使用 Role 和 Capability。

调用者不直接查询授权表或从客户端字段推断权限。Move 同时验证 Source、Target、同
Space 与后代链。

## Node 与 Resource 边界

Node Module 管理树、名称和位置：

```ts
interface NodesModule {
  listSpaceRoot(userId: string, spaceId: string, page: PageRequest): NodePage;
  get(userId: string, nodeId: string): NodeResponse;
  listChildren(userId: string, nodeId: string, page: PageRequest): NodePage;
  create(userId: string, input: CreateNode): NodeSummary;
  update(userId: string, nodeId: string, patch: PatchNode): NodeSummary;
}
```

任何 Node 都可调用 `listChildren`，是否有 Resource 不改变 Create Children 和 Browse
Children Capability。

Resource Module 管理内容身份和打开：

```ts
interface ResourcesModule {
  create(
    userId: string,
    idempotencyKey: string,
    input: CreateResource,
  ): Promise<CreateResourceResult>;
  get(userId: string, resourceId: string): ResourceResponse;
  open(userId: string, resourceId: string): ResourceOpenView;
}
```

创建 Resource 同时创建新 Node；本版本不把 Resource 附加到已有 Node。Canonical 页面
使用 Node ID，内容 Open 使用 Resource ID。

Resource 是由 `kind` 判别的联合。现有 `POST /api/resources` 只创建 Univer Resource；
Blob Module 通过 Upload Session 接收字节，只有 Complete 才发布 Node/Resource。BlobStore
保存字节，产品数据库保存元数据和删除 Outbox；前端根据服务端检测的 MIME 和原始文件扩展名选择预览。
`.md`/`.markdown` 使用只读 GFM 预览，保留源码切换与下载；兼容历史 octet-stream 分类时，
读取后先验证 UTF-8 与控制字符，不把文件名当成内容安全保证。

Blob 内容替换使用单次 PUT 和强 ETag 并发校验，直接发布到原 Resource。
`replace_blob_content` Operation 记录上传意图；产品事务只在新字节就绪且权限仍有效时切换对象，
旧对象通过删除 Outbox 回收。失败或启动时发现中断的替换保留旧内容并清理新对象。

`.univer.html` 使用现有 Blob 身份和上传生命周期，不新增数据库表或 Unit 类型。
Browser 的 Apps 入口在侧栏团队空间之后，列出当前用户能打开的这类 Blob。主区域使用和 Node 页相同的 HTML 视图与顶栏操作；沉浸视图仍进入该 Node。
Browser 根据模板中的 Unit ID 通过既有 API 检查来源访问，再由独立 Binding 引擎
加载 headless 协同数据。HTML 文件权限不授予来源表格权限；页面脚本在隔离 iframe 中执行，来源数据访问由宿主授权。
设计见 [Univer HTML Views](../../../docs/design/html-views/README.md)。

Univer Asset Module 适配原生 File API。它将 Slide、Board、Base 等 Unit 内嵌资源保存到同一
`BlobStore`，但不创建 Node/Resource。Snapshot 只持有稳定 Asset ID；签名接口返回同域
`/content` 网关，网关在每次请求时重新解析 Unit/Worktree 权限并禁止缓存。Worktree-local
Asset 在对应 Unit 合入后发布到 Trunk。

Office Exchange Module 适配 Univer Exchange Client 使用的 Universer 协议：

- `source=HttpImport` 的 `/universer-api/stream/file/upload` 由 Exchange 接收；Unit Embedded
  Asset 的上传继续由 Univer Asset Module 处理；
- import task 使用 `@univerjs-pro/exchange-node` 转换 XLS/XLSX/CSV/TSV、DOC/DOCX、
  PPT/PPTX 或 PDF（PDF 转换依赖可选原生 peer `@univerjs-pro/exchange-pdf-node-binding`，
  服务端通过 `@univerjs-pro/exchange-node/pdf` 注册适配器）；Workspace 文件入口按扩展名自动识别
  Office 格式与 PDF（`isImportableDocument`），并在当前 Space 与目录创建正式
  Resource，Editor Ribbon 导入则默认创建在当前 User 的 Personal Space 根目录。两种入口都
  必须通过 Resource Module，不能直接写入一个没有产品归属的 Collaboration Unit；
- Sheet、Doc、Slide 导入通过 exchange-node 的 `files.store` 把图片和内嵌 Office 附件拆成
  Trunk Univer Asset。Schema 触发器要求 Trunk Asset 的 Unit 已存在，所以导入先预留 Unit ID，
  转换时只把服务端选定的 Asset ID 写进 Unit 数据并暂留字节，Resource 创建成功后再把每个文件按
  Asset 上传生命周期（`reserveUpload` → BlobStore → `publishStored`）写入；Resource 创建失败不留
  任何文件。超过 Asset 上限（20 MB）的文件保持内联。JSON 输出（`outputType: 2`）没有归属 Unit，
  图片与附件保持内联。Unit 已创建而 Asset 尚未写完的窗口只在导入任务内部，任务结果在两者都完成后
  才返回；写入失败时 Unit 保留、对应引用无法解析，任务报错；
- 附件转在线文档：`POST /universer-api/exchange/{type}/import` 带 `sourceUnitID` 时，
  `fileID` 是该 Unit 的 Trunk Asset 而不是上传。调用者必须能打开宿主 Unit，Asset 必须属于
  `sourceUnitID`，否则 404。新 Unit 默认创建在宿主 Node 的目录（调用者在那里有创建权限时），
  否则落到 Personal Space 根目录；请求显式给出 `spaceId` 时以请求为准。附件本身留在宿主 Unit，
  宿主 drawing 只记录 `oleOnlineUnit`；
- export task 只接受服务端 `AccessResolver` 能解析且允许打开的 Trunk Unit，服务端自行
  确认 Unit Type，通过 Collaboration Service 固定当前 head 并读取包含 Sheet blocks 的恢复
  材料，再由 `UnitSnapshotMaterializer` 补全 snapshot；
- 导出时 Asset 引用由 exchange-node 的 `files.load` 回读：每个引用经 Univer Asset Module 以
  Asset 所属 Unit 重新解析权限（与引用所在 snapshot 无关），任何一处不可读即导出失败，不回退占位；
  URL 图片不是 Workspace Asset，导出为透明占位图。XLSX、DOCX、PPTX 与 PDF 导出默认把已转换附件
  嵌入为在线文档的当前确认版本：服务端以调用者身份逐个解析子 Unit（类型须匹配、须有打开权限）并
  materialize snapshot，任一子 Unit 不可读则整个任务失败，不回退到原始附件；请求
  `options.oleAttachmentSource: 'original'` 可改为嵌入原始附件文件。CSV/TSV/Base 只带原始附件，
  显式请求 `'online'` 返回 400。Browser 导出不提供这个选择；
- Browser 侧由 `WorkspaceOleLinkPlugin` 提供 `drawing.config.ole.getLink`（指向 `/preview/{unitId}`），
  附件工具栏因此出现"转为在线文档"和"打开"；
- 已知限制（SDK 1.4.0 仍存在）：空白新建的 PDF Unit 一经编辑器修改就无法导出，原生导出器会以
  "source-less PDF cannot apply imported semantic patches" 拒绝，因为编辑器 reducer 把叠加
  对象的编辑同时镜像进了 `objectPatches`；Workspace 不做绕过，等上游版本修复（exchange 集成
  测试中对应用例暂为 skip）；
- 转换用 source、JSON 和 output 字节保存在 `BlobStore`，任务与临时文件身份只在当前进程
  保存并在两小时后失效，不写入产品数据库；
- Worktree 和 Merge Preview 暂不注册 Exchange 插件，避免把 Trunk 内容误当作当前 Scope
  导出。Board 没有受支持的 Office 格式，也不注册 Exchange。

这些 `/universer-api` Route 属于 Univer/Universer 兼容入口，不是产品 HTTP contract，因此
不添加到 `contracts/http`。身份仍来自 Workspace Login Session；客户端提交的 User、Role、
Unit Type 或 Unit 可见性都不作为授权依据。

## Collaboration Access Resolver

Collaboration Endpoint 不信任客户端提交的 Resource ID、Unit Type、Role 或
`editorMode`。它只接受认证 User、目标 Unit 和 Scope：

```ts
type CollaborationScope =
  | { kind: "trunk" }
  | { kind: "worktree"; worktreeId: string }
  | { kind: "mergePreview"; worktreeId: string };

type CollaborationAction =
  | "readSnapshot"
  | "submitChangeset"
  | "connect"
  | "readComment"
  | "writeComment"
  | "issueSessionTicket";
```

Trunk Scope 通过 `univer_resources.unit_id` 反查 Resource，再解析所属 Node：

- Read/Connect 要求 Viewer 以上；
- Submit 要求 Editor 以上；
- Node 或祖先在 Trash 中时拒绝；
- Unit 不属于现有 Resource 时，普通 Trunk Endpoint 不可访问。

Comment Endpoint 复用同一 Login Session、Unit Room 与 Access Resolver，服务 Sheet、Doc、
Slide、Base 和 Board。`UnitAction.Comment` 与 `View` 使用同一打开权限：能打开 Unit 的人可以
新增、回复和改变 solved 状态。编辑正文由 Comment Service 限定为作者本人，删除要求作者本人或
Resource Owner/Admin。未登录请求只放行评论列表，写入在进入评论策略前被拒绝。评论 anchor 随
Unit 协作数据变化，正文由 Comment Adapter 保存。

#### 评论与 Worktree

评论是围绕 Unit 的对话，不是版本化内容。Comment 协议没有 Worktree ID、revision 或正文合并合同，
Collaboration Worktree Client 也不感知评论。因此本仓库采取的策略是：正文全局共享、不分支；只有
anchor 作为 Unit resource 随 snapshot/changeset 分支和合并。Browser 在 Trunk、Worktree 和 Merge
Preview 三种 Scope 注册同一套标准 Thread Comment model、UI 和远程 datasource，服务端评论策略只看
Resource 权限，不区分会话类型；Worktree 中读写评论与 Trunk 中读写是同一件事。

这一不对称带来的已知行为，作为后续优化方向记录在此，当前不做额外限制：

- 在 Worktree 中新增评论：正文立即进入共享 Comment 存储，anchor 只在 Worktree 快照中。Trunk 没有
  该 anchor，不会拉取该 thread；Worktree 合并后评论随 anchor 出现在 Trunk。Worktree 丢弃后正文成为
  不可见的孤儿记录，没有清理机制。
- 在 Worktree 中编辑、回复或 resolve 已有评论：Trunk 立即可见，与对话语义一致。
- 在 Worktree 中删除已有评论：正文全局消失，Trunk 保留指向空 thread 的 anchor，直到 Trunk 删除该
  anchor 或 Worktree 合并。这是唯一可能令人困惑的情况；如需收紧，可在 Comment Service 写中间件中
  校验请求来自该用户已加入的 Trunk Unit Room（`endpoint.findJoinedSession`），约 10 行。
- 标准 datasource 会把正文缓存写入 Worktree 快照的 anchor resource。该缓存与 Trunk 现状相同，只是
  读取加速，不产生分支或合并语义。
- 只读视图（Trunk 只读打开、Worktree 审阅页）的 Browser 只读守卫只取消当前 Unit 的本地内容 mutation，
  评论 mutation 和评论输入框自身文档的 mutation 放行。评论能否真正写入由服务端权限决定：有 Comment
  权限即可，不要求内容编辑权限。

可选的后续方向：只读的 Worktree 评论 UI（依赖上游 ThreadCommentUI 提供只读配置）、孤儿正文清理，
以及 Comment 协议的 Worktree 感知。在上游提供合同之前，不在本仓库自建评论分支或只读 UI 变体。

History Endpoint 同样复用 Login Session 与 Access Resolver，但服务五类 Trunk Unit。Viewer
可以列出版本、作者并读取版本 changeset；恢复版本会生成标准 Collaboration changeset，因此仍
由 Submit 权限要求 Editor 以上。History Adapter 的记录是权威 Trunk Unit/changeset 的派生索引；
SDK 自动索引并在 History 读取时从 Core 追赶；它不能替代 Collaboration Database Adapter。Browser 只在 Trunk Scope 按 Unit 类型
注册标准 SDK History UI，Worktree 与 Merge Preview 保持关闭。

Worktree 和 Merge Preview 先解析 Worktree Visibility，再校验 Trunk Resource 或激活目标
Node 的实际访问权限。Visibility 不替代底层权限。

## Recent Seam

成功的 Product Resource Open 才调用 Recent Repository：

```ts
interface RecentResourceRecorder {
  recordOpened(userId: string, resourceId: string, openedAt: number): void;
}
```

Collaboration Snapshot 重试、Node 元数据加载、Worktree Preview 和失败打开都不写 Recent。

## Issues

`modules/issues` 只读写产品数据库，权限来自 `AccessResolver.resolveSpace`：

- 无法发现的 Space 返回 404；Personal Space 返回 409，因为调用者本来就能看到自己的空间，
  明确的错误比隐藏更有用；
- 读取对所有能发现 Team Space 的登录用户开放（含公开读），写入要求 `member`；
- 标题、正文与状态由作者或 triage 权限修改，标签、Assignee 与引用文件只有 triage 权限可改，
  标签定义只有 Owner/Admin 可改；
- 引用文件以调用者身份经 `resolveNode` 解析，Trash 中或已不可读的 Node 只返回 `available: false`，
  不暴露名称；
- 每次写入成功后通过 `onChanged({ spaceId, audienceUserIds })` 通知 Owner 和全部成员，推送失败不影响写入结果。

Issue 写入不是跨系统写入，不使用 Operation，也不接受 `Idempotency-Key`。客户端遇到结果未知时先读列表
或时间线，再决定是否重试。

## Operation Runner

跨产品数据库与 Collaboration Service 的写操作以 Idempotency Key 固化意图和服务器生成
的 Node/Resource/Unit/Upload ID。Runner 只处理当前 Operation Kind 和 V3 JSON：

- 首次调用预留 ID；
- 同 Key 同意图返回已有状态；
- 同 Key 不同意图返回 Conflict；
- Retryable 错误保留 Pending 并由 Recovery Job 续跑；
- Non-retryable 错误进入 Failed，由显式 Retry 重新排队。

业务代码没有旧字段回退、旧表 Union、双写或旧 Route 转发。

## Web 应用

AI 或 CLI 通过另一 Login Session 修改 Worktree 时，Worktree Module 在完整产品操作成功后
向变更前后可发现该 Worktree 的在线用户发布 `worktreesChanged`。Browser 收到信号后使
`["worktrees"]` Query 失效；连接建立时服务端先发送 `worktreeChangeFeedReady`，Browser
同样执行一次失效，从而覆盖断线期间遗漏的 best-effort 通知。创建事件在产品 Worktree 与
Operation 都已保存后发布；merge/discard 事件在 `processed_at` 与相关恢复状态收敛后发布。

该通道不替代 Collaboration Worktree 的 per-Worktree 状态连接，也不建立可供其他 Module
任意发布的全局 Event Bus。

Web 应用的 Tree Row 总是 Node：

- `/nodes/{nodeId}` 是 Canonical URL；
- `hasChildren` 控制树展开；
- `resource === null` 表示纯组织 Node；
- `resource !== null` 时用 Resource ID 调 Open API；
- `resource.kind === "univer"` 时打开 Univer Editor；
- `resource.kind === "blob"` 时根据 MIME 与原始文件扩展名选择预览，未知类型显示下载；
- 权限、Move、Trash 全部传 Node ID；
- Recent 和 Worktree 内容操作使用 Resource ID。

OpenAPI 生成类型是 Web 应用与服务端的唯一 HTTP 结构约束。旧 Route 不在 OpenAPI 中，
Express 的未知 `/api/*` 路由直接返回 404，不落入 Web SPA Fallback。

## 内容保护授权

产品 `content-permissions` Repository 保存 ACL，Univer integration 实现 SDK Authz 路由，并在
`commitChangeset` 按 SDK 分析出的权限需求授权。文件 Owner 与 Admin 继承对象权限。查看和编辑范围都保存；
编辑范围为 `OneSelf` 时，非 Owner 只在查看范围为所有协作者时保留 View；否则 View 只来自对象角色。复制、打印、导出服从对象 strategies。
Snapshot、history 和 export 不按对象范围过滤。权限始终与文件访问权限取交集；Editor 可创建，
创建者和 Owner/Admin 可管理。Worktree 使用独立 Authz 路径读取当前 Trunk ACL，拒绝管理；
直接提交和合并都在 commit 阶段重新检查。现有产品 HTTP OpenAPI 不新增接口：
`/universer-api/authz` 及 Worktree scope 路由仍属于 SDK 协议适配。

## 智能工作台首次创建引导

从未创建过 Worktree 的用户可在智能工作台获取 Workspace Agent 下载和 CLI/Skill 安装引导。
已有可见任务时，以简洁提示提供入口，保留任务列表和审核界面。

## 按需嵌入产品运行时

原生 Embed 与公式引用共用 Workspace referenced-Unit Provider。Browser 在加载引用 snapshot 前，
按实际 Unit 类型准备产品依赖，而不把 Base 等所有产品运行时预装进每个编辑器。正式编辑器、
Worktree draft/trunk 审阅和 merge-preview 编辑器通过同一 composition root 接入。引用仍按既有
Trunk / Worktree mapping / merge-preview policy 选择数据，Source 本地内容 mutation 被阻止，
不会因为显示嵌入而加入新的 Source 写入房间。

支持范围、生命周期、SDK 边界及复验方法见 [嵌入运行时说明](embed-runtime.md)。

## HTML View 草稿审批

V19 的 `modules/html-view-drafts` 提供提交、作者读取、纯文本 content、publish 与 reject API。
提交接受最多 512 KiB UTF-8 HTML，执行结构校验，并将字节写入 BlobStore；相同作者与 key 的
相同目标和内容重试返回原草稿，不同意图返回 409。create 名称缺少 `.univer.html` 时自动追加。
接收中状态对读取不可见。content 使用 `text/plain; charset=utf-8`、CSP sandbox、nosniff 与
private/no-store，不能作为第一方源 HTML 执行。

发布和拒绝统一要求 `requireInteractiveSession`；Token 换出的 Session 只能提交和读取自己的
草稿。发布重新检查实时目标权限和可用性；权限丢失、目标回收或父节点缺失保留 pending，
仅基础 ETag 不匹配产生终态 conflicted 并释放字节。现有 Blob 维护 tick 先过期草稿再领取删除
任务。

Token 换出的 Session 通过 Blob API 预留上传、完成上传或替换内容，以及通过 Node API 将 Blob
重命名为页面时，统一检查 `.univer.html` 后缀，忽略大小写；上传与替换同时检查节点名和原始
文件名。命中时返回 403 `HTML_VIEW_DRAFT_REQUIRED`，要求使用 `html_view_create` 或
`html_view_replace` 提交草稿。浏览器与 CLI device login 的交互 Session、草稿发布和从回收站
恢复已有页面不受此限制。

## Skill 草稿审批

V20 的 `modules/skill-drafts` 提供 `/api/skill-drafts` 提交、作者读取、逐文件 content、publish 和 reject。
提交支持 name、spaceId、replace、文本 files 或固定来源 from、keep 和 review。只允许作者拥有的个人空间或 ACL 允许根目录创建的仓库。
同一作者与 Idempotency-Key 的相同意图返回原草稿，不同意图返回 409。草稿接收中对读取不可见。
静态扫描接受字节清单，使用 gateway 同版本的 `skillEntry` 校验 frontmatter。审查 quote 最长 200 字符，
服务端只保留文件中逐字存在的证据并补行号。审查只有 warn，静态 block 才阻止发布。

读取返回 `/drafts/skills/<id>` 的 previewPath、文件元数据、基础 Resource ID 与 ETag、keep、removedPaths、
扫描、已验证审查和 compatibility。content 的 path 参数选择相对路径；version=draft 读取待发布字节，
version=current 重新检查实时权限并读取当前文件，供逐文件差异审阅。响应使用纯文本、CSP sandbox、nosniff 与 private/no-store。
基础字节不做快照。当前文件不存在时返回 404，已过期或终态草稿字节返回 409。

只有作者的交互式 Session 能发布或拒绝。发布从 BlobStore 重新扫描，然后在一个 SQLite 事务中重新检查实时 ACL、
目标重名和完整基础版本，采用对象、替换文件、将移除文件送入 Trash 并记录结果。失败全部回滚，不创建 Operation。
block 或目标重名保持 pending，基础冲突进入 conflicted。Blob 维护任务同时过期 Skill 草稿并处理对象删除任务。
服务器事件和日志不包含 Skill 正文或审查原文。


### Skill 固定来源与导入

`POST /api/skill-sources/read` 由 Workspace Server 抓取来源。GitHub 仓库、tree 和 blob 链接先解析到
commit SHA，再读取 recursive tree 和固定 SHA 的 raw 文件。skills.sh 链接、owner/repo/skill 和
`npx skills add` 命令转成 GitHub 坐标，不执行命令。ClawHub 链接和 `clawhub install` 必须提供 owner，
固定 owner、slug、version 后以 version 文件清单过滤下载 zip，并校验文件大小和 SHA-256。
ClawHub moderation 和版本 security 的可疑或恶意状态生成 warn 级 hub-verdict，单纯警告生成 info。

不带 skill 返回 source 和候选的 name、description、path、fileCount、problems。带 skill 返回文件元数据、
SKILL.md 和静态 scan。skill 使用候选 path，根目录使用 `.`。再带 path 时只返回该文本文件的分页结果，
cursor 绑定来源版本、skill、path 和内容。文本分页限制与 skills_read 一致，不切断 UTF-16 代理对。

Space 来源使用调用者有权限读取的 zip Blob 或文件夹 node ID。文件夹的 ETag 由节点身份、名称、路径和
文件 ETag 计算，读取前后都重新检查。源版本变化返回 409，不能用旧解析结果导入新字节。
zip 使用 fflate，先检查 central directory 和 local header，再按块解压并累计实际字节。
单个归档最多 1,000 条目、单条目 20 MiB、总展开 100 MiB、单条目压缩比 100:1。
拒绝路径穿越、绝对路径、反斜线、符号链接、加密、多卷与 ZIP64。每个 Skill 仍受 100 文件、20 MiB 总量、
64 KiB SKILL.md、10 MiB 二进制和 256 KiB 文本读取限制。

`POST /api/skill-drafts` 的 files 与 from 互斥。from 接收固定 source、候选 skill 路径和少量 overrides，
直接复制来源的文本与二进制字节。override 的 text 为 null 时删除文件，否则写入 UTF-8 文本。
服务器只在 SKILL.md frontmatter 的 metadata 内写来源记录，保留其他字段和正文，数值形式的版本和 SHA
也写为字符串。source JSON 存入现有 source 列并从草稿 view 返回，无数据库结构变更。
已接收草稿的幂等重试返回原结果，不因 hub 离线或源后来变化而失败。尚在 receiving 的恢复仍重新读取固定来源。

网络只允许 api.github.com、raw.githubusercontent.com 和 clawhub.ai，手动检查每个重定向，整次请求超时
15 秒。GITHUB_TOKEN 默认为空，只发给 api.github.com，不转发用户凭据。
GitHub 403 或 hub 429 返回 SKILL_SOURCE_RATE_LIMITED，提示下载 zip 后上传 Space。
ClawHub 409 返回 SKILL_SOURCE_AMBIGUOUS 并列候选 owner；GitHub truncated tree 返回
SKILL_SOURCE_TRUNCATED，不把不完整路径当成完整来源。日志不含来源文件内容。
