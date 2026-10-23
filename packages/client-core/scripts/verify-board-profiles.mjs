import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  createStandardHeadlessUniverFacade,
  createStandardHeadlessUniverFactory,
} from "@univer-cli/headless-univer";
import { UniverInstanceType } from "@univerjs/core";
import { createUniverRenderRuntime } from "@univer-cli/univer-render-runtime";
import { createUnitScreenshot } from "@univer-cli/unit-screenshot";
import { createUnitLayoutLint } from "@univer-cli/unit-layout-lint";

// Exercise the installed public SDK in plain Node ESM, as the content worker does.
const { values } = parseArgs({
  options: {
    out: { type: "string" },
    profile: { type: "string" },
    suite: { type: "string", default: "contract" },
    "fixtures-only": { type: "boolean", default: false },
    render: { type: "boolean", default: false },
    "render-all": { type: "boolean", default: false },
    "plan-labels": { type: "boolean", default: false },
    "render-page-root": { type: "string" },
  },
});
assert.ok(["contract", "quality"].includes(values.suite), "Unknown suite");
const qualitySuite = values.suite === "quality";
const rendering = values.render || values["render-all"] || qualitySuite;
const planLabels = values["plan-labels"] || qualitySuite;
assert.ok(!qualitySuite || !values["fixtures-only"], "Quality checks require plan/apply");
const profiles = [
  "architecture",
  "dataflow",
  "deployment",
  "flowchart",
  "uml-activity",
  "uml-state",
  "uml-sequence",
  "uml-class",
  "erd",
  "uml-use-case",
  "uml-component",
  "uml-package",
  "mindmap",
  "tree",
  "timeline",
];
if (values.profile) assert.ok(profiles.includes(values.profile), "Unknown profile");
const selected = values.profile ? [values.profile] : profiles;
const results = [];
assert.ok(!planLabels || rendering, "--plan-labels requires --render");
const renderPageRoot = values["render-page-root"] ?? process.env.UNIVER_RENDER_PAGE_ROOT;
if (rendering) {
  assert.ok(values.out, "--render requires --out for PNG and raw-analysis evidence");
  assert.ok(renderPageRoot, "--render requires --render-page-root or UNIVER_RENDER_PAGE_ROOT");
}
const renderRuntime = rendering
  ? await createUniverRenderRuntime({
      renderPageRoot,
      env: process.env,
      license: process.env.UNIVER_LICENSE ?? "",
    })
  : undefined;
const screenshot = renderRuntime ? createUnitScreenshot({ runtime: renderRuntime }) : undefined;
const detailProfiles = new Set([
  "architecture",
  "flowchart",
  "uml-sequence",
  "uml-class",
  "erd",
  "uml-component",
]);
try {
  for (const profile of selected) {
    for (const variant of ["small", "long-labels", "fan-out"]) {
      const id = `${qualitySuite ? "quality-" : ""}${profile}-${variant}`;
      const univer = await createStandardHeadlessUniverFactory({
        license: process.env.UNIVER_LICENSE ?? "",
      })({
        unitId: id,
        unitType: UniverInstanceType.UNIVER_BOARD,
      });
      let board;
      try {
        const api = createStandardHeadlessUniverFacade(univer);
        board = api.createBoard({ id, name: id });
        const fixture = realize(board, api.Enum, profile, variant, qualitySuite);
        const initial = persistedSnapshot(board);
        const before = semanticElements(board);
        const analysisBefore = board.analyzeModelLayout(48);
        assert.ok(
          analysisBefore && typeof analysisBefore === "object",
          "Model analysis unavailable",
        );
        assert.deepEqual(semanticElements(board), before, "Analysis mutated content");
        fixture.verify();
        let plan;
        if (!values["fixtures-only"]) {
          assert.equal(
            typeof board.planGraphLayout,
            "function",
            "Installed SDK lacks FBoard.planGraphLayout",
          );
          assert.equal(
            typeof board.applyLayoutPlan,
            "function",
            "Installed SDK lacks FBoard.applyLayoutPlan",
          );
          const options = {
            direction: variant === "fan-out" ? "vertical" : "horizontal",
            fixedElementIds: fixture.fixed,
            maxNodes: 100,
            ...(qualitySuite && profile === "uml-class" ? { layerGap: 160 } : {}),
          };
          plan = board.planGraphLayout(options);
          assert.deepEqual(persistedSnapshot(board), initial, "Planning mutated the Board");
          assert.deepEqual(board.planGraphLayout(options), plan, "Planning is not deterministic");
          assert.ok(["ready", "incomplete"].includes(plan.status));
          if (
            ["architecture", "deployment", "uml-package", "uml-state", "uml-activity"].includes(
              profile,
            ) &&
            plan.status === "ready"
          ) {
            assert.ok(
              plan.patches.some(
                (patch) =>
                  patch.transform &&
                  fixture.nodes.includes(patch.elementId) &&
                  !fixture.fixed.includes(patch.elementId),
              ),
              "A fixed child froze every sibling in its container",
            );
          }
          if (profile === "flowchart" && variant === "fan-out") {
            const overBudget = board.planGraphLayout({ maxNodes: 1 });
            assert.equal(overBudget.status, "incomplete", "Budget overflow reported as complete");
            assert.equal(board.applyLayoutPlan(overBudget), false, "Over-budget plan applied");
            assert.deepEqual(
              persistedSnapshot(board),
              initial,
              "Budget handling mutated the Board",
            );
          }
          const fixed = fixture.fixed.map((elementId) =>
            structuredClone(board.getElement(elementId)),
          );
          const fixedGeometry = fixture.fixed.map((elementId) =>
            structuredClone(board.getElementGeometry(elementId)),
          );
          const protectedElements = fixture.protected.map((elementId) =>
            protectedElement(board.getElement(elementId)),
          );
          if (plan.status === "ready" && plan.patches.length > 0) {
            assert.equal(board.applyLayoutPlan(plan), true, "Ready plan rejected");
            const afterApply = persistedSnapshot(board);
            assert.deepEqual(
              semanticElements(board),
              before,
              "Layout changed text, bindings or ownership",
            );
            assert.deepEqual(
              fixture.fixed.map((elementId) => board.getElement(elementId)),
              fixed,
              "Fixed element moved",
            );
            assert.deepEqual(
              fixture.fixed.map((elementId) => board.getElementGeometry(elementId)),
              fixedGeometry,
              "Fixed element moved in Board-world coordinates",
            );
            assert.deepEqual(
              fixture.protected.map((elementId) => protectedElement(board.getElement(elementId))),
              protectedElements,
              "Native owner or manual connector changed",
            );
            fixture.verify();
            fixture.verifyLayout();
            assert.equal(await board.undo(), true, "Layout Undo failed");
            assert.deepEqual(
              persistedSnapshot(board),
              initial,
              "One Undo did not restore the complete snapshot",
            );
            assert.equal(await board.redo(), true, "Layout Redo failed");
            assert.deepEqual(
              persistedSnapshot(board),
              afterApply,
              "One Redo did not restore the complete snapshot",
            );
            assert.equal(
              board.applyLayoutPlan(plan),
              false,
              "Stale plan accepted after application",
            );
          } else if (plan.status === "incomplete") {
            assert.equal(board.applyLayoutPlan(plan), false, "Incomplete plan accepted");
            assert.deepEqual(persistedSnapshot(board), initial, "Rejected plan mutated content");
          } else {
            assert.equal(board.applyLayoutPlan(plan), true, "Current empty plan rejected");
            assert.deepEqual(persistedSnapshot(board), initial, "Empty plan mutated content");
          }
          if (fixture.fixed.length > 0) {
            const current = board.planGraphLayout(options);
            const snapshot = persistedSnapshot(board);
            const elementId = fixture.fixed[0];
            const element = board.getElement(elementId);
            assert.equal(
              board.setElementTransform(elementId, { left: element.transform.left + 13 }),
              true,
            );
            const edited = persistedSnapshot(board);
            assert.equal(
              board.applyLayoutPlan(current),
              false,
              "Plan accepted after an intervening edit",
            );
            assert.deepEqual(
              persistedSnapshot(board),
              edited,
              "Rejected stale plan changed content",
            );
            assert.equal(await board.undo(), true, "Intervening edit Undo failed");
            assert.deepEqual(
              persistedSnapshot(board),
              snapshot,
              "Intervening edit Undo changed unrelated content",
            );
          }
        }
        const analysisAfter = board.analyzeModelLayout(48);
        const hardRules = new Set([
          "element-overlap",
          "connector-through-element",
          "connector-collinear-overlap",
        ]);
        const hardCount = (analysis) =>
          analysis.issues.filter((issue) => hardRules.has(issue.rule)).length;
        if (!qualitySuite) {
          assert.ok(
            hardCount(analysisAfter) <= hardCount(analysisBefore),
            "Layout increased blocking model findings",
          );
        }
        const shouldRender =
          screenshot &&
          (qualitySuite ||
            values["render-all"] ||
            variant === "small" ||
            (variant === "long-labels" && detailProfiles.has(profile)));
        const labelRepair =
          planLabels && shouldRender
            ? await verifyRenderedLabelPlan(board, renderRuntime, !qualitySuite)
            : undefined;
        const rendered = shouldRender
          ? await renderEvidence(screenshot, board.save(), id, variant === "long-labels")
          : undefined;
        const quality = qualitySuite ? qualityResult(plan, analysisAfter, labelRepair) : undefined;
        const result = {
          suite: values.suite,
          profile,
          variant,
          assertions: "passed",
          mode: values["fixtures-only"] ? "fixtures-only" : "plan",
          plan,
          analysisBefore,
          analysisAfter,
          snapshot: board.save(),
          rendered,
          labelRepair,
          semanticCoverage: fixture.semanticCoverage,
          quality,
        };
        results.push({
          profile,
          variant,
          assertions: "passed",
          planStatus: plan?.status ?? "not-run",
          patchCount: plan?.patches.length ?? 0,
          application: !plan
            ? "not-run"
            : plan.status === "incomplete"
              ? "rejected-incomplete"
              : plan.patches.length > 0
                ? "applied-undo-redo"
                : "unchanged-native",
          renderedStatus: rendered?.status ?? "not-run",
          labelPlanStatus: labelRepair?.before.analyses[0]?.labelPlan?.status ?? "not-run",
          labelPatchCount: labelRepair?.before.analyses[0]?.labelPlan?.patches.length ?? 0,
          ...(quality ? { quality } : {}),
        });
        if (values.out) {
          await mkdir(resolve(values.out), { recursive: true });
          await writeFile(
            resolve(values.out, `${id}.json`),
            `${JSON.stringify(result, null, 2)}\n`,
            {
              flag: "wx",
            },
          );
        }
      } catch (error) {
        let rendered;
        let captureError;
        if (screenshot && board) {
          try {
            rendered = await renderEvidence(
              screenshot,
              board.save(),
              id,
              variant === "long-labels",
            );
          } catch (failure) {
            captureError = { name: failure.name, message: failure.message };
          }
        }
        results.push({
          profile,
          variant,
          assertions: "failed",
          reason: error.message,
          ...(rendered ? { renderedStatus: rendered.status } : {}),
          ...(qualitySuite ? { quality: { expected: "clean", status: "incomplete" } } : {}),
        });
        if (values.out) {
          await mkdir(resolve(values.out), { recursive: true });
          await writeFile(
            resolve(values.out, `${id}.failure.json`),
            `${JSON.stringify(
              {
                profile,
                variant,
                error: {
                  name: error.name,
                  message: error.message,
                  stack: error.stack,
                  diagnostics: error.diagnostics,
                },
                snapshot: board?.save(),
                analysis: board?.analyzeModelLayout(48),
                rendered,
                captureError,
              },
              null,
              2,
            )}\n`,
            { flag: "wx" },
          );
        }
      } finally {
        univer.dispose();
      }
    }
  }
} finally {
  await renderRuntime?.close();
}
process.stdout.write(
  `${JSON.stringify({ suite: values.suite, profiles: selected.length, cases: results.length, results }, null, 2)}\n`,
);
if (results.some((result) => result.assertions === "failed")) process.exitCode = 1;
else if (qualitySuite && results.some((result) => result.quality.status !== "clean")) {
  process.exitCode = 2;
}

function qualityResult(plan, model, labels) {
  const report = labels?.after;
  const status = !report
    ? "not-run"
    : plan?.status === "incomplete" ||
        labels.before.analyses[0].labelPlan.status === "incomplete" ||
        report.status === "incomplete"
      ? "incomplete"
      : model.issues.length > 0 || report.findings.length > 0
        ? "findings"
        : "clean";
  return {
    expected: "clean",
    status,
    modelFindings: model.issues.length,
    renderedFindings: report?.findings.length ?? 0,
    rules: [
      ...model.issues.map((issue) => ({ source: "model", rule: issue.rule })),
      ...(report?.findings.map((finding) => ({ source: "rendered", rule: finding.rule })) ?? []),
    ],
  };
}

async function renderEvidence(screenshot, unitData, id, detail) {
  const directory = resolve(values.out, id);
  await mkdir(directory, { recursive: true });
  const full = await screenshot.capture({
    unitType: "board",
    unitData,
    target: { kind: "board-content" },
  });
  assert.ok(full.images.length > 0, "Renderer returned no images");
  const outputs = [];
  for (const image of full.images) {
    assert.ok(image.layoutAnalysis, "Rendered Board analysis missing");
    assert.equal(
      image.layoutAnalysis.source,
      "rendered",
      "Screenshot did not establish rendered geometry",
    );
    const { bytes, ...metadata } = image;
    const file = resolve(directory, image.name);
    await writeFile(file, bytes, { flag: "wx" });
    outputs.push({ file, ...metadata });
  }
  if (detail) {
    const first = full.images[0];
    const focus =
      first.layoutAnalysis.issues.find((issue) => issue.focusBounds)?.focusBounds ??
      first.contentBounds;
    assert.ok(focus, "No measured bounds available for a readable detail");
    const detailCapture = await screenshot.capture({
      unitType: "board",
      unitData,
      target: {
        kind: "board-content",
        region: {
          ...focus,
          width: Math.min(focus.width, 600),
          height: Math.min(focus.height, 400),
        },
        scale: 2,
      },
    });
    for (const image of detailCapture.images) {
      const { bytes, ...metadata } = image;
      const file = resolve(directory, `detail-${image.name}`);
      await writeFile(file, bytes, { flag: "wx" });
      outputs.push({ file, ...metadata });
    }
  }
  const analyses = full.images.map((image) => image.layoutAnalysis);
  const incomplete = analyses.some(
    (analysis) =>
      analysis.routes.some((route) => !route.resolved) ||
      analysis.issues.some((issue) => /unresolved/.test(issue.rule)),
  );
  return {
    status: incomplete
      ? "incomplete"
      : analyses.some((analysis) => analysis.issues.length > 0)
        ? "findings"
        : "clean",
    outputs,
  };
}

async function verifyRenderedLabelPlan(board, runtime, assertCollisionImprovement = true) {
  const lint = createUnitLayoutLint({ runtime });
  const input = {
    unitType: "board",
    unitData: board.save(),
    mode: "rendered",
    includeLabelPlan: true,
  };
  const snapshot = persistedSnapshot(board);
  const before = await lint.lint(input);
  assert.deepEqual(
    persistedSnapshot(board),
    snapshot,
    "Rendered label planning changed the source",
  );
  assert.equal(before.analyses.length, 1, "Fixture unexpectedly changed page count");
  const plan = before.analyses[0].labelPlan;
  assert.ok(plan, "Requested rendered label plan unavailable");
  let applied = false;
  if (plan.status === "ready" && plan.patches.length > 0) {
    const semantics = labelSemantics(board);
    if (!board.applyLayoutPlan(plan)) {
      const error = new Error("Rendered plan rejected by the headless Facade");
      error.diagnostics = {
        report: before,
        sourcePreconditions: board.planGraphLayout().preconditions,
      };
      throw error;
    }
    assert.deepEqual(
      labelSemantics(board),
      semantics,
      "Label plan changed text, bindings, styles or node geometry",
    );
    applied = true;
    const afterApply = persistedSnapshot(board);
    assert.equal(board.undo(), true, "Rendered label plan Undo failed");
    assert.deepEqual(persistedSnapshot(board), snapshot, "Label plan Undo lost data");
    assert.equal(board.redo(), true, "Rendered label plan Redo failed");
    assert.deepEqual(persistedSnapshot(board), afterApply, "Label plan Redo lost data");
    assert.equal(board.applyLayoutPlan(plan), false, "Stale rendered label plan accepted");
  } else if (plan.status === "incomplete") {
    assert.equal(board.applyLayoutPlan(plan), false, "Incomplete rendered label plan accepted");
    assert.deepEqual(persistedSnapshot(board), snapshot, "Rejected label plan changed content");
  } else {
    assert.equal(plan.status, "ready");
    assert.deepEqual(persistedSnapshot(board), snapshot, "No-op rendered plan changed content");
  }
  const after = await lint.lint({ ...input, unitData: board.save(), includeLabelPlan: false });
  const collisions = (report) =>
    report.findings.filter(
      (finding) =>
        finding.rule.startsWith("connector-label-") && finding.rule.includes("collision"),
    ).length;
  const collisionNonIncreasing = collisions(after) <= collisions(before);
  if (assertCollisionImprovement) {
    assert.ok(collisionNonIncreasing, "Label planning increased measured collisions");
  }
  return { before, after, applied, collisionNonIncreasing };
}

function labelSemantics(board) {
  const snapshot = persistedSnapshot(board);
  for (const pages of [snapshot.pages, snapshot.slides]) {
    for (const page of Object.values(pages ?? {})) {
      for (const element of Object.values(page.elements)) {
        if (!element.connectorData) continue;
        for (const label of element.connectorData.labels ?? []) delete label.placement;
      }
    }
  }
  return snapshot;
}

function realize(board, E, profile, variant, quality = false) {
  let next = 0;
  const labels =
    variant === "long-labels"
      ? [
          "服务职责与边界 / Responsibility and ownership",
          "重试恢复与幂等性 / Recovery and idempotency",
          "持久化事务与状态 / Persisted state",
        ]
      : ["Entry", "Work", "Result"];
  const count = variant === "fan-out" ? 7 : 3;
  const ids = [];
  const protectedIds = [];
  const ownership = [];
  const label = (index) => labels[index % labels.length];
  // Different seeded geometry, dimensions and branching; no saved golden coordinates.
  const position = () => {
    const index = next++;
    return {
      left: 100 + ((index * 97) % 4) * 53,
      top: 100 + ((index * 71) % 3) * 47,
      width: variant === "long-labels" ? 260 + (index % 3) * 30 : 140 + (index % 3) * 20,
      height: 70 + (index % 2) * 25,
    };
  };
  function shape(type, text, parentId, laneId) {
    assert.ok(type, "Native shape type unavailable");
    const transform = position();
    if (laneId) transform.top = laneId === "request" ? 100 : 650;
    const parentBounds = laneId ? board.getElementGeometry(parentId).bounds : undefined;
    const inserted = laneId
      ? board.insertShapeAtPoint({
          shapeType: type,
          parentId,
          laneId,
          width: transform.width,
          height: transform.height,
          point: { x: parentBounds.left + transform.left, y: parentBounds.top + transform.top },
        })
      : undefined;
    const ref = laneId
      ? inserted && board.getShape(inserted.id)
      : board.insertShape({ shapeType: type, transform });
    assert.ok(ref, "Shape insertion failed");
    ref.getText().setText(text);
    ids.push(ref.getId());
    if (parentId) {
      if (!laneId) assert.equal(board.moveElementsToContainer([ref.getId()], parentId), true);
      ownership.push([ref.getId(), parentId]);
      if (laneId)
        ownership.push(() =>
          assert.equal(board.getElement(ref.getId()).laneId, laneId, "Swimlane ownership changed"),
        );
    } else if (board.getElement(ref.getId()).parentId) {
      assert.equal(board.moveElementsOutOfContainer([ref.getId()]), true);
    }
    return ref.getId();
  }
  function edge(from, to, text, extra = {}) {
    const connector = board.insertConnector({
      fromElementId: from,
      toElementId: to,
      labelText: text,
      ...extra,
      style: { endMarker: { type: "filledArrow" }, ...extra.style },
    });
    assert.ok(connector, "Connector insertion failed");
    if (extra.waypoints)
      assert.equal(
        board.getElement(connector.id).connectorData.waypoints.length,
        extra.waypoints.length,
        "Manual waypoints were discarded during fixture insertion",
      );
    return connector.id;
  }
  function container(id, kind, parentId) {
    assert.equal(
      board.createContainer({
        id,
        kind,
        left: parentId ? 30 : 60,
        top: parentId ? 60 : 60,
        width: quality
          ? variant === "fan-out"
            ? parentId
              ? 1800
              : 2200
            : parentId
              ? 1100
              : 1400
          : 1100,
        height: quality
          ? variant === "fan-out"
            ? parentId
              ? 1200
              : 1600
            : parentId
              ? 600
              : 900
          : 600,
        title: id,
        ...(parentId ? { parentId } : {}),
      }),
      true,
    );
    if (parentId) ownership.push([id, parentId]);
    return id;
  }
  if (["mindmap", "tree", "timeline"].includes(profile)) {
    const structureKind = {
      mindmap: "mindmap-horizontal",
      tree: "tree-right",
      timeline: "timeline-horizontal",
    }[profile];
    assert.ok(
      board.insertMindMap({
        left: 400,
        top: 400,
        structureKind,
        root: {
          text: label(0),
          children: Array.from({ length: count }, (_, index) => ({
            text: label(index),
            children: index % 2 ? [{ text: `Detail ${index}` }] : [],
          })),
        },
      }),
    );
    protectedIds.push(...Object.keys(board.getElements()));
  } else if (profile === "uml-sequence") {
    const participants = Array.from({ length: 3 }, (_, index) => {
      const ref = board.insertShape({
        shapeType: E.BoardSequenceShapeType.ObjectLifeline,
        transform: { left: 100 + index * 340, top: 70, width: 200, height: 60 },
        shapeData: {
          sequenceLifeline: {
            participantShapeType: "object",
            participantEngineShapeType: E.ShapeTypeEnum.RoundRect,
            lifelineHeight: 900,
            minLifelineHeight: 80,
          },
        },
      });
      assert.ok(ref);
      ref.getText().setText(label(index));
      return ref.getId();
    });
    assert.ok(
      board.insertSequenceMessages(
        Array.from({ length: count }, (_, index) => ({
          fromParticipantId: participants[index % 2],
          toParticipantId: participants[(index % 2) + 1],
          type: index % 2 ? "reply" : "synchronous",
          text: label(index),
          order: index + 1,
        })),
        { timeOriginY: 130, step: 100 },
      ),
    );
    protectedIds.push(...Object.keys(board.getElements()));
  } else if (["uml-class", "erd"].includes(profile)) {
    const tables = Array.from({ length: count }, (_, index) => {
      const table = board.insertTable({
        left: position().left,
        top: 100 + (index % 2) * 170,
        diagramPreset:
          profile === "uml-class"
            ? E.BoardTableDiagramPreset.UMLClass
            : E.BoardTableDiagramPreset.ERDFull,
      });
      assert.ok(table);
      table.setCellText(0, 0, label(index));
      table.setCellText(1, 0, profile === "uml-class" ? "+ id: UUID" : "PK");
      ids.push(table.getId());
      return table;
    });
    for (let index = 1; index < count; index++) {
      assert.ok(
        profile === "uml-class"
          ? board.insertClassRelation({
              type: "composition",
              start: { elementId: ids[0], role: "owner", multiplicity: "1" },
              end: { elementId: ids[index], role: "parts", multiplicity: "0..*" },
              name: "contains",
            })
          : board.insertEntityRelation({
              type: "nonIdentifying",
              start: { elementId: ids[0], cardinality: "one" },
              end: { elementId: ids[index], cardinality: "zeroOrMany" },
              label: "references",
            }),
      );
    }
    const valuesBefore = tables.map((table) => structuredClone(table.getValues()));
    ownership.push(() =>
      assert.deepEqual(
        tables.map((table) => table.getValues()),
        valuesBefore,
        "Compartment data lost",
      ),
    );
  } else {
    let owner;
    if (
      ["deployment", "architecture", "uml-package", "uml-state", "uml-use-case"].includes(profile)
    ) {
      owner = container("outer", profile === "uml-package" ? "uml-package" : "system-boundary");
      if (["deployment", "uml-state"].includes(profile))
        owner = container("inner", "generic", owner);
    }
    if (profile === "uml-activity") {
      assert.equal(
        board.createSwimlane({
          id: "pool",
          left: 60,
          top: 60,
          width: 1400,
          height: 1100,
          title: "Responsibility",
          orientation: "horizontal",
          lanes: [
            { id: "request", title: "Request", size: 500 },
            { id: "fulfill", title: "Fulfill", size: 500 },
          ],
        }),
        true,
      );
      owner = "pool";
      protectedIds.push("pool");
    }
    for (let index = 0; index < count; index++) {
      let type = E.ShapeTypeEnum.RoundRect;
      if (profile === "flowchart")
        type = index === 1 ? E.ShapeTypeEnum.FlowchartDecision : E.ShapeTypeEnum.FlowchartProcess;
      if (profile === "uml-use-case") type = E.ShapeTypeEnum.Ellipse;
      if (profile === "uml-component")
        type =
          index === 1
            ? E.BoardCustomShapeType.AssemblyConnector
            : E.BoardCustomShapeType.ComponentBox;
      if (profile === "dataflow" && index === count - 1) type = E.BoardCustomShapeType.DataStorage1;
      if (profile === "uml-state" && index === 0) type = E.BoardCustomShapeType.InitialState;
      if (profile === "uml-activity" && index === 1) type = E.BoardCustomShapeType.StateBar;
      shape(
        type,
        label(index),
        owner,
        profile === "uml-activity" ? (index % 2 ? "fulfill" : "request") : undefined,
      );
    }
    for (let index = 1; index < ids.length; index++)
      edge(
        ids[0],
        ids[index],
        profile === "uml-use-case" ? "«include»" : label(index),
        profile === "uml-use-case"
          ? { style: { dash: [6, 4], endMarker: { type: "openArrow" } } }
          : {},
      );
    if (profile === "uml-use-case") {
      const actor = shape(E.BoardCustomShapeType.Actor, "User");
      assert.equal(board.setElementTransform(actor, { left: -220, top: 120 }), true);
      edge(actor, ids[0], "uses", {
        style: { startMarker: { type: "none" }, endMarker: { type: "none" } },
      });
      ownership.push(() =>
        assert.equal(
          board.getElement(actor).parentId,
          undefined,
          "Actor entered the system boundary",
        ),
      );
    }
  }
  const fanIn =
    quality &&
    variant === "fan-out" &&
    ["flowchart", "dataflow", "architecture", "deployment"].includes(profile);
  if (fanIn) {
    for (let index = 1; index < count - 1; index++) {
      edge(ids[index], ids[count - 1], `Join branch ${index}`);
    }
  }
  if (["flowchart", "dataflow", "uml-component", "uml-class", "erd"].includes(profile)) {
    if (quality) {
      const feedbackId = edge(ids.at(-1), ids[0], "Feedback guide", {
        routing: "orthogonal",
        routingMode: "auto",
      });
      const feedback = board.getElement(feedbackId).connectorData;
      assert.equal(feedback.routingMode, "auto");
      assert.equal(feedback.waypoints?.length ?? 0, 0);
    } else
      protectedIds.push(
        edge(ids.at(-1), ids[0], "Manual feedback guide", {
          routing: "orthogonal",
          routingMode: "manual",
          waypoints: [
            { id: "guide-0", kind: "manual", x: -180, y: -150, locked: true },
            { id: "guide-1", kind: "manual", x: 550, y: -150, locked: true },
          ],
        }),
      );
  }
  assert.ok(Object.keys(board.getElements()).length > 0, "Empty profile");
  const elements = Object.values(board.getElements());
  const connectors = elements.filter((element) => element.type === "connector");
  const nativeTree = ["mindmap", "tree", "timeline"].includes(profile);
  const feedback = ["flowchart", "dataflow", "uml-component", "uml-class", "erd"].includes(profile);
  const expectedRelations = nativeTree
    ? count + Math.floor(count / 2)
    : profile === "uml-sequence"
      ? count
      : count - 1 + Number(feedback) + Number(profile === "uml-use-case") + (fanIn ? count - 2 : 0);
  const labelCount = connectors.reduce(
    (total, connector) => total + (connector.connectorData.labels?.length ?? 0),
    0,
  );
  const expectedLabels = nativeTree
    ? 0
    : profile === "uml-class"
      ? (count - 1) * 5 + 1
      : expectedRelations;
  if (quality) {
    assert.equal(
      connectors.length,
      expectedRelations,
      "Quality fixture lost semantic relationships",
    );
    assert.equal(labelCount, expectedLabels, "Quality fixture lost connector labels");
  }
  return {
    nodes: ids,
    fixed: !quality && ids.length > 0 ? [ids[0]] : [],
    protected: protectedIds,
    semanticCoverage: {
      nodes: elements.length - connectors.length,
      relations: connectors.length,
      expectedRelations,
      labels: labelCount,
      expectedLabels,
      feedback: feedback ? (quality ? "auto" : "manual") : "none",
      joiningRelations: fanIn ? count - 2 : 0,
    },
    verifyLayout() {
      if (profile !== "uml-activity") return;
      for (const id of ids) {
        const { bounds } = board.getElementGeometry(id);
        const laneId = board.getElement(id).laneId;
        for (const x of [bounds.left + 1, bounds.left + bounds.width - 1]) {
          for (const y of [bounds.top + 1, bounds.top + bounds.height - 1]) {
            const target = board.resolveDropTargetAtPoint({ x, y }, { area: "content" });
            assert.equal(target?.containerId, "pool", "Activity node escaped its pool");
            assert.equal(target?.laneId, laneId, "Activity node escaped its lane content");
          }
        }
      }
    },
    verify() {
      for (const check of ownership) {
        if (typeof check === "function") check();
        else
          assert.equal(
            board.getElement(check[0]).parentId,
            check[1],
            "Container membership changed",
          );
      }
    },
  };
}

function semanticElements(board) {
  return Object.values(board.getElements()).map((element) => {
    const copy = JSON.parse(JSON.stringify(element));
    delete copy.transform;
    if (copy.connectorData) {
      for (const key of ["waypoints", "orthogonalData", "curveData", "routing", "routingMode"])
        delete copy.connectorData[key];
      for (const end of ["start", "end"]) {
        const endpoint = copy.connectorData[end];
        delete endpoint.side;
        delete endpoint.position;
        delete endpoint.connectionSiteId;
        delete endpoint.connectionPosition;
        delete endpoint.connectionPositionMode;
        delete endpoint.fallbackPoint;
      }
    }
    return copy;
  });
}

function protectedElement(element) {
  const copy = structuredClone(element);
  if (copy.connectorData) {
    // Bound connector world bounds/fallbacks follow their nodes; manual route controls must stay exact.
    delete copy.transform;
    for (const end of ["start", "end"]) delete copy.connectorData[end].fallbackPoint;
  }
  return copy;
}

function persistedSnapshot(board) {
  // Optional undefined properties do not exist in the persisted JSON contract.
  return JSON.parse(JSON.stringify(board.save()));
}
