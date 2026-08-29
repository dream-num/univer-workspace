# Univer Observer

Univer Observer 是 Univer Workspace 的独立只读观测应用。它与 Workspace 位于同一仓库，但使用
独立进程、端口、GitHub OAuth App、Session Cookie、SQLite 文件和 Docker 镜像。

Observer 可以查看：

- Workspace User、Space、Resource、Node 和 Worktree 数量；
- Operation 执行中、等待中、到期积压、失败数量与错误码分布；
- Blob、Univer Asset、上传、隔离对象和待删除对象摘要；
- 按时间、Workspace User、Unit、Trunk/Worktree 筛选的 Changeset 活动；
- Changeset Count、Mutation Count、Mutation Size 三种频率与排行；
- Collaboration 查询、产品补全和服务端总耗时。

除了管理 Observer Member，所有功能只读。第一版不统计普通 HTTP 请求。

## 本地开发

要求 Node.js 24 或更高版本、pnpm 11，并先启动或初始化 Workspace 数据库。

```bash
pnpm install
cp apps/observer/.env.example apps/observer/.env
pnpm observer:dev:server
```

另一个终端启动 Browser：

```bash
pnpm observer:dev:web
```

打开 <http://127.0.0.1:5174>。Vite 把 `/api`、`/api-docs` 和 `/openapi.yaml` 代理到
<http://127.0.0.1:3030>。生产构建由 3030 端口同时提供静态页面与 API。

## GitHub OAuth 与首次初始化

Observer 必须使用独立于 Workspace 的 GitHub OAuth App。本地配置：

```text
Homepage URL: http://127.0.0.1:5174
Authorization callback URL: http://127.0.0.1:5174/api/auth/github/callback
```

生成一次性安装 Token：

```bash
openssl rand -hex 32
```

把以下值写入未提交的 `apps/observer/.env`：

```text
OBSERVER_GITHUB_CLIENT_ID=...
OBSERVER_GITHUB_CLIENT_SECRET=...
OBSERVER_GITHUB_CALLBACK_URL=http://127.0.0.1:5174/api/auth/github/callback
OBSERVER_SETUP_TOKEN=<生成的 64 位十六进制字符串>
```

首次打开 `/login`，输入安装 Token 并完成 GitHub OAuth。该 GitHub Numeric User ID 会原子成为首位
Observer Member。初始化完成后 Setup 永久关闭；环境中残留的 Token 不再具有权限。后续 Member 可按
GitHub Login 或 `github.com` 个人主页添加其他 Member，所有 Member 权限一致。

## 数据路径与只读约束

默认配置适合在仓库中开发：

```text
OBSERVER_DATABASE_FILE=.data/univer-observer.sqlite
WORKSPACE_DATABASE_FILE=../workspace/.data/univer-workspace.sqlite
COLLABORATION_DATABASE_FILE=../workspace/.data/univer-collaboration.sqlite
WORKSPACE_BLOB_DIRECTORY=../workspace/.data/univer-workspace-blobs
```

Observer SQLite 是需要备份的独立持久状态。Workspace Product 和 Collaboration SQLite 由 Observer
以 `readOnly`、`query_only` 模式打开；Observer 不创建、迁移、索引或修复它们。

Changeset 查询默认限制为 30 天、10 秒和单进程 2 个并发查询，可通过
`OBSERVER_QUERY_TIMEOUT_MS` 与 `OBSERVER_MAX_CONCURRENT_QUERIES` 调整。

## Docker

构建独立镜像：

```bash
docker build -f apps/observer/Dockerfile -t univer-observer .
```

以下示例把 Workspace 数据卷只读挂载给 Observer，并使用另一个卷保存 Observer 身份：

```bash
docker run --name univer-observer \
  -p 3030:3030 \
  -v univer-workspace-data:/data/workspace:ro \
  -v univer-observer-data:/app/univer-observer/.data \
  -e OBSERVER_GITHUB_CLIENT_ID \
  -e OBSERVER_GITHUB_CLIENT_SECRET \
  -e OBSERVER_GITHUB_CALLBACK_URL=https://observer.example.com/api/auth/github/callback \
  -e OBSERVER_SETUP_TOKEN \
  -e OBSERVER_SECURE_COOKIES=true \
  univer-observer
```

Observer 和 Workspace 可以运行在同一台服务器，但应使用不同容器、端口和健康检查。若迁移到另一台
机器，需要提供能读取最新 SQLite/WAL 状态的只读存储；不要复制一个不断变旧的数据库快照冒充实时
观测。

## 验证

```bash
pnpm --filter @univerjs/univer-observer typecheck
pnpm --filter @univerjs/univer-observer test
pnpm --filter @univerjs/univer-observer build
pnpm --filter @univerjs/univer-observer api:verify
```

更多边界与语义见 [架构](docs/architecture.md) 和 [数据模型](docs/data-model.md)。
