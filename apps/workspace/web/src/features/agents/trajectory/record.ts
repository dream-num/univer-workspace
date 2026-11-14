import { z } from "zod";
import { agentSessionIdSchema } from "../agent.types";

export const requestDeltaSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("delta"), base: z.number().int().nonnegative(), messages: z.array(z.unknown()), rest: z.record(z.string(), z.unknown()).optional() }),
  z.object({ kind: z.literal("raw"), body: z.string() }),
]);
export type RequestDelta = z.infer<typeof requestDeltaSchema>;
export const modelCallRecordSchema = z.object({
  sessionId: agentSessionIdSchema, seq: z.number().int().nonnegative(), runId: z.string(),
  startedAt: z.string(), endedAt: z.string().nullable(),
  outcome: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("running") }),
    z.object({ kind: z.literal("ok"), finishReason: z.string() }),
    z.object({ kind: z.literal("error"), message: z.string() }),
    z.object({ kind: z.literal("aborted") }),
  ]),
  attempts: z.array(z.object({ startedAt: z.string(), endedAt: z.string().nullable(), status: z.number().int().nullable(), errorBody: z.string().optional() })),
  request: requestDeltaSchema, response: z.array(z.unknown()).nullable(),
  usage: z.object({ inputTokens: z.number(), cacheReadTokens: z.number(), outputTokens: z.number(), reasoningTokens: z.number() }).nullable(),
  performance: z.object({ responseTimeMs: z.number(), timeToFirstOutputMs: z.number().nullable() }).nullable(),
});
export type ModelCallRecord = z.infer<typeof modelCallRecordSchema>;
function parseRequest(body: string) {
  try {
    const parsed = z.record(z.string(), z.unknown()).safeParse(JSON.parse(body));
    if (!parsed.success || !Array.isArray(parsed.data.messages)) return null;
    return { ...parsed.data, messages: parsed.data.messages };
  } catch { return null; }
}
function restOf(request: NonNullable<ReturnType<typeof parseRequest>>) {
  return Object.fromEntries(Object.entries(request).filter(([key]) => key !== "messages"));
}
function expand(previous: ReturnType<typeof parseRequest>, delta: RequestDelta): string {
  if (delta.kind === "raw") return delta.body;
  const messages = [...(previous?.messages.slice(0, delta.base) ?? []), ...delta.messages];
  return JSON.stringify(delta.rest === undefined && previous ? { ...previous, messages } : { ...delta.rest, messages });
}
export function encodeRequest(previous: string | null, body: string): RequestDelta {
  const request = parseRequest(body);
  if (!request) return { kind: "raw", body };
  const prior = previous === null ? null : parseRequest(previous);
  let base = 0;
  while (prior && base < prior.messages.length && base < request.messages.length &&
    JSON.stringify(prior.messages[base]) === JSON.stringify(request.messages[base])) base++;
  const rest = restOf(request);
  const delta: RequestDelta = { kind: "delta", base, messages: request.messages.slice(base),
    ...(!prior || JSON.stringify(restOf(prior)) !== JSON.stringify(rest) ? { rest } : {}) };
  return expand(prior, delta) === body ? delta : { kind: "raw", body };
}
export function expandRequests(records: readonly ModelCallRecord[]) {
  let previous: ReturnType<typeof parseRequest> = null;
  return [...records].sort((a, b) => a.seq - b.seq).map((record) => {
    const body = expand(previous, record.request);
    const request = parseRequest(body);
    let base = 0;
    while (previous && request && base < previous.messages.length && base < request.messages.length &&
      JSON.stringify(previous.messages[base]) === JSON.stringify(request.messages[base])) base++;
    const result = { record, body, request, base, rewrite: previous !== null && base < previous.messages.length,
      paramsChanged: previous !== null && request !== null && JSON.stringify(restOf(previous)) !== JSON.stringify(restOf(request)) };
    previous = request;
    return result;
  });
}
