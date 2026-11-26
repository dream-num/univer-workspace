import { describe, expect, it } from "vitest";
import { ACCESS_TIER_SCOPES, chosenTier, requestTier } from "./access-tokens.js";

describe("access tiers", () => {
  it("grants read alone, or every scope with read and write", () => {
    expect(ACCESS_TIER_SCOPES).toEqual({ read: ["read"], read_write: ["read", "write", "publish", "worktree:merge"] });
  });

  it("allows read and write only to a request that names write", () => {
    expect(requestTier(["read", "write"])).toBe("read_write");
    expect(requestTier(["write"])).toBe("read_write");
    expect(requestTier(["read", "publish", "worktree:merge"])).toBe("read");
    expect(requestTier(["read"])).toBe("read");
  });

  it("never picks more than the request allows, whatever the form submits", () => {
    expect(chosenTier(["read", "write"], "read_write")).toBe("read_write");
    expect(chosenTier(["read", "publish"], "read_write"), "a forged toggle on a read-only request").toBe("read");
    for (const submitted of [undefined, "read", "", "READ_WRITE", ["read_write"], "write"]) {
      expect(chosenTier(["read", "write"], submitted), JSON.stringify(submitted)).toBe("read");
    }
  });
});
