# Univer Workspace MCP

A private remote MCP application built on `@univerjs/univer-workspace-client-core`.
Stage A and the Stage B slices so far expose identity, repositories, Issues, pull requests,
search, browse, files in a pull request, repository and label administration, merge or
discard, the SVG resource catalog, the Facade API reference and the Skills over Streamable HTTP using the 2026-07-28 and 2025-11-25 protocols. Results match
the CLI `--json` output and add Browser URLs. Lists return `{ repos: [...] }` in both protocols.

The gateway talks to Workspace through HTTP. It has no database and does not import
the CLI application. Workspace remains the authority for identity and permissions.

## Roles and limits

One image selects its role through `MCP_ROLE`. `gateway` serves requests.
`executor` serves internal RPC and hosts the Client Core worker pool. `renderer` remains unimplemented and exits 1.
A missing or unknown role exits 1 and lists the valid roles.

The gateway imports Client Core's `/product` entry only. Headless execution and inspection
run in the executor. Tools remain listed without an executor configuration and return
`workspace-executor-unavailable`. `execute` requires `write`; `inspect` requires `read`.

The executor accepts `POST /rpc/v1/<op>` with an internal bearer token and
`x-mcp-rpc-version: 1`. The binary frame is a four-byte big-endian JSON header length,
the UTF-8 header, then optional payload bytes. The operation table owns schemas,
effect, limits, routing keys, budget and rerun policy. The initial operations are
`content.execute`, `content.inspect`, `exchange.import`, `exchange.export`, `htmlView.validate`, `htmlView.create`, `markdown.compile`, `markdown.export` and internal `diagnostics.probe`; all have empty
rerun policies. Application failures use HTTP 200 with `{ok:false,error:{code,message,detail,outcome}}`.
Transport rejections use non-200 statuses. The grant travels only in the frame body.

Gateway rendezvous hashing pins `(userId, scope, unitId)` to an executor. Only failures
known to precede delivery can fail over. A disconnected or timed-out write returns
`workspace-result-unknown`; check current state before repeating it. Worker open timeouts
remain retryable. Calls have a 30-second synchronous gateway budget. Office import/export continue under a four-minute job deadline, with an earlier executor deadline.

Each call binds its required user ID into the Client Core runtime key. Worker children
receive an explicit environment containing only `NODE_ENV=production`. The gateway issues
session grants with the exchanged session's expiry; dev grants last 10 minutes, matching the
downstream session lifetime used by token exchange. The executor verifies the session's user through
Workspace `whoami` before dispatch, using the transport URL. Successful identity checks share a SHA-256 session cache capped at
10,000 entries and expire with the grant. Shared checks use their own 10-second timeout;
each request waits only until its own deadline, and failed checks are not cached.
A mismatched user or 401 requires authentication.
Workers are replaced before reuse when their creating grant expires within 60 seconds.
401 invalidation and reruns belong to the next resilience change.

Session grants and process separation do not provide a multi-user sandbox. In particular,
a worker may read its executor's `/proc/1/environ` under the same uid, exposing the internal
token. Stage G must address that before multi-user deployment. Production refuses this
session-grant executor.

## Authentication

The gateway never forwards the caller's bearer to Workspace product APIs. A bearer starting with
`uvw_pat_` (personal access token) or `uvw_at_` (MCP OAuth access token) is exchanged with Workspace
(`POST /api/auth/token`, RFC 8693) as the confidential client `MCP_OAUTH_CLIENT_ID`. The response
carries a short-lived downstream session, the user and the granted scopes. Product requests send only
that session. The gateway caches the result by the SHA-256 of the bearer for at most 30 seconds (and
never beyond the session's `expires_in` minus 5 seconds). After revocation, `initialize`, `tools/list`,
tools that make no Workspace request (`whoami`, `skills_read`, `api_*`), and resources may still succeed
from cache for up to 30 seconds. Every Workspace-backed call fails immediately because revocation deletes
the downstream session. A downstream 401 evicts only the exact session that failed, preserving any
pending exchange, newer session, and negative cache entry. If that session was obtained less than
5 seconds before the request started, the gateway returns HTTP 401 with `error="invalid_token"` without another exchange.
Otherwise, it re-authenticates once through the shared cache. The consumed MCP request returns HTTP 401
without replaying the tool. If the token still exchanges, the challenge omits `error="invalid_token"`
so the client can retry with the same token. A rejected token gets `error="invalid_token"`;
exchange faults return HTTP 500.
Concurrent calls with the same bearer share one exchange. Settled sessions and in-flight exchanges use
separate maps, so pending unknown tokens cannot evict settled sessions. Settled sessions are capped at
10,000 entries. An `invalid_grant` result is cached separately for 5 seconds, capped at 1,000 entries.
Before FIFO eviction, each settled cache sweeps its expired entries. In-flight exchanges are never evicted
or capped: each one is an outstanding request that settles within its 10-second timeout.

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
| `MCP_PUBLIC_URL` | Gateway only | HTTP(S) endpoint URL ending in `/mcp` |
| `METRICS_TOKEN` | Unset | Bearer token for `/metrics`. Unset or empty hides the endpoint |
| `MCP_SYNC_BUDGET_MS` | `30000` | Import/export synchronous wait in milliseconds, 1 through 30000. Test and operations knob; lower it to force job polling without a large fixture |
| `MCP_MAX_CONNECTIONS` | `1024` | Maximum simultaneous gateway TCP connections per replica |
| `MCP_STAGING_DIRECTORY` | Required | Private 0700 directory owned by the gateway uid. Atomic JSON sidecars and byte files; startup and minute sweeps remove expired objects |
| `MCP_STAGING_USER_MAX_BYTES` | `2147483648` (2 GiB) | Combined staged upload/download bytes per user; in-flight bytes count too. Accounting is per gateway replica, refreshed from valid sidecars on startup and each minute |
| `MCP_STAGING_USER_MAX_PENDING_UPLOADS` | `20` | Pending upload reservations per user |
| `MCP_UPLOAD_BLOB_MAX_BYTES` | `536870912` | Blob upload/download staging limit in bytes; align with Workspace `maxBlobBytes` |
| `MCP_UPLOAD_OFFICE_IMPORT_MAX_BYTES`, `MCP_UPLOAD_MARKDOWN_ASSETS_MAX_BYTES`, `MCP_UPLOAD_SVG_ASSETS_MAX_BYTES`, `MCP_UPLOAD_TYPST_BUNDLE_MAX_BYTES` | `52428800` each | Per-purpose upload limits in bytes |
| `MCP_RESOURCE_CACHE_DIRECTORY` | `<OS temp dir>/univer-workspace-mcp-<uid>/resources` | Private directory where the SVG resource catalog caches downloaded SVG files. Public data shared by gateway users under the same uid |
| `MCP_OAUTH_CLIENT_ID`, `MCP_OAUTH_CLIENT_SECRET` | Unset | Confidential Workspace client with `tokenExchange` enabled. Set both or neither. Enables PAT and OAuth access token authentication |
| `MCP_DEV_SESSION_PASSTHROUGH` | Unset | `1` enables development session authentication. At least one of this and the client pair is required |
| `NODE_ENV` | Inherited | `production` forbids development authentication. The image sets `production` |
| `MCP_EXECUTOR_URLS`, `MCP_INTERNAL_TOKEN` | Unset on gateway | Comma-separated internal HTTP(S) origins and a shared token of at least 32 characters. Set both or neither. The executor requires the token |
| `MCP_EXECUTOR_CREDENTIALS` | `session` | Executor grant kind. `NODE_ENV=production` refuses session grants |
| `EXECUTOR_MAX_JOBS` | `2` | Per-executor concurrent conversion children. Queued jobs share the call deadline and never start after expiry |
| `EXECUTOR_JOB_HEAP_MB` | `256` | Each conversion child's V8 old-space cap in MiB via `--max-old-space-size`. Native allocations are outside this cap |
| `EXECUTOR_MAX_WORKERS` | `4` | Maximum cached Unit workers. Tune to the host's memory budget |
| `EXECUTOR_IDLE_TTL_MS` | `60000` | Idle worker lifetime |
| `EXECUTOR_QUEUE_TIMEOUT_MS` | `5000` | Maximum wait for a worker slot |
| `EXECUTOR_OPERATION_TIMEOUT_MS` | `25000` | Worker open and operation timeout |
| `UNIVER_LICENSE`, `UNIVER_LICENSE_KEY` | Generated development pair | Executor runtime and Office conversion overrides. Startup requires both overrides or neither; only export jobs receive the pair |
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
| `PUT /mcp/files/uploads/{id}?token=...` | Capability upload, 10-minute link; optional Content-Length, optional size upper limit, single successful PUT |
| `GET /mcp/files/uploads/{id}/page?token=...` | Static browser upload page, same capability and expiry, strict CSP |
| `GET /mcp/files/downloads/{id}?token=...` | 15-minute capability download, attachment and sandbox headers, private/no-store |
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
| `file_upload_create` | Required `purpose`, `file_name`, `media_type`; optional `size` (upper bound) | `{ upload: { upload_id, upload_url, page_url, expires_at, max_bytes } }`. Links last 10 minutes; ready uploads last one hour |
| `execute` | Required `worktree`, `unit`, `code` (at most 10 MiB UTF-8) | Bare `uvw execute --json` result `{ committed, value?, revision?, status?, valueTruncated? }` |
| `inspect` | Required `target`, `unit`, exactly one of `trunk: true` or `worktree`; optional `selectors`, `worksheet` | Bare `uvw inspect --json` result `{ kind, unitId, ... }`. Targets match CLI, including `range`; selectors use CLI syntax such as `index:1`. No cursor; oversized results return `workspace-result-too-large` |
| `import` | Required `upload_id`, `worktree`, `space`, `idempotency_key`; optional `type` (`sheet`, `base`, `doc`, `slide`), `name`, `parent` | Bare CLI import result plus `url`; `sourcePath` is the staged file name |
| `export` | Required `worktree`, `unit`, `format` (`xlsx`, `docx`, `pptx`) | `{ download, type }`; download expires in 15 minutes |
| `api_find` | Required `terms` (searched independently); optional `unit` (`sheet`, `slide`, `doc`, `base`, `board`) | `{ results: [{ term, matches, totalMatches }] }` from `@univer-cli/api-reference` |
| `api_show` | Required `symbols`; optional `cursor` | `{ results: [...] }`, one `found` or `not-found` entry per symbol, from `@univer-cli/api-reference`. A long class is paged (below) |
| `skills_read` | Optional `name`, `resource`, `full`, `cursor` | Without `name`: `{ skills: [{ name, description }] }`. With `name`: `{ skills: [{ name, content, resources?, files? }] }`. With `name` and `resource`: `{ name, path, content }`. Each `resources[].readCommand` is the instruction to call `skills_read` with that `name` and `resource` |

`files` toolset:

| Tool | Arguments | Structured result |
| --- | --- | --- |
| `blob_get` | Required `resource` | `{ node, resource }` |
| `blob_upload` | Required `upload_id`, `space`, `idempotency_key`; optional `name` (defaults to uploaded file name), `parent`, `media_type` | CLI `{ upload }` shape plus `upload.url`. Publishes directly, requires `publish` |
| `blob_download` | `resource` | `{ download: { url, expires_at, file_name, media_type, size }, etag }` |
| `blob_replace` | `resource`, `upload_id`, `etag`, `idempotency_key` | `{ replacement: { operationId, resourceId, etag } }`. Destructive, requires `publish` |
| `asset_download` | `id`, `worktree` | `{ download: { url, expires_at, file_name, media_type, size } }` |
| `compile_markdown` | `markdown`; optional `assets_upload_id`, `title`; target options require `apply` | CLI compile result with `committed`, `targetUnitId`, diagnostics and materialized `sourceMap`; compile-only also returns `javascript` |
| `export_markdown` | `worktree`, `unit`, `source_map`, `blocks` | Current Markdown, revision, source map, diagnostics and `assets: [{path, download}]` |

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
| `resources_registries` | None | `{ registries: [{ id, resourceCount, groupCount, tagCount, colorEditableCount }] }` |
| `resources_find` | Required `query`; optional `registry`, `limit` (default 30) | `{ query: { queries, registries }, resources: [...], total, limit }`, equal to `uvw resources find --json` |
| `resources_export` | Required `handles` (`<registryId>/<resourceId>`); optional `cursor` | `{ resources: [{ handle, svg }], failed: [{ handle, code, message }] }`. The SVG text itself, written nowhere. A page may carry `truncated` and `cursor` |

## SVG resource catalog

`resources_*` run `@univer-cli/resource-library` 1.4.0 with the catalog manifest of `@univerjs-pro/cli-assets` 0.1.0,
the same library and manifest the CLI uses; the gateway never imports `apps/cli`. Registry listings and searches read the
manifest. `resources_export` downloads each SVG the first time it is requested, over HTTPS from the catalog hosts (the gateway
needs outbound network access), stores it in `MCP_RESOURCE_CACHE_DIRECTORY`, and returns its text. The cache holds public
catalog data and is shared by all users. Differences from `uvw resources`: `query` and `registry` take one value each (the CLI
accepts several), and `resources_export` returns `{ resources, failed }` with the SVG text where the CLI returns
`{ exported, failed }` with file paths (a single handle without `--out` prints `{ handle, svg }`). A handle the library rejects
is listed in `failed` with its code, as in the CLI, and does not fail the call. Export pages by handle: when the SVGs
would exceed 100,000 characters, the page stops before the one that does not fit and carries `truncated: true` and a `cursor`.
A single SVG larger than the limit is `workspace-result-too-large`.

`@univer-cli/resource-library` 1.4.0 does not confine cache symlinks. The gateway guards its cache through the library's
public `ResourceCache` interface while an upstream fix is needed. It creates the root, missing parents and registry
directories with mode `0700`. Before each cache read or write, it recreates missing roots and gateway-created parents,
then checks the root and gateway-created parents with `lstat` for real directories owned by the current uid without
group or world write permission. Registry directories receive the same checks and must resolve inside the cache root. Exported files
must be regular files, refuse symlinks on open, match the device and inode checked before opening, and resolve inside
the root before their text is returned. Registry listing and search do not access the cache. Unsafe caches fail SVG
exports with `workspace-resource-cache-unsafe` and an internal-error log without file contents.
Other filesystem failures return `workspace-internal-error` and log the original cause without SVG contents.
An existing `MCP_RESOURCE_CACHE_DIRECTORY` must meet these ownership and permission requirements; the gateway does not
change existing permissions or migrate the old default cache.

## Reference, Skills and server instructions

`@univer-cli/api-reference` 1.4.0 is the same offline Facade API index the CLI uses. The CLI's `api find` and
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
A committed `execute` keeps `committed`, `revision` and `status` when its value exceeds either
this limit or the executor response byte limit. It omits `value`, sets `valueTruncated: true`,
and confirms the write in the text summary. Do not repeat that write to recover its value.
Other tools, uncommitted `execute`, and `skills_read` with `full` return `workspace-result-too-large` when it would exceed the
limit. For `skills_read` with `full`, read the skill without `full`, then each resource with `resource`,
following its cursor when paged. Other oversized results tell the agent to narrow the request.

Every tool declares a scope (`read` for `whoami`, `repo_list`, `repo_view`, `issue_list`, `issue_view`, `pr_list`, `pr_view`,
`search`, `browse`, `space_browse`, `space_find`, `unit_list`, `api_find`, `api_show`, `skills_read`, `job_get`, `blob_get`, `label_list`, `resources_registries`, `resources_find` and `resources_export`; `write` for the Issue tools, `pr_create`, `pr_edit`,
`pr_ready`, `unit_add`, `unit_create` and `label_write`; `publish` for `repo_create`, `repo_edit` and `space_node`; `worktree:merge` for
`pr_merge` and `pr_discard`) and all three annotations (`readOnlyHint` is true only for the read tools, `destructiveHint` is
true only for `repo_edit`, `label_write`, `space_node`, `pr_merge` and `pr_discard`, `openWorldHint` is false) and an output schema. The scopes come from the exchange (unknown
names are ignored); development passthrough grants all of them. A connection without the tool's scope gets the tool error `workspace-scope-required`.
Invalid arguments return `workspace-argument-invalid` with the validation issues in `detail`; a result that
violates a tool's output schema is an `internal_error`. A write whose outcome is unknown returns
`workspace-result-unknown`. Unconfirmed changeset submission and commit failures carry their cause in
`detail.cause`; their outcome is `tool_error`, or `timeout` for timeouts. Definite rejections pass through
as `WORKSPACE_RUNTIME_CONFLICT`, `WORKSPACE_RUNTIME_PULL_REQUIRED`, or `WORKSPACE_RUNTIME_COMMIT_INVALID`.
The executor reruns `content.execute` once on a pull revision mismatch before script execution,
resolving the target again. `content.execute`, `content.inspect` and `exchange.export` also
recover once from a worker's Workspace 401 when that worker holds a different session from
the current call. Replacement is limited to that worker; its rejected session's verifier
entry is evicted. Rejected current sessions return the normal authentication error.
Commit-phase failures are never rerun. Each reason is permitted once, only with at least
five seconds left in the original deadline. Reads never rerun revision conflicts.
Import and diagnostics do not rerun. Import can create a Unit, and diagnostics uses the
current session without a cached worker. Office conversion children have no Workspace credentials;
export's auth recovery applies only to its parent-side runtime read.
Reruns add worker time to the same usage event. Executor logs record `mcp.executor_rerun`
with `reason`, and its internal-token-protected `/metrics` exposes
`mcp_executor_reruns_total{reason="auth"|"revision"}`. The version 1 usage event is unchanged.
Queued calls cancelled before acquiring a lease return `workspace-executor-timeout` with
`detail: { retryable: true, started: false }`; they never execute later. A started write
that exceeds its deadline still has an unknown result.
Read deadlines return `workspace-executor-timeout` with `detail.retryable: true`, including when
the deadline aborts a Workspace HTTP request.
Uncoded errors from user script execution return `workspace-script-failed`, the CLI's exact
message, and `detail: { name }` when the error has a name. Generated inspection script failures and other
uncoded executor failures remain logged `workspace-internal-error`s. Invalid inspection output is
`workspace-runtime-result-invalid` with an `internal_error` outcome.
Oversized requests, protocol version mismatches and budgets exhausted before sending are
actionable `tool_error`s. Only connection failures known to precede delivery and HTTP 503
mark a replica down and permit failover; HTTP 413 and 426 do neither.
Tool failures preserve Client Core's
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

Logs use pino JSON on stdout. Each authenticated `tools/call` emits one
`mcp.tool_call` event at info level, except deduplicated import/export retries.
Import/export emit their original event once when the work settles, including its real costs and total elapsed time.
Returning a job handle does not emit an early success event. Joined retries do not emit a second conversion event.
Every `job_get` emits its own read event with `executor: none` and zero costs.
Reused calls carry `_meta["univer.workspace.deduplicated"]: true` on the MCP response so evidence
collectors can distinguish a cached normal result from a newly completed conversion without changing `structuredContent`. Keep `LOG_LEVEL=info` to collect usage events.
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
| `unit_type` | Runtime Unit type for executor tools, otherwise null |
| `outcome` | `ok`, `tool_error`, `auth_error`, `rate_limited`, `timeout`, or `internal_error` |
| `error_code` | For `tool_error` or `timeout`, the same code the tool result returns in `structuredContent.code`, including Workspace codes such as `NOT_FOUND`; otherwise null |
| `duration_ms` | Non-negative total gateway duration including authentication |
| `executor` | `cold_start` or `warm` from the runtime observer; `none` when no worker operation was reported |
| `cost` | Object containing `worker_cpu_ms`, `worker_peak_rss_mb`, `render_pages`, `export_bytes`, `upload_bytes`, and `committed_revisions`. Gateway file tools report transfer bytes; other costs remain 0 for non-executor calls |

Failure envelopes also carry observed usage, including cold/warm state and Unit type.

`worker_cpu_ms` records worker wall time reported by Client Core, not CPU consumption.
`committed_revisions` counts confirmed writes. `worker_peak_rss_mb` and render costs remain zero in this slice. `executor: "none"` permits `upload_bytes` and `export_bytes` for file tools; `worker_cpu_ms`, `worker_peak_rss_mb`, `render_pages` and `committed_revisions` remain zero.

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
Set `VERIFY_UVW_MCP_EXECUTORS=2` when launching verify-uvw to enable `executor-b` and
route across both replicas. The default remains one executor, with no published executor port.
`docker/compose.verify.yml` is reserved for the local verification bench. Its variables
are all required, as specified in [local verification](../../docs/design/workspace-mcp/local-verification.zh-CN.md).

Run the local checks:

```bash
pnpm --filter @univerjs/univer-workspace-mcp typecheck
pnpm --filter @univerjs/univer-workspace-mcp test
pnpm --filter @univerjs/univer-workspace-mcp build
```

## File staging

`MCP_PUBLIC_URL` must have the pathname `/mcp`. File routes use the `/mcp/files/` prefix.
File routes keep the public Host check and authenticate with a 256-bit capability token
instead of the MCP bearer. Only its SHA-256 is persisted. Anyone holding a link can use it;
keep links private. Authenticated tools can consume only the caller's ready uploads of the
matching purpose. A foreign upload is reported as not found. Consumption retains the upload
for idempotent retries until its one-hour expiry. Workspace remains the permission authority.

`blob` accepts any syntactically valid media type. `office-import` accepts the OpenXML
Word, Excel and PowerPoint types and the legacy Office types. CSV is not supported by this import workflow. The other three
purposes accept `application/zip` and `application/x-zip-compressed`. The office upload cap
does not lift Workspace's 1 MiB UnitData commit limit. Office import refuses converted UnitData above 900 KiB inside the child before IPC and again before creating a Unit, with `workspace-import-too-large` and byte counts. Markdown assets are consumed by `compile_markdown`; Typst and SVG consumers remain future work.

Blob transfer streams between Workspace and the staging directory. Download results preserve
Node names; attachment headers replace separators and control characters and cap the name at 180 characters.
Asset downloads use Asset IDs with a media-type extension. Startup and minute sweeps remove expired files;
failed streams never become ready. Sweeps refresh cached state, size and expiry from every valid sidecar.
Concurrent reservations and in-flight bytes on other replicas remain approximate until the next sweep;
strict shared-volume quotas require coordinated reservations. Corrupt sidecars and their data are removed
once the sidecar mtime is older than the one-hour upload TTL, with one log naming the object ID.
Unreadable sidecars are logged with their ID and isolated. Sweeps tolerate disappearing entries. They skip
locks younger than two hours, so a consume crossing expiry keeps its bytes. Locks carry random
ownership tokens; release preserves a successor's lock. Orphan locks, including
zero-byte locks from a crash before token write, are swept after that bound. A crashed in-flight
upload can retain its exclusive lock until that bound. Retry with a new upload reservation in that case. Staging roots,
created parents and files reject symlinks and group/world permissions.

Gateway file tools record `upload_bytes` for consumed uploads and `export_bytes` for staged
downloads with `executor: none`. Worker costs remain zero without an executor.

`file_upload_create.size` is optional and sets a size upper limit. Uploads accept smaller files,
including empty files and chunked bodies without Content-Length. The effective limit is the
minimum of the supplied size (when present) and the purpose limit; `max_bytes` reports that bound.
Ready sidecars record actual bytes and SHA-256. File routes stream raw Node request bytes before
MCP JSON adaptation. Node's request timeout is 30 minutes and its headers timeout is explicitly 60 seconds.
`MCP_MAX_CONNECTIONS` defaults to 1024 per gateway replica. A file response sent before the
request body is complete sends `Connection: close` and destroys the request after the response finishes.
Routing uses one WHATWG-normalized pathname, including dot segments and encoded dots, before
choosing between raw file streaming and the MCP adapter's 4 MiB JSON cap.
The capability link must still be used within ten minutes of reservation.

Staging quota failures return `workspace-staging-quota-exceeded` from tools, or HTTP 429 during PUT.
Failed transfers release their staged-byte accounting; ready uploads remain counted until expiry.
The byte cap covers uploads and downloads together. Pending-upload counts fall when the upload becomes ready.
`blob_upload.name` defaults to the reserved file name. Transfer usage counts successful consumption once.
Filesystem failures and data/sidecar size mismatches are internal errors; tool details omit
`sourcePath` and local filesystem paths. Invalid Workspace download media types fall back to
`application/octet-stream`. Internal failures log the error class and safe `code` and `syscall`
fields with the request ID, without messages, stacks, paths, credentials, contents or arguments.
Aborted transfers produce one info-level failure log.

## Office conversion jobs

Office conversion runs in a fresh forked process per operation with advanced binary IPC.
The parent resolves Workspace targets, exports UnitData and image bytes, and creates Units
through Client Core. Import children receive only bytes and conversion options. Export children also receive the license pair.
Its explicit environment contains `NODE_ENV=production`, `HOME`, `XDG_STATE_HOME` and `TMPDIR`.
The last three point at a private per-job temporary directory that is removed after exit.
It receives no session, grant, Workspace URL, internal token or inherited Node flags.
The call's remaining deadline includes its wait for a conversion slot and kills the child.
A conversion crash returns `workspace-job-crashed`, including a child killed by its heap cap.
A deadline before Unit creation returns `workspace-executor-timeout` with
`detail: { retryable: true, started: false }`. After creation starts, its result can be unknown.
Import is never automatically rerun by MCP. Retry with the same upload and idempotency key,
which must contain 16 to 200 URL-safe letters, digits, underscores or hyphens.
MCP derives the converter's `unitId` from SHA-256 of the caller ID, key and upload SHA-256.
The SDK's stable-identity conversion then reproduces the same initialData, including nested IDs.
Routing uses caller ID and key so retries reach the same executor independently of request IDs.
No conversion cache is needed. Workspace compares the full creation intent and returns the original Unit.
Export download names use the Unit's product name.

Children exit on IPC disconnect. Startup removes private job directories owned by dead executors,
and each completed or failed job removes its own directory. The executor ignores SIGUSR1.
Only known exchange and `LICENSE_*` errors cross the child boundary. Other codes become
`workspace-exchange-conversion-failed`, and absolute paths are removed from error messages.

`exchange.import` permits a 64 MiB request frame for the default 50 MiB Office upload,
and a 64 KiB response. `exchange.export` permits a 64 KiB request and a 128 MiB response
frame, including framing overhead. Oversized exports return `workspace-result-too-large`.
Import/export return their original result unchanged when they finish within `MCP_SYNC_BUDGET_MS`.
A longer call returns `{job_id, status: "running"}`. This shape has no `download` or import result fields;
the text explicitly asks the client to poll `job_get {job_id}`. Poll until `succeeded`, whose `result`
is the original tool output, or `failed`, whose `error` has `code`, `message` and `detail`.
`job_get` is read-only in `core` and requires `read` scope.

Import requires an `idempotency_key`; export optionally accepts one with the same 16-to-200-character syntax.
The tuple `(userId, tool, idempotency_key)` shares one running conversion or an unexpired successful result,
including calls that first returned synchronously. A retry during the original synchronous wait joins it.
A retry of a running job after that wait returns its running handle; a retry of a succeeded job returns
its original tool result directly. Failed jobs release their keys in memory and in their sidecars.
Retrying a failed or result-unknown import with the same key runs it again using the same deterministic Unit identity.
Foreign replicas read the sidecar's actual status. Without a key each export starts a new conversion.
A key identifies the original arguments. The job record and its reservation carry the SHA-256 of the canonicalized
parsed tool arguments (key order and omitted optional fields do not matter). Reusing a key with a different
upload, Worktree, Space, Unit, format or other argument while the job is running or its result is unexpired returns
`workspace-idempotency-conflict` and starts nothing, as Workspace does for a reused `Idempotency-Key`.
Use a new key for a different conversion.

Jobs have random UUIDs and private atomic `.job.json` sidecars in `MCP_STAGING_DIRECTORY`.
A shared-volume reservation lock prevents duplicate conversion starts across gateway replicas.
Reservation locks guard a millisecond critical section and go stale after 10 seconds, so a gateway crash during
reservation delays a retry by at most that long; upload-transfer locks keep the two-hour orphan-lock sweep. Running jobs and completed results are read from memory or their sidecar.
A replica that did not start the conversion answers `job_get` from the shared sidecar.
Expired, unknown and foreign jobs all return `workspace-job-not-found`.
Import results and failed jobs expire 15 minutes after settlement. Export jobs expire with their staged download links, 15 minutes after download creation.
Sidecars are swept at startup and each minute. Poll promptly.

The conversion deadline is four minutes including queueing, and never later than the caller grant's expiry minus 5 seconds
(a grant too short for that still gets the synchronous budget, and the executor rejects an expired grant as before). Only `exchange.import` and `exchange.export`
permit RPC deadlines above 30 seconds. The gateway does not resume in-flight calls after restart.
While the gateway that started a job still holds its unsettled completion, `job_get` reports `running` and the key stays
reserved; that completion, including download or Workspace response mapping after the executor call, is bounded by the
deadline and settles as failed with the codes below if it does not finish. A running sidecar past its deadline, with no
live completion on the answering replica, reads as failed with `workspace-executor-timeout` for export or
`workspace-result-unknown` for import, since a restarted gateway cannot confirm whether creation started.
An ambiguous write also preserves `workspace-result-unknown` on ordinary settlement.
New jobs report `executor: cold_start`; pool costs still describe pool work only.
Import records `upload_bytes` and one confirmed creation; export records `export_bytes`.

C7 remains pending upstream. The private directory gives exchange usage storage a writable
home and state path, but is disposable and does not promise durable license quota accounting.
`LICENSE_USAGE_STORAGE_ERROR` is preserved without an automatic retry. This process split
is fault isolation, not a network sandbox. Stage G remains the multi-user deployment gate.

## HTML Views

The `files` toolset includes `html_view_validate {html}` (`read`) and
`html_view_create {html, space, name, parent?, idempotency_key}` (`publish`).
Both run Client Core's `WorkspaceHtmlViewFeature` in the executor, loading each
referenced trunk Sheet through the caller-bound `exportUnitData`. They validate
declarative bindings without executing page JavaScript. The CLI retains file
handling and calls the same feature.

HTML is limited to 512 KiB of UTF-8 text at the tool and RPC input boundaries;
the RPC frame limit is 4 MiB, including JSON escaping and credentials. Validation
returns the CLI's bare `{valid, unitIds, bindingCount}`. Creation immediately
publishes a Blob without Worktree review and returns the CLI's bare upload fields
with `workspaceUrl` using the identity origin. The executor uploads a private copy
of the exact validated bytes, with stable original filename `view.univer.html`.
Generate a 16 to 200 character URL-safe idempotency key before creation and reuse it
with identical HTML and destination after `workspace-result-unknown`.

Runtime exports report worker observations. Successful creation adds HTML UTF-8
`upload_bytes` at the gateway, including when a page has no bindings and
`executor: none`; Blob publication creates no committed Unit revisions.

## Markdown tools

Enable the `files` toolset for `compile_markdown` and `export_markdown`.
Compile-only takes Markdown text and returns JavaScript, diagnostics and a source map.
Creation requires `apply: true`, `worktree` and `space`. Generate an `idempotency_key`
before creation and reuse it with the same inputs on retry. Keys contain 16 to 200
URL-safe letters, digits, underscores or hyphens. The executor scopes the key to the
caller. The Core materializer seeds native identities from the compiled program.
Creation runs in the existing job child because the standard headless factory imports
the Rust formula engine. The child receives the runtime license.

Updates require `apply: true`, `worktree`, `unit`, `source_map` and distinct `blocks`.
They reject creation options and use the caller-bound `executeAndCommit` runtime.
Replacement blocks retain their explicit IDs. Save the returned materialized `sourceMap`.
Like the CLI, export requires that map and explicit block IDs. It reads the current
native Doc through `executeRead`, resolves images through authenticated Workspace HTTP,
and returns Markdown, revision, diagnostics, a refreshed map and `{path, download}` assets.
Downloads use the existing 15-minute capability links. No resource bytes are inlined.

Optional `assets_upload_id` names the caller's ready `markdown-assets` ZIP.
The shared executor ZIP reader accepts at most 256 entries. Markdown assets are limited
to 4 MiB uncompressed per file and 8 MiB expanded in total. Each entry name, including a
directory marker, is limited to 1,024 UTF-8 bytes and 32 path segments before inflation.
It checks both declared and actual sizes while streaming
and rejects traversal, case and Unicode collisions, duplicate paths and file-directory
collisions. Source files remain in memory. Compile requests have a 64 MiB frame limit,
responses have an 8 MiB limit, and exports have a 64 MiB response limit. Both operations
share the existing 30-second budget. These ZIP caps do not guarantee that the compiled
result fits. Assets are inlined into the program. Compile-only must fit the 8 MiB response
including JavaScript and its JSON encoding. Creation must fit the 900 KiB serialized
UnitData check and Workspace's 1 MiB request limit, including document overhead.
See [large content limits](../../docs/design/workspace-mcp/architecture.zh-CN.md#73-大文件导入的限制).
Compiler and source-map input failures return `workspace-markdown-invalid` with the
CLI's message and `detail.diagnostics`. Compile-only has read failure semantics while the
tool retains the `write` scope. Compile-only usage reports `executor: none`, `unit_type: null`
and `repo: null`, including when a ZIP contributes `upload_bytes`. Consumed ZIP bytes and staged asset bytes enter transfer
usage, and confirmed creations and updates enter `committed_revisions`.
