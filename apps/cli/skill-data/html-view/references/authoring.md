# HTML View authoring

## HTML binding attributes

| Attribute | Syntax | Behavior |
| --- | --- | --- |
| Text | `data-univer-cell-text="<unitId>:<sheetId>:<cell address>"` | Read and subscribe |
| Control | `data-univer-cell-model="<unitId>:<sheetId>:<cell address>"` | Read, subscribe and write |
| Cell callback | `data-univer-cell-subscribe="<unitId>:<sheetId>:<cell address>"` | Subscribe to a cell and deliver state through `subscribeCellById()` |
| Range callback | `data-univer-range-subscribe="<unitId>:<sheetId>:<range address>"` | Subscribe to a range and deliver its matrix through `subscribeRangeById()` |

Replace placeholders with real IDs. Cells use a single A1 address such as `B7`; ranges use
an inclusive rectangle such as `A2:G51` (a one-cell range is `B7:B7`). Encode each ID using
`encodeURIComponent` before joining with colons. References use fixed coordinates. Multiple Units
and repeated references are supported. Use exactly one binding attribute per element.

### Fine-grained subscriptions and traceable bindings

Declare the source on the element that consumes it, so its Unit, worksheet and coordinates are
visible in the HTML/DOM. Register its custom rendering callback by the element's unique HTML `id`.
The `*-subscribe` attributes establish subscriptions without modifying the DOM; callbacks format
values and render ordinary HTML, charts or lists. No source aliases or parent binding scopes apply.

- Use `cell-text` for plain values and `cell-model` for editable native controls.
- Use `cell-subscribe` for a formatted KPI, percentage or progress bar. Independent indicators each
  declare their own cell, even when they use the same source; identical references share data subscriptions.
- Use `range-subscribe` on each table, list or chart for the rows and columns it needs. Avoid one
  page-wide range feeding unrelated widgets: each component should expose its own binding.
  Render generated rows in the callback; each generated child does not need another declaration.
- Include planned record capacity when a list must show new records in currently empty rows,
  while staying inside inspected worksheet bounds. Fixed ranges do not grow automatically.
- Use `getCellState()` / `getRangeState()` for one-time reads in button actions or submission checks.

Fine granularity describes declared data dependencies and value-change callbacks. Notifications
contain current values, may coalesce edits and omit unchanged values; they are not an edit audit log.

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

For live custom rendering, declare the reference in HTML and subscribe by ID after the element
exists. Pass the literal HTML ID without `#`. Cell callbacks require `data-univer-cell-subscribe`;
range callbacks require `data-univer-range-subscribe`. Missing or duplicate IDs, mismatched binding
kinds and invalid references reject the Promise. Replace both source IDs below with discovered IDs:

```html
<output id="formatted-value"
  data-univer-cell-subscribe="REAL_UNIT_ID:REAL_SHEET_ID:B7">加载中</output>
<script type="module">
  const binding = window.univerBinding;
  const output = document.querySelector('#formatted-value');
  const formatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });

  try {
    await binding.subscribeCellById('formatted-value', (state) => {
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
| `subscribeCellById(elementId, listener)` | Current state, then updates; resolves to a subscription with `dispose()` |
| `getRangeState(reference)` | `{ value: [[...], ...] }`, rows then columns |
| `subscribeRangeById(elementId, listener)` | Current range state, then updates; resolves to a subscription with `dispose()` |
| `setCellValue(reference, value)` | Completes the local write; accepts a string, finite number or boolean |
| `insertRowsWithValues(params)` | Inserts whole rows and fills their values in one local operation; call `flush()` for save confirmation |
| `getCollaborationStatus(unitId)` | Current SDK collaboration status |
| `subscribeCollaborationStatus(unitId, listener)` | Current status, then updates; resolves to a subscription with `dispose()` |
| `flush()` | Submits HTML control drafts and waits for issued writes and collaboration confirmation |

For a range-driven component, keep the source on its container:

```html
<pre id="records" data-univer-range-subscribe="REAL_UNIT_ID:REAL_SHEET_ID:A2:G51">加载中</pre>
<script type="module">
  const output = document.getElementById('records');
  try {
    await window.univerBinding.subscribeRangeById('records', ({ value }) => {
      // value[0] is A2:G2; each update supplies the full matrix, not a delta.
      output.textContent = JSON.stringify(value);
    });
  } catch (error) {
    output.textContent = error instanceof Error ? error.message : String(error);
  }
</script>
```

JavaScript references for one-time reads and writes use **unencoded** Unit and Sheet IDs.
`B7` is `{ unitId, sheetId, row: 6, col: 1 }`. For `getRangeState()`, `A2:G51` is
`{ unitId, sheetId, range: { startRow: 1, endRow: 50, startColumn: 0, endColumn: 6 } }`;
all coordinates are zero-based and both range ends are inclusive.

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

Subscriptions deliver their initial state before the returned Promise resolves; do not access the
returned subscription inside that first callback. `dispose()` stops only that callback and is
idempotent. The element's declaration keeps its data subscription even with no callbacks.
Changing the reference attribute switches sources while retaining callbacks and ignores late updates
from the old source. Removing the element or binding attribute releases its binding and callbacks;
a replacement element with the same ID needs a new ById registration. Remove the declaration when
a component no longer needs data, and dispose its chart/observer resources. Page teardown releases
all remaining subscriptions; disposal does not save writes.

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
`subscribeRangeById`, read [charts](charts.md).
