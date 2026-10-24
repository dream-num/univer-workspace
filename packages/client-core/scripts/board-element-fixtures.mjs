import assert from "node:assert/strict";

export const elementProfiles = [
  "builtin-shapes",
  "custom-shapes",
  "sequence-shapes",
  "table-presets",
  "connector-grammar",
  "label-grammar",
  "text-image-ink-chart",
  "container-grammar",
  "transform-style",
  "native-sheet-embed",
  "formula-bound-shapes",
];
const markers = [
  "none",
  "openArrow",
  "filledArrow",
  "openTriangle",
  "filledTriangle",
  "openDiamond",
  "filledDiamond",
  "openCircle",
  "filledCircle",
  "bar",
  "doubleBar",
  "crowFoot",
  "cross",
  "plus",
  "composite",
];
const point = (index, width = 230, height = 190, columns = 5) => ({
  x: 70 + (index % columns) * width,
  y: 90 + Math.floor(index / columns) * height,
});

export async function realizeElementFixture(board, api, profile) {
  assert.ok(elementProfiles.includes(profile), "Unknown element catalogue");
  const E = api.Enum;
  const covered = [];
  const ids = [];
  const expect = [];
  const renderUnits = {};
  const ensure = (value, reason) => {
    assert.ok(value, reason);
    return value;
  };
  const caption = (text, x, y, width = 220) =>
    ensure(
      board.insertText({
        left: x,
        top: y,
        width,
        height: 38,
        text,
        textStyle: { fontFamily: "Arial", fontSize: 12, color: "#334155" },
      }),
      "Caption insertion failed",
    );
  const shape = (shapeType, index, options = {}) => {
    const p = profile === "sequence-shapes" ? point(index, 260, 310, 4) : point(index);
    const native = options.shapeData
      ? ensure(
          board.insertShape({
            shapeType,
            transform: { left: p.x, top: p.y, width: 154, height: 100 },
            shapeData: options.shapeData,
          }),
          `Shape unavailable: ${shapeType}`,
        )
      : undefined;
    const ref = native
      ? board.getElement(native.getId())
      : ensure(
          board.insertShapeAtPoint({
            shapeType,
            point: p,
            width: 154,
            height: 100,
            attachToDropTarget: false,
            ...options,
          }),
          `Shape unavailable: ${shapeType}`,
        );
    ids.push(ref.id);
    caption(shapeType, p.x - 12, p.y + (profile === "sequence-shapes" ? 180 : 110));
    covered.push({ feature: "shape", shapeType, elementId: ref.id });
    return ref;
  };
  if (["native-sheet-embed", "formula-bound-shapes"].includes(profile)) {
    const workbookId = `catalogue-${profile}-source`,
      sheetId = `${workbookId}-sales`;
    const workbook = api.createWorkbook(
      {
        id: workbookId,
        name: "Quarterly sales / 季度销售",
        sheetOrder: [sheetId],
        sheets: {
          [sheetId]: {
            id: sheetId,
            name: "Sales",
            rowCount: 12,
            columnCount: 5,
            cellData: {
              0: { 0: { v: "Quarter" }, 1: { v: "Orders" } },
              1: { 0: { v: "Q1" }, 1: { v: 120 } },
              2: { 0: { v: "Q2" }, 1: { v: 168 } },
              3: { 0: { v: "Q3" }, 1: { v: 192 } },
              4: { 0: { v: "Q4" }, 1: { v: 226 } },
            },
          },
        },
      },
      { makeCurrent: false },
    );
    ensure(workbook, "Embedded/reference source creation failed");
    const unit = { unitType: "sheet", unitData: workbook.save() };
    if (profile === "native-sheet-embed") {
      const embed = api.createEmbed({
        embedId: "catalogue-sales-embed",
        host: {
          unitId: board.getId(),
          surface: E.FEmbedHostSurface.BoardFloating,
          context: { left: 70, top: 130, width: 940, height: 520 },
        },
        content: {
          unitType: E.UniverInstanceType.UNIVER_SHEET,
          ref: `#unit=${workbookId}&type=sheet`,
        },
        displayTarget: { subUnitId: sheetId },
      });
      ensure(embed, "Native Embed creation failed");
      const child = await embed.loadAsync();
      assert.equal(child.getId(), workbookId, "Embed loaded a different child");
      ensure(board.getElement(embed.getHostAnchorId()), "Embed host anchor missing");
      ids.push(embed.getHostAnchorId());
      renderUnits.embeddedUnits = [unit];
      covered.push({
        feature: "native-sheet-embed",
        descriptorId: embed.getId(),
        elementId: embed.getHostAnchorId(),
        childUnitId: child.getId(),
        expectedVisibleContent: [
          ["Quarter", "Orders"],
          ["Q1", "120"],
          ["Q2", "168"],
          ["Q3", "192"],
          ["Q4", "226"],
        ],
        staticModelLoaded: true,
        actualChildPixelsAndInteraction: "pending",
      });
      caption("Native editable Sheet embed / 原生可编辑表格子文档", 70, 50, 1000);
    } else {
      for (const [index, formula] of ["=SUM(120,168)", "external"].entries()) {
        const ref = ensure(
          board.insertShape({
            shapeType: E.ShapeTypeEnum.RoundRect,
            transform: { left: 70 + index * 450, top: 180, width: 340, height: 140 },
          }),
          "Formula shape insertion failed",
        );
        if (formula === "external") {
          const source = { unitId: workbookId, formulaQualifier: "Quarterly sales" };
          const reference = api.getFormula().buildReference({
            hostUnitId: board.getId(),
            unit: source,
            target: {
              kind: E.FormulaReferenceType.SHEET_RANGE,
              sheetName: "Sales",
              range: { startRow: 1, endRow: 4, startColumn: 1, endColumn: 1 },
            },
          });
          ref.setFormula({
            formula: `=SUM(${reference})`,
            externalReferences: [
              {
                qualifier: source.formulaQualifier,
                sourceUnitId: source.unitId,
                sourceUnitType: E.UniverInstanceType.UNIVER_SHEET,
              },
            ],
          });
        } else ref.setFormula({ formula, externalReferences: [] });
        ref.setFormulaAnimationEnabled(false);
        ids.push(ref.getId());
        covered.push({
          feature: formula === "external" ? "cross-unit-formula" : "constant-formula",
          elementId: ref.getId(),
          formula: ref.getFormula(),
          expectedRenderedValue: formula === "external" ? "706" : "288",
          actualRenderedValue: "pending",
        });
        caption(
          formula === "external" ? "SUM of source Sheet B2:B5 · 706" : "SUM(120,168) · 288",
          70 + index * 450,
          100,
          420,
        );
      }
      renderUnits.formulaReferenceUnits = [unit];
    }
    const values = workbook.getActiveSheet().getRange("A1:B5").getValues();
    expect.push(() =>
      assert.deepEqual(
        workbook.getActiveSheet().getRange("A1:B5").getValues(),
        values,
        "Child/reference source values changed",
      ),
    );
  } else if (["builtin-shapes", "custom-shapes", "sequence-shapes"].includes(profile)) {
    const source = {
      "builtin-shapes": E.ShapeTypeEnum,
      "custom-shapes": E.BoardCustomShapeType,
      "sequence-shapes": E.BoardSequenceShapeType,
    }[profile];
    // None is the absence of a shape; SmartArt is an import/adapter slot rather than a registered preset.
    const types = [...new Set(Object.values(source))].filter(
      (type) => !["none", "smartArt"].includes(type),
    );
    for (const [index, type] of types.entries()) {
      const options =
        profile === "sequence-shapes" && type !== E.BoardSequenceShapeType.ActivationBar
          ? {
              shapeData: {
                sequenceLifeline: {
                  participantShapeType: "object",
                  participantEngineShapeType: E.ShapeTypeEnum.RoundRect,
                  lifelineHeight: 60,
                  minLifelineHeight: 40,
                },
              },
            }
          : {};
      shape(type, index, options);
    }
    expect.push(() =>
      assert.equal(covered.length, types.length, "A public shape preset was skipped"),
    );
  } else if (profile === "table-presets") {
    let left = 70;
    let top = 90;
    let rowHeight = 0;
    for (const [index, preset] of Object.values(E.BoardTableDiagramPreset).entries()) {
      if (index && index % 3 === 0) {
        left = 70;
        top += rowHeight + 88;
        rowHeight = 0;
      }
      const table = ensure(
        board.insertTable({ left, top, diagramPreset: preset }),
        `Table preset unavailable: ${preset}`,
      );
      const document = table.getCellRichText(0, 0).getData();
      const style = JSON.parse(
        JSON.stringify(document.body?.textRuns?.[0]?.ts ?? document.documentStyle?.textStyle ?? {}),
      );
      ensure(
        table.setCellRichText(0, 0, api.newRichText().span(`${preset} / 领域数据`, style)),
        "Table caption failed",
      );
      const bounds = board.getElement(table.getId()).transform;
      caption(preset, left, top - 38, bounds.width);
      left += bounds.width + 80;
      rowHeight = Math.max(rowHeight, bounds.height);
      const values = JSON.parse(JSON.stringify(table.getValues()));
      expect.push(() => {
        assert.deepEqual(table.getValues(), values, "Table resource values changed");
        const actualStyle = table.getCellRichText(0, 0).getData().body.textRuns[0].ts;
        for (const [key, value] of Object.entries(style))
          assert.deepEqual(actualStyle[key], value, "Native preset caption style changed");
      });
      ids.push(table.getId());
      covered.push({ feature: "table-preset", preset, elementId: table.getId() });
    }
  } else if (profile === "connector-grammar") {
    for (const [index, marker] of markers.entries()) {
      const p = point(index, 370, 160, 3);
      const a = ensure(
        board.insertShapeAtPoint({
          shapeType: E.ShapeTypeEnum.RoundRect,
          point: p,
          width: 60,
          height: 42,
          attachToDropTarget: false,
        }),
        "Endpoint insertion failed",
      );
      const b = ensure(
        board.insertShapeAtPoint({
          shapeType: E.ShapeTypeEnum.Ellipse,
          point: { x: p.x + 255, y: p.y },
          width: 60,
          height: 42,
          attachToDropTarget: false,
        }),
        "Endpoint insertion failed",
      );
      const c = ensure(
        board.insertConnector({
          fromElementId: a.id,
          toElementId: b.id,
          labelText: marker,
          routing: ["straight", "orthogonal", "curve", "freePolyline"][index % 4],
          ...(index % 4 === 3
            ? {
                routingMode: "manual",
                waypoints: [
                  {
                    id: `catalogue-${index}-waypoint`,
                    kind: "manual",
                    x: p.x + 170,
                    y: p.y + 72,
                    locked: true,
                  },
                ],
              }
            : {}),
          style: {
            stroke: "#334155",
            strokeWidth: index % 3 === 0 ? 2.5 : 1.25,
            startMarker: { type: "openCircle" },
            endMarker: {
              type: marker,
              ...(marker === "composite" ? { parts: ["bar", "crowFoot"] } : {}),
            },
            ...(index % 2 ? { dash: [5, 3] } : {}),
          },
        }),
        "Marker connector insertion failed",
      );
      covered.push({ feature: "marker", marker, elementId: c.id });
      ids.push(a.id, b.id);
    }
  } else if (profile === "label-grammar") {
    const anchors = ["start", "center", "end", "path", "auto"];
    for (let index = 0; index < 15; index++) {
      const p = point(index, 560, 240, 2);
      const anchor = anchors[index % anchors.length],
        side = ["left", "onPath", "right"][index % 3],
        orientation = ["horizontal", "followPath", "auto"][Math.floor(index / 5)];
      const layout = [
        { mode: "autoSize" },
        { mode: "fixedWidth", width: 150 },
        { mode: "fixedSize", width: 180, height: 64 },
      ][index % 3];
      const a = ensure(
        board.insertShapeAtPoint({
          shapeType: E.ShapeTypeEnum.RoundRect,
          point: p,
          width: 54,
          height: 44,
          attachToDropTarget: false,
        }),
        "Label source failed",
      );
      const b = ensure(
        board.insertShapeAtPoint({
          shapeType: E.ShapeTypeEnum.RoundRect,
          point: { x: p.x + 420, y: p.y + 65 },
          width: 54,
          height: 44,
          attachToDropTarget: false,
        }),
        "Label target failed",
      );
      const c = ensure(
        board.insertConnector({
          fromElementId: a.id,
          toElementId: b.id,
          routing: index % 2 ? "orthogonal" : "straight",
          labels: [
            {
              id: "semantic-label",
              content: "授权范围 / Permission scope",
              layout,
              placement: {
                mode: "fixed",
                anchor,
                side,
                orientation,
                distance: 8,
                pathRatio: anchor === "path" ? 0.35 : undefined,
              },
              style: {
                fill: { color: index % 2 ? "#eff6ff" : "#ffffff", opacity: 0.95 },
                interruptLine: index % 2 === 0,
                lineGap: 5,
              },
            },
          ],
          style: { stroke: "#475569", strokeWidth: 1.5, endMarker: { type: "filledArrow" } },
        }),
        "Label grammar insertion failed",
      );
      caption(`${anchor} / ${side} / ${orientation} / ${layout.mode}`, p.x, p.y + 160, 510);
      ids.push(a.id, b.id);
      covered.push({
        feature: "label-placement-sizing",
        anchor,
        side,
        orientation,
        layout,
        elementId: c.id,
      });
    }
  } else if (profile === "text-image-ink-chart") {
    const rich = api
      .newRichText()
      .span("Quarterly operations / 季度运营", {
        fontFamily: "Arial",
        fontSize: 18,
        bold: true,
        color: "#0f172a",
      })
      .paragraph({ spaceAfter: 8 })
      .span("Editable text, embedded data and visual annotations retain their source models.", {
        fontFamily: "Arial",
        fontSize: 11,
        bold: false,
        color: "#475569",
      });
    const text = ensure(
      board.insertText({ left: 70, top: 60, width: 700, height: 130, text: rich }),
      "Rich text insertion failed",
    );
    ids.push(text.id);
    covered.push({ feature: "standalone-rich-text", elementId: text.id });
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="140"><rect width="240" height="140" rx="12" fill="#eff6ff"/><path d="M30 108L75 62L115 86L170 28L215 50" fill="none" stroke="#2563eb" stroke-width="8"/><circle cx="170" cy="28" r="9" fill="#059669"/></svg>';
    const image = ensure(
      board.insertImage({
        source: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
        left: 70,
        top: 230,
        width: 240,
        height: 140,
      }),
      "Image insertion failed",
    );
    ids.push(image.id);
    covered.push({ feature: "embedded-image", elementId: image.id });
    const ink = ensure(
      board.insertInk({
        model: {
          kind: "brush",
          points: [
            { x: 80, y: 435, t: 0 },
            { x: 145, y: 410, t: 1 },
            { x: 210, y: 448, t: 2 },
            { x: 280, y: 420, t: 3 },
          ],
          color: "#be185d",
          width: 5,
          opacity: 1,
        },
      }),
      "Persistent Ink insertion failed",
    );
    ids.push(ink.id);
    covered.push({ feature: "persistent-ink", elementId: ink.id });
    const chartInfo = board
      .newChart(E.ChartTypeString.Column)
      .setSource([
        ["Quarter", "Orders", "Returns"],
        ["Q1", 120, 4],
        ["Q2", 168, 5],
        ["Q3", 192, 3],
        ["Q4", 226, 6],
      ])
      .setAbsolutePosition(410, 220)
      .setSize(660, 430)
      .setTitle("Orders and returns / 订单与退货")
      .build();
    const chart = ensure(await board.insertChart(chartInfo), "Chart insertion failed");
    ids.push(chart.getElementId());
    covered.push({ feature: "inline-data-chart", elementId: chart.getElementId() });
    caption("Embedded image", 70, 378);
    caption("Editable persistent Ink", 70, 475);
  } else if (profile === "container-grammar") {
    for (const [index, kind] of ["generic", "system-boundary", "uml-package"].entries()) {
      const p = point(index, 440, 350, 3),
        id = `catalogue-${kind}`;
      ensure(
        board.createContainer({
          id,
          kind,
          left: p.x,
          top: p.y,
          width: 390,
          height: 270,
          title: `${kind} · 外部标题`,
          fillColor: "#f8fafc",
          strokeColor: "#64748b",
        }),
        "Container insertion failed",
      );
      const c = board.getElement(id);
      ensure(
        board.updateElement(id, {
          element: { ...c, containerData: { ...c.containerData, headerSize: 0 } },
        }),
        "External caption failed",
      );
      ensure(
        board.insertShapeAtPoint({
          parentId: id,
          shapeType: E.ShapeTypeEnum.RoundRect,
          point: { x: p.x + 50, y: p.y + 65 },
          width: 220,
          height: 90,
          text: "Owned content / 容器内容",
          attachToDropTarget: false,
        }),
        "Container child insertion failed",
      );
      covered.push({ feature: "container-kind", kind, elementId: id });
      ids.push(id);
    }
    for (const [index, orientation] of ["horizontal", "vertical"].entries()) {
      const id = `catalogue-swimlane-${orientation}`;
      ensure(
        board.createSwimlane({
          id,
          left: 70 + index * 650,
          top: 490,
          width: 580,
          height: 470,
          orientation,
          title: `Swimlane · ${orientation}`,
          lanes: [
            { id: "engineering", title: "Engineering / 工程", size: 190 },
            { id: "operations", title: "Operations / 运营", size: 190 },
          ],
        }),
        "Swimlane insertion failed",
      );
      covered.push({ feature: "swimlane-orientation", orientation, elementId: id });
      ids.push(id);
    }
  } else if (profile === "transform-style") {
    for (const [index, options] of [
      { rotation: 0 },
      { rotation: 25 },
      { flipX: true },
      { flipY: true },
      { rotation: 25, flipX: true },
      { rotation: 25, flipY: true },
    ].entries()) {
      const a = shape(E.ShapeTypeEnum.RightTriangle, index, {
        text: `Asymmetric ${index + 1}`,
        fillColor: "#fef3c7",
        strokeColor: "#b45309",
        strokeWidth: 2,
      });
      ensure(board.setElementTransform(a.id, options), "Transform application failed");
      const p = point(index);
      const c = ensure(
        board.insertConnector({
          start: {
            kind: "shapeBoundary",
            shapeId: a.id,
            outlineIndex: 0,
            segmentIndex: 0,
            segmentT: 0.5,
          },
          end: { kind: "free", x: p.x + 190, y: p.y - 20 },
          routing: "orthogonal",
          style: { endMarker: { type: "filledArrow" }, stroke: "#334155" },
        }),
        "Boundary connector failed",
      );
      covered.push({ feature: "transform-and-boundary", options, elementId: c.id });
    }
  }
  const before = JSON.parse(JSON.stringify(board.save()));
  const elementIds = Object.keys(board.getElements());
  return {
    nodes: ids,
    renderUnits,
    fixed: elementIds,
    protected: elementIds,
    layoutOptions: { fixedElementIds: elementIds, maxNodes: 1000 },
    semanticCoverage: {
      source: "element-catalogue",
      authoredCatalogueGeometry: true,
      automatedLayoutQualityClaim: false,
      covered,
      primitiveTypes: [...new Set(Object.values(board.getElements()).map((item) => item.type))],
      notClaimed: [
        "Temporal animation and video/audio playback are not certified by static PNGs",
        "One inline-data chart does not certify every chart type or external data adapter",
      ],
      unavailable: [
        {
          type: "diagram",
          reason: "Declared adapter slot without a persisted Board element interface",
        },
        {
          type: "media",
          reason: "No media render adapter registered in the standard Board render preset",
        },
        {
          type: "placeholder",
          reason: "Template import element; not a directly rendered native Board shape",
        },
        {
          type: "group",
          reason: "Legacy physical group; modern authoring uses semantic containers",
        },
      ],
    },
    verify() {
      expect.forEach((check) => check());
      assert.equal(
        Object.keys(board.getElements()).length,
        elementIds.length,
        "Catalogue element lost",
      );
    },
    verifyLayout() {
      assert.deepEqual(
        JSON.parse(JSON.stringify(board.save())),
        before,
        "Catalogue geometry changed",
      );
    },
  };
}
