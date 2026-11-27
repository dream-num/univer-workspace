# Univer Workspace

[English](README.md) | 简体中文

Univer Workspace 是可独立部署的 React 应用，支持 Univer 文档协同、文件与文件夹层级管理、权限、回收站、最近访问和 Worktree。

## 开发

本地开发需要 Node.js 24 或更高版本及 pnpm 11。部分功能还需要 Univer 许可证。

```bash
pnpm install
pnpm workspace:dev:server
pnpm workspace:dev:web
```

`workspace:dev:server` 监听后端代码变更，在 `http://127.0.0.1:3020` 启动服务。如果 `dist/public` 已存在，此端口也会提供上次构建的静态网页。前端源码的修改要等到下次构建才会显示在这里。

`workspace:dev:web` 在 `http://127.0.0.1:5173` 启动 Vite，支持前端热更新，并将产品 API 和 WebSocket 请求代理到 3020 端口。开发前端时同时运行两个服务并打开 5173 端口。开发后端或查看已构建的网页时，只需运行 3020 端口的服务。

Vite 还将 `/mcp` 代理到 `WORKSPACE_DEV_MCP_PORT` 指定的本地 MCP 网关（默认 3000），使浏览器像在生产环境中一样同源访问网关。启动网关时设置 `MCP_PUBLIC_URL=http://127.0.0.1:5173/mcp`，以便浏览器请求的 `Host` 和 `Origin` 与 `MCP_PUBLIC_URL` 匹配。

在浏览器的账户菜单中打开**访问令牌**，即可管理个人访问令牌。本地 API 文档有两个入口。

- `http://127.0.0.1:3020/api-docs` 提供交互式文档。
- `http://127.0.0.1:3020/openapi.yaml` 提供 OpenAPI 定义。

### 配置

首次本地运行时，将 [`.env.example`](.env.example) 复制为同目录下的 `.env`。默认使用 SQLite、本地文件存储和密码登录，数据保存在 `.data/`。

#### 数据库

部署 PostgreSQL + S3 时，产品库和协同库一起使用 PostgreSQL，Sheet 单元格数据块、上传文件和内嵌附件保存在 S3。完整环境变量和示例见 [Workspace 配置指南](docs/configuration.zh-CN.md)。已有数据的实例请按[迁移步骤](docs/storage-migration.zh-CN.md)在一次停机窗口内切换。

### 协同与工作台

Sheet、Doc、Slide、Base 和 Board 的评论锚点保存在 Unit 快照与变更集中。评论正文、回复和解决状态由同一协同数据库中的 Comment 组件保存。主线（Trunk）、Worktree 和合并预览共享评论正文，只有锚点随 Unit 数据分支和合并。在 Worktree 删除评论也会删除主线上的同一条评论。详见 `docs/application-design.md` 的“评论与 Worktree”一节。

同一协同数据库还保存历史版本的分段索引。SDK 1.0.0 会根据 Core 记录的创建信息和变更集自动建立索引。如果尚无历史记录，读取时会计算分段并在后台保存。主线上的 Sheet、Doc、Slide、Base 和 Board 编辑器使用 SDK 的版本历史界面。只读用户可以查看版本，有内容编辑权限的用户还可以恢复版本。Worktree 和合并预览编辑器不展示主线的版本历史。

已登录的浏览器会保持一个 `/api/worktree-events` WebSocket 连接。AI 或 CLI 对 Worktree 的写入在协同及产品操作均完成后通知浏览器刷新缓存。活动和已处理任务列表、详情、侧栏计数及受 Worktree 影响的节点与资源列表会自动更新。连接使用一次性会话票据，通知不含 Worktree 元数据或正文。

已登录用户从未创建 Worktree 且没有可见任务时，智能工作台会显示 Workspace Agent 下载入口及 CLI、Skill 安装指南。已有可见团队任务的用户会在任务列表旁看到简短介绍。

审阅 Worktree 时默认打开 Agent 草稿，也可以切换到只读的并排对比视图。拥有草稿编辑权限的用户可以在浏览器修改草稿，更改会同步给同一 Worktree 中的 Agent。Worktree 进入就绪状态后，有重新打开权限的用户可以点击**继续编辑**，将其转回草稿状态。主线审阅、合并预览和对比视图均为只读。切换视图或提交审阅前，请等待编辑器同步完成。

服务端还原并解码主线和草稿的权威状态，用匹配的 History SDK 适配器计算语义差异，通过需要认证的内部接口 `/universer-api` 返回结果。浏览器为对比视图提供 Univer 预设和插件，也可继续使用正式版、Agent 草稿和合并预览的 iframe 视图。内部对比接口可通过 `baseMode=base` 将左侧固定为该 Unit 在 Worktree 中记录的基线版本，或通过 `baseMode=parent` 配合 `view=merged` 将左侧固定为这个 Unit 合入前一刻的主线版本。右侧可选 `view=draft`、`view=preview`（仅限就绪状态）或 `view=merged`（仅限已合并状态）。合并结果按 SDK 保存的合并修订号读取。缺少该修订号时，无法还原合并当时的固定版本。浏览器默认对比当前主线与草稿。Agent 使用这些模式审阅历史基线。在 Worktree 内新建的 Unit 基线为空，丢弃 Worktree 后仍可审阅。文件在回收站里或已删除的 Unit 在任何模式下都没有对比，接口返回 `409`。这包括已合并的 Worktree 删除的文件、Worktree 把它标为删除期间被人直接移入回收站的文件，以及被永久删除的文件。文件仍在空间里、读者却已打不开时（例如已被移出的成员查看自己提议的删除），接口返回 `403`。

在草稿 Worktree 中可以将单个 Unit 标记为删除，也可以撤销标记。就绪后删除标记被冻结，要修改需先重新打开 Worktree。合并时，已标记的 Unit 不参与内容发布，已有文档随后移入回收站。在同一 Worktree 内新建又取消的 Unit 不会发布。丢弃整个 Worktree 会保留已有文档。单个 Unit 的合并结果 `removed` 只表示其内容已排除。等到 Worktree 状态为 `merged` 且合并 Operation 已完成，才表示文档删除完成。如果本次操作结束后 Worktree 仍为就绪状态，需要再次合并。要找回合并时删除的文档，请从回收站恢复。

Univer 编辑器通过服务端 `@univerjs-pro/exchange-node` 导入和导出 XLSX/CSV/TSV、DOCX、PPTX 和 PDF。PDF 转换还需要可选的原生依赖 `@univerjs-pro/exchange-pdf-node-binding`。这些接口遵循 Universer Exchange 协议，位于 `/universer-api/exchange/**`，产品 OpenAPI 不收录这些接口。通过 Workspace 的文件操作导入 XLS/XLSX/CSV/TSV、DOC/DOCX、PPT/PPTX 或 PDF，会在所选空间和文件夹创建 Univer 文档。其他类型保存为可下载的 Blob 文件。从编辑器功能区导入时，目标默认为当前用户的个人空间根目录。上传的源文件、转换后的 JSON 快照和导出文件作为临时对象存入 BlobStore，有效期两小时，任务元数据仅保存在当前进程中。Worktree 和合并预览编辑器尚不支持各自范围内的 Office 转换，因此不显示导入导出操作。

导入 XLSX、DOCX 或 PPTX 时，图片和内嵌 Office 附件作为新 Unit 的主线 Asset 保存，Unit 中只保留 Asset ID。超过 20 MB 的文件仍以内联形式保存。可在附件工具栏将附件转为独立的在线文档，原附件仍保留在宿主文档上。服务端会核对用户能否打开宿主 Unit、附件是否属于该 Unit。如果用户有权在宿主文件夹创建文档，新文档就保存在该文件夹，否则保存在个人空间根目录。导出 XLSX、DOCX、PPTX 或 PDF 时，默认嵌入已转换附件的当前在线版本。服务端按导出用户的权限逐一读取，任一文档不可读都会导致导出失败。API 调用方也可传入 `options.oleAttachmentSource: "original"` 以嵌入原始附件。

导出 Office 文件前，服务端根据请求用户在主线上的权限读取托管的 Asset，包括母版页和序列化绘图资源中的图片。文件字节内嵌到导出副本中，已保存的快照和 Asset 保持原样。如果有图片缺失、无访问权限或内容无效，导出会失败。

Doc 和 Slide 可以在同一编辑器内读取引用的 Sheet。编辑器在加载来源前注册 Sheet 数据插件，用于还原资源、重放变更集和解析公式。引用 Sheet 时仍使用宿主编辑器和原有工具栏，Workspace 引用提供方负责检查来源访问权限并选择主线或 Worktree。实时数据源在相同范围内复用 SDK 的协同连接。公式依赖失效、计算顺序和结果应用均由 SDK 管理。

### 仓库首页

在应用设置中选择 **Repository**，可启用 OfficeLab 的 GitHub 风格首页。`/home` 展示最近打开的文件、进行中的 Pull requests 和未关闭的 Issues。可从首页进入以下视图。

- `/repositories` 列出所有可访问的仓库。可按名称、描述或所有者搜索，按个人或团队仓库及可见性筛选，按名称排序，也可以创建仓库。
- `/worktrees` 分页展示进行中或已处理的 Pull requests，支持服务端搜索及按仓库、类型筛选。打开审阅页时，列表的筛选条件保留在 URL 中。
- `/issues` 展示跨仓库的 Issue 列表和筛选项。
- `/recent` 分页展示最近打开的资源。

最近访问的文本搜索仅在已加载的结果中查找，界面上会标明搜索范围。首页各摘要独立查询有限条目，从长列表返回时无需重新加载所有已缓存的分页。浏览目录只读取元数据，打开文件或预览才会计入访问记录。只有 Worktree 摘要权限的用户看不到审阅链接。

可从仓库内的 **Pages** 标签或 Wiki 文件树打开 HTML 页面。Repository 导航在窄屏上使用抽屉菜单，并支持两种界面语言和配色主题。

### Markdown 文件

上传的 `.md` 和 `.markdown` 文件会打开只读的 CommonMark/GFM 预览。可以切换预览与源码，也可以下载原文件。预览支持表格、任务列表、删除线和脚注。两种视图均完整读取 UTF-8 文本，不截断预览。原始 HTML 按文本显示，相对文件和图片路径不会解析，外部图片只在点击后加载。Markdown 文件以 Blob 保存，无法像 Univer Doc 一样协同编辑。Agent 的远程文件查看器使用相同的渲染器。

### CLI 登录与 Agent 访问

**CLI 登录。** 默认由用户在浏览器批准登录。`uvw auth login` 创建有效期十分钟的一次性授权请求，输出 `/cli-login` 地址和验证码，将待完成的请求保存到本地后退出。用户可以先用邮箱验证码、GitHub、Google、Discord 或密码登录，再回到授权页核对并批准验证码。随后由 Agent 运行 `uvw auth login --complete` 兑换一次。两条命令都不会等待或轮询。CLI 获得独立的 `workspace_session`，用户的浏览器 Cookie、Workspace 密码和第三方访问令牌都不会交给 CLI。待批准的请求以两个码的哈希存在产品数据库里，任意服务副本都能批准和兑换，服务器重启不会清除它；已建立的 CLI 会话会持久保存。

**代表人的操作。** 创建个人访问令牌或浏览器 Agents 令牌、批准 CLI 登录、OAuth 连接页和同意页、认领和管理 Agent、关联登录方式、修改密码，以及发布或拒绝 HTML View 和 Skill 草稿，都要求人在浏览器里登录 Workspace。Agent、CLI 登录（包括 Workspace Agent 和 Space 插件的会话）以及为令牌签发的会话都返回 `403 INTERACTIVE_SESSION_REQUIRED`。

浏览器 Agents 模块可凭人在浏览器里登录的 `workspace_session` Cookie 调用 `POST /api/auth/agent-token`。请求可用 `{ "scopes": ["read"] }`、`{ "scopes": ["read", "write"] }` 或 `{ "scopes": ["read", "publish"] }`，权限顺序不限，不可重复。成功返回 `201`、`{ token, expiresAt, scopes, resource }` 以及 `Cache-Control: no-store`。有效期一小时的 `uvw_at_` 令牌属于第一方 `univer-workspace-agents` 客户端，绑定到 `PUBLIC_ORIGIN` 下的 `/mcp`，该地址必须列入 `MCP_RESOURCE_URLS`。缺少 MCP OAuth 配置或同源资源时返回 `503`，没有 Cookie 返回 `401`，其他会话返回 `403`，申请了无效权限返回 `400`。

Ask 模式的常规调用使用 `[read]`，Auto 模式使用 `[read, write]`。Auto 模式发布前会暂停，等待用户明确批准。每次获批的调用使用单独的 `[read, publish]` 令牌和 MCP 客户端，调用后释放客户端。全屏草稿预览仅在本地试算，不能编辑源 Sheet 或打开原生编辑器。新用户消息会拒绝待批请求，让 Agent 可以继续修改草稿。此接口不会授予 `worktree:merge`、返回刷新令牌或向账户列表添加个人访问令牌。网关仍通过令牌兑换获取会话。

**访客 Agent。** `POST /api/agents` 和 `POST /api/auth/guest` 都支持免凭据创建 `agent` 类型的用户。Agent 有独立的个人空间，初始有效期为 30 天。`POST /api/agents` 接受可选的 `{ "label" }`，以 `201` 返回 `{ agent: { id, username }, token, mcpUrl, expiresAt }`。`token` 为包含所有 MCP 权限的个人访问令牌，`mcpUrl` 为 `MCP_RESOURCE_URLS` 中的第一个地址，未配置时为 `null`。`POST /api/auth/guest` 会设置 `workspace_session` Cookie 并返回 `{ agent }`，供 `uvw auth guest` 使用：这个会话和 CLI 登录一样是 `agent` 来源，使用期间自动续期，不能代表人。请求已携带有效会话时返回 `409`，避免覆盖当前登录。

`GET /api/auth/authorize` 对 DCR 和 CIMD 客户端返回连接页，页面有两种状态。会话的 User 是 Agent 时按没有会话处理，页面也不动它的 Cookie，所以 Agent 的 Cookie 不会让客户端以这个 Agent 的身份连接。没有人登录时，页面提供 **Sign in to connect**（登录后回到同一个地址）、指向客户端回调并带 `access_denied` 的 **Deny** 链接，以及开启访客 Agent 时的 **Try without signing in**。这个按钮是一个表单，把授权请求的查询字符串作为 `oauthAuthorization` 提交给 `POST /api/auth/authorize/guest`。该接口以 `303` 跳回客户端回调，带上新访客 Agent 的授权码，或授权页本会发给客户端的 OAuth 错误。它不读取会话，也不设置 Cookie，浏览器保持未登录。请求包含 `write` 时，授权码带 `read write publish worktree:merge`，否则只带 `read`。不能交给客户端的错误显示为一个 HTML 页面，写明错误码并链接回连接页。Workspace Agent 等静态 OAuth 客户端需要人登录，返回 `400`，未知客户端和未登记的 `redirect_uri` 同样返回 `400`（客户端元数据文档暂时无法获取时返回 `503`）。已达创建上限的来源看到的按钮不可点，并写明原因，仍然提交时在获取任何内容之前返回 `429`。客户端兑换授权码之前不会创建任何 Agent。CIMD 客户端的元数据文档在显示页面之前获取，没有人登录且开启了访客 Agent 时匿名获取。服务端同时最多运行 32 个元数据获取，匿名获取最多发起其中 8 个，每个来源同时只有一个，登录用户的授权始终保留其余 24 个。每个来源每小时最多发起 10 次匿名获取，失败或超时的也计入；命中缓存或加入已在进行的获取不计次数。匿名获取被拒绝时浏览器转到登录页；关闭访客 Agent 时，未登录的 CIMD 请求也转到登录页，不获取任何内容。试用表单提交时在同样的限制下再解析一次客户端：用完每小时次数的来源返回 `429`；匿名获取全部占用，或该来源已有另一个获取在进行时，返回带 `Retry-After` 的 `503 CLIENT_METADATA_BUSY`，不获取任何内容。该客户端在动态注册记录或客户端元数据文档中给出名称时（Claude Code 属于后者），服务端以该名称为访客命名，例如 `Claude Code · 7f3k`，同一客户端的多个 Agent 仍可区分。名称遵循显示名规则：不含邮箱地址，不含控制、不可见或改变书写方向的字符，最多 40 个字符。客户端没有名称时，访客名为 `agent`。

未认领的 Agent 每次认证或有人访问其 `/nodes/:nodeId` 页面时，到期时间会延至 30 天后，每天最多续期一次。Agent 到期或被封禁后，其个人空间和团队空间仅自己和认领人可读，其他人打开其链接会收到“未找到”。无论上次活跃距今多久，到期 Agent 再次认证即可恢复。被封禁的 Agent 认证时返回 `401`，兑换令牌返回 `invalid_grant`。运行 `pnpm db:ban-agent <username or user id>` 可封禁 Agent，生产构建使用 `db:ban-agent:production`。该命令只接受 Agent，重复执行不会再次变更状态。参数既是一个用户的 ID、又是另一个用户的用户名，或同时是两个仅大小写不同的用户 ID 时（两者都忽略大小写比较），命令按匹配的标识列出每个用户并拒绝执行，换用另一个标识即可。既有协同连接保持到会话结束。MCP 网关最多缓存令牌兑换结果 30 秒，此期间，`whoami` 等不访问 Workspace 的工具可能仍会响应已封禁的令牌。

共享 MCP 执行层在同一个容器里为所有用户运行脚本，因此由运维决定谁能使用。运行 `pnpm db:executor-access grant <username or user id>` 授权，`revoke` 撤销，`list` 列出已授权的用户，没有时提示无人获得授权；生产构建使用 `db:executor-access:production`，运行时镜像内执行 `node dist/server/db/executor-access.js`。重复授权或撤销不会再次变更状态，参数同时指向两个用户时与 `db:ban-agent` 一样拒绝执行。没有任何 HTTP 接口能修改授权，用户和 Agent 都不能给自己授权。已授权用户的 `GET /api/session` 返回 `executorAccess: true`，令牌兑换返回 `executor_access: true`，未授权时不返回该字段。MCP 设置 `MCP_EXECUTOR_ALLOWED_USER_IDS=workspace` 后，网关和执行层约 30 秒后跟随授权变化，无需重启。MCP 从 `*` 或用户 ID 列表切换到 `workspace` 之前，先授权当前使用执行层的用户，`workspace` 不放行其他人。

以下限制适用于所有角色，违规返回 `403`。Agent 可以创建团队空间，并成为它的所有者。未认领的 Agent 不能成为团队空间成员。已认领的 Agent 在人持有的团队空间里可以是查看者或编辑者，在 Agent 持有的团队空间里还可以是管理员（`AGENT_NOT_ALLOWED`）。未认领的 Agent 最多持有 3 个团队空间，在它的全部空间里最多保留 20 个文件（含未完成 Pull request 中的新建文件），单个文件最多 10 MiB（`AGENT_QUOTA_EXCEEDED`），通过链接分享最多获得查看者（Viewer）权限。用户搜索结果不含未认领或已停用的 Agent，未认领 Agent 发起搜索会收到 `AGENT_NOT_ALLOWED`。不是团队空间成员的提议者在一个团队空间里最多同时有 3 个未处理的 Team Worktree（`FORBIDDEN`）。每个 Agent，无论是否认领，最多同时有 10 个未结束的 Pull request，任意 24 小时内最多发起 50 次合入（`AGENT_QUOTA_EXCEEDED`），`GET /api/session` 的 `budget` 显示用量。真人用户没有这项预算。

只有人在浏览器里登录 Workspace 时，才能让更多人看到数据。这类修改有四种：公开空间，添加团队空间成员或提高成员角色，把文件分享给某个用户或提高其角色，打开 Link Sharing 或把它提高到编辑者。服务端先检查 capability，没有 `manageMembers` 或 `share` 的调用者照旧收到 `FORBIDDEN`。其他会话发起这类修改时，服务端什么都不改，返回 `403 INTERACTIVE_SESSION_REQUIRED`，`error.url` 是确认页的路径：`/confirm/public?space=`、`/confirm/member?space=&user=&role=`、`/confirm/grant?node=&user=&role=` 或 `/confirm/link-sharing?node=&role=`。其他会话指 Agent、CLI 登录（包括 Workspace Agent 和 Space 插件的会话）以及为令牌签发的会话。创建时就公开的空间返回同样的 code，但没有 `url`，因为还没有可确认的空间。服务端在写入所在的事务里把请求和已存状态做比较，所以保持或收窄已存权限的写入对任何会话都放行：把空间设为私有，移除成员或授权，降低角色，关闭链接，或重复已有的角色。未认领的 Agent 没有可以替它确认的人，收到 `AGENT_NOT_ALLOWED`，消息让它把认领链接交给用户。它仍然可以给自己 Personal Space 里的文件打开查看者链接。

确认页用这个人自己的会话读取空间、文件和用户的名字，不显示链接里的任何文字。页面说明后果，显示当前权限和修改后的权限，只有“确认”和“放弃”两个按钮。确认调用的是被拒会话调用的同一个接口，所以这个人需要同样的 capability。未登录或以 Agent 身份登录的浏览器会先被要求以人的身份登录。

可免凭据调用 `POST /api/nodes/:nodeId/reports` 举报调用方可读的节点。请求体为 `{ "reason" }`，最多 1,000 个字符，成功返回 `201` 和 `{ id }`。每个来源 IP 每小时最多举报十次，超出返回 `429` 和 `REPORT_RATE_LIMITED`。日志仅记录节点及举报 ID。

## Docker

本机试用可以使用内置开发许可证。在自己的域名上部署时，先取得覆盖该域名的许可证，方案和购买入口见 [Univer 定价页](https://univer.ai/pricing/)。

使用自己的许可证时，先在终端中设置环境变量 `VITE_UNIVER_LICENSE`，值为 `license.txt` 的文件内容。在仓库根目录执行以下命令，通过 `--build-arg` 将许可证传给前端构建。

```bash
docker build \
  --build-arg VITE_UNIVER_LICENSE="$VITE_UNIVER_LICENSE" \
  -f apps/workspace/Dockerfile \
  -t univer-workspace .
```

本地通过 HTTP 运行容器并挂载持久化数据卷。

```bash
docker run --name univer-workspace \
  -p 127.0.0.1:3020:3020 \
  -v univer-workspace-data:/app/univer-workspace/.data \
  -e SECURE_COOKIES=false \
  univer-workspace
```

通过 HTTPS 部署时，移除示例中的 `-e SECURE_COOKIES=false`，保留镜像的安全 Cookie 默认值。运行时配置可通过 `--env-file ./workspace.env` 传入容器。

使用自己的许可证启动服务端时，在 `workspace.env` 中设置以下两个环境变量，并用对应文件的内容替换占位符。

```dotenv
UNIVER_LICENSE=<license.txt 的内容>
UNIVER_LICENSE_KEY=<licenseKey.txt 的内容>
```

### SQLite 升级与恢复

停旧实例、备份和回退步骤见[SQLite 升级与恢复](docs/storage-migration.zh-CN.md#sqlite-升级与恢复)。

将 `univer-workspace-cli` 升级到按 `owner/slug` 寻址仓库的版本前，先部署新版 Workspace 服务端。

### Space 列表与侧栏置顶

`GET /api/spaces` 仅返回当前用户拥有或已加入的 Space。每条 Space 响应以 `affiliation` 表示关系，取值为 `owner`、`member` 或 `none`，此列表只含前两种。`GET /api/spaces/starred` 返回当前仍可访问的已收藏 Space，最近收藏的排在最前。`GET /api/spaces/explore` 按收藏数、名称、ID 排列其他公开 Space，当前不分页。公开 URL、详情和查找接口的访问方式不变。

`GET /api/spaces/pins` 按保存的顺序返回 `{ customized, limit, spaces }`。可置顶自己拥有或已加入的 Space，以及已收藏的公开 Space。如果保存的置顶项都已失效，返回自己拥有或已加入的前八个 Space，并标记 `customized: false`。`PUT /api/spaces/pins` 接收 `{ spaceIds }`，用 1 至 12 个不重复且符合条件的 ID 原子替换列表。`DELETE` 恢复默认列表。两种写入均幂等，所有列表和置顶接口均需登录。

### 仓库收藏

同一 Space 下的仓库页面共用 GitHub 风格的导航和 Star / Unstar 收藏按钮。收藏绑定当前登录用户和 Space，刷新或重启后仍保留，访问权限独立控制。`GET`、`PUT` 和 `DELETE /api/spaces/{spaceId}/star` 均要求已登录且当前可访问相应 Space，并返回 `{ starred, starCount }`。写入幂等。面包屑导航从 `SpaceView.owner` 获取所有者 ID 和用户名。当前没有 Watch、Fork 或 GitHub 专有页签。[对照与验证记录](docs/proposals/repository-framework-star.md)

仓库的 Pull requests 使用现有 Worktree 流程。列表支持 Open/Closed 筛选和本地文本搜索。详情的 Overview 展示摘要与评审操作，Files changed 用于选择文档、查看草稿和对比改动。Pull request 可以关联同一仓库的一个 Issue：详情页头部显示这个 Issue，Issue 页列出关联到它的 Pull requests。Wiki 和全局工作台沿用原有仪表盘，此流程不引入 GitHub PR 模型、评论、分支或检查。[参考、功能映射与验证](docs/proposals/repository-pull-requests-tab.md)

仓库 Settings 使用分组侧栏，名称和描述可分别保存。在 Danger Zone 更改公开读取权限需确认。团队仓库公开读取时，还可选择协作者之外谁能提交 Pull request。协作者管理和回收站沿用既有权限和 API。[对照、差异与验证](docs/proposals/repository-settings-tab.md)

仓库 Pages 提供页面目录、复制和访问操作，默认页保存在当前浏览器。外观参考已发布的 Jekyll Primer 主题，仓库页头和页签顺序保持一致。[参考、差异与验证](docs/proposals/repository-pages-tab.md)

手动运行 `Deploy Workspace` 工作流时可选择已有稳定标签 `vX.Y.Z`。选择标签就签出该版本并以其标记容器镜像。留空则构建发起工作流的提交，并以 `sha-<commit>` 标记镜像。工作流将镜像交给所选环境部署。推送标签不会自动部署 Workspace，CLI 单独发布。

### 启动诊断

启动过程向标准输出同步写入逐行 JSON。每条记录包含 `event: "workspace.startup"`、`startupId`、`stage`、`status`（`started`、`completed` 或 `failed`）。诊断仅在阶段边界记录，沿用应用和 HTTP 日志的 Pino 配置及 `LOG_LEVEL`。开始和完成使用 `info`，失败使用 `error`。设为 `LOG_LEVEL=error` 时只显示失败，设为 `silent` 时关闭诊断。启动日志使用独立的同步输出，在阻塞操作或进程突然退出前按顺序写入。普通应用和 HTTP 日志异步输出，可能穿插其间。

每条记录还包括阶段耗时 `elapsedMs`、进程运行时间 `uptimeMs`、`memory`（Node 内存使用量，包括 `rss`、`heapUsed`、`heapTotal`、`external`、`arrayBuffers`）和 V8 `heapSizeLimit`。内存数值以字节计。记录不含配置值、文档内容或凭据。

诊断覆盖模块加载、配置读取、产品及协同数据库准备、应用创建和初始化、后台任务、WebSocket 设置及 HTTP 监听。迁移子阶段包括备份、读取创建信息、升级 Core/Worktree/History、校验和发布暂存副本。在 Grafana Loki 中查询 `{container="colla-workspace"} | json | event="workspace.startup"` 并选择相应 Pod。遇到 OOM 时，在同一 `startupId` 下查找最后一个只有 `started`、没有对应 `completed` 或 `failed` 的阶段。致命 OOM 可能来不及写入失败记录。内存数值是阶段边界的采样，无法反映峰值。SDK 执行阻塞工作时没有定时进度日志。

### 指标与传播回路事件

设置 `METRICS_TOKEN` 后，`GET /metrics` 凭 `Authorization: Bearer <token>` 输出 Prometheus 指标，未设置时返回 `404`。抓取方式和仪表盘见 [observability/README.md](../../observability/README.md)。

`workspace_exposure_refusals_total` 统计因为会话不是浏览器里的人而被拒绝的扩大可见范围的写入，标签是 `change`、`code` 和 `principal_category`。

除 `http_request_duration_seconds` 外，四个计数器度量传播回路：`workspace_link_sharing_changes_total`（Link Sharing 打开或关闭）、`workspace_share_page_views_total`（服务端渲染的分享页 `GET` 加载，含 `304` 再验证，不含 `HEAD`）、`workspace_signups_total`（注册，按方式和来源）、`workspace_guest_agents_created_total`（访客 agent，按入口）。标签保持低基数。每次计数另写一行 `event` 为 `workspace.*` 的 `info` 日志，Node ID、用户 ID 和 User-Agent 只出现在日志里。标签取值和日志字段见英文版 README。

已知局限：密码和邮箱注册从 `/login` 页或认领页同源请求的 `Referer` 读取 `source`，客户端或代理去掉 `Referer` 时记为 `direct`。注册后的页面重载和文件所有者自己打开分享页都计为 `signed_in`。`off` 事件的 `role` 是设置中保存的角色，没有实际含义。计数不阻塞页面返回，计数失败时页面照常返回，这次打开不计入，服务端记一条警告日志。

## 常用命令

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm db:ban-agent <username or user id>
pnpm db:executor-access grant|revoke <username or user id>
pnpm db:executor-access list
```

设计说明见[技术架构](docs/architecture.md)、[数据模型](docs/data-model.md)和[应用设计](docs/application-design.md)。

### 查询 Worktree

`GET /api/worktrees` 按游标分页返回摘要（`items`、`nextCursor`），默认按产品更新时间显示进行中的 Worktree。
`scope=processed` 查询已处理的 Worktree，`scope=all` 同时查询两者。`kind=user` 限定当前用户的个人 Worktree，
`kind=team&teamSpaceId=<id>` 限定一个团队空间。省略归属筛选条件时，返回用户在各空间有权访问的 Worktree。

`limit` 可取 1–200，默认 50。`order=createdAtDesc` 按创建时间倒序排列。
`search` 最长 200 个字符，按字面子串匹配名称、摘要、创建者或团队空间名称。ASCII 字母忽略大小写，其他字符精确匹配。
权限和搜索筛选都在分页前执行。翻页时保持筛选和排序不变，将上一页的 `nextCursor` 作为 `cursor`，直到返回 null。
每页都反映查询时的数据，Worktree 状态变化后应从第一页刷新。`unitCount` 统计所有关联 Unit，包含未修改的文档。
需要 Unit 明细时再请求 `/api/worktrees/<id>`。

### 替换文件内容

替换 Blob 文件内容会保留资源 ID 和所在位置。提交时需提供下载时取得的 ETag。替换立即生效，无需经过 Worktree 审查。前置条件和重试规则见 [HTTP 接口说明](contracts/http/concepts.md#resource-creation-and-opening)。

## 沉浸视图

所有资源页面都支持 `?view=immersive`。点击“进入沉浸视图”可隐藏 Workspace 顶栏和侧栏。按住 Ctrl / Command 点击、使用中键或右键菜单时，行为与普通浏览器链接一致。使用浏览器后退可返回上一页，直接打开分享链接时则取决于已有的浏览历史。已登录用户在 Repository 布局的沉浸视图顶部看到一条细栏，栏内只有回到首页的链接。

分享链接、刷新和登录跳转都会保留视图参数。分享弹窗提供“沉浸视图”复选框。如果 Blob 文件的 `node.name` 以 `.univer.html` 结尾，默认勾选，其他资源默认不勾选。这个选项只影响展示方式。资源权限和编辑工具保持原样，浏览器也不会进入原生全屏。

HTML 页面只显示错误提示，省略单独的加载、保存和同步状态。同一资源切换视图会保留当前编辑器；离开该资源时才执行原有的保存流程。

可以用内存示例数据预览实际资源页面，无需启动后端。

```bash
pnpm --filter @univerjs/univer-workspace exec vite --config test/vite.immersive.config.ts
```

打开 `http://127.0.0.1:5183/nodes/html` 或 `http://127.0.0.1:5183/nodes/text`。

## 匿名访问

节点开启链接分享，或所在空间开启公开读取后，持有节点链接的人即可查看内容。文件夹分享涵盖现有和将来的子项；公开空间可通过 URL 浏览。即使链接允许登录用户编辑，匿名访客和未被认领的 Agent 通过链接也只有查看权限，无法修改源内容、评论、上传、管理权限或访问 Worktree。HTML 文件与其绑定的来源 Sheet 分别鉴权。

未登录访客在每个文件和文件夹页面的顶栏下方看到一条栏；在沉浸视图中，这条栏取代顶栏。栏中写明作者，即文件所在 Personal Space 的所有者，并把无人认领的 Agent 标为“未验证的 Agent”。文件被复制过后，这条栏显示副本数；所有者在“分享”对话框的链接访问状态旁看到同一个数字。“使用 Univer Workspace 制作”链接到 GitHub 仓库，较宽的屏幕上还显示 `space.univer.ai`。“举报”打开一个对话框，把原因发送到 `POST /api/nodes/{nodeId}/reports`。“交给我的 Agent”打开一个对话框，提供一段交给读者自己 Agent 的简短英文提示词，有两种方式。默认选中的“MCP（推荐）”给出要添加到 Agent 的本实例 MCP 地址，提示词让 Agent 用 `read` 或 `inspect` 读取文件，服务器隐藏这两个工具时，提示词让 Agent 如实告诉读者，并像下文的“Remix”一样为读者复制一份可在浏览器中编辑的副本，复制不成再指向命令行。“命令行（uvw）”给出读取文件的 `uvw` 访客命令。沉浸视图中的这条栏还提供注册、登录和复制链接，并且可以收起。已登录用户打开别人 Personal Space 里的文件时，在 Workspace 顶栏下方看到同一条栏，但不含注册、登录和复制链接。所有者和团队空间成员只看到 Workspace 顶栏。

栏中的“Remix”把文件复制到已登录读者的个人空间并打开副本。页面会连同它绑定的 Sheet 一起复制，页面副本改为绑定这些 Sheet 的副本；读者无法打开其中任一 Sheet 时，什么都不会复制。未登录访客有两种方式得到副本：注册，回来后自动复制；或者把一段简短的英文提示词交给自己的 Agent，方式与“交给我的 Agent”相同。通过 MCP 时，Agent 用带 `from` 的 `unit_create` 把文件复制进一个 PR，不需要 `read`；通过 `uvw` 时用 `uvw unit create --from`。两种方式都会合并这个 PR，再给访客一个认领链接，认领后副本归访客所有；通过 MCP 时还会给出副本的链接。两种提示词都让 Agent 告诉访客先打开认领链接：认领后副本归访客所有，可以编辑；认领之前，只有 Agent 分享了副本，它的链接才能打开。Agent 无法复制页面，因此对页面只提供注册。注册前请求的复制在当前标签页中保留 15 分钟，且只有发起它的那次注册返回才会执行。

匿名访客和已登录的只读用户可以在 Workspace 浏览器内试算绑定了 Sheet 的 HTML 页面。首次编辑某个来源时，该来源断开协同连接，公式在访客浏览器中重新计算。试算结果只在本地生效，所有者后续的修改也暂时不会同步到这里。刷新后恢复实时数据。宿主会在首次编辑时显示试算提示，页面可通过 `window.univerWorkspace.getWriteMode(unitId)` 判断能否将修改标记为已保存。在 `/nodes/<nodeId>` 上，试算提示提供“保存我的版本”：它像“Remix”一样复制页面及其绑定的 Sheet 并打开副本，未登录访客需先注册。试算改动不会带进副本。原生 Office 预览对这些用户始终只读。Workspace Agent 等其他宿主需显式启用 HTML 试算，否则会拒绝写入。

生产部署中，允许匿名访问的 `/nodes/<nodeId>` 链接（含 `?view=immersive`）在聊天预览里会显示页面标题和简短描述。HTML 视图的标题省略 `.univer.html` 后缀。描述按 `Accept-Language` 返回中文或英文，缓存按该请求头区分，沿用应用页面的重新验证策略。配置 `PUBLIC_ORIGIN` 后才会生成绝对地址 `og:url`，并按节点类型（Sheet、Doc、Slide、HTML 视图、文件夹或其他文件）附上一张 1200x630 的预览图，卡片为大图样式。未配置时两者都省略，因为 Open Graph 要求图片使用绝对地址，而请求的 Host 不可信。私有、已删除或不存在的节点显示通用应用页面。预览图是 `web/public/link-preview` 下的静态文件，可用 `node scripts/render-link-preview-images.mjs` 重新生成，需要 Google Chrome 和 ImageMagick。Vite 开发服务器不生成此类预览。

升级后，原有分享设置继续生效。匿名访问不会创建账号、登录会话或最近访问记录，也无需变更 schema 或迁移数据库。
访问未认领 Agent 拥有的文件页面会延后该 Agent 的过期时间，每天最多更新一次。被封禁或已过期的 Agent 所分享的链接返回“未找到”。

公开链接沿用节点 URL 和沉浸视图参数。每次读取和加入 Unit 都会检查当前权限。更改链接分享设置会让现有实时连接失效；更改空间公开读取设置、移动或删除节点时，已有订阅可能持续接收更新，直至连接断开。重新连接时会再次鉴权。

## 在 HTML 页面内预览 Office 文档

浏览器中的 `.univer.html` 页面可调用 `window.univerWorkspace.showUnit(unitId, slot)`，在指定位置打开实时 Sheet、Doc 或 Slides，同时保留 HTML 单元格绑定。每个文件都单独检查编辑权限，分享 HTML 不会自动分享源文件。`hideUnit()` 关闭预览，宿主的“打开文件”操作会进入标准编辑器。支持定位到指定段落、单元格或幻灯片。[页面 API 与限制](../../docs/design/html-views/native-preview.md)

### Unit 内容编辑保护

Sheet、Doc、Slide、Board 和 Base 使用 SDK 的保护设置界面，服务端检查每次修改。编辑者可创建保护规则，规则创建者及当前 Owner/Admin 可管理规则。Worktree 继承当前 Trunk 的规则，无法更改保护绑定或协作者。快照、历史和导出内容沿用原有文件的读取权限。[验证与发布要求](docs/content-permissions-validation.md)

HTML View 草稿通过 `/api/html-view-drafts` 提交，仅作者可见，内容上限为 512 KiB。接收中的草稿一小时后过期，待发布草稿七天后过期。发布和拒绝都需要作者的交互式会话。V18→V19 新增草稿表及索引。升级时先停掉所有旧实例，只启动一个新实例完成迁移，验证后再恢复服务。回退时停止新实例并恢复配套备份。新旧版本不得同时写入同一 SQLite 文件。

### Skill 草稿与产品数据库 V20

通过 `POST /api/skill-drafts` 可从文本 `files` 或已固定版本的 `from` 来源创建仅作者可见的 Agent Skill 草稿。
Agent 可以创建和读取草稿，发布或拒绝则需要作者的交互式会话。响应中的 `previewPath` 指向浏览器审查页
`/drafts/skills/<id>`。作者可通过私有内容接口读取文件及其当前版本。[HTTP 接口说明](contracts/http/paths/skill-drafts.yaml)

`POST /api/skill-sources/read` 支持 GitHub 仓库、tree 和 blob URL，skills.sh 链接和 `npx skills add` 命令，ClawHub 所有者链接和 `clawhub install` 命令，以及可读空间中 ZIP 文件或文件夹的节点 ID。接口返回固定版本的来源和候选路径。传入该来源与候选 `skill` 路径，可检查文件元数据、`SKILL.md` 和静态检查结果；添加 `path` 可分页读取文本文件。位于根目录的 Skill 使用 `.`。后续读取和导入草稿均复用已解析的来源对象。Git 来源固定到提交，ClawHub 固定到所有者、slug 和版本，空间来源固定到节点 ETag。空间来源已变更时返回 409。

`from: { source, skill, overrides? }` 复制文本及二进制文件。每条覆盖包含 `path` 和 `text`，将 `text` 设为 `null` 即删除该路径。`files` 与 `from` 互斥。导入会将来源信息以字符串写入 `SKILL.md` frontmatter 的 `metadata`，并在草稿视图中返回解析后的 `source`。若上游 frontmatter 无效，需提供与草稿名称匹配的有效 `SKILL.md` 覆盖。

每个 Skill 最多 100 个文件，总计 20 MiB。`SKILL.md` 上限为 64 KiB，单个二进制文件上限为 10 MiB，文本读取上限为 256 KiB。压缩包最多 1,000 个条目，单条上限 20 MiB、总计 100 MiB，单条解压比不超过 100:1。解压前会拒绝不安全路径、符号链接、加密、分卷和 ZIP64 压缩包。请求在 15 秒后超时，最多跟随五次重定向，目标限于 `api.github.com`、`raw.githubusercontent.com` 和 `clawhub.ai`。

发布时，服务端重新扫描已存储的文件并核对要替换的完整基线，在一个产品库事务中将所有文件发布到 `.agents/skills/<name>/`。移除的文件进入回收站，任一写入失败时整体回滚。发布无需创建 Operation 或另行恢复。接收中的草稿一小时后过期，待发布草稿七天后过期。草稿被拒绝、过期或冲突时，其文件对象会进入 Blob 维护任务的删除队列。

V19→V20 新增 `skill_drafts` 表和过期索引。升级时停止全部旧实例，启动一个 V20 实例，待一致性备份、迁移和健康检查通过后再恢复服务。已有产品数据、对象键和未完成的恢复状态均会保留。迁移失败会回滚，成功后重启不会重复迁移或备份。若需回退，停止 V20 并恢复 V19 备份。V19 和 V20 不得同时写入同一 SQLite 文件。

### Agent 身份与产品数据库 V21

V20→V21 新增 `users.kind`（取值为 `human` 或 `agent`，已有用户视为 `human`），并新增 `agents` 和 `node_reports` 表。
停止全部旧实例，启动一个 V21 实例，待一致性备份、迁移和健康检查通过后再恢复服务。已有产品数据、对象键和未完成的恢复状态均会保留。
迁移失败会回滚，成功后重启不会重复迁移或备份。如需回退，停止 V21 并恢复 V20 备份。V20 和 V21 不得同时写入同一 SQLite 文件。

### 显示名与产品数据库 V22

V21→V22 不改 Schema，只按显示名规则改写数据；PostgreSQL 的同一修复把 `workspace_product_schema` 从版本 1
升到 2。只有含邮箱地址、没有可见字符或含误导字符的显示名会被改写。控制字符、行与段分隔符、U+2800 和 U+1D159
变为空格；双向控制、韩文填充符、零宽空格等默认可忽略字符，前置连接符号（如 U+0600）以外的其它格式字符，未配对
代理项和 U+FFFD 被清除。两个非空白字符之间的零宽连接符与零宽非连接符、virama 之后的零宽连接符、紧跟字符的变体选择符，以及英格兰、
苏格兰、威尔士旗帜的标签字符保留；名字末尾紧随 virama 的零宽非连接符被清除。邮箱地址只保留本地部分。其它名字逐字节不变，包括 emoji 和需要连接符的文字。仍以 owner 原显示名
命名的个人空间（例如 `alice@example.com 的个人空间`）随之改名，其它名字和数据保持不变。停止全部旧实例，启动一个 V22 实例，
待一致性备份、迁移和健康检查通过后再恢复服务。PostgreSQL 需在升级前自行备份。迁移失败会回滚，成功后重启
不会重复迁移或备份。如需回退，停止 V22 并恢复 V21 备份。V21 和 V22 不得同时写入同一 SQLite 文件。

### 执行层授权与产品数据库 V23

V22→V23 只新增空的 `executor_access` 表；PostgreSQL 产品 schema 以同样方式在启动时的一个事务内从版本 2 升到 3。
停止全部旧实例，启动一个 V23 实例，待备份、迁移和健康检查通过后再恢复服务。已有数据、对象键和未完成的恢复状态均会保留。
迁移失败会回滚，成功后重启不会重复迁移或备份。如需回退，停止 V23 并恢复 V22 备份（PostgreSQL 恢复升级前的数据库备份）。旧实例遇到 V23 会拒绝启动。
先升级 Workspace，再把 MCP 执行层设为 `workspace`：旧版 Workspace 不报告授权，执行层会在升级前拒绝所有人。

### 复制来源与产品数据库 V24

`POST /api/nodes/{nodeId}/copies` 把请求者能打开的 Sheet、Doc、Slide 或 Blob 文件复制成请求者自己的文件，放在其个人空间根级，或作为草稿 PR 中的新文件。副本拥有独立的内容和内嵌图片，`GET /api/nodes/{nodeId}` 只向副本的 owner 和编辑者通过 `copiedFromNodeId` 返回其来源，并通过 `copyCount` 返回从它复制出的文件数。请求中断的复制会在后台完成，无法完成的复制会清除已创建的内容。[HTTP 接口说明](contracts/http/concepts.md#copying-a-file)

V23→V24 新增 `nodes.copied_from_node_id`、`worktree_node_intents.copied_from_node_id`、`node_link_sharing.unverified_role`（已有行读作 `viewer`）和 `node_link_sharing.making_of_note`，并重建 `operations` 表，使其 kind CHECK 接受 `copy_node`。
停止全部旧实例，启动一个 V24 实例，待一致性备份、迁移和健康检查通过后再恢复服务。已有产品数据、对象键和未完成的恢复状态均会保留。
迁移失败会回滚，成功后重启不会重复迁移或备份。如需回退，停止 V24 并恢复 V23 备份。V23 和 V24 不得同时写入同一 SQLite 文件。

PostgreSQL 部署在启动时用一个事务把产品 schema 从版本 3 升级到版本 4。升级失败会回滚并停留在版本 3。服务端不备份 PostgreSQL，启动新版本前请先备份数据库并停止全部旧实例。

### 显示名收敛与产品数据库 V25

V24→V25 不改 Schema，对全部 User 和个人空间再执行一次 V22 显示名修复；PostgreSQL 的同一步骤把
`workspace_product_schema` 从版本 4 升到 5。执行过当前 V22 规则的数据库不会产生任何改动。执行过 47dc9277 部署的
早期 V22 规则的数据库保留了该规则漏掉的名字；本步骤按
现在的 V22 改写它们，仍以这些名字命名的个人空间随之改名。其它名字和数据逐字节不变，`agents.origin_label` 不受影响。
早期规则还从天城文、泰米尔文、马拉雅拉姆文、僧伽罗文等文字的合法名字中删除了紧随 virama 的零宽连接符，本步骤无法恢复：只有该环境在 V22 之前的备份
（`*.v21-backup-*.sqlite`，或 PostgreSQL 升级前的数据库备份）还保存着这些名字。停止全部旧实例，启动一个 V25 实例，
待备份、迁移和健康检查通过后再恢复服务。PostgreSQL 需在升级前自行备份。迁移失败会回滚，成功后重启不会重复迁移或备份。
如需回退，停止 V25 并恢复 V24 备份。V24 和 V25 不得同时写入同一 SQLite 文件。
