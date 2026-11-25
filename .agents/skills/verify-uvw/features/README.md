# Univer Workspace verification map

This directory is the maintained source for verifying user-facing Workspace and uvw
behavior. Read this index before you drive anything, then use the matching feature file
as the recipe.

## Baseline preconditions

- `V=.agents/skills/verify-uvw/bin/verify-uvw` from the repository root.
- `$V up --for <feature> [journey-id|mode...]`, `$V user`, and a `$V doctor` with no `FAIL` lines. The run serves
  web at `http://127.0.0.1:5973` and the server at `:3920`, from a fresh `data/` directory, in the mode its
  journeys declare.
- The baseline user is `verify-<run-id>`, display name `Verify <run-id>`. Its password is
  in `/tmp/verify-uvw/<run-id>/user.pw`, and it owns `verify-<run-id>/personal` with no
  files. No Team Spaces, PRs or Issues exist. In MCP mode, `doctor` adds an `Executor doctor`
  pull request and a `Doctor` Sheet there.
- Never drive an instance this run did not start.
- Drive and record proof as the Drive and Evidence sections of [the skill](../SKILL.md#drive) say.

## Feature entry contract

Each feature file starts with an H1 and one paragraph of user-visible behavior, then exactly
four H2s in order: `Sub-features`, `How to get to it (user POV)`,
`Driving it with agent-browser and uvw`, `Gotchas`.

Under `Driving it with agent-browser and uvw`, every `###` heading is a journey:
`### <ID>. <Title>`. The ID is a capital letter, then capital letters and digits, and ends in a number,
as in `MS5`, `SLC10` or `TR2-1`. No two journeys in `features/` share an ID. Text before the first
journey is setup for all of them. A journey's text ends in its pass condition. A verifier records one
verdict for each journey it runs (the Evidence section of [the skill](../SKILL.md#evidence)).
`bin/journeys.mjs` is the only reader of this structure, and its test parses every file here.

A journey runs on an instance in one mode: `default`, `mcp` with the MCP gateway, or `mcp-same-origin` with the
gateway also at the web origin. It can also need something built before `up`: `web-build` is the server's own
web build, for link previews. A recipe declares both in a one-line paragraph, such as `Mode: mcp.` or
`Mode: mcp-same-origin. Needs: web-build.`. As the first paragraph under `Driving it with agent-browser and uvw`,
the line covers every journey of the feature. As the first paragraph under a journey heading, it covers that
journey: its mode replaces the feature's, and its needs add to them. A journey with no mode is `default`. A
`Mode:`, `Needs:` or `Run:` line anywhere else, or an unknown value, fails the parser test. `$V up --for` starts the
instance and checks the needs, so a recipe never starts, stops or restarts the instance for its mode. Only a
journey that needs another instance shape, such as production MCP or a restart with other server settings, does
that in its own text.

A journey's own line can also say that the helper runs it: `Run: helper.`, after its mode and needs. `Run:` has no
other value and no feature scope, because a wrong runner fails silently: the helper would run only the blocks of a
journey whose real check is in a browser or a model's reply. The parser test fails on `Run: agent.` and on a `Run:`
line under `Driving it with agent-browser and uvw`, so every journey without the line, including one added to a
feature later, is an `agent` journey: a verifier follows its text. `$V run-journeys <feature>` runs the `bash`
blocks of `helper` journeys itself, exactly as written, and records their checks in the run's journal.
Mark a journey `helper` only when its blocks hold every step a machine can check. Its text then keeps only what
needs eyes or judgment, such as "open the PNG and look". A step that is only in prose, such as killing a process,
keeps the journey `agent`. The helper runs blocks this way:

- Each journey runs in its own `bash`, from the repository root, after `eval "$($V env)"`, with stdin closed and
  without errexit or pipefail. Setup runs first, and a broken setup blocks every journey.
- A command that fails outside a condition (`if`, `while`, `&&`, `||`) is a broken check, unless the next command
  reads `$?`. So a command that must fail is followed by `test $? -eq 1`. A failure inside a function or a loop
  counts, and in a pipeline only the last command's does.
- `!`, `[[ ]]`, `(( ))` and `( )` fail the parser test in a `helper` journey, because bash does not trap their
  failure everywhere. Write `command; test $? -eq 1`, `test` and `{ ...; }`.
- Variables and functions carry from setup and earlier `helper` journeys of the same mode, so running one journey
  first runs those that have not run. When one of those breaks or is blocked, the last line of `run-journeys` names
  it, and `$V journeys` asks a verdict for it. A `helper` journey never needs an `agent` journey's state.
- Each journey's output goes to `evidence/<ID>.run.log`, and each broken check records its markdown line, exit
  code and the redacted end of that output. A journey stops after 600 s.

## Agent Mode

Agent Mode keeps people out of an agent's task between the grant at the start and the merge at the end. Its journeys
are in the `agent-mode-*` files and in parts of `pull-requests`, `agent-handoff`, `mcp-blobs-office` and
`mcp-html-view`. [references/agent-mode.md](../references/agent-mode.md) maps the spec to them, says how to run all of
them, and lists what no journey covers yet.

## Features

- [Browser Agent trajectory](./agent-trajectory.md): TR2-1 through TR2-10 cover Debug mode, recorded
  requests, timing, tool results, search, and rewritten history.
- [Browser Agent skills](./agent-skills.md): AS1-AS23 cover the mock provider, catalog
  reminders, rail, slash menus in both composers, invocation gates, stable request prefixes,
  Skill draft review, publication and rejection, the built-in skill-creator, and one pull request per
  Auto session.
- [Accounts and sign-in](./auth.md): browser registration and its validation, browser password sign-in
  and sign-out, uvw password login, status and logout.
- [Create and edit a document](./create-document.md): New menu in the browser, Spreadsheet
  editing, persistence after reload, trunk readback via uvw.
- [Pull requests (Worktrees)](./pull-requests.md): uvw PR create, unit create, execute,
  ready, and merge, then the merged file seen from uvw and the browser; in a Team Space, a member with
  read access proposes through uvw and MCP and an Editor merges. PR11 shows a former member nothing about where the
  files they cannot open went.
- [Page theme: Wiki and Repository modes](./page-theme-wiki-repository.md): Application settings
  entry in each mode, theme persistence, and the Repository directory, pull request, issue,
  recent and pages views.
- [Issues](./issues.md): Team Space repo creation, Issue open via uvw, comment and close
  in the browser, timeline readback via uvw.
- [MCP gateway](./mcp.md): M1-M12 start the MCP gateway and cover both protocols, identity, repository
  parity, tool lists, credential, Origin and production refusals, opencode, and cleanup. Every other `mcp-*`
  file runs in this MCP mode.
- [Issues and pull requests over MCP](./mcp-issues-prs.md): MI1-MI11 and MP1-MP10 compare the Issue, pull
  request, search and browse tools with uvw, including idempotency keys and preserved errors.
- [Agent Mode: an Issue as an agent's task](./agent-mode-tasks.md): MP11 lists reviewable pull requests, and MP12 has
  two agents find their own work with prompts that carry no task. MP13 links a fork's pull request to an Issue and
  checks both sides in MCP, uvw and the browser. MI12 submits an Issue over MCP, sends it back and accepts it in the
  browser. MI15 turns on an acceptance deadline and has the server accept a submitted Issue by deadline, attributed to
  no one, with a reopen restarting the clock.
- [Agent Mode: judge and undo an agent's task](./agent-mode-acceptance.md): MI13 judges four merged pull requests, one
  of which deletes a file, in the Issue's acceptance panel and shows the assignee's Personal Space sharing to its
  claimer and not to a member who may not accept. MI14 shows each linked pull request's check results there as they
  stood at merge, counting or not, and says on an open pull request when the repository declares none. MI17 shows
  that sharing to an acceptor who did not claim the agent by name only. MI16 reverts an Issue's merged pull requests from its acceptance panel, keeps every pull
  request's files in the panel with the file the revert moved to Trash noted and its checks as they stood at merge,
  leaves a file someone edited after the merge blocked until a person overwrites it, and has an agent revert with
  `pr_revert`.
- [Agent Mode: declared checks and the landing guard](./agent-mode-checks.md): MP15 reports check results declared in
  `.agents/checks.md` and shows them, out of date after a Trunk edit, in the browser. MP17 requires checks before an
  agent merges: a claimed agent's merge is refused with the check names over MCP, uvw and the browser, its browser
  opens Trunk read-only, its direct changes to `.agents/checks.md` are refused, a pull request of its that changes
  `.agents/` is refused and a person merges it, and a person is not gated. MP18 has an agent declare checks in its own
  repository on the default connection, gate its Editor agent's merge on them, and refuse that agent's Trunk writes.
- [Agent Mode: files that move to Trash around a pull request](./agent-mode-trash.md): MP16 reads a merged pull
  request that deleted a file over uvw and MCP, and answers 409 to every comparison of a file moved to Trash under an
  open pull request. MP19 moves a file of an agent's ready pull request to Trash: every reader still reviews the other
  file, the merge is refused with `FILES_IN_TRASH`, and the agent leaves the file out with `pr_edit` and merges.
- [Agent Mode: an agent's limits](./agent-mode-limits.md): MP14 drives an agent to its budget of open pull requests
  and counts a merge in `whoami`.
- [Agent Mode: forks](./agent-mode-forks.md): FK1-FK8 have a claimed Viewer agent fork a repository that copies
  nothing, read Trunk through it, open one pull request with its first writes, also two at once, reopen a ready one to
  write again, delete a fork and lose its membership; FK8 drives `uvw fork create`, `list`, `view` and `delete`.
- [Space files, repositories and resources over MCP](./mcp-space-files.md): MS1-MS11 cover browse, find,
  repositories, labels, Units, Nodes, merge and discard; MC1-MC4 cover SVG resources.
- [Files, Office and Markdown exchange over MCP](./mcp-blobs-office.md): MF1-MF9 cover upload capabilities,
  Blobs and Assets; MF10-MF11 replacing files through a fork; MX7-MX10 Office round trips and import retries;
  MM1-MM2 Markdown.
- [Skills and the Facade API reference over MCP](./mcp-skills-api.md): MR1-MR8 cover Skills, resources,
  instructions and API paging; MR13-MR15 custom Skills, drafts and pinned imports.
- [MCP sign-in with personal access tokens](./mcp-auth.md): MA1-MA8 cover PAT scopes, revocation, metadata,
  Browser management, and Browser, uvw and Workspace Agent sign-in with MCP OAuth enabled.
- [MCP sign-in with OAuth](./mcp-oauth.md): MO1-MO4 cover opencode browser sign-in, scripted OAuth, Claude Code
  and VS Code CIMD with SSRF refusals and the off switch, and Cursor's private-use callback.
- [Scripts and compilers over MCP](./mcp-executor.md): MX1-MX6 and MX11-MX16 cover `execute` and `inspect`,
  errors, stale sessions and concurrency; MT1, MV1 and Typst jobs cover the compilers.
- [Screenshots, PDF and lint over MCP](./mcp-renderer.md): MR9-MR12 and MV2 cover the renderer role,
  `screenshot`, `print_pdf`, `lint`, opencode reading an image, and real-font SVG.
- [HTML View drafts over MCP](./mcp-html-view.md): MHV1-MHV10 cover validation parity, missing sources, draft
  save, retry and revision, then preview and publish, a reviewer's page list, isolated preview and the
  ready freeze, and pages published by the merge: a Viewer's page through a browser merge after a refused CLI
  merge, a conflicted page, and an Editor agent's own page merged over MCP. MHV16 refuses a browser merge of pages
  the author changed after the review, then merges them once reviewed again. MHV11-MHV15 change pages through a
  fork: a Viewer agent's and a non-member agent's proposals, a page-only pull request, the conflicted variant,
  uvw validation and its create refusal, and a real-model story.
- [MCP production shape and per-account tools](./mcp-production.md): MB1-MB6 cover tool lists without a
  renderer, the executor allowlist with `*` and `workspace`, and `/readyz`.
- [Read Sheet Units](./sheet-lens.md): SLC1-SLC10 cover `uvw outline`, `read` and `find` on the
  seeded sales, ledger and Doc Units: zoom, continuations, typed JSON, large-sheet notes,
  revisions, errors, trunk reads and access. SLM1-SLM10 cover the MCP tools.
- [MCP executor and renderer isolation](./mcp-security.md): stage G sandbox baseline, MG1-MG11
  checks of secret hygiene, network, cross-user visibility, resource limits, mounts, fail-closed
  configuration and renderer separation, each reported `contained` or `exposed`.
- [Link sharing](./link-sharing.md): LS1-LS4 cover `uvw share`, the browser Share dialog, and what an
  anonymous visitor sees with the link set to `viewer` or `off`. LS5-LS7 cover Remix, link preview tags
  and public Spaces.
- [HTML View](./html-view.md): HV1-HV7 cover publishing with uvw, the `Pages` tab, owner writes to the source
  Sheet, live Sheet updates, read-only visitors, trial mode and `Save my version`.
- [Agent handoff and claim](./agent-handoff.md): AH1-AH10 cover `Hand to my agent`, guest agents over
  uvw and MCP, claim links and the claim page, `My agents`, and the claimer's pull request decisions. MH1-MH5
  cover agent principals over MCP: tool lists before and after a claim, public-Space refusals and copies.

## Helper scripts

- [seed-sheets.mjs](../bin/seed-sheets.mjs) creates sales and elements workbooks,
  30,000-row and 50,000-row ledgers, and a Doc in the run user's personal repository.
  Run `eval "$($V env)"` then `node .agents/skills/verify-uvw/bin/seed-sheets.mjs`.
  Requires `python3` with `openpyxl`. Each invocation creates a new draft Worktree and
  new Units. The last stdout line is JSON with `sales`, `elements`, `ledger30k`,
  `ledger50k`, `doc` Unit IDs, their `worktree` scope, `space`, and `repo`.
  Read them with `--worktree <worktree> --unit <id>`.
