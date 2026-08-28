## Context

目标基线 `univer-workspace@081a8e7f30141b3d1dbb4a2200db426b56bfdb28` 中，`apps/cli/src/features/blob/transfer.ts` 同时实现 Blob Upload Session 状态机、严格 envelope parsing、Resource identity 校验与本地文件流；`features/asset/{content,download}.ts` 实现签名内容解析和下载；`src/files.ts` 实现两者共用的 Node 文件安全。

这些模块没有 Commander 依赖，但直接依赖 CLI 的 `WorkspaceAuth`、errors、HTTP transport 与 Space/Node model。`extract-space-node-client-core` 将后三者迁入 `packages/client-core`，并确定以惰性 authenticated HTTP provider 隔离 Client Shell credentials。本 Change 必须在该 Change 完成后实施。

`src/files.ts` 的剩余调用方只有待迁移的 Blob/Asset service 和 `features/content/source.ts`；Asset content resolver 也只被 Asset download 与 content source 使用。因此迁移时可以更新少量 package imports 后删除旧 owner，无需 re-export shim。共享实现继续遵守 `docs/adr/0001-co-locate-workspace-agent-clients.md` 的 monorepo 与 private package 决策。

## Goals / Non-Goals

**Goals:**

- 将 Blob/Asset 协议、恢复策略和 Node 文件安全作为一个可复用 vertical slice 归入 Workspace Client Core。
- 复用 Change 1 的唯一 errors、HTTP、Space/Node types 与 authenticated HTTP provider，不产生第二套协议或错误 identity。
- 保持 CLI command contract、文件覆盖规则、结果 shape、恢复上限和 package-installed 行为。
- 让后续 content/render Change 直接从 Client Core 使用 Asset content resolver 与 content metadata helpers。

**Non-Goals:**

- 不把 Node 文件系统包装成 filesystem provider，也不为 remote execution world 设计搬运协议。
- 不统一 CLI 中 Office、截图、Typst、SVG 等其他文件输出的不同安全语义。
- 不修改 Upload Session、Asset sign、Blob Resource 或 Server Operation contract。
- 不增加 cancellation、hash verification、resume-from-byte-offset 或新的自动重试行为。

## Diagram design

```text
Workspace CLI Client Shell
  ├── Commander / Session / presentation
  └── authenticated HTTP provider + local paths
                    │
                    ▼
private Workspace Client Core
  ├── Blob protocol + recovery
  ├── Asset signed-content resolver
  └── Node source/download safety
             ┌──────┴──────┐
             ▼             ▼
Workspace Server/CDN   local Node filesystem
```

## Decisions

### 1. 扩展现有 Client Core package，不新建 transfer package

Blob、Asset 与本地文件 helper 加入 private `@univerjs/univer-workspace-client-core` 的 manifest-declared named exports，并复用 Change 1 的 build、test 与 package dependency。它们与 HTTP transport、Workspace errors、Space/Node model 使用同一 SDK baseline 和 consumers，没有独立发布或版本生命周期。

不创建 `client-transfer` package、service registry 或 capability factory。package 内可以按 feature 分文件，但 consumer 只从声明的 public exports 导入，不跨 package 访问 `src` 或 `dist`。

### 2. 复用惰性 authenticated HTTP provider

Blob 与 Asset service 接收 Change 1 已确定的 `() => Promise<WorkspaceHttp>` 最小依赖。每个顶层操作在现有时点取得当前 HTTP client：Blob upload 在一次状态机内复用一个 client，Blob metadata/download 和 Asset download 保持各自现有认证读取时序。

这让 CLI composition 继续适配 `auth.authenticatedHttp("client")`，同时避免 Client Core 导入 `WorkspaceAuth`、Session 文件或未来 DSH Credentials。Worktree ID 只是 Asset endpoint identity，不需要依赖 Worktree feature extraction。

### 3. 保留具体 Node 文件实现

Client Core 的既定 consumer 是 Node-hosted Workspace Agent Client，首版 DSH 只支持 local profile。因此迁移现有 `node:fs`、`node:path` 与同 host path 语义，不增加只有一种实现的 filesystem interface。

source inspection 继续要求 regular file，并以首次 stat 的 byte size 约束流式读取。download target 继续在 destination 同目录创建 `0600` exclusive temp file，完整写入后 `fsync`；默认使用 hard-link exclusive commit 防止竞争覆盖，显式 force 使用 rename replacement。失败路径关闭 handle 并清理 temp file。

本 Change 不加强同尺寸 source mutation 检测。加入 mtime/inode/hash 会改变性能与错误语义，应由独立需求驱动。

### 4. Blob Upload Session 状态机整体迁移

reserve、PUT bytes、status refresh、complete、completed Resource read-back 与所有 envelope parser 作为一个 owner 迁移，继续使用最多三轮的既有 bounded recovery。reservation 始终复用相同 idempotency key 与 intent；PUT 或 complete 结果未知时先读取 Session，不重放已经观察为完成的写入。

Upload、Operation、Node 与 Blob Resource 的 identity、state、name、parent、size 和 kind 校验保持原有顺序与 error code。终态或无法确认时保留现有 `workspace-result-unknown`、terminal 与 mismatch detail，不在重构中增加 Server 能力或补偿操作。

### 5. Asset resolver 保持独立 public capability

签名 endpoint resolver 与文件 download workflow 一起迁移，但 resolver 继续作为 named export 供 `features/content/source.ts` 读取 Worktree image Asset。它验证 Univer service error envelope 与 HTTP(S) URL；实际 content request 继续走 HTTP transport 的 credential-free cross-origin path，拒绝 URL credentials 和 redirect。

Asset download 在调用 sign endpoint 前先准备 destination。默认目标已存在时直接失败，不产生远程请求；内容 metadata 或 stream 失败时不提交文件。content source 只改 import，不在本 Change 迁移其 target/runtime 逻辑。

### 6. 核心测试迁移，CLI Shell 与 artifact gate 保留

`files.test.ts` 的 source mutation、private permissions、race-safe commit、size mismatch、force replacement cases，以及 `application-features.test.ts` 的 Blob/Asset cases 移入 Client Core package。迁移时保留输入、断言、attempt counts、cookie isolation 和 error codes。

Commander mapping cases继续留在 `apps/cli/test/application-command-contracts.test.ts`。CLI integration、workspace package build、tarball install smoke 继续证明 bundle 内联 Client Core 且不依赖 monorepo checkout；不为本 Change新建测试框架或重复 end-to-end fixture。

## Risks / Trade-offs

- **Blob service 仍引用迁移前 Space model class** -> 只从 Change 1 package exports 导入 Node/Blob Resource parser 与 types，删除 CLI 内副本，避免 `instanceof` 或结构校验分叉。
- **Asset content resolver 的移动破坏后续 content source** -> 同一 Change 将该单一残留 caller 改为 package public import，并运行现有 image Asset case。
- **package bundling 留下 workspace bare import** -> 复用 Change 1 的 dependency-first build，运行实际 CLI package verify 与 tarball smoke。
- **文件重构意外放宽覆盖或清理规则** -> 核心测试保留 destination race、private mode、exact size 与 temp cleanup cases；CLI command test保留 `--force` 映射。
- **本地路径能力被误解为 remote FS support** -> package README 与 capability spec明确 Node-host/local boundary；本 Change不引入远程路径转换。

## Migration Plan

1. 在完成后的 Client Core package 中加入 file、Blob 与 Asset owner 及 public exports。
2. 迁移文件安全和 Blob/Asset feature tests，确认行为基线先在新 owner 通过。
3. 将 CLI composition、Blob/Asset Commander typing 和 content source imports 切换到 package exports。
4. 删除已无调用方的 `apps/cli/src/files.ts`、Blob transfer、Asset content/download 实现，保留 command adapters。
5. 更新 package职责和构建依赖，运行 Client Core、CLI、workspace 与安装 artifact 验证。

本 Change 不迁移持久化数据或 Server state。回退时恢复 CLI owner 与 imports；远程 Blob/Asset 数据和本地已完成文件不需要转换或双写。

## Open Questions

无。会改变行为、实现路径或任务拆分的决定均已在 proposal 前确认。
