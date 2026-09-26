## ADDED Requirements

### Requirement: Worktree, Unit, and review operation cancellation

Workspace Client Core SHALL let a Node-hosted Client Shell supply an optional `AbortSignal` to Worktree list/get/create/update/lifecycle, Worktree Unit list/add/create, and review URL operations, MUST pass that signal to every HTTP request, and MUST stop sequential retry or read-back work after cancellation without changing callers that omit it.

#### Scenario: Worktree or Unit read is cancelled

- **WHEN** a supplied signal aborts during authenticated resolution, Worktree list/get, Unit list, or review URL membership lookup
- **THEN** the active request observes the signal, no later request starts, and the operation returns no partial Worktree, Unit, or URL result

#### Scenario: Cancellation precedes a mutation request

- **WHEN** the supplied signal is already aborted before Worktree create/update/lifecycle or Unit add/create dispatches its mutation request
- **THEN** no mutation request starts and Core does not synthesize a successful result

#### Scenario: Stable-identity mutation is cancelled after an uncertain attempt

- **WHEN** Worktree create or Unit add/create has made an uncertain attempt and the supplied signal aborts before the next same-identity attempt
- **THEN** Core starts no further attempt and returns `workspace-result-unknown` with its existing bounded public identity

#### Scenario: Lifecycle read-back is cancelled

- **WHEN** a Worktree transition may have reached the Server and its result-confirmation read-back is aborted before confirmation
- **THEN** Core returns `workspace-result-unknown`, does not replay the transition, and does not claim that the Worktree reached the requested state

#### Scenario: Confirmed result races with cancellation

- **WHEN** Core has already validated a Worktree or Unit mutation result while the supplied signal aborts concurrently
- **THEN** Core may return that validated result
- **AND** this Core result does not promise that a Client Shell such as DSH will expose the success after its own caller signal aborts

#### Scenario: Existing CLI calls omit signals

- **WHEN** Workspace CLI calls all existing Worktree, Unit, and open forms without a signal
- **THEN** authenticated resolution, query/body mapping, response parsing, stable identity and retry count, lifecycle preconditions/read-back, review URL selection, command output, error codes, and package-installed behavior remain unchanged
