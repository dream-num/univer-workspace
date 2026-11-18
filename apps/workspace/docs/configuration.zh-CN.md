# Workspace 配置指南

[English](configuration.md) | 简体中文

首次在本地安装时，在仓库根目录运行 `cp apps/workspace/.env.example apps/workspace/.env`。修改该文件后重启 Workspace 服务。下表中的默认值指未设置变量时的行为。相对数据路径以服务进程的工作目录为准，使用仓库提供的启动命令时为 `apps/workspace`。

使用 Docker 时，将运行时配置写入部署专用的环境文件，创建容器时传入 `--env-file ./workspace.env`。镜像默认监听所有网络接口，并为 HTTPS 启用安全 Cookie。浏览器构建参数见本文最后一节。[Docker 部署说明](../README.zh-CN.md#docker)

## 部署组合

默认部署使用 **SQLite + 本地目录**（`DATABASE_PROVIDER=sqlite`、`BLOB_STORE=local`）。产品库、协同库和上传文件都保存在 `.data/` 下。

使用 **PostgreSQL + S3** 时，将以下配置一起传给服务，连接信息和桶名按实际部署填写。准备一个专用 PostgreSQL 17 数据库和一个已有的私有 S3 桶，并给服务配置访问两者的凭据。

```dotenv
DATABASE_PROVIDER=postgres
DATABASE_URL=postgresql://workspace:replace-me@db:5432/workspace
BLOB_STORE=s3
BLOB_S3_BUCKET=workspace-objects
BLOB_S3_REGION=us-east-1
BLOB_S3_PREFIX=workspace
```

已有 SQLite 和本地文件的部署，请按[存储迁移指南](storage-migration.zh-CN.md)停机切换。

## 数据库

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `DATABASE_PROVIDER` | `sqlite` | 可选 `sqlite` 或 `postgres`，**产品库和协同库一起切换**。PostgreSQL 需要配置 `BLOB_STORE=s3` 保存 Sheet 数据块。 |
| `DATABASE_FILE` | `.data/univer-workspace.sqlite` | SQLite 产品库文件，保存用户、空间、文件目录和权限。 |
| `COLLABORATION_DATABASE_FILE` | `.data/univer-collaboration.sqlite` | SQLite 协同库文件，保存文档编辑、Worktree、历史和评论数据。 |
| `DATABASE_URL` | 未设置 | 选择 `postgres` 时必填。填写专用数据库的 `postgres://` 或 `postgresql://` 连接地址。 |

Workspace 账号需要有权创建 `collaboration` schema，并在产品 schema（通常为 `public`）和 `collaboration` 中创建对象。首次启动会初始化两者。备份 PostgreSQL + S3 时，先停止写入，再保存完整的数据库备份及同一时点的 S3 对象。

## 文件存储

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `BLOB_STORE` | `local` | 选择 `local` 或 `s3`。 |
| `BLOB_DIRECTORY` | `.data/univer-workspace-blobs` | 保存本地文件内容的可写目录。 |
| `MAX_BLOB_BYTES` | `536870912`（512 MiB） | 单个 Blob 的大小上限，单位为字节。 |
| `BLOB_S3_BUCKET` | 未设置 | 使用 S3 时必填，填写已有私有桶的名称。 |
| `BLOB_S3_REGION` | AWS SDK 解析的区域 | 覆盖从 `AWS_REGION` 或 AWS 配置档案读取的区域。 |
| `BLOB_S3_PREFIX` | 空（桶根目录） | Workspace 对象的根前缀。文件沿用此前缀下的原对象键，协同 Sheet 数据块使用其下的 `sheet-blocks/` 子目录。 |
| `BLOB_S3_ENDPOINT` | 对应区域的 AWS 端点 | 使用 MinIO 等兼容服务时，填写其 S3 API 地址。 |
| `BLOB_S3_FORCE_PATH_STYLE` | `false` | 服务要求在 URL 路径中传递桶名时设为 `true`。 |
| `AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`、`AWS_SESSION_TOKEN` | AWS SDK 凭据链 | 可使用工作负载角色，也可提供访问密钥对。临时凭据还需提供会话令牌。 |

**MinIO**  需要填写 Workspace 服务端可访问的 S3 API 地址。下面的示例使用路径式寻址。

```dotenv
BLOB_S3_ENDPOINT=http://minio:9000
BLOB_S3_FORCE_PATH_STYLE=true
```

该身份需要对存储桶有 `s3:ListBucket` 权限，对 Workspace
对象有 `s3:GetObject`、`s3:PutObject`、`s3:DeleteObject` 和 `s3:AbortMultipartUpload` 权限。
可通过存储桶生命周期规则清理未完成的分片上传。如果启用了版本控制，还可以设置已删除对象的历史版本保留时间。

**Kubernetes** 部署时，在 Workspace 容器的 `env` 中设置数据库和 S3 环境变量，通过工作负载身份或 Secret 提供凭据，保留原数据 PVC。使用本仓库的 [Deploy Workspace 工作流](../../../.github/workflows/push.yml)时，
在发布前修改 `dream-num/helm-chart-private` 仓库 `deploy/colla-workspace/` 目录下目标环境的清单。

## 认证

### 密码、会话与邮箱验证码

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `PASSWORD_AUTH_ENABLED` | `true` | 设为 `false` 可关闭密码注册、登录和修改。须先配置邮箱、GitHub、Google 或 Discord 登录。已有会话持续到退出或到期。 |
| `SESSION_TTL_MS` | `604800000`（7 天） | 登录会话有效期，单位为毫秒。 |
| `SECURE_COOKIES` | 生产模式下为 `true`，其他情况为 `false` | HTTPS 部署使用安全 Cookie。本地通过明文 HTTP 测试生产镜像时设为 `false`。 |
| `EMAIL_AUTH_ENABLED` | 未配置邮件时关闭 | 配置邮件提供方、发件人或 SMTP 即可开启邮箱登录。显式设为 `false` 可关闭。 |
| `EMAIL_PROVIDER` | 有 SMTP 配置时为 `smtp`，仅开启邮箱登录时为 `console` | 通过邮件发码使用 `smtp`。本地测试可用 `console` 将验证码写入服务日志。 |
| `EMAIL_FROM`、`EMAIL_FROM_NAME` | `no-reply@localhost`，无显示名称 | 发件地址和可选的发件人名称。实际发信时使用已验证的发件地址。 |
| `EMAIL_SMTP_HOST`、`EMAIL_SMTP_PORT` | 主机未设置，端口 `587` | 使用 SMTP 时必须指定主机，端口按服务商要求填写。 |
| `EMAIL_SMTP_SECURE` | 端口 465 时为 `true`，其他端口为 `false` | 从建立连接起使用隐式 TLS。 |
| `EMAIL_SMTP_USER`、`EMAIL_SMTP_PASSWORD` | 均未设置 | 需要 SMTP 认证时成对填写，直接使用服务商给出的原值。 |

```dotenv
EMAIL_PROVIDER=smtp
EMAIL_FROM=no-reply@example.com
EMAIL_FROM_NAME=Univer Workspace
EMAIL_SMTP_HOST=email-smtp.us-east-1.amazonaws.com
EMAIL_SMTP_PORT=587
EMAIL_SMTP_USER=your-smtp-username
EMAIL_SMTP_PASSWORD=your-smtp-password
```

邮箱验证码十分钟内有效，最多允许输错五次。每个邮箱每分钟最多请求一次，每小时最多五次。设置 `TRUST_PROXY` 后，每个服务进程中，每个来源 IP 每小时最多请求 60 次、核对 120 次验证码。首次验证成功后创建账户。

使用 Amazon SES 时，选用与端点区域对应的 SMTP 凭据。若返回 `535`，核对 SMTP 用户名及其配套的 SMTP 密码。沙箱账户还需要验证收件地址。

### 第三方登录

每种登录方式都需要同时填写三个变量，并在服务商处登记完全一致的回调 URL。回调 URL 由浏览器访问的源地址（本地通常为 `http://127.0.0.1:5173`）与下表路径组成。

| 服务商 | 环境变量 | 默认值 | 回调路径 |
| --- | --- | --- | --- |
| GitHub | `GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET`、`GITHUB_CALLBACK_URL` | 均未设置 | `/api/auth/github/callback` |
| Google | `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`GOOGLE_CALLBACK_URL` | 均未设置 | `/api/auth/google/callback` |
| Discord | `DISCORD_CLIENT_ID`、`DISCORD_CLIENT_SECRET`、`DISCORD_CALLBACK_URL` | 均未设置 | `/api/auth/discord/callback` |

已登录的用户可在账户菜单关联第三方身份。同一邮箱分别使用 Google 和邮箱验证码登录时，未关联的身份会得到两个独立账户。

GitHub 的开发和生产环境各建一个 OAuth App。Google 选择 **Web application** 类型的 OAuth 客户端。Discord 在 Developer Portal 添加回调 URL。

```dotenv
GITHUB_CLIENT_ID=your-client-id
GITHUB_CLIENT_SECRET=your-client-secret
GITHUB_CALLBACK_URL=https://workspace.example.com/api/auth/github/callback
GITHUB_ALLOWED_ORGANIZATIONS=your-org
```

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `GITHUB_ALLOWED_ORGANIZATIONS` | 空（不限组织） | 用逗号分隔组织名称。用户通过 GitHub 登录或关联账户时必须是其中至少一个组织的有效成员。如要将浏览器登录限于这些成员，还需关闭密码等其他登录方式。 |
| `DISCORD_BOT_API_KEY` | 未设置（关闭） | 受信任的 Bot 调用 `POST /api/auth/discord/bot-login` 时通过 `x-api-key` 传入。两端服务器使用同一随机密钥，至少 32 个字符。 |
| `GITHUB_TOKEN` | 未设置 | 导入 Skill 时访问 GitHub API 的可选服务端令牌。GitHub 登录单独使用 OAuth 凭据。 |

## OAuth 客户端与 MCP

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `OAUTH_CLIENTS_JSON` | 无静态客户端 | 含 `clients` 数组的 JSON 对象。登记精确的回调地址；公开浏览器客户端使用 PKCE 并要求用户确认。只向可代表用户操作的受信任客户端授予 `session` 权限。 |
| `PUBLIC_ORIGIN` | 未设置 | 客户端可访问的 Workspace HTTP(S) 源地址，不含路径。启用 MCP OAuth 时必须填写，作为签发者地址。 |
| `MCP_RESOURCE_URLS` | 空（关闭 MCP OAuth） | 以逗号分隔的 MCP 服务地址。使用浏览器 Agents 时，列表须包含与 Workspace 同源的 `/mcp` 地址。 |
| `MCP_MAX_REGISTERED_CLIENTS` | `10000` | 动态客户端注册上限，达到后新注册请求返回 HTTP 503。 |
| `MCP_CIMD_ENABLED` | 随 MCP OAuth 开启 | 无法向外发起 HTTPS 请求时设为 `0`，关闭 HTTPS 客户端元数据发现。动态注册仍可用。 |
| `MCP_CIMD_EXEMPT_NETWORKS` | 空 | fake-IP 或 TUN 解析器的代理网段，以逗号分隔 CIDR。只可放行无法访问内网服务的代理网段。启动时会拒绝与回环或链路本地地址重叠的网段。 |

Workspace 与 MCP 同源部署，供浏览器 Agents 使用：

```dotenv
PUBLIC_ORIGIN=https://workspace.example.com
MCP_RESOURCE_URLS=https://workspace.example.com/mcp
```

将本地 Workspace Agent 注册为公开客户端：

```dotenv
OAUTH_CLIENTS_JSON={"clients":[{"clientId":"univer-workspace-harness","clientType":"public","requiresConsent":true,"redirectUris":["http://127.0.0.1:3101/auth/oauth/callback"],"scopes":["identity","session"]}]}
```

MCP 网关使用启用了 `tokenExchange: true` 的机密客户端，将令牌兑换为短期 Workspace 会话。连接另一端的配置见 [Workspace Agent 连接指南](../../agent/README.zh-CN.md#连接本地-workspace) 和 [MCP 网关指南](../../mcp/README.md)。

## 服务、反向代理与监控

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `HOST`、`PORT` | `127.0.0.1`、`3020`（Docker 镜像监听 `0.0.0.0`） | 服务监听地址和端口。 |
| `NODE_ENV` | 未设置（Docker 为 `production`） | 生产模式默认启用安全 Cookie。 |
| `TRUST_PROXY` | 未设置（使用 TCP 对端地址） | 设置受信任的反向代理跳数，或用逗号分隔的代理地址、子网，以便按客户端 IP 限流。设置后才按来源 IP 限制邮箱登录，客户端直连时设为 `0`。 |
| `AGENT_CREATE_LIMIT_PER_HOUR` | `5` | 每个服务进程中，每个来源 IP 每小时可创建的访客 Agent 数。设为 `0` 可关闭访客创建。 |
| `LOG_LEVEL` | `info` | 服务日志级别，排查问题时可设为 `debug`。 |
| `METRICS_TOKEN` | 未设置（`/metrics` 返回 404） | 设置至少 32 个字符的随机 Bearer 令牌后，Prometheus 可使用该令牌抓取指标。可用 `openssl rand -hex 32` 生成。 |
| `TRIAL_DEPLOYMENT` | `false` | 向已登录用户显示试用环境的数据保留提示。 |

以下示例适用于只能通过一层受信任反向代理访问的 HTTPS 部署。

```dotenv
PUBLIC_ORIGIN=https://workspace.example.com
TRUST_PROXY=1
SECURE_COOKIES=true
```

## 许可证、浏览器构建与本地开发

| 环境变量 | 默认值 | 设置位置与用途 |
| --- | --- | --- |
| `UNIVER_LICENSE`、`UNIVER_LICENSE_KEY` | 内置开发凭据 | 在服务运行时成对设置，用于协同服务和 Office 导入导出。 |
| `VITE_UNIVER_LICENSE` | 内置浏览器开发许可证 | 部署域名超出内置许可范围时，在**构建时**设置。Docker 构建支持同名构建参数。未经许可的浏览器域名访问协同接口会收到 HTTP 403（错误码 9018）。 |
| `VITE_UNIVER_WORKSPACE_HARNESS_ORIGIN` | 部署域名下未设置 | 在 Vite 构建时指定 Agent 应用地址。通过 `localhost` 或 `127.0.0.1` 的 4020 端口或协议默认端口访问时，浏览器默认使用同一主机的 3081 端口。 |
| `WORKSPACE_DEV_API_PORT`、`WORKSPACE_DEV_MCP_PORT` | `3020`、`3000` | 本地 API 或 MCP 网关使用其他端口时，在 Vite 进程环境中设置。 |

例如，本地 API 改用 4020 端口时，从仓库根目录启动两个进程，分别在两个终端运行以下命令。

```bash
PORT=4020 pnpm workspace:dev:server
WORKSPACE_DEV_API_PORT=4020 pnpm workspace:dev:web
```
