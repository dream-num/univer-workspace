# 可选的服务观测组件

Workspace 自身负责输出 JSON 日志和采集 HTTP 请求指标。Prometheus 负责抓取并保存指标历史，
Grafana 查询 Prometheus 并展示仪表盘。部署环境负责收集和保存应用 JSON 日志。
三者是独立进程，可以部署在同一台机器或不同位置。本目录提供可选的 Compose 示例，
由部署方按需启动和管理。

| 部署方式 | 能力 |
| --- | --- |
| 只部署 Workspace | 提供产品功能、输出日志并采集 HTTP 请求指标 |
| Workspace + Prometheus | 保存指标历史，可使用 Prometheus 自带界面查询 |
| Workspace + Prometheus + Grafana | 在上述基础上展示仪表盘 |
| 接入已有监控平台 | 使用已有平台抓取 Workspace，并在已有 Grafana 中导入仪表盘 |

## Workspace 配置

- `/metrics` 默认关闭，`GET /metrics` 返回 404。
- 设置 `METRICS_TOKEN` 后启用抓取，通过 `Authorization: Bearer <token>` 认证；认证失败返回 401。
- 为指标抓取单独生成至少 32 个字符的随机令牌。
- `LOG_LEVEL` 默认 `info`。HTTP 日志按白名单记录 request ID、method、URL 路径部分、
  statusCode 和耗时。请求异常日志携带 request ID 和错误详情，由部署方配置访问权限与留存周期。

`/metrics` 是与产品服务共用端口的运维接口，其配置和使用方式由本文说明。远程抓取使用
令牌认证、受控网络和 HTTPS（可由反向代理终止 TLS）。Workspace 可独立启动并采集
进程内指标；进程重启后计数重新开始，Prometheus 负责保存跨重启的指标历史。

## 在本机运行示例

以下命令从仓库根目录执行，适用于 macOS Docker Desktop / OrbStack，默认抓取宿主机的
3020 端口。首次运行时生成本地令牌文件；已有文件由 `wx` 创建模式保护：

```bash
node --input-type=module <<'JS'
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
mkdirSync('observability/.secrets', { recursive: true, mode: 0o700 });
writeFileSync('observability/.secrets/metrics-token', randomBytes(32).toString('hex'), {
  flag: 'wx', mode: 0o644,
});
JS
```

`.secrets` 已加入 Git 忽略。宿主机的目录权限限制访问；文件以只读方式挂入 Prometheus，
需允许容器内运行 Prometheus 的用户读取。生产中使用部署平台的 Secret 管理与权限配置。

启动 Workspace，传入同一令牌。`HOST=0.0.0.0` 让宿主机服务可被容器访问，也会监听其他
网卡；仅在可信本地网络中使用，或用防火墙限制入口。

```bash
METRICS_TOKEN="$(cat observability/.secrets/metrics-token)" HOST=0.0.0.0 pnpm workspace:dev:server
```

另一终端启动监控组件：

```bash
docker compose -f observability/docker-compose.yml up -d
```

- Prometheus：<http://127.0.0.1:9090>，在 Targets 页面确认 `univer-workspace` 为 UP。
- Grafana：<http://127.0.0.1:3000>，首次登录为 `admin / admin`，按页面要求修改密码。
- 自动配置名为 `Prometheus` 的数据源，仪表盘名为 `Univer Workspace · RED 指标`。
- 先访问几次 Workspace 接口；抓取间隔为 15 秒，速率与分位数图需要积累多个采样点。
- 收到 401 时核对两侧抓取令牌；收到 404 时检查 `METRICS_TOKEN` 配置并重启 Workspace；
  连接失败时检查目标地址、端口与网络。

两个监控端口只绑定 `127.0.0.1`。停止组件使用：

```bash
docker compose -f observability/docker-compose.yml down
```

命名卷保留 Prometheus 历史与 Grafana 配置；`down -v` 会删除这些数据。
可通过 `METRICS_TOKEN_FILE` 指定另一个令牌文件路径；建议使用绝对路径。

## 部署到其他位置

用户可以将组件部署在同一台服务器、其他服务器或 Kubernetes，也可以复用已有实例。
必要连接关系只有：

```text
Prometheus → Workspace 的 /metrics（携带抓取令牌）
Grafana    → Prometheus 的查询地址
浏览器     → Grafana
```

1. 修改 `prometheus.yml` 的 `static_configs.targets` 为 **Prometheus 所在环境能够访问的**
   Workspace 地址；跨机器使用 `scheme: https` 并配置相应 TLS。`host.docker.internal:3020`
   用于此处的本地示例，其他部署环境使用各自可达的地址。
2. 在 Prometheus 中配置 `authorization.credentials_file`，将与 Workspace 相同的令牌
   作为只读 Secret 文件提供；YAML 中保存该文件的路径引用。
3. 修改 Grafana 数据源的 `url` 为 **Grafana 服务端能够访问的** Prometheus 地址。
   保持数据源 UID 与仪表盘引用一致。接入已有数据源时，也可把仪表盘中的 UID 改为其实际 UID。
4. 按所在平台设置网络、TLS、认证、持久卷和备份；公网入口和 Kubernetes 资源由部署方配置。

同一 Docker 网络可使用容器服务名；Linux 宿主机抓取需显式配置 host gateway，或改用可达的
宿主机地址。公网访问通过配置了 TLS 和访问控制的入口提供。

配置字段参考 [Prometheus 配置文档](https://prometheus.io/docs/prometheus/latest/configuration/configuration/)
和 [Grafana provisioning 文档](https://grafana.com/docs/grafana/latest/administration/provisioning/)。

## 当前采集范围

- HTTP：按 method、稳定路由模板、status_code 记录完成请求的耗时分布。
  SDK Endpoint 流量使用 Transport 提供的完整路由模板 `ctx.route?.path`；
  路由匹配前结束的请求和未知路径统一使用 `unmatched`。
  Express 使用 `req.route?.path`，例如 `/nodes/:id`；统计按 Router 内的模板归类，
  相同 method 和模板的请求汇总到同一组。
- 仪表盘：每秒请求数、P95 延迟、每秒 5xx 次数。
  5xx 面板单位为次/秒。

Express 和 Collaboration SDK 各自通过 HTTP 中间件计时，在响应 `finish` 时记录指标。
Express 请求的耗时从进入 Express 指标中间件开始；SDK 请求的耗时从进入 Transport
指标中间件开始。请求进入 SDK 时由 SDK 接管指标采集，每个请求记录一次。
