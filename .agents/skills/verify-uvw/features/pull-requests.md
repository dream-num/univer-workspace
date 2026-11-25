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
- `pr-name-hidden` tells a reader who cannot open a file of a merged pull request, and so reads its name as
  `Removed resource`, nothing about whether that file is live, in Trash or deleted.

## How to get to it (user POV)

- `uvw pr create|ready|merge -R <owner>/<slug>`, `uvw unit create`, `uvw execute`, `uvw inspect`.
- `uvw browse <n> -R <repo>` prints the review URL. In the browser, the file appears in
  the sidebar under its Space after the merge.

## Driving it with agent-browser and uvw

Preconditions:

- Baseline run with `$V user` done. `O=verify-$VERIFY_UVW_RUN`, `R=$O/personal`.
- Set `agent-browser storage local set univer-workspace-layout-theme wiki` on the test origin. Confirm Wiki with `Enter workspace` if Home shows the view choice.

### PR1. Open, fill, ready and merge a pull request

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

### PR2. Trunk readback and browser view

- **Trunk readback.** Run `$V cli pr-trunk-readback inspect range A1:B2 --unit $U --trunk --worksheet index:1`.
  Output: `Sheet 1!A1:B2` with `"Region" "Total"` / `"North" "42"`.
- **Browser view.** Sign the browser in as the baseline user (see [auth](./auth.md)), run
  `agent-browser open "$ORIGIN/nodes/$N"`, `agent-browser wait canvas`, `agent-browser wait 4000`,
  then `agent-browser screenshot "$EVIDENCE/pr-trunk-readback.png"`. The sidebar lists
  `Sales` under `Personal Space`, and the grid shows Region/Total and North/42.

### PR3. Rerun

Run `$V cli pr-merge-again pr merge $P -R $R --json`. Exit `0`, `state: "merged"`.

### PR4. Propose as a reader of a Team Space

Mode: mcp.

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

### PR5. Propose through MCP

Mode: mcp.

As the run user, `$V mcp pp-mcp-create pr_create '{"repo":"<H>/team-pr","title":"Proposal"}'`,
then `unit_add` (`worktree`, `resource`), `unit_create` (`worktree`, `space`, `type`, `name`), `execute`
(`worktree`, `unit`, `code`) and `pr_ready` (`repo`, `number`) succeed the same way, and `pr_ready` returns
`visibility: "space"`. Keep its `number` as `P5`. `$V mcp pp-mcp-merge pr_merge '{"repo":"<H>/team-pr","number":<P5>}'`
exits `1` with `code: "FORBIDDEN"` and the message below.

### PR6. Refusals

Mode: mcp.

The run user's `pr merge $P -R <H>/team-pr --json` exits `1` with
`FORBIDDEN: You cannot merge this pull request without edit access to every file and folder it changes.`
(status 403). Its direct writes to Trunk are refused with status 403 too: `space node create <H>/team-pr --name X`
and `space node rename $N --name X` with `FORBIDDEN: The current user cannot perform this action.`, and
`space node trash $N` and `blob upload --file <file> --space $T` with `FORBIDDEN: This action is not allowed.`
Through MCP, `$V mcp --toolsets all <label> space_node` with `action` `create`, `rename` and `trash` returns the
same codes. `execute` has no Trunk form: it always takes a `worktree`.

### PR7. Editor merges

Mode: mcp.

`ue pr list -R <H>/team-pr --json number,state,visibility,creator` lists the proposal as
`ready` and `space` with the run user as `creator`. `ue pr merge $P -R <H>/team-pr --json state` prints
`{"state": "merged"}`. H's `inspect --trunk` now shows the proposed values, and `uh space browse <H>/team-pr --json`
lists `Proposed`, the file the proposal created. With H's cookie, `GET $ORIGIN/api/spaces/$T/activity?timeZone=UTC` has
`pull-opened` by the run user and `pull-merged` by E for that pull request. The run user's
`space node trash $PN` is still refused.

### PR8. Browser

Mode: mcp.

A second member with read access (register one and add it as `viewer`) opens PR5's ready proposal,
`$ORIGIN/spaces/$T/pulls/$P5`: the review panel reads
`Merging this pull request needs edit access to every file it changes.` and has no merge button. In E's
session the panel has `Confirm merge`; click it, confirm `Merge this task?`, and the page says `Merged`.
Screenshot both. The panel sits below the fold, so scroll it into view first.

### PR9. Private (`pr-merge-rights`)

Mode: mcp.

E opens a pull request, adds a file and runs `ue pr ready`: it prints
`{"state": "ready", "visibility": "private"}`, because E can merge it. The run user's `pr view` exits `1` with
status 404. `uh pr merge $P -R <H>/team-pr --json` exits `1` with
`FORBIDDEN: Only the author, <E display name> (@<E>), can merge this pull request.` (status 403), and H's browser
panel reads `Only the author, <E display name>, can merge this pull request.` beside `Continue editing` and
`Discard changes`, with no merge button. After `ue pr edit $P -R <H>/team-pr --visibility space --json visibility`,
`uh pr merge` prints `{"state": "merged"}`.

### PR10. States

Mode: mcp.

The run user's `pr merge` on that merged pull request prints
`workspace-lifecycle-invalid: Pull request #<n> is already merged.` Open a draft with
`$V cli pp-draft pr create -R <H>/team-pr -t Draft --json`. The run user's `pr merge` on it prints
`workspace-lifecycle-invalid: Cannot merge pull request #<n> while it is draft.`

### PR11. A former member learns nothing about the files they cannot see (`pr-name-hidden`)

Run: helper.

The run user O holds a Team Space with a Sheet Old on Trunk, and makes a person X its Admin. X opens a pull request
that deletes Old and adds a Sheet Added, and merges it. O restores Old from Trash, moves Added to Trash and removes X.
X still reads the merged pull request, as its author, and sees both names as `Removed resource`. Then O moves Old to
Trash, deletes Added permanently and makes the Space public. X reads the same thing before and after, while O reads
where each file is. X's password, cookie and uvw home stay in `$UNIVER_HOME/prh-*`, which `$V down` deletes:

```bash
RUN=${VERIFY_UVW_ROOT:-/tmp/verify-uvw}/$VERIFY_UVW_RUN
O=verify-$VERIFY_UVW_RUN; X=$O-former; R=$O/name-hidden
OH=$UNIVER_HOME/prh-owner; XH=$UNIVER_HOME/prh-former
mkdir -m 700 -p "$OH" "$XH"
openssl rand -hex 16 > "$XH/pw"
curl --fail-with-body -sS -c "$OH/cookies" -o /dev/null -X POST "$ORIGIN/api/auth/password/login" -H 'content-type: application/json' \
  -d "{\"username\":\"$O\",\"password\":\"$(cat "$RUN/user.pw")\"}"
curl --fail-with-body -sS -c "$XH/cookies" -o "$XH/register.json" -X POST "$ORIGIN/api/auth/password/register" -H 'content-type: application/json' \
  -d "{\"username\":\"$X\",\"displayName\":\"Former member\",\"password\":\"$(cat "$XH/pw")\"}"
ux(){ env UNIVER_HOME="$XH" node apps/cli/dist/main.js "$@"; }
ux config set workspace.origin "$ORIGIN" > /dev/null
ux auth login --username "$X" --password-stdin --json < "$XH/pw" > /dev/null
$V cli prh-repo repo create name-hidden --name "Name hidden" --json id
T=$(jq -r .id "$EVIDENCE/prh-repo.out")
$V cli prh-seed pr create -R "$R" -t Seed --json id,number
$V cli prh-old unit create --worktree "$(jq -r .id "$EVIDENCE/prh-seed.out")" --space "$R" --type sheet --name Old --json
$V cli prh-seed-ready pr ready "$(jq -r .number "$EVIDENCE/prh-seed.out")" -R "$R" --json state
$V cli prh-seed-merge pr merge "$(jq -r .number "$EVIDENCE/prh-seed.out")" -R "$R" --json state
$V cli prh-member repo member add "$X" --role admin -R "$R" --json
ux pr create -R "$R" -t "Replace Old" --json id,number > "$EVIDENCE/prh-pr.out"
W=$(jq -r .id "$EVIDENCE/prh-pr.out"); N=$(jq -r .number "$EVIDENCE/prh-pr.out")
ux unit add --worktree "$W" --resource "$(jq -r .unit.resourceId "$EVIDENCE/prh-old.out")" --json > "$EVIDENCE/prh-add-old.out"
OLD=$(jq -r .unit.unitId "$EVIDENCE/prh-add-old.out")
curl --fail-with-body -sS -b "$XH/cookies" -o /dev/null -X POST -H 'content-type: application/json' -d '{"removed":true}' \
  "$ORIGIN/api/worktrees/$W/units/$OLD/removal"
ux unit create --worktree "$W" --space "$R" --type sheet --name Added --json > "$EVIDENCE/prh-added.out"
ADDED=$(jq -r .unit.unitId "$EVIDENCE/prh-added.out")
ux pr ready "$N" -R "$R" --json state > /dev/null
ux pr merge "$N" -R "$R" --json state > "$EVIDENCE/prh-merge.out"
jq -e '.state == "merged"' "$EVIDENCE/prh-merge.out"
batch() { curl --fail-with-body -sS -b "$OH/cookies" "$ORIGIN/api/spaces/$T/trash" | jq -r --arg n "$1" '.items[] | select(.root.name == $n) | .id'; }
curl --fail-with-body -sS -b "$OH/cookies" -o /dev/null -X POST "$ORIGIN/api/trash-batches/$(batch Old)/restore"
$V cli prh-trash-added space node trash "$(jq -r .unit.nodeId "$EVIDENCE/prh-added.out")" --json
$V cli prh-remove repo member remove "$X" -R "$R" --json
observe() {
  curl -sS -b "$1/cookies" "$ORIGIN/api/worktrees/$W" > "$EVIDENCE/prh-$2-pr.json"
  curl -sS -b "$1/cookies" "$ORIGIN/api/worktrees/$W/revert" > "$EVIDENCE/prh-$2-plan.json"
  for u in "$OLD" "$ADDED"; do
    curl -sS -b "$1/cookies" -o /dev/null -w '%{http_code} ' "$ORIGIN/universer-api/worktrees/$W/units/$u/comparison"
  done > "$EVIDENCE/prh-$2-compare.txt"
  jq -S '[.worktree.units[] | {name, nodeId, freshness, fileState}]' "$EVIDENCE/prh-$2-pr.json" > "$EVIDENCE/prh-$2-units.json"
  jq -S '[.items[] | {action, state, name, nodeId, reason}]' "$EVIDENCE/prh-$2-plan.json" > "$EVIDENCE/prh-$2-items.json"
}
observe "$XH" former-1
observe "$OH" owner-1
ux pr view "$W" --json units > "$EVIDENCE/prh-former-1-cli.out"
jq -e '.worktree.capabilities.review and ([.worktree.units[] | [.name, .nodeId, .freshness, .fileState]] == [["Removed resource", null, null, null], ["Removed resource", null, null, null]])' "$EVIDENCE/prh-former-1-pr.json"
test "$(cat "$EVIDENCE/prh-former-1-compare.txt")" = "403 403 "
jq -e '[.[] | [.state, .nodeId]] == [["unavailable", null], ["unavailable", null]]' "$EVIDENCE/prh-former-1-items.json"
jq -e '[.units[] | [.name, .fileState]] == [["Removed resource", null], ["Removed resource", null]]' "$EVIDENCE/prh-former-1-cli.out"
jq -e '[.worktree.units[] | [.name, .fileState]] == [["Old", "live"], ["Added", "inTrash"]]' "$EVIDENCE/prh-owner-1-pr.json"
test "$(cut -d' ' -f2 "$EVIDENCE/prh-owner-1-compare.txt")" = 409
$V cli prh-trash-old space node trash "$(jq -r .unit.nodeId "$EVIDENCE/prh-old.out")" --json
curl --fail-with-body -sS -b "$OH/cookies" -o /dev/null -X DELETE "$ORIGIN/api/trash-batches/$(batch Added)"
$V cli prh-public repo edit "$R" --visibility public --json publicRead
observe "$XH" former-2
observe "$OH" owner-2
for f in units.json items.json compare.txt; do cmp "$EVIDENCE/prh-former-1-$f" "$EVIDENCE/prh-former-2-$f"; done
jq -e '[.worktree.units[] | [.name, .fileState]] == [["Old", "inTrash"], ["Added", "deleted"]]' "$EVIDENCE/prh-owner-2-pr.json"
test "$(cat "$EVIDENCE/prh-owner-2-compare.txt")" = "409 409 "
```

Pass when X reads both files as `Removed resource` with a null `nodeId`, `freshness` and `fileState` in HTTP and
`uvw pr view`, gets `403` for both comparisons and two `unavailable` revert items, and reads byte-identical files,
statuses and revert items once Old is in Trash, Added is deleted and the Space is public, while O reads Old `live`
and Added `inTrash` with a `409` comparison, then Old `inTrash` and Added `deleted` with `409` for both.

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
