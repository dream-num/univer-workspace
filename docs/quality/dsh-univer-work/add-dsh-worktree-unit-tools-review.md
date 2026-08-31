# add-dsh-worktree-unit-tools code review

本报告记录 Change `add-dsh-worktree-unit-tools` 的独立代码审查。逻辑基线是已验收的 Plugin Shell、
Authentication 与 Space/Node changes；审查只把本 Change 新增或修改的 Worktree/Unit/review/Skill 行为计入
finding。实现、QA 与 review 由相互独立的 subagent 执行。

## 审查依据

- `openspec/changes/add-dsh-worktree-unit-tools/` 的 proposal、design、tasks 与两份 delta spec。
- 根 `AGENTS.md`、`README.md`、`apps/workspace/CONTEXT.md`、权威 data model 与 ADR-0007。
- 已验收的 authenticated resolver、`WorkspaceToolOwner`、Space/Node closed-tool/error/approval boundary。
- Workspace Client Core 的 Worktree、Unit、open、stable-identity retry 与 result-unknown 实现。
- DeepSeek Harness `0.1.1-rc.2` commit
  `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` 的 ToolRuntime approval 顺序、Session argument records、
  cancellation finalizer 与 Skill registry 合同。

## 审查清单

### Spec / domain correctness

- [x] exact 十二个 snake_case tools；四个 read/review 与八个 mutation 分组正确。
- [x] Worktree list/get/create/update/lifecycle 与 Unit list/add/create 只调用对应 Client Core public operation，
  不复制 HTTP path、parser、Commander 或状态机。
- [x] User/Team Worktree、visibility、state、Worktree Unit source/target/type/change/merge/activation 字段符合
  CONTEXT 与 data model；identity mismatch 在输出前失败。
- [x] review URL 用同一次 authenticated operation 的 `WorkspaceHttp.origin`，不接受 viewer origin、不打开
  Browser。
- [x] closed parameter roots、exact own-key body gate、closed canonical output 与 value-only rendering 完整。

### Approval / security / rc.2 order

- [x] 八个 mutation names 以 own-key-safe exact match 进入 policy；其他工具和原有 auth/Node policy 正常委托。
- [x] 同一个纯 operation validator 在 rc.2 `ask` 前与 body 内复用，覆盖 unknown/non-enumerable/symbol key、
  type、enum、blank 与 cross-field conflict。
- [x] invalid mutation 不产生 approval interaction/event、credential read 或 HTTP；merge/discard 使用不同且无参数值
  的高影响提示。
- [x] Native 只允许 `tool/call.arguments`，Code Mode 只允许 start/settled 两个 DSH-owned argument records 保留原
  arguments；approval、result/failure 与 plugin-owned payload 不复制 secret sentinel。
- [x] frozen Core/Server error code 与 exact detail allowlist 完整；unknown code/provider/transport/cause/header/
  initial content fail closed 且不反射。

### Cancellation / result-unknown / lifecycle

- [x] Core optional signal 贯穿 resolver、每个 HTTP/getWorktree、sequential request、retry boundary、transition
  read-back；unsignalled CLI 行为不变。
- [x] aborted stable-identity attempt 不启动下一 attempt，可能已接受的 write 保持 bounded
  `workspace-result-unknown`。
- [x] pre-dispatch、accepted read、pre-request mutation、late confirmed success、owner-only success 与 owner-only
  unknown 的 caller/owner identity 正确。
- [x] finalizer 保留 DSH `ABORTED` identity，只附 operation-specific get/list/no-blind-replay guidance。
- [x] dispose 顺序覆盖 tools、approval policy、core Skill、active bodies；无 detached retry/read-back/listener/timer/
  Job/cache。

### Skill / package / compatibility

- [x] 一个随包 `skills/core/SKILL.md` 是唯一来源；通过 `ctx.skills.register()` 显式注册并随 fiber dispose。
- [x] Skill 只引用 Changes 2–4 已交付 tools，保持 new-Worktree-per-task、same-task rework、ready/review、explicit
  merge/discard/no-blind-replay；不声称未来内容/文件/runtime/其他 Skills。
- [x] package verify/smoke 检查 Markdown/catalog 一致、十二 tools/Skill、reachable Core inline、无 bare Core/
  workspace/CLI/Server/worker/native/render/Web/later resources。
- [x] 真实 ToolRuntime Native+Code Mode、Skill consumer、installed Agent/transcript 与 normal re-register/dispose 有
  直接证据。
- [x] Client Core、DSH、CLI focused/package 与仓库 gates 全绿；Server/OpenAPI/SDK/release 无本 Change diff。

### Ponytail full

- [x] 复用现有 Core、resolver、owner、closed-tool fragments 与 Skill registry。
- [x] 无 generic action/router、tool generator、schema framework、第二 service/controller/retry layer、provider/
  watcher/parser dependency 或未来能力 scaffolding。
- [x] 每个新增 abstraction 都有当前多个调用点或安全边界的直接需要；能用本地 map/fragment/native API 的地方
  不增加层级。

## Findings

### REV-WU-01：`workspace-result-unknown` 没有得到 operation-specific inspection/no-replay guidance

- Severity：high
- 状态：closed
- 位置：`apps/dsh-univer-work/src/worktree-unit.ts:477-489`
- Evidence：所有 mutation definitions 都安装 `mutationFinalizer(operation)`，但该 finalizer 只在
  `result.error.info.code === TOOL_ABORTED` 时返回 guidance。Core 已 dispatch 且无法确认结果时，tool error
  code 是 `workspace-result-unknown`，因此 finalizer 返回 `undefined`；模型只看到固定 error envelope，不会得到
  Worktree create→list、update/lifecycle→get、Unit add/create→list 的核对入口和“绝不自动 replay”约束。
  Delta spec 的 “Dispatched mutation remains uncertain” 明确要求 result-unknown 本身也携带这份
  operation-specific guidance，而不仅是 caller-aborted late success 的 DSH `ABORTED`。
- 最小修复：让同一个 finalizer 对 `TOOL_ABORTED` 和 `workspace-result-unknown` 两种 error code 返回现有固定
  guidance，保持 registry/error metadata identity 不变。用 real ToolRuntime 对至少 create、lifecycle、Unit
  family 的 dispatched unknown 断言 error code 原样且 content 分别指向 list/get/list，并禁止 replay 文案；无需
  新增 retry、result cache 或第二套 finalizer。
- 复验：`mutationFinalizer()` 现只对 `TOOL_ABORTED` 与 `workspace-result-unknown` 两种 identity 追加固定提示；
  real ToolRuntime 分别执行 Worktree create、ready 与 Unit add 的 uncertain mutation，三者均保留
  `workspace-result-unknown`，分别指向 Worktree list/get 与 Unit list，并包含 no-replay 文案。独立执行
  `pnpm --filter dsh-univer-work test` 通过（3 files / 143 tests）。

### REV-WU-02：Worktree/Unit Code Mode test 没有证明 approved mutation 的 canonical result 与 dispatch 配对

- Severity：medium
- 状态：closed
- 位置：`apps/dsh-univer-work/test/space-node.test.ts:966-1010`
- Evidence：该 test 已加入合法 `workspace_unit_create` 并断言一次 approval，但只检查顶层 `run_code`
  `isError: false`、credential read count 和 sentinel。fixture `ControlledCodeRuntime` 会捕获子调用异常并把它变成
  `{ error }` value，因此顶层成功与一次 credential read 不能证明 approved body 返回 canonical `{ unit }`。
  test 也只把 start/settled events 序列化找 sentinel，没有断言每个 dispatch 的同名、同 `subCallId` 配对和
  settled success/error。相邻 Space/Node Code Mode test 已在同一文件用这组直接断言；delta spec、Task 5 与
  QA AC-31 明确要求 valid approved mutation、canonical value/error 和 start/settled pairing。
- 最小修复：复用相邻 test 的 flatMap/assertion 形状，断言四个 dispatch 的 start names、settled error/success
  序列、`{ name, subCallId }` 一一相等，并从 `result.value.result` 断言最后的合法 Unit create 返回 closed
  `{ unit: { worktreeId, unitId, source, target, type } }`。不增加新 runtime、helper 或第二个 Code Mode test。
- 复验：同一 test 现断言四个 start names、settled `[error,error,success,success]`、逐项相同
  `{ name, subCallId }`，并从 `result.value.result` 直接确认 approved Unit create 的 Worktree/Unit identity、
  source、target 与 type。独立 DSH typecheck 和 full test 通过（3 files / 158 tests）。

### REV-WU-03：installed real Agent 没有执行 Worktree/Unit mutation vertical slice

- Severity：high
- 状态：closed
- 位置：`apps/dsh-univer-work/scripts/smoke-package.mjs:550-639`
- Evidence：installed `AgentLoop` 的 `agentCalls` 现执行 invalid Unit add、Space list/browse/find、Node create，随后只
  read Worktree list、Unit list 和 review URL。Worktree create、合法 Unit add/create、ready 与 get 都是在
  Agent Loop 外通过 direct `ctx.tools.execute()` 执行；因此 artifact smoke 证明了 installed registration/direct
  dispatch，却没有证明真实 installed Agent scheduler 能穿过 approval/body 并串联 Worktree/Unit workflow。
  Delta spec 的 installed transcript scenario、Task 6 与 QA AC-32 明确要求 installed real Agent 实际调用
  Worktree list/get/create、Unit list/add 或 create、ready/get/review vertical slice。
- 最小修复：在现有 `agentCalls`/adapter 中加入 valid `workspace_worktree_create`、
  `workspace_unit_create`（或 add）、`workspace_worktree_ready`、`workspace_worktree_get`，保留 list/Unit list/review，
  并断言除故意 invalid call 外每个真实 Agent result 都成功且 canonical IDs/state/target/URL 连贯。复用现有
  allowed-once listener 与 fake HTTP state；不要增加第二个 Agent、LLM adapter 或 smoke script。
- 复验：同一 installed Agent 现顺序执行 invalid Unit、Worktree create、Unit create、ready、get、原有
  Space/Node slice、Worktree list、Unit list 与 review；除故意 invalid call 外结果全成功，render/read-back、
  fake authoritative target 和 review URL 共同确认 `wt-1`/`unit-1`/`space-1`/`ready` 连贯。独立
  `package:smoke` 通过。

### REV-WU-04：installed catalog body 未与 tarball 中的唯一 Skill source 做一致性检查

- Severity：medium
- 状态：closed
- 位置：`apps/dsh-univer-work/scripts/smoke-package.mjs:434-445`；
  `apps/dsh-univer-work/scripts/verify-package.mjs:125-127`
- Evidence：source test 会把 source registry body 与 checkout Markdown 比较；package verify 只分别扫描
  `dist/index.js` 与 `skills/core/SKILL.md` 的关键字；installed smoke 则只比较 runtime catalog 与 `skill`
  consumer，而二者都读取 bundle 内嵌 body。没有任何 installed/packed assertion 把 catalog content 与 tarball
  内实际 `skills/core/SKILL.md` byte 内容相等，因此 compiled raw import 与随包唯一 source 发生漂移时现有三组
  checks 仍可能全绿。Delta design、Task 6、Skill registration scenario 与 QA AC-26 均要求 packed Markdown 和
  installed catalog body 一致。
- 最小修复：在现有 installed smoke 中用其已有 `profileRoot`/`readFile` 读取安装后的
  `node_modules/dsh-univer-work/skills/core/SKILL.md`（通过 resolved package root，而非 checkout path），并直接
  `assert.equal(coreSkill.content, installedMarkdown)`；保留现有 real `skill` consumer equality。无需 hash、第二份
  fixture 或 verify helper。
- 复验：installed smoke 现从 `require.resolve("dsh-univer-work")` 的实际安装根读取 packed Markdown，直接断言
  catalog body byte-equal，并继续通过 real `skill` consumer；normal remount 也重新查询并确认 12 个
  Worktree/Unit tools。独立 `package:smoke` 通过。

## 独立验证

- Client Core：`typecheck`、27 files / 470 tests、`build` 全部通过。
- DSH application：`typecheck`、3 files / 158 tests、`build`、`package:verify`、`package:smoke` 全部通过；
  installed smoke 使用 actual tarball、真实 Agent scheduler、Native/Code Mode、approval、core Skill consumer 与
  normal re-register/dispose。
- CLI compatibility：Worktree/Unit/open/Skill focused package tests 通过；`pnpm package:workspace-cli` 通过。
- repository：`pnpm typecheck`、`pnpm test`、`pnpm build`、OpenSpec strict 与 `git diff --check` 全部通过。
- Ponytail full：实现复用现有 Client Core、authenticated resolver、execution owner、closed-tool wrapper 与
  native Skill registry；新增 local validator/schema/lifecycle maps 直接服务当前十二个工具和安全边界，没有引入
  generic router、schema framework、第二 retry/service layer 或未来能力 scaffolding。

## 最终结论

**PASS。** Tasks 1–7 与全部审查清单均完成；REV-WU-01..04 均已修复并通过独立复验，当前
**0 个 open findings**。
