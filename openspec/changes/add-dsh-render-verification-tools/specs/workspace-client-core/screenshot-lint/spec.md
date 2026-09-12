## ADDED Requirements

### Requirement: Render Unit loading cancellation

Workspace Client Core SHALL let a Node-hosted Client Shell supply an optional `AbortSignal` while loading a render Unit, MUST pass it through source opening, Trunk/Worktree/reference target resolution, UnitData export and Worktree Asset resolution, and MUST leave callers that omit it unchanged.

#### Scenario: Cancellation precedes render Unit loading

- **WHEN** a supplied signal is aborted before source, target, UnitData or Asset work starts
- **THEN** no later load step starts and no partial render Unit is returned

#### Scenario: Cancellation occurs during a reference or Asset read

- **WHEN** a supplied signal aborts while a Host, formula-reference, Embed child or Worktree image is being resolved
- **THEN** Core awaits the active supported operation, starts no next reference/Asset/browser step and returns no partially rewritten render copy

#### Scenario: Existing caller omits the signal

- **WHEN** Workspace CLI loads the same Trunk or Worktree render Unit without a signal
- **THEN** target/reference order, UnitData validation, Worktree Asset rewrite and errors remain unchanged

### Requirement: Screenshot and layout operation cancellation

Workspace Client Core MUST propagate the optional signal from render Unit loading into browser construction and screenshot or Slide layout work, and MUST await browser close before success, failure or cancellation settles.

#### Scenario: Cancellation precedes browser creation

- **WHEN** the signal aborts after render Unit loading but before browser creation
- **THEN** no browser starts and no screenshot or layout operation runs

#### Scenario: Browser operation is cancelled

- **WHEN** the signal aborts during screenshot capture or Slide layout capture
- **THEN** the browser operation observes or is checked against the signal, no later browser/file step starts, and runtime close completes before Core settles

#### Scenario: Browser close cannot be interrupted

- **WHEN** cancellation is already visible while browser close is in progress
- **THEN** Core still awaits complete close and does not leave a page server or browser process behind

### Requirement: Cancellation-aware screenshot PNG publication

Workspace Client Core SHALL accept an optional signal when writing screenshot images, MUST preserve private same-directory temporary files and exclusive non-replacing publication, and MUST report confirmed partial output to signalled callers without rolling it back.

#### Scenario: Cancellation precedes first publication

- **WHEN** the supplied signal aborts before any destination link confirms
- **THEN** Core commits no new destination, removes private temporary state and starts no next output

#### Scenario: A prior output committed before cancellation

- **WHEN** one or more output links confirm and cancellation becomes visible before the next output completes
- **THEN** Core raises `workspace-screenshot-output-partial` with exactly `{ totalOutputCount, committedOutputCount, committedOutputs: [{ name, location }], causeCode: "ABORTED" }`
- **AND** Core leaves those confirmed files intact, starts no next output and performs no retry, recapture, overwrite or compensating delete

#### Scenario: A later signalled write fails after a commit

- **WHEN** a supplied-signal writer has committed one or more outputs and a later output encounters another failure
- **THEN** Core preserves the same exact partial-output shape and uses only `workspace-screenshot-output-exists` for an exclusive-link destination race or `workspace-screenshot-output-failed` for every other post-commit failure as `causeCode`
- **AND** `totalOutputCount` and `committedOutputCount` are non-negative integers, the committed array length equals `committedOutputCount`, every name/location is Core-owned canonical identity, and no raw message, cause, errno, stack or unknown field crosses the boundary

#### Scenario: Every output commits before cancellation is observed

- **WHEN** all exclusive links confirm before Core observes the supplied signal
- **THEN** Core may return the existing confirmed ordered locations
- **AND** this does not promise that a caller runtime such as DSH exposes late success after its original signal aborts

#### Scenario: Existing caller writes without a signal

- **WHEN** Workspace CLI writes screenshot images without the optional signal
- **THEN** safe basename validation, directory creation, preflight, `0600` temporary files, ordered exclusive links, destination-race errors and existing non-transactional failure behavior remain unchanged

### Requirement: Workspace CLI screenshot and lint compatibility after optional signals

Workspace CLI MUST retain its current screenshot, screenshot setup and layout lint commands, scope/options, browser resolution, output paths, structured/text results, errors, render-page artifact and installed behavior after Client Core adds optional signal support.

#### Scenario: Existing CLI render commands run

- **WHEN** CLI invokes screenshot or layout lint through its existing adapters
- **THEN** it supplies no DSH execution, Session-cwd policy, approval, owner signal or result budget to Core and obtains the same targets, PNGs, findings and presentation

#### Scenario: Installed CLI artifact is verified

- **WHEN** the existing CLI package build, verification and smoke run
- **THEN** its copied render page, browser dependencies, browser setup surface, runtime worker and arbitrary-cwd behavior remain compatible
