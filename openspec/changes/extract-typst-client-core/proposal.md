## Why

`univer-workspace/apps/cli/src/features/typst` 同时拥有 Typst 编译、一次性 headless Doc materialization、Worktree-local Unit apply workflow 与 Commander 呈现。前七个 Changes 已为 private Workspace Client Core 建立 package、错误语义和 Worktree Unit create capability；Typst workflow 现在可以迁入同一个 owner，让不同 Node-hosted Workspace Agent Client 复用相同编译与 apply 行为，而无需复制确定性 materialization 和原生运行时交付规则。

## What Changes

- 在 `@univerjs/univer-workspace-client-core` 增加 Typst compile、headless Doc materialize 与 Worktree-local Unit apply exports。
- 将 `@univer-cli/doc-typst-facade` 编译装配、error diagnostic gate、确定性随机源、Doc runtime contract 校验、UnitData normalization 和 staged Doc create workflow 移入 Client Core。
- 让 `apps/cli` 通过 package exports 使用该 capability；Commander 参数校验、`--out`、`--diagnostics-out`、JSON/text 呈现和本地文件写入继续归 CLI Client Shell 所有。
- 将 Typst 核心行为测试迁入 Client Core，并保留 CLI command、built-entrypoint 与实际安装 artifact 验证。
- 保持 `@univerjs-pro/doc-typst-native-binding` 的平台选择和 CLI artifact runtime dependency 不变，并让 packaging 从新的真实 dependency owner 解析其版本。
- 不产生 CLI breaking change。

## Scope

**Intent:** 将 Typst-to-Doc compile、materialize 与 apply vertical slice 纳入 Workspace Client Core，并保持 Workspace CLI 的命令行为、确定性、diagnostics 和原生 package delivery 不变。

**Non-Goals:** 不修改 Typst Source Bundle schema、compiler 或 native binding；不改变 Doc Facade lowering、预览生成、diagnostic 内容或 warning/error policy；不迁移 Commander、CLI 输出文件写入、Session、daemon 或通用 content runtime；不提取 screenshot/lint 或 SVG；不创建 `apps/dsh-univer-work`；不发布独立 npm package；不增加并发调度、cancellation、缓存或新的 Unit create 语义。

**Size Gate:** 一个新 capability，预计六个 coarse tasks，可在一次 focused implementation session 内完成。直接代码前置为 `extract-space-node-client-core` 的 error exports 与 `extract-worktree-unit-client-core` 的 Worktree-local Unit create exports；`extract-auth-client-core` 是后者的传递前置，Changes 4–7 只是既定实施顺序的前置。

## Capabilities

### New Capabilities

- `workspace-client-core/typst`: 为 Node-hosted Workspace Agent Client 提供可复用的 Typst bundle 编译、确定性 Doc materialization 与 Worktree-local Unit apply workflow，并维持现有 Workspace CLI 行为和原生运行时交付合同。

### Modified Capabilities

- 无。

## Domain Alignment

- `CONTEXT.md` 定义 Workspace Agent Client、Workspace Client Core 与 Client Shell；本 Change 将 framework-neutral Typst workflow 迁入共享 core，将 Commander 与文件呈现保留在 CLI shell。
- `docs/adr/0001-co-locate-workspace-agent-clients.md` 决定两个 Agent clients 通过 `univer-workspace` monorepo 内的 private package exports 复用实现。
- `univer-workspace/apps/workspace/CONTEXT.md` 定义 Unit、Worktree Unit、Worktree-local Unit 与 Draft；Typst apply 继续创建一个 Doc 类型的 Worktree-local Unit。
- `openspec/changes/extract-space-node-client-core/` 与 `extract-worktree-unit-client-core/` 分别提供本 Change 直接复用的 Workspace error 与 Unit create capability；其余已规划 Changes 不提供 Typst 所需的直接代码 seam。

No domain-model change.

## Impact

规划 artifacts 位于本仓库；实现只允许落在 `~/github.com/dream-num/univer-workspace`。主要影响目标仓库的 `packages/client-core/**`、`apps/cli/src/features/typst/{compile,materialize,command}.ts`、`apps/cli/src/program.ts`、Typst tests、Client Core/CLI manifests 与 build graph，以及 CLI package artifact、verify 和 smoke scripts。

Workspace Server、Browser、HTTP/Collaboration contract、CLI command surface、Session、daemon protocol、Typst Source Bundle、SDK baseline、native platform matrix 和发布渠道不变。实现必须在 Changes 1–7 按顺序完成后复用其真实 public exports；不得修改目标仓库或在本规划仓库创建产品代码。
