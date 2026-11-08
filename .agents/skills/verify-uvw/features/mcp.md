# MCP gateway

An agent connects to a disposable Docker gateway with its own Workspace session, reads
identity, repositories, Issues, pull requests, search and browse links through either MCP protocol, and leaves correlated usage evidence.

## Sub-features

- M1 starts the image and verifies the disposable environment.
- M2 and M3 read identity over the 2026-07-28 and 2025-11-25 protocols.
- M4 and M5 compare repository lists and details with uvw.
- M6 preserves a missing-repository error and its usage event.
- M7 checks toolsets, the ordered tool list, schemas, and per-tool annotations.
- M8 rejects missing and invalid credentials in both protocols.
- M9 rejects an untrusted Origin.
- M10 refuses development authentication in production.
- M11 calls the gateway from opencode.
- MI1 creates an Issue with a label and an assignee and compares it with the CLI view.
- MI2 and MI3 view an Issue, with and without its timeline, against the CLI.
- MI4 lists Issues against the CLI.
- MI5 edits an Issue and compares it with the CLI view.
- MI6 comments on an Issue and compares it with the CLI timeline.
- MI7 and MI8 close an Issue as not planned and reopen it.
- MI9 preserves a missing-Issue-number error and its usage event.
- MI10 preserves a nonexistent-Issue error from the Workspace and its usage event.
- MI11 returns a structured `workspace-argument-invalid` for an invalid argument and records its usage event.
- MP1 creates a Personal Space pull request with an idempotency key, and the same key returns the same pull request.
- MP2 and MP3 view a pull request by number and by Browser URL against the CLI.
- MP4 lists pull requests against the CLI.
- MP5 edits a pull request and compares it with the CLI view.
- MP6 marks a pull request ready and moves it back to draft with `undo`.
- MP7 and MP8 search Issues and pull requests against the CLI.
- MP9 compares browse for a repository, a pull request and an Issue with the CLI.
- MP10 preserves a nonexistent-pull-request error and its usage event.
- M12 removes this run's resources and preserves developer processes.

## How to get to it (user POV)

Use `V=.agents/skills/verify-uvw/bin/verify-uvw` from the repository root on macOS
Docker Desktop. Start with `VERIFY_UVW_MCP=1 $V up`, then `$V user`. The gateway
publishes `http://127.0.0.1:3930/mcp`. Parallel runs need their own root and all three
ports. `eval "$($V env)"` provides the MCP URL and the isolated opencode directory.

## Driving it with agent-browser and uvw

Use Bash for these commands. Prerequisites are the baseline CLI build and dependencies,
Docker Desktop, `jq`, and opencode for M11. No browser login is needed. Each MCP call
checks the usage event and credential leakage automatically. Exit 5 fails the journey.

**M1. Environment.**

```bash
VERIFY_UVW_MCP=1 $V up
$V user
eval "$($V env)"
RUN="${VERIFY_UVW_ROOT:-/tmp/verify-uvw}/$VERIFY_UVW_RUN"
$V doctor > "$EVIDENCE/mcp-doctor.txt"
echo $? > "$EVIDENCE/mcp-doctor.exit"
```

Pass when doctor exits 0, has no `FAIL` lines, and prints an `ok` for every MCP check
in [local verification section 6.2](../../../../docs/design/workspace-mcp/local-verification.zh-CN.md).

**M2. Identity, new protocol.**

```bash
$V mcp mcp-whoami whoami
$V cli mcp-whoami-cli auth status --json
diff <(jq -S '.subject' "$EVIDENCE/mcp-whoami.out") <(jq -S '.subject' "$EVIDENCE/mcp-whoami-cli.out")
jq -e --arg origin "$ORIGIN" '.origin == $origin' "$EVIDENCE/mcp-whoami.out"
jq -e '.client_name != null' "$EVIDENCE/mcp-whoami.event.json"
```

Pass when both commands exit 0, subjects match, identity origin equals `$ORIGIN`, and
`client_name` is non-null. The origin must not contain `host.docker.internal`.

**M3. Identity, old protocol.**

```bash
$V mcp --protocol 2025-11-25 mcp-whoami-legacy whoami
jq -e '.protocolVersion == "2025-11-25"' "$EVIDENCE/mcp-whoami-legacy.result.json"
diff "$EVIDENCE/mcp-whoami.out" "$EVIDENCE/mcp-whoami-legacy.out"
jq -e '.client_name == null' "$EVIDENCE/mcp-whoami-legacy.event.json"
```

Pass when the command exits 0, the result records 2025-11-25, identity matches M2,
and the event has a null client name.

**M4. Repository list.** Create a Team Space as in [Issues](issues.md).

```bash
O=verify-$VERIFY_UVW_RUN
$V cli mcp-repo-create repo create verify-team --name "Verify Team" --json id,fullName
$V mcp mcp-repo-list repo_list
$V cli mcp-repo-list-cli repo list --json
diff <(jq -S '.repos | map(del(.url))' "$EVIDENCE/mcp-repo-list.out") <(jq -S '.' "$EVIDENCE/mcp-repo-list-cli.out")
jq -e '[.repos[].type] | index("personal") != null and index("team") != null' "$EVIDENCE/mcp-repo-list.out"
```

Pass when commands exit 0, the diff is empty, and the list includes Personal and Team Spaces.

**M5. Repository details.**

```bash
for slug in personal verify-team; do
  $V mcp "mcp-repo-$slug" repo_view "{\"repo\":\"$O/$slug\"}"
  $V cli "mcp-repo-$slug-cli" repo view "$O/$slug" --json
  diff <(jq -S 'del(.url)' "$EVIDENCE/mcp-repo-$slug.out") <(jq -S '.' "$EVIDENCE/mcp-repo-$slug-cli.out")
done
```

Pass when both tools and both CLI calls exit 0, and both diffs are empty. Put the
repository before `--json`, which otherwise consumes it as a field list.

**M6. Tool failure.**

```bash
$V mcp mcp-repo-missing repo_view "{\"repo\":\"$O/no-such-repo\"}"
test $? -eq 1
$V cli mcp-repo-missing-cli repo view "$O/no-such-repo" --json
test $? -eq 1
code=$(jq -r '.code' "$EVIDENCE/mcp-repo-missing.out")
test "$(cut -d: -f1 < "$EVIDENCE/mcp-repo-missing-cli.err" | head -n1)" = "$code"
jq -e --arg code "$code" '.outcome == "tool_error" and .error_code == $code' "$EVIDENCE/mcp-repo-missing.event.json"
```

Pass when MCP and CLI both exit 1, the structured code matches the CLI stderr prefix,
and the event records `tool_error` with the same code.

**M7. Tool lists.**

```bash
$V mcp-tools mcp-tools-core
$V mcp-tools --toolsets all mcp-tools-all
$V mcp-tools --toolsets nope mcp-tools-unknown
test $? -eq 3
for label in core all; do
  jq -e '
    (map(.name) == ["whoami","repo_list","repo_view","issue_list","issue_view","issue_create","issue_edit","issue_comment","issue_set_state","pr_list","pr_view","pr_create","pr_edit","pr_ready","search","browse"])
    and all(.[]; .annotations.destructiveHint == false and .annotations.openWorldHint == false and .inputSchema != null and .outputSchema != null)
    and all(.[] | select(.name | test("^(whoami|repo_|issue_list|issue_view|pr_list|pr_view|search|browse)")); .annotations.readOnlyHint == true)
    and all(.[] | select(.name | test("^(issue_(create|edit|comment|set_state)|pr_(create|edit|ready))$")); .annotations.readOnlyHint == false)
  ' "$EVIDENCE/mcp-tools-$label.out"
done
diff <(jq -S . "$EVIDENCE/mcp-tools-core.out") <(jq -S . "$EVIDENCE/mcp-tools-all.out")
jq -e '.status == 400 and (.body | fromjson | .valid == ["core","files","admin","all"])' "$EVIDENCE/mcp-tools-unknown.out"
```

Pass when core and all exit 0 with the same fixed tool order, schemas and annotations
(nine read-only tools, seven non-destructive write tools); unknown exits 3 with HTTP 400 and
the valid toolset names. Tool lists have no event file.

**M8. Authentication.**

```bash
for protocol in 2026-07-28 2025-11-25; do
  for auth in none invalid; do
    label="mcp-auth-$protocol-$auth"
    $V mcp --protocol "$protocol" --auth "$auth" "$label" whoami
    test $? -eq 4
    jq -e '.status == 401 and (.www_authenticate | contains("resource_metadata"))' "$EVIDENCE/$label.out"
  done
done
```

Pass when all four calls exit 4 with HTTP 401 and a protected-resource metadata challenge.
No usage event is expected because authentication rejects the handshake.

**M9. Origin check.**

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -H 'Origin: http://evil.example' \
  -H "Authorization: Bearer $(cat "$RUN/home/mcp-session")" -X POST "$MCP_URL" > "$EVIDENCE/mcp-origin.txt"
test "$(cat "$EVIDENCE/mcp-origin.txt")" = 403
```

Pass when the response is 403.

**M10. Production refusal.**

```bash
cid=$(docker run -d --network none --label "com.docker.compose.project=$MCP_PROJECT" \
  -e MCP_ROLE=gateway -e NODE_ENV=production -e MCP_DEV_SESSION_PASSTHROUGH=1 "$MCP_IMAGE")
for ((i=0; i<20; i++)); do
  test "$(docker inspect -f '{{.State.Running}}' "$cid")" = false && break
  sleep 1
done
docker logs "$cid" > "$EVIDENCE/mcp-prod-refuse.out" 2>&1
docker inspect -f '{{.State.ExitCode}}' "$cid" > "$EVIDENCE/mcp-prod-refuse.exit"
running=$(docker inspect -f '{{.State.Running}}' "$cid")
docker rm -f "$cid"
test "$running" = false
test "$(cat "$EVIDENCE/mcp-prod-refuse.exit")" != 0
grep 'NODE_ENV' "$EVIDENCE/mcp-prod-refuse.out"
grep 'MCP_DEV_SESSION_PASSTHROUGH' "$EVIDENCE/mcp-prod-refuse.out"
```

Pass when the container stops within 20 seconds, exits nonzero, and names both environment
variables in its log. The probe container is removed even when the assertion fails.

**M11. opencode.**

```bash
since=$(date -u +%Y-%m-%dT%H:%M:%SZ)
(cd "$MCP_OPENCODE_DIR" && opencode run --format json -m "$MCP_OPENCODE_MODEL" \
  "Call the whoami tool from the verify-uvw MCP server once and reply with its result." < /dev/null) > "$EVIDENCE/mcp-opencode-whoami.jsonl"
echo $? > "$EVIDENCE/mcp-opencode-whoami.exit"
$V mcp-logs | jq -s --arg since "$since" '[.[] | select(.event == "mcp.tool_call" and .tool == "whoami" and .ts >= $since)]' > "$EVIDENCE/mcp-opencode-whoami.event.json"
jq -s -e 'any(.[]; .type == "tool_use" and any(.part.state.metadata.metadata.toolCalls[]?; .tool == "verify-uvw.whoami" and .status == "completed"))' "$EVIDENCE/mcp-opencode-whoami.jsonl"
jq -e 'length == 1 and .[0].outcome == "ok" and .[0].client_name == null' "$EVIDENCE/mcp-opencode-whoami.event.json"
```

Pass when opencode exits 0, a `tool_use` fragment records the completed
`verify-uvw.whoami` call, its output identifies this run's user, and exactly one matching
event has outcome `ok` and null client name. Keep the JSONL. It contains the four output
fragment types, not developer plugins, skills or credentials.

**MI1. Issue create.** Needs the Team Space from M4.

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

**MI2. Issue view.**

```bash
$V mcp mcp-issue-view issue_view "{\"repo\":\"$O/verify-team\",\"number\":\"#$N\"}"
$V cli mcp-issue-view-cli issue view "#$N" -R "$O/verify-team" --json
diff <(jq -S 'del(.url)' "$EVIDENCE/mcp-issue-view.out") <(jq -S '.' "$EVIDENCE/mcp-issue-view-cli.out")
jq -e 'has("timeline") | not' "$EVIDENCE/mcp-issue-view.out"
jq -e --arg repo "$T" '.repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-issue-view.event.json"
```

Pass when both exit 0, the diff is empty, no `timeline` key is present, and the event
carries the Team Space ID.

**MI3. Issue view with comments.**

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

**MI4. Issue list.**

```bash
$V mcp mcp-issue-list issue_list "{\"repo\":\"$O/verify-team\",\"state\":\"all\",\"labels\":[\"bug\"],\"assignee\":\"@me\",\"limit\":5}"
$V cli mcp-issue-list-cli issue list -R "$O/verify-team" -s all -l bug -a @me -L 5 --json
diff <(jq -S '.issues | map(del(.url))' "$EVIDENCE/mcp-issue-list.out") <(jq -S '.' "$EVIDENCE/mcp-issue-list-cli.out")
jq -e --argjson n "$N" '.issues | length >= 1 and all(.[]; .url != null) and any(.[]; .number == $n)' "$EVIDENCE/mcp-issue-list.out"
jq -e --arg repo "$T" '.repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-issue-list.event.json"
```

Pass when both exit 0, the diff is empty, every listed Issue has a `url`, and the event
carries the Team Space ID.

**MI5. Issue edit.**

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

**MI6. Issue comment.**

```bash
$V mcp mcp-issue-comment issue_comment "{\"repo\":\"$O/verify-team\",\"number\":\"$N\",\"body\":\"Confirmed by agent\"}"
$V cli mcp-issue-comment-cli issue view "$N" -R "$O/verify-team" -c --json
diff <(jq -S '.' "$EVIDENCE/mcp-issue-comment.out") <(jq -S '.timeline | map(select(.type == "comment")) | last' "$EVIDENCE/mcp-issue-comment-cli.out")
jq -e '.body == "Confirmed by agent" and .type == "comment"' "$EVIDENCE/mcp-issue-comment.out"
jq -e --arg repo "$T" '.repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-issue-comment.event.json"
```

Pass when both exit 0, the comment equals the last comment of the CLI timeline, and the
event carries the Team Space ID.

**MI7. Issue close as not planned.**

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

**MI8. Issue reopen.**

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

**MI9. Issue tool failure.**

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

**MI10. Nonexistent Issue.** A Workspace error translated end to end.

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

**MI11. Invalid argument.**

```bash
$V mcp mcp-issue-invalid issue_list "{\"repo\":\"$O/verify-team\",\"state\":\"reopened\"}"
test $? -eq 1
jq -e '.code == "workspace-argument-invalid" and (.detail.issues | length) >= 1' "$EVIDENCE/mcp-issue-invalid.out"
jq -e '.outcome == "tool_error" and .error_code == "workspace-argument-invalid" and .tool == "issue_list"' "$EVIDENCE/mcp-issue-invalid.event.json"
```

Pass when the call exits 1 with a structured `workspace-argument-invalid` result (not the
SDK's plain validation text) and the event records `tool_error` with the same code.

**MP1. Pull request create.** Personal Space, with an idempotency key.

```bash
$V cli mcp-personal-id repo view "$O/personal" --json
P=$(jq -r '.id' "$EVIDENCE/mcp-personal-id.out")
KEY="mcp-pr-$VERIFY_UVW_RUN"
$V mcp mcp-pr-create pr_create "{\"repo\":\"$O/personal\",\"title\":\"Agent change\",\"body\":\"From MCP\",\"idempotency_key\":\"$KEY\"}"
PN=$(jq -r '.number' "$EVIDENCE/mcp-pr-create.out")
W=$(jq -r '.id' "$EVIDENCE/mcp-pr-create.out")
$V mcp mcp-pr-create-again pr_create "{\"repo\":\"$O/personal\",\"title\":\"Agent change\",\"body\":\"From MCP\",\"idempotency_key\":\"$KEY\"}"
$V cli mcp-pr-create-cli pr view "$PN" -R "$O/personal" --json
diff <(jq -S 'del(.url)' "$EVIDENCE/mcp-pr-create.out") <(jq -S '.' "$EVIDENCE/mcp-pr-create-cli.out")
diff <(jq -S '.' "$EVIDENCE/mcp-pr-create.out") <(jq -S '.' "$EVIDENCE/mcp-pr-create-again.out")
jq -e --arg origin "$ORIGIN" --arg p "$P" '.url == "\($origin)/spaces/\($p)/pulls/\(.number)" and .state == "draft" and .kind == "user"' "$EVIDENCE/mcp-pr-create.out"
jq -e --arg repo "$P" '.tool == "pr_create" and .repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-pr-create.event.json"
```

Pass when every command exits 0, the CLI view equals the MCP result without `url`, the retry
with the same key returns an identical pull request (same `id` and `number`), the `url` is
the Personal Space pull request address, and the event carries the resolved Space ID.

**MP2. Pull request view by number.**

```bash
$V mcp mcp-pr-view pr_view "{\"repo\":\"$O/personal\",\"number\":\"#$PN\"}"
$V cli mcp-pr-view-cli pr view "#$PN" -R "$O/personal" --json
diff <(jq -S 'del(.url)' "$EVIDENCE/mcp-pr-view.out") <(jq -S '.' "$EVIDENCE/mcp-pr-view-cli.out")
jq -e --arg repo "$P" '.repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-pr-view.event.json"
```

Pass when both exit 0, the diff is empty, and the event carries the Personal Space ID.

**MP3. Pull request view by URL.**

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

**MP4. Pull request list.**

```bash
$V mcp mcp-pr-list pr_list "{\"repo\":\"$O/personal\",\"state\":\"all\",\"author\":\"@me\",\"limit\":5}"
$V cli mcp-pr-list-cli pr list -R "$O/personal" -s all -A @me -L 5 --json
diff <(jq -S '.prs | map(del(.url))' "$EVIDENCE/mcp-pr-list.out") <(jq -S '.' "$EVIDENCE/mcp-pr-list-cli.out")
jq -e --arg id "$W" '.prs | length >= 1 and all(.[]; .url != null) and any(.[]; .id == $id)' "$EVIDENCE/mcp-pr-list.out"
jq -e --arg repo "$P" '.repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-pr-list.event.json"
```

Pass when both exit 0, the diff is empty, every listed pull request has a `url`, and the event
carries the Personal Space ID.

**MP5. Pull request edit.**

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

**MP6. Pull request ready and undo.**

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

**MP7. Search Issues.**

```bash
$V mcp mcp-search-issues search "{\"kind\":\"issues\",\"state\":\"all\",\"author\":\"@me\",\"limit\":5}"
$V cli mcp-search-issues-cli search issues -s all -A @me -L 5 --json
diff <(jq -S '.issues | map(del(.url))' "$EVIDENCE/mcp-search-issues.out") <(jq -S '.' "$EVIDENCE/mcp-search-issues-cli.out")
jq -e --argjson n "$N" '.issues | length >= 1 and all(.[]; .url != null) and any(.[]; .number == $n)' "$EVIDENCE/mcp-search-issues.out"
jq -e '.repo == null and .outcome == "ok"' "$EVIDENCE/mcp-search-issues.event.json"
```

Pass when both exit 0, the diff is empty, every Issue has a `url`, and the event has a null
`repo` because search spans repositories.

**MP8. Search pull requests.**

```bash
$V mcp mcp-search-prs search "{\"kind\":\"prs\",\"state\":\"all\",\"author\":\"@me\",\"limit\":5}"
$V cli mcp-search-prs-cli search prs -s all -A @me -L 5 --json
diff <(jq -S '.prs | map(del(.url))' "$EVIDENCE/mcp-search-prs.out") <(jq -S '.' "$EVIDENCE/mcp-search-prs-cli.out")
jq -e --arg id "$W" '.prs | length >= 1 and all(.[]; .url != null) and any(.[]; .id == $id)' "$EVIDENCE/mcp-search-prs.out"
jq -e '.repo == null and .outcome == "ok"' "$EVIDENCE/mcp-search-prs.event.json"
```

Pass when both exit 0, the diff is empty, every pull request has a `url`, and the event has a
null `repo`.

**MP9. Browse.**

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

**MP10. Nonexistent pull request.**

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

**M12. Cleanup.**

```bash
for port in 3020 5173; do lsof -nP -iTCP:"$port" -sTCP:LISTEN -t || true; done > "$EVIDENCE/mcp-dev-before.txt"
$V down | tee "$EVIDENCE/mcp-down.txt"
for port in 3020 5173; do lsof -nP -iTCP:"$port" -sTCP:LISTEN -t || true; done > "$EVIDENCE/mcp-dev-after.txt"
diff "$EVIDENCE/mcp-dev-before.txt" "$EVIDENCE/mcp-dev-after.txt"
docker ps -a --filter "label=com.docker.compose.project=$MCP_PROJECT"
docker network ls --filter "label=com.docker.compose.project=$MCP_PROJECT"
docker volume ls --filter "label=com.docker.compose.project=$MCP_PROJECT"
docker image ls "$MCP_IMAGE"
```

Pass when `down` prints `ok    MCP resources removed`, resource listings have no entries,
and developer PIDs are unchanged or absent both times. Evidence and logs survive.

## Gotchas

- MCP is opt-in at `up`. Setting `VERIFY_UVW_MCP` later does not change an existing run.
- Only macOS Docker Desktop is supported. The container accesses the loopback Server
  through `host.docker.internal`, bypassing Vite's host checks.
- `user` gets a separate session from the public CLI login endpoint. It never reads
  uvw's private session file. Every call to `user` creates a fresh opencode directory
  because opencode caches project configuration by directory.
- Credentials remain under `home/`. Never paste their values into evidence or reports.
- The image digest includes tracked and non-ignored untracked build inputs. Timestamp
  changes alone do not affect it. A content change requires `down`, then `up`.
- Run negative journeys without `set -e`, or capture their expected nonzero status in
  an `if` statement. Exit 5 indicates invalid evidence even if the tool returned a result.
- Run M11 through the background opencode service. Do not use `--standalone`, start
  `opencode serve`, or use `--auto`. This adds an entry to local opencode session history.
- Run `down` after failed launches too. It only removes this run's project resources
  and image tag, preserves BuildKit cache, and deletes disposable credentials.
