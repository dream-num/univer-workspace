## Context

`packages/client-core/src/{render-unit,screenshot,layout-lint}.ts` already form one Node-hosted render slice. The loader resolves Trunk/Worktree targets, exports Host/reference/Embed UnitData and rewrites Worktree Asset images in a render copy. Screenshot and layout lint each create one `@univer-cli/univer-render-runtime` browser, pass the application-owned license and packaged render page, then await `close()` in `finally`. Screenshot additionally writes ordered PNGs through private same-directory files and exclusive links; a multi-image result is intentionally not a transaction.

The current cancellation seam starts only after render Unit loading: upstream screenshot/lint inputs accept `signal`, but `WorkspaceRenderUnitLoadInput`, its target/export calls and `writeImages()` do not. DSH therefore needs one backwards-compatible Core signal path before it can truthfully forward `exec.signal` from target lookup through the browser and local publication.

This Change depends on the authenticated/runtime owner from `add-dsh-content-runtime-tools` and the local execution-world/file-policy gate from `add-dsh-file-transfer-tools`. It extends those owners instead of introducing a renderer service, browser pool, file adapter or daemon.

## Goals / Non-Goals

**Goals:**

- Expose one screenshot operation and one Slide layout-lint operation with DSH-native schemas and canonical values.
- Preserve the exact beta.2 screenshot targets, PNG metadata, Slide findings and Core render-copy semantics.
- Keep every generated PNG inside the calling Agent Session cwd and current file-effect policy.
- Carry caller/owner cancellation through remote reads, worker export, Asset resolution, browser work, PNG publication and cleanup without abandoning work.
- Preserve known partial local output and prevent implicit recapture or rewrite after an uncertain caller outcome.
- Prove the installed package carries its worker, render page, browser JavaScript dependencies and local static assets.
- State the existing Chromium `--no-sandbox` deployment prerequisite explicitly: operators run these tools as a restricted OS user or in a restricted container with bounded filesystem and network access.

**Non-Goals:**

- Do not add browser installation/configuration tools, a shared browser process, Jobs, attachments, another image format or overwrite mode.
- Do not support non-local filesystem providers, Trunk layout lint, rule selection or new render targets.
- Do not move browser setup ownership from Workspace CLI, change Chromium's existing `--no-sandbox` launch, or claim that DSH approval/process policy supplies browser isolation.
- Do not add Office, Typst, SVG, discovery, Skills, Web Client or CLI compatibility wrappers.

## Diagram design

```text
DSH Agent
  ├── workspace_layout_lint ───────────────┐
  └── workspace_screenshot ─ file policy ─ ask
                  │ fused caller/owner signal
                  ▼
existing Host runtime generation + Client Core render loader
  ├── target / UnitData / references / Worktree Assets
  └── per-call browser + packaged render page
                  │
          ┌───────┴────────┐
          ▼                ▼
 complete lint report   atomic PNG files in Session cwd
```

## Decisions

### 1. Keep two outcome-specific tools and the published beta.2 targets

`workspace_screenshot` accepts:

```text
unit_id: non-empty string
scope: trunk | worktree
worktree_id: required only for worktree
output_directory?: local Session path, default screenshots
target?: exact one-of
  { kind: sheet-viewport, scale? }
  { kind: sheet-range, range, sheet_name?, scale? }
  { kind: doc-pages, pages?: positive integer[], scale? }
  { kind: slide-pages, pages?: (positive integer | non-empty page id)[],
    scale?, contact_sheet?: { tile?: { columns, rows } } }
  { kind: board-content, element_ids? xor region?, padding?, scale? }
  { kind: base-view, scale? }
```

The root scope contract is exact: `scope: trunk` forbids `worktree_id`, while `scope: worktree` requires a non-empty `worktree_id`. The caller cannot supply `unit_type`, `revision` or `origin`. The existing authenticated Core target/source workflow resolves the authoritative Unit type and selected revision; a screenshot target/type mismatch fails after the approved target probe but before render-page or browser creation.

Omitting `target` preserves the SDK's Unit-type default: active Sheet used range, all Doc/Slide pages, all Board content or active Base view. Scale remains `0.1..4`; numeric pages are one-based; screenshot selects at most the SDK's frozen 30 pages; Sheet ranges keep beta.2 A1 syntax; Board regions require finite positive size, element ids are non-empty, and padding/scale without a Board selector remains invalid. A target whose kind does not match the authoritative loaded Unit fails after approval without being coerced.

The canonical screenshot value is `{ kind: 'workspace-screenshot', unitId, unitType, outputs }`. Each output is the upstream image metadata plus canonical `location`, excluding only `bytes`; it retains name, `image/png`, width/height and applicable Sheet range, page/pageId, contact-sheet, Board selector/content bounds/layout analysis, padding and scale fields. Target nested objects are closed before render; capture metadata is closed after capture and before any file publication. PNG bytes never enter the value, `output.render`, presentation metadata or a plugin-owned Session event.

`workspace_layout_lint` accepts exact non-empty `worktree_id`, `unit_id` and optional `pages` containing at most 10,000 positive one-based numbers or non-empty Slide page ids, matching the current CLI parser ceiling. It returns the complete closed `UnitLayoutLintReport`: kind, Slide Unit identity/type, covered pages/rules and ordered findings with their existing text/container/overflow/overlap evidence. It has no caller rule filter because beta.2 exposes none.

Both definitions publish a closed root even though rc.2 `defineTool()` compiles an open parameter root, and both run the existing exact-own-key wrapper before body work. The shell does not expose UnitData, revision, render-page/browser path, license, credential, raw bytes, arbitrary operation or generic file action.

The fixed application budgets are:

```text
MAX_RENDER_ARGUMENT_BYTES       = 65,536 canonical JSON UTF-8 bytes
MAX_SCREENSHOT_PAGES            = 30
MAX_LAYOUT_PAGE_SELECTORS       = 10,000
MAX_RENDER_CANONICAL_BYTES      = 8,388,608 canonical JSON UTF-8 bytes
MAX_RENDER_CANONICAL_DEPTH      = 64
SDK maxPixels                   = 16,777,216 per rendered image
```

Schema/type/cross-field checks precede canonical argument bytes, then selector counts and semantic values. Complete lint metadata is checked for exact keys, depth and bytes before return. Screenshot capture metadata, approved canonical directory and Core-safe basenames are used to construct the exact bytes-free `{ kind, unitId, unitType, outputs }` candidate, including every canonical `location`, and that closed candidate must pass exact-key, depth and 8 MiB validation before the first PNG publication. Excess or malformed metadata fails with `workspace-render-limit-exceeded` or `workspace-screenshot-output-invalid`, creates zero destination files, never truncates and never spills the canonical value. SDK page/pixel/scale limits remain authoritative for browser work. DSH presentation spill, if configured downstream, does not relax the Code Mode value budget.

Alternatives rejected:

- One generic `workspace_render` action weakens target and output schemas and couples local writes to read-only lint.
- Separate tools per Unit type duplicate one upstream discriminated operation without adding authority or approval value.
- Returning attachments or base64 duplicates the local-only file contract and puts large bytes into durable tool results.

### 2. Reuse the exact local file gate and ask once for screenshot output

The existing fiber-owned `tools/pre-execute` listener handles `workspace_screenshot`. It first resolves the current Session file-effect policy. `read-only` returns fixed `workspace-file-policy-denied` before argument/path inspection or approval. It next requires the exact public rc.2 `LocalFileSystem` constructor identity before any model path interpretation, accepting the base in-process sandbox subclass and rejecting E2B/remote providers with `workspace-local-filesystem-required`.

Only after those gates does preflight run the shared pure screenshot argument validator, require `exec.agent.session.header.cwd`, resolve the default or supplied output directory through `ctx.fs`, and require containment by Session cwd plus the current policy workspace root when applicable. It does not call `processPath()`, stat/create files, load credentials/targets or start the browser. A valid call produces one fixed, secret-free `ask` for PNG creation.

The approved body validates the immutable arguments again, re-reads current policy, rechecks constructor identity and re-resolves containment. It calls `processPath()` only after every current gate succeeds and passes that canonical directory to Core. Generated image names must still pass Core's basename rule, so every output stays below the approved directory. There is no `force`: pre-existing or concurrently won destinations remain untouched.

`workspace_layout_lint` is a remote/content read and local browser computation. It delegates existing DSH policy and requests no new approval. Neither tool opts into sibling parallelism because each can hold a worker lease and browser-sized memory.

### 3. Append one optional signal through the existing Core capability

Core adds optional signal positions only along the reached slice:

```text
WorkspaceRenderUnitLoadInput.signal?
WorkspaceRenderUnitLoaderOptions.openSource(signal?)
WorkspaceScreenshotWriteInput.signal?
WorkspaceUnitLayoutLintFeature.loadUnit({ ..., signal? })
```

The loader passes the signal to source opening, Trunk/Worktree/reference target resolution, UnitData export and Worktree Asset reads, including `resolveUnitScreenshotImageAssets(..., signal)`. Screenshot and lint continue passing that signal to runtime construction and the upstream operation. The file writer checks before and after name/existence work, each uninterruptible temp write/link and cleanup boundary. It always awaits browser `close()` and non-cancellable temp/handle cleanup before settlement.

Existing CLI adapters omit every new optional field. Their target resolution, daemon payload, screenshot/lint values, coded failures, browser lifecycle and local output behavior remain unchanged.

### 4. Preserve per-image atomicity and classify supplied-signal partial output

The shell validates the complete capture before publication. It rejects unknown metadata fields, unsafe/duplicate basenames, invalid dimensions or locations, constructs each canonical `location` from the approved canonical directory plus the safe basename, and validates the exact closed screenshot success candidate against the 64-depth/8 MiB budget. Oversize or malformed capture output therefore writes zero files. Only the prevalidated candidate and captured bytes enter `writeImages()`; the writer repeats its own name/destination safety checks, writes a private `0600` same-directory temporary file, links it exclusively, then removes the temporary file. The set of images remains non-transactional; no rollback is introduced.

With a supplied signal, Core records each confirmed link. If cancellation or any later failure occurs after one or more outputs committed but before the complete set settles, Core raises `workspace-screenshot-output-partial` with exactly:

```text
{
  totalOutputCount,
  committedOutputCount,
  committedOutputs: [{ name, location }],
  causeCode
}
causeCode = ABORTED
          | workspace-screenshot-output-exists
          | workspace-screenshot-output-failed
```

The first two fields are non-negative integers with `committedOutputCount <= totalOutputCount`; the array length equals `committedOutputCount`, and every identity comes from the prevalidated candidate. Cancellation maps to `ABORTED`, an exclusive-link destination race maps to `workspace-screenshot-output-exists`, and every other post-commit filesystem/runtime failure maps to `workspace-screenshot-output-failed`. No message, `cause`, errno, stack or unknown nested detail crosses this boundary. Core starts no next output, deletes no committed image and does not recapture, rewrite or retry. The DSH adapter projects this exact Core-owned detail and fixed guidance to inspect the approved output directory and its listed committed locations before any deliberate retry; it never suggests or performs replay.

If cancellation is observed before any link, cleanup leaves no new destination. If every link confirms and the original caller aborts before DSH finalization, the body may return success but rc.2 replaces it with canonical `ABORTED`; the total finalizer retains that registry identity and says the output directory may contain the complete set and must be inspected before a deliberate retry. Owner-only disposal does not abort the original caller signal; a confirmed complete result may remain success while disposal drains it.

No remote mutation occurs in this Change. A read-side `workspace-result-unknown`, browser failure or caller abort triggers no automatic target reload, recapture, lint rerun or file write. Local link completion is awaited and therefore classified as confirmed or not committed, rather than inventing a local result-unknown state.

### 5. Reuse the current worker/license owner and keep browsers per call

Both tools acquire Change 6's current content runtime generation to export UnitData. Credential replacement/delete retires that generation exactly as already specified; render code never caches a Login Session separately. It reuses the same application-owned license resolver and passes the non-empty license to a package-relative render page. Credential/license values never enter arguments or output.

Each accepted operation creates one browser runtime after target loading and closes it in the Core `finally`. A pool would add cross-call browser state, credential/font leakage and disposal complexity without measured need. The environment retains beta.2 resolution order: explicit operator `UNIVER_RENDER_BROWSER`, SDK browser cache, then supported system browser. Missing browser returns sanitized `BROWSER_UNAVAILABLE`; the plugin does not download or configure one through a model tool.

Beta.2 launches Chromium with `--no-sandbox`. The supported deployment therefore requires the DSH Host process to run as a restricted OS user or inside a restricted container with only the intended Workspace/network endpoints and Session-cwd filesystem access. Screenshot approval authorizes a local file effect; it is not browser/process isolation. Layout lint's lack of file approval likewise says nothing about browser isolation. The package README and installed smoke state and exercise this prerequisite; this Change does not add a sandbox wrapper or weaken the local file gate.

The Render Page uses its existing preset and bundled local assets. Font choice and fallback remain browser/host behavior; this Change packages every font/static file emitted by the Core Vite build and rejects remote asset references, but does not claim byte-identical layout across hosts with different installed fonts.

### 6. Freeze the render error boundary

The shared adapter reuses the complete inherited Change 5 file-transfer allowlist, unchanged:

```text
workspace-argument-invalid
workspace-invalid-response
workspace-result-mismatch
workspace-result-unknown
workspace-origin-mismatch
workspace-authentication-required
workspace-request-invalid
workspace-redirect-refused
workspace-resource-kind-mismatch
workspace-blob-source-unavailable
workspace-blob-source-invalid
workspace-blob-size-mismatch
workspace-blob-download-unavailable
workspace-blob-upload-terminal
workspace-blob-output-exists
workspace-blob-output-unavailable
workspace-blob-output-invalid-state
workspace-blob-download-write-failed
workspace-asset-size-mismatch
workspace-asset-output-exists
workspace-asset-output-unavailable
workspace-asset-output-invalid-state
workspace-asset-download-write-failed
workspace-file-policy-denied
workspace-session-cwd-required
workspace-file-path-outside-session
workspace-local-filesystem-required
workspace-file-operation-failed
UNAUTHENTICATED
INVALID_INPUT
FORBIDDEN
NOT_FOUND
CONFLICT
PAYLOAD_TOO_LARGE
INTERNAL_ERROR
```

It also reuses the complete inherited Change 6 content allowlist, unchanged:

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
UNAUTHENTICATED
INVALID_INPUT
FORBIDDEN
NOT_FOUND
CONFLICT
INTERNAL_ERROR
```

The existing shared owner classifications `workspace-operation-cancelled` and `workspace-plugin-disposing` remain unchanged. DSH registry-owned `ABORTED_BEFORE_DISPATCH` and late-success `ABORTED` bypass the plugin error adapter and retain their registry identity. None of these four codes is redefined by this Change.

This Change adds only these render codes:

```text
workspace-render-argument-invalid
workspace-render-limit-exceeded
workspace-screenshot-target-required
workspace-screenshot-unit-data-invalid
workspace-screenshot-reference-unit-type-unsupported
workspace-screenshot-reference-resource-invalid
workspace-screenshot-embed-resource-invalid
workspace-screenshot-output-invalid
workspace-screenshot-output-exists
workspace-screenshot-output-partial
workspace-screenshot-output-failed
workspace-unit-layout-lint-unit-type-unsupported
workspace-render-operation-failed
PAGE_LIMIT_EXCEEDED PIXEL_LIMIT_EXCEEDED
RENDER_RESULT_INVALID SCREENSHOT_ABORTED
BROWSER_UNAVAILABLE RENDER_ABORTED RENDER_FAILED
RENDER_TARGET_INVALID RUNTIME_CLOSED INVALID_RENDER_RESULT
```

Recognized codes receive fixed operation text. Safe detail is a closed projection of authoritative scope/Worktree/Unit/type, numeric limits/counts, validated page/range kind, confirmed output name/location/count and fixed browser-availability guidance. Partial output uses only the exact Decision 4 detail and allowlisted `causeCode`. It never copies an original message, stack/cause, browser checked paths, environment, UnitData, cell/text content, Asset bytes, credential, license, rejected raw selector/path or unknown field. Any code outside the two fully enumerated inherited sets and this Change's additions, or any other thrown value, becomes `workspace-render-operation-failed`.

Successful lint text and screenshot metadata are authorized requested content and remain complete. Native rendering and total finalizers consume only the validated canonical value or registry-owned error identity.

### 7. Extend the existing fiber owner and drain every resource

The current Host effect registers the two definitions and screenshot pre-execute branch, tracks accepted bodies before credential/runtime work, and fuses `exec.signal` with its owner signal. Disposal marks the owner non-accepting, unregisters the tools/listener, aborts owner-controlled work, retires the current worker generation and awaits every accepted body. Core bodies await browser close and file cleanup, so no browser process, page server, worker, lease, request, temp file handle, retry, timer, Job or detached promise survives disposal.

Caller cancellation that reaches a Core partial-output throw remains that tool-owned error because rc.2 only replaces late successful body values with `ABORTED`. Owner-only cancellation maps the same known partial code for the live caller while disposal drains it. Neither finalizer retries or polls.

### 8. Add only the render resources to the existing packed closure

Package assembly copies Client Core's built `dist/render-runtime` beside the emitted Host/worker entries. Verification walks `index.html` and every referenced asset, rejects missing files, sourcemaps, absolute/source-checkout paths and remote URLs, and retains the existing exact worker child/formula native closure from Change 6.

The build resolves `@univer-cli/univer-render-runtime` from Client Core's installed dependency graph, follows the resolved package/manifest through `realpath`, and rejects any version other than exact `1.0.0-beta.2`. From that physical owner directory, it resolves the actual installed `puppeteer-core` and `@puppeteer/browsers` packages rather than copying their owner-declared semver ranges. It follows each resolved package manifest through `realpath`, reads its concrete exact `version`, writes that exact version into the packed manifest and verifies after pack/install that the manifest and resolved package versions are identical. At the frozen lock this currently resolves `puppeteer-core@25.8.0` and `@puppeteer/browsers@3.2.1`; these are observed lock facts, while physical owner-relative resolution remains the build rule. Reachable private Core/SDK JavaScript remains inlined; exact DSH/Cordis and browser/native packages remain declared externals. It does not copy CLI `dist/render-runtime`, browser cache/binary, Office/Typst/SVG native assets, Skills or an adjacent checkout.

Source tests use real Cordis `ToolRuntime`, the mounted local filesystem/policy and injected render/runtime fakes for every validation, approval, cancellation and partial-output branch. Installed smoke starts from an unrelated temporary cwd with no workspace `node_modules`, verifies the real render-page dependency graph and exact browser package resolution, then runs screenshot/lint through real ToolRuntime against a keyless fake Workspace/Collaboration service and an explicitly resolved test browser under a restricted temporary OS-user/container filesystem and network boundary. It inspects exact PNG bytes/metadata, findings, Native/Code Mode secret sentinels, caller abort and bounded dispose without a model credential or real Workspace account.

## Risks / Trade-offs

- **Render metadata or findings exceed a model-safe value** -> Reject the complete result at the fixed byte/depth gate; do not truncate canonical data or put PNG bytes in the result.
- **Caller cancellation races a confirmed PNG link** -> Preserve structured committed outputs or DSH `ABORTED`, require directory inspection and never recapture automatically.
- **Browser or render page is missing after pack** -> Resolve exact owner dependencies, walk the installed asset graph and run the tarball smoke from an unrelated cwd.
- **Host fonts differ** -> Package emitted local assets and document the existing system-font ceiling instead of claiming cross-host pixel determinism.
- **Browser work ignores cancellation briefly** -> Await upstream/browser completion and `close()`; start no later output after Core observes the signal.
- **An allowlisted dependency error contains content or host paths** -> Use fixed text and exact structured field projection; discard message, cause and unrecognized detail.
- **Chromium runs with `--no-sandbox`** -> Require a restricted OS user/container with bounded filesystem/network access and document that tool approval is an effect gate, not process isolation.

## Migration Plan

1. Complete Changes 1–6 and verify their current Host owner, local file gate, content runtime/worker and Core public exports.
2. Add optional Core signals and partial-output reporting with focused unsignalled CLI compatibility tests.
3. Add the two DSH tools, screenshot approval branch, schemas, budgets, errors and lifecycle tracking.
4. Copy/verify the render page and exact browser dependencies, then run source, browser, Client Core, CLI and isolated tarball gates.

There is no persisted Workspace data migration. Rollback unregisters the tools and removes the optional-signal call sites/render assets; confirmed PNGs remain ordinary caller-owned local files, while Workspace content and existing CLI artifacts require no conversion.

## Open Questions

无。会改变 tool names、target/result formats、file approval、browser prerequisite、signal/partial-output behavior、package closure或 Change size 的决定均已由确认范围、现有 Core behavior与冻结 DSH/SDK source 收敛。
