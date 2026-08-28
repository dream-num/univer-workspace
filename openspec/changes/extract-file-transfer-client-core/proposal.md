## Why

`apps/cli` 当前同时拥有 Blob/Asset 产品传输协议与 Commander Client Shell。Blob 上传的恢复状态机、Asset 签名内容解析、严格响应校验和本地文件原子提交都将被未来的 local DSH Workspace Agent Client 复用，但这些实现只能从 CLI application 内部路径访问。

Change 1 建立 `packages/client-core` 并迁移 errors、HTTP transport 与 Space/Node 模型后，本 Change 将完整文件传输 vertical slice 交给 Workspace Client Core，同时用现有 CLI 验证传输可靠性和文件安全行为没有变化。

## What Changes

- 将 Blob metadata、upload、download 的协议、模型、严格解析与有界恢复 workflow 移入 private `@univerjs/univer-workspace-client-core`。
- 将 Asset sign/content 解析和 download workflow 移入 Client Core；跨 origin 内容请求继续不携带 Workspace Session cookie。
- 将 Blob/Asset 共用的 Node-hosted source inspection、稳定流式读取、私有临时文件和原子 download commit 移入 Client Core。
- 让 `apps/cli` 的 Blob/Asset Commander commands 与现有 content source 通过 package exports 使用这些能力，并删除已无调用方的 CLI 内部实现。
- 迁移核心行为测试，并保留 CLI command contract、端到端和实际 package artifact 验证。
- 不改变 CLI 命令、参数、JSON shape、错误码、文件覆盖规则、恢复语义或 Server HTTP contract。

## Scope

**Intent:** 让 Node-hosted Workspace Agent Client 复用 Blob/Asset 文件传输能力，并保持 Workspace CLI 的传输可靠性、文件安全和交付行为不变。

**Non-Goals:** 不提取 Office import/export、截图、Typst 或 SVG 文件输出；不迁移 embedded-image upload、content runtime 或 daemon；不建立通用 filesystem provider；不支持 Browser、sandbox、E2B 或 remote filesystem consumer；不修改 Blob/Asset Server contract；不创建 `apps/dsh-univer-work`；不发布独立 npm package。

**Size Gate:** 一个新 capability，预计六个 coarse tasks，可在一次 focused implementation session 内完成。实现依赖 `extract-space-node-client-core`；不依赖 auth 或 Worktree/Unit extraction，因为 Client Core 只消费已约定的 authenticated HTTP provider 和 Worktree identity。

## Capabilities

### New Capabilities

- `workspace-client-core/file-transfer`: 为 Node-hosted Workspace Agent Client 提供 Blob/Asset 传输、严格协议校验、有界远程恢复和本地原子文件读写，同时维持现有 Workspace CLI 外部行为。

### Modified Capabilities

- 无。

## Domain Alignment

- `CONTEXT.md` 定义 Workspace Agent Client、Workspace Client Core 与 Client Shell；本 Change 将产品传输和 Node 文件安全归入 Client Core，将 Commander 与呈现保留在 CLI Client Shell。
- `docs/adr/0001-co-locate-workspace-agent-clients.md` 要求共享实现位于 `univer-workspace` monorepo 的 private package，并拒绝 app-to-app 源码复用。
- `univer-workspace/apps/workspace/CONTEXT.md` 定义 Node、Resource、Worktree 与 Unit；Blob 继续作为 Resource kind，Asset 继续表示 Unit 内容引用的字节，不新增产品域实体。
- `openspec/changes/extract-space-node-client-core` 建立本 Change 复用的 package、errors、HTTP transport 与 Space/Node exports。

No domain-model change.

## Impact

规划 artifact 位于本仓库；实现只允许落在 `~/github.com/dream-num/univer-workspace`。主要影响目标仓库的 `packages/client-core/**`、`apps/cli/src/files.ts`、`apps/cli/src/features/{blob,asset}/**`、`apps/cli/src/features/content/source.ts` 的 package imports、相关测试、package exports 和 CLI package workflow。

Workspace Server、HTTP contract、Commander surface、Session persistence、daemon、Office/render runtime 与外部 SDK 不变。实现必须基于完成后的 `extract-space-node-client-core`，不能在本仓库创建产品代码。
