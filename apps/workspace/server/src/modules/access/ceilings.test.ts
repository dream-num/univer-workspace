import { expect, it } from "vitest";
import { assertCeiling } from "./ceilings.js";

it("holds claimed and unclaimed agents, never people, to 10 open pull requests and 50 merges a day", () => {
  const atLimit = { open: 10, merged: 50, adding: 1 };
  for (const principal of ["agent_claimed", "agent_unclaimed"] as const) {
    for (const action of ["openWorktree", "mergeWorktree"] as const) {
      expect(() => assertCeiling(principal, action, atLimit)).toThrow(expect.objectContaining({ code: "AGENT_QUOTA_EXCEEDED", status: 403 }));
      expect(() => assertCeiling(principal, action, { ...atLimit, adding: 0 }), "a retry already counted").not.toThrow();
    }
    expect(() => assertCeiling(principal, "openWorktree", { open: 9, merged: 50, adding: 1 })).not.toThrow();
    expect(() => assertCeiling(principal, "mergeWorktree", { open: 10, merged: 49, adding: 1 })).not.toThrow();
  }
  for (const action of ["openWorktree", "mergeWorktree"] as const) {
    expect(() => assertCeiling("human", action, { open: 1000, merged: 1000, adding: 1 })).not.toThrow();
  }
});
