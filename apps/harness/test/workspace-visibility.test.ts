import { describe, expect, it } from "vitest";
import { pathInUserRoot } from "../src/client/workspace-visibility.js";

describe("Harness client path helper", () => {
  it("accepts the account root and descendants with either separator", () => {
    expect(pathInUserRoot("/srv/accounts/alice", "/srv/accounts/alice")).toBe(true);
    expect(pathInUserRoot("/srv/accounts/alice", "/srv/accounts/alice/space-1")).toBe(true);
    expect(pathInUserRoot("C:\\accounts\\alice", "C:/accounts/alice/space-1/")).toBe(true);
  });

  it("rejects sibling and prefix-confusable paths", () => {
    expect(pathInUserRoot("/srv/accounts/alice", "/srv/accounts/alice-other")).toBe(false);
    expect(pathInUserRoot("/srv/accounts/alice", "/srv/accounts/bob/space-1")).toBe(false);
    expect(pathInUserRoot(undefined, "/srv/accounts/alice")).toBe(false);
  });
});
