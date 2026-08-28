## Purpose

定义 Node-hosted Workspace Agent Client 可共同使用的 storage-neutral 认证协议，并固定 browser approval、Login Session identity、logout 与 Workspace CLI 凭据边界的兼容行为。

## ADDED Requirements

### Requirement: Client Shell-independent authentication protocol

Workspace Client Core SHALL perform Workspace authentication protocol operations from an explicit Workspace origin and the credentials supplied for that operation, without reading a Client Shell's configuration, credential storage, command framework, or filesystem.

#### Scenario: Client Shell starts authentication

- **WHEN** a Node-hosted Client Shell supplies a valid Workspace origin and requests a supported login operation
- **THEN** the core performs the corresponding Workspace HTTP exchange and returns a structured protocol result for the shell to persist or present

#### Scenario: Core has no credential storage

- **WHEN** an authentication operation creates, replaces, expires, or revokes a Login Session or pending browser authorization
- **THEN** the core returns the protocol outcome without directly reading or mutating Client Shell credential storage

### Requirement: Browser approval lifecycle

Workspace Client Core MUST preserve the existing two-step browser approval protocol, including strict response validation, same-origin verification URLs, expiry handling, one exchange per completion request, and an explicit pending result.

#### Scenario: Browser approval starts

- **WHEN** the Workspace Server returns a valid device code, user code, same-origin verification URL, positive expiry, and positive interval
- **THEN** the core returns a bounded pending authorization containing the existing origin, code, verification URL, and expiry information

#### Scenario: Verification URL crosses origin

- **WHEN** the Server returns a verification URL with another origin or embedded URL credentials
- **THEN** the core rejects the response with the existing invalid-response error semantics

#### Scenario: Approval remains pending

- **WHEN** one completion request receives HTTP 202 with the expected pending response
- **THEN** the core returns `pending` after that single exchange and does not poll automatically

#### Scenario: Approval completes

- **WHEN** one completion request returns an authenticated User and a valid Login Session cookie before expiry
- **THEN** the core returns the authenticated User and Login Session credential for the Client Shell to store

### Requirement: Login Session operations

Workspace Client Core SHALL preserve the existing password login, current-User lookup, and remote logout protocol, including strict User and Login Session response parsing and Workspace HTTP safety rules.

#### Scenario: Password login succeeds

- **WHEN** a Client Shell supplies a username and password and the Server returns an authenticated User with a Login Session cookie
- **THEN** the core returns the normalized Workspace origin, User identity, and Login Session credential without persisting them

#### Scenario: Current User response is invalid

- **WHEN** `/api/session` does not identify an authenticated User with the required identity fields
- **THEN** the core returns the existing authentication-required or invalid-response error, according to the observed response

#### Scenario: Remote logout is requested

- **WHEN** a Client Shell supplies an existing Login Session credential for logout
- **THEN** the core sends one authenticated same-origin logout request and returns its success or existing result-unknown failure without deciding how local credentials are cleared

### Requirement: Workspace CLI authentication compatibility

Workspace CLI MUST retain its existing origin configuration, Session and pending-authorization file format, file permissions, atomic mutation behavior, password input rules, browser-login instructions, command surface, output shapes, error codes, and installed-package behavior after it consumes the core authentication protocol.

#### Scenario: Approval spans CLI invocations

- **WHEN** `login` starts browser approval and a later `login --complete` invocation runs for the same configured origin
- **THEN** the CLI persists and restores the pending authorization exactly as before, performs only the user-requested completion exchange, and preserves the current text and JSON results

#### Scenario: Remote logout result is unknown

- **WHEN** remote logout fails with `workspace-result-unknown`
- **THEN** the CLI still clears the local Login Session and pending authorization for that origin, then reports the existing error

#### Scenario: Installed CLI authentication is exercised

- **WHEN** the Workspace CLI package is built, installed outside the monorepo, and its login, completion, `whoami`, logout, and authenticated command path are exercised
- **THEN** the commands preserve their current behavior without unresolved Client Core imports or dependence on the source checkout
