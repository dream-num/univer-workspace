# Issues and pull requests over MCP

An agent connected to the MCP gateway creates, views, lists, edits, comments on, closes and reopens Issues, and
creates, views, lists, edits, readies, searches and browses pull requests. Each result matches what `uvw --json`
shows for the same object, errors keep their Workspace codes, and every call leaves a usage event. Agent Mode's Issue
and pull request journeys are in the `agent-mode-*` files ([the index](README.md#features)).

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

## How to get to it (user POV)

An MCP client connected to `$MCP_URL` calls `issue_create`, `issue_view`, `issue_list`, `issue_edit`,
`issue_comment`, `issue_set_state`, `pr_create`, `pr_view`, `pr_list`, `pr_edit`, `pr_ready`, `search` and `browse`.
The same objects show in `uvw issue`, `uvw pr`, `uvw search` and `uvw browse`.

## Driving it with agent-browser and uvw

Mode: mcp.

Start every shell with `eval "$($V env)"`. Each `$V mcp`
call checks its usage event and credential leakage, and exit 5 fails the journey.
[MCP mode](../references/mcp-mode.md) lists the helper commands and their exit codes. MI1 through MI11 use the Team Space, and MP1 through MP10 the Personal Space:

```bash
O=verify-$VERIFY_UVW_RUN
# The Team Space that M4 in mcp.md creates; this creates it on a run that skipped M4.
$V uvw repo view "$O/verify-team" --json >/dev/null 2>&1 \
  || $V cli mcp-repo-create repo create verify-team --name "Verify Team" --json id,fullName
```

### MI1. Issue create

Run: helper.

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

Run: helper.

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

Run: helper.

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

Run: helper.

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

Run: helper.

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

Run: helper.

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

Run: helper.

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

Run: helper.

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

Run: helper.

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

Run: helper.

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

Run: helper.

```bash
$V mcp mcp-issue-invalid issue_list "{\"repo\":\"$O/verify-team\",\"state\":\"reopened\"}"
test $? -eq 1
jq -e '.code == "workspace-argument-invalid" and (.detail.issues | length) >= 1' "$EVIDENCE/mcp-issue-invalid.out"
jq -e '.outcome == "tool_error" and .error_code == "workspace-argument-invalid" and .tool == "issue_list"' "$EVIDENCE/mcp-issue-invalid.event.json"
```

Pass when the call exits 1 with a structured `workspace-argument-invalid` result (not the
SDK's plain validation text) and the event records `tool_error` with the same code.

### MP1. Pull request create

Run: helper.

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
diff <(jq -S 'del(.url, .checks)' "$EVIDENCE/mcp-pr-create.out") <(jq -S 'del(.checks)' "$EVIDENCE/mcp-pr-create-cli.out")
diff <(jq -S '.' "$EVIDENCE/mcp-pr-create.out") <(jq -S '.' "$EVIDENCE/mcp-pr-create-again.out")
jq -e --arg origin "$ORIGIN" --arg p "$P" '.url == "\($origin)/spaces/\($p)/pulls/\(.number)" and .state == "draft" and .kind == "user"' "$EVIDENCE/mcp-pr-create.out"
jq -e --arg repo "$P" '.tool == "pr_create" and .repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-pr-create.event.json"
$V mcp mcp-pr-create-reused pr_create "{\"repo\":\"$O/personal\",\"title\":\"Other change\",\"idempotency_key\":\"$KEY\"}"
test $? -eq 1
jq -e '.code == "CONFLICT" and (.message | contains("Idempotency-Key"))' "$EVIDENCE/mcp-pr-create-reused.out"
```

Pass when every command exits 0 except the reused key, the CLI view equals the MCP result without `url` and `checks`, whose MCP and uvw shapes differ by design (MP15 in [declared checks](agent-mode-checks.md)), the retry
with the same key returns an identical pull request (same `id` and `number`), the `url` is
the Personal Space pull request address, and the event carries the resolved Space ID. Reusing the key with a different
title exits 1 with `CONFLICT` and creates nothing.

### MP2. Pull request view by number

Run: helper.

```bash
$V mcp mcp-pr-view pr_view "{\"repo\":\"$O/personal\",\"number\":\"#$PN\"}"
$V cli mcp-pr-view-cli pr view "#$PN" -R "$O/personal" --json
diff <(jq -S 'del(.url, .checks)' "$EVIDENCE/mcp-pr-view.out") <(jq -S 'del(.checks)' "$EVIDENCE/mcp-pr-view-cli.out")
jq -e --arg repo "$P" '.repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-pr-view.event.json"
```

Pass when both exit 0, the diff is empty, and the event carries the Personal Space ID.

### MP3. Pull request view by URL

Run: helper.

```bash
URL=$(jq -r '.url' "$EVIDENCE/mcp-pr-create.out")
$V mcp mcp-pr-view-url pr_view "{\"repo\":\"$O/personal\",\"number\":\"$URL\"}"
$V cli mcp-pr-view-url-cli pr view "$URL" --json
diff <(jq -S '.' "$EVIDENCE/mcp-pr-view.out") <(jq -S '.' "$EVIDENCE/mcp-pr-view-url.out")
diff <(jq -S 'del(.url, .checks)' "$EVIDENCE/mcp-pr-view-url.out") <(jq -S 'del(.checks)' "$EVIDENCE/mcp-pr-view-url-cli.out")
jq -e --arg repo "$P" '.repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-pr-view-url.event.json"
```

Pass when both exit 0, the URL result equals the number result, it equals the CLI view without
`url` and `checks`, and the event carries the Personal Space ID.

### MP4. Pull request list

Run: helper.

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

Run: helper.

```bash
$V mcp mcp-pr-edit pr_edit "{\"repo\":\"$O/personal\",\"number\":\"$PN\",\"title\":\"Agent change v2\",\"body\":\"Edited\"}"
$V cli mcp-pr-edit-cli pr view "$PN" -R "$O/personal" --json
diff <(jq -S 'del(.url, .checks)' "$EVIDENCE/mcp-pr-edit.out") <(jq -S 'del(.checks)' "$EVIDENCE/mcp-pr-edit-cli.out")
jq -e '.name == "Agent change v2" and .summary == "Edited"' "$EVIDENCE/mcp-pr-edit.out"
jq -e --arg repo "$P" '.repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-pr-edit.event.json"
$V mcp mcp-pr-edit-bad pr_edit "{\"repo\":\"$O/personal\",\"number\":\"$PN\"}"
test $? -eq 1
jq -e '.code == "workspace-argument-invalid"' "$EVIDENCE/mcp-pr-edit-bad.out"
```

Pass when both exit 0, the diff is empty, title and body changed, the event carries the
Personal Space ID, and an edit without any change fails with `workspace-argument-invalid`.

### MP6. Pull request ready and undo

Run: helper.

```bash
$V mcp mcp-pr-ready pr_ready "{\"repo\":\"$O/personal\",\"number\":\"$PN\"}"
$V cli mcp-pr-ready-cli pr view "$PN" -R "$O/personal" --json
diff <(jq -S 'del(.url, .checks)' "$EVIDENCE/mcp-pr-ready.out") <(jq -S 'del(.checks)' "$EVIDENCE/mcp-pr-ready-cli.out")
jq -e '.state == "ready"' "$EVIDENCE/mcp-pr-ready.out"
$V mcp mcp-pr-undo pr_ready "{\"repo\":\"$O/personal\",\"number\":\"$PN\",\"undo\":true}"
$V cli mcp-pr-undo-cli pr view "$PN" -R "$O/personal" --json
diff <(jq -S 'del(.url, .checks)' "$EVIDENCE/mcp-pr-undo.out") <(jq -S 'del(.checks)' "$EVIDENCE/mcp-pr-undo-cli.out")
jq -e '.state == "draft"' "$EVIDENCE/mcp-pr-undo.out"
jq -e --arg repo "$P" '.repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-pr-undo.event.json"
```

Pass when every command exits 0, both diffs are empty, the pull request is `ready` and then
`draft` again, and the event carries the Personal Space ID.

### MP7. Search Issues

Run: helper.

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

Run: helper.

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

Run: helper.

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

Run: helper.

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

## Gotchas

- The MCP-mode gotchas in [MCP gateway](mcp.md#gotchas) apply.
