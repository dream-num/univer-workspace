# add-dsh-api-resource-discovery-tools review

状态：PASS（0 open findings）

审查范围只包含 OpenSpec change `add-dsh-api-resource-discovery-tools` 及其直接触及的
`apps/dsh-univer-work` composition、tests、package verification/smoke 与责任文档。本报告不修改产品代码、
测试或 tasks。

## 固定依据

- `openspec/changes/add-dsh-api-resource-discovery-tools/{proposal.md,design.md,tasks.md}` 与 discovery delta spec
- 根/目标 `AGENTS.md`、README、`apps/workspace/CONTEXT.md` 与 ADR 0007
- `@univer-cli/api-reference@1.0.0-beta.2`、`@univer-cli/resource-library@1.0.0-beta.2`、
  `@univerjs-pro/cli-assets@0.1.0` 的 installed public exports、types 与 package metadata
- DeepSeek Harness `0.1.1-rc.2` 的现有 ToolRuntime、approval、filesystem policy 与 lifecycle seams

shared dirty worktree 没有可单独使用的 feature commit fixed point；审查以 change artifacts 为 Spec 固定点，
按该 change 新增/修改路径持续复核实现 diff。Standards 轴同时应用仓库规则、Fowler smell baseline 与
Ponytail full。

## Review checklist

| 轴 | 必须取得的直接证据 | 状态 |
| --- | --- | --- |
| Installed datasets | 只用三个 exact public packages；opaque manifest public subpath；activation fail-closed 且注册前完成；无 CLI/private path fallback | PASS（Task 1 source） |
| Exact public API | API reference 与 ResourceLibrary 只调用 published root exports；不复制 manifest lookup、HTTPS/SVG/handle/filename 语义 | PASS（Tasks 1–5） |
| Closed arguments/results | 五个 operation-specific schemas；own-key/accessor/undefined/recursive JSON validation；Native/Code/render 同一 canonical value | PASS（Tasks 2–5 source） |
| Keyless reads | 四个 query 不解析 origin/credential/grant，不 ask、不联网、不写文件/cache；缺 grant 仍可运行 | PASS（Tasks 2–3） |
| Query/result budgets | 64 KiB args、fan-out/string/enum/limit defaults；API 1 MiB、其他 256 KiB complete result，overflow 不截断 | PASS（Tasks 2–5） |
| Export approval ordering | current policy → positive LocalFS identity → immutable args/directory containment → one ask；pre-ask 不查 handle/manifest/filename、不 processPath/network/output | PASS（Task 4 gate；contains内部opaque target conversion按public seam处理） |
| Body revalidation | approval 后重取 policy/provider/cwd/root/dir；provider、root、symlink drift 均在 processPath/network/output 前拒绝 | PASS（Task 4） |
| Filename/path boundary | public library owns handle→filename；adapter只接受单 basename；target 同时受 revalidated directory、Session cwd 与 policy root containment | PASS（Task 5） |
| Atomic publisher | same-directory unpredictable `0600` temp；complete write + fsync + cancel check + atomic replace；failure保留旧目标并清 temp/handle | PASS（Task 5 source） |
| Cumulative charging | 每个 response chunk 永久扣 32 MiB；10 MiB单资源失败可续；Content-Length/exact exhaustion/chunk overflow terminal且无 later request | PASS（Task 5） |
| No cache / call isolation | query shared immutable validation only；每个 export 独立 library/adapters/signal/budget/directory/result；无 retained cache/current-call/AsyncLocalStorage | PASS（Task 5） |
| Cancellation/lifecycle | caller/owner fused；取消后不启动 later lookup/request/output；confirmed files保留；owner unregister/abort/drain accepted bodies与 finalizers | PASS（Task 6 source） |
| Errors/secrecy | frozen constructor/code allowlist与 fixed safe detail；unknown generic；URL/header/body/SVG/temp/outside path/cause/credential不进入任何 transcript | PASS（Tasks 1–6 source） |
| Installed closure | actual tarball exact datasets/deps、五 tools、no grant/unrelated cwd、controlled HTTPS、Native/Code、partial/cancel/dispose；无 CLI/Core/Skill/checkout fallback | PASS（Task 7 package） |
| Compatibility/scope | Client Core、CLI commands/Skills、Server/OpenAPI/database/deployment/release与 SDK baseline不变 | PASS（Task 7 gates） |
| Standards/Ponytail | 复用现有 owner、closed tool 与 file gate；无 discovery service、generic publisher、cache/config、第二 owner或 speculative abstraction | PASS（Tasks 1–6 source） |

## Findings

Findings 记录 severity、位置、Spec/standard 依据、复现证据、最小修复与独立复验状态。

### REV-ARD-01 — medium — installed manifest load escapes the fail-closed activation boundary

- 位置：`apps/dsh-univer-work/src/discovery-tools.ts:14-15`，以及 dataset activation tests。
- 依据：Task 1.1 要求 missing/malformed installed data fail closed；delta spec `Installed dataset is invalid`
  要求 initialization failure 在注册 partial surface 前统一为 `workspace-discovery-dataset-invalid`，且不暴露
  package/manifest path、dependency message、cause 或 stack。
- 复现：`require("@univerjs-pro/cli-assets/manifest.json")` 在模块顶层、`createWorkspaceDiscoveryDatasets()`
  的 `try` 之外执行。installed dependency/subpath missing、JSON load failure或 resolver error会在 plugin module import
  阶段抛出原始 Node error，既不会成为固定 Harness code，也可能包含安装绝对路径。现有“missing”测试只注入
  `resourceManifest: undefined`，没有覆盖 installed loader failure。
- 最小修复：把 public subpath load 延迟到 `createWorkspaceDiscoveryDatasets()` 的现有 `try` 内；增加最小 loader
  injection 或等价 fixture，使 loader 抛含 path/secret 的 error，断 fixed code/secrecy与零 tool/Skill registration。
  保留同一 public package subpath，不增加 resolver/service abstraction。
- 修复复验：manifest loader现在只在 existing initializer `try` 内调用，default仍为唯一 public
  `@univerjs-pro/cli-assets/manifest.json` subpath；注入 path/secret loader failure在 direct initializer与Host
  activation两条路径均固定为 dataset-invalid，activation tool registration为零。独立 DSH typecheck与 focused
  discovery 8/8 PASS。
- 状态：CLOSED。

### REV-ARD-02 — medium — malformed query arrays use result errors and may execute accessors before rejection

- 位置：`apps/dsh-univer-work/src/discovery-tools.ts:372-395,602-665`；API direct-body tests。
- 依据：delta `Input fan-out exceeds a limit`要求 malformed entries固定为 invalid-argument并在 dataset lookup前失败；
  `Direct execution supplies an unknown key`与 closed canonical boundary要求非 JSON/accessor/sparse输入在 capability work前
  拒绝且不回显。输出侧同样要求 non-JSON value在 render/Native/Code前失败。
- 复现：`boundedUniqueStrings()`调用只会抛 `invalidResult()` 的 `stringValues()` / `denseArray()`，因此
  `terms: [1]`、`symbols: "x"` 或 sparse array经 direct closed-tool body得到
  `workspace-discovery-result-invalid`，不是 argument-invalid。更早的 `enforceArgumentBytes(record)` 会
  `JSON.stringify()` 尚未递归验证的 array；index getter或 `toJSON`可在拒绝前被执行。`denseArray()`只核 own-key
  顺序，不核 enumerable data descriptor，输出 array accessor也会在 validator iteration中执行。
- 最小修复：让 array/string helper接受 caller-specific failure（input传 invalid-argument，output保持 invalid-result），
  核每个 index为 enumerable own data property且非 `undefined`；input先完成递归 shape/semantic validation再量 canonical
  JSON bytes。增加 wrong-kind/sparse/accessor direct fixtures，断 exact code、getter零调用与 dataset零调用；不要引入
  schema library或第二 validator abstraction。
- 修复复验：input helper现在传入 operation-specific invalid-argument，先将每个 index验证为普通 Array上的
  enumerable own data property并复制 canonical strings，再量UTF-8 JSON bytes；output继续使用invalid-result。
  wrong-kind、sparse、root/index accessor、toJSON与symbol fixtures均断 getter/lookup零调用。独立 DSH typecheck与
  focused discovery 35/35 PASS。
- 状态：CLOSED。

### REV-ARD-03 — medium — cancellation during synchronous lookup still starts result projection

- 位置：`apps/dsh-univer-work/src/discovery-tools.ts:327-365,566-600`；API cancellation tests。
- 依据：delta `Caller cancels a read-only query`要求取消发生于 installed dataset lookup期间时不启动 later
  projection；design Decision 3/6要求 caller/owner signal在 synchronous dataset work周围检查。
- 复现：`executeDiscoveryRead()`只在整个 `body()`前后检查 signal，而 API tool的 `body()`同时包含 dataset
  `find/show`与完整 output validation/serialization。fake reference在 `find()`内同步 abort caller后返回 valid-shaped值时，
  `validateApiFindOutput()`仍会执行，直到整个 body结束才映射 cancellation；owner disposal同样如此。
- 最小修复：让既有 read callback接收 fused signal，在 public dataset call返回后、任何 projection/validation前
  `throwIfAborted()`，并保留最终 caller/owner classification；增加同步 lookup barrier/abort fixture断 projection getter或
  validator seam零调用。资源 query复用同一 read seam时也应得到同样边界，不增加 queue/service。
- 修复复验：existing read callback现接收 fused signal；API find/show在 public lookup返回后、projection前检查。
  lookup内同步 caller abort并返回 poisoned accessor array的fixture得到operation-cancelled，projection getter零读取，
  public lookup仅一次。独立 focused 35/35与typecheck PASS。
- 状态：CLOSED。

### Task 2 API discovery checkpoint

- 两个schemas与application validators逐层覆盖published find及show的class/member/type/type-member/not-found unions；
  output term/query长度、顺序与输入identity固定，find matches不超过effective per-term limit。所有objects/arrays只接受
  closed enumerable own data且拒绝accessor、own undefined、sparse及非有限number。
- 默认limit 10、最大30、1..8 unique nonblank/160-code-point strings、unit enum、64 KiB canonical args与1 MiB
  complete result按UTF-8 bytes固定；overflow返回actual/max/guidance且不截断/反射payload。
- installed no-grant ToolRuntime、全部show unions、unknown dependency secrecy与Code Mode name/subCallId pairing均有直接
  evidence。Native/Code value来自同一validated canonical result，render只使用count。
- 独立 DSH typecheck与focused discovery 35/35 PASS。Task 2当前0 open。

### REV-ARD-04 — medium — resource validator narrows public `order` and omits stable handle identity

- 位置：`apps/dsh-univer-work/src/discovery-tools.ts:310-339,575-612`；resource output fixtures。
- 依据：published `ResourceSummary`定义`order: number | null`，且public catalog合同定义stable handle为
  `<registryId>/<resourceId>`；delta要求preserve stable handles/order/intrinsic size并拒绝otherwise malformed value。
- 复现：output schema把非null `order`声明为integer，application validator进一步要求non-negative integer；public
  manifest loader只要求finite number，因此合法negative/fractional order会被plugin拒绝。反向地，validator只分别检查
  `handle`、`registryId`、`id`为strings，不核`handle === registryId + "/" + id`，所以dependency返回错配stable
  identity会作为canonical success通过。intrinsic size也接受0，尽管public library manifest constructor只产生positive size。
- 最小修复：schema使用finite number/null，validator按public contract接受任意finite order；固定handle cross-field identity，
  intrinsic width/height保持strict positive。增加fractional/negative order success与mismatched handle/zero size failure，
  不复制library handle parser或manifest规则。
- 修复复验：source已改为number/null + finite order，固定public component/handle identity与strict-positive size；
  mismatched handle、invalid component/name与zero/negative size fixtures已通过。real ToolRuntime table直接接受并保留
  `-2`、`-0.5`、`0.25`与`4`四个finite public order，覆盖installed整数dataset以外的合法值。
- 状态：CLOSED。

### REV-ARD-05 — high — constructor check preserves arbitrary runtime resource error codes

- 位置：`apps/dsh-univer-work/src/discovery-tools.ts:843-854,1025-1033`；resource error tests。
- 依据：delta `Discovery failures are stable and secret-free`要求frozen code allowlist；只有published
  `ResourceLibraryErrorCode`成员可保留，unknown dependency material必须映射generic fixed failure。
- 复现：`isResourceLibraryError(error)`只证明public constructor identity，`ResourceLibraryError`的runtime constructor仍可
  接受任意string code。当前分支不做membership检查就把`error.code`写入Harness error info；
  `new ResourceLibraryError("password=secret" as never, ...)`会把unlisted/secret code带入Native/Code transcript。
  TypeScript union不能作为runtime trust boundary。
- 最小修复：建立精确frozen `ResourceLibraryErrorCode` set（后续query/export共用），仅constructor identity且membership
  同时成立才保留code；否则generic discovery/export failure。用真实constructor的allowlisted与unlisted sentinel各一例，
  断message/cause/handle同样不反射；不要duck type或解析message。
- 修复复验：runtime set与beta.2 public union的23个code逐项一致；只有public constructor identity且set membership
  同时成立才保留。真实constructor的known code保留，unlisted password code降级generic；message/cause/path sentinel
  不反射。独立 typecheck与focused 65/65 PASS。
- 状态：CLOSED。

### Task 3 resource discovery checkpoint

- 两个resource schemas与application validators只投影published registry summary及resource summary字段；stable handle固定为
  `<registryId>/<resourceId>`，component/name、positive intrinsic size、finite `order | null`、safe text与closed metadata
  都有直接正反例。dependency扩展字段、accessor、own undefined、sparse array及malformed totals均在render前拒绝。
- filters/defaults覆盖1..8 unique queries、0..8 registries、default 30/max 100；find结果固定query/registry identity、
  `total >= resources.length`、effective limit与256 KiB完整结果预算。unknown registry仅保留public constructor且frozen
  code membership，其他dependency error统一降级且不反射message/cause/path sentinel。
- 四个read tools均由同一caller/owner cancellation seam包围，keyless执行不解析grant/credential、不ask、不联网、不写
  cache；Native与Code Mode共享validated canonical value和value-only render。
- 独立 DSH typecheck、focused discovery 65/65与scoped diffcheck PASS。Task 3当前0 open。

### REV-ARD-06 — high — export preserves every `FileTransferToolError` without frozen code projection

- 位置：`apps/dsh-univer-work/src/discovery-tools.ts:1039-1081`；export body failure tests。
- 依据：delta `Discovery failures are stable and secret-free`要求filesystem/lifecycle failure使用frozen code allowlist、
  fixed messages和exact safe detail；unknown dependency failure必须降级。constructor identity本身不证明runtime code属于allowlist。
- 复现：inner sanitizer与outer owner boundary都直接返回任意`FileTransferToolError`。共享resource library的`export()`或
  其他dependency只要抛同一public application constructor并携带unlisted/secret code、message或outside path detail，就会原样
  进入Harness。现有`workspace-file-path-outside-session`也携带未经confined证明的原始path detail。
- 最小修复：在file-effect owner seam提供constructor + exact code membership projector，为每个允许的policy/local/cwd/
  containment/cancel/dispose/operation code重建固定error；outside-path不保留未confined path。discovery的inner/outer两层都只接受
  projector结果，其他同constructor或dependency error降级generic。增加known body policy error与unlisted sentinel constructor
  两个real ToolRuntime rows。
- 修复复验：file-effect seam现以private exact constructor加closed switch投影允许的policy/local/cwd/containment/
  cancel/dispose/operation codes，并重建固定message；outside containment不再携带原始path。discovery仅为resource export在
  inner sanitizer与outer owner boundary调用projector。real ToolRuntime直接证明known body policy/local/path codes保留，
  read-only dependency抛genuine internal file error或forged Harness code均降级generic且secret-negative。
- 状态：CLOSED。

### REV-ARD-07 — withdrawn — provider identity means current public-constructor proof, not object continuity

- 位置：`apps/dsh-univer-work/src/discovery-tools.ts:591-650`；approval-wait drift tests。
- 审查结论：design明确body不保留preflight policy/path state，每次只从immutable arguments重新证明current policy、
  public LocalFileSystem constructor与cwd/root/path containment，并禁止shared current-call/AsyncLocalStorage。scenario要求拒绝
  provider变化后“now-ineligible”的调用，不要求LocalFS A与另一个同constructor且重新通过所有current gates的LocalFS B做
  object-reference continuity。
- 所需证据：保留approval后current filesystem变为non-local或失去public constructor proof的rows，断body在
  `processPath()`、network/output前失败且不ask第二次。无需WeakMap或新的execution state seam。
- 状态：CLOSED（不是产品finding）。

### Task 4 local export effect gate checkpoint

- pre-execute固定current policy → exact public LocalFileSystem proof → closed handles/directory → Session cwd与current
  `workspaceRoot` containment → single ask。read-only在provider/arguments之前拒绝；non-local在model path解释前拒绝；合法但
  missing handle仍先ask，证明preflight没有读取private manifest、推导filename或启动resource export/network/output。
- bare、workspace-write及danger均保留Session cwd boundary，workspace-write再叠加current root。allowed body从immutable
  arguments重取current policy/local proof/cwd/root/directory；policy narrowing、constructor-proof loss与symlink escape均在
  explicit Host destination conversion、network/output前拒绝且不二次ask。
- `LocalFileSystem.contains()`内部使用`processPath(FsTarget)`属于published opaque containment实现；review按“pre-ask不把
  destination转换为Host string并交给resource capability/network/output”判定，而不要求无法实现的底层method零调用。
- accepted-body第二次directory resolve的caller abort在barrier settlement后固定映射operation-cancelled，secret-negative且不进入
  later destination/export step。REV-ARD-06 projector使body-time file errors只保留closed codes/fixed messages。
- 独立 DSH typecheck、focused discovery 84/84与scoped diffcheck PASS。Task 4当前0 open；call-owned downloader/output的
  placeholder替换明确属于Task 5。

### REV-ARD-08 — high — abort/read settlement race skips charging a received response chunk

- 位置：`apps/dsh-univer-work/src/discovery-tools.ts:761-817`；cumulative downloader race tests。
- 依据：design Decision 3与delta `Failed download consumes part of the budget`要求每个received body chunk在forward前
  永久扣减，包括后来因abort/timeout/validation/publication失败的bytes；ordinary per-resource failure可继续时，next handle只能
  得到扣减后的精确remainder。
- 复现：`boundedResponseBody.pull()`在`await reader.read()`返回后先`signal.throwIfAborted()`，之后才处理
  `chunk.value.byteLength`。SDK per-download timeout若与read settlement相撞，public downloader将timeout作为当前handle failure，
  outer one-handle loop可继续next handle，但这个已经returned的chunk完全未计费，允许call累计接收超过32 MiB。
- 最小修复：read返回`done`时按EOF/cancellation收敛；返回value时先做cumulative overflow/remaining charge，再检查signal，
  然后才enqueue。增加controlled stream/SDK timeout race，证明当前handle失败后next handle看到已扣remainder或terminal；不新增
  counter/service abstraction。
- 修复复验：non-done chunk现先做overflow/remaining扣减，再观察fused signal，最后才enqueue。controlled underlying
  stream在reader settlement中enqueue 4 bytes并同步abort downloader signal；消费失败后remaining精确减少4，下一response的
  declared length只比新remainder大4即在body前terminal，证明没有丢失aborted bytes。
- 状态：CLOSED。

### REV-ARD-09 — high — output-time re-resolution can silently replace the call-owned directory identity

- 位置：`apps/dsh-univer-work/src/discovery-tools.ts:828-878`；download/output race tests。
- 依据：design Decisions 4/5要求accepted export持有body-revalidated directory closure；output adapter必须把filename target
  固定在该rechecked directory及current roots下。directory/symlink identity改变不得把已批准call导向另一个目标。
- 复现：body记录`expectedDestination`，public library也回传这个destination；adapter只核library argument等于expected，随后
  `resolveResourceOutput()`重新解析`output_directory`并直接使用当前destination/path，却不与captured identity比较。下载期间
  若contained symlink从A切到另一个同样contained的B，adapter会把SVG原子发布到B。
- 最小修复：两次output-time re-resolution（mkdir前、temp前）都要求resolved destination与captured
  `expectedDestination`精确相同，否则在temp前固定失败。增加fetch barrier：body capture A后切symlink至B，释放valid SVG，
  断A/B均无file/temp且failure secret-safe；只使用已有call closure，不增加shared state。
- 修复复验：source在mkdir前与temp前两次核resolved destination严格等于body-captured
  `expectedDestination`。real ToolRuntime fetch barrier让body capture symlink target A，下载中切换同样contained的B后释放
  valid SVG；result只含fixed resource-export-failed，A/B readdir均为空，证明无file/temp或silent redirection。
- 状态：CLOSED。

### Task 5 bounded atomic export checkpoint

- 每个accepted body从opaque manifest构造独立public ResourceLibrary、no-retention cache、HTTPS downloader、fused signal、
  32 MiB counter、revalidated directory/output closure与partial accumulators；outer loop每次只传一个handle，terminal/cancel后
  不让public batch export自行继续。两个并发calls的signal、budget、destination与adapter state直接隔离。
- injected fetch保留public downloader的HTTPS/redirect/URL/UTF-8/SVG语义，并在forward前永久charge每个stream chunk。
  declared >10 MiB且<=remainder取消body、零charge、nonterminal；streamed >10 MiB扣已消费bytes后可续；transport、abort与
  publication失败均保留charge。declared >remainder、chunk >remainder与exact exhaustion三分支都直接证明terminal/no later
  request；real ToolRuntime以10+10+10+2 MiB valid SVGs证明exact current四个files发布、第五handle无fetch。
- output adapter只接受single basename（absolute、parent、slash/backslash均拒绝），两次核current directory identity与body
  capture一致，并重复Session/current policy containment。publisher使用same-dir unpredictable `wx`/`0600` temp，完整write、
  `sync()`、pre-rename cancellation check与atomic replace；existing file mode/content、prior directory object、invalid SVG、
  rename failure及A→B symlink drift rows证明prior preservation和file/temp cleanup。
- closed result只保留confirmed `{handle,path}`与allowlisted `{handle,code}`；raw public messages/transport sentinel不进入result。
  无cache目录、retained SVG、shared current-call、AsyncLocalStorage或第二owner/service/通用publisher abstraction。
- 独立 DSH typecheck、focused discovery 113/113与scoped diffcheck PASS；write/sync failure也直接证明close、prior
  preservation与temp cleanup。REV-ARD-08至11均closed，Task 5当前0 open。

### REV-ARD-10 — high — exported path is trusted without proof that the output adapter confirmed it

- 位置：`apps/dsh-univer-work/src/discovery-tools.ts:675-715,982-1025`；malformed export-result tests。
- 依据：delta `Export retains only approved outputs`与`Failure material contains a secret`要求result只报告atomic publisher已经
  confirmed的caller-owned files；dependency提供的outside Host path、credential/path sentinel不得进入Native/Code/render。
- 复现：`validateResourceExportOutput()`只核exported handle属于input且path为string。public/injected library可完全不调用
  output adapter，却返回`{handle, path: "/private/...token..."}`；tool会把它作为confirmed success原样输出。反向地，library
  也可在adapter已publish后返回failure/mismatched path，导致confirmed file未被canonical result记录。
- 最小修复：在每个call closure内维护`Map<handle,path>`，只在`publishResourceSvg()`成功返回后把outer one-handle的active
  handle与path记为confirmed；最终要求public exported entries与ledger一一精确相同且所有ledger entry均被报告。增加fake
  library的forged path/no-output及confirmed-output-but-failure/mismatch rows，断invalid/generic且sentinel-negative。不得使用
  shared current-call slot。
- 修复复验：call-owned active handle与confirmation map只在atomic publisher返回后记path；每个one-handle public result立即
  closed validate，最终aggregate只使用这些canonical rounds。fake library的unconfirmed forged path、confirmed后mismatched
  path及confirmed后failure三种矛盾均result-invalid，Native result不含private/path/secret sentinel。
- 状态：CLOSED。

### REV-ARD-11 — medium — confirmation ledger duplicates the SDK-owned export filename rule

- 位置：`apps/dsh-univer-work/src/discovery-tools.ts:703-719,974-977`。
- 依据：design Decision 4与delta `Local resource export is confined and approved`明确public resource library独占
  handle existence与canonical flat filename；Client Shell只验证returned filename为single basename并confine target，不得从
  handle/private manifest推导或重写命名规则。
- 复现：REV-ARD-10的初版ledger新增`resourceExportFilename(activeHandle)`并要求filename等于本地推导的
  `${registryId}--${resourceId}.svg`。这复制SDK内部规则，使本仓库成为第二owner，并会拒绝同一public contract未来合法返回的
  其他basename。
- 最小修复：删除filename derivation/equality；outer one-handle的`activeHandle`已经足以把output adapter成功path记到ledger。
  保留single-write guard、basename/path/identity/containment gates与ledger-result exact comparison。
- 修复复验：本地filename helper/equality已删除；ledger只用outer active handle关联public adapter实际返回的confirmed path。
  basename、directory identity、containment与single-write guard保留，real public filename与unsafe supplied filename rows均通过。
- 状态：CLOSED。

### Task 6 errors, cancellation and owner lifecycle checkpoint

- 五个closed tools和一个export pre-execute listener共用现有Host owner。already-aborted real ToolRuntime在approval、path、
  network与output前返回canonical pre-dispatch abort；read lookup、export download及每个sequential effect都由caller/owner
  fused signal包围。
- caller在一个file confirmed后取消时不会启动第三个handle；rename已进入的不可中断primitive完成后保留confirmed file，
  ToolRuntime只返回canonical aborted outcome与inspect-directory/no-auto-retry guidance。owner disposal分别与忽略abort的fetch及
  in-flight fsync相撞，dispose在primitive、handle close、temp cleanup和accepted body完成前不返回。
- disposal先停止接收，再按逆序卸载listener和五个tools、abort并drain。测试在dispose后重新注册同名minimal export tool，
  valid body不再触发旧approval listener且可直接完成，直接证明policy listener没有残留；全部discovery schemas也为空。
- genuine public resource constructor只保留frozen code membership；fake code、fetch/HTTP/open与dependency message/cause中的
  URL、header、body、raw SVG、temp/outside path及credential sentinel都降级或从per-handle canonical value删除。Code Mode
  confirmed export使用同一canonical value，start/settled按name与subCallId配对，plugin-owned transcript不复制code argument或SVG。
- 独立 DSH typecheck、focused discovery 126/126与scoped diffcheck PASS；QA frozen matrix新增的双call dispose与
  real Code failure证据也由REV-ARD-12闭合。Task 6当前0 open。

### REV-ARD-12 — medium — frozen lifecycle/transcript matrix lacks two required direct races

- 位置：`apps/dsh-univer-work/test/discovery-tools.test.ts` 的Task 6 owner-disposal与Code Mode export rows。
- 依据：Task 6.1要求dispose等待isolated call-owned finalizers且不遗留accepted promise；QA frozen AC37要求两个
  simultaneous accepted calls的dispose/drain隔离。delta secrecy requirement和AC32要求unknown dependency material不进入
  real Code Mode failure settlement。
- 复现：当前owner disposal rows每次只有一个accepted export，不能证明同一次dispose会等待两个独立body且不混合其
  destination/temp/budget。现有Code row只覆盖successful export；URL/header/body/SVG/temp/outside path/cause/credential的failure
  projection只经过Native ToolRuntime，未直接经过real `run_code` settlement。
- 最小修复：复用现有setup与barriers，同时启动两个不同destination/handle的accepted exports，dispose后分别release，断disposal
  等两者且各自cleanup/no cross-state；复用ControlledCodeRuntime与现有throwing/HTTP/open failure之一，断settled fixed code与
  plugin-owned transcript sentinel-negative。不要新增owner或抽象。
- 修复复验：两个accepted exports按black/color URL分别等待独立barrier；释放first并等待其disposing结果后，disposal仍pending、
  second仍未settle，只有释放second后owner drain才完成。两call均无output/temp/cross-state。real Code failure把含signed URL、
  Set-Cookie、SVG body、outside temp path与cause的fetch error投影为canonical per-handle code；approval和plugin-owned
  start/settled/result均sentinel-negative且name/subCallId配对。独立selected 2/2、typecheck与diffcheck PASS。
- 状态：CLOSED。

### REV-ARD-13 — medium — installed Agent assertion contradicts value-only rendering

- 位置：`apps/dsh-univer-work/scripts/smoke-package.mjs` 的installed Agent discovery result assertions。
- 依据：delta closed-result requirement规定render只从validated canonical value派生简短summary；Agent durable
  `tool/result`不承诺复制query或完整value。
- 复现：independent actual package smoke在API find Agent result断`/setValues/`，实际合规render为
  `Found API reference matches for 1 term(s).`，因此gate在discovery Agent调用成功后失败。
- 最小修复：Agent result只断operation-specific count/summary；canonical term已由direct Native与Code result单独断言，
  不修改产品render。
- 修复复验：Agent assertions现在分别核API find/show、registry/find与export的value-only count/summary；direct Native与
  Code仍核完整canonical values。第一次修复后registry regex在outer template中丢失`\d`，改用`[0-9]+`后independent
  actual package smoke完整PASS。
- 状态：CLOSED。

### REV-ARD-14 — medium — process hygiene requires unrelated baseline workers to remain alive

- 位置：`apps/dsh-univer-work/scripts/smoke-package.mjs` 的final installed worker process-set assertion。
- 依据：package cleanup只能证明本次run没有新增surviving worker，不拥有或维持并行run在baseline已有的OS process。
- 复现：independent smoke开始时baseline含PID 29041；该unrelated process在run中自然退出，cleanup后actual为空，strict
  set equality把干净状态误报为failure。
- 最小修复：只断`current - baseline`为空；允许baseline member独立退出，不kill、重建或掩盖原smoke failure。
- 修复复验：cleanup只计算current process set中不属于baseline的新增PID并要求为空；首跑原Agent assertion仍保持FAIL，
  cleanup没有掩盖它。修正Agent assertions后independent smoke正常退出且无新增worker或临时root。
- 状态：CLOSED。

### Task 7 installed package checkpoint

- verifier固定runtime `@univerjs-pro/cli-assets@0.1.0`、bundled dev ownership
  `@univer-cli/{api-reference,resource-library}@1.0.0-beta.2`、五tool reachability与core Skill negative；packed closure不含
  CLI/Core bare import、source/test/scripts、checkout path或额外Skill。document example `file://a.xlsx`仅按无path authority
  精确剥离，fixtures继续拒绝relative、Unix/Windows absolute及`link:` path。
- actual tarball安装到temporary DSH profile并从separate run cwd加载。四个keyless reads在credential record明确为空时
  credential read、approval、fetch均保持baseline；Native、AgentLoop和Code Mode都执行五tool canonical/value-only surfaces。
- approved export通过本地CA信任的loopback TLS server做真实HTTPS handshake；global fetch只把public CDN request路由到该
  controlled origin，不访问公网。server直接观察resource requests的authorization/cookie均为空。Native partial success、
  caller cancellation后的confirmed file/no-later output、与existing transfer并行的owner dispose/drain、normal remount五schemas、
  temp/file/worker/port/profile cleanup均直接通过。
- 独立 `package:verify`、actual `package:smoke`与scoped diffcheck PASS；REV-ARD-13/14均closed。Task 7 package轴当前0 open，
  仍等待docs、CLI/repository/OpenSpec gates与QA final。

### Task 7 documentation and scope checkpoint

- app README将五个tools列为当前Host-owned installed discovery surface，明确四个queries无Workspace grant，resource metadata
  query无network/approval/cache/credential/local output，export才使用HTTPS、approval与Session-cwd-confined atomic publisher。
  32 MiB cumulative、10 MiB per-resource、call-owned no-retention state、policy/local proof、confirmed-file ownership与manual retry
  guidance均与design一致。
- package smoke说明准确写为local TLS/no public fallback、Native/Agent/Code、partial/cancel/owner drain/remount/cleanup；core Skill
  仍只教授remote Workspace workflows，verifier同时拒绝`workspace_api_`/`workspace_resource_`进入Skill。
- root README、AGENTS与DREAMNUM只同步private Client Shell当前tool count/ownership；仍明确Office exchange、render、Web Client和
  generic SVG workflow不属于DSH，CLI/Client Core/Server/HTTP/database/deployment/release职责未改变。
- 独立doc diffcheck PASS；docs/scope当前0 open。

### Task 7 final gate checkpoint

- implement完整矩阵：SDK dependency tests 4/4、repository typecheck/test/build、CLI package与installed smoke、
  OpenSpec strict validate及full diffcheck全部PASS。
- independent checks：SDK dependency tests 4/4、CLI typecheck、DSH typecheck、focused discovery 126/126、DSH full
  7 files/391 tests、package verify、actual tarball smoke及scoped/full diffcheck全部PASS。
- change没有修改Client Core/CLI command/Skill、Workspace Server/OpenAPI/database/deployment/release行为；唯一repository
  compatibility改动是把独立版本的`@univerjs-pro/cli-assets@0.1.0`加入现有SDK updater allowlist并以preservation test固定。
- final gates当前0 open；QA final与Task 7 checkbox均已完成。

## Final result

PASS。REV-ARD-01–14均已关闭，当前0 open findings。独立QA 45/45 AC通过，OpenSpec 7/7 tasks为
`all_done`；actual tarball、controlled HTTPS、Native/Agent/Code、package/CLI compatibility、repository
typecheck/test/build、OpenSpec strict validate与最终`git diff --check`均通过。实现符合change artifacts、仓库边界、
DeepSeek Harness rc.2 trust boundary与Ponytail full要求。
