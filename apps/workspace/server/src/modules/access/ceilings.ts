import client from "prom-client";
import { ApplicationError, type ApplicationErrorCode } from "../../middleware/errors.js";
import type { PrincipalCategory } from "../identity/index.js";
import type { AccessRole } from "./access.types.js";

const UNCLAIMED_AGENT_MAX_FILES = 20;
const UNCLAIMED_AGENT_MAX_FILE_BYTES = 10 * 1024 * 1024;

/** What each action tells the ceilings about its target and its session. */
export interface CeilingContexts {
  readonly createTeamSpace: Readonly<Record<never, never>>;
  readonly updateSpace: { readonly publicRead: boolean };
  readonly addTeamMember: { readonly member: PrincipalCategory; readonly role: AccessRole };
  readonly searchUsers: Readonly<Record<never, never>>;
  /** `held` counts the files the principal's Personal Space already has or is about to get. */
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

// An agent identity costs nothing, so it gets no organisation-wide reach and, until a human claims
// it, a small storage budget. A human's token session reads all of that human's private files, so
// it may not publish one without the human present; an agent's token session reads only the agent's
// own Space, where the role check already confines it.
const ceilings: { readonly [A in CeilingAction]: Ceiling<A> } = {
  createTeamSpace: {
    code: "AGENT_NOT_ALLOWED",
    message: "An agent cannot create a Team Space.",
    forbids: isAgent,
  },
  updateSpace: {
    code: "AGENT_NOT_ALLOWED",
    message: "An agent cannot make a Space public.",
    forbids: (principal, { publicRead }) => isAgent(principal) && publicRead,
  },
  addTeamMember: {
    code: "AGENT_NOT_ALLOWED",
    message: "An unclaimed agent cannot be a Team Space member, and an agent cannot be an admin.",
    forbids: (_principal, { member, role }) => member === "agent_unclaimed" || (isAgent(member) && role === "admin"),
  },
  // Anyone can create an agent, so an unclaimed one must not read the User directory.
  searchUsers: {
    code: "AGENT_NOT_ALLOWED",
    message: "An unclaimed agent cannot search Users.",
    forbids: (principal) => principal === "agent_unclaimed",
  },
  createFiles: {
    code: "AGENT_QUOTA_EXCEEDED",
    message: `An unclaimed agent can keep at most ${UNCLAIMED_AGENT_MAX_FILES} files.`,
    forbids: (principal, { held, adding }) =>
      principal === "agent_unclaimed" && held + adding > UNCLAIMED_AGENT_MAX_FILES,
  },
  storeFile: {
    code: "AGENT_QUOTA_EXCEEDED",
    message: `An unclaimed agent can store files of at most ${UNCLAIMED_AGENT_MAX_FILE_BYTES} bytes.`,
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

/** Count held files only for principals subject to the file quota. */
export async function assertCreateFilesCeiling(
  principal: PrincipalCategory,
  context: { readonly held: () => Promise<number>; readonly adding: number },
): Promise<void> {
  if (principal === "agent_unclaimed") {
    assertCeiling(principal, "createFiles", { held: await context.held(), adding: context.adding });
  }
}
