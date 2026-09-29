import { describe, expect, it } from "vitest";
import type { components } from "../../../../generated/http/schema.js";
import { worktreeBelongsToSpace } from "./worktree-space.js";

type WorktreeSummary = components["schemas"]["WorktreeSummary"];
type Worktree = Pick<WorktreeSummary, "kind" | "teamSpace">;

const personalSpace = { id: "personal-1", type: "personal" } as const;
const teamSpace = { id: "team-1", type: "team" } as const;

function worktree(kind: Worktree["kind"], teamSpaceId: string | null): Worktree {
  return {
    kind,
    teamSpace:
      teamSpaceId === null
        ? null
        : ({ id: teamSpaceId } as WorktreeSummary["teamSpace"]),
  };
}

describe("worktreeBelongsToSpace", () => {
  it("matches a team worktree to its own team space", () => {
    expect(worktreeBelongsToSpace(worktree("team", "team-1"), teamSpace)).toBe(true);
  });

  it("does not match a team worktree to another team space", () => {
    expect(worktreeBelongsToSpace(worktree("team", "team-2"), teamSpace)).toBe(false);
  });

  it("matches a personal worktree to the personal space", () => {
    expect(worktreeBelongsToSpace(worktree("user", null), personalSpace)).toBe(true);
  });

  it("does not match a team worktree to the personal space", () => {
    expect(worktreeBelongsToSpace(worktree("team", "team-1"), personalSpace)).toBe(false);
  });
});
