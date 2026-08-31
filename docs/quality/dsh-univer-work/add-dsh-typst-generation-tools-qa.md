# add-dsh-typst-generation-tools QA

本报告是 OpenSpec Change `add-dsh-typst-generation-tools` 的独立验收记录。QA 只更新本文件，不修改产品代码、
产品测试、OpenSpec tasks、proposal、design、spec 或 review，不 commit、push 或 archive。

## 环境与边界

- 冻结基线：pre-Typst tree `e46af9246b2d98e114bfa0bc46d6ecca0fe162af`；Change planning baseline
  Workspace `a01adf28bfdfbf098ecf66653d520d08ecac4117`、SDK `1.0.0-beta.2`、DSH
  `0.1.1-rc.2` / `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`。
- 修订后的Task 2.2独立验收以pre-code tree `6b010bd0b17b2deee9409562c18447a2919501da`为对照；QA只读取
  current implementation并运行临时probe，没有修改实现、tests或tasks。
- Task 3.1 foundation checkpoint以tree `9693346389e4f3bee0b325829d967ce7d15645a3`为冻结起点；本轮只验收
  closed ToolRuntime registration、pure contracts/budgets、Code pairing与owner lifecycle。local path/artifact implementation、apply owner
  composition及production mount仍分别属于Task 3.2与4.1，因此Task 3.1整体保持pending且未勾选。
- Task 3.2初版实现以tree `b87a69b8abe5ec6bc694466ae4ccb9e1bfcb06cf`验收并发现5个High；用户确认
  mode-`0700` destination reservation与逐文件no-clobber的首版A后，修订实现以tree
  `e7381ff344209ae7724b60d4d9540522c3ae040f`固定复验。QA只更新本报告，不修改产品、tests或tasks。
  Task 3.1 production mount仍是预期partial，本轮不以尚未mount为finding。
- Task 3.2收敛复验以tree `79b5c7b566e3fddfe8c5f3b63fb15ea87d68d7a9`为冻结实现；
  `typst-artifacts.ts`、`typst-tools.ts`、`typst-tools.test.ts`分别固定为blob
  `3bbc47f33f6a93fbec319d494ae4b3df11ef9a57`、`546b07e1d6b3c99e80305563fb6cef7118793372`、
  `cc40011db1cdda973274e38a33e1971d32791ffc`。本轮接受已确认的首版threat model：hostile same-UID
  active tampering不属于隔离保证；QA只验证实现没有把portable observed checks写成atomic guarantee。
- Task 3.2 latest review-fix窄复验固定为只含三个目标文件的narrow tree
  `246ddd58d068c63213967cb31d95b785e8c6a093`；`typst-artifacts.ts`、`typst-tools.ts`、
  `typst-tools.test.ts`分别为blob `b27afff3a4e04a6ec05a91d71c5411438c6e6277`、
  `d53142a3e91a1dec1d67a8bfb324414f949845ed`、`03423a5ff335f098ee9c8cd8fb29d2b20f19958d`。
  QA只复验review-fix引入的Unit确认顺序、bounded partial projection与stage-create cancellation fence，并回归
  QA-010至014及`sourcePath`；没有修改产品、tests、tasks、planning或review。
- Task 3.1 production mount与Task 4.1以full tree
  `845de6a1fcc2644132f1793c5ea292aca6d46298`为冻结实现。关键blobs：DSH `authentication.ts`
  `c48cb4dc01d633033b79cf76ca01c65e8a865d86`、`typst-tools.ts`
  `be9ed930683901f14bbc721a642e419f55cc5d66`、两份tests
  `1f428b2baed428e4cc55c3441c4d3ca45289f072`/`96a6bffad1df418d4c033c8255353550ed9a2b42`；
  Core `typst.ts` `10f75520aff39ebcd7c90b7c085723a6a0a823d2`、root export
  `b3a6ceb44ac7224143493b4d5ac11f38289507eb`与test
  `2b866c65af901c177809c63031a37c7ce4d0b76e`。本轮不把Task 5 installed tarball closure或真实本地
  Workspace启动加入focused假HTTP范围；real native binding仍在production composition内实际运行。
- Task 4.1 latest fixes窄复验以full tree `2a45b82077e4e3ffea8e4fd31c1c35559c711cb3`冻结；Core
  `typst.ts`/test分别为blob `9523d840681990eadbfd6ca612c7eb49a2775456`、
  `6a8cbba7ceb2a6ea32feb3d0f2a758b8817677b6`，DSH `typst-tools.ts`/test分别为blob
  `5c58bfcedea535dc668e94bfbf021b3f1d89e4c7`、`5723ba29e4b6e784e03e3760119e540b449316c8`。
  本轮只关闭QA-015/016并回归production mount、`sourcePath`、projector与lifecycle，不修改产品、tests、tasks、
  planning或review。
- Task 4.1 residual窄复验以full tree `6e9d9467b74acd8425bdd832088f621c3a9e1a11`冻结；Core
  `typst.ts`/`typst-materialize.ts`及关键tests分别为blob
  `d6f0ca784465af6d949dfa1c42589a53a6638231`、`c489bc029e0a650cc4d7a5bb8234a77605b5105c`、
  `531228bdd1821e31a918079352f002b849a68de1`、`da1e72c2e80f5467e5c07d0d9ce51c5bae9ce411`；DSH
  Typst test为`ccd60d9e369afca0439436c490f6bc5a9cceba4a`。QA只更新本报告；没有修改产品、tests、
  tasks、planning或review。
- Task 4.1 final窄复验以full tree `c9430cd1aff3869cb40335fabf2d32f4ed84488d`冻结；Core
  `typst.ts`/`typst-materialize.ts`及关键tests分别为blob
  `b5e7bda7970a0e26a0b044862575b7029e7240db`、`f63af8e66940b613efd944049f20edaeeb639c17`、
  `c2609c667efaa98d5a94e4e2257761ca386c8063`、`55754d628ca5f13513cf27b814b00b8ea6e7b064`、
  `cd0995a383f449f1677e1305140fa422d01d21ff`。本轮只关闭QA-017并回归QA-015/016、production
  mount、`sourcePath`、real outcomes、late finalization与lifecycle；只更新本报告。
- Task 4.1 reviewer accessor/Proxy窄复验以full tree `47d00fc7c3fee901998356d89b313aea42fb1770`
  冻结；Core `typst.ts`与`typst.test.ts`分别为blob
  `5eec854bb431ce682ef1b3d33377fa16dc3995c9`、`a6142dac2465401201c35629cf82bbf3bdfe2ad4`，
  materializer、UnitData boundary test与native test保持
  `f63af8e66940b613efd944049f20edaeeb639c17`、`cd0995a383f449f1677e1305140fa422d01d21ff`、
  `55754d628ca5f13513cf27b814b00b8ea6e7b064`。本轮只复核candidate metadata accessor与Proxy trap
  副作用窄窗并回归real native；上一冻结树的full gates可直接引用。
- Task 5.1 installed closure验收以full tree `6ff4906305b44b5ddb2274c0c542ba54eecc1c05`冻结；六个
  packaging files `package.json`、`package-content-runtime.mjs`、`smoke-package.mjs`、
  `verify-package.mjs`、`vite.config.ts`、`pnpm-lock.yaml`分别为blob
  `5fedaf28a95b9c159746f3463fae7e8e650bcf74`、`25e3168a165ca23cc0cf4b6b0a0aa56b435e5230`、
  `1394a511f05b18d7d5f8d6dc910e6441da2dd7cb`、`9520573946b417c9d7b68ec4d67df0c737c93952`、
  `d0c9f0021225395ce683aaa5827ffdb1df2e5bcd`、`90e3a981a77538453136666200755e7891f9f0ef`。
  QA从实际dry-run tarball与fresh profile运行，不修改产品、tests、tasks、planning或review。
- Task 5.1回修窄复验以partial tree `5b86684a23229351245ba7780ffe15af59f18a11`与shared tree
  `381608c`冻结；`verify-package.mjs`、`smoke-package.mjs`分别为blob
  `f4c7b183cd09b34e0dd1d77e56cae14909bb7deb`、`7e981b71ff343f050cd72a1bbb0dc0823e117c79`，
  其余四个packaging blobs保持`25e3168a165ca23cc0cf4b6b0a0aa56b435e5230`、
  `5fedaf28a95b9c159746f3463fae7e8e650bcf74`、`d0c9f0021225395ce683aaa5827ffdb1df2e5bcd`、
  `90e3a981a77538453136666200755e7891f9f0ef`。本轮只复核QA-018/019并更新本报告。
- Task 5.1 final窄复验固定`verify-package.mjs`、`smoke-package.mjs`为blob
  `c39007674c1ba6d9b18b83a9f7fc3374593b82db`、`141f9eea52d21781467684309bc5307c749793de`；
  package、assembly、Vite与lock blobs保持不变。本轮只关闭QA-019、确认QA-018 installed matrix仍实际执行，
  不修改产品、tests、tasks、planning或review。
- Task 6.1 final docs/gates验收固定root README、`DREAMNUM.md`、DSH README、Client Core README、SDK
  dependency update script与test为blob `19bee84179c8792a848cfcfa4856f6c01eb1bc99`、
  `165d2647bf45611ced6d019c6a6d361ed671145e`、`618cb3fbdcefff0460b5a16178930e7328ea6b9b`、
  `a65f9331d92095a535684560663f7853c41ef913`、`ab50e635b32e9f3fedeed0cce685d92c227c605b`、
  `c92644c13c41dbba2bfa7c36ffc807174091ac59`。QA还复核implement/review在本轮修正的proposal
  repo-relative domain authority与design/spec Typst reachable-graph范围；只更新本报告，不修改产品、docs、tests、
  tasks、planning或review。
- Client Core拥有Typst bundle compile、deterministic Doc materialization与Worktree-local Unit apply；DSH Client
  Shell只组合current local path/policy/approval、credential/license、artifact publication、ToolRuntime与Host lifecycle。
- `targetUnitId`是compiler内部临时Doc identity，不是Server分配的Worktree-local Unit identity；本地artifact目录也不是
  Workspace `Resource`。apply只创建Doc Worktree-local Unit，不创建Node/Resource或提交content changeset。
- VM context只隔离每次调用的deterministic random intrinsics，不是恶意代码sandbox；tool不得接受caller JavaScript。
- installed QA只使用QA-owned isolated profile、unrelated Session cwd、fake Workspace HTTP和real native binding；不使用真实
  account/model key、system Typst、外部字体目录、monorepo source fallback或公网。
- source、generated JavaScript、UnitData、PNG bytes、credential、cookie、license、native cause/stack、temporary/absolute path和
  rejected raw arguments不写入报告。

## 编号验收标准

### Prerequisites、Core owner与CLI compatibility

- **AC-01** Changes 1–6的single Host owner、authenticated/license resolver、Worktree-local Unit create、local file gate与
  content-runtime finalizer均已完成且没有第二owner/parser/baseline。
- **AC-02** Core package root公开现有`WorkspaceCompileTypstFeature`、`HeadlessWorkspaceTypstMaterializer`、Typst inputs/results和
  shared `WorkspaceUnitFeature.create`；DSH只从package root消费。
- **AC-03** exact `@univer-cli/doc-typst-facade@1.0.0-beta.2`公开compile/options/result/error exports与实现假设一致。
- **AC-04** exact `@univer-cli/headless-univer@1.0.0-beta.2`公开factory/facade exports与Doc-only runtime假设一致。
- **AC-05** facade owner精确声明`@univerjs-pro/doc-typst-native-binding@1.0.0-insiders.20260723-c21613b`，wrapper精确声明
  同版本五个平台optional packages；不得从hoist猜版本。
- **AC-06** DSH `0.1.1-rc.2` real ToolRuntime顺序固定为argument snapshot→ordered pre-execute/ask/guard→drained body→
  final result→snapshotted definition finalizer；already-aborted与late-aborted identity分别为`ABORTED_BEFORE_DISPATCH`/`ABORTED`。
- **AC-07** pre-edit Client Core与DSH typecheck、existing Typst compile/materialize/native tests均通过，建立后续无回归基线。
- **AC-08** omitted signal/budgets/license保持CLI compiler calls、options、diagnostics、preview paths、write order、result/error、
  deterministic output、Commander/daemon payload与installed artifact行为不变。
- **AC-09** Core继续compile once；compile-only即使含error diagnostics也返回`committed:false`且零materialize/create。
- **AC-10** apply error diagnostics阻止materialize/create，warnings允许同一次compiled result继续；任何create失败不recompile/rematerialize。

### Core cancellation、budgets、license与VM isolation

- **AC-11** optional signal在compiler entry前已abort时compiler/materializer/create全0。
- **AC-12** native compile开始后abort时Core等待不可中断call settle，随后零materialize/create且不claim hard cancellation。
- **AC-13** generated program开始后abort时Core等待program settle、dispose runtime/context，随后零save/create success。
- **AC-14** signal贯穿shared Unit create；dispatched create不确定时保留`workspace-result-unknown`与safe stable identity，零replay。
- **AC-15** confirmed Unit撞Core signal时Core可返回confirmed result，由DSH caller finalization决定是否转`ABORTED`。
- **AC-16** generated JavaScript达到caller max+1时以`workspace-typst-limit-exceeded`在materialization/create前失败且不截断。
- **AC-17** visible compiler projection bytes超过7.5 MiB或depth64时在materialization/create前失败，完整diagnostics/previews不截断。
- **AC-18** materialized UnitData bytes超过50 MiB或depth64时在create前失败，并dispose runtime/context。
- **AC-19** exact byte/depth边界成功，max+1失败；descriptor/accessor/toJSON/sparse/non-JSON值不被raw stringify提前执行或遗漏。
- **AC-20** materializer接收当前resolved license；omitted license仍传existing empty string，license不进入result/error/transcript。
- **AC-21** 每次materialization使用独立Node VM context与同seed `Math.random`/`crypto.getRandomValues`，等价program结果确定。
- **AC-22** 两个并发materialization的random sequence互不影响，且运行期间Host `Math.random`和
  `crypto.getRandomValues` descriptor/function identity始终不变。
- **AC-23** VM仅暴露guarded Facade和所需standard intrinsics；model args不能供应code、global、require、process或lifecycle capability。
- **AC-24** zero/multiple/wrong-id Doc、prohibited lifecycle、missing/invalid saved Doc都返回runtime-contract，runtime/context总dispose。

### DSH closed tools、canonical values与budgets

- **AC-25** Native catalog与Code SDK只新增`workspace_typst_compile`、`workspace_typst_apply`，root
  `additionalProperties:false`、exact snake_case fields与closed outputs。
- **AC-26** compile要求nonblank `bundle_path`和`artifact_directory`；apply要求nonblankWorktree/Space，optional parent/key/artifact；
  `render_previews:true` without artifact在pure validation失败。
- **AC-27** schemas不接受origin/cookie/license/inline source/generated JavaScript/arbitrary Facade code/output filename/force/command/
  environment/worker/browser/font/remote FS/generic options。
- **AC-28** own accessor、symbol、unknown key、wrong primitive、blank、cross-field invalid在approval/path/Core前固定
  `workspace-argument-invalid`，plugin-owned content零rejected sentinel。
- **AC-29** canonical argument UTF-8 exact 524,288 bytes允许，524,289以`workspace-typst-limit-exceeded`在approval/path/Core前失败。
- **AC-30** compile canonical success含`committed:false`、target/title、complete validated diagnostics/previews和Session-relative artifact path；
  apply success还含validated Doc Worktree-local Unit。
- **AC-31** output validator拒missing/extra/accessor/non-JSON/wrong committed/target/unit/preview/artifact identity，且在render/Code value前失败。
- **AC-32** canonical result exact 8 MiB/depth64允许，max+1/depth65失败且不截断；apply reserved 512 KiB Unit/envelope保持closed。
- **AC-33** generated JavaScript与PNG bytes永不进入canonical value、render、approval、plugin-owned event、Session transcript或log。
- **AC-34** success render只总结committed、compiler target、diagnostic counts、artifact path与Server Unit identity。
- **AC-35** compile-only不解析credential/license/Workspace HTTP；apply只在diagnostics与predictable budgets通过后解析一次。
- **AC-36** real Native、Agent Loop与Code Mode success返回同一canonical value，Code start/settled按name/subCallId配对。
- **AC-37** Native/Code invalid/failure保留fixed code而不反射arguments以外的secret；只允许DSH-owned argument record含caller paths。
- **AC-38** compile error diagnostics仍发布完整bounded artifacts并返回committed false；apply同diagnostics发布0 artifact并指引先compile。

### Local policy、approval与atomic artifact publication

- **AC-39** non-local filesystem在任何model path resolve前以`workspace-local-filesystem-required`失败，path/approval/Core/Host I/O全0。
- **AC-40** missing cwd、bundle/artifact escape、bundle/output overlap在approval/compiler前固定file/path failure且不泄露Host launch path。
- **AC-41** current read/write policy、public LocalFS proof、cwd containment与destination absence均在ask前检查；accepted body全部从immutable args重算。
- **AC-42** `workspace-write`同时要求current policy root与Session cwd containment；read-only/danger/bare LocalFS遵守Change 5既有语义。
- **AC-43** valid compile只ask一次fixed compile/artifact reason；valid apply只ask一次fixed staged-Doc reason，无caller path/value。
- **AC-44** rejected/cancelled/unavailable/no channel在compiler/credential/license/materializer/create/artifact前fail closed。
- **AC-45** approval后provider、cwd、policy mode/root、symlink/containment或destination状态变化在Core/private mkdir前失败，无cached preflight。
- **AC-46** bundle directory或contained `typst.json`只在approval后转换成Host path；frozen compiler独占manifest/page/prelude/asset parser。
- **AC-47** private sibling directory mode受限；固定写`program.js`、schemaVersion1 `diagnostics.json`及仅requested时`previews/`。
- **AC-48** 每个file完整write/sync；以mode-`0700` exclusive `mkdir`预占destination，再逐个known file no-clobber发布并sync；
  公开值只含Session-relative paths，允许publication期间短暂partial directory visibility。
- **AC-49** existing/racing artifact destination返回`workspace-output-exists`，不overwrite/merge/delete；不支持force。
- **AC-50** write/sync/size/link/cancel失败执行non-cancellable ownership-ledger cleanup；只unlink recorded exact identities并对known directory
  non-recursive `rmdir`，保留foreign/replacement content与不能清空的目录。
- **AC-51** preview count最多256；program+diagnostics+previews actual bytes总计exact 50 MiB允许，max+1不发布、不截断/遗漏。

### Apply side effects、errors、cancellation与lifecycle

- **AC-52** apply exact one compile、one materialize、one Unit create；Doc type、Space/Worktree/parent/idempotency/name precedence与Server Unit校验正确。
- **AC-53** apply无artifact时零local publication；有artifact时同一次compile result在Unit确认后发布，不二次compile。
- **AC-54** diagnostics/materialization/budget错误发生在create前，零remote side effect与local public artifact。
- **AC-55** create `workspace-result-unknown`/mismatch/invalid-response保留safe code/identity与Unit-list guidance，零compile/materialize/create replay。
- **AC-56** confirmed Unit后artifact validation/write/sync/rename failure返回`workspace-typst-partial-side-effect`，只含confirmed Unit、
  publication state和inspect/no-replay guidance；不delete Unit或compensate。
- **AC-57** confirmed Unit后caller/owner cancellation撞artifact阶段同样保留partial side effect，private state清理、existing destination不变。
- **AC-58** caller在complete success后abort时DSH返回canonical `ABORTED`并追加artifact/Unit inspect guidance；不自动retry。
- **AC-59** owner-only cancellation撞complete confirmed success可在dispose drain中返回success；unconfirmed/partial结构化failure保持优先。
- **AC-60** exact published Typst facade error constructors/categories只映射bundle-invalid/compile-failed/preview-failed的fixed text和bounded diagnostics。
- **AC-61** runtime diagnostics/contract/limit与shared file/Workspace allowlist只保留closed safe detail；forged/unlisted code降级
  `workspace-typst-operation-failed`。
- **AC-62** absolute/temp/dependency path、source/program/UnitData/PNG、credential/cookie/license/native message/stack/cause/rejected arg在
  Native/Agent/Code/result/render/approval/log全sentinel-negative。
- **AC-63** already-aborted real ToolRuntime返回`ABORTED_BEFORE_DISPATCH`，approval/path/Core/credential/license/effect全0。
- **AC-64** caller/owner在native compile或VM execution中abort：await不可中断工作、停止later step、清理runtime/context/private dir并正确分类。
- **AC-65** disposal在approval/path/native/VM/create/write/publication/cleanup任一点停止admission、注销2 tools与policy branches、abort supported
  work、独立drain并发body，零request/context/temp/listener/timer/Job/retry/Typst worker。

### Installed tarball、native closure与repository compatibility

- **AC-66** package assembly从installed Client Core owner解析exact Typst facade，再从facade manifest解析exact native wrapper/platform packages。
- **AC-67** reachable private Core、facade、TypeScript printer、headless JavaScript内联；只允许exact published DSH/Cordis/native external。
- **AC-68** emitted/manifest/file closure拒bare private Core、`workspace:*`、CLI source/daemon/Session、adjacent checkout、absolute/file/link/data
  source fallback与system Typst command进入Typst reachable graph；Typst不增加或使用Web/SVG/browser/font资源或第二Typst worker，
  package既有Render closure继续独立验证。
- **AC-69** actual tarball安装到fresh local profile，从无node_modules unrelated cwd运行；环境PATH不提供system Typst，仍完成real native compile。
- **AC-70** installed real ToolRuntime compile最小bundle与optional real PNG previews，验证fixed artifact layout、diagnostics、mode/sync/no-clobber/budgets。
- **AC-71** installed apply使用real native compile与licensed deterministic headless Doc、fake authenticated Workspace exact one POST，验证Doc
  Worktree-local identity和zero content worker/commit。
- **AC-72** installed Native Agent Loop与Code Mode覆盖两tools success/error/partial/cancel，canonical pairing与secret-negative一致。
- **AC-73** installed create unknown/partial-side-effect/caller/owner cancellation与bounded dispose无replay/compensation，结束后process/port/profile/
  run cwd/private artifact/worker-child集合恢复baseline。
- **AC-74** package缺native wrapper或current platform optional package时verify/smoke失败，不静默宣称ready或fallback system binary。

### Documentation与full gates

- **AC-75** DSH README记录two tool names、fixed artifact layout、exact budgets、policy/approval/no-clobber、VM-not-sandbox、native await cancellation
  ceiling、partial/no-replay和remote/system/worker/render exclusions。
- **AC-76** Client Core README记录optional signal/budgets/license、VM isolation、CLI omitted-controls compatibility，以及Shell-owned path/policy/approval/
  credential/native delivery；root current-fact docs不再否认已交付Typst tools。
- **AC-77** focused Core Typst tests、CLI Typst/command/built-entrypoint/package tests与DSH Typst ToolRuntime tests全部通过。
- **AC-78** full Core typecheck/test/build；DSH typecheck/test/build/package verify/actual smoke；CLI package build/verify/smoke全部通过。
- **AC-79** root SDK dependency、typecheck/test/build、OpenSpec strict、`git diff --check`通过；Server/Browser/OpenAPI/database/deployment/
  Commander/release diff无Typst scope drift。
- **AC-80** final OpenSpec 8/8且QA-owned process/temp/port/profile为空；QA只在全部direct evidence和0 open后判Ready to archive。

验收项总数：**80**。

## 实际环境矩阵

| Task / 规格组 | 必要直接证据 |
| --- | --- |
| Task 1 prerequisites | Changes 1–6/前置extract changes all complete；exact Core root exports、single auth/tool/runtime owner、license与LocalFS gate；DSH rc.2 pre/ask/body/finalizer order；facade/headless/native public manifest probe；pre-edit Core+DSH typecheck与existing Typst tests |
| Task 2 Core controls | pre/native/program/create cancellation fences；compile/visible projection/UnitData byte-depth exact/max+1；license secrecy；confirmed/unknown create race；CLI omitted-controls exact compatibility |
| Task 2 VM | concurrent same-seed materialization；Host random descriptors/functions sampled during execution；per-call sequence isolation；zero/multiple/wrong Doc and disposal；no caller program input |
| Task 3 closed tools | real ToolRuntime Native/Agent/Code catalog、schemas、invalid/accessor/symbol/unknown/cross-field/512 KiB；8 MiB/depth64 outputs；compile-only zero credential/license；javascript/PNG/session secrecy |
| Task 3 local artifacts | local/nonlocal/read-only/workspace-write/danger/cwd/outside/overlap；one approval + four failure modes；body-time provider/policy/cwd/symlink/destination drift；fixed files/modes/sync/same-parent no-clobber；50 MiB/256 previews；write/sync/rename/cancel cleanup/prior preservation |
| Task 4 apply/errors/lifecycle | exact one compile/materialize/create；diagnostics zero create；confirmed/unknown/mismatch/invalid；confirmed Unit then artifact failure/cancel partial side effect；caller late ABORTED/owner success；allowlist/forged errors and full secret sentinels；concurrent disposal at native/VM/HTTP/file stages、unregister/remount/no residual |
| Task 5 installed closure | actual tarball/fresh profile/unrelated cwd/no system Typst/no checkout；exact facade-owned native wrapper+platform package；real native compile/previews、real deterministic apply+fake Workspace；Native Agent/Code；budgets/no-clobber/unknown/partial/cancel/dispose；no Typst worker；pre/post process/port/temp/profile equality |
| Task 6 compatibility | DSH/Core/root docs；Core/DSH/CLI focused+full package gates；root SDK/typecheck/test/build；OpenSpec strict/tasks；diffcheck；Server/OpenAPI/database/deployment/Commander/release unchanged |

## Issues

发现问题立即通知`/root`与`/root/typst_implement`。修复后独立复跑原repro、相邻boundary/race case及最小回归gate。

| ID | Severity | Evidence | Expected | Repro | Status |
| --- | --- | --- | --- | --- | --- |
| WT-TYPST-QA-001 | High | Task 2.1初版`HeadlessWorkspaceTypstMaterializer.sanitizeLicensedFailure()`在提供license时包住并重写materializer内部的`signal.throwIfAborted()`；source control flow会让licensed DSH apply把caller/owner cancellation误报为runtime contract，破坏取消分类与finalizer语义。 | License secrecy只应清洗未知runtime/factory failure，不得捕获或改写操作signal的abort reason；native/program settle后观察到的caller/owner cancellation必须保持原identity，runtime仍dispose且不开始later save/create。 | 用nonempty license、started/settled generated-program barrier与custom `DOMException("qa-abort-reason","AbortError")`；program开始后abort，release后观察公开identity、save/create与dispose。相邻factory rejection和dispose secret仍应fixed且零license反射。 | **RESOLVED**：`projectFailure(error, signal)`先从已abort的exact operation signal重新抛取reason，再做license failure projection；真实headless barrier现返回`same:true/name:AbortError`，save/create 0并dispose。licensed/unlicensed program、licensed factory reject race、unknown factory/program/dispose secret与raw undefined/null primary failure均有回归；独立focused 3 files/61、typecheck、diffcheck通过。 |
| WT-TYPST-QA-002 | High | `WorkspaceCompileTypstFeature.execute()`初版只在`await compile(...)`成功返回后检查signal；不可中断compiler若在caller/owner已abort后以rejection settle，控制流跳过post-native fence并直接公开dependency rejection。独立barrier probe actual `sameAbort:false,sameDependency:true,message:"qa-native-secret"`。 | 无论native compile resolve还是reject，Core都必须先await settlement，再让已经aborted的operation signal保持exact reason并阻止later step；未abort时仍原样传播existing compiler rejection，不能race/abandon native promise。 | 注入started/settled compiler promise；开始后以custom DOMException abort，再以secret Error reject compiler；观察`feature.execute()`公开identity及materialize/create counts。修后应`sameAbort:true`、materialize/create 0；相邻未abort reject仍same dependency。 | **RESOLVED**：compiler await catch先观察exact supplied signal，再传播未取消的原dependency rejection。原barrier现保持同一custom DOMException，materialize/create均0；resolve-after-abort同样在settlement后停止，未abort compiler rejection仍保持原对象identity。独立focused 3 files/62、Core full 27 files/578、Core typecheck与diffcheck通过。 |
| WT-TYPST-QA-003 | Critical | Task 2.2原冻结要求同时承诺per-invocation VM不改变Host globals与same-seed real materialization完整UnitData相等；beta.2 Host Facade/Core从Host random intrinsics分配`paragraphId`/`sectionId`，因此两次真实结果的opaque IDs不同。 | 在没有public per-runtime ID seam的冻结baseline上，artifact必须明确把确定性限定为排除SDK-owned opaque paragraph/section/list/range identity后的语义内容；持久化UnitData仍保留有效IDs，产品实现不得做identity normalization、private injection或Host-global patch。 | 对同一exact native compiled bundle并发materialize四次；只对`structuredClone`测试副本递归排除四个精确identity key后比较，另从原始UnitData收集并验证有效`para_`/`section_` IDs及不同run identity集合。 | **RESOLVED**：用户确认首版语义确定性边界，proposal/design/two specs/tasks已同步修订。current VM实现只隔离program-local intrinsics；4-run real-native probe语义投影全等，原始UnitData保留2个有效paragraph IDs与1个有效section ID，未发现运行时normalization。 |
| WT-TYPST-QA-004 | High | Task 3.1 foundation初版的compile/apply result validator只检查`artifactDirectory`存在性，没有要求其与validated `artifact_directory`保持exact identity；独立probe用`expected`输入和`other`/absolute输出时均被接受。 | wrong artifact identity必须在render、Native/Code canonical value与后续publication前以固定invalid-result拒绝；省略artifact的apply同样不得接受依赖补入路径。 | 直接调用两validator覆盖compile mismatch、apply absolute mismatch与omitted-artifact/unexpected-result三行，再复跑real ToolRuntime focused与Code Mode canonical dispatch。 | **RESOLVED**：validator现在要求`artifactDirectory === args.artifact_directory`，包括`undefined` exact identity；三行独立repro均返回`workspace-typst-result-invalid`，source tests增加compile/apply mismatch回归。focused 1 file/8、DSH/Core typecheck、strict与targeted diffcheck通过。 |
| WT-TYPST-QA-005 | High | `tools/pre-execute`在返回`ask`前调用共享`resolveTypstPaths()`；该函数在`typst-tools.ts:343,368-369`直接执行`filesystem.processPath()`，把bundle/artifact identity转换成Host absolute path。 | Preflight只能使用public provider identity、`resolve/stat/contains`与current policy；只有approval接受后的body完成同样recheck后才能调用`processPath()`并把Host path交给Core/`node:fs`。 | Source control-flow：`pre-execute` lines 308–323 → `resolveTypstPaths` lines 330–370。与Change 5冻结gate及本Change AC-46对照；当前两条有artifact路径和apply无artifact路径都在ask前返回Host path record。 | **RESOLVED**：pre-execute现在只调用`resolveTypstModelPaths()`并丢弃model targets；accepted body重算后才进入`resolveTypstHostPaths()`的两处显式`processPath()`。Tracing LocalFS在approval request记录0次explicit conversion，body记录大于0。 |
| WT-TYPST-QA-006 | High | `commitTypstArtifactStage()`按`lstat(destination)`→`rename(private,destination)`提交。POSIX/macOS `rename`会替换检查后竞争出现的空destination目录，因此该序列不提供no-clobber；现有race test只创建含`owner.txt`的非空目录，`rename`以`ENOTEMPTY`失败，未覆盖空目录。 | Final publication必须让已有或竞争出现的任何destination保持精确不变；并发者创建空目录也必须fail closed，不能由rename删除/替换。 | macOS Node independent probe：创建含`payload`的`src`与空`dst`后`rename(src,dst)`得到`{"rename":"succeeded","entries":["payload"]}`。结合production lines 121–124可复现最终check后的空目录race。 | **RESOLVED**：publication不再调用directory rename；`mkdir(destination,{mode:0o700})`原子预占，`EEXIST`固定映射output-exists。body期间竞争创建empty/nonempty destination均保持原目录不变、零published file。 |
| WT-TYPST-QA-007 | High | Canonical `artifactDirectory`直接复用caller的`artifact_directory`，`projectTypstPreviews()`再对该值`join()`。绝对但仍contained于Session cwd的合法输入因此把Host absolute path放入canonical value和render。 | Host内部可使用canonical absolute path；公开compile/apply value、preview metadata与render只能返回从current Session cwd计算的canonical relative path。 | 独立projection probe输入`/private/tmp/session/qa-artifacts`，实际返回preview path `/private/tmp/session/qa-artifacts/previews/one.png`且`absolute:true`；`compileValueFrom`/`applyValueFrom`同样直接返回raw input。 | **RESOLVED**：body从current cwd对contained absolute input计算`artifactRelativePath`，用normalized input生成canonical value与preview path；real ToolRuntime absolute bundle/artifact call只返回`absolute-artifacts/**`，approval/result/events均不含cwd。 |
| WT-TYPST-QA-008 | High | `commitTypstArtifactStage()`先rename公开目录，再`syncPath(stage.parent)`；parent sync失败时函数抛错，但finally只删除已被rename走的private path，公开artifact仍存在。 | 任一write/sync/rename failure不得留下普通public artifact；工具不能一边返回失败一边留下未确认发布目录。 | Independent fault probe令parent sync target返回`ENOENT`：actual `{"error":"ENOENT","publicEntries":["program.js"],"rootEntries":["out"]}`。同一control flow在真实parent fsync I/O error时一致。 | **RESOLVED**：`stage.committed`保持false直到known files/directories和parent sync、final signal fence、private cleanup全部完成；任一post-publication failure由tool `finally`按public ledger回滚。本轮final-boundary fault复验公开owned files/dirs被删，foreign replacement保留。 |
| WT-TYPST-QA-009 | High | 两个tool的`finally`在成功commit后仍调用`cleanupTypstArtifactStage()`；rename已经释放旧private pathname，竞争者可在该窗口重建同名目录，而cleanup会无identity guard地递归删除它。 | 成功publication后不得清理已不再拥有的旧pathname；失败cleanup也只能删除本次stage仍拥有的private identity，不能删除路径替换者数据。 | Deterministic probe：commit成功后在`stage.privateDirectory`重建目录并写`owner.txt`，再调用cleanup；actual root只剩public `out`，竞争者目录被删除。 | **RESOLVED**：实现移除recursive `rm`，ledger记录dev/ino/scope；成功commit后复用旧private pathname的foreign directory与`owner.txt`因identity不匹配被保留，known directory只尝试non-recursive `rmdir`。更窄的check→unlink竞态另见QA-014。 |
| WT-TYPST-QA-010 | High | `cleanupOwned(private)`在finalizer时调用`recordCompilerPreviews()`，扫描仍owned的private `previews/`并把所有未记录`.png`按当时identity追加进ledger后删除；外来PNG因此被错误认领。目录变为可读但不可search时，`readdir`成功后的`lstat`还会让cleanup本身以`EACCES` reject。 | Finalizer只能删除在正常compiler result/staging阶段已经记录的known identities；未知entry必须保留并让non-recursive `rmdir`失败，cleanup fault不得覆盖primary error/cancellation/confirmed-side-effect分类。 | 独立probe在fresh mode-0700 preview directory写`foreign.png`后直接cleanup，actual `foreignPngPreserved:false`。相邻mode-0400 probe actual `cleanupOutcome:"Error:EACCES"`。 | **RESOLVED**：finalizer不再扫描目录；`stageTypstArtifacts()`只按compiler返回的preview metadata记录identity。mode-0700与mode-0400独立probe均返回cleanup resolved并保留`foreign.png`原bytes，unknown entry使known directory的non-recursive `rmdir`自然失败。 |
| WT-TYPST-QA-011 | High | `stageTypstArtifacts()`只在staging时累计preview size；`publishKnownFile()`只复核dev/ino，不复核regular-file state或current size。同inode内容/size mutation因此绕过50 MiB actual artifact gate。 | Commit前及published handle sync后必须验证每个known file仍是同一regular inode并重算总actual bytes；超限或漂移必须失败并ledger rollback，不能返回committed。 | 独立probe让1-byte PNG通过stage，再把同inode truncate到52,428,801 bytes；commit actual成功，published preview size为52,428,801，limit为52,428,800。 | **RESOLVED**：private validation、published handle sync与final public validation均核对regular inode和recorded size，并重算known-file total。独立post-link hard-link probe把同inode增至52,428,801 bytes后返回`artifact file changed`；public partial保留、private ledger清理，未返回committed。exact 50 MiB与+1 source boundary仍分别成功/拒绝。 |
| WT-TYPST-QA-012 | High | destination/preview directory在exclusive `mkdir`后虽记录dev/ino，但publish和final sync前不复核path仍指向该reservation。竞争者可移走reserved directory并在原path建立foreign directory，tool随后把known files写入foreign directory且确认成功。 | 每个公开child create/link和final sync必须以已记录directory identity为父级；reservation丢失必须失败，不能向replacement directory写入或确认它。 | deterministic signal fence在首file link前把`out`rename为`reserved-moved`并在原path建含`foreign.txt`的目录；actual commit成功，foreign目录得到`program.js`和`diagnostics.json`。 | **RESOLVED**：destination和public preview目录在child publication前后及final sync/validation均核对recorded identity与closed layout。独立public-preview replacement返回`artifact identity changed`；replacement只含foreign entry，moved reservation保持empty，零program/diagnostics后续write且无public delete。destination replacement source regression同样通过。 |
| WT-TYPST-QA-013 | High | `publishKnownFile()`在hard-link后按pathname sync，且commit完成前不再确认public path仍指向recorded inode。竞争者在link后替换文件时，tool会sync replacement并返回committed。 | Link后必须用opened handle确认identity/type/size并sync该handle；final commit前再次确认每个public pathname仍映射recorded identity，漂移必须失败并保留foreign replacement。 | deterministic post-link fence把`out/program.js` unlink后写`foreign-program`；actual `outcome:"committed"`且returned artifact里的program是foreign bytes。 | **RESOLVED**：hard-link后opened handle核对identity/type/size并sync，close后及每轮/final public validation再核对pathname。独立replacement返回`artifact identity changed`；public只保留foreign `program.js`，未写diagnostics，cleanup不删除public。foreign layout addition同样在下一可观测检查点失败并原样保留。 |
| WT-TYPST-QA-014 | High | `unlinkIfOwned()`与`rmdirIfOwned()`把identity check和destructive pathname operation分成两个syscall；replacement可在`lstat`返回后、`unlink/rmdir`前占据同一路径并被删除。 | “任何竞态replacement都不误删”需要atomic conditional-by-identity deletion；普通pathname precheck不能作为该绝对保证。 | QA fault hook让`lstat(program.js)`取得owned info后、返回前同步把owned file移走并在原path写foreign；cleanup actual `swapped:true`、`foreignAfterCleanup:"missing"`。 | **RESOLVED BY CONFIRMED CONTRACT**：proposal/design/spec/tasks已把hostile same-UID active tampering列为首版non-goal，只承诺random mode-0700 staging、no-clobber publication与ordinary observed identity checks。实现注释明确portable Node没有conditional unlink并把升级路径指向dirfd/native `unlinkat`或OS-user/container isolation；tests只声称可观测fence检测，没有虚假atomic guarantee。原check→unlink窄窗仍存在，但属于已确认threat-model ceiling，不再是Task 3.2 blocker。 |
| WT-TYPST-QA-015 | High | Task 4.1新增`canonicalUnitData()`为DSH budget生成JSON-semantics副本，但`projectCanonicalUnitData()`对object分支不要求plain record，并静默跳过symbol own keys；array分支也不拒绝symbol keys。 | 启用UnitData预算时只允许明确支持的JSON record/array/primitive与合法SDK `undefined`语义；accessor、symbol、cycle、non-lossless number、Date/Map/Set/typed array/class instance等unsupported values必须在Unit create前fail closed。不得把unsupported material静默删除或改写后创建Unit；省略limits仍保持原对象identity。 | 独立真实`WorkspaceCompileTypstFeature` probe分别传入enumerable symbol-key root、nested `Date`、`Map`与class instance，均启用byte/depth limit。actual四行全部`committed:true`；create收到删掉symbol的`{id:"doc"}`、Date/Map变成的`{}`或class转成的plain object。 | **CLOSED**：projector现在只接受exact own data properties上的plain record、dense array与JSON primitive；symbol/accessor/non-enumerable/exotic/class/Date/Map/Set/typed/cycle/nonfinite/bigint/function/sparse/extra或huge array key共17类独立攻击全部在create前固定`unit-data-json`且create 0。合法object `undefined` omission、array `undefined`→`null`、own `__proto__`按canonical bytes测量；limited与omitted controls均把原`initialData` identity交给create，exact bytes成功、max-1拒绝。 |
| WT-TYPST-QA-016 | Medium | `createOutcomeUnknown()`为caller省略idempotency的Unit create恢复投影只从Core safe `detail.request`取生成UUID，忽略同一closed public identity中的compiler title/`name`。 | `workspace-result-unknown`必须保留bounded exact safe idempotency/Worktree/Space/parent/type/name identity与unit-list/no-replay guidance；不得复制initialData或dependency message。 | 独立real ToolRuntime依赖抛Core-style`WorkspaceApplicationError`，request含matching UUID、name、parent/space/type/worktree。actual code与guidance正确、`hasKey:true`、`hasName:false`。`workspace_unit_list`不展示create idempotency key，同parent多个Doc时恢复匹配会歧义。 | **CLOSED**：recovery request现在要求exact `idempotencyKey`、`name`、`parentNodeId`、`spaceId`、`type`、`worktreeId`六字段，并绑定caller key或generated UUID及args parent/space/worktree/Doc type。独立real ToolRuntime五场景验证generated/caller key与null parent保持完整六字段；unknown、mismatch、oversize均降级fixed operation failure，不泄露dependency secret，最大序列化结果922 bytes、低于8 MiB。 |
| WT-TYPST-QA-017 | High | residual为让real native跨realm UnitData通过strict plain-record预算，在`HeadlessWorkspaceTypstMaterializer.materialize()`中于Core descriptor-safe projector之前执行`structuredClone(saved)`。structured clone会读取own accessor，并把custom prototype及其inherited `toJSON`静默扁平化成Host plain record。 | materializer与budget组合不得在安全验证前执行dependency getter，也不得把unsupported prototype/material静默删除或改写后创建Unit。跨realm转换必须建立在descriptor/prototype-safe输入上，并保持opaque IDs与合法UnitData语义；CLI omitted-controls继续把materializer产出的同一`initialData`交给create。 | 独立exact-source pipeline两行：accessor saved在clone时`getterCalls:1`，clone后Core budget成功且`creates:1`；custom-prototype/inherited-`toJSON` saved变成plain record，inherited method被删除，Core同样success且`creates:1`。相邻standalone semantics显示opaque ID、Date/Map/Set/typed bytes、own/array `undefined`按structured-clone值语义保留，但root/nested/typed identity全改变。 | **CLOSED**：materializer已移除`structuredClone`，Core只接受Host/null prototype或descriptor-exact foreign intrinsic `Object.prototype`。独立真实native limited feature保留foreign `textStyle`、原UnitData identity及3个opaque IDs并成功create；synthetic foreign intrinsic通过。custom constructor、inherited `toJSON`、extra/symbol、prototype accessor/flag及function name/arity/native-source九类near-miss均固定`unit-data-json`、create 0，candidate function调用计数0。 |
| WT-TYPST-QA-018 | High | Task 5.1 installed smoke只运行compile success、no-clobber、一个明显超过argument上限的调用、dispatch前abort、apply success及settled success后的dispose。它没有安装态验证canonical argument exact 524,288 bytes成功与524,289 fixed code、nonempty current license、opaque paragraph/section IDs、started caller/owner cancellation、in-flight bounded dispose、result-unknown或confirmed Unit后partial-side-effect。source focused tests覆盖这些runtime路径，但不能证明打包、tree-shaking和fresh-profile wiring没有改变它们。 | 实际tarball在fresh profile、unrelated cwd上的real ToolRuntime smoke必须直接覆盖Task 5冻结矩阵：exact/+1 budget及fixed code、current cookie/license、opaque identity、caller/owner cancellation、bounded dispose、unknown/partial且零replay/compensation。 | `smoke-package.mjs:1341-1345`只对`"x".repeat(524_289)`断言generic `isError`；`3176`把`UNIVER_LICENSE`设为空；`1356-1388`只断言apply title/cookie/one create并在成功settle后dispose。全文件没有上述安装态边界/错误路径。 | **CLOSED**：fresh-profile smoke现直接验证512 KiB canonical argument exact边界通过pure gate、+1返回fixed limit code；nonempty license与system-Typst/font spawn sentinels；两次real native apply的相同语义投影及不同但有效opaque IDs；三次same-key transport retry后的完整result-unknown recovery/no-replay；confirmed Unit后artifact destination竞争与oversize Unit envelope均返回partial且保留public data；started caller cancellation保持unknown并清理private output；active owner dispose先unregister、等待HTTP settle、5秒内drain并返回partial，零private residue。Task 5 design只要求installed smoke覆盖“budgets”，没有要求把每个50 MiB source exact/+1 fixture复制到tarball smoke；既有source exact gates加上述两个installed budget类别构成direct evidence。 |
| WT-TYPST-QA-019 | Medium | `verify-package.mjs`对file/link parent token、absolute source和render missing/unreachable/remote asset提供synthetic negative cases；checkout root、system Typst command、CLI/daemon/Session与deferred SVG只检查当前emitted bundle不含对应token。scanner或exemption以后误放行时，当前artifact仍无该token，verify会继续通过。 | 每类禁止的静态token都应有negative fixture，把token注入被扫描输入并证明相同scanner拒绝；TypeScript生成的dynamic file URL与provenance exemption继续只接受已列出的窄格式。 | `verify-package.mjs:19-45`及`assertRenderAssetGraphNegativeCases()`覆盖local/absolute/render；`346-349`和bundle deferred loop只做current-output absence assertion，没有static checkout/system Typst/CLI/daemon/Session/SVG的注入fixture。 | **CLOSED**：AST graph按kind分别解析static ESM/export与options dynamic import、global `require`/`require.resolve`、import-meta URL与Worker，使用ESM exact-extension、Node-style CJS file/directory/package-main、URL file/directory及exact Worker resolver；relative missing、undeclared bare、nonliteral refs均fail closed，只允许两个生成物路径上的closed dynamic worker exceptions。fixtures现逐类覆盖CLI、daemon、Session、checkout POSIX/Windows、absolute source、system Typst、remote、SVG、extensionless ESM、import/require options、Worker options/bare/alternate/nonliteral及TypeScript exact/near-miss；single Content worker target与all-runtime reachability仍固定。 |

## 实际执行结果

| 命令/探针 | 结果 |
| --- | --- |
| planning/domain/source review | **PASS**：已完整读取root/target AGENTS与README、Workspace CONTEXT、ADR 0007、本Change proposal/design/two specs/tasks、`extract-typst-client-core`全部artifacts，以及当前Core Typst、Unit、error、DSH auth/tool-owner/file/license实现与published package manifests/API。 |
| `openspec status` / `instructions apply` | planning artifacts 4/4 complete；pre-edit implementation tasks **0/8**。Task 1 checkbox落地后独立复核为**1/8**、remaining 7；按`tina-verify`最终ready前所有tasks必须有direct evidence并完成。 |
| prerequisite changes | **PASS**：OpenSpec list显示plugin shell6/6、authentication7/7、Space/Node7/7、Worktree/Unit7/7、file transfer7/7、content runtime8/8、discovery7/7、Office8/8及`extract-typst-client-core`6/6均complete。 |
| exact package/public API probe | **PASS**：facade/headless均exact`1.0.0-beta.2`且只有public root exports；facade公开compile/result/error schema并声明native wrapper`1.0.0-insiders.20260723-c21613b`；wrapper五个平台optional packages同版本。DSH tools/Cordis均冻结`0.1.1-rc.2`/`4.0.1`。 |
| rc.2 runtime source audit | **PASS**：published ToolRuntime先snapshot args，caller pre-abort后才waterfall pre-execute/ask/guard；body promise总await，started caller abort只替换成功为`ABORTED`而保留structured thrown error；definition finalizer在materialized final result后运行。 |
| `pnpm --filter @univerjs/univer-workspace-client-core typecheck` | **PASS**。 |
| `pnpm --filter dsh-univer-work typecheck` | **PASS**。 |
| Core existing Typst focused | **PASS**：`typst.test.ts`、`typst-materialize.test.ts`、`typst-native.test.ts`共3 files / 47 tests。冻结compile-once、diagnostics、Doc lifecycle/determinism与real native baseline。 |
| `git diff --check` | **PASS** at pre-edit QA checkpoint。 |
| Task 1 implementation delta | **PASS**：以临时index从冻结tree重建current snapshot并排除本QA文件后，pre-Typst tree之后只有review报告与Task 1 checkbox，无产品/source/test/package变更；runtime `Object.keys`再次确认facade/headless exact public exports，full `git diff --check`仍通过。 |
| Task 1 checkpoint disposition | **HISTORICAL PASS**：当时Core仍使用process-global random descriptor patch且尚无optional controls；该行只记录Task 1验收时点，不描述current Task 2.2实现。 |
| Task 2.1 licensed cancellation repro | **RESOLVED / WT-TYPST-QA-001**：nonempty app license + controlled real headless program barrier在post-entry custom DOMException abort后保持exact reason；save/create 0、runtime dispose。相邻license secret与raw undefined/null cleanup rows通过。 |
| Task 2.1 Core controls and budgets | **PASS**：pre-abort、native resolve/reject settlement、licensed/unlicensed program与factory settlement均保持取消identity且无later step；generated JavaScript、visible projection、UnitData bytes/depth exact/max+1及non-lossless JSON均在正确边界拒绝；signal只传一次给shared Unit create，confirmed value不被post-check覆盖，result-unknown无重放。 |
| Task 2.1 native rejection cancellation repro | **RESOLVED / WT-TYPST-QA-002**：injected uninterruptible compiler开始后abort，再以secret dependency Error reject；feature等待settlement后公开同一custom DOMException，materialize/create为0。相邻resolve-after-abort与未abort raw rejection identity均通过。 |
| Task 2.1 focused/Core gates | **PASS**：Core typecheck；Typst focused 3 files / 62 tests；Core full 27 files / 578 tests；`git diff --check`。 |
| Task 2.1 CLI omitted-controls compatibility | **PASS**：CLI typecheck；`typst.test.ts + application-command-contracts.test.ts` 2 files / 17 tests。CLI仍省略新增signal/budget/license controls并保持既有input/result与Commander行为。 |
| Task 2.2 delta against `6b010bd…` | **PASS**：仅`typst-materialize.ts`、`typst-materialize.test.ts`、`typst-native.test.ts`与Task 2.2 checkbox变化。实现以`node:vm` `createContext`/`compileFunction`替换Host descriptor patch；没有worker、private SDK import、identity rewrite或新lifecycle owner。 |
| Task 2.2 exact compiler + real Host Facade concurrency probe | **PASS**：临时`pnpm exec tsx -e`从real `compileDocTypstBundle`编译含标题、段落和list的bundle，再并发运行4个real `HeadlessWorkspaceTypstMaterializer`。四份`structuredClone`测试副本只删除`paragraphId`/`sectionId`/`listId`/`rangeId`后完全相等；原始UnitData保留非空opaque IDs且不同run identity集合不同。 |
| Task 2.2 persisted identity validity probe | **PASS**：另一real native probe验证原始saved UnitData含2个`para_` paragraph IDs与1个`section_` section ID，均非空且未被projection改写；result保持`id: qa-id-doc`、`rev: 1`与saved name `IDs`。当前minimal compiler output没有生成list/range identity，因此没有伪造这两类runtime evidence。 |
| Task 2.2 VM random / typed-array probe | **PASS**：real materializer program对`Uint8Array`和`Uint16Array` subview调用VM-local `crypto.getRandomValues`，返回同一view且只改变`byteOffset`/`byteLength`覆盖区间；同seed并发sequence相等。受控Host函数在执行中及结束后保持strict identity和descriptor；program的5-byte view未进入Host crypto，Host `Math.random`调用为0，Host crypto只收到Facade/Core生成opaque ID的2个20-byte请求。 |
| Task 2.2 lifecycle/guard/cancellation | **PASS**：focused tests覆盖exactly-one Doc、zero/multiple/wrong/missing identity、六个prohibited lifecycle methods、missing Doc、invalid save、`save()`一次、`rev:1`、name/title precedence、pre/program abort exact reason、factory/program/save/dispose failure和每个settled path disposal。VM execution完成后才观察abort，不race/abandon program。 |
| Task 2.2 arbitrary-code boundary | **PASS**：current production callers只有`WorkspaceCompileTypstFeature`把exact compiler result传入materializer，CLI只接收bundle path/options；DSH尚未注册Typst tools。VM context只注入guarded `univerAPI`参数与fixed standard intrinsics，无`process`/`require`/Host global bridge；固定seed bridge在compiler program执行前删除。 |
| Task 2.2 focused/Core/CLI gates | **PASS**：Core focused `typst.test.ts`、`typst-materialize.test.ts`、`typst-native.test.ts`为3 files / 62 tests；Core full 27 files / 578 tests；Core typecheck；CLI Typst/Commander 2 files / 17 tests及CLI typecheck全部通过。CLI仍省略signal/budgets/license并保持unsignalled behavior。 |
| Task 2.2 cleanup/diff gate | **PASS**：`git diff --check`通过；两组QA临时bundle目录均由`finally`移除，`/tmp/typst-task22-qa-*`与`/tmp/typst-id-qa-*`残留为0。 |
| Task 2.2 node-first import follow-up | **PASS**：implement仅把`node:vm` import移到third-party imports之前，identifier、VM调用与runtime代码不变；`typst-materialize.test.ts` 1 file / 40 tests及`git diff --check`复验通过。 |
| Task 3.1 foundation source/delta audit | **PASS**：完整读取proposal/design/two specs/tasks、domain/target READMEs、`typst-tools.ts`、focused tests、Core root export与existing Host composition。新增代码复用existing `WorkspaceToolOwner`和Core canonical JSON measurer，没有第二owner、bundle parser、worker、runtime dependency或generic tool abstraction；package manifests无新增dependency。Core helper仅从private package root导出给另一个repo application使用，符合禁止跨package `src` import的既有边界，不形成public SDK。 |
| Task 3.1 closed schemas and pure validation | **PASS**：real ToolRuntime只注册两份root-closed schema；exact snake_case args/output、own data-descriptor与unknown/symbol/accessor拒绝、preview/artifact cross-field、Doc Worktree-local Unit/target/result identity均由closed validator控制。invalid与524,289-byte input在approval/operation前失败；fixed approval text不含caller值；body再次验证immutable snapshot。 |
| Task 3.1 canonical budgets/secrecy | **PASS**：独立probe验证8,388,608-byte complete compile result成功，8,388,609返回`workspace-typst-limit-exceeded`且不截断；closed result最大结构深度低于64，validator仍固定执行depth-64 gate并拒non-lossless/cyclic/accessor结构。generated JavaScript/PNG字段无法进入closed outputs，real Native transcript/approval以及两tool Code value均无sentinel；compile dependency与apply dependency分离，compile-only credential/license counters保持0。 |
| Task 3.1 wrong artifact identity repro | **RESOLVED / WT-TYPST-QA-004**：compile/apply输入`expected`而依赖返回`other`或absolute path，以及omitted-artifact apply返回unexpected path，现均固定`workspace-typst-result-invalid`。相邻valid identity、Unit target和preview metadata仍通过。 |
| Task 3.1 real Native/Code pairing | **PASS**：focused suite使用real ToolRuntime Native dispatch；独立`ControlledCodeRuntime`从`run_code`连续dispatch compile/apply，返回与Native相同的两份closed canonical value，`tool/code-dispatch-start`与`tool/code-dispatch`的name/subCallId精确2/2配对。临时probe已删除。 |
| Task 3.1 owner lifecycle probe | **PASS**：同一existing owner追踪in-flight compile；`stopAccepting`后逆序注销两tool/pre-execute branches，owner abort使body固定为`workspace-plugin-disposing`，`drain()`等待body settled后返回，catalog中两tool均不存在。没有新增owner、listener、timer、Job或worker。 |
| Task 3.1 focused/gates | **PASS**：`typst-tools.test.ts` 1 file / 8 tests；DSH source+test typecheck；Client Core typecheck；OpenSpec strict；tracked `git diff --check`及两份untracked source/test `git diff --no-index --check`全部通过。 |
| Task 3.1 production boundary | **EXPECTED PARTIAL**：`authentication.ts`及Host production composition没有import/register Typst foundation，Task 3.1 checkbox保持未勾。Task 3.2完成current LocalFS/policy/cwd/no-clobber artifact owner，Task 4.1完成credential/license/Unit owner与total finalizers后，才允许一次性production mount；当前catalog没有半成品Typst capability。 |
| Task 3.2 initial delta/source audit | **HISTORICAL FAIL / 5 OPEN**：完整读取当时proposal/design/two specs/tasks、`typst-tools.ts`、新增`typst-artifacts.ts`、focused tests及Change 5 local gate。provider/policy/cwd与bundle/manifest在preflight/body均重新解析；directory/manifest、overlap、non-local/read-only、provider/policy/symlink/destination drift主路径存在。发现pre-approval Host-path转换、empty-destination rename clobber、absolute canonical path、post-rename parent-sync failure及成功commit后cleanup删除路径竞争者五项边界缺陷。 |
| Task 3.2 initial source test gate | **HISTORICAL PASS但不足以验收**：`pnpm --filter dsh-univer-work test -- typst-tools.test.ts`实际执行当时DSH全套9 files / 500 tests并通过；覆盖fixed layout、0700/0600、compile error artifacts、ordinary existing/nonempty race、throw/cancel cleanup、symlink drift、50 MiB与256 exact/max+1。测试未覆盖当时五个open findings。 |
| Task 3.2 initial cancellation cleanup probe | **HISTORICAL PASS**：pre-aborted exact signal进入artifact staging后保持same abort reason；显式non-cancellable cleanup结束后Session temp root entries为0。 |
| Task 3.2 initial platform no-clobber probe | **HISTORICAL FAIL / WT-TYPST-QA-006**：macOS Node `rename(nonemptySource, emptyDestination)`成功并替换destination，证明final `lstat`与普通`rename`之间的race不能由当时实现fail closed。 |
| Task 3.2 initial parent-sync fault probe | **HISTORICAL FAIL / WT-TYPST-QA-008**：rename成功后parent sync `ENOENT`导致公开`out/program.js`保留，同时operation rejection；private path已不存在，finally无法回滚。 |
| Task 3.2 initial canonical path probe | **HISTORICAL FAIL / WT-TYPST-QA-007**：absolute contained artifact input经当时projection保持absolute，并直接进入preview canonical path。 |
| Task 3.2 initial cleanup ownership-race probe | **HISTORICAL FAIL / WT-TYPST-QA-009**：commit后在已释放的旧private pathname创建竞争者`owner.txt`，当时unconditional recursive cleanup删除了该目录；public artifact仍在。 |
| Task 3.2 first-version A fixed tree | **PASS**：复验前逐文件blob核对`file-transfer.ts`、`typst-tools.ts`、`typst-artifacts.ts`、`typst-tools.test.ts`与QA前报告均与tree `e7381ff344209ae7724b60d4d9540522c3ae040f`完全一致；本轮没有读取共享树中后续Render产品diff作为Typst evidence。 |
| Task 3.2 historical five findings | **RESOLVED / QA-005–009**：preflight explicit processPath为0/body大于0；empty/nonempty destination race由exclusive mkdir fail closed；cwd-contained absolute caller路径只投影relative；final-boundary failure按public ledger rollback；旧private pathname复用与foreign replacement因dev/ino mismatch保留。产品源不含directory `rename`、recursive `rm`或generic artifact service。 |
| Task 3.2 first-version focused source gate | **PASS但不足以验收**：`pnpm --filter dsh-univer-work exec vitest run test/typst-tools.test.ts`为1 file / 17 tests。现有回归覆盖原5个High、fixed layout/modes、exact budgets、ordinary races与cleanup；没有覆盖QA-010–014的active-private foreign PNG、same-inode mutation、reserved-directory swap、post-link replacement和check→unlink schedule。 |
| Task 3.2 first-version A unknown preview cleanup probe | **HISTORICAL FAIL / QA-010**：live owned private preview目录内的unrecorded `foreign.png`被finalizer scan认领并删除，actual `foreignPngPreserved:false`；mode-0400相邻probe还使cleanup以`EACCES` reject。 |
| Task 3.2 first-version A same-inode budget probe | **HISTORICAL FAIL / QA-011**：1-byte preview通过stage后在同inode truncate至52,428,801；commit成功并发布52,428,801-byte PNG，超过52,428,800 limit。 |
| Task 3.2 first-version A reserved-directory swap probe | **HISTORICAL FAIL / QA-012**：首file link前移走已记录destination并在原path新建foreign directory；commit成功且把program/diagnostics写入foreign directory，原reservation留在新pathname。 |
| Task 3.2 first-version A post-link file replacement probe | **HISTORICAL FAIL / QA-013**：program hard-link后、sync前用foreign inode替换public pathname；commit成功并把`foreign-program`作为confirmed artifact返回。 |
| Task 3.2 first-version A cleanup TOCTOU probe | **HISTORICAL FAIL / QA-014**：fault hook在owned `lstat`返回前替换同pathname；随后的`unlink(path)`删除foreign replacement，actual `foreignAfterCleanup:"missing"`。无recursive delete不等于conditional-by-inode delete。 |
| Task 3.2 first-version A cancellation/throw/apply semantics | **HISTORICAL PARTIAL**：当时ordinary compile/apply throw和pre-publication cancellation会等待cleanup；full success后的caller cancellation由rc.2转`ABORTED`并保留committed directory。confirmed Unit后的artifact failure/cancel与cleanup classification缺口由后续收敛实现处理，见本轮partial/cancellation复验。 |
| Task 3.2 first-version A full gates | **HISTORICAL PASS**：当时DSH full 10 files / 528 tests、DSH typecheck/build、Client Core typecheck/build、OpenSpec strict均exit 0；该结果不替代本轮冻结tree复验。 |
| First-version contract ceiling | **RESOLVED DECISION**：用户确认首版不隔离hostile same-UID active tampering。portable Node observed checks负责检测可观测identity/size/layout漂移；public reservation后不做destructive cleanup，partial目录保留并返回inspect guidance。若未来需要闭合check→`link`、check→`unlink/rmdir`或final-check→return窄窗，再通过独立change引入OS-user/container或跨平台dirfd/native conditional operation。 |
| Task 3.2 convergence frozen tree | **PASS**：实现tree `79b5c7b…`与指定三个blob逐字节一致；QA未改产品、tests、tasks或planning。source明确使用random `mkdtemp` + mode `0700` private staging、exclusive public `mkdir`、known-file hard links、identity/size/layout ledger和private-only cleanup；没有recursive remove、directory rename或public destructive cleanup。 |
| Task 3.2 private ledger / QA-010 | **PASS**：独立真实fs probe确认private root与preview目录均为`0700`；unrecorded `foreign.png`在mode `0700`和`0400`下都保留原bytes，cleanup均resolve。pre-public recorded-file pathname被foreign inode替换时，cleanup保留foreign replacement；被移动的owned inode也不被路径扫描追删。 |
| Task 3.2 file budget / QA-011 | **PASS**：独立post-hard-link probe把public `program.js`与private source共享inode增至52,428,801 bytes，commit返回`artifact file changed`、`committed:false`，public oversized partial保留且private pathname清理。source focused test另验证完整artifact exact 52,428,800 bytes成功、+1以limit failure拒绝。 |
| Task 3.2 directory/file/layout drift / QA-012–013 | **PASS**：独立public preview-directory replacement返回`artifact identity changed`，replacement只含foreign entry、moved reservation为空且无known-file后续write；public program replacement返回identity failure并只保留foreign program；root layout addition返回closed-layout failure并只保留foreign entry。source destination-replacement regression同样通过。所有post-reservation failure均执行零public delete。 |
| Task 3.2 publication partial errors | **PASS**：真实ToolRuntime独立probe覆盖compile/apply post-public layout fault与caller cancellation。compile固定为`workspace-typst-artifact-partial`；confirmed apply固定为`workspace-typst-partial-side-effect`，detail仅含Session-relative artifact directory/state与validated `unitId`/`worktreeId`，并含inspect/no-replay guidance。公开partial目录保留；serialized result/events不含cwd、temporary/sentinel、program或cancel reason。 |
| Task 3.2 sync/final boundary | **PASS**：独立parent-sync `ENOENT` probe在public complete files已存在时返回failure、`publicStarted:true`、`committed:false`，公开program/diagnostics保留且private清理；post-public cancellation同样保留reserved directory并返回上述structured partial code。 |
| Task 3.2 final success layout | **PASS**：独立real-fs success得到root exact `diagnostics.json`、`previews/`、`program.js`，preview exact `one.png`；public root/preview mode `0700`、四类file mode `0600`，private staging归零且`stage.committed:true`。final public validation在parent sync、private cleanup后再次核对identity、size、closed layout与总byte limit。 |
| Task 3.2 convergence gates | **PASS**：focused Typst 1 file / 23 tests；DSH full 10 files / 559 tests（包含build）；DSH与Client Core typecheck；OpenSpec strict；tracked及targeted untracked diffcheck全部exit 0。QA probes全部在`finally`删除临时root，残留为0。 |
| Task 3.2 latest review-fix delta | **PASS**：指定narrow tree与三个blob逐字节一致。相对上一冻结blob，artifact改动只给stage create加入operation signal、每个settled FS boundary fence与fresh private cleanup；tool改动只增加bounded Unit envelope、在完整result/artifact处理前确认args-bound Unit identity，以及artifact omitted的`not-requested` partial state。QA-010至014的ledger/publication实现保持不变，same-UID active tampering仍按已确认non-goal记录且没有新增atomic claim。 |
| Task 3.2 Unit envelope boundary | **PASS**：独立canonical probe构造Unit envelope exact 524,288 bytes与524,289 bytes；exact通过apply result validator，+1固定`workspace-typst-result-invalid`。closed Unit schema的合法envelope实测depth 3，validator仍对Unit envelope独立执行depth-64 gate；未知嵌套不能伪装成合法Unit。args-bound target/space/parent/worktree校验先于identity保留，malformed Unit固定invalid-result且sentinel不进入error。 |
| Task 3.2 confirmed partial matrix | **PASS**：独立real ToolRuntime probe让safe confirmed Unit之后分别发生complete-result byte overflow、preview contract failure、diagnostic closed-shape failure和pre-public artifact path failure；四行均固定`workspace-typst-partial-side-effect`，无artifact时detail为`artifactState:not-requested`且无artifact directory，有artifact但未public时为`not-published`。error只保留validated `unitId`/`worktreeId`与fixed inspect/no-replay guidance，完整result、preview/diagnostic sentinel、Host/temp path和JS/PNG bytes均未泄露；malformed Unit仍为`workspace-typst-result-invalid`。 |
| Task 3.2 stage-create cancellation | **PASS**：独立real-fs probe在preview-enabled create的第1至第8个signal fence逐一失败，覆盖initial、destination `lstat`、parent `stat`、`mkdtemp`、private identity `lstat`、`chmod`、preview `mkdir`与preview identity `lstat`。每行都不启动后续FS/dependency并清除fresh private ledger，root entries为0；focused real ToolRuntime另对compile/apply同时验证create完成后的dependency boundary取消，两个dependency调用均为0且private residual为0。cleanup保持non-cancellable。 |
| Task 3.2 final boundary and carry-forward | **PASS**：独立real-fs commit在fence 7抛错，公开closed layout已含`diagnostics.json`/`program.js`，`stage.committed:false`；cleanup后公开目录与bytes原样保留、private staging消失。focused suite继续覆盖foreign PNG、same-inode size drift、destination/public file/layout replacement与零public delete，QA-010至013保持closed；QA-014继续按confirmed threat-model non-goal关闭。success result、preview与diagnostic仍保留原`sourcePath`。 |
| Task 3.2 latest review-fix gates | **PASS**：focused Typst 1 file / 28 tests；DSH full 10 files / 564 tests（包含build）；DSH与Client Core typecheck；OpenSpec strict；tracked diffcheck及三份untracked source/test no-index whitespace check全部通过。独立probe的`/tmp/typst-narrow-qa-*`与`/tmp/typst-fence-qa-*`残留为0。 |
| Task 3.1 production mount | **PASS**：`mountWorkspaceAuthentication()`在同一个现有`WorkspaceToolOwner`上注册exact `workspace_typst_compile`/`workspace_typst_apply`，复用current authenticated `WorkspaceUnitFeature`与license resolver；无第二owner/parser/runtime pool。Native schemas与Code binding均发现两tool；dispose后catalog为0，remount精确恢复2且无stale registration。tasks checkbox仍由implementation owner维护，不作为QA失败依据。 |
| Task 3.1 real production composition | **PASS**：focused authentication test在真实native binding上从local bundle完成compile，canonical target正确且credential/license/HTTP计数均为0；随后seed rotated cookie并apply，当前license恰解析一次、HTTP只有一次`POST /api/worktrees/wt-1/units`且cookie为rotated值，返回validated Doc Worktree-local Unit。source control flow保持one Core execute，因此compile/materialize/create各一次且不做shell retry。 |
| Task 4.1 sourcePath boundary | **PASS**：diagnostic与preview共用`bundleRelativeSourcePath()`。独立pure probe接受`pages/one.typ`、含空格nested path及Unicode relative path；拒绝empty、POSIX absolute、drive absolute/relative、slash/backslash UNC、URI、`.`/`..`segment、double slash、backslash与NUL，全部固定`workspace-typst-result-invalid`且不复制输入。real native success继续保留合法`sourcePath`。 |
| Task 4.1 exact compiler/error projection | **PASS**：Core projector只接受exact `DocTypstFacadeError`/`DaCTypstTranslationError` prototype与allowlisted frozen code；plain duck object、subclass及unknown code均不投影。bundle/translation/preview映射为三种fixed code；translation diagnostics须通过closed sourcePath/field/7.5 MiB/depth-64 gate才保留。DSH先处理create mismatch/invalid/unknown，再处理owner/caller、auth/Workspace稳定码与generic file mapping，故Unit outcome不被file projector降级。unknown messages/cause/stack与unsafe diagnostics不进入结果。 |
| Task 4.1 cancellation/finalization | **PASS**：Core focused覆盖pre/native resolve/reject、VM program、save/create fences、runtime disposal、confirmed/unknown create且零replay。real ToolRuntime compile/apply在完整成功后的`post-execute` caller abort均返回`TOOL_ABORTED`，artifact已含fixed program/diagnostics；apply的materialize/create各一次且confirmed side effect保留，两个finalizer均给出inspect/no-replay并移除abort sentinel。pending approval unregister、production owner-only HTTP success、dispose drain与无Job/timer/retry/专用worker结论保持不变。 |
| Task 4.1 safe partial/unknown projections | **PASS / QA-016 CLOSED**：diagnostic、limit与confirmed Unit/artifact partial投影只保留closed bounded detail；result-unknown exact六字段覆盖safe name、caller/generated key、explicit null parent与args binding。unknown field、identity mismatch及oversize name均fail safe，dependency message/cause不泄露，Unit-list/no-replay只在完整validated recovery identity上出现。 |
| Task 4.1 UnitData JSON-semantics budgets | **PASS / QA-015 CLOSED**：projection只用于纯测量，Unit create收到原`initialData` identity。17类unsupported结构全部fixed fail closed且create 0；合法object-undefined omission、array-undefined→null、own `__proto__`、exact/max-1 bytes及CLI omitted-controls identity均通过。 |
| Task 4.1 latest fixes focused/full gates | **PASS**：Core Typst/materializer/native 3 files / 65 tests；DSH Typst/auth 2 files / 93 tests；CLI Typst/Commander/content 3 files / 18 tests；Core full 27 files / 617 tests；DSH full 10 files / 571 tests（含Core+DSH build）；Core/DSH/CLI typecheck、CLI build、OpenSpec strict全部exit 0。独立probe均在`finally`清理QA临时目录。 |
| Task 4.1 residual exact create identity | **PASS**：Core在DSH visible limits存在时一次生成完整create identity，并把同一key传给shared Unit create。独立real `WorkspaceUnitFeature` probe覆盖transport unknown三次retry、result mismatch与invalid response；三类错误均保留同一exact六字段request，HTTP retry key全部一致且分别为3/1/1 requests。独立identity canonical boundary为111 bytes exact成功、name +1在create前固定`visible-result-bytes`且create 0；DSH real ToolRuntime继续保留code、六字段、unit-list/no-replay并过滤cookie/cause。 |
| Task 4.1 residual real native/CLI semantics | **PASS except QA-017**：真实native compile/materialize/apply在UnitData与visible budgets启用时成功，观察到3个有效opaque paragraph/section identity且均保留原字符串值，输出只含Host plain/null-prototype records。standalone structured-clone语义保留Date/Map/Set/typed value、own与array `undefined`，但复制所有object identity；materializer返回值本身是新owner，Core仍把该exact `initialData` identity交给create，CLI omitted-controls focused tests保持18/18。accessor执行与prototype扁平化仍由QA-017阻塞。 |
| Task 4.1 residual historical regression gates | **HISTORICAL PASS as gates, insufficient to close QA-017**：Core Typst/materializer/native 3 files / 68 tests；DSH Typst/auth 2 files / 93 tests；CLI Typst/Commander/content 3 files / 18 tests；Core full 27 files / 620 tests；DSH full 10 files / 571 tests（含Core+DSH build）；Core/DSH/CLI typecheck、CLI build、OpenSpec strict全部exit 0。QA-015/016、late caller finalizer、sourcePath、production mount与owner lifecycle保持通过。 |
| Task 4.1 final foreign-realm boundary / QA-017 | **PASS**：`typst-materialize.ts`恢复直接保存SDK UnitData，不再clone。真实native materialization只在`$/documentStyle/textStyle`观察到foreign intrinsic prototype；limited Core feature成功，create收到materializer exact object，3个paragraph/section opaque IDs保持有效原值。独立10-case matrix接受synthetic foreign intrinsic record，拒绝custom constructor、inherited `toJSON`、extra/symbol key、accessor、descriptor flag、function name/arity/source near-miss；所有拒绝均create 0且未执行候选getter/function。 |
| Task 4.1 final regression gates | **PASS**：Core Typst/materializer/UnitData/native 4 files / 70 tests；DSH Typst/auth 2 files / 93 tests；CLI Typst/Commander/content 3 files / 18 tests；Core full 28 files / 622 tests；DSH full 10 files / 571 tests（含Core+DSH build）；Core/DSH/CLI typecheck、CLI build、OpenSpec strict与added-file diffcheck全部exit 0。QA-015/016、real unknown/mismatch/invalid identity、late finalizer、sourcePath、mount、owner lifecycle与CLI omitted-controls保持通过。 |
| Task 4.1 reviewer accessor/Proxy closure | **PASS / QA-017 remains CLOSED**：Core在任何`Reflect.ownKeys`、prototype descriptor或function metadata读取前用Node `types.isProxy()`拒绝object/prototype/function Proxy；function `name`/`length`改为读取own data descriptor，不直接property access。独立7-case probe中两类metadata accessor getter 0、payload未注入、三类Proxy的`get`/`getOwnPropertyDescriptor`/`getPrototypeOf`/`ownKeys` trap合计0、descriptor flag/native-source candidate body 0，全部`unit-data-json`且create 0。real native limited success保持；focused Core 3 files / 32 tests、Core typecheck、OpenSpec strict与added-file diffcheck通过，上一行full gates仍适用于其冻结范围。 |
| Task 5.1 physical owner/manifests | **PASS**：从physical Client Core owner解析facade exact `1.0.0-beta.2`，从facade owner解析wrapper exact `1.0.0-insiders.20260723-c21613b`，wrapper五个平台optional packages版本一致；Darwin arm64 current package实际存在。packed manifest把wrapper放required dependencies、五个平台放optional dependencies，current platform缺失会失败，non-current `MODULE_NOT_FOUND`才允许跳过。 |
| Task 5.1 assembly/graph audit | **PASS**：Vite与assembly以内联Core、facade、headless、TypeScript printer为目标，只把published DSH/Cordis/native packages外部化；AST import graph要求所有Host JavaScript可达，root exports固定，content worker只有一个且没有Typst worker。dry-run pack file closure、manifest targets、render assets与native package graph全部通过。 |
| initial `pnpm --filter dsh-univer-work package:verify` | **HISTORICAL PASS for then-current checks**：执行真实build与`pnpm pack --json --dry-run`；artifact closure、physical owner graph、root exports、AST reachable graph、single worker、render graph、无bare private Core/`workspace:*`/source path/system Typst/current checkout均通过。当时scanner negative-fixture不足，已由final verifier关闭。 |
| initial explicit-Chrome `pnpm --filter dsh-univer-work package:smoke` | **HISTORICAL PASS for covered paths / QA-018 then OPEN**：使用`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`；tarball安装到无workspace `node_modules`的fresh profile，并从profile外unrelated cwd启动。exact两Typst tools、real native compile与PNG preview、0700/0600 layout、diagnostics、no-clobber、pre-abort、fake apply exact one create/current cookie、secret与absolute checkout negative、无browser/system Typst process、dispose unregister及Content/Render/Office回归均通过；当时完整installed error/cancel/budget矩阵仍缺direct evidence，已由final smoke关闭。 |
| Task 5.1 focused/full gates | **PASS**：Core Typst/materializer/UnitData/native 4 files / 72 tests；DSH Typst/auth 2 files / 93 tests；CLI Typst/Commander/content 3 files / 18 tests；Core full 28 files / 624 tests；DSH full 10 files / 571 tests。Core/DSH typecheck、DSH/Core build、OpenSpec strict全部exit 0。 |
| CLI package compatibility | **PASS after sequential rerun**：首次把Core/DSH build与`pnpm package:workspace-cli`并发启动时，两个build同时替换Core `dist`，CLI观察到瞬时缺失`render-runtime/index.html`并报`ENOENT`；停止并发后顺序重跑`pnpm package:workspace-cli`、CLI package verify和explicit-Chrome package smoke全部exit 0。该并发命令不属于仓库支持的gate，未记产品finding。 |
| Task 5.1 cleanup/diff | **PASS**：installed smoke与CLI smoke退出后无匹配Host/worker/system-Typst进程及QA profile/run-cwd/private temp残留；full `git diff --check`与六个frozen packaging files对snapshot diffcheck通过。QA没有修改产品、tests、tasks、planning或review。 |
| Task 5.1 first verifier rerun / QA-019 | **HISTORICAL PASS except two negative fixtures**：`node --check`及实际`package:verify`通过；AST graph覆盖static ESM/export、dynamic import、unshadowed global require/resolve、import-meta URL、Worker、relative missing、declared bare/builtin、all-runtime reachability与single Content worker。当时daemon与Session各自fixture仍缺失，已由final verifier关闭。 |
| Task 5.1 final installed smoke / QA-018 | **PASS / CLOSED**：显式Chrome tarball重新安装fresh profile并从outside cwd运行；real native compile/PNG、512 KiB exact/+1、nonempty license与invalid system binary/font sentinels、两次semantic-equal real apply/opaque IDs、unknown same-key recovery、confirmed partial/public preserve、oversize Unit envelope、started caller cancel及active owner dispose全部通过。退出后Host/worker/system-Typst process、profile/run cwd/private artifact与marker恢复baseline。 |
| Task 5.1 final narrow gates | **PASS**：两个packaging scripts syntax、DSH typecheck/build、package verify/smoke、OpenSpec strict与report/frozen-files diffcheck均exit 0。产品、Core、CLI和tests blobs未变，上一轮Core 28/624、DSH 10/571、CLI focused 3/18及CLI package gates可直接引用，未重复无关full run。 |
| Task 5.1 final verifier closure / QA-019 | **PASS / CLOSED**：kind-specific ESM/CJS/URL/Worker resolver与full synthetic matrix实际随`package:verify`运行通过；import/require/Worker options均读取首参数，nonliteral refs除两个exact generated exceptions外固定拒绝，daemon与Session各自fixture命中独立regex分支。bare/non-Content Worker、alternate existing Worker、missing refs、extensionless ESM、CJS legacy四种resolution及TypeScript near-miss均按预期。 |
| Task 5.1 final rerun | **PASS**：current scripts syntax、DSH typecheck/build、`package:verify`、explicit-Chrome `package:smoke`、OpenSpec strict与diffcheck通过。smoke仍执行QA-018的完整installed matrix；process audit改为`after − before`并以内建self-check证明baseline process退出不误报、新process identity必报错。退出后无Host/worker/system-Typst或QA temp残留。 |
| Task 6.1 frozen docs/domain audit | **PASS**：六个指定blob逐字节一致。DSH README准确记录exact two tools/closed args、Session-cwd local gate与approval、fixed layout、no-clobber/public partial、identity-ledger private cleanup、same-UID non-goal、diagnostics/create/result-unknown/no-replay、opaque IDs、VM-not-sandbox、native cancellation ceiling、limits与installed closure；Core README只拥有optional signal/budgets/license/VM/Core workflow，明确把path/policy/approval/artifact/native delivery与no-replay presentation留给Client Shell。root README和`DREAMNUM.md`只陈述已交付事实。未发现未实现或越界能力声明。 |
| Task 6.1 domain authority/coexistence corrections | **PASS**：proposal现以repo-relative `apps/workspace/CONTEXT.md`定义Unit/Worktree-local Unit及Agent Client/Core/Shell，并引用accepted ADR `apps/workspace/docs/adr/0007-co-locate-workspace-agent-clients.md`，没有外部checkout authority。design §7与packed-artifact delta scenario只约束Typst reachable graph，明确保留并独立验证既有Render closure；不再把整个package误述为无render/browser资源。 |
| Task 6.1 SDK allowlist/gate | **PASS**：新增independent allowlist精确只有facade-owned native wrapper与五个平台optional packages；既有icons、CLI assets、formula与Office binding independent families保持不变。主`@univer-cli/*`、`@univerjs/*`、`@univerjs-pro/*` cohort仍统一升级；fixture保留concrete wrapper/darwin-arm64版本并证明其他cohort更新。`pnpm test:sdk-dependencies`为4/4，`pnpm install --frozen-lockfile --offline`通过。 |
| Task 6.1 focused/full repository gates | **PASS**：Core Typst/materializer/UnitData/native 4 files / 72 tests；DSH Typst/auth 2 files / 93 tests；CLI Typst/Commander/content 3 files / 18 tests。root `pnpm typecheck`、`pnpm test`与`pnpm build`依次覆盖5个workspace projects并全部exit 0；其中Core 28/624、Workspace 34/152、CLI 14/69加package-artifact 13、DSH 10/571，SDK 4与release 8均通过。Core/DSH/CLI各自typecheck/build由root gate实际执行；Task 5已顺序通过CLI package build/verify/explicit-Chrome smoke，本轮docs/SDK delta没有修改CLI packaging。 |
| Task 6.1 package/production gates | **PASS**：current DSH README进入实际tarball后，`pnpm --filter dsh-univer-work package:verify`重新build、dry-run pack并验证physical native owner、manifest/file/AST graph与existing Render closure；显式`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`的`package:smoke`重新完成fresh-profile installed matrix。Workspace `test:production-import`加载production modules并从rich V0 WAL及V1–V5数据库逐版迁移/打开成功。 |
| Task 6.1 docs/strict/diff gates | **PASS**：独立Markdown local-link checker验证四份冻结current-fact docs；package script/path probe确认记录的root/Core/DSH/CLI gate commands存在；proposal的CONTEXT与ADR repo-relative targets存在且authority内容匹配。刷新后的`change.html`结构完整，只把无SVG/browser等约束施加于Typst path并明确既有Render closure独立保留，未含旧外部absolute authority。修正后`openspec validate add-dsh-typst-generation-tools --strict`与`git diff --check`通过，六个冻结blob复核未漂移。Server/Browser/OpenAPI/database/deployment/Commander/release没有新增Typst scope drift。 |
| Task 6.1 OpenSpec/readiness | **PASS / 8 of 8 / 0 open**：implementation owner在direct evidence通过后勾选6.1；QA重新运行`openspec instructions apply`得到total 8、complete 8、remaining 0，再运行OpenSpec strict与full diffcheck。结束时Host/worker/system-Typst匹配进程以及DSH/CLI smoke、run-cwd、Typst QA临时目录均为0；六个Task 6冻结blob保持不变。QA没有修改tasks。 |

## QA 结论

**TASK 1 PASS；TASK 2.1 PASS；修订后的TASK 2.2 PASS；TASK 3.1 PRODUCTION MOUNT PASS；TASK 3.2 PASS；TASK 4.1 PASS / 0 open；TASK 5.1 PASS / 0 open；TASK 6.1 PASS / 0 product findings。**
历史`WT-TYPST-QA-005`至`009`和后续`WT-TYPST-QA-010`至`014`均已关闭；QA-014按用户确认的首版
same-UID threat-model边界关闭，portable窄窗没有被实现或tests描述为atomic guarantee。本结论覆盖Task 3.2、Task 3.1
production mount与Task 4.1，不因tasks checkbox仍由implementation owner维护而判FAIL；`WT-TYPST-QA-015`与
`WT-TYPST-QA-016`保持关闭，`WT-TYPST-QA-017`本轮独立复验关闭。Task 5.1的physical closure、完整installed runtime
matrix与kind-specific runtime graph verifier通过，`WT-TYPST-QA-018`、`WT-TYPST-QA-019`均关闭。Task 6 docs、SDK allowlist、
focused/full repository、actual package与production compatibility gates全部通过；proposal authority与Typst-vs-Render coexistence范围也已修正并复验。
当前没有open finding。`openspec instructions apply`最终显示8/8，OpenSpec strict、full diffcheck、process/temp baseline与六个冻结blob
在owner勾选6.1后再次复核通过。Change整体 **READY TO ARCHIVE**；archive仍需用户单独明确授权。
