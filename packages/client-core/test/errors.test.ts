import { describe, expect, it } from "vitest";
import {
  executeWithStableIdentity,
  isWorkspaceResultUnknown,
  WorkspaceApplicationError,
  WorkspaceResultUnknownError,
  workspaceError,
} from "../src/index.js";

describe("Workspace errors", () => {
  it("preserves one error class identity and result-unknown detection", () => {
    const applicationError = workspaceError("workspace-result-unknown", "unknown", { id: "1" });
    const transportError = new WorkspaceResultUnknownError("interrupted");

    expect(applicationError).toBeInstanceOf(WorkspaceApplicationError);
    expect(applicationError).toMatchObject({
      code: "workspace-result-unknown",
      detail: { id: "1" },
      message: "unknown",
    });
    expect(isWorkspaceResultUnknown(applicationError)).toBe(true);
    expect(isWorkspaceResultUnknown(transportError)).toBe(true);
    expect(isWorkspaceResultUnknown(new Error("other"))).toBe(false);
  });

  it("retries only unknown results with one stable identity", async () => {
    const identities: string[] = [];
    await expect(
      executeWithStableIdentity({
        identity: "request-1",
        operation: async (identity) => {
          identities.push(identity);
          if (identities.length < 3) throw new WorkspaceResultUnknownError("lost");
          return "complete";
        },
      }),
    ).resolves.toBe("complete");
    expect(identities).toEqual(["request-1", "request-1", "request-1"]);
  });
});
