# extract-space-node-client-core QA

本文件定义 Change `extract-space-node-client-core` 的验收标准，并在实现后记录 QA issue。当前只定义验收范围，不代表实现已经通过。

## 基线与范围

- 行为基线：Change 设计记录的 `081a8e7f30141b3d1dbb4a2200db426b56bfdb28`。
- 产品代码范围：`packages/client-core/**`、`apps/cli` 的迁移 shim、Space/Node composition、workspace build/package 配置和对应文档。
- Server HTTP contract、认证 Session 格式、Commander 命令面、输出格式、错误码和安装方式均保持不变。
- QA 比较公开行为和线上的 HTTP request contract，不要求保留旧源码目录或内部 class 构造方式。

## Scenario 到验证映射

| OpenSpec scenario | 现有覆盖 | 实现后必须存在的覆盖 | 执行命令 |
| --- | --- | --- | --- |
| Client Shell supplies authenticated access | `apps/cli/test/application-features.test.ts` 中 Space list/browse/find 用例 | Client Core 测试直接传入惰性 `() => Promise<WorkspaceHttp>`，连续两次调用分别取当前 HTTP 实例；package 测试不得读取 CLI config、Session path 或 Commander | `pnpm --filter @univerjs/univer-workspace-client-core test` |
| Browser consumer is excluded | 无运行时用例 | `packages/client-core/README.md` 明确 Node-hosted consumer 边界；package manifest 不增加 DOM/Browser entry 或 browser auth dependency | `pnpm --filter @univerjs/univer-workspace-client-core build`，再审查 README 与 `package.json` |
| Request leaves the configured origin | `apps/cli/test/auth-transport.test.ts` 的 redirect/cross-origin Cookie 用例 | 迁移到 Core 的 transport 测试覆盖非法 origin、URL credentials、cross-origin path、manual redirect；断言 Cookie 不发送到新 origin，并保留 `workspace-origin-invalid`、`workspace-origin-mismatch`、`workspace-redirect-refused` | `pnpm --filter @univerjs/univer-workspace-client-core test` |
| Server response violates the expected shape | `apps/cli/test/application-features.test.ts` 的 broadened capability、mismatched response 用例；`auth-transport.test.ts` 的错误 envelope 用例 | Core parser 测试覆盖 Space identity/type、Node identity/space/parent、capabilities、resource、pagination、Trash Batch；错误仍为 `WorkspaceApplicationError` 且 code 为 `workspace-invalid-response`。旧 CLI shim 和 package export 指向同一 class，交叉 `instanceof` 成立 | `pnpm --filter @univerjs/univer-workspace-client-core test` 与 CLI 定向测试 |
| Browse spans multiple pages | 现有 list/browse/find 只覆盖单页 | 新增 Core 多页 fixture：验证 cursor URL 编码、请求顺序、metadata 在页间相同、Node 顺序和 path/parent/space context 不变；另覆盖 blob/univer/none 与 unit type filter | `pnpm --filter @univerjs/univer-workspace-client-core test` |
| Pagination or hierarchy repeats | `application-features.test.ts` 的 repeated cursor、cyclic traversal 用例 | 原断言迁移到 Core；分别证明重复 cursor 和重复/循环 Node 以 `workspace-invalid-response` 终止，且请求次数有限 | `pnpm --filter @univerjs/univer-workspace-client-core test` |
| Rename or move response is unknown | `application-features.test.ts` 的 read-back 用例 | Core 测试分别覆盖 rename、move-to-parent、move-to-root：只发送一次 PATCH，失败后只读一次 GET；仅当 name/parent 与请求一致时成功，否则返回 `workspace-result-unknown`，不得 replay PATCH | `pnpm --filter @univerjs/univer-workspace-client-core test` |
| Create or Trash response is unknown | `application-features.test.ts` 的 uncertain create、unknown trash 用例 | 原断言迁移到 Core；每种操作只写一次，不 blind retry；错误 code、message 和 detail 保留公开 request identity | `pnpm --filter @univerjs/univer-workspace-client-core test` |
| Existing CLI contract is exercised | `application-command-contracts.test.ts` 的 Space/Node 参数映射；`application-features.test.ts` 的 request 行为；`workspace-cli.test.ts` 只检查 help 中存在 `space` | CLI 测试继续覆盖所有命令参数和 envelope；补充 built-entrypoint fixture，实际执行至少 list、paged browse、create、rename、move、trash，校验 request、stdout/stderr、exit code 和 Session cookie | CLI 定向测试命令和完整 `pnpm --filter univer-workspace-cli test` |
| Installed CLI artifact runs outside the monorepo | `verify-package.mjs` 检查 unresolved imports；`smoke-package.mjs` 安装 tarball 后只运行通用命令 | package smoke 在临时 install cwd、无源码 checkout 条件下运行 `space --help`，并针对本地 same-origin fixture 运行至少 `space list --json` 与 `space browse ... --json`；tarball 不含 unresolved `@univerjs/univer-workspace-client-core` bare import，也不把 private Core 声明为安装依赖 | `pnpm package:workspace-cli && pnpm --filter univer-workspace-cli package:smoke` |

## 验收项

### Package 与迁移边界

- **AC-01** `packages/client-core/package.json` 的 name 为 `@univerjs/univer-workspace-client-core`、`private: true`，只提供 manifest 声明的 named exports；没有发布脚本、Browser entry、factory framework 或空的未来 capability 目录。
- **AC-02** package 独立通过 typecheck、build 和 test，且 build 不读取相邻仓库、绝对路径或已存在的 stale `dist`。
- **AC-03** errors、HTTP transport、Space/Node model 与 workflow 的权威实现只存在于 Client Core；旧 CLI 路径仅包含 exact named re-export shim。`rg` 不应找到复制的 class、parser 或 workflow body。
- **AC-04** `apps/cli` 通过 package public exports 消费 Space/Node；manifest 使用 `workspace:*`，代码不跨 package 导入 `src` 或 `dist`。
- **AC-05** Client Core 只接收惰性 authenticated HTTP provider；Core source 不导入 CLI 的 `WorkspaceAuth`、Config、Session、Commander、daemon 或 credential storage。

### Transport、模型与 workflow

- **AC-06** transport 保留 origin normalization、HTTP(S)-only、no-credentials、same-origin、manual redirect、认证 Cookie、`x-univer-cli-sdk-role: client`、写请求 Origin 与错误 envelope 语义。
- **AC-07** JSON body 中断产生 `workspace-result-unknown`；非法 JSON、非 object payload 和严格 parser 失败产生 `workspace-invalid-response`；HTTP service 的 string/numeric error code、message 与 path/status detail 不变。
- **AC-08** list、browse、recursive browse、filter 和 find 的 path、query、pagination 顺序与结构化结果和基线一致；多页 metadata 变化、cursor 重复和 Node cycle 均有限终止。
- **AC-09** create、rename、move、trash 的 method、URL、JSON body 和 response identity 检查与基线一致；Node name 继续 trim，并执行 1..255 长度校验。
- **AC-10** rename/move 的 unknown result 只通过 GET read-back 确认，不 replay PATCH；create/trash 的 unknown result 不自动重试，且保留各自的用户指引和 detail。
- **AC-11** re-export shim 与 package export 暴露同一 `WorkspaceApplicationError`、`WorkspaceResultUnknownError` class identity；现有 `instanceof`、`isWorkspaceResultUnknown` 和 coded error 分支继续工作。

### CLI parity

- **AC-12** 下列命令、参数、help 文案和必填/互斥规则保持不变：`space list`、`space browse <space>`、`space find <query...> --space`、`space node create|rename|move|trash`、`--parent`、`--root`、`--recursive`、`--resource-kind`、`--unit-type`、`--json`。
- **AC-13** JSON envelope 保持为 `{ spaces }`、`{ nodes }`、`{ node }`、`{ trashBatch }`；当前无定制 text formatter 的命令在未传 `--json` 时仍输出相同的 pretty JSON 和末尾换行。
- **AC-14** coded failure 仍写 stderr、exit code 为 1、Commander code 为 `workspace.command.failed`；错误文本保持 `<code>: <message>`、可选 pretty-printed detail，并在认证失败时保留 login hint。
- **AC-15** CLI Session path、按 normalized origin 选 Session、Cookie 内容和权限不变；Space/Node 请求通过当前 Session 取得 HTTP，Core 不读取或写入 Session 文件。

### Artifact 与完整 gate

- **AC-16** 从 Core 与 CLI 的 clean build state 执行 packaging 时先构建 Client Core，再 bundle CLI；流程不依赖此前生成的 package `dist`。
- **AC-17** `package-dist` 与实际 npm tarball 仍是自包含 CLI：没有 `.ts`/source/test/map、没有 unresolved workspace bare import、没有 private Core runtime dependency；临时安装目录中的 executable 能运行真实 Space list/browse fixture。
- **AC-18** 完整 gate 全部退出 0，且 `git diff --check` 无本 Change 引入的问题；Server OpenAPI/route 没有变化，CLI Space/Node、Session 和 installed artifact parity 均有上述直接证据。
- **AC-19** Server 可用时，以执行环境安全提供的账号运行一次隔离的 authenticated smoke：login、whoami、Space list 和 Node browse 成功，期间不把用户名或密码写入 Markdown、fixture、源码、命令 trace 或测试日志。Server 不可用时记录环境缺失，不把该项判成产品失败，也不据此跳过 AC-01..AC-18。

验收项总数：**19**。

## 命令清单

先跑最小相关检查：

```bash
pnpm --filter @univerjs/univer-workspace-client-core typecheck
pnpm --filter @univerjs/univer-workspace-client-core build
pnpm --filter @univerjs/univer-workspace-client-core test
pnpm --filter univer-workspace-cli typecheck
pnpm --filter univer-workspace-cli exec vitest run --config vitest.config.ts \
  test/application-command-contracts.test.ts \
  test/auth-transport.test.ts \
  test/workspace-cli.test.ts
```

若迁移后的 Core tests 使用不同文件名，QA 以 test title 与 scenario 断言为准，同时确认这些 case 不再由 CLI 私有实现承载。

验证 clean packaging：

```bash
pnpm --filter @univerjs/univer-workspace-client-core run clean
pnpm --filter univer-workspace-cli run clean
pnpm package:workspace-cli
pnpm --filter univer-workspace-cli package:verify
pnpm --filter univer-workspace-cli package:smoke
```

最终 gate：

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm package:workspace-cli
pnpm --filter univer-workspace-cli package:smoke
git diff --check
```

## 可选 local Workspace authenticated smoke

该 smoke 只补充真实部署证据，不能替代自动化测试、package smoke 或完整 gate。默认只读 Workspace 内容；`login/logout` 仅管理本次隔离 Session。

执行前由操作者安全设置以下值：

- `UNIVER_WORKSPACE_SMOKE_ORIGIN`：当前 local Workspace origin。
- `UNIVER_WORKSPACE_SMOKE_USERNAME`：测试用户名，通过执行环境注入，不写进脚本或日志。
- `UNIVER_WORKSPACE_SMOKE_CLI`：待测 executable 的绝对路径；未设置时使用 PATH 中的 `univer-workspace-cli`。
- `UNIVER_WORKSPACE_SMOKE_SECRET_PROVIDER`：只向 stdout 写入密码的安全 executable 绝对路径；密码本身不进入环境变量、shell history、fixture 或文件。

执行时关闭 shell trace，设置 `umask 077`，使用临时 `UNIVER_HOME`，并把可能包含 subject 的 JSON 写入仅当前用户可读的临时文件。Secret provider 不得把密码写入自身日志：

```bash
set +x
umask 077
WORKSPACE_SMOKE_ROOT="$(mktemp -d)"
export UNIVER_HOME="$WORKSPACE_SMOKE_ROOT/home"
WORKSPACE_SMOKE_CLI="${UNIVER_WORKSPACE_SMOKE_CLI:-univer-workspace-cli}"
trap 'rm -rf "$WORKSPACE_SMOKE_ROOT"' EXIT

"$WORKSPACE_SMOKE_CLI" config set workspace.origin "$UNIVER_WORKSPACE_SMOKE_ORIGIN" --json \
  >"$WORKSPACE_SMOKE_ROOT/config.json"
"$UNIVER_WORKSPACE_SMOKE_SECRET_PROVIDER" | "$WORKSPACE_SMOKE_CLI" login \
  --username "$UNIVER_WORKSPACE_SMOKE_USERNAME" --password-stdin --json \
  >"$WORKSPACE_SMOKE_ROOT/login.json"
"$WORKSPACE_SMOKE_CLI" whoami --json >"$WORKSPACE_SMOKE_ROOT/whoami.json"
"$WORKSPACE_SMOKE_CLI" space list --json >"$WORKSPACE_SMOKE_ROOT/spaces.json"

WORKSPACE_SMOKE_SPACE_ID="$(node -e '
  const fs = require("node:fs");
  const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (!Array.isArray(value.spaces) || value.spaces.length === 0) process.exit(1);
  process.stdout.write(value.spaces[0].id);
' "$WORKSPACE_SMOKE_ROOT/spaces.json")"
"$WORKSPACE_SMOKE_CLI" space browse "$WORKSPACE_SMOKE_SPACE_ID" --json \
  >"$WORKSPACE_SMOKE_ROOT/nodes.json"

node -e '
  const fs = require("node:fs");
  const login = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const whoami = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const nodes = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
  if (login.status !== "authenticated") process.exit(1);
  if (typeof whoami.origin !== "string" || typeof whoami.subject?.id !== "string") process.exit(1);
  if (!Array.isArray(nodes.nodes)) process.exit(1);
' "$WORKSPACE_SMOKE_ROOT/login.json" \
  "$WORKSPACE_SMOKE_ROOT/whoami.json" \
  "$WORKSPACE_SMOKE_ROOT/nodes.json"

"$WORKSPACE_SMOKE_CLI" logout --json >"$WORKSPACE_SMOKE_ROOT/logout.json"
unset UNIVER_WORKSPACE_SMOKE_USERNAME WORKSPACE_SMOKE_SPACE_ID
```

QA 只记录命令成功/失败、origin、执行时间和失败阶段，不复制 login/whoami response，也不记录测试账号。若 origin 无法连接、Server 未启动或账号未配置，在观察记录中写 `environment-unavailable` 及非敏感原因；完整自动化 gate 仍必须执行。

## CLI parity 观察记录

实现后 QA 在这里记录证据，不用内部重排代替公开行为验证。

| 观察面 | 基线合同 | QA 证据 | 结论 |
| --- | --- | --- | --- |
| Command/help | AC-12 列出的命令、参数、description 和互斥规则 | tree diff 只改变 `space/command.ts` imports；`application-command-contracts.test.ts` 与 built-entrypoint `space-cli.test.ts` 通过，共 15 个定向 CLI tests | pass |
| HTTP request | `/api/spaces`、Space Nodes/children cursor、Node POST/PATCH/trash；Cookie、role、Origin 和 manual redirect | Core 29 tests 覆盖 transport/workflow；built entrypoint 记录 GET/POST/PATCH/trash、encoded cursor、Cookie、client role 和 write Origin | pass |
| JSON/text | `{ spaces }`、`{ nodes }`、`{ node }`、`{ trashBatch }`；pretty JSON 与末尾换行 | `space-cli.test.ts` 验证四类 JSON envelope；`apps/cli/src/command.ts` 与 baseline tree 完全相同，未传 `--json` 的 formatter 路径不变 | pass |
| Error/exit | 既有 Workspace code、message/detail、auth hint、stderr、exit 1 | built entrypoint 验证 `workspace-invalid-response`、空 stdout、stderr 和 exit 1；`command.ts` 未变，Core error identity 测试通过 | pass |
| Session | normalized origin、session file bytes/path/mode 与 current-session lookup | baseline/implementation tree 对比确认 `config.ts`、`auth/session.ts` 未变；auth-transport 与 built-entrypoint login/current Session tests 通过 | pass |
| Result unknown | update read-back；create/trash no blind retry；同一 error class identity | Core tests 验证 rename/move 各 1 PATCH + 1 GET、create/trash 单次写、无法确认时 coded error；CLI shim/Core 交叉 `instanceof` 通过 | pass |
| Installed artifact | 临时 cwd 安装 tarball，真实 Space command 可运行，无 checkout/private Core runtime dependency | clean packaging、verify 与 smoke 通过；203 files，packed 13,023,810 bytes；临时 npm install 后 Space list/browse 通过，manifest/bundle 无 Core runtime dependency/bare import | pass |
| Local authenticated smoke | 隔离 Session 下 login/whoami/Space list/Node browse；无 credential 泄露 | 2026-08-28 检查 `127.0.0.1:3020` 返回 connection refused/HTTP 000；未读取或使用测试凭据 | environment-unavailable（不判产品失败） |

如果出现能力差异，先记录事实、影响命令和风险。不得为了抹平低价值内部差异引入通用 abstraction、大规模 compatibility layer、第二套 transport/model 或长期 shim；只有公开 CLI 合同或数据安全受到影响时才要求兼容修复。

## QA 执行结果

Implementation tree：`5f089b4573d2d5c1d040541800f303b6e63d17fe`。Baseline tree：`96aa8efde0e5a8a9dad32bc3b3b80fa60a6cdab4`。

| AC | 结论 | 直接证据 |
| --- | --- | --- |
| AC-01 | pass | Core manifest 为指定 name、`private: true`、单一根 export；README 固定 Node-hosted/private/non-Browser 边界，无 publish script 或预建 capability。 |
| AC-02 | pass | Core typecheck/build/test 均 exit 0；3 files、29 tests 通过。clean 后 packaging 重新执行 Core `tsc`。 |
| AC-03 | pass | `errors.ts`、`http.ts`、`space-model.ts`、`space.ts` 的旧 CLI 路径均为 exact named re-export；class/parser/workflow 定义只在 Core。 |
| AC-04 | pass | CLI manifest 使用 `workspace:*`；Space command/program 只从 package root import；未发现 `client-core/src` 或 `client-core/dist` import。 |
| AC-05 | pass | Core 接受 `AuthenticatedWorkspaceHttp = () => Promise<WorkspaceHttp>`；source/test 未导入 CLI Auth、Config、Session、Commander、daemon 或 credential owner。 |
| AC-06 | pass | Core HTTP tests 覆盖非法 origin/credentials/cross-origin、manual redirect、Cookie、role、worker pid、write Origin、body/idempotency key。 |
| AC-07 | pass | Core tests 区分 response interrupted、invalid JSON、non-object，并验证 numeric service code、message、path/status detail。 |
| AC-08 | pass | Core Space tests覆盖 list、多页 encoded cursor、顺序、path、resource/unit filter、find、metadata change、cursor repeat 与 cycle；请求次数断言有限。 |
| AC-09 | pass | Core mutation tests 验证 trim/1..255、POST/PATCH/trash method/path/body 和 response identity；built entrypoint 重复验证线上 request。 |
| AC-10 | pass | rename/move fixture 分别覆盖 rename、parent、root 的单次 PATCH + read-back；create/trash unknown fixture 均断言一次 fetch。 |
| AC-11 | pass | Core errors test 与 CLI auth-transport shim test 证明唯一 class identity、`instanceof` 和 `isWorkspaceResultUnknown` 行为。 |
| AC-12 | pass | Space command source 相对 baseline 只改 import；Commander contract 和 built-entrypoint tests 覆盖全部命令、filter、move destination 与 mutation args。 |
| AC-13 | pass | built-entrypoint 验证 `{ spaces }`、`{ nodes }`、`{ node }`、`{ trashBatch }`；`command.ts` 未变，因此 pretty JSON/text 路径与末尾换行不变。 |
| AC-14 | pass | built-entrypoint 验证 coded stderr/exit 1；`command.ts` 未变，detail 与 auth hint 逻辑保持 baseline。 |
| AC-15 | pass | `config.ts` 与 `auth/session.ts` tree diff 为空；auth tests 与 built entrypoint 证明 normalized origin/current Session/Cookie 行为。 |
| AC-16 | pass | 明确 `run clean` 后 `package:workspace-cli` 先输出 Core `tsc -p tsconfig.json`，随后构建和 bundle CLI。 |
| AC-17 | pass | verify 检查 203-file artifact；实际 tarball 临时安装和 Space list/browse 通过；额外搜索确认无 private Core dependency 或 bare import。 |
| AC-18 | pass | `pnpm typecheck && pnpm test && pnpm build && pnpm package:workspace-cli && pnpm --filter univer-workspace-cli package:smoke && git diff --check` 整链 exit 0；Server contract tree diff 为空。 |
| AC-19 | pass | local Server 不可用，按 AC 的条件分支记录 `environment-unavailable`；未使用凭据，且未以此替代 AC-01..AC-18。 |

结论：**19/19 pass，0 个 open issue**。未发现 Workspace CLI Space/Node 能力差异，也未要求兼容层或额外 abstraction。

### 实际执行命令

```bash
pnpm --filter @univerjs/univer-workspace-client-core typecheck
pnpm --filter @univerjs/univer-workspace-client-core build
pnpm --filter @univerjs/univer-workspace-client-core test
pnpm --filter univer-workspace-cli typecheck
pnpm --filter univer-workspace-cli build
pnpm --filter univer-workspace-cli exec vitest run --config vitest.config.ts \
  test/application-command-contracts.test.ts \
  test/auth-transport.test.ts \
  test/space-cli.test.ts
pnpm --filter @univerjs/univer-workspace-client-core run clean
pnpm --filter univer-workspace-cli run clean
pnpm package:workspace-cli
pnpm --filter univer-workspace-cli package:verify
pnpm --filter univer-workspace-cli package:smoke
pnpm typecheck
pnpm test
pnpm build
pnpm package:workspace-cli
pnpm --filter univer-workspace-cli package:smoke
git diff --check
curl --silent --show-error --max-time 3 -o /dev/null -w '%{http_code}' \
  http://127.0.0.1:3020/
```

首次 clean 检查使用了 `pnpm --filter <package> clean`，pnpm 将其解析为内建命令并报 `Unknown option: 'recursive'`。该调用未进入产品构建；QA 随即改用上面列出的 `run clean`，并修正了本文命令清单。

## Review fix 复验：SPEC-01

复验日期：2026-08-28。原实现 tree：`5f089b4573d2d5c1d040541800f303b6e63d17fe`。修复后 tree：`d6ee136d079ec43353023deb5fc5f4ece2a648d1`。

结论：**pass，0 个 open issue**。

- 产品 diff 只修改 `packages/client-core/src/http.ts` 与 `packages/client-core/test/http.test.ts`。`request()` 在认证状态检查、header 构造和 fetch 之前，同时拒绝 URL username、password 和 cross-origin。
- 同源绝对 URL `https://user@workspace.test/...` 与 `https://:secret@workspace.test/...` 均返回既有 `workspace-origin-mismatch`，两种 case 的 fetcher 调用数均为 0。
- `collaborationRequest()` 的同类 URL 在 `new Request` 校验阶段返回既有 `workspace-request-invalid`，尚未创建认证 headers，也未调用 fetcher。username/password 两种 case 均覆盖。
- Core tests 从 29 增至 33，3 test files、33/33 通过；Core typecheck/build 通过。
- CLI auth/Space 定向 tests 为 3 files、15/15 通过；CLI typecheck/build 通过。`git diff --check` 通过。
- 未重复执行 package smoke。该 fix 没有改变 export、import graph、manifest、build script、bundle 配置或 runtime dependency；本次已重新构建 CLI 并运行 built-entrypoint Space test。此前同一 Change 的 clean package verify 和临时安装 smoke 证据仍适用。

复验命令：

```bash
git diff 5f089b4573d2d5c1d040541800f303b6e63d17fe \
  d6ee136d079ec43353023deb5fc5f4ece2a648d1 -- \
  packages/client-core/src/http.ts packages/client-core/test/http.test.ts
pnpm --filter @univerjs/univer-workspace-client-core typecheck
pnpm --filter @univerjs/univer-workspace-client-core build
pnpm --filter @univerjs/univer-workspace-client-core test
pnpm --filter univer-workspace-cli typecheck
pnpm --filter univer-workspace-cli build
pnpm --filter univer-workspace-cli exec vitest run --config vitest.config.ts \
  test/auth-transport.test.ts \
  test/application-command-contracts.test.ts \
  test/space-cli.test.ts
git diff --check
```

## QA issues

状态取值：`open`、`fixed-pending-qa`、`closed`、`accepted-risk`。

| ID | 严重度 | 证据 | 期望 | 状态 |
| --- | --- | --- | --- | --- |
