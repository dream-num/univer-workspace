# Agent Mode: an Issue as an agent's task

A person assigns an Issue to an agent and leaves. The agent finds its work with `search`, works in a pull
request linked to the Issue, and submits the Issue with what it did. The person sends it back with a reason, which
the agent finds and acts on, or accepts it, which closes the Issue as completed. Agents also find the pull requests
they may merge, so a prompt that carries no task is enough. A repository can accept a submission nobody sent back by a
deadline.

## Sub-features

- MP11 lists reviewable pull requests: ready Team pull requests others wrote that the caller may merge, across
  repositories, never from a private one the caller cannot see, each with `capabilities`, and the same in uvw.
- MP12 runs two claimed agents with prompts that carry no task: B3 finds the Issue assigned to it and proposes,
  then A3 finds the reviewable pull request and merges it.
- MP13 links the pull request a claimed agent's fork opens to an Issue assigned to it, refuses an unknown Issue number, and shows the link in MCP, uvw, the Issue page and the pull request header.
- MI12 has a claimed Viewer agent submit an Issue it worked in a fork pull request, the run user send it back and
  accept it in the browser, and the agent find the sent-back Issue with `search` and `acceptance`.
- MI15 turns on an acceptance deadline with `repo_edit`, lets the server accept a submitted Issue by deadline with no
  actor while a sent-back one stays open, restarts the clock on a reopen, reads it back in MCP, uvw and the browser,
  shows the settings notice before a change that accepts overdue Issues, and turns the deadline off.

## How to get to it (user POV)

An MCP client connected to `$MCP_URL` calls `search`, `issue_view`, `issue_verdict`, `fork_create`, `fork_view`,
`pr_edit` and `pr_ready`. An agent asked to check its work calls `search` for the Issues assigned to it and the pull
requests waiting for it, then acts on them. A person sends an Issue back or accepts it on its page, and `uvw issue
view`, `uvw pr view` and `uvw search` show the same objects. MI15 calls `repo_edit`, and a person turns the
acceptance deadline off in the repository's settings.

## Driving it with agent-browser and uvw

Mode: mcp.

Start every shell with `eval "$($V env)"`. Each `$V mcp`
call checks its usage event and credential leakage, and exit 5 fails the journey.
[MCP mode](../references/mcp-mode.md) lists the helper commands and their exit codes.

```bash
O=verify-$VERIFY_UVW_RUN
```

### MP11. Reviewable pull requests

MP11 and MP12 share one setup. A3 owns a
repository R with a Budget Sheet on Trunk, makes B3 a Viewer, and assigns B3 an Issue. The run user owns
`private-x`, which neither agent can see, with a ready pull request shared with its members:

```bash
$V principal a3 mp12-a3-principal
$V principal b3 mp12-b3-principal
$V mcp --as a3 mp12-claim-a3 claim '{}'
$V mcp --as b3 mp12-claim-b3 claim '{}'
```

Open each `claimUrl` in the run browser, signed in as the run user, click `Claim agent`, and replace the codes as
[MH1](agent-handoff.md#mh1-unclaimed-agent) says.

```bash
A3U=$(jq -r .agent.username "$EVIDENCE/principal-a3.json"); B3U=$(jq -r .agent.username "$EVIDENCE/principal-b3.json")
R="$A3U/budget-2027"
$V cli mp11-x-repo repo create private-x --name "Private X" --json id,fullName
$V cli mp11-x-pr pr create -R "$O/private-x" -t "Human proposal" --visibility space --json
$V cli mp11-x-unit unit create --worktree "$(jq -r .id "$EVIDENCE/mp11-x-pr.out")" --space "$O/private-x" --type sheet --name Notes --json
$V cli mp11-x-ready pr ready 1 -R "$O/private-x" --json state
$V mcp --as a3 mp12-a3-repo repo_create '{"slug":"budget-2027","name":"Budget 2027"}'
$V mcp --as a3 mp12-a3-pr pr_create "{\"repo\":\"$R\",\"title\":\"Budget sheet\"}"
W1=$(jq -r .id "$EVIDENCE/mp12-a3-pr.out"); N1=$(jq -r .number "$EVIDENCE/mp12-a3-pr.out")
$V mcp --as a3 mp12-a3-unit unit_create "{\"worktree\":\"$W1\",\"space\":\"$R\",\"type\":\"sheet\",\"name\":\"Budget\"}"
U=$(jq -r .unit.unitId "$EVIDENCE/mp12-a3-unit.out"); NODE=$(jq -r .unit.nodeId "$EVIDENCE/mp12-a3-unit.out")
CODE='const ws = univerAPI.getActiveWorkbook().getActiveSheet(); ws.getRange("A1:B5").setValues([["Item","Budget"],["Rent",3000],["Salaries",12000],["Marketing",2500],["Total",null]]); ws.getRange("B5").setFormula("=SUM(B2:B4)");'
$V mcp --as a3 mp12-a3-exec execute "$(jq -nc --arg w "$W1" --arg u "$U" --arg c "$CODE" '{worktree:$w,unit:$u,code:$c}')"
$V mcp --as a3 mp12-a3-ready pr_ready "{\"repo\":\"$R\",\"number\":\"$N1\"}"
$V mcp --as a3 mp12-a3-merge pr_merge "{\"repo\":\"$R\",\"number\":\"$N1\"}"
$V mcp --as a3 mp12-a3-member repo_member_write "{\"repo\":\"$R\",\"action\":\"add\",\"user\":\"$B3U\",\"role\":\"viewer\"}"
$V mcp --as a3 mp12-a3-issue issue_create "$(jq -nc --arg r "$R" --arg a "$B3U" --arg n "$NODE" '{repo:$r,title:"Raise the Marketing budget to 4000",body:"In the Budget sheet, change the Marketing budget from 2500 to 4000 and check that Total follows. Propose the change as a pull request for review.",assignees:[$a],nodes:[$n]}')"
```

Before anyone proposes:

```bash
$V mcp --as a3 mp11-a3-before search '{"kind":"prs","reviewable":true}'
$V mcp mp11-h-before search '{"kind":"prs","reviewable":true}'
$V mcp --as b3 mp11-b3-issues search '{"kind":"issues","assignee":"@me"}'
```

Run MP12's B3 story, then:

```bash
$V mcp --as a3 mp11-a3-after search '{"kind":"prs","reviewable":true}'
$V mcp --as b3 mp11-b3-after search '{"kind":"prs","reviewable":true}'
$V mcp mp11-h-after search '{"kind":"prs","reviewable":true}'
$V cli mp11-h-after-cli search prs --reviewable --json
diff <(jq -S '.prs | map(del(.url))' "$EVIDENCE/mp11-h-after.out") <(jq -S '.' "$EVIDENCE/mp11-h-after-cli.out")
```

Pass when neither `before` search lists a pull request of R or `private-x`, although `private-x` has a ready pull
request shared with its members, and `mp11-b3-issues` lists the Issue. After B3 proposes, `mp11-a3-after` lists exactly B3's pull request,
`ready`, with `capabilities.merge: true` and a `url`. `mp11-b3-after` is empty, because B3 wrote it and as a Viewer
may not merge it. The run user claimed B3, so `mp11-h-after` lists the same pull request and never the run user's own
in `private-x`, and the CLI diff is empty.

### MP12. Agents find their own work

Continue from MP11's setup. Each prompt is the fixed sentence below and carries no task:

```bash
$V metrics > "$EVIDENCE/mp12-metrics-before.prom"
$V mcp --as a3 mp12-trunk-before read "{\"unit\":\"$U\",\"trunk\":true,\"range\":\"A1:B5\"}"
$V story --as b3 mp12-b3 mcp '检查分配给你的工作并完成它。'
# MP11's checks after the proposal go here.
$V story --as a3 mp12-a3 mcp '检查等你处理的工作并处理。'
$V metrics > "$EVIDENCE/mp12-metrics-after.prom"
$V cli mp12-trunk-after read "'Sheet 1'!A1:B5" --unit "$U" --trunk --json
```

Filter `$V mcp-logs` to each story's time window and agent `user_id` as `mp12-<agent>-events.jsonl`, view B3's pull
request with `uvw pr view <n> -R "$R" --json state,creator,units`, and read R's activity in the run browser
(`/api/spaces/<R id>/activity?timeZone=UTC`).

Pass when B3's events show `search` before its first write and no `pr_merge`, its pull request is `ready`, and
`mp12-trunk-before` has Marketing `2500`. A3's events show `search`, then `pr_view` and reads, then `pr_merge`.
`mp12-trunk-after` has Marketing `4000` and Total `19000` one revision later, the activity's `pull-merged` actor is
A3 and the pull request's author is B3, and no event or transcript result holds `AGENT_NOT_ALLOWED` or
`INTERACTIVE_SESSION_REQUIRED`. After the claims nobody acts, and nobody relays task content. If the model fails for
a model reason, rerun with `--model console-deepseek/deepseek-flash#max` under an `-attempt2` label and report both.

### MP13. A fork's pull request serves an Issue

The run user O owns a Team Space and opens an Issue assigned to a claimed agent A, a Viewer there. A works through a
fork, links the pull request its first write opens with `pr_edit`, and both sides show the link in MCP, uvw and the
browser.

```bash
$V cli mpl-repo repo create issue-link --name "Issue link" --json id,fullName
T=$(jq -r .id "$EVIDENCE/mpl-repo.out")
$V principal linker mpl-a
A=$(jq -r .agent.username "$EVIDENCE/principal-linker.json")
$V mcp --as linker mpl-claim claim '{}'
```

Open the `claimUrl` from `mpl-claim.out` in the run browser, signed in as O, and click `Claim agent`. Replace the code in
`mpl-claim.*` as [MH1](agent-handoff.md#mh1-unclaimed-agent) says. Then:

```bash
$V cli mpl-member repo member add "$A" --role viewer -R "$O/issue-link" --json
$V cli mpl-issue issue create -R "$O/issue-link" -t "Fix the totals" -a "$A" --json number
N=$(jq -r .number "$EVIDENCE/mpl-issue.out")
$V mcp --as linker mpl-fork fork_create "{\"repo\":\"$O/issue-link\",\"name\":\"totals\"}"
F=$(jq -r .fullName "$EVIDENCE/mpl-fork.out")
$V mcp --as linker mpl-write unit_create "{\"worktree\":\"$F\",\"space\":\"$O/issue-link\",\"type\":\"sheet\",\"name\":\"Totals\"}"
$V mcp --as linker mpl-fork-view fork_view "{\"fork\":\"$F\"}"
PN=$(jq -r .worktree.number "$EVIDENCE/mpl-fork-view.out")
$V mcp --as linker mpl-missing pr_edit "{\"repo\":\"$O/issue-link\",\"number\":\"$PN\",\"issue\":99999}"
test $? -eq 1
jq -e '.code == "INVALID_INPUT"' "$EVIDENCE/mpl-missing.out"
$V mcp --as linker mpl-link pr_edit "{\"repo\":\"$O/issue-link\",\"number\":\"$PN\",\"issue\":$N}"
jq -e --argjson n "$N" '.issue == {number: $n, title: "Fix the totals", state: "open"}' "$EVIDENCE/mpl-link.out"
$V mcp --as linker mpl-issue-view issue_view "{\"repo\":\"$O/issue-link\",\"number\":\"$N\"}"
jq -e --argjson pn "$PN" --arg a "$A" '.pullRequests | length == 1 and .[0].number == $pn and .[0].state == "draft" and .[0].author.username == $a' "$EVIDENCE/mpl-issue-view.out"
$V cli mpl-pr-view-cli pr view "$PN" -R "$O/issue-link"
grep -F "issue: #$N Fix the totals [open]" "$EVIDENCE/mpl-pr-view-cli.out"
$V cli mpl-issue-view-cli issue view "$N" -R "$O/issue-link"
grep -F "pull request: #$PN totals [draft]" "$EVIDENCE/mpl-issue-view-cli.out"
```

In the run browser, signed in as O, open `$ORIGIN/spaces/$T/issues/$N` and screenshot the `Pull requests` section as
`mpl-issue-page.png`. Click the pull request there and screenshot its header as `mpl-pr-header.png`.

Pass when every command exits as shown, the unknown Issue number is `INVALID_INPUT`, `pr_edit` returns the linked Issue,
`issue_view` lists the fork's pull request with A as its author, both uvw views print the link, the Issue page
lists the pull request and its state, and the pull request header names `Serves #N Fix the totals`.

### MI12. Submit an Issue, send it back, then accept it

The run user O owns a Team Space and opens an Issue assigned to a claimed agent A, a Viewer there. A works through a
fork pull request linked to the Issue and submits it with `issue_verdict`. O sends it back in the browser with a
reason, A finds it with `search` and `acceptance` and submits again, and O accepts it in the browser, which closes it
as completed.

```bash
$V cli mia-repo repo create issue-accept --name "Issue accept" --json id,fullName
T=$(jq -r .id "$EVIDENCE/mia-repo.out")
$V principal acceptor mia-a
A=$(jq -r .agent.username "$EVIDENCE/principal-acceptor.json")
$V mcp --as acceptor mia-claim claim '{}'
```

Open the `claimUrl` from `mia-claim.out` in the run browser, signed in as O, and click `Claim agent`. Replace the code in
`mia-claim.*` as [MH1](agent-handoff.md#mh1-unclaimed-agent) says. Then:

```bash
R="$O/issue-accept"
$V cli mia-member repo member add "$A" --role viewer -R "$R" --json
$V cli mia-issue issue create -R "$R" -t "Add the West region" -a "$A" --json number
N=$(jq -r .number "$EVIDENCE/mia-issue.out")
$V mcp --as acceptor mia-fork fork_create "{\"repo\":\"$R\",\"name\":\"west\"}"
F=$(jq -r .fullName "$EVIDENCE/mia-fork.out")
$V mcp --as acceptor mia-write unit_create "{\"worktree\":\"$F\",\"space\":\"$R\",\"type\":\"sheet\",\"name\":\"Regions\"}"
$V mcp --as acceptor mia-fork-view fork_view "{\"fork\":\"$F\"}"
PN=$(jq -r .worktree.number "$EVIDENCE/mia-fork-view.out")
$V mcp --as acceptor mia-link pr_edit "{\"repo\":\"$R\",\"number\":\"$PN\",\"issue\":$N}"
$V mcp --as acceptor mia-ready pr_ready "{\"repo\":\"$R\",\"number\":\"$PN\"}"
$V mcp --as acceptor mia-submit issue_verdict "$(jq -nc --arg r "$R" --arg n "$N" --arg b "Added a Regions sheet in pull request #$PN. Checked that it opens. Assumed West is a new row." '{repo:$r,number:$n,verdict:"submit",body:$b}')"
jq -e '.state == "open" and .acceptance.kind == "submitted"' "$EVIDENCE/mia-submit.out"
$V mcp --as acceptor mia-self-accept issue_verdict "{\"repo\":\"$R\",\"number\":\"$N\",\"verdict\":\"accept\"}"
test $? -eq 1
jq -e '.code == "FORBIDDEN"' "$EVIDENCE/mia-self-accept.out"
$V mcp mia-h-queue search '{"kind":"issues","author":"@me","acceptance":"submitted"}'
jq -e --argjson n "$N" '[.issues[].number] == [$n]' "$EVIDENCE/mia-h-queue.out"
$V mcp mia-h-empty issue_verdict "{\"repo\":\"$R\",\"number\":\"$N\",\"verdict\":\"send_back\"}"
test $? -eq 1
jq -e '.code == "INVALID_INPUT"' "$EVIDENCE/mia-h-empty.out"
```

In the run browser, signed in as O, open `$ORIGIN/spaces/$T/issues/$N`. The sidebar's `Acceptance` reads
`Submitted for acceptance`, and the `Review this submission` section shows `Send back` disabled until a reason is typed.
Type `West needs its Q4 total.` into `Reason for sending back`, click `Send back`, reload, and screenshot the timeline
and sidebar as `mia-sent-back.png`. Then:

```bash
$V mcp --as acceptor mia-find search '{"kind":"issues","assignee":"@me","acceptance":"sent_back"}'
jq -e --argjson n "$N" '[.issues[].number] == [$n]' "$EVIDENCE/mia-find.out"
$V mcp --as acceptor mia-reason issue_view "{\"repo\":\"$R\",\"number\":\"$N\"}"
jq -e '.acceptance.kind == "sent_back" and .acceptance.body == "West needs its Q4 total."' "$EVIDENCE/mia-reason.out"
$V mcp --as acceptor mia-resubmit issue_verdict "{\"repo\":\"$R\",\"number\":\"$N\",\"verdict\":\"submit\",\"body\":\"Added the West Q4 total.\"}"
jq -e '.acceptance.kind == "submitted"' "$EVIDENCE/mia-resubmit.out"
```

Reload the Issue page, click `Accept`, reload, and screenshot the closed Issue with its timeline as `mia-accepted.png`.
Open `$ORIGIN/api/spaces/$T/activity?timeZone=UTC` in the run browser and save the page text as `mia-activity.json`. Then:

```bash
$V cli mia-final issue view "$N" -R "$R" -c --json state,stateReason,acceptance,timeline
jq -e --arg o "$O" '.state == "closed" and .stateReason == "completed" and .acceptance.kind == "accepted" and .acceptance.actor.username == $o' "$EVIDENCE/mia-final.out"
jq -e '[.timeline[] | select(.type == "event") | .kind] | map(select(. != "assigned")) == ["submitted", "sent_back", "submitted", "closed", "accepted"]' "$EVIDENCE/mia-final.out"
jq -e --argjson n "$N" '[.events[] | select(.kind == "issue-closed" and .issue.number == $n)] | length == 1' "$EVIDENCE/mia-activity.json"
```

Pass when every command exits as shown: A submits as a Viewer assignee but may not accept, an empty send-back is
`INVALID_INPUT`, O's `acceptance` search lists the submitted Issue, the browser send-back shows the reason in the
timeline, A finds the sent-back Issue with `acceptance`, resubmits, and O's browser accept closes the Issue as
completed with one `issue-closed` activity event.

### MI15. Accept an Issue by deadline

The run user O turns on a 72-hour acceptance deadline with `repo_edit`, opens three Issues assigned to O, submits two
with uvw and sends the second back. One step stands in for three days: it moves those Issues' verdicts 73 hours back in
the run's product SQLite, because the server takes the time only from its clock. It is setup, the only kind of database
write in this file, and proves nothing by itself. Within a minute the server accepts the first Issue by deadline, closes
it as completed with no actor, and leaves the sent-back one open. A fourth Issue is submitted, closed as not planned and
reopened: with its verdict moved back it stays open, because the reopen restarted the clock, and it is accepted once the
reopen is moved back too. Then O turns the deadline off in the browser, and a third submission moved back the same way
stays open. MI15 creates no agent.

```bash
R="$O/issue-deadline"
DB="/tmp/verify-uvw/$VERIFY_UVW_RUN/data/univer-workspace.sqlite"
age() { sqlite3 -cmd ".timeout 5000" "$DB" "UPDATE issue_verdicts SET created_at = created_at - 73 * 3600000 WHERE issue_id = (SELECT id FROM issues WHERE space_id = '$T' AND number = $1)"; }
age_reopen() { sqlite3 -cmd ".timeout 5000" "$DB" "UPDATE issue_events SET created_at = created_at - 73 * 3600000 WHERE kind = 'reopened' AND issue_id = (SELECT id FROM issues WHERE space_id = '$T' AND number = $1)"; }
hours_left() { jq -r '.acceptance.deadline | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601 - now | . / 3600 | floor' "$EVIDENCE/$1.out"; }
$V cli mid-repo repo create issue-deadline --name "Issue deadline" --json id,fullName
T=$(jq -r .id "$EVIDENCE/mid-repo.out")
$V mcp --toolsets all mid-on repo_edit "{\"repo\":\"$R\",\"acceptAfterHours\":72}"
jq -e '.acceptAfterHours == 72' "$EVIDENCE/mid-on.out"
$V cli mid-repo-view repo view "$R"
grep -q 'accept after: 72 hours' "$EVIDENCE/mid-repo-view.out"
$V cli mid-due issue create -R "$R" -t "Count the West rows" -a "$O" --json number
$V cli mid-back issue create -R "$R" -t "Count the East rows" -a "$O" --json number
$V cli mid-later issue create -R "$R" -t "Count the North rows" -a "$O" --json number
N1=$(jq -r .number "$EVIDENCE/mid-due.out"); N2=$(jq -r .number "$EVIDENCE/mid-back.out"); N3=$(jq -r .number "$EVIDENCE/mid-later.out")
$V cli mid-submit-1 issue submit "$N1" -R "$R" -b "Counted 12 rows."
$V cli mid-submit-2 issue submit "$N2" -R "$R" -b "Counted 9 rows."
$V cli mid-send-back issue send-back "$N2" -R "$R" -b "East has 10 rows."
$V cli mid-waiting issue view "$N1" -R "$R" --json acceptance
test "$(hours_left mid-waiting)" -eq 71
$V cli mid-waiting-text issue view "$N1" -R "$R"
grep -q 'accepted by deadline: .* unless sent back' "$EVIDENCE/mid-waiting-text.out"
```

In the run browser, signed in as O, open `$ORIGIN/spaces/$T/issues/$N1`. The sidebar's `Acceptance` reads
`Submitted for acceptance` and `Accepted automatically <date> unless sent back`, about three days ahead. Screenshot it as
`mid-deadline.png`. Then:

```bash
age "$N1"; age "$N2"
for i in $(seq 1 18); do $V uvw issue view "$N1" -R "$R" --json state | jq -e '.state == "closed"' >/dev/null && break; sleep 5; done
$V cli mid-accepted issue view "$N1" -R "$R" -c --json state,stateReason,closedBy,acceptance,timeline
jq -e '.state == "closed" and .stateReason == "completed" and .closedBy == null and .acceptance.kind == "accepted" and .acceptance.actor == null' "$EVIDENCE/mid-accepted.out"
jq -e --arg o "$O" '[.timeline[] | select(.type == "event" and .kind != "assigned") | [.kind, .actor.username]] == [["submitted", $o], ["accepted", null]]' "$EVIDENCE/mid-accepted.out"
$V cli mid-accepted-text issue view "$N1" -R "$R"
grep -q 'acceptance: accepted by deadline' "$EVIDENCE/mid-accepted-text.out"
$V mcp mid-mcp issue_view "{\"repo\":\"$R\",\"number\":\"$N1\"}"
jq -e '.state == "closed" and .closedBy == null and .acceptance.kind == "accepted" and .acceptance.actor == null' "$EVIDENCE/mid-mcp.out"
$V cli mid-still-back issue view "$N2" -R "$R" --json state,acceptance
jq -e '.state == "open" and .acceptance.kind == "sent_back" and .acceptance.deadline == null' "$EVIDENCE/mid-still-back.out"
$V cli mid-reopen issue create -R "$R" -t "Count the South rows" -a "$O" --json number
N4=$(jq -r .number "$EVIDENCE/mid-reopen.out")
$V cli mid-submit-4 issue submit "$N4" -R "$R" -b "Counted 5 rows."
age "$N4"
$V cli mid-close-4 issue close "$N4" -R "$R" -r "not planned"
$V cli mid-reopen-4 issue reopen "$N4" -R "$R"
sleep 70
$V mcp mid-reopened issue_view "{\"repo\":\"$R\",\"number\":\"$N4\"}"
jq -e '.state == "open" and .acceptance.kind == "submitted"' "$EVIDENCE/mid-reopened.out"
test "$(hours_left mid-reopened)" -eq 71
age_reopen "$N4"
for i in $(seq 1 18); do $V uvw issue view "$N4" -R "$R" --json state | jq -e '.state == "closed"' >/dev/null && break; sleep 5; done
$V cli mid-reopen-accepted issue view "$N4" -R "$R" --json state,stateReason,closedBy,acceptance
jq -e '.state == "closed" and .stateReason == "completed" and .closedBy == null and .acceptance.actor == null' "$EVIDENCE/mid-reopen-accepted.out"
```

Pin `univer-workspace-layout-theme` to `repository` and reload the Issue page. The sidebar's `Acceptance` reads
`Accepted by deadline`, and the timeline ends with `Accepted by deadline, since nobody sent it back` and no one's
`closed` line: screenshot `mid-accepted.png`. Open `$ORIGIN/spaces/$T/issues?state=closed`, where the row reads
`#<N1> accepted by deadline` and a date, and screenshot `mid-list.png`. Open `$ORIGIN/spaces/$T` and screenshot the
`Recent activity`, whose newest line reads `Acceptance deadline accepted Issue #<N4>` and which also lists
`Acceptance deadline accepted Issue #<N1>`, as `mid-activity.png`.

Open `$ORIGIN/spaces/$T/settings`. Under `Acceptance deadline` the checkbox is on with `72` `hours after submission`.
Type `48` in the hours field without saving. The line above the hint reads `Saving accepts, within a minute, every
submitted Issue whose clock already passed 48 hours.` Click the checkbox to turn it off. The line now reads `Turning this
on accepts, within a minute, every submitted Issue whose clock already passed 72 hours.` Screenshot the section as
`mid-settings-off.png`, and at 390 × 844 check that `document.documentElement.scrollWidth` is 390 and screenshot it as
`mid-settings-off-390.png`. Then:

```bash
$V cli mid-off repo view "$R" --json acceptAfterHours
jq -e '.acceptAfterHours == null' "$EVIDENCE/mid-off.out"
$V cli mid-submit-3 issue submit "$N3" -R "$R" -b "Counted 7 rows."
age "$N3"
sleep 70
$V cli mid-off-open issue view "$N3" -R "$R" --json state,acceptance
jq -e '.state == "open" and .acceptance.kind == "submitted"' "$EVIDENCE/mid-off-open.out"
```

Open `$ORIGIN/spaces/$T/issues/$N3`. Its sidebar reads `Submitted for acceptance` with no `Accepted automatically` line:
screenshot `mid-off.png`.

Pass when every command exits as shown: the deadline turns on over MCP and `repo view` prints it, uvw prints the first
Issue's deadline 71 hours ahead, the first Issue closes as completed within 90 s of `age` with a null `closedBy`, a null
acceptance actor and no `closed` event in uvw and MCP, uvw prints `accepted by deadline`, the screenshots name no one as
its closer, the sent-back Issue stays open, the reopened fourth Issue stays submitted with its deadline 71 hours ahead
and closes within 90 s of `age_reopen`, the settings notice names the hours before each change, the browser turns the
deadline off, and the third Issue then stays submitted.

## Gotchas

- The MCP-mode gotchas in [MCP gateway](mcp.md#gotchas) apply.
- MP12 measures the model as well as the product. Quote `transcript.jsonl` when it goes wrong, as
  [stories](../references/stories.md) says. A story's first `error` lines can be opencode's own `fetch` and
  `execute` wrapper, which never reach Workspace.
