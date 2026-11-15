import { Command } from "commander";
import {
  SHARE_LINKS,
  shareNode,
  type WorkspaceShare,
  type WorkspaceShareLink,
  type WorkspaceSpaceFeature,
} from "@univerjs/univer-workspace-client-core/product";
import { emit, executeCommand, jsonFieldsOption, oneOf, type JsonFieldsOption } from "../../command.js";

export const SHARE_JSON_FIELDS = ["expiresAt", "link", "name", "owner", "url"] as const satisfies
  readonly (keyof WorkspaceShare)[];

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
        ].join("\n"),
      );
    });
  return share;
}
