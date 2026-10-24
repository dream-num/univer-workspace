import { describe, expect, it } from "vitest";
import {
  proposeMeasuredTextGrowth,
  repairMeasuredVisualText,
} from "../scripts/board-visual-repair.mjs";
import { realizeVisualFixture } from "../scripts/board-visual-fixtures.mjs";

const snapshot = (board) => JSON.parse(JSON.stringify(board.save()));

describe("generated swimlane capacity preflight", () => {
  it.each([
    "allowed",
    "unmarked-later-lane",
    "pinned-later-member",
    "locked-later-lane",
    "collapsed-later-lane",
    "graph-budget",
  ])(
    "uses native lane resizing without borrowing protected capacity (%s)",
    async (mode) => {
      const { createStandardHeadlessUniverFactory, createStandardHeadlessUniverFacade } =
        await import("@univer-cli/headless-univer");
      const { UniverInstanceType } = await import("@univerjs/core");
      const univer = await createStandardHeadlessUniverFactory({ license: "" })({
        unitId: "nested-capacity",
        unitType: UniverInstanceType.UNIVER_BOARD,
      });
      try {
        const api = createStandardHeadlessUniverFacade(univer);
        const board = api.createBoard({ id: "nested-capacity", name: "Nested activity" });
        const generated = realizeVisualFixture(board, api, "uml-activity", "nested-dense");
        const initialPlan = board.planGraphLayout(generated.layoutOptions);
        expect(initialPlan.status).toBe("ready");
        expect(board.applyLayoutPlan(initialPlan)).toBe(true);
        const pool = board.getElement("visual-pool");
        const lastLane = [...pool.containerData.swimlane.lanes]
          .sort((a, b) => a.order - b.order)
          .at(-1);
        if (["locked-later-lane", "collapsed-later-lane"].includes(mode))
          expect(
            board.setSwimlaneLanes(pool.id, {
              ...pool.containerData.swimlane,
              lanes: pool.containerData.swimlane.lanes.map((lane) =>
                lane.id === lastLane.id
                  ? { ...lane, [mode === "locked-later-lane" ? "locked" : "collapsed"]: true }
                  : lane,
              ),
            }),
          ).toBe(true);
        const initial = snapshot(board);
        const initialLanes = board.getElement("visual-pool").containerData.swimlane.lanes;
        const fixture = {
          ...generated,
          ...(mode === "unmarked-later-lane"
            ? {
                expandableLanes: generated.expandableLanes.filter(
                  (item) => item.laneId !== lastLane.id,
                ),
              }
            : {}),
          ...(mode === "pinned-later-member"
            ? {
                fixed: [
                  ...generated.fixed,
                  ...generated.nodes.filter((id) => board.getElement(id).laneId === lastLane.id),
                ],
              }
            : {}),
          ...(mode === "graph-budget"
            ? { layoutOptions: { ...generated.layoutOptions, maxNodes: 1 } }
            : {}),
        };
        // Real dev19 rendered measurement of this generated diamond, not an estimated glyph width.
        const firstReport = {
          analyses: [
            {
              rendered: {
                issues: [
                  {
                    rule: "element-text-overflow",
                    elementIds: ["visual-budget"],
                    textLayout: {
                      availableSize: { width: 104, height: 49 },
                      contentSize: { width: 101, height: 102.3 },
                    },
                  },
                ],
              },
            },
          ],
        };
        const proposal = proposeMeasuredTextGrowth(board, firstReport, fixture);
        expect(snapshot(board)).toEqual(initial);
        let measurements = 0;
        const result = await repairMeasuredVisualText(
          board,
          {
            lint: async () =>
              measurements++ ? { analyses: [{ rendered: { issues: [] } }] } : firstReport,
          },
          fixture,
        );
        expect(result.status).toBe(
          mode === "allowed" ? "no-overflow-reported" : "replan-incomplete",
        );
        if (mode === "allowed") {
          expect(result.attempts[0].plan.status).toBe("ready");
          expect(result.attempts[0].growthRolledBack).toBe(false);
          expect(proposal.lanePatches.length).toBeGreaterThan(1);
          for (const lane of board.getElement("visual-pool").containerData.swimlane.lanes)
            expect(lane.size).toBeGreaterThanOrEqual(
              initialLanes.find((item) => item.id === lane.id).size,
            );
          expect(board.getElement("visual-budget").transform.height).toBe(
            proposal.patches["visual-budget"].height,
          );
          expect(
            result.attempts[0].growthApplications.every(
              (item) => !item.changed || (item.undoExact && item.redoExact),
            ),
          ).toBe(true);
        } else {
          expect(snapshot(board)).toEqual(initial);
          expect(result.attempts[0].growthRolledBack).toBe(true);
        }
        fixture.verify();
      } finally {
        univer.dispose();
      }
    },
    20_000,
  );
});
