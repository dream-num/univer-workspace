import { sessionIdentity } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { readOnlyAnnotations, toolPrincipal, type AgentOwner, type ToolContext, type ToolDefinition, type ToolPrincipal } from "../definition.js";

const budgetUse = z.object({ used: z.number().int(), limit: z.number().int() });
const whoamiOutput = z.object({
  origin: z.string(),
  subject: z.object({ id: z.string(), name: z.string() }),
  budget: z.object({ openWorktrees: budgetUse, merges: budgetUse }).optional(),
});

/** An unclaimed agent reached over OAuth came from a browser sign-in with no Workspace session; a PAT's agent made itself. */
export function guestAgentNotice(principal: ToolPrincipal, authKind: ToolContext["authKind"], claimable: boolean): string | undefined {
  return principal === "agent_unclaimed" && authKind === "oauth"
    ? `This connection is a guest agent, which Workspace created because the browser had no Workspace session. A user who has a Workspace account and meant to connect under it should sign in to Workspace in that browser and reconnect the client. Otherwise the user can keep this agent by claiming it${claimable ? " with claim" : ""}.`
    : undefined;
}

/** A person who meant to connect as themselves may have taken the consent page's default, a new agent they own. */
export function ownedAgentNotice(owner: AgentOwner | undefined): string {
  return `This agent belongs to ${owner ? `${owner.name} (@${owner.username})` : "the person who claimed it"} and works in its own Personal Space. It sees their files only when they are shared with it; when one of their files is not found, tell the user why. To let this client act as them, they reconnect it and choose to connect as themselves.`;
}

export const whoamiTool: ToolDefinition = {
  name: "whoami",
  toolset: "core",
  principals: ["human"],
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
    const notice = guestAgentNotice(toolPrincipal(context.user), context.authKind, context.scopes.has("publish"));
    return { output: { origin: context.identityOrigin, subject: { id, name }, ...(context.owner ? { owner: context.owner } : {}), ...(budget ? { budget } : {}), ...(notice ? { notice } : {}) }, repo: null };
  },
};

export const unclaimedAgentWhoamiTool: ToolDefinition = {
  ...whoamiTool,
  principals: ["agent_unclaimed"],
  outputSchema: whoamiOutput.extend({ notice: z.string().optional() }),
};

export const claimedAgentWhoamiTool: ToolDefinition = {
  ...whoamiTool,
  principals: ["agent_claimed"],
  description: `${whoamiTool.description} owner is the person who claimed this agent.`,
  outputSchema: whoamiOutput.extend({ owner: z.object({ username: z.string(), name: z.string() }).optional() }),
};
