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
- SLC7 renders the 50,000-row ledger as one `block` with a `note:` line.
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
- SLC7. `outline` and `outline --at s1` on `$L50`. Pass when the sheet is one `block` followed by
  a `note:` line that says the sheet is too large and names `read` and `find`, with exit 0.
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
