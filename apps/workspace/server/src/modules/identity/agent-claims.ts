import { randomBytes } from "node:crypto";
import { ApplicationError } from "../../middleware/errors.js";
import type { IdentityRepository, StoredAgent } from "./identity.repository.js";
import type { IdentityModule } from "./identity.service.js";
import type { AgentClaimCode, AgentView, User } from "./identity.types.js";

const CLAIM_CODE_TTL_MS = 10 * 60 * 1000;
const EXPIRED_CODE_ANSWERED_FOR_MS = CLAIM_CODE_TTL_MS;
const CLAIM_CODES_PER_AGENT = 10;
const CLAIM_CODE_CAPACITY = 10_000;

interface PendingClaim {
  readonly agentUserId: string;
  readonly expiresAt: number;
}

export interface AgentClaims {
  createCode(cookieHeader: string | undefined): Promise<AgentClaimCode>;
  /** `claimed` is true once the signed-in human owns the agent. */
  inspect(cookieHeader: string | undefined, code: unknown): Promise<{ readonly agent: AgentView; readonly claimed: boolean }>;
  /** Repeating it as the owner changes nothing. */
  claim(cookieHeader: string | undefined, code: unknown): Promise<{ readonly agent: AgentView }>;
  list(cookieHeader: string | undefined): Promise<{ readonly agents: readonly AgentView[] }>;
  /** Bans the agent for good: it can no longer sign in, and only its owners see its Space. */
  stop(cookieHeader: string | undefined, agentUserId: string): Promise<void>;
}

export function createAgentClaims(options: {
  readonly identity: Pick<IdentityModule, "requireSession" | "requireInteractiveSession">;
  readonly repository: Pick<IdentityRepository, "findAgents" | "claimAgent" | "banClaimedAgent">;
  readonly onAgentStopped: (agentUserId: string) => void;
  readonly now?: () => number;
}): AgentClaims {
  const { identity, repository } = options;
  const now = options.now ?? (() => Date.now());
  const pending = new Map<string, PendingClaim>();

  function sweep(agentUserId: string): number {
    const at = now();
    let oldest: string | undefined;
    let mine = 0;
    let live = 0;
    for (const [code, claim] of pending) {
      if (claim.expiresAt + EXPIRED_CODE_ANSWERED_FOR_MS <= at) pending.delete(code);
      else if (claim.expiresAt > at) {
        live += 1;
        if (claim.agentUserId === agentUserId) {
          oldest ??= code;
          mine += 1;
        }
      }
    }
    if (oldest === undefined || mine < CLAIM_CODES_PER_AGENT) return live;
    pending.delete(oldest);
    return live - 1;
  }

  async function requireHuman(cookieHeader: string | undefined): Promise<User> {
    const { user, writeSource } = await identity.requireInteractiveSession(cookieHeader);
    if (user.kind !== "human") {
      throw new ApplicationError("FORBIDDEN", 403, "An agent cannot claim or manage agents. Sign in with your own account.");
    }
    if (writeSource !== "browser") {
      throw new ApplicationError("FORBIDDEN", 403, "Claim and manage agents in the browser.");
    }
    return user;
  }

  async function claimable(code: unknown, humanId: string): Promise<{ readonly agent: StoredAgent; readonly claimed: boolean }> {
    const claim = typeof code === "string" ? pending.get(code) : undefined;
    const at = now();
    if (!claim || claim.expiresAt + EXPIRED_CODE_ANSWERED_FOR_MS <= at) throw invalidCode();
    if (claim.expiresAt <= at) {
      throw new ApplicationError("AGENT_CLAIM_EXPIRED", 410, "This claim link has expired. Ask the agent for a new one.");
    }
    const [agent] = await repository.findAgents({ userId: claim.agentUserId });
    if (agent?.ownerUserId === humanId) return { agent, claimed: true };
    if (!agent || agent.banned) throw invalidCode();
    if (agent.ownerUserId !== null) throw alreadyClaimed();
    return { agent, claimed: false };
  }

  return {
    async createCode(cookieHeader) {
      const { user } = await identity.requireSession(cookieHeader);
      if (user.kind !== "agent") {
        throw new ApplicationError("FORBIDDEN", 403, "Only an agent can ask to be claimed.");
      }
      if (user.claimed) throw alreadyClaimed();
      if (sweep(user.id) >= CLAIM_CODE_CAPACITY) {
        throw new ApplicationError("AGENT_CLAIM_UNAVAILABLE", 503, "Claim links are temporarily unavailable. Try again shortly.");
      }
      const code = randomBytes(16).toString("base64url");
      pending.set(code, { agentUserId: user.id, expiresAt: now() + CLAIM_CODE_TTL_MS });
      return { code, claimUrl: `/claim/${code}`, expiresIn: CLAIM_CODE_TTL_MS / 1000 };
    },

    async inspect(cookieHeader, code) {
      const human = await requireHuman(cookieHeader);
      const { agent, claimed } = await claimable(code, human.id);
      return { agent: agentView(agent), claimed };
    },

    async claim(cookieHeader, code) {
      const human = await requireHuman(cookieHeader);
      const { agent, claimed } = await claimable(code, human.id);
      if (!claimed && !(await repository.claimAgent(agent.user.id, human.id, now()))) throw alreadyClaimed();
      return { agent: agentView(agent) };
    },

    async list(cookieHeader) {
      const human = await requireHuman(cookieHeader);
      return { agents: (await repository.findAgents({ ownerUserId: human.id })).map(agentView) };
    },

    async stop(cookieHeader, agentUserId) {
      const human = await requireHuman(cookieHeader);
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
  return new ApplicationError("AGENT_CLAIM_INVALID", 404, "This claim link is not valid. Ask the agent for a new one.");
}

function alreadyClaimed(): ApplicationError {
  return new ApplicationError("AGENT_ALREADY_CLAIMED", 409, "This agent has already been claimed.");
}
