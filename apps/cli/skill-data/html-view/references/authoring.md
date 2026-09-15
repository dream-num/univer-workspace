# HTML View authoring

## HTML binding attributes

| Attribute | Syntax | Behavior |
| --- | --- | --- |
| Text | `data-univer-cell-text="<unitId>:<sheetId>:<cell address>"` | Read and subscribe |
| Control | `data-univer-cell-model="<unitId>:<sheetId>:<cell address>"` | Read, subscribe and write |

Replace placeholders with real IDs and a single A1 address, such as `B7`. Encode each ID using
`encodeURIComponent` before joining with colons. References use fixed coordinates. Multiple Units
and repeated references are supported.

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

Text bindings set `textContent`, replacing the element's content. Put each on a dedicated value
element and use placeholder text while loading. Empty cells display empty text; formula cells
provide their calculated results. Existing Sheet formulas continue to calculate in Univer.

Number/range controls write numbers, checkbox writes booleans, and text/textarea/single select
write strings. Match the control to the cell's value type; use native `min`, `max`, `step` and other
HTML constraints. Range inputs submit at most once per 100 ms while dragging and submit the final
value on change. Other controls submit on change. Invalid or rejected edits retain the draft;
Escape restores the latest cell value. An empty numeric input is not written as zero.

The runtime manages subscriptions when scripts add or remove bound elements or change references.
A text-bound element cannot contain another binding because text updates replace its contents.

## JavaScript data access

Workspace provides `window.univerBinding` before author scripts execute. The host loads and
authorizes Units on demand; page code does not create an Engine or supply collaboration config.
Open the published Workspace URL to use this interface; opening the HTML file alone or in a raw HTML preview does not provide it.

JavaScript references use **unencoded** Unit and Sheet IDs and zero-based `row` / `col` coordinates.
For example, `B7` is `{ row: 6, col: 1 }`. The following page subscribes to a value and applies custom
formatting; replace both IDs with the discovered IDs:

```html
<output id="formatted-value">加载中</output>
<script type="module">
  const binding = window.univerBinding;
  const reference = {
    unitId: 'REAL_UNIT_ID',
    sheetId: 'REAL_SHEET_ID',
    row: 6,
    col: 1,
  };
  const output = document.querySelector('#formatted-value');
  const formatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });

  try {
    await binding.subscribeCell(reference, (state) => {
      output.textContent = typeof state.value === 'number'
        ? formatter.format(state.value)
        : String(state.value ?? '');
    });
  } catch (error) {
    output.textContent = error instanceof Error ? error.message : String(error);
  }
</script>
```

All data methods return Promises:

| Method | Result |
| --- | --- |
| `getCellState(reference)` | `{ value }` |
| `subscribeCell(reference, listener)` | Current state, then updates; resolves to a subscription with `dispose()` |
| `getRangeState(reference)` | `{ value: [[...], ...] }`, rows then columns |
| `subscribeRange(reference, listener)` | Current range state, then updates; resolves to a subscription with `dispose()` |
| `setCellValue(reference, value)` | Completes the local write; accepts a string, finite number or boolean |
| `insertRowsWithValues(params)` | Inserts whole rows and fills their values in one local operation; call `flush()` for save confirmation |
| `getCollaborationStatus(unitId)` | Current SDK collaboration status |
| `subscribeCollaborationStatus(unitId, listener)` | Current status, then updates; resolves to a subscription with `dispose()` |
| `flush()` | Submits HTML control drafts and waits for issued writes and collaboration confirmation |

For lists, charts and summaries, read or subscribe to a range instead of creating a subscription
for every cell. Range references use unencoded IDs and a `range` with zero-based, **inclusive**
`startRow`, `endRow`, `startColumn` and `endColumn`. For example, `A2:G51` is:

```js
const reference = {
  unitId: 'REAL_UNIT_ID',
  sheetId: 'REAL_SHEET_ID',
  range: { startRow: 1, endRow: 50, startColumn: 0, endColumn: 6 },
};
const subscription = await window.univerBinding.subscribeRange(reference, ({ value }) => {
  // value[0] is A2:G2; each update supplies the current range, not a delta.
  console.table(value);
});
// When this view is removed:
// subscription.dispose();
```

Use the inspected worksheet bounds when choosing the range. Subscriptions track fixed coordinates;
a range does not automatically expand when more records are added.

Empty or missing cells return `value: null`. Handle failed writes through Promise rejection.
Strings are written literally: `"2-2"` remains text, and `"=A1"` is not parsed as a formula.
In an intended edit handler, use `await binding.setCellValue(reference, value)` and
`await binding.flush()` before reporting that the edit is saved. JavaScript-managed drafts enter
the save flow only after `setCellValue()` or `insertRowsWithValues()` is called. Display rejected calls as errors and retain
user input for correction. Writing a cell replaces its previous formula or rich text.

Use `setCellValue` to edit existing cells and `insertRowsWithValues` to add records. Insertion shifts
existing rows down and fills the new rows in the same SDK command; do not implement registration by
finding an empty row and issuing separate cell writes. For insertion parameters, a registration-form
example and save retry behavior, read [adding records](adding-records.md).

The page client still does not expose `setRangeValues` or general multi-cell transactions. Several
scalar writes can partially succeed; `flush()` confirms saving and does not make them atomic.
Insertion does not provide business-key uniqueness, idempotency or an atomic append-to-latest-end
API. References remain fixed coordinates after insertion: locate a record again by its stable ID
before editing it, and do not assume a captured row still identifies the same person.

Subscriptions deliver their initial state before the returned Promise resolves. Call the returned
`dispose()` when a custom view no longer needs updates; page teardown cancels remaining subscriptions.

Collaboration status is a string, not an object: `synced` means synchronized; `pending`, `awaiting`,
`awaiting_with_pending` and `fetch_missing` indicate synchronization in progress; `offline` means
disconnected, `conflict` means conflict, and `not_collab` means collaboration is not active. Use these
for a sync indicator with a fallback for unknown values. A status does not include unsent form drafts
and does not replace calling the write method and awaiting `flush()` before reporting a saved edit.

## Frontend libraries

ECharts can run inside the page; it is not preloaded as `window.echarts`. Workspace file preview
allows `https://cdn.jsdelivr.net`, so load a pinned browser build before chart initialization:

```html
<script src="https://cdn.jsdelivr.net/npm/echarts@6.0.0/dist/echarts.min.js"></script>
```

Use a classic script without `async` when subsequent scripts depend on `echarts`. Other external
origins require host configuration; page markup cannot grant itself permission. Inline library
bundles are also supported. Relative JavaScript files beside the Blob are not uploaded automatically.

ECharts, Tabulator, Day.js, SortableJS, Fuse.js, Papa Parse, Lucide and Alpine.js can be loaded
from this CDN for charts, tables, dates, drag-and-drop, search, CSV, icons and page interactions.
These are optional choices, not preloaded globals or an exhaustive package whitelist: the host
allows the CDN origin, not individual npm packages. Load only the libraries the page uses.

For fixed-version URLs, browser entry points and binding integration, read
[frontend libraries](frontend-libraries.md). For an ECharts chart driven by
`subscribeRange`, read [charts](charts.md).
