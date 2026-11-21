# Bauhaus Blocks

Chinese pages: https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.3.1/900.css https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.3.1/500.css https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.3.1/700.css; font-family: "Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/space-grotesk@5.3.0/latin-700.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/space-grotesk@5.3.0/latin-500.css">
```
```css
:root{--paper:#fbf9f3;--ink:#111;--red:#e4302a;--blue:#1c3fd6;--yellow:#ffc800;--accent:#111;--accent-ink:#fff;
 --num:"Space Grotesk","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;--cjk:"Space Grotesk","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif}
```

Primary geometric fields with bold type. Each selectable block is a meaningful category.
Skeleton: heading/filter segments, expanding comparison blocks, full-width reset/scope bar, chart and ledger below.
```html
<div class="field"><button class="blk" aria-pressed="true">Category <strong>Live value</strong></button><button class="blk" aria-pressed="false">Category</button></div>
```
```css
.field{display:grid;grid-template-columns:2fr 1fr;min-height:260px}
.blk{border:0;text-align:left;padding:clamp(14px,2vw,28px);background:var(--red);color:#fff}
.blk+ .blk{background:var(--blue)}
.blk[aria-pressed=true]{box-shadow:inset 0 12px var(--ink)}
```
Change grid column proportions on selection; show the selected scope in the chart and ledger without changing source data. Use Space Grotesk figures, tabular numerals, 3px control borders, 24–48px work-area gaps and 11px ruled table rows. Below 760px, expand rows vertically and stack the main areas.
Use a live status line for loading and writes; leave chart containers empty. Clear placeholders on data. Name empty filters and show failures inline, retaining edits and a bound ledger if charts fail.
Do not turn unrelated totals into giant blocks. Do not add pastel cards, soft shadows or sample category/schema assumptions.
