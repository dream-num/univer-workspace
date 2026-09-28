# Repository View UX 审计与改进计划

> 状态：已实施（2026-09-29）。本文记录 2026-09-28 的审计结论和六个阶段的改进计划，第 6 节之后
> 是实施与验收记录。
>
> 审计样例：团队空间 `mini-crm`（`/spaces/0afc2180-…?view=files`），账号 `weimin`。
> 视口：1440×900 桌面、390×844 移动；浏览器为暗色系统主题。
> 目标风格：与 GitHub repository 页面高度相似。

## 1. 结论

| # | 维度 | 分数 | 关键问题 |
|---|------|------|----------|
| 1 | Accessibility | 2 | 页头整段 breadcrumb 是一个指向 `/home` 的链接，里面嵌套了 `h1` 和「重命名」按钮；标题层级从 `h1` 直接跳到 `h3` |
| 2 | Performance | 3 | 每次进入仓库首页都会挂载一个完整的实时协同 HTML App；Worktree 列表全量拉取后再在客户端过滤 |
| 3 | Responsive | 2 | 移动端操作按钮排在 tabs 上方；文件详情页页头在移动端不显示文件名；固定 `48vh` 盒子 |
| 4 | Theming | 3 | Token 基本到位；「回收站」按钮用手写 class 复刻 `Button` 样式，和相邻按钮脱节 |
| 5 | Implementation Integrity | 2 | 仓库外壳只在部分路由上生效；大量英文文案硬编码并绕开 i18n；Issues 是空壳；PR 计数口径错误 |
| **合计** | | **12/20** | **Acceptable：需要一轮结构性修改** |

**Implementation Integrity：不通过。** 从单个页面看，Repository 主题像 GitHub；在页面之间切换时，
它会退回 Wiki 外壳。进入仓库后，Files / PRs / Apps 用顶部 tabs，成员、回收站和 PR 详情却换成
左侧 sidebar 外壳，文件详情页又丢掉了仓库名。原因集中在 `-workspace-layout.tsx` 的一个条件：

```ts
const repositoryShell =
  workspaceTheme === "repository" &&
  selectedSpaceId !== undefined &&
  selectedView === undefined &&   // members / trash / worktrees / apps 都传了 selectedView
  repositoryDataActive !== true &&
  immersive !== true;
```

`impeccable detect` 对 `spaces.$spaceId.tsx`、`home.tsx`、`-workspace-layout.tsx` 没有报告问题；
下列结论都来自代码阅读和浏览器实测。

问题数量：P0 × 2，P1 × 9，P2 × 8，P3 × 3。

## 2. 问题清单

### P0：阻断任务

**[P0-1] 离开仓库根目录后失去仓库上下文，也无法一步回到上一级**
- 位置：`routes/-workspace-layout.tsx:515-528`、`routes/nodes.$nodeId.tsx`
- 现象：
  - 文件详情页页头显示 `Univer Workspace / 销售驾驶舱.univer.html`，没有 `mini-crm`，也没有目录路径。
    整个 breadcrumb 是一个 `<Link to="/home">`，点击文件名区域会跳到仓库列表。
    移动端页头连文件名都不显示。
  - 目录页（如 `data`）有页内 breadcrumb `mini-crm > data`，但 Files / PRs / Apps tabs 不见了，
    内容区也从 `max-w-6xl` 变成全宽，看起来像另一个产品。
  - 成员、回收站和 PR 详情页切换成左侧 sidebar 外壳，页头只剩 `mini-crm`，也没有 tabs。
- 影响：用户在仓库中每深入一层，只能靠浏览器后退返回，这是最主要的导航断点。
- 建议：见第 3 节阶段 1，统一 Repository 外壳和分段 breadcrumb。

**[P0-2] PRs 和 Apps 列表项不可点击**
- 位置：`routes/spaces.$spaceId.tsx:529-538`、`571-583`
- 现象：列表行是纯 `<li>`，没有链接。目标页已经存在：
  - PR：`/worktrees?spaceId=<id>&worktree=<id>`，实测可以打开对应 Worktree 的 review。
  - App：`/nodes/<nodeId>`，也可以用 `/apps?spaceId=<id>&node=<nodeId>`。
- 建议：整行使用 `<Link>`，保证中键和 ⌘+点击可以在新标签打开，不要用 `onClick` + `navigate`。

### P1：明显的使用障碍或违反 WCAG AA

**[P1-1] 仓库页头的 breadcrumb 语义错误**
- 位置：`-workspace-layout.tsx:516-528`
- 现象：`Univer Workspace / mini-crm` 整体只有一个 `/home` 链接，点击 `mini-crm` 不会回到仓库根目录。
  文件页还把 `ResourceTitle` 的「重命名」按钮嵌在这个链接里，形成嵌套交互元素。
- 标准：WCAG 4.1.2；HTML 规范禁止在 `<a>` 内嵌套交互内容。
- 建议：按 GitHub 的 `owner / repo` 模式，每一段是独立链接，`h1` 只包仓库名。

**[P1-2] 仓库根目录不能新建文件**
- 位置：`spaces.$spaceId.tsx:461`，`<NodeBrowser page={page} />` 没有传 `canCreateAtRoot`
- 现象：进入 `data` 目录后有「New」按钮，回到根目录后没有。Wiki 主题的同一路由有这个按钮。
- 建议：在 Files 卡片头部加入 GitHub 风格的「Add file」下拉，复用现有 `CreateNodeDropdown`。

**[P1-3] tab 行里的三个操作按钮风格不一致（用户问题 3）**
- 位置：`spaces.$spaceId.tsx:175-207`、`393-402`
- 现象：成员管理和空间设置使用 `Button variant="secondary"`，回收站是手写 class 的 `<button>`。
  三个带边框的按钮和下划线 tabs 排在同一行，读起来像另一组导航。移动端这三个按钮会换行到 tabs 上方。
- GitHub 的做法：仓库页头左侧是仓库名和 `Public` 标签，右侧是 Watch / Fork / Star；
  tab 行只放 tabs，最后一个 tab 是 **Settings**，Collaborators 等管理项在 Settings 的左侧子导航里。
- 建议：见第 3 节阶段 2。

**[P1-4] 默认 App 被限制在小盒子里（用户问题 4）**
- 位置：`spaces.$spaceId.tsx:460`、`492`，高度是 `h-[min(48vh,520px)]`
- 现象：Files 列表和 App 预览各自有固定高度和内部滚动。只有 3 个文件时，Files 卡片留下大块空白；
  App 在 520px 高的窗口里滚动，页面本身几乎不滚动。滚轮在外层和 iframe 之间反复被截获。
- 约束：HTML App 由 `@univerjs-labs/html-view-renderer` 放进 `sandbox="allow-scripts"` 的 iframe，
  没有 `allow-same-origin`，宿主无法读取内容高度。真正像 README 一样随内容撑开，需要 renderer
  通过 postMessage 回报内容高度。这是上游能力，本仓库不能靠 patch 解决。
- 建议：见第 3 节阶段 3。

**[P1-5] 仓库列表页的 sidebar 和主体重复（用户问题 5）**
- 位置：`home.tsx:75-119`、`-workspace-layout.tsx:301-324`
- 现象：sidebar 和主体列出的是同一组仓库。sidebar 中「Repository（实验性）」是主题名，却被用作分组标题。
  页头标题「首页」和正文 H2「Repositories」重复。「新建团队空间」按钮在列表下方，GitHub 把「New」放在右上角。
- 文案问题：「每个 Repository 对应一个团队空间」与列表中出现个人空间矛盾；
  「主题设置仅保存在当前浏览器」是给开发者的说明，不应作为页面副标题。
- 图标问题：个人空间也用了 `Users`（团队）图标。

**[P1-6] PR 列表的计数和状态不可信**
- 位置：`spaces.$spaceId.tsx:244-247`、`385-389`、`579-581`
- 现象：tab 徽标 `PRs 3` 统计了 active 和 processed 两类，而 mini-crm 的 3 个 PR 都已 Merged。
  GitHub 的徽标只统计 Open。状态文字是原始 enum 加 `capitalize`，没有本地化；
  每行都显示 “No summary provided.”，没有作者、时间、Unit 数量。
- 可用数据：`WorktreeSummary` 已提供 `creator`、`unitCount`、`createdAt`、`processedAt`、`state`，
  不需要修改 API。

**[P1-7] Issues tab 是没有后端能力的空壳**
- 位置：`spaces.$spaceId.tsx:599-614`
- 现象：永远显示 “No issues yet”，暗示存在一个并不存在的功能。
- 建议：移除这个 tab，等 Issue 模型真正存在后再加入。GitHub 仓库关闭 Issues 后也会隐藏这个 tab。

**[P1-8] 文案硬编码为英文并绕开 i18n**
- 位置：`spaces.$spaceId.tsx` 中的 “Files”“3 items in the repository root”“Default App”
  “Opening App…”“Could not load App”“Pull requests”“Worktrees grouped under …”“HTML view”
  “Apps connected to this repository.” 等 20 余处
- 现象：中文界面中英混排（见用户截图 1）。`i18n.tsx` 已经定义 `repositoryRootItems`、
  `repositoryAppsSummary`、`repositoryPageSelect`、`repositoryPageLoading` 等 key，但这个页面没有使用。
- 同时存在重复计数：卡片头写 “3 items in the repository root”，紧接着 NodeBrowser 又显示 “3 items”。

**[P1-9] 标题层级跳级**
- 位置：`spaces.$spaceId.tsx`，所有卡片标题都是 `h3`，页面只有一个 `h1`
- 标准：WCAG 1.3.1。建议改为 `h2`。

### P2：有替代路径的问题

**[P2-1] App 名称显示 `.univer.html` 后缀**：卡片标题、下拉框和 Apps 列表都显示完整文件名。展示时去掉后缀即可，数据不变（用户截图 2）。

**[P2-2] 默认 App 通过右上角原生 `<select>` 切换**：这是唯一的原生 select，和其他控件风格不一致。GitHub 的 README 卡片在顶部用 tabs 切换 README / Code of conduct / License，正好对应这里的多 App 切换（用户截图 2）。

**[P2-3] About 栏只有一句通用文案**：所有仓库显示同一句「团队空间的数据、智能工作台和 Apps」。`SpaceView` 没有描述字段，但已有 `publicRead`、`accessRole` 和 space ID，也能统计文件数、App 数和 Open PR 数。

**[P2-4] Files 视图缺少「Go to file」搜索**：Repository 外壳在 Files 视图不渲染页头搜索（`spaces.$spaceId.tsx:214-222` 只在 `view === "data"` 时显示）。`NodeBrowser` 已经支持 `searchQuery`。

**[P2-5] 目录页没有 `..` 返回行**：GitHub 目录列表的第一行是 `..`，点击返回上一级；这里只有面包屑。

**[P2-6] tabs 使用 `<button>` + `navigate`**：无法在新标签页打开，也没有 href。应改为 `<Link search={{ view }}>`。

**[P2-7] 移动端仓库页头挤压**：390px 下三个管理按钮占满第一行，tabs 被挤到第二行，Apps tab 被截断。阶段 2 把这些按钮移入 Settings 后，这个问题会一起消失。

**[P2-8] 回收站页和成员页缺少返回路径**：页头只显示 `mini-crm`，不显示 `mini-crm / Settings / 回收站`。阶段 1 统一外壳后解决。

### P3：细节打磨

**[P3-1] 暗色模式下 App 仍是亮色**：HTML App 是用户内容，iframe 内部不跟随主题。可以接受，但卡片边框和亮色内容之间可以留出内边距，避免硬切。

**[P3-2] PR 状态徽标没有语义色**：GitHub 用绿色表示 Open，紫色表示 Merged，红色表示 Closed，灰色表示 Draft，并配合对应图标。

**[P3-3] 仓库列表行只有名称链接变蓝**：GitHub 的列表行是仓库图标、名称、`Public` / `Private` 标签，下一行是描述和元信息。

## 3. 改进计划

### 阶段 1：统一 Repository 外壳和导航（P0-1、P1-1、P2-5、P2-8）

1. 重新定义 `repositoryShell`：只要 `workspaceTheme === "repository"` 且当前路由属于某个 space，
   就使用仓库外壳，包括 `/spaces/$id/members`、`/spaces/$id/trash`、`/nodes/$id`，以及带 `spaceId` 的
   `/worktrees` 和 `/apps`。用 `repositoryTab?: "files" | "prs" | "apps" | "settings"`
   取代 `selectedView === undefined` 这个隐式判断。
2. 页头使用分段 breadcrumb，每一段都是独立链接：

   ```text
   [logo] Univer Workspace / mini-crm / data / 销售活动
            └─ /home         └─ 仓库根目录  └─ /nodes/<目录id>   └─ 当前文件（纯文本，可重命名）
   ```

   `nodes.$nodeId.tsx` 已从 `query.data.breadcrumbs` 拿到路径，直接传给 layout 即可，不需要新 API。
   路径过长时折叠中间段为 `…`，移动端只显示 `… / 当前项`。
3. 目录页保留仓库 header 和 tabs（Files 高亮），内容区使用和根目录相同的 `max-w-6xl` 容器；
   列表首行增加 `..`。
4. 文件详情页（Univer 编辑器和 HTML App）需要全宽空间，因此只保留带完整路径的页头 breadcrumb，
   不显示 tabs。GitHub 的 blob 页也用路径 breadcrumb 返回上级。

### 阶段 2：仓库 header 和 tabs 按 GitHub 重排（P1-3、P1-7、P2-6、P2-7）

```text
┌──────────────────────────────────────────────────────────────────┐
│ ▣ mini-crm  [Public]                          [Add file ▾]       │  ← 仓库 header
├──────────────────────────────────────────────────────────────────┤
│ 📄 Files   ⎇ PRs (0)   ▣ Apps (2)                     ⚙ Settings │  ← UnderlineNav，Settings 靠右
└──────────────────────────────────────────────────────────────────┘
```

- 移除「成员管理 / 空间设置 / 回收站」三个按钮，新增 **Settings** tab，只在 `renameSpace`、
  `manageMembers` 或 `viewTrash` 任一能力为真时显示。
- Settings 页使用 GitHub 的左侧子导航：**General**（名称、公开只读、space ID）、**Members**、
  **Trash**。现在的「空间设置」弹窗改为 General 页面，Members 和 Trash 复用现有页面内容，
  路由可以保持 `/spaces/$id/members` 和 `/spaces/$id/trash`。
- 移除 Issues tab。
- 所有 tabs 改为 `<Link>`；计数徽标只统计 Open（`draft | ready | merging`）。
- `Public` / `Private` 标签来自 `space.publicRead`，个人空间显示 `Personal`。

### 阶段 3：Files 页面按 README 的方式随页面滚动（P1-2、P1-4、P2-1 至 P2-4）

1. **Files 卡片高度随内容变化**：移除 `h-[min(48vh,520px)]`，让列表自然展开，整页只有一个滚动容器。
   根目录项目很多时，可以显示前 N 项并提供「View all files」，这是可选优化。
2. **Files 卡片头部**：左侧是「Go to file」搜索框，接入 `NodeBrowser.searchQuery`；
   右侧是「Add file」下拉，复用 `CreateNodeDropdown`，并传入 `canCreateAtRoot`。
   删除重复的 “3 items” 行。
3. **App 卡片改为 README 风格**：
   - 卡片顶部用 tabs 切换多个 App（`客户跟进工作台 | 销售驾驶舱`），去掉原生 select 和 `.univer.html` 后缀；
     当前 tab 就是默认 App，继续保存在 localStorage。
   - 卡片右上角提供「在完整页面打开」图标链接，指向 `/nodes/<nodeId>`。
   - 高度分两步处理：
     - **现在可做**：卡片高度改为接近一个视口，例如 `h-[calc(100dvh-8rem)] min-h-[640px]`，
       并去掉外层额外的高度限制。滚动到 App 时它占满屏幕，不再像被困在小框里。
     - **需要上游支持**：请求 `@univerjs-labs/html-view-renderer` 通过 postMessage 回报 iframe 内容高度，
       宿主据此设置 iframe 高度，实现和 README 相同的整页滚动。在上游提供前，不要在本仓库放宽
       sandbox 或 patch 已安装的包。
4. **About 栏**：显示 visibility、我的角色、文件数、App 数、Open PR 数，以及 space ID 复制。
   如果需要真正的仓库描述，就要新增 `description` 字段，涉及 schema 迁移和 HTTP contract，
   应单独评估，不放进本轮。

### 阶段 4：PRs 和 Apps 列表（P0-2、P1-6、P3-2）

PR 行参照 GitHub 的 issue 列表：

```text
[Open 0] [Closed 3]                                           ← 状态筛选
⎇(紫) crm-activities-v2                               3 units
      weimin 于 2 天前创建 · 1 小时前合并
```

- 状态图标和颜色：`draft` 用灰色 `GitPullRequestDraft`；`ready` / `merging` 用绿色 `GitPullRequest`；
  `merged` 用紫色 `GitMerge`；`discarded` 用红色 `GitPullRequestClosed`。状态文字走 i18n。
- 没有摘要时不显示摘要行，不要每行重复 “No summary provided.”。
- 整行链接到 `/worktrees?spaceId=<id>&worktree=<id>`。阶段 1 完成后，这个页面也在仓库外壳内打开，
  PRs tab 保持高亮。
- App 行链接到 `/nodes/<nodeId>`，行尾可以提供「设为首页 App」操作，与阶段 3 的 tabs 共用同一状态。
- 空状态保留「打开智能工作台」入口。

### 阶段 5：仓库列表页（P1-5、P3-3）

```text
[logo] Univer Workspace                                   ⚙  (W)
────────────────────────────────────────────────────────────────
Repositories
[🔍 Find a repository…        ] [Type: All ▾]          [+ New]
────────────────────────────────────────────────────────────────
👤 weimin 的个人空间  [Personal]                        Owner
────────────────────────────────────────────────────────────────
▣ mini-crm  [Public]                                   Owner
────────────────────────────────────────────────────────────────
```

- Repository 主题下 `/home` 也使用无 sidebar 的仓库外壳。sidebar 列出的内容和主体相同，直接删除，不需要重新设计。
- 搜索框从页头移到列表上方，并加 Type 筛选（All / Personal / Team / Public）。
  「New」放在右上角，使用主按钮。
- 删除重复的「首页」标题和开发者说明；副标题可以删除，也可以改为「你可以访问的个人空间和团队空间」。
- 行元信息使用现有字段：类型图标（个人空间用 `User`，团队用 `Users`，公开团队可加 `Globe`）、
  visibility 标签、`accessRole`。更新时间和描述不在 `SpaceView` 中，本轮不展示，也不伪造。

### 阶段 6：横向清理（P1-8、P1-9）

- 把 `spaces.$spaceId.tsx` 的硬编码文案迁入 `i18n.tsx`，优先复用已有的 `repository*` key，并删除仍未使用的 key。
- 卡片标题从 `h3` 改为 `h2`。
- 手写的回收站按钮会在阶段 2 删除；其他按钮都使用 `Button` 组件。

## 4. 非目标和边界

- 不修改上游 HTML renderer 的 sandbox 策略。内容自适应高度作为上游需求提出。
- 不新增 Issue 模型、仓库描述字段或 PR 编号。这些都需要产品模型、schema 和 HTTP contract 改动，应单独立项。
- Wiki 主题的行为保持不变。所有改动都以 `workspaceTheme === "repository"` 为条件。

## 5. 验收方式

- 从 `mini-crm` 根目录进入 `data`，再进入 `销售活动`。每一层都能通过页头 breadcrumb 一步回到任意上级，
  并且始终能看到仓库名。
- 成员、回收站和 PR 详情页保持仓库外壳，对应 tab 高亮。
- PR 和 App 行可以点击，也可以用中键在新标签打开。
- Files 视图整页只有一个主滚动条（App iframe 内部滚动除外，直到上游支持自适应高度）。
- 390px 宽度下 tabs 单行显示，不被操作按钮挤压；文件页页头能看到当前文件名。
- 中文界面中没有仓库页的英文残留。
- `pnpm --filter @univerjs/univer-workspace typecheck` 通过，改动后运行
  `impeccable detect` 复查。

## 6. 建议执行顺序

1. **[P0]** `$impeccable harden`：阶段 1 和阶段 4 的可点击性，解决导航断点。
2. **[P1]** `$impeccable layout`：阶段 2 和阶段 3，包括 header、tabs、Settings 和 README 式 App 卡片。
3. **[P1]** `$impeccable distill`：阶段 5，删除仓库列表页的重复内容。
4. **[P1]** `$impeccable clarify`：阶段 6，处理 i18n、文案和标题层级。
5. **[P2]** `$impeccable adapt`：复查 390px 和 720px 断点。
6. `$impeccable polish`：收尾，包括 PR 状态色和仓库列表行细节。

## 7. 实施记录（2026-09-29）

六个阶段按顺序落地，每个阶段一个 commit：

| 阶段 | Commit | 内容 |
|------|--------|------|
| 1 | `a3fd875` | 统一仓库外壳：`repositoryTab` 取代隐式判断，分段 breadcrumb，Settings tab 与 General/Members/Trash 子导航，目录页 `..` 行，PR/App 行改为链接 |
| 2 | `2c5f013` | 仓库 header 按 GitHub 重排：breadcrumb 中显示 visibility，`New` 移到页头，tab 只留 tabs + 右侧 Settings，PR 徽标只统计 Open |
| 3 | `a97d5e2` | 去掉固定高度盒子，Files 与 App 随页面滚动；header 搜索接入文件列表；App 用 tabs 切换并去掉 `.univer.html`；About 卡片填入真实字段 |
| 4 | `59537fa` | 空间内的 PR 详情留在仓库外壳并高亮 PRs tab；PR 行补充合并时间与单复数；App 行去掉冗余标签 |
| 5 | `b025ea5` | 仓库列表页去掉重复 sidebar，搜索/类型筛选/主按钮重排，行内显示类型图标、visibility 和角色 |
| 6 | `dfae899` | 文案全部走 i18n 并删除失效 key，卡片标题统一 `h2`，移除手写按钮样式 |
| 验收修复 | `9ca74a8` | 文件页通过父目录补齐祖先链；tab 与 breadcrumb 使用精确匹配，避免 `aria-current` 误报；移动端 breadcrumb 折叠为 `… / 当前项` |

### 验收结果

| 验收项 | 结果 |
|--------|------|
| 根目录 → `data` → `商机管线`，任一上级一步可达，仓库名始终可见 | 通过（`✳ Univer Workspace / mini-crm 公开 / data / 商机管线`，`data` 可点击） |
| 成员、回收站、PR 详情保持仓库外壳，对应 tab 高亮 | 通过（`aria-current` 只落在 Settings / PRs tab） |
| PR 与 App 行可点击、可中键新标签打开 | 通过（真实 `href`：`/worktrees?spaceId=…&worktree=…`、`/nodes/<id>`） |
| Files 视图只有一个主滚动条 | 通过（`overflow-y-auto` 容器计数为 1） |
| 390px 下 tabs 单行、文件页能看到文件名 | 通过（tab 行高一行且无横向溢出；breadcrumb 为 `✳ / 当前项`） |
| 中文界面无仓库页英文残留 | 通过（仅保留 `Pull requests`、`Apps`、`SpaceId` 等产品或 schema 术语） |
| `typecheck` 与 `impeccable detect` | 通过（`tsc -p tsconfig.web.json --noEmit` 无输出；detect 结果为空数组） |
| 单元测试 | 通过（59 个文件、291 个测试） |
| Wiki 主题未受影响 | 通过（sidebar、最近访问/归我所有/与我共享、创建入口均保持原样） |

### 仍未完成的部分

- **App iframe 内容自适应高度**：仍是上游 `@univerjs-labs/html-view-renderer` 的能力缺口，
  当前用「接近一屏高度 + 页面滚动」规避，sandbox 未放宽。
- **Type 筛选只做了 All / Personal / Teams**：`Public` 是 visibility 而不是类型，没有伪造第四个筛选值。
- **PR 列表缺少 PR 编号**：产品模型里没有这个字段，未编造。
- 性能项（每次进入仓库首页都会挂载实时协同 HTML App、Worktree 列表客户端过滤）不在本次改动范围，
  需要单独评估。
