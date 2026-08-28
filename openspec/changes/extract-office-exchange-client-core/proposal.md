## Why

`apps/cli` 当前独占 Office import/export workflow 与 `@univerjs-pro/exchange-node` 的 Node adapter。该实现把 Office 后缀和 Unit 类型校验、导入后的 Worktree-local Unit 创建、运行时 UnitData 导出以及 native binding 调用收在 CLI application 内，后续 Node-hosted Workspace Agent Client 无法通过 private Client Core 复用。

前六个 Changes 已规划 Workspace product workflow、runtime target 与 content runtime owner。本 Change 在这些边界上提取 Office exchange，并继续由现有 CLI 与真实安装包验证文件格式、Unit identity、原生 binding 和命令行为没有变化。

## What Changes

- 将 Office 文件格式推断、Unit 类型兼容校验、import/export options、结果校验与结构化结果移入 private `@univerjs/univer-workspace-client-core`。
- 将 `@univerjs-pro/exchange-node` 的 Node import/export adapter 及其 native binding 调用路径纳入 Client Core 的 Office exchange owner。
- import 继续通过共享 Worktree Unit owner 创建 Worktree-local Unit；export 继续通过共享 runtime target 与 content runtime export operation 读取选定 Worktree head 的 UnitData。
- 让 `apps/cli` 只保留 Commander 参数映射、文本/JSON呈现以及 daemon RPC adapter，并通过 package exports 使用 Office exchange。
- 保留 Office 文件后缀、显式类型、名称优先级、idempotency、返回 identity、Board 拒绝、UnitData identity 和输出格式兼容行为。
- 保留 CLI artifact 对 `@univerjs-pro/exchange-node-binding` 的外部运行时依赖、平台 native package 解析与安装 smoke 验证。
- 不产生 CLI breaking change。

## Scope

**Intent:** 将 Node-hosted Office import/export vertical slice 提取到 Workspace Client Core，并保持 Workspace CLI 的格式、Unit 校验、文件路径、native binding 和安装 artifact 行为不变。

**Non-Goals:** 不修改 Office SDK 或 native binding；不改变支持的输入/输出后缀、formula calculation options、Worktree-local Unit 创建或 runtime export 语义；不建立 filesystem provider、remote artifact store 或新的原子写协议；不提取 Typst、browser render、screenshot/lint、SVG、Skills 或 CLI command presentation；不创建 `apps/dsh-univer-work`；不发布独立 npm package。

**Size Gate:** 一个新 capability，预计六个 coarse tasks，可在一次 focused implementation session 内完成。直接代码依赖 `extract-worktree-unit-client-core`、`extract-runtime-target-client-core` 与 `extract-content-runtime-client-core`；Changes 1–2 是传递前置，`extract-file-transfer-client-core` 只属于既定实施顺序，不是 Office exchange 的代码前置。

## Capabilities

### New Capabilities

- `workspace-client-core/office-exchange`: 为 Node-hosted Workspace Agent Client 提供可复用的 Office import/export、格式与 Unit 类型校验、Worktree Unit/runtime 集成和 Node native exchange 装配。

### Modified Capabilities

- 无。

## Domain Alignment

- `CONTEXT.md` 定义 Workspace Agent Client、Workspace Client Core 与 Client Shell；本 Change 将 Office capability 归入 core，将 Commander、daemon transport 与 artifact delivery 留在 CLI shell。
- `docs/adr/0001-co-locate-workspace-agent-clients.md` 决定两个 Agent clients 通过 `univer-workspace` monorepo 内的 private package exports 复用实现。
- `univer-workspace/apps/workspace/CONTEXT.md` 定义 Resource、Unit、Worktree Unit 与 Worktree-local Unit；Office import 继续创建 Worktree-local Unit，export 继续读取一个 Worktree Unit 的 Draft head。
- `openspec/changes/extract-worktree-unit-client-core/`、`extract-runtime-target-client-core/` 与 `extract-content-runtime-client-core/` 提供本 Change 直接复用的 Unit create、target resolution 与 UnitData export seams。

No domain-model change.

## Impact

规划 artifacts 位于本仓库；实现只允许落在 `~/github.com/dream-num/univer-workspace`。主要影响目标仓库的 `packages/client-core/**`、`apps/cli/src/features/exchange/{exchange,command}.ts`、`apps/cli/src/program.ts`、exchange tests、Client Core/CLI manifests 与 build graph，以及 CLI package artifact、verify 和 smoke scripts。

Workspace Server、Browser、HTTP/Collaboration contract、CLI command surface、Session、daemon protocol、支持的 Office 格式、SDK baseline 和发布渠道不变。实现必须在直接依赖的 Changes 完成后复用其真实 public exports；不得修改目标仓库或在本规划仓库创建产品代码。
