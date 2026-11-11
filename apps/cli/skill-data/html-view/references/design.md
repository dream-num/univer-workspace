# Choose a starting point

Read the source Sheet first. Pick a template yourself; do not ask the user to choose a style.
Copy the complete file, replace both IDs everywhere, and adapt its declarations to inspected
columns, formulas and worksheet bounds. Keep data live; never replace subscriptions with sample data.

| Scenario and data shape | Start from | Visual direction |
| --- | --- | --- |
| Assumption cells with formula results; budgets, runway, forecasts | [planning](../templates/planning.univer.html) | Warm paper, editorial serif, cash-flow columns |
| Dated categories, segments, numeric actuals and targets | [sales](../templates/sales.univer.html) | Ink-blue canvas, clear sans, bar-and-line comparison |
| Stable record IDs, owners and editable states; intake or delivery | [tracker](../templates/tracker.univer.html) | Compact blue workbench, queue and adjacent intake form |
| Public participation with a category per submission | [showcase](../templates/showcase.univer.html) | Citron ground, bold display face, oversized ranked names |

Tie-break by the primary visitor action: model an assumption, compare performance, edit a record,
or participate. If two still fit, choose the simpler source layout. Between successive pages,
vary the accent hue **and** composition (for example an upper filter versus a side filter,
or a stacked versus side-by-side form). Preserve semantic colors and the template's hierarchy;
do not turn every page into the same card grid. Use the scenario's nouns, units and dates.

## Keep the craft floor

- Use CSS custom properties for canvas, surface, text, muted text, action, focus, borders, errors
  and chart series. Body and placeholder contrast must reach 4.5:1; large text and control/focus
  boundaries need 3:1. Errors and chart series also need words, shape or line patterns.
- Keep a 4/8px spacing rhythm, close related controls together, and separate work areas generously.
  Use a clear title/section/body/metadata scale, ordinary body text at 16px, and readable prose
  around 65ch. Apply `font-variant-numeric: tabular-nums` to all changing figures.
- Theme `::selection`, caret, focus rings and scrollbars. Preserve visible keyboard focus,
  explicit labels, hover affordances and disabled controls during pending writes.
- Retain loading placeholders, useful empty states and inline errors. Library failure must leave
  the data readable, for example through the sales ledger. Never announce a failed write as saved.
- Check at 360px, 390px and 1440px: collapse columns, wrap long names and keep charts sized.
  Use scrolling only for genuinely wide tabular content. Do not shrink the entire page to fit.
- Fonts and libraries may load only from `https://cdn.jsdelivr.net`. Pin exact package versions.
  Latin display faces can use pinned `@fontsource` CSS; Chinese uses a system stack such as
  `system-ui, 'PingFang SC', 'Microsoft YaHei', sans-serif`. Keep fallback text visible.

## Interactions are the point

Prefer `data-univer-cell-model` for native controls. Use declared element subscriptions for custom
rendering and JavaScript writes for record actions. Make each edit visible somewhere else: a
formula total, chart, queue summary or leaderboard must react to the source subscription.
Do not calculate a replacement for a source formula in page code.

Show pending and rejected writes next to the control, keep drafts on failure, and call `flush()`
before claiming success. Viewers without edit rights and signed-out visitors can receive rejected
writes; show the actual rejection inline and leave the readable page usable. Do not treat page
access as source access. Record insertion follows [adding records](adding-records.md): insert and
fill together, then retry only `flush()` after local insertion succeeds. These templates insert
below the header, moving older records down; they do not scan for a supposedly empty row.
They do not offer durable deduplication or unlimited append capacity. Retain stable IDs and
re-locate a record before edits; concurrent structural edits still need coordination.

## Avoid automatic-looking defaults

Do not lead every page with a strip of giant totals. Avoid equal-sized icon tiles as the page
structure, gradient-filled lettering, small category labels floating above every heading,
emoji standing in for icons, and decorative glass or shadows without a purpose. Give the actual
work, comparison or participation a distinctive composition instead.
