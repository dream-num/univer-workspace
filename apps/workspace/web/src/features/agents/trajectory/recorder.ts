import type { ToolLoopAgentSettings, ToolSet } from "ai";
import type { AgentSessionId } from "../agent.types";
import { encodeRequest } from "./record";
import type { ModelCallRecord } from "./record";
import type { TrajectoryStore } from "./store";

interface SessionRecording { seq: number; body: string | null; writes: Promise<void>; runs: number; lost: boolean }
// Runs can finish before debug storage does; keep one sequence and write chain per session.
const recordings = new WeakMap<TrajectoryStore, Map<AgentSessionId, SessionRecording>>();

type Callbacks = Pick<ToolLoopAgentSettings<never, ToolSet>, "onStepStart" | "onLanguageModelCallStart" | "onLanguageModelCallEnd" | "onStepError" | "onAbort" | "onToolExecutionStart" | "onToolExecutionEnd">;
export function createCallRecorder({ sessionId, store, redact, previous, fetch: request, onToolExecutionStart, onToolExecutionEnd }: {
  sessionId: AgentSessionId;
  store: TrajectoryStore;
  redact(body: string): string;
  previous: { seq: number; body: string } | null | undefined;
  fetch: typeof fetch;
  onToolExecutionStart: NonNullable<Callbacks["onToolExecutionStart"]>;
  onToolExecutionEnd: NonNullable<Callbacks["onToolExecutionEnd"]>;
}) {
  const sessions = recordings.get(store) ?? new Map<AgentSessionId, SessionRecording>();
  recordings.set(store, sessions);
  const state = sessions.get(sessionId) ?? (previous === undefined ? null : { seq: -1, body: null, writes: Promise.resolve(), runs: 0, lost: false });
  if (state) {
    sessions.set(sessionId, state);
    state.runs++;
    if (previous && previous.seq > state.seq) { state.seq = previous.seq; state.body = previous.body; }
  }
  let current: ModelCallRecord | undefined;
  let capture: { body: string | null; raw: boolean } = { body: null, raw: false };
  let reads: Promise<void>[] = [];
  const now = () => new Date().toISOString();
  function write(record: ModelCallRecord, pending: Promise<void>[] = []) {
    if (!state) return;
    const saved = structuredClone(record);
    const captured = capture;
    const body = captured.body;
    state.writes = state.writes.then(async () => {
      await Promise.all(pending);
      if (pending.length) saved.attempts = structuredClone(record.attempts);
      if (body !== null && saved.request.kind === "delta" && (state.lost || captured.raw)) {
        saved.request = { kind: "raw", body };
        captured.raw = true;
      }
      await store.put(saved);
      // A placeholder cannot repair a missing request, and a raw checkpoint must stay raw on later updates.
      if (body !== null) state.lost = false;
    }).catch((error: unknown) => { state.lost = true; console.error("Failed to record agent model request", error); });
  }
  function end(outcome: ModelCallRecord["outcome"]) {
    if (!current || current.outcome.kind !== "running") return;
    current.endedAt = now();
    current.outcome = outcome;
    const attempt = current.attempts.at(-1);
    if (attempt && attempt.endedAt === null) attempt.endedAt = current.endedAt;
    write(current, reads);
  }
  const callbacks = {
    onStepStart({ callId }: { callId: string }) {
      if (!state) return;
      reads = [];
      capture = { body: null, raw: false };
      current = { sessionId, seq: ++state.seq, runId: callId, startedAt: now(), endedAt: null,
        outcome: { kind: "running" }, attempts: [], request: { kind: "raw", body: "" }, response: null, usage: null, performance: null };
      write(current);
    },
    onLanguageModelCallStart() {
      current?.attempts.push({ startedAt: now(), endedAt: null, status: null });
    },
    onLanguageModelCallEnd({ usage, performance, finishReason, content }) {
      if (!current) return;
      current.response = JSON.parse(redact(JSON.stringify(content)));
      current.usage = { inputTokens: usage.inputTokens ?? 0, cacheReadTokens: usage.inputTokenDetails.cacheReadTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0, reasoningTokens: usage.outputTokenDetails.reasoningTokens ?? 0 };
      current.performance = { responseTimeMs: performance.responseTimeMs, timeToFirstOutputMs: performance.timeToFirstOutputMs ?? null };
      end({ kind: "ok", finishReason });
    },
    onStepError({ error }: { error: unknown }) { end({ kind: "error", message: redact(error instanceof Error ? error.message : String(error)) }); },
    onAbort() { end({ kind: "aborted" }); },
    onToolExecutionStart,
    onToolExecutionEnd,
  } satisfies Callbacks;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const record = current;
    const attempt = record?.attempts.at(-1);
    if (state && record && record.attempts.length === 1 && typeof init?.body === "string") {
      const body = redact(init.body);
      capture.body = body;
      record.request = encodeRequest(state.body, body);
      state.body = body;
      write(record);
    }
    try {
      const response = await request(input, init);
      if (attempt) {
        attempt.status = response.status;
        if (!response.ok) {
          attempt.endedAt = now();
          const copy = response.clone();
          reads.push((async () => {
            const reader = copy.body?.getReader();
            if (!reader) { attempt.errorBody = ""; return; }
            const decoder = new TextDecoder();
            let size = 0;
            let body = "";
            try {
              while (size < 65536) {
                const { value, done } = await reader.read();
                if (done) break;
                const bytes = value.subarray(0, 65536 - size);
                size += bytes.length;
                body += decoder.decode(bytes, { stream: true });
              }
              attempt.errorBody = redact(body + decoder.decode());
            } finally { void reader.cancel().catch(() => undefined); }
          })().catch((error: unknown) => { console.error("Failed to read agent model error response", error); }));
        }
      }
      return response;
    } catch (error) {
      if (attempt) attempt.endedAt = now();
      throw error;
    }
  };
  return { fetch, callbacks, finish() {
    if (current?.outcome.kind === "running") end({ kind: "aborted" });
    if (!state) return;
    state.runs--;
    const pending = state.writes;
    void pending.then(() => { if (!state.lost && state.runs === 0 && state.writes === pending) sessions.delete(sessionId); });
  } };
}
