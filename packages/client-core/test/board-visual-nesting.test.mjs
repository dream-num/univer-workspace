import { describe, expect, it } from "vitest";
import {
  getVisualCase,
  realizeVisualFixture,
  visualCases,
} from "../scripts/board-visual-fixtures.mjs";

describe("generated nested business ownership", () => {
  it("keeps one content column per responsibility lane during vertical flow and explicit lane growth", async () => {
    const { createStandardHeadlessUniverFactory, createStandardHeadlessUniverFacade } =
      await import("@univer-cli/headless-univer");
    const { UniverInstanceType } = await import("@univerjs/core");
    const univer = await createStandardHeadlessUniverFactory({ license: "" })({
      unitId: "vertical-pool-width",
      unitType: UniverInstanceType.UNIVER_BOARD,
    });
    try {
      const api = createStandardHeadlessUniverFacade(univer);
      const board = api.createBoard({ id: "vertical-pool-width", name: "Vertical flow" });
      const fixture = realizeVisualFixture(board, api, "uml-activity", "nested-dense");
      const pool = board.getElement("visual-pool");
      const width = Math.max(...fixture.nodes.map((id) => board.getElement(id).transform.width));
      const lanes = structuredClone(pool.containerData.swimlane.lanes);
      expect(pool.containerData.swimlane.orientation).toBe("vertical");
      for (const lane of lanes) {
        const members = fixture.nodes
          .map((id) => board.getElement(id))
          .filter((node) => node.laneId === lane.id);
        expect(lane.size).toBe(Math.max(...members.map((node) => node.transform.width)) + 72);
      }
      const plan = board.planGraphLayout({
        ...fixture.layoutOptions,
        fixedElementIds: fixture.fixed,
      });
      expect(plan.status).toBe("ready");
      expect(board.applyLayoutPlan(plan)).toBe(true);
      expect(board.getElement(pool.id).containerData.swimlane.lanes).toEqual(lanes);
      const bounds = board.getElementBounds(pool.id);
      for (const id of fixture.nodes) {
        const child = board.getElementBounds(id);
        expect(child.left).toBeGreaterThanOrEqual(bounds.left);
        expect(child.top).toBeGreaterThanOrEqual(
          bounds.top + pool.containerData.swimlane.headerSize,
        );
        expect(child.left + child.width).toBeLessThanOrEqual(bounds.left + bounds.width);
        const laneId = board.getElement(id).laneId;
        for (const x of [child.left + 1, child.left + child.width - 1]) {
          for (const y of [child.top + 1, child.top + child.height - 1]) {
            expect(board.resolveDropTargetAtPoint({ x, y }, { area: "content" })).toMatchObject({
              containerId: pool.id,
              laneId,
            });
          }
        }
      }
      const budget = board.getElement("visual-budget");
      const lane = lanes.find((item) => item.id === budget.laneId);
      // Native lane boundaries borrow from the next column; add capacity at the suffix before redistributing it.
      const lastLane = lanes.at(-1);
      const beforeSuffixGrowth = JSON.parse(JSON.stringify(board.save()));
      expect(board.setSwimlaneLaneSize(pool.id, lastLane.id, lastLane.size + width)).toBe(true);
      const afterSuffixGrowth = JSON.parse(JSON.stringify(board.save()));
      expect(await board.undo()).toBe(true);
      expect(JSON.parse(JSON.stringify(board.save()))).toEqual(beforeSuffixGrowth);
      expect(await board.redo()).toBe(true);
      expect(JSON.parse(JSON.stringify(board.save()))).toEqual(afterSuffixGrowth);
      const beforeLaneGrowth = JSON.parse(JSON.stringify(board.save()));
      expect(board.setSwimlaneLaneSize(pool.id, lane.id, lane.size + width)).toBe(true);
      const afterLaneGrowth = JSON.parse(JSON.stringify(board.save()));
      expect(board.getElement(pool.id).transform.width).toBe(pool.transform.width + width);
      expect(await board.undo()).toBe(true);
      expect(JSON.parse(JSON.stringify(board.save()))).toEqual(beforeLaneGrowth);
      expect(await board.redo()).toBe(true);
      expect(JSON.parse(JSON.stringify(board.save()))).toEqual(afterLaneGrowth);
      const beforeGrowth = JSON.parse(JSON.stringify(board.save()));
      expect(
        board.setElementsTransform({
          "visual-budget": { width: width * 2 },
        }),
      ).toBe(true);
      const afterGrowth = JSON.parse(JSON.stringify(board.save()));
      expect(board.getElement("visual-pool").transform.width).toBeGreaterThan(pool.transform.width);
      expect(await board.undo()).toBe(true);
      expect(JSON.parse(JSON.stringify(board.save()))).toEqual(beforeGrowth);
      expect(await board.redo()).toBe(true);
      expect(JSON.parse(JSON.stringify(board.save()))).toEqual(afterGrowth);
      const enlarged = board.planGraphLayout({
        ...fixture.layoutOptions,
        fixedElementIds: fixture.fixed,
      });
      expect(enlarged.status).toBe("ready");
      expect(board.applyLayoutPlan(enlarged)).toBe(true);
      fixture.verify();
    } finally {
      univer.dispose();
    }
  }, 20_000);

  it("wraps every existing direct scope along with its nodes without changing source facts", () => {
    for (const profile of Object.keys(visualCases)) {
      const source = getVisualCase(profile, "business");
      const nested = getVisualCase(profile, "nested-dense");
      const wrapper = nested.groups?.find((group) => group.id === "operational-boundary");
      if (!wrapper) continue;
      const originalRoot = source.groups?.find((group) => !group.parent);
      for (const group of source.groups ?? []) {
        const actual = nested.groups.find((item) => item.id === group.id);
        expect(actual).toEqual({
          ...group,
          ...(group.parent === originalRoot?.id ? { parent: wrapper.id } : {}),
        });
        if (actual.parent === wrapper.id)
          expect(nested.groups.indexOf(wrapper)).toBeLessThan(nested.groups.indexOf(actual));
      }
      for (const node of source.nodes) {
        const actual = nested.nodes.find((item) => item.id === node.id);
        expect(actual).toEqual({
          ...node,
          ...(!node.parent || node.parent === wrapper.parent ? { parent: wrapper.id } : {}),
        });
      }
      for (const edge of source.edges) expect(nested.edges).toContainEqual(edge);
    }
  });

  it.each(["architecture", "deployment", "uml-state", "uml-package"])(
    "creates and lays out %s with every declared scope inside the new wrapper",
    async (profile) => {
      const { createStandardHeadlessUniverFactory, createStandardHeadlessUniverFacade } =
        await import("@univer-cli/headless-univer");
      const { UniverInstanceType } = await import("@univerjs/core");
      const univer = await createStandardHeadlessUniverFactory({ license: "" })({
        unitId: `nested-${profile}`,
        unitType: UniverInstanceType.UNIVER_BOARD,
      });
      try {
        const api = createStandardHeadlessUniverFacade(univer);
        const board = api.createBoard({ id: `nested-${profile}`, name: profile });
        const fixture = realizeVisualFixture(board, api, profile, "nested-dense");
        const check = () => {
          for (const group of fixture.spec.groups) {
            const actual = board.getElement(`visual-${group.id}`);
            expect(actual.parentId ?? null).toBe(group.parent ? `visual-${group.parent}` : null);
          }
          fixture.verify();
        };
        check();
        const before = JSON.stringify(board.save());
        const plan = board.planGraphLayout({
          ...fixture.layoutOptions,
          fixedElementIds: fixture.fixed,
        });
        expect(JSON.stringify(board.save())).toBe(before);
        expect(plan.status).toBe("ready");
        expect(board.applyLayoutPlan(plan)).toBe(true);
        for (const id of fixture.compactContainers)
          expect(board.fitContainerToContent(id)).toBe(true);
        check();
      } finally {
        univer.dispose();
      }
    },
    20_000,
  );
});
