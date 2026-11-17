import { Command } from "commander";
import {
  createClaimLink,
  SHARE_LINKS,
  shareNode,
  type WorkspaceClaimLink,
  type WorkspaceShare,
  type WorkspaceShareLink,
  type WorkspaceSpaceFeature,
} from "@univerjs/univer-workspace-client-core/product";
import { emit, executeCommand, jsonFieldsOption, oneOf, type JsonFieldsOption } from "../../command.js";

export const SHARE_JSON_FIELDS = ["claimHint", "claimUrl", "expiresAt", "link", "name", "owner", "url"] as const satisfies
  readonly (keyof WorkspaceShare)[];

export const CLAIM_JSON_FIELDS = ["claimUrl", "expiresAt"] as const satisfies readonly (keyof WorkspaceClaimLink)[];

const LINK_TEXT: Readonly<Record<WorkspaceShareLink, string>> = {
  off: "off. Only people with access to the repository can open the link.",
  viewer: "viewer. Anyone with the link can read.",
  editor: "editor. Anyone with the link can read, and signed-in people can edit.",
};

export function createShareCommand(spaces: WorkspaceSpaceFeature, origin: () => Promise<string>): Command {
  const share = new Command("share")
    .description("Show a file's link and its Link Sharing, or set it with --link")
    .argument("<target>", "file link or Node ID")
    .option("--link <state>", `set Link Sharing: ${SHARE_LINKS.join(", ")}`)
    .addOption(jsonFieldsOption(SHARE_JSON_FIELDS))
    .action(async (target: string, options: JsonFieldsOption & { readonly link?: string }) => {
      const shared = await executeCommand(share, async () =>
        await shareNode(spaces, await origin(), {
          node: target,
          ...(options.link === undefined ? {} : { link: oneOf(options.link, SHARE_LINKS, "--link") }),
        }));
      emit(
        share,
        options,
        shared,
        [
          `${shared.name}  ${shared.url}`,
          `Link Sharing: ${LINK_TEXT[shared.link]}`,
          ...(shared.link === "off" || shared.expiresAt === undefined
            ? []
            : [`The link stops working on ${shared.expiresAt} unless ${shared.owner.username} stays active.`]),
          ...(shared.claimUrl === undefined ? [] : [`Claim link: ${shared.claimUrl}`]),
          ...(shared.claimHint === undefined ? [] : [shared.claimHint]),
        ].join("\n"),
      );
    });
  return share;
}

export function createClaimCommand(spaces: WorkspaceSpaceFeature, origin: () => Promise<string>): Command {
  const claim = new Command("claim")
    .description("Make a link that lets a person claim this guest agent and keep its files")
    .addOption(jsonFieldsOption(CLAIM_JSON_FIELDS))
    .action(async (options: JsonFieldsOption) => {
      const link = await executeCommand(claim, async () => await createClaimLink(spaces, await origin()));
      emit(
        claim,
        options,
        link,
        [
          `Claim link: ${link.claimUrl}`,
          "Give it to the user. Signing in and opening it within 10 minutes lets them claim this agent and keep its files.",
        ].join("\n"),
      );
    });
  return claim;
}
