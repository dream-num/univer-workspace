## Purpose

定义 Node-hosted Workspace Agent Client 可共同依赖的 Typst-to-Doc 编译、确定性 materialization 与 Worktree-local Unit apply 行为，并固定 diagnostics gate、Doc runtime contract、原生运行时和现有 Workspace CLI 交付兼容性。

## ADDED Requirements

### Requirement: Client Shell-independent Typst compilation

Workspace Client Core SHALL compile a supported Typst Source Bundle into the existing structured diagnostics, generated Doc Facade program, target Unit identity, title and preview results without depending on a command framework, credential store, daemon transport or output presenter.

#### Scenario: Bundle compiles for review

- **WHEN** a Node-hosted Client Shell supplies a supported bundle path and optional preview directory without requesting apply
- **THEN** the core compiles the bundle once, returns the complete compiler result with `committed: false`, and performs no Workspace materialization or Unit creation

#### Scenario: Compile-only result contains errors

- **WHEN** compile-only mode produces error diagnostics
- **THEN** the core returns those diagnostics and compiler artifacts without attempting materialization or changing Workspace content

### Requirement: Typst apply diagnostic gate

Workspace Client Core MUST apply a compiled Typst result only when compilation contains no error diagnostic, while preserving warning diagnostics and avoiding a second compilation.

#### Scenario: Error blocks apply

- **WHEN** apply is requested and the compiler returns one or more diagnostics with error severity
- **THEN** the core returns the existing `workspace-typst-diagnostics` failure with the error diagnostics and neither materializes the program nor creates a Worktree Unit

#### Scenario: Warnings allow apply

- **WHEN** apply is requested and compilation returns warnings but no error diagnostic
- **THEN** the core materializes and applies that same compiled result once and preserves the warnings in the returned result

### Requirement: Deterministic Doc materialization contract

Workspace Client Core MUST materialize the generated program in a disposable headless Doc runtime with the existing deterministic random behavior and accept only one complete Doc whose identity matches the compiler target.

#### Scenario: Same program is materialized repeatedly

- **WHEN** the same generated program and target Unit identity are materialized in separate supported invocations
- **THEN** each invocation produces equivalent complete Doc UnitData with the target identity and normalized revision `1`

#### Scenario: Program violates Unit lifecycle constraints

- **WHEN** the generated program creates zero or multiple Units, creates a Unit with another identity, disposes a Unit, or invokes another prohibited Unit lifecycle operation
- **THEN** the core returns the existing `workspace-typst-runtime-contract` failure and does not create a Workspace Unit

#### Scenario: Program does not save a complete target Doc

- **WHEN** the generated program does not leave a saveable Doc whose UnitData identity matches the compiler target
- **THEN** the core returns the existing runtime-contract failure and disposes its ephemeral runtime

### Requirement: Typst apply creates one Worktree-local Doc

Workspace Client Core SHALL materialize an accepted compile result and create one Doc Worktree-local Unit through the shared Worktree Unit capability, preserving target Space, optional parent Node, Worktree and caller-supplied idempotency identity.

#### Scenario: Compiled Doc is applied

- **WHEN** apply is requested with a valid target and materialization returns complete Doc UnitData
- **THEN** the core creates one Doc Worktree-local Unit, chooses its name from the materialized Doc before the compiled title, and returns the existing compiler fields with `committed: true` and the Server-allocated Unit result

#### Scenario: Unit creation cannot be confirmed

- **WHEN** the shared Worktree Unit create capability returns its existing mismatch or result-unknown failure
- **THEN** the core propagates that failure without recompiling or rematerializing the Typst program

### Requirement: Native Typst runtime delivery

Each installable Client Shell that exposes Workspace Client Core Typst compilation MUST deliver the platform-native Typst binding required by the selected exact SDK baseline and MUST fail its artifact gate when that runtime cannot be resolved.

#### Scenario: Installed native runtime is available

- **WHEN** an installable Client Shell runs Typst compilation on a supported packaged platform
- **THEN** it loads the version-matched native binding and compiles without depending on a system Typst installation or monorepo checkout

#### Scenario: Native runtime is missing

- **WHEN** the packaged Client Shell cannot resolve the native binding selected for its platform
- **THEN** package verification or installation smoke fails instead of declaring Typst compilation ready

### Requirement: Workspace CLI Typst compatibility

Workspace CLI MUST retain its `compile-typst` arguments, validation order, bundle and local output paths, generated program, diagnostics file schema, preview results, JSON/text presentation, coded errors and installed-package behavior after it consumes Workspace Client Core Typst capability.

#### Scenario: Existing CLI compile and apply contracts are exercised

- **WHEN** existing Typst feature, command and built-entrypoint cases run against the refactored CLI
- **THEN** compile-only and apply requests, output and diagnostics files, structured results, warnings, errors, Worktree target fields and Unit results remain compatible

#### Scenario: Installed CLI compiles outside the monorepo

- **WHEN** the Workspace CLI artifact is installed in a temporary location and invoked from an arbitrary working directory
- **THEN** it resolves the bundled Client Core workflow and platform-native Typst runtime, compiles the bundle, and writes the same requested outputs without a workspace bare import or source-checkout dependency
