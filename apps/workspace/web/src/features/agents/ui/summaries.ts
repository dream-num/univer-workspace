import type { UIMessage } from "ai";
import { z } from "zod";
import { sessionTitle, type AgentSession } from "../agent.types";

export function summarize(value: unknown): string {
  if (value === undefined || value === null) return "—";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}
const recordSchema = z.record(z.string(), z.unknown());
function record(value: unknown) {
  const parsed = recordSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
function oneLine(text: string, limit: number): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}
function shortText(value: unknown, depth = 0): string {
  if (typeof value === "string") {
    if (/^[{\[]/.test(value.trim())) {
      try { const parsed: unknown = JSON.parse(value); return shortText(parsed, depth + 1); } catch { return value; }
    }
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (depth > 4) return "";
  if (Array.isArray(value)) return value.slice(0, 3).map((item) => shortText(item, depth + 1)).filter(Boolean).join(" · ");
  const data = record(value);
  if (!data) return "";
  if (typeof data.code === "string") return [data.code, shortText(data.message, depth + 1)].filter(Boolean).join(": ");
  for (const field of ["title", "name", "summary", "message", "text", "value", "result", "output", "status"]) {
    const text = shortText(data[field], depth + 1);
    if (text) return text;
  }
  for (const field of ["repos", "nodes", "items", "results", "content", "values", "rows", "data"]) {
    const text = shortText(data[field], depth + 1);
    if (text) return text;
  }
  return Object.entries(data).filter(([, value]) => typeof value === "number")
    .slice(0, 3).map(([key, value]) => `${key}: ${value}`).join(" · ");
}
export function argumentSummary(value: unknown): string {
  const data = record(value);
  if (!data) return oneLine(shortText(value), 80);
  const fields = ["repo", "query", "title", "name", "unit", "unitId", "range", "target", "file"];
  const parts = fields.flatMap((key) => {
    const text = shortText(data[key]);
    return text ? [`${key}: ${text}`] : [];
  });
  return oneLine(parts.length ? parts.join(" · ") : shortText(value), 80);
}
export function resultSummary(value: unknown, fallback = "—", input?: unknown): string {
  const content = value && typeof value === "object" && "structuredContent" in value ? value.structuredContent : value;
  const data = record(content);
  const error = record(data?.error) ?? data;
  if (typeof error?.code === "string") return oneLine([error.code, shortText(error.message)].filter(Boolean).join(": "), 160);
  if (data && typeof data.number === "number") {
    const args = record(input);
    return oneLine([`#${data.number}`, shortText(data.title ?? data.name ?? args?.title ?? args?.name)].filter(Boolean).join(" "), 160);
  }
  return oneLine(shortText(content) || fallback, 160);
}
export function durationLabel(startedAt: string, endedAt: string | null): string {
  if (!endedAt) return "—";
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return "—";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}
export function cacheHitRate(usage: AgentSession["cacheUsage"]["lastStep"] | undefined): string {
  return usage && usage.inputTokens > 0 ? `${Math.round(usage.cacheReadTokens / usage.inputTokens * 100)}%` : "—";
}
const linkSchema = z.object({ url: z.url() });
export function pullRequestUrl(value: unknown, origin: string): string | null {
  const content = value && typeof value === "object" && "structuredContent" in value ? value.structuredContent : value;
  const parsed = linkSchema.safeParse(content);
  if (!parsed.success) return null;
  const url = new URL(parsed.data.url);
  return ["https:", "http:"].includes(url.protocol) && url.origin === origin && /^\/spaces\/[^/]+\/pulls\/[1-9]\d*$/.test(url.pathname) ? url.href : null;
}

export function newestSessions(sessions: AgentSession[], spaceId?: string) {
  return sessions.filter((session) => !spaceId || session.scope.kind === "repository" && session.scope.spaceId === spaceId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function visibleSessions(sessions: AgentSession[], q: string, language: string) {
  const term = q.trim().toLocaleLowerCase(language);
  return newestSessions(sessions).filter((session) => sessionTitle(session).toLocaleLowerCase(language).includes(term));
}

export type ToolPart = Extract<UIMessage["parts"][number], { toolCallId: string }>;
export type StepPart = Extract<UIMessage["parts"][number], { type: "reasoning" }> | ToolPart;
type MessageBlock = { kind: "text"; part: Extract<UIMessage["parts"][number], { type: "text" }> } | { kind: "steps"; parts: StepPart[] };
export function messageBlocks(parts: UIMessage["parts"]): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  for (const part of parts) {
    if (part.type === "text" && part.text.trim()) blocks.push({ kind: "text", part });
    else if (part.type === "reasoning" || "toolCallId" in part) {
      const previous = blocks.at(-1);
      if (previous?.kind === "steps") previous.parts.push(part);
      else blocks.push({ kind: "steps", parts: [part] });
    }
  }
  return blocks;
}
export function toolStatus(part: ToolPart, status: AgentSession["status"]): "failed" | "completed" | "running" | "incomplete" {
  const output = "output" in part ? part.output : undefined;
  if (part.state === "output-error" || part.state === "output-denied" || Boolean(output && typeof output === "object" && "isError" in output && output.isError)) return "failed";
  if (part.state === "output-available") return "completed";
  return status === "running" ? "running" : "incomplete";
}
