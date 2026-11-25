# Univer Workspace 数据模型

产品库支持 SQLite 和 PostgreSQL，两个后端分别维护 schema 版本和外键约束。
SQLite 由 `server/src/db/sqlite/schema.sql` 定义，`PRAGMA user_version = 34`。
PostgreSQL 由 `server/src/db/postgres/schema.sql` 定义，`workspace_product_schema` 记录版本 14 和结构指纹。本模型以 Node 表达树，以 Resource 表达稳定内容身份；
Univer Unit 与 Blob 是 Resource 的两种互斥类型扩展，Unit 内嵌 Asset 不进入 Tree。

`DATABASE_PROVIDER` 同时选择产品库和协同库。SQLite 将 Univer Unit 的 Snapshot、Changeset、Sheet Block、Resource 与 Worktree 草稿保存到 `COLLABORATION_DATABASE_FILE`。PostgreSQL 将 Core、Worktree、History 与 Comment 保存到同一数据库的 `collaboration` schema，由 SDK 的 `schema_versions` 表分别记录组件版本。Core 使用 `core-s3` V1：快照引用保存在 `snapshots.block_ids`，`sheet_blocks` 记录 Unit 与块 ID，块内容由协同适配器写入 S3。当前 SDK 要求 Base `schemaVersion = 2`，每个 Table 都有唯一的系统字段
`__record_id`，并把每条 Record ID 投影到该字段；Row/Column/Cell Map 是可从 Field 与 Record
重建的派生数据。现有持久化 Base Snapshot 均使用该表示。

五类 Unit 的 Thread Comment anchor 属于 Unit snapshot/changeset；评论正文、回复、solved
状态与并发 generation 由 Comment Adapter 保存。在 SQLite 中使用 `collaboration_comments` 表，并由
`collaboration_schema_versions` 的 `comment=1` 组件版本管理。Comment Adapter 首次启动时
幂等创建该附加 Schema，不改变产品数据库，也不要求执行产品迁移命令。评论正文不分支：
Trunk、Worktree 和 Merge Preview 读写同一份评论数据；只有 anchor 作为 Unit
resource 随 Worktree snapshot/changeset 分支与合并（见 application-design.md "评论与 Worktree"）。

当前 Collaboration SQLite 组件版本为 `core=4`、`worktree=4`、`history=2` 和 `comment=1`。
SDK 1.5.2 的 v3→v4 迁移为主线与草稿的 Unit、Changeset 写入空元数据对象，保留已有修订与协议载荷。
SDK 1.0.0 把组件升到 `core=2`、`worktree=3`、`history=2`；SDK 1.4.0 把 Core 升到 v3：协议对象
改为 MessagePack `BLOB` 保存，硬删除的 Unit 以 `deleted_status='hard'` 标记行保留在
`collaboration_units`，不再有 tombstone 表。Core 与 Worktree 保存 Unit 创建者、创建时间及 changeset 提交时间；
History 只保存 `collaboration_history_records` 分段索引，从 Core 权威事实与 changeset
构造列表。SDK 自动订阅创建/编辑事件，并在 History 读取时追赶索引；Workspace 不再维护
旧逐 revision 索引或启动 backfill。History 读取遵循 Unit 打开权限，恢复仍遵循内容编辑权限；
Worktree 和 Merge Preview 不读取或写入 Trunk History。

SQLite 启动入口先将产品数据库准备到 V34，再在构造 Service/Adapter 前集中调用已发布 SDK 的
Core V1→V4、Worktree V1→V4 与 History V1→V2 迁移。部署先停止全部写入者；启动时对协同
文件读取组件版本；仅需迁移时取得排他锁并一直持有到替换完成，其他进程仍打开 WAL 文件或持有锁时在备份前失败。迁移前检查源库完整性和外键，随后生成
一致性备份。在暂存副本上依次调用 SDK 的 Core、Worktree、History 迁移入口，各入口按组件现有版本执行所需步骤。History 最后迁移，以便前两个组件读取旧创建记录。
通过 Adapter Schema 校验、外键和完整性检查后原子替换文件，并保持原 journal mode。失败
不发布副本，原文件和备份保留，启动失败。当前版本只读取组件版本，不重复执行完整性与外键全库扫描、迁移或备份。Unit 创建者与创建时间依次
取自 History V1 revision 1、产品 Trunk Node（`univer_resources` → `nodes`）或 Worktree 新建
Unit 的 `worktree_node_intents`；都缺失时才使用 SDK 的 `anonymous`/迁移时刻回退值，不能将其
当作原始事实。changeset 时间沿用 SDK 默认规则。产品数据库为 V34，Blob/Asset 字节与产品恢复状态不参与协同 Schema 改写。
回退必须停新实例并恢复配套升级前备份；不得让新旧 SDK 同时写同一文件。

迁移阶段同步输出 `workspace.startup` 诊断日志（耗时与内存字节数），不记录数据内容，也不新增持久化状态或改变 Schema。阶段完成只表示该步骤返回；整体迁移成功仍以准备函数成功返回为准。

跨后端迁移在一个 PostgreSQL 事务中导入产品及协同记录。对象键保持原值，Worktree 内新建 Unit 的 SQLite 基线占位值 `1` 转为 PostgreSQL 的 `NULL`，草稿修订号保留。[操作说明](storage-migration.zh-CN.md)

## 核心关系

```text
Space
  └── Node ──0..1── Resource
       │                  ├── Univer Resource ──1── Unit ── Asset ── BlobStore Object
       │                  └── Blob Resource ──1── BlobStore Object
       ├── child Node
       ├── Node Grant
       ├── Node Link Sharing
       └── Trash Batch

User ── Recent Resource ── Resource
User ── Space Star ── Space
User ── Space Pin ── Space
User ── OAuth Grant / Personal Access Token ── Login Session（下游凭据）
Team Space ── Issue ─┬── Issue Comment / Issue Event
                     ├── Issue Label Link ── Issue Label
                     ├── Issue Assignee ── User
                     └── Issue Node Reference ── Node
Worktree ── Worktree Unit ── Resource ID
                         └── optional Node activation intent

Univer Asset Upload ── publish ── Univer Asset
Object Deletion Job ── idempotent delete ── BlobStore Object
```

核心约束：

- Node 可以没有 Resource，作为纯组织节点。
- 任意 Node 都可以挂子 Node；Resource 是否存在不影响树结构。
- 当前 Node 与 Resource 是一对零或一：`resources.node_id UNIQUE NOT NULL`。
- Resource 不保存名称或位置；Node 是名称、父子关系、权限、分享和回收站的权威来源。
- `resources.kind` 为 `univer | blob`，创建后不可修改。
- 每个 Resource 必须且只能有与 Kind 对应的扩展记录。
- 本版本不包含快捷方式，也不为未来快捷方式预留字段。
- Univer Asset 完全继承所属 Trunk Unit 或 Worktree Scope 的权限，不创建独立 Resource。

## 身份与空间

### `users`

用户的稳定身份和公开资料。`username` 使用 `NOCASE UNIQUE`。它出现在 Space 全名和其他人看到的列表里，因此注册或修改资料时新选择的 username 不得含韩文填充符等不可见字符，也不得是 User ID 的 UUID 形状；由邮箱或 Provider 派生的 username 删除这些字符，删空时回退为 `user` 或 `<provider>-<subject>`，是 UUID 形状时追加后缀。已存储的 username 保持不变，照常登录。

`email`（V14，`TEXT COLLATE NOCASE`，可空）是邮箱验证码登录使用的已验证地址，通过部分唯一索引
`users_email`（`WHERE email IS NOT NULL`）保证非空值全局唯一；未使用邮箱登录的 User 保持 `NULL`，
可以存在多个。只有在向该地址发送的六位验证码验证成功后才会写入该列。邮箱首次验证成功时，
User、`users.email`、Personal Space 与 Session 在同一事务中创建。Google 登录以 OpenID Connect
`sub` 作为 Subject；Email 登录与 Google 登录之间不按邮箱自动关联已有 User。

`kind`（V21，`'human' | 'agent'`，非空，默认 `'human'`）区分人和 agent。它与
`login_sessions.write_source = 'agent'` 无关：后者标记凭据签发的 Session，人的个人访问令牌也会产生。

`display_name` 对所有打开该 User 共享文件的人可见，人和 agent 的每一次写入都经过同一条显示名规则（`server/src/modules/identity/display-name.ts`），规则在任何匹配之前先限定输入长度。控制字符、行与段分隔符、U+2800 和 U+1D159 变为空格；双向控制、韩文填充符等默认可忽略码位、前置连接符号（如 U+0600 阿拉伯数字符号）以外的格式字符、未配对代理项与 U+FFFD 被删除。两个字符之间的零宽连接符与零宽非连接符、紧跟 virama 的零宽连接符、紧跟字符的变体选择符和 RGI 地区旗帜（英格兰、苏格兰、威尔士）的标签字符保留，其它标签字符被删除，因此 emoji、波斯文和印度系文字的名字逐字节不变。连续空白合并为一个空格并去除首尾空白。长度按 Unicode 码位计算。用户亲自输入的名字（密码注册、修改资料）超过 100 个码位、没有可见字符（只有空白、组合附加符、U+FFFC 或私用区字符）或含邮箱地址时返回 400，由本人改正，而不是被悄悄改成别的名字。邮箱地址指 `local@domain.tld`，也包括 `@` 之后或两侧带空格、连续的 `@`、以 U+FF20 或 U+FE6B 代替 `@`、以 U+2024、U+3002、U+FE52、U+FF0E 或 U+FF61 代替点、`mailto:` 前缀和不可见的本地部分（只在 `@` 之前带空格的 `Team @acme.io` 是 handle）；`alice [at] example.com`、`alice(at)example.com` 与 `alice@example` 不在识别范围内。来自 GitHub、Google、Discord、Discord Bot、邮箱登录、agent 标签和 OAuth 客户端名的派生名字没有人当场改正，因此不拒绝：邮箱地址只保留本地部分，超长时按完整字素截断，没有可见字符时依次回退为同样经过规则的 Provider 用户名、`Workspace User` 或 `agent`。Google 未提供姓名时取邮箱本地部分。

### `agents`

每个 `kind = 'agent'` 的 User 对应一行，是该 agent 生命周期的唯一来源。`user_id` 是主键并随 User 删除。
`owner_user_id` 与 `claimed_at` 同时为空（未认领）或同时非空（已认领），由表级 CHECK 保证；
被引用为主人的 User 不能删除。`origin_label` 记录创建时提交的标签；访客入口未提交标签时，记录 OAuth 客户端名。V22 起写入前按 `users.display_name` 的显示名规则清理，客户端名按完整字素截断到 40 个码位；V22 之前写入的值保持原样，V22 修复不改写它。该列只作记录，任何接口都不返回或展示它。`last_active_at` 是最近活跃时间。
`expires_at` 为空表示不过期，`banned_at` 非空表示已封禁。全部时间为毫秒时间戳。不保存来源 IP。

Identity 的 `createAgent` 在同一事务中创建 User、Personal Space 与本行，`expires_at` 为创建后 30 天，
不创建 Session；凭据由调用方另行签发。用户名是标签的 slug 加 `-` 和 4 位随机字符，冲突时重试。

agent 认证成功时 `last_active_at` 写为当前时间；未认领 agent 同时把 `expires_at` 写为 30 天后，Server
送出它名下一个匿名读者可读的 `/nodes/:nodeId` 页面时也这样写。每个 agent 每天最多写一次，已过期的 agent
认证成功时不受这个间隔限制。页面只在 Server 自己提供 Browser 构建产物时经过这一步，Vite 开发服务器送出的
页面不顺延。

人认领 agent 时，一次条件更新在 `owner_user_id` 为空且 `banned_at` 为空时写入 `owner_user_id`、
`claimed_at` 并把 `expires_at` 置空，所以同一个 agent 只能被认领一次。认领码只在进程内存中，不落库。
主人是该 agent Personal Space 的 Owner，权限从这一列推出，不写 `space_members` 或 `node_grants`。

`banned_at` 由运维命令 `db:ban-agent` 或主人停用该 agent 时写入，已有值不被覆盖，两种来源不加区分。
“暂停”不落库：`banned_at` 非空或 `expires_at` 已过时，权限解析对 agent 本人与其主人以外的人不给出该 agent 的
Space 的任何角色。

### `password_credentials`

本地密码凭据，与 User 一对一并随 User 删除。

### `email_login_codes`

短期邮箱登录验证码。字段为 `id`、`email`（NOCASE）、`code_hash`（scrypt）、`attempts`、
`created_at`、`expires_at`、`consumed_at`；明文验证码不进入数据库，也不写入日志。
验证码十分钟过期、最多尝试五次且只能使用一次；同一地址每分钟最多请求一次，每小时最多五次。
该表不引用 `users`，因为 User 只在验证成功后创建。过期记录在每次请求时顺带清理。
地址在写入和查询前统一转为小写；PostgreSQL 按原值相等匹配，命中 `(email, created_at DESC)` 索引。

### `external_identities`

外部身份映射。Provider 允许 `github`、`google` 和 `discord`；同一 Provider Subject 唯一，
同一 User 在一个 Provider 下最多一个身份。Google 登录以 OpenID Connect `sub` 作为 Subject，
不按邮箱自动关联已有 User；Email 登录同样不会自动合并到已有 GitHub、Google 或 Discord 账号。

### `login_sessions`

持久化 Session ID、Secret Hash、User、创建与过期时间，以及可空的 `write_source`。原始 Cookie Secret 不入库。Browser
授权 CLI 后会为 CLI 创建独立的普通 Session 行；十分钟内待确认的一次性授权请求仅存在于
Server 进程内存，不进入产品数据库，进程重启后由用户重新发起。

`write_source`（V16，`TEXT`，可空）记录签发 Session 的入口：`browser` 表示 Workspace Web 登录路由，
`agent` 表示任意非 Browser 入口；`NULL` 表示未知。CHECK 仅允许 `browser`、`agent` 或 `NULL`，
无默认值，不回填已有 Session。Session 签发流程写入 `write_source`，HTTP Worktree/Issue 创建复制到 `created_via`；
摘要以 `createdVia` 暴露该值，`NULL` 返回 `unknown`。Worktree Operation payload 保存首次预留的来源，
后续重试保留它。Session JSON 不暴露 `writeSource`。

`write_source = 'agent'` 且 `issued_for_pat_id`、`issued_for_grant_id` 都为空的 Session 在剩余有效期不足一半时被认证使用，
Server 把 `expires_at` 改写为当前时间加 `SESSION_TTL_MS`。只读的 Session 检查不续期。其他 Session 的 `expires_at`
签发后不变，过期即失效。用户修改密码时，更新 `password_credentials` 的同一个事务删除该用户的这类 Session，
发起修改的 Session 除外。Browser Session 和为 Token 签发的 Session 不受影响。

`issued_for_pat_id`（V18，`TEXT`，可空，`REFERENCES personal_access_tokens(id) ON DELETE CASCADE`）与
`issued_for_grant_id`（V18，`TEXT`，可空，`REFERENCES oauth_grants(id) ON DELETE CASCADE`）标记该 Session 是为哪个
Personal Access Token 或 OAuth Grant 签发的下游凭据，两列依次追加在表末，列级 CHECK
`issued_for_pat_id IS NULL OR issued_for_grant_id IS NULL` 保证至多一个非空。两列均有仅覆盖非空行的部分索引
`login_sessions_pat`、`login_sessions_grant`。现有登录入口（Browser、CLI、Agent OAuth）两列恒为 `NULL`，
Session 行为与有效期不变。吊销 Token 时由 Token 服务显式删除其 Session（吊销只写 `revoked_at`，不触发级联）。

### `oauth_clients`

动态注册（RFC 7591）的公共 OAuth Client：`client_id`（主键）、可空 `client_name`、`redirect_uris`（JSON 数组文本）、
`created_at`、可空 `last_used_at`。`OAUTH_CLIENTS_JSON` 中的静态 Client 仍留在配置里，不入库；
Client ID Metadata Document 形式的 `client_id`（https URL）也不在此表登记。

### `oauth_grants`

一次签发给 MCP Client 的 OAuth 授权：一个 Access Token 加一个轮换的 Refresh Token。`user_id` 引用 `users`
（`ON DELETE CASCADE`）；`client_id` 为 DCR ID、CIMD URL 或静态 ID，不建外键；`scopes` 为空格分隔的
`read | write | publish | worktree:merge`；`resource` 为绑定的受众（RFC 8707）。仅保存哈希：
`access_token_hash`、`refresh_token_hash` 均 `UNIQUE NOT NULL`。`resource` 必填：签发拒绝空值，刷新与校验 Access Token 必须出示相同的 `resource`。
`access_expires_at`（1 小时）、`refresh_expires_at`（30 天，随轮换顺延）、`created_at`、`last_used_at`、
`revoked_at`（软吊销）均为毫秒时间戳。明文形如 `uvw_at_<id>.<secret>`、`uvw_rt_<id>.<secret>`，`<id>` 即 Grant ID，
哈希算法与 Session Secret 相同。索引 `oauth_grants_user(user_id, created_at DESC)`。

### `oauth_refresh_history`

每次轮换把被替换的 Refresh Token 哈希记入此表：`refresh_token_hash`（主键）、`grant_id`（`REFERENCES oauth_grants(id)
ON DELETE CASCADE`）、`retired_at`（毫秒时间戳），索引 `oauth_refresh_history_grant(grant_id)`。出示已退役的 Refresh
Token 时，距 `retired_at` 不足 60 秒（`REFRESH_REUSE_GRACE_MS`）视为响应丢失或客户端重试，只返回失败、不改动 Grant；
超过宽限期视为重放，吊销整个 Grant 并删除其下游 Session。既不匹配当前哈希也不在历史中的 Token 只返回 `invalid`，
不吊销任何 Grant（Grant ID 会出现在 Access Token 中，按 ID 吊销会让任何人终止任意 Grant）。

### `personal_access_tokens`

Personal Access Token（PAT）：`id`、`user_id`（`ON DELETE CASCADE`）、`name`、`token_hash`（`UNIQUE NOT NULL`）、
空格分隔的 `scopes`（默认全部）、`created_at`、可空 `expires_at`（默认不过期）、`last_used_at`、`revoked_at`。
明文形如 `uvw_pat_<id>.<secret>`，只在创建时返回一次，库中仅保存哈希。索引
`personal_access_tokens_user(user_id, created_at DESC)`。

### `spaces`

`type` 为 `personal | team`。一个 User 最多拥有一个 Personal Space。
Personal Space 创建时名为 `<display_name> 的个人空间`。User 修改 `display_name` 时，若其 Personal Space
名仍等于 `<原 display_name> 的个人空间`，同一事务内改为新名；改过名的 Personal Space 保持不变。
是否仍为默认名只按这条等式判断，不另存标记。
`public_read` 默认关闭；开启后，任意访问者（含匿名访客）无需 Membership 或 Node Grant 即可按
`viewer` 浏览 Space 树并打开其中内容。已有更高权限优先，公开策略不授予任何写能力。
`description` 是 Space 的纯文本简介（`TEXT NOT NULL DEFAULT ''`，修剪空白后至多 350 字符），
空字符串表示未设置；仅有重命名 Space 能力的用户可修改，读取权限与 Space 本身一致。它不是 README，
HTML 页面内容仍以 Blob 保存。

`proposals`（V29，`TEXT NOT NULL DEFAULT 'members'`，CHECK 取 `members | accountable | anyone`）决定 Space Member
之外谁能 Fork 这个 Team Space 并在其中开 Team Worktree（提议），仅在 `public_read` 开启时生效：`members` 不接纳其他人，
`accountable` 接纳能读它的人与已认领的 agent，`anyone` 再接纳未认领的 agent。Personal Space 恒为 `members`。只有
owner 与 admin 能修改。“能否提议”只在 SQL 里判断一次（SQLite 与 PostgreSQL 的 `proposesSql`），Space 视图的
`capabilities.propose`、Worktree 的作者权利与提议目标检查都读它。非成员提议者不进 `space_members`，不能开 Issue、改
Trunk 或合并；它只看见自己的 Team Worktree。设置改回 `members` 或关闭公开读取后，它的 draft 像离开 Space 一样冻结，
ready 的提议仍留给成员审阅、合并或放弃。非成员在一个 Team Space 至多有 3 个未处理（`processed_at IS NULL`）的
Team Worktree，计数与插入在同一事务内，超出返回 `403 FORBIDDEN`。

`accept_after_hours`（V31，`INTEGER`，可空，CHECK 大于 0）是 Team Space 的验收期限：`NULL`（默认，新库和迁移后的
已有行都是）表示关闭；开启时，提交（`submitted`）或重新打开之后这么多小时内无人退回的 Issue 由期限验收，见 `issue_verdicts`。
只有 owner 与 admin 能经 `PATCH /api/spaces/{spaceId}` 的 `acceptAfterHours` 修改，服务层只接受 1–720 的整数或
`null`，开启时建议取 72。Personal Space 恒为 `NULL`。

`landing`（V33，`TEXT NOT NULL DEFAULT 'review'`，CHECK 取 `review | checks`）决定不拥有 Team Space 的 agent
怎样把改动落到 Trunk。`review` 不加任何要求。`checks` 时，这样的 agent 只能通过合入 pull request 改 Trunk，而且
Trunk 的 `.agents/checks.md` 声明的每个检查都要有计入的 `passed`（见 [`worktree_checks`](#worktree_checks)）；它对 Trunk
的直接写入一律拒绝。人和拥有 Space 的 agent 永不受限，agent 是否拥有 Space 看 `owner_user_id`。Personal Space 恒为
`review`。owner 与 admin 能修改，但不拥有 Space 的 agent 不能，返回 `403 AGENT_NOT_ALLOWED`。

`slug`（V12，`TEXT COLLATE NOCASE`，可空）是 Team Space 在 owner 名下的短名，规则为
`[A-Za-z0-9._-]`、1–100 字符、首字符为字母或数字，不区分大小写，`(owner_user_id, slug)` 唯一
（部分唯一索引 `spaces_owner_slug`，`slug IS NOT NULL`）。Personal Space 不存 slug，`personal` 为保留字，
Trigger `spaces_slug_insert/update` 守护这两条不变量；格式与冲突在服务层校验并返回 400/409
`SPACE_SLUG_TAKEN`。V12 之前创建的 Team Space 取 `NULL`，不回填，管理员可在 Settings 中设置。
全名由服务端计算：`<owner.username>/<slug>`；Personal Space 一律为 `<owner.username>/personal`
（经 `spaces_personal_owner` 解析，旧数据同样适用）。username 可修改，改名后旧全名失效，不保留重定向。
Team Space slug 与同一 owner 的 `forks.name` 共用一个名字空间（不区分大小写）。创建 Team Space、修改 slug 与创建
Fork 都在写入的同一事务内检查两张表，冲突返回 409 `SPACE_SLUG_TAKEN`；未指定 slug 时派生的 slug 跳过已被 Fork 占用的
名字，继续追加数字后缀。

`GET /api/spaces` 仅列出本人拥有或作为 Team 成员加入的 Space，不包含其他人的公开 Space。
`SpaceView.affiliation` 为 `owner | member | none`，从 Access Resolver 的所有者与成员事实推导，
不从有效角色推导；Team viewer 成员与公开 reader 的 `accessRole` 都可能为 `viewer`。
公开 Space 仍可通过详情、全名与已有公开链接读取。

### `space_members`

仅用于 Team Space，角色为 `admin | editor | viewer`。Space Owner 不重复写入成员表；
Trigger 阻止向 Personal Space 写成员或把 Owner 写成成员。

### `space_stars`

用户对已有 Space 的收藏关系：`space_id`、`user_id`、`created_at`（Unix 毫秒）。
联合主键 `(space_id, user_id)` 防止重复收藏，两条外键均 `ON DELETE CASCADE`。
Star 不创建 Repository、成员、ACL、Unit 或 Operation，不改变 Space 的所有权和可见性。
总数从关系表实时计算，不在 Space 中维护冗余计数。Personal 和 Team Space 均支持。
用户取消 Star 时删除自己的关系；失去访问权时保留关系但不能再读取或操作，重新获得访问权后恢复可见。
三个 Star HTTP 方法均要求登录及服务端 Access Resolver 确认的当前 Space 访问权。
`GET /api/spaces/starred` 按收藏时间倒序返回当前仍可访问的收藏，使用
`space_stars_user(user_id, created_at)` 索引。`GET /api/spaces/explore` 返回本人既非所有者也非成员的
公开 Space，按收藏总数倒序、名称与 ID 排序，当前不分页。
记录属于受保护的产品用户行为数据；HTTP 返回本人的收藏列表、状态与汇总计数，不提供收藏者列表。

### `space_pins`

保存用户的有序侧栏选择，字段为 `user_id`、`space_id`、`position` 和 `created_at`。
主键 `(user_id, space_id)` 防止重复，唯一约束 `(user_id, position)` 保证位置唯一；
两条外键都 `ON DELETE CASCADE`。位置由服务端按请求顺序写为 0 起的连续整数。

允许固定本人拥有或加入的 Space，以及本人已收藏的公开 Space。读取按位置排序并过滤当前不符合条件的行；
失去资格时保留关系，资格恢复后重新显示。没有存储行或没有行仍符合条件时，返回本人列表前 8 个，
`customized = false`。PUT 接受 1 至 12 个唯一 ID，在同一事务内校验资格并完整替换。
不存在、不可见或不符合条件的 ID 与重复、超限输入统一返回 `400 INVALID_INPUT`，字段为 `spaceIds`。
DELETE 清空本人的行并恢复默认列表。Pins 不授予访问权，不写 Operation 或协同库。
记录属于当前用户的产品偏好，只能通过本人 Session 读取和修改。

## Node 树

### `nodes`

| 字段 | 语义 |
| --- | --- |
| `id` | Canonical Node ID，也是树页面 URL 身份 |
| `space_id` | 所属 Space |
| `parent_id` | 父 Node；`NULL` 表示 Space 根级 |
| `name` | 产品显示名称的唯一权威值 |
| `created_by` | 创建者 |
| `trash_batch_id` | 当前回收站批次；`NULL` 表示可见 |
| `created_at` / `updated_at` | Unix 毫秒 |
| `copied_from_node_id` | 复制来源 Node（V24）；不是复制得到的 Node 为 `NULL`，来源 Node 被永久删除时置 `NULL` |

数据库 Trigger 保证非空 Parent 与 Child 在同一 Space，并阻止直接自指。应用层在 Move
前额外检查整条后代链，阻止把 Node 移入自己的后代。

`nodes_parent` 支持按 Space、Parent、回收站状态和名称分页；`nodes_trash` 支持回收站
批次查询。部分索引 `nodes_copied_from` 只收录有来源的 Node，支持按来源统计副本，并让删除 Node 时的
置空不必全表扫描。

Node 不包含 `kind`、`node_type` 或 `is_folder`。是否有内容只由对应 Resource 是否存在
表达。

## Resource 与类型扩展

### `resources`

| 字段 | 语义 |
| --- | --- |
| `id` | 稳定、不透明的 Resource ID |
| `node_id` | 唯一所属 Node |
| `kind` | `univer | blob`，不可变的判别字段 |
| `created_at` / `updated_at` | Unix 毫秒 |

Resource 是内容 API、Recent 和 Worktree 的产品身份。它不重复保存 Node 名称、Space
或 Parent。

### `univer_resources`

| 字段 | 语义 |
| --- | --- |
| `resource_id` | Resource 主键和外键 |
| `unit_id` | Univer Collaboration Unit ID，全局唯一 |
| `unit_type` | `sheet | doc | slide | board | base | pdf` |

### `blob_resources`

保存 BlobStore `object_key`、原始文件名、服务端检测的 MIME、字节数、SHA-256、ETag 与
`ready | quarantined` 可用状态。文件字节不进入产品库，Object Key 不返回客户端。前端
根据 MIME 与原始文件扩展名选择预览组件；数据库不保存 Preview Kind。
本地后端以 `object_key` 为文件名，S3 后端将同一个键放在配置的 bucket 与可选前缀下。
切换后端时按原键迁移字节，产品表中的对象身份和内容校验值保持有效。
Markdown 只增加只读展示，不新增 Resource kind、Unit 或持久化字段。

### `blob_upload_sessions`

保存发布前的三段上传状态以及服务端预留的 Node/Resource/Object 身份。上传完成前不创建
Node 和 Resource，因此 Tree 不会看见半成品。Complete 在一个产品事务中发布 Node、
Resource 与 Blob 扩展并完成 Operation。接收字节的请求每 10 秒续期一次 `verifying` 行的
`updated_at`。任一副本的后台维护（每 5 秒一轮）把超过 60 秒未续期的 `verifying` 行视为接收进程已停止，
恢复为可重传状态，因此进程停止后约 65 秒内可以重传。服务启动不再恢复上传：PostgreSQL 下其他副本可能仍在
接收这些字节，SQLite 也走同一条后台路径。确定性临时对象会在重传、Abort 或过期清理时移除。

### `univer_assets`

保存 Unit 内嵌资源的稳定 Asset ID、Scope、Object Key、客户端声明的 MIME、字节数、SHA-256、
ETag 和创建者。`worktree_id IS NULL` 表示 Trunk；非空时 Asset 只属于该 Worktree。Trunk Asset
必须引用现有 `univer_resources.unit_id`，Worktree Asset 必须引用对应 `worktree_units`。

Snapshot 只保存 Asset ID，不保存 Object Key、文件路径、短期地址或字节。Asset 不创建 Node，
也不进入 Recent、分享或 Tree API。Office 导入拆出的图片与内嵌附件也是这里的 Trunk Asset：导入任务先
预留 Unit ID，Resource 创建成功后再以 `univer_asset_uploads` 生命周期写入并发布（见
application-design.md "Office Exchange Module"）。附件转成在线文档后，附件 Asset 仍属于宿主 Unit。

### `univer_asset_uploads`

保存原生 Univer File API 上传的 `receiving | stored` 状态。行中预留 Asset/Object 身份并固化
Unit Scope；字节完整写入 BlobStore 后记录 Hash 与 ETag，再在一个产品事务中发布
`univer_assets` 并删除 Upload 行。预留在创建 1 小时后过期，足够在 20 MB 上限内完成上传。
任一副本的后台维护发布已过期的完整 `stored` 行，放弃已过期的 `receiving` 行并写删除任务。
未过期的行可能仍属于另一副本上正在进行的上传，维护不会处理。

### `object_deletion_jobs`

BlobStore 与产品库 不能共享事务。Blob Abort/过期、Asset Upload 放弃和 Unit/Resource
永久删除时，先在同一产品库事务写通用删除 Outbox，再由后台 Worker 幂等删除对象并重试
失败任务。V3 已将旧 `blob_deletion_jobs` 泛化为本表。

## 权限与分享

### `node_grants`

Personal Space Node 的直接授权，角色为 `editor | viewer`。Grant 继承到当前和未来后代。
主键为 `(node_id, user_id)`。Trigger 阻止授权 Space Owner 或在 Team Space 写 Direct
Grant。

### `node_link_sharing`

Node 的链接分享策略，登录用户角色为 `editor | viewer`；匿名访客与未认领 agent 固定为 `viewer`。
策略同样按 Node 祖先链继承。
Trigger 限制它只用于 Personal Space。

V24 追加两列，当前版本只建列，没有读写入口：`unverified_role`（`editor | viewer`，默认 `viewer`）为匿名访客与
未认领 agent 的角色预留，Access Resolver 仍固定按 `viewer` 解析；`making_of_note`（可空）为作者自述的制作说明
预留。制作说明随分享一起写入，所以放在这张表：它与 Link Sharing 共用仅所有者可写、仅 Personal Space
和随 Node 级联删除的约束，长度上限留给写入它的 Service，调整上限不需要重建表。

匿名读取以保留 ID `workspace:anonymous` 进入 Access Resolver，只使用 Space 公开可读与 Link Sharing；
不创建 User、Login Session 或 Recent。匿名读取唯一的写入是上文 `agents` 的到期顺延。

登录用户的有效 Role 由 Access Resolver 每次按以下来源计算最高权限：

1. Space Owner；
2. Team Space Membership；
3. Node 或祖先的 Direct Grant；
4. Node 或祖先启用的 Link Sharing。

Space 所有者是暂停中的 agent 时，以上来源对所有者以外的人都不生效。

### `node_reports`

对一个 Node 的举报：`node_id`、可空的 `reporter_user_id`（空表示匿名举报）、`reason` 与 `created_at`。
举报随 Node 删除；举报人被删除时 `reporter_user_id` 置空，举报保留。`POST /api/nodes/:nodeId/reports`
是唯一写入口，只接受请求者可读的 Node。不保存来源 IP，它只用作限速的键。

已在 Trash 中的 Node/Resource 不可通过普通浏览或内容接口发现。Repository 不自行拼接
权限；产品 HTTP 与 Collaboration Endpoint 共用同一 Access Resolver。

## 最近访问

### `recent_resources`

主键为 `(user_id, resource_id)`，记录最后一次成功打开 Resource 的时间。仅内容 Open
成功后 Upsert；浏览 Node、失败打开、Worktree Preview 和 Link Sharing 本身不写入。

列表查询时 Join Resource 和 Node 获取当前名称与位置，因此 Rename/Move 后无需更新
Recent 行。

## 回收站

### `trash_batches`

记录一次以某个 Node 为根的 Trash 操作：

- `root_node_id` 是批次根；
- 该 Node 及当时未属于其他批次的后代写入相同 `nodes.trash_batch_id`；
- Restore 清空相应 Node 的批次 ID并写 `restored_at`；
- 永久删除先为后代 Blob 写删除 Outbox，再按后代顺序删除 Node；
- 活跃 Worktree 引用 Resource 时阻止永久删除。

删除根 Node 后 Trigger 删除对应批次记录。Node 的 Resource 不改变 Trash 边界。

## Worktree

### `worktrees`

User Worktree 必须是 Private 且没有 Team Space；Team Worktree 必须绑定 Team Space。
`processed_at` 标记已 Merge 或 Discard。

Team Worktree 可以由它的 Team Space 的任何 Space Member 创建，包括 Viewer；Space 公开读取时，`spaces.proposals` 接纳的非成员读者也可以。`creator_user_id` 是它唯一的作者。
`visibility` 在创建时由作者选择。Ready 时如果作者自己不能合并，即缺少某个 Unit 的编辑权限，服务把 `visibility`
写成 `space`，让有编辑权限的成员能看到并合并它。它保持 `ready` 且作者仍不能合并时，作者、Owner 和 Admin 都不能把它改回
`private`，要先 reopen。合并人记录在 `merge_worktree` Operation 的 `actor_user_id` 上，可以不是作者。
合并完成的 Team Worktree，即 `processed_at` 非空而协同服务报告 `merged`，读作 `space`：每个 Space Member 都能在列表和
Space activity 里看到它，能读到它全部 Unit 的成员可以 Review 它，Space 的非成员仍然看不到。这是读取时推导的，不改写
`visibility` 列，列里保留作者在它未结束时的选择。Discard 的 Worktree 保持原来的可见性。列表和实时推送的 SQL 把已处理的
私有 Team Worktree 交给每个成员作为候选，再由服务按协同服务的状态去掉 Discard 的那些。

`created_via`（V16，`TEXT`，可空）保存创建 Session 的 `write_source`，取值为 `browser` 或 `agent`；
`NULL` 表示未知，无默认值，不回填已有 Worktree。

`number`（V12，可空）是展示为 `#N` 的仓库级编号。Team Worktree 与同一 Team Space 的 Issue
共用一个递增序列（`MAX(issues.number, team worktrees.number) + 1`，在 `BEGIN IMMEDIATE` 事务内分配，
Issue 分配逻辑同样计入 Worktree）；User Worktree 在创建者名下单独编号，经创建者自己的 Personal Space 寻址。
部分唯一索引 `worktrees_team_number`、`worktrees_user_number` 兜底。V12 之前创建的 Worktree 为 `NULL`，不回填，
仍以 ID 寻址。Worktree 与 Issue 行只随 Space 级联删除，不会单独删除，因此编号不会复用。
User Worktree 在 `owner/personal` 下的归属用于编号与列表；该 Personal Space 的 Owner（创建者本人，以及认领了
创建者 agent 的人）可以发现、Review 并读取其 Worktree-local Unit，写操作仍只属于创建者。
创建在协同服务建立 Worktree 之后、同一产品事务内分配编号并插入产品行，幂等重试保留原编号。

`fork_id`（V28，`TEXT`，可空）指向它所属的 Fork，外键 `ON DELETE SET NULL`。CHECK 要求非空时 `kind = 'team'`，
部分唯一索引 `worktrees_open_fork`（`fork_id IS NOT NULL AND processed_at IS NULL`）保证一个 Fork 至多有一个未处理的
Worktree。只有 Fork 的写入路径（`POST /api/forks/{forkId}/units`、`POST /api/forks/{forkId}/worktree` 与 `PUT /api/forks/{forkId}/blob-resources/{resourceId}/content`）在创建 Worktree 时写入 `fork_id`，`POST /api/worktrees`
不接受它；`create_worktree` Operation 的 payload 记下 `forkId`，重试时沿用。插入事务先读这个 Fork 未处理的 Worktree，
已有一个时拒绝插入，部分唯一索引兜底。

`issue_id`（V30，`TEXT`，可空）指向这个 pull request 服务的 Issue，外键 `ON DELETE SET NULL`，CHECK 要求非空时
`kind = 'team'`，部分索引 `worktrees_issue`（`issue_id IS NOT NULL`）支撑 Issue 反查它的 pull request。
`POST /api/worktrees` 和 `PATCH /api/worktrees/{worktreeId}` 的 `issueNumber` 在 Worktree 自己的 Team Space 里按编号找 Issue，
所以链接只能落在同一 Team Space；`null` 去掉链接。能改 summary 的主体才能设置，并且要能读这个 Team Space，否则
`FORBIDDEN`；User Worktree 或找不到的编号是 `INVALID_INPUT`。`create_worktree` Operation 的 payload 记下
`issueNumber` 和解析出的 `issueId`，幂等重试比较 `issueNumber`，沿用 `issueId`。Worktree 视图读取时连表得到
`issue: {number, title, state}`，调用者不能读这个 Team Space 时为 `null`。Issue 视图的 `pullRequests` 按 `issue_id`
查询链接的 Worktree，只保留调用者能发现的那些，状态和合并人分别来自协同服务和 `merge_worktree` Operation，
按创建时间取最新 100 个。

### `forks`

Fork 是一个 User 对整个 Team Space（upstream）的命名视图，一行即全部：`id`、`owner_user_id`（外键 `users`，
`ON DELETE RESTRICT`）、`upstream_space_id`（外键 `spaces`，`ON DELETE CASCADE`）、`name` 与 `created_at`。
SQLite 中 `name` 为 `TEXT COLLATE NOCASE` 并以 `UNIQUE (owner_user_id, name)` 约束；PostgreSQL 以唯一索引
`forks_owner_name`（`owner_user_id, lower(name COLLATE "C")`）约束。`name` 与 Team Space slug 同格式、同名字空间，
`personal` 为保留字。创建 Fork 不复制任何 Node、Resource、Unit、Blob，也不写协同库；同一 owner 可以用不同名字多次
Fork 同一 upstream，同名同 upstream 的重复创建返回已有 Fork。

只有 Fork 的 owner 能列出、读取、按 `<owner>/<name>` 查找和删除它。创建要求调用者此刻能在 upstream 提议，即 upstream
的 owner、认领了 agent owner 的人、任意角色的 Space Member，或 upstream 公开读取时其 `proposals` 设置接纳的读者；
拒绝信息写明这个设置；未认领 agent 至多拥有 3 个 Fork（`AGENT_QUOTA_EXCEEDED`），
计数与插入在同一事务内。删除 Fork 只删除这一行，upstream 不变，曾指向它的 Worktree 由外键置 `fork_id = NULL`，
保留历史，成为 upstream 的普通 Team Worktree。

Fork 的状态每次读取时从其未处理的 Worktree 推导，不存储：

| 状态 | 未处理的 Worktree | 写入 |
| --- | --- | --- |
| `clean` | 没有，或 owner 读不到 | 先打开一个 Worktree，再加入 Unit |
| `drafting` | `draft` | 加入这个 Worktree |
| `proposed` | `ready` | 拒绝，409 `FORK_WORKTREE_NOT_DRAFT`；reopen 之后恢复 |
| `merging` | `merging`，或 Operation 中断、`processed_at` 仍为空的 `merged`/`discarded` | 拒绝，409 `FORK_WORKTREE_NOT_DRAFT` |

Fork 的第一次写入打开它的 Worktree：upstream 的私有 Team Worktree，作者是 Fork 的 owner，名字取 Fork 的名字。
打开与加入 Unit 共用请求的 `Idempotency-Key`：加入 Unit 的 Operation 用这个 key，打开 Worktree 的 Operation 用由 Fork ID
和 key 派生的 ID。Trunk 的 Resource 已经在 Worktree 里时直接返回，不再加入。两个并发的首次写入都看到 `clean` 时各自在
协同服务建立一个 Worktree，只有一个能插入产品行；另一个的 Operation 记为失败，写入重新读取 Fork、加入胜者的 Worktree。
代价是协同库里留下一个空的、没有产品行的 Worktree：协同服务没有删除接口，对已存在的 Worktree ID 再次创建会返回
`WORKTREE_ALREADY_EXISTS`，所以不能让并发的写入共用一个确定的 Worktree ID。Worktree 被 merge 或 discard 之后
Fork 回到 `clean`，下一次写入打开新的 Worktree。

### `worktree_units`

| 字段 | 语义 |
| --- | --- |
| `worktree_id`, `unit_id` | 复合主键 |
| `resource_id` | 稳定产品内容身份 |
| `source` | `trunk | worktree` |
| `ordinal` | Worktree 内顺序 |
| `added_at` | 加入时间；Trunk Unit 的 `freshness.addedAt` 取自这里 |

`freshness` 不落库。Worktree 处于 `draft` 或 `ready` 时，服务端在每次读取 Worktree 视图时
用协同服务的 `baselineTrunkRevision`、Trunk Unit 记录的 `headRevision` 和 `added_at` 现算：
落后距离为 `headRevision - baselineTrunkRevision`；落后超过 100 个修订或加入超过 7 天为 `stale`，
落后为零为 `current`，其余为 `behind`。阈值是服务端常量，标签只是提示，不拦截合入。

`resource_id` 对 Trunk Unit 只允许指向已有 Univer Resource；Blob 不作为 Unit 进入 Worktree，经 Fork 的替换是文件草稿。
对尚未激活的 Worktree-local Unit，它是预留 Resource ID，此时核心 `resources` 表中还没有
对应行。

### `worktree_node_intents`

仅 Worktree-local Unit 使用，保存激活时要创建的：

- 预留 `node_id`；
- 目标 Space 和 Parent Node；
- 名称与 Univer Unit Type；
- 创建者；
- Activated/Discarded 状态；
- 复制来源 `copied_from_node_id`（V24，可空，无外键）。

激活在一个产品事务中创建 Node、Resource、Univer Resource，并标记 Intent。它不接受
客户端指定 Node、Resource 或 Unit ID。

### `worktree_checks`

V32 新增。一行是一个 reporter 对一个 pull request 的一项检查在一份内容上的结论：

| 字段 | 语义 |
| --- | --- |
| `worktree_id` | 所属 Worktree，`ON DELETE CASCADE` |
| `content_key` | 服务端推导的内容键，见下文；客户端不能提交 |
| `name` | 检查名，1–40 个 `[a-z0-9-]` 字符 |
| `reporter_user_id` | 报告人，`ON DELETE RESTRICT` |
| `state` | `passed | failed` |
| `summary` | 查了什么、发现了什么，至多 1000 字符 |
| `reported_at` | 毫秒时间；同一结论重复报告不更新 |

主键 `(worktree_id, content_key, name, reporter_user_id)`：同一人对同一内容的同一检查只有一条，再次报告覆盖
`state` 与 `summary`，两者都没变时不写入。`content_key` 是 SHA-256，输入是每个 Unit 的 `(unitId, draftHeadRevision,
是否标记删除, Trunk head revision)`（按 unitId 排序）和排序后的待发布页面与文件草稿 ID。Trunk head 等于
`baselineTrunkRevision + revisionsBehind`，与 freshness 同源：一次报告读一次 `getWorktree`，每个 Trunk Unit 读一次
Trunk 记录（`trunkRevision`），与读 pull request 详情相同；草稿 ID 与声明的检查来自产品库和 BlobStore，不读协同服务。

只在 `ready` 时接受报告（否则 `409 CONFLICT`），需要 `review` 能力。Trunk 对其中 Unit 的编辑、改变内容的 reopen、
草稿增减或过期都会改变内容键，旧结论保留并显示，但不再 current。合入开始时，`merge_worktree` Operation 的 payload
记下当时的 `contentKey`；受限 agent 的合入在第二次判断后改记那次判断读的内容键。合入后的 pull request 以它判断 current；discard 后没有 current。一个内容键下最多 40 个检查名。

声明的检查来自 Team Space Trunk 根目录 `.agents/checks.md`（恰好一个 `.agents` 文件夹和其中恰好一个 `checks.md`
Blob），以读者自己的权限读取前 64 KiB。代码块外的 `## name` 标题里，名字合法的前 20 个按文件顺序成为声明的检查，
其它标题只是给 agent 的说明。每次读取都重新读文件，不在进程内缓存。结论计入（`counts`）当且仅当它 current，且报告人此刻
可以合入这个 pull request；声明的检查在有计入的 `failed` 时为 `failed`，否则有计入的 `passed` 时为 `passed`，否则为
`missing`。报告过但未声明的名字保留并显示，不要求。

#### 合入门槛（`spaces.landing = 'checks'`）

在 `landing` 为 `checks` 的 Team Space 里，不拥有它的 agent（含 admin）只有在每个声明的检查都是 `passed` 时才能合入，
否则 `capabilities.merge` 为 false，合入返回 `403 CHECKS_REQUIRED`，消息列出每个未通过检查的名字与状态。门槛由服务端
以 Space owner 的权限读取声明，与读者权限无关，并且比列表更严格：必须恰好一个 Trunk 根目录 `.agents` 文件夹、其中恰好
一个 `checks.md`，不在 Trash，Blob 为 `ready`、能读出、非空、不超过 64 KiB，代码块外每个二级标题都是不重复的合法检查名，
没有 BOM 和未闭合的代码块，名字 1–20 个。任何一条不满足都拒绝这个 agent 合入并说明原因；人仍可合入。同名兄弟按
ASCII 大小写折叠排序，读取从名字所在位置分页，最多读 10 页 100 个兄弟，超出视为无法判断而拒绝。

这样的 agent 也不能合入在 Trunk 的 `.agents` 文件夹里新增、修改或移除任何东西的 pull request，检查是否通过都一样，
消息点名 `.agents/`；人或拥有者 agent 才能合入它。判断和检查门槛在同一处、同样两次：pull request 的每个 Trunk Unit 的
Node、每个新文件的目标文件夹、每个待发布页面或文件草稿的目标（替换的文件或新页面的文件夹），只要祖先链的根是名为
`.agents` 的文件夹（`nodes.breadcrumbs`，按 Space owner 解析）就算；解析不到的替换目标也算。重命名和移动不经过
pull request，它们是直接写入，已经被拒绝。作者是这样的 agent 而 pull request 改 `.agents` 时，ready 后像作者不能合入的
pull request 一样共享给 Space，好让人看到并合入。

判断在两处各做一次，都用当时的内容键、Trunk head、待发布草稿和报告人的合入权限重新计算：请求进入时（拒绝发生在预留
Operation 之前，不占合入预算），以及 `merge_worktree` Operation 内、调用 SDK 合入之前。后一次还要求内容键与合入开始时
的内容（含当时固定的待发布草稿）一致，不一致就拒绝；通过后把它读的内容键写进 Operation payload，并把 Operation 的
`lease_expires_at` 续到一分钟后。后一次拒绝把 Operation 记为
`failed`、错误码 `CHECKS_REQUIRED`；`readBudget` 不把这种 Operation 计入 24 小时合入数，它的重试（`POST
/operations/{id}/retry` 或同一 Idempotency-Key 重放）重新经过门槛并重新占用预算。合入 Operation 没有自动恢复，所以
被拒绝的合入不会被无限重试。

第二次判断之后，受限 agent 自己的调用不能让合入落下别的内容，在任何副本上都一样。合入期间 Worktree 停在 ready，草稿不收
写入；产品的 `ready` 与 `reopen` 在同一 Worktree 有 `pending` 且租约未过期的 `merge_worktree` Operation 时返回
`409 CONFLICT`，这个事实存在产品数据库里，不在进程内。产品把第二次判断读到的每个 Unit 的草稿 head 与移除状态（`draftKey`）
作为服务端 `customData.checkedDraft` 交给 SDK 合入，Worktree 后端的 `mergeWorktree` 中间件在 SDK 把 Worktree 从
ready 改成 merging 之前重读一次，状态不是 ready 或草稿不同就拒绝，Operation 记为 `failed`、`409 CONFLICT`，什么都不合入。
剩下的窗口只在这个中间件的读取和 SDK 改成 merging 之间，而 ready 的 Worktree 在其中仍不收草稿写入；要穿过它，得有一个
`reopen` 在租约生效前通过产品检查、却晚到窗口里，再加一次编辑和一次 `ready`，都在一次 SDK 状态切换的时间内完成。租约
过期（合入卡住一分钟以上）后 `reopen` 不再被产品拒绝，但那时 SDK 已经是 merging，同样拒绝。窗口内能改 Trunk 的只有人、
拥有者 agent、评论类 changeset 和其它已通过门槛的合入，它们与本次合入按 OT 合并，结论不会因此被重新判定。

门槛不缓存，每次读 pull request 都重新计算，只对受限 agent 生效：一次判断多读一次请求者类别、至少两页 `listChildren`、
声明文件的 Node 与 Resource、最多 64 KiB 的 BlobStore 读取、检查结果行与待发布草稿，并为每个当前报告人求一次合入权限。
人和 `review` Space 不增加读取。列表只对原本可合入的 `checks` Space 行计算。

这样的 agent 不能用合入以外的方式改 Trunk。它打开 Trunk Unit 时，`GET /api/resources/{resourceId}/open` 与
pull request 的 `trunk` 打开方式都给 `editorMode: readOnly`（`trunkEditorMode`，与下面的拒绝读同一个
`landsByChecks`），所以 Browser 不显示 `Editable`。Collaboration 中间件在 `submitChangeset`、`applyChangeset` 与
`commitChangeset` 上拒绝它对 Trunk Unit 的非评论 changeset（`ResourceContentAccess.landsByChecks`，和权限一同读出，不多
一次查询），包括 HTML View 的实时编辑和 Revision 恢复；只有产品合入调用带服务端 `customData.merge` 标记的 changeset 才放行，
客户端设不了 `customData`，SDK 端点也拒绝客户端自称 `worktree-merge` 成员。产品写入在入口处调用
`assertChangesTrunk`：创建 Node、文件夹与 Unit（含 `create_resource` 重试与恢复，它的 `AGENT_NOT_ALLOWED` 不再重试）、
上传与完成上传、替换 Blob、重命名与移动、移入 Trash、从 Trash 恢复和永久删除、直接发布页面与 Skill 草稿，都返回
`403 AGENT_NOT_ALLOWED`。复制只能进 Personal Space 或 pull request，不会落到这个 Trunk。SDK 的
`DELETE /universer-api/snapshot/-/units` 与 `POST .../units/recover` 原本对任何登录用户删除或恢复任意 Unit，现在只接受
产品 API 的调用。

## Issues

Issue 只属于 Team Space，不保存 snapshot、changeset 或 revision。Team Worktree 可以用 `worktrees.issue_id`（V30）
指向它服务的 Issue，Issue 一侧不存链接。验收记录在 `issue_verdicts`（V31）。
所有写入都是单个 `BEGIN IMMEDIATE` 事务，不使用 Operation。权限从 Space 角色推导，不设 Issue 级 ACL；
个人空间的 Issue 接口返回 409。

### `issues`

| 字段 | 语义 |
| --- | --- |
| `id` | 随机主键 |
| `space_id`, `number` | 复合唯一；`number` 是 Space 内递增的 `#N`，在创建事务内取 Issue 与 Team Worktree 编号的最大值再加 1（二者共用序列）|
| `title`, `body` | 标题（1–256 字符）与 Markdown 正文（≤ 65 536 字符） |
| `state`, `state_reason` | `open` 时原因为空；`closed` 时为 `completed | not_planned`，由表级 CHECK 保证 |
| `author_user_id`, `closed_by_user_id`, `closed_at` | 作者与关闭信息；已关闭的 Issue 只在由验收期限关闭时 `closed_by_user_id` 为 `NULL` |
| `created_at`, `updated_at` | 评论、事件和关系变更都会刷新 `updated_at` |
| `created_via` | V16，可空 `TEXT`；复制创建 Session 的 `write_source`（`browser` 或 `agent`），`NULL` 表示未知；无默认值，不回填 |

V1 不允许删除 Issue，所以编号不会复用。以后加入删除，需要改用独立计数表。

### `issue_comments` 与 `issue_events`

评论保存作者、正文和时间；作者可编辑，作者、Owner、Admin 可硬删除。事件保存 `kind`
（`closed | reopened | renamed | labeled | unlabeled | assigned | unassigned | node_referenced | node_unreferenced`）
和 `payload_json` 快照（标签名与颜色键、用户名、Node 名称），标签被删除或文件被改名后历史仍可读。
时间线按 `(created_at, 评论、事件、Verdict, id)` 合并三张表，用 keyset 分页；Verdict 以同名 `kind` 的事件出现，
`payload` 只有 `body`。

### `issue_verdicts`

V31 新增。Verdict 是 Issue 验收流程中的一条只追加记录，Issue 的验收状态（`acceptance`）就是最新一条：

| 字段 | 语义 |
| --- | --- |
| `id` | 随机主键 |
| `issue_id` | 所属 Issue，`ON DELETE CASCADE` |
| `kind` | `submitted | accepted | sent_back | reverted`；`reverted` 只由撤回 Operation 写入 |
| `actor_user_id` | 给出 Verdict 的 User；CHECK 只允许 `accepted` 为 `NULL`，只有期限验收写 `NULL` |
| `body` | Markdown；`submitted` 是做了什么、查了什么、假设了什么，`sent_back` 是退回原因，`accepted` 可为空 |
| `operation_id` | CHECK 只允许 `reverted` 非空；`reverted` 记写入它的 `revert_worktrees` Operation，同一 Operation 至多写一条 |
| `created_at` | 毫秒时间；同一 Issue 内每条都晚于上一条 |

索引 `issue_verdicts_issue(issue_id, created_at, id)` 读最新一条。状态由最新 Verdict 与 `issues.state` 推导：
开放的 Issue 没有 Verdict 或最新为 `sent_back` 时，任一 Assignee（任何成员角色）可 `submitted`，`body` 必填；
最新为 `submitted` 时，能关闭它的人（作者或有 `triageIssues` 能力，包括被指派的 agent）可 `accepted`，或带必填 `body`
`sent_back`。`accepted` 在同一事务里走已有关闭路径，以 `completed` 关闭 Issue，写 `closed` 事件，活动流照旧显示
`issue-closed`。已关闭的 Issue 拒绝 Verdict（`409 ISSUE_CLOSED`），重复提交返回 `409 ISSUE_ALREADY_SUBMITTED`，
未提交时验收或退回返回 `409 ISSUE_NOT_SUBMITTED`，无权返回 `403 FORBIDDEN`。与最新一条同 `kind`、同 actor、同
`body` 的请求，只要 Issue 仍是那条 Verdict 留下的状态（`accepted` 是以 `completed` 关闭，其余是开放），就不写入，
直接返回当前 Issue；否则按上面的规则处理，例如验收后重新打开的 Issue 再收到同样的验收返回 `409 ISSUE_NOT_SUBMITTED`。
每条 Verdict 都更新 `issues` 行，PostgreSQL 的 SERIALIZABLE 事务因此让并发 Verdict 冲突并重试，重试读到胜者：
两个并发验收只关闭一次、只记一条。

期限验收由每个副本的 `server/src/jobs/issue-acceptance.ts` 每分钟执行一轮，每轮最多验收 25 个 Issue。期限是最新
`submitted` 的 `created_at` 与最后一条 `reopened` 事件的 `created_at` 中较晚者加上 `accept_after_hours` 小时，
只对开放、最新 Verdict 是 `submitted`、所在 Space 的 `accept_after_hours` 非空且 owner 未被暂停的 Issue 存在。两个
repository 各用一条 SQL 计算它：任务用它找到期的 Issue，Issue 详情用它返回 `acceptance.deadline`，所以页面、uvw 与
MCP 显示的时间就是任务使用的时间。任务按随机顺序取至多 100 个（25 的 4 倍）期限不晚于本副本当前时间的 Issue，逐个在一个事务里重新确认
同一条件，然后写一条 `actor_user_id`
为 `NULL`、`body` 为空的 `accepted`，并以 `completed` 关闭 Issue，`closed_by_user_id` 为 `NULL`。它不写 `closed`
事件：时间线里这条无 actor 的 `accepted` 就是关闭记录，活动流显示 actor 为 `null` 的 `issue-closed`。退回让最新一条
不再是 `submitted`，计时停止；再次提交从新的 `created_at` 重新计时；提交后被关闭再重新打开的 Issue 从重新打开时
重新计时；关闭设置后不再验收；开启设置或调小小时数后，已超过新期限的 Issue 在下一轮被验收。某个 Issue 的事务失败只记日志，
不中止本轮，也不占用 25 个的名额：任务越过它继续验收同一批里的下一个。每轮只取一次，至多尝试 100 个 Issue，取出的顺序
每轮不同，所以持续失败的 Issue 再多也挡不住其他 Issue，只是让它们晚几轮。验收过的 Issue 所在的 Space 在本轮结束时收到变更通知。期限按副本的系统时钟比较，
副本之间的时钟偏差使验收提前或推迟同样的量；以小时计的期限下，秒级偏差可以忽略。多个副本同时执行时，事务内的重新
确认和对 `issues` 行的更新让 PostgreSQL 只放行一个，另一个重试后不再匹配：每个 Issue 只记一条验收、只关闭一次。

### `issue_labels` 与 `issue_label_links`

标签属于 Space，名称在 Space 内大小写不敏感唯一。`color` 保存调色板键（`gray | blue | green | yellow | orange | red | purple | pink`），
只在服务层校验，调整调色板不需要迁移。每个 Space 最多 100 个标签，每个 Issue 最多 20 个。删除标签会级联移除关联。

### `issue_assignees` 与 `issue_node_refs`

Assignee 指派时必须是 Space Owner 或成员，最多 10 人；成员离开 Space 后已有指派保留。
指派时间取这个用户最新一条 `assigned` 事件（`issue_events.payload_json` 的 `userId`），不另存。
`GET /api/spaces/{spaceId}/issues/{number}/access-changes` 用它筛出每个 Assignee 指派之后的访问变化，只读当前行，
不是历史：`space_members` 中 `granted_by` 是这个 Assignee、`updated_at` 晚于指派的行（之后别人重新授权会覆盖
`granted_by`，这一行随之消失）；它自己 Personal Space 里 `node_link_sharing` 由它创建或最后修改、`node_grants`
由它最后授予，且时间晚于指派的行。Personal Space 的行只返回给这个 Assignee 和认领它的用户（`agents.owner_user_id`）。
引用 Node 指派时必须在同一 Space 且不在回收站，最多 20 个；Node 被永久删除时引用级联删除，
Node 在回收站时读取侧显示为不可用且不返回名称。

## Operations

`operations` 是跨产品数据库与 Collaboration 服务操作的幂等日志。支持：

```text
create_resource
create_blob_resource
replace_blob_content
create_worktree
add_worktree_unit
create_worktree_unit
merge_worktree
discard_worktree
activate_worktree_resource
copy_node
revert_worktrees
```

状态为 `pending | completed | failed`。`payload_json` 在首次请求时固化服务器生成的稳定
Node/Resource/Unit ID；相同 Idempotency Key 只能重放相同意图。Lease、Attempt、
`next_attempt_at` 和最后错误字段支持后台恢复。

agent 的预算不另存计数，在预留 Operation 或把失败的 Operation 放回 `pending` 的事务里从现有行读出：未结束的 Worktree 是 `creator_user_id` 为它、
`processed_at` 为空的 `worktrees` 行，加上 payload 的 `worktreeId` 还没有 Worktree 行的 `pending` `create_worktree`
Operation，至多 10 个；合入是 `actor_user_id` 为它、最近 24 小时创建的 `merge_worktree` Operation，至多 50 次，
不含检查门槛拒绝的（`failed` 且 `last_error_code = 'CHECKS_REQUIRED'`），重试这样的合入时重新计入。两项都走 `operations_actor` 与 `worktrees_creator` 索引，超出时返回 `AGENT_QUOTA_EXCEEDED`。人不受限制，也不计数。

V3 Operation JSON 只使用明确的 Node/Resource/Unit 或 Blob 上传身份，不读取旧
`entryId`、`fileId` 或 `fileEntryId`。

## 创建与修改事务

### 创建纯组织 Node

`POST /api/nodes` 校验目标 Space/Parent 的 Create Children Capability 后，只写一条
Node。

### 创建 Univer Resource

`POST /api/resources`：

1. 按 Idempotency Key 预留 Node ID、Resource ID 和 Unit ID；
2. 创建 Collaboration Unit；
3. 在一个产品事务中写 Node、Resource、Univer Resource并完成 Operation；
4. 失败时按错误是否可重试保留 Pending 或 Failed 状态。

### 创建 Blob Resource

1. `POST /api/blob-upload-sessions` 按 Idempotency Key 预留 Session、Node、Resource 和 Object ID；
2. `PUT .../content` 流式写入 BlobStore，同时校验长度、计算 Hash 并检测 MIME；
3. `POST .../complete` 校验对象后，在单个产品库事务中发布 Node/Resource；
4. `content` 与 `download` 都重新解析 Node 权限并支持单段 Byte Range。

### 替换 Blob 内容

`PUT /api/blob-resources/{resourceId}/content` 保留 Resource、Node、原始文件名、目录与 ACL。
必需 `If-Match`（单个带引号强 ETag）、`Content-Length` 和 `Idempotency-Key`。
先持久化 `replace_blob_content` Operation（目标、预期 ETag、长度、新 Object Key），再写新对象。
上传结束后重新校验编辑权限，并在产品事务中比较旧 ETag、切换对象与内容元数据、生成随机新 ETag、
完成 Operation，同时写入 `blob_content_replaced` 删除任务。内容相同也生成新 ETag；SHA-256
仍表示字节校验值。版本不匹配返回 412，旧对象与旧内容保留。
失败请求标记 Failed，并写 `blob_upload_abandoned` 删除任务。接收字节的请求每 10 秒续期 Pending
Operation 的 `updated_at`；任一副本的后台维护把超过 60 秒未续期的 Pending 替换按同样方式收敛为
`REPLACEMENT_INTERRUPTED`。完成事务只在 Operation 仍为 Pending 时切换对象，因此续期中断后才写完的字节
不会被发布；该请求失败时会为新对象再写一次删除任务。Completed Key 只回放记录结果，不重复写入；Pending 不可并发重入，Failed
必须用新 Key 重试。Operation 查询用于确认未知结果。Blob 不作为 Unit 进入 Worktree，也不保存历史版本；
经 Fork 替换 Blob 是挂在 Worktree 上的文件草稿，见「HTML View 草稿」的「文件草稿」。

### 创建与读取 Univer Asset

1. `CollaborationImageIoService` 向 Trunk 或 Worktree File API 提交 `source=3`、`assign=unitID`
   和 Multipart `file`；
2. 服务端重新验证 Unit 的编辑权限，流式写入注入的 `BlobStore`，并以服务端字节检测结果为准；
3. Snapshot 只写返回的 `FileId`；
4. 读取先由 `sign-url` 返回同域 `/content` 地址；每次 Content 请求重新验证当前 Unit/Worktree
   权限，使用 `private, no-store` 并支持单段 Byte Range；
5. Worktree Merge 只把成功合入或未变化 Unit 的 Asset 发布到 Trunk。

### 复制文件

`POST /api/nodes/{nodeId}/copies` 把请求者能打开的 Sheet、Doc、Slide 或 Blob 文件复制成请求者自己的新文件。
目标是请求者 Personal Space 的根级，或请求者可添加 Unit 的草稿 PR。Blob 不进入 Worktree，只能复制到 Personal Space。
来源不可读时与读取该 Node 一样返回 404。

1. 校验来源、目标和创建上限后，按 Idempotency Key 预留 `copy_node` Operation。`payload_json` 只固化来源 Node、目标、
   新的 Node/Resource/Unit/Asset ID、对象 Key 与对象元数据，以及预留时来源 Unit 的 Revision，不保存 Unit 内容；
2. `reserved`：把来源 Blob 对象或来源 Unit 引用的 Asset 对象复制到新的 Object Key，并校验 SHA-256；
3. `objects_copied`：按预留时固定的 Revision 重新读取来源 Unit，把内容中的 Unit ID 和 Asset ID 换成新 ID，
   在 Trunk 或目标 Worktree 创建新 Unit。Blob 没有这一步；
4. `unit_created`：一个产品事务发布结果。目标为 Personal Space 时写 Node、Resource、类型扩展行、Asset 行和
   `nodes.copied_from_node_id`；目标为草稿 PR 时写 `worktree_units`、带 `copied_from_node_id` 的
   `worktree_node_intents` 和 Worktree Asset 行，PR 合入激活 Node 时再写入来源。

每一步都可重复执行：对象写入同一 Key，重复创建同一 Unit 视为成功。请求中断后，后台恢复领取 Lease 到期的 Pending
复制继续执行。可重试错误按指数退避最多尝试 5 次。不可重试或超过次数时进入 `abandoning`：硬删除已创建的 Trunk Unit
（Collaboration SDK 不提供删除草稿 Unit 的接口，草稿 PR 内的 Unit 改为标记移除），把已复制的对象写入
`object_deletion_jobs`，Operation 标记 Failed。Failed 的复制不接受 Operation Retry，须用新的 Idempotency Key 重新复制。
相同 Key 且相同意图回放结果，不同意图返回 409。

副本只记录来源 Node ID，不复制权限、分享设置、评论和历史版本。来源 Unit 引用了其它 Unit 的 Asset 时，只复制请求者
能打开的那些 Unit 的 Asset。复制完成后副本与来源互不影响：来源关闭分享、进入回收站或被永久删除，副本及其图片照常可读；
来源被永久删除时 `copied_from_node_id` 置 `NULL`。HTML View 是 Blob，复制只复制页面字节：副本页面仍绑定来源页面引用的 Sheet，
读者能打开这些 Sheet 时才显示数据。未认领 Agent 的单文件大小上限按一次复制的全部 Asset 字节之和计算，
文件数上限把 Pending 的复制计入。

### 撤回已合入的 pull request

`GET /api/worktrees/{id}/revert` 和 `GET /api/spaces/{id}/issues/{n}/revert` 只读出计划；同一路径的 `POST` 执行。
一组是一个已合入的 pull request，或一个 Issue 关联的全部已合入 pull request。计划只用服务端事实：每个 Worktree
Unit 的 `mergeResult.trunkRevision`、Trunk 的 changeset 记录和修订、Worktree 的移除批次与 Trash 批次。

| 合入做了什么 | 撤回做什么 | 什么时候做不了 |
| --- | --- | --- |
| 改了 Trunk Unit | 提交一个只含 `RevertRevisionMutation` 的 Trunk changeset，恢复到这组第一次合入它之前的修订 | 那次合入之后有一个修订不是这组自己的合入：`blocked`，列出作者、次数和最后时间 |
| 新增文件或页面 | 把 Node 移入 Trash | 已在 Trash，或撤回者不能移入 Trash |
| 移除文件 | 恢复合入时的 Trash 批次 | 批次已被永久删除 |
| 替换页面或文件 | 不做，列为 `unavailable` | 旧版本字节已删除 |

能合入这个 pull request 的人（Issue 时是能验收它的人）可以撤回，还要能编辑每个要恢复的 Unit；恢复仍经过 Trunk 中间件，
受内容保护约束。`landing` 为 `checks` 的 Team Space 里，不拥有它的 agent 被拒绝（`AGENT_NOT_ALLOWED`）。只有在 Browser
登录的人可以逐个 Unit 强制覆盖 `blocked` 的 Unit，并带上计划显示的 `headRevision`；之后又有人改过，它仍是 `blocked`。

1. 校验后按 Idempotency Key 预留 `revert_worktrees` Operation，`payload_json` 固化范围、强制列表和每一项的计划，
   Lease 归本次执行者；
2. 依次从 Trash 恢复、恢复 Unit、移入 Trash。每个恢复在提交前先把 `sid`（由 Operation ID 推出）、`reqId`、`baseRev`
   和目标修订写进 `payload_json`；
3. 恢复只在 Trunk 最新修订上提交。基线过期时重读最新修订，没有别人的新修改就换下一个 `reqId` 再试；出现别人的修改时
   这一项停为 `blocked`；
4. 每一项的结果都写回 `payload_json`，每次写都比对 `lease_owner`，Lease 被别的副本接手后旧执行者停止且不再写；
5. Issue 范围写一条 `reverted` Verdict（以 `operation_id` 去重），Issue 已关闭时重新打开并写 `reopened` 事件；
   然后标记 Completed，`result_json` 是每一项的结果。

崩溃或 Lease 过期后，后台恢复领取 Pending 的撤回继续执行：已保存的恢复先原样重发，SDK 以 `(unit, sid, reqId)` 去重，
所以同一项不会恢复两次。可重试错误按指数退避最多尝试 5 次，之后 Failed，可用 Operation Retry 重新开始。撤回恢复整个
Unit，不撤回评论和历史；历史里同时留着合入和恢复。

### Rename 与 Move

Rename 只更新 `nodes.name`。Move 只更新 `nodes.parent_id`；目标必须同 Space、有创建
权限且不在 Source 的后代链中。Resource 和 Unit ID 均保持不变。

## 一次性自动迁移边界

临时迁移入口位于 `server/src/db/sqlite/migrations/`，V0 读取器隔离在 `legacy-v0/`，业务模块不导入
它们。应用打开磁盘数据库时：

1. 不存在或空文件：创建 V34，不备份；
2. 完整 V34：校验指纹后正常启动，不重复备份；
3. 完整 V33/V32/V31/V30/V29/V28/V27/V26/V25/V24/V23/V22/V21/V20/V19/V18/V17/V16/V15/V14/V13/V12/V11/V10/V9/V8/V7/V6/V5：先生成一致性备份，再迁移到 V34；V6 保留已有公开读取策略，V5 的旧 Space 默认关闭公开读取；
4. 完整 V4/V3/V2/V1：备份后逐版本迁移到 V34；
5. 完整 V0：先生成一致性备份，再直接迁移到 V34；
6. 未知版本、部分 Schema、完整性错误或不一致业务状态：拒绝启动。

迁移器还识别合并前 Discord 开发分支产生的 V4 变体：若 Asset Upload 仍含
`detected_media_type`，先执行正式 V3 → V4 Asset 迁移，再执行 V4 → V5 Identity 迁移。
该兼容路径同样会先创建并验证 V4 一致性备份。

每个版本迁移步骤都在独立的 `BEGIN IMMEDIATE` 事务中完成，保留原 Node、Unit、User、Space、Trash Batch、
Worktree 和 Operation ID，为现有内容生成新的 Resource ID，并类型化重写所有已完成
Operation JSON。V0 迁移前要求没有 Pending/Failed Operation；后续版本保留未完成恢复状态。

提交前后校验：

- 表数量映射；
- Resource/Univer 扩展一一对应；
- 权限、Recent、Trash 与 Worktree 映射；
- Node 父链无环；
- `foreign_key_check` 无记录；
- `integrity_check = ok`；
- V2 删除任务完整映射到通用 Outbox；
- V3 Asset Upload 的内容检测字段被无损移除；声明 MIME 缺失时用旧检测值回填；
- V4 External Identity 被无损扩展为支持 Discord Provider；
- V12 External Identity 被无损扩展为支持 Google Provider；
- V13 → V14 只新增 `users.email`、`users_email` 部分唯一索引与 `email_login_codes`；既有 User 的 `email` 为 `NULL`，其它行不变；
- V14 → V15 新增 `space_pins` 和 `space_stars_user` 索引；既有行、Blob 身份与恢复状态不变；
- V15 → V16 仅新增可空的 `login_sessions.write_source`、`worktrees.created_via` 和 `issues.created_via`，CHECK 允许 `browser` 或 `agent`；已有行均为 `NULL`，无默认值、回填或新索引；
- V16 → V17 重建 `univer_resources` 与 `worktree_node_intents`，`unit_type` CHECK 增加 `pdf`；既有行、`univer_resources_kind_guard` 触发器、入向外键、Blob 身份与恢复状态不变；
- V17 → V18 新增 `oauth_clients`、`oauth_grants`、`oauth_refresh_history`、`personal_access_tokens`、各自索引，以及 `login_sessions.issued_for_pat_id`、`issued_for_grant_id` 两个可空列和两个部分索引；既有 Session 行、有效期与其它行不变，无需重建任何表；
- V21 → V22 不改结构，只改写含邮箱地址、误导字符或没有可见字符的 `users.display_name` 与仍为默认名的 Personal Space 名；
- V22 → V23 只新增空的 `executor_access` 表，既有行不变；
- V23 → V24 追加复制来源与 Link Sharing 预留列，并重建 `operations` 使 `kind` CHECK 接受 `copy_node`；
- V24 → V25 不改结构，以 V22 的同一修复再改写一次显示名与默认名 Personal Space，收敛执行过早期 V22 规则的库；
- 旧表全部删除且 `user_version = 25`。

失败步骤会回滚且应用不启动；V1/V2 链式升级可能已提交有效的中间版本，但启动前生成的
一致性备份始终保留，下一次启动可继续升级或由运维恢复。错误中会给出备份路径。
迁移实现是唯一兼容边界；线上数据库全部完成升级后，可以删除 `migrations/`、
`legacy-v0/` 及初始化函数中的一次调用，不影响 V25 Schema 或业务代码。

V6 → V7 只重建 Operation 和删除任务表以扩展 CHECK 枚举，完整保留所有行和恢复字段；
Blob 及上传会话表不变。升级前自动创建一致性备份；停旧实例后由单个新实例完成迁移。

## Unit 内容编辑保护（V8）

`content_permission_objects` 保存随机权限 ID、所属 Unit、SDK 对象类型、创建者、名称、
动作策略、查看范围和编辑范围；`content_permission_collaborators` 保存显式协作者与角色。
它们属于产品授权数据，不保存范围坐标、文档内容、snapshot、changeset 或 revision。
保护目标与权限 ID 的绑定仍由 SDK mutation 和协同存储管理。

先提交产品 ACL，再提交协同绑定；两者没有跨库事务。未绑定和解绑后的 ACL 保留，允许重试、
撤销与历史引用；不在普通请求中清理。永久删除 Resource 时按 Unit 外键级联删除。
回收站、移动、重命名不改变权限 ID。创建者必须是已存在 User；失去文件编辑权限后也失去管理权。
Owner/Admin 以当前产品角色接管管理，`cfgEnableObjInherit` 为 true。`read_scope` 与 `edit_scope`
分别保存协议里的查看和编辑范围。编辑范围为 `OneSelf` 时，非 Owner 只在查看范围为所有协作者时保留 View。
查看范围不是所有协作者时，能打开文件的人不再因此获得 View；显式协作者仍按角色判断。
复制、打印、导出服从对象 strategies，缺省时 Copy 为 Reader、Print 和 Export 为 Editor。
Snapshot、history 和 export 接口不按对象范围过滤，不构成内容保密。

V7 → V8 在单个事务内新增两表及索引，不删除或改写旧字段、业务行、Blob 身份或恢复状态。
启动前备份，校验 V7/V8 指纹、外键及完整性；失败回滚至 V7。已有未完成 Operation 可以保留。
回滚应用版本须停新实例并恢复迁移前备份，不可让旧进程继续写 V8 文件。

V8 → V9 在单个事务内新增 Issue 相关的七张表及索引，不删除或改写旧字段、业务行、Blob 身份或恢复状态。
启动前备份，校验 V8/V9 指纹、外键及完整性；失败回滚至 V8。已有未完成 Operation 可以保留。
回滚应用版本须停新实例并恢复迁移前备份，不可让旧进程继续写 V9 文件。

V9 → V10 在单个事务内仅新增 `space_stars`，不改写已有业务表和行；已有收藏初始为空。
准备阶段在业务 Repository 初始化前校验 V9 指纹、生成并验证一致性备份；事务提交前检查外键与完整性，
然后校验 V10 指纹。失败事务回滚至 V9，备份保留且启动失败。重复启动不重复迁移或备份。
部署须先停全部旧实例，由单个 V10 实例完成迁移和健康检查后恢复服务；回退须停新实例并恢复 V9 备份。

V10 → V11 在单个事务内仅为 `spaces` 增加 `description TEXT NOT NULL DEFAULT ''`，已有 Space 取空字符串，
不改写其他列、表或行。准备阶段在业务 Repository 初始化前校验 V10 指纹、生成并验证一致性备份；
事务提交前检查外键与完整性，然后校验 V11 指纹（`spaces` 列顺序为 `…public_read, description`）。
旧版本链路沿用各自的 `spaces` 列集合校验，因此 V1–V9 升级后同样落到 V11。失败事务回滚至 V10，备份保留且启动失败。
重复启动不重复迁移或备份。部署须先停全部旧实例，由单个 V11 实例完成迁移和健康检查后恢复服务；
回退须停新实例并恢复 V10 备份。

V11 → V12 在单个事务内仅新增 `spaces.slug`（`TEXT COLLATE NOCASE`）、`worktrees.number`、三个部分唯一索引
（`spaces_owner_slug`、`worktrees_team_number`、`worktrees_user_number`）和两个 slug Trigger，不改写任何已有行：
旧 Team Space 的 `slug` 与旧 Worktree 的 `number` 均为 `NULL`。准备阶段在业务 Repository 初始化前校验 V11 指纹、
生成并验证一致性备份；事务提交前检查外键与完整性，然后校验 V12 指纹。失败事务回滚至 V11，备份保留且启动失败。
重复启动不重复迁移或备份。部署须先停全部旧实例，由单个 V12 实例完成迁移和健康检查后恢复服务；
回退须停新实例并恢复 V11 备份。

V12 → V13 只重建 `external_identities`，把 Provider CHECK 从 `('github', 'discord')` 扩展为
`('github', 'google', 'discord')`；SQLite 不能原地修改 CHECK，因此迁移在同一事务内外键关闭后重命名旧表、
创建新表并按原值复制，再逐行比对新旧 External Identity，确认列、约束和行完全保留。准备阶段在业务 Repository
初始化前校验 V12 指纹、生成并验证一致性备份；事务提交前重新开启外键，检查 `foreign_key_check` 与
`integrity_check`，然后校验 V13 指纹。V1–V11 的升级链与 V0 迁移都继续前进到 V30。失败事务回滚至 V12，备份保留且
启动失败。重复启动不重复迁移或备份。部署须先停全部旧实例，由单个 V13 实例完成迁移和健康检查后恢复服务；
回退须停新实例并恢复 V12 备份。

V14 → V15 在单个事务内新增 `space_pins` 和 `space_stars_user` 索引，不改写已有表、业务行、Blob 身份或恢复状态。
准备阶段在业务 Repository 初始化前校验 V14 指纹，生成并验证一致性备份；事务提交前检查外键与完整性，
随后校验 V15 指纹。V0 与所有旧版本升级链都落到 V30。失败事务回滚至 V14，备份保留，启动失败。
重复启动不重复迁移或备份。部署先停止全部旧实例，由单个 V15 实例完成迁移和健康检查后恢复服务；
回退先停止新实例，再恢复 V14 备份，不允许新旧版本同时写同一 SQLite 文件。

V15 → V16 在单个 `BEGIN IMMEDIATE` 事务内新增上述三个来源列，保留全部已有行、Blob 身份与恢复状态。
准备阶段先校验 V15 指纹，生成并验证 `.v15-backup-…sqlite` 一致性备份；事务提交前检查外键与完整性，
随后校验 V16 指纹。失败事务回滚至 V15，备份保留且启动失败；成功后重复启动不重复迁移或备份。
部署先停止全部旧实例，由单个 V16 实例完成迁移和健康检查后恢复服务；回退先停止新实例，再恢复 V15 备份。
不得让 V15 与 V16 进程同时写同一 SQLite 文件。

V16 → V17 允许 `univer_resources` 与 `worktree_node_intents` 的 `unit_type` 取 `pdf`。SQLite 不能修改 CHECK，
两张表在同一事务内以临时名重建、复制全部行后改名回原名（`legacy_alter_table` 下执行，保持其它表触发器
对 `univer_resources` 的名称引用），并重建 `univer_resources_kind_guard` 触发器；`content_permission_objects`
的入向外键、Blob 身份与恢复状态不变。准备阶段先校验 V16 指纹，生成并验证 `.v16-backup-…sqlite` 一致性备份；
事务提交前比对行数、检查外键与完整性，随后校验 V17 指纹。失败事务回滚至 V16，备份保留且启动失败；
成功后重复启动不重复迁移或备份。部署先停止全部旧实例，由单个 V17 实例完成迁移和健康检查后恢复服务；
回退先停止新实例，再恢复 V16 备份。不得让 V16 与 V17 进程同时写同一 SQLite 文件。

V17 → V18 为 MCP 的 OAuth 与 PAT 提供存储：新增上述四张表，并以 `ALTER TABLE ... ADD COLUMN` 向 `login_sessions`
追加两个可空列（SQLite 允许默认为 `NULL` 的新列带 `REFERENCES` 与列级 CHECK），不重建任何表。准备阶段先校验 V17 指纹，
生成并验证 `.v17-backup-…sqlite` 一致性备份；事务内比对 Session 行、检查外键与完整性，随后校验 V18 指纹。
失败事务回滚至 V17，备份保留且启动失败；成功后重复启动不重复迁移或备份。部署先停止全部旧实例，
由单个 V18 实例完成迁移和健康检查后恢复服务；回退先停止新实例，再恢复 V17 备份。
不得让 V17 与 V18 进程同时写同一 SQLite 文件。

## HTML View 草稿（V19）

`html_view_drafts` 保存作者、作者范围的 Idempotency-Key、create/replace 目标、基础 ETag、
对象 key、字节数、SHA-256、状态、期限及发布结果，不保存 HTML 字节。目标没有外键，草稿不阻止
目标删除。`receiving` 最长一小时，可同键重试；收完后为 `pending`，有效七天。作者可读；关联来源 Worktree 的草稿，
能评审该 Worktree（`capabilities.review`）的人也可读取草稿和内容，其他人得到 404。手动 publish 或 reject 只能由作者的交互式 Session 发起。终态为 `published`、`rejected`、`expired`、
`conflicted`、`superseded`。读取派生过期、ETag 冲突和来源 PR 被丢弃的冲突，发布或维护任务持久化终态。

发布在单个产品库事务中把草稿 object key 交给 Blob Resource，不复制字节、不创建 Operation。
替换复用 Blob 交换逻辑，旧对象进入 `blob_content_replaced` 删除任务；拒绝、过期、冲突把草稿
对象交给 `blob_upload_abandoned` 删除任务。同一 key 只属于接收中或待决草稿、已发布 Blob 或删除
任务之一。终态行保留为幂等 tombstone，不设置保留期限。每个 Worktree 最多关联 20 份 pending 且未过期的草稿，
第 21 份返回 409，修订替换前一份不占新名额；终态行不计数。

V18→V19 只新增草稿表和到期索引，沿用一致性备份、事务回滚、指纹、外键与完整性检查；
现存产品行、对象 key 和恢复状态保持原样。

V26 追加可空 `source_worktree_id`，旧草稿为 NULL。它与目标一样不设外键，参与提交的幂等意图比较。
提交 create 或 replace 草稿时，作者必须能评审来源 Worktree，且来源未被丢弃；已合并的来源仍可接受。
目标权限按来源区分：来源是 Team Worktree、作者对它有 `editDraft`、目标在它的 Team Space 内时，作者像提议 Unit 一样提议页面，
replace 只需要目标的 `openContent`，create 只需要能看到目的地；其他情况 replace 需要 `editContent`，create 需要目的地的创建权限。
来源 Worktree 或被修订草稿的来源处于 `ready` 或 `merging` 时，新建和修订返回 409，重新打开后才能修改，作者仍可 reject。
这项检查与 mark ready 之间没有锁：一份草稿在检查时来源还是 `draft`，之后才变为 `pending`，就可能挂在已 ready 的 Worktree 上，
多副本部署时不能排除。合并只发布开始时固定的草稿集合，所以这样的草稿不会被合并发布。
提交时页面绑定的每个 Unit 必须在来源 Worktree 中，或作者对它有 `openContent`，否则返回 403，不区分 Unit 不存在和无权读取。
来源未合并时手动发布返回 409 并标明 PR 编号，丢弃后 pending 草稿读取为 `conflicted`，发布拒绝。
`pendingPageDrafts` 统计关联该 Worktree 的 pending 且未过期草稿，不按草稿作者过滤，所有可见摘要者都能读取计数。
`GET /api/worktrees/{worktreeId}/html-view-drafts` 向能评审该 Worktree 的人列出关联草稿，不按作者过滤，包含终态，
不含 `receiving` 和 `superseded`，每份带 `author`；其他人得到 404。这个查询不走只覆盖 pending 行的部分索引。
Browser 预览别人写的草稿时只读，只加载页面声明的 Unit，包括其中 Sheet 引用的其他 Unit，页面请求其他 Unit 时拒绝并提示。
发布后的页面不受这个限制，访问者能读的未声明 Unit 仍可被页面脚本请求。

合并开始时读取一次关联的 pending 且未过期的草稿，把它们的 ID 排序后作为 `pageDraftIds` 写进 merge Operation 的
`payload_json`。合并者的页面目标权限检查、foreign 检查和发布都只看这个集合，重放和 Operation 重试沿用已存的集合。
每次合并都在 merge Operation 完成后调用草稿模块，以合并者身份发布集合里仍为 pending 的草稿，`decided_by` 记合并者，create 新建的 Node 和 Resource 的 `created_by` 仍是草稿作者。合并者的目标权限、配额和 ETag
在发布事务里检查；ETag 不一致时只有这一页变为 `conflicted`，Sheet 照常合入。单份失败只记录日志，不影响合并，
过期、配额或权限失败保持原行状态，作者之后可以手动发布。合并权包含页面目标：合并者必须能写每份待发布草稿的目标，
否则 `capabilities.merge` 为 false，合并返回 403。草稿作者自己写不了目标时，该草稿是 foreign：只有人在 Browser 里
（`writeSource` 为 browser、不是 token-issued 的 Session，主体是人）带着 `pageDraftIds` 才能合并，或者重试这样开始的 Operation。
CLI、PAT、OAuth 合并，以及不带 `pageDraftIds` 的 Browser 合并，返回 409 `PAGE_REVIEW_REQUIRED`，消息列出页面名和 PR 地址，
不改变任何状态。作者能写目标的草稿在任何合并中发布，包括 agent 用 token 合并。
合并请求的 `pageDraftIds` 是合并者评审过的草稿：Browser 发送评审面板列表里状态为 pending 或 conflicted 的草稿 ID，
对未合并的 Worktree，这正是 pending 且未过期的关联草稿。它与固定集合不一致时返回 409 `PAGES_CHANGED`，
消息给出 PR 地址，不改变任何状态；Browser 刷新页面列表，提示重新评审。两个 409 都适用时先返回 `PAGE_REVIEW_REQUIRED`，
因为它来自会话类型，重新评审也消除不了。
成功的合并响应 `publishedPages` 返回本次发布的 draftId、name、nodeId；重放不重复发布已发布草稿，
列表不回填历史结果。中断后重放或恢复只尝试 Operation 里记下的草稿，集合固定之后才变为 pending 的草稿保持 pending，由作者发布。
没有 `pageDraftIds` 的 merge Operation 是这条规则之前保存的，重放时不发布页面。服务端提交时只校验绑定的 Unit 可读，
工作表与范围由客户端校验；发布时不重新校验，发布后仍连接实时 trunk。

### 文件草稿

同一张表也保存经 Fork 对 upstream 其他 Blob（PDF、图片等不是页面的文件）的替换，行为 `kind = 'replace'`，没有新增列或迁移。
`PUT /api/forks/{forkId}/blob-resources/{resourceId}/content` 像 Fork 的 Unit 写入一样打开 Fork 的 Worktree，不是 `draft` 时返回
409 `FORK_WORKTREE_NOT_DRAFT`。目标必须是 upstream 中调用者能读的 Blob，否则 404；页面返回 403 `HTML_VIEW_DRAFT_REQUIRED`，
不可用返回 409，`If-Match` 不是当前 ETag 返回 412。请求先插入 `receiving` 行（SHA-256 暂为 64 个 `0`），把字节流式写入草稿
object key，收完后改为 `pending` 并记下 SHA-256、媒体类型和存储 ETag。同一 Idempotency-Key 的重复请求只看库里的行：已经
`pending` 且意图相同时返回同一草稿和 200，仍为 `receiving`（还在接收或上次失败）时返回 409，失败后要换新 key；服务进程不保存
接收状态。新草稿 supersede 同一作者在同一 Worktree 里同一目标的 pending 草稿，20 份上限由页面和文件合计。只支持替换，Fork 不新增文件。

一行是否是页面由行和目标推导，不落库：create 行、名称以 `.univer.html` 结尾的行、目标原始文件名以 `.univer.html` 结尾的行是页面，
其余 replace 行是文件草稿，视图字段 `page` 为 false。原始文件名不会改变，所以页面改名去掉后缀后仍是页面。发布时 `decide()` 要求
目标与行仍是同一类，文件草稿的目标改名成页面时为冲突。文件草稿与页面使用同一套合并规则：固定集合、合并者的目标写权限、
foreign 检查与 `PAGE_REVIEW_REQUIRED`、`PAGES_CHANGED`、`publishedPages`；upstream ETag 变化时这一份变为 `conflicted`，upstream 字节
不变，Sheet 照常合入。内容路由把文件草稿作为 `application/octet-stream` 附件返回，同样带 `Content-Security-Policy: sandbox` 和
`X-Content-Type-Options: nosniff`。Browser 评审面板列出文件草稿的名称、大小和下载链接，不预览，`/drafts/{id}` 也只给下载。

## Skill 草稿（V20）

`skill_drafts` 保存作者、作者范围的 Idempotency-Key、意图哈希、目标 Space、name、基础目录 ID、
状态、期限和发布目录 ID。`files`、`base`、`keep`、`scan`、`review` 与可空的 `source` 是 JSON 文本列。
草稿入库后不可编辑。每个文件记录 path、byteSize、sha256、kind、objectKey 与 mediaType，字节只存 BlobStore。
`base` 为 null 表示新建；替换时保存目录下全部文件的 Resource ID 和 ETag。`keep` 只允许基础文件路径。
`source` 当前为空。未找到原文的审查意见丢弃，数量保存到 `unverified_review_count`。

状态与 HTML View 草稿相同。`receiving` 最长一小时，`pending` 有效七天。作者可读，发布和拒绝要求作者的
交互式 Session。维护任务过期 receiving 和 pending，并为每个草稿对象排入 `blob_upload_abandoned` 删除任务。
拒绝和冲突同样释放全部草稿对象，终态行保留以支持幂等重试。

发布先从 BlobStore 读回字节、核对哈希并重新扫描。有 block 时返回 409，保持 pending。
随后在一个 SQLite 事务中检查目标和全部基础版本，复用或创建 `.agents/skills/<name>/` 与子目录，
采用草稿对象创建 Blob Resource 或交换同路径内容，把草稿和 keep 均未包含的基础文件移入 Trash，最后记录 published。
不创建 Operation，不复制对象，不需要恢复步骤。事务失败时全部回滚，原草稿可重试。
基础文件消失、ETag 改变、出现基础清单外的文件，或新建时同名目录非空，均只置为 conflicted，不写文件。
任何目标层重名或重复 SKILL.md 返回 409，保持 pending。

V19→V20 只新增此表和到期索引，保留全部现存行、对象身份及恢复状态。启动前停止旧实例，启动一个 V20 实例
完成一致性备份、版本化迁移、指纹、外键和完整性校验，再恢复服务。失败事务回滚。再次启动不重复迁移或备份。
回退先停止 V20，再恢复 V19 备份。禁止新旧进程同时写同一 SQLite 文件。

## Agent 身份与举报（V21）

V20→V21 给 `users` 末尾追加 `kind` 列，并新增 `agents` 与 `node_reports` 两张表，不建索引、不重建任何表。
既有 User 经列默认值读作 `'human'`，其它行、对象身份及恢复状态保持原样。启动前停止旧实例，启动一个 V21 实例
完成一致性备份、版本化迁移、指纹、外键和完整性校验，再恢复服务。失败事务回滚至 V20。再次启动不重复迁移或备份。
回退先停止 V21，再恢复 V20 备份。禁止新旧进程同时写同一 SQLite 文件。

## 显示名修复（V22）

V21→V22 不改 Schema，只按显示名规则修复数据；PostgreSQL 的同一修复对应 `workspace_product_schema`
版本 1→2。只有含邮箱地址、误导字符（控制、双向、填充、格式字符，地区旗帜以外的标签字符，未配对代理项、U+FFFD，或不连接任何字符的零宽字符）
或没有可见字符的 `display_name` 会被改写为派生名字：邮箱地址只保留本地部分，误导字符被清除，没有可见字符时
依次回退为同样经过规则的 username 和 `Workspace User`。其它名字逐字节不变，包括 emoji、波斯文和印度系文字中的
连接符与变体选择符。Personal Space 名以 ` 的个人空间` 结尾，且前半部分等于 owner 原显示名或本身会被改写
（例如改名前留下的邮箱）时，改为 `<新显示名> 的个人空间`。其它 Space 名、各行 `updated_at` 与其它表保持不变，
`agents.origin_label` 和 Team Space 不受影响。

`server/src/db/display-name-repair.ts` 的 `planDisplayNameRepair` 是唯一入口，SQLite 的 V21→V22 与 V0
迁移、PostgreSQL 的 `initialize.ts` 版本升级都调用它；对自身输出再执行一次不产生改动。SQLite 在一致性备份后于
单个 `BEGIN IMMEDIATE` 事务中完成修复、版本号、外键与完整性检查，失败回滚至 V21，备份保留，启动失败。
PostgreSQL 在 advisory lock 下把修复与版本行放在同一事务提交，失败时版本仍为 1；升级前由运维备份。再次
启动不重复迁移或备份。回退先停止 V22，再恢复 V21 备份。禁止新旧进程同时写同一 SQLite 文件。
V25 用同一入口再执行一次，退出条件见下文“显示名收敛（V25）”。

## 执行层授权（V23）

### `executor_access`

运维授予共享 MCP 执行层使用权的 User，每个 User 至多一行。`user_id` 是主键并随 User 删除，`granted_at` 是首次授予的
毫秒时间戳，重复授予不改写。行只由运维命令 `db:executor-access grant|revoke` 写入或删除，没有 HTTP 写入口。
`GET /api/session` 与 token exchange 在有行时报告 `executorAccess` / `executor_access` 为 `true`。

SQLite V22→V23 与 PostgreSQL 版本 2→3 都只新增这张空表，不建索引、不重建任何表，其它行、对象身份及恢复状态保持原样。
SQLite 沿用一致性备份、版本化迁移、指纹、外键和完整性校验，失败事务回滚至 V22，回退先停止 V23 再恢复 V22 备份。
PostgreSQL 在启动的同一事务里建表并把 `workspace_product_schema` 更新为版本 3 和新指纹，失败整体回滚。
旧实例遇到版本 3 拒绝启动，回退需停止新实例并恢复升级前的数据库备份。
禁止新旧进程同时写同一数据库。

## 复制来源与 Link Sharing 预留列（V24）

V23→V24：

- `nodes` 末尾追加可空的 `copied_from_node_id`（`REFERENCES nodes(id) ON DELETE SET NULL`），并新增部分索引 `nodes_copied_from`；
- `worktree_node_intents` 末尾追加可空的 `copied_from_node_id`；
- `node_link_sharing` 末尾追加 `unverified_role`（非空，默认 `'viewer'`，CHECK `editor | viewer`）和可空的 `making_of_note`；
- 重建 `operations`，`kind` CHECK 增加 `copy_node`。SQLite 不能原地修改 CHECK，迁移在关闭外键执行的同一事务内逐行复制全部列、删除旧表、改名并重建 `operations_due` 与 `operations_actor`；`blob_upload_sessions` 的入向外键仍指向 `operations`。

既有 Node 与 Intent 读作 `NULL`，既有 Link Sharing 读作 `'viewer'` 与 `NULL`。Operation 行及其 Lease 与重试字段、上传会话、
对象身份及恢复状态保持原样。启动前停止旧实例，启动一个 V24 实例完成一致性备份、版本化迁移、指纹、外键和完整性校验，
再恢复服务。失败事务回滚至 V23。再次启动不重复迁移或备份。回退先停止 V24，再恢复 V23 备份。禁止新旧进程同时写同一
SQLite 文件。

PostgreSQL 产品库由 `db/postgres/initialize.ts` 升级：版本 3 且结构指纹相符时，在持有建库 advisory lock 的同一事务内执行
等价的 `ALTER TABLE`、建索引和 `operations_kind_check` 替换，再写入版本 4 和新指纹，结构与全新安装一致。失败时整个事务回滚，
仍为版本 3。结构被改动过或版本未知时拒绝启动。PostgreSQL 升级不生成应用内备份，升级前按部署的备份策略备份数据库。

## 显示名收敛（V25）

V24→V25 不改 Schema；PostgreSQL 对应 `workspace_product_schema` 版本 4→5。迁移经同一入口 `planDisplayNameRepair`
对全部 User 与 Personal Space 再执行一次 V22 修复。执行过当前 V22 的库对自身输出再执行一次，不产生改动。执行过
47dc9277 部署的早期 V22 规则的库，按当前规则改写当时漏掉的名字以及仍以这些名字命名的 Personal Space。其它名字、各行 `updated_at`、其它表、
`agents.origin_label` 和 Team Space 保持不变。早期规则从天城文、泰米尔文、马拉雅拉姆文、僧伽罗文等文字的合法名字中删除的紧随 virama 的零宽连接符
无法由本步骤恢复，只能从该环境在 V22 之前的备份（SQLite 的 `.v21-backup-*.sqlite` 或 PostgreSQL 升级前的备份）取回。

SQLite 在一致性备份后于单个 `BEGIN IMMEDIATE` 事务中完成修复、版本号、外键与完整性检查，失败回滚至 V24，备份保留，
启动失败。PostgreSQL 在 advisory lock 下把待执行的全部升级与版本行放在同一事务提交，失败时版本保持升级前的值。再次
启动不重复迁移或备份。回退先停止 V25，再恢复升级前的备份。禁止新旧进程同时写同一数据库。
退出条件：所有线上 SQLite 库到达 V25、所有线上 PostgreSQL 产品库到达版本 5 后，删除 `display-name-repair.ts` 与其它
SQLite 迁移入口，PostgreSQL 版本 2 与 5 的升级步骤保留为空操作，以免改变版本号。

## HTML View 草稿来源（V26）

SQLite V25→V26 仅追加 `html_view_drafts.source_worktree_id TEXT`，旧值为 NULL，并新增 pending 草稿的
`(source_worktree_id, expires_at, id)` 部分索引。PostgreSQL 产品版本 5→6 在 advisory-lock 启动事务内
追加相同列和索引，失败回滚至版本 5；服务器不替 PostgreSQL 创建备份。SQLite→PostgreSQL 存储迁移
当前要求产品 V30，逐行保留来源 ID、对象 key、状态和所有恢复字段。

升级前停止所有旧实例。SQLite 先生成一致性 V25 备份，再由一个 V26 实例完成迁移、指纹、外键与完整性检查，
确认健康后恢复服务；重启不重复迁移或备份。PostgreSQL 升级前由运维备份。回退先停止 V26，恢复升级前备份。
禁止 V25 与 V26 写入同一个 SQLite 文件。此迁移集中在启动阶段，所有部署库到达 V26 后方可删除旧版本升级入口。

## HTML View 草稿修订（V27）

SQLite V26→V27 重建 `html_view_drafts`，保留全部旧列、对象 key、草稿与恢复状态。
状态新增 `superseded`；新增可空 `superseded_by TEXT` 指向后继，`revises_draft_id TEXT`
记录接收中的修订来源，旧记录两者均为 NULL。后者用于跨重启校验幂等意图，避免上传失败提前退休旧草稿。
PostgreSQL 产品版本 6→7 同步增加列和状态约束。

作者通过 `POST /api/html-view-drafts` 的 `kind=revise`、`draftId`、`html` 和 Idempotency-Key
修订 pending 且未过期的草稿。create 继承 Space、parent、name；replace 继承 target 和 base ETag。
未指定来源时继承 source Worktree，显式来源覆盖旧来源。上传完成的同一产品事务将新草稿转为 pending、
旧草稿转为 superseded 并设置后继与决定时间，同时排队删除旧对象。接收或上传失败保留旧 pending 草稿，
同 key、同意图可重试；并发修订只允许一个后继胜出。未完成的 receiving 仍由现有过期清理回收。
superseded 不可发布；查询返回后继 ID，浏览器和 MCP 提供跳转链接。

升级前停旧实例，SQLite 生成一致性 V26 备份，再启动单个 V27 实例执行迁移、指纹、外键和完整性检查。
确认健康后恢复服务。重启不重复迁移或备份。PostgreSQL 升级前由运维备份。
回退先停 V27 再恢复升级前备份，禁止新旧进程同时写同一库。所有部署库达到 V27 后方可删除旧升级入口。

## Fork（V28）

SQLite V27→V28 只新增 `forks` 表、在 `worktrees` 末尾追加可空 `fork_id` 列（带外键与 CHECK）以及部分唯一索引
`worktrees_open_fork`。已有行一律不改，`fork_id` 为 NULL。PostgreSQL 产品版本 7→8 在 advisory-lock 启动事务内
追加相同的表、列、CHECK 约束 `worktrees_fork_team` 和索引，失败回滚至版本 7；服务器不替 PostgreSQL 创建备份。
SQLite→PostgreSQL 存储迁移在 `worktrees` 之前导入 `forks`，逐行保留 `fork_id`。

升级前停旧实例，SQLite 生成一致性 V27 备份，再启动单个 V28 实例执行迁移、指纹、外键和完整性检查。
确认健康后恢复服务。重启不重复迁移或备份。PostgreSQL 升级前由运维备份。V27 的代码拒绝打开 V28 数据库，
所以代码回退必须先停 V28，再恢复升级前的备份；备份之后写入的数据会丢失。禁止新旧进程同时写同一库。
所有部署库达到 V28 后方可删除旧升级入口。

## 提议设置（V29）

SQLite V28→V29 只给 `spaces` 追加 `proposals TEXT NOT NULL DEFAULT 'members'` 与它的 CHECK。已有行一律取 `members`，
即今天“只有成员能提议”的行为。PostgreSQL 产品版本 8→9 在 advisory-lock 启动事务内追加相同的列与 CHECK
约束 `spaces_proposals_check`，失败回滚至版本 8；服务器不替 PostgreSQL 创建备份。SQLite→PostgreSQL 存储迁移逐行保留
`proposals`。

升级前停旧实例，SQLite 生成一致性 V28 备份，再启动单个 V29 实例执行迁移、指纹、外键和完整性检查。
确认健康后恢复服务。重启不重复迁移或备份。PostgreSQL 升级前由运维备份。V28 的代码拒绝打开 V29 数据库，
所以代码回退必须先停 V29，再恢复升级前的备份；备份之后写入的数据会丢失。禁止新旧进程同时写同一库。
所有部署库达到 V29 后方可删除旧升级入口。

## Issue 链接（V30）

SQLite V29→V30 只给 `worktrees` 追加可空的 `issue_id TEXT REFERENCES issues(id) ON DELETE SET NULL`、它的 CHECK
（非空时 `kind = 'team'`）和部分索引 `worktrees_issue`。已有行一律取 `NULL`，读作 `issue: null`。PostgreSQL 产品版本
9→10 在 advisory-lock 启动事务内追加相同的列、外键 `worktrees_issue_id_fkey`、CHECK 约束 `worktrees_issue_team` 和
索引，失败回滚至版本 9；服务器不替 PostgreSQL 创建备份。全新 PostgreSQL 库的 `issues` 表建在 `worktrees` 之后，
所以 `schema.sql` 在建完 `issues` 后再加这个外键。SQLite→PostgreSQL 存储迁移在 `worktrees` 之前导入 `issues`，
逐行保留 `issue_id`。

升级前停旧实例，SQLite 生成一致性 V29 备份，再启动单个 V30 实例执行迁移、指纹、外键和完整性检查。
确认健康后恢复服务。重启不重复迁移或备份。PostgreSQL 升级前由运维备份。V29 的代码拒绝打开 V30 数据库，
所以代码回退必须先停 V30，再恢复升级前的备份；备份之后写入的数据会丢失。禁止新旧进程同时写同一库。
所有部署库达到 V30 后方可删除旧升级入口。

## 检查结果（V32）

SQLite V31→V32 只新增空表 `worktree_checks`（见 [`worktree_checks`](#worktree_checks)），不改已有表和行。PostgreSQL
产品版本 11→12 在 advisory-lock 启动事务内建同一张表，失败回滚至版本 11；服务器不替 PostgreSQL 创建备份。
SQLite→PostgreSQL 存储迁移逐行复制 `worktree_checks`。升级前停旧实例，SQLite 生成一致性 V31 备份，再启动单个
V32 实例执行迁移、指纹、外键和完整性检查。重启不重复迁移或备份。V31 的代码拒绝打开 V32 数据库，代码回退必须先停
V32，再恢复升级前的备份；备份之后写入的数据会丢失。禁止新旧进程同时写同一库。

## 合入方式（V33）

SQLite V32→V33 只给 `spaces` 追加 `landing TEXT NOT NULL DEFAULT 'review'` 与它的 CHECK，已有行一律取 `review`，行为
不变。PostgreSQL 产品版本 12→13 在 advisory-lock 启动事务内追加同一列，失败回滚至版本 12；服务器不替 PostgreSQL 创建
备份。SQLite→PostgreSQL 存储迁移逐行保留 `landing`。升级前停旧实例，SQLite 生成一致性 V32 备份，再启动单个 V33 实例执行
迁移、指纹、外键和完整性检查。重启不重复迁移或备份。V32 的代码拒绝打开 V33 数据库，代码回退必须先停 V33，再恢复升级前
的备份；备份之后写入的数据会丢失。禁止新旧进程同时写同一库。

## 撤回 Operation（V34）

SQLite V33→V34 重建 `operations`，`kind` CHECK 增加 `revert_worktrees`：在关闭外键执行的同一事务内逐行复制全部列、
删除旧表、改名并重建 `operations_due` 与 `operations_actor`，`blob_upload_sessions` 的入向外键仍指向 `operations`，行数
和内容不变。PostgreSQL 产品版本 13→14 在 advisory-lock 启动事务内只替换 `operations_kind_check`，失败回滚至版本 13；
服务器不替 PostgreSQL 创建备份。升级前停旧实例，SQLite 生成一致性 V33 备份，再启动单个 V34 实例执行迁移、指纹、外键和
完整性检查。重启不重复迁移或备份。V33 的代码拒绝打开 V34 数据库，代码回退必须先停 V34，再恢复升级前的备份；备份之后
写入的数据会丢失。禁止新旧进程同时写同一库。
