import type { Principal } from "../../server/src/modules/identity/index.js";

export function interactivePrincipal(userId: string): Principal {
  return {
    user: { id: userId, username: userId, displayName: userId, avatarUrl: null },
    writeSource: null,
    tokenIssued: false,
  };
}
