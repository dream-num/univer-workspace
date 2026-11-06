import { describe, expect, it, vi } from "vitest";
import type { WorkspaceRuntimeTarget } from "@univerjs/univer-workspace-client-core";
import { createWorkspaceDaemonRuntimeOperations } from "../src/features/content/execution.js";

const target: WorkspaceRuntimeTarget = {
  origin: "https://workspace.test",
  revision: 7,
  scope: { kind: "worktree", worktreeId: "wt-1" },
  unitId: "book-1",
  unitType: "sheet",
};

describe("Workspace daemon runtime operations adapter", () => {
  it("preserves all three runtime RPC methods and canonical payloads", async () => {
    const request = vi.fn(async (method: string) =>
      method === "runtime.execute-read"
        ? { state: state(), value: "read" }
        : method === "runtime.export-unit-data"
          ? { id: "book-1" }
          : { committed: false, value: "write" },
    );
    const runtime = createWorkspaceDaemonRuntimeOperations({ request });

    await expect(runtime.executeRead({ code: "return 1", target })).resolves.toMatchObject({
      value: "read",
    });
    await expect(runtime.exportUnitData({ target })).resolves.toEqual({ id: "book-1" });
    await expect(runtime.executeAndCommit({ code: "edit", target })).resolves.toEqual({
      committed: false,
      value: "write",
    });
    expect(request.mock.calls).toEqual([
      ["runtime.execute-read", { code: "return 1", target }],
      ["runtime.export-unit-data", { target }],
      ["runtime.execute-and-commit", { code: "edit", target }],
    ]);
  });
});

function state() {
  return {
    awaitingChangeset: null,
    baseRevision: 7,
    bufferedChangesetCount: 0,
    conflict: null,
    connection: "online",
    knownHeadRevision: 7,
    pendingMutationCount: 0,
  };
}
