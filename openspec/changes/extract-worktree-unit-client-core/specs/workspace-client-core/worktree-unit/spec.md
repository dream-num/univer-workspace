## Purpose

定义 Node-hosted Workspace Agent Client 可共同依赖的 Worktree、Worktree Unit 与 review URL 能力，同时固定草稿状态转换、身份校验、未知写结果处理和现有 Workspace CLI 兼容性。

## ADDED Requirements

### Requirement: Client Shell-independent Worktree access

Workspace Client Core SHALL allow a Node-hosted Client Shell to supply authenticated Workspace access and perform Worktree discovery, creation, metadata update, and lifecycle operations without depending on that shell's command, credential-storage, configuration, or lifecycle framework.

#### Scenario: Worktrees are listed by requested view and scope

- **WHEN** a Client Shell requests active or processed Worktrees and optionally restricts the request to user or Team Space scope
- **THEN** the core sends the corresponding Workspace query and returns strictly validated structured Worktrees

#### Scenario: Worktree identity is stable across creation retries

- **WHEN** Worktree creation is retried after the remote result becomes unknown
- **THEN** every attempt uses the same idempotency identity and the core returns either a strictly validated Worktree or the existing result-unknown error

### Requirement: Worktree lifecycle contract

Workspace Client Core MUST preserve the existing Worktree lifecycle preconditions, requested terminal-state checks, idempotency behavior, and unknown-result confirmation rules for ready, reopen, merge, and discard.

#### Scenario: Lifecycle transition is allowed

- **WHEN** ready is requested from draft, reopen or merge is requested from ready, or discard is requested from draft or ready
- **THEN** the core performs that action and accepts the result only when the returned Worktree identity and state match the requested transition

#### Scenario: Lifecycle transition is not allowed

- **WHEN** a lifecycle action is requested from a Worktree state that does not allow that action
- **THEN** the core returns the existing lifecycle-invalid error without sending the transition request

#### Scenario: Lifecycle result is unknown

- **WHEN** a lifecycle request may have completed but its response is lost
- **THEN** the core reads the Worktree back, returns success only when the observed state matches the requested transition, and otherwise returns the existing result-unknown error

### Requirement: Worktree Unit membership

Workspace Client Core SHALL preserve Worktree Unit listing, addition of a trunk-backed Resource, and creation of a Worktree-local Unit, including strict source, target, type, identity, and Worktree membership validation.

#### Scenario: Trunk-backed Resource is added

- **WHEN** a Client Shell adds a Resource to a Worktree
- **THEN** the core uses a stable identity derived from that Worktree and Resource and accepts only a trunk-backed Unit for the requested Resource with no activation target

#### Scenario: Worktree-local Unit is created

- **WHEN** a Client Shell creates a named Unit of a supported type for a target Space and optional parent Node
- **THEN** the core preserves the supplied or generated idempotency identity and accepts only a Worktree-local Unit whose type, name, target Space, and parent Node match the request

#### Scenario: Unit belongs to a different Worktree

- **WHEN** a Unit response or list identifies a Worktree other than the one requested
- **THEN** the core rejects it with the existing result-mismatch semantics

### Requirement: Review URL construction

Workspace Client Core SHALL construct a review URL from a Client Shell-supplied HTTP(S) viewer base URL and a validated Worktree Unit without reading shell-owned configuration or Session state.

#### Scenario: Worktree has one Unit

- **WHEN** a valid viewer base URL is supplied for a Worktree containing exactly one Unit and no Unit is selected explicitly
- **THEN** the core selects that Unit and returns the existing agent review URL and structured Worktree, Unit, and Unit type result

#### Scenario: Worktree requires an explicit Unit

- **WHEN** no Unit is selected and the Worktree contains zero or multiple Units
- **THEN** the core returns the existing open-unit-required error without choosing a Unit

#### Scenario: Selected Unit is not a member

- **WHEN** the selected Unit does not belong to the requested Worktree
- **THEN** the core returns the existing unit-not-found or result-mismatch error as applicable and does not return a review URL

#### Scenario: Viewer base URL is invalid

- **WHEN** the supplied viewer base URL is not an absolute HTTP(S) URL
- **THEN** the core rejects it before reading the Worktree

### Requirement: Workspace CLI compatibility

Workspace CLI MUST continue to expose the same Worktree, Unit, and open commands, arguments, requests, structured output, text presentation, error codes, Session behavior, and package-installed behavior after it consumes the extracted Client Core capability.

#### Scenario: Existing CLI contract is exercised

- **WHEN** the existing Worktree, Unit, and open command-contract and application-feature cases run against the refactored CLI
- **THEN** their option mapping, HTTP requests, JSON results, text presentation, lifecycle failures, and reliability behavior remain compatible

#### Scenario: Installed CLI artifact runs outside the monorepo

- **WHEN** the Workspace CLI package is built, packed, installed in a temporary location, and this command surface is exercised without the source checkout
- **THEN** the artifact resolves all Workspace Client Core code and preserves the current self-contained installation contract
