# Implementation Plan: Repository Dashboard and Global Navigation

状态：2026-10-18，用户已批准 A「GitHub 工作总览」与执行计划，当前实现完成。
Workspace 类型检查、生产构建及 437 项测试通过；仓库级 Agent / Desktop 阻塞见任务清单与应用 proposal。
执行清单见 [todo.md](./todo.md#repository-dashboard-follow-up-2026-10-18)。下方保留已完成的历史计划。

## 1. 目标与设计方向

Repository mode 的首页从仓库目录升级为工作总览：找到仓库、继续文档、查看 PR 和 Issues。
沿用 A 的 OfficeLab 品牌、浅色工具栏、左侧导航、中部工作列表和右侧辅助内容。
全局页面属于同一套导航；进入具体仓库后回到现有仓库 Header / Tabs。
亮色与暗色均使用现有语义 token，正文保持 14px、辅助文字至少 12px，移动端主要触控区域至少 44px。

已选原型：本机 http://127.0.0.1:4187/?variant=A 。原型是视觉参考，数据与代码均不直接作为生产实现。
补充设计首先覆盖全部仓库、全局 PR、全局 Issues、最近访问、Pages，以及新建和空态。

## 2. 信息架构与入口闭环

| 页面 | 路由与处理 | 主要内容与去向 |
| --- | --- | --- |
| 首页 | `/home`，Repository mode | 继续工作、近期进行中的 PR、开放 Issues、Pages 入口、Agent / CLI 指引 |
| 全部仓库 | 新增 `/repositories` | 名称/简介搜索、个人/团队和可见性筛选、名称排序、新建、进入仓库 |
| 全局 Pull requests | 复用 `/worktrees`，无 `spaceId` 的列表入口 | 进行中/已处理、名称搜索、个人/团队/仓库筛选、游标分页 |
| 全局 Issues | 复用 `/issues` | 复用现有状态、作者、指派、标签和搜索过滤，接入统一全局外壳 |
| 最近访问 | `/recent` 在 Repository mode 渲染真实列表 | 按最后打开时间展示，加载更多，打开真实 Node |
| Pages 目录 | `/apps` 在 Repository mode 提供目录态 | 搜索已加载结果、仓库筛选、游标分页、预览与打开 Page |
| 仓库与文件详情 | 复用 `/spaces/$spaceId`、`/nodes/$nodeId` | 仓库 Header / Tabs、编辑器、文件权限与操作延续现有流程 |
| PR 详情 | 复用 `/worktrees?spaceId=…&worktree=…` 等现有搜索参数 | 从全局列表解析合法仓库范围进入现有审阅流程；无合法仓库上下文时保留全局详情路径 |
| Issue 详情 | 复用 `/spaces/$spaceId/issues/$number` | 进入仓库 Issues 详情，保留可返回的全局入口 |
| 新建仓库 | 复用 `CreateTeamDialog` | 校验、提交、失败重试；成功后更新目录并进入新仓库 |

Sidebar：账户 → 首页 / Pull requests / Issues / 最近访问 / Pages → 我的仓库（短列表与查找）→ 查看所有仓库 → Agent 指引。
Sidebar 的短列表采用确定的排序与显示上限，名称为「我的仓库」，不将其称为热门或常用。
顶栏查找入口明确限定为「查找仓库」，导航到带查询参数的仓库目录；文件搜索只在支持它的页面内出现。
刷新、浏览器前进后退和直接粘贴链接均应恢复搜索、筛选和详情选择状态。

## 3. 页面设计

### 首页

- 左侧导航约 248px；中部为主要任务区；右侧约 260px。大屏限制阅读宽度，避免行内容横跨整屏。
- 「继续工作」展示最近打开的 2 个文件；点击直接打开，链接「最近访问」进入完整列表。
- PR 展示最近更新的至多 5 条进行中项，明确区分 draft / ready / merging，提供「查看全部」。
- Issues 展示最近更新的至多 5 条 open 项；按真实状态文案展示，不把全部 open 项宣称为“分配给我”。
- 右侧显示最近记录中的 Pages 入口及其他最近文档，尽量避免与主栏重复。最近记录不足时使用明确空态。
- 保留 A 的 Page 预览卡片区域。现有合同没有缩略图；先展示真实名称与仓库信息，由用户点击后按需进入现有安全预览。任何未实现的缩略图不得用示例图表替代。
- Agent 下载与 CLI 指引复用现有 onboarding 中的发布链接、命令及平台判断。

### 全部仓库（重点补充）

```text
OfficeLab / 全部仓库                              [新建仓库]
左侧全局导航 │ 全部仓库
             │ 查找名称或简介…   [类型] [可见性] [名称排序]
             │ 当前筛选结果数                         [清除筛选]
             │ 仓库图标  owner / name       [个人/私有/公开]  当前角色
             │          简介（至多两行；无简介时自然收起）
             │ ----------------------------------------------------
             │ 下一仓库
```

- 目录使用纵向列表，行高由简介自然决定；展示后端已有名称、owner、description、类型、可见性和角色。
- 名称与简介共用搜索，个人仓库以实际显示名称参与匹配；筛选和排序写入 URL。
- 名称本身为主要链接，仓库创建是唯一高强调主操作；不额外发逐仓库请求获取未提供的统计。
- `/api/spaces` 已返回完整列表，目录直接过滤排序。筛选结果为真实精确数量。
- 无仓库、仅个人仓库、无搜索匹配、加载失败分别设计，不把“没有匹配”当成第一次使用。

### 全局 PR / Issues

- 同一全局 Sidebar，主栏扩展为完整列表宽度，不在列表页保留首页的辅助右栏。
- PR 使用 `WorktreeSummary` 展示名称、真实创建者、归属、状态、文件数、更新时间；只在打开详情后请求 detail。
- 全局 PR 的页签采用接口已支持的「进行中 / 已处理」，不提供只过滤当前页却声称全量的 ready 筛选。
- Summary-only 私有 Team Worktree 依据 `capabilities.review` 呈现可管理摘要，不能伪装成可打开的审阅任务。
- 原型中的 PR `#24` 等为示例，生产 Worktree 合同没有顺序编号；显示名称及必要的短 ID，不制造 GitHub 式编号。
- Issues 复用现有列表与合同，聚合范围与当前 API 一致；个人仓库不展示不支持的 Issue 创建入口。

### 最近访问 / Pages

- 最近访问以文件类型、名称、仓库/路径、最后打开时间为列；移动端将位置和时间放入副行。
- `/recent` 当前只重定向 `/home`；改为按 mode 分派，Repository 展示列表，Wiki 保留既有语义。
- Pages 默认展示目录，而非一进入就自动打开第一项。保留已有 `node`、`spaceId` 深链解析和预览能力。
- Pages 数据按更新时间排序，名称必须叫「Pages」或「最近更新的 Pages」，不得冒充最近访问顺序。
- 首页如果标记「最近访问的 Pages」，只从 Recent 数据识别，不使用 HTML Views 的更新时间伪造访问时间。
- 最近访问与 Pages 均按游标加载更多；对没有服务端全文搜索的列表，搜索框明确为“搜索已加载内容”，显示已加载范围。

### 响应式与状态

- 宽屏三栏；中屏首页辅助内容下移；窄屏单栏并用现有 Drawer 承载全局导航与仓库入口。
- 移动端仍可进入全部仓库、PR、Issues、最近访问、Pages，不能通过 CSS 隐藏唯一入口。
- 每个聚合模块有独立 skeleton、空态、错误与重试；辅助模块失败不会替换整个首页。
- 新用户以创建仓库、打开个人仓库、导入文件和 Agent 上手形成真实引导；已有工作但当前没有待处理项显示“暂无”，不重复 onboarding。
- 中文/英文、亮色/暗色、长名称、只读账户、权限失效和数据删除均纳入验收。

## 4. 实现边界与数据策略

1. 保持 `routes → mode registry → mode pages / shell → features` 的依赖方向。在 `modes/repository` 中实现展示；共享 route 不直接拼接 Repository UI。
2. 首页和全局页面共用 Repository 导航外壳。按明确的全局页面状态选择外壳，避免扩张现有 `repositoryHome` 布尔值形成含糊分支。
3. 仓库目录 `/repositories` 是 Repository 专属入口；切换到 Wiki 时回到其现有首页。对 apps/recent 等共享路径通过 mode 页面分派处理。
4. 优先直接组合 `GET /api/spaces`、`/api/worktrees`、`/api/issues`、`/api/recent-resources`、`/api/html-views`。当前设计可基于现有 schema 与合同实施。
5. 新增或扩展窄的 React Query 列表选项，让 limit / cursor / search / kind / teamSpaceId 成为 query key 的组成部分；沿用现有 QueryClient 和 Worktree change feed 的失效策略。
6. 首页只取摘要与小批量数据，不复用为每个任务拉 detail 的 `WorktreeDashboard`，不复用启动最多 20×200 条遍历的 `htmlViewsQueryOptions` 作为首页加载路径。
7. 认证与必要导航数据先加载；聚合模块独立加载。调整 `/home` loader，避免 Repository 首页为不展示的 owned/shared 视图等待查询，同时保持 Wiki 的加载合同。
8. 首屏条数不等于总数。没有总数合同的模块不显示“全部 N 个”徽标；使用状态名称、加载更多、或明确“已加载 N 条”。
9. 所有时间、状态、创建者和归属来自实际响应；服务端 ACL 决定可见性，前端只根据返回的 capabilities 呈现操作。
10. 预览复用既有 HTML/Office 宿主与权限流程；首页元数据加载不能触发 resource open 并污染 Recent，只有真实打开操作产生访问记录。

## 5. 执行顺序

| 阶段 | 任务 | 交付与验收 |
| --- | --- | --- |
| 设计补全 | T10 | A 风格的完整页面图与入口矩阵：全部仓库、PR、Issues、最近访问、Pages、新建/空态、移动端 |
| 全局骨架 | T11 | mode 页面与导航状态接线，现有仓库与 Wiki 导航回归通过 |
| 仓库目录 | T12 | 查看所有仓库 → 搜索筛选 → 进入/创建仓库完整可用 |
| 首页主体 | T13 | 继续工作与 PR / Issues 摘要接入真实数据，局部加载失败可重试 |
| PR 闭环 | T14 | 全局分页列表 → 合法范围下的现有详情 → 返回列表 |
| Issues 闭环 | T15 | 统一外壳与正确默认过滤，复用现有详情与创建行为 |
| 最近访问 | T16 | 真实 `/recent` 列表、游标、已加载搜索、资源打开 |
| Pages 闭环 | T17 | 目录、筛选、加载更多、按需预览、旧深链兼容 |
| 状态与引导 | T18 | 数据稀疏、新用户、只读、无权限、双语言和主题完整覆盖 |
| 验收 | T19 | 导航/分页/权限回归、typecheck/build、批量视觉验收、文档更新 |

检查点：T11–T12 完成后验证模式与导航；T13–T15 完成后验证任务闭环；T16–T19 完成后全流程验收。
每个切片完成即接入真实功能，不将原型按钮提示保留在生产实现中。

## 6. 验证与交付

- 单元/集成测试针对新增规则：个人仓库显示名搜索、查询参数校验、游标与筛选绑定、PR 归属、summary-only 权限、加载数与总数区别。
- 浏览器测试覆盖首页每个入口、列表到详情往返、刷新、后退、无匹配与错误恢复、移动端 Drawer、键盘焦点。
- 执行 Workspace `typecheck`、相关 Vitest 和 `build:web`；完整交付前按影响范围执行仓库级 `pnpm typecheck` / `pnpm test` / `pnpm build`。
- 通过 `routes:generate` 更新路由生成物。若实际实现发现合同缺口，再同步合同/生成物/调用方并执行 `api:verify`，不绕过接口语义。
- 视觉检查按 1440×900、2000×700、390×844，加入亮暗主题与稀疏数据，一次批量检查、一次集中修正与确认。
- 交付完整页面截图、功能入口清单、检查结果和已知限制；更新 README 与相关技术文档，记录接受的视觉规范。

## 7. 需要在实施中验证的风险

| 风险 | 处理 |
| --- | --- |
| 原型预览缺少生产缩略图来源 | 保留卡片结构，展示真实元数据；显式打开现有安全预览，不用合成业绩图冒充内容 |
| 跨仓库聚合被当前页截断 | 保留服务端 cursor、按接口过滤，不以当前页结果声称全量 |
| 全局与仓库级导航混杂 | 全局 Sidebar 与仓库 Header/Tabs 有明确边界，所有入口有返回路径 |
| 首页加载启动内容运行时 | metadata-only 首页；编辑器与预览按用户动作加载，网络记录验收 |
| 默认搜索范围误导 | 仓库目录全量搜索；其他列表按已有服务端能力或明确已加载范围呈现 |

---

## Previous completed plan: Team Space Repository View

## Overview

Present each Team Space through a GitHub/GitLab-style repository view while retaining the current wiki-style route. Reuse existing Space, Node, Resource, Apps, and Worktree modules. Do not add a repository table. Repository mode is an experimental browser-local theme; Wiki remains the default.

## Dependency graph

```text
Existing Space/Node/HTML View/Worktree contracts
  -> repository-mode routing and C sidebar
  -> selected .univer.html landing state
  -> repository overview composition
  -> focused browser and contract verification
```

## Vertical slices

1. **Repository mode shell**: switch a Team Space between wiki and repository mode; render the accepted C sidebar and route existing data, Apps, Worktrees, Members, and Settings.
2. **Repository landing App**: list Team Space `.univer.html` Apps, choose one, persist and validate the selection, and render it in the overview.
3. **Verification and documentation**: contract generation, migration matrix if schema changes, responsive/browser checks, and update design docs.

## Risks and mitigations

- **Duplicate model risk**: keep Team Space as repository identity and reuse existing modules.
- **Invalid landing App**: validate same-Space ownership, suffix, readiness, and access on the server; fall back by stable ordering.
- **Routing churn**: prefer URL search state on the existing Space route unless TanStack Router constraints require a route segment.
- **Schema scope**: decide between one nullable Space field and a tiny preference table before migration work; do not add both.

## Checkpoints

- After Task 1: C sidebar and mode switching render against existing data with no API changes.
- After Task 2: landing App selection works with multiple, zero, deleted, and inaccessible Apps.
- Before delivery: run API verification, typecheck, focused tests, and responsive browser checks.
