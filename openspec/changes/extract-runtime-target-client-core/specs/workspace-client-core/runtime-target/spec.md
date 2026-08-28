## Purpose

定义 Node-hosted Workspace Agent Client 可共同依赖的 runtime target、Snapshot source 与跨 Unit reference 行为，并固定 Trunk/Worktree scope、revision identity、严格响应校验和只读引用约束。

## ADDED Requirements

### Requirement: Stable Workspace runtime target

Workspace Client Core SHALL represent and validate a Workspace runtime target using one normalized HTTP(S) origin, non-empty Unit identity, supported Unit type, non-negative revision, and an exact Trunk or Worktree scope.

#### Scenario: Valid target is parsed

- **WHEN** a Client Shell supplies a target with a valid origin, Unit identity, supported type, revision, and exact scope shape
- **THEN** the core returns the normalized target without changing its Unit, revision, or scope identity

#### Scenario: Target is ambiguous or invalid

- **WHEN** the origin contains credentials or a path, an identity is empty, the type or revision is unsupported, or the scope has missing or extra fields
- **THEN** the core rejects the target with the existing origin-invalid or target-invalid error semantics

#### Scenario: Runtime identity spans revisions only

- **WHEN** two targets differ only by revision
- **THEN** the core derives the same runtime reuse key, while different origins, scopes, Worktrees, Units, or Unit types remain disjoint

### Requirement: Worktree and Trunk target resolution

Workspace Client Core MUST preserve target resolution from authenticated Workspace data, including Worktree identity and membership validation, Draft editability, exact draft head revision, and bounded supported-type discovery for Trunk Units.

#### Scenario: Worktree Unit target is resolved

- **WHEN** the requested Worktree exists and contains the requested Unit with a supported type and valid draft head revision
- **THEN** the core returns a Worktree-scoped target bound to that Worktree, Unit, type, origin, and revision

#### Scenario: Editable target is not Draft

- **WHEN** an editable target is requested from a Worktree whose state is not Draft
- **THEN** the core returns the existing worktree-not-editable error before starting runtime execution

#### Scenario: Trunk Unit type is discovered

- **WHEN** the Unit type is not supplied for a Trunk target
- **THEN** the core probes the existing supported Unit types, skips only the Server's stored-type-mismatch result, and returns the first strictly validated Snapshot head revision

#### Scenario: Trunk discovery receives another failure

- **WHEN** a Trunk probe returns authentication, authorization, not-found, transport, or another non-type-mismatch failure
- **THEN** the core stops discovery and returns that failure without probing another type

### Requirement: Strict scope-aware Snapshot source

Workspace Client Core SHALL read Snapshot, changeset, Sheet block, and resource data from the endpoint selected by the target or reference scope and reject responses whose identity, type, revision, byte encoding, or protocol envelope is invalid.

#### Scenario: Trunk and Worktree data use distinct endpoints

- **WHEN** equivalent Unit data is requested for Trunk and for a Worktree
- **THEN** the core uses the existing Trunk and Worktree Snapshot endpoint prefixes respectively and does not mix their results

#### Scenario: Selected target revision differs from observed head

- **WHEN** a target-bound read observes a Snapshot/changeset head revision different from the selected target revision
- **THEN** the core returns the existing invalid-response or result-mismatch semantics and does not return Unit data

#### Scenario: Snapshot payload is inconsistent

- **WHEN** a Snapshot, changeset, block, resource, or protocol error envelope has the wrong Unit, type, revision shape, metadata encoding, or requested identity
- **THEN** the core rejects it with the existing invalid-response semantics

### Requirement: Host-relative reference scope

Workspace Client Core MUST select a referenced Source Unit's scope from the host target: every reference from a Trunk host reads Trunk, while a Worktree host reads its mapped Units from that Worktree and falls back to Trunk for unmapped Units.

#### Scenario: Worktree reference is mapped

- **WHEN** a Worktree host references a Unit present in the same Worktree membership
- **THEN** the core binds the reference load context and Snapshot reads to that Worktree

#### Scenario: Worktree reference is not mapped

- **WHEN** a Worktree host references a Unit absent from that Worktree membership
- **THEN** the core binds the reference load context and Snapshot reads to Trunk

#### Scenario: Reference context targets another Unit

- **WHEN** Snapshot loading receives reference context for a Unit other than the requested Unit, an unsupported context version, or malformed scope metadata
- **THEN** the core rejects the load with the existing reference-invalid-context semantics

### Requirement: Read-only referenced Unit provider

Workspace Client Core SHALL provide a Workspace referenced Unit provider for Sheet, Doc, Slide, Base, and Board self references, verify requested and loaded identities/types, honor an already-aborted load signal, and expose referenced Snapshot sources as read-only.

#### Scenario: Supported reference is loaded

- **WHEN** a supported self ResourceRef requests a referenced Unit whose declared type matches the requested Unit type
- **THEN** the provider loads revision zero with the selected reference context and returns only when the loaded Unit identity and type match

#### Scenario: Reference is invalid or loading is aborted

- **WHEN** the file kind or Unit type is unsupported, the declared type differs, the signal is already aborted, or the loaded identity differs
- **THEN** the provider rejects the request with the existing stable reference error code

#### Scenario: Referenced source attempts a write

- **WHEN** a referenced Snapshot source receives a save, update, block write, changeset write, copy, or write-side revision request
- **THEN** the core rejects it with the existing reference-source-read-only error without sending a write request

### Requirement: Workspace CLI runtime-target compatibility

Workspace CLI MUST continue to expose the same inspect, execute, exchange, screenshot, lint and compile behavior after daemon, worker and feature callers consume the extracted runtime-target capability.

#### Scenario: Existing CLI runtime cases run

- **WHEN** existing target/source, content, daemon, exchange, screenshot, lint and built-entrypoint cases run against the refactored CLI
- **THEN** their target serialization, request order, runtime key, error codes, structured output, Session timing and Trunk/Worktree/reference behavior remain compatible

#### Scenario: Installed CLI artifact starts runtime paths

- **WHEN** the Workspace CLI package is built, packed, installed outside the monorepo, and its daemon and runtime-backed command surface is exercised
- **THEN** the artifact resolves Client Core target/Snapshot/reference code without a workspace bare import or source-checkout dependency
