## Why

前序 Changes 已让 `dsh-univer-work` 在 local Host 中认证、选择 Trunk/Worktree Unit、传输本地文件并通过 worker 读取内容，但 Agent 仍不能生成可审阅的 PNG，也不能用真实 browser layout 检查 Slide。Workspace Client Core 已拥有 render Unit 装配、Worktree Asset rewrite、browser screenshot、原子 PNG 输出和 Slide layout lint；缺口位于 DSH Client Shell 的稳定 tools、Session cwd file gate、取消、结果预算与安装资源闭包。

本 Change 基于 Workspace commit `a01adf28bfdfbf098ecf66653d520d08ecac4117`、SDK `1.0.0-beta.2` 和 DeepSeek Harness `0.1.1-rc.2`（commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`），交付与 Workspace CLI 对等的截图和 Slide layout verification 结果。

## What Changes

- 新增 `workspace_screenshot` 与 `workspace_layout_lint` 两个 operation-specific DSH tools；截图支持 Trunk/Worktree 的 Sheet、Doc、Slide、Board、Base 既有 target 和 PNG metadata，layout lint 保持 Worktree Slide、可选 page selectors 与完整 structured report。
- 截图沿用 `add-dsh-file-transfer-tools` 的 local execution-world、Session cwd、current file-effect policy 和 one-approval gate；approved body 重新验证 policy/provider/path，向 Core 只传递 canonical Host-local output directory。layout lint 为只读且不请求本 Change 的 approval。
- 对两个 tools 使用 closed snake_case arguments、closed canonical results、cross-field validation、参数/selector/结果预算和固定 allowlisted errors；截图在首个 PNG publication 前基于 approved canonical directory 和 safe basenames 构造并验证 exact bytes-free result，oversize/malformed capture 写零文件；PNG bytes 不进入 canonical value、Native render 或 Code Mode log。
- 在现有 file-transfer 与 content-tools owner 中各导出一个窄的 dependency-failure projector；既有工具委托同一 projector，Render 组合它们并执行更窄的 safe-detail 投影。allowlist sets继续由原owner私有持有，不新增generic shared-error模块或第三套adapter。
- 为现有 `workspace-client-core/screenshot-lint` 追加 optional signal，使 render target/reference、UnitData/Asset load、browser capture/lint、逐图原子写入和 cleanup 观察取消；已提交部分 PNG 时返回 structured partial-output，而不是删除、覆盖或自动重放。
- 复用 Change 6 的 current content runtime generation、worker、credential/license resolver 与 lifecycle owner；每次 browser operation 仍创建并关闭一个 render runtime，Host dispose 等待 browser、worker、文件 finalizer 与 accepted body 全部静止。
- 扩充预构建 tarball，复制 Client Core render page；从 exact render-runtime 的实际安装目录相对解析 Puppeteer/browser package manifests，把解析到的 concrete exact versions 写入并校验 packed manifest；从 unrelated cwd 以真实 ToolRuntime 验证截图、lint、cancellation、partial output 与 bounded dispose。
- 不修改 Workspace CLI command/output、Workspace Server/Browser、HTTP contract 或现有无 signal 的 Client Core consumer 行为。

## Scope

**Intent:** 让 local Host-only `dsh-univer-work` Agent 通过 DSH-native tools 为 Workspace Unit 生成安全的本地 PNG，并对 Worktree Slide 返回 browser-backed layout findings。

**Non-Goals:** 不实现 browser download/setup tool、共享 browser pool、Jobs、图片 attachment、inline/base64 PNG、覆盖既有截图、remote/sandbox/E2B filesystem、Trunk layout lint、新 lint rules、其他图片格式、Office、Typst、SVG、API/resource discovery、Skills、Web UI、daemon 或 CLI subprocess；不改变 screenshot target、render SDK limit、font fallback、Workspace content、Chromium 既有 `--no-sandbox` launch 或 SDK baseline，也不把 screenshot approval/layout-lint no-approval 描述成 browser process isolation。部署方必须以受限 OS user 或受限 container 运行 render tools，并限制其 filesystem/network 权限。

**Size Gate:** 一个新 capability、一个 modified capability、八个 coarse tasks，可在一次 focused implementation session 内完成。截图与 lint 共享现有 Client Core capability、render page、browser runtime 和 DSH lifecycle，不新增 renderer abstraction 或第二 owner。

## Capabilities

### New Capabilities

- `dsh-univer-work/render-verification-tools`: 定义 Host-only local DSH screenshot/layout-lint operations、schemas、file approval、budgets、errors、cancellation、lifecycle 与安装态 render closure。

### Modified Capabilities

- `workspace-client-core/screenshot-lint`: 让现有 render Unit、screenshot、PNG output 与 Slide layout lint workflow 接受 optional `AbortSignal`，并报告取消后的已提交部分 PNG，同时保持 Workspace CLI compatibility。

## Domain Alignment

- `apps/workspace/CONTEXT.md` 定义 Unit、Trunk、Worktree 与 Draft；截图只读取所选 revision，layout lint 只检查 Worktree Slide，二者都不修改 Workspace content。
- `apps/workspace/CONTEXT.md` 定义 Workspace Agent Client、Client Shell 与 Workspace Client Core；accepted `apps/workspace/docs/adr/0007-co-locate-workspace-agent-clients.md` 要求各 Client Shell 只通过 private Client Core package exports 共享 Workspace capability。本 Change 由 DSH Client Shell 拥有 tool schema、local file approval 与 lifecycle，通过 Core exports 复用 render Unit、screenshot、PNG output、Slide layout lint 和 render-page source，不导入 `apps/cli/src/*`。
- `openspec/changes/extract-screenshot-lint-client-core` 已将 render Unit、screenshot、PNG write、layout lint 与 render-page source 归入一个 Core capability；本 Change 修改该既有 capability，不拆成第三个 capability。
- `add-dsh-file-transfer-tools` 与 `add-dsh-content-runtime-tools` 提供本 Change 复用的 local file gate、authenticated runtime generation、worker/license owner、safe error 和 total lifecycle。

No domain-model change.

## Impact

实现主要影响 `apps/dsh-univer-work/**`、`packages/client-core/src/{render-unit,screenshot,layout-lint}.ts`、对应 tests、package verification/smoke 与责任文档。现有 file-transfer/content behavior不变，只增加owner-local projector exports与preservation tests。`dsh-univer-work` 的 artifact 增加从 Client Core build 复制的 render page；build 对 exact `@univer-cli/univer-render-runtime@1.0.0-beta.2` 的 resolved package 执行 `realpath`，从其实际安装位置解析 `puppeteer-core` 与 `@puppeteer/browsers` 的 resolved manifests，读取并写入 concrete exact versions，再在 packed artifact 中逐项核对；不复用 owner manifest 的 semver range，也不从相邻checkout、CLI artifact或pnpm hoist推断资源。

Workspace CLI 继续省略 optional signal 并保留 browser setup、scope/options、presentation、render page path 与 package behavior。Workspace Server/Browser、OpenAPI、数据库、Collaboration data、CLI release/deployment 和 frozen SDK baseline 不变。
