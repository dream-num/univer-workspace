## Purpose

定义 Node-hosted Workspace Agent Client 可共同依赖的 Blob 与 Asset 文件传输行为，并固定远程恢复、严格响应校验、本地原子提交和现有 Workspace CLI 兼容性。

## ADDED Requirements

### Requirement: Client Shell-independent file transfer

Workspace Client Core SHALL allow a Node-hosted Client Shell to supply authenticated Workspace access and local host paths for Blob and Asset operations without depending on that shell's command framework, credential storage, output presentation, or lifecycle framework.

#### Scenario: Client Shell supplies authenticated access and a local path

- **WHEN** a Node-hosted Client Shell supplies valid authenticated access and a local source or destination path
- **THEN** the core performs the requested Blob or Asset operation and returns the same structured Workspace result without reading shell-owned configuration or credential storage

#### Scenario: Remote filesystem consumer is excluded

- **WHEN** a consumer supplies a sandbox, E2B, remote, or Browser filesystem that is not the Client Core process's local Node filesystem
- **THEN** this capability makes no promise that the path can be used as a transfer source or destination

### Requirement: Recoverable Blob upload

Workspace Client Core MUST preserve the existing Blob reserve, byte upload, verification, completion, and published-Resource validation behavior, using one stable upload intent and bounded recovery when a remote write may have succeeded without returning a response.

#### Scenario: Reserve response is unknown

- **WHEN** Blob reservation loses its response
- **THEN** the core retries only with the same idempotency identity and upload intent, and rejects any recovered Operation or Upload Session whose identity differs

#### Scenario: Byte upload or completion response is unknown

- **WHEN** byte upload or completion loses its response
- **THEN** the core reads the Upload Session state and continues from the observed state without replaying a write already confirmed by the Server

#### Scenario: Upload cannot reach a stable state

- **WHEN** bounded recovery cannot confirm upload, verification, completion, or the published Blob Resource
- **THEN** the core returns the existing structured result-unknown or terminal-upload error with the stable public upload identity

#### Scenario: Source changes during upload

- **WHEN** the local source byte count differs from the size observed before streaming began
- **THEN** the core stops the upload with the existing Blob size-mismatch error instead of accepting a mixed or truncated source

### Requirement: Strict Blob retrieval and download

Workspace Client Core MUST preserve Blob Resource identity, ownership, availability, capability, media type, and byte-size validation before reporting metadata or committing downloaded bytes.

#### Scenario: Blob metadata does not match its owning Node

- **WHEN** a Resource response has a different Resource identity, kind, or owning Node representation than requested
- **THEN** the core rejects it with the existing structured mismatch semantics

#### Scenario: Download metadata is incomplete or inconsistent

- **WHEN** a Blob is unavailable, lacks download capability, omits required content metadata, or returns a Content-Length inconsistent with Resource metadata
- **THEN** the core rejects the download and does not commit a destination file

#### Scenario: Exact Blob bytes are downloaded

- **WHEN** Blob metadata and the response stream are valid
- **THEN** the core commits exactly the Resource's declared byte size and returns the existing Resource, Node, output path, media type, byte size, and optional ETag fields

### Requirement: Safe signed Asset download

Workspace Client Core MUST preserve Asset sign-envelope validation, signed content URL validation, credential isolation, response metadata validation, and exact-byte download behavior.

#### Scenario: Signed content uses another origin

- **WHEN** Workspace returns a valid HTTP(S) Asset content URL on another origin
- **THEN** the core downloads that content without forwarding the Workspace Session cookie and without following redirects or accepting URL credentials

#### Scenario: Sign or content response is invalid

- **WHEN** the Asset sign response has an invalid service envelope or URL, or the content response lacks required media metadata
- **THEN** the core returns the existing structured error and does not commit a destination file

#### Scenario: Exact Asset bytes are downloaded

- **WHEN** the sign and content responses are valid
- **THEN** the core commits the exact response byte count and returns the existing Asset ID, Worktree ID, output path, media type, byte length, and optional ETag fields

### Requirement: Atomic local file safety

Workspace Client Core MUST preserve the existing local source inspection and private atomic download behavior for Blob and Asset paths.

#### Scenario: Destination is absent and download succeeds

- **WHEN** a Blob or Asset download completes to an absent destination
- **THEN** the final file contains only the verified bytes, has private permissions, and no temporary file remains

#### Scenario: Destination appears during a non-force download

- **WHEN** another process creates the destination after download begins and force was not requested
- **THEN** the core preserves the competing file, returns the existing output-exists error, and removes its temporary output

#### Scenario: Force replacement is explicit

- **WHEN** the destination exists and force is explicitly requested
- **THEN** the core atomically replaces it only after the complete verified stream has been written and synchronized

#### Scenario: Stream fails or has the wrong size

- **WHEN** the response stream fails or its byte count differs from the expected size
- **THEN** the core leaves no partial destination or temporary file and returns the existing structured write or size error

### Requirement: Workspace CLI file-transfer compatibility

Workspace CLI MUST continue to expose the same Blob and Asset commands, arguments, structured output, error codes, local path behavior, Session behavior, and package-installed behavior after it consumes Workspace Client Core.

#### Scenario: Existing command contract is exercised

- **WHEN** existing Blob/Asset command-contract and application-feature cases run against the refactored CLI
- **THEN** their options, requests, JSON/text results, output paths, overwrite rules, and coded failures remain compatible

#### Scenario: Installed CLI artifact performs file-transfer startup

- **WHEN** the Workspace CLI package is built, packed, installed outside the monorepo, and its Blob/Asset command surface is loaded
- **THEN** the artifact resolves all Workspace Client Core code without a workspace import or source-checkout dependency
