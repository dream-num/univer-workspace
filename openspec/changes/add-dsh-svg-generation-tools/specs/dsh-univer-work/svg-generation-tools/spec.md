## Purpose

定义 local Host-only `dsh-univer-work` 的 SVG-to-Slide compile 与 Draft apply 工具，使 Agent 能从受约束的本地 SVG/asset 输入获得完整生成结果，并在明确授权后可靠地修改指定 Worktree Slide Unit。

## ADDED Requirements

### Requirement: Stable SVG generation tool surface

The Client Shell SHALL register exactly `workspace_svg_compile` and `workspace_svg_apply` for this capability, SHALL expose closed snake_case arguments and closed canonical values, and MUST NOT accept a generic action, raw/inline SVG, arbitrary code, URL asset, origin, credential, license, render path, Unit type or revision.

#### Scenario: Tool definitions are inspected

- **WHEN** Native or Code Mode reads the registered definitions
- **THEN** both names, descriptions, parameter schemas and canonical output schemas are stable and reject unknown nested fields
- **AND** compile and apply remain separate operations with no Commander, CLI Session, daemon or subprocess dependency

#### Scenario: Root contains an undeclared field

- **WHEN** a call contains an extra root property that the frozen DSH parameter root would otherwise accept
- **THEN** the shared exact-own-key gate returns `workspace-svg-argument-invalid` before approval, model-path resolution, source read, browser, credential, worker, Workspace or output work

### Requirement: SVG compile outcomes

`workspace_svg_compile` SHALL accept one non-empty `source_path`, an optional positive 1-based `page`, optional `add`, optional `estimate_text_size` and optional `output_path`; MUST require a page for add or file output; and MUST compile the source exactly once into the existing code, viewport, text-measure, warning and lint outcomes.

#### Scenario: Raw compile is returned inline

- **WHEN** the caller supplies a valid SVG without `page` or `output_path`
- **THEN** the tool returns the compiler's raw generated code in `{ kind: "inline", code }` with `page` absent, mode `replace`, viewport, text measure, complete warnings and complete lints

#### Scenario: Page program is returned inline

- **WHEN** the caller supplies a positive page, omits `output_path` and optionally selects add mode
- **THEN** the tool wraps the compiled code once for that 1-based page and compiled viewport
- **AND** returns the exact inline page program with mode `replace` or `add`

#### Scenario: Generated page program is written

- **WHEN** the caller supplies a positive page and an approved valid `output_path`
- **THEN** the tool writes exactly the generated page program followed by one newline
- **AND** returns `{ kind: "file", location }` with the same page, mode, viewport, text measure, warnings and lints but does not duplicate generated code in the canonical result

#### Scenario: Estimated measurement is explicit

- **WHEN** `estimate_text_size` is true
- **THEN** no browser runtime starts, `textMeasure` reports the existing deterministic estimator and the existing estimation-placement lint is appended once

#### Scenario: Real measurement is the default

- **WHEN** compilation encounters text and `estimate_text_size` is absent or false
- **THEN** one packaged browser-backed measurement runtime is created lazily, reused for all requested lines and closed before the tool settles
- **AND** browser unavailability fails with fixed setup guidance rather than silently switching to estimation

### Requirement: Host-local source and recursive asset confinement

Both SVG tools MUST require a calling Agent Session cwd, MUST positively identify the supported Host-local execution world before interpreting `source_path`, and MUST constrain the source and every compiler-requested local asset to the canonical Session cwd root.

#### Scenario: Calling Session has no cwd

- **WHEN** a call has no usable Agent Session cwd
- **THEN** it fails with `workspace-session-cwd-required` before any model path, Host path, source, asset, browser, credential, worker or Workspace work

#### Scenario: Filesystem is not Host-local

- **WHEN** the mounted filesystem is E2B, remote or cannot be positively identified as the supported local provider or its in-process sandbox subclass
- **THEN** the call returns `workspace-local-filesystem-required` before resolving a model path or exposing it to Host file APIs

#### Scenario: Source escapes Session cwd

- **WHEN** relative, absolute, parent-traversal or symlink resolution places `source_path` outside canonical Session cwd
- **THEN** the call fails before source read, approval, browser, credential, worker or Workspace work

#### Scenario: Recursive asset remains contained

- **WHEN** the SVG requests one or more valid local image or external-SVG assets whose real identities remain under Session cwd
- **THEN** the compiler reads each through the same bounded compile operation and preserves existing SVG asset semantics

#### Scenario: Asset escapes Session cwd

- **WHEN** an absolute, parent-traversal, `file://` or symlinked asset resolves outside the canonical root
- **THEN** compilation fails with `workspace-svg-input-outside-root` before reading that asset and starts no output or apply step

#### Scenario: SVG contains an HTTP asset

- **WHEN** source references an HTTP or HTTPS asset
- **THEN** this capability performs no network fetch for that asset and preserves the existing compiler outcome for non-local references

### Requirement: Generated-code file policy and approval

Either SVG tool with `output_path` MUST enforce the calling Session's current DSH file-effect policy and canonical containment before and after approval, MUST obtain exactly one operation approval before source/browser/output work, and MUST publish through the mounted filesystem's atomic text-write operation. For apply, that one approval MUST cover both file replacement and Draft content mutation.

#### Scenario: File policy is read-only

- **WHEN** current Session policy forbids local writes
- **THEN** the call returns fixed `workspace-file-policy-denied` before argument-path interpretation, approval, source read, browser creation or output work

#### Scenario: Output path escapes an applicable root

- **WHEN** `output_path` resolves outside Session cwd or the current `workspace-write` policy root before or after approval
- **THEN** the call fails without exposing a Host process path or creating/modifying a file

#### Scenario: Output approval is denied or cancelled

- **WHEN** the one generated-code write approval is denied, unavailable or cancelled
- **THEN** no source, asset, browser or output is opened and no credential or Workspace request occurs

#### Scenario: Approved output replaces an existing file

- **WHEN** a valid approved output path already names a regular file
- **THEN** the provider atomically replaces it with the generated page program and final newline under the current policy

#### Scenario: Apply requests generated-code output

- **WHEN** a valid apply call supplies `output_path` and receives its one combined approval
- **THEN** it compiles once, validates and saves that exact page program before any credential, target, worker or content execution starts
- **AND** a save failure starts no remote apply and requests no second approval

#### Scenario: Policy or path changes across approval

- **WHEN** current policy, provider identity or canonical path containment no longer permits the immutable call after approval
- **THEN** the accepted body fails before source read, browser creation or file mutation and does not request a second approval

### Requirement: Draft Slide apply authority and approval

`workspace_svg_apply` MUST accept one non-empty Worktree identity, one non-empty Unit identity, one positive 1-based page and optional `output_path`, MUST obtain exactly one approval before source/browser/credential/Workspace work, and MUST apply the generated page program only through authoritative shared Slide content execution.

#### Scenario: Apply approval is denied or cancelled

- **WHEN** approval is denied, unavailable or cancelled
- **THEN** no source or asset is read, no browser or worker starts, no credential is resolved and no Workspace request or mutation occurs

#### Scenario: Replacement page is applied

- **WHEN** a valid approved call omits `add`
- **THEN** the tool compiles once, wraps once in replace mode and executes that exact program once against the selected Draft Worktree Slide Unit
- **AND** returns complete diagnostics, the exact inline generated page program and the existing confirmed-revision or no-mutation result

#### Scenario: Add page program is applied

- **WHEN** a valid approved call sets `add: true`
- **THEN** the same authority and single-execution rules apply in add mode without clearing existing page elements

#### Scenario: Saved program is the applied program

- **WHEN** approved apply includes `output_path` and the SVG or a relative asset changes after compilation
- **THEN** the tool saves and executes the same already compiled in-memory program exactly once
- **AND** returns `{ kind: "file", location }` instead of inline code with the existing diagnostics and apply result

#### Scenario: Unit is not an editable Draft Slide

- **WHEN** authoritative target resolution finds Trunk scope, a non-editable Worktree, a missing Unit or a non-Slide Unit
- **THEN** the operation preserves the applicable target/type failure before content mutation and does not trust a caller assertion

#### Scenario: Page cannot be selected at execution

- **WHEN** the 1-based page exceeds the existing page-count-plus-one rule or content execution otherwise rejects the generated program
- **THEN** the tool preserves the shared execution failure and performs no compile or program replay

### Requirement: SVG input and canonical result budgets

Both tools MUST limit complete arguments to `65,536` canonical UTF-8 bytes, source SVG to `10,485,760` bytes, aggregate compiler-requested local assets to `67,108,864` bytes, generated code to `8,000,000` UTF-8 bytes, and every complete canonical success to `8,388,608` UTF-8 JSON bytes and depth `64`.

#### Scenario: Argument limit is exceeded

- **WHEN** a complete argument record exceeds `65,536` canonical bytes
- **THEN** the operation returns `workspace-svg-limit-exceeded` before approval, path resolution, source read or authenticated allocation

#### Scenario: Source or asset limit is exceeded

- **WHEN** source bytes exceed `10,485,760` or aggregate local asset bytes exceed `67,108,864`
- **THEN** compilation stops before reading later assets, starting output or applying content and reports the exact safe limit kind

#### Scenario: Generated code or canonical result is too large

- **WHEN** generated code exceeds `8,000,000` bytes or the complete success exceeds its byte/depth budget
- **THEN** the operation returns `workspace-svg-limit-exceeded` without truncation, file publication, worker execution or remote mutation

#### Scenario: Apply compile projection is checked before its first effect

- **WHEN** apply's generated code, diagnostics or generated union cannot fit the fixed complete logical-result limits
- **THEN** it publishes no requested output file and starts no target or content execution

#### Scenario: Apply value is too large

- **WHEN** shared Slide execution would return a non-lossless or over-budget value
- **THEN** its existing pre-commit value gate uses the canonical bytes remaining after the exact SVG envelope/generated projection and fails before embedded-image upload, mutation replacement or commit
- **AND** if apply already saved generated code, the tool returns the file-confirmed apply-partial outcome without deleting or replaying it

### Requirement: SVG failure fidelity and secrecy

The Client Shell MUST preserve only the exact inherited local-file/content errors and the SVG code set enumerated in Design Decision 6, MUST add no category or prefix match, and MUST map every unlisted or unsafe dependency failure to `workspace-svg-operation-failed` with fixed text.

#### Scenario: Compiler rejects SVG

- **WHEN** exact SVG facade rejects malformed or unsupported source
- **THEN** the tool preserves `SVG_FACADE_COMPILE_FAILED` with fixed guidance but does not expose the compiler message, raw SVG, rejected href or Host path in error detail

#### Scenario: Source, asset or output fails

- **WHEN** a Node filesystem error, invalid asset or output provider failure occurs
- **THEN** the tool returns the applicable fixed source/asset/output code without errno, temporary name, Host path, stack or cause

#### Scenario: Content commit is uncertain

- **WHEN** shared execution reports `workspace-content-partial-side-effect` or `workspace-result-unknown` before any generated file confirms
- **THEN** the tool preserves that structured identity and fixed inspect/no-replay guidance rather than reducing it to a generic SVG error

#### Scenario: Generated file confirms before apply fails

- **WHEN** apply saves its exact program and later target or execution work fails with a sanitized ordinary code
- **THEN** it returns `workspace-svg-apply-partial` with the confirmed location, content state `failed` and only that sanitized `causeCode`/safe identity
- **AND** it does not nest the original error, delete the file or retry apply

#### Scenario: Generated file confirms before commit becomes unknown

- **WHEN** apply saves its exact program and a later commit may have dispatched without confirmation
- **THEN** it returns `workspace-svg-apply-partial` with the confirmed location, content state `unknown`, cause code `workspace-result-unknown` and only the inherited safe target/changeset identity
- **AND** fixed guidance requires inspecting both the file and Worktree Unit before deliberate retry

#### Scenario: Generated file and embedded-image side effect confirm before content commit

- **WHEN** apply saves its exact program and shared execution later reports confirmed embedded-image side effects without a content commit
- **THEN** it returns `workspace-svg-apply-partial` with the confirmed location, content state `partial`, cause code `workspace-content-partial-side-effect` and only the inherited confirmed-upload/content-commit identity
- **AND** it performs no compensating file deletion, image deletion, re-upload, compile or execution replay

#### Scenario: Failure contains unsafe material

- **WHEN** an error message, cause, compiler diagnostic, environment, browser path, code, credential, license, SVG or asset byte contains a sentinel
- **THEN** that material appears in no plugin-owned error content or detail

#### Scenario: Successful compile has diagnostics or inline code

- **WHEN** a valid compile returns authored warnings/lints or inline generated code
- **THEN** those explicitly requested success fields remain lossless and are not treated as error secrets

### Requirement: Cancellation, no replay and Host lifecycle

Every SVG tool MUST fuse caller and Host-owner cancellation, pass it through every supported file, compiler, browser, worker and Workspace step, await uninterruptible work and cleanup, and MUST NOT retry or replay compilation, output or apply after settlement.

#### Scenario: Caller cancels before body dispatch

- **WHEN** caller cancellation arrives before ToolRuntime invokes a body
- **THEN** DSH returns `ABORTED_BEFORE_DISPATCH` and no plugin validator body, source, browser, credential, worker, Workspace or output work runs

#### Scenario: Compile cancellation precedes output publication

- **WHEN** cancellation becomes visible during source, asset, compiler or browser work before generated-code output commits
- **THEN** runtime cleanup completes, no file is published and no later compile stage starts

#### Scenario: File publication wins caller cancellation

- **WHEN** `workspace_svg_compile` confirms an approved generated-code write but caller cancellation wins before DSH finalization
- **THEN** DSH returns canonical `ABORTED` with fixed guidance to inspect the approved location before deliberate retry
- **AND** the plugin does not delete, overwrite or regenerate the confirmed file

#### Scenario: Apply becomes unknown after dispatch

- **WHEN** cancellation occurs after embedded-image upload or changeset commit may have dispatched and no generated file was saved
- **THEN** the existing partial-side-effect or result-unknown failure is preserved, no next attempt starts, and compilation, image externalization and Facade execution are never replayed

#### Scenario: Apply cancels after file publication but before content dispatch

- **WHEN** Core or the body observes caller or owner cancellation after apply saves the exact program but before shared Slide execution dispatches
- **THEN** the tool returns `workspace-svg-apply-partial` with the confirmed location, content state `not-dispatched` and the applicable `workspace-operation-cancelled` or `workspace-plugin-disposing` cause code
- **AND** no credential, target, worker or content mutation starts

#### Scenario: Apply cancels after file publication and content dispatch

- **WHEN** Core or the body observes caller or owner cancellation after the file confirms and content execution fails, becomes unknown or confirms before body return
- **THEN** `workspace-svg-apply-partial` preserves the confirmed file plus content state `failed`, `partial`, `unknown` or `confirmed` and only the matching safe outcome identity
- **AND** the plugin deletes neither effect and replays neither compile nor apply

#### Scenario: Registry alone observes cancellation after confirmed apply return

- **WHEN** apply body has already returned a confirmed success and only DSH ToolRuntime's final caller-cancellation check observes the abort
- **THEN** DSH returns canonical `ABORTED` rather than a retroactively manufactured `workspace-svg-apply-partial`
- **AND** the total finalizer gives fixed guidance to inspect the approved output location and Worktree Unit, names an exact location only when an execution-scoped validated confirmed location is available, and never echoes or derives one from raw arguments

#### Scenario: Confirmed revision wins inside Core but caller aborts

- **WHEN** apply has no generated file, Core confirms a revision before it observes cancellation and caller cancellation wins DSH finalization
- **THEN** DSH returns canonical `ABORTED` with fixed guidance to inspect the Worktree/Unit before retrying and does not claim the mutation failed

#### Scenario: Host disposes during SVG work

- **WHEN** the owning fiber disposes with approval, compile, output, browser, worker or apply active
- **THEN** it rejects new calls, unregisters both tools/listener, aborts owner-controlled work, awaits every accepted body and closes browser/worker owners before disposal returns
- **AND** owner-only disposal does not abort the ToolRuntime caller signal or claim registry-owned `ABORTED`; an already confirmed operation may retain success while disposal drains it

### Requirement: Installed SVG generation closure

The prebuilt tarball MUST carry the exact SVG compiler, worker and render-runtime closure required by the two tools and MUST run them through real DSH ToolRuntime from an unrelated cwd without a workspace checkout.

#### Scenario: Packed artifact is inspected

- **WHEN** package verification walks Host/worker imports, manifests and render-page assets
- **THEN** every dependency is inlined or exact-declared according to the existing package policy
- **AND** no bare private Core import, CLI source/artifact, sourcemap, absolute checkout path, browser binary, font bundle, Office/Typst native asset or future Skill is included

#### Scenario: Installed compile runs

- **WHEN** an isolated local profile installs the tarball and invokes compile through real ToolRuntime from an unrelated Session cwd
- **THEN** nested contained assets, estimation, explicitly resolved real-browser measurement and approved generated-code output settle with exact canonical results and cleanup

#### Scenario: Installed apply runs keylessly

- **WHEN** the installed apply tool targets a keyless fake Workspace/Collaboration service
- **THEN** it saves and executes the same exact program when output is selected, reaches the packaged worker, performs one Draft Slide execution and verifies confirmed, file-partial, unknown, caller-abort and bounded-dispose paths without a real credential

### Requirement: Browser deployment boundary

Because the frozen render runtime launches Chromium with `--no-sandbox`, the operator MUST run real SVG text measurement as a restricted OS user or in a restricted container with bounded filesystem and network access; tool approval and local path containment MUST NOT be described as browser process isolation.

#### Scenario: Real SVG measurement is deployed

- **WHEN** an operator enables browser-backed SVG compilation
- **THEN** the Host inherits the documented Change 9 restricted user/container boundary and only intended Session-cwd and Workspace/network access
