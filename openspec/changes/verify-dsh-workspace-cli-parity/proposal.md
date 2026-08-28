## Why

十二个前置 Change 已分别规划 `dsh-univer-work` 的 Host shell、认证、Workspace workflow、文件传输、content runtime、Office/Typst/SVG、render verification、离线 discovery 与八份 Skills，但这些局部验收尚不能证明一个安装后的 package 具备 `apps/cli` 首版对外能力。缺少统一 gate 时，tool 漏注册、schema 漂移、worker/native/browser/asset/Skill 漏包，或仅在 monorepo checkout 内可解析，仍可能在每个 Change 的 focused tests 全部通过后进入交付物。

本 Change 冻结 Workspace commit `a01adf28bfdfbf098ecf66653d520d08ecac4117`、SDK `1.0.0-beta.2` 与 DeepSeek Harness `0.1.1-rc.2`（commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`），以 outcome 而非 Commander 命令形状定义 parity，并把完整安装态验收收敛为一个阻断式 delivery gate。

## What Changes

- 建立一份冻结 CLI outcome → DSH tool/Skill/verification-owner 矩阵，覆盖 browser approval、Space/Node/Trash、Worktree/Unit/review URL、Blob/Asset、inspect/execute、Office、Typst、SVG、screenshot/layout lint、API/resource discovery 与八份 Skills；同时逐项分类 config/Session/daemon、password login、review viewer override、browser setup、resource cache、version/help/Skill path 和参数/输出呈现等 CLI-only mechanics，任何遗漏、重复 owner 或引用不存在的 operation 都使 gate 失败。
- 从十二个 accepted prerequisite Changes 组装完整 expected catalog，使用真实 DSH ToolRegistry/SkillRegistry 检查注册名称与 closed parameter/output schema snapshot；consequential classification 来自 checked manifest，并以真实 `tools/pre-execute` 的 invalid/ask/deny/allow probe 验证。Native/Code Mode 可见性和 dispose 后移除同样进入 gate，不机械复制 Commander command tree。
- 对源码 artifact 与预构建 tarball 运行同一 capability manifest，只用 deterministic loopback fixtures 替代 Workspace/Collaboration authority/transport、approval 与 credential endpoints；local DSH filesystem、worker/runtime child、native bindings/compilers、browser/render page、assets 与 Skills 使用真实 installed runtime。套件无需 model key 或 external public network，并验证 success、recognized error、secret filtering、caller/owner cancellation、result-unknown、read-back/no-replay 与 local-only/non-local rejection。
- 从最终预构建 tarball 安装到隔离 local DSH profile，在 unrelated cwd 下验证 bundle/Loader、完整 tool/Skill catalog、worker、native binding、browser render page、resource/binding/asset closure、load/dispose/drain，并拒绝 checkout、`workspace:*`、bare private Core、`apps/cli/src/*`、相邻仓库或绝对路径依赖。
- 增加 package-size budget 与 allowlisted file/import manifest；超限、未知文件、缺少运行资源或安装后需要 build 均阻断，但本 Change 不以删除明确需要的 runtime resource 来满足 size gate。
- 更新 `apps/dsh-univer-work/README.md` 的首版 parity 状态、冻结基线、已验证能力、local execution-world 限制与明确非职责；文档由可执行矩阵校验，不能宣称未通过的能力。
- 将所有发现的前置能力缺口报告为对应 owner Change 的失败，不在本 Change 补写 tool、Skill、Client Core workflow 或业务 adapter。

## Scope

**Intent:** 用一个可执行、安装态、阻断式 gate 证明 `dsh-univer-work` 在冻结基线上达到 `apps/cli` 的首版 outcome parity，同时保持 DSH-native tool/Skill surface。

**Non-Goals:** 不新增或修复业务 tool、Skill、Workspace Client Core workflow、HTTP contract 或 Server 行为；不要求 Commander command/option/text output 一一对应；不增加 CLI config/Session/daemon subprocess、password tool、model-triggered browser download/setup、resource cache、viewer-origin override、Web Client、Settings、Slot、Remote、sandbox/E2B/remote filesystem；不新增 package version derivation、release/promotion workflow、registry/public npm publication或兼容版本范围；不改变 Workspace CLI 的命令、artifact 或 release contract。

**Size Gate:** 一个 new capability、七个 coarse tasks；实现只添加共享 parity manifest、verification fixtures/gates 与职责文档，不承担前置 capability 修复，可在一次 focused implementation session 内完成。

## Capabilities

### New Capabilities

- `dsh-univer-work/cli-outcome-parity`: 定义冻结 CLI outcome baseline、完整 DSH operation/Skill 映射、安装 artifact 闭包、size budget 与阻断式 parity acceptance。

### Modified Capabilities

- 无。

## Domain Alignment

- `apps/workspace/CONTEXT.md` 定义 Space、Node、Resource、Unit、Trash、Trunk、Worktree 与 Draft；parity 矩阵按这些产品 outcome 比较，不把 Commander command、DSH tool 或本地文件当成新的产品实体。
- `/Users/shenweimin/github.com/dsh-plugin/dsh-univer-work/CONTEXT.md` 与 `/Users/shenweimin/github.com/dsh-plugin/dsh-univer-work/docs/adr/0001-co-locate-workspace-agent-clients.md` 定义 Workspace Agent Client、Workspace Client Core 与 Client Shell；本 Change 比较两个 Client Shell 的 outcome，并保持仅通过 private package exports 共享实现的决定。
- `openspec/changes/add-dsh-univer-work-plugin-shell/` 以及其余十一项 `add-dsh-*` prerequisite Changes 分别拥有 package、operations、Skills 与各自 installed behavior；本 Change只验证它们的组合，不转移 ownership。

No domain-model change.

## Impact

实现主要影响 `apps/dsh-univer-work` 的 parity manifest、tests、package verification/smoke 和 README，以及根级验证入口（仅在复用现有 script 不能表达统一 gate 时增加最小命令）。它读取 `apps/cli` 的冻结 Commander composition、tests、README 与 package contract 作为 baseline evidence，但不导入或执行 CLI subprocess 来提供产品能力。

Workspace Client Core、Workspace CLI、Server/Browser、OpenAPI、数据库、deployment、SDK baseline 与既有 CLI/plugin release policy不变。若 gate 发现缺口，实施必须回到对应 prerequisite Change 处理后再重跑本 gate。
