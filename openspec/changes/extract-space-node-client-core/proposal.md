## Why

`univer-workspace/apps/cli` 同时拥有 Commander Client Shell 与 Workspace 产品访问实现。未来的 `apps/dsh-univer-work` 需要复用后者，但 `univer-workspace-cli` 当前是 bin-only application，没有可供第二个 Workspace Agent Client 使用的 package exports。先提取 Space 与 Node 这一条完整 vertical slice，可以建立真实的 Workspace Client Core 边界，并用现有 CLI 验证重构没有改变用户行为。

## What Changes

- 在 `univer-workspace/packages/client-core` 建立 private workspace package `@univerjs/univer-workspace-client-core`，只提供仓库内部 public exports。
- 将 Workspace error/result-unknown、HTTP transport、Space/Node 模型、严格响应解析和 Space/Node workflow 移入该 package。
- 让 `apps/cli` 通过 package exports 使用这些能力；Commander command、认证 Session、配置、输出与发布外壳继续归 CLI 所有。
- 迁移核心行为测试，并保留 CLI command contract、端到端与实际 package artifact 验证。
- 更新 `univer-workspace` 的 package/应用职责文档，使新边界与仓库事实一致。
- 不产生 CLI breaking change。

## Scope

**Intent:** 建立第一个可复用的 Workspace Client Core vertical slice，并保持 Workspace CLI 的 Space/Node 能力与交付行为不变。

**Non-Goals:** 不提取认证协议或 Session 持久化；不提取 Worktree、Unit、Blob、Asset、daemon、runtime、Office、Typst、render、SVG 或 Skills；不创建 `apps/dsh-univer-work`；不支持 Browser consumer；不发布独立 npm package；不修改 Workspace Server HTTP contract；不顺带调整 CLI 命令、JSON shape、错误码或可靠性语义。

**Size Gate:** 一个新 capability，预计六个 coarse tasks，可在一次 focused implementation session 内完成。其余 CLI 能力按已确认的十个 Changes 顺序逐项提取。

## Capabilities

### New Capabilities

- `workspace-client-core/space-node`: 为 Node-hosted Workspace Agent Client 提供可复用的 Workspace HTTP、错误、Space/Node 模型与 workflow，同时维持现有 CLI 的外部行为和远程写入可靠性。

### Modified Capabilities

- 无。

## Domain Alignment

- `CONTEXT.md` 定义 Workspace Agent Client、Workspace Client Core 与 Client Shell；本 Change 使用这些术语划分共享能力和 CLI 交付边界。
- `docs/adr/0001-co-locate-workspace-agent-clients.md` 决定共享代码与两个客户端最终同处 `univer-workspace` monorepo，并拒绝 subprocess 与双仓复制。
- `univer-workspace/apps/workspace/CONTEXT.md` 定义 Univer Workspace、Space、Node、Resource 与 Trash；提取后的模型和 workflow 必须保持这些既有含义。

本 Change 不新增产品域术语。

## Impact

规划 artifact 位于本仓库；实现只允许落在 `~/github.com/dream-num/univer-workspace`。主要影响目标仓库的 `packages/client-core/**`、`apps/cli/src/{errors,transport,features/space,program}.ts`、相关测试、workspace manifests、build/package workflow，以及记录仓库职责的 `AGENTS.md`、README 和 `DREAMNUM.md`。Server、HTTP contract、Browser 与外部 SDK 不变。

实现阶段必须从包含目标仓库的工作上下文执行；不能依据本仓库 OpenSpec 默认 edit root 把产品代码写入 `dsh-univer-work`。
