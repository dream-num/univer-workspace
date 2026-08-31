# Univer Workspace 数据模型

状态：V6，已实现

权威定义：`server/src/db/schema.sql`

产品数据库使用 SQLite，开启 Foreign Key，Schema 版本为
`PRAGMA user_version = 6`。本模型以 Node 表达树，以 Resource 表达稳定内容身份；
Univer Unit 与 Blob 是 Resource 的两种互斥类型扩展，Unit 内嵌 Asset 不进入 Tree。

Univer Unit 的 Snapshot、Changeset、Sheet Block、Resource 与 Worktree 草稿另存于
`COLLABORATION_DATABASE_FILE` 指向的 Collaboration SQLite 文件，不属于产品数据库 V6
Schema。当前 SDK 要求 Base `schemaVersion = 2`，每个 Table 都有唯一的系统字段
`__record_id`，并把每条 Record ID 投影到该字段；Row/Column/Cell Map 是可从 Field 与 Record
重建的派生数据。现有持久化 Base Snapshot 均使用该表示。

Sheet/Doc Thread Comment 的 anchor 属于 Unit snapshot/changeset；评论正文、回复、solved
状态与并发 generation 保存在同一文件的 `collaboration_comments` 表中，并由
`collaboration_schema_versions` 的 `comment=1` 组件版本管理。Comment Adapter 首次启动时
幂等创建该附加 Schema，不改变产品数据库 V6，也不要求执行产品迁移命令。评论当前只在
Trunk 编辑器启用；Worktree 和 Merge Preview 不读取或写入 Trunk 评论。

五类 Trunk Unit 的标准版本历史索引保存在同一文件的
`collaboration_history_revisions` 表中，并由 `collaboration_schema_versions` 的 `history=1`
组件版本管理。History Adapter 首次启动时幂等创建该附加 Schema；索引可从产品映射的 Unit、
权威 Trunk revision 与 changeset 重建。为兼容启用 History 前的历史数据，服务启动时执行一次
内部 backfill；正常请求不执行该逻辑。该索引不属于产品数据库 V6，也不改变其迁移路径。
History 读取遵循 Unit 打开权限，恢复仍遵循内容编辑权限；Worktree 和 Merge Preview 不读取或
写入 Trunk History。

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

用户的稳定身份和公开资料。`username` 使用 `NOCASE UNIQUE`。

### `password_credentials`

本地密码凭据，与 User 一对一并随 User 删除。

### `external_identities`

外部身份映射。当前 Provider 只允许 GitHub；同一 Provider Subject 唯一，同一 User
在一个 Provider 下最多一个身份。

### `login_sessions`

只持久化 Session ID、Secret Hash、User 和过期时间。原始 Cookie Secret 不入库。Browser
授权 CLI 后会为 CLI 创建独立的普通 Session 行；十分钟内待确认的一次性授权请求仅存在于
Server 进程内存，不进入产品数据库，进程重启后由用户重新发起。

### `spaces`

`type` 为 `personal | team`。一个 User 最多拥有一个 Personal Space。
`public_read` 默认关闭；开启后，任意已登录 User 无需 Membership 或 Node Grant 即可按
`viewer` 浏览 Space 树并打开其中内容。已有更高权限优先，公开策略不授予任何写能力。

### `space_members`

仅用于 Team Space，角色为 `admin | editor | viewer`。Space Owner 不重复写入成员表；
Trigger 阻止向 Personal Space 写成员或把 Owner 写成成员。

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

数据库 Trigger 保证非空 Parent 与 Child 在同一 Space，并阻止直接自指。应用层在 Move
前额外检查整条后代链，阻止把 Node 移入自己的后代。

`nodes_parent` 支持按 Space、Parent、回收站状态和名称分页；`nodes_trash` 支持回收站
批次查询。

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
| `unit_type` | `sheet | doc | slide | board | base` |

### `blob_resources`

保存 BlobStore `object_key`、原始文件名、服务端检测的 MIME、字节数、SHA-256、ETag 与
`ready | quarantined` 可用状态。文件字节不进入 SQLite，Object Key 不返回客户端。前端
根据 MIME 选择预览组件；数据库不保存 Preview Kind。

### `blob_upload_sessions`

保存发布前的三段上传状态以及服务端预留的 Node/Resource/Object 身份。上传完成前不创建
Node 和 Resource，因此 Tree 不会看见半成品。Complete 在一个产品事务中发布 Node、
Resource 与 Blob 扩展并完成 Operation。单进程服务启动时会把中断在 `verifying` 的上传
恢复为可重传状态；确定性临时对象会在重传、Abort 或过期清理时移除。

### `univer_assets`

保存 Unit 内嵌资源的稳定 Asset ID、Scope、Object Key、客户端声明的 MIME、字节数、SHA-256、
ETag 和创建者。`worktree_id IS NULL` 表示 Trunk；非空时 Asset 只属于该 Worktree。Trunk Asset
必须引用现有 `univer_resources.unit_id`，Worktree Asset 必须引用对应 `worktree_units`。

Snapshot 只保存 Asset ID，不保存 Object Key、文件路径、短期地址或字节。Asset 不创建 Node，
也不进入 Recent、分享或 Tree API。

### `univer_asset_uploads`

保存原生 Univer File API 上传的 `receiving | stored` 状态。行中预留 Asset/Object 身份并固化
Unit Scope；字节完整写入 BlobStore 后记录 Hash 与 ETag，再在一个产品事务中发布
`univer_assets` 并删除 Upload 行。启动恢复会发布完整的 `stored` 行，放弃不完整的
`receiving` 行并写删除任务。

### `object_deletion_jobs`

BlobStore 与 SQLite 不能共享事务。Blob Abort/过期、Asset Upload 放弃和 Unit/Resource
永久删除时，先在同一 SQLite 事务写通用删除 Outbox，再由后台 Worker 幂等删除对象并重试
失败任务。V3 已将旧 `blob_deletion_jobs` 泛化为本表。

## 权限与分享

### `node_grants`

Personal Space Node 的直接授权，角色为 `editor | viewer`。Grant 继承到当前和未来后代。
主键为 `(node_id, user_id)`。Trigger 阻止授权 Space Owner 或在 Team Space 写 Direct
Grant。

### `node_link_sharing`

Node 的登录用户链接分享策略，角色为 `editor | viewer`。策略同样按 Node 祖先链继承。
Trigger 限制它只用于 Personal Space。

有效 Role 由 Access Resolver 每次按以下来源计算最高权限：

1. Space Owner；
2. Team Space Membership；
3. Node 或祖先的 Direct Grant；
4. Node 或祖先启用的 Link Sharing。

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

### `worktree_units`

| 字段 | 语义 |
| --- | --- |
| `worktree_id`, `unit_id` | 复合主键 |
| `resource_id` | 稳定产品内容身份 |
| `source` | `trunk | worktree` |
| `ordinal` | Worktree 内顺序 |
| `added_at` | 加入时间 |

`resource_id` 对 Trunk Unit 只允许指向已有 Univer Resource；Blob 第一版不进入 Worktree。
对尚未激活的 Worktree-local Unit，它是预留 Resource ID，此时核心 `resources` 表中还没有
对应行。

### `worktree_node_intents`

仅 Worktree-local Unit 使用，保存激活时要创建的：

- 预留 `node_id`；
- 目标 Space 和 Parent Node；
- 名称与 Univer Unit Type；
- 创建者；
- Activated/Discarded 状态。

激活在一个产品事务中创建 Node、Resource、Univer Resource，并标记 Intent。它不接受
客户端指定 Node、Resource 或 Unit ID。

## Operations

`operations` 是跨产品数据库与 Collaboration 服务操作的幂等日志。支持：

```text
create_resource
create_blob_resource
create_worktree
add_worktree_unit
create_worktree_unit
merge_worktree
discard_worktree
activate_worktree_resource
```

状态为 `pending | completed | failed`。`payload_json` 在首次请求时固化服务器生成的稳定
Node/Resource/Unit ID；相同 Idempotency Key 只能重放相同意图。Lease、Attempt、
`next_attempt_at` 和最后错误字段支持后台恢复。

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
3. `POST .../complete` 校验对象后，在单个 SQLite 事务中发布 Node/Resource；
4. `content` 与 `download` 都重新解析 Node 权限并支持单段 Byte Range。

### 创建与读取 Univer Asset

1. `CollaborationImageIoService` 向 Trunk 或 Worktree File API 提交 `source=3`、`assign=unitID`
   和 Multipart `file`；
2. 服务端重新验证 Unit 的编辑权限，流式写入注入的 `BlobStore`，并以服务端字节检测结果为准；
3. Snapshot 只写返回的 `FileId`；
4. 读取先由 `sign-url` 返回同域 `/content` 地址；每次 Content 请求重新验证当前 Unit/Worktree
   权限，使用 `private, no-store` 并支持单段 Byte Range；
5. Worktree Merge 只把成功合入或未变化 Unit 的 Asset 发布到 Trunk。

### Rename 与 Move

Rename 只更新 `nodes.name`。Move 只更新 `nodes.parent_id`；目标必须同 Space、有创建
权限且不在 Source 的后代链中。Resource 和 Unit ID 均保持不变。

## 一次性自动迁移边界

临时迁移入口位于 `server/src/db/migrations/`，V0 读取器隔离在 `legacy-v0/`，业务模块不导入
它们。应用打开磁盘数据库时：

1. 不存在或空文件：创建 V6，不备份；
2. 完整 V6：校验指纹后正常启动，不重复备份；
3. 完整 V5：先生成一致性备份，再迁移到 V6，旧 Space 的公开读取默认关闭；
4. 完整 V4/V3/V2/V1：备份后逐版本迁移到 V6；
5. 完整 V0：先生成一致性备份，再直接迁移到 V6；
6. 未知版本、部分 Schema、完整性错误或不一致业务状态：拒绝启动。

迁移器还识别合并前 Discord 开发分支产生的 V4 变体：若 Asset Upload 仍含
`detected_media_type`，先执行正式 V3 → V4 Asset 迁移，再执行 V4 → V5 Identity 迁移。
该兼容路径同样会先创建并验证 V4 一致性备份。

每个版本迁移步骤都在独立的 `BEGIN IMMEDIATE` 事务中完成，保留原 Node、Unit、User、Space、Trash Batch、
Worktree 和 Operation ID，为现有内容生成新的 Resource ID，并类型化重写所有已完成
Operation JSON。迁移前要求没有 Pending/Failed Operation。

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
- 旧表全部删除且 `user_version = 6`。

失败步骤会回滚且应用不启动；V1/V2 链式升级可能已提交有效的中间版本，但启动前生成的
一致性备份始终保留，下一次启动可继续升级或由运维恢复。错误中会给出备份路径。
迁移实现是唯一兼容边界；线上数据库全部完成升级后，可以删除 `migrations/`、
`legacy-v0/` 及初始化函数中的一次调用，不影响 V6 Schema 或业务代码。
