---
name: verify-uvw
description: Verify Univer Workspace changes end to end in a disposable local instance, covering the web app and server (apps/workspace), the uvw CLI (apps/cli), the MCP gateway, the browser Agent and real-model stories. Starts an isolated server and web app with a throwaway user, drives them with agent-browser and the source-built uvw, records evidence, and tears down without touching the developer's own instance, .data/ files or ~/.univer-workspace-cli. Use when you need to prove a Workspace, CLI or MCP change works in the real app, not just in tests.
---

# verify-uvw

Everything goes through one helper. Run it from the repository root:

```bash
V=.agents/skills/verify-uvw/bin/verify-uvw
$V up        # start server :3920 + web :5973 on a fresh temp data dir
$V user      # register a throwaway password user and sign uvw in as it
$V doctor    # is this instance ours and worth driving?
$V env       # print exports for agent-browser / uvw in the current shell
$V cli <label> <uvw args...>   # run uvw and save cmd/stdout/stderr/exit as evidence
$V uvw <uvw args...>           # run uvw without recording (exploration)
$V open-anon <label> <url>     # open a link with no cookies: screenshot, video, page text
$V secret-check [directory]    # fail when evidence holds a token or a session cookie
$V brief <feature> [journey-id...]   # print the brief for an agent that drives this run
$V runner <feature[:ID,ID]>...       # run journeys in disposable Linux containers, no instance of yours
$V down      # stop what this run started; delete data; keep evidence + logs
```

`$V` with no arguments prints every command. A run lives at `/tmp/verify-uvw/<run-id>/`
(`VERIFY_UVW_ROOT` overrides `/tmp/verify-uvw`), and `/tmp/verify-uvw/current` points at the latest:

| Path | Content | Survives `down` |
| --- | --- | --- |
| `data/` | product SQLite, collaboration SQLite, blobs | no |
| `home/` | `UNIVER_HOME` for uvw (origin config, session) and other run credentials | no |
| `user.pw` | throwaway password | no |
| `run.env`, `user.env` | ports, PIDs, launch HEAD, mode flags, username | yes |
| `logs/` | `server.log`, `web.log`, `register.json` | yes |
| `evidence/` | screenshots and `cli` transcripts | yes |

The journeys live in [`features/`](features/README.md). Read its index, then use the matching
feature file as the recipe. Read more only for the mode you need:

| Mode | Read |
| --- | --- |
| MCP gateway, renderer, Workspace Agent (`VERIFY_UVW_MCP=1`, `agent-up`) | [references/mcp-mode.md](references/mcp-mode.md) |
| Agent principals and real-model stories (`principal`, `story`) | [references/stories.md](references/stories.md) |
| Browser Agent mock model | `node .agents/skills/verify-uvw/bin/mock-provider.mjs --help`, then AS1 in [Browser Agent skills](features/agent-skills.md) |
| HTML View style thumbnails, after changing a built-in template | `node .agents/skills/verify-uvw/bin/html-view-style-thumbnails.mjs --help` |

## Launch

`up` and `doctor` check the prerequisites and print the fix for each. `node_modules` must match
`pnpm-lock.yaml` (`pnpm install --frozen-lockfile`), and `apps/cli/dist` and
`packages/client-core/dist` must be newer than their `src` (`pnpm --filter 'univer-workspace-cli...' build`).
`up` refuses ports that are already in use, and never touches your dev servers on 3020/5173.

`up` starts the server under `env -i` with its data in `data/`, so `apps/workspace/.env` and your
shell's OAuth variables stay out and password sign-in is the only user sign-in method. It points the
run's uvw at the web origin. It returns once `/api/session` answers on both ports, usually in under 10 s. On failure it tails the log; run `down`
before you retry. `user` registers `verify-<run-id>` (display name `Verify <run-id>`), who owns the
Personal Space `verify-<run-id>/personal`. Running it again only signs uvw in again.

The server does not reload. After you change server or CLI code, rebuild the CLI if needed, then run
`down`, `up` and `user`. Web code under `apps/workspace/web` hot-reloads through Vite.

`$V metrics` prints the server's Prometheus text. Vite serves `/nodes/<id>` itself, so share pages and
link previews come from the server only after `pnpm --filter '@univerjs/univer-workspace^...' build`
and `pnpm --filter @univerjs/univer-workspace build:web` before `up`. Open those links on the server port.

## Doctor

Run `$V doctor` first, and again whenever anything looks off. It exits non-zero when any line says
`FAIL`. If `HEAD` moved since launch, the server runs old code.

## Drive

**Browser (agent-browser).** `$V env` exports `AGENT_BROWSER_SESSION=verify-uvw-<run-id>`, so this run
gets its own headless browser. Each Bash tool call is a new shell, so start every call that uses
agent-browser or uvw with `eval "$($V env)"`. It also sets `$ORIGIN`, `$EVIDENCE` and `$RUN`, the run
directory. Always use
`127.0.0.1`, never `localhost` or another host, because the bundled Univer license is bound to the
domain and editors degrade elsewhere.

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

- After `open`, wait before `find` (`wait 1500`, `wait --url` or `wait <selector>`). An immediate `find`
  races the app and reports "No element found".
- Prefer `find role <role> --name "<accessible name>"` and `find label`. The names come from
  `web/src/shared/i18n.tsx`, and the locale pin above keeps them English. The login form's tabs are
  `Password` and `Create account`, and so is the sign-up submit button, so submit with
  `click 'form button[type=submit]'`.
- Univer grids are canvas. Type into the selected cell with `keyboard type` and `press Tab|Enter`, then
  read the result back through uvw or a screenshot, not the DOM. Worksheet selectors are 1-based
  (`--worksheet index:1`).
- After sign-in, a browser that has not chosen a view shows only `Choose your workspace view` at `/home`.
  Click `Enter workspace`, or set `univer-workspace-view-onboarding-complete` to `true` before you sign in.
  The view is the per-browser `localStorage` value `univer-workspace-layout-theme` (`repository` or
  `wiki`). Each journey states the view it expects and pins it first.

**CLI (uvw).** `$V uvw` and `$V cli` run `apps/cli/dist/main.js` with the run's `UNIVER_HOME`, and
refuse when it does not resolve this run's origin. Never call a global `uvw`: it targets
`~/.univer-workspace-cli` and `https://space.univer.ai/`. Use `--json` and IDs returned by earlier
commands.

```bash
$V cli pr-create pr create -R verify-<run-id>/personal -t "Title" --json
```

## Evidence

Everything goes in `$EVIDENCE` (`/tmp/verify-uvw/<run-id>/evidence/`), which survives `down`:

- CLI proof: `$V cli <label> …` writes `<label>.cmd`, `.out`, `.err`, `.exit`.
- UI proof: a screenshot after the action, plus a reload or a second route showing the persisted state.
  Name files `<feature>-<step>.png`.
- A mutation needs a second, read-only view. Examples: a browser edit read back with
  `uvw inspect --trunk`, or a uvw write seen in the browser after reload. A success toast or exit code 0
  alone proves nothing.
- Anonymous access: `open-anon` uses its own cookie-less session, waits 8 seconds, and saves
  `<label>.png`, `.webm`, `.mp4` (with `ffmpeg`) and `.page.txt`. For `/nodes/<id>` it also saves
  `<label>.node-status`, the status of `GET /api/nodes/<id>` without credentials.
- Drive the real user path: browser controls or uvw commands against the HTTP API. Do not insert SQLite
  rows, call internal services, or use test-only endpoints. Registration in `$V user` is setup, not
  proof of the auth feature. The [auth journey](features/auth.md) proves that.
- Nothing is mocked except the browser Agent's model provider in the Agent journeys. Collaboration,
  Office exchange, and the CLI daemon are all real. External OAuth providers (GitHub, Google, Discord)
  need a real provider, so report them as skipped. MA8 in [PAT sign-in](features/mcp-auth.md#ma8-existing-sign-in-clients-host-only) drives
  browser-approved `uvw auth login`.
- Report an unreachable entry point with the command you tried and the unmet precondition. Do not
  report it as verified through a different path.
- `open-anon`, `mcp`, `mcp-oauth` and `story` redact what they write, and `cli` does not. Run
  `secret-check` before you quote or copy evidence, and before `down`. After `down` it can only
  match token shapes, because the run's secret values are gone.
- In the report, give the run id, launch HEAD (`run.env`), feature IDs, and artifact paths.

## Hand the driving to another agent

Following a journey in `features/` does not need your strongest model. When your harness can start a
subagent, give it the journey and keep your own turns for choosing what to verify and for judging the result.

1. Start the instance yourself with `$V up`, `$V user` and `$V doctor`.
2. Run `$V brief <feature> [journey-id...]`, for example `$V brief link-sharing LS1 LS2 LS3`, and give
   the subagent that text unchanged, with no hint about the change under review.
3. Treat the report as a claim. Before you repeat a `PASS` or a `FAIL`, open the evidence files it names.
   You decide whether a difference from the recipe is a defect.
4. Stop the instance yourself with `$V down`.

Drive it yourself when no journey covers the behavior, because a subagent follows a recipe and does not
design checks. When the runner can run the feature, prefer [the runner](#run-journeys-in-the-runner): it
needs no instance of yours and gives every developer the same Linux machine. Otherwise this section applies,
and it names no model, harness or host for the verifier. The developer chooses the model in their own
configuration, outside this repository, and the harness default applies otherwise. The subagent runs where
`up` ran, because the instance listens only on `127.0.0.1`. On the host, MCP mode and `uvw` stories need
macOS.

## Run journeys in the runner

`$V runner` gives each task to Claude Code in a disposable Linux container. A task is a feature, or a
feature with some of its journeys:

```bash
$V runner link-sharing:LS1,LS2,LS3,LS4 auth   # two tasks
$V runner --jobs 3 --keep issues auth create-document
```

- The runner image is the one exception to "names no model". It ships Claude Code pointed at DeepSeek's
  Anthropic-compatible endpoint, with every model slot on deepseek-flash at effort high, and opencode on
  `deepseek/deepseek-flash#high` (`VERIFY_UVW_OPENCODE_MODEL`) for the MCP journeys.
- It needs Docker and `DEEPSEEK_API_KEY`, from the environment or from a `DEEPSEEK_API_KEY=` line in the
  repository's `.env`. The key reaches each task only as a `docker exec` environment variable, never the image
  or a file.
- It tests your working tree as it is. Tracked changes and untracked files go into a snapshot commit that no
  ref points at, and your index, status and refs stay as they were.
- It starts up to 3 runners (`--jobs`, default the task count up to 3). Each runner installs the snapshot and
  builds the CLI and the MCP gateway once, then takes tasks one at a time. Every task gets a new Claude Code session, which starts its
  own instance from the brief that `$V brief --own <run-id> <feature> [journey-id...]` prints.
- A feature or journey marked `(host only)` under [the feature contract](features/README.md#feature-entry-contract)
  does not run here. The runner lists it in `summary.md` for a host run.
- MCP features run here in the `dist` start mode of [MCP mode](references/mcp-mode.md#start), which starts the
  gateway, executor and renderer as local processes. The image sets `VERIFY_UVW_MCP_FROM=dist` and
  `VERIFY_UVW_RUNNER=1`, which `up` requires for that mode. Never set `VERIFY_UVW_RUNNER` on the host. The
  journeys that call `docker` or `agent-up`, and the whole MCP security feature, are marked `(host only)`.
- Output goes to `${VERIFY_UVW_ROOT:-/tmp/verify-uvw}/runner/<batch>/`: `summary.md`, and for each task
  `report.md` (its evidence paths open on the host), `transcript.jsonl`, `result.json`,
  `secret-check-<run>.txt` and `runs/<run>/` with the run's `evidence`, `logs` and `run.env`.
- Treat a report as a claim, as in the previous section. Open the evidence before you repeat a `PASS` or a
  `FAIL`.
- Exit codes: `0` when every task reported, `3` when Docker is missing or a task is host only, `4` when a
  task has no report, timed out, failed in the runner or leaked a secret (it wins over `3`), and `5` with no
  key. A task leaks a secret when its output holds the key. Its files stay for you to delete. `summary.md`
  also lists every `secret-check` file with a `FAIL` line, without changing the status. The transcript
  holds recipe code with the same shapes, so read those lines before you share the files.
- The runner removes its containers at the end and on Ctrl-C. `--keep` leaves them for `docker exec`.

## Cleanup

`$V down` closes the run's browser session and uvw daemons, stops only the server and Vite PIDs it
recorded, and deletes `data/`, `home/` and `user.pw`. Run it after every failed attempt too. Never kill
by process name or port, and never touch `apps/workspace/.data/`. Delete an old run's evidence with
`rm -rf /tmp/verify-uvw/<run-id>` only when you no longer need the proof.

## Parallel runs

One run per port pair. A second concurrent run needs its own ports and an explicit id in **every**
call, because `current` follows the newest `up`:

```bash
VERIFY_UVW_RUN=b VERIFY_UVW_SERVER_PORT=3921 VERIFY_UVW_WEB_PORT=5974 VERIFY_UVW_MCP_PORT=3931 $V up
VERIFY_UVW_RUN=b $V doctor
```
