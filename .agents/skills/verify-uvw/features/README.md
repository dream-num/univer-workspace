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
  files. No Team Spaces, PRs or Issues exist. In MCP mode, `doctor` adds an `Executor doctor`
  pull request and a `Doctor` Sheet there.
- Never drive an instance this run did not start.
- Drive and record proof as the Drive and Evidence sections of [the skill](../SKILL.md#drive) say.

## Feature entry contract

Each feature file starts with an H1 and one paragraph of user-visible behavior, then exactly
four H2s in order: `Sub-features`, `How to get to it (user POV)`,
`Driving it with agent-browser and uvw`, `Gotchas`.

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
  read access proposes through uvw and MCP and an Editor merges.
- [Page theme: Wiki and Repository modes](./page-theme-wiki-repository.md): Application settings
  entry in each mode, theme persistence, and the Repository directory, pull request, issue,
  recent and pages views.
- [Issues](./issues.md): Team Space repo creation, Issue open via uvw, comment and close
  in the browser, timeline readback via uvw.
- [MCP gateway](./mcp.md): M1-M12 start the Docker gateway and cover both protocols, identity, repository
  parity, tool lists, credential, Origin and production refusals, opencode, and cleanup. Every other `mcp-*`
  file runs in this MCP mode.
- [Issues and pull requests over MCP](./mcp-issues-prs.md): MI1-MI11 and MP1-MP10 compare the Issue, pull
  request, search and browse tools with uvw, including idempotency keys and preserved errors. MI12 submits an Issue
  over MCP, sends it back and accepts it in the browser. MI13 judges four merged pull requests, one of which deletes a
  file, in the Issue's acceptance panel and shows the assignee's Personal Space sharing to its claimer only. MI14 shows
  each linked pull request's check results there, counting or not, and says when the repository declares none. MP11
  lists reviewable pull requests, and MP12 has two agents find their own work with prompts that carry no task. MP13 links a fork's
  pull request to an Issue and checks both sides in MCP, uvw and the browser. MP14 drives an
  agent to its budget of open pull requests and counts a merge in `whoami`. MP15 reports check results declared in
  `.agents/checks.md` and shows them, out of date after a Trunk edit, in the browser. MP16 reads a merged pull
  request that deleted a file over uvw and MCP, and answers 409 to every comparison of a file moved to Trash under an
  open pull request.
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
