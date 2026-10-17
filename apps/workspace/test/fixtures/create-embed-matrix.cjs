/** Generate native embed anchors through the published SDK, never by editing snapshot resources. */
const { createRequire } = require("node:module");
const sdk = createRequire(__filename);
module.exports = function createEmbedMatrix(baseUnit, docUnit) {
  global.Path2D ??= class {};
  const { Univer, LogLevel } = sdk("@univerjs/core");
  const { FUniver } = sdk("@univerjs/core/facade");
  for (const pkg of [
    "@univerjs-pro/embed",
    "@univerjs/docs",
    "@univerjs/sheets",
    "@univerjs-pro/slides",
    "@univerjs-pro/bases",
    "@univerjs-pro/boards",
  ])
    sdk(`${pkg}/facade`);
  const plugins = [
    ["@univerjs-pro/engine-formula", "UniverProFormulaEnginePlugin"],
    ["@univerjs/engine-render", "UniverRenderEnginePlugin"],
    ["@univerjs/docs", "UniverDocsPlugin"],
    ["@univerjs/sheets", "UniverSheetsPlugin"],
    ["@univerjs/drawing", "UniverDrawingPlugin"],
    ["@univerjs/docs-drawing", "UniverDocsDrawingPlugin"],
    ["@univerjs/sheets-drawing", "UniverSheetsDrawingPlugin"],
    ["@univerjs-pro/slides", "UniverSlidesPlugin"],
    ["@univerjs-pro/bases", "UniverBasesPlugin"],
    ["@univerjs-pro/boards", "UniverBoardsPlugin"],
    ["@univerjs-pro/embed", "UniverEmbedPlugin"],
  ];
  return [
    ["doc", 1, "docs-custom-block", 5, baseUnit, "base"],
    ["sheet", 2, "sheets-sheet-tab", 5, baseUnit, "base"],
    ["sheet", 2, "sheets-floating-object", 5, baseUnit, "base"],
    ["base", 5, "bases-table-list-block", 1, docUnit, "doc"],
    ["slide", 3, "slides-page-list-block", 5, baseUnit, "base"],
    ["slide", 3, "slides-floating-object", 5, baseUnit, "base"],
    ["board", 6, "boards-floating-object", 5, baseUnit, "base"],
    ["doc", 1, "docs-custom-block", 2, "matrix-source-sheet", "sheet"],
    ["doc", 1, "docs-custom-block", 3, "matrix-source-slide", "slide"],
    ["doc", 1, "docs-custom-block", 6, "matrix-source-board", "board"],
  ].map(([kind, type, surface, childType, childUnit, childKind], index) => {
    const univer = new Univer({ logLevel: LogLevel.SILENT });
    try {
      for (const [pkg, name] of plugins) univer.registerPlugin(sdk(pkg)[name]);
      const unitId = `matrix-host-${index}`;
      const host = univer.createUnit(type, {
        id: unitId,
        name: surface,
        ...(type === 1 ? { body: { dataStream: `${surface}\r\n` } } : {}),
      });
      const api = FUniver.newAPI(univer);
      const context =
        surface === "sheets-floating-object"
          ? { placement: { kind: "2", left: 60, top: 60, width: 650, height: 450 } }
          : surface.endsWith("floating-object")
            ? { left: 40, top: 40, width: 650, height: 450 }
            : {};
      api.createEmbed({
        embedId: `matrix-embed-${index}`,
        host: { unitId, surface, context },
        content: { unitType: childType, ref: `#unit=${childUnit}&type=${childKind}` },
      });
      return {
        kind,
        unitId,
        surface,
        name: `${surface} → ${childKind}`,
        data: api[
          { 1: "getDocument", 2: "getWorkbook", 3: "getPresentation", 5: "getBase", 6: "getBoard" }[
            type
          ]
        ](unitId).save(),
      };
    } finally {
      univer.dispose();
    }
  });
};
