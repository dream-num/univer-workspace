## Why

`add-dsh-worktree-unit-tools` 让 Agent 能选择 Trunk 或 Worktree Unit、建立隔离 Draft 并取得 review handoff，但还不能读取结构化 Office 内容，也不能用 Facade API 修改 Draft。Workspace CLI 已通过 `@univer-cli/content-inspection`、`WorkspaceContentExecutionFeature` 与 worker-backed `WorkspaceContentRuntime` 交付这些 outcome；DSH Client Shell 应直接组合同一 Client Core runtime，而不是调用 CLI daemon、复制 Commander selectors 或另建内容执行器。

本 Change 以 Workspace commit `a01adf28bfdfbf098ecf66653d520d08ecac4117`、SDK `1.0.0-beta.2` 和 DeepSeek Harness `0.1.1-rc.2`（commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`）为冻结基线，补齐首版内容读取与 Draft authoring vertical slice。

## What Changes

- 注册两个 DSH-native tools：`workspace_content_inspect` 对 Trunk 或 Worktree 中的 Sheet、Doc、Slide 执行 published structured inspection query；`workspace_content_execute` 对 Draft Worktree 中的 Sheet、Doc、Slide、Base、Board 执行 inline Facade code，并返回未产生 mutation 或 confirmed commit 的结构化结果。
- 两个工具使用 closed parameter schemas、exact own-key runtime validation 与 value-only rendering。应用层固定每次 `512 KiB` canonical arguments、`256 KiB` code、`64` selectors/ranges、`100,000` requested worksheet cells、`8 MiB` canonical JSON 与 `64` 层 JSON/Slide nesting 上限；malformed A1 保留 inspection invalid，合法但 safe-area overflow 才走 limit，超限不截断成功值。inspection 对 published result 的七个 union 与递归 Slide children 做完整 closed-key 校验，DSH schema 只对无法递归表达的 children 使用如实的 `JsonValue` projection。execute 在 body 中先完成所有纯参数与 argument/code budget 校验，再解析 authenticated target、license、worker 与 runtime；authoritative Draft Worktree 是隔离边界，execute 不请求 DSH approval，Core 仍在 upload、mutation replacement 和 commit 前校验 execute value budget并拒绝 Trunk 或非 Draft 写入。DSH rc.2 在 tool body 前拥有的 Native/Code Mode argument records 保持原样，plugin 不复制 code、credential/license 或 rejected raw arguments，recognized outcome/error 只投影冻结的 validated public identity。
- Host 直接持有 Client Core runtime pool，以 package-relative worker entry 启动共享 `./worker` implementation；当前 authenticated grant、应用持有的 runtime development license 与 `UNIVER_LICENSE` override 只作为 Core resolver/worker init 使用，不进入 tool 参数、结果、Session content 或普通 Config。credential record 更新会关闭旧 pool，后续 operation 重新创建 owner，避免复用旧 Login Session。
- 修改 `workspace-client-core/content-runtime`，只给本 Change 可达的 Worktree/Trunk target resolution、content execution、runtime read/write、embedded-image externalization 与 changeset commit 追加向后兼容的 optional `AbortSignal`，并让 write operation 接受可选 execute-value byte budget。Core 在队列和每个可分割步骤前后检查 signal；上游 pool 不支持中断的 worker operation 仍被等待到收敛，取消后不开始下一步。多图 externalization 在已有 confirmed upload 后取消会抛结构化 partial-side-effect、invalidate lease 且不补偿删除/重传；in-flight upload 或 commit 抛 result-unknown。DSH rc.2 保留这些 tool-owned thrown errors，只有 caller abort 后 body 仍成功返回的 confirmed late success 转成 `ABORTED`；所有路径都不重放 Facade code。
- 扩展 shared Host lifecycle/error policy、real ToolRuntime tests、keyless Native/Code Mode transcript、worker package closure 与 isolated tarball smoke，覆盖 Draft execute 免审批、错误保密、caller/owner cancellation、commit uncertainty、credential rotation、worker start/close 和安装态真实 inspection/execute。

## Scope

**Intent:** 为 local Host-only `dsh-univer-work` 交付与 Workspace CLI outcome 对等的 structured content inspection 和 Draft Facade execution，并直接复用 Client Core worker-backed runtime。

**Non-Goals:** 不复制 Commander `inspect` selector syntax、`--script`、文本 presentation、daemon command/socket/RPC 或 CLI Session；不提供 arbitrary read-code tool、Trunk write、Office import/export、Blob/Asset/local filesystem、Typst、SVG、render/screenshot/lint、API/resource discovery、额外 Skills、Jobs、Web Client、Settings、Slot、Remote、sandbox/E2B/remote profile 或 package publication；不修改 Workspace Server、Browser、HTTP/Collaboration contract、数据库、Worktree lifecycle、CLI command/output 或 SDK baseline。

**Size Gate:** 一个新 capability、一个修改 capability、九个 coarse tasks；两个 tools 共用一个既有 runtime owner、一个 worker entry 和一个 lifecycle/error seam，可在一次 focused implementation session 内完成。

## Capabilities

### New Capabilities

- `dsh-univer-work/content-runtime-tools`: 定义 Host-only structured inspection 与 Draft Facade execution tools 的 schemas、Draft isolation boundary、runtime/license/credential composition、错误、取消、worker packaging 和安装态行为。

### Modified Capabilities

- `workspace-client-core/content-runtime`: 为现有 Worktree/Trunk target/source resolution、content execution、worker-backed read/write runtime、embedded-image pipeline 与 changeset commit 增加 optional `AbortSignal` 和取消后的 no-new-step/result-unknown 行为，并给 write operation 增加 pre-side-effect optional value budget，同时保持 Workspace CLI compatibility。

## Domain Alignment

- `apps/workspace/CONTEXT.md` 定义 Trunk、Worktree、Worktree Unit、Draft 与 Unit；inspection 可读取 Trunk 或 Worktree，execute 只修改 Draft Worktree Unit，不把 Worktree 称为 branch。
- `/Users/shenweimin/github.com/dsh-plugin/dsh-univer-work/CONTEXT.md` 与 `docs/adr/0001-co-locate-workspace-agent-clients.md` 定义 Workspace Agent Client、Workspace Client Core 与 Client Shell；本 Change 只通过 private package exports 复用 Core，不导入 `apps/cli/src/*`。
- `openspec/changes/extract-content-runtime-client-core/` 已确定 Core 拥有 worker、pool、同步、Facade execution、embedded-image externalization 与 commit；已批准 Changes 1–4 分别拥有 package、authentication、shared tool safety 与 Worktree/Unit identity，本 Change 扩展这些 owner，不建立第二套 runtime 或 credential seam。

No domain-model change.

## Impact

实现主要影响 `apps/dsh-univer-work/**`、`packages/client-core/src/{runtime-source,content-execution,content-runtime,embedded-images}.ts`、相关 tests、Client Core/package README、runtime license synchronization checks、worker build/package verification 与 isolated tarball smoke。`apps/dsh-univer-work` 显式消费 exact `@univer-cli/content-inspection@1.0.0-beta.2`；packed Host/worker 内联 reachable private Core 与 SDK code，复制 runtime-pool 所需 `worker-child.mjs`，从 `@univerjs-pro/engine-formula-rust` owner manifest 解析并声明/复制其 exact binding，关闭 checkout-local binding fallback，只把 Node built-ins、精确 DSH/Cordis 及已验证的 native runtime dependencies留作 declared externals。

Workspace CLI 继续省略 signal 并运行 content/inspect/daemon/package parity gates。Workspace Server/Browser、OpenAPI、数据库、deployment、CLI release workflow、public npm contracts 和 frozen SDK baseline 不变。
