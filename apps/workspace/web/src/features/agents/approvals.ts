import type { UIMessage } from "ai";
import type { AgentSession } from "./agent.types";

export type ApprovalAction = { kind: "other"; input: unknown };
export interface PendingApproval {
  readonly approvalId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly action: ApprovalAction;
}
export function describeApproval(input: unknown): ApprovalAction {
  return { kind: "other", input };
}

export function pendingApprovals(session: Pick<AgentSession, "messages" | "status">): PendingApproval[] {
  if (session.status === "running") return [];
  const message = session.messages.at(-1);
  if (message?.role !== "assistant") return [];
  return message.parts.flatMap((part) => {
    if (!("toolCallId" in part) || part.state !== "approval-requested") return [];
    const toolName = part.type === "dynamic-tool" ? part.toolName : part.type.slice(5);
    return [{ approvalId: part.approval.id, toolCallId: part.toolCallId, toolName, action: describeApproval(part.input) }];
  });
}

export function resumableApprovalResponse(messages: UIMessage[]) {
  const message = messages.at(-1);
  if (message?.role !== "assistant") return undefined;
  const lastStepStart = message.parts.map((part) => part.type).lastIndexOf("step-start");
  const tools = message.parts.slice(lastStepStart + 1).filter((part) => "toolCallId" in part);
  if (!tools.some((part) => part.state === "approval-responded") || !tools.every((part) =>
    (part.state === "output-available" && part.preliminary !== true) || part.state === "output-error" ||
    part.state === "output-denied" || part.state === "approval-responded")) return undefined;
  return message.parts.filter((part) => "toolCallId" in part).find((part) => part.state === "approval-responded")?.approval;
}
