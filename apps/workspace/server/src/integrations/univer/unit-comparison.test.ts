import { describe, expect, it } from "vitest";
import { createWorkspaceUnitComparison } from "./unit-comparison.js";

type Input = Parameters<typeof createWorkspaceUnitComparison>[0];

describe("the comparison with Trunk before a merge", () => {
  it("refuses when the merge wrote the Unit's first revision, instead of reading the latest Trunk", async () => {
    const reads: unknown[] = [];
    const worktreeService = {
      getWorktree: async () => ({
        worktree: { status: "merged", units: [{ unitID: "unit", mergeResult: { status: "merged", trunkRevision: 1 } }] },
      }),
    } as unknown as Input["worktreeService"];
    const service = {
      getUnitLoadDataWithBlocks: async (request: unknown) => {
        reads.push(request);
        throw new Error("Trunk must not be read");
      },
    } as unknown as Input["service"];

    await expect(createWorkspaceUnitComparison({
      service, worktreeService, materializer: { materializeSnapshot: async () => { throw new Error("unused"); } },
      userId: "reader", worktreeId: "pull", unitId: "unit", unitName: "Totals", unitType: "sheet",
      source: "trunk", change: "modified", baseMode: "parent", view: "merged",
    })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(reads).toEqual([]);
  });
});
