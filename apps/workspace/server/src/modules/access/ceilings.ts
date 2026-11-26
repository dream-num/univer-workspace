import client from "prom-client";
import { ApplicationError, type ApplicationErrorCode } from "../../middleware/errors.js";
import type { AgentBudget, PrincipalCategory } from "../identity/index.js";
import type { AccessRole, SpaceLanding } from "./access.types.js";

const UNCLAIMED_AGENT_MAX_FILES = 20;
const UNCLAIMED_AGENT_MAX_TEAM_SPACES = 3;
const UNCLAIMED_AGENT_MAX_FORKS = 3;
const UNCLAIMED_AGENT_MAX_FILE_BYTES = 10 * 1024 * 1024;
const NON_MEMBER_MAX_OPEN_PROPOSALS = 3;
// Phase 0 measured each active Worktree at about one worker. The merge count is a first estimate.
const AGENT_MAX_OPEN_WORKTREES = 10;
const AGENT_MAX_MERGES = 50;
export const AGENT_MERGE_WINDOW_MS = 24 * 60 * 60 * 1000;
// Every unclaimed-agent ceiling forbids only `agent_unclaimed`, so a claim lifts each of them.
const CLAIM_LIFTS = "or give a person a claim link so they can claim you, which lifts this limit.";

/** An agent's open Worktrees, those still being created included, the merges it started within the window, and what the action adds. */
export interface BudgetUse {
  readonly open: number;
  readonly merged: number;
  readonly adding: number;
}

/** What each action tells the ceilings about its target and its session. */
export interface CeilingContexts {
  /** `held` counts the Team Spaces the principal already owns. */
  readonly createTeamSpace: { readonly held: number };
  /** `held` counts the forks the principal already owns. */
  readonly createFork: { readonly held: number };
  /** `open` counts the principal's open proposals in a Team Space it is not a member of. */
  readonly openProposal: { readonly open: number };
  readonly openWorktree: BudgetUse;
  readonly mergeWorktree: BudgetUse;
  readonly updateSpace: { readonly publicRead: boolean };
  /** `landing` is the Space's setting; `owns` is whether the principal owns the Space. */
  readonly changeTrunk: { readonly landing: SpaceLanding; readonly owns: boolean };
  readonly changeLanding: { readonly owns: boolean };
  readonly addTeamMember: { readonly member: PrincipalCategory; readonly role: AccessRole; readonly owner: PrincipalCategory };
  readonly searchUsers: Readonly<Record<never, never>>;
  /** `held` counts the files the principal's Spaces already have or are about to get. */
  readonly createFiles: { readonly held: number; readonly adding: number };
  readonly storeFile: { readonly byteSize: number };
  /** `tokenIssued` is true for a session issued for a personal access token or an OAuth grant. */
  readonly writeLinkSharing: { readonly tokenIssued: boolean };
  readonly publishSpace: { readonly publicRead: boolean; readonly tokenIssued: boolean };
}

export type CeilingAction = keyof CeilingContexts;

interface Ceiling<A extends CeilingAction> {
  readonly code: ApplicationErrorCode;
  readonly message: string;
  forbids(principal: PrincipalCategory, context: CeilingContexts[A]): boolean;
}

const isAgent = (category: PrincipalCategory): boolean =>
  category === "agent_unclaimed" || category === "agent_claimed";

/** An agent that does not own a Space requiring checks lands its changes there only by such a merge. People are never gated. */
export function landsByChecks(principal: PrincipalCategory, { landing, owns }: CeilingContexts["changeTrunk"]): boolean {
  return isAgent(principal) && landing === "checks" && !owns;
}

// An agent identity costs nothing, so it gets no organisation-wide reach and, until a human claims
// it, a small storage budget and no one else in its Spaces. A human's token session reads all of
// that human's private files, so it may not publish one without the human present; an agent's token
// session reads only the agent's own Space, where the role check already confines it.
const ceilings: { readonly [A in CeilingAction]: Ceiling<A> } = {
  createTeamSpace: {
    code: "AGENT_QUOTA_EXCEEDED",
    message: `An unclaimed agent can own at most ${UNCLAIMED_AGENT_MAX_TEAM_SPACES} Team Spaces. Work in one you already own, ${CLAIM_LIFTS}`,
    forbids: (principal, { held }) => principal === "agent_unclaimed" && held >= UNCLAIMED_AGENT_MAX_TEAM_SPACES,
  },
  createFork: {
    code: "AGENT_QUOTA_EXCEEDED",
    message: `An unclaimed agent can own at most ${UNCLAIMED_AGENT_MAX_FORKS} forks. Delete a fork you no longer need, ${CLAIM_LIFTS}`,
    forbids: (principal, { held }) => principal === "agent_unclaimed" && held >= UNCLAIMED_AGENT_MAX_FORKS,
  },
  // A Space's `proposals` setting can admit readers who hold no role there, so it cannot vouch for their volume.
  openProposal: {
    code: "FORBIDDEN",
    message: `Someone who is not a Space Member can have at most ${NON_MEMBER_MAX_OPEN_PROPOSALS} open proposals in a Team Space.`,
    forbids: (_principal, { open }) => open >= NON_MEMBER_MAX_OPEN_PROPOSALS,
  },
  // No person watches an agent between the grant and the merge, so its volume needs a limit of its own.
  openWorktree: {
    code: "AGENT_QUOTA_EXCEEDED",
    message: `An agent can have at most ${AGENT_MAX_OPEN_WORKTREES} open pull requests. Merge or discard one before you open another.`,
    forbids: (principal, { open, adding }) => isAgent(principal) && open + adding > AGENT_MAX_OPEN_WORKTREES,
  },
  mergeWorktree: {
    code: "AGENT_QUOTA_EXCEEDED",
    message: `An agent can start at most ${AGENT_MAX_MERGES} merges in 24 hours. Merge again once the oldest of them is 24 hours old.`,
    forbids: (principal, { merged, adding }) => isAgent(principal) && merged + adding > AGENT_MAX_MERGES,
  },
  updateSpace: {
    code: "AGENT_NOT_ALLOWED",
    message: `An unclaimed agent cannot make a Space public. Keep it private, ${CLAIM_LIFTS} Claiming also lets that person open every Space you own.`,
    forbids: (principal, { publicRead }) => principal === "agent_unclaimed" && publicRead,
  },
  // Checks stand in for the person who reviews a merge, so the agents they gate get no other way onto Trunk.
  changeTrunk: {
    code: "AGENT_NOT_ALLOWED",
    message: "This repository requires checks, so an agent that does not own it changes its files only by merging a pull request whose declared checks all passed.",
    forbids: (principal, context) => landsByChecks(principal, context),
  },
  changeLanding: {
    code: "AGENT_NOT_ALLOWED",
    message: "Only a person or the agent that owns this repository can change whether it requires checks.",
    forbids: (principal, { owns }) => isAgent(principal) && !owns,
  },
  // A Team Space an agent owns reaches only the agent and its claimer, so an agent may be its admin.
  addTeamMember: {
    code: "AGENT_NOT_ALLOWED",
    message: "An unclaimed agent cannot add or be a Team Space member, and an agent can be an admin only of a Team Space an agent owns.",
    forbids: (principal, { member, role, owner }) =>
      principal === "agent_unclaimed" || member === "agent_unclaimed" || (isAgent(member) && role === "admin" && owner === "human"),
  },
  // Anyone can create an agent, so an unclaimed one must not read the User directory.
  searchUsers: {
    code: "AGENT_NOT_ALLOWED",
    message: `An unclaimed agent cannot search Users. Leave other Users out, ${CLAIM_LIFTS}`,
    forbids: (principal) => principal === "agent_unclaimed",
  },
  createFiles: {
    code: "AGENT_QUOTA_EXCEEDED",
    message: `An unclaimed agent can keep at most ${UNCLAIMED_AGENT_MAX_FILES} files across its Spaces, new files in its open pull requests included. Move files you no longer need to Trash, ${CLAIM_LIFTS}`,
    forbids: (principal, { held, adding }) =>
      principal === "agent_unclaimed" && held + adding > UNCLAIMED_AGENT_MAX_FILES,
  },
  storeFile: {
    code: "AGENT_QUOTA_EXCEEDED",
    message: `An unclaimed agent can store files of at most ${UNCLAIMED_AGENT_MAX_FILE_BYTES} bytes. Store a smaller file, ${CLAIM_LIFTS}`,
    forbids: (principal, { byteSize }) =>
      principal === "agent_unclaimed" && byteSize > UNCLAIMED_AGENT_MAX_FILE_BYTES,
  },
  writeLinkSharing: {
    code: "INTERACTIVE_SESSION_REQUIRED",
    message: "Changing Link Sharing requires an interactive sign-in, not a session issued for an access token.",
    forbids: (principal, { tokenIssued }) => principal === "human" && tokenIssued,
  },
  publishSpace: {
    code: "INTERACTIVE_SESSION_REQUIRED",
    message: "Making a Space public requires an interactive sign-in, not a session issued for an access token.",
    forbids: (principal, { publicRead, tokenIssued }) => publicRead && principal === "human" && tokenIssued,
  },
};

const denials = new client.Counter({
  name: "workspace_ceiling_denials_total",
  help: "Actions refused by a ceiling",
  labelNames: ["action", "code", "principal_category"],
});
// A series that starts at zero lets increase() count the first denial after a restart.
for (const [action, { code }] of Object.entries(ceilings)) {
  for (const category of ["human", "agent_claimed", "agent_unclaimed"] as const) {
    denials.inc({ action, code, principal_category: category }, 0);
  }
}

/**
 * The third layer of an access decision. Roles and capabilities say what a principal may do; a
 * ceiling names what it may not do whatever role it holds. A ceiling only forbids and never grants,
 * so every existing check stays in place beside it.
 */
export function assertCeiling<A extends CeilingAction>(
  principal: PrincipalCategory,
  action: A,
  context: CeilingContexts[A]
): void {
  const ceiling = ceilings[action];
  if (ceiling.forbids(principal, context)) {
    denials.inc({ action, code: ceiling.code, principal_category: principal });
    throw new ApplicationError(ceiling.code, 403, ceiling.message);
  }
}

/** An agent's budget as `whoami` shows it. */
export function agentBudget({ open, merged }: Pick<BudgetUse, "open" | "merged">): AgentBudget {
  return {
    openWorktrees: { used: open, limit: AGENT_MAX_OPEN_WORKTREES },
    merges: { used: merged, limit: AGENT_MAX_MERGES },
  };
}

/** Count held files only for principals subject to the file quota. */
export async function assertCreateFilesCeiling(
  principal: PrincipalCategory,
  context: { readonly held: () => Promise<number>; readonly adding: number },
): Promise<void> {
  if (principal === "agent_unclaimed") {
    assertCeiling(principal, "createFiles", { held: await context.held(), adding: context.adding });
  }
}
