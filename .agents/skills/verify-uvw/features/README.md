# Univer Workspace verification map

This directory is the maintained source for verifying user-facing Workspace and uvw
behavior. Read this index before you drive anything, then use the matching feature file
as the recipe.

## Baseline preconditions

- `V=.agents/skills/verify-uvw/bin/verify-uvw` from the repository root.
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
- Prefer ARIA roles, accessible names, and labels. The login form's mode tabs are `Password` and
  `Create account`, and in sign-up mode the submit button is also `Create account`, so submit with
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
- Page theme is a per-browser `localStorage` value. Each journey states the mode it expects.
  A fresh session starts in Repository. Journeys that drive the Wiki sidebar pin Wiki first with
  `agent-browser storage local set univer-workspace-layout-theme wiki`.
- OAuth sign-in (GitHub, Google, Discord) and browser-approved `uvw auth login` need a real
  provider or a human. They are out of scope; report them as skipped.

## Feature entry contract

Each feature file starts with an H1 and one paragraph of user-visible behavior, then exactly
four H2s in order: `Sub-features`, `How to get to it (user POV)`,
`Driving it with agent-browser and uvw`, `Gotchas`.

## Features

- [Browser Agent skills](./agent-skills.md): AS1-AS15 cover the mock provider, catalog
  reminders, rail, slash menus in both composers, invocation gates, and stable request prefixes.
- [Accounts and sign-in](./auth.md): browser registration, browser password sign-in,
  uvw password login and status.
- [Create and edit a document](./create-document.md): New menu in the browser, Spreadsheet
  editing, persistence after reload, trunk readback via uvw.
- [Pull requests (Worktrees)](./pull-requests.md): uvw PR create, unit create, execute,
  ready, and merge, then the merged file seen from uvw and the browser.
- [Page theme: Wiki and Repository modes](./page-theme-wiki-repository.md): Application settings
  entry in each mode, theme persistence, and the Repository directory, pull request, issue,
  recent and pages views.
- [Issues](./issues.md): Team Space repo creation, Issue open via uvw, comment and close
  in the browser, timeline readback via uvw.
- [MCP gateway](./mcp.md): Docker Desktop opt-in, both protocols, repository parity,
  MO3 Claude Code/VS Code CIMD, SSRF refusals, anonymous no-fetch and the CIMD off switch,
  authentication, idempotency keys and `inspect` input errors, the executor, files, Office, renderer and
  compilers, the G0 production shape with the `*` allowlist, usage evidence, opencode, and cleanup.
- [MCP executor and renderer isolation](./mcp-security.md): stage G sandbox baseline, MG1-MG11
  checks of secret hygiene, network, cross-user visibility, resource limits, mounts, fail-closed
  configuration and renderer separation, each reported `contained` or `exposed`.
