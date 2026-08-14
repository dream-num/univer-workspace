# Univer Workspace HTTP Interface Concepts

The OpenAPI description in this directory is the source of truth for paths,
parameters, JSON schemas, status codes, and stable error codes. This document
explains behavior that spans multiple operations.

## Conventions

- JSON fields use `camelCase`; timestamps are UTC ISO 8601 strings.
- IDs and cursors are opaque strings.
- Authentication uses an opaque `HttpOnly` cookie. React never reads a session
  secret or stores a bearer token.
- Unsafe requests accept JSON and require a same-origin `Origin`.
- Unauthorized discovery of a Space, Node, Resource, or Worktree returns
  `404 NOT_FOUND`; an absent login session returns `401 UNAUTHENTICATED`.
- Error branching uses `error.code`, never the diagnostic `message`.

## Authentication

Password Credentials and External Identities are optional authentication
methods for the same User. GitHub and Discord login map the provider's stable user ID to an
internal User. It never identifies or automatically links a User by email.

External login and explicit linking use different OAuth intents. Both validate
`state` and PKCE from a short-lived protected cookie. An access token used
only to resolve identity is discarded after the callback.

`GET /api/session` returns `200` for both authenticated and anonymous clients so
React can use it as its application bootstrap request.

## Capabilities

The server resolves effective Roles and Capabilities from Space ownership, Team
Membership, ancestor Node Grants, Trash state, Worktree state, and current
Collaboration state. React consumes Capabilities and never rebuilds the role
matrix.

Direct Share applies only to Personal Space Nodes. A Node Grant applies to the
Node and its current and future descendants, regardless of whether any Node has
a Resource. Team Spaces use Membership and do not create Node Grants.

Link Sharing also applies only to Personal Space Nodes. It changes the access
policy of the Node's canonical URL rather than creating a separate bearer link.
It requires an authenticated User, does not create a Direct Grant, and is
inherited by current and future descendants. Link Sharing Editor access permits
content editing but not Node structure
changes, Trash, or further sharing.

## Node discovery

Node breadcrumbs contain only the path the current User may discover.
Entering through a Direct Share starts the breadcrumb at the highest visible
shared root and does not expose its Personal Space ancestors.

Node listing, Recent, and Shared With Me never grant access. Every read
re-runs the same Access Resolver.

## Idempotency and operations

Requests spanning the product database and Collaboration Service require
`Idempotency-Key`.

- The key is globally unique and bound to its original User and normalized request.
- Repeating the same key and body returns the same Operation.
- Reusing the key with a different body returns
  `409 CONFLICT`.
- A client retry after a timeout reuses the original key.

For Collaboration operations, the server attempts an Operation immediately. It returns the completed resource
when the initial attempt finishes in time, or `202` with a Location header when
the Operation remains pending. Background recovery is independent of the HTTP
request.

## Resource creation and opening

A Univer Resource does not exist while `createResource` is pending. The Operation first
creates the Collaboration Unit and only then creates the product Node, Resource,
and Univer Resource extension in one transaction.

Blob creation reserves stable identities in an Upload Session, streams and verifies
the bytes, and publishes its Node/Resource only on Complete. Opening a Resource is
a discriminated union: Univer returns Unit/editor metadata, while Blob returns
server-detected MIME plus content and download URLs. React chooses the preview
component from MIME; the server does not return a preview kind.

The Collaboration Snapshot endpoint independently authenticates the session and
resolves current Resource Access. Blob content/download endpoints do the same via
the owning Node and support one byte range. Recent is updated only by a successful
normal Resource Open; previews and Worktree scopes never update Recent.

## Trash batches

One recursive trash action creates one Trash Batch. Nodes already in Trash
retain their earlier Batch.

Restoration preserves the original location. If a Batch root has an ancestor in
another active Batch, restoration returns `RESTORE_PARENT_IN_TRASH`; the server
does not restore extra content or move the Node to the Space root.

Permanent removal is blocked when the subtree contains another active Batch or
a Resource referenced by an active Worktree. Product removal is irreversible.
Physical Blob deletion is queued transactionally and retried by a background
outbox worker. Collaboration Unit cleanup follows a separate retention policy.

## Worktrees

Collaboration Worktree Service owns the lifecycle state:

```text
draft → ready → merging → merged
  ↑       │         └── conflict/failure → ready
  └──── reopen

draft/ready → discarded
```

Merge results are stored per Unit. Successful Units do not roll back if another
Unit conflicts. A successfully merged Worktree-local Unit becomes a Resource
Node only after its Activation Operation completes.

User Worktrees are creator-private and may contain editable Resources from different
Spaces. Team Worktrees belong to one Team Space. Their Visibility controls who
may Review; Visibility never grants Resource Access.

The Creator can discover and Review a private Team Worktree. The Team Space
Owner and Admin can discover its Summary and perform administrative Reopen or
Discard actions, but cannot read its Unit list or draft content. Other Members
cannot discover it. A space-visible Team Worktree can be discovered and reviewed
read-only by current Space Members.

## Collaboration protocol

The product OpenAPI description does not redefine Univer Collaboration
Snapshot, Changeset, Session Ticket, or WebSocket protocol schemas. Those
endpoints are owned by the Univer Collaboration packages.

Every protocol request authenticates the same Login Session and crosses the
Collaboration Access Resolver described in
[application-design.md](../../docs/application-design.md). Client-supplied Unit IDs,
Roles, or editor modes are never trusted.
