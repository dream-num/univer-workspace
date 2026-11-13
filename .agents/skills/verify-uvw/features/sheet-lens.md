# Read Sheet Units with outline, read and find

An Agent reads a remote Sheet Unit without screenshots or statistics scripts. `uvw outline`
maps sheets, regions, tables and columns with stable refs, `outline --at <ref>` zooms in,
`uvw read` pages through a range, and `uvw find` locates cells. Every output starts with the
Unit, scope and revision, prints Lens notes as `note:` lines and ends long output with a
runnable `uvw` continuation. Other Unit types are refused and pointed to `inspect`.

## Sub-features

- SLC1 keeps `inspect` output unchanged and stamps `outline` with the revision.
- SLC2 zooms into the Orders table: 10 columns, the Amount formula pattern, its conditional
  format and the Status list validation.
- SLC3 pages a budgeted outline through its continuation without repeated refs.
- SLC4 pages `read` on the 30,000-row ledger by whole rows.
- SLC5 reads typed values through `read --json`.
- SLC6 pages `find` hits and searches formulas.
- SLC7 models the 50,000-row ledger fully under the CLI's 5,000,000-cell limit, then renders it as one
  `block` with a `note:` line once its used range passes the limit.
- SLC8 keeps the revision across repeated calls and moves it after a write.
- SLC9 reports the three Sheet Lens errors.
- SLC10 reads trunk after merge and refuses a user without access.

## How to get to it (user POV)

Sign in with `uvw auth login`, find a Sheet Unit with `uvw space browse` or the browser, then
run `uvw outline --unit <id> --trunk` (or `--worktree <id>`). `uvw outline --help`,
`uvw read --help` and `uvw find --help` say the commands are Sheet only.

## Driving it with agent-browser and uvw

Use one persistent shell per instance. Pick free ports with `lsof -nP -iTCP:<port> -sTCP:LISTEN`
and never reuse another session's run.

```bash
export VERIFY_UVW_ROOT=/tmp/verify-uvw-slc VERIFY_UVW_RUN=slc
export VERIFY_UVW_SERVER_PORT=3963 VERIFY_UVW_WEB_PORT=5963 VERIFY_UVW_MCP_PORT=3973
V=.agents/skills/verify-uvw/bin/verify-uvw
$V up && $V user && eval "$($V env)" && $V doctor
node .agents/skills/verify-uvw/bin/seed-sheets.mjs > "$EVIDENCE/slc-seed.json"
test -s "$EVIDENCE/slc-seed.json"
ids() { tail -n 1 "$EVIDENCE/slc-seed.json" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8'))['$1']"; }
W=$(ids worktree) REPO=$(ids repo) SALES=$(ids sales) L30=$(ids ledger30k) L50=$(ids ledger50k) DOC=$(ids doc)
```

Seeding takes about two and a half minutes. Record every command with
`$V cli <label> <args…>`, which writes `$EVIDENCE/<label>.out`, `.err` and the exit code.
Before you compare two outputs, check that both files are non-empty.

- SLC1. Run `inspect workbook` and `inspect range A1:C9 --worksheet name:Orders --json` on the
  sales Unit at trunk and at the PR head, then `outline` at the head. Pass when both `inspect`
  outputs are byte-identical and `outline` exits 0 with `rev=` on its first line.
- SLC2. Run `$V cli slc2-workbook outline --unit "$SALES" --worktree "$W"`. Check that its
  first line is `unit <sales-id> [worktree <worktree-id>, rev=…]`, its workbook line has
  `sheets=4`, and it includes `table "OrdersTbl" [ref=s2.t1, A1:J1001, rows=1000, via=table]`.
  Then run `$V cli slc2 outline --unit "$SALES" --worktree "$W" --at s2.t1`. Pass when the
  output has 10 `col` lines, Amount shows `f=F{r}*G{r} ×1000` and `cf="cellIs gt 3000"`, and
  Status shows `dv="list: open,shipped,returned"`.
- SLC3. Run `$V cli slc3-page-1 outline --unit "$SALES" --worktree "$W" --at s2.t1 --budget 300`.
  Follow every printed `… N more` command, replacing its leading `uvw` with
  `$V cli slc3-page-2`, then `$V cli slc3-page-3`, and so on to record each page.
  Pass when the complete chain lists all 10 `col` refs once each. A whole-workbook budget
  applies per scope, so `outline --budget 300` does not produce a continuation on this Unit.
- SLC4. `read 'Ledger!A1:J200'` on `$L30`, then run its continuation. Pass when the first page
  stops at a whole row and ends with `… N more rows: uvw read`, and the next page starts on the
  following row.
- SLC5. `read 'Summary!A3:I8' --json` on the sales Unit. Pass when every formula cell has
  `type`, `value`, `display` and `formula`, and numeric values are JSON numbers.
- SLC6. `find returned --max 10`, follow every continuation, then `find SUMIFS --in formulas`.
  Pass when the pages total 61 hits with no repeat and the formula search hits the 16 Summary
  cells.
- SLC7. Run `outline --at s1` on `$L50` (500,010 cells). Then stretch its used range past the CLI
  daemon's 5,000,000-cell limit and run `outline` and `outline --at s1` again:

  ```bash
  $V cli slc7-full outline --unit "$L50" --worktree "$W" --at s1
  $V cli slc7-stretch execute --worktree "$W" --unit "$L50" \
    -e 'const ws = workbook.getSheetByName("Ledger"); ws.setRowCount(500001); ws.getRange("J500001").setValue("end");'
  $V cli slc7-large outline --unit "$L50" --worktree "$W"
  $V cli slc7-large-at outline --unit "$L50" --worktree "$W" --at s1
  ```

  Pass when the first output has a table with 10 `col` lines, and the last two show the sheet as
  one `block` followed by a `note:` line that says the sheet is too large and names `read` and
  `find`, all with exit 0.
- SLC8. Run `outline --at s2.t1` twice on the sales Unit, then change the Status cell:

  ```bash
  $V cli slc8-write execute --worktree "$W" --unit "$SALES" \
    -e 'workbook.getSheetByName("Orders").getRange("J2").setValue("disputed");'
  ```

  Run the outline again. Pass when the first two share `rev`, the third has `rev` one higher,
  and Status lists `disputed`.
- SLC9. `outline` on `$DOC`, `outline --at s9.t1` and `read 'Nope!A1'` on the sales Unit.
  Pass when they fail non-zero with `workspace-sheet-lens-unit-type-unsupported` (naming
  `inspect`), `workspace-sheet-lens-ref-not-found` and `workspace-sheet-lens-sheet-not-found`.
- SLC10. Merge the seeded PR using its Worktree ID as the positional PR argument:

  ```bash
  $V cli slc10-ready pr ready "$W" -R "$REPO"
  $V cli slc10-merge pr merge "$W" -R "$REPO"
  $V cli slc10-outline outline --unit "$SALES" --trunk
  $V cli slc10-read read 'Orders!A1:J2' --unit "$SALES" --trunk
  USER2_HOME="$UNIVER_HOME-second"
  USER2_NAME="verify-$VERIFY_UVW_RUN-second"
  USER2_PASSWORD=$(openssl rand -hex 16)
  curl --fail-with-body -sS -X POST "$ORIGIN/api/auth/password/register" \
    -H 'content-type: application/json' \
    -d "{\"username\":\"$USER2_NAME\",\"displayName\":\"Lens second user\",\"password\":\"$USER2_PASSWORD\"}" \
    > "$EVIDENCE/slc10-register.json"
  UNIVER_HOME="$USER2_HOME" node apps/cli/dist/main.js config set workspace.origin "$ORIGIN"
  printf '%s' "$USER2_PASSWORD" | UNIVER_HOME="$USER2_HOME" node apps/cli/dist/main.js \
    auth login --username "$USER2_NAME" --password-stdin --json
  UNIVER_HOME="$USER2_HOME" node apps/cli/dist/main.js outline --unit "$SALES" --trunk
  UNIVER_HOME="$USER2_HOME" node apps/cli/dist/main.js read 'Orders!A1:J2' --unit "$SALES" --trunk
  UNIVER_HOME="$USER2_HOME" node apps/cli/dist/main.js inspect workbook --unit "$SALES" --trunk
  ```

  Use the built CLI directly for the second user because `$V` resets `UNIVER_HOME` to the
  first user's home. Pass when the first user's first line is `unit <id> [trunk, rev=…]` and
  the second user gets the same access error from all three commands.

Terminal screenshots: open `$EVIDENCE/<label>.out` with `agent-browser` and capture it.

## Gotchas

- `uvw import` of a 2,000-row xlsx returns 500 `PayloadTooLargeError`. The seed script imports
  only the 1,000-row sales workbook and writes the ledgers with `execute`.
- Workspace does not recalculate on load. The seed script triggers calculation once. A formula
  without a cached value shows as `uncached=N` with a `note:` line.
- The shell is zsh. An unquoted `$args` does not split into words; quote arrays explicitly.
- The daemon caches per user and revision. After a rebuild, run `uvw daemon stop` so a stale
  daemon does not answer.

## MCP Sheet reading (SL2)

Start a separate instance with `VERIFY_UVW_MCP=1` and, for SLM8,
`VERIFY_UVW_MCP_SAME_ORIGIN=1`. Use the free-port recipe above, then run `$V user`,
`eval "$($V env)"` and `seed-sheets.mjs` as above. Keep `W`, `SALES`, `L50` and `DOC`
from that seed. Each call saves its result and correlated `.event.json` in `$EVIDENCE`.
The following helper prints JSON arguments without shell quoting ambiguities.

```bash
args() { node -e 'console.log(JSON.stringify({unit:process.argv[1],worktree:process.argv[2],...JSON.parse(process.argv[3]||"{}")}))' "$1" "$W" "${2:-}"; }
$V mcp-tools slm-tools
$V mcp slm-outline outline "$(args "$SALES")"
```

- SLM1. Regression against the base. In separate base and head instances, run
  `$V mcp-tools slm1-tools` and
  `$V mcp slm1-inspect inspect "$(args "$SALES" '{"target":"workbook"}')"`.
  Pass when inspect results match and only `outline`, `read` and `find` are added.
- SLM2. Run `$V mcp slm2 outline "$(args "$SALES" '{"at":"s2.t1"}')"` and
  `$V cli slm2-cli outline --unit "$SALES" --worktree "$W" --at s2.t1`.
  Pass when MCP `structuredContent.text` and the CLI text are byte-identical after
  removing their final continuation lines. Both first lines contain the same `rev=`.
- SLM3. Run `$V mcp slm3-page1 outline "$(args "$SALES" '{"at":"s2.t1","budget":300}')"`.
  Continue with the returned arguments.

  ```bash
  NEXT=$(jq -c '.structuredContent.next.arguments' "$EVIDENCE/slm3-page1.result.json")
  $V mcp slm3-page2 outline "$NEXT"
  ```

  Repeat until `next` is absent. Pass when `next.tool` is `outline`, budget and
  scope survive each call, and the complete chain lists ten distinct column refs.
- SLM4. Run `$V mcp slm4 read "$(args "$SALES" '{"range":"Summary!A3:I8","json":true}')"`.
  Pass when formula cells in `structuredContent.json` have numeric `value` fields.
- SLM5. Run `$V mcp slm5-page1 find "$(args "$SALES" '{"terms":["returned"],"max":10}')"`.
  Feed each `structuredContent.next.arguments` into `$V mcp slm5-page2 find "$NEXT"`,
  then increment the label until no next remains. Pass when there are 61 hits with no repeats.
- SLM6. Run `$V mcp slm6 outline "$(args "$DOC")"`.
  Pass when `$V mcp` exits 1 with `workspace-sheet-lens-unit-type-unsupported`, its
  message names `inspect`, and the event has `outcome: tool_error`.
- SLM7. Use a Team Space with a space-visible Worktree. A public Personal Space
  does not grant another user Worktree access. Create and import a separate sales
  fixture so the other journeys keep their original IDs.

  ```bash
  $V cli slm7-team repo create "slm7-$VERIFY_UVW_RUN" --name 'Sheet Lens cache test' --json
  TEAM=$(jq -r '.id' "$EVIDENCE/slm7-team.out")
  $V cli slm7-pr pr create -R "$TEAM" -t 'Shared Sheet Lens fixture' --visibility space --json
  TEAM_W=$(jq -r '.id' "$EVIDENCE/slm7-pr.out")
  python3 .agents/skills/verify-uvw/bin/seed-sales.py "$EVIDENCE/slm7-sales.xlsx" 1000
  $V cli slm7-import import --worktree "$TEAM_W" --space "$TEAM" \
    --file "$EVIDENCE/slm7-sales.xlsx" --name sales.xlsx --json
  TEAM_SALES=$(jq -r '.unitId' "$EVIDENCE/slm7-import.out")
  TEAM_ARGS=$(node -e 'console.log(JSON.stringify({unit:process.argv[1],worktree:process.argv[2]}))' "$TEAM_SALES" "$TEAM_W")
  ```

  Register the second user, save its development session in a private file, and
  add it to the Team Space as a viewer. This Node command reads the first user's
  session from disk and never prints either credential.

  ```bash
  SECOND_MCP_SESSION_FILE="$UNIVER_HOME/slm7-second-session"
  node --input-type=module - "$ORIGIN" "$UNIVER_HOME" "$VERIFY_UVW_RUN" "$TEAM" "$SECOND_MCP_SESSION_FILE" <<'JS'
  import assert from 'node:assert/strict';
  import { randomBytes } from 'node:crypto';
  import { readFileSync, writeFileSync } from 'node:fs';
  const [origin, home, run, team, sessionFile] = process.argv.slice(2);
  const credentials = { username: `verify-${run}-slm7`, password: randomBytes(16).toString('hex') };
  const registered = await fetch(origin + '/api/auth/password/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...credentials, displayName: 'Sheet Lens viewer' }),
  });
  assert(registered.ok, `Registration returned ${registered.status}`);
  const { user } = await registered.json();
  const login = await fetch(origin + '/api/auth/cli/password/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credentials),
  });
  assert(login.ok, `Login returned ${login.status}`);
  const session = login.headers.getSetCookie().map(c => /^workspace_session=([^;]+)/.exec(c)?.[1]).find(Boolean);
  assert(session, 'Login must return a session cookie');
  writeFileSync(sessionFile, session, { mode: 0o600 });
  const membership = await fetch(`${origin}/api/team-spaces/${team}/members/${user.id}`, {
    method: 'PUT', headers: { 'content-type': 'application/json',
      cookie: 'workspace_session=' + readFileSync(home + '/mcp-session', 'utf8').trim() },
    body: JSON.stringify({ role: 'viewer' }),
  });
  assert(membership.ok, `Membership returned ${membership.status}`);
  JS
  $V mcp --auth dev slm7-a outline "$TEAM_ARGS"
  $V mcp --auth dev slm7-b outline "$TEAM_ARGS"
  (
    cp "$UNIVER_HOME/mcp-session" "$UNIVER_HOME/slm7-original-session"
    trap 'mv "$UNIVER_HOME/slm7-original-session" "$UNIVER_HOME/mcp-session"' EXIT
    cp "$SECOND_MCP_SESSION_FILE" "$UNIVER_HOME/mcp-session"
    $V mcp --auth dev slm7-second-user outline "$TEAM_ARGS"
  )
  ```

  Pass when all three calls exit 0, the first user's second event has `cache: hit`,
  and the second user's first has `cache: miss`. Never put either credential in evidence.
- SLM8. With the same-origin flag, start the mock provider from the skill's
  Browser Agent recipe. Script a call to `outline` with the sales Unit and Worktree.
  Open a new Agents session and send two turns. Also run `$V mcp-tools slm8-before`
  and `$V mcp-tools slm8-after` around them. Pass when the outline card displays its
  revision-stamped output and the session's request tool lists are byte-identical.
- SLM9. Run `$V mcp-token --scopes read`, then
  `$V mcp slm9-outline outline "$(args "$SALES")"`,
  `$V mcp slm9-read read "$(args "$SALES" '{"range":"Summary!A3:I8","json":true}')"`, and
  `$V mcp slm9-find find "$(args "$SALES" '{"terms":["returned"]}')"`.
  Pass when all three succeed with `outcome: ok` using the read-only PAT.
- SLM10. Run `$V mcp slm10 outline "$(args "$L50")"` twice. The 50,000-row ledger (500,010
  cells) is under the executor's 1,000,000-cell limit. Pass when `text` shows a table with 10
  columns, the second event has `cache: hit`, and both have `outcome: ok`. Then stretch the
  ledger past the limit and call again:

  ```bash
  $V cli slm10-stretch execute --worktree "$W" --unit "$L50" \
    -e 'const ws = workbook.getSheetByName("Ledger"); ws.setRowCount(100001); ws.getRange("J100001").setValue("end");'
  $V mcp slm10-large outline "$(args "$L50")"
  ```

  Pass when `warnings` explains the large sheet and `text` contains a `note:` line.

Run `$V down` after the journeys, including after failures. Keep only this run's
results and redacted events. The `.event.json` cache and stage timing fields contain
no document text or arguments.
