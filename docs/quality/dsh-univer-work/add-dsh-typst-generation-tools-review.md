# `add-dsh-typst-generation-tools` 独立 Review

状态：PASS。Tasks 1、2.1、修订后的2.2、3.1、3.2、4.1、5.1与6.1已独立复核通过，0 open findings；Change完成8/8，READY（未归档）。

## Review 边界

- 唯一可编辑文件为本报告；不修改产品代码、测试、OpenSpec artifacts 或 tasks。
- 冻结的 pre-Typst tree object 为 `e46af9246b2d98e114bfa0bc46d6ecca0fe162af`。最终冻结后以该 tree 与 final tree snapshot 做双端点比较；该对象不是 commit，不使用 three-dot merge-base diff。
- 依据包括根与目标目录说明、Workspace `CONTEXT.md`、ADR 0007、`extract-typst-client-core` artifacts、本 Change proposal/design/specs/tasks，以及现有 Core、CLI、DSH Typst/file/runtime/package seams。
- 采用 Ponytail full：优先复用现有 `WorkspaceToolOwner`、authenticated/license resolver、`WorkspaceUnitFeature`、file-effect gate 和 package workflow；拒绝第二 owner、第二 parser、第二 runtime/worker、通用 artifact abstraction 或 CLI composition 复制。
- Task 2.2 以 pre-code tree `6b010bd0b17b2deee9409562c18447a2919501da` 与 review tree `83674bf3dafcda16c372bfc115e507bc2be21fbf` 做双端点比较；唯一 import-order 修正另以 tree `13402da4a1a94e6a61ed9c5cd02bdac322e287c9` 复核。

## Incremental Standards + Spec checklist

| 轴 | 必须成立的检查项 | 状态 |
| --- | --- | --- |
| 前置合同 | Changes 1–6 全完成；单一 Host owner、authenticated/license resolver、Unit signal/result-unknown、LocalFS/Session cwd gate 与 rc.2 runtime 顺序匹配冻结设计 | Task 1 PASS |
| SDK/public API | 仅使用 `1.0.0-beta.2` 已发布 Typst facade/headless public exports；native binding 版本由 facade owner manifest 解析，不依赖 hoist/checkout | Task 1 PASS，安装态待审 |
| Core cancellation | optional signal 在 resolver/native/program/save/create 等可分离边界前后检查；已开始的不可中断 native/program await 到静止；观察取消后不启动下一步 | Task 2.1 PASS |
| Core budgets | generated JS、UnitData、7.5 MiB projection、8 MiB/depth-64 envelope 在规定边界完整拒绝，不截断、不让超限值进入 create/render | Task 2.1 PASS；DSH fixed controls 待审 |
| VM/random | 每次 materialization 独立 Node VM deterministic random；不改 Host `Math.random`/`crypto`；只执行 exact compiler output；不宣称 hostile-code sandbox | Task 2.2 PASS；REV-TYPST-004 CLOSED |
| Tool schemas | 两个 closed snake_case schema、exact own-key/body revalidation、512 KiB args、cross-field rules、closed canonical results | 待审 |
| Approval/local gate | 纯验证先于 ask；compile/apply 各一次固定 approval；preflight 与 accepted body 重读 current policy/provider/cwd/containment；compile-only 不解析 credential/license | 待审 |
| Artifact publisher | fixed layout、bundle/output disjoint、same-parent private dir、0600/sync、absence recheck、atomic no-clobber rename、50 MiB/256 preview、non-cancellable cleanup | 待审 |
| Apply outcome | exactly one compile/materialize/create；diagnostic failure 不创建/不发布；confirmed Unit 后本地失败显式 partial-side-effect；unknown/no replay/no compensation | 待审 |
| Error/secrecy | exact constructor/code allowlists；只投影 frozen safe detail；不泄露 source/program/PNG/UnitData/license/credential/native loader/absolute或temp path/stack/cause | 待审 |
| Lifecycle | caller/owner cancellation dominance、late confirmed `ABORTED`、owner-only success、accepted-body drain、schema/listener unregister、无 Job/timer/worker/第二 owner | 待审 |
| Package closure | actual tarball 内联 reachable Core/facade/headless JS，精确声明 native wrapper/platform optionals；拒绝 bare Core、workspace protocol、system Typst、CLI/daemon/Session/checkout/source path 与第二 worker | 待审 |
| CLI compatibility | omitted controls 保持原 `compile-typst` input/result、Commander options、write order、diagnostics/previews、JSON/text 与 packaged CLI behavior | PASS |
| Docs/domain | fixed artifact layout、VM-not-sandbox、native cancellation ceiling、partial/unknown、non-responsibilities 与 Unit/Worktree-local terminology准确 | PASS |
| Final gates | focused/full Core、DSH、CLI、actual package verify/smoke、repo typecheck/test/build、OpenSpec strict、diffcheck，以及 final dual-axis review | PASS |

## Task 1 — prerequisites and frozen contracts

结论：PASS，0 open findings。

- `add-dsh-univer-work-plugin-shell` 6/6、authentication 7/7、Space/Node 7/7、Worktree/Unit 7/7、File Transfer 7/7、Content Runtime 8/8，均无未勾任务。
- 现有 DSH composition 只有一个 `WorkspaceToolOwner`；authenticated connection、current runtime license、Worktree-local Unit create、local provider/policy/cwd/path gate 均已有明确 owner。Typst 实现应抽取或直接复用现有 generation 中的同一 license resolution 规则，不能复制第二套环境变量/默认 license 解析。
- `WorkspaceUnitFeature.create(..., signal?)` 已有 stable identity、signal 与 `workspace-result-unknown` 合同；DSH rc.2 已按 arguments snapshot → pre-execute → approval/guard → body quiescence → caller cancellation replacement → post-execute/finalize 的顺序运行。
- Client Core 通过 public exports 提供 `WorkspaceCompileTypstFeature` 与 `HeadlessWorkspaceTypstMaterializer`。安装态 `@univer-cli/doc-typst-facade@1.0.0-beta.2` 和 `@univer-cli/headless-univer@1.0.0-beta.2` 均只公开 package root；facade owner 精确依赖 `@univerjs-pro/doc-typst-native-binding@1.0.0-insiders.20260723-c21613b`，platform optional packages 使用同一精确版本。
- 相对冻结 tree，Task 1 的 Typst change artifact 只有 `tasks.md` 的 1.1 checkbox 变化；未出现 Typst 产品模块、额外 owner/parser/runtime/worker 或 SDK baseline 变更。

独立验证：

- `pnpm --filter @univerjs/univer-workspace-client-core typecheck`：PASS。
- `pnpm --filter dsh-univer-work typecheck`：PASS。
- Client Core focused Typst：2 files / 46 tests PASS。
- CLI Typst/content execution compatibility baseline：2 files / 7 tests PASS。

## Task 2.1 — optional signal, budgets and license

结论：PASS，0 open findings。REV-TYPST-001、REV-TYPST-002 与 REV-TYPST-003 均已修复并独立复验。

- Core API 只给现有 execute/materializer 输入增加 optional controls；未加入 DSH tool、VM、worker、第二 owner 或新的 public workflow。
- compile 前后、materialize 前后、save 前后与 create 前均有 signal fence；compiler/program/factory 已开始后等待 settlement。shared Unit create 收到同一 signal；confirmed create 可返回已验证结果，unknown 保留原错误且外层不重编译、不重 materialize、不重调 create。
- generated JavaScript、visible compiler projection 与 materialized UnitData 使用既有 descriptor-safe canonical measurement；exact byte/depth boundary 成功，max+1、cycle/accessor/非 lossless JSON 在下一持久副作用前失败。
- licensed dependency/factory/program/dispose 未知错误固定投影且不含 license；signal reason 在不可中断 await 后保持 exact identity；cleanup 不覆盖 primary failure。omitted-license 对 `undefined`/`null` rejection reason 也保持旧 raw behavior。
- CLI 继续省略 signal、limits 和 license，原 command input/output 与 composition 不变。

独立验证：Core focused Typst/materializer 2 files / 60 tests PASS；CLI Typst/content execution 2 files / 7 tests PASS；Core typecheck 与 scoped diffcheck PASS。Implement 另报告 Core full 27 files / 575 tests、CLI full 14 files / 69 tests 与 CLI package gates PASS，留待最终总门禁再独立抽验。

## Findings

### REV-TYPST-001 — licensed materializer 破坏 cancellation identity，cleanup failure 绕过 secrecy sanitizer（high，CLOSED）

- 位置：`packages/client-core/src/typst-materialize.ts` 的 factory/body catch、`sanitizeLicensedFailure()` 与 `finally` disposal。
- 复现：为 materializer 提供 license；在 factory 或 generated program 已开始后 abort。后续 `throwIfAborted()` 抛出的 signal reason 被 inner catch 当成未知 dependency failure，改写为 `workspace-typst-runtime-contract`。factory rejection 与 abort 同时发生时，catch 在 post-settlement signal check 前先 genericize。若 `univer.dispose()` 抛错，该错误从 `finally` 直接越过 sanitizer，并可能覆盖已有 structured/cancellation failure。
- 依据：Core spec 要求不可中断 factory/program await 后保留取消、停止后续步骤；resolved license 不得进入任何 Core error detail。cleanup 不能改变更高优先级的已知错误。
- 最小修复：在每个不可中断 await settled 后、dependency sanitization 前保留 supplied signal reason；把 licensed disposal failure 纳入同一安全投影，同时保留 genuine `WorkspaceApplicationError`，且 cleanup failure 不覆盖原始 structured/cancellation failure。补 licensed factory/program abort barriers 与 dispose sentinel secrecy regression；CLI omitted-license 继续保留旧 raw-error behavior。
- 复验：实现用 signal-aware projector 保留 exact caller/owner reason，并把 licensed factory/program/dispose unknown failure 固定化；独立 focused tests 与 typecheck 通过。

### REV-TYPST-002 — failure value 被误当作 failure presence（medium，CLOSED）

- 位置：`packages/client-core/src/typst-materialize.ts` 新增的 `failure`/`result` settlement state。
- 复现：omitted-license 路径中的 generated program 或 `save()` 合法地 `throw undefined`。`projectFailure()` 为兼容旧行为返回原 reason，但 `if (failure !== undefined)` 把它当作成功并返回未赋值的 `result`。若 primary reason 是 `null`，后续 disposal error 又会通过 `failure ??=` 覆盖 primary。
- 依据：JavaScript rejection reason 是 `unknown`，旧实现会原样 reject；Task 2.1 要求 omitted controls 保持 CLI behavior，cleanup 也不得覆盖先发生的业务/取消失败。
- 最小修复：用独立 boolean 或 discriminated outcome 记录是否已有 primary failure；即使 reason 为 `undefined`/`null` 也必须 throw，且仅在没有 primary failure 时采用 cleanup failure。补 omitted-license `throw undefined` 与 primary-null/cleanup precedence regression。
- 复验：实现以独立 `failed` boolean 记录 presence；table regression 证明 `undefined`/`null` primary reason 原样 reject 且 dispose failure 不覆盖。独立 focused tests 与 diffcheck 通过。

### REV-TYPST-003 — native compiler rejection 绕过 post-settlement cancellation（high，CLOSED）

- 位置：`packages/client-core/src/typst.ts` 的 `await this.compile(...)`。
- 复现：compiler promise 已开始，caller abort，然后 compiler 以 raw native/dependency error reject。fulfilled 路径有紧邻的 `throwIfAborted()`，rejected 路径直接越过该 fence并返回 raw compiler error。
- 依据：Core spec 要求不可中断 native compiler settled 后立即观察 cancellation并不启动后续步骤；该要求不以 promise fulfilled 为前提。
- 最小修复：只包装 compiler await；catch 中若 signal 已 abort则抛 exact signal reason，否则原样 rethrow compiler reason。补 abort→reject barrier 与 no-abort raw rejection identity regression，保持 compile once且 materializer/create 为零。
- 复验：compiler await 的 rejection branch 先执行 signal fence；abort→reject 返回 exact reason，无 abort 时保留原 dependency error identity，后续 materialize/create 均为零。独立 Core focused 2 files / 61 tests 与 typecheck PASS。

### REV-TYPST-004 — VM 无法控制 Host Facade 内部 ID randomness（blocker/high，CLOSED）

- 位置：Task 2.2 design/spec 与冻结 `@univer-cli/headless-univer@1.0.0-beta.2`、`@univerjs/core@1.0.0-beta.2` public contract 的交界。
- 独立复现：把 exact compiler JavaScript 放入每次独立 `node:vm` context，并只在该 context 注入 seeded `Math.random`/`crypto.getRandomValues` 后，运行 `packages/client-core/test/typst-native.test.ts`。两次真实 native compile/materialize 的 Doc body、text相同，但 `paragraphId` 与 `sectionId` 不同，因此 `initialData` 不 deterministic。
- 根因：exact compiler JavaScript 只调用注入的 Host Facade；paragraph/section IDs 由 Host realm `@univerjs/core` 的 lexical `generateRandomId()` 在 Facade mutation 内生成。VM intrinsics 不影响 Host函数的 lexical globals。published headless factory options 只有 `license` 与 optional `embedPluginConfig`；Core 公开生成函数但没有 per-runtime RNG/ID provider setter。
- 冲突：当前要求同时禁止 Host global descriptor/function 改动、worker/second lifecycle、private source/API、Facade/UnitData reimplementation，并要求真实 saved UnitData deterministic。冻结 public surface 无法同时满足这些条件。
- 合规决策选项：
  1. 先升级上游 SDK/public contract，为 headless runtime 注入 per-runtime RNG/ID provider，或让 compiler 输出显式 stable IDs；本 Change 只消费该 public seam。
  2. 修订 deterministic requirement，明确排除 Host-generated opaque IDs，并定义可验证的 semantic projection。
  3. 明确授权 isolated worker/process，在隔离 realm/process 中保留旧 deterministic global patch，同时承担新增 entry、protocol、package 与 shutdown owner。
  4. 放宽 Host-global invariant，接受串行旧 patch；这会恢复真实 output determinism，但不满足当前并发 Host 观察要求。
- 非合规 workaround：deep/private import、monkeypatch ESM internals、在保存后遍历重写 UnitData IDs，或暗中新增 worker。Implement 已正确撤回 WIP并暂停，Task 2.2 保持未勾。

- 解决：用户确认首版采用选项 2。proposal、design、两份 delta spec 与 tasks 已把 deterministic contract 限定为排除 SDK-owned opaque paragraph/section/list/range identities 后的语义内容；persisted UnitData 保留这些有效 ID，production 不做 normalizer。Task 2.2 随后实现 per-invocation VM 并通过独立 QA 与双轴 review。

## Task 2.2 — per-invocation VM 与语义确定性

结论：PASS，0 open findings。

### Standards

- Hard violations：0。实现只使用 Node `node:vm`，保持 strict ESM、named exports、Client Core package 边界与既有 owner；没有新依赖、worker、通用 walker 或 production identity normalizer。
- 首轮发现一个 Low judgement：`node:vm` import 未按 Client Core 既有 node-first 顺序分组。原 implement agent 只移动该 import；原 QA 复跑 materializer 40/40 与 diffcheck，原 Standards reviewer 复核后关闭 finding。
- Baseline smells / Ponytail：0。两种测试投影语义不同，未抽取无必要的 generic walker。

### Spec

- Missing / partial：0；scope creep：0；implemented-but-wrong：0。
- 每次调用创建独立 VM context，并只为 compiler program 安装同 seed 的 local `Math.random` 与 `crypto.getRandomValues`；bridge 在 program 执行前删除，Host descriptors/functions 保持不变。
- exactly-one Doc、prohibited lifecycle、save/revision/name 与 total dispose 继续由既有 guarded Facade seam 承担。真实 native 并发测试只在测试副本排除 `paragraphId`、`sectionId`、`listId`、`rangeId`；原始 UnitData 保留有效 opaque IDs 且不同 run 可以不同。

双轴汇总：Standards 0 remaining findings；Spec 0 findings。

## Task 3.1 foundation — closed tools 与 registration seam

结论：FOUNDATION PASS，0 open findings；Task 3.1 整体仍 PARTIAL/未勾。固定区间为
`9693346389e4f3bee0b325829d967ce7d15645a3` → `bdfc505746ea023d715906a9ade7d4a44625cd96`。

独立 QA 首轮发现并关闭 `WT-TYPST-QA-004`（High）：compile/apply result validator 原先只校验
`artifactDirectory` 是否存在，没有要求它与 validated request identity 相等。修复后两者都执行 exact equality；wrong、absolute 与
omitted-input/unexpected-output paths 均固定返回 `workspace-typst-result-invalid`。

### Standards

- Hard violations：0；judgement-call smells：0。598 行 production module 都服务 closed trust boundary；没有第二 owner、parallel parser/registry、worker、factory、dependency 或 speculative generic service。
- 相邻 Office/content/worktree validators 是 owner-private 且语义更宽，抽公共 helper 会扩大合同。由 Client Core package root 导出现有 `measureCanonicalJson` 是最小复用，避免跨 package `src` import 或复制 canonical bytes/depth walker。
- injected compile/apply callbacks 是连接 Tasks 3.2/4.1 的最窄 operation seam；当前不再包 factory 或 adapter。

### Spec

- Foundation implemented-wrong：0；scope creep：0。
- 两个真实 ToolRuntime definitions/registration、closed schemas/results、descriptor-safe exact-own validation、cross-field rules、512 KiB arguments、8 MiB/depth-64 complete values、fixed approval、pre/body revalidation、owner lifecycle 与 Native/Code pairing已具备。
- 唯一 partial 是 production Host 尚未 import/register该 seam，真实 compiler/artifact/apply adapters 尚未连接。因此 fake operation tests 只能证明 foundation 输出拒绝 JavaScript/PNG 与 compile/apply依赖分离，不能替代最终真实 adapter secrecy/credential/license 证据。
- 当前不在 `authentication.ts` 注册半成品工具。Task 3.2 提供 local artifact owner、Task 4.1 提供 authenticated/license/Core apply composition 后，才一次性 production mount并关闭 3.1。

双轴汇总：Standards 0 findings；Spec 0 implementation-error findings，1 expected partial（production mount）。

## Task 3.2 — local artifact publication

结论：PASS，0 open findings。最终窄实现tree为`246ddd58d068c63213967cb31d95b785e8c6a093`；QA报告合并后的full tree为`032c8e0d9f936ec53558820d24b2714dd5cc0e1e`。

### Standards

- Hard violations与新增抽象均为0。实现只使用Node filesystem primitives、既有file gate和同一tool owner；没有native helper、递归public cleanup、第二artifact service或同UID隔离伪保证。
- 随机mode-`0700` private staging只清理显式ledger中仍匹配identity的路径；未知preview不经目录扫描认领。public destination一旦预占，所有failure finalizer均只清理private state。
- 首轮review发现stage创建缺少逐步cancellation fence；回修后`lstat`、`stat`、`mkdtemp`、`chmod`、`mkdir`与identity读取settle后均检查signal，并在compile/apply dependency前再检查一次。独立QA对8个创建fence逐点取消，private残留与dependency调用均为0。

### Spec

- no-clobber hard-link发布在每次写后和最终success前复核directory/file identity、size、closed layout与50 MiB总量。destination、preview directory、public file或layout漂移均fail closed，并保留已公开partial目录；QA-010至QA-013均以真实filesystem probe关闭。
- QA-014按用户确认的first-version threat model关闭：portable Node的`lstat`→`unlink/rmdir`窄窗不被描述为atomic；hostile same-UID tampering需要独立user/container或native `unlinkat`设计。
- review发现safe confirmed Unit原先在完整result校验后才保存，且缺少512 KiB Unit/envelope reserve。回修先执行args-bound closed Unit validation与524,288-byte/depth-64 gate，只保存有界identity；其后的result、diagnostic、preview或artifact failure统一返回`workspace-typst-partial-side-effect`。malformed Unit保持invalid且不泄露伪造identity。
- compile partial只返回Session-relative artifact path与固定inspect/no-replay guidance；confirmed apply只追加validated Unit/Worktree identity。absolute/temp path、source、program、PNG、UnitData、credential、license、stack与cause不进入错误。
- `sourcePath`的relative-contained diagnostic projection仍明确归Task 4.1，不作为Task 3.2 blocker；production mount与installed native closure分别归Tasks 4.1与5.1。

独立验证：focused Typst 1 file / 28 tests、DSH full 10 files / 564 tests、DSH与Client Core typecheck、OpenSpec strict及diffcheck全部PASS。真实final-boundary regression在第7个fence失败，并验证`committed:false`与public bytes保留。

双轴汇总：Standards 0 remaining findings；Spec 0 current-task findings，1 Task 4.1 carry-forward（`sourcePath`）。

## Tasks 3.1 / 4.1 — production composition与outcome closure

结论：PASS，0 open findings。最终产品tree为`47d00fc7c3fee901998356d89b313aea42fb1770`；QA报告合并后的full tree为`d5e1a951c5fb84c63a66349305ca217f4dc69bd9`。

### Standards

- 两个tools一次性挂入existing authentication effect并复用同一`WorkspaceToolOwner`、authenticated HTTP、application license resolver、`WorkspaceUnitFeature`与content runtime shutdown顺序。未新增owner、worker、Job、timer、retry或generic artifact/error registry。
- Client Core只公开repository-owned `projectWorkspaceTypstDependencyFailure()`；facade constructor/type guard保留在Core内部，DSH不依赖上游错误类型或code duck typing。
- UnitData budget walker只服务DSH optional limits。create仍收到原始SDK UnitData；CLI省略limits时继续走既有input/error路径。

### Spec

- production Native与Code catalog均发现exact两个tools。compile-only真实native路径为零credential、零license、零HTTP；apply每次读取current license和credential，以exact one compile/materialize/create完成Worktree-local Doc。
- diagnostic/preview `sourcePath`共用纯lexical relative-contained gate，拒绝absolute、drive/UNC、scheme、backslash、NUL、empty、`.`与`..` segment；合法bundle-relative source保留。
- DSH-controlled Core apply在create前构造并预算完整六字段public identity，并把同一UUID交给existing Unit owner。result-unknown、mismatch与invalid-response保留exact code和同一bounded recovery identity；CLI omitted limits不改变Unit owner全局合同。
- UnitData预算拒绝symbol、accessor、non-enumerable语义差异、sparse/extra-key arrays、nonfinite、cycle、Proxy、exotic/custom prototypes与可执行`toJSON`。真实native保留的foreign-realm plain object只在其prototype与Host `Object.prototype` intrinsic keys、descriptor flags和native function metadata完全一致时接受。
- matcher在任何reflection前拒绝object/prototype/function Proxy，并用own data descriptors比较candidate function的`name`/`length`，不读取getter。最终probe为getter/trap 0、payload未注入、create 0；真实native limited apply与opaque identities保持成功。
- caller late-success compile/apply由真实rc.2 `tools/post-execute` race返回`TOOL_ABORTED`并运行fixed inspect/no-replay finalizer；已发布artifacts与已创建Unit保留，每个dependency只执行一次。owner-only confirmed success、pending work drain、remount与private cleanup均通过。

独立验证：Core focused最多5 files / 134 tests、DSH focused2 files / 93 tests、CLI compatibility2 files / 7 tests；最终Core full28 files / 624 tests、DSH full10 files / 571 tests；三个package typecheck/build、OpenSpec strict与diffcheck全部PASS。

双轴汇总：Standards 0 findings；Spec 0 findings。

## Task 5.1 — installed native package closure

结论：PASS，0 open findings。最终verifier blob为`c39007674c1ba6d9b18b83a9f7fc3374593b82db`，smoke blob为`141f9eea52d21781467684309bc5307c749793de`；QA synthetic final tree为`0c33b0e66972144b30c96cfc55db1e15b43090c7`。

### Standards

- package assembly从physical facade owner manifest解析exact native wrapper与五个平台optional cohort；当前darwin-arm64 package由同一owner graph解析，不从pnpm hoist或checkout猜版本。
- private Core、facade、headless JavaScript与TypeScript printer内联；只有native wrapper作为external runtime dependency。root facade仍只导出`apply`、`inject`、`name`，Typst不增加worker entry或public subpath。
- verifier复用现有TypeScript AST collector，按ESM、CJS、URL与Worker kind解析runtime references。ESM要求exact file，CJS只保留Node兼容fallback；relative missing、undeclared bare、remote、checkout/source、system Typst、CLI/daemon/Session、deferred SVG与alternate/bare Worker均fail closed。
- nonliteral runtime exceptions仅限冻结的collaboration worker-child与SDK runtime-pool chunk；unique worker allowset仍只接受现有Content worker。synthetic matrix覆盖options参数、extensionless ESM、require/resolve/new URL/Worker和POSIX/Windows路径near-miss。

### Spec

- fresh profile实际安装tarball，installed entry位于profile内，Session cwd位于profile外且无workspace`node_modules`。真实native compile/previews、fixed modes/layout、no-clobber、512 KiB exact/+1和Unit envelope预算均通过。
- 两次real apply保留各自opaque IDs；test-only排除SDK-owned identities后semantic content一致。nonempty current license与rotated cookie实际传递且不泄露。
- installed真实HTTP覆盖same-key result-unknown recovery、confirmed Unit + artifact partial preservation、started caller cancellation与active owner dispose等待HTTP/private cleanup、unregister和bounded settlement；无自动compile/materialize/create replay或compensation。
- Typst路径以spawn/browser sentinel和process差集证明零system Typst、零browser/download fallback；组合Render仍只使用显式Chrome。process audit只拒绝新增PID，允许baseline进程自行退出，连续smoke不再产生时序假阳性。
- 50 MiB artifact/UnitData exact边界由source suites直接覆盖；installed smoke以较小exact gate加真实native运行验证打包接线，避免重复大内存分配。

独立验证：`package:verify`、显式Chrome fresh-profile `package:smoke`、DSH full10 files / 571 tests、Core full28 files / 624 tests、CLI package compatibility13 tests、三方typecheck/build、script syntax、OpenSpec strict与diffcheck全部PASS。

双轴汇总：Standards 0 findings；Spec 0 findings。

## Task 6.1 + whole-Change final review

结论：PASS，0 open findings。最终复核的proposal、design、DSH Typst delta spec、`change.html`与tasks blobs依次为`84c7152b595177e06b10a26cbd37780aecdc0d1f`、`af53ea4d43fb70f3c6de0df0fe5a86af0ccf082e`、`9867b713b3ff61f55133e8e77f3f9d4b3745edbd`、`d8601306f1262fc1f42ebdefa942fcc26f5f3ce4`与`44c9b54d7a6937e5743532c3471ace8a110174ba`；DSH与Client Core README blobs为`618cb3fbdcefff0460b5a16178930e7328ea6b9b`与`a65f9331d92095a535684560663f7853c41ef913`。

### Standards

- 两份README以当前实现为界，准确记录two-tool scope、fixed layout、semantic content与opaque identity边界、VM非安全沙箱、不可中断native/program ceiling、partial/result-unknown及安装态native closure；没有把后续能力写成当前事实。
- proposal的Domain Alignment使用仓库相对路径`apps/workspace/CONTEXT.md`并引用accepted ADR 0007；`change.html`已在proposal/design修正后重新生成，未保留旧的绝对checkout引用或过时边界。
- independently-versioned SDK检查使用显式allowlist与实际workspace fixture，不把整个package prefix误当独立版本集合，也没有放松package owner-manifest、platform optional或单一SDK baseline验证。
- 文档与代码保持既有单owner、private Core、published-package-only和strict ESM边界；未增加第二worker、公共export、通用artifact抽象或跨应用`src`导入。

### Spec

- design §7与packed-artifact delta spec只约束Typst reachable graph的SVG/browser/font/system-Typst排除；现有Render closure被明确保留并独立验证，文档不再把整个package的Browser资源错误描述为零。
- CLI omitted-controls、Commander options、write order、diagnostics/previews与JSON/text行为仍由独立compatibility tests覆盖；Task 6没有改变generic UnitData合同或提前引入Task外能力。
- final scope diff未涉及Workspace Server、Browser、OpenAPI、database、deployment、Commander或release行为；SDK baseline、native owner graph、Content/Render closure与production import保持原合同。
- Task 6.1已完成，Change tasks为8/8。先前发现的Domain Alignment绝对路径、过宽Browser排除与过时`change.html`均已在限定文档范围内修复并复验关闭。

独立验证：SDK dependency tests 4/4；Core Typst focused 4 files / 72 tests；DSH Typst focused 1 file / 34 tests；Core full 28 files / 624 tests、DSH full 10 files / 571 tests、CLI full 14 files / 69 tests及其余workspace suites全部PASS；root typecheck/test/build、Workspace production import、DSH package verify/fresh installed smoke、CLI package/verify/smoke、OpenSpec strict与global diffcheck全部PASS。

双轴汇总：Standards 0 findings；Spec 0 findings。Task 6.1与whole Change均0 open，READY FOR VERIFY/ARCHIVE；本review不执行archive。

## Final result

Tasks 1、2.1、2.2、3.1、3.2、4.1、5.1与6.1 PASS，Standards与Spec均0 open findings。Change完成8/8，READY FOR VERIFY/ARCHIVE；尚未归档。
