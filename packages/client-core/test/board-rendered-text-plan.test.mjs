import { describe, expect, it } from "vitest";
import {
  createStandardHeadlessUniverFactory,
  createStandardHeadlessUniverFacade,
} from "@univer-cli/headless-univer";
import { UniverInstanceType } from "@univerjs/core";
import {
  proposeMeasuredTextGrowth,
  repairMeasuredVisualText,
  planModelGraphLayout,
} from "../scripts/board-visual-repair.mjs";
import { realizeVisualFixture } from "../scripts/board-visual-fixtures.mjs";

const snapshot = (board) => JSON.parse(JSON.stringify(board.save()));

async function withBoard(run) {
  const univer = await createStandardHeadlessUniverFactory({ license: "" })({
    unitId: "native-text-plan",
    unitType: UniverInstanceType.UNIVER_BOARD,
  });
  try {
    const api = createStandardHeadlessUniverFacade(univer),
      board = api.createBoard({ id: "native-text-plan" });
    const nodes = [0, 1].map((index) => {
      const shape = board.insertShape({
        shapeType: api.Enum.ShapeTypeEnum.FlowchartDecision,
        transform: { left: 100 + index * 360, top: 100, width: 200, height: 100 },
      });
      shape.getText().setText("完整决策条件 / Complete decision condition");
      return shape.getId();
    });
    const fixture = {
      nodes,
      fixed: [],
      protected: [],
      textPlanElementIds: [nodes[0]],
      textPlanMaximumWidthGrowth: 1.5,
      layoutOptions: { elementIds: nodes, maxNodes: 180, direction: "horizontal" },
      verify() {},
    };
    await run(board, fixture, api);
  } finally {
    univer.dispose();
  }
}

function measuredReport(board, fixture, mode = "ready") {
  const id = fixture.textPlanElementIds[0],
    element = board.getElement(id),
    overflow = element.transform.width === 200;
  const envelope = planModelGraphLayout(board, { ...fixture.layoutOptions, maxNodes: 180 });
  expect(envelope.status).toBe("ready");
  return {
    analyses: [
      {
        pageId: board.save().activePageId,
        rendered: {
          issues: overflow
            ? [
                {
                  rule: "element-text-overflow",
                  elementIds: [id],
                  textLayout: {
                    availableSize: { width: 100, height: 50 },
                    contentSize: { width: 180, height: 120 },
                  },
                },
              ]
            : [],
        },
        ...(mode === "missing"
          ? {}
          : {
              textPlan: {
                ...envelope,
                status: mode === "incomplete" ? "incomplete" : "ready",
                patches:
                  mode === "empty" || !overflow
                    ? []
                    : [{ elementId: id, transform: { width: 275, height: 140 } }],
                diagnostics:
                  mode === "incomplete"
                    ? [{ code: "text-layout/unresolved", elementIds: [id] }]
                    : [],
              },
            }),
      },
    ],
  };
}

describe("generated native measured text plan", () => {
  it("applies native dimensions with exact history and preserves complete text/styles", async () => {
    await withBoard(async (board, fixture) => {
      const before = snapshot(board),
        id = fixture.nodes[0],
        original = board.getElement(id).shapeData,
        requests = [];
      const result = await repairMeasuredVisualText(
        board,
        {
          lint: async (input) => {
            requests.push(input);
            return measuredReport(board, fixture);
          },
        },
        fixture,
      );
      expect(
        requests.every(
          (input) =>
            JSON.stringify(input.textPlanElementIds) === JSON.stringify([id]) &&
            input.textPlanMaximumWidthGrowth === 1.5,
        ),
      ).toBe(true);
      expect(result.status).toBe("no-overflow-reported");
      expect(result.attempts).toHaveLength(1);
      expect(result.attempts[0].patches).toEqual({});
      expect(result.attempts[0].growthApplications[0]).toMatchObject({
        kind: "native-rendered-text-plan",
        applied: true,
        changed: true,
        undoExact: true,
        redoExact: true,
      });
      expect(board.getElement(id).transform).toMatchObject({ width: 275, height: 140 });
      expect(board.getElement(id).shapeData).toEqual(original);
      expect(snapshot(board)).not.toEqual(before);
      expect(requests[0].unitData).toEqual(before);
      expect(
        proposeMeasuredTextGrowth(board, measuredReport(board, fixture), fixture).patches,
      ).toEqual({});
    });
  }, 20_000);

  it.each(["missing", "incomplete", "empty"])(
    "keeps the original model without ratio fallback when native evidence is %s",
    async (mode) => {
      await withBoard(async (board, fixture) => {
        const before = snapshot(board),
          report = measuredReport(board, fixture, mode);
        const result = await repairMeasuredVisualText(board, { lint: async () => report }, fixture);
        expect(result.status).toBe(
          {
            missing: "text-plan-unavailable",
            incomplete: "text-plan-incomplete",
            empty: "blocked",
          }[mode],
        );
        expect(result.attempts).toEqual([]);
        expect(result.reports).toEqual([report]);
        expect(snapshot(board)).toEqual(before);
        expect(proposeMeasuredTextGrowth(board, report, fixture).patches).toEqual({});
      });
    },
    20_000,
  );

  it("rolls back native growth when the actual graph budget cannot place the generated nodes", async () => {
    await withBoard(async (board, fixture) => {
      fixture.layoutOptions.maxNodes = 1;
      const before = snapshot(board);
      const result = await repairMeasuredVisualText(
        board,
        { lint: async () => measuredReport(board, fixture) },
        fixture,
      );
      expect(result.status).toBe("replan-incomplete");
      expect(result.attempts[0].growthRolledBack).toBe(true);
      expect(result.attempts[0].growthApplications[0].kind).toBe("native-rendered-text-plan");
      expect(snapshot(board)).toEqual(before);
    });
  }, 20_000);

  it("refuses a measurement adapter that changes the editable source", async () => {
    await withBoard(async (board, fixture) => {
      await expect(
        repairMeasuredVisualText(
          board,
          {
            lint: async () => {
              board.setElementTransform(fixture.nodes[0], { width: 210 });
              return measuredReport(board, fixture);
            },
          },
          fixture,
        ),
      ).rejects.toThrow("Rendered text planning changed source content");
    });
  }, 20_000);

  it("declares ordinary generated preset IDs while custom glyphs and native structures stay owned", async () => {
    for (const profile of [
      "flowchart",
      "uml-use-case",
      "uml-component",
      "uml-state",
      "uml-sequence",
      "mindmap",
    ]) {
      const univer = await createStandardHeadlessUniverFactory({ license: "" })({
        unitId: profile,
        unitType: UniverInstanceType.UNIVER_BOARD,
      });
      try {
        const api = createStandardHeadlessUniverFacade(univer),
          board = api.createBoard({ id: profile });
        const fixture = realizeVisualFixture(board, api, profile, "business");
        for (const id of fixture.textPlanElementIds ?? []) {
          const element = board.getElement(id);
          expect(fixture.nodes).toContain(id);
          expect(fixture.fixed).not.toContain(id);
          expect(fixture.protected).not.toContain(id);
          expect(element.type).toBe("shape");
          expect(element.shapeData.customGeometry).toBeUndefined();
          expect(element.shapeData.sequenceLifeline).toBeUndefined();
        }
        if (profile === "flowchart") expect(fixture.textPlanElementIds).toHaveLength(7);
        if (["uml-sequence", "mindmap"].includes(profile))
          expect(fixture.textPlanElementIds).toBeUndefined();
        fixture.verify();
      } finally {
        univer.dispose();
      }
    }
  }, 20_000);
});
