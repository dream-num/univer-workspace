# Univer Workspace MCP

A private remote MCP application built on `@univerjs/univer-workspace-client-core`.
Stage A and the Stage B slices so far expose identity, repositories, Issues, pull requests,
search, browse, files in a pull request, repository and label administration, and merge or
discard over Streamable HTTP using the 2026-07-28 and 2025-11-25 protocols. Results match
the CLI `--json` output and add Browser URLs. Lists return `{ repos: [...] }` in both protocols.

The gateway talks to Workspace through HTTP. It has no database and does not import
the CLI application. Workspace remains the authority for identity and permissions.

## Roles and limits

One image selects its role through `MCP_ROLE`. `gateway` serves requests.
`executor` and `renderer` print that they are not implemented in Stage A and exit 1.
A missing or unknown role exits 1 and lists the valid roles.

Stage A supports development session passthrough only. The bearer value is a Workspace
session, checked through Client Core `whoami` on every MCP request. There is no OAuth
or PAT support yet. Production rejects any non-empty `MCP_DEV_SESSION_PASSTHROUGH`.
Use Stage A only locally or in internal single-user environments until Stage G passes.
Development authentication must never appear in SaaS configuration.

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
| `MCP_DEV_SESSION_PASSTHROUGH` | Required as `1` | Enables development session authentication |
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

Every tool declares a scope (`read` for `whoami`, `repo_list`, `repo_view`, `issue_list`, `issue_view`, `pr_list`, `pr_view`,
`search`, `browse`, `space_browse`, `space_find`, `unit_list`, `blob_get` and `label_list`; `write` for the Issue tools, `pr_create`, `pr_edit`,
`pr_ready`, `unit_add`, `unit_create` and `label_write`; `publish` for `repo_create`, `repo_edit` and `space_node`; `worktree:merge` for
`pr_merge` and `pr_discard`) and all three annotations (`readOnlyHint` is true only for the read tools, `destructiveHint` is
true only for `repo_edit`, `label_write`, `space_node`, `pr_merge` and `pr_discard`, `openWorldHint` is false) and an output schema. Development passthrough grants all
scopes; a connection without the scope gets the tool error `workspace-scope-required`.
Invalid arguments return `workspace-argument-invalid` with the validation issues in `detail`; a result that
violates a tool's output schema is an `internal_error`. A write whose outcome is unknown returns
`workspace-result-unknown`. Tool failures preserve Client Core's
`{ code, message, detail }` in `structuredContent` and set `isError: true`.
Authentication failures return HTTP 401 and
`WWW-Authenticate: Bearer resource_metadata="<public origin>/.well-known/oauth-protected-resource/mcp"`.
The metadata endpoint itself is reserved for Stage F.

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
| `auth_kind`, `client_id` | `"dev"` in Stage A |
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
Stage A uses the bounded client label `dev` and the tool label `unknown` for unregistered names.

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
  -e WORKSPACE_ORIGIN=http://127.0.0.1:5973 \
  -e WORKSPACE_TRANSPORT_URL=http://host.docker.internal:3920 \
  -e MCP_PUBLIC_URL=http://127.0.0.1:3930/mcp \
  univer-workspace-mcp:local
```

Connect your MCP client to `http://127.0.0.1:3930/mcp` with a development Workspace
session as its bearer token. The image runs as `node` and declares no persistent volume.
`docker/compose.verify.yml` is reserved for the local verification bench. Its variables
are all required, as specified in [local verification](../../docs/design/workspace-mcp/local-verification.zh-CN.md).

Run the local checks:

```bash
pnpm --filter @univerjs/univer-workspace-mcp typecheck
pnpm --filter @univerjs/univer-workspace-mcp test
pnpm --filter @univerjs/univer-workspace-mcp build
```
