# add-dsh-office-exchange-tools review

状态：PASS（0 open findings）

本报告只审查 OpenSpec change `add-dsh-office-exchange-tools` 及其直接触及的 Client Core Office、
DSH Client Shell、package closure、CLI compatibility 与责任文档。review agent 不修改产品代码、测试或 tasks。

## 固定依据

- `openspec/changes/add-dsh-office-exchange-tools/{proposal.md,design.md,tasks.md}` 与两份 delta specs
- 根/目标 `AGENTS.md`、README、`apps/workspace/CONTEXT.md` 与 ADR 0007
- Client Core 现有 `office-exchange`、`files`、`content-runtime`、Worktree Unit create/target seams
- Workspace CLI 现有 Office command、daemon payload、package/native binding contract
- DeepSeek Harness `0.1.1-rc.2` 的 ToolRuntime、approval、filesystem policy、cancellation 与 lifecycle seams

shared dirty worktree没有可单独解析的Office feature commit fixed point；审查以change artifacts为Spec固定点，按本change
新增/修改路径持续复核实现diff。Standards轴同时应用仓库规则、Fowler smell baseline与Ponytail full。

## Review checklist

| 轴 | 必须取得的直接证据 | 状态 |
| --- | --- | --- |
| Core compatibility | optional controls不改变CLI no-controls的direct `importFile`/`exportToFile`、validation order、overwrite、result/error或daemon payload | PASS（Task 1） |
| Core cancellation | pre-abort zero work；source/runtime supported cancellation；native conversion仅await后观察，不宣称cooperative abort；取消后无next step | PASS（Task 1 seams；Task 2–3补完整native/source evidence） |
| Controlled import | `inspectSource`→`openSource`实际bytes/size contract/cleanup；bounded `importBuffer`；name-adjusted UnitData byte/depth gate；same identity create signal | PASS（Task 2 Core） |
| Import uncertainty | confirmed与`workspace-result-unknown`/mismatch/invalid-response区分；所有dispatch后non-confirmed保留identity/guidance且no replay | PASS（Task 2 Core；Task 6补Shell guidance/dominance） |
| Controlled export | target只解析一次；runtime精确selected revision；UnitData identity/byte/depth；native buffer cap；无content commit | PASS（Task 3 Core） |
| Atomic publication | exact-byte private `0600` same-dir temp、sync、pre-publish cancel；default no-clobber race-safe；force only explicit；failure保留prior target | PASS（Task 3 Core） |
| Closed tools | 两个root-closed schemas、exact own/data properties、suffix/type/boolean、512 KiB canonical args；完整canonical outputs before render | PASS（Tasks 4–5） |
| Approval/path gate | import pure validator→one ask→local/cwd/regular source；export policy→local→args/path→one ask；body重新证明provider/policy/root/path | PASS（Task 4） |
| Security/secrecy | exact constructor/code allowlists；converter code reduced；credential/cookie/license/UnitData/bytes/temp/path/cause/raw args不进入plugin-owned surfaces | PASS（Tasks 6–7） |
| Lifecycle | shared owner、fused signals、accepted-body tracking；dispose unregister/abort/await native/runtime/create/file cleanup；零retry/job/timer/temp | PASS（Tasks 6–7） |
| Native/worker package | exact owner-declared exchange binding、emitted worker closure、无bare Core/CLI/checkout/source fallback；actual tarball real XLSX | PASS（Task 7） |
| Native/Code Mode | canonical value与paired events；仅DSH-owned argument records保留caller args；late confirmed ABORTED guidance正确 | PASS（Tasks 6–7） |
| Compatibility/scope | CLI commands/results/daemon/package/native smoke不漂移；Server/OpenAPI/DB/SDK baseline/release/deployment不变 | PASS（Task 8） |
| Standards/Ponytail | 复用现有 Office/files/runtime/owner/policy helpers；不新增converter service、path adapter、pool、daemon或speculative abstraction | PASS（Tasks 1–8） |

## Findings

Findings 使用 `REV-OFFICE-xxx`，记录 severity、位置、Spec/standard依据、复现、最小修复和独立复验状态。

当前0 open findings。

### REV-OFFICE-005 — low — root ownership entry omits the delivered Office tools

- 位置：`AGENTS.md:31-37` 的 `apps/dsh-univer-work` ownership条目。
- 依据：Task 8 current-fact文档收口与根文档维护规则要求仓库职责一致；同一文件总览以及root README、DREAMNUM均已把
  two Office exchange tools列为当前能力。
- 复现：ownership条目逐项枚举auth、Space/Node、Worktree/Unit、Skill、file transfer、content与five discovery tools，仍停留
  在本Change前范围，没有Office；读者会在同一权威指南中得到不一致的Client Shell责任边界。
- 最小修复：只在该ownership条目加入“两个Office exchange tools”，不复制实现细节或扩展future scope。
- 修复复验：ownership条目在five API/resource discovery tools后加入exact“两个Office exchange tools”；同文件总览、
  root README与DREAMNUM的current fact现在一致，render/Web exclusion与future-change边界未改变。docs-scoped
  `git diff --check`PASS。
- 状态：CLOSED。

### REV-OFFICE-004 — high — import output validation accepts a different inferred type or explicit name

- 位置：`apps/dsh-univer-work/src/office-tools.ts:259-275`，Task 5 canonical-result tests。
- 依据：Office design Decision 1及delta的successful import/name scenarios要求Excel在未显式指定type时默认Sheet，显式
  `name`必须保留；canonical output必须在render/Native/Code前固定Core已经确认的同一outcome，不能只验证宽泛format compatibility。
- 复现：对`.xlsx`且未传`type`的调用，当前`compatibleImport()`同时接受`sheet`和`base`，因此伪造/漂移的Core
  `{type:"base"}`结果会通过；传`name:"Expected"`时，任意非空`record.name`也通过并进入render。真实Core当前会推导Sheet并
  校验create name，但DSH边界自己的validator无法证明这个semantic identity，fake/回归composition即可把错误值暴露给模型。
- 最小修复：在本模块用现有suffix规则计算exact expected import type（Excel为`args.type ?? "sheet"`，Doc/Slide固定），并在
  `args.name !== undefined`时要求`record.name === args.name`；保留无显式name时由Core选择converted/title/fallback。增加real
  ToolRuntime rows使wrong default type和wrong explicit name均返回`workspace-invalid-tool-result`（或当前冻结的invalid-result
  code）、render不运行；同时保留Excel explicit Base成功。不要复制Core workflow或新增result abstraction。
- 修复复验：validator以`args.type ?? inferredImportType(source_path)`固定exact result type，并只在caller显式name时要求
  exact name；无显式name仍接受Core的converted/title/fallback结果。real ToolRuntime测试分别证明Excel wrong default Base与
  wrong explicit name均变成固定safe failure且sentinel不进入result/render，explicit Base+name成功保留完整canonical value。
  独立focused Office 39/39 PASS。
- 状态：CLOSED。

### REV-OFFICE-003 — high — export pre-execute converts invalid arguments into a generic Office failure

- 位置：`apps/dsh-univer-work/src/office-tools.ts:191-207`，export Native/Code invalid-argument policy tests。
- 依据：DSH rc.2先运行`tools/pre-execute`，后运行definition/body validator；Office closed-argument requirement要求wrong
  key/type/blank/suffix/512 KiB在ask/body/path/credential/runtime前固定`workspace-argument-invalid`。export的policy/path
  wrapper只能sanitize file-effect failure，不能覆盖本模块自己已验证的argument failure。
- 复现：bare/current LocalFS下`validateWorkspaceOfficeExportArgs()`在line195抛exact `OfficeToolError`，line205 catch后
  `projectWorkspaceFileEffectFailure()`返回undefined，line206把它替换成`workspace-office-operation-failed`。因此real
  ToolRuntime永远到不了`closeWorkspaceTool`的第二个validator，也不会返回规定code。
- 最小修复：catch中先`if (error instanceof OfficeToolError) throw error`，再保持现有file-effect projector/generic fallback。
  增加real ToolRuntime table覆盖unknown key、wrong force、blank、bad suffix、oversize，断exact argument code、0 ask/body/
  `processPath`/credential/runtime；Code Mode至少一行同code和零approval。不要新增error adapter。
- 修复复验：export pre-execute catch先保留exact `OfficeToolError`，再投影file-effect failure。Native invalid table
  直接断unknown/type/blank/suffix/oversize均argument-invalid且resolve/stat/contains/processPath/Core/approval为0；real
  Code Mode start/settled配对并保留同一fixed failure、零approval/body。独立DSH typecheck、focused office/file-transfer
  72/72与scoped diffcheck PASS。
- 状态：CLOSED。

### REV-OFFICE-002 — high — controlled export leaks the content-runtime limit code

- 位置：`packages/client-core/src/office-exchange.ts:204-216` 与
  `packages/client-core/src/content-runtime.ts:470-481`；controlled export budget tests。
- 依据：design Decision 2及Office delta的fixed budgets要求所有Office UnitData byte/depth limit以
  `workspace-office-limit-exceeded`和`{kind,limit,actual?}`失败。generic content runtime可以继续拥有
  `workspace-content-limit-exceeded`，但Office public workflow必须投影自己的稳定合同。
- 复现：真实runtime在line 215测量完UnitData后先抛`workspace-content-limit-exceeded`；Office line 216的
  `validateOfficeUnitData()`永远不会执行。当前Office tests使用fake runtime直接返回小UnitData，只覆盖native output limit，
  没覆盖真实runtime oversize/depth error，因此错误码漂移保持green。
- 最小修复：在Office `exportFile`的唯一runtime await周围，只按exact `WorkspaceApplicationError` constructor、code及closed
  `export-unit-data-{bytes,depth}`detail把该错误映射为Office `unit-data-{bytes,depth}`limit；其他content/runtime/unknown error
  原样留给后续safe adapter。增加bytes/depth两行真实constructor或真实runtime回归，断native/output 0。不要修改generic
  runtime error code或加入通用mapper。
- 修复复验：Office只接受exact `WorkspaceApplicationError` prototype、exact content limit code及closed
  `{actual,kind,limit}`data properties，把两个runtime kind映射成Office kind；其他error原样。bytes/depth rows均在
  native/output前返回Office limit且零later side effect。独立Core typecheck、focused office/files/content-runtime
  184/184、CLI focused 3/3及scoped diffcheck PASS。
- 状态：CLOSED。

### REV-OFFICE-001 — medium — controlled import reads beyond the frozen source ceiling

- 位置：`packages/client-core/src/office-exchange.ts:234-240,263-270`，controlled source budget tests。
- 依据：Task 2.1 与 Core delta要求受控import把实际source bytes最多收集到`maxSourceBytes + 1`；已检查的
  `SourceFile.byteSize`超过上限时也应在`openSource`/native/create前停止。预算的作用是限制进入应用的本地字节工作，
  不能只把最终error detail截成`limit + 1`。
- 复现：`source.byteSize = limit + 1`时当前代码仍调用`openSource`并读取到overflow；更一般地，iterator单次返回
  `limit + N`的chunk时，line 266先计入整个chunk，line 268只把报告的`actual`截为`limit + 1`，实际已从iterator接收
  全chunk。现有test只让首chunk恰好等于5、limit为4，因此不能发现overshoot。
- 最小修复：inspection后若`source.byteSize > maxSourceBytes`立即返回Office source limit且`openSource=0`；stream分支
  对每个chunk只接受到remaining+1的prefix后立刻关闭iterator并失败，不保留或复制其余bytes。增加oversized inspected
  source zero-open与large single-chunk exact`limit+1` observed/cleanup用例；保留growth/truncation/same-length ceiling。
- 修复复验：inspection后先比较`source.byteSize`与limit，oversize直接fixed limit且`openSource=0`；stream按
  `remaining + 1`只计到sentinel，立即`iterator.return()`，不读取下一chunk。新增10-byte inspected/limit4 zero-open与
  1 MiB single-chunk/limit4 rows均返回`actual:5`、关闭iterator、零native/create。独立Core typecheck、focused
  office/content-runtime 150/150、CLI focused 3/3与scoped diffcheck PASS。
- 状态：CLOSED。

### Task 1 Core controls checkpoint

- `importFile(input, controls?)`与`exportFile(input, controls?)`只追加optional operation object；dependency ports只追加
  optional signal。CLI composition仍以单参数调用，Core no-controls分支继续把原path交给published `importFile`/
  `exportToFile`，converter options、name precedence、result identity与overwrite行为未变。
- daemon adapter即使接收到runtime signal/bytes/depth，也只发送原`code/target`或`target`payload；CLI command tests直接断
  Office import/export调用只有原input object。没有DSH control进入CLI wire或JSON output。
- runtime `exportUnitData`在queue、credential/license resolver、acquire、state、pull和export各await边界检查signal，并把
  byte/depth预算只用于返回前的descriptor-safe canonical JSON验证；selected revision仍由现有`synchronize` exact equality
  固定。already-aborted与mid-step tests证明取消后不启动下一step，lease正常release/invalidate。
- 独立Core typecheck、focused office/content-runtime 123/123、CLI focused 3/3与scoped diffcheck均PASS。Task 1轴当前
  0 open；controlled `importBuffer` source branch与atomic `exportToBuffer` branch按Tasks 2–3继续审查。

### Task 2 controlled import checkpoint

- controlled branch只在operation object存在时使用`inspectSource`/`openSource`和published `importBuffer`；no-controls
  继续走原path converter。全部大小写suffix/type/options及original filename保持现有矩阵。
- inspected oversize、stream growth/truncation、limit+1、single large chunk、same-length replacement ceiling、caller
  cancellation与iterator cleanup均有直接证据；native conversion不可中断，Core await settlement后观察signal且不启动create。
- converter output先以descriptor-safe canonical validator拒绝accessor/non-lossless value，再应用explicit name，并对最终
  UnitData执行bytes/depth gate。create获得同一signal/idempotency identity；confirmed result可见，三种post-dispatch
  non-confirmed error都只调用一次source/converter/create，不在Core replay。
- REV-OFFICE-001关闭；Task 2 Core轴当前0 open。Shell error projection、late caller/owner presentation与inspect/no-replay
  guidance留给Task 6验证。

### Task 3 controlled export checkpoint

- controlled export只解析一次authoritative Worktree target，把同一object和signal/bytes/depth预算交给runtime；existing
  runtime`synchronize`要求pulled base revision与selected revision exact equality。head mismatch不重解析、不native、不output。
- UnitData先经过runtime canonical budget，再由Office descriptor-safe复验和exact target Unit identity；Board、format mismatch、
  wrong/non-object UnitData都在native前失败，Office不调用commit seam。
- atomic branch只使用published `exportToBuffer`与共享exact-byte publisher；四类型保留原format/formula options。native不可
  中断，Core await后观察signal；output cap在创建temp前执行。共享publisher用same-dir `0600` temp、sync、default hard-link
  no-clobber race、explicit force rename、non-cancellable discard；prior target与racing winner均保留，late confirmed publication可见。
- no-controls仍调用原`exportToFile` direct path。REV-OFFICE-002关闭；Task 3 Core轴当前0 open。

### Task 4 closed tools and file gate checkpoint

- 两个definitions均经既有`closeWorkspaceTool`形成root `additionalProperties:false`；descriptor-safe validators只复制
  exact snake_case primitives，固定suffix/type/force语义，并按fresh canonical object计算exact 512 KiB。invalid Native/
  Code rows在approval/path/body前固定argument-invalid。
- import policy先pure validate并固定ask，approval前filesystem resolve/stat/contains/processPath均为0；accepted body重新验证后
  只接受public LocalFS/subclass、Session cwd内regular source，最后才`processPath`和Core。read-only不阻断approved remote create。
- export在preflight与body都按current policy→public local proof→canonical args/path→Session cwd及workspace-root containment；
  preflight只ask一次且不Core，body重新解析后才`processPath`。read-only、workspace-write dual root、danger cwd、nonlocal、
  no-cwd、outside、policy/prototype/symlink drift与四种approval失败均有direct ToolRuntime证据。
- rc.2会在plugin policy前记录/normalize raw caller arguments；tests只承诺direct validator与plugin-owned surfaces不执行/
  复制accessor，不误称DSH-owned argument record可被回收。REV-OFFICE-003关闭；独立focused office/file-transfer
  73/73，implement DSH typecheck与scoped diffcheck PASS。production auth composition按Task 5审查。

### Task 5 production composition and outcomes checkpoint

- production authentication effect只组合public Core `WorkspaceUnitFeature`、`WorkspaceContentSource`、
  `WorkspaceUnitExchangeFeature`和既有`WorkspaceContentRuntimeGenerations`；两个tools继续共享同一`WorkspaceToolOwner`。
  testing option只允许替换既有converter/source/output ports，不能覆盖authenticated create、target resolver或runtime owner。
- direct production-mount vertical用真实Local source reader与authenticated fake Workspace：import的bounded bytes进入strict
  `importBuffer`后只发一次Worktree-local Unit POST，body固定source/Space/parent/type/name/initialData/idempotency；export只读一次
  authoritative Worktree target revision 17，由shared runtime generation导出同一UnitData，strict `exportToBuffer`后原子落盘。
  `executeAndCommit`保持0。
- source matrix覆盖12组legacy/current Office import suffix/type（Excel omitted type exact Sheet，explicit Base可用）与四组
  Sheet/Base/Doc/Slide export；CSV/PDF、legacy output、Board、wrong Unit/output type、head mismatch、no-clobber/force均在规定边界
  收敛。两个result validators要求root exact data properties、Worktree/Unit/path/type identity，REV-OFFICE-004的wrong default
  type与explicit name在render前拒绝。
- 独立auth+office focused 97/97与scoped diffcheck PASS；implement另有typecheck、含file-transfer 149/149 PASS。Task 5
  当前0 open。

### Task 6 errors, cancellation, and lifecycle checkpoint

- Client Core root re-export与Office source使用同一public `ExchangeError` constructor；sanitizer还要求exact prototype及冻结的
  7-code enum membership。recognized native failure只投影`{phase,exchangeCode}`，forged/unlisted error固定generic；shared
  `WorkspaceApplicationError`、runtime/pool constructors也只经closed code set和descriptor-safe detail projector。
- import create的`workspace-result-unknown`、`workspace-result-mismatch`和`workspace-invalid-response`在owner/caller cancellation
  前保留；explicit idempotency key直接来自canonical args，自动UUID只从Core genuine unknown的matching request identity读取，
  mismatch/invalid不伪造Core未提供的key。三者只调用一次source/converter/create并获得Unit-list/Worktree-get/no-replay guidance。
- 其余source、target/runtime、native与private-write取消按owner/caller分别固定disposing/cancelled。Native import/export均等待
  settlement后停止next step；private temp非取消cleanup保留prior destination。caller late confirmed create/publication由rc.2变
  `ABORTED`并给operation-specific inspect guidance；owner-only confirmed success在dispose drain中可见。
- concurrent accepted import/export证明disposal先unregister tool/policy、再等待两个独立body；source iterator、runtime generation、
  native、Unit request与file cleanup全部settle后才完成。listener removal probe与normal remount证明无旧branch/body残留，production
  generation close exactly once；实现未增加Job、timer、retry、第二owner或第二runtime pool。
- real Native/Code failures和credential/cookie/license/UnitData/Office bytes/temp/native cause/rejected-arg sentinels均不进入
  plugin-owned result/approval/event/log；只有DSH-owned argument records保留caller args。独立4-file focused 199/199、Core/DSH
  typecheck、Core build及scoped diffcheck PASS。Task 6当前0 open。

### Task 7 native, worker, and installed package checkpoint

- package assembly从Client Core安装图解析exact `@univerjs-pro/exchange-node@1.0.0-beta.2`，再从该owner manifest解析
  `@univerjs-pro/exchange-node-binding@0.1.0`；app manifest只声明owner要求的binding，不把exchange JavaScript变成安装时
  dependency。Core public re-export、owner public ESM export的`ExchangeError`/`ExchangeErrorCode` identity有直接断言。
- Vite只externalize两个native bindings，reachable Client Core与exchange JavaScript继续内联；现有worker entry、runtime pool
  chunk与colocated `worker-child.mjs`保持同一闭包。verifier遍历全部emitted JS import closure，拒绝bare private Core、
  `workspace:*`、CLI source/daemon/Session、absolute/adjacent checkout路径、source/test/script与later resources；manifest没有
  install-time scripts。
- 隔离tarball smoke从unrelated cwd加载installed package和真实platform binding，以真实worker UnitData导出非空XLSX，再由
  published native import读回同一A1值并只创建一次Worktree-local Unit。strict Doc/Slide fixtures在create前safe-fail；source
  cap、exact revision race、default no-clobber/explicit force、`0600`与temp cleanup均在安装态直接断言。
- installed real ToolRuntime覆盖single approval/policy、三种post-dispatch non-confirmed create各exact one request/no replay、caller
  unknown cancellation、owner disposal drain且confirmed create可见；real Agent和Code Mode均执行Office export，检查canonical
  result、paired dispatch、approval与sentinel-negative transcript。normal remount恢复exact两tools。
- 独立运行`package:verify`PASS（1498 modules与actual packed file/graph scan），`package:smoke`PASS（Host
  `127.0.0.1:64291`正常启动并正常退出）。复核端口关闭，未发现本次installed smoke、run script或worker-child残留；scoped
  `git diff --check`PASS。Task 7当前0 open。

### Task 8 documentation and compatibility checkpoint

- DSH README记录exact两个tool names与import/export格式；明确CSV、Board、legacy output、replacement、Trunk export、caller
  revision/type不支持。它分别描述Worktree-local create与once-selected authoritative Worktree head export，并固定actual source/
  UnitData/output 52,428,800-byte、depth 64、one approval、local policy/Session cwd、`0600` atomic no-clobber/explicit force边界。
- cancellation文档没有把native conversion误写成cooperative abort：tool等待不可中断conversion settle，只在下一separable step前观察
  signal。三种dispatched import non-confirmed outcome均要求Unit list/Worktree get inspection并禁止自动conversion/create replay；
  late export要求destination inspection。render、Web、remote FS、daemon/CLI state等非职责仍保留。
- Client Core README把controls写成向后兼容optional branch，说明controlled import/export budgets、exact selected revision与atomic
  publication；同时固定无controls consumer继续direct `importFile`/`exportToFile`，并把Session cwd、file policy、approval、credential/
  license storage、native package entry与tool render/finalizer留给Client Shell。
- root README、AGENTS与DREAMNUM均把两个Office tools写成private DSH current fact，只保留render/Web exclusion。REV-OFFICE-005
  修复后，AGENTS的总览与app ownership条目也一致；没有把private Client Shell写成第三个公开应用或新增release contract。
- 完整diff审查确认CLI product source、Server/OpenAPI/database、release/deployment文件没有Office实现变更；CLI只有no-controls
  compatibility evidence。实现仍直接复用现有Core Office/files/runtime、DSH owner/policy/finalizer，不增加converter registry、path
  adapter、runtime pool、daemon、Job、retry或future capability。
- implement冻结全门禁报告为Core typecheck/test 563/build、DSH typecheck/test 483/build/package verify/smoke、CLI full 69/
  package-artifact 13/`package:workspace-cli`与installed smoke、root typecheck/test/build、OpenSpec strict/status和diffcheck均PASS。
  reviewer独立复跑Core 563/563、DSH Office/auth/file/generation 199/199、CLI build/package-artifact 13/13及14 files/69、
  SDK-baseline 4/4、OpenSpec strict/status与full diffcheck，全部PASS；Task 7的actual tarball verify/smoke也由reviewer独立PASS。
  Task 8当前0 open。

## Final result

**PASS — 0 open findings.** REV-OFFICE-001至REV-OFFICE-005均已修复并独立复验关闭。实现符合proposal、
design、两份delta specs、domain ownership、DSH rc.2安全/lifecycle边界、CLI no-controls compatibility与installed
package closure；本review不替代独立QA或archive授权。
