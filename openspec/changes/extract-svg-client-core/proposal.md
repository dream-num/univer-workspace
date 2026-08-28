## Why

`univer-workspace/apps/cli/src/features/svg` 仍同时拥有 SVG-to-Slide 编译、真实字体测量、估算降级、page program 包装与 Worktree apply workflow。前九个 Changes 已规划 Workspace Client Core、content execution 和 browser render owner；SVG 是最后一个仍留在 CLI application 的产品/runtime capability。

本 Change 将这条 vertical slice 移入同一个 private package，并以完整 CLI parity/package checkpoint 验收十个提取 Changes。checkpoint 只验证前序实现，不替代或补做前序 Change。

## What Changes

- 在 `@univerjs/univer-workspace-client-core` 增加 SVG compile、relative asset loading、Slide page wrapping、真实字体测量和确定性估算 exports。
- 真实测量继续惰性创建 Change 9 交付的 browser render runtime，并在成功、失败后关闭；估算模式继续不启动 browser，并返回现有 lint。
- SVG apply 继续通过 Change 6 的 Slide-only content execution operation 提交指定 Draft Worktree Unit，不复制 target、runtime 或 commit owner。
- 让 `apps/cli` 只保留 Commander 参数校验、license/environment/render-page path 装配、`--out` 文件写入、JSON/text presentation 和 diagnostics 输出。
- 迁移 SVG 核心行为测试，保留 CLI command、built-entrypoint 与真实安装 artifact 测试。
- 删除最后一批无调用方的 CLI-owned Client Core implementation 与迁移 shim，并执行覆盖十个切面的 CLI parity/package checkpoint。
- 不产生 CLI breaking change。

## Scope

**Intent:** 将 SVG compile、字体测量与 apply vertical slice 纳入 Workspace Client Core，并以完整 CLI 与安装包 checkpoint 结束 Client Core 提取阶段。

**Non-Goals:** 不修改 `@univer-cli/svg-facade` 的 SVG 支持、warning、lint、viewport 或生成代码；不改变真实测量与 `--estimate-text-size` 的选择规则；不改变 `compile-svg` 参数、输出、文件写入或 apply 语义；不增加 filesystem provider、compiler registry、browser pool、cache、并行或 cancellation contract；不实现前九个 Changes 中尚未完成的工作；不创建 `apps/dsh-univer-work`；不支持 Browser 或 remote filesystem consumer；不发布独立 npm package。

**Size Gate:** 一个新 capability，预计七个 coarse tasks，可在一次 focused implementation session 内完成。直接代码依赖 `extract-content-runtime-client-core` 与 `extract-screenshot-lint-client-core`；Changes 1–5 是传递前置，Changes 7–8 只是既定实施顺序中的 predecessors。

## Capabilities

### New Capabilities

- `workspace-client-core/svg`: 为 Node-hosted Workspace Agent Client 提供可复用的 SVG-to-Slide 编译、真实或估算字体测量与 Draft Worktree apply workflow，并固定 Workspace CLI 的完整提取 parity 和安装包交付合同。

### Modified Capabilities

- 无。

## Domain Alignment

- `CONTEXT.md` 定义 Workspace Agent Client、Workspace Client Core 与 Client Shell；本 Change 将 framework-neutral SVG workflow 归入 Core，将命令、环境和呈现留在 CLI shell。
- `docs/adr/0001-co-locate-workspace-agent-clients.md` 决定两个 Agent clients 通过 `univer-workspace` monorepo 内的 private package exports 复用实现。
- `univer-workspace/apps/workspace/CONTEXT.md` 定义 Unit、Worktree Unit 与 Draft；SVG apply 继续只修改一个 Draft 中的 Slide Worktree Unit。
- `openspec/changes/extract-content-runtime-client-core/` 与 `extract-screenshot-lint-client-core/` 提供本 Change 直接复用的 Slide execution 和 browser render/runtime delivery seams。

No domain-model change.

## Impact

规划 artifacts 位于本仓库；实现只允许落在 `~/github.com/dream-num/univer-workspace`。主要影响目标仓库的 `packages/client-core/**`、`apps/cli/src/features/svg/**`、`apps/cli/src/program.ts`、SVG tests、Client Core/CLI manifests 与职责文档，以及 CLI build、package artifact、verify 和 smoke scripts。

Workspace Server、Browser application、HTTP/Collaboration contract、CLI command surface、Session、daemon wire protocol、SDK baseline、render page位置、Puppeteer/native platform policy和发布渠道不变。实现必须在Changes 1–9按顺序完成后复用真实public exports；不得修改目标仓库或在本规划仓库创建产品代码。
