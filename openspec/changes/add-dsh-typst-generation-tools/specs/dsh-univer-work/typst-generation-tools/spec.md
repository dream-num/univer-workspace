## Purpose

定义 Host-only local `dsh-univer-work` 的 Typst compile/apply surface，使 Agent 能从调用 Session cwd 中受支持的 Typst Source Bundle 生成边界清晰的本地 artifacts，并可把同一次编译结果创建为一个 Worktree-local Doc，同时保持文件审批、预算、取消、错误保密和安装态 native runtime 合同。

## ADDED Requirements

### Requirement: Stable Typst compile tool

The Client Shell SHALL expose `workspace_typst_compile` as a schema-validated DSH tool that compiles one supported local Typst Source Bundle once, publishes one no-clobber reviewable artifact directory, and performs no Workspace mutation.

#### Scenario: Bundle compiles successfully

- **WHEN** an approved call supplies a non-empty `bundle_path`, a non-empty absent `artifact_directory`, and optional `render_previews: true`
- **THEN** the tool returns `committed: false`, compiler target Unit ID, title, complete validated diagnostics, preview metadata and the published Session-relative artifact directory
- **AND** the directory contains exact `program.js`, schema-version `1` `diagnostics.json`, and only when requested a `previews` directory containing the generated PNG files

#### Scenario: Compile result contains error diagnostics

- **WHEN** compilation completes with error-severity diagnostics rather than throwing
- **THEN** compile-only still publishes and returns the complete bounded compiler artifacts with `committed: false` and performs no materialization, credential resolution or Workspace request

#### Scenario: Artifact destination already exists

- **WHEN** the requested artifact directory exists during preflight or publication
- **THEN** the tool fails with `workspace-output-exists`, does not overwrite, merge, delete or rename that directory, and never enters the compiler after a preflight rejection

### Requirement: Stable Typst apply tool

The Client Shell SHALL expose `workspace_typst_apply` as a separate schema-validated DSH tool that compiles once and, only when diagnostics permit, creates one Doc Worktree-local Unit through Workspace Client Core.

#### Scenario: Compiled Doc is applied

- **WHEN** an approved call supplies non-empty `bundle_path`, `worktree_id` and `space_id`, optional non-empty `parent_node_id` and `idempotency_key`, and compilation has no error diagnostics
- **THEN** the tool materializes that same compiled program once, creates one Doc Worktree-local Unit, and returns `committed: true`, compiler target identity, title, complete diagnostics, previews and the validated Server Unit

#### Scenario: Apply also requests artifacts

- **WHEN** apply supplies an absent `artifact_directory` and optional `render_previews: true`
- **THEN** the tool publishes the same fixed artifact layout from the one compile result and includes the Session-relative directory in its canonical result

#### Scenario: Apply omits artifacts

- **WHEN** apply omits `artifact_directory` and `render_previews`
- **THEN** it creates the staged Doc without publishing generated JavaScript, diagnostics or previews to the local filesystem

#### Scenario: Preview is requested without artifact output

- **WHEN** apply sets `render_previews: true` but omits `artifact_directory`
- **THEN** pure argument validation fails before approval, path resolution, compiler, credentials or Workspace requests

#### Scenario: Error diagnostics block apply

- **WHEN** the compiler returns one or more error-severity diagnostics for apply
- **THEN** the tool fails with `workspace-typst-diagnostics`, preserves the bounded structured error diagnostics, and starts no materialization or Unit create
- **AND** it removes any private preview/output directory, publishes no artifact directory, and tells callers that need local failure artifacts to run `workspace_typst_compile` first

### Requirement: Closed Typst parameter and output contracts

Both Typst tools MUST declare only their operation fields, MUST reject unknown, wrong-type, blank or inconsistent input before side effects, and MUST validate their complete canonical JSON values before rendering or returning them to Native or Code Mode.

#### Scenario: Tool catalog is assembled

- **WHEN** DSH assembles Native schemas or the Code Mode SDK
- **THEN** it exposes exactly `workspace_typst_compile` and `workspace_typst_apply` with root `additionalProperties: false`, exact snake_case fields and closed canonical outputs
- **AND** neither tool accepts cookie, password, token, license, origin, inline source, generated JavaScript, arbitrary Facade code, caller-selected artifact filenames, command, environment, worker, browser, font path, remote filesystem or generic options

#### Scenario: Direct execution supplies an unknown key

- **WHEN** either tool receives an own parameter key outside its declaration
- **THEN** its exact-key gate returns fixed `workspace-argument-invalid` before local-world, path, approval, credential, compiler or Workspace work
- **AND** plugin-owned failure, approval and event content does not copy the rejected key or value, without altering DSH-owned Native or Code Mode argument records

#### Scenario: Apply result has the wrong Unit

- **WHEN** a body returns a missing, broadened, non-JSON, non-Doc, non-Worktree-local or wrong-Worktree/target Unit result
- **THEN** DSH rejects it as invalid output before rendering or Code Mode receives it

#### Scenario: Valid result is rendered

- **WHEN** a Typst tool succeeds
- **THEN** model-visible text summarizes only committed state, compiler target, diagnostics counts, artifact path and Server Unit identity
- **AND** the complete bounded canonical diagnostics and metadata remain available without parsing prose, while generated JavaScript and PNG bytes never enter the canonical value or render

### Requirement: Typst argument and result budgets

The Client Shell MUST reject a canonical argument record larger than 524,288 UTF-8 bytes before approval and MUST enforce fixed compiler, UnitData, preview-count, artifact and canonical-result limits without returning truncated success.

#### Scenario: Arguments exceed their budget

- **WHEN** the complete canonical input reaches 524,289 UTF-8 bytes
- **THEN** the tool fails with `workspace-typst-limit-exceeded` before approval, local path work, compiler, credential or Workspace access

#### Scenario: Generated or materialized content exceeds its budget

- **WHEN** generated JavaScript or materialized UnitData independently exceeds 52,428,800 bytes, or UnitData exceeds JSON depth 64
- **THEN** the operation fails with `workspace-typst-limit-exceeded` before materialization or Unit create at the applicable boundary and returns no truncated value

#### Scenario: Apply compiler projection cannot fit the canonical result

- **WHEN** canonical target identity, title, diagnostics and preview metadata exceeds 7,864,320 bytes or depth 64
- **THEN** apply fails before materialization or Unit create, publishes no artifact and returns no truncated diagnostics or previews
- **AND** the remaining 524,288 bytes are reserved for the closed validated Unit and result envelope so every schema-valid complete result fits the 8,388,608-byte bound

#### Scenario: Preview artifacts exceed their budget

- **WHEN** native compilation yields more than 256 previews or all program, diagnostics and preview files exceed 52,428,800 actual bytes
- **THEN** the tool publishes no ordinary success, removes private output state, and does not truncate or silently omit a requested artifact

#### Scenario: Canonical result exceeds its budget

- **WHEN** the complete success value exceeds 8,388,608 canonical JSON bytes or depth 64
- **THEN** compile fails before local publication, while apply has already rejected its predictable compiler fragment before Unit create and accepts only a closed Unit/envelope within the reserved 524,288 bytes
- **AND** a Server Unit that violates that closed reserved envelope is an invalid post-create response with confirmed-side-effect guidance, not a predictable canonical-result overflow

### Requirement: Local Typst path and artifact boundary

Both tools MUST reuse the current DSH file-effect policy, public `LocalFileSystem` identity and calling Session cwd from Change 5, MUST keep all model-selected paths within that cwd, and MUST publish each artifact set by atomically reserving its destination directory before publishing known files no-clobber from private sibling state.

#### Scenario: Execution world is not local

- **WHEN** the current filesystem cannot be positively identified as the supported in-process `LocalFileSystem` execution world before any model path is resolved
- **THEN** the tool fails with `workspace-local-filesystem-required` with zero path, approval, credential, compiler or Host filesystem work

#### Scenario: Session cwd or path containment is invalid

- **WHEN** the caller Session has no cwd, the bundle/artifact path escapes it, or bundle root and artifact directory overlap
- **THEN** the tool fails with the existing stable file/path code before approval or compilation and does not reveal Host launch paths or provider identity

#### Scenario: Preflight does not derive Host paths

- **WHEN** a valid model request reaches the pre-execute local policy branch
- **THEN** the branch validates only normalized Session-relative model paths and current policy, does not explicitly call `processPath` or derive a Host path, and asks with fixed text containing no caller path
- **AND** only the accepted body revalidates provider, Session cwd, policy and containment before converting the normalized paths to Host-local paths

#### Scenario: Bundle path is accepted

- **WHEN** the local gate resolves a contained directory with `typst.json` or a contained `typst.json` path
- **THEN** the tool passes only its canonical Host-local path to Core after approval, while the frozen compiler remains authoritative for manifest and bundle-internal page/prelude/asset path validation

#### Scenario: Artifact directory is published

- **WHEN** compilation and all requested writes, byte checks, file sync and cancellation checks succeed
- **THEN** the body atomically creates the still-absent destination with mode `0700`, creates only the requested known child directories, publishes every known file no-clobber and syncs the completed files and directories
- **AND** another observer MAY briefly see the reserved destination before all known files are present
- **AND** no temporary basename or absolute Host path enters output, render, error detail, approval or plugin event content

#### Scenario: Caller supplies a contained absolute artifact path

- **WHEN** the caller supplies an absolute artifact destination that canonically remains inside the Session cwd
- **THEN** every canonical artifact-directory, program, diagnostics and preview path is derived from the normalized Session-relative target
- **AND** the caller's absolute path does not enter output, render, error detail, approval or plugin event content

#### Scenario: Artifact publication fails

- **WHEN** compiler, write, sync, size check, cancellation, destination reservation or per-file publication fails before complete publication
- **THEN** before public destination creation, non-cancellable cleanup removes a recorded private file only while its current identity matches and attempts non-recursive `rmdir` only for known private directories, while an existing destination remains unchanged
- **AND** after public destination creation, the tool removes no public path, preserves the partial directory and returns a bounded structured failure containing only its Session-relative path plus inspect/no-replay guidance
- **AND** cleanup never recursively removes a directory and the tool never retries compilation or publication automatically

#### Scenario: First-version same-UID boundary

- **WHEN** another process running as the same OS UID actively replaces, rewrites or races plugin-private staging or published artifact paths
- **THEN** the tool makes no hostile same-UID isolation guarantee beyond randomized mode-`0700` staging, no-clobber publication and ordinary identity checks
- **AND** the tool never reports complete publication after a detected identity, size or layout mismatch

### Requirement: Typst operations require one approval

The Client Shell MUST validate operation arguments and current local path policy before requesting one DSH `ask` approval for either Typst tool, MUST use fixed operation-specific wording, and MUST repeat current policy/provider/path validation in the accepted body.

#### Scenario: Compile asks once

- **WHEN** a valid compile request passes current local read/write policy and path preflight
- **THEN** DSH asks once with fixed Typst compile/artifact wording that contains no caller-supplied path or value

#### Scenario: Apply asks once

- **WHEN** a valid apply request passes current local read policy and any requested output preflight
- **THEN** DSH asks once with fixed staged-Doc wording and the accepted body performs both local compilation and the one authorized Workspace create without a second prompt

#### Scenario: Approval fails closed

- **WHEN** approval is rejected, cancelled, unavailable or has no channel
- **THEN** the tool fails before compiler, credential, license, materializer, Unit create or artifact publication

#### Scenario: Policy changes after approval

- **WHEN** local filesystem identity, Session cwd, file-effect policy or path containment differs when the accepted body rechecks it
- **THEN** the body fails closed and does not use cached preflight state, resolve an explicit Host path or start Core work

### Requirement: Typst diagnostic and failure secrecy

The Client Shell MUST preserve only frozen shared file/Workspace codes and fixed Typst categories with bounded schema-valid diagnostics, and MUST map unknown dependency failures or unsafe material to `workspace-typst-operation-failed` without original messages, causes, stacks or paths.

#### Scenario: Supported bundle or translation failure crosses the boundary

- **WHEN** the frozen compiler reports manifest/path/translation/preview/printer failure
- **THEN** the tool maps it to `workspace-typst-bundle-invalid`, `workspace-typst-compile-failed` or `workspace-typst-preview-failed` with fixed operation text
- **AND** it retains only bounded diagnostics whose source path is relative and contained, whose fields match the frozen diagnostic schema and whose unknown fields are discarded
- **AND** apply removes private compiler output and publishes no failure artifact; callers that require files use the compile tool as a separate approved operation

#### Scenario: Materialization contract fails

- **WHEN** Core raises `workspace-typst-runtime-contract`, `workspace-typst-diagnostics` or `workspace-typst-limit-exceeded`
- **THEN** the tool preserves that code with fixed guidance and only bounded diagnostic, limit kind/count, compiler target or safe Worktree/Unit identity detail

#### Scenario: Unit create outcome is not confirmed

- **WHEN** Core raises an allowlisted Unit create mismatch, invalid-response or result-unknown failure
- **THEN** the tool preserves its code and exact safe idempotency/Worktree/Space/parent/type/name identity with instructions to inspect `workspace_unit_list`, and never recompiles or automatically replays apply

#### Scenario: Failure material is unsafe

- **WHEN** a filesystem, native loader, compiler, materializer, license, credential, HTTP, Server or cleanup error contains absolute path, temporary path, source text, generated JavaScript, UnitData, PNG bytes, cookie, license, rejected argument, dependency path, raw native message, stack or cause
- **THEN** none of that material enters result, render, approval, plugin event or log content and unknown material becomes fixed `workspace-typst-operation-failed`

### Requirement: Typst cancellation, side effects, and lifecycle

Every Typst body MUST fuse caller and Host-owner cancellation, pass it through every supported path/Core/Unit step, await uninterruptible native compilation and generated-program execution, stop later work after cancellation, and remain tracked through runtime and private-file cleanup. Host disposal MUST unregister and drain both tools before returning.

#### Scenario: Caller cancels before body dispatch

- **WHEN** caller cancellation wins before ToolRuntime starts a body
- **THEN** DSH returns `ABORTED_BEFORE_DISPATCH` and no approval, path, compiler, credential, runtime or side effect runs

#### Scenario: Cancellation occurs during native compile

- **WHEN** caller or owner cancellation occurs after the frozen native compiler begins
- **THEN** the Host awaits it, removes private artifacts, starts no materialization or Unit create, and reports caller cancellation or plugin disposal without claiming native hard cancellation

#### Scenario: Cancellation occurs during materialization

- **WHEN** caller or owner cancellation occurs after generated program execution begins but before Unit create
- **THEN** Core awaits execution, discards its per-invocation deterministic context, disposes the headless runtime, starts no Unit create and returns no ordinary success

#### Scenario: Unit create is unconfirmed

- **WHEN** cancellation races a dispatched Unit create whose result is not confirmed
- **THEN** the tool preserves `workspace-result-unknown`, starts no shell-level retry, and instructs the caller to inspect the exact Worktree Units before deciding any next action

#### Scenario: Confirmed Unit precedes artifact failure or cancellation

- **WHEN** apply confirms its Unit but requested artifact validation/publication then fails or observes cancellation
- **THEN** the tool returns `workspace-typst-partial-side-effect` with only the confirmed Unit identity, artifact publication state and inspect/no-replay guidance
- **AND** it cleans private local state, preserves any pre-existing destination, and does not delete the Unit or rerun compile/apply

#### Scenario: Caller cancels after complete success

- **WHEN** Core and any artifact publication confirm but the original caller signal aborts before DSH finalization
- **THEN** DSH rc.2 returns canonical `ABORTED` instead of the late success
- **AND** the total finalizer retains that identity and advises inspecting the artifact directory and Worktree Unit list before any deliberate retry

#### Scenario: Owner-only disposal races complete success

- **WHEN** only the Host-owner signal aborts after Core and any artifact publication confirm
- **THEN** the accepted body may return success while disposal drains it, while any unconfirmed create or partial publication retains its structured failure

#### Scenario: Host disposes Typst capability

- **WHEN** disposal begins during approval, path work, compile, materialization queue/execution, Unit create, artifact write/publication or cleanup
- **THEN** the existing owner unregisters both tools and their policy branches, rejects new bodies, aborts supported work, awaits native/program/body/file cleanup and leaves no runtime, VM context, request, temporary directory, listener, timer, Job, retry or Typst-specific worker alive

### Requirement: Installed package preserves real Typst behavior

The prebuilt `dsh-univer-work` tarball MUST inline reachable private Core, Typst facade and headless JavaScript, MUST deliver the exact platform-native Typst binding declared by the installed facade owner, and MUST reproduce compile/apply behavior without a Workspace checkout or system Typst installation.

#### Scenario: Packed artifact is inspected

- **WHEN** package verification inspects emitted code, manifest and files
- **THEN** the exact installed `@univer-cli/doc-typst-facade` owner selects a concrete `@univerjs-pro/doc-typst-native-binding` version and its platform optional packages, every runtime reference resolves, and exact published DSH/Cordis/native packages remain external
- **AND** no bare private Core import, `workspace:*`, CLI source/daemon/Session, adjacent checkout fallback, system Typst command or Web Client enters the Typst reachable graph
- **AND** Typst adds or uses no SVG capability, browser entry/resource, separate font directory or second Typst worker entry, while package verification preserves and separately validates the existing Render closure

#### Scenario: Installed Typst smoke runs

- **WHEN** the tarball is installed in an isolated local DSH profile and real ToolRuntime invokes both tools from an unrelated temporary Session cwd
- **THEN** a real minimal bundle verifies native compile, structured diagnostics, semantic-deterministic licensed materialization with preserved SDK-owned opaque identities, staged Doc identity, optional previews, fixed artifact layout, no-clobber, budgets, approval, caller/owner cancellation, result-unknown/partial-side-effect handling and bounded disposal
- **AND** the Typst path does not use the Change 6 content worker, while no model key, real Workspace account, system Typst binary or monorepo source fallback is required
