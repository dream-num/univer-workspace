import type { WorkspaceSubject } from "./auth.js";
import { WorkspaceApplicationError, workspaceError } from "./errors.js";
import { resolveNodeReference } from "./repo-ref.js";
import type { WorkspaceSpaceFeature } from "./space.js";
import type { WorkspaceLinkSharing, WorkspaceSpace } from "./space-model.js";
import { nodeUrl, repoUrl } from "./urls.js";

export const SHARE_LINKS = ["off", "viewer", "editor"] as const;
/** Link Sharing as one setting: off, or the access a signed-in user gets through the link. */
export type WorkspaceShareLink = (typeof SHARE_LINKS)[number];

export interface WorkspaceShare {
  /** The file link. Anyone can open it while `link` is not off. */
  readonly url: string;
  readonly name: string;
  readonly link: WorkspaceShareLink;
  readonly owner: WorkspaceLinkSharing["owner"];
  /** Set when the link stops working on that date unless its owner, an unclaimed agent, stays active. */
  readonly expiresAt?: string;
  /** Who can open `url` now, and while `link` is off, how the caller lets anyone with the link read it. */
  readonly access: string;
  /** Set when the owner is an unclaimed agent: the page where a person claims it and keeps its files. */
  readonly claimUrl?: string;
  readonly claimHint?: string;
}

export interface WorkspaceClaimLink {
  readonly claimUrl: string;
  readonly expiresAt: string;
}

const CLAIM_HINT =
  "Give the claim link to the user so they can keep this file. It works once, within 10 minutes.";

export async function createClaimLink(
  spaces: Pick<WorkspaceSpaceFeature, "createAgentClaimCode">,
  origin: string,
): Promise<WorkspaceClaimLink> {
  const { claimUrl, expiresIn } = await spaces.createAgentClaimCode();
  return {
    claimUrl: new URL(claimUrl, origin).toString(),
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}

/** Reads the Link Sharing of a file, named by its link or Node ID, and sets it first when `link` is given. */
export async function shareNode(
  spaces: Pick<WorkspaceSpaceFeature, "get" | "getNode" | "getLinkSharing" | "updateLinkSharing" | "createAgentClaimCode">,
  origin: string,
  input: {
    readonly node: string;
    readonly link?: WorkspaceShareLink;
    /** Who this session signs in as. An agent takes the next step itself; a person's client waits for the user to ask. */
    readonly caller: WorkspaceSubject;
    /**
     * What this session does to let anyone with the link read the file, such as
     * "run `uvw share <file> --link viewer`". Omit it for a person's token session, which the
     * server does not let change Link Sharing.
     */
    readonly turnOn?: string;
  },
): Promise<WorkspaceShare> {
  const { nodeId, name, resource, spaceId } = await resolveNodeReference(spaces, input.node, origin);
  const url = nodeUrl(origin, nodeId);
  let sharing: WorkspaceLinkSharing;
  try {
    sharing =
      input.link === undefined
        ? await spaces.getLinkSharing(nodeId)
        : await spaces.updateLinkSharing(nodeId, {
            enabled: input.link !== "off",
            role: input.link === "editor" ? "editor" : "viewer",
          });
  } catch (error) {
    if (!(error instanceof WorkspaceApplicationError)) throw error;
    // Only Personal Space files have Link Sharing, in the Browser too. For a Team Space file the server answers NOT_FOUND,
    // or INTERACTIVE_SESSION_REQUIRED first when a person's token session writes.
    if (error.code === "NOT_FOUND" || error.code === "INTERACTIVE_SESSION_REQUIRED") {
      const space = await spaces.get(spaceId);
      if (space.type === "team") throw await teamSpaceRefusal(spaces, origin, url, name, space, input.caller, input.turnOn);
    }
    if (error.code === "INTERACTIVE_SESSION_REQUIRED") {
      throw workspaceError(
        error.code,
        `This connection cannot change a person's Link Sharing. Ask the user to share the file in the browser: ${url}`,
        { url },
      );
    }
    if (error.code === "FORBIDDEN") {
      throw workspaceError(
        error.code,
        `Only the owner of this file can read or change its Link Sharing. To read the file itself, pass its link as the Unit with trunk: ${url}`,
        { url },
      );
    }
    throw error;
  }
  const link = sharing.enabled ? sharing.role : "off";
  return {
    url,
    name,
    link,
    owner: sharing.owner,
    ...(sharing.expiresAt === null ? {} : { expiresAt: sharing.expiresAt }),
    access: describeAccess(link, sharing, resource === null, input.caller, input.turnOn),
    ...(sharing.owner.claimed === false ? await claimFields(spaces, origin) : {}),
  };
}

// The owner and the caller differ when a person reads the file of an agent they claimed.
function describeAccess(
  link: WorkspaceShareLink,
  { owner, expiresAt }: WorkspaceLinkSharing,
  folder: boolean,
  caller: WorkspaceSubject,
  turnOn: string | undefined,
): string {
  if (link !== "off") {
    const target = folder ? "the folder and everything in it" : "the file";
    const who = link === "viewer"
      ? `Anyone with the link can read ${target} without signing in.`
      : `Anyone with the link can read ${target}, and signed-in people can edit ${folder ? "them" : "it"}. Through the link, an agent can edit only after a person claims that agent.`;
    return expiresAt === null ? who : `${who} The link stops working on ${expiresAt} unless ${owner.username} stays active.`;
  }
  const who = owner.claimed === false
    ? "Only this agent can open the link until a person claims it."
    : "Only people with access to the repository can open the link.";
  const next = turnOn === undefined
    ? "If the user wants anyone with the link to read it, they can turn on Link Sharing for it in the browser."
    : caller.kind === "agent"
      ? `To let anyone with the link read it, ${turnOn}.`
      : `Only if the user asks, ${turnOn} to let anyone with the link read it.`;
  return `${who} ${next}`;
}

/** The share as the lines a client prints. */
export function formatShare(shared: WorkspaceShare): string {
  return [
    `${shared.name}  ${shared.url}`,
    `Link Sharing: ${shared.link}. ${shared.access}`,
    ...(shared.claimUrl === undefined ? [] : [`Claim link: ${shared.claimUrl}`]),
    ...(shared.claimHint === undefined ? [] : [shared.claimHint]),
  ].join("\n");
}

async function teamSpaceRefusal(
  spaces: Pick<WorkspaceSpaceFeature, "createAgentClaimCode">,
  origin: string,
  url: string,
  name: string,
  space: WorkspaceSpace,
  caller: WorkspaceSubject,
  turnOn: string | undefined,
): Promise<WorkspaceApplicationError> {
  const where = `Link Sharing works only for files in a Personal Space, and "${name}" is in the repository ${space.fullName ?? space.name}.`;
  if (caller.kind !== "agent" || caller.claimed) {
    // Only a person's token session omits turnOn, and the server does not let it make a Space public either.
    const publish = turnOn === undefined
      ? `ask the user to make the repository public in its settings in the browser: ${repoUrl(origin, space.id)}/settings`
      : "make the repository public with repo_edit (uvw repo edit --visibility public in the CLI).";
    return workspaceError(
      "workspace-argument-invalid",
      `${where} To let a person open it, add them as a member with repo_member_write (uvw repo member add in the CLI), or ${publish}`,
      { url },
    );
  }
  const claim = await claimFields(spaces, origin);
  const next = claim.claimUrl === undefined
    ? "make a claim link with claim (uvw claim in the CLI) and give it to the user."
    : `give the user this claim link, which works once within 10 minutes: ${claim.claimUrl}`;
  return workspaceError(
    "workspace-argument-invalid",
    `${where} A person can open your repositories once they claim you, so ${next}`,
    { url, ...claim },
  );
}

async function claimFields(
  spaces: Pick<WorkspaceSpaceFeature, "createAgentClaimCode">,
  origin: string,
): Promise<Pick<WorkspaceShare, "claimUrl" | "claimHint">> {
  try {
    return { claimUrl: (await createClaimLink(spaces, origin)).claimUrl, claimHint: CLAIM_HINT };
  } catch (error) {
    // A Workspace from before claiming has no claim codes; the share itself already happened.
    if (error instanceof WorkspaceApplicationError) return {};
    throw error;
  }
}
