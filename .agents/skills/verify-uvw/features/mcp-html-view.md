# HTML View drafts over MCP

An agent validates an HTML View against a populated Sheet, saves it as a pending draft, retries and revises the
draft, and the owner previews and publishes it. Validation and missing-source errors match
`uvw html-view validate`. A reviewer of the draft's pull request lists and previews its pages without
publishing them, and the preview loads only the Sheets a page declares. A pull request's merge publishes its
pages as the merger. A page its author could not publish alone goes live only when a person merges in the
browser, and that person merges only the pages they reviewed. A page changed since its draft stays as it was
while the Sheets merge. An agent that works through a fork reads, checks and saves a page with the fork's
address, and its pull request carries the page.

## Sub-features

- MHV1 through MHV4 compare HTML View dry runs with the CLI, preserve missing-source errors, save and retry drafts, revise pending drafts, and preview, publish and read back the revised page.
- MHV5 through MHV7 list a pull request's pages for a reviewer, preview one read-only with an undeclared Sheet refused, and refuse page changes while the pull request is ready.
- MHV8 through MHV10 publish a Viewer's page when an Editor merges in the browser after refusing the Editor's CLI merge, leave a page changed since its draft `conflicted` while the Sheet merges, and let an Editor agent merge its own page over MCP.
- MHV11 through MHV15 change a page through a fork: a Viewer agent's Sheet and page, the conflicted variant, a non-member agent's page alone and then with its Sheet, uvw validation through a fork and its refusal to create a page there, and a real model's story.
- MHV16 refuses an Editor's browser merge from a tab opened before the author revised the page, changes nothing, and merges the revised page after the Editor reviews it again.

## How to get to it (user POV)

An MCP client connected to `$MCP_URL` calls `html_view_save`, `html_view_draft_get` and `html_view_read`. The
owner reviews the draft at `/drafts/<id>` in the browser. A reviewer opens the pull request at
`/spaces/<space>/pulls/<n>` and follows `Preview` from its `Pages` section. [HTML View](html-view.md) covers the published page.

## Driving it with agent-browser and uvw

Mode: mcp.

Start every shell with `eval "$($V env)"`. Each `$V mcp`
call checks its usage event and credential leakage, and exit 5 fails the journey.
[MCP mode](../references/mcp-mode.md) lists the helper commands and their exit codes.

```bash
O=verify-$VERIFY_UVW_RUN
```

### MHV1. HTML View validation parity over a populated trunk Sheet

Run: helper.

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
$V mcp --expect-event '.unit_type == "sheet" and .cost.committed_revisions == 0 and .cost.worker_cpu_ms > 0' mh-validate html_view_save "$(jq -nc --rawfile html "$EVIDENCE/mh-view.univer.html" '{html:$html,dryRun:true}')"
$V cli mh-validate-cli html-view validate --file "$EVIDENCE/mh-view.univer.html" --json
diff <(jq -S 'del(.dryRun)' "$EVIDENCE/mh-validate.out") <(jq -S 'del(.unitIds)' "$EVIDENCE/mh-validate-cli.out")
jq -e '.dryRun == true and .valid == true and (has("draft") | not) and .bindingCount == 1' "$EVIDENCE/mh-validate.out"
```

Pass when the Sheet is merged with data and MCP and CLI validation results match.

### MHV2. Missing HTML View source parity

Run: helper.

```bash
printf '<output data-univer-cell-text="missing-html-sheet:missing:A1"></output>\n' > "$EVIDENCE/mh-missing.univer.html"
$V mcp mh-missing html_view_save "$(jq -nc --rawfile html "$EVIDENCE/mh-missing.univer.html" '{html:$html,dryRun:true}')"
test $? -eq 1
$V cli mh-missing-cli html-view validate --file "$EVIDENCE/mh-missing.univer.html" --json
test $? -eq 1
MH_CODE=$(jq -r .code "$EVIDENCE/mh-missing.out")
test "$(cut -d: -f1 < "$EVIDENCE/mh-missing-cli.err" | head -n1)" = "$MH_CODE"
jq -e --arg code "$MH_CODE" '.outcome == "tool_error" and .error_code == $code' "$EVIDENCE/mh-missing.event.json"
```

Pass when both clients preserve the same missing-source code.

### MHV3. Save, retry, revise and read back the pending HTML View draft

Run: helper.

```bash
MH_ARGS=$(jq -nc --rawfile html "$EVIDENCE/mh-view.univer.html" --arg space "$MH_SPACE" --arg key "html-view-$VERIFY_UVW_RUN-$MH_U" '{html:$html,space:$space,name:"Regional totals",idempotency_key:$key}')
$V mcp --expect-event '.cost.upload_bytes > 0 and .cost.committed_revisions == 0' mh-create html_view_save "$MH_ARGS"
$V mcp mh-retry html_view_save "$MH_ARGS"
diff <(jq -S .draft "$EVIDENCE/mh-create.out") <(jq -S .draft "$EVIDENCE/mh-retry.out")
jq -e --arg origin "$ORIGIN" '.draft.state == "pending" and (.draft.previewUrl | startswith($origin + "/drafts/"))' "$EVIDENCE/mh-create.out"
MH_D=$(jq -r .draft.id "$EVIDENCE/mh-create.out")
$V mcp mh-read-draft html_view_read "{\"draft\":\"$MH_D\"}"
jq -j .html "$EVIDENCE/mh-read-draft.out" > "$EVIDENCE/mh-draft.univer.html"
cmp "$EVIDENCE/mh-view.univer.html" "$EVIDENCE/mh-draft.univer.html"
sed 's/Regional totals/Regional totals revised/g' "$EVIDENCE/mh-view.univer.html" > "$EVIDENCE/mh-revised.univer.html"
MH_REVISE_ARGS=$(jq -nc --rawfile html "$EVIDENCE/mh-revised.univer.html" --arg draft "$MH_D" --arg key "html-view-revise-$VERIFY_UVW_RUN-$MH_U" '{html:$html,draft:$draft,idempotency_key:$key}')
$V mcp --expect-event '.repo != null and .cost.upload_bytes > 0 and .cost.committed_revisions == 0' mh-revise html_view_save "$MH_REVISE_ARGS"
MH_REVISED_D=$(jq -r .draft.id "$EVIDENCE/mh-revise.out")
test "$MH_REVISED_D" != "$MH_D"
jq -e '.draft.state == "pending"' "$EVIDENCE/mh-revise.out"
$V mcp mh-old-draft html_view_draft_get "{\"draft\":\"$MH_D\"}"
jq -e --arg next "$MH_REVISED_D" '.draft.state == "superseded" and .draft.supersededBy == $next' "$EVIDENCE/mh-old-draft.out"
$V mcp mh-read-revised html_view_read "{\"draft\":\"$MH_REVISED_D\"}"
jq -e --arg draft "$MH_REVISED_D" '.draft == $draft and (has("etag") | not)' "$EVIDENCE/mh-read-revised.out"
jq -j .html "$EVIDENCE/mh-read-revised.out" > "$EVIDENCE/mh-read-revised.univer.html"
cmp "$EVIDENCE/mh-revised.univer.html" "$EVIDENCE/mh-read-revised.univer.html"
```

Pass when identical saves return the same pending draft, the draft read returns the original HTML,
and revising by draft creates a new pending draft and supersedes the old one. The revised read must
return the revised HTML byte for byte without an ETag. All calls pass the helper's usage-event checks.

### MHV4. Preview, publish and read back the revised HTML View

Run: helper.

```bash
agent-browser open "$ORIGIN/login"
agent-browser wait 1500
if agent-browser get url | grep -q '/login'; then
  agent-browser find label 'Username' fill "$O"
  agent-browser find label 'Password' fill "$(cat "$RUN/user.pw")"
  agent-browser click 'form button[type=submit]'
  agent-browser wait --url '**/home'
fi
agent-browser open "$(jq -r .draft.previewUrl "$EVIDENCE/mh-revise.out")"
agent-browser wait 3000
agent-browser screenshot "$EVIDENCE/mh-draft.png"
agent-browser find role button click --name Publish
agent-browser wait --text 'Open page'
$V mcp mh-draft-get html_view_draft_get "{\"draft\":\"$MH_REVISED_D\"}"
jq -e '.draft.state == "published" and (.draft.shareUrl | test("\\?view=immersive$"))' "$EVIDENCE/mh-draft-get.out"
$V mcp mh-read html_view_read "{\"resource\":\"$(jq -r .draft.resource "$EVIDENCE/mh-draft-get.out")\"}"
jq -j .html "$EVIDENCE/mh-read.out" > "$EVIDENCE/mh-published.univer.html"
cmp "$EVIDENCE/mh-revised.univer.html" "$EVIDENCE/mh-published.univer.html"
agent-browser open "$(jq -r .draft.shareUrl "$EVIDENCE/mh-draft-get.out")"
agent-browser wait 3000
agent-browser screenshot "$EVIDENCE/mh-published.png"
```

Pass when the preview shows North and 42 with a Publish button, publishing returns an immersive
share URL, and the published HTML matches the revised source byte for byte. Capture both the
preview and published page. Wait for the preview to load before clicking Publish.

### MHV5. A reviewer lists the pages a pull request carries

The run user O authors the page over MCP. A reviewer R holds a Team Space where O is an Editor, and has a
Personal-Space Sheet that O cannot read. Register R and sign R's uvw in from its own home, because `$V`
resets `UNIVER_HOME` to O's home. Keep R's password and cookie out of `$EVIDENCE`:

```bash
RUN=${VERIFY_UVW_ROOT:-/tmp/verify-uvw}/$VERIFY_UVW_RUN
R=$O-reviewer
RH="$UNIVER_HOME-reviewer"; mkdir -m 700 -p "$RH"
openssl rand -hex 16 > "$RH/pw"
curl --fail-with-body -sS -c "$RH/cookies" -o /dev/null -X POST "$ORIGIN/api/auth/password/register" -H 'content-type: application/json' \
  -d "{\"username\":\"$R\",\"displayName\":\"Page reviewer\",\"password\":\"$(cat "$RH/pw")\"}"
ur(){ env UNIVER_HOME="$RH" node apps/cli/dist/main.js "$@"; }
ur config set workspace.origin "$ORIGIN"
ur auth login --username "$R" --password-stdin --json < "$RH/pw" > /dev/null
ur repo create page-review --name "Page review" --json id > "$EVIDENCE/mhr-team.out"
T=$(jq -r .id "$EVIDENCE/mhr-team.out")
curl --fail-with-body -sS -b "$RH/cookies" -o /dev/null -X PUT -H 'content-type: application/json' -d '{"role":"editor"}' \
  "$ORIGIN/api/team-spaces/$T/members/$(jq -r .user.id "$RUN/logs/register.json")"
$V cli mhr-role repo view "$R/page-review" --json accessRole
```

R puts a private Sheet on R's own Trunk. O cannot read it. O opens a pull request shared with R's Team
Space and fills a new Sheet:

```bash
ur pr create -R "$R/personal" -t 'Private data' --json > "$EVIDENCE/mhr-private-pr.out"
RW=$(jq -r .id "$EVIDENCE/mhr-private-pr.out"); RN=$(jq -r .number "$EVIDENCE/mhr-private-pr.out")
ur unit create --worktree "$RW" --space "$R/personal" --type sheet --name Private --json > "$EVIDENCE/mhr-private-unit.out"
RU=$(jq -r .unit.unitId "$EVIDENCE/mhr-private-unit.out")
ur execute --worktree "$RW" --unit "$RU" --json -e 'const ws = univerAPI.getActiveWorkbook().getActiveSheet(); ws.getRange("A1").setValue("reviewer secret"); return {sheetId: ws.getSheetId()};' > "$EVIDENCE/mhr-private-data.out"
RS=$(jq -r .value.sheetId "$EVIDENCE/mhr-private-data.out")
ur pr ready "$RN" -R "$R/personal" --json state
ur pr merge "$RN" -R "$R/personal" --json state
$V cli mhr-o-private inspect range A1 --unit "$RU" --trunk --worksheet index:1
$V cli mhr-pr pr create -R "$R/page-review" -t 'Budget page' --visibility space --json
W=$(jq -r .id "$EVIDENCE/mhr-pr.out"); P=$(jq -r .number "$EVIDENCE/mhr-pr.out")
$V cli mhr-unit unit create --worktree "$W" --space "$R/page-review" --type sheet --name Budget --json
U=$(jq -r .unit.unitId "$EVIDENCE/mhr-unit.out")
$V cli mhr-data execute --worktree "$W" --unit "$U" --json -e 'const ws = univerAPI.getActiveWorkbook().getActiveSheet(); ws.getRange("A1:B2").setValues([["Region","Total"],["North",42]]); return {sheetId: ws.getSheetId()};'
S=$(jq -r .value.sheetId "$EVIDENCE/mhr-data.out")
```

The page binds the pull request's B2. Its script also asks for R's private Sheet, which the page does not
declare. O saves it as a draft of the pull request, and R lists the pull request's pages:

```bash
printf '<!DOCTYPE html><html><head><title>Budget</title></head><body style="background:#fff;color:#111;font:18px system-ui;padding:32px"><h1>Budget</h1><p>North: <output data-univer-cell-text="%s:%s:B2"></output></p><p id="other">Reading another Sheet</p><script>window.univerBinding.getCellState({unitId:"%s",sheetId:"%s",row:0,col:0}).then(function(s){document.querySelector("#other").textContent="Read: "+s.value},function(e){document.querySelector("#other").textContent="Refused: "+e.message})</script></body></html>\n' "$U" "$S" "$RU" "$RS" > "$EVIDENCE/mhr-page.univer.html"
$V mcp mhr-save html_view_save "$(jq -nc --rawfile html "$EVIDENCE/mhr-page.univer.html" --arg repo "$R/page-review" --argjson pr "$P" --arg key "mhr-create-$VERIFY_UVW_RUN-$U" '{html:$html,space:$repo,name:"Budget",repo:$repo,pr:$pr,idempotency_key:$key}')"
D=$(jq -r .draft.id "$EVIDENCE/mhr-save.out")
curl --fail-with-body -sS -b "$RH/cookies" "$ORIGIN/api/worktrees/$W/html-view-drafts" > "$EVIDENCE/mhr-list.json"
jq -e --arg d "$D" --arg o "$O" '.drafts | length == 1 and .[0].id == $d and .[0].author.username == $o and .[0].state == "pending"' "$EVIDENCE/mhr-list.json"
```

In the browser, set `univer-workspace-language` to `en-US`, `univer-workspace-layout-theme` to `repository`
and `univer-workspace-view-onboarding-complete` to `true`, then sign in as R with `$RH/pw`. Open
`$ORIGIN/spaces/$T/pulls/$P`, run `agent-browser scrollintoview 'section[aria-label="Pages"]'` and save
`mhr-page-list.png`.

Pass when `mhr-role` says `editor`, `mhr-o-private` exits `1` with `Cannot read this unit.`, the list holds
one pending draft by O, and the `Pages` section shows `Budget.univer.html`, `by Verify <run-id>`,
`Pending review` and a `Preview` link to `/drafts/<D>`.

### MHV6. The reviewer's preview is read-only and refuses an undeclared Sheet

```bash
agent-browser find role link click --name Preview
agent-browser wait --url '**/drafts/**'
agent-browser wait 8000
agent-browser screenshot "$EVIDENCE/mhr-preview.png"
agent-browser eval '[...document.querySelectorAll("button")].map(b => b.textContent.trim()).filter(Boolean).join(" | ")'
agent-browser network requests | grep -c "$RU"
```

Pass when the header says `Verify <run-id> wrote this page. The preview is read-only and loads only the Sheets it declares.`,
the page has no buttons, the alert reads `The page asked for data it does not declare. The preview refused: <RU>`,
and the page shows `North: 42` and `Refused: This preview loads only the Sheets the page declares.`
No request names `RU`, and `reviewer secret` appears nowhere.

### MHV7. A ready pull request takes no page changes until it is reopened

```bash
$V cli mhr-ready pr ready "$P" -R "$R/page-review" --json state,visibility
sed 's/<h1>Budget</<h1>Budget v2</' "$EVIDENCE/mhr-page.univer.html" > "$EVIDENCE/mhr-page-v2.univer.html"
REVISE=$(jq -nc --rawfile html "$EVIDENCE/mhr-page-v2.univer.html" --arg d "$D" --arg key "mhr-revise-$VERIFY_UVW_RUN-$U" '{html:$html,draft:$d,idempotency_key:$key}')
$V mcp mhr-frozen html_view_save "$REVISE"; test $? -eq 1
$V mcp mhr-reopen pr_ready "$(jq -nc --arg repo "$R/page-review" --argjson n "$P" '{repo:$repo,number:$n,undo:true}')"
$V mcp mhr-revise html_view_save "$REVISE"
jq -e '.draft.state == "pending"' "$EVIDENCE/mhr-revise.out"
```

Pass when `mhr-ready` prints `ready`, `mhr-frozen` has `code: "CONFLICT"` and
`Pull request #<P> is ready. Reopen it to change its pages.`, `mhr-reopen` has `state: "draft"`, and the
same revision then saves a new pending draft that supersedes `D`. Before `$V down`, run `ur daemon stop`.
After it, `rm -rf "$RH"`.

### MHV8. A reader's page publishes when an Editor merges in the browser, and not through the CLI

A holder H owns a Team Space where the run user O is a Viewer and E is an Editor. Register H and E, and sign
each one's uvw in from its own home. Keep their passwords and cookies out of `$EVIDENCE`:

```bash
RUN=${VERIFY_UVW_ROOT:-/tmp/verify-uvw}/$VERIFY_UVW_RUN
H=$O-holder; E=$O-editor; HH="$UNIVER_HOME-holder"; EH="$UNIVER_HOME-editor"
for who in holder editor; do
  d="$UNIVER_HOME-$who"; mkdir -m 700 -p "$d"; openssl rand -hex 16 > "$d/pw"
  curl --fail-with-body -sS -c "$d/cookies" -o "$d/register.json" -X POST "$ORIGIN/api/auth/password/register" -H 'content-type: application/json' \
    -d "{\"username\":\"$O-$who\",\"displayName\":\"Page $who\",\"password\":\"$(cat "$d/pw")\"}"
  env UNIVER_HOME="$d" node apps/cli/dist/main.js config set workspace.origin "$ORIGIN"
  env UNIVER_HOME="$d" node apps/cli/dist/main.js auth login --username "$O-$who" --password-stdin --json < "$d/pw" > /dev/null
done
uh(){ env UNIVER_HOME="$HH" node apps/cli/dist/main.js "$@"; }
ue(){ env UNIVER_HOME="$EH" node apps/cli/dist/main.js "$@"; }
uh repo create page-merge --name "Page merge" --json id > "$EVIDENCE/mpm-team.out"; T=$(jq -r .id "$EVIDENCE/mpm-team.out")
for pair in "$(jq -r .user.id "$RUN/logs/register.json"):viewer" "$(jq -r .user.id "$EH/register.json"):editor"; do
  curl --fail-with-body -sS -b "$HH/cookies" -o /dev/null -X PUT -H 'content-type: application/json' -d "{\"role\":\"${pair#*:}\"}" "$ORIGIN/api/team-spaces/$T/members/${pair%%:*}"
done
$V cli mpm-role repo view "$H/page-merge" --json accessRole
```

H puts a Sheet on Trunk and publishes a page bound to its B2:

```bash
uh pr create -R "$H/page-merge" -t Budget --json > "$EVIDENCE/mpm-h-pr.out"; HW=$(jq -r .id "$EVIDENCE/mpm-h-pr.out"); HN=$(jq -r .number "$EVIDENCE/mpm-h-pr.out")
uh unit create --worktree "$HW" --space "$H/page-merge" --type sheet --name Budget --json > "$EVIDENCE/mpm-h-unit.out"
U=$(jq -r .unit.unitId "$EVIDENCE/mpm-h-unit.out"); RES=$(jq -r .unit.resourceId "$EVIDENCE/mpm-h-unit.out")
uh execute --worktree "$HW" --unit "$U" --json -e 'const ws = univerAPI.getActiveWorkbook().getActiveSheet(); ws.getRange("A1:B2").setValues([["Region","Total"],["North",42]]); return {sheetId: ws.getSheetId()};' > "$EVIDENCE/mpm-h-data.out"
S=$(jq -r .value.sheetId "$EVIDENCE/mpm-h-data.out")
uh pr ready "$HN" -R "$H/page-merge" --json state; uh pr merge "$HN" -R "$H/page-merge" --json state
page(){ printf '<!DOCTYPE html><html><head><title>Budget</title></head><body style="background:#fff;color:#111;font:18px system-ui;padding:32px"><h1>%s</h1><p>North: <output data-univer-cell-text="%s:%s:B2"></output></p></body></html>\n' "$1" "$U" "$S"; }
page 'Budget by holder' > "$EVIDENCE/mpm-h.univer.html"
uh html-view create --file "$EVIDENCE/mpm-h.univer.html" --space "$T" --name Budget --idempotency-key "mpm-h-$VERIFY_UVW_RUN-0001-abcdef" --json > "$EVIDENCE/mpm-h-page.out"
PN=$(jq -r .nodeId "$EVIDENCE/mpm-h-page.out"); PR=$(jq -r .resourceId "$EVIDENCE/mpm-h-page.out")
```

O proposes a new B2 and a new version of H's page over MCP, then marks the pull request ready. The same save
without `repo` and `pr` is refused, because O can only read the page:

```bash
$V mcp mpm-pr pr_create "{\"repo\":\"$H/page-merge\",\"title\":\"Raise North\"}"
W=$(jq -r .id "$EVIDENCE/mpm-pr.out"); P=$(jq -r .number "$EVIDENCE/mpm-pr.out")
$V mcp mpm-add unit_add "{\"worktree\":\"$W\",\"resource\":\"$RES\"}"
$V mcp mpm-exec execute "$(jq -nc --arg w "$W" --arg u "$U" '{worktree:$w,unit:$u,code:"const ws = univerAPI.getActiveWorkbook().getActiveSheet(); ws.getRange(\"B2\").setValue(77); return ws.getRange(\"B2\").getValue();"}')"
$V mcp mpm-read html_view_read "{\"resource\":\"$PR\"}"
page 'Budget by viewer' > "$EVIDENCE/mpm-v.univer.html"
$V mcp mpm-save html_view_save "$(jq -nc --rawfile html "$EVIDENCE/mpm-v.univer.html" --arg page "$PR" --arg etag "$(jq -r .etag "$EVIDENCE/mpm-read.out")" --arg repo "$H/page-merge" --argjson pr "$P" --arg key "mpm-save-$VERIFY_UVW_RUN-0001-abcdef" '{html:$html,page:$page,etag:$etag,repo:$repo,pr:$pr,idempotency_key:$key}')"
D=$(jq -r .draft.id "$EVIDENCE/mpm-save.out")
$V mcp mpm-save-direct html_view_save "$(jq -nc --rawfile html "$EVIDENCE/mpm-v.univer.html" --arg page "$PR" --arg etag "$(jq -r .etag "$EVIDENCE/mpm-read.out")" --arg key "mpm-direct-$VERIFY_UVW_RUN-0001-abcdef" '{html:$html,page:$page,etag:$etag,idempotency_key:$key}')"; test $? -eq 1
$V mcp mpm-ready pr_ready "{\"repo\":\"$H/page-merge\",\"number\":$P}"
```

E's CLI session is not the browser's, so its merge is refused and nothing changes:

```bash
ue pr merge "$P" -R "$H/page-merge" --json > "$EVIDENCE/mpm-e-cli-merge.out" 2> "$EVIDENCE/mpm-e-cli-merge.err"; echo $? > "$EVIDENCE/mpm-e-cli-merge.exit"
ue pr view "$P" -R "$H/page-merge" --json state > "$EVIDENCE/mpm-e-view.out"
uh inspect range B2 --unit "$U" --trunk --worksheet index:1 > "$EVIDENCE/mpm-trunk-before.out"
$V mcp mpm-page-before html_view_read "{\"resource\":\"$PR\"}"
```

In a second browser session (`AGENT_BROWSER_SESSION=$AGENT_BROWSER_SESSION-editor`), set the language, view and
onboarding as in MHV5 and sign in as E with `$EH/pw`. Open `$ORIGIN/spaces/$T/pulls/$P`, click `Confirm merge`,
save `mpm-e-confirm.png`, then confirm in the `Merge this pull request?` dialog (`click 'div[role=alertdialog] button:last-of-type'`),
`wait --text "Published 1 page"` and save `mpm-e-published-toast.png`. Read the result back:

```bash
uh inspect range B2 --unit "$U" --trunk --worksheet index:1 > "$EVIDENCE/mpm-trunk-after.out"
$V mcp mpm-page-after html_view_read "{\"resource\":\"$PR\"}"
jq -j .html "$EVIDENCE/mpm-page-after.out" | cmp "$EVIDENCE/mpm-v.univer.html" -
$V mcp mpm-draft-after html_view_draft_get "{\"draft\":\"$D\"}"
```

Then open `$ORIGIN/nodes/$PN?view=immersive` in E's session, wait 6 s and save `mpm-page-published.png`.

Pass when `mpm-role` says `viewer`, `mpm-save` is a pending `replace` draft with `publishWhen: "merge"`, and
`mpm-save-direct` has `code: "FORBIDDEN"` and `Cannot edit draft target.`. `mpm-e-cli-merge` exits `1` with
`PAGE_REVIEW_REQUIRED: A person must merge this pull request in the browser, because its author cannot publish these pages or files alone: Budget.univer.html. Review it at <web origin>/spaces/<T>/pulls/<P>.`
(status 409), the pull request is still `ready`, Trunk B2 is still `42`, and the page still reads
`Budget by holder`. The dialog says `Merging will publish 1 page.`, and the toast says `Published 1 page` with
`Open page`. Afterwards Trunk B2 is `77`, the page HTML is O's byte for byte, the draft is `published`, and the
page shows `Budget by viewer` and `North: 77`.

### MHV9. A page someone changed since its draft stays as it was, and the Sheet still merges

Continue from MHV8. O opens another pull request with B2 `88` and a new version of the page, then H replaces the
page before the merge:

```bash
$V mcp mpc-pr pr_create "{\"repo\":\"$H/page-merge\",\"title\":\"Raise North again\"}"
W2=$(jq -r .id "$EVIDENCE/mpc-pr.out"); P2=$(jq -r .number "$EVIDENCE/mpc-pr.out")
$V mcp mpc-add unit_add "{\"worktree\":\"$W2\",\"resource\":\"$RES\"}"
$V mcp mpc-exec execute "$(jq -nc --arg w "$W2" --arg u "$U" '{worktree:$w,unit:$u,code:"const ws = univerAPI.getActiveWorkbook().getActiveSheet(); ws.getRange(\"B2\").setValue(88); return ws.getRange(\"B2\").getValue();"}')"
$V mcp mpc-read html_view_read "{\"resource\":\"$PR\"}"
page 'Budget by viewer again' > "$EVIDENCE/mpc-v.univer.html"
$V mcp mpc-save html_view_save "$(jq -nc --rawfile html "$EVIDENCE/mpc-v.univer.html" --arg page "$PR" --arg etag "$(jq -r .etag "$EVIDENCE/mpc-read.out")" --arg repo "$H/page-merge" --argjson pr "$P2" --arg key "mpc-save-$VERIFY_UVW_RUN-0001-abcdef" '{html:$html,page:$page,etag:$etag,repo:$repo,pr:$pr,idempotency_key:$key}')"
D2=$(jq -r .draft.id "$EVIDENCE/mpc-save.out")
uh blob download --resource "$PR" --json "$EVIDENCE/mpc-h-before.univer.html" > "$EVIDENCE/mpc-h-download.out"
page 'Budget by holder again' > "$EVIDENCE/mpc-h-again.univer.html"
uh blob replace --resource "$PR" --file "$EVIDENCE/mpc-h-again.univer.html" --etag "$(jq -r .download.etag "$EVIDENCE/mpc-h-download.out")" --idempotency-key "mpc-h-replace-$VERIFY_UVW_RUN-0001" --json
$V mcp mpc-ready pr_ready "{\"repo\":\"$H/page-merge\",\"number\":$P2}"
```

E merges `$ORIGIN/spaces/$T/pulls/$P2` in the browser as in MHV8 and waits for
`The task was merged into the official version.`; save `mpc-e-merged.png`. Then:

```bash
uh inspect range B2 --unit "$U" --trunk --worksheet index:1 > "$EVIDENCE/mpc-trunk-after.out"
uh blob download --resource "$PR" --force --json "$EVIDENCE/mpc-h-after.univer.html"
cmp "$EVIDENCE/mpc-h-again.univer.html" "$EVIDENCE/mpc-h-after.univer.html"
curl -sS -b "$EH/cookies" "$ORIGIN/api/worktrees/$W2/html-view-drafts" > "$EVIDENCE/mpc-list.json"
$V mcp mpc-draft-after html_view_draft_get "{\"draft\":\"$D2\"}"
```

Pass when the merge succeeds without a published-page toast, Trunk B2 is `88`, the page holds H's second bytes,
and the list, the draft and the `Pages` section of the pull request all read `conflicted` (`Conflicted` in the browser).

### MHV10. An Editor agent merges its own pull request over MCP, and its page publishes

Continue from MHV9 with the run browser signed in as O. A claimed agent principal becomes an Editor of H's
Space:

```bash
$V principal pagebot mpa-bot
BOT=$(jq -r .agent.id "$EVIDENCE/principal-pagebot.json")
$V mcp --as pagebot mpa-claim claim '{}'
```

Open the `claimUrl` from `mpa-claim.out` in the run browser and click `Take it`, then replace the code in
`mpa-claim.*` as [MH1](agent-handoff.md#mh1-unclaimed-agent) says. The agent then works alone:

```bash
curl --fail-with-body -sS -b "$HH/cookies" -o /dev/null -X PUT -H 'content-type: application/json' -d '{"role":"editor"}' "$ORIGIN/api/team-spaces/$T/members/$BOT"
$V mcp --as pagebot mpa-role repo_view "{\"repo\":\"$H/page-merge\"}"
$V mcp --as pagebot mpa-pr pr_create "{\"repo\":\"$H/page-merge\",\"title\":\"Agent page\"}"
W3=$(jq -r .id "$EVIDENCE/mpa-pr.out"); P3=$(jq -r .number "$EVIDENCE/mpa-pr.out")
$V mcp --as pagebot mpa-add unit_add "{\"worktree\":\"$W3\",\"resource\":\"$RES\"}"
$V mcp --as pagebot mpa-exec execute "$(jq -nc --arg w "$W3" --arg u "$U" '{worktree:$w,unit:$u,code:"const ws = univerAPI.getActiveWorkbook().getActiveSheet(); ws.getRange(\"B2\").setValue(99); return ws.getRange(\"B2\").getValue();"}')"
page 'Budget by agent' > "$EVIDENCE/mpa-page.univer.html"
$V mcp --as pagebot mpa-save html_view_save "$(jq -nc --rawfile html "$EVIDENCE/mpa-page.univer.html" --arg space "$H/page-merge" --argjson pr "$P3" --arg key "mpa-save-$VERIFY_UVW_RUN-0001-abcdef" '{html:$html,space:$space,name:"Agent budget",repo:$space,pr:$pr,idempotency_key:$key}')"
D3=$(jq -r .draft.id "$EVIDENCE/mpa-save.out")
$V mcp --as pagebot mpa-ready pr_ready "{\"repo\":\"$H/page-merge\",\"number\":$P3}"
$V mcp --as pagebot mpa-merge pr_merge "{\"repo\":\"$H/page-merge\",\"number\":$P3}"
$V mcp --as pagebot mpa-draft-after html_view_draft_get "{\"draft\":\"$D3\"}"
$V mcp mpa-page-after html_view_read "{\"resource\":\"$(jq -r .draft.resource "$EVIDENCE/mpa-draft-after.out")\"}"
jq -j .html "$EVIDENCE/mpa-page-after.out" | cmp "$EVIDENCE/mpa-page.univer.html" -
uh inspect range B2 --unit "$U" --trunk --worksheet index:1 > "$EVIDENCE/mpa-trunk-after.out"
```

Pass when `mpa-role` says `editor`, `mpa-save` is a pending `create` draft with `publishWhen: "merge"`,
`mpa-ready` keeps `visibility: "private"` because the agent can merge it, `mpa-merge` prints `state: "merged"`,
the draft is `published` with a `shareUrl`, O reads the agent's HTML byte for byte, and Trunk B2 is `99`.
Before `$V down`, close E's browser session and run `uh daemon stop` and `ue daemon stop`. After it,
`rm -rf "$HH" "$EH"`.

### MHV11. A Viewer agent changes a Sheet and its page through a fork, and an Editor merges in the browser

A holder H owns a public Team Space whose `proposals` setting is `accountable`. A claimed agent A is a Viewer and
works only through its fork, and E is an Editor. Register H and E and sign their uvw in as in MHV8, unless this run
already did, then define `uh`, `ue` and MHV8's `page` function. H creates the Space and A. MHV11 to MHV15 use two
`principal`s:

```bash
uh repo create fork-pages --name "Fork pages" --proposals accountable --json id > "$EVIDENCE/mfp-team.out"; T=$(jq -r .id "$EVIDENCE/mfp-team.out")
curl --fail-with-body -sS -b "$HH/cookies" -o /dev/null -X PATCH -H 'content-type: application/json' -d '{"publicRead":true}' "$ORIGIN/api/spaces/$T"
$V principal pagefork mfp-a
AID=$(jq -r .agent.id "$EVIDENCE/principal-pagefork.json")
$V mcp --as pagefork mfp-claim claim '{}'
```

Open the `claimUrl` from `mfp-claim.out` in the run browser, signed in as O, and click `Take it`. Replace the
code in `mfp-claim.*` as [MH1](agent-handoff.md#mh1-unclaimed-agent) says. Then H adds A
as a Viewer and E as an Editor, and puts a Sheet with North `42` in B2 on Trunk and a page bound to it, with the
commands of MHV8 on `$H/fork-pages`, from `uh pr create` to `PN` and `PR`, with `mfp-h` in place of `mpm-h` in the
evidence names and the idempotency key:

```bash
for pair in "$AID:viewer" "$(jq -r .user.id "$EH/register.json"):editor"; do
  curl --fail-with-body -sS -b "$HH/cookies" -o /dev/null -X PUT -H 'content-type: application/json' -d "{\"role\":\"${pair#*:}\"}" "$ORIGIN/api/team-spaces/$T/members/${pair%%:*}"
done
$V mcp --as pagefork mfp-role repo_view "{\"repo\":\"$H/fork-pages\"}"
```

A forks the Space, reads the page through the fork, changes B2 through the fork, checks the page against the
fork and against Trunk, saves it, reads it back through the fork and saves it again:

```bash
$V mcp --as pagefork mfp-fork fork_create "{\"repo\":\"$H/fork-pages\",\"name\":\"fix\"}"
F=$(jq -r .fullName "$EVIDENCE/mfp-fork.out")
$V mcp --as pagefork mfp-read html_view_read "{\"resource\":\"$PR\",\"worktree\":\"$F\"}"
$V mcp --as pagefork mfp-exec execute "$(jq -nc --arg w "$F" --arg u "$U" '{worktree:$w,unit:$u,code:"const ws = univerAPI.getActiveWorkbook().getActiveSheet(); ws.getRange(\"B2\").setValue(77); return ws.getRange(\"B2\").getValue();"}')"
page 'Budget through a fork' > "$EVIDENCE/mfp-v1.univer.html"
$V mcp --as pagefork mfp-dry html_view_save "$(jq -nc --rawfile html "$EVIDENCE/mfp-v1.univer.html" --arg w "$F" '{html:$html,dryRun:true,worktree:$w}')"
$V mcp --as pagefork mfp-dry-trunk html_view_save "$(jq -nc --rawfile html "$EVIDENCE/mfp-v1.univer.html" '{html:$html,dryRun:true}')"
save(){ jq -nc --rawfile html "$EVIDENCE/$1.univer.html" --arg page "$PR" --arg etag "$(jq -r .etag "$EVIDENCE/$2.out")" --arg w "$3" --arg key "$4-$VERIFY_UVW_RUN-0001-abcdef" '{html:$html,page:$page,etag:$etag,worktree:$w,idempotency_key:$key}'; }
$V mcp --as pagefork mfp-save html_view_save "$(save mfp-v1 mfp-read "$F" mfp-save)"
$V mcp --as pagefork mfp-read-draft html_view_read "{\"resource\":\"$PR\",\"worktree\":\"$F\"}"
page 'Budget through a fork, revised' > "$EVIDENCE/mfp-v2.univer.html"
$V mcp --as pagefork mfp-revise html_view_save "$(save mfp-v2 mfp-read-draft "$F" mfp-revise)"
$V mcp --as pagefork mfp-old-draft html_view_draft_get "{\"draft\":\"$(jq -r .draft.id "$EVIDENCE/mfp-save.out")\"}"
$V mcp --as pagefork mfp-view fork_view "{\"fork\":\"$F\"}"
P=$(jq -r .worktree.number "$EVIDENCE/mfp-view.out"); W=$(jq -r .worktree.id "$EVIDENCE/mfp-view.out"); D=$(jq -r .draft.id "$EVIDENCE/mfp-revise.out")
$V mcp --as pagefork mfp-ready pr_ready "{\"repo\":\"$H/fork-pages\",\"number\":$P}"
curl --fail-with-body -sS -b "$EH/cookies" "$ORIGIN/api/worktrees/$W/html-view-drafts" > "$EVIDENCE/mfp-list.json"
$V mcp --as pagefork mfp-frozen html_view_save "$(save mfp-v2 mfp-read-draft "$F" mfp-frozen)"; test $? -eq 1
```

In E's browser session (`AGENT_BROWSER_SESSION=$AGENT_BROWSER_SESSION-editor`), set the language, view and
onboarding as in MHV5 and sign in as E with `$EH/pw`. Open `$ORIGIN/spaces/$T/pulls/$P`, scroll to the `Pages`
section and save `mfp-e-pages.png`. Follow `Preview`, wait 8 s, save `mfp-e-preview.png` and list the buttons as in
MHV6. Merge as in MHV8 and save `mfp-e-merged.png` after `Published 1 page`. Read the result back, then open
`$ORIGIN/nodes/$PN?view=immersive` in E's session, wait 6 s and save `mfp-page-published.png`:

```bash
uh inspect range B2 --unit "$U" --trunk --worksheet index:1 > "$EVIDENCE/mfp-trunk-after.out"
$V mcp mfp-page-after html_view_read "{\"resource\":\"$PR\"}"
jq -j .html "$EVIDENCE/mfp-page-after.out" | cmp "$EVIDENCE/mfp-v2.univer.html" -
$V mcp --as pagefork mfp-draft-after html_view_draft_get "{\"draft\":\"$D\"}"
$V mcp --as pagefork mfp-view-after fork_view "{\"fork\":\"$F\"}"
```

Pass when `mfp-role` says `viewer` and `mfp-fork` is `clean`. `mfp-read` is the page with its `etag` and no `draft`.
`mfp-dry` samples `77` and `mfp-dry-trunk` samples `42`. `mfp-save` is a pending `replace` draft with
`publishWhen: "merge"` whose `sourceWorktreeId` is `W`. `mfp-read-draft` returns that draft's id, the page as
`resource`, the `etag` of `mfp-read` and the first HTML, so `mfp-revise` revises it: `mfp-old-draft` is
`superseded` by `D`. `mfp-ready` has `visibility: "space"`, the list holds only `D`, pending and by A, and
`mfp-frozen` has `code: "FORK_WORKTREE_NOT_DRAFT"` and `The fork's Worktree is ready`. The `Pages` section shows
`Budget.univer.html`, A's name and `Pending review`. The preview says `<A> wrote this page. The preview is
read-only and loads only the Sheets it declares.`, shows the second HTML with `North: 77`, and has only the
`New` and `Current` buttons. The dialog says `Merging will publish 1 page.` After the merge, Trunk B2 is `77`, the
page is the second HTML byte for byte and shows `North: 77`, the draft is `published`, and the fork is `clean`.

### MHV12. Through a fork, a page someone changed since its draft stays as it was, and the Sheet merges

Continue from MHV11. A's fork is clean, so its next write opens a new pull request:

```bash
$V mcp --as pagefork mfc-exec execute "$(jq -nc --arg w "$F" --arg u "$U" '{worktree:$w,unit:$u,code:"const ws = univerAPI.getActiveWorkbook().getActiveSheet(); ws.getRange(\"B2\").setValue(88); return ws.getRange(\"B2\").getValue();"}')"
$V mcp --as pagefork mfc-read html_view_read "{\"resource\":\"$PR\",\"worktree\":\"$F\"}"
page 'Budget through a fork again' > "$EVIDENCE/mfc-v.univer.html"
$V mcp --as pagefork mfc-save html_view_save "$(save mfc-v mfc-read "$F" mfc-save)"
D2=$(jq -r .draft.id "$EVIDENCE/mfc-save.out")
uh blob download --resource "$PR" --force --json "$EVIDENCE/mfc-h-before.univer.html" > "$EVIDENCE/mfc-h-download.out"
page 'Budget by holder, later' > "$EVIDENCE/mfc-h.univer.html"
uh blob replace --resource "$PR" --file "$EVIDENCE/mfc-h.univer.html" --etag "$(jq -r .download.etag "$EVIDENCE/mfc-h-download.out")" --idempotency-key "mfc-h-replace-$VERIFY_UVW_RUN-0001" --json
$V mcp --as pagefork mfc-view fork_view "{\"fork\":\"$F\"}"
P2=$(jq -r .worktree.number "$EVIDENCE/mfc-view.out"); W2=$(jq -r .worktree.id "$EVIDENCE/mfc-view.out")
$V mcp --as pagefork mfc-ready pr_ready "{\"repo\":\"$H/fork-pages\",\"number\":$P2}"
```

E merges `$ORIGIN/spaces/$T/pulls/$P2` in the browser as in MHV9 and saves `mfc-e-merged.png`. Then:

```bash
uh inspect range B2 --unit "$U" --trunk --worksheet index:1 > "$EVIDENCE/mfc-trunk-after.out"
uh blob download --resource "$PR" --force --json "$EVIDENCE/mfc-h-after.univer.html"
cmp "$EVIDENCE/mfc-h.univer.html" "$EVIDENCE/mfc-h-after.univer.html"
curl -sS -b "$EH/cookies" "$ORIGIN/api/worktrees/$W2/html-view-drafts" > "$EVIDENCE/mfc-list.json"
$V mcp --as pagefork mfc-draft-after html_view_draft_get "{\"draft\":\"$D2\"}"
```

Pass when `mfc-read` is the page MHV11 published, with no `draft`. The merge ends with
`The task was merged into the official version.` and no published-page toast, Trunk B2 is `88`, the page holds H's
later bytes, and the list, the draft and the `Pages` section read `conflicted` (`Conflicted` in the browser).

### MHV13. A non-member agent proposes a page alone through a fork, then a page and its Sheet

Continue from MHV12. A second claimed agent G is no member of H's Space, which `accountable` opens to it:

```bash
$V principal pageguest mfn-g
$V mcp --as pageguest mfn-claim claim '{}'
```

Claim it in the run browser as in MHV11 and replace the code in `mfn-claim.*`. G saves only the page on its clean
fork:

```bash
$V mcp --as pageguest mfn-role repo_view "{\"repo\":\"$H/fork-pages\"}"
uh repo member list -R "$H/fork-pages" --json > "$EVIDENCE/mfn-members.out"
$V mcp --as pageguest mfn-fork fork_create "{\"repo\":\"$H/fork-pages\",\"name\":\"page\"}"
FG=$(jq -r .fullName "$EVIDENCE/mfn-fork.out")
$V mcp --as pageguest mfn-read html_view_read "{\"resource\":\"$PR\",\"worktree\":\"$FG\"}"
page 'Budget proposed by a guest' > "$EVIDENCE/mfn-v.univer.html"
$V mcp --as pageguest mfn-save html_view_save "$(save mfn-v mfn-read "$FG" mfn-save)"
$V mcp --as pageguest mfn-view fork_view "{\"fork\":\"$FG\"}"
P3=$(jq -r .worktree.number "$EVIDENCE/mfn-view.out")
$V mcp --as pageguest mfn-units unit_list "{\"worktree\":\"$FG\"}"
$V mcp --as pageguest mfn-ready pr_ready "{\"repo\":\"$H/fork-pages\",\"number\":$P3}"
```

In E's session, open `$ORIGIN/spaces/$T/pulls/$P3`, follow `Preview` and save `mfn-e-preview.png` as in MHV11, then
merge and wait for `Published 1 page`. Then G changes B2 and the page in the fork's next pull request:

```bash
$V mcp mfn-page-after html_view_read "{\"resource\":\"$PR\"}"
jq -j .html "$EVIDENCE/mfn-page-after.out" | cmp "$EVIDENCE/mfn-v.univer.html" -
uh pr view "$P3" -R "$H/fork-pages" --json state,units > "$EVIDENCE/mfn-pr-after.out"
$V mcp --as pageguest mfn2-exec execute "$(jq -nc --arg w "$FG" --arg u "$U" '{worktree:$w,unit:$u,code:"const ws = univerAPI.getActiveWorkbook().getActiveSheet(); ws.getRange(\"B2\").setValue(99); return ws.getRange(\"B2\").getValue();"}')"
$V mcp --as pageguest mfn2-read html_view_read "{\"resource\":\"$PR\",\"worktree\":\"$FG\"}"
page 'Budget and Sheet by a guest' > "$EVIDENCE/mfn2-v.univer.html"
$V mcp --as pageguest mfn2-save html_view_save "$(save mfn2-v mfn2-read "$FG" mfn2-save)"
$V mcp --as pageguest mfn2-view fork_view "{\"fork\":\"$FG\"}"
P4=$(jq -r .worktree.number "$EVIDENCE/mfn2-view.out")
$V mcp --as pageguest mfn2-ready pr_ready "{\"repo\":\"$H/fork-pages\",\"number\":$P4}"
```

E previews `$ORIGIN/spaces/$T/pulls/$P4` (`mfn2-e-preview.png`) and merges it the same way. Read back Trunk B2 and
compare the page with `mfn2-v.univer.html` as in MHV11.

Pass when `mfn-role` has `affiliation: "none"` and `capabilities.propose: true`, `mfn-members` does not list G,
and `mfn-fork` is `clean`. `mfn-save` is a pending draft, `mfn-view` is `drafting` with the pull request the save
opened, and `mfn-units` is empty. Both previews name G and are read-only, and both merges publish 1 page. The
first pull request is `merged` with no Unit and publishes G's page byte for byte while Trunk B2 stays `88`. The
second publishes `mfn2-v.univer.html` with Trunk B2 `99`.

### MHV14. uvw validates a page through a fork and refuses to create a page in one

O is a person, so `accountable` opens the Space to O too. O forks it with uvw and checks a page against the fork:

```bash
$V cli mfv-fork fork create "$H/fork-pages" --name check --json
$V cli mfv-clean html-view validate --file "$EVIDENCE/mfp-v1.univer.html" --worktree "$O/check" --json
$V cli mfv-exec execute --worktree "$O/check" --unit "$U" --json -e 'const ws = univerAPI.getActiveWorkbook().getActiveSheet(); ws.getRange("B2").setValue(66); return ws.getRange("B2").getValue();'
$V cli mfv-fork-scope html-view validate --file "$EVIDENCE/mfp-v1.univer.html" --worktree "$O/check" --json
$V cli mfv-create html-view create --file "$EVIDENCE/mfp-v1.univer.html" --space "$O/check" --name Refused --idempotency-key "mfv-create-$VERIFY_UVW_RUN-0001" --json
```

Pass when `mfv-clean` samples Trunk's `99`, `mfv-fork-scope` samples `66`, and `mfv-create` exits `1` with
`workspace-argument-invalid: <O>/check is a fork of <H>/fork-pages. html-view create publishes to a repository's trunk at once, and the CLI saves no page drafts, so it cannot propose a page through a fork. Save the page through the fork with the MCP tool html_view_save and worktree <O>/check.`

### MHV15. A real model fixes a Sheet and its page through a fork

A runs one story with a real model. Its fork from MHV11 is clean:

```bash
since=$(date -u +%Y-%m-%dT%H:%M:%SZ)
$V story --as pagefork mfs-story mcp "通过你的 fork $F 把 $H/fork-pages 里 Budget 表格的 North（B2）改成 120，并把页面 Budget.univer.html 的标题改成 Budget fixed，然后把这个 pull request 标记为 ready 交给人审阅。"
$V mcp-logs | jq -s --arg since "$since" '[.[] | select(.event == "mcp.tool_call" and .ts >= $since)]' > "$EVIDENCE/mfs-events.json"
jq -e 'all(.[]; ((.error_code // "") | test("AGENT_NOT_ALLOWED|INTERACTIVE_SESSION_REQUIRED") | not))' "$EVIDENCE/mfs-events.json"
$V mcp --as pagefork mfs-view fork_view "{\"fork\":\"$F\"}"
```

Pass when `mfs-story/trajectory.txt` shows `execute` and `html_view_save` with `worktree` set to the fork, the
fork's pull request is `ready`, and no `mcp.tool_call` event holds `AGENT_NOT_ALLOWED` or
`INTERACTIVE_SESSION_REQUIRED`. Before `$V down`, close E's browser session and run `uh daemon stop` and
`ue daemon stop`. After it, `rm -rf "$HH" "$EH"`.

### MHV16. An Editor merges only the pages they reviewed

Continue from MHV8, with or without MHV9 to MHV15. MHV11 sets `T`, `U`, `RES`, `S`, `PN` and `PR` for its own
Space, so take MHV8's back first. O proposes B2 `55` and a new version of H's page, then marks the pull request ready:

```bash
T=$(jq -r .id "$EVIDENCE/mpm-team.out"); U=$(jq -r .unit.unitId "$EVIDENCE/mpm-h-unit.out"); RES=$(jq -r .unit.resourceId "$EVIDENCE/mpm-h-unit.out")
S=$(jq -r .value.sheetId "$EVIDENCE/mpm-h-data.out"); PN=$(jq -r .nodeId "$EVIDENCE/mpm-h-page.out"); PR=$(jq -r .resourceId "$EVIDENCE/mpm-h-page.out")
$V mcp mrv-pr pr_create "{\"repo\":\"$H/page-merge\",\"title\":\"Reviewed page\"}"
W5=$(jq -r .id "$EVIDENCE/mrv-pr.out"); P5=$(jq -r .number "$EVIDENCE/mrv-pr.out")
$V mcp mrv-add unit_add "{\"worktree\":\"$W5\",\"resource\":\"$RES\"}"
$V mcp mrv-exec execute "$(jq -nc --arg w "$W5" --arg u "$U" '{worktree:$w,unit:$u,code:"const ws = univerAPI.getActiveWorkbook().getActiveSheet(); ws.getRange(\"B2\").setValue(55); return ws.getRange(\"B2\").getValue();"}')"
$V mcp mrv-read html_view_read "{\"resource\":\"$PR\"}"
page 'Budget as reviewed' > "$EVIDENCE/mrv-v1.univer.html"
$V mcp mrv-save html_view_save "$(jq -nc --rawfile html "$EVIDENCE/mrv-v1.univer.html" --arg page "$PR" --arg etag "$(jq -r .etag "$EVIDENCE/mrv-read.out")" --arg repo "$H/page-merge" --argjson pr "$P5" --arg key "mrv-save-$VERIFY_UVW_RUN-0001-abcdef" '{html:$html,page:$page,etag:$etag,repo:$repo,pr:$pr,idempotency_key:$key}')"
D5=$(jq -r .draft.id "$EVIDENCE/mrv-save.out")
$V mcp mrv-ready pr_ready "{\"repo\":\"$H/page-merge\",\"number\":$P5}"
```

In E's browser session, open `$ORIGIN/spaces/$T/pulls/$P5`, run
`agent-browser scrollintoview 'section[aria-label="Pages"]'` and save `mrv-e-review.png`. Keep this tab open and do
not reload it. O reopens the pull request, revises the page and marks it ready again:

```bash
$V mcp mrv-reopen pr_ready "$(jq -nc --arg repo "$H/page-merge" --argjson n "$P5" '{repo:$repo,number:$n,undo:true}')"
page 'Budget changed after review' > "$EVIDENCE/mrv-v2.univer.html"
$V mcp mrv-revise html_view_save "$(jq -nc --rawfile html "$EVIDENCE/mrv-v2.univer.html" --arg d "$D5" --arg key "mrv-revise-$VERIFY_UVW_RUN-0001-abcdef" '{html:$html,draft:$d,idempotency_key:$key}')"
D6=$(jq -r .draft.id "$EVIDENCE/mrv-revise.out")
$V mcp mrv-ready-again pr_ready "{\"repo\":\"$H/page-merge\",\"number\":$P5}"
uh inspect range B2 --unit "$U" --trunk --worksheet index:1 > "$EVIDENCE/mrv-trunk-before.out"
$V mcp mrv-page-before html_view_read "{\"resource\":\"$PR\"}"
```

In the tab E kept open, wait until `Confirm merge` shows again, click it and save `mrv-e-stale-confirm.png`. Confirm
in the `Merge this pull request?` dialog as in MHV8, `wait --text "changed after you reviewed them"` and save
`mrv-e-pages-changed.png`. Then check that nothing changed:

```bash
ue pr view "$P5" -R "$H/page-merge" --json state > "$EVIDENCE/mrv-e-view.out"
uh inspect range B2 --unit "$U" --trunk --worksheet index:1 > "$EVIDENCE/mrv-trunk-refused.out"
cmp "$EVIDENCE/mrv-trunk-before.out" "$EVIDENCE/mrv-trunk-refused.out"
$V mcp mrv-page-refused html_view_read "{\"resource\":\"$PR\"}"
diff <(jq -S . "$EVIDENCE/mrv-page-before.out") <(jq -S . "$EVIDENCE/mrv-page-refused.out")
$V mcp mrv-draft-refused html_view_draft_get "{\"draft\":\"$D6\"}"
```

E reviews again in the same tab. Scroll to the `Pages` section and save `mrv-e-review-again.png`, follow `Preview`,
wait 8 s and save `mrv-e-preview-again.png`. Go back to the pull request, click `Confirm merge`, save
`mrv-e-confirm-again.png`, confirm, `wait --text "Published 1 page"` and save `mrv-e-published.png`. Read the
result back:

```bash
uh inspect range B2 --unit "$U" --trunk --worksheet index:1 > "$EVIDENCE/mrv-trunk-after.out"
$V mcp mrv-page-after html_view_read "{\"resource\":\"$PR\"}"
jq -j .html "$EVIDENCE/mrv-page-after.out" | cmp "$EVIDENCE/mrv-v2.univer.html" -
$V mcp mrv-old-draft html_view_draft_get "{\"draft\":\"$D5\"}"
$V mcp mrv-draft-after html_view_draft_get "{\"draft\":\"$D6\"}"
```

Then open `$ORIGIN/nodes/$PN?view=immersive` in E's session, wait 6 s and save `mrv-page-published.png`.

Pass when `mrv-save` is a pending `replace` draft with `publishWhen: "merge"` and `mrv-e-review.png` lists
`Budget.univer.html` by O as `Pending review`. `mrv-revise` is a new pending draft `D6`. In the kept tab the dialog
still says `Merging will publish 1 page.`, and the merge ends with the toast
`The pages or files in this pull request changed after you reviewed them. The list is refreshed. Review them again before you merge.`
and no published-page toast. The pull request is still `ready`, Trunk B2 and the page are as before, and `D6` is
`pending`. After the refresh the `Pages` section lists one page, `Pending review`, and its preview shows
`Budget changed after review` with the pull request's `North: 55`. The second merge says `Published 1 page`,
Trunk B2 is `55`, the page is `mrv-v2.univer.html` byte for byte and shows `North: 55`, `D5` is `superseded` and
`D6` is `published`. Before `$V down`, close E's browser session and run `uh daemon stop` and `ue daemon stop`.
After it, `rm -rf "$HH" "$EH"`.

## Gotchas

- The MCP-mode gotchas in [MCP gateway](mcp.md#gotchas) apply.
