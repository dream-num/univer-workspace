import { describe, expect, it } from "vitest";
import {
  createCatalogueChartInfo,
  createCatalogueChartFamilyInfos,
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
  it("reopens all seven native chart resources and preserves their models through Undo and Redo", async () => {
    const { univer, api, board } = await runtime("catalogue-chart-family-resources");
    try {
      const fixture = await realizeElementFixture(board, api, "text-image-ink-chart");
      const coverage = fixture.semanticCoverage.chartTypeCoverage;
      expect(coverage.sampled).toHaveLength(7);
      expect(coverage.declared).toEqual([...new Set(Object.values(api.Enum.ChartTypeString))]);
      expect(coverage.unverified).toEqual(
        coverage.declared.filter((type) => !coverage.sampled.includes(type)),
      );
      const entries = fixture.semanticCoverage.covered.filter(
        (item) => item.feature === "inline-data-chart",
      );
      expect(entries).toHaveLength(7);
      expect(board.getCharts()).toHaveLength(7);
      const facts = entries.map(({ elementId }) => {
        const info = board.getChart(elementId).getInfo();
        return {
          elementId,
          dataSource: info.dataSource,
          sourceHeader: info.sourceHeader,
          config: info.config,
        };
      });
      const before = JSON.parse(JSON.stringify(board.save()));
      const first = board.getElement(entries[0].elementId);
      expect(
        board.updateElement(first.id, { element: { ...first, name: "Quarterly column" } }),
      ).toBe(true);
      const after = JSON.parse(JSON.stringify(board.save()));
      expect(await board.undo()).toBe(true);
      expect(JSON.parse(JSON.stringify(board.save()))).toEqual(before);
      expect(await board.redo()).toBe(true);
      expect(JSON.parse(JSON.stringify(board.save()))).toEqual(after);
      const reopened = await runtime("catalogue-chart-family-reopened-runtime");
      try {
        const fresh = reopened.api.createBoard(before);
        expect(fresh.getCharts()).toHaveLength(7);
        for (const item of facts) {
          const info = fresh.getChart(item.elementId).getInfo();
          expect(info.dataSource).toEqual(item.dataSource);
          expect(info.sourceHeader).toEqual(item.sourceHeader);
          expect(info.config).toEqual(item.config);
        }
      } finally {
        reopened.univer.dispose();
      }
      fixture.verify();
    } finally {
      univer.dispose();
    }
  }, 20_000);

  it("uses native category/value mappings and preserves every source row for seven chart families", async () => {
    const { univer, api, board } = await runtime("catalogue-chart-families");
    try {
      const infos = createCatalogueChartFamilyInfos(board, api);
      expect(infos.map(({ family }) => family)).toEqual([
        "Column",
        "Bar",
        "Line",
        "Area",
        "Pie",
        "Donut",
        "Scatter",
      ]);
      for (const { family, info } of infos) {
        expect(info.sourceHeader).toEqual({ band: { startOffset: 0, endOffset: 0 } });
        expect(info.dataSource.values).toHaveLength(5);
        expect(info.dataSource.values[0]).toEqual([
          family === "Scatter" ? "Week" : "Quarter",
          "Orders",
          "Returns",
        ]);
        expect(info.dataSource.values.slice(1).map((row) => row.slice(1))).toEqual([
          [120, 4],
          [168, 5],
          [192, 3],
          [226, 6],
        ]);
        expect(info.config.mapping).toMatchObject({
          categoryIndex: 0,
          seriesIndexes: ["Pie", "Donut"].includes(family) ? [1] : [1, 2],
        });
        if (family === "Scatter")
          expect(info.dataSource.values.slice(1).every((row) => typeof row[0] === "number")).toBe(
            true,
          );
      }
    } finally {
      univer.dispose();
    }
  }, 20_000);

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
