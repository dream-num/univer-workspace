## Why

`add-dsh-space-node-tools` 让 Agent 能发现 Workspace 内容并取得稳定的 Space、Node 与 Resource 身份，但还不能建立隔离草稿、把既有 Resource 加入草稿、创建 Worktree-local Unit 或交付 review URL。Workspace CLI 已通过 `WorkspaceWorktreeFeature`、`WorkspaceUnitFeature` 与 `WorkspaceOpenFeature` 交付这条任务准备与交接路径；DSH Client Shell 应直接复用这些 Core workflow，而不是复制 Commander tree、HTTP 请求或 Worktree 状态机。

本 Change 以 Workspace commit `a01adf28bfdfbf098ecf66653d520d08ecac4117`、SDK `1.0.0-beta.2` 和 DeepSeek Harness `0.1.1-rc.2`（commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`）为冻结基线，完成首个从 Space discovery 到 Worktree review handoff 的 DSH-native vertical slice。

## What Changes

- 在 Host plugin 注册十二个 operation-specific snake_case tools：Worktree list/get/create/update/ready/reopen/merge/discard，Worktree Unit list/add/create，以及 review URL 构造。工具暴露稳定 outcome，不复用 Commander 参数或执行 CLI subprocess。
- 每个工具采用 root `additionalProperties: false` 的 closed parameter schema、exact own-key runtime gate、closed canonical output 与 value-only rendering；参数在 credential/HTTP 前完成交叉校验，review URL 始终使用当前 authenticated grant 的 Workspace origin，不接受模型提供的 viewer origin。
- DeepSeek Harness rc.2 在 `defineTool.execute` 参数校验前运行 `tools/pre-execute`，并在此之前把 caller/model arguments 写入 Native `tool/call.arguments` 或 Code Mode `tool/code-dispatch-start.arguments`；Code Mode settlement 还会把 `normalized.logged` 写入 `tool/code-dispatch.arguments`。八个 mutation tools 因此由同一个纯 operation validator 在 policy 返回 `ask` 前校验 exact keys、类型、enum 与交叉字段，body 再防御性复用该 validator；非法参数以固定 `workspace-argument-invalid` 失败，不新增 approval interaction/event，也不由 result/failure、approval 或 plugin-owned payload 复制参数。上述一份 Native 或两份 Code Mode DSH-owned argument records 仍按 DSH 合同保留。merge 与 discard 保持独立名称和不含参数值的固定高影响提示。三个 discovery/read tools 与 review URL 不请求本 Change 的 approval。
- 复用 Change 2/3 的 authenticated resolver、Workspace error adapter与 Host lifecycle owner；每次调用贯穿 caller/owner `AbortSignal`。普通 idempotent Core retry 保留稳定 identity，但 caller abort 或 owner disposal 后不再发起新 attempt；已 dispatch write 保留 read-back或 `workspace-result-unknown`，不得由 tool 自动重放。
- 修改 `workspace-client-core/worktree-unit`，给 Worktree、Unit 与 review URL public methods 追加向后兼容的 optional `AbortSignal`，贯穿 authenticated resolution、HTTP、stable-identity retry boundary 和 lifecycle read-back；Workspace CLI 省略 signal 时行为不变。
- 随 package 交付首个静态 `core` Skill，并显式调用 `ctx.skills.register()`；Skill 只描述当前已交付的 authentication、Space/Node、Worktree/Unit 与 review handoff tools，保留“每个新任务创建新 Worktree、仅同任务 rework 才复用、merge/discard 必须由用户明确请求”等既有规则。
- 扩展真实 ToolRuntime、Skill catalog、keyless transcript 与隔离 tarball smoke，验证 schemas、approval、error secrecy、cancellation/result-unknown、Skill load/dispose 和 packed Client Core/Skill closure。

## Scope

**Intent:** 为 local Host-only `dsh-univer-work` 交付与 Workspace CLI outcome 对等的 Worktree、Worktree Unit 和 review handoff 能力，并通过一个随包静态 core Skill 教会 Agent 正确使用该工作流。

**Non-Goals:** 不新增 Blob、Asset、本地文件输入输出、content runtime、execute/inspect、worker、Office、Typst、SVG、render/screenshot/lint、API/resource discovery 或其余七个 Skills；不提供 Web Client、Settings、Slot、Remote、Jobs 或 CLI subprocess；不修改 Workspace Server、Browser、HTTP contract、数据库、Commander command/output/Session、CLI core Skill 或发布流程；不支持 sandbox/E2B/remote profile，不发布 package。DSH review URL 不提供 CLI `--viewer-url` 覆盖。

**Size Gate:** 一个新 capability、一个修改 capability、七个 coarse tasks，可在一次 focused implementation session 内完成；依赖已按真实 rc.2 顺序回修并验证的 `add-dsh-space-node-tools`，不预建后续内容与文件能力。

## Capabilities

### New Capabilities

- `dsh-univer-work/worktree-unit-tools`: 定义 Host-only DSH Worktree/Unit/review tools 的 schemas、approval、错误、取消、lifecycle、静态 core Skill 与安装态行为。

### Modified Capabilities

- `workspace-client-core/worktree-unit`: 为现有 Worktree lifecycle、Unit membership 与 review URL workflow 增加 optional `AbortSignal`，同时保持 Workspace CLI compatibility、稳定 identity、read-back 与 result-unknown 行为。

## Domain Alignment

- `apps/workspace/CONTEXT.md` 定义 Trunk、Worktree、User Worktree、Team Worktree、Worktree Unit、Worktree-local Unit、Draft 与 Activation；tools 和 Skill 使用这些身份，不把 Worktree 称为 branch 或把 Personal Space 当作 user-scoped Worktree。
- `/Users/shenweimin/github.com/dsh-plugin/dsh-univer-work/CONTEXT.md` 与 `docs/adr/0001-co-locate-workspace-agent-clients.md` 定义 Workspace Agent Client、Workspace Client Core 与 Client Shell 的共仓边界；本 Change 只消费 private package exports，不导入 `apps/cli/src/*`。
- `openspec/changes/extract-worktree-unit-client-core/` 已确定 Core 拥有 Worktree/Unit/review workflow、严格 parser、idempotency 与 result-unknown；本 Change 的 DSH shell 只拥有 tool/Skill/credential/lifecycle adaptation。
- 已批准的 `openspec/changes/add-dsh-univer-work-plugin-shell/`、`add-dsh-univer-work-authentication/` 与 `add-dsh-space-node-tools/` 分别拥有 package、authenticated connection 和 shared tool safety/lifecycle patterns；Change 3 当前关于 body validator 先于 approval 的同类假设必须在其自身 artifacts/implementation 中先行回修，本 Change 不修改该 Change。

No domain-model change.

## Impact

实现主要影响 `apps/dsh-univer-work/**`（包括 policy/body 共用的最小 operation validators）、`packages/client-core/src/{worktree,unit,open}.ts`、相关 Client Core tests、DSH tool/Skill/transcript/package smoke 与两处 package README。Client Core public method signatures 仅追加 optional signal；现有 CLI caller 不需要修改，CLI Worktree/Unit/open command tests、core Skill snapshot 与 package smoke 继续验证兼容性。

Workspace Server/Browser、OpenAPI、数据库、deployment、CLI 外部合同、SDK baseline 和 release workflow 不变。packed Host entry 继续内联 reachable private Client Core；静态 core Skill 随同一 tarball 交付，精确 DSH/Cordis runtime dependencies 保持 external。
