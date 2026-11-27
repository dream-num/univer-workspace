# Agent handoff and claim

A person who opens someone else's shared file can hand it to their own AI agent. The agent connects without an
account as a guest agent, works in pull requests in its own Personal Space, and gives the person one handoff link.
Whoever opens it sees everything the agent owns, read-only and live, without signing in. The person signs in there,
takes the agent, and from then on owns its Space, sees it under **My agents**, and decides its pull requests. Until
claimed, the agent's files carry an `Unverified agent` label, and the agent expires after 30 days without use.

## Sub-features

- AH1 shows `Hand to my agent` in the visitor bar's `More actions` menu, between `Remix` and `Copy link`, to
  signed-out visitors of a shared file and to signed-in readers of someone else's Personal Space file. An unclaimed
  owner adds `Unverified agent` after `By <name>`.
- AH2 opens the `Hand to my agent` dialog on its `MCP (recommended)` tab: the server URL `$ORIGIN/mcp` with
  `Copy MCP server URL`, then an English prompt that reads the file with `read` or `inspect` and `trunk: true`,
  and falls back to a copy (`pr_create`, `unit_create` with `from`, `pr_ready`, `pr_merge`, `claim`) when those
  tools are missing. A signed-out reader also sees that the agent's page may offer `Try without signing in`.
- AH3 switches to `Command line (uvw)`: the prompt installs `univer-workspace-cli`, sets the origin, runs
  `uvw auth guest`, then `uvw read A1:J50 --unit <link> --trunk`. `Copy prompt` shows
  `Prompt copied. Paste it into your agent.`
- AH4 creates a guest agent. An MCP client opens the connect page through OAuth, and a browser with no person
  signed in, also one that holds only an agent's cookie, sees `Sign in to connect` and `Try without signing in`.
  The trial goes straight back to the client with a code and leaves the browser's session as it was; the guest is
  named after the OAuth client plus a suffix (`verify-uvw g1 · n5er`). `uvw auth guest` creates a guest named `agent` with username `agent-xxxx`
  and repository `<username>/personal`.
- AH5 mints a handoff link: MCP `claim` (unclaimed agents only, listed in place of `share`) and `uvw claim`. The link
  works for 7 days, or until a person takes the agent. An unclaimed agent cannot turn on Link Sharing: `uvw share
  --link viewer` exits 1 with `AGENT_NOT_ALLOWED`, and `uvw share` with the link off points to the handoff link.
- AH6 takes the agent on `/claim/<code>`. Signed out: `Work from <agent name>`, `@<username>`, `Link works until`,
  each Space the agent owns with its file count and its files, and `Sign in and take it`, which goes to the sign-in
  page and returns to the same page. Signed in as a person: the same summary without the file links,
  `Account that will own it`, and `Take it`, which opens the one Team repository or Personal Space that holds the
  agent's work, or `/repositories?q=<username>` when its work is in more than one. Revisiting shows
  `<agent name> is yours`.
- AH7 handles a browser signed in as an agent: `An agent cannot take an agent. Sign in with your own account.`
  with `Sign out and continue`, which leaves the signed-out page with `Sign in and take it`.
- AH8 shows handoff errors under `Unable to open this handoff link`: `This agent already has an owner.`, which adds
  `If you took it, sign in to open its files.` and `Sign in` for a signed-out visitor, and
  `This handoff link is not valid. Ask the agent for a new one.` (an expired link says it has expired).
- AH9 lists claimed agents in Account menu > `My agents` with `Open space` and `Stop <display name>`. `Stop` asks
  `Stop this agent?`, marks the row `Stopped`, signs the agent out, and its links answer 404 to everyone else.
- AH10 lets the claimer decide the agent's pull requests: `uvw pr list -R <agent>/personal` and MCP `pr_list`
  work, merge works, and `pr create` in the agent's Space is refused. After the claim, `share` no longer prints
  an expiry or the handoff link.
- AH11 gives an MCP client a guest agent only after one click. A browser with no session that opens authorize gets
  the signed-out connect page with no code and no cookie. `Try without signing in` posts a form that answers `303` to
  the callback with a code. The code carries all four scopes when the client asked for `write`, and `read` otherwise.
  Its token acts for a new guest agent named after the client, which can mint its handoff link with `claim`. Its
  server instructions and `whoami` say it is a temporary agent that gives the user a handoff link when it is done.
  One address gets at most 20 such codes a minute; past that, the trial sends the client `temporarily_unavailable`.
- AH12 gives an MCP client that a signed-in person connects a new agent that person owns, by default. The connect
  page's main button is `Connect as a new agent`, above `Connect as myself`, and its `Let it change content` switch
  is on. Redeeming the code creates the agent, named after the client, already claimed: it is listed under
  `My agents` and has the claimed agent's tools and instructions, with no `claim`. Those instructions and `whoami`
  name the person as its owner. `Connect as myself` connects as the person.
- AH13 lets a person continue an agent they own. The connect page puts the agent made for a client of the same name
  on its main button and offers no new agent then, and lists up to five of their agents, most recently active
  first. Continuing it creates no agent, so a client that connects again keeps one agent and its files.
- AH14 previews the agent's work before anyone takes it. A browser that opened the handoff link holds its code in
  the httpOnly `workspace_handoff` cookie and, signed out, reads everything the agent owns as a viewer: its Spaces,
  its files, and an HTML View with its Sheet data, live. Nothing else reads the agent's private files, and a session
  in the browser wins over the cookie. The preview ends for every browser once a person takes the agent.
- MH1 through MH5 cover agent principals: the unclaimed and claimed tool lists and instructions, the `claim` tool, a claimer's pull request decisions, public-Space refusals, and `unit_create` with `from`.

## How to get to it (user POV)

- Open a viewer-linked file you do not own, signed out or as another user, open `More actions` in the visitor bar
  and click `Hand to my agent`.
- An agent runs `uvw auth guest`, or connects an MCP client from a browser that is not signed in through
  `Try without signing in`, then calls `claim` or `uvw claim` and gives you the link.
- Open the handoff link in your browser and look at the agent's files. Click `Sign in and take it`, sign in, and
  click `Take it`. Manage agents from Account > `My agents`.

## Driving it with agent-browser and uvw

Preconditions:

- Baseline run with `$V user`.
- Each `uvw auth guest`, `$V mcp-oauth login` that takes the trial or connects a new agent, and `$V principal` creates an agent. `up` raises the limit on
  agent creations per source IP per hour from the server's default of 5 to 100; set `VERIFY_UVW_AGENT_CREATE_LIMIT=5`
  before `up` to run with the default ([agent principals](../references/stories.md)).
- `$V uvw` holds the run user's session and `uvw auth guest` refuses while a session is stored
  (`workspace-session-exists`), so drive the guest from its own home with the source-built CLI:
  `G=$VERIFY_UVW_ROOT/$VERIFY_UVW_RUN/home-guest; gu(){ env UNIVER_HOME=$G node apps/cli/dist/main.js "$@"; }`
  and `gu config set workspace.origin $ORIGIN`. Remove `$G` yourself after `$V down`.

### HO1. Guest (AH4, uvw)

`gu auth guest --json` returns `agent.username` (`A`) and `repo: "<A>/personal"`.

### HO2. Agent work and link (AH5)

As the guest: `gu pr create -R $A/personal -t Handoff --json`, then
`gu unit create --worktree <id> --space $A/personal --type sheet --name "Handoff sheet" --json` (Node ID `AN`),
`gu pr ready 1 -R $A/personal` and `gu pr merge 1 -R $A/personal`. `gu share $AN --link viewer` exits 1 with
`AGENT_NOT_ALLOWED: An unclaimed agent cannot let more people see its work, and no person can confirm it for you. Get a handoff link with claim (uvw claim in the CLI) and give it to the user. They can open it to see your work without signing in. Once they sign in and take you, try again.`
`gu share $AN` prints `Link Sharing: off. Only this agent can open the link. To show the file to the user, give them your handoff link from claim (uvw claim in the CLI).`
`$V open-anon ah-private "$ORIGIN/nodes/$AN"` reports 404. `gu claim --json` returns `claimUrl` and an `expiresAt`
7 days ahead; save `claimUrl` outside `$EVIDENCE` as `CLAIM`. `gu claim` prints `Handoff link: <url>` and says the
link works for 7 days.

### HO3. Visitor view (AH1-AH3)

In a separate agent-browser session (`AGENT_BROWSER_SESSION=<run>-anon`), pin the locale, open `$CLAIM` so the
session holds the preview, then open `$ORIGIN/nodes/$AN` and wait for `canvas`. The bar shows `Read only`,
`By agent` and `Unverified agent`. Click `More actions`, then the menu item `Hand to my agent`
(`find role menuitem click --name "Hand to my agent" --exact`; the dialog has the same title). Read the MCP tab,
click `Command line (uvw)`, then `Copy prompt`. Screenshot both tabs and close with `Close`.

### HO4. Preview and take (AH6, AH14)

In that session open `$CLAIM`: `Work from agent` (the guest's name is `agent`), `@<A>`, `Link works until` with a
date 7 days ahead, the Personal Space row with `1 file`, the link `Handoff sheet`, and `Sign in and take it`.
Click it: the URL becomes `/login?returnTo=%2Fclaim%2F…`. Sign in as the run user; the browser returns to the
handoff page, which now shows `Account that will own it`, `The agent will belong to “<run user's name>”.` and
`Take it`, and lists the Space without the file link. Click `Take it`; the URL becomes `/spaces/<id>`. Reopen
`$CLAIM`: `agent is yours` and `Open its files`. The URL in `get url` and in screenshots of the address carries the
code, so keep both out of `$EVIDENCE` or redact them.

### HO5. My agents (AH9)

Set `univer-workspace-view-onboarding-complete` to `true` in that session, open `/home`,
then Account > `My agents`. The row shows `@<A>`, `Files 1`, `Open space` and `Stop <display name>`, which is
`Stop agent` for this guest.

### HO6. Decisions (AH10)

The guest opens and readies a second PR. As the run user,
`$V cli ah-pr-list pr list -R $A/personal -s all --json` lists both, `pr merge` merges the second, and
`pr create -R $A/personal` fails with
`Personal Space pull requests must target the signed-in user's own Space.`
`$V person ah-share share $AN --link viewer --json` turns the link of the agent's file on for its new owner, with
`link` `viewer` and no `expiresAt`, and `$V open-anon ah-shared "$ORIGIN/nodes/$AN"` then shows the Sheet.

### HO7. Errors (AH8)

Register another user in a new session (`AGENT_BROWSER_SESSION=<run>-other`): pin the locale, open `/login`, click
the `Create account` mode button, fill `Username`, `Display name` and `Password`, and submit. That user opening
`$CLAIM` sees `Unable to open this handoff link` and `This agent already has an owner.` with `Back to home` only;
`$ORIGIN/claim/not-a-real-code` shows `This handoff link is not valid. Ask the agent for a new one.` A session with
nobody signed in (`<run>-anon2`) that opens `$CLAIM` also reads `If you took it, sign in to open its files.` and
`Sign in`.

### HO8. Stop (AH9)

`Stop <display name>` (`Stop agent` for this guest), then `Stop` in `Stop this agent?`. The row shows `Stopped`,
`$V open-anon ah-stopped "$ORIGIN/nodes/$AN"` reports 404, and the guest's uvw session is gone.

### HO9. MCP guest from a browser that holds only an agent's cookie (AH4, AH7)

Mode: mcp.

`--agent-cookie` first signs the run browser in as another agent through `POST /api/auth/guest`, the call
`uvw auth guest` makes. Authorize treats that cookie as signed out, so the client reaches the signed-out connect
page. The login saves `g1-connect.png`, clicks `Try without signing in` and fails unless the browser lands on the
callback and still holds the same agent's cookie.

```bash
$V mcp-oauth login g1 --guest --agent-cookie
jq -e '.page == "signed_out" and .trial == "offered" and .browser_user_before.kind == "agent" and .browser_user_after == .browser_user_before and .token.status == 200' "$EVIDENCE/g1.json"
$V mcp --auth oauth g1-whoami whoami
jq -e '.subject.name | test("^verify-uvw g1 · [a-z0-9]{4}$")' "$EVIDENCE/g1-whoami.out"
$V mcp --auth oauth g1-claim claim '{}' > /dev/null   # stdout would put the claim code in the run log
```

Open the `claimUrl` from `g1-claim.out` in the run browser, which still holds the other agent's cookie: it shows
`An agent cannot take an agent. Sign in with your own account.` and `Sign out and continue`. Click it, then
`Sign in and take it`, sign in as the run user, and click `Take it`. Replace the code in `g1-claim.*` as
[MH1](#mh1-unclaimed-agent) says.

Pass when `g1.json` records the signed-out page, the same agent before and after and a token, `g1-connect.png` shows
`Sign in to connect` and `Try without signing in` rather than the cookie's agent, `whoami` names the guest after the
client and not after the cookie's agent, and the handoff page asks the cookie's agent to sign out before the run user
takes the guest.

### HO10. An MCP client from a signed-out browser takes the trial (AH11)

Mode: mcp-same-origin. Run: helper.

The client registers a loopback callback. Authorize answers a browser with no session with the signed-out connect
page and no code. `Try without signing in` posts the authorization to `POST /api/auth/authorize/guest`, which answers
`303` to the callback with a code, and redeeming the code creates the guest. A code nobody redeems creates nothing, so
the curl requests below only read the answers. The headers stay in `home/` because they carry the code.

```bash
CB=http://127.0.0.1:61234/callback; H="$RUN/home/ho10-authorize.headers"; P="$RUN/home/ho10-page.html"; S=$(openssl rand -hex 16)
curl --fail-with-body -sS -o "$RUN/home/ho10-client.json" -X POST "$ORIGIN/api/auth/register" -H 'content-type: application/json' \
  -d "{\"client_name\":\"verify-uvw ho10 curl\",\"redirect_uris\":[\"$CB\"]}"
HO10_QUERY=$(node -e 'console.log(new URLSearchParams({ response_type: "code", client_id: process.argv[1], redirect_uri: process.argv[2], state: process.argv[3], resource: process.argv[4], code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", code_challenge_method: "S256" }).toString())' \
  "$(jq -r .client_id "$RUN/home/ho10-client.json")" "$CB" "$S" "$MCP_URL")
curl -sS -o "$P" -D "$H" "$ORIGIN/api/auth/authorize?$HO10_QUERY"
head -1 "$H" | grep -q ' 200'
grep -q -i "^content-security-policy: .*form-action 'self' http://127.0.0.1:61234;" "$H"
test "$(grep -c -i -e '^set-cookie:' -e '^location:' "$H")" = 0
grep -q 'action="/api/auth/authorize/guest"' "$P" && grep -q 'Sign in to connect' "$P"
if grep -q 'consent_token' "$P"; then false; fi
curl -sS -o /dev/null -D "$H" -X POST "$ORIGIN/api/auth/authorize/guest" --data-urlencode "oauthAuthorization=$HO10_QUERY"
head -1 "$H" | grep -q ' 303'
grep -q -i "^location: $CB?code=[A-Za-z0-9_-]\{32\}&iss=.*&state=$S&scope=" "$H"
test "$(grep -c -i '^set-cookie:' "$H")" = 0
curl -sS -o "$P" -D "$H" -X POST "$ORIGIN/api/auth/authorize/guest" -H 'content-type: application/json' \
  -d "{\"oauthAuthorization\":\"$HO10_QUERY\"}"
head -1 "$H" | grep -q ' 400' && grep -q -i '^content-type: text/html' "$H" && grep -q 'INVALID_INPUT' "$P"
rm "$H" "$P"
$V mcp-oauth login ho10 --guest
jq -e '.page == "signed_out" and .trial == "offered" and .browser_signed_in_after == false and .callback_scope == "read write publish worktree:merge" and .token.status == 200' "$EVIDENCE/ho10.json"
$V mcp --auth oauth ho10-whoami whoami
jq -e '(.subject.name | test("^verify-uvw ho10 · [a-z0-9]{4}$")) and .budget != null' "$EVIDENCE/ho10-whoami.out"
NOTICE='You are a temporary agent. When you are done, use claim to get a handoff link for the user, who can open it to see your work and sign in to take it.'
jq -e --arg n "$NOTICE" '.notice | startswith($n) and (contains("guest agent") | not)' "$EVIDENCE/ho10-whoami.out"
$V mcp-instructions --auth oauth ho10-instructions
jq -e --arg n "$NOTICE" '.instructions | contains($n) and (contains("guest agent") | not)' "$EVIDENCE/ho10-instructions.out"
$V mcp-oauth exchange ho10-exchange oauth
jq -e '.body.user.kind == "agent"' "$EVIDENCE/ho10-exchange.json"
$V mcp --auth oauth ho10-claim claim '{}' > /dev/null   # stdout would put the claim code in the run log
jq -e '.claimUrl | test("/claim/[A-Za-z0-9_-]{22}$")' "$EVIDENCE/ho10-claim.out"
perl -pi -e 's{/claim/[A-Za-z0-9_-]{22}(?![A-Za-z0-9_-])}{/claim/[REDACTED]}g' "$EVIDENCE"/ho10-claim.*
$V mcp-oauth login ho10-read --guest --scope read
jq -e '.trial == "offered" and .callback_scope == "read" and .token.body.scope == "read"' "$EVIDENCE/ho10-read.json"
$V mcp --auth oauth ho10-read-whoami whoami
jq -e '.notice == null' "$EVIDENCE/ho10-read-whoami.out"
```

Pass when authorize answers the signed-out browser `200` with the connect page, a CSP whose `form-action` names the
callback, no code, no consent token, no `Location` and no `Set-Cookie`; the trial form answers `303` to the callback
with a code for all four scopes and no `Set-Cookie`, and a JSON body gets a `400` HTML page; the scripted client gets
its token through `Try without signing in` and leaves the browser with no session; `whoami` names the guest after the
client with an agent's budget; `whoami` and the server instructions both carry the temporary agent sentence and
neither says `guest agent`; the token exchange names a User of kind `agent`; `claim` returns a handoff link; and a
request without `write` gets a guest with `read` only, whose `whoami` has no notice and whose
`ho10-read-connect.png` promises no handoff link.

### HO11. One address that keeps taking the trial (AH11)

Mode: mcp-same-origin. Run: helper.

Every request here comes from `127.0.0.1`, one source. Codes from HO10 in the last minute count too, so fewer than
20 may succeed. The block waits out the minute at the end, so the next trial from this address works.

```bash
CB=http://127.0.0.1:61235/callback; H="$RUN/home/ho11-authorize.headers"; L="$RUN/home/ho11.locations"
HO11_CLIENT=$(curl --fail-with-body -sS -X POST "$ORIGIN/api/auth/register" -H 'content-type: application/json' \
  -d "{\"client_name\":\"verify-uvw ho11 curl\",\"redirect_uris\":[\"$CB\"]}" | jq -r .client_id)
ho11_try() {
  local query
  query=$(node -e 'console.log(new URLSearchParams({ response_type: "code", client_id: process.argv[1], redirect_uri: process.argv[2], state: process.argv[3], resource: process.argv[4], code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", code_challenge_method: "S256" }).toString())' \
    "$HO11_CLIENT" "$CB" "$(openssl rand -hex 16)" "$MCP_URL")
  curl -sS -o /dev/null -D "$H" -X POST "$ORIGIN/api/auth/authorize/guest" --data-urlencode "oauthAuthorization=$query"
  grep -i '^location: ' "$H" | tr -d '\r' | sed 's/^[Ll]ocation: //'
}
for attempt in $(seq 21); do ho11_try >> "$L"; done
HO11_CODES=$(grep -c '[?&]code=' "$L")
echo "codes issued in 21 requests: $HO11_CODES" > "$EVIDENCE/ho11-count.txt"
test "$HO11_CODES" -le 20
tail -1 "$L" > "$EVIDENCE/ho11-refused.location"
node -e 'const u = new URL(process.argv[1]); process.exit(u.searchParams.get("error") === "temporarily_unavailable" && u.searchParams.get("error_description") === "Too many sign-ins came from this address. Try again shortly." && u.searchParams.has("code") === false ? 0 : 1)' "$(cat "$EVIDENCE/ho11-refused.location")"
sleep 61
ho11_try | grep -q '[?&]code='
rm "$H" "$L"
```

Pass when between 1 and 20 of the 21 trials get a code, the last one goes back to the callback with
`error=temporarily_unavailable`, the description `Too many sign-ins came from this address. Try again shortly.` and no
code, and a minute later the same address gets a code again.

### HO12. A signed-in person's default: a new agent they own (AH12)

Mode: mcp. Run: helper.

`$V mcp-oauth login` signs the run browser in as the run user and clicks the connect page's main button, with the
content switch left on. The second login clicks `Connect as myself`.

```bash
$V mcp-oauth login ho12
jq -e '.primary == "new_agent" and .connect_as == "new_agent" and .access == {offered: "toggle", default: "read_write", submitted: "read_write"} and .callback_scope == "read write publish worktree:merge" and .token.status == 200' "$EVIDENCE/ho12.json"
$V mcp-oauth exchange ho12-exchange oauth
jq -e '.body.user.kind == "agent" and .body.user.claimed == true' "$EVIDENCE/ho12-exchange.json"
$V mcp --auth oauth ho12-whoami whoami
jq -e --arg user "verify-$VERIFY_UVW_RUN" '(.subject.name | test("^verify-uvw ho12 · [a-z0-9]{4}$")) and .budget != null and .owner.username == $user' "$EVIDENCE/ho12-whoami.out"
$V mcp-instructions --auth oauth ho12-instructions
jq -e '.instructions | contains("This connection is an agent identity that a person has claimed.")' "$EVIDENCE/ho12-instructions.out"
$V mcp --auth oauth ho12-claim claim '{}'
test $? -eq 3
grep -q 'Tool claim not found' "$EVIDENCE/ho12-claim.err"
agent-browser open "$ORIGIN/home" && agent-browser wait 1500
agent-browser storage local set univer-workspace-view-onboarding-complete true
agent-browser reload && agent-browser wait 2000
agent-browser find role button click --name Account && agent-browser wait 800
agent-browser find role menuitem click --name "My agents" && agent-browser wait 1500
agent-browser get text body | grep -F "@$(jq -r '.body.user.username' "$EVIDENCE/ho12-exchange.json")"
agent-browser screenshot "$EVIDENCE/ho12-my-agents.png"
$V mcp-oauth login ho12-self --connect-as self
jq -e '.primary == "new_agent" and .connect_as == "self" and .token.status == 200' "$EVIDENCE/ho12-self.json"
$V mcp-oauth exchange ho12-self-exchange oauth
jq -e --arg user "verify-$VERIFY_UVW_RUN" '.body.user.kind == "human" and .body.user.username == $user' "$EVIDENCE/ho12-self-exchange.json"
```

Pass when the main button connects a new agent, `ho12-connect.png` shows `Connect as a new agent` above
`Connect as myself` with `Let it change content` on and four lines of what the agent can do, and the code carries all
four scopes; the token acts
for an agent named after the client that is already claimed, whose instructions are the claimed agent's and which has
no `claim` tool; `whoami` names the run user as its owner; `My agents` in `ho12-my-agents.png` lists it; and the
`Connect as myself` login acts for the run user.

### HO13. Reconnecting a client continues the agent you own (AH13)

Mode: mcp. Run: helper.

`--client-name` registers each login's client under one name, as a client that registers again after it lost its
registration does. The run user signs in to the HTTP API with a cookie kept outside `$EVIDENCE`. The last login
connects a client of another name as the run user, so it creates no agent.

```bash
HO13_NAME="verify-uvw ho13"; OC=$RUN/home/o-cookies
curl --fail-with-body -sS -c "$OC" -o /dev/null -X POST "$ORIGIN/api/auth/password/login" -H 'content-type: application/json' \
  -d "{\"username\":\"verify-$VERIFY_UVW_RUN\",\"password\":\"$(cat "$RUN/user.pw")\"}"
$V mcp-oauth login ho13-first --client-name "$HO13_NAME"
jq -e '.primary == "new_agent" and .connect_as == "new_agent" and .token.status == 200' "$EVIDENCE/ho13-first.json"
$V mcp-oauth exchange ho13-first-exchange oauth
HO13_AGENT=$(jq -r .body.user.id "$EVIDENCE/ho13-first-exchange.json")
HO13_REPO="$(jq -r .body.user.username "$EVIDENCE/ho13-first-exchange.json")/personal"
$V mcp --auth oauth ho13-pr pr_create "{\"repo\":\"$HO13_REPO\",\"title\":\"Kept\"}"
HO13_W=$(jq -r .id "$EVIDENCE/ho13-pr.out"); HO13_N=$(jq -r .number "$EVIDENCE/ho13-pr.out")
$V mcp --auth oauth ho13-sheet unit_create "{\"worktree\":\"$HO13_W\",\"space\":\"$HO13_REPO\",\"type\":\"sheet\",\"name\":\"Kept sheet\"}"
$V mcp --auth oauth ho13-ready pr_ready "{\"repo\":\"$HO13_REPO\",\"number\":\"$HO13_N\"}"
$V mcp --auth oauth ho13-merge pr_merge "{\"repo\":\"$HO13_REPO\",\"number\":\"$HO13_N\"}"
for attempt in second third; do
  $V mcp-oauth login "ho13-$attempt" --client-name "$HO13_NAME"
  jq -e --arg id "$HO13_AGENT" '.primary == $id and .connect_as == $id and (.choices | index("new_agent")) == null and .token.status == 200' "$EVIDENCE/ho13-$attempt.json"
  $V mcp-oauth exchange "ho13-$attempt-exchange" oauth
  jq -e --arg id "$HO13_AGENT" '.body.user.id == $id and .body.user.claimed == true' "$EVIDENCE/ho13-$attempt-exchange.json"
done
$V mcp --auth oauth ho13-browse space_browse "{\"repo\":\"$HO13_REPO\"}"
jq -e '[.nodes[].name] | index("Kept sheet") != null' "$EVIDENCE/ho13-browse.out"
$V mcp --auth oauth ho13-whoami whoami
jq -e --arg user "verify-$VERIFY_UVW_RUN" --arg name "Verify $VERIFY_UVW_RUN" '.owner == {username: $user, name: $name}' "$EVIDENCE/ho13-whoami.out"
$V mcp-instructions --auth oauth ho13-instructions
jq -e --arg owner "Verify $VERIFY_UVW_RUN (@verify-$VERIFY_UVW_RUN)" '.instructions | contains("This agent belongs to \($owner) and works in its own Personal Space. It sees their files only when they are shared with it; when one of their files is not found, tell the user why. They can open every repository and file this agent owns, private ones included, so to show them one, give them its link. To let this client act as them, they reconnect it and choose to connect as themselves.")' "$EVIDENCE/ho13-instructions.out"
curl --fail-with-body -sS -b "$OC" "$ORIGIN/api/agents" > "$EVIDENCE/ho13-agents.json"
jq -e --arg id "$HO13_AGENT" --arg name "$HO13_NAME · " '[.agents[] | select(.displayName | startswith($name)) | .id] == [$id]' "$EVIDENCE/ho13-agents.json"
$V mcp-oauth login ho13-other --connect-as self
jq -e --arg id "$HO13_AGENT" '.primary == "new_agent" and (.choices | index($id)) != null and .connect_as == "self" and .token.status == 200' "$EVIDENCE/ho13-other.json"
```

Pass when the second and third logins have the agent the first made on the main button, offer no new agent, and
exchange to that agent; `Kept sheet`, merged by the first connection, is still in its Personal Space; the run user
owns exactly one agent named after the client; `whoami` and the server instructions name the run user as the owner;
and a client of another name lists the agent but puts a new one on the main button. `ho13-second-connect.png` shows
`You're signed in as @<run user>. It will work as your agent <name>.`, the main button `Connect as <name>`, and
`Connect as myself`, with no new agent.

### HO14. A signed-out visitor sees a guest agent's live page, takes the agent, and the preview stops (AH14)

A second guest, driven from its own home, merges a Sheet and publishes an HTML View bound to it in its private
Personal Space, then makes its handoff link. The link and the cookie jar stay in `$RUN/home`.

```bash
G2=$VERIFY_UVW_ROOT/$VERIFY_UVW_RUN/home-guest-ho14; g2(){ env UNIVER_HOME=$G2 node apps/cli/dist/main.js "$@"; }
g2 config set workspace.origin $ORIGIN
g2 auth guest --json > "$EVIDENCE/ho14-guest.json"; B=$(jq -r .agent.username "$EVIDENCE/ho14-guest.json")
g2 pr create -R $B/personal -t Preview --json > "$EVIDENCE/ho14-pr.json"; W=$(jq -r .id "$EVIDENCE/ho14-pr.json")
g2 unit create --worktree $W --space $B/personal --type sheet --name "Preview data" --json > "$EVIDENCE/ho14-unit.json"
U=$(jq -r .unit.unitId "$EVIDENCE/ho14-unit.json"); R=$(jq -r .unit.resourceId "$EVIDENCE/ho14-unit.json")
g2 execute --worktree $W --unit $U --json -e 'const ws=workbook.getActiveSheet(); ws.getRange("A1:C2").setValues([["Item","Qty","Double"],["Rent",5,"=B2*2"]]); return {sheet:ws.getSheetId()};' > "$EVIDENCE/ho14-seed.json"
S=$(jq -r .value.sheet "$EVIDENCE/ho14-seed.json")
g2 pr ready 1 -R $B/personal --json > /dev/null; g2 pr merge 1 -R $B/personal --json > /dev/null
SPACE=$(g2 repo list --owner @me --type personal --json | jq -r '.[0].id')
printf '<!DOCTYPE html><html><head><title>Qty page</title></head><body style="background:#fff;color:#111;font:18px system-ui;padding:32px"><h1>Qty page</h1><label>Qty <input type="number" data-univer-cell-model="%s:%s:B2"></label><p>Double: <output data-univer-cell-text="%s:%s:C2">loading</output></p></body></html>\n' $U $S $U $S > "$EVIDENCE/ho14.univer.html"
g2 html-view create --file "$EVIDENCE/ho14.univer.html" --space $SPACE --name 'Qty page' --idempotency-key "ho14-$VERIFY_UVW_RUN-0001-abcdef" --json > "$EVIDENCE/ho14-page.json"
PN=$(jq -r .nodeId "$EVIDENCE/ho14-page.json"); jq -e '.repositoryVisibility == "private"' "$EVIDENCE/ho14-page.json"
g2 claim --json > "$RUN/home/ho14-claim.json"; CLAIM2=$(jq -r .claimUrl "$RUN/home/ho14-claim.json"); CODE=${CLAIM2##*/claim/}
$V open-anon ho14-private "$ORIGIN/nodes/$PN"       # 404 without the link
```

The cookie the handoff page sets reads the agent's files and writes nothing:

```bash
J=$RUN/home/ho14-jar; status(){ curl -sS -w '%{http_code}\n' "$@"; }
status -c "$J" -o "$EVIDENCE/ho14-handoff.json" "$ORIGIN/api/agents/claim?code=$CODE" | grep -qx 200
jq -e --arg b "$B" '.agent.username == $b and .claimed == false and ([.spaces[] | {type, files}] == [{type: "personal", files: 2}])' "$EVIDENCE/ho14-handoff.json"
grep -q 'HttpOnly.*workspace_handoff' "$J"
status -b "$J" -o "$EVIDENCE/ho14-node.json" "$ORIGIN/api/nodes/$PN" | grep -qx 200
status -b "$J" -o "$EVIDENCE/ho14-write.json" -X PUT -H 'content-type: application/json' -H "Origin: $ORIGIN" -d '{"enabled":true,"role":"viewer"}' "$ORIGIN/api/nodes/$PN/link-sharing" | grep -qx 401
```

Open `$CLAIM2` in two sessions with nobody signed in, `<run>-ho14-a` and `<run>-ho14-b`, after pinning the locale in
each. Do not print `get url` there: the address carries the code. Both show `Work from agent`, `@<B>`, the Personal
Space row with `2 files`, the links `Preview data` and `Qty page.univer.html`, and `Sign in and take it`. In each,
click `Qty page.univer.html` and wait about 6 s: the address ends `/nodes/$PN?view=immersive`, the bar reads
`Read only`, `By agent` and `Unverified agent`, `snapshot -i -c` shows the page's `spinbutton "Qty"` with `5`, and the
screenshot shows `Double: 10`. In session a, also open `$ORIGIN/nodes/<Preview data's node>`: the Sheet opens
`Read only` with `5` and `10` in row 2.

With both pages open, the guest changes the Sheet through a second pull request:

```bash
g2 pr create -R $B/personal -t "Qty 3" --json > "$EVIDENCE/ho14-pr2.json"; W2=$(jq -r .id "$EVIDENCE/ho14-pr2.json")
g2 unit add --worktree $W2 --resource $R --json > /dev/null
g2 execute --worktree $W2 --unit $U --json -e "workbook.getSheetBySheetId('$S').getRange('B2').setValue(3); return 1;" > /dev/null
g2 pr ready 2 -R $B/personal --json > /dev/null; g2 pr merge 2 -R $B/personal --json > /dev/null
```

Within a few seconds and with no reload, session b's page shows `3` and `Double: 6`.

In session a, open `$CLAIM2`, click `Sign in and take it`, sign in as the run user and click `Take it`; the address
becomes `/spaces/<id>`. Then the preview is over for session b and for the cookie jar:

```bash
status -b "$J" -o "$EVIDENCE/ho14-node-after.json" "$ORIGIN/api/nodes/$PN" | grep -qx 404
status -b "$J" -c "$J" -o "$EVIDENCE/ho14-handoff-after.json" "$ORIGIN/api/agents/claim?code=$CODE" | grep -qx 409
jq -e '.error.code == "AGENT_ALREADY_CLAIMED"' "$EVIDENCE/ho14-handoff-after.json"
if grep -q workspace_handoff "$J"; then false; fi
```

Reload session b's page: `Unable to open this resource`. Open `$CLAIM2` there: `Unable to open this handoff link`,
`This agent already has an owner.`, `If you took it, sign in to open its files.` and `Sign in`. Remove `$G2`
yourself after `$V down`.

Pass when the page answers 404 without the link; the handoff answer names the agent, unclaimed, with two files, and
sets an httpOnly cookie that reads the page and gets `401` on a write; both signed-out sessions list the two files
and show the page with `5` and `Double: 10` under `Unverified agent`, and the Sheet opens read-only; session b's
page turns to `3` and `Double: 6` with no reload after the guest's merge; the run user takes the agent from session
a; and after that the cookie jar gets `404` for the page and `409` for the link, which clears the cookie, session
b's reload cannot open the page, and its handoff page says the agent has an owner.

### MH1. Unclaimed agent

Mode: mcp.

Run after `user`. Taking an agent needs the run browser signed in as the run user; the journeys above cover the browser side.
Idempotency keys need 16 to 200 URL-safe characters, so pad them for short run IDs.

```bash
$V principal bot1                                   # username agent-xxxx; its repo is <username>/personal
$V mcp-tools --as bot1 mh-bot1
$V mcp-instructions --as bot1 mh-bot1-instructions
$V mcp --as bot1 mh-bot1-claim claim '{}'
```

`mh-bot1.out` lists 55 tools: the 49 `core` tools with `claim` where a person has `share`,
then `blob_upload`, `repo_create`, `repo_edit`, `repo_member_list`, `repo_member_write` and `space_node`, which an agent
gets in `core` to set up its own repository and declare its checks. A person's default list has 49, with `share` and no `claim`. The instructions say the agent
`works in its own Personal Space, where nobody else reviews or merges.` and to `merge it with pr_merge.`, and they
carry `You are a temporary agent. When you are done, use claim to get a handoff link for the user, who can open it to see your work and sign in to take it.`
and no `call share`. The `claim` description says the link works for 7 days and has no `works once`.
`claim` returns `claimUrl` (`$ORIGIN/claim/<code>`) and `expiresAt` 7 days ahead; the usage event carries
`principal_kind: "agent"`. Replace the code in `mh-bot1-claim.*` after use: the evidence keeps it in plain text, and
`$V secret-check` fails on it and prints the command that replaces it.

### MH2. Claimed agent

Mode: mcp.

Open the handoff link in the run browser and click `Take it`. Right after, with no wait,
`$V mcp-tools --as bot1 mh-bot1-claimed` lists 55 tools (`share` and no `claim`),
and the second paragraph of the instructions starts `This connection is an agent identity that a person has claimed.`
The paragraph after it says who can open everything the agent owns and ends `the server answers such a call with a
confirm link, which you give to the user.`

### MH3. Claimer decisions

Mode: mcp.

bot1 runs `pr_create`, `unit_create` and `pr_ready` (with `number` as a string) in
`<bot1>/personal`. The run user's `pr_list` on that repository returns it under `prs`, and
`$V mcp <label> pr_merge '{"repo":…,"number":…}'` merges it. The run user's `pr_create` there fails with
`Personal Space pull requests must target the signed-in user's own Space.` A second principal,
`$V principal bot2`, cannot see the Space at all: its `pr_merge` answers `NOT_FOUND`, not the author refusal (see
[pull requests](./pull-requests.md) for that refusal in a Team Space).

### MH4. Public Spaces

Mode: mcp.

`$V mcp --toolsets core,admin <label> repo_edit '{"repo":"<O>/personal","visibility":"public"}'`
with the PAT fails with `INTERACTIVE_SESSION_REQUIRED`, a message that ends with the confirm link, and `detail.url`
`$ORIGIN/confirm/public?space=<id>`. bot1, claimed in MH2, gets the same refusal with `--as bot1` on
`<bot1>/personal`, and its `repo_view` still has `publicRead: false`. Open bot1's link in the run browser, signed in
as the run user who claimed it: the page reads `Make <bot1>/personal public?` with `Now` `Private` and
`After you confirm` `Public`. Click `Confirm`, and bot1's `repo_view` has `publicRead: true`. `"visibility":"private"`
with `--as bot1` sets it back with no link. MH3's bot2, unclaimed, gets `AGENT_NOT_ALLOWED` on `<bot2>/personal` with
no `detail.url` (`An unclaimed agent cannot let more people see its work, and no person can confirm it for you. Get a handoff link with claim (uvw claim in the CLI) and give it to the user. They can open it to see your work without signing in. Once they sign in and take you, try again.`).
A uvw password session gets a confirm link too ([LS7](./link-sharing.md#ls7-public-space) uses the browser session).

### MH5. Copy a shared file

Mode: mcp.

The run user makes a viewer-linked Sheet `N`: `$V cli` `pr create -R verify-<run-id>/personal`, `unit create --type
sheet` (its `unit.nodeId` is `N`), `pr ready` and `pr merge` as [PR1](pull-requests.md#pr1-open-fill-ready-and-merge-a-pull-request)
does, then `$V person mh-share share <N> --link viewer --json`. bot1 runs `pr_create` in `<bot1>/personal`, then
`unit_create` with that pull request's `worktree`, `"space":"<bot1>/personal"`, `"type":"sheet"`,
`"name":"Shared copy"` and `"from":"$ORIGIN/nodes/<N>"`. It returns `unit.change: "added"` and
`unit.name: "Shared copy"`. The same call with `"type":"doc"` fails with
`The source is a sheet file, so the copy must have type sheet.` The source's `copyCount` counts the copy only after
bot1's `pr_ready` and `pr_merge` merge its pull request.

## Gotchas

- The handoff link's code is a credential: until a person takes the agent it reads everything the agent owns, for 7
  days. Evidence files from `mcp ... claim` and `uvw claim` contain it in plain text, and so does the address of
  the handoff page and of the sign-in page it leads to. After use, run `$V secret-check`: it fails on each
  `/claim/<code>` and on a `workspace_handoff` cookie value, and prints the `perl` command that replaces the codes.
- The product database holds the codes as hashes, so a restart keeps them and any server replica accepts them. Each
  `claim` mints a new one, and an agent keeps its 10 newest.
- A browser session holds one preview. Opening another agent's handoff link replaces it, and any session signed in
  to that browser wins over it, so use a session with nobody signed in for HO3, HO4 and HO14.
- In a preview, the bar's `Sign up free` and `Sign in` return to the file, which the signed-in person cannot open
  until they take the agent. Take the agent from the handoff page.
- `My agents` is a menu item only for people. Its `Stop` is irreversible.
- The MCP tool lists change on the first request after the claim: unclaimed agents have `claim`, claimed agents
  do not. See [MH1 and MH2](#mh1-unclaimed-agent).
- Prompts are English whatever the interface language.
- The dialog keeps the tab you last chose until the page reloads. Click `MCP (recommended)` before reading the
  MCP tab on a second opening.
