# Browser transport boundary between Agent and DSH

English | [简体中文](agent-transport-boundary.zh-CN.md)

## Product model

Workspace Agent is a single-user application. Each running instance has one active
Workspace account. Switching accounts is a global operation: every open page follows
the new account. Tabs do not retain independent account identities.

Account-specific Sessions, attachments, and indexes remain in separate runtime
storage directories. This organizes the operator's data; it does not turn the local
DSH application into a multi-tenant service or an operating-system sandbox.

## Ownership

| Owner | Responsibilities |
| --- | --- |
| DSH | Local browser authentication, RPC, WebSocket mux and reconnection, native downloads, upload carriers, and Session attachment receipts |
| Agent core | Workspace OAuth, the current account, account runtime lifecycle and directories, readiness during switching, and refreshing pages after a global account change |
| Workspace capability plugin | Product API calls, Space registration, document tools, Viewer composition, and remote permission enforcement through Workspace |
| Workspace Server | Authoritative remote identity, ACLs, and document operations |

The browser's DSH authentication cookie and the server-held Workspace credential
have different owners. Switching the Workspace account does not revoke the DSH
browser session. A page notices the change through DSH's public connection state
subscription and reads `/auth/connection/status`. It reloads when the account
runtime has changed and the replacement is ready. Restored pages perform the same
check. An expired DSH browser session returns 401 and reopens the root authentication
entry. Healthy idle pages do not poll.

## Implementation

- `WorkspaceAuthProvider` drains the prior account services before exposing the
  next account and restores that account's data directory.
- `RuntimeWebServer` returns 503 while account services are unavailable. It does
  not require custom page-version headers or query parameters.
- The page's initial runtime version is used only to decide whether to refresh.
  It is not a per-request authorization token or an independent tab identity.
- `connection-recovery.ts` subscribes to `connection.state` and `pageshow`. DSH
  continues to own the WebSocket, reconnect loop, and browser authentication.
- Native Fetch, WebSocket, download anchors, and DSH upload Workers are unchanged.
  The application does not install `__DSH_TRANSPORT__` or `__DSH_FILE_UPLOAD__` overrides.
- Uploads retain DSH's Session identity and receipt lifecycle. They do not create
  remote Workspace documents. Workspace tools still use authenticated server-side
  clients; retained operations remain tied to their originating runtime.

## Verification

Check normal reconnection, account switching across open tabs, readiness delays,
page restoration, and expired browser authentication. Verify that native upload
and log download requests succeed without custom connection metadata, and that
Workspace files and collaboration still work. Account directory restoration and
remote permission checks remain covered separately.

No upstream DSH changes or new public transport interfaces are required by this design.
