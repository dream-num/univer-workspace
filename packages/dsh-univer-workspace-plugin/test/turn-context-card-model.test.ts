import { describe, expect, it } from "vitest";
import type {
  UniverTurnFile,
  UniverTurnOperation,
} from "../src/client/conversation/univer-turn-definition.ts";
import {
  absorbWorktreeCoveredTrunkFiles,
  activeViewerMode,
  canViewMergePreview,
  canViewAgentDraft,
  canViewTrunk,
  defaultExpandedUnits,
  resolveTurnViewer,
  selectTurnUnits,
} from "../src/client/components/turn-context-card-model.ts";
import type { DocumentWorktreeState, WorktreeUnitView } from "../src/shared/state.ts";

function operation(overrides: Partial<UniverTurnOperation> = {}): UniverTurnOperation {
  return {
    callId: "call-1",
    name: "execute",
    action: null,
    docKey: "wt:wt-1",
    label: "Budget",
    unitType: "sheet",
    resourceId: "resource-1",
    worktreeId: "wt-1",
    unitId: "unit-1",
    readOnly: false,
    phase: "succeeded",
    ...overrides,
  };
}

function unit(
  unitId: string,
  resourceId: string,
  overrides: Partial<WorktreeUnitView> = {},
): WorktreeUnitView {
  return {
    unitId,
    resourceId,
    nodeId: `node-${unitId}`,
    name: `Document ${unitId}`,
    unitType: "sheet",
    source: "trunk",
    target: null,
    kind: "modified",
    draftHeadRevision: 3,
    mergeResult: "pending",
    activationState: "notApplicable",
    ...overrides,
  };
}

function worktree(overrides: Partial<DocumentWorktreeState> = {}): DocumentWorktreeState {
  return {
    worktreeId: "wt-1",
    name: "Update quarterly budget",
    status: "draft",
    summary: "Update the forecast assumptions",
    kind: "user",
    teamSpace: null,
    visibility: "private",
    creator: {
      id: "user-1",
      username: "mira",
      displayName: "Mira",
      avatarUrl: null,
    },
    unitCount: 1,
    processedAt: null,
    createdAt: "2026-09-04T08:00:00.000Z",
    updatedAt: "2026-09-04T08:01:00.000Z",
    capabilities: {
      review: true,
      editDraft: true,
      addUnit: true,
      changeVisibility: true,
      markReady: true,
      reopen: false,
      merge: false,
      discard: true,
    },
    units: [unit("unit-1", "resource-1")],
    worktreeTarget: { unitId: "unit-1", unitType: "sheet", readOnly: false },
    mergeTarget: null,
    openUrl: null,
    ...overrides,
  };
}

describe("Turn-context card presentation model", () => {
  it("absorbs a related trunk card only after a successful Worktree operation", () => {
    const trunk: UniverTurnFile = {
      docKey: "res:resource-1",
      operations: [
        operation({
          docKey: "res:resource-1",
          name: "open",
          worktreeId: null,
          readOnly: true,
        }),
      ],
    };
    const successfulWorktree: UniverTurnFile = {
      docKey: "wt:wt-1",
      operations: [operation()],
    };
    const failedWorktree: UniverTurnFile = {
      docKey: "wt:wt-1",
      operations: [operation({ phase: "failed" })],
    };

    expect(absorbWorktreeCoveredTrunkFiles([trunk, successfulWorktree])).toEqual([
      successfulWorktree,
    ]);
    expect(absorbWorktreeCoveredTrunkFiles([trunk, failedWorktree])).toEqual([
      trunk,
      failedWorktree,
    ]);
  });

  it("keeps an unrelated trunk Resource beside a Worktree card", () => {
    const files: UniverTurnFile[] = [
      {
        docKey: "res:resource-2",
        operations: [
          operation({
            docKey: "res:resource-2",
            resourceId: "resource-2",
            unitId: "unit-2",
            worktreeId: null,
          }),
        ],
      },
      { docKey: "wt:wt-1", operations: [operation()] },
    ];

    expect(absorbWorktreeCoveredTrunkFiles(files)).toEqual(files);
  });

  it("shows only Units concretely touched by successful operations", () => {
    const units = [unit("unit-1", "resource-1"), unit("unit-2", "resource-2")];
    const operations = [
      operation(),
      operation({
        callId: "failed-call",
        unitId: "unit-2",
        resourceId: "resource-2",
        phase: "failed",
      }),
    ];

    expect(selectTurnUnits(units, operations)).toEqual([units[0]]);
    expect(selectTurnUnits(units, [operation({ phase: "failed" })])).toEqual([]);
  });

  it("keeps Conversation Changes Unit accordions collapsed by default", () => {
    const units = [unit("unit-1", "resource-1"), unit("unit-2", "resource-2")];
    expect(defaultExpandedUnits(units, "unit-1", false)).toEqual([]);
    expect(defaultExpandedUnits(units, null, true)).toEqual([]);
  });

  it("shows the complete Worktree for lifecycle and identity-free successful operations", () => {
    const units = [unit("unit-1", "resource-1"), unit("unit-2", "resource-2")];
    const ready = operation({
      name: "worktree",
      action: "ready",
      resourceId: null,
      unitId: null,
    });
    const create = operation({
      name: "worktree",
      action: "create",
      resourceId: null,
      unitId: null,
    });

    expect(selectTurnUnits(units, [ready])).toEqual(units);
    expect(selectTurnUnits(units, [create])).toEqual(units);
  });

  it("resolves trunk, agent draft, and ready merge-preview scopes", () => {
    const trunkUnit = unit("unit-1", "resource-1", {
      activationState: "completed",
    });
    const draft = worktree();
    const ready = worktree({
      status: "ready",
      capabilities: { ...draft.capabilities, editDraft: false },
      mergeTarget: { unitId: "unit-1", unitType: "sheet", readOnly: true },
    });

    expect(canViewTrunk(trunkUnit)).toBe(true);
    expect(canViewMergePreview(draft)).toBe(false);
    expect(canViewAgentDraft(draft)).toBe(true);
    expect(canViewMergePreview(ready)).toBe(true);
    expect(canViewAgentDraft(ready)).toBe(true);
    expect(resolveTurnViewer(draft, trunkUnit, "trunk")).toMatchObject({
      editable: false,
      scope: { kind: "trunk" },
    });
    expect(resolveTurnViewer(draft, trunkUnit, "agent")).toMatchObject({
      editable: false,
      scope: { kind: "worktree", worktreeId: "wt-1" },
    });
    expect(resolveTurnViewer(ready, trunkUnit, "preview")).toMatchObject({
      editable: false,
      scope: { kind: "mergePreview", worktreeId: "wt-1" },
    });
    expect(activeViewerMode("agent", ready, trunkUnit)).toBe("agent");
    const previewOnly = { ...ready, worktreeTarget: null };
    expect(activeViewerMode("agent", previewOnly, trunkUnit)).toBe("preview");
    expect(resolveTurnViewer(previewOnly, trunkUnit, "agent")).toBeUndefined();
    expect(resolveTurnViewer(ready, trunkUnit, "agent")).toMatchObject({
      editable: false,
      scope: { kind: "worktree", worktreeId: "wt-1" },
    });
    expect(activeViewerMode("preview", draft, trunkUnit)).toBe("agent");
  });
});
