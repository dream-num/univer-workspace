import assert from "node:assert/strict";

const snapshot = (board) => JSON.parse(JSON.stringify(board.save()));

function proposeLaneCapacity(board, patches, fixture) {
  const lanePatches = [];
  const containers = new Map();
  for (const { containerId, laneId } of fixture.expandableLanes ?? []) {
    if (!containers.has(containerId)) containers.set(containerId, new Set());
    containers.get(containerId).add(laneId);
  }
  const protectedIds = new Set([...fixture.fixed, ...fixture.protected]);
  for (const [containerId, allowed] of containers) {
    const pool = board.getElement(containerId),
      swimlane = pool?.containerData?.swimlane;
    if (
      !swimlane ||
      pool.locked ||
      pool.selectable === false ||
      pool.managedBy ||
      fixture.fixed.includes(containerId) ||
      pool.containerData.behavior.membershipLocked ||
      pool.transform.rotation ||
      pool.transform.skewX ||
      pool.transform.skewY ||
      pool.transform.flipX ||
      pool.transform.flipY ||
      (pool.transform.scaleX ?? 1) !== 1 ||
      (pool.transform.scaleY ?? 1) !== 1
    )
      continue;
    const lanes = [...swimlane.lanes].sort((a, b) => a.order - b.order);
    const elements = Object.values(board.getElements());
    const eligible = (lane) =>
      allowed.has(lane.id) &&
      !lane.locked &&
      !lane.collapsed &&
      !elements.some((element) => {
        const seen = new Set();
        let current = element,
          laneId = current.laneId,
          pinned = false;
        while (current && current.id !== containerId && !seen.has(current.id)) {
          seen.add(current.id);
          pinned ||=
            protectedIds.has(current.id) ||
            current.locked ||
            current.selectable === false ||
            !!current.managedBy;
          if (current.parentId === containerId) return laneId === lane.id && pinned;
          current = current.parentId ? board.getElement(current.parentId) : undefined;
          laneId ??= current?.laneId;
        }
        return false;
      });
    const desired = lanes.map((lane) => {
      if (!eligible(lane)) return lane.size;
      const members = fixture.nodes
        .map((id) => board.getElement(id))
        .filter((item) => item?.parentId === containerId && item.laneId === lane.id);
      const axis = swimlane.orientation === "horizontal" ? "height" : "width",
        sizes = members.map((item) => patches[item.id]?.[axis] ?? item.transform[axis]),
        stacked = (fixture.layoutOptions.direction ?? "horizontal") !== swimlane.orientation;
      if (!sizes.length || !sizes.every((size) => Number.isFinite(size) && size > 0))
        return lane.size;
      // Conservative generated-lane preflight; the public graph plan remains authoritative.
      const required = Math.ceil(
        (stacked ? sizes.reduce((sum, size) => sum + size, 0) : Math.max(...sizes)) +
          72 +
          (stacked ? Math.max(0, sizes.length - 1) * (fixture.layoutOptions.layerGap ?? 100) : 0),
      );
      return Math.max(lane.size, required);
    });
    const firstGrowth = desired.findIndex((size, index) => size > lanes[index].size);
    if (firstGrowth < 0 || !lanes.slice(firstGrowth).every(eligible)) continue;
    const targets = [];
    let carry = 0;
    for (const [index, lane] of lanes.entries()) {
      const size = desired[index] + carry;
      if (size > lane.size) targets.push({ containerId, laneId: lane.id, size });
      carry += desired[index] - lane.size;
    }
    // Native resizing transfers capacity to the next lane. Reserve it at the pool's end first.
    lanePatches.push(...targets.reverse());
  }
  return lanePatches;
}

export function proposeMeasuredTextGrowth(board, report, fixture) {
  const patches = {},
    tablePatches = {},
    skipped = [];
  const protectedIds = new Set([...fixture.fixed, ...fixture.protected]);
  const candidates = new Set(fixture.nodes);
  const issues = report.analyses
    .flatMap((page) => page.rendered?.issues ?? [])
    .filter((issue) => issue.rule === "element-text-overflow");
  for (const issue of issues)
    for (const id of issue.elementIds) {
      const element = board.getElement(id);
      let reason;
      if (!element || !["shape", "table"].includes(element.type) || !candidates.has(id))
        reason = "not-an-ordinary-generated-shape-or-table";
      else if (protectedIds.has(id)) reason = "fixed-or-native-owner";
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
    lanePatches: proposeLaneCapacity(board, patches, fixture),
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
  const measure = () =>
    lint.lint({
      unitType: "board",
      unitData: board.save(),
      ...fixture.renderUnits,
      mode: "rendered",
    });
  for (let index = 0; index < 3; index++) {
    const report = await measure();
    reports.push(report);
    const proposal = proposeMeasuredTextGrowth(board, report, fixture);
    if (!Object.keys(proposal.patches).length && !Object.keys(proposal.tablePatches).length)
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
    for (const patch of proposal.lanePatches)
      await applyGrowth(
        () => board.setSwimlaneLaneSize(patch.containerId, patch.laneId, patch.size),
        {
          kind: "swimlane-capacity",
          ...patch,
        },
      );
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
        patches: proposal.patches,
        tablePatches: proposal.tablePatches,
        lanePatches: proposal.lanePatches,
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
      patches: proposal.patches,
      tablePatches: proposal.tablePatches,
      lanePatches: proposal.lanePatches,
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
