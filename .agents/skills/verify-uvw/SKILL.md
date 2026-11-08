---
name: verify-uvw
description: Verify Univer Workspace (apps/workspace web + server) and the uvw CLI (apps/cli) end to end in an isolated, disposable instance on 127.0.0.1:3920/5973. Launches server + Vite web against a temp data dir, registers a throwaway password user, drives the browser with agent-browser and the source-built uvw, captures screenshots and command transcripts, then tears down without touching the developer's :3020/:5173 instance, .data/ SQLite files, or ~/.univer-workspace-cli. Use when you need to prove a Workspace or CLI change works in the real app, not just in tests.
---

# verify-uvw

Everything goes through one helper. Run it from the repository root:

```bash
V=.agents/skills/verify-uvw/bin/verify-uvw
$V up        # start server :3920 + web :5973 on a fresh temp data dir
$V doctor    # read-only: is this instance ours and worth driving?
$V user      # register a throwaway password user and sign uvw in as it
$V env       # print exports for agent-browser / uvw in the current shell
$V cli <label> <uvw args...>   # run uvw and save cmd/stdout/stderr/exit as evidence
$V uvw <uvw args...>           # run uvw without recording (exploration)
$V down      # stop what this run started, delete data; keep evidence + logs
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
   OAuth/data variables out, so password auth is the only sign-in method.
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

`$V doctor` is read-only. Run it first, and again whenever anything looks off. It
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
- Nothing is mocked. Collaboration, Office exchange, and the CLI daemon are all real. OAuth
  providers are absent by design and are not verifiable here.
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
port 3930. Override it with `VERIFY_UVW_MCP_PORT`. Without opt-in, existing commands
keep their behavior and output, including runs created before MCP support.

Run `$V user` to create an independent MCP session, a fresh opencode directory and a personal
access token (PAT). The gateway exchanges the PAT with Workspace (confidential client
`univer-workspace-mcp-gateway`, created by `up` with a random secret in `home/mcp-oauth-secret`) for a
short-lived downstream session and scopes. `$V mcp-token [--scopes read,...]` creates another PAT and makes it
the default; it prints only the PAT id.
`$V env` exports `MCP_URL`, `MCP_PROJECT`, `MCP_IMAGE`, `MCP_OPENCODE_DIR`, and
`MCP_OPENCODE_MODEL=console-deepseek/deepseek-flash#high`. Sessions, opencode config,
and the metrics token stay under `home/` with credential files mode 0600.

```bash
$V mcp [--protocol 2026-07-28|2025-11-25] [--auth pat|dev|none|invalid] [--toolsets list] <label> <tool> [json]
$V mcp-tools [--protocol version] [--toolsets list] <label>
$V mcp-resources [--protocol version] [--toolsets list] <label>
$V mcp-resource [--protocol version] [--toolsets list] <label> <uri>
$V mcp-instructions [--protocol version] [--toolsets list] <label>
$V mcp-token [--scopes read,write,...] [--name name]
$V mcp-logs
```

Labels match `^[A-Za-z0-9._-]{1,64}$`. Arguments default to `{}` and must be a JSON
object. The default protocol is 2026-07-28. Authentication defaults to `pat` when the run has a PAT and
to `dev` otherwise; the development session passthrough stays enabled for `--auth dev`.
`mcp-tools` saves the ordered tool definitions. `mcp-resources`, `mcp-resource` and `mcp-instructions` save the resource list, one resource's contents and the initialize `instructions`. `mcp-logs` prints current gateway logs.
Use [the MCP journeys](features/mcp.md) for exact commands and pass conditions.

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

`down` saves `logs/mcp-gateway.log`, removes this run's compose containers, networks,
volumes and image tag, then deletes `home/` with the other disposable data. It prints
`ok    MCP resources removed` only after checking resource removal. Cleanup failures
warn and continue. Run `down` after failures too. Build cache and evidence survive.
