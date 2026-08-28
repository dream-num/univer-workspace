# extract-worktree-unit-client-core QA

本文件定义并记录 Change `extract-worktree-unit-client-core` 的验收。QA 于 2026-08-28 对实施前 tree `d5c28e35aea32ddaccc32222bec4d35e10de8fe3` 和实施后 tree `f6a55c177737680d8b9020e219ca26ce3007e4da` 执行；结论为 **35/35 pass，0 open issue**。

## 基线与边界

- 实施前记录目标仓库 tree ID；实施后记录 implementation tree ID，并以两者的限定 diff 核对 owner、公开行为和 Server scope。
- 前置 Change `extract-space-node-client-core` 与 `extract-auth-client-core` 必须已经完成并复用其 package 根 exports：`WorkspaceHttp`、`AuthenticatedWorkspaceHttp`、error/result-unknown helpers、`WorkspaceUnitType`，以及 CLI 保留的 `configuredOrigin()`、`authenticatedHttp("client")` composition seam。
- Client Core 拥有 Worktree/Worktree Unit 模型、严格解析、查询与 mutation workflow、lifecycle 可靠性算法、Unit membership 和 review URL 规则。
- CLI Client Shell 继续拥有 Commander、Session/config、origin 默认值注入、JSON/text 呈现、exit code 和打开/打印 URL 的交付行为。
- Workspace Server HTTP contract、Worktree 状态机、Unit 数据模型、Session 文件、CLI 命令面与发布方式不得改变。

## Spec scenario → 测试与命令

| OpenSpec scenario | 现有基线 | 实现后必须存在的直接覆盖 | 执行命令 |
| --- | --- | --- | --- |
| Worktrees are listed by requested view and scope | `application-features.test.ts` 的 processed Team Space case | Core parameterized tests覆盖 active/processed、未限定/user/space scope；断言 exact query、顺序与 strict list parsing | Core test |
| Worktree identity is stable across creation retries | `retries Worktree creation with one stable public identity` | Core tests记录每次 idempotency header/body；未知结果重试始终使用同一 supplied/generated key，成功或耗尽后返回既有语义 | Core test |
| Lifecycle transition is allowed | 四个 `it.each` action cases | Core table覆盖 ready、reopen、merge、discard 的全部允许起始状态、expected state、method/path、request count 与 idempotency header | Core test |
| Lifecycle transition is not allowed | 当前缺少直接 case | Core table覆盖每个 action 的无效 state；只有 initial GET，transition POST 为 0，错误为 `workspace-lifecycle-invalid` | Core test |
| Lifecycle result is unknown | 当前只有 merge read-back success | Core tests覆盖 read-back确认成功、wrong state、wrong identity、read-back仍未知；不得 replay transition POST | Core test |
| Trunk-backed Resource is added | `lists Units and retries add...` | Core tests断言 exact POST/body、Worktree+Resource 派生稳定 key、same-key retry，以及 source/resource/target/Worktree mismatch | Core test |
| Worktree-local Unit is created | `keeps Unit creation identity stable...` | Core tests覆盖 supplied/generated key、same-key retry、initialData replay，以及 type/name/target Space/parent/source/Worktree validation | Core test |
| Unit belongs to a different Worktree | Open 有一个 mismatch case，Unit owner coverage不足 | Core parser/list/add/create/review cases分别拒绝 returned Worktree/Unit membership mismatch，使用既有 `workspace-result-mismatch` | Core test |
| Worktree has one Unit | 当前 Open 单 Unit仅间接存在 | Core direct test覆盖未显式 Unit 时恰好一项的选择、结构化结果和 exact URL | Core test |
| Worktree requires an explicit Unit | 当前只覆盖 many | Core parameterized tests分别覆盖 zero/many，固定 `workspace-open-unit-required` 与 bounded detail | Core test |
| Selected Unit is not a member | 当前覆盖 wrong Worktree，缺 selected missing | Core tests区分 selected ID 不存在的 `workspace-unit-not-found` 与 returned membership mismatch | Core test |
| Viewer base URL is invalid | 当前只覆盖 `file:` override | Core parameterized tests覆盖相对 URL、invalid URL、非 HTTP(S) scheme；断言 Worktree HTTP/provider 0 调用的正确顺序 | Core test |
| Existing CLI contract is exercised | command contract + application feature tests | CLI command/built-entrypoint tests固定 option mapping、request、JSON/text/coded errors、Session；纯 workflow assertions迁入 Core | CLI targeted tests |
| Installed CLI artifact runs outside the monorepo | package smoke当前只覆盖 auth与Space | 扩展安装后 fixture，覆盖 Worktree/Unit/open 的代表性 read/mutation/lifecycle 链和 exact request counts | package verify/smoke |

补充 owner 场景：前置 exports 缺失时实施必须停止；不得在 CLI 或 Core 新建平行 auth/transport/config seam。exchange 与 Typst 只切换 `WorkspaceUnit`、`WorkspaceUnitType`、Unit feature type imports，不迁移其业务实现。

## 验收标准

### 前置 exports 与 owner

- **AC-01** 实施记录列出并实际导入前置 package 根 exports；Core typecheck 在编辑前可通过。若 `WorkspaceHttp`、`AuthenticatedWorkspaceHttp`、error helpers 或 `WorkspaceUnitType` 缺失，实施应停止，不得复制旧实现或建立平行 seam。
- **AC-02** 新 capability 继续位于同一个 private `@univerjs/univer-workspace-client-core` package，通过根入口 named exports 暴露；不创建第二个 package、Browser entry、publish contract、factory 或 service container。
- **AC-03** Core Worktree/Unit/review source 不导入 `WorkspaceAuth`、CLI Config/Session、Commander、presenter、daemon、应用 feature 或 source path；只接收现有 lazy authenticated HTTP/origin functions 和普通输入。
- **AC-04** Worktree/Unit/review 的模型、parser、stable-key 与 workflow 权威实现只在 Core；删除或缩成 exact re-export 的旧 CLI owner，不留下第二套 parser、lifecycle/read-back 或 review selection 实现。

### Worktree 模型、查询与 mutation

- **AC-05** Worktree parser 严格校验 nonempty `id`、string `name`、允许 state、optional Team Space identity 与 Units array；expected ID 不同为 `workspace-result-mismatch`，结构/枚举错误为 `workspace-invalid-response`。
- **AC-06** Unit parser 严格校验 nonempty Unit/Resource/Node identity、supported `unitType`、safe nonnegative revision、change/merge/activation enums，并拒绝 legacy `fileId`；trunk Unit 必须 target null，Worktree-local Unit 必须有合法 target。
- **AC-07** Worktree list 对 `active|processed` 使用现有 `scope` query，对 user/space restriction 使用 `kind=user|team` 和 optional `teamSpaceId`；测试覆盖各组合、exact URL encoding、`items` 缺失/非数组及任一 invalid item 时整体拒绝。
- **AC-08** Worktree get 保留 `GET /api/worktrees/:id` 和 expected-ID binding；update 保留一次 `PATCH /api/worktrees/:id`、exact `{ name?, visibility? }` body、严格 wrapped `worktree` response。update 遇到 result-unknown 不自动 replay、retry 或 read-back。
- **AC-09** User/Team Worktree create 保留 exact POST path/body：`kind`、`name`、`summary: null`、Team `teamSpaceId` 与默认/显式 visibility；supplied 或一次生成的 idempotency key 在最多三次 unknown retry 中不变。
- **AC-10** Worktree create 成功只返回严格解析结果；连续 unknown 耗尽时保留 `workspace-result-unknown`，error detail 只包含 bounded public identity/cause，不含 Cookie、Session 或 response body。

### Worktree lifecycle

- **AC-11** allowed transitions 固定为 draft→ready、ready→draft(reopen)、ready→merged、draft/ready→discarded；每次先 GET current state，再且仅再发一次对应 POST，并只接受 requested Worktree ID 与 expected state。
- **AC-12** invalid transition 对 ready/reopen/merge/discard 的所有不允许起始 state 返回 `workspace-lifecycle-invalid`；测试断言 transition POST 为 0，error code/message/detail 与基线兼容。
- **AC-13** lifecycle response 返回 wrong Worktree ID 或 wrong terminal state 时为 `workspace-result-mismatch`；这是已知错误结果，不触发 unknown read-back，也不重放 transition。
- **AC-14** merge/discard 使用由 action+Worktree ID 派生的 deterministic stable key；ready/reopen 继续不发送 idempotency key。相同 action/ID 跨实例生成同 key，不同 action 或 ID 不碰撞。
- **AC-15** transition response 丢失时只做一次 GET read-back，不 replay POST；observed ID/state匹配则返回成功，否则以 `workspace-result-unknown` 返回 bounded actual/expected detail。read-back 自身失败时沿用既有 coded/result-unknown 语义。

### Worktree Unit membership

- **AC-16** Unit list 复用 Worktree get/parser，返回请求 Worktree 的 Units；returned Worktree ID 或任何 Unit membership 不同均为 `workspace-result-mismatch`，不得静默重绑或过滤。
- **AC-17** Unit add 只向 `/api/worktrees/:worktree/units` POST exact `{ resourceId, source: "trunk" }`；idempotency key由 Worktree ID+Resource ID稳定派生，unknown retry使用相同 key和body。
- **AC-18** Unit add 只接受同 Worktree、requested Resource、`source: "trunk"`、`target: null` 的严格 Unit；source、resource、target、identity或Worktree mismatch保留 `workspace-result-mismatch`。
- **AC-19** Worktree-local create 保留 exact request fields：name、`source: "worktree"`、target Space、parent/null、unit type 与 optional `initialData`；supplied/generated idempotency key只确定一次，retry复用同 key和完整相同 body。
- **AC-20** local create 只接受同 Worktree且 source/type/name/target Space/parent与请求完全一致的 Unit；各 mismatch 独立测试并保留 `workspace-result-mismatch`。
- **AC-21** local create 的 unknown-retry最终 error detail使用既有 `publicIdentity`，只包含 key、name、parent、Space、type、Worktree；用大型 sentinel `initialData` 断言 message/detail/log均不包含内容。add/create重试次数保持 bounded，不形成无限循环。

### Review URL

- **AC-22** viewer base URL 必须是可解析的 absolute HTTP(S) URL；显式 invalid/relative/`file:` override 在调用 default-origin provider、Worktree reader或HTTP前拒绝为 `workspace-viewer-url-invalid`。default-origin provider返回invalid URL时只允许provider调用一次，Worktree/HTTP仍为0次。
- **AC-23** 显式 `viewerBaseUrl` 覆盖默认 origin且不调用 lazy origin provider；未显式提供时 provider恰好调用一次。Core不读取 Config/Session，也不打开浏览器或写 stdout。
- **AC-24** review workflow验证 returned Worktree ID；未显式 Unit 时恰好一个 Unit自动选择，zero和many均返回 `workspace-open-unit-required`，detail只含 `unitCount` 与 `worktreeId`。
- **AC-25** 显式 Unit ID不存在时返回 `workspace-unit-not-found` 及既有 bounded detail；选中 Unit 的 `worktreeId` 不同则返回 `workspace-result-mismatch`，两者均不返回 URL。
- **AC-26** 成功 URL以 selected viewer origin为 base，强制 path `/worktrees`，清除原 path/query/hash，并按现有顺序设置 `worktree`、`unit`、`view=agent`；URLSearchParams负责编码。结构化结果固定为 `{ openUrl, type, unitId, worktreeId }`。

### CLI parity 与 dependent imports

- **AC-27** CLI 保留完整命令面：`worktree list|get|create|update|ready|reopen|merge|discard`、`unit list|add|create`、`open`；参数名、default、required/互斥规则、help/description不变，包括 view/scope/space/visibility/idempotency/parent/type/viewer-url/json。
- **AC-28** command contract与built-entrypoint fixture逐项比较 exact request path/query/method/body/idempotency header、Cookie、client role和write Origin；Commander只做参数转换，不重写Core input或可靠性语义。
- **AC-29** JSON envelope保持 `{ worktrees }`、`{ worktree }`、`{ units }`、`{ unit }`及Open `{ success: true, data }`；默认text的pretty JSON和Open三行文本、stdout/stderr、末尾newline、coded error、`workspace.command.failed`与exit 1均与基线一致。
- **AC-30** CLI继续通过normalized origin的当前Session构造lazy authenticated HTTP；Session path、bytes、mode、Cookie与origin选择不变。review显式override/default只影响viewer URL，不改变API request origin或Session选择。
- **AC-31** exchange、Typst及其tests通过Client Core package根入口引用`WorkspaceUnit`、`WorkspaceUnitType`和需要的Unit feature type；不得导入已删除CLI model路径、`client-core/src`或`client-core/dist`。exchange/Typst业务测试保持通过且实现不迁入本Change。

### Artifact、scope 与完整 gate

- **AC-32** clean packaging先构建Client Core并内联新增runtime；package-dist与npm tarball无`.ts`/source/test/map、unresolved workspace bare import、private Core runtime dependency或source-checkout dependency。
- **AC-33** installed fixture在临时cwd/home中完成认证后，至少执行Worktree list/create/update/ready、Unit add/create/list和Open URL；断言JSON shape、exact endpoint/request counts、stable idempotency keys与URL，不依赖monorepo文件。
- **AC-34** Core/CLI typecheck、test、build、repository test/build、package verify/smoke与`git diff --check`全部exit 0。tree diff证明Server OpenAPI/routes/schema、Session与无关后续能力未改；若Server contract确有修改则判scope failure并额外要求`api:verify`。
- **AC-35** 实现不得为未来Client Shell引入新service container、factory hierarchy、transport/auth/config interface、大compatibility layer或长期shim；只复用现有lazy HTTP/origin seam并暴露本Change所需的最小feature exports。

验收项总数：**35**。

## 执行命令

前置与静态 owner 检查：

```bash
pnpm --filter @univerjs/univer-workspace-client-core typecheck
rg -n 'WorkspaceHttp|AuthenticatedWorkspaceHttp|WorkspaceUnitType|executeWithStableIdentity|workspaceError' \
  packages/client-core/src/index.ts
rg -n 'WorkspaceAuth|@univer-cli/config|commander|sessionPath|node:fs|apps/cli|\.\./\.\./apps' \
  packages/client-core/src --glob '*worktree*.ts' --glob '*unit*.ts' --glob '*open*.ts'
rg -n 'client-core/(src|dist)' apps packages --glob '*.ts' --glob '*.mjs'
```

第一项export搜索必须找到既有根exports；Core owner搜索预期无application/storage/command匹配。`node:crypto`用于现有stable identity不构成owner violation。

最小相关检查：

```bash
pnpm --filter @univerjs/univer-workspace-client-core typecheck
pnpm --filter @univerjs/univer-workspace-client-core build
pnpm --filter @univerjs/univer-workspace-client-core test
pnpm --filter univer-workspace-cli typecheck
pnpm --filter univer-workspace-cli build
pnpm --filter univer-workspace-cli exec vitest run --config vitest.config.ts \
  test/application-command-contracts.test.ts \
  test/workspace-cli.test.ts \
  test/workspace-unit-exchange.test.ts \
  test/typst.test.ts \
  test/auth-transport.test.ts
```

迁移后的Core test文件名可以变化；QA以test title和scenario assertion为准。纯Worktree/Unit/review workflow cases必须由Core tests拥有，CLI tests保留command、composition、Session和built-entrypoint责任。

dependent import检查：

```bash
rg -n 'features/worktree/model|features/worktree/management|features/unit/membership|features/open/open' \
  apps/cli/src/features/exchange apps/cli/src/features/typst \
  apps/cli/test/workspace-unit-exchange.test.ts apps/cli/test/typst.test.ts
rg -n '@univerjs/univer-workspace-client-core' \
  apps/cli/src/features/exchange apps/cli/src/features/typst \
  apps/cli/test/workspace-unit-exchange.test.ts apps/cli/test/typst.test.ts
```

第一条预期无旧model/type import；第二条必须显示package根type imports。不得为通过搜索而复制本地type。

clean package与installed fixture：

```bash
pnpm --filter @univerjs/univer-workspace-client-core run clean
pnpm --filter univer-workspace-cli run clean
pnpm package:workspace-cli
pnpm --filter univer-workspace-cli package:verify
pnpm --filter univer-workspace-cli package:smoke
```

完整gate：

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm package:workspace-cli
pnpm --filter univer-workspace-cli package:verify
pnpm --filter univer-workspace-cli package:smoke
git diff --check
```

scope检查：

```bash
git diff --name-only <before-tree> <after-tree> -- \
  apps/workspace/contracts/http apps/workspace/server apps/workspace/generated/http
git diff --name-only <before-tree> <after-tree> -- \
  apps/cli/src/features/exchange apps/cli/src/features/typst
```

第二条允许type import切换，不允许exchange/Typst workflow行为改写。QA另检查`apps/cli/src/program.ts`只用现有lazy `authenticatedHttp("client")`/`configuredOrigin()`wrapper装配Core能力。

## QA观察记录

以下记录来自 QA 直接审查、测试与独立探针，不以 task 勾选或 implement 报告代替行为证据。

| 观察面 | 基线合同 | QA证据 | 结论 |
| --- | --- | --- | --- |
| Prerequisite/owner | 复用前两Change exports，无parallel seam或第二owner | `packages/client-core/src/index.ts` 继续从根入口导出前置 HTTP/error/Unit type 与新增四项 feature；owner 搜索未发现 CLI storage/config/Commander/daemon 引用；旧 CLI 四个 owner 文件已删除并迁至 Core；不存在 `client-core/src`/`dist` consumer import。 | pass |
| Worktree model/access | strict parser、views/scopes、get/create/update、stable retry | Core `worktree-unit.test.ts` 覆盖 strict Worktree/Unit parsing、三种 exact list query、invalid whole-list、get/update 与 user/Team create；Core suite 113/113。独立 built-Core 探针令生成 key 的 create 连续三次 unknown，观测三次同一非空 key及最终 `workspace-result-unknown`。package fixture另断言 user create与update exact body。 | pass |
| Lifecycle | allowed/invalid/mismatch、stable key、unknown单次read-back | Core table覆盖 5 个 allowed 与 15 个 invalid action/state case；断言 invalid仅1 GET/0 POST、returned ID/state mismatch共2次request且无read-back、unknown为1 POST+1 read-back、wrong-ID保持unknown；stable-key collision case通过。 | pass |
| Unit membership | list/add/local create、same-key retry、bounded detail、全部mismatch | Core tests覆盖list/add/local create、exact body、stable supplied/generated key、source/resource/target/type/name/Space/parent mismatch。独立探针补验 add/create response携带异Worktree ID均为`workspace-result-mismatch`；local create三次unknown复用同key，message及序列化detail均不含sentinel `initialData`。 | pass |
| Review URL | invalid-before-fetch、override/default、selection/membership、exact URL | Core tests覆盖3类invalid override时provider/HTTP 0调用、invalid default时provider 1/HTTP 0、override不取default、zero/one/many、selected missing和membership mismatch。独立探针确认合法default provider/auth各1次，特殊ID生成精确URL `https://viewer.test/worktrees?worktree=wt+%2F+1&unit=unit+%2F+1&view=agent`。 | pass |
| CLI parity | command/request/JSON/text/errors/Session | 定向运行 command contracts、application features、workspace-cli、exchange、Typst、auth，共6文件48测试通过；限定diff显示三个command文件仅切换feature type owner，`program.ts`只以现有`authenticatedHttp("client")`和`configuredOrigin()`装配；auth/Session/config diff为空。 | pass |
| Dependent imports | exchange/Typst只切换public type imports且tests不回退 | 限定diff显示 exchange/Typst实现及tests仅把`WorkspaceUnit`、`WorkspaceUnitType`、`WorkspaceUnitFeature`类型来源切至`@univerjs/univer-workspace-client-core`；定向业务测试通过；旧model路径和source/dist import搜索为空。 | pass |
| Installed artifact | clean bundle、临时安装、Worktree/Unit/open fixture | clean后`package`、`package:verify`、`package:smoke`均exit 0；verify报告203 files、packed 13,023,866 bytes、unpacked 58,130,059 bytes；临时cwd/home安装后的auth→Worktree list/create/update/ready→Unit add/create/list→open→logout链通过，fixture断言exact counters/keys/body/URL。 | pass |
| Full gate/scope | repository gate、Server diff、无新framework/compatibility layer | `pnpm typecheck && pnpm test && pnpm build` exit 0；Core 113、reference-provider 16、Workspace 152、CLI 96项Vitest均通过，另有root 12及package 5项Node tests通过。before/after Server与Session/config/auth限定diff为空；`git diff --check`通过；实现未引入service container、factory hierarchy或兼容层。 | pass |

如果发现能力差异，先记录公开合同、影响命令、稳定复现和风险。不得为抹平内部重排差异引入service container、factory、第二transport/auth seam、通用Client Shell抽象或大规模compatibility layer。

## AC逐项结论

| AC | 结论 | 主要证据 |
| --- | --- | --- |
| AC-01 | pass | 根exports静态检查和Core编辑前/后typecheck通过，复用既有HTTP/error/type seam。 |
| AC-02 | pass | 新能力只进入既有private Client Core package根入口；未新增package、Browser entry或发布合同。 |
| AC-03 | pass | Core owner搜索无CLI application/storage/command依赖，只接收lazy HTTP/origin。 |
| AC-04 | pass | 四个旧CLI owner被删除并迁入Core，未留shim或第二实现。 |
| AC-05 | pass | strict Worktree parser、expected ID、state和Team Space invalid cases通过。 |
| AC-06 | pass | strict Unit identity/type/revision/enum/source-target/legacy `fileId` cases通过。 |
| AC-07 | pass | active/processed与user/Team Space exact query及invalid list cases通过。 |
| AC-08 | pass | get identity、一次PATCH exact body、unknown update不重放；Core/package fixture通过。 |
| AC-09 | pass | user/Team exact create body；supplied及generated key在三次unknown中稳定。 |
| AC-10 | pass | unknown耗尽为既有code；detail限于public identity/cause，无Cookie、Session或response body。 |
| AC-11 | pass | 五个allowed transition case均为GET后单POST且只接受expected ID/state。 |
| AC-12 | pass | 十五个invalid case均为单GET、0 POST和`workspace-lifecycle-invalid`。 |
| AC-13 | pass | wrong returned ID/state均为mismatch、总2 calls，无unknown read-back。 |
| AC-14 | pass | merge/discard deterministic key，ready/reopen无key；跨实例稳定与不碰撞测试通过。 |
| AC-15 | pass | unknown只执行一次read-back且不重放POST；confirmed/unconfirmed/wrong-ID及read-back失败语义覆盖。 |
| AC-16 | pass | list复用bound Worktree parser；wrong Worktree/Unit membership整体拒绝。 |
| AC-17 | pass | add exact path/body与Worktree+Resource stable key，same-key retry通过。 |
| AC-18 | pass | add的source/resource/target/identity/Worktree mismatch均拒绝。 |
| AC-19 | pass | local create exact fields、optional initialData与supplied/generated same-key replay通过。 |
| AC-20 | pass | local create source/type/name/Space/parent/Worktree mismatch均拒绝。 |
| AC-21 | pass | unknown bounded三次；独立sentinel探针确认initialData不进入message/detail。 |
| AC-22 | pass | relative/malformed/non-HTTP override先于provider/HTTP拒绝；invalid default只调用provider一次。 |
| AC-23 | pass | override/default lazy调用次数正确；Core无Config/Session/stdout/browser owner。 |
| AC-24 | pass | bound Worktree与zero/one/many选择规则及bounded detail通过。 |
| AC-25 | pass | selected missing与returned membership mismatch使用不同既有codes且无URL。 |
| AC-26 | pass | path/query/hash替换、参数顺序、特殊字符编码和结构化结果精确匹配。 |
| AC-27 | pass | command合同测试及command source before/after限定diff确认命令面/flags/help不变。 |
| AC-28 | pass | CLI fixture与installed fixture断言exact request、Cookie、role、Origin和idempotency。 |
| AC-29 | pass | CLI JSON/text/error command tests通过；feature移除仅迁移workflow assertions。 |
| AC-30 | pass | `program.ts`保留lazy authenticated HTTP；Session/config/auth限定diff为空。 |
| AC-31 | pass | exchange/Typst仅public package根type import切换，相关业务测试通过。 |
| AC-32 | pass | clean package与verify通过，无source/test/map/unresolved workspace runtime dependency。 |
| AC-33 | pass | installed tarball临时环境的完整代表链及exact fixture assertions通过。 |
| AC-34 | pass | Core/CLI/repository/package全部gate与`git diff --check`通过；Server scope diff为空。 |
| AC-35 | pass | diff审查未见新container/factory/transport/auth/config interface或兼容层。 |

最终结果：**35/35 pass**。

## 实际执行命令

```bash
openspec status --change extract-worktree-unit-client-core --json
openspec instructions apply --change extract-worktree-unit-client-core --json
git diff --name-status d5c28e35aea32ddaccc32222bec4d35e10de8fe3 f6a55c177737680d8b9020e219ca26ce3007e4da
rg -n 'WorkspaceHttp|AuthenticatedWorkspaceHttp|WorkspaceUnitType|executeWithStableIdentity|workspaceError' packages/client-core/src/index.ts
rg -n 'node:(fs|path|os)|process\.env|\.univer-workspace|config\.json|session\.json|pending\.json' packages/client-core/src/{worktree.ts,worktree-model.ts,unit.ts,open.ts}
rg -n '@univerjs/univer-workspace-client-core/(src|dist)|packages/client-core/(src|dist)' apps packages --glob '!packages/client-core/**'
git diff --check d5c28e35aea32ddaccc32222bec4d35e10de8fe3 f6a55c177737680d8b9020e219ca26ce3007e4da
pnpm --filter @univerjs/univer-workspace-client-core typecheck
pnpm --filter @univerjs/univer-workspace-client-core test
pnpm --filter @univerjs/univer-workspace-client-core build
pnpm --filter univer-workspace-cli typecheck
pnpm --filter univer-workspace-cli build
pnpm --filter univer-workspace-cli exec vitest run --config vitest.config.ts test/application-command-contracts.test.ts test/application-features.test.ts test/workspace-cli.test.ts test/workspace-unit-exchange.test.ts test/typst.test.ts test/auth-transport.test.ts
node --input-type=module  # built-Core补充探针：generated keys、Unit Worktree mismatch、initialData、review URL
pnpm --filter univer-workspace-cli run clean
pnpm --filter univer-workspace-cli run package
pnpm --filter univer-workspace-cli run package:verify
pnpm --filter univer-workspace-cli run package:smoke
pnpm typecheck
pnpm test
pnpm build
```

注：首次误写为`pnpm --filter univer-workspace-cli clean`时，pnpm把`clean`解释为内建命令并报`Unknown option: recursive`；改用明确的`run clean`后package全链通过。该调用错误不是产品失败。

## Review处理复验（2026-08-28）

复验范围：原实现 tree `f6a55c177737680d8b9020e219ca26ce3007e4da` 至当前 tree `4b9767ba9d9ada452a116108b6e85b7593513938`。本轮未修改产品、OpenSpec或review文件。

| Review项 | QA证据 | 结论 |
| --- | --- | --- |
| STD-01 shared authenticated HTTP owner | `rg -l '^export type AuthenticatedWorkspaceHttp =' packages/client-core/src` 只返回`packages/client-core/src/http.ts`。`space.ts`、`open.ts`、`unit.ts`、`worktree.ts`均从`./http.js`导入同一type；package根仍以同名`AuthenticatedWorkspaceHttp`导出，consumer public import无需改变。`f6a55...`→`4b976...`的产品diff只有type定义移动、根re-export来源切换和四个内部type import更新；新增interface/adapter/factory搜索为空。 | pass；唯一owner已归位HTTP边界，未产生新seam。 |
| STD-02 lifecycle mismatch detail | 直接读取pre-tree `d5c28e35aea32ddaccc32222bec4d35e10de8fe3` 的旧CLI `management.ts`，其detail明确为`{ actual: { worktree: result }, expected: { state, worktreeId } }`，即完整parsed Worktree。当前`packages/client-core/src/worktree.ts`保持同一属性层级、顺序与值来源。built-Core探针对含一个Unit的wrong-state响应执行`JSON.stringify(error.detail)`，得到374 bytes，结构为`actual.worktree`完整Worktree后接`expected.state/worktreeId`；与旧源码合同逐字段、顺序一致。 | parity-preserved；记为accepted-risk candidate，不是QA failure。本Change受“不改变CLI行为”约束，不要求也不应为缩减detail引入compatibility layer。 |

复验实际执行：

```bash
git diff --name-status f6a55c177737680d8b9020e219ca26ce3007e4da 4b9767ba9d9ada452a116108b6e85b7593513938
rg -n 'AuthenticatedWorkspaceHttp' packages/client-core apps/cli/src
git show d5c28e35aea32ddaccc32222bec4d35e10de8fe3:apps/cli/src/features/worktree/management.ts
node --input-type=module  # built-Core lifecycle mismatch detail字节/结构探针
pnpm --filter @univerjs/univer-workspace-client-core typecheck
pnpm --filter @univerjs/univer-workspace-client-core test
pnpm --filter @univerjs/univer-workspace-client-core build
pnpm --filter univer-workspace-cli typecheck
pnpm --filter univer-workspace-cli build
pnpm --filter univer-workspace-cli test
git diff --check f6a55c177737680d8b9020e219ca26ce3007e4da 4b9767ba9d9ada452a116108b6e85b7593513938
git diff --check d5c28e35aea32ddaccc32222bec4d35e10de8fe3 4b9767ba9d9ada452a116108b6e85b7593513938
```

结果：Core 5 files/113 tests、CLI 21 files/96 tests及CLI package-artifact 5 tests全部通过；Core/CLI typecheck与build通过；两组`git diff --check`通过。复验后仍为**35/35 pass，0 open issue**。

## QA issues

状态取值：`open`、`fixed-pending-qa`、`closed`、`accepted-risk`。

| ID | 严重度 | 证据 | 期望 | 状态 |
| --- | --- | --- | --- | --- |
| — | — | 未发现QA issue（0 open） | — | — |
