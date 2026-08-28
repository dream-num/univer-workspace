## Why

`apps/cli` 仍独占 Workspace runtime target、Snapshot source 和跨 Unit reference 的 Workspace-specific adapter。后续 content runtime、Office 与 render slices 都依赖这些规则；若它们继续留在 CLI application，第二种 Node-hosted Workspace Agent Client 只能复制 target identity、Worktree/Trunk 选择、严格 Snapshot 解码与只读 reference policy。

前三个 Changes 已确定 private Client Core、认证 HTTP seam 以及 Worktree/Worktree Unit 模型，并构成本 Change 的实施前置。本 Change 将 runtime 访问的共同底座移入同一个 package，并以现有 CLI 证明 target、Snapshot 和 reference 行为不变。

## What Changes

- 将 `WorkspaceRuntimeTarget`/scope 类型、严格解析、Snapshot prefix 和 revision-independent runtime key 移入 `@univerjs/univer-workspace-client-core`。
- 将 Worktree editable/readonly target、Trunk Unit type 探测、referenced Unit scope 选择与 Snapshot/block 读取移入 Client Core。
- 将 Workspace Snapshot Server adapter、reference load context、reference scope policy 和 referenced Unit provider registration 移入 Client Core。
- 让 CLI composition、daemon、worker、execute、exchange 与 render callers 只通过 package exports 使用这些能力；CLI Session、daemon socket、runtime pool 和 worker composition 仍归 Client Shell 所有。
- 迁移对应行为测试，并保留 CLI command、错误码、请求顺序、JSON shape 与安装 artifact 行为。
- 不产生 CLI breaking change。

## Scope

**Intent:** 将 Workspace runtime target 与只读 Snapshot/reference source vertical slice 纳入 Workspace Client Core，为后续多形态 Node-hosted clients 建立唯一的 Workspace runtime access contract。

**Non-Goals:** 不提取 daemon/runtime pool owner、worker lifecycle、content execute/inspect/commit、embedded image、Office exchange、Typst、browser render、screenshot/lint、SVG、Skills 或 `apps/dsh-univer-work`；不修改 Collaboration/Workspace Server contract；不支持 Browser client；不发布独立 npm package；不改变 CLI command、Session、daemon protocol、target serialization、错误码或 target/revision/reference 语义。Asset image resolution 与本地文件 helper 不属于本 Change。

**Size Gate:** 一个新 capability，预计七个 coarse tasks，可在一次 focused implementation session 内完成。实现依赖 `extract-space-node-client-core`、`extract-auth-client-core` 与 `extract-worktree-unit-client-core`；不依赖 `extract-file-transfer-client-core`，因为 Asset bytes 与本地文件不进入本 Change。

## Capabilities

### New Capabilities

- `workspace-client-core/runtime-target`: 为 Node-hosted Workspace Agent Client 提供可复用的 runtime target identity、Worktree/Trunk source resolution、Snapshot Server adapter 与只读 referenced Unit policy。

### Modified Capabilities

- 无。

## Domain Alignment

- `CONTEXT.md` 定义 Workspace Agent Client、Workspace Client Core 与 Client Shell；本 Change 将 Workspace-specific runtime access 规则移入共享 core，将 delivery lifecycle 留在 CLI shell。
- `docs/adr/0001-co-locate-workspace-agent-clients.md` 决定两个 Agent clients 通过 `univer-workspace` monorepo 内的 private package exports 复用实现。
- `univer-workspace/apps/workspace/CONTEXT.md` 定义 Trunk、Worktree、Worktree Unit、Worktree-local Unit、Draft 与 Unit；target 和 reference scope 继续使用这些既有含义。
- `openspec/changes/extract-space-node-client-core`、`extract-auth-client-core` 与 `extract-worktree-unit-client-core` 分别提供 package/HTTP/error、authenticated access 和 Worktree/Unit prerequisite seams。

No domain-model change.

## Impact

规划 artifacts 位于本仓库；实现只允许落在 `~/github.com/dream-num/univer-workspace`。主要影响目标仓库的 `packages/client-core/**`、`apps/cli/src/features/content/source.ts`、`apps/cli/src/runtime/{target,snapshot-server-adapter,reference-load-context,reference-scope,referenced-unit-provider,worker,daemon}.ts`、依赖 target types 的 exchange/render/content modules、相关测试、package exports 和职责文档。

Workspace Server、Browser、HTTP/Collaboration contract、CLI command surface、Session persistence、daemon protocol、runtime assets 与发布渠道不变。实现必须按前三个 prerequisite Changes 完成后的真实 exports 接入，不得在本仓库创建产品代码。
