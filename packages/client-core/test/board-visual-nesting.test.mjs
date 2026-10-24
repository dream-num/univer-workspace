import { describe, expect, it } from "vitest";
import {
  getVisualCase,
  realizeVisualFixture,
  visualCases,
} from "../scripts/board-visual-fixtures.mjs";

describe("generated nested business ownership", () => {
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
