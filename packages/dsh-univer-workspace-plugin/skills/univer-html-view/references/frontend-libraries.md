# Frontend libraries in Workspace HTML views

Use these optional libraries when they fit the requested page. Workspace file preview allows
`https://cdn.jsdelivr.net`; it does not preload these libraries. The SDK enforces an origin policy,
not a package whitelist, so this selection is guidance rather than an exhaustive list of permitted
packages. Other origins still require host configuration.

## Browser entry points

Prefix each path below with `https://cdn.jsdelivr.net/npm/`. These are concrete version examples;
when choosing another version, verify its published browser entry point and API before using it.

| Library | Useful for | Pinned path | Browser API |
| --- | --- | --- | --- |
| [ECharts](https://echarts.apache.org/handbook/en/basics/import/) | Live charts and dashboards | `echarts@6.0.0/dist/echarts.min.js` | `echarts` |
| [Tabulator](https://www.tabulator.info/docs/6.x/quickstart/) | Searchable, sortable tables and editable lists | `tabulator-tables@6.5.2/dist/js/tabulator.min.js` | `Tabulator` |
| [Day.js](https://day.js.org/docs/en/installation/browser) | Dates, formatting and event times | `dayjs@1.11.23/dayjs.min.js` | `dayjs` |
| [SortableJS](https://github.com/SortableJS/Sortable) | Reordering lists and dragging cards | `sortablejs@1.15.7/Sortable.min.js` | `Sortable` |
| [Fuse.js](https://www.fusejs.io/getting-started.html) | Fuzzy search for people, products or records | `fuse.js@7.5.0/dist/fuse.min.mjs` | ES module default import |
| [Papa Parse](https://www.papaparse.com/docs) | Parsing CSV files or text, producing CSV text | `papaparse@5.7.0/papaparse.min.js` | `Papa` |
| [Lucide](https://lucide.dev/guide/lucide) | SVG icons for buttons, status and navigation | `lucide@1.46.0/dist/umd/lucide.min.js` | `lucide` |
| [Alpine.js](https://alpinejs.dev/essentials/installation) | Tabs, dialogs, filters and reactive form UI | `alpinejs@3.17.2/dist/cdn.min.js` | `Alpine`, auto-starting CDN build |

Tabulator also needs its stylesheet:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/tabulator-tables@6.5.2/dist/css/tabulator.min.css">
<script src="https://cdn.jsdelivr.net/npm/tabulator-tables@6.5.2/dist/js/tabulator.min.js"></script>
```

Use classic scripts without `async` before code that needs their globals. Alpine's auto-starting
CDN build uses `defer`; initialize components with `x-data` and do not call `Alpine.start()` again.
Its optional plugins are separate resources and must load before Alpine itself.

Fuse.js 7.5 uses an ES module browser build, not a classic script or a `window.Fuse` global:

```html
<script type="module">
  import Fuse from 'https://cdn.jsdelivr.net/npm/fuse.js@7.5.0/dist/fuse.min.mjs';
  const search = new Fuse([{ name: '林知夏' }], { keys: ['name'] });
  console.log(search.search('知夏'));
</script>
```

Day.js plugins and locales are separate files under the same pinned package version. Load and
extend a plugin when needed; the base bundle alone does not provide timezone or custom-format parsing.
Lucide replaces icon placeholders with SVG; run its icon initialization after inserting those elements.

## Connect components to Sheet data

- Use `subscribeRange` for table rows, chart series and searchable records. Each callback contains
  the full current range; replace component data and rebuild the search collection as needed.
  Keep the original Sheet row coordinate in each record so sorting or filtering does not redirect
  an edit to the wrong cell. A component's displayed row index is not a Sheet row index.
- Table editors, Alpine form state and Sortable drag events are local UI operations. Persist intended
  scalar edits through `setCellValue` and `flush`. Add new records through the binding client's
  `insertRowsWithValues` and `flush`; see [adding records](adding-records.md). These libraries do not
  provide persistence or multi-cell transactions. Do not write data merely because a subscription refreshes UI.
- Papa Parse converts data locally. Parsing CSV does not import or save it into Workspace. Show a
  preview and use the appropriate existing import workflow when the user wants a document import.
- Keep dates in the source's expected representation; display formatting does not authorize changing
  its values. Use `Intl` and native HTML controls when they already satisfy the interaction.
- Dispose subscriptions and component instances when removing the view. Include loading/error states
  in the template and follow the Skill's template-only verification workflow.

For chart sizing, range updates and disposal, use the [ECharts example](charts.md).
