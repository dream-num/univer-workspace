## Purpose

定义 `dsh-univer-work` 在 Host-only local profile 中取得、保存、解析和清除 Workspace Login Session 的行为，并通过模型可调用但不泄露秘密的两阶段 tools 为后续 Workspace 操作提供 authenticated connection。

## ADDED Requirements

### Requirement: Plugin-owned authentication record

The `dsh-univer-work` Client Shell MUST store its current Workspace authentication state under one plugin-owned DSH `CredentialKey` as either a pending browser approval grant or an authenticated Login Session grant, and MUST validate the complete owner-defined JSON payload every time it reads that record.

#### Scenario: Pending approval is stored

- **WHEN** a browser approval starts successfully for a normalized Workspace origin
- **THEN** the plugin stores the device code, origin, user code, same-origin verification URL, and expiry in a pending `GrantRecord`
- **AND** it does not expose the device code through any tool argument, output, rendering, error, Config, or Session event

#### Scenario: Browser handoff attempts to embed the device code

- **WHEN** a start response or persisted pending record has an invalid user-code format, a URL other than the exact same-origin `/cli-login?userCode=<matching-code>` form, or any safe field whose literal or URL-decoded value contains the device code
- **THEN** the plugin rejects it before storage or rendering with a sanitized invalid-response or credential failure
- **AND** no device code or attacker-controlled handoff field enters tool output or Session content

#### Scenario: Approval becomes authenticated

- **WHEN** one completion exchange returns an authenticated User and Login Session
- **THEN** the plugin atomically replaces the same pending record with an authenticated grant containing the normalized origin, cookie, and User subject
- **AND** neither the cookie nor the complete grant appears in model-visible or ordinary configuration state

#### Scenario: Stored grant is invalid

- **WHEN** the credential record is missing, has another kind, contains an unknown state, or fails strict field, origin, URL, subject, or credential validation
- **THEN** the plugin does not create authenticated HTTP from that record and returns a stable credential or authentication error without echoing the invalid payload

#### Scenario: Operation follows credential rotation

- **WHEN** a grant is replaced or deleted between two Workspace operations
- **THEN** the next operation reads the new credential state instead of using a cached cookie or authenticated client

### Requirement: Two-stage browser approval tools

The Client Shell SHALL expose `workspace_auth_start` and `workspace_auth_complete` as schema-validated DSH tools that preserve the Workspace CLI two-stage browser approval outcomes without accepting a password or polling automatically.

#### Scenario: Model starts browser approval

- **WHEN** `workspace_auth_start` receives a valid Workspace HTTP(S) origin and no authenticated grant exists
- **THEN** it performs one Client Core start exchange and returns `authorization_required` with the normalized origin, user code, verification URL, and expiry
- **AND** its result instructs the caller to wait for the user to approve before calling complete

#### Scenario: Existing live pending approval is started again

- **WHEN** `workspace_auth_start` receives the same origin while an unexpired pending grant already exists
- **THEN** it returns that pending approval's safe fields without creating another Server authorization

#### Scenario: Existing connection is protected

- **WHEN** `workspace_auth_start` runs while an authenticated grant or a pending grant for another origin exists
- **THEN** it does not replace the record and reports that the current state must be logged out or completed first

#### Scenario: Approval is still pending

- **WHEN** `workspace_auth_complete` reads an unexpired pending grant and its single exchange returns HTTP 202 pending
- **THEN** it returns `authorization_pending` with the same safe handoff fields and exits without delay, retry, timer, or background work

#### Scenario: Approval completes once

- **WHEN** `workspace_auth_complete` reads an unexpired pending grant and its single exchange succeeds
- **THEN** it stores the authenticated grant and returns `authenticated` with only the normalized origin and User subject

#### Scenario: Pending approval expires locally

- **WHEN** `workspace_auth_complete` reads a pending grant whose expiry has passed
- **THEN** it removes the pending record, returns `authorization_expired`, and performs no exchange request

#### Scenario: Authentication mutations overlap in one Host

- **WHEN** two start, complete, or logout calls reach the same Host concurrently
- **THEN** the Client Shell serializes their credential reads, protocol calls, and writes so each call observes the state left by the preceding mutation

#### Scenario: Post-request credential transition is rejected

- **WHEN** a start or completion request succeeds but its atomic credential callback observes a record that no longer permits the intended transition
- **THEN** the tool fails with `workspace-authentication-state-conflict`, preserves the observed record, and returns no handoff fields, User subject, device code, or cookie from the uncommitted response
- **AND** it does not retry the request or claim coordination with an out-of-band writer

### Requirement: Authenticated connection and identity lookup

The Client Shell MUST provide one internal authenticated connection resolver for later plugin capabilities and SHALL expose `workspace_auth_whoami` for a server-authoritative identity check.

#### Scenario: Later capability requests authenticated HTTP

- **WHEN** a plugin operation asks the resolver for authenticated HTTP
- **THEN** the resolver reads and validates the current authenticated grant for that operation and constructs Client Core `WorkspaceHttp` with the stored origin and cookie

#### Scenario: Pending state is not authentication

- **WHEN** the resolver or `workspace_auth_whoami` sees no record or a pending record
- **THEN** it returns `workspace-authentication-required` and sends no authenticated request

#### Scenario: Current User is requested

- **WHEN** `workspace_auth_whoami` runs with a valid authenticated grant
- **THEN** it performs one Client Core `whoami` request and returns only the server-authoritative User subject

### Requirement: Logout clears local authentication

The Client Shell MUST require human approval before `workspace_auth_logout` executes and MUST remove its local credential record whether remote logout succeeds, fails, is cancelled, or has an unknown result.

#### Scenario: Authenticated Session logs out

- **WHEN** an approved `workspace_auth_logout` reads a valid authenticated grant
- **THEN** it sends one authenticated Client Core logout request and deletes the local record in a `finally` path

#### Scenario: Remote logout result is unknown

- **WHEN** remote logout fails or is cancelled after dispatch
- **THEN** the tool preserves the Workspace error or `workspace-result-unknown` outcome after deleting the local record
- **AND** a later resolver call cannot use the removed Session

#### Scenario: Pending or invalid state is cleared

- **WHEN** an approved `workspace_auth_logout` finds a pending, invalid, or absent local record
- **THEN** it performs no authenticated remote request, removes any local record, and returns a non-secret local-clear result

#### Scenario: Logout approval is unavailable

- **WHEN** DSH cannot obtain human approval for `workspace_auth_logout`
- **THEN** the tool does not call the Server and does not alter the credential record

### Requirement: Authentication tool cancellation and lifecycle

Every authentication tool MUST pass a signal fused from its DSH execution signal and a plugin-owner disposal signal through all Client Core authentication I/O. One fiber-owned lifecycle effect MUST stop new calls, abort in-flight I/O, and await all accepted authentication bodies and the mutation queue before Host plugin disposal settles.

#### Scenario: Authentication request is cancelled in flight

- **WHEN** an authentication tool's execution signal aborts during a Workspace HTTP request
- **THEN** the signal reaches the underlying request, the tool waits for its work to settle, and the call reports the applicable cancellation or Workspace result-unknown failure without committing a new grant

#### Scenario: Host plugin is disposed during authentication work

- **WHEN** the `dsh-univer-work` Host fiber is disposed while a tool is in a Core request or waiting in the authentication mutation queue
- **THEN** the owner first rejects and unregisters new calls, aborts plugin-owned in-flight I/O, and waits for every accepted body and queued mutation to settle before disposal returns
- **AND** start or complete whose provider transition callback has not begun observes owner abort before starting a new grant write, while an atomic provider write already underway is drained to completion

#### Scenario: Logout is accepted before disposal

- **WHEN** owner disposal begins after a logout body was accepted, whether it is in remote I/O or waiting in the mutation queue
- **THEN** logout still completes its non-cancellable local credential deletion and the lifecycle disposer waits for it

#### Scenario: Host plugin disposal completes

- **WHEN** the lifecycle disposer settles
- **THEN** all four authentication tools and the logout approval gate are unregistered and no cached credential, executing body, queued promise, signal listener, polling loop, timer, authorization flow, or other authentication task survives it

### Requirement: Authentication transcript secrecy

Authentication tool schemas, canonical values, native rendering, failure rendering, and installed-package snapshots MUST keep password, device code, cookie, and grant payloads out of model-visible and durable Session content.

#### Scenario: Authentication transcript is inspected

- **WHEN** keyless assembled DSH calls cover start, pending completion, authenticated identity, cancellation, failure, and logout
- **THEN** the transcript contains only declared safe fields and stable status/error information
- **AND** it contains no password field, device code, cookie, `Set-Cookie` value, or serialized grant payload

#### Scenario: Dependency failure contains credential material

- **WHEN** a Workspace transport, validator, or credential-provider read, modify, or delete failure throws a message or cause containing a credential sentinel
- **THEN** the tool maps it to an operation-specific sanitized failure and does not render the dependency message, cause, rejected value, or credential material
- **AND** it preserves a stable Workspace code only when the failure is a recognized `WorkspaceApplicationError`

#### Scenario: Same-origin verification URL contains the device-code sentinel

- **WHEN** a keyless start fixture returns a same-origin verification URL whose path, query, or decoded form contains the device-code sentinel
- **THEN** the tool rejects the handoff before persisting or rendering it and the Session transcript does not contain the sentinel
