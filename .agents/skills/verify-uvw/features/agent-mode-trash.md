# Agent Mode: files that move to Trash around a pull request

A merged pull request that deleted a file stays readable, also after the file is deleted permanently. When a
file an open pull request changes moves to Trash, every reader still reviews its other files, nobody compares or
merges the file in Trash, and the author leaves it out to merge the rest.

## Sub-features

- MP16 reads a merged pull request that deleted a file with uvw and MCP, before and after the file is deleted
  permanently, and answers 409 in every comparison mode for a file moved to Trash under an open pull request, whose
  page shows the Trash note, no `Compare` and no server error.
- MP19 moves one of the two files a claimed agent's ready pull request edits to Trash. Every reader still reviews the
  other file, the pull request page and the acceptance panel note the file in Trash with no `Compare` at 1440 and 390
  px, `pr_merge` and `uvw pr merge` are refused with `FILES_IN_TRASH` naming it, and the agent, on its default
  connection, leaves it out with `pr_edit` and merges the other file.

## How to get to it (user POV)

A person reads a pull request at `/spaces/<space>/pulls/<n>`. MP16 also uses `uvw space node trash` and the
repository's `Trash` page, and MP19 calls `pr_edit` with `leave_out_trashed` as an agent.

## Driving it with agent-browser and uvw

Mode: mcp.

Start every shell with `eval "$($V env)"`. Each `$V mcp`
call checks its usage event and credential leakage, and exit 5 fails the journey.
[MCP mode](../references/mcp-mode.md) lists the helper commands and their exit codes.

```bash
O=verify-$VERIFY_UVW_RUN
```

### MP16. Pull requests that delete a file

The run user O puts two Sheets, `Archive` and `Direct`, on the Trunk of its Personal Space. One pull request deletes
`Archive` and merges, and uvw and MCP read it before and after O deletes the file permanently. Two open pull requests,
a draft and a ready one, mark `Direct` for deletion, and then O moves `Direct` to Trash on Trunk.

```bash
R="$O/personal"
$V cli mpd-seed pr create -R "$R" -t "Seed" --json id,number
for name in Archive Direct; do
  $V cli "mpd-$name" unit create --worktree "$(jq -r .id "$EVIDENCE/mpd-seed.out")" --space "$R" --type sheet --name "$name" --json
done
$V cli mpd-seed-ready pr ready "$(jq -r .number "$EVIDENCE/mpd-seed.out")" -R "$R" --json state
$V cli mpd-seed-merge pr merge "$(jq -r .number "$EVIDENCE/mpd-seed.out")" -R "$R" --json state
for k in archive draft ready; do $V cli "mpd-pr-$k" pr create -R "$R" -t "Remove $k" --json id,number; done
$V cli mpd-add-archive unit add --worktree "$(jq -r .id "$EVIDENCE/mpd-pr-archive.out")" --resource "$(jq -r .unit.resourceId "$EVIDENCE/mpd-Archive.out")" --json
for k in draft ready; do
  $V cli "mpd-add-$k" unit add --worktree "$(jq -r .id "$EVIDENCE/mpd-pr-$k.out")" --resource "$(jq -r .unit.resourceId "$EVIDENCE/mpd-Direct.out")" --json
done
$V cli mpd-personal repo view "$R" --json id
P=$(jq -r .id "$EVIDENCE/mpd-personal.out")
```

In the run browser, signed in as O, open each of the three pull requests at `$ORIGIN/spaces/$P/pulls/<number>`, click
`Files changed`, then `Mark for deletion`. The file reads `Deleted`. While the archive pull request is a draft, its
default and `?baseMode=base` comparisons still answer 200:

```bash
W=$(jq -r .id "$EVIDENCE/mpd-pr-archive.out"); U=$(jq -r .unit.unitId "$EVIDENCE/mpd-Archive.out")
agent-browser eval "Promise.all(['', '?baseMode=base'].map((m) => fetch('/universer-api/worktrees/$W/units/$U/comparison' + m).then((r) => r.status))).then((s) => s.join(' '))" | tee "$EVIDENCE/mpd-comparison-readable.txt"
NA=$(jq -r .number "$EVIDENCE/mpd-pr-archive.out")
$V cli mpd-archive-ready pr ready "$NA" -R "$R" --json state
$V cli mpd-archive-merge pr merge "$NA" -R "$R" --json state
$V cli mpd-ready-ready pr ready "$(jq -r .number "$EVIDENCE/mpd-pr-ready.out")" -R "$R" --json state
$V cli mpd-view pr view "$NA" -R "$R" --json
$V mcp mpd-view-mcp pr_view "{\"repo\":\"$R\",\"number\":\"$NA\"}"
for f in mpd-view mpd-view-mcp; do
  jq -e '.state == "merged" and ([.units[] | {change, mergeResult}] == [{change: "deleted", mergeResult: "removed"}])' "$EVIDENCE/$f.out"
done
```

Open `$ORIGIN/spaces/$P/trash`, click `Remove` on `Archive` and confirm `Remove`, so the merged file has no Node. Then:

```bash
$V cli mpd-view-purged pr view "$NA" -R "$R" --json
$V mcp mpd-view-purged-mcp pr_view "{\"repo\":\"$R\",\"number\":\"$NA\"}"
for f in mpd-view-purged mpd-view-purged-mcp; do jq -e '[.units[] | .nodeId] == [null]' "$EVIDENCE/$f.out"; done
$V cli mpd-trash space node trash "$(jq -r .unit.nodeId "$EVIDENCE/mpd-Direct.out")" --json
U=$(jq -r .unit.unitId "$EVIDENCE/mpd-Direct.out")
for k in draft ready; do
  W=$(jq -r .id "$EVIDENCE/mpd-pr-$k.out")
  agent-browser eval "Promise.all(['', '?baseMode=base', '?view=preview', '?view=merged', '?baseMode=parent&view=merged'].map((m) => fetch('/universer-api/worktrees/$W/units/$U/comparison' + m).then((r) => r.status))).then((s) => s.join(' '))" | tee "$EVIDENCE/mpd-comparison-$k.txt"
done
grep -c '"statusCode":500' "$EVIDENCE/../logs/server.log"
```

A 409 body's `error.code` is `CONFLICT`. A 403 `FORBIDDEN` there means the server found the file outside Trash and the
reader unable to open it.

Open each open pull request's `Files changed`, where its only file is selected, and screenshot
`mp16-trashed-removal.png`. The file reads `Deleted`, the panel says `This file is now in Trash.`, and there is no
`Compare`.

Pass when the draft's readable comparisons answer 200, both reads of the merged pull request exit 0 with
`mergeResult: "removed"`, also after permanent deletion with `nodeId: null`, every comparison mode answers 409 for both
open pull requests, the server log has no 500, and the screenshot shows the Trash note, no `Compare` and no error.

### MP19. An open pull request whose file moves to Trash

The run user O holds a Team Space with Sheets North and Summary on Trunk and makes a claimed agent A an Editor there.
For an Issue assigned to A, A opens a pull request shared with the Space that edits both Sheets and marks it ready.
O then moves Summary to Trash. Every reader still sees North, and Summary is noted as in Trash with no comparison. A's
`pr_merge` is refused with `FILES_IN_TRASH` naming Summary. A, on its default connection, takes the way out the
refusal names in two calls: it leaves Summary out with `pr_edit` and merges. North merges, and Summary stays in O's
Trash Batch.

```bash
R="$O/trashed-file"
sheet() { jq -nc --arg w "$1" --arg u "$2" --arg c "const ws = univerAPI.getActiveWorkbook().getActiveSheet(); $3" '{worktree:$w,unit:$u,code:$c}'; }
unit() { jq -r .unit.unitId "$EVIDENCE/mpt-$1.out"; }
cell() { jq -r --arg r "$2" '.json.cells[] | select(.ref == $r) | .value' "$EVIDENCE/$1.out"; }
$V cli mpt-repo repo create trashed-file --name "Trashed file" --json id,fullName
T=$(jq -r .id "$EVIDENCE/mpt-repo.out")
$V mcp mpt-seed pr_create "{\"repo\":\"$R\",\"title\":\"Seed\"}"
W0=$(jq -r .id "$EVIDENCE/mpt-seed.out"); N0=$(jq -r .number "$EVIDENCE/mpt-seed.out")
for name in North Summary; do
  $V mcp "mpt-$name" unit_create "{\"worktree\":\"$W0\",\"space\":\"$R\",\"type\":\"sheet\",\"name\":\"$name\"}"
done
$V mcp mpt-seed-ready pr_ready "{\"repo\":\"$R\",\"number\":\"$N0\"}"
$V mcp mpt-seed-merge pr_merge "{\"repo\":\"$R\",\"number\":\"$N0\"}"
$V principal trashed mpt-a
A=$(jq -r .agent.username "$EVIDENCE/principal-trashed.json")
$V mcp --as trashed mpt-claim claim '{}'
```

Open the `claimUrl` from `mpt-claim.out` in the run browser, signed in as O, and click `Take it`. Replace the code in
`mpt-claim.*` as [MH1](agent-handoff.md#mh1-unclaimed-agent) says. Then:

```bash
$V person mpt-member repo member add "$A" --role editor -R "$R" --json
$V cli mpt-issue issue create -R "$R" -t "Fill in North and Summary" -b "Put the North total in North and a title in Summary." -a "$A" --json number
N=$(jq -r .number "$EVIDENCE/mpt-issue.out")
$V mcp --as trashed mpt-pr pr_create "$(jq -nc --arg r "$R" --argjson n "$N" '{repo:$r,title:"Fill in North and Summary",issue:$n,visibility:"space"}')"
W=$(jq -r .id "$EVIDENCE/mpt-pr.out"); NP=$(jq -r .number "$EVIDENCE/mpt-pr.out")
for name in North Summary; do
  $V mcp --as trashed "mpt-add-$name" unit_add "{\"worktree\":\"$W\",\"resource\":\"$(jq -r .unit.resourceId "$EVIDENCE/mpt-$name.out")\"}"
done
$V mcp --as trashed mpt-edit-north execute "$(sheet "$W" "$(unit North)" 'ws.getRange("A1:B2").setValues([["Region","Total"],["North",40]]);')"
$V mcp --as trashed mpt-edit-summary execute "$(sheet "$W" "$(unit Summary)" 'ws.getRange("A1").setValue("Q1 summary");')"
$V mcp --as trashed mpt-ready pr_ready "{\"repo\":\"$R\",\"number\":\"$NP\"}"
$V cli mpt-trash space node trash "$(jq -r .unit.nodeId "$EVIDENCE/mpt-Summary.out")" --json
$V mcp --as trashed mpt-view pr_view "{\"repo\":\"$R\",\"number\":\"$NP\"}"
$V cli mpt-view-o pr view "$NP" -R "$R" --json capabilities,units
for f in mpt-view mpt-view-o; do
  jq -e '.capabilities.review and (.capabilities.merge | not) and ([.units[] | [.name, .change, .fileState]] == [["North","modified","live"],["Summary","modified","inTrash"]])' "$EVIDENCE/$f.out"
done
$V mcp --as trashed mpt-merge-refused pr_merge "{\"repo\":\"$R\",\"number\":\"$NP\"}"
test $? -eq 1
jq -e '.code == "FILES_IN_TRASH" and .detail.status == 409 and (.message | contains("Summary (in Trash)"))' "$EVIDENCE/mpt-merge-refused.out"
$V cli mpt-merge-refused-o pr merge "$NP" -R "$R" --json state
test $? -eq 1
grep -q '^FILES_IN_TRASH: .*Summary (in Trash)' "$EVIDENCE/mpt-merge-refused-o.err"
```

In the run browser, signed in as O, at 1440 × 1500, open `$ORIGIN/spaces/$T/pulls/$NP` and screenshot
`mp19-pr-overview.png`: there is no merge button, and the line under `Continue editing` reads `Some files it changes
are in Trash or permanently deleted, so no one can merge those changes. Once its author leaves them out, the other
files can merge.` Click `Files changed` and then Summary in the file list. The panel reads `This file is now in
Trash.` and there is no `Compare`: screenshot `mp19-pr.png`. Click North: it offers `Compare`, and its comparison
loads. At 390 × 1500, open Summary's URL again, check that `document.documentElement.scrollWidth` is 390, and
screenshot `mp19-pr-narrow.png`, then the Overview as `mp19-pr-overview-narrow.png` with the same line. Then open
`$ORIGIN/spaces/$T/issues/$N` at 1440 × 1500, choose `Acceptance`, and screenshot the pull request
(`find text "Pull requests"` scrolled into view) as `mp19-panel.png`: it lists North with `Compare` and Summary with
`This file is now in Trash.` and no `Compare`, and it does not read `You may not see this pull request's files.` At
390 × 2300, reload, check the scroll width again, and screenshot `mp19-panel-narrow.png`.

A leaves Summary out and merges on its default connection, whose tools include `pr_edit` and `pr_merge`:

```bash
$V mcp-tools --as trashed mpt-tools
jq -e '[.[].name] | index("pr_edit") != null and index("pr_merge") != null' "$EVIDENCE/mpt-tools.out"
$V mcp --as trashed mpt-leave-out pr_edit "{\"repo\":\"$R\",\"number\":\"$NP\",\"leave_out_trashed\":true}"
jq -e '.state == "ready" and ([.units[] | [.name, .change]] == [["North","modified"],["Summary","deleted"]])' "$EVIDENCE/mpt-leave-out.out"
$V mcp --as trashed mpt-merge pr_merge "{\"repo\":\"$R\",\"number\":\"$NP\"}"
jq -e '.state == "merged"' "$EVIDENCE/mpt-merge.out"
$V cli mpt-after pr view "$NP" -R "$R" --json state,units
jq -e '.state == "merged" and ([.units[] | [.name, .change, .mergeResult, .fileState]] == [["North","modified","merged","live"],["Summary","deleted","removed","inTrash"]])' "$EVIDENCE/mpt-after.out"
$V cli mpt-north read A1:B2 --unit "$(unit North)" --trunk --json
test "$(cell mpt-north B2)" = 40
agent-browser eval "fetch('/api/spaces/$T/trash').then((r) => r.json()).then((j) => j.items.map((b) => b.id).join(' '))" | tee "$EVIDENCE/mpt-trash-after.txt"
test "$(tr -d '"' < "$EVIDENCE/mpt-trash-after.txt")" = "$(jq -r .trashBatch.trashBatchId "$EVIDENCE/mpt-trash.out")"
grep -c '"statusCode":500' "$EVIDENCE/../logs/server.log"
test $? -eq 1
```

Reload the pull request page at 1440 × 1500, open Summary under `Files changed` and screenshot `mp19-merged.png`: it is
merged, and Summary reads `This file is now in Trash.`

Pass when every command exits as shown, both reads show A and O North and Summary with Summary `inTrash` and no merge,
both refusals name `Summary (in Trash)`, the screenshots show the note, the merge line and no `Compare` for Summary at
both widths with a scroll width of 390, A leaves Summary out and merges in two calls, North reads 40 on Trunk, Summary
stays in Trash as the only batch, O's own, and the server log has no 500.

## Gotchas

- The MCP-mode gotchas in [MCP gateway](mcp.md#gotchas) apply.
- The `codex` story client cannot merge: its approval policy `never` refuses `pr_merge` before the call reaches the
  gateway, and the model reads `MCP tool call requires approval`. MP19 therefore drives the agent with `$V mcp --as`.
