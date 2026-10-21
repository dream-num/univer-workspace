# uvw：仓库 slug、PR 编号与 gh 风格 CLI 的设计与实施计划

> 状态：已实施，未发布（2026-10-21）。决策见第 2 节与第 9 节，实施中与方案不同之处见第 11 节。
>
> 本文是方案。实施后，数据模型以 `apps/workspace/docs/data-model.md` 为准，HTTP 行为以
> `apps/workspace/contracts/http` 为准，CLI 能力以 `apps/cli/README.md` 为准；三者与本文冲突时以它们为准。
>
> 相关文档：[Issues 设计](../issues/README.md)、
> [Repository Pull requests tab](../../../apps/workspace/docs/proposals/repository-pull-requests-tab.md)、
> [Repository 公共框架与 Star](../../../apps/workspace/docs/proposals/repository-framework-star.md)。

## 1. 背景与目标

Workspace Browser 已有 Repository 视图（Code、Issues、Pull requests、Pages、Settings、Star），
但 `univer-workspace-cli` 的命令面仍沿用早期的 Space、Worktree 概念：

- 仓库只能用 Space UUID 寻址；
- PR 对应的 Worktree 没有编号，只能用 UUID 寻址；
- issue 的动词（`get`、`update`）、输出包装（`{ issue }`）、参数（`--space`）与 gh 不一致。

目标是参照 GitHub CLI（gh）的命名和交互合同，把 CLI 重构为 `uvw`：

- 仓库用 `-R owner/slug` 寻址；
- issue 和 PR 用 `#N` 寻址；
- 动词、参数、输出形状向 gh 对齐；
- 后续命令组（如 `project`、`search`）可以按同一模式继续添加。

要复刻的是 gh 的**命名约定和交互合同**，不是 gh 的功能清单。gh 中 release、run、workflow、gist、
codespace、secret 等命令组在 Workspace 没有对应模型，不提供，也不做空壳。

## 2. 已确认的决策（2026-10-21）

| # | 决策 | 结论 |
|---|---|---|
| 1 | 包名与可执行文件 | npm 包名保留 `univer-workspace-cli`；`bin` 同时提供 `uvw` 和 `univer-workspace-cli`，两者是同一个程序 |
| 2 | PR 编号 | 采纳。Worktree 增加仓库内编号 |
| 3 | 仓库 slug | 采纳。新建仓库必须有符合规则的 slug；已有仓库不回填 |
| 4 | close 与 discard | 不用 `pr close` 表示 discard。discard 不可逆，使用独立动词 `pr discard`，宁可偏离 gh 也不留语义陷阱 |
| 5 | 旧命令兼容 | 不保留旧命令名和旧输出形状。`worktree` 命令组除外，见决策 7 |
| 6 | 实施顺序 | 先完成服务端建模（模型、迁移、HTTP contract、Browser 配套），再改 Client Core 和 CLI |
| 7 | `worktree` 命令组 | Worktree 是产品的关键设计，保留 `worktree` 命令组及其原有子命令名。它只是 `pr` 的命令别名：处理逻辑、参数、寻址方式和输出形状都与 `pr` 完全一致，没有独立能力（2026-10-21 追加） |

对决策 3 的澄清：“不做数据迁移”指**不回填旧数据**。新增列和索引仍然是已发布 schema 的结构变更，
按 `apps/workspace/AGENTS.md` 必须提升 `user_version`（V11 → V12），并完成迁移验证矩阵。
本方案的 V12 迁移只做结构变更，不改写任何已有行。

## 3. 设计原则

1. **服务端拥有权威寻址。** `owner/slug` 和 `#N` 的解析、唯一性和可见性都由服务端判断。
   CLI 不靠列表匹配名称来猜 ID。
2. **产品模型不改名。** HTTP contract 和数据模型继续使用 Space、Worktree。Repository 和
   Pull request 只是 Browser Repository 主题与 CLI 中的展示名称，与现有 proposal 的约定一致。
3. **对齐 gh，语义不同时明确偏离。** 动词和参数尽量与 gh 相同。产品语义不同的地方使用不同的词
   （`pr discard`、`pr ready --undo`），不借用 gh 的词造成误解。
4. **以 Agent 为先。** 任何场景都不出现交互式提示；登录保持两段式、不轮询；不提供 `auth token`
   和原始 REST 透传；不使用全局默认仓库，避免并发 Agent 互相干扰。
5. **不回填旧数据。** 没有 slug 的旧仓库、没有编号的旧 Worktree，继续用 ID 或 Browser URL 寻址。

## 4. 阶段 A：服务端建模

### 4.1 仓库 slug

**规则。**

- 字符集 `[A-Za-z0-9._-]`，长度 1–100，首字符必须是字母或数字。
- 保留大小写，比较时不区分大小写（`COLLATE NOCASE`）。
- 只有 Team Space 存储 slug；`personal` 是保留字，Team Space 不能使用。
- 唯一范围是同一个 owner：`(owner_user_id, slug)` 唯一。Team Space 的 owner 是创建者，
  当前没有转移所有权的接口，因此 owner 不会变化。

**全名。**

- Team Space 的全名是 `<owner.username>/<slug>`。
- Personal Space 不存 slug，全名按规则得出：`<username>/personal`。解析时直接使用已有的唯一索引
  `spaces_personal_owner`。因此**所有 Personal Space，包括旧数据，都能用 `owner/personal`
  寻址，不需要回填**。
- `users.username` 可以修改（`updateCurrentUser`），允许 Unicode 字母、数字和 `._-`，不允许 `/`，
  所以全名总能无歧义地解析。用户改名后旧全名失效。本期不保留改名重定向，这是已知限制，见第 8 节。

**创建。**

- `POST /api/team-spaces` 增加可选字段 `slug`。
- 显式提供时：校验格式；冲突返回 `409 SPACE_SLUG_TAKEN`；不合法返回 `400`。
- 未提供时由服务端生成，保证每个新仓库都有 slug：
  1. 把 `name` 转小写，非法字符序列替换为 `-`，去掉首尾 `-`，截断到 100 字符；
  2. 结果为空（例如纯中文名称）时使用 `repo-<Space ID 前 8 位十六进制>`；
  3. 同一 owner 下冲突时依次追加 `-2`、`-3`……
- 保持字段可选，是因为 DSH 插件（`packages/dsh-univer-workspace-plugin` 的 `FileSidebar`）
  也调用这个接口，它按自己的节奏发布。

**修改。**

- `PATCH /api/spaces/{spaceId}` 增加可选字段 `slug`，权限与重命名相同。
- 修改 `name` 不会改变 slug。
- 本期不保留旧 slug 重定向。
- 对旧仓库设置 slug 是用户在 Settings 中的主动操作，不属于数据迁移。“旧的先不管”指系统不主动回填，
  并不禁止仓库管理员自行设置。

**解析接口。**

- 新增 `GET /api/spaces/lookup?owner=<username>&slug=<slug>`，返回 `SpaceView`。
- 当 `slug=personal` 时解析为该用户的 Personal Space。
- 不可见与不存在一律返回 `404`，与现有“未授权发现返回 404”的规则一致，不泄露仓库是否存在。
- 不新增 `/api/repos` 资源，以免在产品模型中引入 Repository 实体。

**`SpaceView` 新增字段。**

- `slug: string | null`：Personal Space 和未设置 slug 的旧 Team Space 为 `null`。
- `fullName: string | null`：服务端统一计算，Personal Space 为 `<username>/personal`，
  未设置 slug 的旧 Team Space 为 `null`。客户端不重复实现这条规则。

### 4.2 PR 编号

**编号空间。**

- Team Worktree 与 Issue **共用同一 Team Space 的编号序列**，与 GitHub 相同。
  这样 `#12` 在一个仓库内只指向一个对象，`uvw browse 12` 不会有歧义。
- Personal Space 没有 Issue（接口返回 409）。User Worktree 按创建者单独编号。
  这与 Browser 现有规则一致：`worktreeBelongsToSpace` 把 User Worktree 归入当前用户的
  Personal Space。User Worktree 可能编辑其他仓库中的 Unit；这里的归属只用于编号和列表展示，
  不改变 Worktree 的权限或内容边界。

**分配方式。**

- 沿用 Issue 已有的 `MAX(number) + 1`，在同一个 `BEGIN IMMEDIATE` 事务内完成，由 SQLite 串行化写入：
  - Team：取同一 Space 下 issues 与 team worktrees 编号的最大值，再加 1；
  - User：取该创建者 user worktrees 编号的最大值，再加 1。
- 必须同时修改 Issue 的分配逻辑（`issues.repository.ts` 中的 `SELECT COALESCE(MAX(number), 0) + 1 ...`），
  把 team worktrees 纳入最大值计算。
- Issue 和 Worktree 的行不会被单独删除，只随 Space 级联删除，所以 `MAX + 1` 不会重用编号。
  如果将来增加删除功能，需要改为计数表。
- 实施时需要确认：Worktree 产品行的插入是否在单个产品事务内完成。Worktree 创建会与协同服务交互，
  编号分配必须落在产品库事务中，不能跨系统。

**旧数据。**

- 已有 Worktree 的 `number` 为 `NULL`，不回填，继续用 ID 或 URL 寻址。
- 新编号从“当前 Issue 最大编号 + 1”开始，不会与旧 Issue 冲突。

**接口。**

- `WorktreeSummary` 增加 `number: integer | null`。
- 新增 `GET /api/spaces/{spaceId}/worktrees/{number}`，返回与 `GET /api/worktrees/{id}` 相同的结构。
  Personal Space 的编号查找当前用户自己的 User Worktree。
- `GET /api/worktrees` 已经支持 `kind`、`teamSpaceId`、`scope`、`search`、cursor 和 limit，不需要新的列表接口。
  建议增加可选参数 `state`（`draft | ready | merging | merged | discarded`，可重复），
  供 `pr list --state merged|discarded` 在服务端过滤，避免客户端在分页后过滤导致结果不全。

### 4.3 PR 正文

`worktrees.summary` 已经存在，但 `PATCH /api/worktrees/{id}` 只接受 `name` 和 `visibility`。
新增 `summary` 字段。`POST /api/worktrees` 如果还不接受 `summary`，同样补上。
这样 `pr create/edit --title --body` 可以对应 `name/summary`。该项不涉及 schema 变更。

### 4.4 Schema V12

在 `prepare-current-database.ts` 现有的迁移链上新增 `v11-to-v12`，所有旧版本（V1–V11 和 legacy-v0）
最终都升级到 V12：

```sql
ALTER TABLE spaces ADD COLUMN slug TEXT COLLATE NOCASE;
CREATE UNIQUE INDEX spaces_owner_slug
  ON spaces(owner_user_id, slug) WHERE slug IS NOT NULL;

ALTER TABLE worktrees ADD COLUMN number INTEGER;
CREATE UNIQUE INDEX worktrees_team_number
  ON worktrees(team_space_id, number) WHERE kind = 'team' AND number IS NOT NULL;
CREATE UNIQUE INDEX worktrees_user_number
  ON worktrees(creator_user_id, number) WHERE kind = 'user' AND number IS NOT NULL;

PRAGMA user_version = 12;
```

- 用 Trigger 阻止 Personal Space 写入 slug，阻止 Team Space 使用保留字 `personal`。
  仓库已有用 Trigger 守护不变量的先例。
- 格式校验放在服务层。
- 迁移不改写任何已有行。
- 同步更新 `schema.sql`、V12 指纹校验和全部升级路径。
- 按 `apps/workspace/AGENTS.md` 执行：迁移前一致性备份、事务回滚、`foreign_key_check`、
  `integrity_check`、重复启动不重复迁移，并用生产构建产物验证。
- 部署说明写明：停止所有旧实例，由单个新实例完成升级。

### 4.5 Browser 配套

只修改展示和输入，不新增产品能力：

- **新建仓库对话框**：增加 slug 输入框。名称可以转换时自动填入建议值；用户可以修改；实时校验格式和冲突；
  留空时由服务端生成。
- **Settings → 常规**：显示全名 `owner/slug`、复制按钮和 slug 编辑。旧仓库在此显示“未设置”，并可以设置。
- **仓库页头与 About**：有 `fullName` 时显示 `owner/slug`。
- **Pull requests 列表与详情**：有编号时显示 `#N`，与 Issue 一致；编号为 `null` 的旧 Worktree 不显示编号。
- **PR 编号 URL**：新增路由 `/spaces/$spaceId/pulls/$number`，与 Issue 的
  `/spaces/$spaceId/issues/$number` 对应（第 9 节决策 1）。
  - 路由用 4.2 的按编号查询接口取得 Worktree，再渲染现有 PR 详情组件，不复制详情实现。
  - 沿用现有的 `section=overview|files`、`unit`、`view` 查询参数，含义不变。
  - Personal Space 的 `/spaces/<personalSpaceId>/pulls/<n>` 查找当前用户自己的 User Worktree。
  - 不可见或不存在时显示现有的 `ResourceUnavailablePage`，与 Issue 详情一致。
  - 路由文件按现有约定命名（例如 `spaces_.$spaceId.pulls.$number.tsx`），路由树通过现有 script 生成，不手工修改生成文件。
  - 有编号的 PR，列表行、页内链接和分享链接都改用新 URL。
  - 旧链接 `/worktrees?worktree=<id>&...` 继续有效，不重定向。编号为 `null` 的旧 Worktree 只能通过旧链接访问。

### 4.6 contract 与文档

- 修改 `contracts/http`（paths、schemas、`concepts.md`）。
- 运行 `pnpm --filter @univerjs/univer-workspace api:verify` 重新生成类型。
- 同步更新 `apps/workspace/docs/data-model.md`（spaces.slug、worktrees.number、共享编号序列）、
  `application-design.md`、`README.md`（V12 升级说明）。

### 4.7 阶段 A 验收

- 迁移矩阵全部通过（见 `apps/workspace/AGENTS.md`）。
- 服务端测试覆盖以下场景：
  - slug：生成、冲突追加后缀、保留字、大小写不敏感唯一、Personal Space 拒绝 slug、
    lookup 对不可见目标返回 404、旧 Team Space 的 `fullName` 为 `null`；
  - 编号：Issue 与 Team Worktree 交替创建时编号连续且唯一；User Worktree 按创建者独立编号；
    旧 Worktree 为 `null`；并发创建不重号。
- `pnpm typecheck`、`pnpm test`、`pnpm build`、`test:production-import` 通过。
- Browser smoke：新建仓库填写 slug，Settings 修改 slug，PR 列表和详情显示 `#N`；
  `/spaces/<id>/pulls/<n>` 的 Overview、Files changed 和 `unit` 参数可用；旧 worktreeId 链接仍然可用；
  不可见的编号显示 ResourceUnavailablePage。

## 5. 阶段 B：Client Core

`packages/client-core` 中的改动：

- **`repo-ref.ts`（新增）**：解析仓库引用并换取 Space ID。这是唯一新增的抽象，
  至少被 issue、label、pr、repo、space 五个命令组共用。接受以下形式：
  - `owner/slug`、`owner/personal`：调用 lookup 接口；
  - Space UUID：直接使用；
  - Browser URL：从 `/spaces/<id>`、`/spaces/<id>/issues/<n>`、`/spaces/<id>/pulls/<n>` 中取出
    Space ID，同时可以带出编号；从旧的 `/worktrees?worktree=<id>` 中取出 Worktree ID。
- **`space.ts`**：增加 lookup、create（含 slug）、update（含 slug、description、可见性）；
  模型增加 `slug` 和 `fullName`。
- **`worktree.ts`**：模型增加 `number`；增加 `getByNumber(spaceId, number)`；
  update 和 create 支持 `summary`；list 支持 `state` 过滤。
- **`issue.ts`**：接口不变。编号共享对客户端透明。
- **编号参数解析**：接受 `12`、`#12`，以及 issue 或 PR 的 Browser URL。

Client Core 不读取 CLI 的配置和环境变量。`UVW_REPO` 由 CLI 读取后传入。

## 6. 阶段 C：CLI `uvw`

### 6.1 交付形态

- `apps/cli/package.json`：
  - `name` 保持 `univer-workspace-cli`；
  - `bin` 改为 `{ "uvw": "./dist/main.js", "univer-workspace-cli": "./dist/main.js" }`。
- Commander 根命令名改为 `uvw`。帮助、错误提示和 `nextCommand` 一律使用 `uvw`。
  Windows 的 npm shim 让 `argv[1]` 指向 `main.js`，所以不根据调用名动态切换显示名。
- **持久化身份不变**：distribution ID `univer-workspace-cli`、`~/.univer-workspace-cli/`、
  session 文件、daemon socket、daemon identity，以及 `UNIVER_HOME`、`UNIVER_LICENSE`、
  `UNIVER_WORKSPACE_CLI_BUILD_ID` 全部保持。升级后不需要重新登录，也不会产生第二个 daemon。
- 版本：这是破坏性变更，下一个稳定版发布为 `v0.6.0`（当前为 `v0.5.3`）。

### 6.2 全局约定

| 约定 | 设计 | 与 gh 的关系 |
|---|---|---|
| 仓库上下文 | `-R, --repo <ref>`，未提供时读取 `UVW_REPO`，两者都没有则报错 | 对齐 `-R`、`GH_REPO`。**不提供** `repo set-default`：没有 git remote 可以推断，全局默认值会让并发 Agent 互相覆盖 |
| 结构化输出 | `--json [fields]`：不带参数时输出完整对象，带字段时只输出这些字段；输出裸对象或数组，不带 `{ issue }` 这类外层包装；未知字段报错并列出可用字段 | gh 的 `--json` 必须带字段，这里不带字段输出全部，对 Agent 更方便 |
| 默认输出 | 人类可读的简洁文本；列表为对齐的表格 | 对齐 gh 的 TTY 输出，但**不**在非 TTY 时改为 TSV，避免输出随环境变化 |
| 分页 | `-L, --limit <n>`，默认 30，内部自动翻页；去掉 `--cursor` | 对齐 gh |
| 文本输入 | `-b, --body`、`-F, --body-file <path\|->` | 对齐 gh |
| 编号参数 | `12`、`#12` 或 Browser URL；文档统一写 `12`，因为 shell 会把 `#12` 当作注释 | 对齐 gh（gh 也接受 URL） |
| 交互 | 任何情况下都不提示；缺少参数直接报用法错误 | 偏离 gh：gh 在 TTY 下会提示 |
| 当前用户 | `@me` | 对齐 gh |
| 退出码 | 0 成功；1 失败；4 需要登录 | 对齐 gh 的 4；Agent 可以据此判断是否需要登录 |
| 错误 | stderr 输出 `code: message`，必要时附提示 `uvw auth login` | 保留现有格式 |
| 帮助分组 | Core / Content / Setup 三组 | 对齐 gh。依赖 Commander 的 `helpGroup`，实施前需要确认 v15 是否提供；没有就自定义 help 格式化 |

### 6.3 命令面

旧命令不保留（决策 5）。下表“旧命令”一栏只用于说明迁移关系。

**Core**

| 新命令 | 旧命令 | 说明 |
|---|---|---|
| `uvw auth login [--complete] [--username <name>] [--password-stdin] [--json]` | `login` | 保持两段式、不轮询 |
| `uvw auth logout` | `logout` | |
| `uvw auth status [--json]` | `whoami` | 显示用户、origin、session 状态。**不提供** `auth token` |
| `uvw repo list [--owner <user>] [--type team\|personal] [-L] [--json]` | `space list` | |
| `uvw repo view [<ref>] [--json]` | — | 显示全名、描述、可见性、Star 数 |
| `uvw repo create <slug> [--name <显示名>] [--description] [--public]` | — | 只创建 Team Space；`--name` 默认等于 slug |
| `uvw repo edit [<ref>] [--name] [--description] [--visibility public\|private]` | — | |
| `uvw repo rename <new-slug> [-R]` | — | 与 gh `repo rename` 对应，修改的是 slug |
| `uvw issue list [-R] [-s open\|closed\|all] [-l] [-a] [-A] [-S <text>] [-L] [--json]` | `issue list --space` | 必须有仓库上下文。去掉 `--sort/--order/--cursor` |
| `uvw issue view <n> [-R] [-c\|--comments] [--json]` | `issue get --timeline` | |
| `uvw issue create -R -t <title> [-b\|-F] [-l] [-a] [--node <id>]` | `issue create` | `--node`（关联文件）是本产品特有的参数，保留 |
| `uvw issue edit <n> [-R] [-t] [-b\|-F] [--add-label] [--remove-label] [--add-assignee] [--remove-assignee] [--add-node] [--remove-node]` | `issue update` | |
| `uvw issue close <n> [-R] [-r completed\|"not planned"] [-c <comment>]` | `issue close` | reason 的取值与 gh 相同 |
| `uvw issue reopen <n> [-R]` | `issue reopen` | |
| `uvw issue comment <n> [-R] (-b\|-F)` | `issue comment` | |
| `uvw label list\|create\|edit\|delete [-R]` | `issue label *` | 提升为顶层命令，与 gh 一致；`--color` 只接受调色板键（gray、blue 等），不接受十六进制色值 |
| `uvw pr list [-R] [-s open\|merged\|discarded\|all] [-A @me] [-S] [-L] [--json]` | `worktree list` | `open` 包含 draft、ready、merging；`-R owner/personal` 列出自己的 User Worktree |
| `uvw pr view <n\|url\|id> [-R] [--json]` | `worktree get` | 包含关联 Unit 列表；JSON 中的 `id` 用于内容命令的 `--worktree` |
| `uvw pr create -R -t <title> [-b\|-F] [--visibility private\|space] [--idempotency-key <key>]` | `worktree create` | Team 仓库创建 Team Worktree，`owner/personal` 创建 User Worktree；新建状态总是 draft；保留原有的 `--idempotency-key`，便于 Agent 安全重试 |
| `uvw pr edit <n> [-R] [-t] [-b\|-F] [--visibility]` | `worktree update` | |
| `uvw pr ready <n> [-R] [--undo]` | `worktree ready` / `worktree reopen` | `--undo` 把 Ready 退回 Draft，对应现有的 reopen 接口 |
| `uvw pr merge <n> [-R]` | `worktree merge` | 没有 `--squash` 等选项，也不提示确认；是否允许 merge 由 Skills 约束 Agent |
| `uvw pr discard <n> [-R]` | `worktree discard` | 不可逆 |
| `uvw search issues [-a @me] [-A] [-s] [-l] [-S] [-L] [--json]` | `issue list`（不带 `--space`） | 跨仓库查询；对应 gh `search issues`，使用现有的 `GET /api/issues` |
| `uvw search prs [-A @me] [-s] [-S] [-L] [--json]` | `worktree list`（不带 `--space`） | 跨仓库列出可审阅的 Worktree；对应 gh `search prs`，使用现有的 `GET /api/worktrees`（不带 `teamSpaceId`）。`pr list` 必须有仓库上下文，原来跨仓库列出的能力由这个命令承接 |
| `uvw browse [<n>] [-R] [--unit <id>]` | `open --worktree --unit` | 只**打印** URL，不打开浏览器（偏离 gh，以 Agent 为先）；`<n>` 可以是 issue 或 PR，共用编号所以没有歧义；有编号的 PR 输出 `/spaces/<id>/pulls/<n>`，没有编号的旧 Worktree 输出旧链接；`--unit` 映射为 `unit` 查询参数 |

**`worktree` 命令组（`pr` 的别名，决策 7）**：保留原有子命令名。每个子命令与对应的 `pr` 子命令
共用同一个处理函数，参数、`-R` 与 `UVW_REPO` 解析、编号/URL/ID 寻址、`--json [fields]`、退出码完全相同：

| `worktree` 子命令 | 等价的 `pr` 命令 |
|---|---|
| `uvw worktree list` | `uvw pr list` |
| `uvw worktree get <n\|url\|id>` | `uvw pr view` |
| `uvw worktree create` | `uvw pr create` |
| `uvw worktree update <n>` | `uvw pr edit` |
| `uvw worktree ready <n>` | `uvw pr ready` |
| `uvw worktree reopen <n>` | `uvw pr ready --undo` |
| `uvw worktree merge <n>` | `uvw pr merge` |
| `uvw worktree discard <n>` | `uvw pr discard` |

- 保留的是命令名，参数和输出与 `pr` 对齐。原来的 `--scope`、`--space`、`--view`、`--name`
  改为 `-R`、`--state`、`-t/--title`；输出不再带 `{ worktree }` 外层包装。
- `worktree reopen` 保留 Worktree 自己的语义（Ready → Draft）。它位于 `worktree` 命名空间，
  不会和 gh 的 `pr reopen` 混淆。
- 两个命令组的帮助都注明对方是等价写法，避免看起来像两套能力。

**防误用的隐藏命令**：只在 `pr` 命令组下设置，`worktree` 命令组不设。`pr close` 和 `pr reopen`
不执行任何操作，以退出码 1 返回固定说明：
“Workspace 使用 `uvw pr discard`，它不可逆；要退回 Draft 请用 `uvw pr ready --undo`”。
这不是兼容旧命令，而是拦截按 gh 习惯输入的 Agent，防止它们猜测语义。

**Content**：沿用现有命令面，只做两处调整。

- `space browse|find|node ...`：保留命令名，但 `<space>` 和 `--space` 改为通过 `repo-ref` 解析，
  可以接受 `owner/slug`。`space list` 移到 `repo list`。
- `unit`、`execute`、`inspect`、`screenshot`、`lint`、`print-pdf`、`import`、`export`、
  `compile-typst`、`compile-svg`、`blob`、`asset`、`html-view`：保持不变，继续用 `--worktree <id>`。
  改为接受 `--pr <n> -R` 列为后续需求（第 9 节 9.2），本方案不做。

**Setup**：`config`、`daemon`、`skills`、`resources`、`api` 保持不变。

- `api` 继续表示 Facade API 参考，Skills 中有 23 处引用。
- **不实现** gh 风格的 `api` REST 透传。原因有三：会与现有命令重名；会让 Agent 绕过 Skills 的约束；
  会把 HTTP contract 变成事实上的 CLI 公共合同。

### 6.4 实现要点

- 每个命令组仍是一个 `createXCommand(feature)`，在 `program.ts` 中组装。
  新增 `features/repo`、`features/pr`、`features/label`、`features/search`、`features/browse`；
  删除 `features/open`。
- `features/worktree` 改造为与 `pr` 共用的实现：一组处理函数加一个命令树构造函数，
  按两张子命令名映射表（`pr` 和 `worktree`）各生成一棵命令树。不要用 Commander 的 `.alias()`：
  它只能给命令组起别名，无法把 `get` 映射到 `view`、把 `reopen` 映射到 `ready --undo`，
  而且会把 `pr close/reopen` 的拦截命令带进 `worktree` 命令组。
- 新增一个小模块，集中实现三件事：读取 `-R` 与 `UVW_REPO` 并调用 `repo-ref` 解析；
  按 `--json [fields]` 选择字段；输出文本表格。不为每个命令另写包装。
- `executeCommand` 增加退出码映射：`workspace-authentication-required` 返回 4。
- 测试：更新 `application-command-contracts.test.ts` 等命令合同测试，覆盖新命令名、参数、
  `--json` 字段选择、退出码 4、隐藏的 `pr close/reopen` 提示，以及 `nextCommand` 改为 `uvw auth login --complete`。
  对 `worktree` 与 `pr` 的每一对等价命令，断言它们对同一组输入调用同一处理函数并输出相同结果，防止两边逐渐分叉。

### 6.5 启动开销

`main.ts` 每次调用都会检查旧 daemon 的状态（超时 1 秒），并在顶层 import 全部 feature。
`issue list` 这类轻量命令不应承担渲染运行时的加载成本。阶段 C 中先在 package artifact 上测量
`uvw issue list --help` 和 `uvw issue list` 的耗时；如果明显偏慢，再把重量级 feature 改为按命令懒加载。
不预先优化。

## 7. 阶段 D：Skills、文档、打包与发布

- **Skills**：`skill-data/**` 和 `skills/univer-workspace-cli/SKILL.md` 中的命令全部改为 `uvw` 新命令面。
  - 可安装 Skill 的**名字保持** `univer-workspace-cli`，确保
    `npx skills add dream-num/univer-workspace --skill univer-workspace-cli -g` 继续可用。
  - Skill 中明确写出：用 `npm install --global univer-workspace-cli@latest` 安装，
    **不要**安装名为 `uvw` 的 npm 包（第三方占用，见第 8 节）。
  - 删除对不存在命令的引用。例如 `doctor --json` 未在 `src` 中找到，实施时需要确认它是否由 SDK preset 提供。
  - Agent 工作流改为：`uvw issue view 12 -R owner/repo` → `uvw pr create` →
    内容命令（`--worktree <pr view 返回的 id>`）→ `uvw pr ready 12` → 交付 `uvw browse 12` 的 URL。
  - 生命周期命令在 Skills 中统一写 `pr`，只在 core Skill 中说明一次：PR 就是 Worktree，`uvw worktree ...` 是等价写法，
    内容命令的 `--worktree` 接受 `pr view` 返回的 `id`。同一份 Skill 中不混用两种写法。
- **文档**：更新 `apps/cli/README.md`、`apps/cli/AGENTS.md`、根 `README.md` 与 `README.zh-CN.md`、
  `apps/agent/README*.md`。`DREAMNUM.md` 记录了 CLI 的交付名和 Skill 入口，可执行文件名的变化需要同步更新。
- **Browser 引导页**（`worktree-onboarding.tsx`）：安装命令不变（包名未变）；如果展示用法，改为 `uvw`。
- **打包**：`scripts/build-package.mjs`、`verify-package.mjs`、`smoke-package.mjs` 和
  `package-artifact.test.mjs` 验证 artifact 中**两个 bin 都存在且可执行**，smoke 测试使用 `uvw`。
  `scripts/release/policy.mjs` 的包名不变。
- **发布**：先部署阶段 A 的服务端（V12），再发布 CLI `v0.6.0`。

## 8. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| npm 上的 `uvw` 和 `uvw-cli` 已被第三方（uvworkspace）占用，且 `uvw` 包会注册 `uvw` 可执行文件 | Agent 看到“使用 uvw”后可能执行 `npm i -g uvw`，装上陌生人的包，属于供应链风险；同时装了两者的环境会出现 PATH 冲突 | 包名保持 `univer-workspace-cli`；所有文档和 Skills 只给出完整的安装命令，并明确禁止安装 `uvw` 包；`uvw --version` 输出带包名，便于确认 |
| CLI 与服务端版本错配 | 自托管部署独立升级（ADR 0003/0005）。新 CLI 连接没有 V12 的服务端时，lookup 和按编号查询会返回 404，容易被误认为“仓库不存在” | `repo-ref` 和按编号查询遇到“接口不存在”时，返回明确错误 `workspace-server-capability-missing`，并提示服务端需要升级；ID 和 URL 寻址在旧服务端上仍然可用 |
| 不兼容旧命令 | 用户环境中旧版可安装 Skill 的命令（如 `whoami`、`login`）会报 unknown command；旧脚本失效。`worktree` 的子命令名虽然保留，但参数（`--scope`、`--space`、`--view`、`--name`）和输出形状已经改变，旧脚本同样需要修改 | 服务端和 CLI 发布后，提示重新执行 `npx skills add ...` 更新 Skill；内置 Skills 由 `uvw skills get` 按版本提供，始终匹配；Commander 的 “Did you mean” 提示可以帮助 Agent 自行纠正 |
| 旧仓库没有 slug，旧 PR 没有编号 | `-R owner/slug` 和 `pr view 12` 对旧数据不可用 | 统一接受 ID 和 Browser URL；Personal Space 按规则天然可用；管理员可以在 Settings 中为旧仓库设置 slug |
| 用户名或 slug 修改后，旧的全名失效 | Agent 记录的 `owner/slug` 失效 | 本期接受这个限制，并写入文档；错误信息提示用 `uvw repo list` 重新查找；需要时再增加重定向表 |
| 共享编号要求同时修改 Issue 的分配逻辑 | 遗漏一处就会重号 | 依靠唯一索引兜底，加上 Issue 与 PR 交替创建的测试和并发测试 |
| User Worktree 的“仓库归属”只是约定 | User Worktree 可能编辑其他仓库的 Unit，但列在 `owner/personal` 下 | 在文档中说明这只用于编号和列表，不代表内容或权限边界 |
| 偏离 gh 的地方 | 熟悉 gh 的用户和 Agent 可能按 gh 习惯操作 | 偏离点集中记录（本节和 6.2）；`pr close/reopen` 隐藏命令拦截并说明 |
| 启动变慢 | 轻量命令的响应不像 gh 那样即时 | 见 6.5，先测量再决定是否优化 |
| 帮助分组依赖的 Commander API 未验证 | 可能要自己实现 help 格式化 | 实施阶段 C 前先确认 |

## 9. 已决事项与后续需求

### 9.1 已决事项（2026-10-21）

| # | 事项 | 结论 | 落实位置 |
|---|---|---|---|
| 1 | PR 的 Browser URL | 新增 `/spaces/$spaceId/pulls/$number`，保留旧的 worktreeId 链接 | 4.5、A5、6.3 的 `browse` |
| 2 | 内容命令按编号寻址（`--pr <n> -R`） | 不在本方案内实施，作为独立的后续需求 | 9.2 |
| 3 | 旧 Worktree 回填编号 | 与 slug 一致，不回填 | 4.2 |
| 4 | Issue 与 PR 关联（如 “closes #12”） | 继续推迟，不做 | — |
| 5 | Skills 使用的词 | 生命周期命令统一写 `pr`；core Skill 说明一次 `worktree` 是等价写法 | 7 |
| 6 | 后续命令组（`project`、PR 评论与 review） | 采纳统一路径：服务端模型 → contract → Client Core feature → 命令；CLI 结构不需要调整 | 9.2 |

### 9.2 后续需求（不在本方案范围内）

- **内容命令按编号寻址**：为 `execute`、`inspect`、`screenshot`、`lint`、`print-pdf`、`import`、`export`、
  `compile-*`、`unit`、`html-view` 增加 `--pr <n> -R`，作为 `--worktree <id>` 的等价写法。
  阶段 C 完成后单独立项；在此之前，Agent 通过 `uvw pr view <n> --json id` 取得 Worktree ID。
- **`project` 命令组、PR 评论与 review**：各自单独立项，按上面的统一路径实施。

## 10. 实施顺序与检查点

| 步骤 | 内容 | 检查点 |
|---|---|---|
| A1 | V12 迁移、`schema.sql`、指纹、全部升级路径 | 迁移矩阵通过 |
| A2 | slug：规则、生成、lookup、PATCH、`SpaceView.slug/fullName`、Trigger | 服务端测试通过 |
| A3 | 编号：共享序列、User 编号、Issue 分配改造、`WorktreeSummary.number`、按编号查询、`state` 过滤、`summary` 可编辑 | 服务端测试与并发测试通过 |
| A4 | OpenAPI、`concepts.md`、生成物 | `api:verify` 通过 |
| A5 | Browser：新建对话框 slug、Settings、页头全名、PR `#N`、`/spaces/$spaceId/pulls/$number` 路由 | Browser smoke；typecheck、test、build 通过 |
| A6 | 文档：data-model、application-design、README（V12 升级说明） | 链接检查、`git diff --check` |
| B1 | Client Core：`repo-ref`、space、worktree、编号解析 | 单元测试通过 |
| C1 | CLI：bin 与根命令名；全局约定模块；`auth`、`repo`、`issue`、`label`、`pr`（含 `worktree` 别名）、`search`、`browse`；删除其他旧命令 | 命令合同测试通过 |
| C2 | 测量启动耗时，必要时改为懒加载 | 在 artifact 上测量 |
| D1 | Skills、README、AGENTS、DREAMNUM、onboarding | 文档检查 |
| D2 | 打包脚本验证两个 bin；`pnpm package:workspace-cli`，并对 artifact 运行 smoke 和 verify | artifact 验证通过 |
| D3 | 全仓库 `pnpm typecheck`、`pnpm test`、`pnpm build`、`test:production-import` | 全部通过 |

每个阶段单独提交 PR，并按 Conventional Commits 命名。例如：

- `feat(workspace)!: add repository slugs and shared issue/PR numbering`
- `feat(cli)!: rename the command surface to uvw`

## 11. 实施记录（与方案的差异）

- **`state` 过滤**：Worktree 状态在协同服务中，产品库无法按状态过滤，所以服务端按候选批次扫描直到页满或耗尽，
  游标指向最后一个已返回项。过滤后的最后一页可能为空（`nextCursor` 非空但 `items` 为空），客户端继续翻页即可。
- **`pr list` / `search prs` 的 `-A`**：服务端没有作者过滤，Client Core 在翻页时按创建者过滤（`creatorId` / `creatorUsername`），
  `-L` 计数的是过滤后的结果。
- **Client Core 轻量入口**：新增 `@univerjs/univer-workspace-client-core/product`，只含 HTTP 工作流（认证、Space、Issue、Worktree、寻址）。
  CLI 的产品命令（`auth`、`repo`、`issue`、`label`、`pr`、`worktree`、`search`、`browse`）只从该入口导入，
  `main.ts` 按第一个参数分流：产品命令不加载 Univer 运行时（实测 `uvw issue list` 约 0.2 秒，内容命令仍约 1.5 秒）。
  这取代了 6.5 中“先测量再决定”的预案。
- **PR 编号寻址**：编号参数先转为 Worktree ID；仅需要 ID 的命令（`edit`、`ready`、`merge`、`discard`）对 ID 参数不额外请求。
- **旧服务端检测**：lookup / 按编号查询遇到 404 时，再调用 `GET /api/spaces`，若返回的 Space 视图没有 `fullName` 字段则判定为旧服务端，
  报 `workspace-server-capability-missing`。仅在 404 路径多一次请求。
- **`browse <n>`**：编号在同一仓库内由 Issue 与 Team PR 共用，先按 PR 查询，404 后再按 Issue 查询。
- **帮助分组**：Commander 15 提供 `helpGroup`，直接使用，没有自定义 help 格式化。
- **打包**：artifact 的 `bin` 含 `uvw` 与 `univer-workspace-cli` 两个启动器；`package:verify` 与 `package:smoke` 已对 artifact 运行并通过
  （smoke 使用 `uvw` 与 `univer-workspace-cli` 两个入口）。
