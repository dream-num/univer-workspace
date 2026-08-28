## Context

在目标基线 `univer-workspace@081a8e7f30141b3d1dbb4a2200db426b56bfdb28` 中，`apps/cli/src/transport/http.ts`、`errors.ts` 和 `features/space/{model,space}.ts` 已形成一条不依赖 Commander 的业务路径，但 `WorkspaceSpaceFeature` 直接依赖 CLI 的 `WorkspaceAuth`。其他尚未迁移的 CLI features 同时导入这些底层模块，所以直接删除原路径会把首个 Change 扩成全应用迁移。

目标仓库已有 `packages/reference-provider` 的 private workspace package 模式，支持 named exports、`types`/`development`/`default` 条件、独立 build 与测试。`docs/adr/0001-co-locate-workspace-agent-clients.md` 已确定共享代码最终归 `univer-workspace` monorepo。

## Goals / Non-Goals

**Goals:**

- 建立一个 Commander/DSH-neutral、Node-hosted 的 private Workspace Client Core package。
- 完整迁移 Space/Node vertical slice 的传输、模型、校验与可靠性语义。
- 让 CLI 使用 package exports，并保持源码测试、命令合同和安装 artifact 行为不变。
- 留下后续九个 vertical slices 可沿用的最小 package、测试和构建模式。

**Non-Goals:**

- 不建立 Browser SDK、外部 npm 合同或通用 client plugin framework。
- 不迁移 CLI Session storage、Commander、daemon、runtime 或其他业务 feature。
- 不修改 Server API、header、错误码、JSON shape 或自动恢复策略。
- 不为未来 capability 预建 interface、factory 或空目录。

## Diagram design

```text
Workspace CLI Client Shell
  ├── Commander / output / Session
  └── get authenticated HTTP
             │
             ▼
private Workspace Client Core
  ├── errors + HTTP transport
  └── Space/Node model + workflow
             │
             ▼
Workspace Server /api
```

## Decisions

### 1. 使用一个 private workspace package

新增 `packages/client-core`，package name 为 `@univerjs/univer-workspace-client-core`，保持 `private: true`，并只通过 manifest 声明的 named exports 暴露 API。manifest、TypeScript build 和测试沿用 `packages/reference-provider` 已验证的仓库模式；`apps/cli` 使用 `workspace:*` dependency。

选择单一 package，因为已确认的十个 Changes 共享相同两个 consumers、SDK baseline 和仓库生命周期。首个 Change 不拆 transport/model/feature packages，也不建立 npm SemVer。

### 2. 认证由 Client Shell 提供惰性 HTTP capability

Space/Node workflow 接收一个 `() => Promise<WorkspaceHttp>` 形式的最小惰性依赖，每次需要认证请求时取得当前 HTTP client。CLI composition 将现有 `auth.authenticatedHttp("client")` 适配到该函数。

这保留 Session 刷新和按调用读取当前认证状态的行为，又避免 shared package 导入 `WorkspaceAuth` 或 CLI 文件配置。当前只有一种调用形态，不增加 interface、factory hierarchy 或 service container。

### 3. 使用临时 re-export shim 控制首个迁移面

`errors.ts`、`transport/http.ts` 和 `features/space/model.ts` 仍被未迁移 feature 与测试引用。实现把权威代码移动到 Client Core，并在旧 CLI 路径保留只做 named re-export 的迁移 shim；Space/Node service 与 CLI composition 直接消费 package exports。

shim 不复制实现，也不形成第二套合同。后续 Changes 逐步改写剩余 imports；最后一个 Client Core extraction Change 删除不再需要的 shim。与一次修改所有 CLI features 相比，这能保持本 Change 的 vertical-slice size gate。

### 4. 核心行为测试随 owner 迁移，Shell 测试留在 CLI

HTTP origin/redirect/response/error 测试以及 Space/Node pagination、filter、cycle、mutation/read-back/result-unknown 测试移到 Client Core package。Commander 参数、stdout/stderr、Session、端到端命令和 package-installed smoke 测试继续属于 `apps/cli`。

迁移测试时保留现有 case 的输入与断言，不以重写测试降低兼容要求。CLI 仍运行 command contract、集成测试和真实 tarball smoke，证明 package 边界没有改变交付行为。

### 5. CLI packaging 必须显式构建并内联 Client Core

CLI source manifest 声明对 Client Core 的 `workspace:*` 依赖。CLI package workflow 在 bundling 前通过 workspace dependency graph 构建 Client Core，不能读取遗留 `dist`。最终 `univer-workspace-cli` artifact 仍是自包含 bin package；验证必须证明 tarball 中没有无法解析的 workspace bare import，也不依赖 monorepo checkout。

不把 Client Core 作为 CLI artifact 的 external runtime dependency，因为它没有独立发布或安装合同。

### 6. 实现归目标仓库，规划暂留本仓库

本 Change 的 Markdown artifacts 暂存于 `dsh-univer-work`，代码、测试、manifest 和目标仓库文档只写入 `~/github.com/dream-num/univer-workspace`。当前 repo-local OpenSpec `actionContext` 不包含目标仓库，因此 apply 前必须把 Change 纳入以 `univer-workspace` 为 implementation root 的工作上下文；不得在本仓库创建镜像实现。

## Risks / Trade-offs

- **临时 shim 被误当成长期 API** -> README 标记迁移用途；新代码只从 package exports 导入，后续 Changes 删除 shim。
- **构建读取 stale package dist** -> package workflow 先构建 workspace dependency，并用 clean package build/tarball smoke 验证。
- **错误 class 出现双实例导致 `instanceof` 失效** -> shim 只 re-export package 中的唯一 class 定义，不保留本地副本。
- **抽象仍含 Node-only header/process 行为** -> package 明确限定 Node-hosted Workspace Agent Client；Browser 不在兼容范围。
- **移动测试后 CLI coverage 变薄** -> core package 验证业务语义，CLI 保留 command contract、端到端和安装态测试，两层都必须通过。

## Migration Plan

1. 建立 private Client Core package、exports、build 与 test 基线。
2. 移动 errors、HTTP transport 和 Space/Node model/workflow，添加最小认证 HTTP provider seam。
3. 在旧 CLI 底层路径保留 re-export shim，切换 Space command/composition 到 package exports。
4. 将 owner 已迁移的行为测试移入 package，并保留 CLI Shell 测试。
5. 更新 workspace dependency/build/package workflow 与职责文档，执行完整验证。

该 Change 不迁移数据、不修改 Server contract。失败时可整体回退 package/import/build 变更，恢复原 CLI owner；没有运行时状态迁移或双写阶段。

## Open Questions

无。会改变行为、实现路径或任务拆分的决定均已在 proposal 前确认。
