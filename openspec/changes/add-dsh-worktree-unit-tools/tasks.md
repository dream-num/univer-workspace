> Prerequisite: revise `add-dsh-space-node-tools` in its own Change so mutation exact-key/schema/cross-field validation runs before rc.2 `ask`, then complete and verify it before implementing this Change. This Change does not edit Change 3.

## 1. 贯穿 Client Core Worktree/Unit cancellation

- [x] 1.1 为 Worktree list/get/create/update/transition、Unit list/add/create 与 review URL methods 追加向后兼容的 optional `AbortSignal`，传给所有 `WorkspaceHttp`/`getWorktree` calls并在 resolver、sequential request、stable-identity retry 与 lifecycle read-back 边界检查；只为现有 stable-identity helper 添加停止后续 attempt 所需的 optional signal，使 abort 后的 uncertain write 保持 bounded `workspace-result-unknown`。在 `packages/client-core/test/worktree-unit.test.ts` 用 abort-observing fetcher 覆盖各 read/mutation family、retry stop、transition read-back 和 confirmed-result race，运行 Client Core test/typecheck 并确认所有无 signal cases 通过。

## 2. 固定 schemas 并交付 Worktree reads/review

- [x] 2.1 复用 Change 3 的 closed-tool wrapper与 Worktree/Unit schema fragments，注册 `workspace_worktree_list`、`workspace_worktree_get` 和 `workspace_worktree_review_url`；local validators 在 resolver 前拒绝 blank/unknown/cross-field fields，review 以单次 authenticated resolver 的 `WorkspaceHttp.origin` 构造 `{ review: { openUrl, type, unitId, worktreeId } }`，不接受 viewer origin。真实 ToolRuntime/Code Mode tests 覆盖这三个 catalog roots 的 `additionalProperties: false` 与 direct unknown-key reject、list filters/default、get identity、zero/one/many Unit review 和 invalid output before render，运行 `pnpm --filter dsh-univer-work test`。

## 3. 交付 Worktree mutations 与 lifecycle

- [x] 3.1 实现 `workspace_worktree_create`、`workspace_worktree_update`、`workspace_worktree_ready`、`workspace_worktree_reopen`、`workspace_worktree_merge`、`workspace_worktree_discard`，为每个 mutation 提供 policy/body 共用的纯 operation validator且每个 tool 只调用对应 Core operation；覆盖六个 closed roots、exact keys/types/enums/cross-fields、user/Space create、stable idempotency key、update at-least-one-field、allowed/invalid transitions、merge/discard identity、response mismatch、read-back success/unknown 与无 shell-level retry，断言 canonical `{ worktree }` 和 value-only rendering。

## 4. 交付 Worktree Unit tools

- [x] 4.1 实现 `workspace_unit_list`、`workspace_unit_add`、`workspace_unit_create`，让 add/create 的纯 operation validators 由 pre-approval policy 与 body 共用，拒绝 `initial_data` 等 undeclared content，保留 Worktree membership、trunk/worktree source、target/type/name、stable identity 与 bounded public error detail；ToolRuntime tests 覆盖三个 closed roots、exact keys/types/enums/cross-fields、list mismatch、add Resource identity、local Unit target、all five Unit types、idempotent retry/unknown、caller/owner abort 和 invalid output，断言 adapter 不复制 HTTP path/parser 或 content runtime。

## 5. 收敛 approval、errors 与 Host lifecycle

- [x] 5.1 扩展现有 fiber owner的 `tools/pre-execute` policy：八个 mutation names 先调用对应 shared validator，成功才 `ask`，四个 read/review names 委托；validator failure 以固定无 detail 的 `workspace-argument-invalid` 结束且 body仍防御性复验，merge/discard 使用不含参数值的独立固定高影响提示。真实 Cordis tests 对每个 mutation family 注入 unknown key、wrong type、invalid enum、cross-field conflict与 secret sentinel，断言 invalid call无 approval interaction/event、无 credential/HTTP；Native 必须仅在 `tool/call.arguments` 保留 sentinel，Code Mode 必须在 `tool/code-dispatch-start.arguments` 与 settled `tool/code-dispatch.arguments = normalized.logged` 两处保留，approval、result/failure 与 plugin-owned payload均不复制。另覆盖 allowed-once、deny/cancel/unavailable/no-channel、`ABORTED_BEFORE_DISPATCH`、read cancel/dispose、abort 后停止 Core attempt、dispatched `workspace-result-unknown`、caller-aborted late success=`ABORTED` + get/list/no-replay guidance、owner-only confirmed success与 dispose drain，断言无 detached retry/read-back/listener/timer/Job。

## 6. 打包并注册静态 core Skill

- [x] 6.1 从现有 CLI core 知识改写 `apps/dsh-univer-work/skills/core/SKILL.md`，只保留 Changes 2–4 已交付的 authentication、Space/Node、new-Worktree-per-task、same-task rework、Unit staging/create、ready/read-back/review 和 explicit merge/discard/no-blind-replay规则；在 Host 声明现有 `skills` injection并用 `ctx.skills.register()` 显式注册 `core`，不增加 provider/watcher/parser dependency。用真实 Skill registry/consumer验证 summary/body、model/user invocation、无 CLI/future tool 文本与 fiber disposal；扩展 `package:verify`/隔离 tarball `package:smoke`，断言 packed Markdown 与 installed catalog一致、十二 tools/Skill可见、reachable Core内联且无 bare Core/workspace/CLI/Server/worker/native/render/Web/later-Skill path，并保存 keyless transcript。

## 7. 更新职责文档并运行兼容性 gate

- [x] 7.1 更新 `apps/dsh-univer-work/README.md` 与 `packages/client-core/README.md`，记录十二个 tool names、八个 approval mutations、review origin、signal/retry/result-unknown、core Skill 与明确非职责；依次运行 Client Core `typecheck`/`test`/`build`、DSH application `typecheck`/`test`/`build`/`package:verify`/`package:smoke`、CLI Worktree/Unit/open command contracts与 `workspace-skills-command.test.ts`、`pnpm package:workspace-cli`、`pnpm typecheck`、`pnpm test`、`pnpm build` 和 `git diff --check`，确认 CLI commands/output/Session/core Skill/package、Server/OpenAPI、SDK baseline 与发布流程未改变。
