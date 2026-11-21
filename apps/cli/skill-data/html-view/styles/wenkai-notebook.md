# Ink Notebook

Chinese pages: https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.7.0/style.css; font-family: "LXGW WenKai", "Songti SC", "STSong", serif.

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/kalam@5.2.8/400.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/kalam@5.2.8/700.css">
```
```css
:root{
  --paper:#f7f2e6; --rule:#cfdbe8; --margin:#e3a79a; --ink:#1f3a6b; --ink2:#4c628c; --ver:#c4361d; --ver-d:#a52b16;
  --lh:36px;
  --ease:cubic-bezier(.16,1,.3,1);
}
```

Cream ruled paper, handwriting and vermilion annotations.
Body: 400 18px/var(--lh) "Kalam","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif. Chinese pages put LXGW WenKai first.
Skeleton: narrow notebook page, underlined heading, status-grouped lists and an inline entry form. Keep the red margin outside the writing area.
```html
<button class="st" aria-label="Change status"><svg viewBox="0 0 30 30" aria-hidden="true"><path d="M5 15l6 7L25 6"/></svg></button>
```
```css
body{background:repeating-linear-gradient(var(--paper) 0 35px,var(--rule) 35px 36px)}
.st{width:44px;height:var(--lh);border:0;background:none;color:var(--ink)}
.st svg{width:30px;height:30px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
```
Use distinct hand-drawn marks plus accessible status names; blocked items get vermilion words, completed names a strike-through. Align rows and section gaps to the 36px ruling. Max page width 820px, left writing inset 46–120px; wrap metadata on phones. Below 560px, put save status in normal flow.
Replace initial loading in lists/status on data. Write an empty-list message. Show failures in vermilion text with role="alert", preserve drafts and label pending/saved/trial states.
Do not add giant totals, dashboard cards, glossy effects or copied sample fields. Do not rely on marks alone to explain status.
