import { describe, expect, it } from "vitest";
import {
  realizeVisualFixture,
  visualVariants,
  visualCases,
} from "../scripts/board-visual-fixtures.mjs";

async function withBoard(callback) {
  const { createStandardHeadlessUniverFactory, createStandardHeadlessUniverFacade } =
    await import("@univer-cli/headless-univer");
  const { UniverInstanceType } = await import("@univerjs/core");
  const univer = await createStandardHeadlessUniverFactory({ license: "" })({
    unitId: "visual-presentation",
    unitType: UniverInstanceType.UNIVER_BOARD,
  });
  try {
    const api = createStandardHeadlessUniverFacade(univer);
    return await callback(api.createBoard({ id: "visual-presentation" }), api);
  } finally {
    univer.dispose();
  }
}

describe("Generated business presentation", () => {
  it.each(Object.keys(visualCases))(
    "keeps %s content and model findings intact when aligning its heading",
    async (profile) => {
      await withBoard((board, api) => {
        const fixture = realizeVisualFixture(board, api, profile, "business");
        const plan = board.planGraphLayout({
          ...fixture.layoutOptions,
          fixedElementIds: fixture.fixed,
        });
        if (plan.status === "ready" && plan.patches.length)
          expect(board.applyLayoutPlan(plan)).toBe(true);
        for (const id of fixture.compactContainers)
          expect(board.fitContainerToContent(id)).toBe(true);
        const before = board
          .analyzeModelLayout(48)
          .issues.filter((issue) => issue.severity === "error");
        expect(fixture.alignHeading()).toBe(true);
        fixture.verify();
        expect(
          board.analyzeModelLayout(48).issues.filter((issue) => issue.severity === "error").length,
        ).toBeLessThanOrEqual(before.length);
      });
    },
    20_000,
  );

  it.each(visualVariants)(
    "reserves the extra Package caption gutter only below two frame ancestors in %s",
    async (variant) => {
      await withBoard((board, api) => {
        const fixture = realizeVisualFixture(board, api, "uml-package", variant);
        for (const id of fixture.compactContainers) {
          const element = board.getElement(id);
          let depth = 0,
            parent = element.parentId;
          while (parent) {
            depth++;
            parent = board.getElement(parent).parentId;
          }
          if (element.containerData.kind === "uml-package" && depth >= 2)
            expect(element.containerData.padding.top).toBe(64);
          else if (element.containerData.kind === "uml-package")
            expect(element.containerData.padding.top).toBe(depth === 0 ? 48 : 24);
        }
        fixture.verify();
      });
    },
    20_000,
  );
  it.each(["architecture", "uml-package", "uml-use-case", "flowchart", "timeline"])(
    "aligns only the generated %s heading after public layout and preserves exact history",
    async (profile) => {
      await withBoard((board, api) => {
        const fixture = realizeVisualFixture(board, api, profile, "nested-dense");
        const plan = board.planGraphLayout({
          ...fixture.layoutOptions,
          fixedElementIds: fixture.fixed,
        });
        expect(plan.status).toBe("ready");
        if (plan.patches.length) expect(board.applyLayoutPlan(plan)).toBe(true);
        for (const id of fixture.compactContainers)
          expect(board.fitContainerToContent(id)).toBe(true);
        const content = () =>
          JSON.parse(
            JSON.stringify(
              Object.fromEntries(
                Object.entries(board.getElements()).filter(([id]) => id !== "visual-case-heading"),
              ),
            ),
          );
        const originalContent = content(),
          before = JSON.parse(JSON.stringify(board.save()));
        expect(fixture.alignHeading()).toBe(true);
        expect(content()).toEqual(originalContent);
        fixture.verify();
        const after = JSON.parse(JSON.stringify(board.save()));
        const heading = board.getElement("visual-case-heading");
        const minimumLeft = Math.min(
          ...Object.keys(originalContent)
            .filter((id) => originalContent[id].type !== "connector")
            .map((id) => board.getElementBounds(id).left),
        );
        expect(heading.transform.left).toBe(minimumLeft);
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          expect(board.undo()).toBe(true);
          expect(JSON.parse(JSON.stringify(board.save()))).toEqual(before);
          expect(board.redo()).toBe(true);
          expect(JSON.parse(JSON.stringify(board.save()))).toEqual(after);
        }
      });
    },
    20_000,
  );
  it.each(["architecture", "deployment", "uml-package", "uml-use-case"])(
    "reserves explicit generated label and caption space for %s without changing facts",
    async (profile) => {
      await withBoard((board, api) => {
        const fixture = realizeVisualFixture(board, api, profile, "business");
        expect(fixture.layoutOptions).toMatchObject({ layerGap: 192, itemGap: 64 });
        for (const elementId of fixture.compactContainers) {
          const scope = board.getElement(elementId);
          expect(scope.containerData.behavior.layoutOccupancy).toBe("frame");
          expect(scope.containerData.padding.left).toBeGreaterThanOrEqual(24);
          expect(scope.containerData.padding.right).toBeGreaterThanOrEqual(24);
          expect(scope.containerData.padding.top).toBeGreaterThanOrEqual(24);
          if (fixture.spec.scopeCaptionGutter)
            expect(scope.containerData.padding.top).toBeGreaterThanOrEqual(
              fixture.spec.scopeCaptionGutter,
            );
        }
        fixture.verify();
        const before = JSON.parse(JSON.stringify(board.save()));
        const plan = board.planGraphLayout({
          ...fixture.layoutOptions,
          fixedElementIds: fixture.fixed,
        });
        expect(plan.status).toBe("ready");
        expect(board.applyLayoutPlan(plan)).toBe(true);
        const after = JSON.parse(JSON.stringify(board.save()));
        fixture.verify();
        expect(board.undo()).toBe(true);
        expect(JSON.parse(JSON.stringify(board.save()))).toEqual(before);
        expect(board.redo()).toBe(true);
        expect(JSON.parse(JSON.stringify(board.save()))).toEqual(after);
      });
    },
    20_000,
  );

  it.each([
    ["architecture", "long-bilingual"],
    ["flowchart", "nested-dense"],
  ])(
    "keeps %s %s bodies clear of the generated rounded frame",
    async (profile, variant) => {
      await withBoard((board, api) => {
        const fixture = realizeVisualFixture(board, api, profile, variant);
        const plan = board.planGraphLayout({
          ...fixture.layoutOptions,
          fixedElementIds: fixture.fixed,
        });
        expect(plan.status).toBe("ready");
        expect(board.applyLayoutPlan(plan)).toBe(true);
        for (const id of fixture.compactContainers)
          expect(board.fitContainerToContent(id)).toBe(true);
        fixture.verify();
        const issues = board.analyzeModelLayout(48).issues;
        expect(issues.filter((issue) => issue.rule === "element-overlap")).toEqual([]);
      });
    },
    20_000,
  );

  it.each(visualVariants)(
    "keeps the complete chronological native timeline readable in %s",
    async (variant) => {
      await withBoard((board, api) => {
        const fixture = realizeVisualFixture(board, api, "timeline", variant);
        fixture.verify();
        const native = board.getMindMaps()[0];
        expect(native.getLayout()).toMatchObject({
          structureKind: "timeline-vertical",
          direction: "right",
          horizontalGap: 80,
          siblingGap: 16,
          branchGap: 24,
        });
        const bounds = native.getBounds();
        expect(bounds.width).toBeLessThan(variant === "long-bilingual" ? 2700 : 2100);
        const heading = board.getElement("visual-case-heading");
        expect(heading.transform.left).toBe(bounds.left);
        expect(heading.transform.top + heading.transform.height + 32).toBe(bounds.top);
        const before = JSON.parse(JSON.stringify(board.save()));
        expect(native.setLayout({ direction: "both" })).toBe(true);
        const after = JSON.parse(JSON.stringify(board.save()));
        expect(board.undo()).toBe(true);
        expect(JSON.parse(JSON.stringify(board.save()))).toEqual(before);
        expect(board.redo()).toBe(true);
        expect(JSON.parse(JSON.stringify(board.save()))).toEqual(after);
        fixture.verify();
      });
    },
    20_000,
  );
});
