# extract-office-exchange-client-core QA

本文件记录 Change `extract-office-exchange-client-core` 的独立实现后验收。QA 固定比较 baseline tree `fe8a216126594211da39116414cfe29129ad20e4` 与 implementation tree `b3896dd7052eeedca460b83d188e46d9aacb399d`，并核对 OpenSpec final tree `8ed36ccd70768d55083e57aedd6503875e1b67a6`。结论为 **48/48 pass，0 open issue；Ready to archive**。本地 `127.0.0.1:3020` 不可用，可选 authenticated smoke 记为 `environment-unavailable`；自动化 gate 均已执行且通过。

## 基线、边界与风险

- 实施后 QA 必须记录 baseline tree 与 implementation tree，并只审查该区间。Tasks 勾选和 implement 汇报不能代替行为证据。
- Change 3、5、6 已提供 Worktree-local Unit create、runtime target resolution 和 content-runtime `exportUnitData` public seams。本 Change 必须复用这些真实 exports；缺失时停止，不得复制 Unit、target、runtime、HTTP、auth、error 或 daemon owner。
- Client Core 成为 Office suffix/type/options/name/create-result/export-validation 与 Node exchange adapter 的唯一 owner。CLI 只保留 Commander、JSON/text presentation、daemon RPC adapter 和可安装 artifact 责任。
- Office SDK 继续直接接收调用方路径。本 Change 不引入 filesystem provider、buffer/stream API、临时文件、原子写、目录创建、`--force`、overwrite guard、converter registry、factory hierarchy或 compatibility layer。
- 主要回归风险是大小写 suffix matrix、Sheet/Base formula 选项、特殊 presentation format override、名称和创建结果 identity、export 校验顺序、exact revision、CLI RPC payload，以及 native binding 在 frozen external install 中丢失。

## Spec scenario → 测试与命令

测试文件可按最终 owner 命名；若名称变化，QA 先用 `rg --files` 解析实际文件并记录。算法级断言必须位于 Core，CLI 只保留 Shell contract。

| OpenSpec scenario | 实现后直接证据 | 最小命令 |
| --- | --- | --- |
| Supported source type is inferred | Core table test 覆盖全部 10 个 suffix、lower/mixed/upper case、default type 与 exact converter options | Core Office focused test |
| Spreadsheet is imported as Base | `.xls`/`.xlsx` explicit Base，类型不回落 Sheet，且无 Sheet formula option | Core Office focused test |
| Source suffix/type incompatible | 每个 suffix family 的所有不兼容 type 与 unsupported suffix 在 converter/create 前稳定失败 | Core Office focused test |
| Imported content supplies its name | `name`、`title`、fallback 与空白值逐项验证 | Core Office focused test |
| Explicit name overrides content | explicit name 同时进入 payload/create/result；其余命名来源不改 payload | Core Office focused test |
| Created Unit mismatches request | Worktree/source/type/name/Space/parent 每维 mismatch 均返回既有 code，不报告 committed | Core Office focused test |
| Compatible Unit is exported | exact resolved target/revision、UnitData object、format/options/output path/result | Core Office focused test |
| Type/output incompatible | Board、unsupported suffix、compatible suffix mismatch 的既有校验顺序与零 side effect | Core Office focused test |
| Runtime returns another Unit | null/array/non-record/missing/wrong `id` 均拒绝且 native writer 0 调用 | Core Office focused test |
| Native XLSX round trip | 真实 binding 生成非空 XLSX，再导入并验证 fixture cell | Core native focused test |
| Installed Shell lacks native runtime | manifest/verify/smoke 对 binding 缺失或不可加载必须失败 | package artifact tests + verify/smoke |
| Existing CLI contract | Commander mapping、JSON/text、coded errors、canonical `runtime.export-unit-data` payload | CLI focused/full tests |
| Installed CLI loads exchange | 临时目录安装 tarball，Core 代码闭包与 platform binding 可解析，无 workspace/source-checkout dependency | package verify/smoke |

## 输入兼容矩阵

下表每行均须测试原 suffix 及至少 mixed/upper-case 变体；Case normalization 对全部 suffix 生效，而不是只抽查 `.XLSX`。

| suffix | implicit type | allowed explicit type | import option 差异 |
| --- | --- | --- | --- |
| `.xls` | `sheet` | `sheet`, `base` | Sheet 与 Base 均无 `formulaCalculation` |
| `.xlsx` | `sheet` | `sheet`, `base` | 只有 Sheet 为 `FORCED`；Base 无该字段 |
| `.doc`, `.docx` | `doc` | `doc` | 不添加 formula/format override |
| `.ppt`, `.pptx` | `slide` | `slide` | 不添加显式 format override |
| `.pptm`, `.ppsx`, `.ppsm`, `.potx` | `slide` | `slide` | 显式 `format: PPTX` |

所有 family 的其他 `sheet|base|doc|slide` 值均不兼容。无 suffix、尾随点、`.csv`、`.pdf` 等 unsupported path 使用既有 `workspace-exchange-import-format-unsupported`。

## 验收标准

### 前置、owner 与 scope

- **AC-01** 实施前后均能从 Client Core 根入口解析 Change 3 的 Worktree-local create、Change 5 的 target resolver/type/serializer 与 Change 6 的 `exportUnitData` operation；实现直接组合这些 seams，Core typecheck 成功。
- **AC-02** Office workflow、format/type policy 与默认 Node adapter 只存在于 private `@univerjs/univer-workspace-client-core`；根入口提供必要 named exports，不新增 package、public npm/version 或 private-subpath contract。
- **AC-03** Core Office source 不导入 `apps/cli`、Commander/presenter、daemon `DaemonClient`/`JsonValue`、CLI Session/config、CLI private `src`/`dist` 或相邻 checkout；CLI 不保留第二份 suffix/options/name/result-validation body。
- **AC-04** 限定 diff 不修改 Workspace Server、Browser、OpenAPI/generated、Collaboration protocol、Session schema、Worktree/Unit/target/runtime语义、Change 4 file-transfer、Typst、SVG、render、screenshot/lint 或 Skills。
- **AC-05** Core manifest 只增加 exact SDK-baseline `@univerjs-pro/exchange-node` 及真正编译所需依赖；不得新增 filesystem abstraction、converter interface/registry、factory hierarchy、service container 或通用 compatibility layer。

### Import format、options 与 conversion

- **AC-06** 表格化直接测试覆盖 `.xls/.xlsx/.doc/.docx/.ppt/.pptx/.pptm/.ppsx/.ppsm/.potx` 的 implicit type；每个 suffix 的 lower、mixed、upper case 均选择同一 type。
- **AC-07** 每个 suffix family 覆盖全部显式 `sheet|base|doc|slide` 组合：XLS/XLSX 只接受 Sheet/Base，DOC/DOCX 只接受 Doc，所有 presentation suffix 只接受 Slide；兼容组合不被 default 覆盖。
- **AC-08** unsupported path 与所有不兼容组合返回既有 `workspace-exchange-import-format-unsupported` code/message shape；native importer与create均 0 调用，错误 detail 不包含转换 payload。
- **AC-09** import converter 的 path 与调用方 `sourcePath` 字节一致；不得 normalize、resolve、补 suffix、检查存在性、预读文件、创建目录或改为 bytes/stream。
- **AC-10** `.xlsx` Sheet exact options 为 `type: UNIVER_SHEET` 加 `formulaCalculation: FORCED`；`.xls` Sheet无 formula；XLS/XLSX Base exact type 为 `UNIVER_BASE` 且无 formula。
- **AC-11** Doc import exact type 为 `UNIVER_DOC`，`.ppt/.pptx` Slide 只传 `UNIVER_SLIDE`；`.pptm/.ppsx/.ppsm/.potx` 还必须显式传 `format: PPTX`。所有未列字段均不得出现。
- **AC-12** native importer恰好调用一次；converter resolve/reject 原样决定后续流程。reject 时 create 为 0，不自动以另一 type/format 重试或回退。

### Import name、create 与 result identity

- **AC-13** 名称优先级为 explicit non-empty → converted non-empty `name` → converted non-empty `title` → exact `Imported <type>`；`undefined`、空串与纯空白分别覆盖，非空值不被 trim 后改写。
- **AC-14** 只有 explicit non-empty name 覆盖 converted payload 的 `name`，并保持 converted object 的其他字段；imported name/title/fallback 只用于 create/result，不向 payload 伪造或覆盖 `name`。
- **AC-15** create 恰好一次且接收 exact converted `initialData`、selected name/type、Space、Worktree；parent 与 idempotency key 只在调用方提供时出现，值不 trim、不生成、不替换。
- **AC-16** 两次调用方重试使用同一 idempotency key 时，Office owner向共享 create seam 传同一 key；不得引入新的随机 identity、重写 key 或绕过 Change 3 的幂等/result-unknown 语义。
- **AC-17** 成功只接受 `source:"worktree"`、请求 Worktree、selected type/name、请求 Space 与 exact parent（未提供时为 `null`）。Worktree/source/type/name/Space/parent 每个单维 mismatch 均返回既有 `workspace-result-mismatch`。
- **AC-18** result mismatch 不返回 `committed:true`，不再次 convert/create；error code/message/detail 保持旧 CLI contract，且不序列化完整 UnitData、idempotency key 或其他可能敏感内容。
- **AC-19** 成功 result 的字段和值逐字为 `{committed:true,name,nodeId,resourceId,sourcePath,type,unitId,worktreeId}`；Unit/Node/Resource identity 取已验证 create result，sourcePath/Worktree 取请求。

### Export target、validation 与 native write

- **AC-20** export 首先以 exact `{unitId,worktreeId}` 调用共享 resolver一次；resolver failure 立即退出，runtime export与native writer均 0 调用。
- **AC-21** resolved Board 在 suffix inference 前返回既有 `workspace-unit-type-unsupported`；Board 加 unsupported suffix仍得到 Board error，runtime/writer 0调用。
- **AC-22** output suffix大小写不敏感：`.xlsx/.docx/.pptx`分别选择XLSX/DOCX/PPTX；无 suffix、旧Office输出suffix、`.csv/.pdf`等返回既有 `workspace-exchange-export-format-unsupported`，发生在runtime export前。
- **AC-23** compatibility矩阵固定为 Sheet/Base→XLSX、Doc→DOCX、Slide→PPTX；supported但不兼容的组合返回既有 `workspace-exchange-export-format-mismatch`，runtime/writer 0调用。
- **AC-24** 校验顺序为 resolver → Board → output suffix → type/format compatibility → runtime `exportUnitData` → UnitData identity → native writer；组合失败case用call order与error code锁定。
- **AC-25** runtime operation恰好接收 resolver 返回的同一 canonical target，包括 exact origin、scope、Worktree、Unit type 与 selected revision；不得重新解析 latest head、丢 revision 或仅传输入 IDs。
- **AC-26** runtime result必须为非数组record且`id === target.unitId`；null、array、primitive、missing id、wrong id均返回既有 `workspace-exchange-unit-data-invalid`，writer 0调用，错误不泄露完整UnitData。
- **AC-27** writer恰好接收 runtime 返回的 exact UnitData object、调用方 output path 与 exact format/type options；不 clone/filter resources、styles、sheets，不 resolve/normalize path。
- **AC-28** export options：Sheet XLSX含 `formulaCalculation: FORCED`；Base XLSX、Doc DOCX、Slide PPTX均无 formula。每类含 exact `UniverInstanceType` 与 `ExchangeFormat`，无额外字段。
- **AC-29** writer成功 result逐字为 `{outputPath,type,unitId,worktreeId}`；outputPath保持输入字节，unit/type取validated target，Worktree保持请求。
- **AC-30** runtime或writer reject时不返回success、不重试、不尝试其他format；Office owner不增加temp/rename/fsync/cleanup、overwrite preflight、force或目录创建行为。

### Native runtime

- **AC-31** 真实native test用合法Sheet UnitData写入临时`.xlsx`，文件存在且size>0；再经真实`importFile`读回并验证指定sheet/cell值，而非只mock或只检查magic bytes。
- **AC-32** native round trip使用生产默认 adapter 与当前 exact Sheet XLSX formula options；fixture在`finally`清理临时目录，不访问用户路径、不依赖Workspace Server。
- **AC-33** Core direct tests允许窄的function substitution验证call shape，但产品不公开通用converter interface/registry/factory；至少一个test必须穿过真实 `@univerjs-pro/exchange-node` 与platform binding。

### CLI command、presentation 与 daemon wire parity

- **AC-34** CLI仍公开`import`与`export`：import保留 required `--file/--worktree/--space`、optional `--type/--name/--parent/--idempotency-key/--json`；export保留`<output>`、required `--worktree/--unit`与`--json`。
- **AC-35** `--type`仍只接受`sheet|base|doc|slide`，Commander missing/invalid option行为、exit code与stderr/stdout归属兼容；Shell只做参数映射，不复制Office type matrix。
- **AC-36** import command向Core传exact option shape，undefined option仍省略；export传exact `{outputPath,unitId,worktreeId}`，文件路径和identity不trim/resolve。
- **AC-37** text逐字保持`imported <type> <unitId> as Resource <resourceId> on Node <nodeId> in <worktreeId>`与`exported <type> <unitId> to <outputPath>`；JSON为Core result的现有结构，无额外envelope/log。
- **AC-38** Core的import/export错误经existing command runner保留coded error、JSON/text结构、exit behavior；不得转换成uncoded native error、泄露UnitData、Session Cookie、license、device code或绝对checkout path。
- **AC-39** export daemon adapter method仍为`runtime.export-unit-data`，payload严格为`{target: serializeWorkspaceRuntimeTarget(exactTarget)}`；无额外字段，response未经JSON shape改写后交给Core验证。
- **AC-40** Session读取、daemon start/socket/process lifecycle与license resolution时机不变；import不启动daemon，export只在通过target/Board/format/type校验后进入runtime operation。
- **AC-41** superseded CLI exchange workflow/native-owner tests迁入Core，CLI仅保留command、program composition、RPC与artifact tests；不得留re-export shim、duplicate policy或大 compatibility façade。

### Dependencies、installed artifact 与完整 gate

- **AC-42** CLI source/build仍拥有可安装artifact责任：distribution manifest精确列出`@univerjs-pro/exchange-node-binding` external runtime dependency；版本来自owner manifest且不是`workspace:*`、range漂移或隐式transitive dependency。
- **AC-43** `pnpm install --frozen-lockfile`成功，workspace/lockfile/Core/CLI manifests一致；删除binding声明或使版本不可解析时 package manifest test/verify 必须稳定失败。
- **AC-44** package build/verify确认Core Office代码已内联CLI artifact；artifact无bare `@univerjs/univer-workspace-client-core`、private Core install dependency、`src/test/.ts/.map`、monorepo绝对路径或相邻checkout import。
- **AC-45** installed smoke在临时cwd/home安装tarball后，从安装根解析`@univerjs-pro/exchange-node-binding`，并验证`exchangeImportToSnapshot`与`exchangeExportSnapshot`为function；binding缺失/平台package不可加载时gate必须失败。
- **AC-46** installed smoke还必须执行能加载Core Office owner的CLI entrypoint/fixture；若fixture具备Office文件流，则运行真实XLSX round trip或等价import/export command。不得仅在monorepo node_modules中require binding后宣称artifact通过。
- **AC-47** Core focused/full typecheck、test、build，CLI focused/full typecheck、test、build，root typecheck/test/build，SDK dependency tests、package build/verify/smoke与`git diff --check`全部exit 0；限定diff满足AC-04，owner/forbidden-import/secret searches满足预期。
- **AC-48** 可选local authenticated smoke只在`127.0.0.1:3020`可用时执行，并优先使用read-only target/export前置检查；凭据只经安全environment或stdin提供，不写入Markdown、fixture、源码、命令行或日志。Server不可用记`environment-unavailable`，不判产品失败且不替代自动化gate。

验收项总数：**48**。

## 执行命令

### 状态、diff、前置 exports 与唯一 owner

```bash
openspec status --change extract-office-exchange-client-core --json
openspec instructions apply --change extract-office-exchange-client-core --json
git diff --stat <baseline>..<implementation>
git diff --name-status <baseline>..<implementation>
pnpm --filter @univerjs/univer-workspace-client-core typecheck
rg -n 'WorkspaceUnitFeature|WorkspaceContentSource|WorkspaceRuntimeTarget|serializeWorkspaceRuntimeTarget|WorkspaceContentRuntimeOperations|exportUnitData' packages/client-core/src/index.ts packages/client-core/src
rg -n 'inferImportType|inferExportFormat|requireCompatibleExport|FormulaCalculationMode|ExchangeFormat|importFile|exportToFile' packages/client-core/src apps/cli/src/features/exchange
rg -n 'apps/cli|commander|DaemonClient|JsonValue|workspaceSessionPath|readWorkspaceCookie|resolveUniverLicense|process\.env' packages/client-core/src --glob '*exchange*.ts' --glob '*office*.ts'
rg -n 'WorkspaceBlobFeature|WorkspaceAssetFeature|prepareDownload|writeDownload|node:fs|mkdtemp|rename|fsync' packages/client-core/src --glob '*exchange*.ts' --glob '*office*.ts'
rg -n '@univerjs/univer-workspace-client-core/(src|dist)|packages/client-core/(src|dist)' apps packages --glob '*.ts' --glob '*.mjs'
git diff --check <baseline>..<implementation>
```

第一个Office owner搜索预期policy/native body只在Core命中；CLI允许command映射、structural adapter和tests命中。其余forbidden Core Shell/Change 4/private-path搜索预期无产品命中。

### Direct behavior、native 与 CLI contract

```bash
rg --files packages/client-core/test apps/cli/test | rg 'office|exchange|command|content|runtime'
pnpm --filter @univerjs/univer-workspace-client-core exec vitest run --config vitest.config.ts test/office-exchange.test.ts
pnpm --filter @univerjs/univer-workspace-client-core exec vitest run --config vitest.config.ts test/exchange-node.test.ts
pnpm --filter @univerjs/univer-workspace-client-core test
pnpm --filter univer-workspace-cli exec vitest run --config vitest.config.ts test/workspace-unit-exchange.test.ts test/application-command-contracts.test.ts test/content-execution.test.ts
pnpm --filter univer-workspace-cli test
```

若迁移后的focused test文件名不同，使用第一条命令解析后替换，不能跳过对应matrix。CLI中被删除的旧feature test由Core direct test替代；command/RPC parity tests仍须在CLI运行。

### Frozen dependency、build 与 installed artifact

```bash
pnpm install --frozen-lockfile
node --test apps/cli/scripts/package-artifact.test.mjs
pnpm --filter @univerjs/univer-workspace-client-core typecheck
pnpm --filter @univerjs/univer-workspace-client-core build
pnpm --filter univer-workspace-cli typecheck
pnpm --filter univer-workspace-cli build
pnpm package:workspace-cli
pnpm --filter univer-workspace-cli package:verify
pnpm --filter univer-workspace-cli package:smoke
rg -n '@univerjs-pro/exchange-node-binding' apps/cli/package.json apps/cli/scripts/package-artifact.mjs apps/cli/package-dist/package.json pnpm-lock.yaml
rg -n '@univerjs/univer-workspace-client-core|packages/client-core|/Users/|\.\./\.\.' apps/cli/package-dist --glob '*.js' --glob 'package.json'
```

最后一条预期无workspace/private/checkout依赖；binding搜索必须命中CLI source/distribution/lock与artifact owner。

### 完整 gate 与 hygiene

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

Hygiene 搜索的命中必须逐条人工判断；测试字段名可以出现，真实secret、fixture credential、完整Cookie/device code/license bytes不得出现。

### 可选 local Workspace smoke

先以不携带凭据的TCP/HTTP探测检查`127.0.0.1:3020`。不可用时只记录`environment-unavailable`。可用时凭据通过安全stdin/environment注入，运行login/whoami及read-only Space/Node/Worktree target检查；只有已知临时fixture允许执行Office import/export写操作。报告只记录命令类别、exit code与脱敏identity，不记录用户名、密码、Cookie、device code或license。

## 实现后证据记录

| AC | 证据（test/命令/文件与关键输出） | 结论 |
| --- | --- | --- |
| AC-01 | `packages/client-core/src/index.ts` 导出 `WorkspaceUnitFeature`、`WorkspaceContentSource`、runtime target/content operations；Core typecheck/build通过，Office owner组合既有create/resolver/runtime ports。 | pass |
| AC-02 | `WorkspaceUnitExchangeFeature`及5个public types只由Client Core根入口导出；diff未增加package、版本或public npm contract。 | pass |
| AC-03 | forbidden-import `rg` 对Core Office无CLI/Commander/daemon/Session命中；CLI仅`command.ts`与`program.ts`命中feature，旧`exchange.ts` owner已删除。 | pass |
| AC-04 | 固定diff为13个Office/Core/CLI/docs/lock文件；未触及Server、Browser、OpenAPI、Change 4、Typst/SVG/render/screenshot/lint业务实现。 | pass |
| AC-05 | `@univerjs-pro/exchange-node@1.0.0-beta.2`从CLI移到Core，SDK baseline一致；source/diff无filesystem/provider/registry/factory/compatibility layer。 | pass |
| AC-06 | Core `INPUT_CASES`覆盖10个suffix；`suffixVariants()`对每项执行lower、首字母大写与upper；focused Core 68/68。 | pass |
| AC-07 | `it.each(INPUT_CASES)`对每个suffix遍历全部4种显式type，合法组合convert/create一次，不合法组合均0调用；68/68。 | pass |
| AC-08 | unsupported source与不兼容matrix断言`workspace-exchange-import-format-unsupported`及converter/create 0；迁移diff显示error body逐字保留。 | pass |
| AC-09 | suffix test以`exact path/report.*`断言converter接收相同path；`office-exchange.ts`仅用`extname`，无FS/path resolve或byte/stream。 | pass |
| AC-10 | `.xls/.xlsx` Sheet/Base table断言exact options；只有`.xlsx` Sheet含`FORCED`。 | pass |
| AC-11 | 10-row option table固定Doc/Slide type；PPT/PPTX无format，PPTM/PPSX/PPSM/POTX显式PPTX。 | pass |
| AC-12 | suffix tests断言importer恰好一次；native import reject test证明create 0且同一error向上传播，无retry/fallback。 | pass |
| AC-13 | 5-row名称test覆盖explicit、converted name、title、fallback、blank explicit；保留非空值两侧空格。 | pass |
| AC-14 | 名称test直接比较`initialData`：仅explicit non-empty覆盖`name`，其他来源保持converted payload。 | pass |
| AC-15 | exact create identity test覆盖converted payload、Space/parent/Worktree/type/name与空格保留；optional字段省略亦有断言。 | pass |
| AC-16 | retry test连续调用两次并断言共享create seam收到同一`stable-import` key，未生成第二identity。 | pass |
| AC-17 | 6-row mismatch test逐项覆盖Worktree/source/type/name/Space/parent；成功fixture同时覆盖无parent→`null`。 | pass |
| AC-18 | 每个mismatch只convert/create一次并返回既有`workspace-result-mismatch`；迁移body无detail、retry或payload序列化变化。 | pass |
| AC-19 | exact identity test逐字段比较9-field committed result，Unit/Node/Resource来自create result，path/Worktree保持请求。 | pass |
| AC-20 | resolver failure test的调用序列严格为`["resolve"]`，runtime/writer均0。 | pass |
| AC-21 | Board + unsupported `.csv`仍先返回`workspace-unit-type-unsupported`，runtime/writer 0。 | pass |
| AC-22 | success table覆盖`.XLSX/.DoCx/.PPTX` case normalization；6个unsupported output在runtime前返回既有format error；实现与旧body逐字一致。 | pass |
| AC-23 | 8-row export mismatch matrix覆盖Sheet/Base/Doc/Slide所有错误目标格式，runtime/writer 0。 | pass |
| AC-24 | resolver failure、Board+bad suffix、unsupported suffix、mismatch、invalid UnitData与成功cases共同固定resolver→Board→suffix→type→runtime→identity→writer顺序。 | pass |
| AC-25 | success test把revision改为17，断言`exportUnitData({target: exactTarget})`；实现直接传resolver返回对象。 | pass |
| AC-26 | null/array/string/number/empty object/wrong id均返回`workspace-exchange-unit-data-invalid`且writer 0。 | pass |
| AC-27 | success table断言writer接收runtime返回的完整resources/styles对象、原output path和exact options；实现不clone/filter。 | pass |
| AC-28 | 4-row success table固定Sheet含`FORCED`，Base/Doc/Slide无formula，并检查exact format/type。 | pass |
| AC-29 | 每类success返回exact `{outputPath,type,unitId,worktreeId}`；包含保留case与path。 | pass |
| AC-30 | runtime/writer failure test分别断言1/0与1/1调用并原error传播；source无temp/rename/fsync/preflight/force。 | pass |
| AC-31 | `packages/client-core/test/exchange-node.test.ts`真实写入XLSX、断言size>0、重新import并验证A1；focused native test通过。 | pass |
| AC-32 | native test使用production `exportToFile/importFile`与Sheet XLSX `FORCED` options，并在`finally`递归清理临时目录。 | pass |
| AC-33 | 产品仅保留既有窄function substitution；未增加registry/factory，真实binding test与mock call-shape tests均通过。 | pass |
| AC-34 | `command.ts`除type import/`Pick`外命令body无变化；import/export名称、arguments与options逐项保持。 | pass |
| AC-35 | `oneOf(...[sheet,base,doc,slide])`及Commander required options保持；CLI focused 14/14、full 68/68。 | pass |
| AC-36 | CLI tests精确断言完整import input与含空格的export path/IDs，undefined映射逻辑保持。 | pass |
| AC-37 | import text由test逐字断言；export text模板源码与baseline无差异，export JSON test逐字段exact。 | pass |
| AC-38 | command action/`executeCommand`/`present` body与baseline无差异；CLI application contracts/full tests通过，secret hygiene无真实secret。 | pass |
| AC-39 | `createWorkspaceDaemonRuntimeOperations`未在固定diff中改变；focused content test通过，method仍为`runtime.export-unit-data`及canonical `{target}`。 | pass |
| AC-40 | `program.ts`只改变feature import owner；runtime operations、Session/daemon/license composition和validation timing字节不变。 | pass |
| AC-41 | CLI workflow owner删除，native test100%迁到Core，新增Core policy test；CLI仅command test/composition，无shim或复制policy。 | pass |
| AC-42 | source与distribution manifest均保留external `@univerjs-pro/exchange-node-binding@0.1.0`；package artifact resolver仍由CLI拥有。 | pass |
| AC-43 | `pnpm install --frozen-lockfile`显示Already up to date；artifact manifest negative tests 5/5，lock/manifests一致且无`workspace:*` binding。 | pass |
| AC-44 | package verify通过：203 files，packed 13,029,106 bytes，unpacked 58,135,576 bytes；artifact forbidden ref/file searches均为none，Core Office error strings在`dist/main.js`命中。 | pass |
| AC-45 | installed tarball smoke通过；它从临时install root加载binding并检查两个native functions，随后clean daemon shutdown。 | pass |
| AC-46 | installed smoke执行tarball CLI authenticated fixture、daemon start/status/stop并加载binding；`dist/main.js`包含Core Office owner且无workspace/source-checkout dependency。 | pass |
| AC-47 | Core focused 68/68、full 338/338；CLI focused 14/14、full 68/68；root typecheck/test/build、SDK 4/4、release 8/8、reference-provider 16/16、Workspace 152/152、package build/verify/smoke和fixed diff-check全为exit 0。 | pass |
| AC-48 | 无凭据探测`127.0.0.1:3020`得到curl exit 7/status 000，记录`environment-unavailable`；未读取、使用或持久化测试账号，自动化gate不受替代。 | pass |

## 实际执行命令与结果

```text
openspec status --change extract-office-exchange-client-core --json                    PASS (planning complete)
openspec instructions apply --change extract-office-exchange-client-core --json        PASS (6/6 tasks)
git diff/check fe8a216...b3896dd                                                  PASS (13 files, clean)
Core focused Office + native vitest                                                     PASS (2 files, 68 tests)
CLI focused exchange/application/content vitest                                         PASS (3 files, 14 tests)
pnpm install --frozen-lockfile                                                          PASS
Core typecheck / test / build                                                           PASS (18 files, 338 tests)
CLI typecheck / test / build                                                            PASS (16 files, 68 tests)
node --test apps/cli/scripts/package-artifact.test.mjs                                  PASS (5 tests)
pnpm package:workspace-cli && package:verify && package:smoke                           PASS (installed tarball)
pnpm typecheck && pnpm test && pnpm build                                               PASS
owner / forbidden import / artifact closure / secret hygiene rg                        PASS
curl http://127.0.0.1:3020/                                                             environment-unavailable
```

Hygiene搜索唯一命中是README中的普通短语`password input`，不含credential值、Cookie、device code、license bytes或private key。

## QA issues

| ID | 严重度 | 证据（文件/命令/输出） | 期望 | 状态 |
| --- | --- | --- | --- | --- |

当前 **0 open issue**。
