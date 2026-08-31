# add-dsh-render-verification-tools QA

状态：**TASK 7.1 PASS；TASK 8.1 PASS；Change 8/8，0 open findings，READY TO ARCHIVE**

基线：Render prerequisite virtual tree `69ecb274e4d5e946202f49998b1e09e72f6c24fb`；Task 1.1 pre-code virtual tree
`6b010bd0b17b2deee9409562c18447a2919501da`；QA snapshot `574915642fd722567d4837eab5461e57e3958db6`；SDK `1.0.0-beta.2`；
Task 3.1 frozen start `b87a69b8abe5ec6bc694466ae4ccb9e1bfcb06cf`；DeepSeek Harness `0.1.1-rc.2`；Cordis `4.0.1`。
Task 4.1 foundation frozen start `aaa2a1c11cad54b7154a26361830578fb9235adf`。
Task 5.1 foundation frozen start `c24fe4da73b33973becaeaefbffec5b31732241d`；original foundation tree
`5930776bbe914f1cadf51374ffb43a5c75b05a99`；review-fix tree `c94916ae4ccd564c072109c71d86038c5c548490`。
Task 7.1 fixed implementation full tree `ffb32fbb6a99635975cd4b4cf3c4888613bbd487`。
QA只修改本报告，不修改product、tests、tasks或OpenSpec artifacts。

## 冻结验收标准

### Task 1：前置 owner 与公开合同

1. Changes 1–6 的plugin shell、authentication、Space/Node、Worktree/Unit、file transfer、content runtime tasks全部complete。
2. 当前authentication effect只创建一个`WorkspaceToolOwner`，dispose顺序为stop admission、reverse unregister、owner abort、drain owner/runtime generation。
3. render必须复用current authenticated HTTP、credential replacement retirement、application license resolver与同一worker generation，不增加第二owner或credential cache。
4. local screenshot gate必须复用公开`currentFilesystem`、`currentPolicy`、`requireLocal`、`resolveContainedPath`及rc.2 `LocalFileSystem` identity。
5. Change 5完整stable Workspace code membership、safe detail projection和owner cancellation classification必须通过一个现有owner-owned公开seam复用。
6. Change 6完整stable content/runtime code membership、safe detail projection和owner cancellation classification必须通过一个现有owner-owned公开seam复用。
7. Core package root必须公开现有render loader、screenshot capture/write、layout lint与render-page owner；DSH不导入CLI或Core内部路径。
8. exact beta.2 screenshot、layout-lint、render-runtime root exports、schemas、error constructors/codes和limits与design一致。
9. rc.2 ToolRuntime必须保持pre-abort→pre-execute/ask→body→post/finalize/result顺序，late successful caller abort为`ABORTED`，body structured failure不被覆盖。
10. pre-edit Core/DSH typecheck与冻结virtual tree必须通过；任一prerequisite不符时Task 1停止且不勾选。

### Task 2：Core signal、browser settlement与close

11. `WorkspaceRenderUnitLoadInput`追加optional signal且无signal调用的input/order/result不变。
12. `openSource(signal?)`在pre-abort时零调用；resolver返回后、每个target/reference/export/Asset await后都有next-step fence。
13. Trunk/Worktree Host target收到同一signal；authoritative Unit type/revision仍来自target owner。
14. formula reference与Embed child按原稳定顺序、dedup/self/soft-delete/type rules加载并传同一signal。
15. Worktree Asset resolver收到同一signal；mid-reference/Asset abort等待active operation、零later reference/Asset/browser、无partial render copy。
16. Trunk render保持零Asset fetch/rewrite；source UnitData不被修改。
17. screenshot runtime construction与capture收到同一signal；pre-browser abort零runtime/capture。
18. layout source load、runtime construction与lint capture收到同一signal；non-Slide仍在browser前拒绝。
19. browser success先await close再settle；failure保持primary classification且先close。
20. browser operation resolve-after-abort与reject-after-abort都先await operation，再观察exact caller/owner cancellation，零later file step。
21. close不可中断：caller/owner已abort时仍等待close；close failure不能泄漏browser path/cause，也不能遗留page server/process。
22. CLI omitted-signal adapters保持target/reference/order/runtime options、daemon payload、PNG/lint value与coded failure不变。

### Task 3：signalled PNG publication与partial semantics

23. writer optional signal为append-only；无signalCLI维持现有recursive directory、safe basename、`0600` temp、exclusive link与non-transactional behavior。
24. supplied signal在mkdir/name/preflight/temp/write/link前后检查，同时每个已开始的write/link/cleanup都被await。
25. cancellation before first confirmed link产生零destination、零next output并清除private temp/handle。
26. 每个confirmed link立即记录Core-owned`{name,location}`，不得从dependency error detail或caller输入重建。
27. one/multiple commit后abort返回exact `workspace-screenshot-output-partial`，`causeCode: ABORTED`。
28. commit后exclusive-link race返回同一partial shape，`causeCode: workspace-screenshot-output-exists`。
29. commit后generic write/link/cleanup failure返回同一partial shape，`causeCode: workspace-screenshot-output-failed`。
30. partial counts均为non-negative integers，array length等于committed count且不超过total；unknown key/raw cause/message/errno/stack均消失。
31. committed files保留且byte exact；不得rollback/delete/overwrite/recapture/retry，未开始的later outputs零I/O。
32. all links committed后才观察signal可由Core返回既有ordered locations；DSH late caller finalization另判`ABORTED`。
33. owner-only cancellation保持confirmed complete success可见或known partial，dispose仍drain；不得伪装caller cancellation。
34. zero/one/multiple commit、pre-existing destination、concurrent winner、write/link/cleanup fault、temp cleanup与prior preservation均有direct fault-seam evidence。

### Task 4：closed tools、targets与budgets

35. production effect只新增`workspace_screenshot`与`workspace_layout_lint`，definitions/root/nested result schemas全部closed。
36. pure descriptor-safe exact-own-key validator在任何credential/path/approval/Core/browser前拒绝unknown/symbol/accessor/sparse/toJSON输入。
37. caller不能提供`unit_type`、`revision`、`origin`；Trunk禁止`worktree_id`，Worktree要求nonblank identity。
38. screenshot支持exact six targets：sheet viewport/range、doc pages、slide pages/contact sheet、board content、base view；omitted target使用authoritative Unit default。
39. target/type mismatch仅在approved authoritative probe后、render page/browser前拒绝，不能coerce。
40. A1、one-based numeric pages、page IDs、Board elements xor region、positive finite region、padding/tile及scale `0.1..4`语义与beta.2一致。
41. screenshot arguments canonical bytes exact 65,536 accept/max+1 reject；page selectors exact30/max+1，SDK pixels exact16,777,216边界保留。
42. layout只接受Worktree Slide、nonblank identities与最多10,000 positive page numbers/nonblank page IDs；不接受rule filter。
43. complete lint report保留coverage pages/rules及所有finding text/container/overflow/overlap/evidence字段与ordered findings。
44. screenshot capture metadata对每种Unit target完整验证exact keys、positive dimensions、media type、安全且唯一basename及Board nested analysis。
45. exact bytes-free screenshot candidate含approved canonical location，并在首PNG前通过8,388,608-byte/depth64 closed result gate。
46. malformed/oversize capture写零destination/temp且不truncate；lint oversize同样返回fixed limit failure而非partial success。
47. canonical screenshot/result/render/presentation/plugin-owned events不含PNG bytes、UnitData、revision、browser/render-page path、credential/license。
48. real ToolRuntime Native与Code Mode覆盖catalog/schema、all targets/findings、invalid ordering、canonical value、paired Code events与secret-negative。

### Task 5：LocalFS、policy与approval

49. screenshot pre-execute顺序严格为current policy deny→public LocalFS proof→pure args→Session cwd/policy-root containment→one fixed ask。
50. read-only在args/path/ask/processPath/credential/Core/browser/file前拒绝；non-local provider同样在model path interpretation前拒绝。
51. missing/invalid cwd、outside Session root、workspace-write policy root escape与symlink containment均fixed failure且不反射Host path。
52. preflight不得`processPath`、stat/create output、resolve credential/target/license或启动worker/browser。
53. approval rejected/cancelled/unavailable/no channel均零body/credential/Core/browser/temp/destination。
54. accepted body从immutable args重新验证current policy/provider/cwd/root/containment，之后才调用一次explicit destination `processPath`。
55. body-time policy narrowing、provider constructor proof loss、cwd/root/symlink drift在Core/browser/file前fail closed。
56. default output为Session-relative`screenshots`；每个Core basename只能发布在approved canonical directory下。
57. layout lint不进入screenshot approval listener、不写local file，但仍受documented browser process boundary。

### Task 6：error secrecy、cancellation与lifecycle

58. render adapter exact复用完整Change5/6 memberships及detail projection，只追加Design Decision 6列出的render codes；禁止prefix/name/code duck typing。
59. SDK error只以exact public constructors加frozen membership保留；forged/unlisted code统一`workspace-render-operation-failed`。
60. render safe detail只含authoritative scope/Worktree/Unit/type、numeric limits/count、validated selector及confirmed output identity。
61. browser missing只保留`BROWSER_UNAVAILABLE`和fixed operator guidance，不反射checked paths/env/executable/cache。
62. source/Asset/runtime/screenshot/lint errors的message/stack/cause、UnitData/content/bytes、credential/license、raw selector/path均不进入result/render/approval/events/log。
63. successful lint evidence是authorized output，必须lossless保留，不能被secret sanitizer误删。
64. pre-dispatch caller abort为registry `ABORTED_BEFORE_DISPATCH`且零plugin work。
65. post-commit partial错误dominates caller/owner cancellation并保留exact detail；普通caller/owner阶段分别映射cancelled/disposing。
66. complete output后caller abort由rc.2返回`ABORTED`，finalizer固定提示检查directory/no replay；owner-only complete可成功。
67. 每次runtime success/failure/abort均先close；accepted body跟踪browser、worker lease、request、file cleanup直至settled。
68. dispose停止admission、unregister两tools/listener、abort owner、retire generation并drain并发calls；remount无stale listener/runtime。
69. post-dispose无browser/page server/worker/lease/request/temp/handle/timer/Job/retry/detached promise；approval/path/browser各阶段均有barrier evidence。

### Task 7：installed tarball与真实browser

70. build依赖Core render-page build并复制完整package-relative`dist/render-runtime` graph；HTML只引用artifact内local assets。
71. verifier realpath exact installed render-runtime owner并要求version `1.0.0-beta.2`。
72. 从physical owner-relative resolution读取actual `puppeteer-core`与`@puppeteer/browsers` manifests/concrete versions，packed manifest与installed resolution exact相等。
73. artifact保留Change6 worker-child/formula native closure但不增加第二render/Typst/Office/SVG worker或资源。
74. verifier拒绝remote URL、sourcemap、browser cache/binary、bare private Core、`workspace:*`、CLI/source checkout、absolute path与future resources。
75. fresh profile actual tarball从无workspace`node_modules`的unrelated Session cwd启动，Host/bare imports/render assets全部从installed closure解析。
76. restricted temporary OS user/container filesystem/network boundary下，以显式resolved test browser运行真实render page screenshot与layout lint。
77. installed real ToolRuntime Native、Agent Loop、Code Mode覆盖exact PNG/report、approval/policy、budgets、caller cancel、partial output、credential replacement与owner dispose。
78. installed missing-browser路径返回sanitized`BROWSER_UNAVAILABLE`且零implicit download/public network。
79. pre/post browser/worker/process/port/temp/profile集合无新增残留；只清理本轮exact fixture资源。

### Task 8：文档与compatibility gates

80. DSH/Core READMEs只在交付后声明two-tool scope、fixed artifact layout、Session cwd、no-overwrite/partial/cancellation ceiling。
81. 文档明确Chromium`--no-sandbox`要求restricted OS user/container与bounded filesystem/network，approval不是process isolation。
82. 文档记录browser prerequisite、system-font差异及non-goals，不预告download tool/pool/jobs/remote filesystem/new formats/rules。
83. Core typecheck/test/build与DSH typecheck/test/build/package verify/smoke全部PASS。
84. CLI screenshot/lint/SVG focused、CLI full/package verify/installed smoke保持omitted signals、browser setup、commands/results与render-page compatibility。
85. root SDK dependency、typecheck/test/build、production import、package workflow与exact baseline全部PASS；Server/Browser/OpenAPI/database/deployment/release无diff。
86. OpenSpec strict、instructions status 8/8和full `git diff --check` PASS；QA/review 0 open后才可判ready，不由checkbox替代证据。

验收项总数：**86**。

## 真实环境矩阵

| 轴 | 必须直接运行或审计的证据 |
| --- | --- |
| Prerequisite | exact virtual tree；Changes1–6 status；Core/DSH typecheck；public Core/file/content seams；rc.2 order；beta.2 d.ts/runtime exports |
| Core render load | Trunk/Worktree Host、formula/Embed、Worktree Asset；pre/mid abort；no-signal exact compatibility；zero partial copy |
| Browser lifecycle | screenshot/lint runtime construct/operation/close resolve+reject barriers；close uninterruptible；missing browser；real render page/browser |
| PNG writer | exact bytes、0600 private temp、exclusive link、zero/one/multi commit、abort/race/generic failure、cleanup/prior preservation、no replay |
| Tool contracts | real Cordis ToolRuntime Native/Agent/Code；closed schemas；all target/findings fields；64KiB/30/10k/8MiB/depth64 boundaries；PNG/event secrecy |
| File gate | bare LocalFS与sandbox subclass；read-only/workspace-write/danger；cwd/policy dual roots；approval four failures；body drift；default directory |
| Errors/lifecycle | full inherited allowlists+render additions；exact constructors；unknown sentinels；late ABORTED/partial; concurrent owner drain/unregister/remount |
| Installed closure | actual tarball/fresh profile/unrelated cwd/restricted boundary；owner-relative Puppeteer versions；real browser PNG/lint；credential rotation；process/port/temp cleanup |
| Compatibility | Core/DSH/CLI focused+full/build/package gates；CLI SVG consumer；root gates；OpenSpec strict/status/diffcheck |

## Issues

| ID | Severity | Evidence | Expected | Repro | Status |
| --- | --- | --- | --- | --- | --- |
| WT-RENDER-QA-001 | High | 原审计发现Change5/6没有可复用的完整owner-owned failure projection seam。Task 1.1现已从原owner分别导出`projectWorkspaceFileTransferDependencyFailure(error)`与`projectWorkspaceContentDependencyFailure(error)`；既有tools委托相同投影，private allowlist/detail实现仍未导出。 | 保持完整冻结membership、exact constructor checks、safe detail、取消优先级与既有ToolRuntime输出；不增加generic adapter、shared registry或第三owner。 | 对`6b010bd…`与QA snapshot做temporary-index tree diff；执行focused 106 tests、DSH full 486 tests、两个typecheck、strict validate和full diff check。 | **CLOSED / VERIFIED** |
| WT-RENDER-QA-002 | High | `WorkspaceRenderUnitLoader`与screenshot/layout browser路径原先只在fulfilled await之后检查signal。`openSource`、target、UnitData export、runtime construction、capture或lint若在signal abort后reject会保留dependency error；Worktree Asset resolve/reject after abort由beta.2 helper映射为`SCREENSHOT_ABORTED`。现由render-slice `awaitRenderOperation`在active Promise resolve/reject settle后统一执行exact signal fence，browser construction rejection也执行同一优先级。 | 每个active operation先settle；resolve/reject之后都以exact supplied signal reason为准，且不启动later reference、Asset、browser或file step。无abort时仍保留原dependency error identity。 | 原独立`tsx` barriers现全部`error === abortReason`：openSource、target、export、Asset resolve/reject、runtime construction、capture与lint；browser close计数保持1。无abort capture/lint仍`error === dependencyError`。Core focused增至96 tests。 | **CLOSED / VERIFIED** |
| WT-RENDER-QA-003 | High | screenshot/layout原先直接使用`finally { await runtime.close() }`，close rejection会覆盖既有exact abort或capture/lint primary failure；browser operation成功后若signal在close期间abort，Core仍返回fulfilled success。现使用显式`failed`状态，始终await close；已有primary不被cleanup覆盖，无primary时close error决定结果，close后再次执行signal fence。 | success/failure/abort均先await不可中断close；cleanup failure不得覆盖已有primary/cancellation。若body已成功而signal在close期间abort，close完成后返回exact signal reason；无signal/no-abort的既有failure identity保持。 | 原独立barriers现通过：pre-fence abort与close rejection保留exact abort；primary capture/lint failure压过close rejection；success + close内abort在close后reject exact reason；`undefined`/`null` primary也不被close覆盖；success + close failure仍保留close error。 | **CLOSED / VERIFIED** |
| WT-RENDER-QA-004 | High | Task 4.1 foundation首轮只校验截图metadata形状：requested Doc pages可返回不同或重复page，Slide contact tiles可失配，Board selector可缺失，explicit Sheet range/sheetName可变化。首轮修复又错误假定beta.2 Slide page-id capture会返回`pageId`，从而拒绝真实合法结果。最终实现让authoritative probe把Slide selectors解析为closed numeric page identities，按first-use顺序与beta.2 numeric `page` exact关联；同时按canonical A1、sheetName presence/value、Board selector/padding/scale及contact tiles执行applicability校验。 | 每种capture metadata必须匹配authoritative target与requested selector；malformed mismatch在首PNG publication前返回`workspace-screenshot-output-invalid`。真实beta.2 page-id选择必须被接受，不能依赖其实际不返回的Slide `pageId`字段。 | 独立调用public beta.2 `createUnitScreenshot`，`slideOrder:["cover"]`与`pages:["cover"]`得到仅含`page:1`的image；最终foundation以probe-resolved `[1]`接受，以`[2]`拒绝。另以独立`tsx`重放Doc duplicate、Board missing selector、contact tiles、Sheet canonical range/sheetName mismatch，均在publication前拒绝。 | **CLOSED / VERIFIED** |
| WT-RENDER-QA-005 | High | 首轮layout validator把三种finding evidence全部建成optional siblings，并接受`text-off-page`携带`other`且缺少`pageBox`/`overflow`；还接受fixed rules逆序及同一page number映射多个pageId。现schema与runtime validator按三条beta.2 rule形成exact variants，要求各自完整evidence；coverage rules固定顺序，page number与pageId分别唯一。 | 完整lint canonical report只接受适用于该rule的closed evidence，保留authorized text losslessly，并拒绝错误sibling、缺失必需字段、coverage rule order或page mapping异常。 | 独立`tsx`对wrong sibling/missing evidence、reversed rules、duplicate page mapping复现由“accepted”变为exact `INVALID_RENDER_RESULT`；三种合法finding evidence与1,000,000字符authorized detail仍lossless通过。 | **CLOSED / VERIFIED** |
| WT-RENDER-QA-006 | High | review轮发现空lint selectors、31个raw Slide IDs的pre-probe limit、coverage/finding fingerprint/order/identity，以及probe/publication receipt、non-Slide和depth short-circuit需要更强的执行期证明。最终实现拒绝`pages: []`；在directory/probe前拒绝31个raw selectors；把coverage绑定到requested authoritative identities；逐rule验证finding evidence、identity、fingerprint与严格排序；并在相应边界fail closed。 | 参数上限必须按caller输入在authority工作前执行；canonical lint不得接受伪造、错序或错identity的coverage/finding；坏probe/receipt、non-Slide和depth max+1不得进入后续browser、lint或publication步骤。 | 独立ToolRuntime probes确认`pages: []`零probe、31 IDs零resolve/probe/capture/publish；bad probe零capture/publish、bad receipt不产生后续publication、non-Slide零lint。独立validator probes确认三rule合法报告通过，而reversed findings、text/container/related identity、arbitrary fingerprint与coverage pageId mismatch均拒绝；depth 64通过、65拒绝。 | **CLOSED / VERIFIED** |
| WT-RENDER-QA-007 | High | review轮确认raw selector数量不能直接代替beta.2 first-use page数量：31个重复Doc/Slide selectors或31个number/pageId aliases可能只选择一个page；同时31个distinct IDs必须在directory/probe前拒绝，而最多30个raw aliases经authoritative解析成31个distinct pages时必须在capture/publication前拒绝。最终实现分别执行pre-probe per-domain first-use gate与post-probe resolved numeric page gate。 | 保留beta.2 first-use dedup语义，并在可判断的最早边界执行30-page limit；不得为distinct raw IDs启动authority工作，也不得为authoritative resolved max+1启动capture/publication。 | ToolRuntime复验确认31 duplicate Doc、31 duplicate Slide及31 mixed number/pageId aliases均成功且只输出page 1；31 distinct IDs的directory/probe/capture调用均为0；authoritative resolved 31 pages时probe恰1次、capture/publish均为0。 | **CLOSED / VERIFIED** |

## 实际执行结果

| 命令/探针 | 结果 |
| --- | --- |
| artifacts/domain/source review | **PASS**：完整读取root/target instructions与README、Workspace CONTEXT/全部ADR、本Change current proposal/design/two specs/tasks、既有QA报告、Task1实现与tests，并复核published rc.2/beta.2 contracts。 |
| Task 1.1 virtual-tree scope | **PASS**：pre-code tree `6b010bd0b17b2deee9409562c18447a2919501da`；QA temporary-index snapshot `574915642fd722567d4837eab5461e57e3958db6`。Task1 product diff仅修改既有`file-transfer.ts`、`content-tools.ts`及其tests；未新增generic/shared error module、registry或owner。 |
| OpenSpec status | planning 4/4 complete；implementation **3/8**。Tasks 1.1、2.1、3.1已勾选；Tasks 4–8仍pending。 |
| exact SDK public probe | **PASS**：unit-screenshot/layout-lint/render-runtime均exact`1.0.0-beta.2`、root-only export；six target/result/finding/error types与signal字段符合冻结design；render-runtime owner range观察值不作为packed concrete version。 |
| rc.2 ToolRuntime source audit | **PASS**：pre/execute/post/result order、`ABORTED_BEFORE_DISPATCH`、late `ABORTED`与finalizer seam符合design prerequisite。 |
| exact owner exports/privacy | **PASS**：两个exact named exports存在；`stableWorkspaceCodes`、`stableContentCodes`、`projectDetail`、`projectContentDetail`和两个tool error constructors保持module-private；DSH root未额外re-export。 |
| Decision 6 membership/constructor probe | **PASS**：完整Change5/6 code sets逐项通过；真实`WorkspaceApplicationError`、`ContentInspectionError`、`CollaborationRuntimeError`、`UniverCollaborationRuntimePoolError`及owner errors按`instanceof`识别；counterfeit `HarnessError`、plain/code-string和unlisted code被拒绝。 |
| safe detail/secrecy probe | **PASS**：owner字段、nested identities、null与numeric fields按原投影保留；message、cause、headers、credential/cookie sentinel和未知字段未进入projection、Native render或Code Mode结果。 |
| cancellation/uncertain-result precedence | **PASS**：`workspace-content-partial-side-effect`和`workspace-result-unknown`在caller/owner取消竞态中保持优先；普通caller/owner取消仍分别为`workspace-operation-cancelled`/`workspace-plugin-disposing`；file upload result-unknown与late ToolRuntime `ABORTED`语义未变。 |
| existing caller preservation | **PASS**：file/content tools仍委托同一owner投影；Office与discovery的窄`projectWorkspaceFileEffectFailure`行为、codes/details/render/secrecy均由DSH full suite覆盖。 |
| `pnpm --filter dsh-univer-work exec vitest run test/file-transfer.test.ts test/content-tools.test.ts` | **PASS**：2 files，106 tests。 |
| `pnpm --filter dsh-univer-work test` | **PASS**：build完成；8 files，486 tests。 |
| `pnpm --filter @univerjs/univer-workspace-client-core typecheck` | **PASS**。 |
| `pnpm --filter dsh-univer-work typecheck` | **PASS**。 |
| `openspec validate add-dsh-render-verification-tools --strict` | **PASS**。 |
| `git diff --check && git diff --cached --check` | **PASS**。 |
| Task 2.1 frozen start | `9693346389e4f3bee0b325829d967ce7d15645a3`；QA仅审计该点之后的Core render/source/screenshot/lint与CLI caller变化。 |
| Task 2.1 source and caller audit | **PASS**：optional signal贯穿source/target/reference/export/Asset/browser construction+operation；Trunk零Asset、render-copy不改source及CLI omitted-signal callers保持。render settlement helper不从Core root公开，未增加renderer/owner。 |
| independent cancellation barriers | **PASS**：原openSource/target/export/Asset/runtime construction/capture/lint resolve/reject-after-abort repro均返回exact reason；close始终settle且primary/abort precedence、abort-during-close、`undefined`/`null` primary与no-abort raw identity均通过。 |
| pre-fix Core focused | **PASS**：5 files，79 tests；该轮暴露suite尚未覆盖两个High，作为原finding基线保留。 |
| `pnpm --filter @univerjs/univer-workspace-client-core exec vitest run --config vitest.config.ts test/render-unit.test.ts test/runtime-source.test.ts test/screenshot.test.ts test/layout-lint.test.ts test/screenshot-output.test.ts` | **PASS**：5 files，96 tests。 |
| `pnpm --filter univer-workspace-cli exec vitest run --config vitest.config.ts test/workspace-screenshot.test.ts test/workspace-unit-layout-lint.test.ts` | **PASS**：2 files，4 tests；CLI adapters继续省略signal并保持scope/value。 |
| Task 2.1 Core/CLI typecheck | **PASS**：`pnpm --filter @univerjs/univer-workspace-client-core typecheck`；`pnpm --filter univer-workspace-cli typecheck`。 |
| Task 2.1 strict/diffcheck | **PASS**：`openspec validate add-dsh-render-verification-tools --strict`；`git diff --check && git diff --cached --check`。 |
| Task 3.1 frozen scope | **PASS**：从`b87a69b8abe5ec6bc694466ae4ccb9e1bfcb06cf`审计到当前工作树；product delta仅为`packages/client-core/src/screenshot.ts`，test delta仅为`packages/client-core/test/screenshot-output.test.ts`，CLI source无Task 3.1 diff。optional `signal`保持append-only，CLI caller继续原样省略。 |
| Task 3.1 source/caller audit | **PASS**：signal fences覆盖mkdir、name/preflight、每个temp write、exclusive link与cleanup前后；active write/link/cleanup均await。confirmed identity只由Core预计算的safe basename与resolved destination产生；committed array/count/order保持一致。无rollback、delete committed、overwrite、recapture、retry或later-output启动。 |
| independent real-fs fault/barrier probe | **PASS**：用`fs.watch`在128 MiB private same-directory write活跃期间abort，operation等待write与unlink后返回exact reason，目录最终为空且later output零I/O；另在首个confirmed link后同步制造真实second-destination winner，返回exact partial/`workspace-screenshot-output-exists`，winner与首图bytes均保留且无temp。 |
| independent partial/compatibility probe | **PASS**：post-commit invalid write输入只返回exact closed partial/`workspace-screenshot-output-failed`且无cause/raw message；unsignalled路径保留`0600`、existing file mode/bytes、non-transactional first output；全部links完成后的late caller abort不改变Core returned ordered locations或committed bytes。 |
| `pnpm --filter @univerjs/univer-workspace-client-core exec vitest run --config vitest.config.ts test/screenshot-output.test.ts test/screenshot.test.ts` | **PASS**：2 files，28 tests。 |
| Core render focused regression | **PASS**：`render-unit`、`runtime-source`、`screenshot`、`layout-lint`、`screenshot-output`共5 files，104 tests。 |
| CLI omitted-signal regression | **PASS**：`workspace-screenshot`、`workspace-unit-layout-lint`、`workspace-compile-svg`共3 files，13 tests；既有adapter继续不传signal。 |
| Task 3.1 Core/CLI typecheck | **PASS**：`pnpm --filter @univerjs/univer-workspace-client-core typecheck`；`pnpm --filter univer-workspace-cli typecheck`。 |
| Task 3.1 strict/diffcheck | **PASS**：`openspec validate add-dsh-render-verification-tools --strict`；full working/cached diff check与frozen scoped diff check均通过。 |
| Task 3.1 Standards Low fix recheck | **PASS**：只读核对`writeExclusive()`同步边界现仅保留一次pre-link `signal?.throwIfAborted()`；删除连续重复检查未移动write/link/committed/cleanup fence。writer focused为1 file、16 tests；full working/cached与frozen scoped diffcheck继续PASS。 |
| Task 4.1 foundation scope | **PASS**：冻结起点`aaa2a1c11cad54b7154a26361830578fb9235adf`；当前仅新增`apps/dsh-univer-work/src/render-tools.ts`及其focused test，未接production authentication owner、Task 5 approval/file gate、Task 6 runtime/error/lifecycle或Task 7 package closure，`tasks.md`保持4.1未勾。 |
| Task 4.1 schema/descriptor probe | **PASS**：exact two names；root/nested schemas recursively closed；unknown union siblings、symbols、accessors、sparse arrays与authority fields在operation前拒绝且getter零调用；two unregister callbacks移除exact definitions。 |
| Task 4.1 target/result probe | **PASS**：Trunk/Worktree cross-field、authoritative type mismatch ordering、six targets、A1/scale/Board/tile semantics；safe unique basename、all metadata variants、bytes-free canonical locations与zero-publication malformed/oversize behavior通过。 |
| Task 4.1 beta.2 page-id probe | **PASS**：直接调用public `createUnitScreenshot`证明Slide page-id输出只有numeric `page`；closed probe envelope返回authoritative `{page,pageId}` identities，numeric/ID alias、first-use dedup、order与capture cardinality exact校验，不要求不存在的Slide capture `pageId`。原real beta.2 page-id、Sheet canonical range/sheetName、Doc duplicate、Board missing selector与contact tiles probes全部复验通过。 |
| Task 4.1 lint probe | **PASS**：三种rule exact evidence、coverage fixed order及requested authoritative page identity、finding identity/fingerprint/严格排序、all fields与authorized text lossless；wrong sibling、missing evidence、rule/finding reorder、duplicate或错误page mapping、text/container/related identity mismatch、arbitrary fingerprint及oversize report均拒绝。 |
| Task 4.1 exact budgets | **PASS**：descriptor-safe独立probe覆盖exact 30 screenshot pages、10,000 lint selectors、8,388,608-byte canonical result、depth 64与16,777,216 pixels；`pages: []`及各max+1返回fixed limit/error。31 duplicate Doc/Slide selectors与31 mixed number/pageId aliases按beta.2 first-use语义折叠为1 page；31 distinct raw IDs在directory/probe前拒绝，authoritative resolved 31 distinct pages在capture/publish前拒绝；oversize/depth异常截图零publish。 |
| Task 4.1 failure short-circuit probe | **PASS**：bad authoritative probe receipt在capture/publish前拒绝；bad publication receipt返回`workspace-screenshot-output-invalid`且不进入later publication；non-Slide layout在lint/browser work前拒绝。 |
| `pnpm --filter dsh-univer-work exec vitest run --config vitest.config.ts test/render-tools.test.ts` | **PASS**：1 file，16 tests。 |
| `pnpm --filter dsh-univer-work exec vitest run --config vitest.config.ts` | **PASS**：10 files，516 tests。首轮`pnpm test`曾与共享worktree另一build发生`dist/index.js`瞬时缺失竞争；dist稳定后的plugin-shell 2/2及full suite均通过，不记为产品finding。 |
| Task 4.1 typecheck/build | **PASS**：DSH与Client Core typecheck；Client Core build；最终DSH build。 |
| Task 4.1 strict/diffcheck | **PASS**：`openspec validate add-dsh-render-verification-tools --strict`；`git diff --check`与`git diff --cached --check`。 |
| Task 5.1 frozen scope | **PASS**：冻结`c24fe4d…`→review-fix `c94916a…`仅在既有`file-transfer.ts`增加`screenshot` operation，并在`render-tools.ts`与focused test组合公开file gate；review回修只调整preflight I/O/cancellation boundary。无credential/runtime/browser/package owner接线，`tasks.md`保持5.1未勾。冻结source/test与QA时工作树byte-exact一致。 |
| Task 5.1 preflight/body order audit | **PASS**：preflight严格执行current policy deny→public `LocalFileSystem` constructor proof→pure closed args→Session cwd/current policy root `resolve/contains`→fixed ask；approval前不调用`stat`、create/write或explicit `processPath()`。accepted body从同一冻结args重新执行current policy/provider/cwd/root/symlink/containment及cwd directory `stat` gate，随后仅一次explicit destination `processPath()`，再进入probe/capture/publication。provider内部canonical resolve转换不计为该explicit调用。 |
| independent approval/immutability probe | **PASS**：真实rc.2 ToolRuntime下`rejected`、`cancelled`、`unavailable`与未安装ApprovalService四种结果均为body/probe/capture/publish/explicit-processPath 0。ask恒为`Workspace screenshot writes PNG files to a Host-local Session directory.`且不含caller path。ToolRuntime在preflight前detached deep-freezes arguments；approval期间修改原caller object不影响body，approved canonical directory仍使用冻结值且explicit `processPath()`恰1次。Session header/cwd同样detached、deep-frozen且外部源对象修改不生效。 |
| independent body-drift/secrecy probe | **PASS**：accepted body中的policy切换为read-only、workspace root收窄、public LocalFS prototype proof丢失及output symlink指向cwd外均在explicit `processPath`与probe/capture/publish前fail closed。绝对Host path包含`HOST_PATH_SENTINEL`的越界结果只保留`workspace-file-path-outside-session`，Native result中无sentinel。 |
| default directory/basename/layout audit | **PASS**：省略output使用Session-relative`screenshots`；LocalFS返回realpath canonical directory（macOS `/var`规范化为`/private/var`属于provider canonicalization）；Task 4的safe unique basename与exact location gate保证所有outputs位于approved directory。layout lint不匹配screenshot listener、不请求approval、不调用file provider/processPath/publish；proposal/README明确其browser computation不等于Chromium sandbox。 |
| Task 5.1 review-fix cancellation revalidation | **PASS**：pre-aborted listener直接delegate给registry；deferred first provider resolve期间caller abort先等待active resolve settle，再delegate，结果为canonical `ABORTED_BEFORE_DISPATCH`；pending approval期间caller abort同样返回registry canonical `ABORTED_BEFORE_DISPATCH`。两条路径approval/body/stat/explicit-processPath/probe/publish均为0，abort reason sentinel未进入结果。 |
| Task 5.1 review-fix preservation | **PASS**：approval pending及`rejected`/`cancelled`/`unavailable`时`stat`、create/write与explicit `processPath`保持0；fixed reason无caller path。approved default严格得到`join(realpath(cwd), "screenshots")`，body `stat`一次且explicit `processPath`一次；既有policy/provider/root/symlink drift及layout no-ask/no-file cases继续通过。 |
| Task 5.1 focused/full DSH | **PASS**：review-fix focused `render-tools.test.ts`为1 file、25 cases；完整`pnpm --filter dsh-univer-work test`为10 files、528 tests。计数包含共享工作树中后续Task 6测试增长，不改变冻结Task 5 source结论。 |
| Task 5.1 typecheck/build | **PASS**：Client Core与DSH typecheck；Client Core build；DSH build。 |
| Task 5.1 strict/diffcheck | **PASS**：`openspec validate add-dsh-render-verification-tools --strict`；冻结range scoped diffcheck及最终working/cached diffcheck通过。 |

## QA 结论

**TASK 5.1 FOUNDATION PASS，0 open issues。** Task 1–4 foundation继续PASS。截图preflight与approved body已复用Change 5的公开
LocalFS/policy/containment seam；approval前zero-stat/create/processPath、四类非授权、immutable arguments、current policy/root/provider/symlink
revalidation、fixed secret-free ask、两条pending cancellation的canonical `ABORTED_BEFORE_DISPATCH`、exact single explicit `processPath`、default directory、
Host-path secrecy与layout no-file/no-approval均由独立rc.2 source audit、ToolRuntime barriers及25个focused cases复验。
Task 5.1仍为**PARTIAL/未勾选**：authentication/current runtime/browser/file publication的production组合与total lifecycle属于Task 6，真实browser/package
closure属于Task 7。Change仍未完成全部8项，因此整体**NOT READY TO ARCHIVE**。

## Task 6.1 production composition 独立 QA

### 冻结边界

- baseline：`c94916ae4ccd564c072109c71d86038c5c548490`。
- implementation scoped tree：`955828cfefa7c0f3d2337364b933d59dc7d9df8b`。QA开始与结束时逐个核对
  `authentication.ts`、`content-runtime-generation.ts`、`render-tools.ts`、`render-tools.test.ts`、`vite.config.ts`、Core
  `index.ts`/`render-unit.ts`和`tasks.md`的blob，均与该tree byte-exact一致。
- 本轮只修改本QA报告，不修改产品代码、测试或tasks，不commit/push/archive。

### Task 6.1 findings

| ID | Severity | Evidence | Expected | Status |
| --- | --- | --- | --- | --- |
| WT-RENDER-QA-008 | High | `apps/dsh-univer-work/src/render-tools.ts:912-988`在任何production阶段收到exact `WorkspaceApplicationError("workspace-screenshot-output-partial", detail)`时都保留partial；`projectPartialOutput()`只检查absolute `location`和safe basename。它不要求publication已经开始，不要求`committedOutputCount > 0`，不把`totalOutputCount`、name/location/order/uniqueness绑定到首PNG前已验证的capture candidate和approved directory，也不要求`location === join(directory, name)`。因此source/browser/capture可用正确constructor+closed shape伪造partial，`committedOutputCount: 0`、重复identity或`/HOST_PATH_SENTINEL/secret.png`均会成为model-visible confirmed output。现有malformed test只覆盖缺字段/unknown key，未覆盖正确shape但错误authority。 | partial只能由writer的post-commit阶段产生；exact detail必须有至少一个commit，并逐项等于approved、prevalidated candidate identity。任何phase、count、identity或directory不匹配必须降级`workspace-render-operation-failed`，不得泄漏Host path。 | **CLOSED / VERIFIED**（见回修复验） |
| WT-RENDER-QA-009 | High | screenshot在`tools/pre-execute`返回`ask`后，`WorkspaceToolOwner.run()`尚未开始，owner没有跟踪该call。rc.2 ApprovalService只用原`exec.signal`竞速approval；authentication cleanup的`stopAccepting → unregister → owner.abort → owner.drain`看不到pending approval，因此fiber dispose可在approval Promise仍pending时完成。用户之后允许时ToolRuntime重新resolve已注销tool并返回unknown-tool；若用户不回答，execution一直不settle。`render-tools.test.ts`只验证accepted body/browser/worker drain，没有approval barrier。 | owning fiber在approval活跃时也必须取消并等待该execution settlement；dispose后不得留下pending approval/tool Promise，也不得依赖用户以后回答来收敛。 | **CLOSED / VERIFIED**（见回修复验） |
| WT-RENDER-QA-010 | High | review发现production screenshot/layout在authoritative probe取得Worktree target与Slide page mapping后，又通过Core `loadUnit({scope, unitId})`解析一次host target。两次HTTP读取间若Worktree revision或`slideOrder`变化，browser会加载第二个target，而output validator仍使用首个probe identity，造成同一次operation混用revision/page authority。 | probe后所有host UnitData、reference/Embed解析、Worktree Asset、capture与lint必须使用同一个resolved target；不得二次解析host。既有`loadUnit()`与CLI omitted-signal调用保持兼容。 | **CLOSED / VERIFIED**（见resolved-target回修复验） |

### Task 6.1 已通过项

- production mount复用同一`WorkspaceToolOwner`、current `WorkspaceContentRuntimeGenerations`、authenticated source与application license resolver；
  `resolveLicense()`只是把既有resolver变为同owner的public method，credential record update listener与generation retirement路径未复制。
- screenshot/layout均使用package-relative`./render-runtime`和`process.env`，每次operation通过既有Core loader、screenshot/layout feature与真实
  Core PNG writer；success路径写入exact bytes并且browser close一次。bundle facade仍只导出`name`、`inject`、`apply`。
- exact SDK error recognition通过三个public `instanceof` guards后再做frozen membership gate；source/runtime/screenshot/lint、unknown failure、
  `BROWSER_UNAVAILABLE` guidance与继承detail的message/cause/content/license/cookie sentinels均被净化。
- caller late complete success由rc.2保留canonical `ABORTED`并追加fixed inspect/no-replay guidance；partial在caller/owner cancellation前决胜；
  accepted body disposal会等待browser close、runtime lease与generation close，新dispatch因unregister/owner admission gate被拒绝。
- 没有新增Job、browser pool、daemon、retry/replay或detached browser work。
- Task 7的installed closure仍未实施：DSH build明确警告`./render-runtime`在build time不存在，当前`dist/render-runtime`缺失；这属于已知且
  正确保留的Task 7 expected warning，本轮不把它误记为Task 6 regression。

### Task 6.1 实际执行

| 命令/探针 | 结果 |
| --- | --- |
| frozen scoped blob audit | **PASS**：8个implementation files均与tree `955828f…`一致；scoped diff只含production composition、tests与Task 4–6 checkbox更新。 |
| `pnpm --filter dsh-univer-work exec vitest run --config vitest.config.ts test/render-tools.test.ts` | **PASS**：1 file，34 tests。 |
| `pnpm --filter dsh-univer-work test` | **PASS**：10 files，537 tests；先完成production build。 |
| `pnpm --filter @univerjs/univer-workspace-client-core test -- render-unit.test.ts screenshot.test.ts screenshot-output.test.ts layout-lint.test.ts` | **PASS**：Vitest实际执行Core full 27 files，612 tests。 |
| Core/DSH typecheck+build | **PASS**：两个package typecheck；Core build含render page；DSH build完成。 |
| `openspec validate add-dsh-render-verification-tools --strict` | **PASS**。 |
| frozen/working/cached `git diff --check` | **PASS**。 |

### Task 6.1 首轮 QA 结论

**FAIL，2 open High。** Production runtime/source/license/browser/writer组合、常规error secrecy、late caller cancellation与accepted-body drain均有
可执行证据，但partial output仍未绑定approved authoritative candidate，pending approval也不在owner total lifecycle内。Task 6.1 checkbox应保持
未完成，Tasks 4.1/5.1不能据此升级为完整production PASS。Task 7 render-page/browser installation closure仍是expected pending工作；Change整体
**NOT READY TO ARCHIVE**。

## Task 7.1 回修 1–5 独立复验

### 固定实现与复验边界

- synthetic full tree：`a29e0b5e72edbe43f4d0ad09a612a905b11fa0b8`。
- 回修blob：`verify-package.mjs` `ee3f0c23d59ca61845f174569c7ea93db80ce814`、`smoke-package.mjs`
  `94f7334c0282e18737d2c43aa83fa393aa6789bb`。其余Task 7 blob保持：`package.json`
  `98d2e2e744d936f361a553b0fc0891d15935b13e`、`vite.config.ts`
  `2cad053f081107b9e857ce05f2a3e8bf5d5b6673`、`package-content-runtime.mjs`
  `35cff9a7ee7013b8cbe7894808716c04a7b088cd`、`pnpm-lock.yaml`
  `a79bff25bb69ba6ff3c22a6c12062fce90b3db81`。
- Task 7 task blob仍为`caecdb8a7183bcae412ab598e72dd1f73317fb4f`，Task 7.1保持未勾选。本轮只修改本QA报告，
  不修改product、tests、tasks，不commit。

### 原finding复验

| ID | 回修证据与独立结果 | Status |
| --- | --- | --- |
| WT-RENDER-QA-011 | verifier现在从`dist/render-runtime/index.html`遍历HTML、JS与CSS local graph，并要求当前104个render files与reachable set exact相等；backtick dynamic import missing target、unreachable `future.js`和remote JS import三个synthetic negative均被拒绝。实际artifact同时通过missing/extra、remote、sourcemap、browser/cache/binary、checkout/private Core和future resource bans。 | **CLOSED / VERIFIED** |
| WT-RENDER-QA-012 | 本机没有可用于该轮QA的restricted OS user/container和bounded browser filesystem/network环境；本轮真实Chrome仍由当前登录用户运行。temp profile、unrelated cwd、LocalFS containment或same-user sandbox不能冒充process isolation。 | **OPEN / ENVIRONMENT UNAVAILABLE** |
| WT-RENDER-QA-013 | actual installed Agent Loop与Code Mode现在都调用`screenshot`和`layout_lint`；两条路径验证exact canonical value/report、176×48 PNG解码及前景/背景contrast，approval只包含screenshot，read-only policy在render前拒绝，transcript/result执行secret-negative。Native direct、credential replacement、caller pre-abort也通过。但installed smoke没有直接执行65,536-byte arguments、30 pages、10,000 lint selectors、8,388,608-byte result或相应max+1 render budget case；脚本中没有render limit code/constant断言。 | **OPEN / PARTIAL：installed budget evidence缺失** |
| WT-RENDER-QA-014 | actual installed plugin在运行中把explicit browser替换为不存在的secret sentinel，得到sanitized `BROWSER_UNAVAILABLE` guidance；sentinel、checked paths、cache/env字段均不可见，PNG目录不存在，browser process集合不变，新增fetch全部只指向fixture origin。独立smoke前后Puppeteer cache为空；并发smoke收敛后remote-debugging Chrome、worker child、smoke/temp目录和listening process均无残留。 | **CLOSED / VERIFIED** |

Deterministic partial通过真实installed writer的首图link后注入第二目标winner，稳定返回exact partial，保留`page-01.png`和既有
`page-02.png`、无temp。Pre-aborted caller返回`ABORTED_BEFORE_DISPATCH`且零目录。Smoke使用显式browser env，从fresh unrelated
profile/run cwd加载actual tarball；physical render-runtime owner解析为`1.0.0-beta.2`，owner-relative actual
`puppeteer-core@25.8.0`与`@puppeteer/browsers@3.2.1`和packed/installed manifest exact一致。

### 回修中新增findings

| ID | Severity | Evidence | Expected | Status |
| --- | --- | --- | --- | --- |
| WT-RENDER-QA-015 | Medium | `smoke-package.mjs:70-74`只对caller提供的`UNIVER_RENDER_BROWSER`执行trim和当前cwd下的`access(X_OK)`，随后原字符串传入unrelated cwd child。相对值会按child cwd重新解析；独立probe以当前cwd存在的relative executable证明parent access成功而`/tmp`下同一字符串失败。 | 顶层校验后把browser path解析为absolute physical path（包括适用的`realpath`），再传给installed child；absolute输入行为保持。 | **OPEN** |
| WT-RENDER-QA-016 | Low | verifier实现会扫描CSS `@import`和quoted/bare `url()`并拒绝remote/missing ref，但synthetic negatives只直接锁定backtick JS missing、extra future JS和remote JS import；CSS remote/missing回归没有独立negative。 | 增加最小CSS graph negative，锁定remote `url()`/`@import`和missing local asset拒绝行为。 | **OPEN** |
| WT-RENDER-QA-017 | Low | installed secrecy断言使用固定literal regex，并从transcript projection中主动剔除DSH argument fields。当前已覆盖既有sentinels，但fixture新增或改名的secret不会自动加入断言，render Agent/Code的输入secret也缺少由fixture统一派生的完整negative set。 | 从fixture-owned secret集合生成统一negative assertion，并明确区分允许存在的caller arguments与不得进入result/render/approval/log的字段。 | **OPEN** |

### 实际执行

| 命令/探针 | 结果 |
| --- | --- |
| fixed blob/task audit | **PASS**：两个new blobs、其余Task 7 blobs及unchecked task blob与上述值byte-exact。 |
| Core render page + DSH rebuild | **PASS**：Core 1,988 modules；DSH 1,181 modules；package-relative render graph为exact 104 files。 |
| actual pack/fresh install/manifest resolution | **PASS**：从unrelated temp install解析actual tarball、plugin manifest及owner-relative exact 1.0.0-beta.2/25.8.0/3.2.1。 |
| `UNIVER_RENDER_BROWSER=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome pnpm --filter dsh-univer-work package:verify` | **PASS**：含三个synthetic render-graph negatives与当前artifact bans。 |
| 同一explicit browser运行`pnpm --filter dsh-univer-work package:smoke` | **PASS**：actual installed Native、Agent Loop、Code Mode real Chrome screenshot/lint、missing-browser、partial/pre-abort、credential replacement与bounded dispose全部完成。 |
| DSH focused render | **PASS**：1 file、50 tests。 |
| `pnpm --filter dsh-univer-work test` | **PASS**：10 files、553 tests；build先完成。 |
| Core/DSH typecheck | **PASS**。 |
| Core/DSH build | **PASS**：由verify、smoke及full DSH test重复完成。 |
| `openspec validate add-dsh-render-verification-tools --strict` | **PASS**。 |
| working/cached `git diff --check` | **PASS**。 |
| restricted user/container gate | **ENVIRONMENT UNAVAILABLE**：未执行，不以same-user fixture替代。 |

### Task 7.1 回修 QA 结论

**FAIL，2 open High、1 open Medium、2 open Low。** QA-011与QA-014已关闭；installed Agent/Code real-render、exact PNG/report、
approval/policy/secrecy、deterministic partial、pre-abort、credential replacement和cleanup均通过。QA-012因本轮环境没有restricted
OS user/container而保持open；QA-013仍缺installed render budget直接证据。显式relative browser path语义为新增Medium；CSS negative和
fixture-derived secrecy assertion为两个Low。Task 7.1保持未勾选，Task 8/repository final gates不计入本轮Task 7复验，Change仍
**NOT READY TO ARCHIVE**。

## Task 6.1 回修独立复验

### 固定实现与复验范围

- 回修实现blob固定为：`render-tools.ts` `93150fdf8aa0ad1818bbc13a9178106f4b87126e`、`authentication.ts`
  `0f617a9e2f56339ceeda5725acc73b494af30a03`、`tool-owner.ts` `fb923b651146054f20dde7f3b8170715ebd8f704`、
  `render-tools.test.ts` `fd707fe070e70de679136889c6f1f05999fb09b6`、`authentication.test.ts`
  `ab845af9f725ef532ae5de1787dc17bbfd98029e`、`vite.config.ts` `f9da51d02270c918ef8ef2cb0ef2438917bf7ce6`、
  Core `render-unit.test.ts` `154fb1d2265b10ac5a496e5425947a0dac89686b`、`tasks.md`
  `c96a424a24499aa99e701aaee14785d4d7d8c602`。
- 本轮复验只更新本QA报告；没有修改产品、测试、tasks，也没有commit、push或archive。

### Finding closure

| ID | 回修证据 | 独立复验结果 | Status |
| --- | --- | --- | --- |
| WT-RENDER-QA-008 | `executeScreenshot()`只在`publishScreenshots()`边界调用partial projector。`projectRenderDependencyFailure()`拒绝其他阶段的partial。publication projector要求exact detail keys、candidate exact total、正数committed prefix、合法cause code，并逐项重建candidate的name/location/order；wrong total、zero、extra key/path、wrong location、duplicate或reorder全部generic。 | 合法post-commit partial保留confirmed prefix与fixed no-replay guidance。source/browser/capture partial、zero commit、malformed/extra path及所有authority mismatch均返回`workspace-render-operation-failed`；cause、Host path、forged identity等sentinel未出现在Native result。 | **CLOSED / VERIFIED** |
| WT-RENDER-QA-009 | screenshot pre-execute在preflight/approval前登记execution token，并在同一`WorkspaceToolOwner.run()`的fused signal内只请求一次approval。root `tools/result` listener在所有terminal result释放token。cleanup先停止admission并unregister，再owner abort，随后并行drain owner、registration及worker generation，最后移除root listener。 | pending approval在owner dispose时先settle为`workspace-plugin-disposing`，execution先于dispose完成；preflight error、denial、success及body failure均释放token。no-service保持fixed denial；caller abort保持rc.2 identity；deny/cancel不启动body。listener在drain后移除，正常unmount/remount没有stale registration；accepted body、browser close及worker generation均完成后dispose才返回。 | **CLOSED / VERIFIED** |

### Production composition 复验

- authentication真实mount注册screenshot/layout tools，fiber dispose后注销；两项render tools与现有auth、current source、current
  `WorkspaceContentRuntimeGenerations`、license resolver和credential update/retirement路径共用同一owner，没有复制credential或runtime owner。
- Core只接受真实public `UnitScreenshotError`、`UnitLayoutLintError`和`UniverRenderError`构造器；同形伪造对象被拒绝。
  DSH继承的source/Asset/runtime/screenshot/lint和browser missing投影只保留closed code及窄safe detail；message、stack、cause、
  UnitData/content/bytes、credential/license/cookie、selector和Host path sentinel均未进入result/render。
- render root由`new URL("./render-runtime", import.meta.url)`解析；环境只取`process.env`。真实Core writer产出exact PNG bytes；
  screenshot/layout success为authoritative canonical output，browser在success/failure/abort后均close。
- partial优先于caller/owner cancellation；普通caller/owner取消分别保持cancelled/disposing；late successful caller abort由rc.2返回
  `ABORTED`和fixed inspect/no-replay guidance。stop-admission/unregister拒绝新work；owner drain、accepted body、browser close和worker
  generation drain都没有detached continuation。
- production bundle facade只导出`apply`、`inject`、`name`；`dist/worker.js`和独立runtime-pool chunk存在。bundle没有bare private Core、
  CLI/source checkout import。实现没有新增Job、browser pool、daemon、retry/replay或后台服务。

### 回修实际执行

| 命令/探针 | 结果 |
| --- | --- |
| fixed blob audit | **PASS**：8个回修blob与上述固定值byte-exact一致。 |
| DSH focused render/auth | **PASS**：`test/render-tools.test.ts`、`test/authentication.test.ts`共2 files、106 tests。 |
| Core focused render | **PASS**：`render-unit`、`runtime-source`、`screenshot`、`screenshot-output`、`layout-lint`共5 files、105 tests。 |
| `pnpm --filter dsh-univer-work test` | **PASS**：10 files、551 tests。 |
| `pnpm --filter @univerjs/univer-workspace-client-core test` | **PASS**：27 files、613 tests。 |
| Core/DSH typecheck+build | **PASS**：两个package typecheck与build均完成。 |
| production bundle inspection | **PASS**：root exports exact `apply`/`inject`/`name`；worker与runtime-pool存在；无private Core、CLI或source checkout bare import。 |
| `openspec validate add-dsh-render-verification-tools --strict` | **PASS**。 |
| working/cached `git diff --check` | **PASS**。 |
| `pnpm --filter dsh-univer-work package:verify` | **EXPECTED TASK 7 FAIL**：verifier在vendor chunk中仍识别local checkout path；installed closure尚未完成。 |
| `pnpm --filter dsh-univer-work package:smoke` | **EXPECTED TASK 7 FAIL**：smoke仍使用Task 7前的旧tool list，未接受新增`screenshot`/`layout_lint`。 |

### Task 6.1 回修 QA 结论

**PASS，0 open findings。** WT-RENDER-QA-008与WT-RENDER-QA-009均已关闭；Task 6.1 production composition满足冻结design的
authority、secrecy、cancellation和total lifecycle边界。`tasks.md`在固定blob中仍将Tasks 4.1、5.1、6.1保留为未勾选，需由实现/review
owner在双轴review后更新。Task 7的installed render-runtime closure、真实browser与package verifier/smoke仍待完成，因此Change整体仍
**NOT READY TO ARCHIVE**。

## Task 6.1 resolved-target 回修独立复验

### 固定实现

- 新回修blob：Core `render-unit.ts` `86494808f171eb248fefe20ceb660f4f5a761924`、Core `render-unit.test.ts`
  `c33a194d8664e63656303694d6eac35e24a92169`、DSH `render-tools.ts`
  `0d7609d9cde9825991ac3f1084c914bc4e15754c`、DSH `render-tools.test.ts`
  `42cc6f3bd9653c48326aaa4c5ba4734d230ff7c9`。
- 前轮生命周期blob保持：`authentication.ts` `0f617a9e2f56339ceeda5725acc73b494af30a03`、`tool-owner.ts`
  `fb923b651146054f20dde7f3b8170715ebd8f704`、`authentication.test.ts`
  `ab845af9f725ef532ae5de1787dc17bbfd98029e`、`vite.config.ts` `f9da51d02270c918ef8ef2cb0ef2438917bf7ce6`、
  `tasks.md` `c96a424a24499aa99e701aaee14785d4d7d8c602`。
- 本轮仍只修改本QA报告，没有修改产品、测试、tasks，也没有commit。

### WT-RENDER-QA-010 closure

- Core新增`loadResolvedTarget({ target, signal? })`，直接进入与旧`loadUnit()`共用的private assembly path。该路径不调用host
  `resolveRuntimeTarget`/`resolveTrunkRuntimeTarget`；host UnitData使用exact input target，formula与Embed的
  `resolveReferencedRuntimeTarget()`接收同一个`hostTarget`，Worktree Asset resolver使用该target的`worktreeId`。
- DSH screenshot与layout在probe后把exact `input.target`传给`loadResolvedTarget()`。screenshot capture直接消费返回的完整render Unit；
  layout lint直接消费同一Unit的`unitData`及formula references。两条路径均不再调用feature的legacy host loader。
- production drift fixture让第一次Worktree读取返回revision 7、潜在第二次读取返回revision 8，并让两版`slideOrder`相反。
  screenshot与layout各自都只有一次Worktree request；probe mapping和browser load两次UnitData export均为revision 7，operation成功。
- 独立built-Core probe把resolved Worktree Board target设为revision 7，同时配置会返回revision 8的legacy host resolver；实际host resolve为0，
  host export revision 7，reference resolver收到revision 7的`hostTarget`，Asset只解析同一Worktree `wt-1`。reference自身的resolved
  revision 5仍按其独立authoritative target export。
- 旧`loadUnit({scope, unitId, signal?})`继续解析一次host并委托同一assembly path；Core compatibility test比较两种入口得到相同结果。
  CLI screenshot/layout/SVG adapters继续省略signal，focused suite保持13/13。
- 原target type/mismatch在authoritative probe后、browser前失败的顺序不变；pre/mid-operation cancellation、exact dependency constructor、
  safe error detail、browser close、partial publication priority及approval/owner lifecycle回归全部通过。

### resolved-target 实际执行

| 命令/探针 | 结果 |
| --- | --- |
| fixed blob audit | **PASS**：9个新/继承blob均与上述固定值byte-exact一致。 |
| Core render focused | **PASS**：5 files、106 tests。 |
| DSH render/auth focused | **PASS**：2 files、108 tests；包含QA-008 sentinel/partial和QA-009 token/approval/dispose cases。 |
| built-Core resolved-target probe | **PASS**：host resolve 0；export revisions `[7,5]`；reference host revision 7；Asset Worktree `wt-1`。 |
| `pnpm --filter @univerjs/univer-workspace-client-core test` | **PASS**：27 files、614 tests。 |
| `pnpm --filter dsh-univer-work test` | **PASS**：10 files、553 tests。 |
| CLI screenshot/lint/SVG focused | **PASS**：3 files、13 tests。 |
| Core/DSH/CLI typecheck | **PASS**。 |
| Core/DSH build | **PASS**；DSH的missing `./render-runtime` warning仍属于Task 7 installed closure。 |
| `openspec validate add-dsh-render-verification-tools --strict` | **PASS**。 |
| working/cached `git diff --check` | **PASS**。 |

### resolved-target 回修 QA 结论

**PASS，0 open findings。** WT-RENDER-QA-010已关闭，既有WT-RENDER-QA-008与WT-RENDER-QA-009保持关闭。
screenshot/layout从authoritative probe到render/lint完成始终使用同一个resolved target，旧Core loader和CLI caller保持兼容。
Task 7 package closure与真实browser仍待完成，因此Change整体仍**NOT READY TO ARCHIVE**。

## Task 6.1 single-loader Standards Low 窄复验

- 固定`render-tools.ts` blob：`8310904248c2a1cc639c140ec7807b12cb450b8b`。截图operation只创建一个
  `WorkspaceRenderUnitLoader`，`createScreenshot(signal, loader)`把该exact instance注入`WorkspaceScreenshotFeature`，随后同一loader执行
  `loadResolvedTarget()`；已移除factory内未使用caller loader而另建第二个loader的冗余。layout路径原本已是single loader。
- resolved-target authority不变：probe target仍直接进入`loadResolvedTarget()`，没有恢复host二次解析。QA-010的screenshot/lint revision与
  `slideOrder` drift cases继续通过；QA-008的partial/sentinel和QA-009的token/approval/dispose关键cases也全部通过。
- `pnpm --filter dsh-univer-work exec vitest run --config vitest.config.ts test/render-tools.test.ts test/authentication.test.ts`：
  **PASS**，2 files、108 tests。
- `pnpm --filter dsh-univer-work typecheck`：**PASS**。working/cached `git diff --check`：**PASS**。

结论：**PASS，0 open findings。** 该Low已关闭，WT-RENDER-QA-008、009、010保持`CLOSED / VERIFIED`；Task 7状态不变。

## Task 7.1 installed render closure 独立 QA

### 固定实现与验收范围

- fixed implementation full tree：`ffb32fbb6a99635975cd4b4cf3c4888613bbd487`。
- fixed blobs：`package.json` `98d2e2e744d936f361a553b0fc0891d15935b13e`；`vite.config.ts`
  `2cad053f081107b9e857ce05f2a3e8bf5d5b6673`；`package-content-runtime.mjs`
  `35cff9a7ee7013b8cbe7894808716c04a7b088cd`；`verify-package.mjs`
  `27c61c7eb6d8e85b401ccdbe72aa1d7b242379ad`；`smoke-package.mjs`
  `244b530ea5dce620e678189262f380432bfed214`；`pnpm-lock.yaml`
  `a79bff25bb69ba6ff3c22a6c12062fce90b3db81`。
- 本轮只修改本QA报告；不修改product、tests、tasks或其他OpenSpec artifacts，不commit/push/archive。
- 独立重建Client Core render page和DSH Host，生成actual tarball，在unrelated `/tmp`
  cwd安装并从installed plugin manifest重新解析browser packages；运行真实Chrome installed smoke。

### Task 7.1 findings

| ID | Severity | Evidence | Expected | Status |
| --- | --- | --- | --- | --- |
| WT-RENDER-QA-011 | High | `verify-package.mjs` 把当前 `dist/render-runtime/**` 全部加入expected files，`assertRenderAssetClosure()`只从每个文件检查部分local reference是否存在，不从`index.html`建立reachable set，也不要求每个packed render asset可达。该scanner只匹配HTML `src`/`href`和少数`./asset` JS forms，不拒绝JS remote import/URL或CSS remote `url()`。因此一个合法扩展名的unreferenced/future asset或未匹配remote asset可同时进入artifact并通过verifier。 | Verifier必须从render entry遍历完整local graph，要求packed render files exact reachable，并对HTML/CSS/JS的remote asset和future/unowned resource fail closed。 | **OPEN** |
| WT-RENDER-QA-012 | High | Installed smoke在当前登录用户下运行，`env = { ...process.env }`，启动beta.2 `--no-sandbox` Chrome时没有创建restricted OS user/container，也没有为browser约束filesystem/network。临时`DSH_HOME`、run cwd、LocalFS Session containment不是process isolation；smoke本身可读取checkout和访问公网。 | Task 7安装态演练必须真实运行于restricted OS user/container，并将browser filesystem/network限定到fixture所需边界，不得用temp cwd或approval代替该证明。 | **OPEN** |
| WT-RENDER-QA-013 | High | Installed Native direct ToolRuntime调用确实生成PNG和exact lint report，但Agent Loop `agentCalls`与Code Mode `dispatches`均没有`workspace_screenshot`/`workspace_layout_lint`。PNG断言仅检查signature、非零尺寸与部分metadata，没有比对closed exact metadata或内容证据；installed render也没有覆盖screenshot approval/policy/limit分支。 | Actual tarball必须在Native、Agent Loop和Code Mode三个入口验证两个render tools，对PNG内容/完整metadata与closed report做可以防止blank/wrong render的exact断言，并直接证明installed approval/policy/budget边界。 | **OPEN** |
| WT-RENDER-QA-014 | High | Smoke在进入安装前就要求existing Chrome并始终设置valid `UNIVER_RENDER_BROWSER`；没有从actual installed package运行missing-browser分支。因此未证明其返回sanitized `BROWSER_UNAVAILABLE`、不暴露checked path/env，且不隐式下载或访问公网。 | 在没有explicit browser/cache/system candidate的受限installed fixture中直接调用render tool，验证exact sanitized code/guidance、zero browser work和zero download/public-network request。 | **OPEN** |

### 已通过的closure与真实运行证据

- Core render-page build和DSH build均PASS。DSH `dist` 110 files/56,288 KiB，其中render-runtime
  104 files/32,976 KiB；actual tarball 115 entries/11,873,699 bytes，独立安装后plugin package
  52,927,669 bytes。无显式size gate超限。
- physical Client Core graph解析到`@univer-cli/univer-render-runtime@1.0.0-beta.2`；owner manifest ranges为
  `puppeteer-core ^25.3.0` / `@puppeteer/browsers ^3.0.6`，owner-relative physical manifests实际为
  `puppeteer-core@25.8.0` / `@puppeteer/browsers@3.2.1`。Packed manifest与fresh installed
  resolution均exact相等，且resolved paths全部位于unrelated temp install的`node_modules/.pnpm`。
- 当前artifact清单无sourcemap、browser binary/cache、bare private Core、`workspace:*`、CLI/source/test/scripts、
  Typst/SVG resource；Host/worker/chunk imports、worker-child/formula/exchange native binding与package targets通过现有verifier。
- Installed real ToolRuntime直接调用产生可解码PNG和exact empty lint report；pre-dispatch caller abort零目录，
  10-page screenshot在首图后取消返回exact partial code、保留strict subset PNG且无temp。Credential
  replacement产生新worker并再次真实截图成功。
- Owner dispose中的browser、worker、file和accepted body在10s bound内settle；remount正常。Smoke前后未发现
  remote-debugging Chrome、`worker-child.mjs`、DSH smoke/run temp directory或Node/Chrome listening port残留。

### Task 7.1 实际执行

| 命令/探针 | 结果 |
| --- | --- |
| fixed blob audit | **PASS**：6个implementation blobs与固定值byte-exact；Task 7.1保持未勾选。 |
| independent Core render page + DSH build | **PASS**：Core 1,988 modules，DSH 1,181 modules；render graph被复制到package-relative `dist/render-runtime`。 |
| actual pack/fresh unrelated install | **PASS**：115 packed entries；installed package/manifest与25.8.0/3.2.1 resolved manifests均从temp install闭包解析。 |
| artifact list/size/current bans | **PASS**：当前artifact无forbidden file/path/import；尺寸见上。Verifier的future/reachability/remote fail-closed缺口另记QA-011。 |
| `pnpm --filter dsh-univer-work package:verify` | **PASS**。 |
| `pnpm --filter dsh-univer-work package:smoke` | **PASS**：使用existing Google Chrome和actual installed profile；未下载browser。QA-012–014仍是coverage/boundary缺口。 |
| DSH focused render | **PASS**：1 file，50 tests。 |
| `pnpm --filter dsh-univer-work test` | **PASS**：10 files，553 tests。 |
| Core/DSH typecheck | **PASS**。 |
| Core/DSH build | **PASS**。 |
| `openspec validate add-dsh-render-verification-tools --strict` | **PASS**。 |
| working/cached `git diff --check` | **PASS**。 |

### Task 7.1 QA 结论

**FAIL，4 open High。** 当前artifact的实际文件、owner-relative exact versions、真实Chrome Native screenshot/lint、
partial cancellation、credential replacement、bounded dispose和cleanup均通过。Verifier尚不能拒绝unreachable/future/remote
render resources；smoke没有运行在restricted OS user/container内，没有将render tools透过Agent Loop/Code Mode执行，
也没有验证actual installed missing-browser无下载分支。Task 7.1保持未勾选；Change仍为6/8，
**NOT READY TO ARCHIVE**。

## Task 7.1 当前复验状态

上面的“Task 7.1 回修 1–5 独立复验”覆盖new synthetic tree `a29e0b5e72edbe43f4d0ad09a612a905b11fa0b8`，
并取代本节首轮结论作为当前状态：QA-011与QA-014已关闭；QA-012、QA-013、QA-015、QA-016、QA-017保持open。
当前结论为**FAIL，2 open High、1 open Medium、2 open Low**；Task 7.1保持未勾选。

## Task 7.1 QA-013/015/016/017 最新独立复验

### 固定树与blob

- 最新回修前QA synthetic tree：`d2321922151cd0d193d46b9ec57873a6745dedde`；它以回修1–5树
  `a29e0b5e72edbe43f4d0ad09a612a905b11fa0b8`为基线，并保留上一轮QA report blob
  `e746c1083d53dab0b74ae8b39427b2cab4b99c5c`。
- 最新回修blob：`verify-package.mjs` `e21e3d6e879a5b76a9c321b8167f3fc210e3ffda`、`smoke-package.mjs`
  `08304eb14be7727fac13c29900d1059cd73becf2`、`vite.config.ts`
  `ff132d2e455df07775a463944caf1056210a3632`、`render-result-budget.ts`
  `41efaf79bbb95f6d9febb6ca27763eef87914d8d`、`render-tools.ts`
  `eb8329da916ec70942feca1bd55625beff692baf`。root `index.ts`保持
  `8c8867a0b64425e847cf4861bb9acacda8ab220d`。
- `package.json` `98d2e2e744d936f361a553b0fc0891d15935b13e`、task blob
  `caecdb8a7183bcae412ab598e72dd1f73317fb4f`和lock
  `a79bff25bb69ba6ff3c22a6c12062fce90b3db81`保持不变；Task 7.1仍未勾选。本轮只更新本报告。

### Finding closure

| ID | 最新回修与独立证据 | Status |
| --- | --- | --- |
| WT-RENDER-QA-013 | production `render-tools.ts`与installed smoke的internal entry都引用build产生的同一个`render-result-budget-D2CSNmDL.js` shared chunk。Installed smoke从Agent `tools/post-execute`取得真实canonical screenshot/lint values，并从Code result取得同两项canonical values，再直接调用该production validator；exact 8,388,608 canonical bytes与depth 64通过，max+1分别按`render-result-bytes`与`render-result-depth`拒绝。Agent/Code仍完成真实176×48 contrast PNG、exact lint report、approval/policy及fixture-derived credential secret negative。 | **CLOSED / VERIFIED** |
| WT-RENDER-QA-015 | smoke在package startup cwd对configured value执行`resolve`→`realpath`→`access(X_OK)`，并只把absolute physical path传入fresh unrelated child。独立使用相对`UNIVER_RENDER_BROWSER=../../../../../../../Applications/Google Chrome.app/Contents/MacOS/Google Chrome`运行完整smoke成功；child再次断言env为absolute且realpath stable。Installed invalid explicit browser仍返回sanitized `BROWSER_UNAVAILABLE`、零PNG目录、进程集合不变且无public fetch。 | **CLOSED / VERIFIED** |
| WT-RENDER-QA-016 | verifier synthetic graph现在直接拒绝CSS missing local `@import`、remote `@import`和remote quoted `url()`；既有backtick JS missing、unreachable future JS、remote JS negatives及actual 104-file closure继续通过。 | **CLOSED / VERIFIED** |
| WT-RENDER-QA-017 | render secrecy断言从真实`runtimeReplacementAuthenticated.payload.cookie`取得sentinel，使用`RegExp.escape`生成pattern，并分别检查Agent results、Code projection和keyless transcript；没有再把render credential写成固定literal断言。剔除DSH caller argument字段仍只排除允许包含caller输入的event位置，canonical results/render/approval/log projection继续受negative assertion。 | **CLOSED / VERIFIED** |
| WT-RENDER-QA-012 | 本轮仍没有restricted OS user/container及bounded browser filesystem/network环境。真实Chrome smoke在当前登录用户下执行，不能作为该隔离证明。 | **OPEN / ENVIRONMENT UNAVAILABLE** |

### 新回归审计

- Installed/public root exports仍exact `apply`、`inject`、`name`。Budget internal entry只作为package-owned file-URL QA seam；
  `package.json#exports`没有该subpath，独立self-reference import返回`ERR_PACKAGE_PATH_NOT_EXPORTED`。
- Multi-entry build只增加1.77 KiB shared budget chunk和0.19 KiB internal entry；production与QA没有复制validator实现，worker、runtime pool、
  render-runtime和artifact bans保持通过。没有发现新的Task 7 product、package或test regression。
- 真实smoke结束后Puppeteer cache仍为空；并发任务收敛后无remote-debugging Chrome、worker child、smoke temp或listening process残留。

### 实际执行

| 命令/探针 | 结果 |
| --- | --- |
| `pnpm --filter dsh-univer-work package:verify` | **PASS**：含JS/CSS synthetic negatives、actual render graph、artifact/manifest/version/import closure。 |
| relative `UNIVER_RENDER_BROWSER`运行`pnpm --filter dsh-univer-work package:smoke` | **PASS**：fresh install、unrelated child、真实Chrome及全部installed render assertions通过。 |
| public/internal export probe | **PASS**：root keys exact；internal package subpath为`ERR_PACKAGE_PATH_NOT_EXPORTED`。 |
| DSH render focused | **PASS**：1 file、50 tests。 |
| `pnpm --filter dsh-univer-work test` | **PASS**：10 files、559 tests。 |
| Core/DSH typecheck | **PASS**。 |
| Core/DSH build | **PASS**：verify、smoke与full test均重建成功。 |
| `openspec validate add-dsh-render-verification-tools --strict` | **PASS**。 |
| working/cached `git diff --check` | **PASS**。 |
| restricted user/container gate | **ENVIRONMENT UNAVAILABLE**：未执行，不以same-user smoke替代。 |

### 最新Task 7.1 QA结论

QA-013、QA-015、QA-016、QA-017全部**CLOSED / VERIFIED**，本轮没有发现新回归。Task 7.1仅剩QA-012这一项
High环境缺口，因此当前结论为**FAIL，1 open High**。Task 7.1保持未勾选；Task 8/repository final gates不计入本轮复验，
Change仍**NOT READY TO ARCHIVE**。

## Task 7.1 restricted runner、Task 8.1 与全 Change 最终独立 QA

本节取代上面的历史状态与结论。最终复验在implement owner停止并完成稳定构建后顺序执行；本轮只修改本QA报告。

### 最终固定证据

- Task 7 runner：`Dockerfile.smoke` `a14841248c53b22e6c509f96826e756daf80a123`；
  `smoke-package-container.sh` `f56bb64c7e45868dec1acb74c1cd0a9cb1d596db`；
  `smoke-package.mjs` `94b58dc971e73d31cf5a9d0690b006119b8df16d`；
  `verify-package.mjs` `fa89ce66f1ab814253f5104ce783ae37d3017dc5`。
- Task 8 current-fact docs：root `README.md` `85b18088b3cf3d8d06a45e13ada6928b4fb5cf3e`；
  `DREAMNUM.md` `9f34a1fb0abd0a1e88eee31d11daa0e2f0320d1e`；root `AGENTS.md`
  `e43c5ede7db14ad52fc0aca6bfcde1f47c6252e1`；DSH `README.md`
  `a632b0555e5be090288a139efd7b63a16aaee16e`；Core `README.md`
  `40c6b0658cb57ab25f27a2e4bbcad1d7b9dbfa95`。
- OpenSpec：`proposal.md` `f472d40a05bb58cdf3a3213853af9dd625c6bf96`；`design.md`
  `311b4f18d2fdc78df9926fd4c6c436562d9fc028`；`tasks.md`
  `bff4e17aec85bd7b039b14ed92d0e7f64b234314`；`change.html`
  `3b55c4ce558ea233fd36d78df811d926b427e866`。`openspec instructions apply`报告8/8 complete、remaining 0、
  `state: all_done`。

### Findings closure

| ID | Severity | 独立复验 | Status |
| --- | --- | --- | --- |
| WT-RENDER-QA-012 | High | 实际cached restricted smoke在Linux/arm64容器内运行actual packed/fresh-installed plugin。容器UID/GID为65532，rootfs只读，`--network none`、无bind mount、无Docker socket、`cap-drop ALL`、`no-new-privileges`、PID 512、6 GiB、4 CPU；仅`/tmp` 4 GiB与`/dev/shm` 256 MiB为有界tmpfs。`/workspace`和`/etc`不可写。runtime设置`PNPM_CONFIG_OFFLINE=true`，浏览器与installed matrix在该边界内真实通过。 | **CLOSED / VERIFIED** |
| WT-RENDER-QA-018 | High | 首轮审计发现root `README.md`、`DREAMNUM.md`、`AGENTS.md`和DSH README仍宣称没有render tools。稳定树已分别列出exact两个工具`workspace_screenshot`、`workspace_layout_lint`，同时保留“无Web Client”的实际限制；Core/DSH职责和VM非sandbox边界一致。 | **CLOSED / VERIFIED** |
| WT-RENDER-QA-019 | Medium | 首轮proposal Domain Alignment引用相邻checkout绝对路径。稳定树改为repo-relative `apps/workspace/CONTEXT.md`及accepted ADR `apps/workspace/docs/adr/0007-co-locate-workspace-agent-clients.md`；两路径存在且内容支持当前owner边界。 | **CLOSED / VERIFIED** |
| WT-RENDER-QA-020 | Medium | 首轮restricted runner退出后留下该次build产生的dangling image。稳定脚本用iidfile记录exact image，在container cleanup之后只执行该image的`docker image rm`，不调用prune、不删除历史image。独立复跑的exact image `sha256:ed532d7f9f3f0de946149d65a136f91d217b181b16fffa919c5e4f3de0fafbad`与exact container均在trap后不存在，iidfile也已清除。 | **CLOSED / VERIFIED** |
| WT-RENDER-QA-021 | High | 初始stable verifier没有检查reachable JS的literal `fetch("https://…")`或真实`sourceMappingURL` directive。回修后，TypeScript AST只收集literal global `fetch()`参数，TypeScript scanner只收集exact单行sourcemap directive，再统一进入既有remote/absolute/bare/missing closure；普通documentation URL保持允许。Synthetic negatives直接拒绝HTTPS fetch、missing relative sourcemap与remote sourcemap。独立完整`package:verify`重建actual graph并通过全部cases。 | **CLOSED / VERIFIED** |

### Restricted runner 与offline closure

- Docker build stage使用digest-pinned Node base，并仅在image内部安装Chromium、字体和`procps`。runner固定
  `--platform linux/arm64` build/create并断言image architecture为`arm64`；非Linux host通过Docker运行，脚本不会修改host
  user、package manager或system browser。
- Runtime容器没有host bind、Docker socket或host package cache；`--read-only`加两个有界tmpfs构成全部显式可写mount，
  `--network none`封闭actual install、DSH、worker和Chromium的外部网络。
- Actual tarball安装后，seeding只遍历三个已知native binding owner（formula、exchange、Typst），按当前Linux/arm64 suffix读取
  owner manifest中的exact optional dependency与semver，再从offline store加入这三个package。真实formula、Office、Typst和render
  smoke全部通过，证明当前platform optional closure可加载；没有泛化复制其它optional package。
- Restricted smoke调用与普通`package:smoke`相同的`smoke-package.mjs` installed matrix，并增加OS、filesystem、network、
  resource和cleanup约束，因此本轮以restricted PASS作为普通smoke的更强复验。Smoke包括Native、Agent Loop、Code Mode、真实render、
  policy/approval/budget/cancel/missing-browser/dispose和Content/Office/Typst回归。
- 历史dangling images不属于本change，QA未删除它们。当前run的container、image和iidfile均由exact identity清理。

### Task 8 文档与OpenSpec一致性

- Root/DSH/Core README、DREAMNUM和AGENTS对两个render tools、LocalFS/Session cwd、approval、no-overwrite、partial output、
  browser/runtime、VM非安全sandbox、cancel/limits及native package closure的描述与current code一致，没有把上游Core边界写成shell policy owner。
- Proposal的Domain Alignment引用repo内authority与accepted ADR。Design和packed-artifact delta spec把browser/render resource约束限定在
  Typst reachable graph，明确保留并独立验证现有Render closure，没有再声称整个package不含browser/render资源。
- `change.html`已从当前proposal/design刷新，且OpenSpec Markdown仍为authority。链接、repo-relative路径与旧的external/no-render文案审计通过。

### 最终执行证据

| 命令/探针 | 结果 |
| --- | --- |
| `pnpm --filter dsh-univer-work package:smoke:restricted` | **PASS**：cached Linux/arm64 image；actual pack/fresh install、real Chromium与完整installed matrix通过；exact per-run image/container/iidfile清除。 |
| live Docker inspection | **PASS**：UID/GID 65532、rootfs readonly、network none、零bind/socket、capabilities dropped、resource bounds及两个有界tmpfs与脚本声明一致。 |
| `pnpm --filter dsh-univer-work package:verify` | **PASS**：QA-021回修后独立顺序重跑；actual artifact graph、manifest/native closure及包含remote fetch、relative/remote sourcemap的完整synthetic negative matrix通过。先前与并发dist rebuild重叠的一次ENOENT不能稳定复现，不计为产品finding。 |
| Core render focused | **PASS**：5 files、106 tests。 |
| DSH render/auth focused | **PASS**：2 files、109 tests。 |
| CLI screenshot/lint/SVG focused | **PASS**：3 files、13 tests。 |
| `pnpm typecheck` | **PASS**：全部workspace projects与OpenAPI/routes检查通过。 |
| `pnpm test` | **PASS**：SDK/release gates、Reference Provider 16、Client Core 624、Workspace 152、CLI 69、DSH 571 tests全部通过。 |
| `pnpm build` | **PASS**：全部workspace build、Workspace API lint/generate/routes、Core/DSH render runtime与CLI assets完成。 |
| `openspec validate add-dsh-render-verification-tools --strict` | **PASS**。 |
| `openspec instructions apply add-dsh-render-verification-tools --json` | **PASS**：8/8 complete，remaining 0，`all_done`。 |
| shell/Node syntax、Markdown links、authority/stale-text audit | **PASS**。 |
| working/cached `git diff --check` | **PASS**。 |
| process/container/temp residual audit | **PASS**：最终无本轮DSH/worker/remote-debug/browser进程、container、exact image、iidfile或smoke/run temp残留。 |

### 最终 QA 结论

**PASS，0 open findings。** QA-012、QA-018、QA-019、QA-020与QA-021均已独立关闭；Task 7.1 restricted installed
closure、Task 8.1文档收口和8/8 bookkeeping满足验收标准。本change已**READY TO ARCHIVE**。Archive仍需用户按仓库流程显式授权。
