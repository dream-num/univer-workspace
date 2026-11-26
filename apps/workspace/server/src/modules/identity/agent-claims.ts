import { randomBytes } from "node:crypto";
import { ApplicationError } from "../../middleware/errors.js";
import type { IdentityRepository, StoredAgent } from "./identity.repository.js";
import type { IdentityModule } from "./identity.service.js";
import type { AgentClaimCode, AgentView } from "./identity.types.js";
import { hashSessionSecret } from "./session-token.js";

const CLAIM_CODE_TTL_MS = 10 * 60 * 1000;
const EXPIRED_CODE_ANSWERED_FOR_MS = CLAIM_CODE_TTL_MS;
const CLAIM_CODES_PER_AGENT = 10;
const CLAIM_CODE_CAPACITY = 10_000;

export interface AgentClaims {
  createCode(cookieHeader: string | undefined): Promise<AgentClaimCode>;
  inspect(cookieHeader: string | undefined, code: unknown): Promise<{ readonly agent: AgentView; readonly claimed: boolean }>;
  claim(cookieHeader: string | undefined, code: unknown): Promise<{ readonly agent: AgentView }>;
  list(cookieHeader: string | undefined): Promise<{ readonly agents: readonly AgentView[] }>;
  stop(cookieHeader: string | undefined, agentUserId: string): Promise<void>;
}

export function createAgentClaims(options: {
  readonly identity: Pick<IdentityModule, "requireSession" | "requireInteractiveSession">;
  readonly repository: Pick<IdentityRepository, "findAgents" | "claimAgent" | "banClaimedAgent" | "putSignInCode" | "findSignInCode">;
  readonly onAgentStopped: (agentUserId: string) => void;
  readonly now?: () => number;
}): AgentClaims {
  const { identity, repository } = options;
  const now = options.now ?? (() => Date.now());

  async function claimable(code: unknown, humanId: string): Promise<{ readonly agent: StoredAgent; readonly claimed: boolean }> {
    const claim = typeof code === "string" ? await repository.findSignInCode("claim", hashSessionSecret(code)) : null;
    const at = now();
    if (!claim || claim.expiresAt + EXPIRED_CODE_ANSWERED_FOR_MS <= at) throw invalidCode();
    if (claim.expiresAt <= at) {
      throw new ApplicationError("AGENT_CLAIM_EXPIRED", 410, "This claim link has expired. Ask the agent for a new one.");
    }
    const [agent] = await repository.findAgents({ userId: claim.subjectUserId! });
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
      const at = now();
      const code = randomBytes(16).toString("base64url");
      const stored = await repository.putSignInCode(
        { kind: "claim", codeHash: hashSessionSecret(code), userCodeHash: null, subjectUserId: user.id, payload: "{}", createdAt: at, expiresAt: at + CLAIM_CODE_TTL_MS },
        { expiredBefore: at - EXPIRED_CODE_ANSWERED_FOR_MS, perSubject: CLAIM_CODES_PER_AGENT, capacity: CLAIM_CODE_CAPACITY },
      );
      if (stored !== "stored") {
        throw new ApplicationError("AGENT_CLAIM_UNAVAILABLE", 503, "Claim links are temporarily unavailable. Try again shortly.");
      }
      return { code, claimUrl: `/claim/${code}`, expiresIn: CLAIM_CODE_TTL_MS / 1000 };
    },

    async inspect(cookieHeader, code) {
      const human = (await identity.requireInteractiveSession(cookieHeader)).user;
      const { agent, claimed } = await claimable(code, human.id);
      return { agent: agentView(agent), claimed };
    },

    async claim(cookieHeader, code) {
      const human = (await identity.requireInteractiveSession(cookieHeader)).user;
      const { agent, claimed } = await claimable(code, human.id);
      if (!claimed && !(await repository.claimAgent(agent.user.id, human.id, now()))) throw alreadyClaimed();
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
  return new ApplicationError("AGENT_CLAIM_INVALID", 404, "This claim link is not valid. Ask the agent for a new one.");
}

function alreadyClaimed(): ApplicationError {
  return new ApplicationError("AGENT_ALREADY_CLAIMED", 409, "This agent has already been claimed.");
}
