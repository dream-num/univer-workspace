# Issues and pull requests over MCP

An agent connected to the MCP gateway creates, views, lists, edits, comments on, closes and reopens Issues, and
creates, views, lists, edits, readies, searches and browses pull requests, and links a pull request to the Issue it serves. Each result matches what `uvw --json`
shows for the same object, errors keep their Workspace codes, and every call leaves a usage event. An agent past
its budget of open pull requests is refused with `AGENT_QUOTA_EXCEEDED`, and `whoami` shows it what it has used.

## Sub-features

- MI1 creates an Issue with a label and an assignee and compares it with the CLI view.
- MI2 and MI3 view an Issue, with and without its timeline, against the CLI.
- MI4 lists Issues against the CLI.
- MI5 edits an Issue and compares it with the CLI view.
- MI6 comments on an Issue and compares it with the CLI timeline.
- MI7 and MI8 close an Issue as not planned and reopen it.
- MI9 preserves a malformed-Issue-number error and its usage event.
- MI10 preserves a nonexistent-Issue error from the Workspace and its usage event.
- MI11 returns a structured `workspace-argument-invalid` for an invalid argument and records its usage event.
- MI12 has a claimed Viewer agent submit an Issue it worked in a fork pull request, the run user send it back and
  accept it in the browser, and the agent find the sent-back Issue with `search` and `acceptance`.
- MI13 has a claimed Editor agent merge three pull requests linked to an Issue and submit it, after the run user merges a
  fourth linked one that deletes a file. The run user judges and accepts it in the Issue page's acceptance panel,
  comparing every changed file before and after its merge, sees the deleted file by name as moved to Trash with no
  comparison, and sees the agent's later Link Sharing there, which a member does not.
- MI14 has a claimed Editor agent and a claimed Viewer agent each report both declared checks on their own pull request
  linked to one Issue. After both merge, the acceptance panel shows the Editor's results counting and the Viewer's as
  not counting, and once `.agents/checks.md` is in Trash, says the repository declares no checks.
- MI15 turns on an acceptance deadline with `repo_edit`, lets the server accept a submitted Issue by deadline with no
  actor while a sent-back one stays open, restarts the clock on a reopen, reads it back in MCP, uvw and the browser,
  shows the settings notice before a change that accepts overdue Issues, and turns the deadline off.
- MP1 creates a Personal Space pull request with an idempotency key, the same key returns the same pull request, and the same key with different arguments is refused.
- MP2 and MP3 view a pull request by number and by Browser URL against the CLI.
- MP4 lists pull requests against the CLI.
- MP5 edits a pull request and compares it with the CLI view.
- MP6 marks a pull request ready and moves it back to draft with `undo`.
- MP7 and MP8 search Issues and pull requests against the CLI.
- MP9 compares browse for a repository, a pull request and an Issue with the CLI.
- MP10 preserves a nonexistent-pull-request error and its usage event.
- MP11 lists reviewable pull requests: ready Team pull requests others wrote that the caller may merge, across
  repositories, never from a private one the caller cannot see, each with `capabilities`, and the same in uvw.
- MP12 runs two claimed agents with prompts that carry no task: B3 finds the Issue assigned to it and proposes,
  then A3 finds the reviewable pull request and merges it.
- MP13 links the pull request a claimed agent's fork opens to an Issue assigned to it, refuses an unknown Issue number, and shows the link in MCP, uvw, the Issue page and the pull request header.
- MP14 drives an agent to its budget of 10 open pull requests, shows the refusal, its event and metric, refuses the
  replay of a creation that Collaboration failed, and frees a place with a merge that `whoami` counts. The run user has
  no budget.
- MP15 declares two checks in `.agents/checks.md`, has a claimed Viewer agent report them with `pr_check`, shows them
  in the browser, marks them out of date after a Trunk edit, and counts the results of a claimed Editor agent.
- MP16 reads a merged pull request that deleted a file with uvw and MCP, before and after the file is deleted
  permanently, and answers 409 in every comparison mode for a file moved to Trash under an open pull request, whose
  page shows the deletion note and no server error.

## How to get to it (user POV)

An MCP client connected to `$MCP_URL` calls `issue_create`, `issue_view`, `issue_list`, `issue_edit`,
`issue_comment`, `issue_set_state`, `issue_verdict`, `pr_create`, `pr_view`, `pr_list`, `pr_edit`, `pr_ready`, `pr_check`,
`search` and `browse`. The same objects show in `uvw issue`, `uvw pr`, `uvw search` and `uvw browse`. An agent asked to check
its work calls `search` for the Issues assigned to it and the pull requests waiting for it, then acts on them. MP14 also calls
`whoami` and `pr_merge` as an agent, MI13 calls `unit_add`, `unit_create`, `execute`, `pr_merge` and `share`, MI14 calls
`unit_add`, `execute`, `pr_check` and `pr_merge`, and MI15 calls `repo_edit`. A person
judges an Issue's whole task in the `Acceptance` view of its page. MP16 also uses `uvw space node trash` and the
repository's `Trash` page.

## Driving it with agent-browser and uvw

Run these in an MCP-mode instance, started as in [MCP gateway](mcp.md): `VERIFY_UVW_MCP=1 $V up`,
`$V user` and a `$V doctor` with no `FAIL` lines. Start every shell with `eval "$($V env)"`. Each `$V mcp`
call checks its usage event and credential leakage, and exit 5 fails the journey.
[MCP mode](../references/mcp-mode.md) lists the helper commands and their exit codes. MI1 through MI11 use the Team Space, MP1 through MP10 the Personal Space, and MP14 an agent's Personal Space:

```bash
O=verify-$VERIFY_UVW_RUN
# The Team Space that M4 in mcp.md creates; this creates it on a run that skipped M4.
$V uvw repo view "$O/verify-team" --json >/dev/null 2>&1 \
  || $V cli mcp-repo-create repo create verify-team --name "Verify Team" --json id,fullName
```

### MI1. Issue create

Uses the Team Space from the setup above.

```bash
$V cli mcp-label-create label create bug --color red -R "$O/verify-team" --json
$V mcp mcp-issue-create issue_create "{\"repo\":\"$O/verify-team\",\"title\":\"Totals look wrong\",\"body\":\"North should be 42\",\"labels\":[\"bug\"],\"assignees\":[\"@me\"]}"
N=$(jq -r '.number' "$EVIDENCE/mcp-issue-create.out")
T=$(jq -r '.space.id' "$EVIDENCE/mcp-issue-create.out")
$V cli mcp-issue-create-cli issue view "$N" -R "$O/verify-team" --json
diff <(jq -S 'del(.url)' "$EVIDENCE/mcp-issue-create.out") <(jq -S '.' "$EVIDENCE/mcp-issue-create-cli.out")
jq -e --arg origin "$ORIGIN" '.url == "\($origin)/spaces/\(.space.id)/issues/\(.number)" and .state == "open" and (.labels | map(.name)) == ["bug"] and (.assignees | length) == 1' "$EVIDENCE/mcp-issue-create.out"
jq -e --arg repo "$T" '.tool == "issue_create" and .repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-issue-create.event.json"
```

Pass when every command exits 0, the CLI view equals the MCP result without `url`, the
`url` is the Browser Issue address, and the event carries the resolved Space ID.

### MI2. Issue view

```bash
$V mcp mcp-issue-view issue_view "{\"repo\":\"$O/verify-team\",\"number\":\"#$N\"}"
$V cli mcp-issue-view-cli issue view "#$N" -R "$O/verify-team" --json
diff <(jq -S 'del(.url)' "$EVIDENCE/mcp-issue-view.out") <(jq -S '.' "$EVIDENCE/mcp-issue-view-cli.out")
jq -e 'has("timeline") | not' "$EVIDENCE/mcp-issue-view.out"
jq -e --arg repo "$T" '.repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-issue-view.event.json"
```

Pass when both exit 0, the diff is empty, no `timeline` key is present, and the event
carries the Team Space ID.

### MI3. Issue view with comments

```bash
$V mcp mcp-issue-timeline issue_view "{\"repo\":\"$O/verify-team\",\"number\":\"$ORIGIN/spaces/$T/issues/$N\",\"comments\":true}"
$V cli mcp-issue-timeline-cli issue view "$N" -R "$O/verify-team" -c --json
diff <(jq -S 'del(.url)' "$EVIDENCE/mcp-issue-timeline.out") <(jq -S '.' "$EVIDENCE/mcp-issue-timeline-cli.out")
jq -e '.timeline | type == "array"' "$EVIDENCE/mcp-issue-timeline.out"
jq -e --arg repo "$T" '.repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-issue-timeline.event.json"
```

Pass when both exit 0, the diff is empty, `timeline` is an array, and the event carries the
Team Space ID. The Issue is
given as its Browser URL, which the tool accepts in place of a number.

### MI4. Issue list

```bash
$V mcp mcp-issue-list issue_list "{\"repo\":\"$O/verify-team\",\"state\":\"all\",\"labels\":[\"bug\"],\"assignee\":\"@me\",\"limit\":5}"
$V cli mcp-issue-list-cli issue list -R "$O/verify-team" -s all -l bug -a @me -L 5 --json
diff <(jq -S '.issues | map(del(.url))' "$EVIDENCE/mcp-issue-list.out") <(jq -S '.' "$EVIDENCE/mcp-issue-list-cli.out")
jq -e --argjson n "$N" '.issues | length >= 1 and all(.[]; .url != null) and any(.[]; .number == $n)' "$EVIDENCE/mcp-issue-list.out"
jq -e --arg repo "$T" '.repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-issue-list.event.json"
```

Pass when both exit 0, the diff is empty, every listed Issue has a `url`, and the event
carries the Team Space ID.

### MI5. Issue edit

```bash
$V cli mcp-label-create-docs label create docs --color blue -R "$O/verify-team" --json
$V mcp mcp-issue-edit issue_edit "{\"repo\":\"$O/verify-team\",\"number\":\"$N\",\"title\":\"Totals are wrong\",\"add_labels\":[\"docs\"],\"remove_labels\":[\"bug\"]}"
$V cli mcp-issue-edit-cli issue view "$N" -R "$O/verify-team" --json
diff <(jq -S 'del(.url)' "$EVIDENCE/mcp-issue-edit.out") <(jq -S '.' "$EVIDENCE/mcp-issue-edit-cli.out")
jq -e '.title == "Totals are wrong" and (.labels | map(.name)) == ["docs"]' "$EVIDENCE/mcp-issue-edit.out"
jq -e --arg repo "$T" '.repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-issue-edit.event.json"
```

Pass when both exit 0, the diff is empty, title and labels changed, and the event carries
the Team Space ID.

### MI6. Issue comment

```bash
$V mcp mcp-issue-comment issue_comment "{\"repo\":\"$O/verify-team\",\"number\":\"$N\",\"body\":\"Confirmed by agent\"}"
$V cli mcp-issue-comment-cli issue view "$N" -R "$O/verify-team" -c --json
diff <(jq -S '.' "$EVIDENCE/mcp-issue-comment.out") <(jq -S '.timeline | map(select(.type == "comment")) | last' "$EVIDENCE/mcp-issue-comment-cli.out")
jq -e '.body == "Confirmed by agent" and .type == "comment"' "$EVIDENCE/mcp-issue-comment.out"
jq -e --arg repo "$T" '.repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-issue-comment.event.json"
```

Pass when both exit 0, the comment equals the last comment of the CLI timeline, and the
event carries the Team Space ID.

### MI7. Issue close as not planned

```bash
$V mcp mcp-issue-close issue_set_state "{\"repo\":\"$O/verify-team\",\"number\":\"$N\",\"state\":\"closed\",\"reason\":\"not_planned\",\"comment\":\"Out of scope\"}"
$V cli mcp-issue-close-cli issue view "$N" -R "$O/verify-team" -c --json
diff <(jq -S 'del(.url)' "$EVIDENCE/mcp-issue-close.out") <(jq -S 'del(.timeline)' "$EVIDENCE/mcp-issue-close-cli.out")
jq -e '.state == "closed" and .stateReason == "not_planned"' "$EVIDENCE/mcp-issue-close.out"
jq -e '.timeline | any(.[]; .type == "comment" and .body == "Out of scope")' "$EVIDENCE/mcp-issue-close-cli.out"
jq -e --arg repo "$T" '.repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-issue-close.event.json"
```

Pass when both exit 0, the diff is empty, the Issue is closed as `not_planned`, the CLI
timeline holds the "Out of scope" comment, and the event carries the Team Space ID.

### MI8. Issue reopen

```bash
$V mcp mcp-issue-reopen issue_set_state "{\"repo\":\"$O/verify-team\",\"number\":\"$N\",\"state\":\"open\"}"
$V cli mcp-issue-reopen-cli issue view "$N" -R "$O/verify-team" --json
diff <(jq -S 'del(.url)' "$EVIDENCE/mcp-issue-reopen.out") <(jq -S '.' "$EVIDENCE/mcp-issue-reopen-cli.out")
jq -e '.state == "open" and .stateReason == null' "$EVIDENCE/mcp-issue-reopen.out"
jq -e --arg repo "$T" '.repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-issue-reopen.event.json"
$V mcp mcp-issue-reopen-bad issue_set_state "{\"repo\":\"$O/verify-team\",\"number\":\"$N\",\"state\":\"open\",\"reason\":\"completed\"}"
test $? -eq 1
jq -e '.code == "workspace-argument-invalid"' "$EVIDENCE/mcp-issue-reopen-bad.out"
```

Pass when the reopen result equals the CLI view, the Issue is open, the event carries the
Team Space ID, and `reason` with `state: open` fails with `workspace-argument-invalid`.

### MI9. Issue tool failure

```bash
$V mcp mcp-issue-bad issue_view "{\"repo\":\"$O/verify-team\",\"number\":\"abc\"}"
test $? -eq 1
$V cli mcp-issue-bad-cli issue view abc -R "$O/verify-team" --json
test $? -eq 1
code=$(jq -r '.code' "$EVIDENCE/mcp-issue-bad.out")
test "$(cut -d: -f1 < "$EVIDENCE/mcp-issue-bad-cli.err" | head -n1)" = "$code"
jq -e --arg code "$code" '.outcome == "tool_error" and .error_code == $code and .tool == "issue_view"' "$EVIDENCE/mcp-issue-bad.event.json"
```

Pass when MCP and CLI both exit 1, the structured code matches the CLI stderr prefix, and
the event records `tool_error` with the same code.

### MI10. Nonexistent Issue

A Workspace error translated end to end.

```bash
$V mcp mcp-issue-missing issue_view "{\"repo\":\"$O/verify-team\",\"number\":\"99999\"}"
test $? -eq 1
$V cli mcp-issue-missing-cli issue view 99999 -R "$O/verify-team" --json
test $? -eq 1
code=$(jq -r '.code' "$EVIDENCE/mcp-issue-missing.out")
test "$(cut -d: -f1 < "$EVIDENCE/mcp-issue-missing-cli.err" | head -n1)" = "$code"
jq -e --arg code "$code" '.outcome == "tool_error" and .error_code == $code and .tool == "issue_view"' "$EVIDENCE/mcp-issue-missing.event.json"
```

Pass when MCP and CLI both exit 1, the structured code matches the CLI stderr prefix
(the Workspace's own code, not `workspace-argument-invalid`), and the event records
`tool_error` with the same code.

### MI11. Invalid argument

```bash
$V mcp mcp-issue-invalid issue_list "{\"repo\":\"$O/verify-team\",\"state\":\"reopened\"}"
test $? -eq 1
jq -e '.code == "workspace-argument-invalid" and (.detail.issues | length) >= 1' "$EVIDENCE/mcp-issue-invalid.out"
jq -e '.outcome == "tool_error" and .error_code == "workspace-argument-invalid" and .tool == "issue_list"' "$EVIDENCE/mcp-issue-invalid.event.json"
```

Pass when the call exits 1 with a structured `workspace-argument-invalid` result (not the
SDK's plain validation text) and the event records `tool_error` with the same code.

### MI12. Submit an Issue, send it back, then accept it

The run user O owns a Team Space and opens an Issue assigned to a claimed agent A, a Viewer there. A works through a
fork pull request linked to the Issue and submits it with `issue_verdict`. O sends it back in the browser with a
reason, A finds it with `search` and `acceptance` and submits again, and O accepts it in the browser, which closes it
as completed. MI12 uses one `principal`, which counts toward the 5 agents per hour.

```bash
$V cli mia-repo repo create issue-accept --name "Issue accept" --json id,fullName
T=$(jq -r .id "$EVIDENCE/mia-repo.out")
$V principal acceptor mia-a
A=$(jq -r .agent.username "$EVIDENCE/principal-acceptor.json")
$V mcp --as acceptor mia-claim claim '{}'
```

Open the `claimUrl` from `mia-claim.out` in the run browser, signed in as O, and click `Claim agent`. Replace the code in
`mia-claim.*` as [MH](agent-handoff.md#mh-agent-principals-claims-and-public-spaces) says. Wait 35 s for the gateway's
cache. Then:

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

### MI13. Judge the whole task in the acceptance panel

The run user O claims an agent A, makes it an Editor of a Team Space with three Sheets on Trunk, and assigns it an
Issue. A opens three pull requests linked to the Issue, two that change two Sheets and one that adds a Doc, and merges
them. O opens and merges a fourth linked pull request that deletes the third Sheet, Archive, and then A submits. O opens
the Issue page on its `Acceptance` view, compares every changed file before and after its merge, sees Archive as moved
to Trash with no comparison, finds no outward actions, and accepts. Then A turns on Link Sharing for a file in its own Personal Space: O, who claimed A, sees
it in the panel, and a member E sees neither the row nor the Node ID. MI13 uses one `principal`, which counts toward the
5 agents per hour.

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
`mip-claim.*` as [MH](agent-handoff.md#mh-agent-principals-claims-and-public-spaces) says. Wait 35 s for the gateway's
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
horizontal scroll and its comparison shows both sides' cells, and E's panel says `Only the assignee and the user who
claimed it can see this part.` while E's response has `personalSharing: null` and not the Notes Node ID.

### MI14. Check results in the acceptance panel

The run user O holds a Team Space with a Sales Sheet on Trunk and declares two checks in `.agents/checks.md`. A claimed
Editor agent A and a claimed Viewer agent V each open a pull request linked to one Issue, and each reports both checks
on its own ready pull request. A merges its own, and O merges V's. O's acceptance panel shows the checks after each
pull request's files: A's count, V's do not. Then O moves `.agents/checks.md` to Trash, and the panel says the
repository declares no checks. MI14 uses two `principal`s, which count toward the 5 agents per hour.

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
[MH](agent-handoff.md#mh-agent-principals-claims-and-public-spaces) says. Wait 35 s for the gateway's cache. Then:

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
at 1440 × 900, open `$ORIGIN/spaces/$T/issues/$N`, choose `Acceptance`, and screenshot the page as `mic-panel.png` and
the `Pull requests` section (`section[aria-label="Pull requests"].grid`) as `mic-checks.png`. Each card lists Sales with
`Compare`, then `Checks`. `Add South` shows `totals-match` and `header-unchanged` each `Missing`, with
`mic-v · Passed · Does not count ·` and V's summary. `Raise North` shows both `Passed`, with `mic-a · Passed ·` and A's
summary and no label. At 390 × 844, check that `document.documentElement.scrollWidth` is 390 and screenshot the section
as `mic-checks-narrow.png`. Back at 1440 × 900:

```bash
$V cli mic-trash-checks space node trash "$(jq -r .upload.nodeId "$EVIDENCE/mic-checks.out")" --json
```

Reload, choose `Acceptance`, and screenshot the section as `mic-none-declared.png`. Each card now reads `This repository
declares no checks in .agents/checks.md.` and lists both reported names as `Not declared`, with the same results.

Pass when every command exits as shown, both `jq` checks hold, the first screenshots label A's results as counting and
V's as `Does not count` under the right pull request, the narrow page has no horizontal scroll, and the last screenshot
says the repository declares no checks.

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

### MP1. Pull request create

Personal Space, with an idempotency key.

```bash
$V cli mcp-personal-id repo view "$O/personal" --json
P=$(jq -r '.id' "$EVIDENCE/mcp-personal-id.out")
KEY="mcp-pr-$VERIFY_UVW_RUN-idempotency"
$V mcp mcp-pr-create pr_create "{\"repo\":\"$O/personal\",\"title\":\"Agent change\",\"body\":\"From MCP\",\"idempotency_key\":\"$KEY\"}"
PN=$(jq -r '.number' "$EVIDENCE/mcp-pr-create.out")
W=$(jq -r '.id' "$EVIDENCE/mcp-pr-create.out")
$V mcp mcp-pr-create-again pr_create "{\"repo\":\"$O/personal\",\"title\":\"Agent change\",\"body\":\"From MCP\",\"idempotency_key\":\"$KEY\"}"
$V cli mcp-pr-create-cli pr view "$PN" -R "$O/personal" --json
diff <(jq -S 'del(.url)' "$EVIDENCE/mcp-pr-create.out") <(jq -S '.' "$EVIDENCE/mcp-pr-create-cli.out")
diff <(jq -S '.' "$EVIDENCE/mcp-pr-create.out") <(jq -S '.' "$EVIDENCE/mcp-pr-create-again.out")
jq -e --arg origin "$ORIGIN" --arg p "$P" '.url == "\($origin)/spaces/\($p)/pulls/\(.number)" and .state == "draft" and .kind == "user"' "$EVIDENCE/mcp-pr-create.out"
jq -e --arg repo "$P" '.tool == "pr_create" and .repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-pr-create.event.json"
$V mcp mcp-pr-create-reused pr_create "{\"repo\":\"$O/personal\",\"title\":\"Other change\",\"idempotency_key\":\"$KEY\"}"
test $? -eq 1
jq -e '.code == "CONFLICT" and (.message | contains("Idempotency-Key"))' "$EVIDENCE/mcp-pr-create-reused.out"
```

Pass when every command exits 0 except the reused key, the CLI view equals the MCP result without `url`, the retry
with the same key returns an identical pull request (same `id` and `number`), the `url` is
the Personal Space pull request address, and the event carries the resolved Space ID. Reusing the key with a different
title exits 1 with `CONFLICT` and creates nothing.

### MP2. Pull request view by number

```bash
$V mcp mcp-pr-view pr_view "{\"repo\":\"$O/personal\",\"number\":\"#$PN\"}"
$V cli mcp-pr-view-cli pr view "#$PN" -R "$O/personal" --json
diff <(jq -S 'del(.url)' "$EVIDENCE/mcp-pr-view.out") <(jq -S '.' "$EVIDENCE/mcp-pr-view-cli.out")
jq -e --arg repo "$P" '.repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-pr-view.event.json"
```

Pass when both exit 0, the diff is empty, and the event carries the Personal Space ID.

### MP3. Pull request view by URL

```bash
URL=$(jq -r '.url' "$EVIDENCE/mcp-pr-create.out")
$V mcp mcp-pr-view-url pr_view "{\"repo\":\"$O/personal\",\"number\":\"$URL\"}"
$V cli mcp-pr-view-url-cli pr view "$URL" --json
diff <(jq -S '.' "$EVIDENCE/mcp-pr-view.out") <(jq -S '.' "$EVIDENCE/mcp-pr-view-url.out")
diff <(jq -S 'del(.url)' "$EVIDENCE/mcp-pr-view-url.out") <(jq -S '.' "$EVIDENCE/mcp-pr-view-url-cli.out")
jq -e --arg repo "$P" '.repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-pr-view-url.event.json"
```

Pass when both exit 0, the URL result equals the number result, it equals the CLI view without
`url`, and the event carries the Personal Space ID.

### MP4. Pull request list

```bash
$V mcp mcp-pr-list pr_list "{\"repo\":\"$O/personal\",\"state\":\"all\",\"author\":\"@me\",\"limit\":5}"
$V cli mcp-pr-list-cli pr list -R "$O/personal" -s all -A @me -L 5 --json
diff <(jq -S '.prs | map(del(.url))' "$EVIDENCE/mcp-pr-list.out") <(jq -S '.' "$EVIDENCE/mcp-pr-list-cli.out")
jq -e --arg id "$W" '.prs | length >= 1 and all(.[]; .url != null) and any(.[]; .id == $id)' "$EVIDENCE/mcp-pr-list.out"
jq -e --arg repo "$P" '.repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-pr-list.event.json"
```

Pass when both exit 0, the diff is empty, every listed pull request has a `url`, and the event
carries the Personal Space ID.

### MP5. Pull request edit

```bash
$V mcp mcp-pr-edit pr_edit "{\"repo\":\"$O/personal\",\"number\":\"$PN\",\"title\":\"Agent change v2\",\"body\":\"Edited\"}"
$V cli mcp-pr-edit-cli pr view "$PN" -R "$O/personal" --json
diff <(jq -S 'del(.url)' "$EVIDENCE/mcp-pr-edit.out") <(jq -S '.' "$EVIDENCE/mcp-pr-edit-cli.out")
jq -e '.name == "Agent change v2" and .summary == "Edited"' "$EVIDENCE/mcp-pr-edit.out"
jq -e --arg repo "$P" '.repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-pr-edit.event.json"
$V mcp mcp-pr-edit-bad pr_edit "{\"repo\":\"$O/personal\",\"number\":\"$PN\"}"
test $? -eq 1
jq -e '.code == "workspace-argument-invalid"' "$EVIDENCE/mcp-pr-edit-bad.out"
```

Pass when both exit 0, the diff is empty, title and body changed, the event carries the
Personal Space ID, and an edit without any change fails with `workspace-argument-invalid`.

### MP6. Pull request ready and undo

```bash
$V mcp mcp-pr-ready pr_ready "{\"repo\":\"$O/personal\",\"number\":\"$PN\"}"
$V cli mcp-pr-ready-cli pr view "$PN" -R "$O/personal" --json
diff <(jq -S 'del(.url)' "$EVIDENCE/mcp-pr-ready.out") <(jq -S '.' "$EVIDENCE/mcp-pr-ready-cli.out")
jq -e '.state == "ready"' "$EVIDENCE/mcp-pr-ready.out"
$V mcp mcp-pr-undo pr_ready "{\"repo\":\"$O/personal\",\"number\":\"$PN\",\"undo\":true}"
$V cli mcp-pr-undo-cli pr view "$PN" -R "$O/personal" --json
diff <(jq -S 'del(.url)' "$EVIDENCE/mcp-pr-undo.out") <(jq -S '.' "$EVIDENCE/mcp-pr-undo-cli.out")
jq -e '.state == "draft"' "$EVIDENCE/mcp-pr-undo.out"
jq -e --arg repo "$P" '.repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-pr-undo.event.json"
```

Pass when every command exits 0, both diffs are empty, the pull request is `ready` and then
`draft` again, and the event carries the Personal Space ID.

### MP7. Search Issues

```bash
$V mcp mcp-search-issues search "{\"kind\":\"issues\",\"state\":\"all\",\"author\":\"@me\",\"limit\":5}"
$V cli mcp-search-issues-cli search issues -s all -A @me -L 5 --json
diff <(jq -S '.issues | map(del(.url))' "$EVIDENCE/mcp-search-issues.out") <(jq -S '.' "$EVIDENCE/mcp-search-issues-cli.out")
jq -e --argjson n "$N" '.issues | length >= 1 and all(.[]; .url != null) and any(.[]; .number == $n)' "$EVIDENCE/mcp-search-issues.out"
jq -e '.repo == null and .outcome == "ok"' "$EVIDENCE/mcp-search-issues.event.json"
```

Pass when both exit 0, the diff is empty, every Issue has a `url`, and the event has a null
`repo` because search spans repositories.

### MP8. Search pull requests

```bash
$V mcp mcp-search-prs search "{\"kind\":\"prs\",\"state\":\"all\",\"author\":\"@me\",\"limit\":5}"
$V cli mcp-search-prs-cli search prs -s all -A @me -L 5 --json
diff <(jq -S '.prs | map(del(.url))' "$EVIDENCE/mcp-search-prs.out") <(jq -S '.' "$EVIDENCE/mcp-search-prs-cli.out")
jq -e --arg id "$W" '.prs | length >= 1 and all(.[]; .url != null) and any(.[]; .id == $id)' "$EVIDENCE/mcp-search-prs.out"
jq -e '.repo == null and .outcome == "ok"' "$EVIDENCE/mcp-search-prs.event.json"
```

Pass when both exit 0, the diff is empty, every pull request has a `url`, and the event has a
null `repo`.

### MP9. Browse

```bash
$V mcp mcp-browse-repo browse "{\"repo\":\"$O/personal\"}"
$V cli mcp-browse-repo-cli browse -R "$O/personal" --json
$V mcp mcp-browse-pr browse "{\"repo\":\"$O/personal\",\"number\":\"$PN\"}"
$V cli mcp-browse-pr-cli browse "$PN" -R "$O/personal" --json
$V mcp mcp-browse-issue browse "{\"repo\":\"$O/verify-team\",\"number\":\"$N\"}"
$V cli mcp-browse-issue-cli browse "$N" -R "$O/verify-team" --json
for part in repo pr issue; do
  diff <(jq -S '.' "$EVIDENCE/mcp-browse-$part.out") <(jq -S '.' "$EVIDENCE/mcp-browse-$part-cli.out")
done
jq -e --arg origin "$ORIGIN" --arg p "$P" '.url == "\($origin)/spaces/\($p)"' "$EVIDENCE/mcp-browse-repo.out"
jq -e --arg origin "$ORIGIN" --arg p "$P" --argjson n "$PN" '.url == "\($origin)/spaces/\($p)/pulls/\($n)"' "$EVIDENCE/mcp-browse-pr.out"
jq -e --arg origin "$ORIGIN" --arg t "$T" --argjson n "$N" '.url == "\($origin)/spaces/\($t)/issues/\($n)"' "$EVIDENCE/mcp-browse-issue.out"
jq -e --arg repo "$T" '.repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-browse-issue.event.json"
```

Pass when every command exits 0, each MCP `{url}` equals the CLI `--json` output, the URLs are
the repository, pull request and Issue addresses, and each event carries its resolved Space ID.

### MP10. Nonexistent pull request

```bash
$V mcp mcp-pr-missing pr_view "{\"repo\":\"$O/personal\",\"number\":\"99999\"}"
test $? -eq 1
$V cli mcp-pr-missing-cli pr view 99999 -R "$O/personal" --json
test $? -eq 1
code=$(jq -r '.code' "$EVIDENCE/mcp-pr-missing.out")
test "$(cut -d: -f1 < "$EVIDENCE/mcp-pr-missing-cli.err" | head -n1)" = "$code"
jq -e --arg code "$code" '.outcome == "tool_error" and .error_code == $code and .tool == "pr_view"' "$EVIDENCE/mcp-pr-missing.event.json"
```

Pass when MCP and CLI both exit 1, the structured code matches the CLI stderr prefix, and the
event records `tool_error` with the same code.

### MP11. Reviewable pull requests

MP11 and MP12 share one setup. Two claimed agent principals count 2 of the 5 agents per hour. A3 owns a
repository R with a Budget Sheet on Trunk, makes B3 a Viewer, and assigns B3 an Issue. The run user owns
`private-x`, which neither agent can see, with a ready pull request shared with its members:

```bash
$V principal a3 mp12-a3-principal
$V principal b3 mp12-b3-principal
$V mcp --as a3 mp12-claim-a3 claim '{}'
$V mcp --as b3 mp12-claim-b3 claim '{}'
```

Open each `claimUrl` in the run browser, signed in as the run user, click `Claim agent`, and replace the codes as
[MH](agent-handoff.md#mh-agent-principals-claims-and-public-spaces) says. Wait 35 s for the gateway's cache.

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

Pass when both `before` searches return `{"prs":[]}` although `private-x` has a ready pull request shared with its
members, and `mp11-b3-issues` lists the Issue. After B3 proposes, `mp11-a3-after` lists exactly B3's pull request,
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
browser. MP13 uses one `principal`, which counts toward the 5 agents per hour.

```bash
$V cli mpl-repo repo create issue-link --name "Issue link" --json id,fullName
T=$(jq -r .id "$EVIDENCE/mpl-repo.out")
$V principal linker mpl-a
A=$(jq -r .agent.username "$EVIDENCE/principal-linker.json")
$V mcp --as linker mpl-claim claim '{}'
```

Open the `claimUrl` from `mpl-claim.out` in the run browser, signed in as O, and click `Claim agent`. Replace the code in
`mpl-claim.*` as [MH](agent-handoff.md#mh-agent-principals-claims-and-public-spaces) says. Then:

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

### MP14. An agent's budget

An agent principal (see [the principals reference](../references/stories.md)) opens pull requests in its own Personal
Space until its budget of 10 is used. Creating the principal counts toward the 5 agents an hour. One creation fails
first because the journey holds the write lock of the run's collaboration database while it runs. Collaboration then
answers `CONFLICT` (`Database Adapter failed`) after its 5-second busy timeout, which leaves a failed Operation.

```bash
$V principal budget mcp-budget-principal
A=$(jq -r '.agent.username' "$EVIDENCE/principal-budget.json")
$V mcp --as budget mcp-budget-before whoami
jq -e '.budget == {openWorktrees: {used: 0, limit: 10}, merges: {used: 0, limit: 50}}' "$EVIDENCE/mcp-budget-before.out"
(echo "BEGIN EXCLUSIVE;"; sleep 15; echo "COMMIT;") | sqlite3 "$(dirname "$EVIDENCE")/data/univer-collaboration.sqlite" &
sleep 2
$V mcp --as budget mcp-budget-failed pr_create "{\"repo\":\"$A/personal\",\"title\":\"Task F\",\"idempotency_key\":\"mcp-budget-$VERIFY_UVW_RUN-failed\"}"
test $? -eq 1
wait
$V mcp --as budget mcp-budget-after-failure whoami
jq -e '.budget.openWorktrees.used == 0' "$EVIDENCE/mcp-budget-after-failure.out"
for n in $(seq 1 10); do
  $V mcp --as budget "mcp-budget-pr-$n" pr_create "{\"repo\":\"$A/personal\",\"title\":\"Task $n\",\"idempotency_key\":\"mcp-budget-$VERIFY_UVW_RUN-$n\"}" || break
done
$V mcp --as budget mcp-budget-full whoami
jq -e '.budget.openWorktrees == {used: 10, limit: 10}' "$EVIDENCE/mcp-budget-full.out"
$V mcp --as budget mcp-budget-over pr_create "{\"repo\":\"$A/personal\",\"title\":\"Task 11\"}"
test $? -eq 1
jq -e '.code == "AGENT_QUOTA_EXCEEDED" and (.message | contains("at most 10 open pull requests. Merge or discard one"))' "$EVIDENCE/mcp-budget-over.out"
jq -e '.outcome == "tool_error" and .error_code == "AGENT_QUOTA_EXCEEDED" and .principal_category == "agent_unclaimed"' "$EVIDENCE/mcp-budget-over.event.json"
$V mcp --as budget mcp-budget-failed-replay pr_create "{\"repo\":\"$A/personal\",\"title\":\"Task F\",\"idempotency_key\":\"mcp-budget-$VERIFY_UVW_RUN-failed\"}"
test $? -eq 1
jq -e '.code == "AGENT_QUOTA_EXCEEDED"' "$EVIDENCE/mcp-budget-failed-replay.out"
$V mcp --as budget mcp-budget-failed-replay-whoami whoami
jq -e '.budget.openWorktrees.used == 10' "$EVIDENCE/mcp-budget-failed-replay-whoami.out"
$V metrics | grep 'workspace_ceiling_denials_total{action="openWorktree"' > "$EVIDENCE/mcp-budget-denials.txt"
grep -F 'code="AGENT_QUOTA_EXCEEDED",principal_category="agent_unclaimed"} 2' "$EVIDENCE/mcp-budget-denials.txt"
$V mcp --as budget mcp-budget-replay pr_create "{\"repo\":\"$A/personal\",\"title\":\"Task 10\",\"idempotency_key\":\"mcp-budget-$VERIFY_UVW_RUN-10\"}"
diff <(jq -S '{id, number}' "$EVIDENCE/mcp-budget-pr-10.out") <(jq -S '{id, number}' "$EVIDENCE/mcp-budget-replay.out")
N=$(jq -r '.number' "$EVIDENCE/mcp-budget-pr-1.out")
$V mcp --as budget mcp-budget-ready pr_ready "{\"repo\":\"$A/personal\",\"number\":\"$N\"}"
$V mcp --as budget mcp-budget-merge pr_merge "{\"repo\":\"$A/personal\",\"number\":\"$N\"}"
$V mcp --as budget mcp-budget-after whoami
jq -e '.budget == {openWorktrees: {used: 9, limit: 10}, merges: {used: 1, limit: 50}}' "$EVIDENCE/mcp-budget-after.out"
$V mcp --as budget mcp-budget-freed pr_create "{\"repo\":\"$A/personal\",\"title\":\"Task 11\"}"
$V mcp mcp-budget-person whoami
jq -e 'has("budget") | not' "$EVIDENCE/mcp-budget-person.out"
```

Pass when the locked creation exits 1 and leaves 0 used, all ten creations succeed, the eleventh exits 1 with
`AGENT_QUOTA_EXCEEDED` and a message that says to merge or discard one, its event records the code for an
`agent_unclaimed` principal, the replay with the failed key also gets `AGENT_QUOTA_EXCEEDED` and leaves 10 used, the
denial counter for `openWorktree` reads 2, the replay with the tenth key returns the tenth pull request, the merge
leaves 9 open and 1 merge in `whoami`, the next creation succeeds, and the run user's `whoami` has no `budget`.

### MP15. Check results on a pull request

The run user O holds a Team Space R and declares two checks in `.agents/checks.md` on its Trunk. A claimed agent A, a
Viewer, proposes a change and reports both checks with `pr_check`. A person E sees them in the browser, marked as not
counting. O then changes the Sheet on Trunk, and the page marks A's results out of date. A claimed agent B, an Editor
who may merge, reports both again, and its results count, also after B merges. MP15 uses two `principal`s, which count
toward the 5 agents per hour.

```bash
$V cli mpc-repo repo create checks-demo --name "Checks demo" --json id,fullName
T=$(jq -r .id "$EVIDENCE/mpc-repo.out"); R="$O/checks-demo"
$V cli mpc-folder space node create "$R" --name .agents --json
printf '# Checks\n\n## totals-match\nB3 equals SUM(B2:B2).\n\n## header-unchanged\nRow 1 reads Region, Total.\n' > "$EVIDENCE/mpc-checks.md"
$V cli mpc-checks blob upload --file "$EVIDENCE/mpc-checks.md" --space "$T" --parent "$(jq -r .node.nodeId "$EVIDENCE/mpc-folder.out")" --name checks.md --json
$V cli mpc-h-pr pr create -R "$R" -t "Sales" --json
$V cli mpc-h-unit unit create --worktree "$(jq -r .id "$EVIDENCE/mpc-h-pr.out")" --space "$R" --type sheet --name Sales --json
U=$(jq -r .unit.unitId "$EVIDENCE/mpc-h-unit.out"); RES=$(jq -r .unit.resourceId "$EVIDENCE/mpc-h-unit.out")
$V cli mpc-h-exec execute --worktree "$(jq -r .id "$EVIDENCE/mpc-h-pr.out")" --unit "$U" --json -e 'univerAPI.getActiveWorkbook().getActiveSheet().getRange("A1:B3").setValues([["Region","Total"],["North",40],["Sum",null]]); univerAPI.getActiveWorkbook().getActiveSheet().getRange("B3").setFormula("=SUM(B2:B2)");'
$V cli mpc-h-ready pr ready "$(jq -r .number "$EVIDENCE/mpc-h-pr.out")" -R "$R" --json state
$V cli mpc-h-merge pr merge "$(jq -r .number "$EVIDENCE/mpc-h-pr.out")" -R "$R" --json state
$V principal checker-a mpc-a
$V principal checker-b mpc-b
$V mcp --as checker-a mpc-claim-a claim '{}'
$V mcp --as checker-b mpc-claim-b claim '{}'
```

Open each `claimUrl` in the run browser, signed in as O, and click `Claim agent`. Replace the codes as
[MH](agent-handoff.md#mh-agent-principals-claims-and-public-spaces) says. Wait 35 s for the gateway's cache. Register a
person E with `POST $ORIGIN/api/auth/password/register` and keep the password outside `$EVIDENCE`. Then:

```bash
A=$(jq -r .agent.username "$EVIDENCE/principal-checker-a.json"); B=$(jq -r .agent.username "$EVIDENCE/principal-checker-b.json")
$V cli mpc-member-a repo member add "$A" --role viewer -R "$R" --json
$V cli mpc-member-b repo member add "$B" --role editor -R "$R" --json
$V cli mpc-member-e repo member add <E> --role viewer -R "$R" --json
$V mcp --as checker-a mpc-a-pr pr_create "{\"repo\":\"$R\",\"title\":\"Raise North\"}"
W=$(jq -r .id "$EVIDENCE/mpc-a-pr.out"); N=$(jq -r .number "$EVIDENCE/mpc-a-pr.out")
$V mcp --as checker-a mpc-a-add unit_add "{\"worktree\":\"$W\",\"resource\":\"$RES\"}"
$V mcp --as checker-a mpc-a-exec execute "$(jq -nc --arg w "$W" --arg u "$U" '{worktree:$w,unit:$u,code:"univerAPI.getActiveWorkbook().getActiveSheet().getRange(\"B2\").setValue(50);"}')"
$V mcp --as checker-a mpc-a-draft pr_check "{\"repo\":\"$R\",\"number\":\"$N\",\"name\":\"totals-match\",\"state\":\"passed\"}"
test $? -eq 1
jq -e '.code == "CONFLICT"' "$EVIDENCE/mpc-a-draft.out"
$V mcp --as checker-a mpc-a-ready pr_ready "{\"repo\":\"$R\",\"number\":\"$N\"}"
for name in totals-match header-unchanged; do
  $V mcp --as checker-a "mpc-a-$name" pr_check "{\"repo\":\"$R\",\"number\":\"$N\",\"name\":\"$name\",\"state\":\"passed\",\"summary\":\"Read on the draft.\"}"
done
$V mcp --as checker-a mpc-a-view pr_view "{\"repo\":\"$R\",\"number\":\"$N\"}"
jq -e '[.checks[] | {name, declared, state, counts: [.results[].counts]}] == [{name:"totals-match",declared:true,state:"missing",counts:[false]},{name:"header-unchanged",declared:true,state:"missing",counts:[false]}] and .checks[0].results[0].current' "$EVIDENCE/mpc-a-view.out"
$V cli mpc-cli-view pr view "$N" -R "$R" --json checks
jq -e '.checks == {passed: 0, failed: 0, missing: 2}' "$EVIDENCE/mpc-cli-view.out"
```

In a second browser session (`AGENT_BROWSER_SESSION=verify-uvw-$VERIFY_UVW_RUN-e`) signed in as E, open
`$ORIGIN/spaces/$T/pulls/$N`, scroll the `Checks` section into view, and screenshot `mp15-checks-viewer.png`. It lists
`totals-match` and `header-unchanged`, each `Missing`, with A's name, `Passed`, `Does not count` and the summary.

O changes the Sheet on Trunk through another pull request, then E reloads:

```bash
$V cli mpc-h2-pr pr create -R "$R" -t "Header" --json
$V cli mpc-h2-add unit add --worktree "$(jq -r .id "$EVIDENCE/mpc-h2-pr.out")" --resource "$RES" --json
$V cli mpc-h2-exec execute --worktree "$(jq -r .id "$EVIDENCE/mpc-h2-pr.out")" --unit "$U" --json -e 'univerAPI.getActiveWorkbook().getActiveSheet().getRange("C1").setValue("Note");'
$V cli mpc-h2-ready pr ready "$(jq -r .number "$EVIDENCE/mpc-h2-pr.out")" -R "$R" --json state
$V cli mpc-h2-merge pr merge "$(jq -r .number "$EVIDENCE/mpc-h2-pr.out")" -R "$R" --json state
$V mcp --as checker-a mpc-a-stale pr_view "{\"repo\":\"$R\",\"number\":\"$N\"}"
jq -e '[.checks[].results[] | .current] == [false, false]' "$EVIDENCE/mpc-a-stale.out"
```

E's reloaded page shows both results struck through and `Out of date`: screenshot `mp15-checks-out-of-date.png`.
Then B, who may merge, verifies and reports:

```bash
for name in totals-match header-unchanged; do
  $V mcp --as checker-b "mpc-b-$name" pr_check "{\"repo\":\"$R\",\"number\":\"$N\",\"name\":\"$name\",\"state\":\"passed\",\"summary\":\"Read on trunk.\"}"
done
$V mcp --as checker-b mpc-b-view pr_view "{\"repo\":\"$R\",\"number\":\"$N\"}"
jq -e '[.checks[] | .state] == ["passed", "passed"] and ([.checks[].results[] | select(.counts) | .reporter.username] | unique) == ["'"$B"'"]' "$EVIDENCE/mpc-b-view.out"
$V mcp --as checker-b mpc-b-merge pr_merge "{\"repo\":\"$R\",\"number\":\"$N\"}"
$V mcp --as checker-b mpc-b-merged pr_view "{\"repo\":\"$R\",\"number\":\"$N\"}"
jq -e '.state == "merged" and ([.checks[] | .state] == ["passed", "passed"])' "$EVIDENCE/mpc-b-merged.out"
$V mcp --as checker-b mpc-b-after-merge pr_check "{\"repo\":\"$R\",\"number\":\"$N\",\"name\":\"totals-match\",\"state\":\"failed\"}"
test $? -eq 1
jq -e '.code == "CONFLICT"' "$EVIDENCE/mpc-b-after-merge.out"
```

E's reloaded page shows both checks `Passed`, B's results without a label and A's still `Out of date`: screenshot
`mp15-checks-counted.png`.

Pass when the draft report exits 1 with `CONFLICT`, A's results are current but do not count and the CLI summary reads
2 missing, the first screenshot shows them, the Trunk merge leaves A's results `current: false` and the second
screenshot marks them out of date, B's results count and both checks read `passed`, they still do after B merges, and a
report on the merged pull request exits 1 with `CONFLICT`.

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

Open each open pull request's `Files changed`, click `Compare`, and screenshot `mp16-trashed-removal.png`. The file
reads `Deleted`, and the panel says `This document is marked for deletion. Its content will not be published.`

Pass when the draft's readable comparisons answer 200, both reads of the merged pull request exit 0 with
`mergeResult: "removed"`, also after permanent deletion with `nodeId: null`, every comparison mode answers 409 for both
open pull requests, the server log has no 500, and the screenshot shows the deletion note and no error.

## Gotchas

- The MCP-mode gotchas in [MCP gateway](mcp.md#gotchas) apply.
- MP12 measures the model as well as the product. Quote `transcript.jsonl` when it goes wrong, as
  [stories](../references/stories.md) says. A story's first `error` lines can be opencode's own `fetch` and
  `execute` wrapper, which never reach Workspace.
