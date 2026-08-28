## Purpose

定义 local Host-only `dsh-univer-work` 的有界 Facade API 与 visual SVG resource discovery/export operations，使 Agent 按需取得版本匹配的结构化知识与本地资源文件，而不加载完整 catalog、暴露秘密或绕过 Session 文件策略。

## ADDED Requirements

### Requirement: Stable keyless discovery surface

The Client Shell SHALL register exactly `workspace_api_find`, `workspace_api_show`, `workspace_resource_registries`, `workspace_resource_find`, and `workspace_resource_export` as operation-specific DSH tools, and the four non-export tools MUST query only the immutable installed API/resource datasets without resolving a Workspace origin, credential, Login Session, or remote Workspace connection.

#### Scenario: Tool catalog is assembled

- **WHEN** DSH assembles the Native tool catalog or Code Mode SDK
- **THEN** it exposes the five exact tool names with closed operation-specific parameter schemas
- **AND** no discovery tool accepts an action, origin, cookie, password, credential record, arbitrary URL/header, inline SVG, command, remote filesystem selector, unbounded JSON, or Workspace identity

#### Scenario: Keyless discovery is invoked

- **WHEN** an installed profile with no Workspace grant invokes API find/show or resource registries/find
- **THEN** the tool returns canonical data from the installed plugin datasets without credential lookup, approval, Workspace HTTP, local output, or cache mutation

#### Scenario: API symbols are not found

- **WHEN** API show receives one or more syntactically valid symbols absent from the installed reference
- **THEN** it returns closed not-found entries and bounded spelling suggestions as canonical data rather than treating absence as a transport or authentication failure

### Requirement: Closed canonical discovery results

Every discovery tool MUST validate exact own argument keys before capability work, MUST project the complete accepted result into its declared closed output before rendering, and MUST expose the same canonical JSON value to Native and Code Mode without a second Commander-style presentation.

#### Scenario: API reference is queried

- **WHEN** API find or show succeeds
- **THEN** find returns terms, total counts and bounded structured matches, while show returns the published found/not-found class, member, type or type-member information needed to select exact Facade signatures
- **AND** the result contains no dataset internals, cache/package path, CLI prose envelope, arbitrary extra key, or credential field

#### Scenario: Resource catalog is queried

- **WHEN** resource registries or find succeeds
- **THEN** the result contains closed registry counts or stable resource handles, names, group/tags, keywords, order, intrinsic size and color-editability as applicable
- **AND** it contains no resource source URL, raw manifest record, cache location or SVG content

#### Scenario: Direct execution supplies an unknown key

- **WHEN** a discovery tool body receives an own argument key outside that operation's declaration
- **THEN** it fails before dataset, path, credential, network, cache or output work
- **AND** its failure does not echo the rejected key or value

#### Scenario: Canonical output violates its declaration

- **WHEN** dataset or adapter code returns a missing, broadened, wrong-kind, non-JSON or otherwise malformed value
- **THEN** the tool fails before `output.render`, Native results or Code Mode receive it

### Requirement: Discovery fan-out and byte budgets

The Client Shell MUST enforce a canonical-arguments limit of 64 KiB, one-to-eight non-blank strings for API terms/symbols and resource queries, at most eight registry filters, API find limit 1–30 with default 10 per term, resource find limit 1–100 with default 30 total, one-to-thirty-two unique export handles, a 1 MiB canonical API result limit, and a 256 KiB canonical limit for every other discovery result.

#### Scenario: Query stays within limits

- **WHEN** a valid query and its complete closed result fit every applicable fan-out and UTF-8 serialized JSON limit
- **THEN** the tool returns the complete value without truncating matches, signatures, type members, suggestions, registry metadata, or export status

#### Scenario: Input fan-out exceeds a limit

- **WHEN** a caller supplies too many entries, an overlong or blank string, a duplicate where repetition has no meaning, an invalid enum, or a numeric limit outside the accepted range
- **THEN** the tool fails with fixed invalid-argument information before dataset lookup, approval, path, network or output work

#### Scenario: Complete result exceeds its byte limit

- **WHEN** a valid API/resource operation projects a canonical result larger than its fixed serialized limit
- **THEN** it fails with `workspace-discovery-result-too-large`, reports only actual and maximum byte counts plus narrowing guidance, and returns no truncated success value

### Requirement: Resource export is confined and approved

`workspace_resource_export` MUST accept only stable visual-resource handles and one output directory, MUST first enforce the calling Session's current DSH file-effect policy and positive Host-local filesystem identity, MUST confine the directory and every derived flat SVG target to the Session cwd and any current policy root, and MUST obtain one-time approval before network, cache, `processPath()`, directory creation or output write.

#### Scenario: Read-only Session requests export

- **WHEN** export pre-execute runs under current `read-only` policy
- **THEN** it fails with `workspace-file-policy-denied` before provider/path interpretation, approval, network, cache or output
- **AND** no tool body runs

#### Scenario: Non-local filesystem requests export

- **WHEN** the mounted filesystem is E2B, remote, or cannot be positively proven as the Host-local public filesystem implementation
- **THEN** export fails with `workspace-local-filesystem-required` before resolving or interpreting the model path, asking approval, calling `processPath()`, downloading or writing

#### Scenario: Eligible local export is approved

- **WHEN** every requested handle and derived `<registry>--<resource>.svg` identity remains within the Session cwd and any current `workspaceRoot`, and DSH returns `allowed-once`
- **THEN** only that immutable accepted body may download, cache and write those handles to the approved directory
- **AND** existing flat target files may be replaced as part of that approved resource-export outcome

#### Scenario: Policy or path changes while approval is pending

- **WHEN** policy, provider, output-directory identity, or a derived target/symlink changes before the accepted body starts its effects
- **THEN** the body re-resolves current policy, local identity and every target from immutable arguments and fails any now-ineligible call before network, cache, `processPath()` or output
- **AND** it does not ask again or retain preflight policy/path state

#### Scenario: Approval is denied or unavailable

- **WHEN** export approval is denied, cancelled, unavailable, or has no interaction channel
- **THEN** the body performs no download, cache/output write, directory creation or file replacement

#### Scenario: Resource export partially succeeds

- **WHEN** one or more sequential handles are written and another handle fails validation, download or publication
- **THEN** the canonical result sets `complete: false`, lists every confirmed `{ handle, path }`, and lists each failure only as an allowlisted `{ handle, code }`
- **AND** it preserves confirmed files, starts no Client Shell replay, and exposes no raw failure message or URL

### Requirement: Discovery failures are stable and secret-free

The Client Shell MUST map dataset, reference, resource, filesystem and lifecycle failures to a frozen code allowlist with fixed messages and exact JSON-safe detail, and MUST replace unknown dependency failures with a stable generic discovery or resource-export failure.

#### Scenario: Installed dataset is invalid

- **WHEN** API reference or resource manifest initialization fails validation
- **THEN** plugin activation or the affected discovery surface fails closed with `workspace-discovery-dataset-invalid`
- **AND** no result exposes a package/manifest/cache path, raw record, dependency message, cause or stack

#### Scenario: Resource operation raises an allowlisted failure

- **WHEN** resource handle, registry, download, SVG, size, redirect or export validation raises a frozen public resource code
- **THEN** the result preserves that code and only safe handle/count/path detail needed to correct the operation
- **AND** it emits no source/download/redirect URL, header, response body, temporary filename or filesystem cause

#### Scenario: Failure material contains a secret

- **WHEN** any unexpected dependency, transport, filesystem or error cause contains a cookie, token, password, signed URL, credential sentinel, Host path outside Session cwd or raw manifest/SVG data
- **THEN** Native result, Code Mode settlement, render, approval text and installed transcript contain none of that material

### Requirement: Discovery cancellation and Host lifecycle

Every discovery body MUST fuse its caller signal with the Host owner signal, MUST check it around synchronous dataset work, and resource export MUST propagate it to remote download and between every sequential cache/output effect. Host disposal MUST unregister the five tools and export policy, reject new work, abort owned work, await accepted bodies and unabortable file finalizers, remove private cache state, and leave no discovery effect active.

#### Scenario: Caller cancels before dispatch

- **WHEN** the caller signal is already aborted before ToolRuntime dispatches a discovery body
- **THEN** DSH returns `ABORTED_BEFORE_DISPATCH` and no dataset, approval, path, network, cache or output work begins

#### Scenario: Caller cancels a read-only query

- **WHEN** caller cancellation occurs before or during packaged dataset lookup
- **THEN** no later projection/render step begins and DSH returns its canonical aborted outcome rather than a late success

#### Scenario: Export cancellation follows confirmed files

- **WHEN** caller cancellation arrives after one or more SVG files are confirmed but before all handles settle
- **THEN** no later handle download/publication begins after cancellation is observed, confirmed files remain in the approved directory, and DSH may return canonical `ABORTED`
- **AND** fixed guidance requires inspecting that directory before manually retrying

#### Scenario: Host is disposed during export

- **WHEN** plugin disposal races download, cache, output or cleanup
- **THEN** the owner unregisters discovery effects, aborts cancellable work, waits for an in-flight filesystem primitive and accepted body to settle, removes only private cache state, and preserves caller-owned confirmed outputs

### Requirement: Installed artifact contains the exact discovery closure

The prebuilt plugin tarball MUST carry the version-matched API reference, resource manifest dependency and discovery implementation required by the five tools, and MUST preserve keyless behavior outside the monorepo checkout.

#### Scenario: Packed artifact is inspected

- **WHEN** package verification walks manifest dependencies, Host imports and packed resources
- **THEN** API/resource packages select exact SDK `1.0.0-beta.2`, the resource manifest owner selects exact `0.1.0`, and every runtime reference resolves from installed package contents/dependencies
- **AND** no CLI source/artifact, Commander package, bare private Client Core import, adjacent checkout, absolute build path, raw resource index prompt or unrequested Web/Settings/Job surface is present

#### Scenario: Keyless installed smoke runs

- **WHEN** an isolated local DSH profile installs the tarball and invokes the five tools through real ToolRuntime from an unrelated cwd with no Workspace credential
- **THEN** it verifies four keyless read-only queries, bounded Native/Code Mode values, export policy/path/approval, controlled HTTPS download, partial failure, cancellation, cleanup and normal disposal without a monorepo fallback
