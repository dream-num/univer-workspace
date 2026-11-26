import { Command } from "commander";
import {
  createClaimLink,
  formatShare,
  SHARE_LINKS,
  shareNode,
  type WorkspaceClaimLink,
  type WorkspaceShare,
  type WorkspaceSpaceFeature,
  type WorkspaceSubject,
} from "@univerjs/univer-workspace-client-core/product";
import { emit, executeCommand, jsonFieldsOption, oneOf, type JsonFieldsOption } from "../../command.js";

export const SHARE_JSON_FIELDS = ["access", "claimHint", "expiresAt", "link", "name", "owner", "url"] as const satisfies
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
