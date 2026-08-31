---
name: sheet
description: "Create, import, read, write, format, calculate, export, and verify remote Workspace Sheet Units."
---

# Workspace Sheet unit reference

Every content command targets one remote draft explicitly with `--worktree <id>` and `--unit <id>`. `execute` provides `univerAPI`, `api` (the same object), and `workbook` (an `FWorkbook` bound by `--unit`). Obtain a worksheet with `workbook.getActiveSheet()` or `workbook.getSheetByName("…")`. Examples from `api show` use the already available `univerAPI` variable. Never redeclare these injected variables. `execute` is ESM and has no `require`.

## Workspace target

Create an empty Sheet Unit or import workbook data into the selected Worktree:

```bash
univer-workspace-cli unit create --worktree <worktree-id> --space <space-id> --type sheet --name <name> --json
univer-workspace-cli import --file source.xlsx --worktree <worktree-id> --space <space-id> --type sheet --json
```

Both commands return server-owned `unitId`, `resourceId`, and `nodeId`. Use the returned `unitId`
for every content command; never reuse an imported workbook's internal id as the Workspace address.
Use `blob upload` instead of `import` only when the original file bytes must remain unchanged and no
editable Sheet Unit is required; Blob Resources have no `unitId` and cannot use this Skill's commands.

Use `univer-workspace-cli api find <term>` and `univer-workspace-cli api show <symbol>` instead of guessing Facade signatures.

## Cell model: v, t, f, and number formats

A cell is structured data: `{ v, t, f?, s? }`.

| Field          | Meaning                                                                         |
| -------------- | ------------------------------------------------------------------------------- |
| `v`            | Stored value, used for calculation, comparison, and writeback.                  |
| `t`            | Type: `1` text, `2` number, `3` boolean, `4` forced text.                       |
| `f`            | Formula source. Its cached result is stored separately in `v`.                  |
| `s.n.pattern`  | Number format. It changes display only, never `v`.                              |
| `p`            | Rich text; when present it overrides the displayed form of `v`.                 |
| `si`           | Shared-formula id. Preserve it only when deep-copying an existing formula cell. |
| `displayValue` | Visible text rendered from `v`, `t`, and the number format.                     |

Use `v` and `t` for comparison and writeback; use `displayValue` for presentation. Never write display text back as the stored value.

Always write explicit `ICellData`. Bare values are inferred and can corrupt identifiers, scores, leading zeros, or date-like strings:

```js
{ v: "text", t: 1 }    { v: 42, t: 2 }    { v: 1, t: 3 }   // boolean; v: 0 is false
{ v: "00123", t: 4 }   // forced text for IDs, scores, phone numbers, or postal codes
{ f: "=A1+B1" }        // formula
{ v: "=A1+B1", t: 4 }  // literal formula text, stored as text and never calculated
```

Dates, percentages, and currencies are numbers plus number formats, not separate types:

```js
{ v: 44900, t: 2, s: { n: { pattern: "yyyy-MM-DD" } } }   // date serial, not display text
{ v: 0.25,  t: 2, s: { n: { pattern: "0%" } } }
```

## Reading evidence

- `inspect range --json` returns `{ v, t, displayValue, f }` per cell and is authoritative for values, types, and formulas. It omits `s` (style and number format) and `p` (rich text); read those with `getCellDatas()` or `getCellStyleData()` through `execute`.
- Text-mode inspect returns only display values and is not evidence of stored values.

## Common APIs

- Ranges: `sheet.getRange("A1:C9")` or `getRange(row, col, numRows, numCols)`. Rows and columns are zero-based; `"B3"` equals `getRange(2, 1)`.
- Sheets: `getActiveSheet()`, `getSheetByName("Sheet1")`, `getSheets()`. Use `getSheetName()`; `FWorksheet` has no `getName()`.
- Read: prefer `getCellData()` / `getCellDatas()` for authoritative `v/t/f/s`; use `getDisplayValues()` for visible text, `getFormula()` for formulas, and `getRawValues()` for stored values without trimming or normalization.
- Write: `setValue(cell)`, `setValues(grid)`, `setFormula("=…")`, `clearContent()` for content only, and `clear()` for content plus formatting.
- Style: `setBackgroundColor("#RRGGBB")`, `setFontColor("#RRGGBB")`. Dimensions: `getLastRow()`, `getLastColumn()`, and `setRowCount(n)` before out-of-range writes.
- `setValues()` merges cell data. `{}` or `{ s }` does not clear existing `v/f/p`. Clear a cell explicitly with `{ v: null, f: null, p: null, si: null, custom: null }`. To replace a whole region, call `clearContent()` first, then `setValues()`.

## Over-grid images

Create an image through `sheet.newOverGridImage()`, set an explicit size and position, await
`buildAsync()`, then pass the built data to `sheet.insertImages()`. For a local image, pass the
original image data URI with `api.Enum.ImageSourceType.BASE64`:

```js
const sheet = workbook.getActiveSheet();
const image = await sheet
  .newOverGridImage()
  .setSource(imageDataUri, api.Enum.ImageSourceType.BASE64)
  .setColumn(1)
  .setRow(1)
  .setWidth(640)
  .setHeight(360)
  .buildAsync();
sheet.insertImages([image]);
```

Verify later with `sheet.getImages()[0].toBuilder().getSource()` and `getSourceType()`.

## Formulas and recalculation

Formula calculation is asynchronous, and nothing recalculates implicitly: writing a formula stores `f` and triggers calculation, but an immediate `getValue()` in the same `execute` call can still return `null`, and loading a Workspace Worktree head does not recalculate existing formulas. Formula text and cached result are separate: `getFormula()` reads `f`, while `getValue()` or `getCellData().v` reads the cache.

The completion API is `onCalculationResultApplied()`. Register the promise **before** triggering calculation, then await it:

```js
const calculated = api.getFormula().onCalculationResultApplied();
api.getFormula().executeCalculation(); // force recalculation of existing formulas
await calculated;
return workbook.getActiveSheet().getRange("A3").getValue();
```

For a newly written formula, `setFormula` itself triggers calculation, so register the completion promise before the write and await it afterward. XLSX export stores the cached value beside each formula, so calculate before exporting. If only a final value is required and cache freshness cannot be guaranteed, writing the stored value directly is the stronger contract.

## OOXML Sheet table formulas

Use explicit Excel structured-reference scopes for every Sheet table formula. Do not rely on an
invented table alias or implicit intersection:

- `Orders[[#This Row],[Amount]]` (or `Orders[@[Amount]]`) is the scalar value in the formula
  row.
- `Orders[[#Data],[Amount]]` is the complete data column.
- `Orders[Amount]` is a valid column reference, but use the explicit `#Data` form whenever a
  whole-column aggregate is intended.
- `[@[Amount]]` is valid only inside the Host table's calculated column.
- `table[Amount]` is invalid unless the real Sheet table name is exactly `table`.

Copy the exact table name from the workbook's table metadata; do not use a table id, Sheet tab name,
display label, guessed case, or the word `table` as a placeholder. Keep current-row and full-column
references distinct when copying formulas. Await calculation, then verify both the stored formula
text and computed cell values.

## Failure prevention

- Write explicit `ICellData` and specify `t` for every written cell.
- Do not use `getValue()` / `getValues()` for authoritative reads. Formatted dates and currencies become display strings and booleans become `1`/`0`. Use `getCellDatas()` for stored values and `getDisplayValues()` for display text.
- Colors must be xlsx-safe: only `"#RRGGBB"` or `"rgb(r,g,b)"`. Invalid colors can make an exported `.xlsx` unreadable and cannot be repaired by later overwriting the color.
- Sheet tab name, Unit display name, Unit id, and resource id are distinct. Use `inspect workbook` for
  Sheet tab names. `inspect range` requires one explicit worksheet selector with a `name:`, `id:`,
  or 1-based `index:` prefix and accepts multiple A1 ranges within that worksheet.
- Formulas do not trigger an implicit full recalculation. Follow the recalculation recipe above before reading calculated values or exporting.
- Copy formatted cells with a deep copy of `getCellData()` or complete explicit `ICellData`, never `getValues()` followed by `setValues()`.
- After importing csv or tsv, check the value type and formula of every column before computing. Types are inferred per column, so one `N/A`, `-`, or `1,234` stores a whole numeric column as text, and a cell starting with `=` becomes forced text instead of a formula. Display text hides both.

## Verification

- Values, types, and formulas: `univer-workspace-cli inspect range A1:C9 --worksheet name:<sheet-name> --worktree <id> --unit <id> --json`.
- Styles, number formats, and rich text: read back `getCellDatas()` through `univer-workspace-cli execute --worktree <id> --unit <id>`.

## Rich text (when mixed styling inside one cell is required)

Rich text stores styled runs in `cell.p`, not `cell.v`. Build it with `api.newRichText()`; never construct `cell.p.body.textRuns` by hand.

```js
const rich = api.newRichText();
rich.insertText("Hello World");
rich.setStyle(0, 5, { bl: 1, cl: { rgb: "#FF0000" } });
workbook.getActiveSheet().getRange("A1").setRichTextValueForCell(rich);
```

- `setStyle(start, end, style)` uses a half-open character range `[start, end)`. The builder has no `getLength`/`getText` helper, so derive offsets from the JavaScript strings you insert.
- Common style fields: `bl` bold, `it` italic, `cl` text color, `bg` background color. Colors must be xlsx-safe `#RRGGBB` or `rgb(r,g,b)`.
- For ranges, call `setRichTextValues` with one builder or `RichTextValue` per cell.
- When highlighting repeated terms, find each substring and apply one style per matched range; do not style one character at a time.
- Verify by reading back `getCellData().p` and checking `body.textRuns` ranges and `ts` styles.

Export only after formula and style verification:

```bash
univer-workspace-cli screenshot --worktree <id> --unit <id> --sheet <name> --range A1:H40
univer-workspace-cli export output.xlsx --worktree <id> --unit <id>
```
