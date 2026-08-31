## Context

`WorkspaceUnitExchangeFeature` already owns the Workspace CLI Office suffix/type matrix, name precedence, Worktree-local Unit creation, Worktree runtime target selection, UnitData identity check and `@univerjs-pro/exchange-node` adapter. The CLI shell only maps Commander arguments and presentation. This Change keeps that ownership and adds the DSH execution controls that the existing CLI does not need.

`add-dsh-file-transfer-tools` owns the DSH local execution-world proof, Session-cwd containment, current file-effect policy and atomic binary output. `add-dsh-content-runtime-tools` owns the current authenticated worker-backed runtime generation. Office tools must call those owners directly; a second path adapter, runtime pool, converter registry or daemon would duplicate already-settled behavior.

The frozen `@univerjs-pro/exchange-node@1.0.0-beta.2` implementation reads a path with `readFile()` inside `importFile`, after any caller-side stat, and builds a complete export buffer before writing. A path can grow or be replaced between inspection and that hidden read, so the DSH budget cannot safely wrap `importFile`. The package publicly exports `importBuffer` and `exportToBuffer`; the controlled branches can therefore reuse Change 5's signal-aware source reader and atomic binary publisher without inventing a converter or stream abstraction. Native calls have no `AbortSignal`: Client Core can stop before or after them and must await them, but cannot claim cooperative interruption.

DSH `0.1.1-rc.2` records Native/Code Mode arguments before `tools/pre-execute`, runs that policy before `defineTool` argument validation, and replaces a body-started late success with `ABORTED` after caller cancellation. These facts determine the validation, approval and finalization order below.

## Goals / Non-Goals

**Goals:**

- Expose exact Office import/create and Worktree Unit export outcomes through two DSH tools.
- Reuse the existing local file policy/path owner and content runtime owner.
- Bound plugin-owned arguments, source bytes, converted UnitData, exported UnitData and generated Office bytes before a remote create or final local publication.
- Preserve Worktree Unit stable identity, read-back, every post-dispatch non-confirmed result, no-replay and CLI compatibility.
- Deliver the real Office native binding and worker/runtime closure in the installed tarball.

**Non-Goals:**

- Do not add CSV even though the upstream exchange package contains CSV types; Workspace CLI/Core intentionally expose the narrower matrix.
- Do not import into or replace an existing Unit, export Trunk, infer a missing output suffix, or add a generic conversion action.
- Do not add a converter service/interface, Job, daemon, remote filesystem adapter or general artifact store.

## Diagram design

```text
DSH Agent
  ├── workspace_office_import ─ validate ─ ask ─ local source gate ─┐
  └── workspace_office_export ─ file-policy/path preflight ─ ask ──┤
                                                                   ▼
                           Workspace Client Core Office exchange
                              ├── Worktree Unit create
                              ├── Worktree target + UnitData runtime
                              └── exchange-node native conversion
                                             │
                      import create ──────────┴────────── atomic local output
                                             │
                                             ▼
                                   Workspace Server / Session cwd
```

## Decisions

### 1. Expose two outcome-specific tools and the existing format matrix

The Host registers this fixed surface:

| Tool | Parameters | Canonical value |
| --- | --- | --- |
| `workspace_office_import` | `source_path`, `worktree_id`, `space_id`, optional `type`, `name`, `parent_node_id`, `idempotency_key` | existing `WorkspaceImportFileResult` |
| `workspace_office_export` | `output_path`, `worktree_id`, `unit_id`, optional `force` | existing `WorkspaceExportFileResult` |

Import supports exactly:

```text
.xls / .xlsx                         -> Sheet by default, explicit Sheet or Base
.doc / .docx                         -> Doc
.ppt / .pptx / .pptm / .ppsx /
.ppsm / .potx                        -> Slide
```

Export supports exactly Sheet/Base→`.xlsx`, Doc→`.docx` and Slide→`.pptx`. Board, CSV, PDF, ODF, legacy `.xls/.doc/.ppt` output and every other suffix fail. Import always creates a new Worktree-local Unit; it has no existing Unit/Resource parameter and no replacement branch. Export selects a Worktree Unit head; it has no Trunk scope or caller-supplied Unit type/revision.

Parameters use DSH snake_case. Successful values retain the existing Core camelCase result directly, avoiding a second exchange result model. Import preserves explicit/imported/fallback name precedence and the existing converter options. Export preserves formula calculation and type/format compatibility.

### 2. Validate pure arguments and fixed budgets before approval

Both definitions publish root `additionalProperties: false`. One operation-specific pure validator per tool accepts `unknown`, checks exact own keys, primitive types, non-empty IDs/paths/names, type enum, boolean `force`, suffix/type compatibility available without remote authority and then the complete canonical argument bytes. The same validator runs in `tools/pre-execute` before `ask` and again in the accepted body before credential, Core or Host I/O.

The DSH shell freezes these controls:

```text
MAX_OFFICE_ARGUMENT_BYTES       = 524,288 canonical JSON UTF-8 bytes
MAX_OFFICE_SOURCE_BYTES         = 52,428,800 bytes
MAX_OFFICE_UNIT_DATA_BYTES      = 52,428,800 canonical JSON UTF-8 bytes
MAX_OFFICE_OUTPUT_BYTES         = 52,428,800 bytes
MAX_OFFICE_JSON_DEPTH           = 64
```

The 50 MiB file ceiling matches the Workspace product's existing exchange file ceiling. It is an application safety limit, not a new Server contract. Import uses Change 5's contained regular-source inspection and signal-aware `openSource` stream, collects actual bytes only up to `MAX_OFFICE_SOURCE_BYTES + 1`, requires the stream's existing inspected-size/actual-byte count, closes the stream, and only then calls published `importBuffer`. A source whose streamed length grows, truncates or exceeds the cap fails before native entry; cancellation stops and closes the stream. A same-length replacement can satisfy that byte-count contract. Converted UnitData is checked before Unit create. Export asks the runtime to check UnitData byte/depth before native conversion and checks the returned native buffer before local publication. Any limit failure occurs before the next side effect and returns `workspace-office-limit-exceeded` with only `{ kind, limit, actual? }`; no success is truncated.

DSH has already saved caller arguments before the pre-execute validator. The plugin does not promise to redact Native `tool/call.arguments`, Code Mode `tool/code-dispatch-start.arguments` or settled `tool/code-dispatch.arguments`. Approval, result/failure, finalizer, plugin-owned contexts and logs never copy rejected raw arguments or paths beyond a separately validated safe canonical path field.

### 3. Reuse the file gate and ask once

The existing fiber-owned `tools/pre-execute` listener adds the two Office names.

Import first runs its pure validator, then returns one fixed `ask`. Like Blob upload, it does not resolve or inspect the model path before approval. In the accepted body it positively proves the exact public `LocalFileSystem` constructor, requires the calling Agent Session cwd, resolves/contains the source within that cwd, requires a regular source, calls `processPath()` only after those gates, and then invokes Core's controlled import. Core reuses Change 5's actual-byte reader rather than trusting preflight stat. Import reads local data, so DSH write policy does not deny it under `read-only`; its remote Unit create is controlled by the approval.

Export follows the Change 5 download order. For a confining filesystem it first resolves current Session file-effect policy; `read-only` fails before provider/argument/path/ask/body/credential/I/O. It then proves the public local constructor, applies the pure validator and canonical output containment under Session cwd plus the `workspace-write` root when applicable, and asks once. It does not call `processPath()`, stat/create the destination, resolve credentials or start Core during preflight. The accepted body re-reads current policy and repeats constructor identity and path containment from immutable arguments immediately before `processPath()` and Core. Narrowing, provider replacement and symlink drift therefore fail without a second approval.

Both tool definitions remain exclusive. Approval rejection, cancellation, absence or unavailable interaction fails before conversion, remote create or local publication. Fixed approval text names only Office import or export and contains no caller value.

### 4. Add optional Core operation controls without changing CLI calls

Client Core appends an optional operation object to each existing method:

```text
importFile(input, {
  signal?, maxSourceBytes?, maxUnitDataBytes?, maxUnitDataDepth?
}?)

exportFile(input, {
  signal?, maxUnitDataBytes?, maxUnitDataDepth?,
  atomicOutput?: { force: boolean, maxOutputBytes: number }
}?)
```

The Office dependency ports accept the same optional signal at the prerequisite seams established by Changes 4 and 6:

```text
createUnit(input, signal?)
resolveRuntimeTarget(input, signal?)
runtime.exportUnitData({ target, signal?, maxValueBytes?, maxValueDepth? })
```

For a controlled import, Core calls Change 5 `inspectSource(path)` and then `openSource(source, signal)`. It consumes that stream into one buffer bounded at `maxSourceBytes + 1`, enforces the existing inspected-size/actual-byte count, closes the stream in `finally`, and calls the existing published converter port as `importBuffer(buffer, { ...options, fileName })`. This closes the budget gap because native conversion receives only the settled bounded buffer. It does not turn Change 5's path-based stat-then-stream sequence into an identity lock: a concurrent process can replace a path or swap a symlink with another same-length regular file before the stream opens. Change 5 already accepts that absence of a cross-process `openat`/directory-handle fence, and this Change neither strengthens nor weakens it. Core checks cancellation before/after reading and the uninterruptible native conversion, validates converted data, then calls the existing Unit create with the same idempotency key and signal. The no-controls CLI branch still passes its path directly to `importFile` and preserves the current hidden `readFile` behavior.

Export resolves the authoritative Worktree head once at invocation and records that exact revision. Change 6 runtime synchronization must confirm its `baseRevision` equals the selected target revision before UnitData export. If the head advances between target resolution and synchronization, Core returns `workspace-result-mismatch` before UnitData, native conversion or local output; it neither re-resolves the newer head nor claims to export the older revision. When synchronization confirms the exact revision, export validates type/format, exports UnitData with the optional budget, then converts. Neither operation accepts a caller revision, changeset or confirmed Server revision. Import create confirmation remains the existing Worktree Unit result; export is a read plus local file publication and performs no content commit.

Workspace CLI supplies no operation object. Core therefore retains its direct `importFile`/`exportToFile` path, existing validation order, overwrite behavior, result fields and daemon `runtime.export-unit-data` payload. Optional DSH controls do not cross the CLI wire or appear in CLI JSON.

### 5. Use the converter buffer plus the existing atomic binary publisher

Only the DSH atomic branch calls the published `exportToBuffer` adapter. After native conversion settles, Core checks cancellation and output size, then passes the one buffer through the signal-aware atomic binary output primitive introduced by Change 5 under Office-specific error codes. The primitive creates a `0600` same-directory temporary file, writes exact bytes, syncs, checks cancellation and atomically publishes it.

Without `force`, publication uses no-clobber semantics and fails if the destination existed or appeared during conversion. With `force: true`, the completed temporary file atomically replaces the destination. Any conversion, size, write, cancellation or publication failure runs non-cancellable close/unlink cleanup and leaves a prior destination unchanged. A confirmed atomic publication may be returned by Core even if cancellation races afterward; DSH owns final caller presentation.

This branch reuses the existing file primitive and the upstream buffer export. It does not add a converter registry, output stream adapter or path-writing wrapper around the native binding.

### 6. Preserve side-effect identity and never replay an accepted tool

Import has one possible remote side effect: Worktree-local Unit creation. Native conversion failure or cancellation before create has no remote effect. Once create dispatch begins, Change 4 Core behavior remains authoritative: same-identity bounded recovery may confirm the Unit; otherwise every non-confirmed outcome is treated as potentially side-effecting. `workspace-result-unknown` retains safe stable Worktree/Space/idempotency identity; `workspace-result-mismatch` and `workspace-invalid-response` retain their stable safe code and receive the same fixed Worktree Unit inspection guidance. None is described as confirmed or rolled back. The shell never reruns source reading, conversion or create after any such outcome.

Export performs only remote reads before local output. Cancellation or failure before atomic publication removes the temporary output; after confirmed publication the destination is the only completed side effect. The shell never re-exports UnitData or conversion automatically. `force` cannot expose a partially written prior or new file because replacement occurs after complete conversion and sync.

Caller cancellation that races a body-thrown post-dispatch `workspace-result-unknown`, `workspace-result-mismatch` or `workspace-invalid-response` preserves that tool-owned failure and its fixed inspection guidance. If Core instead confirms Unit create or local publication and the body returns success after caller cancellation, rc.2 replaces it with canonical `ABORTED`; the finalizer keeps that error identity and gives fixed guidance to inspect Worktree Units or the output path before a deliberate retry. Owner-only disposal may expose confirmed success while draining; an unconfirmed create retains its original safe failure.

### 7. Extend the frozen safe-error projection

The Office adapter preserves the shared authentication, HTTP, Worktree/Unit, file-policy/path, content-runtime and current Server codes already allowlisted by prerequisite Changes, plus:

```text
workspace-exchange-import-format-unsupported
workspace-exchange-export-format-unsupported
workspace-exchange-export-format-mismatch
workspace-exchange-unit-data-invalid
workspace-unit-type-unsupported
workspace-office-limit-exceeded
workspace-office-output-exists
workspace-office-output-unavailable
workspace-office-output-invalid-state
workspace-office-output-write-failed
```

Recognized `ExchangeErrorCode` values are reduced to `workspace-office-conversion-failed` with safe detail `{ phase: import | export, exchangeCode }`, where `exchangeCode` is one of `INVALID_ARGUMENT`, `UNSUPPORTED_FORMAT`, `INVALID_FILE`, `INCOMPLETE_SNAPSHOT`, `IO_ERROR`, `NATIVE_LOAD_FAILED`, or `CONVERSION_FAILED`. Original converter messages, native causes, stacks, bytes and dependency paths never cross. Every unlisted code or unsafe dependency failure becomes fixed `workspace-office-operation-failed`.

Safe detail is limited to authoritative Worktree/Unit/Space/Node/Resource/idempotency identity, supported Unit type, selected revision, validated contained source/output path, limit counts and output state. Credential, cookie, license, UnitData, Office bytes, temporary path, raw arguments, response headers and arbitrary converter/runtime values never enter failure content or plugin logs.

### 8. Extend one lifecycle and one installed artifact

Both bodies use the existing accepted-body owner and `AbortSignal.any([exec.signal, owner.signal])`. Disposal unregisters the tools and their pre-execute branches, rejects new bodies, aborts owner-controlled work, awaits any uninterruptible native conversion, drains Unit create/runtime/file cleanup, and then lets Change 6 close the runtime generation. No Job, timer, detached retry, second pool or second controller survives.

The Host/worker build continues to inline reachable private Core and exact SDK JavaScript. It reuses Change 6's emitted worker and `worker-child.mjs`; package assembly additionally resolves `@univerjs-pro/exchange-node@1.0.0-beta.2` from the installed Client Core dependency graph, reads its exact declared `@univerjs-pro/exchange-node-binding`, keeps the binding external and copies/declares that exact npm version. Verification rejects bare private Core imports, `workspace:*`, CLI source/daemon/Session, render/generation resources and adjacent checkout fallbacks.

Source tests cover every suffix/type pair, pure budgets, bounded actual-source streams including growth/truncation/oversize and cancellation cleanup, accepted same-length replacement ceiling, exact-revision synchronization races, create response mismatch/invalid-after-dispatch no replay, path/policy/approval ordering and atomic publication. An installed keyless smoke runs real DSH ToolRuntime with a temporary Session cwd, fake Workspace/Collaboration endpoints, the emitted worker and real platform native binding; it performs a real XLSX import/export round trip, checks Doc/Slide wiring with strict converter fixtures, exercises source limits, revision mismatch, every post-dispatch unconfirmed create class, ABORTED/cleanup/dispose and scans plugin-owned transcript content for sentinels. It needs no model key or real account.

## Risks / Trade-offs

- **Native conversion cannot observe cancellation** -> Bound input before entry, await the call, check cancellation immediately afterward, start no later side effect, and drain it during disposal.
- **The import path changes after preflight** -> Reuse Change 5's stat-then-stream ceiling: stop the actual stream at `limit + 1`, enforce its byte-count contract, close it on every exit and pass only the settled bounded buffer to `importBuffer`; do not promise detection of same-length replacement/symlink swap without an upstream `openat`/directory-handle primitive.
- **Office conversion expands a small archive into large UnitData** -> Apply the converted UnitData byte/depth budget before Unit create and reject without a partial success.
- **Export creates a complete buffer in memory** -> The upstream file API already creates that buffer; cap it at 50 MiB before atomic write and add no second copy beyond the existing one-buffer publisher.
- **File policy or canonical path changes during approval** -> Re-read policy/provider/path in the accepted body and never retain a process path across approval.
- **Import create returns any non-confirmed result after dispatch** -> Preserve `workspace-result-unknown`, `workspace-result-mismatch` or `workspace-invalid-response` and stable identity where available, require Worktree Unit/Space inspection, and never replay conversion or create automatically.
- **The packed binding version drifts** -> Resolve it from the installed exchange-node owner manifest and execute installed native smoke from an unrelated cwd.
- **Optional controls accidentally change CLI behavior** -> Keep the no-options branch byte-for-byte compatible and run CLI command, Core Office, native, daemon and package gates.

## Migration Plan

1. Complete and verify Changes 4–6.
2. Add optional Core signal/budget/atomic controls and focused no-options compatibility cases.
3. Add the two tool definitions by extending the existing validators, path policy, approval, error and body owner.
4. Add exact native binding packaging and installed ToolRuntime/native smoke, then run Client Core, DSH, CLI and repository gates.

No persisted data migration exists. Rollback unregisters the two tools and removes optional DSH call controls; already created Worktree-local Units and atomically published Office files remain valid.

## Open Questions

无。格式、file policy、approval、预算、atomic replace、cancellation 与 package ownership均由冻结源码和前序 Changes确定。
