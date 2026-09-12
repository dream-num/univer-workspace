---
name: univer-html-view
description: Create HTML dashboards and forms bound to live Univer Sheet cells using data-univer-cell-text and data-univer-cell-model. Validate and publish .univer.html files with univer_html_view.
---

# Univer HTML Views

Create a responsive HTML/CSS file connected to existing Sheet Units. Discover the source with
Workspace document tools and inspect its sheets, values and formulas. Use the actual Unit ID
and Sheet ID returned by the tools; Resource ID and worksheet name are different identifiers.

## Syntax

| Attribute | Syntax | Behavior |
| --- | --- | --- |
| Text | `data-univer-cell-text="<unitId>:<sheetId>:<cell address>"` | Read and subscribe |
| Control | `data-univer-cell-model="<unitId>:<sheetId>:<cell address>"` | Read, subscribe and write |

Replace placeholders with real IDs and a single A1 address, such as `B7`. Encode each ID using
`encodeURIComponent` before joining with colons. References use fixed coordinates. Multiple Units
and repeated references are supported, with up to 100 binding elements and a 1 MiB file limit.

```html
<section>
  <h2>期末现金</h2>
  <p><strong data-univer-cell-text="REAL_UNIT_ID:REAL_SHEET_ID:B14">加载中</strong> 百万</p>
  <label for="hires">新增招聘</label>
  <input id="hires" type="range" min="0" max="40" step="1"
    data-univer-cell-model="REAL_UNIT_ID:REAL_SHEET_ID:B7">
  <output for="hires" data-univer-cell-text="REAL_UNIT_ID:REAL_SHEET_ID:B7"></output> 人
</section>
```

Text displays the raw value or formula result. Put each text binding on a dedicated value element;
it replaces that element's content. Use native controls: number/range write numbers, checkbox
writes booleans, text/textarea/single select write strings. Use `min`, `max`, `step` for constraints.
Range inputs submit at most once per 100 ms while dragging and submit the final value on change.
Other controls submit on change. Bind calculated output with text; keep calculations in Sheet
formulas. Creating a view does not authorize changing the source data or formulas.

Use inline CSS and basic SVG for layout, with system fonts. Fit the primary controls and metrics
within the available viewport; allow scrolling when needed. Template scripts, inline event handlers,
external resources and embedded frames are disabled. HTML file access does not grant source Unit
access. Do not invent connection status or claim an interactive test without running it.

## Validate and publish

Write a complete document to a session-relative `.univer.html` file. Call
`univer_html_view action=validate source="view.univer.html"` to check syntax, access and actual
worksheet bounds. Fix validation errors before calling `action=create` with a name, destination
and stable idempotencyKey. Reuse the key only when retrying identical content and destination.
Return the resulting Workspace URL. Revise by creating a new file using the existing Blob workflow.
