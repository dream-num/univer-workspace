import { randomBytes } from "node:crypto";
import { ApplicationError } from "../../middleware/errors.js";
import { agentActivityWindow } from "./agent-activity.js";
import type { IdentityRepository, StoredAgent } from "./identity.repository.js";
import type { IdentityModule } from "./identity.service.js";
import type { AgentClaimCode, AgentHandoff, AgentView, Principal } from "./identity.types.js";
import { hashSessionSecret } from "./session-token.js";

const CLAIM_CODE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EXPIRED_CODE_ANSWERED_FOR_MS = CLAIM_CODE_TTL_MS;
const CLAIM_CODES_PER_AGENT = 10;
// At the default 5 agents an hour, each holding 10 codes for 7 days, a source keeps about 8,400 live codes. The cap fits about 12 sources doing that.
const CLAIM_CODE_CAPACITY = 100_000;

export interface AgentClaims {
  createCode(cookieHeader: string | undefined): Promise<AgentClaimCode>;
  /** Needs no session. `previewMs` is the handoff cookie's lifetime, null once the agent belongs to the caller. */
  handoff(cookieHeader: string | undefined, code: unknown): Promise<{ readonly view: AgentHandoff; readonly previewMs: number | null }>;
  /** `keepFileLinks` keeps the links of the agent's Personal Space files open, which the claim otherwise closes. */
  claim(cookieHeader: string | undefined, code: unknown, keepFileLinks: boolean): Promise<{ readonly agent: AgentView }>;
  list(cookieHeader: string | undefined): Promise<{ readonly agents: readonly AgentView[] }>;
  stop(cookieHeader: string | undefined, agentUserId: string): Promise<void>;
}

export function createAgentClaims(options: {
  readonly identity: Pick<IdentityModule, "requireSession" | "requireInteractiveSession">;
  readonly repository: Pick<IdentityRepository, "findAgents" | "listAgentSpaces" | "touchAgent" | "claimAgent" | "banClaimedAgent" | "putSignInCode" | "findSignInCode">;
  readonly keepFileLinks: (human: Principal, agentUserId: string) => Promise<void>;
  readonly onAgentClaimed: () => void;
  readonly onAgentStopped: (agentUserId: string) => void;
  readonly now?: () => number;
}): AgentClaims {
  const { identity, repository } = options;
  const now = options.now ?? (() => Date.now());

  async function claimable(code: unknown, humanId: string | null): Promise<{ readonly agent: StoredAgent; readonly claimed: boolean; readonly expiresAt: number }> {
    const claim = typeof code === "string" ? await repository.findSignInCode("claim", hashSessionSecret(code)) : null;
    const at = now();
    if (!claim || claim.expiresAt + EXPIRED_CODE_ANSWERED_FOR_MS <= at) throw invalidCode();
    if (claim.expiresAt <= at) {
      throw new ApplicationError("AGENT_CLAIM_EXPIRED", 410, "This handoff link has expired. Ask the agent for a new one.");
    }
    const [agent] = await repository.findAgents({ userId: claim.subjectUserId! });
    if (agent && humanId !== null && agent.ownerUserId === humanId) return { agent, claimed: true, expiresAt: claim.expiresAt };
    if (!agent || agent.banned) throw invalidCode();
    if (agent.ownerUserId !== null) throw alreadyClaimed();
    return { agent, claimed: false, expiresAt: claim.expiresAt };
  }

  async function personInBrowserId(cookieHeader: string | undefined): Promise<string | null> {
    try {
      return (await identity.requireInteractiveSession(cookieHeader)).user.id;
    } catch (error) {
      if (error instanceof ApplicationError) return null;
      throw error;
    }
  }

  return {
    async createCode(cookieHeader) {
      const { user } = await identity.requireSession(cookieHeader);
      if (user.kind !== "agent") {
        throw new ApplicationError("FORBIDDEN", 403, "Only an agent can ask for a handoff link.");
      }
      if (user.claimed) throw alreadyClaimed();
      const at = now();
      const code = randomBytes(16).toString("base64url");
      const stored = await repository.putSignInCode(
        { kind: "claim", codeHash: hashSessionSecret(code), userCodeHash: null, subjectUserId: user.id, payload: "{}", createdAt: at, expiresAt: at + CLAIM_CODE_TTL_MS },
        { expiredBefore: at - EXPIRED_CODE_ANSWERED_FOR_MS, perSubject: CLAIM_CODES_PER_AGENT, capacity: CLAIM_CODE_CAPACITY },
      );
      if (stored !== "stored") {
        throw new ApplicationError("AGENT_CLAIM_UNAVAILABLE", 503, "Handoff links are temporarily unavailable. Try again shortly.");
      }
      return { code, claimUrl: `/claim/${code}`, expiresIn: CLAIM_CODE_TTL_MS / 1000 };
    },

    async handoff(cookieHeader, code) {
      const { agent, claimed, expiresAt } = await claimable(code, await personInBrowserId(cookieHeader));
      if (!claimed) {
        const activity = agentActivityWindow(now());
        await repository.touchAgent({ userId: agent.user.id }, activity.at, activity.staleBefore, activity.expiresAt);
      }
      return {
        view: {
          agent: agentView(agent),
          claimed,
          expiresAt: new Date(expiresAt).toISOString(),
          spaces: await repository.listAgentSpaces(agent.user.id),
        },
        previewMs: claimed ? null : expiresAt - now(),
      };
    },

    async claim(cookieHeader, code, keepFileLinks) {
      const human = await identity.requireInteractiveSession(cookieHeader);
      const { agent, claimed } = await claimable(code, human.user.id);
      if (!claimed && !(await repository.claimAgent(agent.user.id, human.user.id, now()))) throw alreadyClaimed();
      try {
        // No transaction spans the claim and Link Sharing, so this also runs for an agent the person already took: a retry finishes it.
        if (keepFileLinks) await options.keepFileLinks(human, agent.user.id);
      } finally {
        if (!claimed) options.onAgentClaimed();
      }
      return { agent: agentView(agent) };
    },

    async list(cookieHeader) {
      const human = (await identity.requireInteractiveSession(cookieHeader)).user;
      return { agents: (await repository.findAgents({ ownerUserId: human.id })).map(agentView) };
    },

    async stop(cookieHeader, agentUserId) {
      const human = (await identity.requireInteractiveSession(cookieHeader)).user;
      if (!(await repository.banClaimedAgent(human.id, agentUserId, now()))) {
        throw new ApplicationError("NOT_FOUND", 404, "The resource was not found.");
      }
      options.onAgentStopped(agentUserId);
    },
  };
}

function agentView(agent: StoredAgent): AgentView {
  return {
    ...agent.user,
    spaceId: agent.spaceId,
    files: agent.files,
    lastActiveAt: agent.lastActiveAt,
    stopped: agent.banned,
  };
}

function invalidCode(): ApplicationError {
  return new ApplicationError("AGENT_CLAIM_INVALID", 404, "This handoff link is not valid. Ask the agent for a new one.");
}

function alreadyClaimed(): ApplicationError {
  return new ApplicationError("AGENT_ALREADY_CLAIMED", 409, "This agent already has an owner.");
}
