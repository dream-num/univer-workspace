import { Command } from "commander";
import {
  createClaimLink,
  formatShare,
  resolveClaimTarget,
  SHARE_LINKS,
  shareNode,
  workspaceError,
  type WorkspaceClaimLink,
  type WorkspaceShare,
  type WorkspaceSpaceFeature,
  type WorkspaceSubject,
} from "@univerjs/univer-workspace-client-core/product";
import { emit, executeCommand, jsonFieldsOption, oneOf, type JsonFieldsOption } from "../../command.js";

export const SHARE_JSON_FIELDS = ["access", "expiresAt", "link", "name", "owner", "url"] as const satisfies
  readonly (keyof WorkspaceShare)[];

export const CLAIM_JSON_FIELDS = ["claimUrl", "expiresAt"] as const satisfies readonly (keyof WorkspaceClaimLink)[];

export function createShareCommand(
  spaces: WorkspaceSpaceFeature,
  origin: () => Promise<string>,
  caller: () => Promise<WorkspaceSubject>,
): Command {
  const share = new Command("share")
    .description("Show a file's link and its Link Sharing, or set it with --link")
    .argument("<target>", "file link or Node ID")
    .option("--link <state>", `set Link Sharing: ${SHARE_LINKS.join(", ")}`)
    .addOption(jsonFieldsOption(SHARE_JSON_FIELDS))
    .action(async (target: string, options: JsonFieldsOption & { readonly link?: string }) => {
      const shared = await executeCommand(share, async () => {
        const link = options.link === undefined ? undefined : oneOf(options.link, SHARE_LINKS, "--link");
        return await shareNode(spaces, await origin(), {
          node: target,
          ...(link === undefined ? {} : { link }),
          caller: await caller(),
          turnOn: `run \`uvw share ${target} --link viewer\``,
        });
      });
      emit(share, options, shared, formatShare(shared));
    });
  return share;
}

export function createClaimCommand(spaces: WorkspaceSpaceFeature, origin: () => Promise<string>): Command {
  const claim = new Command("claim")
    .description("Make this guest agent's handoff link: a person opens it to see the agent's work, and signs in to take the agent")
    .option("--node <target>", "file link or Node ID to open directly from the handoff link")
    .option("--immersive", "open the targeted node in immersive view")
    .addOption(jsonFieldsOption(CLAIM_JSON_FIELDS))
    .action(async (options: JsonFieldsOption & { readonly node?: string; readonly immersive?: boolean }) => {
      const link = await executeCommand(claim, async () => {
        if (options.immersive && options.node === undefined) {
          throw workspaceError("workspace-argument-invalid", "--immersive requires --node.");
        }
        const baseOrigin = await origin();
        if (options.node !== undefined) {
          const to = await resolveClaimTarget(spaces, baseOrigin, {
            node: options.node,
            ...(options.immersive ? { immersive: true } : {}),
          });
          return await createClaimLink(spaces, baseOrigin, { to });
        }
        return await createClaimLink(spaces, baseOrigin);
      });
      emit(
        claim,
        options,
        link,
        [
          `Handoff link: ${link.claimUrl}`,
          "Give it to the user. They open it to see everything this agent owns without signing in, and sign in there to take the agent and keep its files. The link works for 7 days.",
        ].join("\n"),
      );
    });
  return claim;
}
