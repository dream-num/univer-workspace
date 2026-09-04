---
name: univer-board
description: Create, edit, chart, inspect, and review Univer Board canvas Units through DSH tools and the Lite Interface. Use proactively for Board shapes, text, connectors, routing, images, native charts, diagrams, canvas layout, or any Board Unit task.
---

# Univer Board Units

Load `univer` first. Create the Board with `univer_unit` in a draft worktree and retain its `unitId`. `univer_execute` provides `univerAPI`, `api`, and the selected `FBoard` as `board`; do not redeclare them.

Resolve exact methods with `univer_api`, especially `FBoard.insertShape`, `FBoard.insertShapes`,
`FShape`, connector methods, `FBoard.newChart`, `FBoard.insertChart`, `FBoard.getCharts`, and
`FBoard.getChart`.

```js
const shape = board.insertShape({
  shapeType: api.Enum.ShapeTypeEnum.RoundRect,
  transform: { left: 80, top: 80, width: 180, height: 100 },
});
if (!shape) throw new Error("Cannot insert Board shape");
shape.getText().setText("Review");
return { shapeId: shape.getId(), elements: board.describeElements() };
```

`insertShape` accepts `IShapeCreateInput`: geometry belongs in `transform`, visual data belongs in `shapeData`, and text is edited through the returned live handle. It does not accept top-level `id`, `left`, `top`, `width`, `height`, or `text`. Retain generated IDs immediately.

Use `board.getElements()`, `board.describeElements()`, or `board.save()` for persisted model readback.

## Connectors and layout

Create related shapes with `insertShapes()` before creating connectors. Use generated element IDs and bound endpoints. For multi-node diagrams, prefer `routing: "orthogonal"` and `routingMode: "auto"`; use straight for a short clear corridor, curve for a self-loop or compact feedback edge, and free polyline only for intentionally manual geometry.

Choose outward connection sites from planned geometry: Right → Left for left-to-right flow and Bottom → Top for top-to-bottom flow. Keep feedback edges on an outer lane.

```js
const shapes = board.insertShapes([
  {
    shapeType: api.Enum.ShapeTypeEnum.RoundRect,
    transform: { left: 80, top: 80, width: 180, height: 100 },
  },
  {
    shapeType: api.Enum.ShapeTypeEnum.RoundRect,
    transform: { left: 400, top: 80, width: 180, height: 100 },
  },
]);
if (!shapes || shapes.length !== 2) throw new Error("Cannot insert Board shapes");
const [source, target] = shapes;
const connectors = board.insertConnectors([
  {
    fromElementId: source.getId(),
    toElementId: target.getId(),
    fromConnectionSiteId: api.Enum.BoardConnectorSite.Right,
    toConnectionSiteId: api.Enum.BoardConnectorSite.Left,
    routing: "orthogonal",
    routingMode: "auto",
    style: { endMarker: { type: "filledTriangle", size: "md" } },
  },
]);
if (!connectors) throw new Error("Cannot insert Board connectors");
const analysis = board.analyzeModelLayout(48);
if (!analysis) throw new Error("Cannot analyze Board layout");
return { connectorIds: connectors.map((item) => item.id), analysis };
```

Treat `element-overlap`, `connector-through-element`, and `connector-collinear-overlap` as blocking. Treat `connector-crossing` as a warning that still requires review. Model analysis reports auto connectors without persisted route points as unresolved because the browser owns final routing; do not infer a clear route from missing points.

Endpoint lint applies to every connector. A free endpoint close to a connectable element should be rebound with `board.setConnectorConnection()`. For sequence diagrams, use the declared sequence-shape and lifeline endpoint contracts; do not fake lifelines with dashed connectors. `normalizeConnectorRouting()` does not repair endpoint semantics.

Specify connector intent, marker type/size/offset, and routing. Imported/manual routes can expose marker-target overlap, corner overlap, marker collision, short terminal stems, or dash discontinuity. Treat overlaps/collisions as errors and review stem/dash warnings. Normalize only the named affected connectors, at most once, then read model analysis again; do not loop or move unrelated elements automatically.

## Images

Use user-provided workspace assets or the bundled SVG resource library. For bundled icons, logos, emoji, or illustrations, call `univer_resources` with `action: "find"`, then `action: "export"` into a workspace directory. Pass local SVG or bitmap data as a Base64 data URI to `board.insertImage()` with `ImageSourceType.BASE64`. Preserve intrinsic colors unless the resource reports `colorEditable: true`. Record the returned element ID and verify source type, bounds, and stacking order through a fresh read.

Do not use Unicode glyphs as a substitute for required icons or illustrations. Do not persist temporary signed URLs.

## Native charts

Native Board charts are owned directly by `FBoard`. Build detached chart information, then await
insertion to obtain a live `FBoardChart`:

```js
const info = board
  .newChart(univerAPI.Enum.ChartTypeString.Column)
  .setTitle({ text: "Quarterly Revenue" })
  .setSource([
    ["Quarter", "Revenue"],
    ["Q1", 12],
    ["Q2", 18],
    ["Q3", 15],
  ])
  .setCategoryField(0)
  .setValueFields([1])
  .setAbsolutePosition(80, 80)
  .setSize(640, 360)
  .build();
const inserted = await board.insertChart(info);
return { chartId: inserted.getId(), info: inserted.getInfo(), data: inserted.getDataSource() };
```

`board.getCharts()` and `board.getChart(id)` return live charts. Common setters update the live
chart; await `chart.setDataSource(values)` for data changes. For a complete replacement, use
`chart.toBuilder().build()` and `await chart.update(info)`. Remove it with `await chart.remove()`
and check the boolean. Await insertion, data updates, replacement, and removal before execution
returns.

Verify in a later read-only execution with
`board.getCharts().map((item) => ({ id: item.getId(), type: item.getType(), info: item.getInfo(), data: item.getDataSource() }))`,
confirming ID, count, type, title, position, size, and data.

## Verification

After every mutation:

1. Read back all relevant elements with `board.describeElements()` or `board.save()` in a fresh `univer_execute`.
2. Verify IDs, kinds, bounds, text, styles, stacking, connector endpoints/routing, image sources, chart descriptions, and any layout-analysis findings.
3. Review the DSH live preview for final route placement, clipping, marker paint, contrast, and overall canvas composition. Model readback alone cannot establish browser-routed geometry.
4. Call `univer_screenshot` for the full Board and inspect its returned metadata, including rendered connector layout analysis when present. For a defect, capture either its `focusBounds` as `region` or the connector and endpoint IDs as `elementIds`, with useful `padding` and `scale`, then inspect the focused PNG. Re-run one full overview after fixes.
5. Follow the `univer` ready/status workflow.

Mind maps, tables, ink, and advanced editing remain outside this Skill's verified authoring contract. Board export is unsupported; deliver the ready worktree preview.
