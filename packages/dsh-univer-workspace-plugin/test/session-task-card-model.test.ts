import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type {
  UniverTurnFile,
  UniverTurnOperation,
} from "../src/client/conversation/univer-turn-definition.ts";
import {
  defaultCurrentWorktreeId,
  sessionCardCandidates,
  type SessionWorktreeCandidate,
} from "../src/client/components/session-task-card-model.ts";
import { en, zh } from "../src/client/locales.ts";
import type { WorktreeStatus } from "../src/shared/state.ts";

function operation(
  callId: string,
  overrides: Partial<UniverTurnOperation> = {},
): UniverTurnOperation {
  return {
    callId,
    name: "open",
    action: null,
    docKey: "res:resource-1",
    label: "Budget",
    unitType: "sheet",
    resourceId: "resource-1",
    worktreeId: null,
    unitId: "unit-1",
    readOnly: true,
    phase: "succeeded",
    ...overrides,
  };
}

function file(docKey: string, operations: UniverTurnOperation[]): UniverTurnFile {
  return { docKey, operations };
}

describe("Session task-card presentation model", () => {
  it("does not let a failed or non-qualifying Worktree suppress the Resource fallback", () => {
    const resource = file("res:resource-1", [operation("resource-open")]);
    const failedWorktree = file("wt:worktree-1", [
      operation("failed-edit", {
        name: "execute",
        docKey: "wt:worktree-1",
        worktreeId: "worktree-1",
        phase: "failed",
      }),
    ]);
    const mergedWorktree = file("wt:worktree-1", [
      operation("merge", {
        name: "worktree",
        action: "merge",
        docKey: "wt:worktree-1",
        worktreeId: "worktree-1",
      }),
    ]);

    expect(sessionCardCandidates([resource, failedWorktree])).toMatchObject({
      worktrees: [],
      fallback: { resourceId: "resource-1", label: "Budget" },
    });
    expect(sessionCardCandidates([resource, mergedWorktree])).toMatchObject({
      worktrees: [],
      fallback: { resourceId: "resource-1", label: "Budget" },
    });
  });

  it("absorbs a related Resource after a qualifying Worktree operation", () => {
    const candidates = sessionCardCandidates([
      file("res:resource-1", [operation("resource-open")]),
      file("wt:worktree-1", [
        operation("worktree-edit", {
          name: "execute",
          docKey: "wt:worktree-1",
          label: "Budget changes",
          worktreeId: "worktree-1",
          readOnly: false,
        }),
      ]),
    ]);

    expect(candidates).toEqual({
      worktrees: [
        {
          docKey: "wt:worktree-1",
          worktreeId: "worktree-1",
          label: "Budget changes",
          preferredUnitId: "unit-1",
          preferredUnitType: "sheet",
          recency: 1,
        },
      ],
      fallback: null,
    });
  });

  it("omits even an independent Resource fallback whenever a Worktree exists", () => {
    const candidates = sessionCardCandidates([
      file("res:resource-2", [
        operation("other-resource", {
          docKey: "res:resource-2",
          resourceId: "resource-2",
          unitId: "unit-2",
          label: "Roadmap",
        }),
      ]),
      file("wt:worktree-1", [
        operation("worktree-edit", {
          name: "execute",
          docKey: "wt:worktree-1",
          worktreeId: "worktree-1",
        }),
      ]),
    ]);

    expect(candidates.worktrees.map((candidate) => candidate.worktreeId)).toEqual(["worktree-1"]);
    expect(candidates.fallback).toBeNull();
  });

  it("keeps Resource labels isolated and chooses the last traversed fallback", () => {
    const candidates = sessionCardCandidates([
      file("res:resource-1", [
        operation("resource-1-open", { label: "Budget" }),
        operation("resource-1-later", { label: null, unitId: "unit-1b" }),
      ]),
      file("res:resource-2", [
        operation("resource-2-open", {
          docKey: "res:resource-2",
          resourceId: "resource-2",
          unitId: "unit-2",
          label: "Roadmap",
        }),
      ]),
    ]);

    expect(candidates).toMatchObject({
      worktrees: [],
      fallback: {
        resourceId: "resource-2",
        label: "Roadmap",
        preferredUnitId: "unit-2",
      },
    });
  });

  it("deduplicates Worktrees and keeps the latest values within stable traversal order", () => {
    const candidates = sessionCardCandidates([
      file("wt:worktree-1", [
        operation("worktree-1-open", {
          docKey: "wt:worktree-1",
          label: "First name",
          worktreeId: "worktree-1",
        }),
        operation("worktree-1-edit", {
          name: "execute",
          docKey: "wt:worktree-1",
          label: null,
          worktreeId: "worktree-1",
          unitId: "unit-1b",
        }),
      ]),
      file("wt:worktree-2", [
        operation("worktree-2-open", {
          docKey: "wt:worktree-2",
          label: "Second worktree",
          worktreeId: "worktree-2",
          unitId: "unit-2",
        }),
      ]),
    ]);

    expect(candidates.worktrees).toHaveLength(2);
    expect(candidates.worktrees.map((candidate) => candidate.worktreeId)).toEqual([
      "worktree-2",
      "worktree-1",
    ]);
    expect(candidates.worktrees[1]).toMatchObject({
      label: "First name",
      preferredUnitId: "unit-1b",
    });
  });

  it("defaults to the newest active Worktree, then the newest processed one", () => {
    const worktrees: SessionWorktreeCandidate[] = [
      {
        docKey: "wt:new-processed",
        worktreeId: "new-processed",
        label: null,
        preferredUnitId: null,
        preferredUnitType: null,
        recency: 3,
      },
      {
        docKey: "wt:active",
        worktreeId: "active",
        label: null,
        preferredUnitId: null,
        preferredUnitType: null,
        recency: 2,
      },
      {
        docKey: "wt:old-processed",
        worktreeId: "old-processed",
        label: null,
        preferredUnitId: null,
        preferredUnitType: null,
        recency: 1,
      },
    ];
    const statuses = new Map<string, WorktreeStatus>([
      ["new-processed", "merged"],
      ["active", "draft"],
      ["old-processed", "discarded"],
    ]);

    expect(
      defaultCurrentWorktreeId(worktrees, (candidate) => statuses.get(candidate.worktreeId)),
    ).toBe("active");
    expect(defaultCurrentWorktreeId(worktrees, () => "merged")).toBe("new-processed");
    expect(defaultCurrentWorktreeId([], () => undefined)).toBeNull();
  });
});

describe("Session task-card source contract", () => {
  it("renders one session card and does not opt it into exclusive Viewer ownership", async () => {
    const [dockSource, cardSource] = await Promise.all([
      readFile(new URL("../src/client/ViewerDock.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/client/components/TaskContextCard.tsx", import.meta.url), "utf8"),
    ]);

    expect(dockSource.match(/<TaskContextCard\b/g)).toHaveLength(1);
    expect(dockSource).not.toMatch(/tasks\.map|open\.map|Object\.values\(open\)/);
    expect(cardSource).not.toMatch(/from\s+["']\.\/use-exclusive-viewer/);
    expect(cardSource).not.toMatch(/\buseExclusiveViewer\s*\(/);
  });

  it("keeps Changes cards independent from the middle Workspace Viewer", async () => {
    const [turnSource, previewSource, clientSource] = await Promise.all([
      readFile(new URL("../src/client/components/TurnContextCard.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/client/components/preview-card.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/client/index.tsx", import.meta.url), "utf8"),
    ]);

    expect(zh["turn.ribbon"]).toBe("Changes");
    expect(en["turn.ribbon"]).toBe("Changes");
    expect(previewSource).toContain(
      'const firstWorktreeIndex = files.findIndex((entry) => entry.docKey.startsWith("wt:"))',
    );
    expect(previewSource).toContain(
      "initiallyExpanded={worktreeId !== null && index === firstWorktreeIndex}",
    );
    expect(turnSource).toContain("React.useState(!props.initiallyExpanded)");
    expect(turnSource.match(/props\.t\("task\.openMiddle"\)/g)).toHaveLength(2);
    expect(turnSource.match(/type:\s*"open-content"/g)).toHaveLength(2);
    expect(turnSource).not.toContain("OPEN_VIEWER_EVENT");
    expect(turnSource).not.toMatch(/from\s+["']\.\/use-exclusive-viewer/);
    expect(turnSource).not.toMatch(/\buseExclusiveViewer\s*\(/);
    expect(clientSource).toMatch(
      /name:\s*"conversation\.chat\.turnTail"[\s\S]{0,180}inject:\s*\(\)\s*=>\s*\(\{[\s\S]{0,100}\bnavigation\b/,
    );
  });
});
