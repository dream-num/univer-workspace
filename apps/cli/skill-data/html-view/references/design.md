# Choose a style before authoring

Read the source Sheet to understand its data, formulas and writable cells. Unless the user
already named a style, ask which style they want before authoring. List all ten Chinese
names with their one-line moods from this catalog and say **仪表夜航 is the default**.
If the user leaves the choice to you, or you cannot ask in a non-interactive run, use
**仪表夜航 (`night-gauge`)**. Never silently choose a different style by scenario.

## Style catalog

The designed-for scenario describes the starter's data contract, not a restriction on its use.

| ID / template | Chinese name | One-line mood | Designed-for scenario | Signature element |
| --- | --- | --- | --- | --- |
| [night-gauge](../templates/night-gauge.univer.html) | 仪表夜航（默认） | 炭黑底、琥珀与冷青，紧凑沉静的仪表舱 | Startup cash runway with a live 36-month Sheet model | Large SVG cash-flow plot with draggable assumption handles and an amber runway answer |
| [swiss-report](../templates/swiss-report.univer.html) | 瑞士财报 | 黑白红、粗体数字与严整网格，利落有力 | Startup cash runway with a live 36-month Sheet model | Twelve-column grid, oversized red Archivo answer and ruler-like sliders |
| [broadsheet](../templates/broadsheet.univer.html) | 粉色报纸 | 桃粉纸张、宋体与衬线字，温暖的财经报刊 | Startup cash runway with a live 36-month Sheet model | Newspaper masthead, ruled columns and editable assumptions embedded in a sentence |
| [bauhaus-blocks](../templates/bauhaus-blocks.univer.html) | 包豪斯色块 | 红蓝黄原色、几何大字，鲜明活泼 | Weekly sales meeting with region/channel filters and editable record targets | Three region blocks expand on selection, paired with bold Space Grotesk figures |
| [trading-desk](../templates/trading-desk.univer.html) | 交易台 | 深黑底、等宽数字与蓝橙对照，高密度专业感 | Weekly sales meeting with region/channel filters and editable record targets | Region/channel heatmap matrix beside a compact chart and ledger |
| [meeting-slides](../templates/meeting-slides.univer.html) | 周会幻灯 | 暖黑底、宋体大标题与橙红强调，从容演示 | Weekly sales meeting with region/channel filters and editable record targets | Full-height scroll-snap sections with highlighted statements and slide navigation dots |
| [brutalist-board](../templates/brutalist-board.univer.html) | 新粗野看板 | 亮黄底、粗黑边与硬阴影，直接有劲 | Customer implementation delivery tracker with status edits and task insertion | Four status columns with draggable task cards and a tilted save stamp |
| [blueprint-timeline](../templates/blueprint-timeline.univer.html) | 蓝图时间线 | 淡蓝工程网格、等宽标注，精确克制 | Customer implementation delivery tracker with status edits and task insertion | Day-axis task timeline with a today line, status chips and striped blockers |
| [wenkai-notebook](../templates/wenkai-notebook.univer.html) | 文楷手账 | 米色横线纸、文楷与朱红批注，亲切手写感 | Customer implementation delivery tracker with status edits and task insertion | Ruled notebook and red margin, hand-drawn status marks and an inline entry form |
| [citron-poster](../templates/citron-poster.univer.html) | 柠檬海报 | 柠檬黄底、深绿与粗体大字，明快适合传播 | Public city sign-ups, counting the first 100 entries | Oversized ranked city names beside a dark-green participation panel |

## Apply the chosen style

Read `templates/<id>.univer.html` and start from its complete source. Inspect its header's
expected columns, formulas and bounds; replace every Unit and worksheet ID (URI-encoded
in binding attributes, raw in JavaScript) and adapt coordinates to the inspected Sheet.

For a scenario the template was not designed for, keep its fonts, palette, density and
signature element. Rebuild the structure the user's data needs with that template's own
components: for example, use 仪表夜航's plot and control dock for an operations model, or
蓝图时间线's lanes for another dated workflow. Use the scenario's nouns, units and dates.
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
  Latin display faces can use pinned `@fontsource` CSS; retain the chosen template's Chinese font
  (Noto Sans SC, Noto Serif SC or LXGW WenKai) and system fallbacks. Keep fallback text visible.

## Interactions are the point

Prefer `data-univer-cell-model` for native controls. Use declared element subscriptions for custom
rendering and JavaScript writes for record actions. Make each edit visible somewhere else: a
formula total, chart, queue summary or leaderboard must react to the source subscription.
Display recalculated source values; never calculate a replacement for a Sheet formula in page code
or embed copies of Sheet data or fallback numbers.

Show pending and rejected writes next to the control, keep drafts on failure, and call `flush()`
before claiming success. Viewers without edit rights and signed-out visitors can receive rejected
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
