## Purpose

定义 Node-hosted Workspace Agent Client 可共同依赖的 Workspace content runtime 生命周期、只读内容访问、Worktree mutation execution 与可靠提交行为，并固定现有 Workspace CLI daemon 与交付兼容性。

## ADDED Requirements

### Requirement: Client Shell-independent content runtime

Workspace Client Core SHALL let a Node-hosted Client Shell supply a Workspace runtime target, current Login Session credential, Univer license and packaged worker entry, then operate and close the content runtime without reading that shell's configuration, credential storage, command framework or daemon socket.

#### Scenario: Runtime starts for a selected target

- **WHEN** a Client Shell supplies a valid runtime target and the current credential, license and worker entry
- **THEN** the core starts or reuses the runtime identified by the target's existing revision-independent key and loads that exact Unit through the shared Snapshot and reference policies

#### Scenario: Runtime dependency is unavailable

- **WHEN** the Client Shell cannot supply a Login Session credential or valid license when a new worker must start
- **THEN** the operation fails with the existing authentication or license error before returning content

#### Scenario: Runtime owner closes

- **WHEN** the Client Shell closes the content runtime owner
- **THEN** the core closes its runtime pool and worker resources before the close operation settles

### Requirement: Synchronized read and export

Workspace Client Core MUST synchronize a leased runtime to the selected target revision before read execution or UnitData export and preserve the existing dirty, conflict and revision-mismatch failures.

#### Scenario: Read execution succeeds

- **WHEN** a Trunk or Worktree target synchronizes to its selected revision and executes valid read-mode Facade code
- **THEN** the core returns the existing lossless execution value without capturing or submitting mutations

#### Scenario: UnitData export succeeds

- **WHEN** a selected target synchronizes without pending mutation, awaiting changeset or conflict state
- **THEN** the core returns the runtime's UnitData for that exact Unit and revision

#### Scenario: Runtime cannot be synchronized safely

- **WHEN** the leased runtime is dirty, pull reports a conflict, or its observed base revision differs from the selected revision
- **THEN** the core returns the existing dirty, conflict or result-mismatch error and does not execute or export content

### Requirement: Worktree content execution

Workspace Client Core SHALL prepare and execute supported Facade code against an editable Worktree Unit, return without commit when no mutations were captured, and reject write execution for a Trunk or non-editable target.

#### Scenario: Execution captures no mutations

- **WHEN** prepared write-mode Facade code completes without captured mutations
- **THEN** the core returns the existing `{ committed: false, value }` result and leaves the synchronized runtime reusable

#### Scenario: Execution targets Trunk

- **WHEN** write execution receives a Trunk target
- **THEN** the core rejects it with the existing target-not-editable error before running write-mode code

#### Scenario: Prepared binding is invalid

- **WHEN** submitted Facade code conflicts with a reserved execution binding or the selected Unit type does not satisfy the operation's required type
- **THEN** the core returns the existing content-execution error without entering write execution

### Requirement: Embedded image externalization

Workspace Client Core MUST preserve the existing best-effort externalization of supported BASE64 PNG, JPEG, GIF and WebP references captured in mutations before commit.

#### Scenario: Duplicate embedded bytes are captured

- **WHEN** one or more mutations contain the same valid supported image bytes in direct or serialized resource references
- **THEN** the core uploads those bytes once for the target Worktree Unit and rewrites every matching reference to the returned UUID without mutating the captured input objects

#### Scenario: Embedded image cannot be externalized

- **WHEN** a BASE64 reference is invalid, unsupported, larger than the existing limit, an SVG, or its File API upload fails
- **THEN** the core preserves that reference byte-for-byte and continues the commit pipeline

### Requirement: Reliable changeset commit

Workspace Client Core MUST preserve mutation replacement, bounded changeset commit, confirmed-revision results and failure-driven runtime invalidation for write execution.

#### Scenario: Changeset is confirmed

- **WHEN** captured mutations have been externalized and commit returns a confirmed result within the existing attempt limit
- **THEN** the core returns the execution value with `committed: true`, the confirmed base revision and existing committed status, and leaves the runtime reusable

#### Scenario: Commit asks for a bounded retry

- **WHEN** commit reports retry or unknown before the attempt limit
- **THEN** the core retries the same pending changeset without re-executing Facade code or re-uploading embedded images

#### Scenario: Commit cannot be accepted

- **WHEN** commit reports conflict, pull-required, discarded pending mutations, or remains retry/unknown after the attempt limit
- **THEN** the core returns the existing stable coded error and invalidates the leased runtime before the operation settles

### Requirement: Workspace CLI content-runtime compatibility

Workspace CLI MUST retain its daemon command/socket, runtime RPC methods and payloads, execute and inspect behavior, UnitData consumers, Session and license behavior, errors, structured output and package-installed behavior after its daemon delegates content operations to Workspace Client Core.

#### Scenario: Existing CLI runtime surface is exercised

- **WHEN** existing execute, inspect, exchange, screenshot, daemon and embedded-image cases run against the refactored CLI
- **THEN** their target resolution, prepared code, RPC request and response shapes, commit behavior, output and error codes remain compatible

#### Scenario: Daemon shuts down

- **WHEN** the existing daemon control or process signal closes the CLI daemon
- **THEN** the daemon closes the Client Core runtime owner before its server shutdown completes

#### Scenario: Installed CLI starts worker-backed operations

- **WHEN** the Workspace CLI package is built, installed outside the monorepo and starts daemon and worker-backed content operations
- **THEN** the artifact resolves the Client Core runtime and worker code without a workspace bare import or source-checkout dependency and preserves the existing self-contained installation contract
