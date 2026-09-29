## Why

前序 Changes 已为 `dsh-univer-work` 建立 Host shell、Workspace workflow、文件、内容、generation 与 verification tools，但 Agent 仍缺少 Workspace CLI 已有的 Facade API reference 和 SVG resource catalog。把完整 catalog 注入 prompt 会长期占用上下文并与精确 SDK baseline 漂移；DSH 应直接组合已发布的 discovery packages，按需返回有界结构化结果。

本 Change 冻结 Workspace commit `a01adf28bfdfbf098ecf66653d520d08ecac4117`、SDK `1.0.0-beta.2` 与 DeepSeek Harness `0.1.1-rc.2`（commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`），只补齐 API/resource discovery 与 local SVG export。

## What Changes

- 注册 `workspace_api_find`、`workspace_api_show`、`workspace_resource_registries`、`workspace_resource_find` 和 `workspace_resource_export` 五个 operation-specific DSH tools，直接组合 exact-baseline `@univer-cli/api-reference`、`@univer-cli/resource-library` 与 `@univerjs-pro/cli-assets`，不复用 Commander 或 CLI presentation。
- 五个 tools 均不解析 Workspace origin、credential 或 remote connection；前四个查询只读随包 immutable datasets，不请求 approval，也不创建 cache 或本地文件。
- resource export 只接受 stable handles 和一个 Session-cwd 内的输出目录，复用 `add-dsh-file-transfer-tools` 的 Host-local provider identity、current file-effect policy、cwd/path containment 与 pre-ask/body recheck；pre-execute 只锁定 immutable handles 和 contained output directory，body 再由 public resource export 解析 handle/filename，并以应用内最小 atomic SVG publisher 复核 library 提供的 basename target。approval 通过且 body 复核完成前不创建目录、不请求资源、不转换 Host path。
- 所有 tools 使用 closed snake_case schemas、exact own-key validation、closed canonical outputs、固定 search/result/单次 export `32 MiB` asset budgets、fused caller/owner `AbortSignal`、allowlisted safe errors 与 value-only rendering；asset budget 在 injected fetch response-body chunk 边界扣减，成功或失败下载已经消费的 bytes 都不会退回。单 resource `10 MiB` 失败在累计预算仍有余量时可继续；累计余量耗尽或下一 response 超过余量时终止该调用的全部后续 network。
- 不增加持久化或临时磁盘 cache。activation 只保留 fail-closed validated 的 shared query library/opaque loaded manifest；每个 accepted export 构造独立 ResourceLibrary 与 no-retention/downloader/output adapters，使 signal、budget 和 directory state 全部 call-owned，无 shared current-call/AsyncLocalStorage。Host owner 只需通过已有 accepted-body tracking、abort 和 drain 完成 dispose。
- 扩充真实 ToolRuntime 与隔离 tarball smoke，从 unrelated cwd、无 Workspace credential 的 installed local profile 验证四个 keyless queries、approved export、Native/Code Mode canonical values、cancellation、cleanup 和正常 dispose。

## Scope

**Intent:** 为 local Host-only `dsh-univer-work` 交付版本匹配、有界且无需 Workspace credential 的 Facade API/resource discovery 与安全 SVG export。

**Non-Goals:** 不包含或修改任何 Skill；不提供 Skill catalog tools、Workspace auth/HTTP、content/Office/Typst/SVG compile/render/generation、dynamic docs server、完整 catalog prompt 注入、resource read/inline SVG、persistent cache/cache management、arbitrary URL/header、generic file provider、Web Client、Settings、Slot、Remote、Jobs、CLI subprocess、CLI Session/config/Commander 或 package publication；不支持 E2B/remote filesystem，不修改 Workspace Server/Browser、HTTP contract、Client Core、CLI commands/Skills 或 SDK baseline。

**Size Gate:** 一个 new capability、七个 coarse tasks。五个 tools 组合两个现有 published discovery APIs，并复用前序 local file gate 与 Host owner，可在一次 focused implementation session 内完成。

## Capabilities

### New Capabilities

- `dsh-univer-work/discovery-tools`: 定义 Facade API/resource discovery 与 local SVG export tools 的 closed schemas、budgets、approval/path boundary、errors、cancellation、lifecycle 和 installed dataset closure。

### Modified Capabilities

- 无。

## Domain Alignment

- `apps/workspace/CONTEXT.md` 定义 Workspace 的 Resource；本 Change 中 `@univer-cli/resource-library` 返回的 resource 是 visual SVG asset，不是 Workspace Resource、Node 或 Unit。
- `/Users/shenweimin/github.com/dsh-plugin/dsh-univer-work/CONTEXT.md` 与 `/Users/shenweimin/github.com/dsh-plugin/dsh-univer-work/docs/adr/0001-co-locate-workspace-agent-clients.md` 定义 Workspace Agent Client 与 Client Shell 边界；discovery 留在 `apps/dsh-univer-work` Client Shell，不进入 private Client Core，也不导入 `apps/cli/src/*`。
- `add-dsh-file-transfer-tools` 定义 Host-local execution world、Session-cwd file policy 与 approval ordering；resource export 复用该 policy/path boundary，并在 DSH application 内只增加 SVG 所需的 same-directory private-temp atomic publisher，不宣称复用 Blob/Asset 的 Core publisher。

No domain-model change.

## Impact

实现主要影响 `apps/dsh-univer-work/**` 的 tools、package dependencies、tests、package verification/smoke 与责任文档。应用增加 exact `@univer-cli/api-reference@1.0.0-beta.2`、`@univer-cli/resource-library@1.0.0-beta.2` 和 `@univerjs-pro/cli-assets@0.1.0`；build 内联纯 JavaScript discovery implementation，并从 installed dependency export 解析 resource manifest。

Workspace CLI、Client Core、Workspace Server/Browser、OpenAPI、数据库、deployment、CLI release workflow 与 frozen SDK baseline 不变。
