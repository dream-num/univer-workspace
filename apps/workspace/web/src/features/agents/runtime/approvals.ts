import { isToolUIPart } from "ai";
import type { ToolLoopAgentSettings, ToolSet, UIMessage } from "ai";
import { z } from "zod";
import type { AgentMode } from "../agent.types";
import { INTERRUPTED_TOOL } from "./messages";

export const SUPERSEDED_APPROVAL = "The user sent a new message instead of approving; follow that message.";
const scopeMetadata = z.object({ _meta: z.object({ "univer.workspace/scope": z.string() }) });

type AgentToolApproval = Extract<ToolLoopAgentSettings<never, ToolSet>["toolApproval"], (...args: never[]) => unknown>;

export function gateTools(tools: ToolSet, mode: AgentMode,
  callWithPublish: (name: string, input: unknown, signal?: AbortSignal) => Promise<unknown>,
  userOnlySkills: ReadonlySet<string> = new Set(),
): { tools: ToolSet; toolApproval: AgentToolApproval } {
  const scopes = new Map(Object.entries(tools).map(([name, tool]) => {
    const parsed = scopeMetadata.safeParse(tool);
    return [name, parsed.success ? parsed.data._meta["univer.workspace/scope"] : undefined];
  }));
  const gated: ToolSet = {};
  for (const [name, tool] of Object.entries(tools)) {
    if (scopes.get(name) !== "publish" || mode !== "auto") { gated[name] = tool; continue; }
    const approvedTool = { ...tool };
    approvedTool.execute = (input: unknown, options) => callWithPublish(name, input, options.abortSignal);
    gated[name] = approvedTool;
  }
  return {
    tools: gated,
    toolApproval: ({ toolCall }) => {
      const input = z.object({ name: z.string(), resource: z.string().optional() }).safeParse(toolCall.input);
      if (toolCall.toolName === "skills_read" && input.success && input.data.resource === undefined && userOnlySkills.has(input.data.name)) {
        return { type: "denied", reason: `The skill "${input.data.name}" can only be invoked by the user with /${input.data.name}.` };
      }
      switch (scopes.get(toolCall.toolName)) {
        case "publish": return mode === "ask"
          ? { type: "denied", reason: "Ask mode is read-only; ask the user to switch to Auto to publish." }
          : "user-approval";
        case "worktree:merge": return { type: "denied", reason: "The browser Agent cannot merge pull requests. A person must review and merge." };
        default: return "not-applicable";
      }
    },
  };
}

export type ApprovalSettlement =
  | { kind: "decide"; approvalId: string; approved: boolean }
  | { kind: "user-message" };

export function settleApprovals(messages: UIMessage[], settlement: ApprovalSettlement): UIMessage[] {
  let changed = false;
  const settled = messages.map((message) => {
    if (message.role !== "assistant") return message;
    const parts = message.parts.map((part) => {
      if (!isToolUIPart(part)) return part;
      if (part.state === "approval-requested") {
        if (settlement.kind === "decide" && part.approval.id !== settlement.approvalId) return part;
        changed = true;
        return settlement.kind === "decide"
          ? { ...part, state: "approval-responded" as const, approval: { ...part.approval, approved: settlement.approved } }
          : { ...part, state: "output-denied" as const, approval: { ...part.approval, approved: false as const, reason: SUPERSEDED_APPROVAL } };
      }
      if (part.state === "approval-responded" && settlement.kind === "user-message") {
        changed = true;
        if (!part.approval.approved) return { ...part, state: "output-denied" as const, approval: { ...part.approval, approved: false as const } };
        const { approval: _approval, ...rest } = part;
        return { ...rest, state: "output-error" as const, errorText: INTERRUPTED_TOOL };
      }
      return part;
    });
    return { ...message, parts };
  });
  return changed ? settled : messages;
}

export function appendUserMessage(messages: UIMessage[], message: UIMessage): UIMessage[] {
  return [...settleApprovals(messages, { kind: "user-message" }), message];
}
