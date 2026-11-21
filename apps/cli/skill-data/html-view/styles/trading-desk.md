# Trading Desk

Chinese pages: https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.3.1/400.css https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.3.1/700.css; font-family: "Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-mono@5.3.0/latin-400.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-mono@5.3.0/latin-600.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-sans@5.3.0/latin-400.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-sans@5.3.0/latin-600.css">
```
```css
:root{--bg:#0b0e13;--panel:#10141b;--line:#232b37;--tx:#d8dee9;--dim:#8f9bb0;--up:#4cb4ff;--dn:#ff7a45;--sel:#e8c547;
 --mono:"IBM Plex Mono","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;--sans:"IBM Plex Sans","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif}
```

Dense dark workbench. A matrix locates exceptions; compact figures, trend and ledger follow the selected scope.
Skeleton: sticky filter/status bar, heatmap left, indicators/chart/ledger right.
```html
<div class="mx"><button class="cell">Label <b>Value · deviation</b></button></div>
<div id="chart"></div><p role="status">Loading…</p>
```
```css
.mx{display:grid;grid-template-columns:minmax(80px,1.2fr) repeat(4,minmax(0,1fr));gap:2px}
.cell{min-height:44px;padding:0 8px;border:0;border-radius:2px;color:white;background:var(--up);font-family:var(--mono)}
#chart{height:300px}
```
Map real deviations to blue positive, orange negative and dark midpoint; include values/signs and units. Use pressed buttons for selection and update the adjacent detail scope. Main columns are 1.55fr/1fr with 1px dividers, 12px 14px panel padding. Compact data text is 13px/1.45, table cells 4px; keep prose at 16px and figures tabular. Below 900px, stack panels, use two indicator columns and wrap status.
Never put loading text inside a chart container; echarts.init keeps existing children. Leave it empty; show loading in a sibling or status line. After data arrives, no placeholder text may remain. Name empty filters and exception lists; show errors inline, keep drafts and a bound ledger if charts fail.
Do not add giant totals, giant headings, shadows, round cards, color-only encoding or copied sample categories. Local filters must not write source data.
