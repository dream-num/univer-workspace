## ADDED Requirements

### Requirement: Optional Office operation controls and compatibility

Workspace Client Core SHALL let a Node-hosted Client Shell supply optional cancellation, input/output budget and atomic-publication controls to Office import/export while preserving all existing behavior for callers that omit them.

#### Scenario: Existing CLI omits Office controls

- **WHEN** Workspace CLI calls import/export through the existing inputs without an operation-control object
- **THEN** suffix/type/name rules, validation order, direct path conversion, overwrite behavior, Unit create/target/runtime inputs, result fields, errors, command output, daemon payload and installed package behavior remain unchanged

#### Scenario: DSH supplies operation controls

- **WHEN** a local DSH Client Shell supplies a signal, fixed budgets and atomic export controls
- **THEN** Core applies only those controls around the existing authoritative Office workflow and no DSH type or service enters Client Core

### Requirement: Cancellation-safe and bounded Office import

Workspace Client Core MUST accept optional signal and source/converted-UnitData limits for Office import. With controls, it MUST reuse Change 5's signal-aware `inspectSource`/`openSource` stream, collect bounded actual bytes, and call published `importBuffer`; without controls it MUST preserve the CLI's direct `importFile` path. It MUST check controls before the next separable step, await an uninterruptible native conversion, and pass the signal to Worktree Unit create without changing stable identity or post-dispatch result semantics.

#### Scenario: Import is cancelled before conversion

- **WHEN** the signal aborts during source inspection or before native conversion begins
- **THEN** no conversion or Unit create starts

#### Scenario: Source exceeds the caller limit

- **WHEN** actual bytes produced by the regular-source stream reach the supplied maximum plus one
- **THEN** Core stops collecting, closes the source and fails with the stable Office limit error before `importBuffer`, native conversion and Unit create

#### Scenario: Streamed source length changes after inspection

- **WHEN** bytes produced by Change 5 `openSource` grow beyond the inspected size, truncate below it, or reach the supplied maximum plus one
- **THEN** Core closes the stream and fails before `importBuffer` under the existing byte-count or Office budget contract

#### Scenario: Same-length path identity changes concurrently

- **WHEN** another process replaces the inspected path or swaps a symlink to a different regular file with the same byte length before `openSource` opens its path-based stream
- **THEN** Core still bounds the actual stream before `importBuffer` but does not promise to detect that identity change, matching Change 5's accepted lack of a cross-process `openat` or directory-handle fence

#### Scenario: Source reading is cancelled

- **WHEN** the signal aborts while Core collects actual source bytes
- **THEN** Core stops and closes the reader, starts no native conversion or Unit create, and returns no partial buffer

#### Scenario: Cancellation occurs during native conversion

- **WHEN** the signal aborts while the frozen converter is active
- **THEN** Core awaits conversion, observes cancellation afterward, starts no Unit create and returns no confirmed import

#### Scenario: Final imported UnitData exceeds the caller limit

- **WHEN** converted UnitData after explicit-name application exceeds supplied canonical byte/depth limits
- **THEN** Core fails before Unit create without truncating the data

#### Scenario: Unit create may have dispatched

- **WHEN** cancellation races a create request that Core cannot confirm
- **THEN** existing same-identity recovery/result-unknown behavior remains authoritative, no additional create begins after cancellation and conversion is never replayed

#### Scenario: Dispatched create returns mismatch or invalid response

- **WHEN** Unit create may have dispatched but Core rejects the response with `workspace-result-mismatch` or `workspace-invalid-response`
- **THEN** Core preserves the original non-confirmed failure and stable requested identity where safe, performs no automatic conversion/create replay, and does not report the Unit as confirmed or rolled back

#### Scenario: Unit create already confirms

- **WHEN** Core validates the requested Worktree-local Unit before observing concurrent cancellation
- **THEN** Core may return the existing committed result and leaves final caller-cancellation presentation to the Client Shell

### Requirement: Cancellation-safe bounded atomic Office export

Workspace Client Core MUST accept optional signal, UnitData budget and atomic-output controls for Office export, MUST resolve/export one authoritative Worktree target, MUST await native conversion, and when atomic output is requested MUST publish only complete bounded bytes through the shared private atomic file workflow.

#### Scenario: Target or runtime read is cancelled

- **WHEN** the signal aborts during Worktree target resolution, synchronization or UnitData export
- **THEN** active supported work observes it, no native conversion or local output starts, and no partial UnitData result is returned

#### Scenario: Worktree head advances before exact synchronization

- **WHEN** Core selects the current Worktree target once and the head advances before Change 6 runtime confirms the selected revision
- **THEN** synchronization fails with `workspace-result-mismatch` before UnitData export, native conversion or local output, and Core does not re-resolve the newer head or export the unconfirmed older revision

#### Scenario: Exact selected revision is synchronized

- **WHEN** Change 6 runtime confirms its base revision equals the once-selected target revision
- **THEN** Core exports UnitData only for that exact authoritative target

#### Scenario: Exported UnitData exceeds the caller budget

- **WHEN** runtime UnitData exceeds supplied canonical byte/depth limits
- **THEN** Core fails before native conversion and local output

#### Scenario: Cancellation occurs during native export conversion

- **WHEN** the signal aborts after native conversion begins
- **THEN** Core awaits conversion, starts no atomic write, discards the generated buffer after settlement and returns no confirmed output

#### Scenario: Native output exceeds the caller budget

- **WHEN** the generated Office buffer exceeds the supplied maximum
- **THEN** Core fails before creating or replacing the destination

#### Scenario: Atomic no-clobber succeeds

- **WHEN** complete output is within budget, cancellation is not observed and the destination remains absent
- **THEN** Core writes exact bytes to a private same-directory file, synchronizes and atomically publishes before returning the existing export result

#### Scenario: Atomic replacement is explicit

- **WHEN** atomic controls request force replacement
- **THEN** Core replaces the destination only after complete conversion/write/sync and keeps the prior destination on every earlier failure

#### Scenario: Cancellation precedes publication

- **WHEN** the signal aborts during private output writing or immediately before publication
- **THEN** Core performs non-cancellable close/unlink cleanup, leaves a prior destination unchanged and returns no confirmed output

#### Scenario: Publication already confirms

- **WHEN** atomic publication completes before concurrent cancellation is observed
- **THEN** Core may return the existing confirmed export result and leaves final caller-cancellation presentation to the Client Shell
