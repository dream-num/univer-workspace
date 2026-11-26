# MCP sign-in with OAuth

An MCP client that knows only the MCP URL signs in through the browser. It discovers the authorization server,
registers or presents a Client ID Metadata Document, and the person consents to scopes they can narrow. Tokens
are bound to the gateway, refresh and revoke as a client expects, and replays and unsafe metadata URLs are refused.

## Sub-features

- MO1 signs opencode in through browser OAuth with one MCP URL and checks scoped consent and OAuth usage events.
- MO2 drives OAuth from a script: consent without `worktree:merge`, scope refusal, no direct Workspace use, refresh, revocation, refresh-token replay, and token requests that omit `resource`.
- MO3 uses real Claude Code and VS Code CIMD documents, checks SSRF refusals and anonymous no-fetch behavior, then disables CIMD.
- MO4 registers Cursor's exact callbacks and completes consent and token redemption on its `cursor://` callback.

## How to get to it (user POV)

Add `$MCP_URL` to an MCP client such as opencode, Claude Code, VS Code or Cursor with no credentials. The client
opens the Workspace consent page in the browser, where a signed-in person connects it as an agent they own,
new or continued (preselected), or as themselves; after `Allow` it calls the gateway with its own tokens. Every
journey here proves the person, so each chooses `Yourself` explicitly. The default is covered by
[HO12](agent-handoff.md#ho12-a-signed-in-persons-default-a-new-agent-they-own-ah12) and
[HO13](agent-handoff.md#ho13-reconnecting-a-client-continues-the-agent-you-own-ah13) in agent handoff.

## Driving it with agent-browser and uvw

Mode: mcp.

Start every shell with `eval "$($V env)"`. Each `$V mcp`
call checks its usage event and credential leakage, and exit 5 fails the journey.
[MCP mode](../references/mcp-mode.md) lists the helper commands and their exit codes. Every journey here signs in through the run's browser with agent-browser, MO1 also needs opencode,
and MO3 needs outbound HTTPS. MO2 uses the Team Space:

```bash
O=verify-$VERIFY_UVW_RUN
# The Team Space that M4 in mcp.md creates; this creates it on a run that skipped M4.
$V uvw repo view "$O/verify-team" --json >/dev/null 2>&1 \
  || $V cli mcp-repo-create repo create verify-team --name "Verify Team" --json id,fullName
```

### MO1. OAuth sign-in from opencode

Run after `up` with MCP enabled and `user`.
The script uses the run's browser session and a separate opencode project with no Authorization
header, with opencode's XDG directories inside it and the run's model credential imported as stories do
(`home/opencode-credential-<integration>.json`). With no stored credential, the provider reads its key
from your shell. Raw auth output and opencode's OAuth
storage stay in a mode-0700 temporary directory under `$RUN/home`; on success or failure the script
saves only transcripts redacted by `secrets.mjs redact-sign-in` and deletes that directory. Do not run
it with shell tracing or record raw authorize or callback URLs.

```bash
.agents/skills/verify-uvw/bin/mcp-oauth-opencode.sh
```

Pass when the unauthenticated POST returns the metadata challenge, both discovery documents
match this run, opencode prints an authorize URL after client discovery or registration, and the consent page
shows all four scopes. The script chooses `Yourself`. The consent screenshot must show `worktree:merge` unchecked. The
callback grants exactly `read write publish`, auth prints `Connected to ws`, and the run exits
0 with both completed tools. Exactly two matching usage events identify this user and the
OAuth client with `auth_kind: oauth` and `outcome: ok`. Keep the redacted
`mcp-oauth-*` evidence. The script stops only the isolated service and auth process, then
removes its temporary project and credentials even if an assertion fails.

### MO2. Scripted OAuth: scope withheld, refresh and revocation

Run: helper.

Run with a full-scope default PAT, which `user` creates and each journey in
[PAT sign-in](mcp-auth.md) restores. MO1 proves a real client; this drives the same endpoints from `verify-uvw mcp-oauth`, so it needs no model and can
replay refresh and revocation. `login` registers a client (RFC 7591), opens the authorize URL with
PKCE and `resource=$MCP_URL` in the run's browser, unchecks every scope not in `--scopes`, approves,
catches the callback on a loopback port and redeems the code. Tokens stay in `home/` (mode 0600);
`<label>.json` keeps only shapes such as `<uvw_at_… 87 chars>`, and `<label>-consent.png` shows the
consent page. `mcp --auth oauth` calls the gateway with the current access token.

```bash
$V mcp-oauth login mcp-oauth2-login --connect-as self --scopes read,write,publish
jq -e '.preselected == "new_agent" and .connect_as == "self" and ([.offered[]] | all) and .submitted["worktree:merge"] == false and .callback_scope == "read write publish"
  and .token.status == 200 and .token.cache_control == "no-store" and .token.body.token_type == "Bearer" and .token.body.expires_in == 3600
  and .token.body.scope == "read write publish" and (.token.body.access_token | startswith("<uvw_at_")) and (.token.body.refresh_token | startswith("<uvw_rt_"))' "$EVIDENCE/mcp-oauth2-login.json"
CLIENT=$(jq -r '.client_id' "$EVIDENCE/mcp-oauth2-login.json")
$V mcp --auth oauth mcp-oauth2-whoami whoami
$V mcp-oauth direct mcp-oauth2-direct
$V mcp-oauth exchange mcp-oauth2-exchange oauth
jq -e --arg client "$CLIENT" '.status == 200 and .body.scope == "read write publish" and .body.subject.kind == "oauth" and .body.subject.client_id == $client
  and .body.expires_in > 0 and .body.expires_in <= 600 and .body.access_token == "[REDACTED]"' "$EVIDENCE/mcp-oauth2-exchange.json"

$V mcp --auth oauth --toolsets all mcp-oauth2-pr pr_create "{\"repo\":\"$O/verify-team\",\"title\":\"OAuth merge scope\"}"
NO=$(jq -r '.number' "$EVIDENCE/mcp-oauth2-pr.out")
WO=$(jq -r '.id' "$EVIDENCE/mcp-oauth2-pr.out")
$V mcp --auth oauth --toolsets all mcp-oauth2-unit unit_create "{\"worktree\":\"$WO\",\"space\":\"$O/verify-team\",\"type\":\"sheet\",\"name\":\"OAuth Scope\",\"idempotency_key\":\"mcp-oauth2-unit-$VERIFY_UVW_RUN\"}"
$V mcp --auth oauth --toolsets all mcp-oauth2-ready pr_ready "{\"repo\":\"$O/verify-team\",\"number\":\"$NO\"}"
$V mcp --auth oauth --toolsets all mcp-oauth2-merge pr_merge "{\"repo\":\"$O/verify-team\",\"number\":\"$NO\"}"
test $? -eq 1
jq -e '.code == "workspace-scope-required"' "$EVIDENCE/mcp-oauth2-merge.out"
jq -e --arg client "$CLIENT" '.auth_kind == "oauth" and .client_id == $client and .outcome == "tool_error" and .error_code == "workspace-scope-required"' "$EVIDENCE/mcp-oauth2-merge.event.json"
$V mcp --auth oauth --toolsets all mcp-oauth2-discard pr_discard "{\"repo\":\"$O/verify-team\",\"number\":\"$NO\"}"
test $? -eq 1
jq -e '.code == "workspace-scope-required"' "$EVIDENCE/mcp-oauth2-discard.out"
$V cli mcp-oauth2-pr-cli pr view "$NO" -R "$O/verify-team" --json
jq -e '.state == "ready"' "$EVIDENCE/mcp-oauth2-pr-cli.out"
$V mcp --toolsets all mcp-oauth2-merge-pat pr_merge "{\"repo\":\"$O/verify-team\",\"number\":\"$NO\"}"
jq -e '.state == "merged"' "$EVIDENCE/mcp-oauth2-merge-pat.out"
```

Then refresh, use the new token, and revoke it the way a client does (RFC 7009).

```bash
$V mcp-oauth refresh mcp-oauth2-refresh
jq -e '.status == 200 and .cache_control == "no-store" and .body.expires_in == 3600 and .body.scope == "read write publish"
  and (.body.refresh_token | startswith("<uvw_rt_"))' "$EVIDENCE/mcp-oauth2-refresh.json"
$V mcp --auth oauth mcp-oauth2-after-refresh repo_list
$V mcp-oauth revoke mcp-oauth2-revoke
jq -e '.status == 200' "$EVIDENCE/mcp-oauth2-revoke.json"
$V mcp --auth oauth mcp-oauth2-revoked-whoami whoami
echo $? > "$EVIDENCE/mcp-oauth2-revoked-whoami.exit-observed"
$V mcp --auth oauth mcp-oauth2-revoked-api api_find '{"terms":["setValues"],"unit":"sheet"}'
echo $? > "$EVIDENCE/mcp-oauth2-revoked-api.exit-observed"
$V mcp --auth oauth mcp-oauth2-revoked repo_list
test $? -eq 4
jq -e '.status == 401 and (.www_authenticate | contains("resource_metadata"))' "$EVIDENCE/mcp-oauth2-revoked.out"
$V mcp --auth oauth mcp-oauth2-revoked-again whoami
test $? -eq 4
$V mcp-oauth refresh mcp-oauth2-refresh-revoked
test $? -eq 1
jq -e '.status == 400 and .body.error == "invalid_grant"' "$EVIDENCE/mcp-oauth2-refresh-revoked.json"
```

Last, refresh-token replay. A rotated refresh token replayed within 60 seconds is refused but keeps
the grant, so two clients racing one refresh do not sign the user out. Replayed later, it revokes
the whole grant.

```bash
$V mcp-oauth login mcp-oauth3-login --connect-as self
jq -e '.token.body.scope == "read write publish worktree:merge"' "$EVIDENCE/mcp-oauth3-login.json"
$V mcp-oauth refresh mcp-oauth3-refresh
$V mcp-oauth reuse mcp-oauth3-reuse-grace
test $? -eq 1
jq -e '.status == 400 and .body.error == "invalid_grant"' "$EVIDENCE/mcp-oauth3-reuse-grace.json"
$V mcp --auth oauth mcp-oauth3-after-grace repo_list
sleep 61
$V mcp-oauth reuse mcp-oauth3-reuse
test $? -eq 1
jq -e '.status == 400 and .body.error == "invalid_grant"' "$EVIDENCE/mcp-oauth3-reuse.json"
$V mcp --auth oauth mcp-oauth3-after-reuse repo_list
test $? -eq 4
$V mcp-oauth refresh mcp-oauth3-refresh-after-reuse
test $? -eq 1
jq -e '.status == 400 and .body.error == "invalid_grant"' "$EVIDENCE/mcp-oauth3-refresh-after-reuse.json"
```

Some clients (QoderWork) send `resource` only in the authorization request. `--token-resource omit`
leaves it out of the token request, so the server uses the resource bound to the code or grant;
`--token-resource <url>` sends a different one. Run the wrong-resource `login` last: it spends the code.

```bash
$V mcp-oauth login mcp-oauth4-login --connect-as self --token-resource omit
jq -e '.token.status == 200 and .token.body.scope == "read write publish worktree:merge"' "$EVIDENCE/mcp-oauth4-login.json"
$V mcp --auth oauth mcp-oauth4-whoami whoami
$V mcp-oauth refresh mcp-oauth4-refresh-omit --token-resource omit
jq -e '.status == 200 and (.body.refresh_token | startswith("<uvw_rt_"))' "$EVIDENCE/mcp-oauth4-refresh-omit.json"
$V mcp --auth oauth mcp-oauth4-after-refresh repo_list
$V mcp-oauth refresh mcp-oauth4-refresh-other --token-resource http://127.0.0.1:1/mcp
test $? -eq 1
jq -e '.status == 400 and .body.error == "invalid_grant"' "$EVIDENCE/mcp-oauth4-refresh-other.json"
$V mcp-oauth refresh mcp-oauth4-refresh-kept
jq -e '.status == 200' "$EVIDENCE/mcp-oauth4-refresh-kept.json"
$V mcp-oauth login mcp-oauth4-login-other --connect-as self --token-resource http://127.0.0.1:1/mcp
test $? -eq 1
jq -e '.token.status == 400 and .token.body.error == "invalid_grant"' "$EVIDENCE/mcp-oauth4-login-other.json"
```

Pass when the consent page preselected a new agent, the login chose the run user, the page offered four checked scopes, and the token grants exactly
`read write publish` with `expires_in: 3600`, a `uvw_rt_` refresh token and `no-store`; the access
token works through the gateway (`auth_kind: oauth`, this client) but not against Workspace directly
(`direct`: both Bearer and cookie read as signed out); the exchange keeps the narrowed scopes and a
session of at most 600 seconds. With that token `pr_create`, `unit_create` and `pr_ready` succeed,
while `pr_merge` and `pr_discard` exit 1 with `workspace-scope-required`, the pull request stays
`ready`, and the full-scope PAT then merges it. Refresh returns a new pair with the same scopes,
and the new access token works. After revocation the first Workspace-backed call exits 4 with a
`resource_metadata` challenge, the following `whoami` exits 4, and the refresh token gets
`invalid_grant`. `mcp-oauth2-revoked-whoami.exit-observed` and `mcp-oauth2-revoked-api.exit-observed`
record the first `whoami` and `api_find` after revocation, before any Workspace-backed call; `0`
means the gateway answered from its 30-second exchange cache. A replay inside the grace window
gets `invalid_grant` and the grant still works; a replay after it revokes the grant, so the next
call exits 4 and the current refresh token gets `invalid_grant`. A code and a refresh token
redeemed without `resource` return 200 and the token works through the gateway; a different
`resource` gets `invalid_grant` for both, and the refused refresh leaves the grant usable.

### MO3. HTTPS Client ID Metadata Documents

Requires outbound HTTPS. Run before MO1/MO2 because step 5 starts fresh data.
The helper detects fake-IP DNS at `up`; it never exempts loopback or link-local addresses.

1. Discover support.

```bash
eval "$($V env)"
curl -fsS "$ORIGIN/.well-known/oauth-authorization-server" > "$EVIDENCE/mcp-cimd-discovery.json"
jq -e --arg issuer "$ORIGIN" '.issuer == $issuer and .client_id_metadata_document_supported == true and .authorization_response_iss_parameter_supported == true' "$EVIDENCE/mcp-cimd-discovery.json"
```

Pass when both advertised flags are true and the issuer matches the run's web origin.

2. Complete Claude Code's CIMD flow, including a real loopback callback, token exchange,
MCP use, refresh and revocation. No DCR request is made by `login --client-id`.

```bash
CLAUDE_CLIENT=https://claude.ai/oauth/claude-code-client-metadata
$V mcp-oauth login mcp-cimd-login --connect-as self --client-id "$CLAUDE_CLIENT"
jq -e --arg issuer "$ORIGIN" --arg client "$CLAUDE_CLIENT" '.client_id == $client and .client_name == "Claude Code (claude.ai)" and .callback_code_present and .callback_state_matches and .callback_iss == $issuer and .token.status == 200' "$EVIDENCE/mcp-cimd-login.json"
$V mcp --auth oauth mcp-cimd-whoami whoami
jq -e --arg client "$CLAUDE_CLIENT" '.client_id == $client and .auth_kind == "oauth" and .outcome == "ok"' "$EVIDENCE/mcp-cimd-whoami.event.json"
$V mcp-oauth refresh mcp-cimd-refresh
$V mcp --auth oauth mcp-cimd-refreshed repo_list
$V mcp-oauth revoke mcp-cimd-revoke
if $V mcp --auth oauth mcp-cimd-revoked repo_list; then false; else test $? -eq 4; fi
jq -e '.status == 401' "$EVIDENCE/mcp-cimd-revoked.out"
```

Pass when `mcp-cimd-login-consent.png` shows `Claude Code (claude.ai)`, callback code/state/issuer
checks pass, tokens are issued, `whoami` records the URL client ID, refresh and the subsequent
Workspace-backed call succeed, and the Workspace-backed call after revocation returns 401.
Tokens, codes and state stay out of evidence.

3. Open VS Code's consent page using its real metadata, whose extra `device_code` grant
must not prevent authorization.

```bash
node .agents/skills/verify-uvw/bin/mcp-cimd.mjs "$RUN" "$ORIGIN" "$MCP_URL" vscode
```

Pass when `mcp-cimd-vscode.json` records 200 and the consent text includes `vscode.dev`,
with `mcp-cimd-vscode.png` showing the consent page.

4. Refuse private addresses, malformed identity and mismatched metadata; prove that an anonymous
authorize request with a callback that is not loopback, and an anonymous consent request, never fetch. The helper exercises both IPv4/IPv6 literals, uses `localtest.me`
when it resolves to 127.0.0.1, adds a query to Claude's URL, and upper-cases the host in Claude's URL. The server fetches
the same real document for `https://CLAUDE.ai/…`, but its `client_id` is the lower-case URL, so the
error page must name the `client_id` mismatch.
If fake-IP DNS also rewrites `localtest.me`, the helper records that answer and uses
system-resolved `localhost` to exercise the same connection-level DNS refusal without
changing host DNS or introducing a test-only server resolver.

```bash
node .agents/skills/verify-uvw/bin/mcp-cimd.mjs "$RUN" "$ORIGIN" "$MCP_URL" reject
```

Pass when every `mcp-cimd-reject-*.json` records 400 with no Location and the corresponding
screenshot shows the in-place error. An anonymous authorize with a callback that is not loopback, and an
anonymous consent request with a loopback one, both return the login redirect; `mcp-cimd-anonymous.json` shows
equal before/after fetch counts. An anonymous authorize with a loopback callback is the zero-click guest path of
[HO10](agent-handoff.md#ho10-a-loopback-mcp-client-from-a-signed-out-browser-ah11), which fetches. The public-only
`mcp-cimd-fetch-events.json` preserves the fetch attempts and outcomes from the server log.

5. Disable CIMD, then restore the default before MO1, MO2 and MO4. `--reuse` only accepts
a run already torn down; evidence survives, data and credentials are fresh. Keep the launching
shell alive throughout all `up` calls so its services survive between tool calls.

```bash
$V down | tee "$EVIDENCE/mcp-cimd-enabled-down.txt"
MCP_CIMD_ENABLED=0 $V up --reuse --for mcp-oauth MO3 | tee "$EVIDENCE/mcp-cimd-disabled-up.txt"
$V user
node .agents/skills/verify-uvw/bin/mcp-cimd.mjs "$RUN" "$ORIGIN" "$MCP_URL" disabled
$V down | tee "$EVIDENCE/mcp-cimd-disabled-down.txt"
MCP_CIMD_ENABLED=1 $V up --reuse --for mcp-oauth MO3 | tee "$EVIDENCE/mcp-cimd-restored-up.txt"
$V user
$V doctor | tee "$EVIDENCE/mcp-cimd-restored-doctor.txt"
# The restored run has a new home/ and opencode directory; refresh the exported paths before later journeys.
eval "$($V env)"
```

Pass when `mcp-cimd-disabled.json` has no CIMD support flag, retains the issuer-response
flag, rejects Claude's URL as `OAUTH_CLIENT_UNAVAILABLE` with 400, and records zero fetches.
Both teardown transcripts say `ok    MCP resources removed`; restored doctor has no `FAIL`.
The optional real Claude Code `/mcp` login is supplementary and not required by MO3.

### MO4. Cursor's private-use callback

Run: helper.

Cursor registers `cursor://anysphere.cursor-mcp/oauth/callback`
next to an https and a loopback callback. Workspace accepts private-use schemes without a dot only
from a fixed allowlist (currently `cursor`), so this registers Cursor's exact list, then drives
consent with the `cursor://` callback as the run user. A browser cannot follow a `cursor://` redirect,
so `curl` sends the run's `workspace_session` from `home/mcp-session` and evidence keeps only
statuses and redacted `Location` shapes. Run after `user` with MCP enabled.

```bash
CURSOR_CB='cursor://anysphere.cursor-mcp/oauth/callback'
COOKIE="workspace_session=$(cat "$RUN/home/mcp-session")"
curl -sS -X POST "$ORIGIN/api/auth/register" -H 'content-type: application/json' \
  -d "{\"client_name\":\"Cursor\",\"redirect_uris\":[\"$CURSOR_CB\",\"https://www.cursor.com/agents/mcp/oauth/callback\",\"http://localhost:8787/callback\"]}" \
  -w '\n%{http_code}\n' > "$EVIDENCE/mcp-cursor-register.txt"
test "$(tail -n1 "$EVIDENCE/mcp-cursor-register.txt")" = 201
CURSOR_CLIENT=$(head -n1 "$EVIDENCE/mcp-cursor-register.txt" | jq -r .client_id)
head -n1 "$EVIDENCE/mcp-cursor-register.txt" | jq -e --arg cb "$CURSOR_CB" '.redirect_uris == [$cb, "https://www.cursor.com/agents/mcp/oauth/callback", "http://localhost:8787/callback"]'
curl -sS -o /dev/null -w '%{http_code}' -X POST "$ORIGIN/api/auth/register" -H 'content-type: application/json' \
  -d '{"redirect_uris":["myapp://callback"]}' > "$EVIDENCE/mcp-cursor-register-other.txt"
test "$(cat "$EVIDENCE/mcp-cursor-register-other.txt")" = 400

VERIFIER=$(openssl rand -hex 32)
CHALLENGE=$(printf %s "$VERIFIER" | openssl dgst -sha256 -binary | openssl base64 -A | tr '+/' '-_' | tr -d '=')
STATE=$(openssl rand -hex 24)
cursor_consent() {
  curl -sS -D "$RUN/home/cursor-consent.headers" -o "$RUN/home/cursor-consent.html" -H "cookie: $COOKIE" -G "$ORIGIN/api/auth/authorize/consent" \
    --data-urlencode "client_id=$CURSOR_CLIENT" --data-urlencode "redirect_uri=$CURSOR_CB" --data-urlencode response_type=code \
    --data-urlencode "code_challenge=$CHALLENGE" --data-urlencode code_challenge_method=S256 --data-urlencode "state=$STATE" \
    --data-urlencode "resource=$MCP_URL"
  grep -oE 'name="consent_token" value="[^"]+"' "$RUN/home/cursor-consent.html" | sed 's/.*value="//; s/"$//'
}
cursor_decide() {
  curl -sS -o /dev/null -D - -H "cookie: $COOKIE" -H "origin: $ORIGIN" -X POST "$ORIGIN/api/auth/authorize/consent" \
    --data-urlencode "consent_token=$1" --data-urlencode "decision=$2" "${@:3}" | tr -d '\r' | sed 's/^Location:/location:/'
}
TOKEN=$(cursor_consent)
head -n1 "$RUN/home/cursor-consent.headers" | grep -q ' 200'
grep -i '^content-security-policy:' "$RUN/home/cursor-consent.headers" | grep -q "form-action 'self' cursor:;"
grep -i '^content-security-policy:' "$RUN/home/cursor-consent.headers" > "$EVIDENCE/mcp-cursor-consent-csp.txt"
cursor_decide "$TOKEN" deny > "$RUN/home/cursor-deny.headers"
grep -i '^location:' "$RUN/home/cursor-deny.headers" | sed "s/$STATE/<state>/" > "$EVIDENCE/mcp-cursor-deny-location.txt"
ISS_ENCODED=$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$ORIGIN")
grep -qx "location: $CURSOR_CB?error=access_denied&iss=$ISS_ENCODED&state=<state>" "$EVIDENCE/mcp-cursor-deny-location.txt"

TOKEN=$(cursor_consent)
cursor_decide "$TOKEN" allow --data-urlencode connect_as=self --data-urlencode scope=read --data-urlencode scope=write --data-urlencode scope=publish --data-urlencode scope=worktree:merge \
  > "$RUN/home/cursor-approve.headers"
CODE=$(sed -n 's/^location: .*[?&]code=\([^&]*\).*/\1/p' "$RUN/home/cursor-approve.headers")
grep -i '^location:' "$RUN/home/cursor-approve.headers" | sed "s/$CODE/<code>/; s/$STATE/<state>/" > "$EVIDENCE/mcp-cursor-approve-location.txt"
grep -q "^location: $CURSOR_CB?code=<code>" "$EVIDENCE/mcp-cursor-approve-location.txt"
grep -F "&iss=$ISS_ENCODED&" "$EVIDENCE/mcp-cursor-approve-location.txt"
curl -sS -X POST "$ORIGIN/api/auth/token" -H 'content-type: application/x-www-form-urlencoded' \
  --data-urlencode grant_type=authorization_code --data-urlencode "client_id=$CURSOR_CLIENT" --data-urlencode "code=$CODE" \
  --data-urlencode "code_verifier=$VERIFIER" --data-urlencode "redirect_uri=$CURSOR_CB" --data-urlencode "resource=$MCP_URL" \
  | jq '{token_type, expires_in, scope, access: (.access_token | .[0:7]), refresh: (.refresh_token | .[0:7])}' > "$EVIDENCE/mcp-cursor-token.json"
jq -e '.token_type == "Bearer" and .expires_in == 3600 and .access == "uvw_at_" and .refresh == "uvw_rt_"' "$EVIDENCE/mcp-cursor-token.json"
rm -f "$RUN"/home/cursor-*
```

Pass when Cursor's
three callbacks register with 201 in order and `myapp://callback` gets 400; the consent page for
the `cursor://` callback returns 200 with `form-action 'self' cursor:` in its CSP; denying redirects to
`cursor://anysphere.cursor-mcp/oauth/callback?error=access_denied&iss=…&state=…`; approving redirects there
with a `code` and `iss`, and redeeming that code with the `cursor://` callback returns a one-hour `uvw_at_`
access token and a `uvw_rt_` refresh token.

## Gotchas

- The MCP-mode gotchas in [MCP gateway](mcp.md#gotchas) apply.
