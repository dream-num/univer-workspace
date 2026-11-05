## ADDED Requirements

### Requirement: Typst operation cancellation

Workspace Client Core SHALL let a Node-hosted Client Shell supply an optional `AbortSignal` to Typst compile, deterministic Doc materialization and Worktree-local Unit apply, MUST pass that signal to the shared Unit create operation, and MUST stop every later separable step after cancellation without changing callers that omit it.

#### Scenario: Cancellation precedes compilation

- **WHEN** the supplied signal is already aborted before Typst compilation begins
- **THEN** Core does not enter the compiler, materializer or Unit create operation

#### Scenario: Cancellation occurs during native compilation

- **WHEN** the supplied signal aborts after the frozen native compiler begins
- **THEN** Core awaits that uninterruptible compiler call, observes cancellation immediately after it settles, and starts no materialization or Unit create
- **AND** Core does not claim hard cancellation of native evaluation or preview bytes that the caller deliberately directed to its supplied preview directory

#### Scenario: Cancellation occurs during generated program execution

- **WHEN** the supplied signal aborts after the generated Facade program begins executing in the disposable Doc runtime
- **THEN** Core awaits that uninterruptible execution, disposes the runtime, starts no Unit create and returns no materialized success

#### Scenario: Unit create becomes uncertain

- **WHEN** apply dispatches the shared Unit create and cancellation prevents its stable-identity result from being confirmed
- **THEN** Core preserves the shared `workspace-result-unknown` failure and safe Unit create identity without recompiling, rematerializing or replaying create

#### Scenario: Confirmed Unit races cancellation

- **WHEN** Core has already validated the created Worktree-local Unit while the supplied signal aborts concurrently
- **THEN** Core may return the validated result
- **AND** this does not promise that a Client Shell such as DSH will expose that late success after its own caller signal aborts

### Requirement: Optional Typst resource budgets

Workspace Client Core SHALL accept optional caller-fixed limits for generated JavaScript, the Client Shell-visible compiler projection, materialized UnitData bytes and JSON depth, MUST enforce them before the next persistent side effect, and MUST return no truncated success.

#### Scenario: Generated JavaScript exceeds its limit

- **WHEN** the generated JavaScript exceeds its supplied byte limit
- **THEN** Core fails with `workspace-typst-limit-exceeded` before materialization or Unit create and does not truncate the program

#### Scenario: Client Shell-visible compiler projection exceeds its limit

- **WHEN** canonical target identity, title, diagnostics and preview metadata exceed the supplied visible-result byte or depth limit
- **THEN** Core fails with `workspace-typst-limit-exceeded` before materialization or Unit create and does not truncate the diagnostics or previews

#### Scenario: Materialized UnitData exceeds its limit

- **WHEN** saved Doc UnitData exceeds the supplied canonical JSON byte or depth limit
- **THEN** Core disposes the runtime and fails with `workspace-typst-limit-exceeded` before Unit create

#### Scenario: Existing Client Shell omits limits

- **WHEN** Workspace CLI calls the existing compile/apply input without optional limits
- **THEN** Core preserves the existing compiler result, diagnostics, materialization and Unit create behavior without imposing a new CLI limit

### Requirement: Licensed and isolated-random Typst materialization

Workspace Client Core SHALL let a Client Shell provide an optional license to the disposable headless Doc materializer, MUST execute each exact compiler-generated program with per-invocation deterministic random intrinsics without modifying process-global random descriptors, and MUST dispose each runtime on every settled path.

#### Scenario: Client Shell supplies a license

- **WHEN** a materializer is constructed with a resolved license string
- **THEN** the disposable Doc runtime receives that exact license without including it in the materialized result or any Core error detail

#### Scenario: Client Shell omits a license

- **WHEN** Workspace CLI constructs the materializer without a license option
- **THEN** the runtime receives the existing empty license value and CLI behavior remains unchanged

#### Scenario: Concurrent materializations are requested

- **WHEN** two Core-owned Typst apply operations reach deterministic materialization concurrently in one process
- **THEN** each exact compiler-generated program receives its own same-seed `Math.random` and `crypto.getRandomValues`, produces deterministic output, and neither invocation changes the process-global descriptors or the other's sequence

#### Scenario: Process globals are observed during materialization

- **WHEN** other Host work reads process-global `Math.random` or `crypto.getRandomValues` while a Typst program executes
- **THEN** it observes the unchanged Host functions rather than Typst's deterministic sequence

#### Scenario: Generated program attempts unapproved lifecycle work

- **WHEN** the isolated execution context invokes the guarded Facade outside the existing one-Doc runtime contract
- **THEN** Core returns `workspace-typst-runtime-contract` and does not claim that the execution context is a security sandbox

### Requirement: Workspace CLI Typst extension compatibility

Workspace CLI MUST preserve its existing Typst behavior when it omits the optional signal, budgets and materializer license introduced for another Client Shell.

#### Scenario: Existing CLI Typst cases run

- **WHEN** existing CLI compile-only, apply, diagnostics, preview, command-output and installed-package cases run against the extended Core capability
- **THEN** compiler calls, file paths and write order, result fields, errors, Unit identity, deterministic output, native dependency selection and presentation remain compatible
