## Why

Univer Workspace 已决定把 `dsh-univer-work` 作为第三个 Workspace Agent Client 放入本仓库，但当前仓库还没有 DeepSeek Harness 能安装和装配的 Client Shell。后续认证、Workspace tools、Skills 与内容 runtime 都依赖一个先经过真实 profile 安装验证的 Host plugin owner；若先实现业务能力，bundle manifest、Cordis lifecycle 或 tarball 资源缺失会把装配问题混入每个后续 Change。

本 Change 以 Workspace commit `a01adf28bfdfbf098ecf66653d520d08ecac4117`、SDK `1.0.0-beta.2` 和 DeepSeek Harness `0.1.1-rc.2`（commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`）为冻结基线，只建立可安装、可加载、可卸载的 Host-only shell。

## What Changes

- 新增 `apps/dsh-univer-work`，其 package 名为 `dsh-univer-work`，source version 固定为 `0.0.0` 且保持 `private: true`。
- 交付 `dsh.bundle.patch` manifest、`cordis.patch.yml` Loader row 与预构建 Host entry；package artifact 只包含 Host 启动需要的构建产物、patch、manifest、license 与职责说明。
- 建立最小 build、typecheck 与 test scripts，并以真实 Cordis composition 验证 plugin load、fiber dispose 和异步清理完成。
- 从预构建 tarball 安装到隔离 DSH profile，验证 bundle membership、dump 后的 layer/Loader row、Host 启动与正常终止；smoke 不依赖源码 checkout 或 Harness 私有测试支持 package。
- 更新仓库布局、Workspace Agent Client/Client Shell 术语、共仓决策和交付职责文档，使新 application 的 owner 与非职责在目标仓库内可发现。
- 不产生 Workspace Server、Browser、HTTP contract 或 Workspace CLI 行为变更。

## Scope

**Intent:** 交付一个可由 DeepSeek Harness `0.1.1-rc.2` 从预构建 tarball 安装，并能在 local profile 中正确 load/dispose 的 Host-only `dsh-univer-work` Client Shell。

**Non-Goals:** 不依赖或调用 `@univerjs/univer-workspace-client-core`；不实现 Workspace origin、认证、Credentials、authorization、password、Session、tools、Skills、Jobs、文件能力、content runtime、worker、Office、Typst、SVG、render/screenshot/lint；不提供 `dsh.client`、Web Client、Slot、Settings、overlay 或 Client→Host Remote；不调用 Workspace CLI subprocess，不读取 CLI Session/daemon，不支持 sandbox/E2B/remote profile；不建立正式版本合同、registry、release/promotion workflow 或 public npm publication。

**Size Gate:** 一个新 capability、六个 coarse tasks，可在一次 focused implementation session 内完成。CLI outcome parity 由已确认的后续 Changes 逐步交付，本 Change 不预建其接口或资源目录。

## Capabilities

### New Capabilities

- `dsh-univer-work/plugin-shell`: 定义 Host-only local plugin package 的安装 artifact、DSH profile 装配、load/dispose lifecycle 与隔离安装 smoke 行为。

### Modified Capabilities

- 无。

## Domain Alignment

- `apps/workspace/CONTEXT.md` 定义 Univer Workspace 产品术语；本 Change 将已确认的 Workspace Agent Client、Workspace Client Core 与 Client Shell 术语迁入目标仓库，并把 `dsh-univer-work` 记录为独立于 Univer Workspace CLI 的 Client Shell。
- `/Users/shenweimin/github.com/dsh-plugin/dsh-univer-work/CONTEXT.md` 是迁移期术语来源；实现完成后，目标仓库文档成为当前 application owner 的事实来源，产品代码和构建不依赖该相邻 checkout。
- `/Users/shenweimin/github.com/dsh-plugin/dsh-univer-work/docs/adr/0001-co-locate-workspace-agent-clients.md` 记录已经接受的共仓决定；本 Change 在 `apps/workspace/docs/adr` 记录同一决定，保持“两个 Client Shell 只通过 private package exports 复用”的边界。
- `apps/workspace/docs/adr/0002-keep-the-workspace-product-in-one-repository.md` 要求 Workspace Browser、Server、HTTP contract、Agent clients 与内部 packages 由同一产品仓库拥有；新增 application 遵守该 source boundary。
- `apps/workspace/docs/adr/0004-license-the-repository-under-apache-2.0.md` 继续约束源码与 artifact license；`private: true` 和 `0.0.0` 不创建发布合同。

该 Change 增加已确认的 application 与 Client Shell 术语，不改变 Space、Node、Resource、Unit、Worktree、身份、权限或持久化语义。

## Impact

实现主要影响 `apps/dsh-univer-work/**`、根 workspace package graph 与 lockfile，以及 `README.md`、`AGENTS.md`、`DREAMNUM.md`、`apps/workspace/CONTEXT.md` 和对应 ADR。构建仅消费已发布的 DeepSeek Harness/Cordis package exports，并精确对齐冻结基线；不得依赖 `/Users/shenweimin/github.com/deepseek-ai/deepseek-harness` 或其他相邻源码 checkout。

`packages/client-core`、`apps/cli`、Workspace Server/Browser、OpenAPI、数据库、deployment 与既有 CLI release workflow 不变。后续 Changes 才把 credential-backed Workspace connection 和 CLI outcome parity 能力接入该 shell。
