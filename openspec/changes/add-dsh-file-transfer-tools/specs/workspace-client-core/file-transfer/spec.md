## ADDED Requirements

### Requirement: File-transfer operation cancellation

Workspace Client Core SHALL let a Node-hosted Client Shell supply an optional `AbortSignal` to Blob metadata/upload/download and Asset download operations, MUST pass the signal through their HTTP, recovery, source-stream, destination-write, and atomic-publication steps, and MUST preserve existing callers and reliability behavior when the signal is omitted.

#### Scenario: Blob metadata is cancelled

- **WHEN** a Client Shell supplies a signal to Blob metadata retrieval and it aborts during authenticated resolution or HTTP
- **THEN** the active request observes the signal, no later request starts, and no partial Node/Resource result is returned

#### Scenario: Blob upload is cancelled before dispatch

- **WHEN** a supplied signal aborts during source inspection or between reserve, byte-upload, status, completion, and Resource read-back steps
- **THEN** the operation starts no later request or recovery attempt and returns no partial success

#### Scenario: Blob upload request may have completed

- **WHEN** a supplied signal aborts after a reserve, byte PUT, completion, status, or Resource read-back request may have reached the Server
- **THEN** the operation immediately returns `workspace-result-unknown` whose safe detail preserves `idempotencyKey`, the complete public upload intent, and every already known Upload Session identity such as `uploadId` and state
- **AND** it does not rethrow a transport-only unknown that loses that identity, convert the result to confirmed cancellation, or start another status, read-back, retry, completion, or recovery request

#### Scenario: Source stream is cancelled

- **WHEN** a signal aborts while Client Core streams a previously inspected Blob source
- **THEN** source reading stops, byte-size validation cannot report success, and the upload begins no later request

#### Scenario: Blob or Asset download is cancelled

- **WHEN** a signal aborts during metadata, signed-content resolution, response streaming, local writing, or before atomic publication
- **THEN** active cancellable work observes it, no later stage begins, non-cancellable cleanup closes the handle and removes the temporary output, and the prior destination remains unchanged

#### Scenario: Atomic publication already completed

- **WHEN** cancellation races an atomic destination publication that Client Core has completed
- **THEN** Client Core may return the confirmed output because it does not own the Client Shell's final cancellation presentation
- **AND** a caller such as DSH may replace that late success with its own canonical aborted outcome

#### Scenario: Existing CLI call omits a signal

- **WHEN** Workspace CLI calls Blob metadata/upload/download or Asset download through the existing forms without a signal
- **THEN** authenticated HTTP timing, endpoints, stable idempotency and bounded recovery, response parsing, signed URL cookie isolation, source validation, exact-byte output, overwrite rules, result fields, error codes, command behavior, and package-installed behavior remain unchanged
