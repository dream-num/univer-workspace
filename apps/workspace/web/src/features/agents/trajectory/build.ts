import { z } from "zod";
import type { AgentSession } from "../agent.types";
import type { expandRequests, ModelCallRecord } from "./record";

const contentPart = z.object({ type: z.string(), text: z.string().optional() }).passthrough();
export const wireMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.union([z.string(), z.array(contentPart), z.null()]).optional(),
  reasoning_content: z.string().optional(),
  tool_call_id: z.string().optional(),
  tool_calls: z.array(z.object({ id: z.string(), function: z.object({ name: z.string(), arguments: z.string() }).passthrough() }).passthrough()).optional(),
}).passthrough();
const requestSchema = z.object({ messages: z.array(wireMessageSchema), tools: z.array(z.unknown()).optional() }).passthrough();
const responsePartSchema = z.object({ type: z.string(), text: z.string().optional(), toolCallId: z.string().optional(), toolName: z.string().optional(), input: z.unknown().optional() }).passthrough();
export type WireMessage = z.infer<typeof wireMessageSchema>;
export type ExpandedRequest = ReturnType<typeof expandRequests>[number];
export type ReminderSource = "catalog" | "invocation" | "references" | "settings" | "drafts" | "reminder";
export interface ReminderSpan { part: number | null; start: number; end: number; source: ReminderSource }
const reminderSources: { source: ReminderSource; pattern: RegExp }[] = [
  { source: "catalog", pattern: /Skills available in this session/ },
  { source: "invocation", pattern: /The user invoked/ },
  { source: "references", pattern: /The user attached these references/ },
  { source: "settings", pattern: /The user changed the session settings/ },
  { source: "drafts", pattern: /^Draft ".+".*(?:pending|open|ready|merged|closed|draft|published|rejected|expired|conflicted|failed)/m },
];
export function messageText(message: WireMessage): string {
  return typeof message.content === "string" ? message.content : message.content?.map((part) => part.text ?? "").join("") ?? "";
}
export function reminderSpans(message: WireMessage): ReminderSpan[] {
  const parts = typeof message.content === "string" ? [{ text: message.content, part: null }] :
    (message.content ?? []).map((part, index) => ({ text: part.text ?? "", part: index }));
  return parts.flatMap(({ text, part }) => [...text.matchAll(/<system-reminder>\n(?:(?!<system-reminder>)[\s\S])*?<\/system-reminder>/g)].map((match) => ({
    part, start: match.index, end: match.index + match[0].length,
    source: reminderSources.find(({ pattern }) => pattern.test(match[0].slice("<system-reminder>".length, -"</system-reminder>".length)))?.source ?? "reminder",
  })));
}
export type UserStep = { kind: "user"; step: number; message: WireMessage; reminders: ReminderSpan[]; sentAt: number; firstSeq: number };
export type AssistantStep = { kind: "assistant"; step: number; seq: number; call: ModelCallRecord; response: unknown[] | null; replay: WireMessage | null; replayMismatch: boolean; request: ExpandedRequest; messages: WireMessage[] | null; tools: unknown[]; newFrom: number; previousMessageCount: number; rewrite: boolean; paramsChanged: boolean; unparsed: boolean };
export type ToolStep = { kind: "tool"; step: number; parentStep: number; toolCallId: string; name: string; arguments: unknown; message: WireMessage | null; mcpOutput: unknown; status: "ok" | "error" | "denied" | "running" | "unsent"; startedAt: number | null; endedAt: number | null };
export type Step = UserStep | AssistantStep | ToolStep;
export interface Turn { index: number; startedAt: number; endedAt: number; steps: Step[] }
export interface Trajectory {
  system: { message: WireMessage; tools: unknown[]; params: Record<string, unknown> } | null;
  turns: Turn[];
  stats: { calls: number; toolCalls: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; errors: number; rewrites: number; paramsChanged: number; skippedRecords: number };
  unrecorded: boolean;
}
function searchValues(value: unknown): string[] {
  if (typeof value === "string") {
    let parsed: unknown;
    try { parsed = JSON.parse(value); } catch { return [value]; }
    return [value, ...searchValues(parsed)];
  }
  if (typeof value === "number") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(searchValues);
  return value !== null && typeof value === "object" ? Object.values(value).flatMap(searchValues) : [];
}
function messageSearchContent(message: WireMessage | null) {
  return message ? [typeof message.content === "string" ? message.content : message.content?.map((part) => part.text),
    message.reasoning_content, message.tool_calls?.map((call) => [call.function.name, call.function.arguments])] : [];
}
export function trajectorySearchText(row: Step | NonNullable<Trajectory["system"]>): string {
  const content = !("kind" in row) ? [messageSearchContent(row.message), row.tools, row.params] : row.kind === "user" ? messageSearchContent(row.message) :
    row.kind === "assistant" ? [responseParts(row.response).map((part) => [part.text, part.toolName, part.input]), messageSearchContent(row.replay)] :
      [row.name, messageSearchContent(row.message), row.arguments, row.mcpOutput];
  return searchValues(content).join("\n").toLocaleLowerCase();
}
export function createTrajectorySearchIndex(trajectory: Trajectory) {
  let index: { system: string; steps: Map<Step, string> } | undefined;
  return (term: string) => {
    if (!term.trim()) return null;
    return index ??= {
      system: trajectory.system ? trajectorySearchText(trajectory.system) : "",
      steps: new Map(trajectory.turns.flatMap((turn) => turn.steps.map((step) => [step, trajectorySearchText(step)] as const))),
    };
  };
}
export function waterfallScale(turn: Turn, now: number): number {
  const running = turn.steps.some((step) => step.kind === "assistant" && step.call.outcome.kind === "running" || step.kind === "tool" && step.status === "running");
  const duration = (running ? Math.max(turn.endedAt, now) : turn.endedAt) - turn.startedAt;
  return running ? Math.ceil(Math.max(1, duration) / 10000) * 10000 : duration;
}
export function contextMessageChange(step: Pick<AssistantStep, "newFrom" | "previousMessageCount" | "rewrite">, index: number): "new" | "rewritten" | null {
  if (index < step.newFrom) return null;
  return step.rewrite && index < step.previousMessageCount ? "rewritten" : "new";
}
function responseParts(response: unknown[] | null) {
  return (response ?? []).flatMap((part) => { const parsed = responsePartSchema.safeParse(part); return parsed.success ? [parsed.data] : []; });
}
export function responseText(response: unknown[] | null): string {
  const parts = responseParts(response);
  return parts.filter((part) => part.type === "text").map((part) => part.text ?? "").join("") ||
    parts.filter((part) => part.type === "reasoning").map((part) => part.text ?? "").join("");
}
function mismatch(step: AssistantStep, replay: WireMessage) {
  if (step.response === null) return false;
  const parts = responseParts(step.response);
  return parts.filter((part) => part.type === "text").map((part) => part.text ?? "").join("") !== messageText(replay) ||
    JSON.stringify(parts.filter((part) => part.type === "tool-call").map((part) => part.toolCallId)) !== JSON.stringify((replay.tool_calls ?? []).map((call) => call.id));
}
export function buildTrajectory(records: readonly ExpandedRequest[], session: Pick<AgentSession, "messages" | "toolTimings">, skippedRecords = 0): Trajectory {
  const trajectory: Trajectory = { system: null, turns: [], unrecorded: records.length === 0 && session.messages.length > 0,
    stats: { calls: records.length, toolCalls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, errors: 0, rewrites: 0, paramsChanged: 0, skippedRecords } };
  const tools = new Map<string, ToolStep>();
  const parts = new Map(session.messages.flatMap((message) => message.parts.flatMap((part) => "toolCallId" in part ? [[part.toolCallId, part] as const] : [])));
  let turn: Turn | undefined;
  let previous: { step: AssistantStep; turn: Turn } | undefined;
  function startTurn(at: number) {
    const next: Turn = { index: trajectory.turns.length + 1, startedAt: at, endedAt: at, steps: [] };
    trajectory.turns.push(next); return next;
  }
  function addTool(owner: Turn, parent: AssistantStep, call: { id: string; name: string; arguments: unknown }): ToolStep {
    const timing = session.toolTimings[call.id];
    const saved = parts.get(call.id);
    const output = saved && "output" in saved ? saved.output : undefined;
    const tool: ToolStep = { kind: "tool", step: owner.steps.length + 1, parentStep: parent.step, toolCallId: call.id,
      name: call.name, arguments: call.arguments, message: null,
      mcpOutput: output && typeof output === "object" && "structuredContent" in output ? output.structuredContent : undefined,
      status: timing && !timing.endedAt ? "running" : "unsent", startedAt: timing ? Date.parse(timing.startedAt) : null, endedAt: timing?.endedAt ? Date.parse(timing.endedAt) : null };
    owner.steps.push(tool); tools.set(tool.toolCallId, tool); trajectory.stats.toolCalls++;
    if (tool.endedAt !== null) owner.endedAt = Math.max(owner.endedAt, tool.endedAt);
    return tool;
  }
  for (const request of [...records].sort((a, b) => a.record.seq - b.record.seq)) {
    const call = request.record;
    const at = Date.parse(call.startedAt);
    const parsed = requestSchema.safeParse(request.request);
    const messages = parsed.success ? parsed.data.messages : null;
    if (trajectory.turns.length === 0 && parsed.success && messages?.[0]?.role === "system") {
      const { messages: _messages, tools: definitions, ...params } = parsed.data;
      trajectory.system = { message: messages[0], tools: definitions ?? [], params };
    }
    for (const message of messages?.slice(request.base) ?? []) {
      if (message.role === "user") {
        turn = startTurn(at);
        turn.steps.push({ kind: "user", step: 1, message, reminders: reminderSpans(message), sentAt: at, firstSeq: call.seq });
      } else if (message.role === "assistant" && previous) {
        previous.step.replay = message; previous.step.replayMismatch = mismatch(previous.step, message);
        for (const call of message.tool_calls ?? []) {
          let tool = tools.get(call.id);
          if (!tool) {
            tool = addTool(previous.turn, previous.step, { id: call.id, name: call.function.name, arguments: call.function.arguments });
            if (!parts.has(call.id)) tool.status = "error";
          }
          tool.arguments = call.function.arguments; tool.name = call.function.name;
        }
      } else if (message.role === "tool" && message.tool_call_id) {
        const tool = tools.get(message.tool_call_id);
        if (tool) {
          tool.message = message;
          const part = parts.get(tool.toolCallId);
          const output = part && "output" in part ? part.output : undefined;
          tool.status = !part && tool.status === "error" ? "error" : part?.state === "output-denied" ? "denied" : part?.state === "output-error" ||
            Boolean(output && typeof output === "object" && "isError" in output && output.isError) ? "error" : "ok";
        }
      }
    }
    turn ??= startTurn(at);
    const step: AssistantStep = { kind: "assistant", step: turn.steps.length + 1, seq: call.seq, call, response: call.response,
      replay: null, replayMismatch: false, request, messages, tools: parsed.success ? parsed.data.tools ?? [] : [], newFrom: request.base, previousMessageCount: previous?.step.request.request?.messages.length ?? 0, rewrite: request.rewrite, paramsChanged: request.paramsChanged, unparsed: !parsed.success };
    turn.steps.push(step); previous = { step, turn };
    if (messages && call.outcome.kind === "ok") for (const part of responseParts(call.response)) {
      if (part.type !== "tool-call" || !part.toolCallId || !part.toolName) continue;
      addTool(turn, step, { id: part.toolCallId, name: part.toolName, arguments: part.input });
    }
    turn.endedAt = Math.max(turn.endedAt, Date.parse(call.endedAt ?? call.startedAt), ...turn.steps.flatMap((item) => item.kind === "tool" && item.endedAt ? [item.endedAt] : []));
    trajectory.stats.inputTokens += call.usage?.inputTokens ?? 0;
    trajectory.stats.outputTokens += call.usage?.outputTokens ?? 0;
    trajectory.stats.cacheReadTokens += call.usage?.cacheReadTokens ?? 0;
    trajectory.stats.errors += Number(call.outcome.kind === "error" || call.outcome.kind === "aborted");
    trajectory.stats.rewrites += Number(request.rewrite);
    trajectory.stats.paramsChanged += Number(request.paramsChanged);
  }
  trajectory.stats.errors += [...tools.values()].filter((tool) => tool.status === "error" || tool.status === "denied").length;
  return trajectory;
}
