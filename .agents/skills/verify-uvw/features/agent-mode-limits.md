# Agent Mode: an agent's limits

An agent holds at most 10 open pull requests and merges at most 50 times in any 24 hours. Past its budget it
is refused with `AGENT_QUOTA_EXCEEDED` at the first step, `whoami` shows it what it has used, and people have no
budget. Until a person claims it, an agent owns at most 3 Team Spaces and 3 forks and keeps at most 20 files across
all its Spaces (`AGENT_QUOTA_EXCEEDED`). It cannot make a Space public, join a Team Space or add anyone to one, and
user search neither finds it nor answers it (`AGENT_NOT_ALLOWED`). A claimed agent joins a person's Team Space as a
Viewer or an Editor, never as an admin. Someone who is not a member holds at most 3 open proposals in one Team Space
(`FORBIDDEN`). Each limit has a way out: a claim, a deleted fork, a file moved to Trash or a discarded proposal.

## Sub-features

- MP14 drives an agent to its budget of 10 open pull requests, shows the refusal, its event and metric, refuses the
  replay of a creation that Collaboration failed, and frees a place with a merge that `whoami` counts. The run user has
  no budget.
- CE1 adds a claimed agent to a person's Team Space as a Viewer and refuses it as an admin, refuses an unclaimed agent
  as a member and as one that adds members, hides it from user search, lets it join and add once claimed, and hides a
  stopped agent from search.
- CE2 drives an unclaimed agent to 3 Team Spaces, 3 forks and 20 files across three Spaces, some still in a pull
  request, refuses each next one and a public Team Space, and frees a fork with `fork_delete`, a file with a move to
  Trash and the Team Spaces with a claim.
- CE3 has an agent that is not a member open 3 proposals in a public Team Space, refuses the fourth with `FORBIDDEN`,
  and opens it after `pr_discard`.

## How to get to it (user POV)

An agent reads its budget with `whoami`. MP14 also calls `pr_create`, `pr_ready` and `pr_merge` as an agent. CE1-CE3
call `claim`, `repo_create`, `repo_member_write`, `fork_create`, `fork_delete`, `unit_create`, `space_node` and
`pr_discard` as agents. The run user adds members with `uvw repo member add`, and claims and stops agents through the
HTTP API that the claim page and `My agents` call.

## Driving it with agent-browser and uvw

Mode: mcp.

Start every shell with `eval "$($V env)"`. Each `$V mcp`
call checks its usage event and credential leakage, and exit 5 fails the journey.
[MCP mode](../references/mcp-mode.md) lists the helper commands and their exit codes.

The run user O signs in to the HTTP API with a cookie kept outside `$EVIDENCE`. `claim_agent <principal> <label>`
has the agent mint a claim link with `claim`, has O claim it with `POST /api/agents/claim` as the claim page does, and
replaces the used code in the evidence:

```bash
O=verify-$VERIFY_UVW_RUN; OC=$RUN/home/o-cookies
curl --fail-with-body -sS -c "$OC" -o /dev/null -X POST "$ORIGIN/api/auth/password/login" -H 'content-type: application/json' \
  -d "{\"username\":\"$O\",\"password\":\"$(cat "$RUN/user.pw")\"}"
claim_agent() {
  $V mcp --as "$1" "$2" claim '{}' > /dev/null
  curl --fail-with-body -sS -b "$OC" -o "$EVIDENCE/$2-claimed.json" -X POST "$ORIGIN/api/agents/claim" -H 'content-type: application/json' \
    -d "{\"code\":\"$(jq -r '.claimUrl | split("/") | last' "$EVIDENCE/$2.out")\"}"
  perl -pi -e 's{/claim/[A-Za-z0-9_-]{22}(?![A-Za-z0-9_-])}{/claim/[REDACTED]}g' "$EVIDENCE/$2".*
}
```

### MP14. An agent's budget

Run: helper.

An agent principal (see [the principals reference](../references/stories.md)) opens pull requests in its own Personal
Space until its budget of 10 is used. One creation fails
first because the journey holds the write lock of the run's collaboration database while it runs. Collaboration then
answers `CONFLICT` (`Database Adapter failed`) after its 5-second busy timeout, which leaves a failed Operation.

```bash
$V principal budget mcp-budget-principal
A=$(jq -r '.agent.username' "$EVIDENCE/principal-budget.json")
$V mcp --as budget mcp-budget-before whoami
jq -e '.budget == {openWorktrees: {used: 0, limit: 10}, merges: {used: 0, limit: 50}}' "$EVIDENCE/mcp-budget-before.out"
{ echo "BEGIN EXCLUSIVE;"; sleep 15; echo "COMMIT;"; } | sqlite3 "$(dirname "$EVIDENCE")/data/univer-collaboration.sqlite" &
sleep 2
$V mcp --as budget mcp-budget-failed pr_create "{\"repo\":\"$A/personal\",\"title\":\"Task F\",\"idempotency_key\":\"mcp-budget-key-$VERIFY_UVW_RUN-failed\"}"
test $? -eq 1
wait
$V mcp --as budget mcp-budget-after-failure whoami
jq -e '.budget.openWorktrees.used == 0' "$EVIDENCE/mcp-budget-after-failure.out"
for n in $(seq 1 10); do
  $V mcp --as budget "mcp-budget-pr-$n" pr_create "{\"repo\":\"$A/personal\",\"title\":\"Task $n\",\"idempotency_key\":\"mcp-budget-key-$VERIFY_UVW_RUN-$n\"}" || break
done
$V mcp --as budget mcp-budget-full whoami
jq -e '.budget.openWorktrees == {used: 10, limit: 10}' "$EVIDENCE/mcp-budget-full.out"
$V mcp --as budget mcp-budget-over pr_create "{\"repo\":\"$A/personal\",\"title\":\"Task 11\"}"
test $? -eq 1
jq -e '.code == "AGENT_QUOTA_EXCEEDED" and (.message | contains("at most 10 open pull requests. Merge or discard one"))' "$EVIDENCE/mcp-budget-over.out"
jq -e '.outcome == "tool_error" and .error_code == "AGENT_QUOTA_EXCEEDED" and .principal_category == "agent_unclaimed"' "$EVIDENCE/mcp-budget-over.event.json"
$V mcp --as budget mcp-budget-failed-replay pr_create "{\"repo\":\"$A/personal\",\"title\":\"Task F\",\"idempotency_key\":\"mcp-budget-key-$VERIFY_UVW_RUN-failed\"}"
test $? -eq 1
jq -e '.code == "AGENT_QUOTA_EXCEEDED"' "$EVIDENCE/mcp-budget-failed-replay.out"
$V mcp --as budget mcp-budget-failed-replay-whoami whoami
jq -e '.budget.openWorktrees.used == 10' "$EVIDENCE/mcp-budget-failed-replay-whoami.out"
$V metrics | grep 'workspace_ceiling_denials_total{action="openWorktree"' > "$EVIDENCE/mcp-budget-denials.txt"
grep -F 'code="AGENT_QUOTA_EXCEEDED",principal_category="agent_unclaimed"} 2' "$EVIDENCE/mcp-budget-denials.txt"
$V mcp --as budget mcp-budget-replay pr_create "{\"repo\":\"$A/personal\",\"title\":\"Task 10\",\"idempotency_key\":\"mcp-budget-key-$VERIFY_UVW_RUN-10\"}"
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

### CE1. Who may join a repository

Run: helper.

O holds a Team Space S. O adds a claimed agent A as a Viewer, and the change to admin is refused. An unclaimed agent
U is refused as a member: uvw does not find it, and the HTTP API that adds members answers `AGENT_NOT_ALLOWED`. User
search finds A and not U. U creates a repository of its own and cannot add O to it. Once O claims U, O adds U to S and
U adds O to its repository. O then stops A, and search no longer finds it.

```bash
$V cli ce1-repo repo create ce-joins --name "Joins" --json id,fullName
S=$(jq -r .id "$EVIDENCE/ce1-repo.out"); R="$O/ce-joins"
$V principal ce-claimed ce1-a
$V principal ce-unclaimed ce1-u
A=$(jq -r .agent.username "$EVIDENCE/principal-ce-claimed.json"); U=$(jq -r .agent.username "$EVIDENCE/principal-ce-unclaimed.json")
claim_agent ce-claimed ce1-a-claim
$V cli ce1-add-a repo member add "$A" --role viewer -R "$R" --json role
jq -e '.role == "viewer"' "$EVIDENCE/ce1-add-a.out"
$V cli ce1-admin-a repo member add "$A" --role admin -R "$R" --json role
test $? -eq 1
grep -q '^AGENT_NOT_ALLOWED: An unclaimed agent cannot add or be a Team Space member, and an agent can be an admin only of a Team Space an agent owns.' "$EVIDENCE/ce1-admin-a.err"
$V cli ce1-add-u repo member add "$U" --role viewer -R "$R" --json role
test $? -eq 1
grep -q 'Unclaimed and stopped agents cannot be members.' "$EVIDENCE/ce1-add-u.err"
curl -sS -b "$OC" -o "$EVIDENCE/ce1-put-u.json" -w '%{http_code}\n' -X PUT -H 'content-type: application/json' -d '{"role":"viewer"}' \
  "$ORIGIN/api/team-spaces/$S/members/$(jq -r .agent.id "$EVIDENCE/principal-ce-unclaimed.json")" > "$EVIDENCE/ce1-put-u.status"
grep -qx 403 "$EVIDENCE/ce1-put-u.status"
jq -e '.error.code == "AGENT_NOT_ALLOWED"' "$EVIDENCE/ce1-put-u.json"
curl --fail-with-body -sS -b "$OC" "$ORIGIN/api/users/search?query=$A" > "$EVIDENCE/ce1-search-a.json"
jq -e '[.users[].username] == ["'"$A"'"]' "$EVIDENCE/ce1-search-a.json"
curl --fail-with-body -sS -b "$OC" "$ORIGIN/api/users/search?query=$U" > "$EVIDENCE/ce1-search-u.json"
jq -e '.users == []' "$EVIDENCE/ce1-search-u.json"
$V mcp --as ce-unclaimed ce1-u-repo repo_create '{"slug":"own","name":"Own"}'
$V mcp --as ce-unclaimed ce1-u-add-o repo_member_write "{\"repo\":\"$U/own\",\"action\":\"add\",\"user\":\"$O\",\"role\":\"viewer\"}"
test $? -eq 1
jq -e '.code == "AGENT_NOT_ALLOWED" and .message == "An unclaimed agent cannot add Team Space members. A person must claim it first."' "$EVIDENCE/ce1-u-add-o.out"
claim_agent ce-unclaimed ce1-u-claim
$V cli ce1-add-u-claimed repo member add "$U" --role viewer -R "$R" --json role
jq -e '.role == "viewer"' "$EVIDENCE/ce1-add-u-claimed.out"
$V mcp --as ce-unclaimed ce1-u-add-o-claimed repo_member_write "{\"repo\":\"$U/own\",\"action\":\"add\",\"user\":\"$O\",\"role\":\"viewer\"}"
jq -e '.role == "viewer"' "$EVIDENCE/ce1-u-add-o-claimed.out"
curl --fail-with-body -sS -b "$OC" -o /dev/null -X POST "$ORIGIN/api/agents/$(jq -r .agent.id "$EVIDENCE/principal-ce-claimed.json")/stop"
curl --fail-with-body -sS -b "$OC" "$ORIGIN/api/users/search?query=$A" > "$EVIDENCE/ce1-search-stopped.json"
jq -e '.users == []' "$EVIDENCE/ce1-search-stopped.json"
```

Pass when A joins as a Viewer and the change to admin exits 1 with `AGENT_NOT_ALLOWED`; uvw cannot find U and the
HTTP API answers 403 `AGENT_NOT_ALLOWED`; search finds A and not U; U creates its repository, and its
`repo_member_write` exits 1 with `AGENT_NOT_ALLOWED` and says a person must claim it; once claimed, U joins S as a
Viewer and adds O; and search no longer finds the stopped A.

### CE2. An unclaimed agent's Team Spaces, forks and files

Run: helper.

An unclaimed agent Q creates Team Spaces q1 to q3 and is refused a fourth and a public one. It forks q1 three times
and is refused a fourth fork until it deletes one. It merges 10 Sheets into its Personal Space and puts 10 more in a
pull request in q1, so a Sheet in q2 is refused until it moves one to Trash. Once O claims Q, its fourth Team Space is
created. `sheets <repo> <label> <count>` has Q open a pull request in a repository and create Sheets in it.

```bash
$V principal ce-quota ce2-q
Q=$(jq -r .agent.username "$EVIDENCE/principal-ce-quota.json")
$V mcp --as ce-quota ce2-public repo_create '{"slug":"q0","public":true}'
test $? -eq 1
jq -e '.code == "AGENT_NOT_ALLOWED" and .message == "An unclaimed agent cannot make a Space public. Keep it private, or give a person a claim link so they can claim you, which lifts this limit. Claiming also lets that person open every Space you own."' "$EVIDENCE/ce2-public.out"
for n in 1 2 3; do
  $V mcp --as ce-quota "ce2-repo-$n" repo_create "{\"slug\":\"q$n\"}" || break
done
jq -s -e 'map(.fullName) == ["'"$Q/q1"'", "'"$Q/q2"'", "'"$Q/q3"'"]' "$EVIDENCE"/ce2-repo-[123].out
$V mcp --as ce-quota ce2-repo-4 repo_create '{"slug":"q4"}'
test $? -eq 1
jq -e '.code == "AGENT_QUOTA_EXCEEDED" and .message == "An unclaimed agent can own at most 3 Team Spaces. Work in one you already own, or give a person a claim link so they can claim you, which lifts this limit."' "$EVIDENCE/ce2-repo-4.out"
for n in 1 2 3; do
  $V mcp --as ce-quota "ce2-fork-$n" fork_create "{\"repo\":\"$Q/q1\",\"name\":\"f$n\"}" || break
done
jq -s -e 'map(.fullName) == ["'"$Q/f1"'", "'"$Q/f2"'", "'"$Q/f3"'"]' "$EVIDENCE"/ce2-fork-[123].out
$V mcp --as ce-quota ce2-fork-4 fork_create "{\"repo\":\"$Q/q1\",\"name\":\"f4\"}"
test $? -eq 1
jq -e '.code == "AGENT_QUOTA_EXCEEDED" and .message == "An unclaimed agent can own at most 3 forks. Delete a fork you no longer need, or give a person a claim link so they can claim you, which lifts this limit."' "$EVIDENCE/ce2-fork-4.out"
$V mcp --as ce-quota ce2-fork-delete fork_delete "{\"fork\":\"$Q/f1\"}"
$V mcp --as ce-quota ce2-fork-4-freed fork_create "{\"repo\":\"$Q/q1\",\"name\":\"f4\"}"
jq -e '.fullName == "'"$Q/f4"'"' "$EVIDENCE/ce2-fork-4-freed.out"
sheets() {
  $V mcp --as ce-quota "$2-pr" pr_create "{\"repo\":\"$1\",\"title\":\"$2\"}"
  W=$(jq -r .id "$EVIDENCE/$2-pr.out"); N=$(jq -r .number "$EVIDENCE/$2-pr.out")
  for n in $(seq 1 "$3"); do
    $V mcp --as ce-quota "$2-$n" unit_create "{\"worktree\":\"$W\",\"space\":\"$1\",\"type\":\"sheet\",\"name\":\"$2-$n\"}" || break
  done
}
sheets "$Q/personal" ce2-personal 10
jq -s -e 'map(.unit.change) == [range(10) | "added"]' "$EVIDENCE"/ce2-personal-[0-9]*.out
$V mcp --as ce-quota ce2-personal-ready pr_ready "{\"repo\":\"$Q/personal\",\"number\":\"$N\"}"
$V mcp --as ce-quota ce2-personal-merge pr_merge "{\"repo\":\"$Q/personal\",\"number\":\"$N\"}"
jq -e '.state == "merged"' "$EVIDENCE/ce2-personal-merge.out"
sheets "$Q/q1" ce2-team 10
jq -s -e 'map(.unit.change) == [range(10) | "added"]' "$EVIDENCE"/ce2-team-[0-9]*.out
$V mcp --as ce-quota ce2-over-pr pr_create "{\"repo\":\"$Q/q2\",\"title\":\"ce2-over\"}"
W=$(jq -r .id "$EVIDENCE/ce2-over-pr.out")
$V mcp --as ce-quota ce2-over-1 unit_create "{\"worktree\":\"$W\",\"space\":\"$Q/q2\",\"type\":\"sheet\",\"name\":\"ce2-over-1\"}"
test $? -eq 1
jq -e '.code == "AGENT_QUOTA_EXCEEDED" and .message == "An unclaimed agent can keep at most 20 files across its Spaces, new files in its open pull requests included. Move files you no longer need to Trash, or give a person a claim link so they can claim you, which lifts this limit."' "$EVIDENCE/ce2-over-1.out"
$V mcp --as ce-quota ce2-trash space_node "{\"action\":\"trash\",\"node\":\"$(jq -r .unit.nodeId "$EVIDENCE/ce2-personal-1.out")\"}"
$V mcp --as ce-quota ce2-over-freed unit_create "{\"worktree\":\"$W\",\"space\":\"$Q/q2\",\"type\":\"sheet\",\"name\":\"ce2-over-1\"}"
jq -e '.unit.change == "added"' "$EVIDENCE/ce2-over-freed.out"
claim_agent ce-quota ce2-claim
$V mcp --as ce-quota ce2-repo-4-claimed repo_create '{"slug":"q4"}'
jq -e '.fullName == "'"$Q/q4"'"' "$EVIDENCE/ce2-repo-4-claimed.out"
```

Pass when the public Team Space exits 1 with `AGENT_NOT_ALLOWED` and names a claim as the way out; q1 to q3 are created and q4 exits 1 with
`AGENT_QUOTA_EXCEEDED` naming 3 Team Spaces; f1 to f3 are created, and f4 exits 1 naming 3 forks and is created after
`fork_delete`; the Personal Space pull request merges 10 Sheets and q1's pull request holds 10 more; the Sheet in q2
exits 1 naming 20 files and is created after one Sheet moves to Trash; and after the claim q4 is created.

### CE3. A non-member's open proposals

Run: helper.

O makes a public Team Space whose proposals setting is `anyone`. An unclaimed agent N, not a member, opens three
proposals there, and the fourth is refused with `FORBIDDEN`. N discards one with `pr_discard` and opens the fourth.

```bash
$V cli ce3-repo repo create ce-open --name "Open" --public --proposals anyone --json fullName,publicRead,proposals
jq -e '.publicRead and .proposals == "anyone"' "$EVIDENCE/ce3-repo.out"
$V principal ce-outsider ce3-n
for n in 1 2 3; do
  $V mcp --as ce-outsider "ce3-pr-$n" pr_create "{\"repo\":\"$O/ce-open\",\"title\":\"Proposal $n\"}" || break
done
jq -s -e 'map(.state) == ["draft", "draft", "draft"]' "$EVIDENCE"/ce3-pr-[123].out
$V mcp --as ce-outsider ce3-pr-4 pr_create "{\"repo\":\"$O/ce-open\",\"title\":\"Proposal 4\"}"
test $? -eq 1
jq -e '.code == "FORBIDDEN" and .message == "Someone who is not a Space Member can have at most 3 open proposals in a Team Space."' "$EVIDENCE/ce3-pr-4.out"
$V mcp --as ce-outsider --toolsets core,admin ce3-discard pr_discard "{\"repo\":\"$O/ce-open\",\"number\":\"$(jq -r .number "$EVIDENCE/ce3-pr-1.out")\"}"
jq -e '.state == "discarded"' "$EVIDENCE/ce3-discard.out"
$V mcp --as ce-outsider ce3-pr-4-freed pr_create "{\"repo\":\"$O/ce-open\",\"title\":\"Proposal 4\"}"
jq -e '.state == "draft"' "$EVIDENCE/ce3-pr-4-freed.out"
```

Pass when the repository reads back public with `anyone`, three proposals open as drafts, the fourth exits 1 with
`FORBIDDEN` and the message above, the discard succeeds, and the fourth then opens.

## Gotchas

- The MCP-mode gotchas in [MCP gateway](mcp.md#gotchas) apply.
- uvw and MCP name a member through user search, which never returns an unclaimed or stopped agent, so they answer
  `No user named or identified by "<name>" can join.` before the server can refuse. CE1 reads the server's
  `AGENT_NOT_ALLOWED` from `PUT /api/team-spaces/<id>/members/<user-id>` with the agent's ID.
- CE1-CE3 claim and stop agents through the HTTP API with O's cookie. [Agent handoff and claim](agent-handoff.md)
  drives the claim page and `My agents` in the browser.
