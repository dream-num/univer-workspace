## Purpose

定义 Host-only `dsh-univer-work` Client Shell 的 Space/Node tool surface，使 Agent 能以稳定、结构化、可授权且可取消的 DSH-native 操作发现远端 Workspace 层级并管理 Node，同时保持 Workspace Client Core 的严格响应校验与未知写结果语义。

## ADDED Requirements

### Requirement: Stable Space discovery tools

The Client Shell SHALL expose `workspace_space_list`, `workspace_space_browse`, and `workspace_space_find` as separate schema-validated DSH tools with closed canonical output schemas and rendering derived only from their validated canonical values.

#### Scenario: Accessible Spaces are listed

- **WHEN** `workspace_space_list` runs with a valid authenticated connection
- **THEN** it returns `{ spaces }` in Server order, with each Space's stable ID, name, and optional `personal | team` type

#### Scenario: A Node directory is browsed

- **WHEN** `workspace_space_browse` receives a non-empty `space_id`, optional non-empty `parent_node_id`, optional `recursive`, and valid Resource/Unit filters
- **THEN** it returns `{ nodes }` in Workspace traversal order, including every Node's path, access role, capabilities, hierarchy fields, and complete `null | univer | blob` Resource projection

#### Scenario: Nodes are found by name

- **WHEN** `workspace_space_find` receives non-empty `space_id` and `query` plus valid Resource/Unit filters
- **THEN** it recursively searches that Space through Client Core and returns matching `{ nodes }` in traversal order without adding fuzzy, ranking, or server-side search semantics

#### Scenario: Resource and Unit filters conflict

- **WHEN** browse or find combines `unit_type` with `resource_kind: none | blob`, or supplies an empty ID/query not expressible by the DSH schema vocabulary
- **THEN** the tool fails with stable invalid-argument information before any Workspace request

### Requirement: Stable Node mutation tools

The Client Shell SHALL expose `workspace_node_create`, `workspace_node_rename`, `workspace_node_move`, and `workspace_node_trash` as four separate DSH tools that preserve Client Core mutation identity, normalization, read-back, and result-unknown behavior.

#### Scenario: Organizational Node is created

- **WHEN** approved `workspace_node_create` receives non-empty `space_id`, a valid Node `name`, and optional non-empty `parent_node_id`
- **THEN** it performs one organizational Node create and returns `{ node }` with the validated Node identity and target

#### Scenario: Node is renamed

- **WHEN** approved `workspace_node_rename` receives non-empty `node_id` and a valid `name`
- **THEN** it returns `{ node }` only after Client Core validates the response or confirms an unknown response by read-back

#### Scenario: Node is moved

- **WHEN** approved `workspace_node_move` receives non-empty `node_id` and required `parent_node_id` as either a non-empty destination Node ID or `null`
- **THEN** it moves the Node to that parent or the current Space root and returns `{ node }` only after Client Core validates or confirms the result

#### Scenario: Node move targets itself

- **WHEN** `workspace_node_move` receives a non-null `parent_node_id` equal to `node_id`
- **THEN** it fails with stable invalid-argument information before approval, authenticated resolution, or HTTP
- **AND** descendant and cross-Space validation remain authoritative Server checks

#### Scenario: Node subtree is moved to Trash

- **WHEN** approved `workspace_node_trash` receives a non-empty `node_id`
- **THEN** it performs one Trash request and returns `{ trashBatch }` with the strict Trash Batch identity, root, count, actor, blockers, original location, capabilities, and timestamps

#### Scenario: Mutation result is unknown

- **WHEN** create or Trash loses the response, or rename/move read-back cannot confirm the requested state
- **THEN** the tool fails with `workspace-result-unknown`, preserves its safe operation detail, and does not retry or claim success

### Requirement: Closed parameter, output, and rendering contracts

Every Space/Node tool MUST declare only the parameters for its one operation, MUST reject unsupported or cross-field-invalid input, and MUST validate the complete canonical value before rendering or returning it to Native or Code Mode.

#### Scenario: Tool catalog is assembled

- **WHEN** DSH assembles Native schemas or the Code Mode SDK
- **THEN** it exposes exactly the seven snake_case names and their operation-specific parameter roots with `additionalProperties: false`, with enums for `resource_kind`, `unit_type`, Resource kind, Space type, access role, availability, and Trash blockers
- **AND** no tool accepts a generic operation/action, credential, origin, cookie, password, Worktree, Unit operation, local path, command, or arbitrary JSON argument

#### Scenario: Direct execution supplies an unknown key

- **WHEN** any Space/Node tool receives an own parameter key outside that tool's declaration, including `cookie`, `origin`, `path`, or `action`
- **THEN** a mutation policy or read execution wrapper returns `workspace-argument-invalid` before approval, authenticated resolution, or HTTP respectively
- **AND** its failure content does not echo the rejected key or value

#### Scenario: Canonical output violates its declared structure

- **WHEN** a tool body returns a missing, broadened, non-JSON, or wrong-identity Space, Node, Resource, capability, or Trash Batch field
- **THEN** DSH rejects it as invalid tool output before `output.render` or Code Mode receives it

#### Scenario: Valid output is rendered

- **WHEN** a Space/Node tool succeeds
- **THEN** its model-visible text summarizes the operation and stable identities only from the validated canonical value
- **AND** the complete lossless canonical value remains available to Native and Code Mode callers without parsing the rendered prose

### Requirement: Consequential Node operations validate before approval

The Client Shell MUST install a fiber-owned `tools/pre-execute` policy that runs the same pure operation validator used by the body before returning DSH `ask` for each of the four Node mutation tool names, and delegates all other tools, including the three Space discovery tools, to the existing policy chain. The validator MUST check root object shape, exact own keys, required and optional types, blank IDs, Node names, and cross-field/self-parent rules without service access or argument rewriting.

#### Scenario: Invalid mutation is rejected before approval

- **WHEN** a Node mutation receives a non-object root, unknown key, missing or wrong-typed value, blank ID, invalid Node name, or non-null `parent_node_id` equal to `node_id`
- **THEN** the policy fails with fixed `workspace-argument-invalid` content and metadata before returning `ask`
- **AND** no approval request, credential resolution, body, or HTTP runs, and the failure and approval surfaces do not copy any argument key or value

#### Scenario: Mutation receives one-time approval

- **WHEN** policy-time validation passes and DSH obtains `allowed-once` for a Node create, rename, move, or Trash call
- **THEN** only that accepted tool body executes with its original arguments and repeats the same pure validation before credential resolution or HTTP

#### Scenario: Approval is rejected or unavailable

- **WHEN** approval is rejected, cancelled, unavailable, or no approval channel exists for a Node mutation
- **THEN** DSH fails closed before resolving authenticated HTTP or sending a Workspace request

#### Scenario: Trash is inspected by policy

- **WHEN** a deployment or reviewer inspects the consequential surface
- **THEN** recursive Trash is identifiable as the dedicated `workspace_node_trash` tool and is not hidden behind rename, move, a generic Node update, or a composite tool

### Requirement: Workspace failure fidelity and secrecy

The Client Shell MUST convert recognized `WorkspaceApplicationError` failures into deterministic DSH failures that preserve only a Workspace code from the frozen Space/Node allowlist and an allowlisted lossless JSON-safe detail projection while using a fixed operation-specific message; unknown dependency failures and unlisted codes MUST use the same fixed message under plugin code `workspace-operation-failed` without their original material.

#### Scenario: Recognized Workspace error crosses the tool boundary

- **WHEN** Client Core raises `workspace-argument-invalid`, `workspace-invalid-response`, `workspace-result-mismatch`, `workspace-result-unknown`, `workspace-origin-mismatch`, `workspace-authentication-required`, `workspace-request-invalid`, `workspace-redirect-refused`, `UNAUTHENTICATED`, `INVALID_INPUT`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, or `INTERNAL_ERROR`, with allowlisted operation detail that is JSON-safe and credential-free
- **THEN** Native and Code Mode failure content carries a fixed operation message plus a deterministic JSON error envelope containing that code and safe detail
- **AND** DSH failure metadata retains the same stable code

#### Scenario: Server returns an unlisted code

- **WHEN** a Workspace-shaped Server error contains any other string or numeric code, including a credential sentinel that otherwise resembles a machine identifier
- **THEN** the tool returns `workspace-operation-failed` with fixed operation text and no original code, message, detail, or cause

#### Scenario: Failure material contains a secret

- **WHEN** an authenticated resolver, Workspace transport, validator, or thrown cause contains a password, cookie, `Set-Cookie`, grant payload, credential sentinel, or non-JSON detail
- **THEN** the tool does not emit that material or the original unknown failure
- **AND** it returns a fixed operation-specific failure while preserving a Workspace code only when doing so is safe

#### Scenario: Invalid caller arguments were already recorded by DSH

- **WHEN** a hostile caller submits an invalid mutation argument containing a credential sentinel
- **THEN** the plugin does not promise to remove or redact Native `tool/call.arguments`, Code Mode `tool/code-dispatch-start.arguments`, or the normalized arguments unconditionally written to settled `tool/code-dispatch.arguments`
- **AND** approval interactions/events, validation failure/result content and metadata, plugin-owned contexts, and plugin logs do not copy the sentinel or rejected key/value

### Requirement: Space and Node cancellation and lifecycle

Every Space/Node tool MUST fuse its DSH execution signal with the Host owner disposal signal, pass that signal through the complete Client Core operation, and remain active until its owned traversal or mutation work settles. One fiber-owned lifecycle effect MUST stop new calls, abort in-flight work, and drain every accepted tool body and approval registration before disposal returns.

#### Scenario: Caller cancels before ToolRuntime dispatches the body

- **WHEN** the original caller signal is already aborted before ToolRuntime invokes a Space/Node tool body
- **THEN** DSH returns its canonical `ABORTED_BEFORE_DISPATCH` result and no plugin resolver, approval, or Workspace request runs

#### Scenario: Recursive browse is cancelled

- **WHEN** `exec.signal` aborts during pagination or recursive traversal
- **THEN** the active HTTP request observes the signal, traversal checks cancellation before starting further pages or descendants, and the tool fails with `workspace-operation-cancelled` without returning a partial success

#### Scenario: Read operation is stopped by owner disposal

- **WHEN** the Host owner signal aborts a list, browse, or find body during authenticated resolution, HTTP, pagination, or traversal
- **THEN** the body fails with `workspace-plugin-disposing`, emits no dependency cause, and remains tracked until it settles

#### Scenario: Mutation is cancelled before request dispatch

- **WHEN** an accepted Node mutation body observes `exec.signal` or the Host owner signal abort before starting its Workspace request
- **THEN** the tool sends no request and fails with `workspace-operation-cancelled` or `workspace-plugin-disposing` respectively

#### Scenario: Dispatched mutation returns an uncertain tool-owned failure

- **WHEN** a Node mutation may have reached the Server and Client Core returns `workspace-result-unknown`, including after caller cancellation or owner disposal
- **THEN** the final tool result remains `workspace-result-unknown` and the tool does not retry automatically
- **AND** the wrapper does not replace that tool-owned failure with `workspace-operation-cancelled`, `workspace-plugin-disposing`, or a success

#### Scenario: Caller cancels while a dispatched mutation later confirms success

- **WHEN** Client Core confirms a Node mutation and returns success after or concurrently with the original caller signal aborting
- **THEN** DSH rc.2 replaces the final tool outcome with canonical `ABORTED` rather than exposing the Core success
- **AND** the mutation's total finalizer preserves that registry-owned error identity while rendering fixed guidance to use `workspace_space_browse` or `workspace_space_find` to inspect the current Node state and never replay the mutation automatically

#### Scenario: Owner-only disposal races with a confirmed mutation

- **WHEN** the Host owner signal aborts without aborting ToolRuntime's original caller signal and Client Core confirms the dispatched Node mutation
- **THEN** the accepted body may return the confirmed success while owner disposal drains it
- **AND** if Core cannot confirm the result, the final tool result remains `workspace-result-unknown`

#### Scenario: Host is disposed with accepted calls

- **WHEN** the plugin fiber is disposed while a Space/Node tool is in authenticated resolution, HTTP, read-back, pagination, or recursive traversal
- **THEN** the owner unregisters the seven tools and mutation approval policy, rejects new bodies, aborts owner-controlled I/O, and waits for all accepted bodies to settle before disposal returns
- **AND** no traversal promise, request, listener, timer, Job, or cached Workspace result survives disposal

### Requirement: Installed package preserves the tool surface

The prebuilt `dsh-univer-work` tarball MUST inline every reachable private Client Core Space/Node module while keeping exact published DSH/Cordis runtime dependencies external, and MUST register the same seven tools and approval/lifecycle behavior outside the monorepo checkout.

#### Scenario: Packed artifact is inspected

- **WHEN** package verification inspects the built Host entry and manifest
- **THEN** no bare `@univerjs/univer-workspace-client-core` runtime import, workspace dependency, CLI source import, Server source import, worker, native binding, render asset, Web Client, Skill, or later-change resource is present

#### Scenario: Installed tool transcript is exercised

- **WHEN** a keyless tarball smoke installs the plugin in an isolated local profile and exercises closed schemas, unknown-key rejection, read results, approval denial/allowance, allowlisted/unlisted Workspace failures, pre-dispatch/body/owner cancellation, caller-aborted late mutation success, dispatched mutation uncertainty, and disposal
- **THEN** the transcript preserves DSH `ABORTED` for the caller-aborted late success, includes fixed browse/read-back and no-replay guidance, preserves tool-owned `workspace-result-unknown`, and proves invalid mutations request no approval
- **AND** all seven tools preserve their source behavior; approval interactions/events, failure/result content and metadata, plugin-owned contexts, and plugin logs contain no copied credential or rejected argument
- **AND** Native `tool/call.arguments`, Code Mode `tool/code-dispatch-start.arguments`, and settled `tool/code-dispatch.arguments` remain outside that non-reflection guarantee
