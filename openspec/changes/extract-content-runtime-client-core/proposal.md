## Why

`apps/cli` 当前通过 daemon 进程独占 Workspace headless runtime 的完整执行路径：worker 装配 Collaboration backend，runtime pool 管理复用，daemon 负责同步、只读执行、UnitData 导出、mutation capture、内嵌图片外置和 changeset commit。后续 Node-hosted Workspace Agent Client 需要同一能力，但 daemon socket、CLI Session 文件和进程信号属于 CLI Client Shell，不能成为共享 runtime 的调用合同。

`extract-runtime-target-client-core` 已规划 runtime target、Snapshot 与 reference adapter 的公共边界。本 Change 在该边界之上提取可由 CLI daemon 或未来 local DSH Client Shell 直接驱动的 content runtime owner，并继续用现有 CLI 验证执行与提交行为没有变化。

## What Changes

- 将 Workspace worker composition、Collaboration runtime pool owner、runtime acquisition、同步和关闭生命周期移入 private `@univerjs/univer-workspace-client-core`。
- 将只读 Facade execution、UnitData export、可写 execution 与 mutation commit workflow 移入 Client Core；写入继续只接受 Draft Worktree target。
- 将 embedded-image detection、deduplication、File API upload 与 mutation rewrite 移入 commit pipeline，并保留 upload failure 时的 BASE64 best-effort fallback。
- 让 worker credential 与 license 由 Client Shell 以明确的 runtime initialization dependency 提供；Client Core 不读取 CLI Config 或 Session 文件。
- 让 CLI daemon 只保留 socket/control、RPC payload 校验、Client Shell credential/license composition 与 shutdown signal adaptation；execute、inspect、exchange、screenshot 等调用方继续使用同一 daemon protocol。
- 迁移 runtime owner、execution、inspection/export、embedded image 与 commit tests，并保留 CLI command、daemon、端到端和实际 package artifact 验证。
- 不产生 CLI breaking change。

## Scope

**Intent:** 将 Workspace content runtime 的 worker、pool、只读与可写 execution、UnitData export 和 commit pipeline 提取到 Workspace Client Core，同时把 CLI daemon 缩减为 Client Shell transport 外壳。

**Non-Goals:** 不修改 Workspace 或 Collaboration Server contract；不改变 Facade program preparation、Worktree lifecycle 或 runtime target 语义；不提取 Office exchange、Typst、browser render、screenshot/lint 或 SVG workflow；不创建 `apps/dsh-univer-work`；不设计 DSH tools、Jobs 或 cancellation；不删除 CLI daemon command/socket；不改变 Session 文件、license 来源、daemon RPC method/payload、CLI command、JSON shape、错误码或 package-installed 行为；不发布独立 npm package。

**Size Gate:** 一个新 capability，预计七个 coarse tasks，可在一次 focused implementation session 内完成。直接依赖 `extract-runtime-target-client-core`；该 Change 已传递依赖 Changes 1–3。`extract-file-transfer-client-core` 与本 Change 只共享实施顺序，不是代码前置，因为 embedded image 走 Collaboration File API，不使用 Blob/Asset 本地文件能力。

## Capabilities

### New Capabilities

- `workspace-client-core/content-runtime`: 为 Node-hosted Workspace Agent Client 提供可复用的 Workspace headless runtime lifecycle、内容读取、UnitData export、Worktree execution 与可靠 commit pipeline。

### Modified Capabilities

- 无。

## Domain Alignment

- `CONTEXT.md` 定义 Workspace Agent Client、Workspace Client Core 与 Client Shell；本 Change 将内容能力和 runtime lifecycle 归入 core，将 daemon transport、credential persistence 与进程交付留在 CLI shell。
- `docs/adr/0001-co-locate-workspace-agent-clients.md` 决定两个 Agent clients 通过 `univer-workspace` monorepo 内的 private package exports 复用实现。
- `univer-workspace/apps/workspace/CONTEXT.md` 定义 Trunk、Worktree、Worktree Unit、Draft 与 Unit；只读操作可面向 Trunk 或 Worktree，写入仍只提交到 Draft Worktree。
- `openspec/changes/extract-runtime-target-client-core/` 提供本 Change 复用的 target、Snapshot adapter、reference scope/provider 与 worker runtime access seams。

No domain-model change.

## Impact

规划 artifacts 位于本仓库；实现只允许落在 `~/github.com/dream-num/univer-workspace`。主要影响目标仓库的 `packages/client-core/**`、`apps/cli/src/runtime/{daemon,worker}.ts`、`apps/cli/src/features/content/{execution,embedded-images,image-references}.ts`、`apps/cli/src/program.ts`、exchange/screenshot 的 runtime port 类型、对应测试、package exports/build graph、worker child packaging 与职责文档。

Workspace Server、Browser、HTTP/Collaboration contract、CLI daemon protocol、command surface、Session schema、Office/render runtime 和发布渠道不变。实现必须基于完成后的 `extract-runtime-target-client-core` public exports；不得在本规划仓库创建产品代码。
