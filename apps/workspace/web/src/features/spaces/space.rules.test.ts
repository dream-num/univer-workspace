import { describe, expect, it } from "vitest";
import { spaceSupportsIssues, spaceSupportsMembers } from "./space.rules";

describe("Space capabilities by type", () => {
  it("supports Issues and members in team Spaces", () => {
    const space = { type: "team" } as const;
    expect(spaceSupportsIssues(space)).toBe(true);
    expect(spaceSupportsMembers(space)).toBe(true);
  });

  it("excludes Issues and members from personal Spaces", () => {
    const space = { type: "personal" } as const;
    expect(spaceSupportsIssues(space)).toBe(false);
    expect(spaceSupportsMembers(space)).toBe(false);
  });
});
