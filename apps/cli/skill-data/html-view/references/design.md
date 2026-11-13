# Choose a style before authoring

Unless the user already named a style, ask which style they want before reading Sheets
in depth or authoring. Ask in the user's language, using all ten style names and their
one-line moods in that language from this catalog, and say **Night Gauge (仪表夜航)
is the default** (use the name in the user's language). Say the ten styles are built-in
starting points and the user may describe their own style instead. Ask in your normal reply text,
then end your turn and wait for the answer. Do not rely on a client question or form tool, or validate
or publish a page before the user answers. If the user leaves the choice to you
("you choose", "anything", "use the default"; 你来定, 随便, 默认就行), use
**Night Gauge (`night-gauge`, 仪表夜航)**. Never silently choose
another style. Then read the source Sheet to understand its data, formulas and writable cells.

## Style catalog

The designed-for scenario describes the starter's data contract, not a restriction on its use.

| ID / template | English name | Chinese name | One-line mood | Designed-for scenario | Signature element |
| --- | --- | --- | --- | --- | --- |
| [night-gauge](../templates/night-gauge.univer.html) | Night Gauge (default) | 仪表夜航（默认） | Charcoal, amber and cool cyan; a compact, calm cockpit | Startup cash runway with a live 36-month Sheet model | Large SVG cash-flow plot with draggable assumption handles and an amber runway answer |
| [swiss-report](../templates/swiss-report.univer.html) | Swiss Report | 瑞士财报 | Black, white and red; bold numbers and a crisp, disciplined grid | Startup cash runway with a live 36-month Sheet model | Twelve-column grid, oversized red Archivo answer and ruler-like sliders |
| [broadsheet](../templates/broadsheet.univer.html) | Broadsheet | 粉色报纸 | Peach paper and serif type; a warm financial newspaper | Startup cash runway with a live 36-month Sheet model | Newspaper masthead, ruled columns and editable assumptions embedded in a sentence |
| [bauhaus-blocks](../templates/bauhaus-blocks.univer.html) | Bauhaus Blocks | 包豪斯色块 | Primary red, blue and yellow; large geometric type, bold and lively | Weekly sales meeting with region/channel filters and editable record targets | Three region blocks expand on selection, paired with bold Space Grotesk figures |
| [trading-desk](../templates/trading-desk.univer.html) | Trading Desk | 交易台 | Deep black, monospaced figures and blue-orange contrast; dense and professional | Weekly sales meeting with region/channel filters and editable record targets | Region/channel heatmap matrix beside a compact chart and ledger |
| [meeting-slides](../templates/meeting-slides.univer.html) | Meeting Slides | 周会幻灯 | Warm black, large serif headings and orange-red accents; an assured presentation | Weekly sales meeting with region/channel filters and editable record targets | Full-height scroll-snap sections with highlighted statements and slide navigation dots |
| [brutalist-board](../templates/brutalist-board.univer.html) | Brutalist Board | 新粗野看板 | Bright yellow, thick black borders and hard shadows; direct and punchy | Customer implementation delivery tracker with status edits and task insertion | Four status columns with draggable task cards and a tilted save stamp |
| [blueprint-timeline](../templates/blueprint-timeline.univer.html) | Blueprint Timeline | 蓝图时间线 | Pale blue engineering grid and monospaced annotations; precise and restrained | Customer implementation delivery tracker with status edits and task insertion | Day-axis task timeline with a today line, status chips and striped blockers |
| [wenkai-notebook](../templates/wenkai-notebook.univer.html) | Ink Notebook | 文楷手账 | Cream ruled paper, handwritten type and vermilion notes; personal and inviting | Customer implementation delivery tracker with status edits and task insertion | Ruled notebook and red margin, hand-drawn status marks and an inline entry form |
| [citron-poster](../templates/citron-poster.univer.html) | Citron Poster | 柠檬海报 | Lemon yellow, deep green and bold oversized type; bright and shareable | Public city sign-ups, counting the first 100 entries | Oversized ranked city names beside a dark-green participation panel |

## Page language

Templates are written in English as starting points. Write every visible string, unit and
date format in the generated `.univer.html` in the language and conventions of the user's
conversation (for example, 万 and 年/月 for Chinese users). Do not add i18n dictionaries
or language switches. For a Chinese page, load the CJK fonts listed on the template header's
`Chinese pages:` line and put them first in the font stacks. Keep the style's palette,
layout and signature element.

## Custom styles

The catalog is a set of built-in starting points, not a limit. When the user describes their own
style (brand colors, fonts, mood, a reference site), start from the template whose structure best
fits their data, then replace its fonts, palette, density and signature element to match the
description. Keep the template's bindings, write paths, states and the craft floor below. Use only
`https://cdn.jsdelivr.net` assets.

## Apply the chosen style

Read `templates/<id>.univer.html` and start from its complete source. Inspect its header's
expected columns, formulas and bounds; replace every Unit and worksheet ID (URI-encoded
in binding attributes, raw in JavaScript) and adapt coordinates to the inspected Sheet.

For a scenario the template was not designed for, keep its fonts, palette, density and
signature element. Rebuild the structure the user's data needs with that template's own
components: for example, use Night Gauge's plot and control dock for an operations model, or
Blueprint Timeline's lanes for another dated workflow. Use the scenario's nouns, units and dates.
Keep live bindings and intended writes; the original sample schema is not data to copy.
Never replace subscriptions with sample data, fallback numbers or page-side Sheet formulas.
Do not switch styles silently or flatten every choice into the same card grid.

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
  the data readable, for example through a bound data table. Never announce a failed write as saved.
- Check at 360px, 390px and 1440px: collapse columns, wrap long names and keep charts sized.
  Use scrolling only for genuinely wide tabular content. Do not shrink the entire page to fit.
- Fonts and libraries may load only from `https://cdn.jsdelivr.net`. Pin exact package versions.
  Latin display faces can use pinned `@fontsource` CSS; for Chinese pages, load the CJK fonts
  listed in the template header and put them first in the font stacks. Retain system fallbacks
  and keep fallback text visible.
  Show Workspace videos, audio and images through `data-workspace-src`; see
  [authoring.md](authoring.md#workspace-media).

## Interactions are the point

Prefer `data-univer-cell-model` for native controls. Use declared element subscriptions for custom
rendering and JavaScript writes for record actions. Make each edit visible somewhere else: a
formula total, chart, queue summary or leaderboard must react to the source subscription.
Display recalculated source values; never calculate a replacement for a Sheet formula in page code
or embed copies of Sheet data or fallback numbers.

Show pending and rejected writes next to the control, keep drafts on failure, and call `flush()`
before claiming success. Visitors without edit rights may receive a host-provided local trial, so label
completed writes with `getWriteMode` as the templates do. Never build a page-side simulation, formula
copy or fallback data for visitors. Viewers without edit rights and signed-out visitors can receive rejected
writes; show the actual rejection inline and leave the readable page usable. Do not treat page
access as source access. Record insertion follows [adding records](adding-records.md): insert and
fill together, then retry only `flush()` after local insertion succeeds. Record-inserting templates
insert below the header, moving older records down; they do not scan for a supposedly empty row
or offer durable deduplication or unlimited append capacity. Retain stable IDs and re-locate a
record before edits; concurrent structural edits still need coordination.

## Avoid automatic-looking defaults

Preserve the chosen style's hierarchy and signature element. Do not add a strip of giant totals to
every page. Avoid equal-sized icon tiles as the page structure, gradient-filled lettering, small category labels floating above every heading,
emoji standing in for icons, and decorative glass or shadows without a purpose. Give the actual
work, comparison or participation a distinctive composition instead.
