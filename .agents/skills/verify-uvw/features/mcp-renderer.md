# Screenshots, PDF and lint over MCP

An agent sees a Unit through the renderer. `screenshot` returns PNG images, or download links when they are
large, `print_pdf` returns a PDF, `lint` reports layout problems in a Slide deck, and `compile_svg` measures text
with real fonts. Results match the CLI, and the renderer has no route out.

## Sub-features

- MR9 proves the renderer role: Chromium renders Latin and Chinese text legibly, the browser is reused, and the renderer has no route out.
- MR10 screenshots a Sheet with text and an image in a Worktree and on trunk against `uvw screenshot`, returns download links for a deck above 1 MiB, and rejects invalid options readably.
- MR11 prints a Doc and a Sheet with an image to PDF in a Worktree and on trunk against `uvw print-pdf`, lints a Slide deck with layout problems against `uvw lint`, and returns the CLI's rejections.
- MR12 has opencode call `screenshot` on a Sheet with text and an image, checks that the image reaches the model and that its description is right, and asks for a deck above 1 MiB to check the download links.
- MV2 compiles SVG with real fonts through the renderer against `uvw compile-svg`, applies it to a Slide, screenshots the page and times 55 text lines.

## How to get to it (user POV)

An MCP client connected to `$MCP_URL` calls `screenshot` from the default `core` toolset, and `print_pdf`, `lint`
and `compile_svg` from `files` (`?toolsets=all` on the URL), on a Unit in a pull request or on trunk. The CLI
equivalents are `uvw screenshot`, `uvw print-pdf`, `uvw lint` and `uvw compile-svg`.

## Driving it with agent-browser and uvw

Run these in an MCP-mode instance, started as in [MCP gateway](mcp.md): `VERIFY_UVW_MCP=1 $V up`,
`$V user` and a `$V doctor` with no `FAIL` lines. Start every shell with `eval "$($V env)"`. Each `$V mcp`
call checks its usage event and credential leakage, and exit 5 fails the journey.
[MCP mode](../references/mcp-mode.md) lists the helper commands and their exit codes. These journeys need the renderer, which `up` starts unless `VERIFY_UVW_MCP_RENDERER=0`.
MR12 also needs opencode.

### MR9 renderer role

The renderer starts with the other roles and sits alone with the executor on an `internal: true` compose network. `screenshot`
(MR10), `print_pdf` and `lint` (MR11) and real-font `compile_svg` (MV2) call it from a tool; drive the other operations from the executor container with `renderer-call`. Use a parallel run id when another run is active.

```bash
B=.agents/skills/verify-uvw/bin
$V doctor            # ends with the renderer checks
node $B/renderer-proof.mjs screenshot | $V renderer-call mr9-shot screenshot
node $B/renderer-proof.mjs printPdf | $V renderer-call mr9-pdf printPdf
node $B/renderer-proof.mjs measureText | $V renderer-call mr9-measure measureText
```

Pass when:

- `doctor` prints every `MCP renderer` line as `ok`, including `cannot reach the Workspace server, the gateway or the internet`.
- `$EVIDENCE/mr9-shot-view.png` shows `Hello Univer` and `你好，世界` legibly (look at it, not just its size), and
  `$EVIDENCE/mr9-pdf.pdf` has one page with both lines. Convert it with `sips -s format png` to view it on macOS.
- From the renderer container, `docker exec <project>-renderer-1 node -e "fetch('http://host.docker.internal:<server port>/api/session',{signal:AbortSignal.timeout(5000)}).then(r=>console.log('reached',r.status),e=>console.log('blocked'))"`
  and the same request to a public host both print `blocked`. Docker Desktop answers the DNS lookup with `EAI_AGAIN` and a direct connect to the host gateway times out.
- Two sequential `screenshot` calls report `runtime_cold: false` in the renderer log after the first call, and the renderer's
  `/metrics` (Bearer `home/metrics-token`, requested from the executor container) keeps `mcp_renderer_runtime_creations_total` at 1
  while `mcp_renderer_jobs_total{kind="screenshot",outcome="ok"}` grows.
- Killing the renderer's Chromium makes the next call return a retryable `workspace-renderer-failed` and the one after succeeds
  on a new runtime (`mcp_renderer_runtime_discards_total` 1).
- In the runner (`dist` start mode) there is no container boundary. The doctor prints the renderer's isolation and
  network checks as `skip`, and the `docker exec` reachability checks above do not apply; they run on the host.
  Kill only the renderer's Chromium, a child of the renderer process:
  `pkill -P "$(node .agents/skills/verify-uvw/bin/mcp-processes.mjs pid "$RUN" renderer)" chromium`. A plain
  `pkill chromium` also kills the run's agent-browser.

### MR10 screenshot tool

The `screenshot` tool loads the Unit in the executor, which inlines every image Asset, and sends only the unit to the renderer. A
Worktree Unit proves the Worktree Asset read and a trunk Unit proves the trunk Asset read. Run it after MR9's `doctor` passes and
use a parallel run id when another run is active. The fixtures come from `bin/png-fixture.mjs`: a four-colour block image, and a noise image
that PNG cannot compress so that a slide page exceeds the 1 MiB inline limit.

```bash
B=.agents/skills/verify-uvw/bin
FIX="$EVIDENCE/mr10"; mkdir -p "$FIX/deck/materials"
node $B/png-fixture.mjs "$FIX/blocks.png" 240 160 blocks
node $B/png-fixture.mjs "$FIX/deck/materials/noise1.png" 700 400 noise
node $B/png-fixture.mjs "$FIX/deck/materials/noise2.png" 700 400 noise
for n in 1 2; do printf '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"><rect width="960" height="540" fill="#ffffff"/><text x="40" y="70" font-size="40" font-family="Arial" fill="#111111">Deck page %s</text><image x="130" y="110" width="700" height="400" href="./materials/noise%s.png"/></svg>\n' $n $n > "$FIX/deck/page$n.svg"; done
O=verify-$VERIFY_UVW_RUN
$V cli mr10-repo repo view "$O/personal" --json
MR10_SPACE=$(jq -r .id "$EVIDENCE/mr10-repo.out")
$V cli mr10-pr pr create -R "$O/personal" -t 'Screenshot sheet' --json
MR10_W=$(jq -r .id "$EVIDENCE/mr10-pr.out"); MR10_N=$(jq -r .number "$EVIDENCE/mr10-pr.out")
$V cli mr10-unit unit create --worktree "$MR10_W" --space "$MR10_SPACE" --type sheet --name 'Shot sheet' --json
MR10_U=$(jq -r .unit.unitId "$EVIDENCE/mr10-unit.out")
node -e 'const fs=require("fs");const [d,o]=process.argv.slice(1);fs.writeFileSync(o,`const sheet = workbook.getActiveSheet();
sheet.getRange("A1:B3").setValues([["Region","Total"],["North",42],["South",17]]);
const image = await sheet.newOverGridImage().setSource(${JSON.stringify("data:image/png;base64,"+fs.readFileSync(d).toString("base64"))}, api.Enum.ImageSourceType.BASE64).setColumn(3).setRow(1).setWidth(240).setHeight(160).buildAsync();
sheet.insertImages([image]);
return { images: sheet.getImages().length };
`)' "$FIX/blocks.png" "$FIX/sheet-script.js"
$V cli mr10-write execute --worktree "$MR10_W" --unit "$MR10_U" --script "$FIX/sheet-script.js" --json
jq -e '.committed == true and .value.images == 1' "$EVIDENCE/mr10-write.out"

# Worktree scope: an image content block and the CLI's own capture
$V mcp --expect-event '.tool == "screenshot" and .cost.render_pages == 1 and .executor != "none"' mr10-wt screenshot "$(jq -nc --arg u "$MR10_U" --arg w "$MR10_W" '{unit:$u,worktree:$w,range:"A1:J12"}')"
jq -e '[.content[].type] == ["text","image"]' "$EVIDENCE/mr10-wt.result.json"
$V cli mr10-wt-cli screenshot --worktree "$MR10_W" --unit "$MR10_U" --range A1:J12 --out "$FIX/cli-wt" --json
magick "$FIX/cli-wt/A1-J12.png" -resize 50% "$FIX/a.png"; magick "$EVIDENCE/mr10-wt.image-1.png" -resize 50% "$FIX/b.png"
magick "$FIX/a.png" "$FIX/b.png" -background white -splice 0x6 -append "$EVIDENCE/mr10-side-by-side-worktree.png"

# Trunk scope: the same Unit after merge
$V cli mr10-ready pr ready "$MR10_N" -R "$O/personal" --json
$V cli mr10-merge pr merge "$MR10_N" -R "$O/personal" --json
$V mcp mr10-trunk screenshot "$(jq -nc --arg u "$MR10_U" '{unit:$u,trunk:true,range:"A1:J12"}')"
$V cli mr10-trunk-cli screenshot --trunk --unit "$MR10_U" --range A1:J12 --out "$FIX/cli-trunk" --json
magick "$FIX/cli-trunk/A1-J12.png" -resize 50% "$FIX/a.png"; magick "$EVIDENCE/mr10-trunk.image-1.png" -resize 50% "$FIX/b.png"
magick "$FIX/a.png" "$FIX/b.png" -background white -splice 0x6 -append "$EVIDENCE/mr10-side-by-side-trunk.png"

# A deck above 1 MiB: download links, no image blocks
$V cli mr10-pr2 pr create -R "$O/personal" -t 'Screenshot deck' --json
MR10_W2=$(jq -r .id "$EVIDENCE/mr10-pr2.out")
$V cli mr10-deck unit create --worktree "$MR10_W2" --space "$MR10_SPACE" --type slide --name 'Shot deck' --json
MR10_D=$(jq -r .unit.unitId "$EVIDENCE/mr10-deck.out")
for n in 1 2; do (V=$(realpath "$V") && cd "$FIX/deck" && $V cli mr10-svg$n compile-svg "$PWD/page$n.svg" --page $n --apply --worktree "$MR10_W2" --unit "$MR10_D" --json); done
$V mcp --expect-event '.cost.render_pages == 2 and .cost.export_bytes > 1048576' mr10-deck-shot screenshot "$(jq -nc --arg u "$MR10_D" --arg w "$MR10_W2" '{unit:$u,worktree:$w}')"
jq -e '[.content[].type] == ["text"]' "$EVIDENCE/mr10-deck-shot.result.json"
jq -e '.images | length == 2 and all(.[]; .download.url != null and .size > 1048576 / 2)' "$EVIDENCE/mr10-deck-shot.out"
curl -fsS -D "$EVIDENCE/mr10-deck-download.headers" -o "$EVIDENCE/mr10-deck-page-01.png" "$(jq -r '.images[0].download.url' "$EVIDENCE/mr10-deck-shot.out")"
grep -i '^content-type: image/png' "$EVIDENCE/mr10-deck-download.headers"
magick "$EVIDENCE/mr10-deck-page-01.png" -resize 40% "$EVIDENCE/mr10-deck-page-01-small.png"

# Invalid options come back readable, with the CLI's message
$V mcp mr10-badrange screenshot "$(jq -nc --arg u "$MR10_U" '{unit:$u,trunk:true,range:"ZZZ99:A1"}')"
test $? -eq 1
$V cli mr10-badrange-cli screenshot --trunk --unit "$MR10_U" --range ZZZ99:A1 --out "$FIX/cli-bad" --json
test "$(jq -r .message "$EVIDENCE/mr10-badrange.out")" = "$(sed 's/^INVALID_INPUT: //' "$EVIDENCE/mr10-badrange-cli.err" | head -n1)"
$V mcp mr10-baddeck screenshot "$(jq -nc --arg u "$MR10_D" --arg w "$MR10_W2" '{unit:$u,worktree:$w,range:"A1"}')"
test $? -eq 1
jq -e '.code == "workspace-argument-invalid" and .message == "--range is not supported for Slide"' "$EVIDENCE/mr10-baddeck.out"
```

Pass when:

- `mr10-wt.image-1.png` is saved from an MCP `image` block and, next to the CLI capture in `mr10-side-by-side-worktree.png` (CLI on top), shows the same
  text (`Region`, `Total`, `North`, `42`, `South`, `17`) and the same four-colour image. Look at it. The two PNGs are not byte-identical because the
  renderer runs Linux Chromium and the CLI runs the host browser.
- `mr10-side-by-side-trunk.png` shows the image again after merge, so the executor's trunk Asset reads work.
- The deck result has two download links, no `image` block, and the downloaded `mr10-deck-page-01.png` is a 1920x1080 PNG showing `Deck page 1` over noise.
  The usage event records `render_pages` 2 and `export_bytes` above 1 MiB.
- Both rejections exit 1 with their message and a `tool_error` event.

### MR11 print_pdf and lint tools

Both tools load the Unit in the executor, which inlines every image Asset, and send only the unit to the renderer. A Worktree Unit proves the
Worktree reads and a trunk Unit proves the trunk reads. Run it after MR9's `doctor` passes and use a parallel run id when another run is active.
`poppler` (`pdfinfo`, `pdftoppm`) and ImageMagick (`magick`) must be installed. The tools are in `files`, so `mcp` calls pass `--toolsets all`.

```bash
FIX="$EVIDENCE/mr11"; mkdir -p "$FIX/deck"
O=verify-$VERIFY_UVW_RUN
node .agents/skills/verify-uvw/bin/png-fixture.mjs "$FIX/blocks.png" 240 160 blocks
$V cli mr11-repo repo view "$O/personal" --json
MR11_SPACE=$(jq -r .id "$EVIDENCE/mr11-repo.out")
$V cli mr11-pr pr create -R "$O/personal" -t 'Print and lint' --json
MR11_W=$(jq -r .id "$EVIDENCE/mr11-pr.out"); MR11_N=$(jq -r .number "$EVIDENCE/mr11-pr.out")

# A multi-page Doc, a Sheet with text and an image, and a Base in one Worktree
node -e 'let s="# Quarterly report\n\n";for(let i=1;i<=90;i++)s+="Paragraph "+i+": the quick brown fox jumps over the lazy dog while the totals for region "+i+" stay near "+(40+i)+" units, repeated so that this paragraph wraps onto a second line of the page.\n\n";require("fs").writeFileSync(process.argv[1],s)' "$FIX/report.md"
$V cli mr11-doc compile-markdown "$FIX/report.md" --title 'Print doc' --apply --worktree "$MR11_W" --space "$MR11_SPACE" --idempotency-key "mr11-doc-$MR11_W" --json
MR11_DOC=$(jq -r .targetUnitId "$EVIDENCE/mr11-doc.out")
$V cli mr11-sheet unit create --worktree "$MR11_W" --space "$MR11_SPACE" --type sheet --name 'Print sheet' --json
MR11_SHEET=$(jq -r .unit.unitId "$EVIDENCE/mr11-sheet.out")
$V cli mr11-base unit create --worktree "$MR11_W" --space "$MR11_SPACE" --type base --name 'Print base' --json
MR11_BASE=$(jq -r .unit.unitId "$EVIDENCE/mr11-base.out")
node -e 'const fs=require("fs");const [d,o]=process.argv.slice(1);fs.writeFileSync(o,`const sheet = workbook.getActiveSheet();
sheet.getRange("A1:B3").setValues([["Region","Total"],["North",42],["South",17]]);
const image = await sheet.newOverGridImage().setSource(${JSON.stringify("data:image/png;base64,"+fs.readFileSync(d).toString("base64"))}, api.Enum.ImageSourceType.BASE64).setColumn(3).setRow(1).setWidth(240).setHeight(160).buildAsync();
sheet.insertImages([image]);
return { images: sheet.getImages().length };
`)' "$FIX/blocks.png" "$FIX/sheet-script.js"
$V cli mr11-write execute --worktree "$MR11_W" --unit "$MR11_SHEET" --script "$FIX/sheet-script.js" --json
jq -e '.committed == true and .value.images == 1' "$EVIDENCE/mr11-write.out"

# print_pdf against uvw print-pdf: the same page count, and a PDF that opens
mr11_print() { # <label> <unit> <scope json> <uvw scope flag...>
  local label=$1 unit=$2 scope=$3; shift 3
  $V mcp --toolsets all --expect-event '.tool == "print_pdf" and .cost.render_pages >= 1 and .cost.export_bytes > 1000' "$label" print_pdf "$(jq -nc --arg u "$unit" --argjson s "$scope" '{unit:$u}+$s')"
  curl -fsS -D "$FIX/$label.headers" -o "$FIX/$label.pdf" "$(jq -r .download.url "$EVIDENCE/$label.out")"
  grep -i '^content-type: application/pdf' "$FIX/$label.headers"
  $V cli "$label-cli" print-pdf "$FIX/$label-cli.pdf" --unit "$unit" "$@" --json
  test "$(jq .pageCount "$EVIDENCE/$label.out")" = "$(jq .pageCount "$EVIDENCE/$label-cli.out")"
  test "$(pdfinfo "$FIX/$label.pdf" | awk '/^Pages:/ {print $2}')" = "$(jq .pageCount "$EVIDENCE/$label.out")"
  pdftoppm -f 1 -l 1 -r 70 -png "$FIX/$label.pdf" "$FIX/$label-page"
  pdftoppm -f 1 -l 1 -r 70 -png "$FIX/$label-cli.pdf" "$FIX/$label-cli-page"
  magick "$FIX/$label-page-1.png" "$FIX/$label-cli-page-1.png" -background white -splice 6x0 +append "$EVIDENCE/mr11-side-by-side-$label.png"
}
mr11_print mr11-doc-wt "$MR11_DOC" "$(jq -nc --arg w "$MR11_W" '{worktree:$w}')" --worktree "$MR11_W"
mr11_print mr11-sheet-wt "$MR11_SHEET" "$(jq -nc --arg w "$MR11_W" '{worktree:$w}')" --worktree "$MR11_W"
jq -e '.unitType == "doc" and .pageCount > 1' "$EVIDENCE/mr11-doc-wt.out"
jq -e '.tool == "print_pdf" and .unit_type == "doc" and (.repo | type) == "string"' "$EVIDENCE/mr11-doc-wt.event.json"

# A Base is rejected with the CLI's message
$V mcp --toolsets all mr11-base-pdf print_pdf "$(jq -nc --arg u "$MR11_BASE" --arg w "$MR11_W" '{unit:$u,worktree:$w}')"
test $? -eq 1
$V cli mr11-base-pdf-cli print-pdf "$FIX/cli-base.pdf" --worktree "$MR11_W" --unit "$MR11_BASE" --json
test "$(jq -r '"\(.code): \(.message)"' "$EVIDENCE/mr11-base-pdf.out")" = "$(head -n1 "$EVIDENCE/mr11-base-pdf-cli.err")"
# A missing scope is rejected before any render
$V mcp --toolsets all mr11-noscope print_pdf "$(jq -nc --arg u "$MR11_DOC" '{unit:$u}')"
test $? -eq 1
jq -e '.code == "workspace-print-pdf-scope-required"' "$EVIDENCE/mr11-noscope.out"
# A key makes a retry return the first result
for i in 1 2; do $V mcp --toolsets all "mr11-idem-$i" print_pdf "$(jq -nc --arg u "$MR11_DOC" --arg w "$MR11_W" '{unit:$u,worktree:$w,idempotency_key:"mr11-print-key-0001"}')"; done
diff <(jq -S . "$EVIDENCE/mr11-idem-1.out") <(jq -S . "$EVIDENCE/mr11-idem-2.out")

# Trunk scope: the same Units after merge
$V cli mr11-ready pr ready "$MR11_N" -R "$O/personal" --json
$V cli mr11-merge pr merge "$MR11_N" -R "$O/personal" --json
mr11_print mr11-doc-trunk "$MR11_DOC" '{"trunk":true}' --trunk
mr11_print mr11-sheet-trunk "$MR11_SHEET" '{"trunk":true}' --trunk

# lint: a deck with text off the page and overlapping text
$V cli mr11-pr2 pr create -R "$O/personal" -t 'Lint deck' --json
MR11_W2=$(jq -r .id "$EVIDENCE/mr11-pr2.out")
$V cli mr11-deck unit create --worktree "$MR11_W2" --space "$MR11_SPACE" --type slide --name 'Lint deck' --json
MR11_DECK=$(jq -r .unit.unitId "$EVIDENCE/mr11-deck.out")
printf '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"><rect width="960" height="540" fill="#ffffff"/><text x="40" y="80" font-size="40" font-family="Arial" fill="#111111">Tidy title</text></svg>\n' > "$FIX/deck/page1.svg"
printf '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"><rect width="960" height="540" fill="#ffffff"/><text x="600" y="120" font-size="56" font-family="Arial" fill="#111111">This sentence runs far past the right edge of the page</text><text x="60" y="300" font-size="48" font-family="Arial" fill="#111111">Overlapping text one</text><text x="80" y="315" font-size="48" font-family="Arial" fill="#c00000">Overlapping text two</text></svg>\n' > "$FIX/deck/page2.svg"
for n in 1 2; do $V cli mr11-svg$n compile-svg "$FIX/deck/page$n.svg" --page $n --estimate-text-size --apply --worktree "$MR11_W2" --unit "$MR11_DECK" --json; done
$V cli mr11-lint-cli lint --worktree "$MR11_W2" --unit "$MR11_DECK" --json
$V mcp --toolsets all --expect-event '.tool == "lint" and .unit_type == "slide" and .cost.render_pages == 2 and .executor != "none"' mr11-lint lint "$(jq -nc --arg u "$MR11_DECK" --arg w "$MR11_W2" '{unit:$u,worktree:$w}')"
jq -e '.findings | map(.rule) | sort == ["text-off-page","text-overlaps-text"]' "$EVIDENCE/mr11-lint.out"
# Equal apart from host font metrics: compare the report identity, coverage and each finding's identity and rule
project='{kind,unitId,unitType,coverage,findings:(.findings|map({id,rule,severity,page,pageId,fingerprint}))}'
diff <(jq -S "$project" "$EVIDENCE/mr11-lint.out") <(jq -S "$project" "$EVIDENCE/mr11-lint-cli.out")
# A page selector narrows the report, and a bad one reads like uvw
$V mcp --toolsets all mr11-lint-p2 lint "$(jq -nc --arg u "$MR11_DECK" --arg w "$MR11_W2" '{unit:$u,worktree:$w,pages:"2"}')"
$V cli mr11-lint-p2-cli lint --worktree "$MR11_W2" --unit "$MR11_DECK" --pages 2 --json
diff <(jq -S "$project" "$EVIDENCE/mr11-lint-p2.out") <(jq -S "$project" "$EVIDENCE/mr11-lint-p2-cli.out")
jq -e '.coverage.pages | length == 1' "$EVIDENCE/mr11-lint-p2.out"
$V mcp --toolsets all mr11-lint-badpages lint "$(jq -nc --arg u "$MR11_DECK" --arg w "$MR11_W2" '{unit:$u,worktree:$w,pages:"3-1"}')"
test $? -eq 1
jq -e '.code == "workspace-argument-invalid" and .message == "Invalid page selector: 3-1"' "$EVIDENCE/mr11-lint-badpages.out"
# A Sheet is rejected with the CLI's code and message
$V mcp --toolsets all mr11-lint-sheet lint "$(jq -nc --arg u "$MR11_SHEET" --arg w "$MR11_W" '{unit:$u,worktree:$w}')"
test $? -eq 1
$V cli mr11-lint-sheet-cli lint --worktree "$MR11_W" --unit "$MR11_SHEET" --json
test "$(jq -r '"\(.code): \(.message)"' "$EVIDENCE/mr11-lint-sheet.out")" = "$(head -n1 "$EVIDENCE/mr11-lint-sheet-cli.err")"
```

Pass when:

- Every `mr11_print` call exits 0, the downloaded file is a PDF that `pdfinfo` opens, its page count equals `uvw print-pdf` on the same Unit and scope
  (the Doc has several pages, the Sheet one), and the event records `render_pages`, `export_bytes` and the Unit type.
  `mr11-side-by-side-mr11-doc-wt.png` (MCP left, CLI right) shows `Quarterly report` and the numbered paragraphs on the same lines. Look at it. The two
  renderings can differ in glyph weight because the renderer runs Linux Chromium and the CLI runs the host browser.
- `mr11-side-by-side-mr11-sheet-wt.png` and `mr11-side-by-side-mr11-sheet-trunk.png` show `Region`, `Total`, `North`, `42`, `South`, `17` and the same
  four-colour image, so the Worktree and the trunk Asset reads both reach the renderer.
- The Base and the missing scope exit 1 with the CLI's message and a `tool_error` event; a retry with the same `idempotency_key` returns the first result.
- The MCP lint report has the CLI report's coverage and the same two findings (`text-off-page` and `text-overlaps-text`) with the same ids and fingerprints.
  The only differences are the font-metric fields: the `detail` text, ink and box geometry (about one pixel) and `overlapRatio` (about 0.01), because the
  renderer and the CLI measure text with different Chromium builds and fonts.
- The lint rejections exit 1 with the CLI's text, and the Sheet keeps the CLI's code `workspace-unit-layout-lint-unit-type-unsupported`.

### MR12 opencode screenshot

An agent reads a screenshot through `screenshot`, so the image must reach the model and the model must describe it correctly. The model is
`$MCP_OPENCODE_MODEL` (`console-deepseek/deepseek-flash#high`, which reads images). `screenshot` is a core tool, so opencode runs from
`$MCP_OPENCODE_DIR` with the default MCP URL, as in M11. opencode wraps MCP tools in its `execute` tool, so the MCP call is
recorded under `part.state.metadata.metadata.toolCalls`, and opencode renders an MCP `image` result as a `file` part with MIME `image/png`.
Run it after MR10 (the download-link half reuses MR10's two-page deck) and use a parallel run id when another run is active.

```bash
B=.agents/skills/verify-uvw/bin
FIX="$EVIDENCE/mr12"; mkdir -p "$FIX"
O=verify-$VERIFY_UVW_RUN
node $B/png-fixture.mjs "$FIX/blocks.png" 240 160 blocks
$V cli mr12-repo repo view "$O/personal" --json
MR12_SPACE=$(jq -r .id "$EVIDENCE/mr12-repo.out")
$V cli mr12-pr pr create -R "$O/personal" -t 'opencode screenshot' --json
MR12_W=$(jq -r .id "$EVIDENCE/mr12-pr.out")
$V cli mr12-unit unit create --worktree "$MR12_W" --space "$MR12_SPACE" --type sheet --name 'Kettle stock' --json
MR12_U=$(jq -r .unit.unitId "$EVIDENCE/mr12-unit.out")
node -e 'const fs=require("fs");const [d,o]=process.argv.slice(1);fs.writeFileSync(o,`const sheet = workbook.getActiveSheet();
sheet.getRange("A1:B3").setValues([["Product","Aurora Kettle"],["SKU","KT-48213"],["Stock",77]]);
const image = await sheet.newOverGridImage().setSource(${JSON.stringify("data:image/png;base64,"+fs.readFileSync(d).toString("base64"))}, api.Enum.ImageSourceType.BASE64).setColumn(3).setRow(1).setWidth(240).setHeight(160).buildAsync();
sheet.insertImages([image]);
return { images: sheet.getImages().length };
`)' "$FIX/blocks.png" "$FIX/sheet-script.js"
$V cli mr12-write execute --worktree "$MR12_W" --unit "$MR12_U" --script "$FIX/sheet-script.js" --json
jq -e '.committed == true and .value.images == 1' "$EVIDENCE/mr12-write.out"

shot_call='select(.type == "tool_use" and any(.part.state.metadata.metadata.toolCalls[]?; .tool == "verify-uvw.screenshot" and .status == "completed"))'

# A Sheet in a Worktree: the image reaches the model and the description is right
since=$(date -u +%Y-%m-%dT%H:%M:%SZ)
(cd "$MCP_OPENCODE_DIR" && opencode run --format json -m "$MCP_OPENCODE_MODEL" \
  "Call the screenshot tool of the verify-uvw MCP server once with unit \"$MR12_U\", worktree \"$MR12_W\" and range \"A1:J12\". Then describe exactly what the picture shows: every piece of cell text you can read, and the image you can see, with its colours and where each colour sits." < /dev/null) > "$EVIDENCE/mr12-opencode.jsonl"
echo $? > "$EVIDENCE/mr12-opencode.exit"
test "$(cat "$EVIDENCE/mr12-opencode.exit")" = 0
jq -s -e "[.[] | $shot_call] | length >= 1 and all(.[]; .part.state.metadata.content | map(.type) == [\"text\",\"file\"] and .[1].mime == \"image/png\")" "$EVIDENCE/mr12-opencode.jsonl"
jq -r "select(.type == \"tool_use\") | select(.part.state.metadata.content // [] | any(.type == \"file\")) | .part.state.metadata.content[] | select(.type == \"file\") | .uri | sub(\"^data:image/png;base64,\"; \"\")" "$EVIDENCE/mr12-opencode.jsonl" | head -n1 | base64 -d > "$EVIDENCE/mr12-opencode-image.png"
magick identify "$EVIDENCE/mr12-opencode-image.png"
jq -r 'select(.type == "text") | .part.text' "$EVIDENCE/mr12-opencode.jsonl" > "$EVIDENCE/mr12-opencode.answer.txt"
for word in 'Aurora Kettle' 'KT-48213' red green blue yellow; do grep -qi -- "$word" "$EVIDENCE/mr12-opencode.answer.txt" || echo "MISSING in answer: $word"; done
$V mcp-logs | jq -s --arg since "$since" '[.[] | select(.event == "mcp.tool_call" and .tool == "screenshot" and .ts >= $since)]' > "$EVIDENCE/mr12-opencode.event.json"
jq -e 'length >= 1 and all(.[]; .outcome == "ok" and .cost.render_pages == 1 and .client_name == null)' "$EVIDENCE/mr12-opencode.event.json"

# A two-page deck above 1 MiB (MR10): download links, no image part, and the model reports them
MR12_DECK=$(jq -r .unitId "$EVIDENCE/mr10-deck-shot.out"); MR12_DECK_W=$(jq -r .id "$EVIDENCE/mr10-pr2.out")
since=$(date -u +%Y-%m-%dT%H:%M:%SZ)
(cd "$MCP_OPENCODE_DIR" && opencode run --format json -m "$MCP_OPENCODE_MODEL" \
  "Call the screenshot tool of the verify-uvw MCP server once with unit \"$MR12_DECK\" and worktree \"$MR12_DECK_W\". Report how many images came back and, for each one, its page, size in bytes, and whether the result gave a download link. Do not repeat any URL." < /dev/null) > "$EVIDENCE/mr12-opencode-deck.jsonl"
echo $? > "$EVIDENCE/mr12-opencode-deck.exit"
test "$(cat "$EVIDENCE/mr12-opencode-deck.exit")" = 0
jq -s -e "[.[] | $shot_call] | length >= 1 and all(.[]; .part.state.metadata.content | map(.type) == [\"text\"])" "$EVIDENCE/mr12-opencode-deck.jsonl"
jq -s -e "[.[] | $shot_call | .part.state.output | fromjson | .images | length == 2 and all(.[]; .download.url != null)] | all" "$EVIDENCE/mr12-opencode-deck.jsonl"
jq -r 'select(.type == "text") | .part.text' "$EVIDENCE/mr12-opencode-deck.jsonl" > "$EVIDENCE/mr12-opencode-deck.answer.txt"
$V mcp-logs | jq -s --arg since "$since" '[.[] | select(.event == "mcp.tool_call" and .tool == "screenshot" and .ts >= $since)]' > "$EVIDENCE/mr12-opencode-deck.event.json"
jq -e 'length >= 1 and all(.[]; .outcome == "ok" and .cost.render_pages == 2 and .cost.export_bytes > 1048576)' "$EVIDENCE/mr12-opencode-deck.event.json"
```

Pass when both opencode runs exit 0 and:

- The Sheet run has a completed `verify-uvw.screenshot` call whose result is a text part followed by a `file` part with MIME `image/png`
  (opencode's form of the MCP `image` block). `mr12-opencode-image.png` is decoded from that part and shows `Product`, `Aurora Kettle`, `SKU`,
  `KT-48213`, `Stock`, `77` and a four-colour image (red and green on top, blue and yellow below). Look at it.
- The model's final text (`mr12-opencode.answer.txt`) names those cell texts and the image's four colours and their places, and the script prints no
  `MISSING in answer` line. Read it against the picture: the colour words are the automatic part of the check, the placement is yours.
- The event has outcome `ok`, `render_pages` 1 and a null client name.
- The deck run's `screenshot` result has no `file` part, two entries with `download.url`, and its event records `render_pages` 2 and `export_bytes`
  above 1 MiB. The model's answer reports two images with download links. It may repeat the links despite the prompt. They are capability URLs that
  expire in 15 minutes on a disposable run, and they stay out of reports.
- The model's tool choices are not fixed. If it explores resources or skills first, only its `screenshot` calls count. Rerun the section when a prompt
  gets no `screenshot` call.

### MV2. Real-font SVG measurement through the renderer

Run it after `doctor` passes, with the
`eval "$($V env)"` variables set. The renderer launches one browser at startup. If that warm-up
failed, the first measurement starts Chromium and can return the retryable
`workspace-renderer-timeout`; rerun it.

```bash
node .agents/skills/verify-uvw/bin/compiler-journeys.mjs svg-real
```

Pass when, for one SVG with Latin and Chinese text, left, centred and right-anchored lines:

- `compile_svg` without `estimate_text_size` reports `textMeasure: "univer-render-runtime"` and no
  estimation lint, and has the same keys and the same code structure as `uvw compile-svg` on the
  file (`mcp-svg-real-compile.out` against `mcp-svg-real-cli.out`, compared with numbers masked).
  Numeric metrics may differ because the CLI measures with the host browser's fonts; diff the two
  files and record any differences. With `estimate_text_size: true` the mode is `builtin-estimate`
  with the estimation lint and different box widths.
- Apply into a Slide in a Worktree commits one revision and `inspect` reads `季度回顾`.
- `mcp-svg-real-shot.image-1.png` (MCP `screenshot` of that page) shows every line inside its box
  without overflow or clipping. Look at it.
- The journey prints the wall time of a 55-line compile (`mcp-svg-real-50.wall-ms`, one renderer
  RPC per line, warm renderer) and the usage event stays `executor: none` with zero render cost.
- Stop with `$V down` for the run, even on failure.

## Gotchas

- The MCP-mode gotchas in [MCP gateway](mcp.md#gotchas) apply.
