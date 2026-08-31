# add-dsh-api-resource-discovery-tools QA

本报告是 OpenSpec Change `add-dsh-api-resource-discovery-tools` 的独立验收记录。QA 只更新本文件，
不修改产品代码、测试、OpenSpec tasks，不 commit、push 或 archive。

## 环境与边界

- 冻结基线：Workspace commit `a01adf28bfdfbf098ecf66653d520d08ecac4117`、SDK
  `1.0.0-beta.2`、DSH `0.1.1-rc.2` / `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`。
- Discovery 属于 `apps/dsh-univer-work` Client Shell，不进入 private Client Core，不导入 CLI application/Commander。
  这里的 visual SVG resource 不是 Workspace Product `Resource`、Node 或 Unit。
- 四个 query tools 必须在无 Workspace credential/origin/connection 下只读 installed immutable datasets；export
  也不得读取 Workspace credential，只能访问 installed manifest 已声明的 HTTPS resource。
- 真实 installed QA 使用 actual tarball、unrelated cwd、无 Workspace grant 的隔离 profile、真实 ToolRuntime/Agent/
  Code Mode。只导出到唯一 QA Session cwd，结束只清理本轮文件/profile/process，不触碰用户数据。
- credential、URL query secret、header、raw manifest/SVG、Host 外部路径、temporary filename、cause/stack 和 raw
  Session transcript 不写入报告。

## 编号验收标准

### Surface、datasets 与 closed values

- **AC-01** Native catalog 与 Code SDK 恰好新增 `workspace_api_find`、`workspace_api_show`、
  `workspace_resource_registries`、`workspace_resource_find`、`workspace_resource_export`；五个 root schemas closed，
  不接受 action/origin/credential/URL/header/inline SVG/command/remote filesystem/Workspace identity/unbounded JSON。
- **AC-02** API find/show 与 resource registries/find 在无 grant 下只读 immutable installed datasets；零 credential、
  approval、Workspace HTTP、network、local output、cache mutation、timer 或 background side effect。
- **AC-03** eligible export 在无 grant 下只允许 installed manifest 对应的 requested HTTPS resources；不解析 Workspace
  origin、不读 Login Session/credential、不联系 Workspace Server。
- **AC-04** API find 返回 closed `{ terms }` 及每 term 的 total/bounded structured matches；show 返回 closed
  `{ results }`，完整保留 applicable class/member/type/type-member found unions，不含 dataset/package/CLI prose internals。
- **AC-05** resource registries 返回 closed `{ registries }`，find 返回 `{ resources,total }`，只保留 stable handle、
  registry/name/group/tags/keywords/order/intrinsic size/color-editability；无 source URL/raw manifest/cache/SVG。
- **AC-06** syntactically valid missing API symbol 返回 closed not-found union 与 bounded suggestions，不伪装为 auth/
  transport failure。
- **AC-07** 五个 body 的 undeclared own key 在 dataset/approval/path/network/output 前 fixed invalid failure，且 failure
  不复制被拒 key/value。
- **AC-08** missing/extra/wrong-kind/non-JSON/malformed capability output 在 render、Native result、Code settlement 前拒绝；
  Native/Code 接收同一个 validated canonical JSON，render 只派生自该 value。
- **AC-09** activation 只通过 installed public exports 创建 `createStandardApiReference()` 和 fail-closed validated
  query-only `ResourceLibrary`/opaque manifest；缺失或 malformed dataset 在任何 discovery tool 注册前以
  `workspace-discovery-dataset-invalid` 失败，无 private manifest read、CLI/checkout fallback、credential/network/cache。

### Arguments、results 与 response-body budgets

- **AC-10** complete canonical arguments ≤ 65,536 UTF-8 bytes；API terms/symbols 与 resource queries 各 1..8、
  non-blank、每项 ≤160 chars；registry filters 0..8；API find limit 1..30/default 10 per term；resource find limit
  1..100/default 30 total；export handles 1..32 unique，invalid enum/duplicate/blank/overlong/out-of-range 全部 early fail。
- **AC-11** 合法 query/result 在预算内完整返回，不截断 match/signature/type appendix/suggestion/resource metadata/export status。
- **AC-12** API find/show complete canonical result ≤1,048,576 bytes；其余 discovery result ≤262,144 bytes；overflow
  返回 `workspace-discovery-result-too-large`，detail 只有 actual/max bytes 与 narrowing guidance，无 truncated success。
- **AC-13** 每个 export call 的累计 response-body budget 固定 33,554,432 bytes，单 resource 保留 public downloader
  10 MiB cap；每个 consumed response chunk 在 forwarding 前扣费，后续 UTF-8/SVG/publication/abort failure 不退费。
- **AC-14** 单 resource 超过 10 MiB、累计仍有余量时当前 handle 不发布但 later handle 可继续，且只继承真实余量。
- **AC-15** 下一 response `Content-Length` 大于累计余量时不消费 body、当前失败、budget terminal，later handle 零 request。
- **AC-16** stream 恰好用尽累计余量时当前 valid handle 可发布，但在 later handle 前 terminal，later 零 request。
- **AC-17** stream chunk 超过累计余量时当前不发布、terminal、later 零 request；partial result 仅保留已 confirmed files
  与 allowlisted failure codes。
- **AC-18** abort/invalid UTF-8/SVG/size/transport/publication 等已消费 bytes 同样扣减；若未 terminal，next handle
  精确继承余量，绝不重置 32 MiB。

### Export policy、path 与 atomic publication

- **AC-19** export pre-execute 首先读取 calling Session current file-effect policy；`read-only` 在 provider/path/
  arguments/ask/processPath/network/output/body 前以 `workspace-file-policy-denied` 零 effect 拒绝。
- **AC-20** policy 允许后必须以 exact public `LocalFileSystem` constructor 或 in-process subclass 正向证明 Host-local；
  E2B/remote/undefined-mode non-local 在 model path/contains/ask/processPath/network/output 前以
  `workspace-local-filesystem-required` 零 effect 拒绝。
- **AC-21** eligible immutable handles/output directory 只在 calling Session cwd 且（workspace-write 时）current
  `workspaceRoot` 双重 canonical containment 内获得一次 fixed ask；danger/bare LocalFS 仍受 Session-cwd fence。
  pre-execute 不读取 private manifest/handle existence/filename，不调用 `processPath()`，不 inspect/create directory。
- **AC-22** accepted body 从 immutable args 重做 exact args、current policy、public local identity、cwd/root containment
  与 directory/symlink identity；变化导致 ask 后 fail，零 second ask、network/processPath/output，且不保留 preflight state。
- **AC-23** body recheck 后才可 `processPath()` 并调用 public resource export；library-provided filename 必须是单一
  basename，absolute/separator/traversal/escape 全部在 temp/replace 前拒绝，不 rewrite filename、不私读 manifest。
- **AC-24** deny/cancel/unavailable/no-channel 在 body 前 fail closed，零 download/directory/temp/replace。
- **AC-25** complete export 返回 `{complete:true,exported,failed:[]}`，每 requested handle 恰有一个 confined
  `{handle,path}`；settlement 后无 cache/cached SVG/private temp/open handle。
- **AC-26** partial export 返回 `complete:false`，保留所有 confirmed `{handle,path}`，失败仅 `{handle,code}` allowlist；
  不 replay、不暴露 message/URL。
- **AC-27** download/SVG/write/fsync/replace failure 在 confirm 前保持 prior target byte-for-byte、删除私有 temp；later
  work 只按 settled sequential/cancel rules。
- **AC-28** existing target 只由 complete validated SVG replace；publisher 使用 same-directory unpredictable `0600`
  temp，完整 write、sync、cancel-check 后 atomic replace，不声称复用 Blob/Asset Core publisher。
- **AC-29** shared query library 只持 immutable validated data；每个 accepted export 在 body 内创建独立 ResourceLibrary、
  no-retention cache、downloader、signal/budget/directory/output/partial result，无 mutable current-call 或 AsyncLocalStorage。

### Concurrency、errors、cancellation 与 lifecycle

- **AC-30** 两个 overlap exports 的 bytes/files/failures/signal/directory/temp/result 完全隔离；一个取消不改变另一个
  allowance/target/progress，confirmed files 保持 caller-owned。
- **AC-31** public `ResourceLibraryErrorCode` 与 frozen file/discovery codes 只投影 safe handle/count/confined path/byte
  detail；unknown dependency/network/fs/output 统一 fixed generic failure，无 source/redirect URL/header/body/temp/cause。
- **AC-32** cookie/token/password/signed URL/credential sentinel/raw manifest/SVG/Host outside-cwd path 出现在任意 failure
  material 时，Native/Code/render/approval/installed transcript 均零反射。
- **AC-33** already-aborted caller 经 real ToolRuntime 返回 `ABORTED_BEFORE_DISPATCH`，零 dataset/approval/path/network/output。
- **AC-34** read-only query 在 synchronous lookup 前/中取消后不开始 projection/render，并返回 canonical aborted outcome，
  不以 late success 覆盖。
- **AC-35** export 在 confirmed files 后 caller abort：观察取消后不开始 later handle download/publication，保留 confirmed
  outputs；DSH 可返回 `ABORTED`，fixed guidance 要求 inspect approved directory 后才人工 retry。
- **AC-36** owner dispose 停止 admission，注销五 tools 与唯一 export policy，abort accepted bodies，await in-flight
  request/fs primitive/file finalizer/body；零 request/file/temp/listener/timer/cache/current-call/ALS/accepted promise 残留。
- **AC-37** dispose 中多个 isolated exports 各自收敛，owner 不查询/清理 shared adapter；每个 call closure 在 settle 后
  unreachable，已 confirmed outputs 保持 caller-owned。

### Installed closure、real vertical 与 compatibility

- **AC-38** source/package graph exact pin `@univer-cli/api-reference@1.0.0-beta.2`、
  `@univer-cli/resource-library@1.0.0-beta.2`、`@univerjs-pro/cli-assets@0.1.0`；只用 published exports。
- **AC-39** actual tarball 自含 reference dataset、opaque resource manifest、discovery implementation；无 CLI source/
  artifact/Commander、bare private Core、adjacent checkout/absolute build path、Skill/raw index prompt、Web/runtime/future surface。
- **AC-40** isolated installed profile 从 unrelated cwd、无 Workspace credential 通过 real ToolRuntime 运行四个 keyless
  queries，输出 bounded closed values，零 Workspace/network/file/cache effect。
- **AC-41** installed controlled HTTPS export 覆盖 eligible local path、一次 approval、complete SVG、partial failure、cumulative
  charging/cancel、atomic output/temp cleanup；只访问 fixture manifest 的 HTTPS origin，不依赖 monorepo fallback。
- **AC-42** real installed Agent scheduler 能发现/调用四 query 与 approved export；Code Mode paired start/settled 的
  args/value/error/approval 与 Native canonical schema 一致，secret sentinels 不跨 transcript 分区。
- **AC-43** normal/failure disposal 后 tool/policy registry恢复 baseline，QA-only requests/files/temps/profile 清理，相关
  process set 与 ports 恢复 pre-run baseline；不清理非 QA state。
- **AC-44** DSH/root responsibility docs 准确记录五 tools、keyless/no-cache/local-export owner 与 exclusions；不修改 Skill、
  Workspace Server/Browser/OpenAPI/database/deployment、Client Core、CLI commands/Skills/release 或 SDK baseline。
- **AC-45** focused DSH typecheck/test/build/package verify/smoke、repository SDK-baseline/typecheck/test/build、CLI actual
  package smoke、OpenSpec strict 与 `git diff --check` 全部 exit 0；retry-only green 不关闭 issue。

验收项总数：**45**。

## 测试矩阵

| 规格组 | 必要直接证据 |
| --- | --- |
| Activation/datasets | exact public exports、valid/missing/malformed manifest/reference、activation-before-registration、零 credential/network/cache |
| Closed query tools | 五 schemas、unknown/accessor/own-undefined keys、API found/not-found unions、resource metadata/exclusions、malformed output before render |
| Budgets | 64 KiB args、fan-out/default/max、1 MiB/256 KiB outputs、10 MiB resource、32 MiB cumulative Content-Length/chunk exact/over/failed-byte charging |
| Export preflight | read-only first、exact LocalFS/subclass、non-local zero-path、cwd/workspaceRoot/danger/bare、one ask、no private filename lookup |
| Body recheck | policy/provider/root/symlink drift、immutable args、no second ask、processPath/network/output only after recheck |
| Publisher | safe basename、0600 same-dir temp、write+sync+cancel+atomic replace、prior-file preservation、partial values、zero cache/temp/FD |
| Concurrency/lifecycle | two overlapping calls、one abort isolation、confirmed-file guidance、owner dispose unregister/abort/drain、no ALS/current-call/detached work |
| Errors/secrecy | exact code/detail allowlist、unknown generic、URL/header/credential/raw-manifest/SVG/temp/outside-path sentinels across Native/Code/render/approval |
| Installed artifact | actual pack manifest/import/resource closure、exact versions、no CLI/Core/Skill/checkout fallback、unrelated cwd/no grant |
| Real runtime | ToolRuntime four keyless queries、controlled HTTPS export、Agent scheduler、Code Mode paired events、approval、cleanup/process baseline |
| Compatibility | DSH/root docs、no out-of-scope diffs、SDK/repo/CLI package/OpenSpec/diffcheck gates |

## Issues

发现问题立即发送 `/root/space_node_implement`；修复后复跑原 repro、相邻 security/race case 与最小回归 gate。

| ID | Severity | Evidence | Expected | Repro | Status |
| --- | --- | --- | --- | --- | --- |
| REV-ARD-01 | High | installed resource manifest 原在 module 顶层 `require()`；loader/exports failure 发生于 `createWorkspaceDiscoveryDatasets()` sanitizer 之外，可携带 package path/secret，并使 activation 未得到统一 dataset failure。 | manifest loader 必须在 sanitized fail-closed boundary 内；任何 loader throw 固定 `workspace-discovery-dataset-invalid`，不反射 secret/path，且零 tool/Skill/policy registration。 | 注入 public manifest loader 抛出含 secret/path 的 Error，调用 dataset creation 与 Host activation，检查 code/content/register spies。 | **RESOLVED**：loader 移入 guarded initializer；独立 focused 8/8 + typecheck，direct/Host loader sentinel 固定 code、零 path/secret，source order证明 failure 位于所有 tool/Skill/policy registration 前。 |
| WT-ARD-QA-001 | High | Task 2 argument byte check 原对尚未验证的 nested array 执行 `JSON.stringify()`，会调用 accessor/`toJSON`；`denseArray()` 又使用 result-side failure，导致 malformed API terms 以 `workspace-discovery-result-invalid` 而非 argument-invalid 失败。独立 probe 的 accessor 被调用 11 次。 | nested arrays 必须 dense/value-only、零 accessor/`toJSON` invocation；完整参数预算应对新构造 canonical args计费。malformed terms/symbols 固定 `workspace-discovery-argument-invalid`，API dataset call 为 0。 | direct registered `workspace_api_find.execute({terms: accessorArray})`；记录 getter count、error code 与 API find spy。相邻复测 sparse/extra-symbol/own-`toJSON` 及 API show。 | **RESOLVED**：先验证/复制 dense value descriptors，再对 fresh canonical args 计费；独立 direct probe由 getterCalls=11/result-invalid修为 getterCalls=0、datasetCalls=0、argument-invalid，focused 35/35 与 typecheck通过。 |
| WT-ARD-QA-002 | High | Task 3 resource result validator 把 public `order: number \| null` 收窄为 non-negative integer，独立 injection 的 `order:-0.5` 被 `workspace-discovery-result-invalid` 拒绝；相反，mismatched `handle:"other/wrong"` + `registryId:"icons"` + `id:"arrow"` 与 `intrinsicSize.width:0` 被完整接受。installed public manifest parser接受任意 finite order、要求 positive intrinsic size，并定义 stable handle 为 `<registryId>/<resourceId>`。 | canonical projection 必须保留 public finite order，不增加未声明限制；malformed identity/size 必须在 render 前拒绝，handle 必须与 registry/id 一致且尺寸为正。 | direct registered `workspace_resource_find` 注入 fractional/negative order、mismatched handle/registry/id、empty identity 和 zero size；记录 canonical value或 fixed result-invalid。相邻覆盖 null-prototype/value descriptor/accessor shape。 | **RESOLVED**：独立原 repro 现保留 `order:-0.5`，mismatched handle 与 zero size 固定 result-invalid；safe component/nonblank/positive validators、exact public error-code membership、fake secret code、null-prototype/data descriptor/accessor矩阵通过。focused 65/65、typecheck、diffcheck与 DSH build/full 7 files / 330 tests均通过。 |
| WT-ARD-QA-003 | High | Task 4 首个 async export body 复用 read helper，但 helper 在 inner `try` 中 `return` Promise 而未 `await`；post-await path/policy/caller failure 会绕过 inner sanitizer，并被 outer catch降为 generic discovery failure。相邻修复一度对所有 read-only query 无条件投影 internal FileTransfer error。 | accepted export body rejection必须在 owner/caller post-settlement check内收敛，保留 frozen file/cancel codes；API/resource query 的同类或伪造 file code仍须 generic discovery failure。 | approval 后让第二次 directory resolve barrier等待，期间 caller abort；另让 API find dependency抛 captured internal FileTransfer error与 forged Harness file code，检查 fixed code/secrecy。 | **RESOLVED**：helper 现 `await body` 后复查 owner/caller，file projector只在 `resource export` 分支启用；独立 focused 88/88 + typecheck/diffcheck通过，barrier abort为 `workspace-operation-cancelled`，两种 query file-code injection均 generic且零 secret。 |
| WT-ARD-QA-004 | High | Task 5 cumulative fetch wrapper 对 response body 立即 `getReader()`，但只预检 32 MiB cumulative Content-Length；当声明长度为 10 MiB+1 且仍小于32 MiB时，public downloader自己的 per-resource header check在读取前拒绝，且不取消 wrapper body。独立 probe 得到 `resource-download-too-large`, upstream `cancelled=0`, remaining `33554432`, terminal `false`，reader/abort listener/call closure留存。 | per-resource Content-Length failure应零 body consumption、取消并释放 upstream reader/listener、保持 cumulative nonterminal与完整remaining，使 later handle可继续；settlement后不留 stream/call closure。 | `createCumulativeResourceFetch` + public `HttpsResourceDownloader(maxBytes=10MiB)`，fixture Response body带 cancel spy与 `Content-Length:10485761`；检查 code、cancel count、budget与后续请求。 | **RESOLVED**：wrapper现先判 cumulative terminal overflow，再判 public 10 MiB declared overflow；原 probe变为 `cancelled=1`, remaining `33554432`, terminal `false`。real ToolRuntime两handle row确认首handle failure后第二次request并confirmed file；独立 focused 92/92 + typecheck及 chunk-over/exact-zero/declared-over direct预算探针通过。 |
| REV-ARD-10 | High | Task 5 result validator 原只检查 dependency `exported[].handle/path` 的 closed shape与requested handle，接受 dependency伪造的 outside/secret path，即使该 path从未由 call-owned output adapter在 rename 后确认。 | exported result只能来自本 call output adapter成功 atomic rename后的 `{handle,path}` ledger；伪造/错配/duplicate path必须在 projection/render前固定失败且不反射 path sentinel。 | 注入 export library绕过或调用 output后返回 forged outside path；比较 result、Session/Code transcript、approved directory与post-rename ledger。 | **RESOLVED**：每个call现以active handle连接output adapter，并仅在 atomic rename完成后写入confirmed map；final validator要求 exported handle/path与ledger exact equality、failure不得已有confirmation、ledger/result cardinality一致。独立focused的forged/mismatch/contradictory failure三行均固定 result-invalid且零outside/secret reflection；focused 113/113与full 7 files / 378 tests通过。 |
| WT-ARD-QA-005 | Medium | Task 7 pre-check 的 `pnpm --filter dsh-univer-work package:verify` exit 1：absolute/link scanner 把 bundled public API reference dataset 中合法文档示例 `file://a.xlsx` 判为 local checkout path，报 `local checkout path found in dist/index.js`。 | verifier应允许 installed immutable dataset 内合法 API文档值，同时继续拒绝 manifest targets、imports、region provenance及非dataset emitted code中的绝对checkout/file/link路径；不得为通过而全局删弱 path/link 防护。 | build后直接运行 `node scripts/verify-package.mjs`；检查首个 assertion、`dist/index.js` 的matched dataset value，并用 synthetic forbidden absolute/link sentinels回归scanner。 | **RESOLVED**：scanner仅去除无path的document file authority，`file:///tmp`、`file:/Users`、relative `file:`/`link:`、`/home`等negative sentinels仍必须match；独立 `package:verify`重跑exit 0并完成actual pack closure。 |

## 实际执行结果

| 命令/探针 | 结果 |
| --- | --- |
| planning/context review | **PASS**：已读取 root/target AGENTS/README、Workspace CONTEXT、ADR 0007、本 Change proposal/design/spec/tasks、前序 file-transfer local policy/public LocalFS boundary 与 installed packages 的 public exports/types。 |
| `openspec status` / `instructions apply` | planning artifacts complete；implementation tasks **0/7**。按 `tina-verify`，这是 pre-edit baseline；最终任何 unchecked task 都是 Critical。 |
| current implementation probe | **BASELINE**：DSH 尚无五个 discovery tools，source manifest 尚未声明三项 exact discovery ownership；package verifier仍把 `workspace_api_` 视为 deferred。与 tasks 0/7 一致，不记产品 defect。 |
| installed public API inspection | **PASS**：API reference public export拥有 find/show found/not-found unions；resource library public export拥有 create/query/export、HTTPS downloader、10 MiB `maxBytes` option、opaque manifest loader 与 stable error codes；cli-assets public subpath解析 exact `0.1.0` manifest。 |
| pre-edit DSH gates | **PASS**：`pnpm --filter dsh-univer-work typecheck` exit 0；build + full suite 6 files / 265 tests。 |
| Task 1 installed datasets | **PASS**：REV-ARD-01 修复后独立 focused 1 file / 8 tests + DSH typecheck exit 0。source manifest exact pin API/resource `1.0.0-beta.2` 与 cli-assets `0.1.0`；只从 public exports 构造 API reference 与 opaque-manifest query library。valid find/list、missing/undefined/malformed/factory/loader sentinel 均 fail closed；activation 在任何 tool/Skill/policy registration 前失败；fetch 0 calls、cache location empty/no-retention，source 无 credential/Workspace HTTP/timer side effect。 |
| Task 2 API tools checkpoint | **PASS**：独立 focused `discovery-tools.test.ts` 35/35 + DSH typecheck exit 0，并补跑 real ToolRuntime pre-abort probe得到 `ABORTED_BEFORE_DISPATCH`、零 abort-reason secret。确认两个 closed schemas、defaults/maxima/duplicates/invalid unit、WT-ARD-QA-001 value-only arrays、find term/order/limit与show query/order identity、全部四种 found union及not-found、1 MiB complete overflow、malformed/unknown dependency secrecy、post-lookup/pre-projection abort、Native value与Code Mode两组paired start/settled canonical values。 |
| Task 3 resource query checkpoint | **PASS**：WT-ARD-QA-002 修复后独立 focused 65/65、DSH typecheck、`git diff --check` 与 DSH build/full 7 files / 330 tests exit 0。四个 keyless query schemas/installed values、resource defaults/filter/maxima、public finite order、stable handle identity/safe IDs/nonblank metadata/positive size、null-prototype value JSON/accessor zero-effect、unknown-registry exact code/fake secret code generic、256 KiB complete overflow、post-lookup/pre-projection cancellation与 Native/Code canonical paired events均通过。 |
| Task 4 local export effect gate | **PASS（仅 AC-19–24 gate）**：独立 focused 88/88 + DSH typecheck + diffcheck exit 0。验证 policy→exact public LocalFS/subclass→closed handles/directory→Session cwd/`workspaceRoot`→single ask；read-only与non-local在 args/path/approval/export 前零 effect；bare/workspace-write/danger仍受 cwd/root；syntactically valid missing handle仍先 ask；rejected/cancelled/unavailable/no-channel均不把 destination传给 resource library/network/output；allowed body重验 policy/provider/symlink并仅在重验后显式转换 destination；post-await caller abort与 file-code projector通过。public `LocalFileSystem.contains()` 为 containment 内部调用 `processPath()`，因此证据采用 approval decision 前后的 call-count delta：preflight仅发生 public containment seam所需转换，dependency从未收到 destination；body explicit destination conversion只在 allow与重验后新增。Task 5 的 call-owned downloader/publisher仍未计 PASS。 |
| Task 5 bounded atomic exporter | **PASS（Task 6 lifecycle除外）**：WT-ARD-QA-004与REV-ARD-10关闭后，独立 focused 113/113、DSH typecheck/diffcheck及 build/full 7 files / 378 tests exit 0。证据覆盖 call-owned public library/no-retention cache；10 MiB declared/stream nonterminal与32 MiB declared/chunk/exact terminal；transport/SVG/publication/abort已消费byte carryover及 later-zero-request；safe basename、A→B directory drift、0600 unpredictable same-dir temp、write/sync/rename fault close+cleanup、prior target保持；post-rename confirmed ledger；overlap call budget/signal/destination隔离与 cancelled call零输出。owner dispose/finalizer/transcript完整矩阵留给Task 6。 |
| Task 6 errors/cancellation/owner lifecycle | **PASS**：独立 focused `discovery-tools.test.ts` 126/126、DSH typecheck/build/full 7 files / 391 tests与 `git diff --check` exit 0。real ToolRuntime already-aborted为零工作；caller在confirmed output后cancel及late rename settlement后均保留confirmed file、不启动later handle，并给fixed inspect/never-blind-retry guidance。owner dispose停止admission、反向注销五tools及export policy、abort并等待ignored-fetch、in-flight fsync与两个并发accepted exports各自收敛；正常finalizer关闭FD/清temp，confirmed output仍归caller，registry恢复baseline。dispose后同名fake export可重新注册并执行，证明旧pre-execute listener已移除且无第二次ask/body。Native/Code成功与failure paired events保持canonical value/error/approval分区；真实ResourceLibrary frozen/unlisted code及fetch/HTTP/open failure只投影allowlist/fixed generic，URL/header/body/SVG/path/cause sentinel零反射。 |
| Task 7 installed artifact/real vertical | **PASS**：从空 worker/process baseline 独立运行 `package:verify` 与 actual `package:smoke`，均exit 0。artifact closure只含manifest/README/license/patch/core Skill、reachable built JS/worker，exact discovery versions、无source/test/scripts、CLI/Core bare import、checkout/absolute path或discovery Skill guidance；WT-ARD-QA-005的document authority例外仍保留absolute/relative file/link negative sentinels。smoke重新pack并从unrelated cwd安装到隔离`DSH_HOME`，没有Workspace credential/grant：四query零credential/fetch/approval并返回bounded closed values；export只把installed manifest的HTTPS pathname转发到test-owned loopback TLS server，child仅信任static test CA，未访问公网且server确认无authorization/cookie。Native覆盖partial、private `0600` output与caller-cancel confirmed/no-later；real Agent Loop与Code Mode各调用五tools，paired events/canonical values/approval/secrecy通过；combined transfer+discovery dispose、五tool remount通过。run前后相关PID/port/temp-root集合为空。独立CLI package verify/smoke（203 files）通过；final shared-tree checkpoint另确认SDK-dependency 4/4、root typecheck/test（Core508/Workspace152/CLI69/DSH391）/build、CLI package、diffcheck与OpenSpec strict均通过。责任文档准确列出五tools、keyless/no-cache/local export与exclusions，core Skill维持negative closure。 |
| final OpenSpec closure | **PASS**：Task 7.1在QA 45/45结论后勾选；`openspec instructions apply`为7/7、remaining 0、`all_done`，strict validate与最终`git diff --check`均exit 0。 |

## QA 结论

**PASS。45/45 AC 通过，0 open issues。** Source、actual package、unrelated-cwd/no-credential real runtime、controlled
HTTPS、Native/Agent/Code、compatibility与cleanup gates均已验收。OpenSpec 7/7 tasks已完成，strict validate/diffcheck为绿；
本 Change 已满足归档前验证条件（本QA不执行commit、push或archive）。
