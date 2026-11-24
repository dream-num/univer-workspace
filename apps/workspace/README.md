# Univer Workspace

English | [简体中文](README.zh-CN.md)

A deployable React workspace providing Univer
collaboration, Node hierarchy management, permissions, Trash, recent Resources,
and Worktrees.

## Development

Requirements:

- Node.js 24 or newer
- pnpm 11
- a Univer license for capabilities that require one

```bash
pnpm install
pnpm workspace:dev:server
pnpm workspace:dev:web
```

`workspace:dev:server` watches the backend and listens at
`http://127.0.0.1:3020`. If `dist/public` exists, it also serves that last-built
static web application; web source changes are not rebuilt or hot-reloaded there.

`workspace:dev:web` starts Vite at `http://127.0.0.1:5173`, enables web
hot module replacement, and proxies product API and WebSocket requests to port
3020. Run both commands and open port 5173 for web development. Port 3020
alone is sufficient for backend work or viewing the latest built web application.

Vite also proxies `/mcp` to a local MCP gateway on `WORKSPACE_DEV_MCP_PORT`
(default 3000), so the page reaches it same-origin as in production. The gateway
accepts browser requests only when `Host` and `Origin` match its `MCP_PUBLIC_URL`,
so start it with `MCP_PUBLIC_URL=http://127.0.0.1:5173/mcp`.

Manage personal access tokens in the Browser account menu under **Access tokens**.

API documentation is available at:

- `http://127.0.0.1:3020/api-docs`
- `http://127.0.0.1:3020/openapi.yaml`

### Configuration

For a first local installation, copy [`.env.example`](.env.example) to `.env` in the same directory. Workspace defaults to SQLite, local file storage and password sign-in, with data under `.data/`.

#### Database

With PostgreSQL + S3, product and collaboration data use PostgreSQL, and Sheet cell blocks, uploads and embedded assets use S3. See the [Workspace configuration guide](docs/configuration.md) for settings and examples. For an existing deployment, follow the [migration steps](docs/storage-migration.md) to switch in one outage.

### Collaboration and workbench

Thread Comment anchors for Sheet, Doc, Slide, Base, and Board remain in Unit snapshots and changesets;
comment bodies, replies, and solved state use the Comment component in the same
collaboration database. Comment bodies are shared across Trunk, Worktree,
and Merge Preview editors; only anchors branch and merge with Unit data. The
Comment protocol has no Worktree semantics, so a comment deleted from a
Worktree disappears for Trunk as well. See `docs/application-design.md`
("评论与 Worktree") for the known behaviors and follow-up directions.

The same collaboration database stores a persistent History segment index.
SDK 1.0.0 owns automatic indexing from authoritative Core creation facts and
changesets. When History has no records, reads calculate segments and persist
them in the background.
Trunk Sheet, Doc, Slide, Base, and Board editors use the standard SDK
version-history UI. Viewers can inspect versions, while users with content edit
permission can restore one. Worktree and merge-preview editors do not expose
Trunk History.

An authenticated Browser keeps one `/api/worktree-events` WebSocket open. AI or
CLI Worktree writes publish a cache-invalidation signal only after the combined
Collaboration and product operation completes, so active/processed task lists,
details, sidebar counts, and Worktree-driven Node/Resource lists refresh without
a page reload. The connection uses a one-time session ticket and carries no
Worktree metadata or content.

The smart workbench offers Workspace Agent downloads and CLI/Skill installation guidance
when the signed-in user has never created a Worktree and has no visible tasks. Users with
visible team tasks see a compact introduction alongside their task list.

Worktree review keeps the agent draft as its default view and also offers a
structured, read-only side-by-side comparison. In the Browser, the draft view is
editable when the Server grants draft editing permission; changes synchronize
with agents working in the same Worktree. Ready Worktrees offer **Continue editing**
to users with reopen permission, returning the Worktree to draft. Trunk review,
merge previews, and comparisons remain read-only. Wait for the editor to finish
synchronizing before switching views or submitting the Worktree for review.
The Server materializes and
decodes the authoritative Trunk and draft states, computes semantic differences
with the matching History SDK adapter, and returns them through the
authenticated internal `/universer-api` boundary. The Browser supplies its own
Univer presets and plugins to the comparison viewer; official, agent, and
merge-preview iframe views remain available. The internal comparison endpoint accepts
`baseMode=base` to pin the left side to the Unit's captured baseline, or `baseMode=parent`
with `view=merged` to pin it to Trunk just before that Unit's merge, and `view=draft`,
`view=preview` (ready only), or `view=merged` (merged only) for the right side.
Recorded merge views use the SDK's stored merge revision; Units without that revision
cannot claim an immutable merge result. The default remains current Trunk versus draft
for existing Browser consumers. Agent requires these modes for historical Base review;
new Worktree-local Units have an empty Base and remain reviewable after discard.
A trunk Unit that a merged Worktree deleted has no comparison in any mode and gets `409`,
because its file is in Trash, where no one opens it.

Draft Worktrees can also mark individual Units for deletion and undo that intent.
Ready Worktrees freeze the intent; reopen one before changing it. Merging excludes
removed Units from content publication, then moves existing documents to Workspace
Trash. A Unit created and canceled in the same Worktree never becomes a published
document. Discarding the Worktree leaves existing documents unchanged.
The per-Unit merge result `removed` describes content exclusion; wait for both Worktree state `merged`
and a completed merge Operation before treating product deletion as finished.
A completed attempt that leaves the Worktree ready still needs another merge. Restore a merged
document through Trash, not through the draft undo action.

The Univer editors import and export XLSX/CSV/TSV, DOCX, PPTX, and PDF through the
server-side `@univerjs-pro/exchange-node` runtime (PDF conversion needs its optional
native peer `@univerjs-pro/exchange-pdf-node-binding`). These endpoints follow the
Universer Exchange shape under `/universer-api/exchange/**`; they are not part
of the product OpenAPI. The Workspace file action automatically imports
XLS/XLSX/CSV/TSV, DOC/DOCX, PPT/PPTX, and PDF as normal Univer Resources in the
selected Space and folder; other file types remain downloadable Blob Resources. Editor Ribbon imports default to the root of the signed-in user's
Personal Space. Uploaded source files, converted JSON snapshots, and export
files are temporary BlobStore objects with process-local task metadata and a
two-hour lifetime. Exchange actions are not shown for Worktree or merge-preview
editors because those scopes do not yet have scope-aware Office conversion.

Importing XLSX, DOCX or PPTX stores the pictures and embedded Office attachments
of the file as Trunk Assets of the new Unit (files over 20 MB stay inline); the
Unit keeps only Asset IDs. An embedded attachment can be converted into its own
online document from the attachment toolbar: the server checks that the caller
can open the host Unit and that the attachment belongs to it, creates the new
Unit in the host's folder when the caller may create there (otherwise in the
Personal Space root), and keeps the attachment on the host. XLSX, DOCX, PPTX
and PDF exports embed the current online version of every converted attachment:
each converted document is read with the requesting user's permissions, and the
export fails if one is not readable. API callers can pass
`options.oleAttachmentSource: "original"` to embed the original files instead.

Office export resolves managed Asset IDs through the requesting user's existing
Trunk permissions before conversion, including images in master pages and
serialized drawing resources. The export copy contains inline file bytes;
stored snapshots and Assets remain unchanged. Missing, inaccessible or invalid
images fail the export instead of producing a document with missing pictures.

Doc and Slide editors can read referenced Sheet data in the same editor runtime.
They register the Sheet data plugins needed to restore source resources, replay
changesets and resolve formulas before loading the source. Referenced Sheets do
not add a Sheet toolbar or replace the host editor; source access and Trunk or
Worktree selection continue to use the Workspace reference provider.
Live sources join the existing SDK collaboration transport in matching scopes.
The SDK owns formula dependency invalidation, calculation ordering and result
application; Workspace does not add a second formula refresh scheduler.

### Repository dashboard

Choose **Repository** in application settings to use OfficeLab's GitHub-style
dashboard. `/home` shows recently opened files, active Pull requests, and open Issues.
The dashboard connects the following views:

- `/repositories`: all accessible repositories, with name/description/owner search,
  personal/team and visibility filters, name sorting, and repository creation.
- `/worktrees`: paginated active or processed Pull requests, with server-side search
  and repository/type filters. Opening a review preserves the list's URL filters.
- `/issues`: the existing cross-repository Issue list and its filters.
- `/recent`: paginated recently opened resources.

Search in Recent covers the loaded results.
Homepage summaries have separate, bounded queries so returning from a long list does
not reload every cached page. Directory browsing reads metadata; only opening a file
or preview records a visit.
Summary-only Worktree access does not expose a review link.

Open HTML pages from the repository’s **Pages** tab or from the file tree in Wiki. Repository's navigation
uses a drawer on narrow screens and supports both interface languages and color themes.

### Markdown files

Uploaded `.md` and `.markdown` files open in a read-only CommonMark/GFM preview,
with Preview/Source switching and the original download action. Tables, task
lists, strikethrough and footnotes are supported. Preview and Source both load
the complete file without a preview size cutoff. Content must be UTF-8 text.
Raw HTML is shown as text; relative file/image paths are not resolved. External
images load only after a click. Markdown stays a Blob and does not become a
collaborative Univer Doc. The Agent remote-file viewer uses the same renderer.

### CLI sign-in and Agent access

Workspace CLI uses browser approval by default. `uvw auth login`
creates a ten-minute, one-time authorization request and prints a `/cli-login`
URL plus verification code, persists the pending request locally, and exits.
After the user approves the matching code in their own browser, the Agent runs
`uvw auth login --complete` to exchange it once; neither command
waits or polls. If necessary, the user can first sign in with an Email code, GitHub,
Google, Discord, or a password and return to the approval page. The CLI receives a separate
normal `workspace_session`; it never
receives the browser cookie, Workspace password, or provider access token.
Pending authorization requests are process-local and intentionally disappear
on server restart; completed CLI sessions remain normal persisted login sessions.

`POST /api/auth/agent-token` lets the browser Agents module use an interactive `workspace_session` cookie to request `{ "scopes": ["read"] }`, `{ "scopes": ["read", "write"] }`, or `{ "scopes": ["read", "publish"] }`, in either order without duplicates. It returns `201` with `{ token, expiresAt, scopes, resource }` and `Cache-Control: no-store`. The `uvw_at_` token lasts one hour, belongs to the first-party `univer-workspace-agents` client and is bound to `/mcp` at `PUBLIC_ORIGIN`, which must be listed in `MCP_RESOURCE_URLS`. Missing MCP OAuth configuration or a missing same-origin resource returns `503`; no cookie returns `401`, a token-exchanged session returns `403`, and invalid scopes return `400`. Normal Agent calls use `[read]` in Ask mode or `[read, write]` in Auto mode. Publish-scope calls in Auto mode pause for explicit user approval; each approved call uses its own `[read, publish]` token and MCP client, disposed after the call. The full-screen draft preview uses local trial calculations and cannot edit source Sheets or open a native editor. A new user message denies pending approvals so the agent can revise the draft. The endpoint never grants `worktree:merge`, returns no refresh token and does not add a personal access token to the account list. The gateway uses its existing token exchange.

`POST /api/agents` and `POST /api/auth/guest` create an agent User without credentials: a User of kind
`agent` with its own Personal Space that expires 30 days later. `POST /api/agents` takes an optional
`{ "label" }` and returns `201` with `{ agent: { id, username }, token, mcpUrl, expiresAt }`. `token` is a
personal access token with every MCP scope, and `mcpUrl` is the first URL in `MCP_RESOURCE_URLS`, or `null`
when none is configured. `POST /api/auth/guest` sets the `workspace_session` cookie instead and returns
`{ agent }`. It answers `409` when the request already carries a valid session, so it cannot replace a
signed-in session. When the login page returns to `/api/auth/authorize`, as in an MCP client's OAuth
sign-in, it shows a card that continues as a guest agent. The card calls `POST /api/auth/guest` with the
authorization's query string as `oauthAuthorization` and then returns to the authorization, where the guest
approves the consent page like any signed-in user. The server first checks that authorization as authorize
would. One that authorize would refuse, such as a request without a valid `resource`, answers `400` (or
`503` while a client metadata document cannot be fetched), creates no agent and does not count toward the
limit. A client metadata document is fetched at this point, before the guest exists, and authorize reuses
it. A source already at the limit gets `429` before anything is fetched. Guests may start 8 of the 32
metadata fetches the server runs at once, one in flight per source, so signed-in authorization keeps the
other 24. Each source may start 10 fetches per hour, failed or slow ones included, and then gets `429`
before anything is fetched. A cached document or a fetch already in flight costs nothing. When every
guest fetch is in use, or this source already has another fetch in flight, the request answers
`503 CLIENT_METADATA_BUSY` with `Retry-After` and fetches nothing. When that client named itself in its registration or its client metadata document, as Claude Code
does, the server names the guest after it, as in `Claude Code · 7f3k`, so agents from one client stay
distinguishable. The name follows the display-name rules: no email address, no control, invisible or
direction-changing characters, at most 40 characters. Without a client name the guest is `agent`.

While an agent is unclaimed, authenticating it or serving one of its `/nodes/:nodeId` pages moves its
expiry to 30 days ahead, at most once a day. An expired or banned agent is suspended: only the agent
and the human who claimed it can read its Personal Space and its Team Spaces, and its links answer as not found. An expired agent can still
authenticate, which ends the suspension at once, whenever it was last seen. A banned agent gets `401`, and `invalid_grant` from the token
exchange. `pnpm db:ban-agent <username or user id>` bans an agent (`db:ban-agent:production` runs the
build); it refuses a User that is not an agent, and a second run changes nothing. When the value names two
Users, as one User's ID and another's username or as two user IDs that differ only in case (both compared ignoring
case), it names each by what matched and changes nothing; use the other identifier. It runs outside the
server, so a collaboration socket the agent already holds stays open until its session ends. The MCP gateway caches a token
exchange for up to 30 seconds, so for that long a banned agent's token still gets an answer from tools
that do not call Workspace, such as `api_find`.

A person claims an agent to keep its files. The unclaimed agent calls `POST /api/agents/claim-codes`,
which returns `201` with `{ code, claimUrl, expiresIn }`, and hands `claimUrl` (`/claim/<code>` on this
origin) to the person. The code is held in server memory for ten minutes, so a restart drops it, and it
claims the agent once. A signed-in person opens the page, which reads `GET /api/agents/claim?code=` and
claims with `POST /api/agents/claim` `{ "code" }`. Both need a person's browser session: an agent, a
CLI login and a token session get `403`. On that `403` the page offers Sign out and continue, because a browser
that took the guest agent card is still signed in as the agent. It signs out and shows sign-in on the same page,
which comes back to the claim link. A used code answers `409 AGENT_ALREADY_CLAIMED` to anyone but
the person who claimed with it, a code older than ten minutes `410 AGENT_CLAIM_EXPIRED`, and an unknown
code or one older than twenty minutes `404 AGENT_CLAIM_INVALID`. Claiming sets `owner_user_id` and
`claimed_at` and clears the expiry. The claimer becomes an owner of the agent's Personal Space and
of every Team Space the agent creates, before or after the claim, and manages them in the browser; the agent gets no access to the claimer's files. The claimer also
decides the agent's pull requests: they can mark one ready, reopen, merge or discard it, in the browser,
with `uvw` and through MCP, and are recorded as the one who did it. Only the agent edits its pull
requests. A stopped agent's pull requests stay with the claimer to merge or discard. `GET /api/agents`
lists the claimer's agents with file count and last activity, and `POST /api/agents/{agentId}/stop`
stops one: it bans the agent, so its links stop working for everyone but its owners, and closes the
collaboration sockets the agent holds. There is no undo.

The shared MCP executor runs scripts for every user in one container, so the operator decides who may use it.
`pnpm db:executor-access grant <username or user id>` grants a User, `revoke` takes the access back and `list` prints
who has it, or says that nobody has it (`db:executor-access:production` runs the build; inside the runtime image run
`node dist/server/db/executor-access.js`). Running a grant or revoke twice changes nothing, and a value that names two
Users is refused like `db:ban-agent`'s. No HTTP route
changes the access, so no User or agent can grant itself. `GET /api/session` reports `executorAccess: true` and the
token exchange `executor_access: true` for a granted User, and leave the field out otherwise. With
`MCP_EXECUTOR_ALLOWED_USER_IDS=workspace` the MCP gateway and executor follow it after about 30 seconds, without a
restart. Grant the users who use the executor today before you switch MCP from `*` or a user ID list to `workspace`,
which admits nobody else.

Ceilings forbid some actions whatever role the caller holds, each with `403`. An agent can create a
Team Space and owns it. An unclaimed agent cannot make a Space public, become a Team Space member or
add one. A claimed agent can be a viewer or editor of a Team Space a human owns, and also an admin of
one an agent owns (`AGENT_NOT_ALLOWED`). An unclaimed agent owns at most 3 Team Spaces and 3 forks, and keeps at
most 20 files across all its Spaces, pending pull-request files included, each of at most 10 MiB
(`AGENT_QUOTA_EXCEEDED`), and gets Viewer at most from Link Sharing. A human's session issued for an access token cannot change Link
Sharing or make a Space public (`INTERACTIVE_SESSION_REQUIRED`). User search does not return unclaimed or stopped agents, and refuses an unclaimed
agent (`AGENT_NOT_ALLOWED`). A proposer who is not a Space Member holds at most 3 open Team Worktrees in one Team
Space (`FORBIDDEN`). Every agent, claimed or not, has at most 10 open pull requests and starts at most 50 merges in
any 24 hours (`AGENT_QUOTA_EXCEEDED`); `GET /api/session` shows its use as `budget`. People have no such budget.

`POST /api/nodes/:nodeId/reports` takes `{ "reason" }` (at most 1,000 characters) without credentials
for any Node the caller can read and returns `201` with `{ id }`. Each source IP may send 10 an hour,
then gets `429` with `REPORT_RATE_LIMITED`. The log line carries the Node and report ids only.

## Docker

For local evaluation, you can use the bundled development license. For your own domain, get a license that covers the hostname people will use to open Workspace. For plans and purchasing, see [Univer pricing](https://univer.ai/pricing/).

If you have your own license, set the `VITE_UNIVER_LICENSE` environment variable in your shell to the contents of `license.txt`. Run the following command from the repository root to pass the license to the frontend build with `--build-arg`.

```bash
docker build \
  --build-arg VITE_UNIVER_LICENSE="$VITE_UNIVER_LICENSE" \
  -f apps/workspace/Dockerfile \
  -t univer-workspace .
```

For local HTTP access, run the container with a persistent data volume:

```bash
docker run --name univer-workspace \
  -p 127.0.0.1:3020:3020 \
  -v univer-workspace-data:/app/univer-workspace/.data \
  -e SECURE_COOKIES=false \
  univer-workspace
```

For HTTPS deployments, omit `-e SECURE_COOKIES=false` to keep the image’s secure cookie default. Pass runtime settings with `--env-file ./workspace.env` when creating the container.

To start the server with your own license, set these two environment variables in `workspace.env`. Replace each placeholder with the contents of the indicated file.

```dotenv
UNIVER_LICENSE=<contents of license.txt>
UNIVER_LICENSE_KEY=<contents of licenseKey.txt>
```

### SQLite upgrades and recovery

For the backup, rollout and rollback procedure, see [SQLite upgrades and recovery](docs/storage-migration.md#sqlite-upgrades-and-recovery).

Deploy the Workspace server before upgrading `univer-workspace-cli` to a release that
addresses repositories by `owner/slug`.

### Space lists and sidebar pins

`GET /api/spaces` returns only owned and joined Spaces. Every Space response includes
`affiliation` as `owner`, `member`, or `none`; the owned/joined list uses only the first two.
`GET /api/spaces/starred` returns currently readable starred Spaces, newest star first.
`GET /api/spaces/explore` lists other public Spaces by star count, then name and ID.
Explore is currently unpaginated. Public URLs, detail and lookup access remain unchanged.

`GET /api/spaces/pins` returns `{ customized, limit, spaces }` in saved order. Eligible
pins are owned or joined Spaces and starred public Spaces. If no stored pin remains
eligible, the response contains the first eight owned or joined Spaces with
`customized: false`. `PUT /api/spaces/pins` accepts `{ spaceIds }` with 1 to 12 unique
eligible IDs and replaces the list atomically. `DELETE` restores the defaults.
Both writes are idempotent. All list and pin endpoints require a login session.

### Repository stars

Repository view shares GitHub-style navigation and a Star / Unstar control across
Space-scoped pages. Stars belong to the authenticated User and the existing Space,
persist across refresh and restart, and never grant access. The product API exposes
`GET`, `PUT` and `DELETE /api/spaces/{spaceId}/star`; writes are idempotent and all
three return `{ starred, starCount }`. All require login and current Space access.
`SpaceView.owner` supplies the existing owner's ID and username for the breadcrumb.
Watch, Fork and GitHub-only tabs are not provided. See the
[comparison and verification record](docs/proposals/repository-framework-star.md).

Repository Pull requests use the existing Worktree workflow. The list keeps Open/Closed
filters and adds local text search; details place the summary and review actions in
Overview, with document selection, draft viewing and comparison in Files changed.
Wiki and the global Workbench retain their existing dashboard. No GitHub PR model,
comments, branches or checks are introduced. See the
[reference, feature mapping and verification](docs/proposals/repository-pull-requests-tab.md).

Repository Settings uses grouped sidebar navigation and separate name/description saves,
with confirmed public-read changes in Danger Zone. A Team Space also chooses who besides its
collaborators may open pull requests while it reads publicly. Collaborator management and Trash keep
their existing permissions and APIs. See the
[comparison, remaining differences and verification](docs/proposals/repository-settings-tab.md).

Repository Pages keeps its existing page directory, browser-local default selection, copy and
visit actions, styled after the published Jekyll Primer theme rather than Pages settings.
The repository header and tab order stay unchanged. See the
[reference, differences and verification](docs/proposals/repository-pages-tab.md).

The manual `Deploy Workspace` workflow accepts an optional existing stable `vX.Y.Z`
repository tag. When provided, it checks out that tag and uses it for the container
image. When omitted, it builds the workflow dispatch commit and tags the image as
`sha-<commit>`. It then hands the image to the selected environment. A tag push does
not deploy Workspace automatically, and the deployment workflow does not publish the
CLI.

### Startup diagnostics

Startup emits synchronous JSON lines to stdout with `event: "workspace.startup"`,
`startupId`, `stage`, and `status` (`started`, `completed`, or `failed`). These
bounded diagnostics use the same Pino configuration and `LOG_LEVEL` as application
and HTTP logs. Started and completed stages use `info`; failed stages use `error`.
At `LOG_LEVEL=error`, only failed stages appear; `silent` suppresses all diagnostics.
Startup stages use a dedicated synchronous destination to preserve their order and
write before blocking work or abrupt exit. Ordinary application and HTTP logs use
an asynchronous destination and can appear between startup records.
Each line includes stage `elapsedMs`, process `uptimeMs`, `memory` (Node memory
usage in bytes, including `rss`, `heapUsed`, `heapTotal`, `external`, and
`arrayBuffers`) and V8 `heapSizeLimit` in bytes. Configuration values, document
contents and credentials are not included.

Stages cover module loading, configuration, product and Collaboration database
preparation, application creation/initialization, background jobs, WebSocket setup
and HTTP listening. Migration sub-stages identify backup, creation-fact loading,
Core/Worktree/History upgrades, validation and publication of the staging copy.
In Grafana Loki, use `{container="colla-workspace"} | json | event="workspace.startup"`
and select the affected Pod. For an OOM, inspect the last `started` stage without
a matching `completed`/`failed` within the same `startupId`; a fatal OOM cannot
reliably emit a failure record. Stage memory values are boundary samples, not peak
measurements, and there is no timer-based progress log during blocking SDK work.

### Metrics and growth loop events

Set `METRICS_TOKEN` to serve Prometheus metrics at `GET /metrics` with
`Authorization: Bearer <token>`. Without it the endpoint answers `404`.
[observability/README.md](../../observability/README.md) describes scraping and the dashboards.

Besides `http_request_duration_seconds`, four counters measure the growth loop: a file is
shared, its page is opened, and a reader signs up or connects an agent. A fifth,
`workspace_ceiling_denials_total`, counts actions that an access ceiling refused. Labels stay
low-cardinality. Node IDs, user IDs and User-Agents appear only in the log line of each growth
loop count.

| Counter | Counts | Labels |
| --- | --- | --- |
| `workspace_link_sharing_changes_total` | Link Sharing turned on or off. A role change while sharing stays on does not count | `state` (`on`, `off`), `role` (`viewer`, `editor`), `owner_category` |
| `workspace_share_page_views_total` | A `GET` page load of `/nodes/<id>` that the server renders for a Node an anonymous reader can open, including a `304` revalidation, which is a real open. `HEAD` and in-app navigation do not count | `session` (`signed_in`, `signed_out`), `owner_category` |
| `workspace_signups_total` | An account created by sign-up | `method` (`password`, `email`, `github`, `google`, `discord`, `discord_bot`), `source` |
| `workspace_guest_agents_created_total` | A guest agent created | `entry` (`api_agents` for `POST /api/agents`, `auth_guest` for `POST /api/auth/guest`) |
| `workspace_ceiling_denials_total` | An action that a ceiling refused whatever the principal's role, such as an unclaimed agent making a Space public. It has no log line | `action` (the ceiling, such as `createTeamSpace`), `code` (`AGENT_NOT_ALLOWED`, `AGENT_QUOTA_EXCEEDED` or `INTERACTIVE_SESSION_REQUIRED`), `principal_category` (`human`, `agent_claimed` or `agent_unclaimed`, the principal that attempted the action) |

`owner_category` is `human`, `agent_claimed` or `agent_unclaimed`: the owner of the file's Space.
`source` is `share_link` when the sign-up returns to `/nodes/…`, `claim_link` when it returns to a
claim page `/claim/…`, `oauth_consent` when it returns to `/api/auth/authorize…`, and `direct`
otherwise. OAuth sign-ups carry `returnTo` through the provider. Password and email sign-ups read it
from the request's `Referer`: the `returnTo` of the `/login?returnTo=…` page, or the claim page
itself, which has its own sign-in form. The claim code is never logged, here or in request logs.

Each count writes one `info` line with `event`, `schema_version` (`1`), `ts`, the labels and
these fields:

| `event` | Fields |
| --- | --- |
| `workspace.link_sharing` | `node_id`, and `user_id` of the User who changed it |
| `workspace.share_page` | `node_id`, `user_agent` (null when the request has none) |
| `workspace.signup` | `user_id`, and `node_id` from a `share_link` return path, otherwise null |
| `workspace.guest_agent` | `user_id` of the agent |

Every label combination starts at zero, so `increase()` counts the first event after a restart.
Counts live in the process and start again on restart; Prometheus keeps the history. Link preview
crawlers of chat apps also load share pages. Filter them by `user_agent` in the log lines.

Known limits:

- A password or email sign-up takes its `source` from the same-origin `Referer` of `/login`. A client
  or proxy that strips the `Referer` counts the sign-up as `direct`.
- The page reload after a sign-up and the owner's own loads of the page count as `signed_in` views.
- `role` on an `off` event is the role stored with the setting, not one a reader gets.
- Counting does not hold up the page. If it fails, the page is still served, the view is not
  counted, and the server logs a warning.

## Commands

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm db:ban-agent <username or user id>
pnpm db:executor-access grant|revoke <username or user id>
pnpm db:executor-access list
```

See [architecture.md](docs/architecture.md), [data-model.md](docs/data-model.md),
and [application-design.md](docs/application-design.md).

### Worktree discovery API

`GET /api/worktrees` returns a cursor-paginated summary page (`items`, `nextCursor`).
It defaults to active Worktrees ordered by product update time. `scope=processed`
loads history and `scope=all` includes both; `kind=user` selects the current user's
personal Worktrees, while `kind=team&teamSpaceId=<id>` selects one Team Space.
Omitting the ownership filters provides the current user's accessible overview
across Spaces without changing visibility or content permissions.

Use `limit` (1–200, default 50), `order=createdAtDesc` for creation order, and
`search` (up to 200 characters) for a literal substring in names, summaries,
creator names, or Team Space names. Search is ASCII case-insensitive; other
characters match exactly. Visibility and search are applied before pagination.
Pass `nextCursor` as `cursor` with the same filters and order until it is null.
Each page reflects current data; refresh the first page after lifecycle changes.
Summary `unitCount` includes all mapped Units, not only changed documents.
Fetch `/api/worktrees/<id>` only when Unit details are needed.

### Blob replacement

Blob content can be replaced while preserving its Resource identity and location.
Replacement requires the downloaded ETag and publishes immediately, without Worktree
review. See the [HTTP contract](contracts/http/concepts.md#resource-creation-and-opening)
for preconditions and retry behavior.

## 沉浸视图

所有资源页面支持 `?view=immersive`。点击“进入沉浸视图”在当前页隐藏 Workspace 顶栏和侧栏；
Ctrl / Command 点击、中键和右键菜单沿用浏览器的链接行为。浏览器后退可返回进入前的页面。
直接打开分享链接时，返回行为沿用浏览器的历史记录；不额外提供退出沉浸视图的控件或快捷键。
已登录用户在 Repository 布局的沉浸视图顶部看到一条细栏，栏内只有回到首页的链接。

视图参数可随链接分享，刷新和登录跳转后保留。分享弹窗在复制链接旁提供“沉浸视图”复选框，
按当前 `node.name` 判断：Blob 文件名以 `.univer.html` 结尾时默认勾选，其他资源默认不勾选。该选择只影响链接展示，不修改权限。
沉浸视图不调用浏览器原生全屏，也不移除资源自身的编辑工具。

HTML 不显示独立的加载、保存或同步状态提示，错误仍可见。
同一资源切换视图不会重建编辑器或触发 HTML 离开保存保护；
真正离开资源仍执行原有保存流程。

独立预览（实际资源页面，内存示例数据，无需后端）：

```bash
pnpm --filter @univerjs/univer-workspace exec vite --config test/vite.immersive.config.ts
```

打开 `http://127.0.0.1:5183/nodes/html` 或 `http://127.0.0.1:5183/nodes/text`。

## Anonymous viewing

Anyone with a Node link can view its content when Link Sharing is enabled or its
Space has public read enabled. Folder sharing includes current and future children;
Space public read allows browsing that Space by URL. Anonymous visitors always have
viewer access, even when a link grants editors access after sign-in. They cannot
modify source content, write comments, upload, manage permissions, or access Worktrees.
An unclaimed agent also gets only viewer access from a link.
HTML files and their source Sheets are authorized independently, as for signed-in users.

A signed-out visitor sees a bar under the header on every file and folder page, and in the
immersive view in place of the header. It names the author, the owner of the Personal Space,
and marks an agent that no person has claimed as `Unverified agent`. Once a file has been
copied, the bar shows how many copies were made; the owner sees the same count next to link
access in the Share dialog. The logo links to the GitHub repository. A `More actions` menu
holds `Remix` for files, `Hand to my agent`, `Copy link`, and `Report`. `Report` opens a dialog
that sends a reason to `POST /api/nodes/{nodeId}/reports`. `Hand to my agent` opens a dialog with a short English prompt
for the reader's own agent, in two ways. `MCP (recommended)`, selected by default, shows this
instance's MCP URL to add to the agent and a prompt that reads the file with `read` or `inspect`.
When the server hides those tools, the prompt has the agent say so and make the reader a copy to
edit in the browser, as Remix below does, and only then point to the command line.
`Command line (uvw)` gives the `uvw` guest commands that read it. The immersive bar keeps sign-up and
sign-in visible beside the menu, and can collapse. A signed-in user who opens a file in another user's
Personal Space sees the same bar under the Workspace header, without sign-up, sign-in or collapse.
The owner and Team Space members see only the Workspace header.

`Remix` in the bar copies the file into a signed-in reader's Personal Space and opens the copy.
A page is copied with the Sheets it binds, and its copy is bound to their copies; when the
reader cannot open one of those Sheets, nothing is copied. A signed-out visitor gets two ways
to a copy: sign up, and the copy is made on return, or hand a short English prompt to their own
agent, with the same two ways as `Hand to my agent`. Through MCP the agent copies the file into a
pull request with `unit_create` and `from`, which needs no `read`; through `uvw` it uses
`uvw unit create --from`. Either way it merges the pull request and gives the visitor a claim
link that makes the copy theirs, and the copy's link. Both prompts have the agent tell
the visitor to open the claim link first: the copy is theirs to edit once they claim it, and until then its link opens
only if the agent shared it. An agent cannot copy a page, so for a page the dialog
offers sign-up only. A copy asked for before sign-up waits in the tab for 15 minutes, and only
the sign-up return it was asked from makes it.

Workspace Browser enables local trial edits in bound HTML pages for anonymous and
signed-in users without edit permission. Sources remain live until the first page
write, which detaches that source from collaboration. The real formula engine
recalculates in the visitor's browser; trial edits are never saved or sent. That
source remains frozen against further owner updates until reload restores live data.
The host displays a trial notice after the first edit, and pages can check
`window.univerWorkspace.getWriteMode(unitId)` before labeling a write as saved.
On `/nodes/<nodeId>` the trial notice offers `Save my version`, which copies the page and the
Sheets it binds the way `Remix` does and opens the copy; a signed-out visitor signs up first.
Trial edits are not carried into the copy.
Native Office previews remain read-only for these users. Other hosts, including
Workspace Agent, retain write rejections unless they explicitly enable HTML trials.

In production, `/nodes/<nodeId>` links (including `?view=immersive`) include the page's
title and a short description in the HTML head for chat previews when anonymous access
is allowed. HTML views omit `.univer.html` from the display title. Descriptions follow
`Accept-Language` (English or Chinese); responses vary by that header and retain the
app shell's revalidation policy. Set `PUBLIC_ORIGIN` to include an absolute `og:url` and a
1200x630 preview image for the Node's kind (Sheet, Doc, Slide, HTML view, folder, or any
other file) with a large-image card. Without `PUBLIC_ORIGIN` both are omitted, because
Open Graph requires absolute image URLs and the request host is not trusted.
Private, deleted and missing Nodes keep the generic app shell.
The images are static files in `web/public/link-preview`; rebuild them with
`node scripts/render-link-preview-images.mjs`, which needs Google Chrome and ImageMagick.
The Vite development server does not generate these previews.

These rules apply to existing enabled settings after upgrade. No anonymous accounts,
login sessions, Recent entries, schema changes or database migration are introduced.
Serving the page of a file that an unclaimed agent owns moves that agent's expiry, at most
once a day. A banned or expired agent's links answer as not found.
The public link uses the existing Node URL, including immersive-view parameters.
Each read request and Unit join checks current permissions. Link Sharing changes
retain the existing realtime connection invalidation. Space public-read changes,
Node moves and deletion do not add active-connection eviction; existing subscriptions
may continue receiving updates until disconnected. Reconnecting readers are authorized again.

## HTML-native Office previews

Browser `.univer.html` files can call `window.univerWorkspace.showUnit(unitId, slot)`
to open a live Sheet, Doc or Slides with server-authorized editing inside their layout, while keeping
HTML cell bindings active. Each target is independently authorized; sharing the
HTML does not share its source files. `hideUnit()` closes the preview, and the
host's **Open file** action leads to the standard editor. Stable paragraph, cell
and slide navigation are supported. See the [page API and limits](../../docs/design/html-views/native-preview.md).

### Unit content edit protection

Sheet, Doc, Slide, Board and Base use the SDK protection UI and server mutation analysis.
Editors create protections; their creator and current Owner/Admin manage them. Worktrees
inherit current Trunk policy and cannot manage bindings or collaborators. Content remains
readable under the existing file permissions, including snapshots, history and exports.
See [validation and release gate](docs/content-permissions-validation.md).

HTML View 草稿由 `/api/html-view-drafts` 提交，只对作者可见。草稿内容最多 512 KiB，
接收中一小时、待发布七天到期；发布和拒绝需要作者的交互式 Session。V18→V19 仅新增草稿表
及索引。升级先停止旧实例，启动单个新实例完成自动迁移，确认成功后再恢复服务；回退必须
停止新实例并恢复配套备份，不允许新旧版本同时写同一 SQLite 文件。


### Skill drafts and product database V20

`POST /api/skill-drafts` stages author-private Agent Skills from text `files` or a pinned `from` source.
Agents can create and read drafts.
Only the author's interactive Session can publish or reject them. The response includes a
`previewPath` at `/drafts/skills/<id>` for the browser review page, which is implemented separately.
File content and current-version content are available through the author-private content endpoint.
The [HTTP contract](contracts/http/paths/skill-drafts.yaml) describes requests and responses.

`POST /api/skill-sources/read` accepts GitHub repo, tree and blob URLs, skills.sh
links and `npx skills add` commands, ClawHub owner links and `clawhub install`
commands, or the node ID of a readable Space zip or folder. It returns a pinned
source and candidate paths. Pass that source and a candidate `skill` path to
inspect file metadata, `SKILL.md` and static findings, or add `path` to page a text
file. A root Skill uses `.`. Repeat reads and draft imports use the resolved source
object. Git sources pin a commit, ClawHub pins owner, slug and version, and Space
pins the node ETag. A changed Space source returns 409.

`from: { source, skill, overrides? }` copies text and binary bytes. Each override
has `path` and `text`; `null` deletes the path. `files` and `from` are mutually
exclusive. Imports stamp string-valued provenance into `SKILL.md` frontmatter
`metadata` and return the resolved `source` in the draft view. Invalid upstream
frontmatter requires a valid `SKILL.md` override matching the draft name.

Each Skill allows 100 files and 20 MiB total, with `SKILL.md` capped at 64 KiB and
binary files at 10 MiB. Text reads allow 256 KiB. Archives allow 1,000 entries,
20 MiB per entry, 100 MiB total and a 100:1 expansion ratio per entry. The server
rejects unsafe paths, symlinks, encryption, multipart and ZIP64 archives before
extraction. Requests time out after 15 seconds and follow at most five redirects,
only within `api.github.com`, `raw.githubusercontent.com` and `clawhub.ai`.

Publication rescans stored bytes, checks the complete replacement base, and adopts all file objects
into `.agents/skills/<name>/` in one product database transaction. Removed files move to Trash. Failed writes
roll back together. No Operation or publication recovery step is added. Receiving drafts expire after
one hour and pending drafts after seven days. Rejected, expired and conflicted drafts enqueue every
file object for deletion through Blob maintenance.

V19→V20 adds only `skill_drafts` and its expiry index. Stop every old instance, start one V20 instance,
and wait for its consistent backup, migration and health checks before restoring service. Existing
product rows, object keys and unfinished recovery state are preserved. Failed migration rolls back;
successful restarts do not repeat migration or backup. To roll back, stop V20 and restore the V19
backup. Never run V19 and V20 writers on the same SQLite file.

### Agent identities and product database V21

V20→V21 appends `users.kind` (`human` or `agent`, existing Users read as `human`) and adds the `agents`
and `node_reports` tables. Stop every old instance, start one V21 instance, and wait for its consistent
backup, migration and health checks before restoring service. Existing product rows, object keys and
unfinished recovery state are preserved. Failed migration rolls back; successful restarts do not repeat
migration or backup. To roll back, stop V21 and restore the V20 backup. Never run V20 and V21 writers on
the same SQLite file.

### Display names and product database V22

V21→V22 keeps the schema and repairs data to the display-name rule. On PostgreSQL the same repair moves
`workspace_product_schema` from version 1 to 2. Only a display name that holds an email address, nothing
visible or a misleading character is rewritten. Controls, line and paragraph separators, U+2800 and U+1D159
become spaces. Default-ignorable characters such as bidi controls, Hangul fillers and zero-width spaces,
other format characters except prepended concatenation marks such as U+0600, unpaired surrogates and U+FFFD
are removed. A zero-width joiner or non-joiner between two non-space characters, a zero-width joiner after
a virama, a variation selector after a character, and the tag characters of an England, Scotland or Wales flag
stay; a zero-width non-joiner after a virama at the end of a name is removed. An address
keeps its local part. Every other name stays byte for byte, emoji and joined scripts included. A Personal Space still named after its owner's old display name, such as
`alice@example.com 的个人空间`, is renamed with it. Other names and rows are preserved. Stop every old
instance, start one V22 instance, and wait for its consistent backup, migration and health checks before
restoring service. Back up PostgreSQL before the upgrade. Failed migration rolls
back; successful restarts do not repeat migration or backup. To roll back, stop V22 and restore the V21
backup. Never run V21 and V22 writers on the same SQLite file.

### Executor access and product database V23

V22→V23 adds only the empty `executor_access` table; PostgreSQL moves from product schema version 2 to 3 the
same way, in one transaction at startup. Stop every old instance, start one V23 instance, and wait for its
backup, migration and health checks before restoring service. Existing rows, object keys and unfinished recovery
state are preserved. Failed migration rolls back; successful restarts do not repeat migration or backup. To roll
back, stop V23 and restore the V22 backup (PostgreSQL: the database backup taken before the upgrade). An older
instance refuses to start on V23. Upgrade Workspace before setting the MCP executor to `workspace`: an older
Workspace reports no access, so the executor would refuse everyone until the upgrade.

### Copy source and product database V24

`POST /api/nodes/{nodeId}/copies` turns a Sheet, Doc, Slide or Blob file the requester can open into a
file of their own, at the root of their Personal Space or as a new file in a draft pull request. The copy
gets its own content and its own embedded images, and `GET /api/nodes/{nodeId}` returns its source as
`copiedFromNodeId` to the copy's owner and editors, and how many files were copied from it as
`copyCount`. A copy whose request is interrupted finishes in the background. A copy that cannot finish
removes what it created. [HTTP concepts](contracts/http/concepts.md#copying-a-file)

V23→V24 appends `nodes.copied_from_node_id`, `worktree_node_intents.copied_from_node_id`,
`node_link_sharing.unverified_role` (existing rows read `viewer`) and `node_link_sharing.making_of_note`,
and rebuilds `operations` so that its kind CHECK accepts `copy_node`. Stop every old instance, start one
V24 instance, and wait for its consistent backup, migration and health checks before restoring service.
Existing product rows, object keys and unfinished recovery state are preserved. Failed migration rolls
back; successful restarts do not repeat migration or backup. To roll back, stop V24 and restore the V23
backup. Never run V23 and V24 writers on the same SQLite file.

A PostgreSQL deployment upgrades product schema version 3 to version 4 in one transaction at startup. A
failed upgrade rolls back and leaves version 3. The server does not back up PostgreSQL, so back up the
database and stop every old instance before you start the new version.

### Display names converge at product database V25

V24→V25 keeps the schema and runs the V22 display-name repair again over every User and Personal Space. On
PostgreSQL the same step moves `workspace_product_schema` from version 4 to 5. A database whose V22 ran the current
rule changes nothing. A database whose V22 ran the earlier rule deployed from 47dc9277 kept names that rule missed;
this step rewrites them as V22 now would, with the Personal Spaces still named after them. Every other name and row stays
byte for byte, and `agents.origin_label` is not touched. That earlier rule also removed the zero-width joiner after
a virama from legitimate names in scripts such as Devanagari, Tamil, Malayalam and Sinhala. This step cannot bring
it back: only that environment's backup taken
before V22 (`*.v21-backup-*.sqlite`, or the PostgreSQL backup taken before the upgrade) still holds those names.
Stop every old instance, start one V25 instance, and wait for its backup, migration and health checks before
restoring service. Back up PostgreSQL before the upgrade. Failed migration rolls back; successful restarts do not
repeat migration or backup. To roll back, stop V25 and restore the V24 backup. Never run V24 and V25 writers on the
same SQLite file.

### Forks and product database V28

A fork is a User's named view of a Team Space they can propose in: its owner, the human who claimed its agent
owner, a Space Member of any role, or a reader its `proposals` setting admits. `POST /api/forks` takes `{ upstreamSpaceId, name }` and writes one `forks`
row. It copies no Node, Resource, Unit, Blob or Collaboration data. `GET /api/forks`, `GET /api/forks/lookup?owner&name`,
`GET /api/forks/{forkId}` and `DELETE /api/forks/{forkId}` serve only the fork's owner. A fork's name shares the
owner's namespace with Team Space slugs (`409 SPACE_SLUG_TAKEN`). `POST /api/forks/{forkId}/units` writes a Unit
through the fork, and `POST /api/forks/{forkId}/worktree` opens or returns the fork's Worktree for a write that adds no
Unit, such as an HTML View draft. Its first write opens the fork's one Team Worktree in the upstream, and the fork's `state` follows
that Worktree. A fork whose Worktree is not a draft refuses writes with `409 FORK_WORKTREE_NOT_DRAFT`. Deleting a fork
removes only its row.

V27→V28 adds the `forks` table, the nullable `worktrees.fork_id` column and the partial unique index
`worktrees_open_fork`, and changes no existing row. On PostgreSQL the same step moves `workspace_product_schema`
from version 7 to 8. Stop every old instance, start one V28 instance, and wait for its backup, migration and health
checks before restoring service. Back up PostgreSQL before the upgrade. Failed migration rolls back; successful
restarts do not repeat migration or backup. V27 code refuses a V28 database, so a code rollback needs the backup
taken before the upgrade: stop V28 and restore it, which loses what was written since. Never run V27 and V28 writers
on the same SQLite file.

### Proposals from readers and product database V29

A Team Space's `proposals` setting says who besides its Space Members may fork it and open Team Worktrees in it while
it reads publicly: `members` (the default) admits no one else, `accountable` admits any person and any claimed agent
who can read it, and `anyone` also admits unclaimed agents. The owner or an admin sets it in the repository settings
page, with `PATCH /api/spaces/{spaceId}`, or in `POST /api/team-spaces`. `SpaceView.capabilities.propose` tells the
caller whether it may propose. Such a proposer writes only its own proposals, holds at most 3 open ones per Team Space,
never becomes a member and cannot merge. Turning the setting back to `members`, or turning public read off, freezes
its drafts, and its ready proposals stay for the members to merge or discard. `uvw repo edit` and the MCP `repo_edit`
tool do not set it yet.

V28→V29 adds the column `spaces.proposals` with the default `members` and a CHECK on its three values, and changes no
existing row's meaning. On PostgreSQL the same step moves `workspace_product_schema` from version 8 to 9. Stop every
old instance, start one V29 instance, and wait for its backup, migration and health checks before restoring service.
Back up PostgreSQL before the upgrade. Failed migration rolls back; successful restarts do not repeat migration or
backup. V28 code refuses a V29 database, so a code rollback needs the backup taken before the upgrade: stop V29 and
restore it, which loses what was written since. Never run V28 and V29 writers on the same SQLite file.

### Issue links and product database V30

A Team Worktree, a pull request, may name one Issue of its Team Space that it serves. Whoever may change its summary
sets the link with `issueNumber` on `POST /api/worktrees` or `PATCH /api/worktrees/{worktreeId}`, `uvw pr create|edit
--issue <N>`, or the MCP `pr_create` and `pr_edit` tools, and only while they can read the Team Space. A fork's pull
request is linked after its first write opens it. The pull request page shows the Issue, and the Issue page, `uvw issue
view` and the MCP `issue_view` tool list the linked pull requests the reader may see.

V29→V30 adds the nullable column `worktrees.issue_id`, a foreign key to `issues` with `ON DELETE SET NULL`, a CHECK
that only a Team Worktree has one, and the partial index `worktrees_issue`. Existing rows read null. On PostgreSQL the
same step moves `workspace_product_schema` from version 9 to 10. Stop every old instance, start one V30 instance, and
wait for its backup, migration and health checks before restoring service. Back up PostgreSQL before the upgrade.
Failed migration rolls back; successful restarts do not repeat migration or backup. V29 code refuses a V30 database,
so a code rollback needs the backup taken before the upgrade: stop V30 and restore it, which loses what was written
since. Never run V29 and V30 writers on the same SQLite file.

### Issue acceptance and product database V31

An assignee of an open Issue, with any member role, submits it for acceptance with a summary of what was done, checked
and assumed. Whoever may close the Issue, its author or a member who may triage Issues, then accepts it, which closes it
as completed, or sends it back with a reason, after which an assignee submits again. Use `POST
/api/spaces/{spaceId}/issues/{number}/verdicts`, `uvw issue submit|accept|send-back`, the MCP `issue_verdict` tool, or
the Accept and Send back buttons in the Issue page's acceptance panel. The Issue shows its latest verdict as `acceptance`, the timeline shows
every verdict, and `acceptance=submitted|sent_back` filters Issue lists.

V30→V31 adds the empty table `issue_verdicts` with the index `issue_verdicts_issue`, and the nullable column
`spaces.accept_after_hours`, which nothing reads yet. Existing rows read null. On PostgreSQL the same step moves
`workspace_product_schema` from version 10 to 11. Stop every old instance, start one V31 instance, and wait for its
backup, migration and health checks before restoring service. Back up PostgreSQL before the upgrade. Failed migration
rolls back; successful restarts do not repeat migration or backup. V30 code refuses a V31 database, so a code rollback
needs the backup taken before the upgrade: stop V31 and restore it, which loses what was written since. Never run V30
and V31 writers on the same SQLite file.

### Pull request checks and product database V32

A Team Space declares the checks its pull requests should pass in `.agents/checks.md` on Trunk. Each `## name` heading
outside fenced code is one check. A name is 1 to 40 lowercase letters, digits or hyphens; other headings, and names past
the first 20, are only text. The text under each heading tells an agent what to verify:

```markdown
## totals-match
`Sales/North` B5 equals SUM(B2:B4), and the same in South and East.

## header-unchanged
Row 1 of every Sheet under `Sales/` matches Trunk.
```

The server reads the file from Trunk with the reader's access, so a pull request that edits it does not change its own
checks. Anyone who may review a ready pull request reports a check with `PUT /api/worktrees/{id}/checks/{name}`,
`uvw pr check`, or the MCP `pr_check` tool. The server binds each result to the pull request's current content. A Trunk
edit to one of its files, or a reopen that changes its content, leaves earlier results visible but out of date. A result
counts when its reporter may merge the pull request. `GET /api/worktrees/{id}/checks` and MCP `pr_view` list every
declared check and every result. The pull request page shows them, and so does the Issue page's acceptance panel after
each linked pull request the reader may review, saying so when the repository declares no checks. Nothing blocks a merge
on checks yet.

V31→V32 adds the empty table `worktree_checks`. On PostgreSQL the same step moves `workspace_product_schema` from
version 11 to 12. Stop every old instance, start one V32 instance, and wait for its backup, migration and health checks
before restoring service. Back up PostgreSQL before the upgrade. Failed migration rolls back; successful restarts do not
repeat migration or backup. V31 code refuses a V32 database, so a code rollback needs the backup taken before the
upgrade: stop V32 and restore it, which loses what was written since. Never run V31 and V32 writers on the same SQLite
file.
