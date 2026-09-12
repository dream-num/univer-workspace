## Purpose

定义 local Host-only `dsh-univer-work` 的有界 Facade API 与 visual SVG resource discovery/export operations，使 Agent 无需 Workspace credential 即可按需取得版本匹配的结构化知识和受控本地资源文件。

## ADDED Requirements

### Requirement: Stable credential-free discovery surface

The Client Shell SHALL register exactly `workspace_api_find`, `workspace_api_show`, `workspace_resource_registries`, `workspace_resource_find`, and `workspace_resource_export` as operation-specific DSH tools, and every operation MUST use only installed discovery data without resolving a Workspace origin, credential, Login Session, or remote Workspace connection.

#### Scenario: Tool catalog is assembled

- **WHEN** DSH assembles the Native tool catalog or Code Mode SDK
- **THEN** it exposes the five exact tool names with closed operation-specific parameter schemas
- **AND** no discovery tool accepts an action, origin, cookie, password, credential record, arbitrary URL/header, inline SVG, command, remote filesystem selector, unbounded JSON, or Workspace identity

#### Scenario: Read-only discovery is invoked without a grant

- **WHEN** an installed profile with no Workspace grant invokes API find/show or resource registries/find
- **THEN** the tool returns canonical data from immutable installed datasets without credential lookup, approval, Workspace HTTP, local output, cache mutation or network access

#### Scenario: Export is invoked without a grant

- **WHEN** an eligible local Session invokes resource export and receives one-time approval
- **THEN** the export may retrieve only the installed manifest's requested HTTPS resources and publish the approved files without reading a Workspace credential or contacting Workspace

### Requirement: Closed canonical discovery results

Every discovery tool MUST reject undeclared own argument keys before capability work, MUST project the complete accepted result into its declared closed output, and MUST expose the same validated canonical JSON value to Native and Code Mode before value-only rendering.

#### Scenario: API reference is queried

- **WHEN** API find or show succeeds
- **THEN** find returns `{ terms }` with each query's total and bounded structured matches, while show returns `{ results }` with the complete applicable found/not-found class, member, type or type-member information
- **AND** the result contains no dataset internals, package path, CLI prose envelope, arbitrary extra key or credential field

#### Scenario: Resource catalog is queried

- **WHEN** resource registries or find succeeds
- **THEN** registries returns `{ registries }`, and find returns `{ resources, total }` with stable handles, names, group/tags, keywords, order, intrinsic size and color-editability as applicable
- **AND** the result contains no resource source URL, raw manifest record, cache location or SVG content

#### Scenario: API symbol is absent

- **WHEN** API show receives one or more syntactically valid symbols absent from the installed reference
- **THEN** it returns closed not-found entries and bounded spelling suggestions as canonical data rather than treating absence as a transport or authentication failure

#### Scenario: Direct execution supplies an unknown key

- **WHEN** any discovery body receives an own argument key outside that operation's declaration
- **THEN** it fails before dataset lookup, approval, path, network or output work
- **AND** its failure does not echo the rejected key or value

#### Scenario: Canonical output violates its declaration

- **WHEN** dataset or adapter code returns a missing, broadened, wrong-kind, non-JSON or otherwise malformed value
- **THEN** the tool fails before `output.render`, Native results or Code Mode receive it

### Requirement: Fixed search, result and asset budgets

The Client Shell MUST enforce a canonical-arguments limit of 64 KiB; one-to-eight non-blank strings of at most 160 characters for API terms/symbols and resource queries; at most eight registry filters; API find limit 1–30 with default 10 per term; resource find limit 1–100 with default 30 total; one-to-thirty-two unique export handles; a 1 MiB canonical limit for API find/show; a 256 KiB canonical limit for every other discovery result; and a 32 MiB cumulative response-body budget for one accepted export while retaining the installed per-resource download limit. Every consumed response chunk MUST remain charged whether that handle later succeeds, fails validation/publication, or is cancelled.

#### Scenario: Query stays within every limit

- **WHEN** a valid query and its complete closed result fit every applicable fan-out and UTF-8 serialized JSON limit
- **THEN** the tool returns the complete value without truncating matches, signatures, type members, suggestions, registry metadata or export status

#### Scenario: Input fan-out exceeds a limit

- **WHEN** a caller supplies too many entries, an overlong or blank string, a duplicate where repetition has no meaning, an invalid enum, or a numeric limit outside the accepted range
- **THEN** the tool fails with fixed invalid-argument information before dataset lookup, approval, path, network or output work

#### Scenario: Complete canonical result exceeds its byte limit

- **WHEN** a valid operation projects a canonical result larger than its fixed serialized limit
- **THEN** it fails with `workspace-discovery-result-too-large`, reports only actual and maximum byte counts plus narrowing guidance, and returns no truncated success value

#### Scenario: One resource exceeds its own limit while cumulative capacity remains

- **WHEN** one resource exceeds the installed 10 MiB per-resource limit while the export still has cumulative capacity
- **THEN** that handle fails without publication and a later handle may continue with only the cumulative capacity that remains after all chunks already consumed

#### Scenario: Declared response exceeds cumulative capacity

- **WHEN** a next response declares `Content-Length` greater than the call's cumulative remainder
- **THEN** its body is not consumed, that handle fails, and the export marks its cumulative budget terminal
- **AND** no later handle starts a network request

#### Scenario: Stream exactly exhausts cumulative capacity

- **WHEN** a complete response remains within both limits and its final chunks consume the exact cumulative remainder
- **THEN** the current handle may validate and publish, but the export marks its cumulative budget terminal before another handle
- **AND** no later handle starts a network request

#### Scenario: Stream exceeds cumulative capacity

- **WHEN** a received response chunk exceeds the call's cumulative remainder
- **THEN** the current handle is not published, the export marks its cumulative budget terminal, and no later handle starts a network request
- **AND** the closed partial result preserves only files already confirmed plus allowlisted failure codes

#### Scenario: Failed download consumes part of the budget

- **WHEN** a response consumes bytes and then fails because of abort, invalid UTF-8/SVG, size, transport settlement or publication
- **THEN** a next sequential handle, when the cumulative budget is not terminal, receives only the exact remaining allowance and never resets to 32 MiB
- **AND** once remaining capacity is exhausted, later handles fail without starting network or output work

### Requirement: Local resource export is confined and approved

`workspace_resource_export` MUST accept only stable visual-resource handle strings and one output directory, MUST first enforce the calling Session's current DSH file-effect policy and positive Host-local filesystem identity, MUST confine that directory to the Session cwd and any current policy root, and MUST obtain one-time approval for the immutable handles and directory before `processPath()`, directory inspection/creation, network access or output mutation. Because public discovery behavior resolves handle existence and export filenames only during export, pre-execute MUST NOT inspect private manifest structure or derive target filenames; the accepted output adapter MUST instead require each library-provided filename to be one basename and confine its target before writing.

#### Scenario: Read-only Session requests export

- **WHEN** export pre-execute runs under current `read-only` policy
- **THEN** it fails with `workspace-file-policy-denied` before provider/path interpretation, approval, network or output
- **AND** no tool body runs

#### Scenario: Non-local filesystem requests export

- **WHEN** the mounted filesystem is E2B, remote, or cannot be positively proven as the Host-local public filesystem implementation
- **THEN** export fails with `workspace-local-filesystem-required` before resolving or interpreting the model path, asking approval, calling `processPath()`, downloading or writing

#### Scenario: Eligible local export is approved

- **WHEN** the immutable handle list is syntactically valid, the output directory remains within the Session cwd and any current `workspaceRoot`, and DSH returns `allowed-once`
- **THEN** only that accepted body may ask the public resource capability to resolve/retrieve those handles and their canonical flat filenames
- **AND** its output adapter atomically publishes a file only after the returned filename passes basename and target-containment checks under the revalidated directory
- **AND** existing flat target files may be replaced only by complete validated SVG content as part of that approved outcome

#### Scenario: Policy or directory changes while approval is pending

- **WHEN** policy, provider, or output-directory/symlink identity changes before the accepted body starts its effects
- **THEN** the body re-resolves current policy, local identity and directory containment from immutable arguments and fails any now-ineligible call before network, `processPath()` or output
- **AND** it does not ask again or retain preflight policy/path state

#### Scenario: Public export supplies an unsafe filename

- **WHEN** the resource capability supplies an absolute filename, separator-bearing name, parent traversal, or a basename whose resolved target escapes the revalidated output directory or any applicable root
- **THEN** the output adapter rejects that handle before temporary-file creation or target replacement
- **AND** the Client Shell neither rewrites the name nor reads private manifest data to predict another target

#### Scenario: Approval is denied or unavailable

- **WHEN** export approval is denied, cancelled, unavailable, or has no interaction channel
- **THEN** the body performs no download, directory creation, temporary output or file replacement

### Requirement: Export retains only approved outputs

Resource export MUST create no persistent or temporary filesystem cache, MUST process handles sequentially, and MUST publish each SVG through an application-owned same-directory unpredictable `0600` temporary file that is completely written, synchronized and cancellation-checked before atomic target replacement. It MUST report only confirmed caller-owned files and allowlisted per-handle failures.

#### Scenario: Export completes

- **WHEN** every approved handle downloads, validates and atomically publishes
- **THEN** the result is `{ complete: true, exported, failed: [] }`, with one confined `{ handle, path }` per requested handle
- **AND** no cache directory, cached SVG, private temporary output or active file handle remains after settlement

#### Scenario: Resource export partially succeeds

- **WHEN** one or more sequential handles are confirmed and another handle fails validation, download or publication
- **THEN** the canonical result sets `complete: false`, lists every confirmed `{ handle, path }`, and lists each failure only as an allowlisted `{ handle, code }`
- **AND** it preserves confirmed files, starts no Client Shell replay, and exposes no raw failure message or URL

#### Scenario: Atomic publication fails

- **WHEN** download, SVG validation, write, synchronization or replacement fails before one target confirms
- **THEN** that target's prior file remains unchanged, its private temporary output is removed, and later work follows only the settled sequential/cancellation rules

#### Scenario: Existing target is replaced

- **WHEN** a complete validated SVG is ready for an existing confined target and cancellation has not been observed
- **THEN** the publisher synchronizes its same-directory private `0600` temporary file and atomically replaces the target using the resource-export operation's fixed error projection
- **AND** it does not call or claim a Blob/Asset-specific Client Core publisher

### Requirement: Export call state is isolated

The Client Shell MAY share one immutable, publicly validated query dataset, but each accepted export MUST own its own resource operation instance, no-retention adapter set, fused signal, cumulative budget, revalidated directory, temporary outputs and partial result. It MUST NOT route export state through a mutable shared current-call slot or AsyncLocalStorage.

#### Scenario: Two exports overlap

- **WHEN** two accepted export bodies target different contained directories or carry different remaining budgets
- **THEN** every handle uses only its own call's signal, budget, directory, output adapter and result accumulator
- **AND** bytes, files, failures or cancellation from one call do not change the other call's allowance, target or result

#### Scenario: One overlapping export is cancelled

- **WHEN** caller cancellation aborts one accepted export while another remains active
- **THEN** only the cancelled call stops later handle work and its confirmed files remain caller-owned
- **AND** the other call may continue with its own unchanged signal and cumulative remainder

#### Scenario: Host disposal drains isolated exports

- **WHEN** Host disposal begins with one or more accepted export bodies
- **THEN** the owner aborts and awaits each body promise and its file finalizer without consulting or cleaning a shared current-call adapter
- **AND** every call-owned closure becomes unreachable after its body settles

### Requirement: Discovery failures are stable and secret-free

The Client Shell MUST map dataset, reference, resource, filesystem and lifecycle failures to a frozen code allowlist with fixed messages and exact JSON-safe detail, and MUST replace unknown dependency failures with a stable generic discovery or resource-export failure.

#### Scenario: Installed dataset is invalid

- **WHEN** API reference or resource manifest initialization fails validation
- **THEN** plugin activation fails closed with `workspace-discovery-dataset-invalid` before registering a partial discovery surface
- **AND** no result exposes a package/manifest path, raw record, dependency message, cause or stack

#### Scenario: Resource operation raises an allowlisted failure

- **WHEN** resource handle, registry, download, SVG, size, redirect or export validation raises a frozen public resource code
- **THEN** the result preserves that code and only safe handle/count/path detail needed to correct the operation
- **AND** it emits no source/download/redirect URL, header, response body, temporary filename or filesystem cause

#### Scenario: Failure material contains a secret

- **WHEN** any unexpected dependency, transport, filesystem or error cause contains a cookie, token, password, signed URL, credential sentinel, Host path outside Session cwd or raw manifest/SVG data
- **THEN** Native result, Code Mode settlement, render, approval text and installed transcript contain none of that material

### Requirement: Discovery cancellation and Host lifecycle

Every discovery body MUST fuse its caller signal with the Host owner signal and check it around synchronous dataset work; export MUST propagate the fused signal to downloads and check it between every sequential output effect. Host disposal MUST unregister the five tools and export policy, reject new work, abort owned work, and await accepted bodies and unabortable file finalizers, leaving no discovery effect active.

#### Scenario: Caller cancels before dispatch

- **WHEN** the caller signal is already aborted before ToolRuntime dispatches a discovery body
- **THEN** DSH returns `ABORTED_BEFORE_DISPATCH` and no dataset, approval, path, network or output work begins

#### Scenario: Caller cancels a read-only query

- **WHEN** caller cancellation occurs before or during installed dataset lookup
- **THEN** no later projection/render step begins and DSH returns its canonical aborted outcome rather than a late success

#### Scenario: Export cancellation follows confirmed files

- **WHEN** caller cancellation arrives after one or more SVG files confirm but before all handles settle
- **THEN** no later handle download/publication begins after cancellation is observed, confirmed files remain in the approved directory, and DSH may return canonical `ABORTED`
- **AND** fixed guidance requires inspecting that directory before manually retrying

#### Scenario: Host is disposed during export

- **WHEN** plugin disposal races a download, output or cleanup
- **THEN** the owner unregisters discovery effects, aborts cancellable work, waits for an in-flight filesystem primitive and accepted body to settle, and preserves caller-owned confirmed outputs
- **AND** no request, file handle, temporary output, listener, timer, cache/current-call/AsyncLocalStorage state or accepted promise survives disposal

### Requirement: Installed artifact contains the exact discovery closure

The prebuilt plugin tarball MUST carry the version-matched API reference, resource manifest and discovery implementation required by the five tools, and MUST preserve credential-free behavior outside the monorepo checkout.

#### Scenario: Packed artifact is inspected

- **WHEN** package verification walks manifest dependencies, Host imports and packed resources
- **THEN** API/resource packages select exact SDK `1.0.0-beta.2`, the resource manifest owner selects exact `0.1.0`, and every runtime reference resolves from installed package contents/dependencies
- **AND** no CLI source/artifact, Commander package, bare private Client Core import, adjacent checkout, absolute build path, Skill, raw resource index prompt or unrequested Web/runtime surface is present

#### Scenario: Credential-free installed smoke runs

- **WHEN** an isolated local DSH profile installs the tarball and invokes the five tools through real ToolRuntime from an unrelated cwd with no Workspace credential
- **THEN** it verifies four read-only queries, bounded Native/Code Mode values, export policy/path/approval, controlled HTTPS download, partial failure, cancellation, cleanup and normal disposal without a monorepo fallback
