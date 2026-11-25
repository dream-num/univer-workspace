---
name: verify-uvw
description: Verify Univer Workspace changes end to end in a disposable local instance, covering the web app and server (apps/workspace), the uvw CLI (apps/cli), the MCP gateway, the browser Agent and real-model stories. Starts an isolated server and web app with a throwaway user, drives them with agent-browser and the source-built uvw, records evidence, and tears down without touching the developer's own instance, .data/ files or ~/.univer-workspace-cli. Use when you need to prove a Workspace, CLI or MCP change works in the real app, not just in tests.
---

# verify-uvw

Everything goes through one helper. Run it from the repository root:

```bash
V=.agents/skills/verify-uvw/bin/verify-uvw
$V up --for <feature> [journey-id|mode...]   # start server :3920 + web :5973 on a fresh temp data dir, in the journeys' mode
$V up        # the same in the default mode, for behavior no journey covers
$V user      # register a throwaway password user and sign uvw in as it
$V doctor    # is this instance ours and worth driving?
$V env       # print exports for agent-browser / uvw in the current shell
$V cli <label> <uvw args...>   # run uvw and save cmd/stdout/stderr/exit as evidence
$V uvw <uvw args...>           # run uvw without recording (exploration)
$V open-anon <label> <url>     # open a link with no cookies: screenshot, video, page text
$V secret-check [directory]    # fail when evidence holds a token or a session cookie
$V journeys <feature> [journey-id|mode...]   # the journeys to verify, by mode; after up, which have a verdict
$V verdict <journey-id> PASS|FAIL|DRIFT|BLOCKED [note]   # record one journey's verdict in this run
$V run-journeys [--again] <feature> [journey-id|mode...]   # run the blocks of "Run: helper." journeys as written; record their checks
$V brief <feature> [journey-id|mode...]   # print the brief for an agent that drives this run
$V down      # stop what this run started; delete data; keep evidence + logs
```

`$V` with no arguments prints every command. A run lives at `/tmp/verify-uvw/<run-id>/`
(`VERIFY_UVW_ROOT` overrides `/tmp/verify-uvw`), and `/tmp/verify-uvw/current` points at the latest:

| Path | Content | Survives `down` |
| --- | --- | --- |
| `data/` | product SQLite, collaboration SQLite, blobs | no |
| `home/` | `UNIVER_HOME` for uvw (origin config, session) and other run credentials | no |
| `user.pw` | throwaway password | no |
| `journeys/` | what `run-journeys` carries between journeys: its scripts and the recipe's variables | no |
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

The verify runner is opt-in. It runs journeys in disposable Linux containers and sends their material to an
outside model API. Use it only when the user asks for it, as in `/verify-uvw mode:runner check issues`, or when
their own configuration outside this repository says so. Read [runner/README.md](runner/README.md) first.

## Launch

A journey declares the mode of the instance it runs on: `default`, `mcp` with the MCP gateway, or
`mcp-same-origin` with the gateway also at the web origin ([the feature contract](features/README.md#feature-entry-contract)).
`$V journeys <feature>` lists a feature's journeys by mode, each mode with the command that starts its instance,
such as `$V up --for sheet-lens mcp`. `up --for <feature> [journey-id|mode...]` sets the mode flags of
[MCP mode](references/mcp-mode.md#start) from what those journeys declare, overriding your shell's, and refuses
journeys that span modes. One instance runs one mode, so verify such a feature in one instance per mode. Plain `up`
starts the default mode, or the mode your flags choose.

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
A journey that needs them declares `Needs: web-build.`, and `up --for` refuses it until that build is newer
than `apps/workspace/web`.

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
  need a real provider, so report them as skipped. MA8 in [PAT sign-in](features/mcp-auth.md#ma8-existing-sign-in-clients) drives
  browser-approved `uvw auth login`.
- Report an unreachable entry point with the command you tried and the unmet precondition. Do not
  report it as verified through a different path.
- `open-anon`, `mcp`, `mcp-oauth` and `story` redact what they write, and `cli` does not. Run
  `secret-check` before you quote or copy evidence, and before `down`. After `down` it can only
  match token shapes, because the run's secret values are gone.
- In the report, give the run id, launch HEAD (`run.env`), feature IDs, and artifact paths.

Every journey you run gets one verdict, recorded with `$V verdict <journey-id> <verdict> "<note>"` as soon as you
judge it. The run's `evidence/journeys.jsonl` keeps every verdict, and the last one for a journey counts.

| Verdict | When |
| --- | --- |
| `PASS` | Every step ran and every check held. |
| `FAIL` | The product differs from the recipe. |
| `DRIFT` | The recipe is wrong, such as a stale count or a renamed label. Quote the recipe and say what the product does. |
| `BLOCKED` | The journey could not run, or ran only in part. Say why. |

Every verdict but `PASS` needs a note with the values you read and the evidence files. A journey marked
`Run: helper.` ([the feature contract](features/README.md#feature-entry-contract)) is not retyped: `$V run-journeys
<feature> [journey-id...]` runs its blocks as written and records its checks, and you judge the rest of its text.
`verdict` refuses `PASS` for such a journey until its checks ran and held. When a check broke, record `FAIL`
when the product is wrong, `DRIFT` when the recipe is, or `BLOCKED`. Before you report, run
`$V journeys <feature> [journey-id...]`. It lists each journey with its verdict, or `MISSING`, and ends with
`RESULT: PASS`, `ISSUES` or `INCOMPLETE`, after `CHECKS: HELD` or `BROKE` when the helper ran some of them.
`INCOMPLETE` means a journey has no verdict, and the command exits `1`.

## Hand the driving to another agent

Following a journey in `features/` does not need your strongest model. When your harness can start a
subagent, give it the journey and keep your own turns for choosing what to verify and for judging the result.

1. Run `$V journeys <feature>` to see the journeys by mode. Take one mode, or some journeys of one mode, at a time.
2. Start the instance yourself with `$V up --for <feature> [journey-id|mode...]`, `$V user` and `$V doctor`. When
   some of the journeys are `Run: helper.`, run `$V run-journeys` with the same selection. It needs no model.
3. Run `$V brief <feature> [journey-id|mode...]` with the same selection, for example `$V brief link-sharing LS1 LS2 LS3`.
   It refuses a run whose mode differs from the journeys'. The brief lists the journey IDs that each need a verdict.
   Give the subagent that text unchanged, with no hint about the change under review.
4. Run `$V journeys <feature> [journey-id|mode...]` with the same selection. Until it no longer says `INCOMPLETE`,
   some journey is unverified, whatever the report says. Treat the verdicts and the report as claims. Before you
   repeat a `PASS`, `FAIL` or `DRIFT`, open the evidence files it names. You decide whether a difference from the
   recipe is a defect.
5. Stop the instance yourself with `$V down`, then repeat from step 2 for the feature's next mode.

Drive it yourself when no journey covers the behavior, because a subagent follows a recipe and does not
design checks. This section names no model, harness or host for the verifier. The developer chooses the model in their own
configuration, outside this repository, and the harness default applies otherwise. The subagent runs where
`up` ran, because the instance listens only on `127.0.0.1`. On the host, MCP mode and `uvw` stories need
macOS.

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
