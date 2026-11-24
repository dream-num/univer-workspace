# Scripts and compilers over MCP

An agent runs a Facade script against a Unit with `execute`, reads it with `inspect`, and compiles Typst and SVG
into Docs and Slides. A write commits once with its revision facts, errors read like the CLI's, stale sessions
and concurrent writes resolve without lost updates, and a long compilation becomes a job.

## Sub-features

- MX1 writes a 2x2 range through the executor and compares MCP and CLI readbacks and usage events.
- MX2 preserves a ready Worktree error with detail.
- MX3 verifies executor unavailability.
- MX4 captures the written values in the Browser.
- MX5 compares uncoded script failure messages with the CLI.
- MX6 verifies a large committed result keeps commit facts and writes once.
- MX16 returns `inspect` input errors in MCP words, without CLI flags, and requires exactly one scope.
- MX11 through MX15 cover stale worker sessions, concurrent revision conflicts, two executor replicas (opt-in), stale sessions on HTML View validation, and parallel writes with reads.
- MT1 compares Typst compilation with the CLI and reads back one native Doc after a same-key retry.
- MV1 compares estimated SVG compilation with the CLI and reads back its committed Slide.
- Typst job verification runs Typst as a job on a stack with `MCP_SYNC_BUDGET_MS=1`.

## How to get to it (user POV)

An MCP client connected to `$MCP_URL` calls `execute` and `inspect` from the default `core` toolset, and
`compile_typst` and `compile_svg` from `files`, on a Unit in a pull request. The same operations are
`uvw execute`, `uvw inspect`, `uvw compile-typst` and `uvw compile-svg`.

## Driving it with agent-browser and uvw

Run these in an MCP-mode instance, started as in [MCP gateway](mcp.md): `VERIFY_UVW_MCP=1 $V up`,
`$V user` and a `$V doctor` with no `FAIL` lines. Start every shell with `eval "$($V env)"`. Each `$V mcp`
call checks its usage event and credential leakage, and exit 5 fails the journey.
[MCP mode](../references/mcp-mode.md) lists the helper commands and their exit codes. MX4 signs the run browser in itself. MX13 needs `VERIFY_UVW_MCP_EXECUTORS=2` at `up`.

```bash
O=verify-$VERIFY_UVW_RUN
```

### MX1. Executor write and readback

```bash
$V mcp mx-repo repo_view "{\"repo\":\"$O/personal\"}"
MX_SPACE=$(jq -r .id "$EVIDENCE/mx-repo.out")
$V mcp mx-pr pr_create "{\"repo\":\"$O/personal\",\"title\":\"Executor readback\",\"idempotency_key\":\"mx-pr-$VERIFY_UVW_RUN-idempotency\"}"
MX_W=$(jq -r .id "$EVIDENCE/mx-pr.out")
$V mcp mx-unit unit_create "{\"worktree\":\"$MX_W\",\"space\":\"$MX_SPACE\",\"type\":\"sheet\",\"name\":\"Executor sheet\",\"idempotency_key\":\"mx-unit-$VERIFY_UVW_RUN-idempotency\"}"
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

### MX2. Ready Worktree error

```bash
$V mcp mx-ready pr_ready "{\"repo\":\"$O/personal\",\"number\":\"$MX_W\"}"
$V mcp mx-ready-execute execute "$(jq -nc --arg worktree "$MX_W" --arg unit "$MX_U" '{worktree:$worktree,unit:$unit,code:"return 1"}')"
test $? -eq 1
jq -e '.code == "workspace-worktree-not-editable" and .detail.state == "ready"' "$EVIDENCE/mx-ready-execute.out"
```

Pass when the error preserves `detail.state` and does not execute code.

### MX3. Stopped executor (host only)

```bash
MX_CONTAINER=$(docker ps -q --filter "label=com.docker.compose.project=$MCP_PROJECT" --filter label=com.docker.compose.service=executor)
trap 'docker start "$MX_CONTAINER" >/dev/null' EXIT
docker stop "$MX_CONTAINER"
$V mcp mx-executor-stopped inspect "$(jq -nc --arg worktree "$MX_W" --arg unit "$MX_U" '{worktree:$worktree,unit:$unit,target:"workbook"}')"
test $? -eq 1
jq -e '.code == "workspace-executor-unavailable"' "$EVIDENCE/mx-executor-stopped.out"
docker start "$MX_CONTAINER"
trap - EXIT
until [ "$(docker inspect -f '{{.State.Health.Status}}' "$MX_CONTAINER")" = healthy ]; do sleep 1; done
```

Pass when the gateway returns `workspace-executor-unavailable` and the executor restarts.

### MX4. Browser proof

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
agent-browser wait canvas
agent-browser wait 4000
agent-browser screenshot "$EVIDENCE/mx-pull-request.png"
```

Pass when the screenshot shows Region, Total, North and 42 in the pull request's Sheet.

### MX5. Script errors match CLI text

Run right after MX3: its executor restart makes this call `cold_start`.

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

### MX6. Large committed values do not repeat writes

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

### MX16. Inspect input errors in MCP words

```bash
mx_inspect() { $V mcp "mx-inspect-$1" inspect "$(jq -c --arg worktree "$MX_W" --arg unit "$MX_U" '. + {worktree:$worktree,unit:$unit}' <<< "$2")"; test $? -eq 1; }
mx_inspect no-worksheet '{"target":"range","selectors":["A1:B2"]}'
mx_inspect index-zero '{"target":"range","selectors":["A1:B2"],"worksheet":"index:0"}'
mx_inspect not-range '{"target":"workbook","worksheet":"index:1"}'
jq -e '.code == "workspace-argument-invalid" and .message == "range requires the worksheet argument (id:<id>, name:<name> or index:N)"' "$EVIDENCE/mx-inspect-no-worksheet.out"
jq -e '.message == "Invalid index \"0\"; indices start at 1"' "$EVIDENCE/mx-inspect-index-zero.out"
jq -e '.message == "worksheet is only valid when target is range, not workbook"' "$EVIDENCE/mx-inspect-not-range.out"
$V mcp mx-inspect-no-scope inspect "$(jq -nc --arg unit "$MX_U" '{unit:$unit,target:"workbook"}')"
test $? -eq 1
jq -e '.code == "workspace-inspect-scope-required"' "$EVIDENCE/mx-inspect-no-scope.out"
jq -e '.outcome == "tool_error" and .error_code == "workspace-argument-invalid"' "$EVIDENCE/mx-inspect-no-worksheet.event.json"
```

Pass when each call exits 1 with the message above, none names a CLI flag (`--worksheet`) or the CLI, and the event
records the tool error. The CLI keeps its own wording for the same input.

### MX11. Stale worker session (host only)

Two PATs share one user and one warm worker. Revoke A, recover B, and reject A.

```bash
node .agents/skills/verify-uvw/bin/mcp-resilience.mjs auth
```

Pass when B succeeds with one auth rerun and A receives HTTP 401. Evidence is `resilience-auth.json`.

### MX12. Concurrent revision conflict (host only)

Resolve two writes concurrently against one Unit.

```bash
node .agents/skills/verify-uvw/bin/mcp-resilience.mjs revision
```

Pass when both writes commit on consecutive revisions, at most one revision rerun is logged (the executor queues same-Unit writes, so none is normal), and inspect contains both values.
Evidence is `resilience-revision.json`.

### MX13. Two executor replicas (host only)

Opt in at launch with `VERIFY_UVW_MCP_EXECUTORS=2`. The default run skips this journey.

```bash
node .agents/skills/verify-uvw/bin/mcp-resilience.mjs replicas
```

Pass when three calls use the same replica, stopping it moves the next call to the other replica,
and killing a slow write returns `workspace-result-unknown` without a replay. A manual retry writes once.
The journey restarts stopped containers. Evidence is `resilience-replicas.json`.

### MX14. Stale worker session on HTML View validation (host only)

Merge a data Sheet, validate a bound HTML View with A, revoke A,
and validate with B. Then revoke B and call the executor with a 4-second deadline using the dev session, which leaves no time for a rerun.

```bash
node .agents/skills/verify-uvw/bin/mcp-resilience.mjs html-auth
```

Pass when B succeeds with one auth rerun, the no-rerun call returns a retryable `workspace-executor-timeout` that is not an
`auth_error`, the next executor call succeeds on the replaced worker, and the primary bearer still works. Evidence is `resilience-html-auth.json`.

### MX15. Parallel writes and reads during writes (host only)

Five parallel `execute` calls on one Unit, then an `inspect` loop during eight sequential writes.

```bash
node .agents/skills/verify-uvw/bin/mcp-resilience.mjs burst
```

Pass when all five writes commit and no `inspect` fails. Evidence is `resilience-burst.json` with the commit count, inspect failure count and rerun reasons.

For sustained contention, run eight writer loops and two inspect loops on one Unit for 30 seconds.

```bash
node .agents/skills/verify-uvw/bin/mcp-resilience.mjs harsh
```

Pass when every write commits, every committed value is read back at its written cell, and no inspect fails.
`resilience-harsh.json` records request outcomes, read latency p50 and p95 in milliseconds, and reruns.
Latency includes MCP connection, queue wait, the tool call, and client close on the local Docker stack.

### MT1. Typst bundle compilation and retry-safe Doc creation

```bash
node .agents/skills/verify-uvw/bin/compiler-journeys.mjs typst
```

Pass when a ZIP containing a heading, paragraph, table and image is uploaded by PUT,
compile-only JavaScript and diagnostics match the CLI, native Doc inspection reads back
its content, and a same-key retry returns the same single Unit. All MCP calls go through
`mcp-call.mjs`. Evidence uses the `mcp-typst-*` prefix and `compiler-fixture/`.

### MV1. SVG compilation and Slide content commit

```bash
node .agents/skills/verify-uvw/bin/compiler-journeys.mjs svg
```

Pass when estimated SVG compilation matches the CLI, retains its estimation lint, commits page 1
of a new Slide, and inspection reads the diagram text. Evidence uses the `mcp-svg-*` prefix. There
is no SVG retry key; an unknown write outcome requires inspection before another apply.

### Typst job verification

After the default-budget journeys, run `down` and start a fresh stack with
`MCP_SYNC_BUDGET_MS=1 VERIFY_UVW_MCP=1 $V up`, then `user` and `doctor`.
Keep those commands and the journey in the same long-lived shell.

```bash
eval "$($V env)"
node .agents/skills/verify-uvw/bin/compiler-journeys.mjs typst-jobs
```

Pass when apply returns a running job, `job_get` returns the committed Doc,
the same-key retry returns that job or its original result, and `unit_list`
has exactly one new Unit. Inspect the native Doc to read back its text.
Evidence uses `mcp-typst-job-*`. Run `$V down` afterward.

## Gotchas

- The MCP-mode gotchas in [MCP gateway](mcp.md#gotchas) apply.
