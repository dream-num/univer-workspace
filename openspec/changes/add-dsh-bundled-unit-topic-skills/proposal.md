## Why

前序 `add-dsh-univer-work-authentication`、`add-dsh-space-node-tools`、`add-dsh-worktree-unit-tools`、`add-dsh-file-transfer-tools`、`add-dsh-content-runtime-tools`、`add-dsh-office-exchange-tools`、`add-dsh-typst-generation-tools`、`add-dsh-svg-generation-tools`、`add-dsh-render-verification-tools` 与 `add-dsh-api-resource-discovery-tools` 已规划 `dsh-univer-work` 的认证、Workspace workflow、content、exchange、generation、verification 和按需 discovery operations，但除 Worktree/Unit Change 的 `core` 外，Agent 仍缺少 Workspace CLI 已验证的 Unit/Topic 操作指导。把这些知识复制进常驻 prompt 会浪费上下文；只把 Markdown 放进 tarball 又不会进入 DeepSeek Harness `0.1.1-rc.2` 的 Skill catalog，因为该基线不会扫描任意 package 目录。

本 Change 冻结 Workspace commit `a01adf28bfdfbf098ecf66653d520d08ecac4117`、SDK `1.0.0-beta.2` 与 DeepSeek Harness `0.1.1-rc.2`（commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`），只交付七份随包、显式注册且与 installed tool catalog 一致的 DSH-native Skills。

## What Changes

- 在 `apps/dsh-univer-work/skills/<name>/SKILL.md` 交付 `base`、`board`、`cross-unit-formula`、`doc`、`embed`、`sheet` 与 `slide` 七份 package-owned Skills；`core` 继续由 `add-dsh-worktree-unit-tools` 独占。
- 以对应 CLI Skill 的 Facade、Workspace identity、authoring 与 verification 知识为输入，逐份改写 Commander 命令、option、stdout/path 和 `skills get` 指令，使所有可执行步骤只引用上列十个 accepted Change owners 已批准的 exact DSH tool 名称。
- 七份 frontmatter 只保留 DSH rc.2 实际解释的 `name` 与 `description`；不声明 `allowed-tools` 或其他未支持字段。Host 在产生 side effect 前读取并整体验证七份定义，然后逐项调用 `ctx.skills.register()`，显式使用 `source: 'bundled'`、`provider: 'runtime'`，并沿用 model/user invocation 均开启的 registry default。
- 一个 fiber-owned lifecycle effect 保存每次注册返回的 exact disposer，并在 plugin dispose 时逆序撤销；该 plugin 不增加 filesystem provider/root/watcher、dynamic provider、网络下载或第二套 Skill registry。
- 增加逐 Skill required/forbidden operation matrix 和 semantic anchors。source 与 packed-artifact checks 除了把每个 `workspace_*` 引用对照真实 installed tool catalog，还要求各 Skill 覆盖其 Worktree/Unit、execute/inspect、API、Office、Typst、SVG、resource、screenshot/lint 与 review 路径，并拒绝 Board Office、Base/Board native inspect 等错误能力声明；Facade/identity anchors 来自对应 CLI Skill 正文和既有 Skill contract tests。
- 扩展隔离 tarball smoke，在 unrelated cwd、无 Workspace credential、无网络的 keyless profile 中通过真实 SkillRegistry 与 `skill` consumer 验证七份 Skill 的 catalog、按需加载、默认 invocation、shadowing 和 dispose。smoke 为默认 filesystem/scoped provider lookup 配置隔离的空 project/DSH/AGENTS roots；provider lookup 可以运行且 filesystem provider 可以查询这些空根，但 plugin 注册不得依赖其结果，也不得新增 provider、root 或 watcher。

## Scope

**Intent:** 为 Host-only local `dsh-univer-work` 交付七份版本匹配、按需加载且只引用实际 installed tools 的 Unit/Topic Skills。

**Non-Goals:** 不新增、复制或修改 `core` Skill；不增加 discovery 或业务 tools、动态/远程 Skill provider、Skill catalog tools、filesystem roots/watchers、补充 resource files、eager prompt 注入、Web Client、Settings、Slot、Remote、Jobs、CLI subprocess、CLI Session/config/Commander 或 package publication；不修改 `apps/cli/skill-data/**`、Workspace Client Core、Workspace Server/Browser、HTTP contract、SDK baseline，也不支持 remote/E2B filesystem。

**Size Gate:** 一个 new capability、七个 coarse tasks；七份静态文本共享一个验证、注册与 package-smoke 路径，可在一次 focused implementation session 内完成。

## Capabilities

### New Capabilities

- `dsh-univer-work/bundled-skills`: 定义七份 DSH-native Unit/Topic Skills 的 exact catalog、内容边界、显式原子注册、默认 invocation、dispose、tool-reference drift check 与安装态行为。

### Modified Capabilities

- 无。

## Domain Alignment

- `apps/workspace/CONTEXT.md` 定义 Space、Node、Resource、Unit、Trunk、Worktree 与 Draft；Skills 沿用这些产品身份，尤其不把 Blob Resource 当作 Unit，也不从 display name、URL 或 share link 推断 Source identity。
- `apps/workspace/CONTEXT.md` 定义 Workspace Agent Client、Workspace Client Core 与 Client Shell；`apps/workspace/docs/adr/0007-co-locate-workspace-agent-clients.md` 要求 CLI 与 dsh-univer-work 通过同仓 private Client Core package exports 共享能力并各自保留 Client Shell composition。本 Change 在 DSH Client Shell 内拥有指导与注册，不导入 `apps/cli/src/*`，也不把 delivery-specific Skills 放进 private Core。
- `add-dsh-worktree-unit-tools` 已拥有 `core` Skill；认证、Space/Node、Worktree/Unit/review、Blob/Asset、content execute/inspect、Office、Typst、SVG、screenshot/layout lint 与 API/resource discovery 分别由上列十个 accepted Changes 拥有。本 Change 只描述并校验这些 owners 已批准的 exact operations，不新增 authority。

No domain-model change.

## Impact

实现主要影响 `apps/dsh-univer-work/skills/**`、该 application 的 Skill loader/registration tests、package verification/smoke 与职责文档。Host build 和 tarball新增七份 Markdown resources，但不增加 runtime dependency、private Core surface 或网络数据源。

Workspace CLI 的八份既有 Skills、commands 与 artifact 保持不变。Workspace Client Core、Server/Browser、OpenAPI、数据库、deployment、release workflow 与 frozen SDK baseline 不变。
