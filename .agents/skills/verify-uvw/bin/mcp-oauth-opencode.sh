#!/usr/bin/env bash
# MO1 in features/mcp-oauth.md: opencode signs in to the run's MCP gateway through browser OAuth.
# Run from the repository root after eval "$($V env)". Exits non-zero on the first failed check.
set -euo pipefail
BIN=$(cd "$(dirname "$0")" && pwd)
V="$BIN/verify-uvw"
: "${EVIDENCE:?run eval \"\$(\$V env)\" first}" "${MCP_URL:?start the run with VERIFY_UVW_MCP=1}"
RUN=$(dirname "$EVIDENCE")
export VERIFY_UVW_ROOT=${VERIFY_UVW_ROOT:-$(dirname "$RUN")}
umask 077
oauth_dir=$(mktemp -d "$RUN/home/opencode-oauth.XXXXXX")
auth_pid= service_configured=0

mo1_redact() { node "$BIN/secrets.mjs" redact-sign-in "$RUN" < "$1"; }
mo1_cleanup() {
  result=$?
  trap - EXIT
  set +e
  if [[ -n "$auth_pid" ]]; then
    kill "$auth_pid" 2>/dev/null
    wait "$auth_pid" 2>/dev/null
  fi
  if [[ "$service_configured" == 1 ]]; then
    (cd "$oauth_dir" && opencode service stop) >> "$oauth_dir/journey.out" 2>&1 || result=1
  fi
  for file in auth.out run.jsonl journey.out consent.snapshot.txt callback.txt authorize.txt; do
    if [[ -f "$oauth_dir/$file" ]]; then
      mo1_redact "$oauth_dir/$file" > "$EVIDENCE/mcp-oauth-$file" || result=1
    fi
  done
  rm -rf "$oauth_dir" || result=1
  exit "$result"
}
trap mo1_cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# Browser and CLI errors can include OAuth URLs, so redact the entire transcript too.
exec > "$oauth_dir/journey.out" 2>&1
export XDG_DATA_HOME="$oauth_dir/data" XDG_CONFIG_HOME="$oauth_dir/config"
export XDG_STATE_HOME="$oauth_dir/state" XDG_CACHE_HOME="$oauth_dir/cache"
mkdir -p "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_STATE_HOME" "$XDG_CACHE_HOME"
jq -n --arg url "$MCP_URL" '{mcp:{ws:{type:"remote",url:$url,enabled:true}},permission:{edit:"deny",bash:"deny",webfetch:"deny"}}' > "$oauth_dir/opencode.json"

status=$(curl -sS -D "$EVIDENCE/mcp-oauth-challenge.headers" -o "$EVIDENCE/mcp-oauth-challenge.out" \
  -w '%{http_code}' -X POST "$MCP_URL")
test "$status" = 401
metadata_url="${MCP_URL%/mcp}/.well-known/oauth-protected-resource/mcp"
grep -Fi "WWW-Authenticate: Bearer resource_metadata=\"$metadata_url\"" "$EVIDENCE/mcp-oauth-challenge.headers"
curl -fsS "$metadata_url" > "$EVIDENCE/mcp-oauth-resource.json"
jq -e --arg url "$MCP_URL" --arg origin "$ORIGIN" \
  '.resource == $url and .authorization_servers == [$origin] and .scopes_supported == ["read","write","publish","worktree:merge"]' "$EVIDENCE/mcp-oauth-resource.json"
curl -fsS "$ORIGIN/.well-known/oauth-authorization-server" > "$EVIDENCE/mcp-oauth-server.json"
jq -e --arg origin "$ORIGIN" \
  '.issuer == $origin and .authorization_endpoint == ($origin + "/api/auth/authorize") and (.registration_endpoint | type == "string" and startswith($origin + "/"))' "$EVIDENCE/mcp-oauth-server.json"

service_port=$(node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
(cd "$oauth_dir" && opencode service set port "$service_port")
service_configured=1
(cd "$oauth_dir" && exec opencode mcp auth ws --print-logs < /dev/null) > "$oauth_dir/auth.out" 2>&1 &
auth_pid=$!
authorize_url=
for ((i=0; i<60; i++)); do
  authorize_url=$(node -e 'const fs=require("node:fs");const t=fs.readFileSync(process.argv[1],"utf8").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,"");process.stdout.write(t.match(/http:\/\/127\.0\.0\.1:\d+\/api\/auth\/authorize\?[^\s"<>\x27]+/)?.[0]??"")' "$oauth_dir/auth.out")
  [[ -z "$authorize_url" ]] || break
  kill -0 "$auth_pid" 2>/dev/null || break
  sleep 1
done
test -n "$authorize_url"
printf '%s\n' "$authorize_url" > "$oauth_dir/authorize.txt"
client_id=$(node -e 'const u=new URL(process.argv[1]);if(u.origin!==process.argv[2]||u.pathname!=="/api/auth/authorize"||!u.searchParams.get("state")||!u.searchParams.get("client_id"))throw Error("Invalid authorize URL");const r=new URL(u.searchParams.get("redirect_uri"));if(r.origin!=="http://127.0.0.1:"+r.port||r.pathname!=="/callback")throw Error("Invalid callback URI");console.log(u.searchParams.get("client_id"))' "$authorize_url" "$ORIGIN")
printf '%s\n' "$client_id" > "$EVIDENCE/mcp-oauth-client.id"

agent-browser cookies clear
agent-browser open "$ORIGIN/login"
agent-browser wait --load domcontentloaded
agent-browser storage local set univer-workspace-language en-US
agent-browser reload
agent-browser wait --text "Username"
agent-browser find label "Username" fill "verify-$VERIFY_UVW_RUN"
agent-browser find label "Password" fill "$(cat "$RUN/user.pw")"
agent-browser click 'form button[type=submit]'
agent-browser wait --url '**/home'
agent-browser open "$authorize_url"
agent-browser wait --text 'Connect an AI assistant'
agent-browser snapshot -i -c > "$oauth_dir/consent.snapshot.txt"
for scope in read write publish worktree:merge; do
  grep -E "checkbox.*$scope" "$oauth_dir/consent.snapshot.txt"
done
grep -E 'button.*Deny' "$oauth_dir/consent.snapshot.txt"
grep -E 'checkbox.*worktree:merge.*checked=true' "$oauth_dir/consent.snapshot.txt"
agent-browser find role checkbox click --name 'worktree:merge'
agent-browser snapshot -i -c > "$oauth_dir/consent.snapshot.txt"
if grep -E 'checkbox.*worktree:merge.*checked=true' "$oauth_dir/consent.snapshot.txt"; then exit 1; fi
agent-browser screenshot "$EVIDENCE/mcp-oauth-consent.png"
agent-browser find role button click --name 'Allow' --exact
agent-browser wait --url 'http://127.0.0.1:*/callback?*'
callback_url=$(agent-browser get url)
node - "$callback_url" "$authorize_url" <<'JS'
const assert = require('node:assert/strict');
const callback = new URL(process.argv[2]), authorize = new URL(process.argv[3]);
const redirect = new URL(authorize.searchParams.get('redirect_uri'));
assert.equal(callback.origin + callback.pathname, redirect.origin + redirect.pathname);
assert.ok(callback.searchParams.get('code'), 'callback contains an authorization code');
assert.deepEqual(callback.searchParams.get('scope')?.split(' ').sort(), ['publish', 'read', 'write']);
JS
printf '%s\n' "$callback_url" > "$oauth_dir/callback.txt"
for ((i=0; i<60; i++)); do
  kill -0 "$auth_pid" 2>/dev/null || break
  sleep 1
done
if kill -0 "$auth_pid" 2>/dev/null; then echo 'OAuth auth command timed out'; exit 1; fi
auth_exit=0
wait "$auth_pid" || auth_exit=$?
auth_pid=
echo "$auth_exit" > "$EVIDENCE/mcp-oauth-auth.exit"
test "$auth_exit" = 0
mo1_redact "$oauth_dir/auth.out" > "$EVIDENCE/mcp-oauth-auth.out"
grep -q 'Connected to ws' "$EVIDENCE/mcp-oauth-auth.out"

since=$(date -u +%Y-%m-%dT%H:%M:%SZ)
run_exit=0
(cd "$oauth_dir" && opencode run --format json -m "$MCP_OPENCODE_MODEL" \
  'Using the ws MCP server, call whoami, then list my repositories with repo_list. Call each once and reply with both results. Do not call other tools.' < /dev/null) \
  > "$oauth_dir/run.jsonl" 2> "$oauth_dir/run.err" || run_exit=$?
cat "$oauth_dir/run.err"
echo "$run_exit" > "$EVIDENCE/mcp-oauth-run.exit"
test "$run_exit" = 0
mo1_redact "$oauth_dir/run.jsonl" > "$EVIDENCE/mcp-oauth-run.jsonl"
for tool in ws.whoami ws.repo_list; do
  jq -s -e --arg tool "$tool" 'any(.[]; .type == "tool_use" and any(.part.state.metadata.metadata.toolCalls[]?; .tool == $tool and .status == "completed"))' "$EVIDENCE/mcp-oauth-run.jsonl"
done
user_id=$($V uvw auth status --json | jq -er '.subject.id')
$V mcp-logs | jq -s --arg since "$since" --arg client "$client_id" \
  '[.[] | select(.event == "mcp.tool_call" and .ts >= $since and .client_id == $client and (.tool == "whoami" or .tool == "repo_list"))]' \
  > "$EVIDENCE/mcp-oauth-events.json"
jq -e --arg client "$client_id" --arg user "$user_id" \
  'length == 2 and (map(.tool) | sort) == ["repo_list","whoami"] and all(.[]; .auth_kind == "oauth" and .client_id == $client and .user_id == $user and .outcome == "ok")' \
  "$EVIDENCE/mcp-oauth-events.json"
