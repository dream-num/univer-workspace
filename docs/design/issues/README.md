# Issues：设计与实施计划

> 状态：第 1–7 阶段已实施，未提交（2026-09-29）。第 8 节记录实际验收结果和与计划不同的地方；
> 数据模型以 `apps/workspace/docs/data-model.md` 为准，HTTP 行为以
> `apps/workspace/contracts/http/concepts.md` 和 OpenAPI 为准，两者与本文冲突时以它们为准。
>
> 相关文档：[Repository View SPEC](../repository-view/SPEC.md)、
> [repository-view-ux-audit.md](../../../apps/workspace/docs/proposals/repository-view-ux-audit.md)
> （P1-7 移除了没有模型的 Issues 空壳，并把 Issue 模型列为独立工作）。

## 1. 设计简报

**用户与场景。** 团队成员在 Workspace 里讨论文档的需求和缺陷，例如「Q3 预算表缺少华东区」
「合同模板第 4 条措辞有误」。目前这些讨论散落在聊天工具里，与被讨论的文档脱节。Agent 用户
在 DSH 对话或 CLI 里说「处理 #12」，希望 Agent 直接读到需求、需求涉及的文件和讨论记录，
然后开工。

**界面类型：Operate。** 用户要完成的操作是提出问题、查找问题、讨论、指派和关闭。页面以
扫读效率和状态清晰为先，不做营销式表达。

**成功标准。**

- 团队成员能在 Space 内创建 Issue，写 Markdown 正文，贴上标签，指派成员，并引用 Space 内的文件。
- 列表页能在两秒内回答「还有哪些未关闭」「哪些指派给我」「哪些是 bug」。
- Agent 或 CLI 通过 Space 和编号（`#12`）拿到 Issue 全文、时间线和被引用文件的 Resource ID，
  不需要再次向用户确认上下文。
- 两种主题都有 Issues 入口，且共用同一套 URL。

**产品特有的事实。** Issue 引用的是 Workspace Node（表格、文档、幻灯片、Blob），而不是代码
路径。Agent 可以直接打开被引用的文件（`univer_open` / `unit` 命令），这是普通 issue tracker 做不到的。

**已确认的决策（2026-09-29 访谈）。**

| 决策 | 结论 |
|---|---|
| 适用范围 | 仅 Team Space。个人空间不显示入口，API 返回 409 |
| Issue 与 Worktree(PR) 关联 | V1 不做。Agent 在评论里贴 review 链接 |
| V1 能力 | 编号、标题、Markdown 正文、open/closed（completed / not planned）、评论、时间线事件、Assignees、Labels、引用文件（Node）、实时刷新 |
| Agent 如何开工 | 提供 Issue 工具读写；用户在对话里指派任务（「处理 #12」）。浏览器不提供「交给 Agent」按钮，Agent 也不自动轮询领取 |

**非目标（V1 不做）。** Issue ↔ Worktree 关联和合并时自动关闭；Milestone、Project 看板、
Issue 模板、反应表情、@提及通知、正文编辑历史、Issue 删除与转移、跨 Space 引用、Issue 全文索引、
浏览器一键启动 Agent。

## 2. 权限模型

Issue 挂在 Team Space 上，权限直接从 Space 角色推导，不引入 Issue 级 ACL。

| 能力 | owner | admin | editor | viewer（成员） | 公开读的非成员 |
|---|---|---|---|---|---|
| 读取 Issue、评论、标签 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 创建 Issue、发表评论 | ✓ | ✓ | ✓ | ✓ | ✗ |
| 编辑自己的 Issue 标题和正文、关闭或重开自己的 Issue | ✓ | ✓ | ✓ | ✓ | ✗ |
| 编辑任意 Issue、关闭或重开任意 Issue、设置标签、Assignees 和引用文件 | ✓ | ✓ | ✓ | ✗ | ✗ |
| 创建、修改、删除标签定义 | ✓ | ✓ | ✗ | ✗ | ✗ |
| 编辑评论 | 仅作者 | 仅作者 | 仅作者 | 仅作者 | ✗ |
| 删除评论 | ✓ | ✓ | 仅作者 | 仅作者 | ✗ |

- Viewer 能创建 Issue 和评论。Issue 是沟通记录，不修改 Space 内容，与 GitHub read 角色能开
  Issue 的做法一致。
- `resolveSpace` 目前把公开读者和成员 viewer 都映射为 `viewer`，服务端无法区分。实现时在
  `SpaceAccess` 上增加内部字段 `member: boolean`（owner 或 `space_members` 命中时为 true），
  不改变现有角色语义。
- Issue 接口全部要求登录（`requireSession`），不支持匿名读取。
- 无权读取 Space 时返回 404，沿用 AccessResolver「不可发现即 404」的约定。
- 个人空间返回 `409 CONFLICT`，message 为 `Issues are available only in team spaces.`。
  调用者本来就能看到自己的个人空间，隐藏它的存在没有意义，明确的错误能让 Agent 停止重试。
- 被引用文件按读者身份逐个经 `resolveNode` 过滤。在 Team Space 内，成员对 Node 的访问由
  Space 角色决定，正常情况下不会被过滤；Node 进入回收站或被移出 Space 时，显示为不可用。

`SpaceCapabilities` 增加三个字段，由 `spaceCapabilities(role, { type, member })` 计算，
Browser 用它们决定按钮是否显示：

- `createIssue`：Team Space，且为成员。
- `triageIssues`：Team Space，且角色为 owner、admin 或 editor。
- `manageIssueLabels`：Team Space，且角色为 owner 或 admin。

## 3. Server 建模

### 3.1 数据表（schema V9，纯增量）

所有 Issue 数据都在产品数据库，不涉及 Collaboration Service 或 BlobStore，所以写入只用一个
`BEGIN IMMEDIATE` 事务，不引入 Operation。

```sql
CREATE TABLE issues (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL CHECK (state IN ('open', 'closed')),
  state_reason TEXT CHECK (state_reason IN ('completed', 'not_planned')),
  author_user_id TEXT NOT NULL,
  closed_by_user_id TEXT,
  closed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((state = 'open' AND state_reason IS NULL AND closed_at IS NULL)
      OR (state = 'closed' AND state_reason IS NOT NULL AND closed_at IS NOT NULL)),
  UNIQUE (space_id, number),
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
  FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (closed_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX issues_space_state_created ON issues(space_id, state, created_at DESC, id);
CREATE INDEX issues_space_state_updated ON issues(space_id, state, updated_at DESC, id);

CREATE TABLE issue_comments (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX issue_comments_issue ON issue_comments(issue_id, created_at, id);

CREATE TABLE issue_events (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN (
    'closed', 'reopened', 'renamed',
    'labeled', 'unlabeled', 'assigned', 'unassigned',
    'node_referenced', 'node_unreferenced')),
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX issue_events_issue ON issue_events(issue_id, created_at, id);

CREATE TABLE issue_labels (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX issue_labels_space_name ON issue_labels(space_id, name COLLATE NOCASE);

CREATE TABLE issue_label_links (
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  label_id TEXT NOT NULL REFERENCES issue_labels(id) ON DELETE CASCADE,
  PRIMARY KEY (issue_id, label_id)
);
CREATE INDEX issue_label_links_label ON issue_label_links(label_id, issue_id);

CREATE TABLE issue_assignees (
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  PRIMARY KEY (issue_id, user_id)
);
CREATE INDEX issue_assignees_user ON issue_assignees(user_id, issue_id);

CREATE TABLE issue_node_refs (
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (issue_id, node_id)
);
CREATE INDEX issue_node_refs_node ON issue_node_refs(node_id);
```

以下几点是有意的取舍：

- **编号。** 在创建事务内执行 `SELECT COALESCE(MAX(number), 0) + 1 FROM issues WHERE space_id = ?`，
  由 `BEGIN IMMEDIATE` 串行化，`UNIQUE(space_id, number)` 兜底。V1 不允许删除 Issue，所以编号不会
  被复用。以后如果加入删除，需要改用独立的计数表。
- **标签颜色**存调色板键（如 `gray`、`blue`、`green`、`yellow`、`orange`、`red`、`purple`、`pink`），
  不存十六进制值。每个键在 `global.css` 里有亮色和暗色两套 token，所以不用在运行时计算对比度，
  暗色主题也不会失真。键只在服务层校验，不写 CHECK，调整调色板不需要迁移。
- **事件快照。** `labeled`、`assigned`、`node_referenced` 等事件的 `payload_json` 保存名称和颜色的
  快照（如 `{labelId, name, color}`），标签被删除或文件被改名后，历史记录仍然可读。
- **评论数**在列表查询里用子查询计算，不缓存计数列。SQLite 单库规模下足够，出现性能问题再加计数列。
- **正文编辑**采用后写覆盖（last-writer-wins），不做 `If-Match`。只记录 `updated_at`，界面显示「已编辑」。
- **Assignee** 必须在指派时是 Space owner 或成员。成员被移出 Space 后，已有指派保留，不级联删除。
- **引用文件**必须在指派时属于同一 Space 且未进入回收站。Node 被彻底删除时，引用随 FK 级联删除。

**上限**（服务层校验，超出返回 `INVALID_INPUT` 并带 `field`）：标题 1–256 字符，正文与评论
≤ 65 536 字符，每个 Space 标签 ≤ 100 个，每个 Issue 标签 ≤ 20 个、Assignees ≤ 10 人、
引用文件 ≤ 20 个。

### 3.2 迁移

按 `apps/workspace/AGENTS.md` 执行完整 V8 → V9 流程，模板用 `v7-to-v8`：

1. 新增 `server/src/db/migrations/v8-to-v9/migrate.ts`，内容是上面的建表与建索引语句，
   然后设置 `PRAGMA user_version = 9`，执行 `foreign_key_check` 和 `integrity_check`。
2. 在 `prepare-current-database.ts` 中：把 `TARGET_VERSION` 改为 9；在每个旧版本分支末尾追加
   `migrateV8ToV9`；新增 `assertV9Fingerprint`；把 `createBackup` 和 `verifyBackup` 的版本联合
   类型扩到 9。
3. `database.ts` 与 `schema.sql` 的版本检查改为 9；`legacy-v0/migrate.ts` 直接迁到 V9。
4. 测试资产：`test/fixtures/schema-v8.sql`、`test/production-v8-migration.ts`，以及覆盖以下情况的
   迁移集成测试：空库、已有发布数据、存在待恢复 Operation、失败后回滚且备份可读、重启后不再迁移。
   `test:production-import` 纳入 V8 → V9 路径。

### 3.3 模块

新增 `server/src/modules/issues/`，结构与 `trash`、`worktrees` 一致：

- `issues.repository.ts`：`IssuesRepository`，负责 SQL、keyset 分页、编号分配和 `audience(spaceId)`
  查询（Space owner 加全部成员）。
- `issues.service.ts`：`createIssuesModule({ repository, access, now, onChanged })`，负责输入校验、
  能力判断、事件写入和视图映射。每次写入在同一事务内同时更新 `issues.updated_at` 并追加事件。
- `issues.router.ts`：`createIssuesRouter({ identity, issues })`，只做 session 解析和参数透传。
- `issues.types.ts`：视图类型和 `IssuesModule` 接口。
- 在 `app.ts` 的 `createWorkspaceApplication()` 中装配，并挂载到 `/api`。

`onChanged` 写入成功后调用 change feed（第 3.5 节）。与 worktrees 模块一样，推送失败会被吞掉，
不影响写入结果。

### 3.4 HTTP contract

新增 `contracts/http/paths/issues.yaml`、`contracts/http/schemas/issues.yaml`，在 `openapi.yaml`
里增加 `Issues` tag，在 `concepts.md` 里增加 Issues 一节。完成后运行 `api:verify`。

| 方法与路径 | operationId | 说明 |
|---|---|---|
| `GET /api/spaces/{spaceId}/issues` | `listSpaceIssues` | 查询参数：`state=open\|closed\|all`（默认 open）、`label`（可重复，取交集）、`assignee=<userId>\|me\|none`、`author=<userId>\|me`、`q`（标题与正文 LIKE）、`sort=created\|updated`、`order`、`cursor`、`limit`。响应为 `{ items, nextCursor, counts: { open, closed } }`，其中 `counts` 应用除 `state` 以外的全部过滤条件 |
| `POST /api/spaces/{spaceId}/issues` | `createIssue` | 请求体：`{ title, body?, labelIds?, assigneeUserIds?, nodeIds? }`，返回 201 和 `Issue` |
| `GET /api/spaces/{spaceId}/issues/{number}` | `getIssue` | 返回 `Issue`，包含正文、标签、Assignees、引用文件和当前读者的 `capabilities` |
| `PATCH /api/spaces/{spaceId}/issues/{number}` | `updateIssue` | 请求体字段都可选：`title`、`body`、`state`、`stateReason`、`labelIds`、`assigneeUserIds`、`nodeIds`。集合字段整体替换 |
| `GET /api/spaces/{spaceId}/issues/{number}/timeline` | `listIssueTimeline` | 按时间升序合并评论和事件，keyset 分页，`limit` 默认 100 |
| `POST /api/spaces/{spaceId}/issues/{number}/comments` | `createIssueComment` | 请求体：`{ body }` |
| `PATCH /api/issue-comments/{commentId}` | `updateIssueComment` | 仅作者可调用 |
| `DELETE /api/issue-comments/{commentId}` | `deleteIssueComment` | 作者、owner 或 admin 可调用，硬删除 |
| `GET /api/spaces/{spaceId}/issue-labels` | `listIssueLabels` | 返回 Space 的全部标签，数量有上限，不分页 |
| `POST /api/spaces/{spaceId}/issue-labels` | `createIssueLabel` | 请求体：`{ name, color, description? }` |
| `PATCH /api/issue-labels/{labelId}` / `DELETE` | `updateIssueLabel` / `deleteIssueLabel` | 删除标签时级联移除 Issue 上的该标签，已写入的事件保留快照 |
| `GET /api/issues` | `listMyIssues` | 跨 Space 列表，只覆盖调用者是 owner 或成员的 Team Space。支持 `state`、`assignee=me`、`author=me`、`q`、`cursor`、`limit`。每条结果带 `space: { id, name }`。供 wiki 的 `/issues` 页面和 CLI、Agent 的「分配给我」使用 |

URL 用 Space 内编号，不用 UUID。`#12` 是人、Agent 和 CLI 共同使用的引用方式，
`issue get 12 --space <id>` 可以直接对应到接口。评论和标签不需要人类可读的编号，所以用 ID。

`Issue` 视图：

```jsonc
{
  "id": "…", "number": 12, "space": { "id": "…", "name": "mini-crm" },
  "title": "…", "body": "markdown", "state": "open", "stateReason": null,
  "author": UserSummary, "closedBy": null, "closedAt": null,
  "labels": [{ "id": "…", "name": "bug", "color": "red", "description": "" }],
  "assignees": [UserSummary],
  "references": [{ "node": NodeSummary | null, "nodeId": "…", "available": true }],
  "commentCount": 3, "createdAt": "…", "updatedAt": "…",
  "capabilities": { "edit": true, "close": true, "triage": true, "comment": true }
}
```

列表项 `IssueSummary` 不含 `body`、`references` 和 `capabilities`，另外带 `referenceCount`。
`UserSummary` 复用现有身份 schema。`SpaceView.capabilities` 增加第 2 节列出的三个字段。

**幂等。** 按 `concepts.md` 的规定，`Idempotency-Key` 只用于跨系统写入。Issue 写入不属于这一类，
不接受该头。Client Core 对结果未知的 Issue POST 不做自动重试，直接把 `workspace-result-unknown`
交给调用者，Agent 的 skill 要求它先查询列表或时间线确认，再决定是否重试。

### 3.5 实时刷新

复用 `/api/worktree-events` WebSocket，不另开通道：

- `WorktreeChangeFeed.publish` 扩展为可以发送 `{ event: "issuesChanged", spaceId }`，受众是该 Space
  的 owner 和全部成员。
- 这个信号只用于让缓存失效，不携带 Issue 数据，符合 `application-design.md` 对该通道的限制。
- 公开读的非成员不在受众内，他们在窗口获得焦点时由 TanStack Query 自动重新获取数据。
- 通道路径名保留 `worktree-events`，不改名。改名需要同时修改 Browser、Agent 和部署代理配置，
  收益不足。在 `application-design.md` 里注明这个通道已承载两类信号。
- Agent 的 `workspace-change-feed.ts` 按事件名过滤，会忽略这个新事件，不需要修改。

### 3.6 文档

同一变更中需要更新：

- `apps/workspace/docs/data-model.md`：在 Worktree 之后新增「Issues」一节，每张表一个小节；
  同时更新关系图、版本行和迁移边界。
- `apps/workspace/docs/application-design.md`：模块树加入 Issues，数据库启动边界加入 V9，
  注明 change feed 承载 Issue 信号。
- `apps/workspace/CONTEXT.md`：术语表加入 Issue、Issue Number、Label、Issue Reference。
- `apps/workspace/README.md`：升级说明。
- `DREAMNUM.md` 第 12 行附近的产品模型清单加入 Issues。

## 4. Web UI

### 4.1 共享组件与数据层

新增 `web/src/features/issues/`，两种主题只在外壳上不同，主体组件共用：

- `issues.queries.ts`：根 key 为 `["issues"]`，下分
  `["issues", "list", spaceId, filters]`、`["issues", "detail", spaceId, number]`、
  `["issues", "timeline", spaceId, number]`、`["issues", "labels", spaceId]`、`["issues", "mine", filters]`。
  写操作成功后按 `["issues", *, spaceId]` 失效；收到 `issuesChanged` 时也执行同样的失效。
- `IssueList`：包含过滤栏和行列表，Space 内列表和跨 Space 列表共用，后者在行内显示 Space 名称。
- `IssueDetail`：包含标题栏、时间线、评论框和侧栏。
- `IssueComposer`：新建 Issue 与评论共用。它是一个 textarea，带「编写 / 预览」切换，预览复用
  Markdown 渲染。
- `IssueStateIcon`、`IssueLabel`、`LabelPicker`、`AssigneePicker`、`ReferencePicker`。
- `LabelsPage`：标签管理。

**Markdown。** `packages/workspace-markdown-viewer` 的 `MarkdownViewer` 固定带有工具栏和独立滚动
容器，这是为文件预览设计的。计划给它增加 `chrome="none"` 选项，只渲染内容，保留安全的 URL
转换和点击后才加载外部图片的行为。Agent 也使用这个包，默认值保持现有行为，Agent 端不受影响。
这个 package 不在 `unit-comparison-viewer` 的多副本同步规则内。

**状态图标与颜色。**

| 状态 | 图标（lucide） | 颜色 token |
|---|---|---|
| Open | `CircleDot` | `state-open` |
| Closed · completed | `CircleCheck` | `state-merged`（GitHub 用同一种紫色表示「已完成」） |
| Closed · not planned | `CircleSlash` | `muted-foreground` |

标签调色板在 `global.css` 的 `@theme` 中新增 `--color-label-<key>` 和 `--color-label-<key>-soft`，
并提供暗色覆盖。

**新增 UI 原件。** `shared/ui` 目前没有 Textarea，新增一个与 `Input` 同风格的 `Textarea`。
标签页、Assignees 和引用文件的选择器复用现有的 `SearchSelect` 或 `Menu`，不引入新依赖。

**引用文件选择器。** 服务端没有 Node 搜索接口，V1 也不新增。选择器复用 Space 文件树的逐层浏览，
并在对话框顶部提供当前已加载节点的过滤框。文件页的操作菜单新增「在 Issue 中引用」，打开新建
Issue 页并预填该 Node。这是更常见的入口。

**i18n。** `shared/i18n.tsx` 的中英文都需要补 key，统一加 `issue` 前缀（如 `issueOpenCount`、
`issueCloseAsCompleted`、`issueCloseAsNotPlanned`、`issueEmptyTitle`）。Repository 主题的文案差异
放在 `repositoryMessages` 里。

### 4.2 路由

两种主题共用同一组 URL，主题只影响外壳，符合 Repository View SPEC「主题不改变 URL 合同」的约定：

| 路由文件 | URL | 用途 |
|---|---|---|
| `spaces_.$spaceId.issues.tsx` | `/spaces/$spaceId/issues?state&label&assignee&q&sort` | Space 内列表 |
| `spaces_.$spaceId.issues.new.tsx` | `/spaces/$spaceId/issues/new?node=` | 新建 |
| `spaces_.$spaceId.issues.$number.tsx` | `/spaces/$spaceId/issues/$number` | 详情 |
| `spaces_.$spaceId.issues.labels.tsx` | `/spaces/$spaceId/issues/labels` | 标签管理 |
| `issues.tsx` | `/issues?state&assignee&q` | 跨 Space 列表（「我的」） |

过滤条件放在 URL search 参数里，因此过滤结果可以分享，浏览器后退也能恢复。页面通过
`WorkspaceLayout` 传入 `repositoryTab: "issues"` 和 `selectedView: "issues"`。Repository 主题
据此渲染仓库外壳，wiki 主题据此高亮侧栏项。路由树由 `routes:generate` 生成。

### 4.3 Repository 主题（OfficeLab）

**入口。** 在 `RepositoryTabs` 中，Issues 排在 Files 与 Pull requests 之间，与 GitHub 的顺序一致，
只在 Team Space 显示。计数徽标显示 open 数量，数据来自 Issues 列表默认查询的 `counts.open`。
这个查询与 Issues 页首屏的 query key 相同，缓存可以共用，不会增加额外请求。需要同步修改的地方：
`repository-tabs.tsx` 和 `-workspace-layout.tsx` 两处 `RepositoryTab` 联合类型，以及 Issues tab
的链接（它指向独立路由，写法与 Settings 相同）。

仓库外壳页头的全局导航加一个「Issues」链接，指向 `/issues`，对应 GitHub 顶栏的全局 Issues 入口。

**列表页**（沿用 PRs tab 的卡片与行样式）：

```text
┌ [搜索 Issue…                              ] [Labels] [New issue] ┐
┌────────────────────────────────────────────────────────────────┐
│ ◉ 12 Open   ✓ 30 Closed          Author ▾  Label ▾  Assignee ▾  Sort ▾ │
├────────────────────────────────────────────────────────────────┤
│ ◉ Q3 预算表缺少华东区  [bug] [finance]              👤👤  💬 3  📎 2 │
│   #12 由 weimin 在 3 天前创建                                    │
├────────────────────────────────────────────────────────────────┤
│ ✓ 合同模板第 4 条措辞  [docs]                        👤    💬 5      │
│   #9 由 yang 关闭于 昨天                                          │
└────────────────────────────────────────────────────────────────┘
```

- 整行是一个链接，标签芯片不单独可点。点击芯片会触发过滤，与整行链接冲突，V1 不做。
- 行尾依次是 Assignee 头像（最多 3 个，其余显示为 +N）、评论数和引用文件数，数量为 0 时不显示。
- 空状态分两种：Space 内还没有任何 Issue 时，显示说明和「New issue」按钮（有 `createIssue` 时才显示按钮）；
  有 Issue 但过滤后为空时，显示「没有匹配的 Issue」和「清除过滤」。
- 移动端（≤ 720px）：过滤下拉收进一个「Filters」菜单，头像列隐藏。

**详情页：**

```text
Q3 预算表缺少华东区  #12                                   [Edit] [New issue]
(◉ Open)  weimin 于 3 天前创建 · 3 条评论
────────────────────────────────────────────────────────────────────────
┌ weimin · 3 天前 ──────────────────────┐   Assignees        ⚙
│ 正文（Markdown）                        │   👤 yang
└────────────────────────────────────────┘   Labels           ⚙
  🏷 weimin 添加了标签 [bug] · 3 天前        [bug] [finance]
  👤 weimin 指派给 yang · 3 天前            引用文件          ⚙
┌ yang · 2 天前 ─────────────────────────┐   📊 预算/Q3.xlsx
│ 评论                                    │   📄 需求说明.docx
└────────────────────────────────────────┘
┌ 编写 | 预览 ────────────────────────────┐
│ textarea                                │
└──────────── [Close issue ▾] [Comment] ──┘
```

- 时间线：正文和评论显示为卡片，事件显示为一行带图标的小字，这是 GitHub 的层级。
- 「Close issue ▾」是一个 split button：主按钮以 completed 关闭，菜单里可选 not planned。评论框有内容时，
  主按钮变为「Close with comment」，先发评论再关闭。已关闭的 Issue 显示「Reopen」。
- 侧栏每个分组的齿轮只在有 `triageIssues` 时显示，打开对应选择器。选择器关闭时一次性提交 PATCH，
  不在每次勾选时提交。
- 引用文件行链接到 `/nodes/$nodeId`。不可用的引用显示为灰色「文件不可用」，不暴露原名称
  （名称可能已经不可读）。
- 标题可以原地编辑（作者或 triage 权限）。正文编辑在卡片的「⋯」菜单里切换成 Composer。
- 移动端：侧栏移到标题下方，默认折叠为一行摘要（如「1 位 Assignee · 2 个标签 · 2 个文件」），可展开。

**标签管理页。** 列表显示标签、描述、使用该标签的 open Issue 数量和编辑、删除按钮，只有
`manageIssueLabels` 时可以修改。删除前用 `ConfirmDialog` 提示「将从 N 个 Issue 上移除」。

### 4.4 Wiki 主题

参照 Apps 的侧栏写法（`features/html-views/apps-sidebar.tsx`）：

- 侧栏在 Apps 分组之后、Trash 之前新增可折叠的 **Issues** 分组，结构为「标题链接 + 按 Space 分组的树」：

```text
▾ Issues                     → /issues
  ▸ 👥 mini-crm          12
  ▾ 👥 finance            3
      ◉ #14 汇率更新
      ◉ #12 Q3 预算表缺少华东区
      ◉ #11 …
      查看全部 →            → /spaces/$id/issues
```

- 分组只列出调用者是 owner 或成员的 Team Space，数据来自已有的 spaces 查询。没有 Team Space 时隐藏整个分组。
- 展开某个 Space 时才加载它的 open Issue 列表（limit 20，与 Space 列表页默认查询共用 key），
  Space 行的数字取 `counts.open`。展开状态存入 localStorage，key 为 `workspace-file-tree:<user>:issues`，
  与 Apps 的做法一致。
- 点击 Issue 进入 `/spaces/$spaceId/issues/$number`，主区域渲染 `IssueDetail`，选中态沿用 `NavLink` 的
  `bg-brand-50 text-brand-700`。
- 分组标题链接到 `/issues`（跨 Space 列表），默认过滤为 open、所有 Space；页头提供「全部 / 分配给我 /
  我创建的」切换。
- 收起的侧栏显示一个 `CircleDot` 图标 NavLink，指向 `/issues`。
- Wiki 主题的 Space 页面不加 tab。入口放在侧栏，与 Apps 的做法一致；Space 文件页页头的操作区
  增加一个「Issues」链接，指向该 Space 的列表。

## 5. 客户端：Client Core、CLI 与 Agent

### 5.1 Client Core

新增 `packages/client-core/src/issue.ts`（`WorkspaceIssueFeature`）和 `issue-model.ts`
（`parseIssue`、`parseIssueSummary`、`parseTimelineItem`），从 `src/index.ts` 导出。沿用
`WorkspaceHttp.json()` 和手写解析器，与 worktree 相同，不引入生成类型。

方法：`list`、`listMine`、`get`、`timeline`、`create`、`update`、`close`、`reopen`、`comment`、
`editComment`、`deleteComment`、`labels`、`createLabel`、`updateLabel`、`deleteLabel`。

- `update` 接受 `addLabels`、`removeLabels`、`addAssignees`、`removeAssignees`、`addNodes`、
  `removeNodes`，内部先 `get` 再整体 PATCH。
- `close` 在带评论时先 `get` 并检查 `capabilities.close`，再发评论、再改状态：评论必须排在关闭
  事件之前，而权限不足的关闭不能留下一条声称已关闭的评论。
- 标签参数接受名称，由 Client Core 解析为 ID。未知名称返回 `issue-label-not-found`，不自动创建标签。
- Assignee 参数接受 `me` 或 userId。

**已知限制：** 这种先读后写在并发编辑时可能丢失另一方的修改，V1 接受这个限制。如果实际出现冲突，
再在 PATCH 中增加 `addLabelIds` 等增量字段。

### 5.2 CLI（`univer-workspace-cli issue …`）

新增 `apps/cli/src/features/issue/command.ts`（`createIssueCommand(feature)`），在 `program.ts`
注册。沿用 `executeCommand`、`present`、`--json` 的约定，输出统一用 `{ issue }`、`{ issues }`、
`{ timeline }`、`{ labels }` 包装：

```text
issue list    [--space <id>] [--state open|closed|all] [--label <name>…] [--assignee me|<userId>|none]
              [--author me|<userId>] [--search <q>] [--sort created|updated] [--limit] [--cursor]
              # 不带 --space 时调用 GET /api/issues（跨 Space）
issue get     <number> --space <id> [--timeline]
issue create  --space <id> --title <t> [--body <md> | --body-file <path|->] [--label …] [--assignee …] [--node <nodeId>…]
issue update  <number> --space <id> [--title] [--body|--body-file] [--add-label …] [--remove-label …]
              [--add-assignee …] [--remove-assignee …] [--add-node …] [--remove-node …]
issue close   <number> --space <id> [--reason completed|not-planned] [--comment <md> | --comment-file …]
issue reopen  <number> --space <id>
issue comment <number> --space <id> (--body <md> | --body-file <path|->)
issue label list|create|update|delete --space <id> …
```

- `--body-file -` 从 stdin 读取，方便 Agent 传多行 Markdown，不用处理 shell 转义。
- `issue get --timeline` 自动翻页，一次取完全部时间线。
- 评论编辑和删除 V1 不做 CLI 命令，Agent 写错评论时再追加一条。

**Skill。** 不新增 skill，在 `apps/cli/skill-data/core/SKILL.md` 中追加：

- Concepts 中加入 Issue 的定义。
- 新增一节「从 Issue 开始任务」：
  1. 执行 `issue get <n> --space <id> --timeline --json`。
  2. 用 `references[].node` 定位文件。
  3. 按现有 Worktree 规则新建 Worktree，命名为 `#<n> <title>`。
  4. 完成后执行 `worktree ready`。
  5. 执行 `issue comment` 回帖，说明改了什么，附上 `open` 得到的 review URL。
  6. 不关闭 Issue，除非用户明确要求。
- Command map 表格加入对应行。

skill-data 的变更需要用 `pnpm package:workspace-cli` 验证实际产物。仓库根
`skills/univer-workspace-cli/SKILL.md` 的发现说明补充一句 Issue 能力。

### 5.3 Agent（`packages/dsh-univer-workspace-plugin`，`apps/agent` 无需改动）

`apps/agent` 只负责 OAuth 身份和 `workspaceAuth` 服务。Issue 能力全部放在插件里：

- `provider/issues-api.ts`：HTTP 调用和 `narrow*` 解析器，从 `provider/workspace-api.ts` 汇总导出。
  插件目前不依赖 Client Core，保持这一现状，接受解析器与 Client Core 重复。
- `UniverWorkspaceService` 增加 Issue 相关的抽象方法，由 `UniverWorkspaceServiceImpl` 实现。
- `tools/issue.ts` 注册 `univer_issue` 工具，写法与 `univer_worktree` 一致，只用一个工具，
  通过 `action` 区分操作：

| action | 参数 | 说明 |
|---|---|---|
| `list` | `state`、`label`、`assignee`、`q`、`scope: "space" \| "mine"` | 默认使用会话关联的 Space；`mine` 调用跨 Space 接口 |
| `get` | `number` | 返回 Issue、完整时间线，以及每个引用文件的 `resourceId`，供 `univer_open` 直接使用 |
| `create` | `title`、`body`、`labels`、`assignees`、`resourceIds` | 接受 `resourceIds`，因为 Agent 手上拿的是 Resource ID，由插件换算成 Node ID |
| `update` | 增删字段，与 CLI 相同 | |
| `comment` | `number`、`body` | |
| `close` / `reopen` | `number`、`reason`、`comment` | |

- `resolveToolScope` 给出会话关联的 Space。关联的是个人空间时，工具返回 `UniverError(…, "ISSUES_TEAM_SPACE_ONLY")`。
- 读写都不加审批门，因为 Issue 操作都可以撤回，而 Worktree 只对 merge 和 discard 这类不可逆操作加审批。
  评论以用户身份发出，skill 要求 Agent 在评论末尾注明「（由 Agent 代为发布）」。
- `presentCall` 标题示例：「读取 Issue #12」「评论 Issue #12」。
- 插件 `skills/univer/SKILL.md` 的「Required workflow」前增加「从 Issue 开始」一节，步骤同 CLI skill，
  工具换成 `univer_issue`、`univer_worktree`、`univer_open`。Tool map 加入 `univer_issue`。
  `src/skills/plugin.ts` 的 `DEFINITIONS` 不变，因为没有新增 skill。

## 6. 实施阶段

每个阶段都可以单独合并。顺序是先有服务端合同，再让最轻的客户端（CLI）验证它，然后做 UI，
最后接入 Agent。

| 阶段 | 内容 | 完成标准 |
|---|---|---|
| **1. 模型与迁移** | V9 schema、迁移、fingerprint、fixtures；`SpaceAccess.member`；三个新的 SpaceCapabilities 字段 | 完整迁移矩阵通过；`pnpm typecheck`、`pnpm test` 通过；`data-model.md` 与 `application-design.md` 已更新 |
| **2. Issues 模块与 contract** | repository、service、router；OpenAPI；`concepts.md`；集成测试覆盖权限矩阵、编号并发、个人空间 409、非成员只读、事件写入、跨 Space 列表范围 | `api:verify` 通过；`test/integration/issues.test.ts` 覆盖第 2 节的每一行 |
| **3. Client Core 与 CLI** | `WorkspaceIssueFeature`；`issue` 命令组；core skill 更新 | 对本地 Workspace 走通 create → comment → close；`pnpm package:workspace-cli` 产物包含更新后的 skill |
| **4. Repository 主题 UI** | 共享组件、路由、Issues tab 与计数、列表、详情、新建、标签管理；Markdown viewer 的 `chrome="none"`；Textarea；文件页的「在 Issue 中引用」 | 在 1440×900 与 390×844 两个视口、亮色与暗色主题下走通主要流程；运行一次 `impeccable detect`；Agent 端 Markdown 预览没有变化 |
| **5. Wiki 主题入口与 `/issues`** | 侧栏 Issues 分组、`/issues` 跨 Space 页面、页头链接 | 切换主题后同一 URL 的内容一致；个人空间不显示入口 |
| **6. 实时刷新** | `issuesChanged` 事件；Browser 解析器与缓存失效 | 两个浏览器会话中，一方评论后另一方的时间线自动更新；公开读的非成员收不到推送 |
| **7. Agent 工具** | `issues-api.ts`、服务方法、`univer_issue`、插件 skill | 在 DSH 中说「处理 #12」，Agent 读取 Issue、打开引用文件、建 Worktree、完成后回帖，全程不向用户追问上下文 |

仓库级收尾：`pnpm typecheck`、`pnpm test`、`pnpm build`、
`pnpm --filter @univerjs/univer-workspace test:production-import`、`pnpm package:workspace-cli`。

## 7. 待定事项

这些点已按上文默认处理，实施前如需调整请提出：

1. **Viewer 能否开 Issue。** 默认可以。如果团队把 viewer 当作外部只读访客，应改为 editor 及以上。
2. **公开读的非成员。** 默认只读。GitHub 允许任何登录用户在公开仓库开 Issue，这里没有采用。
3. **Issue 删除。** V1 不提供，只能以 not planned 关闭。垃圾内容由 triage 权限的成员编辑清空。
4. **Agent 代发标记。** 默认只靠 skill 约定在正文末尾注明。如果要在服务端记录
   `created_via: agent`，需要能从 OAuth session 识别客户端，另行评估。
5. **将来关联 Worktree。** 表结构已预留扩展空间：新增 `issue_worktree_links` 表，并在事件 `kind`
   中加入 `worktree_linked`、`closed_by_merge`，只需一次增量迁移，不影响 V1 数据。

## 8. 实施记录

### 8.1 与计划不同的地方

| 计划 | 实际 | 原因 |
|---|---|---|
| 列表过滤 `label` 传标签 ID（3.4 未明确，5.1 由 Client Core 解析名称） | 服务端 `label` 参数直接收标签名（大小写不敏感） | URL、CLI、Agent 都以名称为准，省去一次往返，分享的链接也可读 |
| `references[].node` 为 `NodeSummary` | 精简为 `{ nodeId, available, name, resource }`，`resource` 只带 `id/kind/unitId/unitType` 或 `mediaType` | Issue 只需要图标、名称和 Resource ID，不需要完整能力集；不可用时 `name` 和 `resource` 为空 |
| Tab 计数与列表首屏共用缓存 | 计数用单独的 `limit=1` 请求 | 列表已改为无限翻页查询，两者的缓存结构不同；`limit=1` 的开销可以忽略 |
| Client Core 提供 `editComment`、`deleteComment` | 未提供 | CLI 不暴露这两个操作，只有 Browser 用，直接走生成的类型；没有调用者就不建 |
| Issue 正文显示「已编辑」 | 只有评论显示 | `issues.updated_at` 会被评论、标签、指派刷新，不能据此判断正文被改过 |
| Wiki 侧栏只列出自己所在的团队空间 | 用 `capabilities.createIssue` 判断成员身份 | 该能力只授予 owner 和成员，不授予公开读访客，无需新增字段 |
| 路由 `spaces_.$spaceId.issues.tsx` | 列表为 `spaces_.$spaceId.issues.index.tsx` | 同名前缀的文件会被 TanStack Router 当作 `issues/new` 等的父布局，需要 `Outlet` |
| Agent 的 409 直接透传 | `univer_issue` 把「仅限团队空间」的 409 映射为 `ISSUES_TEAM_SPACE_ONLY` | 插件对所有 409 统一报「资源被并发修改，请刷新重试」，模型会据此无意义地重试 |
| `univer_issue create/update` 只接受 `resourceIds` | 同时接受 `nodeIds`（`addNodeIds` 等） | Blob 和文件夹没有可用 `univer_open` 打开的 Univer Resource，只能按 Node 引用 |

另外新增了两处计划没写的改动：

- 仓库外壳页头右上角加了一个指向 `/issues` 的图标，对应 GitHub 顶栏的全局 Issues 入口。
- `unit-creation-facts.ts` 中协同库迁移对产品库版本的前置检查从 V8 改为 V9，否则 SDK 迁移会拒绝新库。

### 8.2 验收结果

| 项目 | 结果 |
|---|---|
| `apps/workspace` 单元与集成测试 | 341 通过（含权限矩阵、编号顺序、过滤与分页、跨空间范围、事件时间线、推送受众） |
| V8 → V9 迁移矩阵 | 源码与 `test:production-import`（生产构建）均通过：空库、已有数据与待恢复 Operation、失败回滚且备份可读、重启后不重复迁移 |
| 全仓库 `pnpm typecheck` | 通过 |
| OpenAPI | `api:lint` 通过；重新生成的文件与工作区内容逐字节一致（因尚未提交，无法用 `git diff --exit-code` 判断，改用校验和比较） |
| `packages/client-core` | 500 通过，其中 5 个针对 Issue 请求形状和集合编辑的测试 |
| `apps/cli` | 123 通过；`pnpm package:workspace-cli` 产物含更新后的 core skill 和 `issue` 命令组，打包校验与安装冒烟通过 |
| `packages/dsh-univer-workspace-plugin` / `apps/agent` | 385 / 60 通过 |
| `packages/workspace-markdown-viewer` | 13 通过；`chrome="none"` 有单独测试，默认行为不变 |
| 真实服务端联调 | CLI 对本地运行的 Workspace 走通 create → comment → close（含 stdin、`me`、`#N`），以 viewer 身份验证了 403、409、未知标签、未登录；Agent provider 对同一服务端读取列表、详情、时间线，结构与测试夹具一致 |
| 实时刷新 | 真实 WebSocket 集成测试通过；浏览器打开详情页时，CLI 追加评论，页面无需刷新即出现 |
| 浏览器 | Chrome（agent-browser）中走通新建（含标签、指派、关联文件选择器）、详情、Wiki 侧栏；Repository 主题在 1440×900 和 390×844、深色主题下检查 |
| `impeccable detect` | 变更的 UI 文件无发现 |

### 8.3 未验证

- **Agent 端到端。** 「在 DSH 中说『处理 #12』」需要真实的 LLM 会话，这里没有运行。已验证的是工具的分发和参数转换（单元测试）以及 provider 对真实服务端的读取；`get` → 建 Worktree → 完成后回帖的整段流程仍需要一次人工会话来确认模型确实按 skill 走。
- **浅色主题。** 标签色板给了浅色值，但只在深色主题下看过页面。
- **Wiki 主题移动端。** 只看了桌面宽度。
- **CI 与部署。** 没有触发，也没有提交。

### 8.4 已知限制

- 标签、指派、关联文件的增删是先读后写再整体提交；两人同时改同一集合会丢一方的修改（第 5.1 节已声明）。
- 同一毫秒内产生的事件（例如创建时同时加标签和指派）按随机 ID 排序，时间线上的先后顺序不稳定。
- 第 7 节的五个待定事项没有变化，仍按默认处理。
