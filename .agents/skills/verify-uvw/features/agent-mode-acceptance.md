# Agent Mode: judge and undo an agent's task

A person judges an agent's whole task in the `Acceptance` view of its Issue: the pull requests that serve it,
each changed file before and after its merge, the checks each pull request passed, and what the agent shared outside
the repository. There they accept the task, or revert its merged pull requests, which reopens the Issue.

## Sub-features

- MI13 has a claimed Editor agent merge three pull requests linked to an Issue and submit it, after the run user merges a
  fourth linked one that deletes a file. The run user judges and accepts it in the Issue page's acceptance panel,
  comparing every changed file before and after its merge, sees the deleted file by name as moved to Trash with no
  comparison, and sees the agent's later Link Sharing there, which a member who may not accept does not.
- MI14 has a claimed Editor agent and a claimed Viewer agent each report both declared checks on their own pull request
  linked to one Issue. After both merge, the acceptance panel shows the Editor's results counting and the Viewer's as
  not counting under `Checks at merge`. Once `.agents/checks.md` is in Trash, it says on an open pull request that the
  repository declares no checks, and the merged ones keep their checks at merge.
- MI17 has an agent claimed by another person share a file by link in its Personal Space after its assignment. The
  Space owner, who may accept but did not claim it, sees the share by name, kind and time in the acceptance panel with
  no link, and the claimer gets the full row.
- MI16 reverts an Issue's three merged pull requests from its acceptance panel: changed files go back, an added file
  goes to Trash and a deleted one comes back, a file someone edited after the merge stays blocked and names them until
  a person overwrites it, and the Issue reopens as `reverted`. The checks the agent reported stay `Checks at merge`,
  passed, on the pull request whose added file went to Trash. A claimed agent plans and applies `pr_revert`, cannot
  overwrite, and is refused while the repository requires checks.

## How to get to it (user POV)

A person judges an Issue's whole task in the `Acceptance` view of its page. MI13 calls `unit_add`, `unit_create`,
`execute`, `pr_merge` and `share`, MI14 calls `unit_add`, `execute`, `pr_check` and `pr_merge`, MI16 calls `pr_check`
and `pr_revert` and drives `uvw pr revert`, and MI17 calls `share` and `issue_verdict` as an agent another person
claimed.

## Driving it with agent-browser and uvw

Mode: mcp.

Start every shell with `eval "$($V env)"`. Each `$V mcp`
call checks its usage event and credential leakage, and exit 5 fails the journey.
[MCP mode](../references/mcp-mode.md) lists the helper commands and their exit codes.

```bash
O=verify-$VERIFY_UVW_RUN
```

### MI13. Judge the whole task in the acceptance panel

The run user O claims an agent A, makes it an Editor of a Team Space with three Sheets on Trunk, and assigns it an
Issue. A opens three pull requests linked to the Issue, two that change two Sheets and one that adds a Doc, and merges
them. O opens and merges a fourth linked pull request that deletes the third Sheet, Archive, and then A submits. O opens
the Issue page on its `Acceptance` view, compares every changed file before and after its merge, sees Archive as moved
to Trash with no comparison, finds no outward actions, and accepts. Then A turns on Link Sharing for a file in its own Personal Space: O, who claimed A, sees
it in the panel, and a member E sees neither the row nor the Node ID.

```bash
R="$O/acceptance-panel"
sheet() { jq -nc --arg w "$1" --arg u "$(jq -r .unit.unitId "$EVIDENCE/$2.out")" --arg c "const ws = univerAPI.getActiveWorkbook().getActiveSheet(); $3" '{worktree:$w,unit:$u,code:$c}'; }
$V cli mip-repo repo create acceptance-panel --name "Acceptance panel" --json id,fullName
T=$(jq -r .id "$EVIDENCE/mip-repo.out")
$V mcp mip-seed pr_create "{\"repo\":\"$R\",\"title\":\"Seed\"}"
W0=$(jq -r .id "$EVIDENCE/mip-seed.out"); N0=$(jq -r .number "$EVIDENCE/mip-seed.out")
$V mcp mip-budget unit_create "{\"worktree\":\"$W0\",\"space\":\"$R\",\"type\":\"sheet\",\"name\":\"Budget\"}"
$V mcp mip-regions unit_create "{\"worktree\":\"$W0\",\"space\":\"$R\",\"type\":\"sheet\",\"name\":\"Regions\"}"
$V mcp mip-archive unit_create "{\"worktree\":\"$W0\",\"space\":\"$R\",\"type\":\"sheet\",\"name\":\"Archive\"}"
$V mcp mip-budget-seed execute "$(sheet "$W0" mip-budget 'ws.getRange("A1:B3").setValues([["Item","Budget"],["Rent",3000],["Marketing",2500]]);')"
$V mcp mip-regions-seed execute "$(sheet "$W0" mip-regions 'ws.getRange("A1:A3").setValues([["Region"],["North"],["South"]]);')"
$V mcp mip-seed-ready pr_ready "{\"repo\":\"$R\",\"number\":\"$N0\"}"
$V mcp mip-seed-merge pr_merge "{\"repo\":\"$R\",\"number\":\"$N0\"}"
$V principal panel mip-a
A=$(jq -r .agent.username "$EVIDENCE/principal-panel.json")
$V mcp --as panel mip-claim claim '{}'
```

Open the `claimUrl` from `mip-claim.out` in the run browser, signed in as O, and click `Claim agent`. Replace the code in
`mip-claim.*` as [MH1](agent-handoff.md#mh1-unclaimed-agent) says. Wait 35 s for the gateway's
cache. Create member E in a second browser session: with `AGENT_BROWSER_SESSION=verify-uvw-$VERIFY_UVW_RUN-e`, pin the
language and view as [the skill](../SKILL.md#drive) does, open `/login`, click the `Create account` mode button, fill
`Username` with `mip-e-$VERIFY_UVW_RUN`, `Display name` and `Password`, and submit. Then:

```bash
E="mip-e-$VERIFY_UVW_RUN"
$V cli mip-member repo member add "$A" --role editor -R "$R" --json
$V cli mip-member-e repo member add "$E" --role viewer -R "$R" --json
$V cli mip-issue issue create -R "$R" -t "Raise Marketing, add West, write a summary" -b "Raise Marketing to 4000 in Budget, add the West region to Regions, and add a Summary Doc." -a "$A" --json number
N=$(jq -r .number "$EVIDENCE/mip-issue.out")
pull() {
  $V mcp --as panel "mip-pr-$1" pr_create "$(jq -nc --arg r "$R" --arg t "$2" --argjson n "$N" '{repo:$r,title:$t,issue:$n}')" >/dev/null
  jq -r .id "$EVIDENCE/mip-pr-$1.out"
}
ready_merge() {
  local n; n=$(jq -r .number "$EVIDENCE/mip-pr-$1.out")
  $V mcp --as panel "mip-ready-$1" pr_ready "{\"repo\":\"$R\",\"number\":\"$n\"}"
  $V mcp --as panel "mip-merge-$1" pr_merge "{\"repo\":\"$R\",\"number\":\"$n\"}"
}
W1=$(pull budget "Raise Marketing to 4000")
$V mcp --as panel mip-add-budget unit_add "{\"worktree\":\"$W1\",\"resource\":\"$(jq -r .unit.resourceId "$EVIDENCE/mip-budget.out")\"}"
$V mcp --as panel mip-edit-budget execute "$(sheet "$W1" mip-add-budget 'ws.getRange("B3").setValue(4000);')"
ready_merge budget
W2=$(pull regions "Add the West region")
$V mcp --as panel mip-add-regions unit_add "{\"worktree\":\"$W2\",\"resource\":\"$(jq -r .unit.resourceId "$EVIDENCE/mip-regions.out")\"}"
$V mcp --as panel mip-edit-regions execute "$(sheet "$W2" mip-add-regions 'ws.getRange("A4").setValue("West");')"
ready_merge regions
W3=$(pull summary "Write the summary")
$V mcp --as panel mip-add-summary unit_create "{\"worktree\":\"$W3\",\"space\":\"$R\",\"type\":\"doc\",\"name\":\"Summary\"}"
ready_merge summary
$V mcp --as panel mip-notes-pr pr_create "{\"repo\":\"$A/personal\",\"title\":\"Notes\"}"
NP=$(jq -r .number "$EVIDENCE/mip-notes-pr.out")
$V mcp --as panel mip-notes unit_create "{\"worktree\":\"$(jq -r .id "$EVIDENCE/mip-notes-pr.out")\",\"space\":\"$A/personal\",\"type\":\"sheet\",\"name\":\"Notes\"}"
NOTES=$(jq -r .unit.nodeId "$EVIDENCE/mip-notes.out")
$V mcp --as panel mip-notes-ready pr_ready "{\"repo\":\"$A/personal\",\"number\":\"$NP\"}"
$V mcp --as panel mip-notes-merge pr_merge "{\"repo\":\"$A/personal\",\"number\":\"$NP\"}"
$V cli mip-pr-archive pr create -R "$R" -t "Remove the archive" --issue "$N" --json id,number
W4=$(jq -r .id "$EVIDENCE/mip-pr-archive.out"); N4=$(jq -r .number "$EVIDENCE/mip-pr-archive.out")
UA=$(jq -r .unit.unitId "$EVIDENCE/mip-archive.out")
$V cli mip-add-archive unit add --worktree "$W4" --resource "$(jq -r .unit.resourceId "$EVIDENCE/mip-archive.out")" --json
```

In the run browser, signed in as O, open `$ORIGIN/spaces/$T/pulls/$N4`, wait for Archive to load, and click
`Mark for deletion`. Then:

```bash
$V cli mip-ready-archive pr ready "$N4" -R "$R" --json state
$V cli mip-merge-archive pr merge "$N4" -R "$R" --json state
jq -e '.state == "merged"' "$EVIDENCE/mip-merge-archive.out"
$V mcp --as panel mip-submit issue_verdict "$(jq -nc --arg r "$R" --arg n "$N" '{repo:$r,number:$n,verdict:"submit",body:"Raised Marketing to 4000, added West, and added a Summary Doc in three pull requests."}')"
jq -e '.acceptance.kind == "submitted" and (.pullRequests | length) == 4 and all(.pullRequests[]; .state == "merged")' "$EVIDENCE/mip-submit.out"
```

In the run browser, signed in as O at 1440 × 900, note the time, open `$ORIGIN/spaces/$T/issues/$N`, and screenshot it as
`mip-panel.png`. The page opens on `Acceptance`, and the panel reads, in order: `Task` with the Issue text, A's
submission, the four pull requests, each `Merged`, A's three `opened by` and `merged by` A and `Remove the archive`
`opened by` and `merged by` O, and `Outward actions` with `None` under all three parts and the sentence about copies.
Under `Remove the archive`, Archive has no `Compare` button and reads `Deleted by this pull request and moved to Trash.`:
screenshot that card (`[data-acceptance-pull="$W4"]`) as `mip-deleted.png`, and in the same page run `agent-browser eval
"fetch('/universer-api/worktrees/$W4/units/$UA/comparison?baseMode=parent&view=merged').then((r) => r.status)"` into
`mip-deleted-comparison.txt`, which holds 409. Click `Compare` beside each other file (`[data-acceptance-pull="<id>"] li
button`), wait about 9 s, and screenshot each as `mip-compare-<budget|regions|summary>.png`: Budget's `Before merge`
has 2500 in B3 and `After merge` 4000, Regions gains West in A4, and Summary's left side is `Not present on this side`.
Click `Accept`, note the time, and record both in `mip-timing.txt`. Then:

```bash
$V mcp --as panel mip-share share "{\"node\":\"$NOTES\",\"link\":\"viewer\"}"
```

Reload O's page. A closed Issue opens on `Conversation`, so choose `Acceptance`, and screenshot `Outward actions` as
`mip-claimer.png`. At 390 × 844, check that `document.documentElement.scrollWidth` is 390, and screenshot the same part as
`mip-claimer-narrow.png` and Budget's comparison as `mip-compare-narrow.png`. In E's session, open the same page,
choose `Acceptance` and screenshot `Outward actions` as `mip-member.png`, then open
`$ORIGIN/api/spaces/$T/issues/$N/access-changes` and save the page text as `mip-member-access.json`:

```bash
jq -e '.personalSharing == null and .members == []' "$EVIDENCE/mip-member-access.json"
! grep -F "$NOTES" "$EVIDENCE/mip-member-access.json"
$V cli mip-final issue view "$N" -R "$R" --json state,stateReason,acceptance,pullRequests
jq -e '.state == "closed" and .acceptance.kind == "accepted" and (.pullRequests | length) == 4 and all(.pullRequests[]; .state == "merged")' "$EVIDENCE/mip-final.out"
AGENT_BROWSER_SESSION=verify-uvw-$VERIFY_UVW_RUN-e agent-browser close
```

Pass when every command exits as shown, the panel lists all four merged pull requests with every changed file and its
before and after, names the deleted Archive as moved to Trash with no comparison while its comparison request gets 409,
shows no outward action before the share, and accepting closes the Issue as completed. After the share, O's
panel lists `Notes Link Sharing on (Can view), set by` A under the Personal Space part, the narrow page has no
horizontal scroll and its comparison shows both sides' cells, and E's panel says `Only the assignee, the user who
claimed it, and people who may accept this Issue can see this part.` while E's response has `personalSharing: null`
and not the Notes Node ID.

### MI14. Check results in the acceptance panel

The run user O holds a Team Space with a Sales Sheet on Trunk and declares two checks in `.agents/checks.md`. A claimed
Editor agent A and a claimed Viewer agent V each open a pull request linked to one Issue, and each reports both checks
on its own ready pull request. A merges its own, and O merges V's. O's acceptance panel shows the checks after each
pull request's files: A's count, V's do not. Then O opens a third linked pull request and moves `.agents/checks.md`
to Trash, and the panel says on the open one that the repository declares no checks. Its bash blocks
run in one shell: the second uses `O`, `R`, `U` and `RES` from the first, and the browser steps use `T` and `N`. In a new
shell, set them again first:
`R="$O/acceptance-checks"; T=$(jq -r .id "$EVIDENCE/mic-repo.out"); U=$(jq -r .unit.unitId "$EVIDENCE/mic-seed-unit.out"); RES=$(jq -r .unit.resourceId "$EVIDENCE/mic-seed-unit.out"); N=$(jq -r .number "$EVIDENCE/mic-issue.out")`.

```bash
R="$O/acceptance-checks"
$V cli mic-repo repo create acceptance-checks --name "Acceptance checks" --json id,fullName
T=$(jq -r .id "$EVIDENCE/mic-repo.out")
$V cli mic-folder space node create "$R" --name .agents --json
printf '# Checks\n\n## totals-match\nB3 equals SUM(B2:B2).\n\n## header-unchanged\nRow 1 reads Region, Total.\n' > "$EVIDENCE/mic-checks.md"
$V cli mic-checks blob upload --file "$EVIDENCE/mic-checks.md" --space "$T" --parent "$(jq -r .node.nodeId "$EVIDENCE/mic-folder.out")" --name checks.md --json
$V cli mic-seed-pr pr create -R "$R" -t "Sales" --json
WS=$(jq -r .id "$EVIDENCE/mic-seed-pr.out")
$V cli mic-seed-unit unit create --worktree "$WS" --space "$R" --type sheet --name Sales --json
U=$(jq -r .unit.unitId "$EVIDENCE/mic-seed-unit.out"); RES=$(jq -r .unit.resourceId "$EVIDENCE/mic-seed-unit.out")
$V cli mic-seed-exec execute --worktree "$WS" --unit "$U" --json -e 'const ws = univerAPI.getActiveWorkbook().getActiveSheet(); ws.getRange("A1:B3").setValues([["Region","Total"],["North",40],["Sum",null]]); ws.getRange("B3").setFormula("=SUM(B2:B2)");'
$V cli mic-seed-ready pr ready "$(jq -r .number "$EVIDENCE/mic-seed-pr.out")" -R "$R" --json state
$V cli mic-seed-merge pr merge "$(jq -r .number "$EVIDENCE/mic-seed-pr.out")" -R "$R" --json state
$V principal checks-a mic-a
$V principal checks-v mic-v
$V mcp --as checks-a mic-claim-a claim '{}'
$V mcp --as checks-v mic-claim-v claim '{}'
```

Open each `claimUrl` in the run browser, signed in as O, and click `Claim agent`. Replace the codes as
[MH1](agent-handoff.md#mh1-unclaimed-agent) says. Wait 35 s for the gateway's cache. Then:

```bash
A=$(jq -r .agent.username "$EVIDENCE/principal-checks-a.json"); VA=$(jq -r .agent.username "$EVIDENCE/principal-checks-v.json")
$V cli mic-member-a repo member add "$A" --role editor -R "$R" --json
$V cli mic-member-v repo member add "$VA" --role viewer -R "$R" --json
$V cli mic-issue issue create -R "$R" -t "Raise North and add South" -b "Raise North to 50 and add a South row in Sales. Keep the totals right." -a "$A" --json number
N=$(jq -r .number "$EVIDENCE/mic-issue.out")
propose() {
  $V mcp --as "checks-$1" "mic-$1-pr" pr_create "$(jq -nc --arg r "$R" --arg t "$2" --argjson n "$N" '{repo:$r,title:$t,issue:$n}')" >/dev/null
  local w n; w=$(jq -r .id "$EVIDENCE/mic-$1-pr.out"); n=$(jq -r .number "$EVIDENCE/mic-$1-pr.out")
  $V mcp --as "checks-$1" "mic-$1-add" unit_add "{\"worktree\":\"$w\",\"resource\":\"$RES\"}"
  $V mcp --as "checks-$1" "mic-$1-exec" execute "$(jq -nc --arg w "$w" --arg u "$U" --arg c "const ws = univerAPI.getActiveWorkbook().getActiveSheet(); $3" '{worktree:$w,unit:$u,code:$c}')"
  $V mcp --as "checks-$1" "mic-$1-ready" pr_ready "{\"repo\":\"$R\",\"number\":\"$n\"}"
  for name in totals-match header-unchanged; do
    $V mcp --as "checks-$1" "mic-$1-$name" pr_check "$(jq -nc --arg r "$R" --arg n "$n" --arg c "$name" --arg s "$4" '{repo:$r,number:$n,name:$c,state:"passed",summary:$s}')"
  done
}
propose a "Raise North" 'ws.getRange("B2").setValue(50);' "A read B3 = 50 and row 1 on the draft."
$V mcp --as checks-a mic-a-merge pr_merge "{\"repo\":\"$R\",\"number\":\"$(jq -r .number "$EVIDENCE/mic-a-pr.out")\"}"
propose v "Add South" 'ws.insertRowBefore(3); ws.getRange("A3:B3").setValues([["South",30]]); ws.getRange("B4").setFormula("=SUM(B2:B3)");' "V read B4 = 80 and row 1 on the draft."
$V cli mic-o-merge pr merge "$(jq -r .number "$EVIDENCE/mic-v-pr.out")" -R "$R" --json state
for who in a v; do
  $V mcp --as "checks-$who" "mic-$who-view" pr_view "{\"repo\":\"$R\",\"number\":\"$(jq -r .number "$EVIDENCE/mic-$who-pr.out")\"}"
done
jq -e '.state == "merged" and ([.checks[] | .state] == ["passed", "passed"]) and all(.checks[].results[]; .current and .counts)' "$EVIDENCE/mic-a-view.out"
jq -e '.state == "merged" and ([.checks[] | .state] == ["missing", "missing"]) and all(.checks[].results[]; .current and (.counts | not))' "$EVIDENCE/mic-v-view.out"
```

A merges before V adds Sales, so A's merge does not leave V's results out of date. In the run browser, signed in as O
at 1440 × 900, open `$ORIGIN/spaces/$T/issues/$N`, choose `Acceptance`, and screenshot the page as `mic-panel.png`. At
1440 × 1500, screenshot the `Pull requests` section (`section[aria-label="Pull requests"].grid`) as `mic-checks.png`. Each card lists Sales with
`Compare`, then `Checks at merge`. `Add South` shows `totals-match` and `header-unchanged` each `Missing`, with
`mic-v · Passed · Does not count ·` and V's summary. `Raise North` shows both `Passed`, with `mic-a · Passed ·` and A's
summary and no label. At 390 × 844, check that `document.documentElement.scrollWidth` is 390. At 390 × 2300, screenshot
the section as `mic-checks-narrow.png`. Back at 1440 × 1500:

```bash
$V cli mic-open pr create -R "$R" -t "Add East" --issue "$N" --json number
$V cli mic-trash-checks space node trash "$(jq -r .upload.nodeId "$EVIDENCE/mic-checks.out")" --json
```

Reload, choose `Acceptance`, and screenshot the section as `mic-none-declared.png`. The open `Add East` card reads `This
repository declares no checks in .agents/checks.md.` under `Checks`, and both merged cards still show their `Checks at
merge` as before.

Pass when every command exits as shown, both `jq` checks hold, the first screenshots label A's results as counting and
V's as `Does not count` under the right pull request, the narrow page has no horizontal scroll, and the last screenshot
says on the open pull request that the repository declares no checks while both merged ones keep their checks.

### MI17. An acceptor who did not claim the agent

The run user O owns a Team Space and assigns an Issue to an agent A that another person C claimed. After the
assignment, A shares a Sheet in its own Personal Space by link and submits. O may accept the Issue but did not claim A,
so the Issue's `Acceptance` view shows O the share by name, kind and time, with no way to open the file, and O's
response holds no Node ID, Resource ID or URL for it. C, a Viewer who may not accept, gets the same row in full.

```bash
R="$O/claimer-summary"
$V cli mis-repo repo create claimer-summary --name "Claimer summary" --json id,fullName
T=$(jq -r .id "$EVIDENCE/mis-repo.out")
$V principal sharer mis-a
A=$(jq -r .agent.username "$EVIDENCE/principal-sharer.json")
$V mcp --as sharer mis-claim claim '{}'
```

Create C in a second browser session as MI13 creates E, with `AGENT_BROWSER_SESSION=verify-uvw-$VERIFY_UVW_RUN-c` and
username `mis-c-$VERIFY_UVW_RUN`. In C's session, open the `claimUrl` from `mis-claim.out` and click `Claim agent`.
Replace the code in `mis-claim.*` as [MH1](agent-handoff.md#mh1-unclaimed-agent) says. Wait 35 s for the gateway's
cache. Then:

```bash
C="mis-c-$VERIFY_UVW_RUN"
$V cli mis-member repo member add "$A" --role editor -R "$R" --json
$V cli mis-member-c repo member add "$C" --role viewer -R "$R" --json
$V cli mis-issue issue create -R "$R" -t "Draft the regional notes" -a "$A" --json number
N=$(jq -r .number "$EVIDENCE/mis-issue.out")
$V mcp --as sharer mis-notes-pr pr_create "{\"repo\":\"$A/personal\",\"title\":\"Notes\"}"
NP=$(jq -r .number "$EVIDENCE/mis-notes-pr.out")
$V mcp --as sharer mis-notes unit_create "{\"worktree\":\"$(jq -r .id "$EVIDENCE/mis-notes-pr.out")\",\"space\":\"$A/personal\",\"type\":\"sheet\",\"name\":\"Regional notes\"}"
NOTES=$(jq -r .unit.nodeId "$EVIDENCE/mis-notes.out"); RES=$(jq -r .unit.resourceId "$EVIDENCE/mis-notes.out")
$V mcp --as sharer mis-notes-ready pr_ready "{\"repo\":\"$A/personal\",\"number\":\"$NP\"}"
$V mcp --as sharer mis-notes-merge pr_merge "{\"repo\":\"$A/personal\",\"number\":\"$NP\"}"
$V mcp --as sharer mis-share share "{\"node\":\"$NOTES\",\"link\":\"viewer\"}"
$V mcp --as sharer mis-submit issue_verdict "$(jq -nc --arg r "$R" --arg n "$N" '{repo:$r,number:$n,verdict:"submit",body:"Drafted the regional notes in my Personal Space and shared them by link."}')"
jq -e '.acceptance.kind == "submitted"' "$EVIDENCE/mis-submit.out"
```

In the run browser, signed in as O at 1440 × 1500, open `$ORIGIN/spaces/$T/issues/$N`. The page opens on `Acceptance`.
Under `Outward actions`, the part `Sharing the assignees turned on in their own Personal Spaces after their assignment`
lists `Regional notes Link Sharing on (Can view), set by` A's display name with a time, followed by `1 change. Only the
assignee and the user who claimed it can open this file.` Screenshot `Outward actions` as `mis-owner.png`. Run
`agent-browser eval "document.querySelectorAll('section[aria-label=\"Outward actions\"] a').length"` into
`mis-owner-links.txt`, which holds 0. At 390 × 2300, check that `document.documentElement.scrollWidth` is 390 and
screenshot the same part as `mis-owner-narrow.png`. Open `$ORIGIN/api/spaces/$T/issues/$N/access-changes` and save the
page text as `mis-owner-access.json`. In C's session, open the same URL and save it as `mis-claimer-access.json`. Then:

```bash
jq -e '.personalSharing.truncated == false and (.personalSharing.items | length) == 1' "$EVIDENCE/mis-owner-access.json"
jq -e '.personalSharing.items[0] | .kind == "link" and .node == {name: "Regional notes"} and .role == "viewer" and .enabled' "$EVIDENCE/mis-owner-access.json"
! grep -E -e "$NOTES" -e "$RES" -e 'https?://' -e '/nodes/' "$EVIDENCE/mis-owner-access.json"
jq -e --arg n "$NOTES" '(.personalSharing.items | length) == 1 and .personalSharing.items[0].node == {id: $n, name: "Regional notes"}' "$EVIDENCE/mis-claimer-access.json"
AGENT_BROWSER_SESSION=verify-uvw-$VERIFY_UVW_RUN-c agent-browser close
```

Pass when every command exits as shown, O's panel names Regional notes with its Link Sharing, A and a time but no link
at both widths, the narrow page has no horizontal scroll, O's response holds the row without the Node ID, the Resource ID
or any URL, and C's response holds the same row with the Node ID.

### MI16. Revert an Issue's merged pull requests

The run user O holds a Team Space with Sheets North, South and Old and a Doc Notes, declares two checks in
`.agents/checks.md`, and makes a claimed agent A and a person E Editors there. For an Issue assigned to A, A merges one
pull request that changes North and South and one that changes Notes and adds a Doc, Summary, each after reporting both
checks passed, and O merges a third that deletes Old. A submits and O accepts. E then edits
South on Trunk. In the Issue's `Acceptance` view, O reviews the revert: Old comes back, Notes and North go back, South
is blocked and names E, and Summary goes to Trash. O reverts without overwriting, and the Issue reopens with the verdict
`reverted`. Both of A's pull requests still show their checks as passed at merge, though Summary is in Trash. O reviews again and overwrites South alone. Then A reverts its own second Issue with `pr_revert`: its change
goes back, a file E edited after the merge stays blocked, and A cannot overwrite it.

```bash
R="$O/revert-story"
sheet() { jq -nc --arg w "$1" --arg u "$2" --arg c "const ws = univerAPI.getActiveWorkbook().getActiveSheet(); $3" '{worktree:$w,unit:$u,code:$c}'; }
unit() { jq -r .unit.unitId "$EVIDENCE/mrv-$1.out"; }
res() { jq -r .unit.resourceId "$EVIDENCE/mrv-$1.out"; }
cell() { jq -r --arg r "$2" '.json.cells[] | select(.ref == $r) | .value' "$EVIDENCE/$1.out"; }
$V cli mrv-repo repo create revert-story --name "Revert story" --json id,fullName
T=$(jq -r .id "$EVIDENCE/mrv-repo.out")
$V cli mrv-folder space node create "$R" --name .agents --json
printf '# Checks\n\n## totals-match\nNorth and South B2 hold the new totals.\n\n## summary-written\nNotes and Summary say what changed.\n' > "$EVIDENCE/mrv-checks.md"
$V cli mrv-checks blob upload --file "$EVIDENCE/mrv-checks.md" --space "$T" --parent "$(jq -r .node.nodeId "$EVIDENCE/mrv-folder.out")" --name checks.md --json
$V mcp mrv-seed pr_create "{\"repo\":\"$R\",\"title\":\"Seed\"}"
W0=$(jq -r .id "$EVIDENCE/mrv-seed.out"); N0=$(jq -r .number "$EVIDENCE/mrv-seed.out")
for name in North South Old; do
  $V mcp "mrv-$name" unit_create "{\"worktree\":\"$W0\",\"space\":\"$R\",\"type\":\"sheet\",\"name\":\"$name\"}"
done
$V mcp mrv-Notes unit_create "{\"worktree\":\"$W0\",\"space\":\"$R\",\"type\":\"doc\",\"name\":\"Notes\"}"
$V mcp mrv-north-seed execute "$(sheet "$W0" "$(unit North)" 'ws.getRange("A1:B2").setValues([["Region","Total"],["North",40]]);')"
$V mcp mrv-south-seed execute "$(sheet "$W0" "$(unit South)" 'ws.getRange("A1:B2").setValues([["Region","Total"],["South",10]]);')"
$V mcp mrv-notes-seed execute "$(jq -nc --arg w "$W0" --arg u "$(unit Notes)" '{worktree:$w,unit:$u,code:"doc.getParagraphs()[0].setText(\"Draft notes\");"}')"
$V mcp mrv-seed-ready pr_ready "{\"repo\":\"$R\",\"number\":\"$N0\"}"
$V mcp mrv-seed-merge pr_merge "{\"repo\":\"$R\",\"number\":\"$N0\"}"
$V principal reverter mrv-a
A=$(jq -r .agent.username "$EVIDENCE/principal-reverter.json")
$V mcp --as reverter mrv-claim claim '{}'
```

Open the `claimUrl` from `mrv-claim.out` in the run browser, signed in as O, and click `Claim agent`. Replace the code in
`mrv-claim.*` as [MH1](agent-handoff.md#mh1-unclaimed-agent) says. Wait 35 s for the gateway's
cache. Create E in a second browser session as MI13 does, with username `mrv-e-$VERIFY_UVW_RUN` and display name
`Erin`. Then:

```bash
E="mrv-e-$VERIFY_UVW_RUN"
$V cli mrv-member repo member add "$A" --role editor -R "$R" --json
$V cli mrv-member-e repo member add "$E" --role editor -R "$R" --json
$V cli mrv-issue issue create -R "$R" -t "Raise the totals and write a summary" -b "Raise North to 50 and South to 20, finish the notes, and add a Summary Doc." -a "$A" --json number
N=$(jq -r .number "$EVIDENCE/mrv-issue.out")
pull() {
  $V mcp --as reverter "mrv-pr-$1" pr_create "$(jq -nc --arg r "$R" --arg t "$2" --argjson n "$3" '{repo:$r,title:$t,issue:$n}')" >/dev/null
  jq -r .id "$EVIDENCE/mrv-pr-$1.out"
}
ready_merge() {
  local n name; n=$(jq -r .number "$EVIDENCE/mrv-pr-$1.out")
  $V mcp --as reverter "mrv-ready-$1" pr_ready "{\"repo\":\"$R\",\"number\":\"$n\"}"
  for name in totals-match summary-written; do
    $V mcp --as reverter "mrv-check-$1-$name" pr_check "$(jq -nc --arg r "$R" --arg n "$n" --arg c "$name" '{repo:$r,number:$n,name:$c,state:"passed",summary:"Read back on the draft."}')"
  done
  $V mcp --as reverter "mrv-merge-$1" pr_merge "{\"repo\":\"$R\",\"number\":\"$n\"}"
}
W1=$(pull totals "Raise the totals" "$N")
for name in North South; do
  $V mcp --as reverter "mrv-add-$name" unit_add "{\"worktree\":\"$W1\",\"resource\":\"$(res "$name")\"}"
done
$V mcp --as reverter mrv-edit-north execute "$(sheet "$W1" "$(unit North)" 'ws.getRange("B2").setValue(50);')"
$V mcp --as reverter mrv-edit-south execute "$(sheet "$W1" "$(unit South)" 'ws.getRange("B2").setValue(20);')"
ready_merge totals
W2=$(pull summary "Finish the notes and write the summary" "$N")
$V mcp --as reverter mrv-add-Notes unit_add "{\"worktree\":\"$W2\",\"resource\":\"$(res Notes)\"}"
$V mcp --as reverter mrv-edit-notes execute "$(jq -nc --arg w "$W2" --arg u "$(unit Notes)" '{worktree:$w,unit:$u,code:"doc.getParagraphs()[0].setText(\"Final notes\");"}')"
$V mcp --as reverter mrv-Summary unit_create "{\"worktree\":\"$W2\",\"space\":\"$R\",\"type\":\"doc\",\"name\":\"Summary\"}"
ready_merge summary
$V cli mrv-pr-old pr create -R "$R" -t "Remove Old" --issue "$N" --json id,number
N3=$(jq -r .number "$EVIDENCE/mrv-pr-old.out")
$V cli mrv-add-old unit add --worktree "$(jq -r .id "$EVIDENCE/mrv-pr-old.out")" --resource "$(res Old)" --json
```

In the run browser, signed in as O at 1440 × 900, open `$ORIGIN/spaces/$T/pulls/$N3`, click the `Files changed 1` link,
wait for Old to load, and click `Mark for deletion`. The file list then reads `Old Deleted`. Then:

```bash
$V cli mrv-ready-old pr ready "$N3" -R "$R" --json state
$V cli mrv-merge-old pr merge "$N3" -R "$R" --json state
$V mcp --as reverter mrv-submit issue_verdict "$(jq -nc --arg r "$R" --arg n "$N" '{repo:$r,number:$n,verdict:"submit",body:"Raised North and South, finished the notes and added a Summary Doc."}')"
$V cli mrv-accept issue accept "$N" -R "$R"
$V cli mrv-closed issue view "$N" -R "$R" --json state,acceptance
jq -e '.state == "closed" and .acceptance.kind == "accepted"' "$EVIDENCE/mrv-closed.out"
```

In E's session, open `$ORIGIN/nodes/<nodeId in mrv-South.out>`, wait 9 s for the grid, type `E note` into the selected
cell A1 and press `Enter`. Then:

```bash
$V cli mrv-e-edited read A1:B2 --unit "$(unit South)" --trunk --json
test "$(cell mrv-e-edited A1)" = "E note"
```

In the run browser, open `$ORIGIN/spaces/$T/issues/$N`. A closed Issue opens on `Conversation`, so click `Acceptance`,
then `Review revert` at the bottom, and screenshot the section (`[data-revert-panel]`) as `mrv-plan.png`. It lists, in
order, Old `Restore from Trash`, Notes and North `Back to before the merge`, each `Ready`, South `Back to before the
merge` `Edited after the merge` with `Edited on Trunk after this task's merge. Reverting would overwrite those edits.`
and `Erin edited it once after, Today <time>`, Summary `Move to Trash` `Ready`, one `Overwrite these edits` checkbox,
under South, and `What a revert cannot undo` with five lines. At 390 × 844, open the plan the same way, check that
`document.documentElement.scrollWidth` is 390, and screenshot the section as `mrv-plan-narrow.png`. Back at 1440 × 900,
leave the checkbox clear, click the section's `Revert` (`find role button click --name Revert --exact`), screenshot
the dialog as `mrv-confirm.png`, and confirm (`click 'div[role=alertdialog] button:last-of-type'`). The toast reads
`Reverted, except the files the list explains.`, and the list shows Old, Notes, North and Summary `Done` and South
still `Edited after the merge`: screenshot `mrv-done.png`. Then:

```bash
$V cli mrv-after-north read A1:B2 --unit "$(unit North)" --trunk --json
test "$(cell mrv-after-north B2)" = 40
$V cli mrv-after-south read A1:B2 --unit "$(unit South)" --trunk --json
test "$(cell mrv-after-south A1)" = "E note" && test "$(cell mrv-after-south B2)" = 20
$V cli mrv-after-notes inspect document --unit "$(unit Notes)" --trunk --json
jq -e '[.paragraphs[].textPreview] == ["Draft notes"]' "$EVIDENCE/mrv-after-notes.out"
$V cli mrv-after-tree space browse "$R" --json
jq -e '[.. | objects | select(.name? != null and .nodeId? != null) | .name] | unique == [".agents","North","Notes","Old","South"]' "$EVIDENCE/mrv-after-tree.out"
$V cli mrv-after-issue issue view "$N" -R "$R" --json state,acceptance
jq -e '.state == "open" and .acceptance.kind == "reverted"' "$EVIDENCE/mrv-after-issue.out"
for pr in totals summary; do
  $V cli "mrv-after-pr-$pr" pr view "$(jq -r .number "$EVIDENCE/mrv-pr-$pr.out")" -R "$R" --json capabilities,units,checks
done
$V cli mrv-after-pr-old pr view "$N3" -R "$R" --json capabilities,units,checks
jq -e '.capabilities.review and ([.units[] | [.name, .fileState]] == [["North","live"],["South","live"]])' "$EVIDENCE/mrv-after-pr-totals.out"
jq -e '.capabilities.review and ([.units[] | [.name, .fileState]] == [["Notes","live"],["Summary","inTrash"]])' "$EVIDENCE/mrv-after-pr-summary.out"
jq -e '.capabilities.review and ([.units[] | [.name, .fileState]] == [["Old","live"]])' "$EVIDENCE/mrv-after-pr-old.out"
jq -e '.checks == {"passed":2,"failed":0,"missing":0,"atMerge":true}' "$EVIDENCE/mrv-after-pr-totals.out"
jq -e '.checks == {"passed":2,"failed":0,"missing":0,"atMerge":true}' "$EVIDENCE/mrv-after-pr-summary.out"
jq -e '.checks == {"passed":0,"failed":0,"missing":2,"atMerge":true}' "$EVIDENCE/mrv-after-pr-old.out"
$V mcp mrv-after-view-summary pr_view "{\"repo\":\"$R\",\"number\":\"$(jq -r .number "$EVIDENCE/mrv-pr-summary.out")\"}"
jq -e '[.checks[] | [.name, .state, .atMerge, ([.results[] | select(.counts)] | length)]] == [["totals-match","passed",true,1],["summary-written","passed",true,1]]' "$EVIDENCE/mrv-after-view-summary.out"
```

Reload the Issue page on `Acceptance` at 1440 × 1500. Every pull request lists its files: `Raise the totals` North and
South, `Finish the notes and write the summary` Notes and Summary, and `Remove Old` Old. No pull request reads `You may
not see this pull request's files.` Summary reads `This file is now in Trash.` and has no `Compare`, and North, South
and Notes each have `Compare`. After the files of each of A's pull requests, `Checks at merge` lists `totals-match` and
`summary-written`, each `Passed`, with A's result counting; `Remove Old` lists both `Missing` under `Checks at merge`.
Screenshot the pull requests (`find text "Pull requests"` scrolled into view) as
`mrv-panel-after.png`. At 390 × 2300, reload, check that `document.documentElement.scrollWidth` is 390, and screenshot
`mrv-panel-after-narrow.png` with the same files, note and checks.

Choose `Conversation`, scroll to the end and screenshot `mrv-timeline.png`: the sidebar reads `Acceptance` `Reverted`,
and the timeline ends with `reopened this` and `reverted the merged changes`. Choose `Acceptance` and click `Review
revert` again. Old reads `Done` with `This file is already back from Trash.`, Summary `Unavailable`, and Notes and North
are now `Edited after the merge` by O, because the first revert is a Trunk revision after the merge. Check `Overwrite
these edits` under South only (`[data-revert-panel] > ul > li:nth-of-type(4) input[type=checkbox]`), click `Revert`,
screenshot the dialog as `mrv-force-confirm.png` (it ends `The file you chose to overwrite loses its edits after the
merge.`), confirm, and screenshot `mrv-force-done.png`, where South is `Done`. E's open South now shows `Document
Restored to a Previous Version` with `Refresh page`: screenshot E's session as `mrv-e-open-after-force.png`. Then:

```bash
$V cli mrv-forced-south read A1:B2 --unit "$(unit South)" --trunk --json
test "$(cell mrv-forced-south A1)" = Region && test "$(cell mrv-forced-south B2)" = 10
```

Now A reverts its own work on a second Issue:

```bash
$V cli mrv-issue-2 issue create -R "$R" -t "Raise North and South again" -b "Raise North to 70 and South to 30." -a "$A" --json number
N2=$(jq -r .number "$EVIDENCE/mrv-issue-2.out")
W4=$(pull raise "Raise North and South again" "$N2")
for name in North South; do
  $V mcp --as reverter "mrv-add2-$name" unit_add "{\"worktree\":\"$W4\",\"resource\":\"$(res "$name")\"}"
done
$V mcp --as reverter mrv-edit2-north execute "$(sheet "$W4" "$(unit North)" 'ws.getRange("B2").setValue(70);')"
$V mcp --as reverter mrv-edit2-south execute "$(sheet "$W4" "$(unit South)" 'ws.getRange("B2").setValue(30);')"
ready_merge raise
```

In E's session, open South again and type `E again` into A1 the same way. Then:

```bash
$V mcp-tools --as reverter --toolsets core,admin mrv-a-tools
jq -e '[.. | objects | select(.name? == "pr_revert")][0].inputSchema.properties | keys == ["apply","issue","number","repo"]' "$EVIDENCE/mrv-a-tools.out"
$V mcp --as reverter --toolsets core,admin mrv-a-plan pr_revert "{\"repo\":\"$R\",\"issue\":\"$N2\"}"
jq -e --arg e "$E" '.applied == false and .canRevert and ([.items[] | [.name, .state]] == [["North","ready"],["South","blocked"]]) and .items[1].laterEdits[0].user.username == $e' "$EVIDENCE/mrv-a-plan.out"
$V mcp --as reverter --toolsets core,admin mrv-a-apply pr_revert "{\"repo\":\"$R\",\"issue\":\"$N2\",\"apply\":true}"
jq -e '.applied and .operation.state == "completed" and ([.items[] | [.name, .state]] == [["North","done"],["South","blocked"]])' "$EVIDENCE/mrv-a-apply.out"
$V mcp --as reverter --toolsets core,admin mrv-a-again pr_revert "{\"repo\":\"$R\",\"issue\":\"$N2\",\"apply\":true}"
test $? -eq 1
jq -e '.code == "CONFLICT" and (.message | endswith("A person can overwrite those edits in the browser."))' "$EVIDENCE/mrv-a-again.out"
$V cli mrv-after-agent-south read A1:B2 --unit "$(unit South)" --trunk --json
test "$(cell mrv-after-agent-south A1)" = "E again" && test "$(cell mrv-after-agent-south B2)" = 30
$V cli mrv-after-agent-issue issue view "$N2" -R "$R" --json acceptance
jq -e --arg a "$A" '.acceptance.kind == "reverted" and .acceptance.actor.username == $a' "$EVIDENCE/mrv-after-agent-issue.out"
$V cli mrv-cli-plan pr revert "$(jq -r .number "$EVIDENCE/mrv-pr-raise.out")" -R "$R"
grep -qx 'Plan only; run again with --yes to revert.' "$EVIDENCE/mrv-cli-plan.out"
$V cli mrv-cli-yes pr revert --issue "$N" -R "$R" --yes
test $? -eq 1
grep -q '^CONFLICT: Every file left to revert was edited after the merge' "$EVIDENCE/mrv-cli-yes.err"
$V cli mrv-landing-checks repo edit "$R" --landing checks --json landing
$V mcp --as reverter --toolsets core,admin mrv-a-gated pr_revert "{\"repo\":\"$R\",\"issue\":\"$N2\",\"apply\":true}"
test $? -eq 1
jq -e '.code == "AGENT_NOT_ALLOWED" and (.message | startswith("A revert changes Trunk without a merge."))' "$EVIDENCE/mrv-a-gated.out"
$V cli mrv-landing-review repo edit "$R" --landing review --json landing
AGENT_BROWSER_SESSION=verify-uvw-$VERIFY_UVW_RUN-e agent-browser close
```

Open the merged pull request `$ORIGIN/spaces/$T/pulls/<number in mrv-pr-raise.out>`, click `Review revert` and
screenshot `mrv-pr-page.png`: its `Revert` section lists North and South.

Pass when every command exits as shown: the plan names Erin on South with a time today and lists each file once with its
action, the narrow page has no horizontal scroll, the first revert brings Old back, Notes and North back to their
content before the task and Summary into Trash while South keeps E's edit, the Issue reopens with `reverted`, every
pull request still lists its files to O after the revert with Summary noted as in Trash at both widths, A's pull
requests show both checks passed at merge in uvw, MCP and the panel at both widths, the
overwrite returns South to its content before the task, the agent's `pr_revert` has no force argument, restores North,
leaves South blocked with E's edit and is told only a person can overwrite it, the agent's revert is refused while the
repository requires checks, and the second Issue's verdict is `reverted` by A.

## Gotchas

- The MCP-mode gotchas in [MCP gateway](mcp.md#gotchas) apply.
- In MI16, a uvw daemon that already loaded a Doc can fail its first `inspect document --trunk` after a revert with
  `COLLABORATION_PROTOCOL_ERROR: Historical restore requires reloading the Unit and cannot be pulled in place`. The
  next call loads the Unit again and reads the restored content.
