# MCP mode

Read this before a run that needs the MCP gateway, the renderer, or the Workspace Agent. The journeys
and their pass conditions are in [the MCP journeys](../features/mcp.md).

## Start

On macOS with Docker Desktop or OrbStack, opt in with `VERIFY_UVW_MCP=1 $V up`. `up` refuses any other
engine. It builds `apps/mcp/Dockerfile` from the working tree and starts a compose gateway on loopback
port 3930 (`VERIFY_UVW_MCP_PORT`). Without the opt-in, every command keeps its default-mode behavior.

These variables are read at `up` and saved in `run.env`:

| Variable | Effect |
| --- | --- |
| `VERIFY_UVW_MCP_EXECUTORS=2` | Adds a second executor, for MX13. |
| `VERIFY_UVW_MCP_RENDERER=0` | No renderer container and no `MCP_RENDERER_URL`. Doctor checks it is absent. `renderer-call` and `renderer-restart` refuse. |
| `VERIFY_UVW_MCP_PRODUCTION=1` | `NODE_ENV=production` and no `MCP_DEV_SESSION_PASSTHROUGH`. Gateway and executor start with the placeholder allowlist `verify-uvw-pending-user`, which the first `user` replaces with the run user's ID. |
| `VERIFY_UVW_MCP_SAME_ORIGIN=1` | Serves the gateway at `http://127.0.0.1:<web port>/mcp` through Vite, as production does. Use it when a browser page calls `/mcp`, such as the Agents module. The gateway's own port then answers 403 on `/mcp` and serves only `healthz` and `metrics`. |
| `VERIFY_UVW_MCP_BUILD_CONTEXT=<checkout>` | Builds the image from another checkout, such as a clean `git worktree` at `origin/main` that reuses the cached install layer. Its `apps/mcp`, `packages/client-core` and `apps/cli/skill-data` must match this tree (`git diff origin/main -- apps/mcp packages/client-core apps/cli/skill-data` is empty). Doctor checks the image against that checkout's source digest. |
| `VERIFY_UVW_AGENT_PORT=<port>` | Registers the Workspace Agent's OAuth client for `agent-up`. See [Workspace Agent](#workspace-agent). |
| `EXECUTOR_MAX_WORKERS`, `EXECUTOR_IDLE_TTL_MS` | Size the executor pool (defaults 4 and 60000 ms), for both executors. They do not change product defaults. |
| `MCP_SYNC_BUDGET_MS=1` | Turns long Office and Typst calls into jobs. See [Typst job verification](../features/mcp.md#typst-job-verification). |
| `MCP_CIMD_ENABLED=0` | Passes through to the Workspace server. Unset means enabled. |

With MCP enabled, `up` also sets `MCP_RESOURCE_URLS` and `PUBLIC_ORIGIN` on the server for MCP OAuth. When
`claude.ai` resolves into `198.18.0.0/15`, `up` prints a fake-IP notice and sets
`MCP_CIMD_EXEMPT_NETWORKS=198.18.0.0/15` for the server alone.

Which mode a journey needs:

- Run [MB](../features/mcp.md#mb-deployment-and-per-account-tools) with `VERIFY_UVW_MCP_RENDERER=0` and
  `VERIFY_UVW_MCP_PRODUCTION=1`.
- Journeys that use `--auth dev`, MA5 and the session-based second-user client of MF4 need development
  mode, which is the default.
- M2, M3, M11, and the PAT and OAuth journeys also work in production. M9 rejects the Origin before
  authentication.
- M7, MR9 onward, screenshot checks and the renderer benchmark need the renderer.

To restart the same run for MO3, run `down`, then `up --reuse` with the same run id and ports. Reuse
needs the `data/` and `home/` that `down` removed, creates fresh data and credentials, keeps evidence,
and replaces logs, so save what you need from the logs first. Run `user` again after each restart.

## Credentials

`$V user` also creates an MCP session, a fresh opencode directory and a personal access token (PAT). The
gateway exchanges the PAT with Workspace (confidential client `univer-workspace-mcp-gateway`, whose
secret `up` writes to `home/mcp-oauth-secret`) for a short-lived session and its scopes. `$V env`
exports `MCP_URL`, `MCP_PROJECT`, `MCP_IMAGE`, `MCP_OPENCODE_DIR` and `MCP_OPENCODE_MODEL`. Sessions,
opencode config, the executor and renderer tokens, and the metrics token stay under `home/` with
credential files at mode 0600.

## Commands

```bash
$V mcp [--protocol 2026-07-28|2025-11-25] [--auth pat|oauth|dev|none|invalid | --as principal] [--toolsets list] [--expect-event '<jq>'] <label> <tool> [json]
$V mcp-tools|mcp-skills|mcp-resources|mcp-instructions [--protocol version] [--toolsets list] [--as principal] <label>
$V mcp-resource [--protocol version] [--toolsets list] [--as principal] <label> <uri>
$V mcp-token [--scopes read,write,...] [--name name]   # a new default PAT; prints only its id
$V mcp-oauth login <label> [--guest] [--scopes read,write,...] [--client-id <https-url>] [--token-resource omit|<url>]
$V mcp-oauth refresh|reuse <label> [--token-resource omit|<url>]
$V mcp-oauth revoke|direct <label>
$V mcp-oauth exchange <label> pat|oauth
$V mcp-allow-users <user-id>...|'*'|workspace
$V mcp-gateway-restart      # recreate only the gateway, also when the executor is stopped
$V mcp-logs                 # current gateway and executor logs
$V renderer-call <label> screenshot|printPdf|lint|measureText < input.json
$V renderer-restart [max-runtimes]   # recreate the renderer with RENDERER_MAX_RUNTIMES (default 2)
```

Labels match `^[A-Za-z0-9._-]{1,64}$`. Arguments default to `{}` and must be a JSON object. The default
protocol is 2026-07-28. Authentication defaults to `pat` once the run has a PAT and to `dev` before.
Development session passthrough exists only in development mode.

A call saves `<label>.cmd`, `.out`, `.result.json`, `.err`, `.exit`, `.gateway.log` and `.workspace.log`.
`.out` holds `structuredContent` on success, and for a tool error the `{code, message, detail}` JSON the
gateway sends as the result text. `.result.json` keeps the wire result. A tool call also saves
`.event.json` and checks its fields, request correlation and Bearer leakage. `--expect-event '<jq>'` adds
one more assertion on that event. `executor: none` requires zero worker costs. Exit codes: 0 success, 1 tool error, 2 usage, 3 transport or protocol failure, 4 HTTP 401,
5 a completed call with invalid evidence. Exit 5 fails the journey.

`mcp-oauth` is a scripted OAuth client for MO2 and MO3. `login` registers a client, or uses the CIMD
client named by `--client-id` with callback path `/callback`. It clears the run browser's cookies, signs
in as the run user, approves consent with only `--scopes` checked (default all four), and keeps the token
pair and client id in `home/mcp-oauth-*`. `mcp --auth oauth` then expects `auth_kind: oauth`. `login
--guest` needs no `user`. It takes the guest agent card, saves `<label>-guest-card.png`, and leaves the run
browser signed in as the guest. `refresh` rotates the pair, `reuse` replays the old refresh token, `revoke`
calls RFC 7009 revocation, `direct` sends the access token straight to Workspace, and `exchange` performs
the gateway's token exchange and signs the session out. Each writes `<label>.json` with token shapes only.
Never record raw codes, tokens or `state` values.

`mcp-allow-users` replaces the executor allowlist in either mode, on both executors. Give explicit user
IDs as separate arguments, `'*'` alone to open it to every user, or `workspace` alone to follow the grants
stored in the run's Workspace. Grant from `apps/workspace` with only the run's database:

```bash
env -i PATH="$PATH" HOME="$HOME" DATABASE_FILE="${VERIFY_UVW_ROOT:-/tmp/verify-uvw}/<run-id>/data/univer-workspace.sqlite" \
  node --import tsx server/src/db/executor-access.ts grant <username>   # also revoke, list
```

A grant or revoke reaches MCP in about 30 seconds without a restart. `mcp-allow-users` recreates the
executors, then the gateway, and keeps Workspace, Vite and the renderer running. Retry it after a failed
recreation. A later `user` keeps an allowlist you set.

## Jobs and retries

With `MCP_SYNC_BUDGET_MS=1` (default 30000) a long call returns a job, which can have no usage event
yet, and `mcp` records it without one. Poll `job_get`, then find the original request ID in the gateway
log to check one settled conversion event and its costs. A succeeded same-key retry of import, export or
`compile_typst` returns the original result with `_meta["univer.workspace.deduplicated"]: true` and emits
no second conversion event, and `mcp` checks that. A failed job releases its key, so a retry runs again.
A reused key with different arguments returns `workspace-idempotency-conflict` and starts nothing (MX10).

## Doctor and cleanup

With MCP enabled, `doctor` adds the container, image, network, credential and renderer checks. After
`user`, it also creates or reuses an `Executor doctor` pull request and a `Doctor` Sheet in the personal
Space to open a real worker. Rebuild with `down`, then `up`, whenever the image inputs change.
`mcp-build.json` and `logs/mcp-build.log` keep the build evidence.

`down` saves the gateway, executor and renderer logs under `logs/`, removes the run's containers,
networks, volumes and image tag, and prints `ok    MCP resources removed` after it checks the removal.
Build cache and evidence survive.

## Workspace Agent

Start with `VERIFY_UVW_AGENT_PORT=<port>`, then run `$V agent-up`. It builds and packs the Agent and its
plugins, installs the pinned DSH runtime and profile under `home/agent/`, and starts
`apps/agent/scripts/start-local.mjs` on that port. Installation can take several minutes
(`logs/agent-install.log`). The one-time browser URL is in `home/agent-url` and the raw logs in
`home/agent-log.private`. Never copy either into evidence. Open the URL in the run's agent-browser session
and confirm the onboarding service URL is `$ORIGIN` before signing in. `$V agent-down` stops it, and
`down` also deletes its installation. MA8 in [the MCP journeys](../features/mcp.md) drives it.

## Benchmarks and probes

- Executor sizing: `node .agents/skills/verify-uvw/bin/mcp-bench.mjs --help` and
  [the capacity benchmark](../features/mcp.md#executor-capacity-benchmark).
- Renderer sizing: `node .agents/skills/verify-uvw/bin/renderer-bench.mjs --help` and
  [the renderer benchmark](../features/mcp.md#renderer-capacity-benchmark). It recreates the renderer many
  times, so use a stack nothing else uses.
- Isolation baseline: `node .agents/skills/verify-uvw/bin/mcp-security-probes.mjs [--only MG6,MG7]` and
  [the MCP security journeys](../features/mcp-security.md).
