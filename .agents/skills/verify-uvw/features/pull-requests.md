# Pull requests (Worktrees)

An agent opens a draft pull request (a Worktree) in a repository, adds a new file to it,
writes content with Facade code, marks it ready, and merges it. The file then appears on
Trunk for the CLI and in the browser.

## Sub-features

- `pr-create` opens a draft PR with `uvw pr create`.
- `pr-unit-create` adds a new Worktree-local Unit with `uvw unit create`.
- `pr-execute` writes content with `uvw execute` and returns a readback value.
- `pr-ready-merge` moves the PR to `ready`, then `merged`.
- `pr-trunk-readback` shows the merged content via `uvw inspect --trunk` and in the browser editor.

## How to get to it (user POV)

- `uvw pr create|ready|merge -R <owner>/<slug>`, `uvw unit create`, `uvw execute`, `uvw inspect`.
- `uvw browse <n> -R <repo>` prints the review URL. In the browser, the file appears in
  the sidebar under its Space after the merge.

## Driving it with agent-browser and uvw

Preconditions:

- Baseline run with `$V user` done. `R=verify-$VERIFY_UVW_RUN/personal`.
- Pin the Wiki page theme before opening any route: `agent-browser storage local set univer-workspace-layout-theme wiki`. A fresh session starts in Repository.
- The Personal Space ID from `$V uvw repo list --json` (`id` of the `personal` entry) is in `S`.

- **Open PR.** Run `$V cli pr-create pr create -R $R -t "Verify sales sheet" --json`.
  Exit `0`, and the output has `state: "draft"`, `number: 1`, and `id` (Worktree ID, `W`).
- **Add a Unit.** Run `$V cli pr-unit-create unit create --worktree $W --space $S --type sheet --name Sales --json`.
  The output has `unit.change: "added"`, `unit.type: "sheet"`, `unitId` (`U`) and `nodeId` (`N`).
- **Write content.** Run
  `$V cli pr-execute execute --worktree $W --unit $U --json -e 'const ws = univerAPI.getActiveWorkbook().getActiveSheet(); ws.getRange("A1:B2").setValues([["Region","Total"],["North",42]]); return ws.getRange("A1:B2").getValues();'`.
  The output has `committed: true`, a `revision`, and `value` equal to the written grid.
- **Ready.** Run `$V cli pr-ready pr ready 1 -R $R --json state`. Output: `{"state": "ready"}`.
- **Merge.** Run `$V cli pr-merge pr merge 1 -R $R --json`. Output: `state: "merged"`.
- **Trunk readback.** Run `$V cli pr-trunk-readback inspect range A1:B2 --unit $U --trunk --worksheet index:1`.
  Output: `Sheet 1!A1:B2` with `"Region" "Total"` / `"North" "42"`.
- **Browser view.** Sign the browser in as the baseline user (see [auth](./auth.md)), run
  `agent-browser open "$ORIGIN/nodes/$N"`, `agent-browser wait canvas`, `agent-browser wait 4000`,
  then `agent-browser screenshot "$EVIDENCE/pr-trunk-readback.png"`. The sidebar lists
  `Sales` under `Personal Space`, and the grid shows Region/Total and North/42.

## Gotchas

- `unit create` requires `--space <id>` even though the Worktree knows its repository.
  `-R` is not accepted there.
- `--worksheet index:0` fails with "CLI indices start at 1".
- `inspect range` without `--worksheet` fails with "range requires --worksheet <selector>".
- The `pr merge` output lists `units: []`. Prove the merge by Trunk readback, not by that list.
- `pr merge` and `pr discard` are irreversible. In this disposable run they are fine;
  never point this recipe at a real Workspace.
- Execution goes through the CLI daemon under the run's `UNIVER_HOME`. `$V down` stops it.
