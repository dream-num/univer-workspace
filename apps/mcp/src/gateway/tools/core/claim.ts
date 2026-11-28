import { createClaimLink, resolveClaimTarget, workspaceError } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { writeAnnotations, type ToolDefinition } from "../definition.js";
import { spaceFeature } from "./pr-support.js";

const inputSchema = z.object({
  node: z.string().min(1).optional().describe("Optional file link (<origin>/nodes/<nodeId>) or Node ID to open directly from the handoff link."),
  immersive: z.boolean().optional().describe("Open the targeted node in immersive view. Defaults to true for .univer.html pages."),
});

export const claimTool: ToolDefinition = {
  name: "claim",
  toolset: "core",
  principals: ["agent_unclaimed"],
  scope: "publish",
  title: "Hand your work to the user",
  description:
    "Make your handoff link and give the returned claimUrl to the user. Pass optional node (a file link or Node ID) and optional immersive (defaults to true for .univer.html pages) to land the user directly on the finished file or HTML View. They open it to see everything you own without signing in, private repositories included, and sign in there to take you. Then your files are theirs to open and edit, and you gain no access to their files. The link works for 7 days, or until a person takes you. Call claim once and give the same link again; call it again only when the link is lost or has expired.",
  inputSchema,
  outputSchema: z.object({ claimUrl: z.url(), expiresAt: z.string() }),
  annotations: writeAnnotations,
  async run(context, args) {
    const parsed = inputSchema.parse(args);
    if (parsed.immersive !== undefined && parsed.node === undefined) {
      throw workspaceError("workspace-argument-invalid", "immersive requires node.");
    }
    const spaces = spaceFeature(context);
    if (parsed.node !== undefined) {
      const to = await resolveClaimTarget(spaces, context.identityOrigin, {
        node: parsed.node,
        ...(parsed.immersive === undefined ? {} : { immersive: parsed.immersive }),
      });
      return { output: await createClaimLink(spaces, context.identityOrigin, { to }), repo: null };
    }
    return { output: await createClaimLink(spaces, context.identityOrigin), repo: null };
  },
};
