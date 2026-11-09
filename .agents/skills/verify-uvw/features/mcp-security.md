# MCP executor and renderer isolation

Users who do not trust each other run scripts through the MCP `execute` tool and render through `screenshot`. These journeys measure the
sandbox boundary from a user script and from the containers, and report for each isolation property whether it holds (`contained`) or does not
hold yet (`exposed`). They are the repeatable verification for the seven requirements in section 10 of
[the architecture document](../../../../docs/design/workspace-mcp/architecture.zh-CN.md) (stage G). They record variable names, presence and
latencies, never secret values. They target only the run's own disposable stack.

## Sub-features

Requirement numbers are the numbered items of architecture section 10: 1 no cross-user data or credential reads, 2 least Workspace permission,
3 no cross-user interference, 4 CPU, memory and wall-clock limits with reclamation, 5 minimal network, 6 no product data volumes, 7 unsafe
configuration refuses to start.

- MG1 (requirements 1, 2) is reserved: a user script cannot obtain the Workspace credential given to its worker. Covered by implementation tests.
- MG2 (requirement 1) lists the variable names a script sees in its own environment and in `/proc/<pid>/environ` of every process it can see.
  `contained` if no name matching `MCP_INTERNAL_TOKEN`, `UNIVER_LICENSE*`, `*_SECRET`, `*_TOKEN` or `*_KEY` is visible.
- MG3 (requirements 1, 5) is reserved: Node built-ins (`process.getBuiltinModule`, `process.binding`, `fetch`) are not reachable from the script
  realm. Covered by implementation tests.
- MG4 (requirement 5) makes one HTTP GET from a script to the renderer, the gateway, the Workspace transport URL, `169.254.169.254` and a public
  host. `contained` if none answers. This Mac's DNS is fake-IP (198.18.0.0/15): the evidence records the public host's resolved address and
  whether it is a fake IP.
- MG5 (requirement 1) registers a second user, warms a worker on their Unit (the script writes a marker file in `/tmp`), then from user A's script
  counts other processes in `/proc`, reads their cmdline and cwd, and lists `/tmp` and the cwd. `contained` if A sees no pid of B's worker, no
  marker and no other worker process.
- MG6 (requirements 3, 4) runs `for(;;){}` as A while B runs a small `execute`. `contained` if B succeeds and A's worker process is gone within
  30 s of A's deadline. Also records A's outcome and time, B's latency and whether A's next call gets a fresh worker.
- MG7 (requirements 3, 4) allocates heap as A, capped at 2 GiB so a missing limit cannot take down the shared Docker VM. `contained` if a limit
  stops the script (not the cap), the executor container survives, B succeeds and A's worker is reclaimed.
- MG8 (requirement 3) has A hold every worker slot (`EXECUTOR_MAX_WORKERS`, default 4) with 12 s scripts on distinct Units while B calls
  `execute` on a Unit it has not opened. `contained` if B is served.
- MG9 (requirement 6) reads `/proc/self/mountinfo` in the executor and renderer containers and from a script. `contained` if no mount other than
  the standard container mounts has a mount point or source containing `staging`, `data`, `workspace`, `sqlite`, `blob` or `verify-uvw`. The
  gateway's `/staging` mount is recorded as a control that the detector sees.
- MG10 (requirement 7) starts the run's image as executor and as renderer with `NODE_ENV=production`, session credentials, `runc`, the image's
  Chromium launch (`--no-sandbox`) on a throwaway internal network with no published ports. `contained` if both refuse to become healthy within
  30 s. The containers and the network are removed afterwards.
- MG11 (requirement 1) has A and B each call `screenshot`, then attributes each call to a Chromium browser process of the renderer by the CPU time
  that process tree used. `contained` if the two users were served by different browser processes.

## How to get to it (user POV)

An agent reaches these paths through the MCP gateway (`verify-uvw mcp ... execute`, `screenshot`) with a PAT. Isolation is invisible to a
well-behaved user, so a hostile user is simulated: the probes send scripts exactly as an agent would (MX1 in [mcp.md](./mcp.md)). The run needs
Docker Desktop, the MCP stack (`VERIFY_UVW_MCP=1 $V up`) and the disposable user (`$V user`).

## Driving it with agent-browser and uvw

No browser. From the repository root:

```bash
V=.agents/skills/verify-uvw/bin/verify-uvw
export VERIFY_UVW_RUN=<run-id>
$V doctor                                   # no FAIL; the executor worker check passes once a worker is warm (run $V user, then any execute)
node .agents/skills/verify-uvw/bin/mcp-security-probes.mjs
node .agents/skills/verify-uvw/bin/mcp-security-probes.mjs --only MG6,MG7
$V doctor
```

The probe prints one JSON line per check on stdout and a one-line reason per check on stderr:

```json
{"probe":"MG6","requirements":[3,4],"result":"contained","evidence":"evidence/mcp-security/MG6.json"}
```

`result` is `contained`, `exposed` or `inconclusive` (a probe that could not work, with the reason in its evidence file). `evidence` is relative
to the run directory. The exit status is 0 whatever the results, and 2 only when the stack cannot be reached. Run MG1 and MG3 from the
implementation tests that ship with the fix PRs; the script rejects them in `--only`.

Pass condition for the program: every implemented check reports `contained`, and MG1 and MG3 pass in the implementation tests. A fix PR
turns its checks to `contained` and records the rerun.

Baseline of the reserved checks, from code at `main` 26c1b69d (not a probe):

- MG1: `workspaceContentRuntimeWorker` receives `credential` in `WorkspaceContentWorkerInit` (`packages/client-core/src/content-worker.ts:23`) and
  puts it in the Workspace HTTP client as `cookie` (line 76). The executor resolves it with
  `grantCookie(resolveGrant(caller?.grant))` (`apps/mcp/src/executor/runtime.ts:33`), so the user's session cookie lives in the worker process that
  runs the user's script. Exposed.
- MG3: an exploratory `execute` showed `process.getBuiltinModule("fs")`, `process.binding` and `fetch` reachable from the script, and a script that
  reads `/proc/<pid>/environ` of other processes (MG2). Exposed, to be pinned by the implementation tests.

Baseline of MG2 and MG4-MG11 on `main` 26c1b69d with a local Docker Desktop stack (`runc`, one executor, `EXECUTOR_MAX_WORKERS=4`):

| Check | Result | Reason |
|---|---|---|
| MG2 | exposed | `MCP_INTERNAL_TOKEN` is visible in `/proc/1/environ` of the executor server, readable by the script (same uid). The worker's own environment holds only `NODE_ENV`. |
| MG4 | exposed | The script reaches the renderer, the gateway, the Workspace transport and a public host; only `169.254.169.254` times out. |
| MG5 | exposed | A sees B's worker pid in `/proc`, B's `/tmp` marker and other worker processes. |
| MG6 | contained | The 25 s operation timeout ends A; its worker process is gone within a second and B is served in under 100 ms. |
| MG7 | exposed | A allocates 2 GiB without a limit stopping it and its worker stays warm; B is served and the executor survives. |
| MG8 | exposed | While A holds all four slots, B gets `workspace-runtime-busy` after the 5 s queue timeout. |
| MG9 | contained | Neither container mounts a data or staging directory; the control sees `/staging` on the gateway. |
| MG10 | exposed | The executor refuses (`NODE_ENV=production forbids executor session grants until Stage G`); the renderer becomes healthy with `--no-sandbox`. |
| MG11 | exposed | One Chromium browser process serves both users; each call gets a context in the shared browser. |

## Gotchas

- The second user is `verify-<run-id>-b`. It is registered through `/api/auth/password/register` and its password and PAT live in
  `<run>/home/mcp-security-b.pw` and `.token` (mode 0600), so a rerun reuses them. `down` removes the run directory with them.
- Each invocation creates its own pull requests and Units (`mg-a-n`, `mg-b-n`) with random idempotency keys. They are disposable run data.
- MG2 also lists the Docker health-check `node -e` process, which has the executor's environment. That is real: the script can read it.
- MG5's "other worker" count includes A's own earlier workers. The pid and marker findings are the decisive ones.
- MG6 and MG7 each take 30-60 s because they wait for the operation timeout and the reclamation window. MG8 takes about 25 s.
- MG7 never allocates more than 2 GiB. If a later limit is above that, raise the cap in the script with the limit, not before.
- MG8 drains nothing: B's script runs on a Unit that was never opened, so it needs a worker slot whether workers are keyed per Unit or per user.
- MG11 reads CPU time per process tree in the renderer container. With only one Chromium browser process alive (the renderer warms runtimes
  lazily) both users share it by construction; the evidence records how many browser processes existed.
- MG10 runs `docker run` with this run's image and `--internal` networking. If the probe is killed mid-run, remove `mg10-*` containers and
  networks by hand (`docker rm -f $(docker ps -aq --filter name=mg10-)`).
- `$V doctor` fails "MCP executor verification: at least one live worker must be inspected" until a worker is warm. A worker idles out after
  `EXECUTOR_IDLE_TTL_MS` (60 s), so run doctor soon after a probe, or after any `execute`.
- The probes assume Docker Desktop's executor and renderer share the compose network `default` and `render`. The Workspace transport target is
  `http://host.docker.internal:<server port>`.
- Never point the probes at another run's ports, the developer's `:3020`/`:5173` instance or a real host.
