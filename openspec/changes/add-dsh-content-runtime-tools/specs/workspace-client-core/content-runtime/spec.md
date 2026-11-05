## ADDED Requirements

### Requirement: Content source and execution cancellation

Workspace Client Core SHALL let a Node-hosted Client Shell supply an optional `AbortSignal` to Trunk/Worktree target resolution and content execution, MUST pass it to every supported authenticated request and runtime operation, and MUST leave callers that omit it unchanged.

#### Scenario: Target resolution is cancelled

- **WHEN** a supplied signal aborts during Worktree lookup, Trunk Unit-type discovery, Snapshot read, or editable-target validation
- **THEN** the active request observes the signal, no later target request starts, and no partial runtime target is returned

#### Scenario: Execution is cancelled before runtime work

- **WHEN** the signal is aborted before editable target resolution or prepared write execution begins
- **THEN** no worker execution, image upload, mutation replacement, or commit starts

#### Scenario: Existing caller omits optional controls

- **WHEN** Workspace CLI or another existing caller invokes target/source or content-execution methods without a signal or value budget
- **THEN** target authority, Unit-type probing, Draft validation, prepared bindings, runtime result parsing, errors and outputs remain unchanged

### Requirement: Worker-backed operation cancellation, value budget, and quiescence

Workspace Client Core MUST accept an optional signal for read and write execution, MUST let a write caller supply optional canonical value byte/depth limits, MUST check cancellation before and after each separable runtime step, and MUST await any in-flight frozen-SDK worker operation before the public operation settles. Other operations outside inspection/execute remain outside this Change.

#### Scenario: Operation waits in the runtime-key queue

- **WHEN** the supplied signal aborts while another operation for the same runtime key is active
- **THEN** Core waits for the preceding operation's owned work to settle, then starts no acquire, synchronize, execute, replacement or commit for the cancelled operation

#### Scenario: Worker operation cannot be interrupted

- **WHEN** the signal aborts during acquire, state, pull, read/write execute, replacement, or commit whose frozen pool API has no signal input
- **THEN** Core awaits that operation, observes cancellation immediately afterward, starts no later step, and releases or invalidates the lease according to whether it is safely reusable
- **AND** Core does not return while that worker operation continues in the background

#### Scenario: Write value exceeds the caller budget

- **WHEN** a write caller supplies `maxValueBytes` and `maxValueDepth` and worker execution returns a non-lossless-JSON value, a value deeper than the supplied depth, or canonical JSON larger than the supplied byte count
- **THEN** Core returns the applicable stable result/limit error before embedded-image upload, mutation replacement or commit
- **AND** it does not truncate the value, dispatch a remote content mutation or report a post-commit ordinary size failure

#### Scenario: Credential or license resolution is cancelled

- **WHEN** a supplied signal aborts before or during Client Shell credential/license resolution for a new worker
- **THEN** no later worker acquisition starts and rejected dependency material is not included in the authentication/license error

#### Scenario: Runtime owner closes during work

- **WHEN** the Client Shell closes the runtime owner while an operation is queued or active
- **THEN** pool and worker work settle before close returns and no new operation becomes active on that closed owner

### Requirement: Embedded-image cancellation

Workspace Client Core MUST pass the optional write signal to embedded-image uploads, MUST stop later uploads and commit after observed cancellation, and MUST preserve existing best-effort fallback for ordinary unsignalled or non-cancelled upload failure.

#### Scenario: Cancellation precedes image upload

- **WHEN** the signal aborts after mutations are captured but before the next supported image upload dispatches
- **THEN** no upload or later commit starts and the captured runtime is not reused as a clean runtime

#### Scenario: Upload result becomes unknown under cancellation

- **WHEN** an image upload may have reached Workspace and abort produces a result-unknown failure
- **THEN** Core propagates `workspace-result-unknown`, stops later uploads and changeset commit, and does not silently convert that cancellation path to BASE64 fallback

#### Scenario: Confirmed upload precedes later cancellation

- **WHEN** at least one image upload confirms and the supplied signal aborts before the next upload, mutation replacement or first commit
- **THEN** Core returns `workspace-content-partial-side-effect` with structured effect, confirmed-upload count, `contentCommitted: false` and authoritative target, invalidates the dirty lease, and starts no later step
- **AND** confirmed uploaded objects remain unreferenced orphan candidates; Core performs no compensating delete, re-upload, image re-externalization or Facade replay

#### Scenario: Owner close follows a confirmed upload

- **WHEN** a Client Shell owner aborts the supplied operation after one upload confirms
- **THEN** the same partial-side-effect outcome and no-later-step rules apply, and runtime close awaits lease invalidation and operation settlement

#### Scenario: Ordinary image upload fails

- **WHEN** an image upload fails without an observed supplied-signal cancellation
- **THEN** Core preserves the original BASE64 reference byte-for-byte and continues the existing commit pipeline

### Requirement: Cancellation-safe changeset commit

Workspace Client Core MUST stop new commit attempts after supplied-signal cancellation, MUST preserve uncertain dispatched writes, and MUST never replay Facade execution or embedded-image externalization to recover a commit result.

#### Scenario: Cancellation precedes first commit

- **WHEN** the signal aborts after local mutation replacement but before the first changeset commit dispatches
- **THEN** no commit request starts, the lease is invalidated, and Core does not claim a content change

#### Scenario: Cancellation follows retry or unknown

- **WHEN** commit returns retry or unknown and the signal aborts before the next bounded attempt
- **THEN** Core starts no next attempt and returns `workspace-result-unknown` with the existing pending changeset and safe target identity
- **AND** it does not re-execute Facade code or re-upload embedded images

#### Scenario: Commit is unknown after confirmed image uploads

- **WHEN** one or more uploads confirmed, pending mutations were replaced and a commit returns unknown or may have dispatched under cancellation
- **THEN** Core returns structured `workspace-result-unknown` for the changeset rather than the earlier partial-upload code
- **AND** it starts no further upload, replacement, commit attempt after cancellation, Facade replay or image re-externalization

#### Scenario: Commit is confirmed before cancellation is observed

- **WHEN** Core receives and validates a confirmed commit before observing concurrent cancellation
- **THEN** Core may return the existing confirmed revision result
- **AND** this does not promise that a caller runtime such as DSH will expose late success after its own caller signal aborts

#### Scenario: Unsignalled commit uses existing attempts

- **WHEN** an existing caller omits a signal and commit returns retry or unknown
- **THEN** Core retains the existing same-pending-changeset three-attempt behavior, confirmed result, terminal errors and `workspace-submit-retry-exhausted` outcome

### Requirement: Workspace CLI content-runtime compatibility after optional signals

Workspace CLI MUST retain its current daemon wire, target/content commands, inspection results, runtime reuse, worker artifact and package-installed behavior after Client Core adds optional signal support.

#### Scenario: CLI daemon operations omit signals

- **WHEN** CLI maps its existing content runtime operations through daemon RPC
- **THEN** the request payloads contain only the existing code and serialized target fields and no signal, value budget or DSH type crosses the wire

#### Scenario: CLI content and inspection cases run

- **WHEN** existing execute, inspect, exchange, screenshot and other runtime consumers run without a signal
- **THEN** their target selection, synchronization, output, error, mutation, retry and runtime lifecycle behavior remain compatible

#### Scenario: Installed CLI worker runs

- **WHEN** the existing CLI package is built and its worker-backed smoke runs outside the monorepo
- **THEN** its daemon/worker entry, runtime child, native dependency closure and self-contained behavior remain unchanged
