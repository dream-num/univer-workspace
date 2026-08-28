## Purpose

定义 Node-hosted Workspace Agent Client 可共同依赖的 Space/Node 访问能力，同时固定远程传输安全、响应校验、未知写结果处理和现有 Workspace CLI 兼容性。

## ADDED Requirements

### Requirement: Client Shell-independent Space and Node access

Workspace Client Core SHALL allow a Node-hosted Client Shell to supply its authenticated Workspace access and perform Space discovery, Node discovery, and Node mutation without depending on that shell's command, configuration, credential-storage, or lifecycle framework.

#### Scenario: Client Shell supplies authenticated access

- **WHEN** a Node-hosted Client Shell supplies valid authenticated access for one Workspace origin
- **THEN** the core performs the requested Space or Node operation and returns a structured Workspace result without reading shell-owned configuration or credential storage

#### Scenario: Browser consumer is excluded

- **WHEN** a consumer requires browser-specific authentication or browser application state
- **THEN** the capability makes no promise that the consumer can use Workspace Client Core directly

### Requirement: Workspace transport safety

Workspace Client Core MUST preserve the existing Workspace origin, redirect, authentication, error-envelope, and strict response-validation rules for every extracted Space and Node operation.

#### Scenario: Request leaves the configured origin

- **WHEN** a Space or Node API request resolves outside the configured HTTP or HTTPS Workspace origin, contains URL credentials, or receives a redirect
- **THEN** the core rejects the request without forwarding the Workspace Session cookie to the new destination

#### Scenario: Server response violates the expected shape

- **WHEN** the Workspace Server returns JSON whose identity, type, capability, pagination, or resource fields do not satisfy the expected Space or Node result
- **THEN** the core rejects the result with the existing structured invalid-response error semantics

### Requirement: Space and Node discovery

Workspace Client Core SHALL preserve the existing list, browse, recursive traversal, filter, and find behavior for Space and Node discovery.

#### Scenario: Browse spans multiple pages

- **WHEN** a Client Shell browses a Space whose Nodes span multiple cursor pages
- **THEN** the core follows the cursor sequence, preserves Space and parent context, and returns the same ordered structured results as Workspace CLI

#### Scenario: Pagination or hierarchy repeats

- **WHEN** the Server repeats a pagination cursor or recursive traversal encounters a Node already visited in that traversal
- **THEN** the core terminates the traversal with the existing structured invalid-response error instead of looping

### Requirement: Node mutation reliability

Workspace Client Core MUST preserve the existing create, rename, move, and Trash mutation behavior, including request identity checks and operation-specific handling when the Server may have committed a request whose response was lost.

#### Scenario: Rename or move response is unknown

- **WHEN** a rename or move request ends with an unknown remote result
- **THEN** the core reads the Node back and reports success only when the observed state confirms the requested mutation

#### Scenario: Create or Trash response is unknown

- **WHEN** a create or Trash request ends with an unknown remote result and no stable read-back can prove the outcome
- **THEN** the core returns the existing result-unknown error and does not blindly repeat the mutation

### Requirement: Workspace CLI compatibility

Workspace CLI MUST continue to expose the same Space and Node commands, arguments, structured output, error codes, Session behavior, and package-installed behavior after it consumes Workspace Client Core.

#### Scenario: Existing CLI contract is exercised

- **WHEN** the existing Space/Node command-contract and end-to-end cases run against the refactored CLI
- **THEN** their commands, requests, JSON results, text presentation, and coded failures remain compatible

#### Scenario: Installed CLI artifact runs outside the monorepo

- **WHEN** the Workspace CLI package is built, packed, installed in a temporary location, and its Space/Node surface is exercised without the source checkout
- **THEN** the artifact resolves all Workspace Client Core code and preserves the current self-contained installation contract
