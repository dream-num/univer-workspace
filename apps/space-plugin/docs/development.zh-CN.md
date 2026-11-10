# Space Plugin 开发者指南

本指南承载 Space 插件的技术行为参考、构建与打包流程，以及测试清单。面向用户的安装说明在
[installation.zh-CN.md](installation.zh-CN.md)；Server 与运维职责在
[administration.zh-CN.md](administration.zh-CN.md)。

Space 是 Univer Workspace 的概念验证（POC）插件。它运行在官方 DeepSeek Harness（DSH）内部，
连接一个 Workspace 服务，让你浏览文件、编辑 Univer Docs 与 Sheets，并在打开的文档旁边与 AI
对话。此预览针对 DSH 0.2.2-rc.1。它是在 DSH 内使用 Workspace 的一种可选方式，并不替代
独立的 Workspace Agent 桌面应用。评估期间请使用非关键文档。

Space 提供内容导航、可协同编辑的 Univer Docs/Sheets、正式的 Slides/Canvas/Relational Table
查看器、用于 Pages 的共享 Workspace HTML Viewer，以及浮动显示的原生 DSH Conversation。会话
历史、输入框、模型、Agent 与工具日志由 DSH 管理。插件不修改官方宿主源码。

## 从源码构建

使用 Node >=24.9.0、pnpm 11 以及本应用隔离的 npm 依赖图。从仓库根目录开始，先构建共享
runtime 与 reference provider，再安装插件的本地构建依赖：

```sh
pnpm --filter '@univerjs/univer-workspace-agent-runtime...' --filter '@univerjs/univer-workspace-client-core...' --filter '@univerjs/univer-workspace-reference-provider...' install --frozen-lockfile
pnpm --filter @univerjs/univer-workspace-agent-runtime build
pnpm --filter @univerjs/univer-workspace-client-core build
pnpm --filter @univerjs/univer-workspace-reference-provider build
cd apps/space-plugin
npm ci --no-audit --no-fund
npm run build
npm test
npm run typecheck
npm run package:release -- /absolute/output/outside/repository
```

使用官方 DSH 插件管理器安装产出的 tarball。耦合的 Univer 依赖固定为 1.4.0；React 18 由官方
宿主模块加载器解析。Tailwind 工具类带前缀/作用域，preflight 关闭。打包器从已提交的
`package-lock.json` 复制生产依赖闭包；它绝不重新解析新的传递依赖版本。清单/版本变更需要
同步更新 package-lock。桌面安装包在仅宿主可见的 `lib/runtime-license.json` 中包含仓库现有
的 Workspace 应用 license，以及配套的 Exchange 校验密钥。若它缺失或与当前源码不一致，打包
与资源扫描会失败。构建日志和已提交的生成文件中不会写入任何 license 值。构建期 PostCSS
将 SDK 全局 reset 块与无前缀工具类限制在编辑器和 Univer namespace portal 根节点内；已发布
的 SDK 文件保持完整。

每次推送到 `feat/space-full-univer-integration` 也会构建一个 **Space Plugin** workflow
artifact。从成功的 GitHub Actions run 中下载并解压。它包含
`space-plugin-<version>-<short-sha>.tgz`、`SHA256SUMS` 和 `build-info.json`；Actions 保留
30 天。在解压后的目录中，用 macOS 的 `shasum -a 256 -c SHA256SUMS` 或 Linux 的
`sha256sum -c SHA256SUMS` 校验下载。然后按[安装](installation.zh-CN.md#安装)所述在官方 DSH
插件管理器中安装该 tarball。这些 workflow artifact 是供评审的构建产物，不是 GitHub Release
或 npm 发布。

## 打包

`npm run package:release -- <仓库外输出目录>` 只暂存运行时文件、仅生产用的清单、声明与
npm-shrinkwrap.json。npm 消费者遵循该 lock；DSH 的 pnpm 管理器拥有其 profile lock 并需要
registry 访问。请保留 profile lock 以便完全一致地重装。在分发新产物前，运行发布扫描与实际
的干净 profile 安装。

打包器读取 `docs/installation.md`，并通过 `scripts/package-readme.mjs` 生成包内 `README.md`。
包内 README 必须包含 Install、Update 与 Uninstall 三节，不得包含开发命令，并且只链接绝对
公开 URL，以保证安装后仍可打开。`test/package-readme.test.mjs` 在不构建、不打包、不依赖运行
环境的前提下验证这些规则。

发布脚本会在产物旁写入 `package-inventory.json`。该清单记录被扫描的文件列表、字节数与逐文件
SHA256、产物 SHA256 以及许可范围。`scripts/verify-release.mjs` 会据此校验 tarball、清单、运行时
lock、必需运行时资源与包内 Host license。

## 行为参考

1. 打开一个已有的原生 DSH Conversation 并选择 Space 全局入口。一条常驻的 52px Activity Bar
   可选择 Chat、Space 与原生全局面板。Chat 拥有原生 Session 列表；Space 提供带 Space 标题
   的公开 `sidebar.workspaces` 内容。顶部次要按钮将其收起；选中的 Activity 条目会恢复它。
   Plugins/Automation 没有 Session 列表，也没有多余的次要轨道。这一受控的 DOM/CSS 集成限定
   在官方 Web 版本 `0.2.2-rc.1` / commit `c59d10a` 与测试过的原生结构上。未知版本保持原生
   导航，不应用该适配器。宿主控件、宽度偏好与 Sessions 仍由宿主拥有；卸载会移除该适配器。
2. 选择 **Sign in to Univer**。默认服务为 `https://space.univer.ai/`；系统浏览器完成已有的
   Workspace 授权，插件再用 PKCE 交换其一次性 code。DSH Settings → Workspace 拥有账户、
   切换账户、退出登录与自定义 Workspace URL。宿主凭据提供方只持久化插件自己的授权；客户端
   不收到 cookie 或 token。
3. All / Your items 列表展示真实且经 ACL 检查的元数据。Pinned 是独立的本地导航与 Suggested
   分区；它不代表 Favorites。Space 打开 Overview / Content；Folder 打开自己的面包屑与内容
   列表。
4. Docs 与 Sheets 使用正式的已发布 Core preset、Collaboration Client、浏览器协同 UI 与
   Facade Server loader。工具栏、选区/右键菜单与协同 Undo/Redo 仍由 SDK 拥有。SDK changeset
   远程保存；其他客户端通过真实的 Server WebSocket 接收编辑。文件切换会在销毁前排空待处理
   变更；刷写失败时当前编辑器保持打开。断连期间，新的内容编辑会暂停直到重连。可靠的离线
   写入未启用。SDK 的排队在线变更恢复仍然启用。Workspace cookie 保持仅宿主可见；隔离的授权
   由官方凭据提供方持久化：SDK HTTP 使用已有的 owner Connection；WebSocket 使用其一次性
   session ticket 直连 Workspace。Slides/Canvas/Relational Table 保持分离式预览。Pages 专门
   映射到 Server 的 `.univer.html` Blob，使用 Fork 的共享正式沙箱与绑定引擎。它支持脚本、
   经过认证的 Sheet 绑定、检查，以及离开前保存并在连接变更失败后恢复。License 使用 Fork
   现有的源码，通过官方 SDK 初始化。Docs/Sheets Comments 使用正式 preset 与远程数据源；
   文档工具栏打开原生面板。Docs 支持选区锚点、回复、Resolve/Reopen，以及原文被移除后仍
   保留的讨论。History 仍未验收。
5. 浮动对话提供紧凑消息、展开与最小化三种状态。可拖动其抓手、调整任一侧尺寸、恢复窗口、
   创建宿主 Conversation 或从 History 中选择一个已有的。它是一份 DSH 输入框/记录，消息、
   模型、运行状态与工具由 DSH 拥有。它绝不占用编辑器宽度。
6. 打开六种受支持内容类型中的任意一种或一个 Markdown Blob 时，会在 `conversation.input.dock`
   中将其稳定身份与所选原生 Session 显式关联。可在那里移除或重新关联。提问“总结当前文档”；
   原生 Agent 会收到一段简短的运行时上下文身份，并通过 `univer_inspect` 读取当前 Server
   内容（Docs 文本、Sheets 单元格、Slides/Canvas/Relational Table 的结构化 SDK Unit 数据、
   Pages HTML 源码）。普通用户消息中不会插入正文或大段 JSON。Page 关联在原生消息接纳时
   冻结，包括排队请求；过期的关联响应会被拒绝。
7. 已有的持久 Workspace 引用仍可通过公开的 UserText 规则/键控 Slot 点击。点击会重新检查
   当前 ACL 与 Node/Resource/Unit，打开文件，保留其原生 Session 并显示当前关联。文件切换
   保留各已选原生 Session 与未发送草稿。Workspace 身份/端点变更会清除 Workspace 授权与
   内容，但不清除 DSH 引用。关闭查看器会返回其来源列表。重连同一端点会保留认证；无效或不可
   达的替换端点会保留现有服务。

Create / New 保留全部八个条目：Doc、Sheet、Slide、Canvas、Relational Table、Page、Folder、
Space。全部使用 Personal Space；Space / Folder 使用当前目录。六种内容类型在 Server 持久化后
自动打开。Folder 留在其父级中，Space 导航到新建的 Space。受限目标保留禁用条目并给出权限
反馈。Node 重命名/移动与 Trash/restore 复用 Browser 产品工作流；文件身份与原生 Session 保持
稳定。

Space Share 管理真实的 Team 成员关系。File Share 区分 Team 继承、Personal 直接/祖先授权与
正式链接访问。Viewer/Editor（以及 Team Admin）是既有的 Server 角色；可选的创建邀请会立即
激活成员关系。Favorites 仍然不可用。Pinned Pages 依据 Workspace Node 元数据显示真实的
Page/Subpage 层级；悬停控件复用既有的文件动作与 Page 创建工作流。分组折叠与 Page 展开在
Chat / Space 切换之间保留在实时导航 store 中；置顶与展开偏好仍然是 session 局部的。
Trash/Restore、Rename 与同一 Space 内的文件夹移动可通过共享行、右键与文件身份菜单使用。
Space 支持 Create/Open/Rename；Space 的 Move/Trash/Restore 需要单独的生命周期扩展，尚未
实现。禁用控件会将功能可用性与 Server 权限分开说明。Suggested 只有本地置顶元数据卡片，
没有虚构的模板或推荐。
原生 DSH 输入框比 Space 的 52px 输入胶囊更高；它保持完整。

Markdown `.md` / `.markdown` Blob 以共享的只读 Markdown Viewer 的 Preview / Source 控件打开。
两种模式都使用完整的、已校验的 UTF-8 源码，包括原始行尾；打开不会把 Blob 转换成 Doc。文件
头复用 Workspace Browser 的 **Download** 动作处理 Blob。它使用 Server 的原始字节下载与原始
文件名（包括 UTF-8 BOM），而不是解码后的 Preview/Source 文本。每次点击都会重新检查当前
账户、Node/Resource 身份与 Server 下载权限；访问被撤销后，缓存的预览不授予下载权限。
共享分类器也支持 Markdown MIME 类型，以及历史上传为 `application/octet-stream` 但文件名是
Markdown 的文件。二进制、无效 UTF-8、部分读取和被拒绝的读取都会显式失败。Markdown 不在
Create / New 中。

Pages 加载完整的 HTML 源码，不受 Space 曾经的 1 MiB 截断限制；部分响应会被拒绝。可选的
HTML 源码缓存最多保留 16 个条目和 16 MiB 的 UTF-8 源码。这是缓存预算，不是打开限制。每次
打开仍会在使用任何缓存字节之前检查当前 Node/Resource ACL。正式 HTML 沙箱、脚本、Sheet
绑定与离开前保存/恢复协议保持不变。

Live Docs 焦点的作用域限定于当前活跃的 Space owner、文档关联与编辑器挂载代次。该挂载内的
选区更新是有序的，退出会阻止延迟更新恢复已关闭的编辑器。被捕获的消息目标与待处理的选区
建议各有独立生命周期；在同一文档中切换 Conversation 不会使待处理的建议失效。消费带有不同
目标的排队消息的步骤没有隐式焦点。

**官方 DSH 0.2.2-rc.1 上的已知限制：** 原生 Conversation 焦点仍然是在 inbox 插入之后从
Host 状态捕获，而不是在发送手势时捕获。因此，仍在传输中的选区更新可能使该消息快照中保留
一个更早的目标。代次顺序与原生发送阶段都不能关闭这个窗口。精确的原生发送绑定需要 DSH
提供受支持的按次快照/接纳 API；输入框阻塞与 pre-step 钩子都不提供它。这是一个已知的 POC
风险：普通对话可能作用于更早的文档或选区。使用 AI 编辑时请检查目标与结果。独立的
**Ask for change** 控件会在激活时捕获其 SDK 选区，并保留既有的目标、内容、权限与 revision
检查。其模型请求把选中文本与只读的上下文段落文本分开。模型返回绑定到该选区请求的完整本地
片段。宿主会在抽取替换内容之前验证完全未变的前缀与后缀；它绝不会搜索相似文本或修复响应。
遗留、不匹配、含糊、改变上下文或不完整的响应会失败，且不投射新的候选。最终仍由用户检查
提议的措辞。

Docs 选区工具需要与 SDK 公开的 `PARAGRAPH_ID_PREFIX` 兼容的唯一 ID。捕获会在 SDK 解析段落
偏移之前校验 ID。捕获错误会清除旧的选区目标、中止未完成的提议并显示诊断信息，同时原生编辑/
保存仍可用。之后的有效选区会恢复选区控件。该守卫不会生成或持久化缺失的 ID，不会修复源
文档，也不会说明其 ID 为何无效。选区替换中新插入的段落使用 SDK 公开的 `createParagraphId`
工厂；未改动的源段落身份由 SDK diff 保留。

Docs、Sheets、Slides、Canvas 与 Relational Table 现在使用共享的 Browser preset 源码，包括其
既有的协同与功能插件。Base 公式 Worker 被打包并通过 owner Connection 提供服务。

Workspace 读取工具为 `univer_spaces`、`univer_documents`、`univer_list`、`univer_open` 与
`univer_inspect`。目录发现使用原有的递归 Workspace 实现与过滤，默认使用原生请求被接纳时
捕获的 Space。原生 Session 可以在没有当前文件的情况下打开已授权的 Node、Resource 或 Unit；
检查使用其 Session 关联。Server 会重新检查访问权限。`univer_api` 复用原有版本匹配的 Facade
参考查找，无需文档访问权限。`univer_new` 与 `univer_create` 对全部五种 Univer Unit 类型复用
原有 Resource 创建路径。`univer_workspace` 使用既有 Workspace 操作进行 Space、Folder 与
Page 的创建、重命名、移动与恢复。被接纳的 Folder 是默认目标。`univer_compile_markdown` 使用
共享的 Client Core 编译器与物化器，在显式提供的草稿 Worktree 中创建可编辑的 Modern Doc。它
不发布也不合并。保存返回的 `sourceMap`；使用该 map 与选定的 `blockIds` 调用
`univer_export_markdown` 以读取当前原生内容、导出图片附属文件，并在块更新前刷新 map。所有
源码、资源与输出路径都留在原生 Session workspace 内。这些工具保持编译器的草稿合同；对既有
文件的普通编辑仍使用 trunk。检查读取当前 Server 内容，返回 revision/hash 与有界的文本/单元格/
结构化 Unit/HTML 源码行，并暴露 `nextOffset` 用于分页。发现/读取操作仍然是有界且 Session
局部的；草稿检查使用既有的 headless 检查 runtime。它们尚未提供完整的旧插件接口。普通
`univer_edit` 调用会选择与原生请求一同接纳的文档，或一个明确标识的已授权 Unit，并通过原有
协同 runtime 把 Facade mutation 提交到 trunk。明确创建的 Worktree 保留既有的 Docs/Sheets
草稿与 Review 工作流。Review 读取当前比较结果；Apply 使用既有 Workspace 合并工作流与当前
Server 权限。Reject/Cancel 丢弃草稿。预览与 Apply 之间没有版本绑定：并发编辑可能改变合并
结果或导致冲突。移除当前文档关联不会擦除持久消息，也不会撤销历史读取授权；变更身份或断开
连接可清除授权。

DSH Tools 是仅类型（type-only）的开发依赖。四个公开 JSON Schema 注册与此前 defineTool
构建器的输出完全一致。在 profile 中安装另一个 Tools 服务包可能使它的模块内 scheduler Symbol
与内置 Agent loop 分裂。包回归测试防止该运行时依赖重新出现。不修改 DSH 源码或已安装的 SDK。

Shell 图标使用 Lucide React 0.468.0；ISC/Feather 声明保留在 `THIRD_PARTY_NOTICES.txt` 中并
随包分发。

正式 HTML Viewer 是对 Fork 既有 `packages/workspace-html-viewer` 的构建期 `file:` 依赖；
`.npmrc` 用隔离的 consumer peers 物化其源码，而不是链接第二套 SDK/React 依赖图。浏览器 JSX
对该共享组件使用自动转换。所有耦合 SDK 保持在 1.4.0。桌面打包通过仅宿主的运行时配置携带
Fork 既有的开发 license。非空的 UNIVER_LICENSE 会覆盖它；普通的 Desktop 启动无需环境变量
设置。该 license 既有的范围与到期时间仍然适用；校验仍由 SDK 负责。请从本仓库运行构建/
安装，并保留那些源码目录。

在 macOS 上，原生宿主拖拽标记应用于已有的次要行/文件头行。Chat 保持顶部行空白（除侧边栏
控件外）；Space 保留其 Space 标题。不添加额外的 chrome 行、白色条或顶部留白。宿主把交互
控件排除在拖拽几何之外。

Shell 对表面、文字、次要标签、边框与选中/悬停状态使用宿主主题 token。普通提示中不会注入
文档正文。结构化 Unit 检查是由 Tool 返回的有界 JSON 数据，而不是完整编辑器或写入能力。
Schema/名称保持不变；inspect 描述现在在受检合同 fixture 中记录了这些新增的读取格式。

`src/content-types.ts` 中的分类法拥有每个 UI 名称与创建条目。

## 测试

`npm test` 只运行 `test/*.test.mjs` 中的单元测试。它们使用合成 fixture 与回环 HTTP 服务器，
不依赖真实外部 Server 或 Host。该命令不构建插件，也不启动浏览器。

`node test/live/auth/check-oauth-api-live.mjs` — 当前协议与真实 Server 回归（使用注册了精确
OAuth 回调的隔离本地 Server）：

```sh
SPACE_TEST_LOGIN_FILE=/path/to/private-fixture-login.json \
SPACE_EVIDENCE_DIR=/path/to/evidence/outside/source \
node test/live/auth/check-oauth-api-live.mjs
```

该协议检查覆盖 consent、code 交换、PKCE、回调、身份、八种创建类型与六条文件生命周期路径。
CRUD、协同、共享与人类协同 Web 脚本通过同一 OAuth 流程使用 `authorizeWorkspace`。原生 Desktop
检查需单独运行。

对于原始 Workspace Browser 的最小装配检查，用它自己的 Vite 配置针对同一 Server 提供服务，
设置 `SPACE_WORKSPACE_BROWSER_ORIGIN`，并运行
`node test/live/editor/check-editor-assembly-live.mjs`。它观察真实的协同 WebSocket 与当前
History 版本，不做任何编辑，并比较持久化的 Snapshot 哈希。这不代表已经验证 Comments 写入、
多人编辑或离线持久化。

额外的只读 UI 检查：在连接 Workspace 后，使用相同的宿主/浏览器/MVP fixture 变量运行
`node test/live/editor/check-readonly-live.mjs`。它验证 Base 创建控件被禁用，以及 Slides 的
插入被 SDK 权限守卫拒绝。源文档快照保持不变。

`node test/live/navigation/check-navigation-lifecycle-live.mjs` 还需要
`SPACE_PLUGIN_TARBALL=/absolute/path/to/exact-built-package.tgz`，并通过官方管理器移除再重新
安装该 bundle。请保留宿主的诊断信息。

使用 `SPACE_LIFECYCLE_REMOVE_ONLY=1` 配合生命周期脚本，可单独验证实际的卸载还原。这会刻意
让 bundle 保持未安装状态；之后请通过管理器重新安装同一个精确的 tarball。

`node test/live/editor/check-crud-live.mjs` 针对 Server 覆盖全部八种对象类型，包括恢复后的
内容/身份与未授权写入被拒绝。`node test/live/editor/check-html-live.mjs` 覆盖 Page 脚本、
Sheet 绑定读写、持久化后重开、检查，以及连接变更被拒后的恢复。

`node test/live/navigation/check-navigation-theme-live.mjs` 通过真实的原生 Settings 控件切换
主题并恢复先前偏好；它同时捕获 Chat 与 Space 的浅色/深色状态。

运行 `node test/live/collaboration/check-human-collaboration-live.mjs` 与
`node test/live/collaboration/check-sharing-live.mjs` 时需要两个独立配置的 DSH 宿主，每个都以
不同的 Workspace 测试用户认证。除宿主/浏览器/证据变量外，还要提供 `SPACE_SECOND_DSH_LOG` 与
`SPACE_SECOND_LOGIN_FILE`。这些脚本覆盖评论、身份、权限、授权与共享。请勿将凭据写入仓库或
生成的证据文件。

运行 `node test/browser/check-floating-menu-regression.mjs`，配合 `SPACE_PLAYWRIGHT_MODULE`、
可选的 `SPACE_BROWSER_EXECUTABLE` 与 `SPACE_EVIDENCE_DIR`，在隔离的浏览器 fixture 中演练真实
的 React 组件：角落、调整尺寸、祖先滚动、长菜单、主题切换、CSS 与可视视口缩放、点击外部与
键盘行为。该 fixture 不代表已经验证最初报告的场景或 Electron Desktop。既有的
`test/browser/check-create-menu-regression.mjs` 检查八条目创建工作流。

`node test/browser/check-navigation-menu-regression.mjs` 使用相同的浏览器/证据环境检查实际的
Navigation 嵌套滚动容器。放置仍使用 shell 边界；隐藏引用检测使用该引用的裁剪祖先。部分被裁剪
的触发器保留其菜单；完全被裁剪的触发器会关闭它。该检查还验证 190px shell 中多行 Create
标签没有固定高度文本溢出。

保留 live 脚本只记录一个手动场景，不代表通过结果。脚本存在这一点不说明它当前是否通过。

## DSH 声明依赖

精确的仅开发依赖 `dsh-client-ui-dockkit`、`dsh-util-file-drag` 与 `@shikijs/langs` 条目满足
已发布的 DSH 0.2.2-rc.1 类型声明中的导入。上游只把这些边列为开发依赖。它们不会被加入已
安装插件的生产运行时。在上游发布 DSH 元数据修复并完成一次干净 typecheck、确认这些导入可
通过所属包解析之后，移除这些 consumer 条目。

## SDK 与 lock 更新

在对齐此隔离应用的精确 SDK 依赖之后，用 npm 重新生成 `package-lock.json`，然后运行
`npm run lock:runtime`。后者从打包器所用的、经过审计的生产依赖闭包推导出
`runtime-lock.json`。在 `npm ci` 之前构建共享的 Runtime、Client Core 与 reference provider，
使被复制的本地构建依赖包含其当前产物。

## 插件自有菜单位置

Space 下拉菜单与内容列表右键菜单使用一个 body portal 与公开的 `@floating-ui/dom` 定位 API。
实际菜单尺寸决定所属 Space shell 与可视视口内的 flip/shift 与可滚动尺寸。该 portal 保留
作用域化的 shell 工具类与继承的主题 token；监听器只在菜单打开期间存在。原生 DSH、Univer
与正式 File Tree 菜单保持其既有实现。文件动作与 Server 能力检查仍位于共享的 `FileActions`
组件中。

## 编辑器语言

五个协同 Univer 编辑器与 AI Changes 预览遵循当前 DSH 界面语言（英文或简体中文）。切换语言
会就地更新 SDK locale；它们不会重建 Unit，也不会添加单独的偏好项。其他宿主语言使用其声明
的回退链，最终回退到英文。
