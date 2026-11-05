## Context

`packages/client-core/src/svg.ts` is already the single SVG workflow owner used by Workspace CLI. It reads one local UTF-8 SVG and compiler-requested relative assets, calls exact `@univer-cli/svg-facade@1.0.0-beta.2`, optionally measures text through `@univer-cli/univer-render-runtime`, wraps a 1-based Slide page program, and applies that program through `WorkspaceContentExecutionFeature.executeSlide()`. The CLI adds only Commander option validation, `--out` writing and presentation.

The DSH adapter must account for different trust and lifecycle rules. In DSH `0.1.1-rc.2`, arguments are snapshotted before `tools/pre-execute`, pre-execute runs before `defineTool` validation, caller cancellation replaces a late successful started result with `ABORTED`, and a tool-owned thrown failure survives that final cancellation check. `ctx.fs.resolve()` returns an execution-world identity rather than a Host path. Change 5 established the positive `LocalFileSystem`/in-process sandbox identity and Session-cwd containment needed before `processPath()`; Change 6 established Draft execution, worker quiescence and result-unknown behavior; Change 9 owns the packaged render page, browser dependency resolution and restricted Chromium deployment boundary.

The SVG compiler's asset resolver is synchronous. A DSH adapter therefore cannot resolve each discovered asset through the asynchronous filesystem seam. The smallest safe change is an optional Core-owned canonical-root and byte budget for its existing synchronous local reader. Workspace CLI omits those controls and retains current behavior.

## Goals / Non-Goals

**Goals:**

- Provide one compile operation and one approved Draft apply operation; either may expose or save the exact program produced by that call.
- Preserve the compiler's raw/page, replace/add, real/estimated measurement, warnings, lints, viewport and commit outcomes without exposing Commander.
- Constrain source and every compiler-requested local asset to the calling Session cwd, and route optional generated-code writes through current DSH file policy and approval.
- Bound arguments, local bytes, generated code and canonical values before local publication or remote mutation.
- Carry caller/owner cancellation through Core, browser, worker and file work; await cleanup and never replay compilation or commit.
- Reuse the existing package build, worker and render closure in an installed real-ToolRuntime smoke.

**Non-Goals:**

- Do not add inline SVG input, URL assets, Trunk apply, arbitrary Facade code, Jobs, daemon, Web UI or remote filesystem support.
- Do not add a compiler, renderer, filesystem or browser-pool abstraction.
- Do not accept caller-supplied generated code or a compile token in apply; each operation compiles its selected source once and owns that exact program through settlement.
- Do not alter SVG mapping, warning/lint policy, page semantics, content commit behavior or browser installation policy.

## Diagram design

```text
DSH SVG tool
  ├── closed arguments / limits / optional approval
  ├── local provider + Session cwd identities
  │       ├── source.svg
  │       ├── relative assets
  │       └── optional generated.js via ctx.fs.writeText
  ▼
Workspace Client Core SVG owner
  ├── svg-facade compile
  ├── estimated OR packaged browser text measurement
  └── 1-based replace/add page program
             │ apply only
             ▼
shared Slide content execution ──> Draft Worktree Slide Unit
```

## Decisions

### 1. Register two operation-specific tools

The application registers exactly:

| Tool | Arguments | Canonical outcome |
| --- | --- | --- |
| `workspace_svg_compile` | `source_path`; optional positive `page`, `add`, `estimate_text_size`, `output_path` | complete compile diagnostics plus either inline generated code or one confirmed local output location |
| `workspace_svg_apply` | `source_path`, positive `page`, `worktree_id`, `unit_id`; optional `add`, `estimate_text_size`, `output_path` | complete compile diagnostics, the same generated union and the existing Slide content-execution result |

Both tools use DSH snake_case arguments and closed root schemas. `add: true` requires `page`; `output_path` also requires `page`. Compile without `output_path` returns `{ kind: "workspace-svg-compile", generated: { kind: "inline", code }, page, mode, viewport, textMeasure, warnings, lints }`. Compile with `output_path` writes exactly `${code}\n` and returns the same envelope with `{ kind: "file", location }` instead of duplicating code into the Session. Apply uses the same generated union: without `output_path` its success includes the exact inline page program; with `output_path` it saves that exact program first and returns the confirmed location. Only after a requested save confirms does apply call `executeSlide()` once with the same in-memory string, then return `{ kind: "workspace-svg-apply", generated, page, mode, viewport, textMeasure, warnings, lints, applied }`.

This preserves the three Agent outcomes behind the CLI command and its same-compile guarantee: inspect generated code, save that generated code, and apply that exact generated Slide page even if the source changes after compilation. A generic `action` argument was rejected because it weakens schemas and approval identity. Passing a prior compile result into apply was rejected because it would place large model-controlled JavaScript back across the tool boundary, create a second arbitrary-code surface and lose source/asset authority at apply time.

Definitions publish `additionalProperties: false`, while the shared exact-own-key validator compensates for rc.2's open implicit parameter root. Rendering reads only the already validated canonical value. Neither tool accepts origin, cookie, license, render path, Unit type, revision, raw SVG, URL, credential or generic code.

### 2. Enforce fixed input and result budgets before effects

The application freezes these non-configurable limits:

```text
MAX_SVG_ARGUMENT_BYTES       = 65,536 canonical JSON UTF-8 bytes
MAX_SVG_SOURCE_BYTES         = 10,485,760 bytes
MAX_SVG_ASSET_BYTES          = 67,108,864 aggregate bytes per compile
MAX_SVG_GENERATED_CODE_BYTES = 8,000,000 UTF-8 bytes
MAX_SVG_CANONICAL_BYTES      = 8,388,608 canonical JSON UTF-8 bytes
MAX_SVG_JSON_DEPTH           = 64
```

The pure argument validator checks exact keys and primitive types, non-empty IDs/paths, positive safe-integer page and cross-field rules before canonical argument bytes. The pre-execute branches use the same pure validator because policy precedes definition validation. DSH has already logged its own immutable argument record; these gates bound plugin-owned approval, allocation and execution rather than claiming to erase framework input.

Core opens source and assets through a bounded synchronous reader. It reads at most the remaining allowance plus one byte from the same already-opened regular-file identity, counts actual bytes rather than a prior stat size, checks the signal and root containment around every read, and rejects excess before decode or compiler return. The shell checks generated code bytes and the complete compile/generated projection before generated-code publication or `executeSlide()`. For apply it subtracts the exact serialized fixed envelope, diagnostics and generated union from `MAX_SVG_CANONICAL_BYTES`, passes the remaining positive allowance with `maxValueDepth` to Change 6's pre-commit value gate, then validates the final closed envelope. A file may already have confirmed before worker value validation; an over-budget value then becomes the specified file-confirmed apply-partial failure and content remains uncommitted. No limit produces truncation, spill state or a later apply after an over-budget compile.

An inline compile therefore fits the complete canonical budget. File-output compile validates the same logical compile result, then omits code only from the returned envelope to avoid duplicating bytes. Warnings and lints remain complete authorized SVG diagnostics; they are never selectively trimmed.

### 3. Reuse the local execution-world and DSH text-write seams

Both bodies require the calling Agent Session's non-empty `header.cwd`. Before resolving any model path they positively require the exact-baseline public `LocalFileSystem` constructor or its in-process sandbox subclass. E2B and unrelated providers fail with `workspace-local-filesystem-required`; no model path is resolved and no Host `node:fs` call occurs for them.

The adapter resolves Session cwd and `source_path` through `ctx.fs.resolve({ cwd, signal })`, verifies the source identity is contained by that canonical cwd identity, then obtains `ctx.fs.processPath(source)` only after the positive provider check. It passes the canonical process path, canonical cwd process root, fixed byte limits and fused signal to Core. Core canonicalizes each source/asset candidate under that root, opens the canonical candidate, verifies the opened descriptor is a regular file and still matches the validated file identity, then performs the bounded read from that same descriptor. An identity mismatch caused by a replace/symlink race fails closed; no `stat`-then-unbounded-`readFileSync` size promise is made. Source uses `MAX_SVG_SOURCE_BYTES + 1`; each asset uses `remainingAggregateBytes + 1`, and only actual bytes read reduce the aggregate allowance. Absolute paths, `..`, symlinks and `file://` references are accepted only when their opened real identity remains inside the root. HTTP(S) assets remain compiler-owned non-local references and are not fetched by this Change. Core returns fixed root/source/asset failures without exposing a Host path. This is one private reader helper inside the existing SVG module, not a new filesystem abstraction.

`workspace_svg_compile` without `output_path` performs only contained local reads and optional browser computation, so this Change requests no approval. With `output_path`, pre-execute first resolves the current Session file policy. `read-only` fails before path interpretation or approval. A confining provider without the policy service is a composition error. After positive local-provider proof, the listener validates arguments, resolves the requested output beneath Session cwd and any current `workspace-write` root, and returns one fixed `ask` without reading source, creating a browser, resolving credentials or writing.

The accepted body repeats immutable argument, current policy, provider identity and canonical output containment. After compilation and complete result validation it writes `${code}\n` once through `ctx.fs.writeText()` with the current sandbox policy, so the provider owns atomic text publication instead of a new Node writer. Existing files may be replaced after this explicit approval, matching CLI `--out`. It does not call `processPath()` for output or create a second approval.

`workspace_svg_apply` performs pure argument and source-identity preflight, then asks once because it may mutate remote Draft content. When `output_path` is present, that same fixed approval names both generated-code file replacement and Draft content mutation; the preflight applies the compile-output policy/provider/path rules before asking. There is no second approval. Preflight performs no source read, browser, credential, worker or Workspace request. The body repeats every applicable gate, compiles once, validates the complete logical result, saves the exact program when requested, and only after that save confirms calls shared Slide execution with the same string. A save failure starts no credential/target/worker/commit work. Both definitions omit `isConcurrencySafe`; the existing exclusive ToolRuntime schedule avoids same-output and browser/worker overlap without an application lock.

### 4. Add only optional root, limits and signal to Client Core SVG

`WorkspaceCompileSvgInput` gains optional `signal`, `localRoot`, `maxSourceBytes` and `maxAssetBytes`. `WorkspaceApplySvgInput` gains optional `signal`, `maxValueBytes` and `maxValueDepth`, forwarding the latter controls to Change 6's existing Slide execution. Existing callers may omit every new field.

Core checks the supplied signal before and after source read, each asset read, compiler settlement, page wrapping, runtime creation and each text measurement. A compiler or frozen browser operation that has no signal input is awaited; no later stage starts after cancellation. Runtime close remains in `finally`, ignores cancellation for cleanup, is awaited once, and does not replace the primary compile failure unless close is the only failure.

Core's optional `localRoot` uses Node real identities only for the existing local reader; it does not import DSH, accept an execution-world object or become a filesystem provider. The private helper opens, validates, bounded-reads and closes one descriptor per source/asset; it does not expose a reusable file API. When caller limits are omitted, the opened descriptor's validated safe-integer size supplies that read's bound and the helper reads at most size plus one to detect concurrent growth, retaining ordinary CLI source/relative-asset outcomes without an unbounded `readFileSync`. Byte limits are caller controls, not new global compiler defaults. This is smaller than an async asset-provider rewrite that the synchronous `SvgAssetResolver` cannot consume.

Apply passes the same signal and result limits to `executeSlide()`. It does not resolve target authority, commit, retry, externalize embedded images or interpret content results itself. Existing unsignalled CLI compile/apply tests and installed package smoke remain compatibility gates.

### 5. Preserve Draft authority, commit uncertainty and cancellation ownership

Only `workspace_svg_apply` resolves authenticated Workspace state, after approval and successful compile validation. Change 6's content execution authoritatively proves the selected Unit belongs to an editable Draft Worktree and is a Slide; caller-supplied Worktree/Unit strings never assert Unit type, revision or permission. `replace` clears and rebuilds the selected page, while `add` overlays as defined by the existing page wrapper. A page beyond `pageCount + 1`, target conflict, no-mutation result, confirmed revision, embedded-image side effect and changeset uncertainty retain the shared execution outcome.

Every body uses `AbortSignal.any([exec.signal, owner.signal])` and stays in the existing active-body tracker until compiler, browser, output writer, worker and cleanup settle. Cancellation before a body yields DSH `ABORTED_BEFORE_DISPATCH`. When Core or the body observes cancellation before returning, it starts no later compile/output/apply step and the shared owner adapter distinguishes caller cancellation from owner disposal. A compile-only file write that confirms before caller cancellation retains rc.2 `ABORTED` plus fixed inspection guidance. Apply with a confirmed file has a stronger two-effect obligation only while the body still owns the outcome: a body-observed later cancellation or apply failure becomes the closed `workspace-svg-apply-partial`, so the caller learns that the exact generated program remains on disk. The plugin never deletes confirmed output.

Without file output, apply preserves Change 6's `workspace-content-partial-side-effect`, `workspace-result-unknown` and late-success `ABORTED` behavior. With a confirmed file, a failure or cancellation observed by Core/body before body return throws `workspace-svg-apply-partial` with exactly `{ generated: { kind: "file", location }, content: { state, causeCode, ...safeIdentity } }`. `state` is `not-dispatched`, `failed`, `partial`, `unknown` or `confirmed`; `causeCode` is the already sanitized inherited code, `workspace-operation-cancelled`, or `workspace-plugin-disposing`. A confirmed embedded-image side effect before content commit uses `partial` and only Change 6's confirmed-upload/content-commit fields. An uncertain commit uses `unknown`, cause code `workspace-result-unknown` and only the safe target/changeset identity. A known target/execution failure uses `failed`; body-observed caller/owner cancellation before execution uses `not-dispatched` with the respective cancellation code; body-observed cancellation after a confirmed no-mutation/revision uses `confirmed` and retains only that canonical outcome. The wrapper never nests an Error or message. These states preserve the file-confirmed fact while distinguishing known partial content from commit uncertainty. No SVG compilation, output, image upload or Facade execution is replayed; guidance requires inspecting both the location and Worktree/Unit before deliberate retry.

There is a separate rc.2 race after body ownership ends. If apply has already returned a confirmed success and only ToolRuntime's final caller-cancellation check sees the abort, the registry replaces that success with canonical `ABORTED`; the plugin MUST NOT retroactively manufacture `workspace-svg-apply-partial`. Its total finalizer emits only fixed guidance to inspect the approved output location and Worktree/Unit before retry. It may mention an exact location only if an execution-scoped, already validated confirmed location is safely available; it never echoes or derives one from raw arguments. Owner-only disposal does not abort the registry's caller signal: the owner signal is handled inside the tracked body, disposal awaits that body, and an operation already confirmed before owner cancellation may retain success while the owner drains.

### 6. Project exact safe errors and authorized diagnostics

The tool wrapper reuses only the exact frozen Change 5 local-file codes and Change 6 content-execution codes; it does not add category or prefix matching. SVG adds this closed set:

```text
workspace-svg-argument-invalid
workspace-svg-limit-exceeded
workspace-svg-source-unavailable
workspace-svg-asset-unavailable
workspace-svg-input-outside-root
workspace-svg-output-failed
workspace-svg-apply-partial
workspace-svg-operation-failed
SVG_FACADE_COMPILE_FAILED
BROWSER_UNAVAILABLE
```

It also preserves shared `workspace-file-policy-denied`, `workspace-session-cwd-required`, `workspace-file-path-outside-session`, `workspace-local-filesystem-required`, `workspace-operation-cancelled` and `workspace-plugin-disposing`, plus the exact content codes enumerated by `add-dsh-content-runtime-tools` Design Decision 6. DSH registry-owned `ABORTED_BEFORE_DISPATCH` and `ABORTED` keep registry identity outside the adapter.

Recognized SVG codes receive fixed operation text. Detail may contain only `kind`, numeric `limit`/`actual`, page/mode, safe confirmed output location, the closed partial `state`/`causeCode`, authoritative Worktree/Unit/type, confirmed revision/status and changeset identity already allowed by Change 6. After a confirmed apply output, the adapter first sanitizes the original failure through the inherited exact allowlist, then projects only its code/safe identity into `workspace-svg-apply-partial`; raw causes are never nested. The adapter discards compiler messages, rejected href/path text, raw SVG/code, Host/browser paths, environment, fonts, license, credential, headers, stack, cause and unknown fields. Node `ENOENT`/errno and arbitrary runtime failures become a fixed SVG source/asset/output/operation failure.

Successful warnings and lints are authorized diagnostics derived from the caller-selected SVG and remain lossless even when they quote authored text or element paths. Generated inline code is likewise an intentional successful result. Error sanitation never turns those success fields into error detail.

### 7. Extend one Host owner and the existing artifact closure

The tools, conditional approval listener and active-body tracking join the single fiber-owned Host effect from prior Changes. Disposal marks the owner non-accepting, unregisters both tools/listener, aborts the owner signal, retires the current worker/runtime generation when needed, and awaits every accepted body plus browser/worker close. There are no timers, Jobs, detached retries, daemon sockets or second lifecycle service.

The build continues to inline reachable private Core and pure SDK JavaScript, including exact `@univer-cli/svg-facade@1.0.0-beta.2`. It reuses Change 9's package-relative render page and exact resolved browser packages, Change 6's worker/formula-native closure and the application-owned license resolver. SVG adds no native binding, font bundle, browser binary, CLI artifact or static asset. Real font results retain the existing Host-font ceiling; estimation remains the explicit browserless fallback and keeps its warning lint.

Source tests use real Cordis `ToolRuntime`, mounted local filesystem/policy and narrow compiler/browser/content fakes for validation, approval, budgets, cancellation and uncertainty. Core tests replace/grow source/assets across validation/open boundaries and prove identity mismatch or bounded `remaining + 1` failure without an unbounded read; aggregate assertions use actual bytes. Tool tests cover apply inline/file generated unions, one combined approval, save-before-execute, save failure with zero execution, file-confirmed ordinary failure, commit unknown, caller/owner cancellation and no replay. A real ToolRuntime race test separately proves body-observed post-file cancellation returns `workspace-svg-apply-partial`, while cancellation arriving only after a confirmed body return yields registry-owned `ABORTED` and fixed non-fabricating guidance; owner-only disposal proves drain without registry cancellation. Installed smoke starts from an unrelated cwd with no workspace `node_modules`, installs the tarball in an isolated local profile, compiles a nested local SVG/asset through real ToolRuntime in estimation and explicitly resolved real-browser modes, verifies approved code output, applies that same saved program through a keyless fake Workspace/Collaboration endpoint, and proves partial/unknown/bounded-dispose behavior. Package verification rejects bare private Core imports, absolute/source-checkout paths, sourcemaps, missing worker/render assets and undeclared runtime packages.

## Risks / Trade-offs

- **A relative asset escapes or changes between validation and read** -> Core canonicalizes, opens, verifies the same regular-file identity, performs one bounded read on that descriptor and fails identity races closed.
- **A large SVG or embedded asset exhausts memory/model context** -> Fixed source, aggregate asset, generated-code and canonical-value budgets fail before output publication or apply; no truncation occurs.
- **Browser measurement ignores cancellation briefly** -> Await the frozen operation and `close()`, then start no later step; estimation remains explicit rather than an automatic fallback.
- **Caller cancellation races after apply's exact program is saved** -> Return closed partial only when Core/body observes it before return; registry-only late cancellation stays canonical `ABORTED` with fixed inspection guidance and no fabricated location.
- **Error messages contain SVG text or Host paths** -> Preserve only a frozen code and structured-field allowlist; discard original messages and causes.
- **The package passes source tests but misses render/worker dependencies** -> Walk the packed graph and run real ToolRuntime compile/apply from an unrelated installed cwd.
- **Chromium uses the frozen `--no-sandbox` launch** -> Inherit Change 9's required restricted OS user/container boundary; tool approval is an effect gate, not process isolation.

## Migration Plan

1. Complete Changes 1–6 and 9, then confirm their real Host owner, local-file gate, content execution, worker and render exports.
2. Add optional Core SVG root/limit/signal controls with unsignalled CLI compatibility tests.
3. Register the two tools, schemas, limits, approval branches, safe errors and lifecycle tracking.
4. Extend package verification and run source, Client Core/CLI compatibility, real-browser and isolated installed ToolRuntime gates.

No persisted data migration is required. Rollback unregisters the tools and removes optional DSH call sites; caller-approved generated-code files and already confirmed Draft revisions remain caller/Workspace-owned and are not automatically deleted or reverted.

## Open Questions

无。会改变 tool surface、compile/apply outcome、文件 approval、root/limit policy、取消与 commit uncertainty、package closure 或 Change size 的决定均已由确认边界和冻结源码收敛。
