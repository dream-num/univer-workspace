# Univer Workspace MCP

A private remote MCP application built on `@univerjs/univer-workspace-client-core`.
Stage A and the Stage B slices so far expose identity, repositories, Issues, pull requests,
search, browse, files in a pull request, repository and label administration, merge or
discard, the Facade API reference and the Skills over Streamable HTTP using the 2026-07-28 and 2025-11-25 protocols. Results match
the CLI `--json` output and add Browser URLs. Lists return `{ repos: [...] }` in both protocols.

The gateway talks to Workspace through HTTP. It has no database and does not import
the CLI application. Workspace remains the authority for identity and permissions.

## Roles and limits

One image selects its role through `MCP_ROLE`. `gateway` serves requests.
`executor` and `renderer` print that they are not implemented in Stage A and exit 1.
A missing or unknown role exits 1 and lists the valid roles.

## Authentication

The gateway never forwards the caller's bearer to Workspace product APIs. A bearer starting with
`uvw_pat_` (personal access token) or `uvw_at_` (MCP OAuth access token) is exchanged with Workspace
(`POST /api/auth/token`, RFC 8693) as the confidential client `MCP_OAUTH_CLIENT_ID`. The response
carries a short-lived downstream session, the user and the granted scopes. Product requests send only
that session. The gateway caches the result by the SHA-256 of the bearer for at most 30 seconds (and
never beyond the session's `expires_in` minus 5 seconds). After revocation, `initialize`, `tools/list`,
tools that make no Workspace request (`whoami`, `skills_read`, `api_*`), and resources may still succeed
from cache for up to 30 seconds. Every Workspace-backed call fails immediately because revocation deletes
the downstream session. A downstream 401 evicts the cached session and triggers one token re-exchange.
The consumed MCP request returns HTTP 401 without replaying the tool. If the token still exchanges,
the challenge omits `error="invalid_token"` so the client can retry with the same token. A rejected token
gets `error="invalid_token"`; exchange faults return HTTP 500.
Concurrent calls with the same bearer share one exchange. Positive entries and in-flight exchanges share
a cache capped at 10,000 entries. An `invalid_grant` result is cached separately for 5 seconds, capped at
1,000 entries. Before FIFO eviction, each cache sweeps its expired entries. In-flight exchanges are never
evicted. If they fill the positive cache, new exchanges proceed without caching their results.

| Outcome of the exchange | Gateway response |
| --- | --- |
| Success | The request proceeds with the exchanged scopes. The usage event records `auth_kind` `pat` or `oauth` |
| `invalid_grant` (unknown, expired, revoked or mismatched token) | HTTP 401 with the `WWW-Authenticate` challenge |
| `invalid_client`, `unauthorized_client`, any other failure, or Workspace unreachable | HTTP 500 and an error log without credentials |

With `MCP_DEV_SESSION_PASSTHROUGH=1`, any other bearer is treated as a Workspace session, checked through
Client Core `whoami` on every request, with every scope (`auth_kind` `dev`). A `uvw_pat_` or `uvw_at_` bearer is
never used as a session: without exchange configuration it gets HTTP 401. Production rejects any non-empty
`MCP_DEV_SESSION_PASSTHROUGH`. Development authentication must never appear in SaaS configuration.
Until Stage G passes, use the gateway only locally or in internal single-user environments.

## Configuration

The gateway validates configuration before listening and retains a readonly configuration.

| Variable | Default | Meaning |
| --- | --- | --- |
| `MCP_ROLE` | Required | `gateway`, `executor`, or `renderer` |
| `HOST` | `127.0.0.1` | Listen address. The image sets `0.0.0.0` |
| `PORT` | `3000` | TCP port, from 1 through 65535 |
| `WORKSPACE_ORIGIN` | Required | HTTP(S) identity origin without a path or credentials |
| `WORKSPACE_TRANSPORT_URL` | `WORKSPACE_ORIGIN` | HTTP(S) transport origin. Used only to send requests |
| `MCP_PUBLIC_URL` | Required | HTTP(S) endpoint URL ending in `/mcp` |
| `METRICS_TOKEN` | Unset | Bearer token for `/metrics`. Unset or empty hides the endpoint |
| `MCP_OAUTH_CLIENT_ID`, `MCP_OAUTH_CLIENT_SECRET` | Unset | Confidential Workspace client with `tokenExchange` enabled. Set both or neither. Enables PAT and OAuth access token authentication |
| `MCP_DEV_SESSION_PASSTHROUGH` | Unset | `1` enables development session authentication. At least one of this and the client pair is required |
| `NODE_ENV` | Inherited | `production` forbids development authentication. The image sets `production` |
| `LOG_LEVEL` | `info` | Pino level, including `debug`, `warn`, `error`, `fatal`, `trace`, and `silent` |

The identity origin appears in `whoami` and repository URLs and controls repository
URL validation. `WORKSPACE_TRANSPORT_URL` can point to `host.docker.internal` for
Docker Desktop without changing those identities.

## Endpoints and tools

| Endpoint | Behavior |
| --- | --- |
| `GET /healthz` | Returns 200 without contacting Workspace |
| `GET /metrics` | Prometheus text with a matching bearer token. Returns 404 when unset, or 401 with `WWW-Authenticate: Bearer` on mismatch |
| `GET /.well-known/oauth-protected-resource` and `/mcp` suffix | RFC 9728 metadata `{ resource: MCP_PUBLIC_URL, authorization_servers: [WORKSPACE_ORIGIN], scopes_supported, bearer_methods_supported }`. No authentication, `Cache-Control: public, max-age=300` |
| `/mcp` | MCP Streamable HTTP. Validates Host, optional Origin, bearer authentication, and toolset selection before SDK dispatch |
| Other paths | Returns 404 |

`/mcp` defaults to `core`. Use `?toolsets=core,files,admin` to select groups or
`?toolsets=all` for every group. Unknown names return HTTP 400 with the valid names.
Tools list in one fixed order: `core`, then `files`, then `admin`, each in the order below.
Every object with a Browser page carries `url`; a Node's `url` is its Browser page, a Unit's the pull request page with `?unit=`.

| Tool | Arguments | Structured result |
| --- | --- | --- |
| `whoami` | None | `{ origin, subject: { id, name } }` |
| `repo_list` | Optional `owner`, `type`, `limit` | `{ repos: [...] }`. Limit defaults to 30. Owner accepts a username or `@me`. Type accepts `personal` or `team` |
| `repo_view` | Required `repo` | Repository fields, `starCount`, `starred`, and `url`. Accepts owner/slug, owner/personal, Space ID, or Workspace URL |
| `issue_list` | Required `repo`; optional `state` (default `open`), `labels`, `assignee`, `author`, `search`, `limit` (default 30) | `{ issues: [...] }` |
| `issue_view` | Required `repo`, `number` (`12`, `#12` or Issue URL); optional `comments` | Issue, plus `timeline` when `comments` is true |
| `issue_create` | Required `repo`, `title`; optional `body`, `labels`, `assignees`, `nodes` | Issue |
| `issue_edit` | Required `repo`, `number`; optional `title`, `body`, `add_labels`, `remove_labels`, `add_assignees`, `remove_assignees`, `add_nodes`, `remove_nodes` | Issue |
| `issue_comment` | Required `repo`, `number`, `body` | Comment |
| `issue_set_state` | Required `repo`, `number`, `state` (`open` or `closed`); optional `reason` (`completed` or `not_planned`) and `comment`, only with `closed` | Issue |
| `pr_list` | Required `repo`; optional `state` (`open` default, `merged`, `discarded`, `all`), `author`, `search`, `limit` (default 30) | `{ prs: [...] }`. A Personal Space lists only the signed-in user's own |
| `pr_view` | Required `repo`, `number` (`12`, `#12`, pull request URL or Worktree ID) | Worktree (pull request) |
| `pr_create` | Required `repo`, `title`; optional `body`, `visibility` (`private` or `space`), `idempotency_key` | Worktree. Reusing a key returns the same pull request |
| `pr_edit` | Required `repo`, `number`; at least one of `title`, `body`, `visibility` | Worktree |
| `pr_ready` | Required `repo`, `number`; optional `undo` | Worktree, now `ready` (or `draft` with `undo`). Merging stays with the user |
| `search` | Required `kind` (`issues` or `prs`); optional `state`, `author`, `search`, `limit`, and for Issues `labels`, `assignee` | `{ issues: [...] }` or `{ prs: [...] }` across every repository |
| `browse` | Required `repo`; optional `number` (Issue or pull request) and `unit` | `{ url }` |
| `space_browse` | Required `repo`; optional `parent` (Node ID), `recursive`, `resource_kind` (`none`, `univer`, `blob`), `unit_type` (only with `univer`) | `{ nodes: [...] }` |
| `space_find` | Required `space`, `query`; optional `resource_kind`, `unit_type` | `{ nodes: [...] }`, names containing the query |
| `unit_list` | Required `worktree` (Worktree ID) | `{ units: [...] }`, each with the pull request page `url` |
| `unit_add` | Required `worktree`, `resource` (Resource ID of an existing file) | `{ unit }` |
| `unit_create` | Required `worktree`, `space`, `type` (`sheet`, `doc`, `slide`, `base`, `board`), `name`; optional `parent`, `idempotency_key` | `{ unit }`. Reusing a key returns the same Unit |
| `api_find` | Required `terms` (searched independently); optional `unit` (`sheet`, `slide`, `doc`, `base`, `board`) | `{ results: [{ term, matches, totalMatches }] }` from `@univer-cli/api-reference` |
| `api_show` | Required `symbols`; optional `cursor` | `{ results: [...] }`, one `found` or `not-found` entry per symbol, from `@univer-cli/api-reference`. A long class is paged (below) |
| `skills_read` | Optional `name`, `resource`, `full`, `cursor` | Without `name`: `{ skills: [{ name, description }] }`. With `name`: `{ skills: [{ name, content, resources?, files? }] }`. With `name` and `resource`: `{ name, path, content }`. Each `resources[].readCommand` is the instruction to call `skills_read` with that `name` and `resource` |

`files` toolset:

| Tool | Arguments | Structured result |
| --- | --- | --- |
| `blob_get` | Required `resource` | `{ node, resource }` |

`admin` toolset:

| Tool | Arguments | Structured result |
| --- | --- | --- |
| `repo_create` | Required `slug`; optional `name` (defaults to the slug), `description` (at most 350 characters), `public` | Repository with `url`. Takes effect immediately |
| `repo_edit` | Required `repo`; at least one of `name`, `description`, `visibility` (`public` or `private`), `slug` | Repository with `url`. Takes effect immediately; a new slug breaks old references |
| `label_list` | Required `repo` | `{ labels: [...] }` with `openIssueCount` |
| `label_write` | Required `repo`, `action` (`create`, `edit`, `delete`), `name`; `color` for create; optional `new_name`, `color`, `description` | Label, or `{ deleted }` |
| `space_node` | Required `action` (`create`, `rename`, `move`, `trash`); `repo` and `name` for create, `node` for the rest, `name` for rename, exactly one of `parent` and `root` for move | `{ node }`, or `{ trashBatch }` for trash. Takes effect immediately |
| `pr_merge` | Required `repo`, `number` | Worktree, now `merged`. Only when the user asked |
| `pr_discard` | Required `repo`, `number` | Worktree, now `discarded`. Cannot be undone. Only when the user asked |

## Reference, Skills and server instructions

`@univer-cli/api-reference` 1.3.1 is the same offline Facade API index the CLI uses. The CLI's `api find` and
`api show` print text and have no `--json`, so `api_find` and `api_show` return the library's own structured
results, wrapped as `{ results }`. The gateway reads the CLI's Skills from `dist/skill-data`, which the build
copies from `apps/cli/skill-data`; it never imports `apps/cli`. `skills_read` returns the CLI's `skills list`,
`skills get` and `skills read` data. Skill text is unchanged, so it still names `uvw` commands: the tool with the
same name in snake_case does the same thing when it appears in the connection's tool list. If no matching
tool exists, that step is unavailable in this connection; tell the user instead of guessing. Admin tools
require `?toolsets=admin` (alone or with other toolsets) or `?toolsets=all`.

Every Skill file is also an MCP resource, in every toolset selection: `uvw://skills/<name>/SKILL.md` and
`uvw://skills/<name>/references/<file>` (or `templates/<file>`), as `text/markdown`.

The server `instructions` carry the `core` Skill's workflow rules for clients without Skill support (ChatGPT,
WorkBuddy): find the file, open a pull request, write, read back to verify, mark ready, hand the review link to
the user, and leave merging to the user.

Result size: a tool result whose `structuredContent` would exceed 100,000 characters is never sent whole.
`api_show` pages a long class member by member, and `skills_read` pages a long `resource` by characters. A page
has `truncated: true` and an opaque `cursor`; calling the same tool with the same arguments and that cursor
returns the next page, and the last page has neither field. Each `api_show` page repeats the class header
(declaration, lineage, documentation) with its slice of `groups`. The cursor is stateless. It encodes the offset
and a digest of the other arguments, so reusing it with different arguments is `workspace-argument-invalid`.
Any other tool, and `skills_read` with `full`, returns `workspace-result-too-large` when it would exceed the
limit. For `skills_read` with `full`, read the skill without `full`, then each resource with `resource`,
following its cursor when paged. Other oversized results tell the agent to narrow the request.

Every tool declares a scope (`read` for `whoami`, `repo_list`, `repo_view`, `issue_list`, `issue_view`, `pr_list`, `pr_view`,
`search`, `browse`, `space_browse`, `space_find`, `unit_list`, `api_find`, `api_show`, `skills_read`, `blob_get` and `label_list`; `write` for the Issue tools, `pr_create`, `pr_edit`,
`pr_ready`, `unit_add`, `unit_create` and `label_write`; `publish` for `repo_create`, `repo_edit` and `space_node`; `worktree:merge` for
`pr_merge` and `pr_discard`) and all three annotations (`readOnlyHint` is true only for the read tools, `destructiveHint` is
true only for `repo_edit`, `label_write`, `space_node`, `pr_merge` and `pr_discard`, `openWorldHint` is false) and an output schema. The scopes come from the exchange (unknown
names are ignored); development passthrough grants all of them. A connection without the tool's scope gets the tool error `workspace-scope-required`.
Invalid arguments return `workspace-argument-invalid` with the validation issues in `detail`; a result that
violates a tool's output schema is an `internal_error`. A write whose outcome is unknown returns
`workspace-result-unknown`. Tool failures preserve Client Core's
`{ code, message, detail }` in `structuredContent` and set `isError: true`.
Authentication failures return HTTP 401 and
`WWW-Authenticate: Bearer resource_metadata="<public origin>/.well-known/oauth-protected-resource/mcp"`,
adding `error="invalid_token"` when a presented bearer is rejected. Both this 401 and protected-resource
metadata carry `Access-Control-Allow-Origin: *`; the 401 also exposes `WWW-Authenticate`.
The CORS headers make protected-resource metadata readable from browsers. Cross-origin browser calls
to `/mcp` remain refused by the Origin check.

Requests may provide `x-request-id` matching `^[a-zA-Z0-9._-]{1,128}$`.
The gateway generates a UUID otherwise, echoes it, and forwards it to every Workspace request.

## Usage event contract

Logs use pino JSON on stdout. Each authenticated `tools/call` emits exactly one
`mcp.tool_call` event at info level. Keep `LOG_LEVEL=info` to collect usage events.
Request logs include only the method, path, request ID, status, and duration.
Header redaction protects authorization and cookie fields. Logs exclude raw tool arguments.

The version 1 event has these fields:

| Field | Type and meaning |
| --- | --- |
| `event` | `"mcp.tool_call"` |
| `schema_version` | `1` |
| `ts` | ISO timestamp |
| `request_id` | Non-empty correlation ID |
| `trace_id` | Request `_meta.traceparent`, or null |
| `user_id` | Authenticated Workspace user ID |
| `auth_kind` | `"pat"`, `"oauth"` or `"dev"` |
| `client_id` | The PAT ID for `pat`, the OAuth `client_id` for `oauth`, `"dev"` for `dev` |
| `client_name`, `client_version` | Request clientInfo in 2026-07-28. Both null in stateless 2025-11-25 |
| `tool`, `toolset` | Tool name and group. Unknown tools use `unknown` and `core` |
| `repo` | Resolved Space ID for repository-scoped tools, otherwise null |
| `unit_type` | Null in Stage A |
| `outcome` | `ok`, `tool_error`, `auth_error`, `rate_limited`, `timeout`, or `internal_error` |
| `error_code` | For `tool_error`, the same code the tool result returns in `structuredContent.code`, including Workspace codes such as `NOT_FOUND`; otherwise null |
| `duration_ms` | Non-negative total gateway duration including authentication |
| `executor` | `"none"` in Stage A |
| `cost` | Object containing `worker_cpu_ms`, `worker_peak_rss_mb`, `render_pages`, `export_bytes`, `upload_bytes`, and `committed_revisions`. All six are 0 in Stage A |

Only `trace_id`, `client_name`, `client_version`, `repo`, `unit_type`, and `error_code`
can be null. Requests rejected before tool dispatch do not emit a usage event.
The gateway owns an isolated Prometheus registry with
`mcp_tool_calls_total{tool,client,outcome}` and `mcp_tool_duration_seconds{tool}`.
The `client` label is the `auth_kind` (`pat`, `oauth` or `dev`), never an ID. Unregistered tools use the tool label `unknown`.

## Build and run locally

From the repository root, build the application and image:

```bash
pnpm --filter @univerjs/univer-workspace-mcp... build
docker build -f apps/mcp/Dockerfile -t univer-workspace-mcp:local .
```

The build uses the root `.npmrc` to reach the Univer package registry. It includes
Client Core and its runtime dependencies. Override `BASE_IMAGE` with `--build-arg`
when needed. The default is `node:24-bookworm-slim`.

For Docker Desktop, start a development gateway against an existing Workspace server:

```bash
docker run --rm -p 127.0.0.1:3930:3000 \
  -e MCP_ROLE=gateway -e NODE_ENV=development -e MCP_DEV_SESSION_PASSTHROUGH=1 \
  -e MCP_OAUTH_CLIENT_ID=univer-workspace-mcp-gateway -e MCP_OAUTH_CLIENT_SECRET=<secret> \
  -e WORKSPACE_ORIGIN=http://127.0.0.1:5973 \
  -e WORKSPACE_TRANSPORT_URL=http://host.docker.internal:3920 \
  -e MCP_PUBLIC_URL=http://127.0.0.1:3930/mcp \
  univer-workspace-mcp:local
```

Connect your MCP client to `http://127.0.0.1:3930/mcp` with a personal access token as its bearer
token, or with a development Workspace session when passthrough is enabled. The image runs as `node` and declares no persistent volume.
`docker/compose.verify.yml` is reserved for the local verification bench. Its variables
are all required, as specified in [local verification](../../docs/design/workspace-mcp/local-verification.zh-CN.md).

Run the local checks:

```bash
pnpm --filter @univerjs/univer-workspace-mcp typecheck
pnpm --filter @univerjs/univer-workspace-mcp test
pnpm --filter @univerjs/univer-workspace-mcp build
```
