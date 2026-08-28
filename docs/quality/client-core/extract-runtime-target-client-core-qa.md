# extract-runtime-target-client-core QA

本文件定义并记录 Change `extract-runtime-target-client-core` 的实现后验收。QA 于 2026-08-28 针对 baseline tree `33a49d2baaca732dd5bea7850b00877eb55011b4` 与 implementation tree `40f5396ae270b113c29cb5b2946a3647203344ef` 执行；结论为 **48/48 pass，0 open issue**。

## 基线与边界

- 实施前记录目标仓库 tree ID，实施后记录 implementation tree ID；QA 只依据两个 tree 的产品 diff、直接行为、CLI compatibility 与 installed artifact 判断。
- Changes 1–4 当前 QA 均无 open issue。Change 5 必须复用 Client Core 已有的 `WorkspaceHttp`、`AuthenticatedWorkspaceHttp`、`WorkspaceApplicationError`、`workspaceError`、`getWorktree`、`parseWorktree`、`parseUnit`、`WorkspaceWorktree`、`WorkspaceUnit` 与 `WorkspaceUnitType` exports；缺少前置时停止，不创建平行 transport、auth、Worktree/Unit parser 或 model。
- Client Core 拥有 Node-hosted runtime target identity、Worktree/Trunk source resolution、Snapshot read adapter 与 Workspace referenced-Unit policy。CLI Client Shell 继续拥有 Config/Session、daemon socket/runtime pool、worker process、license、Collaboration backend composition、Commander 与输出。
- `packages/reference-provider` 是 Browser-only owner。它可作为 persisted scope/reference semantics 的对照，但 Change 5 不得让 Client Core 依赖它、移动它或为了去重建立跨 Browser/Node 公共 provider framework。
- `resolveWorkspaceAssetContent` 与 local file transfer 已由 Change 4 拥有。截图所需的 `resolveImageAsset` 必须留在 CLI composition，或作为显式注入的现有 Asset capability；不得把 signed bytes、download workflow 或 filesystem helper纳入 runtime-target owner。
- Workspace Server、OpenAPI/Collaboration contract、CLI command、Session bytes/timing、daemon RPC、target wire shape、reference metadata key/version与SDK baseline不得改变。
- content execute/inspect/commit、Office、Typst、SVG、browser render、screenshot/lint workflow与embedded image workflow不在本 Change 中迁移；本 Change只切换其 target/source imports与canonical serializer。

## Spec scenario → 测试与命令

| OpenSpec scenario | 基线位置 | 实现后必须存在的直接覆盖 | 执行命令 |
| --- | --- | --- | --- |
| Valid target is parsed | CLI `runtime-target.test.ts` | Core direct test覆盖HTTP/HTTPS origin normalization、五种Unit type、safe nonnegative revision、Trunk/Worktree exact scope及parse→serialize→parse round trip | Core test |
| Target is ambiguous or invalid | `runtime/target.ts` parser | 参数矩阵覆盖malformed URL、非HTTP(S)、credentials、path/query/hash、empty identity、unsupported type、negative/fractional/unsafe revision、missing/extra scope字段；固定既有code/message | Core test |
| Runtime identity spans revisions only | `workspaceRuntimeKey()` baseline case | 同origin/scope/Unit/type跨revision同key；origin、Trunk/Worktree、Worktree ID、Unit ID、Unit type任一变化均不同key，特殊字符编码无碰撞 | Core test |
| Worktree Unit target is resolved | CLI `content-source.test.ts` | Core fixture使用真实Change 3 model，固定Worktree GET、identity、membership、type、`draftHeadRevision`及readonly target shape | Core test |
| Editable target is not Draft | CLI editable case | Draft成功；ready/processed等非Draft返回`workspace-worktree-not-editable`，不发Snapshot请求、不进入daemon；错误顺序与detail保持 | Core + CLI test |
| Trunk Unit type is discovered | CLI trunk discovery case | 精确按Sheet→Doc→Slide→Base→Board wire type探测，只跳过精确stored-type-mismatch，首个成功返回strict head revision并停止 | Core test |
| Trunk discovery receives another failure | CLI early-exit case | auth/permission/not-found/transport、相同code不同message和相同message不同code均只请求一次并原样返回，不探测下一type | Core test |
| Trunk and Worktree data use distinct endpoints | CLI source endpoint case | direct source与SDK adapter分别固定Trunk/Worktree prefix、encoded Unit/Worktree/block IDs、revision/query；host context缺失时只用host scope | Core test |
| Selected target revision differs from observed head | `WorkspaceContentSource.getUnit()` | Snapshot-only与changeset head两类mismatch均拒绝，不返回partial Unit；保持direct source既有invalid-response语义 | Core test |
| Snapshot payload is inconsistent | source/adapter decoder | 五种Snapshot metadata、changeset、block、deserialized block、resources、latest revision、protocol error envelope的wrong Unit/type/revision/identity/shape/base64矩阵 | Core test |
| Worktree reference is mapped | CLI content-source mapped case | Worktree host context严格验证后，mapped Unit生成同Worktree v1 context，adapter命中Worktree endpoint | Core test |
| Worktree reference is not mapped | CLI fallback case | unmapped Unit生成Trunk v1 context并命中Trunk endpoint；Trunk host全部回落Trunk且不读Worktree | Core test |
| Reference context targets another Unit | `reference-load-context.ts` | exact metadata key/v1 round trip；wrong Unit、unsupported version、non-JSON、array、missing/empty ID、unsupported/malformed scope均返回既有context code且HTTP/loader 0调用 | Core test |
| Supported reference is loaded | `referenced-unit-provider.ts` | self reference、declared/requested type一致，五种loader各调用一次、revision 0、selected v1 context与createOptions逐字传递，loaded identity/type一致后返回 | Core test |
| Reference is invalid or loading is aborted | CLI provider source + Browser semantic cases | already-aborted、non-self、type mismatch、unsupported type、loaded ID/type mismatch分别固定code；invalid/aborted发生在Snapshot resolver/loader前；in-flight abort不发明取消 | Core test |
| Referenced source attempts a write | `WorkspaceSnapshotServerAdapter` six methods | save/update Snapshot、save block、save changeset、copy file metadata、write-side revision request全部同步/异步拒绝`workspace-reference-source-read-only`且HTTP 0调用 | Core test |
| Existing CLI runtime cases run | daemon/worker/content/exchange/screenshot/lint tests | canonical serializer的RPC payload、request顺序、runtime key、Session lookup、worker role、JSON/text/errors与Asset image integration保持 | CLI targeted/full tests |
| Installed CLI artifact starts runtime paths | package smoke当前只覆盖非runtime命令 | 安装tarball在checkout外启动daemon/worker并执行至少一个read-only runtime-backed command，验证Snapshot/reference请求、self-contained bundle与clean shutdown | package verify/smoke |

迁移后的测试文件名可以变化；QA以scenario title、request/RPC log、调用次数与错误断言为准。target/source/Snapshot/reference workflow assertions必须由Client Core拥有，CLI只保留composition、daemon/worker lifecycle、command和installed artifact责任。

## 验收标准

### 前置 exports、package 与owner

- **AC-01** apply前证明 Changes 1–3 的前置根exports真实存在且Core typecheck通过；实现直接复用它们。任何前置缺失都必须停止，而不是复制`WorkspaceHttp`、error、authenticated provider、Worktree/Unit parser或response shape。
- **AC-02** 新能力只加入既有private `@univerjs/univer-workspace-client-core` package根named exports；不新增runtime package、Browser entry、独立publish/version、service registry、container、factory hierarchy或空的未来目录。
- **AC-03** Core runtime-target sources不得导入`apps/cli`、CLI Config/Session/auth command、Commander、daemon socket/runtime pool、worker process、presenter、render page或相邻checkout；target parser接受`unknown`或Core-owned JSON value，不依赖`@univer-cli/daemon`的`JsonValue`。
- **AC-04** target/source、Snapshot adapter、reference context/scope/provider与host-context loader各只有一个Client Core owner；删除被替代的CLI owner，不保留shim、复制body、第二serializer或长期compatibility layer。CLI daemon/worker文件本身继续存在。
- **AC-05** Node Client Core不依赖、re-export或修改Browser-only `packages/reference-provider`；两边允许应用级实现重复，不为去重创造跨Browser/Node合同。
- **AC-06** before/after限定diff不修改Workspace Server、OpenAPI/generated contract、product/collaboration persistence、Session/config/auth、Asset transfer owner、Office/Typst/SVG/embedded-image workflow或Browser reference-provider；若Server contract变化则判scope failure，不能把`api:verify`当作正常迁移步骤掩盖。

### Runtime target contract

- **AC-07** `WorkspaceRuntimeTarget`、`WorkspaceRuntimeScope`与五种`WorkspaceUnitType`通过Core根导出；wire serializer只返回plain JSON字段`origin, revision, scope, unitId, unitType`，property values与scope shape逐字兼容现有daemon payload。
- **AC-08** parser接受HTTP/HTTPS origin并规范为`URL.origin`；拒绝malformed、非HTTP(S)、username/password、path、query、hash，保持`WORKSPACE_ORIGIN_INVALID`及现有message。origin invalid在scope/Unit处理和任何HTTP、Session、daemon调用前返回。
- **AC-09** parser要求Unit ID非空、type为`sheet|doc|slide|base|board`、revision为nonnegative safe integer；null/array/wrong primitive、empty ID、negative/fractional/NaN/Infinity/unsafe revision保持`WORKSPACE_TARGET_INVALID`及现有message/detail。
- **AC-10** scope是exact discriminated union：Trunk仅`{ kind: "trunk" }`，Worktree仅`{ kind: "worktree", worktreeId }`且ID非空；missing、unknown kind、wrong primitive、missing或extra scope fields均拒绝。不得把scope扩展成通用branch/provider abstraction。
- **AC-11** `serializeWorkspaceRuntimeTarget(parseWorkspaceRuntimeTarget(value))`产生exact wire object；Trunk/Worktree和五种type round trip均相等，serializer输出可直接交给daemon parser且不携class/prototype/undefined/Session。
- **AC-12** `workspaceSnapshotPrefix()`精确返回`/universer-api/snapshot`或encoded`/universer-api/worktrees/:worktree/snapshot`；特殊字符Worktree ID只编码一次，不接受target origin拼进prefix。
- **AC-13** `workspaceRuntimeKey()`继续忽略revision；同target跨revision同key，origin/scope/Worktree/Unit/type任一变化均隔离。测试包含`:`、`/`、Unicode与percent字符，证明component encoding不碰撞；key不含Cookie或revision。

### Worktree/Trunk target resolution

- **AC-14** Core source只接收既有concrete `WorkspaceHttp`，不读取Session/config或再包装auth seam。CLI仍在原有调用时点取得`auth.authenticatedHttp("client")`后构造source，input validation与Session lookup顺序兼容。
- **AC-15** Worktree resolution只GET exact `/api/worktrees/:id`并复用Change 3的strict Worktree/Unit owner；returned Worktree ID必须匹配，requested Unit必须为同一Worktree member。missing membership保持既有`WORKSPACE_UNIT_NOT_FOUND`/`workspace-unit-not-found`大小写与message，不发Snapshot请求。
- **AC-16** readonly Worktree target继续支持既有可读states；editable target只允许Draft。非Draft在runtime/daemon前返回`workspace-worktree-not-editable`及`{ state, worktreeId }`，不得通过revision 0、Trunk fallback或隐式reopen绕过。
- **AC-17** selected Worktree Unit必须有支持type与nonnegative safe `draftHeadRevision`；wrong Unit/type/revision或malformed membership整体拒绝，target中的origin、Worktree ID、Unit ID、type、revision全部来自已验证input/Server model，不信任任意response替换。
- **AC-18** Trunk discovery固定按wire type `2(sheet) → 1(doc) → 3(slide) → 5(base) → 6(board)`请求`/universer-api/snapshot/:type/unit/:encodedUnit/rev/0`；首个strict success立即停止并以观察head构造Trunk target。
- **AC-19** 只有code等于既有`ErrorCode.INVALID_ARGUMENT`字符串且message逐字为`Unit type does not match the stored unit`才继续probe。auth、permission、not-found、transport、redirect、invalid response、相同code不同message或相同message不同code均立即返回，后续type请求为0。
- **AC-20** 五种type全部精确mismatch后返回既有`workspace-unit-type-unsupported`、supported type顺序和bounded Unit ID detail；不得无限probe、并行probe、重试known failure或把all-mismatch改成not-found。

### Scope-aware Snapshot source与adapter

- **AC-21** direct source对Trunk/Worktree分别使用AC-12 prefix；Unit/block IDs exact encode，Unit始终读`rev/0`再计算head。AbortSignal按既有请求传递，不改变endpoint、role、Cookie或Origin行为。
- **AC-22** wire mapping固定`doc=1,sheet=2,slide=3,base=5,board=6`。五种Snapshot必须匹配requested Unit/type并含nonnegative safe revision；Sheet/Base严格验证workbook、sheets与每个metadata，Doc/Slide/Board严格验证对应metadata object。
- **AC-23** base64字段只接受`Uint8Array`或严格有效base64 string并产出exact bytes；non-string、非法alphabet/padding/trailing garbage不得被`Buffer.from`静默接受。Sheet/Base workbook与各Sheet、Doc/Slide/Board metadata以及serialized block均有正反case。
- **AC-24** changeset数组必须存在；每项Unit/type、nonnegative safe`baseRev`/`revision`与mutations array严格匹配。direct source以最后changeset revision或Snapshot revision计算head；选定target revision不一致时保持`WORKSPACE_RESPONSE_INVALID`路径，不返回partial snapshot/changesets。
- **AC-25** direct Sheet block endpoint必须返回requested block ID与strict base64 bytes；missing/wrong block、null body或wrong data拒绝。direct source继续使用其既有uppercase`WORKSPACE_RESPONSE_INVALID`合同，不为与SDK adapter去重而改code/message。
- **AC-26** `WorkspaceSnapshotServerAdapter.getUnitOnRev()`按host/reference scope选prefix并严格解析optional Snapshot、changesets与protocol error；wrong Unit/type/revision/metadata/base64或malformed numeric error拒绝为既有`workspace-invalid-response`。
- **AC-27** adapter的serialized/deserialized block endpoints、block ID/data规则保持不同；`fetchMissingChangesets`精确编码`from/to`并验证optional latest revision；resources精确编码requested IDs并拒绝malformed或不对应requested identity的response。所有路径固定method/query/request count。
- **AC-28** reference context存在时adapter只用context选定scope；context缺失时只用host scope。wrong expected Unit或malformed context在HTTP前拒绝，不能回落host scope或另一个Worktree。
- **AC-29** `saveSnapshot`、`updateSnapshot`、`saveSheetBlock`、`saveChangeset`、`copyFileMeta`、`getLatestCsReqIdBySid`六个write-side methods对valid/absent reference context均返回`workspace-reference-source-read-only`且HTTP 0调用；malformed context保持context-invalid且同样0请求。
- **AC-30** direct source decoder与SDK adapter decoder保留各自既有code、大小写、message和return shape；只共享完全等价的pure helper，不为消除少量重复引入通用protocol decoder/framework。

### Reference host、context与provider

- **AC-31** Trunk host context为`mappedUnitIds: []`且HTTP 0调用。Worktree host只GET exact Worktree一次并复用strict model；Worktree ID、host Unit membership与`draftHeadRevision === target.revision`必须匹配，缺失host返回既有unit-not-found，stale revision返回`workspace-runtime-target-stale`。
- **AC-32** Worktree host mapped IDs只来自完整验证的membership，保留Server顺序且不静默接纳malformed entries；host target的Worktree/Unit/revision不能被response重绑。host-context loader不读取Session，也不拥有worker lifecycle。
- **AC-33** scope policy固定：Trunk host的所有Source Units为Trunk；Worktree host的mapped Units为同一Worktree，unmapped Units为Trunk。empty source/Worktree identity保持既有`workspace-reference-invalid-context`，不发Snapshot请求。
- **AC-34** load context metadata key逐字为`univer.workspace.reference-source-scope.v1`，value为JSON `{ version: 1, kind, unitId[, worktreeId] }`。Trunk/Worktree round trip与absent metadata→undefined通过，不写入Session、revision或host Unit。
- **AC-35** non-JSON、array/non-record、unsupported version/kind、missing/wrong/empty Unit或Worktree ID及expected Unit mismatch均返回`workspace-reference-invalid-load-context`及现有message；wrong Unit在endpoint/loader前拒绝，不允许fallback。
- **AC-36** provider registration保持ID、priority、`fileKinds:["self"]`和五种Unit type match。Snapshot resolver保持lazy：valid request调用一次；already-aborted、non-self、declared/requested type mismatch和unsupported requested type均为0次。
- **AC-37** provider对Sheet/Doc/Slide/Base/Board分别调用`loadSheet/loadDoc/loadSlide/loadBase/loadBoard`恰好一次，Unit ID不变、revision固定0、v1 selected scope context与`createOptions`原样传入；不建立generic loader registry。
- **AC-38** loaded Unit ID与requested selector、loaded Univer type与requested type均必须匹配；wrong ID/type返回既有stable `workspace-reference-*` code并不返回Unit。self ResourceRef declared type必须先与requested type匹配。
- **AC-39** already-aborted signal在scope selection、Snapshot resolver和loader前拒绝；loader开始后的abort继续允许shared load完成，不要求或伪造Snapshot loader cancellation seam。error、resolver与loader call count固定。

### CLI parity、Asset boundary与交付

- **AC-40** CLI daemon从Core解析target、使用Core revision-independent key并用canonical serializer处理所有target RPC；acquire/pull/head compare/release、daemon methods/socket/legacy shutdown与error codes不变，CLI无第二target parser/key/serializer。
- **AC-41** worker继续拥有Session path/cookie lookup、worker role/PID headers、license、Univer factory、Collaboration backend URLs、WebSocket/session-ticket与process lifecycle；只从Core组合host-context loader、Snapshot adapter与provider registration。Trunk/Worktree backend prefix和Session timing保持。
- **AC-42** content inspect/execute及commit调用的RPC method、target wire bytes、bindings、JSON/text/coded errors和request order不变；reserved binding与invalid daemon result仍在相同边界拒绝。本 Change不移动execute/inspect/commit workflow owner。
- **AC-43** exchange、screenshot与layout lint只切换到Core target types/source/canonical serializer；Worktree/Trunk flags、formula/embedded reference target选择、render runtime create/close、output与error behavior保持。Typst/SVG等依赖target的case至少typecheck且不得出现private source import。
- **AC-44** Asset image resolution保留在CLI或注入的Change 4 Asset owner，Core runtime source无`resolveWorkspaceAssetContent`、signed bytes、`ScreenshotImageAsset`或filesystem imports。现有Host/formula/embed image case仍按exact sign/content URL、bytes、media type、content length与AbortSignal执行。
- **AC-45** 删除CLI被替代的`target.ts`、`snapshot-server-adapter.ts`、`reference-load-context.ts`、`reference-scope.ts`、`referenced-unit-provider.ts`及content-source中的target/Snapshot owner；若文件因CLI composition仍需存在，只能保留application glue，不能保留协议body或re-export shim。daemon、worker、Asset resolver和runtime pool owner必须保留在CLI。
- **AC-46** Client Core manifest只增加迁移所需且与repository SDK baseline完全一致的Collaboration/Protocol/Core/Embed依赖；Core build和CLI bundle从package根解析。package verify确认artifact无`.ts`/test/map、workspace bare runtime import、private Core install dependency、绝对/相邻checkout路径。
- **AC-47** installed tarball smoke在临时cwd/home启动daemon与worker并执行至少一个read-only runtime-backed command，覆盖authenticated Session、Worktree或Trunk target、Snapshot读取及clean daemon shutdown；fixture断言role/PID、exact endpoint/target shape与structured output。只跑`--help`、静态imports或非runtime commands不满足。
- **AC-48** Core/CLI typecheck、test、build，repository typecheck/test/build，clean package build、package verify/smoke与`git diff --check`全部exit 0；Server/OpenAPI/generated、Session/config/auth、Browser reference-provider与排除能力限定diff为空。自动fixture只用假凭据；可选local authenticated read-only smoke的账号/密码只从执行时环境或安全stdin取得，不写Markdown、fixture、源码或日志，Server不可用记`environment-unavailable`且不替代自动gate。QA不得为通过一致性引入通用source/provider framework、大compatibility layer或新的transport/auth/worktree owner。

验收项总数：**48**。

## 执行命令

### 前置 exports、owner与scope

```bash
openspec status --change extract-runtime-target-client-core --json
openspec instructions apply --change extract-runtime-target-client-core --json
pnpm --filter @univerjs/univer-workspace-client-core typecheck
rg -n 'WorkspaceHttp|AuthenticatedWorkspaceHttp|WorkspaceApplicationError|workspaceError|getWorktree|parseWorktree|parseUnit|WorkspaceWorktree|WorkspaceUnit|WorkspaceUnitType' \
  packages/client-core/src/index.ts
rg -n 'apps/cli|@univer-cli/daemon|commander|workspaceSessionPath|readWorkspaceCookie|daemon\.sock|runtimePool' \
  packages/client-core/src --glob '*target*.ts' --glob '*snapshot*.ts' --glob '*reference*.ts'
rg -n '@univerjs/univer-workspace-client-core/(src|dist)|packages/client-core/(src|dist)' \
  apps packages --glob '*.ts' --glob '*.mjs'
rg -n '@univerjs/univer-workspace-reference-provider|packages/reference-provider' packages/client-core apps/cli \
  --glob '*.ts' --glob '*.mjs' --glob 'package.json'
rg -n 'resolveWorkspaceAssetContent|ScreenshotImageAsset|node:fs|prepareDownload|contentLength' \
  packages/client-core/src --glob '*target*.ts' --glob '*snapshot*.ts' --glob '*reference*.ts'
```

第一组必须找到Changes 1–3的唯一exports。forbidden owner、private source/dist import、Browser-provider dependency与Core runtime-target中的Asset/filesystem搜索预期无匹配；类型名或README中的边界说明不算产品依赖。

实施后解析真实owner并检查旧实现消失：

```bash
rg -n 'WorkspaceRuntimeTarget|parseWorkspaceRuntimeTarget|serializeWorkspaceRuntimeTarget|workspaceRuntimeKey|workspaceSnapshotPrefix|WorkspaceSnapshotServerAdapter|createWorkspaceReferenceLoadContext|createWorkspaceReferencedUnitProviderRegistration' \
  packages/client-core/src/index.ts packages/client-core/src
rg -n 'function serializeTarget|function parseWorkspaceRuntimeTarget|function workspaceRuntimeKey|class WorkspaceSnapshotServerAdapter' \
  apps/cli/src
rg -n '@univerjs/univer-workspace-client-core' \
  apps/cli/src/runtime apps/cli/src/features/{content,exchange,screenshot,lint} apps/cli/test
```

第二项CLI owner搜索预期无重复实现；若CLI composition保留同名wrapper，QA必须逐行证明它只注入application依赖且不拥有protocol/parser/serializer body。

### Core direct checks

```bash
pnpm --filter @univerjs/univer-workspace-client-core typecheck
pnpm --filter @univerjs/univer-workspace-client-core build
pnpm --filter @univerjs/univer-workspace-client-core test
pnpm --filter @univerjs/univer-workspace-client-core exec vitest run --config vitest.config.ts \
  test/runtime-target.test.ts \
  test/runtime-source.test.ts \
  test/snapshot-server-adapter.test.ts \
  test/reference-provider.test.ts
```

测试文件可按最终owner命名调整。QA用`rg --files packages/client-core/test`解析真实文件，不因文件名变化跳过scenario；Core direct tests必须记录HTTP method/path/query、resolver/loader count和六个write methods的HTTP 0调用。

### CLI compatibility checks

```bash
pnpm --filter univer-workspace-cli typecheck
pnpm --filter univer-workspace-cli build
pnpm --filter univer-workspace-cli exec vitest run --config vitest.config.ts \
  test/content-execution.test.ts \
  test/workspace-cli.test.ts \
  test/workspace-unit-exchange.test.ts \
  test/workspace-screenshot.test.ts \
  test/workspace-unit-layout-lint.test.ts \
  test/content-source.test.ts \
  test/legacy-daemon.test.ts \
  test/typst.test.ts
pnpm --filter univer-workspace-cli test
```

迁移后CLI的旧`runtime-target.test.ts`或target/source assertions可删除，但对应纯行为必须已迁入Core。CLI保留daemon/worker integration、RPC wire、Asset image、render lifecycle与built-entrypoint assertions。

### Clean package与installed runtime fixture

```bash
pnpm --filter @univerjs/univer-workspace-client-core run clean
pnpm --filter @univerjs/univer-workspace-client-core run build
pnpm --filter univer-workspace-cli run clean
pnpm package:workspace-cli
pnpm --filter univer-workspace-cli package:verify
pnpm --filter univer-workspace-cli package:smoke
```

QA检查smoke从安装目录bin启动真实daemon/worker并执行runtime-backed read；读取fixture的request log与child exit，确认worker无checkout import。仅验证tarball列表或CLI help不能满足AC-47。

### 完整gate与限定diff

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm package:workspace-cli
pnpm --filter univer-workspace-cli package:verify
pnpm --filter univer-workspace-cli package:smoke
git diff --check <before-tree> <after-tree>
git diff --name-only <before-tree> <after-tree> -- \
  apps/workspace packages/reference-provider \
  apps/cli/src/config.ts apps/cli/src/features/auth \
  apps/cli/src/features/asset apps/cli/src/features/blob
git diff --name-only <before-tree> <after-tree> -- \
  apps/cli/src/features/typst apps/cli/src/features/svg \
  apps/cli/src/features/content/embedded-images.ts
```

第一组限定diff预期为空。第二组只允许因public target type import产生的必要行级diff；若出现workflow body变化则判scope failure。无Server contract change时不新增`api:verify`作为完成条件。

### 可选 local authenticated smoke

先以read-only方式检查`127.0.0.1:3020`是否可达。只有Server可用且执行环境通过安全env/stdin提供凭据时，才可在隔离临时`UNIVER_HOME`执行login、whoami与read-only Trunk/Worktree inspect。不得把用户名、密码、Cookie或device code写入本报告、fixture、源码、命令行记录或日志。Server不可用记录`environment-unavailable`，不判产品失败，也不替代Core/CLI/package自动化gate。

## QA观察记录

执行对象：baseline tree `33a49d2baaca732dd5bea7850b00877eb55011b4`，implementation tree `40f5396ae270b113c29cb5b2946a3647203344ef`。以下结论来自源码审查、直接测试的request/call-count assertions、CLI tests与installed artifact，不以tasks勾选代替行为证据。

| 观察面 | 基线合同 | QA证据 | 结论 |
| --- | --- | --- | --- |
| Prerequisites/owner | 复用Changes 1–3 exports、唯一Core owner、无平行transport/auth/Worktree | `index.ts`根导出复用`WorkspaceHttp`、errors、Worktree/Unit owners；CLI五个旧runtime owner删除。全仓搜索只在Core找到parser/key/adapter/context实现；Core runtime文件无CLI/Session/daemon/Browser provider import。 | Pass |
| Target contract | strict parse、plain serializer、exact wire、prefix、revision-independent key | `runtime-target.test.ts`覆盖HTTP normalization、五type/exact scope invalid矩阵、credentials/path/query/hash、round trip、特殊字符prefix与key隔离；Core 11 files/217 tests通过。 | Pass |
| Worktree resolution | identity/membership/type/revision、Draft editability、request/error order | `runtime-source.test.ts`固定Worktree GET、strict Change 3 model、missing membership和非Draft在Snapshot前拒绝；源码审查确认returned identity/type/safe revision均受检。 | Pass |
| Trunk discovery | 五种probe顺序、exact mismatch skip、known failure early exit | direct fixture记录wire types `2,1,3,5,6`与exact URLs；仅exact code+message继续，其他failure首请求退出；五次mismatch产生bounded unsupported error。 | Pass |
| Direct Snapshot source | scope endpoints、strict Snapshot/changeset/block、base64、head match | direct tests覆盖Trunk/Worktree endpoint、五种Snapshot、changeset/head、strict canonical base64、Sheet block identity/bytes与mismatch；未观察partial return。 | Pass |
| SDK Snapshot adapter | host/context scope、all read endpoints、distinct errors、six read-only methods | adapter tests固定host/context endpoint、missing-change/resources query、serialized/deserialized block与protocol error；六个write method及malformed context均断言HTTP 0。 | Pass |
| Reference host/context | strict host membership/revision、mapped/fallback、v1/wrong Unit/malformed | `reference-provider.test.ts`覆盖Trunk 0请求、Worktree strict membership/stale revision、Server顺序、mapped/fallback、exact v1、extra/malformed/wrong Unit。 | Pass |
| Reference provider | self/type/abort、five loaders、revision 0、loaded identity/type | direct parameterized cases覆盖五loader各一次、revision 0、context/options透传、self/type/unsupported、already-aborted resolver 0、loaded ID/type与in-flight abort。 | Pass |
| CLI parity/Asset boundary | daemon/worker/content/exchange/screenshot/lint wire与Asset injection | CLI typecheck/build通过；8个定向files共29 tests及完整CLI 18 files/79 tests通过。daemon/worker继续拥有Session/socket/pool/license/backend；`features/content/source.ts`只保留Change 4 Asset adapter。 | Pass |
| Installed/full gate | installed daemon/worker runtime path、self-contained artifact、scope/full gates | package verify与installed smoke通过；安装bin执行authenticated Worktree `inspect range`，fixture检查exact Snapshot endpoints、worker role/PID、structured value、secret non-disclosure和daemon start/status/stop。全仓typecheck/test/build通过；限定diff与diff-check通过。 | Pass |

发现差异时记录公开合同、稳定复现、exact request/RPC/file/loader证据与受影响命令。不得为一致性引入第二transport/auth/worktree owner、通用source/provider framework、Browser/Node合并层或大compatibility layer。

## AC执行结果

| AC | 结果 | 实际证据 |
| --- | --- | --- |
| AC-01 | Pass | Core根exports包含Changes 1–3的HTTP/error/Worktree/Unit owners；Core typecheck通过，新增source直接复用。 |
| AC-02 | Pass | 能力仅从private Core根导出；未新增package、entry、registry、container或factory hierarchy。 |
| AC-03 | Pass | Core runtime-target/source/Snapshot/reference files无CLI、Config/Session、Commander、daemon/runtime-pool或相邻checkout import。 |
| AC-04 | Pass | CLI旧target/Snapshot/reference五个owner及旧target test删除；全仓重复owner搜索只命中Core。 |
| AC-05 | Pass | Change限定diff未修改`packages/reference-provider`；Core manifest/source无该Browser package依赖。 |
| AC-06 | Pass | Change限定diff对Workspace Server、contracts/generated、Session/auth/config、Asset/Blob、Typst/SVG/embedded-image workflow为空。 |
| AC-07 | Pass | Core根导出target/scope；serializer返回exact `origin,revision,scope,unitId,unitType` plain object，CLI RPC统一使用它。 |
| AC-08 | Pass | direct invalid矩阵覆盖protocol、credentials、path/query/hash及origin优先错误；无HTTP/Session/daemon副作用。 |
| AC-09 | Pass | Unit/type/revision strict invalid矩阵覆盖empty、wrong primitive、negative/fractional/unsafe值与稳定错误。 |
| AC-10 | Pass | Trunk/Worktree exact-key scope decoder拒绝missing/extra/unknown/wrong primitive，无通用branch abstraction。 |
| AC-11 | Pass | 五type、两scope parse/serialize round trip通过；daemon parser消费同一canonical wire。 |
| AC-12 | Pass | direct test验证Trunk及特殊字符Worktree prefix exact encoded一次。 |
| AC-13 | Pass | direct test验证跨revision同key及origin/scope/Worktree/Unit/type和特殊字符隔离；key不含Session。 |
| AC-14 | Pass | Core source构造只收concrete `WorkspaceHttp`；CLI `program.ts`仍在原调用点取得authenticated client HTTP。 |
| AC-15 | Pass | direct fixture验证exact Worktree GET、strict returned identity/membership；missing membership时Snapshot 0。 |
| AC-16 | Pass | readonly resolver保留可读状态；editable只接受Draft，非Draft在daemon前返回既有detail。 |
| AC-17 | Pass | source审查及strict model tests验证Unit type与safe `draftHeadRevision`，未信任response重绑target identity。 |
| AC-18 | Pass | request log精确为Sheet→Doc→Slide→Base→Board wire order，首个success停止并采用strict head。 |
| AC-19 | Pass | direct tests覆盖exact mismatch skip与相同code/不同message、相同message/不同code、transport等立即退出。 |
| AC-20 | Pass | 五次exact mismatch后bounded unsupported error；无并行、无限probe或known-failure retry。 |
| AC-21 | Pass | direct tests固定Trunk/Worktree Unit/block paths、encoded IDs与AbortSignal透传。 |
| AC-22 | Pass | source/adapter tests与source审查覆盖五种wire mapping、Snapshot Unit/type/revision及各metadata shape。 |
| AC-23 | Pass | strict canonical base64 helper/tests拒绝非法alphabet/padding/trailing garbage并比对exact bytes。 |
| AC-24 | Pass | changeset identity/revision/mutations与selected head mismatch tests通过，不返回partial data。 |
| AC-25 | Pass | Sheet block ID/data/base64严格；direct source保留uppercase `WORKSPACE_RESPONSE_INVALID`。 |
| AC-26 | Pass | adapter测试覆盖host/reference scope、optional Snapshot/changesets、strict error envelope及既有lowercase code。 |
| AC-27 | Pass | serialized/deserialized block、missing-change query和resources identity/requested IDs的direct assertions通过。 |
| AC-28 | Pass | valid context唯一决定scope；malformed/wrong Unit在HTTP前拒绝，无host fallback。 |
| AC-29 | Pass | 六个write-side methods在valid/absent context均返回read-only且HTTP 0；malformed context同样0请求。 |
| AC-30 | Pass | source与adapter分别保留大小写不同的既有error contracts；未引入protocol framework。 |
| AC-31 | Pass | Trunk host 0请求；Worktree exact GET一次并检查ID、membership、revision，missing/stale errors通过。 |
| AC-32 | Pass | mapped IDs来自strict Worktree model且保留Server顺序；loader无Session或worker lifecycle。 |
| AC-33 | Pass | direct mapped/fallback tests覆盖Trunk host、mapped Worktree、unmapped Trunk及empty identity错误。 |
| AC-34 | Pass | exact metadata key与v1 Trunk/Worktree JSON round trip通过，无Session/revision/host Unit写入。 |
| AC-35 | Pass | malformed/extra/version/kind/ID/wrong expected Unit矩阵返回stable context code且loader/HTTP 0。 |
| AC-36 | Pass | registration ID、priority、self、五type保持；invalid/already-aborted时Snapshot resolver 0。 |
| AC-37 | Pass | 五loader参数化测试验证各一次、revision 0、selected context/createOptions逐字透传。 |
| AC-38 | Pass | declared/requested type、loaded Unit ID与loaded Univer type mismatch均在返回前拒绝。 |
| AC-39 | Pass | already-aborted在resolver前拒绝；in-flight abort case允许shared load完成，无伪取消seam。 |
| AC-40 | Pass | daemon统一使用Core parser/serializer/key；CLI daemon lifecycle与legacy daemon tests通过。 |
| AC-41 | Pass | worker仍拥有Session/cookie、worker role/PID、license、factory/backend/session-ticket/process lifecycle；只组合Core capabilities。 |
| AC-42 | Pass | content execution/workspace CLI tests验证原RPC method/wire、result validation、JSON/text/coded errors；workflow未迁移。 |
| AC-43 | Pass | exchange/screenshot/lint仅切换Core public types/serializer；定向tests、Typst test与typecheck通过。 |
| AC-44 | Pass | Core runtime source无Asset/signed bytes/filesystem；CLI subclass保留Change 4 Asset download与screenshot integration。 |
| AC-45 | Pass | 五个CLI owner及content source协议body删除；daemon/worker/Asset/runtime pool owners保留。 |
| AC-46 | Pass | Core仅增加四个exact `1.0.0-beta.2` SDK依赖；package verify确认203 files，artifact无private checkout dependency。 |
| AC-47 | Pass | installed tarball fixture执行authenticated Worktree inspect；worker request paths、role、numeric PID、structured result及clean daemon lifecycle均通过。 |
| AC-48 | Pass | Core/CLI/package/full gates与`git diff --check`全部exit 0；127.0.0.1:3020为`environment-unavailable`，可选local smoke未使用凭据且不影响自动gate结论。 |

汇总：**48/48 pass，0 open issue**。

## 实际命令与结果

```text
openspec status --change extract-runtime-target-client-core --json
  PASS: planning artifacts complete
openspec instructions apply --change extract-runtime-target-client-core --json
  PASS: tasks 7/7 complete（仅作coverage交叉检查，不作为行为证据）
git diff --check 33a49d2baaca732dd5bea7850b00877eb55011b4 40f5396ae270b113c29cb5b2946a3647203344ef
  PASS
owner/private-import/scope/credential rg + bounded git diff checks
  PASS: Core唯一owner；限定产品diff为空；仅测试fixture假cookie/device code命中凭据模式
pnpm --filter @univerjs/univer-workspace-client-core typecheck
pnpm --filter @univerjs/univer-workspace-client-core build
pnpm --filter @univerjs/univer-workspace-client-core test
  PASS: 11 files, 217 tests
pnpm --filter univer-workspace-cli typecheck
pnpm --filter univer-workspace-cli build
pnpm --filter univer-workspace-cli exec vitest run --config vitest.config.ts \
  test/content-execution.test.ts test/content-source.test.ts test/workspace-cli.test.ts \
  test/workspace-unit-exchange.test.ts test/workspace-screenshot.test.ts \
  test/workspace-unit-layout-lint.test.ts test/legacy-daemon.test.ts test/typst.test.ts
  PASS: 8 files, 29 tests
pnpm --filter @univerjs/univer-workspace-client-core run clean
pnpm --filter @univerjs/univer-workspace-client-core run build
pnpm --filter univer-workspace-cli run clean
pnpm package:workspace-cli
pnpm --filter univer-workspace-cli package:verify
pnpm --filter univer-workspace-cli package:smoke
  PASS: clean build, 203 files; installed tarball commands and runtime fixture passed
pnpm typecheck && pnpm test && pnpm build
  PASS: SDK 4, release 8, reference-provider 16, Core 217, Workspace 152, CLI 79 tests; all builds passed
curl --fail --max-time 2 http://127.0.0.1:3020/api/session
  environment-unavailable: connection refused; no account credential used
```

## QA issues

状态取值：`open`、`fixed-pending-qa`、`closed`、`accepted-risk`。

| ID | 严重度 | 证据 | 期望 | 状态 |
| --- | --- | --- | --- | --- |

无 issue；open issue 数：**0**。

## STD-01 fix re-QA（2026-08-28）

复验范围严格限定为 tree `40f5396ae270b113c29cb5b2946a3647203344ef..8ffc9d4df36cea8acd3a1a932275e947eb62bbbb`。diff 只有 `apps/cli/scripts/smoke-package.mjs` 的 7 行新增，无manifest、lockfile、产品runtime、OpenSpec或其他能力变化。

- Socket lifecycle：`createCollaborationSocketFixture()`以内部`Set`跟踪通过URL/key校验的accepted sockets；socket `close`时从Set移除。fixture `close()`先调用`collaboration.close()`逐个`destroy()`，再等待Workspace与Asset HTTP servers关闭，避免accepted WebSocket阻塞teardown。
- Invalid upgrade：URL或`sec-websocket-key`无效时仍立即`socket.destroy()`并return，发生在`sockets.add()`之前。
- 设计边界：只修package fixture teardown；未新增依赖、公共interface、adapter、通用socket abstraction或scope creep。原48项产品AC未被修改，installed authenticated inspect/worker smoke再次通过。

实际命令：

```text
node --check apps/cli/scripts/smoke-package.mjs
  PASS
git diff --check 40f5396ae270b113c29cb5b2946a3647203344ef 8ffc9d4df36cea8acd3a1a932275e947eb62bbbb
  PASS
git diff --name-only 40f5396ae270b113c29cb5b2946a3647203344ef 8ffc9d4df36cea8acd3a1a932275e947eb62bbbb
  PASS: apps/cli/scripts/smoke-package.mjs only
pnpm --filter univer-workspace-cli typecheck
  PASS
pnpm package:workspace-cli && pnpm --filter univer-workspace-cli package:smoke
  PASS: rebuilt 203-file artifact; installed tarball commands passed
```

复验结论：**STD-01 pass；原48/48 AC保持pass；0 open issue。**
