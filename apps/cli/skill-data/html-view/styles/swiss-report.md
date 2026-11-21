# Swiss Report

Chinese pages: https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.3.1/chinese-simplified-900.css, https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.3.1/chinese-simplified-500.css, https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.3.1/chinese-simplified-400.css; font-family: "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif.

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/archivo@5.3.0/latin-900.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/archivo@5.3.0/latin-500.css">
```
```css
:root{--ink:#0a0a0a;--paper:#fff;--red:#e2001a;--mute:#5b5b5b;--hair:#0a0a0a;
  --num:"Archivo","Helvetica Neue",Arial,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;--cn:var(--num)}
```

Black, white and signal red on a disciplined twelve-column grid.
Skeleton: ruled masthead, one oversized answer, explanatory subline, ruler controls, plot and ruled detail rows.
```html
<main class="g"><section class="hero"><h1>Decision</h1><output class="big">Loading…</output></section></main>
```
```css
.g{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));column-gap:24px}
.hero{grid-column:1/-1;padding:34px 0 26px;border-bottom:1px solid var(--ink)}
.big{color:var(--red);font:900 clamp(52px,13.5vw,200px)/.98 var(--num);letter-spacing:-.05em}
```
Build ruler controls with labeled native sliders, visible ticks and live value labels. Keep the red answer singular and meaningful. Use 16px/1.55 body text, tabular figures, 7px ruled table rows and 24px grid gaps. Below 760px, stack explanations and controls; allow only wide tables to scroll.
Initial loading belongs in answer/status text. Replace it on data, name empty ranges, and show load/write errors with role="alert". Keep failed input and a bound readable table if the plot fails.
Do not multiply the giant answer into a totals strip. Do not add rounded cards, gradients, shadows or sample data contracts.
