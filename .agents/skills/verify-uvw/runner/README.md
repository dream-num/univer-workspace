# Verify runner

The runner runs verify-uvw journeys in disposable Linux containers. Each task goes to a new Claude Code session
in a container, and no instance of yours starts. The runner is opt-in. Host mode in [SKILL.md](../SKILL.md) is
the default. Use the runner only when the user asks for it, for example with `mode:runner`, or when their own
configuration outside this repository says so.

The runner costs more than a host run:

- It needs Docker and a `DEEPSEEK_API_KEY`. Every task that starts a session spends money on DeepSeek's API.
- It builds an image of about 4 GB from `runner/Dockerfile` the first time, and again after each change to that file.
- It starts up to 3 containers at once. Together they use all but 2 of the CPU cores that Docker reports.
- It sends data off this machine. Each session sends the brief, the recipes, command output, screenshots and any
  repository file the verifier reads to DeepSeek's API.

## Check before you start

Pick the features and journeys from [the index](../features/README.md). Behavior no journey covers needs host
mode, because the runner follows recipes and does not design checks. From the repository root, set
`R="node .agents/skills/verify-uvw/runner/runner.mjs"`, then run `$R --check <feature[:ID,ID]>...` with the rest
and act on what it prints:

- A `host` line means [host-only.mjs](host-only.mjs) leaves that feature or those journeys to the host, and says
  why each cannot run in a container. The runner skips them. Tell the user, then run them in host mode as
  [SKILL.md](../SKILL.md) describes.
- A `hint` line names MCP packaging changes that no runner result proves, as
  [What the runner does not prove](#what-the-runner-does-not-prove) says. Tell the user, then run its commands in
  host mode too.
- Exit `5` or `3` with a `FAIL` line means the key is missing or refused, or Docker is missing. Tell the user in
  one sentence what the runner needs, and offer host mode. Do not switch on your own. For a refused key, quote the
  `FAIL` line. It names the key's source and fingerprint and the API's answer.
- A `todo  image` line means the image for the current `runner/Dockerfile` is not built yet. The next batch
  builds it without asking, in the time and size that line gives.

## Run a batch

A spec is a feature, or a feature with some of its journeys or modes. Each mode it selects becomes one task:

```bash
$R link-sharing:LS1,LS2,LS3,LS4 auth   # two tasks
$R sheet-lens pull-requests:mcp         # four tasks: sheet-lens, sheet-lens-mcp, sheet-lens-mcp-same-origin, pull-requests
$R --jobs 3 --keep issues auth create-document
$R --no-model mcp-space-files           # only the helper's journeys, no key
```

A task's id is its feature. When a spec spans modes, each mode but `default` adds `-<mode>`, and a repeat adds `-2`
and so on. The id is also the task's run id.

- The host flow in [SKILL.md](../SKILL.md) names no model. The runner does. Its image ships Claude Code pointed at
  DeepSeek's Anthropic-compatible endpoint, with every model slot on deepseek-flash at effort high, and opencode on
  `deepseek/deepseek-flash#high` (`VERIFY_UVW_OPENCODE_MODEL`) for the MCP journeys.
- The key comes from the environment or from a `DEEPSEEK_API_KEY=` line in the repository's `.env`. The
  environment wins. The key reaches each task only as a `docker exec` environment variable, never the image or a
  file.
- `--check` and every batch name where the key came from and its sha256 fingerprint (8 hex characters, never the
  key), then send one request for 1 token to the endpoint and model the image uses. A refused key, such as `401` or
  `402 Insufficient Balance`, or an endpoint that does not answer gets a `FAIL` line with the HTTP status and the
  API's message, and exit `5` before any image build or container. The batch header and `summary.md` name the key
  the same way.
- It tests your working tree as it is. Tracked changes and untracked files go into a snapshot commit that no
  ref points at, and your index, status and refs stay as they were.
- It starts up to 3 runners (`--jobs`, default the task count up to 3). Each runner installs the snapshot and
  builds the CLI, the MCP gateway and the needs of the queued tasks once, then takes tasks one at a time. For each
  task, `runner/task.sh` resets the checkout to the snapshot with `git reset --hard` and `git clean -fd`, which keep
  ignored files such as `node_modules` and build output. Then it runs `$V up --for`, `$V user` and `$V doctor` into
  the task's `prepare.log`, and loads the login page in the run's browser. Runners take turns at this prepare,
  because instances that start at once slow each other down. The prepare then writes `brief.txt`: the brief that
  `$V brief <feature> <journey-id...>` prints on the host, followed by the addendum that `addendum()` in
  `runner.mjs` wrote to the task's `addendum.txt`. The host brief says the instance is already running in the
  journeys' mode, and that the helper already ran its journeys, whose checks the session reads and judges. The
  addendum says the container is the session's, that the run stays up for the runner, which journeys only the host
  runs, and, in an MCP mode, what [the dist start mode](#the-dist-start-mode) changes. Then the task runs
  `$V run-journeys` into `run-journeys.log`, then gives a new Claude Code session `brief.txt`. When the prepare
  fails, no session starts, the task is `infra-error`, and `summary.md` quotes the `FAIL` and `verify-uvw:` lines of
  its `prepare.log`.
- A task that ends with changes in the checkout, such as a file the verifier edited, may have tested them instead of
  the snapshot. `task.sh` writes what `git status --porcelain` prints to the task's `repo-changes.txt`, and
  `result.json` and `summary.md` flag the task without a change to its status. The reset runs when the next task
  starts, so a task that crashed cannot pass on its changes either.
- `--no-model` stops each task after `run-journeys`, so it needs no key, starts no session and judges nothing.
  The helper runs only `Run: helper.` journeys, so a task that selects none of them does not run, and `summary.md`
  lists it. When that leaves no task, the batch exits `2` before it builds or starts anything, and names the
  features that have such journeys. `summary.md` counts each task's checks that held, broke, were blocked or did
  not run, and the journeys the agent drives, and lists every check that did not hold. It exits `1` when one did
  not hold, `4` when a task failed in the runner or leaked, `3` when a task is host only, else `0`.
- A task expects a verdict for each journey it selects, from the journey headings of its feature file, and for each
  earlier `Run: helper.` journey whose checks broke or were blocked when `run-journeys` ran it first. The
  features and journeys in [host-only.mjs](host-only.mjs) do not run in the runner. Those still run on the host.
  The runner lists them in `summary.md` with the `$V up --for` command for each. Each task passes its journeys to
  `up --for`, `run-journeys` and `brief` by ID, and sets `VERIFY_UVW_SKIP_JOURNEYS` to the journeys of its feature
  that host-only.mjs lists, so `run-journeys` never runs one of them, not even as an earlier journey that a later
  one needs.
- MCP features run in [the dist start mode](#the-dist-start-mode). The journeys that call `docker` or
  `agent-up`, and the whole MCP security feature, are in host-only.mjs.
- Output goes to `${VERIFY_UVW_ROOT:-/tmp/verify-uvw}/runner/<batch>/` on the host, which every runner mounts:
  `summary.md`, and for each task `prepare.log`, `addendum.txt`, `brief.txt`, `report.md` (its evidence paths
  open on the host), `transcript.jsonl`, `result.json`, `secret-check-<run>.txt`, `repo-changes.txt` when the
  checkout changed, and `runs/<run>/` with the run's `evidence`, `logs` and `run.env`.
- At the end of a task the runner folds the `evidence/journeys.jsonl` of every run under its `runs/`. `result.json`
  holds each expected journey's verdict and note, `MISSING` when it has none, and a result. The result is
  `INCOMPLETE` when any journey is `MISSING`, else `PASS` when every journey is `PASS`, else `ISSUES`. `summary.md`
  counts the verdicts per task, and its Checks column the helper's checks, and lists every journey that is not
  `PASS` with its note and its broken check. The report is prose for you, and the runner reads no verdict from it.
- Evidence never stays in a container. `task.sh` sets `VERIFY_UVW_EVIDENCE_ROOT` to the task's `runs/`, and
  `up` then makes each run's `evidence/` and `logs/` links into it, so files reach the host as they are written.
  That covers runs a recipe starts under its own `VERIFY_UVW_ROOT`, and a batch stopped by Ctrl-C or a failed
  container keeps everything written so far. `data/`, `home/` and `user.pw` stay in the container.
- Treat a report as a claim, as in
  [Hand the driving to another agent](../SKILL.md#hand-the-driving-to-another-agent). Open the evidence before you
  repeat a `PASS` or a `FAIL`.
- Exit codes are `0` when every task finished with a verdict for each expected journey, findings included, `3` when
  Docker is missing or a task is host only, `4` when a task is `INCOMPLETE`, timed out, failed in the runner or
  leaked a secret (it wins over `3`), and `5` when the key is missing or refused. A task whose session ended on an
  `API Error: …` from the endpoint failed in the runner (`infra-error`), and `summary.md` lists that error. A task
  leaks a secret when its output holds the key. Its files stay for you to delete. `summary.md` also lists every
  `secret-check` file with a `FAIL` line, without changing the status. The transcript holds recipe code with the
  same shapes, so read those lines before you share the files.
- The runner removes its containers at the end and on Ctrl-C. `--keep` leaves them for `docker exec`.

## The dist start mode

[MCP mode](../references/mcp-mode.md#start) on the host builds the MCP image and starts its roles with Docker
Compose. The runner's containers have no Docker, so the image sets `VERIFY_UVW_MCP_FROM=dist` and
`VERIFY_UVW_RUNNER=1`, and `up` refuses `dist` without the second. Never set `VERIFY_UVW_RUNNER` on the host.

- `up` starts `node dist/main.js` in `apps/mcp` once per role, as processes on loopback ports that it picks and
  saves in `run.env`. `apps/mcp/dist` must be newer than `apps/mcp/src`
  (`pnpm --filter '@univerjs/univer-workspace-mcp...' build`); `up` does not build it. The renderer uses the
  Chromium at `UNIVER_RENDER_BROWSER`. [mcp-processes.mjs](mcp-processes.mjs) holds the roles, and serves the
  compose commands verify-uvw uses.
- The roles reach the server at `127.0.0.1`, not through `host.docker.internal`, so the MCP image gotchas of
  [MCP gateway](../features/mcp.md#gotchas) do not apply.
- Each role writes `logs/mcp-<role>.log` and its process id to `mcp-<role>.pid`. `mcp-logs` shows each role's
  current process, and the file keeps earlier processes of a restarted role. `MCP_PROJECT` and `MCP_IMAGE` are
  empty.
- `doctor` prints a `skip` line for each container, image and network check, checks that the gateway's recorded
  process owns its port, and runs every functional check: staging, gateway port and Workspace reach, metrics,
  whoami, PAT exchange, executor and renderer RPC, worker environment and the log scans.
- `down` stops each role's process group and removes `staging/`.
- The benchmarks and probes of [MCP mode](../references/mcp-mode.md#benchmarks-and-probes) drive containers, so
  they need the image start mode.

The addendum tells the session these facts, and how to kill only the renderer's Chromium for
[MR9](../features/mcp-renderer.md#mr9-renderer-role): a plain `pkill chromium` also kills the run's agent-browser.

## What the runner does not prove

- The journeys in [host-only.mjs](host-only.mjs) do not run in a container. Each entry says why. Run them on the
  host.
- `dist` checks what the MCP roles do, not how they are packaged. It has no image, container, internal network or
  published port. So a runner `PASS` of [M1](../features/mcp.md#m1-environment) and
  [MR9](../features/mcp-renderer.md#mr9-renderer-role) does not cover the container shape, the image or the
  network isolation. For a change under `apps/mcp/Dockerfile`, `apps/mcp/docker/`, `apps/mcp/package.json` or
  `apps/mcp/scripts/`, run M1, MR9 and [MCP security](../features/mcp-security.md) on the host. When the tree the
  runner tests changes one of those paths since its merge base with `origin/main`, untracked files included, and a
  task is in an MCP mode, a line names the paths and the `$V up --for` command for each of those journeys. `--check`
  prints it as a `hint` line, and `summary.md`, which a batch prints at its end, has it too. It changes no exit
  code. Without a merge base, the line says that the runner skipped the comparison.

## Remove the runner

Host mode does not need the runner. `HOOKS` in [boundary.test.mjs](boundary.test.mjs) lists every file outside
`runner/` that keeps a hook for it, with the tokens each hook has, and the test fails when the files and that list
disagree. To remove the runner:

1. Delete `runner/`.
2. In each file that `HOOKS` lists, delete what its tokens find:
   - `runner/` and `the runner`: the text that names the runner, such as the opt-in paragraph of SKILL.md and the
     pointer from MCP mode.
   - `dist start mode` and `VERIFY_UVW_RUNNER`: every branch of the dist start mode and the functions only those
     branches call, and `VERIFY_UVW_MCP_FROM` with them, so MCP mode always builds and starts the image.
   - `VERIFY_UVW_EVIDENCE_ROOT`: the evidence links in `cmd_up`, and the fold across every run under the root with
     `readRuns`, which only the fold and the runner use.
   - `VERIFY_UVW_SKIP_JOURNEYS`: the journeys `run-journeys` leaves out.
3. Delete `docs/design/verify-runner/`, and the verify runner sentences in
   `docs/design/workspace-mcp/README.zh-CN.md` (the supplement to D13) and
   `docs/design/workspace-mcp/local-verification.zh-CN.md` (R1 and R5).
4. Run `node --test .agents/skills/verify-uvw/bin/*.test.mjs` and `bash -n .agents/skills/verify-uvw/bin/verify-uvw`.

Docker keeps the `uvw-verify-runner` images and the `uvw-verify-runner-pnpm-store` volume a runner built. Remove
them with `docker image rm` and `docker volume rm` to free the space.
