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
export const agentReferenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("space"), spaceId: z.string().min(1), label: z.string() }),
  z.object({ kind: z.literal("issue"), spaceId: z.string().min(1), repository: z.string(), number: z.number().int().positive(), label: z.string() }),
  z.object({ kind: z.literal("pr"), spaceId: z.string().min(1), repository: z.string(), number: z.number().int().positive(), label: z.string() }),
]);
export type AgentReference = z.infer<typeof agentReferenceSchema>;
export function agentReferenceKey(reference: AgentReference): string {
  return JSON.stringify([reference.kind, reference.spaceId, reference.kind === "space" ? null : reference.number]);
}
export function agentReferenceLabel(reference: AgentReference): string {
  return reference.kind === "space" ? reference.label : `#${reference.number} ${reference.label}`;
}
const referenceMetadataSchema = z.object({ agentReferences: z.array(agentReferenceSchema) });
export function messageReferences(metadata: UIMessage["metadata"]): AgentReference[] {
  const parsed = referenceMetadataSchema.safeParse(metadata);
  return parsed.success ? parsed.data.agentReferences : [];
}
export const skillEntrySchema = z.object({
  name: z.string(), description: z.string(), source: z.enum(["repository", "user"]),
  path: z.string().optional(), modelInvocable: z.boolean(), userInvocable: z.boolean(),
  argumentHint: z.string().optional(),
});
export type SkillEntry = z.infer<typeof skillEntrySchema>;
export const skillDiagnosticSchema = z.object({
  source: z.enum(["repository", "user"]), path: z.string(),
  problem: z.enum(["invalid-skill", "reserved-name", "shadowed", "too-large"]),
  detail: z.string().optional(),
});
export type SkillDiagnostic = z.infer<typeof skillDiagnosticSchema>;
export const repositorySkillsSchema = z.enum(["loaded", "not-member", "no-repository"]);
export type RepositorySkills = z.infer<typeof repositorySkillsSchema>;
export const skillCatalogSchema = z.object({
  skills: z.array(skillEntrySchema), diagnostics: z.array(skillDiagnosticSchema), repository: repositorySkillsSchema,
});
export type SkillCatalog = z.infer<typeof skillCatalogSchema>;
const skillsMetadataSchema = z.object({ agentSkills: skillCatalogSchema });
export function messageSkills(metadata: UIMessage["metadata"]): SkillCatalog | null {
  const parsed = skillsMetadataSchema.safeParse(metadata);
  return parsed.success ? parsed.data.agentSkills : null;
}
export function splitReferenceText(text: string, references: readonly AgentReference[]): (string | AgentReference)[] {
  const tokens = new Map(references.map((reference) => [agentReferenceToken(reference), reference]));
  if (!tokens.size) return [text];
  const pattern = [...tokens.keys()].sort((a, b) => b.length - a.length).map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return text.split(new RegExp(`(${pattern})`, "g")).filter(Boolean).map((part) => tokens.get(part) ?? part);
}
export function agentReferenceToken(reference: AgentReference): string {
  return reference.kind === "space" ? `@${reference.label}` : `@${reference.repository}#${reference.number}`;
}
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
  const message = session.messages.find((item) => item.role === "user");
  if (!message) return "";
  const text = message.parts.filter((part) => !isSystemReminder(part)).filter((part) => part.type === "text").map((part) => part.text).join("");
  return splitReferenceText(text, messageReferences(message.metadata)).map((part) => typeof part === "string" ? part : agentReferenceLabel(part)).join("");
}
