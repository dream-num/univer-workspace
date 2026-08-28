## Context

目标基线 `univer-workspace@081a8e7f30141b3d1dbb4a2200db426b56bfdb28` 中，runtime target 与 source 规则分散在 `apps/cli/src/runtime/target.ts`、`features/content/source.ts`、`runtime/snapshot-server-adapter.ts`、`runtime/reference-{scope,load-context}.ts`、`runtime/referenced-unit-provider.ts` 和 `runtime/worker.ts`。这些模块没有 Commander 依赖，但直接依赖 CLI-owned errors/HTTP、Worktree response shape 和 daemon `JsonValue` type。

`extract-space-node-client-core`、`extract-auth-client-core` 与 `extract-worktree-unit-client-core` 依次建立 private package、唯一 HTTP/error owner、`WorkspaceAuth.authenticatedHttp(role)` composition seam 和共享 Worktree/Worktree Unit model。本 Change 在这些 prerequisites 之后实施，并遵守 `docs/adr/0001-co-locate-workspace-agent-clients.md`。Asset byte resolution 虽然目前与 runtime source 同文件，但不属于 target/Snapshot/reference contract。

## Goals / Non-Goals

**Goals:**

- 将 runtime target identity、解析、序列化、reuse key 与 scope-specific endpoint 规则变成 Client Shell-neutral exports。
- 将 Worktree/Trunk source resolution、严格 Snapshot reads 和 referenced Unit read-only policy移入同一 Client Core owner。
- 让 CLI daemon/worker/content/render callers 通过 package exports 使用这些规则，保持现有请求、revision 和错误语义。
- 给后续 content runtime、Office 和 render Changes 提供真实的共享 target/source seam。

**Non-Goals:**

- 不迁移 daemon server、runtime pool、worker process lifecycle、Session cookie lookup、Collaboration backend composition 或 Univer license。
- 不迁移 execute/inspect/commit、embedded image、Office、Typst、browser render、screenshot/lint 或 SVG workflow。
- 不将 Asset content 或本地文件能力塞进 runtime source，也不建立通用 source/provider framework。
- 不修改 Server protocol、reference policy、支持的 Unit types、target wire shape 或自动取消行为。

## Diagram design

```text
Workspace CLI Client Shell
  ├── Session -> authenticated WorkspaceHttp
  ├── daemon / runtime pool
  └── worker / Univer composition
                 │
                 ▼
private Workspace Client Core
  ├── runtime target + Worktree/Trunk source
  ├── Snapshot Server adapter
  └── reference scope/context/provider
                 │
                 ▼
Workspace Server /api + /universer-api
```

## Decisions

### 1. 扩展同一个 private Client Core package

所有 target/source/reference 实现加入 `@univerjs/univer-workspace-client-core` 的 manifest-declared public exports，不创建 runtime package、service container 或 provider registry。它们共享同一个 Workspace protocol、SDK baseline 和两个预期 consumers，没有独立发布或版本生命周期。

package 增加现有 Collaboration、Protocol、Core 与 Embed SDK 的必要依赖。CLI artifact 继续按当前 Vite/package workflow 内联或携带这些依赖；Client Core 仍是 private workspace package，不成为运行时安装前提。

### 2. target wire contract 不依赖 CLI daemon types

Client Core 公开 `WorkspaceRuntimeTarget`/scope、严格 parser、plain-JSON serializer、Snapshot prefix 与 runtime reuse key。parser 在 trust boundary 接受 `unknown` 或 package 既有 JSON value，而不是从 `@univer-cli/daemon` 导入 `JsonValue`；CLI daemon 可以直接把自己的 payload 交给 parser。

serializer 取代 execute、exchange 与 screenshot 中重复的 target object assembly，并保持现有字段和 scope shape。reuse key 继续忽略 revision，让同一 origin/scope/Unit/type 的 runtime 跨 revision 复用；daemon 每次 lease 仍负责 pull 和比对选定 revision。本 Change 不移动 acquire/synchronize 逻辑。

### 3. source 复用 authenticated HTTP 与 Worktree/Unit owner

runtime source 接收 Client Core 的 concrete `WorkspaceHttp`。CLI composition 继续在每个现有调用时点通过 `auth.authenticatedHttp("client")` 取得 client，再构造 source；core 不读取 CLI Config、Session 文件或 `WorkspaceAuth`。

Worktree target 和 reference host context 复用 Change 3 的 Worktree/Worktree Unit模型与读取能力，不保留第二套产品 model。提取后仍验证请求 Worktree、Unit membership、Unit type、Draft state 和 `draftHeadRevision`。Trunk type discovery继续按当前支持顺序探测，只把精确的 stored-type-mismatch 当作继续条件；其他错误立即返回。

`resolveImageAsset` 从 target/Snapshot source 中分离，继续由当前 Asset content owner提供并由 screenshot composition 注入。这样本 Change不依赖 file-transfer extraction，也不把二进制传输混入 runtime target contract。

### 4. Snapshot reader 与 SDK adapter 一起迁移，但保留各自错误合同

直接 source reads 和 `ISnapshotServerService` adapter 进入 Client Core，继续根据 host/reference scope 选择 Trunk 或 Worktree prefix，并严格校验 Snapshot、changeset、block、resources 和 protocol error envelope。base64 metadata 仍转换为 `Uint8Array`，选定 target 的 head revision 必须精确匹配。

两个现有读取路径的错误 code/message 并不完全相同。迁移不为消除少量解码重复而统一它们；只在可证明输出和错误完全相同的地方共享 helper。所有 write-side Snapshot methods 继续在发请求前返回 `workspace-reference-source-read-only`。

### 5. reference host policy 归 Core，worker 只保留运行时装配

Worktree host membership/revision validation、mapped Unit selection、v1 load-context encoding/decoding和 provider registration一起迁移。Trunk host 的 references全部读 Trunk；Worktree host 中 mapped Units读同一 Worktree，其他 Units回落 Trunk。load context继续绑定 Source Unit identity，防止一个 Unit 的 metadata 被用于另一个 Unit。

provider 继续只接受支持类型的 self ResourceRef，在调用 Snapshot loader 前处理已 aborted signal，并在返回后验证 Unit identity/type。本 Change不发明 loader 进行中的 cancellation，因为现有 Snapshot loader contract没有对应 signal seam。

CLI worker 仍负责从 Session 读取 cookie、构造 worker-role HTTP、解析 license、创建 Univer/Collaboration backend 和持有进程 lifecycle；它改为组合 Client Core 导出的 host-context loader、Snapshot adapter 与 provider registration。

### 6. 核心行为测试迁入 package，CLI compatibility gate 保留

`runtime-target.test.ts`、`content-source.test.ts` 中 target、source 和 reference target cases迁入 Client Core。补充当前直接覆盖不足的 reference context版本/Unit绑定、mapped fallback、provider identity/type、Snapshot strict decoding和所有 write method只读拒绝 cases。

CLI tests继续覆盖 daemon payload、program composition、execute/inspect、exchange、screenshot/lint 与 built entrypoint。真实 package verify/smoke证明新增 package代码进入自包含 artifact，worker child和 daemon启动时不依赖 monorepo source。

## Risks / Trade-offs

- **Change 3 的 Worktree exports 与计划假设不同** -> apply 首步读取实际 public exports；复用已落地 model/lookup，不创建平行 Worktree parser或 auth seam。
- **移动 decoder 时改变大小写不同的错误 code/message** -> 将现有 tests 随 owner迁移，保留两条读取路径各自的 exact error assertions，不顺带合并。
- **target serializer 改变 daemon payload** -> 对所有 supported scopes做 round-trip tests，并保留 execute/exchange/screenshot的现有 request assertions。
- **reference context跨 package 后 metadata key/version漂移** -> 保留 exact v1 key与 JSON shape，并增加旧 context round-trip和错误 cases。
- **新增 SDK imports遗漏于 package build或 CLI bundle** -> 使用精确 repository SDK baseline，运行 Client Core build、worker/daemon tests和实际 CLI tarball smoke。
- **从 mixed source移出 Asset resolution破坏 screenshot wiring** -> 只调整依赖注入，不修改 signed URL、bytes或 render workflow；保留现有 image Asset integration case。

## Migration Plan

1. 确认前三个 prerequisite Changes 的实际 package、HTTP、error、auth 和 Worktree/Unit exports。
2. 迁移 target contract、source resolution与对应测试，建立 package public exports。
3. 迁移 Snapshot adapter、reference context/scope/provider和 host-context loader，补齐直接行为测试。
4. 将 CLI daemon、worker、content、exchange与render callers切到 package exports；Asset resolution保留独立 owner。
5. 删除无调用方的 CLI-owned target/Snapshot/reference实现，更新职责文档和 package dependency/build graph。
6. 执行 Client Core、CLI、workspace与实际安装 artifact compatibility gate。

该 Change不迁移持久化数据或 Server state。失败时可以整体恢复 CLI imports与原 owner；target wire payload、Session文件和远程 Snapshot无需转换。

## Open Questions

无。会改变行为、owner边界或任务拆分的决定均已由既定 Change顺序和本轮确认确定。
