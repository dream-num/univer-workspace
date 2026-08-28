## Why

`add-dsh-file-transfer-tools` 已建立 local DSH Session cwd、file-effect policy 与 Host-local path gate，`add-dsh-content-runtime-tools` 已建立 worker-backed UnitData runtime，但 Agent 仍不能把常见 Office 文件导入 Worktree-local Unit，也不能把 Worktree Unit head 导出成本地 Office 文件。Workspace CLI 已通过 `WorkspaceUnitExchangeFeature` 交付这两个 outcome；DSH Client Shell 应直接复用同一 Core workflow 和前序安全边界，不复制 Commander 或 Office conversion policy。

本 Change 以 Workspace commit `a01adf28bfdfbf098ecf66653d520d08ecac4117`、SDK `1.0.0-beta.2` 和 DeepSeek Harness `0.1.1-rc.2`（commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`）为冻结基线，补齐首版 Office exchange vertical slice。

## What Changes

- 注册 `workspace_office_import` 与 `workspace_office_export` 两个 DSH-native tools。import 从调用 Session cwd 读取 `.xls/.xlsx`、`.doc/.docx`、`.ppt/.pptx/.pptm/.ppsx/.ppsm/.potx`，创建一个 Worktree-local Sheet/Base、Doc 或 Slide Unit；export 把指定 Worktree Unit head 写为 `.xlsx`、`.docx` 或 `.pptx`。CSV、Board、导入覆盖既有 Unit 与其他格式保持不支持。
- 复用 Change 5 的 current file-effect policy、public `LocalFileSystem` identity、Session-cwd containment、path recheck 和一次 approval 顺序；import 复用 local source gate 与 signal-aware `openSource` stream，export 复用 download 的 policy/local/output preflight，并在 approved body 重新检查后才把 path 交给 Core。实际 stream bytes 始终受限，但本 Change 继承 Change 5 已接受的无 cross-process `openat`/directory-handle fence 上限，不声称检测同尺寸 replacement 或 symlink swap。两个工具都在询问前完成 closed pure argument 与 argument-budget 验证。
- 复用 Change 4 的 Worktree Unit create、Change 5 的 signal-aware source reader、Change 6 的 target/runtime owner 和前序 closed schema、safe error、caller/owner cancellation 与 lifecycle helpers。受控 import 读取实际 source bytes 至固定上限后调用公开 `importBuffer`；export 选择调用开始时的 Worktree head，并要求 runtime 精确同步该 revision，不产生 changeset commit。
- 修改 `workspace-client-core/office-exchange`，为 Office import/export、Unit create、target resolution、`exportUnitData` 与 native converter step 追加向后兼容的 optional `AbortSignal` 行为；不可中断的 native conversion 必须等待完成，取消后不得开始下一步。
- 为 DSH 调用应用固定 `512 KiB` canonical argument、`50 MiB` source/converted UnitData/export UnitData/generated file 与 `64` 层 canonical JSON 上限；CLI 省略这些 optional controls，保留现有格式、结果和无预算行为。
- export 先写同目录私有 temporary output，完成格式、大小、sync 与取消检查后才以 no-clobber 或显式 `force: true` 原子发布；失败和取消清理 temporary output并保留既有目标。
- 保留 Unit create 的 stable identity、read-back 与所有 dispatch 后未确认结果：`workspace-result-unknown`、`workspace-result-mismatch` 或 `workspace-invalid-response` 均提示检查固定 Worktree Unit identity，且 tool 不重放 import、native conversion、create 或 export；扩展真实 ToolRuntime、native binding、worker/package closure 与隔离 tarball smoke。

## Scope

**Intent:** 为 local Host-only `dsh-univer-work` 交付与 Workspace CLI outcome 对等的 Office import/create 与 Worktree Unit export，并保持 DSH 文件、审批、取消和安装态资源约束。

**Non-Goals:** 不支持 CSV、PDF、ODF、Board、Trunk export、导入替换既有 Resource/Unit、Office 文件增量更新或远程文件系统；不新增 Blob/Asset tools、Typst、SVG、screenshot/lint、API/resource discovery、Skills、Jobs、daemon、Web Client、Settings、Slot、Remote 或 package publication；不修改 Workspace Server、Browser、HTTP/Collaboration contract、数据库、Commander command/output、CLI Session 或 SDK baseline。

**Size Gate:** 一个新 capability、一个 modified capability、八个 coarse tasks；两个 tools 复用 Changes 4–6 已有 Unit、文件与 runtime owners，不建立 converter service、通用 artifact store 或第二套 path/lifecycle policy，可在一次 focused implementation session 内完成。

## Capabilities

### New Capabilities

- `dsh-univer-work/office-exchange-tools`: 定义 Host-only local DSH Office import/export tools 的格式、schemas、文件 policy、approval、预算、错误、取消、lifecycle 与安装态行为。

### Modified Capabilities

- `workspace-client-core/office-exchange`: 为现有 Office conversion、Worktree Unit create/target/runtime composition与本地 export publication增加 optional signal、optional DSH budgets 和原子输出，同时保持 Workspace CLI compatibility。

## Domain Alignment

- `apps/workspace/CONTEXT.md` 定义 Space、Node、Resource、Unit、Worktree Unit、Worktree-local Unit 与 Draft；import 创建新的 Worktree-local Unit，不把 Office 文件称为 Resource，也不把 export 文件当作 Workspace 权威内容身份。
- `/Users/shenweimin/github.com/dsh-plugin/dsh-univer-work/CONTEXT.md` 与 `docs/adr/0001-co-locate-workspace-agent-clients.md` 定义 Workspace Agent Client、Workspace Client Core 与 Client Shell；本 Change 只通过 private Core package exports 复用 Office workflow，不导入 `apps/cli/src/*`。
- `openspec/changes/extract-office-exchange-client-core/` 已确定 Core 拥有 Node-hosted Office conversion、格式/Unit type policy 和 Worktree Unit/runtime composition；Changes 5/6 分别拥有 DSH local file 与 runtime owner，本 Change 扩展而不分叉这些边界。

No domain-model change.

## Impact

实现主要影响 `apps/dsh-univer-work/**`、`packages/client-core/src/{office-exchange,content-runtime,files}.ts`、相关 tests、package verification/smoke 与两处 package README。packed Host 继续内联 reachable private Core 和 Office converter JavaScript，复用 Change 6 worker/runtime child，并从已安装 `@univerjs-pro/exchange-node` owner manifest 解析、声明和复制精确 `@univerjs-pro/exchange-node-binding`，不依赖相邻 checkout 或安装时构建。

Workspace CLI 继续省略 signal、budgets 与 `force`，其 import/export command arguments、格式矩阵、canonical results、native package smoke 和 self-contained artifact保持不变。Workspace Server/Browser、OpenAPI、数据库、deployment、release workflow 与 frozen SDK baseline 不变。
