import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { recordConnectorLabelEvidence } from "./board-visual-label-evidence.mjs";

const snapshot = (board) => JSON.parse(JSON.stringify(board.save()));

// Generation permission comes from the private fixture manifest, never from a loaded Board snapshot.
// Use the public planner's candidate positions: duplicating its font/label/rank budgets goes stale.
export function proposeGeneratedGraphCapacity(board, fixture, plan) {
  const poolPatches = [],
    lanePatches = [],
    blocked = [];
  const diagnostics = plan.diagnostics ?? [];
  if (
    plan.status !== "incomplete" ||
    diagnostics.some(
      (item) => item.severity !== "warning" && item.code !== "swimlane-capacity-exceeded",
    )
  )
    return { poolPatches, lanePatches, blocked };
  const allowedPools = new Set(fixture.expandablePools ?? []);
  const allowedLanes = new Map();
  for (const { containerId, laneId } of fixture.expandableLanes ?? []) {
    if (!allowedLanes.has(containerId)) allowedLanes.set(containerId, new Set());
    allowedLanes.get(containerId).add(laneId);
  }
  const requested = new Set(
    diagnostics
      .filter((item) => item.code === "swimlane-capacity-exceeded")
      .map((item) => item.elementIds?.[0]),
  );
  const protectedIds = new Set([...fixture.fixed, ...fixture.protected]);
  const nodes = new Set(fixture.nodes);
  const elements = Object.values(board.getElements());
  const transforms = new Map(
    plan.patches
      .filter((patch) => patch.transform)
      .map((patch) => [patch.elementId, patch.transform]),
  );
  const generatedPadding = 24;
  const isPlainFrame = (item) =>
    item?.transform &&
    !item.transform.rotation &&
    !item.transform.skewX &&
    !item.transform.skewY &&
    !item.transform.flipX &&
    !item.transform.flipY &&
    (item.transform.scaleX ?? 1) === 1 &&
    (item.transform.scaleY ?? 1) === 1;
  const isPinned = (item) =>
    protectedIds.has(item.id) ||
    item.locked ||
    item.selectable === false ||
    !!item.managedBy ||
    item.connectorData?.routingMode === "manual" ||
    !!item.connectorData?.waypoints?.length;
  for (const containerId of requested) {
    const pool = board.getElement(containerId),
      swimlane = pool?.containerData?.swimlane;
    if (!swimlane || (!allowedPools.has(containerId) && !allowedLanes.has(containerId))) continue;
    if (
      pool.parentId ||
      pool.locked ||
      pool.selectable === false ||
      pool.managedBy ||
      fixture.fixed.includes(containerId) ||
      pool.containerData.behavior.membershipLocked ||
      !isPlainFrame(pool)
    ) {
      blocked.push({ containerId, reason: "owner-not-an-editable-generated-plain-pool" });
      continue;
    }
    const descendants = elements.filter((element) => {
      const seen = new Set();
      let current = element;
      while (current?.parentId && !seen.has(current.id)) {
        if (current.parentId === containerId) return true;
        seen.add(current.id);
        current = board.getElement(current.parentId);
      }
      return false;
    });
    if (
      descendants.some(
        (item) =>
          isPinned(item) ||
          (item.type !== "connector" &&
            (!nodes.has(item.id) || item.parentId !== containerId || !isPlainFrame(item))),
      )
    ) {
      blocked.push({ containerId, reason: "pinned-native-or-nested-member" });
      continue;
    }
    const members = descendants.filter((item) => item.type !== "connector");
    const candidates = members.map((item) => ({
      id: item.id,
      laneId: item.laneId,
      transform: { ...item.transform, ...transforms.get(item.id) },
    }));
    if (
      candidates.some(
        ({ transform }) =>
          ![transform.left, transform.top, transform.width, transform.height].every(
            Number.isFinite,
          ) ||
          transform.width <= 0 ||
          transform.height <= 0,
      )
    ) {
      blocked.push({ containerId, reason: "invalid-native-candidate-geometry" });
      continue;
    }
    const lanes = [...swimlane.lanes].sort((a, b) => a.order - b.order);
    const horizontal = swimlane.orientation === "horizontal";
    const mainSize = horizontal ? "width" : "height",
      mainStart = horizontal ? "left" : "top";
    const crossSize = horizontal ? "height" : "width",
      crossStart = horizontal ? "top" : "left";
    const eligible = (lane) =>
      allowedLanes.get(containerId)?.has(lane.id) && !lane.locked && !lane.collapsed;
    if (allowedPools.has(containerId) && lanes.every((lane) => !lane.locked && !lane.collapsed)) {
      const required = Math.ceil(
        Math.max(
          pool.transform[mainSize],
          ...candidates.map(
            ({ transform }) => transform[mainStart] + transform[mainSize] + generatedPadding,
          ),
        ),
      );
      if (required > pool.transform[mainSize])
        poolPatches.push({
          containerId,
          transform: { [mainSize]: required },
          kind: "swimlane-pool-capacity",
        });
    }
    let cursor =
      horizontal && pool.containerData.titleVisible !== false
        ? (pool.containerData.headerSize ?? 0)
        : 0;
    const desired = lanes.map((lane) => {
      const start = cursor;
      cursor += lane.size;
      const ends = candidates
        .filter((item) => item.laneId === lane.id)
        .map(
          ({ transform }) =>
            transform[crossStart] + transform[crossSize] - start + generatedPadding,
        );
      return eligible(lane) && ends.length
        ? Math.max(lane.size, Math.ceil(Math.max(...ends)))
        : lane.size;
    });
    const firstGrowth = desired.findIndex((size, index) => size > lanes[index].size);
    if (firstGrowth < 0) continue;
    if (!lanes.slice(firstGrowth).every(eligible)) {
      blocked.push({ containerId, reason: "later-lane-capacity-is-authored-locked-or-collapsed" });
      continue;
    }
    const targets = [];
    let carry = 0;
    for (const [index, lane] of lanes.entries()) {
      const size = desired[index] + carry;
      if (size > lane.size)
        targets.push({ containerId, laneId: lane.id, size, kind: "swimlane-capacity" });
      carry += desired[index] - lane.size;
    }
    // Native resizing transfers capacity to the next lane. Reserve the suffix at the end first.
    lanePatches.push(...targets.reverse());
  }
  return { poolPatches, lanePatches, blocked };
}

export function reserveGeneratedVisualCapacity(board, fixture) {
  const applications = [],
    steps = [];
  if (!(fixture.expandablePools?.length || fixture.expandableLanes?.length))
    return { status: "not-applicable", applications, steps, rolledBack: false };
  const before = snapshot(board);
  const apply = (action, details) => {
    const previous = snapshot(board);
    const accepted = action(),
      after = snapshot(board);
    const changed = JSON.stringify(previous) !== JSON.stringify(after);
    const application = { ...details, changed, applied: accepted === true };
    applications.push(application);
    assert.equal(accepted, true, "Generated capacity resize rejected");
    fixture.verify();
    if (changed) {
      assert.equal(board.undo(), true, "Generated capacity Undo failed");
      assert.deepEqual(snapshot(board), previous, "Generated capacity Undo lost content");
      assert.equal(board.redo(), true, "Generated capacity Redo failed");
      assert.deepEqual(snapshot(board), after, "Generated capacity Redo lost content");
    }
    if (changed) Object.assign(application, { undoExact: true, redoExact: true });
  };
  let rollbackStarted = false;
  const rollback = () => {
    rollbackStarted = true;
    for (const item of [...applications].reverse())
      if (item.changed)
        assert.equal(board.undo(), true, "Blocked generated capacity rollback failed");
    assert.deepEqual(snapshot(board), before, "Blocked generated capacity rollback lost content");
  };
  let plan;
  try {
    for (let iteration = 0; iteration < 3; iteration++) {
      const planning = snapshot(board);
      plan = board.planGraphLayout({ ...fixture.layoutOptions, fixedElementIds: fixture.fixed });
      assert.deepEqual(snapshot(board), planning, "Capacity demand planning mutated content");
      if (plan.status === "ready")
        return { status: "ready", applications, steps, rolledBack: false };
      const proposal = proposeGeneratedGraphCapacity(board, fixture, plan);
      steps.push({ iteration, status: plan.status, diagnostics: plan.diagnostics, proposal });
      if (!proposal.poolPatches.length && !proposal.lanePatches.length) break;
      for (const patch of proposal.poolPatches)
        apply(() => board.setElementTransform(patch.containerId, patch.transform), patch);
      for (const patch of proposal.lanePatches)
        apply(() => board.setSwimlaneLaneSize(patch.containerId, patch.laneId, patch.size), patch);
    }
    // Never apply incomplete candidates or report a capacity warning as a clean layout.
    const planning = snapshot(board);
    plan = board.planGraphLayout({ ...fixture.layoutOptions, fixedElementIds: fixture.fixed });
    assert.deepEqual(snapshot(board), planning);
    if (plan.status === "ready") return { status: "ready", applications, steps, rolledBack: false };
    assert.equal(board.applyLayoutPlan(plan), false, "Incomplete capacity plan accepted");
    assert.deepEqual(snapshot(board), planning);
    rollback();
    return {
      status: "blocked",
      applications,
      steps,
      diagnostics: plan.diagnostics,
      rolledBack: true,
    };
  } catch (error) {
    if (!rollbackStarted) rollback();
    throw error;
  }
}

export function proposeMeasuredTextGrowth(board, report, fixture) {
  const patches = {},
    tablePatches = {},
    skipped = [];
  const protectedIds = new Set([...fixture.fixed, ...fixture.protected]);
  const generatedParticipants = new Set(fixture.expandableSequenceParticipants ?? []);
  const nativeTextIds = new Set(fixture.textPlanElementIds ?? []);
  const candidates = new Set([...fixture.nodes, ...generatedParticipants]);
  const issues = report.analyses
    .flatMap((page) => page.rendered?.issues ?? [])
    .filter((issue) => issue.rule === "element-text-overflow");
  for (const issue of issues)
    for (const id of issue.elementIds) {
      const element = board.getElement(id);
      const generatedParticipant =
        generatedParticipants.has(id) &&
        element?.type === "shape" &&
        !!element.shapeData.sequenceLifeline;
      let reason;
      if (!element || !["shape", "table"].includes(element.type) || !candidates.has(id))
        reason = "not-an-ordinary-generated-shape-or-table";
      else if (fixture.fixed.includes(id) || (protectedIds.has(id) && !generatedParticipant))
        reason = "fixed-or-native-owner";
      else {
        const seen = new Set();
        let current = element;
        while (current && !seen.has(current.id)) {
          seen.add(current.id);
          if (current.locked || current.selectable === false || current.managedBy) {
            reason = "locked-unselectable-or-managed";
            break;
          }
          current = current.parentId ? board.getElement(current.parentId) : undefined;
        }
      }
      if (!reason && nativeTextIds.has(id)) reason = "native-text-plan-required";
      const available = issue.textLayout?.availableSize,
        content = issue.textLayout?.contentSize;
      if (
        !reason &&
        (!available ||
          !content ||
          ![available.width, available.height, content.width, content.height].every(
            Number.isFinite,
          ) ||
          available.width <= 0 ||
          available.height <= 0)
      )
        reason = "measurement-unavailable";
      if (reason) {
        skipped.push({ elementId: id, reason, issue });
        continue;
      }
      if (
        element.type === "table" &&
        issue.tableRange === undefined &&
        ["width", "height"].some(
          (axis) => Math.abs(available[axis] - element.transform[axis]) > 1e-6,
        )
      ) {
        skipped.push({ elementId: id, reason: "table-cell-range-unavailable", issue });
        continue;
      }
      if (element.type === "table" && issue.tableRange !== undefined) {
        const table = board.getTable?.(id),
          structure = table?.getStructure(),
          range = issue.tableRange;
        if (
          !structure ||
          !range ||
          ![range.startRow, range.endRow, range.startColumn, range.endColumn].every(
            Number.isInteger,
          ) ||
          range.startRow < 0 ||
          range.startColumn < 0 ||
          range.startRow > range.endRow ||
          range.startColumn > range.endColumn ||
          range.endRow >= structure.rowCount ||
          range.endColumn >= structure.columnCount
        ) {
          skipped.push({ elementId: id, reason: "table-cell-range-unavailable", issue });
          continue;
        }
        const proposal = (tablePatches[id] ??= { rows: {}, columns: {}, ranges: [] });
        proposal.ranges.push(range);
        for (const [axis, start, end, sizes, ratio] of [
          [
            "rows",
            range.startRow,
            range.endRow,
            structure.rowHeights,
            content.height / available.height,
          ],
          [
            "columns",
            range.startColumn,
            range.endColumn,
            structure.columnWidths,
            content.width / available.width,
          ],
        ]) {
          if (ratio <= 1) continue;
          for (let index = start; index <= end; index++) {
            const size = Math.ceil(sizes[index] * ratio + 4 / (end - start + 1));
            if (!Number.isFinite(size) || size <= 0) continue;
            proposal[axis][index] = Math.max(proposal[axis][index] ?? 0, size);
          }
        }
        if (!Object.keys(proposal.rows).length && !Object.keys(proposal.columns).length)
          delete tablePatches[id];
        continue;
      }
      const width = element.transform.width * Math.max(1, content.width / available.width);
      const height = element.transform.height * Math.max(1, content.height / available.height);
      if (![width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
        skipped.push({ elementId: id, reason: "invalid-growth", issue });
        continue;
      }
      patches[id] = {
        width: Math.ceil(width + (content.width > available.width ? 4 : 0)),
        height: Math.ceil(height + (content.height > available.height ? 4 : 0)),
      };
    }
  return {
    patches,
    tablePatches,
    // Capacity is resolved after measured writes by the native planner, not estimated glyph gaps.
    lanePatches: [],
    skipped,
    issues,
  };
}

async function assertHistory(board, before, after, label) {
  assert.equal(await board.undo(), true, `${label} Undo failed`);
  assert.deepEqual(snapshot(board), before, `${label} Undo lost content`);
  assert.equal(await board.redo(), true, `${label} Redo failed`);
  assert.deepEqual(snapshot(board), after, `${label} Redo lost content`);
}

export async function repairMeasuredVisualText(board, lint, fixture) {
  const reports = [],
    attempts = [];
  const protectedIds = new Set([...fixture.fixed, ...fixture.protected]);
  const textPlanElementIds = fixture.textPlanElementIds?.filter((id) => !protectedIds.has(id));
  const measure = async () => {
    const before = snapshot(board);
    const report = await lint.lint({
      unitType: "board",
      unitData: snapshot(board),
      ...fixture.renderUnits,
      mode: "rendered",
      ...(textPlanElementIds?.length
        ? {
            textPlanElementIds,
            ...(fixture.textPlanMaximumWidthGrowth === undefined
              ? {}
              : { textPlanMaximumWidthGrowth: fixture.textPlanMaximumWidthGrowth }),
          }
        : {}),
    });
    assert.deepEqual(snapshot(board), before, "Rendered text planning changed source content");
    return report;
  };
  for (let index = 0; index < 3; index++) {
    const report = await measure();
    reports.push(report);
    const textPlans = textPlanElementIds?.length
      ? report.analyses.map((page) => page.textPlan)
      : [];
    const unavailable =
      textPlanElementIds?.length && (!textPlans.length || textPlans.some((plan) => !plan));
    if (unavailable || textPlans.some((plan) => plan.status !== "ready"))
      return {
        status: unavailable ? "text-plan-unavailable" : "text-plan-incomplete",
        reports,
        attempts,
        visualApproval: "pending",
      };
    const proposal = proposeMeasuredTextGrowth(board, report, fixture);
    if (
      !textPlans.some((plan) => plan.patches.length) &&
      !Object.keys(proposal.patches).length &&
      !Object.keys(proposal.tablePatches).length
    )
      return {
        status: proposal.issues.length ? "blocked" : "no-overflow-reported",
        reports,
        attempts,
        skipped: proposal.skipped,
        visualApproval: "pending",
      };
    const before = snapshot(board);
    const growthApplications = [];
    const applyGrowth = async (apply, details) => {
      const previous = snapshot(board);
      assert.equal(apply(), true, "Measured text growth rejected");
      fixture.verify();
      const after = snapshot(board),
        changed = JSON.stringify(previous) !== JSON.stringify(after);
      if (changed) await assertHistory(board, previous, after, "Measured text growth");
      growthApplications.push({
        ...details,
        applied: true,
        changed,
        ...(changed ? { undoExact: true, redoExact: true } : {}),
      });
    };
    for (const textPlan of textPlans) {
      if (!textPlan.patches.length) continue;
      await applyGrowth(() => board.applyLayoutPlan(textPlan), {
        kind: "native-rendered-text-plan",
        textPlan,
      });
      const applied = snapshot(board);
      assert.equal(board.applyLayoutPlan(textPlan), false, "Stale native text plan accepted");
      assert.deepEqual(snapshot(board), applied, "Rejected text plan changed content");
    }
    if (Object.keys(proposal.patches).length)
      await applyGrowth(() => board.setElementsTransform(proposal.patches), {
        kind: "element-frame-size",
        patches: proposal.patches,
      });
    for (const [id, patch] of Object.entries(proposal.tablePatches)) {
      const table = board.getTable(id);
      for (const [axis, sizes] of [
        ["rows", patch.rows],
        ["columns", patch.columns],
      ])
        for (const [position, size] of Object.entries(sizes)) {
          const index = Number(position);
          await applyGrowth(
            () =>
              axis === "rows"
                ? table.resizeRows(index, index, size)
                : table.resizeColumns(index, index, size),
            { kind: `table-${axis}`, elementId: id, index, size, measuredRanges: patch.ranges },
          );
        }
    }
    const capacityPreparation = reserveGeneratedVisualCapacity(board, fixture);
    if (!capacityPreparation.rolledBack)
      growthApplications.push(...capacityPreparation.applications);
    const grown = snapshot(board);
    const plan = board.planGraphLayout({
      ...fixture.layoutOptions,
      fixedElementIds: fixture.fixed,
    });
    assert.deepEqual(snapshot(board), grown, "Growth replan mutated content");
    if (plan.status === "incomplete") {
      assert.equal(board.applyLayoutPlan(plan), false, "Incomplete growth replan accepted");
      assert.deepEqual(snapshot(board), grown);
      for (const application of growthApplications.filter((item) => item.changed).reverse())
        assert.equal(await board.undo(), true, `Blocked ${application.kind} rollback failed`);
      assert.deepEqual(snapshot(board), before, "Blocked growth rollback lost content");
      attempts.push({
        index,
        textPlans,
        patches: proposal.patches,
        tablePatches: proposal.tablePatches,
        lanePatches: capacityPreparation.steps.flatMap((step) => step.proposal.lanePatches),
        capacityPreparation,
        growthApplications,
        skipped: proposal.skipped,
        growthApplied: true,
        growthRolledBack: true,
        plan,
        planApplied: false,
        undoExact: true,
        redoExact: true,
      });
      return { status: "replan-incomplete", reports, attempts, visualApproval: "pending" };
    }
    assert.equal(board.applyLayoutPlan(plan), true, "Measured-growth ready plan rejected");
    fixture.verify();
    if (plan.patches.length) {
      await assertHistory(board, grown, snapshot(board), "Measured-growth graph plan");
      assert.equal(board.applyLayoutPlan(plan), false, "Stale measured-growth plan accepted");
    }
    const compact = [];
    for (const id of fixture.compactContainers ?? []) {
      const compactBefore = snapshot(board);
      assert.equal(board.fitContainerToContent(id), true);
      fixture.verify();
      const compactAfter = snapshot(board);
      const changed = JSON.stringify(compactBefore) !== JSON.stringify(compactAfter);
      if (changed)
        await assertHistory(board, compactBefore, compactAfter, "Measured-growth container fit");
      compact.push({ containerId: id, applied: true, changed });
    }
    attempts.push({
      index,
      textPlans,
      patches: proposal.patches,
      tablePatches: proposal.tablePatches,
      lanePatches: capacityPreparation.steps.flatMap((step) => step.proposal.lanePatches),
      capacityPreparation,
      growthApplications,
      skipped: proposal.skipped,
      growthApplied: true,
      growthRolledBack: false,
      plan,
      planApplied: true,
      planChanged: plan.patches.length > 0,
      compact,
      undoExact: true,
      redoExact: true,
    });
  }
  const final = await measure();
  reports.push(final);
  return {
    status: proposeMeasuredTextGrowth(board, final, fixture).issues.length
      ? "iteration-limit"
      : "no-overflow-reported",
    reports,
    attempts,
    visualApproval: "pending",
  };
}

export async function verifyRenderedPortPlan(board, lint, renderUnits = {}) {
  const beforeSnapshot = snapshot(board);
  const input = {
    unitType: "board",
    unitData: beforeSnapshot,
    ...renderUnits,
    mode: "rendered",
    includePortPlan: true,
    maximumAutomaticLabelDistance: 12,
  };
  const before = await lint.lint(input);
  assert.deepEqual(snapshot(board), beforeSnapshot, "Rendered port planning changed the source");
  assert.equal(before.analyses.length, 1, "Fixture unexpectedly changed page count");
  const plan = before.analyses[0].portPlan;
  assert.ok(plan, "Requested rendered port plan unavailable");
  let application = { status: "unchanged", applied: false };
  if (plan.status === "ready" && plan.patches.length > 0) {
    assert.equal(board.applyLayoutPlan(plan), true, "Rendered port plan rejected");
    const afterApply = snapshot(board);
    const normalized = JSON.parse(JSON.stringify(afterApply));
    for (const collection of ["pages", "slides"]) {
      for (const [pageId, page] of Object.entries(beforeSnapshot[collection] ?? {})) {
        for (const patch of plan.patches) {
          const original = page.elements[patch.elementId];
          const changed = normalized[collection][pageId].elements[patch.elementId];
          assert.equal(original?.type, "connector", "Port plan changed a node");
          assert.equal(patch.transform, undefined);
          assert.equal(patch.labels, undefined);
          // Native endpoint writes refresh the connector frame and fallback points.
          changed.transform = original.transform;
          for (const side of ["start", "end"]) {
            const from = original.connectorData[side];
            const to = changed.connectorData[side];
            assert.equal(to.kind, from.kind);
            assert.equal(to.shapeId, from.shapeId, "Port plan changed relation ownership");
            assert.equal(
              to.connectionSiteId,
              patch[side]?.connectionSiteId ?? from.connectionSiteId,
            );
            assert.equal(
              to.connectionPosition,
              patch[side]?.connectionPosition ?? from.connectionPosition,
            );
            to.connectionSiteId = from.connectionSiteId;
            to.connectionPosition = from.connectionPosition;
            if (from.fallbackPoint === undefined) delete to.fallbackPoint;
            else to.fallbackPoint = from.fallbackPoint;
          }
        }
      }
    }
    assert.deepEqual(
      normalized,
      beforeSnapshot,
      "Port plan changed content, styles, peers or resources",
    );
    assert.equal(board.undo(), true);
    assert.deepEqual(snapshot(board), beforeSnapshot, "Port plan Undo lost data");
    assert.equal(board.redo(), true);
    assert.deepEqual(snapshot(board), afterApply, "Port plan Redo lost data");
    assert.equal(board.applyLayoutPlan(plan), false, "Stale rendered port plan accepted");
    application = {
      status: "applied-undo-redo",
      applied: true,
      changed: !isDeepStrictEqual(beforeSnapshot, afterApply),
      undoExact: true,
      redoExact: true,
      staleRejected: true,
    };
  } else if (plan.status === "incomplete") {
    assert.equal(board.applyLayoutPlan(plan), false, "Incomplete port plan accepted");
    assert.deepEqual(snapshot(board), beforeSnapshot);
    application = { status: "rejected-incomplete", applied: false, rejectedWithoutMutation: true };
  } else {
    assert.equal(plan.status, "ready");
    assert.deepEqual(snapshot(board), beforeSnapshot);
  }
  const beforeRecheck = snapshot(board);
  const after = await lint.lint({ ...input, unitData: beforeRecheck, includePortPlan: false });
  assert.deepEqual(snapshot(board), beforeRecheck, "Port reinspection changed the source");
  return { before, after, application };
}

export async function verifyRenderedLabelPlan(
  board,
  lint,
  assertCollisionImprovement = true,
  renderUnits = {},
  maximumAutomaticLabelDistance,
) {
  const input = {
    unitType: "board",
    unitData: board.save(),
    ...renderUnits,
    mode: "rendered",
    includeLabelPlan: true,
    ...(maximumAutomaticLabelDistance === undefined ? {} : { maximumAutomaticLabelDistance }),
  };
  const beforeSnapshot = snapshot(board);
  const before = await lint.lint(input);
  assert.deepEqual(snapshot(board), beforeSnapshot, "Rendered label planning changed the source");
  assert.equal(before.analyses.length, 1, "Fixture unexpectedly changed page count");
  const plan = before.analyses[0].labelPlan;
  assert.ok(plan, "Requested rendered label plan unavailable");
  let applied = false;
  let application;
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
    const afterApply = snapshot(board);
    assert.equal(board.undo(), true, "Rendered label plan Undo failed");
    assert.deepEqual(snapshot(board), beforeSnapshot, "Label plan Undo lost data");
    assert.equal(board.redo(), true, "Rendered label plan Redo failed");
    assert.deepEqual(snapshot(board), afterApply, "Label plan Redo lost data");
    assert.equal(board.applyLayoutPlan(plan), false, "Stale rendered label plan accepted");
    application = {
      status: "applied-undo-redo",
      applied: true,
      changed: !isDeepStrictEqual(beforeSnapshot, afterApply),
      undoExact: true,
      redoExact: true,
      staleRejected: true,
    };
  } else if (plan.status === "incomplete") {
    assert.equal(board.applyLayoutPlan(plan), false, "Incomplete rendered label plan accepted");
    assert.deepEqual(snapshot(board), beforeSnapshot, "Rejected label plan changed content");
    application = { status: "rejected-incomplete", applied: false, rejectedWithoutMutation: true };
  } else {
    assert.equal(plan.status, "ready");
    assert.deepEqual(snapshot(board), beforeSnapshot, "No-op rendered plan changed content");
    application = { status: "unchanged", applied: false };
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
  const record = (report) =>
    report.analyses.map(({ pageId, rendered }) => ({
      pageId,
      ...recordConnectorLabelEvidence(rendered, pageId, { maximumAutomaticLabelDistance })
        .nativeAutomaticLabelDistance,
    }));
  const automaticLabelDistance =
    maximumAutomaticLabelDistance === undefined
      ? undefined
      : {
          source: "native-lint-analysis",
          maximumAutomaticLabelDistance,
          before: record(before),
          after: record(after),
          sameStateWithScreenshots: "not-established",
          finalPaintDistance: "unmeasured",
          visualApproval: "pending",
        };
  if (automaticLabelDistance)
    automaticLabelDistance.status =
      automaticLabelDistance.after.length === 0 ||
      automaticLabelDistance.after.some((page) => page.status === "incomplete")
        ? "incomplete"
        : automaticLabelDistance.after.some((page) => page.status === "findings")
          ? "findings"
          : "measured";
  return {
    before,
    after,
    applied,
    application,
    collisionNonIncreasing,
    ...(automaticLabelDistance === undefined ? {} : { automaticLabelDistance }),
  };
}

function labelSemantics(board) {
  const copy = snapshot(board);
  for (const pages of [copy.pages, copy.slides]) {
    for (const page of Object.values(pages ?? {})) {
      for (const element of Object.values(page.elements)) {
        if (!element.connectorData) continue;
        for (const label of element.connectorData.labels ?? []) delete label.placement;
      }
    }
  }
  return copy;
}
