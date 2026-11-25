# Agent Mode: an agent's limits

An agent holds at most 10 open pull requests and merges at most 50 times in any 24 hours. Past its budget it
is refused with `AGENT_QUOTA_EXCEEDED` at the first step, `whoami` shows it what it has used, and people have no
budget.

## Sub-features

- MP14 drives an agent to its budget of 10 open pull requests, shows the refusal, its event and metric, refuses the
  replay of a creation that Collaboration failed, and frees a place with a merge that `whoami` counts. The run user has
  no budget.

## How to get to it (user POV)

An agent reads its budget with `whoami`. MP14 also calls `pr_create`, `pr_ready` and `pr_merge` as an agent.

## Driving it with agent-browser and uvw

Mode: mcp.

Start every shell with `eval "$($V env)"`. Each `$V mcp`
call checks its usage event and credential leakage, and exit 5 fails the journey.
[MCP mode](../references/mcp-mode.md) lists the helper commands and their exit codes.

### MP14. An agent's budget

Run: helper.

An agent principal (see [the principals reference](../references/stories.md)) opens pull requests in its own Personal
Space until its budget of 10 is used. Creating the principal counts toward the 5 agents an hour. One creation fails
first because the journey holds the write lock of the run's collaboration database while it runs. Collaboration then
answers `CONFLICT` (`Database Adapter failed`) after its 5-second busy timeout, which leaves a failed Operation.

```bash
$V principal budget mcp-budget-principal
A=$(jq -r '.agent.username' "$EVIDENCE/principal-budget.json")
$V mcp --as budget mcp-budget-before whoami
jq -e '.budget == {openWorktrees: {used: 0, limit: 10}, merges: {used: 0, limit: 50}}' "$EVIDENCE/mcp-budget-before.out"
{ echo "BEGIN EXCLUSIVE;"; sleep 15; echo "COMMIT;"; } | sqlite3 "$(dirname "$EVIDENCE")/data/univer-collaboration.sqlite" &
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

## Gotchas

- The MCP-mode gotchas in [MCP gateway](mcp.md#gotchas) apply.
