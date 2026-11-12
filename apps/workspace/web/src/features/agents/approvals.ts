import type { UIMessage } from "ai";
import { z } from "zod";
import type { AgentSession } from "./agent.types";

export type ApprovalAction =
  | { kind: "create"; name: string; spaceId: string; parentNodeId?: string; html: string | null }
  | { kind: "replace"; resourceId: string; html: string; etag: string }
  | { kind: "other"; input: unknown };
export interface PendingApproval {
  readonly approvalId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly action: ApprovalAction;
}
const createInput = z.object({ name: z.string(), space: z.string(), parent: z.string().optional(), html: z.string().optional(), html_upload_id: z.string().optional() })
  .refine((input) => input.html !== undefined || input.html_upload_id !== undefined);
const replaceInput = z.object({ resource: z.string(), html: z.string(), etag: z.string() });

// Tool names enrich presentation only; scope metadata owns approval and credentials.
export function describeApproval(toolName: string, input: unknown): ApprovalAction {
  if (toolName === "html_view_create") {
    const parsed = createInput.safeParse(input);
    if (parsed.success) return { kind: "create", name: parsed.data.name, spaceId: parsed.data.space,
      ...(parsed.data.parent ? { parentNodeId: parsed.data.parent } : {}), html: parsed.data.html ?? null };
  }
  if (toolName === "html_view_replace") {
    const parsed = replaceInput.safeParse(input);
    if (parsed.success) return { kind: "replace", resourceId: parsed.data.resource, html: parsed.data.html, etag: parsed.data.etag };
  }
  return { kind: "other", input };
}

export function pendingApprovals(session: Pick<AgentSession, "messages" | "status">): PendingApproval[] {
  if (session.status === "running") return [];
  const message = session.messages.at(-1);
  if (message?.role !== "assistant") return [];
  return message.parts.flatMap((part) => {
    if (!("toolCallId" in part) || part.state !== "approval-requested") return [];
    const toolName = part.type === "dynamic-tool" ? part.toolName : part.type.slice(5);
    return [{ approvalId: part.approval.id, toolCallId: part.toolCallId, toolName, action: describeApproval(toolName, part.input) }];
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
