# Team Space Repository View

- [x] Task 1: Add repository-mode shell and C sidebar to the existing Team Space route
  - Acceptance: Global settings switches between default Wiki and experimental Repository themes; the choice survives reload in browser local storage; sidebar links to data, Smart Workbench, Apps, Members, and Settings; no repository table or API change is added.
  - Verify: `pnpm --filter @univerjs/univer-workspace typecheck`; manual check at 320px, 768px, 1024px, and 1440px.
  - Files: `apps/workspace/web/src/routes/spaces.$spaceId.tsx`, `apps/workspace/web/src/features/repository-view/*`.

- [x] Task 2: Add selected `.univer.html` landing App behavior
  - Acceptance: Overview renders the selected App; multiple Apps expose a keyboard-accessible selection action; invalid or deleted selections fall back deterministically; zero Apps has an actionable empty state.
  - Verify: focused query/service tests; `pnpm --filter @univerjs/univer-workspace test`.
  - Files: existing Space schema/service or preference table, HTML View queries, repository overview and selector components, contract sources if changed.
  - Dependencies: Task 1.

- [x] Task 3: Wire PR/MR and Pages labels to existing modules
  - Acceptance: PR/MR opens the current Team Space Smart Workbench; Pages opens the current Apps list; no parallel review or publication state is created.
  - Verify: route/browser navigation checks and focused tests.
  - Files: repository sidebar/overview routes and existing query composition.
  - Dependencies: Task 1.

- [x] Task 4: Complete contract, migration, and documentation verification
  - Acceptance: OpenAPI/generated types, migration behavior, Browser queries, and docs agree; wiki routes remain unchanged.
  - Verify: `pnpm --filter @univerjs/univer-workspace api:verify`, `pnpm typecheck`, `pnpm test`, `git diff --check`.
  - Files: affected contract/schema/migration/docs files only.
  - Dependencies: Tasks 2-3.

## Checkpoint

- [x] C sidebar and repository mode accepted in the existing Team Space flow.
- [x] Landing App persistence choice resolved: browser local storage; no schema migration.
- [x] Full focused verification passes before implementation is declared complete.

## Follow-up tasks from repository view audit

- [x] Task 5 [P1]: Harden repository-scoped navigation and states
  - Acceptance: Repository data opens the existing NodeBrowser; PR/MR and Pages show only the current Team Space; repository loading, error, retry, and empty states are distinct.
  - Files: repository route, Worktree/App query composition, existing route search contracts.
  - Dependencies: Tasks 1-3.

- [x] Task 6 [P1]: Clarify repository copy and remove inactive controls
  - Acceptance: Repository overview labels are available in both supported languages; the repository search input filters visible data or is removed; empty and error messages describe the actual state.
  - Files: `apps/workspace/web/src/shared/i18n.tsx`, repository route and related UI.
  - Dependencies: Task 5.

- [x] Task 7 [P2]: Filter HTML Views by Team Space at the query boundary
  - Acceptance: Repository pages request only readable `.univer.html` items for the current Team Space; client-side ownership filtering remains as a safety check; pagination remains correct.
  - Files: HTML View query, HTTP contract/server query if required, repository route tests.
  - Dependencies: Task 5.

- [x] Task 8 [P2]: Improve mobile touch targets
  - Acceptance: Repository overview buttons, Page selector, and collapsed navigation controls meet a 44px touch target at mobile widths while retaining visible keyboard focus.
  - Files: repository overview and workspace navigation styles.
  - Dependencies: Task 5.

- [x] Task 9 [P3]: Clear invalid landing App preferences
  - Acceptance: When a stored landing App is deleted or inaccessible, the browser falls back to the first readable App and removes the stale Team Space localStorage key.
  - Files: repository route landing App selection logic and focused tests.
  - Dependencies: Task 5.

## Repository Dashboard follow-up 2026-10-18

用户选定 A「GitHub 工作总览」。整体设计见 [plan.md](./plan.md)，实现与验证记录如下。

- [x] T10 · 补全 A 的页面设计与导航矩阵
  - Acceptance: 全部仓库、全局 PR、Issues、最近访问、Pages 均有宽屏/手机布局；每个首页入口有明确落点；包含首次使用、无匹配和失败状态。
  - Verify: 原型页面走查，按同一数据集对照 A 的布局、密度、色彩与术语。
  - Files: 独立设计原型；本计划及实施时建立的 surface brief。
  - Dependencies: None. Scope: M.

- [x] T11 · 接通 Repository 全局外壳与页面分派
  - Acceptance: 全局页面共用 A 的导航；仓库内部继续使用 Header/Tabs；Wiki 与文件编辑器导航按既有语义工作。
  - Verify: mode/导航相关测试、Workspace typecheck、全局/仓库/Wiki 切换浏览器检查。
  - Files: `web/src/modes/{registry.ts,page.types.ts,shell.types.ts}`、两种 mode 的 registry 和 Repository shell；按 page slot 拆分提交级切片。
  - Dependencies: T10. Scope: M per slice.

- [x] T12 · 实现全部仓库目录与创建闭环
  - Acceptance: `/repositories` 搜索真实显示名/简介，类型/可见性/排序可刷新恢复；真实结果数准确；创建成功进入新仓库并刷新目录。
  - Verify: 搜索和 URL 解析测试，创建失败/成功、搜索无匹配、个人仓库与只读角色浏览器流程。
  - Files: `web/src/routes/repositories.tsx`、Repository 目录页面与导航、既有 spaces/create dialog、相应语言文案。
  - Dependencies: T11. Scope: M.

- [x] T13 · 将首页主体接入真实数据
  - Acceptance: 最近文件与 PR / Issues 小批量摘要有真实目标；各模块独立加载与重试；首屏条数不被标成总数。
  - Verify: 摘要归属/状态规则测试，网络检查确认不批量拉 detail、不启动编辑器；失效更新和部分失败浏览器验证。
  - Files: `modes/repository/pages/home.tsx`、`routes/home.tsx`、必要的摘要 query 与展示组件、相关 tests；按 recent/PR/Issues 拆分切片。
  - Dependencies: T11. Scope: M per slice.

- [x] T14 · 完成全局 PR 列表到详情的闭环
  - Acceptance: 进行中/已处理、服务端支持的搜索与仓库范围可分页；summary-only 条目尊重 review 权限；可审阅条目进入正确详情并返回筛选列表。
  - Verify: 超过一页的筛选/翻页、私有 Team Worktree、个人 Worktree、刷新/后退测试。
  - Files: `modes/repository/pages/worktrees.tsx`、`routes/worktrees.tsx`、worktree query/search 与相关测试。
  - Dependencies: T11, T13. Scope: M.

- [x] T15 · 完成全局 Issues 的外壳和入口一致性
  - Acceptance: 首页摘要与全局列表默认过滤一致；已有作者/指派/标签/状态过滤继续工作；详情和创建入口按权限展示。
  - Verify: 已有 Issues 测试及首页→列表→详情/创建→返回的浏览器流程。
  - Files: Repository Issues 页面、既有 issue query/list、相关文案/导航测试。
  - Dependencies: T11, T13. Scope: M.

- [x] T16 · 实现 Repository 最近访问页
  - Acceptance: `/recent` 正常展示而非跳回首页；游标加载更多，搜索明确已加载范围；打开文件保持真实 lastOpenedAt 语义。
  - Verify: 超过一页数据、已删除/失权资源、打开文件后刷新与 Wiki 模式路由行为。
  - Files: `routes/recent.tsx`、Repository recent 页面、`features/views/recent.queries.ts`、相应测试/文案。
  - Dependencies: T11, T13. Scope: M.

- [x] T17 · 实现 Pages 目录及首页辅助栏
  - Acceptance: `/apps` 默认目录，分页和仓库筛选正常；旧 `node`/`spaceId` 深链仍可用；预览经用户动作加载，首页元数据浏览不写入 Recent。
  - Verify: 空目录/多页/失权/预览失败与绑定 HTML 页面打开流程；网络确认没有全量爬取和自动 resource open。
  - Files: `routes/apps.tsx`、mode-specific Pages 页面、窄的 html-views query、首页 Pages 卡片与测试；按目录/预览/首页接线拆分。
  - Dependencies: T11, T13. Scope: M per slice.

- [x] T18 · 补齐状态、响应式和上手指引
  - Acceptance: 首次使用与无待处理项区分；390px 下所有导航可达，键盘焦点连续；中文/英文与亮暗主题完整。
  - Verify: 真实 Agent/CLI 入口、长仓库名、只读账户、局部错误与重试的浏览器场景。
  - Files: Repository 各页面、现有 onboarding/Drawer/UI primitives 与语言文案；按页面修正。
  - Dependencies: T12–T17. Scope: M per slice.

- [x] T19 · 完成验证、视觉审阅和文档
  - Acceptance: 首页全部入口形成闭环；聚合权限与分页语义通过验证；截图/实现/文档一致。
  - Verify: focused tests → Workspace typecheck/build:web → 按影响范围的仓库级 typecheck/test/build；生成路由；合同变化时增加 api:verify；`git diff --check`。
  - Files: 相关 browser/integration tests、应用 README、architecture、接受后的设计规范与本任务清单。
  - Dependencies: T18. Scope: M per verification/doc slice.

### Dashboard checkpoints

- [x] T11–T12：全部仓库目录与新建闭环可用，Wiki/仓库模式回归通过。
- [x] T13–T15：首页 PR / Issues 到详情的端到端流程通过，局部失败可恢复。
- [x] T16–T19：最近访问、Pages、移动端和主题矩阵完成，实施与文档一致。

### Validation record

- Workspace `typecheck`、`build`、`test` 均通过；完整测试为 87 个文件、437 项。
- 定向回归验证目录搜索、服务端游标、摘要权限、页面缓存隔离、直接 ID 读取、mode 架构与双语言文案。
- 浏览器验收使用本 worktree 的 Vite `http://127.0.0.1:5174` 与已有 3020 服务；仅进行读取、导航及创建表单校验/取消，未创建或删除用户仓库。
- 完整列表外的 PR 深链、无待处理项、局部请求失败与重试、新用户引导均通过；测试请求拦截已移除。
- 仓库级检查已执行，但尚未全绿：Agent 的已安装 comparison package 缺少 `diff-sidebar-rail`；Desktop portable profile 测试的 pnpm 配置输出为空导致 JSON 解析失败。两处均不在本次改动范围内，未降低检查标准。
