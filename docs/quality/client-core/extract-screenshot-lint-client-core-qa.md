# extract-screenshot-lint-client-core QA

本文件记录 Change `extract-screenshot-lint-client-core` 的实现后验收。固定 baseline 为 `7e53844aa8a90950479f30382259e17dc6ec7529`，初始implementation为 `8ee94b17a949394b18c47c587613d6c34cf3045a`，SPEC-01/02 fix为`0098f00d4d6f0837084555a8b5bb7eaa9c4de4b0`，OpenSpec final tree 为 `49af8e48e71985e063599fbba73814939550f501`。结论：原矩阵 **74/74 pass**，补充矩阵 **12/12 pass**，**0 open issue，Ready**。

## 基线、边界与主要风险

- 实现后QA必须记录固定 baseline/implementation tree，只审查该区间，并独立运行测试；tasks勾选或implement汇报不能替代证据。
- Changes 4、5、6 的 `resolveWorkspaceAssetContent`、`WorkspaceContentSource`/runtime target/reference operations 与 `WorkspaceContentRuntimeOperations.exportUnitData()` 是直接前置。缺少任一public seam时停止，不得复制Asset、target/reference、UnitData export或HTTP owner。
- Client Core成为Workspace render Unit assembly、screenshot capture、PNG writer、Slide layout lint和render-page source的唯一owner。CLI保留Commander preset、Session/auth、daemon RPC adapter、license/config、browser install/probe/resolve、process/entrypoint与artifact layout。
- SVG compile、字体测量与apply仍在CLI，并继续消费CLI artifact中的同一`dist/render-runtime`，直到Change 10。
- 不引入renderer interface、browser pool、runtime registry、filesystem provider、generic download helper、service container、cache、并行scheduler、覆盖模式或新的cancellation contract。
- 主要风险是Host/reference identity校验变松、formula/Embed顺序变化、Worktree Asset改写污染source、Trunk误发Asset请求、browser失败后未await close、并发PNG覆盖、render page未进入tarball，以及Puppeteer依赖仍靠pnpm hoist解析。

## Spec scenario → 直接证据

实现可调整测试文件名；QA先以`rg --files`解析真实路径并记录。render assembly、capture/lint lifecycle和PNG安全必须由Core direct tests证明，CLI tests不能代替Core行为证据。

| OpenSpec scenario | 实现后必须存在的证据 | 最小命令 |
| --- | --- | --- |
| Client Shell supplies render dependencies | 显式target/reference/export/Asset/renderPage/license/env依赖；Core无CLI config/Session/daemon/presenter import | owner search + Core typecheck |
| Render operation finishes or fails | screenshot与lint分别覆盖success/failure/abort，并证明close完成后operation才settle | Core focused tests |
| Host has formula references | malformed matrix、trim/dedup/stable sort/self exclude、Sheet/Base gate、exact scope-relative resolve/export | Core render-loader test |
| Host has embedded Units | active/soft-delete、direct/ref identity、dedup/sort、self/formula overlap、loaded identity/type | Core render-loader test |
| Reference metadata is invalid | invalid JSON/envelope/identity/ResourceRef/type/exported UnitData逐项既有coded error，browser/Asset 0 | Core render-loader test |
| Worktree data has Asset identities | Host/formula/Embed UUID、shared dedup、exact Worktree、direct/serialized rewrite、source immutable | Core render-loader test |
| Trunk render data is loaded | UUID fixture仍Asset 0且render data未rewrite | Core render-loader test |
| Screenshot capture succeeds | exact runtime options、exact capture input、ordered image metadata与bytes、close awaited | Core screenshot test |
| PNG name/output invalid | native path component、`.`/`..`、pre-existing、commit race；existing bytes preserved | Core PNG test |
| PNG output committed | recursive mkdir、same-directory `0600` temp、hard-link exclusive commit、exact bytes、cleanup | Core PNG test |
| Slide layout inspected | exact Slide/reference input、pages/signal、ordered report、close awaited | Core lint test |
| Selected Unit is not Slide | Sheet/Doc/Base/Board均在runtime create前返回既有code | Core lint test |
| Installed render runtime complete/absent | Core page build、CLI copy、Puppeteer owner、verify negative cases、arbitrary-cwd installed surface | package tests + verify/smoke |
| Existing CLI contracts | screenshot/lint options、scope、daemon payload、license/browser setup、JSON/text/errors与SVG临时consumer | CLI focused tests |

## 验收标准

### 前置、owner 与scope

- **AC-01** apply前证明Changes 4、5、6的上述public exports从Client Core根入口真实可用，相关最终QA均0 open issue，且Core typecheck通过；缺失时不建立平行seam。
- **AC-02** screenshot/lint只加入现有private `@univerjs/univer-workspace-client-core`并从根入口提供必要named exports；不新增package、版本、public npm或private `src`/`dist` subpath contract。
- **AC-03** formula/Embed/Asset render assembly、capture、PNG writer、lint和render-page source在Core各有唯一owner；旧CLI `features/screenshot/screenshot.ts`、`features/lint/unit-layout-lint.ts`及`render-runtime`权威body删除，不留复制实现。
- **AC-04** Core source不导入`apps/cli`、Commander、CLI errors/config/license/Session、daemon/`JsonValue` RPC、CLI private path、presenter、browser setup command或process-global render path；license、env、render page、target/reference/export/Asset能力均显式注入。
- **AC-05** 实现只保留现有窄runtime constructor substitution与结构化operations；不新增renderer/filesystem/credential interface、runtime factory hierarchy、browser pool/registry、service container、cache、queue、force overwrite或大compatibility layer。
- **AC-06** fixed diff不修改Workspace Server/Browser/HTTP/Collaboration contract、target/reference/Asset/content-runtime行为、SVG owner、Puppeteer下载目录/选择策略、CLI command surface、Session、SDK baseline或release渠道。
- **AC-07** Core直接声明实际使用的exact-baseline render/lint/screenshot/page dependencies；CLI只保留Shell、command、browser setup、SVG和delivery仍直接使用的依赖，不以“去重”为由搬迁SVG或改变dependency owner。

### Host 与formula reference assembly

- **AC-08** missing/undefined/empty/blank Host Unit id沿用`workspace-screenshot-target-required`与既有message，并在source open、target resolve、export、Asset和browser前失败；合法ID保持既有trim语义。
- **AC-09** Trunk调用exact `resolveTrunkRuntimeTarget({unitId})`一次；Worktree调用exact `resolveRuntimeTarget({unitId,worktreeId})`一次。returned target的origin/revision/scope/unitId/unitType逐字用于后续，不自行重解析或猜测revision。
- **AC-10** Host `exportUnitData({target})`恰好一次；null、array、primitive、missing/empty/wrong `id`均返回既有`workspace-screenshot-unit-data-invalid`，reference/Asset/browser 0调用，错误不包含完整UnitData。
- **AC-11** target resolve或Host export的coded/network failure原样传播且立即停止；不fallback到另一scope/type，不重试或返回partial render Unit。
- **AC-12** missing/non-array`resources`视为无formula/Embed；合法Host返回exact `unitType`和原始UnitData引用/值，空`formulaReferenceUnits`与`embeddedUnits`字段保持既有omission语义。
- **AC-13** `UNIVER_EXTERNAL_REFERENCE_PLUGIN`逐项严格解析：non-string data、non-JSON、array/non-record root、missing/non-record `references`均返回`workspace-screenshot-reference-resource-invalid`及现有bounded detail。
- **AC-14** 每个formula reference必须为record且`sourceUnitId`为non-empty string；missing、wrong primitive、empty/blank逐项拒绝，合法值按既有trim语义形成identity。
- **AC-15** 多个resources/keys中的formula IDs全局去重并按既有JavaScript lexical order稳定排序；Host self identity排除。fixture覆盖输入key顺序相反、重复、两侧空格与self。
- **AC-16** 对每个保留ID按稳定顺序调用exact `resolveReferencedRuntimeTarget({hostTarget,unitId})`一次，再调用exact `exportUnitData({target:referenceTarget})`一次；不得以Host scope手工构造reference target。
- **AC-17** formula source只接受`sheet|base`；Doc/Slide/Board及malformed/unsupported target type沿用`workspace-screenshot-reference-unit-type-unsupported`并在该reference export、Asset和browser前失败。
- **AC-18** 每个formula export同样严格要求returned UnitData为record且`id === referenceTarget.unitId`；invalid/wrong identity沿用screenshot UnitData error，已完成的前序reads不触发重放。
- **AC-19** assembled `formulaReferenceUnits`顺序等于稳定ID顺序，逐项只含resolved target `unitType`与exact exported UnitData；self-only/empty时字段省略，source数据不被改写。

### Embed discovery、identity 与组合

- **AC-20** `UNIVER_EMBED_RESOURCE_PLUGIN`对non-string data、non-JSON、array/non-record root、missing/non-record `embeds`返回`workspace-screenshot-embed-resource-invalid`；formula/reference/Asset/browser不继续。
- **AC-21** Embed descriptor必须为record；active descriptor可从direct `childUnitId`或既有string/object `source.ref` ResourceRef取得non-empty selector。missing/empty/blank selector、malformed ref、missing unit selector均返回既有Embed coded error。
- **AC-22** `lifecycle === "soft-deleted"`的descriptor完全忽略，即使其child identity不可用也不resolve/export；active及既有非soft-deleted值保持当前active语义，不擅自新增lifecycle enum gate。
- **AC-23** active child IDs跨resources全局去重并按既有lexical order稳定排序；fixture覆盖duplicate direct/ref representations和输入key顺序变化。
- **AC-24** Host self Embed排除；与formula ID重复的Embed排除且只作为formula source resolve/export一次，formula与Embed arrays中不得出现重复Unit。
- **AC-25** 每个保留Embed用exact `{hostTarget,unitId}`走共享scope-relative resolver；returned target identity/type及ResourceRef声明的selector/type必须满足现有严格合同，wrong Unit/type不得静默采用。
- **AC-26** Embed export按稳定顺序exact一次且严格校验record与loaded Unit identity；结果逐项保留resolved supported Unit type和exact UnitData，空集合省略`embeddedUnits`。
- **AC-27** Host、formula、Embed组合保持Host-first读取和各自稳定数组顺序；任一后续resolve/export失败时返回同一error，capture与PNG writer 0调用，不伪造不完整render input。
- **AC-28** assembly全程read-only：在Asset rewrite前后对Host/reference/Embed export fixtures做deep equality/frozen-object验证，不向source UnitData写入formula/Embed辅助字段。

### Worktree render-copy Asset resolution

- **AC-29** 仅当resolved Host target scope为Worktree时，把完整Host+formula+Embed render Unit交给现有`resolveUnitScreenshotImageAssets`语义；每个Asset lookup都携带该Host target的exact `worktreeId`。
- **AC-30** Host、formula与Embed中相同UUID-backed Asset全局去重，distinct Asset请求顺序稳定；同一identity只调用shared Asset content capability一次，不按Unit重复下载。
- **AC-31** direct image fields与`resources[].data`内序列化UUID images均改写为现有`BASE64` representation、exact media type/base64 bytes；non-UUID、ordinary strings和unrelated resource JSON逐字不变。
- **AC-32** rewrite只作用于render copy；原Host、formula与Embed UnitData的object graph和serialized resource bytes保持deep-equal，frozen source fixture不抛mutation error。
- **AC-33** missing Asset、invalid content metadata/length、HTTP/coded/abort failure沿用Change 4/shared resolver语义并停止render；不得返回UUID残留的partial success、fallback空bytes或泄露signed URL/Cookie。
- **AC-34** Trunk Host即使Host/reference/Embed包含UUID images也发出0个Asset请求，不做BASE64 rewrite，并返回与assembly结果相同的数据；reference自身偶然为Worktree target也不能改变Host scope规则。

### Screenshot capture 与browser lifecycle

- **AC-35** 每次capture显式创建一个runtime，constructor options exact包含caller `renderPageRoot`、已解析license、原`env`引用及仅在提供时出现的exact AbortSignal；Core不调用Shell license resolver或读取`process.env`/config。
- **AC-36** Core把完整target-neutral capture input（Unit type/data、formula/Embed references、target selector及signal）exact传给`createUnitScreenshot({runtime}).capture()`一次，不filter、serialize或再次load Unit。
- **AC-37** success返回exact `unitId`、`unitType`及原顺序images；每张image的name/mediaType/width/height和`Uint8Array` bytes逐项保持，不排序、不转base64、不丢buffer view offset。
- **AC-38** success路径在返回result前await `runtime.close()`恰好一次；deferred-close fixture证明close未resolve时capture promise不settle。
- **AC-39** render/capture ordinary或coded failure原样传播，并在reject前await close一次；不得以partial images继续write或presentation。
- **AC-40** already-aborted与operation期间abort均传递同一signal并在reject前close一次；不新增独立cancellation controller或吞掉AbortError。
- **AC-41** runtime constructor失败时不伪造close；close自身失败及capture+close同时失败保持既有settlement/error precedence。每次operation独立runtime，无singleton、reuse或pool。

### Node-hosted PNG output

- **AC-42** destination以显式`cwd`或operation时Node cwd为基准解析；默认目录仍为`screenshots`，显式相对/absolute destination保持既有`resolve`语义，并递归创建缺失父目录。
- **AC-43** 每个name必须是当前平台safe basename且不能为`.`/`..`；slash/native separator path、parent traversal、absolute path逐项沿用`workspace-screenshot-output-invalid`，在任何temp/destination写入前失败。
- **AC-44** 所有image names和所有pre-existing destinations先完成全量preflight，再提交第一张；后项unsafe或已存在时前项仍未写入。writer result数量/name顺序必须与capture result exact对应。
- **AC-45** 每张image先在destination同目录创建不可预测、exclusive `wx` temp，mode exact `0600`；stat验证temp权限，名称不暴露到public result，且不使用跨目录rename。
- **AC-46** commit继续通过non-replacing hard link（或字节等价的既有exclusive机制）完成；success destination为`0600`且bytes与原`Uint8Array` view exact相同，返回`{name,location}`顺序与images一致。
- **AC-47** destination在preflight前已存在时返回`workspace-screenshot-output-exists`且原bytes/mode不变；不提供`--force`或unlink replacement。
- **AC-48** destination在temp写入后、commit前由竞争者创建时映射同一existing error，竞争者bytes/mode保持，temp清理；fixture必须真实制造link race而非只mock initial access。
- **AC-49** temp write/link/ordinary filesystem error和success后均清理该operation的temp；不删除无关同名pattern文件，也不吞掉非`ENOENT`/非`EEXIST`错误。
- **AC-50** 多图片仍按既有顺序非事务提交：后续图片在commit阶段失败时，已提交前序图片保留，未开始后项不存在，所有temps清理；不得新增rollback或伪装全有全无。
- **AC-51** PNG writer不复用Change 4的download target、remote metadata/stream-length、force rename或通用filesystem abstraction；只保留本地screenshot result合同。

### Slide layout lint

- **AC-52** 共享loader返回Sheet/Doc/Base/Board时均在browser runtime create前返回exact `workspace-unit-layout-lint-unit-type-unsupported`与现有message；不得先capture再检查或新增Trunk CLI语义。
- **AC-53** Slide path向`createUnitLayoutLint({runtime}).lint()`传exact Slide UnitData、formulaReferenceUnits、page selectors及signal；Embed仍可用于render assembly，但lint input shape不得伪造unsupported字段。
- **AC-54** lint runtime constructor显式接收exact renderPageRoot/license/env和optional signal，每次lint独立创建一次；license不由Core自行读取或fallback。
- **AC-55** success返回existing target-neutral report：kind、Unit identity/type、coverage及ordered findings/detail逐字保留；JSON/text formatting仍由upstream CLI command owner完成。
- **AC-56** lint success、runtime/capture failure和abort均在settle前await close恰好一次；constructor failure不close，close failure/error precedence与screenshot保持既有语义。

### Core render page source与build asset

- **AC-57** render page HTML、bootstrap和Vite config只在Client Core有一个source owner；CLI不保留第二份source，只从Core build output复制version-matched静态资产。
- **AC-58** bootstrap继续查询exact `#app`、调用`mountUniverRenderPage`一次并用`createPresetRenderUniver(context)`；missing container与missing license bootstrap保持现有fail-fast error。
- **AC-59** HTML保持UTF-8、module bootstrap、本地relative script和`#app` 1600×1000；html/body margin/width/height/overflow现有样式不变。
- **AC-60** Core Vite build使用`base:"./"`、stable render-page outDir、`sourcemap:false`、现有`process.env` replacement与chunk limit；从arbitrary directory以`file:`/local server加载时所有asset URLs保持relative。
- **AC-61** Core build产出`index.html`和非空local assets closure；无`.map`、`.ts`、remote CDN/runtime URL、absolute checkout path或unresolved workspace/private package import。
- **AC-62** Core typecheck/build静态检查实际打开built `index.html`并验证引用文件存在；删除index或任一referenced asset时Core/CLI copy或package verify必须失败，不以source page存在代替build证据。

### Workspace CLI compatibility、SVG临时consumer与artifact

- **AC-63** screenshot仍公开target-neutral preset全部options/validation（unit、pages/contact/tile、sheet/range、region/elements/padding/scale、out/json和`setup`），并增加互斥`--worktree`/`--trunk`；missing/blank scope沿用`workspace-screenshot-scope-required`，out description/default不变。
- **AC-64** lint仍使用upstream`lint` command、`--unit`/`--pages`/`--json`及required `--worktree`，按既有trim映射exact Worktree scope；Commander validation order、exit code与stdout/stderr不变。
- **AC-65** CLI composition只适配Core operations：daemon exact一次发送`runtime.export-unit-data`与`{target}`、authenticated source提供target/reference/Asset，Shell解析license/env/render path；Session/auth时机和daemon wire payload不增加字段。
- **AC-66** `screenshot setup`的install/probe/resolve仍由CLI以existing env和Puppeteer cache/platform policy调用；resolved/installed JSON/text与coded setup errors保持，不移入Core。
- **AC-67** screenshot JSON exact保持`{ok:true,unitId,unitKind,outputs}`且outputs保留metadata/location但不含bytes；text保持ordered absolute/既有location lines。lint JSON为完整report，text逐字等于`renderUnitLayoutLint`；Workspace/upstream coded errors与presentation顺序不变。
- **AC-68** `main.ts`仍从installed app root解析exact `dist/render-runtime`并显式传入program；built entrypoint从arbitrary cwd加载screenshot/lint surface。SVG text-measure仍使用同一路径、Shell license/env与lazy runtime，并通过现有no-text/real-text/close tests。
- **AC-69** packaging从Client Core真实declared `@univer-cli/univer-render-runtime` owner解析`puppeteer-core`与`@puppeteer/browsers`，并核对resolved runtime version；tests覆盖Core owner missing/`workspace:*`、resolved mismatch、runtime missing/`workspace:*` Puppeteer deps，不能依赖CLI direct dep或hoist猜测。
- **AC-70** `pnpm install --frozen-lockfile`通过且single exact SDK baseline不变；build graph先完成Core render page，再构建CLI并把Core output复制到既有`apps/cli/dist/render-runtime`，SVG与main无需布局兼容层。
- **AC-71** package build/verify证明tarball含`dist/render-runtime/index.html`及完整assets、external exact Puppeteer deps和bundled Core workflow；不含bare Client Core、Core source/test、`.ts/.map`、workspace specifier、absolute/相邻checkout path。删除page/asset/dependency的negative fixture必须失败。
- **AC-72** installed smoke在临时install root和arbitrary cwd加载`screenshot --help`、`screenshot setup --help`、`lint --help`及built owner，检查copied page/assets和Puppeteer resolution而不依赖monorepo。可用的hermetic fixture验证surface启动；不得下载浏览器或用系统偶然依赖冒充closure。
- **AC-73** Core focused/full typecheck/test/build、CLI screenshot/lint/SVG/built-entrypoint/full typecheck/test/build、root SDK dependency/typecheck/test/build、frozen install、package artifact/build/verify/installed smoke与fixed `git diff --check`全部exit 0；owner/scope/asset searches满足AC-01–07、57–72。
- **AC-74** fixed diff和artifact secret hygiene不包含Session Cookie、用户名/密码、device code、license bytes、signed Asset URL、private key或测试账号。本地`127.0.0.1:3020`不可用时authenticated screenshot/lint smoke记`environment-unavailable`，不使用凭据、不判产品失败且不替代自动gate。

验收项总数：**74**。

## 执行命令

### 状态、前置、限定diff与owner

```bash
openspec status --change extract-screenshot-lint-client-core --json
openspec instructions apply --change extract-screenshot-lint-client-core --json
git diff --stat <baseline>..<implementation>
git diff --name-status <baseline>..<implementation>
rg -n 'resolveWorkspaceAssetContent|WorkspaceContentSource|resolveReferencedRuntimeTarget|exportUnitData|WorkspaceRuntimeTarget' packages/client-core/src/index.ts packages/client-core/src
rg -n 'WorkspaceScreenshot|WorkspaceUnitLayoutLint|workspace-screenshot|renderPageRoot|createUniverRenderRuntime|resolveUnitScreenshotImageAssets' packages/client-core/src apps/cli/src apps/cli/render-runtime
rg -n 'commander|Session|daemon|JsonValue|apps/cli|features/screenshot|features/lint|resolveUniverLicense|process\.env' packages/client-core/src --glob '*screenshot*.ts' --glob '*lint*.ts' --glob '*render*.ts'
rg -n '@univerjs/univer-workspace-client-core/(src|dist)|packages/client-core/(src|dist)' apps packages --glob '*.ts' --glob '*.mjs'
git diff --check <baseline>..<implementation>
```

唯一owner搜索预期Core包含assembly/capture/PNG/lint/page source；CLI只包含commands、program/main、browser setup、SVG consumer和artifact copy。禁止import搜索预期无Core产品命中。

### Core direct behavior

```bash
rg --files packages/client-core/test apps/cli/test | rg 'screenshot|layout|lint|render|svg'
pnpm --filter @univerjs/univer-workspace-client-core exec vitest run --config vitest.config.ts test/<render-loader-test>.test.ts test/<screenshot-test>.test.ts test/<png-output-test>.test.ts test/<layout-lint-test>.test.ts
pnpm --filter @univerjs/univer-workspace-client-core typecheck
pnpm --filter @univerjs/univer-workspace-client-core test
pnpm --filter @univerjs/univer-workspace-client-core build
find packages/client-core/<built-render-page> -maxdepth 3 -type f -print
```

测试文件可合并，但QA必须逐项记录Host/formula/Embed/Asset、capture三种settlement、PNG真实race/mode/cleanup、lint gate/lifecycle和static page closure证据，不能因文件名不同跳过。

### CLI parity与SVG consumer

```bash
pnpm --filter univer-workspace-cli exec vitest run --config vitest.config.ts test/workspace-screenshot.test.ts test/workspace-unit-layout-lint.test.ts
pnpm --filter univer-workspace-cli exec vitest run --config vitest.config.ts test/svg-text-measurer.test.ts test/workspace-compile-svg.test.ts
pnpm --filter univer-workspace-cli exec vitest run --config vitest.config.ts test/workspace-cli.test.ts -t 'screenshot|lint|arbitrary cwd'
pnpm --filter univer-workspace-cli typecheck
pnpm --filter univer-workspace-cli test
pnpm --filter univer-workspace-cli build
```

### Dependency、render asset与installed artifact

```bash
pnpm install --frozen-lockfile
node --test apps/cli/scripts/package-artifact.test.mjs
rg -n '@univer-cli/(unit-screenshot|unit-layout-lint|univer-render-runtime|univer-render-page)|puppeteer-core|@puppeteer/browsers' packages/client-core/package.json apps/cli/package.json apps/cli/scripts/package-artifact.mjs pnpm-lock.yaml
pnpm package:workspace-cli
pnpm --filter univer-workspace-cli package:verify
pnpm --filter univer-workspace-cli package:smoke
find apps/cli/package-dist/dist/render-runtime -maxdepth 3 -type f -print
rg -n '@univerjs/univer-workspace-client-core|packages/client-core|workspace:|/Users/|\.\./\.\.' apps/cli/package-dist --glob '*.js' --glob 'package.json'
find apps/cli/package-dist/dist/render-runtime -type f \( -name '*.map' -o -name '*.ts' \) -print
```

最后两条预期无private/workspace/checkout/source-map依赖。实现后QA还要执行缺失render page、缺失referenced asset、Core runtime owner缺失/版本不匹配及Puppeteer dependency缺失的negative package tests。

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
git diff <baseline>..<implementation> | rg -n '(password|passwd|authorization:|cookie:|deviceCode|license.{0,16}(key|token)|signedUrl|BEGIN .*PRIVATE KEY)' || true
```

Hygiene命中必须人工判断；字段名和防泄露断言可以出现，真实credential、Cookie、device code、license bytes、signed URL与private key不得出现。

### 可选local Workspace smoke

先无凭据探测`127.0.0.1:3020`。不可用时只记`environment-unavailable`。可用时仍需明确临时Space/Worktree/Unit和browser fixture；凭据仅经安全environment/stdin提供，报告只记录命令类别、exit code与脱敏identity，不记录用户名、密码、Cookie、device code、license或signed Asset URL。该smoke不能替代自动化Core/CLI/package gate。

## 实现后证据记录

| AC | 证据（test/命令/文件与关键输出） | 结论 |
| --- | --- | --- |
| AC-01 | `src/index.ts`导出既有target/reference/content/Asset seam与新增render/screenshot/lint owner；Core full 429/429。 | pass |
| AC-02 | `git diff --name-status`显示CLI旧`screenshot.ts`、`lint/unit-layout-lint.ts`及render-runtime source删除，Core成为唯一owner。 | pass |
| AC-03 | owner/import `rg`无Core对Commander、Session、daemon、CLI feature或private Core path的产品命中。 | pass |
| AC-04 | `render-unit.ts`直接组合现有`WorkspaceContentSource`和`exportUnitData`，未新增transport/auth/reference owner。 | pass |
| AC-05 | 固定产品diff 34 files、1368 additions/873 deletions；`apps/workspace`与contracts无产品diff。 | pass |
| AC-06 | source/API审查未发现renderer/filesystem provider、browser pool、service container、cache或并行scheduler。 | pass |
| AC-07 | CLI保留Commander/browser setup/license/daemon adapter/entrypoint；Core只接收显式依赖。 | pass |
| AC-08 | `render-unit.test.ts`及额外built-Core probe覆盖missing/blank target、trim和resolve前gate。 | pass |
| AC-09 | 额外probe逐字断言Trunk `{unitId}`与Worktree `{unitId,worktreeId}`各一次，另一resolver 0调用。 | pass |
| AC-10 | 额外probe覆盖Host `null/array/primitive/string/missing/empty/wrong id`，均为既有code且reference 0调用。 | pass |
| AC-11 | loader source及focused tests证明resolve/export error立即传播，无scope/type fallback或重放。 | pass |
| AC-12 | loader source保持missing/non-array resources为空，并只在非空时附加formula/Embed字段。 | pass |
| AC-13 | `render-unit.test.ts`malformed formula table覆盖non-string、bad JSON、array root及missing/non-record references。 | pass |
| AC-14 | 同一table覆盖missing/non-string/empty/blank `sourceUnitId`及trim语义。 | pass |
| AC-15 | direct test覆盖反序key、跨resource trim/dedup/self exclude和lexical order。 | pass |
| AC-16 | direct test断言稳定次序下exact `{hostTarget,unitId}`及逐项export调用。 | pass |
| AC-17 | Doc/Slide/Board formula target table逐项返回既有unsupported code，并停止后续export/Asset。 | pass |
| AC-18 | source严格复用`exportUnitData` identity检查；额外wrong-resolved-ID probe在reference export前失败。 | pass |
| AC-19 | direct test逐字验证formula数组类型、UnitData与顺序；empty/self字段省略。 | pass |
| AC-20 | malformed Embed table覆盖non-string、invalid JSON、array root、missing/array embeds。 | pass |
| AC-21 | malformed descriptor/ref/selector table与valid direct/object ref fixture覆盖active identity解析。 | pass |
| AC-22 | direct test证明soft-deleted invalid child被完全忽略；其他非soft-deleted值走active语义。 | pass |
| AC-23 | active Embed fixture覆盖跨表示去重、反序输入与lexical顺序。 | pass |
| AC-24 | Host self和formula-overlap child均被排除，resolver/export无重复调用。 | pass |
| AC-25 | source在export前校验returned child ID及声明type；focused malformed/type fixture与静态分支审查通过。 | pass |
| AC-26 | Embed export复用严格UnitData identity decoder，direct test验证ordered exact result与空字段省略。 | pass |
| AC-27 | combined fixture证明Host-first、formula后Embed顺序；任一失败不进入capture/writer。 | pass |
| AC-28 | direct deep-equality断言与额外deep-frozen probe均通过，source object graph未被写入。 | pass |
| AC-29 | Worktree combined fixture把Host/formula/Embed交给shared resolver，每次lookup含exact Host worktree ID。 | pass |
| AC-30 | shared UUID跨三种Unit只下载一次；distinct请求顺序由direct fixture验证。 | pass |
| AC-31 | direct与serialized UUID均改写为exact BASE64/media bytes，ordinary字段保持。 | pass |
| AC-32 | frozen Asset probe成功，改写后的render copy有效且三份source与clone deep-equal。 | pass |
| AC-33 | Asset error沿用Change 4 `WorkspaceContentSource.resolveImageAsset`；无fallback/partial/signed URL泄漏分支。 | pass |
| AC-34 | Trunk fixture含UUID仍Asset 0调用且不改写；Host scope独立决定Asset policy。 | pass |
| AC-35 | `screenshot.test.ts`捕获exact renderPageRoot/license/env/signal runtime options。 | pass |
| AC-36 | 同一test断言完整capture input原引用传入一次，无reload/filter。 | pass |
| AC-37 | capture result按原引用返回；typed-array view exact bytes另由writer direct test验证。 | pass |
| AC-38 | deferred-close success fixture证明close resolve前operation不settle且close一次。 | pass |
| AC-39 | ordinary/coded failure table均在reject前await close并保留原error。 | pass |
| AC-40 | already-aborted signal fixture和failure/abort table证明同一signal透传及close。 | pass |
| AC-41 | constructor-failure fixture为close 0；`try/finally await close`保持既有close precedence且每次独立runtime。 | pass |
| AC-42 | PNG direct test覆盖显式cwd/relative nested destination；source保留default `screenshots`和`resolve`语义。 | pass |
| AC-43 | unsafe table覆盖`.`、`..`、parent/child slash与absolute path，写入前失败。 | pass |
| AC-44 | 后项unsafe与pre-existing fixture证明全量name/path preflight先于首张提交。 | pass |
| AC-45 | source明确same-dir random UUID temp、`wx`和`0600`；success目录只剩公开destination。 | pass |
| AC-46 | typed-array offset fixture验证exact bytes、hard-link nonreplace commit、0600 destination及ordered output。 | pass |
| AC-47 | pre-existing fixture逐字验证原bytes/mode不变且无temp；未增加force。 | pass |
| AC-48 | 真实4 MiB并发writer只一方成功，另一方既有EEXIST，winner bytes完整且temps清空。 | pass |
| AC-49 | `writeExclusive`的`finally unlink`只忽略ENOENT；source审查无删除无关文件或吞普通错误。 | pass |
| AC-50 | 额外built-Core duplicate-name probe使第二次commit失败，首张保留、无temp，确认既有非事务语义。 | pass |
| AC-51 | PNG owner只用Node fs/path与screenshot result；未复用Change 4 download/force/metadata abstraction。 | pass |
| AC-52 | lint non-Slide table覆盖Sheet/Doc/Base/Board，均在runtime create前返回exact既有code。 | pass |
| AC-53 | Slide direct test传exact UnitData/formula references/pages/signal，不传Embed字段。 | pass |
| AC-54 | lint runtime fixture捕获exact page/license/env/optional signal，每次独立create。 | pass |
| AC-55 | exact result引用含kind/identity/coverage/ordered findings，Core无JSON/text presenter。 | pass |
| AC-56 | deferred success、ordinary failure、abort均await close；constructor failure不fabricate close。 | pass |
| AC-57 | render page source只在`packages/client-core/render-runtime`，CLI通过copy script消费Core build output。 | pass |
| AC-58 | bootstrap精确查询`#app`、调用mount/preset一次，并保留container/license fail-fast。 | pass |
| AC-59 | source HTML保持UTF-8、relative module、1600×1000及html/body margin/size/overflow。 | pass |
| AC-60 | Vite config保持`base:"./"`、stable outDir、`sourcemap:false`、env replacement和chunk limit。 | pass |
| AC-61 | Core与CLI build各产104个page files；index/local refs存在，无`.map`/`.ts`或checkout path。 | pass |
| AC-62 | copy script逐项access HTML refs；临时缺index verify与缺entry asset installed-smoke negative probes均按预期失败。 | pass |
| AC-63 | fixed diff中CLI command body与baseline一致，仅type owner import变化；target-neutral preset、setup、out描述与互斥scope保留，scope tests 3/3。 | pass |
| AC-64 | lint command保留required Worktree mapping、upstream validation和JSON；direct test通过。 | pass |
| AC-65 | `program.ts`只把daemon exact export operation和authenticated source适配给Core，wire无新增字段。 | pass |
| AC-66 | screenshot setup仍由CLI install/probe/resolve owner处理，installed surface smoke通过。 | pass |
| AC-67 | CLI focused/full tests覆盖JSON/text/coded error/presentation；Core未接管presenter。 | pass |
| AC-68 | `main.ts`仍解析installed `dist/render-runtime`；SVG临时consumer 6/6相关tests及arbitrary-cwd entrypoint通过。 | pass |
| AC-69 | package owner `rg`与artifact tests证明Puppeteer版本从Core-owned render runtime解析；4类negative owner/dependency case通过。 | pass |
| AC-70 | frozen install exit 0；Core先build page，CLI copy同一104-file closure，exact SDK 4/4。 | pass |
| AC-71 | package build/verify为203 files且closure searches无workspace/private source；missing page/asset negative probes失败。 | pass |
| AC-72 | installed tarball smoke从临时root/arbitrary cwd加载screenshot/setup/lint并解析两项Puppeteer依赖，exit 0。 | pass |
| AC-73 | Core 25 files/429 tests、CLI 15/65、reference-provider 2/16、Workspace 34/152及root typecheck/test/build全部exit 0。 | pass |
| AC-74 | fixed diff/artifact hygiene无真实credential/Cookie/deviceCode/license/signed URL/private key；`127.0.0.1:3020`为`environment-unavailable`且未使用凭据。 | pass |

## 实际命令与结果摘要

| 命令 | 结果 |
| --- | --- |
| `openspec status --change extract-screenshot-lint-client-core --json`；`openspec instructions apply --change ... --json` | artifacts complete；7/7 tasks checked，仅作规划交叉检查 |
| Core focused Vitest：`render-unit`、`screenshot`、`screenshot-output`、`layout-lint`、`runtime-source` | 5 files，58/58 pass |
| built-Core额外scope/Host identity/wrong reference/PNG非事务探针 | exit 0，`change9-extra-probes: pass` |
| built-Core frozen Host/formula/Embed Asset探针 | exit 0，shared Asset 1次且source immutable |
| CLI focused screenshot/lint | 2 files，4/4 pass |
| CLI SVG临时consumer与built entrypoint | 3 files，9/9 pass |
| Core `typecheck` / `test` / `build` | exit 0；25 files，429/429；render page 104 files |
| CLI `typecheck` / `test` / `build` | exit 0；15 files，65/65；package artifact 13/13 |
| `pnpm install --frozen-lockfile` | exit 0，Already up to date |
| CLI package build / verify / installed smoke | exit 0；203 files；installed tarball commands passed |
| package缺index与缺HTML entry asset临时negative probes | exit 0（两个被测命令均按预期nonzero） |
| `pnpm test:sdk-dependencies` / `pnpm typecheck` / `pnpm test` / `pnpm build` | 全部exit 0；SDK 4/4、release 8/8、Core 429/429、reference-provider 16/16、Workspace 152/152、CLI 65/65 |
| `git diff --check baseline..implementation`、owner/private import/artifact closure searches | exit 0或预期no-match；final tree相对implementation只更新OpenSpec tasks |
| unauthenticated `curl --max-time 2 http://127.0.0.1:3020/` | exit 7，`environment-unavailable`；未读取或使用账号 |

实际执行的主要命令：

```text
pnpm --filter @univerjs/univer-workspace-client-core exec vitest run --config vitest.config.ts test/render-unit.test.ts test/screenshot.test.ts test/screenshot-output.test.ts test/layout-lint.test.ts test/runtime-source.test.ts
pnpm --filter @univerjs/univer-workspace-client-core typecheck
pnpm --filter @univerjs/univer-workspace-client-core test
pnpm --filter @univerjs/univer-workspace-client-core build
pnpm --filter univer-workspace-cli exec vitest run --config vitest.config.ts test/workspace-screenshot.test.ts test/workspace-unit-layout-lint.test.ts
pnpm --filter univer-workspace-cli exec vitest run --config vitest.config.ts test/svg-text-measurer.test.ts test/workspace-compile-svg.test.ts test/workspace-cli.test.ts
pnpm --filter univer-workspace-cli typecheck
pnpm --filter univer-workspace-cli test
pnpm --filter univer-workspace-cli build
pnpm install --frozen-lockfile
node --test apps/cli/scripts/package-artifact.test.mjs
pnpm package:workspace-cli
pnpm --filter univer-workspace-cli package:verify
pnpm --filter univer-workspace-cli package:smoke
pnpm test:sdk-dependencies
pnpm typecheck
pnpm test
pnpm build
git diff --check 7e53844aa8a90950479f30382259e17dc6ec7529..8ee94b17a949394b18c47c587613d6c34cf3045a
```

另以built Core执行Host invalid matrix、Trunk/Worktree exact scope、wrong reference identity、frozen Asset rewrite与PNG后项commit失败探针；以临时package副本执行缺index和缺HTML entry asset negative probes。所有临时fixture均已删除。

说明：第一次package smoke在共享工作区中碰到`package-dist/dist/render-runtime/assets`瞬时ENOENT；隔离为串行`package:workspace-cli && package:smoke`后通过，随后root完整test/build也通过。该现象未在独立重跑中复现，未记为产品issue。

## SPEC-01/02 fix复验

初次QA只按code与通用identity/type检查判定AC-20/21/23/25通过，遗漏了duplicate descriptor的type constraint合并规则和CLI可见的malformed-root exact message。Review以SPEC-01/02指出两处缺口；QA把它们补录为`SL-QA-001/002`，并对固定fix diff `8ee94b17a949394b18c47c587613d6c34cf3045a..0098f00d4d6f0837084555a8b5bb7eaa9c4de4b0`独立复验。

| 补充项 | 行为与观察点 | 证据 | 结论 |
| --- | --- | --- | --- |
| SUP-01 | typed ResourceRef后出现direct duplicate | focused test令resolved child为Sheet、声明为Doc；仍保留Doc constraint并返回既有Embed coded error，resolver 1、child export 0。 | pass |
| SUP-02 | direct duplicate后出现typed ResourceRef | 反序fixture得到与SUP-01相同结果，descriptor顺序不改变有效type gate。 | pass |
| SUP-03 | duplicate声明相同type | 两个Doc声明只resolve一次、Host+child共export两次，结果只含一个Doc child。 | pass |
| SUP-04 | duplicate声明冲突type | Doc与Sheet声明在resolver前返回`workspace-screenshot-embed-resource-invalid`；resolver 0。 | pass |
| SUP-05 | object ResourceRef non-string type | `type:1`在resolver前返回既有code和exact `source ref is invalid` message。 | pass |
| SUP-06 | object ResourceRef blank type | `type:"  "`同样在resolver前拒绝，不静默降级为untyped。 | pass |
| SUP-07 | resolved effective type gate | 两种typed/direct顺序均用合并后的Doc约束检查resolved Sheet；matching Doc路径由same-type fixture成功覆盖。 | pass |
| SUP-08 | external malformed root message | array、null、primitive逐项恢复exact `Invalid UNIVER_EXTERNAL_REFERENCE_PLUGIN: references is not an object.`；resolver 0。 | pass |
| SUP-09 | Embed malformed root message | array、null、primitive逐项恢复exact `Invalid UNIVER_EMBED_RESOURCE_PLUGIN: embeds is not an object.`；resolver 0。 | pass |
| SUP-10 | non-string与invalid JSON稳定 | 两类resource分别保持`data is not a string`与`data is not valid JSON`，code与message均逐字断言。 | pass |
| SUP-11 | 新tests在旧实现失败 | 将当前32-case suite放到临时pre-fix tree `8ee94...`执行：22 pass、10 fail；失败准确覆盖3+3 root messages、typed→direct丢type、conflict未前置、non-string/blank type。临时tree已删除。 | pass |
| SUP-12 | source/Asset/order与delivery回归 | 当前focused 32/32、Core full 439/439；原formula/Embed order、Worktree shared Asset/source immutable、Trunk zero Asset cases仍通过。CLI相关9/9、Core/CLI typecheck、Core build、package 203 files/verify/installed smoke全部exit 0。 | pass |

fix只修改`packages/client-core/src/render-unit.ts`和`packages/client-core/test/render-unit.test.ts`，共146 insertions/24 deletions。实现以existing Map保存每个child的有效optional type：untyped duplicate不能覆盖typed、matching typed dedup、typed conflict立即复用既有Embed error；没有新增owner、adapter或compatibility layer。`parseResource()`只保留non-string/JSON parsing，formula/Embed caller恢复各自subject-specific root check。Asset rewrite、formula/reference稳定排序、Host-first export和browser/PNG owners未改。

实际复验命令：

```text
pnpm --filter @univerjs/univer-workspace-client-core exec vitest run --config vitest.config.ts test/render-unit.test.ts --reporter=verbose
pnpm --filter @univerjs/univer-workspace-client-core test
pnpm --filter @univerjs/univer-workspace-client-core typecheck
pnpm --filter @univerjs/univer-workspace-client-core build
pnpm --filter univer-workspace-cli exec vitest run --config vitest.config.ts test/workspace-screenshot.test.ts test/workspace-unit-layout-lint.test.ts test/svg-text-measurer.test.ts test/workspace-compile-svg.test.ts
pnpm --filter univer-workspace-cli typecheck
pnpm package:workspace-cli
pnpm --filter univer-workspace-cli package:verify
pnpm --filter univer-workspace-cli package:smoke
git diff --check 8ee94b17a949394b18c47c587613d6c34cf3045a..0098f00d4d6f0837084555a8b5bb7eaa9c4de4b0
```

旧实现失败证据使用`git archive 8ee94...`生成临时Client Core tree，复用当前new regression suite与本仓库安装依赖运行Vitest；命令返回预期nonzero且列出10个行为失败，不修改工作区产品文件。

## QA issues

| ID | 严重度 | 证据（文件/命令/输出） | 期望 | 状态 |
| --- | --- | --- | --- | --- |
| SL-QA-001 / review SPEC-01 | medium | pre-fix新suite 32 cases中typed→direct、conflicting type、non-string/blank type共4项失败；review的真实probe也证明typed constraint可被direct duplicate覆盖。fix focused 32/32、SUP-01–07通过。 | duplicate descriptor顺序不丢已声明type；相同type只resolve/export一次；冲突和非法type在resolver前返回既有coded error；resolved target满足有效type。 | closed |
| SL-QA-002 / review SPEC-02 | low | pre-fix新suite中external和Embed各3个array/null/primitive exact-message cases失败；fix focused 32/32、SUP-08–10通过。 | malformed non-record root恢复旧`references/embeds is not an object` message，non-string/invalid JSON语义不变。 | closed |

当前 **0 open issue**。
