## Context

在目标基线 `univer-workspace@081a8e7f30141b3d1dbb4a2200db426b56bfdb28` 中，`apps/cli/src/features/worktree/{model,management}.ts` 拥有 Worktree 与 Worktree Unit 解析、查询、创建、更新、lifecycle precondition、稳定 idempotency key 和未知 transition 结果 read-back。`features/unit/membership.ts` 复用该模型和可靠性 helper；`features/open/open.ts` 同时读取 CLI 配置与 Worktree feature 来构造 review URL。

本 Change 排在 `extract-space-node-client-core` 与 `extract-auth-client-core` 之后：前者建立 package、error/transport 与 `WorkspaceUnitType` 基线，后者让 CLI `WorkspaceAuth` 保留 `configuredOrigin()` 与 `authenticatedHttp(role)` 两个窄 composition methods。`docs/adr/0001-co-locate-workspace-agent-clients.md` 已确定这些实现归同一 monorepo 的 private Client Core。

## Goals / Non-Goals

**Goals:**

- 把 Worktree 状态机、Worktree Unit membership 与 review URL 业务规则变成 Commander/DSH-neutral package exports。
- 保留当前严格解析、identity mismatch、idempotency、read-back 和 result-unknown 行为。
- 让 CLI command 只适配参数、配置默认值和呈现，并保持安装 artifact 自包含。
- 让后续 runtime、Office、Typst 和 render Changes 直接引用 Client Core 的 Worktree Unit 类型和能力。

**Non-Goals:**

- 不修改 Server 状态机、HTTP contract、Worktree/Unit 产品模型或错误合同。
- 不把 CLI 配置、Session storage、Commander command 或输出 presenter 移入 Client Core。
- 不为未来 DSH tools 设计 tool schema、approval 或 job lifecycle。
- 不预建 Blob、runtime、Office 或 render 抽象。

## Diagram design

```text
Workspace CLI Client Shell
  ├── Commander / output
  └── lazy authenticated HTTP + origin providers
                     │
                     ▼
private Workspace Client Core
  ├── Worktree model + lifecycle
  ├── Worktree Unit membership
  └── review URL selection + construction
                     │
                     ▼
Workspace Server /api + Browser review route
```

## Decisions

### 1. 扩展同一个 Client Core capability owner

Worktree、Worktree Unit 与 review URL 进入既有 `packages/client-core`，并通过 package manifest 的 named exports 暴露。它们复用前序 Change 已迁移的 error、stable identity、HTTP transport 与 `WorkspaceUnitType`，不新增 package、service container 或第二套 transport。

这三个部分共同描述一条草稿管理路径：Worktree 提供 lifecycle owner，Unit membership 提供草稿内容集合，review URL 从该集合选择一个 Unit。拆成多个 package 会产生循环或只被一个 consumer 使用的边界。

### 2. 通过惰性 functions 接入 Change 2 的 CLI composition seam

Worktree 与 Unit workflow 接收惰性的 `() => Promise<WorkspaceHttp>` function；CLI composition 将 `auth.authenticatedHttp("client")` 适配到该 function。review URL workflow 另接收惰性的 origin function，CLI 以 `auth.configuredOrigin()` 提供默认 viewer base URL。

Client Core 不导入 `WorkspaceAuth`，也不读取 CLI Session 文件、origin 配置或登录交互。`--viewer-url` 仍作为可选调用输入覆盖惰性 origin；core 负责决定覆盖或默认来源后验证、选择 Unit 和构造 URL。当前只有这两项窄依赖，不增加 auth interface、factory hierarchy 或 service container。

### 3. 原样迁移 Worktree lifecycle 与可靠性算法

Worktree create 继续在未知远程结果时使用同一 idempotency identity 重试。merge 与 discard 继续使用由 action 和 Worktree ID 派生的稳定 key；所有 lifecycle action 继续先读取当前 state、校验允许的 transition、验证返回 state，并在未知结果时 read back。

本 Change 不把 update 改造成自动重试，也不扩大 ready/reopen 的 idempotency 行为。现有操作没有对应可靠性保证时，提取不顺带发明一个。

### 4. Unit membership 保持请求身份与返回身份绑定

Unit add 继续以 Worktree ID 与 Resource ID 派生稳定 identity；Worktree-local create 继续跨重试保留一次生成或调用方提供的 idempotency key。解析结果必须绑定请求的 Worktree，并验证 trunk-backed Unit 没有 target、Worktree-local Unit 的 type/name/Space/parent 与请求一致。

Worktree-local `initialData` 只参与请求重试，不进入公开 error detail；继续使用当前 `publicIdentity`，避免把潜在的大型内容写入错误输出。

### 5. review URL 核心规则与 shell 默认值分离

Client Core 负责从显式 `viewerBaseUrl` 覆盖或 Client Shell 提供的惰性 origin 中选择 base URL，并执行 HTTP(S) URL 校验、Worktree identity 检查、Unit membership/selection、`/worktrees` 路径以及 `worktree`、`unit`、`view=agent` 参数。Client Shell 只提供配置读取 function，不把 Config 或 Session 暴露给 core。

校验顺序保持不变：先拒绝无效 base URL，再读取 Worktree；未显式选择 Unit 时只允许恰好一个 Unit。core 返回结构化数据，不打开浏览器或写 stdout。

### 6. 权威实现与行为测试迁入 package，CLI adapters 留在应用

`features/worktree/{model,management}.ts`、`features/unit/membership.ts` 与 review URL 规则的权威实现及 application-feature 测试迁入 Client Core。Worktree、Unit 和 open Commander command 继续留在 `apps/cli`，并直接消费 package exports。

后续 CLI features 对 `WorkspaceUnit` 或 `WorkspaceUnitFeature` 的类型引用改为 package exports；不复制类型定义。Command contract、program composition、端到端和 package smoke 测试继续属于 CLI。

## Risks / Trade-offs

- **前序 auth seam 与本 Change 假定不一致** -> apply 必须按顺序执行，并直接复用 Change 2 已落地的 authenticated HTTP/origin export，不新增平行接口。
- **迁移 lifecycle 时改变请求或校验顺序** -> 原有 application-feature cases 随 owner 迁移，并增加不允许 transition、返回 state mismatch 与 read-back 未确认的断言。
- **later features 仍从删除的 CLI model 路径导入** -> 在同一 Change 将 exchange、Typst 与相关测试的类型引用切到 package public exports；不移动它们的业务实现。
- **review URL 依赖整个 CLI facade** -> composition 只传入 `auth.configuredOrigin()` 的惰性 wrapper；Client Core 不导入 `WorkspaceAuth` 或 Config 类型。
- **CLI artifact 遗漏新增 exports** -> 复用 Change 1 的 workspace build/package 路径，并执行真实 tarball smoke。

## Migration Plan

1. 确认前两个 Changes 已完成并锁定 Client Core 的 public auth/transport exports。
2. 迁移 Worktree/Unit 模型、workflow 和行为测试，更新 package exports。
3. 迁移 review URL 规则；以惰性 origin function 接入 CLI configured origin，并保留 `--viewer-url` 覆盖。
4. 切换 CLI command/composition 及 later-feature 类型 imports，保留 Shell contract tests。
5. 执行 Client Core、CLI 与实际 package artifact compatibility gate。

该 Change 不迁移持久化数据、不修改 Server contract。失败时可整体回退 package exports 与 CLI imports，恢复原 application-owned implementation。

## Open Questions

无。会改变行为、实现路径或任务拆分的决定均已在 proposal 前确认。
