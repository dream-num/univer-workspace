# Agent handoff and claim

A person who opens someone else's shared file can hand it to their own AI agent. The agent connects without an
account as a guest agent, works in pull requests in its own Personal Space, and gives the person a claim link.
The person signs in, claims the agent, and from then on owns its Space, sees it under **My agents**, and decides
its pull requests. Until claimed, the agent's files carry an `Unverified agent` label and its links expire after
30 days without use.

## Sub-features

- AH1 shows `Hand to my agent` in the visitor bar's `More actions` menu, between `Remix` and `Copy link`, to
  signed-out visitors of a shared file and to signed-in readers of someone else's Personal Space file. An unclaimed
  owner adds `Unverified agent` after `By <name>`.
- AH2 opens the `Hand to my agent` dialog on its `MCP (recommended)` tab: the server URL `$ORIGIN/mcp` with
  `Copy MCP server URL`, then an English prompt that reads the file with `read` or `inspect` and `trunk: true`,
  and falls back to a copy (`pr_create`, `unit_create` with `from`, `pr_ready`, `pr_merge`, `claim`) when those
  tools are missing. A signed-out reader also sees that the agent may choose `Continue as a guest agent`.
- AH3 switches to `Command line (uvw)`: the prompt installs `univer-workspace-cli`, sets the origin, runs
  `uvw auth guest`, then `uvw read A1:J50 --unit <link> --trunk`. `Copy prompt` shows
  `Prompt copied. Paste it into your agent.`
- AH4 creates a guest agent. An MCP client whose callback is not loopback reaches the sign-in page through OAuth
  and sees the card `Give the agent its own space` with `Continue as a guest agent`; the guest is named after the
  OAuth client plus a suffix (`verify-uvw g1 · n5er`). `uvw auth guest` creates a guest named `agent` with username `agent-xxxx`
  and repository `<username>/personal`.
- AH5 mints a claim link: MCP `claim` (unclaimed agents only, listed after `share`) and `uvw claim`. For an
  unclaimed owner `share` returns `claimHint`, which points to them, and mints nothing. A link works once, within
  10 minutes.
- AH6 claims on `/claim/<code>`. Signed out: `Sign in to claim this agent` with an embedded sign-in that returns
  to the same page. Signed in as a person: `Claim <agent name>`, `@<username>`, the file count,
  `Account that will own it`, and `Claim agent`, which opens the one Team repository or Personal Space that holds the
  agent's work, or `/repositories?q=<username>` when its work is in more than one. Revisiting shows
  `<agent name> is yours`.
- AH7 handles a browser signed in as an agent: `An agent cannot claim an agent. Sign in with your own account.`
  with `Sign out and continue`, which shows the sign-in on the same page.
- AH8 shows claim errors: `This agent has already been claimed.` and
  `This claim link is not valid. Ask the agent for a new one.` (an expired link says it has expired).
- AH9 lists claimed agents in Account menu > `My agents` with `Open space` and `Stop <display name>`. `Stop` asks
  `Stop this agent?`, marks the row `Stopped`, signs the agent out, and its links answer 404 to everyone else.
- AH10 lets the claimer decide the agent's pull requests: `uvw pr list -R <agent>/personal` and MCP `pr_list`
  work, merge works, and `pr create` in the agent's Space is refused. After the claim, `share` no longer prints
  an expiry or a claim link.
- AH11 gives an MCP client on the person's computer a guest agent with no page. A browser with no session that
  opens authorize for a client with a loopback callback goes straight back to it with a code and gets no cookie.
  The code's token acts for a new guest agent named after the client, which can mint its claim link with `claim`.
  Its server instructions and `whoami` say it is a guest agent because the browser had no Workspace session. One
  address gets at most 20 such codes a minute; past that, authorize sends the client `temporarily_unavailable`.
- AH12 gives an MCP client that a signed-in person approves a new agent that person owns, by default. The consent
  page preselects `A new agent that you own` over `Yourself`. Redeeming the code creates the agent, named after the
  client, already claimed: it is listed under `My agents` and has the claimed agent's tools and instructions, with
  no `claim`. Those instructions and `whoami` name the person as its owner. Choosing `Yourself` connects as the person.
- AH13 lets a person continue an agent they own. The consent page lists up to five of their agents, most recently
  active first, and preselects the one made for a client of the same name. Continuing it creates no agent, so a
  client that connects again keeps one agent and its files.
- MH1 through MH5 cover agent principals: the unclaimed and claimed tool lists and instructions, the `claim` tool, a claimer's pull request decisions, public-Space refusals, and `unit_create` with `from`.

## How to get to it (user POV)

- Open a viewer-linked file you do not own, signed out or as another user, open `More actions` in the visitor bar
  and click `Hand to my agent`.
- An agent runs `uvw auth guest`, or connects an MCP client from a browser that is not signed in, then calls
  `claim` or `uvw claim` and gives you the link.
- Open the claim link in your browser, sign in, and click `Claim agent`. Manage agents from Account > `My agents`.

## Driving it with agent-browser and uvw

Preconditions:

- Baseline run with `$V user`.
- Each `uvw auth guest`, `$V mcp-oauth login` that submits a new agent and `$V principal` creates an agent. `up` raises the limit on
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
`gu pr ready 1 -R $A/personal` and `gu pr merge 1 -R $A/personal`. `gu share $AN --link viewer` prints an expiry
date and `To let the user keep this file, make a claim link with claim (uvw claim in the CLI) and give it to them.`
Save `gu claim --json`'s `claimUrl` outside `$EVIDENCE`.

### HO3. Visitor view (AH1-AH3)

In a separate agent-browser session (`AGENT_BROWSER_SESSION=<run>-anon`), open
`$ORIGIN/nodes/$AN`, pin the locale, reload, and wait for `canvas`. The bar shows `By agent` and
`Unverified agent`. Click `More actions`, then the menu item `Hand to my agent`
(`find role menuitem click --name "Hand to my agent" --exact`; the dialog has the same title). Read the MCP tab,
click `Command line (uvw)`, then `Copy prompt`. Screenshot both tabs and close with `Close`.

### HO4. Claim (AH6)

In that session open the claim URL: `Sign in to claim this agent`. Sign in as the run user
through the embedded form. The page shows `Claim agent` (the guest's name is `agent`), `@<A>` and `1 file`.
Click `Claim agent`; the URL becomes `/spaces/<id>`. Reopen the claim URL: `agent is yours`.

### HO5. My agents (AH9)

Set `univer-workspace-view-onboarding-complete` to `true` in that session, open `/home`,
then Account > `My agents`. The row shows `@<A>`, `Files 1`, `Open space` and `Stop <display name>`, which is
`Stop agent` for this guest.

### HO6. Decisions (AH10)

The guest opens and readies a second PR. As the run user,
`$V cli ah-pr-list pr list -R $A/personal -s all --json` lists both, `pr merge` merges the second, and
`pr create -R $A/personal` fails with
`Personal Space pull requests must target the signed-in user's own Space.`

### HO7. Errors (AH8)

Register another user in a new session (`AGENT_BROWSER_SESSION=<run>-other`): pin the locale, open `/login`, click
the `Create account` mode button, fill `Username`, `Display name` and `Password`, and submit. That user opening the
used claim URL sees `This agent has already been claimed.`; `$ORIGIN/claim/not-a-real-code` shows the not-valid text.

### HO8. Stop (AH9)

`Stop <display name>` (`Stop agent` for this guest), then `Stop` in `Stop this agent?`. The row shows `Stopped`,
`$V open-anon ah-stopped "$ORIGIN/nodes/$AN"` reports 404, and the guest's uvw session is gone.

### HO9. MCP guest and an agent-signed browser (AH4, AH7)

Mode: mcp.

`$V mcp-oauth login g1 --guest-card` registers a callback that is not loopback, saves
`g1-guest-card.png` and leaves the run browser signed in as the guest. `$V mcp --auth oauth g1-whoami whoami`
names it `verify-uvw g1 · <suffix>`. `$V mcp --auth oauth g1-claim claim '{}'` returns the link; opening it in
the run browser shows `Sign out and continue`. Click it, sign in as the run user, and claim.

### HO10. A loopback MCP client from a signed-out browser (AH11)

Mode: mcp-same-origin. Run: helper.

The client registers a loopback callback. Authorize answers it with a redirect, and redeeming the code creates the
guest. A code nobody redeems creates nothing, so the first request below only reads the redirect. The headers stay
in `home/` because they carry the code.

```bash
CB=http://127.0.0.1:61234/callback; H="$RUN/home/ho10-authorize.headers"; S=$(openssl rand -hex 16)
curl --fail-with-body -sS -o "$RUN/home/ho10-client.json" -X POST "$ORIGIN/api/auth/register" -H 'content-type: application/json' \
  -d "{\"client_name\":\"verify-uvw ho10 curl\",\"redirect_uris\":[\"$CB\"]}"
curl -sS -o /dev/null -D "$H" -G "$ORIGIN/api/auth/authorize" --data-urlencode response_type=code \
  --data-urlencode "client_id=$(jq -r .client_id "$RUN/home/ho10-client.json")" --data-urlencode "redirect_uri=$CB" \
  --data-urlencode "state=$S" --data-urlencode "resource=$MCP_URL" \
  --data-urlencode code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM --data-urlencode code_challenge_method=S256
head -1 "$H" | grep -q ' 302'
grep -q -i "^location: $CB?code=[A-Za-z0-9_-]\{32\}&iss=.*&state=$S&scope=" "$H"
test "$(grep -c -i '^set-cookie:' "$H")" = 0
rm "$H"
$V mcp-oauth login ho10 --guest
jq -e '.page == "none" and .browser_signed_in_after == false and .callback_scope == "read write publish worktree:merge" and .token.status == 200' "$EVIDENCE/ho10.json"
$V mcp --auth oauth ho10-whoami whoami
jq -e '(.subject.name | test("^verify-uvw ho10 · [a-z0-9]{4}$")) and .budget != null' "$EVIDENCE/ho10-whoami.out"
NOTICE='This connection is a guest agent, which Workspace created because the browser had no Workspace session.'
jq -e --arg n "$NOTICE" '.notice | startswith($n) and contains("sign in to Workspace in that browser and reconnect the client") and contains("claiming it with claim")' "$EVIDENCE/ho10-whoami.out"
$V mcp-instructions --auth oauth ho10-instructions
jq -e --arg n "$NOTICE" '.instructions | contains($n) and contains("Tell the user this in your first reply.")' "$EVIDENCE/ho10-instructions.out"
$V mcp-oauth exchange ho10-exchange oauth
jq -e '.body.user.kind == "agent"' "$EVIDENCE/ho10-exchange.json"
$V mcp --auth oauth ho10-claim claim '{}' > /dev/null   # stdout would put the claim code in the run log
jq -e '.claimUrl | test("/claim/[A-Za-z0-9_-]{22}$")' "$EVIDENCE/ho10-claim.out"
perl -pi -e 's{/claim/[A-Za-z0-9_-]{22}(?![A-Za-z0-9_-])}{/claim/[REDACTED]}g' "$EVIDENCE"/ho10-claim.*
```

Pass when authorize answers `302` to the loopback callback with a code and no `Set-Cookie`, the scripted client gets
its token with no page and leaves the browser with no session, `whoami` names the guest after the client with an
agent's budget, `whoami` and the server instructions both say it is a guest agent because the browser had no
Workspace session, the token exchange names a User of kind `agent`, and `claim` returns a claim link.

### HO11. One address that keeps opening authorize (AH11)

Mode: mcp-same-origin. Run: helper.

Every request here comes from `127.0.0.1`, one source. Codes from HO10 in the last minute count too, so fewer than
20 may succeed. The block waits out the minute at the end, so the next zero-click guest from this address works.

```bash
CB=http://127.0.0.1:61235/callback; H="$RUN/home/ho11-authorize.headers"; L="$RUN/home/ho11.locations"
HO11_CLIENT=$(curl --fail-with-body -sS -X POST "$ORIGIN/api/auth/register" -H 'content-type: application/json' \
  -d "{\"client_name\":\"verify-uvw ho11 curl\",\"redirect_uris\":[\"$CB\"]}" | jq -r .client_id)
ho11_authorize() {
  curl -sS -o /dev/null -D "$H" -G "$ORIGIN/api/auth/authorize" --data-urlencode response_type=code \
    --data-urlencode "client_id=$HO11_CLIENT" --data-urlencode "redirect_uri=$CB" --data-urlencode "state=$(openssl rand -hex 16)" \
    --data-urlencode "resource=$MCP_URL" --data-urlencode code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM \
    --data-urlencode code_challenge_method=S256
  grep -i '^location: ' "$H" | tr -d '\r' | sed 's/^[Ll]ocation: //'
}
for attempt in $(seq 21); do ho11_authorize >> "$L"; done
HO11_CODES=$(grep -c '[?&]code=' "$L")
echo "codes issued in 21 requests: $HO11_CODES" > "$EVIDENCE/ho11-count.txt"
test "$HO11_CODES" -le 20
tail -1 "$L" > "$EVIDENCE/ho11-refused.location"
node -e 'const u = new URL(process.argv[1]); process.exit(u.searchParams.get("error") === "temporarily_unavailable" && u.searchParams.get("error_description") === "Too many sign-ins came from this address. Try again shortly." && u.searchParams.has("code") === false ? 0 : 1)' "$(cat "$EVIDENCE/ho11-refused.location")"
sleep 61
ho11_authorize | grep -q '[?&]code='
rm "$H" "$L"
```

Pass when between 1 and 20 of the 21 requests get a code, the last one goes back to the callback with
`error=temporarily_unavailable`, the description `Too many sign-ins came from this address. Try again shortly.` and no
code, and a minute later the same address gets a code again.

### HO12. A signed-in person's default: a new agent they own (AH12)

Mode: mcp. Run: helper.

`$V mcp-oauth login` signs the run browser in as the run user and approves the consent page with what it preselects.
The second login chooses `Yourself`.

```bash
$V mcp-oauth login ho12
jq -e '.preselected == "new_agent" and .connect_as == "new_agent" and .token.status == 200' "$EVIDENCE/ho12.json"
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
jq -e '.preselected == "new_agent" and .connect_as == "self" and .token.status == 200' "$EVIDENCE/ho12-self.json"
$V mcp-oauth exchange ho12-self-exchange oauth
jq -e --arg user "verify-$VERIFY_UVW_RUN" '.body.user.kind == "human" and .body.user.username == $user' "$EVIDENCE/ho12-self-exchange.json"
```

Pass when the consent page preselects the new agent and `ho12-consent.png` shows it above `Yourself`; the token acts
for an agent named after the client that is already claimed, whose instructions are the claimed agent's and which has
no `claim` tool; `whoami` names the run user as its owner; `My agents` in `ho12-my-agents.png` lists it; and the
`Yourself` login acts for the run user.

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
jq -e '.preselected == "new_agent" and .connect_as == "new_agent" and .token.status == 200' "$EVIDENCE/ho13-first.json"
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
  jq -e --arg id "$HO13_AGENT" '.preselected == $id and .connect_as == $id and (.choices | index("new_agent")) != null and .token.status == 200' "$EVIDENCE/ho13-$attempt.json"
  $V mcp-oauth exchange "ho13-$attempt-exchange" oauth
  jq -e --arg id "$HO13_AGENT" '.body.user.id == $id and .body.user.claimed == true' "$EVIDENCE/ho13-$attempt-exchange.json"
done
$V mcp --auth oauth ho13-browse space_browse "{\"repo\":\"$HO13_REPO\"}"
jq -e '[.nodes[].name] | index("Kept sheet") != null' "$EVIDENCE/ho13-browse.out"
$V mcp --auth oauth ho13-whoami whoami
jq -e --arg user "verify-$VERIFY_UVW_RUN" --arg name "Verify $VERIFY_UVW_RUN" '.owner == {username: $user, name: $name}' "$EVIDENCE/ho13-whoami.out"
$V mcp-instructions --auth oauth ho13-instructions
jq -e --arg owner "Verify $VERIFY_UVW_RUN (@verify-$VERIFY_UVW_RUN)" '.instructions | contains("This agent belongs to \($owner) and works in its own Personal Space. It sees their files only when they are shared with it; when one of their files is not found, tell the user why. To let this client act as them, they reconnect it and choose to connect as themselves.")' "$EVIDENCE/ho13-instructions.out"
curl --fail-with-body -sS -b "$OC" "$ORIGIN/api/agents" > "$EVIDENCE/ho13-agents.json"
jq -e --arg id "$HO13_AGENT" --arg name "$HO13_NAME · " '[.agents[] | select(.displayName | startswith($name)) | .id] == [$id]' "$EVIDENCE/ho13-agents.json"
$V mcp-oauth login ho13-other --connect-as self
jq -e --arg id "$HO13_AGENT" '.preselected == "new_agent" and (.choices | index($id)) != null and .connect_as == "self" and .token.status == 200' "$EVIDENCE/ho13-other.json"
```

Pass when the second and third logins preselect the agent the first made, list `A new agent that you own` too, and
exchange to that agent; `Kept sheet`, merged by the first connection, is still in its Personal Space; the run user
owns exactly one agent named after the client; `whoami` and the server instructions name the run user as the owner;
and a client of another name lists the agent but preselects a new one. `ho13-second-consent.png` shows the agent
selected above `A new agent that you own` and `Yourself`, each agent option with the hint about its own space.

### MH1. Unclaimed agent

Mode: mcp.

Run after `user`. Claiming needs the run browser signed in as the run user; the journeys above cover the browser side.
Idempotency keys need 16 to 200 URL-safe characters, so pad them for short run IDs.

```bash
$V principal bot1                                   # username agent-xxxx; its repo is <username>/personal
$V mcp-tools --as bot1 mh-bot1
$V mcp-instructions --as bot1 mh-bot1-instructions
$V mcp --as bot1 mh-bot1-claim claim '{}'
```

`mh-bot1.out` lists 56 tools: the 49 `core` tools with `claim` right after `share`,
then `blob_upload`, `repo_create`, `repo_edit`, `repo_member_list`, `repo_member_write` and `space_node`, which an agent
gets in `core` to set up its own repository and declare its checks. A person's default list has 49 and no `claim`. The instructions say the agent
`works in its own Personal Space, where nobody else reviews or merges.` and to `merge it with pr_merge.`, and they
do not contain `guest agent`: bot1 made itself with `POST /api/agents`, so no browser sign-in created it.
`claim` returns `claimUrl` (`$ORIGIN/claim/<code>`) and `expiresAt` 10 minutes ahead; the usage event carries
`principal_kind: "agent"`. Replace the code in `mh-bot1-claim.*` after use: the evidence keeps it in plain text, and
`$V secret-check` fails on it and prints the command that replaces it.

### MH2. Claimed agent

Mode: mcp.

Open the claim URL in the run browser and click `Claim agent`. Right after, with no wait,
`$V mcp-tools --as bot1 mh-bot1-claimed` lists 55 tools (no `claim`),
and the second paragraph of the instructions starts `This connection is an agent identity that a person has claimed.`

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
with the PAT fails with `INTERACTIVE_SESSION_REQUIRED`, a message asking the user to publish it in the browser,
and `detail.url` ending in `/spaces/<id>/settings`. bot1, claimed in MH2, may publish:
the same call with `--as bot1` on `<bot1>/personal` succeeds, and `"visibility":"private"` sets it back. MH3's bot2,
unclaimed, gets `AGENT_NOT_ALLOWED` on `<bot2>/personal` (`An unclaimed agent cannot make a Space public. Keep it private, or give a person a claim link so they can claim you, which lifts this limit. Claiming also lets that person open every Space you own.`). A uvw password session is interactive and may publish.

### MH5. Copy a shared file

Mode: mcp.

The run user makes a viewer-linked Sheet `N`: `$V cli` `pr create -R verify-<run-id>/personal`, `unit create --type
sheet` (its `unit.nodeId` is `N`), `pr ready` and `pr merge` as [PR1](pull-requests.md#pr1-open-fill-ready-and-merge-a-pull-request)
does, then `$V cli mh-share share <N> --link viewer --json`. bot1 runs `pr_create` in `<bot1>/personal`, then
`unit_create` with that pull request's `worktree`, `"space":"<bot1>/personal"`, `"type":"sheet"`,
`"name":"Shared copy"` and `"from":"$ORIGIN/nodes/<N>"`. It returns `unit.change: "added"` and
`unit.name: "Shared copy"`. The same call with `"type":"doc"` fails with
`The source is a sheet file, so the copy must have type sheet.` The source's `copyCount` counts the copy only after
bot1's `pr_ready` and `pr_merge` merge its pull request.

## Gotchas

- The claim code is a one-time credential. Evidence files from `mcp ... claim` and `uvw claim` contain it
  in plain text. After use, run `$V secret-check`: it fails on each `/claim/<code>` and prints the `perl` command
  that replaces the codes.
- The product database holds claim codes as hashes, so a restart keeps them and any server replica accepts them. Each
  `claim` mints a new one; `share` never does.
- `My agents` is a menu item only for people. Its `Stop` is irreversible.
- The MCP tool lists change on the first request after the claim: unclaimed agents have `claim`, claimed agents
  do not. See [MH1 and MH2](#mh1-unclaimed-agent).
- Prompts are English whatever the interface language.
- The dialog keeps the tab you last chose until the page reloads. Click `MCP (recommended)` before reading the
  MCP tab on a second opening.
