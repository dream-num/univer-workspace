# Agent Mode: forks

An agent forks a Team repository it may propose to. The fork is its own view of the whole repository, named
`<owner>/<name>`, and stores nothing. Every file the fork has not changed reads the upstream Trunk as it is now. The
fork's first write opens one pull request in the upstream and adds the file at the Trunk revision of that moment. A fork has at most
one open pull request, takes no writes while that one is ready until it is reopened, and opens a new one after a
merge. An agent removed from a private upstream can no longer read or write anything of it through its fork. Deleting
a fork changes nothing upstream, and its pull requests stay there.

## Sub-features

- FK1 has a claimed Viewer agent fork a private repository. The fork is `clean`, listed and viewed by address and by
  ID, created again with the same name as the same fork, and lists every folder and file of the upstream with the
  same Node, Resource and Unit IDs, while the upstream and the agent's repositories gain nothing.
- FK2 reads a file through the fork after the owner changed it on Trunk. The read returns Trunk's new revision and
  opens no pull request.
- FK3 writes a file through the fork. The write opens one private draft pull request by the agent, which holds that
  file alone, with the upstream's Unit ID and the Trunk revision of the write as its baseline. Reads through the fork
  see the change, the other files still read Trunk, and Trunk is unchanged.
- FK4 has a second fork take two first writes at once. One pull request holds both files, and each fork reads its
  own changes.
- FK5 readies the first fork's pull request. The server refuses that fork's writes with `FORK_WORKTREE_NOT_DRAFT`
  while the second fork still takes them, and after `pr_ready` with `undo` the same pull request takes them again. The owner merges
  it, each file's result is recorded, and the fork is `clean`.
- FK6 deletes a fork whose second pull request is ready. The upstream's files and Trunk do not change, the merged
  pull request keeps its history, and the ready one stays an ordinary pull request the owner merges.
- FK7 removes the agent from the repository. Through its fork it can no longer browse, list, read or write anything
  of the upstream, nor reach its open pull request by ID, and each refusal is one `FORBIDDEN` that names the fork and
  the way out. Once the repository is public with `proposals` `members`, it reads through the fork again and every
  write through the fork, by address or by ID, gets the same refusal.
- FK8 drives `uvw fork create`, `list`, `view` and `delete` as a person, whose write through the fork opens a pull
  request that stays after the delete.

## How to get to it (user POV)

An MCP client calls `fork_create`, `fork_list`, `fork_view` and `fork_delete`, and passes the fork address as `repo`
to `space_browse` and as `worktree` to `read`, `execute` and `unit_list`. It readies and reopens the fork's pull
request with `pr_ready`, using `worktree.number` from `fork_view`. A person runs `uvw fork create|list|view|delete`,
manages members with `uvw repo member add|remove`, and changes visibility with `uvw repo edit`. Adding a member and
making a repository public need the person's browser session, so the setup runs them as `$V person`.

## Driving it with agent-browser and uvw

Mode: mcp.

Start every shell with `eval "$($V env)"`. Each `$V mcp`
call checks its usage event and credential leakage, and exit 5 fails the journey.
[MCP mode](../references/mcp-mode.md) lists the helper commands and their exit codes. The run user O holds the
repository `S`, and the agent A speaks through `$V mcp --as forker`. `put` has A set `Data!B2` of a Sheet through a
fork or a Worktree, and `b2` has A read it:

```bash
O=verify-$VERIFY_UVW_RUN; S="$O/fork-base"
put(){ # label fork-or-worktree unit value
  $V mcp --as forker "$1" execute "$(jq -nc --arg w "$2" --arg u "$3" --arg v "$4" '{worktree:$w,unit:$u,code:("const r = univerAPI.getActiveWorkbook().getSheetByName(\"Data\").getRange(\"B2\"); r.setValue(" + $v + "); return r.getValue();")}')"
}
b2(){ # label fork-or-worktree unit
  $V mcp --as forker "$1" read "$(jq -nc --arg w "$2" --arg u "$3" '{worktree:$w,unit:$u,range:"Data!B2",json:true}')"
}
```

### FK1. An agent forks the whole repository, and the fork copies nothing

Run: helper.

O creates the private repository S with the Sheets `North` and `South` at its root and `East` in the folder
`archive`, each with `Data!B2` `10`, `20` and `30`, through one merged pull request:

```bash
$V cli fk-repo repo create fork-base --name "Fork base" --json id,fullName
$V cli fk-folder space node create "$S" --name archive --json
$V cli fk-seed-pr pr create -R "$S" -t Regions --json
HW=$(jq -r .id "$EVIDENCE/fk-seed-pr.out"); HN=$(jq -r .number "$EVIDENCE/fk-seed-pr.out")
seed(){ # name value [unit create options]
  $V cli "fk-seed-$1" unit create --worktree "$HW" --space "$S" --type sheet --name "$1" "${@:3}" --json
  $V cli "fk-seed-$1-data" execute --worktree "$HW" --unit "$(jq -r .unit.unitId "$EVIDENCE/fk-seed-$1.out")" --json \
    -e "const ws = univerAPI.getActiveWorkbook().getActiveSheet(); ws.setName(\"Data\"); ws.getRange(\"A1:B2\").setValues([[\"Region\",\"Total\"],[\"$1\",$2]]);"
}
seed North 10
seed South 20
seed East 30 --parent "$(jq -r .node.nodeId "$EVIDENCE/fk-folder.out")"
$V cli fk-seed-ready pr ready "$HN" -R "$S" --json state
$V cli fk-seed-merge pr merge "$HN" -R "$S" --json state
NORTH=$(jq -r .unit.unitId "$EVIDENCE/fk-seed-North.out"); NRES=$(jq -r .unit.resourceId "$EVIDENCE/fk-seed-North.out")
SOUTH=$(jq -r .unit.unitId "$EVIDENCE/fk-seed-South.out"); EAST=$(jq -r .unit.unitId "$EVIDENCE/fk-seed-East.out")
$V cli fk-o-before space browse "$S" --recursive --json
```

O claims a new agent A with the request the claim page sends, `POST /api/agents/claim` on O's browser session
([HO4](agent-handoff.md#ho4-claim-ah6) drives the page), and adds A as a Viewer. The claim link is used at once and
kept out of the log:

```bash
jq -nc --arg u "$O" --rawfile p "$RUN/user.pw" '{username:$u,password:($p|rtrimstr("\n"))}' \
  | curl --fail-with-body -sS -c "$RUN/home/fk-o.cookies" -o /dev/null -H 'content-type: application/json' -H "Origin: $ORIGIN" -d @- "$ORIGIN/api/auth/password/login"
$V principal forker fk-a
A=$(jq -r .agent.username "$EVIDENCE/principal-forker.json"); F="$A/base"
$V mcp --as forker fk-claim claim '{}' > /dev/null
jq -nc --arg c "$(jq -r .claimUrl "$EVIDENCE/fk-claim.out" | sed 's#.*/claim/##')" '{code:$c}' \
  | curl --fail-with-body -sS -b "$RUN/home/fk-o.cookies" -o "$EVIDENCE/fk-claimed.json" -H 'content-type: application/json' -H "Origin: $ORIGIN" -d @- "$ORIGIN/api/agents/claim"
perl -pi -e 's{/claim/[A-Za-z0-9_-]{22}(?![A-Za-z0-9_-])}{/claim/[REDACTED]}g' "$EVIDENCE"/fk-claim.*
$V person fk-member repo member add "$A" --role viewer -R "$S" --json
$V mcp --as forker fk-role repo_view "{\"repo\":\"$S\"}"
jq -e '.accessRole == "viewer" and .capabilities.propose and .publicRead == false' "$EVIDENCE/fk-role.out"
```

A forks S, creates the same fork again, and views and lists it. It reads North's Trunk revision, browses the fork
and S, and lists its repositories:

```bash
$V mcp --as forker fk-fork fork_create "{\"repo\":\"$S\",\"name\":\"base\"}"
jq -e --arg f "$F" --arg s "$S" '.fullName == $f and .state == "clean" and .worktree == null and .upstream.fullName == $s and .upstream.accessRole == "viewer"' "$EVIDENCE/fk-fork.out"
FID=$(jq -r .id "$EVIDENCE/fk-fork.out")
$V mcp --as forker fk-fork-again fork_create "{\"repo\":\"$S\",\"name\":\"base\"}"
$V mcp --as forker fk-view fork_view "{\"fork\":\"$F\"}"
$V mcp --as forker fk-view-id fork_view "{\"fork\":\"$FID\"}"
for label in fk-fork-again fk-view fk-view-id; do
  jq -e --arg id "$FID" '.id == $id and .state == "clean"' "$EVIDENCE/$label.out"
done
$V mcp --as forker fk-list fork_list '{}'
jq -e --arg f "$F" '[.forks[].fullName] == [$f]' "$EVIDENCE/fk-list.out"
b2 fk-north-at-fork "$F" "$NORTH"
jq -e '.scope.kind == "trunk" and .json.cells[0].value == 10' "$EVIDENCE/fk-north-at-fork.out"
$V mcp --as forker fk-browse-fork space_browse "{\"repo\":\"$F\",\"recursive\":true}"
$V mcp --as forker fk-browse-upstream space_browse "{\"repo\":\"$S\",\"recursive\":true}"
nodes(){ jq -S '[.nodes[] | {nodeId, name, parentNodeId, resource}] | sort_by(.nodeId)' "$1"; }
nodes "$EVIDENCE/fk-browse-fork.out" > "$EVIDENCE/fk-nodes-fork.json"
nodes "$EVIDENCE/fk-browse-upstream.out" > "$EVIDENCE/fk-nodes-upstream.json"
diff "$EVIDENCE/fk-nodes-fork.json" "$EVIDENCE/fk-nodes-upstream.json"
jq -e --arg n "$NORTH" --arg s "$SOUTH" --arg e "$EAST" '([.[].name] | sort) == ["East","North","South","archive"] and ([.[].resource.unitId | values] | sort) == ([$n,$s,$e] | sort)' "$EVIDENCE/fk-nodes-fork.json"
$V cli fk-o-after space browse "$S" --recursive --json
diff "$EVIDENCE/fk-o-before.out" "$EVIDENCE/fk-o-after.out"
$V mcp --as forker fk-repos repo_list '{}'
jq -e --arg a "$A" --arg s "$S" '[.repos[].fullName] | sort == ([$a + "/personal", $s] | sort)' "$EVIDENCE/fk-repos.out"
```

Pass when A is a Viewer who may propose in the private S, the fork is `<A>/base`, `clean`, with no pull request and
S as its upstream, the second `fork_create` and both views return that fork, and `fork_list` lists it alone. North
reads `10` from Trunk through the fork. The fork's listing equals S's, Node for Node with the same Resource and Unit
IDs, and holds `archive`, `East`, `North` and `South`. O's listing of S is byte for byte the same after the fork,
and A's repositories are only its Personal Space and S.

### FK2. A fork reads what Trunk holds now, and a read opens nothing

Run: helper.

Continue from FK1. O sets North to `11` on Trunk through a merged pull request, and A reads it through the fork:

```bash
$V cli fk-o-pr pr create -R "$S" -t "North 11" --json
OW=$(jq -r .id "$EVIDENCE/fk-o-pr.out"); ON=$(jq -r .number "$EVIDENCE/fk-o-pr.out")
$V cli fk-o-add unit add --worktree "$OW" --resource "$NRES" --json
$V cli fk-o-exec execute --worktree "$OW" --unit "$NORTH" --json -e 'univerAPI.getActiveWorkbook().getSheetByName("Data").getRange("B2").setValue(11);'
$V cli fk-o-ready pr ready "$ON" -R "$S" --json state
$V cli fk-o-merge pr merge "$ON" -R "$S" --json state
$V cli fk-o-north read 'Data!B2' --unit "$NORTH" --trunk --json
b2 fk-north-now "$F" "$NORTH"
jq -e '.scope.kind == "trunk" and .json.cells[0].value == 11' "$EVIDENCE/fk-north-now.out"
jq -e --slurpfile o "$EVIDENCE/fk-o-north.out" '.revision == $o[0].revision' "$EVIDENCE/fk-north-now.out"
jq -e --slurpfile f "$EVIDENCE/fk-north-at-fork.out" '.revision > $f[0].revision' "$EVIDENCE/fk-north-now.out"
$V mcp --as forker fk-still-clean fork_view "{\"fork\":\"$F\"}"
jq -e '.state == "clean" and .worktree == null' "$EVIDENCE/fk-still-clean.out"
$V mcp --as forker fk-no-units unit_list "{\"worktree\":\"$F\"}"
jq -e '.units == []' "$EVIDENCE/fk-no-units.out"
$V mcp --as forker fk-budget-0 whoami
jq -e '.budget.openWorktrees.used == 0' "$EVIDENCE/fk-budget-0.out"
```

Pass when A reads `11` from Trunk at the revision O's Trunk read reports, later than the revision FK1 read when it
created the fork, and the fork is still `clean`, lists no files of its own, and A has no open pull request.

### FK3. The first write opens one pull request, with the file's baseline taken at that moment

Run: helper.

Continue from FK2. A sets North to `12` through the fork, then reads North and South through it, and O reads North on
Trunk:

```bash
put fk-first "$F" "$NORTH" 12
jq -e '.value == 12' "$EVIDENCE/fk-first.out"
$V mcp --as forker fk-drafting fork_view "{\"fork\":\"$F\"}"
jq -e --arg a "$A" --arg s "$S" '.state == "drafting" and .worktree.state == "draft" and .worktree.visibility == "private" and .worktree.kind == "team" and .worktree.creator.username == $a and .worktree.name == "base"' "$EVIDENCE/fk-drafting.out"
W1=$(jq -r .worktree.id "$EVIDENCE/fk-drafting.out"); P1=$(jq -r .worktree.number "$EVIDENCE/fk-drafting.out")
$V mcp --as forker fk-first-units unit_list "{\"worktree\":\"$F\"}"
jq -e --arg u "$NORTH" --argjson r "$(jq .revision "$EVIDENCE/fk-north-now.out")" '[.units[] | {unitId, source, change, base: .freshness.baselineTrunkRevision, behind: .freshness.revisionsBehind}] == [{unitId: $u, source: "trunk", change: "modified", base: $r, behind: 0}]' "$EVIDENCE/fk-first-units.out"
b2 fk-north-forked "$F" "$NORTH"
jq -e --arg w "$W1" '.scope == {kind: "worktree", worktreeId: $w} and .json.cells[0].value == 12' "$EVIDENCE/fk-north-forked.out"
b2 fk-south-unchanged "$F" "$SOUTH"
jq -e '.scope.kind == "trunk" and .json.cells[0].value == 20' "$EVIDENCE/fk-south-unchanged.out"
$V cli fk-o-north-after read 'Data!B2' --unit "$NORTH" --trunk --json
jq -e --slurpfile o "$EVIDENCE/fk-o-north.out" '.json.cells[0].value == 11 and .revision == $o[0].revision' "$EVIDENCE/fk-o-north-after.out"
$V mcp --as forker fk-budget-1 whoami
jq -e '.budget.openWorktrees.used == 1' "$EVIDENCE/fk-budget-1.out"
```

Pass when the write returns `12` and the fork is `drafting` with one private draft Team pull request named `base` by
A, which holds North alone, under North's own Unit ID, `modified`, with the baseline FK2's read saw and nothing
behind. Through the fork North reads `12` from that pull request and South `20` from Trunk, O's Trunk still reads
`11` at the same revision, and A has one open pull request.

### FK4. Two first writes at once share one pull request, and a second fork keeps its own

Run: helper.

Continue from FK3. A creates a second fork `race` of S and sets North to `41` and South to `42` through it with two
calls that start together:

```bash
F2="$A/race"
$V mcp --as forker fk-race fork_create "{\"repo\":\"$S\",\"name\":\"race\"}"
jq -e '.state == "clean"' "$EVIDENCE/fk-race.out"
put fk-race-north "$F2" "$NORTH" 41 > /dev/null & J1=$!
put fk-race-south "$F2" "$SOUTH" 42 > /dev/null & J2=$!
wait "$J1"
wait "$J2"
$V mcp --as forker fk-race-view fork_view "{\"fork\":\"$F2\"}"
W2=$(jq -r .worktree.id "$EVIDENCE/fk-race-view.out"); P2=$(jq -r .worktree.number "$EVIDENCE/fk-race-view.out")
jq -e --arg w "$W1" '.state == "drafting" and .worktree.id != $w' "$EVIDENCE/fk-race-view.out"
$V mcp --as forker fk-race-units unit_list "{\"worktree\":\"$F2\"}"
jq -e --arg w "$W2" --arg n "$NORTH" --arg s "$SOUTH" '([.units[].unitId] | sort) == ([$n,$s] | sort) and all(.units[]; .worktreeId == $w)' "$EVIDENCE/fk-race-units.out"
$V mcp --as forker fk-budget-2 whoami
jq -e '.budget.openWorktrees.used == 2' "$EVIDENCE/fk-budget-2.out"
b2 fk-race-north-read "$F2" "$NORTH"
jq -e --arg w "$W2" '.scope.worktreeId == $w and .json.cells[0].value == 41' "$EVIDENCE/fk-race-north-read.out"
b2 fk-base-north-read "$F" "$NORTH"
jq -e --arg w "$W1" '.scope.worktreeId == $w and .json.cells[0].value == 12' "$EVIDENCE/fk-base-north-read.out"
b2 fk-base-south-read "$F" "$SOUTH"
jq -e '.scope.kind == "trunk" and .json.cells[0].value == 20' "$EVIDENCE/fk-base-south-read.out"
```

Pass when both writes succeed and `race` is `drafting` with a pull request other than `base`'s, which holds North
and South, both in it, A has two open pull requests, one per fork, and each fork reads its own North, `41` and `12`,
while `base` still reads South `20` from Trunk.

### FK5. A ready fork refuses writes until it is reopened, and the other fork goes on

Run: helper.

Continue from FK4. A readies `base`'s pull request and writes through both forks. It reopens the pull request with
`pr_ready` and `undo`, writes again, and readies it, and O merges it:

```bash
$V mcp --as forker fk-ready pr_ready "{\"repo\":\"$S\",\"number\":$P1}"
$V mcp --as forker fk-proposed fork_view "{\"fork\":\"$F\"}"
jq -e '.state == "proposed" and .worktree.state == "ready"' "$EVIDENCE/fk-proposed.out"
put fk-frozen "$F" "$NORTH" 13
test $? -eq 1
jq -e '.code == "FORK_WORKTREE_NOT_DRAFT" and .detail.status == 409' "$EVIDENCE/fk-frozen.out"
put fk-race-goes-on "$F2" "$NORTH" 43
jq -e '.value == 43' "$EVIDENCE/fk-race-goes-on.out"
$V mcp --as forker fk-reopen pr_ready "{\"repo\":\"$S\",\"number\":$P1,\"undo\":true}"
$V mcp --as forker fk-reopened fork_view "{\"fork\":\"$F\"}"
jq -e --arg w "$W1" '.state == "drafting" and .worktree.id == $w and .worktree.state == "draft"' "$EVIDENCE/fk-reopened.out"
put fk-after-reopen "$F" "$NORTH" 13
jq -e '.value == 13' "$EVIDENCE/fk-after-reopen.out"
$V mcp --as forker fk-reopen-units unit_list "{\"worktree\":\"$F\"}"
jq -e --arg w "$W1" --arg u "$NORTH" '[.units[] | {unitId, worktreeId}] == [{unitId: $u, worktreeId: $w}]' "$EVIDENCE/fk-reopen-units.out"
$V mcp --as forker fk-ready-again pr_ready "{\"repo\":\"$S\",\"number\":$P1}"
$V cli fk-o-merge-1 pr merge "$P1" -R "$S" --json state
$V cli fk-p1-merged pr view "$P1" -R "$S" --json state,units
jq -e --arg u "$NORTH" '.state == "merged" and ([.units[] | {unitId, mergeResult}] == [{unitId: $u, mergeResult: "merged"}])' "$EVIDENCE/fk-p1-merged.out"
$V cli fk-o-north-merged read 'Data!B2' --unit "$NORTH" --trunk --json
jq -e '.json.cells[0].value == 13' "$EVIDENCE/fk-o-north-merged.out"
$V mcp --as forker fk-clean-again fork_view "{\"fork\":\"$F\"}"
jq -e '.state == "clean" and .worktree == null' "$EVIDENCE/fk-clean-again.out"
```

Pass when the ready fork is `proposed`, its write exits 1 with `FORK_WORKTREE_NOT_DRAFT` and status 409 while `race`
takes `43`, the reopened fork is `drafting` in the same pull request, takes `13` and still holds North alone, and
after O's merge the pull request reads `merged` with North `merged`, Trunk North reads `13`, and the fork is `clean`.

### FK6. Deleting a fork leaves the upstream and its pull requests

Run: helper.

Continue from FK5. A sets South to `21` through `base`, which opens a new pull request, and readies it. O lists S and
reads South, then A deletes the fork:

```bash
put fk-second "$F" "$SOUTH" 21
$V mcp --as forker fk-second-view fork_view "{\"fork\":\"$F\"}"
P3=$(jq -r .worktree.number "$EVIDENCE/fk-second-view.out")
jq -e --arg w "$W1" '.state == "drafting" and .worktree.id != $w' "$EVIDENCE/fk-second-view.out"
$V mcp --as forker fk-second-ready pr_ready "{\"repo\":\"$S\",\"number\":$P3}"
$V cli fk-o-before-delete space browse "$S" --recursive --json
$V cli fk-o-south-before read 'Data!B2' --unit "$SOUTH" --trunk --json
$V mcp --as forker fk-delete fork_delete "{\"fork\":\"$F\"}"
jq -e --arg f "$F" --argjson n "$P3" '.fork.fullName == $f and .worktree.number == $n and .worktree.state == "ready"' "$EVIDENCE/fk-delete.out"
$V mcp --as forker fk-deleted-view fork_view "{\"fork\":\"$F\"}"
test $? -eq 1
jq -e '.code == "NOT_FOUND"' "$EVIDENCE/fk-deleted-view.out"
$V mcp --as forker fk-list-after fork_list '{}'
jq -e --arg f "$F2" '[.forks[].fullName] == [$f]' "$EVIDENCE/fk-list-after.out"
$V cli fk-o-after-delete space browse "$S" --recursive --json
diff "$EVIDENCE/fk-o-before-delete.out" "$EVIDENCE/fk-o-after-delete.out"
$V cli fk-o-south-after read 'Data!B2' --unit "$SOUTH" --trunk --json
jq -e --slurpfile b "$EVIDENCE/fk-o-south-before.out" '.json.cells[0].value == 20 and .revision == $b[0].revision' "$EVIDENCE/fk-o-south-after.out"
$V cli fk-p1-kept pr view "$P1" -R "$S" --json state,creator,units
jq -e --arg a "$A" '.state == "merged" and .creator.username == $a and .units[0].mergeResult == "merged"' "$EVIDENCE/fk-p1-kept.out"
$V cli fk-p3-kept pr view "$P3" -R "$S" --json state,creator
jq -e --arg a "$A" '.state == "ready" and .creator.username == $a' "$EVIDENCE/fk-p3-kept.out"
$V cli fk-o-merge-3 pr merge "$P3" -R "$S" --json state
$V cli fk-o-south-merged read 'Data!B2' --unit "$SOUTH" --trunk --json
jq -e '.json.cells[0].value == 21' "$EVIDENCE/fk-o-south-merged.out"
```

Pass when the second write opens a pull request other than the merged one, `fork_delete` returns that ready pull
request, the fork is then not found and `fork_list` holds only `race`. O's listing of S is byte for byte the same and
Trunk South still reads `20` at the same revision. The merged pull request still reads `merged`, by A, with North
`merged`. The ready one stays `ready`, by A, and O merges it, after which Trunk South reads `21`.

### FK7. Losing membership cuts the fork off from the upstream

Run: helper.

Continue from FK6. `race` has an open draft pull request with North and South. O removes A from S, and A tries its
fork and that pull request's ID:

```bash
$V cli fk-remove repo member remove "$A" -R "$S" --json
$V mcp --as forker fk-cut-view fork_view "{\"fork\":\"$F2\"}"
jq -e --arg w "$W2" '.upstream == null and .worktree.id == $w and .worktree.capabilities.review == false and .worktree.capabilities.addUnit == false' "$EVIDENCE/fk-cut-view.out"
$V mcp --as forker fk-cut-list fork_list '{}'
jq -e '[.forks[] | {name, upstream}] == [{name: "race", upstream: null}]' "$EVIDENCE/fk-cut-list.out"
$V mcp --as forker fk-cut-browse space_browse "{\"repo\":\"$F2\"}"
test $? -eq 1
b2 fk-cut-read-changed "$F2" "$NORTH"
test $? -eq 1
b2 fk-cut-read-unchanged "$F2" "$EAST"
test $? -eq 1
put fk-cut-write "$F2" "$NORTH" 50
test $? -eq 1
$V mcp --as forker fk-cut-units unit_list "{\"worktree\":\"$F2\"}"
test $? -eq 1
b2 fk-cut-read-id "$W2" "$NORTH"
test $? -eq 1
put fk-cut-write-id "$W2" "$NORTH" 50
test $? -eq 1
CUT="You no longer have the access that fork $F2 needs to its upstream. Ask the upstream's owner to give you access again, or delete the fork with fork_delete (uvw fork delete in the CLI)."
cut_off(){ jq -e --arg m "$CUT" --arg f "$F2" '.code == "FORBIDDEN" and .message == $m and .detail.fork == $f' "$EVIDENCE/$1.out"; }
for label in fk-cut-browse fk-cut-read-changed fk-cut-read-unchanged fk-cut-write fk-cut-units fk-cut-read-id fk-cut-write-id; do
  cut_off "$label"
done
```

O then makes S public with `proposals` `members`, which lets anyone read it and only Space Members propose. A reads
through the fork again and writes:

```bash
$V person fk-public repo edit "$S" --visibility public --proposals members --json
$V mcp --as forker fk-public-view fork_view "{\"fork\":\"$F2\"}"
jq -e --arg s "$S" '.upstream.fullName == $s and .upstream.affiliation == "none" and .upstream.capabilities.propose == false and .worktree.capabilities.addUnit == false' "$EVIDENCE/fk-public-view.out"
$V mcp --as forker fk-public-browse space_browse "{\"repo\":\"$F2\",\"recursive\":true}"
jq -e '[.nodes[].name] | sort == ["East","North","South","archive"]' "$EVIDENCE/fk-public-browse.out"
b2 fk-public-read "$F2" "$NORTH"
jq -e --arg w "$W2" '.scope.worktreeId == $w and .json.cells[0].value == 43' "$EVIDENCE/fk-public-read.out"
put fk-public-write "$F2" "$NORTH" 50
test $? -eq 1
put fk-public-write-new "$F2" "$EAST" 50
test $? -eq 1
put fk-public-write-id "$W2" "$NORTH" 50
test $? -eq 1
for label in fk-public-write fk-public-write-new fk-public-write-id; do
  cut_off "$label"
done
$V mcp --as forker fk-public-ready pr_ready "{\"repo\":\"$S\",\"number\":$P2}"
test $? -eq 1
jq -e '.code == "FORBIDDEN"' "$EVIDENCE/fk-public-ready.out"
```

Pass when, while S is private, the fork still exists for A with `upstream` null and its pull request with no
`review` or `addUnit`, and browsing, listing the fork's files, reading a file the fork changed or one it did not,
writing through the fork, and reading and writing by the pull request's Worktree ID each exit 1 with `FORBIDDEN`,
`detail.fork` `<A>/race` and the message `You no longer have the access that fork <A>/race needs to its upstream.`
followed by the way out, asking the upstream's owner for access or `fork_delete`. Once S is public with `members`,
A, now with no affiliation and no `propose`, browses all four Nodes and reads its own North `43` through the fork
again, while writing a file in the pull request or a new one through the fork, and writing by Worktree ID, each exit
1 with that same refusal, and `pr_ready` exits 1 with `FORBIDDEN`.

### FK8. uvw creates, lists, views and deletes a fork

Run: helper.

Continue from FK7, whose S is public. O forks S with uvw, writes through the fork, and deletes it:

```bash
$V cli fk-cli-create fork create "$S" --name mine --json
jq -e --arg f "$O/mine" --arg s "$S" '.fullName == $f and .state == "clean" and .upstream.fullName == $s' "$EVIDENCE/fk-cli-create.out"
$V cli fk-cli-list-clean fork list
grep -E "^$O/mine +$S +clean *$" "$EVIDENCE/fk-cli-list-clean.out"
$V cli fk-cli-repo repo view "$O/mine"
test $? -eq 1
grep -F "$O/mine is a fork of $S, not a repository." "$EVIDENCE/fk-cli-repo.err"
$V cli fk-cli-write execute --worktree "$O/mine" --unit "$SOUTH" --json -e 'const r = univerAPI.getActiveWorkbook().getSheetByName("Data").getRange("B2"); r.setValue(22); return r.getValue();'
$V cli fk-cli-list fork list --json fullName,state,worktree
N=$(jq -r '.[0].worktree.number' "$EVIDENCE/fk-cli-list.out")
jq -e --arg f "$O/mine" '[.[] | {fullName, state}] == [{fullName: $f, state: "drafting"}]' "$EVIDENCE/fk-cli-list.out"
$V cli fk-cli-list-text fork list
grep -E "^$O/mine +$S +drafting +#$N *$" "$EVIDENCE/fk-cli-list-text.out"
$V cli fk-cli-view fork view "$O/mine"
grep -Fx "pull request: #$N in $S (uvw pr view $N -R $S)" "$EVIDENCE/fk-cli-view.out"
$V cli fk-cli-view-id fork view "$(jq -r .id "$EVIDENCE/fk-cli-create.out")" --json fullName,state
jq -e --arg f "$O/mine" '. == {fullName: $f, state: "drafting"}' "$EVIDENCE/fk-cli-view-id.out"
$V cli fk-cli-delete fork delete "$O/mine"
grep -Fx "Deleted $O/mine; pull request #$N stays in $S" "$EVIDENCE/fk-cli-delete.out"
$V cli fk-cli-gone fork view "$O/mine"
test $? -eq 1
grep -F 'NOT_FOUND' "$EVIDENCE/fk-cli-gone.err"
$V cli fk-cli-list-empty fork list --json fullName
jq -e '. == []' "$EVIDENCE/fk-cli-list-empty.out"
$V cli fk-cli-pr pr view "$N" -R "$S" --json state,creator
jq -e --arg o "$O" '.state == "draft" and .creator.username == $o' "$EVIDENCE/fk-cli-pr.out"
```

Pass when the fork is created `clean` and listed as `<O>/mine  <S>  clean`, `uvw repo view` refuses it as a
repository, the write opens pull request N, which `fork list` shows as `drafting  #N` and `fork view` names with its
`uvw pr view` command, the view by ID matches, `fork delete` prints `Deleted <O>/mine; pull request #N stays in <S>`,
after which the fork is not found and not listed, and pull request N is still a draft by O.

## Gotchas

- The MCP-mode gotchas in [MCP gateway](mcp.md#gotchas) apply.
- `execute` through a fork is a write. It adds the file to the fork's pull request even when its code only reads.
  Read through a fork with `read`, `outline`, `find` or `inspect`.
- FK4 starts both first writes together but cannot make the server interleave them. It checks the end state, one
  pull request that holds both files.
- After losing a private upstream, `fork_view` still names the fork's open pull request, which its author keeps as a
  summary with no rights.
