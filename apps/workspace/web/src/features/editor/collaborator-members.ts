import type { IMember } from "@univerjs/protocol";

export function uniqueCollaborators(
  members: readonly IMember[],
  currentUserId: string
): IMember[] {
  const users = new Map<string, IMember>();
  for (const member of members) {
    const previous = users.get(member.userID);
    if (!previous || (!previous.avatar && member.avatar)) {
      users.set(member.userID, member);
    }
  }
  return [...users.values()].sort((left, right) => {
    if (left.userID === currentUserId) return -1;
    if (right.userID === currentUserId) return 1;
    return left.userID.localeCompare(right.userID);
  });
}
