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
- AH4 creates a guest agent. An MCP client reaching the sign-in page through OAuth sees the card
  `Give the agent its own space` with `Continue as a guest agent`; the guest is named after the OAuth client plus
  a suffix (`verify-uvw g1 · n5er`). `uvw auth guest` creates a guest named `agent` with username `agent-xxxx`
  and repository `<username>/personal`.
- AH5 mints a claim link: MCP `claim` (unclaimed agents only, listed after `share`), `uvw claim`, and the
  `claimUrl` and `claimHint` that `share` returns for an unclaimed owner. A link works once, within 10 minutes.
- AH6 claims on `/claim/<code>`. Signed out: `Sign in to claim this agent` with an embedded sign-in that returns
  to the same page. Signed in as a person: `Claim <agent name>`, `@<username>`, the file count,
  `Account that will own it`, and `Claim agent`, which opens the agent's Space. Revisiting shows
  `<agent name> is yours`.
- AH7 handles a browser signed in as an agent: `An agent cannot claim an agent. Sign in with your own account.`
  with `Sign out and continue`, which shows the sign-in on the same page.
- AH8 shows claim errors: `This agent has already been claimed.` and
  `This claim link is not valid. Ask the agent for a new one.` (an expired link says it has expired).
- AH9 lists claimed agents in Account menu > `My agents` with `Open space` and `Stop agent`. `Stop` asks
  `Stop this agent?`, marks the row `Stopped`, signs the agent out, and its links answer 404 to everyone else.
- AH10 lets the claimer decide the agent's pull requests: `uvw pr list -R <agent>/personal` and MCP `pr_list`
  work, merge works, and `pr create` in the agent's Space is refused. After the claim, `share` no longer prints
  an expiry or a claim link.
- MH1 through MH5 cover agent principals: the unclaimed and claimed tool lists and instructions, the `claim` tool, a claimer's pull request decisions, public-Space refusals, and `unit_create` with `from`.

## How to get to it (user POV)

- Open a viewer-linked file you do not own, signed out or as another user, open `More actions` in the visitor bar
  and click `Hand to my agent`.
- An agent runs `uvw auth guest`, or connects an MCP client and picks `Continue as a guest agent`, then calls
  `claim` or `uvw claim` and gives you the link.
- Open the claim link in your browser, sign in, and click `Claim agent`. Manage agents from Account > `My agents`.

## Driving it with agent-browser and uvw

Preconditions:

- Baseline run with `$V user`. The uvw path works without MCP; AH4's MCP card and AH7 need `VERIFY_UVW_MCP=1`.
- Workspace creates at most 5 agents per hour per source IP per instance. Each `uvw auth guest`,
  `$V mcp-oauth login --guest` and `$V principal` counts.
- `$V uvw` holds the run user's session and `uvw auth guest` refuses while a session is stored
  (`workspace-session-exists`), so drive the guest from its own home with the source-built CLI:
  `G=$VERIFY_UVW_ROOT/$VERIFY_UVW_RUN/home-guest; gu(){ env UNIVER_HOME=$G node apps/cli/dist/main.js "$@"; }`
  and `gu config set workspace.origin $ORIGIN`. Remove `$G` yourself after `$V down`.

- **Guest (AH4, uvw).** `gu auth guest --json` returns `agent.username` (`A`) and `repo: "<A>/personal"`.
- **Agent work and link (AH5).** As the guest: `gu pr create -R $A/personal -t Handoff --json`, then
  `gu unit create --worktree <id> --space $A/personal --type sheet --name "Handoff sheet" --json` (Node ID `AN`),
  `gu pr ready` and `gu pr merge`. `gu share $AN --link viewer` prints an expiry date and a `Claim link`, with
  `It works once, within 10 minutes.` Save `gu claim --json`'s `claimUrl` outside `$EVIDENCE`.
- **Visitor view (AH1-AH3).** In a separate agent-browser session (`AGENT_BROWSER_SESSION=<run>-anon`), open
  `$ORIGIN/nodes/$AN`, pin the locale, reload, and wait for `canvas`. The bar shows `By agent` and
  `Unverified agent`. Click `More actions`, then the menu item `Hand to my agent`
  (`find role menuitem click --name "Hand to my agent" --exact`; the dialog has the same title). Read the MCP tab,
  click `Command line (uvw)`, then `Copy prompt`. Screenshot both tabs and close with `Close`.
- **Claim (AH6).** In that session open the claim URL: `Sign in to claim this agent`. Sign in as the run user
  through the embedded form. The page shows `Claim agent` (the guest's name is `agent`), `@<A>` and `1 file`.
  Click `Claim agent`; the URL becomes `/spaces/<id>`. Reopen the claim URL: `agent is yours`.
- **My agents (AH9).** Set `univer-workspace-view-onboarding-complete` to `true` in that session, open `/home`,
  then Account > `My agents`. The row shows `@<A>`, `Files 1`, `Open space` and `Stop agent`.
- **Decisions (AH10).** The guest opens and readies a second PR. As the run user,
  `$V cli ah-pr-list pr list -R $A/personal -s all --json` lists both, `pr merge` merges the second, and
  `pr create -R $A/personal` fails with
  `Personal Space pull requests must target the signed-in user's own Space.`
- **Errors (AH8).** Another signed-in user opening the used claim URL sees `This agent has already been claimed.`;
  `$ORIGIN/claim/not-a-real-code` shows the not-valid text.
- **Stop (AH9).** `Stop agent`, then `Stop` in `Stop this agent?`. The row shows `Stopped`,
  `$V open-anon ah-stopped "$ORIGIN/nodes/$AN"` reports 404, and the guest's uvw session is gone.
- **MCP guest and an agent-signed browser (AH4, AH7).** `$V mcp-oauth login g1 --guest` saves
  `g1-guest-card.png` and leaves the run browser signed in as the guest. `$V mcp --auth oauth g1-whoami whoami`
  names it `verify-uvw g1 · <suffix>`. `$V mcp --auth oauth g1-claim claim '{}'` returns the link; opening it in
  the run browser shows `Sign out and continue`. Click it, sign in as the run user, and claim.

### MH. Agent principals, claims and public Spaces

Run on the default development stack after `user`. Each `principal` counts toward the 5 agents per hour per source IP.
Claiming needs the run browser signed in as the run user; the journeys above cover the browser side.
Idempotency keys need 16 to 200 URL-safe characters, so pad them for short run IDs.

```bash
$V principal bot1                                   # username agent-xxxx; its repo is <username>/personal
$V mcp-tools --as bot1 mh-bot1
$V mcp-instructions --as bot1 mh-bot1-instructions
$V mcp --as bot1 mh-bot1-claim claim '{}'
```

- **MH1. Unclaimed agent.** `mh-bot1.out` lists 44 tools: the 43 `core` tools, with `claim` right after `share`.
  A person's default list has 43 and no `claim`. The instructions say the agent
  `works in its own Personal Space, where nobody else reviews or merges.` and to `merge it with pr_merge.`
  `claim` returns `claimUrl` (`$ORIGIN/claim/<code>`) and `expiresAt` 10 minutes ahead; the usage event carries
  `principal_kind: "agent"`. Replace the code in `mh-bot1-claim.*` after use: the evidence keeps it in plain text.
- **MH2. Claimed agent.** Open the claim URL in the run browser and click `Claim agent`. After about 35 s the
  gateway's cache expires: `$V mcp-tools --as bot1 mh-bot1-claimed` lists 43 tools (no `claim`),
  and the second paragraph of the instructions starts `This connection is an agent identity that a person has claimed.`
- **MH3. Claimer decisions.** bot1 runs `pr_create`, `unit_create` and `pr_ready` (with `number` as a string) in
  `<bot1>/personal`. The run user's `pr_list` on that repository returns it under `prs`, and
  `$V mcp <label> pr_merge '{"repo":…,"number":…}'` merges it. The run user's `pr_create` there fails with
  `Personal Space pull requests must target the signed-in user's own Space.` A second principal cannot see the
  Space at all: its `pr_merge` answers `NOT_FOUND`, not the author refusal (see
  [pull requests](./pull-requests.md) for that refusal in a Team Space).
- **MH4. Public Spaces.** `$V mcp --toolsets core,admin <label> repo_edit '{"repo":"<O>/personal","visibility":"public"}'`
  with the PAT fails with `INTERACTIVE_SESSION_REQUIRED`, a message asking the user to publish it in the browser,
  and `detail.url` ending in `/spaces/<id>/settings`. bot1, claimed in MH2, may publish:
  the same call with `--as bot1` on `<bot1>/personal` succeeds, and `"visibility":"private"` sets it back. An unclaimed agent gets
  `AGENT_NOT_ALLOWED` (`An unclaimed agent cannot make a Space public.`). A uvw password session is interactive and may publish.
- **MH5. Copy a shared file.** With a viewer-linked Sheet `N` from another owner, bot1's `unit_create` with
  `"from":"$ORIGIN/nodes/<N>"` and `type: "sheet"` returns `unit.change: "added"`. `type: "doc"` fails with
  `The source is a sheet file, so the copy must have type sheet.` The source's `copyCount` counts the copy only
  after its pull request merges.

## Gotchas

- The claim code is a one-time credential. Evidence files from `mcp ... claim`, `share` and `uvw claim` contain it
  in plain text; `secret-check` does not look for it. Replace `/claim/<code>` in saved evidence after use.
- Claim codes live in server memory: a restart drops them. Each `claim`, and each `share` by an unclaimed owner,
  mints a new one.
- `My agents` is a menu item only for people. Its `Stop` is irreversible.
- The MCP tool lists change with the claim after the gateway's cache (about 30 s): unclaimed agents have `claim`,
  claimed agents do not. See [MH1 and MH2](#mh-agent-principals-claims-and-public-spaces).
- Prompts are English whatever the interface language.
- The dialog keeps the tab you last chose until the page reloads. Click `MCP (recommended)` before reading the
  MCP tab on a second opening.
