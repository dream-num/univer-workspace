## Why

`apps/cli` 仍拥有 Workspace render Unit 装配、browser render runtime、截图文件落盘和 Slide layout lint。截图会解析 Host 的 formula references、Embed children 与 Worktree Asset，lint 又复用同一份 render Unit；若这些实现留在 CLI，未来的 Node-hosted Workspace Agent Client 只能复制渲染数据规则、浏览器关闭语义与静态 render page。

`extract-file-transfer-client-core`、`extract-runtime-target-client-core` 与 `extract-content-runtime-client-core` 已分别规划 Asset content、runtime target/reference 和 UnitData export seam。本 Change 在这些真实能力之上提取截图与 lint vertical slice，并用现有 CLI 证明命令、PNG 和浏览器交付行为不变。

## What Changes

- 将 Workspace render Unit loader 移入 private `@univerjs/univer-workspace-client-core`，继续解析 formula reference 与 Embed resource，并只在 Worktree render copy 中解析 UUID-backed image Asset。
- 将 browser render runtime 的 Workspace 装配、render page source 与每次操作的 create/close lifecycle 移入 Client Core；Client Shell 显式提供 render page 路径、license 和环境。
- 将 PNG capture、名称安全、exclusive local write 与 Slide-only layout lint workflow 移入 Client Core。
- 让 CLI 只保留 Commander presets、scope/options、browser install/probe/resolve、license/config 解析、presentation 和 artifact 路径装配。
- 让 CLI build/package 从 Client Core 构建并复制 render page，继续交付 Puppeteer runtime dependencies、浏览器解析能力和现有静态资产。
- 迁移核心行为测试，并保留 CLI command、SVG 临时 render-page consumer、package verify 与安装 smoke 验证。
- 不产生 CLI breaking change。

## Scope

**Intent:** 将 Workspace browser render、截图和 Slide layout lint 作为一条可复用 vertical slice 纳入 Workspace Client Core，同时保持 Workspace CLI 的渲染结果与交付行为不变。

**Non-Goals:** 不提取 SVG compile、字体测量或 SVG apply；不修改 screenshot/lint Commander surface、browser setup commands、license 来源、Puppeteer 下载目录或浏览器选择；不修改 target、Asset、UnitData、Univer render SDK 或 Server contract；不创建通用 renderer interface、runtime registry、第二个 package 或 `apps/dsh-univer-work`；不支持 Browser consumer、remote filesystem 或独立 npm 发布；不新增覆盖模式、图片格式、lint rule、缓存、共享 browser pool 或 cancellation contract。

**Size Gate:** 一个新 capability，预计七个 coarse tasks，可在一次 focused implementation session 内完成。直接依赖 Changes 4、5、6；Changes 1–3 是传递前置，Changes 7–8 只是既定顺序中的 predecessors。

## Capabilities

### New Capabilities

- `workspace-client-core/screenshot-lint`: 为 Node-hosted Workspace Agent Client 提供可复用的 Workspace render Unit 装配、browser screenshot 与 Slide layout lint，并固定本地 PNG 安全和 render runtime 交付合同。

### Modified Capabilities

- 无。

## Domain Alignment

- `CONTEXT.md` 定义 Workspace Agent Client、Workspace Client Core 与 Client Shell；本 Change 将 Workspace-specific render workflow 归入 Core，将命令、配置、浏览器安装和 artifact 路径留在 Shell。
- `docs/adr/0001-co-locate-workspace-agent-clients.md` 决定两个 Agent clients 通过 `univer-workspace` monorepo 内的 private package exports 复用实现。
- `univer-workspace/apps/workspace/CONTEXT.md` 定义 Unit、Trunk、Worktree 与 Worktree Unit；render Unit 继续从选定 Trunk 或 Worktree revision 读取，截图不修改 Draft 或 Trunk。
- `openspec/changes/extract-file-transfer-client-core/`、`extract-runtime-target-client-core/` 与 `extract-content-runtime-client-core/` 提供本 Change 直接复用的 Asset content、target/reference 和 UnitData export operations。

No domain-model change.

## Impact

规划 artifacts 位于本仓库；实现只允许落在 `~/github.com/dream-num/univer-workspace`。主要影响目标仓库的 `packages/client-core/**`、`apps/cli/src/features/{screenshot,lint}/**`、`apps/cli/render-runtime/**`、`apps/cli/src/{program,main}.ts`、相关 tests、Client Core/CLI manifests 与 build graph，以及 CLI package artifact、verify 和 smoke scripts。

Workspace Server、Browser application、HTTP/Collaboration contract、CLI command surface、Session、daemon protocol、SDK baseline、Puppeteer/browser platform policy 和发布渠道不变。`apps/cli/src/features/svg/**` 在第 10 个 Change 前继续消费同一 packaged render page 与 CLI-owned text-measure workflow；本 Change 不迁移它。实现必须在 Changes 1–8 按顺序完成后复用其真实 public exports，不得修改目标仓库或在本规划仓库创建产品代码。
