## Context

`add-dsh-univer-work-authentication` owns the credential record and exposes an internal resolver that creates a fresh authenticated `WorkspaceHttp` for each operation. `packages/client-core/src/space.ts` already owns all Space/Node HTTP paths, strict parsers, pagination/cycle checks, filters, Node-name normalization, mutation response identity, rename/move read-back, and create/Trash result-unknown handling. The DSH application must remain a Client Shell adapter around that feature.

DeepSeek Harness `0.1.1-rc.2` defines tool approval outside `defineTool()`: a fiber-owned `tools/pre-execute` waterfall listener runs before the `defineTool()` body and its parameter validation, returns `ask`, and only an `allowed-once` outcome reaches the body. `defineTool()` itself owns parameter/output validation and render projection; it has no consequential-operation flag. Stable separate tool names are therefore the permission boundary, and consequential tools need an explicit policy-time input gate before an approval request is created.

`WorkspaceSpaceFeature` currently accepts no `AbortSignal`. Its pagination and recursive traversal can start multiple sequential requests, while DSH requires an async tool to forward `exec.signal` and settle only after owned work reaches quiescence. This Change adds only the optional signal needed by the existing methods.

## Goals / Non-Goals

**Goals:**

- Map the seven existing CLI Space/Node outcomes to stable DSH-native tools without copying protocol code.
- Keep schemas, canonical values, rendering, errors and approval machine-readable in Native and Code Mode.
- Propagate execution/owner cancellation through every Space/Node request and traversal boundary.
- Preserve existing Workspace CLI behavior and the self-contained installed package contract.

**Non-Goals:**

- Do not add a generic Workspace action tool, service interface, command adapter, background Job or shared schema generator.
- Do not add Worktree/Unit/open, files, runtimes, Skills, Web/Settings, Server endpoints or publication.
- Do not alter Space, Node, Resource, Trash, ACL or result-unknown product semantics.

## Diagram design

```text
DSH Agent
  │ seven closed-schema tools
  ▼
Space/Node tool adapter
  ├── pure operation validation ──> tools/pre-execute ask ──> create / rename / move / trash
  ├── body validation
  ├── authenticated resolver  ──> current CredentialKey grant
  └── fused exec + owner signal
                 │
                 ▼
WorkspaceSpaceFeature
  ├── strict parsers + filters
  ├── pagination / recursive traversal
  └── mutation read-back / result-unknown
                 │ HTTP-only
                 ▼
Workspace Server /api
```

## Decisions

### 1. Register seven operation-specific tools

The Host registers this fixed surface:

| Tool | Parameters | Canonical output |
| --- | --- | --- |
| `workspace_space_list` | none | `{ spaces }` |
| `workspace_space_browse` | `space_id`, optional `parent_node_id`, `recursive`, `resource_kind`, `unit_type` | `{ nodes }` |
| `workspace_space_find` | `space_id`, `query`, optional `resource_kind`, `unit_type` | `{ nodes }` |
| `workspace_node_create` | `space_id`, `name`, optional `parent_node_id` | `{ node }` |
| `workspace_node_rename` | `node_id`, `name` | `{ node }` |
| `workspace_node_move` | `node_id`, nullable `parent_node_id` | `{ node }` |
| `workspace_node_trash` | `node_id` | `{ trashBatch }` |

Parameter keys follow DSH's existing snake_case convention. Canonical output keeps the Client Core/CLI model's field names so the adapter does not create a second Node/Resource projection. `parent_node_id: null` expresses the Space root directly; a second `root` boolean would recreate Commander's mutually exclusive flags without helping a tool caller.

DSH rc.2 compiles `defineTool()` parameter roots as open objects and its generated validator accepts unknown keys. It also runs `tools/pre-execute` before the definition body performs parameter validation. A small application-local `defineClosedWorkspaceTool()` therefore builds one pure operation validator from each declaration. It checks that the root is a plain object, exact own keys, required/optional value types and operation-specific cross-field rules without reading services or normalizing/rewriting `exec.arguments`. The wrapper projects `additionalProperties: false` in the model-facing root schema and calls the same validator at the start of every body before delegating to the original `defineTool()` execution. The mutation policy calls that validator once more before returning `ask`. Changing only the JSON Schema or body would leave direct ToolRuntime execution or pre-approval inspection open, so tests cover all three surfaces for the applicable tools. Validation failure uses fixed plugin-owned `workspace-argument-invalid` content and never reflects a rejected key or value.

The shared pure validators reject blank IDs/query, validate the Core Node-name limit, reject `unit_type` with `resource_kind: none | blob`, and reject a non-null move `parent_node_id` equal to `node_id`. Mutation policy validation completes before approval; body validation completes before authenticated resolution. The Server remains authoritative for detecting descendants, cross-Space targets and current permissions. The adapter does not add fuzzy search, pagination knobs or arbitrary action payloads.

Each output uses a closed explicit schema assembled from a few reused Space, Node, Resource, capability and Trash fragments. This is data-shape reuse inside one tool module, not a schema-generation framework. `output.render` reads only the validated value and prints stable identities/counts; code callers use the canonical value.

Alternatives rejected:

- A single `workspace_space` or `workspace_node_update` action tool would weaken schemas and hide the permission boundary.
- Reusing Commander argument parsing or CLI JSON presentation would create an app-to-app dependency.
- Adding cursor controls would expose a transport detail that Client Core already closes over.

### 2. Ask before every Node mutation through the current DSH seam

One listener owned by the Space/Node lifecycle effect matches the four mutation names, selects the corresponding pure operation validator, and validates `exec.arguments` before returning `ask`. Invalid root shape, keys, types, required values, Node name or self-parent relationship throw a fixed `HarnessError` with code `workspace-argument-invalid`; the policy does not call `next()`, create an approval request, resolve credentials or reach HTTP. The error message, metadata and content identify only the operation and never copy arguments. Valid input returns `ask` with a fixed secret-free reason naming only the operation; every other name calls `next()`. Discovery is read-only and does not ask. The listener does not call `ctx.approval` directly: DSH's tool pipeline fails closed when the channel is absent, rejected, cancelled or unavailable. Every allowed mutation body runs the validator again before any resolver/HTTP work, so policy validation does not replace the execution boundary.

All four mutations are separate because approval policy keys on `exec.name`. Trash remains `workspace_node_trash`; it cannot be reached through move or a generic update. The mutation definitions omit `isConcurrencySafe`, so DSH keeps them exclusive. No persistent grant or plugin-defined bypass is introduced.

### 3. Reuse `WorkspaceSpaceFeature` and append optional signals

The DSH adapter creates `WorkspaceSpaceFeature` with Change 2's current-grant resolver and calls one existing method per tool. It never builds `/api` paths, parses wire JSON, performs its own read-back or reads the credential record.

Client Core appends an optional signal without request-object or overload scaffolding:

```text
list(signal?)
browse(input, signal?)
find(input, signal?)
createNode(input, signal?)
renameNode(input, signal?)
moveNode(input, signal?)
trashNode(nodeId, signal?)
```

After authenticated HTTP resolution, Core checks the signal before starting work and supplies it to every `http.json()` call. `listDirectory()` checks before each cursor request; recursive browse checks before each child. Rename/move use the same signal for PATCH and any GET read-back. Create/Trash never retry. Existing callers omit the optional argument and retain the same types and runtime behavior.

The Core does not acquire a DSH dependency, add a cancellation error taxonomy, or own Host disposal. `WorkspaceHttp` continues to map an aborted dispatched fetch to `workspace-result-unknown`. DSH rc.2 preserves a tool-owned failure after caller cancellation, but if the invoked body returns success after the caller signal aborts, `ToolRuntime` replaces that success with canonical `ABORTED` during dispatch/finalize. The application wrapper owns only the body failures described below and cannot override that caller-owned late-success classification.

### 4. Keep Workspace errors structured and secret-free

The tool adapter catches `WorkspaceApplicationError` at one shared execution wrapper. Only this frozen allowlist crosses as a Workspace code:

```text
Core:
  workspace-argument-invalid
  workspace-invalid-response
  workspace-result-mismatch
  workspace-result-unknown
  workspace-origin-mismatch
  workspace-authentication-required
  workspace-request-invalid
  workspace-redirect-refused

Server Space/Node/Trash HTTP:
  UNAUTHENTICATED
  INVALID_INPUT
  FORBIDDEN
  NOT_FOUND
  CONFLICT
  INTERNAL_ERROR
```

Any other Server envelope code, numeric code or Workspace-shaped thrown code becomes plugin code `workspace-operation-failed`; its source code, message and detail do not cross the tool boundary. Baseline changes update this list only after the matching HTTP/Core behavior is verified.

For an allowed code, the adapter projects detail through an exact safe-field allowlist used by Space/Node operations: `status`/`path` and operation identities such as `spaceId`, `nodeId`, `name`, `parentNodeId`, `requested`, and `actual`. It excludes `cause`, `readCause`, headers, cookies, records and unknown keys. Nested `requested`/`actual` also use exact fields. Non-lossless detail is omitted rather than stringified through `String()`.

The adapter throws a small `HarnessError` subclass with the allowlisted Workspace code. Its fixed operation-specific message includes a deterministic JSON envelope containing `{ code, detail? }`, so Native failure content and Code Mode both retain safe detail while DSH `ToolErrorInfo` retains the same code. It does not copy the original error message or cause across the shell boundary. Unknown resolver/provider/transport values and unlisted codes become `workspace-operation-failed` with the same fixed operation text and no original material.

This is deliberately narrower than a generic recursive redactor: credential material should never be accepted and then guessed at by key names. Before policy, DSH may persist Native caller arguments in `tool/call.arguments`; Code Mode persists them in `tool/code-dispatch-start.arguments` and unconditionally repeats the normalized arguments in settled `tool/code-dispatch.arguments`. The plugin cannot erase those DSH-owned records and does not claim Session-wide sentinel absence. Tests seed password/cookie/grant sentinels into invalid arguments, causes and disallowed detail, then verify that approval interactions/events, validation and operation failure/result content and metadata, plugin-owned contexts and plugin logs never copy them. All three argument fields remain explicitly outside that assertion.

### 5. Extend the existing Host owner instead of adding a service

The application reuses the Host lifecycle owner established by the authentication Change. A minimal internal `runOwned(exec.signal, operationKind, body)` closure uses native `AbortSignal.any([exec.signal, owner.signal])`, registers the whole body in the owner's active set before authenticated resolution, and removes it only after settle. It retains both source signals so failure mapping can distinguish caller cancellation from owner disposal. The Space/Node module does not define a Cordis service interface or cache HTTP/results.

If ToolRuntime sees caller cancellation before invoking the body, its existing `ABORTED_BEFORE_DISPATCH` result applies and no plugin code runs. Once the body is accepted, an execution signal aborted before resolver/request becomes plugin code `workspace-operation-cancelled`; an owner signal aborted in the same phase takes precedence and becomes `workspace-plugin-disposing`. During list/browse/find, an abort-induced Core `workspace-result-unknown` is mapped to the same source-specific plugin code because reads have no remote mutation to reconcile.

After a Node mutation request may have been dispatched, the outcomes split by signal owner and body result:

- A tool-owned `workspace-result-unknown` remains that failure after caller or owner abort; ToolRuntime does not replace failures.
- If Core confirms the mutation and returns success after the caller signal has aborted, ToolRuntime replaces the final DSH outcome with canonical `ABORTED`. The plugin cannot expose the confirmed value through that call. Each mutation definition's total `finalizeContent` recognizes the registry-owned `ABORTED` failure and replaces only its content with fixed guidance to use Space browse/find to inspect current Node state and never replay the mutation automatically; it preserves the registry-owned error identity.
- Owner-only disposal does not abort ToolRuntime's caller signal. If Core already confirms the mutation, the plugin may return that confirmed success while disposal drains the body; an owner-induced unknown result remains `workspace-result-unknown`.

Thus the plan makes no promise that Core read-back success remains model-visible under caller cancellation. A queued/body-invoked mutation stopped before request dispatch uses the source-specific cancelled/disposing failure.

Its fiber-owned effect registers the seven tools and mutation policy. Disposal marks the owner non-accepting, explicitly unregisters these registrations, aborts the owner controller, then awaits the tracked bodies. Credential-provider reads that cannot accept a signal are still inside the tracked body and drain; HTTP, read-back and traversal receive the fused signal. No detached traversal, retry, timer or Job exists.

If Change 2's implemented owner already exposes equivalent closure behavior, this Change calls it directly. Otherwise it moves only that closure to a shared application-local module and keeps one controller/active set; it does not add another lifecycle abstraction.

### 6. Verify source, assembled tools and installed closure

Client Core tests add abort-observing cases for list, multi-page/recursive browse/find, each mutation and rename/move read-back, while all existing no-signal tests remain unchanged. Tool tests use real Cordis `ToolRuntime` plus fake approval and authenticated HTTP to cover closed schema projection; all seven body validators; mutation policy-time rejection of non-object roots, extra `cookie`/`origin`/`path`/`action` keys, wrong types, missing values, invalid names and self-move before approval; canonical output; approval allow/deny/unavailable; the exact error-code allowlist/fallback; body-level cancelled/disposing failures; caller-cancelled late success becoming DSH `ABORTED`; mutation result-unknown remaining a failure; owner-only confirmed success and disposal drain.

A keyless Native/Code Mode transcript verifies stable names, closed parameter schemas and values, pre-approval invalid mutation behavior, caller-aborted late success guidance to browse without replay, and plants credential sentinels in invalid arguments, dependency failures and unlisted error codes. Its non-reflection assertion excludes Native `tool/call.arguments` plus Code Mode `tool/code-dispatch-start.arguments` and settled `tool/code-dispatch.arguments`; it scans approval interactions/events, failure/result content and metadata, plugin-owned contexts and plugin logs. Package verification confirms reachable Space/Node Core is still inlined and no bare private package import, worker, native/browser resource or future capability enters the tarball. The existing isolated profile smoke executes representative read/mutation tools and normal shutdown without a real account.

The plugin cannot erase arguments a hostile caller has already authored into DSH's Native call record or Code Mode start/settlement records. The closed model schema prevents ordinary model assembly from offering extra fields; the mutation policy gate prevents an invalid consequential call from reaching approval, credentials or HTTP; the repeated body gate closes direct execution for all seven tools. Tests assert these boundaries and the narrower output/context/log non-reflection guarantee rather than claiming the plugin can rewrite DSH-owned Session history.

## Risks / Trade-offs

- **Seven schemas repeat nested model detail** -> Reuse only local schema fragments; closed outputs justify the repetition and avoid a generator dependency.
- **Approval makes ordinary rename/move interactive** -> Every remote mutation is consequential in the first Host-only release; separate names let a future deployment policy change explicitly without changing the tools.
- **Cancellation after a write cannot prove whether the Server committed** -> Keep Client Core read-back/result-unknown behavior and never retry automatically.
- **DSH's parameter helper is open-root and policy precedes body validation** -> Close the projected root, run one pure validator before mutation approval, and repeat it at every body; do not rely on one side alone.
- **Credential-provider read cannot be aborted** -> Track and drain it as part of the accepted body; only in-flight HTTP and traversal have cancellable seams in scope.
- **A Core error code/detail contains unexpected material** -> Forward only the frozen code list and exact safe detail fields; everything else becomes `workspace-operation-failed` without original messages/causes.
- **DSH prerelease tool/approval contracts change** -> Keep exact `0.1.1-rc.2` dependencies and rerun ToolRuntime and installed-profile checks before baseline changes.

## Migration Plan

1. Complete and verify `add-dsh-univer-work-authentication` so the resolver, Host owner, bundled build and installed smoke exist.
2. Add optional signals and focused cancellation cases to Client Core without changing existing CLI calls.
3. Add the seven tool definitions, local schemas/validators, Workspace error adapter and mutation approval listener.
4. Extend the existing owner tracking and installed package checks, then run Client Core, DSH, CLI and repository gates.

There is no Server, database, credential or product-state migration. Rollback removes the seven registrations and optional-signal call sites; authentication and the inert package remain.

## Open Questions

无。会改变 tool names、approval boundary、output/error contract、signal propagation 或 Change size 的决定均已由用户确认、现有 Domain Model 和冻结源码收敛。
