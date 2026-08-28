# extract-typst-client-core QA

本文件定义并记录 Change `extract-typst-client-core` 的实现后验收。初次QA固定比较 baseline tree `ed3a6c57deddd3d0724073fd48da56e6e094b2a1` 与 implementation tree `188e0ce49824dbabf19889aa6fec2723fb15e2ca`，并以 OpenSpec final tree `92315300f8b799054a855e89e678c91288557b01` 交叉检查规划完整性。SPEC-01 fix复验固定比较 `188e0ce49824dbabf19889aa6fec2723fb15e2ca..4e2b8d5b7c18b3bfd99c5adf1a1231c0e4a92905`。当前结论：**原56/56 pass，补充矩阵8/8 pass，0 open issue；Ready**。

## 基线、边界与关键风险

- 实施后 QA 必须记录 baseline tree 与 implementation tree，并只审查该固定区间。Tasks 勾选或 implement 汇报不能代替行为证据。
- Change 1 的 `workspaceError`/coded error 与 Change 3 的 `WorkspaceUnitFeature.create()` 是直接前置。实现缺失任一 public seam 时必须停止，不得复制 error、Unit parser、idempotency 或 result-unknown owner。
- Client Core 成为 Typst compile、diagnostic apply gate、deterministic disposable Doc materializer 与 staged Doc apply 的唯一 owner。CLI 只保留 Commander validation、`--out`/`--diagnostics-out` 文件写入、JSON/text presentation 和可安装 artifact。
- Typst materializer 是一次性本地 headless runtime，不接入 Change 6 的远程 collaboration runtime、daemon、Session、credential/license或worker pool。
- 不引入compiler/materializer registry、DI container、Client Shell基类、filesystem provider、generic artifact service、并发scheduler、mutex、cache、cancellation或 compatibility layer。
- 主要风险是compiler被调用两次、warnings被误判为errors、diagnostic detail泄露warnings、全局random descriptor未恢复、runtime在失败路径未dispose、临时target identity与Server Unit identity混淆，以及native binding仍从CLI偶然hoist解析。

## Spec scenario → 测试与命令

最终测试文件可按 owner 命名调整；QA 先用 `rg --files` 解析真实路径并记录。compile/materialize/apply算法必须有Core direct tests，CLI tests只证明Shell validation、输出和delivery。

| OpenSpec scenario | 实现后必须存在的直接证据 | 最小命令 |
| --- | --- | --- |
| Bundle compiles for review | compiler一次、exact options、完整compiler fields加`committed:false`、materialize/create 0 | Core Typst focused test |
| Compile-only result contains errors | error/warning diagnostics及artifacts原样返回，Workspace side effect 0 | Core Typst focused test |
| Error blocks apply | 只筛error到detail，既有coded error；materialize/create 0 | Core Typst focused test |
| Warnings allow apply | 同一次compiled result进入materialize/create，warnings仍在success result | Core Typst focused test |
| Same program materialized repeatedly | 两个一次性runtime得到等价完整Doc data、target id与rev 1 | Core materializer focused test |
| Program violates lifecycle | prohibited methods、zero/multiple/wrong Unit逐项既有runtime-contract error且dispose | Core materializer focused test |
| Program does not save complete Doc | missing Doc与invalid/wrong saved data拒绝，runtime在finally dispose | Core materializer focused test |
| Compiled Doc is applied | exactDoc create input、name precedence、target fields/idempotency与Server Unit result | Core Typst focused test |
| Create cannot be confirmed | mismatch/result-unknown原样传播，compile/materialize/create各最多一次 | Core Typst focused test |
| Installed native runtime available | 临时安装tarball，从任意cwd以真实minimal bundle编译并写program/diagnostics | package smoke |
| Native runtime missing | owner/manifest/verify/smoke在binding缺失或不可加载时失败 | package artifact tests + verify/smoke |
| CLI contracts exercised | validation order、input mapping、文件schema、JSON/text/coded errors | CLI Typst/command tests |
| Installed CLI arbitrary cwd | self-contained artifact无workspace/source checkout依赖且真实compile成功 | package verify/smoke |

## 验收标准

### 前置、owner 与 scope

- **AC-01** apply前证明Client Core根入口的`workspaceError`、`WorkspaceApplicationError`、`WorkspaceResultUnknownError`与`WorkspaceUnitFeature`/`WorkspaceUnit`真实可用，且Changes 1–7最终gates无open issue；Core typecheck通过。
- **AC-02** Typst compile/materialize/apply只加入现有private `@univerjs/univer-workspace-client-core`并从根入口提供必要named exports；不新增package、版本、public npm或private subpath contract。
- **AC-03** Core Typst source不导入`apps/cli`、Commander、CLI command/presenter、daemon、Session/config、CLI filesystem helper、CLI private `src`/`dist`或相邻checkout；Core input/result不包含`--out`、`--diagnostics-out`或`JsonOption`。
- **AC-04** 原CLI `features/typst/{compile,materialize}.ts`权威body删除；CLI只允许`command.ts`和program composition。compiler、diagnostic gate、random guard、lifecycle guard、save normalization与apply workflow不得在两个owner重复。
- **AC-05** 固定diff不修改Typst Source Bundle schema、上游compiler/native binding、Workspace Server/Browser/HTTP/Collaboration、Session、daemon、remote content runtime、Office、SVG、screenshot/lint或Skills行为。
- **AC-06** 实现保持一个窄compile function substitution、一个窄materializer structural dependency和共享Unit create operation；不得增加registry/factory hierarchy、service container、filesystem abstraction、remote artifact store、并行队列/cache/cancellation或大compatibility layer。

### Compile-only 与compiler contract

- **AC-07** 每次顶层`execute()`恰好调用compiler一次；bundle path逐字透传。无preview时第二参数exact为`{}`，有preview时exact为`{previewDir}`，不添加Shell输出路径或Workspace target字段。
- **AC-08** compile-only success返回compiler的`diagnostics/javascript/previews/targetUnitId/title`及任何上游保留字段，值与引用语义不被filter/serialize改写，并只增加`committed:false`且无`unit`。
- **AC-09** previewDir undefined、相对路径、含空格路径与absolute path均原样传给compiler；preview result数组和每项字段原样返回，不由Core创建/重写preview目录。
- **AC-10** compile-only含一个或多个error diagnostics时仍成功返回完整compiler artifacts、全部errors/warnings与`committed:false`；materializer与Unit create均0调用。
- **AC-11** compiler reject时同一failure/coded error向上传播；materializer/create均0，不重试、fallback或返回部分success。
- **AC-12** compile-only无Workspace副作用：不创建headless runtime、Unit、HTTP/auth/daemon请求，也不读取Session/license；无`--out`/diagnostics本地写入。
- **AC-13** Core不解释或改写compiler diagnostic/preview结构、generated JavaScript、target Unit id或title；针对嵌套/额外字段的fixture证明完整字段保留。

### Apply diagnostic gate 与single compile

- **AC-14** apply只把`severity === "error"`的diagnostics筛入既有`workspace-typst-diagnostics` detail，detail exact为`{diagnostics: errors}`；warnings/info不进入error detail，message中的数量与errors长度一致。
- **AC-15** 一个或多个error阻断materialize与create，二者0调用；compiler仍恰好一次。mixed warning+error保持errors原顺序，不回传warnings到failure detail。
- **AC-16** 只有warnings或无diagnostics时允许apply；materializer恰好一次、create恰好一次，success result保留原完整diagnostics/previews/javascript/target/title。
- **AC-17** apply使用首次compile返回的exact`javascript`与`targetUnitId`调用materializer，不从bundle重读、不再次compile，也不基于preview生成另一个program。
- **AC-18** materializer/create reject、mismatch或result-unknown均不得触发compiler或materializer重放；每个顶层operation的call count固定compile 1、materialize最多1、create最多1。

### Deterministic disposable Doc materializer

- **AC-19** 每次materialize创建一个新的standard headless Univer，factory input exact为`{license:""}`，runtime init exact使用compiler `targetUnitId`与`UNIVER_DOC`；不启动daemon/remote runtime或读取Client Shell license。
- **AC-20** program只能通过`createDocument`创建Doc；允许case记录每次调用的non-empty`id`并执行原Facade method。恰好一个created id且等于target才进入get/save。
- **AC-21** `createBase/createBoard/createWorkbook/createPresentation/createUniverSheet/disposeUnit`逐项在调用点返回既有`workspace-typst-runtime-contract`，后续program/save/create为0；不得静默忽略或映射为Doc。
- **AC-22** program未调用`createDocument`、传missing/empty/blank id或最终记录0个created id时返回既有contract error，detail/message与旧CLI兼容，runtime dispose一次。
- **AC-23** program调用`createDocument`两次或更多（相同或不同id）时返回contract error；created IDs顺序保持，get/save/Workspace create为0，dispose一次。
- **AC-24** 唯一created id不等于target时返回contract error；不得把compiler target改成program identity或保存wrong Unit。
- **AC-25** create记录正确但`getDocument(target)`返回null时返回既有contract error；save与Workspace create为0，runtime dispose一次。
- **AC-26** `save()`返回null、array、primitive、empty record、missing id或wrong id逐项返回既有runtime-contract error；不得normalise为success或调用Workspace create，dispose一次。
- **AC-27** valid saved record的全部字段/嵌套值保留，只把`id`固定为compiler target、`rev`固定为数值`1`；saved中旧rev、缺rev或额外字段均得到相同normalization。
- **AC-28** materialized name优先non-empty saved`name`，其次non-empty saved`title`，两者均空白/非string时省略`name`；选中值不trim或改写。
- **AC-29** 同一JavaScript与target在独立invocation中，即使外部全局random状态不同，也产生等价UnitData；fixture同时消费`Math.random()`与`crypto.getRandomValues()`并比较exact bytes/values。
- **AC-30** deterministic seed只由generated JavaScript的stable bytes决定；同一program的random call sequence稳定，不读取time/process/env/target id。不同program不要求碰巧相同，zero-hash fallback路径仍产生有效序列。
- **AC-31** operation执行前后`Math.random`和`globalThis.crypto.getRandomValues`的完整property descriptors（value、writable、enumerable、configurable及不存在case）逐项恢复；success、program throw与contract failure均验证。patched function保持typed-array view offset/length并返回原view。
- **AC-32** runtime在materialize success、program throw、prohibited lifecycle、zero/multiple/wrong Unit、missing Doc、save throw与invalid saved data后均恰好dispose一次且在promise settle前完成；factory创建失败时不伪造dispose。

### Apply create 与Server identity

- **AC-33** diagnostic gate通过后只用materializer返回的exact`initialData`调用共享`WorkspaceUnitFeature.create()`一次；type固定`doc`，不从compiler artifacts重新构造UnitData。
- **AC-34** create name优先materialized non-empty name，缺失时用compiled title；值与旧CLI一致，不把临时target id当名称或强制trim。
- **AC-35** create input逐字透传Space、Worktree；parent Node与caller idempotency key仅在提供时出现且不生成/trim/替换。optional omission与含空格值均有直接断言。
- **AC-36** apply success返回全部compiler fields、`committed:true`与shared create返回的exact `WorkspaceUnit`；Server分配的Unit/Node/Resource identity允许不同于compiler临时`targetUnitId`，不得错误判mismatch。
- **AC-37** shared create负责source/type/name/Space/parent/Worktree result validation；其`workspace-result-mismatch`原样传播，Typst owner不复制parser、不返回committed、不再次compile/materialize/create。
- **AC-38** shared create的`WorkspaceResultUnknownError`/stable detail原样传播；同一idempotency identity不由Typst owner自动重试，compile/materialize/create call count均为1。
- **AC-39** ordinary create network/coded failure同样直接传播且不重放；headless runtime已在materializer返回前dispose，不因Server failure保留runtime。
- **AC-40** apply input只包含framework-neutral bundle/preview与Workspace target identity；不读取CLI Session文件或调用daemon，认证HTTP时机仍由injected shared Unit owner决定。

### CLI validation、files 与presentation parity

- **AC-41** CLI仍公开`compile-typst <bundle>`及`--apply/--worktree/--space/--parent/--idempotency-key/--out/--diagnostics-out/--preview-dir/--json`，description、required/optional状态和Commander exit behavior不变。
- **AC-42** validation order保持：apply缺worktree或space先返回`--apply requires --worktree and --space`；非apply只要出现任一Workspace target option先返回`Workspace target options require --apply`；否则缺out才返回`Compile-only mode requires --out`。所有validation均在Core/compile与文件写入前。
- **AC-43** command向Core传exact bundle/preview；apply只在flag为true时构造target，并精确映射Space/Worktree及optional parent/idempotency。`--out`/`--diagnostics-out`不得进入Core input。
- **AC-44** feature success后`--out`按原path递归创建父目录并以UTF-8写exact generated JavaScript，不添加newline/BOM、resolve path或写临时协议；无out的apply不写program。
- **AC-45** `--diagnostics-out`以UTF-8写exact pretty JSON `{schemaVersion:1,diagnostics: result.diagnostics}`、2-space缩进与单一尾随newline；error/warning/extra diagnostic fields均原样保留。
- **AC-46** 文件顺序仍为program out先、diagnostics后、presentation最后；Core/validation failure不写任何文件，out写失败不写diagnostics，diagnostics写失败不输出success。不得把write/mkdir移入Core。
- **AC-47** JSON value exact为`committed/compiledTargetUnitId/diagnostics/previews`加optional`out`和optionalServer`unit`，不暴露generated JavaScript/title或增加envelope；compile-only errors按success JSON返回。
- **AC-48** text逐字保持compile-only`Compiled <target>; wrote <out>`与apply`Created staged Doc <serverUnitId> from <target> in <worktree>`；使用Server Unit id与compiler target的正确区分。
- **AC-49** argument/runtime/diagnostic/native/create errors保持existing coded JSON/text、exit code与stdout/stderr归属；输出不泄露Session Cookie、credential、device code、license、完整private path以外的额外环境信息。
- **AC-50** built CLI entrypoint从arbitrary cwd以相对/绝对bundle path完成真实compile-only，写入请求的program和diagnostics并返回相同structured result；不依赖repo cwd、全局Typst或相邻checkout。

### Dependency ownership、artifact 与完整gate

- **AC-51** Client Core manifest以exact SDK baseline声明`@univer-cli/doc-typst-facade`和真正需要的headless依赖；CLI移除不再直接使用的facade/headless source dependencies，但distribution继续externalize精确`@univerjs-pro/doc-typst-native-binding`。
- **AC-52** packaging从Client Core这一真实declared dependency owner定位facade及其binding版本，而非从CLI direct dependency或pnpm hoist猜测；package artifact test覆盖owner缺失、binding缺失/`workspace:*`与expected exact version。`pnpm install --frozen-lockfile`通过。
- **AC-53** package build/verify证明Core Typst代码内联CLI artifact；无bare`@univerjs/univer-workspace-client-core`、private Core install dependency、`src/test/.ts/.map`、absolute/相邻checkout path或unresolved facade/headless import。
- **AC-54** distribution manifest保留native binding与platform optional resolution；删除/破坏binding时manifest test、verify或installed smoke必须失败，不允许system Typst或JS fallback宣称ready。
- **AC-55** installed smoke在临时install root与arbitrary cwd创建真实minimal bundle，通过installed CLI执行`compile-typst --out --diagnostics-out --json`；断言exit 0、`committed:false`、exact target、program包含有效Facade apply、diagnostics schema 1且不依赖monorepo/系统Typst。
- **AC-56** Core focused/full typecheck/test/build、CLI command/built-entrypoint/full typecheck/test/build、root typecheck/test/build、SDK dependency tests、frozen install、package manifest/build/verify/installed smoke与fixed `git diff --check`全部exit 0；owner/scope/artifact/secret searches满足AC-03–06与51–54。可选local authenticated apply smoke只在`127.0.0.1:3020`可用且有明确临时fixture时执行，凭据仅经安全environment/stdin提供，不写Markdown、fixture、源码、命令行或日志；Server不可用记`environment-unavailable`，不判产品失败且不替代自动gate。

验收项总数：**56**。

## 执行命令

### 状态、前置、限定diff与唯一owner

```bash
openspec status --change extract-typst-client-core --json
openspec instructions apply --change extract-typst-client-core --json
git diff --stat <baseline>..<implementation>
git diff --name-status <baseline>..<implementation>
pnpm --filter @univerjs/univer-workspace-client-core typecheck
rg -n 'workspaceError|WorkspaceApplicationError|WorkspaceResultUnknownError|WorkspaceUnitFeature|WorkspaceUnit' packages/client-core/src/index.ts packages/client-core/src
rg -n 'WorkspaceCompileTypstFeature|HeadlessWorkspaceTypstMaterializer|compileDocTypstBundle|withDeterministicRandom|UNIT_LIFECYCLE_METHODS|workspace-typst' packages/client-core/src apps/cli/src/features/typst apps/cli/src/program.ts
rg -n 'apps/cli|commander|JsonOption|DaemonClient|workspaceSessionPath|readWorkspaceCookie|process\.env|diagnosticsOut|writeFile|mkdir' packages/client-core/src --glob '*typst*.ts'
rg -n 'createWorkspaceContentRuntime|workspaceRuntimeKey|WorkspaceBlobFeature|WorkspaceAssetFeature|prepareDownload' packages/client-core/src --glob '*typst*.ts'
rg -n '@univerjs/univer-workspace-client-core/(src|dist)|packages/client-core/(src|dist)' apps packages --glob '*.ts' --glob '*.mjs'
git diff --check <baseline>..<implementation>
```

Typst owner搜索预期compiler/materializer/apply算法只在Core命中；CLI只允许command mapping、program composition和tests。Shell/remote runtime/Change 4/private-path搜索预期无Core产品命中。

### Core direct behavior

```bash
rg --files packages/client-core/test apps/cli/test | rg 'typst|command|workspace-cli'
pnpm --filter @univerjs/univer-workspace-client-core exec vitest run --config vitest.config.ts test/typst.test.ts
pnpm --filter @univerjs/univer-workspace-client-core exec vitest run --config vitest.config.ts test/typst-materialize.test.ts
pnpm --filter @univerjs/univer-workspace-client-core typecheck
pnpm --filter @univerjs/univer-workspace-client-core test
pnpm --filter @univerjs/univer-workspace-client-core build
```

若实现合并为一个test文件，QA记录实际路径并确认56项中的compile、gate、random/lifecycle/dispose/apply矩阵全部存在，不能因文件名不同跳过。

### CLI contract与built entrypoint

```bash
pnpm --filter univer-workspace-cli exec vitest run --config vitest.config.ts test/typst.test.ts test/application-command-contracts.test.ts
pnpm --filter univer-workspace-cli exec vitest run --config vitest.config.ts test/workspace-cli.test.ts -t 'Typst|arbitrary cwd'
pnpm --filter univer-workspace-cli typecheck
pnpm --filter univer-workspace-cli test
pnpm --filter univer-workspace-cli build
```

### Dependency、package与installed smoke

```bash
pnpm install --frozen-lockfile
node --test apps/cli/scripts/package-artifact.test.mjs
rg -n '@univer-cli/(doc-typst-facade|headless-univer)|@univerjs-pro/doc-typst-native-binding' packages/client-core/package.json apps/cli/package.json apps/cli/scripts/package-artifact.mjs pnpm-lock.yaml
pnpm package:workspace-cli
pnpm --filter univer-workspace-cli package:verify
pnpm --filter univer-workspace-cli package:smoke
rg -n 'workspace-typst|compile-typst|docMigration\.apply|doc-typst-native-binding' apps/cli/package-dist
rg -n '@univerjs/univer-workspace-client-core|packages/client-core|/Users/|\.\./\.\.' apps/cli/package-dist --glob '*.js' --glob 'package.json'
```

最后一条预期无workspace/private/checkout依赖；installed smoke必须由临时安装目录中的executable完成真实minimal bundle compile，不能只`require()` binding或运行monorepo entrypoint。

### 完整gate与hygiene

```bash
pnpm test:sdk-dependencies
pnpm typecheck
pnpm test
pnpm build
pnpm package:workspace-cli
pnpm --filter univer-workspace-cli package:verify
pnpm --filter univer-workspace-cli package:smoke
git diff --check <baseline>..<implementation>
git diff <baseline>..<implementation> | rg -n '(password|passwd|authorization:|cookie:|deviceCode|license.{0,16}(key|token)|BEGIN .*PRIVATE KEY)' || true
```

Hygiene命中必须人工判断；测试字段名可以出现，真实credential、Cookie、device code、license bytes与private key不得出现。

### 可选local Workspace smoke

先用无凭据TCP/HTTP探测检查`127.0.0.1:3020`。不可用时只记录`environment-unavailable`。可用时仍先运行compile-only；只有明确临时Space/Worktree fixture且凭据经安全stdin/environment注入时才运行apply。报告只记录命令类别、exit code与脱敏identity，不记录用户名、密码、Cookie、device code或license。

## 实现后证据记录

| AC | 证据（test/命令/文件与关键输出） | 结论 |
| --- | --- | --- |
| AC-01 | Core根入口实际导出三个既有error、`WorkspaceUnitFeature`及Typst feature/materializer；Changes 1–7最终QA均为0 open issue；Core typecheck exit 0。 | pass |
| AC-02 | fixed diff只扩展既有private Core package、`src/index.ts`与其manifest；未新增package或private subpath，root named exports可由typecheck/build消费。 | pass |
| AC-03 | `rg`检查Core两个Typst source未命中Commander、Session、daemon、CLI/filesystem/private path；input/result只含framework-neutral字段。 | pass |
| AC-04 | `rg --files apps/cli/src/features/typst`只剩`command.ts`；compile/materialize权威body移动到Core，CLI仅mapping与`program.ts`装配。 | pass |
| AC-05 | fixed name-status为18个文档、Core、CLI Typst/package与lock文件；Workspace Server/contracts、Session、daemon、Office/SVG/screenshot/lint均无产品diff。 | pass |
| AC-06 | source审查只见compile function substitution、materializer interface与共享Unit feature；无registry/container/filesystem provider/cache/compatibility layer。 | pass |
| AC-07 | Core `typst.test.ts`直接断言每次compiler 1调用、bundle逐字透传及options exact `{}`/`{previewDir}`。 | pass |
| AC-08 | compile-only fixture断言compiler完整字段与引用保留，只增加`committed:false`，无`unit`；materialize/create 0。 | pass |
| AC-09 | Core direct matrix覆盖undefined、相对、含空格、absolute previewDir及preview字段原样返回。 | pass |
| AC-10 | compile-only error fixture成功返回完整errors/warnings/artifacts，`committed:false`，Workspace副作用0。 | pass |
| AC-11 | compiler rejection direct test证明同一error传播，materializer/create 0且无重试。 | pass |
| AC-12 | compile-only测试以call count证明不创建runtime/Unit；Core source无HTTP/auth/daemon/Session/license或文件写入owner。 | pass |
| AC-13 | direct fixture包含额外compiler字段、nested diagnostic/preview并按引用与值逐项断言未改写。 | pass |
| AC-14 | mixed diagnostic测试得到既有`workspace-typst-diagnostics`，detail exact `{diagnostics: errors}`且message count等于error数。 | pass |
| AC-15 | mixed warning+error保持errors原顺序，warning不进detail；compile 1、materialize/create 0。 | pass |
| AC-16 | warning-only与无diagnostic路径均用同一次结果完成materialize/create各1，success保留完整compiler字段。 | pass |
| AC-17 | materializer输入直接等于第一次compile的exact JavaScript/target，测试观测无bundle重读或第二次compile。 | pass |
| AC-18 | materializer/create reject、mismatch、result-unknown tests均断言compile 1、materialize最多1、create最多1，无重放。 | pass |
| AC-19 | materializer direct test捕获factory exact `{license:""}`、runtime exact target与`UNIVER_DOC`，且没有Shell/remote runtime参与。 | pass |
| AC-20 | valid fixture只允许一次`createDocument`并委托真实Facade一次；fix复验进一步证明参数、调用次数与target identity均在委托前检查。 | pass |
| AC-21 | 六个prohibited methods逐项fixture返回既有runtime-contract error，并断言后续save/Workspace create 0。 | pass |
| AC-22 | fix direct matrix覆盖zero、missing/empty/blank、target后missing/blank、无参数/null/primitive；全部在无效委托前返回stable coded error并dispose 1。 | pass |
| AC-23 | same-id与different-id multiple create均在第二次委托前拒绝；真实headless探针确认same target twice不再泄漏上游uncoded error。 | pass |
| AC-24 | wrong single Unit id在Facade 0调用时直接返回runtime-contract error，不保存wrong Unit或改写compiler target。 | pass |
| AC-25 | `getDocument(target)`为null的direct case拒绝，save/create 0且dispose 1。 | pass |
| AC-26 | save返回null/array/primitive/empty/missing-id/wrong-id矩阵全部拒绝，Workspace create 0、dispose 1。 | pass |
| AC-27 | valid save对完整nested data保真，只规范化`id=target`、`rev=1`；已有/缺失rev fixture结果一致。 | pass |
| AC-28 | name precedence direct matrix覆盖saved name、saved title与省略；选中值未trim。 | pass |
| AC-29 | native与fake runtime重复materialize测试消费Math/crypto random并比较完整结果，独立invocation输出exact相等。 | pass |
| AC-30 | source及direct tests证明seed只读generated JavaScript稳定bytes；不读time/process/env/target，zero-hash fallback产生有效序列。 | pass |
| AC-31 | success、program throw、contract failure及原property不存在cases逐项比较Math/crypto完整descriptor；fix后真实headless七类失败探针也逐例比较descriptor exact恢复。 | pass |
| AC-32 | success和所有失败矩阵断言dispose恰好一次且await后settle；fix新增无效/第二次create矩阵全部dispose 1，factory failure仍dispose 0。 | pass |
| AC-33 | apply direct test捕获共享`WorkspaceUnitFeature.create()`一次，`initialData`与materializer返回exact相同，type=`doc`。 | pass |
| AC-34 | direct name matrix证明materialized non-empty name优先，否则compiled title；target id未被当作name。 | pass |
| AC-35 | apply tests断言Space/Worktree/parent/idempotency exact透传，optional省略与含空格值均未生成或trim。 | pass |
| AC-36 | success fixture令Server Unit identity不同于compiled target，结果仍返回完整compiler fields、`committed:true`与exact Server Unit。 | pass |
| AC-37 | shared create mismatch直接原样传播；Typst测试断言无committed result及无compile/materialize/create重放。 | pass |
| AC-38 | `WorkspaceResultUnknownError` identity/detail原样传播，call counts固定1/1/1。 | pass |
| AC-39 | ordinary create failure同样无重放；materializer fixture证明runtime已在create前dispose完成。 | pass |
| AC-40 | Core API/source无Session/daemon；认证仍由program注入的shared Unit owner提供，apply只接收bundle/preview/target identity。 | pass |
| AC-41 | CLI command source审查与command-contract tests证明名称、argument、全部options/description及Commander形态未变。 | pass |
| AC-42 | CLI三条validation-order focused cases均在feature/file 0调用前返回预期exact message。 | pass |
| AC-43 | CLI fixture捕获Core exact bundle/preview与仅apply时创建的target；Shell输出字段未进入Core input。 | pass |
| AC-44 | CLI direct test断言recursive parent、UTF-8及program exact bytes；apply无out不写program。 | pass |
| AC-45 | diagnostics文件为2-space JSON、schemaVersion 1、exact diagnostics与单一尾随newline，额外字段保留。 | pass |
| AC-46 | write-failure tests证明program→diagnostics→presentation顺序；validation/Core/out/diagnostics各失败点没有后续写入或success。 | pass |
| AC-47 | JSON tests断言exact公开字段与optional out/unit；compile-only errors仍走success JSON且不泄露JavaScript/title。 | pass |
| AC-48 | text tests逐字断言compile-only与apply两种行，分别使用out、Server Unit id、compiled target和Worktree。 | pass |
| AC-49 | CLI focused/full tests覆盖argument、diagnostic、create与file coded error/stdout/stderr/exit；diff hygiene仅命中设计文字与防泄露断言，无secret literal。 | pass |
| AC-50 | built-entrypoint arbitrary-cwd测试2/2通过；package installed smoke又从临时cwd使用相对bundle完成真实compile-only。 | pass |
| AC-51 | Core exact声明facade/headless；CLI已移除facade，保留其对既有formula packaging仍直接使用的headless依赖；distribution精确externalizenative binding。 | pass |
| AC-52 | package artifact tests 9/9覆盖Core owner、resolved facade version、binding缺失/workspace等negative cases；frozen install显示Already up to date。 | pass |
| AC-53 | package build/verify通过；artifact closure search未命中bare Core、Core source、absolute checkout或parent traversal，Core Typst已内联。 | pass |
| AC-54 | 产物manifest包含exact native binding；artifact negative tests验证owner/binding损坏失败，installed smoke加载真实binding无JS/system fallback。 | pass |
| AC-55 | `package:smoke`在临时install/arbitrary cwd创建真实minimal bundle，installed executable返回0并验证`committed:false`、target、program apply与schema 1 diagnostics。 | pass |
| AC-56 | 初次完整gate保持通过；fix复验Core focused 47/47、full 385/385、typecheck/build，CLI focused 17/17+built 2/2与typecheck，package build/verify/installed smoke、artifact 9/9及fix diff-check全部exit 0。原CLI/root合同未受影响。 | pass |

## 实际命令与结果摘要

| 命令 | 结果 |
| --- | --- |
| `openspec status --change extract-typst-client-core --json`；`openspec instructions apply --change extract-typst-client-core --json` | artifacts complete；6/6 tasks checked，仅作规划交叉检查 |
| `pnpm --filter @univerjs/univer-workspace-client-core exec vitest run --config vitest.config.ts test/typst.test.ts test/typst-materialize.test.ts test/typst-native.test.ts` | 3 files，42/42 pass |
| `pnpm --filter univer-workspace-cli exec vitest run --config vitest.config.ts test/typst.test.ts test/application-command-contracts.test.ts` | 2 files，17/17 pass |
| `pnpm --filter univer-workspace-cli exec vitest run --config vitest.config.ts test/workspace-cli.test.ts -t 'Typst|arbitrary cwd'` | 2/2 selected pass |
| Core `typecheck` / `test` / `build` | exit 0；21 files，380/380 pass |
| CLI `typecheck` / `test` / `build` | exit 0；16 files，70/70 pass；artifact tests 9/9 pass |
| `pnpm install --frozen-lockfile` | exit 0；workspace already up to date |
| CLI `package` / `package:verify` / `package:smoke` | exit 0；203 files；installed tarball commands passed，包含真实minimal Typst compile |
| `pnpm typecheck` / `pnpm test` / `pnpm build` | 全部exit 0；root test还覆盖SDK 4/4、release 8/8、reference-provider 16/16、Workspace 152/152 |
| fixed `git diff --check`、name/scope/owner/private-import/artifact searches | exit 0或预期no-match；server/contracts无diff、CLI旧owner已删除、artifact无workspace/private checkout引用 |
| diff secret hygiene | 两个命中均为设计文字或`deviceCode`防泄露测试断言；无credential/Cookie/device code/license/private key值 |
| unauthenticated `curl --fail --max-time 2 http://127.0.0.1:3020/api/auth/whoami` | exit 7；`environment-unavailable`，未读取或使用测试凭据 |

## SPEC-01 fix复验

Review指出初次QA对AC-22/23的证据不完整：旧guard只记录non-empty identity，并在真实Facade委托后检查总数，因此target后missing/blank可能成功，同target二次调用可能先抛上游uncoded error。fix把参数形态、调用次数与target identity检查移到委托前；以下补充矩阵独立验证closure。

| 补充项 | 行为与观察点 | 证据 | 结论 |
| --- | --- | --- | --- |
| SUP-01 | target后missing ID | direct test观测第一次Facade调用1次，第二次0委托；stable `workspace-typst-runtime-contract`、detail只含首个target、getDocument 0、dispose 1。真实headless探针得到同一code。 | pass |
| SUP-02 | target后blank ID | 与SUP-01相同，第二次invalid调用不进入真实Facade；真实headless探针得到stable coded error。 | pass |
| SUP-03 | same target twice | direct test观测Facade总调用1次，第二次在委托前拒绝；真实headless探针不再得到`cannot create a unit`上游Error，而得到Core既有code。 | pass |
| SUP-04 | 无参数、`null`、primitive | 三种direct cases均Facade 0、getDocument 0、dispose 1、detail `{createdUnitIds:[]}`；真实headless三例均得到既有code。 | pass |
| SUP-05 | wrong target | direct case在Facade 0调用时拒绝并记录wrong identity；真实headless探针得到既有code，不创建wrong Unit。 | pass |
| SUP-06 | 委托顺序与错误稳定性 | source diff只有一个前置guard：先递增调用计数、解析record/id，再验证first/exact target，合法时才调用`target.createDocument()`；postcondition仍保留。 | pass |
| SUP-07 | dispose与deterministic random恢复 | verbose materializer 32/32覆盖每个invalid case dispose 1及descriptor tests；真实headless七例逐项assert Math.random/crypto完整descriptor恢复。 | pass |
| SUP-08 | 回归、scope与delivery | fix仅2文件、61 insertions/18 deletions且`git diff --check`通过；Core 47/47及385/385、CLI 17/17+built 2/2、typechecks/build、artifact 9/9、package verify与installed smoke全部通过；secret search无命中。 | pass |

实际复验命令：

```text
pnpm --filter @univerjs/univer-workspace-client-core exec vitest run --config vitest.config.ts test/typst.test.ts test/typst-materialize.test.ts test/typst-native.test.ts
pnpm --filter @univerjs/univer-workspace-client-core exec vitest run --config vitest.config.ts test/typst-materialize.test.ts --reporter=verbose
pnpm --filter @univerjs/univer-workspace-client-core test
pnpm --filter @univerjs/univer-workspace-client-core typecheck
pnpm --filter @univerjs/univer-workspace-client-core build
pnpm --filter univer-workspace-cli exec vitest run --config vitest.config.ts test/typst.test.ts test/application-command-contracts.test.ts
pnpm --filter univer-workspace-cli exec vitest run --config vitest.config.ts test/workspace-cli.test.ts -t 'Typst|arbitrary cwd'
pnpm --filter univer-workspace-cli typecheck
pnpm --filter univer-workspace-cli package
node --test apps/cli/scripts/package-artifact.test.mjs
pnpm --filter univer-workspace-cli package:verify
pnpm --filter univer-workspace-cli package:smoke
git diff --check 188e0ce49824dbabf19889aa6fec2723fb15e2ca..4e2b8d5b7c18b3bfd99c5adf1a1231c0e4a92905
```

另以built Core和真实headless runtime执行七类无效program探针，逐项assert既有code与Math/crypto descriptor恢复；命令只含静态fixture，不读取Session、credential或环境secret。

## QA issues

| ID | 严重度 | 证据（文件/命令/输出） | 期望 | 状态 |
| --- | --- | --- | --- | --- |
| TYPST-QA-001 / review SPEC-01 | medium | 初次实现的guard在真实Facade委托后检查count，review probe证明target后missing/blank错误成功、same target twice泄漏上游uncoded error；fix diff改为委托前检查，SUP-01–08及真实headless探针全部通过。 | 每次无效或第二次`createDocument`都在真实Facade调用前返回稳定`workspace-typst-runtime-contract`，同时保持dispose/random恢复。 | closed |

当前 **0 open issue**。
