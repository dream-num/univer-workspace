# Broadsheet

Chinese pages: https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5.3.1/chinese-simplified-900.css, https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5.3.1/chinese-simplified-700.css, https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5.3.1/chinese-simplified-400.css; font-family: "Noto Serif SC", "Songti SC", "STSong", "Source Han Serif SC", serif.

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/playfair-display@5.3.0/latin-900.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/playfair-display@5.3.0/latin-900-italic.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/playfair-display@5.3.0/latin-500.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/source-serif-4@5.2.8/latin-400.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/source-serif-4@5.2.8/latin-600.css">
```
```css
:root{--paper:#f6d8c6;--paper2:#f1cdb8;--ink:#201814;--mute:#5e3d31;--red:#9c1a0a;
  --serif:"Source Serif 4","Songti SC","STSong",serif;--disp:"Playfair Display","Songti SC","STSong",serif}
```

Peach paper, serif typography and newspaper rules.
Skeleton: centered masthead and dateline, a lead sentence with inline controls, plot/sidebar columns, prose and detail ledger.
```html
<p class="sent">With <label class="ctl">Input <input type="number" aria-label="Assumption"></label>, the result is <output class="res">Loading…</output>.</p>
```
```css
.sent{font:600 clamp(22px,2.7vw,38px)/2.05 var(--serif);max-width:26em;margin:24px auto}
.ctl{display:inline-flex;border-bottom:3px solid var(--ink);background:#ffffff59}
.res{background:var(--ink);color:var(--paper);padding:0 .3em;font:italic 900 1.15em var(--disp)}
```
Use labeled numeric controls with keyboard access; custom dragging needs the same keyboard path. Body is 17px/1.8, prose 16px/1.85. Use 22–30px section padding, 1px rules and a double masthead rule. Collapse columns on narrow screens; keep prose readable and tables locally scrollable.
Replace initial loading in the sentence/status when data arrives. State empty ranges explicitly; show rejected writes inline and retain input. A chart failure leaves a bound ledger readable.
Do not add a giant totals strip, dashboard cards, sans-serif display type or copied sample fields/formulas.
