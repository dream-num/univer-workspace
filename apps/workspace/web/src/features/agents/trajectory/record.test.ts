import { describe, expect, it } from "vitest";
import { session } from "../test-helpers";
import { encodeRequest, expandRequests, modelCallRecordSchema } from "./record";
import type { ModelCallRecord } from "./record";

function callRecord(seq: number, body: string, previous: string | null = null): ModelCallRecord {
  return { sessionId: session().id, seq, runId: "run-1", startedAt: "2026-11-14T00:00:00.000Z", endedAt: "2026-11-14T00:00:01.000Z",
    outcome: { kind: "ok", finishReason: "stop" }, attempts: [], request: encodeRequest(previous, body), response: [], usage: null, performance: null };
}
const user = { role: "user", content: "hello" };
const assistant = { role: "assistant", content: "hi" };
const body = (messages: unknown[], model = "mock") => JSON.stringify({ model, messages });

describe("request deltas", () => {
  it("saves the entire first request", () => {
    expect(encodeRequest(null, body([user]))).toEqual({ kind: "delta", base: 0, messages: [user], rest: { model: "mock" } });
  });
  it("stores only appended messages and omits unchanged parameters", () => {
    const previous = body([user]);
    const next = body([user, assistant]);
    expect(encodeRequest(previous, next)).toEqual({ kind: "delta", base: 1, messages: [assistant] });
    const expanded = expandRequests([callRecord(0, previous), callRecord(1, next, previous)]);
    expect(expanded[1]).toMatchObject({ body: next, base: 1, rewrite: false, paramsChanged: false });
  });
  it("marks a changed middle message and shortened history as rewrites", () => {
    const previous = body([user, assistant, user]);
    const next = body([user, { ...assistant, content: "changed" }, user]);
    const encoded = encodeRequest(previous, next);
    expect(encoded).toMatchObject({ kind: "delta", base: 1 });
    const expanded = expandRequests([callRecord(0, previous), callRecord(1, next, previous), callRecord(2, body([user]), next)]);
    expect(expanded.slice(1).map((call) => [call.base, call.rewrite])).toEqual([[1, true], [1, true]]);
  });
  it("saves changed rest and marks parameter changes", () => {
    const previous = body([user]);
    const next = body([user, assistant], "other-model");
    expect(encodeRequest(previous, next)).toMatchObject({ kind: "delta", rest: { model: "other-model" } });
    expect(expandRequests([callRecord(0, previous), callRecord(1, next, previous)])[1]).toMatchObject({ body: next, paramsChanged: true, rewrite: false });
  });
  it.each(["not JSON", "null", "[]", '{"model":"mock"}', '{"messages":null}'])("keeps unparseable request %s raw", (input) => {
    expect(encodeRequest(null, input)).toEqual({ kind: "raw", body: input });
  });
  it("preserves every byte including whitespace, property order, escapes, and raw predecessors", () => {
    const bodies = [
      body([user]),
      '{ "messages": [ { "role": "user", "content": "hi" } ], "model": "mock" }',
      '{"model":"mock","messages":[{"role":"user","content":"你好\\n\\\""}],"tools":[]}',
      '{"model":"mock","messages":[{"role":"user","content":"你好\\n\\\""},{"role":"assistant","content":"hi"}],"tools":[]}',
      "malformed", body([]), '{"messages":[],"model":"mock"}', '{"messages":[],"model":"new"}',
    ];
    const records = bodies.map((input, seq) => callRecord(seq, input, bodies[seq - 1] ?? null));
    expect(expandRequests(records).map((call) => call.body)).toEqual(bodies);
    expect(records[3]?.request).toEqual({ kind: "delta", base: 1, messages: [assistant] });
    expect(records.every((record) => modelCallRecordSchema.safeParse(record).success)).toBe(true);
  });
  it("expands records in sequence order", () => {
    const first = body([user]);
    const second = body([user, assistant]);
    expect(expandRequests([callRecord(1, second, first), callRecord(0, first)]).map((call) => call.body)).toEqual([first, second]);
  });
});
