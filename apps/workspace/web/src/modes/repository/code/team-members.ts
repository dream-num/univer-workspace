import type { components } from "../../../../../generated/http/schema.js";

export function repositoryMembers({ owner, members }: components["schemas"]["TeamMemberList"]) {
  return [owner, ...members.filter(({ user }) => user.id !== owner.id).map(({ user }) => user)];
}
