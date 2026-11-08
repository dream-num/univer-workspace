# MCP gateway

An agent connects to a disposable Docker gateway with a personal access token (PAT) that the gateway exchanges for a short-lived Workspace session, reads
identity, repositories, Issues, pull requests, files, repository administration, labels, merges, the SVG resource catalog, the Facade API reference and the Skills through either MCP protocol, and leaves correlated usage evidence.

## Sub-features

- M1 starts the image and verifies the disposable environment.
- M2 and M3 read identity over the 2026-07-28 and 2025-11-25 protocols.
- M4 and M5 compare repository lists and details with uvw.
- M6 preserves a missing-repository error and its usage event.
- M7 checks the ordered tool list of every toolset selection, schemas, and per-tool annotations.
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
- MS1 seeds a folder, an uploaded file and a merged sheet in the Team Space.
- MS2 and MS3 browse and find files against the CLI.
- MS4 creates, edits and renames a repository against the CLI.
- MS5 lists, creates, edits and deletes labels against the CLI.
- MS6 creates a sheet in a pull request and lists its Units against the CLI.
- MS7 adds an existing file to a pull request against the CLI.
- MS8 gets an uploaded file against the CLI.
- MS9 creates, renames, moves and trashes Nodes against the CLI.
- MS10 merges a ready pull request and discards another against the CLI.
- MS11 runs the full stage B product journey and screenshots the ready pull request page.
- MC1 lists the SVG resource registries against the CLI.
- MC2 finds SVG resources against the CLI.
- MC3 exports one and two SVG resources and compares the text with the files the CLI writes.
- MC4 preserves unknown handles in `failed` and an unknown registry error against the CLI.
- MR1 lists the Skills and gets one against the CLI.
- MR2 reads a Skill resource through `skills_read` against the CLI and checks the rewritten read instruction.
- MR3 and MR4 search and show Facade API symbols against the CLI and the reference library.
- MR5 lists and reads Skill files as MCP resources against the CLI.
- MR6 checks the server instructions in the initialize result in both protocols.
- MR7 reads a long class through `api_show` cursors and compares the pages with the reference library.
- MR8 rejects a cursor reused with other arguments and an unknown Skill.
- MA1 calls the gateway with the default personal access token (PAT) and records `auth_kind: pat`.
- MA2 reads the protected-resource metadata without credentials.
- MA3 refuses a write tool to a read-only PAT.
- MA4 revokes a PAT and gets HTTP 401 on the next Workspace-backed call.
- MA5 keeps development session authentication available with `--auth dev`.
- MO1 signs opencode in through browser OAuth with one MCP URL and checks scoped consent and OAuth usage events.
- MX1 writes a 2x2 range through the executor and compares MCP and CLI readbacks and usage events.
- MX2 preserves a ready Worktree error with detail.
- MX3 verifies executor unavailability.
- MX5 compares uncoded script failure messages with the CLI.
- MX6 verifies a large committed result keeps commit facts and writes once.
- MX4 captures the written values in the Browser.
- MF1 through MF9 verify capability upload/download, idempotent Blob publication/replacement, owner isolation, the browser upload page, Worktree image Assets, binary round trips, normalized file paths and the MCP body cap.
- MH1 through MH3 compare HTML View validation with the CLI, preserve missing-source errors, and publish/retry/open the validated page.
- M12 removes this run's resources and preserves developer processes.

## How to get to it (user POV)

Use `V=.agents/skills/verify-uvw/bin/verify-uvw` from the repository root on macOS
Docker Desktop. Start with `VERIFY_UVW_MCP=1 $V up`, then `$V user`. The gateway
publishes `http://127.0.0.1:3930/mcp`. Parallel runs need their own root and all three
ports. `eval "$($V env)"` provides the MCP URL and the isolated opencode directory.

## Driving it with agent-browser and uvw

Use Bash for these commands. Prerequisites are the baseline CLI build and dependencies,
Docker Desktop, `jq`, and opencode for M11 and MO1. MO1 also needs agent-browser and
a Workspace server with MCP OAuth authorization enabled (PR #216); it signs in through
the browser. The other MCP journeys do not need browser login. Each MCP call
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
$V mcp-tools --toolsets files mcp-tools-files
$V mcp-tools --toolsets admin mcp-tools-admin
$V mcp-tools --toolsets core,admin mcp-tools-core-admin
$V mcp-tools --toolsets all mcp-tools-all
$V mcp-tools --toolsets nope mcp-tools-unknown
test $? -eq 3
CORE='["whoami","repo_list","repo_view","issue_list","issue_view","issue_create","issue_edit","issue_comment","issue_set_state","pr_list","pr_view","pr_create","pr_edit","pr_ready","search","browse","space_browse","space_find","unit_list","unit_add","unit_create","file_upload_create","execute","inspect","import","export","api_find","api_show","skills_read"]'
FILES='["blob_get","blob_upload","blob_download","blob_replace","asset_download","html_view_validate","html_view_create"]'
ADMIN='["repo_create","repo_edit","label_list","label_write","space_node","pr_merge","pr_discard","resources_registries","resources_find","resources_export"]'
jq -e --argjson want "$CORE" 'map(.name) == $want' "$EVIDENCE/mcp-tools-core.out"
jq -e --argjson want "$FILES" 'map(.name) == $want' "$EVIDENCE/mcp-tools-files.out"
jq -e --argjson want "$ADMIN" 'map(.name) == $want' "$EVIDENCE/mcp-tools-admin.out"
jq -e --argjson core "$CORE" --argjson admin "$ADMIN" 'map(.name) == $core + $admin' "$EVIDENCE/mcp-tools-core-admin.out"
jq -e --argjson core "$CORE" --argjson files "$FILES" --argjson admin "$ADMIN" 'map(.name) == $core + $files + $admin' "$EVIDENCE/mcp-tools-all.out"
for label in core files admin core-admin all; do
  jq -e '
    all(.[]; .annotations.openWorldHint == false and .inputSchema != null and .outputSchema != null)
    and all(.[] | select(.name | test("^(whoami|repo_(list|view)|issue_(list|view)|pr_(list|view)|search|browse|space_(browse|find)|unit_list|inspect|export|api_(find|show)|skills_read|blob_get|blob_download|asset_download|html_view_validate|label_list|resources_(registries|find|export))$")); .annotations.readOnlyHint == true and .annotations.destructiveHint == false)
    and all(.[] | select(.name | test("^(issue_(create|edit|comment|set_state)|pr_(create|edit|ready)|unit_(add|create)|file_upload_create|blob_upload|html_view_create|execute|import|repo_create)$")); .annotations.readOnlyHint == false and .annotations.destructiveHint == false)
    and all(.[] | select(.name | test("^(repo_edit|label_write|space_node|pr_merge|pr_discard|blob_replace)$")); .annotations.readOnlyHint == false and .annotations.destructiveHint == true)
  ' "$EVIDENCE/mcp-tools-$label.out"
done
diff <(jq -S . "$EVIDENCE/mcp-tools-core.out") <(jq -S '.[:29]' "$EVIDENCE/mcp-tools-all.out")
jq -e 'all(.[] | select(.name | test("^(repo_create|repo_edit|space_node|label_write)$")); .description | startswith("Takes effect immediately, without review."))' "$EVIDENCE/mcp-tools-admin.out"
jq -e 'all(.[] | select(.name | test("^pr_(merge|discard)$")); .description | contains("Unless the user explicitly asked"))' "$EVIDENCE/mcp-tools-admin.out"
jq -e '.status == 400 and (.body | fromjson | .valid == ["core","files","admin","all"])' "$EVIDENCE/mcp-tools-unknown.out"
```

Pass when every selection exits 0 with exactly its tools in the fixed order (core, then files, then
admin), schemas present, and annotations as specified (read-only, non-destructive write, and
destructive: `repo_edit`, `label_write`, `space_node`, `pr_merge`, `pr_discard`); the core list equals the
first 29 tools of `all`; the immediate-effect and leave-to-the-user descriptions are present; unknown
exits 3 with HTTP 400 and the valid toolset names. Tool lists have no event file.

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

**MS1. Seed files.** A folder, an uploaded file and a merged sheet in the Team Space from M4.

```bash
$V cli mcp-ms-team repo view "$O/verify-team" --json
T=$(jq -r '.id' "$EVIDENCE/mcp-ms-team.out")
echo "mcp blob" > "$EVIDENCE/mcp-ms-notes.txt"
$V cli mcp-ms-folder space node create "$O/verify-team" --name Plans --json
FOLDER=$(jq -r '.node.nodeId' "$EVIDENCE/mcp-ms-folder.out")
$V cli mcp-ms-upload blob upload --file "$EVIDENCE/mcp-ms-notes.txt" --space "$T" --name notes.txt --json
BLOB=$(jq -r '.upload.resourceId' "$EVIDENCE/mcp-ms-upload.out")
$V cli mcp-ms-seed-pr pr create -R "$O/verify-team" -t "Seed sheet" --json
SN=$(jq -r '.number' "$EVIDENCE/mcp-ms-seed-pr.out")
SW=$(jq -r '.id' "$EVIDENCE/mcp-ms-seed-pr.out")
$V cli mcp-ms-seed-unit unit create --worktree "$SW" --space "$T" --type sheet --name Budget --json
$V cli mcp-ms-seed-ready pr ready "$SN" -R "$O/verify-team" --json
$V cli mcp-ms-seed-merge pr merge "$SN" -R "$O/verify-team" --json
jq -e '.state == "merged"' "$EVIDENCE/mcp-ms-seed-merge.out"
```

Pass when every command exits 0 and the seed pull request is `merged`. Later MS journeys
reuse `T`, `FOLDER`, `BLOB`, `O` and the Team Space ID.

**MS2. Space browse.**

```bash
$V mcp --toolsets all mcp-space-browse space_browse "{\"repo\":\"$O/verify-team\"}"
$V cli mcp-space-browse-cli space browse "$O/verify-team" --json
diff <(jq -S '.nodes | map(del(.url))' "$EVIDENCE/mcp-space-browse.out") <(jq -S '.nodes' "$EVIDENCE/mcp-space-browse-cli.out")
jq -e --arg origin "$ORIGIN" '.nodes | length >= 3 and all(.[]; .url == "\($origin)/nodes/\(.nodeId)")' "$EVIDENCE/mcp-space-browse.out"
jq -e --arg repo "$T" '.repo == $repo and .tool == "space_browse" and .outcome == "ok"' "$EVIDENCE/mcp-space-browse.event.json"
$V mcp --toolsets all mcp-space-browse-filter space_browse "{\"repo\":\"$T\",\"recursive\":true,\"resource_kind\":\"univer\",\"unit_type\":\"sheet\"}"
$V cli mcp-space-browse-filter-cli space browse "$T" --recursive --resource-kind univer --unit-type sheet --json
diff <(jq -S '.nodes | map(del(.url))' "$EVIDENCE/mcp-space-browse-filter.out") <(jq -S '.nodes' "$EVIDENCE/mcp-space-browse-filter-cli.out")
jq -e '.nodes | length >= 1 and all(.[]; .resource.unitType == "sheet")' "$EVIDENCE/mcp-space-browse-filter.out"
$V mcp --toolsets all mcp-space-browse-conflict space_browse "{\"repo\":\"$T\",\"resource_kind\":\"blob\",\"unit_type\":\"sheet\"}"
test $? -eq 1
$V cli mcp-space-browse-conflict-cli space browse "$T" --resource-kind blob --unit-type sheet --json
test $? -eq 1
code=$(jq -r '.code' "$EVIDENCE/mcp-space-browse-conflict.out")
test "$(cut -d: -f1 < "$EVIDENCE/mcp-space-browse-conflict-cli.err" | head -n1)" = "$code"
```

Pass when the three MCP results equal the CLI `nodes` without `url`, every node has its
`/nodes/<id>` Browser URL, the event carries the Team Space ID, and the conflicting filter
fails in both with the same code (`workspace-argument-invalid`).

**MS3. Space find.**

```bash
$V mcp --toolsets all mcp-space-find space_find "{\"space\":\"$O/verify-team\",\"query\":\"budget\"}"
$V cli mcp-space-find-cli space find budget --space "$O/verify-team" --json
diff <(jq -S '.nodes | map(del(.url))' "$EVIDENCE/mcp-space-find.out") <(jq -S '.nodes' "$EVIDENCE/mcp-space-find-cli.out")
jq -e '.nodes | length == 1 and .[0].name == "Budget"' "$EVIDENCE/mcp-space-find.out"
jq -e --arg repo "$T" '.repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-space-find.event.json"
```

Pass when both exit 0, the diff is empty, exactly the `Budget` sheet is found, and the event
carries the Team Space ID.

**MS4. Repository create, edit and rename.**

```bash
$V mcp --toolsets all mcp-repo-new repo_create '{"slug":"mcp-admin","name":"MCP Admin","description":"Created by MCP"}'
A=$(jq -r '.id' "$EVIDENCE/mcp-repo-new.out")
$V cli mcp-repo-new-cli repo view "$O/mcp-admin" --json
diff <(jq -S 'del(.url)' "$EVIDENCE/mcp-repo-new.out") <(jq -S 'del(.starCount, .starred)' "$EVIDENCE/mcp-repo-new-cli.out")
jq -e --arg origin "$ORIGIN" '.url == "\($origin)/spaces/\(.id)" and .name == "MCP Admin" and .description == "Created by MCP"' "$EVIDENCE/mcp-repo-new.out"
jq -e --arg repo "$A" '.tool == "repo_create" and .repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-repo-new.event.json"
$V cli mcp-repo-default-cli repo create mcp-default --json
jq -e '.name == "mcp-default"' "$EVIDENCE/mcp-repo-default-cli.out"
$V mcp --toolsets all mcp-repo-default repo_create '{"slug":"mcp-default-2"}'
jq -e '.name == "mcp-default-2"' "$EVIDENCE/mcp-repo-default.out"
LONG=$(printf 'x%.0s' $(seq 351))
$V mcp --toolsets all mcp-repo-long repo_create "{\"slug\":\"mcp-long\",\"description\":\"$LONG\"}"
test $? -eq 1
$V cli mcp-repo-long-cli repo create mcp-long --description "$LONG" --json
test $? -eq 1
code=$(jq -r '.code' "$EVIDENCE/mcp-repo-long.out")
test "$(cut -d: -f1 < "$EVIDENCE/mcp-repo-long-cli.err" | head -n1)" = "$code"
$V mcp --toolsets all mcp-repo-edit repo_edit "{\"repo\":\"$O/mcp-admin\",\"name\":\"MCP Admin 2\",\"description\":\"Edited\",\"visibility\":\"public\"}"
$V cli mcp-repo-edit-cli repo view "$O/mcp-admin" --json
diff <(jq -S 'del(.url)' "$EVIDENCE/mcp-repo-edit.out") <(jq -S 'del(.starCount, .starred)' "$EVIDENCE/mcp-repo-edit-cli.out")
jq -e '.name == "MCP Admin 2" and .description == "Edited" and .publicRead == true' "$EVIDENCE/mcp-repo-edit.out"
$V mcp --toolsets all mcp-repo-edit-bad repo_edit "{\"repo\":\"$O/mcp-admin\"}"
test $? -eq 1
$V cli mcp-repo-edit-bad-cli repo edit "$O/mcp-admin" --json
test $? -eq 1
code=$(jq -r '.code' "$EVIDENCE/mcp-repo-edit-bad.out")
test "$(cut -d: -f1 < "$EVIDENCE/mcp-repo-edit-bad-cli.err" | head -n1)" = "$code"
$V mcp --toolsets all mcp-repo-rename repo_edit "{\"repo\":\"$O/mcp-admin\",\"slug\":\"mcp-admin-2\"}"
$V cli mcp-repo-rename-cli repo view "$O/mcp-admin-2" --json
diff <(jq -S 'del(.url)' "$EVIDENCE/mcp-repo-rename.out") <(jq -S 'del(.starCount, .starred)' "$EVIDENCE/mcp-repo-rename-cli.out")
$V cli mcp-repo-old-slug repo view "$O/mcp-admin" --json
test $? -eq 1
jq -e --arg repo "$A" '.tool == "repo_edit" and .repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-repo-rename.event.json"
```

Pass when every expected-success command exits 0 and each diff is empty; the repository
created without `name` takes its slug as name through both tools; the over-long description
and the empty edit fail in MCP and CLI with the same code; the old slug no longer resolves;
events carry the new Space ID.

**MS5. Labels.**

```bash
$V mcp --toolsets all mcp-label-list label_list "{\"repo\":\"$O/verify-team\"}"
$V cli mcp-label-list-cli label list -R "$O/verify-team" --json
diff <(jq -S '.labels' "$EVIDENCE/mcp-label-list.out") <(jq -S '.' "$EVIDENCE/mcp-label-list-cli.out")
jq -e --arg repo "$T" '.tool == "label_list" and .repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-label-list.event.json"
$V mcp --toolsets all mcp-label-new label_write "{\"repo\":\"$O/verify-team\",\"action\":\"create\",\"name\":\"ux\",\"color\":\"pink\",\"description\":\"UX work\"}"
$V cli mcp-label-new-cli label list -R "$O/verify-team" --json
diff <(jq -S '.' "$EVIDENCE/mcp-label-new.out") <(jq -S 'map(select(.name == "ux") | del(.openIssueCount)) | .[0]' "$EVIDENCE/mcp-label-new-cli.out")
jq -e '.color == "pink" and .description == "UX work"' "$EVIDENCE/mcp-label-new.out"
$V mcp --toolsets all mcp-label-edit label_write "{\"repo\":\"$O/verify-team\",\"action\":\"edit\",\"name\":\"ux\",\"new_name\":\"usability\",\"color\":\"purple\"}"
$V cli mcp-label-edit-cli label list -R "$O/verify-team" --json
diff <(jq -S '.' "$EVIDENCE/mcp-label-edit.out") <(jq -S 'map(select(.name == "usability") | del(.openIssueCount)) | .[0]' "$EVIDENCE/mcp-label-edit-cli.out")
jq -e '.name == "usability" and .color == "purple" and .description == "UX work"' "$EVIDENCE/mcp-label-edit.out"
$V mcp --toolsets all mcp-label-delete label_write "{\"repo\":\"$O/verify-team\",\"action\":\"delete\",\"name\":\"usability\"}"
$V cli mcp-label-delete-cli label list -R "$O/verify-team" --json
jq -e '. == {"deleted": "usability"}' "$EVIDENCE/mcp-label-delete.out"
jq -e 'all(.[]; .name != "usability")' "$EVIDENCE/mcp-label-delete-cli.out"
$V mcp --toolsets all mcp-label-bad label_write "{\"repo\":\"$O/verify-team\",\"action\":\"create\",\"name\":\"nocolor\"}"
test $? -eq 1
jq -e '.code == "workspace-argument-invalid"' "$EVIDENCE/mcp-label-bad.out"
jq -e --arg repo "$T" '.tool == "label_write" and .repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-label-delete.event.json"
```

Pass when the list equals the CLI list, each created or edited label equals the CLI's
view of it, the deleted label is gone from the CLI list, `create` without `color` fails with
`workspace-argument-invalid`, and the events carry the Team Space ID.

**MS6. Unit create in a pull request, and unit list.**

```bash
$V mcp --toolsets all mcp-ms-pr pr_create "{\"repo\":\"$O/verify-team\",\"title\":\"MCP units\"}"
WB=$(jq -r '.id' "$EVIDENCE/mcp-ms-pr.out")
NB=$(jq -r '.number' "$EVIDENCE/mcp-ms-pr.out")
UK="mcp-unit-$VERIFY_UVW_RUN"
$V mcp --toolsets all mcp-unit-create unit_create "{\"worktree\":\"$WB\",\"space\":\"$O/verify-team\",\"type\":\"sheet\",\"name\":\"Forecast\",\"parent\":\"$FOLDER\",\"idempotency_key\":\"$UK\"}"
$V mcp --toolsets all mcp-unit-create-again unit_create "{\"worktree\":\"$WB\",\"space\":\"$O/verify-team\",\"type\":\"sheet\",\"name\":\"Forecast\",\"parent\":\"$FOLDER\",\"idempotency_key\":\"$UK\"}"
$V cli mcp-unit-create-cli unit list --worktree "$WB" --json
diff <(jq -S '.unit | del(.url)' "$EVIDENCE/mcp-unit-create.out") <(jq -S '.units | map(select(.name == "Forecast")) | .[0]' "$EVIDENCE/mcp-unit-create-cli.out")
diff <(jq -S '.' "$EVIDENCE/mcp-unit-create.out") <(jq -S '.' "$EVIDENCE/mcp-unit-create-again.out")
jq -e '.units | map(select(.name == "Forecast")) | length == 1' "$EVIDENCE/mcp-unit-create-cli.out"
jq -e --arg origin "$ORIGIN" --arg t "$T" --argjson n "$NB" '.unit.url == "\($origin)/spaces/\($t)/pulls/\($n)?unit=\(.unit.unitId)" and .unit.type == "sheet" and .unit.change == "added" and .unit.target.parentNodeId != null' "$EVIDENCE/mcp-unit-create.out"
jq -e --arg repo "$T" '.tool == "unit_create" and .repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-unit-create.event.json"
$V mcp --toolsets all mcp-unit-list unit_list "{\"worktree\":\"$WB\"}"
diff <(jq -S '.units | map(del(.url))' "$EVIDENCE/mcp-unit-list.out") <(jq -S '.units' "$EVIDENCE/mcp-unit-create-cli.out")
jq -e '.units | length >= 1 and all(.[]; .url != null)' "$EVIDENCE/mcp-unit-list.out"
jq -e --arg repo "$T" '.tool == "unit_list" and .repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-unit-list.event.json"
```

Pass when every command exits 0, the created Unit equals the CLI list entry without `url`, the
retry with the same key returns the identical Unit and creates no second one, `url` is the
pull request page with `?unit=`, the list equals the CLI list, and the events carry the Team
Space ID (the first from the `space` argument, the second from the Worktree).

**MS7. Unit add of an existing file.**

```bash
RES=$(jq -r '.nodes[0].resource.resourceId' "$EVIDENCE/mcp-space-find.out")
$V cli mcp-ms-add-pr pr create -R "$O/verify-team" -t "Add existing" --json
WA=$(jq -r '.id' "$EVIDENCE/mcp-ms-add-pr.out")
AN=$(jq -r '.number' "$EVIDENCE/mcp-ms-add-pr.out")
$V mcp --toolsets all mcp-unit-add unit_add "{\"worktree\":\"$WA\",\"resource\":\"$RES\"}"
$V cli mcp-unit-add-cli unit list --worktree "$WA" --json
diff <(jq -S '.unit | del(.url)' "$EVIDENCE/mcp-unit-add.out") <(jq -S --arg r "$RES" '.units | map(select(.resourceId == $r)) | .[0]' "$EVIDENCE/mcp-unit-add-cli.out")
jq -e '.unit.source == "trunk" and .unit.target == null and .unit.url != null' "$EVIDENCE/mcp-unit-add.out"
jq -e --arg repo "$T" '.tool == "unit_add" and .repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-unit-add.event.json"
```

Pass when both exit 0, the added Unit equals the CLI list entry without `url`, it has source
`trunk` and no target, and the event carries the Team Space ID. `RES` is the `Budget` sheet's
Resource ID from MS3, added to its own pull request `AN` (discarded in MS10).

**MS8. Blob get.**

```bash
$V mcp --toolsets files mcp-blob-get blob_get "{\"resource\":\"$BLOB\"}"
$V cli mcp-blob-get-cli blob get "$BLOB" --json
diff <(jq -S 'del(.node.url)' "$EVIDENCE/mcp-blob-get.out") <(jq -S '.' "$EVIDENCE/mcp-blob-get-cli.out")
jq -e --arg origin "$ORIGIN" '.node.url == "\($origin)/nodes/\(.node.nodeId)" and .resource.kind == "blob" and .resource.byteSize == 9' "$EVIDENCE/mcp-blob-get.out"
jq -e --arg repo "$T" '.tool == "blob_get" and .toolset == "files" and .repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-blob-get.event.json"
```

Pass when both exit 0, the results are equal without `node.url`, the Blob is 9 bytes, and the event
records the `files` toolset and the Team Space ID.

**MS9. Node create, rename, move and trash.**

```bash
$V mcp --toolsets all mcp-node-create space_node "{\"action\":\"create\",\"repo\":\"$O/verify-team\",\"name\":\"Reports\",\"parent\":\"$FOLDER\"}"
RN=$(jq -r '.node.nodeId' "$EVIDENCE/mcp-node-create.out")
$V cli mcp-node-create-cli space browse "$O/verify-team" --parent "$FOLDER" --json
diff <(jq -S '.node | del(.url)' "$EVIDENCE/mcp-node-create.out") <(jq -S --arg id "$RN" '.nodes | map(select(.nodeId == $id) | del(.path)) | .[0]' "$EVIDENCE/mcp-node-create-cli.out")
jq -e --arg repo "$T" '.tool == "space_node" and .repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-node-create.event.json"
$V mcp --toolsets all mcp-node-rename space_node "{\"action\":\"rename\",\"node\":\"$RN\",\"name\":\"Reports 2026\"}"
$V cli mcp-node-rename-cli space browse "$O/verify-team" --parent "$FOLDER" --json
diff <(jq -S '.node | del(.url)' "$EVIDENCE/mcp-node-rename.out") <(jq -S --arg id "$RN" '.nodes | map(select(.nodeId == $id) | del(.path)) | .[0]' "$EVIDENCE/mcp-node-rename-cli.out")
jq -e --arg repo "$T" '.repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-node-rename.event.json"
$V mcp --toolsets all mcp-node-move space_node "{\"action\":\"move\",\"node\":\"$RN\",\"root\":true}"
$V cli mcp-node-move-cli space browse "$O/verify-team" --json
diff <(jq -S '.node | del(.url)' "$EVIDENCE/mcp-node-move.out") <(jq -S --arg id "$RN" '.nodes | map(select(.nodeId == $id) | del(.path)) | .[0]' "$EVIDENCE/mcp-node-move-cli.out")
jq -e '.node.parentNodeId == null' "$EVIDENCE/mcp-node-move.out"
$V mcp --toolsets all mcp-node-move-bad space_node "{\"action\":\"move\",\"node\":\"$RN\",\"root\":true,\"parent\":\"$FOLDER\"}"
test $? -eq 1
$V cli mcp-node-move-bad-cli space node move "$RN" --root --parent "$FOLDER" --json
test $? -eq 1
code=$(jq -r '.code' "$EVIDENCE/mcp-node-move-bad.out")
test "$(cut -d: -f1 < "$EVIDENCE/mcp-node-move-bad-cli.err" | head -n1)" = "$code"
$V mcp --toolsets all mcp-node-trash space_node "{\"action\":\"trash\",\"node\":\"$RN\"}"
$V cli mcp-node-trash-cli space browse "$O/verify-team" --json
jq -e --arg id "$RN" '.trashBatch.root.nodeId == $id and .trashBatch.nodeCount >= 1' "$EVIDENCE/mcp-node-trash.out"
jq -e --arg id "$RN" '.nodes | all(.[]; .nodeId != $id)' "$EVIDENCE/mcp-node-trash-cli.out"
jq -e --arg repo "$T" '.tool == "space_node" and .repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-node-trash.event.json"
```

Pass when every expected-success command exits 0, each Node result equals the CLI browse entry
without `url` and `path`, giving both `root` and `parent` fails in MCP and CLI with the same
code, the trashed Node leaves the CLI browse, and each event carries the Team Space ID.

**MS10. Merge and discard.**

```bash
$V mcp --toolsets all mcp-ms-ready pr_ready "{\"repo\":\"$O/verify-team\",\"number\":\"$NB\"}"
$V mcp --toolsets all mcp-pr-merge pr_merge "{\"repo\":\"$O/verify-team\",\"number\":\"$NB\"}"
$V cli mcp-pr-merge-cli pr view "$NB" -R "$O/verify-team" --json
diff <(jq -S 'del(.url, .units)' "$EVIDENCE/mcp-pr-merge.out") <(jq -S 'del(.units)' "$EVIDENCE/mcp-pr-merge-cli.out")
jq -e '.units | length >= 1 and all(.[]; .mergeResult == "merged")' "$EVIDENCE/mcp-pr-merge-cli.out"
jq -e --arg origin "$ORIGIN" --arg t "$T" --argjson n "$NB" '.state == "merged" and .url == "\($origin)/spaces/\($t)/pulls/\($n)"' "$EVIDENCE/mcp-pr-merge.out"
jq -e --arg repo "$T" '.tool == "pr_merge" and .repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-pr-merge.event.json"
$V cli mcp-ms-forecast space find forecast --space "$O/verify-team" --json
jq -e '.nodes | length == 1 and .[0].name == "Forecast"' "$EVIDENCE/mcp-ms-forecast.out"
$V mcp --toolsets all mcp-pr-merge-again pr_merge "{\"repo\":\"$O/verify-team\",\"number\":\"$NB\"}"
test $? -eq 1
$V cli mcp-pr-merge-again-cli pr merge "$NB" -R "$O/verify-team" --json
test $? -eq 1
code=$(jq -r '.code' "$EVIDENCE/mcp-pr-merge-again.out")
test "$(cut -d: -f1 < "$EVIDENCE/mcp-pr-merge-again-cli.err" | head -n1)" = "$code"
$V mcp --toolsets all mcp-pr-discard pr_discard "{\"repo\":\"$O/verify-team\",\"number\":\"$AN\"}"
$V cli mcp-pr-discard-cli pr view "$AN" -R "$O/verify-team" --json
diff <(jq -S 'del(.url, .units)' "$EVIDENCE/mcp-pr-discard.out") <(jq -S 'del(.units)' "$EVIDENCE/mcp-pr-discard-cli.out")
jq -e '.state == "discarded"' "$EVIDENCE/mcp-pr-discard.out"
jq -e --arg repo "$T" '.tool == "pr_discard" and .repo == $repo and .outcome == "ok"' "$EVIDENCE/mcp-pr-discard.event.json"
```

Pass when the ready pull request merges and the draft pull request `AN` from MS7 is discarded with results equal to the CLI view. Lifecycle transitions (ready, merge, discard) return the Worktree with an empty `units`, as the matching `uvw pr` commands do; the CLI view lists the Units, so `units` is compared through the view
without `url`, the merged Unit appears in the Space as `Forecast`, merging a second time fails in
MCP and CLI with the same code (`workspace-lifecycle-invalid`), and the events carry the Team Space ID.

**MS11. Stage B product journey.** An agent files an Issue, opens a pull request, adds a sheet and hands it over.

```bash
$V mcp --toolsets all mcp-prod-issue issue_create "{\"repo\":\"$O/verify-team\",\"title\":\"Quarterly forecast\",\"body\":\"Needs a forecast sheet\"}"
IN=$(jq -r '.number' "$EVIDENCE/mcp-prod-issue.out")
$V mcp --toolsets all mcp-prod-pr pr_create "{\"repo\":\"$O/verify-team\",\"title\":\"Add forecast sheet (#$IN)\",\"body\":\"Closes the forecast request\",\"idempotency_key\":\"mcp-prod-$VERIFY_UVW_RUN\"}"
PW=$(jq -r '.id' "$EVIDENCE/mcp-prod-pr.out")
PRN=$(jq -r '.number' "$EVIDENCE/mcp-prod-pr.out")
$V mcp --toolsets all mcp-prod-unit unit_create "{\"worktree\":\"$PW\",\"space\":\"$O/verify-team\",\"type\":\"sheet\",\"name\":\"Q4 Forecast\"}"
$V mcp --toolsets all mcp-prod-ready pr_ready "{\"repo\":\"$O/verify-team\",\"number\":\"$PRN\"}"
$V cli mcp-prod-pr-cli pr view "$PRN" -R "$O/verify-team" --json
$V cli mcp-prod-unit-cli unit list --worktree "$PW" --json
diff <(jq -S 'del(.url, .units)' "$EVIDENCE/mcp-prod-ready.out") <(jq -S 'del(.units)' "$EVIDENCE/mcp-prod-pr-cli.out")
jq -e '.state == "ready"' "$EVIDENCE/mcp-prod-ready.out"
jq -e '.units | length == 1 and .[0].name == "Q4 Forecast" and .[0].change == "added"' "$EVIDENCE/mcp-prod-unit-cli.out"
PR_URL=$(jq -r '.url' "$EVIDENCE/mcp-prod-ready.out")
eval "$($V env)"
agent-browser open "$ORIGIN/login" && agent-browser wait 1500
agent-browser storage local set univer-workspace-language en-US && agent-browser reload && agent-browser wait 1500
agent-browser find label "Username" fill "verify-$VERIFY_UVW_RUN"
agent-browser find label "Password" fill "$(cat "${VERIFY_UVW_ROOT:-/tmp/verify-uvw}/$VERIFY_UVW_RUN/user.pw")"
agent-browser click 'form button[type=submit]'
agent-browser wait --url '**/home'
agent-browser open "$PR_URL" && agent-browser wait 3000
agent-browser screenshot "$EVIDENCE/mcp-product-pr-ready.png"
agent-browser snapshot -c > "$EVIDENCE/mcp-product-pr-ready.snapshot.txt"
grep -q "Ready" "$EVIDENCE/mcp-product-pr-ready.snapshot.txt"
grep -q "Q4 Forecast" "$EVIDENCE/mcp-product-pr-ready.snapshot.txt"
```

Pass when every command exits 0, the `ready` result equals the CLI view without `url`, the CLI
lists the one added `Q4 Forecast` sheet, the screenshot of the pull request page shows the
title `Add forecast sheet (#N)`, the `Ready` state and the `Q4 Forecast` file (open the PNG and
look; the accessibility snapshot greps are the second view), and the pull request stays `ready`: the agent
hands the `PR_URL` to the user and does not merge.

**MC1. Resource registries.**

```bash
$V mcp --toolsets all mcp-res-registries resources_registries '{}'
$V cli mcp-res-registries-cli resources registries --json
diff <(jq -S . "$EVIDENCE/mcp-res-registries.out") <(jq -S . "$EVIDENCE/mcp-res-registries-cli.out")
jq -e '.registries | length >= 1 and all(.[]; .resourceCount > 0)' "$EVIDENCE/mcp-res-registries.out"
jq -e '.tool == "resources_registries" and .repo == null and .outcome == "ok"' "$EVIDENCE/mcp-res-registries.event.json"
```

Pass when both exit 0, the diff is empty and the event is `ok` without a repository. The gateway container downloads
nothing for this call: it reads the catalog manifest from `@univerjs-pro/cli-assets`.

**MC2. Resource find.**

```bash
$V mcp --toolsets all mcp-res-find resources_find '{"query":"arrow","registry":"example-openmoji-color","limit":3}'
$V cli mcp-res-find-cli resources find arrow --registry example-openmoji-color --limit 3 --json
diff <(jq -S . "$EVIDENCE/mcp-res-find.out") <(jq -S . "$EVIDENCE/mcp-res-find-cli.out")
jq -e '.resources | length == 3' "$EVIDENCE/mcp-res-find.out"
jq -e '.limit == 3 and .total >= 3 and .query == {"queries":["arrow"],"registries":["example-openmoji-color"]}' "$EVIDENCE/mcp-res-find.out"
$V mcp --toolsets all mcp-res-find-default resources_find '{"query":"arrow"}'
$V cli mcp-res-find-default-cli resources find arrow --json
diff <(jq -S . "$EVIDENCE/mcp-res-find-default.out") <(jq -S . "$EVIDENCE/mcp-res-find-default-cli.out")
jq -e '.limit == 30' "$EVIDENCE/mcp-res-find-default.out"
```

Pass when every command exits 0, both diffs are empty, the first call returns three resources of one registry, and the default limit is 30.

**MC3. Resource export.**

```bash
H1=$(jq -r '.resources[0].handle' "$EVIDENCE/mcp-res-find.out")
H2=$(jq -r '.resources[1].handle' "$EVIDENCE/mcp-res-find.out")
OUT=$(mktemp -d)
$V mcp --toolsets all mcp-res-export resources_export "{\"handles\":[\"$H1\",\"$H2\"]}"
$V cli mcp-res-export-cli resources export "$H1" "$H2" --out "$OUT" --json
jq -e --arg h1 "$H1" --arg h2 "$H2" '.failed == [] and (.resources | map(.handle)) == [$h1, $h2] and (has("truncated") | not)' "$EVIDENCE/mcp-res-export.out"
jq -e '.failed == []' "$EVIDENCE/mcp-res-export-cli.out"
i=0
for h in "$H1" "$H2"; do
  diff <(jq -j --argjson i "$i" '.resources[$i].svg' "$EVIDENCE/mcp-res-export.out") "$OUT/${h//\//--}.svg"
  i=$((i+1))
done
$V mcp --toolsets all mcp-res-export-one resources_export "{\"handles\":[\"$H1\"]}"
$V cli mcp-res-export-one-cli resources export "$H1" --json
diff <(jq -S '.resources[0]' "$EVIDENCE/mcp-res-export-one.out") <(jq -S . "$EVIDENCE/mcp-res-export-one-cli.out")
rm -rf "$OUT"
```

Pass when every command exits 0, the MCP text of each SVG equals the file the CLI wrote, a single handle equals the CLI's
`{ handle, svg }` output, and nothing is truncated. The gateway writes no file except its shared catalog cache
(`MCP_RESOURCE_CACHE_DIRECTORY`, default under the container's temporary directory); it needs network access to the catalog hosts.

**MC4. Resource errors.**

```bash
$V mcp --toolsets all mcp-res-export-bad resources_export "{\"handles\":[\"bad\",\"$H1\",\"example-openmoji-color/zzzz\"]}"
test $? -eq 0
$V cli mcp-res-export-bad-cli resources export bad "$H1" example-openmoji-color/zzzz --out "$(mktemp -d)" --json
test $? -eq 1
diff <(jq -S '.failed' "$EVIDENCE/mcp-res-export-bad.out") <(jq -S '.failed' "$EVIDENCE/mcp-res-export-bad-cli.out")
jq -e --arg h1 "$H1" '(.resources | map(.handle)) == [$h1] and (.failed | map(.code)) == ["resource-invalid-handle","resource-not-found"]' "$EVIDENCE/mcp-res-export-bad.out"
$V mcp --toolsets all mcp-res-find-bad resources_find '{"query":"arrow","registry":"nope"}'
test $? -eq 1
$V cli mcp-res-find-bad-cli resources find arrow --registry nope --json
test $? -eq 1
code=$(jq -r '.code' "$EVIDENCE/mcp-res-find-bad.out")
test "$code" = resource-registry-not-found
test "$(cut -d: -f1 < "$EVIDENCE/mcp-res-find-bad-cli.err" | head -n1)" = "$code"
jq -e '.tool == "resources_find" and .outcome == "tool_error" and .error_code == "resource-registry-not-found"' "$EVIDENCE/mcp-res-find-bad.event.json"
```

Pass when the failed handles equal the CLI's `failed` and the good handle is still returned in the MCP result, the unknown registry fails in
MCP and CLI with the same code (`resource-registry-not-found`), and the event carries that code.

**MR1. Skills list and get.** The CLI prints `{ success, data }`; the gateway wraps the same data in `skills`.

```bash
REF='const {createRequire}=require("node:module");const r=createRequire(process.cwd()+"/apps/mcp/package.json")("@univer-cli/api-reference").createStandardApiReference();'
$V mcp mcp-skills-list skills_read
$V cli mcp-skills-list-cli skills list --json
diff <(jq -S '.skills' "$EVIDENCE/mcp-skills-list.out") <(jq -S '.data' "$EVIDENCE/mcp-skills-list-cli.out")
jq -e 'map(.name) == ["base","blob","board","core","doc","embed","cross-unit-formula","html-view","sheet","slide"]' <(jq '.skills' "$EVIDENCE/mcp-skills-list.out")
$V mcp mcp-skills-get skills_read '{"name":"html-view"}'
$V cli mcp-skills-get-cli skills get html-view --json
diff <(jq -S '.skills' "$EVIDENCE/mcp-skills-get.out") \
  <(jq -S '.data | map(if .resources then .resources |= map(.readCommand |= (capture("^uvw skills read (?<n>\\S+) (?<p>.+)$") | "Call skills_read with name \"\(.n)\" and resource \"\(.p)\".")) else . end)' "$EVIDENCE/mcp-skills-get-cli.out")
$V mcp mcp-skills-full skills_read '{"name":"html-view","full":true}'
$V cli mcp-skills-full-cli skills get html-view --full --json
diff <(jq -S '.skills | map(.files)' "$EVIDENCE/mcp-skills-full.out") <(jq -S '.data | map(.files)' "$EVIDENCE/mcp-skills-full-cli.out")
```

Pass when every command exits 0, the three diffs are empty, and the list has the ten skills in the CLI order.

**MR2. Skill resource and the rewritten instruction.**

```bash
$V mcp mcp-skills-read skills_read '{"name":"html-view","resource":"references/charts.md"}'
$V cli mcp-skills-read-cli skills read html-view references/charts.md --json
diff <(jq -S '.' "$EVIDENCE/mcp-skills-read.out") <(jq -S '.data' "$EVIDENCE/mcp-skills-read-cli.out")
jq -e '.skills[0].resources | length > 0 and all(.[]; .readCommand | startswith("Call skills_read with name \"html-view\" and resource \"references/"))' "$EVIDENCE/mcp-skills-get.out"
! jq -r '.skills[0].resources[].readCommand' "$EVIDENCE/mcp-skills-get.out" | grep -q 'uvw skills'
jq -e '.tool == "skills_read" and .outcome == "ok"' "$EVIDENCE/mcp-skills-read.event.json"
```

Pass when both commands exit 0, the content equals the CLI `data`, and no `readCommand` still names `uvw skills`.

**MR3. API find.** The CLI `api` commands print text and have no `--json`, so the reference library (the same package the CLI loads) is the structured oracle, and the CLI text is the cross-check.

```bash
$V mcp mcp-api-find api_find '{"terms":["setValues","conditionalformat"],"unit":"sheet"}'
node -e "$REF"'console.log(JSON.stringify({results:r.find({terms:["setValues","conditionalformat"],unit:"sheet"})}))' > "$EVIDENCE/mcp-api-find-oracle.json"
diff <(jq -S . "$EVIDENCE/mcp-api-find.out") <(jq -S . "$EVIDENCE/mcp-api-find-oracle.json")
$V cli mcp-api-find-cli api find setValues --unit sheet
grep -qF "$(jq -r '.results[0].matches[0].label | split("(")[0]' "$EVIDENCE/mcp-api-find.out")" "$EVIDENCE/mcp-api-find-cli.out"
$V mcp mcp-api-find-bad api_find '{"terms":["x"],"unit":"nope"}'
test $? -eq 1
jq -e '.code == "workspace-argument-invalid"' "$EVIDENCE/mcp-api-find-bad.out"
```

Pass when the result equals the library output (wrapped in `results`), the CLI text contains the first match, and an unknown unit is `workspace-argument-invalid` with exit 1.

**MR4. API show.**

```bash
$V mcp mcp-api-show api_show '{"symbols":["FRange.setValues","ICellData.v","NoSuchSymbolAnywhere"]}'
node -e "$REF"'console.log(JSON.stringify({results:r.show(["FRange.setValues","ICellData.v","NoSuchSymbolAnywhere"])}))' > "$EVIDENCE/mcp-api-show-oracle.json"
diff <(jq -S . "$EVIDENCE/mcp-api-show.out") <(jq -S . "$EVIDENCE/mcp-api-show-oracle.json")
jq -e '.results[2].status == "not-found" and (.truncated | not)' "$EVIDENCE/mcp-api-show.out"
$V cli mcp-api-show-cli api show FRange.setValues
grep -q 'declare class FRange' "$EVIDENCE/mcp-api-show-cli.out"
grep -q 'setValues' "$EVIDENCE/mcp-api-show-cli.out"
$V cli mcp-api-show-missing-cli api show NoSuchSymbolAnywhere
test $? -eq 1
grep -q 'Unknown symbol: NoSuchSymbolAnywhere' "$EVIDENCE/mcp-api-show-missing-cli.err"
```

Pass when the result equals the library output, an unknown symbol is a `not-found` entry and not a tool error, the CLI text shows the same class and member, and the CLI exits 1 for the unknown symbol (the gateway reports it in the result instead).

**MR5. Skill files as MCP resources.**

```bash
$V mcp-resources mcp-resources-list
for n in $(jq -r '.data[].name' "$EVIDENCE/mcp-skills-list-cli.out"); do
  $V cli "mcp-skills-get-$n-cli" skills get "$n" --json >/dev/null
done
{ for n in $(jq -r '.data[].name' "$EVIDENCE/mcp-skills-list-cli.out"); do
    echo "uvw://skills/$n/SKILL.md"
    jq -r --arg n "$n" '.data[0].resources[]? | "uvw://skills/\($n)/\(.path)"' "$EVIDENCE/mcp-skills-get-$n-cli.out"
  done; } | sort > "$EVIDENCE/mcp-resources-expected.txt"
diff <(jq -r '.[].uri' "$EVIDENCE/mcp-resources-list.out" | sort) "$EVIDENCE/mcp-resources-expected.txt"
jq -e 'all(.[]; .mimeType == "text/markdown")' "$EVIDENCE/mcp-resources-list.out"
$V mcp-resource mcp-resource-core uvw://skills/core/SKILL.md
$V cli mcp-skills-core-cli skills get core --json
diff <(jq -r '.[0].text' "$EVIDENCE/mcp-resource-core.out") <(jq -r '.data[0].content' "$EVIDENCE/mcp-skills-core-cli.out")
$V mcp-resource mcp-resource-ref uvw://skills/html-view/references/charts.md
diff <(jq -r '.[0].text' "$EVIDENCE/mcp-resource-ref.out") <(jq -r '.content' "$EVIDENCE/mcp-skills-read.out")
$V mcp-resource --protocol 2025-11-25 mcp-resource-core-legacy uvw://skills/core/SKILL.md
diff "$EVIDENCE/mcp-resource-core.out" "$EVIDENCE/mcp-resource-core-legacy.out"
$V mcp-resources --toolsets admin mcp-resources-admin
diff "$EVIDENCE/mcp-resources-list.out" "$EVIDENCE/mcp-resources-admin.out"
$V mcp-resource mcp-resource-missing uvw://skills/core/references/missing.md
test $? -eq 3
```

Pass when the resource URIs equal the CLI's skill files, every resource is `text/markdown`, the two read resources equal the CLI text in both protocols, the same resources are listed with `?toolsets=admin`, and an unknown resource exits 3 (protocol error). Resource calls have no event file.

**MR6. Server instructions.**

```bash
$V mcp-instructions mcp-instructions
$V mcp-instructions --protocol 2025-11-25 mcp-instructions-legacy
diff "$EVIDENCE/mcp-instructions.out" "$EVIDENCE/mcp-instructions-legacy.out"
jq -e '.instructions | contains("pull request") and contains("pr_create") and contains("pr_ready") and contains("api_find") and contains("skills_read") and contains("review") and contains("Leave merging")' "$EVIDENCE/mcp-instructions.out"
```

Pass when both protocols return the same non-null `instructions` that name the workflow (find the file, open a pull request, verify by reading back, mark ready, hand over the review link, leave merging to the user).

**MR7. Truncation with cursors.** `FRange` is about 170,000 characters, so `api_show` pages it. No shipped skill file exceeds the limit, so `skills_read` paging and `workspace-result-too-large` are covered by the gateway tests.

```bash
CURSOR=""; I=0
while :; do
  ARGS=$(jq -nc --arg c "$CURSOR" '{symbols:["FRange"]} + (if $c == "" then {} else {cursor:$c} end)')
  $V mcp "mcp-frange-$I" api_show "$ARGS"
  CURSOR=$(jq -r '.cursor // ""' "$EVIDENCE/mcp-frange-$I.out")
  I=$((I+1))
  [ -n "$CURSOR" ] || break
done
test "$I" -gt 1
node -e "$REF"'console.log(JSON.stringify(r.show(["FRange"])[0]))' > "$EVIDENCE/mcp-frange-oracle.json"
for f in "$EVIDENCE"/mcp-frange-[0-9]*.out; do jq -e '(tojson | length) <= 100000' "$f"; done
jq -e '.truncated == true and (.cursor | type == "string")' "$EVIDENCE/mcp-frange-0.out"
jq -e '(.truncated | not) and (.cursor | not)' "$EVIDENCE/mcp-frange-$((I-1)).out"
diff <(jq -s -S '[.[].results[0].groups[].members[]]' "$EVIDENCE"/mcp-frange-[0-9]*.out) <(jq -S '[.groups[].members[]]' "$EVIDENCE/mcp-frange-oracle.json")
diff <(jq -S '.results[0] | del(.groups)' "$EVIDENCE/mcp-frange-0.out") <(jq -S 'del(.groups)' "$EVIDENCE/mcp-frange-oracle.json")
$V cli mcp-frange-cli api show FRange
for name in $(jq -r '.groups[].members[].name' "$EVIDENCE/mcp-frange-oracle.json" | sort -u | head -n 40); do grep -qF "$name" "$EVIDENCE/mcp-frange-cli.out"; done
```

Pass when the pages are each within 100,000 characters, all but the last carry `truncated` and `cursor`, the members concatenated across pages equal the reference library's members in order, every page repeats the same class header, and the CLI text names the sampled members.

**MR8. Cursor guard and unknown Skill.**

```bash
$V mcp mcp-frange-wrong api_show "$(jq -nc --arg c "$(jq -r '.cursor' "$EVIDENCE/mcp-frange-0.out")" '{symbols:["FWorkbook"],cursor:$c}')"
test $? -eq 1
jq -e '.code == "workspace-argument-invalid"' "$EVIDENCE/mcp-frange-wrong.out"
jq -e '.error_code == "workspace-argument-invalid" and .outcome == "tool_error"' "$EVIDENCE/mcp-frange-wrong.event.json"
$V mcp mcp-skills-unknown skills_read '{"name":"no-such-skill"}'
test $? -eq 1
$V cli mcp-skills-unknown-cli skills get no-such-skill --json
test $? -eq 1
jq -e '.code == "workspace-argument-invalid"' "$EVIDENCE/mcp-skills-unknown.out"
```

Pass when a cursor reused with other symbols and an unknown Skill both return `workspace-argument-invalid` with exit 1 and a matching usage event, and the CLI also rejects the unknown Skill.
**MA1. PAT call.** Needs the Team Space from M4. `user` created the default PAT, so every journey above ran with it.

```bash
$V mcp mcp-pat-whoami whoami
PAT_ID=$(cat "$RUN/home/mcp-token-id")
grep -q '^auth=pat$' "$EVIDENCE/mcp-pat-whoami.cmd"
jq -e --arg id "$PAT_ID" '.auth_kind == "pat" and .client_id == $id and .outcome == "ok"' "$EVIDENCE/mcp-pat-whoami.event.json"
jq -e '.subject.name != null' "$EVIDENCE/mcp-pat-whoami.out"
```

Pass when the call exits 0 and the event records `pat` and this PAT's id. The harness already failed
the call (exit 5) if the gateway log contained the PAT.

**MA2. Protected-resource metadata.**

```bash
for path in /.well-known/oauth-protected-resource/mcp /.well-known/oauth-protected-resource; do
  curl -sS -D "$EVIDENCE/mcp-resource-metadata.headers" "${MCP_URL%/mcp}$path" > "$EVIDENCE/mcp-resource-metadata.out"
  jq -e --arg url "$MCP_URL" --arg origin "$ORIGIN" '.resource == $url and .authorization_servers == [$origin] and .scopes_supported == ["read","write","publish","worktree:merge"] and .bearer_methods_supported == ["header"]' "$EVIDENCE/mcp-resource-metadata.out"
  grep -qi '^cache-control: public, max-age=300' "$EVIDENCE/mcp-resource-metadata.headers"
done
```

Pass when both paths answer without credentials with the document and cache header.

**MA3. Read-only PAT.**

```bash
$V mcp-token --scopes read > "$EVIDENCE/mcp-token-readonly.id"
$V mcp mcp-pat-readonly-read repo_list
$V mcp mcp-pat-readonly-write issue_create "{\"repo\":\"$O/verify-team\",\"title\":\"Read-only PAT must not create this\"}"
test $? -eq 1
jq -e '.code == "workspace-scope-required"' "$EVIDENCE/mcp-pat-readonly-write.out"
jq -e '.auth_kind == "pat" and .outcome == "tool_error" and .error_code == "workspace-scope-required"' "$EVIDENCE/mcp-pat-readonly-write.event.json"
$V cli mcp-pat-readonly-issues issue list -R "$O/verify-team" -s all --json
jq -e 'map(.title) | index("Read-only PAT must not create this") == null' "$EVIDENCE/mcp-pat-readonly-issues.out"
```

Pass when the read call exits 0, the write call exits 1 with `workspace-scope-required`, and no such Issue
exists. The read-only PAT is now the default for later `mcp` calls; MA4 replaces it.

**MA4. Revocation.**

```bash
$V mcp-token > "$EVIDENCE/mcp-token-revoke.id"
PAT_ID=$(cat "$RUN/home/mcp-token-id")
$V mcp mcp-pat-before-revoke repo_list
curl -sS -o /dev/null -w '%{http_code}\n' -X DELETE -H "Cookie: workspace_session=$(cat "$RUN/home/mcp-session")" \
  -H "Origin: $ORIGIN" "$ORIGIN/api/auth/tokens/$PAT_ID" > "$EVIDENCE/mcp-pat-revoke.status"
grep -Eq '^(200|204)$' "$EVIDENCE/mcp-pat-revoke.status"
$V mcp mcp-pat-after-revoke repo_list
test $? -eq 4
jq -e '.status == 401 and (.www_authenticate | contains("resource_metadata"))' "$EVIDENCE/mcp-pat-after-revoke.out"
$V mcp mcp-pat-after-revoke-again repo_list
test $? -eq 4
$V mcp-token > "$EVIDENCE/mcp-token-restored.id"
```

Pass when the call before revocation exits 0, the revoke answers 200 or 204, and the first Workspace-backed
call afterwards exits 4 with HTTP 401 (the revoked session fails downstream, which evicts the cache), as does the
next one (the exchange now answers `invalid_grant`). Use a tool that reaches Workspace: the gateway serves
`whoami` from its 30-second exchange cache. The last command restores a working default PAT.

**MA5. Development session.**

```bash
$V mcp --auth dev mcp-dev-whoami whoami
jq -e '.auth_kind == "dev" and .client_id == "dev" and .outcome == "ok"' "$EVIDENCE/mcp-dev-whoami.event.json"
```

Pass when the call exits 0 and the event records `dev`.

**MO1. OAuth sign-in from opencode.** Run after `up` with MCP enabled and `user`.
This uses the run's browser session and a separate opencode project with no Authorization
header. The subshell isolates its XDG variables. Raw auth output and opencode's OAuth
storage stay in a mode-0700 temporary directory under `$RUN/home`; the trap saves only
redacted transcripts and deletes that directory on success or failure. Do not run with
shell tracing or record raw authorize or callback URLs.

```bash
(
  set -euo pipefail
  eval "$($V env)"
  RUN="${VERIFY_UVW_ROOT:-/tmp/verify-uvw}/$VERIFY_UVW_RUN"
  umask 077
  oauth_dir=$(mktemp -d "$RUN/home/opencode-oauth.XXXXXX")
  auth_pid= service_configured=0

  mo1_redact() {
    node - "$RUN" "$@" <<'JS'
const fs = require('node:fs');
let text = fs.readFileSync(process.argv[3], 'utf8').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
for (const name of ['user.pw', 'home/mcp-session', 'home/mcp-token', 'home/mcp-oauth-secret', 'home/metrics-token']) {
  const path = process.argv[2] + '/' + name;
  if (!fs.existsSync(path)) continue;
  const secret = fs.readFileSync(path, 'utf8').trim();
  if (secret) text = text.split(secret).join('[REDACTED]');
}
text = text.replace(/([?&](?:code|state|code_verifier|code_challenge|access_token|refresh_token|id_token)=)[^\s"'<>\\&#]+/gi, '$1[REDACTED]')
  .replace(/("(?:code|state|code_verifier|code_challenge|access_token|refresh_token|id_token|client_secret)"\s*:\s*")(?:\\.|[^"\\\r\n])*(")/gi, '$1[REDACTED]$2')
  .replace(/uvw_(?:at|rt|pat)_[A-Za-z0-9._~-]+/g, '[REDACTED]')
  .replace(/(Bearer\s+)[^\s"'<>\\]+/gi, '$1[REDACTED]');
process.stdout.write(text);
JS
  }
  mo1_cleanup() {
    result=$?
    trap - EXIT
    set +e
    if [[ -n "$auth_pid" ]]; then
      kill "$auth_pid" 2>/dev/null
      wait "$auth_pid" 2>/dev/null
    fi
    if [[ "$service_configured" == 1 ]]; then
      (cd "$oauth_dir" && opencode service stop) >> "$oauth_dir/journey.out" 2>&1 || result=1
    fi
    for file in auth.out run.jsonl journey.out consent.snapshot.txt callback.txt authorize.txt; do
      if [[ -f "$oauth_dir/$file" ]]; then
        mo1_redact "$oauth_dir/$file" > "$EVIDENCE/mcp-oauth-$file" || result=1
      fi
    done
    rm -rf "$oauth_dir" || result=1
    exit "$result"
  }
  trap mo1_cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  # Browser and CLI errors can include OAuth URLs, so redact the entire transcript too.
  exec > "$oauth_dir/journey.out" 2>&1
  export XDG_DATA_HOME="$oauth_dir/data" XDG_CONFIG_HOME="$oauth_dir/config"
  export XDG_STATE_HOME="$oauth_dir/state" XDG_CACHE_HOME="$oauth_dir/cache"
  mkdir -p "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_STATE_HOME" "$XDG_CACHE_HOME"
  jq -n --arg url "$MCP_URL" '{mcp:{ws:{type:"remote",url:$url,enabled:true}},permission:{edit:"deny",bash:"deny",webfetch:"deny"}}' > "$oauth_dir/opencode.json"

  status=$(curl -sS -D "$EVIDENCE/mcp-oauth-challenge.headers" -o "$EVIDENCE/mcp-oauth-challenge.out" \
    -w '%{http_code}' -X POST "$MCP_URL")
  test "$status" = 401
  metadata_url="${MCP_URL%/mcp}/.well-known/oauth-protected-resource/mcp"
  grep -Fi "WWW-Authenticate: Bearer resource_metadata=\"$metadata_url\"" "$EVIDENCE/mcp-oauth-challenge.headers"
  curl -fsS "$metadata_url" > "$EVIDENCE/mcp-oauth-resource.json"
  jq -e --arg url "$MCP_URL" --arg origin "$ORIGIN" \
    '.resource == $url and .authorization_servers == [$origin] and .scopes_supported == ["read","write","publish","worktree:merge"]' "$EVIDENCE/mcp-oauth-resource.json"
  curl -fsS "$ORIGIN/.well-known/oauth-authorization-server" > "$EVIDENCE/mcp-oauth-server.json"
  jq -e --arg origin "$ORIGIN" \
    '.issuer == $origin and .authorization_endpoint == ($origin + "/api/auth/authorize") and (.registration_endpoint | type == "string" and startswith($origin + "/"))' "$EVIDENCE/mcp-oauth-server.json"

  service_port=$(node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
  (cd "$oauth_dir" && opencode service set port "$service_port")
  service_configured=1
  (cd "$oauth_dir" && exec opencode mcp auth ws --print-logs < /dev/null) > "$oauth_dir/auth.out" 2>&1 &
  auth_pid=$!
  authorize_url=
  for ((i=0; i<60; i++)); do
    authorize_url=$(node -e 'const fs=require("node:fs");const t=fs.readFileSync(process.argv[1],"utf8").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,"");process.stdout.write(t.match(/http:\/\/127\.0\.0\.1:\d+\/api\/auth\/authorize\?[^\s"<>\x27]+/)?.[0]??"")' "$oauth_dir/auth.out")
    [[ -z "$authorize_url" ]] || break
    kill -0 "$auth_pid" 2>/dev/null || break
    sleep 1
  done
  test -n "$authorize_url"
  printf '%s\n' "$authorize_url" > "$oauth_dir/authorize.txt"
  client_id=$(node -e 'const u=new URL(process.argv[1]);if(u.origin!==process.argv[2]||u.pathname!=="/api/auth/authorize"||!u.searchParams.get("state")||!u.searchParams.get("client_id"))throw Error("Invalid authorize URL");const r=new URL(u.searchParams.get("redirect_uri"));if(r.origin!=="http://127.0.0.1:"+r.port||r.pathname!=="/callback")throw Error("Invalid callback URI");console.log(u.searchParams.get("client_id"))' "$authorize_url" "$ORIGIN")
  printf '%s\n' "$client_id" > "$EVIDENCE/mcp-oauth-client.id"

  agent-browser cookies clear
  agent-browser open "$ORIGIN/login"
  agent-browser wait --load domcontentloaded
  agent-browser storage local set univer-workspace-language en-US
  agent-browser reload
  agent-browser wait --text "Username"
  agent-browser find label "Username" fill "verify-$VERIFY_UVW_RUN"
  agent-browser find label "Password" fill "$(cat "$RUN/user.pw")"
  agent-browser click 'form button[type=submit]'
  agent-browser wait --url '**/home'
  agent-browser open "$authorize_url"
  agent-browser wait --text 'Connect an AI assistant'
  agent-browser snapshot -i -c > "$oauth_dir/consent.snapshot.txt"
  for scope in read write publish worktree:merge; do
    grep -E "checkbox.*$scope" "$oauth_dir/consent.snapshot.txt"
  done
  grep -E 'button.*Deny' "$oauth_dir/consent.snapshot.txt"
  grep -E 'checkbox.*worktree:merge.*checked=true' "$oauth_dir/consent.snapshot.txt"
  agent-browser find role checkbox click --name 'worktree:merge'
  agent-browser snapshot -i -c > "$oauth_dir/consent.snapshot.txt"
  if grep -E 'checkbox.*worktree:merge.*checked=true' "$oauth_dir/consent.snapshot.txt"; then exit 1; fi
  agent-browser screenshot "$EVIDENCE/mcp-oauth-consent.png"
  agent-browser find role button click --name 'Allow' --exact
  agent-browser wait --url 'http://127.0.0.1:*/callback?*'
  callback_url=$(agent-browser get url)
  node - "$callback_url" "$authorize_url" <<'JS'
const assert = require('node:assert/strict');
const callback = new URL(process.argv[2]), authorize = new URL(process.argv[3]);
const redirect = new URL(authorize.searchParams.get('redirect_uri'));
assert.equal(callback.origin + callback.pathname, redirect.origin + redirect.pathname);
assert.ok(callback.searchParams.get('code'), 'callback contains an authorization code');
assert.deepEqual(callback.searchParams.get('scope')?.split(' ').sort(), ['publish', 'read', 'write']);
JS
  printf '%s\n' "$callback_url" > "$oauth_dir/callback.txt"
  for ((i=0; i<60; i++)); do
    kill -0 "$auth_pid" 2>/dev/null || break
    sleep 1
  done
  if kill -0 "$auth_pid" 2>/dev/null; then echo 'OAuth auth command timed out'; exit 1; fi
  auth_exit=0
  wait "$auth_pid" || auth_exit=$?
  auth_pid=
  echo "$auth_exit" > "$EVIDENCE/mcp-oauth-auth.exit"
  test "$auth_exit" = 0
  mo1_redact "$oauth_dir/auth.out" > "$EVIDENCE/mcp-oauth-auth.out"
  grep -q 'Connected to ws' "$EVIDENCE/mcp-oauth-auth.out"

  since=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  run_exit=0
  (cd "$oauth_dir" && opencode run --format json -m "$MCP_OPENCODE_MODEL" \
    'Using the ws MCP server, call whoami, then list my repositories with repo_list. Call each once and reply with both results. Do not call other tools.' < /dev/null) \
    > "$oauth_dir/run.jsonl" 2> "$oauth_dir/run.err" || run_exit=$?
  cat "$oauth_dir/run.err"
  echo "$run_exit" > "$EVIDENCE/mcp-oauth-run.exit"
  test "$run_exit" = 0
  mo1_redact "$oauth_dir/run.jsonl" > "$EVIDENCE/mcp-oauth-run.jsonl"
  for tool in ws.whoami ws.repo_list; do
    jq -s -e --arg tool "$tool" 'any(.[]; .type == "tool_use" and any(.part.state.metadata.metadata.toolCalls[]?; .tool == $tool and .status == "completed"))' "$EVIDENCE/mcp-oauth-run.jsonl"
  done
  user_id=$($V uvw auth status --json | jq -er '.subject.id')
  $V mcp-logs | jq -s --arg since "$since" --arg client "$client_id" \
    '[.[] | select(.event == "mcp.tool_call" and .ts >= $since and .client_id == $client and (.tool == "whoami" or .tool == "repo_list"))]' \
    > "$EVIDENCE/mcp-oauth-events.json"
  jq -e --arg client "$client_id" --arg user "$user_id" \
    'length == 2 and (map(.tool) | sort) == ["repo_list","whoami"] and all(.[]; .auth_kind == "oauth" and .client_id == $client and .user_id == $user and .outcome == "ok")' \
    "$EVIDENCE/mcp-oauth-events.json"
)
```

Pass when the unauthenticated POST returns the metadata challenge, both discovery documents
match this run, opencode prints an authorize URL after registration, and the consent page
shows all four scopes. The consent screenshot must show `worktree:merge` unchecked. The
callback grants exactly `read write publish`, auth prints `Connected to ws`, and the run exits
0 with both completed tools. Exactly two matching usage events identify this user and the
registered OAuth client with `auth_kind: oauth` and `outcome: ok`. Keep the redacted
`mcp-oauth-*` evidence. The trap stops only the isolated service and auth process, then
removes its temporary project and credentials even if an assertion fails.

**MX1. Executor write and readback.**

```bash
$V mcp mx-repo repo_view "{\"repo\":\"$O/personal\"}"
MX_SPACE=$(jq -r .id "$EVIDENCE/mx-repo.out")
$V mcp mx-pr pr_create "{\"repo\":\"$O/personal\",\"title\":\"Executor readback\",\"idempotency_key\":\"mx-pr-$VERIFY_UVW_RUN\"}"
MX_W=$(jq -r .id "$EVIDENCE/mx-pr.out")
$V mcp mx-unit unit_create "{\"worktree\":\"$MX_W\",\"space\":\"$MX_SPACE\",\"type\":\"sheet\",\"name\":\"Executor sheet\",\"idempotency_key\":\"mx-unit-$VERIFY_UVW_RUN\"}"
MX_U=$(jq -r .unit.unitId "$EVIDENCE/mx-unit.out")
MX_CODE='const ws = workbook.getActiveSheet(); ws.getRange("A1:B2").setValues([["Region","Total"],["North",42]]); return ws.getRange("A1:B2").getValues();'
$V mcp --expect-event '.executor == "cold_start" and .cost.committed_revisions == 1 and .cost.worker_cpu_ms > 0 and .unit_type == "sheet"' mx-execute execute "$(jq -nc --arg worktree "$MX_W" --arg unit "$MX_U" --arg code "$MX_CODE" '{worktree:$worktree,unit:$unit,code:$code}')"
$V mcp --expect-event '.executor == "warm" and .cost.committed_revisions == 0 and .unit_type == "sheet"' mx-inspect inspect "$(jq -nc --arg worktree "$MX_W" --arg unit "$MX_U" '{worktree:$worktree,unit:$unit,target:"range",selectors:["A1:B2"],worksheet:"index:1"}')"
$V cli mx-inspect-cli inspect range A1:B2 --worktree "$MX_W" --unit "$MX_U" --worksheet index:1 --json
diff <(jq -S . "$EVIDENCE/mx-inspect.out") <(jq -S . "$EVIDENCE/mx-inspect-cli.out")
jq -e '.ranges[0].displayValues == [["Region","Total"],["North","42"]]' "$EVIDENCE/mx-inspect.out"
$V cli mx-execute-cli execute --worktree "$MX_W" --unit "$MX_U" --json -e "$MX_CODE"
diff <(jq -S 'keys' "$EVIDENCE/mx-execute.out") <(jq -S 'keys' "$EVIDENCE/mx-execute-cli.out")
diff <(jq -S '.value' "$EVIDENCE/mx-execute.out") <(jq -S '.value' "$EVIDENCE/mx-execute-cli.out")
$V doctor > "$EVIDENCE/mx-doctor.txt"
```

Pass when MCP and CLI readbacks match, both execute results have the same bare shape and value,
and the cold/warm events identify a Sheet and one committed revision.

**MX2. Ready Worktree error.**

```bash
$V mcp mx-ready pr_ready "{\"repo\":\"$O/personal\",\"number\":\"$MX_W\"}"
$V mcp mx-ready-execute execute "$(jq -nc --arg worktree "$MX_W" --arg unit "$MX_U" '{worktree:$worktree,unit:$unit,code:"return 1"}')"
test $? -eq 1
jq -e '.code == "workspace-worktree-not-editable" and .detail.state == "ready"' "$EVIDENCE/mx-ready-execute.out"
```

Pass when the error preserves `detail.state` and does not execute code.

**MX3. Stopped executor.**

```bash
MX_CONTAINER=$(docker ps -q --filter "label=com.docker.compose.project=$MCP_PROJECT" --filter label=com.docker.compose.service=executor)
trap 'docker start "$MX_CONTAINER" >/dev/null' EXIT
docker stop "$MX_CONTAINER"
$V mcp mx-executor-stopped inspect "$(jq -nc --arg worktree "$MX_W" --arg unit "$MX_U" '{worktree:$worktree,unit:$unit,target:"workbook"}')"
test $? -eq 1
jq -e '.code == "workspace-executor-unavailable"' "$EVIDENCE/mx-executor-stopped.out"
docker start "$MX_CONTAINER"
trap - EXIT
```

Pass when the gateway returns `workspace-executor-unavailable` and the executor restarts.

**MX4. Browser proof.**

```bash
agent-browser open "$ORIGIN/login"
agent-browser storage local set univer-workspace-language en-US
agent-browser reload
agent-browser wait 1500
if agent-browser get url | grep -q '/login'; then
  agent-browser find label "Username" fill "$O"
  agent-browser find label "Password" fill "$(cat "$RUN/user.pw")"
  agent-browser click 'form button[type=submit]'
  agent-browser wait --url '**/home'
fi
agent-browser open "$(jq -r '.unit.url' "$EVIDENCE/mx-unit.out")"
agent-browser wait 3000
agent-browser screenshot "$EVIDENCE/mx-pull-request.png"
```

Pass when the screenshot shows Region, Total, North and 42 in the pull request's Sheet.

**MX5. Script errors match CLI text.**

```bash
$V mcp mx-script-draft pr_ready "$(jq -nc --arg repo "$O/personal" --arg number "$MX_W" '{repo:$repo,number:$number,undo:true}')"
MX_FAILURE='throw new Error("Executor script failure")'
$V cli mx-script-cli execute --worktree "$MX_W" --unit "$MX_U" --json -e "$MX_FAILURE"
test $? -eq 1
$V mcp --expect-event '.outcome == "tool_error" and .error_code == "workspace-script-failed" and .executor == "cold_start" and .cost.worker_cpu_ms > 0 and .unit_type == "sheet"' mx-script-mcp execute "$(jq -nc --arg worktree "$MX_W" --arg unit "$MX_U" --arg code "$MX_FAILURE" '{worktree:$worktree,unit:$unit,code:$code}')"
test $? -eq 1
jq -e '.code == "workspace-script-failed" and .detail.name == "Error"' "$EVIDENCE/mx-script-mcp.out"
diff <(jq -r .message "$EVIDENCE/mx-script-mcp.out") "$EVIDENCE/mx-script-cli.err"
```

Pass when MCP returns the explicit script code and the CLI's exact bare message.

**MX6. Large committed values do not repeat writes.**

```bash
MX_LARGE='const cell = workbook.getActiveSheet().getRange("D1"); const n = Number(cell.getValue() || 0); cell.setValue(n + 1); return "x".repeat(150000);'
$V mcp mx-large-before execute "$(jq -nc --arg worktree "$MX_W" --arg unit "$MX_U" '{worktree:$worktree,unit:$unit,code:"return Number(workbook.getActiveSheet().getRange(\"D1\").getValue() || 0);"}')"
$V mcp --expect-event '.outcome == "ok" and .cost.committed_revisions == 1' mx-large execute "$(jq -nc --arg worktree "$MX_W" --arg unit "$MX_U" --arg code "$MX_LARGE" '{worktree:$worktree,unit:$unit,code:$code}')"
jq -e '.committed == true and .valueTruncated == true and .status == "committed" and (.revision > 0) and (has("value") | not)' "$EVIDENCE/mx-large.out"
$V cli mx-large-cli execute --worktree "$MX_W" --unit "$MX_U" --json -e 'return Number(workbook.getActiveSheet().getRange("D1").getValue() || 0);'
jq -en --slurpfile before "$EVIDENCE/mx-large-before.out" --slurpfile after "$EVIDENCE/mx-large-cli.out" '$after[0].value == ($before[0].value + 1)'
```

Pass when the Sheet counter advances exactly once and the committed result has no retry hint.
Credential replacement near expiry is covered by automated Client Core and MCP worker tests.

**MF1. Stage and publish a Blob.** Uses the Team Space from M4.

```bash
MF_SPACE=$(jq -r '.id' "$EVIDENCE/mcp-repo-verify-team.out")
printf 'gateway upload\n' > "$EVIDENCE/mf-original.txt"
MF_SIZE=$(wc -c < "$EVIDENCE/mf-original.txt" | tr -d ' ')
$V mcp mf-reserve file_upload_create "$(jq -nc --argjson size "$MF_SIZE" '{purpose:"blob",file_name:"original.txt",size:$size,media_type:"text/plain"}')"
MF_UPLOAD=$(jq -r '.upload.upload_id' "$EVIDENCE/mf-reserve.out")
node .agents/skills/verify-uvw/bin/mcp-file.mjs put "$EVIDENCE/mf-reserve.out" "$EVIDENCE/mf-original.txt"
$V mcp --toolsets files --expect-event '.executor == "none" and .cost.upload_bytes > 0' mf-publish blob_upload "$(jq -nc --arg upload "$MF_UPLOAD" --arg space "$MF_SPACE" --arg key "mf-publish-$VERIFY_UVW_RUN" '{upload_id:$upload,space:$space,name:"gateway.txt",idempotency_key:$key}')"
MF_RESOURCE=$(jq -r '.upload.resourceId' "$EVIDENCE/mf-publish.out")
$V cli mf-get-cli blob get "$MF_RESOURCE" --json
diff <(jq -S '.upload | {node:(.node | del(.url)),resource}' "$EVIDENCE/mf-publish.out") <(jq -S '.' "$EVIDENCE/mf-get-cli.out")
$V mcp --toolsets files mf-publish-retry blob_upload "$(jq -nc --arg upload "$MF_UPLOAD" --arg space "$MF_SPACE" --arg key "mf-publish-$VERIFY_UVW_RUN" '{upload_id:$upload,space:$space,name:"gateway.txt",idempotency_key:$key}')"
diff "$EVIDENCE/mf-publish.out" "$EVIDENCE/mf-publish-retry.out"
$V mcp --toolsets files --expect-event '.executor == "none" and .cost.export_bytes > 0' mf-download blob_download "$(jq -nc --arg resource "$MF_RESOURCE" '{resource:$resource}')"
node .agents/skills/verify-uvw/bin/mcp-file.mjs get "$EVIDENCE/mf-download.out" "$EVIDENCE/mf-downloaded.txt"
node -e 'const fs=require("node:fs"),c=require("node:crypto");const hash=p=>c.createHash("sha256").update(fs.readFileSync(p)).digest("hex");if(hash(process.argv[1])!==hash(process.argv[2]))process.exit(1);console.log(hash(process.argv[1]))' "$EVIDENCE/mf-original.txt" "$EVIDENCE/mf-downloaded.txt" > "$EVIDENCE/mf-sha256.txt"
```

Pass when upload and retry return the same Resource, CLI metadata matches, download SHA-256 matches, and the helper asserts the attachment, nosniff, sandbox and no-store headers.

**MF2. Replace a Blob with its ETag.**

```bash
printf 'replacement bytes\n' > "$EVIDENCE/mf-replacement.txt"
MF_NEW_SIZE=$(wc -c < "$EVIDENCE/mf-replacement.txt" | tr -d ' ')
$V mcp mf-replace-reserve file_upload_create "$(jq -nc --argjson size "$MF_NEW_SIZE" '{purpose:"blob",file_name:"replacement.txt",size:$size,media_type:"text/plain"}')"
MF_REPLACE_UPLOAD=$(jq -r '.upload.upload_id' "$EVIDENCE/mf-replace-reserve.out")
node .agents/skills/verify-uvw/bin/mcp-file.mjs put "$EVIDENCE/mf-replace-reserve.out" "$EVIDENCE/mf-replacement.txt"
MF_ETAG=$(jq -r '.etag' "$EVIDENCE/mf-download.out")
MF_REPLACE_ARGS=$(jq -nc --arg resource "$MF_RESOURCE" --arg upload "$MF_REPLACE_UPLOAD" --arg etag "$MF_ETAG" --arg key "mf-replace-$VERIFY_UVW_RUN" '{resource:$resource,upload_id:$upload,etag:$etag,idempotency_key:$key}')
$V mcp --toolsets files mf-replace blob_replace "$MF_REPLACE_ARGS"
$V mcp --toolsets files mf-replace-retry blob_replace "$MF_REPLACE_ARGS"
diff "$EVIDENCE/mf-replace.out" "$EVIDENCE/mf-replace-retry.out"
$V mcp --toolsets files mf-replaced-download blob_download "$(jq -nc --arg resource "$MF_RESOURCE" '{resource:$resource}')"
node .agents/skills/verify-uvw/bin/mcp-file.mjs get "$EVIDENCE/mf-replaced-download.out" "$EVIDENCE/mf-replaced.txt"
cmp "$EVIDENCE/mf-replacement.txt" "$EVIDENCE/mf-replaced.txt"
$V mcp --toolsets files mf-stale-replace blob_replace "$(jq -c '.idempotency_key += "-stale"' <<< "$MF_REPLACE_ARGS")"
test $? -eq 1
jq -e '.code | test("conflict|precondition|etag"; "i")' "$EVIDENCE/mf-stale-replace.out"
```

Pass when replacement retains identity, retries return the same result, the link returns new bytes and a new replacement with the old ETag fails.

**MF3. Capability and owner boundaries, browser upload.**

```bash
$V mcp mf-page-reserve file_upload_create '{"purpose":"blob","file_name":"never-render-this-name.txt","media_type":"text/plain"}'
MF_PAGE=$(jq -r '.upload.page_url' "$EVIDENCE/mf-page-reserve.out")
curl -fsS -D "$EVIDENCE/mf-page.headers" "$MF_PAGE" > "$EVIDENCE/mf-page.html"
grep -q "default-src 'none'; script-src 'nonce-" "$EVIDENCE/mf-page.headers"
! grep -q 'never-render-this-name' "$EVIDENCE/mf-page.html"
MF_WRONG=$(jq -r '.upload.upload_url | sub("token=.*"; "token=" + ("0" * 64))' "$EVIDENCE/mf-page-reserve.out")
test "$(curl -sS -o /dev/null -w '%{http_code}' -X PUT -H 'Content-Length: 15' --data-binary 'gateway upload
' "$MF_WRONG")" = 404
agent-browser open "$MF_PAGE"
agent-browser snapshot -i > "$EVIDENCE/mf-page.snapshot.txt"
agent-browser screenshot "$EVIDENCE/mf-upload-page.png"
agent-browser upload 'input[type=file]' "$EVIDENCE/mf-original.txt"
agent-browser click 'button'
agent-browser wait --text 'Upload complete'
agent-browser screenshot "$EVIDENCE/mf-upload-complete.png"
MF_PAGE_UPLOAD=$(jq -r '.upload.upload_id' "$EVIDENCE/mf-page-reserve.out")
$V mcp --toolsets files mf-page-publish blob_upload "$(jq -nc --arg upload "$MF_PAGE_UPLOAD" --arg space "$MF_SPACE" --arg key "mf-page-$VERIFY_UVW_RUN" '{upload_id:$upload,space:$space,idempotency_key:$key}')"
$V mcp --toolsets files mf-page-download blob_download "$(jq -nc --arg resource "$(jq -r '.upload.resourceId' "$EVIDENCE/mf-page-publish.out")" '{resource:$resource}')"
node .agents/skills/verify-uvw/bin/mcp-file.mjs get "$EVIDENCE/mf-page-download.out" "$EVIDENCE/mf-page-downloaded.txt"
cmp "$EVIDENCE/mf-original.txt" "$EVIDENCE/mf-page-downloaded.txt"
node --input-type=module - "$PWD" "$ORIGIN" "$MCP_URL" "$MF_UPLOAD" "$MF_SPACE" "$EVIDENCE/mf-foreign.json" <<'JS'
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const [root, origin, url, upload, space, evidence] = process.argv.slice(2);
const username = 'foreign-' + randomBytes(6).toString('hex');
const response = await fetch(origin + '/api/auth/password/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, displayName: 'Foreign upload check', password: randomBytes(24).toString('hex') }) });
assert(response.ok, 'second user registers');
const session = response.headers.getSetCookie().map(value => /^workspace_session=([^;]+)/.exec(value)?.[1]).find(Boolean);
assert(session, 'second user session exists');
const require = createRequire(root + '/apps/mcp/package.json');
const { Client, StreamableHTTPClientTransport } = await import(require.resolve('@modelcontextprotocol/client'));
const client = new Client({ name: 'foreign-upload-check', version: '1' });
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(url + '?toolsets=files'), { requestInit: { headers: { Authorization: 'Bearer ' + session } } }));
  const result = await client.callTool({ name: 'blob_upload', arguments: { upload_id: upload, space, name: 'forbidden.txt', idempotency_key: username } });
  assert(result.isError);
  assert.equal(result.structuredContent.code, 'workspace-upload-not-found');
  writeFileSync(evidence, JSON.stringify(result.structuredContent, null, 2) + '\n');
} finally { await client.close(); }
JS
```

Pass when the wrong token is refused, the page has a strict CSP and no supplied name, browser upload succeeds, and a second user's tool call reports upload-not-found.

**MF4. Download a Worktree image Asset.**

```bash
$V mcp mf-asset-pr pr_create "$(jq -nc --arg repo "$O/personal" --arg key "mf-asset-pr-$VERIFY_UVW_RUN" '{repo:$repo,title:"Asset transfer",idempotency_key:$key}')"
MF_WORKTREE=$(jq -r '.id' "$EVIDENCE/mf-asset-pr.out")
$V mcp mf-asset-unit unit_create "$(jq -nc --arg worktree "$MF_WORKTREE" --arg space "$MX_SPACE" --arg key "mf-asset-unit-$VERIFY_UVW_RUN" '{worktree:$worktree,space:$space,type:"sheet",name:"Image asset",idempotency_key:$key}')"
MF_UNIT=$(jq -r '.unit.unitId' "$EVIDENCE/mf-asset-unit.out")
node --input-type=module - "$ORIGIN" "$RUN" "$MF_WORKTREE" "$MF_UNIT" "$EVIDENCE" <<'JS'
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
const [origin,run,worktree,unit,evidence] = process.argv.slice(2);
const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
writeFileSync(evidence + '/mf-image.png', bytes);
const form = new FormData(); form.set('file', new Blob([bytes], { type: 'image/png' }), 'image.png');
const response = await fetch(`${origin}/universer-api/worktrees/${worktree}/stream/file/upload?size=${bytes.length}&source=3&assign=${unit}`, { method: 'POST', headers: { cookie: 'workspace_session=' + readFileSync(run+'/home/mcp-session','utf8').trim() }, body: form });
assert(response.ok, 'public image upload succeeds: ' + response.status);
writeFileSync(evidence + '/mf-asset-upload.json', JSON.stringify(await response.json()));
JS
MF_ASSET=$(jq -r '.FileId' "$EVIDENCE/mf-asset-upload.json")
$V mcp --toolsets files --expect-event '.executor == "none" and .cost.export_bytes > 0' mf-asset-download asset_download "$(jq -nc --arg id "$MF_ASSET" --arg worktree "$MF_WORKTREE" '{id:$id,worktree:$worktree}')"
node .agents/skills/verify-uvw/bin/mcp-file.mjs get "$EVIDENCE/mf-asset-download.out" "$EVIDENCE/mf-asset-mcp.png"
$V cli mf-asset-cli asset download "$EVIDENCE/mf-asset-cli.png" --id "$MF_ASSET" --worktree "$MF_WORKTREE" --json
cmp "$EVIDENCE/mf-image.png" "$EVIDENCE/mf-asset-mcp.png"
cmp "$EVIDENCE/mf-asset-cli.png" "$EVIDENCE/mf-asset-mcp.png"
```

Pass when MCP, public upload and CLI return identical image bytes, with the download headers enforced by the helper.

**MF5. Pending uploads and purpose validation.**

```bash
$V mcp mf-pending-reserve file_upload_create '{"purpose":"blob","file_name":"pending.txt","size":3,"media_type":"text/plain"}'
MF_PENDING=$(jq -r '.upload.upload_id' "$EVIDENCE/mf-pending-reserve.out")
$V mcp --toolsets files mf-pending-publish blob_upload "$(jq -nc --arg upload "$MF_PENDING" --arg space "$MF_SPACE" --arg key "mf-pending-$VERIFY_UVW_RUN" '{upload_id:$upload,space:$space,name:"pending.txt",idempotency_key:$key}')"
test $? -eq 1
jq -e '.code == "workspace-upload-not-ready"' "$EVIDENCE/mf-pending-publish.out"
$V mcp mf-invalid-purpose file_upload_create '{"purpose":"office-import","file_name":"invalid.txt","size":3,"media_type":"text/plain"}'
test $? -eq 1
jq -e '.code == "workspace-upload-media-type-invalid"' "$EVIDENCE/mf-invalid-purpose.out"
```

Pass when a reservation cannot be published before bytes arrive and Office-purpose validation refuses plain text.

**MF6. Upload upper limit, single PUT and download capability.**

```bash
node --input-type=module - "$EVIDENCE" <<'JS'
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
const evidence = process.argv[2];
const { upload } = JSON.parse(readFileSync(evidence + '/mf-pending-reserve.out', 'utf8'));
const statuses = {};
statuses.large = (await fetch(upload.upload_url, { method: 'PUT', body: 'abcd' })).status;
assert.equal(statuses.large, 413);
statuses.ready = (await fetch(upload.upload_url, { method: 'PUT', body: 'ab' })).status;
assert.equal(statuses.ready, 204);
statuses.repeat = (await fetch(upload.upload_url, { method: 'PUT', body: 'xyz' })).status;
assert.equal(statuses.repeat, 409);
const { download } = JSON.parse(readFileSync(evidence + '/mf-replaced-download.out', 'utf8'));
const url = new URL(download.url); url.search = '';
statuses.unsigned = (await fetch(url)).status;
assert.equal(statuses.unsigned, 404);
writeFileSync(evidence + '/mf-capability-statuses.json', JSON.stringify(statuses, null, 2) + '\n');
JS
```

Pass when over-limit files leave an upload retryable, smaller files are accepted, a second successful PUT cannot overwrite bytes, and an unsigned download is refused.

**MF7. Binary XLSX and PNG round trips.** Generates a valid 50,000-row OpenXML workbook larger than 4 MiB and a PNG. Python 3 is needed for standard-library fixture generation.

```bash
python3 .agents/skills/verify-uvw/bin/file-fixtures.py "$EVIDENCE" > "$EVIDENCE/mf-binary-fixtures.tsv"
for MF_EXT in xlsx png; do
  if [ "$MF_EXT" = xlsx ]; then MF_TYPE=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; else MF_TYPE=image/png; fi
  $V mcp "mf-binary-$MF_EXT-reserve" file_upload_create "$(jq -nc --arg name "mf-binary.$MF_EXT" --arg type "$MF_TYPE" '{purpose:"blob",file_name:$name,media_type:$type}')"
  MF_BINARY_UPLOAD=$(jq -r '.upload.upload_id' "$EVIDENCE/mf-binary-$MF_EXT-reserve.out")
  node .agents/skills/verify-uvw/bin/mcp-file.mjs put "$EVIDENCE/mf-binary-$MF_EXT-reserve.out" "$EVIDENCE/mf-binary.$MF_EXT"
  $V mcp --toolsets files "mf-binary-$MF_EXT-publish" blob_upload "$(jq -nc --arg upload "$MF_BINARY_UPLOAD" --arg space "$MF_SPACE" --arg key "mf-binary-$MF_EXT-$VERIFY_UVW_RUN" '{upload_id:$upload,space:$space,idempotency_key:$key}')"
  MF_BINARY_RESOURCE=$(jq -r '.upload.resourceId' "$EVIDENCE/mf-binary-$MF_EXT-publish.out")
  $V mcp --toolsets files "mf-binary-$MF_EXT-download" blob_download "$(jq -nc --arg resource "$MF_BINARY_RESOURCE" '{resource:$resource}')"
  node .agents/skills/verify-uvw/bin/mcp-file.mjs get "$EVIDENCE/mf-binary-$MF_EXT-download.out" "$EVIDENCE/mf-binary-downloaded.$MF_EXT"
  cmp "$EVIDENCE/mf-binary.$MF_EXT" "$EVIDENCE/mf-binary-downloaded.$MF_EXT"
  shasum -a 256 "$EVIDENCE/mf-binary.$MF_EXT" "$EVIDENCE/mf-binary-downloaded.$MF_EXT" > "$EVIDENCE/mf-binary-$MF_EXT-sha256.txt"
done
$V mcp mf-small-page-reserve file_upload_create '{"purpose":"blob","file_name":"small.png","size":1,"media_type":"image/png"}'
agent-browser open "$(jq -r '.upload.page_url' "$EVIDENCE/mf-small-page-reserve.out")"
agent-browser upload 'input[type=file]' "$EVIDENCE/mf-binary.png"
agent-browser find role button click --name 'Upload'
agent-browser wait --text 'File is too large'
agent-browser screenshot "$EVIDENCE/mf-page-too-large.png"
```

Pass when both hashes match after PUT, publication and download, default Blob names are preserved, and the browser explains a 413 without asking for another link.

**MF8. Normalized binary upload paths.** Needs the MF7 PNG and the Team Space from M4.

```bash
for MF_PATH in canonical dot; do
  $V mcp "mf-path-$MF_PATH-reserve" file_upload_create '{"purpose":"blob","file_name":"path.png","media_type":"image/png"}'
  MF_PATH_URL=$(jq -r '.upload.upload_url' "$EVIDENCE/mf-path-$MF_PATH-reserve.out")
  if [ "$MF_PATH" = dot ]; then MF_PATH_URL=$(printf '%s' "$MF_PATH_URL" | sed 's@/mcp/files/@/mcp/./files/@'); fi
  curl --fail --silent --show-error --path-as-is -X PUT --data-binary "@$EVIDENCE/mf-binary.png" "$MF_PATH_URL" > "$EVIDENCE/mf-path-$MF_PATH-put.out"
  MF_PATH_UPLOAD=$(jq -r '.upload.upload_id' "$EVIDENCE/mf-path-$MF_PATH-reserve.out")
  $V mcp --toolsets files "mf-path-$MF_PATH-publish" blob_upload "$(jq -nc --arg upload "$MF_PATH_UPLOAD" --arg space "$MF_SPACE" --arg key "mf-path-$MF_PATH-$VERIFY_UVW_RUN" '{upload_id:$upload,space:$space,idempotency_key:$key}')"
  MF_PATH_RESOURCE=$(jq -r '.upload.resourceId' "$EVIDENCE/mf-path-$MF_PATH-publish.out")
  $V mcp --toolsets files "mf-path-$MF_PATH-download" blob_download "$(jq -nc --arg resource "$MF_PATH_RESOURCE" '{resource:$resource}')"
  node .agents/skills/verify-uvw/bin/mcp-file.mjs get "$EVIDENCE/mf-path-$MF_PATH-download.out" "$EVIDENCE/mf-path-$MF_PATH.png"
  cmp "$EVIDENCE/mf-binary.png" "$EVIDENCE/mf-path-$MF_PATH.png"
done
shasum -a 256 "$EVIDENCE/mf-binary.png" "$EVIDENCE/mf-path-canonical.png" "$EVIDENCE/mf-path-dot.png" > "$EVIDENCE/mf-path-sha256.txt"
```

Pass when canonical and dot-segment PUTs survive publication and download with the same SHA-256 as the original binary.

**MF9. Normalized MCP body cap.** Sends more than 4 MiB without client URL normalization.

```bash
python3 - "$EVIDENCE/mf-oversized.json" <<'PY'
import json, sys
with open(sys.argv[1], 'w') as f:
    json.dump(dict(jsonrpc="2.0", id=1, method="ping", params=dict(pad="x" * (5 * 1024 * 1024))), f)
PY
for MF_ESCAPE in '/mcp/files/../../mcp' '/mcp/files/%2e%2e/%2e%2e/mcp'; do
  MF_CAP_LABEL=plain
  if [ "$MF_ESCAPE" != '/mcp/files/../../mcp' ]; then MF_CAP_LABEL=encoded; fi
  MF_CAP_STATUS=$(curl --silent --show-error --path-as-is --max-time 15 -o "$EVIDENCE/mf-cap-$MF_CAP_LABEL.body" -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data-binary "@$EVIDENCE/mf-oversized.json" "${MCP_URL%/mcp}$MF_ESCAPE")
  printf '%s\n' "$MF_CAP_STATUS" > "$EVIDENCE/mf-cap-$MF_CAP_LABEL.status"
  test "$MF_CAP_STATUS" = 413
done
```

Pass when both oversized requests receive HTTP 413 through the normalized MCP route.

**MX7. Office xlsx round trip.**

```bash
node .agents/skills/verify-uvw/bin/mcp-office-roundtrip.mjs xlsx
```

Pass when the fixture has two sheets, numeric cells and a formula; a signed PUT and MCP import
succeed without reserving an exact upload size; MCP inspect matches CLI import; and downloaded MCP export matches a CLI export of the
same Unit after parsing through CLI import and inspect. Keep the upload status and headers.
If the base gateway upload adapter refuses or corrupts the binary PUT, record that failure and
stop this journey. Do not bypass the upload route.

**MX8. Office docx round trip.**

```bash
node .agents/skills/verify-uvw/bin/mcp-office-roundtrip.mjs docx
```

Pass with the same upload, import, inspection and export checks for a Doc containing text,
using a reserved size upper bound larger than the actual file.
The same base binary-upload defect may block this journey before import.

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

**MH1. HTML View validation parity over a populated trunk Sheet.**

```bash
$V mcp mh-repo repo_view "{\"repo\":\"$O/personal\"}"
MH_SPACE=$(jq -r .id "$EVIDENCE/mh-repo.out")
$V cli mh-pr pr create -R "$O/personal" -t 'HTML View source' --json
MH_W=$(jq -r .id "$EVIDENCE/mh-pr.out")
MH_N=$(jq -r .number "$EVIDENCE/mh-pr.out")
$V cli mh-unit unit create --worktree "$MH_W" --space "$MH_SPACE" --type sheet --name 'HTML View data' --json
MH_U=$(jq -r .unit.unitId "$EVIDENCE/mh-unit.out")
$V cli mh-data execute --worktree "$MH_W" --unit "$MH_U" --json -e 'const ws = workbook.getActiveSheet(); ws.getRange("A1:B2").setValues([["Region","Total"],["North",42]]); return {sheetId:ws.getSheetId()};'
MH_S=$(jq -r .value.sheetId "$EVIDENCE/mh-data.out")
$V cli mh-ready pr ready "$MH_N" -R "$O/personal" --json
$V cli mh-merge pr merge "$MH_N" -R "$O/personal" --json
printf '<!DOCTYPE html><html><head><title>Regional totals</title></head><body style="background:#fff;color:#111;font:18px system-ui;padding:32px"><h1>Regional totals</h1><p>North: <output data-univer-cell-text="%s:%s:B2"></output></p></body></html>\n' "$MH_U" "$MH_S" > "$EVIDENCE/mh-view.univer.html"
$V mcp --toolsets files --expect-event '.unit_type == "sheet" and .cost.committed_revisions == 0 and .cost.worker_cpu_ms > 0' mh-validate html_view_validate "$(jq -nc --rawfile html "$EVIDENCE/mh-view.univer.html" '{html:$html}')"
$V cli mh-validate-cli html-view validate --file "$EVIDENCE/mh-view.univer.html" --json
diff <(jq -S . "$EVIDENCE/mh-validate.out") <(jq -S . "$EVIDENCE/mh-validate-cli.out")
jq -e --arg unit "$MH_U" '.valid == true and .unitIds == [$unit] and .bindingCount == 1' "$EVIDENCE/mh-validate.out"
```

Pass when the Sheet is merged with data and MCP and CLI validation results match.

**MH2. Missing HTML View source parity.**

```bash
printf '<output data-univer-cell-text="missing-html-sheet:missing:A1"></output>\n' > "$EVIDENCE/mh-missing.univer.html"
$V mcp --toolsets files mh-missing html_view_validate "$(jq -nc --rawfile html "$EVIDENCE/mh-missing.univer.html" '{html:$html}')"
test $? -eq 1
$V cli mh-missing-cli html-view validate --file "$EVIDENCE/mh-missing.univer.html" --json
test $? -eq 1
MH_CODE=$(jq -r .code "$EVIDENCE/mh-missing.out")
test "$(cut -d: -f1 < "$EVIDENCE/mh-missing-cli.err" | head -n1)" = "$MH_CODE"
jq -e --arg code "$MH_CODE" '.outcome == "tool_error" and .error_code == $code' "$EVIDENCE/mh-missing.event.json"
```

Pass when both clients preserve the same missing-source code.

**MH3. Publish, retry and open the validated HTML View.**

```bash
MH_ARGS=$(jq -nc --rawfile html "$EVIDENCE/mh-view.univer.html" --arg space "$MH_SPACE" --arg key "html-view-$VERIFY_UVW_RUN-$MH_U" '{html:$html,space:$space,name:"Regional totals",idempotency_key:$key}')
$V mcp --toolsets files --expect-event '.cost.upload_bytes > 0 and .cost.committed_revisions == 0' mh-create html_view_create "$MH_ARGS"
$V mcp --toolsets files mh-retry html_view_create "$MH_ARGS"
diff <(jq -S '{nodeId,resourceId,operationId,workspaceUrl}' "$EVIDENCE/mh-create.out") <(jq -S '{nodeId,resourceId,operationId,workspaceUrl}' "$EVIDENCE/mh-retry.out")
$V cli mh-blob-get blob get "$(jq -r .resourceId "$EVIDENCE/mh-create.out")" --json
$V cli mh-blob-download blob download "$EVIDENCE/mh-published.univer.html" --force --resource "$(jq -r .resourceId "$EVIDENCE/mh-create.out")" --json
cmp "$EVIDENCE/mh-view.univer.html" "$EVIDENCE/mh-published.univer.html"
agent-browser open "$ORIGIN/login"
agent-browser wait 1500
if agent-browser get url | grep -q '/login'; then
  agent-browser find label 'Username' fill "$O"
  agent-browser find label 'Password' fill "$(cat "$RUN/user.pw")"
  agent-browser click 'form button[type=submit]'
  agent-browser wait --url '**/home'
fi
agent-browser open "$(jq -r .workspaceUrl "$EVIDENCE/mh-create.out")"
agent-browser wait 3000
agent-browser screenshot "$EVIDENCE/mh-published.png"
agent-browser reload
agent-browser wait 2000
agent-browser screenshot "$EVIDENCE/mh-published-reloaded.png"
```

Pass when both calls return the same Node, downloaded bytes equal the validated source,
and the Browser screenshots show North and 42 before and after reload.

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


**MX9. Office import idempotent retry.** Repeat the same upload and key after a delay and verify the Worktree still has one imported Unit.

```bash
node .agents/skills/verify-uvw/bin/mcp-office-retry.mjs
```

Pass when both calls return the same Unit ID and the Worktree Unit list is unchanged.
