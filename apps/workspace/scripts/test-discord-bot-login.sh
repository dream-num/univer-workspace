#!/usr/bin/env bash

set -euo pipefail

# Required: DISCORD_BOT_API_KEY, DISCORD_USER_ID
# Optional: WORKSPACE_ORIGIN (defaults to http://127.0.0.1:3020)
workspace_origin="${WORKSPACE_ORIGIN:-http://127.0.0.1:3020}"
workspace_origin="${workspace_origin%/}"
api_key="${DISCORD_BOT_API_KEY:-}"
discord_user_id="${DISCORD_USER_ID:-}"

print_json() {
  local filename="$1"
  if command -v jq >/dev/null 2>&1; then
    jq . "${filename}"
  else
    sed -n '1,200p' "${filename}"
  fi
}

if [[ -z "${api_key}" ]]; then
  echo "DISCORD_BOT_API_KEY is required." >&2
  exit 2
fi

if [[ ! "${discord_user_id}" =~ ^[1-9][0-9]{0,19}$ ]]; then
  echo "DISCORD_USER_ID must be a Discord snowflake ID (1-20 digits)." >&2
  exit 2
fi

temporary_directory="$(mktemp -d)"
trap 'rm -rf "${temporary_directory}"' EXIT

headers_file="${temporary_directory}/headers"
body_file="${temporary_directory}/body.json"
cookie_jar="${temporary_directory}/cookies.txt"
: >"${headers_file}"
: >"${body_file}"

status="$({
  curl --silent --show-error \
    --request POST \
    --header "x-api-key: ${api_key}" \
    --header "content-type: application/json" \
    --data "{\"discordUserId\":\"${discord_user_id}\"}" \
    --dump-header "${headers_file}" \
    --cookie-jar "${cookie_jar}" \
    --output "${body_file}" \
    --write-out '%{http_code}' \
    "${workspace_origin}/api/auth/discord/bot-login"
} || true)"

echo "POST /api/auth/discord/bot-login -> HTTP ${status}"
sed -n '/^[Ss]et-[Cc]ookie:/p' "${headers_file}"
print_json "${body_file}"

if [[ ! "${status}" =~ ^2[0-9][0-9]$ ]]; then
  exit 1
fi

session_body="${temporary_directory}/session.json"
: >"${session_body}"
session_status="$({
  curl --silent --show-error \
    --cookie "${cookie_jar}" \
    --output "${session_body}" \
    --write-out '%{http_code}' \
    "${workspace_origin}/api/session"
} || true)"

echo
echo "GET /api/session -> HTTP ${session_status}"
print_json "${session_body}"

if [[ ! "${session_status}" =~ ^2[0-9][0-9]$ ]]; then
  exit 1
fi
