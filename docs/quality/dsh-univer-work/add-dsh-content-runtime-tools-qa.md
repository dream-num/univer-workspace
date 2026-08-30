# add-dsh-content-runtime-tools QA

本报告是 OpenSpec Change `add-dsh-content-runtime-tools` 的独立验收记录。QA 只更新本文件，
不修改产品代码、测试、OpenSpec tasks，不 commit、push 或 archive。

## 环境与边界

- 冻结基线：Workspace commit `a01adf28bfdfbf098ecf66653d520d08ecac4117`、SDK
  `1.0.0-beta.2`、DSH `0.1.1-rc.2` / `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`。
- 真实验证正常启动/复用 Workspace `http://127.0.0.1:3020`，禁止 `db:reset`；DSH 必须安装 actual
  tarball，并从无 workspace `node_modules` 的无关 cwd 运行真实 worker。
- 真实远程数据只创建 QA-only Worktree-local Draft/Unit/content；检查只读、no-mutation execute、
  confirmed mutation 与 read-back。unknown 只 inspection，不盲重放 Facade code。
- credential、license、cookie、grant、caller code、raw Session transcript 与产品 raw IDs 不写入报告。
  auth 失效时只把 verification URL/code 发给 root，由 root 通过 Chrome 授权。
- QA 结束时正常关闭 worker/Host/Server，清理本轮 profile、tarball、local evidence，并通过已交付工具将
  QA-only remote state 置入可恢复状态；不触碰既有用户数据。

## 编号验收标准

### Client Core cancellation 与执行语义

- **AC-01** 只给 inspection/execute 可达的 Worktree/Trunk target resolution、content execution、runtime
  read/write、credential/license resolver、embedded-image 与 commit 追加向后兼容 optional signal；execute
  只追加 optional `maxValueBytes`/`maxValueDepth`。
- **AC-02** target lookup、Unit-type probing、Snapshot/read 与 editable validation 观察同一 signal；取消后不启动
  下一 request、worker 或 runtime step，不返回 partial target。
- **AC-03** per-key queue 等待、acquire、state、pull、read/write execute、replacement 与 commit 在每个可分割
  边界检查 signal；冻结 pool 的 in-flight promise 必须 await 后再分类，public operation 不遗留后台 worker work。
- **AC-04** credential/license resolution 在新 worker 前观察 signal；取消或 dependency failure 不启动 acquire，
  错误不反射 credential/license/provider material。
- **AC-05** runtime owner close 停止新 admission，等待 queued/active operation、lease 与 worker/pool close；同一
  runtime key 不出现 detached work。
- **AC-06** execute value 在任何 upload/replacement/commit 前验证 lossless JSON、caller byte/depth budget；超限
  不截断、不产生远程 content mutation，也不在 commit 后降级成 ordinary size error。
- **AC-07** cancellation 在下一个 image upload 前可见时不 dispatch upload/commit，dirty lease 不复用；普通
  unsignalled/non-cancelled upload failure 继续保留原 BASE64 byte-for-byte fallback。
- **AC-08** 已 dispatch image upload 在取消下不确定时保留 `workspace-result-unknown`，停止后续 upload、
  replacement 与 commit，不转为 BASE64 fallback。
- **AC-09** 至少一个 upload confirmed 后、下一 upload/replacement/first commit 前取消，返回
  `workspace-content-partial-side-effect`，含 confirmed count、`contentCommitted:false` 与 authoritative target；
  invalidate lease，不补偿 delete/re-upload，不 replay code/externalization；caller 与 owner close 同语义。
- **AC-10** replacement 后 commit 前取消不 dispatch commit；retry/unknown 后取消不启动下一 attempt，保留同一
  pending changeset 的 `workspace-result-unknown`，不 replay code/image。
- **AC-11** confirmed uploads 后 commit unknown 以 changeset `workspace-result-unknown` 为主；只投影 safe
  changeset/target identity，不再 upload、replace、commit 或 replay。
- **AC-12** commit confirmed 与取消 race 时 Core 可返回 confirmed revision；无 signal caller 保留同一 pending
  changeset 三次 bounded attempts 与既有 terminal codes，Facade code 始终只执行一次。
- **AC-13** Workspace CLI daemon wire 仍只含原 code/serialized target，不传 signal、budget 或 DSH types；既有
  execute/inspect/exchange/screenshot/runtime consumers 的 payload、result、retry、lifecycle 不变。
- **AC-14** CLI actual package 的 daemon/worker child/native dependency closure 与安装态 worker-backed smoke
  保持自包含，无 bare Core/source-checkout 依赖。

### 两个 closed tools、validation 与 approval

- **AC-15** Native catalog 与 Code SDK 只新增 `workspace_content_inspect`、`workspace_content_execute`；两者 root
  `additionalProperties:false`，execute 仅 `worktree_id/unit_id/code`，inspect 仅 frozen target/query fields。
- **AC-16** inspect 的 Trunk target 禁止 `worktree_id`，Worktree target 必须提供它；authority、Unit type、revision
  从 Core 解析，Worktree inspection 只读 Draft，不改变 Trunk。
- **AC-17** inspect 接受 workbook、worksheet、worksheet-range、presentation、slide、document、paragraph 七种
  exact query；selector exact one-of，index 为 zero-based non-negative，query 与 Sheet/Slide/Doc type 匹配。
- **AC-18** inspect pure validation 顺序为 exact keys/types/cross-fields → array count → 524,288-byte complete
  canonical args → selector/A1 grammar → safe area/100,000 cells；每 query 最多 64 selectors/ranges。
- **AC-19** empty/malformed/row-zero/reversed A1 固定 `INSPECTION_SELECTOR_INVALID` 且不回显 range；grammar-valid
  unsafe arithmetic 或 safe cells 超限固定 `workspace-content-limit-exceeded` / `worksheet-cells`。
- **AC-20** inspect result application validator 完整验证七个 discriminants、query/result/Unit compatibility、所有
  nested exact keys/JSON/ICellData 与 recursive Slide children；depth 64 有效，65 或任何 deep unknown key 拒绝。
- **AC-21** inspect/execute canonical output 必须 lossless、depth ≤64、UTF-8 JSON ≤8,388,608 bytes；不返回
  truncated value、spill handle 或 alternate partial shape；递归 children 的 DSH schema 如实投影为 `JsonValue`。
- **AC-22** execute 只解析 authoritative Draft Worktree Unit，支持 Sheet/Doc/Slide/Base/Board；拒绝 Trunk、非 Draft、
  不属于 Worktree 的 Unit 与 caller-supplied type/revision/origin/runtime target/file/script/path/credential/action。
- **AC-23** approved execute 无 mutation 返回 closed `{ committed:false,value }` 且不 commit；有 mutation 只在同一
  pending changeset confirmed 后返回 closed committed/revision/status/value，Facade code 不二次执行。
- **AC-24** blank/syntax/reserved binding/unit mismatch 与 non-editable target 保留稳定 code，均不虚报 confirmed
  commit；body canonical result 的 missing/extra/invalid revision/status/non-JSON/wrong Unit 在 render 前拒绝。
- **AC-25** execute shared policy/body validator 按 exact keys/types/non-blank → 524,288-byte complete args →
  262,144-byte code 执行；invalid/oversize 在 ask、credential、HTTP、worker/body 前失败且不复制 raw input。
- **AC-26** valid execute 固定一次 secret-safe approval，accepted body 重做同一 pure validator；reject/cancel/
  unavailable/no-channel 全部在 resolver/worker/Facade/upload/replacement/commit 前 fail closed；inspect 不新增 ask。
- **AC-27** Core 用 8,388,000-byte execute-value pre-side-effect reserve，shell 再验证 8 MiB/64-depth envelope；
  Native render 与 Code Mode 返回同一 canonical value。

### Runtime generation、错误、取消与 lifecycle

- **AC-28** Host effect 只持有一个 lazy current runtime generation，worker entry package-relative；worker 初始化
  直接取得 current authenticated origin/cookie 与非空 `UNIVER_LICENSE` override 或同步 application default，
  tool/module/config/session 不接触 grant/license。
- **AC-29** missing/pending/malformed/deleted/cross-origin grant 在 worker content 前返回 sanitized auth error；
  missing/blank/rejected license 返回 `workspace-license-required`，均不泄露 rejected value。
- **AC-30** exact credential-record event retire/close 旧 generation；active work settle 后，下一 accepted operation
  从 current record 创建新 generation，不复用旧 cookie；每 generation 只 close 一次。
- **AC-31** content allowlist 只保留 frozen Workspace/source/inspection/execution/runtime/pool/Server codes 与各自
  exact safe nested detail；任何 unlisted/unsafe error 固定 `workspace-content-operation-failed`，identity 只来自
  structured result/detail，不解析 `Error.message`。
- **AC-32** error/result/finalizer/plugin lifecycle 不反射 code、credential、license、grant、raw rejected args、
  selector id/name、arbitrary query、worker init、message/cause/stack/header/cell sentinel；authorized successful
  content/value 保持 lossless。DSH-owned Native/Code argument records 按 rc.2 保留 caller code 且不被复制。
- **AC-33** already-aborted caller 在 zero validator/resolver/approval/worker/request 下返回
  `ABORTED_BEFORE_DISPATCH`；caller 与 owner signal 融合且来源可区分。
- **AC-34** inspect 在不可中断 worker operation 中取消时等待它 settle，随后不启动下一 step、不返回 partial
  content，并按 caller/owner 分类。
- **AC-35** execute 在 remote mutation dispatch 前取消时 no upload/commit，clean/invalidate lease 后 settle；
  in-flight upload unknown 作为 thrown `workspace-result-unknown`，不被 DSH 改成 `ABORTED`。
- **AC-36** caller/owner 在 confirmed upload 后取消时，thrown partial-side-effect code 保留；final guidance 固定说明
  orphan candidate、要求 Worktree inspection、禁止 replay/re-upload，且不含 secret/raw argument。
- **AC-37** commit retry/unknown 或 confirmed uploads 后取消时，thrown changeset result-unknown 优先，final guidance
  要求 Worktree get/content inspect；shell 不 polling/read-back/replay。
- **AC-38** caller abort 后 body late confirmed success 由 rc.2 返回 canonical `ABORTED`；owner-only confirmed
  success 可在 disposal drain 中成功；unconfirmed write 始终 unknown。
- **AC-39** disposal 停止 admission、显式注销 2 tools/approval/credential listener、abort owner、close current
  generation 并等待 accepted bodies/finalization；无 tool/listener/worker/lease/request/retry/timer/Job/daemon/cache/
  detached promise 存活。

### Artifact、真实环境与兼容性

- **AC-40** Host/worker multi-entry tarball 内联 reachable private Core/exact SDK JS，复制 colocated
  `worker-child.mjs`；从 installed formula-rust owner manifest 解析 exact binding、externalize/declare/copy，并定义
  `__UNIVER_RUST_FORMULA_LOCAL_BINDING_FALLBACKS__ = false`；无 bare Core/workspace、CLI source/daemon/Session、
  absolute checkout/source path、adjacent fallback、Office/render/generation/future capability。
- **AC-41** unrelated cwd isolated installed smoke 使用 real ToolRuntime、`worker.js`、worker child、exact binding、
  packaged credential/license resolver；覆盖 Trunk/Worktree inspect、no-mutation/confirmed/unknown execute、
  credential rotation、cancellation、normal disposal，Native/Code transcript sentinel 分区正确。
- **AC-42** actual installed real Agent scheduler 能发现并调用 inspection 与 approved execute，不 direct-import
  source、不调用 CLI subprocess；Code Mode paired start/settled arguments/value/error/approval 与 closed schema 一致。
- **AC-43** 真实 Workspace `:3020` + actual worker 对 QA-only Draft 完成 inspection、一次 approved no-mutation
  execute、一次 approved confirmed mutation、inspection read-back；revision/content identity 一致，unknown 时停止并
  只 inspection，绝不 blind replay；QA-only remote state 有可恢复 cleanup disposition。
- **AC-44** DSH/Core/root README 准确记录当前 scope、worker/license owner、durable caller-code warning、取消 ceiling
  与 exclusions；Server/Browser/OpenAPI/database/deployment/CLI command/release/SDK baseline 无越界变化；Core/DSH
  focused/full typecheck/test/build、package verify/smoke、CLI focused/package verify/smoke、OpenSpec strict、repo
  typecheck/test/build、production import 与 `git diff --check` 全部 exit 0，retry-only green 不关闭 issue。

验收项总数：**44**。

## 测试矩阵

| 规格组 | 必要直接证据 |
| --- | --- |
| Core target/execution | pre-abort、mid-target abort、request counts、prepared code/budget forwarding、unsignalled compatibility |
| Runtime quiescence | same-key queue、acquire/state/pull/read/write/replace/commit barriers、awaited close、no detached work |
| Embedded image/commit | ordinary fallback、in-flight upload unknown、first-confirmed abort before next/replace/commit、commit unknown dominance、no replay |
| Tool schemas/limits | exact catalog/root/query/selectors、huge single/combined args、A1 invalid/overflow/cell totals、output bytes/depth |
| Result validators | seven inspection unions、query/Unit mismatch、nested JSON/ICellData、Slide depth 64/65、closed execute envelopes |
| Approval/errors | real ToolRuntime pre-ask validator、allowed-once/reject/cancel/unavailable/no-channel、allowlist/detail/non-reflection sentinels |
| Runtime generation | lazy reuse、current grant/origin/license、replace/delete active record、one close/generation、no stale cookie |
| Cancellation/finalizers | pre-dispatch、in-flight read、pre-mutation、partial side effect、commit unknown、late confirmed `ABORTED`、owner drain |
| Installed artifact | actual pack file/import scan、worker/child/binding/license closure、unrelated cwd ToolRuntime/Agent/Code Mode |
| Real Workspace | QA-only Draft inspect → no-mutation execute → mutation execute → inspect read-back；unknown only inspect |
| Compatibility | CLI wire/execute/inspect/daemon/worker/package，README/scope diff，OpenSpec/repo gates |

## Issues

发现问题立即发送 `/root/space_node_implement`；修复后复跑原 repro、相邻 security/race case 与最小回归 gate。

| ID | Severity | Evidence | Expected | Repro | Status |
| --- | --- | --- | --- | --- | --- |
| REV-CR-01 | High | already-aborted execute signal 原先仍可进入 authoritative target resolver。 | pre-abort 在 zero resolver/HTTP/runtime 下保留 caller cancellation。 | `WorkspaceContentExecutionFeature.execute()` with aborted signal + resolver spy。 | **RESOLVED**：shared `executeForTarget` 在 resolver 前 `throwIfAborted()`；独立复跑 zero-call repro 与 Task 2 focused 通过。 |
| REV-CR-04 | High | Task 6 error adapter 原先只识别 `WorkspaceApplicationError`，随后加入的 DSH-side exact `instanceof` 仍无法识别 Core peer context 实际加载的另一 physical `CollaborationRuntimeError` / `UniverCollaborationRuntimePoolError`。 | 保留真实 Core-origin allowlisted collaboration runtime/pool code，同时丢弃 message/cause/source material；source 与 packed graph 都必须证明 constructor owner 一致或跨 physical copy 安全识别。 | `createRequire(dsh manifest)` 与 `createRequire(Core manifest)` 分别解析 beta.2 runtime/pool；两组 module path、constructor identity 不同，Core-origin instance 对 DSH constructor 的 `instanceof` 为 false。 | **RESOLVED**：Core 从自身 dependency context re-export constructors，DSH 只从 Core 导入；source identity/full gates 通过。actual tarball debug smoke 又由 packed worker/runtime-pool 构造真实 `CollaborationRuntimeError(COLLABORATION_LOAD_FAILED)`，Host/ToolRuntime 保留该 code 且公开结果不含内部 message/stack/path，安装态 constructor owner 与 secrecy 已直接证明。 |
| WT-CR-QA-001 | Medium | Task 5 mid-diff 用 `value["worktree_id"] !== undefined` 判断 Trunk cross-field，因此 own `worktree_id: undefined` 被当作未提供并通过。 | Trunk 只要 own key 存在即拒绝；runtime exact-key/cross-field validation 不依赖值是否可 JSON 序列化。 | direct `validateWorkspaceContentInspectArgs({ unit_id, scope:"trunk", worktree_id:undefined, query:{kind:"workbook"} })`。 | **RESOLVED**：改用 `Object.hasOwn`；独立 focused 覆盖 Trunk own-undefined 与 Worktree own-undefined，13/13 PASS。 |
| WT-CR-QA-002 | Medium | worksheet/slide/paragraph selector validation 使用 `Array.prototype.forEach`，会跳过 sparse holes；一项 sparse selector 被 canonicalize 为 `null` 后仍通过。 | selector/range arrays 必须 dense 且每项通过 exact one-of validation；malformed direct args 不进入 authenticated work。 | `worksheets = new Array(1)` 的 direct pure-validator probe。 | **RESOLVED**：共享 `validArrayShape` 逐索引检查 own key；独立 focused 覆盖四类 sparse arrays，13/13 PASS。 |
| WT-CR-QA-003 | High | Task 5 result validator 对 worksheet/slide/paragraph 只比较数组长度；worksheet-range 只比较 requestedRange，未证明每个 returned worksheet/slide/paragraph identity 匹配对应 selector。错误 Unit 已拒绝，但同 Unit 的错误 selected item 可通过。 | application validator 按顺序核对 selector `{id}`/`{name}`/`{index}` 与 returned identity；range 同时核对 worksheet selector，完成 frozen query/result compatibility。 | valid-shaped result with same count but different selected item identity。 | **RESOLVED**：四类结果按顺序调用 `matchSelector`；独立 focused 覆盖 worksheet/range/slide/paragraph wrong identity，13/13 PASS。 |
| WT-CR-QA-004 | Medium | Task 7 verifier 用 `await import(pathToFileURL(coreRequire.resolve(runtime)))` 读取 obfuscated CJS package；Node namespace 没有 synthesized named constructor，导致 constructor-owner assertion 把 Core class 与 `undefined` 比较。 | package verifier 必须从 Core dependency context 取得真实 CJS exports，并在正常 build 后 exit 0，同时继续证明 Core re-export identity。 | `pnpm --filter dsh-univer-work package:verify`，`verify-package.mjs:53`，actual `[class ...]` vs expected `undefined`。 | **RESOLVED**：改用 `coreRequire(name)` 读取 CJS exports；独立完整 `package:verify` 重建 1770 modules 后 exit 0，constructor owner、manifest/files/import/path/fallback/worker-child gates 均通过。 |
| WT-CR-QA-005 | High | actual tarball smoke 的首个 installed `workspace_content_inspect` 返回固定 failure；旧 emitted Host 把 worker entry 折叠成 data URL，无法按 package file 启动。 | emitted Host 必须把 package-relative `worker.js` file URL 交给 runtime pool；构建不得保留 data URL 或 TypeScript re-export。 | `pnpm --filter dsh-univer-work package:smoke`，并扫描 actual installed `dist/index.js` 的 worker-entry expression。 | **RESOLVED**：当前 source/emitted Host 已是 `new URL("./worker.js", import.meta.url)`；actual installed debug stack与WS trace均证明 packed `worker.js`/`worker-child.mjs` 已启动。随后 runtime factory failure 由 WT-CR-QA-006 单独跟踪。 |
| WT-CR-QA-006 | High | package-relative worker 启动、session ticket、WebSocket upgrade/HELLO/JOIN 及对应响应全成功后，runtime 立即发送 LEAVE，snapshot request 从未发生，首 inspect 返回真实 `COLLABORATION_LOAD_FAILED`。 | actual packed worker 使用与 CLI package 相同的 runtime build closure，JOIN 后加载 snapshot 并完成 worksheet-range inspection。 | `pnpm --filter dsh-univer-work package:smoke`；secret-free trace 为 Worktree GET、ticket、WS upgrade、HELLO/OUT、JOIN/OUT、LEAVE，随后 failure。 | **RESOLVED**：移除 `moduleSideEffects:false` 并把 esbuild/node24 对齐到已验证 CLI 的 Oxc/node22。修正 fixture revision identity 后，独立 actual tarball 已通过 worksheet-range inspection、no-mutation execute 与 revision 2 confirmed mutation；后续 unknown fixture 问题不再属于 artifact load finding。 |
| REV-CR-07 | High | verifier 原本会剥除 bundler `//#region ../../...` provenance 后再扫描路径，若 region path 含 traversal 可能藏住 checkout path。 | 只允许逐 segment 合法的 `node_modules/.pnpm` 或 Core dist provenance；`.`、`..`、空 segment、反斜线/绝对路径均必须保留给 scanner 拒绝。 | 直接调用等价 `stripGeneratedRegionProvenance`，输入 valid、`../../../../Users`、双斜线、反斜线四种 marker。 | **RESOLVED**：current function 仅剥除 valid case；三种 traversal/absolute variants 全部 retained。完整 package verifier仍待final。 |
| REV-CR-08 | High | verifier 原本接受任意命名匹配 `dist/chunks/[-_A-Za-z0-9]+.js` 的文件，`pnpm pack` 也把它纳入 expected closure；未证明该 chunk 从 Host/worker entry 可达。 | packed dist 只含从 `index.js`、`worker.js` 递归静态/动态 import 可达的 JS chunks，外加精确 colocated `worker-child.mjs`；任何 stale/额外 resource fail closed。 | 检查 `assertDistImportClosure` 对两个 entry 做递归 relative import closure，并与所有 `.js` set equality；运行完整 package verifier。 | **RESOLVED**：closure gate已落，独立 `package:verify` 在 1493-module Oxc rebuild 后 exit 0。 |
| REV-CR-09 | High | actual installed smoke 原本只调用 Worktree inspection；没有 Trunk target 走 packed worker 的直接证据。 | actual tarball ToolRuntime 至少一次 `scope:"trunk"` inspection，authority/revision/Unit type由 Core解析且零 approval/零 mutation。 | 检查 smoke 的 Trunk snapshot/block/fetchmissing routes 与 direct `workspace_content_inspect({scope:"trunk"...})`；运行 actual tarball smoke。 | **RESOLVED**：独立 final smoke 中 Trunk 与 Worktree inspection 均通过 packed worker。 |
| REV-CR-10 | High | 多次 installed smoke 结束后遗留 4 个 `PPID=1` `worker-child.mjs`，其命令路径均属于本轮 `/T/dsh-univer-work-smoke-*` profiles。 | plugin/runtime/Host normal与failure cleanup等待所有 worker child；final smoke 对 pre/post worker process set 做差集断言，零新增 orphan。 | `ps -axo pid,ppid,lstart,command | rg worker-child.mjs`；初始 PID 32415/32473/35965/56109。修复后从空 baseline 运行 final smoke并独立 post-`ps`。 | **RESOLVED**：generated script 使用 `try/finally` dispose；normal gate等待 exact observed worker PID自然退出，failure hygiene只清理 own PID，pre/post全局set相等。独立 final smoke exit 0，结束后 process set仍为空。 |

## 实际执行结果

| 命令/探针 | 结果 |
| --- | --- |
| planning/context review | **PASS**：已完整读取 root/target constraints、README、Workspace CONTEXT、ADR 0007、本 Change 全 artifacts、`extract-content-runtime-client-core` 全 artifacts 与现有 Core/DSH/CLI owner。 |
| pre-edit `openspec status --change add-dsh-content-runtime-tools --json` | planning artifacts `done`；implementation tasks 0/8。依 `tina-verify`，最终 archive readiness 前任何未完成 task 都是 Critical；这是历史 pre-edit checkpoint，不记产品缺陷。 |
| current implementation probe | **BASELINE**：Core 已有 unsignalled content source/execution/runtime/image/commit owner；DSH 尚未注册 content tools、worker entry/runtime generation。与任务计划一致，等待实现 checkpoint。 |
| pre-edit Core / DSH typecheck | **PASS**：`pnpm --filter @univerjs/univer-workspace-client-core typecheck` 与 `pnpm --filter dsh-univer-work typecheck` 均 exit 0。 |
| pre-edit Core focused | **PASS**：`runtime-source`、`content-execution`、`content-runtime`、`embedded-images` 4 files / 62 tests。 |
| pre-edit CLI focused | **PASS**：`content-execution` + `workspace-cli` 2 files / 5 tests；现有 daemon payload/content inspection behavior 通过。 |
| Task 2 Core diff review | **PASS**：optional signal 只追加到 Worktree/Trunk target resolution、content execution 与 runtime read/write/resolvers；execute value budget 只向 direct Core runtime forwarding。target request 观察 signal，target 后取消不进入 runtime，Trunk probe 取消后 request count 为 1。 |
| Task 2 Core focused | **PASS**：Core typecheck exit 0；`runtime-source` + `content-execution` 2 files / 29 tests。含 REV-CR-01 already-aborted zero-resolver 回归。 |
| Task 2 CLI compatibility | **PASS**：`content-execution` + `workspace-cli` 2 files / 5 tests。adapter 即使收到 signal/budget，RPC 仍精确为旧 `{ code, target }`；inspection vertical 保持原 payload/result。 |
| Task 3 Core diff review | **PASS**：same-key queue、credential/license、acquire、state/pull、read/write execute、image upload、replacement、commit 与 close 均 await 后观察 signal；execute value 在任何 remote effect 前 lossless/depth/bytes 校验；ordinary image failure 保留 BASE64，cancelled in-flight upload unknown、confirmed-upload partial、commit unknown dominance、late confirmed race 与三次 unsignalled attempts 符合 AC-03..AC-12。 |
| Task 3 Core focused | **PASS**：Core typecheck exit 0；`runtime-source`、`content-execution`、`content-runtime`、`embedded-images` 4 files / 84 tests。 |
| Task 3 Core full suite | **PASS**：27 files / 508 tests。 |
| Task 4 runtime generation | **PASS**：DSH typecheck exit 0；focused `content-runtime-generation` 1 file / 4 tests；DSH build + full 5 files / 214 tests。lazy reuse、package-relative worker、current credential/origin、env override/default license hash、owned-key replace/delete、active drain、每 generation 一次 close、closed admission、existing Host effect listener/disposal 与 fixed error secrecy 均通过。worker artifact closure 仍归 Task 7。 |
| Task 5 structured inspection checkpoint | **PASS**：三项 QA finding 修复后，独立 DSH typecheck exit 0；最新 `content-tools.test.ts` 1 file / 17 tests；DSH build + full 6 files / 233 tests。scope own-key、dense arrays、七种 union、ordered selector/result identity、beta.2 ICellData top-level primitives、A1/count/bytes/depth/output gates、authoritative Trunk/Worktree、real Native/Code canonical dispatch、caller/owner in-flight read drain 均有直接证据。中途 Code Mode failure 确认为 fixture 缺少 real `run_code.description`，修正后独立复跑通过。 |
| Task 6 execution final source | **PASS**：Core-owned constructor 修复后，独立 identity probe 两类均 `same:true` / Core-origin `instanceof:true`；Core typecheck、focused 51/51 及最新 DSH rebuild + full 6 files / 265 tests 通过。actual packed worker 的真实 `CollaborationRuntimeError` 进一步验证 allowlisted code 与 secrecy，REV-CR-04 已关闭。 |
| Task 7 package graph final | **PASS**：独立 `package:verify` 在 Oxc/node22、1493-module rebuild 后 exit 0；packed manifest/files、Core constructor owner、recursive JS import reachability、region traversal、bare imports、checkout/link protocols、CJS globals、worker/child/binding/fallback、deferred resources与Skill negative closure均通过。 |
| Task 7 installed smoke final | **PASS**：从空 worker baseline 独立完整 `package:smoke` exit 0；actual tarball/unrelated cwd 使用 packed worker/child/binding，覆盖 Worktree+Trunk inspection、no-mutation、credential replacement（两 cookie/新 worker）、revision 2 confirmed+A1 read-back、已dispatch caller-abort unknown exact2/no replay、AgentLoop、Code Mode paired events/approval/canonical/sentinel projection、remount、Host正常退出；exact PID自然退出且post process set为空。 |
| Task 8 docs / compatibility | **PASS**：独立复读 root、Client Core、DSH README 与 license scope，均准确记录两个 content tools、worker/license owner、durable caller-code warning、取消 ceiling 与 exclusions。Core typecheck/full 27 files / 508 tests/build，DSH typecheck/full 6 files / 265 tests/build，CLI focused 3 files / 7 tests、actual CLI package verify/smoke，`package:workspace-cli`、OpenSpec strict、repo typecheck、Workspace production-import migration matrix 与 `git diff --check` 均 exit 0；实现 checkpoint 另提供 CLI 69、Workspace 152、Reference 16、repo test/build 全绿证据。 |
| final OpenSpec status | **PASS**：planning artifacts complete，`tasks.md` 8/8 checked，strict validation exit 0。 |
| Real Workspace setup | **PASS**：以正常 `workspace:dev:server` 启动 `:3020`，未运行 `db:reset`；DSH 从无 workspace dependencies 的 QA cwd 安装本轮 actual tarball，正常 Host 使用 packaged credential/license resolver 与 packed worker/child。auth grant 完成后 `workspace_auth_complete` 只调用一次。 |
| Real Workspace content vertical | **PASS**：唯一前缀 QA user-scoped Draft 与一个 Worktree-local Sheet Unit 创建后，packed worker inspection 读到 A1 空 baseline；approved no-mutation execute 返回 `committed:false`，随后 inspection 仍为 null/空显示；approved mutation 返回 `committed:true`、`status:committed`、revision 2，随后 Worktree get 与 inspection 精确读回 QA sentinel。全程没有 unknown，execute 不重放，也未接触既有 Resource。 |
| Real QA fixture correction | **PASS / QA HARNESS**：首个 prompt 错把 Personal Space 用作 `scope:"space"` Team Worktree target，服务端在 reservation 前 definitive `NOT_FOUND`。只读 OpenAPI/route/server identity 诊断确认 endpoint 与当前源码一致；该 intent 无副作用且未重放。随后用新的 idempotency key 和明确 `scope:"user"` intent 创建 User Worktree。此项是 QA fixture 修正，不是产品 finding。 |
| Remote/local cleanup and process hygiene | **PASS**：discard 前 read-only get/list 精确确认唯一 QA Draft 与唯一 QA Unit；`workspace_worktree_discard` 只调用一次并 confirmed，随后 get 为 `discarded`、processed list 含该唯一前缀。专用 browser 关闭；DSH `:58431` 与 Workspace `:3020` 正常 Ctrl-C 后均无监听；本轮 `worker-child.mjs` process set 由 1 恢复为 0；QA-only profile/tarball/cwd temp root移入系统废纸篓，未修改 retained credential/settings 或其他进程/数据。 |

## QA 结论

**PASS。** 44 条 AC 全部通过，当前 **0 open product issues**。source、actual package、real ToolRuntime、
Agent/Code、CLI/repository/production-import gates与真实 Workspace `:3020` actual-worker vertical均完成；唯一
QA Draft已进入 `discarded` terminal state，本轮 browser、Host、Server、worker与local profile均按边界清理。
