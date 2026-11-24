# MCP production shape and per-account tools

In the production shape, with no renderer, PAT sign-in and an executor allowlist, each account sees only the
tools it may use. A user outside the allowlist keeps the HTTP tools and has no `execute`, the instructions never
name a hidden tool, and `/readyz` follows Workspace availability.

## Sub-features

- MB1 through MB5 verify the production shape without a renderer: tool lists, instructions, a user outside the executor allowlist, executor journeys and `/readyz`. MB6 follows the executor grants Workspace stores.

## How to get to it (user POV)

An operator deploys the gateway with `NODE_ENV=production` and an executor allowlist, set here with
`$V mcp-allow-users`. An MCP client then lists tools at `$MCP_URL` as usual.

## Driving it with agent-browser and uvw

MB starts its own production run, as written below, so do not reuse a default MCP run. The other MCP-mode
rules in [MCP gateway](mcp.md) still apply.

### MB. Deployment and per-account tools

Port 6000 is blocked by Node's `fetch` port policy; use 6001 or another unblocked free web port.

MB validates the production shape with a gateway and one shared executor, no renderer, and PAT authentication. Start `up` in a persistent shell so Workspace and Vite survive between tool calls. Choose unused ports and a unique run ID; always keep that ID for subsequent commands.

```bash
V="$PWD/.agents/skills/verify-uvw/bin/verify-uvw"
export VERIFY_UVW_RUN=mb-g0 VERIFY_UVW_MCP=1
export VERIFY_UVW_SERVER_PORT=3950 VERIFY_UVW_WEB_PORT=6001 VERIFY_UVW_MCP_PORT=3955
VERIFY_UVW_MCP_RENDERER=0 VERIFY_UVW_MCP_PRODUCTION=1 $V up
$V user
eval "$($V env)"
node .agents/skills/verify-uvw/bin/mcp-availability.mjs
$V down
```

The script replaces the executor allowlist with the run user's ID through `$V mcp-allow-users <user-id>`. It checks the following and saves `mb.json` plus per-call evidence under `$EVIDENCE`:

- MB1 compares ordered `tools/list` names for `core`, `files`, `admin`, `core,files`, `core,admin`, `files,admin` and `all` with literal expected lists in the script. These are the full lists minus `screenshot`, `print_pdf` and `lint`.
- MB2 checks instructions for all seven connections and rejects those three hidden tool names.
- MB3 registers another Workspace user through the public API and creates a PAT in memory. This user receives exactly 47 non-executor tools in registry order for `all`. `execute` fails identically to an unknown tool, `repo_list` succeeds, and instructions contain `Editing document contents is not enabled for this account`. No credential enters evidence.
- MB4 runs MX1 through MX3 above with PAT authentication. It compares MCP and CLI write/readback results, checks cold/warm usage events, verifies the Ready error, runs doctor, and stops only this run's executor to check the unavailable error. A `finally` restarts it even after a failed assertion.
- MB5 checks `/readyz` for 200. It stops the executor, then uses `$V mcp-gateway-restart` to recreate only the gateway and clear its remembered capabilities. `/readyz` must return 503 naming the `executor` check, then 200 within ten seconds after the executor restarts. Stopping an executor after successful discovery alone does not make the gateway unready, because HTTP tools remain usable. The optional Workspace stop/restart check is recorded as not run because `verify-uvw` has no independent server restart command. A base older than `/readyz` (#276) returns 404 and records MB5 as `not_run` in `mb.json`; it does not claim readiness passed. Other unexpected statuses fail the script.

Successful output is `PASS MB1` through `PASS MB5`. `NOT RUN MB5 /readyz returned 404` means the base predates `/readyz`. Repeated runs create new PRs and a new restricted user inside this disposable Workspace. `down` removes all of them with the run's data.

To check the `*` allowlist on the same stack before `down`, shut the run user out, then open the executor to everyone:

```bash
$V mcp-allow-users someone-else
$V mcp-tools --toolsets all mb-star-before
$V mcp-allow-users '*'
$V mcp-tools --toolsets all mb-star-after
jq -e 'map(.name) | index("execute") == null and length == 47' "$EVIDENCE/mb-star-before.out"
jq -e 'map(.name) | index("execute") != null and length == 60' "$EVIDENCE/mb-star-after.out"
$V doctor
```

Pass when the run user, outside an explicit allowlist, gets the 47 non-executor tools, then all 60 renderer-less tools with
`*`, and doctor reports the allowlist matches the run. Running `$V user` again keeps `*`.

### MB6. Workspace grants

`$V mcp-allow-users workspace` makes gateway and executor follow the grants the
run's Workspace stores. It works on the default development stack too. Grant from `apps/workspace`:

```bash
G() { env -i PATH="$PATH" HOME="$HOME" DATABASE_FILE="${VERIFY_UVW_ROOT:-/tmp/verify-uvw}/$VERIFY_UVW_RUN/data/univer-workspace.sqlite" \
  node --import tsx server/src/db/executor-access.ts "$@"; }
G list                      # "No users have executor access" before any grant
G grant "verify-$VERIFY_UVW_RUN"
G revoke "verify-$VERIFY_UVW_RUN"
```

Before the grant, `mcp-tools --toolsets all` lists 47 tools without `execute` and the instructions contain
`Editing document contents is not enabled for this account`. About 35 s after `grant` (the gateway caches the
exchange for 30 s), the list has 63 tools with the renderer (60 without) and `execute` runs. About 35 s after
`revoke` it is back to 47 and `execute` fails with `Tool execute not found`. No container restarts. `list`
prints `username<TAB>id<TAB>kind<TAB>granted-at`.

`VERIFY_UVW_MCP_RENDERER=0` also works without production mode. Neither flag changes the default three-container development run. The `mcp-allow-users` command works in both modes and recreates only the gateway and executor(s); the renderer ID stays unchanged.

Journeys with development session authentication run only in the default development mode. Search this file for `--auth dev` and session-based MCP clients before selecting journeys for production. MF4's direct second-user client uses a Workspace session. Renderer journeys, including screenshots, PDF, lint and precise text measurement, require the renderer enabled.

## Gotchas

- The MCP-mode gotchas in [MCP gateway](mcp.md#gotchas) apply.
