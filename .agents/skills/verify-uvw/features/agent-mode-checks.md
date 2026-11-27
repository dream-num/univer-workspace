# Agent Mode: declared checks and the landing guard

A repository declares checks in `.agents/checks.md` on its Trunk. Agents report each one on a ready pull request
with `pr_check`. Only the results of someone who may merge it count, and a change to its content or to Trunk makes
them out of date. A repository that requires checks lets an agent that does not own it merge only once every declared
check passed, and refuses that agent's direct writes to Trunk. People are not gated.

## Sub-features

- MP15 declares two checks in `.agents/checks.md`, has a claimed Viewer agent report them with `pr_check`, shows them
  in the browser, marks them out of date after a Trunk edit, and counts the results of a claimed Editor agent.
- MP17 turns on `Require checks before an agent merges` in a repository's settings. A claimed guest agent's
  `pr_merge` and `uvw pr merge` are refused with `CHECKS_REQUIRED` naming the declared checks, its pull request page
  says why, its Browser opens a Trunk Sheet `Read only`, and its Blob replacement, Trash and rename of
  `.agents/checks.md` are refused with `AGENT_NOT_ALLOWED`. It merges once both checks pass, but not a pull request
  that changes `.agents/checks.md`, which the run user merges. The run user merges with no results, and in `review`
  the agent merges without them.
- MP18 has a claimed agent declare two checks in its own repository and turn on `landing` `checks` on the default
  connection, with no `toolsets`. Its Editor agent's merge is refused with `CHECKS_REQUIRED` until both checks pass,
  and its `space_node` and `blob_upload` on that Trunk are refused with `AGENT_NOT_ALLOWED`.

## How to get to it (user POV)

An MCP client connected to `$MCP_URL` calls `pr_check`, `pr_view` and `pr_merge`, and a person reads the checks
in the `Checks` section of the pull request page. A person turns on `Require checks before an agent merges` in the
repository's settings. MP17 also calls `whoami`, `space_node`, `fork_create` and `fork_view` as an agent, and drives
`uvw repo edit --landing` as a person and `uvw auth guest`, `uvw claim`, `uvw pr merge` and `uvw blob replace` as that
agent. MP18 calls `space_node`, `file_upload_create`, `blob_upload`, `repo_edit` and `repo_member_write` as an agent
on the default connection.

## Driving it with agent-browser and uvw

Mode: mcp.

Start every shell with `eval "$($V env)"`. Each `$V mcp`
call checks its usage event and credential leakage, and exit 5 fails the journey.
[MCP mode](../references/mcp-mode.md) lists the helper commands and their exit codes.

```bash
O=verify-$VERIFY_UVW_RUN
```

### MP15. Check results on a pull request

The run user O holds a Team Space R and declares two checks in `.agents/checks.md` on its Trunk. A claimed agent A, a
Viewer, proposes a change and reports both checks with `pr_check`. A person E sees them in the browser, marked as not
counting. O then changes the Sheet on Trunk, and the page marks A's results out of date. A claimed agent B, an Editor
who may merge, reports both again, and its results count, also after B merges.

```bash
$V cli mpc-repo repo create checks-demo --name "Checks demo" --json id,fullName
T=$(jq -r .id "$EVIDENCE/mpc-repo.out"); R="$O/checks-demo"
$V cli mpc-folder space node create "$R" --name .agents --json
printf '# Checks\n\n## totals-match\nB3 equals SUM(B2:B2).\n\n## header-unchanged\nRow 1 reads Region, Total.\n' > "$EVIDENCE/mpc-checks.md"
$V cli mpc-checks blob upload --file "$EVIDENCE/mpc-checks.md" --space "$T" --parent "$(jq -r .node.nodeId "$EVIDENCE/mpc-folder.out")" --name checks.md --json
$V cli mpc-h-pr pr create -R "$R" -t "Sales" --json
$V cli mpc-h-unit unit create --worktree "$(jq -r .id "$EVIDENCE/mpc-h-pr.out")" --space "$R" --type sheet --name Sales --json
U=$(jq -r .unit.unitId "$EVIDENCE/mpc-h-unit.out"); RES=$(jq -r .unit.resourceId "$EVIDENCE/mpc-h-unit.out")
$V cli mpc-h-exec execute --worktree "$(jq -r .id "$EVIDENCE/mpc-h-pr.out")" --unit "$U" --json -e 'univerAPI.getActiveWorkbook().getActiveSheet().getRange("A1:B3").setValues([["Region","Total"],["North",40],["Sum",null]]); univerAPI.getActiveWorkbook().getActiveSheet().getRange("B3").setFormula("=SUM(B2:B2)");'
$V cli mpc-h-ready pr ready "$(jq -r .number "$EVIDENCE/mpc-h-pr.out")" -R "$R" --json state
$V cli mpc-h-merge pr merge "$(jq -r .number "$EVIDENCE/mpc-h-pr.out")" -R "$R" --json state
$V principal checker-a mpc-a
$V principal checker-b mpc-b
$V mcp --as checker-a mpc-claim-a claim '{}'
$V mcp --as checker-b mpc-claim-b claim '{}'
```

Open each `claimUrl` in the run browser, signed in as O, and click `Claim agent`. Replace the codes as
[MH1](agent-handoff.md#mh1-unclaimed-agent) says. Register a
person E with `POST $ORIGIN/api/auth/password/register` and keep the password outside `$EVIDENCE`. Then:

```bash
A=$(jq -r .agent.username "$EVIDENCE/principal-checker-a.json"); B=$(jq -r .agent.username "$EVIDENCE/principal-checker-b.json")
$V person mpc-member-a repo member add "$A" --role viewer -R "$R" --json
$V person mpc-member-b repo member add "$B" --role editor -R "$R" --json
$V person mpc-member-e repo member add <E> --role viewer -R "$R" --json
$V mcp --as checker-a mpc-a-pr pr_create "{\"repo\":\"$R\",\"title\":\"Raise North\"}"
W=$(jq -r .id "$EVIDENCE/mpc-a-pr.out"); N=$(jq -r .number "$EVIDENCE/mpc-a-pr.out")
$V mcp --as checker-a mpc-a-add unit_add "{\"worktree\":\"$W\",\"resource\":\"$RES\"}"
$V mcp --as checker-a mpc-a-exec execute "$(jq -nc --arg w "$W" --arg u "$U" '{worktree:$w,unit:$u,code:"univerAPI.getActiveWorkbook().getActiveSheet().getRange(\"B2\").setValue(50);"}')"
$V mcp --as checker-a mpc-a-draft pr_check "{\"repo\":\"$R\",\"number\":\"$N\",\"name\":\"totals-match\",\"state\":\"passed\"}"
test $? -eq 1
jq -e '.code == "CONFLICT"' "$EVIDENCE/mpc-a-draft.out"
$V mcp --as checker-a mpc-a-ready pr_ready "{\"repo\":\"$R\",\"number\":\"$N\"}"
for name in totals-match header-unchanged; do
  $V mcp --as checker-a "mpc-a-$name" pr_check "{\"repo\":\"$R\",\"number\":\"$N\",\"name\":\"$name\",\"state\":\"passed\",\"summary\":\"Read on the draft.\"}"
done
$V mcp --as checker-a mpc-a-view pr_view "{\"repo\":\"$R\",\"number\":\"$N\"}"
jq -e '[.checks[] | {name, declared, state, counts: [.results[].counts]}] == [{name:"totals-match",declared:true,state:"missing",counts:[false]},{name:"header-unchanged",declared:true,state:"missing",counts:[false]}] and .checks[0].results[0].current' "$EVIDENCE/mpc-a-view.out"
$V cli mpc-cli-view pr view "$N" -R "$R" --json checks
jq -e '.checks == {passed: 0, failed: 0, missing: 2, atMerge: null}' "$EVIDENCE/mpc-cli-view.out"
```

In a second browser session (`AGENT_BROWSER_SESSION=verify-uvw-$VERIFY_UVW_RUN-e`) signed in as E, open
`$ORIGIN/spaces/$T/pulls/$N`, scroll the `Checks` section into view, and screenshot `mp15-checks-viewer.png`. It lists
`totals-match` and `header-unchanged`, each `Missing`, with A's name, `Passed`, `Does not count` and the summary.

O changes the Sheet on Trunk through another pull request, then E reloads:

```bash
$V cli mpc-h2-pr pr create -R "$R" -t "Header" --json
$V cli mpc-h2-add unit add --worktree "$(jq -r .id "$EVIDENCE/mpc-h2-pr.out")" --resource "$RES" --json
$V cli mpc-h2-exec execute --worktree "$(jq -r .id "$EVIDENCE/mpc-h2-pr.out")" --unit "$U" --json -e 'univerAPI.getActiveWorkbook().getActiveSheet().getRange("C1").setValue("Note");'
$V cli mpc-h2-ready pr ready "$(jq -r .number "$EVIDENCE/mpc-h2-pr.out")" -R "$R" --json state
$V cli mpc-h2-merge pr merge "$(jq -r .number "$EVIDENCE/mpc-h2-pr.out")" -R "$R" --json state
$V mcp --as checker-a mpc-a-stale pr_view "{\"repo\":\"$R\",\"number\":\"$N\"}"
jq -e '[.checks[].results[] | .current] == [false, false]' "$EVIDENCE/mpc-a-stale.out"
```

E's reloaded page shows both results struck through and `Out of date`: screenshot `mp15-checks-out-of-date.png`.
Then B, who may merge, verifies and reports:

```bash
for name in totals-match header-unchanged; do
  $V mcp --as checker-b "mpc-b-$name" pr_check "{\"repo\":\"$R\",\"number\":\"$N\",\"name\":\"$name\",\"state\":\"passed\",\"summary\":\"Read on trunk.\"}"
done
$V mcp --as checker-b mpc-b-view pr_view "{\"repo\":\"$R\",\"number\":\"$N\"}"
jq -e '[.checks[] | .state] == ["passed", "passed"] and ([.checks[].results[] | select(.counts) | .reporter.username] | unique) == ["'"$B"'"]' "$EVIDENCE/mpc-b-view.out"
$V mcp --as checker-b mpc-b-merge pr_merge "{\"repo\":\"$R\",\"number\":\"$N\"}"
$V mcp --as checker-b mpc-b-merged pr_view "{\"repo\":\"$R\",\"number\":\"$N\"}"
jq -e '.state == "merged" and ([.checks[] | .state] == ["passed", "passed"])' "$EVIDENCE/mpc-b-merged.out"
$V mcp --as checker-b mpc-b-after-merge pr_check "{\"repo\":\"$R\",\"number\":\"$N\",\"name\":\"totals-match\",\"state\":\"failed\"}"
test $? -eq 1
jq -e '.code == "CONFLICT"' "$EVIDENCE/mpc-b-after-merge.out"
```

E's reloaded page shows them under `Checks at merge`: both checks `Passed`, B's results without a label and A's still
`Out of date`. Screenshot `mp15-checks-counted.png`.

Pass when the draft report exits 1 with `CONFLICT`, A's results are current but do not count and the CLI summary reads
2 missing, the first screenshot shows them, the Trunk merge leaves A's results `current: false` and the second
screenshot marks them out of date, B's results count and both checks read `passed`, they still do after B merges, and a
report on the merged pull request exits 1 with `CONFLICT`.

### MP17. A repository that requires checks

The run user O holds a Team Space R, declares two checks in `.agents/checks.md` and turns on
`Require checks before an agent merges` in its settings. A claimed guest agent G, an Editor there, opens a pull
request. Its `pr_merge` and `uvw pr merge` are refused with `CHECKS_REQUIRED` and the names of both checks, its pull
request page says why it has no merge button, its Browser opens the Trunk Sheet `Read only`, and its direct changes
to `.agents/checks.md` on Trunk are refused with `AGENT_NOT_ALLOWED`. G reports both checks and merges. A pull request
of G's that changes `.agents/checks.md` is refused naming `.agents/` with both checks passed, and O merges it. O, a
person, merges another pull request with no results.
Back in `review`, G merges without results.

```bash
RUN=${VERIFY_UVW_ROOT:-/tmp/verify-uvw}/$VERIFY_UVW_RUN
$V cli mpl-repo repo create landing-demo --name "Landing demo" --json id,fullName
T=$(jq -r .id "$EVIDENCE/mpl-repo.out"); R="$O/landing-demo"
$V cli mpl-folder space node create "$R" --name .agents --json
printf '# Checks\n\n## totals-match\nB2 reads a number.\n\n## header-unchanged\nRow 1 reads Region, Total.\n' > "$EVIDENCE/mpl-checks.md"
$V cli mpl-checks blob upload --file "$EVIDENCE/mpl-checks.md" --space "$T" --parent "$(jq -r .node.nodeId "$EVIDENCE/mpl-folder.out")" --name checks.md --json
CR=$(jq -r .upload.resourceId "$EVIDENCE/mpl-checks.out"); CN=$(jq -r .upload.nodeId "$EVIDENCE/mpl-checks.out")
$V cli mpl-h-pr pr create -R "$R" -t "Sales" --json
$V cli mpl-h-unit unit create --worktree "$(jq -r .id "$EVIDENCE/mpl-h-pr.out")" --space "$R" --type sheet --name Sales --json
U=$(jq -r .unit.unitId "$EVIDENCE/mpl-h-unit.out"); RES=$(jq -r .unit.resourceId "$EVIDENCE/mpl-h-unit.out")
$V cli mpl-h-exec execute --worktree "$(jq -r .id "$EVIDENCE/mpl-h-pr.out")" --unit "$U" --json -e 'univerAPI.getActiveWorkbook().getActiveSheet().getRange("A1:B2").setValues([["Region","Total"],["North",40]]);'
$V cli mpl-h-ready pr ready "$(jq -r .number "$EVIDENCE/mpl-h-pr.out")" -R "$R" --json state
$V cli mpl-h-merge pr merge "$(jq -r .number "$EVIDENCE/mpl-h-pr.out")" -R "$R" --json state
```

In the run browser, signed in as O, open `$ORIGIN/spaces/$T/settings`, check `Require checks before an agent merges`
below the proposals setting, reload, scroll it into view and screenshot `mp17-landing-setting.png`. It stays checked.
Then:

```bash
$V cli mpl-repo-view repo view "$R" --json landing
jq -e '.landing == "checks"' "$EVIDENCE/mpl-repo-view.out"
GH=$RUN/home/g-cli; mkdir -m 700 -p "$GH"
gu() { UNIVER_HOME=$GH node apps/cli/dist/main.js "$@"; }
gu config set workspace.origin "$ORIGIN"
gu auth guest --json > "$EVIDENCE/mpl-g-guest.out"
G=$(jq -r .agent.username "$EVIDENCE/mpl-g-guest.out"); G_ID=$(jq -r .agent.id "$EVIDENCE/mpl-g-guest.out")
(umask 077 && gu claim --json > "$RUN/home/g-claim.private")
```

The claim link stays in `$RUN/home`, out of the evidence and the run log. In the run browser, still signed in as O,
O claims G:

```bash
agent-browser open "$(jq -r .claimUrl "$RUN/home/g-claim.private")" > /dev/null
agent-browser find role button click --name 'Claim agent'
agent-browser wait --url '**/spaces/*'
```

O connects an MCP client as G, its own agent, so every `$V mcp --auth oauth` call below acts as G:

```bash
$V mcp-oauth login mpl-g --connect-as "$G_ID"
$V mcp --auth oauth mpl-g-whoami whoami '{}'
jq -e --arg id "$G_ID" --arg o "$O" '.subject.id == $id and .owner.username == $o' "$EVIDENCE/mpl-g-whoami.out"
$V person mpl-member-g repo member add "$G" --role editor -R "$R" --json
```

No sign-in gives an agent a browser session, so the run browser borrows G's uvw session cookie to show G's view.
The cookie goes from the session file straight into the browser and is never printed:

```bash
agent-browser cookies clear
agent-browser cookies set workspace_session "$(jq -r '.sessions[].cookie | sub("^workspace_session="; "")' "$GH/distributions/univer-workspace-cli/workspace-cli/session.json")" --url "$ORIGIN" --http-only > /dev/null
agent-browser open "$ORIGIN/api/session" > /dev/null
agent-browser get text body | jq -e --arg g "$G" '.user.username == $g and .user.kind == "agent"'
```

G proposes a change and tries to merge it with no results:

```bash
$V mcp --auth oauth mpl-g-pr pr_create "{\"repo\":\"$R\",\"title\":\"Raise North\"}"
W=$(jq -r .id "$EVIDENCE/mpl-g-pr.out"); N=$(jq -r .number "$EVIDENCE/mpl-g-pr.out")
$V mcp --auth oauth mpl-g-add unit_add "{\"worktree\":\"$W\",\"resource\":\"$RES\"}"
$V mcp --auth oauth mpl-g-exec execute "$(jq -nc --arg w "$W" --arg u "$U" '{worktree:$w,unit:$u,code:"univerAPI.getActiveWorkbook().getActiveSheet().getRange(\"B2\").setValue(50);"}')"
$V mcp --auth oauth mpl-g-ready pr_ready "{\"repo\":\"$R\",\"number\":\"$N\"}"
$V mcp --auth oauth mpl-g-merge-refused pr_merge "{\"repo\":\"$R\",\"number\":\"$N\"}"
test $? -eq 1
jq -e '.code == "CHECKS_REQUIRED" and .detail.status == 403 and (.message | contains("totals-match (missing), header-unchanged (missing)"))' "$EVIDENCE/mpl-g-merge-refused.out"
$V mcp --auth oauth mpl-g-view pr_view "{\"repo\":\"$R\",\"number\":\"$N\"}"
jq -e '.capabilities.merge == false and ([.checks[].state] == ["missing", "missing"])' "$EVIDENCE/mpl-g-view.out"
gu pr merge "$N" -R "$R" --json state > "$EVIDENCE/mpl-g-cli-merge.out" 2> "$EVIDENCE/mpl-g-cli-merge.err"
test $? -eq 1
grep -q '^CHECKS_REQUIRED: .*totals-match (missing), header-unchanged (missing)' "$EVIDENCE/mpl-g-cli-merge.err"
```

In the run browser, signed in as G, set the viewport to 1280 × 1300, open `$ORIGIN/spaces/$T/pulls/$N` and screenshot
`mp17-agent-refusal.png`. The `Checks` section lists both checks as `Missing`, there is no merge button, and the line
under `Continue editing` reads `This repository requires an agent to pass every check declared in .agents/checks.md.
You can merge once each one has passed.` Then open `$ORIGIN/nodes/$(jq -r .unit.nodeId "$EVIDENCE/mpl-h-unit.out")`,
wait for the grid, hover the lock icon in the header (`agent-browser hover '[aria-label="Read only"]'`) and screenshot
`mp17-agent-trunk-readonly.png`. Its tooltip reads `Read only`, where an editor sees a pencil and `Editable`, and a
value typed into an empty cell does not appear. G then tries to change the declaration on Trunk:

```bash
gu blob download "$RUN/home/g-checks.md" --resource "$CR" --json > "$EVIDENCE/mpl-g-download.out"
printf '# Checks\n\n## totals-match\nB2 reads a number.\n' > "$RUN/home/g-weaker.md"
gu blob replace --resource "$CR" --file "$RUN/home/g-weaker.md" --etag "$(jq -r .download.etag "$EVIDENCE/mpl-g-download.out")" \
  --idempotency-key mp17-g-replace-checks --json 2> "$EVIDENCE/mpl-g-replace-checks.err"
test $? -eq 1
grep -q '^AGENT_NOT_ALLOWED: This repository requires checks' "$EVIDENCE/mpl-g-replace-checks.err"
$V mcp --auth oauth mpl-g-trash-checks space_node "{\"action\":\"trash\",\"node\":\"$CN\"}"
test $? -eq 1
$V mcp --auth oauth mpl-g-rename-checks space_node "{\"action\":\"rename\",\"node\":\"$CN\",\"name\":\"checks-old.md\"}"
test $? -eq 1
jq -s -e 'map(.code) == ["AGENT_NOT_ALLOWED", "AGENT_NOT_ALLOWED"]' "$EVIDENCE/mpl-g-trash-checks.out" "$EVIDENCE/mpl-g-rename-checks.out"
$V cli mpl-checks-after blob download "$EVIDENCE/mpl-checks-after.md" --resource "$CR" --force --json
cmp "$EVIDENCE/mpl-checks.md" "$EVIDENCE/mpl-checks-after.md"
```

G reports the checks. One is not enough:

```bash
$V mcp --auth oauth mpl-g-check-totals pr_check "{\"repo\":\"$R\",\"number\":\"$N\",\"name\":\"totals-match\",\"state\":\"passed\",\"summary\":\"B2 reads 50.\"}"
$V mcp --auth oauth mpl-g-merge-one pr_merge "{\"repo\":\"$R\",\"number\":\"$N\"}"
test $? -eq 1
jq -e '.code == "CHECKS_REQUIRED" and (.message | contains("header-unchanged (missing)")) and (.message | contains("totals-match") | not)' "$EVIDENCE/mpl-g-merge-one.out"
$V mcp --auth oauth mpl-g-check-header pr_check "{\"repo\":\"$R\",\"number\":\"$N\",\"name\":\"header-unchanged\",\"state\":\"passed\",\"summary\":\"Row 1 reads Region, Total.\"}"
$V mcp --auth oauth mpl-g-merge pr_merge "{\"repo\":\"$R\",\"number\":\"$N\"}"
jq -e '.state == "merged"' "$EVIDENCE/mpl-g-merge.out"
```

G proposes a note in `.agents/checks.md` through a fork, passes both checks, and still cannot merge it. O can:

```bash
$V mcp --auth oauth mpl-g-fork fork_create "{\"repo\":\"$R\",\"name\":\"notes\"}"
printf '# Checks\n\n## totals-match\nB2 reads a number.\n\n## header-unchanged\nRow 1 reads Region, Total.\n\n### Notes\nRead B2 on Trunk.\n' > "$RUN/home/g-notes.md"
gu blob replace --resource "$CR" --file "$RUN/home/g-notes.md" --etag "$(jq -r .download.etag "$EVIDENCE/mpl-g-download.out")" \
  --worktree "$G/notes" --idempotency-key mp17-g-propose-checks --json > "$EVIDENCE/mpl-g-propose-checks.out"
$V mcp --auth oauth mpl-g-fork-view fork_view "{\"fork\":\"$G/notes\"}"
N4=$(jq -r .worktree.number "$EVIDENCE/mpl-g-fork-view.out")
$V mcp --auth oauth mpl-g4-ready pr_ready "{\"repo\":\"$R\",\"number\":\"$N4\"}"
for name in totals-match header-unchanged; do
  $V mcp --auth oauth "mpl-g4-check-$name" pr_check "{\"repo\":\"$R\",\"number\":\"$N4\",\"name\":\"$name\",\"state\":\"passed\",\"summary\":\"Still declared.\"}"
done
$V mcp --auth oauth mpl-g4-view pr_view "{\"repo\":\"$R\",\"number\":\"$N4\"}"
jq -e '.capabilities.merge == false and ([.checks[].state] == ["passed", "passed"])' "$EVIDENCE/mpl-g4-view.out"
$V mcp --auth oauth mpl-g4-refused pr_merge "{\"repo\":\"$R\",\"number\":\"$N4\"}"
test $? -eq 1
jq -e '.code == "CHECKS_REQUIRED" and (.message | contains("This pull request changes .agents/."))' "$EVIDENCE/mpl-g4-refused.out"
$V cli mpl-o4-merge pr merge "$N4" -R "$R" --json state
jq -e '.state == "merged"' "$EVIDENCE/mpl-o4-merge.out"
$V cli mpl-checks-notes blob download "$EVIDENCE/mpl-checks-notes.md" --resource "$CR" --force --json
cmp "$RUN/home/g-notes.md" "$EVIDENCE/mpl-checks-notes.md"
```

O merges another pull request with no results, then sets the repository back to `review`, where G merges without
results:

```bash
$V cli mpl-h2-pr pr create -R "$R" -t "South" --json
W2=$(jq -r .id "$EVIDENCE/mpl-h2-pr.out"); N2=$(jq -r .number "$EVIDENCE/mpl-h2-pr.out")
$V cli mpl-h2-add unit add --worktree "$W2" --resource "$RES" --json
$V cli mpl-h2-exec execute --worktree "$W2" --unit "$U" --json -e 'univerAPI.getActiveWorkbook().getActiveSheet().getRange("A3:B3").setValues([["South",30]]);'
$V cli mpl-h2-ready pr ready "$N2" -R "$R" --json state
$V cli mpl-h2-view pr view "$N2" -R "$R" --json checks,capabilities
jq -e '.checks.missing == 2 and .capabilities.merge' "$EVIDENCE/mpl-h2-view.out"
$V cli mpl-h2-merge pr merge "$N2" -R "$R" --json state
$V mcp --auth oauth mpl-g3-pr pr_create "{\"repo\":\"$R\",\"title\":\"East\"}"
W3=$(jq -r .id "$EVIDENCE/mpl-g3-pr.out"); N3=$(jq -r .number "$EVIDENCE/mpl-g3-pr.out")
$V mcp --auth oauth mpl-g3-add unit_add "{\"worktree\":\"$W3\",\"resource\":\"$RES\"}"
$V mcp --auth oauth mpl-g3-exec execute "$(jq -nc --arg w "$W3" --arg u "$U" '{worktree:$w,unit:$u,code:"univerAPI.getActiveWorkbook().getActiveSheet().getRange(\"A4:B4\").setValues([[\"East\",20]]);"}')"
$V mcp --auth oauth mpl-g3-ready pr_ready "{\"repo\":\"$R\",\"number\":\"$N3\"}"
$V mcp --auth oauth mpl-g3-refused pr_merge "{\"repo\":\"$R\",\"number\":\"$N3\"}"
test $? -eq 1
$V cli mpl-review repo edit "$R" --landing review --json landing
$V mcp --auth oauth mpl-g3-merge pr_merge "{\"repo\":\"$R\",\"number\":\"$N3\"}"
$V cli mpl-trunk-3 inspect range A1:B4 --trunk --unit "$U" --worksheet index:1 --json
jq -e '[.. | objects | select(has("v")) | .v] == ["Region","Total","North",50,"South",30,"East",20]' "$EVIDENCE/mpl-trunk-3.out"
```

Pass when the setting reads back as `checks` and the first screenshot shows it checked; G's first `pr_merge` and
`uvw pr merge` exit 1 with `CHECKS_REQUIRED` naming both checks, and `capabilities.merge` is false; the second
screenshot shows the reason and no merge button; the third shows the Trunk Sheet `Read only`; the Blob replacement,
Trash and rename of `.agents/checks.md` all answer `AGENT_NOT_ALLOWED` and the file is unchanged; a merge after one
result names only the other check; G's merge after both succeeds; G's pull request that changes `.agents/checks.md`
has both checks passed, `capabilities.merge` false and a `pr_merge` refused naming `.agents/`, and O's merge of it
leaves Trunk's file with G's note; O's merge with no results succeeds; and after `--landing review` G merges without
results, leaving Trunk with every row.

### MP18. An agent declares checks in its own repository on the default connection

A claimed agent A creates a repository R, declares two checks in `.agents/checks.md` and turns on `landing` `checks`,
all on the default connection. A asks to add a claimed agent B as an Editor, which returns a confirm link, and O, who
claimed A, adds B in the browser session. B's merge without results is refused with
`CHECKS_REQUIRED` naming both checks, and succeeds once B reports both. B's `space_node` and `blob_upload` on R's
Trunk are refused with `AGENT_NOT_ALLOWED`. No call below passes `--toolsets`.

```bash
$V principal decl-a mpd-a
$V principal decl-b mpd-b
$V mcp --as decl-a mpd-claim-a claim '{}'
$V mcp --as decl-b mpd-claim-b claim '{}'
```

Open each `claimUrl` in the run browser, signed in as O, and click `Claim agent`. After MP17 the run browser holds
G's session: run `agent-browser close` first, then sign it in as O with the block under **Browser** in
[the skill](../SKILL.md#drive). Replace the codes as [MH1](agent-handoff.md#mh1-unclaimed-agent) says. Then A sets up R:

```bash
A=$(jq -r .agent.username "$EVIDENCE/principal-decl-a.json"); B=$(jq -r .agent.username "$EVIDENCE/principal-decl-b.json")
R="$A/declared-checks"; KEY=$(uuidgen | tr -d -)
$V mcp-tools --as decl-a mpd-a-tools
jq -e 'map(.name) | (index("space_node") != null) and (index("blob_upload") != null) and (index("file_upload_create") != null)' "$EVIDENCE/mpd-a-tools.out"
$V mcp-instructions --as decl-a mpd-a-instructions
jq -e '.instructions | contains("To make a repository you own require checks, declare them on its trunk")' "$EVIDENCE/mpd-a-instructions.out"
$V mcp --as decl-a mpd-repo repo_create '{"slug":"declared-checks","name":"Declared checks"}'
$V mcp --as decl-a mpd-folder space_node "{\"action\":\"create\",\"repo\":\"$R\",\"name\":\".agents\"}"
printf '# Checks\n\n## totals-match\nB2 reads a number.\n\n## header-unchanged\nRow 1 reads Region, Total.\n' > "$EVIDENCE/mpd-checks.md"
$V mcp --as decl-a mpd-reserve file_upload_create "$(jq -nc --argjson size "$(wc -c < "$EVIDENCE/mpd-checks.md" | tr -d ' ')" '{purpose:"blob",file_name:"checks.md",size:$size,media_type:"text/markdown"}')"
node .agents/skills/verify-uvw/bin/mcp-file.mjs put "$EVIDENCE/mpd-reserve.out" "$EVIDENCE/mpd-checks.md"
$V mcp --as decl-a mpd-checks blob_upload "$(jq -nc --arg u "$(jq -r .upload.upload_id "$EVIDENCE/mpd-reserve.out")" --arg r "$R" --arg p "$(jq -r .node.nodeId "$EVIDENCE/mpd-folder.out")" --arg k "mp18-checks-$KEY" '{upload_id:$u,space:$r,parent:$p,name:"checks.md",idempotency_key:$k}')"
jq -e '.upload.name == "checks.md" and .upload.availability == "ready"' "$EVIDENCE/mpd-checks.out"
$V mcp --as decl-a mpd-landing repo_edit "{\"repo\":\"$R\",\"landing\":\"checks\"}"
jq -e '.landing == "checks"' "$EVIDENCE/mpd-landing.out"
$V mcp --as decl-a mpd-member repo_member_write "{\"repo\":\"$R\",\"action\":\"add\",\"user\":\"$B\",\"role\":\"editor\"}"
test $? -eq 1
jq -e '.code == "INTERACTIVE_SESSION_REQUIRED" and (.detail.url | endswith("&role=editor"))' "$EVIDENCE/mpd-member.out"
$V person mpd-member-confirmed repo member add "$B" --role editor -R "$R" --json role
```

B proposes a Sheet and tries to merge it with no results, then reports both checks and merges:

```bash
$V mcp --as decl-b mpd-b-pr pr_create "{\"repo\":\"$R\",\"title\":\"Sales\"}"
W=$(jq -r .id "$EVIDENCE/mpd-b-pr.out"); N=$(jq -r .number "$EVIDENCE/mpd-b-pr.out")
$V mcp --as decl-b mpd-b-unit unit_create "{\"worktree\":\"$W\",\"space\":\"$R\",\"type\":\"sheet\",\"name\":\"Sales\"}"
U=$(jq -r .unit.unitId "$EVIDENCE/mpd-b-unit.out")
$V mcp --as decl-b mpd-b-exec execute "$(jq -nc --arg w "$W" --arg u "$U" '{worktree:$w,unit:$u,code:"univerAPI.getActiveWorkbook().getActiveSheet().getRange(\"A1:B2\").setValues([[\"Region\",\"Total\"],[\"North\",40]]);"}')"
$V mcp --as decl-b mpd-b-ready pr_ready "{\"repo\":\"$R\",\"number\":\"$N\"}"
$V mcp --as decl-b mpd-b-refused pr_merge "{\"repo\":\"$R\",\"number\":\"$N\"}"
test $? -eq 1
jq -e '.code == "CHECKS_REQUIRED" and .detail.status == 403 and (.message | contains("totals-match (missing), header-unchanged (missing)"))' "$EVIDENCE/mpd-b-refused.out"
for name in totals-match header-unchanged; do
  $V mcp --as decl-b "mpd-b-$name" pr_check "{\"repo\":\"$R\",\"number\":\"$N\",\"name\":\"$name\",\"state\":\"passed\",\"summary\":\"Read on the draft.\"}"
done
$V mcp --as decl-b mpd-b-view pr_view "{\"repo\":\"$R\",\"number\":\"$N\"}"
jq -e '[.checks[] | {name, declared, state}] == [{name:"totals-match",declared:true,state:"passed"},{name:"header-unchanged",declared:true,state:"passed"}]' "$EVIDENCE/mpd-b-view.out"
$V mcp --as decl-b mpd-b-merge pr_merge "{\"repo\":\"$R\",\"number\":\"$N\"}"
jq -e '.state == "merged"' "$EVIDENCE/mpd-b-merge.out"
$V cli mpd-trunk inspect range A1:B2 --trunk --unit "$U" --worksheet index:1 --json
jq -e '[.. | objects | select(has("v")) | .v] == ["Region","Total","North",40]' "$EVIDENCE/mpd-trunk.out"
```

B tries to write R's Trunk outside a merge:

```bash
$V mcp --as decl-b mpd-b-node space_node "{\"action\":\"create\",\"repo\":\"$R\",\"name\":\"Drafts\"}"
test $? -eq 1
printf 'notes\n' > "$EVIDENCE/mpd-b-notes.md"
$V mcp --as decl-b mpd-b-reserve file_upload_create '{"purpose":"blob","file_name":"notes.md","size":6,"media_type":"text/markdown"}'
node .agents/skills/verify-uvw/bin/mcp-file.mjs put "$EVIDENCE/mpd-b-reserve.out" "$EVIDENCE/mpd-b-notes.md"
$V mcp --as decl-b mpd-b-upload blob_upload "$(jq -nc --arg u "$(jq -r .upload.upload_id "$EVIDENCE/mpd-b-reserve.out")" --arg r "$R" --arg k "mp18-notes-$KEY" '{upload_id:$u,space:$r,name:"notes.md",idempotency_key:$k}')"
test $? -eq 1
jq -s -e 'map(.code) == ["AGENT_NOT_ALLOWED", "AGENT_NOT_ALLOWED"]' "$EVIDENCE/mpd-b-node.out" "$EVIDENCE/mpd-b-upload.out"
```

Pass when A's default tool list has `space_node`, `blob_upload` and `file_upload_create` and its instructions say how to
declare checks; A creates `.agents` and a ready `checks.md` and sets `landing` to `checks` with no `toolsets`; A's
`repo_member_write` exits 1 with a confirm link and O's browser session adds B; B's first
`pr_merge` exits 1 with `CHECKS_REQUIRED` naming both checks as missing; after B reports both, `pr_view` lists them
declared and `passed`, the merge succeeds and Trunk reads Region, Total, North, 40; and B's `space_node` and
`blob_upload` on R exit 1 with `AGENT_NOT_ALLOWED`.

## Gotchas

- The MCP-mode gotchas in [MCP gateway](mcp.md#gotchas) apply.
