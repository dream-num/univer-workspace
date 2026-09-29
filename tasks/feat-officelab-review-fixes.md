# feat-officelab 评审修复计划

范围：`origin/main...feat-officelab`（21 commits，38 files）。
结论：无数据库 schema / 迁移变更，`apps/workspace/AGENTS.md` 的数据库协议不适用；下列为前端行为问题与卫生项。

## 数据库协议核对（无需动作）

| 检查项 | 结果 |
| --- | --- |
| `schema.sql` / `migrations/*` / `PRAGMA user_version` | 未改动 |
| 新增查询 | `listHtmlViews` 增加参数化 `AND node.space_id = ?`，走已有列，不需要迁移 |
| 访问控制 | 过滤在逐行 `access.resolveResource` 之前，不绕过 ACL |
| HTTP contract | `views.yaml`、bundled OpenAPI、`schema.d.ts`、router/service 校验一致 |

待补：运行 `pnpm --filter @univerjs/univer-workspace api:verify`，确认生成物无漂移。

## 修复项

### F1（中）个人空间的 PRs 标签永远为空

- 位置：
  - `apps/workspace/web/src/features/spaces/repository-tabs.tsx:35`
  - `apps/workspace/web/src/features/worktrees/worktree-dashboard.tsx:111`
  - `apps/workspace/web/src/routes/spaces.$spaceId.tsx:110`
  - `apps/workspace/web/src/routes/-workspace-layout.tsx`（`activeTaskCount` 的 repository 分支）
- 原因：过滤条件 `worktree.teamSpace?.id === spaceId`。`kind: "user"` 的 Worktree 没有 `team_space_id`（`teamSpace` 为 `null`），个人空间永远匹配不到。
- 方案：抽一个共享谓词，例如放在 `features/worktrees` 下的 `worktreeBelongsToSpace(worktree, space)`：
  - 团队空间：`worktree.teamSpace?.id === space.id`
  - 个人空间：`worktree.kind === "user"`
  - 四处调用统一改用该谓词，调用方需要拿到 `space.type`（`RepositoryTabs`、`WorktreeDashboard` 已可通过 `spacesQueryOptions` 获取；`WorktreeDashboard` 目前只收 `spaceId`，需要传入空间类型或在内部查询）。
- 备选：个人空间不显示 PRs 标签。这会丢功能，不推荐。
- 验证：
  - 为谓词写单测：team 命中、team 不命中他人空间、personal 命中 user worktree、personal 不命中 team worktree。
  - 手动：repository 主题下打开个人空间，PRs 标签计数与列表与 `/worktrees` 全局列表中的个人任务一致。

### F2（低–中）设置 / 成员 / 回收站页面影响默认 Wiki 主题

- 位置：`spaces_.$spaceId.settings.tsx`、`spaces_.$spaceId.members.tsx`、`spaces_.$spaceId.trash.tsx`
- 现象：三个路由无条件渲染 `RepositoryTabs` 和 `SpaceSettingsNav`，并删除了 `selectedView="members" | "trash"`。Wiki 主题下侧边栏回收站项失去高亮，且页面出现仓库标签栏。
- 方案：读取 `useTheme().workspaceTheme`。
  - `repository`：保持当前实现。
  - `wiki`：保留原 `selectedView`，不渲染 `RepositoryTabs` / `SpaceSettingsNav`，页面内容直接放在 `WorkspaceLayout` 下，与 main 分支一致。
- 前置确认：仓库主题是否仍定位为实验性（localStorage 开关）。若已决定切为默认主题，则此项改为删除 Wiki 分支，并在文档里说明。
- 验证：Wiki 主题下三个页面与 `origin/main` 视觉一致，回收站导航项高亮；repository 主题不变。

### F3（低）通用设置表单对无权限用户可编辑

- 位置：`spaces_.$spaceId.settings.tsx`
- 现象：loader 只检查空间存在。无 `renameSpace` 能力的用户（例如只有 `viewTrash`）直达 URL 会看到可编辑表单，保存时才由服务端拒绝并 toast。
- 方案：`SpaceGeneralSettings` 中当 `!space.capabilities.renameSpace` 时禁用输入和保存按钮，或 loader 中 `redirect` 到该用户第一个可用的设置分区。优先禁用表单，改动最小。
- 待确认：服务端 `PATCH /api/spaces/{spaceId}` 对无权限用户与个人空间 `publicRead` 的拒绝语义，读 `spaces` 模块的 service 并补一条集成测试（已有则跳过）。

### F4（低）卫生项

- `-workspace-layout.tsx:34`：拆开被合并到同一行的两个 `import`。
- `pnpm-lock.yaml`：52 处 `resolution` 被追加 `tarball:` URL，无版本变化。用 `git checkout origin/main -- pnpm-lock.yaml` 还原，再确认 `pnpm install --frozen-lockfile` 通过。若确为有意为之，在 PR 描述里说明原因。
- `cases/` 为未跟踪目录，不属于本分支，不要加入提交。
- `.gitignore` 新增的 `.gstack/` 无问题，保留。

## 执行顺序

1. F4（拆 import；lockfile 见执行记录）。
2. F1（谓词 + 单测 + 四处调用）。
3. F2（按主题分支）。
4. F3（表单禁用）。
5. 验证：
   ```bash
   pnpm --filter @univerjs/univer-workspace api:verify
   pnpm typecheck
   pnpm test
   pnpm build
   ```
   无 HTTP contract 或数据库改动，这些修复不需要迁移矩阵。

## 未覆盖的评审范围

`home.tsx`、`node-browser.tsx` 以及 `spaces.$spaceId.tsx` 的完整视觉与 CSS 逻辑未逐行评审，合并前建议在 repository / wiki 两种主题、桌面与 ≤720px 宽度下手动过一遍。

## 执行记录（2026-09-29）

- F4：`-workspace-layout.tsx` 的合并 import 已拆行。`pnpm-lock.yaml` 曾还原到当时的 `origin/main`；随后 rebase 到新的 `origin/main`（其自身已带这些 `tarball` 字段），还原提交反而会删掉 main 的内容，因此已丢弃，现在分支的 lockfile 与 main 完全一致。
- 部署事故（2026-09-29）：分支基于 V7 的旧 main，而目标环境数据库已被含 #110 的 main 升到 V8，旧镜像启动时报 `Unsupported product database version 8`。处理：rebase 到最新 `origin/main`；分支无 schema 变更，`server/src/db` 与 main 无差异，目标版本为 V8。
- F1：新增 `web/src/features/worktrees/worktree-space.ts` 的 `worktreeBelongsToSpace` 与 4 条单测；`repository-tabs.tsx`、`worktree-dashboard.tsx`、`spaces.$spaceId.tsx`、`-workspace-layout.tsx` 四处调用已统一。
- F2：设置 / 成员 / 回收站路由按 `workspaceTheme` 分支；Wiki 保留 `selectedView`，不渲染 `RepositoryTabs` / `SpaceSettingsNav`。
- F2b（实施时发现的同类回归）：`spaces.$spaceId.tsx` 原本只在仓库分支保留管理入口，Wiki 主题下 Members / Settings 按钮丢失，已恢复（Settings 指向新路由）。
- F3：无 `renameSpace` 能力时禁用名称、公开读取与保存；服务端 403 语义已由 `test/integration/permissions.test.ts:160` 覆盖，未新增测试。
- 验证：`pnpm --filter @univerjs/univer-workspace api:verify` 通过；`pnpm --filter @univerjs/univer-workspace test` 61 个文件 299 条通过；根 `pnpm build` 通过；`apps/workspace` typecheck 通过。根 `pnpm test` 在 `apps/agent/desktop` 的 `profile-runtime.test.mjs` 失败（`pnpm config get overrides --json` 返回空导致 `JSON.parse` 报错），该包不在本分支改动范围内。
