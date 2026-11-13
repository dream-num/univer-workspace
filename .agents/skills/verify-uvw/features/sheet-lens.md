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
W=$(ids worktree) SALES=$(ids sales) L30=$(ids ledger30k) L50=$(ids ledger50k) DOC=$(ids doc)
```

Seeding takes about two and a half minutes. Record every command with
`$V cli <label> <args…>`, which writes `$EVIDENCE/<label>.out`, `.err` and the exit code.
Before you compare two outputs, check that both files are non-empty.

- SLC1. Run `inspect workbook` and `inspect range A1:C9 --worksheet name:Orders --json` on the
  sales Unit at trunk and at the PR head, then `outline` at the head. Pass when both `inspect`
  outputs are byte-identical and `outline` exits 0 with `rev=` on its first line.
- SLC2. `$V cli slc2 outline --unit $SALES --worktree $W --at s2.t1`. Pass when the output has
  10 `col` lines, Amount shows `f=F{r}*G{r} ×1000` and `cf="cellIs gt 3000"`, and Status shows
  `dv="list: open,shipped,returned"`.
- SLC3. `outline --budget 300` on the sales Unit, then run the printed `… N more` command.
  Pass when the second page returns the remaining nodes and no ref repeats.
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
- SLC8. `outline --at s2.t1` twice, set `Orders!J2` to `disputed` with `uvw execute`, run it
  again. Pass when the first two share `rev`, the third has `rev` one higher and Status lists
  `disputed`.
- SLC9. `outline` on `$DOC`, `outline --at s9.t1` and `read 'Nope!A1'` on the sales Unit.
  Pass when they fail non-zero with `workspace-sheet-lens-unit-type-unsupported` (naming
  `inspect`), `workspace-sheet-lens-ref-not-found` and `workspace-sheet-lens-sheet-not-found`.
- SLC10. Merge `$W` with `uvw pr ready` and `uvw pr merge`, then `outline --trunk` and
  `read --trunk` on the sales Unit. Register a second user through
  `/api/auth/password/register`, log it in with its own `UNIVER_HOME`, and run the same commands
  and `inspect workbook --trunk`. Pass when the first user's first line is
  `unit <id> [trunk, rev=…]` and the second user gets the same access error from all three.

Terminal screenshots: open `$EVIDENCE/<label>.out` with `agent-browser` and capture it.

## Gotchas

- `uvw import` of a 2,000-row xlsx returns 500 `PayloadTooLargeError`. The seed script imports
  only the 1,000-row sales workbook and writes the ledgers with `execute`.
- Workspace does not recalculate on load. The seed script triggers calculation once. A formula
  without a cached value shows as `uncached=N` with a `note:` line.
- The shell is zsh. An unquoted `$args` does not split into words; quote arrays explicitly.
- The daemon caches per user and revision. After a rebuild, run `uvw daemon stop` so a stale
  daemon does not answer.
