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

默认情况下，产品数据保存在 `.data/univer-workspace.sqlite`，Univer Unit 的协同数据单独保存在 `.data/univer-collaboration.sqlite`。上传文件和附件默认保存在 `.data/univer-workspace-blobs`。使用私有 S3 兼容存储桶时，设置 `BLOB_STORE=s3` 和 `BLOB_S3_BUCKET`。已有部署须先复制文件，再切换存储。[S3 配置与迁移](docs/s3-storage.zh-CN.md)

Sheet、Doc、Slide、Base 和 Board 的评论锚点保存在 Unit 快照与变更集中。评论正文、回复和解决状态由同一协同数据库中的 Comment 组件保存。主线（Trunk）、Worktree 和合并预览共享评论正文，只有锚点随 Unit 数据分支和合并。在 Worktree 删除评论也会删除主线上的同一条评论。详见 `docs/application-design.md` 的“评论与 Worktree”一节。

同一协同数据库还保存历史版本的分段索引。SDK 1.0.0 会根据 Core 记录的创建信息和变更集自动建立索引。如果尚无历史记录，读取时会计算分段并在后台保存。主线上的 Sheet、Doc、Slide、Base 和 Board 编辑器使用 SDK 的版本历史界面。只读用户可以查看版本，有内容编辑权限的用户还可以恢复版本。Worktree 和合并预览编辑器不展示主线的版本历史。

已登录用户从未创建 Worktree 且没有可见任务时，智能工作台会显示 Workspace Agent 下载入口及 CLI、Skill 安装指南。已有可见团队任务的用户会在任务列表旁看到简短介绍。

审阅 Worktree 时默认打开 Agent 草稿，也可以切换到只读的并排对比视图。拥有草稿编辑权限的用户可以在浏览器修改草稿，更改会同步给同一 Worktree 中的 Agent。Worktree 进入就绪状态后，有重新打开权限的用户可以点击**继续编辑**，将其转回草稿状态。主线审阅、合并预览和对比视图均为只读。切换视图或提交审阅前，请等待编辑器同步完成。

服务端还原并解码主线和草稿的权威状态，用匹配的 History SDK 适配器计算语义差异，通过需要认证的内部接口 `/universer-api` 返回结果。浏览器为对比视图提供 Univer 预设和插件，也可继续使用正式版、Agent 草稿和合并预览的 iframe 视图。内部对比接口可通过 `baseMode=base` 将左侧固定为该 Unit 在 Worktree 中记录的基线版本。右侧可选 `view=draft`、`view=preview`（仅限就绪状态）或 `view=merged`（仅限已合并状态）。合并结果按 SDK 保存的合并修订号读取。缺少该修订号时，无法还原合并当时的固定版本。浏览器默认对比当前主线与草稿。Agent 使用这些模式审阅历史基线。在 Worktree 内新建的 Unit 基线为空，丢弃 Worktree 后仍可审阅。

在草稿 Worktree 中可以将单个 Unit 标记为删除，也可以撤销标记。就绪后删除标记被冻结，要修改需先重新打开 Worktree。合并时，已标记的 Unit 不参与内容发布，已有文档随后移入回收站。在同一 Worktree 内新建又取消的 Unit 不会发布。丢弃整个 Worktree 会保留已有文档。单个 Unit 的合并结果 `removed` 只表示其内容已排除。等到 Worktree 状态为 `merged` 且合并 Operation 已完成，才表示文档删除完成。如果本次操作结束后 Worktree 仍为就绪状态，需要再次合并。要找回合并时删除的文档，请从回收站恢复。

Univer 编辑器通过服务端 `@univerjs-pro/exchange-node` 导入和导出 XLSX/CSV/TSV、DOCX、PPTX 和 PDF。PDF 转换还需要可选的原生依赖 `@univerjs-pro/exchange-pdf-node-binding`。这些接口遵循 Universer Exchange 协议，位于 `/universer-api/exchange/**`，产品 OpenAPI 不收录这些接口。通过 Workspace 的文件操作导入 XLS/XLSX/CSV/TSV、DOC/DOCX、PPT/PPTX 或 PDF，会在所选空间和文件夹创建 Univer 文档。其他类型保存为可下载的 Blob 文件。从编辑器功能区导入时，目标默认为当前用户的个人空间根目录。上传的源文件、转换后的 JSON 快照和导出文件作为临时对象存入 BlobStore，有效期两小时，任务元数据仅保存在当前进程中。Worktree 和合并预览编辑器尚不支持各自范围内的 Office 转换，因此不显示导入导出操作。

导入 XLSX、DOCX 或 PPTX 时，图片和内嵌 Office 附件作为新 Unit 的主线 Asset 保存，Unit 中只保留 Asset ID。超过 20 MB 的文件仍以内联形式保存。可在附件工具栏将附件转为独立的在线文档，原附件仍保留在宿主文档上。服务端会核对用户能否打开宿主 Unit、附件是否属于该 Unit。如果用户有权在宿主文件夹创建文档，新文档就保存在该文件夹，否则保存在个人空间根目录。导出 XLSX、DOCX、PPTX 或 PDF 时，默认嵌入已转换附件的当前在线版本。服务端按导出用户的权限逐一读取，任一文档不可读都会导致导出失败。API 调用方也可传入 `options.oleAttachmentSource: "original"` 以嵌入原始附件。

导出 Office 文件前，服务端根据请求用户在主线上的权限读取托管的 Asset，包括母版页和序列化绘图资源中的图片。文件字节内嵌到导出副本中，已保存的快照和 Asset 保持原样。如果有图片缺失、无访问权限或内容无效，导出会失败。

Doc 和 Slide 可以在同一编辑器内读取引用的 Sheet。编辑器在加载来源前注册 Sheet 数据插件，用于还原资源、重放变更集和解析公式。引用 Sheet 时仍使用宿主编辑器和原有工具栏，Workspace 引用提供方负责检查来源访问权限并选择主线或 Worktree。实时数据源在相同范围内复用 SDK 的协同连接。公式依赖失效、计算顺序和结果应用均由 SDK 管理。

### 仓库首页

在应用设置中选择 **Repository**，可启用 OfficeLab 的 GitHub 风格首页。`/home` 展示最近打开的文件、进行中的 Pull requests 和未关闭的 Issues。全局侧栏提供以下入口。

- `/repositories` 列出所有可访问的仓库。可按名称、描述或所有者搜索，按个人或团队仓库及可见性筛选，按名称排序，也可以创建仓库。
- `/worktrees` 分页展示进行中或已处理的 Pull requests，支持服务端搜索及按仓库、类型筛选。打开审阅页时，列表的筛选条件保留在 URL 中。
- `/issues` 展示跨仓库的 Issue 列表和筛选项。
- `/recent` 分页展示最近打开的资源。
- `/apps` 分页展示 Pages 目录。选择 Page 后会打开内嵌查看器，现有的 `node` 和 `spaceId` 链接仍可使用。

最近访问和 Pages 的文本搜索仅在已加载的结果中查找，界面上会标明搜索范围。首页各摘要独立查询有限条目，从长列表返回时无需重新加载所有已缓存的分页。浏览目录只读取元数据，打开文件或预览才会计入访问记录。Pages 展示实际元数据，不生成模拟缩略图。只有 Worktree 摘要权限的用户看不到审阅链接。

Wiki 保留原有首页和内嵌 Apps。Repository 导航在窄屏上使用抽屉菜单，并支持两种界面语言和配色主题。

### Markdown 文件

上传的 `.md` 和 `.markdown` 文件会打开只读的 CommonMark/GFM 预览。可以切换预览与源码，也可以下载原文件。预览支持表格、任务列表、删除线和脚注。两种视图均完整读取 UTF-8 文本，不截断预览。原始 HTML 按文本显示，相对文件和图片路径不会解析，外部图片只在点击后加载。Markdown 文件以 Blob 保存，无法像 Univer Doc 一样协同编辑。Agent 的远程文件查看器使用相同的渲染器。

### 配置

将 `.env.example` 复制为 `.env`。开发、数据库和生产启动命令会自动加载该文件。

**GitHub 登录。** 同时配置 `GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET` 和 `GITHUB_CALLBACK_URL` 即可启用 GitHub OAuth。每个 GitHub OAuth App 只接受一个回调地址，请为开发和生产环境分别创建 App。本地开发使用以下地址。

```text
Homepage URL: http://127.0.0.1:5173
Authorization callback URL: http://127.0.0.1:5173/api/auth/github/callback
```

生产 App 填写自己的部署域名。

```text
Homepage URL: https://workspace.example.com/
Authorization callback URL: https://workspace.example.com/api/auth/github/callback
```

GitHub 登记的回调地址必须与 `GITHUB_CALLBACK_URL` 完全一致。配置后，登录页会显示 **使用 GitHub 继续**。首次登录会创建 Workspace 用户及个人空间。已登录的用户可以在账户菜单中关联 GitHub。Workspace 仅在登录期间用访问令牌读取 GitHub 资料，随后丢弃令牌。

将允许的 GitHub 组织名用逗号分隔，填入 `GITHUB_ALLOWED_ORGANIZATIONS`，即可限制 GitHub 登录、首次注册和账户关联。Workspace 会申请 `read:org` 权限，并在每次 GitHub OAuth 回调时检查用户是否为至少一个所列组织的有效成员。已有会话在到期或退出前有效。此设置只约束 GitHub OAuth，密码注册、Google、Discord 和受信任的 Discord Bot 各自使用独立的认证方式。

**GitHub Skill 导入。** `GITHUB_TOKEN` 默认留空，与 GitHub OAuth 分开配置。导入 Skill 时，服务器仅在请求 `api.github.com` 时使用这个令牌。未配置时，同一服务器 IP 的所有导入共享每小时 60 次请求的配额，配置后使用令牌的已认证配额。从 `raw.githubusercontent.com` 获取 Skill 原始文件时不携带令牌。配额用尽时，可下载 Skill 的 ZIP 文件，再上传到空间。

**密码与邮箱登录。** `PASSWORD_AUTH_ENABLED` 默认开启，允许密码注册、登录和修改密码。设置 `PASSWORD_AUTH_ENABLED=false` 可关闭这三项。若希望浏览器仅允许指定 GitHub 组织的成员登录，关闭密码认证，配置 `GITHUB_ALLOWED_ORGANIZATIONS`，并保持邮箱、Google 和 Discord 登录关闭。关闭密码认证后，至少要配置邮箱、GitHub、Google 或 Discord 中的一种登录方式，服务才能启动。已有会话在退出或到期前有效。只有密码的账户随后将无法重新登录，解除 GitHub、Google 或 Discord 关联时，已存的密码也不会计作可用登录方式。

设置 `EMAIL_AUTH_ENABLED=true`，或配置任一 `EMAIL_SMTP_*`、`EMAIL_FROM` 值，即可启用邮箱验证码登录。浏览器请求六位验证码，首次验证成功后创建用户和个人空间。验证码有效期为十分钟，最多允许输错五次。每个邮箱每分钟最多请求一次，每小时最多五次。请求结果不会透露该邮箱是否已注册。

本地开发可用 `EMAIL_PROVIDER=console` 将验证码写入服务器日志。生产环境可使用任意 SMTP 服务，例如 AWS SES。

```text
EMAIL_PROVIDER=smtp
EMAIL_FROM=no-reply@example.com
EMAIL_FROM_NAME=Univer Workspace
EMAIL_SMTP_HOST=email-smtp.us-east-1.amazonaws.com
EMAIL_SMTP_PORT=587
EMAIL_SMTP_USER=<SES SMTP username>
EMAIL_SMTP_PASSWORD=<SES SMTP password>
```

验证邮件统一使用英语。`EMAIL_SMTP_USER` 和 `EMAIL_SMTP_PASSWORD` 按服务商提供的原值填写，SMTP 客户端会完成 AUTH 编码，无需手动进行 Base64 编码或 URL 转义。使用 SES 时，先验证发件域名或地址，再在 SES 控制台创建专用 SMTP 凭据。沙箱账户只能向已验证的收件人发送邮件。未设置 `EMAIL_SMTP_SECURE` 时，`EMAIL_SMTP_PORT=465` 会启用隐式 TLS。

SES 返回 `Invalid login: 535 5.7.8 Authentication Credentials Invalid` 表示凭据校验失败。依次核对 SMTP 用户名是否为生成 SES SMTP 凭据时显示的访问密钥 ID、密码是否为该用户名对应生成的 SMTP 密码，以及凭据的区域是否与 `EMAIL_SMTP_HOST` 一致。IAM 用户名和 IAM 私密访问密钥均不能充当 SMTP 用户名。重新生成 IAM 访问密钥后，原来派生的 SMTP 密码随即失效。可单独运行以下命令验证邮件配置。

```bash
node --env-file=.env --input-type=module -e '
import nodemailer from "nodemailer";
const transport = nodemailer.createTransport({
  host: process.env.EMAIL_SMTP_HOST,
  port: Number(process.env.EMAIL_SMTP_PORT ?? 587),
  secure: process.env.EMAIL_SMTP_SECURE === "true",
  auth: { user: process.env.EMAIL_SMTP_USER, pass: process.env.EMAIL_SMTP_PASSWORD },
});
await transport.verify();
console.log("SMTP authentication succeeded");
'
```

**公开试用。** `TRIAL_DEPLOYMENT` 默认为 `false`。设为 `TRIAL_DEPLOYMENT=true` 后，用户登录时会看到试用环境无法保证长期保存数据的提示，以及用于自行部署的开源仓库链接。浏览器按用户将确认记录保存在 `localStorage`，更换浏览器或清除站点数据后会再次提示。访客和登录页不显示此提示。

**CLI 登录。** 默认由用户在浏览器批准登录。`uvw auth login` 创建有效期十分钟的一次性授权请求，输出 `/cli-login` 地址和验证码，将待完成的请求保存到本地后退出。用户可以先用邮箱验证码、GitHub、Google、Discord 或密码登录，再回到授权页核对并批准验证码。随后由 Agent 运行 `uvw auth login --complete` 兑换一次。两条命令都不会等待或轮询。CLI 获得独立的 `workspace_session`，用户的浏览器 Cookie、Workspace 密码和第三方访问令牌都不会交给 CLI。服务器重启会清除待批准的请求，已建立的 CLI 会话会持久保存。

**Google 登录。** 同时配置 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET` 和 `GOOGLE_CALLBACK_URL`，即可启用登录和账户关联。在 Google Cloud Console 创建类型为 **Web application** 的 OAuth 2.0 客户端 ID，登记所用的开发和生产重定向 URI。

```text
http://127.0.0.1:5173/api/auth/google/callback
https://workspace.example.com/api/auth/google/callback
```

重定向 URI 必须与 `GOOGLE_CALLBACK_URL` 完全一致。Workspace 申请 `openid email profile`，兑换令牌时同时使用 PKCE 和客户端密钥，并以 OpenID Connect 的稳定 `sub` 声明标识 Google 身份。访问令牌仅用于登录时读取 Google 资料，不会持久保存。Workspace 不按邮箱自动关联账户。同一人分别用 Google 和邮箱验证码登录，会得到两个独立的 Workspace 账户。

**Discord 登录。** 同时配置 `DISCORD_CLIENT_ID`、`DISCORD_CLIENT_SECRET` 和 `DISCORD_CALLBACK_URL`，即可启用登录和账户关联。在 Discord Developer Portal 添加本地回调地址。

```text
http://127.0.0.1:5173/api/auth/discord/callback
```

重定向 URI 必须与 `DISCORD_CALLBACK_URL` 完全一致。Workspace 仅申请 `identify` 权限，保存稳定的 Discord 用户 ID 和用户名，不保存访问令牌。独立的 Discord App 可用该 ID 关联 Discord 和 Workspace 用户。

受信任的 Discord Bot 服务器可调用 `POST /api/auth/discord/bot-login` 为用户登录。双方配置同一个至少 32 字符的随机密钥，Workspace 通过 `DISCORD_BOT_API_KEY` 读取，Bot 通过 `x-api-key` 请求头发送。请求必填稳定的 `discordUserId`，可选 `username`、`displayName` 和 `avatarUrl`。接口会查找或创建用户和个人空间，返回标准的已认证会话响应及 `workspace_session` Cookie。仅允许受信任的 Bot 服务器调用此接口，密钥不能交给 Discord 客户端或浏览器。若首次只提供 `discordUserId`，Workspace 会暂用占位资料，日后通过 Discord OAuth 登录时会从已验证的资料补全，并保留用户已自定义的字段。

**外部 OAuth 客户端。** 部署者通过 `OAUTH_CLIENTS_JSON` 注册客户端。已注册的客户端先访问 `GET /api/auth/authorize`。该接口复用 `workspace_session`，缺少会话时转到登录页，再将短期有效的一次性授权码发给已登记的重定向 URI。`POST /api/auth/token` 会验证客户端密钥（如适用）、已登记的重定向 URI、PKCE 校验值、有效期和是否已兑换，然后返回 Workspace 身份。

外部浏览器客户端应使用 `clientType: "public"`、PKCE 和 `requiresConsent: true`，省略 `clientSecret`，回调地址须与登记值完全一致。本地 Workspace Agent 的回调地址为 `http://127.0.0.1:3101/auth/oauth/callback`。内部服务可注册为机密客户端，沿用免确认的授权方式。

机密客户端（如 MCP 网关）配置 `"tokenExchange": true` 后，可在 `POST /api/auth/token` 上使用 RFC 8693 授权，将个人访问令牌或 MCP OAuth 访问令牌兑换为最长十分钟的 Workspace 会话。原令牌或部署的会话期限先到时，兑换的会话同步到期。此接口只接受表单请求体，公开客户端不能配置此选项。已登录用户可以通过 `GET`/`POST /api/auth/tokens` 和 `DELETE /api/auth/tokens/:id` 管理个人访问令牌，令牌明文只在创建时返回。用令牌兑换的会话不能创建令牌、批准 CLI 登录、授权 OAuth 客户端或关联身份（`403`），因此无法再授权超出原令牌有效期的访问。

**MCP OAuth。** opencode、Claude、ChatGPT 等 MCP 客户端可通过标准 OAuth 获取令牌。在 `MCP_RESOURCE_URLS` 中用逗号分隔允许请求的 MCP 服务器地址，例如 `https://space.example.com/mcp`。请求的资源地址须与其中一项完全匹配，或移除查询参数后匹配。例如 `https://space.example.com/mcp?toolsets=all` 会绑定到 `https://space.example.com/mcp`。同时将 `PUBLIC_ORIGIN` 设为客户端可访问的 Workspace 源地址，如 `https://space.example.com`。`GET /.well-known/oauth-authorization-server`（RFC 8414）使用它作为签发者地址。

公开客户端可通过 `POST /api/auth/register`（RFC 7591）自行注册，无需密钥。支持的重定向 URI 包括回环 `http` 地址、`https` 地址，以及使用反向域名或允许名单内自定义协议（目前为 `cursor`）的地址。达到 `MCP_MAX_REGISTERED_CLIENTS` 上限时，注册返回 `503`，默认上限为 10,000。之后客户端通过 `GET /api/auth/authorize` 提交 PKCE `S256` 和 `resource`。回环重定向 URI 可匹配任意端口。用户每次授权都会看到确认页，可以逐项取消 `read`、`write`、`publish` 和 `worktree:merge`。

`POST /api/auth/token` 返回绑定到该资源的 `uvw_at_` 访问令牌（有效期一小时）和轮换的 `uvw_rt_` 刷新令牌（有效期 30 天）。`POST /api/auth/revoke`（RFC 7009）可撤销授权。未设置 `MCP_RESOURCE_URLS` 时，这些 MCP OAuth 能力关闭。静态客户端始终沿用其原有注册规则。本地开发设置 `PUBLIC_ORIGIN=http://127.0.0.1:5173`，Vite 会将 `/.well-known` 代理到 API。

浏览器 Agents 模块可凭交互式 `workspace_session` Cookie 调用 `POST /api/auth/agent-token`。请求可用 `{ "scopes": ["read"] }`、`{ "scopes": ["read", "write"] }` 或 `{ "scopes": ["read", "publish"] }`，权限顺序不限，不可重复。成功返回 `201`、`{ token, expiresAt, scopes, resource }` 以及 `Cache-Control: no-store`。有效期一小时的 `uvw_at_` 令牌属于第一方 `univer-workspace-agents` 客户端，绑定到 `PUBLIC_ORIGIN` 下的 `/mcp`，该地址必须列入 `MCP_RESOURCE_URLS`。缺少 MCP OAuth 配置或同源资源时返回 `503`，没有 Cookie 返回 `401`，使用令牌兑换的会话返回 `403`，申请了无效权限返回 `400`。

Ask 模式的常规调用使用 `[read]`，Auto 模式使用 `[read, write]`。Auto 模式发布前会暂停，等待用户明确批准。每次获批的调用使用单独的 `[read, publish]` 令牌和 MCP 客户端，调用后释放客户端。全屏草稿预览仅在本地试算，不能编辑源 Sheet 或打开原生编辑器。新用户消息会拒绝待批请求，让 Agent 可以继续修改草稿。此接口不会授予 `worktree:merge`、返回刷新令牌或向账户列表添加个人访问令牌。网关仍通过令牌兑换获取会话。

**访客 Agent。** `POST /api/agents` 和 `POST /api/auth/guest` 都支持免凭据创建 `agent` 类型的用户。Agent 有独立的个人空间，初始有效期为 30 天。`POST /api/agents` 接受可选的 `{ "label" }`，以 `201` 返回 `{ agent: { id, username }, token, mcpUrl, expiresAt }`。`token` 为包含所有 MCP 权限的个人访问令牌，`mcpUrl` 为 `MCP_RESOURCE_URLS` 中的第一个地址，未配置时为 `null`。`POST /api/auth/guest` 会设置 `workspace_session` Cookie 并返回 `{ agent }`。请求已携带有效会话时返回 `409`，避免覆盖当前登录。登录后将返回 `/api/auth/authorize` 时（例如 MCP 客户端的 OAuth 登录），页面会提供访客 Agent 入口。选择后浏览器调用 `POST /api/auth/guest` 并回到授权页，由访客确认所需权限。

未认领的 Agent 每次认证或有人访问其 `/nodes/:nodeId` 页面时，到期时间会延至 30 天后，每天最多续期一次。Agent 到期或被封禁后，其个人空间仅自己可读，其他人打开其链接会收到“未找到”。无论上次活跃距今多久，到期 Agent 再次认证即可恢复。被封禁的 Agent 认证时返回 `401`，兑换令牌返回 `invalid_grant`。运行 `pnpm db:ban-agent <username or user id>` 可封禁 Agent，生产构建使用 `db:ban-agent:production`。该命令只接受 Agent，重复执行不会再次变更状态。既有协同连接保持到会话结束。MCP 网关最多缓存令牌兑换结果 30 秒，此期间，`whoami` 等不访问 Workspace 的工具可能仍会响应已封禁的令牌。

以下限制适用于所有角色，违规返回 `403`。Agent 不能创建团队空间、公开空间或成为团队空间成员（`AGENT_NOT_ALLOWED`）。未认领的 Agent 在个人空间最多保留 20 个文件，单个文件最多 10 MiB（`AGENT_QUOTA_EXCEEDED`），通过链接分享最多获得查看者（Viewer）权限。真人用户通过访问令牌兑换的会话也不能更改链接分享（`INTERACTIVE_SESSION_REQUIRED`）。用户搜索结果不含 Agent，未认领 Agent 发起搜索会收到 `AGENT_NOT_ALLOWED`。

可免凭据调用 `POST /api/nodes/:nodeId/reports` 举报调用方可读的节点。请求体为 `{ "reason" }`，最多 1,000 个字符，成功返回 `201` 和 `{ id }`。每个来源 IP 每小时最多举报十次，超出返回 `429` 和 `REPORT_RATE_LIMITED`。日志仅记录节点及举报 ID。

两个创建 Agent 的接口共用一个按来源 IP 计算的进程内限额。`AGENT_CREATE_LIMIT_PER_HOUR` 控制任意一小时内可创建的数量，默认为 `5`。设为 `0` 会禁用创建，匿名访问 `GET /api/session` 返回 `guestAuthEnabled: false`，页面随之隐藏访客入口。超过限额返回 `429` 和 `AGENT_CREATE_RATE_LIMITED`。IPv6 来源按 /64 前缀计数。进程重启会重新计数，不同实例独立计数。

默认使用 TCP 对端的 IP。经反向代理部署时，所有客户端会共享代理 IP 的限额，除非设置 `TRUST_PROXY`。其值对应 Express 的 `trust proxy`，可填 Workspace 前方的代理跳数（如 `1`），或用逗号分隔的代理地址和子网（如 `loopback, 10.0.0.0/8`）。取值 `true` 会信任任意 `X-Forwarded-For`，能直连 Workspace 的客户端也能自行指定来源 IP。

**MCP 客户端元数据。** 公开 MCP 客户端可使用 HTTPS `client_id` URL，通过客户端 ID 元数据文档（CIMD）标明身份，无需动态注册或写入 `oauth_clients`。启用 MCP OAuth 时默认启用 CIMD。发现文档会列出 `client_id_metadata_document_supported` 和 `authorization_response_iss_parameter_supported`，所有 MCP 授权回调（成功、出错或拒绝）都包含 `iss`。静态客户端沿用原有的回调行为。无法向外发起 HTTPS 请求的部署可设 `MCP_CIMD_ENABLED=0`。发现文档随后不再声明 CIMD 支持，URL 形式的客户端 ID 视为未知客户端，动态客户端注册（DCR）仍可用。

CIMD URL 必须使用 HTTPS，含根目录以外的路径，并省略凭据、查询、片段及点路径段。仅在交互式登录后获取元数据。连接时检查目标是否为公网地址，不使用环境代理或跟随重定向。响应正文上限为 5 KB，总超时为五秒。同一 URL 的并发请求会合并，每个用户最多有一个进行中的获取请求，进程最多 32 个。有效文档缓存 5 分钟至 24 小时，最多 1,000 条。遇到临时错误时，仍可沿用上次成功获取的文档，最迟到该次获取后的 24 小时。授权确认页显示客户端名称和主机名。获取失败时，页面停留在 Workspace，无效请求返回 400，临时故障返回 503。令牌兑换、刷新和撤销均不获取元数据。删除文档不会撤销已签发的刷新授权，其有效期最长 30 天。

如果 fake-IP 或 TUN 解析器把公网主机映射到被阻止的网段，可用 `MCP_CIMD_EXEMPT_NETWORKS` 为获取元数据的出站连接放行所需代理网段。该选项接受逗号分隔的 CIDR（如 `198.18.0.0/15`），默认空。使用此类解析器时，真实地址由代理解析，Workspace 无法阻止通过主机名访问代理可达的内网服务，因此只能对无法访问内网服务的代理启用此配置。服务器启动时会拒绝与 IPv4 或 IPv6 回环、链路本地网络重叠的例外网段。

默认关闭 Agent 客户端，`.env.example` 里提供了注释示例。完整配置、启动本地服务器和浏览器、注册账户并连接 Agent 的步骤见[连接本地 Workspace](../agent/README.zh-CN.md#连接本地-workspace)。此授权功能复用现有登录、OAuth 回调、Cookie 和产品 API，无需部署额外代理或组件。

部署者可在注册客户端时为其开放 `session` 权限。授予该权限后，令牌响应会在 `access_token` 返回 Workspace 登录会话令牌，`expires_in` 为剩余有效期。客户端将令牌作为 `workspace_session` Cookie 访问产品和协同接口，以授权用户的权限操作。会话到期后需重新授权，不提供刷新授权。客户端注册时已确定是否信任其获取会话，因此签发授权码时沿用仅授权身份时的免确认行为。

**运行时许可证。** 浏览器和 Workspace CLI 使用同一份内置开发凭据，两处副本每 90 天一并轮换。仓库代码的开源许可证另行适用。内置凭据允许的域名列在生成的 `license.ts` 注释中。部署到其他域名或需要本地覆盖时，请在构建时设置 `VITE_UNIVER_LICENSE`。未列入许可的域名提供的页面访问协同接口时会收到 403（错误码 9018）。

服务器同时向 Collaboration 服务和 Office 导入导出传入许可证及密钥，默认使用内置开发凭据。要覆盖须同时配置 `UNIVER_LICENSE` 和 `UNIVER_LICENSE_KEY`。缺少许可证时，两个 SDK 使用免费额度，即一个协同节点、三个编辑连接、每月十次导出。服务器、数据库、GitHub 和 Discord 均使用运行时配置。

已登录的浏览器会保持一个 `/api/worktree-events` WebSocket 连接。AI 或 CLI 对 Worktree 的写入在协同及产品操作均完成后通知浏览器刷新缓存。活动和已处理任务列表、详情、侧栏计数及受 Worktree 影响的节点与资源列表会自动更新。连接使用一次性会话票据，通知不含 Worktree 元数据或正文。

### 数据库

`DATABASE_PROVIDER` 同时选择产品库和协同库的后端。默认值为 `sqlite`，两个文件的位置分别由 `DATABASE_FILE` 和 `COLLABORATION_DATABASE_FILE` 指定。使用 PostgreSQL 17 时，先建一个专用数据库，给 Workspace 账号授予创建 `collaboration` schema 以及在产品 schema（通常为 `public`）和 `collaboration` 中创建对象的权限。给服务进程或容器传入：

```dotenv
DATABASE_PROVIDER=postgres
DATABASE_URL=postgresql://workspace@db/workspace
```

首次启动自动创建产品表和协同表。备份时停止全部写入实例，保存整个 PostgreSQL 数据库的逻辑备份和配套的 BlobStore 内容。恢复两者后再启动一个实例。

切换后端前需单独迁移已有的 SQLite 数据。此前使用 `PRODUCT_DATABASE_PROVIDER=postgres` 的部署，产品数据已在 PostgreSQL 中，需先迁移协同 SQLite 文件中的数据，再替换旧配置。

## Docker

在仓库根目录构建镜像。

```bash
docker build \
  --build-arg VITE_UNIVER_LICENSE="$VITE_UNIVER_LICENSE" \
  -f apps/workspace/Dockerfile \
  -t univer-workspace .
```

运行容器并挂载持久化数据卷。

```bash
docker run --name univer-workspace \
  -p 3020:3020 \
  -v univer-workspace-data:/app/univer-workspace/.data \
  -e GITHUB_CLIENT_ID \
  -e GITHUB_CLIENT_SECRET \
  -e GITHUB_CALLBACK_URL=https://workspace.example.com/api/auth/github/callback \
  -e GITHUB_ALLOWED_ORGANIZATIONS \
  -e GOOGLE_CLIENT_ID \
  -e GOOGLE_CLIENT_SECRET \
  -e GOOGLE_CALLBACK_URL=https://workspace.example.com/api/auth/google/callback \
  -e DISCORD_CLIENT_ID \
  -e DISCORD_CLIENT_SECRET \
  -e DISCORD_CALLBACK_URL=https://workspace.example.com/api/auth/discord/callback \
  -e OAUTH_CLIENTS_JSON \
  -e SECURE_COOKIES=true \
  univer-workspace
```

通过 HTTPS 部署时保持安全 Cookie 开启。使用明文 HTTP 时，传入 `-e SECURE_COOKIES=false`。

需要全新的本地测试实例时，挂载一个新的空数据卷即可。启动会保留已有数据，自动备份受支持的 V0 至 V20 产品数据库并迁移至 V21。容器运行期间，只能从容器内部（`docker exec … node`）访问 SQLite 文件。产品数据库采用 WAL 模式，从宿主机用另一套 SQLite 打开文件，即使只读也可能损坏文件。检查或复制 `.data` 前先停止容器。

SQLite 协同数据库的组件版本为 `core=4`、`worktree=4`、`history=2`、`comment=1`。SDK 1.5.2 为主线和 Worktree 的 Unit、Changeset 增加元数据，已有记录的初始值为 `{}`，内容和修订号保留。

服务端入口会在创建应用服务前准备协同数据库。升级顺序如下。

1. 停止**所有**会写入 Workspace 的旧实例，备份产品数据库、协同 SQLite 文件和 Blob 存储。Kubernetes 部署使用单副本及 `Recreate` 策略。
2. 启动一个新实例。服务先将产品数据库准备到 V21，再读取协同组件版本。需要迁移时，服务获取排他锁，检查源文件的完整性和外键，并在数据库旁创建一致性备份 `<collaboration-file>.pre-sdk-migration-<timestamp>-<uuid>.bak`。如果其他进程仍打开 WAL 模式的文件或持有任何锁，启动会在备份前失败。空闲的 rollback-journal 连接不持锁，无法通过锁检测，因此必须执行第 1 步。
3. 服务持锁期间，在暂存副本上执行已发布的 SDK 迁移。为升级前备份、暂存副本和一份临时组件备份预留磁盘空间。Schema 校验、`foreign_key_check` 和 `integrity_check` 全部通过后，才用副本原子替换原文件。如果迁移失败，服务在接收流量前终止启动，原库、日志模式和备份均保留。
4. 确认启动正常、文档和 Worktree 均可访问后，恢复服务。后续启动只读取组件版本，无需重复完整性和外键扫描、迁移或备份。

支持从 Core V1–V3、Worktree V1–V3 和 History V1 升级。新数据库由当前适配器初始化。迁移优先从 History V1 的修订 1 读取 Unit 创建者和时间，缺失时查询产品数据库。主线 Unit 取其 Trunk Node，Worktree 内创建的 Unit 取对应的节点意图。两个来源均缺少信息时，以 `anonymous` 和迁移时间补缺，不能据此还原真实的创建信息。Changeset 时间沿用 SDK 默认值。

新旧 SDK 实例不能同时写入。回滚时停止新实例，同时还原同一批次的升级前产品库、协同库与 Blob 备份。只换回旧镜像无法还原数据，备份应保留到部署验收完成。

各版本的产品数据库变更如下。

- **V7** 扩展 Operation 类型和对象删除原因以支持替换 Blob，保留既有 Blob 行和上传会话。
- **V8** 新增内容权限对象和协作者，保留原有表。
- **V9** 新增 Space 范围内的 Issue、评论、事件、标签、负责人和文件引用，保留原有表。
- **V10** 新增 `space_stars`，保留已有 Space、内容、Blob 和恢复记录。
- **V11** 新增 `spaces.description TEXT NOT NULL DEFAULT ''`，已有 Space 的描述为空字符串，其余行不变。有权重命名 Space 的用户可编辑描述。描述是最多 350 个字符的纯文本，写入时去除首尾空白。
- **V12** 新增可空的 `spaces.slug`、`worktrees.number` 及部分唯一索引。迁移不改写既有行。旧 Space 和 Worktree 的新字段保留 `NULL`，继续按 ID 访问。管理员可在设置中给旧团队空间指定 slug。团队空间的 slug 在同一所有者下唯一，忽略大小写，与用户名组成 `owner/slug`。个人空间使用 `owner/personal`。团队 Worktree 与 Issue 共用 Space 内的 `#N` 编号序列。升级时停止全部旧实例，启动一个 V12 实例，等待迁移和健康检查通过后恢复服务。禁止 V11 与 V12 同时写同一 SQLite 文件。启动会在 V11 → V12 事务前创建并校验 `.v11-backup-…sqlite`。失败会回滚，成功后重启不会重复迁移或备份。回滚必须停止 V12 并还原升级前的产品数据库备份。
- **V13** 扩展外部身份提供方的 CHECK 约束以允许 `google`。迁移仅重建 `external_identities`，保留已有行、列和约束。
- **V14** 新增可空的 `users.email` 列和 `email_login_codes` 表，支持无密码邮箱登录。已有表和行无需重写。停止全部旧实例，启动一个 V14 实例，等待迁移和健康检查通过后恢复服务。禁止 V13 与 V14 同时写同一 SQLite 文件。启动会在 V13 → V14 事务前创建并校验 `.v13-backup-…sqlite`。回滚时停止 V14，还原升级前的产品库备份。
- **V15** 新增 `space_pins` 和 `space_stars_user`，支持按序置顶及按用户索引收藏。已有行、内容、Blob 标识和恢复状态均保留。停止全部旧实例，启动一个 V15 实例，等待迁移和健康检查通过后恢复服务。启动先校验 V14，创建可读的 `.v14-backup-…sqlite` 备份，再在一个事务中建表、建索引并执行外键和完整性检查。事务失败会回滚，成功后重启不会重复迁移或备份。回滚时停止 V15 并还原 V14 备份。禁止 V14 与 V15 同时写同一 SQLite 文件。
- **V16** 新增 `login_sessions.write_source`、`worktrees.created_via` 和 `issues.created_via`。三列均可空、无默认值，CHECK 允许 `browser` 和 `agent`。已有行保留 `NULL`，表示来源未知。签发会话时将入口记入 `write_source`。通过 HTTP 创建 Worktree 或 Issue 时把来源写入 `created_via`，由 `createdVia` 返回 `browser`、`agent` 或 `unknown`。重试创建 Worktree 的 Operation 会保留首次预留的来源。停止全部旧写入实例，启动一个 V16 实例，等待迁移和健康检查通过后恢复服务。启动会校验 V15，并在事务前创建可读的 `.v15-backup-…sqlite`，失败会回滚，成功后重启不会重复迁移或备份。回滚时停止 V16 并还原 V15 备份。禁止 V15 与 V16 同时写同一 SQLite 文件。
- **V17** 扩展 `univer_resources` 和 `worktree_node_intents` 的 Unit 类型，允许 `pdf`。SQLite 无法直接修改 CHECK 约束，迁移在一个事务中重建这两张表，保留全部行、`univer_resources_kind_guard` 触发器，以及 `content_permission_objects` 对它的外键引用。内容、Blob 标识和恢复状态均保留。停止全部旧实例，启动一个 V17 实例，等待迁移和健康检查通过后恢复服务。启动会校验 V16，创建可读的 `.v16-backup-…sqlite` 备份，再重建表并检查外键和完整性。事务失败会回滚，成功后重启不会重复迁移或备份。回滚时停止 V17 并还原 V16 备份。禁止 V16 与 V17 同时写同一 SQLite 文件。
- **V19** 新增 `oauth_clients`、`oauth_grants`、`oauth_refresh_history`、`personal_access_tokens`，分别保存动态注册的 OAuth 客户端、MCP OAuth 授权（访问令牌及轮换刷新令牌的哈希）、已淘汰刷新令牌的哈希（用于检测重复使用），以及个人访问令牌（以哈希保存，可撤销）。`login_sessions` 新增 `login_sessions.issued_for_pat_id` 和 `issued_for_grant_id` 两个可空列，将下游会话关联到签发它的令牌。迁移仅新增表、索引和列，既有会话、有效期和登录均保留。停止全部旧实例，启动一个 V19 实例，等待迁移和健康检查通过后恢复服务。启动会校验 V17，创建可读的 `.v17-backup-…sqlite` 备份，再执行迁移及外键、完整性检查。事务失败会回滚，成功后重启不会重复迁移或备份。回滚时停止 V19 并还原 V17 备份。禁止 V17 与 V19 同时写同一 SQLite 文件。上文的个人访问令牌、MCP OAuth 和令牌交换路由使用这些新表。

将 `univer-workspace-cli` 升级到按 `owner/slug` 寻址仓库的版本前，先部署新版 Workspace 服务端。

### Space 列表与侧栏置顶

`GET /api/spaces` 仅返回当前用户拥有或已加入的 Space。每条 Space 响应以 `affiliation` 表示关系，取值为 `owner`、`member` 或 `none`，此列表只含前两种。`GET /api/spaces/starred` 返回当前仍可访问的已收藏 Space，最近收藏的排在最前。`GET /api/spaces/explore` 按收藏数、名称、ID 排列其他公开 Space，当前不分页。公开 URL、详情和查找接口的访问方式不变。

`GET /api/spaces/pins` 按保存的顺序返回 `{ customized, limit, spaces }`。可置顶自己拥有或已加入的 Space，以及已收藏的公开 Space。如果保存的置顶项都已失效，返回自己拥有或已加入的前八个 Space，并标记 `customized: false`。`PUT /api/spaces/pins` 接收 `{ spaceIds }`，用 1 至 12 个不重复且符合条件的 ID 原子替换列表。`DELETE` 恢复默认列表。两种写入均幂等，所有列表和置顶接口均需登录。

### 仓库收藏

同一 Space 下的仓库页面共用 GitHub 风格的导航和 Star / Unstar 收藏按钮。收藏绑定当前登录用户和 Space，刷新或重启后仍保留，访问权限独立控制。`GET`、`PUT` 和 `DELETE /api/spaces/{spaceId}/star` 均要求已登录且当前可访问相应 Space，并返回 `{ starred, starCount }`。写入幂等。面包屑导航从 `SpaceView.owner` 获取所有者 ID 和用户名。当前没有 Watch、Fork 或 GitHub 专有页签。[对照与验证记录](docs/proposals/repository-framework-star.md)

仓库的 Pull requests 使用现有 Worktree 流程。列表支持 Open/Closed 筛选和本地文本搜索。详情的 Overview 展示摘要与评审操作，Files changed 用于选择文档、查看草稿和对比改动。Wiki 和全局工作台沿用原有仪表盘，此流程不引入 GitHub PR 模型、评论、分支或检查。[参考、功能映射与验证](docs/proposals/repository-pull-requests-tab.md)

仓库 Settings 使用分组侧栏，名称和描述可分别保存。在 Danger Zone 更改公开读取权限需确认。协作者管理和回收站沿用既有权限和 API。[对照、差异与验证](docs/proposals/repository-settings-tab.md)

仓库 Pages 提供页面目录、复制和访问操作，默认页保存在当前浏览器。外观参考已发布的 Jekyll Primer 主题，仓库页头和页签顺序保持一致。[参考、差异与验证](docs/proposals/repository-pages-tab.md)

手动运行 `Deploy Workspace` 工作流时可选择已有稳定标签 `vX.Y.Z`。选择标签就签出该版本并以其标记容器镜像。留空则构建发起工作流的提交，并以 `sha-<commit>` 标记镜像。工作流将镜像交给所选环境部署。推送标签不会自动部署 Workspace，CLI 单独发布。

### 启动诊断

启动过程向标准输出同步写入逐行 JSON。每条记录包含 `event: "workspace.startup"`、`startupId`、`stage`、`status`（`started`、`completed` 或 `failed`）。诊断仅在阶段边界记录，沿用应用和 HTTP 日志的 Pino 配置及 `LOG_LEVEL`。开始和完成使用 `info`，失败使用 `error`。设为 `LOG_LEVEL=error` 时只显示失败，设为 `silent` 时关闭诊断。启动日志使用独立的同步输出，在阻塞操作或进程突然退出前按顺序写入。普通应用和 HTTP 日志异步输出，可能穿插其间。

每条记录还包括阶段耗时 `elapsedMs`、进程运行时间 `uptimeMs`、`memory`（Node 内存使用量，包括 `rss`、`heapUsed`、`heapTotal`、`external`、`arrayBuffers`）和 V8 `heapSizeLimit`。内存数值以字节计。记录不含配置值、文档内容或凭据。

诊断覆盖模块加载、配置读取、产品及协同数据库准备、应用创建和初始化、后台任务、WebSocket 设置及 HTTP 监听。迁移子阶段包括备份、读取创建信息、升级 Core/Worktree/History、校验和发布暂存副本。在 Grafana Loki 中查询 `{container="colla-workspace"} | json | event="workspace.startup"` 并选择相应 Pod。遇到 OOM 时，在同一 `startupId` 下查找最后一个只有 `started`、没有对应 `completed` 或 `failed` 的阶段。致命 OOM 可能来不及写入失败记录。内存数值是阶段边界的采样，无法反映峰值。SDK 执行阻塞工作时没有定时进度日志。

## 常用命令

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm db:ban-agent <username or user id>
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

所有资源页面都支持 `?view=immersive`。点击“进入沉浸视图”可隐藏 Workspace 顶栏和侧栏。按住 Ctrl / Command 点击、使用中键或右键菜单时，行为与普通浏览器链接一致。使用浏览器后退可返回上一页，直接打开分享链接时则取决于已有的浏览历史。

分享链接、刷新和登录跳转都会保留视图参数。分享弹窗提供“沉浸视图”复选框。如果 Blob 文件的 `node.name` 以 `.univer.html` 结尾，默认勾选，其他资源默认不勾选。这个选项只影响展示方式。资源权限和编辑工具保持原样，浏览器也不会进入原生全屏。

HTML 页面只显示错误提示，省略单独的加载、保存和同步状态。同一资源切换视图会保留当前编辑器；离开该资源时才执行原有的保存流程。

可以用内存示例数据预览实际资源页面，无需启动后端。

```bash
pnpm --filter @univerjs/univer-workspace exec vite --config test/vite.immersive.config.ts
```

打开 `http://127.0.0.1:5183/nodes/html` 或 `http://127.0.0.1:5183/nodes/text`。

## 匿名访问

节点开启链接分享，或所在空间开启公开读取后，持有节点链接的人即可查看内容。文件夹分享涵盖现有和将来的子项；公开空间可通过 URL 浏览。即使链接允许登录用户编辑，匿名访客和未被认领的 Agent 通过链接也只有查看权限，无法修改源内容、评论、上传、管理权限或访问 Worktree。HTML 文件与其绑定的来源 Sheet 分别鉴权。

匿名访客和已登录的只读用户可以在 Workspace 浏览器内试算绑定了 Sheet 的 HTML 页面。首次编辑某个来源时，该来源断开协同连接，公式在访客浏览器中重新计算。试算结果只在本地生效，所有者后续的修改也暂时不会同步到这里。刷新后恢复实时数据。宿主会在首次编辑时显示试算提示，页面可通过 `window.univerWorkspace.getWriteMode(unitId)` 判断能否将修改标记为已保存。原生 Office 预览对这些用户始终只读。Workspace Agent 等其他宿主需显式启用 HTML 试算，否则会拒绝写入。

生产部署中，允许匿名访问的 `/nodes/<nodeId>` 链接（含 `?view=immersive`）在聊天预览里会显示页面标题和简短描述。HTML 视图的标题省略 `.univer.html` 后缀。描述按 `Accept-Language` 返回中文或英文，缓存按该请求头区分，沿用应用页面的重新验证策略。配置 `PUBLIC_ORIGIN` 后才会生成绝对地址 `og:url`。私有、已删除或不存在的节点显示通用应用页面。Vite 开发服务器不生成此类预览，预览也不含图片。

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
