# extract-auth-client-core QA

本文件定义并记录 Change `extract-auth-client-core` 的验收。QA 于 2026-08-28 针对实施前 tree `7c321d9ef0e44a62578fccd77cee15b8b753f500` 与实施后 tree `5b3823b4cd833cd81c7ef515694181481c47a93a` 独立执行。

## 基线与边界

- 前置实现：`extract-space-node-client-core` 已通过 QA 与 review；Client Core 的 HTTP/error owner、private package 和 CLI bundling 合同继续适用。
- 行为基线：实施 Change 2 前的目标仓库 tree。QA 必须记录实施前、后的 tree ID，并用 tree diff 核对公开行为与 owner 边界。
- Client Core 拥有 storage-neutral password login、browser approval start/complete、`whoami`、remote logout、User 与 Login Session credential 解析。
- CLI Client Shell 继续拥有 origin Config、Session/pending 文件、mutation queue、TTY/password 输入、Commander、输出和 `authenticatedHttp(role)` composition。
- Server endpoint、Cookie contract、CLI 文件 byte schema、命令面、错误码和安装方式不得改变。

## QA 结论

- **结论：PASS。** AC-01..AC-26 全部通过；AC-27 与 AC-28 因 `127.0.0.1:3020` 不可连接记录为 `environment-unavailable`，不构成产品失败，也未使用测试凭据。
- 自动化适用项：**26/26 pass**；环境项：**2 environment-unavailable**；open issue：**0**。
- Core 定向结果：4 files、59 tests 通过。CLI 定向结果：4 files、33 tests 通过。仓库全量结果：Client Core 59、reference-provider 16、CLI 109、Workspace 152 tests 通过，另有 repository scripts 12 tests 通过。
- `pnpm typecheck`、`pnpm test`、`pnpm build`、clean package、package verify、installed tarball smoke 与 `git diff --check` 均 exit 0。
- 结论只确认本 Change 的既定边界；QA 未要求或建议为一致性增加 credential-store interface、通用 identity framework、Client Shell 基类或大规模 compatibility layer。

## Spec scenario → 测试与命令

| OpenSpec scenario | 现有覆盖 | 实现后必须存在的直接覆盖 | 执行命令 |
| --- | --- | --- | --- |
| Client Shell starts authentication | `apps/cli/test/auth-transport.test.ts` 的 password/browser cases | Core auth tests 用显式 origin/`WorkspaceHttp` 分别调用 password、start、complete、whoami、logout；断言 endpoint、method、authenticated flag、body 和结构化结果 | `pnpm --filter @univerjs/univer-workspace-client-core test` |
| Core has no credential storage | 当前协议与文件混在 `WorkspaceAuth` | 静态 import 检查与 Core tests 证明 auth module 不读取 Config、filesystem、env、TTY、Commander 或 store；操作只返回 outcome/credential | Core typecheck/test，加 `rg` owner 检查 |
| Browser approval starts | `auth-transport.test.ts` browser approval case | Core tests 固定 device/user code、positive integer expiry/interval、absolute `expiresAt`、normalized origin 和 absolute verification URL；无 password/Cookie request header | Core test |
| Verification URL crosses origin | 当前源码有 origin/credential guard，缺少完整独立 cases | Core parameterized tests覆盖 cross-origin、URL username、URL password、invalid URL；均为 `workspace-invalid-response`，不得发第二个请求或泄露 device code | Core test |
| Approval remains pending | `auth-transport.test.ts` 验证一个 202 | Core test 断言一次 exchange、exact `{ deviceCode }`、202 body 必须为 `{ status: "pending" }`、返回 `{ status: "pending" }`、fetch 次数为 1 且无 timer/poll | Core test |
| Approval completes | `auth-transport.test.ts` 验证成功交换 | Core test 验证未过期时一次 exchange，严格 User/Set-Cookie parsing，返回 normalized origin、subject 与 cookie；结果不含 shell state | Core test |
| Password login succeeds | `auth-transport.test.ts` password case | Core test 验证 unauthenticated POST `/api/auth/password/login`、exact username/password body、first Cookie pair、User mapping；不持久化、不打印 credential | Core test |
| Current User response is invalid | 当前只间接由 `workspace-cli.test.ts` 覆盖 success | Core tests 分开覆盖 `authenticated !== true` → `workspace-authentication-required`，以及缺失/错误 `id`/`displayName` → `workspace-invalid-response` | Core test |
| Remote logout is requested | `auth-transport.test.ts` 只覆盖 CLI unknown result | Core tests 覆盖有 cookie 时一次 authenticated same-origin POST `/api/auth/logout`；network/body interruption 保留 `workspace-result-unknown`；Core 不清理 shell store | Core test |
| Approval spans CLI invocations | `workspace-cli.test.ts` built-entrypoint start/pending/success | 新 CLI persistence test 用两个以上 `WorkspaceAuth` 实例共享同一路径，逐 byte 检查 pending restore、一次 completion、success 后 Session 替换 pending、JSON/text 不变 | CLI auth 定向 test 与 built-entrypoint test |
| Remote logout result is unknown | `auth-transport.test.ts` 已断言 Session 清除 | 扩展为 Session 与 pending 同 origin 都清除，remote POST 一次，最后仍抛 `workspace-result-unknown`；无 Session 时不发 remote request | CLI auth test |
| Installed CLI authentication is exercised | Change 1 package smoke 只有 password login + Space read | tarball fixture 覆盖 browser start、一次 pending completion、一次 successful completion、whoami、authenticated `space list`、logout；临时 install cwd，无 source checkout/Core bare import | `pnpm package:workspace-cli && pnpm --filter univer-workspace-cli package:smoke` |

### Scenario 执行结果

| OpenSpec scenario | 实际证据 | 结论 |
| --- | --- | --- |
| Client Shell starts authentication | `packages/client-core/test/auth.test.ts` 直接调用 password/start/complete/whoami/logout；Core 59 tests 与 CLI 定向 33 tests 通过 | PASS |
| Core has no credential storage | `rg -n 'node:fs\|@univer-cli/config\|commander\|sessionPath\|credential' packages/client-core/src/auth*.ts` 无匹配；`auth.ts` 只导入 `./errors.js`、`./http.js` | PASS |
| Browser approval starts | Core test `starts a bounded browser approval with an absolute same-origin URL` 断言一次 start、codes、positive integer bounds、受控 `expiresAt` 与无认证 request | PASS |
| Verification URL crosses origin | Core parameterized cases覆盖 cross-origin、username、password、invalid URL，全部断言 `workspace-invalid-response`；error detail 不含 device code | PASS |
| Approval remains pending | Core test `completes one pending exchange without polling` 断言 exact body、fetch count 1、`setTimeout` 0 次与显式 pending | PASS |
| Approval completes | Core tests覆盖未过期的一次 exchange、strict User、first Cookie pair、invalid/unknown branches | PASS |
| Password login succeeds | Core test断言 unauthenticated `POST /api/auth/password/login`、exact body、normalized origin、subject、cookie，且无 storage callback | PASS |
| Current User response is invalid | Core `whoami` cases分别断言 unauthenticated 为 `workspace-authentication-required`、invalid User 为 `workspace-invalid-response` | PASS |
| Remote logout is requested | Core tests断言 supplied Cookie、一次 `POST /api/auth/logout` 与 interrupted body 的 `workspace-result-unknown` | PASS |
| Approval spans CLI invocations | CLI test `logs in through browser approval without sending a password` 使用多个 `WorkspaceAuth` 实例共享文件，逐 byte 核对 pending、pending 保留与 success 替换，并断言 1 start + 2 user-requested exchanges | PASS |
| Remote logout result is unknown | CLI tests断言 remote request 1 次、Session/pending 清空后再抛 `workspace-result-unknown`；无 Session 时 remote request 0 次 | PASS |
| Installed CLI authentication is exercised | `package:smoke` 在临时安装中通过 start→pending→success→whoami→Space list/browse→logout；fixture 断言 request counts 与 stdout/stderr 不含 cookie/device code | PASS |

## 验收标准

### Package 与 owner

- **AC-01** Client Core auth 通过现有 package 根入口提供 named exports；不创建第二个 package、Browser entry、publish contract、factory 或 service container。
- **AC-02** Core auth source 只依赖现有 Core HTTP/error 与标准数据类型；不得导入 `node:fs`、CLI Config/Session/command、credential store、TTY 或应用源码。
- **AC-03** `WorkspaceAuth` 保留 `configuredOrigin()`、`authenticatedHttp("client" | "worker")`、`readWorkspaceCookie()` 和唯一 CLI persistence owner；HTTP exchange/parser 的权威实现只在 Core，不在 Shell 留第二套副本。
- **AC-04** 不新增 credential-store interface、通用 identity framework、Client Shell 基类、大 compatibility layer 或第二套 auth owner；仅保留当前两个真实 consumers 所需的最小 protocol functions 与现有 CLI facade。

### Storage-neutral auth protocol

- **AC-05** password login 只发送一次 unauthenticated `POST /api/auth/password/login`，body 为 `{ username, password }`；成功返回 normalized origin、`{ id, name }` subject 和 Session cookie，不读取或写入外部状态。
- **AC-06** browser start 只发送一次 unauthenticated `POST /api/auth/cli/authorizations`；严格要求非空 device/user code、positive integer `expiresIn`/`interval`，并按受控 clock 计算有限的 absolute `expiresAt`。
- **AC-07** verification URL 必须可解析、与 Workspace origin 同源且 username/password 都为空；cross-origin、username credential、password credential 和 invalid URL 均以 `workspace-invalid-response` 拒绝。
- **AC-08** browser complete 在请求前拒绝已过期 pending，保留 `workspace-cli-authorization-expired`；未过期时只发送一次 unauthenticated `POST /api/auth/cli/authorizations/exchange` 和 exact `{ deviceCode }`。
- **AC-09** HTTP 202 只接受预期 pending body，返回显式 pending outcome 后立即结束；测试用 fetch count/timer guard 证明没有 sleep、retry、interval 或自动 polling。
- **AC-10** password/complete success 从 `Set-Cookie` 只提取当前 Login Session cookie pair，不带 `Path`、`HttpOnly` 等 attributes；缺失/空 cookie 或非 authenticated body 以 `workspace-invalid-response` 拒绝，且不返回半成品 credential。
- **AC-11** User parsing 要求 string `id` 与 `displayName`，映射为 `{ id, name }`；password、complete、whoami 对缺失或错误类型执行同一严格语义。
- **AC-12** `whoami` 使用 supplied Session credential 请求一次 `GET /api/session`；unauthenticated response 为 `workspace-authentication-required`，invalid User 为 `workspace-invalid-response`，有效结果包含 normalized origin 与 subject。
- **AC-13** remote logout 有 credential 时只发送一次 authenticated same-origin `POST /api/auth/logout`；成功或 `workspace-result-unknown` 都不决定 shell store，Core 不实现 local clear。

### CLI Session 与 pending persistence

- **AC-14** Change 前后的 Session-only 与 pending 文件使用 byte-for-byte fixture 比较，而不只比较 parsed JSON：两空格缩进、末尾换行、字段名/层级/顺序、normalized-origin keys、Cookie/subject 和 pending fields 均不变；空 pending 时继续省略 `pendingCliLogins`。
- **AC-15** 首次写入创建 mode `0700` parent 与 mode `0600` temporary/final Session file；每次 mutation 使用 same-directory temporary file + atomic rename，成功后无 `.tmp` 残留，不允许直接 truncate final file。
- **AC-16** mutation queue 在并发 save/clear/pending mutation 下不丢失其他 origin；成功 browser completion 在同一串行 mutation 中写 Session 并删除同 origin pending。
- **AC-17** 新 `WorkspaceAuth` invocation 能从同一路径恢复 pending；`pendingCliLogin()` 清除已过期项并返回 undefined；expired complete 同样清理并报告既有错误；pending response 或 transient unknown 不擅自删除仍有效 pending。
- **AC-18** corrupt file tests 覆盖 invalid JSON、非 record、invalid sessions/cookie/subject、invalid pending fields 与 key/candidate origin mismatch；全部返回 `workspace-session-corrupt`，不回退 env、其他 credential source 或空 store。
- **AC-19** logout 在 `finally` 中删除当前 origin 的 Session 与 pending；remote result unknown 时先确认 local bytes 已清理再透传错误。无本地 Session 时不得构造 remote request，但仍清理 pending。

固定 byte fixture 至少包含以下两种状态，值使用 synthetic test data：

```json
{
  "sessions": {
    "https://workspace.test": {
      "cookie": "workspace_session=test",
      "subject": "user-1"
    }
  }
}
```

```json
{
  "sessions": {},
  "pendingCliLogins": {
    "https://workspace.test": {
      "deviceCode": "test-device-code",
      "expiresAt": 1787879400000,
      "origin": "https://workspace.test",
      "userCode": "ABCD-EFGH",
      "verificationUrl": "https://workspace.test/cli-login?userCode=ABCD-EFGH"
    }
  }
}
```

fixture 文件本身也必须包含最后一个 `\n` byte。

### CLI command、安全与 parity

- **AC-20** `login`、`login --complete`、`login --username`、`--password-stdin`、`whoami`、`logout` 的 name、options、help 和互斥规则不变；默认 `login` 继续 browser approval，不读取 password。
- **AC-21** password rules 保持：`--complete` 不可与 username 合用；`--password-stdin` 必须配 username 且拒绝 TTY；interactive password 必须是 TTY、输入不回显；空 password、取消输入和错误 stream 保留既有 coded error/exit 1。测试不得把真实或 synthetic password 写入 assertion failure output。
- **AC-22** browser start 每次 invocation 发一次 start 后退出；`--complete` 每次 invocation 最多发一次 exchange，pending text 明确“已退出/不等待/不要轮询”。跨 invocation 的 request count 必须直接断言。
- **AC-23** JSON/text/coded errors 与基线逐项比较：authorization-required/pending/authenticated、whoami、logout 的 envelope 和文本不变；stdout/stderr、末尾换行、Commander `workspace.command.failed` 与 exit 1 不变。
- **AC-24** stdout、stderr、Commander error、test log、package-smoke log 和 exception detail 不得包含 Session cookie、password 或 device code；允许按既有合同呈现 user code 与 verification URL。Session/pending 文件只能存在于 mode `0600` 的隔离 home。

### Installed artifact、gate 与 local smoke

- **AC-25** clean package build 先构建 Client Core 并内联 auth runtime；tarball 无 unresolved Core bare import、private Core runtime dependency、source/test/map。临时安装 fixture 完成 start→pending→success→whoami→authenticated Space read→logout，并断言每步 request count、JSON shape 与 credential non-disclosure。
- **AC-26** 完整 gate 全部 exit 0：Core/CLI typecheck、test、build，repository test/build，package verify/smoke 与 `git diff --check`。Tree diff 证明 Workspace Server HTTP contract、routes 与 schema 未改；若实现确实改动它们，判 scope failure，并额外要求 `api:verify`，不得用生成物掩盖变化。
- **AC-27** local Workspace 可用时，以隔离 `UNIVER_HOME` 做 password login、whoami、read-only Space list/Node browse、logout；账号由环境注入，password 由安全 executable 写 stdin，不写入 Markdown、fixture、源码、shell history 或日志。
- **AC-28** `127.0.0.1:3020` 不可连接、Server 未启动或测试账号未配置时，AC-27 记录 `environment-unavailable`，不使用凭据、不判产品失败；该 smoke 不能替代 AC-01..AC-26。

验收项总数：**28**。

### AC 逐项结果

| AC | 实际观察与证据 | 结论 |
| --- | --- | --- |
| AC-01 | `packages/client-core/src/index.ts` 提供 auth named exports；diff 未新增 package、Browser entry、factory 或 container；Core typecheck/build 通过 | PASS |
| AC-02 | Core auth owner `rg` 无 fs/Config/Commander/sessionPath/credential 匹配；源码只依赖 Core error/HTTP | PASS |
| AC-03 | `WorkspaceAuth` 保留 `configuredOrigin`、`authenticatedHttp`、`readWorkspaceCookie` 与 persistence；CLI Shell 调用 Core 的五个 protocol exports，未保留 endpoint/parser 副本 | PASS |
| AC-04 | tree diff 未出现 credential store、identity framework、shell base class 或 compatibility layer | PASS |
| AC-05 | Core password test断言一次 unauthenticated POST、exact body、normalized result，并检查调用期间没有 state storage | PASS |
| AC-06 | Core start test断言一次 POST、nonempty codes、positive integer expiry/interval 和 finite controlled `expiresAt`；invalid/non-finite cases拒绝 | PASS |
| AC-07 | cross-origin、embedded username、embedded password、invalid URL 四类 Core cases 均以 `workspace-invalid-response` 拒绝 | PASS |
| AC-08 | expired case fetch 0 次并保留 `workspace-cli-authorization-expired`；有效 complete 一次 POST exact `{ deviceCode }` | PASS |
| AC-09 | 202 pending body严格解析；fetch 1 次、timer 0 次、无 retry/poll | PASS |
| AC-10 | password/complete tests验证只保留 first Cookie pair；missing/empty Set-Cookie 与 unauthenticated body 拒绝且无半成品结果 | PASS |
| AC-11 | password、complete、whoami 的 parameterized tests 对 string `id`/`displayName` 使用同一严格解析并映射 `{ id, name }` | PASS |
| AC-12 | `whoami` 断言 supplied Cookie、一次 GET、有效/unauthenticated/invalid User 三类结果 | PASS |
| AC-13 | remote logout tests断言一次 authenticated same-origin POST；success/result-unknown 均不触碰 shell store | PASS |
| AC-14 | CLI tests对 Session-only 与 pending JSON 使用完整 string 比较，固定两空格、字段顺序和末尾 newline；success 后省略空 pending | PASS |
| AC-15 | CLI persistence test实测 parent `0700`、final `0600`、目录只剩 `session.json`；源码为 same-directory temp write `0600` 后 rename | PASS |
| AC-16 | concurrent mutation test并发 login/start/logout 后保留其他 origins；browser success 同一 queued mutation 写 Session 并删 pending | PASS |
| AC-17 | 多 invocation pending 恢复、202/unknown 保留、expired lookup/complete 清理及保留其他 origin 均有直接测试 | PASS |
| AC-18 | CLI parameterized tests覆盖 invalid JSON、non-record、invalid sessions/cookie/subject、unnormalized/key mismatch/invalid pending，统一 `workspace-session-corrupt` | PASS |
| AC-19 | remote unknown 后 local bytes为仅空 sessions；无 Session 时仍清 pending且 remote request 0 次 | PASS |
| AC-20 | command-contract test固定 command names、options、help 与 browser default；built-entrypoint auth/config/reference/inspection flow通过 | PASS |
| AC-21 | command-contract test覆盖 option/TTY/stdin boundaries；额外可执行探针验证 interactive input不回显、Ctrl-C 为 `workspace-password-input-cancelled`，empty piped password为 exit 1/coded error | PASS |
| AC-22 | Core timer guard与 CLI跨 invocation request array证明 start一次、每个 complete至多一次；text source和 built/package flow保留退出/不等待/不轮询指引 | PASS |
| AC-23 | command-contract、built-entrypoint 与 package smoke 解析既有 JSON/text envelope；empty-password built probe确认 coded stderr、empty stdout、exit 1 | PASS |
| AC-24 | Core error cases、Commander JSON、TTY probe与 package smoke的 secret guards均通过；Session mode为 `0600` | PASS |
| AC-25 | clean `package:workspace-cli`、`package:verify`、临时安装 `package:smoke` 全部 exit 0；认证全链、authenticated Space read、request counts 与 non-disclosure均通过 | PASS |
| AC-26 | Core/CLI定向与 repository typecheck/test/build/package/verify/smoke/diff-check 均 exit 0；Server contract/server diff为空 | PASS |
| AC-27 | 2026-08-28 10:23:31 CST 对 `127.0.0.1:3020` 检查得到 HTTP `000`、curl exit `7`；未读取或使用账号凭据 | environment-unavailable |
| AC-28 | Server 不可连接，按约定跳过真实 authenticated smoke；自动化 gate 未被替代 | environment-unavailable |

## 执行命令

### 本轮实际执行

| 命令 | 结果 |
| --- | --- |
| `openspec status --change extract-auth-client-core --json`；`openspec instructions apply --change extract-auth-client-core --json` | planning complete，6/6 tasks checked；QA 另行验证，不以勾选替代证据 |
| `pnpm --filter @univerjs/univer-workspace-client-core typecheck && pnpm --filter @univerjs/univer-workspace-client-core build && pnpm --filter @univerjs/univer-workspace-client-core test` | exit 0；4 files、59 tests pass |
| `pnpm --filter univer-workspace-cli typecheck && pnpm --filter univer-workspace-cli build` | exit 0 |
| `pnpm --filter univer-workspace-cli exec vitest run --config vitest.config.ts test/auth-transport.test.ts test/application-command-contracts.test.ts test/workspace-cli.test.ts test/space-cli.test.ts` | exit 0；4 files、33 tests pass |
| `node --input-type=module` inline probe，导入 built `readPassword` 并用 synthetic TTY 分别发送一行与 Ctrl-C | `interactive-password-probe: pass`；prompt仅为 `Password: ` + newline，输入不回显；取消 code 正确 |
| `UNIVER_HOME=<isolated-temp> node apps/cli/dist/main.js login --username alice --password-stdin --json </dev/null`，随后检查 stdout/stderr | exit 1；empty stdout；stderr含 `workspace-argument-invalid`；无 cookie/device code/synthetic secret |
| `pnpm --filter @univerjs/univer-workspace-client-core run clean && pnpm --filter univer-workspace-cli run clean && pnpm package:workspace-cli && pnpm --filter univer-workspace-cli package:verify && pnpm --filter univer-workspace-cli package:smoke` | exit 0；`[package-smoke] installed tarball commands passed` |
| `pnpm typecheck && pnpm test && pnpm build && git diff --check` | exit 0；Core 59、reference-provider 16、CLI 109、Workspace 152、repository scripts 12 tests pass |
| owner/scope `rg` 与 `git diff --name-only 7c321... 5b382... -- apps/workspace/contracts/http apps/workspace/server` | Core forbidden imports 0；source/dist direct imports 0；Server diff 0 |
| `curl --silent --show-error --max-time 3 -o /dev/null -w '%{http_code}' http://127.0.0.1:3020/` | 2026-08-28 10:23:31 CST：HTTP 000、curl exit 7；environment unavailable |

最小相关检查：

```bash
pnpm --filter @univerjs/univer-workspace-client-core typecheck
pnpm --filter @univerjs/univer-workspace-client-core build
pnpm --filter @univerjs/univer-workspace-client-core test
pnpm --filter univer-workspace-cli typecheck
pnpm --filter univer-workspace-cli build
pnpm --filter univer-workspace-cli exec vitest run --config vitest.config.ts \
  test/auth-transport.test.ts \
  test/auth-cli.test.ts \
  test/workspace-cli.test.ts \
  test/space-cli.test.ts
```

若实现采用其他 auth test filename，QA 以 test title 与 scenario assertion 为准；不得因改名漏掉 owner-specific coverage。

clean package 与 installed fixture：

```bash
pnpm --filter @univerjs/univer-workspace-client-core run clean
pnpm --filter univer-workspace-cli run clean
pnpm package:workspace-cli
pnpm --filter univer-workspace-cli package:verify
pnpm --filter univer-workspace-cli package:smoke
```

完整 gate：

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm package:workspace-cli
pnpm --filter univer-workspace-cli package:verify
pnpm --filter univer-workspace-cli package:smoke
git diff --check
```

静态 owner 与 scope 检查：

```bash
rg -n 'node:fs|@univer-cli/config|commander|sessionPath|credential' \
  packages/client-core/src/auth*.ts
rg -n 'client-core/(src|dist)' apps packages --glob '*.ts' --glob '*.mjs'
git diff --name-only <before-tree> <after-tree> -- \
  apps/workspace/contracts/http apps/workspace/server
```

第一条 `rg` 的预期是 auth protocol source 无匹配；测试或 README 中的描述不构成 owner violation。

## 可选 local Workspace smoke

先检查 local Server，不可用时只记录 `environment-unavailable`：

```bash
curl --silent --show-error --max-time 3 -o /dev/null -w '%{http_code}' \
  http://127.0.0.1:3020/
```

执行账号 smoke 时关闭 trace，设置 `umask 077`。操作者安全注入 `UNIVER_WORKSPACE_SMOKE_ORIGIN`、`UNIVER_WORKSPACE_SMOKE_USERNAME`、可选 executable 路径 `UNIVER_WORKSPACE_SMOKE_CLI`，以及只向 stdout 写 password 的 executable 路径 `UNIVER_WORKSPACE_SMOKE_SECRET_PROVIDER`。不得把 password 直接写在命令中：

```bash
set +x
umask 077
WORKSPACE_AUTH_SMOKE_ROOT="$(mktemp -d)"
export UNIVER_HOME="$WORKSPACE_AUTH_SMOKE_ROOT/home"
WORKSPACE_AUTH_SMOKE_CLI="${UNIVER_WORKSPACE_SMOKE_CLI:-univer-workspace-cli}"
trap 'rm -rf "$WORKSPACE_AUTH_SMOKE_ROOT"' EXIT

"$WORKSPACE_AUTH_SMOKE_CLI" config set workspace.origin \
  "$UNIVER_WORKSPACE_SMOKE_ORIGIN" --json >"$WORKSPACE_AUTH_SMOKE_ROOT/config.json"
"$UNIVER_WORKSPACE_SMOKE_SECRET_PROVIDER" | "$WORKSPACE_AUTH_SMOKE_CLI" login \
  --username "$UNIVER_WORKSPACE_SMOKE_USERNAME" --password-stdin --json \
  >"$WORKSPACE_AUTH_SMOKE_ROOT/login.json"
"$WORKSPACE_AUTH_SMOKE_CLI" whoami --json >"$WORKSPACE_AUTH_SMOKE_ROOT/whoami.json"
"$WORKSPACE_AUTH_SMOKE_CLI" space list --json >"$WORKSPACE_AUTH_SMOKE_ROOT/spaces.json"

WORKSPACE_AUTH_SMOKE_SPACE_ID="$(node -e '
  const fs = require("node:fs");
  const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (!Array.isArray(value.spaces) || value.spaces.length === 0) process.exit(1);
  process.stdout.write(value.spaces[0].id);
' "$WORKSPACE_AUTH_SMOKE_ROOT/spaces.json")"
"$WORKSPACE_AUTH_SMOKE_CLI" space browse "$WORKSPACE_AUTH_SMOKE_SPACE_ID" --json \
  >"$WORKSPACE_AUTH_SMOKE_ROOT/nodes.json"
"$WORKSPACE_AUTH_SMOKE_CLI" logout --json >"$WORKSPACE_AUTH_SMOKE_ROOT/logout.json"

node -e '
  const fs = require("node:fs");
  const paths = process.argv.slice(1);
  const values = paths.map((path) => JSON.parse(fs.readFileSync(path, "utf8")));
  const [login, whoami, spaces, nodes, logout] = values;
  if (login.status !== "authenticated") process.exit(1);
  if (typeof whoami.subject?.id !== "string") process.exit(1);
  if (!Array.isArray(spaces.spaces) || !Array.isArray(nodes.nodes)) process.exit(1);
  if (logout.loggedOut !== true) process.exit(1);
  const serialized = JSON.stringify(values);
  if (serialized.includes("workspace_session=") || serialized.includes("deviceCode")) process.exit(1);
' "$WORKSPACE_AUTH_SMOKE_ROOT/login.json" \
  "$WORKSPACE_AUTH_SMOKE_ROOT/whoami.json" \
  "$WORKSPACE_AUTH_SMOKE_ROOT/spaces.json" \
  "$WORKSPACE_AUTH_SMOKE_ROOT/nodes.json" \
  "$WORKSPACE_AUTH_SMOKE_ROOT/logout.json"

unset UNIVER_WORKSPACE_SMOKE_USERNAME WORKSPACE_AUTH_SMOKE_SPACE_ID
```

QA 只记录成功/失败、非敏感 origin、执行时间和失败阶段，不复制 login/whoami response，也不记录账号。

## QA 观察记录

| 观察面 | 基线合同 | QA 证据 | 结论 |
| --- | --- | --- | --- |
| Core owner | storage-neutral protocol，无 Config/filesystem/command owner | owner `rg` 0 matches；Core source只依赖 error/HTTP；named exports/build/typecheck通过 | PASS |
| Password/User/Cookie | endpoint/body、strict User、Session Cookie pair | Core direct tests覆盖 exact requests、first Cookie pair、strict User及全部 invalid branches | PASS |
| Browser approval | start/expiry/same-origin/pending/single exchange/no poll | Core direct tests覆盖 URL origin/credentials、finite expiry、fetch count 0/1、timer 0；CLI跨 invocation request count固定 | PASS |
| Whoami/logout | authenticated request、strict response、result-unknown ownership | Core direct tests覆盖 Cookie/GET/POST/unknown；CLI测试确认 finally local clear | PASS |
| Session/pending bytes | schema、0600、atomic rename、queue、corrupt/expiry | CLI完整 byte string、mode、无 temp、并发、多 origin、8类 corrupt/expiry cases全部通过 | PASS |
| CLI command/output | TTY/password、cross-invocation、JSON/text/coded errors、无 secret output | command/built tests + 两个额外 probe；定向33、全量109 tests通过 | PASS |
| Installed artifact | tarball start/complete/whoami/authenticated command/logout，无 checkout dependency | clean package verify/smoke通过；request counts与secret guards由安装后fixture断言 | PASS |
| Local smoke | 隔离 home 的真实 login/whoami/read-only/logout | local Server HTTP 000/curl 7，未使用凭据 | environment-unavailable |

若发现能力差异，先记录公开合同、影响命令和风险。不得为了抹平内部重排差异引入 credential-store interface、通用 identity framework、大 compatibility layer、第二套协议实现或长期 shim。

## QA issues

状态取值：`open`、`fixed-pending-qa`、`closed`、`accepted-risk`。

| ID | 严重度 | 证据 | 期望 | 状态 |
| --- | --- | --- | --- | --- |

**Open issues：0。** 本轮未发现需要登记的产品、spec 或 scope issue。

## STD-01 review fix 复验（2026-08-28）

复验基线为审查 tree `5b3823b4cd833cd81c7ef515694181481c47a93a`，修复后 tree 为 `f89949bdd302f6fdbf615fc4bcfad80205d627eb`。产品修复 diff 只涉及 `packages/client-core/src/auth.ts` 与 `packages/client-core/test/auth.test.ts`；同一 tree 区间的 QA/review Markdown 变化不计为产品 scope。

| 复验项 | 实际证据 | 结论 |
| --- | --- | --- |
| Expiry 优先级 | `completeCliLogin()` 源码先判断 `now() >= pending.expiresAt`，再判断 origin；built Core 组合探针同时设置 expired 与 mismatch，得到既有 `workspace-cli-authorization-expired` | PASS |
| Origin mismatch | 新 Core test `rejects a pending approval for another Workspace before fetch` 与 built probe 均得到既有 `workspace-origin-mismatch` | PASS |
| 请求与 secret | mismatch test/probe 均断言 fetcher 0 次；错误 message 不含 synthetic device code，探针 stdout 只输出 pass 标记 | PASS |
| 成功 origin | success path 改为将已验证的 `http.origin` 传入 Session parser；built probe确认 result origin 同时等于 normalized `WorkspaceHttp.origin` 与 pending origin | PASS |
| Core 回归 | Core typecheck/build/test exit 0：4 files、60 tests pass | PASS |
| CLI 回归 | CLI typecheck/build exit 0；`auth-transport`、`application-command-contracts`、`workspace-cli` 共 3 files、32 tests pass | PASS |
| Installed artifact | 修复会进入 bundled auth completion runtime，因此按风险重跑 `package:workspace-cli`、`package:verify`、`package:smoke`；全部 exit 0，installed auth flow通过 | PASS |
| Diff hygiene | `git diff --check` exit 0；审查 tree 间产品改动仅 auth source/test | PASS |

实际执行命令：

```bash
pnpm --filter @univerjs/univer-workspace-client-core typecheck
pnpm --filter @univerjs/univer-workspace-client-core build
pnpm --filter @univerjs/univer-workspace-client-core test
pnpm --filter univer-workspace-cli typecheck
pnpm --filter univer-workspace-cli build
pnpm --filter univer-workspace-cli exec vitest run --config vitest.config.ts \
  test/auth-transport.test.ts \
  test/application-command-contracts.test.ts \
  test/workspace-cli.test.ts
node --input-type=module # inline built-Core expiry/mismatch/success-origin probe
pnpm package:workspace-cli
pnpm --filter univer-workspace-cli package:verify
pnpm --filter univer-workspace-cli package:smoke
git diff --check
```

**复验结论：PASS。Open issues：0。** STD-01 已修复，Change 2 的既有 QA 结论保持不变；从 QA 证据看仍为 `Ready to archive`。
