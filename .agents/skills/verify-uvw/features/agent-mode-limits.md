# Agent Mode: an agent's limits

An agent holds at most 10 open pull requests and merges at most 50 times in any 24 hours. Past its budget it
is refused with `AGENT_QUOTA_EXCEEDED` at the first step, `whoami` shows it what it has used, and people have no
budget. Until a person claims it, an agent owns at most 3 Team Spaces and 3 forks and keeps at most 20 files across
all its Spaces (`AGENT_QUOTA_EXCEEDED`). It cannot make a Space public, join a Team Space or add anyone to one, and
user search neither finds it nor answers it (`AGENT_NOT_ALLOWED`). A claimed agent joins a person's Team Space as a
Viewer or an Editor, never as an admin. Someone who is not a member holds at most 3 open proposals in one Team Space
(`FORBIDDEN`). Each limit has a way out: a person who takes the agent, a deleted fork, a file moved to Trash or a discarded proposal.
Only a person signed in to the browser lets more people see data. When an agent or a uvw session asks to add a
member, raise a role or make a Space public, the server changes nothing and answers `INTERACTIVE_SESSION_REQUIRED`
with a confirm link, and the person who opens it confirms or gives up.

## Sub-features

- MP14 drives an agent to its budget of 10 open pull requests, shows the refusal, its event and metric, refuses the
  replay of a creation that Collaboration failed, and frees a place with a merge that `whoami` counts. The run user has
  no budget.
- CE1 adds a claimed agent to a person's Team Space as a Viewer and refuses it as an admin, refuses an unclaimed agent
  as a member and as one that adds members, hides it from user search, lets it join once claimed, answers its own
  added member with a confirm link that its claimer confirms, and hides a stopped agent from search.
- CE2 drives an unclaimed agent to 3 Team Spaces, 3 forks and 20 files across three Spaces, some still in a pull
  request, refuses each next one and making a Team Space public, and frees a fork with `fork_delete`, a file with a
  move to Trash and the Team Spaces with a claim.
- CE3 has an agent that is not a member open 3 proposals in a public Team Space, refuses the fourth with `FORBIDDEN`,
  and opens it after `pr_discard`.
- CE4 has a claimed agent ask to add a member. The call changes nothing and returns a confirm link. The server
  refuses the confirmation of a person without the capability, and the agent's claimer opens the link, confirms, and
  the member appears.

## How to get to it (user POV)

An agent reads its budget with `whoami`. MP14 also calls `pr_create`, `pr_ready` and `pr_merge` as an agent. CE1-CE3
call `claim`, `repo_create`, `repo_member_write`, `fork_create`, `fork_delete`, `unit_create`, `space_node` and
`pr_discard` as agents. The run user adds members with its browser session (`$V person … repo member add`), and claims and stops agents through the
HTTP API that the handoff page and `My agents` call.

## Driving it with agent-browser and uvw

Mode: mcp.

Start every shell with `eval "$($V env)"`. Each `$V mcp`
call checks its usage event and credential leakage, and exit 5 fails the journey.
[MCP mode](../references/mcp-mode.md) lists the helper commands and their exit codes.

The run user O signs in to the HTTP API with a cookie kept outside `$EVIDENCE`. `claim_agent <principal> <label>`
has the agent mint a handoff link with `claim`, has O take it with `POST /api/agents/claim` as the handoff page does, and
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

O holds a Team Space S. O's uvw session is refused when it adds a claimed agent A, with a confirm link, and O adds A
as a Viewer in the browser session. The change to admin is refused. An unclaimed agent
U is refused as a member: uvw does not find it, and the HTTP API that adds members answers `AGENT_NOT_ALLOWED`. User
search finds A and not U. U creates a repository of its own and cannot add O to it. Once O claims U, O adds U to S.
U's call to add O to its repository now returns a confirm link, and O confirms it. O then stops A, and search no
longer finds it.

```bash
$V cli ce1-repo repo create ce-joins --name "Joins" --json id,fullName
S=$(jq -r .id "$EVIDENCE/ce1-repo.out"); R="$O/ce-joins"
$V principal ce-claimed ce1-a
$V principal ce-unclaimed ce1-u
A=$(jq -r .agent.username "$EVIDENCE/principal-ce-claimed.json"); U=$(jq -r .agent.username "$EVIDENCE/principal-ce-unclaimed.json")
claim_agent ce-claimed ce1-a-claim
$V cli ce1-add-a-cli repo member add "$A" --role viewer -R "$R" --json role
test $? -eq 1
grep -q '^INTERACTIVE_SESSION_REQUIRED: ' "$EVIDENCE/ce1-add-a-cli.err"
grep -qF "Give the user this link so they can confirm it in the browser: $ORIGIN/confirm/member?space=$S&user=$(jq -r .agent.id "$EVIDENCE/principal-ce-claimed.json")&role=viewer" "$EVIDENCE/ce1-add-a-cli.err"
$V person ce1-add-a repo member add "$A" --role viewer -R "$R" --json role
jq -e '.role == "viewer"' "$EVIDENCE/ce1-add-a.out"
$V cli ce1-admin-a repo member add "$A" --role admin -R "$R" --json role
test $? -eq 1
grep -q '^AGENT_NOT_ALLOWED: An unclaimed agent cannot be a Team Space member, and an agent can be an admin only of a Team Space an agent owns.' "$EVIDENCE/ce1-admin-a.err"
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
jq -e '.code == "AGENT_NOT_ALLOWED" and .message == "An unclaimed agent cannot add Team Space members. Give the user your handoff link from claim (uvw claim in the CLI). Once they take you, try again."' "$EVIDENCE/ce1-u-add-o.out"
claim_agent ce-unclaimed ce1-u-claim
$V person ce1-add-u-claimed repo member add "$U" --role viewer -R "$R" --json role
jq -e '.role == "viewer"' "$EVIDENCE/ce1-add-u-claimed.out"
$V mcp --as ce-unclaimed ce1-u-add-o-claimed repo_member_write "{\"repo\":\"$U/own\",\"action\":\"add\",\"user\":\"$O\",\"role\":\"viewer\"}"
test $? -eq 1
US=$(jq -r .id "$EVIDENCE/ce1-u-repo.out"); OID=$(jq -r .user.id "$RUN/logs/register.json")
jq -e --arg url "$ORIGIN/confirm/member?space=$US&user=$OID&role=viewer" '.code == "INTERACTIVE_SESSION_REQUIRED" and .detail.url == $url' "$EVIDENCE/ce1-u-add-o-claimed.out"
curl --fail-with-body -sS -b "$OC" -o "$EVIDENCE/ce1-o-confirms.json" -X PUT -H 'content-type: application/json' -d '{"role":"viewer"}' "$ORIGIN/api/team-spaces/$US/members/$OID"
jq -e '.role == "viewer"' "$EVIDENCE/ce1-o-confirms.json"
curl --fail-with-body -sS -b "$OC" -o /dev/null -X POST "$ORIGIN/api/agents/$(jq -r .agent.id "$EVIDENCE/principal-ce-claimed.json")/stop"
curl --fail-with-body -sS -b "$OC" "$ORIGIN/api/users/search?query=$A" > "$EVIDENCE/ce1-search-stopped.json"
jq -e '.users == []' "$EVIDENCE/ce1-search-stopped.json"
```

Pass when O's uvw add exits 1 with `INTERACTIVE_SESSION_REQUIRED` and the confirm link for A as a Viewer, A joins as
a Viewer through the browser session and the change to admin exits 1 with `AGENT_NOT_ALLOWED`; uvw cannot find U and the
HTTP API answers 403 `AGENT_NOT_ALLOWED`; search finds A and not U; U creates its repository, and its
`repo_member_write` exits 1 with `AGENT_NOT_ALLOWED` and points to its handoff link; once claimed, U joins S as a
Viewer, its own `repo_member_write` exits 1 with the confirm link for O, and O's browser session adds O with the
values that link names; and search no longer finds the stopped A.

### CE2. An unclaimed agent's Team Spaces, forks and files

Run: helper.

An unclaimed agent Q creates Team Spaces q1 to q3, is refused a fourth, and is refused when it makes q1 public. It forks q1 three times
and is refused a fourth fork until it deletes one. It merges 10 Sheets into its Personal Space and puts 10 more in a
pull request in q1, so a Sheet in q2 is refused until it moves one to Trash. Once O claims Q, its fourth Team Space is
created and O lists Q's forks as its own. `sheets <repo> <label> <count>` has Q open a pull request in a repository and create Sheets in it.

```bash
$V principal ce-quota ce2-q
Q=$(jq -r .agent.username "$EVIDENCE/principal-ce-quota.json")
for n in 1 2 3; do
  $V mcp --as ce-quota "ce2-repo-$n" repo_create "{\"slug\":\"q$n\"}" || break
done
jq -s -e 'map(.fullName) == ["'"$Q/q1"'", "'"$Q/q2"'", "'"$Q/q3"'"]' "$EVIDENCE"/ce2-repo-[123].out
$V mcp --as ce-quota ce2-public repo_edit "{\"repo\":\"$Q/q1\",\"visibility\":\"public\"}"
test $? -eq 1
jq -e '.code == "AGENT_NOT_ALLOWED" and (.detail.url == null) and .message == "An unclaimed agent cannot let more people see its work, and no person can confirm it for you. Get a handoff link with claim (uvw claim in the CLI) and give it to the user. They can open it to see your work without signing in. Once they sign in and take you, try again."' "$EVIDENCE/ce2-public.out"
$V mcp --as ce-quota ce2-repo-4 repo_create '{"slug":"q4"}'
test $? -eq 1
jq -e '.code == "AGENT_QUOTA_EXCEEDED" and .message == "An unclaimed agent can own at most 3 Team Spaces. Work in one you already own, or give a person a handoff link so they can take you, which lifts this limit."' "$EVIDENCE/ce2-repo-4.out"
for n in 1 2 3; do
  $V mcp --as ce-quota "ce2-fork-$n" fork_create "{\"repo\":\"$Q/q1\",\"name\":\"f$n\"}" || break
done
jq -s -e 'map(.fullName) == ["'"$Q/f1"'", "'"$Q/f2"'", "'"$Q/f3"'"]' "$EVIDENCE"/ce2-fork-[123].out
$V mcp --as ce-quota ce2-fork-4 fork_create "{\"repo\":\"$Q/q1\",\"name\":\"f4\"}"
test $? -eq 1
jq -e '.code == "AGENT_QUOTA_EXCEEDED" and .message == "An unclaimed agent can own at most 3 forks. Delete a fork you no longer need, or give a person a handoff link so they can take you, which lifts this limit."' "$EVIDENCE/ce2-fork-4.out"
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
jq -e '.code == "AGENT_QUOTA_EXCEEDED" and .message == "An unclaimed agent can keep at most 20 files across its Spaces, new files in its open pull requests included. Move files you no longer need to Trash, or give a person a handoff link so they can take you, which lifts this limit."' "$EVIDENCE/ce2-over-1.out"
$V mcp --as ce-quota ce2-trash space_node "{\"action\":\"trash\",\"node\":\"$(jq -r .unit.nodeId "$EVIDENCE/ce2-personal-1.out")\"}"
$V mcp --as ce-quota ce2-over-freed unit_create "{\"worktree\":\"$W\",\"space\":\"$Q/q2\",\"type\":\"sheet\",\"name\":\"ce2-over-1\"}"
jq -e '.unit.change == "added"' "$EVIDENCE/ce2-over-freed.out"
claim_agent ce-quota ce2-claim
$V mcp --as ce-quota ce2-repo-4-claimed repo_create '{"slug":"q4"}'
jq -e '.fullName == "'"$Q/q4"'"' "$EVIDENCE/ce2-repo-4-claimed.out"
curl --fail-with-body -sS -b "$OC" "$ORIGIN/api/forks" > "$EVIDENCE/ce2-o-forks.json"
jq -e '[.forks[] | select(.owner.username == "'"$Q"'") | .name] | sort == ["f2", "f3", "f4"]' "$EVIDENCE/ce2-o-forks.json"
```

Pass when q1 to q3 are created, making q1 public exits 1 with `AGENT_NOT_ALLOWED`, no confirm link and the handoff link as the way out, and q4 exits 1 with
`AGENT_QUOTA_EXCEEDED` naming 3 Team Spaces; f1 to f3 are created, and f4 exits 1 naming 3 forks and is created after
`fork_delete`; the Personal Space pull request merges 10 Sheets and q1's pull request holds 10 more; the Sheet in q2
exits 1 naming 20 files and is created after one Sheet moves to Trash; and after the claim q4 is created and O's
own fork list holds Q's f2, f3 and f4.

### CE3. A non-member's open proposals

Run: helper.

O makes a public Team Space whose proposals setting is `anyone`. An unclaimed agent N, not a member, opens three
proposals there, and the fourth is refused with `FORBIDDEN`. N discards one with `pr_discard` and opens the fourth.

```bash
$V cli ce3-repo-private repo create ce-open --name "Open" --proposals anyone --json fullName,publicRead,proposals
$V person ce3-repo repo edit "$O/ce-open" --visibility public --json fullName,publicRead,proposals
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

### CE4. A person confirms what an agent asks for

O claims two agents, C and D. C creates a repository of its own, which O owns too, and asks to add D as an Editor.
The call changes nothing and returns a confirm link. A person V, a Viewer of the repository, opens the link, and the
server refuses V's confirmation. O opens it, confirms, and D is a member.

```bash
$V principal ce-asker ce4-c
$V principal ce-joiner ce4-d
C=$(jq -r .agent.username "$EVIDENCE/principal-ce-asker.json"); D=$(jq -r .agent.username "$EVIDENCE/principal-ce-joiner.json")
claim_agent ce-asker ce4-c-claim
claim_agent ce-joiner ce4-d-claim
$V mcp --as ce-asker ce4-repo repo_create '{"slug":"ce-asks","name":"Asks"}'
T=$(jq -r .id "$EVIDENCE/ce4-repo.out"); R="$C/ce-asks"
$V mcp --as ce-asker ce4-add repo_member_write "{\"repo\":\"$R\",\"action\":\"add\",\"user\":\"$D\",\"role\":\"editor\"}"
test $? -eq 1
L="$ORIGIN/confirm/member?space=$T&user=$(jq -r .agent.id "$EVIDENCE/principal-ce-joiner.json")&role=editor"
jq -e --arg url "$L" '.code == "INTERACTIVE_SESSION_REQUIRED" and .detail.url == $url and (.message | endswith("Give the user this link so they can confirm it in the browser: " + $url))' "$EVIDENCE/ce4-add.out"
$V mcp --as ce-asker ce4-members-before repo_member_list "{\"repo\":\"$R\"}"
jq -e '.members == []' "$EVIDENCE/ce4-members-before.out"
$V metrics > "$EVIDENCE/ce4-metrics.prom"
grep -E '^workspace_exposure_refusals_total\{change="member",code="INTERACTIVE_SESSION_REQUIRED",principal_category="agent_claimed"\} [1-9]' "$EVIDENCE/ce4-metrics.prom"
```

Create V in a second browser session: with `AGENT_BROWSER_SESSION=verify-uvw-$VERIFY_UVW_RUN-v`, pin the language and
view as [the skill](../SKILL.md#drive) does, open `/login`, click the `Create account` mode button, fill `Username` with
`ce4-v-$VERIFY_UVW_RUN`, `Display name` and `Password`, and submit. O makes V a Viewer:
`$V person ce4-viewer repo member add "ce4-v-$VERIFY_UVW_RUN" --role viewer -R "$R" --json role`. In V's session, open
`$L` and click `Confirm`. The page shows `The current user cannot perform this action.`, does not say `Done.`, and
`Now` still reads `Not a member`. Screenshot it as `ce4-viewer.png`.

In the run browser, signed in as O, open `$L`. The page reads `Give <D's display name> (@<D>) access to <C>/ce-asks?`
and `<D's display name> (@<D>) will be able to read and edit every file in <C>/ce-asks.`, with `Now` `Not a member`
and `After you confirm` `Can edit`, and the buttons `Confirm` and `Give up`. Open `$L&title=Harmless` too: the page is
the same and never shows `Harmless`. Screenshot it as `ce4-confirm.png`, then
`agent-browser find role button click --name Confirm --exact`. The page says `Done.` and `Now` reads `Can edit`. Then:

```bash
$V mcp --as ce-asker ce4-members-after repo_member_list "{\"repo\":\"$R\"}"
jq -e --arg d "$D" '[.members[] | select(.user.username == $d) | .role] == ["editor"]' "$EVIDENCE/ce4-members-after.out"
$V mcp --as ce-asker ce4-again repo_member_write "{\"repo\":\"$R\",\"action\":\"add\",\"user\":\"$D\",\"role\":\"editor\"}"
jq -e '.role == "editor"' "$EVIDENCE/ce4-again.out"
$V mcp --as ce-asker ce4-lower repo_member_write "{\"repo\":\"$R\",\"action\":\"edit\",\"user\":\"$D\",\"role\":\"viewer\"}"
jq -e '.role == "viewer"' "$EVIDENCE/ce4-lower.out"
AGENT_BROWSER_SESSION=verify-uvw-$VERIFY_UVW_RUN-v agent-browser close
```

Pass when C's add exits 1 with `INTERACTIVE_SESSION_REQUIRED` and the confirm link in its message and `detail.url`,
the member list stays empty and the refusal is counted; V's `Confirm` is refused and changes nothing; O's page names
D and the repository as the server reads them, shows nothing from the link's extra parameter, and its `Confirm` makes
D an Editor; and C's repeat of the stored role and its change down to Viewer succeed with no link.

## Gotchas

- The MCP-mode gotchas in [MCP gateway](mcp.md#gotchas) apply.
- `$V person <label> <uvw args>` runs uvw with the run user's browser session and saves evidence as `$V cli` does. It
  stands in for the person doing the same in the browser, so use it for setup. CE4, LS2 and MH4 drive the confirm
  page itself.
- uvw and MCP name a member through user search, which never returns an unclaimed or stopped agent, so they answer
  `No user named or identified by "<name>" can join.` before the server can refuse. CE1 reads the server's
  `AGENT_NOT_ALLOWED` from `PUT /api/team-spaces/<id>/members/<user-id>` with the agent's ID.
- CE1-CE3 claim and stop agents through the HTTP API with O's cookie. [Agent handoff and claim](agent-handoff.md)
  drives the handoff page and `My agents` in the browser.
