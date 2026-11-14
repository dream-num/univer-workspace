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
