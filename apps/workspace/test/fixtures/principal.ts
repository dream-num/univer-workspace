import type { Principal } from "../../server/src/modules/identity/index.js";

export function interactivePrincipal(userId: string): Principal {
  return {
    user: { id: userId, username: userId, displayName: userId, avatarUrl: null, kind: "human" },
    writeSource: "browser",
    tokenIssued: false,
  };
}

export function agentPrincipal(userId: string, claimed: boolean): Principal {
  return {
    user: { id: userId, username: userId, displayName: userId, avatarUrl: null, kind: "agent", claimed },
    writeSource: "agent",
    tokenIssued: false,
  };
}
