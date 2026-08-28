# extract-file-transfer-client-core QA

本文件定义并记录 Change `extract-file-transfer-client-core` 的验收。首次QA比较实施前 tree `20bbc9bc6cc2bea29e8fa50706e40401425d0a7a` 与实施后 tree `ea39f8cc6af8958faf7a9138d59971cfb4082519`；fix复验比较原implementation tree与 `9fd60bfe9cce5fd5670879d82f859086259d00bd`。当前结论为 **40/40 pass，0 个 open issue，Ready**。

## 基线与边界

- 实施前记录目标仓库 tree ID，实施后记录 implementation tree ID；QA 只比较这两个 tree 间的产品行为、owner、Server scope 与 installed artifact。
- 前置 Client Core 必须继续提供唯一的 `WorkspaceHttp`、`AuthenticatedWorkspaceHttp`、Workspace errors/result-unknown helpers，以及 Space/Node/Blob Resource parser 和 types。本 Change 不复制或包裹这些 exports。
- Client Core 拥有 Node-hosted local file safety、Blob transfer protocol、Asset signed-content resolver 与 download workflow。CLI Client Shell 继续拥有 Commander、Session/config、presenter 和 origin/credential 注入。
- local path 明确指 Client Core 进程所在主机的 Node filesystem。Browser、sandbox、E2B 和 remote filesystem 不属于本 capability；不为它们增加 filesystem abstraction。
- Workspace Server/OpenAPI、Blob/Asset product contract、CLI command surface、Session bytes/timing和安装方式不得改变。
- Office import/export、截图、Typst、SVG、embedded-image upload、content runtime和daemon均不属于本 Change。`features/content/source.ts` 只允许切换 Asset resolver/content metadata helper 的 package imports；不得迁移其 target、snapshot、render 或 image orchestration。

## Spec scenario → 测试与命令

| OpenSpec scenario | 现有基线 | 实现后必须存在的直接覆盖 | 执行命令 |
| --- | --- | --- | --- |
| Client Shell supplies authenticated access and a local path | `application-features.test.ts` 以伪造`WorkspaceAuth`调用Blob/Asset | Core tests直接传入lazy `AuthenticatedWorkspaceHttp`与真实临时路径；断言Core不读Config/Session/Commander，且返回既有结构化结果 | Core test、owner `rg` |
| Remote filesystem consumer is excluded | 无runtime case | Core README明确local Node-host边界；manifest无Browser/remote filesystem entry；source保留具体`node:fs`/`node:path`实现且无provider/interface | README/manifest/source审查 |
| Reserve response is unknown | Blob reserve使用`executeWithStableIdentity` | Core tests覆盖unknown后成功及耗尽：最多3次reserve，所有请求使用同一key和逐字相同intent；Operation/Upload identity mismatch立即拒绝 | Core test |
| Byte upload or completion response is unknown | `recovers Blob PUT and completion...` | Core状态机矩阵固定PUT/complete/status/resource read-back次数；Server已观察到uploaded/completed后不重放相应write | Core test |
| Upload cannot reach a stable state | 当前只有一个成功恢复case | Core tests覆盖waiting/uploaded/verifying bounded exhaustion、failed/expired/aborted terminal、status/read-back unknown；固定code、public intent detail和attempt上限 | Core test |
| Source changes during upload | `files.test.ts`只覆盖source增长 | Core tests覆盖增长、缩短和read failure；在PUT body consumption中触发既有`workspace-blob-size-mismatch`/source error且不进入complete | Core test |
| Blob metadata does not match owning Node | 现有published-intent mismatch和download happy path | Core tests分别覆盖Resource ID/kind、Node embedded Resource、Node/Space/parent/name/size与Upload/Operation identity mismatch | Core test |
| Download metadata is incomplete or inconsistent | 现有missing content metadata case | Core tests覆盖availability/capability、body、media type、invalid/不一致Content-Length、short/long stream；目标不提交且temp清理 | Core test |
| Exact Blob bytes are downloaded | 现有3-byte happy path | Core test断言exact endpoint、Cookie/role、bytes、`0600`、结果shape与optional ETag | Core test |
| Signed content uses another origin | 现有cross-origin Cookie null case | Core tests同时覆盖same-origin携Cookie、cross-origin不携Cookie、manual redirect拒绝、URL credentials拒绝 | Core HTTP/Asset tests |
| Sign or content response is invalid | 现有invalid error code type | Core parameterized tests覆盖service envelope、success code、URL、protocol/credentials、content body/type/length；均不提交文件 | Core test |
| Exact Asset bytes are downloaded | 现有5-byte happy path | Core test覆盖有/无Content-Length、有/无ETag、exact bytes与既有result shape | Core test |
| Destination is absent and download succeeds | `writes exact bytes atomically...` | Core真实filesystem test断言same-directory temp、exclusive `0600`、sync后commit、final bytes/mode和0 temp | Core test + source审查 |
| Destination appears during non-force download | 现有race case | Core test在stream期间创建竞争文件；hard-link exclusive commit保留竞争者、返回既有output-exists并清temp | Core test |
| Force replacement is explicit | 现有force case | Core test证明不带force预检失败，带force仅在完整write+fsync后rename替换；失败stream保留旧文件 | Core test |
| Stream fails or has wrong size | 现有short stream case | Core tests覆盖stream throw、short、long、filesystem write/commit failure可达分支；无partial destination/temp，code/detail兼容 | Core test |
| Existing command contract is exercised | Commander Blob/Asset mapping cases | CLI tests固定命令/help/options、`--force`、lazy Session时序、request、JSON/text/coded errors和content-source public imports | CLI targeted tests |
| Installed CLI artifact performs file-transfer startup | package smoke尚未执行Blob/Asset | installed tarball fixture在临时cwd/home执行Blob upload/get/download与Asset download，核对exact requests/bytes/mode/JSON且无checkout/Core runtime dependency | package verify/smoke |

迁移后的测试文件名可以变化；QA以scenario title、request log和断言为准。核心file/Blob/Asset workflow tests必须由Client Core拥有，CLI只保留command、composition、Session和installed artifact责任。

## 验收标准

### Package、Node-host边界与owner

- **AC-01** 新能力只加入既有private `@univerjs/univer-workspace-client-core`，通过package根named exports提供；不新增transfer package、Browser entry、独立publish/version、service registry或空的未来目录。
- **AC-02** Core README和types明确只支持同进程local Node filesystem；实现直接使用`node:fs`、`node:fs/promises`和`node:path`，不增加filesystem provider/interface、remote path adapter、capability factory或依赖注入框架。
- **AC-03** Blob/Asset feature只接收既有`AuthenticatedWorkspaceHttp`，顶层操作按既有时点惰性取得`WorkspaceHttp`；Core不导入`WorkspaceAuth`、CLI Config/Session、Commander、presenter、daemon、runtime或application source path。
- **AC-04** local file helpers、Blob状态机/parser、Asset resolver/download各只有一个Core权威owner；删除`apps/cli/src/files.ts`、`features/blob/transfer.ts`、`features/asset/content.ts`与`download.ts`，不得留下shim、复制body或长期compatibility layer。
- **AC-05** Blob/Asset commands、`program.ts`及`features/content/source.ts`只从Client Core package根引用feature/types/helpers；无`client-core/src|dist`、已删除CLI owner路径或相邻checkout import。content-source只切换resolver/metadata imports，其余实现diff应为空。
- **AC-06** before/after限定diff不修改Workspace Server、OpenAPI/generated schema、Session/config、Office、screenshot、embedded images、render runtime、daemon或外部SDK；若Server contract出现变化则判scope failure并额外要求`api:verify`，不能把它视为本迁移的正常组成。

### Local source与原子download target

- **AC-07** `inspectSource()`解析为absolute path，只接受regular file，并返回首次stat得到的safe byte size与`basename` original filename；missing/unreadable与directory/FIFO等non-regular输入分别保持`workspace-blob-source-unavailable`和`workspace-blob-source-invalid`及既有bounded path detail。
- **AC-08** `openSource()`流式读取且累计byte count；增长时在超过首次size处停止，缩短时在EOF拒绝，read failure保持source-unavailable。测试明确不要求检测内容改变但byte size相同，不增加mtime/inode/hash检查。
- **AC-09** `prepareDownload()`在destination同目录以unpredictable name和`wx`建立`0600` temp；non-force在任何remote content request前执行现有preflight，已存在时返回kind-specific output-exists。测试/源码审查证明不会在系统temp或其他filesystem准备文件。
- **AC-10** write循环处理partial filesystem writes，验证optional expected size后调用file-handle `sync()`并关闭；non-force以hard-link exclusive commit加unlink temp实现race safety。竞争destination出现时保留竞争文件，返回kind-specific output-exists且不留下temp。
- **AC-11** 只有`force: true`才在完整write、size check、fsync和close后以rename原子替换destination；pre-existing destination在此前任一失败中保持原字节。无force不得rename覆盖。
- **AC-12** content stream throw、short/long size、write/sync/link/rename失败及显式`discard()`均关闭handle并删除temp；失败时不得留下partial final。既有kind-specific size/write/output codes、message与`{ actualByteSize, expectedByteSize, path|outputPath }`detail保持不变。
- **AC-13** `responseContent()`拒绝null body并释放reader lock；`contentLength()`只接受nonnegative safe integer或header缺失，拒绝空、负数、小数、NaN/Infinity/overflow并保持Asset/Blob subject文案。direct tests必须覆盖stream error向atomic cleanup传播。

### Blob reserve、upload与recovery

- **AC-14** Blob upload先inspection/normalize本地input再取得authenticated HTTP：Space/parent identity nonempty，name trim后1..255，optional media type trim后1..255；默认name/original filename/byte size来自同一Source，invalid local input不读Session或发请求。
- **AC-15** reserve只POST `/api/blob-upload-sessions`，body精确为Space、parent/null、name、originalFilename、byteSize和optional declaredMediaType；supplied或一次生成的idempotency key跨最多3次unknown reservation保持不变，body逐次相同。成功、第三次耗尽与中途known error分别固定request count。
- **AC-16** envelope parser严格验证Operation ID/kind=`createBlobResource`/state/timestamps/result/error、Upload ID/Operation ID/Node ID/Resource ID/state/name/filename/sizes/media/hash/timestamps及uploadTarget。waiting必须有`PUT` target；非waiting的null target合法；malformed enum/number/envelope为`workspace-invalid-response`。
- **AC-17** reserve与每次status refresh都绑定同一Operation、Upload Session和public intent；wrongOperation kind/ID、Upload operationId、refreshed uploadId、name、filename或byte size均为既有`workspace-result-mismatch`，在identity不明时不继续PUT/complete/read-back。
- **AC-18** waiting state只PUT `/api/blob-upload-sessions/:uploadId/content`，使用`application/octet-stream`、首次source size Content-Length、stream body、Cookie/client role/write Origin；PUT不更换intent/key/source，不以buffer全量读替代stream。mixed/truncated source在complete前失败。
- **AC-19** PUT response unknown时每次只读一次Session status：status已离开waiting则不重放PUT；仍waiting才允许下一bounded attempt；PUT和status均unknown或一直waiting时最多各3次后返回现有result-unknown。测试记录method/path顺序与PUT body attempt count。
- **AC-20** 状态驱动固定为waiting→PUT、uploaded→complete、verifying→status refresh、completed→Resource read-back；failed/expired/aborted不得再写。外层恢复最多3轮，不增加timer、sleep、polling daemon、offset resume或补偿操作。
- **AC-21** complete只POST `/api/blob-upload-sessions/:uploadId/complete`。response unknown时先读一次Session；observed completed只做Resource read-back且不重放complete，observed uploaded才可在下一bounded轮重试complete，status unknown保持既有result-unknown。测试固定complete/status/resource次数和顺序。
- **AC-22** failed/expired/aborted立即返回`workspace-blob-upload-terminal`；bounded waiting/uploaded/verifying无法收敛、PUT/complete/status/Resource read-back无法确认时返回既有`workspace-result-unknown`。error detail必须含稳定public intent、uploadId/state或cause等既有字段，不含Cookie、response body或无界数据。
- **AC-23** completion response和completed read-back严格绑定reserved Operation ID、Upload ID、Node ID、Resource ID、Space、parent/null、name、Blob kind与byte size；wrong published Operation/Node/Resource identity或kind为invalid/mismatch既有语义。成功result保持`idempotencyKey, uploadId, operationId, nodeId, resourceId, name, originalFilename, byteSize, mediaType, availability, node, resource`字段与顺序/JSON兼容。

### Blob metadata与download

- **AC-24** Blob get只GET `/api/resources/:resourceId`，严格解析detached Node与Resource；requested Resource、top-level Resource、Node embedded Resource必须相同，kind必须为blob，Node ownership representation不得静默重绑。覆盖wrong ID/kind/Node和invalid parser branch。
- **AC-25** download仅在Blob `availability: ready`且`capabilities.downloadContent: true`时继续；否则保持`workspace-blob-download-unavailable`及bounded Resource/availability/capability detail，不建立content destination或发download request。
- **AC-26** Blob download保留调用时序：第一次authenticated HTTP读取metadata，随后local target preflight，成功后第二次取得当前authenticated HTTP并GET `/api/blob-resources/:resourceId/download`。non-force output已存在时metadata request已发生，但content request与第二次Session lookup均为0；tests固定provider/request counts。
- **AC-27** Blob response必须有body与nonempty Content-Type；optional Content-Length必须等于Resource byteSize，实际stream也必须精确等于Resource byteSize。成功结果保持`resourceId, nodeId, outputPath, byteSize, mediaType`与optional `etag`，文件为exact bytes/`0600`；任一metadata/stream mismatch均不提交并清temp。

### Asset sign、content与download

- **AC-28** Asset IDs先trim并要求nonempty；sign request精确编码为`/universer-api/worktrees/:worktree/file/:asset/sign-url`并传播optionalAbortSignal。service `error` envelope必须为record、code为string/number、message为string，只有numeric code `1`视为成功；其他code/message保持既有coded error。
- **AC-29** sign URL必须为nonempty可解析HTTP(S)且无username/password；relative URL以Workspace origin解析，same-origin与cross-origin均允许。malformed、`file:`或embedded credentials在content fetch前返回`workspace-invalid-response`。
- **AC-30** signed content使用既有`WorkspaceHttp.content()`且`redirect: manual`：same-origin携当前Workspace Cookie，cross-origin必须无Cookie/role/Origin等Workspace credentials；3xx拒绝且不跟随，same-origin 401与其他HTTP error code/detail保持不变。tests记录fetch count、headers和redirect location未访问。
- **AC-31** Asset download保留时序：先取得一次authenticated HTTP，再准备destination，最后请求sign/content；non-force output已存在时provider为1次、sign/content fetch均0次，文件保持原样。`--force`只改变本地commit，不改变sign/content请求。
- **AC-32** content response必须有body和nonempty Content-Type；Content-Length缺失可接受，存在时必须为nonnegative safe integer并与实际stream完全一致。invalid sign/content metadata、short/long/throwing stream均返回既有coded error且不提交destination、不留temp。
- **AC-33** Asset成功result固定为`assetId, byteLength, mediaType, outputPath, worktreeId`与optional `etag`，file bytes逐字等于signed response且权限`0600`。direct tests分别覆盖有/无length、ETag和cross-origin；不增加hash、resume或redirect follow。

### CLI parity、consumer import与交付

- **AC-34** CLI保留`blob upload|get|download`和`asset download`的command name、description、arguments、required/options及help：`--file --space --parent --name --media-type --idempotency-key --resource --id --worktree --force --json`；Commander仍只映射参数，不拥有protocol/file workflow。
- **AC-35** `program.ts`仅以现有`() => auth.authenticatedHttp("client")`装配Core Blob/Asset feature；Session path/bytes/mode、normalized-origin选择及AC-14/26/31的lookup时序不变。command/built-entrypoint fixture断言Cookie、client role、write Origin及Session corruption/auth hint仍走既有Shell路径。
- **AC-36** JSON envelope保持Blob upload`{ upload }`、Blob get`{ node, resource }`、Blob/Asset download`{ download }`；默认text仍为同一pretty JSON与末尾newline。coded failure保持stderr、empty/unchanged stdout、`workspace.command.failed`和exit 1；`--force`只在显式提供时传入Core。
- **AC-37** `features/content/source.ts`从Client Core根入口导入Asset resolver和content metadata helper，现有content-source Asset case保持endpoint、encoded IDs、bytes/media/contentLength结果；不得在本Change迁移`WorkspaceContentSource`、snapshot/target/runtime，也不得以此扩大到screenshot或embedded-image tests/owners。
- **AC-38** clean installed artifact在临时cwd/home中真实执行至少Blob upload/get/download与Asset download；fixture断言reserve/PUT/status/complete/Resource/sign/content exact request counts、stable key、cross-origin cookie isolation、JSON shape、exact output bytes、private mode和显式force。tarball无`.ts`/source/test/map、unresolved workspace bare import、private Core runtime dependency或checkout dependency。
- **AC-39** Core/CLI typecheck、test、build、repository typecheck/test/build、clean package build、package verify/smoke与`git diff --check`全部exit 0；before/after Server/OpenAPI/generated和Session/config限定diff为空。若无Server change，不运行或要求新的Server capability。
- **AC-40** QA不得为内部搬移差异要求通用filesystem abstraction、remote filesystem adapter、新transport/auth seam、service container、factory hierarchy或大compatibility layer；验收只要求既有local Node、remote protocol、CLI与artifact合同。不把Office、screenshot、embedded images或后续content-runtime能力作为本Change完成条件。

验收项总数：**40**。

## 执行命令

### 前置、owner与scope

```bash
pnpm --filter @univerjs/univer-workspace-client-core typecheck
rg -n 'WorkspaceHttp|AuthenticatedWorkspaceHttp|WorkspaceBlobResource|parseDetachedNode|parseNodeResource|WorkspaceApplicationError' \
  packages/client-core/src/index.ts
rg -n 'WorkspaceAuth|@univer-cli/config|commander|sessionPath|credential|apps/cli' \
  packages/client-core/src --glob '*file*.ts' --glob '*blob*.ts' --glob '*asset*.ts'
rg -n 'client-core/(src|dist)' apps packages --glob '*.ts' --glob '*.mjs'
rg -n 'interface .*File|FileSystemProvider|FilesystemProvider|RemoteFile|E2B|Sandbox' \
  packages/client-core/src --glob '*file*.ts' --glob '*blob*.ts' --glob '*asset*.ts'
```

第一项export搜索必须找到既有根exports。Core forbidden-owner搜索预期无CLI/application匹配；具体`SourceFile`和`DownloadTarget`数据类型不算filesystem abstraction，但不得出现可替换provider/adapter。

实施后检查旧owner消失与consumer imports：

```bash
test ! -e apps/cli/src/files.ts
test ! -e apps/cli/src/features/blob/transfer.ts
test ! -e apps/cli/src/features/asset/content.ts
test ! -e apps/cli/src/features/asset/download.ts
rg -n '@univerjs/univer-workspace-client-core' \
  apps/cli/src/features/{blob,asset,content} apps/cli/src/program.ts \
  apps/cli/test/application-command-contracts.test.ts apps/cli/test/content-source.test.ts
```

### 最小相关检查

```bash
pnpm --filter @univerjs/univer-workspace-client-core typecheck
pnpm --filter @univerjs/univer-workspace-client-core build
pnpm --filter @univerjs/univer-workspace-client-core test
pnpm --filter univer-workspace-cli typecheck
pnpm --filter univer-workspace-cli build
pnpm --filter univer-workspace-cli exec vitest run --config vitest.config.ts \
  test/application-command-contracts.test.ts \
  test/content-source.test.ts \
  test/auth-transport.test.ts \
  test/workspace-cli.test.ts
```

Core测试必须包含真实filesystem cases和记录完整HTTP request序列的Blob/Asset fixture。若CLI的`application-features.test.ts`或`files.test.ts`在迁移后删除，不要求保留文件名；其纯workflow assertions必须能在Core tests中逐项定位。

### Clean package与installed fixture

```bash
pnpm --filter @univerjs/univer-workspace-client-core run clean
pnpm --filter univer-workspace-cli run clean
pnpm package:workspace-cli
pnpm --filter univer-workspace-cli package:verify
pnpm --filter univer-workspace-cli package:smoke
```

QA检查smoke fixture实际从安装目录的bin执行命令，并读取临时输出的bytes/mode；只加载`blob --help`或`asset --help`不能满足AC-38。

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
  apps/workspace/contracts/http apps/workspace/generated/http apps/workspace/server
git diff --name-only <before-tree> <after-tree> -- \
  apps/cli/src/features/exchange apps/cli/src/features/screenshot \
  apps/cli/src/features/embedded-images apps/cli/src/runtime apps/cli/src/features/auth
```

最后一组限定diff预期为空；若实际embedded-image目录名称不同，QA用`rg --files apps/cli/src`解析真实owner后重跑，不用不存在路径制造通过证据。

## QA观察记录

实现后逐项填入tree、test title、request/provider count、filesystem结果、package artifact与结论，不以tasks勾选或文件移动代替行为证据。

| 观察面 | 基线合同 | QA证据 | 结论 |
| --- | --- | --- | --- |
| Owner/Node boundary | 单一Core owner、local Node-only、无FS abstraction/CLI依赖 | 四个旧CLI owner均不存在；`files.ts`、`blob.ts`、`asset.ts`、`asset-content.ts`为唯一owner。forbidden owner、private source/dist import和filesystem provider/adapter搜索为空；Core只接收既有`AuthenticatedWorkspaceHttp`。 | pass |
| Source stream | regular file、首次size、增长/缩短/read failure | Core `files.test.ts`覆盖unavailable/non-regular、增长、缩短和read failure；源码确认首次`stat`、absolute path、basename与bounded byte stream。 | pass |
| Atomic target | same-dir `0600` temp、fsync、link/rename、race/cleanup | Core真实filesystem cases覆盖`wx`/`0600`、same-dir temp、partial write循环、`sync()`、non-force hard-link竞争、force rename、失败保留旧文件及temp清理；9个相关case通过。 | pass |
| Blob reserve/parser | stable intent、strict Operation/Upload、attempt counts | reserve unknown固定3次、同一key/body；terminal、wrong kind/Upload operation ID及首次refresh identity tests通过。源码逐字段审查Operation/Upload parser。 | pass |
| Blob state machine | PUT/verify/complete/read-back、no replay、terminal/unknown | 常规recovery test固定PUT=1、complete=1、status=2；waiting序列固定3次PUT/GET。fix复验确认complete unknown后的外层二次read-back与原reservation绑定，identity替换时complete=1、Resource=0，`FT-QA-001`已关闭。 | pass |
| Blob retrieval | Resource/Node identity、availability、metadata/length/ETag/exact bytes | Core direct tests覆盖wrong Resource、quarantined、缺失metadata、exact bytes/ETag；package smoke执行真实get/download。fix复验确认completed Resource read-back unknown保留stable public intent/upload state且不含Session Cookie，`FT-QA-002`已关闭。 | pass |
| Asset transfer | sign envelope/URL、cookie isolation/redirect、preflight/metadata/exact bytes | invalid envelope/URL/protocol/credentials、same/cross-origin Cookie、manual redirect、missing type、short stream及output preflight direct tests通过；installed smoke确认exact bytes、ETag与跨源无Workspace headers。 | pass |
| CLI/content consumer | options/force/JSON/text/errors/Session timing、content-source imports | 4个定向CLI files/38 tests通过；command/program diff仅装配public Core feature/type，content-source只切换resolver/content-length imports；Session/config/auth限定diff为空。 | pass |
| Installed artifact | installed Blob/Asset commands、requests、bytes/mode、self-contained bundle | clean package产生203 files（packed 13,023,875 bytes）；verify通过；安装tarball smoke真实执行Blob upload/get/download与Asset download，断言exact request counts、stable key、bytes、`0600`、force和cookie isolation。 | pass |
| Full gate/scope | repository gates、Server/Session/excluded capability diff、无compatibility layer | Core 7 files/149 tests、CLI 19 files/86 tests、Workspace 34 files/152 tests、reference-provider 2 files/16 tests及全仓typecheck/build均通过；Server/OpenAPI/generated和排除能力diff为空，`git diff --check`通过。 | pass |

发现能力差异时先记录公开合同、稳定复现、request/file证据和影响命令。不得为一致性引入filesystem provider、remote adapter、第二transport/auth seam、通用Client Shell abstraction或大规模compatibility layer。

## AC逐项结论

| AC | 结论 | 主要证据 |
| --- | --- | --- |
| AC-01 | pass | 新exports只进入既有private Client Core根入口；无新package、Browser entry或发布版本。 |
| AC-02 | pass | README/source保持local Node filesystem边界；无filesystem provider/interface、remote adapter或factory。 |
| AC-03 | pass | Core transfer owner无CLI/Auth shell依赖，只消费lazy `AuthenticatedWorkspaceHttp`。 |
| AC-04 | pass | 四个旧CLI owner删除，Core保留唯一实现；无shim或复制body。 |
| AC-05 | pass | Blob/Asset/program/content-source均从package根导入；无Core source/dist路径。 |
| AC-06 | pass | Server/OpenAPI/generated、Session/config及Office/screenshot/runtime等限定diff为空。 |
| AC-07 | pass | unavailable/non-regular direct tests及源码确认absolute regular source、safe size、basename和bounded detail。 |
| AC-08 | pass | 增长、缩短、read failure direct tests通过；实现按首次size限制stream，不增加hash/mtime检查。 |
| AC-09 | pass | same-dir unpredictable `wx`/`0600` temp和remote request前preflight由测试及源码确认。 |
| AC-10 | pass | partial write循环、`sync()`、hard-link exclusive commit、竞争者保留和temp清理通过。 |
| AC-11 | pass | force仅在完整write/size/fsync/close后rename；失败stream保留旧destination。 |
| AC-12 | pass | short/stream failure、force/non-force竞争及discard路径均不留下partial final/temp；错误映射保持kind-specific。 |
| AC-13 | pass | null body、reader lock与invalid Content-Length矩阵通过；stream error传播至atomic cleanup。 |
| AC-14 | pass | local input在authenticated provider前验证；missing source fixture确认provider 0调用。 |
| AC-15 | pass | reserve最多3次，idempotency key及逐字body稳定；known error不进入unknown retry helper。 |
| AC-16 | pass | Operation/Upload/envelope字段和enum严格parser源码审查通过；malformed/kind/operation identity direct cases通过。 |
| AC-17 | pass | fix复验的替换identity case在第二次status后返回mismatch；complete仅1次、Resource read-back为0，`FT-QA-001`关闭。 |
| AC-18 | pass | PUT exact endpoint、type、length、stream、Cookie/role/Origin由Core request log与installed fixture确认。 |
| AC-19 | pass | waiting fixture精确得到3组PUT/GET；confirmed uploaded/completed后不重放已确认write。 |
| AC-20 | pass | 状态dispatch、terminal 0 additional write与固定3轮bound通过；构造器不再公开attempt override，运行时额外传`0`或`99`仍各发3次reserve，无无限/0次路径。 |
| AC-21 | pass | complete unknown首先单次status；常规fixture固定complete/status/resource顺序且不重放confirmed completion。 |
| AC-22 | pass | completed Resource unknown返回既有code/message，detail含stable intent、`uploadId`、`state`、bounded cause且不含Session Cookie，`FT-QA-002`关闭。 |
| AC-23 | pass | completion恢复的每次status均绑定reserved Operation/Upload/Node/Resource；替换identity不会再次complete或读Resource。 |
| AC-24 | pass | exact Resource endpoint、top-level与embedded Resource一致性、kind和Node ownership checks通过。 |
| AC-25 | pass | unavailable/capability拒绝在content request与target建立前完成，bounded detail保持。 |
| AC-26 | pass | 源码确认metadata→preflight→第二次provider→content时序；Asset对应provider/request count direct case及CLI Session fixture通过。 |
| AC-27 | pass | Blob body/type/length/actual bytes、ETag/result和`0600`由direct/installed tests确认；失败清temp。 |
| AC-28 | pass | exact encoded sign endpoint、AbortSignal、service envelope/code/message parser审查及invalid direct case通过。 |
| AC-29 | pass | relative/same/cross-origin URL允许；malformed/non-HTTP/credentials均在content fetch前拒绝。 |
| AC-30 | pass | same-origin仅保留Cookie，cross-origin无Workspace headers；manual redirect不follow且coded error保持。 |
| AC-31 | pass | output preflight时provider=1、sign/content=0；`--force`只作用local commit。 |
| AC-32 | pass | body/type/length validation与short/error cleanup通过；缺失Content-Length由resolver same/cross-origin success case覆盖。 |
| AC-33 | pass | exact Asset bytes、`0600`、shape/ETag由direct与installed cases确认；无length resolver case通过。 |
| AC-34 | pass | command合同测试和source diff确认Blob/Asset命令、options、help及显式`--force`不变。 |
| AC-35 | pass | `program.ts`继续用`() => auth.authenticatedHttp("client")`；Session/auth fixtures与限定diff通过。 |
| AC-36 | pass | CLI JSON/text/coded error tests通过；installed smoke核对四类结果envelope。 |
| AC-37 | pass | content-source仅从Core根导入Asset resolver/content length；target/snapshot/runtime实现未迁移。 |
| AC-38 | pass | installed tarball真实transfer smoke通过，bundle无checkout/private Core runtime dependency。 |
| AC-39 | pass | Core/CLI/package/repository gates和`git diff --check`全为exit 0；Server scope为空。 |
| AC-40 | pass | diff未引入通用FS/remote adapter、transport/auth seam、container/factory或compatibility layer；排除能力未纳入。 |

最终结果：**40/40 pass，0 个 open issue；Ready**。

## 实际执行命令

```bash
openspec status --change extract-file-transfer-client-core --json
openspec instructions apply --change extract-file-transfer-client-core --json
git diff --name-status 20bbc9bc6cc2bea29e8fa50706e40401425d0a7a ea39f8cc6af8958faf7a9138d59971cfb4082519
rg -n 'WorkspaceHttp|AuthenticatedWorkspaceHttp|WorkspaceBlobResource|parseDetachedNode|parseNodeResource|WorkspaceApplicationError' packages/client-core/src/index.ts
rg -n 'WorkspaceAuth|@univer-cli/config|commander|sessionPath|credential|apps/cli' packages/client-core/src --glob '*file*.ts' --glob '*blob*.ts' --glob '*asset*.ts'
rg -n 'client-core/(src|dist)' apps packages --glob '*.ts' --glob '*.mjs'
rg -n 'interface .*File|FileSystemProvider|FilesystemProvider|RemoteFile|E2B|Sandbox' packages/client-core/src --glob '*file*.ts' --glob '*blob*.ts' --glob '*asset*.ts'
test ! -e apps/cli/src/files.ts
test ! -e apps/cli/src/features/blob/transfer.ts
test ! -e apps/cli/src/features/asset/content.ts
test ! -e apps/cli/src/features/asset/download.ts
pnpm --filter @univerjs/univer-workspace-client-core typecheck
pnpm --filter @univerjs/univer-workspace-client-core build
pnpm --filter @univerjs/univer-workspace-client-core test
pnpm --filter univer-workspace-cli typecheck
pnpm --filter univer-workspace-cli build
pnpm --filter univer-workspace-cli exec vitest run --config vitest.config.ts test/application-command-contracts.test.ts test/content-source.test.ts test/auth-transport.test.ts test/workspace-cli.test.ts
node --input-type=module  # built-Core Blob completion identity与completed Resource unknown补充探针
pnpm --filter @univerjs/univer-workspace-client-core run clean
pnpm --filter @univerjs/univer-workspace-client-core run build
pnpm --filter univer-workspace-cli run package
pnpm --filter univer-workspace-cli run package:verify
pnpm --filter univer-workspace-cli run package:smoke
pnpm typecheck
pnpm test
pnpm build
git diff --check 20bbc9bc6cc2bea29e8fa50706e40401425d0a7a ea39f8cc6af8958faf7a9138d59971cfb4082519
git diff --name-only 20bbc9bc6cc2bea29e8fa50706e40401425d0a7a ea39f8cc6af8958faf7a9138d59971cfb4082519 -- apps/workspace apps/cli/src/session.ts apps/cli/src/config.ts apps/cli/src/auth.ts apps/cli/src/exchange apps/cli/src/screenshot.ts apps/cli/src/runtime packages/reference-provider
```

首次将package clean写成`pnpm --filter @univerjs/univer-workspace-client-core clean`时，pnpm把`clean`解释为内建命令并报`Unknown option: recursive`；改用明确的`run clean`后clean build/package/verify/smoke全链通过。该调用错误不是产品失败。

## Fix复验（2026-08-28）

复验范围：原implementation tree `ea39f8cc6af8958faf7a9138d59971cfb4082519` 至fix tree `9fd60bfe9cce5fd5670879d82f859086259d00bd`。产品diff只有`packages/client-core/src/blob.ts`与`packages/client-core/test/file-transfer.test.ts`；本轮未修改产品、OpenSpec或review文件。

| 修复项 | 复验证据 | 结论 |
| --- | --- | --- |
| `FT-QA-001` / review `STD-01`、`SPEC-01` | 新direct case按`reserve original uploaded → complete unknown → first status original uploaded → second status replaced operation/node/resource`响应。Core在第二次status后返回`workspace-result-mismatch`；计数为complete=1、status=2、Resource=0，不会再次complete或读取替换后的Resource。常规recovery仍为PUT=1、complete=1、status=2并成功返回原identity。 | closed；recovery始终锚定初始reservation identity，正常序列无回归。 |
| `FT-QA-002` / review `SPEC-02` | completed envelope后让Resource GET网络未知，得到`workspace-result-unknown`、2次总请求。detail keys为`byteSize,cause,declaredMediaType,idempotencyKey,name,originalFilename,parentNodeId,sourcePath,spaceId,state,uploadId`；`idempotencyKey=blob-key`、source path、`uploadId=upload-1`、`state=completed`均稳定。使用Cookie sentinel复验，序列化错误不含该sentinel。 | closed；stable public upload identity保留，未泄露Session secret。 |
| review `STD-02` maxAttempts | `WorkspaceBlobFeature`构造器只接收authenticated provider；source和生成`.d.ts`均无`maxAttempts`参数。源码只使用private module constant `BLOB_UPLOAD_MAX_ATTEMPTS = 3`。JavaScript运行时分别额外传入`0`、`99`，两次unknown reservation都精确请求3次、携同一stable intent且不泄露Cookie；waiting direct test仍精确为3组PUT/GET。 | closed；固定3轮，无public override、0次或无限recovery路径，也未引入retry policy abstraction。 |

复验实际执行：

```bash
git diff --check ea39f8cc6af8958faf7a9138d59971cfb4082519 9fd60bfe9cce5fd5670879d82f859086259d00bd
git diff --name-only ea39f8cc6af8958faf7a9138d59971cfb4082519 9fd60bfe9cce5fd5670879d82f859086259d00bd -- ':!docs/**' ':!openspec/**'
pnpm --filter @univerjs/univer-workspace-client-core typecheck
pnpm --filter @univerjs/univer-workspace-client-core build
pnpm --filter @univerjs/univer-workspace-client-core test
pnpm --filter @univerjs/univer-workspace-client-core exec vitest run --config vitest.config.ts test/file-transfer.test.ts --reporter verbose -t 'rejects a replaced Blob identity|preserves stable public upload identity|recovers Blob PUT and completion|bounds a Blob upload'
node --input-type=module  # built-Core固定attempt override与secret sentinel探针
node --input-type=module  # built-Corecompleted Resource unknown detail/secret探针
rg -n 'BLOB_UPLOAD_MAX_ATTEMPTS|maxAttempts|constructor\(' packages/client-core/src/blob.ts packages/client-core/dist/blob.d.ts
pnpm --filter univer-workspace-cli typecheck
pnpm --filter univer-workspace-cli build
pnpm --filter univer-workspace-cli exec vitest run --config vitest.config.ts test/application-command-contracts.test.ts test/content-source.test.ts test/auth-transport.test.ts test/workspace-cli.test.ts
pnpm --filter univer-workspace-cli run package
pnpm --filter univer-workspace-cli run package:verify
pnpm --filter univer-workspace-cli run package:smoke
```

结果：Core 7 files/151 tests、四个recovery定向cases、CLI 4 files/38 tests、Core/CLI typecheck与build全部通过；package产生203 files（packed 13,023,918 bytes），verify和installed tarball smoke通过；fix diff check通过。fix只触及两个声明的产品文件，风险与已跑gate匹配。复验后为 **40/40 pass，0 open issue，Ready**。

## QA issues

状态取值：`open`、`fixed-pending-qa`、`closed`、`accepted-risk`。

| ID | 严重度 | 证据 | 期望 | 状态 |
| --- | --- | --- | --- | --- |
| FT-QA-001 | high | 原复现见上；fix tree在外层第二次`getEnvelope()`后与初始`reserved`执行identity断言。direct回归得到`workspace-result-mismatch`，complete=1、status=2、Resource=0；常规recovery计数及结果保持。 | 每个恢复read-back都必须与初始reserved Operation/Upload/Node/Resource identity比较；identity变化应在再次complete或Resource read-back前返回既有`workspace-result-mismatch`，不得成功报告替换后的Resource。 | closed |
| FT-QA-002 | medium | 原复现见上；fix tree只捕获Resource `workspace-result-unknown`并补充stable public intent、`uploadId`、`state`和bounded cause。direct secret-sentinel探针确认字段完整且不含Cookie。 | 无法确认已发布Resource时保持既有`workspace-result-unknown` code，同时detail携带stable public upload intent和可用的upload identity；不得泄露Cookie/response body。 | closed |
