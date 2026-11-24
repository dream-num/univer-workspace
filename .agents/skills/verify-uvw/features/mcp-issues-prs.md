# Issues and pull requests over MCP

An agent connected to the MCP gateway creates, views, lists, edits, comments on, closes and reopens Issues, and
creates, views, lists, edits, readies, searches and browses pull requests. Each result matches what `uvw --json`
shows for the same object, errors keep their Workspace codes, and every call leaves a usage event.

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

## How to get to it (user POV)

An MCP client connected to `$MCP_URL` calls `issue_create`, `issue_view`, `issue_list`, `issue_edit`,
`issue_comment`, `issue_set_state`, `pr_create`, `pr_view`, `pr_list`, `pr_edit`, `pr_ready`, `search` and
`browse`. The same objects show in `uvw issue`, `uvw pr`, `uvw search` and `uvw browse`. An agent asked to check
its work calls `search` for the Issues assigned to it and the pull requests waiting for it, then acts on them.

## Driving it with agent-browser and uvw

Run these in an MCP-mode instance, started as in [MCP gateway](mcp.md): `VERIFY_UVW_MCP=1 $V up`,
`$V user` and a `$V doctor` with no `FAIL` lines. Start every shell with `eval "$($V env)"`. Each `$V mcp`
call checks its usage event and credential leakage, and exit 5 fails the journey.
[MCP mode](../references/mcp-mode.md) lists the helper commands and their exit codes. MI1 through MI11 use the Team Space, and MP1 through MP10 the Personal Space:

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

## Gotchas

- The MCP-mode gotchas in [MCP gateway](mcp.md#gotchas) apply.
- MP12 measures the model as well as the product. Quote `transcript.jsonl` when it goes wrong, as
  [stories](../references/stories.md) says. A story's first `error` lines can be opencode's own `fetch` and
  `execute` wrapper, which never reach Workspace.
