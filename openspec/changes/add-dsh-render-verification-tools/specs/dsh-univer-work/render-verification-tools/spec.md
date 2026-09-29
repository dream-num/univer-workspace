## Purpose

定义 local Host-only `dsh-univer-work` 的 Workspace screenshot 与 Slide layout verification 工具，使 Agent 能获得完整结构化诊断，并把 PNG 安全写入调用 Session 的本地工作目录。

## ADDED Requirements

### Requirement: Stable render-verification tool surface

The Client Shell SHALL register exactly `workspace_screenshot` and `workspace_layout_lint` for this capability, SHALL expose closed snake_case arguments and closed canonical values, and MUST NOT accept caller-supplied `unit_type`, `revision` or `origin` or expose raw UnitData, revisions, credentials, licenses, browser/render-page paths, PNG bytes, arbitrary code or a generic render action.

#### Scenario: Tool schemas are inspected

- **WHEN** Native or Code Mode reads the registered definitions
- **THEN** both names, descriptions, argument schemas and canonical output schemas are stable and reject unknown nested fields
- **AND** screenshot and layout lint remain separate operations with no Commander command or CLI Session dependency

#### Scenario: Root contains an undeclared field

- **WHEN** a call contains an extra root property that the rc.2 implicit parameter root would otherwise accept
- **THEN** the shared exact-own-key gate returns `workspace-render-argument-invalid` before credential, Workspace, worker, browser or Host-file work

### Requirement: Scope-aware Workspace screenshot

`workspace_screenshot` MUST accept a non-empty Unit identity, an exact Trunk or Worktree scope, an optional local output directory defaulting to `screenshots`, and at most one exact screenshot target compatible with the authoritative Unit type.

#### Scenario: Trunk scope is selected

- **WHEN** the caller supplies `scope: "trunk"`
- **THEN** `worktree_id` is forbidden
- **AND** the authenticated Core workflow resolves the authoritative Trunk target, Unit type and selected revision

#### Scenario: Worktree scope is selected

- **WHEN** the caller supplies `scope: "worktree"`
- **THEN** an exact non-empty `worktree_id` is required
- **AND** the authenticated Core workflow resolves the authoritative Worktree target, Unit type and selected revision

#### Scenario: Default screenshot target is used

- **WHEN** the caller selects a valid Trunk or Worktree Unit and omits `target`
- **THEN** the operation uses the frozen SDK default for that authoritative Sheet, Doc, Slide, Board or Base
- **AND** it returns `{ kind: "workspace-screenshot", unitId, unitType, outputs }` after every PNG is committed

#### Scenario: Explicit screenshot target is used

- **WHEN** the caller supplies a valid Sheet viewport/range, Doc pages, Slide pages/contact sheet, Board content selector or Base view target
- **THEN** the operation preserves the target's beta.2 one-based page, page-id, A1 range, Board region/elements, padding, tile and `0.1..4` scale semantics
- **AND** it rejects incompatible Unit/target kinds after the authoritative target probe but before render-page or browser creation instead of coercing them

#### Scenario: Screenshot returns diagnostic metadata

- **WHEN** one or more PNGs are captured and written
- **THEN** each ordered output contains its canonical local location, safe name, `image/png`, width, height and every applicable page, range, contact-sheet or Board layout field from the validated capture
- **AND** no PNG byte appears in the canonical value, Native content, presentation metadata or plugin-owned durable event

#### Scenario: Existing destination would be replaced

- **WHEN** any generated PNG destination exists before preflight or wins a concurrent exclusive-commit race
- **THEN** the operation returns `workspace-screenshot-output-exists`, preserves that destination and provides no overwrite option

### Requirement: Screenshot local execution-world and approval gate

`workspace_screenshot` MUST use the current calling Session file-effect policy and positively proven Host-local execution world before interpreting an output path, MUST constrain every output to the Session cwd and applicable policy root, and MUST obtain exactly one approval before target, browser or file work.

#### Scenario: File policy is read-only

- **WHEN** the current calling Session policy forbids local writes
- **THEN** the operation returns fixed `workspace-file-policy-denied` before argument/path inspection, approval, credential, Workspace, browser, `processPath` or Host-file work

#### Scenario: Filesystem is not Host-local

- **WHEN** the mounted execution world cannot be positively identified as the supported local provider or its in-process sandbox subclass
- **THEN** the operation returns `workspace-local-filesystem-required` before model-path resolution, approval, credential, Workspace, browser or Host-file work

#### Scenario: Output escapes the current roots

- **WHEN** the default or supplied output directory resolves outside Session cwd or the current applicable policy root before or after approval
- **THEN** the operation fails without exposing a Host process path or creating any file

#### Scenario: Approved screenshot body starts

- **WHEN** valid preflight receives approval
- **THEN** the body revalidates immutable arguments, current policy, local-provider identity and canonical containment before obtaining the Host-local directory
- **AND** each Core-validated basename is written only beneath that directory

#### Scenario: Approval is denied or cancelled

- **WHEN** the screenshot approval is denied or cancelled
- **THEN** no credential, Workspace target, worker, browser, render page, temporary file or destination is opened

### Requirement: Worktree Slide layout lint

`workspace_layout_lint` SHALL accept one non-empty Worktree identity, one non-empty Unit identity and optional positive one-based page numbers or non-empty page ids, MUST reject a non-Slide Unit before browser creation, and MUST return the complete frozen structured lint report without modifying Workspace or local files.

#### Scenario: Slide layout has findings

- **WHEN** selected Worktree Slide pages produce browser-backed findings
- **THEN** the canonical report contains kind, Unit identity/type, covered pages/rules and every ordered finding with its existing page, rule, severity, text, container, overflow, overlap and evidence fields

#### Scenario: Slide layout has no finding

- **WHEN** all selected pages satisfy the current rules
- **THEN** the operation succeeds with an empty findings array and complete coverage rather than treating no finding as an error

#### Scenario: Selected Unit is not a Slide

- **WHEN** the authoritative Worktree Unit type is Sheet, Doc, Base or Board
- **THEN** the operation returns `workspace-unit-layout-lint-unit-type-unsupported` before creating a browser runtime

#### Scenario: Layout lint executes

- **WHEN** a valid layout-lint call runs
- **THEN** it requests no screenshot file approval, writes no local output and evaluates the current three beta.2 rules without a caller rule filter

### Requirement: Render input and canonical result budgets

Both tools MUST validate their complete canonical argument record within 65,536 UTF-8 bytes; screenshot MUST select at most 30 pages and preserve the frozen 16,777,216-pixel-per-image limit; layout lint MUST accept at most 10,000 page selectors; every canonical success MUST be lossless JSON within 8,388,608 UTF-8 bytes and depth 64.

#### Scenario: Argument or selector limit is exceeded

- **WHEN** a complete argument record, screenshot page selection or layout selector list exceeds its fixed limit
- **THEN** the operation returns `workspace-render-limit-exceeded` before authenticated allocation, worker or browser work and does not truncate the request

#### Scenario: Browser result exceeds an SDK limit

- **WHEN** screenshot selection, scale or rendered pixels exceed the frozen SDK page/pixel constraints
- **THEN** the operation preserves the applicable `PAGE_LIMIT_EXCEEDED` or `PIXEL_LIMIT_EXCEEDED` code with fixed safe limit detail and writes no later image

#### Scenario: Canonical result exceeds its budget

- **WHEN** complete screenshot metadata or lint findings exceed the byte or depth limit
- **THEN** the operation returns `workspace-render-limit-exceeded` without returning a truncated success or alternate partial value
- **AND** for screenshot, the shell has already constructed exact canonical locations from the approved directory and safe basenames and validated the complete closed bytes-free result before the first PNG publication, so it creates zero destination files

#### Scenario: Screenshot capture metadata is malformed

- **WHEN** captured screenshot metadata contains an unknown field, unsafe or duplicate basename, invalid dimension, location mismatch or other canonical-schema violation
- **THEN** the operation returns `workspace-screenshot-output-invalid` before the first PNG publication and creates zero destination files

### Requirement: Render failure fidelity and secrecy

The Client Shell MUST preserve only the complete inherited Change 5 file-transfer and Change 6 content allowlists enumerated in Design Decision 6, the existing shared-owner `workspace-operation-cancelled`/`workspace-plugin-disposing` classifications, and this Change's explicitly enumerated render additions; DSH registry-owned `ABORTED_BEFORE_DISPATCH`/`ABORTED` retain registry identity outside that adapter. The Client Shell MUST add no implicit category or prefix match and MUST map every unlisted or unsafe dependency failure to `workspace-render-operation-failed` with fixed operation text.

#### Scenario: Recognized render failure crosses the boundary

- **WHEN** target loading, Asset resolution, screenshot, layout lint or browser runtime raises an allowlisted code
- **THEN** the failure retains that code and only validated scope/Unit/type, numeric limit/count, canonical selected identity, confirmed output identity or fixed browser-availability guidance owned by that outcome

#### Scenario: Failure contains unsafe material

- **WHEN** an error message, stack, cause, browser checked path, environment, UnitData, content value, Asset byte, credential, license, rejected raw selector/path or unknown detail contains a sentinel
- **THEN** that material appears in no plugin-owned model-visible content or error detail

#### Scenario: Successful lint contains authorized text

- **WHEN** a valid lint finding intentionally contains Workspace-authored text evidence
- **THEN** the successful canonical report retains that text losslessly and does not treat it as an error secret

### Requirement: Cancellation, partial PNG output and Host lifecycle

Every render-verification tool MUST fuse caller and Host-owner cancellation, pass it through every supported target, worker, Asset, browser and file step, await uninterruptible work and cleanup, and MUST NOT retry or replay an operation after settlement.

#### Scenario: Caller cancels before body dispatch

- **WHEN** the original caller signal aborts before ToolRuntime invokes a body
- **THEN** DSH returns `ABORTED_BEFORE_DISPATCH` and no plugin body, credential, Workspace, worker, browser or file work runs

#### Scenario: Screenshot cancels before a PNG commits

- **WHEN** cancellation is observed before the first exclusive PNG publication
- **THEN** no destination is added, temporary state is cleaned, browser/worker work settles and no later image starts

#### Scenario: Screenshot cancels after a PNG commits

- **WHEN** one or more PNG links confirm and cancellation or a later output failure occurs before the complete set settles
- **THEN** the operation preserves `workspace-screenshot-output-partial` with exactly `{ totalOutputCount, committedOutputCount, committedOutputs: [{ name, location }], causeCode }`
- **AND** `causeCode` is only `ABORTED`, `workspace-screenshot-output-exists` or `workspace-screenshot-output-failed`, and no raw cause, message, errno, stack or unknown field crosses the boundary
- **AND** fixed guidance tells the caller to inspect the approved output directory and listed committed locations before deliberate retry
- **AND** it starts no next output, deletes no committed file and does not recapture, overwrite or replay

#### Scenario: Complete output races caller cancellation

- **WHEN** every PNG confirms but the original caller aborts before DSH finalization
- **THEN** DSH returns canonical `ABORTED` with fixed guidance that the directory may contain the complete set and must be inspected before deliberate retry

#### Scenario: Host disposes during render verification

- **WHEN** the owning fiber disposes with approval, target loading, worker export, Asset read, browser operation, PNG write, lint finalization or accepted body active
- **THEN** it rejects new work, unregisters the tools/listener, aborts owner-controlled work, closes browser and worker owners, awaits every accepted body and cleanup, and leaves no detached task or open resource

### Requirement: Installed render-verification closure

The prebuilt tarball MUST include its package-relative render page and every locally emitted static asset, MUST resolve the actual installed browser JavaScript packages relative to the real physical directory of exact SDK render-runtime `1.0.0-beta.2`, MUST write and verify their concrete exact package versions rather than the owner manifest ranges, and MUST retain the existing worker/native closure required to materialize render Units outside the monorepo checkout.

#### Scenario: Packed artifact is inspected

- **WHEN** package verification walks manifest dependencies, Host/worker imports, render-page HTML and local asset references
- **THEN** every target exists inside the artifact or as an exact declared runtime dependency
- **AND** packed `puppeteer-core` and `@puppeteer/browsers` manifest versions exactly equal the versions read from their owner-relative resolved package manifests
- **AND** no remote asset, sourcemap, browser cache/binary, bare private Core import, CLI source/artifact, absolute checkout path or Office/Typst/SVG/future resource is included

#### Scenario: Installed tools run from an unrelated cwd

- **WHEN** an isolated local profile installs the tarball and invokes both tools through real DSH ToolRuntime from a temporary cwd with no workspace source or `node_modules` fallback
- **THEN** screenshot produces exact PNG files/metadata and layout lint produces the complete report through the packaged worker, render page, static assets and explicitly resolved browser
- **AND** cancellation, partial output and normal disposal settle without a real account or model credential

#### Scenario: Installed browser is unavailable

- **WHEN** neither operator configuration, the SDK cache nor a supported system browser resolves
- **THEN** the tool returns sanitized `BROWSER_UNAVAILABLE` and does not attempt an implicit download

### Requirement: Browser deployment boundary

Because the frozen beta.2 runtime launches Chromium with `--no-sandbox`, the operator MUST run render-verification tools as a restricted OS user or in a restricted container with bounded filesystem and network access. The Client Shell MUST document that screenshot approval controls the local file effect and that layout lint's lack of approval does not provide browser/process isolation.

#### Scenario: Render tools are deployed

- **WHEN** an operator enables screenshot or layout lint in a Host
- **THEN** the Host runs under the documented restricted user/container boundary with only intended Session-cwd and Workspace/network access
- **AND** neither tool reports DSH approval, local provider checks or file policy as a Chromium sandbox
