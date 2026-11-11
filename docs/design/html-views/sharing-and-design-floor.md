# HTML View 分享与观感改进方案

状态：方向已确定，正在实施。日期 2026-11-11。现状描述来自代码阅读，凡是推断或尚未运行验证的地方都单独标注。

[返回集成概览](README.md)

## 我们要解决什么

用户的数据已经在某个 repository（即 Space）的 Sheet 里。目标是让 Agent 基于这些数据很快做出一个 HTML view，
然后把链接直接发出去。拿到链接的人不需要注册或登录就能看到页面和实时数据，页面再引导他注册 Workspace。
页面要有机会被一传十、十传百地转发出去。

围绕这个目标有三个具体问题：

1. 匿名查看。访客不登录也要能看，并且看到注册入口。
2. 观感下限。Agent 默认生成的页面不够好看，需要提高最差情况下的视觉质量。
3. 两个入口。CLI（`uvw`）和 MCP 都要支持完整流程，验证以 MCP 为主。

## 已确定的原则

- HTML view 是绑定实时 Sheet 数据的小型应用，不是静态页面。渲染、分享和预览都基于实时数据，
  不做快照、静态导出或内联数据副本。这条规则写进了根 `AGENTS.md` 的 “HTML View” 一节。
- 访客权限跟随 repository 的文档权限。匿名访客和非成员只读，页面写入一律被拒绝。

## 现状

### HTML view 是什么

HTML view 是一个普通 Blob，文件名以 `.univer.html` 结尾。系统只按后缀识别它
（`isHtmlViewFilename`，见 `apps/workspace/web/src/features/blobs/blob-preview.tsx` 与
`apps/workspace/server/src/modules/views/views.repository.ts` 中的 `LIKE '%.univer.html'`）。
产品数据库里没有 HTML view 专用表，`GET /api/html-views` 只是过滤后的 Blob 列表。

页面引用的 Sheet 只写在 HTML 属性里，例如 `data-univer-cell-text`、`data-univer-cell-model`、
`data-univer-cell-subscribe` 和 `data-univer-range-subscribe`。引用格式是
`unitId:sheetId:B7` 或 `unitId:sheetId:A1:B10`，坐标固定，插入或删除行列时不会跟着移动。
数据库里没有“页面引用了哪些 Sheet”的记录。页面只读写 Sheet 的 trunk，HTML Blob 不进入 Unit Worktree。

### Agent 怎样生成和发布

CLI 和 MCP 共用 `packages/client-core/src/html-view.ts` 的 `WorkspaceHtmlViewFeature`：

- `validate` 用 `parseHtmlView()` 解析声明式引用，再通过 trunk runtime 的 `exportUnitData` 检查子表存在、
  坐标不越界，返回 `{ valid, unitIds, bindingCount }`。它不执行脚本，也不渲染页面。
- `create` 做同样的校验，把校验过的字节上传为 Blob，返回 `workspaceUrl`，形如 `<origin>/nodes/<nodeId>`。

入口如下：

| 入口 | 命令或工具 | 说明 |
| --- | --- | --- |
| CLI | `uvw html-view validate --file`、`uvw html-view create --file --space --name --idempotency-key` | 读本地文件，上传前复制一份临时副本 |
| MCP | `html_view_validate`（scope `read`）、`html_view_create`（scope `publish`） | 只在 `toolsets=files` 或 `all` 时出现；大文件先走 `file_upload_create` |
| DSH Agent | `univer_html_view` 的 `validate` / `create` | 没有用 client-core，自己实现了一遍同样的流程 |

创作指引在 `apps/cli/skill-data/html-view/`（`SKILL.md` 加四个 reference）。MCP 构建时由
`apps/mcp/scripts/assemble-skills.mjs` 原样复制这份 Skill。DSH 插件在
`packages/dsh-univer-workspace-plugin/skills/univer-html-view/` 维护一份手工同步的分叉，差异主要是工具名。

这三份 Skill 讲的都是绑定机制，没有视觉设计内容。整个目录里唯一的样式值是图表容器的
`style="width:100%;height:360px"`。Agent 也看不到自己的页面。MCP 的 `screenshot` 只支持
`sheet | doc | slide | board | base`（`apps/mcp/src/shared/screenshot-schema.ts:4`）。

### 匿名只读已经能用

`apps/workspace/README.md` 的 “Anonymous viewing” 一节有完整说明：

- 未登录请求以保留身份 `workspace:anonymous` 进入权限解析，不创建 User、Session 或 Recent。
- 匿名访客只能从两处拿到 viewer 权限：节点或祖先节点开启了 Link Sharing，或者 Space 开启了
  `public_read`（`access.service.ts:281-296`）。
- 协同网关用一份 GET 白名单放行匿名的 session ticket、snapshot、评论和历史读取
  （`collaboration-gateway.ts:59-64`），匿名 WebSocket 只能读。
- 页面写入在共享组件里先被拦下，匿名访客收到 `signInRequired`（`workspace-html-viewer/src/engine.ts:63-68`）。

repository 是 team Space（`spaces.repository.ts:163`），Link Sharing 只能用于 personal Space，
所以 repository 场景下的匿名入口就是整库公开，用 `uvw repo edit --visibility public` 或 MCP `admin` 工具集中的 `repo_edit` 设置。

## 方案

### 分享：整库公开，访客看实时数据

repository 设为公开后，任何人打开页面的沉浸视图链接 `/nodes/{id}?view=immersive` 都能看到实时数据，
现有链路不需要改服务端权限。缺的是 Agent 不知道一个新页面能不能被非成员打开。

`html-view create`（CLI 和 MCP）增加三个返回字段：

| 字段 | 含义 |
| --- | --- |
| `shareUrl` | 沉浸视图链接，与 Browser 分享对话框生成的一致 |
| `repositoryVisibility` | 目标 repository 是 `public` 还是 `private` |
| `privateSourceUnitIds` | 所在 repository 不公开的来源 Sheet；匿名访客读不到它们 |

HTML View Skill 增加 “Share the page” 一节，要求 Agent 把 `shareUrl` 交给用户并说明谁能打开。
用户要“任何人可看”而 repository 是私有的时，Agent 先征求用户同意再公开 repository，因为公开会立即暴露库里的全部内容。
这些字段只是给 Agent 的提示，每个请求仍由服务端鉴权。

我们考虑过只公开页面需要的单元格（发布快照），它暴露面最小，但页面会变成静态内容，违背“页面是小应用”的原则，因此不采用。
整库公开的代价是来源 Sheet 的全部内容对匿名访客可读，Skill 里要提醒用户把要公开的数据放进专门的公开 repository。

### 访客注册引导

引导条由宿主渲染，放在 iframe 外面，不依赖 Agent 写进 HTML，作者忘不掉，页面脚本也伪造不了。

- 未登录访客在沉浸视图底部看到一条不遮挡内容的细条：“用 Univer Workspace 制作”，
  加上“免费注册”“登录”和“复制链接”。可以收起成小标签，收起状态只在当前标签页内保留。
- `/login` 接受 `mode=register`，直接打开“创建账号”；`returnTo` 指回原页面，注册后回到这里。
- 非沉浸的访客顶栏在“登录”旁加“注册”。
- 访客尝试修改数据时，提示改为“访客不能修改数据”，并指向底部的注册入口。注册不会让访客成为 repository 成员，
  所以文案不承诺注册后可以编辑。

### 链接预览

链接被贴进 Slack、飞书、微信时，预览今天只显示应用外壳的通用标题。生产服务器返回 SPA `index.html` 时，
对匿名身份可读的 `/nodes/{id}`，在 head 里写入页面名称和一句描述（`og:title`、`og:description` 等），
中文 `Accept-Language` 用中文描述。私有或不存在的节点返回原样的 `index.html`，不泄露任何信息。
这次不生成预览图片。

### 提高观感下限

Agent 的页面不好看，是因为它没有好的起点，也没有设计规则。HTML View Skill 增加：

- `references/design.md`。Agent 按场景和数据形状自己选模板，不询问用户。它规定基础质量要求（对比度、间距节奏、
  字号层级、数字用 `tabular-nums`、主题化的选区、焦点和滚动条、各种状态、360px 到 1440px 的响应式），
  列出让页面显得“机器生成”的常见做法并要求避开，规定同一用户的多个页面要变化强调色和布局，避免审美疲劳。
  设计原则参考 [impeccable](https://github.com/pbakaus/impeccable)。
- `references/templates/` 下四个风格完全不同的模板：带假设输入的财务或计划报告、带实时图表和筛选的运营看板、
  可就地编辑和追加记录的跟踪工作台、适合手机截图转发的公开展示页（排行榜、活动结果或投票）。
- 每个模板都展示数据绑定 SDK 的长处。页面控件直接修改来源单元格，页面其他部分通过订阅实时响应；
  写入失败时在控件旁显示原因，只读访客照样能正常浏览。

公开展示页专门为传播设计。它在手机上好看，并带一个会写回 Sheet 的互动（例如投票），访客点了会被引导注册。

### CLI 与 MCP 的落点

| 能力 | 改动位置 | CLI | MCP |
| --- | --- | --- | --- |
| 分享信息 | `WorkspaceHtmlViewFeature.create` | `uvw html-view create` 输出 | `html_view_create` 输出 |
| 分享指引与模板 | `apps/cli/skill-data/html-view/` | 随 CLI Skill 发布 | 构建时复制，`skills_read` 可读 |
| 注册引导、链接预览 | Workspace Browser 与 Server | 不涉及 | 不涉及 |

DSH 插件的 Skill 分叉暂不同步，后续单独处理。

## 验证计划（以 MCP 为主）

在 `verify-uvw` 的隔离实例上开启 MCP，用 MCP 工具驱动，Browser 部分用 agent-browser 的全新无 cookie 会话：

1. 用 MCP 建 repository 和 Sheet，写入数据。Agent 读 `design.md`，选模板，`html_view_validate` 后 `html_view_create`。
2. 私有 repository：返回 `repositoryVisibility: private`；匿名会话打开 `shareUrl` 看不到页面。
3. `repo_edit visibility=public` 后再建一个页面：返回 `public` 且 `privateSourceUnitIds` 为空；
   匿名会话打开 `shareUrl`，看到实时数据和底部注册条。
4. 登录用户在另一个会话修改 Sheet，匿名会话中的页面实时更新。
5. 匿名访客操作页面控件，写入被拒绝，提示指向注册；Sheet 数据不变。
6. 点“免费注册”，打开创建账号页；注册后回到原页面。
7. 生产构建下 `curl` 公开页面的 `/nodes/{id}`，head 里有页面标题；私有页面的响应与 `index.html` 一致。
8. 用 CLI 的同名命令重复第 1 到 3 步，确认两边输出一致。

## 交付

四个改动互不依赖，各自从 `main` 开 PR：

| PR | 内容 |
| --- | --- |
| 访客注册引导 | Browser：底部注册条、`/login?mode=register`、访客写入提示 |
| 分享信息 | client-core、CLI、MCP 的 `create` 返回字段，Skill 的分享一节 |
| 设计指引与模板 | Skill 的 `design.md` 和四个模板，打包脚本带上 `templates/` |
| 链接预览 | Server：公开节点的 head meta |

## 后续可以考虑

- 用 Agent 自己的会话渲染并截图页面，让 Agent 发布前看到实际效果。
- DSH 插件 Skill 同步模板与分享指引。
- “用这个模板做一个我自己的”：访客注册后一键复制页面到自己的空间，再绑定自己的数据。这是更强的传播入口，
  但涉及跨 Space 复制和重新绑定，等有了注册转化数据再决定。
