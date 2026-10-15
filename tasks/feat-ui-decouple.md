# feat-ui-decouple 重构计划：UI Mode 与领域层解耦

依据：[`apps/workspace/docs/proposals/ui-mode-decoupling.md`](../apps/workspace/docs/proposals/ui-mode-decoupling.md)
（下文简称"提案"，风险编号 R1–R8、N1–N8 与提案一致）。
范围：只改 `apps/workspace/web/src`、`apps/workspace/test`、`apps/workspace/docs`。不改服务端、HTTP contract、
数据库、CLI、Agent 和 `packages/**`。路径下文省略 `apps/workspace/web/src/` 前缀。

## 硬约束

- 每个任务是一个独立 PR，合入后 wiki 和 repository 两种 mode 的外部行为不变：URL、请求的 method/path/body、
  成功后的落点、文案、localStorage key（`univer-workspace-layout-theme` 等）。
- 不引入新依赖。单元测试用 Vitest 的 node 环境；浏览器验证用 `test/browser/*.mjs` 已经在用的 `agent-browser`。
- 移动代码与修改代码分开提交：同一个 PR 里先有一个"纯移动"的 commit，再有"删分支 / 改写"的 commit，
  方便评审用 `git diff -M` 看清楚。
- 遇到以下情况停下来确认：需要新依赖；某个任务必须改变外部行为才能继续；单个 PR 的 diff 超过约 800 行
  且不是纯移动。

## 通用验证命令

```bash
# V-static
pnpm --filter @univerjs/univer-workspace typecheck
pnpm --filter @univerjs/univer-workspace test
pnpm --filter @univerjs/univer-workspace build

# V-smoke（先在两个终端启动 dev 和 dev:server）
WORKSPACE_TEST_ORIGIN=http://127.0.0.1:5173 node --test test/browser/ui-modes.smoke.mjs
```

每个任务的"验证"都隐含 V-static。标注了 V-smoke 的任务，还要把截图和请求记录与 T0 的基线比较。

## 依赖图

```text
M0 安全网        T0 ui-modes 冒烟脚本 + 基线
                    │
M1 下沉共享部分  ├── T1 领域规则 ─────────────┐
                 ├── T2a mode 状态独立          │
                 │     └── T2b 注册表 + 文案    │
                 └── T3.0 缓存失效 helper       │
                       └── T3.1–T3.6 领域命令（各 feature 可并行）
                                                │
M2 外壳          T4a 抽出与 mode 无关的部件 ◄───┘（需要 T2b、T3.1）
                    └── T4b 复制成两个 shell
                          └── T4c 删除 shell 内的 mode 分支
                                │
M3 页面          T5.1 home → T5.2 space → T5.3 folder → T5.4 settings/members/trash → T5.5 worktrees → T5.6 issues
                    （每个都依赖 T4c；彼此按顺序，因为都改 registry 的 pages 类型）
                                │
M4 收尾          T6a feature 组件去 mode 化 ─┐
                 T6b repository 组件迁入 modes ├── T7 边界测试 + 文档
                 T6c 样式作用域 ─────────────┘
```

T1、T2a、T3.0 之间互不依赖，可以并行。T3.x 各 feature 之间互不依赖。

## M0 安全网

- [x] **T0：两种 mode 的冒烟脚本和行为基线**（关闭 R8 的验证缺口；为 N1、N2、N4、N7 提供检查手段）
  - 做什么：新增 `apps/workspace/test/browser/ui-modes.smoke.mjs`，写法沿用 `repository-settings.mjs`：
    - 用页面内 `fetch` 注册一个用户，建 Team Space、一个文件夹（`POST /api/nodes`）和一个 Sheet
      （`POST /api/resources` 后轮询 `/api/operations/{id}` 直到 `completed`）。
    - 对 `MODES = ["wiki", "repository"]` 中的每一个，设置 localStorage 后访问这些 URL：`/home`、`/home?view=shared`、
      `/spaces/<team>`、`/spaces/<team>?view=prs`、`/spaces/<team>?view=apps`、`/spaces/<personal>`、`/nodes/<folder>`、
      `/nodes/<sheet>`、`/spaces/<team>/settings`、`/spaces/<team>/members`、`/spaces/<team>/trash`、
      `/spaces/<team>/issues`、`/worktrees`、`/worktrees?spaceId=<team>`、`/apps`。
    - 每个页面记录：最终 URL、`document.title`、地标是否存在（`aside`、`nav[aria-label]` 的 tab 栏、`main h1`、
      面包屑），写入 `<baseline>/<mode>/<slug>.json`；截全页图 `<slug>.png`。另在 390×844 视口对 `/home` 和
      `/spaces/<team>` 各截一张。
    - 两个写操作开 HAR：设置页改名；在 `/spaces/<team>` 建文件夹。记录请求的 method、path、body 字段名和成功后 URL。
    - 基线目录取 `UI_MODES_BASELINE_DIR`，默认 `os.tmpdir()/univer-workspace-ui-modes`，不写进仓库。带
      `--update-baseline`（环境变量 `UI_MODES_UPDATE=1`）时覆盖基线，否则与基线比较：JSON 逐字段相等，截图用
      `agent-browser diff screenshot --baseline`。
  - 验收：在当前 `main` 上生成基线后再跑一次，全部通过；把 localStorage 改成别的 mode 再跑，脚本失败并指出差异。
  - 验证：上述两次运行；`git status` 只出现这一个新脚本。
  - 文件：`apps/workspace/test/browser/ui-modes.smoke.mjs`（新增）。
  - 规模：S。依赖：无。

## M1 下沉共享部分

- [x] **T1：领域规则改为纯函数**（R5）
  - 做什么：
    - 新增 `features/worktrees/worktree.rules.ts`：`OPEN_WORKTREE_STATES`、`isOpenWorktree(state)`；把
      `worktree-space.ts` 的 `worktreeBelongsToSpace` 移入，注释改为领域描述（个人 Worktree 属于个人 Space），
      删除 `worktree-space.ts`，测试文件改名为 `worktree.rules.test.ts`。
    - 新增 `features/spaces/space.rules.ts`：`spaceSupportsIssues(space)`、`spaceSupportsMembers(space)`
      （`type === "team"`），与 capability 判断组合的地方保持原有组合不变。
    - 替换调用点：`features/spaces/repository-tabs.tsx:13,29,34`、`features/worktrees/repository-pr-state.tsx:7`
      （改为 re-export 或直接引用 rules）、`routes/spaces.$spaceId.tsx:642-648`、`routes/-workspace-layout.tsx:485`、
      `features/spaces/settings-nav.tsx:24`、`features/issues/issues-sidebar.tsx:21`、`features/nodes/node-actions-menu.tsx:53`。
    - `index.ts` 导出新函数。
  - 验收：`rg -n '"draft", "ready", "merging"' apps/workspace/web/src` 只剩 `worktree.rules.ts`；上面 4 处 `type === "team"`
    改为调用 rules；行为不变。
  - 验证：新增 `worktree.rules.test.ts`（team 命中、team 不命中他人、personal 命中 user、personal 不命中 team、
    三种打开状态与其余状态）和 `space.rules.test.ts`；V-static；V-smoke（重点：repository tab 的 PR 计数、wiki 的
    Workbench 徽标、Issues tab 在个人 Space 下不出现）。
  - 规模：S。依赖：无。

- [x] **T2a：mode 状态从 ThemeProvider 中拆出**（R1 前置、R8）
  - 做什么：
    - 新增 `shared/ui-mode.tsx`：`parseUiMode(raw: unknown, known: readonly M[], fallback: M): M`、
      `UiModeProvider<M>`、`useUiMode()`。存储 key 仍是 `univer-workspace-layout-theme`，读写失败时的处理照抄
      `theme.tsx:12-18,73-80`。此时 mode 集合仍写死为 `["wiki", "repository"]`，T2b 再改为来自注册表。
    - `shared/theme.tsx` 删除 `workspaceTheme` 状态和 `readWorkspaceTheme`；`useTheme()` 的返回值暂时保留
      `workspaceTheme`、`setWorkspaceTheme` 两个字段，内部转发到 `useUiMode()`，让 15 个调用点不用改。
    - `app/providers.tsx`：`UiModeProvider` 包在 `ThemeProvider` 外层（`LanguageProvider` 仍然读得到 mode）。
  - 验收：明暗主题切换不再改变 `useUiMode()` 的引用；mode 的读写行为与之前逐字节相同（同 key、同默认值、同容错）。
  - 验证：新增 `shared/ui-mode.test.ts`，覆盖 `parseUiMode` 的已知值、未知值、`null`、非字符串；V-static；V-smoke；
    手动：切换 mode 后刷新，选择保留；隐私模式禁用 storage 时页面不报错。
  - 规模：S。依赖：无。

- [x] **T2b：注册表骨架；文案覆盖随 mode 注册**（R1、R4 文案部分；引入 N3、N6）
  - 做什么：
    - 新增 `modes/registry.ts`，`ModeDefinition` 此时只有 `label: MessageKey` 和 `messages: ModeMessages`；
      `modes = { wiki, repository } as const satisfies Record<string, ModeDefinition>`；导出
      `WorkspaceMode = keyof typeof modes`、`MODE_IDS`、`useModeDefinition()`。
    - 新增 `modes/wiki/index.ts`（`messages: {}`）、`modes/repository/index.ts`、`modes/repository/messages.ts`
      （`shared/i18n.tsx:1257-1335` 的 `repositoryMessages` 原样移入，类型不变）。
    - `shared/i18n.tsx`：导出 `ModeMessages` 类型；`LanguageProvider` 改为接收 `overrides?: ModeMessages` prop，删掉
      对 `useTheme()` 的依赖和 `repositoryMessages`。
    - `app/providers.tsx`：读当前 mode，把 `modes[mode].messages` 传给 `LanguageProvider`；在 `document.documentElement`
      上设置 `data-ui-mode`（T6c 才会用到）。`UiModeProvider` 的 mode 集合改为 `MODE_IDS`。
    - 设置弹窗（`routes/-workspace-layout.tsx:899-906`）的 `Segmented` 选项改为遍历 `MODE_IDS`，label 用
      `t(modes[id].label)`；wiki 的 label 现在是字面量 `"Wiki"`，需要新增一个 `MessageKey`（两种语言都写 `"Wiki"`）
      以保持显示不变。
  - 验收：`rg -n 'repositoryMessages|workspaceTheme|"repository"' apps/workspace/web/src/shared` 无结果；`modes/` 中没有
    import `routes/` 或其他 mode 目录。
  - 验证：`shared/i18n.test.ts` 新增：每个 mode 的覆盖 key 都存在于 `messages`；同一 mode 的 zh-CN 和 en-US 覆盖
    key 集合相等（N6）。V-static；V-smoke（重点：repository 下"仓库""协作者"等文案、设置弹窗选项）。
  - 规模：M。依赖：T2a。

- [x] **T3.0：产品列表缓存失效收敛为一个函数**（R3 前置）
  - 做什么：在 `features/nodes/` 新增 `nodes.commands.ts`，导出
    `invalidateProductLists(client, { spaceId?, htmlViews? })`，统一失效 `["nodes"]`、`recentResourcesQueryKey`、
    `ownedByMeQueryKey`、`sharedWithMeQueryKey`，可选 `trashQueryKey(spaceId)` 和 `htmlViewsQueryKey`。替换这些
    手写块：`create-node-dropdown.tsx:61-63`、`node-actions-menu.tsx:69-72,98-101`、`node-browser.tsx:132-135`、
    `resource-header.tsx:60-64`、`workspace-navigation-tree.tsx:48-61`（`refreshProductLists`）、`routes/nodes.$nodeId.tsx:40-44`、
    `features/trash/trash-list.tsx:42-43`、`features/worktrees/worktree-change-feed.ts:55-58`。
  - 注意：现有调用点失效的集合不完全一致（`create-node-dropdown` 不失效 `shared-with-me`；`trash-list` 只失效 `nodes`
    和 `owned-by-me`）。统一成并集只会多一次后台重新请求，不会少更新，界面结果不变；这是本计划中唯一一处
    "请求数量会变"的地方，在 PR 描述中列出每个调用点多出的 key。
  - 验收：`rg -n 'queryKey: \["(nodes|recent-resources|owned-by-me|shared-with-me)"\]' apps/workspace/web/src` 只剩
    `*.queries.ts` 中的定义和 `nodes.commands.ts`。
  - 验证：V-static；V-smoke（建文件夹、改名后列表刷新）。
  - 规模：S。依赖：无。

- [x] **T3.1–T3.6：写操作收敛为领域命令**（R3；引入 N1）

  所有子任务都按同一个规则写：命令 hook 放在对应 feature 的 `*.commands.ts`，从 `index.ts` 导出；命令负责 API 调用、
  Idempotency-Key、`waitForCreatedResource`、缓存失效（用 T3.0 的 helper），返回 `useMutation` 的结果；
  **导航、toast、关闭弹窗不放进命令**，由调用方通过 `mutate(vars, { onSuccess })` 处理。每个子任务的 PR 描述
  附上 V-smoke 中对应写操作的请求对比（method、path、body 字段、成功后 URL）。

  | 子任务 | 命令 | 替换的调用点 | 行为注意 |
  | --- | --- | --- | --- |
  | T3.1 spaces | `useUpdateSpace(spaceId)`、`useCreateTeamSpace()`、`useToggleSpaceStar(spaceId)` | `routes/spaces_.$spaceId.settings.tsx:85-125`；`routes/-workspace-layout.tsx:1057`（`CreateTeamDialog`）与 `features/nodes/workspace-navigation-tree.tsx:75`；`features/spaces/repository-header.tsx:47-75` | settings：wiki 一次提交三个字段并导航回 Space 页，repository 按字段分别提交且留在原页（N1）。两种字段组合和两种 `onSuccess` 都留在调用方。Star 的乐观更新和回滚属于命令 |
  | T3.2 nodes / resources | `useCreateFolder()`、`useCreateUniverResource()`、`useUploadBlob()`、`useUpdateNode()`（改名 / 移动）、`useTrashNode()` | `features/nodes/create-node-dropdown.tsx:70,111,194`；`workspace-navigation-tree.tsx:83,100,131,139,147,231,252`；`node-browser.tsx:119`；`node-actions-menu.tsx:61,85`；`resource-header.tsx:45` | 建资源有两份实现，先逐行比较等待提示、错误文案和创建后导航，合并成一份；`workspace-navigation-tree.tsx` 的 `WorkspaceFileBrowserDataSource` 改为调用命令，`packages/workspace-file-browser` 的接口不变 |
  | T3.3 permissions | `useSetNodeGrant()`、`useRemoveNodeGrant()`、`useSetLinkSharing()`、`useSetMemberRole()`、`useRemoveMember()` | `features/permissions/share-dialog.tsx`（3 个 mutation）；`workspace-navigation-tree.tsx:185,192,198`；`features/permissions/team-member-manager.tsx:50,72,87` | 分享在 wiki 侧栏和通用弹窗各有一份，合并后两处行为一致 |
  | T3.4 trash | `useRestoreTrashBatch()`、`usePurgeTrashBatch()` | `features/trash/trash-list.tsx:33,50` | — |
  | T3.5 issues | `useCreateIssue()`、`useUpdateIssue()`、`useAddIssueComment()`、`useUpdateIssueComment()`、`useDeleteIssueComment()`、`useCreateIssueLabel()`、`useUpdateIssueLabel()`、`useDeleteIssueLabel()` | `features/issues/issue-new.tsx:46`；`issue-detail.tsx:82,93,494,508`；`issue-labels-manager.tsx:43,174,175` | — |
  | T3.6 worktrees | `useWorktreeLifecycle(worktreeId)`（ready / merge / discard）、`useToggleUnitRemoval(worktreeId)` | `features/worktrees/worktree-review-panel.tsx` 的 `removal`、`action` 两个 mutation | `RepositoryPullRequestLayout` 收到的 `actions` 仍由 panel 组装，本任务不改 |

  - 已完成 T3.1：三个 Space 命令已抽出；386 项测试、typecheck、build、34 张基线截图及 settings 专项通过。
    请求字段与导航对比见提案的「T3.1 请求与导航对比」。
  - 已完成 T3.2：节点、资源、Blob 上传与文档导入命令已抽出；394 项测试、typecheck、build、
    34 张基线截图通过，传输兼容差异与删除刷新顺序见提案的「T3.2 命令与行为保留」。
  - 已完成 T3.3：五个权限命令已抽出；394 项测试、typecheck、build、34 张基线截图及权限专项通过。
    请求合同、定向缓存失效和服务端拒绝验证见提案的「T3.3 权限命令与请求合同」。
  - 已完成 T3.4：恢复与永久删除命令已抽出；typecheck、build、34 张基线截图及回收站专项通过。
    全量 394 项首轮 388 通过、6 项超时；对应 3 文件单独重跑 37 项全部通过，未修改超时阈值。
    请求合同和刷新顺序见提案的「T3.4 回收站命令与请求合同」。
  - 已完成 T3.5：八个 Issues 命令已抽出；394 项测试、typecheck、build、34 张基线截图、
    两种 mode 的 Issues 专项通过。请求合同及评论编辑时序见提案的「T3.5 Issues 命令与请求合同」。
  - 已完成 T3.6：Worktree 生命周期及移除标记命令已抽出；394 项测试、typecheck、build、
    34 张基线截图、PR 浏览器专项和 panel 专项单测通过。请求、幂等键及提示语义见提案的
    「T3.6 Worktree 命令与请求合同」。T3 源码扫描仅剩计划排除的认证相关组件写请求。

  - 不在范围：`auth-card.tsx`、`cli-login.tsx`，以及 `-workspace-layout.tsx` 中的登出、改资料、改密码、解绑 OAuth。
    它们与 mode 无关，T4a 只移动不改写。
  - 验收（全部子任务完成后）：`rg -n 'api\.(POST|PATCH|PUT|DELETE)' apps/workspace/web/src --glob '*.tsx'` 只剩上述
    认证相关文件。
  - 验证：每个子任务 V-static + V-smoke；T3.1 额外跑 `test/browser/repository-settings.mjs`；T3.6 额外跑
    `test/browser/pull-requests.smoke.mjs` 和 `test/unit/worktree-review-panel.test.ts`；T3.5 额外跑
    `test/browser/issues.smoke.mjs`。
  - 规模：每个子任务 S–M，T3.2 为 M。依赖：T3.0；T3.1 中的 `useCreateTeamSpace` 是 T4a 的前置。

## M2 外壳归 mode 所有

`modes/` 不能导入 `routes/`，所以外壳里与 mode 无关的部件要先离开 `routes/-workspace-layout.tsx`。`shared/` 现在不依赖
TanStack Router，这一点保持不变，用到 `Link` 的部件放进 `features/`。

- [x] **T4a：抽出与 mode 无关的外壳部件（纯移动）**（N2 前置）
  - 做什么：从 `routes/-workspace-layout.tsx` 移出，代码不改：

    | 部件 | 当前位置 | 目标位置 |
    | --- | --- | --- |
    | `ProfileDialog`、`PasswordDialog`、`TrialNoticeDialog`（含 `SELF_HOST_REPOSITORY_URL`） | 1182、1387、1135、1133 行 | `features/account/`（新 feature，`index.ts` 导出） |
    | 账号菜单（`MenuRoot`，770-825 行）、应用设置弹窗（889-962 行） | `AuthenticatedWorkspaceLayout` 内联 | `features/account/account-menu.tsx`、`app-settings-dialog.tsx`；mode 相关的菜单项和选项由 props 传入 |
    | `CreateTeamDialog` | 1042 行 | `features/spaces/create-team-dialog.tsx`，内部改用 T3.1 的 `useCreateTeamSpace()` |
    | `NavLink`、`BrandMark`、`WorkspaceHeaderSearch` | 979、971、107 行 | `features/shell/`（新 feature：外壳构件，不含业务数据） |
    | `RepositoryTab`、`RepositoryBreadcrumb` 类型 | 96、98 行（与 `features/spaces/repository-tabs.tsx:11` 重复） | 暂时统一到 `features/spaces` 的那一份，T6b 再移入 `modes/repository` |

    `routes/-workspace-layout.tsx` 对 `WorkspaceHeaderSearch`、`CreateTeamDialog` 保留 re-export，`home.tsx`、`nodes.$nodeId.tsx`、
    `worktrees.tsx`、`spaces_.$spaceId.{members,trash}.tsx` 本任务不改 import。
  - 验收：`-workspace-layout.tsx` 只剩 `WorkspaceLayout`、`VisitorLayout`、`AuthenticatedWorkspaceLayout`、`RepositoryBreadcrumbs`、
    `workspaceViewTitle`；`features/account`、`features/shell` 不 import `routes/`。
  - 验证：V-static；V-smoke（截图零差异，含账号菜单、设置弹窗打开态：在冒烟脚本里为两种 mode 各补一张打开态截图）。
  - 规模：M（纯移动，约 600 行）。依赖：T2b（设置弹窗的选项来自注册表）、T3.1。
  - 已完成：公共部件及现有 BreadcrumbSeparator 已移动，原入口保留 re-export；路由文件只剩五个函数。
    账号菜单和设置打开态在移动前补录，38 张截图移动后零差异；394 项测试、typecheck、build 通过。
    八个整段移动函数体与移动前逐字一致；详情见提案的「T4a 外壳公共部件移动」。

- [x] **T4b：把 `AuthenticatedWorkspaceLayout` 复制成两个 shell**（R2 外壳部分；N2）
  - 做什么：
    - `modes/wiki/wiki-shell.tsx`、`modes/repository/repository-shell.tsx`：各自是 `AuthenticatedWorkspaceLayout` 的完整拷贝
      （第一个 commit 只复制，第二个 commit 起才删代码）。`RepositoryBreadcrumbs` 随 repository shell 移动。
    - `ModeDefinition` 增加 `Shell: ComponentType<WorkspaceShellProps>`。`WorkspaceShellProps` 暂时等于现在的
      `WorkspaceLayoutProps`，路由不改。
    - `routes/-workspace-layout.tsx` 的 `WorkspaceLayout` 改为：未登录 → `VisitorLayout`；已登录 →
      `useModeDefinition().Shell`。删除 `AuthenticatedWorkspaceLayout`。
    - 在 mode 根节点加 `key={mode}`（N4）。
  - 验收：两个 shell 文件各自能独立编译；`-workspace-layout.tsx` 不再出现 `workspaceTheme`。
  - 验证：V-static；V-smoke（截图零差异，包括 390×844 视口、折叠侧栏、`document.title`）。
  - 规模：M（复制约 600 行，PR 评审时只看 `WorkspaceLayout` 的改动和复制是否完整）。依赖：T4a。
  - 已完成：先提交原样副本，再接入注册表 Shell 和 mode key；路由入口缩至 64 行，不再读取 workspaceTheme。
    typecheck、build、40 张截图及 mode 往返切换通过。全量 386 项通过，文案套件因导入浏览器 Shell 失败；
    隔离 Shell 后该套件 8 项重跑通过，合计 394 项。详情见提案的「T4b 注册表装配 Shell」。

- [x] **T4c：删除两个 shell 内部的 mode 分支**（R2、R7 可见化；N2）
  - 做什么：
    - `wiki-shell.tsx`：删除所有 `workspaceTheme === "repository"` 为真的分支和 `repositoryShell` 相关代码，忽略 `repository*` props。
    - `repository-shell.tsx`：删除 wiki 分支；保留 `repositoryShell` 条件**原样**（这决定了 R7 的"半外壳"页面，修正属于行为
      变更，不在本计划内，见末尾"待决定"）。
    - 删除没有调用方的 `repositoryDataActive` prop。
  - 验收：`rg -n 'workspaceTheme|useTheme\(\)' apps/workspace/web/src/modes` 中只剩读明暗主题的调用；wiki shell 不出现 `repository` 字样
    （HTTP schema 类型名除外）。
  - 验证：V-static；V-smoke（截图零差异；重点看 repository 下 `/apps`、`/worktrees`、`/nodes/<sheet>` 这三个"半外壳"页面与基线一致）。
  - 规模：M。依赖：T4b。
  - 已完成：删除两个 shell 的 mode 分支与无调用方 prop；模式选择器由共享 ModeSettings 提供。
    保留 R7 半外壳条件及后台查询，394 项测试、typecheck、build、40 张截图和 mode 往返切换通过。
    详情见提案的「T4c 清理 Shell 的 mode 分支」。

## M3 页面由 mode 提供

每个 route 一个 PR，统一做法：

1. `ModeDefinition.pages` 增加这一类页面的字段（例如 `home: ComponentType<HomePageProps>`），两个 mode 都必须实现，否则编译失败。
2. 第一个 commit：把 route 组件中 `repository ? A : B` 的两半原样移到 `modes/repository/pages/<page>.tsx` 和
   `modes/wiki/pages/<page>.tsx`，包括各自传给 `WorkspaceLayout` 的 props。
3. 第二个 commit：route 组件只剩 `Route.useParams()` / `useSearch()` / loader 已保证的数据，然后
   `const { pages } = useModeDefinition(); return <pages.x {...props} />`。
4. **`validateSearch` 和 loader 不动**。现在 `/home` 只接受 `recent|owned|shared`、`/spaces/:id` 只接受 `files|prs|apps`，
   不认识的值会从 URL 中去掉；这个行为保持不变。哪个 mode 读取 `view`，由 mode 的页面组件决定（R6 在这里变成显式：
   页面 props 里有 `view` 字段，没有读它的 mode 就是忽略它）。

| 任务 | route | 移到 wiki | 移到 repository | 额外注意 |
| --- | --- | --- | --- | --- |
| T5.1 | `routes/home.tsx` | Recent/Owned/Shared tab 与 `CreateNodeDropdown`（170-226 行） | 仓库列表、类型筛选、搜索（86-150 行） | `CreateTeamDialog` 已在 T4a 移走 |
| T5.2 | `routes/spaces.$spaceId.tsx` | `NodeBrowser` + `wikiPageActions`（149-171、208-214 行） | `RepositoryTabs` + `RepositoryOverview`、`FilesView`、`RepositoryAbout`、`AppsView`、`PullRequestsView`、`displayAppName`，以及 html views / worktrees 查询和默认 Page 的 localStorage 逻辑（83-146、220-811 行） | 最大的一步，repository 侧放在 `modes/repository/pages/space/` 下按视图拆文件；`isRepositoryView` 留在 route（属于 `validateSearch`） |
| T5.3 | `routes/nodes.$nodeId.tsx` | 目录页 `NodeBrowser` + 页头搜索 | 目录页 `RepositoryTabs` + 紧凑 `NodeBrowser` | 只迁移**目录页**；文件页（编辑器 / 预览）两种 mode 相同，留在 route |
| T5.4 | `routes/spaces_.$spaceId.{settings,members,trash}.tsx` | 原有表单 / 列表 + 页头 | `RepositorySettingsLayout` 包装 | `SpaceGeneralSettings` 拆成 wiki 版与 repository 版；两者都用 T3.1 的 `useUpdateSpace` |
| T5.5 | `routes/worktrees.tsx` | Workbench（`WorktreeDashboard`） | 带 `spaceId` 时的 `RepositoryPullRequestPage` | 不带 `spaceId` 时 repository 当前也渲染 Workbench，保持不变（R7） |
| T5.6 | `routes/-issue-layout.tsx` | Issue 页外壳参数（`selectedView`、标题拼接） | `RepositoryTabs` + `.repository-issues` 容器 | `IssueRouteLayout` 被 5 个 issue 路由使用，导出名不变 |

- 验收（每个 PR）：对应 route 文件不再 import `useTheme`、`features/spaces/repository-*`、`features/worktrees/repository-*`；
  `modes/wiki/**` 不 import `modes/repository/**`，反之亦然。
- 验证（每个 PR）：V-static；V-smoke（截图零差异）；`pnpm --filter @univerjs/univer-workspace routes:generate` 后
  `git diff --exit-code -- apps/workspace/web/src/routeTree.gen.ts`；手动：在该页输入搜索词或切换子视图后，到应用设置里切换 mode，
  新 mode 的页面为初始状态、控制台无错误（N4）。T5.2 额外跑 `test/browser/repository-pages.mjs`；T5.4 额外跑
  `repository-settings.mjs`；T5.5 额外跑 `pull-requests.smoke.mjs`；T5.6 额外跑 `issues.smoke.mjs`。
- 规模：T5.2 为 L（约 650 行移动），其余 S–M。依赖：T4c；T5.4 依赖 T3.1；T5.x 之间按表格顺序（都会扩展 `pages` 类型）。

### M3 执行记录

- [x] T5.1：首页拆为 `pages.home`，两种页面接收相同的 `view` 合同；loader 和 validateSearch 原样保留。
  typecheck、build、394 项测试、40 张零差异截图和搜索后 mode 切换通过；路由生成物无差异。

- [x] T5.2：空间页拆为 `pages.space`，repository 视图拆至 `pages/space/`，访客回退和默认 Page 存储逻辑保持不变。
  394 项测试、typecheck、build、40 张截图、模式切换与 repository-pages 专项通过；路由合同及生成物无变化。
  主包 1,834.36 → 1,834.66 kB，gzip 564.88 → 564.87 kB；本次保留同步注册，不使用 lazy。

- [x] T5.3：目录页拆为 `pages.folder`，文件编辑器与预览保留在原路由；目录搜索由路由保留跨 Node 的状态，各 mode 页面负责呈现，切换 mode 时清空。
  394 项测试、typecheck、build、40 张截图、目录搜索后往返切换及无未捕获错误检查通过；路由合同与生成物无变化。

- [x] T5.4：设置、成员和回收站分别由 mode 提供；两版设置表单继续共用 useUpdateSpace，保存与落点不变。
  394 项测试、typecheck、build、40 张截图、三类页面状态重置和 repository-settings 专项通过。
  专项等待改为表单自身 aria-busy，并等待取消确认框的遮罩退出；临时公开空间的测试与截图串行执行。

- [x] T5.5：Workbench / PR 页拆为 `pages.worktrees`；无 spaceId 的 repository Workbench 保持不变。
  394 项测试、typecheck、build、40 张截图、全局/空间工作台搜索状态重置及真实 PR 专项全部通过。

- [x] T5.6：IssueRouteLayout 保持导出名与 props，通过 `pages.issues` 选择 mode 外壳；五个 Issue 路由无需改调用。
  394 项测试、typecheck、build、40 张截图、空间/全局 Issue 搜索重置及两种 mode 的 Issues 专项通过。
  M3 最终回归还覆盖目录 → 文件 → 返回目录保留搜索；所有 loader、validateSearch 与路由生成物保持不变。

## M4 feature 去 mode 化、样式、边界检查

- [x] **T6a：通用 feature 组件不再读取 mode**（R2 feature 部分；N5）
  - 做什么：4 个组件各自删掉 `useTheme()`，改为接收一个由 mode 传入的 `presentation` prop，外加需要时的插槽。
    命名按样式家族，不按 mode 名，第三种 mode 可以复用其中一种或新增取值：

    | 组件 | 新 props | 由谁传 |
    | --- | --- | --- |
    | `features/issues/issue-list.tsx` `IssueList` | `presentation: "standard" \| "compact"`；`viewsNav?: ReactNode`（现在 92-157 行 repository 的左侧视图导航移到 `modes/repository/pages/issues/`） | T5.6 的两个 issue 页面 |
    | `features/issues/issue-detail.tsx` `IssueDetail` | `presentation: "standard" \| "compact"` | 同上 |
    | `features/trash/trash-list.tsx` `TrashList` | `presentation: "standard" \| "compact"` | T5.4 的两个回收站页面 |
    | `features/permissions/team-member-manager.tsx` `TeamMemberManager` | `presentation: "standard" \| "compact"` | T5.4 的两个成员页面 |

    组件内部把 `repository &&` 替换成 `presentation === "compact" &&`，类名和结构不变。`features/nodes/node-browser.tsx` 已经用
    `compact` / `showParentRow` 两个 props 表达同样的差异（39-58 行），是现成的写法。`issue-list.tsx:646` 中挂
    `repository-chrome repository-issues` 由 repository 页面通过 `filterMenuClassName` 传给弹层；
    `MenuContent` 使用 body Portal，外层容器无法覆盖它，T6c 再统一样式。
  - 验收：`rg -n 'useTheme\(\)' apps/workspace/web/src/features` 中没有 `workspaceTheme`；`rg -n '\brepository\b' apps/workspace/web/src/features/{issues,trash,permissions}`
    仅保留 T6c 明确保留的 `bg-repository-counter` 色彩令牌，以及 T6b 待改的 `issues.queries.ts` 注释，无 mode 判断。
  - 实施：新增 `pages.issueList` / `pages.issueDetail`，三个 Issue 路由保留 loader、搜索参数和权限查询；
    两种 mode 页面显式选择呈现参数，repository 全局列表仍为 standard，空间列表为 compact。
    侧栏导航与折叠状态移到 repository 页面，通过 `viewsNav` / `viewsNavToggle` 插槽传入。
    导航提取与调用改写分开提交（提取：`ff91df9`）。
    Workspace typecheck、build、78 文件 / 394 测试通过；40 张截图零差异；两种 mode 的 Issues 与 Settings 专项通过。
    Issues 专项新增全局／空间弹层配色和侧栏恢复断言，三个 Issue 路由声明 AST 对比一致；未更新基线。
  - 验证：V-static；V-smoke（截图零差异）；`issues.smoke.mjs`、`repository-settings.mjs`。
  - 规模：M（`issue-list.tsx` 一个文件约 15 处替换）。依赖：T5.4、T5.6。

- [ ] **T6b：repository 专属组件迁入 `modes/repository`**（R2、R5 收尾）
  - 做什么：移动（不改代码）：`features/spaces/repository-{tabs,header,settings-layout}.tsx`、`features/spaces/settings-nav.tsx`（只被
    `repository-settings-layout.tsx` 使用）、`features/spaces/space-name.ts`（`spaceDisplayName` 注释写明是 GitHub 约定；wiki 不调用，
    `-workspace-layout` 的两处调用在 T4c 后只剩 repository shell）及 `test/unit/space-name.test.ts`、
    `features/worktrees/repository-{pr-state,pull-request-layout}.tsx`。`RepositoryTab`、`RepositoryBreadcrumb` 类型随之移动。
    `worktree-review-panel.tsx` 的 `repository?: RepositoryReviewPresentation` 改为中性的
    `layout?: (parts: { review, actions }) => ReactNode` 插槽，repository 的 PR 页通过它传入 `RepositoryPullRequestLayout`。
    `node-browser.tsx:39,57`、`node-parent-row.ts:12`、`issues.queries.ts:55` 的注释和 `repositoryGoToParent` 这类文案 key 只改注释措辞，
    key 名不改（改 key 名会牵动两种语言的文案表，收益不足）。
  - 验收：`rg -n 'repository' apps/workspace/web/src/features --glob '!*.queries.ts'` 只剩 HTTP schema 类型和 `issuesSidebar` 之类的
    非 mode 含义（逐条在 PR 描述里列出）；`features/*/index.ts` 不再导出 `Repository*`。
  - 验证：V-static（含 `test/unit/worktree-review-panel.test.ts`）；V-smoke；`pull-requests.smoke.mjs`、`repository-pages.mjs`。
  - 规模：M。依赖：T5.2、T5.5、T6a。

- [ ] **T6c：样式按 `data-ui-mode` 作用域**（R4 样式部分；N7）
  - 做什么：`app/styles/global.css:426-596` 的 `.repository-*` 规则和 `72-74`、`326-327` 的 `--color-repository-*` token 移到
    `modes/repository/styles.css`，选择器加 `[data-ui-mode="repository"]` 前缀（`data-ui-mode` 在 T2b 已挂在 `<html>` 上），由
    `modes/repository/index.ts` import。组件上的 `repository-chrome`、`repository-pages` 等 class **保留**，只是规则多了一层作用域。
    token 改名为 `--color-mode-counter` 之类的通用名并不必要，不做。
  - 验收：`rg -n 'repository' apps/workspace/web/src/app/styles/global.css` 无结果。
  - 验证：V-static；`build` 后在产物 CSS 中确认 `.repository-chrome` 规则都带 `[data-ui-mode=repository]` 前缀；V-smoke 截图零差异
    （明暗两种主题都截）。
  - 规模：S。依赖：T2b。可以和 M3 并行。

- [ ] **T7：边界测试与文档**（R1 收尾、N8）
  - 做什么：
    - 删除 `useTheme()` 上的 `workspaceTheme` / `setWorkspaceTheme` 兼容字段（T2a 加的）。
    - 新增 `apps/workspace/test/unit/web-architecture.test.ts`：用 `node:fs` 扫描 `web/src/**/*.{ts,tsx}` 的 import 语句并断言
      - `shared/**` 不 import `features/`、`modes/`、`routes/`、`app/`；
      - `features/**` 不 import `modes/`、`routes/`、`app/`；
      - `modes/<a>/**` 不 import `modes/<b>/**` 和 `routes/`；
      - `routes/**` 只通过 `modes/registry` import mode；
      - 全仓库不出现 `workspaceTheme`。
    - `apps/workspace/docs/architecture.md`「Web 应用」：依赖方向改为 `shared → features → modes → routes → app`，写明
      `*.queries.ts` / `*.commands.ts` / `*.rules.ts` 的职责、`ModeDefinition` 的字段、"mode 只能用来呈现，不能改变写操作的语义"。
    - `apps/workspace/docs/proposals/ui-mode-decoupling.md`：状态改为"已实施"，附实施记录（与 `repository-view-github-alignment.md`
      第 7 节的写法一致）。
  - 验收：在 `features/issues/issue-list.tsx` 临时加一行 `import "../../modes/registry"`，架构测试失败；撤销后通过。
  - 验证：V-static；仓库级 `pnpm typecheck && pnpm test && pnpm build`；`git diff --check`；V-smoke 最后一次全量比较。
  - 规模：S。依赖：T6a、T6b、T6c。

## 检查点

- [ ] M1 完成后：`shared/` 里没有任何 mode 名；`rg -n 'api\.(POST|PATCH|PUT|DELETE)' apps/workspace/web/src --glob '*.tsx'` 只剩认证。
  这时可以停下来评估：如果后面的工作要暂停，现状已经比开始时少了 R3、R5 和一半 R4。
- [ ] M2 完成后：新 mode 已经可以只提供 `Shell` 和 `messages` 就跑起来（页面仍沿用 route 里的分支）。
- [ ] M3 完成后：用 `modes/drive` 做一次走查验证：新建一个只渲染占位文字的 mode，把它加到注册表，确认 `typecheck` 按字段报错、
  补全后两种原有 mode 的 V-smoke 不受影响，然后删掉它（不提交）。
- [ ] M4 完成后：提案第 9.2 节"不需要碰的地方"由 T7 的架构测试保证。

## 决定记录

1. **R7"半外壳"页面**：已决定暂不处理，后续作为独立任务（不在本计划内）。T4c 之后只让它可见，不修。
2. **T3.0 的失效集合**：已决定按 A，统一为并集（部分写操作多触发 1–2 个后台 GET，界面结果不变）。
   T3.0 的 PR 描述里列出每个调用点多出的 key。
3. **代码分割**：已同意。T5.2 完成后用 `build` 产物大小决定是否在注册表内改为 `lazy()`。
4. **组件级测试**：已同意不引入新依赖，本计划只用纯函数单测和 `agent-browser` 脚本（按"同意我的建议"理解）。
   如需 jsdom / Testing Library 另行确认。
