# Univer Workspace

[English](README.md) | 简体中文

[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

Univer Workspace 是 Workspace Browser、Server、HTTP 合同、Workspace CLI 和私有
reference-provider package 的产品仓库。产品用于组织协同办公内容，并提供访问控制、分享、
回收站、历史记录和隔离的 Worktree 变更。

## 仓库结构

```text
apps/workspace                 Workspace Browser、Server 和 HTTP 合同
apps/cli                       面向 Agent 的 Workspace CLI
packages/reference-provider   Browser 私有 reference-provider policy
```

本仓库从内部 npm registry 使用版本匹配的 `@univer-cli/*`、`@univerjs/*` 和
`@univerjs-pro/*` package。Workspace 应用和 reference provider 都是 private workspace
package；只有 `univer-workspace-cli` 会打包并发布到内部 npm registry。

## 开发

环境要求：

- Node.js 24 或更高版本
- pnpm 10
- 内部 Univer npm registry 的访问权限

```bash
pnpm install
pnpm workspace:dev:server
pnpm workspace:dev:web
```

`workspace:dev:server` 会监听后端变更，并在 <http://127.0.0.1:3020> 提供服务。
如果 `apps/workspace/dist/public` 已存在，Server 也会提供最近一次构建的静态 Web 应用，
但不会重新构建 Web 源码或为其启用热更新。

`workspace:dev:web` 会在 <http://127.0.0.1:5173> 启动 Vite 开发服务器，启用热更新，
并将 API 与 WebSocket 请求代理到 3020 端口。Web 开发时请同时运行两个命令并访问 5173
端口；只进行后端开发或查看最近构建的 Web 应用时，可以直接使用 3020 端口。

配置、部署和数据迁移说明见 [Workspace 应用 README](apps/workspace/README.md)。

## 验证

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @univerjs/univer-workspace test:production-import
pnpm package:workspace-cli
```

所有与版本耦合的 Univer SDK package 必须使用同一个精确版本。升级时同时更新依赖和
lockfile：

```bash
pnpm update:sdk --sdk_version <exact-sdk-version>
```

## 交付

`univer-workspace-cli` 源码 manifest 的版本固定为 `0.0.0`；打包时会注入发布版本，且该版本
必须与 CLI runtime 一致。

- 推送属于 `main` 的稳定 `vX.Y.Z` tag，会将 `univer-workspace-cli@X.Y.Z` 发布到
  insider-npm，并使用 `latest` dist-tag。
- 可以在 `main` 手动运行 `Release CLI to insider-npm` workflow，并使用精确的
  `X.Y.Z-insider.<suffix>` 版本发布 `insiders` dist-tag。
- 开发包使用 `X.Y.Z-dev.<suffix>`，且只能在本地发布：

  ```bash
  pnpm release:cli:dev -- --version X.Y.Z-dev.<suffix>
  ```

`latest` 和 `insiders` 流程会在打包前验证所有版本耦合的 Univer 依赖是否使用同一个精确
SDK baseline。本地 `dev` 流程明确跳过该依赖图检查。三个流程都会构建、检查、安装并冒烟
测试实际 tarball，然后才允许发布。当前 workflow 只写入 insider-npm，不执行 Public Registry
Promotion。

Workspace 部署使用独立的手动 workflow。它可以构建一个已存在的稳定 `vX.Y.Z` release tag，
并将该 tag 用作 image tag；未指定 release tag 时，则构建 workflow dispatch 对应的 commit，
并使用 `sha-<commit>` image tag。构建完成后，image 会交给选定的部署环境。推送 tag 不会自动
部署 Server。

## Runtime 开发 License

Workspace Browser 和 CLI 包含经过批准、内容同步的 runtime 开发凭据，用于本地开发。该凭据
每 90 天轮换一次，并不是本仓库的软件许可证。Browser 构建可以通过
`VITE_UNIVER_LICENSE` 覆盖，CLI 可以通过 `UNIVER_LICENSE` 覆盖。

## License

[Apache-2.0](LICENSE)
