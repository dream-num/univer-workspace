import { describe, expect, it } from "vitest";
import { realizeElementFixture } from "../scripts/board-element-fixtures.mjs";

describe("native SmartArt catalogue", () => {
  it("authors a real composite with logical text and distinct native child geometry", async () => {
    const { createStandardHeadlessUniverFactory, createStandardHeadlessUniverFacade } =
      await import("@univer-cli/headless-univer");
    const { UniverInstanceType } = await import("@univerjs/core");
    const univer = await createStandardHeadlessUniverFactory({ license: "" })({
      unitId: "smart-art-catalogue",
      unitType: UniverInstanceType.UNIVER_BOARD,
    });
    try {
      const api = createStandardHeadlessUniverFacade(univer);
      const board = api.createBoard({ id: "smart-art-catalogue", name: "SmartArt catalogue" });
      const fixture = await realizeElementFixture(board, api, "builtin-shapes");
      const covered = fixture.semanticCoverage.covered.find(
        (item) => item.feature === "smart-art-composite",
      );
      expect(covered).toMatchObject({
        logicalNodes: 2,
        presentationShapes: 3,
        rendering: "partial-native-composite",
        childTextPaint: "not-rendered-by-board",
      });
      const composite = board.getElement(covered.elementId);
      expect(composite.shapeData.shapeType).toBe(api.Enum.ShapeTypeEnum.SmartArt);
      const data = composite.shapeData.smartArt;
      expect(board.getShape(composite.id).isSmartArt()).toBe(true);
      expect(board.getShape(composite.id).getSmartArtData()).toEqual(data);
      expect(Object.values(data.nodes).map((node) => node.text.text)).toEqual([
        "Plan / 计划",
        "Release / 发布",
      ]);
      expect(data.presentationShapeOrder).toEqual(["plan-shape", "flow-shape", "release-shape"]);
      expect(data.presentationShapes["plan-shape"].shapeData.shapeType).toBe(
        api.Enum.ShapeTypeEnum.RoundRect,
      );
      expect(data.presentationShapes["release-shape"].shapeData.shapeType).toBe(
        api.Enum.ShapeTypeEnum.Hexagon,
      );
      expect(data.presentationShapes["flow-shape"]).toMatchObject({
        sourcePresentationShapeId: "plan-shape",
        targetPresentationShapeId: "release-shape",
      });
      const snapshot = JSON.parse(JSON.stringify(board.save()));
      expect(
        board.updateElement(composite.id, {
          element: { ...composite, name: "Authored composite" },
        }),
      ).toBe(true);
      const edited = JSON.parse(JSON.stringify(board.save()));
      expect(await board.undo()).toBe(true);
      expect(JSON.parse(JSON.stringify(board.save()))).toEqual(snapshot);
      expect(await board.redo()).toBe(true);
      expect(JSON.parse(JSON.stringify(board.save()))).toEqual(edited);
      const fresh = api.createBoard({ ...snapshot, id: "smart-art-reopened" });
      expect(fresh.getElement(composite.id).shapeData.smartArt).toEqual(data);
      fixture.verify();
      expect(fixture.semanticCoverage.unavailable.some((item) => item.type === "smartArt")).toBe(
        false,
      );
    } finally {
      univer.dispose();
    }
  }, 20_000);
});
