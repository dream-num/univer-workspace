# add-dsh-content-runtime-tools review

状态：PASS（0 open findings）

审查范围只包含 OpenSpec change `add-dsh-content-runtime-tools` 及其直接触及的 Client Core、
DSH composition、worker/package 与 CLI compatibility 边界。本报告不修改产品代码、测试或 tasks。

## 固定依据

- `openspec/changes/add-dsh-content-runtime-tools/{proposal.md,design.md,tasks.md}` 与两份 delta spec
- `openspec/changes/extract-content-runtime-client-core/**` 已交付的唯一 runtime owner 合同
- 根/target `AGENTS.md`、README、`apps/workspace/CONTEXT.md` 与 ADR 0007
- DeepSeek Harness `0.1.1-rc.2`、Univer SDK `1.0.0-beta.2` 冻结 public contracts

shared worktree 没有可单独使用的 feature commit fixed point；审查以 change artifacts 为 Spec 固定点，
按 dirty paths 持续复核实现 diff。Standards 轴同时应用仓库规则、Fowler smell baseline 与 Ponytail full。

## Review checklist

| 轴 | 必须取得的直接证据 | 状态 |
| --- | --- | --- |
| Core target/execution signal | optional signal 只扩展可达 seam；每个 HTTP/runtime step 前后检查；取消后无新 step；CLI wire 不变 | PASS（Task 2） |
| Runtime quiescence | queued/acquire/state/pull/read/write/replace/commit 的 frozen worker work 全部 await；close/drain 无 detached operation | PASS（Core Task 3） |
| Write outcome dominance | upload unknown、confirmed-upload partial side effect、commit unknown dominance、confirmed race；不 replay code/image | PASS（Core Task 3） |
| Execute budgets | pre-approval 512 KiB args/256 KiB code；Core 8,388,000-byte/64-depth value gate 在任何 remote side effect 前 | PASS（Task 6 source） |
| Inspection contract | 七种 published query/result；closed recursive application validation；A1 grammar/safe arithmetic/cell/count/byte/depth limits | PASS（Task 5） |
| Approval/trust boundary | execute shared policy/body validator、fixed one ask；inspection no ask；rejected calls零 credential/worker/HTTP | PASS（Task 6 source） |
| Credential generation | one lazy generation；exact record event retirement；active close awaited；new cookie only；license/worker entry package-relative | PASS（Task 4 source） |
| Errors/secrecy | frozen code/detail allowlist；no message parsing；code/credential/license/raw selector/value sentinels不复制到 plugin-owned content | PASS |
| DSH lifecycle | one existing owner；caller/owner classification；total finalizers；dispose unregister/abort/generation close/body drain | PASS |
| Installed closure | emitted Host/worker、worker-child、exact formula native binding、fallback=false、unrelated-cwd real worker smoke、no checkout fallback | PASS（Task 7） |
| Compatibility/scope | CLI execute/inspect/daemon/package无 signal/budget wire变化；Server/OpenAPI/database/SDK/release unchanged | PASS（Task 8 gates） |
| Standards/Ponytail | public exports/named exports；无第二 owner/parser/runtime service/daemon/job/cache/config knob；最小复用现有 seams | PASS（Tasks 2–8） |

## Findings

Findings 记录 severity、位置、Spec/standard 依据、复现证据、最小修复与复验状态。

### REV-CR-01 — medium — pre-aborted execution 仍进入 target resolver

- 位置：`packages/client-core/src/content-execution.ts:49-59`；对应测试
  `packages/client-core/test/content-execution.test.ts:76-99`。
- 依据：Core delta spec `Execution is cancelled before runtime work` 与 design Decision 4 要求每个
  separable step 前后检查 signal；Task 2.1 明确要求 pre-abort evidence。
- 复现：`executeForTarget()` 在第一次 `throwIfAborted()` 前已经调用结构化
  `resolveEditableRuntimeTarget()`。用一个计数 resolver 和 already-aborted signal 调用 feature，resolver 仍会执行；
  现有测试只覆盖 resolver 返回时触发取消，不能捕获这个入口回归。真实 `WorkspaceContentSource` 会在其 HTTP
  helper 内补挡，但 `WorkspaceContentExecutionFeature` 的 public structural port 本身没有履行 pre-step contract。
- 最小修复：在构造 target input / 调用 resolver 前加一次 `input.signal?.throwIfAborted()`，增加 already-aborted
  case 断 resolver 与 runtime 均为零调用；保留现有 post-resolver check，勿新增 wrapper/helper。
- 修复复验：feature 现于 resolver 前后各检查一次 signal；新增 already-aborted case 直接断 target resolver 与
  runtime 零调用。独立 Core full gate 为 27 files / 491 tests PASS；CLI focused/import closure 为 14 files /
  69 tests PASS，RPC payload exact assertion确认 signal/value budgets 未跨 daemon wire；diff check PASS。
- 状态：CLOSED。

### REV-CR-02 — medium — optional own `undefined` 被当成 canonical JSON 字段

- 位置：`apps/dsh-univer-work/src/content-tools.ts` 的 `exactResult()` / `hasExactKeys()`，以及
  Slide/Paragraph 等 optional result field validators。
- 依据：DSH delta spec 的 `Canonical output is malformed` 要求 non-JSON value 在 render/programmatic return 前拒绝；
  complete canonical value 必须 lossless。相同的 exact own-key runtime seam 也负责 Trunk 的 cross-field closure。
- 复现：带 own `textPreview: undefined` 的 valid-shaped Slide result、带 own `bullet: undefined` 的 Paragraph
  result均通过 optional `!== undefined` 分支，随后 `JSON.stringify` 静默丢字段；input 的 own
  `worktree_id: undefined` 同样会被 Trunk 当成字段不存在。
- 最小修复：共享 exact-own-key seam 对“存在但 value 为 `undefined`”失败，optional absent 仍允许；读取 own data
  descriptor 以免 validator 执行 accessor。增加一个 input 与一个 result direct fixture；sparse array 另按 dense-array
  gate 处理，无需增加新 validator abstraction。
- 修复复验：`hasExactKeys()` 现在只接受 enumerable own data property 且拒绝 own `undefined`；同一 seam 同时
  封住 Trunk optional cross-field 与所有 nested optional output。direct fixtures 覆盖 Trunk own-undefined、Slide
  optional own-undefined；array shape gate另验证 dense own indices。独立 DSH typecheck 与 6 files / 227 tests PASS。
- 状态：CLOSED。

### REV-CR-03 — medium — `ICellData` 字段只验证为任意 JSON

- 位置：`apps/dsh-univer-work/src/content-tools.ts` 的 `validateWorksheetRange()` cell validator。
- 依据：design Decision 1 要求 application validator 检查 nested field primitives 与每个 `ICellData` leaf；
  delta `Canonical output is malformed` 要求 wrong primitive 在 render/programmatic return 前拒绝。
- 复现：当前 exact top-level allowlist 之后对所有 field 统一调用 `validateJson()`；因此 `{ v: { nested: true } }`、
  `{ f: 42 }`、`{ t: "wrong" }` 都会作为合法 range result 通过，虽然 beta.2 `ICellData` 分别要求 scalar
  cell value、nullable string 与 `CellValueType`。
- 最小修复：在现有 cell loop 中按 frozen fields 验证 primitive/container：`v` 为 nullable scalar，`t` 为
  nullable beta.2 enum，formula/ref fields 为 nullable string，`p/s/custom` 为其允许的 nullable object/string
  shape；继续复用 `validateJson()` 检查嵌套 lossless JSON。增加 table-driven wrong-primitive fixture，无需 schema
  library 或新 abstraction。
- 修复复验：现有 cell loop 已按 beta.2 frozen field types 收窄，并在字段级检查后继续做 nested JSON 验证；
  table fixture 直接拒绝 invalid `v/f/t/p`，同时保留合法 cell。独立 DSH typecheck 与 6 files / 230 tests PASS。
- 状态：CLOSED。

### REV-CR-04 — high — 真实 collaboration runtime/pool errors 无法进入已声明 allowlist

- 位置：`apps/dsh-univer-work/src/content-tools.ts` 的 `executeOwned()` / `stableContentCodes`；Task 6 error
  fixtures。
- 依据：design Decision 6 与 DSH delta `Content failure fidelity and secrecy` 明确列出并要求保留 frozen
  `COLLABORATION_*`、`COLLABORATION_POOL_*` 与 worker codes；Task 1 冻结 published constructor identity。
- 复现：当前 ordinary allowlist 分支只接受 `WorkspaceApplicationError`。真实 Core pool acquire/state/pull/execute/
  replace/commit 会原样抛 public `CollaborationRuntimeError` 或 `UniverCollaborationRuntimePoolError`，二者都不是
  `WorkspaceApplicationError`；因此真实 code 即使在 `stableContentCodes` 中仍降级为
  `workspace-content-operation-failed`。现有 tests 用 `WorkspaceApplicationError` 伪造这些 code，无法捕获该路径。
- 最小修复：从 exact beta.2 public exports 导入两个 error constructors；只对正确 `instanceof` 且 code 在 frozen
  allowlist 的实例返回 fixed safe failure，不信任 duck-typed `code`，不复制 message/cause（两类没有 safe detail）。
  各增加一个真实 constructor fixture并放 secret message/cause；无需 adapter abstraction 或新依赖版本。
- 首轮修复复验：产品代码直接从两个 frozen public package 导入 constructor；ordinary failure 只在真实
  `CollaborationRuntimeError` / `UniverCollaborationRuntimePoolError` identity 与 allowlist 同时成立时保留 code，
  且不投影 detail。两个 ToolRuntime fixtures 以 DSH application dependency graph 的 constructor 抛出 secret
  message/cause，断 frozen code 原样保留且四个 sentinel 均未进入结果。独立 DSH typecheck、focused 51/51、
  full build + 6 files / 265 tests与 scoped diff check全部 PASS。
- package composition 复现：DSH application 与 private Core 对这两个 package 的 pnpm physical resolution 不同。
  `univer-collaboration-runtime` 分别落在 React 18 与 React 19 peer context；runtime-pool 也分别落在不同
  peer-context hash。emitted runtime-pool chunk因此含两份 `UniverCollaborationRuntimePoolError` graph，且每个
  locale emitted 两份 byte-identical chunks。真实 Core pool/runtime 从 Core copy 抛错，DSH direct import 的
  `instanceof` 仍使用 application copy；首轮 fixture只让 fake runtime 抛 application copy，不能证明真实路径。
- 更新后的最小修复：让 DSH 从 private Core root re-export 消费 Core-owned frozen constructors并移除 application
  的两个直接 runtime devDependencies，或用等价的可靠 build dedupe 保证单一 constructor identity；增加一个
  real Core-origin constructor fixture，继续禁止 code duck typing。复验还须证明 emitted graph不再出现第二份
  constructor/byte-identical runtime assets。
- 最终修复复验：Client Core root原样 re-export其 graph 使用的两个 public constructors；DSH source/tests只从
  Core消费，并删除两个 direct devDependencies与对应 lock importer。DSH目录不再有第二份 runtime/pool link；
  Core唯一 resolution为 React 19 peer context。重建产物的 runtime-pool 从约 23.5 MB 收敛到约 12.1 MB，
  `UniverCollaborationRuntimePoolError` 只出现一次，抽查 `en-gb`、`hu`、`de-1901` 均只剩一个 chunk。
  独立 Core/DSH typecheck、focused 51/51与 diff check PASS；package verify也通过。real installed worker behavior继续按
  Task 7验收，不再阻塞 constructor identity finding。
- 状态：CLOSED。

### REV-CR-05 — medium — package verify 未冻结 default worker URL 的 file-relative 形态

- 位置：`apps/dsh-univer-work/src/content-runtime-generation.ts` default worker entry 与
  `apps/dsh-univer-work/scripts/verify-package.mjs` emitted bundle checks。
- 依据：Task 7.1 与 delta `The installed package is self-contained` 要求 package verification确认每个 worker
  reference在 tarball内解析；design 要求 Host 以 package-relative `worker.js` 启动，禁止 adjacent/source fallback。
- 复现：初版静态 `new URL('./worker.js', import.meta.url)` 被 Vite asset transform内联为 JavaScript data URL，其中
  只剩 TypeScript re-export；`package:verify` 仍通过，直到 installed real-worker smoke 才失败。source改成常量后当前
  index已正确保留 `./worker.js`，但 verify仍没有要求该 token / `new URL(..., import.meta.url)`，也不拒绝
  `data:text/javascript`、`data:application/javascript` 或 worker `.ts` source，因此同类 bundler回归仍会静态漏检。
- 最小修复：在现有 index/emitted assertions中要求 default `./worker.js` package-relative construction，拒绝 JS/TS
  data URL、`.ts` worker source与 bare Core worker fallback；继续保留 installed smoke，无需 AST parser或新 helper。
- 修复复验：verifier要求唯一 `./worker.js` token与 `new URL(..., import.meta.url)`，拒绝 JavaScript data URL；
  worker/source/bare-import closure继续由 exact files、bare import与 path scanners固定。独立 `package:verify` PASS，
  actual tarball从 unrelated cwd成功启动该 emitted worker并完成两类 target、execution与正常 close。
- 状态：CLOSED。

### REV-CR-06 — high — 全局 `moduleSideEffects: false` 破坏安装态 worker runtime factory

- 位置：`apps/dsh-univer-work/vite.config.ts` 的 `rollupOptions.treeshake`；actual tarball real-worker smoke。
- 依据：Task 7.1 要求复用 CLI build treatment并从 installed worker完成真实 inspection/execute；仓库不得重写
  上游 SDK 的 registration ownership。Ponytail full要求删除未经需要证明的全局优化。
- 复现：actual package从 unrelated cwd成功加载 Host、`worker.js`、colocated child与 WebSocket，完成 target GET、
  session ticket、HELLO和JOIN，随后在 snapshot HTTP前以 `COLLABORATION_LOAD_FAILED` 退出并发送 LEAVE。fixture与已通过
  的 CLI package smoke相同；两份 Vite配置的关键差异是 DSH额外设置全局
  `treeshake: { moduleSideEffects: false }`。该设置忽略 package metadata并允许 Rollup删除 Univer/Pro plugin
  registration side effects，符合“worker启动但 factory load失败”的边界。
- 最小修复：删除 DSH全局 treeshake override，沿用 Rollup defaults/SDK package metadata与 CLI proven config；不得
  维护手工 side-effect allowlist或新 bundler abstraction。重跑 actual tarball inspect/no-mutation/confirmed/unknown。
- 修复复验：全局 override 已直接删除。独立 actual tarball smoke从此前 HELLO/JOIN后、snapshot前
  `COLLABORATION_LOAD_FAILED`，推进到 worker snapshot、block 与 fetchmissing请求，证明 runtime factory registration
  已恢复；随后失败为 fixture authoritative revision 0 与 snapshot latest revision 1 的既有 mismatch，属于下一层
  fixture数据，不再是 worker factory/bundle failure。没有新增 side-effect allowlist或 bundler seam。
- 状态：CLOSED。

### REV-CR-07 — medium — generated region 过滤放宽了 checkout path 扫描

- 位置：`apps/dsh-univer-work/scripts/verify-package.mjs` 的 `pathScannableContent` 预处理。
- 依据：Task 7.1 与 package delta 要求 artifact 不含 adjacent checkout、绝对源码路径或 fallback；Rolldown
  generated provenance 可以按其明确语法排除，但排除规则不得吞掉相同位置的真实 source path。
- 复现：当前正则 `^//#region ../../[^\\r\\n]*` 删除任意两级上跳的 region 行，因此
  `//#region ../../Users/private/source.ts`、`//#region ../../workspace/source.ts` 也不会进入后续保持不变的
  `../`/absolute scanner。它比本次 Rolldown 实际生成的 `../../node_modules/.pnpm/...` 范围更宽。
- 最小修复：只删除 Rolldown 当前明确的 pnpm generated region provenance，例如限定为
  `^//#region ../../node_modules/.pnpm/...`；保留其余 scanner。用 generated line 与 checkout/source counterexample
  各做一次 verifier evidence，不引入新 parser。
- 修复复验：预处理现在只接受 `node_modules/.pnpm` 或已内联 Core `dist` 前缀，逐 segment拒绝 empty、`.`、
  `..` 与非 safe字符；pnpm patch-hash所需 `=`被明确允许。relative traversal branch只排除以第三个点开头的
  ellipsis，真实 `../` / `..\\`、file/link protocol及 absolute path仍进入原 scanner。独立重建时先捕获并修正
  patch-hash与 `...\\` 两个真实 Rolldown false positive，第三次 `package:verify` PASS。
- 状态：CLOSED。

### REV-CR-08 — medium — dist closure 以自身文件列表作为 expected value

- 位置：`apps/dsh-univer-work/scripts/verify-package.mjs:10-18,31-33,103`。
- 依据：design Decision 8 要求 verification 拒绝 missing/extra worker resources；package delta 禁止 future
  Office/render/generation resource，并要求检查 emitted entries、chunks、dependencies 与 files。
- 复现：`expectedFiles` 直接展开当前 `findFiles(dist)`，因此 dist 内任意新增文件都会同时成为 expected 与 packed
  actual；内容循环又只扫描 JS/JSON/Markdown/YAML。bundler 若多产 `dist/chunks/future.wasm`、`.node`、`.css`
  或其他 resource，closure equality 仍成立且该文件不进入后续检查。
- 最小修复：冻结 dist 允许形态为 exact `index.js`、`worker.js`、`chunks/worker-child.mjs` 与 hashed `.js`
  chunks，明确拒绝其他扩展/子目录；不必冻结动态 chunk hash或增加 manifest abstraction。
- 修复复验：verifier在动态 pack file comparison前先冻结 exact entries/child 与单层 `.js` chunk shape；任意其他
  dist扩展或子目录会先失败，现有 JS scanner继续检查每个允许 chunk。独立 `package:verify` PASS。
- 状态：CLOSED。

### REV-CR-09 — medium — installed worker smoke 未执行 Trunk inspection

- 位置：`apps/dsh-univer-work/scripts/smoke-package.mjs` 的 content fixture 与 installed content calls。
- 依据：delta `Installed inspection and execution run` 明确要求 Trunk/Worktree inspection；design Decision 8
  同样要求 isolated tarball 通过 emitted worker 运行 real Trunk/Worktree inspection。
- 复现：当前所有 installed `workspace_content_inspect` 都传 `scope: "worktree"`；fake service 也只实现
  `/universer-api/worktrees/...` snapshot/fetchmissing/block。source Trunk ToolRuntime test不能证明 installed Host、worker、
  child与 native closure在 Trunk target path成立。
- 最小修复：在现有 fixture复用同一 snapshot增加 Trunk snapshot/fetchmissing/block endpoints，并以 direct installed
  ToolRuntime做一次 Trunk A1 inspection，断 canonical value与真实 worker request；无需第二 server/runtime。
- 修复复验：同一 keyless fixture增加 Trunk snapshot/fetchmissing/block branches；direct installed ToolRuntime先后对
  Worktree与Trunk A1 inspection取得相同 canonical `runtime-smoke`，实际请求进入无 Worktree前缀的 Trunk路径。
  独立 actual tarball `package:smoke` PASS。
- 状态：CLOSED。

### REV-CR-10 — high — installed smoke 遗弃真实 runtime child process

- 位置：installed `fiber.dispose()` / content generation close / collaboration runtime-pool child shutdown链；
  `apps/dsh-univer-work/scripts/smoke-package.mjs` 的 disposal evidence。
- 依据：Task 7.1 与 delta `Installed inspection and execution run` 要求 credential replacement与正常 disposal
  settle；design Decision 7禁止 detached operation并要求 generation/runtime close被 await。
- 复现：多轮 actual tarball smoke parent退出后，系统仍有四个
  `dist/chunks/worker-child.mjs` 进程（PID 32415、32473、35965、56109），PPID均为1并持续5–9分钟；每个
  cwd/profile均指向不同的 `dsh-univer-work-smoke-*` / `dsh-univer-work-run-*` 临时目录，包含最近一次宣称
  green的 direct smoke。现有 script结束与 Host shutdown没有证明真实 runtime child被 close。
- 最小修复：先定位并修正 existing owner → generation → public runtime/pool close 的调用/await顺序；installed smoke
  记录真实 worker child PID并在正常 dispose后等待其退出，失败路径也回收其已启动 descendants。不得用 detached
  reaper或只在 wrapper强杀来替代产品 close。清理已知孤儿后重跑并断无新增 orphan。
- 根因与修复复验：孤儿来自此前 assertion失败的 generated child script未进入 product disposal，并非成功 close
  链返回后仍存活。installed child现以 top-level `try/finally` await已挂载 Cordis contexts；outer先依据真实 worker
  request header取得 exact PIDs并要求它们在正常 plugin disposal后自然退出，失败才回收本 fixture PIDs且保留原 gate
  failure，最终 process set必须恢复到并行运行前 baseline。独立 `package:smoke` PASS；运行前后均无本轮
  `smoke-package.mjs`、`installed-smoke.mjs` 或 `worker-child.mjs` process。
- 状态：CLOSED。

### REV-CR-11 — medium — 仓库权威文档仍否认已交付 content runtime

- 位置：`AGENTS.md:17-20,36-38`、`README.md:154-160,242-245`、`DREAMNUM.md:20-24`。
- 依据：Task 8.1要求更新 DSH/Core README与根 runtime-license wording；根文档纪律要求 repository responsibility、
  application scope与 DREAMNUM已记录事实在同一 change同步。
- 复现：三份 repository-level current contract仍只列旧 auth/Space/Worktree/file/core Skill，并明确
  `dsh-univer-work` 不提供 content authoring/runtime；实际已交付两个 worker-backed inspect/execute tools。根 license
  段仍称 synchronized development credential只存在于 Browser/CLI，`UNIVER_LICENSE`只覆盖 CLI，漏掉 DSH Host。
- 最小修复：只同步两工具、worker-backed bounded content scope和 package worker/license ownership；license段写清
  Browser/CLI/DSH copy与 `VITE_UNIVER_LICENSE` / `UNIVER_LICENSE` consumer。继续排除 Web Client、Office/render等
  later capability，不整理无关文档。
- 修复复验：根 AGENTS、README与 DREAMNUM现在一致列出四类既有工具、两个 worker-backed bounded content
  tools和 core Skill；三者继续明确排除 API discovery、Office、render与 Web Client。根 license段覆盖
  Browser/CLI/DSH Host，区分 Vite与 Node override并保留各 application copy ownership。DSH README直接记录 durable
  code arguments、secret警告、cancellation ceiling、partial/unknown no-replay与 installed matrix；Core README只记录
  Shell-neutral ownership。`git diff --check` PASS。
- 状态：CLOSED。

## Checkpoints

### Task 4 Host runtime generation

- `WorkspaceContentRuntimeGenerations` 只维护一个 lazy current generation 和一个 promise tail。exact
  `credentials/record-updated` listener 对 owned key 同步摘除 current；后续 accepted run 必须等 active body、旧 runtime
  close 与整个 replacement tail 收敛后才创建下一代。重复 event、并发 `retire()` 与 disposal 不会对同一 generation
  调用第二次 close。
- credential resolver 在每次 worker init 前后检查 signal、重新读取并 strict parse 当前 grant，且验证 authoritative
  target origin；listener 自身不读取、缓存或打印新 record。active old-cookie work 只会 drain，replacement 不会跨 retire
  tail 启动。license 只来自 non-empty process override 或同步 application copy，worker entry 为 package-relative URL。
- 现有 Cordis test 直接覆盖 exact-key filtering、active-body barrier、grant replace/delete、新 cookie、single close、origin/signal/
  license failure 和三份 license hash equality。实现没有增加 Config、service、lock、timer 或第二 owner。
- 独立门禁：DSH typecheck PASS；5 files / 214 tests PASS；build PASS；scoped diff check PASS。
- 状态：PASS，0 open。Worker/native dependency 的安装态自包含性按 Task 7 单独复审。

### Task 5 inspection source validator

- 参数按 frozen 顺序完成 root/query exact keys、scope、dense array/count、complete canonical bytes、selector/A1
  grammar 和 safe cell arithmetic；malformed A1 与 unsafe/safe-over-limit 分类分离，failure 不复制 raw selector。
- 七个 result union 全部验证 discriminant、requested Unit、ordered selector identity、nested exact keys、beta.2
  `ICellData` fields、lossless JSON、complete bytes；Slide children 以 application recursion 接受 64、拒绝 65，DSH
  schema只诚实投影 children 为 JSON。
- real ToolRuntime Native fixture 已证明 Worktree 与 Trunk authoritative target/canonical value；Trunk 只走 exact
  snapshot path。Code Mode 取得同一 canonical value并直接断 start/settled identity pairing。oversize 在 HTTP/runtime
  前失败；caller/owner abort-oblivious read均先 settle，owner disposal 再等 generation 单次 close。
- 独立门禁：DSH typecheck PASS；6 files / 233 tests PASS；scoped diff check PASS。Task 5 findings 0 open，状态 PASS。

### Task 6 execution source boundary

- `workspace_content_execute` 的 closed schema、pre-execute policy 与 accepted body 复用同一 pure validator；complete
  arguments 524,288 bytes、code 262,144 bytes 均在 ask 前检查。invalid、oversize、rejected、cancelled、unavailable
  与 no-channel fixtures直接证明零 approval request、credential/HTTP、generation 和 runtime execution；成功路径只有固定
  one-shot ask，文本不含 code、ID、credential、license 或 caller value。
- authoritative Worktree target 只在 approval 后解析，Core execution 固定 8,388,000-byte/64-depth pre-side-effect
  value budget，tool 再验证 closed committed/no-mutation envelope与 complete 8 MiB canonical result。caller/owner pre-write、
  partial upload、upload/commit unknown、late confirmed `ABORTED` 与 owner-only confirmed success覆盖 outcome precedence、
  no replay guidance、accepted-body drain和 generation single close。
- error adapter 只接受 published constructor identity与 frozen code allowlist。partial/result-unknown 在 cancellation mapping 前
  保留；普通 caller/owner cancellation各自归类；safe projector不复制 message、cause、origin、code/credential/license 或
  unlisted detail。Native real AgentLoop 和 Code Mode分别证明 rc.2-owned argument retention、canonical value、dispatch
  identity pairing与 plugin-owned transcript non-reflection。
- 模块虽集中承载 closed schemas、application validators、allowlist和两个 tool bodies，但继续复用既有
  `closeWorkspaceTool`、`WorkspaceToolOwner`、generation manager与 Client Core workflows；没有增加第二 owner、parser、
  runtime service、daemon、job、cache、lock或配置开关。按 Ponytail full 不为缩短文件引入额外抽象或依赖。
- 独立门禁：DSH typecheck PASS；focused 51/51 PASS；full build + 6 files / 265 tests PASS；scoped diff check PASS。
  Task 6 source behavior matrix无其他 finding；Task 7 composition 暴露的 REV-CR-04 constructor duplication
  已通过 Core-owned re-export与单一 emitted graph关闭。

### Task 7 installed worker/package closure

- multi-entry build保持 CLI proven Node CommonJS-global treatment、Node 22 target与 Oxc minify；删除全局
  `moduleSideEffects:false` 后 SDK registration side effects保留。Host只以 package-relative `worker.js`启动，
  runtime-pool chunk旁只有 resolved published `worker-child.mjs`；exact formula owner manifest决定 external native
  binding dependency，local fallback固定为 false。Core-owned constructor graph在 emitted runtime中只有一份。
- verifier冻结 entries/chunks/resource extensions、manifest/peer/native版本、colocated child、CJS globals、bare imports、
  reachable tools、worker URL/data URL、constructor count与 future capability exclusions。generated region只按无 traversal
  的 exact Rolldown provenance剥离，其余 file/link/relative/absolute source scanner保持；独立
  `package:verify` PASS。
- isolated actual tarball在 fresh profile与无 `node_modules` 的 unrelated cwd运行 real ToolRuntime。Worktree和Trunk
  inspection、no-mutation、confirmed/read-back、caller-aborted unknown commit均通过；两次 submission证明 unknown不
  replay。exact credential event让旧 generation drain/close，后续 worker只使用 replacement cookie且至少两个真实
  PID；normal disposal后所有本轮 child自然退出。
- installed AgentLoop与 Code Mode都实际 dispatch inspection和execute；code sentinel只保留在 DSH-owned
  `tool/call.arguments` 或 code start/settled arguments，plugin result、approval、lifecycle与 stripped transcript不复制。
  Code start/settled name/subCallId匹配，execute canonical no-mutation value与one-shot approval直接断言；normal remount
  恢复 exact 2 content tools。
- 独立 `package:smoke` PASS，结束后无本轮 Host、installed child或 runtime child process；Task 7 findings
  REV-CR-04..10全部关闭，状态 PASS，0 open。

### Task 8 documentation/scope checkpoint

- DSH README准确列出两个当前 content tools、generation/worker/license ownership、closed budgets、durable DSH-owned
  code arguments、secret warning、cancellation ceiling、partial/result-unknown与 no-replay guidance；installed matrix与
  实际 smoke一致。Core README只声明 Shell-neutral signal/budget/runtime semantics与 Client Shell注入责任。
- 根 AGENTS、README、DREAMNUM当前工具数量和 boundary一致；仍排除 API discovery、Office exchange、render与 Web
  Client。root runtime-license段覆盖 Browser/CLI/DSH Host并区分 Vite/Node overrides。没有把后续 Change写成当前事实。
- REV-CR-11关闭，docs/scope findings 0 open。Core typecheck/508 tests/build、DSH typecheck/265 tests/build/verify/
  smoke、CLI typecheck/69 tests/workspace package/verify/installed smoke均PASS；仓库 `typecheck`、`test`、`build`、
  OpenSpec strict与 diff check PASS。review另独立复跑三 application typecheck、repo typecheck、OpenSpec strict/status、
  package verify/smoke与 diff check，结果全绿。
- formula native binding版本从 frozen formula owner manifest读取，和既有 exchange native binding同为 independently
  versioned package；SDK baseline脚本只增加这个 exact package到现有 allowlist并以 preservation test固定，没有放宽其他
  `@univer*` cohort。Server/Browser/OpenAPI/database/deployment/release source均未改，CLI daemon wire仍为原 `{code,target}`。
- 独立 QA 44/44 AC PASS。真实 Workspace `:3020` 使用 actual tarball、packed worker/child与保留的 credential/license
  完成空基线 inspection、approved no-mutation execute及不变 read-back、approved confirmed mutation与 revision 2 / A1
  精确 read-back；全程无 unknown、replay或既有 Resource访问。唯一 QA Draft已单次 confirmed discard并进入
  `discarded`，browser、Host、Server、worker、端口、profile、tarball和临时目录均按边界清理。
- OpenSpec tasks 8/8完成；strict validation、status `isComplete:true`与最终 diff check均PASS。

## Final result

PASS。Standards、Spec 与 Ponytail 三轴均为 0 open findings；REV-CR-01..11全部关闭并独立复验。
