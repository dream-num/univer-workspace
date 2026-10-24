import { describe, expect, it } from "vitest";
import {
  createCatalogueChartInfo,
  realizeElementFixture,
} from "../scripts/board-element-fixtures.mjs";

async function runtime(id) {
  const { createStandardHeadlessUniverFactory, createStandardHeadlessUniverFacade } =
    await import("@univer-cli/headless-univer");
  const { UniverInstanceType } = await import("@univerjs/core");
  const univer = await createStandardHeadlessUniverFactory({ license: "" })({
    unitId: id,
    unitType: UniverInstanceType.UNIVER_BOARD,
  });
  const api = createStandardHeadlessUniverFacade(univer);
  return { univer, api, board: api.createBoard({ id, name: id }) };
}

describe("native catalogue content and measured authoring", () => {
  it("declares chart title rows without dropping the original header or any quarterly values", async () => {
    const { univer, api, board } = await runtime("catalogue-chart-source");
    try {
      const info = createCatalogueChartInfo(board, api);
      expect(info.sourceHeader).toEqual({ band: { startOffset: 0, endOffset: 0 } });
      expect(info.dataSource.values).toEqual([
        ["Quarter", "Orders", "Returns"],
        ["Q1", 120, 4],
        ["Q2", 168, 5],
        ["Q3", 192, 3],
        ["Q4", 226, 6],
      ]);
      expect(info.config.mapping).toMatchObject({ categoryIndex: 0, seriesIndexes: [1, 2] });
    } finally {
      univer.dispose();
    }
  });

  it("keeps native sequence-fragment operators and the complete external preset captions", async () => {
    const { univer, api, board } = await runtime("catalogue-operators");
    try {
      const defaults = api.createBoard({ id: "operator-defaults", name: "Operators" });
      const fixture = await realizeElementFixture(board, api, "table-presets");
      for (const item of fixture.semanticCoverage.covered) {
        const native = defaults.insertTable({ left: 0, top: 0, diagramPreset: item.preset });
        if (item.preset.startsWith("uml-sequence-")) {
          expect(board.getTable(item.elementId).getValues()[0][0]).toBe(native.getValues()[0][0]);
          expect(item.nativeOperator).toBe(native.getValues()[0][0]);
        }
        expect(
          Object.values(board.getElements()).some(
            (element) => element.type === "text" && element.text === `${item.preset} / 领域数据`,
          ),
        ).toBe(true);
      }
      fixture.verify();
      fixture.verifyLayout();
    } finally {
      univer.dispose();
    }
  });

  it("grows native triangle text rectangles using measured ratios before freezing the transform catalogue", async () => {
    const { univer, api, board } = await runtime("catalogue-measured-text");
    try {
      let measurements = 0;
      const fixture = await realizeElementFixture(board, api, "transform-style", {
        lint: {
          async lint() {
            const shapes = Object.values(board.getElements()).filter(
              (element) => element.type === "shape",
            );
            return {
              analyses: [
                {
                  rendered: {
                    issues: measurements++
                      ? []
                      : shapes.map((element) => ({
                          rule: "element-text-overflow",
                          elementIds: [element.id],
                          textLayout: {
                            availableSize: { width: 50, height: 33 },
                            contentSize: { width: 120, height: 20 },
                          },
                        })),
                  },
                },
              ],
            };
          },
        },
      });
      expect(measurements).toBe(2);
      const repair = fixture.semanticCoverage.authoringTextRepairs[0];
      expect(repair.status).toBe("no-overflow-reported");
      expect(repair.attempts[0].growthApplications[0]).toMatchObject({
        undoExact: true,
        redoExact: true,
      });
      const shapes = fixture.nodes.map((id) => board.getElement(id));
      expect(shapes).toHaveLength(6);
      for (const [index, element] of shapes.entries()) {
        expect(element.shapeData.shapeText).toMatchObject({
          text: `Asymmetric ${index + 1}`,
          autoFitType: api.Enum.ShapeTextAutoFitType.NoAutoFit,
          textWrap: api.Enum.ShapeTextWrapType.None,
        });
        expect(element.transform.width).toBeGreaterThanOrEqual((154 * 120) / 50);
        expect(element.transform.height).toBe(100);
      }
      expect(shapes[1].transform.rotation).toBe(25);
      expect(shapes[2].transform.flipX).toBe(true);
      expect(shapes[3].transform.flipY).toBe(true);
      expect(shapes[4].transform).toMatchObject({ rotation: 25, flipX: true });
      expect(shapes[5].transform).toMatchObject({ rotation: 25, flipY: true });
      fixture.verify();
      fixture.verifyLayout();
    } finally {
      univer.dispose();
    }
  });
});
