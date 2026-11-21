# Citron Poster


```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/space-grotesk@5.2.10/700.css">
```
```css
:root{scrollbar-color:var(--accent) var(--bg);scrollbar-width:thin}
:root{--bg:#f9e94e;--surface:#fff9c7;--ink:#242719;--muted:#53572c;--accent:#283e2a;--on-accent:#fff9c7;--line:#8e904e;--error:#9a2020;--radius:0;--body:system-ui,'PingFang SC','Microsoft YaHei',sans-serif;--title:700 clamp(48px,7vw,96px) 'Space Grotesk',system-ui,'PingFang SC','Microsoft YaHei',sans-serif}
```

Lemon yellow, dark green and oversized ranked names.
The template has no Chinese pages: header line. It uses system CJK fallbacks in the stacks below.
Skeleton: large poster headline and short invitation, ranked list beside a dark participation panel, status and source note.
```html
<div class="rally"><section><div class="rank"><small>Rank</small><strong>Live name</strong><span>Value</span></div></section><aside class="join">Labeled form and save status</aside></div>
```
```css
.rally{display:grid;grid-template-columns:3fr 2fr;gap:48px}
.rank{display:grid;grid-template-columns:48px 1fr auto;gap:16px;align-items:baseline;border-bottom:1px solid var(--ink);padding:20px 0}
.rank:first-child{border-top:4px solid var(--ink)}
.join{background:var(--accent);color:var(--on-accent);padding:28px;align-self:start}
```
Use 24–38px ranked names, a 48–96px headline, 16px/1.55 body text and tabular values. Max width 1120px, outer padding 48px 40px. Below 700px, stack at 32px gap with 28px 20px outer padding. Keep controls at least 44px high and long names wrappable.
Replace initial list/count loading on data. Invite the first entry for empty data. Show load and write errors as visible text, retain drafts, disable duplicate submissions while pending, and label trial writes.
Do not add a giant totals strip, rounded cards or decorative gradients. Do not imply unlimited capacity or copy sample fields/data.
