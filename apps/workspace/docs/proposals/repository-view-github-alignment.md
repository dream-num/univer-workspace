# Repository View 第二轮审计：术语、Pages 与导航修复

> 状态：待实施（2026-09-29）。本文是 [repository-view-ux-audit.md](./repository-view-ux-audit.md)
> 六个阶段落地后的复审，只记录新发现的问题和本轮计划，不重复已完成的内容。
>
> 审计样例：团队空间 `mini-crm`（`/spaces/0afc2180-…?view=files`），账号 `weimin`，
> Repository 主题，中文界面。视口：1440×900 桌面、390×844 移动；系统暗色主题。
> 覆盖页面：仓库列表 `/home`、Files 根目录、`data` 目录、Sheet 文件页、HTML App 文件页、
> PRs 列表与 PR 详情、Apps、设置（常规 / 成员管理 / 回收站）。

## 1. 结论

| # | 维度 | 分数 | 关键问题 |
|---|------|------|----------|
| 1 | Accessibility | 3 | 目录页「上一级」行的 `aria-label` 是当前目录名，读屏用户听到的目标和实际不符；页头出现两个相同的齿轮图标，含义不同 |
| 2 | Performance | 3 | 文件页为补祖先链多发一次 children 请求，而 node 接口已经返回完整祖先链；`RepositoryTabs` 与 layout 各自拉取 Worktree 列表 |
| 3 | Responsive | 3 | 移动端「关于」卡片排在 App 预览之后，需要滚过整个 App 才能看到；设置页移动端 breadcrumb 只剩 `/ 常规`，看不到仓库名 |
| 4 | Theming | 3 | PR 状态色直接用 `violet-600`、`emerald-600` 调色板，不走 token |
| 5 | Implementation Integrity | 2 | 「上一级」指向当前目录；仓库视图里混用「空间」「团队空间」；文件页在 early return 之后调用 `useQuery`；Pages 空状态跳出仓库外壳 |
| **合计** | | **14/20** | **Good：结构已经成型，需要修一个导航 bug 并统一术语** |

**Implementation Integrity：不通过。** 仓库外壳、tabs、Settings 子导航在所有页面上已经一致，
上一轮的结构问题已经解决。本轮不通过的原因有两个。第一，目录页的「上一级」行链接到当前目录，
点击后页面不变（用户问题 5）。第二，仓库视图借用了 Wiki 主题的全部文案，所以在 GitHub 式的
Files / Pull requests 页头下面出现「空间设置」「新建团队空间」「搜索空间」，还有英文 schema 字段名
`SpaceId`。用户看到的是两套产品概念拼在一起。

`impeccable detect` 对本轮涉及的 8 个文件返回空数组；下列结论来自代码阅读、API 实测和浏览器实测。

问题数量：P0 × 1，P1 × 6，P2 × 9，P3 × 3。

## 2. 用户提出的五个问题

| # | 问题 | 判断 | 对应条目 |
|---|------|------|----------|
| 1 | 「空间」相关文案应改为仓库叫法 | 成立，影响列表、设置、成员、对话框、About 共约 20 个 key | P1-1 |
| 2 | 「Apps」改为「Pages」，参照 GitHub Pages | 成立。除了改名，默认页面还缺少可访问的地址和「访问」入口 | P1-2 |
| 3 | 移除页头右上角「新建」，只保留目录页的「新建」 | 成立，但直接删除会让仓库根目录无法新建（Files 根目录卡片传的是 `canCreateAtRoot={false}`）。应该把「新建」移进根目录的 Files 卡片，和目录页位置一致 | P1-3 |
| 4 | 左上角 Univer Workspace 改为 OfficeLab | 成立，限定 Repository 主题 | P1-4 |
| 5 | 点击「上一级」没有反应 | 确认是 bug，根因见 P0-1 | P0-1 |

## 3. 问题清单

### P0：阻断任务

**[P0-1] 目录页「上一级」链接到当前目录（用户问题 5）**
- 位置：`web/src/features/nodes/node-browser.tsx:61-64`、`213-251`
- 现象：在 `mini-crm / data` 页，列表第一行显示 `data · 上一级`，`href` 是 `/nodes/59ad7e96…`，
  也就是 `data` 自己。点击后 URL 不变，页面无反应。
- 根因：`GET /api/nodes/{id}/children` 返回的 `breadcrumbs` 包含当前目录本身
  （`nodes.repository.ts:84` 的递归 CTE 从 depth 0 的当前节点开始）。实测：
  `data` 的 children page 返回 `breadcrumbs: [{ name: "data" }]`。`NodeBrowser` 把
  `breadcrumbs` 的最后一项当成父级，因此拿到的是当前目录。
- 修复：父级取倒数第二项；没有倒数第二项时，只有在 `navigationRootNodeId === null` 时才回到仓库根目录。
  通过分享进入子树的用户站在导航根上，没有可访问的上级，这时隐藏这一行，不能链接到会 404 的仓库根目录。

  ```ts
  const crumbs = props.page.breadcrumbs;
  const parent =
    crumbs.length >= 2
      ? { kind: "node", id: crumbs[crumbs.length - 2]!.id }
      : props.page.navigationRootNodeId === null
        ? { kind: "root" }
        : undefined; // 分享子树的根：没有上一级
  ```

- 文案：行首显示 GitHub 式的 `..`，`aria-label` 写成「返回上一级：mini-crm」这类包含目标名的文字。
  现在行内显示的是当前目录名 `data`，这和链接目标一样是错的。
- 测试：把上面的判断抽成纯函数，加一个小测试覆盖三种情况：二级目录、一级目录、分享子树的根。

### P1：明显的使用障碍

**[P1-1] 仓库视图混用「空间」术语（用户问题 1）**
- 位置：`web/src/shared/i18n.tsx` 中约 20 个 key；可见位置包括仓库列表的搜索框、类型筛选和
  「新建团队空间」按钮，Settings tab 和 breadcrumb 里的「空间设置」，常规页的「空间名称」「SpaceId」
  「复制空间 ID」，成员页的「搜索空间成员」和说明文字，About 卡片的 `SpaceId`，以及新建对话框。
- 另有两处同类问题：
  - 个人空间有两种名称。仓库列表显示服务端的 `weimin 的个人空间`，页头 breadcrumb 显示 `t("personalSpace")`。
  - `/home` 搜索无结果时，正文显示的是占位文字「搜索空间」（`home.tsx:124`），没有说明「没有匹配的仓库」。
- 修复方式：在 `LanguageProvider` 中增加一张 Repository 主题的覆盖表。`ThemeProvider` 已经包在
  `LanguageProvider` 外层（`app/providers.tsx`），`t()` 可以直接读 `workspaceTheme`，有覆盖值时使用覆盖值。
  这样只需要改一处，对话框、成员组件和 Toast 都会跟着切换，调用点不用改，Wiki 主题也不受影响。

  ```ts
  const repositoryMessages: Record<AppLanguage, Partial<Record<MessageKey, string>>> = { … };
  // t(): (workspaceTheme === "repository" && repositoryMessages[language][key]) || messages[language][key]
  ```

- 术语对照（GitHub 没有「个人空间 / 团队空间」这组概念，个人和团队只作为类型标签出现）：

  | key | 现在（zh / en） | Repository 主题（zh / en） |
  |-----|-----------------|----------------------------|
  | `searchRepositories` | 搜索空间 / Find a space | 查找仓库… / Find a repository… |
  | `personalSpace` | 个人空间 / Personal space | 个人 / Personal |
  | `teamSpace` | 团队空间 / Team spaces | 团队 / Team |
  | `createTeamSpace` | 新建团队空间 / Create team space | 新建仓库 / New repository |
  | `repositoriesEmpty` | 还没有团队空间 / No team spaces yet | 还没有仓库 / No repositories yet |
  | `spaceSettings` | 空间设置 / Space settings | 设置 / Settings |
  | `spaceName` | 空间名称 / Space name | 仓库名称 / Repository name |
  | `enterSpaceName` | 请输入空间名称。 | 请输入仓库名称。/ Enter a repository name. |
  | `teamSpaceId` | SpaceId | 仓库 ID / Repository ID |
  | `copySpaceId` / `spaceIdCopied` / `copySpaceIdFailed` | 空间 ID … | 仓库 ID … / Repository ID … |
  | `spaceRenamed` | 空间设置已更新。 | 仓库设置已更新。/ Repository settings updated. |
  | `publicReadDescription` | …此空间下的文件。 | …此仓库中的文件。/ …files in this repository. |
  | `members` | 成员管理 | 协作者 / Collaborators |
  | `searchMembers` | 搜索空间成员 | 搜索协作者 / Find a collaborator |
  | `spaceMembersDescription` | 团队角色将应用于这个空间的所有内容。 | 协作者的角色适用于此仓库中的所有文件。 |
  | `spaceEmpty` / `spaceRoot` / `destinationParentNodeHint` | 空间 / 空间根目录 | 仓库 / 仓库根目录 |
  | `allSpaces` / `belongingSpace` | 全部空间 / 所属空间 | 全部仓库 / 所属仓库 |

- 个人空间名称：增加 `spaceDisplayName(space, t)`，列表和 breadcrumb 共用。个人仓库统一显示
  `{username}`，搭配 `User` 图标和「个人」标签，形式接近 GitHub 的 `weimin/…`。服务端的 `name` 不修改。
- `CreateTeamDialog` 的失败兜底文字 `"Space creation failed."` 是硬编码英文，这次一起改为 i18n key。
- 不改动：URL（`/spaces/$spaceId`）、HTTP contract、服务端字段名。这些是内部标识，GitHub 的 URL
  也不会跟着 UI 文案变化。

**[P1-2] 「Apps」改为「Pages」，按 GitHub Pages 的方式组织（用户问题 2）**
- 位置：`features/spaces/repository-tabs.tsx:49`，`spaces.$spaceId.tsx` 的 `AppsView`（438-494）和
  `FilesView` App 卡片（313-376），About 卡片（378-413），i18n 中的 `apps`、`repositoryAboutApps`、
  `repositoryAppsSummary`、`repositoryNoApps*`、`repository*LandingApp`、`viewApps`、`repositoryPageLoading`。
- 现象：
  - Apps 列表只有名称和「设为首页 App」，看不到页面地址，也没有「访问」入口。GitHub Pages 最先展示的是
    “Your site is live at …” 和 **Visit site**。
  - 「首页 App」「设为首页 App」同时混用「首页」和「App」两个概念。
  - About 卡片把 Apps 数量当作一行统计。GitHub 在 About 中直接给出站点链接（🔗 homepage）。
- 设计：

  ```text
  ┌ Pages ───────────────────────────────────────────────────────────┐
  │ ● 默认页面：客户跟进工作台                                         │
  │   /nodes/8f49…?view=immersive                  [复制] [访问页面 ↗] │
  ├──────────────────────────────────────────────────────────────────┤
  │ ▣ 客户跟进工作台   客户跟进工作台.univer.html · 昨天 21:41    默认   │
  │ ▣ 销售驾驶舱       销售驾驶舱.univer.html · 昨天 21:41   [设为默认] │
  └──────────────────────────────────────────────────────────────────┘
  ```

  - Tab 文案改为 **Pages**，计数徽标显示页面数（HTML App 数量）。
  - 顶部状态框对应 GitHub Pages 的 “site is live” 卡片，显示默认页面、可访问地址和「访问页面」按钮。
    地址使用现有的沉浸视图 `/nodes/<id>?view=immersive`，这是目前最接近“发布后站点”的全屏只读视图。
    公开仓库的访客不登录也能打开这个地址。
  - 行内显示源文件名和 `node.updatedAt`（`OwnedResourceItem.node` 已有这两个字段，不需要改 API）。
  - 文案：「首页 App / 设为首页 App」改为「默认 / 设为默认页面」；About 卡片中去掉「Apps 2」这一行，
    改为 🔗 默认页面链接。Files 视图下方的预览卡片标签保持为页面名，右上角改为「访问页面 ↗」。
  - URL 参数 `?view=apps` 保持不变，只改文案。改成 `view=pages` 需要为旧链接保留兼容分支，目前没有这个需要。
- 修复空状态的出口：Files 与 Apps 空状态的「查看 Apps」按钮跳到 `/apps?spaceId=…`（`spaces.$spaceId.tsx:370`、
  `487`），这个路由使用 Wiki 外壳，页面会出现侧边栏，也就离开了仓库。在 Pages tab 里，这个按钮还指向当前所在的功能。
  空状态应改为说明如何创建 Page（沿用 `appsEmptyHint` 的 Agent 指引），不再跳转。
- 已知限制，本轮不做：默认页面保存在浏览器 `localStorage`（`univer-workspace-landing-app:<spaceId>`），
  每个人、每台设备看到的默认页面可能不同。GitHub 的 Pages 和 README 是仓库级设置。要改为仓库级设置，
  需要新增 Space 字段、schema 迁移和 HTTP contract，应单独立项，并按 `apps/workspace/AGENTS.md` 的迁移矩阵实施。
  在此之前，Pages 页需要用一行小字说明「默认页面仅对当前浏览器生效」，避免用户误以为已经为团队设置。

**[P1-3] 页头「新建」与仓库根目录的新建入口（用户问题 3）**
- 位置：`spaces.$spaceId.tsx:145-149`（headerActions），`305-311`（`canCreateAtRoot={false}`）
- 现象：根目录的「新建」在页头右上角，`data` 目录的「新建」在 Files 卡片头部，同一个操作出现在两个位置。
  页头的「新建」在 Pull requests 和 Apps tab 上也会显示，但这些页面和新建文件无关。
- 修复：删除 `headerActions`，给根目录 `NodeBrowser` 传入 `canCreateAtRoot={space.capabilities.createAtRoot}`。
  根目录和子目录的「新建」都位于 Files 卡片头部右侧，也就是 GitHub「Add file」的位置。
  这一项只删除一个 prop、修改一个 prop，不需要新增组件。

**[P1-4] 品牌名改为 OfficeLab（用户问题 4）**
- 位置：`routes/-workspace-layout.tsx:240`（仓库 breadcrumb 第一段）
- 修复：Repository 主题下文字改为 `OfficeLab`。Wiki 主题的侧边栏（`589`）、抽屉（`772`）、访客页头（`311`）
  和登录页（`auth-card.tsx:121`）保持不变，因为用户只要求修改 Repository 视图。
- 需要确认：
  - 图标仍是 `UniverCliIcon`。如果 OfficeLab 有自己的标志，请提供素材。在此之前不要自制图标。
  - 浏览器标签页标题固定为 `index.html` 的 `Univer Workspace`，而 layout 已经计算出 `pageTitle`
    （`427-431`），却只用于 Wiki 标题。建议在仓库外壳中同步设置 `document.title = "mini-crm · OfficeLab"`，
    做法与 GitHub 的 `owner/repo` 标题一致。见 P2-6。

**[P1-5] 文件页在 early return 之后调用 `useQuery`**
- 位置：`routes/nodes.$nodeId.tsx:110`（`return null`）和 `118-121`（`parentPage = useQuery(...)`）
- 现象：违反 Hooks 规则。loader 预先填充了缓存，所以目前一般不会触发；一旦某次渲染时
  `query.data` 为空，就会抛出 “Rendered more hooks than during the previous render”，整页崩溃。
- 根因：上一轮验收修复（`9ca74a8`）的注释写着 “The node endpoint only returns the Node itself in
  `breadcrumbs`”，这个前提不成立。实测 `GET /api/nodes/<商机管线>` 返回
  `breadcrumbs: [data, 商机管线]`，已经包含完整祖先链。
- 修复：删除 `parentPage` 查询，直接使用 `query.data.breadcrumbs`。`RepositoryBreadcrumbs` 已经会
  去掉和 `current` 重名的末项（`-workspace-layout.tsx:166`）。这样改同时修复 Hooks 问题，
  也少发一次请求，并删除一段依据错误前提写出的逻辑。

**[P1-6] 页头两个齿轮图标含义不同**
- 位置：`-workspace-layout.tsx:690-699`（应用设置）、`repository-tabs.tsx:79-89`（仓库 Settings tab）
- 现象：同一屏上下相距约 50px 有两个齿轮，一个打开浏览器级偏好（主题、语言、布局），另一个进入仓库设置。
  移动端的 Settings tab 只显示图标，两者更难分辨。
- 修复：Repository 主题下，把「应用设置」移到头像菜单中（GitHub 的个人设置也在头像菜单里），
  页头只保留头像。Wiki 主题保持不变。

### P2：有替代路径的问题

**[P2-1] 页头搜索在 PRs / Pages tab 上无关**：页头放大镜的提示是「搜索文件」，只过滤 Files 列表，但在
Pull requests 和 Apps tab 上也会显示。GitHub 把「Go to file」放在文件列表上方。建议移到 Files 卡片头部左侧，
作为常驻输入框，和右侧的「新建」对称。PRs 和 Pages 页头不再显示搜索。

**[P2-2] Files 列表的「权限」列在仓库视图中没有信息量**：mini-crm 中每一行都是「所有者」。GitHub 这一列显示
最后一次提交说明，本产品没有这类数据。Repository 主题下隐藏「权限」列，保留名称和最后修改时间，
行高从 56px 收到 GitHub 的 40px 左右，这样一屏能看到更多文件。

**[P2-3] 设置子导航的 breadcrumb 不一致**：常规页显示 `mini-crm / 空间设置 / 常规`，回收站显示
`mini-crm / 空间设置 / 回收站`，成员页却显示 `mini-crm / 成员管理`，缺少「设置」这一段
（`spaces_.$spaceId.members.tsx:40`）。另外，「设置」这一段是纯文本，没有链接到设置页。
三页统一为 `mini-crm / 设置 / <子页>`，其中「设置」可点击。

**[P2-4] PR 详情仍然使用 Wiki 的 Worktree 面板**：进入 PR 后，仓库 tab 下方显示「查看 AI Agent 正在处理…」
说明、全部 / 进行中 / 待确认 / 已处理筛选和「全部空间」下拉（`worktree-dashboard.tsx:446`）。在单个仓库里，
「全部空间」没有意义，筛选也和 PR 列表的 Open / Closed 重复。`spaceId` 存在时应隐藏空间下拉和说明行。
更完整的 GitHub PR 详情页（标题、状态徽标、Conversation / Files changed）属于较大的改版，放在后续轮次。

**[P2-5] 仓库列表的类型信息重复**：每行的类型同时出现在图标（User / Globe / Users）和文字标签中。
GitHub 每行只有一个 Public / Private 标签，并在下一行显示元信息。保留标签，图标统一为仓库图标。
个人仓库显示为 `weimin` 加「个人」标签（见 P1-1）。

**[P2-6] 浏览器标题固定**：所有仓库页的标签页标题都是 `Univer Workspace`。多个标签页之间无法区分，
历史记录也无法区分。见 P1-4。

**[P2-7] 移动端 About 位置**：390px 下 About 卡片排在 App 预览之后，要滚过整屏 App 才能看到。GitHub
移动端把仓库描述和元信息放在文件列表之前。在 `lg` 以下把 About 压缩成仓库 header 下方的一行元信息，
例如 `公开 · 所有者 · 3 个文件 · 2 个 Pages`。

**[P2-8] 移动端设置页看不到仓库名**：390px 下 breadcrumb 折叠成 `✳ / 常规`。子页应至少保留仓库名，
折叠后显示 `mini-crm / 常规`。

**[P2-9] 公开仓库的访客看不到仓库视图**：`spaces.$spaceId.tsx:87` 要求 `space !== undefined`，而 space 只在
登录后才能取得。`VisitorLayout` 也不支持 Repository 外壳。GitHub 上，公开仓库最常见的读者正是未登录访客。
是否让访客也使用仓库视图属于产品决策，本轮只记录，不实施。

### P3：细节打磨

**[P3-1] PR 列表头部重复**：卡片标题「Pull requests」和上方 tab 重复。GitHub 在列表头部左侧直接放
`⎇ 3 Open  ✓ 3 Closed` 切换，不再加标题。

**[P3-2] PR 状态色没有使用 token**：`text-violet-600`、`text-emerald-600`、`bg-violet-500/10` 等颜色
直接写在 `spaces.$spaceId.tsx:612-646`。建议提取 `--state-open`、`--state-merged`、`--state-closed` 三个 token。

**[P3-3] About 中的 ID 截断**：`SpaceId: 0afc2180-e461-4efd-80b7-e…` 截断后无法复制。设置页已经有复制按钮，
About 可以删除这一行；如果保留，需要加上复制按钮。

## 4. 改进计划

每个阶段单独提交，都可以独立验证。只有阶段 1 修改业务逻辑，其余阶段只改文案和布局。

### 阶段 1：导航修复（P0-1、P1-5）

1. `node-browser.tsx`：父级改为 `breadcrumbs` 倒数第二项；在导航根上隐藏「上一级」行；
   行内文字改为 `..`，`aria-label` 包含目标名。判断逻辑抽成纯函数，并补一个三用例测试。
2. `nodes.$nodeId.tsx`：删除 `parentPage` 查询和错误注释，breadcrumb 直接使用 `query.data.breadcrumbs`。
3. 验证：`mini-crm → data → 上一级` 回到根目录；`data → 商机管线` 的 breadcrumb 仍然是
   `mini-crm / data / 商机管线`，并且 `data` 可以点击。

### 阶段 2：术语与品牌（P1-1、P1-4、P1-6、P2-3、P2-6）

1. 在 `i18n.tsx` 中增加 `repositoryMessages` 覆盖表，填入第 3 节 P1-1 的对照表，中英文都要覆盖；
   由 `LanguageProvider` 读取 `useTheme().workspaceTheme`。
2. 新增 `spaceDisplayName()`，用于列表和 breadcrumb；`CreateTeamDialog` 的英文兜底文字改为 i18n key。
3. 在 `RepositoryBreadcrumbs` 中，品牌文字改为 `OfficeLab`；仓库外壳设置 `document.title`。
4. Repository 主题下把「应用设置」移入头像菜单。
5. 统一设置三页的 breadcrumb：`仓库 / 设置 / 子页`，「设置」可点击。
6. 验证：Repository 主题的中英文界面中，仓库相关页面不再出现「空间」「space」；切回 Wiki 主题后，
   文案与改动前逐字一致。

### 阶段 3：Files 卡片头部（P1-3、P2-1、P2-2）

```text
┌ Files ───────────────────────────────────────────────────────────┐
│ [🔍 搜索文件…                ]                        [+ 新建 ▾] │
├──────────────────────────────────────────────────────────────────┤
│ 全部类型 ▾                                            最后修改   │
│ ..                                                     上一级   │  ← 仅子目录
│ 📁 data                                                 昨天 21:51 │
└──────────────────────────────────────────────────────────────────┘
```

1. 删除 `spaces.$spaceId.tsx` 的 `headerActions`；根目录 `NodeBrowser` 传入 `canCreateAtRoot={space.capabilities.createAtRoot}`。
2. 删除页头的 `WorkspaceHeaderSearch`，把搜索框放进 Files 卡片头部。`NodeBrowser` 已经有 `actions` 插槽和
   `searchQuery` prop，只需要调整头部的左右布局。根目录页和目录页使用同一个布局。
3. Repository 主题下隐藏「权限」列，收紧行高。

### 阶段 4：Pages（P1-2）

1. 修改 i18n 覆盖值：`apps → Pages`，以及默认页面相关文案。
2. 重写 `AppsView`：顶部显示默认页面状态框（地址、复制、访问），列表行显示源文件和更新时间，行尾放「设为默认页面」。
3. About 卡片中，「Apps 2」这一行改为 🔗 默认页面链接。
4. 空状态不再跳转 `/apps`，改为展示创建指引。
5. 在 Pages 页用一行小字说明「默认页面仅对当前浏览器生效」。

### 阶段 5：收尾（P2-4、P2-5、P2-7、P2-8、P3）

- 在仓库内的 PR 详情页隐藏「全部空间」下拉和说明行。
- 仓库列表每行只保留 visibility 标签。
- 移动端 About 改为一行元信息；设置子页的 breadcrumb 保留仓库名。
- PR 列表头部改为 Open / Closed 切换，提取 PR 状态色 token，处理 About 中的 ID 行。

## 5. 非目标

- 默认页面（Pages 的 index）改为仓库级设置：需要 schema 迁移和 HTTP contract 变更，单独立项。
- 访客使用仓库视图（P2-9）：需要产品决策。
- GitHub 式 PR 详情页（Conversation / Files changed）、仓库描述字段、提交记录列：产品模型中没有这些数据，不伪造。
- 修改 URL、路由名或服务端字段中的 `space`：这些是内部标识，不属于 UI 术语。
- Wiki 主题：所有改动都以 `workspaceTheme === "repository"` 为条件。

## 6. 验收方式

- `mini-crm → data`：点击 `..` 回到根目录；通过分享进入子树的用户在导航根上看不到 `..`。
- 仓库根目录和子目录的「新建」都在 Files 卡片右上角；页头没有「新建」，也没有搜索图标。
- Repository 主题下，中英文界面的仓库列表、Files、Pages、PRs、设置、成员、回收站和新建对话框中
  没有「空间」或 “space” 字样；Wiki 主题文案不变。
- 仓库页左上角显示 `OfficeLab`，浏览器标签页标题为 `<仓库名> · OfficeLab`。
- Pages tab 可以看到默认页面的地址，并能通过「访问页面」打开沉浸视图；空状态不会离开仓库外壳。
- 页头只有一个齿轮，即仓库的 Settings tab。
- `pnpm --filter @univerjs/univer-workspace typecheck` 与 `test` 通过，并对改动文件运行 `impeccable detect`。

## 7. 建议执行顺序

1. **[P0]** `$impeccable harden`：阶段 1，修复「上一级」和文件页的 Hooks 顺序。
2. **[P1]** `$impeccable clarify`：阶段 2，处理术语覆盖表、OfficeLab、设置 breadcrumb 和应用设置入口。
3. **[P1]** `$impeccable layout`：阶段 3，调整 Files 卡片头部，统一「新建」和「搜索」的位置。
4. **[P1]** `$impeccable shape`：阶段 4，完成 Pages tab 和默认页面状态框。
5. **[P2]** `$impeccable adapt`：阶段 5 中的移动端 About 和 breadcrumb。
6. `$impeccable polish`：处理 PR 列表头部、状态色 token 和列表行细节。
