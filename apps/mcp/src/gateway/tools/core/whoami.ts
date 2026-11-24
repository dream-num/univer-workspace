import { sessionIdentity } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { readOnlyAnnotations, type ToolDefinition } from "../definition.js";

const budgetUse = z.object({ used: z.number().int(), limit: z.number().int() });

export const whoamiTool: ToolDefinition = {
  name: "whoami",
  toolset: "core",
  scope: "read",
  title: "Current user",
  description:
    "Show the Workspace origin and authenticated user. For an agent, budget shows what it has used of two limits. openWorktrees counts its open pull requests; at the limit, merge or discard one before you open another. merges counts the merges it started in the last 24 hours; at the limit, merge again once the oldest is 24 hours old. Past either limit the server answers AGENT_QUOTA_EXCEEDED.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    origin: z.string(),
    subject: z.object({ id: z.string(), name: z.string() }),
    budget: z.object({ openWorktrees: budgetUse, merges: budgetUse }).optional(),
  }),
  annotations: readOnlyAnnotations,
  async run(context) {
    const { id, name } = context.user;
    const budget = context.user.kind === "agent" ? (await sessionIdentity(context.http)).budget : undefined;
    return { output: { origin: context.identityOrigin, subject: { id, name }, ...(budget ? { budget } : {}) }, repo: null };
  },
};
