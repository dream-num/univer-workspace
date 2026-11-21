---
name: html-view-creator
description: Build or revise an HTML View (.univer.html), a shareable live HTML page, dashboard, report or form on Workspace Sheet data. Prefer it over a local .html unless the user asks for a file.
user-invocable: true
---

# HTML View Creator

## Rules

- Live data only. No copied Sheet data, fallback numbers or page-side Sheet formulas.
- Only a person publishes. Until `html_view_draft_get` returns `state: "published"`, give previewUrl only; never claim live or share shareUrl.
- For pull-request sources, pass `repo` and `pr` when saving; the page goes live when the user merges in Workspace. IDs survive merge. Never merge or ask to merge on their behalf, or substitute older merged data.
- If `html_view_save` is unavailable, say this connection cannot draft pages and stop. Never substitute a Slide, Board or other Unit.
- Ask mode cannot save. Read/describe; ask the user to switch to Auto and say "save it". Then save.
- Use the user's language and plain words, not technical IDs.

## 1. Read the data

Find sources with `space_find`, then `outline` and optional `read`/`find`. Note Unit and worksheet IDs, headers, bounds, ranges/capacity, formulas and input cells. Proceed directly; ask at most one question only for unclear purpose/data or an explicit plan/style request.

## 2. Choose the style

Use the named style; otherwise choose by purpose, audience, adjectives and data shape.
If none fits, use `night-gauge` or a custom style from the structurally closest style card. Change palette, type and signature; keep the design floor. Name the style and reason and offer to change it.

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
Read the neutral binding starter by default:
`skills_read {"name":"html-view","resource":"examples/binding-starter.univer.html"}`.
Details:
`skills_read {"name":"html-view","resource":"references/authoring.md"}`.
Read the full template via
`skills_read {"name":"html-view","resource":"templates/<id>.univer.html"}`
only when the data's shape is close to its original scenario in the catalog or the
page needs that template's interaction. Keep catalog fonts/palette/density/signature.

## 3. Declare the bindings

Use one source attribute per element. Cell references are `encodeURIComponent(unitId):encodeURIComponent(sheetId):B7`; inclusive ranges end in `A2:G51`. Encode each ID separately and escape HTML attribute characters. Fixed ranges do not grow; plan capacity within inspected bounds.

- `data-univer-cell-text` reads/subscribes and replaces textContent. Use a dedicated value element with no nested bindings. Formula cells supply calculated results.
- `data-univer-cell-model` reads/subscribes/writes native controls. Number/range inputs write numbers, checkboxes booleans, text/textarea/select strings. Match cell types, label controls and set native constraints. Never write formula cells.
- `data-univer-cell-subscribe` declares each formatted indicator. Register `window.univerBinding.subscribeCellById('element-id', state => ...)` after the element exists; render its `value`.
- `data-univer-range-subscribe` declares each chart/table/list separately. Register `subscribeRangeById('element-id', ({ value }) => ...)`; render rows there.

ById uses the unique literal HTML ID without `#`. JavaScript references use raw IDs and zero-based coordinates. B7 is `{ unitId, sheetId, row: 6, col: 1 }`; A2:G51 is `{ unitId, sheetId, range: { startRow: 1, endRow: 50, startColumn: 0, endColumn: 6 } }`.

## 4. Render every update

window.univerBinding exists before page scripts. Data methods return Promises; show error states on rejection. Empty cells are null. Read once with `getCellState`/`getRangeState`.

Callbacks fire before the subscribe Promise resolves; never read the returned subscription inside its first callback. A range callback always delivers the full matrix padded with null, including for empty ranges, never a delta. The subscribe binding attributes never change the DOM; render code must replace placeholders.

Separate subscriptions have no ordering. When one widget needs several bindings or sheets, use one function that every contributing callback calls. Write placeholders only in the initial HTML, never from another binding's state. After data arrives, no placeholder text may remain on the page.

Never put loading text inside a chart container; echarts.init keeps existing children. Leave it empty and show loading in a sibling or the status line. Dispose subscriptions and chart resources on removal; a replacement element with the same ID needs a new callback registration.

## 5. Write and confirm

Controls write input cells; subscriptions show recalculated results. Await `setCellValue(reference, value)` then `flush()` before claiming saved. Strings are literal; scalar writes may partially succeed. Prevent form navigation. Keep pending/rejected states, disable pending actions and retain failed input.

Add records with `insertRowsWithValues`, not empty-row writes:
`skills_read {"name":"html-view","resource":"references/adding-records.md"}`.
Relocate records by stable ID after insertion. If saving fails after local insertion succeeds, retry only `flush()`.

Editors save to the source Sheet. Host-provided read-only trials stay local/unsaved. When the host advertises the write-mode capability, call `window.univerWorkspace.getWriteMode(unitId)` before a success label; `trial` means "Trial only, not saved", never "Saved". Show rejections inline.

Media uses `data-workspace-src` with real Node IDs on img/video/audio/source. Private media stays empty, so provide a visible fallback.

## 6. Keep numbers in the Sheet

The page only displays Sheet values. Formatting, filtering and arranging rows are presentation; never compute Sheet metrics in page code, including totals, ratios, achievement rates, forecasts or derived chart series.

When a needed derived metric is missing, add formula cells to the Sheet inside the session's pull request with `execute`. For a merged Sheet, open a pull request with `pr_create` and add the Sheet with `unit_add` first. Bind the new formula cells, then save the draft with `repo` and `pr`. Do not copy formulas into JavaScript or substitute older merged values.

## 7. Check the binding samples

Save returns `bindings`, `bindingCount` and optional `truncated` alongside `draft`. Use these samples as the self-check against the inspected Sheet. Look for empty cells where data is expected, header text where numbers belong, formula cells behind writable controls, and numbers with date formats. Confirm ranges and expected formula results. Fix mismatches and resave. Inspect omitted sources if truncated. Validation does not run scripts. Fix `renderCheck` issues; without render checks, report that and name checks run.

## 8. Design floor

- CSS color variables; text contrast 4.5:1, large text/control boundaries 3:1; visible keyboard focus, labels and non-color cues.
- 4/8px spacing, 16px body, clear type hierarchy and tabular figures; styled selection/caret/scrollbars.
- Honest loading/empty/error states with `role="alert"` or `data-s="rejected"`. Keep a bound table if charts fail.
- Adapt to 360px, 390px and 1440px without shrinking the page. Do not add a strip of giant totals to every page. Avoid uniform card grids, decorative gradients and emoji icons.
- Pin exact fonts/libraries on https://cdn.jsdelivr.net; none are preloaded. Localize text, units and dates; use CJK fonts first for Chinese.

## 9. Save and reply

New: `html_view_save` with `space` (source repository by default), `name` and UUID idempotency_key. Change/restyle: `html_view_read`, edit its HTML, then `html_view_save` with `page` set to its resource, quoted `etag` and a new key. Pass inline `html` by default; use html_upload_id only for oversized HTML. Reuse keys only for identical retries. Pending revisions keep name/space to retire the older draft. Reread on stale ETags.

Reply with purpose, sources, cells controls change, previewUrl, style/reason and offer to change style. Explain publication when the user merges the source PR in Workspace; otherwise open preview and press **Publish**. Explain access from the draft's `repositoryVisibility` and `privateSourceUnitIds`: public with no private sources means anyone with the link once published; otherwise people need permission. Page access does not grant source access. Never change sharing without permission.
This connection cannot make a repository public. For public links, give the repository `url` and ask the user to make it public in browser settings. Explain that this publishes everything in it.
End the turn.

## 10. Continue

Use `html_view_draft_get` before status/revision. Published: shareUrl. Pending: preview/revise. Rejected: supplied reason or one question. Conflicted: check PR, reread page, use active/merged sources. Expired (seven days): new key. Restyle via `html_view_read`, `html_view_styles` when available, then `html_view_save`; preserve data. Apply a named style directly.
