# add-dsh-univer-work-authentication code review

本报告记录 Change `add-dsh-univer-work-authentication` 的独立代码审查。逻辑基线是
Plugin Shell 已验收状态；审查只覆盖 Auth 新增或修改的行为，不把未回归的 Shell 历史 diff
计入 finding。实现、QA 与 review 由相互独立的 subagent 执行。

## 审查依据

- `openspec/changes/add-dsh-univer-work-authentication/` 的 proposal、design、tasks 与两份 delta spec。
- `apps/workspace/CONTEXT.md`、ADR-0007、两份 DSH 研究记录和已完成的 Client Core auth extraction artifacts。
- DeepSeek Harness `0.1.1-rc.2` commit
  `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` 的 Credentials、`defineTool`、ToolRuntime、
  `tools/pre-execute`、Native/Code Mode durable event 合同。
- Workspace Client Core auth/http/error 源码、测试和 package exports。

## 审查范围

- Spec/correctness：四个 tool、完整状态词汇、单次 exchange、per-operation resolver。
- Security：exact-shape grant、handoff allowlist、secret/error sanitization、approval fail-closed。
- Concurrency/state：process-local mutation queue、provider atomic transition、expiry 与 rotation。
- Cancellation/dispose：execution/owner signal、accepted body drain、logout non-cancellable delete。
- Packaging：Client Core 内联、DSH/Cordis external、安装态 closure 和 smoke。
- Ponytail：复用现有 Core/DSH seam，不增加单实现抽象、未来 capability scaffolding 或重复 transport。

## Findings

### REV-AUTH-01：optional signal 以显式 `undefined` 写入 exact optional request options

- Severity：low
- 状态：closed
- 位置：`packages/client-core/src/auth.ts:48,106,129,143`（首轮中间实现）
- Evidence：`pnpm --filter @univerjs/univer-workspace-client-core typecheck` 在四处报
  `TS2379`；仓库开启 `exactOptionalPropertyTypes`，`signal?: AbortSignal` 不接受
  `{ signal: undefined }`。
- 最小修复：signal 缺失时省略该属性，存在时再扩展 `{ signal }`；不改变 API 或增加 overload。
- Closure evidence：实现 subagent 已将四处调用改为条件属性；最终稳定基线继续复验
  Client Core typecheck/test。

### REV-AUTH-02：post-request callback 遇到 malformed record 返回错误的状态分类

- Severity：medium
- 状态：closed
- 位置：`apps/dsh-univer-work/src/authentication.ts:336-343`
- Evidence：start/complete 的 Server 请求成功后，`commit()` 在 provider 的原子 callback 内直接
  调用 `parseWorkspaceGrantRecord(record)`。若 out-of-band writer 把 owner key 改为 malformed
  grant 或其他 kind，parser 抛 `WorkspaceCredentialError`，tool 最终报告
  `workspace-credential-invalid`。Spec 的 “Post-request credential transition is rejected” 要求
  callback 观察到任何不再允许 intended transition 的 record 时保留现值并报告
  `workspace-authentication-state-conflict`；未提交的 handoff/User 也不得进入结果。
- 最小修复：只在 `commit()` 的 callback 内把 observed-record parse failure 当成 CAS mismatch，
  返回 `undefined` 且保持 `committed = false`，由 callback 外统一抛 `stateConflict()`；补
  start/complete 的 malformed/other-kind callback fixture，断言 record 未变、请求不重试且结果
  无 handoff/subject。
- Closure evidence：`commit()` 只在原子 callback 内捕获 `WorkspaceCredentialError` 并返回
  `undefined`，callback 外统一产生 `workspace-authentication-state-conflict`。start 与 complete
  fixture 均把 callback observation 改为 other-kind record，证明各自只发一个 request、保留
  observed record，且结果不含 device code、未提交 User 或 cookie。复验 focused suite 为
  2 files / 21 tests PASS。

### REV-AUTH-03：contract-valid expiry 可在 grant 已提交后使 result rendering 抛错

- Severity：medium
- 状态：closed
- 位置：`apps/dsh-univer-work/src/authentication.ts:127-130`
- Evidence：start render 无条件执行 `new Date(value.expiresAt).toISOString()`。Workspace
  OpenAPI 对 `expiresIn` 只有 integer 与 minimum 1，没有 maximum；例如
  `expiresIn = 8_700_000_000_000` 产生超出 ECMAScript Date ±8.64e15 范围、但仍是 safe integer
  的 `expiresAt`。Core 与 Host validation 接受并提交 pending grant，随后 pure render 抛
  `Invalid time value`，ToolRuntime 返回 `INVALID_TOOL_OUTPUT`。模型收不到 handoff；再次 start
  复用同一 record 后继续失败。
- 最小修复：render 不假定 expiresAt 落在 Date domain；有效时输出 ISO，超界时输出原始整数
  timestamp，或在任何 credential write 前一致地拒绝该响应。补超 Date domain start fixture，
  证明 result 成功、handoff 不泄密且 stored/result 状态一致。
- Closure evidence：`renderExpiry()` 只对有效 Date 输出 ISO，超界时保留整数 timestamp；
  OpenAPI-valid 超界 fixture 证明 start success、render/result 与 committed pending 使用同一
  expiresAt。复验 Vite SSR build 与 focused suite 为 2 files / 22 tests PASS。

### REV-AUTH-04：Server-controlled error code 可把 device code 或 cookie 写入 durable transcript

- Severity：high
- 状态：closed
- 位置：`apps/dsh-univer-work/src/authentication.ts:419-426`、
  `packages/client-core/src/http.ts:111-122`
- Evidence：Client Core 把非 2xx JSON 的任意 string/number `error.code` 原样装入
  `WorkspaceApplicationError`；Auth `sanitize()` 又把该 code 原样用作 `HarnessError` code。
  complete request 已把 device code 发给 Server，authenticated whoami/logout request 已把 cookie
  发给 Server；被攻陷或行为异常的 Server 可返回 `{ error: { code: <所见 secret> } }`。最终
  `error.info.code` 会进入模型可见且 durable 的 Native/Code Mode result/event。固定 message
  不能阻止 code 泄漏，违反 transcript 不含 device code/cookie 以及“仅保留 recognized stable
  Workspace code”的设计要求。当前 Workspace Server 的 Auth 稳定 code 是有限集合
  `CLI_AUTHORIZATION_INVALID`、`CLI_AUTHORIZATION_EXPIRED`、`CLI_AUTHORIZATION_UNAVAILABLE`
  与通用认证 code；Core 自身也只产生已知 `workspace-*` code。
- 最小修复：Auth boundary 仅允许明确认可的稳定 code 进入 Harness error；其他 server-provided
  code 回退到 operation-specific 固定 code。补 complete error-code=deviceCode 与
  whoami/logout error-code=cookie 的 Native/Code durable transcript fixture，断言 secret 不在
  tool result、throwable 或 persisted event 中，同时保留一个合法稳定 code 的回归断言。
- Closure evidence：Auth allowlist 现在只含当前 Core auth/HTTP code 与 Workspace Server 的三条
  `CLI_AUTHORIZATION_*` code；其余 code 回退为 operation code。focused transcript 对 complete
  device-code、whoami/logout cookie code 做 negative scan，并证明真实
  `CLI_AUTHORIZATION_INVALID` 仍保留。独立复验 2 files / 34 tests PASS。

### REV-AUTH-05：Server-controlled User/origin 可把 device code 或 cookie 写入成功结果

- Severity：high
- 状态：closed
- 位置：`apps/dsh-univer-work/src/authentication.ts:275-285,289-295`、
  `apps/dsh-univer-work/src/authentication-state.ts:154-173`、
  `packages/client-core/src/auth.ts:125-136,150-174`
- Evidence：Core completion/whoami 只检查 User fields 是 string，Host authenticated parser 只检查
  non-empty/exact shape。complete response 同时携带 Server 所见 device code、新发 cookie 与
  Server-controlled User；whoami Server 同样已收到 cookie。若 User id/displayName 等于或包含这些
  secret，complete/whoami 的 canonical success value 与 renderer 会原样输出，随后进入 durable
  transcript。现有 handoff validator 已把同类 secret reflection 作为 hostile response 处理；成功
  subject 缺少对应检查，违反 device code/cookie 不进入 result/rendering/Session 的绝对约束。
  同理，Core 只要求 `Set-Cookie` 首段 non-empty：Server 可选择一个等于 origin hostname 的 malformed
  cookie，当前 authenticated parser 会接受，而 completion success 又会输出包含该 cookie 的 origin。
- 最小修复：在任何 authenticated subject 存储或返回前，以该操作实际持有的 pending device code
  和/或 authenticated cookie 检查所有 model-visible fields（subject id/name 与 completion origin），命中则返回固定
  `workspace-invalid-response`（不得提交新 grant）。补 completion 的 subject=deviceCode/cookie 与
  whoami 的 subject=cookie fixture，覆盖 canonical result、rendering 和 durable event 均不含 secret。
- Closure evidence：authenticated grant parser 排除 cookie 在 origin/subject 的 raw/decoded reflection；
  completion 还在 commit 前排除 pending device code 与新 cookie 出现在 subject，whoami 使用同一次
  resolver read 持有的 credential 检查 Server subject。四类 hostile fixture 均得到固定
  `workspace-invalid-response`，completion 保留 pending record；focused transcript negative scan PASS。

### REV-AUTH-06：malformed percent in Server User 被误报为 stored credential invalid

- Severity：low
- 状态：closed
- 位置：`apps/dsh-univer-work/src/authentication-state.ts:124-131,210-216`、
  `apps/dsh-univer-work/src/authentication.ts:275-280,293-300`
- Evidence：新增的 `subjectExposesSecrets()` 复用了 `exposesSecret()`；后者遇到无法
  `decodeURIComponent()` 的 string 会抛 `WorkspaceCredentialError`。Core 允许任意 string User
  id/displayName，因此 complete/whoami 的 Server response subject=`"%"` 会绕过预期
  `invalidResponse()` 分支，被 tool 映射为 `workspace-credential-invalid`，误称现有 stored grant
  损坏。该响应来自 Server，不是 credential provider；pending/authenticated local record 本身有效。
- 最小修复：secret predicate 对无法 decode 的 model-visible field 返回 unsafe/rejected，而不是抛
  credential-domain error；由 complete/whoami 的 caller 统一产生 `workspace-invalid-response`。
  Persisted grant parser 仍会因 predicate=true 产生 `WorkspaceCredentialError`。补两条 malformed-percent
  subject 分类 fixture。
- Closure evidence：secret predicate 的 decode failure 现在返回 unsafe=true；completion/whoami 的
  `%` subject fixture 均得到 `workspace-invalid-response`，completion 未改变 pending record。独立
  focused suite PASS。

### REV-AUTH-07：start/complete 在 credential read 期间 abort 后仍可返回成功或开始删除

- Severity：medium
- 状态：closed
- 位置：`apps/dsh-univer-work/src/authentication.ts:243-260,270-297`
- Evidence：start/complete 仅在 `await readGrant()` 前检查 fused signal。若 caller cancellation 或
  owner disposal 发生在一个阻塞的 provider read 期间，read 返回后 start 可复用 live pending 并
  返回 `authorization_required`，complete 可返回 missing/already-authenticated，或两者可在 expired
  分支开始新的 `deleteRecord()`；这些路径在返回/写入前均未再次观察 abort。Core-request 分支稍后
  有检查，无法覆盖 no-request branches。owner disposal 会等待 body，却不能阻止它在 owner abort
  后报告成功或开始 expiry transition，与 lifecycle decision 中“abort owner signal”及在尚未开始
  provider transition 时观察 abort 的约束不一致。
- 最小修复：每次 awaited credential read 后、任何 state return/delete/request 之前重新
  `throwIfAborted(signal)`；若 expiry delete 已开始则允许它 settle，但在返回 canonical success 前
  再观察 signal。补 gated provider read 的 caller/owner abort table，覆盖 start pending reuse、complete
  missing/authenticated/expired，断言 abort 后不开始新 request/delete，disposer 仍等待 read/body settle。
- Closure evidence：start/complete 现在通过 signal-aware `readGrant()` 在 raw provider value 返回后、
  parse 或 state branch 前检查 fused signal；expiry delete settle 后也在继续 request/返回前复查。caller
  与 owner 两种 abort source 乘以 start-reuse、complete missing/authenticated/expired/invalid 的 10 条
  gated-read fixture 均证明 0 HTTP、0 delete、tool failure，owner disposer 等待 read/body。独立复验
  2 files / 44 tests PASS。

### REV-AUTH-08：pending completion 在 Core I/O 后未观察 owner/caller abort

- Severity：low
- 状态：closed
- 位置：`apps/dsh-univer-work/src/authentication.ts:281-299`
- Evidence：`completeCliLogin()` settle 后，代码先对 `result.status === "pending"` 直接返回 handoff；
  fused signal 的下一次检查只在 authenticated branch 的 credential commit 前。Design decision 8 明确
  start 与 complete 在 Core I/O 后检查 fused signal。若 transport 收到但未遵守 abort（或 abort 与
  已取得 202 response 同时发生），owner disposal 后 accepted complete 仍可报告
  `authorization_pending`；authenticated path 不会发生同样的 return，因为 commit 前已有检查。
- 最小修复：把 `throwIfAborted(signal)` 放在 `await completeCliLogin(...)` 紧后、status 分支之前；补
  abort-aware-but-success-settling 202 fetcher fixture，证明 signal 到达且 pending result 不在 abort 后返回。
- Closure evidence：complete 在 Core settle 紧后、任何 pending/authenticated branch 前检查 fused
  signal；start 同步收紧为 Core settle 后、response parse/storage 前检查。两个 transport fixture 都
  观察 owner abort 但故意 resolve success/202，tool 均返回 sanitized failure、保留 credential state 且
  不返回 handoff/success。实现还把同一规则覆盖到 resolver raw read 与 whoami Core settle，并增加
  caller/owner gated authenticated-read 与 owner-abort-but-transport-resolves fixtures。独立复验
  2 files / 49 tests PASS。

## Final audit

**PASS，0 open findings。** 九条 review finding 均已修复并复验；Plugin Shell 前置行为未回归。

- Spec/correctness：7/7 tasks 完成；四个 canonical tool、single-origin state machine、single-exchange、
  per-operation resolver、logout approval/finally 与 recognized error taxonomy 均和 delta spec/design 一致。
- Security/transcript：strict grant/handoff validation、Server error/User secret-reflection guards 与固定失败
  presentation 已覆盖；真实 ToolRuntime result 加 Native/Code Mode durable Session projection 的 sentinel
  scan 不含 password、device code、cookie、`Set-Cookie`、grant 或 dependency cause。
- Concurrency/lifecycle：mutation queue、atomic CAS conflict、caller/owner cancellation、provider-read race、
  transport late-success、四条 Core I/O dispose、queued logout non-cancellable delete、signal listener 与 approval
  gate cleanup 均有直接 fixture；Post-QA 最终 focused suite 为 2 files / 53 tests PASS。
- Bundle/Ponytail：Client Core 只从根 export 复用并内联；bundle 35 modules / 34.25 kB，tarball 仅 5 files，
  无 bare Client Core/workspace runtime dependency 或 deferred capability asset。实现未增加 authorization
  service、poller、Job、timer、password path、public service abstraction 或第二套 runtime graph；新增的
  `dsh-code-runtime` 是 exact test-only dev dependency，不进入 artifact。
- 独立 review gates：Client Core typecheck 与 27 files / 457 tests、DSH typecheck、53 tests、
  `package:verify`、installed `package:smoke`（四 schema execute/dispose + real Agent scheduler dispatch + Host
  normal stop）、OpenSpec strict、
  `git diff --check` 全部 PASS。实现 subagent 另报告 Client Core/build、CLI auth 17 tests、CLI package、
  repository typecheck/test/build 全部 PASS；Server/OpenAPI、CLI Session/command/output 与 release paths 无 diff。

## Post-QA incremental review

AUTH-QA-001/002/003 后重新审查 exact optional peers、real Code Mode/Agent scheduler、logout table 与
planning projection。本节 finding 关闭后才恢复最终 0-open 结论。

### REV-AUTH-09：shared test setup 重复安装 SystemPrompt

- Severity：low
- 状态：closed
- 位置：`apps/dsh-univer-work/test/authentication.test.ts:933-934`
- Evidence：通用 `setup()` 连续两次执行同一个 `await ctx.plugin(SystemPrompt)`。第二次没有为 Auth
  fixture 提供不同 config 或独立 service，且该重复仅出现在 QA test delta；它会让 lifecycle/service
  composition 证据依赖 Cordis 对重复 plugin 的偶然处理，并增加无意义 setup work。
- 最小修复：删除第二次相同安装；重新运行 typecheck 与 focused suite，确认 Native/lifecycle/logout
  fixtures 仍通过。
- Closure evidence：并发写入稳定后，通用 `setup()` 只在 line 935 安装一次 SystemPrompt；独立
  `setupCodeMode()` 的 line 960 属于另一 Context 且为 Code Mode fixture 所需。`rg` 总计两处、各自
  一次；独立 typecheck 与 2 files / 53 tests PASS。

### Post-QA final audit

**PASS，0 open findings。** AUTH-QA-001/002/003 的 test/packaging/planning delta 未重开 Auth 行为 finding。

- Module identity：四个 Host contracts 从 runtime dependencies 改为 exact optional peers，并以同版本
  devDependencies 支撑本地构建；这符合 DSH rc.2 `healProfilesModuleFallback()` 对 out-of-tree Service
  Definition peers 的合同。packed manifest 无 `dependencies`，optional peer map 完整且无 workspace range。
- Installed execution：升级后的 smoke 从 fresh profile resolution 加载 Host Llm/Session/ToolRuntime/
  AgentLoop，以 scripted adapter 产生真实 `workspace_auth_complete` call；scheduler 成功 dispatch，durable
  `tool/call`/`tool/result` 成对存在且内容为 missing canonical result，随后 plugin/Host 正常 dispose。
- Coverage：real `run_code` binding 产生两组真实 code-dispatch start/settle events并覆盖 success/error
  secret scan；approved absent/pending/invalid logout 均证明 zero HTTP、safe local clear 与 record absent。
- Planning：design decision 7、package README 与 `change.html` 均明确 exact optional peers/module fallback/
  shared Host identity；proposal、delta specs、7/7 tasks 与该 packaging correction 无冲突。
- 增量独立 gates：DSH typecheck、2 files / 53 tests、35 modules / 34.25 kB build、5-file
  `package:verify`、real-Agent `package:smoke`、OpenSpec strict 与 `git diff --check` 全部 PASS。

## Parity predecessor repair review

本轮只审查 bundled-Skills 最终产品树
`17cbb1bdac05441cc46ddd1fce0e2e5f7a8eb53d` 之后的 Auth predecessor repair：
`apps/dsh-univer-work/src/authentication.ts` blob
`22dcf24f1f265ce68e74bbdfaf8992fb2672ac60` 与
`apps/dsh-univer-work/test/authentication.test.ts` blob
`20468bd80338e4a3f91744a0ef3ad8642419d98b`。Parity planning/Task 1、尚未接受的
registry snapshot，以及 `workspace_blob_upload` 的 invalid-before-approval 缺口属于下游
Parity 或其他 owner，不计为 Auth finding。

**PASS，Standards 0 open，Spec 0 open。** 两个独立 review axis 均确认 repair 保持 Auth
既有合同与 owner 边界。

- 四个 auth parameter root 均投影 `additionalProperties: false`；既有 object output root 与
  `oneOf` branch 继续 closed。Auth-local wrapper 先检查普通或 null-prototype object 的 exact own
  keys，再委托原 `defineTool` 完成类型校验，因此没有放宽 `origin` 或 canonical output 合同。
- DeepSeek Harness rc.2 的真实顺序为 arguments snapshot/deep-freeze、`tools/pre-execute`、approval、
  definition body、result materialization。Logout listener 在 `ask` 前执行同一 exact-key validator；
  其余三条在 Auth owner、credential provider 与 HTTP 之前执行。额外 own key 固定投影为不回显
  参数的 `INVALID_ARGS`。
- 四条真实 ToolRuntime 回归均等待 invalid execution settle 后断言 credential read/modify/delete、
  HTTP 与 approval 为零，再执行同 fixture 的合法调用；四条 canonical status、每次一次 HTTP，以及
  logout 一次 approval 均保持不变，不依赖时序窗口或伪造 body。
- Standards 轴逐项检查 Mysterious Name、Duplicated Code、Feature Envy、Data Clumps、Primitive
  Obsession、Repeated Switches、Shotgun Surgery、Divergent Change、Speculative Generality、Message
  Chains、Middle Man 与 Refused Bequest，均无受仓库标准支持的 finding。两段 Auth-local 小函数是
  bounded repair，不需要依赖下游 Space/Node helper，也没有增加 provider、root、watcher 或通用框架。
- 独立复验：Auth focused 1 file / 63 tests、DSH typecheck、`package:verify`、Auth OpenSpec strict 与
  窄 `git diff --check` 全部 PASS。独立 QA 报告 blob
  `342cc14f8a732662f502c96edcddf42e671b774e` 也给出 Auth repair PASS、0 Auth open findings。
