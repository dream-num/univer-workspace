# add-dsh-file-transfer-tools QA

本文件定义并记录 Change `add-dsh-file-transfer-tools` 的独立验收。QA 只更新本报告，
不修改产品代码、OpenSpec tasks 或产品测试。

## 环境与安全边界

- Workspace 使用 Node.js 24+、pnpm 11、SDK `1.0.0-beta.2`；真实 Server 为
  `http://127.0.0.1:3020`，禁止 `db:reset`。
- DSH 冻结为 `0.1.1-rc.2` / commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`。安装态
  必须使用 actual tarball 与隔离 profile，不使用 workspace link 或 source overlay。
- 真实路径只在唯一 QA Session cwd 内创建小型唯一前缀源文件与下载文件；远程只创建
  本轮 QA Blob Resource，不修改既有 Node、Resource、Worktree 或 Asset。
- 不读取或记录 credential、cookie、grant、signed URL 或原始 transcript。若 auth 失效，只把
  verification URL/code 发给 root，由 root 用 Chrome 授权，QA 不因 auth 阻塞。
- 结束时删除本轮 local files、tarball、profile、sentinel 和 raw Session evidence。Blob 第一版无
  delete tool；QA 只通过已交付的 `workspace_node_trash` 将 QA-owned owning Node 移入可恢复的 Trash，
  不调用未交付的 Blob 删除表面。

## 编号验收标准

### Client Core signal 与 public intent

- **AC-01** `WorkspaceBlobFeature.get/upload/download` 与 `WorkspaceAssetFeature.download` 只追加向后兼容的
  optional `AbortSignal`；CLI 无 signal caller 的 endpoint、mapping、identity、retry、output/error 不变。
- **AC-02** Blob get/Asset sign/content/Blob metadata/content 的 authenticated resolver 与每个 HTTP/content request
  都收到同一 signal，abort 后不开始下一步，不返回 partial result。
- **AC-03** upload 在 source inspect/stream、reserve、PUT、status、complete、Resource read-back 每个边界
  观察 signal；abort 后不再发 request/recovery/retry/complete。
- **AC-04** 取消与已 dispatch reserve/PUT/status/complete/read-back unknown 相撞时立即返回
  `workspace-result-unknown`，detail 保留 `idempotencyKey`、完整 public upload intent 及已知
  `uploadId`/state，不透传丢失身份的 transport-only unknown/cause。
- **AC-05** source/response streaming、destination writes 和 atomic publication 观察 signal；publication 前取消时
  non-cancellable cleanup 关闭 handle、删除 private temp、保留原 destination，publication 后 Core 可返回 confirmed success。
- **AC-06** stable identity 与 Blob 三次 bounded recovery 在无 signal 时保持原行为；已确认写不重放，
  signed Asset 不泄露 cookie、不 follow redirect、不接受 URL credentials。

### 四个 closed tools 与 local execution world

- **AC-07** Native schemas 与 Code SDK 精确增加 `workspace_blob_get`、`workspace_blob_upload`、
  `workspace_blob_download`、`workspace_asset_download`，四个 root 均 `additionalProperties: false`。
- **AC-08** parameters 只包含各 operation 的 snake_case fields，拒绝 generic action、origin/cookie/password、
  inline/base64/attachment/URL/command、remote FS selector、Office/content/render 和 arbitrary JSON。
- **AC-09** exact-own-key、non-blank identity、name/media type/idempotency key 与 boolean force 在 path/credential/
  I/O/HTTP 前校验；canonical Node/Blob/Operation/upload/download/Asset 在 render/Code value 前严格校验。
- **AC-10** 三个 file-bearing body 在解析任何 model path 前以精确 rc.2 public constructor 证明
  `ctx.fs instanceof LocalFileSystem`；bare LocalFS 与 in-process sandbox subclass 通过，E2B/其他 provider 拒绝。
- **AC-11** non-local/未证明 provider 以 `workspace-local-filesystem-required` 在 zero resolve/contains/
  `processPath`/ask/credential/Core/Host I/O 下失败；undefined `sandboxMode` 本身不等于 local。
- **AC-12** file-bearing call 必须有 Agent Session cwd；relative/absolute/`..`/symlink 都通过 DSH canonical
  identity 校验 cwd containment，越界以 `workspace-file-path-outside-session` 在 credential/I/O 前失败。
- **AC-13** upload 在 approved body 内证明 local、解析 cwd/source、通过 `ctx.fs.stat` 确认 regular file，
  之后才 `processPath()`/authenticated Core；missing/non-file 无远程请求。

### Download policy 与 approval ordering

- **AC-14** confining filesystem 缺少 public sandbox-policy service 时 composition fail closed，不注册可绕过的
  download surface。
- **AC-15** read-only pre-execute 先于 provider identity、argument/path interpretation、approval、body、credential/I/O
  返回 typed `workspace-file-policy-denied`，不泄露 policy root/provider/cause，0 ask。
- **AC-16** workspace-write preflight 在 local proof 后要求 canonical output 同时属于 current
  `workspaceRoot` 与 Session cwd；danger-full-access 和 bare local 仍必须属于 Session cwd。
- **AC-17** eligible download preflight 只执行 current policy→constructor→pure args/canonical containment，不
  stat/open/read/create destination、不 `processPath`/credential/HTTP，不缓存 policy/path。
- **AC-18** approved body 从 immutable arguments 重做 exact validation 与 current policy→constructor→path gates；
  policy narrow/widen、provider replacement、symlink drift 都不能借 approval 绕过，不二次 ask。
- **AC-19** 一个 fiber-owned policy 对 upload 和 eligible Blob/Asset downloads 返回 fixed secret-free `ask`；
  Blob get/其他 tools 委托。reject/cancel/unavailable/no-channel 全部在 body credential/I/O 前 fail closed。

### Transfer semantics、errors 与 lifecycle

- **AC-20** Blob get 返回 closed `{ node, resource }`，确认 requested Resource、Blob kind、owning Node、
  availability/capabilities/media type/byte size。
- **AC-21** upload 返回 closed `{ upload }`，确认 stable idempotency、Upload Session/Operation/Node/Resource、
  target Space/parent/name/original filename/media type/byte size；settled failure 无 shell retry。
- **AC-22** Blob/Asset download 返回 closed `{ download }`，仅在 exact bytes、private `0600` temp、fsync 与
  atomic commit 后返回 canonical output path/identity/media type/ETag。
- **AC-23** default no-clobber 拒绝既有或 racing destination、保留原文件并删除 temp；只有显式
  `force: true` + 本次 approval 才 atomic replace，stream/size/cancel failure 不破坏原文件。
- **AC-24** exact transfer/common/Server/path error allowlist 保留 stable code 和精确 JSON-safe detail；其他
  code/provider/fs/transport/dependency 映射 `workspace-file-operation-failed`。
- **AC-25** result/render/Session/approval/installed transcript 不包含 password/cookie/Set-Cookie/grant/signed URL/
  source bytes/temp filename/provider/cause/unknown detail；path error 只保留安全 requested/canonical path。
- **AC-26** already-aborted caller 以 `ABORTED_BEFORE_DISPATCH` 在 zero approval/path/credential/fs/HTTP 下失败；
  accepted body 融合 caller/owner signal 并追踪至 cleanup/recovery settle。
- **AC-27** dispatched upload unknown 保留 Core `workspace-result-unknown` + public intent/known session identity，
  不被 cancelled/disposing 覆盖；download read abort 在 cleanup 后按 caller/owner 来源分类。
- **AC-28** caller-aborted late upload/local commit success 由 rc.2 返回 canonical `ABORTED`，finalizer 只加
  inspect destination/Blob/Space-before-retry guidance；owner-only confirmed success 可在 drain 中成功。
- **AC-29** disposal 停止 admission，注销 4 tools/policy，abort owner work 并 drain path/stream/HTTP/recovery/
  cleanup；无 handle/temp/listener/timer/Job/cache/detached promise 存活。

### Artifact、真实环境与兼容性

- **AC-30** tarball 内联 reachable private Blob/Asset/files Core；exact DSH/Cordis/fs/local/sandbox/policy peers external；
  不含 bare Core、CLI/Server source、remote adapter、inline bytes、worker/native/Office/render/Web/Skill/later capability。
- **AC-31** isolated installed smoke 覆盖 4 schemas、read-only、workspace-write dual roots、danger/bare cwd、
  non-local zero-path、policy/provider/path recheck、approval、Blob/Asset transfers、no-clobber/force、abort/unknown/
  secrecy/cleanup/dispose，无 adjacent checkout runtime import。
- **AC-32** real Native ToolRuntime 和 Code Mode 实际 dispatch 代表 get/upload/download；argument/result/error/
  approval 与 start/settled events 符合 closed schema、secrecy 与 no-retry 约束。
- **AC-33** installed real Agent scheduler 能发现并调用 Blob metadata/upload/download 及 Asset download 中可控的
  vertical slice，不 direct import source、不调 CLI subprocess。
- **AC-34** 真实 Workspace `:3020` 使用 QA-only source/Blob：一次 upload shell call、get/read-back identity/
  byte metadata 一致、Blob download bytes/permissions/ETag 一致、default no-clobber 保留文件、显式 force
  在一次新 approval 后替换；任何 unknown 时停止写并只 inspection。
- **AC-35** 真实 Asset download 只使用 QA 可控 Worktree/Asset；若当前无安全 QA Asset，不借用/
  修改既有内容，以 installed signed-content integration + 真实 Blob vertical 作为边界证据并明确记录。
- **AC-36** Host 正常退出，local QA files/tarball/profile/transcript/sentinels 删除；报告不记录 secret
  或 raw IDs，并记录 QA-owned remote Blob 的可控 cleanup disposition。
- **AC-37** 两份 README 准确记录 4 names、Host-local/Session-cwd/policy matrix、single approval/no escalation、
  overwrite/signal/result-unknown/non-goals；CLI Blob/Asset command/output/Session/package 不变，Server/OpenAPI/SDK/release/deploy 无越界 diff。
- **AC-38** Core/DSH focused typecheck/test/build、package verify/smoke、CLI contract/package、OpenSpec strict、
  repo typecheck/test/build 和 `git diff --check` 全部 exit 0；retry-only/flaky green 不关闭 issue。

验收项总数：**38**。

## 测试矩阵

| 规格组 | 直接证据 |
| --- | --- |
| Core signals | abort-observing resolver/fetch/stream/write，每个 upload recovery edge request count 与 public intent |
| Closed tools | Native/Code schemas、direct body extra-key、invalid canonical output before render |
| Local identity/path | exact `LocalFileSystem`/subclass positive，E2B-like negative，missing cwd、relative/absolute/`..`/symlink |
| Policy/approval | read-only before provider/path/ask，workspace-write dual roots，danger/bare cwd，pending-approval policy/provider/path drift |
| Transfer reliability | reserve/PUT/status/complete/read-back，signed Asset，no-clobber race，force/fsync/atomic，size/stream/temp cleanup |
| Error/secrecy | exact allowlist/detail，provider/policy/URL/cause/bytes sentinel negative scan across Native/Code/installed events |
| Lifecycle | pre-dispatch abort、pre-write cancel/dispose、dispatched unknown、late confirmed ABORTED、owner success/drain/unregister |
| Package | actual manifest/files/import scan，isolated installed ToolRuntime/Agent with local/sandbox/non-local compositions |
| Real Workspace | QA-only source→upload→get→download→no-clobber→force，optional controlled Asset，0 blind replay |
| Compatibility | CLI contracts/package、OpenSpec、repo gates、scope diff、README |

## Issues

问题发现后立即发给 `/root/space_node_implement`；修复后复验原 repro、相邻 race/security case 与
最小回归 gate，循环到 0 open。

| ID | Severity | Evidence | Expected | Repro | Status |
| --- | --- | --- | --- | --- | --- |
| WT-FT-QA-001 | Medium | DSH safe-detail projection 只保留 string `declaredMediaType`，会从 Core 明确的 public upload intent 丢掉 `declaredMediaType: null`；direct cancellation unknown 与 nested stable-identity `request` 均受影响。 | `workspace-result-unknown` 保留完整 public upload intent，同时继续丢弃 cause/unknown keys。 | `apps/dsh-univer-work/src/file-transfer.ts:646`、`:672` 对照 `packages/client-core/src/blob.ts:699`；补 direct+nested null projection tests。 | RESOLVED：direct completed-readback unknown 与 nested reserve stable-identity unknown 均保留完整 intent/null，且 cause sentinel 未反射。 |
| WT-FT-QA-002 | High | download pre-execute 直接调用 current policy；`sandboxPolicy.resolve()` 或 policy capability getter 的非 Harness 异常不经过 body `executeOwned` sanitizer，可能把 password/cookie sentinel 原样写入 result/Session。 | pre-execute 的未知 policy/provider failure 固定映射 `workspace-file-operation-failed`，0 ask/path/credential/body/I/O，且保留既有 typed policy/local/path errors。 | real ToolRuntime + throwing sandbox policy；扫描 result/Session/approval sentinel。 | RESOLVED：独立复跑 policy throw 与 in-flight resolve caller-abort cases，固定 generic/cancelled code、0 ask、result/Session 无 sentinel。 |
| WT-FT-QA-003 | High | 本 change 修改 bundled `skills/core/SKILL.md` 加入 Blob/Asset 指引，并让 package verify/smoke 正向要求这些 strings。 | 保留前置 change 的既有 core Skill artifact，但本 change 不扩展 file-transfer Skill；恢复对 `workspace_blob_`/file-transfer Skill 内容的 negative closure，用户文档仅更新两份 README。 | proposal Non-Goals、design:27、Task 6.1 与 delta spec packed-artifact scenario 对照当前 Skill/verify/smoke diff。 | RESOLVED：transfer Skill guidance 已完全回退；verify/smoke 恢复 `workspace_blob_`/`workspace_asset_download` negative closure，独立 package gates 通过。 |

## 实际执行结果

| 命令/探针 | 结果 |
| --- | --- |
| 初始实现快照 | Core `files.ts` 已有部分 signal-aware stream/atomic helpers；Blob/Asset 顶层方法尚无 signal，DSH 尚无四个 file tools。等待 implement checkpoint，不记 defect。 |
| Task 1 Core diff review | **PASS**：AC-01..AC-06 的四个 optional signal 入口、authenticated resolver/HTTP/content、source/response stream、destination write/cleanup、reserve/PUT/status/complete/read-back 与 public upload intent 均有 owner-level 检查；取消后的 upload unknown 不保留 raw transport cause，且不继续 recovery。无 signal 的原三次 bounded recovery、signed Asset 与 atomic no-clobber 分支保持原形。 |
| `pnpm --filter @univerjs/univer-workspace-client-core exec vitest run --config vitest.config.ts test/file-transfer.test.ts test/files.test.ts` | **PASS**，2 files / 51 tests；覆盖五个 upload dispatch phase 的 request-count/public identity、metadata/resolver abort、source/response cancel、temp cleanup 与 late confirmed publication。 |
| `pnpm --filter @univerjs/univer-workspace-client-core typecheck` | **PASS**。 |
| `pnpm --filter @univerjs/univer-workspace-client-core test` | **PASS**，27 files / 483 tests。 |
| `pnpm --filter @univerjs/univer-workspace-client-core build` | **PASS**。 |
| `git diff --check -- packages/client-core` | **PASS**。 |
| Task 2 source/order probe | policy→exact `LocalFileSystem`→canonical Session/policy-root containment→ask，以及 approved body exact args→current policy→constructor→path→`processPath` 的主顺序符合设计；non-local 在 path/ask 前拒绝。发现 WT-FT-QA-001。 |
| `pnpm --filter dsh-univer-work exec vitest run --config vitest.config.ts test/file-transfer.test.ts` | **PASS**，12/12；独立复验 closed schemas、read-only、non-local zero-path、outside cwd、bare LocalFS download、policy/provider secrecy 与 mid-preflight cancellation。 |
| `pnpm --filter dsh-univer-work test`（首个 DSH source checkpoint） | **PASS**，4 files / 170 tests（含 build）。 |
| focused `-t 'complete public upload intent'` | **PASS**，2 genuine upload unknown cases；WT-FT-QA-001 关闭。 |
| expanded `test/file-transfer.test.ts` checkpoint | **PASS**，15/15；含 canonical reserve→PUT→status→complete、direct/nested unknown intent、policy cancellation/secrecy。 |
| DSH `typecheck` + full `test`（expanded checkpoint） | **PASS**；typecheck exit 0，4 files / 173 tests，build exit 0。 |
| preliminary `package:verify` / `package:smoke` | **PASS**；actual tarball closure、installed Native/Code/Agent 基础 vertical 与 Skill negative closure 全绿；完整 policy/provider/lifecycle smoke 仍待最终 checkpoint。 |
| installed checkpoint source gates | **PASS**：file-transfer focused 36/36；DSH typecheck；full 4 files / 194 tests（含 build）；late caller `ABORTED` guidance、owner-only confirmed upload、stream cleanup、dispose drain 均绿。 |
| installed checkpoint artifact gates | **PASS**：`package:verify` 与 `package:smoke`；pack dry-run 精确 6 files，bundle 仅 runtime-import external `@deepseek-ai/dsh-fs-local` 且无 bare Client Core/remote adapter；actual installed LocalFS 四 tools、read-only、non-local zero-path/ask/credential、approval 后 narrowing 与 Skill negative closure 均绿。 |
| Task 3–5 source final candidate | **PASS**：focused 52/52；四工具真实 Code Mode success/failure 与 paired events、canonical upload/recovery/no ToolRuntime retry、Blob/Asset download/no-clobber/force、完整 allowlist/detail secrecy、caller/owner late confirmed upload/local commit、transfer stream cleanup 与 dispose drain 均绿。 |
| DSH source final-candidate gates | **PASS**：`typecheck` exit 0；full 4 files / 210 tests（含 build）exit 0；独立 `build` 与 scoped `git diff --check` exit 0。 |
| `git diff --check -- apps/dsh-univer-work packages/client-core docs/quality/dsh-univer-work/add-dsh-file-transfer-tools-qa.md` | **PASS**。 |
| Task 6 actual-tarball final | **PASS**：`package:verify` 与 `package:smoke` 均 exit 0。pack 精确 6 files；隔离安装使用真实 `@deepseek-ai/dsh-fs-sandbox` 与 exact LocalFS identity，覆盖四个 closed tools、workspace-write dual roots、danger/bare cwd、read-only/non-local zero-path/ask/credential、approval 后 policy/provider/path recheck、actual upload bytes、no-clobber/force/`0600`/temp cleanup、dispatched PUT unknown + 2 requests、owner dispose drain 与 Skill negative closure。 |
| installed real ToolRuntime / Agent / Code Mode | **PASS**：real Agent scheduler 调用四个 transfer tools；Code Mode 调用四个代表操作并验证 paired start/settled events、approved execution、canonical success/error 与零 secret reflection；installed runtime 不从相邻 checkout 导入。 |
| real Host setup | **PASS**：正常启动 Workspace `:3020`，未执行 `db:reset`；actual tarball 安装到新临时 DSH home，使用 rc.2 内建 `web` profile 启动 `:58421`。最初自定义 profile 无 listener，经核对实际启动合同改用 `web`，属于 QA harness 修正。复用 credential 有效；无 approval channel 的 headless mutation 在远程 I/O 前 fail closed。 |
| real Workspace Web Agent vertical | **PASS**：QA-only 29-byte source 经一次 `workspace_blob_upload` shell call 和一次 approval 返回 `UPLOAD_OK`；`workspace_blob_get` 返回相同 Resource identity/byte metadata；首次 download 经一次 approval 返回 `DOWNLOAD_OK`。既有 destination 的默认 no-clobber 返回 `workspace-blob-output-exists` 且原文件不变；制造 stale destination 后，显式 `force: true` 经一次新 approval 返回 `FORCE_OK`。Agent 无重试、无 blind replay。 |
| real byte/file verification | **PASS**：初次与 force 后 source/download 的 `cmp -s` 均 exit 0；最终 `size=29 mode=600`；private temp glob 为空。actual installed ToolRuntime read-back 探针确认 browse unique match、get/download identity match、byte size 29、ETag present，且 approval 事件仅对应 download。 |
| real Asset boundary | **PASS**：当前环境没有 QA 可控 Worktree Asset；依 AC-35 未借用或修改既有内容。以 actual installed signed-content/cross-origin Asset integration，加真实 Blob upload/get/download/no-clobber/force 纵向证据验收。 |
| remote/local cleanup | **PASS**：Web Agent 通过 `workspace_node_trash` 一次调用和一次 approval 将 QA-only owning Node 移入可恢复 Trash。DSH Host 与 Workspace 正常停止，`:58421`/`:3020` 均无 listener；QA 临时根目录已移入 macOS Trash 且原路径不存在。保留认证 home 仅有 `.credentials.yaml` 与 `settings.yaml`，无 `profiles/**`、`storages/workspace.json`、tarball、transcript 或 sentinel。报告未记录 secret、signed URL 或 raw product identity。 |
| README / compatibility scope | **PASS**：两份 README 覆盖四个 tool names、Host-local/Session-cwd、policy matrix、一次 approval、no-clobber/force、signal/result-unknown 与 non-goals；CLI focused command 实际运行 14 files / 69 tests，package artifact 13 tests PASS；File Transfer 未扩展 CLI/Server/OpenAPI/SDK/release/deploy contract。 |
| `openspec validate add-dsh-file-transfer-tools --strict` | **PASS**。 |
| repo `pnpm typecheck` | **PASS**，5 projects 全部 exit 0。 |
| repo `pnpm test` | **PASS**：SDK dependency 4、release 8、reference-provider 16、Core 486、DSH 210、Workspace 152、CLI 69，全部 exit 0。 |
| repo `pnpm build` | **PASS**，5/6 workspace projects 全部 exit 0。 |
| `pnpm package:workspace-cli` | **PASS**，self-contained CLI artifact 构建完成。 |
| repo `git diff --check` | **PASS**。 |

## AC 状态

| 范围 | 状态 | 结论 |
| --- | --- | --- |
| AC-01..AC-06 | **PASS** | Core optional signal、public intent、request boundary、atomic cleanup 与既有行为兼容均有 focused/full 证据。 |
| AC-07..AC-29 | **PASS** | 四工具 closed schema、LocalFS/path/policy/approval、transfer/error/secrecy/lifecycle 均经 source real ToolRuntime/Code Mode 验证。 |
| AC-30..AC-33 | **PASS** | actual tarball closure 与 isolated installed ToolRuntime/Agent/Code Mode 完整矩阵通过。 |
| AC-34 | **PASS** | 真实 `:3020` upload/get/download/no-clobber/force；`cmp`、`0600`、temp cleanup、ETag、identity 与 request/approval 次数符合规格。 |
| AC-35 | **PASS** | 无 QA-controlled Asset 时执行冻结的安全边界，未触碰既有 Asset；installed signed-content integration 与真实 Blob vertical 通过。 |
| AC-36 | **PASS** | QA-only owning Node 可恢复 trash；local/profile/transcript/tarball 清理完成，Host/Server 无 listener，报告无 secret/raw IDs。 |
| AC-37..AC-38 | **PASS** | README、CLI/package、OpenSpec strict、repo typecheck/test/build 与 diff-check 全绿。 |

## QA 结论

**PASS。** 38/38 AC 已独立验证通过，当前 **0 open**；WT-FT-QA-001..003 均已修复并复测关闭。
actual tarball、real ToolRuntime/Code Mode/Agent、真实 Workspace `:3020` 纵向验证与全部兼容性 gates 均通过。

## 2026-08-30 predecessor repair follow-up

### Repair finding

| ID | Severity | Evidence | Expected | Status |
| --- | --- | --- | --- | --- |
| WT-FT-QA-004 | High | `workspace_blob_upload` 的旧 pre-execute 分支仅按 tool name 返回 `ask`；DSH rc.2 的 definition validation 在 body 内执行，因此缺少必填值、额外 own key 或空白 optional string 会先触发 approval，再返回 `workspace-argument-invalid`。 | upload pre-execute 在 approval、credential、filesystem/path 与 HTTP 前执行与 body 相同的 exact/cross-field validator；合法调用仍只 ask 一次，并在 approved body 重验 immutable arguments。 | **RESOLVED**：pre-execute 与 body 现共用 `validators.workspace_blob_upload`。独立源码审计确认它拒绝非 plain record、非 enumerable/symbol own key、未知 key、schema/type 错误、空白 `source_path`/`space_id` 与空白 `parent_node_id`/`name`/`declared_media_type`/`idempotency_key`。真实 ToolRuntime 回归对 required blank、unknown key、optional blank 固定 `workspace-argument-invalid`，并断言 approval、credential read、FS `resolve/stat/processPath`、HTTP 均为 0；canonical 调用只产生一次 ask，拒绝 approval 后 body/dependency 仍为 0。 |

### Follow-up evidence

| 命令/检查 | 结果 |
| --- | --- |
| source/contract review | **PASS**：`workspace_blob_upload` pre-execute 在 `ask` 前调用 shared validator；definition wrapper 和 body 都再次调用同一 validator。validator 是纯参数检查，不读取 approval、credential、filesystem、owner 或 HTTP。历史 design 中 ask-before-validation 的两处表述由 planning owner 同步为当前 validation-before-ask 合同；本轮 bounded repair authority 优先于旧叙述。 |
| `pnpm --filter dsh-univer-work exec vitest run --config vitest.config.ts test/file-transfer.test.ts` | **PASS**，1 file / 53 tests。除新的 pre-approval zero-effect matrix 外，caller/owner cancellation、dispatched upload `workspace-result-unknown`、late confirmed success、download stream/temp cleanup、dispose drain 与 secret-negative 回归均通过。 |
| `pnpm --filter dsh-univer-work exec vitest run --config vitest.config.ts test/authentication.test.ts` | **PASS**，1 file / 63 tests；authentication owner/composition、四个 transfer tools mounting 与 credential boundary 保持。 |
| `pnpm --filter dsh-univer-work typecheck` | **PASS**。 |
| `pnpm --filter dsh-univer-work package:verify` | **PASS**；重新构建 Core/DSH/render artifact 后，actual tarball manifest、reachable graph、bundled Skills 与资源 closure 验证通过。 |
| `openspec validate add-dsh-file-transfer-tools --strict` | **PASS**；7/7 tasks 仍为 complete。修订后的 design 与刷新后的 `change.html` 都明确 upload pure validation-before-ask、approved-body revalidation，旧的 ask-before-validation 叙述已不存在。 |
| `git diff --check` 与 scoped diff check | **PASS**。 |
| process/temp audit | **PASS**：无 `vitest`、Vite、package verifier 或 DSH QA 进程；`dsh-univer-work-transfer-*`、`dsh-univer-work-pack-*`、`dsh-univer-work-smoke-*` 临时根均为 0。 |
| downstream parity classification | 冻结 parity snapshot 需要在 predecessor auth/file QA 与 review 完成后统一刷新；后续 Office sample boundary 属于 Office/parity owner。两者均不构成本 file-transfer repair finding，也不授权本 QA 修改 snapshot 或 Office 实现。 |

### Follow-up conclusion

**FILE-TRANSFER REPAIR PASS，0 open file-transfer findings。** WT-FT-QA-004 已关闭；invalid upload arguments
在 approval 与所有依赖前稳定返回 `workspace-argument-invalid`，合法 upload 保留单次 approval 和 body revalidation，
既有 cancellation/error projection 未变。整体 parity readiness 仍取决于冻结 snapshot 刷新和独立 Office boundary 收敛。
