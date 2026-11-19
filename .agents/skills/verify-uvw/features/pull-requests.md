# Pull requests (Worktrees)

An agent opens a draft pull request (a Worktree) in a repository, adds a new file to it,
writes content with Facade code, marks it ready, and merges it. The file then appears on
Trunk for the CLI and in the browser. Only the author, or the person who claimed an authoring
agent, may merge; other members see who can.

## Sub-features

- `pr-create` opens a draft PR with `uvw pr create`.
- `pr-unit-create` adds a new Worktree-local Unit with `uvw unit create`.
- `pr-execute` writes content with `uvw execute` and returns a readback value.
- `pr-ready-merge` moves the PR to `ready`, then `merged`.
- `pr-trunk-readback` shows the merged content via `uvw inspect --trunk` and in the browser editor.
- `pr-merge-author-only` refuses a Team Space merge by another member, in uvw and in the browser review panel.
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

Author-only merge (`pr-merge-author-only`, `pr-merge-states`) needs a second member in a Team Space:

- **Team PR.** `$V cli prt-repo repo create team-pr --name "PR Team" --json id` gives `T`.
  `$V cli prt-create pr create -R $O/team-pr -t "Team sheet" --json`, add a Unit with
  `unit create --space $O/team-pr`, then `pr ready`. A new PR is `visibility: "private"`: other members get
  `NOT_FOUND: Worktree not found.` until `$V cli prt-edit pr edit $P -R $O/team-pr --visibility space --json visibility`.
- **Second member.** Register B with `POST $ORIGIN/api/auth/password/register`
  (`username`, `displayName`, `password`), keep the password outside `$EVIDENCE`, and add B from the run
  browser's session: `agent-browser eval "fetch('/api/team-spaces/$T/members/<B id>',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({role:'editor'})}).then(r=>r.status)"`
  returns `200`. Sign B's uvw in from its own home:
  `UB=${VERIFY_UVW_ROOT:-/tmp/verify-uvw}/$VERIFY_UVW_RUN/home-b; ub(){ env UNIVER_HOME=$UB node apps/cli/dist/main.js "$@"; }`,
  `ub config set workspace.origin $ORIGIN`, then `ub auth login --username <B> --password-stdin`.
  Remove `$UB` after `$V down`.
- **Refusal.** `ub pr merge $P -R $O/team-pr --json` exits `1` with
  `FORBIDDEN: Only the author, Verify <run-id> (@verify-<run-id>), can merge this pull request.` (status 403).
  `pr view` still says `ready`.
- **Browser.** In a separate agent-browser session signed in as B, open `$ORIGIN/spaces/$T/pulls/$P`. The review
  panel reads `Only the author, Verify <run-id>, can merge this pull request.` and has no Merge button. Screenshot it.
- **States.** The run user merges (`state: "merged"`). B's retry prints
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
