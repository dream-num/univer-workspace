import { createClaimLink } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { writeAnnotations, type ToolDefinition } from "../definition.js";
import { spaceFeature } from "./pr-support.js";

export const claimTool: ToolDefinition = {
  name: "claim",
  toolset: "core",
  principals: ["agent_unclaimed"],
  scope: "publish",
  title: "Hand your work to the user",
  description:
    "Make your handoff link and give the returned claimUrl to the user. They open it to see everything you own without signing in, private repositories included, and sign in there to take you. Then your files are theirs to open and edit, and you gain no access to their files. The link works for 7 days, or until a person takes you. Call claim once and give the same link again; call it again only when the link is lost or has expired.",
  inputSchema: z.object({}),
  outputSchema: z.object({ claimUrl: z.url(), expiresAt: z.string() }),
  annotations: writeAnnotations,
  async run(context) {
    return { output: await createClaimLink(spaceFeature(context), context.identityOrigin), repo: null };
  },
};
