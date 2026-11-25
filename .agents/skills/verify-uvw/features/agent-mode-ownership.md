# Agent Mode: repositories an agent owns

An agent that creates a Team repository owns it, with every right a person owner has: it manages members and Issue
labels, and reopens and discards other people's pull requests. In a repository an agent owns, another claimed agent
can be an admin with the same capabilities as a person admin, but only the owner decides whether the repository
requires checks. The person who claimed the owning agent owns each of its repositories too, whether the agent created
it before or after the claim. When that person stops the agent, its repositories are suspended: their members read
nothing, and the claimer still sees them.

## Sub-features

- AO1 has a claimed agent A create a repository R and own it. A adds a claimed agent B, claimed by another person P,
  as an admin and P as an Editor. B's capabilities equal P's once P is an admin too. B renames R and creates an Issue
  label, and cannot turn on required checks. A edits B's label, and reopens and discards a pull request of B's.
- AO2 has the run user O, A's claimer, see R and a repository A created before the claim as their owner, change P's
  role, make R public and private again, and discard a pull request of B's.
- AO3 has O stop A. B and P then read nothing of R, and O still sees it.

## How to get to it (user POV)

An agent calls `repo_create`, `repo_member_write`, `repo_view`, `repo_edit`, `label_write`, `label_list`, `pr_create`,
`pr_ready`, `pr_view`, `pr_discard`, `space_browse` and `outline`. The claimer uses `uvw repo list`, `repo view`,
`repo member`, `repo edit` and `pr discard`, and claims and stops agents through the HTTP API that the claim page and
`My agents` call.

## Driving it with agent-browser and uvw

Mode: mcp.

Start every shell with `eval "$($V env)"`. Each `$V mcp`
call checks its usage event and credential leakage, and exit 5 fails the journey.
[MCP mode](../references/mcp-mode.md) lists the helper commands and their exit codes.

The run user O signs in to the HTTP API with a cookie kept outside `$EVIDENCE`. `claim_agent <principal> <label>
[cookie-jar]` has the agent mint a claim link with `claim`, has O, or the person whose cookie jar is given, claim it
with `POST /api/agents/claim` as the claim page does, and replaces the used code in the evidence:

```bash
O=verify-$VERIFY_UVW_RUN; OC=$RUN/home/o-cookies
curl --fail-with-body -sS -c "$OC" -o /dev/null -X POST "$ORIGIN/api/auth/password/login" -H 'content-type: application/json' \
  -d "{\"username\":\"$O\",\"password\":\"$(cat "$RUN/user.pw")\"}"
claim_agent() {
  $V mcp --as "$1" "$2" claim '{}' > /dev/null
  curl --fail-with-body -sS -b "${3:-$OC}" -o "$EVIDENCE/$2-claimed.json" -X POST "$ORIGIN/api/agents/claim" -H 'content-type: application/json' \
    -d "{\"code\":\"$(jq -r '.claimUrl | split("/") | last' "$EVIDENCE/$2.out")\"}"
  perl -pi -e 's{/claim/[A-Za-z0-9_-]{22}(?![A-Za-z0-9_-])}{/claim/[REDACTED]}g' "$EVIDENCE/$2".*
}
```

### AO1. An agent owns its repository and makes another agent its admin

Run: helper.

A person P registers. A creates a repository before O claims it, then O claims A and P claims B, as the agents list of
each person shows. A creates R, adds B
as an admin and P as an Editor, then makes P an admin. B's capabilities on R equal P's. B renames R and creates the
label `triage`, and its `landing` change is refused. A renames the label, then reopens and discards B's ready pull
request.

```bash
P=$O-p; PH=$RUN/home/p; mkdir -m 700 -p "$PH"; openssl rand -hex 16 > "$PH/pw"
curl --fail-with-body -sS -c "$PH/cookies" -o /dev/null -X POST "$ORIGIN/api/auth/password/register" -H 'content-type: application/json' \
  -d "{\"username\":\"$P\",\"displayName\":\"Person P\",\"password\":\"$(cat "$PH/pw")\"}"
$V principal ao-a ao1-a
$V principal ao-b ao1-b
A=$(jq -r .agent.username "$EVIDENCE/principal-ao-a.json"); B=$(jq -r .agent.username "$EVIDENCE/principal-ao-b.json")
$V mcp --as ao-a ao1-before-claim repo_create '{"slug":"before-claim","name":"Before claim"}'
claim_agent ao-a ao1-a-claim
claim_agent ao-b ao1-b-claim "$PH/cookies"
curl --fail-with-body -sS -b "$OC" "$ORIGIN/api/agents" > "$EVIDENCE/ao1-o-agents.json"
curl --fail-with-body -sS -b "$PH/cookies" "$ORIGIN/api/agents" > "$EVIDENCE/ao1-p-agents.json"
jq -s -e 'map([.agents[].username]) | (.[0] | index("'"$A"'") != null and index("'"$B"'") == null) and .[1] == ["'"$B"'"]' \
  "$EVIDENCE/ao1-o-agents.json" "$EVIDENCE/ao1-p-agents.json"
R="$A/owned"
$V mcp --as ao-a ao1-repo repo_create '{"slug":"owned","name":"Owned"}'
S=$(jq -r .id "$EVIDENCE/ao1-repo.out")
jq -e '.accessRole == "owner"' "$EVIDENCE/ao1-repo.out"
$V mcp --as ao-a ao1-add-b repo_member_write "{\"repo\":\"$R\",\"action\":\"add\",\"user\":\"$B\",\"role\":\"admin\"}"
$V mcp --as ao-a ao1-add-p repo_member_write "{\"repo\":\"$R\",\"action\":\"add\",\"user\":\"$P\",\"role\":\"editor\"}"
jq -s -e 'map(.role) == ["admin", "editor"]' "$EVIDENCE/ao1-add-b.out" "$EVIDENCE/ao1-add-p.out"
$V mcp --as ao-a ao1-p-admin repo_member_write "{\"repo\":\"$R\",\"action\":\"edit\",\"user\":\"$P\",\"role\":\"admin\"}"
jq -e '.role == "admin"' "$EVIDENCE/ao1-p-admin.out"
curl --fail-with-body -sS -b "$PH/cookies" "$ORIGIN/api/spaces/$S" > "$EVIDENCE/ao1-p-view.json"
$V mcp --as ao-b ao1-b-view repo_view "{\"repo\":\"$R\"}"
jq -s -e 'map(.accessRole) == ["admin", "admin"] and .[0].capabilities == .[1].capabilities and .[1].capabilities.manageMembers' \
  "$EVIDENCE/ao1-p-view.json" "$EVIDENCE/ao1-b-view.out"
$V mcp --as ao-b ao1-b-rename repo_edit "{\"repo\":\"$R\",\"name\":\"Owned by an agent\"}"
jq -e '.name == "Owned by an agent"' "$EVIDENCE/ao1-b-rename.out"
$V mcp --as ao-b --toolsets core,admin ao1-b-label label_write "{\"repo\":\"$R\",\"action\":\"create\",\"name\":\"triage\",\"color\":\"blue\"}"
$V mcp --as ao-b ao1-b-landing repo_edit "{\"repo\":\"$R\",\"landing\":\"checks\"}"
test $? -eq 1
jq -e '.code == "AGENT_NOT_ALLOWED" and .message == "Only a person or the agent that owns this repository can change whether it requires checks."' "$EVIDENCE/ao1-b-landing.out"
$V mcp --as ao-a --toolsets core,admin ao1-a-label label_write "{\"repo\":\"$R\",\"action\":\"edit\",\"name\":\"triage\",\"new_name\":\"needs-triage\",\"color\":\"orange\"}"
$V mcp --as ao-a --toolsets core,admin ao1-labels label_list "{\"repo\":\"$R\"}"
jq -e '[.labels[] | {name, color}] == [{name: "needs-triage", color: "orange"}]' "$EVIDENCE/ao1-labels.out"
$V mcp --as ao-b ao1-b-pr pr_create "{\"repo\":\"$R\",\"title\":\"B's proposal\",\"visibility\":\"space\"}"
NB=$(jq -r .number "$EVIDENCE/ao1-b-pr.out")
$V mcp --as ao-b ao1-b-ready pr_ready "{\"repo\":\"$R\",\"number\":\"$NB\"}"
$V mcp --as ao-a ao1-a-view pr_view "{\"repo\":\"$R\",\"number\":\"$NB\"}"
jq -e '.state == "ready" and .capabilities.reopen and .capabilities.discard' "$EVIDENCE/ao1-a-view.out"
$V mcp --as ao-a ao1-a-reopen pr_ready "{\"repo\":\"$R\",\"number\":\"$NB\",\"undo\":true}"
jq -e '.state == "draft"' "$EVIDENCE/ao1-a-reopen.out"
$V mcp --as ao-a --toolsets core,admin ao1-a-discard pr_discard "{\"repo\":\"$R\",\"number\":\"$NB\"}"
jq -e '.state == "discarded"' "$EVIDENCE/ao1-a-discard.out"
```

Pass when O's agents include A and not B, and P's are only B; A owns R; B joins as an admin and P as an Editor, then
an admin; P's and B's capabilities on R are equal and
include `manageMembers`; B renames R and creates `triage`, and its `landing` change exits 1 with `AGENT_NOT_ALLOWED`;
A's edit leaves one label, `needs-triage` in orange; and A sees `reopen` and `discard` on B's ready pull request, reopens
it to a draft and discards it. A merging another agent's proposal is in [MP11 and MP12](agent-mode-tasks.md).

### AO2. The claimer owns the agent's repositories

Run: helper.

This journey uses AO1's agents, P and repositories, so AO1 runs first. O, who claimed A, finds R and the repository A
created before the claim among its own, as their owner with the same capabilities. O makes P a Viewer, makes R public
and private again, and discards a pull request of B's, whose claimer is P.

```bash
$V cli ao2-list repo list -L 100 --json fullName,accessRole
jq -e '[.[] | select(.fullName == "'"$A/before-claim"'" or .fullName == "'"$R"'") | .accessRole] == ["owner", "owner"]' "$EVIDENCE/ao2-list.out"
$V cli ao2-before-claim repo view "$A/before-claim" --json accessRole,capabilities
$V cli ao2-owned repo view "$R" --json accessRole,capabilities
jq -s -e '.[0] == .[1] and .[1].accessRole == "owner" and .[1].capabilities.manageMembers' "$EVIDENCE/ao2-before-claim.out" "$EVIDENCE/ao2-owned.out"
$V cli ao2-member repo member edit "$P" --role viewer -R "$R" --json role
jq -e '.role == "viewer"' "$EVIDENCE/ao2-member.out"
$V cli ao2-public repo edit "$R" --visibility public --json publicRead
$V cli ao2-private repo edit "$R" --visibility private --json publicRead
jq -s -e 'map(.publicRead) == [true, false]' "$EVIDENCE/ao2-public.out" "$EVIDENCE/ao2-private.out"
$V mcp --as ao-b ao2-b-pr pr_create "{\"repo\":\"$R\",\"title\":\"B's second proposal\",\"visibility\":\"space\"}"
$V cli ao2-discard pr discard "$(jq -r .number "$EVIDENCE/ao2-b-pr.out")" -R "$R" --json state
jq -e '.state == "discarded"' "$EVIDENCE/ao2-discard.out"
```

Pass when O's repository list holds both repositories as `owner`, both read back the same role and capabilities, P
becomes a Viewer, R reads back public and then private, and O discards B's pull request.

### AO3. A stopped agent's repositories are suspended

Run: helper.

This journey uses AO1's agents, P and R, so AO1 runs first. A merges a Sheet into R, and B browses R and outlines
the Sheet. O stops A, as `Stop` under `My agents` does. B's `repo_view`, `space_browse` and `outline` of R are
refused, P's read of R answers 404, and O still views R.

```bash
$V mcp --as ao-a ao3-pr pr_create "{\"repo\":\"$R\",\"title\":\"Sales\"}"
W=$(jq -r .id "$EVIDENCE/ao3-pr.out"); N=$(jq -r .number "$EVIDENCE/ao3-pr.out")
$V mcp --as ao-a ao3-unit unit_create "{\"worktree\":\"$W\",\"space\":\"$R\",\"type\":\"sheet\",\"name\":\"Sales\"}"
U=$(jq -r .unit.unitId "$EVIDENCE/ao3-unit.out")
$V mcp --as ao-a ao3-ready pr_ready "{\"repo\":\"$R\",\"number\":\"$N\"}"
$V mcp --as ao-a ao3-merge pr_merge "{\"repo\":\"$R\",\"number\":\"$N\"}"
jq -e '.state == "merged"' "$EVIDENCE/ao3-merge.out"
$V mcp --as ao-b ao3-b-browse-before space_browse "{\"repo\":\"$S\"}"
$V mcp --as ao-b ao3-b-outline-before outline "{\"unit\":\"$U\",\"trunk\":true}"
jq -e '.unitId == "'"$U"'"' "$EVIDENCE/ao3-b-outline-before.out"
curl --fail-with-body -sS -b "$OC" -o /dev/null -X POST "$ORIGIN/api/agents/$(jq -r .agent.id "$EVIDENCE/principal-ao-a.json")/stop"
$V mcp --as ao-b ao3-b-view repo_view "{\"repo\":\"$S\"}"
test $? -eq 1
$V mcp --as ao-b ao3-b-browse space_browse "{\"repo\":\"$S\"}"
test $? -eq 1
jq -s -e 'map(.code) == ["NOT_FOUND", "NOT_FOUND"]' "$EVIDENCE/ao3-b-view.out" "$EVIDENCE/ao3-b-browse.out"
$V mcp --as ao-b ao3-b-outline outline "{\"unit\":\"$U\",\"trunk\":true}"
test $? -eq 1
jq -e '.message == "Cannot read this unit."' "$EVIDENCE/ao3-b-outline.out"
curl -sS -b "$PH/cookies" -o /dev/null -w '%{http_code}\n' "$ORIGIN/api/spaces/$S" > "$EVIDENCE/ao3-p-view.status"
grep -qx 404 "$EVIDENCE/ao3-p-view.status"
$V cli ao3-o-view repo view "$S" --json fullName,accessRole
jq -e '.fullName == "'"$R"'" and .accessRole == "owner"' "$EVIDENCE/ao3-o-view.out"
```

Pass when B browses R and outlines the Sheet before the stop; after it, B's `repo_view` and `space_browse` exit 1 with
`NOT_FOUND`, its `outline` exits 1 with `Cannot read this unit.`, P's read answers 404, and O still views R as its
owner.

## Gotchas

- The MCP-mode gotchas in [MCP gateway](mcp.md#gotchas) apply.
- `Stop` cannot be undone, so AO3 runs last.
- `label_write` and `pr_discard` are in the `admin` toolset, so an agent calls them with `--toolsets core,admin`.
- The claims and the stop go through the HTTP API with a person's cookie. [Agent handoff and claim](agent-handoff.md)
  drives the claim page and `My agents` in the browser.
- An unclaimed agent expires after 30 days without use, which a run cannot reach, so no journey shows that an expired
  agent's repositories are suspended.
