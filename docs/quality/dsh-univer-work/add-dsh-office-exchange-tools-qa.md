# add-dsh-office-exchange-tools QA

本报告是 OpenSpec Change `add-dsh-office-exchange-tools` 的独立验收记录。QA 只更新本文件，不修改产品代码、
产品测试、OpenSpec tasks、review，不 commit、push 或 archive。

## 环境与边界

- 冻结基线：Workspace commit `a01adf28bfdfbf098ecf66653d520d08ecac4117`、SDK `1.0.0-beta.2`、
  DSH `0.1.1-rc.2` / `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`。
- Client Core 继续拥有 Office suffix/type/name、Worktree-local Unit create、exact Worktree target/revision 与
  `@univerjs-pro/exchange-node` workflow；DSH Client Shell 只组合 local path/policy/approval/lifecycle/package。
- Office source/output 是 calling Agent Session cwd 内的 Host-local file，不是 Workspace `Resource` 或权威内容身份；
  import 创建 Worktree-local Unit，export 读取一次选定的 Worktree Unit head，不执行 content commit。
- 实际 installed QA 使用 actual tarball、unrelated cwd、无真实账号/model key、fake Workspace/Collaboration、真实
  ToolRuntime/Agent/Code Mode 与平台 native binding；只创建 QA-owned files/profile/process并在结束后清理。
- credential、cookie、license、UnitData、Office bytes、temporary path、native cause/stack、rejected raw args 与完整
  transcript 不写入报告。

## 编号验收标准

### Client Core optional controls 与 CLI compatibility

- **AC-01** CLI 省略 operation controls 时，suffix/type/name、validation order、direct `importFile`/`exportToFile`、
  overwrite、Unit create/target/runtime input、result/error、command output、daemon payload与installed package保持原行为。
- **AC-02** DSH提供signal/budgets/atomic controls时，Core只在现有authoritative workflow周围应用这些optional controls，
  不引入DSH type/service或第二套Office owner。
- **AC-03** controlled import在source inspection或native前取消时，conversion/create均为0。
- **AC-04** actual source达到caller max+1时停止收集、关闭source，并在`importBuffer`/native/create前以stable limit失败。
- **AC-05** stream相对inspection增长、截断或达到max+1时关闭并在`importBuffer`前按byte-count/limit合同失败。
- **AC-06** same-length path/symlink replacement仍受actual stream预算约束，但明确不承诺cross-process identity detection。
- **AC-07** source read中取消会停止并关闭reader，零native/create且不返回partial buffer。
- **AC-08** native import中取消时Core等待不可中断conversion，settle后观察取消并不开始create。
- **AC-09** explicit-name应用后的converted UnitData超过caller bytes/depth时，在create前失败且不截断。
- **AC-10** create可能已dispatch且无法确认时，保留existing same-identity recovery/result-unknown，无额外create或conversion replay。
- **AC-11** dispatched create返回mismatch/invalid response时保留原non-confirmed failure和safe identity，不claim confirmed/rollback，
  不自动reconvert/recreate。
- **AC-12** create在并发取消前已确认时Core可返回existing committed result，由Client Shell负责最终caller-cancel presentation。
- **AC-13** export target/runtime read中取消时，active work观察signal，零native/output且无partial UnitData。
- **AC-14** target只解析一次；head在exact sync前推进时以`workspace-result-mismatch`失败，不重解析新head，零UnitData/native/output。
- **AC-15** runtime base revision精确等于once-selected revision后，才为该authoritative target导出UnitData。
- **AC-16** exported UnitData超过caller bytes/depth预算时，在native/output前失败。
- **AC-17** native export中取消时Core等待conversion，settle后不开始atomic write并丢弃buffer。
- **AC-18** native Office output超过caller预算时，不创建或替换destination。
- **AC-19** no-clobber成功使用same-dir private temp，exact write、sync、atomic publish后才返回existing result。
- **AC-20** explicit force只在完整conversion/write/sync后atomic replace，所有更早失败保留prior destination。
- **AC-21** publication前取消执行non-cancellable close/unlink，保留prior destination并不返回confirmed output。
- **AC-22** publication已确认后并发取消时Core可返回existing confirmed result，由Client Shell负责最终presentation。

### DSH surface、formats 与 authoritative outcomes

- **AC-23** import支持exact `.xls/.xlsx`→Sheet/default或explicit Base、`.doc/.docx`→Doc、
  `.ppt/.pptx/.pptm/.ppsx/.ppsm/.potx`→Slide，并保留既有converter options与大小写行为。
- **AC-24** export仅支持Sheet/Base→`.xlsx`、Doc→`.docx`、Slide→`.pptx`，保留formula calculation规则。
- **AC-25** Board、CSV/PDF/ODF、unsupported import、legacy export、incompatible explicit type/output在create/final publish前
  返回applicable stable format/type error。
- **AC-26** replacement/existing Unit/Resource、Trunk scope、caller revision或其他undeclared selector由closed boundary拒绝。
- **AC-27** valid import只在Core确认Worktree-local Unit、Node、Resource、type/name/Worktree/target后返回existing committed fields。
- **AC-28** 无explicit nonblank name时按converted name→title→`Imported <type>`选择，不增加DSH naming rule。
- **AC-29** invalid source/native conversion在create前失败，无remote effect/partial success。
- **AC-30** create无法确认时保留`workspace-result-unknown`与safe stable identity、零shell retry/reconversion。
- **AC-31** dispatched create mismatch/invalid response保留原safe code和fixed Worktree Unit/Space inspect guidance，
  不claim confirmation/rollback，不reread/reconvert/recreate。
- **AC-32** valid export在exact UnitData identity、conversion与atomic publication确认后才返回existing path/Worktree/Unit/type fields。
- **AC-33** runtime返回non-object或wrong Unit id时以`workspace-exchange-unit-data-invalid`在native/output前失败。
- **AC-34** target后head推进在UnitData/native/output前mismatch，不silent re-resolve或声称导出旧revision。
- **AC-35** exact sync确认selected revision后，只读取/转换该target且零Workspace content mutation/commit。

### Local path、policy、closed values 与 budgets

- **AC-36** approved import只接受exact public `LocalFileSystem`或in-process local subclass，source在Session cwd内且regular；
  通过Change 5 stream收集actual bytes后才调用published `importBuffer`。
- **AC-37** non-local/unrelated FS、missing cwd或source escape在`processPath`/conversion/credential/create/buffering前失败。
- **AC-38** export `read-only`在provider/argument/path/ask/body/credential/runtime/converter/Host I/O前以policy denied零effect。
- **AC-39** export `workspace-write`的preflight/body分别要求canonical output同时位于current root与Session cwd，二者不共享state。
- **AC-40** approval期间policy narrowing/provider replacement/path或symlink escape导致body在`processPath`/credential/runtime/native/output前失败，
  且无第二ask。
- **AC-41** Native/Code catalog恰增两个root-closed tools、exact snake_case/enums，无origin/credential/cookie/bytes/URL/command/
  arbitrary JSON/action/revision/unsupported selector。
- **AC-42** unknown/wrong/blank/incompatible args或canonical args >524,288 bytes在ask/path/body/credential/runtime/native/effect前失败，
  plugin-owned content不复制rejected value。
- **AC-43** actual source 52,428,801 bytes或converted UnitData >52,428,800 bytes/depth64，以
  `workspace-office-limit-exceeded`在native/create前失败且不截断。
- **AC-44** preflight后source增长、截断或达52,428,801时关闭stream并在`importBuffer`前失败。
- **AC-45** same-length replacement只承诺actual stream bound，不虚构`openat`/directory-handle identity fence。
- **AC-46** export UnitData >52,428,800 bytes/depth64或native output >52,428,800 bytes，在native/publish前分别失败并清理private state。
- **AC-47** missing/broadened/non-JSON/wrong-identity canonical body result在render/Code value前拒绝。
- **AC-48** success render只派生自validated canonical value，完整lossless value进入Native/Code Mode。

### Approval、atomic output 与 errors

- **AC-49** valid import pure validation后只ask一次，approval前零path inspection/credential/conversion/create。
- **AC-50** valid export按current policy→public local identity→pure args→canonical output containment后只ask一次，approval前零
  `processPath`/credential/runtime/native/output。
- **AC-51** rejected/cancelled/unavailable/no channel fail closed，零body/native/create/publication。
- **AC-52** hostile caller args只允许存在于DSH-owned Native/Code argument records；approval/result/failure/metadata/plugin context/log零sentinel。
- **AC-53** absent destination在bounded conversion后写`0600` same-dir temp、完整write/sync并atomic publish。
- **AC-54** existing或racing destination且无force时以`workspace-office-output-exists`失败，prior bytes不变、temp清理。
- **AC-55** approved `force:true`只在complete conversion/budget/write/sync/cancel checks后atomic replace。
- **AC-56** conversion/write/sync/size/publication failure执行non-cancellable close/unlink，prior target不变且不自动retry conversion。
- **AC-57** frozen shared/Office allowlist保留stable code、fixed text和exact safe identity/state/count/contained-path detail。
- **AC-58** known `ExchangeErrorCode`只映射`workspace-office-conversion-failed`与`{phase,exchangeCode}`，不含original material。
- **AC-59** credential/cookie/license/UnitData/Office bytes/temp/rejected arg/dependency path出现在任何unsafe failure时零反射；
  unlisted failure固定`workspace-office-operation-failed`。

### Cancellation、lifecycle 与 installed closure

- **AC-60** already-aborted real ToolRuntime返回`ABORTED_BEFORE_DISPATCH`，零body/path/credential/runtime/native/effect。
- **AC-61** caller/owner在native import中取消：await conversion、零create/partial，按caller/owner分类。
- **AC-62** bounded source read中取消：stream stop/close，零`importBuffer`/create，source bytes不进入content/log。
- **AC-63** create dispatch后`workspace-result-unknown`跨caller/owner cancellation保留tool-owned failure+inspect guidance，零replay。
- **AC-64** create dispatch后mismatch/invalid跨cancellation保留tool-owned failure+inspect guidance，零reread/reconvert/recreate。
- **AC-65** export在target/runtime/native/private write至publish前取消时，零later step、temp清理、prior target不变。
- **AC-66** caller cancellation撞confirmed create/publication时DSH rc.2返回canonical `ABORTED`，fixed guidance要求inspect后才manual retry。
- **AC-67** owner-only取消撞confirmed create/publication可在drain中返回success；unconfirmed create保持原safe failure/guidance。
- **AC-68** dispose在approval/path/runtime/native/create/write/cleanup任一点停止admission、注销2 tools/policy branches、abort supported
  work、await uninterruptible/native/body/runtime/file cleanup，零request/worker/temp/listener/timer/Job/retry。
- **AC-69** packed artifact内联reachable private Core/converter JS，复用worker/runtime child，交付installed exchange-node owner声明的exact
  platform binding；无bare Core、`workspace:*`、CLI source/daemon/Session、checkout fallback、remote FS/Web/later capability。
- **AC-70** isolated actual tarball从unrelated cwd以real ToolRuntime/native XLSX round trip+strict Doc/Slide fixtures覆盖两tools、policy/
  approval/budgets/exact revision、unknown/mismatch/invalid no replay、atomic/no-clobber/force、caller/owner abort、secrecy、dispose/cleanup；
  不需要model key、真实Workspace账号或adjacent checkout。

验收项总数：**70**。

## 测试矩阵

| Task / 规格组 | 必要直接证据 |
| --- | --- |
| Task 1 Core optional controls | 新optional signatures/ports；signal与UnitData budget forwarding；pre-abort zero-next-step；CLI no-controls direct adapter、daemon payload/result/error/overwrite unchanged |
| Task 2 bounded import | exact suffix/type/options/name；inspect→open actual-byte max+1；growth/truncate/oversize/same-length ceiling；read/native cancel；UnitData bytes/depth；create confirmed/unknown/mismatch/invalid no replay |
| Task 3 exact-revision atomic export | one target；exact sync/head advance；UnitData identity/budget；native cancel/output budget；Sheet/Base/Doc/Slide；Board/format；0600 temp/sync/no-clobber/race/force/cleanup/late confirm；CLI direct export unchanged |
| Task 4 DSH effect gate | two closed schemas/512 KiB；Native/Code；import ask-before-path；export policy→local→args→path→ask；read-only/nonlocal/outside/no-cwd/dual-root/danger；drift；four approval failures；one ask |
| Task 5 outcome composition | strict fake Workspace/runtime/converters；all real formats；authoritative Worktree-local create；exact head/no commit；canonical output before render；atomic outcomes |
| Task 6 error/cancel/lifecycle | exact Office allowlist（format/type/UnitData/limit/output）与既有auth/HTTP/Worktree/Unit/file/runtime codes；real `ExchangeErrorCode`七成员×import/export phase→fixed conversion failure；unlisted/forged→generic；credential/cookie/license/UnitData/Office bytes/temp/native cause/rejected-arg/dependency-path sentinel-negative；caller/owner pre-body、source read、native import/export、target/runtime、create、private write/cleanup settlement；`workspace-result-unknown`/`workspace-result-mismatch`/`workspace-invalid-response` dispatch后各自code+inspect guidance+exactly-once/no replay；caller late confirmed create/publication→canonical `ABORTED`+inspect-before-retry，owner-only confirmed success；approval/path/runtime/native/create/write/cleanup disposal、concurrent body drain、2 tools与policy listener unregister、remount无stale branch、零request/worker/temp/listener/timer/Job/retry |
| Task 7 installed artifact | build/emitted Host含两Office tools且无bare private Core、`workspace:*`、CLI source/daemon/Session、absolute/adjacent-checkout fallback、remote FS/Web/later resources；从installed Client Core graph解析exact `exchange-node@1.0.0-beta.2` owner及其exact `exchange-node-binding`版本，packed manifest只保留允许external dependencies，worker entry/`worker-child.mjs`/native `.node`均可达；actual tarball安装到isolated profile并从unrelated cwd启动，零model key/真实credential/account/公网/checkout；real ToolRuntime catalog+Native Agent+Code Mode执行两tools；real native XLSX import/create→authoritative fake Workspace identity→exact-revision runtime export→XLSX round trip，strict Doc/Slide wiring；actual-source/UnitData/output budgets、policy/one approval、head mismatch/zero commit、unknown/mismatch/invalid exact one create/no conversion replay、atomic `0600`/same-dir temp/no-clobber/force、caller/owner cancellation与confirmed guidance、sentinel-negative；normal dispose关闭runtime/worker/native work并恢复pre-run process/port set，删除profile/run cwd/temp/output，仅保留QA可控证据 |
| Task 8 compatibility/docs | `apps/dsh-univer-work/README.md`必须记录exact两个tool names、import/export格式（明确CSV/Board/legacy output不支持）、Worktree-local create、once-selected Worktree head/exact revision、actual source/UnitData/output 50 MiB与JSON depth64、Host-local exact LocalFS/Session cwd/file policy、每次one approval、zero content commit、atomic `0600`/no-clobber/explicit force、native不可中断但await、caller/owner signal与三个post-dispatch non-confirmed outcome inspect/no-replay，以及remote FS/daemon/Web/Skills等非职责；`packages/client-core/README.md`必须记录Shell-neutral optional controls、controlled import/export budgets/exact revision/atomic publication、CLI no-controls direct `importFile`/`exportToFile` compatibility与Core不拥有Session cwd/policy/approval/credential/native package entry。仓库入口不得保留与已交付Office能力相反的current-capability陈述。门禁固定为Core `typecheck`/full `test`/`build`；DSH `typecheck`/full `test`/`build`/`package:verify`/actual-tarball `package:smoke`；CLI focused `workspace-unit-exchange.test.ts application-command-contracts.test.ts`与`pnpm package:workspace-cli`（含actual package合同）；root `pnpm typecheck`/`pnpm test`/`pnpm build`；`git diff --check`；OpenSpec strict/status 8/8；检查SDK cohort、Server/OpenAPI、release/deployment文件无Office change，并在smoke/全量门禁结束后确认QA-owned profile/run/temp、worker-child/Host/port零残留。 |

## Issues

发现问题立即发送 `/root/space_node_implement` 与 `/root`；修复后复跑原repro、相邻security/race case与最小回归gate。

| ID | Severity | Evidence | Expected | Repro | Status |
| --- | --- | --- | --- | --- | --- |
| REV-OFFICE-001 | High | Task 2 controlled import在`inspectSource`已知`byteSize > maxSourceBytes`时仍调用`openSource`；consumer对单个oversized chunk只在完整`iterator.next()`返回后判断并把detail clamp到max+1，因此没有严格证明actual source read/collection止于limit+1。 | inspected oversize应在open前以`workspace-office-limit-exceeded` zero-open；stream consumer对任意chunk shape只保留/计入至max+1并立即return/close，不请求或收集超出预算的bytes。 | 注入`inspectSource.byteSize=max+1`并记录open调用；另让首个yield远大于max+1，记录producer/consumer observed byte count、next/return、retained bytes与error detail。 | **RESOLVED**：known inspected oversize现在open/import/create均0；1 MiB first chunk只account `max+1`、不请求second chunk、iterator finally关闭、native/create均0。独立Core typecheck、focused169、CLI3与diffcheck通过。 |
| WT-OFFICE-QA-002 / REV-OFFICE-002 | High | Task 3 controlled export把真实`runtime.exportUnitData`抛出的`workspace-content-limit-exceeded`直接向Office caller传播，暴露了下层Content Runtime错误合同，且不满足冻结的Office fixed limit code/detail。 | bytes/depth预算超限均应在native converter/output前投影为`workspace-office-limit-exceeded`，只保留Office允许的`{kind,limit,actual?}`；一次target resolution、零native、零output。 | 使用真实`WorkspaceContentRuntimeFeature`与selected target分别触发`maxValueBytes`、`maxValueDepth`，通过`WorkspaceUnitExchangeFeature.exportFile`观察公开错误、target/runtime/converter/publisher call counts。 | **RESOLVED**：genuine `createWorkspaceContentRuntime` bytes/depth rows经真实lease export产生Content limit，并投影为exact Office `{actual,kind,limit}`；resolve/acquire/export/release各1，converter/publisher各0。独立Core focused184、CLI3与diffcheck通过。 |
| WT-OFFICE-QA-003 / REV-OFFICE-003 | High | Task 4 export `tools/pre-execute`的catch捕获自身pure validator `OfficeToolError`后，`projectWorkspaceFileEffectFailure`无法识别并降级为`workspace-office-operation-failed`。 | Native与Code Mode的unknown key、wrong primitive、blank、suffix或524,288-byte超限均保留fixed `workspace-argument-invalid`，且approval/body/path/credential/Core为0。 | 通过real ToolRuntime分别向`workspace_office_export`传invalid root-closed参数，记录pre-execute公开code、approval count、resolve/stat/contains/processPath及Office dependency counts；Code Mode同时核paired event。 | **RESOLVED**：pre-execute显式保留plugin-owned `OfficeToolError`；Native invalid table固定`workspace-argument-invalid`且resolve/stat/contains/processPath/approval/Core全0，Code Mode paired start/settled保持同一sub-call与fixed argument failure、零approval/body。独立DSH typecheck、focused73与diffcheck通过。 |
| WT-OFFICE-QA-004 / REV-OFFICE-004 | High | Task 5 canonical import validator在caller省略`type`时不核对suffix推导的authoritative default type，也不核对caller explicit `name`；`.xlsx`返回Base或dependency改写显式name仍可通过并render。 | import success必须在render/Code value前确认result type等于explicit type或suffix default（Excel默认Sheet），且explicit name存在时result name exact相等；失败固定、无成功render。 | real ToolRuntime approved import分别注入`.xlsx` default→Base、explicit name→different name的完整canonical-looking result，断言tool error、成功render/value为0；再用正确Sheet/name正向通过。 | **RESOLVED**：validator现在从source suffix推导省略type时的authoritative default，并对explicit type/name做exact comparison；`.xlsx` default→Base与改写显式name均在render前以fixed failure拒绝且不反射sentinel，explicit Base+exact name正向通过。独立DSH typecheck、authentication/office/file 149 tests与scoped diffcheck通过。 |
| WT-OFFICE-QA-005 | Medium | `apps/dsh-univer-work/README.md`已把`workspace_office_import`/`workspace_office_export`列为当前能力，但根`README.md:161`仍写`Office exchange, rendering, and Web UI are not current capabilities.`；`AGENTS.md:21`与`DREAMNUM.md:25`也仍明确否认DSH Office exchange。 | 仓库入口、约束/事实文档与Client Shell职责文档应对Office当前能力给出同一事实；保留rendering/Web UI与发布渠道非职责，但不得否认已交付的两个Office tools。 | `rg -n -C 2 "Office exchange|not current|不提供 Office" README.md AGENTS.md DREAMNUM.md apps/dsh-univer-work/README.md`，对照Task 8完成后的current surface。 | **RESOLVED**：独立复读确认root README改为two approval-gated Office exchange tools，只保留rendering/Web UI exclusion；AGENTS与DREAMNUM各列two installed Office exchange tools并只保留render/Web Client（及AGENTS发布渠道）非职责。未扩大其他段落，`git diff --check`通过。 |

## 实际执行结果

| 命令/探针 | 结果 |
| --- | --- |
| planning/context review | **PASS**：已完整读取root/target README与AGENTS、Workspace CONTEXT、ADR 0007、本Change proposal/design/two specs/tasks、`extract-office-exchange-client-core` artifacts及当前Core implementation/tests。 |
| `openspec status` / `instructions apply` | planning artifacts complete；implementation tasks **0/8**。按`tina-verify`，这是pre-edit baseline；最终任何unchecked task均为Critical。 |
| current implementation probe | **BASELINE**：Core当前只有no-controls path-based `importFile`/`exportToFile`与旧tests；DSH尚无两个Office tools。与tasks 0/8一致，不记产品defect。 |
| pre-edit Core/CLI gates | **PASS**：Client Core typecheck；focused Office/content runtime 2 files / 110 tests；CLI dependency build、package-artifact 13/13与full 14 files / 69 tests均exit 0。该结果冻结no-controls direct adapter、command/daemon/package compatibility基线。 |
| Task 1 Core optional controls | **PASS**：独立Core typecheck、Office/content-runtime 2 files / 123 tests、CLI exchange/content adapter 2 files / 3 tests及`git diff --check`均exit 0。public exports追加import/export controls与published `importBuffer` port；create/target signatures接受optional signal，runtime `exportUnitData`接受signal与canonical bytes/depth并在credential/acquire/sync/export/return各边界检查。受控export把exact budget/signal传入runtime且converter options不变；pre-abort零next step。CLI commands仍不传controls，no-controls import/export分别只调用原path `importFile`/`exportToFile`；daemon adapter即使收到signal/budgets也只发送原`{target}`/`{code,target}` payload。Task 2/3才启用controlled buffer/atomic branches，不提前计入本Task。 |
| Task 2 bounded controlled import | **PASS**：REV-OFFICE-001修复后，独立Core typecheck、Office/files/content-runtime 3 files / 169 tests、CLI compatibility 3 tests与diffcheck exit 0。controlled branch按`inspectSource`→signal-aware `openSource`→manual iterator→`importBuffer`执行；known oversize zero-open，arbitrary oversized chunk只account max+1/no next/finally close，完成时严格核对inspected/actual bytes。全部suffix/type/options/name、growth/truncate/same-length ceiling、read/native cancel、lossless/accessor-safe converted value、explicit-name后bytes/depth gate通过。create只调用一次并透传同一idempotency/signal；confirmed late cancel可返回success，unknown/mismatch/invalid原code直出且inspect/open/native/create各exact once，无reread/reconvert/replay。no-controls CLI path不进入controlled seams。 |
| Task 3 exact-revision atomic export | **PASS**：`WT-OFFICE-QA-002`修复后，独立Core typecheck、Office/files/content-runtime 3 files / 184 tests、CLI no-controls 2 files / 3 tests及scoped diffcheck均exit 0。controlled branch只解析一次target并把同一selected revision、52,428,800-byte/64-depth与signal交给runtime；真实runtime bytes/depth limit统一投影为Office fixed code，head mismatch不重解析且零native/output。四类Unit走published `exportToBuffer` exact options，Board/format/identity在publish前拒绝；native settle后检查signal与output `> max`，max边界由同一数值比较保留。Office-kind shared publisher使用`0600` same-dir temp、完整write/sync、non-force link no-clobber与force rename，覆盖existing/racing target、prior preservation、temp cleanup和late confirmed publication。CLI省略controls时仍只走原`exportToFile` direct path。 |
| Task 4 DSH effect gate | **PASS**：`WT-OFFICE-QA-003`修复后，独立DSH typecheck、Office/File Transfer 2 files / 73 tests及scoped diffcheck均exit 0。Native/Code catalog只新增两个root-closed schemas；exact own data keys/types/nonblank/suffix compatibility与canonical 524,288-byte boundary在ask前执行，invalid保持fixed argument error且path/approval/Core全0。import先ask，允许后才证明public LocalFS、Session cwd、contained regular source并显式`processPath`；read-only仍可ask，nonlocal/no-cwd/outside/missing/nonregular均在Core前失败。export严格按current policy→public constructor→validator→Session/workspace-write containment→one ask，accepted body从immutable args重复policy/provider/path后才进入显式process path/Core；read-only先于argument/path，danger仍受cwd约束。两根containment、policy mode/root narrowing、symlink与public-constructor drift、rejected/cancelled/unavailable/no-channel均零body且无第二ask。说明：public `LocalFileSystem.contains()`内部会调用`processPath`，所以preflight可见的内部call属于既有containment seam；验收以decision-time call-count barrier证明accepted body前没有Office显式Host-path conversion。production authentication composition按任务拆分留给Task 5。 |
| Task 5 production composition/outcomes | **PASS**：`WT-OFFICE-QA-004`修复后，独立DSH typecheck、authentication/office/file 3 files / 149 tests及scoped diffcheck均exit 0。production `mountWorkspaceAuthentication`通过同一authenticated HTTP、Tool owner与content-runtime generations组合两个Office tools；real ToolRuntime import用fake Workspace authoritative POST创建Worktree-local Unit，export只GET一次selected Worktree target并读取revision 17，严格converter验证exact bytes/UnitData，`executeAndCommit`为0。12个import suffix/type组合与4个export Unit type组合通过；source growth在converter/create前拒绝，Board、CSV/PDF、legacy output及wrong canonical import/export outcome均在成功render/publication前拒绝。no-clobber保留prior bytes，explicit force成功替换；head mismatch不重解析且零native/output/commit。 |
| Task 6 error/cancel/lifecycle | **PASS**：独立Client Core typecheck/build、DSH typecheck、Office/authentication/file/content-runtime-generation 4 files / 199 tests与scoped diffcheck均exit 0；另以verbose filter复跑26个identity/cancellation/lifecycle repro。real `ExchangeErrorCode`七成员×import/export仅投影fixed `{phase,exchangeCode}`，forged/unlisted降级generic；shared source/license与Code Mode failure不反射credential/cookie/license/UnitData/Office bytes/temp/native cause/dependency material。pre-abort为`ABORTED_BEFORE_DISPATCH`且零approval/path/body。production `WorkspaceUnitFeature`+fake HTTP在caller省略key时覆盖三code×caller/owner：每行one POST/one conversion/no replay；unknown保留生成UUID，mismatch/invalid按design只保留safe code、Space/Worktree identity与fixed inspect guidance，不扩展Core detail。caller/owner source read、target/runtime、native import/export与private write均等待settlement、停止later step、清理temp并保留prior；caller late confirmed create/publication为canonical `ABORTED`+operation-specific inspect-before-retry，owner-only confirmed结果在drain中可见。dispose先注销2 tools/policy branch，独立drain concurrent bodies，关闭production runtime generation；fake same-name与完整remount证明零stale listener/body，未创建Job/timer/retry。 |
| Task 7 installed artifact | **PASS**：独立重新执行`package:verify`与`package:smoke`均exit 0；verify build 1498 modules并检查actual packed file set/import closure。installed Client Core graph唯一解析`exchange-node@1.0.0-beta.2`，Core re-export的`ExchangeError`/enum与public ESM owner identity相等，owner声明的exact binding `0.1.0`是packed Host唯一新增runtime dependency；exchange JS内联，Host使用package-relative worker entry并复用colocated `worker-child.mjs`，无bare Core、`workspace:*`、CLI source/daemon/Session、absolute/adjacent checkout、remote/Web/later resource。isolated actual tarball从unrelated cwd启动，使用fake credentials/endpoints/model adapter与real worker/native binding：exact UnitData导出real XLSX并回导，A1=`runtime-smoke`；Doc/Slide explicit type/suffix各进入real converter并以fixed `INVALID_FILE`安全失败、zero create。direct tools固定one approval reason，denied/read-only零credential/effect；52,428,801 source zero create，revision 2/runtime 1 zero output/commit；unknown/mismatch/invalid各exact one POST/no reread/reconvert/replay，unknown caller abort保留generated UUID。Office output为`0600`、无temp，no-clobber保留prior且force成功；Agent与Code Mode export均返回canonical value并生成real XLSX。combined dispose并行drain transfer/discovery/Office create，owner outcome、tool/listener/Skill unregister与remount通过。QA smoke报告port 63740；其退出时及后续并发smoke自然结束后，smoke/run/worker-child process、port、profile/run/temp目录全恢复空baseline。随后独立DSH typecheck/full 8 files / 483 tests及scoped diffcheck通过。 |
| Task 8 docs/gates | **PASS**：独立复读确认DSH README覆盖two tools、exact formats/CSV exclusion、Worktree-local create、once-selected exact head、50 MiB/depth64、Host-local policy/one approval、atomic `0600`/force、signal/native settlement、三种non-confirmed inspect/no-replay和非职责；Core README覆盖optional controls、exact revision/atomic branch、CLI no-controls direct path及Shell ownership；root README/AGENTS/DREAMNUM current facts与之相符，`WT-OFFICE-QA-005`关闭。独立执行DSH actual `package:verify`（1498 modules）与isolated tarball `package:smoke`（port 51312）通过，退出后Host/worker-child/profile/run/temp/port恢复空baseline；Core typecheck/full 27 files/563/build、DSH typecheck/full 8 files/483/build、CLI focused命令实际full 14 files/69 + artifact13、`package:workspace-cli` 203 files与CLI installed package smoke均通过。独立root typecheck、test（SDK4/release8/Core563/reference16/Workspace152/CLI69/DSH483）、build、OpenSpec strict和diffcheck通过；OpenAPI lint/generate/build通过，Server/OpenAPI/release文件无Office diff，SDK cohort test确认单一`1.0.0-beta.2` baseline。Implement只勾Task 8后，QA独立复核`instructions apply`为8/8、remaining0、`all_done`，status 4/4 artifacts complete，strict与diffcheck仍通过，最终process/temp set为空。 |

## QA 结论

**PASS / READY TO ARCHIVE。** 70/70 AC通过，**0 open issues**；Tasks 1–8、产品/source行为、actual installed
artifact、CLI compatibility、仓库门禁、文档事实、OpenSpec strict与process/temp hygiene均已独立验收。QA未执行archive。
