import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  proposeMeasuredTextGrowth,
  proposeGeneratedGraphCapacity,
  reserveGeneratedVisualCapacity,
  repairMeasuredVisualText,
  verifyRenderedLabelPlan,
  planModelGraphLayout,
} from "../scripts/board-visual-repair.mjs";
import { realizeVisualFixture } from "../scripts/board-visual-fixtures.mjs";

const snapshot = (board) => JSON.parse(JSON.stringify(board.save()));

describe("generated sequence participant text capacity", () => {
  it.each(["allowed", "unmarked", "fixed", "locked", "unselectable", "managed", "activation"])(
    "keeps native protection unless participant growth is explicitly authorized (%s)",
    async (mode) => {
      const { createStandardHeadlessUniverFactory, createStandardHeadlessUniverFacade } =
        await import("@univer-cli/headless-univer");
      const { UniverInstanceType } = await import("@univerjs/core");
      const univer = await createStandardHeadlessUniverFactory({ license: "" })({
        unitId: "sequence-text-capacity",
        unitType: UniverInstanceType.UNIVER_BOARD,
      });
      try {
        const api = createStandardHeadlessUniverFacade(univer),
          board = api.createBoard({ id: "sequence-text-capacity" });
        const shape = board.insertShape({
          shapeType:
            mode === "activation"
              ? api.Enum.BoardSequenceShapeType.ActivationBar
              : api.Enum.BoardSequenceShapeType.ObjectLifeline,
          transform: { left: 100, top: 70, width: 200, height: 60 },
          ...(mode === "activation"
            ? {}
            : { shapeData: { sequenceLifeline: { lifelineHeight: 900 } } }),
        });
        shape.getText().setText("服务职责与边界 / Responsibility and ownership");
        const id = shape.getId();
        if (mode === "locked") expect(board.setElementMetadata(id, { locked: true })).toBe(true);
        if (mode === "unselectable")
          expect(board.setElementMetadata(id, { selectable: false })).toBe(true);
        if (mode === "managed")
          expect(
            board.updateElement(id, {
              element: { ...board.getElement(id), managedBy: "native-owner" },
            }),
          ).toBe(true);
        const fixture = {
          nodes: [],
          fixed: mode === "fixed" ? [id] : [],
          protected: [id],
          expandableSequenceParticipants: mode === "unmarked" ? [] : [id],
          layoutOptions: { direction: "vertical", maxNodes: 100 },
          verify() {},
        };
        const before = snapshot(board);
        const report = {
          analyses: [
            {
              rendered: {
                issues: [
                  {
                    rule: "element-text-overflow",
                    elementIds: [id],
                    textLayout: {
                      availableSize: { width: 186.142082844, height: 46.142082844 },
                      contentSize: { width: 123.125, height: 52.8 },
                    },
                  },
                ],
              },
            },
          ],
        };
        const proposal = proposeMeasuredTextGrowth(board, report, fixture);
        expect(snapshot(board)).toEqual(before);
        if (mode !== "allowed") {
          expect(proposal.patches).toEqual({});
          expect(proposal.skipped).toHaveLength(1);
          return;
        }
        expect(proposal.patches[id]).toEqual({ width: 200, height: 73 });
        let calls = 0;
        const result = await repairMeasuredVisualText(
          board,
          { lint: async () => (calls++ ? { analyses: [{ rendered: { issues: [] } }] } : report) },
          fixture,
        );
        expect(result.status).toBe("no-overflow-reported");
        expect(result.attempts[0].growthApplications[0]).toMatchObject({
          changed: true,
          undoExact: true,
          redoExact: true,
        });
        expect(board.getElement(id).shapeData).toEqual(
          Object.values(before.pages)[0].elements[id].shapeData,
        );
        expect(board.getElement(id).transform).toMatchObject({
          left: 100,
          top: 70,
          width: 200,
          height: 73,
        });
        const after = snapshot(board);
        expect(await board.undo()).toBe(true);
        expect(snapshot(board)).toEqual(before);
        expect(await board.redo()).toBe(true);
        expect(snapshot(board)).toEqual(after);
      } finally {
        univer.dispose();
      }
    },
    20_000,
  );
});

describe("generated swimlane capacity preflight", () => {
  it.each([
    "allowed",
    "unmarked-later-lane",
    "pinned-later-member",
    "locked-later-lane",
    "collapsed-later-lane",
    "graph-budget",
  ])(
    "uses native horizontal lane resizing without borrowing protected capacity (%s)",
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
        const generated = realizeVisualFixture(board, api, "uml-activity", "business");
        const initialPlan = planModelGraphLayout(board, generated.layoutOptions);
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
          // This regression retains the legacy measurement-only adapter contract.
          textPlanElementIds: undefined,
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
        // A renderer-boundary report whose text exceeds the current horizontal lane capacity.
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
                      contentSize: {
                        width: 101,
                        height: initialLanes.find((lane) => lane.id === "finance").size + 102.3,
                      },
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
          expect(proposal.lanePatches).toEqual([]);
          expect(result.attempts[0].lanePatches.length).toBeGreaterThan(1);
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

const capturedActivity = JSON.parse(
  readFileSync(
    new URL("./fixtures/board-visual-activity-business76.json", import.meta.url),
    "utf8",
  ),
);

async function withCapturedActivity(run) {
  const { createStandardHeadlessUniverFactory, createStandardHeadlessUniverFacade } =
    await import("@univer-cli/headless-univer");
  const { UniverInstanceType } = await import("@univerjs/core");
  const univer = await createStandardHeadlessUniverFactory({ license: "" })({
    unitId: capturedActivity.snapshot.id,
    unitType: UniverInstanceType.UNIVER_BOARD,
  });
  try {
    const api = createStandardHeadlessUniverFacade(univer);
    const board = api.createBoard(structuredClone(capturedActivity.snapshot));
    const fixture = {
      ...structuredClone(capturedActivity.fixture),
      layoutOptions: { ...capturedActivity.fixture.layoutOptions, layerGap: 251 },
      verify() {
        for (const id of this.nodes) {
          const element = board.getElement(id);
          expect(element.parentId).toBe("visual-pool");
          expect(element.custom.visualSourceId).toBe(id.slice("visual-".length));
        }
      },
    };
    await run(board, fixture, api);
  } finally {
    univer.dispose();
  }
}

describe("native candidate driven generated pool capacity", () => {
  it("reserves the real global-rank main span before initial layout and preserves exact history/reopen", async () => {
    await withCapturedActivity(async (board, fixture, api) => {
      const before = snapshot(board),
        plan = planModelGraphLayout(board, fixture.layoutOptions);
      // Exact native76 counterexample: only2 requester members, but close is global rank5.
      expect(plan.status).toBe("incomplete");
      expect(
        plan.diagnostics
          .filter((item) => item.code === "swimlane-capacity-exceeded")
          .flatMap((item) => item.elementIds),
      ).toEqual(expect.arrayContaining(["visual-close", "visual-record"]));
      expect(snapshot(board)).toEqual(before);
      const reserved = reserveGeneratedVisualCapacity(board, fixture);
      expect(reserved.status).toBe("ready");
      expect(reserved.applications.some((item) => item.kind === "swimlane-pool-capacity")).toBe(
        true,
      );
      expect(
        reserved.applications.every((item) => !item.changed || (item.undoExact && item.redoExact)),
      ).toBe(true);
      const pool = board.getElement("visual-pool");
      expect(pool.transform.width).toBeGreaterThan(2100);
      for (const id of fixture.nodes) {
        const original = Object.values(before.pages)[0].elements[id];
        expect(board.getElement(id).shapeData).toEqual(original.shapeData);
        expect(board.getElement(id).transform.width).toBe(original.transform.width);
        expect(board.getElement(id).transform.height).toBe(original.transform.height);
        expect(board.getElement(id).laneId).toBe(original.laneId);
      }
      const ready = planModelGraphLayout(board, fixture.layoutOptions),
        capacityModel = snapshot(board);
      expect(ready.status).toBe("ready");
      expect(board.applyLayoutPlan(ready)).toBe(true);
      const laidOut = snapshot(board);
      expect(board.undo()).toBe(true);
      expect(snapshot(board)).toEqual(capacityModel);
      expect(board.redo()).toBe(true);
      expect(snapshot(board)).toEqual(laidOut);
      expect(board.applyLayoutPlan(ready)).toBe(false);
      expect(snapshot(board)).toEqual(laidOut);
      api.disposeUnit(board.getId());
      const reopened = api.createBoard(laidOut);
      expect(snapshot(reopened)).toEqual(laidOut);
      expect(planModelGraphLayout(reopened, fixture.layoutOptions).status).toBe("ready");
    });
  }, 20_000);

  it("uses the real102.3px diamond measurement and honors the native lane and pool demand", async () => {
    await withCapturedActivity(async (board, fixture) => {
      expect(reserveGeneratedVisualCapacity(board, fixture).status).toBe("ready");
      expect(board.applyLayoutPlan(planModelGraphLayout(board, fixture.layoutOptions))).toBe(true);
      const original = board.getElement("visual-budget"),
        before = snapshot(board);
      let measurements = 0;
      const result = await repairMeasuredVisualText(
        board,
        {
          lint: async () =>
            measurements++
              ? { analyses: [{ rendered: { issues: [] } }] }
              : structuredClone(capturedActivity.measuredReport),
        },
        fixture,
      );
      expect(result.status).toBe("no-overflow-reported");
      expect(result.attempts[0].growthRolledBack).toBe(false);
      expect(result.attempts[0].capacityPreparation.status).toBe("ready");
      expect(board.getElement("visual-budget").transform.height).toBe(293);
      const finance = board
        .getElement("visual-pool")
        .containerData.swimlane.lanes.find((lane) => lane.id === "finance");
      expect(finance.size).toBeGreaterThanOrEqual(293 + 24);
      expect(
        result.attempts[0].growthApplications.every(
          (item) => !item.changed || (item.undoExact && item.redoExact),
        ),
      ).toBe(true);
      expect(board.getElement("visual-budget").shapeData).toEqual(original.shapeData);
      expect(planModelGraphLayout(board, fixture.layoutOptions).status).toBe("ready");
      expect(snapshot(board)).not.toEqual(before);
      fixture.verify();
    });
  }, 20_000);

  it.each([
    "unmarked-pool",
    "fixed-pool",
    "locked-pool",
    "pinned-member",
    "manual-guide",
    "rotated-owner",
    "locked-lane",
    "collapsed-lane",
    "budget",
  ])(
    "does not spend authored or protected capacity (%s)",
    async (mode) => {
      await withCapturedActivity(async (board, original) => {
        const initial = snapshot(board),
          elements = structuredClone(board.getElements());
        const fixture = { ...original, expandableLanes: [] };
        let plan = planModelGraphLayout(board, fixture.layoutOptions);
        if (mode === "unmarked-pool") fixture.expandablePools = [];
        if (mode === "fixed-pool") fixture.fixed = [...fixture.fixed, "visual-pool"];
        if (mode === "locked-pool") elements["visual-pool"].locked = true;
        if (mode === "pinned-member") fixture.fixed = [...fixture.fixed, fixture.nodes[0]];
        if (mode === "manual-guide") {
          const connector = Object.values(elements).find((item) => item.type === "connector");
          connector.connectorData.routingMode = "manual";
          connector.connectorData.waypoints = [{ x: 100, y: 200 }];
        }
        if (mode === "rotated-owner") elements["visual-pool"].transform.rotation = 15;
        if (mode === "locked-lane")
          elements["visual-pool"].containerData.swimlane.lanes[0].locked = true;
        if (mode === "collapsed-lane")
          elements["visual-pool"].containerData.swimlane.lanes[0].collapsed = true;
        if (mode === "budget")
          plan = { ...plan, diagnostics: [...plan.diagnostics, { code: "node-budget-exceeded" }] };
        const proposal = proposeGeneratedGraphCapacity(
          {
            getElement: (id) => structuredClone(elements[id]),
            getElements: () => structuredClone(elements),
          },
          fixture,
          plan,
        );
        expect(proposal.poolPatches).toEqual([]);
        expect(proposal.lanePatches).toEqual([]);
        expect(snapshot(board)).toEqual(initial);
      });
    },
    20_000,
  );

  it("keeps explicit lane sizes exact when only the generated pool main axis is authorized", async () => {
    await withCapturedActivity(async (board, fixture) => {
      const lanes = board.getElement("visual-pool").containerData.swimlane.lanes;
      const result = reserveGeneratedVisualCapacity(board, { ...fixture, expandableLanes: [] });
      expect(result.status).toBe("ready");
      expect(board.getElement("visual-pool").containerData.swimlane.lanes).toEqual(lanes);
      expect(result.applications.every((item) => item.kind === "swimlane-pool-capacity")).toBe(
        true,
      );
    });
  }, 20_000);

  it("retains a real over-budget plan and makes no capacity writes", async () => {
    await withCapturedActivity(async (board, fixture) => {
      const before = snapshot(board);
      const result = reserveGeneratedVisualCapacity(board, {
        ...fixture,
        layoutOptions: { ...fixture.layoutOptions, maxNodes: 1 },
      });
      expect(result.status).toBe("blocked");
      expect(result.applications).toEqual([]);
      expect(snapshot(board)).toEqual(before);
    });
  }, 20_000);
});

describe("public global-rank capacity repair regression", () => {
  it("restores a public global-rank plan without changing an explicit251px gap", async () => {
    const captured = JSON.parse(
      readFileSync(
        new URL("./fixtures/board-visual-activity-business76.json", import.meta.url),
        "utf8",
      ),
    );
    const { createStandardHeadlessUniverFactory, createStandardHeadlessUniverFacade } =
      await import("@univer-cli/headless-univer");
    const { UniverInstanceType } = await import("@univerjs/core");
    const univer = await createStandardHeadlessUniverFactory({ license: "" })({
      unitId: captured.snapshot.id,
      unitType: UniverInstanceType.UNIVER_BOARD,
    });
    try {
      const api = createStandardHeadlessUniverFacade(univer),
        board = api.createBoard(structuredClone(captured.snapshot));
      const fixture = {
        ...structuredClone(captured.fixture),
        // Explicit test constraint exercises the same main-axis defect on older installed SDKs.
        // Product generation keeps the current SDK's default font/label budget.
        layoutOptions: { ...captured.fixture.layoutOptions, layerGap: 251 },
        verify() {},
      };
      const initial = snapshot(board),
        initialPlan = planModelGraphLayout(board, fixture.layoutOptions);
      expect(initialPlan.status).toBe("incomplete");
      expect(
        initialPlan.diagnostics.some((item) => item.code === "swimlane-capacity-exceeded"),
      ).toBe(true);
      expect(snapshot(board)).toEqual(initial);
      let measurements = 0;
      const result = await repairMeasuredVisualText(
        board,
        {
          lint: async () =>
            measurements++
              ? { analyses: [{ rendered: { issues: [] } }] }
              : structuredClone(captured.measuredReport),
        },
        fixture,
      );
      expect(result.status).toBe("no-overflow-reported");
      expect(result.attempts[0].growthRolledBack).toBe(false);
      expect(board.getElement("visual-pool").transform.width).toBeGreaterThan(2100);
      expect(board.getElement("visual-budget").transform.height).toBe(293);
      expect(fixture.layoutOptions.layerGap).toBe(251);
      expect(planModelGraphLayout(board, fixture.layoutOptions).status).toBe("ready");
      for (const id of fixture.nodes) {
        const original = Object.values(initial.pages)[0].elements[id],
          actual = board.getElement(id);
        expect(actual.shapeData).toEqual(original.shapeData);
        expect(actual.custom).toEqual(original.custom);
        expect(actual.parentId).toBe(original.parentId);
        expect(actual.laneId).toBe(original.laneId);
      }
    } finally {
      univer.dispose();
    }
  }, 20_000);
});

describe("Visual verifier native distance policy", () => {
  it.each([undefined, 12])(
    "sends policy %s to both real verifier lint phases and preserves the Board",
    async (maximumAutomaticLabelDistance) => {
      const { createStandardHeadlessUniverFactory, createStandardHeadlessUniverFacade } =
        await import("@univer-cli/headless-univer");
      const { UniverInstanceType } = await import("@univerjs/core");
      const univer = await createStandardHeadlessUniverFactory({ license: "" })({
        unitId: "label-policy",
        unitType: UniverInstanceType.UNIVER_BOARD,
      });
      try {
        const board = createStandardHeadlessUniverFacade(univer).createBoard({
          id: "label-policy",
        });
        const before = snapshot(board),
          pageId = before.pageOrder[0],
          calls = [];
        const lint = {
          lint: async (input) => {
            calls.push(structuredClone(input));
            return {
              status: "clean",
              findings: [],
              analyses: [
                {
                  pageId,
                  rendered: {
                    source: "rendered",
                    routes: [],
                    issues: [],
                    connectorLabelLayouts: {},
                    ...(maximumAutomaticLabelDistance === undefined
                      ? {}
                      : {
                          labelDistanceInspection: {
                            maximumAutomaticLabelDistance,
                            metric: "rendered-stroke-polyline-v1",
                          },
                        }),
                  },
                  ...(input.includeLabelPlan
                    ? { labelPlan: { status: "ready", patches: [] } }
                    : {}),
                },
              ],
            };
          },
        };
        const result = await verifyRenderedLabelPlan(
          board,
          lint,
          true,
          {},
          maximumAutomaticLabelDistance,
        );
        expect(calls).toHaveLength(2);
        for (const input of calls) {
          expect(input.unitData).toEqual(before);
          if (maximumAutomaticLabelDistance === undefined)
            expect(input).not.toHaveProperty("maximumAutomaticLabelDistance");
          else expect(input.maximumAutomaticLabelDistance).toBe(12);
        }
        expect(snapshot(board)).toEqual(before);
        if (maximumAutomaticLabelDistance === undefined)
          expect(result).not.toHaveProperty("automaticLabelDistance");
        else
          expect(result.automaticLabelDistance).toMatchObject({
            status: "measured",
            source: "native-lint-analysis",
            sameStateWithScreenshots: "not-established",
            finalPaintDistance: "unmeasured",
          });
      } finally {
        univer.dispose();
      }
    },
    20_000,
  );
  it("does not accept an old clean producer as completed requested distance evidence", async () => {
    const { createStandardHeadlessUniverFactory, createStandardHeadlessUniverFacade } =
      await import("@univer-cli/headless-univer");
    const { UniverInstanceType } = await import("@univerjs/core");
    const univer = await createStandardHeadlessUniverFactory({ license: "" })({
      unitId: "old-label-producer",
      unitType: UniverInstanceType.UNIVER_BOARD,
    });
    try {
      const board = createStandardHeadlessUniverFacade(univer).createBoard({
          id: "old-label-producer",
        }),
        pageId = snapshot(board).pageOrder[0];
      const result = await verifyRenderedLabelPlan(
        board,
        {
          lint: async () => ({
            status: "clean",
            findings: [],
            analyses: [
              {
                pageId,
                rendered: { source: "rendered", issues: [], routes: [], connectorLabelLayouts: {} },
                labelPlan: { status: "ready", patches: [] },
              },
            ],
          }),
        },
        true,
        {},
        12,
      );
      expect(result.after.status).toBe("clean");
      expect(result.automaticLabelDistance.status).toBe("incomplete");
    } finally {
      univer.dispose();
    }
  }, 20_000);
});
