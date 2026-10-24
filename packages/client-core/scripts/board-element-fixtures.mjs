import assert from "node:assert/strict";
import { repairMeasuredVisualText } from "./board-visual-repair.mjs";

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

export function createCatalogueChartInfo(board, api) {
  return board
    .newChart(api.Enum.ChartTypeString.Column)
    .setSource([
      ["Quarter", "Orders", "Returns"],
      ["Q1", 120, 4],
      ["Q2", 168, 5],
      ["Q3", 192, 3],
      ["Q4", 226, 6],
    ])
    .setSourceHeader({ band: { startOffset: 0, endOffset: 0 } })
    .setCategoryField(0)
    .setValueFields([1, 2])
    .setAbsolutePosition(410, 220)
    .setSize(660, 430)
    .setTitle("Orders and returns / 订单与退货")
    .build();
}

export function createCatalogueChartFamilyInfos(board, api) {
  const families = ["Column", "Bar", "Line", "Area", "Pie", "Donut", "Scatter"];
  return families.map((family, index) => {
    if (family === "Column") return { family, info: createCatalogueChartInfo(board, api) };
    const scatter = family === "Scatter";
    const pie = family === "Pie" || family === "Donut";
    const source = scatter
      ? [
          ["Week", "Orders", "Returns"],
          [1, 120, 4],
          [2, 168, 5],
          [3, 192, 3],
          [4, 226, 6],
        ]
      : [
          ["Quarter", "Orders", "Returns"],
          ["Q1", 120, 4],
          ["Q2", 168, 5],
          ["Q3", 192, 3],
          ["Q4", 226, 6],
        ];
    const builder = board
      .newChart(api.Enum.ChartTypeString[family])
      .setSource(source)
      .setSourceHeader({ band: { startOffset: 0, endOffset: 0 } })
      .setCategoryField(0)
      .setValueFields(pie ? [1] : [1, 2])
      .setAbsolutePosition(70 + ((index - 1) % 2) * 730, 760 + Math.floor((index - 1) / 2) * 520)
      .setSize(660, 430)
      .setTitle(
        `${family} · ${scatter ? "Orders by week / 每周订单" : "Orders by quarter / 季度订单"}`,
      );
    if (family === "Donut") builder.setDoughnutHole(0.5);
    return { family, info: builder.build() };
  });
}

export async function realizeElementFixture(board, api, profile, options = {}) {
  assert.ok(elementProfiles.includes(profile), "Unknown element catalogue");
  const E = api.Enum;
  const covered = [];
  const ids = [];
  const expect = [];
  const renderUnits = {};
  const shapeCaptions = new Map();
  const authoringTextRepairs = [];
  let chartTypeCoverage;
  const ensure = (value, reason) => {
    assert.ok(value, reason);
    return value;
  };
  const caption = (text, x, y, width = 220, height = 38) =>
    ensure(
      board.insertText({
        left: x,
        top: y,
        width,
        height,
        text,
        textStyle: { fontFamily: "Arial", fontSize: 12, color: "#334155" },
      }),
      "Caption insertion failed",
    );
  const shape = (shapeType, index, options = {}) => {
    const p = profile === "sequence-shapes" ? point(index, 260, 310, 4) : point(index);
    const ref = ensure(
      board.insertShapeAtPoint({
        shapeType,
        point: p,
        ...(["sequence-shapes", "builtin-shapes"].includes(profile)
          ? {}
          : { width: 154, height: 100 }),
        attachToDropTarget: false,
        ...options,
      }),
      `Shape unavailable: ${shapeType}`,
    );
    if (profile === "sequence-shapes" && ref.shapeData.sequenceLifeline)
      ensure(
        board.updateElement(ref.id, {
          element: {
            ...ref,
            shapeData: {
              ...ref.shapeData,
              sequenceLifeline: {
                ...ref.shapeData.sequenceLifeline,
                lifelineHeight: 60,
                minLifelineHeight: 40,
              },
            },
          },
        }),
        `Lifeline height unavailable: ${shapeType}`,
      );
    ids.push(ref.id);
    const label =
      profile === "sequence-shapes"
        ? caption(shapeType.replace(/^sequence_/, "sequence_\n"), p.x - 12, p.y + 180, 244, 60)
        : caption(shapeType, p.x - 12, p.y + 110);
    shapeCaptions.set(ref.id, label.id);
    covered.push({ feature: "shape", shapeType, elementId: ref.id });
    return ref;
  };
  const measureGeneratedText = async (nodes) => {
    if (!options.lint) return;
    authoringTextRepairs.push(
      await repairMeasuredVisualText(board, options.lint, {
        nodes,
        fixed: [],
        protected: [],
        layoutOptions: { elementIds: [], maxNodes: 1000 },
        verify() {
          expect.forEach((check) => check());
        },
      }),
    );
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
    // None is not a shape. SmartArt needs a composite payload rather than an empty preset insertion.
    const types = [...new Set(Object.values(source))].filter(
      (type) => !["none", "smartArt"].includes(type),
    );
    for (const [index, type] of types.entries()) {
      shape(type, index);
    }
    expect.push(() =>
      assert.equal(
        covered.filter((item) => item.feature === "shape").length,
        types.length,
        "A public shape preset was skipped",
      ),
    );
    if (profile === "builtin-shapes") {
      const entries = [
        ["plan", "Plan / 计划", E.ShapeTypeEnum.RoundRect, 20, "#dbeafe"],
        ["release", "Release / 发布", E.ShapeTypeEnum.Hexagon, 310, "#fef3c7"],
      ];
      const smartArt = {
        version: 1,
        viewport: { width: 520, height: 160 },
        layout: { id: "urn:univer:catalogue:authored-process", category: "process" },
        style: {},
        direction: "leftToRight",
        rootNodeIds: entries.map(([id]) => id),
        nodes: Object.fromEntries(
          entries.map(([id, text]) => [
            id,
            {
              id,
              childIds: [],
              role: "content",
              text: { isHorizontal: true, text },
            },
          ]),
        ),
        presentationShapeOrder: ["plan-shape", "flow-shape", "release-shape"],
        presentationShapes: Object.fromEntries([
          ...entries.map(([id, text, shapeType, left, color]) => [
            `${id}-shape`,
            {
              id: `${id}-shape`,
              role: "node",
              dataNodeIds: [id],
              textSource: "dataNode",
              transform: { left, top: 30, width: 190, height: 100 },
              shapeData: {
                shapeType,
                fill: { fillType: E.ShapeFillEnum.SolidFill, color },
                stroke: { color: "#334155", width: 1.5 },
                shapeText: { isHorizontal: true, text, fontSize: 16 },
              },
            },
          ]),
          [
            "flow-shape",
            {
              id: "flow-shape",
              role: "connection",
              dataNodeIds: [],
              sourcePresentationShapeId: "plan-shape",
              targetPresentationShapeId: "release-shape",
              transform: { left: 230, top: 62, width: 60, height: 36 },
              shapeData: {
                shapeType: E.ShapeTypeEnum.RightArrow,
                fill: { fillType: E.ShapeFillEnum.SolidFill, color: "#475569" },
              },
            },
          ],
        ]),
      };
      const top = 90 + Math.ceil(types.length / 5) * 190;
      const ref = ensure(
        board.insertShape({
          shapeType: E.ShapeTypeEnum.SmartArt,
          transform: { left: 70, top, width: 520, height: 160 },
          shapeData: { smartArt },
        }),
        "SmartArt composite insertion failed",
      );
      ids.push(ref.getId());
      covered.push({
        feature: "smart-art-composite",
        elementId: ref.getId(),
        logicalNodes: 2,
        presentationShapes: 3,
        rendering: "partial-native-composite",
        childTextPaint: "not-rendered-by-board",
      });
      caption(
        "SmartArt native composite · child text not painted / 子文字未绘制",
        70,
        top + 172,
        520,
      );
      expect.push(() =>
        assert.deepEqual(
          board.getElement(ref.getId()).shapeData.smartArt,
          smartArt,
          "SmartArt source nodes or presentation geometry changed",
        ),
      );
    }
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
      const nativeOperator = preset.startsWith("uml-sequence-")
        ? table.getValues()[0][0]
        : undefined;
      if (nativeOperator === undefined)
        ensure(
          table.setCellRichText(0, 0, api.newRichText().span(`${preset} / 领域数据`, style)),
          "Table caption failed",
        );
      const bounds = board.getElement(table.getId()).transform;
      const label = caption(`${preset} / 领域数据`, left, top - 38, bounds.width);
      shapeCaptions.set(table.getId(), label.id);
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
      covered.push({ feature: "table-preset", preset, elementId: table.getId(), nativeOperator });
    }
    await measureGeneratedText(ids);
    left = 70;
    top = 90;
    rowHeight = 0;
    for (const [index, id] of ids.entries()) {
      if (index && index % 3 === 0) {
        left = 70;
        top += rowHeight + 90;
        rowHeight = 0;
      }
      const bounds = board.getElement(id).transform;
      ensure(
        board.setElementsTransform({
          [id]: { left, top },
          [shapeCaptions.get(id)]: { left, top: top - 38, width: bounds.width },
        }),
        "Measured table catalogue placement failed",
      );
      left += bounds.width + 80;
      rowHeight = Math.max(rowHeight, bounds.height);
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
    const imageCaption = caption("Embedded image", 70, 378);
    const inkTop = imageCaption.transform.top + imageCaption.transform.height + 24;
    const ink = ensure(
      board.insertInk({
        model: {
          kind: "brush",
          points: [
            { x: 80, y: inkTop + 25, t: 0 },
            { x: 145, y: inkTop, t: 1 },
            { x: 210, y: inkTop + 38, t: 2 },
            { x: 280, y: inkTop + 10, t: 3 },
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
    expect.push(() => {
      const captionBounds = board.getElement(imageCaption.id).transform;
      assert.ok(
        board.getElement(ink.id).transform.top >= captionBounds.top + captionBounds.height + 16,
        "Ink overlaps the image caption",
      );
    });
    const familyInfos = createCatalogueChartFamilyInfos(board, api);
    const sampledTypes = familyInfos.map(({ family }) => E.ChartTypeString[family]);
    chartTypeCoverage = {
      declared: [...new Set(Object.values(E.ChartTypeString))],
      sampled: sampledTypes,
      unverified: [...new Set(Object.values(E.ChartTypeString))].filter(
        (type) => !sampledTypes.includes(type),
      ),
      scope:
        "Seven representative native families; enum registration is not proof of render support",
    };
    for (const { family, info: chartInfo } of familyInfos) {
      const chart = ensure(await board.insertChart(chartInfo), `${family} chart insertion failed`);
      ids.push(chart.getElementId());
      covered.push({
        feature: "inline-data-chart",
        family,
        elementId: chart.getElementId(),
        sourceHeader: chartInfo.sourceHeader,
      });
      expect.push(() => {
        assert.equal(
          chart.getInfo().config.type,
          E.ChartTypeString[family],
          `${family} native chart kind changed`,
        );
        assert.deepEqual(
          chart.getInfo().dataSource,
          chartInfo.dataSource,
          `${family} source facts changed`,
        );
        assert.deepEqual(
          chart.getInfo().sourceHeader,
          chartInfo.sourceHeader,
          `${family} title-row projection changed`,
        );
      });
    }
    caption("Editable persistent Ink", 70, inkTop + 65);
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
    const examples = [];
    for (const [index, transform] of [
      { rotation: 0 },
      { rotation: 25 },
      { flipX: true },
      { flipY: true },
      { rotation: 25, flipX: true },
      { rotation: 25, flipY: true },
    ].entries()) {
      const a = shape(E.ShapeTypeEnum.RightTriangle, index, {
        text: `Asymmetric ${index + 1}`,
        textBox: {
          autoFitType: E.ShapeTextAutoFitType.NoAutoFit,
          textWrap: E.ShapeTextWrapType.None,
        },
        fillColor: "#fef3c7",
        strokeColor: "#b45309",
        strokeWidth: 2,
      });
      ensure(board.setElementTransform(a.id, transform), "Transform application failed");
      const originalText = JSON.parse(JSON.stringify(board.getElement(a.id).shapeData.shapeText));
      expect.push(() =>
        assert.deepEqual(
          board.getElement(a.id).shapeData.shapeText,
          originalText,
          "Transform text/style changed",
        ),
      );
      examples.push({ elementId: a.id, transform, index });
    }
    await measureGeneratedText(examples.map((item) => item.elementId));
    const cellSize =
      Math.ceil(
        Math.max(
          ...examples.map(({ elementId }) => {
            const frame = board.getElement(elementId).transform;
            return Math.hypot(frame.width, frame.height);
          }),
        ),
      ) + 100;
    for (const { elementId, transform, index } of examples) {
      const p = point(index, cellSize, cellSize, 3);
      const a = board.getElement(elementId);
      ensure(
        board.setElementsTransform({
          [a.id]: { left: p.x, top: p.y },
          [shapeCaptions.get(a.id)]: { left: p.x - 12, top: p.y + cellSize - 70 },
        }),
        "Measured transform catalogue placement failed",
      );
      const c = ensure(
        board.insertConnector({
          start: {
            kind: "shapeBoundary",
            shapeId: a.id,
            outlineIndex: 0,
            segmentIndex: 0,
            segmentT: 0.5,
          },
          end: { kind: "free", x: p.x + cellSize - 70, y: p.y - 20 },
          routing: "orthogonal",
          style: { endMarker: { type: "filledArrow" }, stroke: "#334155" },
        }),
        "Boundary connector failed",
      );
      covered.push({ feature: "transform-and-boundary", options: transform, elementId: c.id });
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
      authoringTextRepairs,
      ...(chartTypeCoverage ? { chartTypeCoverage } : {}),
      automatedLayoutQualityClaim: false,
      covered,
      primitiveTypes: [...new Set(Object.values(board.getElements()).map((item) => item.type))],
      notClaimed: [
        "Temporal animation and video/audio playback are not certified by static PNGs",
        "Representative inline-data chart families do not certify every declared kind or external data adapter",
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
