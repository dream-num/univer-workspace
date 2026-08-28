import { describe, expect, it } from "vitest";
import { workspaceToolRowModel } from "../src/client/components/workspace-tool-row-model.ts";

const RESOURCE_ID = "4184c81c-6bc6-45c8-86a6-e909437f58f6";

function running(name: string, args: Record<string, unknown>): any {
  return {
    callId: "call-1",
    name,
    argsRaw: JSON.stringify(args),
    turn: 1,
    step: 1,
    time: 1,
    callView: null,
    subCalls: [],
  };
}

function settled(name: string, args: Record<string, unknown>, output: string, isError = false): any {
  return {
    kind: "tool-result",
    seq: 1,
    time: 2,
    callId: "call-1",
    call: { name, argsRaw: JSON.stringify(args) },
    callTime: 1,
    content: [{ type: "text", text: output }],
    isError,
    callView: null,
    resultView: null,
    subCalls: [],
  };
}

describe("Workspace keyed tool row", () => {
  it("does not expose a resource UUID while univer_open is running", () => {
    const model = workspaceToolRowModel("univer_open", running("univer_open", { resourceId: RESOURCE_ID }));

    expect(model).toMatchObject({
      titleKey: "tool.open",
      summary: null,
      summaryKey: "tool.document",
      state: "running",
    });
    expect(JSON.stringify(model)).not.toContain(RESOURCE_ID);
  });

  it("uses the returned document name instead of the opaque id", () => {
    const model = workspaceToolRowModel("univer_open", settled(
      "univer_open",
      { resourceId: RESOURCE_ID },
      JSON.stringify({ resourceId: RESOURCE_ID, unitId: "unit-1", unitType: "sheet", name: "Demo Sheet" }),
    ));

    expect(model.titleKey).toBe("tool.open");
    expect(model.summary).toBe("Demo Sheet");
    expect(model.state).toBe("ok");
  });

  it("shows a Worktree action without surfacing its id", () => {
    const model = workspaceToolRowModel("univer_worktree", running("univer_worktree", {
      action: "ready",
      worktreeId: "worktree-opaque-id",
    }));

    expect(model).toMatchObject({ titleKey: "tool.worktree", summary: "ready", state: "running" });
    expect(JSON.stringify(model)).not.toContain("worktree-opaque-id");
  });

  it("uses the first error line for a failed call", () => {
    const model = workspaceToolRowModel("univer_execute", settled(
      "univer_execute",
      { unitId: RESOURCE_ID },
      "Error: execution failed\nadditional detail",
      true,
    ));

    expect(model).toMatchObject({ summary: "Error: execution failed", state: "error" });
  });
});
