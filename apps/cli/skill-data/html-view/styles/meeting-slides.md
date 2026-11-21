# Meeting Slides

Chinese pages: https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5.3.1/900.css https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5.3.1/700.css https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.3.1/500.css https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.3.1/700.css; font-family: "Noto Serif SC", "Songti SC", "STSong", serif; "Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/fraunces@5.3.0/latin-700.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/fraunces@5.3.0/latin-900.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/source-sans-3@5.3.1/latin-500.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/source-sans-3@5.3.1/latin-700.css">
```
```css
:root{--bg:#14110f;--tx:#f4eee3;--dim:#b3a99a;--hot:#ff5a36;--gold:#e9c46a;--line:#3a332c;
 --serif:"Fraunces","Songti SC","STSong",serif;--sans:"Source Sans 3","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif}
```

One conclusion per screen, warm black, serif headings and orange-red highlights.
Skeleton: fixed filter/status bar, section dots, full-height statement, comparison, then a detail table.
```html
<section class="s in"><h1 class="k">One conclusion<br><mark>Live value</mark></h1><p>Units and explanation</p></section>
```
```css
.s{min-height:100dvh;scroll-snap-align:start;padding:76px clamp(20px,7vw,120px) 72px}
.k{font:900 clamp(2.8rem,9vw,7.5rem)/1.22 var(--serif)}
mark{position:relative;background:none;color:#fff;z-index:0}
mark:before{content:"";position:absolute;inset:0;background:var(--hot);z-index:-1}
```
Reveal highlights on section entry. Offer dot buttons and arrow navigation; do not intercept keys in inputs. Comparison bars use white fill and a 4px gold target marker. Charts stay near 46vh, max 420px. Body 18px/1.6; gaps 12–28px; table cells 9px 10px. Below 760px, use proximity snapping, hide dots and reserve space for a wrapped top bar. Respect reduced motion.
Loading belongs in initial HTML and the live status; replace it on data. If a widget needs several bindings or sheets, use one render function that every contributing callback calls. Write placeholders only in the initial HTML, never from another binding's state. Name empty filters; show errors inline and retain failed edits.
Do not add a giant totals strip, small-card dashboard, multiple charts per screen or fake conclusion numbers.
