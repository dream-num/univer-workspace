# Blueprint Timeline

Chinese pages: https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.3.1/400.css, https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.3.1/500.css, https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.3.1/700.css, https://cdn.jsdelivr.net/npm/@fontsource/jetbrains-mono@5.3.0/500.css; font-family: "Noto Sans SC", system-ui, sans-serif; IDs and dates: "JetBrains Mono", ui-monospace, monospace.

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/barlow-semi-condensed@5.3.0/500.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/barlow-semi-condensed@5.3.0/700.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/jetbrains-mono@5.3.0/500.css">
```
```css
:root{
  --ground:#e6f0fb; --sheet:#f5f9ff; --ink:#0d2b4e; --ink2:#3d5a80; --line:rgba(31,95,191,.16); --blue:#1f5fbf; --blue-d:#164a96;
  --red:#cf2c10; --done:#d6e4f5; --done-t:#4c6788;
  --mono:"JetBrains Mono","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  --ease:cubic-bezier(.16,1,.3,1);
  --lw:104px;
}
```

Pale engineering grid, restrained blue and monospaced annotations.
Body: 500 16px/1.5 "Barlow Semi Condensed","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif.
Skeleton: heading/status, horizontally scrollable day-axis lanes, sticky edit dock. The page grid uses 20px minor and 100px major lines.
```html
<div class="track"><span class="todayline"></span><button class="chip">Item · date</button></div>
```
```css
.track{position:relative;min-height:80px;background:repeating-linear-gradient(90deg,var(--line) 0 1px,transparent 1px 40px)}
.todayline{position:absolute;inset:0 auto 0 50%;border-left:2px solid var(--ink)}
.chip{position:absolute;left:20%;height:60px;background:var(--blue);color:white;border:1.5px solid var(--blue-d);padding:5px 7px}
```
Position blocks from real dates, pack overlaps into rows, and label status with words and shapes. Use striped red blockers, subdued completed items, 104px sticky lane labels and 20px gaps. Below 980px, move the 288px dock under the timeline; keep horizontal scrolling inside the sheet.
Replace loading in lanes/status on data. Give empty and undated items explicit treatment. Show load/write errors visibly; retain failed input and label local trials.
Do not add giant totals, decorative shadows, color-only statuses or copied sample columns.
