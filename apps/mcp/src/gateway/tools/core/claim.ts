import { createClaimLink } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { writeAnnotations, type ToolDefinition } from "../definition.js";
import { spaceFeature } from "./pr-support.js";
import { shareOutputSchema, shareTool } from "./share.js";

export const claimTool: ToolDefinition = {
  name: "claim",
  toolset: "core",
  principals: ["agent_unclaimed"],
  scope: "publish",
  title: "Let the user claim this agent",
  description:
    "For an unclaimed agent only, make a link the user opens to claim you. Claiming keeps your files and their links working for good and lets the user open and manage them, private repositories included; you gain no access to the user's files. Give the returned claimUrl to the user. It works once, within 10 minutes, so call claim again when the user needs a new one.",
  inputSchema: z.object({}),
  outputSchema: z.object({ claimUrl: z.url(), expiresAt: z.string() }),
  annotations: writeAnnotations,
  async run(context) {
    return { output: await createClaimLink(spaceFeature(context), context.identityOrigin), repo: null };
  },
};

export const unclaimedAgentShareTool: ToolDefinition = {
  ...shareTool,
  principals: ["agent_unclaimed"],
  outputSchema: shareOutputSchema.extend({ claimUrl: z.url().optional(), claimHint: z.string().optional() }),
};
