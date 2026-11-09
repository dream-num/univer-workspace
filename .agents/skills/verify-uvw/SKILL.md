---
name: verify-uvw
description: Verify Univer Workspace (apps/workspace web + server) and the uvw CLI (apps/cli) end to end in an isolated, disposable instance on 127.0.0.1:3920/5973. Launches server + Vite web against a temp data dir, registers a throwaway password user, drives the browser with agent-browser and the source-built uvw, captures screenshots and command transcripts, then tears down without touching the developer's :3020/:5173 instance, .data/ SQLite files, or ~/.univer-workspace-cli. Use when you need to prove a Workspace or CLI change works in the real app, not just in tests.
---

# verify-uvw

Everything goes through one helper. Run it from the repository root:

```bash
V=.agents/skills/verify-uvw/bin/verify-uvw
$V up        # start server :3920 + web :5973 on a fresh temp data dir
$V doctor    # is this instance ours and worth driving?
$V user      # register a throwaway password user and sign uvw in as it
$V env       # print exports for agent-browser / uvw in the current shell
$V cli <label> <uvw args...>   # run uvw and save cmd/stdout/stderr/exit as evidence
$V uvw <uvw args...>           # run uvw without recording (exploration)
$V agent-up  # install/start Agent (requires VERIFY_UVW_AGENT_PORT at up)
$V agent-down # stop only this run's Agent
$V down      # stop what this run started, including Agent; delete data; keep evidence + logs
```

A run lives at `/tmp/verify-uvw/<run-id>/` (`VERIFY_UVW_ROOT` overrides `/tmp/verify-uvw`):

| Path | Content | Survives `down` |
| --- | --- | --- |
| `data/` | product SQLite, collaboration SQLite, blobs | no |
| `home/` | `UNIVER_HOME` for uvw (origin config, session) | no |
| `user.pw` | throwaway password | no |
| `run.env`, `user.env` | ports, PIDs, launch HEAD, username | yes |
| `logs/` | `server.log`, `web.log`, `register.json` | yes |
| `evidence/` | screenshots and `cli` transcripts | yes |

`/tmp/verify-uvw/current` points at the latest run. Each Bash tool call is a new shell, so
start every call that uses agent-browser or uvw with `eval "$($V env)"` (it also sets
`$ORIGIN` and `$EVIDENCE`).

## Launch

Prerequisites, checked by `up` and `doctor`, each with its fix:

- `node_modules` matches `pnpm-lock.yaml`, else `pnpm install --frozen-lockfile`. A stale
  install makes the server die at startup with "module does not provide an export named …".
- `apps/cli/dist` and `packages/client-core/dist` are newer than their `src`, else
  `pnpm --filter 'univer-workspace-cli...' build` (about 10 s).
- Ports 3920 and 5973 are free. `up` refuses to start rather than drive someone else's
  process. Your own dev servers on 3020/5173 are never touched.

`$V up` then:

1. Starts `node --import tsx server/src/main.ts` in `apps/workspace` under `env -i` with
   `HOST=127.0.0.1 PORT=3920` and `DATABASE_FILE`, `COLLABORATION_DATABASE_FILE`,
   `BLOB_DIRECTORY` inside `data/`. `env -i` keeps `apps/workspace/.env` and your shell's
   OAuth provider/data variables out, so password auth is the only user sign-in method.
   With MCP enabled, it also sets `MCP_RESOURCE_URLS=http://127.0.0.1:<mcp port>/mcp`
   and `PUBLIC_ORIGIN=http://127.0.0.1:<web port>` for Workspace MCP OAuth authorization.
2. Starts Vite on 5973 with `WORKSPACE_DEV_API_PORT=3920`; it proxies `/api` and
   `/universer-api` (including WebSockets) to the server.
3. Waits until `GET /api/session` answers on both ports. The server creates and migrates
   the empty databases before it listens, so a 200 there means usable.

Ready output prints the run id, both URLs and the evidence directory. Typical start is
under 10 s. On failure it tails the log; run `$V down` before retrying.

`$V user [name]` registers `verify-<run-id>` (display name `Verify <run-id>`) through
`POST /api/auth/password/register`, writes its random password to `user.pw`, sets
`workspace.origin` to `http://127.0.0.1:5973` in the run's `UNIVER_HOME`, and runs
`uvw auth login --username … --password-stdin`. Rerunning it only signs uvw in again. The
user owns Personal Space `verify-<run-id>/personal`.

The server does not reload. After changing server or CLI code: rebuild the CLI if needed,
`$V down`, `$V up`, `$V user`. Web code under `apps/workspace/web` hot-reloads through Vite.

## Doctor

`$V doctor` checks the disposable instance. With MCP enabled after `user`, it creates or reuses a dedicated idempotent doctor Worktree and Sheet, then opens a worker through gateway inspection. Run it first, and again whenever anything looks off. It
exits non-zero when any line says `FAIL`:

- dependency and CLI build freshness (as above)
- the run exists, and the server and web PIDs are alive
- each port's listening PID is the PID this run started
- the server has this run's `data/univer-workspace.sqlite` open
- `$ORIGIN/api/session` answers through the Vite proxy
- `HEAD` has not moved since launch (if it has, the server is running old code)
- uvw is signed in to `$ORIGIN` as this run's user (after `$V user`)

## Drive

**Browser (agent-browser).** `$V env` exports `AGENT_BROWSER_SESSION=verify-uvw-<run-id>`.
That gives this run its own headless browser, separate from your other agent-browser
sessions. Always use `127.0.0.1`, never `localhost` or another host, because the bundled
Univer license is bound to the domain and editors degrade elsewhere.

```bash
eval "$($V env)"
agent-browser open "$ORIGIN/login" && agent-browser wait 1500
agent-browser storage local set univer-workspace-language en-US && agent-browser reload && agent-browser wait 1500
agent-browser find label "Username" fill "verify-$VERIFY_UVW_RUN"
agent-browser find label "Password" fill "$(cat /tmp/verify-uvw/$VERIFY_UVW_RUN/user.pw)"
agent-browser click 'form button[type=submit]'
agent-browser wait --url '**/home'
agent-browser snapshot -i -c                      # find stable names before acting
agent-browser screenshot "$EVIDENCE/<feature>-<step>.png"
```

Prefer `find role <role> --name "<accessible name>"` and `find label`. The names come
from `web/src/shared/i18n.tsx`; the locale pin above keeps them English. Univer grids are
canvas. Type into the selected cell with `agent-browser keyboard type` and `press Tab|Enter`,
then read the result back through uvw or a screenshot, not the DOM.

**CLI (uvw).** `$V uvw` and `$V cli` run `apps/cli/dist/main.js` with the run's
`UNIVER_HOME`. Never call a global `uvw`: it targets `~/.univer-workspace-cli` and
`https://space.univer.ai/`. Use `--json` and IDs returned by earlier commands.

```bash
$V cli pr-create pr create -R verify-<run-id>/personal -t "Title" --json
```

The feature map in [`features/README.md`](features/README.md) lists the journeys and the
exact commands. Use it as the recipe.

## Evidence

Everything goes in `$EVIDENCE` (`/tmp/verify-uvw/<run-id>/evidence/`), which survives `down`:

- CLI proof: `$V cli <label> …` writes `<label>.cmd`, `.out`, `.err`, `.exit`.
- UI proof: a screenshot after the action, plus a reload or a second route showing the
  persisted state. Name files `<feature>-<step>.png`.
- A mutation needs a second, read-only view. Examples: a browser edit read back with
  `uvw inspect --trunk`, or a uvw write seen in the browser after reload. A success toast or
  exit code 0 alone proves nothing.
- Drive the real user path: browser controls or uvw commands against the HTTP API. Do not
  insert SQLite rows, call internal services, or use test-only endpoints. Registration via
  the public register endpoint in `$V user` is setup, not proof of the auth feature. The
  [auth journey](features/auth.md) proves that.
- Nothing is mocked. Collaboration, Office exchange, and the CLI daemon are all real. External OAuth
  providers are absent by design. Workspace acting as the MCP OAuth authorization server
  is covered by MO1 in [the MCP journeys](features/mcp.md).
- In the report, give the run id, launch HEAD (`run.env`), feature IDs, and artifact paths.

## Cleanup

```bash
$V down
```

This closes this run's agent-browser session and stops the uvw daemon under this run's
`UNIVER_HOME`. It then kills only the recorded server and Vite PIDs, after checking each
one's command line is still `server/src/main.ts` or `vite.js`, plus their direct children.
It deletes `data/`, `home/` and `user.pw`, and keeps `evidence/` and `logs/`. Never kill by
process name or port, run `db:reset`, or touch `apps/workspace/.data/`. Delete old runs'
evidence with `rm -rf /tmp/verify-uvw/<run-id>` only when you no longer need the proof.

Run `down` after every failed attempt too, so stray processes don't keep 3920/5973.

## Parallel runs

One run per port pair. A second concurrent run needs its own ports and an explicit id in
**every** call, because `current` follows the newest `up`:

```bash
VERIFY_UVW_RUN=b VERIFY_UVW_SERVER_PORT=3921 VERIFY_UVW_WEB_PORT=5974 VERIFY_UVW_MCP_PORT=3931 $V up
VERIFY_UVW_RUN=b $V doctor
```

## MCP gateway

On macOS Docker Desktop, opt in with `VERIFY_UVW_MCP=1 $V up`. This builds
`apps/mcp/Dockerfile` from the working tree and starts a compose gateway on loopback
port 3930. Override it with `VERIFY_UVW_MCP_PORT`. Set `VERIFY_UVW_MCP_EXECUTORS=2` at
`up` to enable a second executor for MX13. The replica count is saved in the run. With MCP enabled, `up` resolves `claude.ai`. Only when an address is in `198.18.0.0/15`,
it prints a fake-IP notice and sets `MCP_CIMD_EXEMPT_NETWORKS=198.18.0.0/15` for the Workspace
Server alone. `MCP_CIMD_ENABLED=0` in the launching shell passes through to that server;
unset defaults to enabled. To restart the same run for MO3, use `down`, then `up --reuse`
with the same explicit run ID and ports. Reuse requires that `down` removed `data/` and
`home/`; it creates fresh data and credentials while retaining evidence. Logs are replaced,
so save the relevant redacted facts before restarting. Run `user` again after each restart.
Without opt-in, existing commands
keep their behavior and output, including runs created before MCP support.

Two independent flags at `up` select the deployment shape and are saved in `run.env`:

- `VERIFY_UVW_MCP_RENDERER=0` omits the renderer container and `MCP_RENDERER_URL` from the executor(s). Doctor verifies that no renderer exists and skips renderer probes. `renderer-call` and `renderer-restart` refuse this mode.
- `VERIFY_UVW_MCP_PRODUCTION=1` sets `NODE_ENV=production` and omits `MCP_DEV_SESSION_PASSTHROUGH`. Gateway and executor start with the non-user placeholder `verify-uvw-pending-user` in their allowlists. The first `user` replaces that placeholder with the registered Workspace user ID and recreates only gateway and executor(s). Product startup validation stays intact.

With neither flag, MCP still starts three containers in development mode, allows dev passthrough, and leaves the executor unrestricted. Both flags require `VERIFY_UVW_MCP=1`.
`$V mcp-allow-users <user-id>...` replaces the entire allowlist in either mode, including both replicas when enabled. Supply one or more explicit Workspace user IDs as separate arguments, not usernames or a comma-separated string. It saves `executor-allowed-user-ids` beside `run.env`, waits for recreated executor(s), then recreates the gateway so capability discovery sees the ready executors, without rebuilding or restarting Workspace, Vite or the renderer. Retry the same command after a failed recreation. Repeated `user` preserves an explicitly chosen allowlist.

Run the [MB journey](features/mcp.md#mb-deployment-and-per-account-tools) with both flags to verify the G0 gateway and allowlisted executor without a renderer. Journeys using `--auth dev` need the default mode. MA5 (`--auth dev`) and MF4's session-based second-user client need development mode. M2/M3 and M11 use the run's PAT after `user` and also work in production; M9 rejects the Origin before authentication. PAT and OAuth journeys work in production. Renderer journeys MR9 onward, screenshot checks and the renderer benchmark need the renderer enabled.

Set `EXECUTOR_MAX_WORKERS` and `EXECUTOR_IDLE_TTL_MS` in the launching shell before
`up` to size an experimental executor pool. Unset values keep the existing defaults
of 4 workers and 60000 ms. These Compose settings also apply to `executor-b`.
Restart with `down`, then `up` after changing them. They do not change product defaults.

Run `$V user` to create an independent MCP session, a fresh opencode directory and a personal
access token (PAT). The gateway exchanges the PAT with Workspace (confidential client
`univer-workspace-mcp-gateway`, created by `up` with a random secret in `home/mcp-oauth-secret`) for a
short-lived downstream session and scopes. `$V mcp-token [--scopes read,...]` creates another PAT and makes it
the default; it prints only the PAT id.
`$V env` exports `MCP_URL`, `MCP_PROJECT`, `MCP_IMAGE`, `MCP_OPENCODE_DIR`, and
`MCP_OPENCODE_MODEL=console-deepseek/deepseek-flash#high`. Sessions, opencode config,
and the metrics token stay under `home/` with credential files mode 0600.

```bash
$V mcp [--protocol 2026-07-28|2025-11-25] [--auth pat|oauth|dev|none|invalid] [--toolsets list] <label> <tool> [json]
$V mcp-tools [--protocol version] [--toolsets list] <label>
$V mcp-resources [--protocol version] [--toolsets list] <label>
$V mcp-resource [--protocol version] [--toolsets list] <label> <uri>
$V mcp-instructions [--protocol version] [--toolsets list] <label>
$V mcp-token [--scopes read,write,...] [--name name]
$V mcp-oauth login <label> [--scopes read,write,...] [--client-id <https-url>]
$V mcp-oauth refresh|reuse|revoke|direct <label>
$V mcp-oauth exchange <label> pat|oauth
$V mcp-allow-users <user-id>... # replace the executor allowlist; recreate executor(s), then gateway
$V mcp-gateway-restart       # recreate only gateway, including when executor is stopped
$V mcp-logs
```

`mcp-oauth` is a scripted MCP OAuth client for MO2 and MO3.
`login --client-id <https-url>` skips registration and uses a CIMD client (the loopback
callback path is `/callback`, as used by Claude Code). It records the consent name and
checks the callback code, state and `iss` without saving the code or state. `login` registers a client, clears the run browser's cookies, signs in
as the run user through the login page, approves the consent page with only `--scopes` checked (default all four), and keeps the access token, refresh token and client id in
`home/mcp-oauth-*` (mode 0600); `mcp --auth oauth` then calls the gateway with that access token and expects `auth_kind: oauth`.
`refresh` rotates the pair, `reuse` replays the previous refresh token, `revoke` calls RFC 7009 revocation, `direct` sends the
access token straight to Workspace, and `exchange` performs the gateway's token exchange for the PAT or the access token, then
signs the returned session out. Each writes `<label>.json` with token shapes only and exits 0 on the expected success status, 1 otherwise.
Set `VERIFY_UVW_AGENT_PORT=<port>` at `up` to also register the Workspace Agent's public OAuth client
`univer-workspace-harness` with callback `http://127.0.0.1:<port>/auth/oauth/callback`.
Then `$V agent-up` builds and packs the repository's Agent and plugins, installs the pinned DSH
runtime and profile under `home/agent/`, checks that pnpm uses the run-local package store, and starts `apps/agent/scripts/start-local.mjs` on that
port. Installation can take several minutes; see `logs/agent-install.log`. The one-time browser
URL is in `home/agent-url` (mode 0600), and raw Agent logs stay in `home/agent-log.private`
(mode 0600); never copy either into evidence. Open the URL in this run's agent-browser session.
The helper seeds the configured `127.0.0.1` Workspace origin without a session; confirm the
onboarding service URL is `$ORIGIN` before signing in. No model credentials are needed.
`$V agent-down` stops the recorded launcher after checking its command line; `$V down` does this
as well and deletes the installation, runtime data and private logs with `home/`.
Labels match `^[A-Za-z0-9._-]{1,64}$`. Arguments default to `{}` and must be a JSON
object. The default protocol is 2026-07-28. Authentication defaults to `pat` when the run has a PAT and
to `dev` otherwise. Development session passthrough is available only in the default development mode; production requires PAT or OAuth.
`mcp-tools` saves the ordered tool definitions. `mcp-resources`, `mcp-resource` and `mcp-instructions` save the resource list, one resource's contents and the initialize `instructions`. `mcp-logs` prints current gateway and executor logs.
`$V renderer-call <label> screenshot|printPdf|lint|measureText < input.json` sends one operation to the renderer from inside the
executor container and saves `<label>.json` plus the PNG or PDF payload in `$EVIDENCE`. `bin/renderer-proof.mjs` prints a small
Sheet or Doc with Latin and Chinese text as such an input. `$V renderer-restart [max-runtimes]` recreates only this run's renderer with
`RENDERER_MAX_RUNTIMES` set to that value (default 2) and returns once its startup runtime is warm.
Use [the MCP journeys](features/mcp.md) for exact commands and pass conditions.
MO1 proves browser OAuth sign-in from a single MCP URL using a separate `ws` opencode
config without an Authorization header. It needs the Workspace MCP OAuth authorization
server (PR #216), agent-browser, and the model credentials available to the isolated
opencode environment. It checks discovery through Vite, the four consent scopes, the
callback without `worktree:merge`, and successful `whoami` and `repo_list` OAuth events.
Its temporary project lives under this run's `home/`, with all four XDG directories and
a free managed-service port set by `opencode service set port`. The trap stops that
service and the auth process, saves the consent screenshot and redacted transcripts in
`$EVIDENCE`, and deletes the isolated credentials on success or failure. Never record
raw codes, tokens, or `state` values in evidence.

Calls save `<label>.cmd`, `.out`, `.result.json`, `.err`, `.exit`, `.gateway.log`,
and `.workspace.log` in `$EVIDENCE`. Tool calls also save `.event.json` and check its
fields, Workspace request correlation, and Bearer leakage. HTTP failures preserve the
status, authentication challenge, and body. Exit codes are 0 for success, 1 for a tool
error, 2 for usage, 3 for transport or protocol failure, 4 for HTTP 401, and 5 for a
completed call with invalid evidence.

`doctor` checks Docker Desktop, the source digest, container health and image identity,
port mapping, container configuration and Workspace access, protected metrics, and,
after `user`, MCP identity, the PAT token exchange, and session, PAT and client-secret leakage. Rebuild with `down`, then `up` when
inputs change. `mcp-build.json` and `logs/mcp-build.log` retain build evidence.

`down` saves `logs/mcp-gateway.log`, `logs/mcp-executor.log` and `logs/mcp-renderer.log`, removes this run's compose containers, networks,
volumes and image tag, then deletes `home/` with the other disposable data. It prints
`ok    MCP resources removed` only after checking resource removal. Cleanup failures
warn and continue. Run `down` after failures too. Build cache and evidence survive.

The renderer (`MCP_ROLE=renderer`, same image, Chromium and CJK fonts inside) starts by default with MCP on its own compose
network declared `internal: true`, joined only by the executor(s) and the renderer. The gateway waits for it to be healthy.
`doctor` checks its image, that it has no published port and joins one internal network, bearer rejection, protected metrics,
a real `measureText` call from the executor, that it cannot reach `host.docker.internal:<server port>`, the gateway or a public
host, and that its logs hold no credential. `down` removes its container and network with the rest of the project.

The executor has no published port. `doctor` verifies its image, bearer rejection, HTTP/ticket/
collaboration WebSocket transport, log redaction and worker environment. The positive RPC check runs inside the gateway with its configured token and executor URL.
The worker check rejects zero inspected workers. It verifies the child environment only; same-uid
workers can still read the executor environment through `/proc/1/environ` until Stage G.
Log checks include license and license-key values. `mcp --expect-event '<jq expression>'` adds a per-call event
assertion. `executor: none` requires zero worker costs (`worker_cpu_ms`, `worker_peak_rss_mb`,
`render_pages`, `committed_revisions`); gateway file tools may report transfer bytes.
Worker calls report cold/warm and nonnegative costs.


For long Office or Typst jobs, set `MCP_SYNC_BUDGET_MS=1` before starting the verification stack.
The default is 30000. A job-returning call can have no usage event yet; `mcp-call` records
that response without requiring an early event. Poll `job_get`, then inspect the original
request ID in gateway logs to verify one settled conversion event and its real costs.
Deduplicated retries emit no second conversion event. Start a default-budget stack for
existing synchronous Office journeys.

A succeeded same-key import/export/compile_typst retry returns the original tool result directly.
Deduplicated responses carry `_meta["univer.workspace.deduplicated"]: true`; the call helper
requires zero additional conversion events for that marker. Failed jobs release their keys,
so a retry runs again and emits its own settled event. A reused key with different arguments
returns `workspace-idempotency-conflict` and starts nothing (MX10).

For executor sizing and sustained-write measurements, use
`node .agents/skills/verify-uvw/bin/mcp-bench.mjs --help` and the
[capacity benchmark recipe](features/mcp.md#executor-capacity-benchmark).
Run `--self-test` before a real run. The default benchmark saves JSON with sample
counts, median, range, p95 for at least twenty observations, errors, usage events,
readback checks, process RSS, and host counters. It waits for a quiet machine and
never supplies production sizing numbers without a local measurement.

For renderer sizing (latency per operation, throughput against `RENDERER_MAX_RUNTIMES`, memory per runtime, memory growth across reused
renders), use `node .agents/skills/verify-uvw/bin/renderer-bench.mjs --help` and the
[renderer benchmark recipe](features/mcp.md#renderer-capacity-benchmark). It recreates the renderer many times, so run it on a stack
nothing else is using. `bin/renderer-bench-summary.py` renders its JSON as the tables in the architecture document.

For the stage G isolation baseline (secrets, network, cross-user visibility, CPU and memory limits, pool fairness, mounts, fail-closed
configuration, renderer separation), run `node .agents/skills/verify-uvw/bin/mcp-security-probes.mjs [--only MG6,MG7]`. It prints one JSON
line per check, `contained` or `exposed`; see [the MCP security journeys](features/mcp-security.md).
