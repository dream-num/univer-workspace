# extract-content-runtime-client-core QA

本文件记录 Change `extract-content-runtime-client-core` 的实现后验收。QA 对比 baseline tree `b80fd9dd31bfd46d65acafcfc511bb1681ab8bdf`、初始 implementation tree `fc2994e7e2ed484b922c4c353e91f99e07cb632e`、第一轮 review-fix tree `681c23552a38997a2e67f0f570ad89d72f98e116` 与第二轮 review-fix tree `fb940ff1b4a88db6e767929b5b7c052b66595b9f`，最终结论为 **60/60 pass，0 open issue；Ready to archive**。

## 基线与边界

- QA 在实施前记录 baseline tree，实施后记录 implementation tree；验收依据限定产品 diff、Core direct behavior、CLI compatibility、installed artifact与完整 gate，不用tasks勾选代替行为证据。
- Change 5 最终QA为48/48 pass、0 open issue；fix后tree为`8ffc9d4df36cea8acd3a1a932275e947eb62bbbb`。Change 6必须复用Client Core现有`WorkspaceHttp`、authenticated HTTP、`workspaceError`、`WorkspaceApplicationError`、`parseWorkspaceRuntimeTarget`、`serializeWorkspaceRuntimeTarget`、`workspaceRuntimeKey`、`WorkspaceSnapshotServerAdapter`、`loadWorkspaceReferenceHostContext`与`createWorkspaceReferencedUnitProviderRegistration`，缺失时停止，不能建立平行owner。
- Client Core将拥有Shell-neutral worker implementation、runtime pool lifecycle、synchronize、read/export、Facade write execution、embedded image externalization和commit state machine。CLI Client Shell继续拥有Config/Session文件、credential persistence、license来源、packaged worker entry选择、daemon socket/control、process signals、Commander和输出。
- Worker init可在本机parent-child IPC中携带credential与license，但daemon RPC、structured result、coded error、stdout/stderr和日志不得暴露这些secret。Core不得读取CLI Session/config、`process.env`或CLI license module。
- embedded image使用Collaboration Worktree File API，保持best-effort语义；不得依赖或复用Change 4 Blob/Asset reserve/sign/download/local-file workflow，不得建立通用file-transfer abstraction。
- Office exchange、Typst、SVG、browser render、screenshot/lint、Workspace Server、OpenAPI/Collaboration contract、Worktree lifecycle、target/reference语义、Session schema、daemon protocol和CLI command/output不在本Change中改变。
- 不为迁移引入service container、plugin framework、runtime registry、多实现factory hierarchy、credential-store interface、commit-attempt配置、eviction/cancellation/telemetry或大compatibility layer。

## Spec scenario → 测试与命令

| OpenSpec scenario | 基线位置 | 实现后必须存在的直接证据 | 执行命令 |
| --- | --- | --- | --- |
| Runtime starts for a selected target | CLI `runtime/{daemon,worker}.ts` | Core worker/pool fixture验证explicit worker entry、credential/license init、Change 5 target/key/Snapshot/reference reuse、exact Unit load与same-key worker reuse | Core runtime tests |
| Runtime dependency is unavailable | worker Session/license composition | credential absent与license absent/invalid分别在content前返回既有code；worker/acquire/content 0调用；error/result/log不含secret | Core runtime tests |
| Runtime owner closes | daemon `onShutdown` | deferred pool close证明`close()`在worker resources关闭前不settle；CLI daemon shutdown同样await Core owner | Core + CLI daemon tests |
| Read execution succeeds | daemon `runtime.execute-read` | Trunk/Worktree同步后只调用一次`execute({mode:"read"})`，lossless value原样返回，replace/commit 0，lease release | Core runtime tests |
| UnitData export succeeds | daemon `runtime.export-unit-data` | exact UnitData object/identity/revision路径原样返回，execute/replace/commit 0，lease release | Core runtime tests |
| Runtime cannot be synchronized safely | daemon `synchronize()` | pending mutation、awaiting changeset、conflict state、pull conflict、base revision mismatch逐项固定code/order/call count，content 0 | Core runtime tests |
| Execution captures no mutations | daemon write handler | prepare/execute一次，返回exact`{committed:false,value}`，image upload/replace/commit 0，lease release | Core execution/runtime tests |
| Execution targets Trunk | daemon scope guard | Trunk在acquire/write execute前返回既有target-not-editable；non-Draft在editable resolver/port前拒绝 | Core execution/runtime tests |
| Prepared binding is invalid | CLI content execution | reserved binding和required Unit type失败发生在runtime operation前，保持既有code/message与resolver顺序 | Core execution + CLI adapter tests |
| Duplicate embedded bytes are captured | CLI `embedded-images.test.ts` | direct/serialized三种reference shape、四种raster、digest dedup、一次upload、多处UUID rewrite、input immutable | Core embedded-image tests |
| Embedded image cannot be externalized | embedded image parser/uploader | invalid base64/signature、SVG、>20MiB、invalid FileId与upload failure均0 rewrite或byte-for-byte fallback，commit继续 | Core embedded-image/runtime tests |
| Changeset is confirmed | daemon `commitStableChangeset()` | externalize→replace一次→commit confirmed；返回confirmed base revision/status/value，release不invalidate | Core runtime tests |
| Commit asks for a bounded retry | commit loop | retry/unknown及mixed序列最多三次，同一pending changeset；execute/image upload/replace各一次 | Core runtime tests |
| Commit cannot be accepted | commit loop | conflict、pull-required、discard、三次exhaustion分别保持stable error/detail并invalidate；不release | Core runtime tests |
| Existing CLI runtime surface is exercised | program/content/exchange/screenshot tests | 三RPC wire、target resolution、prepared code、inspect/execute/export consumers、JSON/text/coded errors与Session timing兼容 | CLI targeted/full tests |
| Daemon shuts down | daemon control/signals | command shutdown与SIGINT/SIGTERM路径均委派并等待Core owner close，再结束server；socket/identity不变 | CLI daemon tests |
| Installed CLI starts worker-backed operations | package smoke | 临时cwd/home安装tarball，以authenticated Session启动daemon/worker并执行runtime-backed inspect；worker public subpath/bundle无workspace bare import或checkout path | package verify/smoke |

测试文件可按最终owner命名调整；QA用`rg --files`解析真实文件。Core必须拥有算法级tests，CLI只保留Shell composition、wire、presentation与artifact责任。

## 验收标准

### 前置、owner与scope

- **AC-01** apply前证明上述Change 5根exports真实存在且Core typecheck通过；实现直接复用。任一前置缺失必须停止，不能复制target、Snapshot、reference、auth、HTTP或error owner。
- **AC-02** content runtime能力只加入既有private `@univerjs/univer-workspace-client-core`；根入口提供runtime owner/execution/operation named exports，worker implementation通过明确public subpath交付。不新增package、独立版本或公开npm合同。
- **AC-03** Core runtime owner、worker、execution与image sources不得导入`apps/cli`、CLI Config/Session/license/daemon identity、Commander/presenter、CLI private `src`/`dist`或相邻checkout；Core operation types不得依赖`@univer-cli/daemon`的`DaemonClient`/`JsonValue`。
- **AC-04** Change 5的target/Snapshot/reference/auth/error owners保持唯一；Change 6不得建立第二parser、serializer、runtime key、Snapshot adapter、credential abstraction或Worktree model。Core只新增本Change所需SDK精确依赖。
- **AC-05** before/after限定diff不修改Workspace Server、OpenAPI/generated、Browser reference-provider、Session byte schema、config/license value、Worktree/Unit model、Blob/Asset/local transfer、Office/Typst/SVG/render/screenshot/lint业务body或SDK baseline。
- **AC-06** Core只公开一个可关闭content runtime owner和一个最小structural runtime-operation port；不得出现service container、plugin framework、generic provider/transport、runtime registry、多实现factory hierarchy、eviction/cancellation/telemetry或compatibility façade。

### Shell-neutral worker init与Collaboration composition

- **AC-07** owner construction显式接收packaged worker entry、credential resolver和license resolver；不猜测consumer artifact相对路径，不读取filesystem/env。worker init是private exact serializable shape，target使用Change 5 canonical serializer/parser。
- **AC-08** credential/license只在新worker必须创建时解析；同一revision-independent key跨revision复用worker时resolver不重复调用。不同origin/scope/Worktree/Unit/type key分别创建独立worker/init。
- **AC-09** credential缺失返回既有`workspace-authentication-required`及message，发生在worker content返回前；error、detail、cause、RPC result与captured output不含cookie或resolver secret，worker/content调用为0。
- **AC-10** license缺失或resolver拒绝时返回既有license failure，不加载Unit或返回content；error、detail、cause和output不含license bytes。不得在Core内回退CLI bundled license或新增license persistence。
- **AC-11** Core worker implementation/public subpath不导入CLI Session/config/license、`process.env`、daemon socket/identity或worker artifact目录；CLI thin worker/build entry只指向该public subpath，不复制worker composition。
- **AC-12** worker严格解析private init，复用`parseWorkspaceRuntimeTarget`、host-context loader、Snapshot adapter与referenced-Unit provider；malformed target/init在HTTP、headless factory与Collaboration load前拒绝，secret不进入validation detail。
- **AC-13** Trunk worker composition固定`/universer-api/comb`、`/universer-api/comb/connect`、`/universer-api/snapshot`与origin-level`/universer-api/user/session-ticket`；HTTP/WS scheme、method和URL由现有SDK contract保持。
- **AC-14** Worktree worker composition固定encoded`/universer-api/worktrees/:worktree/comb`、`.../comb/connect`、`.../snapshot`；session-ticket仍为origin-level路径。特殊字符Worktree ID只encode一次。
- **AC-15** worker Collaboration HTTP全部通过Change 5 authenticated `WorkspaceHttp.collaborationRequest()`，保留`worker` role/PID、Cookie same-origin和absolute URL credential保护；Cookie/license不出现在URL、request log snapshot或error。
- **AC-16** Sheet/Doc/Slide/Base/Board mapping保持现有`UniverInstanceType`，factory加载exact target Unit/type；host-context与reference registration顺序、SnapshotService resolver缺失错误不变。
- **AC-17** pool acquire使用Change 5 `workspaceRuntimeKey()`且key忽略revision；same identity跨revision复用同一worker，其他identity不串租约。init/RPC/log中的credential/license不得进入key。
- **AC-18** owner `close()`调用pool close且等待其settle后才resolve；deferred fixture验证worker close未完成时owner close仍pending。CLI daemon shutdown只调用同一owner close，不额外管理Core worker pool。

### Synchronize、read与UnitData export

- **AC-19** 每个操作acquire后先读state；`pendingMutationCount !== 0`、`awaitingChangeset !== null`、`conflict !== null`三类各自返回既有`WORKSPACE_RUNTIME_DIRTY`，pull/execute/export/replace/commit均0。
- **AC-20** clean state只pull一次；pull返回conflict时保留`WORKSPACE_RUNTIME_CONFLICT`与upstream message，execute/export为0，不尝试第二次pull或重建worker。
- **AC-21** pull后`baseRevision`必须与selected target revision严格数值相等；ahead/behind均返回既有`workspace-result-mismatch`及exact revisions，execute/export为0，不容忍latest或自动重绑target。
- **AC-22** `executeRead`对Trunk与Worktree只调用一次`lease.execute({code,mode:"read"})`；`null`、boolean、number、string、nested array/object等lossless execution value逐字返回，不包裹/JSON round-trip造成丢失。
- **AC-23** read路径不capture/replace/submit mutations：`replacePendingMutations`与`commit`调用为0；成功、dirty、pull conflict、revision mismatch和execute throw均恰好release lease且不invalidate。
- **AC-24** `exportUnitData`只在同步成功后调用一次export；返回runtime提供的exact UnitData object，不删改resources/styles/sheets或伪造identity，execute/replace/commit为0并release。
- **AC-25** read/export的acquire/credential/worker-init failure发生在lease形成前时不调用release/invalidate；形成lease后的所有read/export failure仍release。错误code/message与CLI现状一致。

### Facade write execution与no-mutation路径

- **AC-26** Core content execution workflow先用Change 5 editable target resolver解析requested Worktree/Unit，再执行required type guard，再调用既有`prepareContentExecutionProgram()`；生成的Sheet/Doc/Slide/Base/Board binding code逐字兼容。
- **AC-27** reserved binding保持`CONTENT_EXECUTION_RESERVED_BINDING`；`executeSlide`遇非Slide保持`WORKSPACE_CONTENT_UNIT_TYPE_UNSUPPORTED`。两者均在runtime operation/daemon RPC前失败，resolver与prepare顺序不变。
- **AC-28** non-Draft由editable resolver在runtime port前拒绝；直接`executeAndCommit`收到Trunk target时在acquire/write execute前返回既有`WORKSPACE_TARGET_NOT_EDITABLE`与message，不把Trunk回落Worktree。
- **AC-29** write同步成功后只调用一次`execute({code,mode:"write"})`。若`mutations.length === 0`，返回exact`{committed:false,value}`，image upload/replace/commit均0并release，不invalidate。
- **AC-30** write execute throw、malformed execution result或mutation replacement failure不产生success result；已acquire lease必须invalidate且不release。Facade code不得自动重放。
- **AC-31** structural operation返回的write result仍严格解析：missing/nonboolean`committed`、missing`value`、committed true时invalid revision/status保持`WORKSPACE_RUNTIME_RESULT_INVALID`；valid false/true保留现有result shape和lossless value。

### Embedded image externalization与File API边界

- **AC-32** `embedded-images`与`image-references`权威实现迁到Client Core并从根按最小需要导出；删除CLI协议body/复制实现。Core不得导入Change 4 Blob/Asset/file modules或`resolveWorkspaceAssetContent`、local filesystem helper。
- **AC-33** visitor/rewrite覆盖nested direct `source/imageSourceType`、`fillImageSource/fillImageSourceType`和`source/sourceType`三对字段，只处理type exact为`BASE64`且source nonempty；不误写UUID/URL/其他字段。
- **AC-34** `resources[].data`中的serialized JSON递归访问和rewrite保持；resource自身direct字段也处理。invalid JSON、non-array resources和无匹配数据逐字保留，不抛错。
- **AC-35** PNG、JPEG、GIF87a/GIF89a与WebP分别要求media type和magic signature匹配；valid bytes上传的`mediaType`、digest filename extension与byte sequence exact。声明类型与signature不一致不得upload/rewrite。
- **AC-36** data URI parser只接受canonical base64与既有四种media type；empty、wrong padding、invalid alphabet、whitespace/trailing garbage、URL-encoded data和`image/svg+xml`（大小写/额外metadata变体）均不上传并逐字保留。
- **AC-37** byte limit保持20 MiB：签名有效且总bytes恰好20 MiB可处理，20 MiB+1为0 upload/rewrite；测试不能只用短字符串模拟size。
- **AC-38** 同一digest在同次mutation batch内跨mutation、direct和serialized references只upload一次；每个匹配source全部改为同一returned FileId/`UUID`。不同digest分别上传一次，顺序稳定。
- **AC-39** externalization不修改input mutation array、mutation object、parsed nested object或原`data` string；只有成功rewrite的mutation产生新object/string。无成功upload时返回原array identity并保持每个byte/code unit。
- **AC-40** File API固定POST encoded`/universer-api/worktrees/:id/stream/file/upload?assign=:unit&size=:bytes&source=3`，multipart field `file`、SHA-256 filename、media type与bytes exact；使用target-origin authenticated HTTP，不调用Blob reserve/Asset sign/local transfer。
- **AC-41** uploader throw、network/protocol failure、missing/empty`FileId`均按单图best-effort处理：该图原reference byte-for-byte保留，其他成功图仍rewrite，commit pipeline继续。caught error/structured output不暴露Cookie、license、image bytes或完整data URI。

### Mutation replacement与三次commit状态机

- **AC-42** 有mutations时先完成一次externalization，再恰好一次`replacePendingMutations`，然后才commit；replace接收成功rewrite与fallback混合后的exact mutation order/bytes，不在每次attempt重新replace。
- **AC-43** 首次或第三次内`confirmed`时返回exact`{committed:true,revision:state.baseRevision,status:"committed",value}`；release一次、invalidate 0，revision不取request target或changeset字段。
- **AC-44** `retry`路径最多固定三次commit；每次使用runtime中的同一pending changeset，execute、image traversal/upload和replace各一次，pull不重放。不得公开`maxAttempts` override或0/无限attempt。
- **AC-45** `unknown`路径与retry相同；retry→unknown→confirmed、unknown→retry→confirmed等mixed序列保持同一pending changeset与call counts，不因result-unknown重跑Facade code或File API。
- **AC-46** commit返回`conflict`立即保留`WORKSPACE_RUNTIME_CONFLICT`和upstream message，后续commit为0；lease invalidate一次、release 0。
- **AC-47** `pull-required`立即保留`WORKSPACE_RUNTIME_PULL_REQUIRED`与base/known-head revisions，后续commit为0；invalidate一次、release 0。
- **AC-48** discard/其他terminal invalid result返回既有`WORKSPACE_RUNTIME_COMMIT_INVALID`，不把pending mutation当confirmed；invalidate一次、release 0。
- **AC-49** 三次均retry/unknown后返回`workspace-submit-retry-exhausted`，attempt count exact 3，detail只含最后pending changeset既有bounded sid/reqId；不得含credential/license/image bytes/code或无限detail。invalidate一次、release 0。
- **AC-50** write路径只有no-mutation与confirmed标记runtime reusable并release；sync failure、execute failure、replace failure、conflict、pull-required、discard、exhaustion和unexpected commit throw全部invalidate且不release，finalization在operation settle前完成。

### CLI Client Shell compatibility

- **AC-51** CLI daemon缩减为RPC payload validation、Core owner construction/delegation与daemon server lifecycle；不得继续导入runtime pool/lease、Collaboration commit result或embedded-image algorithm，不保留`synchronize`/commit loop/second owner。
- **AC-52** CLI daemon仍从existing Session path按target origin解析cookie、用existing env/bundled规则解析license、显式提供packaged worker entry；Session read timing只在新worker startup发生，Session schema/permissions与license值不变。
- **AC-53** daemon三wire保持：`runtime.execute-read`=`{code,target}`、`runtime.export-unit-data`=`{target}`、`runtime.execute-and-commit`=`{code,target}`；method names、canonical target object、malformed request code/message和JsonValue response bytes兼容。
- **AC-54** daemon socket path、identity、start/status/restart/stop、legacy shutdown和SIGINT/SIGTERM owners留在CLI；`onShutdown`等待Core owner close后才完成server close，signal路径不留下worker/socket。
- **AC-55** CLI thin worker entry只从Client Core public worker subpath导出/启动implementation；CLI无worker composition副本。Core public subpath的types/default runtime export在development/build/package conditions均可解析。
- **AC-56** program对execute/inspect/exchange/screenshot提供同一三操作structural adapter；inspect仍返回SDK要求的runtime lease shape但每次daemon RPC自持lease。target resolution、prepared code、RPC order、exact UnitData validation和Asset/render composition不变。
- **AC-57** existing execute、inspect（Trunk/Worktree）、Office export、screenshot formula/embed、SVG apply、Typst apply、application command-contract和daemon tests保持JSON/text/coded errors、revision/status/value、worker role/PID与request order；被排除workflow只切换public types/port，不改业务body。
- **AC-58** CLI旧`features/content/{execution,embedded-images,image-references}`与`runtime/{daemon,worker}`中被迁移的算法owner删除；允许薄Shell adapter/entry存在，但不得re-export shim、复制body、通用compatibility layer或private Core path import。

### Package、secret hygiene与完整gate

- **AC-59** Client Core manifest只增加content runtime所需且与单一SDK baseline一致的exact dependencies；Core root和worker public subpath build成功。CLI package将Core runtime/worker代码内联，`dist/runtime/worker.js`及worker-child closure存在，无workspace bare import、`.ts`/test/map、绝对/相邻checkout path或private runtime install dependency。installed smoke在临时cwd/home完成authenticated daemon/worker inspect、exact endpoints/role/PID/structured output和clean shutdown；fixture与stdout/stderr不泄露cookie、license、device code或worker init。Core/CLI typecheck/test/build、repository typecheck/test/build、clean package build、verify/smoke、SDK dependency tests与`git diff --check`全部exit 0；限定diff符合AC-05。可选local authenticated read-only smoke只在`127.0.0.1:3020`可用且凭据经安全env/stdin提供时运行，账号/密码/Cookie/license不写入Markdown、fixture、源码、命令行或日志；Server不可用记`environment-unavailable`，不判产品失败且不替代自动gate。
- **AC-60** QA只为公开合同和本Changescenario验收；不得为了“统一”要求Change 4 dependency、通用runtime/file/credential framework、second transport/auth/target owner、commit compatibility layer或大规模相邻workflow重构。任何此类实现均判scope failure，即使tests通过。

验收项总数：**60**。

## 执行命令

### 状态、前置exports与owner

```bash
openspec status --change extract-content-runtime-client-core --json
openspec instructions apply --change extract-content-runtime-client-core --json
pnpm --filter @univerjs/univer-workspace-client-core typecheck
rg -n 'WorkspaceHttp|WorkspaceApplicationError|workspaceError|parseWorkspaceRuntimeTarget|serializeWorkspaceRuntimeTarget|workspaceRuntimeKey|WorkspaceSnapshotServerAdapter|loadWorkspaceReferenceHostContext|createWorkspaceReferencedUnitProviderRegistration' \
  packages/client-core/src/index.ts packages/client-core/src
rg -n 'apps/cli|workspaceSessionPath|readWorkspaceCookie|resolveUniverLicense|commander|DaemonClient|@univer-cli/daemon|process\.env' \
  packages/client-core/src --glob '*runtime*.ts' --glob '*worker*.ts' --glob '*execution*.ts' --glob '*image*.ts'
rg -n 'resolveWorkspaceAssetContent|WorkspaceBlobFeature|WorkspaceAssetFeature|prepareDownload|node:fs' \
  packages/client-core/src --glob '*runtime*.ts' --glob '*image*.ts'
rg -n '@univerjs/univer-workspace-client-core/(src|dist)|packages/client-core/(src|dist)' \
  apps packages --glob '*.ts' --glob '*.mjs'
```

第一项export搜索必须命中Change 5唯一public owners；其余forbidden Core shell/Change 4/private-path搜索预期无匹配。实现后用下列检查确认唯一owner：

```bash
rg -n 'createUniverCollaborationRuntimePool|defineUniverCollaborationRuntimeWorker|commitStableChangeset|MAX_COMMIT_ATTEMPTS|externalizeEmbeddedImages|rewriteWorkspaceImageReferences|prepareContentExecutionProgram' \
  packages/client-core/src apps/cli/src
rg -n 'runtime\.execute-read|runtime\.export-unit-data|runtime\.execute-and-commit|workspaceSessionPath|resolveUniverLicense|DAEMON_SOCKET_ENV|SIGINT|SIGTERM' \
  apps/cli/src/runtime apps/cli/src/program.ts
```

pool/worker/commit/image/execution算法只能由Core拥有；CLI匹配只能是Session/license/socket/signal、三RPC validation/delegation、thin worker entry或structural adapter。

### Core direct tests

```bash
pnpm --filter @univerjs/univer-workspace-client-core typecheck
pnpm --filter @univerjs/univer-workspace-client-core build
pnpm --filter @univerjs/univer-workspace-client-core test
pnpm --filter @univerjs/univer-workspace-client-core exec vitest run --config vitest.config.ts \
  test/content-runtime.test.ts \
  test/content-worker.test.ts \
  test/content-execution.test.ts \
  test/embedded-images.test.ts
```

若文件名变化，QA按test titles定位。direct fixtures必须记录resolver/acquire/pull/execute/export/upload/replace/commit/release/invalidate/close调用顺序与次数，并检查HTTP/WS/session-ticket URL、worker init和secret-free errors。

### CLI compatibility

```bash
pnpm --filter univer-workspace-cli typecheck
pnpm --filter univer-workspace-cli build
pnpm --filter univer-workspace-cli exec vitest run --config vitest.config.ts \
  test/content-execution.test.ts \
  test/workspace-cli.test.ts \
  test/workspace-unit-exchange.test.ts \
  test/workspace-screenshot.test.ts \
  test/workspace-compile-svg.test.ts \
  test/typst.test.ts \
  test/application-command-contracts.test.ts \
  test/legacy-daemon.test.ts \
  test/auth-transport.test.ts \
  test/config.test.ts
pnpm --filter univer-workspace-cli test
```

迁移后的embedded image算法测试应归Core；CLI只保留daemon/worker composition、RPC wire、Session/license、command/output和built-entrypoint coverage。

### Clean package与installed runtime smoke

```bash
pnpm --filter @univerjs/univer-workspace-client-core run clean
pnpm --filter @univerjs/univer-workspace-client-core run build
pnpm --filter univer-workspace-cli run clean
pnpm package:workspace-cli
pnpm --filter univer-workspace-cli package:verify
pnpm --filter univer-workspace-cli package:smoke
```

QA必须检查package verify的worker public subpath/build asset/worker-child closure和unresolved import结果；smoke必须从安装目录bin启动真实daemon/worker并执行authenticated runtime-backed read，不能用`--help`或source import代替。

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
  apps/cli/src/config.ts apps/cli/src/license.ts apps/cli/src/features/auth \
  apps/cli/src/features/blob apps/cli/src/features/asset
git diff --name-only <before-tree> <after-tree> -- \
  apps/cli/src/features/exchange apps/cli/src/features/typst apps/cli/src/features/svg \
  apps/cli/src/features/screenshot apps/cli/src/features/lint
```

第一组限定diff预期为空。第二组只允许runtime-operation public type/import与adapter替换；Office/Typst/SVG/render/screenshot/lint业务body变化判scope failure。Server contract未变时不新增`api:verify`作为完成条件。

### Secret hygiene与可选local smoke

```bash
git diff <before-tree> <after-tree> -- . ':!docs' ':!openspec' | \
  rg -ni "(username|password|cookie|device(code)?|license)\s*[:=]\s*['\"][^'\"]+"
rg -n '@univerjs/univer-workspace-client-core|packages/client-core|/Users/|/home/' \
  apps/cli/package-dist --glob '*.js' --glob 'package.json'
curl --fail --max-time 2 http://127.0.0.1:3020/api/session
```

凭据搜索允许明确标注的test/package fixture假值，但QA必须逐项证明它们不是用户凭据且fixture会检查stdout/stderr non-disclosure。Server不可用记录`environment-unavailable`；可用时也只能通过安全env/stdin在隔离临时`UNIVER_HOME`执行read-only login/whoami/inspect，不记录secret。

## QA观察记录

| 观察面 | 基线合同 | QA证据 | 结论 |
| --- | --- | --- | --- |
| Prerequisite/owner | Change 5唯一target/Snapshot/reference/auth/error；Core唯一content runtime | `rg`确认Change 5 exports仍由原文件提供；pool、worker、commit、image rewrite与content program的新增owner只在`packages/client-core/src`，CLI只留adapter/entry。Core shell、Change 4与private-path forbidden import搜索均无匹配。 | pass |
| Worker init/composition | Shell注入entry/credential/license；secret-free；Trunk/Worktree endpoints | `content-worker.test.ts`覆盖两种scope endpoint、session-ticket、worker role/PID、init validation和Snapshot/reference注入；source检查五种Unit mapping。review fix后credential undefined/rejection与license异常均在pool/content前归一化；独立探针为`leaked=false`。 | pass |
| Pool lifecycle | revision-independent reuse与awaited close | `content-runtime.test.ts`确认跨revision resolver各一次、key不含secret、pool复用；deferred close在pool settle前保持pending。 | pass |
| Synchronize/read/export | dirty/conflict/exact revision；lossless read/exact UnitData；release | Core direct tests覆盖三种dirty、pull conflict、revision mismatch、exact read value/UnitData与成功/失败release；source保持一次pull和严格数值revision比较。 | pass |
| Write/no mutation | editable/type/binding；write once；no-mutation reuse | `content-execution.test.ts`与runtime tests覆盖editable/type/reserved binding顺序、Trunk pre-acquire拒绝、write一次、0 mutation不replace/commit并release；失败路径invalidate。 | pass |
| Embedded images | direct/serialized、四raster、20MiB、dedup、immutable、fallback、File API | `embedded-images.test.ts`覆盖direct/serialized三种shape、四种签名、SVG/invalid、20MiB边界、digest dedup、input immutable、upload/empty FileId fallback与exact Worktree File API/form；source无Change 4依赖。 | pass |
| Commit | replace once、三次same pending changeset、terminal errors、release/invalidate | runtime tests覆盖externalize/replace各一次、retry/unknown mixed sequence不重放、confirmed、conflict、pull-required、discard、三轮exhaustion和所有lease finalization call count。 | pass |
| CLI parity | thin daemon/worker、三wire、Session/license/socket/signals与consumers | CLI定向10 files为63/63；全CLI为17 files、74/74。daemon保留Session/license/socket/signals和三RPC validation，worker仅public subpath entry；exchange/screenshot仅改structural runtime port，SVG仅改public type import。 | pass |
| Installed artifact | public worker subpath、bundle closure、runtime smoke、secret hygiene | clean package build、verify和smoke exit 0；203 files，packed 13,028,835 bytes。installed smoke执行authenticated login/session、daemon/worker-backed `inspect`，核对snapshot/session-ticket endpoints、worker role/PID、structured value和clean stop；stdout/stderr不含fixture cookie。artifact搜索无workspace Core bare/private/checkout path、`.ts`或map。 | pass |
| Full/scope gate | Core/CLI/repository/package/diff checks | Core 15 files/263 tests、direct 4 files/46 tests、CLI定向63 tests、完整repository `typecheck && test && build`全部exit 0；Workspace 34 files/152 tests，reference-provider 2 files/16 tests；SDK/release gates通过；`git diff --check`通过。Server `127.0.0.1:3020`不可连接，local smoke记`environment-unavailable`，未使用凭据且不判产品失败。 | pass |

## AC执行结论

证据缩写：`S`=限定diff/static owner检查；`C`=Core direct tests（4 files/46 tests，Core full 15 files/263 tests）；`L`=CLI定向/full tests（63/74 tests）；`P`=clean package verify/installed smoke；`F`=repository full gate；`R`=独立运行时探针。

| AC | 证据 | 结论 | 备注 |
| --- | --- | --- | --- |
| AC-01 | S,C | pass | Change 5 exports存在并直接复用。 |
| AC-02 | S,C,P | pass | 单一private Core package，根入口与`./worker`可解析。 |
| AC-03 | S | pass | Core shell/daemon/private checkout import为0。 |
| AC-04 | S,C | pass | target/Snapshot/reference/auth/error无平行owner。 |
| AC-05 | S | pass | forbidden第一组diff为空；相邻consumer仅port/type接线。 |
| AC-06 | S | pass | 一个runtime owner和最小operation port，无列明大抽象。 |
| AC-07 | S,C | pass | entry/credential/license显式注入，无FS/env猜测。 |
| AC-08 | C | pass | 同key跨revision resolver各一次，其他identity由canonical key隔离。 |
| AC-09 | C,R | pass | undefined/rejected credential均返回固定authentication error；fetch/pool/content为0且secret-free。CRT-QA-001已关闭。 |
| AC-10 | C | pass | license empty/rejection归一化且acquire为0。 |
| AC-11 | S,C,P | pass | worker public subpath无CLI/env依赖，CLI entry为一行转交。 |
| AC-12 | C | pass | strict init/target先于factory/HTTP，复用Change 5 owners。 |
| AC-13 | C | pass | Trunk comb/connect/snapshot与origin session-ticket exact。 |
| AC-14 | C | pass | Worktree encoded endpoint exact且session-ticket留origin。 |
| AC-15 | S,C,P | pass | authenticated collaboration request与worker headers保持。 |
| AC-16 | S,C,F | pass | 五种Unit switch完整，exact target加载和resolver顺序保持。 |
| AC-17 | C | pass | revision-independent key复用且不含credential/license。 |
| AC-18 | C,L | pass | owner/daemon shutdown等待pool close。 |
| AC-19 | C | pass | 三种dirty均在pull/content前固定失败。 |
| AC-20 | C | pass | clean只pull一次，conflict立即退出。 |
| AC-21 | C,S | pass | pull后严格revision相等，mismatch不执行content。 |
| AC-22 | C | pass | read mode一次且value原样返回。 |
| AC-23 | C | pass | read不replace/commit；形成lease后统一release。 |
| AC-24 | C | pass | UnitData exact返回且无write调用。 |
| AC-25 | C,S | pass | acquire前失败无lease finalizer，lease后read/export均release。 |
| AC-26 | C,L | pass | editable→type→prepare顺序与五类binding保持。 |
| AC-27 | C,L | pass | reserved binding/type code在runtime port前返回。 |
| AC-28 | C | pass | non-Draft/Trunk在acquire/write前拒绝。 |
| AC-29 | C | pass | write一次；0 mutation返回exact false result并release。 |
| AC-30 | C | pass | execute/result/replace失败均invalidate且无重放。 |
| AC-31 | C,L | pass | structural write result严格解析并保留lossless value。 |
| AC-32 | S,C | pass | image owner迁入Core，CLI旧实现删除，无Change 4 import。 |
| AC-33 | C | pass | 三对direct reference shape exact处理。 |
| AC-34 | C | pass | serialized resources递归处理，invalid JSON逐字保留。 |
| AC-35 | C | pass | PNG/JPEG/GIF/WebP media/signature与bytes exact。 |
| AC-36 | C | pass | canonical base64限定，SVG及invalid输入不上传。 |
| AC-37 | C | pass | 真实20MiB接受，+1拒绝。 |
| AC-38 | C | pass | 跨mutation/direct/serialized digest一次上传，顺序稳定。 |
| AC-39 | C | pass | input immutable；0成功时保留原array identity/bytes。 |
| AC-40 | C | pass | encoded Worktree File API、query、multipart与digest filename exact。 |
| AC-41 | C | pass | throw/empty FileId逐图fallback且pipeline继续。 |
| AC-42 | C | pass | externalize→replace一次→commit，顺序/bytes保持。 |
| AC-43 | C | pass | confirmed返回state baseRevision并release一次。 |
| AC-44 | C,S | pass | retry固定最多3次，无public max-attempt option。 |
| AC-45 | C | pass | retry/unknown mixed sequence不重放execute/upload/replace。 |
| AC-46 | C | pass | conflict立即coded error并invalidate。 |
| AC-47 | C | pass | pull-required保留revision detail并invalidate。 |
| AC-48 | C | pass | discard/terminal invalid不误报confirmed。 |
| AC-49 | C,S | pass | 三次exhaustion、bounded sid/reqId detail、无secret/code/image。 |
| AC-50 | C | pass | reusable仅no-mutation/confirmed；其他路径invalidate。 |
| AC-51 | S,L | pass | daemon只做payload、composition、delegation和server lifecycle。 |
| AC-52 | S,L,P | pass | Session/license/worker entry仍由CLI注入，读取时机未前移。 |
| AC-53 | L | pass | 三method/payload/result/malformed request合同保持。 |
| AC-54 | S,L,P | pass | socket/identity/control/signals留CLI且clean shutdown。 |
| AC-55 | S,C,P | pass | thin worker entry与Core public subpath在dev/build/package可解析。 |
| AC-56 | S,L | pass | program给inspect/execute/exchange/screenshot同一structural adapter。 |
| AC-57 | L,F | pass | commands/consumers定向及全量tests通过，无业务body漂移。 |
| AC-58 | S | pass | 旧算法owner删除；仅薄adapter/entry保留。 |
| AC-59 | C,L,P,F | pass | 所有自动gate与installed runtime smoke通过；local smoke为environment-unavailable。 |
| AC-60 | S | pass | 未引入禁止的通用framework、compatibility layer或Change 4耦合。 |

汇总：**60/60 pass，0 fail，0 open issue**。

## 初始QA实际执行命令与结果

```text
openspec status --change extract-content-runtime-client-core --json                  PASS（artifacts complete）
openspec instructions apply --change extract-content-runtime-client-core --json      PASS（7/7 tasks）
git diff --check b80fd9d... fc2994e...                                                 PASS
rg owner/forbidden-import/private-path + scoped git diff checks                       PASS
pnpm --filter @univerjs/univer-workspace-client-core typecheck &&
pnpm --filter @univerjs/univer-workspace-client-core build &&
pnpm --filter @univerjs/univer-workspace-client-core test                                PASS（15 files, 263 tests）
pnpm --filter @univerjs/univer-workspace-client-core exec vitest run <4 direct files>    PASS（4 files, 46 tests）
pnpm --filter univer-workspace-cli typecheck &&
pnpm --filter univer-workspace-cli build &&
pnpm --filter univer-workspace-cli exec vitest run <10 files>                            PASS（10 files, 63 tests）
pnpm --filter @univerjs/univer-workspace-client-core run clean &&
pnpm --filter @univerjs/univer-workspace-client-core run build &&
pnpm --filter univer-workspace-cli run clean && pnpm package:workspace-cli &&
pnpm --filter univer-workspace-cli run package:verify &&
pnpm --filter univer-workspace-cli run package:smoke                                     PASS（installed tarball commands passed）
pnpm typecheck && pnpm test && pnpm build                                               PASS（CLI 74, Workspace 152, reference 16 tests）
curl --max-time 2 http://127.0.0.1:3020/                                                environment-unavailable（exit 7）
node --input-type=module -e '<下列rejected credential resolver probe>'                   FAIL as expected by probe: leaked=true
```

探针使用纯fixture标记，不包含用户凭据。输出为：

```bash
node --input-type=module -e 'import { createWorkspaceContentRuntime } from "./packages/client-core/dist/index.js"; const runtime=createWorkspaceContentRuntime({workerEntry:new URL("./packages/client-core/dist/content-worker.js", import.meta.url),resolveCredential:async()=>{throw new Error("fixture-cookie-secret")},resolveLicense:async()=>"fixture-license"}); const target={origin:"https://workspace.test",revision:1,scope:{kind:"worktree",worktreeId:"wt-1"},unitId:"unit-1",unitType:"sheet"}; const error=await runtime.exportUnitData({target}).catch(e=>e); console.log(JSON.stringify({message:String(error),leaked:String(error).includes("fixture-cookie-secret")})); await runtime.close();'
```

输出：

```json
{"message":"Error: fixture-cookie-secret","leaked":true}
```

## QA issues

状态取值：`open`、`fixed-pending-qa`、`closed`、`accepted-risk`。

| ID | 严重度 | 证据 | 期望 | 状态 |
| --- | --- | --- | --- | --- |
| CRT-QA-001 | high | 初始实现`content-runtime.ts:204`未捕获credential resolver rejection，探针曾得到`{"message":"Error: fixture-cookie-secret","leaked":true}`。当前`content-runtime.ts:248-265`捕获并归一化；direct test验证固定code/message、secret-free以及fetch/acquire/state/export 0调用。相同构建后探针现得到`workspace-authentication-required`、固定message、`leaked=false`。 | 与credential缺失合同一致，在pool acquire/content前将resolver rejection归一化；不得泄露resolver异常或credential。 | closed |

## Review fix re-QA（2026-08-28）

复验只检查产品diff `fc2994e7e2ed484b922c4c353e91f99e07cb632e..681c23552a38997a2e67f0f570ad89d72f98e116`。diff严格限定为`packages/client-core/src/content-runtime.ts`与`packages/client-core/test/content-runtime.test.ts`，共`+224/-5`；没有manifest、依赖、CLI、worker、OpenSpec或相邻workflow变化，`git diff --check`通过。

本段保留第一轮QA历史。后续独立review复现了failure前FIFO waiter和延迟TTL/LRU eviction跨generation窗口，因此本段关于cache lifecycle的结论已由下方“第二轮 review fix re-QA”取代；`CRT-QA-001`的credential secret修复仍有效。

| 复验面 | 证据 | 结论 |
| --- | --- | --- |
| CRT-QA-001 | `resolveCredential()` rejection被catch并转换为既有`workspace-authentication-required`和固定message。新增test验证fixture secret不在`String(error)`/JSON中，fetch、pool acquire、lease state与content调用均为0；构建后独立探针返回`{"code":"workspace-authentication-required","message":"Log in to the current Workspace origin first.","serialized":"{\"code\":\"workspace-authentication-required\",\"name\":\"WorkspaceApplicationError\"}","leaked":false}`。 | pass，issue closed |
| create/open failure | `pool.acquire()`失败时只在Map仍指向该pending entry时删除；direct test第二次调用重新解析credential/license并使用current init，content只在恢复后执行。 | pass |
| instance-failed并发代际 | operation先发`instance-failed`清除旧entry；并发调用建立new init；旧lease随后发出的`evicted(reason="invalidate")`不会删除replacement。direct deferred test证明第三次same-key cache hit继续复用new init。 | pass |
| explicit write invalidate | write conflict进入finally时先以identity check删除自己的init entry，再await lease invalidate；后续same-key调用重新解析new credential/license。 | pass |
| TTL/LRU | `onEvent`对所有`evicted`中除`invalidate`外的reason删除key；依赖的event type只允许`invalidate`、`lru`、`ttl`，因此TTL/LRU仍使下一次acquire重新解析init。没有新增cache option或策略。 | pass |
| normal reuse与worker/parent一致性 | 既有same-key跨revision test仍证明resolver各一次且两次pool acquire收到同一init；并发代际test进一步以object identity证明worker acquire与后续cache hit使用同一new init，并核对parent File API Cookie同为该new credential。 | pass |
| 60 AC回归 | focused runtime 26/26、Core full 267/267、Core typecheck/build、CLI typecheck均exit 0；重新构建package后verify与installed authenticated runtime smoke通过。fix没有改变RPC、Session/license、worker、image、commit attempts或artifact边界。 | pass |

实际命令：

```bash
git diff --check fc2994e7e2ed484b922c4c353e91f99e07cb632e 681c23552a38997a2e67f0f570ad89d72f98e116
git diff --name-status fc2994e7e2ed484b922c4c353e91f99e07cb632e 681c23552a38997a2e67f0f570ad89d72f98e116
pnpm --filter @univerjs/univer-workspace-client-core exec vitest run --config vitest.config.ts test/content-runtime.test.ts
pnpm --filter @univerjs/univer-workspace-client-core test
pnpm --filter @univerjs/univer-workspace-client-core typecheck
pnpm --filter @univerjs/univer-workspace-client-core build
pnpm --filter univer-workspace-cli typecheck
pnpm package:workspace-cli
pnpm --filter univer-workspace-cli run package:verify
pnpm --filter univer-workspace-cli run package:smoke
node --input-type=module -e '<同上credential resolver rejection探针>'
```

当轮结论曾为60/60；后续review发现cache race证据缺口。以第二轮re-QA最终结论为准。

## 第二轮 review fix re-QA（2026-08-28）

固定产品diff：`681c23552a38997a2e67f0f570ad89d72f98e116..fb940ff1b4a88db6e767929b5b7c052b66595b9f`。QA独立读取更新后的review finding并复现其failure前waiter与延迟eviction顺序，没有采用implement汇报替代测试。

### 修复范围与pnpm patch

- diff共7 files、`+243/-87`：Core runtime、两个Core test files、一个真实worker fixture、一个精确SDK pnpm patch、`pnpm-workspace.yaml`与`pnpm-lock.yaml`。
- `pnpm install --frozen-lockfile`显示workspace already up to date并exit 0。`patchedDependencies`只命中`@univer-cli/univer-collaboration-runtime-pool@1.0.0-beta.2`，lock记录单一patch hash `619cbb56a6d5e73547fc8c3f38d38b8043e76665507057041fe9b53ee263fb77`；package manifests和SDK exact version未变，`pnpm test:sdk-dependencies` 4/4 pass。
- patch只给runtime-pool public event union加入`destroy-start`，并在现有factory `destroy`开始、await worker close之前发送该key事件；没有改变acquire、lease、operation、error或cache policy合同。安装后的`.d.ts`和`.mjs`各包含该event，CLI bundle也包含它。
- `git diff --check`通过；没有产品依赖、public Core API、credential store、runtime registry、pool wrapper或大compatibility layer。

### 并发与generation矩阵

| 场景 | 独立证据 | 结论 |
| --- | --- | --- |
| 同key normal reuse | `content-runtime.test.ts:42-68`仍验证跨revision resolver各一次、两次acquire收到同一init、key不含secret。 | pass |
| create/open failure | `content-runtime.test.ts:70-102`令第一次pool acquire reject；第二次调用重新解析current credential/license并成功访问content。 | pass |
| failure前FIFO waiter | `content-runtime.test.ts:104-207`在旧write operation尚未发`instance-failed`前提交第二个同key write。断言旧operation完成invalidate前pool acquire和resolver都仍为1次，证明waiter未携旧init进入pool。 | pass |
| failure后请求 | 同一fixture在`instance-failed`和`destroy-start`之后、旧invalidate尚未完成时提交第三个同key read。它继续排在FIFO中；旧operation结束后第二/第三次acquire共享new init，resolver总计仅2次。 | pass |
| worker/parent同init | replacement worker acquire与随后cache hit的init用object identity比较为同一对象；embedded-image parent HTTP Cookie同时核对为该new init的credential。 | pass |
| TTL延迟evicted | 真正runtime-pool和child worker fixture使用`idleTtlMs:0`，在pool close之前观察到`destroy-start`先于`evicted`。Core mock fixture再让replacement generation夹在两事件之间，延迟TTL completion不会删除new init。 | pass |
| LRU延迟evicted | Core同一确定性fixture以`destroy-start → replacement → evicted(reason=lru) → cache hit`顺序执行；replacement/cache hit共享new init，resolver总计2次。 | pass |
| explicit write invalidate | write failure仍在await invalidate前identity-check删除自己的init；同key串行保证下一请求只在旧destroy完成后重新解析。 | pass |
| `destroy-start`真实顺序 | `runtime-pool-events.test.ts`使用真实patched package、forked worker和TTL eviction，focused test实际观察事件顺序；不是手工调用callback的替代证据。 | pass |
| 不同generation的延迟`evicted` | Core不再根据完成态`evicted`删除init，只响应提前的`destroy-start`/`instance-failed`；因此旧generation completion无法删除已经建立的replacement entry。 | pass |

实现以`workspaceRuntimeKey()`为粒度在进入resolver/pool前串行整个read/export/write operation（`content-runtime.ts:69-70,88-168,173-192`）。不同identity使用不同key，不建立全局锁；同target跨revision维持既有revision-independent key。event owner在`content-runtime.ts:71-77`于`destroy-start`或`instance-failed`清init；write parent HTTP继续直接使用pool acquire对应的`init.credential`（`content-runtime.ts:108-140`）。

### CRT-QA-001与secret hygiene

- 原credential resolver rejection探针在当前build仍返回既有`workspace-authentication-required`、固定message和`leaked=false`；pool/content未启动。`CRT-QA-001`保持closed。
- fix diff secret pattern扫描只命中direct test fixture的`license: "new-license"`；patch、workspace/lock配置与installed artifact不含fixture/user credential。package smoke继续检查stdout/stderr不泄露其authenticated fixture Cookie。
- QA未读取、使用或记录任何真实测试账号。

### 实际命令与结果

```text
pnpm install --frozen-lockfile                                                   PASS（already up to date）
pnpm --filter @univerjs/univer-workspace-client-core exec vitest run \
  --config vitest.config.ts test/content-runtime.test.ts \
  test/runtime-pool-events.test.ts                                               PASS（2 files, 29 tests）
pnpm --filter @univerjs/univer-workspace-client-core test                        PASS（16 files, 270 tests）
pnpm --filter @univerjs/univer-workspace-client-core typecheck                   PASS
pnpm --filter @univerjs/univer-workspace-client-core build                       PASS
pnpm --filter univer-workspace-cli typecheck                                     PASS
pnpm test:sdk-dependencies                                                       PASS（4 tests）
pnpm package:workspace-cli                                                       PASS（203 files；packed 13,029,076 bytes）
pnpm --filter univer-workspace-cli run package:verify                            PASS
pnpm --filter univer-workspace-cli run package:smoke                             PASS（installed tarball commands passed）
node --input-type=module -e '<credential resolver rejection probe>'              PASS（fixed code/message；leaked=false）
git diff --check 681c235... fb940ff...                                            PASS
git diff/rg patch-lock-scope与secret hygiene                                     PASS（仅测试fixture假值命中）
```

第二轮修复没有改变60项AC的外部合同；新增矩阵用于覆盖review指出的同key生命周期race，不另行扩大原AC计数。最终：**60/60 pass，0 open issue；Ready to archive**。
