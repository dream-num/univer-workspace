# Univer Workspace HTTP Interface Concepts

The OpenAPI description in this directory is the source of truth for paths,
parameters, JSON schemas, status codes, and stable error codes. This document
explains behavior that spans multiple operations.

## Conventions

- JSON fields use `camelCase`; timestamps are UTC ISO 8601 strings.
- IDs and cursors are opaque strings.
- Authentication uses an opaque `HttpOnly` cookie. React never reads a session
  secret or stores a bearer token.
- Unsafe requests accept JSON and require a same-origin `Origin`. A body that
  is not valid JSON returns `400 INVALID_INPUT`, and one over the operation's
  size limit returns `413 PAYLOAD_TOO_LARGE`.
- Unauthorized discovery of a Space, Node, Resource, or Worktree returns
  `404 NOT_FOUND`; an absent login session returns `401 UNAUTHENTICATED` on
  operations requiring authentication.
- Error branching uses `error.code`, never the diagnostic `message`.

## Authentication

Password Credentials, a verified Email address, and External Identities are
optional authentication methods for the same User. GitHub, Google, and Discord
login map the provider's stable user ID to an internal User. They never identify
or automatically link a User by email.

Email sign-in is passwordless: `POST /api/auth/email/code` emails a six-digit,
single-use code and `POST /api/auth/email/login` exchanges it for a login
session. A first successful verification creates the User and Personal Space;
later verifications reuse that User. Codes expire after ten minutes, allow five
incorrect attempts, and requests are rate limited per address. When the server
sets `TRUST_PROXY`, each source IP may also send 60 requests an hour to the code
route and 120 to the login route, valid or not, and then gets
`429 EMAIL_CODE_RATE_LIMITED` with `Retry-After`. Responses never reveal
whether an address already has an account. Email sign-in does not merge a User
into an existing account created with another provider.

External login and explicit linking use different OAuth intents. Both validate
`state` and PKCE from a short-lived protected cookie. An access token used
only to resolve identity is discarded after the callback.

CLI browser login uses a separate device authorization flow. The unauthenticated
CLI creates a ten-minute request containing a high-entropy device code and a
human-verifiable code. A signed-in browser explicitly approves the matching
code; the CLI then exchanges the device code exactly once for its own normal
login session. Pending requests are bounded, process-local, and non-durable.
They contain no browser cookie, password, Email verification code, or external
OAuth access token.

`GET /api/session` returns `200` for both authenticated and anonymous clients so
React can use it as its application bootstrap request.

An agent is a User of kind `agent` with its own Personal Space and no password or
External Identity. `POST /api/agents` and `POST /api/auth/guest` create one without
credentials. `POST /api/agents` returns a personal access token with every MCP scope.
Its `expiresAt` is Unix epoch milliseconds, not an ISO 8601 string.
`POST /api/auth/guest` sets the login session cookie instead, and returns
`409 CONFLICT` when the request already carries a valid session. The guest session
is interactive, so it can approve an OAuth authorization. Given the
`oauthAuthorization` it continues, it checks that authorization first and creates
nothing when authorize would refuse it, then names the agent after that dynamically
registered or metadata-document client, as in `Claude Code · 7f3k`. Both endpoints share one
per-source-IP limit and return `429 AGENT_CREATE_RATE_LIMITED` past it. `POST /api/auth/guest`
also lets each source start 10 client metadata fetches per hour and returns the same `429`
past that budget. When every metadata fetch guests may start is in use, or the source already
has another in flight, it returns `503 CLIENT_METADATA_BUSY` with `Retry-After` and fetches nothing. The anonymous
session reports `guestAuthEnabled: false` when the deployment creates no agents.

The session User and the token exchange `user` carry `kind` (`human` or `agent`).
An agent also carries `claimed`. A banned agent's login session returns
`401 UNAUTHENTICATED`, and its token exchange returns `invalid_grant`.

A human claims an agent to keep its files. The unclaimed agent calls
`POST /api/agents/claim-codes` with any of its sessions and hands the returned
`/claim/<code>` page to the human. The code lives in the server process for ten
minutes and claims once. `GET /api/agents/claim?code=` shows the agent and
`POST /api/agents/claim` claims it; both need a human's browser session. A used
code answers `409 AGENT_ALREADY_CLAIMED` to anyone but its claimer, an old code
`410 AGENT_CLAIM_EXPIRED`, an unknown one `404 AGENT_CLAIM_INVALID`. The claimer
becomes an owner of the agent's Personal Space, the agent stops expiring, and the
agent gains no access to the claimer's content. `GET /api/agents` lists the
claimer's agents; `POST /api/agents/{agentId}/stop` bans one for good.

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
It admits anonymous viewers, does not create a Direct Grant, and is inherited
by current and future descendants. The configured role applies to signed-in users;
anonymous readers and unclaimed agents remain viewers even for an editor link. Link Sharing Editor access permits
content editing but not Node structure
changes, Trash, or further sharing.

Only an owner of the Personal Space reads or writes a Node's Link Sharing. The
response names that `owner` with `username`, `kind`, and for an agent `claimed`.
`expiresAt` is when the owner, an unclaimed agent, expires and its links stop
working; it is `null` when the owner does not expire. A human's session issued
for a personal access token or an OAuth grant reads Link Sharing but cannot write
it (`403 INTERACTIVE_SESSION_REQUIRED`). An agent's token session can write it.

When a Space's owner is a banned or expired agent, the Space, its Nodes, Team
Worktrees and Issues are not discoverable by anyone but the agent and the human
who claimed it, so their links return `404`. The author of a Team Worktree still
sees it, as after leaving the Space, but none of its Units.

Some actions are forbidden whatever role the caller holds, with `403`. An agent
that creates a Team Space owns it, and the human who claimed the agent owns it too.
An unclaimed agent cannot create or update a Space with `publicRead: true`, cannot be
added as a Team Space member and cannot add one. A claimed agent can be added or
changed to viewer or editor, and to admin only in a Team Space an agent owns
(`AGENT_NOT_ALLOWED`). An unclaimed agent owns at most 3 Team Spaces and 3 forks, keeps at most
20 files across all its Spaces, counting files still pending in a pull request, and
stores no file above 10 MiB (`AGENT_QUOTA_EXCEEDED`). A human's session issued for a personal access
token or an OAuth grant cannot create or update a Space with `publicRead: true`
(`INTERACTIVE_SESSION_REQUIRED`); it can still make a Space private. User search
never returns unclaimed or stopped agents and refuses an unclaimed agent (`AGENT_NOT_ALLOWED`).

Space public read also admits anonymous viewers, including in Team Spaces. It
permits browsing that Space by ID, but never anonymous enumeration of `/api/spaces`.
Anonymous clients can read Node metadata, resolve Resources by Unit ID, browse accessible children,
open Resources, and read Blob and Trunk Asset bytes. All writes and administration,
Recent, global discovery, and Worktrees continue to require a login session.
Both policies use existing settings: already-enabled sharing/public read becomes
anonymous-readable on upgrade. No additional switch or database migration is needed.
HTML and referenced Units retain independent source permission checks.

## Space lists and pins

`GET /api/spaces` returns only owned or joined Spaces, ordered with the caller's
Personal Space first, then owned Spaces, then joined Spaces, with name and ID as ties.
The Personal Space of an agent the caller claimed counts as owned, here and in every
list below.
Every `SpaceView` has an `affiliation` derived from ownership and membership.
It is `owner`, `member`, or `none`; Team viewer members remain `member`.
Public readers are `none` even though both have the effective `viewer` role.

`GET /api/spaces/starred` returns readable starred Spaces by star time descending,
then ID. Stars survive access loss, but hidden Spaces are omitted until access returns.
`GET /api/spaces/explore` returns public Spaces the caller neither owns nor has joined,
including starred ones, ordered by star count descending, then name and ID. It is unpaginated.
These lists do not change detail, full-name lookup, anonymous access, or Node Grants.

`GET /api/spaces/pins` returns `{ customized, limit, spaces }`. Pins can contain owned
or joined Spaces and starred public Spaces. Stored rows retain their order and survive
loss of eligibility, but ineligible rows are omitted. If no eligible row survives,
`customized` is false and the first eight owned or joined Spaces are returned.
`PUT /api/spaces/pins` accepts 1 to 12 unique eligible `spaceIds` in order and replaces
the rows atomically. All invalid IDs and invalid arrays return the same
`400 INVALID_INPUT` with `field: spaceIds`; missing and hidden IDs are indistinguishable.
`DELETE /api/spaces/pins` resets to defaults. Both writes are idempotent.
All Space list and pin endpoints require a login session and operate only for that User.

## Node discovery

Node breadcrumbs contain only the path the current User may discover.
Entering through a Direct Share starts the breadcrumb at the highest visible
shared root and does not expose its Personal Space ancestors.

Node listing, Recent, and Shared With Me never grant access. Every read
re-runs the same Access Resolver.

`GET /api/nodes/{nodeId}` names the Node's author as `owner` to every reader,
signed in or not: the owner of its Personal Space, with `displayName`, `kind`,
and for an agent `claimed`. It carries no ID, username or Email. It is `null` in
a Team Space.

`POST /api/nodes/{nodeId}/reports` files an abuse report on a Node the caller can
read, with or without a login session. Each source IP may send 10 reports an
hour; past that it gets `429 REPORT_RATE_LIMITED`.

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

The Collaboration Snapshot endpoint independently resolves the reader and
resolves current Resource Access. Blob content/download endpoints do the same via
the owning Node and support one byte range. Recent is updated only by a successful
authenticated Resource Open; anonymous reads, previews and Worktree scopes never update Recent.

Blob replacement uses `PUT /api/blob-resources/{resourceId}/content`, a stable
Idempotency-Key, and one quoted strong If-Match ETag from the downloaded content.
It publishes immediately, preserves identity and filename, and generates a fresh
ETag even for identical bytes. HTTP 412 means the caller must download and
reconcile current content. The Operation records completion for lost-response
recovery; interrupted replacements fail and their unpublished bytes are queued
for deletion. There is no Blob Worktree or version-history surface.

## Copying a file

`POST /api/nodes/{nodeId}/copies` turns a Sheet, Doc, Slide or Blob file the requester can open into
a file of their own. The copy lands at the root of the requester's Personal Space, or as a new file in
a draft pull request the requester authored, at a target where the requester can create files. A Blob
file cannot go into a pull request. A source the requester cannot read answers `404`, the same as
`GET /api/nodes/{nodeId}`.

The copy has its own content and its own embedded images, so it stays readable after the owner stops
sharing the source. It does not take over the source's permissions, sharing settings, comments or
history. A copied HTML View is a copy of the page only: it stays bound to the Sheets the source page
names and shows their data only while its reader can open them. `GET /api/nodes/{nodeId}` returns the
source as `copiedFromNodeId` to the copy's owner and editors. Every other reader, anonymous included,
gets `null`, because a link-shared source's Node ID is its access link. It also returns how many files
were copied from this one as `copyCount`. A copy made in a pull request gets its source, and counts as a
copy, when the pull request merges. `copiedFromNodeId` becomes `null` when the source is
permanently deleted, and the reader may be unable to open the source.

The request requires `Idempotency-Key` and follows the rules above. It returns `201` with the new
Node, or with the new pull request Unit, and `202` while the copy is still running. A copy that
cannot finish removes what it created and ends as a failed Operation. It cannot be retried through
`POST /api/operations/{operationId}/retry`. Copy again with a new key.

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

While a Worktree is `draft` or `ready`, each Unit from trunk carries `freshness`: its
`baselineTrunkRevision`, the trunk revisions committed since (`revisionsBehind`), and when
it joined (`addedAt`). The server labels it `current` when trunk has not moved, `stale` when
trunk is more than 100 revisions ahead or the Unit joined more than 7 days ago, and `behind`
otherwise. The label is advice for the author and never blocks a merge. Worktree-local Units
and Units that trunk no longer holds have `freshness: null`, and so does every Unit once the
Worktree leaves `draft` and `ready`.

A Worktree has one author, its creator, and only the author edits its draft. People and
agents collaborate on trunk, each through their own Worktrees. Merging needs edit access
to every target, and one of two standings. The owners of the creator's Personal Space,
that is the creator and the human who claimed an agent creator, have it for any Worktree,
User or Team. The Owner, Admins and Editors of a Team Space have it for a Team Worktree
whose Visibility is `space`. On a Worktree that is not `space`-visible, anyone else gets
`FORBIDDEN` with a message that names the author, and the human who claimed an agent
author. Otherwise a caller without edit access to a target gets `FORBIDDEN` with a message
that says so. Every Worktree summary
carries `claimer`, that human, or `null` when a person or an unclaimed agent is the author,
so whoever can read the Worktree learns both names; a caller who gets `404` learns neither.

A merge that has started, so the Worktree is `merging`, or `merged` with Worktree-local
Units not yet activated, is a decision already made. The actor who started it finishes it
with their own Operation, through the same Idempotency Key or Operation Retry. Anyone with
a standing to merge it finishes it with any Idempotency Key. This lets nobody start
a merge they could not start. Once the merge is applied and an Operation has recorded it,
that Operation's actor stays the one who merged: any other merge Operation sent afterwards
gets `FORBIDDEN`, and a completed Operation replays its stored result.

User Worktrees are creator-private and may contain editable Resources from different
Spaces. The owners of the creator's Personal Space, that is the human who claimed an
agent creator, can also discover and review them and read their Worktree-local Units.
They can also mark them ready, reopen, merge and discard them, as themselves: a merge
checks each target with their own access, and the Operation names them as its actor.
Editing the draft, its Units, name and summary stays with the creator.

Team Worktrees belong to one Team Space. Any current Space Member can create one, a Viewer
included. Its author adds trunk Units they can open and new Units targeted at the Space,
edits the draft and marks it ready, without edit access to the Space: a draft never writes
trunk, and edit access is asked of whoever merges. Marking a Team Worktree ready sets its
Visibility to `space` when its author cannot merge it, so that a Member who can merge it
sees it. While it is `ready` and its author still cannot merge it, changing its Visibility
to `private` gets `FORBIDDEN`; reopen it first. Marking a trunk Unit for deletion still
needs the right to trash its Node, and content protection on a trunk Unit holds in its
draft: an author without edit access to the Unit cannot change what a protection rule covers. Visibility controls who
may Review; Visibility never grants Resource Access.

The Creator, and the human who claimed an agent creator, can discover, Review, mark
ready, reopen and discard a private Team Worktree. The Team Space
Owner and Admin can discover its Summary and perform administrative Reopen or
Discard actions, but cannot read its Unit list or draft content, and cannot merge it.
Other Members cannot discover it. A space-visible Team Worktree can be discovered and
reviewed read-only by current Space Members, and marked ready and merged by the Team Space
Owner, Admins and Editors with edit access to every target.

## Forks

A fork is one User's named view of a whole Team Space, its upstream. Creating one with
`POST /api/forks` writes one product row and copies no Node, Resource, Unit, Blob or
Collaboration data. Only the caller who can propose in the upstream today may fork it: its
owner, the human who claimed its agent owner, or a Space Member of any role. Any other reader
of the upstream gets `403 FORBIDDEN`, and a caller who cannot read it, or names a Personal
Space, gets `404`. One owner may fork one upstream several times under different names.
Repeating a create with the same name and upstream returns the existing fork with `200`.

Only a fork's owner lists, reads, looks up and deletes it; anyone else gets `404`. A fork
stays readable after its owner loses the upstream, with `upstream: null`, so the owner can
still delete it. A fork's `state` is derived from its open Worktree, the one Team Worktree
of the upstream that links to the fork and is not yet merged or discarded, and is never
stored. Nothing opens a fork's Worktree yet, so every fork reads `clean` with
`worktree: null`. Deleting a fork removes only its row. The upstream does not change, and
any Worktree that linked to the fork keeps its history as an ordinary Team Worktree of the
upstream, which the delete response names.

## Repository names and numbers

A Team Space may carry a `slug`, unique per owner and compared case-insensitively. Together with the owner's
username it forms the full name `<owner>/<slug>` (`SpaceView.fullName`), resolved by `GET /api/spaces/lookup`.
Every Personal Space, including those that predate slugs, is `<owner>/personal`; `personal` cannot be used as a Team
Space slug. Team Spaces created before slugs existed have `slug: null` until an administrator sets one. Renaming a
username or slug invalidates the old full name; there is no redirect.

A fork's `name` shares the owner's namespace with Team Space slugs, so `<owner>/<name>` names either one Team
Space or one fork, never both. Creating or renaming either one to a name the other uses returns
`409 SPACE_SLUG_TAKEN`; a Team Space created without a `slug` skips names its owner's forks use. A fork address
resolves only through `GET /api/forks/lookup`, and `GET /api/spaces/lookup` returns `404` for it.

A Team Worktree shares its Space's number sequence with Issues, so `#12` names one object per Space
(`GET /api/spaces/{spaceId}/worktrees/{number}`). A User Worktree is numbered per creator and addressed through
the creator's own Personal Space, by that Space's owners. Worktrees created before numbering existed keep `number: null` and are addressed
by ID.

## Issues

Issues exist only in Team Spaces. A Personal Space returns `409 CONFLICT`; a Space the caller
cannot discover returns `404`. Every endpoint requires a login Session.

An Issue is addressed by its Space-scoped number (`#12`) in the path and by an opaque ID
elsewhere (comments, labels). Numbers increase inside a Space and are never reused.

| Action | owner | admin | editor | viewer member | public-read non-member |
|---|---|---|---|---|---|
| Read Issues, comments, labels | yes | yes | yes | yes | yes |
| Open an Issue, comment | yes | yes | yes | yes | no |
| Edit or close one's own Issue | yes | yes | yes | yes | no |
| Edit, close, label, assign or reference files on any Issue | yes | yes | yes | no | no |
| Create, change, delete labels | yes | yes | no | no | no |
| Edit a comment | author | author | author | author | no |
| Delete a comment | yes | yes | author | author | no |

`SpaceView.capabilities.createIssue`, `triageIssues` and `manageIssueLabels` and
`Issue.capabilities` report what the caller may do. Clients never infer rights from a role.

`PATCH` replaces `labelIds`, `assigneeUserIds` and `nodeIds` as whole sets. Existing
assignees who left the Space and references that became unavailable may stay in a
submitted set; only newly added entries are validated. Concurrent edits are
last-writer-wins. Issue writes touch only the product database, so they carry no
`Idempotency-Key`; after an unknown result, list the Space or read the timeline before
retrying a create or comment.

The timeline merges comments and events in chronological order. Event payloads are
snapshots (label name and color, user names, file names), so they stay readable after a
label is deleted or a file is renamed.

## Collaboration protocol

The product OpenAPI description does not redefine Univer Collaboration
Snapshot, Changeset, Session Ticket, or WebSocket protocol schemas. Those
endpoints are owned by the Univer Collaboration packages.

Every protocol request authenticates the same Login Session and crosses the
Collaboration Access Resolver described in
[application-design.md](../../docs/application-design.md). Client-supplied Unit IDs,
Roles, or editor modes are never trusted.
