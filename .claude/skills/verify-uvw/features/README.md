# Univer Workspace verification map

This directory is the maintained source for verifying user-facing Workspace and uvw
behavior. Read this index before you drive anything, then use the matching feature file
as the recipe.

## Baseline preconditions

- `V=.claude/skills/verify-uvw/bin/verify-uvw` from the repository root.
- `$V up`, `$V user`, and a `$V doctor` with no `FAIL` lines. The run serves web at
  `http://127.0.0.1:5973` and the server at `:3920`, from a fresh `data/` directory.
- The baseline user is `verify-<run-id>`, display name `Verify <run-id>`. Its password is
  in `/tmp/verify-uvw/<run-id>/user.pw`, and it owns `verify-<run-id>/personal` with no
  files. No Team Spaces, PRs or Issues exist.
- Never drive an instance this run did not start.

## Driving conventions

- Start each Bash call with `eval "$($V env)"`. Browser commands then use this run's
  agent-browser session, and `$ORIGIN` / `$EVIDENCE` are set.
- Pin the browser locale once per session:
  `agent-browser storage local set univer-workspace-language en-US` then `agent-browser reload`.
- After `agent-browser open`, wait before `find` (`agent-browser wait 1500`, or
  `wait --url`/`wait <selector>`). An immediate `find` races the SPA and reports "No element found".
- Prefer ARIA roles, accessible names, and labels. The login form has two buttons
  named `Create account` and two named `Sign in` (mode tab and submit), so submit with
  `agent-browser click 'form button[type=submit]'`.
- Run uvw only through `$V cli <label> …` (recorded) or `$V uvw …`. Use IDs from earlier
  `--json` output.
- Worksheet selectors are 1-based (`--worksheet index:1`).

## Proof and skip reporting

- Capture the action and the resulting state: screenshot and/or `cli` transcript.
- A mutation needs a read-only second view from the other surface or after a reload.
- Record the feature ID and entry point with every artifact name.
- An unreachable entry point is reported with the command tried and the unmet
  precondition. Do not report it as verified through a different path.
- OAuth sign-in (GitHub, Google, Discord) and browser-approved `uvw auth login` need a real
  provider or a human. They are out of scope; report them as skipped.

## Feature entry contract

Each feature file starts with an H1 and one paragraph of user-visible behavior, then exactly
four H2s in order: `Sub-features`, `How to get to it (user POV)`,
`Driving it with agent-browser and uvw`, `Gotchas`.

## Features

- [Accounts and sign-in](./auth.md): browser registration, browser password sign-in,
  uvw password login and status.
- [Create and edit a document](./create-document.md): New menu in the browser, Spreadsheet
  editing, persistence after reload, trunk readback via uvw.
- [Pull requests (Worktrees)](./pull-requests.md): uvw PR create, unit create, execute,
  ready, and merge, then the merged file seen from uvw and the browser.
- [Issues](./issues.md): Team Space repo creation, Issue open via uvw, comment and close
  in the browser, timeline readback via uvw.
