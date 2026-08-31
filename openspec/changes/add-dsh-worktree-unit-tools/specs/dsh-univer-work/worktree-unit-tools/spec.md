## Purpose

定义 Host-only `dsh-univer-work` 的 Worktree、Worktree Unit 与 review handoff surface，使 Agent 能以稳定、结构化、可授权且可取消的 DSH-native 操作建立和管理隔离草稿，并通过随包 core Skill 遵守 Workspace 的任务与人工 review 工作流。

## ADDED Requirements

### Requirement: Stable Worktree discovery tools

The Client Shell SHALL expose `workspace_worktree_list` and `workspace_worktree_get` as separate schema-validated DSH tools with closed canonical outputs.

#### Scenario: Worktrees are listed

- **WHEN** `workspace_worktree_list` receives optional `view: active | processed`, optional `scope: user | space`, and optional non-empty `space_id` valid for Space scope
- **THEN** it defaults the omitted view to `active` and returns `{ worktrees }` in Server order with each complete validated Worktree and its Units

#### Scenario: One Worktree is read

- **WHEN** `workspace_worktree_get` receives a non-empty `worktree_id`
- **THEN** it returns `{ worktree }` only when the response identity equals that ID

#### Scenario: List scope is inconsistent

- **WHEN** list supplies `space_id` without `scope: space`, or supplies any empty ID
- **THEN** it fails with stable invalid-argument information before authenticated resolution or Workspace HTTP

### Requirement: Stable Worktree mutation tools

The Client Shell SHALL expose `workspace_worktree_create` and `workspace_worktree_update` as separate DSH tools that preserve Core normalization, stable identity, strict response parsing, and result-unknown behavior.

#### Scenario: User Worktree is created

- **WHEN** create receives a non-empty `name`, `scope: user`, and optional non-empty `idempotency_key`
- **THEN** it creates one User Worktree and returns `{ worktree }` with the validated identity
- **AND** it rejects `space_id` or `visibility` because those fields belong to Team Worktrees

#### Scenario: Team Worktree is created

- **WHEN** create receives a non-empty `name`, `scope: space`, required non-empty `space_id`, optional `visibility: private | space`, and optional non-empty `idempotency_key`
- **THEN** it requests one Team Worktree using `private` when visibility is omitted and returns the Server's strictly parsed `{ worktree }`

#### Scenario: Worktree metadata is updated

- **WHEN** update receives a non-empty `worktree_id` and at least one of a non-empty `name` or `visibility: private | space`
- **THEN** it performs one update and returns `{ worktree }` only for the requested identity

#### Scenario: Worktree mutation result is unknown

- **WHEN** create exhausts its same-identity Core attempts or update loses an accepted response
- **THEN** the tool fails with `workspace-result-unknown`, preserves only safe operation identity, and does not claim success or start a shell-level retry

### Requirement: Stable Worktree lifecycle tools

The Client Shell SHALL expose `workspace_worktree_ready`, `workspace_worktree_reopen`, `workspace_worktree_merge`, and `workspace_worktree_discard` as four distinct tools that preserve the authoritative Worktree state machine, transition identity, read-back, and result-unknown semantics.

#### Scenario: Worktree enters review

- **WHEN** ready receives a draft `worktree_id`
- **THEN** it returns `{ worktree }` only after the requested Worktree is confirmed in `ready` state

#### Scenario: Same-task rework resumes

- **WHEN** reopen receives a ready `worktree_id`
- **THEN** it returns `{ worktree }` only after that Worktree is confirmed in `draft` state

#### Scenario: Worktree is merged or discarded

- **WHEN** separately approved merge or discard receives a non-empty `worktree_id` in a Core-allowed state
- **THEN** it returns `{ worktree }` only after identity and terminal state are confirmed and retains the existing stable idempotency identity where Core defines one

#### Scenario: Lifecycle transition is invalid

- **WHEN** ready, reopen, merge, or discard is requested from a state that does not allow it
- **THEN** the tool fails with `workspace-lifecycle-invalid` before sending the transition request

#### Scenario: Lifecycle result cannot be confirmed

- **WHEN** a transition response is lost and read-back does not confirm the requested state
- **THEN** the tool fails with `workspace-result-unknown` and never automatically replays that transition

### Requirement: Stable Worktree Unit tools

The Client Shell SHALL expose `workspace_unit_list`, `workspace_unit_add`, and `workspace_unit_create` as separate DSH tools that preserve Worktree membership, stable identity, source/target, type, and result-unknown semantics.

#### Scenario: Worktree Units are listed

- **WHEN** Unit list receives a non-empty `worktree_id`
- **THEN** it returns `{ units }` only when every Unit belongs to that Worktree

#### Scenario: Existing Resource is staged

- **WHEN** Unit add receives non-empty `worktree_id` and `resource_id`
- **THEN** it returns `{ unit }` only for a trunk-backed Unit of that Resource with no activation target and uses the existing stable Worktree/Resource identity

#### Scenario: Worktree-local Unit is created

- **WHEN** Unit create receives non-empty Worktree, target Space and name, a supported `sheet | doc | slide | base | board` type, optional non-empty parent Node, and optional non-empty idempotency key
- **THEN** it returns `{ unit }` only for a Worktree-local Unit whose Worktree, type, name, target Space, and parent match the request

#### Scenario: Unsupported initial content is supplied

- **WHEN** a caller supplies `initial_data` or any undeclared content payload to Unit create
- **THEN** it fails at the closed tool boundary without reaching credentials or HTTP
- **AND** later content authoring remains owned by its dedicated Change

### Requirement: Authenticated review URL tool

The Client Shell SHALL expose `workspace_worktree_review_url` to validate a Worktree Unit and construct its Browser review URL from the origin in the same authenticated operation, without opening a browser or accepting a caller-selected origin.

#### Scenario: Review URL is constructed

- **WHEN** the tool receives non-empty `worktree_id` and optional non-empty `unit_id`
- **THEN** it returns `{ review }` containing the validated Worktree ID, Unit ID, Unit type, and `/worktrees?...&view=agent` HTTP(S) URL rooted at the current authenticated grant origin

#### Scenario: Worktree requires explicit Unit selection

- **WHEN** `unit_id` is omitted and the Worktree contains zero or multiple Units
- **THEN** the tool fails with `workspace-open-unit-required` and does not choose a Unit

#### Scenario: Caller supplies a viewer origin

- **WHEN** direct execution supplies `viewer_url`, `origin`, or another undeclared URL field
- **THEN** the tool rejects it before credential resolution and does not reflect the value

### Requirement: Closed parameter, output, and rendering contracts

Every Worktree/Unit/review tool MUST declare only parameters for its one operation, MUST reject unsupported or cross-field-invalid input, and MUST validate its complete canonical value before rendering or returning it to Native or Code Mode.

#### Scenario: Tool catalog is assembled

- **WHEN** DSH assembles Native schemas or the Code Mode SDK
- **THEN** it exposes exactly the twelve snake_case names with root `additionalProperties: false`, exact operation fields, and enums for view, scope, visibility, Worktree state, Unit type/source/change/merge/activation state
- **AND** no tool accepts a generic action, credential, cookie, password, local path, command, arbitrary JSON, content script, or viewer origin

#### Scenario: Direct execution supplies an unknown key

- **WHEN** any tool receives an own parameter key outside its declaration
- **THEN** a read/review body gate, routine mutation body gate, or terminal mutation pre-approval gate returns stable invalid-argument failure before authenticated resolution or HTTP
- **AND** failure content does not echo the rejected key or value

#### Scenario: Mutation parameters are invalid before effects

- **WHEN** any of the eight mutation tools receives an unknown key, wrong primitive type, invalid enum, blank required identity, or invalid cross-field combination
- **THEN** its operation validator fails with fixed `workspace-argument-invalid` metadata before credential resolution or HTTP, and merge/discard fail before their policy returns `ask`
- **AND** no approval interaction/event or Workspace request occurs, and no result/failure, approval, or plugin-owned payload copies the rejected key or value
- **AND** only Native `tool/call.arguments`, or Code Mode `tool/code-dispatch-start.arguments` plus settled `tool/code-dispatch.arguments = normalized.logged`, may retain the original arguments as DSH-owned records

#### Scenario: Valid mutation enters its body

- **WHEN** a routine mutation reaches its body directly, or merge/discard receives `allowed-once`
- **THEN** its body defensively applies the same operation validator before calling Core and receives canonical typed input

#### Scenario: Canonical output is invalid

- **WHEN** a body returns a missing, broadened, non-JSON, wrong-identity, or invalid-state Worktree, Unit, or review field
- **THEN** DSH rejects it as invalid tool output before rendering or Code Mode receives it

#### Scenario: Valid output is rendered

- **WHEN** a Worktree/Unit/review tool succeeds
- **THEN** model-visible text summarizes only stable identities, state, target, or URL from the validated canonical value
- **AND** the complete lossless canonical value remains available without parsing prose

### Requirement: Draft workflow mutations execute without approval

The Client Shell MUST execute Worktree create/update/ready/reopen and Unit add/create without requesting DSH approval, MUST request one secret-safe `ask` only for merge and discard after operation-specific validation, MUST reuse every mutation validator in its body, and MUST delegate the four read/review tools to the existing policy chain.

#### Scenario: Routine Worktree mutation does not ask

- **WHEN** Worktree create/update/ready/reopen or Unit add/create receives valid arguments
- **THEN** DSH invokes its body without creating an approval interaction or event
- **AND** the body validates before credential resolution and performs only its declared Core operation

#### Scenario: Merge or discard is presented for approval

- **WHEN** merge or discard reaches the approval policy
- **THEN** the approval request identifies the exact terminal operation with fixed wording that contains no caller-supplied value
- **AND** neither action is reachable through update, a generic lifecycle action, or another tool name

#### Scenario: Invalid mutation has no remote effect

- **WHEN** an operation validator rejects mutation arguments
- **THEN** the tool fails with stable invalid-argument metadata before credential resolution or HTTP, and no approval interaction or event is created
- **AND** its fixed failure contains no argument-derived detail

#### Scenario: Terminal approval fails closed

- **WHEN** merge or discard approval is rejected, cancelled, unavailable, or has no channel
- **THEN** that terminal mutation fails before authenticated resolution or any Workspace request

### Requirement: Workspace failure fidelity and secrecy

The Client Shell MUST preserve only frozen allowlisted Workspace codes and exact JSON-safe operation detail, and MUST map every unknown dependency failure or unlisted code to `workspace-operation-failed` with fixed operation text and no source material.

#### Scenario: Recognized Workspace error crosses the boundary

- **WHEN** Core raises `workspace-argument-invalid`, `workspace-invalid-response`, `workspace-result-mismatch`, `workspace-result-unknown`, `workspace-lifecycle-invalid`, `workspace-viewer-url-invalid`, `workspace-open-unit-required`, `workspace-unit-not-found`, `workspace-origin-mismatch`, `workspace-authentication-required`, `workspace-request-invalid`, or `workspace-redirect-refused`, or the Server raises `UNAUTHENTICATED`, `INVALID_INPUT`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, or `INTERNAL_ERROR`
- **THEN** the failure contains a fixed operation message and deterministic envelope with that code and only allowlisted operation identities/state
- **AND** DSH failure metadata retains the same stable code

#### Scenario: Mutation argument validation fails

- **WHEN** untrusted mutation arguments fail exact-key, type, enum, required-field, or cross-field validation
- **THEN** the failure metadata is `workspace-argument-invalid` with a fixed operation message and no detail
- **AND** the original argument names and values do not cross into result/failure, approval, or plugin-owned event content
- **AND** this does not alter Native `tool/call.arguments` or the two Code Mode start/settled dispatch argument records owned by DSH

#### Scenario: Error material is unsafe or unlisted

- **WHEN** a resolver, transport, parser, Server envelope, cause, or detail includes another code, password, cookie, `Set-Cookie`, grant payload, initial content, or non-JSON value
- **THEN** the tool returns `workspace-operation-failed` or omits the unsafe detail without emitting the original code, message, cause, or value

### Requirement: Worktree and Unit cancellation and lifecycle

Every Worktree/Unit/review tool MUST fuse caller and Host-owner cancellation, pass it through the complete Core operation, and remain tracked until all owned work settles. The existing fiber owner MUST stop registration, abort owner-controlled work, and drain accepted bodies before disposal returns.

#### Scenario: Caller cancels before body dispatch

- **WHEN** the original caller signal is aborted before ToolRuntime invokes a body
- **THEN** DSH returns `ABORTED_BEFORE_DISPATCH` and no plugin resolver, approval, Skill lookup, or Workspace request runs

#### Scenario: Read is cancelled after dispatch

- **WHEN** caller cancellation or owner disposal occurs during list/get/Unit list/review resolution or HTTP
- **THEN** the active request observes the signal, no partial success is returned, and the body uses fixed `workspace-operation-cancelled` or `workspace-plugin-disposing` failure as applicable

#### Scenario: Cancellation stops stable-identity retry

- **WHEN** a create/add operation has made an attempt and caller cancellation or owner disposal occurs before another Core attempt
- **THEN** no new request starts after cancellation
- **AND** a potentially accepted write remains `workspace-result-unknown` with the same public identity instead of being replayed or reported as cancelled

#### Scenario: Dispatched mutation remains uncertain

- **WHEN** update, lifecycle, Unit add/create, or Worktree create may have reached the Server and Core cannot confirm its outcome
- **THEN** the tool retains `workspace-result-unknown`, starts no shell-level retry, and gives operation-specific get/list guidance without instructing automatic replay

#### Scenario: Caller cancels while mutation later confirms success

- **WHEN** Core confirms a mutation after or concurrently with the original caller signal aborting
- **THEN** DSH rc.2 returns canonical `ABORTED` rather than the Core success
- **AND** final content preserves that error identity and tells the caller to inspect with Worktree get/list or Unit list before deciding any next action

#### Scenario: Owner-only disposal races with confirmed mutation

- **WHEN** only the Host-owner signal aborts and Core already confirms the mutation
- **THEN** the accepted body may return confirmed success while disposal drains it
- **AND** an unconfirmed write remains `workspace-result-unknown`

#### Scenario: Host disposes the capability

- **WHEN** the plugin fiber is disposed with tools, the core Skill, approvals, credential reads, HTTP, retries, or read-back active
- **THEN** it unregisters the twelve tools, two-name terminal approval policy, and `core` Skill, rejects new bodies, aborts owner-controlled I/O, and waits for every accepted body to settle
- **AND** no request, retry, read-back, listener, Skill registration, timer, Job, or cached Workspace result survives disposal

### Requirement: Bundled core workflow Skill

The Client Shell SHALL package and explicitly register one static model- and user-invocable Skill named `core` whose summary and body teach the available DSH-native Workspace task workflow without depending on Workspace CLI commands.

#### Scenario: Agent loads the core Skill

- **WHEN** the DSH Skill catalog and `skill` tool resolve the packaged `core` entry
- **THEN** they return the version-matched body covering current authentication, stable identity discovery, new-Worktree-per-task, same-task rework, Unit staging/creation, ready/read-back, review URL, and user-authorized merge/discard rules
- **AND** every executable example references only tool names delivered by Changes 2 through 4

#### Scenario: Skill avoids premature capabilities

- **WHEN** the body is inspected in this Change
- **THEN** it does not claim Blob/file, content authoring, execute/inspect, Office, Typst, SVG, screenshot/lint, API/resource discovery, the remaining seven Skills, Web, or non-local execution support

#### Scenario: Skill registration is disposed

- **WHEN** the owning Cordis fiber is disposed
- **THEN** the `core` runtime contribution disappears from the catalog and no package filesystem watcher or dynamic provider remains

### Requirement: Installed package preserves tools and Skill

The prebuilt tarball MUST inline reachable private Worktree/Unit/review Core code, include the static core Skill, retain exact published DSH/Cordis dependencies externally, and reproduce the same registrations outside the monorepo checkout.

#### Scenario: Packed artifact is inspected

- **WHEN** package verification inspects built entries, manifests, and files
- **THEN** no bare private Core, workspace dependency, CLI/Server source import, worker, native binding, render asset, Web Client, later Skill, or later capability enters the runtime closure

#### Scenario: Installed tool and Skill transcript is exercised

- **WHEN** a keyless tarball smoke installs the plugin into an isolated local profile
- **THEN** it observes all twelve closed-schema tools and the loadable `core` Skill, covers invalid mutation rejection before effects, routine mutation execution without approval, terminal approval deny/allow, representative read, lifecycle, Unit, review, error, cancellation/result-unknown, and normal disposal outcomes
- **AND** Native invalid-policy tests find the sentinel in `tool/call.arguments`, while Code Mode tests find it in both `tool/code-dispatch-start.arguments` and settled `tool/code-dispatch.arguments = normalized.logged`
- **AND** the sentinel never appears in approval interaction/events, result/failure, or plugin-owned payloads; the smoke also finds no credential, blind-retry instruction, CLI command, or adjacent checkout path in plugin-owned output or package content
