# add-dsh-file-transfer-tools review

状态：PASS（0 open findings）

审查范围只包含 OpenSpec change `add-dsh-file-transfer-tools` 的实现与其直接触及的
Client Core、DSH composition、package 和兼容性边界。本报告不修改产品代码、测试或 tasks。

## 固定依据

- `openspec/changes/add-dsh-file-transfer-tools/{proposal.md,design.md,tasks.md}`
- `openspec/changes/add-dsh-file-transfer-tools/specs/**/spec.md`
- 根 `AGENTS.md`、`README.md`，DSH 与 Client Core README
- `apps/workspace/CONTEXT.md`、`apps/workspace/docs/data-model.md`、ADR 0007
- DeepSeek Harness `0.1.1-rc.2` exact public contracts as frozen by the change

实现位于 shared dirty worktree，没有可独立使用的 feature commit fixed point；审查以 change artifacts
为 Spec 固定点，并逐项读取 File Transfer 相关 dirty paths 及其 composition/package seams。

## Review checklist

| 轴 | 必须取得的直接证据 | 状态 |
| --- | --- | --- |
| Core cancellation | get/upload/download/Asset、resolver/HTTP/recovery/source/response/write/pre-commit signal；取消后零后续 request | PASS |
| Upload uncertainty | reserve/PUT/status/complete/read-back race 均重封装完整 public intent 与已知 Upload Session identity | PASS |
| Atomic output | exact bytes、private temp、fsync、no-clobber/force、abort cleanup、late confirmed commit | PASS |
| Local-world trust | exact public `LocalFileSystem` constructor identity；E2B/undefined-mode non-local 零 path/ask/I/O | PASS |
| Policy/approval ordering | confining provider requires policy；read-only before provider/args/path；download preflight before one ask；upload one ask | PASS |
| Path/body recheck | Session cwd、workspace-write dual roots、danger/bare cwd、symlink drift、immutable body revalidation before `processPath`/credential/Core | PASS |
| Contracts/secrecy | four closed schemas/outputs、invalid output before render、exact allowlist/detail projection、sentinel-negative results/events/approval | PASS |
| Lifecycle | one existing owner、caller/owner classification、result-unknown/finalizer guidance、dispose unregister/abort/drain/cleanup | PASS |
| Package/compatibility | exact external rc.2 FS/policy packages、reachable Core inline、isolated installed real FS smoke、CLI/repo gates unchanged | PASS |
| Standards/Ponytail | public exports only、named exports、no CLI/server import、no second owner/controller/FS abstraction/cache/Jobs/retry | PASS |

## Findings

Findings include severity, location, Spec/standard basis, reproduction evidence, minimum fix and status.

### REV-FT-01 — medium — `late confirmed publication` 测试没有制造 publication race

- 位置：`packages/client-core/test/files.test.ts:202-217`；对应实现边界
  `packages/client-core/src/files.ts:183-198`。
- 依据：Core delta spec 的 `Atomic publication already completed` scenario 要求 cancellation 与已完成的
  atomic destination publication 竞争；design 8 和 Task 1.1 要求固定 `late confirmed publication` / `late commit`
  的直接证据。
- 复现：当前测试先 `await writeDownload(...)`，在 Promise 已返回 confirmed result 后才调用
  `controller.abort(...)`。因此取消不可能与 `link`/`rename` 或 publication 后的函数收尾竞争；即使未来实现在
  publication 完成后错误地检查 signal 并拒绝本应 confirmed 的提交，这个测试仍会通过。
- 最小修复：在既有 atomic publish primitive 附近加测试 barrier，使测试在 `link`/`rename` 已完成、
  `writeAndCommit` 尚未返回时 abort，并断言 canonical success、目标完整且无 temp；不要为此增加新的生产抽象。
- 修复复验：测试内 `AbortSignal` barrier 在最后一个 pre-publication check 后排入 abort，atomic
  `link` 已 dispatch 且函数尚未返回；测试直接断 signal 已 abort、canonical success、完整目标及零 temp。
  未增加生产 seam。独立 focused/full Core gate 为 27 files / 483 tests PASS，typecheck PASS。
- 状态：CLOSED。

DSH File Transfer source 已进入逐项复审；完整 Task 2–6 evidence/package closure 仍在实现。

### REV-FT-02 — high — download pre-execute 的 policy/abort 异常可把原始秘密写入结果

- 位置：`apps/dsh-univer-work/src/file-transfer.ts:360-381,423-433,436-466`。
- 依据：delta spec `Workspace failure fidelity and secrecy` 要求 policy/provider/dependency failure
  只产生 fixed `workspace-file-operation-failed`，不得带原始 message/cause；Task 5.1 还要求 pre-execute
  caller cancellation 与植入 policy/provider sentinel 的 results/events/approval 均无反射。
- 复现：download pre-execute listener 没有 secret-safe catch。`sandboxPolicy.resolve()` 在
  `currentPolicy()` 中抛出的普通 `Error("<sentinel>")` 会直接越过 listener；同样，
  `resolveContainedPath()` 的 catch 在 signal aborted 时再次 `throwIfAborted()`，会透传 caller-owned
  abort reason。rc.2 `prepareExecution()` 对该异常直接调用 `toolErrorResult(error)`，其 content/error.message
  使用原始 `Error.message`，因此 sentinel 会进入 Tool result/Session event。
- 最小修复：在同一 transfer pre-execute listener 边界统一 catch；保留既有
  `FileTransferToolError`，将 caller abort 映射为 fixed typed cancellation，其余 policy/provider/path
  异常映射为 fixed `workspace-file-operation-failed`，并加 real ToolRuntime sentinel/metadata negative
  assertions。不要引入第二 error adapter 或 policy abstraction。
- 修复复验：同一 listener catch 现在保留 application-owned typed failure，将 in-flight caller abort
  映射为 fixed `workspace-operation-cancelled`，其余 raw policy/provider/path failure 映射为 fixed
  `workspace-file-operation-failed`。real ToolRuntime 测试分别注入 `sandboxPolicy.resolve` sentinel 和
  LocalFS `resolve` barrier；后者在 preflight 中途 abort，直接断 fixed code、零 approval 及 result +
  Session events sentinel-negative。独立 DSH build/test 为 4 files / 170 tests PASS。
- 状态：CLOSED。

### REV-FT-03 — medium — Task 2 已勾选但缺 danger/widening 与 body dual-root 直接证据

- 位置：`apps/dsh-univer-work/test/file-transfer.test.ts:313-428`；
  `openspec/changes/add-dsh-file-transfer-tools/tasks.md:9`。
- 依据：Task 2.1 明确要求覆盖 `workspace-write` dual-root、`danger` cwd、policy 变窄/变宽及 approved
  body 的 current policy → constructor → canonical path 重检；delta spec 也分别定义 danger-full-access 和
  approval 间 policy/provider/path 变化 scenarios。
- 复现：现有 workspace-write case 只在 preflight 验证 policy root，并以 approval rejected 结束；没有进入
  body 证明 dual-root 重检。policy-after-approval case 只覆盖 mode 收窄为 read-only。文件中没有
  `danger-full-access` case，也没有 widening case，但 Task 2.1 已标为完成。
- 最小修复：复用现有 approval barrier/local fake Server，增加最小 table：danger mode 下 Session 外路径
  零 approval、Session 内路径可到 approval；approved body 中 workspace-write root 改变后 target 逃逸即在
  credential/processPath/HTTP 前拒绝；以及一次 widening 后仍受 Session cwd 限制。无需新 helper/抽象。
- 修复复验：real ToolRuntime matrix 现直接覆盖 danger mode 的 Session 外 exact reject/零 ask 与
  Session 内 eligible ask；approval 后 workspace-write root 从 cwd 变成 nested root 时，body 在
  credential/HTTP 前拒绝旧 target；workspace-write widening 到 danger 后，相同 immutable Session 内
  target 成功。独立 DSH typecheck 及 build/test 为 4 files / 192 tests PASS。
- 状态：CLOSED。

### REV-FT-04 — medium — 非取消型下载失败没有取消底层响应流

- 位置：`packages/client-core/src/files.ts:220-242`；调用方
  `packages/client-core/src/files.ts:163-208`。
- 依据：Task 4.1 要求 stream/size failure cleanup，Task 5.1 与 delta spec 的 lifecycle/dispose
  requirements 要求没有 detached response stream；Core 的 file-transfer boundary 也负责完整 response
  streaming 与 cleanup。
- 复现：构造一个未关闭的 `ReadableStream`，先输出声明大小内的 chunk，再输出使总字节超限的 chunk。
  `NodeDownloadTarget.writeAndCommit()` 抛 `workspace-blob-size-mismatch` 并删除 temp，但下游提前结束
  `responseContent()` 时 signal 未 abort，`finally` 只执行 `reader.releaseLock()`。使用当前 build 的独立复现结果为
  `{"code":"workspace-blob-size-mismatch","cancelled":false,"locked":false,"files":[]}`：底层 source 的
  `cancel()` 未调用，流只是解除锁定。
- 最小修复：让 `responseContent()` 区分正常读到 EOF 与提前退出；任何未读到 `done` 的退出都 best-effort
  `reader.cancel()`，再释放 lock。增加一个 oversize 或 destination-write failure case，直接断 stream cancel 与
  temp cleanup；不要引入新的 stream wrapper。
- 修复复验：`responseContent()` 现在仅在 reader 返回 `done` 时标记完成；所有未完成退出都会
  best-effort `cancel()` 后释放 lock。新增 real response oversize case 直接断
  `workspace-blob-size-mismatch`、source cancel 与零 temp；既有正常 EOF 和 caller-abort cases 保持通过。
  独立 Core typecheck 及 27 files / 484 tests PASS，diff check PASS。
- 状态：CLOSED。

### REV-FT-05 — medium — 响应 metadata 校验失败会遗留未消费的 body stream

- 位置：`packages/client-core/src/blob.ts:204-234`；
  `packages/client-core/src/asset.ts:28-47`。
- 依据：Task 4.1 要求 metadata/stream/size failure cleanup，Task 5.1 与 delta spec 要求没有 detached
  response stream。Client Core 在获取 response 后拥有该 body 的生命周期。
- 复现：Blob/Asset 都在构造 `responseContent()` 之前验证 `content-type`、body 与 Content-Length。
  若一个有 body 的 response 缺少 media type、Content-Length 非法或与 Blob metadata 不符，函数直接抛错，
  外层只 `discard()` destination target，没有取消 response body。使用当前 build 对 Asset missing-media-type
  独立复现得到
  `{"code":"workspace-invalid-response","cancelled":false,"locked":false,"files":[]}`。
- 最小修复：在 Blob 与 Asset 已取得 response 的同一局部边界保证 body 在所有退出路径 best-effort
  `cancel()`；完整消费/已由 `responseContent()` 取消后的重复 cancel 应保持无害。增加至少一个 Blob 与一个
  Asset pre-stream metadata failure，直接断 source cancel 与零 temp；不要增加新的 response abstraction。
- 修复复验：Blob 与 Asset 各自的 response 局部 `finally` 现在都会 best-effort cancel body，再清理
  destination target；正常 EOF 或 `responseContent()` 已取消时重复 cancel 无害。新增 Blob Content-Length
  mismatch 与 Asset missing-media-type 两个未消费 body cases，均直接断 cancel 与零 temp。独立 Core
  typecheck 及 27 files / 486 tests PASS，相关 diff check PASS。
- 状态：CLOSED。

## Final result

PASS，0 open findings。REV-FT-01..05 均已修复并独立复验，七个 tasks 全部完成。

- OpenSpec strict、actual-tarball package verify/smoke、CLI 14 files / 69 tests、repo
  typecheck/test/build 与 diff check 均通过；repo tests 包括 Client Core 486、DSH 210、Workspace 152、CLI
  69 与 reference-provider 16 tests。
- 文档、scope、CLI/Server/SDK/release/deployment compatibility 与 Ponytail full audit 通过。
- 独立 QA 38/38 acceptance criteria PASS；真实 `:3020`、actual tarball、ToolRuntime、Agent 与 Code Mode
  vertical 通过，远端测试资源进入 recoverable Trash，本地 transfer/profile/Server 临时状态已清理。

## Parity predecessor repair review

本轮只把 bundled-Skills 最终产品树
`17cbb1bdac05441cc46ddd1fce0e2e5f7a8eb53d` 之后的 File Transfer listener/test
窄 diff 计为产品 repair。最终冻结 blobs 为：

- `apps/dsh-univer-work/src/file-transfer.ts`：
  `6d8f8f5970b3fa46bb778b261e2f79d97486e885`
- `apps/dsh-univer-work/test/file-transfer.test.ts`：
  `476530ba0b5753b3a186e704fd8e4ee22e364aa5`
- 同步后的 `design.md`：`bbd92605ff537564d165cfce05f58f22f2dddb0d`
- 刷新后的 `change.html`：`07533da32be4fb943e8ea1ca2d7b75cd2bfc32c4`

冻结 Parity registry snapshot 与后续 Office canonical sample failure 属于 downstream Parity 或
Office owner，不计为 File Transfer finding。

### REV-FT-06 — low — repair 后 design 仍描述 ask-before-validation

- 状态：closed。
- 位置：`openspec/changes/add-dsh-file-transfer-tools/design.md` Decision 1、Decision 5 的 repair
  前版本。
- Evidence：旧文字分别声明 upload 在 body validation 前询问，以及 upload 保持先 approval 再验证；
  repair 已在 `tools/pre-execute` 的 `ask` 前复用纯参数 validator，旧文字因此与真实顺序相反。
- 最小修复：只同步两处 decision 文字，并由 planning owner 重新生成 `change.html`；不改 tasks、delta
  spec、Parity snapshot 或其他 owner。
- Closure evidence：最终 design 明确 upload pre-execute 在 `ask` 前调用同一 validator，approved body
  重验 immutable arguments；visual 已刷新。OpenSpec strict、visual audit 与 diff check 均通过。

### Final repair audit

**PASS，Standards 0 open，Spec 0 open。** 两个独立 review axis 均确认 repair 关闭
validation-before-approval 缺口，且没有改变 File Transfer 的其他 owner 合同。

- 生产变化只有 upload listener 在返回 `ask` 前调用既有
  `validators.workspace_blob_upload(exec.arguments)`。它复用 exact-own-key、schema/type 与 nonblank
  约束；approved body 继续执行同一 validator，没有新增 helper、provider、root、watcher 或 I/O seam。
- DeepSeek Harness rc.2 的真实顺序为 arguments snapshot/deep-freeze、`tools/pre-execute`、approval、
  definition body、result materialization。非法 upload 因此在 approval 前得到固定
  `workspace-argument-invalid`，错误内容不复制 raw args；合法参数仍只返回一次 `ask`。
- 真实 ToolRuntime regression 逐次等待 blank required、unknown own key 与 blank optional 调用 settle，
  再断言 approval、credential read、filesystem `resolve`/`stat`/`processPath` 与 HTTP 全部为零；同一
  fixture 的合法、rejected call 精确产生一次 approval，body side effect 仍为零。既有 allowed-once、
  cancellation、result-unknown、path、stream、cleanup 与 lifecycle tests 继续覆盖 approved body。
- Standards 轴逐项检查 Mysterious Name、Duplicated Code、Feature Envy、Data Clumps、Primitive
  Obsession、Repeated Switches、Shotgun Surgery、Divergent Change、Speculative Generality、Message
  Chains、Middle Man 与 Refused Bequest，均无受仓库标准支持的 finding。pre-execute 与 body 的同一
  validator 调用属于 approval 两侧的安全重检，不是重复实现。
- 独立复验：File Transfer focused 1 file / 53 tests、DSH typecheck、File Transfer OpenSpec strict 与
  窄 `git diff --check` 全部 PASS；独立 QA 报告 blob
  `d60e06192eccbed6e9635498111dca8738c34607` 给出 repair PASS、0 open file-transfer findings。
