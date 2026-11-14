import { describe, expect, it } from "vitest";
import { session } from "../test-helpers";
import type { AgentSession, SkillCatalog } from "../agent.types";
import { buildTrajectory, createTrajectorySearchIndex, contextMessageChange, reminderSpans, trajectorySearchText, waterfallScale } from "./build";
import { encodeRequest, expandRequests } from "./record";
import type { WireMessage } from "./build";
import type { ModelCallRecord } from "./record";
// The runtime stays behind dynamic imports (test/unit/web-architecture.test.ts).
const { skillsReminder, skillInvocation } = await import("../runtime/skills");
const { settingsReminder, referencesReminder } = await import("../runtime/runner");
const { draftReminder } = await import("../runtime/draft-reminder");
const { INTERRUPTED_TOOL, repairInterruptedTools } = await import("../runtime/messages");
const system = { role: "system", content: "system" };
const user: WireMessage = { role: "user", content: "hello" };
const answer = { role: "assistant", content: "hi" };
const toolCall = (id: string) => ({ type: "tool-call", toolCallId: id, toolName: "repo_list", input: "{}" });
function records(requests: unknown[], responses: unknown[][] = []): ModelCallRecord[] {
  const bodies = requests.map((messages) => typeof messages === "string" ? messages : JSON.stringify({ model: "mock", tools: [], messages }));
  return bodies.map((body, seq) => ({ sessionId: session().id, seq, runId: "run", startedAt: new Date(seq * 2000).toISOString(), endedAt: new Date(seq * 2000 + 1000).toISOString(),
    outcome: { kind: "ok", finishReason: "stop" }, attempts: [], request: encodeRequest(bodies[seq - 1] ?? null, body), response: responses[seq] ?? [], usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 5, reasoningTokens: 0 }, performance: null }));
}
describe("trajectory from recorded provider requests", () => {
  it("splits two turns and numbers steps inside each turn, including raw encoded requests", () => {
    const calls = records([[system, user], [system, user, answer, { ...user, content: "next" }]], [[{ type: "text", text: "hi" }]]);
    calls[0]!.request = { kind: "raw", body: JSON.stringify({ model: "mock", tools: [], messages: [system, user] }) };
    const tree = buildTrajectory(expandRequests(calls), session());
    expect(tree.turns.map((turn) => turn.steps.map((step) => [step.kind, step.step]))).toEqual([[["user", 1], ["assistant", 2]], [["user", 1], ["assistant", 2]]]);
    expect(tree.system).toEqual({ message: system, tools: [], params: { model: "mock" } });
    expect(tree.stats).toMatchObject({ calls: 2, inputTokens: 20, outputTokens: 4, cacheReadTokens: 10 });
    expect(tree.turns[0]?.steps[1]).toMatchObject({ replay: answer, replayMismatch: false });
  });
  it("keeps reminders in the exact content and locates sources in strings and multipart text", () => {
    const sources = ["Skills available in this session", "The user invoked", "The user attached these references", "The user changed the session settings", 'Draft "one" is open', "other"];
    const content = "hello\n" + sources.map((text) => `<system-reminder>\n${text}</system-reminder>`).join("\n");
    const message = { ...user, content };
    const tree = buildTrajectory(expandRequests(records([[system, message]])), session());
    expect(tree.turns[0]?.steps[0]).toMatchObject({ message });
    expect(reminderSpans(message).map((span) => [span.source, content.slice(span.start, span.end)])).toEqual(sources.map((text, index) => [["catalog", "invocation", "references", "settings", "drafts", "reminder"][index], `<system-reminder>\n${text}</system-reminder>`]));
    expect(reminderSpans({ role: "user", content: [{ type: "text", text: content }, { type: "image_url", image_url: { url: "url" } }] }).map((span) => span.part)).toEqual([0, 0, 0, 0, 0, 0]);
  });
  it("parents parallel tools, pairs sent results, and reads only timings and MCP output from session", () => {
    const replay = { role: "assistant", content: null, tool_calls: ["a", "b"].map((id) => ({ id, function: { name: "repo_list", arguments: '{"sent":true}' } })) };
    const results = ["a", "b"].map((id) => ({ role: "tool", tool_call_id: id, content: `sent ${id}` }));
    const calls = records([[system, user], [system, user, replay, ...results]], [[toolCall("a"), toolCall("b")]]);
    const tree = buildTrajectory(expandRequests(calls), session({ toolTimings: { a: { startedAt: new Date(1100).toISOString(), endedAt: new Date(1900).toISOString() } },
      messages: [{ id: "ui", role: "assistant", parts: [{ type: "dynamic-tool", toolName: "repo_list", toolCallId: "a", state: "output-available", input: {}, output: { structuredContent: { raw: true } } }] }] }));
    expect(tree.turns[0]?.steps.slice(2, 4)).toMatchObject([{ kind: "tool", parentStep: 2, step: 3, message: results[0], status: "ok", arguments: '{"sent":true}', startedAt: 1100, endedAt: 1900, mcpOutput: { raw: true } }, { kind: "tool", parentStep: 2, step: 4, message: results[1], status: "ok" }]);
    expect(tree.turns[0]?.steps[1]).toMatchObject({ replay, replayMismatch: false });
  });
  it("marks a replay mismatch and last call tools as unsent", () => {
    const tree = buildTrajectory(expandRequests(records([[system, user], [system, user, answer]], [[{ type: "text", text: "different" }], [toolCall("last")]])), session());
    expect(tree.turns[0]?.steps[1]).toMatchObject({ replay: answer, replayMismatch: true });
    expect(tree.turns[0]?.steps.at(-1)).toMatchObject({ kind: "tool", status: "unsent", message: null });
  });
  it("opens a new turn when a user message is appended during the same run", () => {
    const tree = buildTrajectory(expandRequests(records([[system, user], [system, user, answer, { ...user, content: "steer" }]])), session());
    expect(tree.turns).toHaveLength(2);
    expect(tree.turns[1]?.steps[0]).toMatchObject({ kind: "user", firstSeq: 1, sentAt: 2000 });
  });
  it("does not create children for failed or aborted calls", () => {
    const calls = records([[system, user], [system, user]], [[toolCall("a")], [toolCall("b")]]);
    calls[0]!.outcome = { kind: "error", message: "overloaded" }; calls[1]!.outcome = { kind: "aborted" };
    const tree = buildTrajectory(expandRequests(calls), session());
    expect(tree.turns[0]?.steps.map((step) => step.kind)).toEqual(["user", "assistant", "assistant"]);
    expect(tree.stats.errors).toBe(2);
  });
  it("counts rewrites and parameter changes, regardless of encoding kind", () => {
    const calls = records([[system, user], [system, user, answer], JSON.stringify({ model: "other", tools: [], messages: [system, { ...user, content: "changed" }] })]);
    expect(buildTrajectory(expandRequests(calls), session()).stats).toMatchObject({ rewrites: 1, paramsChanged: 1 });
  });
  it("reports unrecorded sessions and skipped records", () => {
    expect(buildTrajectory([], session({ messages: [{ id: "u", role: "user", parts: [{ type: "text", text: "old" }] }] }), 2)).toMatchObject({ unrecorded: true, stats: { skippedRecords: 2 } });
    expect(buildTrajectory([], session()).unrecorded).toBe(false);
  });
  it.each(["not JSON", '{"messages":[{"role":"unknown","content":"hi"}]}'])("shows an unparsed request only as raw: %s", (body) => {
    const tree = buildTrajectory(expandRequests(records([body], [[toolCall("invalid")]])), session());
    expect(tree.system).toBeNull();
    expect(tree.turns[0]?.steps).toHaveLength(1);
    expect(tree.turns[0]?.steps[0]).toMatchObject({ kind: "assistant", unparsed: true, messages: null, request: { body } });
  });
});


it("searches only each row's own content without matching later request history", () => {
  const replay = { role: "assistant", content: "replayed-answer", tool_calls: [{ id: "a", function: { name: "repo_list", arguments: '{"query":"argument-term"}' } }] };
  const result = { role: "tool", tool_call_id: "a", content: "unique-tool-result" };
  const calls = records([[system, user], [system, user, replay, result]], [[toolCall("a")], [{ type: "text", text: "next-response" }]]);
  const tree = buildTrajectory(expandRequests(calls), session({ messages: [{ id: "ui", role: "assistant", parts: [{
    type: "dynamic-tool", toolName: "repo_list", toolCallId: "a", state: "output-available", input: {}, output: { structuredContent: { value: "mcp-term" } },
  }] }] }));
  const steps = tree.turns.flatMap((turn) => turn.steps);
  expect(steps.filter((step) => trajectorySearchText(step).includes("unique-tool-result")).map((step) => step.kind)).toEqual(["tool"]);
  expect(steps.filter((step) => trajectorySearchText(step).includes("hello")).map((step) => step.kind)).toEqual(["user"]);
  const assistant = steps.find((step) => step.kind === "assistant");
  const tool = steps.find((step) => step.kind === "tool");
  if (!assistant || !tool || !tree.system) throw new Error("Missing trajectory rows");
  expect(trajectorySearchText(assistant)).toContain("replayed-answer");
  expect(trajectorySearchText(assistant)).toContain("repo_list");
  expect(trajectorySearchText(tool)).toContain("argument-term");
  expect(trajectorySearchText(tool)).toContain("mcp-term");
  expect(trajectorySearchText({ ...tree.system, tools: ["schema-term"], params: { model: "MODEL-TERM" } })).toContain("schema-term");
  expect(trajectorySearchText({ ...tree.system, tools: [], params: { model: "MODEL-TERM" } })).toContain("model-term");
  expect(trajectorySearchText(tree.system)).toContain("system");
});

it("separates rewritten history from newly appended messages in the same request", () => {
  const calls = records([[system, user, answer], [system, { ...user, content: "changed" }, answer, { ...user, content: "new" }, answer]]);
  const tree = buildTrajectory(expandRequests(calls), session());
  const rewritten = tree.turns.flatMap((turn) => turn.steps).find((step) => step.kind === "assistant" && step.seq === 1);
  if (!rewritten || rewritten.kind !== "assistant") throw new Error("Missing rewritten call");
  expect(rewritten).toMatchObject({ previousMessageCount: 3, newFrom: 1, rewrite: true });
  expect(rewritten.messages?.map((_, index) => contextMessageChange(rewritten, index))).toEqual([null, "rewritten", "rewritten", "new", "new"]);
  expect([0, 1, 2, 3].map((index) => contextMessageChange({ newFrom: 3, previousMessageCount: 3, rewrite: false }, index))).toEqual([null, null, null, "new"]);
});


it('R3 search matches literal quotes and leaf values without wire keys', () => {
  const replay = { role: "assistant", content: 'answer "yes"', tool_calls: [{ id: "a", function: { name: "repo_list", arguments: '{"query":"argument-leaf"}' } }] };
  const result = { role: "tool", tool_call_id: "a", content: JSON.stringify({ value: 'say "bye"', total: 42 }) };
  const calls = records([[system, { ...user, content: [{ type: "text", text: 'say "hi"' }, { type: "text", text: "NEXT LINE" }] }],
    [system, user, replay, result]], [[{ type: "text", text: 'answer "yes"' }, toolCall("a")]]);
  const tree = buildTrajectory(expandRequests(calls), session({ messages: [{ id: "ui", role: "assistant", parts: [{ type: "dynamic-tool", toolName: "repo_list", toolCallId: "a", state: "output-available", input: {}, output: { structuredContent: { hiddenKey: ["MCP leaf", 73] } } }] }] }));
  const steps = tree.turns.flatMap((turn) => turn.steps);
  const userStep = steps.find((step) => step.kind === "user");
  const tool = steps.find((step) => step.kind === "tool");
  const assistant = steps.find((step) => step.kind === "assistant");
  if (!userStep || !tool || !assistant) throw new Error("Missing search rows");
  expect(trajectorySearchText(userStep)).toContain('say "hi"\nnext line');
  expect(trajectorySearchText(assistant)).toContain('answer "yes"');
  expect(trajectorySearchText(tool)).toContain('say "bye"');
  expect(trajectorySearchText(tool)).toContain("argument-leaf");
  expect(trajectorySearchText(tool)).toContain("mcp leaf\n73");
  expect(trajectorySearchText(tool)).not.toContain("hiddenkey");
  for (const step of steps) {
    expect(trajectorySearchText(step)).not.toContain("tool_call_id");
    expect(trajectorySearchText(step)).not.toContain("role");
  }
});

it("R3 reminder boundaries preserve typed tags and label real generator output", async () => {
  const catalog: SkillCatalog = { skills: [{ name: "weekly-report", description: "Report", source: "user", modelInvocable: true, userInvocable: true }], diagnostics: [], repository: "no-repository" };
  const catalogPart = skillsReminder(catalog, null);
  const invocation = await skillInvocation({ id: "u", role: "user", parts: [{ type: "text", text: "/weekly-report now" }] }, catalog, [], async () => ({ content: "Report $ARGUMENTS" }));
  const references = referencesReminder([{ kind: "space", spaceId: "repo", label: "Sales" }]);
  const settings = settingsReminder(session(), { ...session(), mode: "ask" });
  const draftParts = await Promise.all((["published", "rejected", "expired", "conflicted"] as const).map(async (state) => {
    const result = await draftReminder([{ id: "a", role: "assistant", parts: [{ type: "dynamic-tool", toolName: "html_view_create", toolCallId: "d", state: "output-available", input: {}, output: { structuredContent: { draft: { id: "draft", state: "pending" } } } }] }],
      async () => ({ state, name: "Sales", published: state === "published" ? { nodeId: "node", resourceId: "resource", etag: '"etag"' } : null }), "https://workspace.test");
    return result.part?.text;
  }));
  const generated = [catalogPart?.text, invocation?.part.text, references?.text, settings, ...draftParts];
  if (generated.some((text) => !text)) throw new Error("Missing generated reminder");
  const typed = "What does <system-reminder> mean in this prompt?";
  const content = typed + generated.join("");
  const spans = reminderSpans({ role: "user", content });
  expect(spans.map((span) => span.source)).toEqual(["catalog", "invocation", "references", "settings", "drafts", "drafts", "drafts", "drafts"]);
  expect(spans.every((span) => span.start >= typed.length)).toBe(true);
  expect(spans.map((span) => content.slice(span.start, span.end))).toEqual(generated.map((text) => text?.trim()));
  const nested = "<system-reminder>\nouter <system-reminder>inline</system-reminder>";
  expect(reminderSpans({ role: "user", content: nested })).toEqual([]);
  const validInner = "<system-reminder>\nouter <system-reminder>\nReminder</system-reminder>";
  expect(reminderSpans({ role: "user", content: validInner })).toMatchObject([{ start: validInner.lastIndexOf("<system-reminder>"), end: validInner.length }]);
});

it.each(["repaired", "missing", "denied"] as const)("R3 recovers interrupted tool rows from replay with %s session parts", (state) => {
  const pending: AgentSession["messages"] = [{ id: "a", role: "assistant", parts: [{ type: "dynamic-tool", toolName: "repo_list", toolCallId: "interrupted", state: "input-available", input: { query: "as sent" } }] }];
  const repaired = repairInterruptedTools(pending);
  const saved = state === "missing" ? [] : state === "repaired" ? repaired : [{ id: "a", role: "assistant" as const, parts: [{ type: "dynamic-tool" as const, toolName: "repo_list", toolCallId: "interrupted", state: "output-denied" as const, input: {}, approval: { id: "approval", approved: false as const } }] }];
  const replay = { role: "assistant", content: "", tool_calls: [{ id: "interrupted", function: { name: "repo_list", arguments: '{"query":"as sent"}' } }] };
  const toolMessage = { role: "tool", tool_call_id: "interrupted", content: INTERRUPTED_TOOL };
  const calls = records([[system, user], [system, user, replay, toolMessage, { ...user, content: "Continue" }]]);
  calls[0]!.outcome = { kind: "aborted" }; calls[0]!.response = null;
  const tree = buildTrajectory(expandRequests(calls), session({ messages: saved }));
  expect(tree.turns[0]?.steps).toMatchObject([{ kind: "user", step: 1 }, { kind: "assistant", step: 2 }, { kind: "tool", step: 3, parentStep: 2, name: "repo_list", arguments: '{"query":"as sent"}', message: toolMessage, status: state === "denied" ? "denied" : "error" }]);
  expect(tree.turns[1]?.steps.map((step) => [step.kind, step.step])).toEqual([["user", 1], ["assistant", 2]]);
  expect(tree.stats).toMatchObject({ toolCalls: 1, errors: 2 });
});

it("R3 null response does not imply a replay mismatch", () => {
  const calls = records([[system, user], [system, user, { ...answer, content: "Partial answer" }, { ...user, content: "Continue" }]]);
  calls[0]!.outcome = { kind: "aborted" }; calls[0]!.response = null;
  const tree = buildTrajectory(expandRequests(calls), session());
  expect(tree.turns[0]?.steps[1]).toMatchObject({ kind: "assistant", replay: { content: "Partial answer" }, replayMismatch: false });
});


it("R4 running model and tool waterfall bars grow within ten-second windows while finished Turns stay exact", () => {
  const runningCalls = records([[system, user]]);
  runningCalls[0]!.outcome = { kind: "running" }; runningCalls[0]!.endedAt = null;
  const running = buildTrajectory(expandRequests(runningCalls), session()).turns[0];
  const finished = buildTrajectory(expandRequests(records([[system, user]])), session()).turns[0];
  const tool = buildTrajectory(expandRequests(records([[system, user]], [[toolCall("a")]])), session({ toolTimings: { a: { startedAt: new Date(1000).toISOString(), endedAt: null } } })).turns[0];
  if (!running || !finished || !tool) throw new Error("Missing waterfall Turns");
  const widths = [667, 1672].map((now) => (now - running.startedAt) / waterfallScale(running, now) * 100);
  expect(widths[1]).toBeGreaterThan(widths[0] ?? 0);
  expect(widths).toEqual([6.67, 16.72]);
  expect([0, 10000, 10001, 20001].map((now) => waterfallScale(running, now))).toEqual([10000, 10000, 20000, 30000]);
  expect([1667, 2672].map((now) => (now - 1000) / waterfallScale(tool, now) * 100)).toEqual([6.67, 16.72]);
  expect([667, 1672, 20001].map((now) => waterfallScale(finished, now))).toEqual([1000, 1000, 1000]);
  expect(finished.endedAt - finished.startedAt).toBe(1000);
});


it("R5 defers search text until a non-empty query and reuses the index per trajectory", () => {
  const tree = buildTrajectory(expandRequests(records([[system, user]])), session());
  const turns = tree.turns;
  let reads = 0;
  Object.defineProperty(tree, "turns", { get: () => { reads++; return turns; } });
  const indexFor = createTrajectorySearchIndex(tree);
  expect(indexFor("")).toBeNull();
  expect(indexFor("   ")).toBeNull();
  expect(reads).toBe(0);
  const first = indexFor("hello");
  expect(first?.steps.get(turns[0]!.steps[0]!)).toContain("hello");
  const indexedReads = reads;
  expect(indexedReads).toBeGreaterThan(0);
  expect(indexFor("different")).toBe(first);
  expect(indexFor("")).toBeNull();
  expect(indexFor("hello")).toBe(first);
  expect(reads).toBe(indexedReads);
  const changed = buildTrajectory(expandRequests(records([[system, { ...user, content: "changed" }]])), session());
  expect(createTrajectorySearchIndex(changed)("changed")).not.toBe(first);
});
