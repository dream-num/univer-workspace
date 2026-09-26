## Purpose

定义 Host-only `dsh-univer-work` Client Shell 的 Blob/Asset 本地文件传输工具，使 Agent 能在调用 Session 的 cwd 内上传与下载字节，同时保留 Workspace Client Core 的身份校验、幂等恢复、原子写入、错误和未知结果语义。

## ADDED Requirements

### Requirement: Stable Blob and Asset tools

The Client Shell SHALL expose `workspace_blob_get`, `workspace_blob_upload`, `workspace_blob_download`, and `workspace_asset_download` as separate schema-validated DSH tools with closed canonical output schemas and rendering derived only from validated canonical values.

#### Scenario: Blob metadata is retrieved

- **WHEN** `workspace_blob_get` receives a non-empty `resource_id` for an accessible Blob Resource
- **THEN** it returns `{ node, resource }` only after Client Core confirms the Resource identity, Blob kind, owning Node representation, availability, capabilities, media type, and byte size

#### Scenario: Local file is uploaded as a Blob Resource

- **WHEN** approved `workspace_blob_upload` receives a local `source_path`, non-empty `space_id`, and valid optional parent, name, media type, and idempotency identity
- **THEN** it returns `{ upload }` containing the stable idempotency, Upload Session, Operation, Node, Resource, name, media type, and byte-size result confirmed by Client Core

#### Scenario: Blob Resource is downloaded

- **WHEN** approved `workspace_blob_download` receives a valid `resource_id` and local `output_path`
- **THEN** it returns `{ download }` containing the confirmed Resource, Node, canonical output path, exact byte size, media type, and optional ETag after an atomic local commit

#### Scenario: Worktree Asset is downloaded

- **WHEN** approved `workspace_asset_download` receives non-empty `worktree_id` and `asset_id` plus a local `output_path`
- **THEN** it returns `{ download }` containing the Worktree, Asset, canonical output path, exact byte length, media type, and optional ETag after signed-content validation and atomic local commit

### Requirement: Session-cwd local filesystem boundary

Every file-bearing body MUST positively prove the mounted DSH filesystem is the exact public `LocalFileSystem` or its in-process subclass before resolving any model path, MUST then resolve the requested path relative to the calling Agent Session cwd and confirm canonical containment, and MUST call `processPath()` only after the same body-side local identity and path gates succeed.

#### Scenario: Relative path stays in the Session workspace

- **WHEN** a file-bearing tool receives a relative source or destination path from an Agent whose Session has a valid cwd
- **THEN** it first proves the mounted public local constructor identity, resolves the Session cwd and target through DSH filesystem identity, verifies canonical containment, and passes only the provider's canonical Host process path to Client Core

#### Scenario: Absolute path or symlink escapes the Session workspace

- **WHEN** an absolute path, parent traversal, or resolved symlink identifies a target outside the calling Session cwd
- **THEN** the tool fails with `workspace-file-path-outside-session` before authenticated resolution, source reading, remote request, temporary-file creation, or destination mutation

#### Scenario: Call has no Agent Session cwd

- **WHEN** a file-bearing tool is invoked without an Agent or without a Session cwd
- **THEN** it fails with `workspace-session-cwd-required` and does not fall back to the Host launch directory

#### Scenario: Filesystem belongs to another execution world

- **WHEN** the mounted filesystem is E2B or another remote sandbox/filesystem and cannot prove that its process path is directly openable by the Host process
- **THEN** the tool fails with `workspace-local-filesystem-required` before resolving or interpreting any model path, asking download approval, calling `contains()`/`processPath()`, reading credentials, starting Core, or performing Host I/O
- **AND** it does not buffer, copy, encode, attach, or silently write bytes in another execution world

#### Scenario: Blob source is not a regular file

- **WHEN** the resolved local Blob source is absent or is not a regular file
- **THEN** the upload fails before authenticated resolution or a Workspace request, with no partial upload result

### Requirement: Download file-effect policy

Before asking for a Blob or Asset download, the Client Shell MUST first resolve the calling Session's current DSH file-effect policy when the mounted filesystem declares a confining mode and fail closed under `read-only`; it MUST then positively prove the exact public `LocalFileSystem` constructor identity before any remote/model-path resolution or interpretation. Only a constructor-proven filesystem with undefined `sandboxMode` may be treated as bare local. The approved body MUST repeat current-policy, constructor-identity and canonical-path checks from immutable arguments before any credential, HTTP, `processPath()`, or Host `node:fs` work, without retaining policy/path state across approval.

#### Scenario: Confining filesystem has no policy service

- **WHEN** the mounted filesystem declares a confining `sandboxMode` but the DSH sandbox-policy service is absent
- **THEN** plugin composition fails without registering a download surface that could bypass the missing policy

#### Scenario: Read-only Session requests a download

- **WHEN** a Blob or Asset download pre-execute runs under a current `read-only` policy
- **THEN** the pre-execute policy fails closed before provider identity inspection, transfer approval, argument-path resolution, authenticated resolution, filesystem I/O, temporary-file creation, or HTTP
- **AND** no approval prompt or tool body runs
- **AND** it throws the shared secret-safe typed Harness error so rc.2 failure metadata preserves `workspace-file-policy-denied`, without copying arguments, policy roots, provider data, or causes

#### Scenario: Workspace-write Session requests a download

- **WHEN** a Blob or Asset download pre-execute runs under a current `workspace-write` policy
- **THEN** it first proves the public local constructor, resolves the output against the calling Session cwd, and accepts it for approval only when its canonical identity is contained by both the current policy `workspaceRoot` and the Session cwd
- **AND** the approved body resolves current policy, proves local constructor identity, and resolves canonical containment again from the same immutable arguments immediately before converting the target to a Host process path

#### Scenario: Danger-full-access Session requests a download

- **WHEN** a Blob or Asset download pre-execute or approved body runs under a current `danger-full-access` policy
- **THEN** the policy adds no broader root, but the output must still remain canonically contained by the calling Session cwd before approval and before Host I/O

#### Scenario: Bare local filesystem has no confining mode

- **WHEN** a filesystem reports no `sandboxMode`
- **THEN** the Client Shell treats it as bare local only after `ctx.fs instanceof LocalFileSystem` succeeds, does not require or invent a sandbox policy, and still applies the Session-cwd boundary and one transfer approval before download

#### Scenario: Undefined-mode filesystem is not local

- **WHEN** E2B or another non-local filesystem reports no `sandboxMode`
- **THEN** pre-execute fails with fixed `workspace-local-filesystem-required` before argument/path resolution or interpretation, approval, `contains()`/`processPath()`, credential, Core, or Host I/O
- **AND** the typed failure exposes no provider data and the tool body does not run

#### Scenario: Policy narrows while approval is pending

- **WHEN** an eligible download receives approval and the Session policy changes to `read-only` before its body check
- **THEN** the body fails with `workspace-file-policy-denied` before credential, HTTP, `processPath()`, temporary output, or Host I/O
- **AND** it does not ask again or retain a policy/path record for cleanup

#### Scenario: Policy, provider, or canonical path changes while approval is pending

- **WHEN** an eligible download's policy widens, its mounted provider changes, or its path/symlink identity changes before the approved body check
- **THEN** the body re-resolves current policy and the same immutable arguments, repeats the public local constructor gate, always reapplies Session-cwd containment, and rejects a non-local provider or canonical identity that escapes any currently applicable root
- **AND** no wider argument, second approval, cached policy/path, credential, or Host I/O bypasses that recheck

### Requirement: Closed parameter, output, and rendering contracts

Every file-transfer tool MUST accept only its operation-specific snake_case fields, MUST reject unsupported input, and MUST validate the complete canonical value before rendering or returning it to Native or Code Mode.

#### Scenario: Tool catalog is assembled

- **WHEN** DSH assembles Native schemas or the Code Mode SDK
- **THEN** it exposes exactly the four operation-specific names with `additionalProperties: false`
- **AND** no tool accepts a generic action, origin, cookie, password, credential record, inline bytes, base64, attachment, URL, command, remote filesystem selector, Office/content/render argument, or arbitrary JSON value

#### Scenario: Direct execution supplies an unknown key

- **WHEN** any file-transfer tool body receives an own argument key outside that tool's declaration, including `cookie`, `origin`, `bytes`, `url`, or `action`
- **THEN** its execution wrapper fails before path resolution, authenticated resolution, filesystem I/O, or HTTP
- **AND** failure content does not echo the rejected key or value

#### Scenario: Optional input is invalid

- **WHEN** upload receives a blank identity, invalid Blob name/media type, or blank idempotency key, or a download receives a non-boolean `force`
- **THEN** the tool fails with stable invalid-argument information before path or remote side effects

#### Scenario: Canonical output violates its declaration

- **WHEN** a tool body returns missing, broadened, non-JSON, or wrong-identity Node, Resource, Operation, Upload Session, download, or Asset fields
- **THEN** DSH rejects the output before `output.render` or Code Mode receives it

### Requirement: Consequential transfer operations require approval

The Client Shell MUST install one fiber-owned `tools/pre-execute` policy that returns DSH `ask` for Blob upload and for Blob/Asset downloads that have passed a stateless current-policy/local-constructor/path-identity preflight, throws a secret-safe typed Harness error for an ineligible download without asking, and delegates Blob metadata retrieval and unrelated tools to the existing policy chain. Download preflight MUST NOT resolve a non-local model path, stat/open/read/create the destination, call `processPath()`, resolve credentials, or start HTTP/Core work.

#### Scenario: Transfer receives one-time approval

- **WHEN** DSH obtains `allowed-once` for one upload or download call
- **THEN** only that accepted tool body may read a credential, open a source, send HTTP, create a temporary output, or perform the remote/local write
- **AND** a download body independently resolves current policy, local constructor identity and path from immutable arguments without asking again or consuming cross-approval state

#### Scenario: Approval is rejected or unavailable

- **WHEN** approval is rejected, cancelled, unavailable, or has no channel
- **THEN** DSH fails closed after any eligible download policy/path preflight but before the tool body reads a credential, opens a source, sends a request, creates a temporary output, or changes a destination

#### Scenario: Blob metadata is read

- **WHEN** `workspace_blob_get` runs
- **THEN** the transfer approval policy delegates without asking because the operation changes neither remote nor local state

### Requirement: File overwrite and transfer reliability

The Client Shell MUST preserve Client Core's stable Blob intent, bounded state recovery, exact-byte validation, signed Asset credential isolation, and private atomic download behavior, and MUST NOT add a retry after a settled failure.

#### Scenario: Existing destination is protected

- **WHEN** a Blob or Asset download targets an existing file without `force: true`, including a target created during the transfer
- **THEN** it fails with the corresponding output-exists code, preserves the existing file, and removes any private temporary output

#### Scenario: Force replacement is explicit

- **WHEN** an approved download has `force: true`
- **THEN** the existing destination is atomically replaced only after complete bytes are written, size-validated, synchronized, and cancellation is checked immediately before publication

#### Scenario: Blob recovery observes a completed write

- **WHEN** Blob reserve, byte upload, verification, completion, or Resource read-back loses a response
- **THEN** Client Core reuses the same idempotency identity, reads the Upload Session state, and does not replay a write already confirmed by the Server

#### Scenario: Bounded recovery cannot confirm Blob state

- **WHEN** Client Core cannot confirm the Blob operation within its existing bounded recovery
- **THEN** the tool fails with `workspace-result-unknown`, includes only safe stable operation identity, and performs no Client Shell or ToolRuntime retry

#### Scenario: Signed Asset uses another origin

- **WHEN** Workspace returns a valid cross-origin HTTP(S) Asset content URL
- **THEN** download does not send the Workspace Session cookie to that origin, does not follow redirects, and accepts no URL credentials

### Requirement: Workspace failure fidelity and secrecy

The Client Shell MUST preserve only frozen allowlisted Workspace/file-transfer error codes and exact JSON-safe operation detail under fixed messages; provider, filesystem, transport, dependency, and unlisted-code failures MUST become stable plugin failures without original messages, causes, credentials, or unknown values.

#### Scenario: Recognized transfer error crosses the tool boundary

- **WHEN** Client Core raises an allowlisted common, Blob, Asset, output, size, upload-terminal, Resource-kind, or current Server error with safe operation detail
- **THEN** Native and Code Mode failure content carries a fixed operation message and deterministic JSON envelope containing the code and exact allowlisted detail
- **AND** DSH failure metadata retains the same stable code

#### Scenario: Failure material contains a secret

- **WHEN** a filesystem provider, authenticated resolver, signed URL response, HTTP transport, error cause, or unexpected detail contains a password, cookie, `Set-Cookie`, signed URL credentials, grant payload, source bytes, or credential sentinel
- **THEN** no tool result, render, Session event, approval reason, or installed transcript emits that material
- **AND** unknown or unlisted material becomes a fixed `workspace-file-operation-failed` response

#### Scenario: Path failure is reported

- **WHEN** local-world, Session-cwd, containment, source, output, or exact-size validation fails
- **THEN** the tool returns only the stable path/file code and allowlisted requested or canonical path fields needed to correct the call, without provider identity, Host launch path, source bytes, temporary filename, or raw filesystem cause

### Requirement: File-transfer cancellation and lifecycle

Every file-transfer body MUST fuse its DSH caller signal with the Host owner disposal signal, pass the fused signal through its body policy/path check and the complete Client Core operation, and remain tracked until all remote, source-stream, destination-write, cleanup, and recovery work settles. Async pre-execute checks MUST observe the DSH caller signal and MUST retain no policy/path state after they settle.

#### Scenario: Caller cancels before ToolRuntime dispatches the body

- **WHEN** the original caller signal is already aborted before ToolRuntime invokes a file-transfer body
- **THEN** DSH returns `ABORTED_BEFORE_DISPATCH` and no approval, path, credential, filesystem, or Workspace operation runs

#### Scenario: Upload is cancelled before a write request

- **WHEN** an accepted upload observes caller cancellation or owner disposal before reserve or byte-upload dispatch
- **THEN** no later request starts and the body fails with `workspace-operation-cancelled` or `workspace-plugin-disposing`

#### Scenario: Dispatched upload becomes uncertain

- **WHEN** cancellation races a reserve, byte PUT, completion, or recovery request that may have reached the Server and Client Core returns `workspace-result-unknown`
- **THEN** that tool-owned failure remains `workspace-result-unknown` and includes the safe public upload intent with `idempotencyKey` plus every already known Upload Session identity such as `uploadId` and state
- **AND** after observing cancellation, Core starts no status, read-back, retry, completion, or other recovery request, and the Client Shell never automatically replays the settled call

#### Scenario: Download is cancelled before publication

- **WHEN** cancellation occurs during metadata, signed URL, response streaming, local writing, or immediately before atomic publication
- **THEN** active cancellable work observes the signal, no later step starts, private temporary output is removed, and an existing destination remains unchanged

#### Scenario: Caller cancels after a side effect confirms

- **WHEN** Client Core confirms upload publication or local atomic commit after or concurrently with the caller signal aborting
- **THEN** DSH rc.2 returns canonical `ABORTED` rather than the late success
- **AND** the tool finalizer preserves the DSH error identity and gives fixed operation-specific guidance to inspect Blob/Space state or the destination path before any manual retry

#### Scenario: Owner-only disposal races a confirmed side effect

- **WHEN** only the Host owner signal aborts and Client Core has confirmed the remote publication or local commit
- **THEN** the accepted body may return that confirmed success while disposal drains it
- **AND** any unconfirmed dispatched upload remains `workspace-result-unknown`

#### Scenario: Host is disposed with accepted transfers

- **WHEN** the plugin fiber is disposed during a path check, source read, HTTP request, recovery, destination stream, commit, or cleanup
- **THEN** the owner unregisters the four tools and transfer pre-execute policy, rejects new bodies, aborts owned cancellable body work, and waits for all accepted bodies and non-cancellable cleanup to settle, while ToolRuntime awaits any already-running stateless pre-execute promise
- **AND** no file handle, stream, request, recovery promise, temporary output, listener, timer, Job, or cached bytes survive disposal

### Requirement: Installed package preserves local transfer behavior

The prebuilt `dsh-univer-work` tarball MUST inline reachable private Client Core Blob/Asset/file modules, keep exact published DSH/Cordis filesystem, sandbox, and sandbox-policy dependencies external, and preserve the four-tool surface in an isolated installed local profile.

#### Scenario: Packed artifact is inspected

- **WHEN** package verification inspects the built Host entry and manifest
- **THEN** exact `0.1.1-rc.2` filesystem, local filesystem, sandbox, and sandbox-policy packages stay external, with no bare Client Core workspace import, CLI/Server source import, remote filesystem adapter, inline-byte transport, worker, native Office/render resource, Web Client, Skill, or later capability in the artifact

#### Scenario: Installed local file smoke runs

- **WHEN** the packed plugin is installed in an isolated local DSH profile and real ToolRuntime exercises a temporary Session cwd
- **THEN** it verifies four closed schemas, outside-cwd rejection, read-only no-ask typed denial with stable error info, undefined-mode E2B-like zero-ask/zero-path rejection, bare-local and in-process subclass constructor acceptance, workspace-write dual-root allowance, approval-to-body policy narrowing and provider recheck, danger-full-access cwd confinement, approval deny/allow, Blob metadata/upload/download, Asset download, default no-clobber, explicit force, abort/unknown behavior, secret-free results, cleanup, and normal dispose without a monorepo checkout
