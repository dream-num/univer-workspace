import type { UIMessage } from "ai";
import { z } from "zod";

export const agentSessionIdSchema = z.string().min(1).brand<"AgentSessionId">();
export const providerIdSchema = z.string().min(1).brand<"ProviderId">();
export type AgentSessionId = z.infer<typeof agentSessionIdSchema>;
export type ProviderId = z.infer<typeof providerIdSchema>;
export const scopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("global") }),
  z.object({ kind: z.literal("repository"), spaceId: z.string().min(1), baseWorktreeId: z.string().nullable() }),
]);
export type AgentScope = z.infer<typeof scopeSchema>;
export type AgentMode = "ask" | "auto";
export type DeepSeekThinking = "off" | "high" | "max";
export const modelSchema = z.object({
  providerId: providerIdSchema,
  modelId: z.string().min(1),
  thinking: z.enum(["off", "high", "max"]).nullable(),
});
export const providerConfigSchema = z.object({
  id: providerIdSchema,
  kind: z.enum(["deepseek", "openai-compatible"]),
  label: z.string().min(1),
  baseURL: z.url(),
  models: z.array(z.string().min(1)).min(1),
  defaultModel: z.string().min(1),
}).refine((config) => config.models.includes(config.defaultModel), "Default model must be in models");
export type ProviderConfig = z.infer<typeof providerConfigSchema>;
export type ProviderKind = ProviderConfig["kind"];
export type RunnableProvider = ProviderConfig & { apiKey: string };

const partSchema = z.object({ type: z.string().min(1) }).passthrough();
const messageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["user", "assistant", "system"]),
  parts: z.array(partSchema),
}).passthrough();
const cacheStepUsageSchema = z.object({ inputTokens: z.number().int().nonnegative(), cacheReadTokens: z.number().int().nonnegative() });
export const sessionRecordSchema = z.object({
  id: agentSessionIdSchema,
  userId: z.string().min(1),
  scope: scopeSchema,
  mode: z.enum(["ask", "auto"]),
  model: modelSchema,
  status: z.enum(["running", "idle", "interrupted", "stopped", "failed"]),
  worktreeIds: z.array(z.string().min(1)),
  toolTimings: z.record(z.string(), z.object({
    startedAt: z.iso.datetime(),
    endedAt: z.iso.datetime().nullable(),
  })).default({}),
  cacheUsage: cacheStepUsageSchema.extend({ lastStep: cacheStepUsageSchema.nullable() })
    .default({ inputTokens: 0, cacheReadTokens: 0, lastStep: null }),
  messages: z.array(messageSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  error: z.string().nullable(),
});
export type AgentSessionStatus = z.infer<typeof sessionRecordSchema>["status"];
export type AgentSession = Omit<z.infer<typeof sessionRecordSchema>, "messages"> & { messages: UIMessage[] };
export type AgentSettings = Pick<AgentSession, "scope" | "mode" | "model">;
export const SYSTEM_REMINDER_START = "<system-reminder>";
export function isSystemReminder(part: UIMessage["parts"][number]): boolean {
  return part.type === "text" && part.text.trimStart().startsWith(SYSTEM_REMINDER_START);
}
export type AgentEvent = "send" | "finish" | "stop" | "fail" | "interrupt";
export const statusTransitions: Record<AgentSessionStatus, Partial<Record<AgentEvent, AgentSessionStatus>>> = {
  running: { finish: "idle", stop: "stopped", fail: "failed", interrupt: "interrupted" },
  idle: { send: "running" },
  interrupted: { send: "running" },
  stopped: { send: "running" },
  failed: { send: "running" },
};
export function transition(status: AgentSessionStatus, event: AgentEvent): AgentSessionStatus {
  const next = statusTransitions[status][event];
  if (!next) throw new Error(`Invalid agent transition: ${status} / ${event}`);
  return next;
}
export function sessionLockName(id: AgentSessionId): string {
  return `univer-workspace-agent-session:${id}`;
}
export function sessionTitle(session: AgentSession): string {
  return session.messages.find((message) => message.role === "user")?.parts
    .filter((part) => !isSystemReminder(part)).filter((part) => part.type === "text").map((part) => part.text).join("") ?? "";
}
