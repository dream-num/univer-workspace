## ADDED Requirements

### Requirement: Authentication operation cancellation

Workspace Client Core SHALL let a Node-hosted Client Shell supply an optional `AbortSignal` to browser approval start, browser approval completion, current-User lookup, and remote logout, and MUST pass that signal to the corresponding Workspace HTTP request without changing calls that omit it.

#### Scenario: Browser approval start is cancelled

- **WHEN** a Client Shell supplies a signal to browser approval start and it aborts during the HTTP request
- **THEN** the request observes that signal and the protocol returns the existing Workspace request failure semantics without returning a pending credential

#### Scenario: Browser approval completion is cancelled

- **WHEN** a Client Shell supplies a signal to one completion exchange and it aborts during the HTTP request
- **THEN** the request observes that signal, no retry or polling begins, and the protocol returns the existing Workspace result-unknown semantics without returning an authenticated credential

#### Scenario: Authenticated operation is cancelled

- **WHEN** a Client Shell supplies a signal to `whoami` or logout and it aborts during the corresponding HTTP request
- **THEN** that request observes the signal and preserves the existing authentication or result-unknown error behavior

#### Scenario: Existing CLI call omits a signal

- **WHEN** Workspace CLI calls start, complete, `whoami`, or logout through the existing function forms without a signal
- **THEN** endpoint, response parsing, pending behavior, credential result, command output, Session persistence, and error behavior remain unchanged
