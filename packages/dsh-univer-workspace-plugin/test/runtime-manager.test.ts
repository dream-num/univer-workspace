import { describe, expect, it } from "vitest";
import { runtimeFailureMessage } from "../src/runtime/manager.ts";

describe("runtime failure diagnostics", () => {
  const target = { unitType: "sheet" as const, unitId: "unit-1" };

  it("keeps the worker operation error when the pool crash races its event", () => {
    const error = new Error("Worker exited unexpectedly", {
      cause: new Error("Invalid horizontal alignment: 2"),
    });

    expect(runtimeFailureMessage("inspect", target, error, undefined, "diag-1"))
      .toContain("Invalid horizontal alignment: 2");
  });

  it("keeps direct worker errors without requiring an event code", () => {
    expect(runtimeFailureMessage("write", target, new Error("Worksheet name is required"), undefined, "diag-2"))
      .toContain("Worksheet name is required");
  });
});
