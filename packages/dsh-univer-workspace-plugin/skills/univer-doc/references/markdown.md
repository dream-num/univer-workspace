# Modern Doc Markdown for Workspace Agent

Load `univer` and `univer-doc` first. The tools use the session's Workspace authorization, linked
Space, and draft Worktree. All source, asset, output, and map paths must be inside the session
workspace; use session-relative paths in tool arguments.

## Create and review

Create an empty draft Worktree, author `report.md` and its assets, then call:

```json
{
  "source": "report.md",
  "worktreeId": "<draft-worktree-id>",
  "title": "Product overview"
}
```

Pass that object to `univer_compile_markdown`. It creates the Doc; do not create a placeholder Unit.
The target Space defaults to the session's linked Space; use `spaceId` and `parentNodeId` only to
select an authorized creation destination. Use returned `unit.unitId` and save returned `sourceMap`
as `review/doc-map.json` with the session file writer. The tool has no `sourceMapOut` option.

Inspect the native Doc and every screenshot page before Ready/review. Keep SDK default body spacing,
headings, tables, quotes, and callout colors; conversion should not need follow-up cosmetic mutations.
The compiler does not merge the Worktree.

## Edit selected current blocks

Call `univer_export_markdown` before each edit:

```json
{
  "worktreeId": "<draft-worktree-id>",
  "unitId": "<doc-id>",
  "sourceMapFile": "review/doc-map.json",
  "blockIds": ["overview", "readiness"],
  "out": "review/edit.md",
  "sourceMapOut": "review/current-map.json"
}
```

This reads current native content, resolves current image bytes using Workspace authorization,
and writes Markdown plus sidecar resources. `sourceMapOut` defaults to `<out>.map.json` if omitted.
The returned revision describes this same read. Edit the fragment, preserving selected root IDs,
and pass the following to `univer_compile_markdown`:

```json
{
  "source": "review/edit.md",
  "worktreeId": "<draft-worktree-id>",
  "unitId": "<doc-id>",
  "sourceMapFile": "review/current-map.json",
  "blockIds": ["overview", "readiness"]
}
```

The three update fields (`unitId`, `sourceMapFile`, `blockIds`) are required together; the exported
revision is read metadata. Creation-only `spaceId`,
`parentNodeId`, and `idempotencyKey` cannot accompany them. Save the returned execution `sourceMap`
after success. On conflict, export again and replan. Inspect and screenshot before review handoff.

## Univer Markdown v1

Use CommonMark/GFM for headings, paragraphs, bold, italic, strikethrough, inline code, links,
quotes, code blocks, nested lists, tasks, tables, standalone images, and dividers. The compiler
creates editable native Modern content and keeps SDK typography and spacing. Raw HTML, unknown
directives, unsupported attributes, and structures that the SDK cannot represent produce errors.

Give every top-level region you may later update an explicit stable `#id`. A `block` is an
addressing wrapper; it does not create a native BlockRange. Quotes, code, and callouts create
native BlockRanges. Modern columns create a native ColumnGroup, never a Traditional section break.

```markdown
---
univerDoc: 1
title: Product overview
---

:::block{#overview}

# Univer

Native **editable** [Office content](https://univer.ai), with
:span[rich text]{underline="true"} and :range[a bookmark]{#decision kind="bookmark"}.

:::

:::quote{#principle}

A good document communicates its structure before every word is read.

:::

:::callout{#notice}

Review the native document before handing it off.

:::

::::columns{#features gap="24"}

:::column{#left width="1"}

## Native editing

- Tables, images, and rich text
- [x] Editable after compilation

:::

:::column{#right width="1"}

## Shared runtime

| Surface | Content            |
| ------- | ------------------ |
| Browser | Native Docs        |
| Agent   | Markdown authoring |

:::

::::

:::block{#readiness}

## Readiness

| Area    | Status  |
| ------- | ------- |
| Content | Ready   |
| Review  | Pending |

:::

::image{#cover src="assets/cover.svg" width="560"}

::chart{#adoption src="assets/adoption.chart.json"}

::shape{#milestone src="assets/milestone.shape.json"}
```

- `columns` contains 2–5 direct `column` children; positive `width` values are ratios. Nested
  column groups are unsupported. Keep table/image/chart dimensions within their column width.
- Callouts inherit native background and border colors. Omit `tone` unless custom semantic coloring
  was requested; allowed tones are `info`, `success`, `warning`, `danger`, and `neutral`.
- `quote` and `callout` support paragraphs, headings, and lists. Put tables/code outside them.
  List items support paragraphs, headings, and nested lists; put structural blocks outside lists.
- Ordinary GFM tables inherit SDK defaults. Use `:::table{#metrics columnWidths="240,320"}` around
  exactly one GFM table only when explicit widths are needed. Widths must be positive, match the
  column count, and fit the available content width. Keep widths emitted by export when editing text.
- `span` accepts `color`/`background` as `#RRGGBB`, and `bold`, `italic`, `underline`,
  `superscript`, `subscript` as `"true"`/`"false"`. Superscript and subscript are mutually exclusive.
- `range` requires an ID and supports `kind="bookmark"` or `kind="hyperlink" url="https://..."`.
  Mention/Comment identities are unsupported. Standard links allow HTTP, HTTPS, mailto, and
  `#fragment`; resolve relative links to valid destinations before compiling.
- Keep exported `::heading[Title]{id="..." level="2"}` identities and `:br[]` breaks intact.
  Ordinary headings use levels 1–6; standard hard breaks preserve line breaks inside paragraphs.

## Local assets

Put assets beside the Markdown under its directory, such as `assets/cover.svg`. Paths must be safe
relative paths: no absolute paths, network image URLs, `..`, or symlinks escaping the asset root.
PNG, JPEG, GIF, WebP, and SVG dimensions are inferred. `::image` accepts positive width/height;
omitting height preserves aspect ratio. Standard images must occupy a standalone paragraph and
use a maximum width of 640 by default. Their alt text currently warns because the native image
Facade cannot persist it. Review warnings against the rendered output.

Chart JSON (`assets/adoption.chart.json`):

```json
{
  "version": 1,
  "type": "column",
  "title": "Adoption",
  "data": [
    ["Quarter", "Teams"],
    ["Q1", 12],
    ["Q2", 18]
  ],
  "categoryField": 0,
  "valueFields": [1],
  "width": 280,
  "height": 200
}
```

Supported chart types: `column`, `bar`, `line`, `area`, `pie`, and `scatter`. Data must be rectangular
with a header row; the header supplies labels, not plotted values. Native charts require valid
runtime credentials.

Shape JSON (`assets/milestone.shape.json`):

```json
{
  "version": 1,
  "type": "roundRect",
  "text": "Milestone",
  "fill": "#DCFCE7",
  "stroke": "#16A34A",
  "strokeWidth": 1,
  "width": 240,
  "height": 100
}
```

Supported shapes: `rect`, `roundRect`, `ellipse`, `diamond`, `triangle`, and `arrow`.
Images, charts, and shapes participate in normal document flow.

## Conversion boundaries

Current native content is authoritative. Export reads selected generated top-level blocks using
materialized native IDs; it does not read or synchronize the original Markdown. Preserve exported
resource sidecars and the refreshed map together with the fragment. Maps from compile-only mode
lack native IDs; save the actual execution map after every successful write.

Custom fonts/spacing/list indentation, adjacent independent list restarts, merged or richly styled
tables, mixed text/image paragraphs, custom chart styles or shape geometry, and rich text inside
code cannot be exported losslessly. A diagnostic error stops export/apply. Report that precise
limitation; do not drop content, recreate the whole Doc, or add manual cosmetic patches to make the
conversion appear successful. This workflow edits generated blocks, not arbitrary Docs losslessly.
