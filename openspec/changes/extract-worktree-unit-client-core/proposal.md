## Why

`univer-workspace/apps/cli` 的 Worktree、Worktree Unit 与 review URL workflow 仍由 CLI application 持有。完成 Space/Node 与认证边界提取后，这些能力必须进入同一个 private Workspace Client Core，后续 Workspace Agent Client 才能复用完整的草稿管理入口，同时避免复制 Worktree 状态机、幂等重试和未知写结果确认逻辑。

## What Changes

- 将 Worktree/Worktree Unit 模型、严格响应解析、查询、创建、更新与 lifecycle workflow 提取到 `@univerjs/univer-workspace-client-core`。
- 将 Worktree Unit 的 list、add 与 Worktree-local create workflow，以及 review URL 选择与构造逻辑提取到 Client Core。
- 保留稳定 idempotency identity、lifecycle precondition、mutation read-back、result-unknown 和 result-mismatch 语义。
- 让 `apps/cli` 通过 package exports 使用提取后的能力；Commander 参数、输出、Session、配置与打开 URL 的交互仍归 Client Shell 所有。
- 迁移核心行为测试，并保留 CLI command contract、端到端与安装 artifact 验证。
- 不产生 CLI breaking change。

## Scope

**Intent:** 将 Worktree、Worktree Unit 与 review URL 这一条草稿管理 vertical slice 纳入 Workspace Client Core，并保持 Workspace CLI 行为与交付合同不变。

**Non-Goals:** 不提取 Blob、Asset、本地文件、runtime target、daemon、content runtime、Office、Typst、render、SVG 或 Skills；不创建 `apps/dsh-univer-work`；不修改 Workspace Server HTTP contract、Worktree 产品状态机或 Unit 数据模型；不发布独立 npm package；不调整 CLI 命令、JSON shape、错误码、Session 或文本输出。

**Size Gate:** 一个新 capability，预计六个 coarse tasks，可在一次 focused implementation session 内完成。本 Change 依赖 `extract-space-node-client-core` 提供 package、transport、error 与共享模型基线，并依赖 `extract-auth-client-core` 提供 Client Shell-neutral 的认证访问边界。

## Capabilities

### New Capabilities

- `workspace-client-core/worktree-unit`: 为 Node-hosted Workspace Agent Client 提供可复用的 Worktree lifecycle、Worktree Unit membership 与 review URL 能力，并维持现有 CLI 的可靠性和外部行为。

### Modified Capabilities

- 无。

## Domain Alignment

- `CONTEXT.md` 定义 Workspace Agent Client、Workspace Client Core 与 Client Shell；本 Change 只把产品 workflow 移入共享 core，交付与交互继续留在 CLI shell。
- `docs/adr/0001-co-locate-workspace-agent-clients.md` 决定两个客户端通过 `univer-workspace` monorepo 内的 private package exports 复用实现。
- `univer-workspace/apps/workspace/CONTEXT.md` 定义 Trunk、Worktree、User Worktree、Team Worktree、Worktree Unit、Worktree-local Unit、Draft 与 Activation；提取后必须保持这些含义和关系。

No domain-model change。

## Impact

规划 artifacts 位于本仓库；实现只允许落在 `~/github.com/dream-num/univer-workspace`。主要影响目标仓库的 `packages/client-core/**`、`apps/cli/src/features/{worktree,unit,open}/**`、`apps/cli/src/program.ts`、相关测试、package exports 与职责文档。Workspace Server、HTTP contract、Browser、CLI command surface 与发布渠道不变。

实现必须按顺序在前两个 Change 完成后执行，并从包含目标仓库的工作上下文运行；不得依据本仓库 OpenSpec 默认 edit root 创建产品实现。
