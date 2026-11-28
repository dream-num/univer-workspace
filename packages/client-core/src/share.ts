import { isHtmlViewFilename } from "@univerjs-labs/html-view";
import type { WorkspaceSubject } from "./auth.js";
import { WorkspaceApplicationError, workspaceError } from "./errors.js";
import { resolveNodeReference } from "./repo-ref.js";
import type { WorkspaceSpaceFeature } from "./space.js";
import type { WorkspaceLinkSharing, WorkspaceSpace } from "./space-model.js";
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
  /** Set when the owner is an unclaimed agent: its links stop working when it expires, on that date. */
  readonly expiresAt?: string;
  /** Who can open `url` now, and while `link` is off, how the caller shows the file to someone else. */
  readonly access: string;
}

export interface WorkspaceClaimLink {
  readonly claimUrl: string;
  readonly expiresAt: string;
}

export interface CreateClaimLinkOptions {
  readonly to?: string;
}

export async function createClaimLink(
  spaces: Pick<WorkspaceSpaceFeature, "createAgentClaimCode">,
  origin: string,
  options?: CreateClaimLinkOptions,
): Promise<WorkspaceClaimLink> {
  if (options?.to !== undefined) validateClaimTarget(options.to, origin);
  const { claimUrl, expiresIn } = await spaces.createAgentClaimCode();
  const url = new URL(claimUrl, origin);
  if (options?.to !== undefined) url.searchParams.set("to", options.to);
  return {
    claimUrl: url.toString(),
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}

export async function resolveClaimTarget(
  spaces: Pick<WorkspaceSpaceFeature, "getNode">,
  origin: string,
  input: { readonly node: string; readonly immersive?: boolean },
): Promise<string> {
  const resolved = await resolveNodeReference(spaces, input.node, origin);
  const trimmed = input.node.trim();
  const urlImmersive =
    /^https?:\/\//i.test(trimmed) && new URL(trimmed).searchParams.get("view") === "immersive";
  const useImmersive =
    input.immersive === true ||
    (input.immersive === undefined && (urlImmersive || isHtmlViewFilename(resolved.name)));
  return `/nodes/${encodeURIComponent(resolved.nodeId)}${useImmersive ? "?view=immersive" : ""}`;
}

function validateClaimTarget(to: string, origin: string): void {
  const invalid = () =>
    workspaceError("workspace-argument-invalid", "Claim target must be a /nodes/ or /spaces/ path.");
  if (!to.startsWith("/nodes/") && !to.startsWith("/spaces/")) throw invalid();
  let target: URL;
  let baseOrigin: string;
  try {
    baseOrigin = new URL(origin).origin;
    target = new URL(to, origin);
  } catch {
    throw invalid();
  }
  if (
    target.origin !== baseOrigin ||
    target.username !== "" ||
    target.password !== "" ||
    (!target.pathname.startsWith("/nodes/") && !target.pathname.startsWith("/spaces/"))
  ) {
    throw invalid();
  }
}

/** Reads the Link Sharing of a file, named by its link or Node ID, and sets it first when `link` is given. */
export async function shareNode(
  spaces: Pick<WorkspaceSpaceFeature, "get" | "getNode" | "getLinkSharing" | "updateLinkSharing">,
  origin: string,
  input: {
    readonly node: string;
    readonly link?: WorkspaceShareLink;
    /** Who this session signs in as. An agent takes the next step itself; a person's client waits for the user to ask. */
    readonly caller: WorkspaceSubject;
    /** What this session does to let anyone with the link read the file, such as "run `uvw share <file> --link viewer`". */
    readonly turnOn: string;
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
    if (error.code === "NOT_FOUND") {
      // Someone else's Personal Space can hide from the caller, so a failed lookup keeps the server's own refusal.
      const space = await spaces.get(spaceId).catch((lookup: unknown) => {
        if (lookup instanceof WorkspaceApplicationError) return null;
        throw lookup;
      });
      if (space?.type === "team") throw teamSpaceRefusal(url, name, space);
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
  };
}

// The owner and the caller differ when a person reads the file of an agent they claimed.
function describeAccess(
  link: WorkspaceShareLink,
  { owner }: WorkspaceLinkSharing,
  folder: boolean,
  caller: WorkspaceSubject,
  turnOn: string,
): string {
  if (link !== "off") {
    const target = folder ? "the folder and everything in it" : "the file";
    return link === "viewer"
      ? `Anyone with the link can read ${target} without signing in.`
      : `Anyone with the link can read ${target}, and signed-in people can edit ${folder ? "them" : "it"}. Through the link, an agent can edit only after a person claims that agent.`;
  }
  // The server refuses an unclaimed agent Link Sharing.
  if (owner.claimed === false) {
    return "Only this agent can open the link. To show the file to the user, give them your handoff link from claim (uvw claim in the CLI).";
  }
  const next = caller.kind === "agent"
    ? `To let anyone with the link read it, ${turnOn}.`
    : `Only if the user asks, ${turnOn} to let anyone with the link read it.`;
  return `Only people with access to the repository can open the link. ${next}`;
}

/** The share as the lines a client prints. */
export function formatShare(shared: WorkspaceShare): string {
  return [
    `${shared.name}  ${shared.url}`,
    `Link Sharing: ${shared.link}. ${shared.access}`,
  ].join("\n");
}

function teamSpaceRefusal(url: string, name: string, space: WorkspaceSpace): WorkspaceApplicationError {
  return workspaceError(
    "workspace-argument-invalid",
    `Link Sharing works only for files in a Personal Space, and "${name}" is in the repository ${space.fullName ?? space.name}. To let more people open it, add them as members with repo_member_write (uvw repo member add in the CLI), or make the repository public with repo_edit (uvw repo edit --visibility public in the CLI). Either one needs the user, and the server's answer says what to give them.`,
    { url },
  );
}
