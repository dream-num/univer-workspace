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
}

/** Reads the Link Sharing of a file, named by its link or Node ID, and sets it first when `link` is given. */
export async function shareNode(
  spaces: Pick<WorkspaceSpaceFeature, "getNode" | "getLinkSharing" | "updateLinkSharing">,
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
    if (!(error instanceof WorkspaceApplicationError) || error.code !== "INTERACTIVE_SESSION_REQUIRED") {
      throw error;
    }
    throw workspaceError(
      error.code,
      `This connection cannot change a person's Link Sharing. Ask the user to share the file in the browser: ${url}`,
      { url },
    );
  }
  return {
    url,
    name,
    link: sharing.enabled ? sharing.role : "off",
    owner: sharing.owner,
    ...(sharing.expiresAt === null ? {} : { expiresAt: sharing.expiresAt }),
  };
}
