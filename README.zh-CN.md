<div align="center">

# Univer Workspace

**一个让人类与 AI Agent 共同创作、协作和审阅的开源 Office 工作空间。**

[Univer 文档](https://docs.univer.ai/) · [CLI 指南](apps/cli/README.md) · [Issues](https://github.com/dream-num/univer-workspace/issues)

[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24-339933?logo=node.js&logoColor=white)](package.json)
[![pnpm](https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white)](package.json)

[English](README.md) | 简体中文

</div>

Univer Workspace 是一个基于 [Univer SDK](https://docs.univer.ai/) 构建、可独立部署的知识管理与
团队协作产品。它将面向人类的 Browser、共享 Server 与面向 Agent 的 CLI 组合在一起，让人类和
AI Agent 能够共同处理 Sheet、Doc、Slide、Base 与 Board。

Agent 在隔离的 Worktree 中工作、验证修改，再把结果交给人类审阅；只有经过确认的内容才会合入
共享 trunk。

![Univer Workspace 中文团队空间，展示 Sheet、Board、Doc、Slide、Base 与文件夹示例](docs/images/univer-workspace-zh-CN.png)

## 为什么选择 Univer Workspace

| 面向人类                                     | 面向 Agent                                          | 面向运维                                    |
| -------------------------------------------- | --------------------------------------------------- | ------------------------------------------- |
| 使用个人与团队 Space 组织内容                | 通过 Univer Facade API 创建、修改丰富的 Office 内容 | 部署一套 Browser 与 Server 应用             |
| 共同编辑 Sheet、Doc、Slide、Base 与 Board    | 检查结构化数据、渲染截图并执行布局检查              | 自主管理产品数据、协同数据与 Blob 数据      |
| 通过角色与 Node 级权限控制分享和访问         | 离线发现版本匹配的 Skill 与 API                     | 接入密码、GitHub、Discord 或应用 OAuth 登录 |
| 使用最近访问、回收站、文件导入导出与审阅视图 | 多轮修改而不影响 trunk                              | 运行具备明确恢复边界、文档完备的 HTTP API   |

## 工作原理

```mermaid
flowchart LR
    Human([人类]) --> Browser[Workspace Browser]
    Agent([AI Agent]) --> CLI[Workspace CLI]
    Browser --> Server[Workspace Server]
    CLI --> Server
    Server --> Product[(产品数据)]
    Server --> Collaboration[(协同数据)]
    Server --> Blobs[(Blob 与 Asset 字节)]
```

Browser 是交互式编辑和审阅界面；CLI 为 Agent 提供加载、理解、修改、验证和渲染同一份内容的
结构化入口；Server 解析权威身份与权限、拥有 Workspace 产品 workflow，并组合 Univer
Collaboration SDK。

Worktree 将 Agent 编辑转化为边界清晰的审阅流程：

```text
创建 Worktree
→ Agent 编辑并验证隔离草稿
→ Ready
→ 人类在 Browser 中审阅
→ Merge 或 Reopen
→ trunk
```

在人类接受之前，中间修改不会进入共享内容。完整产品 workflow 见
[CLI 指南](apps/cli/README.md)。

## 快速开始

### 环境要求

- Node.js 24 或更高版本
- pnpm 10

安装依赖并准备应用配置：

```bash
pnpm install
cp apps/workspace/.env.example apps/workspace/.env
```

启动 Server：

```bash
pnpm workspace:dev:server
```

在另一个终端启动 Browser 开发服务器：

```bash
pnpm workspace:dev:web
```

打开 <http://127.0.0.1:5173>。Vite 提供热更新，并将 API 与 WebSocket 流量代理到
<http://127.0.0.1:3020> 的 Server。

当 `apps/workspace/dist/public` 存在时，Server 也可以在 3020 端口提供最近一次构建的 Browser。
产品 API 文档位于 <http://127.0.0.1:3020/api-docs> 和
<http://127.0.0.1:3020/openapi.yaml>。

配置、认证、存储、Docker 与数据库迁移的详细说明见
[Workspace 应用指南](apps/workspace/README.md)。

## 使用 Workspace CLI

安装面向 Agent 的 CLI：

```bash
npm install --global univer-workspace-cli@latest
```

先把 CLI 指向你自己的 Workspace 部署，再开始需要 Browser 确认的登录流程：

```bash
univer-workspace-cli config set workspace.origin <origin>
univer-workspace-cli login
```

用户确认命令输出的 URL 与验证码后，完成一次性交换：

```bash
univer-workspace-cli login --complete
```

安装包包含版本匹配的 Skill、结构化 JSON 输出、Facade API 发现、内容检查、渲染、Office
文件交换与 Worktree workflow。完整用法和登录合同见 [CLI 指南](apps/cli/README.md)。

## 仓库结构

```text
apps/workspace                 Workspace Browser、Server、HTTP contract 与部署应用
apps/cli                       面向 Agent 的远程 Workspace 自动化应用
packages/reference-provider   仅供 Browser 使用的私有 referenced-Unit policy
scripts                       SDK 版本与 CLI 本地发布工具
```

本仓库是产品的 composition root，不重新实现上游 SDK。Univer Runtime 拥有 Unit 模型、渲染、
Facade API 与 Office 内容能力；Univer Collaboration SDK 拥有 snapshot、revision、OT、实时协同与
Worktree 协议合同；Univer CLI SDK 拥有可复用的 headless runtime、执行、检查与渲染能力。

Workspace 拥有产品身份、Space、目录层级、ACL、分享、回收站、最近访问、Blob 存储策略、远程
workflow 与部署。reference-provider package 只是 Browser 的私有实现，不是第三个对外应用或 SDK。

## 架构原则

- **一个权威 Server。** 不把客户端提供的 User、Role、Resource、Unit、Worktree 或 revision
  当作权威信息。
- **分离存储边界。** 产品数据、协同状态与 Blob 字节各有明确所有者，并通过持久化、幂等的
  Operation 协调。
- **只使用已发布的 SDK 合同。** 仓库只消费 package 的公开 export，不依赖相邻源码 checkout。
- **一个精确 SDK baseline。** 所有版本耦合的 `@univer-cli/*`、`@univerjs/*` 与
  `@univerjs-pro/*` package 始终一起升级。
- **HTTP contract first。** OpenAPI 源文件、生成类型、Server route、Browser 与 CLI 必须描述
  同一行为。

修改这些边界前，请阅读[技术架构](apps/workspace/docs/architecture.md)、
[应用层设计](apps/workspace/docs/application-design.md)与[数据模型](apps/workspace/docs/data-model.md)。

## 开发与验证

开发过程中先运行最小相关检查；在宣称完整变更前，运行合适的仓库级验证：

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @univerjs/univer-workspace test:production-import
pnpm package:workspace-cli
```

修改 HTTP contract 时还需要运行：

```bash
pnpm --filter @univerjs/univer-workspace api:verify
```

升级 Univer SDK 时使用仓库脚本一次性更新所有版本耦合依赖与 lockfile，不要单独编辑 manifest：

```bash
pnpm update:sdk --sdk_version <exact-sdk-version>
```

## 交付模型

CLI 与 Workspace 部署基于同一份源码，但各自独立交付：

- `main` 上的稳定 `vX.Y.Z` tag 会发布 `univer-workspace-cli@X.Y.Z`，并使用 `latest`
  dist-tag。
- Workspace 使用独立的手动部署 workflow，构建已有稳定 tag，或把精确 commit 标记为
  `sha-<commit>`。推送 release tag 不会部署 Server。

稳定版 CLI 发布会检查整个仓库的 SDK baseline，并在发布前验证实际 package artifact。

## 文档

| 资源                                                                | 范围                                                     |
| ------------------------------------------------------------------- | -------------------------------------------------------- |
| [Univer Runtime 文档](https://docs.univer.ai/)                      | Browser Runtime、Preset、Plugin、Facade API 与编辑器能力 |
| [Workspace 应用指南](apps/workspace/README.md)                      | 配置、认证、存储、Docker 与升级                          |
| [Workspace CLI 指南](apps/cli/README.md)                            | 安装、登录、Agent workflow 与 package 合同               |
| [技术架构](apps/workspace/docs/architecture.md)                     | Browser、Server、存储、OpenAPI 与模块边界                |
| [HTTP contract](apps/workspace/contracts/http/README.md)            | 产品 API 源文件与生成流程                                |
| [Reference-provider package](packages/reference-provider/README.md) | Browser 私有 referenced-Unit policy                      |

## 参与贡献

欢迎提交 Issue 与 Pull Request。修改代码前，请阅读 [AGENTS.md](AGENTS.md) 和目标附近的 README
或设计文档；保留无关改动，不手工编辑生成文件，并完成受影响边界要求的验证。

## Runtime 开发 License

Browser 与 CLI 包含内容同步、经过批准的 runtime 开发凭据，用于本地开发。该凭据每 90 天轮换
一次，并不是本仓库的软件许可证。Browser 构建可以通过 `VITE_UNIVER_LICENSE` 覆盖，CLI 可以
通过 `UNIVER_LICENSE` 覆盖。

## License

Univer Workspace 使用 [Apache-2.0](LICENSE) 许可证。
