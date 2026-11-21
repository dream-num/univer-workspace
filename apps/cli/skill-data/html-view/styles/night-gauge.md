# Night Gauge

Chinese pages: https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.3.1/chinese-simplified-700.css, https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.3.1/chinese-simplified-400.css; font-family: "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif.

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/space-grotesk@5.3.0/latin-700.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/space-grotesk@5.3.0/latin-400.css">
```
```css
:root{--bg:#16171a;--bg2:#1e2024;--line:#33363d;--tx:#e9e7e1;--mute:#a1a3a9;--amber:#ffb224;--cool:#62d4ec;--neg:#ff6b3d;
  --num:"Space Grotesk","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;--cn:var(--num)}
```

Calm charcoal cockpit with amber answers and cyan comparison lines.
Skeleton: compact header/status, wide SVG plot with one answer overlay, control dock, then a ruled detail table.
```html
<section class="hero"><svg viewBox="0 0 1000 420" aria-label="Live trend"><polyline id="series" fill="none" stroke="var(--cool)"/><circle id="handle" r="7" fill="var(--amber)"/></svg><output class="answer">Loading…</output></section>
<div class="dock">Labeled controls</div>
```
```css
.hero{position:relative;border-top:1px solid var(--line)}
.answer{position:absolute;left:56px;bottom:44px;color:var(--amber);font:700 clamp(40px,6vw,92px)/1 var(--num)}
.dock{display:grid;grid-template-columns:1fr 1fr auto;gap:28px;border-top:1px solid var(--line);padding:14px 0 18px}
```
Set polyline points and handle cx/cy from subscribed values. Dragging a handle writes its input cell. Supply labeled keyboard controls for the same edits. Use 16px body text, tabular figures, 6px table rows and 14–36px outer padding. Below 820px, move the answer below the plot and stack the dock.
Show loading in the status and answer, replace both on data, explain empty ranges, and show rejected writes inline while retaining input. Keep a bound table if the plot fails.
Do not add a totals strip, card grid or decorative glow. Do not copy sample fields, numbers or formulas.
