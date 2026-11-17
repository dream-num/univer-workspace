import { WorkspaceApplicationError, workspaceError } from "./errors.js";
import { resolveNodeReference } from "./repo-ref.js";
import type { WorkspaceSpaceFeature } from "./space.js";
import type { WorkspaceLinkSharing } from "./space-model.js";
import { nodeUrl } from "./urls.js";

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
  spaces: Pick<WorkspaceSpaceFeature, "getNode" | "getLinkSharing" | "updateLinkSharing" | "createAgentClaimCode">,
  origin: string,
  input: { readonly node: string; readonly link?: WorkspaceShareLink },
): Promise<WorkspaceShare> {
  const { nodeId, name } = await resolveNodeReference(spaces, input.node, origin);
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
  return {
    url,
    name,
    link: sharing.enabled ? sharing.role : "off",
    owner: sharing.owner,
    ...(sharing.expiresAt === null ? {} : { expiresAt: sharing.expiresAt }),
    ...(sharing.owner.claimed === false ? await claimFields(spaces, origin) : {}),
  };
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
