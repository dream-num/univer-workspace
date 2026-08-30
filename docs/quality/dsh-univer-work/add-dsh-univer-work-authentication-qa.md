# add-dsh-univer-work-authentication QA

当前 follow-up 状态：**AUTH REPAIR PASS；0 open auth findings；OVERALL PARITY NOT READY（2 downstream blockers）**

本文件定义并记录 Change `add-dsh-univer-work-authentication` 的独立验收。QA 规划基线为
commit `d2e51a25ef05bd662cb4a88ba6ff68236577269a`。实现、QA 与 code review 由相互独立的
subagent 执行；本报告不替代 OpenSpec task 勾选，也不修改产品代码。

## 环境与边界

- Univer Workspace：Node.js 24+、pnpm 11、SDK baseline `1.0.0-beta.2`；真实 Server 固定监听
  `http://127.0.0.1:3020`，不得执行 `db:reset` 或覆盖已有持久数据。
- DeepSeek Harness：真实 checkout
  `/Users/shenweimin/github.com/deepseek-ai/deepseek-harness`，commit
  `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`，CLI `0.1.1-rc.2`；使用隔离临时
  `DSH_HOME` 与动态空闲端口，不改用户现有 profile。
- 真实端到端验收从预构建 tarball 安装，不用 workspace link、源码 overlay 或相邻 checkout
  runtime import。Harness checkout 只用于核对冻结公共合同和启动真实 DSH 基线。
- 浏览器批准只通过 Chrome 完成。QA 不读取 cookies、local/session storage、密码管理器或密码；
  若浏览器没有可用登录态，由用户自行登录后继续。
- device code、Login Session cookie、完整 grant、密码和 `Set-Cookie` 不写入本报告、命令行、
  fixture 名称或保留日志。自动测试中的秘密只用临时 sentinel，并只记录“未发现 sentinel”。
- 本 Change 支持一个 live Host、一个 origin、且没有绕过该 Host 修改 owner key 的 writer；QA
  不把 unsupported 多 Host 协调作为通过条件。

## 验收标准

### Client Core cancellation compatibility

- **AC-01** `startCliLogin(http, now?, signal?)`、`completeCliLogin(http, pending, now?, signal?)`、
  `whoami(http, signal?)` 与 `logout(http, signal?)` 保持既有无 signal 调用兼容，并分别只把
  signal 透传到其唯一 HTTP request。
- **AC-02** abort-observing transport 证明四条在途请求都收到同一个调用方 signal；start 不返回
  pending、complete 不重试/轮询/提交 authenticated grant，whoami/logout 保留既有
  Workspace request/result-unknown 语义。
- **AC-03** 既有 Workspace CLI auth tests、CLI source call forms、命令输出和 Session 持久化
  保持不变；password login 不成为 DSH tool。

### Credential record、validator 与 resolver

- **AC-04** plugin 只使用 `credentialKey('dsh-univer-work', 'workspace')`，record 必须为
  `kind: 'grant'`，payload 精确匹配 pending 或 authenticated 形状；unknown/missing/extra field、
  非 JSON 对象、错误 state/kind 均 fail closed。
- **AC-05** pending 首次存储和每次读取都验证：device code 达到 Server contract 最小长度、
  user code 精确匹配 `^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$`、origin 为 normalized
  HTTP(S) origin、URL 同源且精确为 `/cli-login?userCode=<matching-code>`、无 credentials/
  fragment/额外或重复 query。
- **AC-06** origin、user code、verification URL 的 raw 或 URL-decoded safe field 只要包含
  device-code sentinel，就在 storage/rendering 前拒绝；错误不回显 payload、URL 或 sentinel。
- **AC-07** authenticated payload 严格验证 normalized HTTP(S) origin、非空 cookie，以及只有
  非空 `id`/`name` 的 User subject；pending、invalid、missing 不产生 authenticated HTTP。
- **AC-08** resolver 每个 operation 都重新读取 record，构造新的 `WorkspaceHttp`，credential
  rotation/deletion 在下一次调用生效；不缓存 cookie，不向业务 tool 暴露 raw grant。
- **AC-09** start/complete/logout 共用 process-local mutation queue；并发结果按进入队列的状态
  串行化。provider callback 观察到非法 post-request transition 时保留现值，返回
  `workspace-authentication-state-conflict`，不重试、不泄露未提交响应。
- **AC-10** expired pending 在 queue 内删除且不发送 exchange；provider read/modify/delete failure
  使用 operation-specific sanitized failure，只有 recognized `WorkspaceApplicationError` 保留
  stable Workspace code。

### Tool schema、canonical outcome 与两阶段 handoff

- **AC-11** 真实 `ToolRuntime.schemas()` 只发现
  `workspace_auth_start`、`workspace_auth_complete`、`workspace_auth_whoami`、
  `workspace_auth_logout` 四个 auth tools；schema 无 password、deviceCode、cookie、grant 或
  secret-shaped 参数。
- **AC-12** start 对合法 origin 只发一次请求，返回唯一 canonical status
  `authorization_required` 及 normalized origin/userCode/verificationUrl/expiresAt，并明确要求
  等待用户批准；同 origin live pending 复用 safe handoff，不发新请求。
- **AC-13** start 遇到 authenticated 或另一 origin pending 时不覆盖 record；complete 在 missing、
  expired、HTTP 202、成功时分别返回 `authorization_missing`、`authorization_expired`、
  `authorization_pending`、`authenticated`，每次最多一次 exchange 且无 delay/timer/Job/poll。
- **AC-14** successful complete 原子替换同一 pending record，canonical/model result 只包含
  normalized origin 和 User subject；whoami 每次调用 Server `/api/session` 并只返回 Server
  权威 subject，不信任 stored subject。
- **AC-15** Native rendering、Code Mode canonical value/presentation 和错误 rendering 使用完整且
  固定的 status/error vocabulary；未提交 response 与未通过 allowlist 的 handoff field 不进入结果。

### Logout approval、local clear 与 lifecycle

- **AC-16** 唯一 `tools/pre-execute` listener 只对 `workspace_auth_logout` 返回 `ask`，其他 tools
  调用 `next()`；无 approval service、denied/cancelled/unavailable approval 都 fail closed，Server
  与 credential provider 无副作用。
- **AC-17** approved authenticated logout 最多发送一次 remote request，并在 settle 前于
  non-cancellable `finally` 删除本地 record；remote success、Workspace failure、cancellation 和
  result-unknown 后 resolver 都不能再使用该 Session。
- **AC-18** pending、invalid 或 absent logout 不发送 authenticated request，仍执行 delete 并只返回
  safe local-clear result；delete failure 优先于 remote outcome，不能误报 logged out。
- **AC-19** 每条 auth I/O 使用调用方 `exec.signal` 与 owner-dispose signal 的融合 signal；取消后
  tool 等待 owned work settle。start/complete 在 Core I/O 后及 provider callback 前再次检查 owner
  abort，已开始的 atomic write 则 drain 完成。
- **AC-20** 单一 fiber-owned `ctx.effect()` 依次关闭 accepting、注销四 tools 与 logout gate、abort
  owner signal、等待 mutation queue 和全部 accepted bodies；已接受 logout 仍完成本地 delete。
  dispose 返回后无 active body、queue、listener、effect、signal listener、timer、Job、poll 或 flow。

### Transcript secrecy 与 artifact closure

- **AC-21** 真实 keyless Native 与 Code Mode transcript 覆盖 start、pending complete、authenticated
  identity、cancellation、failure、logout；`tool/call.arguments`、`tool/result`、
  `tool/code-dispatch-start.arguments` 与 settled `tool/code-dispatch.arguments/content` 均无 password、
  device code、cookie、`Set-Cookie`、完整 grant 或 dependency thrown sentinel。
- **AC-22** transport、validator、credential provider 的 thrown message/cause 即使含 sentinel，也只
  产生固定 sanitized tool failure；任何原始 message、cause、rejected value、headers/body 不进入
  transcript 或 presentation。
- **AC-23** Vite/Rollup 只把 reachable Client Core auth/http/error slice 内联进 built Host entry；
  DSH/Cordis 保持精确 external runtime dependencies。packed manifest 无 `workspace:*` dependency，
  output 无 bare Client Core import。
- **AC-24** actual tarball 不含 Client Core runtime/worker/native/render、Office/Typst/SVG、Web、Skills
  或 source/test 文件；安装态 profile 从 tarball load，四 tool schema 可注册/执行并正常 dispose。

### 真实 Workspace + DSH + Chrome 演练

- **AC-25** 本地 Workspace Server 在 `127.0.0.1:3020` 真实 ready；真实 DSH checkout 基线使用独立
  空闲端口启动安装了 tarball 的隔离 profile，Host 输出明确 ready evidence，且 plugin/tool discovery
  来自 installed package。
- **AC-26** 通过真实 Agent/ToolRuntime 调用 start 后，只把 safe verification URL 与 user code 交给
  Chrome；Chrome 页面显示同一 code。用户在已有或自行建立的 Workspace browser login 中明确批准，
  QA 不自动输入、抓取或保存登录秘密。
- **AC-27** 用户批准后只调用一次 complete，得到 `authenticated`；随后 whoami 返回与 Chrome 当前
  Workspace User 相符的 Server 权威 `id`/`name`。批准前的一次 complete 可验证
  `authorization_pending`，但不得轮询。
- **AC-28** logout 先触发真实 human approval；批准后返回 safe local-clear outcome，随后 whoami 返回
  `workspace-authentication-required`。Host 正常退出，Workspace Server 保持可控，隔离 DSH profile/
  tarball/log 在成功和失败路径均清理。

### 文档、scope 与 gates

- **AC-29** app/Core README 准确记录 single-origin、two-stage handoff、credential secrecy、local
  Host-only、one-live-Host/no out-of-band writer 前提、无 authorization service/UI/password，以及
  resolver owner；不把后续 tools/runtime/Skills 写成当前事实。
- **AC-30** Change 不修改 Workspace Server/OpenAPI、Browser approval protocol、CLI Session/command/
  output、SDK baseline 或 release workflow；focused、CLI package、repository build/test/typecheck、
  OpenSpec strict 与 `git diff --check` 全部通过。

验收项总数：**30**。

## OpenSpec scenario → 直接证据

| Scenario group | 必须取得的直接证据 |
| --- | --- |
| Core cancellation | abort-observing fetcher 的四条 focused tests；无 signal 既有 auth tests |
| Grant validation/rotation | exact-shape table tests、malicious URL/sentinel fixtures、per-operation resolver reads |
| Two-stage tools | real ToolRuntime schema/result tests、request count、timer/Job/poll absence |
| Logout approval/local clear | real ToolRuntime + fake approval/provider/Server；删除顺序与 post-logout resolver |
| Lifecycle | real Cordis dispose at four I/O points、queue wait、logout finally；post-dispose resource assertions |
| Transcript secrecy | Native/Code Mode durable Session events 的完整序列与 negative sentinel scan |
| Packed closure | actual pack manifest/file list、bundle import scan、isolated installed-profile smoke |
| Real user path | `:3020` ready、installed DSH Host ready、Chrome approval、complete/whoami/logout outcomes |
| Compatibility/scope | CLI auth/package tests、repo gates、baseline diff 和文档核对 |

## 执行顺序

实现完成后先执行 focused 与 assembled checks：

```bash
pnpm --filter @univerjs/univer-workspace-client-core typecheck
pnpm --filter @univerjs/univer-workspace-client-core test
pnpm --filter @univerjs/univer-workspace-client-core build
pnpm --filter dsh-univer-work typecheck
pnpm --filter dsh-univer-work test
pnpm --filter dsh-univer-work build
pnpm --filter dsh-univer-work package:verify
pnpm --filter dsh-univer-work package:smoke
pnpm --filter univer-workspace-cli test -- auth
pnpm package:workspace-cli
openspec validate add-dsh-univer-work-authentication --strict
```

随后启动真实环境。具体端口、临时根与进程 PID 只保存在 QA 进程内；日志在写盘前做 secret
negative scan，演练结束后删除：

```bash
pnpm workspace:dev:server
# 另一个终端：从 actual tarball 安装到临时 DSH_HOME，使用探测到的空闲端口启动真实 DSH Host。
# 通过真实 Agent/ToolRuntime 调用四个 auth tools；Chrome 只负责页面登录与批准。
```

真实演练通过后执行 compatibility gates：

```bash
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

## AC 逐项结果

| AC | 实际观察与证据 | 结论 |
| --- | --- | --- |
| AC-01 | 四个函数只追加 optional signal；source diff 证明各自透传到唯一 `WorkspaceHttp` 调用，既有参数顺序不变 | PASS |
| AC-02 | abort-observing table test 的四个 case 均观察到同一 signal 并得到既有 `workspace-result-unknown`；Client Core 457 tests 全过 | PASS |
| AC-03 | Client Core 无 signal 既有 tests、Workspace CLI `auth-transport.test.ts` 17 tests 与 `package:workspace-cli` 均通过；既有 CLI auth source call forms/output/Session 持久化未发生本 Change 范围内改写 | PASS |
| AC-04 | exact pending/authenticated record table 覆盖 kind/state/unknown/missing/extra/non-object，均 fail closed；owner key 唯一 | PASS |
| AC-05 | pending validator 覆盖 device/user code、normalized origin、same-origin exact path/query 及 credentials/fragment/重复参数 | PASS |
| AC-06 | raw 与 URL-decoded device sentinel 在 storage/render 前被拒绝，错误 projection 不含 sentinel | PASS |
| AC-07 | authenticated payload 的 origin/cookie/subject exact validator 与 missing/pending resolver rejection 均通过 | PASS |
| AC-08 | credential rotation test 证明每次 operation 重新读取 record 并重建 HTTP；删除在下一次调用生效 | PASS |
| AC-09 | mutation queue、overlapping starts 与 malformed/post-request CAS conflict tests 证明串行化、preserve-current、zero retry | PASS |
| AC-10 | expired pending zero exchange 并删除；provider/transport failure 只保留 operation-specific 或 allowlisted stable code | PASS |
| AC-11 | source、installed ToolRuntime smoke 与 fresh real DSH Agent 均只发现四个 auth tools，schema 无 secret-shaped 参数；2026-08-30 predecessor repair follow-up进一步确认四个 parameter root均为 closed object，unexpected own key在任何 auth effect前返回 `INVALID_ARGS` | PASS |
| AC-12 | start/reuse tests 与 Chrome real Agent 证明每次 start 最多一次请求、canonical safe handoff，并明确等待用户批准 | PASS |
| AC-13 | missing/expired/pending/authenticated completion table 全过；真实过期 pending 经单次 complete 清除后由 Agent 重新 start，无 poll | PASS |
| AC-14 | complete CAS replacement 与 Server-authoritative whoami tests 全过；真实 complete、whoami 各一次均 authenticated | PASS |
| AC-15 | Native/Code canonical/render/error assertions 覆盖固定 status/code；未提交与非 allowlist field 不进入 presentation | PASS |
| AC-16 | 唯一 pre-execute listener 只 gate logout；denied/no approval zero side effect；真实 DSH 显示并等待 `Allow once` | PASS |
| AC-17 | authenticated logout success/failure/cancellation tests 均 finally clear；真实批准后 local clear，后续 resolver 拒绝 | PASS |
| AC-18 | 新增 real ToolRuntime + allowed approval 的 absent/pending/invalid table，三项均 zero fetch、safe local clear、record absent，malformed sentinel negative scan 通过 | PASS |
| AC-19 | caller/owner abort matrix 覆盖四条 I/O、gated read 与 post-I/O abort；atomic logout delete drain 完成 | PASS |
| AC-20 | dispose tests 证明先注销/gate、再 abort/drain；四 I/O 点、queued logout、signal listener removal 与 post-dispose schemas 均通过 | PASS |
| AC-21 | Native transcript 保留完整 sequence；新增真实 `ToolRuntime({ mode: 'code' })` + `ControlledCodeRuntime`，从 `run_code` 生成的 tools binding dispatch start/whoami，Session 中两组 start/settled event 的 name/subCallId 成对且覆盖 success/error，outer result 与 durable events 的 secret negative scan 通过 | PASS |
| AC-22 | transport/validator/provider thrown sentinel 与 cause 的 fixed error projection 和 transcript negative scan 全过 | PASS |
| AC-23 | build 35 modules/34.25 kB；Client Core slice 已内联；四个 DSH/Cordis contracts 为 exact optional peers，profile 不再安装 shadow graph | PASS |
| AC-24 | actual tarball 仅 5 files；installed smoke 覆盖 schema/direct execute/dispose、real Agent Loop scheduler dispatch 与 Host normal start/stop | PASS |
| AC-25 | Workspace `:3020` 与真实 checkout 启动的 fresh installed-artifact DSH `:61300` 均 ready；fresh profile 安装日志只新增 plugin+replay | PASS |
| AC-26 | real Agent start 生成 fresh handoff；Chrome 直接从该 visible handoff 打开批准页，用户在 Chrome 自行登录并批准；QA 未读取 cookies/storage/password | PASS |
| AC-27 | 批准后 real Agent 对 complete 与 whoami 各调用一次，均为 authenticated；whoami 可见 User name 与 Chrome 当前 Workspace User 匹配，报告不记录身份值 | PASS |
| AC-28 | real Agent logout 触发 DSH `Allow once`；用户批准后 safe local-clear 可见，随后 whoami 返回 `workspace-authentication-required` stable code；turn 正常结束 | PASS |
| AC-29 | app/Core README 对 single-origin、two-stage、secret、Host-only 与 owner 前提的说明和 Change scope 一致 | PASS |
| AC-30 | Server/OpenAPI/Browser protocol/CLI release workflow 无越界改写；focused、CLI package、最终 repo gates、OpenSpec strict 与 diff-check 全过 | PASS |

## Issues

每个 issue 都必须包含 severity、evidence、expected、repro 和 status；发现后立即发给
`/root/auth_implement`，修复后复验原 repro 与相关回归项。

| ID | Severity | Evidence | Expected | Repro | Status |
| --- | --- | --- | --- | --- | --- |
| AUTH-QA-001 | medium | 初版 transcript case 只经 Native execute 与手工 Session append，未经过 Code Mode transport；修复后新增 real `run_code` dispatch case。 | 使用真实 `ToolRuntime({ mode: 'code' })` 与可控 CodeRuntime，通过 `run_code` binding dispatch 至 auth tool；断言真实 Session 中成对出现 `tool/code-dispatch-start`/`tool/code-dispatch`，并对其 `arguments`、`content`、error projection 执行同一 secret negative scan。保留现有 Native evidence。 | 独立复验：`rg` 命中 `ControlledCodeRuntime`、`run_code` 及两类 durable event assertions；`pnpm --filter dsh-univer-work typecheck` exit 0；`pnpm --filter dsh-univer-work test` 2 files/50 tests PASS。逐行核对两组 event 的 name/subCallId、success/error settle 与 deviceCode/cookie/provider sentinel/password/Set-Cookie negative scan。 | fixed / verified |
| AUTH-QA-002 | high | 初版 actual tarball 在 profile 安装第二组 DSH contracts，使真实 Agent scheduler `prepare` 失败；修复把四个 Host contracts 改为 exact optional peers，并升级 installed smoke。 | actual tarball 安装后，真实 DSH Agent 必须用 Host 的同一组 DSH/Cordis public contract module identity 完成四个 auth tool dispatch；profile plugin 安装不得 shadow Host core runtime。package smoke 必须至少经 agent-loop scheduler/真实 Agent 调用一个 installed auth tool，才能覆盖该 seam。 | 独立复验：fresh profile 安装日志只新增 `dsh-univer-work` 与 replay 两包；installed smoke 由 profile resolution 加载 real Llm/Session/SystemPrompt/ToolRuntime/AgentRegistry/AgentLoop，并留下 `tool/call`/`tool/result` 后 PASS。停止旧实例并重新 pack/install；全新 DSH `127.0.0.1:61300` 中 Chrome real Agent 成功完成 `workspace_auth_start` 的两步 turn，未再出现 scheduler error。 | fixed / verified |
| AUTH-QA-003 | medium | 初版没有 approved pending/invalid/absent logout 的 direct ToolRuntime evidence；修复增加三项 table test。 | 在真实 `ToolRuntime` + allowed approval 下，对 pending、invalid、absent 三种 record 做 table test；每个 case 断言 zero fetch、safe `local_credentials_cleared`、record absent，且结果/transcript 不含 malformed payload sentinel。 | 独立核对测试逐项断言 zero fetch、safe result、record absent、malformed sentinel absent；`pnpm --filter dsh-univer-work test` 2 files/53 tests PASS。 | fixed / verified |
| AUTH-QA-004 | high | 初版四个 auth parameter schemas没有显式关闭 root object，因此真实 ToolRuntime可能接受未声明 own key并继续 credential/HTTP/logout approval effect；原 AC-11 只检查 secret-shaped字段缺失，没有验证 `additionalProperties: false` 或 pre-effect rejection。 | 四个已注册 parameter root均必须 `additionalProperties: false`；application wrapper还须 exact-own-key验证，使 start只接受 `{ origin }`，其余三个只接受 `{}`。任一 unexpected own key必须先返回 stable `INVALID_ARGS`，且 zero credential read/modify/delete、fetch、approval、owner/body effect。 | 独立复验 `authentication.test.ts` 的 real ToolRuntime table：四个 invalid call均 `INVALID_ARGS`，provider三个 observation flags、fetch和approval为0；紧随其后的四个 canonical valid call成功，logout恰好一次 approval。schema enumeration得到四个 `false`。focused 1 file/63 tests、typecheck、package verifier与 strict/diff均通过；Native/Code Mode transcript secrecy同一 focused file回归通过。 | fixed / verified |

## 实际执行结果

| 命令/探针 | 结果 |
| --- | --- |
| `pnpm --filter @univerjs/univer-workspace-client-core typecheck` | exit 0 |
| `pnpm --filter @univerjs/univer-workspace-client-core test` | exit 0；27 files、457 tests pass |
| `pnpm --filter dsh-univer-work typecheck` | exit 0 |
| `pnpm --filter dsh-univer-work test` | exit 0；2 files、53 tests pass；AUTH-QA-001/003 独立复验关闭 |
| `pnpm --filter dsh-univer-work build` | exit 0；35 modules、34.25 kB |
| `pnpm --filter dsh-univer-work package:verify` | exit 0；5-file closure |
| `pnpm --filter dsh-univer-work package:smoke` | exit 0；四 schema/direct execute/dispose、real Agent Loop scheduler dispatch 与 Host normal start/stop |
| `pnpm --filter univer-workspace-cli exec vitest run --config vitest.config.ts test/auth-transport.test.ts` | exit 0；1 file、17 tests pass |
| `pnpm package:workspace-cli` | exit 0；203 files、packed 13,029,849 bytes、unpacked 58,137,921 bytes |
| `openspec validate add-dsh-univer-work-authentication --strict` | exit 0 |
| `git diff --check` | exit 0 |
| `pnpm typecheck` | exit 0；5 workspace projects |
| `pnpm test` | 最终复验 exit 0；SDK dependency 4、release 8、Reference Provider 16、Client Core 457、DSH plugin 53、Workspace 152、CLI 69 tests pass |
| `pnpm build` | exit 0；lockfile supply-chain check 与 5 workspace project builds pass |
| 真实 Workspace `127.0.0.1:3020` | real path 全程 ready；验收后由 QA owner 停止并确认端口关闭 |
| 初版 installed-artifact DSH Web `127.0.0.1:58956` | Agent 首次 auth dispatch 被 AUTH-QA-002 阻断；实例已停止，不作为最终证据 |
| 修复后 fresh installed-artifact DSH Web `127.0.0.1:61300` | fresh Agent start、Chrome user approval、single complete/whoami、human-approved logout、post-logout auth-required 全部 PASS；验收后停止并确认端口关闭 |
| 隔离环境 cleanup | 两个 exact `/tmp/dsh-univer-auth-real*` QA 根（profile、tarball、fixture、Session log）已删除并验证不存在；未关闭或清理用户浏览器 |
| 2026-08-30 auth repair focused | `authentication.test.ts` 1 file、63 tests PASS；四个 schema closure、unexpected-own-key pre-effect rejection、canonical outcomes、logout approval、Native/Code transcript secrecy全部通过 |
| 2026-08-30 DSH typecheck | exit 0 |
| 2026-08-30 package verifier | exit 0；fresh build与 actual tarball closure通过 |
| 2026-08-30 auth strict/diff | `openspec validate add-dsh-univer-work-authentication --strict` 与 `git diff --check` exit 0 |
| 2026-08-30 full DSH regression | **DOWNSTREAM BLOCKED**：13 files / 619 tests pass，`parity-catalog.test.ts` 2 tests fail。其一 canonical snapshot尚未纳入四个 intentional auth schema closure；其二 `workspace_blob_upload` invalid args先触发approval，是 file-transfer predecessor gap。二者均不归 auth repair owner修改，见 follow-up说明。 |
| 2026-08-30 process/temp audit | 0 个 `dsh-parity-*` / `dsh-univer-work-pack-*` / `dsh-auth-*` temp roots，0 个相关存活进程 |

所有冻结步骤均已执行；真实用户路径没有由 fake Server 或 direct ToolRuntime smoke 代替。

## 初始 QA 结论

**PASS。** 30/30 AC 通过；AUTH-QA-001/002/003 均已修复并独立复验，open issue 为 0。真实
Workspace + installed DSH + Chrome 两阶段授权、whoami 与 human-approved logout 已完成；报告和命令
输出没有记录 credential secret 或 User identity value。

## 2026-08-30 predecessor repair follow-up

Auth repair坐标：`authentication.ts` `22dcf24f1f265ce68e74bbdfaf8992fb2672ac60`；
`authentication.test.ts` `20468bd80338e4a3f91744a0ef3ad8642419d98b`；final built Host
`84c517ea4e4f1ed7cee2978dbf5af7c9414e75b9`。

四个 parameter schemas现在均为 closed object。real ToolRuntime独立复验确认 unexpected own key在
credential read/modify/delete、fetch、approval和 owner/body effect前以 `INVALID_ARGS` 拒绝；四条
canonical valid行为保持，logout仍只在合法调用时请求一次批准。Native、Code Mode与 durable transcript
secret-negative matrix在63项 focused回归中保持通过。**Auth repair PASS，0 open auth findings。**

完整 DSH suite仍有两个明确的 downstream parity blocker，因此当前证据不能宣称整体 parity READY：

1. `parity-registry.json` `ac1e82d24c3e25e11c644d8b659732dfaef17d3c` 是故意冻结的下游 artifact，
   尚未加入四个 auth parameter root的 `additionalProperties: false`；应在 auth QA/review完成后由 parity owner
   重新生成，auth repair不直接编辑 snapshot。
2. `parity-catalog.test.ts` `58db0815f82dd040c6c55528ff4ef102ebb307b9` 还揭示独立的 file-transfer
   predecessor gap：`workspace_blob_upload` 对 `{ unexpected: true }` 在参数拒绝前增加一次 approval。
   该问题不由 auth owner修复，也不改变本 follow-up 的四条 auth zero-effect证据。

最终结论：**AUTH REPAIR PASS / 0 OPEN AUTH FINDINGS；OVERALL PARITY NOT READY（2 downstream blockers）。**
