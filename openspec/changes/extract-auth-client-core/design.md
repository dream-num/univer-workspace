## Context

在目标基线 `univer-workspace@081a8e7f30141b3d1dbb4a2200db426b56bfdb28` 中，`apps/cli/src/features/auth/session.ts` 的 `WorkspaceAuth` 同时拥有三类职责：调用认证 HTTP endpoints 并解析响应、从 CLI Config 解析当前 origin、以 `0600` JSON 文件保存 Login Session 与 pending browser authorization。`createAuthCommands` 另行拥有 Commander、密码/TTY 输入和 Agent browser-login 指引。

`extract-space-node-client-core` 先把 `WorkspaceHttp`、errors 与首条业务 workflow 移到 private `packages/client-core`。本 Change 必须在它完成后实施，并复用唯一的 HTTP/error owner。`docs/adr/0001-co-locate-workspace-agent-clients.md` 已确定 Client Core 的仓库与 consumer 边界。

## Goals / Non-Goals

**Goals:**

- 将认证 endpoint、严格 response parsing、User/Login Session 结果和 browser approval 状态语义归入 Workspace Client Core。
- 保留 CLI 对 origin、Session 文件、pending authorization、authenticated HTTP 与交互呈现的所有权。
- 保持 CLI command、凭据安全、错误语义、跨进程 browser approval 和安装 artifact 行为不变。
- 为后续 Worktree/Unit 等 slices 保留稳定的 `configuredOrigin()` 与 `authenticatedHttp(role)` Client Shell composition seam。

**Non-Goals:**

- 不建立 credential provider framework、service container 或 Client Shell 基类。
- 不改变 Server endpoints、Cookie 形态、CLI Session schema、password login 兼容路径或 browser approval 人机流程。
- 不实现 DSH Credentials、DSH tools 或第二个 Client Shell。
- 不提前抽取后续业务与 runtime slices。

## Diagram design

```text
Workspace CLI commands
  ├── password / approval presentation
  └── WorkspaceAuth shell facade
        ├── Config + Session file + pending state
        ├── configuredOrigin() / authenticatedHttp(role)
        └── private Client Core auth protocol
              ├── start / complete browser approval
              ├── password login / whoami / logout
              └── WorkspaceHttp -> Workspace Server
```

## Decisions

### 1. 用 storage-neutral protocol functions 扩展现有 package

认证能力作为 `@univerjs/univer-workspace-client-core` 的 named exports 加入，不创建第二个 package。实现使用一组围绕 `WorkspaceHttp` 和显式 origin 的 protocol functions，返回普通结构化值；它不读取 Config，不持有文件路径，也不定义 credential-store interface。

这些 functions 覆盖 password login、browser approval start/complete、`whoami` 与 remote `logout`。共享 transport 继续执行 origin、redirect、Cookie 和 result-unknown 规则。当前没有需要独立 lifecycle 的第二种协议实现，因此不增加 factory 或 class hierarchy。

### 2. Core 返回 credential，Client Shell 决定 persistence

成功的 password login 或 browser approval completion 返回 normalized origin、User subject 和从 `Set-Cookie` 提取的 Login Session cookie。Client Core 只把该 cookie 作为调用结果交还给可信的 Node-hosted Client Shell，不写文件、不打印、不记录日志。

CLI Shell 在收到成功结果后继续以当前 Session schema 和原子 mutation 保存 cookie 与 subject，并清除同 origin 的 pending authorization。`readWorkspaceCookie()` 继续留在 `apps/cli`，因为 daemon worker 从 CLI Session 文件取 credential 是该 delivery 的持久化合同。

### 3. CLI 保留 authenticated access 与 configured origin seam

`apps/cli/src/features/auth/session.ts` 保留 `WorkspaceAuth` facade 及其 `configuredOrigin()`、`authenticatedHttp("client" | "worker")` 方法。前者从现有 Config 取得 origin；后者从现有 Session store 读取 cookie，再构造 Client Core 导出的 `WorkspaceHttp`。后续 slices 继续通过这两个窄方法获得当前 authenticated access，不导入 Session 文件实现，也不要求 Client Core 认识 CLI Config。

认证 command 继续依赖该 facade 的现有方法名。实现只把内部 HTTP exchanges 与 parsers 委派给 Client Core，避免同时改写 Commander adapters 和尚未提取的 feature composition。

### 4. Pending authorization 的持久化生命周期留在 CLI

Client Core 的 start operation 校验 device code、user code、expiry、interval 和 verification URL，返回包含绝对 `expiresAt` 的 pending value。complete operation 检查 expiry并只发送一次 exchange；HTTP 202 返回 `pending`，成功返回 credential，不轮询。

CLI facade 继续按 normalized origin 保存 pending value、跨 invocation 读取它、清理过期值，并在认证成功时以同一串行 mutation 用 Login Session 替换 pending state。这样既复用认证协议，也保留 CLI 当前的 restart-safe approval 行为。

### 5. Remote logout 与 local clear 保持两个 owner

Client Core 只负责在有 cookie 时发送一次 `/api/auth/logout` 请求。CLI facade 继续在 `finally` 中清除该 origin 的 Login Session 与 pending authorization；即使网络失败使远程结果未知，本地 credential 仍被删除，随后原样报告 `workspace-result-unknown`。

无本地 Session 时，CLI 仍直接完成本地清理且不制造远程请求。Client Core 不推断或修改任何 Client Shell store。

### 6. 协议测试与 Shell 测试按 owner 分开

password/browser approval/`whoami`/logout 的 endpoint、headers、Cookie extraction、strict response parsing、same-origin verification URL、pending/expiry 和 result-unknown cases 进入 Client Core tests。CLI tests 保留 Config、Session schema、`0600` mode、atomic write、corrupt-file error、跨进程 pending 恢复、local-clear-on-logout、password/TTY、help、JSON/text 与 built-entrypoint cases。

测试迁移保留现有输入和断言。CLI package smoke 继续证明 private Client Core 被 bundle 进自包含 artifact，安装后不需要 workspace checkout。

## Risks / Trade-offs

- **protocol result 暴露 Cookie 给错误的呈现层** -> credential result 只进入 CLI facade；command contract 测试确认 text/JSON 输出不含 cookie 或 device code。
- **拆分后成功 exchange 与文件保存之间仍可能失败** -> 保留当前先交换、后原子保存的顺序和错误行为；本 Change 不引入无法由 Server contract 支持的重放或恢复机制。
- **过期清理由两个模块重复判断** -> Core 负责拒绝过期 exchange，CLI 负责删除自己的 persisted pending value；测试固定两层责任和现有 error code。
- **后续 feature 继续依赖具体 `WorkspaceAuth`** -> 本 Change 保留两个窄方法以控制迁移面；后续 vertical slice 在迁入 Core 时改为接收惰性 HTTP/origin functions，不把整个 CLI facade 变成 shared API。
- **package exports 进入 CLI bundle 后残留 bare workspace import** -> 复用 Change 1 的 workspace build 顺序与 tarball smoke。

## Migration Plan

1. 在 Change 1 已建立的 Client Core 中新增 auth types、protocol functions、exports 和纯协议测试。
2. 缩减 CLI `WorkspaceAuth`，保留 Config、Session/pending store、authenticated access composition 与 mutation 语义，并委派 HTTP protocol。
3. 保留 `createAuthCommands` 的交互与输出，只调整导入和 facade typing。
4. 按 owner 拆分现有 `auth-transport` tests，并运行 CLI built-entrypoint auth flow。
5. 更新 package/responsibility documentation，执行 Client Core、CLI、package artifact 与仓库 compatibility gate。

本 Change 不迁移 Server 数据或 CLI Session schema。失败时可以回退 imports/exports 和 protocol delegation，恢复原 `WorkspaceAuth` 内部实现；磁盘上的 Session 文件无需转换。

## Open Questions

无。会影响认证行为、owner 边界或任务拆分的决定均已由前序 grilling 和本 Change 的依赖关系确定。
