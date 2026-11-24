# Pull requests (Worktrees)

An agent opens a draft pull request (a Worktree) in a repository, adds a new file to it,
writes content with Facade code, marks it ready, and merges it. The file then appears on
Trunk for the CLI and in the browser. Merging needs edit access to every file the pull request
changes: the author merges, the person who claimed an authoring agent does, and in a Team Space so
does the Owner, an Admin or an Editor once the pull request is visible to the Space. A member who can
only read proposes a change the same way and leaves the merge to them.

## Sub-features

- `pr-create` opens a draft PR with `uvw pr create`.
- `pr-unit-create` adds a new Worktree-local Unit with `uvw unit create`.
- `pr-execute` writes content with `uvw execute` and returns a readback value.
- `pr-ready-merge` moves the PR to `ready`, then `merged`.
- `pr-trunk-readback` shows the merged content via `uvw inspect --trunk` and in the browser editor.
- `pr-propose-read-only` lets a Team Space member with read access open a pull request, change it and mark it
  ready through uvw and MCP, refuses their merge and their direct writes to Trunk, and lets an Editor merge it.
- `pr-merge-rights` refuses the Team Space Owner on a private pull request someone else created, and lets them
  merge it once it is visible to the Space, in uvw and in the browser review panel.
- `pr-merge-states` lets the merger rerun `pr merge` on a merged PR, and refuses a draft or an already merged PR
  for anyone else before calling the server.

## How to get to it (user POV)

- `uvw pr create|ready|merge -R <owner>/<slug>`, `uvw unit create`, `uvw execute`, `uvw inspect`.
- `uvw browse <n> -R <repo>` prints the review URL. In the browser, the file appears in
  the sidebar under its Space after the merge.

## Driving it with agent-browser and uvw

Preconditions:

- Baseline run with `$V user` done. `O=verify-$VERIFY_UVW_RUN`, `R=$O/personal`.
- Set `agent-browser storage local set univer-workspace-layout-theme wiki` on the test origin. Confirm Wiki with `Enter workspace` if Home shows the view choice.

- **Open PR.** Run `$V cli pr-create pr create -R $R -t "Verify sales sheet" --json`.
  Exit `0`, and the output has `state: "draft"`, `number` (`P`), and `id` (Worktree ID, `W`). `number` is `1`
  only when this user has no earlier Worktree; `$V doctor` in MCP mode and `seed-sheets.mjs` each create one.
- **Add a Unit.** Run `$V cli pr-unit-create unit create --worktree $W --space $R --type sheet --name Sales --json`.
  The output has `unit.change: "added"`, `unit.type: "sheet"`, `unit.unitId` (`U`) and `unit.nodeId` (`N`).
- **Write content.** Run
  `$V cli pr-execute execute --worktree $W --unit $U --json -e 'const ws = univerAPI.getActiveWorkbook().getActiveSheet(); ws.getRange("A1:B2").setValues([["Region","Total"],["North",42]]); return ws.getRange("A1:B2").getValues();'`.
  The output has `committed: true`, a `revision`, and `value` equal to the written grid.
- **Ready.** Run `$V cli pr-ready pr ready $P -R $R --json state`. Output: `{"state": "ready"}`.
- **Merge.** Run `$V cli pr-merge pr merge $P -R $R --json`. Output: `state: "merged"`.
- **Trunk readback.** Run `$V cli pr-trunk-readback inspect range A1:B2 --unit $U --trunk --worksheet index:1`.
  Output: `Sheet 1!A1:B2` with `"Region" "Total"` / `"North" "42"`.
- **Browser view.** Sign the browser in as the baseline user (see [auth](./auth.md)), run
  `agent-browser open "$ORIGIN/nodes/$N"`, `agent-browser wait canvas`, `agent-browser wait 4000`,
  then `agent-browser screenshot "$EVIDENCE/pr-trunk-readback.png"`. The sidebar lists
  `Sales` under `Personal Space`, and the grid shows Region/Total and North/42.
- **Rerun.** Run `$V cli pr-merge-again pr merge $P -R $R --json`. Exit `0`, `state: "merged"`.

Proposals and merge rights (`pr-propose-read-only`, `pr-merge-rights`, `pr-merge-states`) need a Team Space
that someone else holds, where the run user can only read:

- **People.** Register a holder H and an editor E with `POST $ORIGIN/api/auth/password/register`
  (`username`, `displayName`, `password`). Keep each password and the `workspace_session` cookie the response
  sets outside `$EVIDENCE`. Sign each one's uvw in from its own home:
  `UH=${VERIFY_UVW_ROOT:-/tmp/verify-uvw}/$VERIFY_UVW_RUN/home-h; uh(){ env UNIVER_HOME=$UH node apps/cli/dist/main.js "$@"; }`,
  `uh config set workspace.origin $ORIGIN`, then `uh auth login --username <H> --password-stdin`; the same for E
  as `ue`. `$V down` stops only the run's own CLI daemon, so run `uh daemon stop` and `ue daemon stop` first, then
  remove these homes, passwords and cookies after `$V down`.
- **Team Space.** `uh repo create team-pr --name "PR Team" --json id` gives `T`, with `publicRead: false`. With
  H's cookie, `curl -X PUT -b <cookie> -H 'content-type: application/json' -d '{"role":"viewer"}' "$ORIGIN/api/team-spaces/$T/members/<run user id>"`
  returns `200`, and so does `{"role":"editor"}` for E. `$V cli pp-repo repo view <H>/team-pr --json accessRole`
  then says `viewer`.
- **Trunk file.** H puts a Sheet on Trunk through their own pull request: `uh pr create`, `uh unit create`
  (keep `unit.resourceId` as `RES`, `unit.unitId` as `U`, `unit.nodeId` as `N`), `uh execute`, `uh pr ready 1`,
  `uh pr merge 1`. An Owner's own private pull request merges as before.
- **Propose.** As the run user, `$V cli pp-create pr create -R <H>/team-pr -t "Proposal" --json` has
  `state: "draft"`, `kind: "team"`, `visibility: "private"`. `$V cli pp-add unit add --worktree $W --resource $RES --json`
  has `unit.source: "trunk"`, and `$V cli pp-execute execute --worktree $W --unit $U --json -e '<code>'` has
  `committed: true`. `$V cli pp-new unit create --worktree $W --space <H>/team-pr --type sheet --name Proposed --json`
  adds a new file to the proposal; keep its `unit.nodeId` as `PN`.
  `uh inspect range A1:B2 --unit $U --trunk --worksheet index:1` still shows H's values.
  `$V cli pp-ready pr ready $P -R <H>/team-pr --json state,visibility` prints
  `{"state": "ready", "visibility": "space"}`: marking it ready shares it, because its author cannot merge it.
- **Propose through MCP.** In [MCP mode](../references/mcp-mode.md), `$V mcp pp-mcp-create pr_create '{"repo":"<H>/team-pr","title":"Proposal"}'`,
  then `unit_add` (`worktree`, `resource`), `unit_create` (`worktree`, `space`, `type`, `name`), `execute`
  (`worktree`, `unit`, `code`) and `pr_ready` (`repo`, `number`) succeed the same way, and `pr_ready` returns
  `visibility: "space"`. `$V mcp pp-mcp-merge pr_merge '{"repo":"<H>/team-pr","number":<n>}'` exits `1`
  with `code: "FORBIDDEN"` and the message below.
- **Refusals.** The run user's `pr merge $P -R <H>/team-pr --json` exits `1` with
  `FORBIDDEN: You cannot merge this pull request without edit access to every file and folder it changes.`
  (status 403). Its direct writes to Trunk are refused with status 403 too: `space node create <H>/team-pr --name X`
  and `space node rename $N --name X` with `FORBIDDEN: The current user cannot perform this action.`, and
  `space node trash $N` and `blob upload --file <file> --space $T` with `FORBIDDEN: This action is not allowed.`
  Through MCP, `$V mcp --toolsets all <label> space_node` with `action` `create`, `rename` and `trash` returns the
  same codes. `execute` has no Trunk form: it always takes a `worktree`.
- **Editor merges.** `ue pr list -R <H>/team-pr --json number,state,visibility,creator` lists the proposal as
  `ready` and `space` with the run user as `creator`. `ue pr merge $P -R <H>/team-pr --json state` prints
  `{"state": "merged"}`. H's `inspect --trunk` now shows the proposed values, and `uh space browse <H>/team-pr --json`
  lists `Proposed`, the file the proposal created. With H's cookie, `GET $ORIGIN/api/spaces/$T/activity?timeZone=UTC` has
  `pull-opened` by the run user and `pull-merged` by E for that pull request. The run user's
  `space node trash $PN` is still refused.
- **Browser.** A second member with read access (register one and add it as `viewer`) opens
  `$ORIGIN/spaces/$T/pulls/$P` on a ready proposal: the review panel reads
  `Merging this pull request needs edit access to every file it changes.` and has no merge button. In E's
  session the panel has `Confirm merge`; click it, confirm `Merge this task?`, and the page says `Merged`.
  Screenshot both. The panel sits below the fold, so scroll it into view first.
- **Private (`pr-merge-rights`).** E opens a pull request, adds a file and runs `ue pr ready`: it prints
  `{"state": "ready", "visibility": "private"}`, because E can merge it. The run user's `pr view` exits `1` with
  status 404. `uh pr merge $P -R <H>/team-pr --json` exits `1` with
  `FORBIDDEN: Only the author, <E display name> (@<E>), can merge this pull request.` (status 403), and H's browser
  panel reads `Only the author, <E display name>, can merge this pull request.` beside `Continue editing` and
  `Discard changes`, with no merge button. After `ue pr edit $P -R <H>/team-pr --visibility space --json visibility`,
  `uh pr merge` prints `{"state": "merged"}`.
- **States.** The run user's `pr merge` on that merged pull request prints
  `workspace-lifecycle-invalid: Pull request #<n> is already merged.` A draft PR's merge prints
  `workspace-lifecycle-invalid: Cannot merge pull request #<n> while it is draft.`

## Gotchas

- `unit create` requires `--space` even though the Worktree knows its repository. It takes `<owner>/<slug>`,
  a Space ID or a URL; `-R` is not accepted there.
- `--worksheet index:0` fails with "CLI indices start at 1".
- `inspect range` without `--worksheet` fails with "range requires --worksheet <selector>".
- The `pr merge` output lists `units: []`. Prove the merge by Trunk readback, or by `pr view <n> --json`, whose
  `units[].mergeResult` is `merged`.
- A stopped merge (`merging`) is finished by running `pr merge` again; the harness cannot stop one midway.
- `pr merge` and `pr discard` are irreversible. In this disposable run they are fine;
  never point this recipe at a real Workspace.
- Execution goes through the CLI daemon under the run's `UNIVER_HOME`. `$V down` stops it.
