import { describe, expect, it } from "vitest";
import {
  realizeVisualFixture,
  visualCases,
  visualVariants,
} from "../scripts/board-visual-fixtures.mjs";

const json = (value) => JSON.parse(JSON.stringify(value));

async function withBoard(callback) {
  const { createStandardHeadlessUniverFactory, createStandardHeadlessUniverFacade } =
    await import("@univer-cli/headless-univer");
  const { UniverInstanceType } = await import("@univerjs/core");
  const univer = await createStandardHeadlessUniverFactory({ license: "" })({
    unitId: "visual-semantics",
    unitType: UniverInstanceType.UNIVER_BOARD,
  });
  try {
    const api = createStandardHeadlessUniverFacade(univer);
    return await callback(
      api.createBoard({ id: "visual-semantics", name: "Visual semantics" }),
      api,
    );
  } finally {
    univer.dispose();
  }
}

function captionTop(element) {
  const geometry = element.shapeData.customGeometry;
  const guide = geometry.gd?.[geometry.rect.t];
  expect(guide?.slice(0, 2)).toEqual(["mulDiv", "h"]);
  return (element.transform.height * guide[2]) / guide[3];
}

function feetBottom(element) {
  return Math.max(
    ...element.shapeData.customGeometry.pathLst.flatMap((path) =>
      path.dataArray
        .filter((command) => command.command === "L")
        .map((command) => (command.points[1] * element.transform.height) / path.h),
    ),
  );
}

describe("Business diagram source semantics", () => {
  it.each(visualVariants)(
    "keeps only authored class names and multiplicities in %s",
    async (variant) => {
      await withBoard((board, api) => {
        const fixture = realizeVisualFixture(board, api, "uml-class", variant);
        const relations = Object.values(board.getElements()).filter(
          (element) => element.type === "connector",
        );
        for (const [index, relation] of relations.entries()) {
          const source = fixture.spec.edges[index];
          expect(relation.connectorData.labels.map((label) => label.content)).toEqual([
            source.label,
            source.startMultiplicity,
            source.endMultiplicity,
          ]);
          expect(
            relation.connectorData.labels.every((label) => label.placement.mode === "auto"),
          ).toBe(true);
        }
        fixture.verify();
      });
    },
    20_000,
  );

  it("retains explicit class endpoint roles alongside the relationship name and multiplicities", async () => {
    const original = visualCases["uml-class"].edges;
    try {
      visualCases["uml-class"].edges = original.map((edge, index) =>
        index === 0 ? { ...edge, startRole: "purchaser", endRole: "orderedLines" } : edge,
      );
      await withBoard((board, api) => {
        const fixture = realizeVisualFixture(board, api, "uml-class", "business");
        const relation = Object.values(board.getElements()).find(
          (element) => element.type === "connector",
        );
        const labels = relation.connectorData.labels;
        expect(labels.find((label) => label.id.endsWith(":name")).content).toBe("items");
        expect(labels.find((label) => label.id.endsWith(":start-role")).content).toBe("purchaser");
        expect(labels.find((label) => label.id.endsWith(":end-role")).content).toBe("orderedLines");
        expect(
          labels.filter((label) => label.id.endsWith("multiplicity")).map((label) => label.content),
        ).toEqual(["1", "1..*"]);
        fixture.verify();
      });
    } finally {
      visualCases["uml-class"].edges = original;
    }
  }, 20_000);

  it.each(visualVariants)(
    "keeps the complete %s actor caption below the native glyph through resize and history",
    async (variant) => {
      await withBoard((board, api) => {
        const control = board.insertShapeAtPoint({
          shapeType: api.Enum.BoardCustomShapeType.Actor,
          point: { x: -500, y: -500 },
          width: 130,
          height: 128,
        });
        const originalGeometry = json(board.getElement(control.id).shapeData.customGeometry);
        const fixture = realizeVisualFixture(board, api, "uml-use-case", variant);
        for (const source of fixture.spec.nodes.filter((node) => node.kind === "actor")) {
          const element = json(board.getElement(`visual-${source.id}`));
          expect(captionTop(element)).toBeGreaterThan(feetBottom(element) + 8);
          expect(feetBottom(element)).toBeCloseTo((214 * 128) / 244, 8);
          expect(element.shapeData.customGeometry.pathLst.map((path) => path.dataArray)).toEqual(
            originalGeometry.pathLst.map((path) => path.dataArray),
          );
          const doc = element.shapeData.shapeText.dataModel.doc;
          expect(doc.body.dataStream).toContain(source.title);
          for (const paragraph of source.detail.split("\n").filter(Boolean))
            expect(doc.body.dataStream).toContain(paragraph);
          expect(doc.body.textRuns.map((run) => run.ts.fs)).toEqual(
            source.detail ? [11.25, 9] : [11.25],
          );
          const outgoing = Object.values(board.getElements()).filter(
            (item) => item.custom?.visualSource?.from === source.id,
          );
          expect(
            new Set(outgoing.map((item) => item.connectorData.start.connectionSiteId)).size,
          ).toBe(outgoing.length);
          for (const relation of outgoing) {
            const endpoint = relation.connectorData.start;
            expect(endpoint.kind).toBe("shapeSite");
            expect(endpoint.shapeId).toBe(element.id);
            expect(endpoint.connectionPositionMode).toBe("fixed");
            expect(endpoint.connectionPosition * element.transform.height).toBeLessThan(
              captionTop(element),
            );
          }
          const before = json(board.save());
          expect(
            board.setElementsTransform({
              [element.id]: {
                width: element.transform.width * 1.5,
                height: element.transform.height * 2,
              },
            }),
          ).toBe(true);
          const resized = board.getElement(element.id);
          expect(captionTop(resized)).toBeGreaterThan(feetBottom(resized) + 16);
          expect(feetBottom(resized)).toBeCloseTo(feetBottom(element) * 2, 8);
          const after = json(board.save());
          expect(board.undo()).toBe(true);
          expect(json(board.save())).toEqual(before);
          expect(board.redo()).toBe(true);
          expect(json(board.save())).toEqual(after);
          expect(board.undo()).toBe(true);
        }
        const next = board.insertShapeAtPoint({
          shapeType: api.Enum.BoardCustomShapeType.Actor,
          point: { x: -700, y: -500 },
          width: 130,
          height: 128,
        });
        expect(board.getElement(next.id).shapeData.customGeometry).toEqual(originalGeometry);
        fixture.verify();
      });
    },
    20_000,
  );

  it("keeps authored Actor endpoints and manual guides instead of imposing generated glyph ports", async () => {
    const original = visualCases["uml-use-case"].edges;
    const start = {
      kind: "shapeSite",
      shapeId: "visual-patient",
      connectionSiteId: 2,
      connectionPosition: 0.2,
      connectionPositionMode: "fixed",
    };
    const waypoints = [{ id: "authored-actor-guide", x: -100, y: 700, kind: "manual" }];
    try {
      visualCases["uml-use-case"].edges = original.map((edge, index) =>
        index === 0 ? { ...edge, start, waypoints, routingMode: "manual" } : edge,
      );
      await withBoard((board, api) => {
        const fixture = realizeVisualFixture(board, api, "uml-use-case", "business");
        const relation = Object.values(board.getElements()).find(
          (element) => element.custom?.visualSource?.from === "patient",
        );
        expect(relation.connectorData.start).toMatchObject(start);
        expect(relation.connectorData.waypoints).toEqual(waypoints);
        expect(relation.connectorData.routingMode).toBe("manual");
        const plan = board.planGraphLayout({
          ...fixture.layoutOptions,
          fixedElementIds: fixture.fixed,
        });
        expect(board.applyLayoutPlan(plan)).toBe(plan.status === "ready");
        fixture.verify();
        expect(board.getElement(relation.id).connectorData.start).toMatchObject(start);
        expect(board.getElement(relation.id).connectorData.waypoints).toEqual(waypoints);
      });
    } finally {
      visualCases["uml-use-case"].edges = original;
    }
  }, 20_000);
});
