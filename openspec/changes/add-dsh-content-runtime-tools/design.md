## Context

`add-dsh-worktree-unit-tools` owns Worktree/Unit identity and the shared DSH tool owner. `add-dsh-univer-work-authentication` owns the single credential record and an internal authenticated-HTTP resolver that deliberately hides the raw cookie from feature modules. This Change composes content tools above those seams; it does not add a connection service or read CLI Session state.

Client Core already exports `WorkspaceContentSource`, `WorkspaceContentExecutionFeature`, `createWorkspaceContentRuntime` and `./worker`. The runtime serializes operations per revision-independent target key, resolves credential/license when a worker is first created, synchronizes the selected revision, executes in the collaboration runtime pool, externalizes supported embedded images and commits one pending changeset up to three times. Its target resolvers and operation inputs do not consistently accept `AbortSignal`. The published runtime-pool `1.0.0-beta.2` lease methods also have no signal argument, so cancellation can stop queued or later work but cannot abandon an in-flight worker RPC.

Workspace CLI inspection uses `@univer-cli/content-inspection` through a Commander preset. The target-neutral package already owns seven structured query/result variants and stable inspection errors; Commander only owns string selector parsing, one-based display indices and text/JSON presentation. DSH can consume the target-neutral package directly.

DSH `0.1.1-rc.2` snapshots and logs caller arguments before `tools/pre-execute`, runs that policy before `defineTool` argument validation, and replaces a late successful body result with `ABORTED` when caller cancellation wins. These facts determine validation, approval and finalization below.

## Goals / Non-Goals

**Goals:**

- Expose one exact structured inspection tool and one approved Draft execution tool without Commander or daemon transport.
- Reuse the existing Core source/runtime/worker owners and the published inspection capability.
- Propagate cancellation as far as the frozen SDK permits, await uninterruptible work, and never start a later commit attempt after cancellation.
- Keep credential, license, source code and dependency errors out of plugin-owned output other than the caller-owned code argument and the execute value intentionally returned by that code.
- Prove the same behavior from the prebuilt tarball, including a real worker process and runtime-pool child closure.

**Non-Goals:**

- Do not add a generic read-code tool, action router, runtime service interface, daemon, Job, cache policy or configurable commit count.
- Do not add file-backed scripts, Office exchange, render/generation/discovery capabilities or non-local execution worlds.
- Do not sandbox Facade JavaScript beyond the existing worker/runtime contract or claim that an in-flight frozen-SDK worker RPC can be interrupted cooperatively.

## Diagram design

```text
DSH Agent
  ├── workspace_content_inspect ───────────────────────┐
  └── workspace_content_execute ─ validate ─ ask       │
                                                       ▼
                  shared Host owner + current runtime generation
                       │ credential + license resolvers
                       │ caller/owner signal
                       ▼
                 Workspace Client Core content runtime
                    ├── target/source + inspection
                    └── execute + image rewrite + commit
                                      │ packaged worker entry
                                      ▼
                         headless worker + Workspace Server
```

## Decisions

### 1. Expose two tools over the target-neutral capabilities

`workspace_content_inspect` accepts this flat target plus one structured query:

```text
unit_id: non-empty string
scope: trunk | worktree
worktree_id: required only for worktree
query:
  { kind: workbook }
  { kind: worksheet, worksheets: non-empty WorksheetSelector[] }
  { kind: worksheet-range, ranges: non-empty { worksheet, range }[] }
  { kind: presentation }
  { kind: slide, slides: non-empty SlideSelector[] }
  { kind: document }
  { kind: paragraph, paragraphs: non-empty ParagraphSelector[] }
```

Worksheet selectors are exact one-of `{ id }`, `{ name }` or `{ index }`; Slide and paragraph selectors are exact one-of `{ id }` or `{ index }`. IDs, names and A1 ranges are non-empty, and indices are non-negative zero-based values because this is the published structured API rather than the Commander adapter. The source resolves Trunk or Worktree target authority, then `inspectContent()` generates read-only Facade code and performs its published shallow check.

The shell does not treat that shallow check as a complete contract. One application-owned validator then checks all seven `ContentInspectionResult` discriminants, exact own keys at every nested object, query/result compatibility, requested/resolved Unit identity, nested field primitives, every `JsonValue`/`ICellData` leaf and recursive `SlideElementInspection.children`. It rejects unknown keys at any depth. Recursion is bounded at `MAX_CONTENT_JSON_DEPTH = 64`, so valid groups through depth 64 remain representable without an unbounded call stack. Tests include a valid deeply nested group, an unknown/malformed deep child, depth 65 and a result for the wrong Unit.

DSH rc.2 has neither `$ref` nor recursive schema support. The DSH output schema therefore declares the exact seven top-level/nested non-recursive shapes but projects each recursive `children` item as `JsonValue`; the application validator, rather than `output.schema` or `inspectContent()` alone, owns the complete recursive contract. Native rendering serializes the validated result losslessly and Code Mode receives the same canonical value. This honest projection is smaller than generated 64-level schema unrolling and does not claim schema expressiveness DSH lacks.

`workspace_content_execute` accepts exact non-empty `worktree_id`, `unit_id` and `code`. It calls `WorkspaceContentExecutionFeature.execute()` once. The feature resolves a Draft Worktree target, prepares the type-specific production bindings, runs write mode and returns either `{ committed: false, value }` or `{ committed: true, revision, status: 'committed', value }`. The outer output is closed; `value` remains lossless JSON because caller code owns it. No `script`, file path, caller-supplied Unit type, runtime target, revision, origin, credential or generic action is accepted.

One tool per outcome is smaller and clearer than seven inspection tools plus execute. A generic `mode/read/write` code tool is rejected because inspection has a stable published result model and arbitrary read code would unnecessarily widen execution authority.

The application freezes these non-configurable limits and checks them with runtime code because the rc.2 schema subset does not enforce string/array size keywords:

```text
MAX_CONTENT_CODE_BYTES          = 262,144 UTF-8 bytes
MAX_CONTENT_ARGUMENT_BYTES      = 524,288 canonical JSON UTF-8 bytes per call
MAX_CONTENT_SELECTORS           = 64 per query
MAX_CONTENT_RANGES              = 64 per worksheet-range query
MAX_CONTENT_REQUESTED_CELLS     = 100,000 across all requested A1 rectangles
MAX_EXECUTE_VALUE_BYTES         = 8,388,000 canonical JSON UTF-8 bytes
MAX_CONTENT_CANONICAL_BYTES     = 8,388,608 canonical JSON UTF-8 bytes
MAX_CONTENT_JSON_DEPTH          = 64
```

The inspect pure validator runs in this order: root/query own keys, primitive/container types and scope cross-fields; array count; complete canonical argument bytes; each selector one-of/non-empty rule and the published beta.2 cell-A1 grammar `/^\$?([A-Za-z]+)\$?(\d+)(?::\$?([A-Za-z]+)\$?(\d+))?$/` plus its row/order semantics; then safe-integer range area and summed requested cells. This order rejects a giant string before selector syntax parsing or authenticated allocation. Within the total budget, empty, syntactically malformed, row-zero or reversed A1 is `INSPECTION_SELECTOR_INVALID` with fixed text and no raw range detail. A grammar-valid range whose column/row/area arithmetic is not safely representable, or whose safe area/sum exceeds `100,000`, is `workspace-content-limit-exceeded` with kind `worksheet-cells`.

The execute pure policy/body validator runs exact own-key/type/non-empty checks, then complete canonical argument bytes, then code UTF-8 bytes, before `ask`. Thus a huge `unit_id`, `worktree_id`, selector id/name, range literal or combined argument record cannot drive plugin approval, target resolution or worker allocation beyond `MAX_CONTENT_ARGUMENT_BYTES`. DSH rc.2 has already snapshotted/logged caller arguments before policy; this gate bounds plugin-owned work and approval only and does not claim to erase or prevent the framework-owned record.

Inspection validates and measures the complete canonical result before returning it. DSH passes `MAX_EXECUTE_VALUE_BYTES` into Core; Core validates the worker value as lossless JSON within depth/byte bounds before embedded-image upload, mutation replacement or commit. The shell finally validates the closed execute envelope and its `MAX_CONTENT_CANONICAL_BYTES` bound. The 608-byte envelope reserve covers the fixed confirmed/no-mutation keys, maximum safe revision and JSON punctuation. CLI omits the optional Core budget and retains existing behavior.

Any exceeded count, byte or depth gate fails with `workspace-content-limit-exceeded` and exact safe detail `{ kind, limit, actual? }`; `actual` is omitted only when safe arithmetic cannot represent it. The shell never returns a truncated success, spill handle or alternate partial format. DSH's model-facing render/log spill is downstream presentation and is not treated as a Code Mode canonical-value budget.

### 2. Validate execute arguments before its one approval at the earliest truthful stage

Both definitions publish root `additionalProperties: false` and run exact own-key gates in their bodies. Because DSH policy precedes definition validation, execute also has one pure operation validator shared by policy and body. It performs the ordered shape, total-argument and code-byte checks above before returning `ask`; failure uses fixed `workspace-argument-invalid`, `INSPECTION_SELECTOR_INVALID` or `workspace-content-limit-exceeded` metadata and creates no approval interaction or raw plugin-owned argument copy. Inspection's pure body gate performs its ordered argument/selector/range/cell checks before authenticated work.

Target editability, Unit type and reserved binding checks require authoritative target resolution or the published content-execution prelude. They run after approval inside Core. The shell does not duplicate a JavaScript parser, accept a caller Unit type, or perform credential/HTTP work merely to improve the approval prompt.

DSH still records Native `tool/call.arguments`, or Code Mode `tool/code-dispatch-start.arguments` and settled `tool/code-dispatch.arguments = normalized.logged`, before this validator. Those records include `code` by framework contract. Approval reason and plugin-owned lifecycle events use fixed text. Result/failure/finalizer never copy code, credential/license, an unknown or rejected raw argument, selector id/name, or arbitrary query value. A recognized successful outcome or allowlisted error may contain only the validated canonical public identities frozen by Decision 6, such as authoritative Worktree/Unit target, numeric selector kind/index or canonical cell-A1 range. Tool documentation warns that credentials and other secrets must not be embedded in Facade code because caller arguments are durable DSH input.

`workspace_content_execute` always asks once, even if execution later captures no mutations: the worker evaluates caller-provided JavaScript and the operation may mutate remote content. It omits `isConcurrencySafe`; inspection remains read-only and delegates policy without requesting this Change's approval.

### 3. Hold one current runtime generation and retire it on credential change

The Host creates the Core runtime lazily and passes a package-relative `new URL('./worker.js', import.meta.url)`. Its credential closure re-reads and strictly validates the current authenticated grant whenever Core requests a new worker, verifies the target origin matches that grant, and returns the cookie directly to Core. Tool modules receive only source/runtime operations, never the cookie or grant record.

The existing revision-independent runtime key means an already pooled worker retains the credential used at initialization. The application therefore listens to the exact plugin-owned credential-record update event. When that key changes, it marks the current generation retired, closes its pool, and clears it only after close settles; a later accepted operation creates a fresh generation. Concurrent callers share the one current generation, and generation replacement is serialized with a promise tail rather than a new service, cache or lock type. The listener does not read or persist the new record.

The application resolves license from a non-empty process `UNIVER_LICENSE` override or its own synchronized copy of the repository's application-owned runtime development license. It adds no Config/Settings field. Rotation verification compares the Browser, CLI and DSH application-owned copies without printing their value. The credential and license appear only in strict worker init IPC and never in a tool value, rendered content, error detail or Session event.

Alternatives rejected:

- Creating a runtime per call avoids credential reuse but discards the pool's intended reuse and makes every inspection pay worker startup.
- Adding credential identity to `WorkspaceRuntimeTarget` would mix authentication into a product/runtime target and change existing CLI keys.
- Keeping the old pool until it fails could use a logged-out Login Session or strand a newly authenticated call on stale credentials.

### 4. Append optional signals through the existing Core operations

Client Core extends only methods reached by these two tools, without overloads or DSH types:

```text
WorkspaceContentSource:
  resolveRuntimeTarget(input, signal?)
  resolveEditableRuntimeTarget(input, signal?)
  resolveTrunkRuntimeTarget(input, signal?)

WorkspaceContentExecutionFeature:
  execute(input with signal?, maxValueBytes? and maxValueDepth?)
  executeSlide(input with signal?, maxValueBytes? and maxValueDepth?)

WorkspaceContentRuntimeOperations inputs:
  executeRead({ code, target, signal? })
  executeAndCommit({ code, target, signal?, maxValueBytes?, maxValueDepth? })

WorkspaceContentRuntimeOptions:
  resolveCredential(target, signal?)
  resolveLicense(signal?)
```

The signal reaches Worktree/target HTTP, credential/license resolution, per-key queue admission, acquire/synchronize step checks, read/write execution, embedded-image uploads, mutation replacement boundaries and commit attempt boundaries. `WorkspaceEmbeddedImageUploader.upload()` and `externalizeEmbeddedImages()` add optional signal input; ordinary non-abort upload failures retain the existing BASE64 fallback. Other Core operations outside inspection/execute remain unchanged and belong to the later capability that calls them.

The frozen runtime pool does not accept a signal for acquire, pull, execute, replace or commit. Core checks immediately before and after each such await and never races it with a promise that would let the operation continue after the public call settles. If cancellation becomes visible during a worker operation, Core waits for it, invalidates an unconfirmed/non-reusable lease as applicable, and starts no later step. This preserves quiescence and does not pretend to provide hard cancellation.

CLI daemon adapters continue sending their existing RPC payloads and omit signal, `maxValueBytes` and `maxValueDepth`. No signal or budget crosses the daemon wire, so existing CLI behavior and protocol remain unchanged.

### 5. Classify write cancellation by the last dispatched effect

Before any File API upload or changeset commit may dispatch, cancellation returns the caller/owner cancellation classification after cleanup and no remote side effect starts. A supplied signal that aborts the current File API POST is no longer swallowed by best-effort fallback: Core stops later uploads and commit, retaining `workspace-result-unknown` when that upload may have been accepted. Ordinary upload failure with no observed cancellation remains byte-for-byte fallback for CLI compatibility.

Core records confirmed File API uploads within the current externalization call. If at least one upload confirmed and cancellation becomes visible before the next upload, mutation replacement or first commit, Core invalidates the dirty lease, starts none of those later steps, performs no compensating delete or automatic re-upload, and raises `workspace-content-partial-side-effect` with structured `{ effect: 'embedded-image-upload', confirmedUploadCount, contentCommitted: false, target }`. Confirmed File IDs stay internal because count plus authoritative target is sufficient safe public identity; the uploaded objects may be unreferenced orphan candidates and this Change invents no File API rollback or cleanup policy.

For original caller cancellation, Core throws the structured partial-side-effect error after it observes the signal. DSH rc.2 converts only a successfully returned late body value to `ABORTED`; a body throw becomes `toolErrorResult(error)` without a second abort check. The caller therefore retains `workspace-content-partial-side-effect`, and the total finalizer preserves that registry identity while adding fixed orphan/inspect/no-replay guidance. For owner-only disposal, the owner-cancellation adapter preserves the same known partial code instead of replacing it with generic disposal, so the failure settles while disposal awaits the accepted body, lease invalidation and pool close. Neither path re-executes code, re-externalizes images or resumes the remaining upload list.

After write execution captures mutations, Core replaces them once and never re-executes Facade code. Each commit attempt checks the signal first. `retry` or `unknown` may continue the same pending changeset only while not cancelled and within the existing three attempts. If cancellation is observed after a commit may have dispatched, Core starts no next attempt and emits `workspace-result-unknown` with only target revision and safe changeset identity; this commit-unknown classification dominates any already confirmed image uploads and those uploads are not repeated. The unsignalled three-attempt exhaustion code remains `workspace-submit-retry-exhausted`.

A confirmed Core commit may return its revision. If the caller signal aborted before DSH finalization, rc.2 replaces that successfully returned late value with canonical `ABORTED`; a total finalizer keeps the registry error identity and advises `workspace_worktree_get`/`workspace_content_inspect` before any retry. Owner-only disposal does not abort the caller signal, so already confirmed success may remain visible while disposal drains it. A thrown `workspace-content-partial-side-effect` or `workspace-result-unknown` stays that tool-owned structured error even when caller cancellation caused the throw. Neither shell nor finalizer retries, polls or claims a read-back it did not perform.

### 6. Freeze content errors and project only safe detail

The shared DSH error adapter gains a content allowlist:

```text
workspace-argument-invalid
workspace-content-limit-exceeded
workspace-content-partial-side-effect
workspace-authentication-required
workspace-license-required
workspace-worktree-not-editable
workspace-unit-type-unsupported
workspace-invalid-response
workspace-origin-mismatch
workspace-request-invalid
workspace-redirect-refused
workspace-result-mismatch
workspace-result-unknown
workspace-submit-retry-exhausted
WORKSPACE_UNIT_NOT_FOUND
WORKSPACE_RESPONSE_INVALID
WORKSPACE_TARGET_INVALID
WORKSPACE_TARGET_NOT_EDITABLE
WORKSPACE_RUNTIME_DIRTY
WORKSPACE_RUNTIME_CONFLICT
WORKSPACE_RUNTIME_PULL_REQUIRED
WORKSPACE_RUNTIME_COMMIT_INVALID
WORKSPACE_RUNTIME_RESULT_INVALID
WORKSPACE_CONTENT_UNIT_TYPE_UNSUPPORTED
CONTENT_EXECUTION_INVALID_INPUT
CONTENT_EXECUTION_RESERVED_BINDING
CONTENT_EXECUTION_UNIT_TYPE_UNSUPPORTED
INSPECTION_RANGE_OUT_OF_BOUNDS
INSPECTION_RESULT_INVALID
INSPECTION_SELECTOR_AMBIGUOUS
INSPECTION_SELECTOR_INVALID
INSPECTION_SELECTOR_NOT_FOUND
INSPECTION_UNIT_TYPE_MISMATCH
COLLABORATION_INVALID_INPUT
COLLABORATION_LOAD_FAILED
COLLABORATION_UNAVAILABLE
COLLABORATION_PROTOCOL_ERROR
COLLABORATION_CLOSED
COLLABORATION_POOL_INVALID_INPUT
COLLABORATION_POOL_CLOSED
COLLABORATION_POOL_CAPACITY_EXCEEDED
COLLABORATION_LEASE_CLOSED
COLLABORATION_WORKER_OPEN_TIMEOUT
COLLABORATION_WORKER_OPERATION_TIMEOUT
COLLABORATION_WORKER_CRASHED
COLLABORATION_WORKER_PROTOCOL_ERROR
COLLABORATION_WORKER_CLOSED
UNAUTHENTICATED INVALID_INPUT FORBIDDEN NOT_FOUND CONFLICT INTERNAL_ERROR
```

Recognized codes receive fixed operation messages. Exact detail may contain only authoritative target scope and Worktree/Unit IDs, selected/observed revision, supported/actual Unit type, numeric selector kind/index, canonical grammar-valid A1 range, HTTP status/path, limit kind/limit/actual, confirmed upload count, content-commit flag, commit status and changeset `sid`/`reqId`; every nested object has its own key allowlist. These fields are validated canonical public identity/outcome projections, not an echo of the original argument record. Core must provide confirmed/unknown/partial-side-effect identity through structured result/error detail. The shell never extracts identity from `Error.message`. Original or rejected raw arguments, selector id/name, arbitrary query values, messages, code text, Facade values, cell content, worker init, credential/license, stack, cause, headers and unknown fields never cross. Any other code or thrown value becomes `workspace-content-operation-failed` with no source material.

Successful inspection and execute values are authorized content requested by the caller and remain lossless. Error sanitation does not redact successful Workspace content or the execute value.

### 7. Extend the existing fiber owner; add no daemon or background task

The Changes 2–4 owner registers both tools, the execute approval listener and credential-update listener in its one Cordis effect. Every body fuses `exec.signal` with the owner signal, enters active-body tracking before authenticated/runtime work, and remains tracked until Core and worker work settles.

Disposal marks the owner non-accepting, explicitly unregisters the two tools/listeners, aborts the owner signal, retires/closes the current runtime generation so the worker pool can settle, and awaits both generation close and every accepted body. Runtime close is invoked once per generation. There are no process signals, daemon sockets, Jobs, timers, detached retries or second lifecycle controller.

### 8. Build Host and worker entries as one installed closure

The Vite/Rollup package build adds a `worker` entry beside the Host entry. Host code resolves that emitted file relative to `import.meta.url`. Both entries import Client Core only through `@univerjs/univer-workspace-client-core` and `@univerjs/univer-workspace-client-core/worker`; reachable private Core and exact SDK JavaScript are bundled, while Node built-ins, exact DSH/Cordis packages and the formula runtime's published native binding remain declared externals. The package build reuses the CLI build's existing Node CommonJS-global treatment rather than inventing a second bundler.

The build resolves the installed owner manifest for `@univerjs-pro/engine-formula-rust`, reads its exact declared `@univerjs-pro/engine-formula-rust-binding` version, externalizes that native package, and copies/declares precisely that version in the packed closure. Rollup defines `__UNIVER_RUST_FORMULA_LOCAL_BINDING_FALLBACKS__ = false`; installed execution therefore cannot fall back to an adjacent SDK checkout or source tree. No dependency version is inferred from the repository root or a sibling checkout.

The collaboration pool's emitted chunk expects `worker-child.mjs` beside it. Package assembly resolves the exact installed `@univer-cli/univer-collaboration-runtime-pool@1.0.0-beta.2` package and copies that published child into the matching packed chunk directory. Verification rejects missing/extra worker resources, a bare private Core import, `workspace:*`, CLI source/daemon/Session, render/Office/generation assets and adjacent checkout paths.

Source tests use real Cordis `ToolRuntime`, the published inspection package, fake credential/approval and a fake Workspace/Collaboration server. The isolated tarball smoke installs the prebuilt package in a new local profile, changes to an arbitrary temporary cwd with no workspace `node_modules` or source fallback, and runs real Trunk/Worktree inspection and no-mutation/confirmed execute through `worker.js`, the colocated runtime-pool `worker-child.mjs`, the exact formula binding and packaged license/credential resolvers. It exercises cancellation/uncertainty and credential-generation replacement, then disposes without a model key or real account. Package verification also greps every emitted JavaScript/resource/manifest for absolute checkout and source paths. Source and packed Native/Code Mode transcripts assert code/credential/license/rejected-raw sentinels are never copied into plugin-owned content; separate fixtures assert only allowlisted canonical public identity may appear in a recognized result or safe error detail.

## Risks / Trade-offs

- **Facade code has the existing worker's JavaScript authority** -> Require per-call human approval, accept no credential/path/command fields, keep execution in the packaged worker, and make no sandbox claim beyond the frozen SDK.
- **Worker operations cannot observe `AbortSignal`** -> Check every separable boundary, never abandon a worker promise, close the pool on owner disposal and test that no later step starts after cancellation.
- **Credential rotation races an active runtime** -> Retire and close one generation on the exact record event; active bodies settle through the same owner before a new generation is used.
- **Cancellation follows a confirmed image upload** -> Preserve a structured partial-side-effect count/target, invalidate the lease, leave the unreferenced upload as an orphan candidate and require inspection before any deliberate retry; add no unsafe compensating delete.
- **A commit succeeds after caller cancellation** -> Let DSH preserve `ABORTED`, append inspection guidance, and never replay code automatically.
- **Inspection or execute returns large content** -> Enforce the frozen application budgets before return and, for execute value, before upload/replacement/commit; fail with one stable limit code instead of returning a truncated or post-commit ordinary failure.
- **Bundled worker misses its runtime child or native binding** -> Resolve the exact binding from its owner manifest, disable local fallback, inspect imports/files/absolute paths and execute the installed worker-backed smoke from an unrelated temporary cwd.
- **A safe code later carries unsafe detail** -> Project exact fields under a frozen allowlist and discard original messages/causes.

## Migration Plan

1. Complete and verify Changes 1–4; Change 5 may proceed independently because this Change performs no local file transfer.
2. Add optional Core signals and focused cancellation/CLI compatibility cases without changing unsignalled calls.
3. Add the two tools, runtime generation, license resolver, credential listener, approval, schemas, error projection and finalizers to the existing Host effect.
4. Add the bundled worker/runtime child closure and run source, real ToolRuntime, transcript, Client Core, CLI and isolated tarball gates.

There is no persisted schema or Workspace data migration. Rollback unregisters the two tools, closes their runtime generation and removes optional-signal call sites; existing Worktrees, confirmed revisions, credentials and CLI artifacts remain valid.

## Open Questions

无。会改变 tool names、query/index semantics、approval、runtime credential/license ownership、signal/result-unknown behavior、worker closure或 Change size 的决定均已由确认范围、现有 Core behavior与冻结 DSH/SDK source 收敛。
