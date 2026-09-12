## Purpose

定义 Host-only local `dsh-univer-work` 的 Office import/export tool surface，使 Agent 能在受控 Session cwd 中把支持的 Office 文件创建为 Worktree-local Unit，或把权威 Worktree Unit head 原子导出到本地文件，同时保持审批、预算、取消和未知结果语义。

## ADDED Requirements

### Requirement: Stable Office tool surface and format matrix

The Client Shell SHALL expose `workspace_office_import` and `workspace_office_export` as two operation-specific DSH tools and MUST expose only the Workspace CLI Office outcome matrix.

#### Scenario: Supported Office source is imported

- **WHEN** import receives a contained local `.xls` or `.xlsx`, `.doc` or `.docx`, or `.ppt`, `.pptx`, `.pptm`, `.ppsx`, `.ppsm`, or `.potx` source
- **THEN** it infers or validates Sheet/Base, Doc, or Slide using the existing Core rules and converter options

#### Scenario: Supported Worktree Unit is exported

- **WHEN** export receives an authoritative Sheet/Base, Doc, or Slide Worktree Unit and a compatible `.xlsx`, `.docx`, or `.pptx` output
- **THEN** it converts that selected Worktree head with the existing type and formula-calculation rules

#### Scenario: Unsupported exchange is requested

- **WHEN** either tool receives Board, CSV, PDF, ODF, an unsupported import suffix, a legacy export suffix, an incompatible explicit import type, or an incompatible output suffix
- **THEN** it fails with the applicable stable Office format/type error before Unit create or final local publication

#### Scenario: Caller requests import replacement or Trunk export

- **WHEN** a caller supplies an existing Unit/Resource target, replacement action, Trunk scope, revision, or other undeclared exchange selector
- **THEN** the closed tool boundary rejects the call without adding replacement or Trunk semantics

### Requirement: Office import creates one authoritative Worktree-local Unit

`workspace_office_import` MUST convert the approved local source and create one new Worktree-local Unit through Workspace Client Core, preserving format/name policy, target Space/parent, idempotency, strict result identity and every post-dispatch non-confirmed result.

#### Scenario: Office file is imported successfully

- **WHEN** approved import receives non-empty `source_path`, `worktree_id` and `space_id`, compatible optional `type`, and optional valid `name`, `parent_node_id` and `idempotency_key`
- **THEN** it returns the existing committed import fields only after Core confirms the created Worktree-local Unit, Node, Resource, type, name, Worktree and target

#### Scenario: Converted content chooses the name

- **WHEN** no explicit non-empty name is supplied
- **THEN** the Unit name follows converted name, converted title and `Imported <type>` precedence without inventing another DSH naming rule

#### Scenario: Conversion fails before Unit create

- **WHEN** the source is invalid or native conversion fails before the create request
- **THEN** no Workspace Unit create begins and the tool returns no partial success

#### Scenario: Unit create cannot be confirmed

- **WHEN** create may have reached Workspace but same-identity Core recovery cannot confirm the requested Worktree-local Unit
- **THEN** the tool preserves `workspace-result-unknown` with safe stable operation identity, starts no shell-level retry and does not rerun conversion

#### Scenario: Unit create response is mismatched or invalid after dispatch

- **WHEN** Workspace may have created the Unit but Core rejects the create response as `workspace-result-mismatch` or `workspace-invalid-response`
- **THEN** the tool preserves that non-confirmed safe code, gives fixed guidance to inspect the requested Worktree Unit/Space identity, does not claim confirmation or rollback, and never rereads, reconverts or recreates automatically

### Requirement: Office export reads one authoritative Worktree head

`workspace_office_export` MUST resolve the requested Worktree Unit and its selected revision through the current authenticated runtime owner, MUST export UnitData for that exact target, and MUST perform no Workspace content mutation or changeset commit.

#### Scenario: Selected Worktree head is exported

- **WHEN** approved export receives non-empty `worktree_id`, `unit_id` and compatible `output_path`
- **THEN** it returns the existing output path, Worktree, Unit and authoritative type fields only after runtime UnitData identity, conversion and atomic publication are confirmed

#### Scenario: Runtime returns another Unit

- **WHEN** runtime export returns a non-object value or UnitData whose ID differs from the authoritative target Unit
- **THEN** the tool fails with `workspace-exchange-unit-data-invalid` before native conversion or local output

#### Scenario: Worktree changes after target resolution

- **WHEN** a later Worktree head exists after export resolves its target but before Change 6 runtime confirms synchronization for that exact revision
- **THEN** the operation fails with `workspace-result-mismatch` before UnitData export, native conversion or local output and does not silently re-resolve the new head or claim to export the old one

#### Scenario: Selected Worktree revision is confirmed

- **WHEN** runtime synchronization confirms its base revision equals the once-selected target revision
- **THEN** export reads and converts only UnitData for that exact target

### Requirement: Local path and file-effect policy reuse

The Office tools MUST use the file-transfer capability's exact public local-filesystem proof, calling Session cwd containment and process-path conversion. Export MUST additionally apply the current DSH file-effect policy before approval and again in the accepted body. No non-local execution world may be treated as a Host path.

#### Scenario: Import source is local and contained

- **WHEN** an approved import runs under the exact public `LocalFileSystem` or its supported in-process local sandbox subclass with a regular source contained by Session cwd
- **THEN** Core consumes Change 5's signal-aware path-based source stream into bounded actual bytes and calls published `importBuffer` only after local identity and containment gates pass

#### Scenario: Import source is non-local or outside cwd

- **WHEN** the mounted filesystem is E2B/remote/unrelated, the Session has no cwd, or the canonical source escapes that cwd
- **THEN** import fails before `processPath()`, conversion, credential resolution or Unit create and does not buffer or copy the source into Host space

#### Scenario: Read-only Session requests export

- **WHEN** export pre-execute observes a confining Session policy of `read-only`
- **THEN** it fails with `workspace-file-policy-denied` before provider/argument/path inspection, approval, body, credential, runtime, converter or Host file I/O

#### Scenario: Workspace-write Session requests export

- **WHEN** export runs under `workspace-write`
- **THEN** preflight and accepted body each require the output's canonical identity inside both current policy root and Session cwd, with no retained policy/path state between them

#### Scenario: Provider, policy, or path changes during approval

- **WHEN** policy narrows, provider identity changes, or a path/symlink escapes before the approved body runs
- **THEN** the body rejects the operation before `processPath()`, credential, runtime, conversion or local output and asks no second approval

### Requirement: Closed arguments, budgets, outputs, and rendering

Both Office tools MUST expose closed operation-specific parameter and output schemas, MUST run the same exact pure argument validator before approval and in the body, and MUST enforce fixed plugin-owned size/depth budgets before the next side effect.

#### Scenario: Native or Code Mode catalog is assembled

- **WHEN** DSH assembles either tool surface
- **THEN** each parameter root has `additionalProperties: false`, exact snake_case fields and finite enums, and accepts no origin, credential, cookie, bytes, URL, command, arbitrary JSON, generic action, revision or unsupported format selector

#### Scenario: Invalid argument reaches pre-execute

- **WHEN** either tool receives an unknown key, wrong primitive, blank required value, incompatible known suffix/type or canonical arguments larger than 524,288 UTF-8 bytes
- **THEN** its pure validator fails before `ask`, body, path, credential, runtime, converter or side effect and copies no rejected value into plugin-owned content

#### Scenario: Import source or UnitData exceeds its budget

- **WHEN** actual source bytes reach 52,428,801 or converted UnitData exceeds 52,428,800 canonical JSON bytes or depth 64
- **THEN** import fails with `workspace-office-limit-exceeded` before native entry or Unit create respectively and returns no truncated success

#### Scenario: Import source stream changes length after preflight

- **WHEN** Change 5's path-based source stream grows beyond inspected size, truncates below it, or reaches 52,428,801 bytes after preflight
- **THEN** import enforces the existing inspected-size/actual-byte count and Office stop, closes the stream, and fails before `importBuffer`

#### Scenario: Same-length replacement races source opening

- **WHEN** another process replaces the inspected path or swaps its symlink to a different contained or uncontained regular file of the same byte length before Change 5 `openSource` opens the stream
- **THEN** import still bounds the actual stream before `importBuffer` but does not promise to detect the identity swap, inheriting Change 5's accepted absence of a cross-process `openat` or directory-handle fence

#### Scenario: Export UnitData or Office bytes exceed their budget

- **WHEN** runtime UnitData exceeds 52,428,800 canonical JSON bytes/depth 64 or the native output exceeds 52,428,800 bytes
- **THEN** export fails before native conversion or atomic publication respectively, removes private output state and returns no truncated success

#### Scenario: Canonical output is invalid

- **WHEN** a body returns missing, broadened, non-JSON or wrong-identity import/export fields
- **THEN** DSH rejects it before rendering or Code Mode receives it

#### Scenario: Successful value is rendered

- **WHEN** either tool succeeds
- **THEN** model-visible text is derived only from the validated canonical value and the complete lossless value remains available to Native and Code Mode

### Requirement: Office operations validate before one approval

The Client Shell MUST request one DSH `ask` approval for every valid Office import or export, MUST validate pure arguments first, and MUST delegate unrelated tools to the existing policy chain. Export MUST complete its current policy/local/path preflight before asking.

#### Scenario: Valid import requests approval

- **WHEN** import arguments pass the pure operation validator
- **THEN** the listener asks once with fixed Office-import text before any path inspection, credential, conversion or Unit create

#### Scenario: Valid export requests approval

- **WHEN** export passes current write policy, public local constructor, pure argument and canonical output-path preflight
- **THEN** the listener asks once with fixed Office-export text before `processPath()`, credential, runtime, conversion or Host output

#### Scenario: Approval fails closed

- **WHEN** approval is denied, cancelled, unavailable or has no channel
- **THEN** no accepted body, converter, remote Unit create or local publication begins

#### Scenario: Caller arguments were already recorded

- **WHEN** hostile arguments contain a sentinel
- **THEN** the plugin does not promise to remove Native `tool/call.arguments`, Code Mode `tool/code-dispatch-start.arguments` or settled `tool/code-dispatch.arguments`
- **AND** approval interactions/events, result/failure content and metadata, plugin-owned contexts and logs do not copy the sentinel

### Requirement: Atomic Office export publication

Office export MUST convert to a bounded in-memory result and publish through the existing private, exact-byte, synchronized, same-directory atomic output workflow. It MUST protect existing output by default and replace only when approved input contains `force: true`.

#### Scenario: Output does not exist

- **WHEN** conversion succeeds within budget and the destination remains absent
- **THEN** the complete bytes are written to a private `0600` temporary file, synchronized and atomically published before success

#### Scenario: Existing or racing destination is protected

- **WHEN** output exists or appears before publication and `force` is omitted or false
- **THEN** export fails with `workspace-office-output-exists`, preserves the existing destination and removes private temporary output

#### Scenario: Force replacement is explicit

- **WHEN** approved export contains `force: true`
- **THEN** the destination is atomically replaced only after complete conversion, byte budget, write, sync and cancellation checks pass

#### Scenario: Conversion or output fails

- **WHEN** native conversion, local writing, sync, size validation or publication fails
- **THEN** non-cancellable cleanup closes and removes private output, a previous destination stays unchanged, and the tool never retries conversion automatically

### Requirement: Office failure fidelity and secrecy

The Client Shell MUST preserve only the frozen shared and Office-specific safe code/detail allowlists. It MUST reduce recognized native converter failures to a fixed Office conversion error and map every unlisted or unsafe failure to `workspace-office-operation-failed` without original material.

#### Scenario: Recognized Office failure crosses the boundary

- **WHEN** Core raises an allowlisted format, type, UnitData, mismatch, result-unknown, file-policy/path, runtime, output, limit, authentication, HTTP, Worktree/Unit or current Server error
- **THEN** the result keeps that stable code, fixed operation text and only exact safe identity/state/count/path detail

#### Scenario: Recognized native converter error crosses the boundary

- **WHEN** exchange-node raises a known `ExchangeErrorCode`
- **THEN** the tool returns `workspace-office-conversion-failed` with only `phase` and the allowlisted converter code, and omits its original message, cause, stack and bytes

#### Scenario: Failure contains unsafe material

- **WHEN** a resolver, runtime, converter, filesystem, response, error message/cause/detail or native loader contains credential, cookie, license, UnitData, Office bytes, temporary path, rejected argument or dependency path material
- **THEN** no result, render, approval, plugin event or log emits it and unknown material becomes fixed `workspace-office-operation-failed`

### Requirement: Office cancellation, side effects, and lifecycle

Every Office body MUST fuse caller and Host-owner cancellation, pass it through every supported file/Core/runtime step, await uninterruptible native conversion, stop later work after cancellation, and remain tracked through cleanup. Host disposal MUST unregister and drain both tools before returning.

#### Scenario: Caller cancels before body dispatch

- **WHEN** caller cancellation wins before ToolRuntime starts a body
- **THEN** DSH returns `ABORTED_BEFORE_DISPATCH` and no body, path, credential, runtime, converter or side effect runs

#### Scenario: Cancellation occurs during native import conversion

- **WHEN** caller or owner cancellation occurs after native conversion begins but before Unit create
- **THEN** the Host awaits conversion, starts no Unit create, returns no partial success and classifies cancellation by caller versus owner

#### Scenario: Cancellation occurs during bounded source reading

- **WHEN** caller or owner cancellation occurs while Core collects actual source bytes
- **THEN** the stream stops and closes, no `importBuffer` or Unit create starts, and no source bytes enter tool content or logs

#### Scenario: Import create remains uncertain

- **WHEN** Unit create may have dispatched and Core returns `workspace-result-unknown`
- **THEN** that tool-owned failure survives caller/owner cancellation, no conversion/create is replayed, and fixed guidance requires Worktree Unit/Space inspection

#### Scenario: Import create returns another non-confirmed result after dispatch

- **WHEN** create dispatch is followed by `workspace-result-mismatch` or `workspace-invalid-response`
- **THEN** that tool-owned failure survives cancellation, fixed guidance requires Worktree Unit/Space inspection, and the shell does not reread the file, reconvert it or issue another create

#### Scenario: Export is cancelled before publication

- **WHEN** cancellation occurs during target/runtime read, conversion or private output writing before atomic publication
- **THEN** no later step starts, private output is removed and a prior destination remains unchanged

#### Scenario: Caller cancellation races confirmed side effect

- **WHEN** Core confirms Unit create or atomic publication and the body returns success after/concurrently with original caller cancellation
- **THEN** DSH rc.2 returns canonical `ABORTED` and fixed final guidance requires Worktree Unit or destination inspection before any deliberate retry

#### Scenario: Owner-only disposal races confirmed side effect

- **WHEN** only the Host owner signal aborts after Core confirms create or publication
- **THEN** the accepted body may return success while disposal drains it, while an unconfirmed create retains its original `workspace-result-unknown`, `workspace-result-mismatch` or `workspace-invalid-response` and inspection guidance

#### Scenario: Host disposes Office capability

- **WHEN** disposal begins during approval, path work, runtime export, native conversion, Unit create, local write or cleanup
- **THEN** it unregisters both tools and policy branches, rejects new bodies, aborts supported work, awaits conversion/body/runtime/file cleanup and leaves no request, worker operation, temporary output, listener, timer, Job or retry alive

### Requirement: Installed package preserves real Office exchange

The prebuilt tarball MUST inline reachable private Core and converter JavaScript, reuse the packaged content worker/runtime child, and deliver the exact platform-native exchange binding declared by the installed exchange-node owner without a source checkout.

#### Scenario: Packed artifact is inspected

- **WHEN** package verification inspects emitted code, manifests and files
- **THEN** every worker/native reference resolves in the tarball, exact published DSH/Cordis/native dependencies remain external, and no bare private Core, `workspace:*`, CLI source/daemon/Session, adjacent checkout fallback, remote FS, Web Client or later capability is present

#### Scenario: Installed Office smoke runs

- **WHEN** an isolated local profile invokes both tools through real DSH ToolRuntime from an unrelated temporary cwd
- **THEN** a real native XLSX round trip and strict Doc/Slide wiring fixtures preserve bounded actual-source behavior, approval, budgets, exact-revision mismatch, Worktree identity, every post-dispatch unconfirmed create class, atomic/no-clobber/force, cancellation and normal disposal
- **AND** no model key, real Workspace account or adjacent checkout is required
