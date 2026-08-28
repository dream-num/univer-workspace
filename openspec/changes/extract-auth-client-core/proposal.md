## Why

`univer-workspace/apps/cli/src/features/auth/session.ts` 同时实现 Workspace 认证协议与 CLI Client Shell 状态。browser approval、授权交换、Login Session 校验和远程 logout 可以被不同 Workspace Agent Client 复用；origin 配置、Session 文件、密码读取和命令呈现则属于 CLI。将两类职责分开，才能让后续客户端复用同一认证合同，同时保持现有 CLI 的凭据安全和用户行为。

本 Change 依赖 `extract-space-node-client-core`：它先建立 private `packages/client-core`，并提供认证协议所需的 Workspace HTTP transport 与错误语义。

## What Changes

- 在 `@univerjs/univer-workspace-client-core` 增加认证协议 exports，覆盖 username/password login、browser approval start/complete、`whoami`、remote `logout`、Login Session cookie 与 User 响应的严格解析。
- 认证协议接收明确的 Workspace origin 和调用所需凭据，返回可由 Client Shell 保存的结构化结果；它不读取配置或文件系统。
- 让 CLI 的 `WorkspaceAuth` 成为薄 Client Shell facade：继续拥有 origin 配置、Session 与 pending authorization 文件、原子写入、权限模式、串行 mutation、过期清理和 authenticated HTTP composition。
- 保留 `createAuthCommands` 的密码/TTY 交互、browser-login 指引、一次性 `--complete` 行为、JSON/text 输出和错误码。
- 将纯协议测试移到 Client Core，并保留 CLI Session、command contract、集成和安装 artifact 验证。
- 不产生 CLI breaking change。

## Scope

**Intent:** 把 Workspace 认证协议提取为第二条可复用的 Workspace Client Core vertical slice，并保持 Workspace CLI 的认证、凭据持久化和交付行为不变。

**Non-Goals:** 不改变 Workspace Server 认证 HTTP contract；不创建通用 identity framework 或 credential-store interface hierarchy；不把 CLI config、Session 文件格式、pending authorization 持久化、密码输入、Commander command 或输出呈现移入 Client Core；不创建 `apps/dsh-univer-work`；不接入 DSH Credentials；不修改 Space/Node 及后续 Worktree、runtime、Office 或 render 能力；不发布独立 npm package。

**Size Gate:** 一个新 capability，预计六个 coarse tasks，可在一次 focused implementation session 内完成；它只在 `extract-space-node-client-core` 完成后实施。

## Capabilities

### New Capabilities

- `workspace-client-core/auth`: 为 Node-hosted Workspace Agent Client 提供 storage-neutral 的 Workspace login、browser approval、Login Session identity 校验和 logout 协议，同时保持 Workspace CLI 的现有认证合同。

### Modified Capabilities

- 无。

## Domain Alignment

- `CONTEXT.md` 定义 Workspace Agent Client、Workspace Client Core 与 Client Shell；本 Change 以该边界拆分协议和 CLI 状态。
- `docs/adr/0001-co-locate-workspace-agent-clients.md` 决定两个客户端通过 `univer-workspace` monorepo 中的 private Client Core 复用代码，并排除 subprocess 与双仓复制。
- `~/github.com/dream-num/univer-workspace/apps/workspace/CONTEXT.md` 定义 User 与 Login Session；Client Core 返回这些既有概念，不引入另一套账号或 token 术语。
- `openspec/changes/extract-space-node-client-core/` 确定 private package、唯一 HTTP/error owner、CLI re-export shim 和实现仓库边界；本 Change 沿用这些决策。

No domain-model change.

## Impact

规划 artifacts 位于本仓库；实现只允许落在 `~/github.com/dream-num/univer-workspace`。主要影响目标仓库的 `packages/client-core/**`、`apps/cli/src/features/auth/session.ts`、`apps/cli/src/features/auth/command.ts` 的类型依赖、`apps/cli/src/program.ts`、认证与 CLI 集成测试、package exports 和职责文档。Workspace Server、HTTP contract、Browser、Session 文件格式、CLI command surface、Skills 与外部 SDK 不变。

实现阶段必须从包含目标仓库的工作上下文执行；不能依据本仓库 OpenSpec 默认 edit root 把产品代码写入 `dsh-univer-work`。
