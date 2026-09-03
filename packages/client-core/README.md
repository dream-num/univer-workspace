# @univerjs/univer-workspace-client-core

`@univerjs/univer-workspace-client-core` 是本仓库内部、供 Node-hosted Workspace Agent Client
复用的 Workspace 客户端能力。它是 private workspace package，不发布 npm package，也不供 Browser
直接消费。

## 职责

- 提供 Workspace HTTP transport、错误和 result-unknown 语义。
- 提供 storage-neutral 的 password login、browser approval、`whoami` 和 remote logout 协议。
- 提供 Space/Node 模型、严格响应解析和远程 workflow。
- 提供 Worktree lifecycle、Worktree Unit membership 与 review URL workflow。
- 提供 Blob/Asset 协议、bounded recovery，以及同进程 local Node filesystem 的原子文件传输。
- 提供 runtime target、Worktree/Trunk source resolution、Snapshot read adapter 与 referenced-Unit policy。
- 提供 Shell-neutral worker composition、content runtime pool、同步读取、UnitData export、Facade execution、
  embedded-image externalization 与 changeset commit workflow。
- 提供 Node-hosted Office import/export、格式与 Unit 类型校验、Worktree Unit/runtime 集成和默认 exchange adapter。
- 提供 Typst bundle 编译、确定性 Doc materialization，以及可选的 Worktree Unit apply workflow。
- 提供 render Unit 装配、browser screenshot capture、PNG 输出、PDF 打印、Slide layout lint，以及配套 render page 构建源。
- 提供本机 SVG/relative asset 编译、真实或估算字体测量、Slide page 包装与 Worktree apply workflow。
- 通过独立 worker subpath 交付共享 worker implementation；Client Shell 显式提供 packaged worker entry、
  credential 与 license resolver。
- 通过 package 根入口提供 named exports。

## 非职责

- 不读取 CLI 配置、Session 文件或 credential storage。
- 不拥有 Commander 命令、输出、Session、daemon socket/control、process signal 或 packaged worker entry 选择。
- 不拥有 browser binary install/probe/resolve 或 CLI render-page artifact copy。
- 不提供 Browser entry、认证凭据持久化或交互、发布流程或跨仓库 SDK 合同。
- 不适配 Browser、sandbox、E2B 或其他 remote filesystem path。

Node-hosted Client Shell 必须注入 Workspace origin、协议调用所需凭据或已认证 HTTP capability。
`apps/cli` 当前是第一个 consumer。CLI 注入 authenticated HTTP 与 configured origin，并继续负责
Commander、Session/config、输出与打开或打印 review URL 的交互。
