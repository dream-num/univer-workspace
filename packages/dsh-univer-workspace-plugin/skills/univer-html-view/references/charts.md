# Charts in Workspace HTML views

Use this reference when a page needs ECharts or another JavaScript chart library.

## Load the library

Workspace supplies `window.univerBinding`, not ECharts. The file preview allows
`https://cdn.jsdelivr.net`. Load a fixed version of the browser distribution before initialization:

```html
<script src="https://cdn.jsdelivr.net/npm/echarts@6.0.0/dist/echarts.min.js"></script>
```

Keep this a classic script without `async` so later scripts can use the `echarts` global. Display a
loading error if the library cannot be fetched. Other origins require host configuration; changing
the template or passing an option to `univer_html_view` cannot configure that policy.

For a self-contained page, embed a pinned npm browser distribution as inline JavaScript or bundle
the library and chart code together. Preserve license notices. When serializing JavaScript into HTML,
escape case-insensitive `</script` sequences as `<\/script` so the HTML parser does not end the script
early. Include the actual library bytes, not a placeholder. Relative files beside the HTML are not
published with its Blob.

For modular builds, include the selected chart types, components and a Canvas or SVG renderer.

## Update a chart from a range

After the ECharts browser bundle has defined `echarts`, this example reads two columns:
category labels in column A and numeric values in column B. Replace the IDs and coordinates with
an inspected source range. Keep numeric data numeric; format it in chart labels or tooltips.

```html
<div id="chart" style="width:100%;height:360px"></div>
<p id="chart-error" role="alert"></p>
<script type="module">
  const element = document.querySelector('#chart');
  const errorOutput = document.querySelector('#chart-error');
  const chart = echarts.init(element);
  const resize = new ResizeObserver(() => chart.resize());
  resize.observe(element);
  let subscription;
  try {
    subscription = await window.univerBinding.subscribeRange({
      unitId: 'REAL_UNIT_ID',
      sheetId: 'REAL_SHEET_ID',
      range: { startRow: 1, endRow: 3, startColumn: 0, endColumn: 1 },
    }, ({ value }) => {
      const rows = value.filter(([label]) => label !== null && label !== '');
      chart.setOption({
        tooltip: { trigger: 'axis' },
        xAxis: { type: 'category', data: rows.map(([label]) => String(label)) },
        yAxis: { type: 'value' },
        series: [{
          id: 'counts',
          type: 'bar',
          data: rows.map(([, count]) => typeof count === 'number' ? count : null),
        }],
      });
    });
  } catch (error) {
    errorOutput.textContent = error instanceof Error ? error.message : String(error);
  }
  window.addEventListener('pagehide', () => {
    subscription?.dispose();
    resize.disconnect();
    chart.dispose();
  }, { once: true });
</script>
```

Give the container a nonzero size before initialization. A custom view that removes or replaces the
chart must also dispose its subscription, observer and chart at that point. Subscription updates
supply the full current range; replace chart data rather than appending each notification as new rows.

Check the template for library loading order, container size, source coordinates, chart updates and
disposal. `univer_html_view validate` does not execute chart scripts. Follow the Skill's template-only
verification workflow; do not report rendering or live chart updates as verified.

Official references: [ECharts imports](https://echarts.apache.org/handbook/en/basics/import/),
[dynamic data](https://echarts.apache.org/handbook/en/how-to/data/dynamic-data/),
[container size](https://echarts.apache.org/handbook/en/concepts/chart-size/).
