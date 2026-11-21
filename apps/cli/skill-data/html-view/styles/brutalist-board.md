# Brutalist Board

Chinese pages: https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.3.1/500.css, https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.3.1/700.css, https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.3.1/900.css, https://cdn.jsdelivr.net/npm/@fontsource/space-grotesk@5.3.0/700.css; font-family: "Noto Sans SC", system-ui, sans-serif; numbers: "Space Grotesk", "Noto Sans SC", sans-serif.

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/bricolage-grotesque@5.2.8/800.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/space-grotesk@5.3.0/500.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/space-grotesk@5.3.0/700.css">
```
```css
:root{
  --ink:#0a0a0a; --yellow:#ffd400; --blue:#2447f5; --red:#ff3d2e; --green:#17c26b; --paper:#fff;
  --sh:6px 6px 0 var(--ink);
  --ease:cubic-bezier(.16,1,.3,1);
}
```

Bright yellow, thick black rules, hard shadows and a tilted save stamp.
Body: 500 16px/1.5 "Space Grotesk","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif. Headings use "Bricolage Grotesque" with those fallbacks, weight 800.
Skeleton: large heading/status stamp, status columns with editable cards, entry controls and save note.
```html
<section class="col"><h2>Status · count</h2><article class="card"><h3>Live title</h3><p>Owner · date</p><select aria-label="Change status"></select></article></section>
```
```css
.col{background:var(--paper);border:4px solid var(--ink);box-shadow:var(--sh)}
.card{border:3px solid var(--ink);padding:10px 12px;box-shadow:4px 4px 0 var(--ink)}
.stamp{border:4px solid var(--ink);padding:10px 18px;transform:rotate(2.5deg);box-shadow:var(--sh)}
```
Use 4 columns with 20px gaps, max width 1440px; below 1100px use 2 columns, below 640px use 1. Lists have 14px padding/gaps; titles 22px, metadata 15px/700. Use blue active, green completed and red blocked headings, with words. Strike through completed titles. Provide a select keyboard alternative to dragging and 4px visible focus.
Replace initial board/stamp loading on data. Empty columns get a dashed-border message. Errors stay visible with role="alert"; pending writes disable duplicates and failures retain input. Stamp text distinguishes saved, trial and rejected states. Respect reduced motion.
Do not add a giant totals strip, gradients, blurred shadows, round cards, color-only statuses or sample fields/data.
