## ADDED Requirements

### Requirement: Space and Node operation cancellation

Workspace Client Core SHALL let a Node-hosted Client Shell supply an optional `AbortSignal` to Space list/browse/find and Node create/rename/move/Trash operations, MUST pass that signal to every HTTP request started by the operation, and MUST check it between pagination, recursive traversal, mutation, and read-back steps without changing callers that omit it.

#### Scenario: Space list is cancelled

- **WHEN** a Client Shell supplies a signal to Space list and it aborts during authenticated HTTP resolution or the list request
- **THEN** no later request begins, the active request observes the signal when one exists, and the operation returns the existing request failure semantics without a partial Space result

#### Scenario: Browse or find is cancelled during traversal

- **WHEN** a supplied signal aborts during a cursor page or between recursive Node directories
- **THEN** the current request observes the signal, traversal starts no further page or child request, and the operation returns no partial Node list

#### Scenario: Create or Trash is cancelled

- **WHEN** a supplied signal aborts after a create or Trash request may have reached the Server
- **THEN** the operation preserves its existing `workspace-result-unknown` semantics and does not replay the mutation

#### Scenario: Rename or move is cancelled

- **WHEN** a supplied signal aborts during rename or move, including its result-unknown read-back path
- **THEN** every request already started observes the signal, no new request starts after cancellation, and Client Core returns a Node result only if the existing read-back behavior had already confirmed the requested state
- **AND** this Core result does not promise that a Client Shell such as DSH will expose the success after its own caller signal aborts

#### Scenario: Existing CLI call omits a signal

- **WHEN** Workspace CLI calls Space list/browse/find or Node create/rename/move/Trash through the existing forms without a signal
- **THEN** authenticated HTTP resolution, endpoints, traversal/filter order, response parsing, Node-name normalization, mutation/read-back behavior, command output, error codes, and package-installed behavior remain unchanged
