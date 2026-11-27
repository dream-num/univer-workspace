import { sessionIdentity } from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import { readOnlyAnnotations, toolPrincipal, type AgentOwner, type ToolContext, type ToolDefinition } from "../definition.js";

const budgetUse = z.object({ used: z.number().int(), limit: z.number().int() });
const whoamiOutput = z.object({
  origin: z.string(),
  subject: z.object({ id: z.string(), name: z.string() }),
  budget: z.object({ openWorktrees: budgetUse, merges: budgetUse }).optional(),
});

export const TEMPORARY_AGENT_NOTICE =
  "You are a temporary agent. When you are done, use claim to get a handoff link for the user, who can open it to see your work and sign in to take it.";

export function ownedAgentNotice(owner: AgentOwner | undefined): string {
  return `${owner ? `${owner.name} (@${owner.username}) owns this agent and` : "The person who claimed this agent"} can open everything it owns, so to show them a repository or file, give them its link. You cannot let anyone else see one yourself: the server answers such a call with a confirm link, which you give to the user.`;
}

export const PULL_REQUEST_LINK_AFTER_MERGE = "Then give the user the pull request link.";

// Some clients never give the model the server instructions, so an agent's whoami repeats, in the instructions' words, what it must tell the user and how it finishes.
const finish = {
  agent_unclaimed: "Nobody else reviews or merges in your own Personal Space and repositories, so once a result there is verified, mark its pull request ready with pr_ready and merge it with pr_merge.",
  agent_claimed: "Once the result is verified, mark the pull request ready with pr_ready. If the person who claimed this agent asked to review the work, or the change needs a person's decision, give them the pull request link and stop there; they merge it in the browser. Otherwise, merge it with pr_merge.",
} as const;
const leaveMerging =
  "Only mark the pull request ready with pr_ready when the user explicitly says the work is finished or requests review. Otherwise, leave the verified changes in draft. Give the user the pull request link so they can review it. Leave merging and discarding to the user in the browser, unless they explicitly ask you to do it.";

function agentNotice(context: ToolContext): string | undefined {
  const principal = toolPrincipal(context.user);
  if (principal === "human") return undefined;
  const handsOver = principal === "agent_unclaimed" && context.scopes.has("publish");
  const notice = [
    principal === "agent_claimed" ? ownedAgentNotice(context.owner) : handsOver ? TEMPORARY_AGENT_NOTICE : undefined,
    context.scopes.has("worktree:merge")
      ? handsOver ? finish[principal] : `${finish[principal]} ${PULL_REQUEST_LINK_AFTER_MERGE}`
      : context.scopes.has("write") ? leaveMerging : undefined,
  ].filter((part) => part !== undefined);
  return notice.length ? notice.join(" ") : undefined;
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
    const notice = agentNotice(context);
    return { output: { origin: context.identityOrigin, subject: { id, name }, ...(context.owner ? { owner: context.owner } : {}), ...(budget ? { budget } : {}), ...(notice ? { notice } : {}) }, repo: null };
  },
};

const agentWhoamiOutput = whoamiOutput.extend({ notice: z.string().optional() });
const callFirst = "Call it before your first reply; notice says what to tell the user and how to finish your pull requests.";

export const unclaimedAgentWhoamiTool: ToolDefinition = {
  ...whoamiTool,
  principals: ["agent_unclaimed"],
  description: `${whoamiTool.description} ${callFirst}`,
  outputSchema: agentWhoamiOutput,
};

export const claimedAgentWhoamiTool: ToolDefinition = {
  ...whoamiTool,
  principals: ["agent_claimed"],
  description: `${whoamiTool.description} owner is the person who claimed this agent. ${callFirst}`,
  outputSchema: agentWhoamiOutput.extend({ owner: z.object({ username: z.string(), name: z.string() }).optional() }),
};
