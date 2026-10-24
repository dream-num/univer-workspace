import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  getVisualCase,
  realizeVisualFixture,
  visualCases,
  visualVariants,
} from "../scripts/board-visual-fixtures.mjs";
import { captureVisualEvidence, visualCaptureRegions } from "../scripts/board-visual-evidence.mjs";
import {
  proposeMeasuredTextGrowth,
  repairMeasuredVisualText,
} from "../scripts/board-visual-repair.mjs";
import { elementProfiles, realizeElementFixture } from "../scripts/board-element-fixtures.mjs";

describe("Board business visual manifests", () => {
  it("has 45 independent cases with complete native or explicitly connected business content", () => {
    expect(Object.keys(visualCases)).toHaveLength(15);
    for (const profile of Object.keys(visualCases))
      for (const variant of visualVariants) {
        const fixture = getVisualCase(profile, variant);
        const ids = new Set(fixture.nodes.map((node) => node.id));
        expect(ids.size).toBe(fixture.nodes.length);
        expect(fixture.nodes.length).toBeGreaterThanOrEqual(4);
        expect(JSON.stringify(fixture)).not.toMatch(/"(?:Entry|Work|Result)"/);
        for (const edge of fixture.edges) {
          expect(ids.has(edge.from)).toBe(true);
          expect(ids.has(edge.to)).toBe(true);
        }
        if (fixture.native) expect(fixture.nodes.filter((node) => !node.parent)).toHaveLength(1);
        if (variant === "long-bilingual") expect(fixture.title).toMatch(/[\u4e00-\u9fff]/);
        for (const [index, id] of (fixture.mainPath ?? []).entries()) {
          if (index)
            expect(
              fixture.edges.some(
                (edge) => edge.from === fixture.mainPath[index - 1] && edge.to === id,
              ),
            ).toBe(true);
        }
        fixture.nodes[0].title = "changed copy";
        expect(visualCases[profile].nodes[0].title).not.toBe("changed copy");
      }
  });
  it("retains typed compartments, ownership, sequence ordering and business multiplicity", () => {
    const classes = getVisualCase("uml-class", "nested-dense");
    expect(classes.nodes.find((node) => node.id === "reservation").detail).toContain(
      "release(): void",
    );
    expect(classes.edges.find((edge) => edge.to === "reservation")).toMatchObject({
      relation: "composition",
      endMultiplicity: "0..*",
    });
    expect(getVisualCase("uml-sequence", "nested-dense").edges).toHaveLength(12);
    expect(getVisualCase("uml-activity", "nested-dense").nodes.every((node) => node.lane)).toBe(
      true,
    );
    expect(
      getVisualCase("uml-use-case", "business").nodes.find((node) => node.id === "patient").parent,
    ).toBeUndefined();
  });
});

describe("Board measured text growth boundaries", () => {
  const shape = (id, extra = {}) => ({
    id,
    type: "shape",
    transform: { left: 10, top: 20, width: 200, height: 100 },
    ...extra,
  });
  const report = (
    ids,
    available = { width: 100, height: 50 },
    content = { width: 160, height: 75 },
  ) => ({
    analyses: [
      {
        rendered: {
          issues: ids.map((id) => ({
            rule: "element-text-overflow",
            elementIds: [id],
            textLayout: { availableSize: available, contentSize: content },
          })),
        },
      },
    ],
  });
  const fixture = { nodes: ["a"], fixed: [], protected: [], layoutOptions: {}, verify() {} };
  it("uses the measured text-rectangle ratio without changing font or style", () => {
    const a = shape("a", { shapeData: { shapeType: "ellipse", fontSize: 16 } });
    const original = structuredClone(a);
    expect(
      proposeMeasuredTextGrowth({ getElement: () => a }, report(["a"]), fixture).patches,
    ).toEqual({ a: { width: 324, height: 154 } });
    expect(a).toEqual(original);
  });
  it("preserves fixed/native, locked parents, unselectable objects and table resources", () => {
    const elements = {
      a: shape("a"),
      b: shape("b", { parentId: "owner" }),
      owner: { id: "owner", type: "container", locked: true },
      c: shape("c", { selectable: false }),
      d: { ...shape("d"), type: "table" },
      e: shape("e"),
    };
    const f = { ...fixture, nodes: ["a", "b", "c", "d", "e"], fixed: ["a"], protected: ["e"] };
    const proposal = proposeMeasuredTextGrowth(
      { getElement: (id) => elements[id] },
      report(f.nodes),
      f,
    );
    expect(proposal.patches).toEqual({});
    expect(proposal.skipped).toHaveLength(5);
  });
  it("rejects unavailable or invalid text measurement instead of guessing", () => {
    const board = { getElement: () => shape("a") };
    expect(
      proposeMeasuredTextGrowth(board, report(["a"], { width: 0, height: 50 }), fixture).skipped[0]
        .reason,
    ).toBe("measurement-unavailable");
    expect(
      proposeMeasuredTextGrowth(
        board,
        report(["a"], undefined, { width: Infinity, height: 10 }),
        fixture,
      ).patches,
    ).toEqual({});
  });
  it("grows only the measured merged table range and preserves all other rows and source content", () => {
    const element = { ...shape("a"), type: "table" };
    const structure = {
      rowCount: 3,
      columnCount: 3,
      rowHeights: [40, 50, 60],
      columnWidths: [100, 180, 120],
    };
    const measured = report(["a"], { width: 300, height: 80 }, { width: 450, height: 120 });
    measured.analyses[0].rendered.issues[0].tableRange = {
      startRow: 1,
      endRow: 2,
      startColumn: 0,
      endColumn: 2,
    };
    const proposal = proposeMeasuredTextGrowth(
      { getElement: () => element, getTable: () => ({ getStructure: () => structure }) },
      measured,
      fixture,
    );
    expect(proposal.patches).toEqual({});
    expect(proposal.tablePatches.a.rows).toEqual({ 1: 77, 2: 92 });
    expect(proposal.tablePatches.a.columns).toEqual({ 0: 152, 1: 272, 2: 182 });
    expect(structure.rowHeights).toEqual([40, 50, 60]);
    expect(element.transform).toEqual(shape("a").transform);
    delete measured.analyses[0].rendered.issues[0].tableRange.endColumn;
    expect(
      proposeMeasuredTextGrowth(
        { getElement: () => element, getTable: () => ({ getStructure: () => structure }) },
        measured,
        fixture,
      ).skipped[0].reason,
    ).toBe("table-cell-range-unavailable");
  });
  it("rolls back a measured growth whose fresh public graph plan is incomplete", async () => {
    let value = { id: "board", pages: { p: { elements: { a: shape("a") } } } },
      undo,
      redo;
    const initial = structuredClone(value);
    const board = {
      save: () => value,
      getElement: (id) => value.pages.p.elements[id],
      setElementsTransform(patches) {
        undo = structuredClone(value);
        for (const [id, patch] of Object.entries(patches))
          Object.assign(value.pages.p.elements[id].transform, patch);
        return true;
      },
      undo() {
        redo = structuredClone(value);
        value = structuredClone(undo);
        return true;
      },
      redo() {
        value = structuredClone(redo);
        return true;
      },
      planGraphLayout: () => ({
        status: "incomplete",
        patches: [],
        diagnostics: [{ code: "swimlane-capacity-exceeded", elementIds: ["a"] }],
      }),
      applyLayoutPlan: () => false,
    };
    const result = await repairMeasuredVisualText(
      board,
      { lint: async () => report(["a"]) },
      fixture,
    );
    expect(result.status).toBe("replan-incomplete");
    expect(result.attempts[0]).toMatchObject({
      growthApplied: true,
      growthRolledBack: true,
      planApplied: false,
    });
    expect(value).toEqual(initial);
  });
});

describe("Board public Facade business fixture preservation", () => {
  it.each([
    ["erd", false],
    ["uml-class", false],
    ["uml-class", true],
  ])(
    "uses actual public %s table resource history for measured cell growth (budget refusal %s)",
    async (profile, incomplete) => {
      const { createStandardHeadlessUniverFactory, createStandardHeadlessUniverFacade } =
        await import("@univer-cli/headless-univer");
      const { UniverInstanceType } = await import("@univerjs/core");
      const univer = await createStandardHeadlessUniverFactory({ license: "" })({
        unitId: profile,
        unitType: UniverInstanceType.UNIVER_BOARD,
      });
      try {
        const api = createStandardHeadlessUniverFacade(univer),
          board = api.createBoard({ id: profile, name: profile });
        const fixture = realizeVisualFixture(board, api, profile, "business");
        const table = board.getTable(fixture.nodes[0]),
          values = structuredClone(table.getValues()),
          original = table.getStructure();
        const before = JSON.parse(JSON.stringify(board.save()));
        let measurements = 0;
        const result = await repairMeasuredVisualText(
          board,
          {
            lint: async () => ({
              analyses: [
                {
                  rendered: {
                    issues: measurements++
                      ? []
                      : [
                          {
                            rule: "element-text-overflow",
                            elementIds: [table.getId()],
                            tableRange: {
                              startRow: 0,
                              endRow: 0,
                              startColumn: 0,
                              endColumn: original.columnCount - 1,
                            },
                            textLayout: {
                              availableSize: { width: 400, height: 40 },
                              contentSize: { width: 500, height: 50 },
                            },
                          },
                        ],
                  },
                },
              ],
            }),
          },
          incomplete
            ? { ...fixture, layoutOptions: { ...fixture.layoutOptions, maxNodes: 1 } }
            : fixture,
        );
        expect(result.status).toBe(incomplete ? "replan-incomplete" : "no-overflow-reported");
        expect(result.attempts[0].growthApplications.length).toBe(original.columnCount + 1);
        expect(
          result.attempts[0].growthApplications.every(
            (application) =>
              application.applied &&
              application.changed &&
              application.undoExact &&
              application.redoExact,
          ),
        ).toBe(true);
        expect(table.getValues()).toEqual(values);
        if (incomplete) expect(JSON.parse(JSON.stringify(board.save()))).toEqual(before);
        else expect(table.getStructure().rowHeights[0]).toBeGreaterThan(original.rowHeights[0]);
        fixture.verify();
      } finally {
        univer.dispose();
      }
    },
    20_000,
  );
  it.each(
    Object.keys(visualCases).flatMap((profile) =>
      visualVariants.map((variant) => [profile, variant]),
    ),
  )(
    "preserves %s / %s through actual graph apply and one-step history",
    async (profile, variant) => {
      const { createStandardHeadlessUniverFactory, createStandardHeadlessUniverFacade } =
        await import("@univer-cli/headless-univer");
      const { UniverInstanceType } = await import("@univerjs/core");
      const univer = await createStandardHeadlessUniverFactory({ license: "" })({
        unitId: profile,
        unitType: UniverInstanceType.UNIVER_BOARD,
      });
      const snapshot = (board) => JSON.parse(JSON.stringify(board.save()));
      try {
        const api = createStandardHeadlessUniverFacade(univer);
        const board = api.createBoard({ id: profile, name: profile });
        const fixture = realizeVisualFixture(board, api, profile, variant);
        fixture.verify();
        if (profile === "erd") {
          const tables = fixture.nodes.map((id) => board.getTable(id));
          const customer = tables.find((table) => table.getValues()[0][0] === "customers");
          expect(customer.getValues()[1]).toEqual(["PK", "customer_id", "UUID"]);
          expect(customer.getValues()[2]).toEqual(["UNIQUE", "email", "VARCHAR"]);
          for (const table of tables) {
            expect(table.getValues().flat()).not.toContain("Field");
            expect(table.getValues().flat()).not.toContain("Type");
            const headerStyle = table.getCellRichText(0, 0).getData().body.textRuns[0].ts;
            expect(headerStyle.bl).toBe(1);
            expect(headerStyle.cl.rgb.toLowerCase()).toBe("#ffffff");
          }
          if (variant === "long-bilingual") {
            expect(customer.getValues()[4][0]).toContain("外键、唯一性");
            expect(customer.getCellInfo(4, 0).mergeRange).toMatchObject({
              startColumn: 0,
              endColumn: 2,
            });
          }
        }
        if (profile === "uml-class") {
          const order = fixture.nodes
            .map((id) => board.getTable(id))
            .find((table) => table.getValues()[0][0] === "Order");
          expect(order.getValues()[1][0]).toContain("+ id: UUID");
          expect(order.getValues()[1][0]).toContain("+ total: Money");
          expect(order.getValues()[1][0]).not.toContain("confirm()");
          expect(order.getValues()[2][0]).toBe("+ confirm(): void");
          expect(order.getCellRichText(0, 0).getData().body.textRuns[0].ts.bl).toBe(1);
        }
        const initial = snapshot(board);
        const protectedBefore = JSON.parse(
          JSON.stringify(
            [...fixture.fixed, ...fixture.protected].map((id) => board.getElement(id)),
          ),
        );
        const options = { ...fixture.layoutOptions, fixedElementIds: fixture.fixed };
        const plan = board.planGraphLayout(options);
        if (profile === "uml-activity") {
          expect(plan.status).toBe("ready");
          expect(
            plan.patches.some(
              (patch) => patch.transform && fixture.nodes.includes(patch.elementId),
            ),
          ).toBe(true);
        }
        expect(snapshot(board)).toEqual(initial);
        expect(board.planGraphLayout(options)).toEqual(plan);
        if (plan.status === "incomplete") {
          expect(board.applyLayoutPlan(plan)).toBe(false);
          expect(snapshot(board)).toEqual(initial);
        } else {
          expect(board.applyLayoutPlan(plan)).toBe(true);
          fixture.verify();
          expect(
            JSON.parse(
              JSON.stringify(
                [...fixture.fixed, ...fixture.protected].map((id) => board.getElement(id)),
              ),
            ),
          ).toEqual(protectedBefore);
          if (plan.patches.length) {
            const after = snapshot(board);
            expect(await board.undo()).toBe(true);
            expect(snapshot(board)).toEqual(initial);
            expect(await board.redo()).toBe(true);
            expect(snapshot(board)).toEqual(after);
            expect(board.applyLayoutPlan(plan)).toBe(false);
          }
        }
        for (const id of fixture.compactContainers ?? []) {
          const before = snapshot(board);
          expect(board.fitContainerToContent(id)).toBe(true);
          fixture.verify();
          const after = snapshot(board);
          if (JSON.stringify(before) !== JSON.stringify(after)) {
            expect(await board.undo()).toBe(true);
            expect(snapshot(board)).toEqual(before);
            expect(await board.redo()).toBe(true);
            expect(snapshot(board)).toEqual(after);
          }
        }
      } finally {
        univer.dispose();
      }
    },
    20_000,
  );
});

describe("Board full-extent visual capture tiling", () => {
  it("preserves public child/reference input on every scale without treating clean as visual approval", async () => {
    const parent = resolve(tmpdir());
    const directory = await mkdtemp(join(parent, "board-visual-capture-"));
    const calls = [];
    const renderUnits = {
      embeddedUnits: [{ unitType: "sheet", unitData: { id: "child" } }],
      formulaReferenceUnits: [{ unitType: "sheet", unitData: { id: "source" } }],
    };
    try {
      const screenshot = {
        async capture(input) {
          calls.push(input);
          return {
            images: [
              {
                name: "board-content.png",
                width: 800,
                height: 600,
                scale: 1,
                bytes: new Uint8Array([137, 80, 78, 71]),
                contentBounds: { left: -20, top: -10, width: 400, height: 250 },
                layoutAnalysis: { source: "rendered", routes: [], issues: [] },
              },
            ],
          };
        },
      };
      const result = await captureVisualEvidence(screenshot, { id: "host" }, directory, {
        renderUnits,
      });
      expect(calls.length).toBeGreaterThanOrEqual(4);
      expect(
        calls.every(
          (input) =>
            input.embeddedUnits === renderUnits.embeddedUnits &&
            input.formulaReferenceUnits === renderUnits.formulaReferenceUnits,
        ),
      ).toBe(true);
      expect(result.status).toBe("clean");
      expect(result.coverage.visualApproval).toBe("pending");
      expect(result.coverage.typographyInkMeasured).toBe(false);
      expect(
        JSON.parse(await readFile(join(directory, "capture-progress.json"), "utf8")).complete,
      ).toBe(true);
    } finally {
      expect(dirname(directory)).toBe(parent);
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("covers negative origins and every part of a large canvas with overlapping native-scale tiles", () => {
    const bounds = { left: -171, top: -63, width: 1733, height: 985 };
    const tiles = visualCaptureRegions(bounds, 550, 320);
    expect(tiles[0]).toMatchObject({ left: -171, top: -63 });
    expect(Math.max(...tiles.map((tile) => tile.left + tile.width))).toBe(
      bounds.left + bounds.width,
    );
    expect(Math.max(...tiles.map((tile) => tile.top + tile.height))).toBe(
      bounds.top + bounds.height,
    );
    for (let x = bounds.left; x < bounds.left + bounds.width; x += 17)
      for (let y = bounds.top; y < bounds.top + bounds.height; y += 13) {
        expect(
          tiles.some(
            (tile) =>
              x >= tile.left &&
              y >= tile.top &&
              x < tile.left + tile.width &&
              y < tile.top + tile.height,
          ),
        ).toBe(true);
      }
  });
  it("rejects invalid or unbounded capture rectangles", () => {
    expect(() => visualCaptureRegions({ left: 0, top: 0, width: Infinity, height: 1 })).toThrow();
    expect(() => visualCaptureRegions({ left: 0, top: 0, width: 0, height: 1 })).toThrow();
  });
});

describe("Board public element catalogue preservation", () => {
  // The combined chart case is exercised by the licensed rendered runner; chart creation requires the runtime credential.
  it.each(elementProfiles.filter((profile) => profile !== "text-image-ink-chart"))(
    "preserves authored %s catalogue geometry and public preset coverage",
    async (profile) => {
      const { createStandardHeadlessUniverFactory, createStandardHeadlessUniverFacade } =
        await import("@univer-cli/headless-univer");
      const { UniverInstanceType } = await import("@univerjs/core");
      const univer = await createStandardHeadlessUniverFactory({ license: "" })({
        unitId: profile,
        unitType: UniverInstanceType.UNIVER_BOARD,
      });
      try {
        const api = createStandardHeadlessUniverFacade(univer);
        const board = api.createBoard({ id: profile, name: profile });
        const fixture = await realizeElementFixture(board, api, profile);
        fixture.verify();
        const plan = board.planGraphLayout(fixture.layoutOptions);
        expect(plan.status).toBe("ready");
        expect(plan.patches).toEqual([]);
        expect(board.applyLayoutPlan(plan)).toBe(true);
        fixture.verifyLayout();
        expect(fixture.semanticCoverage.automatedLayoutQualityClaim).toBe(false);
        if (profile === "builtin-shapes")
          expect(fixture.semanticCoverage.covered).toHaveLength(
            new Set(
              Object.values(api.Enum.ShapeTypeEnum).filter(
                (type) => !["none", "smartArt"].includes(type),
              ),
            ).size,
          );
        if (profile === "connector-grammar")
          expect(
            Object.values(board.getElements()).some((element) =>
              element.connectorData?.waypoints?.some(
                (point) => point.kind === "manual" && point.locked,
              ),
            ),
          ).toBe(true);
        if (profile === "transform-style") {
          for (const item of fixture.semanticCoverage.covered.filter(
            (item) => item.feature === "transform-and-boundary",
          )) {
            const endpoint = board.getElement(item.elementId).connectorData.start;
            expect(endpoint).toMatchObject({
              kind: "shapeBoundary",
              outlineIndex: 0,
              segmentIndex: 0,
              segmentT: 0.5,
            });
            expect(endpoint).not.toHaveProperty("t");
          }
        }
        if (profile === "table-presets") {
          const frames = fixture.semanticCoverage.covered.map(
            (item) => board.getElement(item.elementId).transform,
          );
          for (const [index, a] of frames.entries())
            for (const b of frames.slice(index + 1))
              expect(
                a.left < b.left + b.width &&
                  a.left + a.width > b.left &&
                  a.top < b.top + b.height &&
                  a.top + a.height > b.top,
              ).toBe(false);
        }
      } finally {
        univer.dispose();
      }
    },
    20_000,
  );
});
