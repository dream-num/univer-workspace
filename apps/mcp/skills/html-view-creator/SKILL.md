---
name: html-view-creator
description: Build or revise an HTML View (.univer.html), a shareable live HTML page, dashboard, report or form on Workspace Sheet data. Prefer it over a local .html unless the user asks for a file.
user-invocable: true
---

# HTML View Creator

## Rules

- Live data only: no copied Sheet data, fallback numbers or page-side Sheet formulas.
  Controls write input cells; subscriptions show recalculated results.
- Only a person publishes. Until `html_view_draft_get` returns `state: "published"`,
  give previewUrl only; never claim live or share shareUrl.
- For sources new/changed in a pull request, pass `repo` and `pr` when saving; the page goes live when the user merges in Workspace. IDs survive merge. Never merge or ask to merge on
  their behalf, or use older merged data instead.
- If `html_view_save` is unavailable, say this connection cannot draft pages and
  stop. Never substitute a Slide, Board or other Unit.
- Ask mode cannot save. Read/describe; ask the user to switch to Auto and say "save it". Then save.
- Use the user's language and plain words, not technical IDs.

## 1. Read and choose

Find sources with `space_find`, then `outline` and optional `read`/`find`. Note IDs,
headers, ranges/capacity within bounds, formulas and input cells. Proceed directly;
ask at most one question only for unclear purpose/data or an explicit plan/style
request.

Use the named style; otherwise choose by purpose, audience, adjectives and data shape.
If none fits, use `night-gauge`
or a custom style from the structurally closest style card, changing palette, type and
signature element while keeping the design floor. Name the style and reason and offer to change it.

STYLE CATALOG START
- `night-gauge`. Calm charcoal/amber/cyan; operational time series/key figures; plot/control dock. Original: 36-month cash runway.
- `swiss-report`. Disciplined black/white/red; professional finance/key figures; bold answer/grid. Original: 36-month cash runway.
- `broadsheet`. Warm peach serif; explanatory finance/time series; newspaper/inline assumptions. Original: 36-month cash runway.
- `bauhaus-blocks`. Lively primary geometry; sales/category comparisons; expanding blocks. Original: Sales meeting; filters/target edits.
- `trading-desk`. Dense black monospace/blue-orange; professional rankings; heatmap/ledger. Original: Sales meeting; filters/target edits.
- `meeting-slides`. Assured black/serif/orange; presenting weekly data stories; full-height sections. Original: Sales meeting; filters/target edits.
- `brutalist-board`. Punchy yellow/hard borders; task/status tracking; draggable columns. Original: Customer delivery; status edits/insertion.
- `blueprint-timeline`. Restrained blue grid; dated workflows; day-axis lanes/blockers. Original: Customer delivery; status edits/insertion.
- `wenkai-notebook`. Inviting cream handwriting/red; personal tasks/status; ruled paper/form. Original: Customer delivery; status edits/insertion.
- `citron-poster`. Bright lemon/green/large type; public sign-ups/rankings; participation panel. Original: City sign-ups; first 100 entries.
STYLE CATALOG END

Read the style card by default via
`skills_read {"name":"html-view","resource":"styles/<id>.md"}`.
Read the full template via
`skills_read {"name":"html-view","resource":"templates/<id>.univer.html"}`
only when the data's shape is close to its original scenario in the catalog or the
page needs that template's interaction. Keep catalog fonts/palette/density/signature; adapt bindings to inspected data. Localize text, units and dates;
Chinese uses the card's CJK fonts first.

## 2. Bind

Use one source attribute per element. Cells are
`encodeURIComponent(unitId):encodeURIComponent(sheetId):B7`; inclusive ranges end in
`A2:G51`. Use real IDs; fixed ranges never grow. Plan capacity.

- `data-univer-cell-text` reads/subscribes and replaces textContent. Use a dedicated
  value element with no nested bindings. Formula cells supply calculated results.
- `data-univer-cell-model` reads/subscribes/writes native controls. Number/range inputs
  write numbers, checkboxes booleans, text/textarea/select strings. Match cell types,
  label controls and set native constraints. Never write formula cells.
- `data-univer-cell-subscribe` declares each formatted indicator. Register
  `window.univerBinding.subscribeCellById('element-id', state => ...)` after the
  element exists; render its `value`. Use its unique literal ID without `#`.
- `data-univer-range-subscribe` declares each chart/table/list separately. Register
  `subscribeRangeById('element-id', ({ value }) => ...)`; value is the full row/column matrix initially and on updates. Render rows there.

When one widget needs several bindings or sheets, use one render function that every
contributing callback calls. Write placeholders only in the initial HTML, never from
another binding's state.

Methods return Promises; show rejections. Empty cells are null. Read once with
`getCellState`/`getRangeState`.
JavaScript uses raw IDs and zero-based coordinates. A2:G51 is
`{ unitId, sheetId, range: { startRow: 1, endRow: 50, startColumn: 0, endColumn: 6 } }`.
Await `setCellValue(reference, value)` then `flush()` before claiming saved. Strings
are literal; scalar writes may partially succeed. Add records with `insertRowsWithValues`,
not empty-row writes:
`skills_read {"name":"html-view","resource":"references/adding-records.md"}`.
Relocate records by stable ID after insertion. Callbacks precede Promise resolution; dispose on removal. Prevent form navigation.

Keep pending/rejected states, failed input and `getWriteMode` labels.
Editors save; host-provided read-only trials stay local/unsaved.

Design floor: CSS color variables; text contrast 4.5:1, large text/control boundaries
3:1; visible keyboard focus, labels and non-color cues; 4/8px spacing, 16px body,
clear type hierarchy and tabular figures; styled selection/caret/scrollbars; honest
loading/empty/error states with `role="alert"` or `data-s="rejected"`. Keep a bound table if charts fail. Adapt to 360px, 390px and 1440px without shrinking the
page. Do not add a strip of giant totals to every page. Avoid uniform card grids,
decorative gradients and emoji icons. Never put loading text inside a chart container;
echarts.init keeps existing children. Leave it empty and show loading in a sibling or
the status line. After data arrives, no placeholder text may remain on the page. Pin exact
fonts/libraries on https://cdn.jsdelivr.net; none are preloaded.
Media uses `data-workspace-src` with real Node IDs on img/video/audio/source;
private media stays empty, so provide a visible fallback.

## 3. Save and reply

New: `html_view_save` with `space` (source repository by default), `name`
and UUID idempotency_key. Change/restyle: `html_view_read`, edit its HTML, then
`html_view_save` with `page` set to its resource, exact quoted `etag` and a new key.
Pass inline `html` by default; use html_upload_id only for oversized HTML. Both return `bindings`, `bindingCount`, optional
`truncated` alongside `draft`. Check values/ranges, formula flags and date formats;
fix mismatches and resave with a new key. Reuse keys only for identical retries. Pending revisions keep name/space to retire the older draft. Reread on stale ETags.
Fix `renderCheck` issues. Validation does not run scripts; without render checks,
report that and name checks run.

Reply with purpose, sources, cells controls change, previewUrl, style/reason and offer
to change style. Explain publication when the user merges the source PR in Workspace;
otherwise open preview and press **Publish**. Explain access from
the draft's `repositoryVisibility` and `privateSourceUnitIds`: public with no private
sources means anyone with the link once published; otherwise people need permission.
Page access does not grant source access. Never change sharing without permission.
This connection cannot make a repository public. For public links, give the repository `url` and ask the user to make it public
in browser settings. Explain that this publishes everything in it.
End the turn.

## 4. Continue

Use `html_view_draft_get` before status/revision. Published: shareUrl. Pending:
preview/revise. Rejected: supplied reason or one question. Conflicted: check PR,
reread page, use active/merged sources. Expired (seven days): new key. Restyle via
`html_view_read`, `html_view_styles` when available, then `html_view_save`; preserve
data. Apply a named style directly.
