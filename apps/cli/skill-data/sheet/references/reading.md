# Sheet reading operations

`outline`, `read`, and `find` accept only Sheet Units. Other Unit types use `inspect`.
Every call names a Unit and exactly one scope, trunk or a Worktree. Keep that scope when continuing.

Options below use operation names, not command syntax. The `core` Skill defines entry bindings.
JSON output is opt-in on both entries. Enable the CLI `json` option through the `core` Skill's binding, or set MCP `json: true`.
The result contains `unitId`, `scope`, `revision`, `text`, `json`, `warnings`, and an optional `next` continuation.
The `json` field contains the structured reading result. MCP omits it unless requested.

## outline

`outline` maps sheets, regions, headers, column types, formulas, errors, and objects without dumping cells.

| Option | Meaning |
| --- | --- |
| `at` | Zoom to a returned ref, such as `s2` or `s2.t1`. Omit it for the workbook map. |
| `from` | Continue within `at` at the child ref returned by a continuation. Requires `at`. |
| `depth` | Absolute depth. `0` lists sheets, `1` adds regions, and `2` adds columns and objects. Defaults to `1` for the workbook and `2` when zoomed. |
| `budget` | Positive text character budget per sheet, or for the zoomed scope. Defaults to `6000`. |

Refs come from content and follow reading order:

- `s1`, `s2` identify sheets.
- `s1.t1` identifies a table. Region letters are `t` for table, `m` for matrix, `f` for form, `k` for KPI, `x` for text, and `b` for block.
- `s1.t1.c3` identifies a column within a table.

In text output the first line identifies the Unit, scope, and `rev=` revision; structured output carries it in `revision`. Refs belong to that revision.
Structural edits can change refs. A new `outline` provides the current map.
Region kinds and bounds are heuristics for where to read, not business meaning.

Signals appear only when present:

- `subtotals:` identifies subtotal cells. Summing the whole column can double count.
- `frozen` describes frozen rows or columns.
- `merged` reports merged cells.
- `errors` reports cell errors.
- `via=name` identifies a region reached through a defined name.
- `uncached=N` counts formulas without stored results. Reads do not calculate them. The Sheet Skill's `execute` calculation recipe fills results before another read.

A sheet too large for region detection appears as one `block` and a `note:` line.
The block is a fallback, not evidence that the sheet contains one business table.
`read` pages and `find` still locate cells without region detection.

## read

`read` returns cells in an A1 grid with row numbers and column letters.
Each cell is a JSON token. Formula cells include display text and formula source in the default mode.

| Option | Meaning |
| --- | --- |
| `range` | An A1 rectangle, whole columns, or whole rows, such as `Sales!A1:F40`, `s2!B:B`, or `'Q1 Data'!3:5`. Whole columns and rows are clipped to the used range. Without a sheet prefix, the workbook must have exactly one sheet. |
| Content mode | `both` for values and formulas, the default. `display` for displayed values, `formula` for formulas, `style` for styles, or `formula+style` for formulas and styles together. |
| `max` | Maximum cells per page, default `500`. Keep it at `2000` or less, the most every entry accepts. Pages contain whole rows. A row wider than `max` requires a larger limit or a narrower range. |
| JSON | Includes typed cells and stored values in the result's `json` field. |

A sheet prefix can be its exact name, a quoted name, or a ref such as `s2!`.
Region refs such as `s2.t1` are not ranges. Use the A1 range printed by `outline` for that region.
Style content omits borders. Full cell styles and rich text remain available through `execute`.

Below the grid, `hidden:`, `filtered:`, `merged:`, `covered:`, `invisible:`, and `notes:` appear when applicable.
Filtered rows remain in the data. Merges report full rectangles. Only the top-left cell supplies the visible merged value.

The `json` object describes the page with `sheet`, `ref`, `range`, `requested`, `content`, `rows`, `columns`, `empty`, and `cells`.
`range` is the returned page. `requested` is the requested range after resolving whole rows or columns.
The two ranges differ when the page is cut. `cells` is sparse and ordered by row, then column.
Cells without content are omitted, except cells included for style content.

| Cell field | Meaning |
| --- | --- |
| `ref` | A1 cell address within the sheet. |
| `type` | `text`, `number`, `percent`, `currency`, `date`, `time`, `datetime`, `bool`, `error`, or `empty`. |
| `display` | Formatted text for presentation. It can contain rounded numbers, formatted dates, or percentages. |
| `value` | Stored number, string, boolean, or `null`. Dates remain serial numbers. A formula without a stored result has `null`. |
| `formula` | Formula source including `=`, when present. |
| `style` | Style summary when style content is selected and a style is present. |

For exact values, use `type` and `value`, not parsed `display` text.
A constant error has type `error`. A formula that returns an error keeps its `formula` and shows the error text, such as `#DIV/0!`, in `display`. The literal text `#N/A` has type `text`.
A formula with `value: null` and type `empty` lacks a stored result. It is not a known zero.

## find

`find` locates cells by substring, in sheet order and then row order.

| Option | Meaning |
| --- | --- |
| `terms` | One or more nonempty strings. Each term matches independently. A cell matching any term is a hit. |
| `in` | `values`, the default, searches display text and stored values. `formulas` searches formula source. |
| `case` | Enables case-sensitive matching. Matching is case-insensitive by default. |
| Sheet selection | `sheets` in MCP, repeatable `sheet` in CLI. Accepts sheet names or refs such as `s2`. Omit it to search all sheets. |
| `from` | The first cell to consider, inclusive, such as `Sales!A51`. Use the returned continuation position. |
| `max` | Maximum hits per page, default `50`. Keep it at `500` or less, the most every entry accepts. |

Hits identify the sheet and cell ref, display text, formula, and matched terms.
JSON includes structured hits, search counts, and per-term counts. One cell can match several terms.
Per-term counts can overlap and must not be summed as a count of distinct matching cells.

## Budgets and continuations

An outline budget can omit regions, columns, or objects. An elision shows its `zoom` and `from` refs.
Depth limits also hide deeper detail. A workbook reduced to sheet summaries can be zoomed one sheet at a time.

When output ends with a continuation, run it. Omitted is not absent.
CLI returns a command in `next`. MCP returns `next.tool` and `next.arguments` for the next call.
Use the returned continuation rather than guessing the next ref or row. Preserve the Unit, scope, content mode, and JSON selection.

`read` continues at the next whole row. `find` continues at the first omitted hit.
Never sum one page as if it were the whole range, or count only the visible hits as all matches.
If the revision changes between pages, restart the reading against the current revision.
