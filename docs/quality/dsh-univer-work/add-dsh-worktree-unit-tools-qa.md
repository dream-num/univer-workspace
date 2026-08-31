# add-dsh-worktree-unit-tools QA

本文件定义并记录 Change `add-dsh-worktree-unit-tools` 的独立验收。实现、QA 与 code review
由相互独立的 subagent 执行。本报告不替代 OpenSpec task 勾选，也不修改产品代码或 planning
artifacts。

## 环境与边界

- Univer Workspace 使用 Node.js 24+、pnpm 11 与 SDK baseline `1.0.0-beta.2`；真实 Server 固定为
  `http://127.0.0.1:3020`。不得执行 `db:reset`，不得修改既有用户 Node、Resource 或 Worktree。
- DeepSeek Harness 使用真实 checkout
  `/Users/shenweimin/github.com/deepseek-ai/deepseek-harness`、commit
  `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`、CLI `0.1.1-rc.2`。安装态使用隔离 profile；
  不修改用户现有 DSH profile。
- 真实端到端路径从本 Change 生成的 actual tarball 安装，不用 workspace link、源码 overlay、CLI
  subprocess 或相邻 checkout runtime import。DSH checkout 只提供冻结 Host/runtime。
- 用户已授权后续 Workspace auth 与 Full access QA。需要新 grant 时由 root 直接用 Chrome 完成
  approval，不读取 cookie、storage 或 password；QA 不因普通 auth handoff 阻塞。
- 真实写入只创建带唯一 QA 前缀的新 User Worktree 或 Team Worktree（若已有可写 Team Space）以及
  QA-owned Worktree-local Unit；可选 existing Resource staging 只能使用本轮明确选定且有权限的 QA
  Resource。结束时只 discard 本轮 QA Worktree，不 merge，不触碰其他用户内容。
- device code、Login Session cookie、完整 grant、User identity、原始 transcript 与 secret sentinel
  不写入报告。临时 IDs 与 raw evidence 仅保存在权限收紧的临时目录，结束后删除。

## 验收标准

### Client Core cancellation 与既有 workflow

- **AC-01** `WorkspaceWorktreeFeature` 的 list/get/create/update/transition、`WorkspaceUnitFeature` 的
  list/add/create 与 `WorkspaceOpenFeature.createUrl` 只追加向后兼容的 final optional
  `AbortSignal`；现有无 signal CLI caller 的类型、endpoint、request mapping、retry count、read-back、
  error code 与 output 不变。
- **AC-02** abort-observing resolver/fetcher 证明每个 authenticated resolver、HTTP request、shared
  `getWorktree`、sequential step 与 lifecycle read-back 收到同一 signal；已 abort 时不开始下一步。
- **AC-03** Worktree create、Unit add/create 的 stable identity retry 在 uncertain attempt 后观察 abort，
  不启动下一次 request，并保留 `workspace-result-unknown` 与原有 bounded public identity。
- **AC-04** lifecycle 在 transition dispatch 前仍验证 state；lost response 只做原有一次 read-back，不
  replay transition。read-back abort 或未确认目标 state 返回 `workspace-result-unknown`；已确认结果可由
  Core 返回，DSH caller cancellation 仍由 ToolRuntime 收敛为 `ABORTED`。

### 十二个 closed tools 与 canonical output

- **AC-05** 真实 Native `ToolRuntime.schemas()` 与 Code Mode SDK 精确发现十二个新名称：
  `workspace_worktree_list`、`workspace_worktree_get`、`workspace_worktree_create`、
  `workspace_worktree_update`、`workspace_worktree_ready`、`workspace_worktree_reopen`、
  `workspace_worktree_merge`、`workspace_worktree_discard`、`workspace_unit_list`、
  `workspace_unit_add`、`workspace_unit_create`、`workspace_worktree_review_url`；既有 auth 与 Space/Node
  tools 保持存在，不增加 generic action/transition tool。
- **AC-06** 十二个 parameter roots 均为 `additionalProperties: false`，只接受各 operation 的 snake_case
  keys。catalog 不暴露 credential、cookie、password、origin/viewer URL、local path、command、arbitrary
  JSON、content script 或 `initial_data`。
- **AC-07** list 默认 `view: active`；`space_id` 仅与 `scope: space` 共存。create 的 user scope 拒绝
  `space_id`/`visibility`；space scope 要求 `space_id` 且 visibility 默认 private。update 至少包含 name 或
  visibility。所有 required IDs/name/idempotency key 非空，Unit type 精确为 sheet/doc/slide/base/board。
- **AC-08** 四个 read/review tool 的 body gate 与八个 mutation 的 policy/body shared validator 拒绝
  non-plain root、unknown own key、wrong primitive、invalid enum、blank identity 和 cross-field conflict；
  credential resolver/HTTP 前失败且不回显 rejected key/value。
- **AC-09** Worktree list/get/create/update/lifecycle 返回 closed `{ worktrees }` 或 `{ worktree }`；完整
  canonical Worktree、Units、state、scope、visibility、identity 经严格解析，identity/state mismatch 在
  render 或 Code Mode value 前拒绝。
- **AC-10** Unit list/add/create 返回 closed `{ units }` 或 `{ unit }`；list 中每个 Unit 属于 requested
  Worktree，add 只确认 trunk-backed Resource membership 且无 activation target，create 只确认
  Worktree-local source、target Space/parent、type/name 与 stable identity。
- **AC-11** review tool 在同一次 operation 中解析一次 authenticated `WorkspaceHttp`，用其 `origin`
  构造 `/worktrees?...&view=agent`；zero/many Units 要求 explicit unit，missing Unit 与 invalid viewer URL
  保留 Core code，不打开浏览器、不接受 caller origin。
- **AC-12** valid render 只展示 canonical stable identity/state/target/URL；完整 lossless value 单独保留。
  missing/extra/non-JSON/wrong-enum/wrong-identity canonical output 统一在 render 前以
  `INVALID_TOOL_OUTPUT` 拒绝。

### Approval、错误与秘密边界

- **AC-13** 单一 fiber-owned `tools/pre-execute` policy 精确匹配八个 mutation names；四个 read/review
  委托 `next()`。每个 mutation 先运行对应 shared validator，合法输入才返回 fixed secret-free `ask`，
  body 再防御性复验同一 canonical input。
- **AC-14** invalid mutation 产生固定 `workspace-argument-invalid` 且零 approval asked/decided、零 credential、
  零 HTTP。Native 只允许 `tool/call.arguments`，Code Mode 只允许 start 与 settled dispatch arguments
  保留 DSH-owned 原始输入；approval、result/failure、plugin-owned payload/log 均不得复制 sentinel。
- **AC-15** `allowed-once` 仅执行一次对应 body；deny/cancel/unavailable/no-channel/missing approval service/
  no agent/policy `never` 全部在 resolver/HTTP 前 fail closed。mutation definition 不把 approval 下沉至 body。
- **AC-16** merge 与 discard 是独立 names，使用不同 fixed high-impact wording 且不含 Worktree ID/name；
  update 或 generic lifecycle 无法到达这两个 terminal operation。Skill 也要求 explicit user request。
- **AC-17** allowlisted Core codes完整覆盖 argument/response/mismatch/unknown/lifecycle/viewer/open-unit/unit-not-found/
  origin/auth/request/redirect；Server codes只允许 UNAUTHENTICATED、INVALID_INPUT、FORBIDDEN、NOT_FOUND、
  CONFLICT、INTERNAL_ERROR。metadata code 与 deterministic failure envelope 一致。
- **AC-18** safe detail 只保留 status/path 与明确 Worktree/Unit/Resource/Space/parent/idempotency/state/count
  identity；nested requested/actual 使用 exact projection。`initialData`、unknown field、non-JSON value、
  password/cookie/Set-Cookie/grant/cause/message 不跨 boundary。
- **AC-19** unlisted code、resolver/provider/transport/parser throw 与 unsafe material 均映射固定
  `workspace-operation-failed`，不复制原 code/message/detail/cause；Native、Code Mode 与 keyless installed
  transcript 均执行 sentinel negative scan。

### Cancellation、result-unknown 与 lifecycle owner

- **AC-20** body 从接受起使用 caller 与 owner 的 fused signal，跟踪 resolver、HTTP、retry、read-back、
  render 直到 settle，并保留来源以区分 `workspace-operation-cancelled` 与
  `workspace-plugin-disposing`。
- **AC-21** caller 在 body dispatch 前 abort 时真实 ToolRuntime 返回 `ABORTED_BEFORE_DISPATCH`，无 resolver、
  approval、Skill lookup 或 HTTP。read/review 在 body 中 abort 不返回 partial success，也不开始后续 request。
- **AC-22** dispatched uncertain mutation 在 caller/owner abort 后仍保持 `workspace-result-unknown`，不改写
  cancelled/disposing/success，不新增 shell retry；final content 只提供 get/list inspection 与 no-blind-replay
  guidance。
- **AC-23** caller abort 与 late confirmed success race 由 rc.2 返回 canonical `ABORTED`，finalizer 不改变
  registry error identity；create 指向 Worktree list，update/lifecycle 指向 Worktree get，Unit add/create 指向
  Unit list。
- **AC-24** owner-only disposal 不 abort caller signal；已确认 mutation 可返回 success，未确认 write 仍为
  result-unknown。dispose 停止 admission，注销十二 tools、八-name policy 与 core Skill，abort owner I/O，
  drain accepted bodies，最终无 request/retry/read-back/listener/timer/Job/cache/Skill contribution。

### Bundled core Skill

- **AC-25** package 只含一个静态 `skills/core/SKILL.md`，Host 声明现有 skills injection 并用
  `ctx.skills.register()` 注册 name `core`、source `bundled`；不增加 provider、watcher、parser dependency 或
  第二份 runtime body。
- **AC-26** real Skill catalog 与 `skill` consumer 可按 model/user invocation load body；registered body 与
  packed Markdown byte/semantic一致，fiber disposal 后 contribution 消失。
- **AC-27** body 只教已交付 auth、Space/Node、每个新任务新 Worktree、same-task rework/reopen、existing
  Resource staging、Worktree-local Unit create、ready/read-back/review、explicit merge/discard 和 unknown/
  aborted inspect-before-retry。
- **AC-28** body 不声称 Blob/file、content authoring、execute/inspect、worker、Office、Typst、SVG、render/
  screenshot/lint、API/resource discovery、其余 Skills、Web 或 non-local execution 已交付；示例不含 CLI
  commands 或未来 tool names。

### Artifact、Native/Code Mode、真实 Agent 与 Workspace

- **AC-29** actual tarball 内联 reachable Worktree/Unit/open Client Core；manifest 无 `workspace:*` runtime
  dependency、bare private Core 或 CLI/Server source import；exact DSH/Cordis 保持 external，不携带 worker、
  native/browser/render/Web/later-Skill 资源。
- **AC-30** isolated installed `package:smoke` 发现十二 closed schemas 与 loadable core Skill，覆盖 invalid
  pre-ask、representative read、deny/allow、lifecycle、Unit、review、allowlisted/unlisted error、abort/
  result-unknown、Skill dispose 与 Host normal shutdown，并保留 keyless sanitized transcript。
- **AC-31** real Code Mode 经 `run_code` generated SDK dispatch 代表 read 与 mutation；start/settled event 的
  name/subCallId 成对，canonical value/error、approval 与 DSH-owned argument retention 符合 AC-14。
- **AC-32** installed real Agent scheduler 从 tarball 发现并实际调用 Worktree list/get/create、Unit list/add
  或 create、ready/get/review 的 vertical slice；不 direct import source、不调用 Workspace CLI subprocess。
- **AC-33** real Workspace `:3020` 使用 QA-only Worktree：create 一次，get/list read-back identity 一致；stage
  一个 QA Resource 或 create 一个 Worktree-local Unit；Unit list identity/source/target 一致；ready 后 get
  确认 state，review URL origin/IDs/type 正确。每次 mutation 只发一次 shell call，0 blind replay。
- **AC-34** real path 同时覆盖 same-task `reopen` 后再次 ready；不执行 merge。最后用户已明确允许的
  discard 只作用于本轮 QA Worktree，get/list 确认 processed terminal state；若任何 outcome unknown，停止
  mutation 并只用 get/list/Browser 检查。
- **AC-35** Host 正常退出；tarball、临时 approval answerer、raw Sessions、sentinels 与 ID files 删除。可复用
  authenticated profile 只保留 credential/settings，报告仅记录非秘密 locator。

### Compatibility、文档与 gates

- **AC-36** 两个 README 准确记录十二 names、八个 approval mutations、review origin、signal/retry/
  result-unknown、core Skill、Host-only/private/no-release 及明确非职责，不把后续 Change 写成当前事实。
- **AC-37** CLI Worktree/Unit/open command contracts、output、Session、core Skill snapshot 与 installed package
  保持不变；Server/OpenAPI/Browser/database、SDK baseline、release workflow 无本 Change 越界 diff。
- **AC-38** Client Core、DSH、CLI focused/package、OpenSpec strict、repository typecheck/test/build 与
  `git diff --check` 全部退出 0；flaky/retry-only green 不能关闭 issue，必须先确认 root cause。

验收项总数：**38**。

## OpenSpec scenario → 直接证据

| Scenario group | 必须取得的直接证据 |
| --- | --- |
| Core signal/retry/read-back | abort-observing resolver/fetcher、request count、signal identity、uncertain attempt 与 lifecycle race |
| Closed contracts | real Native/Code schema projection、direct body gates、wrong canonical output 在 render 前失败 |
| Approval | real ToolRuntime + ApprovalService/answerer；invalid zero ask、allow/reject/cancel/unavailable/no-channel |
| Error/secrecy | exact code/detail table；Native+Code durable events 与 plugin context/log sentinel negative scan |
| Cancellation/lifecycle | pre/body/in-flight/late-success/unknown/owner-only dispose race；drain/post-dispose assertions |
| Skill | packed source、real catalog/consumer、model/user load、body drift/forbidden-text scan、dispose |
| Packed closure | actual pack manifest/files/import scan；isolated installed smoke + real Agent scheduler |
| Real user path | `:3020` ready、installed DSH ready、QA-only create/unit/ready/review/reopen/ready/discard read-backs |
| Compatibility/scope | CLI Worktree/Unit/open/Skill/package tests、repo gates、source-boundary diff 与 README |

## 执行顺序

实现稳定后先运行：

```bash
pnpm --filter @univerjs/univer-workspace-client-core typecheck
pnpm --filter @univerjs/univer-workspace-client-core test
pnpm --filter @univerjs/univer-workspace-client-core build
pnpm --filter dsh-univer-work typecheck
pnpm --filter dsh-univer-work test
pnpm --filter dsh-univer-work build
pnpm --filter dsh-univer-work package:verify
pnpm --filter dsh-univer-work package:smoke
pnpm --filter univer-workspace-cli test -- workspace-cli.test.ts application-command-contracts.test.ts workspace-skills-command.test.ts
pnpm package:workspace-cli
openspec validate add-dsh-worktree-unit-tools --strict
```

随后用 actual tarball 与真实 installed Agent 完成 QA-only Workspace vertical slice；最终运行：

```bash
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

## AC 逐项结果

| AC | 实际观察与证据 | 结论 |
| --- | --- | --- |
| AC-01..04 | Client Core 27 files / 470 tests、typecheck 与 build 全绿。abort-observing resolver/fetcher 直接覆盖 Worktree/Unit/review families、stable-identity retry stop、lifecycle read-back 与 confirmed-result race；无 signal CLI cases 保持通过。 | PASS |
| AC-05..12 | 真实 Native ToolRuntime 与 Code Mode 发现精确 12 names/closed roots；source 158 tests 覆盖 exact/cross-field gates、canonical Worktree/Unit/review value、wrong identity/state/output 与 value-only render。 | PASS |
| AC-13..19 | 8-name pre-execute policy 在 approval/resolver/HTTP 前复用 validator。allow/reject/cancel/unavailable/no-channel/missing service、allowlisted/unlisted errors 及 Native/Code sentinel positive/negative scan 均有直接证据。 | PASS |
| AC-20..24 | source 与 installed tests 覆盖 caller/owner pre-request abort、in-flight read、late confirmed `ABORTED`、uncertain write、owner-only confirmed drain 与 dispose 后 tools/policy/Skill 注销；无 detached retry/read-back。 | PASS |
| AC-25..28 | tarball 只包含 `skills/core/SKILL.md`；registered definition 与 packed bytes 相等。真实 catalog 和 `skill` consumer 可 load，model/user invocation 可见，dispose 后消失，forbidden future/CLI text scan 通过。 | PASS |
| AC-29..32 | `package:verify` 确认 6-file self-contained artifact、reachable Core 内联且 DSH/Cordis exact optional peers 保持 external。isolated `package:smoke` 通过 installed Native AgentLoop、`run_code` Code Mode、direct ToolRuntime、Skill 与 normal disposal。 | PASS |
| AC-33..35 | 正常启动 Workspace `:3020` 和 actual-tarball DSH web `:56631`，复用有效 credential。installed ToolRuntime 执行 14 calls / 6 exact-name approvals：create、draft get/list、Worktree-local Sheet、Unit list、ready/get、review、reopen、再次 ready、discard、processed list 全部一致；0 merge、0 unknown、0 replay。两个 Host 均已退出且无 listener，QA Worktree 为 discarded；tarball、profiles、storage/transcript 已删除，retained home 只保留 credential/settings。 | PASS |
| AC-36..38 | 两份 README 与 7/7 tasks 已同步。CLI 14 files / 69 tests、13 package-artifact tests、`package:workspace-cli`、OpenSpec strict、repo typecheck/test/build 与 `git diff --check` 独立 exit 0；Server/OpenAPI/SDK/release 回归全绿。 | PASS |

## Issues

每个 issue 必须包含 severity、evidence、expected、repro 与 status。发现后立即发送给
`/root/worktree_unit_implement`；实现修复后复验原 repro、相邻 security/race case 与最小回归 gate，
循环至 0 open。

状态取值：`open`、`fixed-pending-qa`、`fixed / verified`、`closed / invalid`、`accepted-risk`。

| ID | Severity | Evidence | Expected | Repro | Status |
| --- | --- | --- | --- | --- | --- |
| WT-QA-001 | medium | Client Core focused run 2/470 failed：新增 Worktree list signal case 的 fetch fixture 返回 `{ worktree }`，实际 list parser 需要 `{ items }`，因此测试自身未能形成有效 evidence。 | 为 list 提供正确 response，并继续断言 resolver/fetch 同一 signal；全部既有 cases 保持 green。 | 修复后独立复验：fixture 按 query 返回 `{ items: [] }`；同一 focused command 27 files / 470 tests 全过，list/get/Unit list/review 共观察 4 个同一 signal requests。 | fixed / verified |
| WT-QA-002 | medium | already-aborted review 仍调用 `authenticatedHttp` 一次，违反“before authenticated resolution”与新增 test 的 zero resolver expectation。 | `createUrl(..., abortedSignal)` 在 origin/resolver 前同步观察 signal，零 authenticated resolver、零 configured origin、零 HTTP。 | 修复后独立复验：`createUrl` 首行 `signal?.throwIfAborted()`，origin await 后再次检查；focused case 与全套 470 tests 通过，两个 resolver call count 均为 0。 | fixed / verified |
| WT-QA-003 | medium | 第一轮 DSH 143 tests 全绿，但 Worktree/Unit 模块拥有独立 `executeOwned`、error adapter 与 pre-execute policy；既有 Node safety tests 不能证明这些新 seams。Worktree section 尚无 direct cases 覆盖 caller/owner cancellation、late-success `ABORTED`、active disposal drain、lifecycle invalid/read-back、workflow error allowlist/unlisted secret、Unit/review invalid output、Native argument-record sentinel、Unit Code Mode invalid policy，以及 Worktree approval reject/cancel/unavailable/no-channel。 | 增加最小 table-driven real ToolRuntime cases，直接覆盖 tasks 3–5 与 AC-12..24；每项断言 request/approval/event count、stable code、no-reflection、no replay 和 disposal 后 registrations；installed smoke 同样证明 Native/Code records 与 real Agent Worktree dispatch。 | Source remediation 独立复验 158/158 + typecheck PASS：新增 direct lifecycle/error/output/approval/cancellation/disposal、real AgentLoop Native 与 Worktree+Unit Code Mode cases。增强后 installed smoke 再次独立 PASS：Native AgentLoop 的 invalid Unit sentinel 在 `tool/call.arguments` 保留、result/approval 无复制，并实际 dispatch Worktree list/Unit list/review；installed `run_code` 的 invalid Unit create 与 Worktree list 产生成对 start/settled events、零 approval 且 strip DSH-owned arguments 后无 sentinel；direct installed ToolRuntime 覆盖 Worktree create、Unit create/list、ready/review/reopen/discard 与 result-unknown。 | fixed / verified |

## 实际执行结果

| 命令/探针 | 结果 |
| --- | --- |
| 静态实现首次快照 | 2026-08-29：尚未发现十二个 Worktree/Unit/review tools 或 bundled core Skill；后续 checkpoint 已交付并完成复验。 |
| Client Core typecheck | exit 0。 |
| Client Core focused test（首次） | exit 1；27 files，468 pass、2 fail；WT-QA-001/002 已发给 implement agent。 |
| Client Core focused test（修复复验） | exit 0；27 files，470 pass；WT-QA-001/002 closed。 |
| Client Core 第一轮正式 gate | typecheck、27 files / 470 tests、build 全部 exit 0。 |
| DSH 第一轮正式 gate | typecheck、3 files / 143 tests、build 全部 exit 0；WT-QA-003 已发给 implement agent。 |
| DSH WT-QA-003 首次补测 | exit 1；3 files，156 pass、2 fail；已回传正确 rc.2 seam 与 real AgentLoop 要求。 |
| DSH WT-QA-003 source 复验 | exit 0；3 files，158 pass；typecheck exit 0。installed 部分待复验。 |
| package:verify（第一轮） | exit 0；actual file list为 LICENSE、README、patch、built Host、manifest 与唯一 `skills/core/SKILL.md`。 |
| package:smoke（第一轮） | exit 0；actual tarball、isolated profile、23 Workspace tools、core Skill、direct Worktree vertical slice 与 Host ready/stop通过；WT-QA-003 要求的 installed Code/Agent direct evidence仍在补。 |
| package:smoke（WT-QA-003 增强复验） | exit 0；actual tarball 中的 real AgentLoop、`run_code` Code Mode、direct ToolRuntime、sentinel positive/negative scan、approval/result-unknown/disposal 全部通过。 |
| Client Core 最终 focused gates | typecheck、27 files / 470 tests、build 全部 exit 0。 |
| DSH 最终 focused gates | typecheck、3 files / 158 tests、build、`package:verify`、`package:smoke` 全部 exit 0。packed files 精确为 6 个。 |
| CLI 兼容性 | focused command exit 0（实际运行 14 files / 69 tests）；13 package-artifact tests 通过；`pnpm package:workspace-cli` exit 0。 |
| OpenSpec | 7/7 tasks checked；`openspec validate add-dsh-worktree-unit-tools --strict` exit 0。 |
| 真实 Workspace/DSH vertical | `:3020` + actual tarball + DSH `:56631`；14 ToolRuntime calls、6 approvals、1 Worktree-local Unit、2 ready cycles、review origin、discarded processed read-back 全部通过；无 merge/unknown/replay。 |
| 清理 | DSH/Workspace 无 listener；QA Worktree discarded；两个 tarball、pack root、installed profiles 与 Session storage 已删除；retained home 只剩 credential/settings。 |
| 仓库级最终 gates | `pnpm typecheck`、`pnpm test`、`pnpm build`、`git diff --check` 全部 exit 0。测试直接证据：repository script 12、reference-provider 16、Client Core 470、Workspace 152、DSH 158、CLI 69，全部 pass。 |

## QA 结论

**PASS。** AC-01..AC-38 全部通过；3 个发现问题全部 `fixed / verified`，当前 **0 open**。
实现、installed artifact、真实 Workspace vertical slice、清理与仓库级兼容性 gates 均有独立证据，可交给 root 进入后续流程。
