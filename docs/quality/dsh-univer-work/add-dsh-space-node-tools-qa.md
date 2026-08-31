# add-dsh-space-node-tools QA

本文件定义并记录 Change `add-dsh-space-node-tools` 的独立验收。QA 规划基线为
commit `d2e51a25ef05bd662cb4a88ba6ff68236577269a`；前置
`add-dsh-univer-work-authentication` 已完成真实 Workspace、installed DSH、Chrome approval、
`complete`、`whoami`、approved logout 与 logout 后 authentication-required 验收。

实现、QA 与 code review 由相互独立的 subagent 执行。本报告不替代 OpenSpec task 勾选，
也不修改产品代码或 Change planning artifacts。

## 环境与数据边界

- Univer Workspace：Node.js 24+、pnpm 11、SDK baseline `1.0.0-beta.2`；真实 Server 固定监听
  `http://127.0.0.1:3020`。不得执行 `db:reset`，不得覆盖、重命名、移动或 Trash 现有用户 Node。
- DeepSeek Harness：真实 checkout
  `/Users/shenweimin/github.com/deepseek-ai/deepseek-harness`，冻结 commit
  `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`、CLI `0.1.1-rc.2`；使用隔离 QA profile 与动态
  空闲端口，不修改用户已有 DSH profile。
- 真实端到端路径必须从本 Change 生成的 actual tarball 安装，不用 workspace link、源码 overlay、
  CLI subprocess 或相邻 checkout runtime import。DSH checkout 只提供冻结 Host/runtime。
- 用户已授权后续普通 QA 使用 DSH Full access；真实 mutation 演练不再请求用户逐次点击。
  `ask`、`never`、missing answerer、rejected、cancelled 与 unavailable 的 fail-closed 合同仍必须用
  real ToolRuntime/installed fixtures 直接证明，不能因 Full access 跳过。
- Browser authentication 仅在需要重新建立 Workspace grant 时通过 Chrome 完成。QA 不读取或填充
  password、cookies、local/session storage；若现有登录态不可用，由用户自行登录。成功后尽量保留
  authenticated 隔离 QA profile 供后续 Change 复用，除非 credential/spec 安全边界要求清除。
- 真实写入只使用本轮创建并带唯一 QA 前缀的组织 Node。优先使用已认证用户的 Personal Space，
  不创建 Team Space，不修改 ACL/Direct Share/Link Sharing，不访问其他用户不可见内容。
  QA 必须保存自己创建的 Node IDs（仅放在权限为 `0700` 的临时目录），演练结束把这些 Node 移入
  Trash；Trash Batch 和 Node identity 属于非秘密测试证据，但报告不记录 User identity。
- device code、Login Session cookie、完整 grant、password、`Set-Cookie`、User identity value 和原始
  Session transcript 不写入报告、fixture 名称或保留日志。自动 fixture 只使用临时 sentinel；报告只记
  negative scan 结果。

## 验收标准

### Client Core signal 与既有 workflow

- **AC-01** `WorkspaceSpaceFeature.list(signal?)`、`browse(input, signal?)`、`find(input, signal?)`、
  `createNode(input, signal?)`、`renameNode(input, signal?)`、`moveNode(input, signal?)` 与
  `trashNode(nodeId, signal?)` 只追加向后兼容 optional `AbortSignal`；现有无 signal 调用的类型、
  endpoint、顺序、filter、normalization、read-back 和错误语义不变。
- **AC-02** abort-observing authenticated resolver 与 fetcher 证明 list、browse/find 的每个 page、
  recursive child request、四种 mutation 及 rename/move read-back 都收到同一 signal；resolver、每页、
  每个 descendant 和 read-back 前均重新观察 abort，不返回 partial list。
- **AC-03** create/Trash 在 dispatched request 失去响应时仍只写一次并返回
  `workspace-result-unknown`；rename/move 仍只以一次 GET read-back 确认，不 replay PATCH。
- **AC-04** pagination metadata drift、repeated cursor、recursive cycle/repeated Node、wrong Space/parent/
  Node identity、broadened capability/Resource/Trash shape 继续由 Client Core strict parser 拒绝。

### 七个 closed tools 与 canonical output

- **AC-05** 真实 `ToolRuntime.schemas()` 与 Code Mode SDK 精确发现七个新名称：
  `workspace_space_list`、`workspace_space_browse`、`workspace_space_find`、
  `workspace_node_create`、`workspace_node_rename`、`workspace_node_move`、
  `workspace_node_trash`；四个 auth tools 保持存在，且没有通用 action/update 或隐藏 Trash path。
- **AC-06** 七个 parameter root 均投影 `additionalProperties: false`；参数只含各 operation 的 snake_case
  keys，enum 精确覆盖 `resource_kind` 与 `unit_type`，不接受 origin、cookie、password、grant、path、
  Worktree、command 或任意 JSON。
- **AC-07** 同一个 pure operation validator 在所有 body 前运行；四个 mutation 还在
  `tools/pre-execute` 返回 `ask` 前运行。它拒绝 non-plain/non-object root、unknown own key、missing/
  wrong type、blank ID/query、trim 后空或超过 255 字符的 Node name、filter 冲突和 self-parent，且不
  读取 service、不重写参数、不回显 rejected key/value。
- **AC-08** discovery invalid args 在 authenticated resolver/HTTP 前返回固定
  `workspace-argument-invalid`；mutation invalid args 在 approval、credential、body 和 HTTP 前返回同一
  stable code，并产生零 `approval/asked`/`approval/decided`。
- **AC-09** `workspace_space_list` 保持 Server order 并返回 `{ spaces }`；browse/find 保持 Client Core
  traversal order 与完整 `{ nodes }`，包括 path、accessRole、capabilities、hierarchy 及完整
  `null | univer | blob` Resource projection；find 只做既有大小写不敏感 substring search。
- **AC-10** create/rename/move 返回 `{ node }`；root move 由 `parent_node_id: null` 表达；Trash 返回
  `{ trashBatch }`，包含 identity、root、count、actor、blockers、original location、capabilities 与时间。
- **AC-11** 七个 output schema 都是 closed explicit schema。缺失 required canonical field、extra/broadened、
  non-JSON、wrong identity/type/capability/Trash blocker output 在 render/Code Mode value 前得到
  `INVALID_TOOL_OUTPUT`；Space `type` 按 delta spec 与 Core model 保持 optional，但出现时只允许
  `personal | team`。render 只从 validated canonical value 生成稳定 identity/count 摘要。

### Approval、错误与秘密边界

- **AC-12** 单一 fiber-owned `tools/pre-execute` listener 只匹配四个 Node mutation，合法输入返回固定、
  secret-free `ask`，其他 tool 委托 `next()`；mutation definitions 不声明 `isConcurrencySafe`。
- **AC-13** `allowed-once` 仅允许该次 mutation body；rejected、cancelled、unavailable、missing approval
  service/no agent、policy `never` 均在 resolver/HTTP 前 fail closed。Full access 的真实演练不替代这些
  automated/installed cases。
- **AC-14** recognized Core/Server code 只允许冻结清单：
  `workspace-argument-invalid`、`workspace-invalid-response`、`workspace-result-mismatch`、
  `workspace-result-unknown`、`workspace-origin-mismatch`、`workspace-authentication-required`、
  `workspace-request-invalid`、`workspace-redirect-refused`、`UNAUTHENTICATED`、`INVALID_INPUT`、
  `FORBIDDEN`、`NOT_FOUND`、`CONFLICT`、`INTERNAL_ERROR`。
- **AC-15** recognized failure 仅保留 exact JSON-safe allowlisted detail：`status`、`path`、`spaceId`、
  `nodeId`、`name`、`parentNodeId`、`requested`、`actual` 及其明确嵌套字段；message 固定且
  Native/Code Mode failure content 与 `ToolErrorInfo.code` 一致。non-lossless detail 被省略。
- **AC-16** unlisted string/numeric code、unknown throw、resolver/provider/transport cause 均映射固定
  `workspace-operation-failed`，不复制原 code/message/detail/cause。password、cookie、`Set-Cookie`、
  grant 和 sentinel 不进入 approval reason/events、failure/result content+metadata、plugin-owned context
  或 plugin logs。
- **AC-17** Native `tool/call.arguments`、Code Mode `tool/code-dispatch-start.arguments` 和 settled
  `tool/code-dispatch.arguments` 明确允许保留 DSH 已接收 caller args；non-reflection scan 排除这三个
  DSH-owned fields，不能误称整个 Session 已擦除输入。

### Cancellation 与 lifecycle

- **AC-18** application-local owner wrapper 使用 caller signal 与 Host owner signal 的融合 signal，
  从 body 接受起跟踪 resolver、HTTP、pagination、recursive traversal、mutation/read-back 直到 settle；
  同时保留 signal 来源以区分 cancellation 与 disposal。
- **AC-19** caller 在 body dispatch 前 abort 时，真实 ToolRuntime 返回 `ABORTED_BEFORE_DISPATCH`，
  且无 plugin resolver、approval 或 HTTP。body 已接受但 request 前 caller/owner abort 分别返回
  `workspace-operation-cancelled` / `workspace-plugin-disposing`。
- **AC-20** list/browse/find 在 pagination/traversal 中 abort 不返回 partial success；caller/owner 来源分别
  保持 cancelled/disposing code，并且不启动下一页或下一个 child request。
- **AC-21** dispatched mutation 的 tool-owned `workspace-result-unknown` 在 caller/owner abort 后仍保持
 该 failure，绝不改写为 cancelled/disposing/success，且绝不自动 replay。
- **AC-22** dispatched mutation 在 caller abort 后由 Core 晚到确认 success 时，DSH 最终结果为
  canonical `ABORTED`；definition total finalizer 只替换 content 为固定 browse/find read-back 与
  no-replay guidance，不改变 registry-owned error identity。
- **AC-23** owner-only disposal 不 abort 原 caller signal；若 Core 已确认 mutation，body 可返回 confirmed
  success，若无法确认仍返回 `workspace-result-unknown`。dispose 必须等待它 settle。
- **AC-24** plugin dispose 顺序为停止接收、注销七 tools 和 mutation policy、abort owner-controlled I/O、
  drain 全部 accepted bodies；完成后无 request/traversal/read-back/listener/timer/Job/detached promise 或
  cached Workspace result，Auth owner 不被重复创建。

### Artifact、Native/Code Mode 与真实 Agent

- **AC-25** actual tarball 内联 reachable Client Core Space/Node/HTTP/error slice；packed manifest 无
  `workspace:*` runtime dependency、bare private Core/CLI/Server import，exact DSH/Cordis 仍为 optional
  peers，且不引入 worker/native/render/Web/Skill/Office/Typst/SVG/later-change resources。
- **AC-26** isolated installed `package:smoke` 使用 Host 同一 module identity，覆盖七 schemas、body/
  pre-ask unknown-key rejection、read、approval deny/allow、allowlisted/unlisted failure、pre-dispatch/body/
  owner abort、late-success `ABORTED`、mutation unknown、normal disposal，并留下 keyless transcript。
- **AC-27** 真实 `ToolRuntime({ mode: "code" })` 经 `run_code` 生成的 SDK binding 调用代表性 read 与
  mutation，Session 中 start/settled dispatch 以相同 name/subCallId 成对，canonical value/error、
  approval 和 non-reflection contract 与 Native 一致。
- **AC-28** real Agent Loop scheduler 从 installed tarball 发现并实际调用 Space list/browse/find 与专用
  mutation，不使用 direct source import；mutation 在真实 Agent turn 中按 Full access 执行并产生正常
  durable call/result 或 code-dispatch event。

### 真实 Workspace `:3020` 演练

- **AC-29** Workspace `127.0.0.1:3020` ready，真实 DSH checkout 从 actual tarball 安装到隔离且已认证的
  profile 后在动态空闲端口 ready；Host/plugin/tool discovery 都来自 installed artifact。
- **AC-30** Agent 调用 `workspace_space_list` 至少看到一个可写 Personal Space；browse root 与 recursive
  browse 均成功，find 对唯一 QA name 找到预期 Node。报告只记录 count/operation/status，不记录用户
  身份或现有内容名称。
- **AC-31** 在 Personal Space root 创建唯一 QA parent，再创建 QA child；create response identity/target
  与随后 browse/find 一致。只对这两个 QA Node 执行 mutation。
- **AC-32** child 依次 rename、move 到 Space root、move 回 QA parent；每一步由下一次 browse/find 读取
  权威状态并匹配同一 Node ID。不得以自动 replay mutation 处理任何 uncertain result。
- **AC-33** 先 Trash QA child，再 Trash QA parent；每次返回 strict Trash Batch 且 root identity 匹配。
  若 write outcome unknown，停止写入并只 browse/find/Browser 核对，不盲重试；任何未清理 QA Node 作为
  issue/concern 记录，不能触碰其他资源补偿。
- **AC-34** real path 结束后正常停止本轮 DSH Host。若安全保留 authenticated profile 供后续 Change，
  只保留 profile 与 credential store，删除 tarball、fixture、raw Session/log 和 Node-ID 临时文件，并
  在报告记录保留位置的非秘密 locator；否则执行 approved logout 后删除整个隔离根。

### Compatibility、文档与 scope

- **AC-35** `apps/dsh-univer-work/README.md` 与 `packages/client-core/README.md` 准确记录七 names、
  approval、signal/error/result-unknown、Host-only/HTTP-only 与明确非职责；不把后续 Change 写成现状。
- **AC-36** Workspace CLI Space/Node command/help/args、JSON envelopes、Session、HTTP behavior、installed
  package 保持不变；Server/OpenAPI/Browser/database、SDK baseline 与 release workflow 无本 Change diff。
- **AC-37** Client Core、DSH、CLI focused/package、OpenSpec strict、repository typecheck/test/build 与
  `git diff --check` 全部退出 0；测试失败不能仅因重跑成功而关闭，需先确认 deterministic root cause。

验收项总数：**37**。

## OpenSpec scenario → 直接证据

| Scenario group | 必须取得的直接证据 |
| --- | --- |
| Core cancellation | abort-observing resolver/fetcher；多页/递归/四 mutation/read-back request 计数与 signal identity |
| Closed contracts | real schema projection、direct body validator、wrong canonical output 在 render 前失败 |
| Approval | real ToolRuntime + ApprovalService/answerer；ask/never/allow/reject/cancel/unavailable/no-channel |
| Error/secrecy | exact code/detail table；Native+Code durable events 与 plugin context/log sentinel negative scan |
| Cancellation/lifecycle | pre/body/in-flight/late-success/unknown/owner-only dispose races；drain 与 post-dispose assertions |
| Packed closure | actual pack manifest/file/import scan；isolated installed smoke + real Agent scheduler |
| Real user path | `:3020` ready、installed DSH ready、authenticated Agent list/browse/find、QA-only create/rename/move/Trash |
| Compatibility/scope | CLI Space contract/package tests、repo gates、source-boundary diff 与 README |

## 执行顺序

实现稳定后先执行 focused checks：

```bash
pnpm --filter @univerjs/univer-workspace-client-core typecheck
pnpm --filter @univerjs/univer-workspace-client-core test
pnpm --filter @univerjs/univer-workspace-client-core build
pnpm --filter dsh-univer-work typecheck
pnpm --filter dsh-univer-work test
pnpm --filter dsh-univer-work build
pnpm --filter dsh-univer-work package:verify
pnpm --filter dsh-univer-work package:smoke
pnpm --filter univer-workspace-cli test -- space-cli.test.ts application-command-contracts.test.ts
pnpm package:workspace-cli
openspec validate add-dsh-space-node-tools --strict
```

随后用 actual tarball 启动真实 Workspace/DSH 环境。端口、PID、credential、Node IDs 与 raw transcript
只保存在权限收紧的临时 QA 根；报告记录 sanitized outcome：

```bash
pnpm workspace:dev:server
# 另一个终端：actual tarball -> isolated DSH_HOME -> dynamic free port -> real Agent calls。
# 如需重新认证，只让 Chrome 打开 Workspace approval 页面；不读取/填充浏览器秘密。
```

真实演练完成后执行完整 compatibility gates：

```bash
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

## AC 逐项结果

| AC | 实际观察与证据 | 结论 |
| --- | --- | --- |
| AC-01..04 | Client Core 27 files / 461 tests、typecheck 与 build 通过；signal identity、分页/递归 abort、四种 mutation、read-back、result-unknown/no-replay 与 strict response parser 均有直接回归。 | PASS |
| AC-05..11 | source ToolRuntime 发现七个 closed tools；参数/body/output validator、canonical Space/Node/Trash projection、optional Space `type` 及非法/额外 output 探针通过。 | PASS |
| AC-12..17 | mutation-only ask policy、allow/reject/never/missing channel fail-closed、固定错误清单与 exact detail、unknown failure 收敛、secret/non-reflection scan 均通过 Native/Code Mode tests。 | PASS |
| AC-18..24 | pre-dispatch/body/in-flight abort、caller/owner 分类、late read、late mutation `ABORTED`、result unknown 优先级、dispose/unregister/drain/fresh Host 回归通过。 | PASS |
| AC-25..28 | `package:verify` 与 actual-tarball isolated `package:smoke` 通过；installed Host 发现七 tools，installed AgentLoop 实际调用 list/browse/find/create；real Code Mode start/settled dispatch identity、approval/value 通过。 | PASS |
| AC-29 | Workspace `:3020/openapi.yaml` ready；真实 DSH checkout、隔离 profile、动态端口 Host 与 final actual tarball install ready。installed Agent 单次 `auth_start` 后由已获用户授权的 root 在 Chrome 完成 approval；Agent 单次 `auth_complete` 与随后 `whoami` 均确认 authenticated。 | PASS |
| AC-30 | installed headless Agent list 得到 1 个可写 Personal Space；写入前 root 与 recursive browse 均成功且为 0。创建后 root/parent browse 与唯一前缀 find 均匹配预期 count、Node identity 和 hierarchy；报告不保留 User identity 或既有内容。 | PASS |
| AC-31 | QA parent 在 Personal Space root 创建一次，QA child 在该 parent 下创建一次；两次 canonical create 均确定成功。随后 root recursive 2、parent browse 1、两个唯一 name find 各 1，identity/target 全部匹配。 | PASS |
| AC-32 | child rename 确定成功并由独立 find+browse 核对 same ID/exact name/parent；move 到 root 后由 root/旧 parent/find 核对；move 回 QA parent 后由 root/parent/find 核对。每步只发一次 mutation，0 result-unknown、0 replay。 | PASS |
| AC-33 | 先 Trash QA child，再 Trash QA parent；两个 strict Trash Batch 均 root identity 匹配、`nodeCount = 1` 且返回 batch identity。最终 root recursive 与 parent/child 唯一 name find 均为 0；没有触碰其他 Node。 | PASS |
| AC-34 | 每个真实 mutation process 使用用户授权的 QA-only terminal answerer：只匹配该进程环境声明的一个 `workspace_node_*` name，锁定首个 QA Agent、返回一次 `allowed-once` 后即消费，其他请求委托 `next()`。真实 Host 均正常退出；一次性 answerer、tarball、raw Sessions、anonymous/transient ID 已删除，仅保留 authenticated 隔离 profile/credential store。 | PASS |
| AC-35..36 | README 与 source-boundary review 通过；CLI 14 files / 69 tests 与 203-file package artifact 通过，Server/OpenAPI/Browser/database/SDK/release workflow 无越界产品改动。 | PASS |
| AC-37 | Client Core、DSH、CLI、package、OpenSpec strict、`git diff --check`、仓库 `pnpm typecheck` / `pnpm test` / `pnpm build` 均退出 0。 | PASS |

## Issues

每个 issue 必须包含 severity、evidence、expected、repro 与 status。发现后立即发送给
`/root/space_node_implement`；实现修复后复验原 repro、相邻 race/security case 和最小回归 gate，
循环至 0 open。

状态取值：`open`、`fixed-pending-qa`、`fixed / verified`、`closed / invalid`、`accepted-risk`。

| ID | Severity | Evidence | Expected | Repro | Status |
| --- | --- | --- | --- | --- | --- |
| SN-QA-001 | medium | 首轮 `pnpm --filter dsh-univer-work test` 为 67/74；7 个失败中，SDK negative scan 扫描了合法 prose/`originalLocation`，find fixture 在递归 child request 返回了错误 root metadata，error detail 断言绕过了 `ToolError.message` 的确定性 JSON，4 个 race 在 body/fetch 尚未进入前就 abort/dispose。它们没有证明对应产品合同。修正测试 gate/fixture/assertion 后，同一命令稳定为 74/74，其中 Space/Node 21/21。 | focused test 必须先证明 request/body 已进入并对正确的 durable/result 字段断言；fixture 必须符合被测 traversal 层级，negative scan 只扫描 schema keys。 | 运行同一 DSH test 命令；核对失败位置，再运行修正后的原 repro 与相邻 caller/owner late-success race。 | fixed / verified |
| SN-QA-002 | medium | 初始 read wrapper 在 Core body 晚到 success 后未再次检查 caller/owner signal，已进入的 list 可在 abort/dispose 后错误返回 success（review `REV-SN-01`）。当前 `space-node.ts` 在 read body settle 后按 signal 来源映射 `workspace-operation-cancelled` / `workspace-plugin-disposing`；两个 gate-controlled ToolRuntime repro 通过。 | 已接受的 readonly body 若在 settle 前被 caller 或 owner abort，不得泄漏 late success 或 partial success；错误 identity 必须区分来源。 | `space-node.test.ts` 的 `classifies a late successful read stopped by caller/owner`，等待 fetch 已进入，再 abort/dispose，最后释放 response。 | fixed / verified |
| SN-QA-003 | high | 首轮 `scripts/smoke-package.mjs` 与 `verify-package.mjs` 均为 auth-only。修订后 actual tarball isolated install 直接验证 11 个 Workspace tools（7 个 Space/Node closed roots）、pre-ask/body invalid、read、deny/allow、allowlisted/unlisted failure、pre/body/owner cancellation、late mutation `ABORTED` guidance、unknown mutation、dispose/drain、real AgentLoop Space list 与 fresh Host ready；verify 检查七个 reachable names、Space API 与 result-unknown inline closure。QA 重跑两命令均退出 0。 | actual tarball 的 isolated installed smoke/verify 必须直接覆盖 AC-25/26 的 installed boundary，而不是沿用 auth-only smoke。 | `pnpm --filter dsh-univer-work package:verify`；`pnpm --filter dsh-univer-work package:smoke`。 | fixed / verified |
| SN-QA-004 | high | 初始 source focused test 只调用 `renderToolsSdk()`；第二版只有 invalid create + list，未证明 approved mutation 或 dispatch identity。最终 test 由真实 `ToolRuntime({ mode: "code" })` + `run_code` 依次 dispatch invalid create、successful list、approved canonical create；断言三组 start/settled name + subCallId 精确成对、仅一次 create approval、完整 list/create value，并在排除三个 DSH-owned argument fields 后做 sentinel negative scan。QA 重跑 112/112。 | 代表性 Space read 和 approved Node mutation 必须通过 real Code Mode SDK binding dispatch，并检查 start/settled name/subCallId 成对、canonical value/error、approval 与 Native 等价合同。 | `space-node.test.ts` 的 `executes real Code Mode dispatch...`；`pnpm --filter dsh-univer-work test`。 | fixed / verified |
| SN-QA-005 | n/a | QA 探针确认 missing Space `type` 返回成功。复核 authoritative delta spec 的 “optional `personal \| team` type” 与 `WorkspaceSpace.type?` 后，确认该行为正确；原 AC 对 missing field 的概括不能覆盖 optional field。 | Space `id`/`name` required；`type` optional，出现时必须为 `personal \| team`，且 extra/illegal type 仍由 closed output schema 拒绝。 | built-plugin ToolRuntime fixture 验证 missing-`type` success；schema 投影确认 enum 与 closed root/item。 | closed / invalid |
| SN-QA-006 | low | QA 首次把 CLI focused command 与 `pnpm package:workspace-cli` 并行启动；两者都会清理/重建同一个 `apps/cli/package-dist`，package verify 在另一进程清理目录的窗口得到 `ENOENT scandir package-dist`。并行中的 CLI suite 随后 69/69；停止共享-output 并行后，单独 package 命令正常生成 203-file artifact。 | 会写同一个 packaging output 的 gates 必须串行；失败须按共享目录 race 分类，不能误报产品回归或仅凭无解释重跑关闭。 | 并行 repro 的 `ENOENT .../package-dist`；随后独占运行 `pnpm package:workspace-cli` exit 0。 | fixed / verified |

## 实际执行结果

| 命令/探针 | 结果 |
| --- | --- |
| Client Core `typecheck` / `test` / `build` | PASS；27 files、461 tests |
| DSH source `typecheck` / `test` / `build` | PASS；最终 3 files、112 tests；Code Mode approved mutation 与 exact error/detail matrix 已纳入 |
| `openspec validate add-dsh-space-node-tools --strict` | PASS |
| built plugin Space optional-type/illegal-type/extra-field ToolRuntime probe | PASS；missing optional type success；illegal enum 与 extra field 均 `INVALID_TOOL_OUTPUT` |
| DSH `package:verify` | PASS；actual pack closure 为 5 files，reachable Space/Node slice inline |
| DSH `package:smoke` | PASS；isolated actual tarball install、installed tools/AgentLoop/lifecycle、fresh Host ready |
| Workspace CLI focused command | PASS；14 files、69 tests |
| `pnpm package:workspace-cli` | PASS（独占串行）；203 files，packed 13,029,895 bytes；首轮并发 race 见 SN-QA-006 |
| `pnpm typecheck` / `pnpm test` / `pnpm build` | PASS；仓库全部 workspace project 退出 0；Workspace 34 files / 152 tests、CLI 14 files / 69 tests，其他 focused 数量见上 |
| `git diff --check` / OpenSpec strict | PASS |
| real Workspace + installed DSH authentication | PASS；Workspace `:3020` ready；真实 DSH checkout + final actual tarball 的隔离 Host ready；Chrome approval、单次 complete 与 whoami 通过 |
| real Agent Space list/browse/find | PASS；1 个可写 Personal Space；初始 root/recursive 均 0；每个 mutation 后的独立 authoritative readback 均匹配 |
| real Agent QA Node create/rename/move/Trash | PASS；只创建 QA parent/child；rename、root move、move-back、child Trash、parent Trash 均确定成功，0 unknown/replay；最终 active root/find 均 0 |

## 真实 QA approval 与清理

- 当前 product issue：**0 open**。SN-QA-001..006 均已 fixed/verified 或 closed/invalid。
- DSH rc.2 的 `danger-full-access` 是 sandbox/file preset；其 approval policy `never` 对 plugin 的显式 `ask`
  仍 fail closed，并不自动产生 `allowed-once`。三次 QA parent create 尝试在该差异厘清前均明确
  rejected-before-dispatch，产生 0 HTTP write；随后使用上述 user-authorized、agent-scoped、exact-name、
  single-consumption answerer完成每个真实 mutation。该现象与自动化 `ask`/`deny`/`allow` 合同一致，
  不构成本 Change product issue。
- 已停止仅供本轮 QA 使用的 DSH Host并确认端口不再监听；actual tarball、一次性 approval module、raw
  Session transcript、anonymous/transient ID 与 Node-ID 临时数据均已删除。两个 QA Node 已进入 Trash，
  active Space 最终为 0 Nodes。
- 保留可安全复用的隔离 profile/credential store：`/tmp/dsh-space-node-qa.xHYd5W/home`。报告不记录其中
  credential、User identity、device-code、Space/Node/Trash identity 或 raw transcript。后续复用时重新生成
  current actual tarball 并安装；profile 不保留自动 approval seam。

## QA 结论

**PASS。** 37 项验收标准全部满足。自动化、ToolRuntime、real Code Mode、actual-tarball installed
AgentLoop、真实 Workspace authenticated Space/Node 演练、packaging、compatibility 与完整仓库 gate 均
通过；当前 0 open product issues，QA-created Nodes 已清理至 Trash，可进入 Change 最终 review/archive
判断。
