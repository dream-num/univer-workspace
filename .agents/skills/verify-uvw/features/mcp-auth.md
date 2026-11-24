# MCP sign-in with personal access tokens

An agent calls the gateway with a personal access token (PAT). Its scopes limit what it may do, revoking it stops
the next call, and the protected-resource metadata tells a client where to sign in. Turning on MCP OAuth leaves
Browser, uvw and Workspace Agent sign-in unchanged.

## Sub-features

- MA1 calls the gateway with the default personal access token (PAT) and records `auth_kind: pat`.
- MA2 reads the protected-resource metadata without credentials.
- MA3 refuses a write tool to a read-only PAT.
- MA4 revokes a PAT and gets HTTP 401 on the next Workspace-backed call.
- MA5 keeps development session authentication available with `--auth dev`.
- MA6 checks PAT defaults (all scopes, no expiry, 10-minute downstream session) and creates, uses and revokes a PAT in the Browser.
- MA7 refuses `pr_merge` to a PAT without `worktree:merge`.
- MA8 checks Browser sign-in, both `uvw auth login` paths, and Workspace Agent browser OAuth with `agent-up` while MCP OAuth is enabled.

## How to get to it (user POV)

A person creates and revokes PATs in the Browser's token settings and gives one to an MCP client as a bearer
token for `$MCP_URL`. `$V user` creates the run's default PAT and `$V mcp-token` replaces it.

## Driving it with agent-browser and uvw

Run these in an MCP-mode instance, started as in [MCP gateway](mcp.md): `VERIFY_UVW_MCP=1 $V up`,
`$V user` and a `$V doctor` with no `FAIL` lines. Start every shell with `eval "$($V env)"`. Each `$V mcp`
call checks its usage event and credential leakage, and exit 5 fails the journey.
[MCP mode](../references/mcp-mode.md) lists the helper commands and their exit codes. MA3 and MA7 use the Team Space:

```bash
O=verify-$VERIFY_UVW_RUN
# The Team Space that M4 in mcp.md creates; this creates it on a run that skipped M4.
$V uvw repo view "$O/verify-team" --json >/dev/null 2>&1 \
  || $V cli mcp-repo-create repo create verify-team --name "Verify Team" --json id,fullName
```

### MA1. PAT call

`user` created the default PAT, and every other MCP journey runs with it.

```bash
$V mcp mcp-pat-whoami whoami
PAT_ID=$(cat "$RUN/home/mcp-token-id")
grep -q '^auth=pat$' "$EVIDENCE/mcp-pat-whoami.cmd"
jq -e --arg id "$PAT_ID" '.auth_kind == "pat" and .client_id == $id and .outcome == "ok"' "$EVIDENCE/mcp-pat-whoami.event.json"
jq -e '.subject.name != null' "$EVIDENCE/mcp-pat-whoami.out"
```

Pass when the call exits 0 and the event records `pat` and this PAT's id. The harness already failed
the call (exit 5) if the gateway log contained the PAT.

### MA2. Protected-resource metadata

```bash
for path in /.well-known/oauth-protected-resource/mcp /.well-known/oauth-protected-resource; do
  curl -sS -D "$EVIDENCE/mcp-resource-metadata.headers" "${MCP_URL%/mcp}$path" > "$EVIDENCE/mcp-resource-metadata.out"
  jq -e --arg url "$MCP_URL" --arg origin "$ORIGIN" '.resource == $url and .authorization_servers == [$origin] and .scopes_supported == ["read","write","publish","worktree:merge"] and .bearer_methods_supported == ["header"]' "$EVIDENCE/mcp-resource-metadata.out"
  grep -qi '^cache-control: public, max-age=300' "$EVIDENCE/mcp-resource-metadata.headers"
done
```

Pass when both paths answer without credentials with the document and cache header.

### MA3. Read-only PAT

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

### MA4. Revocation

```bash
$V mcp-token > "$EVIDENCE/mcp-token-revoke.id"
PAT_ID=$(cat "$RUN/home/mcp-token-id")
$V mcp mcp-pat-before-revoke repo_list
curl -sS -o /dev/null -w '%{http_code}\n' -X DELETE -H "Cookie: workspace_session=$(cat "$RUN/home/mcp-session")" \
  -H "Origin: $ORIGIN" "$ORIGIN/api/auth/tokens/$PAT_ID" > "$EVIDENCE/mcp-pat-revoke.status"
grep -qx 204 "$EVIDENCE/mcp-pat-revoke.status"
$V mcp mcp-pat-after-revoke repo_list
test $? -eq 4
jq -e '.status == 401 and (.www_authenticate | contains("resource_metadata"))' "$EVIDENCE/mcp-pat-after-revoke.out"
$V mcp mcp-pat-after-revoke-again repo_list
test $? -eq 4
$V mcp-token > "$EVIDENCE/mcp-token-restored.id"
```

Pass when the call before revocation exits 0, the revoke answers 204, and the first Workspace-backed
call afterwards exits 4 with HTTP 401 (the revoked session fails downstream, which evicts the cache), as does the
next one (the exchange now answers `invalid_grant`). Use a tool that reaches Workspace: the gateway serves
`whoami` from its 30-second exchange cache. The last command restores a working default PAT.

### MA5. Development session

```bash
$V mcp --auth dev mcp-dev-whoami whoami
jq -e '.auth_kind == "dev" and .client_id == "dev" and .outcome == "ok"' "$EVIDENCE/mcp-dev-whoami.event.json"
```

Pass when the call exits 0 and the event records `dev`.

### MA6. PAT defaults and Browser management

Run after MA5. A PAT gets every scope and never
expires unless the user narrows it. The API check reads the token list with the run's session; the
token exchange (`verify-uvw mcp-oauth exchange`) is the call the gateway makes, so it also shows
the downstream session lasts 10 minutes.

```bash
$V mcp-token --name mcp-pat-default > "$EVIDENCE/mcp-pat-default.id"
curl -sS -H "Cookie: workspace_session=$(cat "$RUN/home/mcp-session")" "$ORIGIN/api/auth/tokens" > "$EVIDENCE/mcp-pat-list.json"
jq -e --arg id "$(cat "$EVIDENCE/mcp-pat-default.id")" '[.tokens[] | select(.id == $id)] | length == 1 and .[0].scopes == ["read","write","publish","worktree:merge"] and .[0].expiresAt == null and .[0].revokedAt == null' "$EVIDENCE/mcp-pat-list.json"
$V mcp-oauth exchange mcp-pat-exchange pat
jq -e --arg id "$(cat "$EVIDENCE/mcp-pat-default.id")" '.status == 200 and .body.scope == "read write publish worktree:merge" and .body.subject == {kind:"pat",id:$id,client_id:null} and .body.expires_in == 600' "$EVIDENCE/mcp-pat-exchange.json"
```

The Browser part creates a PAT with the dialog's defaults, uses it, and revokes it from the same
dialog. The Account menu can ignore a click that lands before the page settles, hence the retry.
The plaintext PAT goes straight to `home/mcp-token` (mode 0600) and never into evidence.

```bash
agent-browser cookies clear
agent-browser open "$ORIGIN/login"
agent-browser storage local set univer-workspace-language en-US
agent-browser storage local set univer-workspace-view-onboarding-complete true
agent-browser storage local set univer-workspace-layout-theme repository
agent-browser reload
agent-browser wait --text Username
agent-browser find label Username fill "verify-$VERIFY_UVW_RUN"
agent-browser find label Password fill "$(cat "$RUN/user.pw")"
agent-browser click 'form button[type=submit]'
agent-browser wait --url '**/home'
agent-browser wait --text 'Your repositories'
for i in 1 2 3 4 5; do
  agent-browser find role button click --name Account
  agent-browser wait 500
  agent-browser snapshot -i -c | grep -q 'menuitem "Access tokens"' && break
done
agent-browser find role menuitem click --name 'Access tokens'
agent-browser wait --text 'New token'
agent-browser find role button click --name 'New token'
agent-browser wait --text 'Create token'
agent-browser snapshot -i -c > "$EVIDENCE/mcp-pat-browser-form.txt"
for scope in read write publish worktree:merge; do grep -E "checkbox \"$scope .*checked=true" "$EVIDENCE/mcp-pat-browser-form.txt"; done
grep -E 'combobox "Expires".*: Never$' "$EVIDENCE/mcp-pat-browser-form.txt"
agent-browser find label Name fill "browser-pat-$VERIFY_UVW_RUN"
agent-browser screenshot "$EVIDENCE/mcp-pat-browser-form.png"
agent-browser find role button click --name 'Create token'
agent-browser wait --text 'Copy and save this token now'
(umask 077 && agent-browser get value 'input[readonly], textarea' > "$RUN/home/mcp-token")
grep -q '^uvw_pat_' "$RUN/home/mcp-token"
curl -sS -H "Cookie: workspace_session=$(cat "$RUN/home/mcp-session")" "$ORIGIN/api/auth/tokens" |
  jq -r --arg name "browser-pat-$VERIFY_UVW_RUN" '.tokens[] | select(.name == $name) | .id' > "$RUN/home/mcp-token-id"
$V mcp mcp-pat-browser repo_list
agent-browser find role button click --name Done
agent-browser find role button click --name "Revoke browser-pat-$VERIFY_UVW_RUN"
agent-browser find role button click --name Revoke --exact
agent-browser wait 1000
agent-browser screenshot "$EVIDENCE/mcp-pat-browser-revoked.png"
$V mcp mcp-pat-browser-revoked-whoami whoami
echo $? > "$EVIDENCE/mcp-pat-browser-revoked-whoami.observed"
$V mcp mcp-pat-browser-revoked repo_list
test $? -eq 4
curl -sS -H "Cookie: workspace_session=$(cat "$RUN/home/mcp-session")" "$ORIGIN/api/auth/tokens" > "$EVIDENCE/mcp-pat-list-after.json"
jq -e --arg name "browser-pat-$VERIFY_UVW_RUN" '.tokens[] | select(.name == $name) | .revokedAt != null and .scopes == ["read","write","publish","worktree:merge"] and .expiresAt == null' "$EVIDENCE/mcp-pat-list-after.json"
if agent-browser snapshot -i -c | grep -F "Revoke browser-pat-$VERIFY_UVW_RUN"; then false; fi
$V mcp-token > "$EVIDENCE/mcp-token-restored-ma6.id"
```

Pass when the default PAT lists all four scopes with `expiresAt: null`, the exchange returns those
scopes with `expires_in: 600`, and the Browser form opens with all four scopes checked and Expires
`Never` (`mcp-pat-browser-form.png`). The Browser PAT calls `repo_list` with `auth_kind: pat`; after
Revoke the next Workspace-backed call exits 4, the token list keeps the row with `revokedAt` set,
and the dialog no longer lists it. `mcp-pat-browser-revoked-whoami.observed` records whether
`whoami` still answered from the gateway's 30-second exchange cache. The last command restores a working default PAT.

### MA7. A PAT without `worktree:merge`

```bash
$V mcp-token --scopes read,write,publish > "$EVIDENCE/mcp-token-nomerge.id"
$V mcp --toolsets all mcp-pat-nomerge-pr pr_create "{\"repo\":\"$O/verify-team\",\"title\":\"PAT merge scope\"}"
NM=$(jq -r '.number' "$EVIDENCE/mcp-pat-nomerge-pr.out")
$V mcp --toolsets all mcp-pat-nomerge-ready pr_ready "{\"repo\":\"$O/verify-team\",\"number\":\"$NM\"}"
$V mcp mcp-pat-nomerge-merge pr_merge "{\"repo\":\"$O/verify-team\",\"number\":\"$NM\"}"
test $? -eq 1
$V mcp-instructions mcp-pat-nomerge-instructions
jq -e '.instructions | contains("Leave merging and discarding to the user in the browser") and (contains("merge it with pr_merge") | not)' "$EVIDENCE/mcp-pat-nomerge-instructions.out"
jq -e '.code == "workspace-scope-required"' "$EVIDENCE/mcp-pat-nomerge-merge.out"
jq -e '.auth_kind == "pat" and .outcome == "tool_error" and .error_code == "workspace-scope-required"' "$EVIDENCE/mcp-pat-nomerge-merge.event.json"
$V cli mcp-pat-nomerge-pr-cli pr view "$NM" -R "$O/verify-team" --json
jq -e '.state == "ready"' "$EVIDENCE/mcp-pat-nomerge-pr-cli.out"
$V mcp-token > "$EVIDENCE/mcp-token-restored-ma7.id"
$V mcp --toolsets all mcp-pat-nomerge-discard pr_discard "{\"repo\":\"$O/verify-team\",\"number\":\"$NM\"}"
jq -e '.state == "discarded"' "$EVIDENCE/mcp-pat-nomerge-discard.out"
```

Pass when `pr_merge`, listed in the default `core`, exits 1 with `workspace-scope-required` and a matching `pat`
usage event, the instructions leave merging to the user, the CLI still shows the pull request `ready`, and the
discard with the restored full-scope PAT succeeds.

### MA8. Existing sign-in clients (host only)

MCP OAuth must not change how the Browser, uvw and the Workspace
Agent sign in, so run these in an MCP-enabled run, where the MCP OAuth code paths are active.
Start a fresh run with an explicit free Agent callback port (these ports also isolate it from other runs):

```bash
V=.agents/skills/verify-uvw/bin/verify-uvw
export VERIFY_UVW_RUN=ma8
VERIFY_UVW_MCP=1 VERIFY_UVW_SERVER_PORT=3923 VERIFY_UVW_WEB_PORT=5976 VERIFY_UVW_MCP_PORT=3933 VERIFY_UVW_AGENT_PORT=3191 $V up
$V user
$V doctor
eval "$($V env)"
RUN=/tmp/verify-uvw/$VERIFY_UVW_RUN
```

Keep this shell open until `down` so command-runner cleanup cannot stop its background services.
Keep `VERIFY_UVW_RUN` exported on every later call. First run every step of
[Accounts and sign-in](auth.md) as written: Browser registration and sign-in, `uvw auth login --username … --password-stdin`, `auth status`, and the wrong-password case. Then the
Browser-approved `uvw auth login`, which prints an approval URL and exits; the raw URL and code stay
in the run's `home/` and never reach evidence. Leave private files there until `$V down`
removes the disposable home; journey steps do not delete files from it.

```bash
(umask 077 && $V uvw auth login > "$RUN/home/cli-login.private" 2>&1)
agent-browser open "$(grep -oE 'https?://[^ ]+' "$RUN/home/cli-login.private" | head -n1)" > /dev/null
agent-browser wait --text 'Confirm and authorize CLI'
test "$(agent-browser get value input)" = "$(sed -n 's/^Verification code: //p' "$RUN/home/cli-login.private")"
agent-browser find role button click --name 'Confirm and authorize CLI'
agent-browser wait --text 'CLI authorized'
agent-browser screenshot "$EVIDENCE/mcp-cli-authorized.png"
$V cli mcp-cli-login-complete auth login --complete --json
jq -e --arg origin "$ORIGIN" --arg name "Verify $VERIFY_UVW_RUN" '.status == "authenticated" and .origin == $origin and .subject.name == $name' "$EVIDENCE/mcp-cli-login-complete.out"
```

Then install and start the Agent. Its token URL is private; suppress `open` output until the
browser has exchanged the token for its cookie and reached the clean root URL.

```bash
$V agent-up
agent-browser open "$(cat "$RUN/home/agent-url")" > /dev/null
agent-browser wait --url 'http://127.0.0.1:3191/' > /dev/null
agent-browser wait --text 'Connect your Workspace'
agent-browser find label 'Workspace service URL' fill "$ORIGIN"
agent-browser snapshot -i -c > "$EVIDENCE/mcp-agent-before-signin.txt"
agent-browser screenshot "$EVIDENCE/mcp-agent-before-signin.png"
agent-browser find role button click --name 'Sign in to Workspace' --exact
# The local Web Agent navigates this same tab to Workspace.
# If Workspace asks for login, run these three commands; skip them if consent is visible:
agent-browser find label 'Username' fill "verify-$VERIFY_UVW_RUN"
agent-browser find label 'Password' fill "$(cat "$RUN/user.pw")"
agent-browser click 'form button[type=submit]'
# Continue on the Workspace consent page:
agent-browser wait --text 'univer-workspace-harness'
agent-browser snapshot -c > "$EVIDENCE/mcp-agent-consent.txt"
agent-browser screenshot "$EVIDENCE/mcp-agent-consent.png"
agent-browser find role button click --name 'Allow' --exact
# Do not record the callback URL: it briefly holds the one-time authorization code.
agent-browser wait --url 'http://127.0.0.1:3191/' > /dev/null
```

The callback briefly shows **Workspace connected**, then returns to the Agent after its
account services are ready. A fresh profile then shows **Add an API key to get started**;
choose **Configure later**. No model credentials are needed for login or browsing.
Settings → General contains the **Workspace connection settings** region; wait for its
connected account to load and scroll the service URL into view before capturing it.

```bash
agent-browser wait --text 'Add an API key to get started'
agent-browser find role button click --name 'Configure later' --exact
agent-browser wait --text 'Files'
agent-browser find role button click --name 'Settings' --exact
agent-browser wait --text "Connected: Verify $VERIFY_UVW_RUN"
test "$(agent-browser get value 'input[type=url]')" = "$ORIGIN"
agent-browser scrollintoview 'input[type=url]'
agent-browser snapshot -c > "$EVIDENCE/mcp-agent-after-signin.txt"
agent-browser screenshot "$EVIDENCE/mcp-agent-after-signin.png"
agent-browser find role button click --name 'Close' --exact
agent-browser find role tab click --name 'Files' --exact
agent-browser wait --text 'No files'
agent-browser snapshot -c > "$EVIDENCE/mcp-agent-files.txt"
agent-browser screenshot "$EVIDENCE/mcp-agent-files.png"
# Read the run user's remotely listed Space through the Agent's picker as well:
agent-browser find role tab click --name 'Sessions' --exact
agent-browser find role button click --name 'Add workspace' --exact
agent-browser wait --text "Verify $VERIFY_UVW_RUN's Personal Space"
agent-browser snapshot -c > "$EVIDENCE/mcp-agent-space-picker.txt"
agent-browser screenshot "$EVIDENCE/mcp-agent-space-picker.png"
agent-browser find role button click --name "Verify $VERIFY_UVW_RUN's Personal Space Personal Space" --exact
# Adding a Space remounts the navigation, sometimes more than once after the tab first appears.
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  agent-browser find role tab click --name 'Files' --exact && break
  test "$attempt" -lt 10 && sleep 1
done
agent-browser find role button click --name 'Refresh files' --exact
agent-browser wait --text 'No files'
agent-browser snapshot -c > "$EVIDENCE/mcp-agent-files.txt"
agent-browser screenshot "$EVIDENCE/mcp-agent-files.png"
agent-browser eval 'location.origin === "http://127.0.0.1:3191" && location.pathname === "/" && !location.search' > "$EVIDENCE/mcp-agent-clean-url.txt"

$V down
rg -n 'token=[A-Za-z0-9]|uvw_(at|rt|pat)_[A-Za-z0-9]{8,}|workspace_session=' "$EVIDENCE"
# Expected: no matches (rg exits 1), down prints `ok    MCP resources removed`,
# and no process from this run remains in `pgrep -f start-local.mjs`.
```

Pass when every auth.md step passes, the CLI approval page shows the code uvw printed, and
`--complete` signs uvw in as the run user; the Agent stays running, its Workspace consent page
names `univer-workspace-harness`, and the Agent shows the connected run user and origin. The
Agent Space picker lists `Verify <run-id>'s Personal Space`, selecting it succeeds, and Files
refreshes that Space with `No files`. The fresh Space has no trunk files; doctor's Sheet lives
in a Worktree. The clean-URL assertion returns `true`. The three sign-in screenshots and Files evidence must
contain no tokens, authorization codes or cookies. Teardown stops the Agent and removes MCP
resources and disposable data. If Agent OAuth fails, record the exact step, screen text and
relevant server log lines as a product finding; this journey does not pass.

## Gotchas

- The MCP-mode gotchas in [MCP gateway](mcp.md#gotchas) apply.
