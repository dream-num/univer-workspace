import { expect, it, vi } from "vitest";
import { session } from "../test-helpers";
import { expandRequests } from "./record";
import type { ModelCallRecord } from "./record";
import { createCallRecorder } from "./recorder";

it("passes fetch arguments and the Response unchanged while reading only a bounded error clone", async () => {
  const records: ModelCallRecord[] = [];
  const body = "x".repeat(65536) + "tail";
  const response = new Response(body, { status: 401 });
  const request = vi.fn<typeof fetch>(async () => response);
  const recorder = createCallRecorder({ sessionId: session().id,
    store: { async put(record) { records.push(record); }, async list() { return { records: [], skippedRecords: 0 }; } },
    redact: (value) => value, previous: null, fetch: request, onToolExecutionStart() {}, onToolExecutionEnd() {},
  });
  const input = new URL("https://provider.test/chat/completions");
  const init = { method: "POST", body: '{"messages":[]}', headers: { Authorization: "Bearer secret" } };
  recorder.callbacks.onStepStart({ callId: "run-1" });
  recorder.callbacks.onLanguageModelCallStart();
  const result = await recorder.fetch(input, init);
  expect(request.mock.calls[0]?.[0]).toBe(input);
  expect(request.mock.calls[0]?.[1]).toBe(init);
  expect(result).toBe(response);
  expect(result.bodyUsed).toBe(false);
  expect(await result.text()).toBe(body);
  recorder.finish();
  await vi.waitFor(() => expect(records).toHaveLength(3));
  expect(records.map((record) => record.outcome.kind)).toEqual(["running", "running", "aborted"]);
  expect(expandRequests([records[1]!])[0]?.body).toBe(init.body);
  expect(records[2]?.attempts[0]?.errorBody).toBe("x".repeat(65536));
  expect(expandRequests([records[2]!])[0]?.body).toBe(init.body);
});


it.each([
  { failure: "all", resume: false },
  { failure: "request", resume: false },
  { failure: "all", resume: true },
])("round2 preserves expansion after $failure writes fail (resume $resume)", async ({ failure, resume }) => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const saved = new Map<number, ModelCallRecord>();
  const bodies = [0, 1, 2].map((seq) => JSON.stringify({ model: "mock", messages: Array.from({ length: seq + 1 }, (_, index) => ({ role: "user", content: `message-${index}` })) }));
  const put = vi.fn(async (record: ModelCallRecord) => {
    if (record.seq === 1 && (failure === "all" || !(record.request.kind === "raw" && record.request.body === ""))) throw new Error("Quota exceeded");
    saved.set(record.seq, structuredClone(record));
  });
  const store = { put, async list() { return { records: [...saved.values()], skippedRecords: 0 }; } };
  const create = () => {
    const last = expandRequests([...saved.values()]).at(-1);
    return createCallRecorder({ sessionId: session().id, store, redact: (value) => value,
      previous: last ? { seq: last.record.seq, body: last.body } : null,
      fetch: async () => new Response("ok"), onToolExecutionStart() {}, onToolExecutionEnd() {} });
  };
  let recorder = create();
  try {
    for (const [seq, body] of bodies.entries()) {
      if (resume && seq === 2) {
        recorder.finish();
        await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(6));
        recorder = create();
      }
      recorder.callbacks.onStepStart({ callId: "run-1" });
      recorder.callbacks.onLanguageModelCallStart();
      await recorder.fetch("https://provider.test", { method: "POST", body });
      recorder.callbacks.onStepError({ error: new Error("Step failed") });
    }
    recorder.finish();
    await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(9));
    const records = [...saved.values()];
    expect(expandRequests(records).find((call) => call.record.seq === 2)?.body).toBe(bodies[2]);
    expect(saved.get(2)?.request).toEqual({ kind: "raw", body: bodies[2] });
    for (const call of expandRequests(records)) {
      if (call.body !== "") expect(call.body).toBe(bodies[call.record.seq]);
    }
  } finally { error.mockRestore(); }
});
