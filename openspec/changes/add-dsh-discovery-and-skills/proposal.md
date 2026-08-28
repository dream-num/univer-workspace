## Why

Changes 1–9 逐步交付了 `dsh-univer-work` 的认证、Workspace workflow、内容、文件、exchange、generation 与 verification tools，但 Agent 仍缺少两类 CLI 已验证的按需知识入口：离线 Facade API reference、SVG resource catalog，以及除 `core` 外的七份版本匹配 Skills。若把完整 API catalog 或资源索引写进 Skill，会增加常驻上下文并让指导与实际 SDK 漂移；DSH 应组合现有 published discovery packages，并用原生 Skill registry 渐进加载指导。

本 Change 冻结 Workspace commit `a01adf28bfdfbf098ecf66653d520d08ecac4117`、SDK `1.0.0-beta.2` 与 DeepSeek Harness `0.1.1-rc.2`（commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`），补齐首版的 discovery 与静态指导入口。

## What Changes

- 注册五个 operation-specific DSH tools：`workspace_api_find`、`workspace_api_show`、`workspace_resource_registries`、`workspace_resource_find` 与 `workspace_resource_export`。它们直接组合 exact-baseline `@univer-cli/api-reference` 与 `@univer-cli/resource-library`，返回有明确 fan-out/byte 上限的 canonical data，不复用 Commander、CLI subprocess 或 CLI presentation。
- 四个只读查询为 keyless local operations；`workspace_resource_export` 复用 `add-dsh-file-transfer-tools` 已建立的 local constructor、Session cwd、current file-effect policy、one-approval 与 body recheck，不把 arbitrary Host path、remote filesystem 或 inline SVG 暴露给模型。
- 所有 tools 使用 closed snake_case schemas、exact own-key validation、closed output projection、fused caller/owner `AbortSignal`、固定 allowlisted errors 与 value-only rendering；API/resource dataset failure、下载失败、partial export、caller abort 和 Host dispose 不泄漏本地 manifest/cache 路径、下载 URL、headers、cause 或未知 dependency data。
- 将 CLI 已验证的 `base`、`board`、`cross-unit-formula`、`doc`、`embed`、`sheet`、`slide` 知识改写为 DSH-native tool guidance，随同一 plugin tarball 交付，并逐项显式调用 `ctx.skills.register()`；`core` 继续由 `add-dsh-worktree-unit-tools` 独占，避免同层 first-wins 重复注册。
- Skills 只描述同一 installed artifact 已交付的稳定 tools 和 Facade 语义，不冒充工具、注入 secret、自动执行操作或保留 CLI 命令示例；source/package checks 校验七个 frontmatter names、tool references、禁用语法和 exact SDK/resource dataset closure。
- 扩充真实 ToolRuntime、Skill catalog、Native/Code Mode keyless transcript 与隔离 tarball smoke，验证 bounded discovery、export approval/path/cancellation、七个 Skill 的 load/dispose，以及从无 monorepo checkout、无 Workspace credential 的 installed profile 使用 discovery 与 Skills。

## Scope

**Intent:** 为 local Host-only `dsh-univer-work` 交付版本匹配、按需且有界的 Facade API/SVG resource discovery，以及七份 DSH-native Unit/Topic Skills。

**Non-Goals:** 不新增或重复 `core` Skill、Workspace auth/HTTP workflow、content/Office/Typst/SVG/render 实现、动态/远程 Skill provider、Skill list/get/path tools、完整 catalog prompt 注入、通用 docs server、resource cache 管理 tool、inline SVG result、arbitrary URL/header、Web Client、Settings、Slot、Remote、Jobs、CLI subprocess、CLI Session/config/Commander 或 package publication；不支持 E2B/remote filesystem，不修改 Workspace Server/Browser、HTTP contract、Client Core、现有 CLI Skills/commands 或 SDK baseline。

**Size Gate:** 两个 new capabilities、八个 coarse tasks；五个 tools 只组合两个现有 published packages，七个静态 Skills 共享一个 registration/package verification path，并复用既有 Host owner 与 local file gate，可在一次 focused implementation session 内完成。

## Capabilities

### New Capabilities

- `dsh-univer-work/discovery-tools`: 定义 Host-only Facade API 与 SVG resource discovery/export tools 的 bounded schemas、local export approval、errors、cancellation、lifecycle 与安装态 dataset closure。
- `dsh-univer-work/bundled-skills`: 定义七份版本匹配 DSH-native Skills 的名称、内容边界、显式注册、dispose、package verification 与安装态 catalog behavior。

### Modified Capabilities

无。

## Domain Alignment

- `apps/workspace/CONTEXT.md` 定义 Space、Node、Resource、Unit、Trunk、Worktree 与 Draft；Skills 沿用这些身份，resource discovery 中的 visual asset 明确不是 Workspace Resource。
- `/Users/shenweimin/github.com/dsh-plugin/dsh-univer-work/CONTEXT.md` 与 `docs/adr/0001-co-locate-workspace-agent-clients.md` 定义 Workspace Agent Client 与 Client Shell 边界；本 Change 只消费 published Univer CLI SDK packages，不导入或运行 `apps/cli/src/*`，也不把 discovery 放进 private Client Core。
- `add-dsh-worktree-unit-tools` 已拥有 `core` Skill；Changes 2–9 拥有七份 Skills 所引用的 operation tools。本 Change 只注册尚未交付的七份 Skills，并以 installed tool catalog 校验其引用。

No domain-model change.

## Impact

实现主要影响 `apps/dsh-univer-work/**`、该应用的七份 Skill resources、package verification/smoke 与责任文档。应用增加 exact `@univer-cli/api-reference@1.0.0-beta.2`、`@univer-cli/resource-library@1.0.0-beta.2` 和 resource manifest owner `@univerjs-pro/cli-assets@0.1.0`；build 内联纯 JavaScript discovery implementation，保留并校验实际需要的 exact external asset package，不从 CLI artifact、相邻 checkout 或网络下载 Skill/API dataset。

Workspace CLI、Client Core、Workspace Server/Browser、OpenAPI、数据库、deployment、CLI release workflow 与 frozen SDK baseline 不变。
