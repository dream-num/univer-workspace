import { expect, it } from "vitest";
import { repositoryMembers } from "./team-members";

const owner = { id: "owner", username: "owner", displayName: "Owner", avatarUrl: null };
const user = { ...owner, id: "member", username: "member" };
const membership = (person: typeof owner) => ({
  user: person,
  role: "editor" as const,
  grantedBy: owner,
  createdAt: "2026-11-06T00:00:00Z",
  updatedAt: "2026-11-06T00:00:00Z",
});

it("counts the owner once, including owner-only teams and duplicate owner memberships", () => {
  expect(repositoryMembers({ owner, members: [] })).toEqual([owner]);
  expect(repositoryMembers({ owner, members: [membership(owner), membership(user)] })).toEqual([
    owner,
    user,
  ]);
});
