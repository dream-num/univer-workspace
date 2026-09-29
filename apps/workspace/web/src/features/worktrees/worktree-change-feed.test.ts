import { describe, expect, it } from "vitest";
import { parseWorktreeChangeFeedMessage } from "./worktree-change-feed";

describe("parseWorktreeChangeFeedMessage", () => {
  it("accepts ready and change messages", () => {
    expect(
      parseWorktreeChangeFeedMessage(
        JSON.stringify({ event: "worktreeChangeFeedReady" })
      )
    ).toEqual({ event: "worktreeChangeFeedReady" });
    expect(
      parseWorktreeChangeFeedMessage(
        JSON.stringify({ event: "worktreesChanged" })
      )
    ).toEqual({ event: "worktreesChanged" });
  });

  it("accepts the Issue refetch hint without exposing its Space", () => {
    expect(
      parseWorktreeChangeFeedMessage(JSON.stringify({ event: "issuesChanged", spaceId: "s1" }))
    ).toEqual({ event: "issuesChanged" });
  });

  it("ignores malformed and unknown messages", () => {
    expect(parseWorktreeChangeFeedMessage("not-json")).toBeNull();
    expect(
      parseWorktreeChangeFeedMessage(JSON.stringify({ event: "unknown" }))
    ).toBeNull();
  });
});
