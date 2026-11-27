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

it("names the way out of each unclaimed-agent limit, and a claim lifts every one of them", () => {
  const claim = "or give a person a claim link so they can claim you, which lifts this limit.";
  const refused = (message: string) => expect.objectContaining({ code: "AGENT_QUOTA_EXCEEDED", status: 403, message });
  expect(() => assertCeiling("agent_unclaimed", "createTeamSpace", { held: 3 }))
    .toThrow(refused(`An unclaimed agent can own at most 3 Team Spaces. Work in one you already own, ${claim}`));
  expect(() => assertCeiling("agent_unclaimed", "createFork", { held: 3 }))
    .toThrow(refused(`An unclaimed agent can own at most 3 forks. Delete a fork you no longer need, ${claim}`));
  expect(() => assertCeiling("agent_unclaimed", "createFiles", { held: 20, adding: 1 })).toThrow(refused(
    `An unclaimed agent can keep at most 20 files across its Spaces, new files in its open pull requests included. Move files you no longer need to Trash, ${claim}`,
  ));
  expect(() => assertCeiling("agent_unclaimed", "storeFile", { byteSize: 10 * 1024 * 1024 + 1 }))
    .toThrow(refused(`An unclaimed agent can store files of at most 10485760 bytes. Store a smaller file, ${claim}`));
  expect(() => assertCeiling("agent_claimed", "createTeamSpace", { held: 3 })).not.toThrow();
  expect(() => assertCeiling("agent_claimed", "createFork", { held: 3 })).not.toThrow();
  expect(() => assertCeiling("agent_claimed", "createFiles", { held: 20, adding: 1 })).not.toThrow();
  expect(() => assertCeiling("agent_claimed", "storeFile", { byteSize: 10 * 1024 * 1024 + 1 })).not.toThrow();
});

it("names a claim as the way out of an unclaimed agent's refusal to search Users", () => {
  const claim = "or give a person a claim link so they can claim you, which lifts this limit.";
  expect(() => assertCeiling("agent_unclaimed", "searchUsers", {})).toThrow(expect.objectContaining({
    code: "AGENT_NOT_ALLOWED", status: 403, message: `An unclaimed agent cannot search Users. Leave other Users out, ${claim}`,
  }));
  expect(() => assertCeiling("agent_claimed", "searchUsers", {})).not.toThrow();
});
