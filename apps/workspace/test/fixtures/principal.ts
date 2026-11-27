import type { Principal } from "../../server/src/modules/identity/index.js";

/** A person signed in to Workspace in a browser, the only session that may widen who can see data. */
export function interactivePrincipal(userId: string): Principal {
  return {
    user: { id: userId, username: userId, displayName: userId, avatarUrl: null, kind: "human" },
    writeSource: "browser",
    tokenIssued: false,
  };
}

/** An agent's own session. It narrows who can see data and never widens it, a temporary agent's viewer link aside. */
export function agentPrincipal(userId: string, claimed: boolean): Principal {
  return {
    user: { id: userId, username: userId, displayName: userId, avatarUrl: null, kind: "agent", claimed },
    writeSource: "agent",
    tokenIssued: false,
  };
}
