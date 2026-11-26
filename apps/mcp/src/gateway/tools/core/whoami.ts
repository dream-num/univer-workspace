import { sessionIdentity } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { readOnlyAnnotations, toolPrincipal, type ToolContext, type ToolDefinition, type ToolPrincipal } from "../definition.js";

const budgetUse = z.object({ used: z.number().int(), limit: z.number().int() });
const whoamiOutput = z.object({
  origin: z.string(),
  subject: z.object({ id: z.string(), name: z.string() }),
  budget: z.object({ openWorktrees: budgetUse, merges: budgetUse }).optional(),
});

/** An unclaimed agent reached over OAuth came from a browser sign-in with no Workspace session; a PAT's agent made itself. */
export function guestAgentNotice(principal: ToolPrincipal, authKind: ToolContext["authKind"]): string | undefined {
  return principal === "agent_unclaimed" && authKind === "oauth"
    ? "This connection is a guest agent, which Workspace created because the browser had no Workspace session. A user who has a Workspace account and meant to connect under it should sign in to Workspace in that browser and reconnect the client. Otherwise the user can keep this agent by claiming it with claim."
    : undefined;
}

export const whoamiTool: ToolDefinition = {
  name: "whoami",
  toolset: "core",
  principals: ["human", "agent_claimed"],
  scope: "read",
  title: "Current user",
  description:
    "Show the Workspace origin and authenticated user. For an agent, budget shows what it has used of two limits. openWorktrees counts its open pull requests; at the limit, merge or discard one before you open another. merges counts the merges it started in the last 24 hours; at the limit, merge again once the oldest is 24 hours old. Past either limit the server answers AGENT_QUOTA_EXCEEDED.",
  inputSchema: z.object({}),
  outputSchema: whoamiOutput,
  annotations: readOnlyAnnotations,
  async run(context) {
    const { id, name } = context.user;
    const budget = context.user.kind === "agent" ? (await sessionIdentity(context.http)).budget : undefined;
    const notice = guestAgentNotice(toolPrincipal(context.user), context.authKind);
    return { output: { origin: context.identityOrigin, subject: { id, name }, ...(budget ? { budget } : {}), ...(notice ? { notice } : {}) }, repo: null };
  },
};

export const unclaimedAgentWhoamiTool: ToolDefinition = {
  ...whoamiTool,
  principals: ["agent_unclaimed"],
  outputSchema: whoamiOutput.extend({ notice: z.string().optional() }),
};
