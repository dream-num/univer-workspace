# MCP gateway

An agent connects to a disposable Docker gateway with its own Workspace session, reads
identity and repositories through either MCP protocol, and leaves correlated usage evidence.

## Sub-features

- M1 starts the image and verifies the disposable environment.
- M2 and M3 read identity over the 2026-07-28 and 2025-11-25 protocols.
- M4 and M5 compare repository lists and details with uvw.
- M6 preserves a missing-repository error and its usage event.
- M7 checks toolsets, ordered definitions, schemas, and annotations.
- M8 rejects missing and invalid credentials in both protocols.
- M9 rejects an untrusted Origin.
- M10 refuses development authentication in production.
- M11 calls the gateway from opencode.
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
  jq -e 'map(.name) == ["whoami","repo_list","repo_view"] and all(.[]; .annotations.readOnlyHint == true and .annotations.destructiveHint == false and .annotations.openWorldHint == false and .inputSchema != null and .outputSchema != null)' "$EVIDENCE/mcp-tools-$label.out"
done
jq -e '.status == 400 and (.body | fromjson | .valid == ["core","files","admin","all"])' "$EVIDENCE/mcp-tools-unknown.out"
```

Pass when core and all exit 0 with the fixed tool order, schemas and annotations;
unknown exits 3 with HTTP 400 and the valid toolset names. Tool lists have no event file.

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
jq -s -e 'any(.[]; .type == "tool_use" and any(.state.metadata.metadata.toolCalls[]?; .tool == "verify-uvw.whoami" and .status == "completed"))' "$EVIDENCE/mcp-opencode-whoami.jsonl"
jq -e 'length == 1 and .[0].outcome == "ok" and .[0].client_name == null' "$EVIDENCE/mcp-opencode-whoami.event.json"
```

Pass when opencode exits 0, a `tool_use` fragment records the completed
`verify-uvw.whoami` call, its output identifies this run's user, and exactly one matching
event has outcome `ok` and null client name. Keep the JSONL. It contains the four output
fragment types, not developer plugins, skills or credentials.

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
