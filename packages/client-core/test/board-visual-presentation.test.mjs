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
  it.each(visualVariants)(
    "keeps the generated %s sequence readable without oversized rows or lifeline tails",
    async (variant) => {
      await withBoard((board, api) => {
        const fixture = realizeVisualFixture(board, api, "uml-sequence", variant);
        const elements = board.getElements();
        const messages = Object.values(elements).filter(
          (element) => element.connectorData?.start.kind === "lifeline",
        );
        const messageTimes = messages.map(({ connectorData }) => {
          const times = [connectorData.start, connectorData.end].map((endpoint) => {
            expect(endpoint.kind).toBe("lifeline");
            const participant = board.getElementBounds(endpoint.shapeId);
            return participant.top + participant.height + endpoint.offsetY;
          });
          expect(times[0]).toBe(times[1]);
          return times[0];
        });
        expect(messageTimes).toHaveLength(fixture.spec.edges.length);
        for (let index = 1; index < messageTimes.length; index++) {
          const gap = messageTimes[index] - messageTimes[index - 1];
          expect(gap).toBeGreaterThanOrEqual(48);
          expect(gap).toBeLessThanOrEqual(96);
        }
        for (const participant of Object.values(elements).filter(
          (element) => element.shapeData?.sequenceLifeline,
        )) {
          const bounds = board.getElementBounds(participant.id);
          const headerBottom = bounds.top + bounds.height;
          const firstGap = messageTimes[0] - headerBottom;
          const tail =
            headerBottom +
            participant.shapeData.sequenceLifeline.lifelineHeight -
            messageTimes[messageTimes.length - 1];
          expect(firstGap).toBeGreaterThanOrEqual(32);
          expect(firstGap).toBeLessThanOrEqual(80);
          expect(tail).toBeGreaterThanOrEqual(48);
          expect(tail).toBeLessThanOrEqual(96);
        }
        fixture.verify();
      });
    },
    20_000,
  );

  it.each(visualVariants)(
    "reads the generated %s activity in flow order across responsibility lanes with exact history",
    async (variant) => {
      await withBoard((board, api) => {
        const fixture = realizeVisualFixture(board, api, "uml-activity", variant);
        const pool = board.getElement("visual-pool");
        expect(pool.containerData.swimlane.orientation).toBe(fixture.spec.direction);
        const before = JSON.parse(JSON.stringify(board.save()));
        const plan = board.planGraphLayout({
          ...fixture.layoutOptions,
          fixedElementIds: fixture.fixed,
        });
        expect(plan.status).toBe("ready");
        expect(board.applyLayoutPlan(plan)).toBe(true);
        const axis = fixture.spec.direction === "vertical" ? "top" : "left";
        const size = axis === "top" ? "height" : "width";
        const steps = fixture.spec.mainPath.map((id) => board.getElementBounds(`visual-${id}`));
        const crossSize = size === "width" ? "height" : "width";
        for (const lane of pool.containerData.swimlane.lanes) {
          const members = Object.values(board.getElements()).filter(
            (element) =>
              element.parentId === pool.id &&
              element.laneId === lane.id &&
              element.type !== "connector",
          );
          const largest = Math.max(
            ...members.map((element) => board.getElementBounds(element.id)[crossSize]),
          );
          expect(
            lane.size,
            "Serial activity lanes reserve space for their tallest node, not every process step",
          ).toBeLessThanOrEqual(largest + 96);
        }
        for (let index = 1; index < steps.length; index++)
          expect(steps[index][axis]).toBeGreaterThan(
            steps[index - 1][axis] + steps[index - 1][size],
          );
        fixture.verify();
        const after = JSON.parse(JSON.stringify(board.save()));
        expect(board.undo()).toBe(true);
        expect(JSON.parse(JSON.stringify(board.save()))).toEqual(before);
        expect(board.redo()).toBe(true);
        expect(JSON.parse(JSON.stringify(board.save()))).toEqual(after);
      });
    },
    20_000,
  );

  it.each(["architecture", "deployment", "uml-state", "uml-sequence", "mindmap", "timeline"])(
    "fits only the generated %s heading to ready native measurements with exact history",
    async (profile) => {
      await withBoard((board, api) => {
        const fixture = realizeVisualFixture(board, api, profile, "nested-dense");
        const before = JSON.parse(JSON.stringify(board.save())),
          heading = board.getElement("visual-case-heading"),
          content = Object.fromEntries(
            Object.entries(board.getElements()).filter(([id]) => id !== heading.id),
          );
        const expectedContent = JSON.parse(JSON.stringify(content));
        expect(
          fixture.alignHeading({
            status: "ready",
            availableSize: { width: heading.transform.width, height: heading.transform.height },
            contentSize: { width: 300.25, height: 42.5 },
          }),
        ).toBe(true);
        expect(board.getElement(heading.id).transform).toMatchObject({ width: 305, height: 47 });
        expect(
          JSON.parse(
            JSON.stringify(
              Object.fromEntries(
                Object.entries(board.getElements()).filter(([id]) => id !== heading.id),
              ),
            ),
          ),
        ).toEqual(expectedContent);
        fixture.verify();
        const after = JSON.parse(JSON.stringify(board.save()));
        expect(board.undo()).toBe(true);
        expect(JSON.parse(JSON.stringify(board.save()))).toEqual(before);
        expect(board.redo()).toBe(true);
        expect(JSON.parse(JSON.stringify(board.save()))).toEqual(after);
      });
    },
    20_000,
  );

  it("refuses invalid measured heading sizes without editing content", async () => {
    await withBoard((board, api) => {
      const fixture = realizeVisualFixture(board, api, "architecture", "business"),
        before = JSON.parse(JSON.stringify(board.save()));
      expect(
        fixture.alignHeading({
          status: "ready",
          availableSize: { width: 1100, height: 110 },
          contentSize: { width: NaN, height: 42 },
        }),
      ).toBe(false);
      expect(JSON.parse(JSON.stringify(board.save()))).toEqual(before);
    });
  }, 20_000);

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
  it.each(["uml-class", "architecture", "deployment", "uml-package", "uml-use-case"])(
    "uses SDK layer spacing and preserves generated %s frame constraints",
    async (profile) => {
      await withBoard((board, api) => {
        const fixture = realizeVisualFixture(board, api, profile, "business");
        expect(fixture.layoutOptions).not.toHaveProperty("layerGap");
        expect(fixture.layoutOptions.direction).toBe("horizontal");
        if (profile !== "uml-class") expect(fixture.layoutOptions).toMatchObject({ itemGap: 64 });
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
          structureKind: variant === "nested-dense" ? "timeline-vertical" : "timeline-horizontal",
          direction: variant === "nested-dense" ? "right" : "both",
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
        expect(native.getLayout()?.direction).toBe("both");
        // Restore generation settings before checking their original width budget.
        expect(board.undo()).toBe(true);
        expect(JSON.parse(JSON.stringify(board.save()))).toEqual(before);
        fixture.verify();
      });
    },
    20_000,
  );
});
