## Why

前序 Changes 已建立可安装的 `dsh-univer-work` Host shell、credential-backed authenticated connection 与 Space/Node tools，但 Agent 仍不能把本地文件上传为 Blob Resource，也不能把 Blob 或 Worktree Asset 下载到调用 Session 的工作目录。Workspace Client Core 已拥有这些传输 workflow、Blob 幂等恢复与原子文件写入；缺口位于 DSH Client Shell 的本地 execution-world、tool schema、approval 和 lifecycle 适配。

本 Change 基于 Workspace commit `a01adf28bfdfbf098ecf66653d520d08ecac4117`、SDK `1.0.0-beta.2` 和 DeepSeek Harness `0.1.1-rc.2`（commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`），交付与 Workspace CLI 对等的 Blob/Asset 本地文件传输结果。

## What Changes

- 新增 `workspace_blob_get`、`workspace_blob_upload`、`workspace_blob_download` 与 `workspace_asset_download` 四个 operation-specific DSH tools，使用 closed snake_case 参数和 closed canonical outputs。
- 所有模型提供的路径由 DSH `ctx.fs` 以调用 Agent Session cwd 解析并检查包含关系；只接受通过 rc.2 public `LocalFileSystem` constructor identity 正向证明、Host 可直接打开的 local execution world（含 base profile 的 in-process sandbox subclass），拒绝无 Session cwd、E2B/remote sandbox/filesystem 与 cwd 外路径。
- 两种 download 在 pre-execute 先解析调用 Session 的当前 DSH file-effect policy；confining provider 的 `read-only` 通过 secret-safe typed Harness error 直接拒绝且不询问。其后在任何 path resolve/interpretation 或 approval 前执行 `ctx.fs instanceof LocalFileSystem`：non-local 以 `workspace-local-filesystem-required` 零 ask/path/credential/Core/Host I/O 拒绝，只有 identity 通过后才把无 `sandboxMode` 解释为 bare LocalFS、执行 Session cwd 与当前 `workspace-write` policy root containment，再询问一次。approved body 从 immutable arguments 重做 current policy、constructor identity 与 path gate，仅 identity/containment 再次通过后调用 `processPath()`/credential/Client Core/Host I/O；不跨 approval 缓存 policy 或 path。
- Blob upload 和通过 preflight 的两种 download 经过 DSH `tools/pre-execute` approval；Blob get 保持只读。下载继续默认拒绝覆盖，只有显式 `force: true` 才原子替换，不增加 sandbox escalation 参数或第二次 approval。
- 为 Workspace Client Core 的 Blob/Asset 顶层操作、Blob 恢复请求、source stream 与 download stream/commit 追加向后兼容的 optional `AbortSignal`；取消与已 dispatch Blob write 相撞时，立即以 idempotency key、public upload intent 和已知 Upload Session identity 封装 `workspace-result-unknown`，并停止后续 status/read-back/retry，同时保留其余幂等、exact-byte、cookie isolation 与原子写入语义。
- 复用前序 Change 的 authenticated resolver、Host owner、closed-tool helper 与 secret-safe Workspace error adapter；tarball artifact 内联 reachable private Core，并以真实 ToolRuntime/local filesystem smoke 验证传输和 dispose。
- 不修改 Workspace Server、HTTP contract、Workspace CLI command/output 或现有文件传输结果。

## Scope

**Intent:** 让 local Host-only `dsh-univer-work` Agent 通过 DSH-native tools 安全上传 Blob，并在调用 Session cwd 内获取 Blob metadata、下载 Blob 或 Worktree Asset。

**Non-Goals:** 不支持 E2B、remote sandbox/filesystem、Browser filesystem 或通用二进制 artifact 搬运；不接受 inline/base64/attachment bytes；不实现 Office import/export、embedded-image upload、content runtime、render/screenshot、Typst、SVG、API/resource discovery、Skills、Jobs 或 Web Client；不新增 filesystem abstraction、sandbox controller、binary write provider、transfer service、sandbox escalation 参数、CLI subprocess、CLI Session/config/Commander 依赖、Server endpoint、hash/resume 能力或自动重放已结算的失败。

**Size Gate:** 一个新 capability、一个 modified capability、七个 coarse tasks，可在一次 focused implementation session 内完成。四个 tools 共享既有 Client Core vertical slice 和前序 DSH shell helpers，不引入预留接口或依赖。

## Capabilities

### New Capabilities

- `dsh-univer-work/file-transfer-tools`: 定义 Host-only local DSH Blob/Asset tools、Session-cwd 路径限制、approval、errors、cancellation、lifecycle 与安装态行为。

### Modified Capabilities

- `workspace-client-core/file-transfer`: 让现有 Blob/Asset 和本地 Node 文件传输接受 optional `AbortSignal`，同时保持 CLI 调用和已验证的恢复、校验与原子提交行为。

## Domain Alignment

- `apps/workspace/CONTEXT.md` 继续定义 Node、Resource、Blob Resource、Unit 与 Worktree；Blob upload 仍创建由 Node 拥有的 Blob Resource，Asset 仍是 Worktree Unit 内容引用的字节，不新增产品实体。
- `/Users/shenweimin/github.com/dsh-plugin/dsh-univer-work/CONTEXT.md` 与 `docs/adr/0001-co-locate-workspace-agent-clients.md` 要求两个 Client Shell 只通过 private Workspace Client Core package exports 复用；本 Change 不导入 `apps/cli/src/*`。
- `openspec/changes/extract-file-transfer-client-core` 已把 local Node-hosted 文件传输归入 Workspace Client Core，并明确不支持 remote filesystem；本 Change 只把 DSH local execution-world path 转换放在 Client Shell。
- `add-dsh-univer-work-authentication` 和 `add-dsh-space-node-tools` 提供本 Change 复用的 credential resolver、Host lifecycle、closed schemas、approval 与 safe error 规则。

No domain-model change.

## Impact

实现主要影响 `apps/dsh-univer-work/**`、`packages/client-core/src/{blob,asset,files,errors}.ts`、相关 tests 与 package responsibility docs。`apps/dsh-univer-work` 增加精确版本的 DSH filesystem、sandbox 与 sandbox-policy public exports，以识别 local execution-world paths 并读取 mounted confining provider 的当前 Session policy；它们保持 exact external dependencies，不新增通用 adapter、controller、cross-approval state 或 runtime owner。

`apps/cli` 继续省略 optional signal，Command、Session、local path、structured output 与 packaged artifact 行为不变。Workspace Server/Browser、OpenAPI、数据库、Collaboration 数据、SDK baseline、CLI release workflow 和 deployment 不变。
