import assert from "node:assert/strict";

const snapshot = (board) => JSON.parse(JSON.stringify(board.save()));

export function proposeMeasuredTextGrowth(board, report, fixture) {
  const patches = {},
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
      if (!element || element.type !== "shape" || !candidates.has(id))
        reason = "not-an-ordinary-generated-shape";
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
  return { patches, skipped, issues };
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
  const measure = () => lint.lint({ unitType: "board", unitData: board.save(), mode: "rendered" });
  for (let index = 0; index < 3; index++) {
    const report = await measure();
    reports.push(report);
    const proposal = proposeMeasuredTextGrowth(board, report, fixture);
    if (!Object.keys(proposal.patches).length)
      return {
        status: proposal.issues.length ? "blocked" : "no-overflow-reported",
        reports,
        attempts,
        skipped: proposal.skipped,
        visualApproval: "pending",
      };
    const before = snapshot(board);
    assert.equal(
      board.setElementsTransform(proposal.patches),
      true,
      "Measured text growth rejected",
    );
    fixture.verify();
    const grown = snapshot(board);
    await assertHistory(board, before, grown, "Measured text growth");
    const plan = board.planGraphLayout({
      ...fixture.layoutOptions,
      fixedElementIds: fixture.fixed,
    });
    assert.deepEqual(snapshot(board), grown, "Growth replan mutated content");
    if (plan.status === "incomplete") {
      assert.equal(board.applyLayoutPlan(plan), false, "Incomplete growth replan accepted");
      assert.deepEqual(snapshot(board), grown);
      assert.equal(await board.undo(), true, "Blocked growth rollback failed");
      assert.deepEqual(snapshot(board), before, "Blocked growth rollback lost content");
      attempts.push({
        index,
        patches: proposal.patches,
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
