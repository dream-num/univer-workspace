# Browser transport boundary between Agent and DSH

English | [简体中文](agent-transport-boundary.zh-CN.md)

Status: the ownership boundary and migration plan are agreed; the replacement is
not implemented. The currently consumed DSH `0.1.5-rc.1` lacks the WebSocket and
resource URL hooks described below. Integration requires an upstream release.
This is a proposed integration plan, not a delivered API or an ADR.

## Ownership

| Owner | Responsibilities | Outside its scope |
| --- | --- | --- |
| DSH | Browser authentication, RPC, Remote mux, upload carriers and receipts, Session attachment ownership, connection retries, and generic transport extension points | Workspace accounts, Spaces, connection versions, and account switching policy |
| Agent core | Workspace OAuth, account runtime directories and service lifecycles, page connection versions, server isolation checks, page recovery after switching, and transport policy composition | Implementing the DSH mux protocol, upload Workers, attachment receipts, or reconnect loops |
| Workspace capability plugin | Explicitly using Agent transport policy for product APIs; composing collaboration and resource access through public Univer SDK HTTP/URL configuration | Replacing browser globals, copying SDK transport implementations, or choosing the active account |
| Workspace Server | Authoritative remote identity, product permissions, and document operations | DSH local browser or Session attachment lifecycles |

The page connection version belongs to Agent account isolation policy. It is fixed
when the page is created and does not change on ordinary network reconnection.
DSH connection generations belong to the transport lifecycle and can change on
reconnection; they cannot replace the page connection version. The version is not
a login credential. DSH browser authentication and Workspace server permission
checks remain in place.

## Current implementation and gaps

[connection-browser.ts](../../apps/agent/src/connection-browser.ts) replaces global
`fetch`, `WebSocket`, and `HTMLAnchorElement.prototype.click` before page startup.
This transitional adapter depends on request paths, boot order, and the DSH download
implementation. It is not a long-term contract. The upload fix uses a public hook,
but does not remove these dependencies.

The evidence below comes from the published `@deepseek-ai/*@0.1.5-rc.1` READMEs,
public declarations, and runtime code:

| Channel | Published capability | Migration |
| --- | --- | --- |
| DSH RPC | `ClientTransportHooks.fetch`, exported from `dsh-client-connection/client` and configured through `__DSH_TRANSPORT__` before boot | Inject a Fetch carrier that includes the page connection version |
| DSH attachments | `dsh-client-file-upload` provides `__DSH_FILE_UPLOAD__.fetch` | Inject the same policy while preserving Session receipts, cancellation, and stream semantics |
| DSH Remote mux | Gateway directly calls `new WebSocket(remoteStreamUrl())`; the public mux declaration has no URL configuration | Add an upstream URL hook before physical connection creation |
| DSH downloads and resources requested directly by the browser | The current adapter intercepts download anchor clicks; this is not a resource URL contract | Add an upstream hook when producing resource URLs, covering downloads and direct media references |
| Workspace HTTP, collaboration, and resources | The capability plugin composes requests and Viewer endpoints; some still depend on the replaced global Fetch | Explicitly inject Agent policy through public SDK HTTP/endpoint extensions; DSH does not own this integration |

`ClientTransportHooks.openStream` supplies an alternative logical stream carrier.
It does not add parameters to the existing WebSocket. Agent must not reimplement
the DSH mux to use it. A shared cookie cannot carry the page version either:
switching accounts would also change the cookie sent by old tabs, preventing the
server from recognizing an old page.

## Upstream interface requirements

Propose two optional fields on the existing `ClientTransportHooks`. These names
are subject to upstream agreement; they cannot be used against the current release
or made to appear available through type assertions:

```ts
resolveWebSocketUrl?(url: URL): URL;
resolveResourceUrl?(url: URL): URL;
```

- Configure hooks before DSH boot. Without them, preserve native behavior. Keep
  existing Fetch, stream carrier, and module loading configuration intact.
- Gateway calls the URL hook for every physical WebSocket connection, including
  reconnections. DSH continues to create sockets and own heartbeats, multiplexing,
  cancellation, and retries. Agent does not take over these responsibilities.
- Downloads and direct media references call the resource hook when producing the
  URL the browser will use. Download HEAD checks and the final GET must use the
  same page version. Decorating only button events is insufficient; detached
  anchors must also be covered.
- Upstream code contains no `x-uwh-connection`, `uwhConnection`, Workspace routes,
  or account knowledge. The consumer decides which URLs need a version. External
  URLs, static assets, and `blob:` and `data:` URLs remain unchanged.
- Hooks must not be implemented by replacing global Fetch, WebSocket, or DOM
  prototypes. Upstream tests cover both configured and default behavior.
- Existing connection state subscriptions must cover initial connection failure,
  connection loss, and retries. Agent uses them to trigger its readiness check;
  it does not observe a replaced WebSocket constructor or add a physical connection
  retry loop.

DSH implements and publishes these interfaces in its own repository. This repository
consumes public package exports only: no DSH fork, installed-package patches, or
neighboring checkout dependencies. This document is the handoff for upstream
implementation and acceptance.

## Agent integration and removal order

1. After upstream publishes the interfaces and behavior tests, update the consumed
   versions and lockfile in this repository.
2. Implement Agent core policy in ordinary TypeScript, compiled into a pre-boot
   script. HTTP requests carry `x-uwh-connection`; protected WebSocket and resource
   URLs carry `uwhConnection`. Capture native carriers and inject them through
   public hooks without replacing globals. Recovery must not update the bound
   version to the new account's version.
3. Expose the policy to the capability plugin through a typed service composed by
   Agent. Replace direct Fetch calls and SDK HTTP/URL wiring, respecting existing
   Cordis service boundaries without adding package-to-application source imports.
   Inventory every protected entry point, including Blob/Asset access, import/export,
   collaboration HTTP, and WebSocket connections.
4. Trigger Agent readiness checks through DSH connection state subscriptions,
   explicit isolation rejection responses, and `pageshow`. An ordinary business
   409 does not indicate an account switch. Reload only after the status endpoint
   confirms a changed version and a ready runtime. Never automatically replay uploads
   or writes, or update an old page's version so it can operate on the new account.
5. Keep server version checks in
   [RuntimeWebServer](../../apps/agent/src/runtime-webserver.ts). Once all channels
   are migrated and the checks below pass, remove the global patches and string
   script in `connection-browser.ts`.

Migrating only RPC or uploads does not replace the global adapter. Removing the
adapter must never require accepting requests without a connection version.

## Completion criteria

- Verify RPC, attachments, log downloads, direct media references, Workspace files,
  and collaboration in the real application with native browser `fetch`,
  `WebSocket`, and anchor prototypes unchanged. Verify pre-boot composition in both
  Web and Desktop.
- Keep two old tabs on account A while another switches to B: reject old requests
  and socket reconnects, reload after readiness, and do not replay old uploads or
  writes. Also cover switching to the same user ID on another Workspace origin.
- DSH handles ordinary reconnection for the same account. Page restoration, 503
  during switching, and 409 for old pages follow the existing isolation boundary.
  Healthy idle pages do not poll.
- Preserve attachment bytes/streams, cancellation, progress semantics, and Session
  ownership. Another Session cannot consume the receipt.
- Download HEAD and GET use the same version. External and static resource requests
  carry no version. Server authentication and ACLs remain intact.
- Run typechecks, relevant regression tests, actual package/browser validation, and
  repository CI. Record the consumed upstream version and evidence in the PR.

Until these criteria are met, successful attachment tests do not establish that
the transport boundary migration is complete or justify unconditional merge approval.
