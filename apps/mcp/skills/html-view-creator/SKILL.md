---
name: html-view-creator
description: Build or revise an HTML View (.univer.html), a shareable live HTML page, dashboard, report or form on Workspace Sheet data. Use whenever the user wants an HTML page or a page to share or present Workspace data, even if they never say HTML View, preferring it over a local .html file.
user-invocable: true
---

# HTML View Creator

Default path: this Skill and one complete template; no extra reference, gallery or validation call.

## Rules

- Live data only: no copied Sheet data, fallback numbers or page-side Sheet formulas.
  Controls write input cells; subscriptions show recalculated results.
- Only a person publishes. Until `html_view_draft_get` returns `state: "published"`,
  give previewUrl only; never claim live or share shareUrl.
- For sources new/changed in a pull request, pass `repo` and `pr` when drafting or
  validating. Preview shows its data; the page goes live when the user merges in
  Workspace. Real Unit/worksheet IDs survive merge. Never merge or ask to merge on
  their behalf, or substitute older merged data for required changes.
- If `html_view_create` is unavailable, say this connection cannot draft pages and
  stop. Never substitute a Slide, Board or other Unit.
- Ask mode cannot save. Read/describe the page, tell the user to switch to Auto and
  send a message such as "save it", then save without repeating discovery.
- Use the user's language and plain words (page, Sheet, cell). No 403, trunk,
  worktree or unitId in user-facing text; avoid Blob, ETag and binding jargon.

## 1. Read and choose

Find sources with `space_find`, then `outline` and optional `read`/`find`. Note IDs,
headers, ranges/capacity within bounds, formulas and input cells. Proceed directly;
ask at most one question only for unclear purpose/data or an explicit plan/style
request. Editable pages need no approval wait.

Use the named style; otherwise choose by purpose, audience, adjectives and data shape
(dense rankings, time series, tasks/status, key numbers). If none fits, use `night-gauge`
or a custom style from the structurally closest template, changing palette, type and
signature element while keeping the design floor. Name the style and reason and offer
to change it in the reply. Name/describe custom styles in one line.

- `night-gauge`. Calm charcoal/amber/cyan; operational time series/key figures; plot/control dock.
- `swiss-report`. Disciplined black/white/red; professional finance/key figures; bold answer/grid.
- `broadsheet`. Warm peach serif; explanatory finance/time series; newspaper/inline assumptions.
- `bauhaus-blocks`. Lively primary geometry; sales/category comparisons; expanding blocks.
- `trading-desk`. Dense black monospace/blue-orange; professional rankings; heatmap/ledger.
- `meeting-slides`. Assured black/serif/orange; presenting weekly data stories; full-height sections.
- `brutalist-board`. Punchy yellow/hard borders; task/status tracking; draggable columns.
- `blueprint-timeline`. Restrained blue grid; dated workflows; day-axis lanes/blockers.
- `wenkai-notebook`. Inviting cream handwriting/red; personal tasks/status; ruled paper/form.
- `citron-poster`. Bright lemon/green/large type; public sign-ups/rankings; participation panel.

Read the full template via
`skills_read {"name":"html-view","resource":"templates/<id>.univer.html"}`.
Preserve catalog fonts/palette/density/signature; replace IDs/coordinates. Localize
all text, units and dates; Chinese uses template-header CJK fonts first.

## 2. Bind

Each consuming element declares exactly one source attribute. Cell references are
`encodeURIComponent(unitId):encodeURIComponent(sheetId):B7`; inclusive ranges end in
`A2:G51`. Use actual Unit/worksheet IDs, not Resource IDs or worksheet names.
Fixed ranges never grow; plan capacity within bounds.

- `data-univer-cell-text` reads/subscribes and replaces textContent. Use a dedicated
  value element with no nested bindings. Formula cells supply calculated results.
- `data-univer-cell-model` reads/subscribes/writes native controls. Number/range inputs
  write numbers, checkboxes booleans, text/textarea/select strings. Match cell types,
  label controls and set native constraints. Never write formula cells.
- `data-univer-cell-subscribe` declares each formatted indicator. Register
  `window.univerBinding.subscribeCellById('element-id', state => ...)` after the
  element exists; render its `value`. Use its unique literal HTML ID without `#`.
- `data-univer-range-subscribe` declares each chart/table/list separately. Register
  `subscribeRangeById('element-id', ({ value }) => ...)`; value is the full matrix,
  rows then columns, initially and on updates. Render child rows in the callback.

Methods return Promises; show rejections. Empty cells are null. One-time reads use
`getCellState`/`getRangeState`.
JavaScript references use raw IDs and zero-based coordinates: B7 is
`{ unitId, sheetId, row: 6, col: 1 }`; A2:G51 is
`{ unitId, sheetId, range: { startRow: 1, endRow: 50, startColumn: 0, endColumn: 6 } }`.
Await `setCellValue(reference, value)` then `flush()` before claiming saved. Strings
are literal; scalar writes may partially succeed. Add records with `insertRowsWithValues`,
not empty-row writes (details:
`skills_read {"name":"html-view","resource":"references/adding-records.md"}`).
Relocate records by stable ID after insertion. Callbacks fire before
Promise resolution; dispose resources on removal. Prevent form navigation.

Keep template pending/rejected states, input on failure and `getWriteMode` labels.
Editors save; host-provided read-only trials stay local/unsaved.

Design floor: CSS color variables; text contrast 4.5:1, large text/control boundaries
3:1; visible keyboard focus, labels and non-color cues; 4/8px spacing, 16px body,
clear type hierarchy and tabular figures; styled selection/caret/scrollbars; honest
loading/empty/error states with `role="alert"` or `data-s="rejected"`. Keep a bound
readable table if charts fail. Adapt to 360px, 390px and 1440px without shrinking the
page. Avoid uniform card grids, decorative gradients and emoji icons. Pin exact
font/library versions on https://cdn.jsdelivr.net; libraries are not preloaded.
Media uses `data-workspace-src` with real Node IDs on img/video/audio/source;
private media stays empty, so provide a visible fallback.

## 3. Save and reply

New: `html_view_create` with HTML, `space` (source repository unless specified), short
`name` and UUID idempotency_key. Change/restyle: `html_view_read`, edit its HTML,
then `html_view_replace` with exact quoted ETag and a new key. Both validate and return
`bindings`, `bindingCount`, optional `truncated` alongside `draft`. Check values/ranges,
formula flags and date formats; fix mismatches and draft again with a new key.
`html_view_validate` is optional. Reuse keys only for identical retries. Pending
creation revisions keep name/space to retire the older draft. Reread on stale ETags.
Fix `renderCheck` issues and draft again. Validation does not run scripts; without a
render check say scripts were not run and name checks that ran.

Reply with purpose, sources, cells controls change, previewUrl, style/reason and offer
to change style. Explain publication when the user merges the source PR in Workspace;
otherwise open preview and press **Publish**. Explain access from
the draft's `repositoryVisibility` and `privateSourceUnitIds`: public with no private
sources means anyone with the link once published; otherwise people need permission.
Page access does not grant source access. Never change sharing without permission.
End the turn.

## 4. Continue

Call `html_view_draft_get` before status/revision. Published: shareUrl. Pending:
preview/revise. Rejected: supplied reason or one question. Conflicted: check PR,
reread page, use active/merged sources. Expired (seven days): new key. Restyle via
`html_view_read`, `html_view_styles` when available, then `html_view_replace`; preserve
data. Apply a named style directly.
