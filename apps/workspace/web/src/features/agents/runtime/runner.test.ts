import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ToolLoopAgent } from "ai";
import { createModel } from "./model";
import { IDBKeyRange } from "fake-indexeddb";
import { createTrajectoryStore } from "../trajectory/store";
import { expandRequests } from "../trajectory/record";
import { isSystemReminder, messageSkills, messageSkillInvocation, sessionLockName, sessionTitle } from "../agent.types";
import type { AgentReference, AgentSession, AgentSettings, SkillCatalog } from "../agent.types";
import { createMcpTokenSource } from "../mcp-token";
import { createProviders, deepSeekDefault } from "../providers";
import { createSessionStore } from "../session-store";
import { deferred, session, storageOptions } from "../test-helpers";
import { pendingApprovals } from "../approvals";
import { settleApprovals, SUPERSEDED_APPROVAL } from "./approvals";
import { AgentBusyError, createAgentRunner, referencesReminder } from "./runner";
import type { AgentRunnerDependencies } from "./runner";

const emptySkills: SkillCatalog = { skills: [], diagnostics: [], repository: "no-repository" };
const personalSkills: SkillCatalog = { ...emptySkills, skills: [{ name: "weekly-report", description: "Write the weekly report.", source: "user", path: ".agents/skills/weekly-report/SKILL.md", modelInvocable: true, userInvocable: true }] };
const mcpUrl = "https://workspace.test/mcp";
const key = "test-provider-secret";
const rpcSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(), method: z.string(),
  params: z.object({ name: z.string().optional() }).passthrough().optional(),
});
function modelStream(toolName?: string, parallel = false, usage?: { prompt_tokens: number; prompt_cache_hit_tokens?: number; prompt_tokens_details?: { cached_tokens: number } }, toolInput: unknown = {}): Response {
  const delta = toolName ? { role: "assistant", tool_calls: [{ index: 0, id: "call-1", type: "function", function: { name: toolName, arguments: JSON.stringify(toolInput) } }, ...(parallel ? [{ index: 1, id: "call-2", type: "function", function: { name: toolName, arguments: "{}" } }] : [])] }
    : { role: "assistant", content: "Done" };
  const chunk = (value: unknown, finish: string | null) => ({ id: "completion-1", object: "chat.completion.chunk", created: 1, model: "deepseek-flash", choices: [{ index: 0, delta: value, finish_reason: finish }] });
  return new Response([chunk(delta, null), { ...chunk({}, toolName ? "tool_calls" : "stop"), ...(usage ? { usage: { completion_tokens: 1, total_tokens: usage.prompt_tokens + 1, ...usage } } : {}) }]
    .map((value) => `data: ${JSON.stringify(value)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
}

async function setup(options: {
  model?: (index: number, body: string, signal: AbortSignal | null | undefined) => Response | Promise<Response>;
  tool?: () => Promise<void>;
  skills?: (args: unknown) => unknown | Promise<unknown>;
  unauthorized?: number;
  resourceError?: boolean;
  publish?: boolean;
  pageTool?: "html_view_create" | "html_view_replace";
  getDraft?: AgentRunnerDependencies["getDraft"];
  trajectory?: (store: AgentRunnerDependencies["trajectory"]) => AgentRunnerDependencies["trajectory"];
} = {}) {
  const storage = storageOptions();
  const saved: AgentSession[] = [];
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  const store = createTrajectoryStore(storage);
  const trajectory = options.trajectory ? options.trajectory(store) : store;
  const backing = createSessionStore(storage);
  const sessions = { ...backing, async save(value: AgentSession) { saved.push(structuredClone(value)); await backing.save(value); } };
  const requests: { url: string; method: string | undefined; headers: [string, string][]; body: string }[] = [];
  const modelBodies: string[] = [];
  const methods: string[] = [];
  const gateway = {
    instructions: "Server instructions", skill: "Core skill instructions",
    tools: [{ name: "skills_read", description: "Read skills", inputSchema: { type: "object", properties: { name: { type: "string" }, repo: { type: "string" } } } }, { name: options.pageTool ?? "pr_create", description: "Create a draft or pull request", inputSchema: { type: "object", properties: {} }, ...(options.publish || options.pageTool ? { _meta: { "univer.workspace/scope": options.publish ? "publish" : "write" } } : {}) }],
  };
  let minted = 0;
  let unauthorized = options.unauthorized ?? 0;
  const request: typeof fetch = vi.fn<typeof fetch>(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const body = String(init?.body ?? "");
    requests.push({ url, method: init?.method, headers: [...new Headers(init?.headers).entries()], body });
    if (url === "/api/auth/agent-token") {
      return Response.json({ token: `uvw_at_mcp-token-${++minted}`, expiresAt: Date.now() + 3_600_000 });
    }
    if (url.startsWith(mcpUrl)) {
      if (unauthorized-- > 0) return new Response("unauthorized", { status: 401 });
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      const rpc = rpcSchema.parse(JSON.parse(body));
      methods.push(rpc.method);
      const respond = (result: unknown) => Response.json({ jsonrpc: "2.0", id: rpc.id, result }, { headers: { "mcp-session-id": "session" } });
      if (rpc.method === "initialize") return respond({ protocolVersion: "2025-11-25", capabilities: { tools: {}, resources: {} }, serverInfo: { name: "fake-workspace", version: "1" }, instructions: gateway.instructions });
      if (rpc.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (rpc.method === "tools/list") return respond({ tools: gateway.tools });
      if (rpc.method === "resources/read") {
        if (options.resourceError) return Response.json({ jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: "No resource" } });
        return respond({ contents: [{ uri: "skill://univer-workspace/core/SKILL.md", mimeType: "text/markdown", text: gateway.skill }] });
      }
      if (rpc.method === "tools/call") {
        if (!gateway.tools.some((tool) => tool.name === rpc.params?.name)) return Response.json({ jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: `Unknown tool: ${rpc.params?.name}` } });
        if (rpc.params?.name === "skills_read") return respond(options.skills ? await options.skills(rpc.params.arguments) : { content: [], structuredContent: emptySkills });
        await options.tool?.();
        return respond({ content: [{ type: "text", text: '{"id":"worktree-1"}' }], structuredContent: options.pageTool ? { draft: { id: "draft-1", state: "pending" } } : { id: "worktree-1", number: 1, spaceId: "repo-1", url: "/pull/1" } });
      }
      if (rpc.method === "notifications/cancelled") return new Response(null, { status: 202 });
      throw new Error(`Unexpected MCP method ${rpc.method}`);
    }
    if (url.startsWith("https://api.deepseek.com")) {
      modelBodies.push(body);
      return options.model ? options.model(modelBodies.length, body, init?.signal) : modelStream(modelBodies.length === 1 ? "pr_create" : undefined);
    }
    throw new Error(`Unexpected request URL ${url}`);
  });
  const providers = createProviders({ ...storage, fetch: request, workspaceOrigin: "https://workspace.test" });
  await providers.setKey(deepSeekDefault.id, key);
  const deps = { userId: storage.userId, locks: storage.locks, fetch: request, providers, sessions, trajectory,
    getDraft: options.getDraft ?? vi.fn(async () => null),
    mcpUrl, createTokenSource: (mode: "ask" | "auto" | "publish") => createMcpTokenSource({ grant: mode, fetch: request }) };
  const runner = createAgentRunner(deps);
  const input = { scope: { kind: "global" as const }, mode: "auto" as const, model: session().model, text: "Make a pull request" };
  async function finished(id: AgentSession["id"]) {
    await vi.waitFor(() => expect(runner.isRunningHere(id)).toBe(false));
    return sessions.get(id);
  }
  return { storage, sessions, saved, requests, modelBodies, methods, runner, input, finished, deps, gateway, trajectory };
}

describe("agent runner with real SDK transports and offline fetch", () => {
  it("records each provider request byte for byte and ends model calls before tool execution", async () => {
    const test = await setup();
    const started = await test.runner.start(test.input);
    const done = await test.finished(started.id);
    const { records } = await test.trajectory.list(started.id);
    const expanded = expandRequests(records);
    expect(expanded.map((call) => call.body)).toEqual(test.modelBodies);
    expect(records.map((call) => call.outcome.kind)).toEqual(["ok", "ok"]);
    expect(records[0]?.endedAt).not.toBeNull();
    expect(Date.parse(done!.toolTimings["call-1"]!.startedAt)).toBeGreaterThanOrEqual(Date.parse(records[0]!.endedAt!));
    expect(records[0]?.runId).toBe(records[1]?.runId);
  });

  it("observes the designed SDK event order around provider fetch and tool execution", async () => {
    const events: string[] = [];
    const test = await setup({ model: (index) => {
      events.push("fetch");
      return modelStream(index === 1 ? "pr_create" : undefined);
    } });
    const agent = new ToolLoopAgent({
      ...createModel(await test.deps.providers.resolve(test.input.model.providerId), test.input.model, test.deps.fetch, "https://workspace.test"),
      tools: { pr_create: { inputSchema: z.object({}), execute: async () => { events.push("execute"); return "done"; } } },
      onStepStart() { events.push("step-start"); },
      onLanguageModelCallStart() { events.push("attempt-start"); },
      onLanguageModelCallEnd() { events.push("model-end"); },
      onToolExecutionStart() { events.push("tool-start"); },
      onToolExecutionEnd() { events.push("tool-end"); },
    });
    await (await agent.stream({ prompt: "Create a pull request" })).consumeStream();
    expect(events).toEqual(["step-start", "attempt-start", "fetch", "model-end", "tool-start", "execute", "tool-end",
      "step-start", "attempt-start", "fetch", "model-end"]);
  });

  it("records model response content, token usage, and streaming performance", async () => {
    const test = await setup({ model: () => modelStream(undefined, false, { prompt_tokens: 100, prompt_cache_hit_tokens: 50 }) });
    const started = await test.runner.start(test.input);
    await test.finished(started.id);
    const { records } = await test.trajectory.list(started.id);
    expect(records[0]?.response).toContainEqual(expect.objectContaining({ type: "text", text: "Done" }));
    expect(records[0]?.usage).toEqual({ inputTokens: 100, cacheReadTokens: 50, outputTokens: 1, reasoningTokens: 0 });
    expect(records[0]?.performance).toEqual({ responseTimeMs: expect.any(Number), timeToFirstOutputMs: expect.any(Number) });
  });

  it("caps the captured error body at 64 KB and preserves provider failure", async () => {
    const body = "x".repeat(65536) + "tail";
    const test = await setup({ model: () => new Response(body, { status: 401 }) });
    const started = await test.runner.start(test.input);
    const done = await test.finished(started.id);
    const { records } = await test.trajectory.list(started.id);
    expect(records[0]?.attempts[0]?.errorBody).toBe("x".repeat(65536));
    expect(done?.status).toBe("failed");
  });

  it("continues sequence and request prefixes across two turns and a fresh runner", async () => {
    const test = await setup();
    const started = await test.runner.start(test.input);
    await test.finished(started.id);
    const reloaded = createAgentRunner({ ...test.deps, trajectory: createTrajectoryStore(test.storage) });
    await reloaded.send(started.id, "Next turn");
    await vi.waitFor(() => expect(reloaded.isRunningHere(started.id)).toBe(false));
    const { records } = await test.trajectory.list(started.id);
    const expanded = expandRequests(records);
    expect(records.map((call) => call.seq)).toEqual([0, 1, 2]);
    expect(expanded.map((call) => call.body)).toEqual(test.modelBodies);
    expect(expanded.every((call) => !call.rewrite)).toBe(true);
    expect(expanded[2]?.base).toBe(expanded[1]?.request?.messages.length);
    expect(records[0]?.runId).not.toBe(records[2]?.runId);
  });

  it("keeps a 500 retry in one call with both attempts and the original error body", async () => {
    const test = await setup({ model: (index) => index === 1 ? new Response("overloaded", { status: 500 }) : modelStream() });
    const started = await test.runner.start(test.input);
    await vi.waitFor(() => expect(test.runner.isRunningHere(started.id)).toBe(false), { timeout: 8000 });
    expect((await test.finished(started.id))?.status).toBe("idle");
    const { records } = await test.trajectory.list(started.id);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ outcome: { kind: "ok" }, attempts: [{ status: 500, errorBody: "overloaded" }, { status: 200 }] });
    expect(records[0]?.attempts.every((attempt) => attempt.endedAt !== null)).toBe(true);
    expect(expandRequests(records)[0]?.body).toBe(test.modelBodies[0]);
    expect(test.modelBodies[1]).toBe(test.modelBodies[0]);
  }, 10000);

  it("records persistent provider failure as error and uses its request as the next base", async () => {
    let failing = true;
    const test = await setup({ model: () => failing ? new Response("still overloaded", { status: 500 }) : modelStream() });
    const started = await test.runner.start(test.input);
    await vi.waitFor(() => expect(test.runner.isRunningHere(started.id)).toBe(false), { timeout: 12000 });
    expect((await test.sessions.get(started.id))?.status).toBe("failed");
    const failed = (await test.trajectory.list(started.id)).records;
    expect(failed).toHaveLength(1);
    expect(failed[0]?.outcome.kind).toBe("error");
    expect(failed[0]?.attempts.map((attempt) => [attempt.status, attempt.errorBody])).toEqual([[500, "still overloaded"], [500, "still overloaded"], [500, "still overloaded"]]);
    failing = false;
    await test.runner.send(started.id, "Try again");
    await test.finished(started.id);
    const expanded = expandRequests((await test.trajectory.list(started.id)).records);
    expect(expanded[1]?.base).toBe(expanded[0]?.request?.messages.length);
    expect(expanded[1]?.rewrite).toBe(false);
  }, 15000);

  it("marks a stopped model call aborted with a finished attempt", async () => {
    const entered = deferred<void>();
    const test = await setup({ model: (_index, _body, signal) => new Promise<Response>((_resolve, reject) => {
      entered.resolve();
      signal?.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")), { once: true });
    }) });
    const started = await test.runner.start(test.input);
    await entered.promise;
    await test.runner.stop(started.id);
    await vi.waitFor(async () => expect((await test.trajectory.list(started.id)).records[0]?.outcome.kind).toBe("aborted"));
    const { records } = await test.trajectory.list(started.id);
    expect((await test.sessions.get(started.id))?.status).toBe("stopped");
    expect(records).toHaveLength(1);
    expect(records[0]?.outcome.kind).toBe("aborted");
    expect(records[0]?.endedAt).not.toBeNull();
    expect(records[0]?.attempts[0]?.endedAt).not.toBeNull();
  });

  it("round2 closes the model call aborted by steering before the next call starts", async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    const test = await setup({ tool: async () => { entered.resolve(); await release.promise; }, model: (index, _body, signal) => {
      if (index === 1) return modelStream("pr_create");
      if (index === 2) return new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(new DOMException("Steering", "AbortError"));
        if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
      });
      return modelStream();
    } });
    const started = await test.runner.start(test.input);
    try {
      await entered.promise;
      await test.runner.send(started.id, "Use the new direction");
      release.resolve();
      expect((await test.finished(started.id))?.status).toBe("idle");
      const { records } = await test.trajectory.list(started.id);
      expect(records.map((record) => record.seq)).toEqual([0, 1, 2]);
      expect(records[1]?.outcome.kind).toBe("aborted");
      expect(records[1]?.endedAt).not.toBeNull();
      expect(records[1]?.attempts.at(-1)?.endedAt).not.toBeNull();
      expect(expandRequests(records).map((call) => call.body)).toEqual(test.modelBodies);
    } finally { release.resolve(); await test.runner.stop(started.id); }
  });

  it("round2 skips recording after a failed initial list without overwriting stored calls or losing tool timings", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const test = await setup({ model: (index) => modelStream(index === 2 ? "pr_create" : undefined) });
      const started = await test.runner.start(test.input);
      await test.finished(started.id);
      const before = await test.trajectory.list(started.id);
      const put = vi.fn(test.trajectory.put);
      const runner = createAgentRunner({ ...test.deps, trajectory: { put, async list() { throw new Error("Read unavailable"); } } });
      await runner.send(started.id, "Next turn after reload");
      await vi.waitFor(() => expect(runner.isRunningHere(started.id)).toBe(false));
      const done = await test.sessions.get(started.id);
      expect(done?.status).toBe("idle");
      expect(done?.toolTimings["call-1"]).toEqual({ startedAt: expect.any(String), endedAt: expect.any(String) });
      expect(test.modelBodies).toHaveLength(3);
      expect(put).not.toHaveBeenCalled();
      expect(await test.trajectory.list(started.id)).toEqual(before);
    } finally { error.mockRestore(); }
  });

  it.each(["http", "throw"] as const)("round2 redacts escaped provider keys from plain %s failures and JSON captures", async (failure) => {
    const secret = String.raw`sk-a"b\c`;
    const test = await setup({ model: () => {
      if (failure === "throw") throw new Error(`rejected ${secret}`);
      return new Response(`rejected ${secret}`, { status: 401 });
    } });
    await test.deps.providers.setKey(deepSeekDefault.id, secret);
    const started = await test.runner.start({ ...test.input, text: `My key is ${secret}` });
    await test.finished(started.id);
    const { records } = await test.trajectory.list(started.id);
    expect(records).toHaveLength(1);
    const stored = records[0]!;
    expect(stored.outcome.kind).toBe("error");
    if (failure === "http") expect(stored.attempts[0]?.errorBody).toBe("rejected [redacted]");
    else expect(stored.outcome).toEqual({ kind: "error", message: "rejected [redacted]" });
    const expanded = expandRequests(records)[0]!;
    expect(expanded.body).toBe(test.modelBodies[0]?.replaceAll(JSON.stringify(secret).slice(1, -1), "[redacted]"));
    expect(JSON.stringify(stored)).not.toContain(JSON.stringify(secret).slice(1, -1));
  });

  it("redacts a provider key in the stored request and error response without changing the wire", async () => {
    const test = await setup({ model: () => new Response(`rejected ${key}`, { status: 401 }) });
    const started = await test.runner.start({ ...test.input, text: `My key is ${key}` });
    await test.finished(started.id);
    const { records } = await test.trajectory.list(started.id);
    expect(test.modelBodies[0]).toContain(key);
    expect(expandRequests(records)[0]?.body).toBe(test.modelBodies[0]?.replaceAll(key, "[redacted]"));
    expect(records[0]?.attempts[0]?.errorBody).toBe("rejected [redacted]");
    expect(JSON.stringify(records)).not.toContain(key);
  });

  it("redacts provider keys in model response content", async () => {
    const test = await setup({ model: async () => {
      const response = modelStream();
      return new Response((await response.text()).replace("Done", key), { headers: response.headers });
    } });
    const started = await test.runner.start(test.input);
    await test.finished(started.id);
    const { records } = await test.trajectory.list(started.id);
    expect(records[0]?.response).toContainEqual(expect.objectContaining({ type: "text", text: "[redacted]" }));
    expect(JSON.stringify(records)).not.toContain(key);
  });

  it.each(["put", "list"] as const)("finishes the session when trajectory %s throws", async (operation) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const test = await setup({ model: () => modelStream(), trajectory: (store) => ({ ...store, [operation]: () => { throw new Error("Trajectory unavailable"); } }) });
      const started = await test.runner.start(test.input);
      expect((await test.finished(started.id))?.status).toBe("idle");
      expect(error).toHaveBeenCalled();
    } finally { error.mockRestore(); }
  });

  it("continues turns without waiting for a stuck trajectory write", async () => {
    const pending = deferred<void>();
    const test = await setup({ model: () => modelStream(), trajectory: (store) => ({ ...store, put: async (record) => { await pending.promise; await store.put(record); } }) });
    const started = await test.runner.start(test.input);
    try {
      expect((await test.finished(started.id))?.status).toBe("idle");
      await test.runner.send(started.id, "Another turn before the writes finish");
      expect((await test.finished(started.id))?.status).toBe("idle");
    } finally { pending.resolve(); }
    await vi.waitFor(async () => expect((await test.trajectory.list(started.id)).records).toHaveLength(2));
    const { records } = await test.trajectory.list(started.id);
    expect(records.map((record) => record.seq)).toEqual([0, 1]);
    const expanded = expandRequests(records);
    expect(expanded.map((call) => call.body)).toEqual(test.modelBodies);
    expect(expanded[1]?.base).toBe(expanded[0]?.request?.messages.length);
    expect(expanded[1]?.rewrite).toBe(false);
  });

  it("records execution timings for parallel tools after the issuing model call", async () => {
    const test = await setup({ model: (index) => modelStream(index === 1 ? "pr_create" : undefined, index === 1) });
    const started = await test.runner.start(test.input);
    const done = await test.finished(started.id);
    const { records } = await test.trajectory.list(started.id);
    for (const id of ["call-1", "call-2"]) {
      const timing = done!.toolTimings[id]!;
      expect(Date.parse(timing.startedAt)).toBeGreaterThanOrEqual(Date.parse(records[0]!.endedAt!));
      expect(timing.endedAt).not.toBeNull();
    }
  });

  it.each(["pr_create", "html_view_create"] as const)("records approved %s execution through the gated publish client", async (name) => {
    const test = await setup({ publish: true, ...(name === "html_view_create" ? { pageTool: name } : {}), model: (index) => modelStream(index === 1 ? name : undefined) });
    const started = await test.runner.start(test.input);
    const paused = (await test.finished(started.id))!;
    expect(paused.toolTimings["call-1"]).toBeUndefined();
    await test.runner.decide(started.id, pendingApprovals(paused)[0]!.approvalId, true);
    const done = (await test.finished(started.id))!;
    expect(done.toolTimings["call-1"]).toEqual({ startedAt: expect.any(String), endedAt: expect.any(String) });
    const { records } = await test.trajectory.list(started.id);
    expect(records.map((record) => record.seq)).toEqual([0, 1]);
    expect(expandRequests(records).map((call) => call.body)).toEqual(test.modelBodies);
  });

  it("freezes the system message and tool definitions across gateway releases and reloads", async () => {
    const test = await setup({ model: () => modelStream() });
    const started = await test.runner.start(test.input);
    const saved = (await test.finished(started.id))!;
    const sent = JSON.parse(test.modelBodies[0]!);
    expect(saved.modelSnapshot?.system).toBe(sent.messages[0].content);
    expect(saved.modelSnapshot?.tools.map(({ name, description, inputSchema }) => ({
      type: "function", function: { name, description, parameters: inputSchema },
    }))).toEqual(sent.tools);
    test.gateway.instructions = "New server instructions";
    test.gateway.skill = "New core skill instructions";
    test.gateway.tools[0]!.description = "Changed description";
    test.gateway.tools.push({ name: "new_tool", description: "New tool", inputSchema: { type: "object", properties: {} } });
    const sessions = createSessionStore(test.storage);
    const runner = createAgentRunner({ ...test.deps, sessions });
    await runner.send(started.id, "After the gateway release");
    await vi.waitFor(() => expect(runner.isRunningHere(started.id)).toBe(false));
    const [first, second] = test.modelBodies.map((body) => JSON.parse(body));
    expect(JSON.stringify(second.messages[0])).toBe(JSON.stringify(first.messages[0]));
    expect(JSON.stringify(second.tools)).toBe(JSON.stringify(first.tools));
    expect(second.messages.slice(0, first.messages.length)).toEqual(first.messages);
    const fresh = await test.runner.start(test.input);
    await test.finished(fresh.id);
    const latest = JSON.parse(test.modelBodies[2]!);
    expect(latest.messages[0].content).toContain("New server instructions");
    expect(latest.messages[0].content).toContain("New core skill instructions");
    expect(latest.tools[0].function.description).toBe("Changed description");
    expect(latest.tools.at(-1).function.name).toBe("new_tool");
  });

  it("loads a legacy session and persists its first model snapshot before sending, then reuses it", async () => {
    const test = await setup({ model: () => {
      expect(test.saved.at(-1)).toHaveProperty("modelSnapshot");
      return modelStream();
    } });
    const legacy = session({ messages: [{ id: "old-user", role: "user", parts: [{ type: "text", text: "Earlier message" }] }] });
    await test.sessions.save(legacy);
    expect(await createSessionStore(test.storage).get(legacy.id)).toEqual(legacy);
    await test.runner.send(legacy.id, "First turn after upgrade");
    const first = (await test.finished(legacy.id))!;
    expect(first).toHaveProperty("modelSnapshot");
    test.gateway.instructions = "Updated server";
    test.gateway.skill = "Updated core";
    test.gateway.tools = [];
    await test.runner.send(legacy.id, "Next turn after upgrade");
    const next = (await test.finished(legacy.id))!;
    expect(next.status).toBe("idle");
    expect(next.modelSnapshot).toEqual(first.modelSnapshot);
    expect(test.saved.filter((value) => value.modelSnapshot).every((value) => JSON.stringify(value.modelSnapshot) === JSON.stringify(first.modelSnapshot))).toBe(true);
    expect(test.methods.filter((method) => method === "tools/list")).toHaveLength(1);
    expect(test.methods.filter((method) => method === "resources/read")).toHaveLength(1);
  });

  it("executes frozen tools on the live gateway and reports a removed tool to the model", async () => {
    const tool = vi.fn(async () => {});
    const test = await setup({ tool, model: (index) => modelStream(index === 2 || index === 4 ? "pr_create" : undefined) });
    const started = await test.runner.start(test.input);
    await test.finished(started.id);
    test.gateway.tools[1]!.description = "Released implementation";
    await test.runner.send(started.id, "Call the frozen tool");
    expect((await test.finished(started.id))?.status).toBe("idle");
    expect(tool).toHaveBeenCalledTimes(1);
    test.gateway.tools = test.gateway.tools.filter((item) => item.name !== "pr_create");
    await test.runner.send(started.id, "Call the removed tool");
    const done = (await test.finished(started.id))!;
    expect(done.status).toBe("idle");
    expect(tool).toHaveBeenCalledTimes(1);
    expect(JSON.parse(test.modelBodies[4]!).messages).toContainEqual(expect.objectContaining({ role: "tool", content: expect.stringContaining("Unknown tool: pr_create") }));
    expect(done.messages.flatMap((message) => message.parts)).toContainEqual(expect.objectContaining({ toolName: "pr_create", state: "output-error", errorText: expect.stringContaining("Unknown tool: pr_create") }));
  });

  it.each([
    ["Write $ARGUMENTS then $ARGUMENTS", "/weekly-report   week 46  ", "Write week 46 then week 46"],
    ["Write $ARGUMENTS", "/weekly-report $& $$", "Write $& $$"],
    ["Write a report", "/weekly-report week 46", "Write a report\n\nARGUMENTS: week 46"],
    ["Write a report", "/weekly-report", "Write a report"],
    ["Write $ARGUMENTS", "/weekly-report", "Write "],
  ])("expands %s for %s and persists the invocation with its catalog", async (content, text, rendered) => {
    const skills = vi.fn((args: unknown) => ({ content: [], structuredContent: z.object({ name: z.string() }).safeParse(args).success
      ? { content, resources: [{ path: "guide.md", readCommand: "Read guide.md with skills_read." }] } : personalSkills }));
    const test = await setup({ skills, model: () => modelStream() });
    const started = await test.runner.start({ ...test.input, text, scope: { kind: "repository", spaceId: "repo", baseWorktreeId: null } });
    const done = (await test.finished(started.id))!;
    expect(done.status).toBe("idle");
    const message = done.messages[0]!;
    expect(message.parts[0]).toEqual({ type: "text", text });
    expect(message.parts.at(-1)).toEqual({ type: "text", text: `\n\n<system-reminder>\nThe user invoked the user skill "weekly-report" with /weekly-report. Follow these instructions for this request.\n${rendered}\nRead guide.md with skills_read.\n</system-reminder>` });
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content))), (byte) => byte.toString(16).padStart(2, "0")).join("");
    expect(messageSkillInvocation(message.metadata)).toEqual({ name: "weekly-report", source: "user", digest });
    expect(skills.mock.calls).toEqual([[{ repo: "repo" }], [{ name: "weekly-report", repo: "repo" }]]);
    expect(test.saved.some((saved) => saved.status === "running" && messageSkillInvocation(saved.messages[0]?.metadata) && messageSkills(saved.messages[0]?.metadata))).toBe(true);
  });

  it("keeps the system prompt and catalog reminder byte-identical with an invocable builtin and expands only the invoking turn", async () => {
    const creator = { name: "skill-creator", source: "builtin", description: "Create Skills.", modelInvocable: true, userInvocable: true } as const;
    const content = "Create a reviewable Skill draft.";
    let catalog = personalSkills;
    const test = await setup({ model: () => modelStream(), skills: (args) => ({ content: [], structuredContent:
      z.object({ name: z.string() }).safeParse(args).success ? { content } : catalog }) });
    const plain = await test.runner.start(test.input);
    const without = (await test.finished(plain.id))!;
    catalog = { ...personalSkills, skills: [...personalSkills.skills, creator] };
    const started = await test.runner.start(test.input);
    const first = (await test.finished(started.id))!;
    expect(first.messages[0]?.parts).toEqual(without.messages[0]?.parts);
    expect(messageSkills(first.messages[0]?.metadata)?.skills).toContainEqual(creator);
    const baseline = JSON.parse(test.modelBodies[0]!);
    const withBuiltin = JSON.parse(test.modelBodies[1]!);
    expect(JSON.stringify(withBuiltin.messages[0])).toBe(JSON.stringify(baseline.messages[0]));
    expect(JSON.stringify(withBuiltin.messages[1])).toBe(JSON.stringify(baseline.messages[1]));
    expect(withBuiltin.tools).toEqual(baseline.tools);
    await test.runner.send(started.id, "/skill-creator make a weekly report skill");
    const invoked = (await test.finished(started.id))!;
    const last = invoked.messages.filter((message) => message.role === "user").at(-1)!;
    expect(messageSkillInvocation(last.metadata)).toMatchObject({ name: "skill-creator", source: "builtin" });
    expect(last.parts.at(-1)).toEqual({ type: "text", text: expect.stringContaining(content + "\n\nARGUMENTS: make a weekly report skill") });
    expect(invoked.messages.slice(0, first.messages.length)).toEqual(first.messages);
    const invokingBody = JSON.parse(test.modelBodies[2]!);
    expect(invokingBody.messages.slice(0, withBuiltin.messages.length)).toEqual(withBuiltin.messages);
    expect(invokingBody.messages.at(-1).role).toBe("user");
    expect(invokingBody.messages.at(-1).content).toContain(content);
    expect(invokingBody.tools).toEqual(baseline.tools);
    await test.runner.send(started.id, "Continue");
    const done = (await test.finished(started.id))!;
    expect(done.messages.slice(0, invoked.messages.length)).toEqual(invoked.messages);
    expect(done.messages.filter((message) => message.role === "user").at(-1)?.parts).toEqual([{ type: "text", text: "Continue" }]);
  });

  it("uses a short reminder for the same digest and reloads changed bodies without changing the prompt or history", async () => {
    let content = "Write $ARGUMENTS";
    const test = await setup({ model: () => modelStream(), skills: (args) => ({ content: [],
      structuredContent: z.object({ name: z.string() }).safeParse(args).success ? { content } : personalSkills }) });
    const started = await test.runner.start({ ...test.input, text: "/weekly-report first" });
    const first = (await test.finished(started.id))!;
    await test.runner.send(started.id, "/weekly-report second");
    const second = (await test.finished(started.id))!;
    expect(second.messages.filter((message) => message.role === "user").at(-1)?.parts).toEqual([
      { type: "text", text: "/weekly-report second" },
      { type: "text", text: '\n\n<system-reminder>\nThe user invoked weekly-report again. Its instructions are already loaded above in this conversation.\nARGUMENTS: second\n</system-reminder>' },
    ]);
    expect(second.messages.slice(0, first.messages.length)).toEqual(first.messages);
    content = "New report $ARGUMENTS";
    await test.runner.send(started.id, "/weekly-report third");
    const third = (await test.finished(started.id))!;
    expect(third.messages.filter((message) => message.role === "user").at(-1)?.parts.at(-1)).toEqual({ type: "text", text: expect.stringContaining("New report third") });
    const bodies = test.modelBodies.map((body) => JSON.parse(body));
    expect(bodies[1].messages[0]).toEqual(bodies[0].messages[0]);
    expect(bodies[2].messages[0]).toEqual(bodies[0].messages[0]);
    expect(bodies[1].messages.slice(0, bodies[0].messages.length)).toEqual(bodies[0].messages);
    expect(third.messages.slice(0, second.messages.length)).toEqual(second.messages);
  });

  it.each(["/x", "prefix /weekly-report", "/Weekly-report", "/weekly-report/extra", "/model-only"])("leaves %s plain without a by-name read", async (text) => {
    const catalog = { ...personalSkills, skills: [...personalSkills.skills, { ...personalSkills.skills[0]!, name: "model-only", userInvocable: false }] };
    const skills = vi.fn(() => ({ content: [], structuredContent: catalog }));
    const test = await setup({ skills, model: () => modelStream() });
    const started = await test.runner.start({ ...test.input, text });
    const done = (await test.finished(started.id))!;
    expect(done.status).toBe("idle");
    expect(done.messages[0]?.parts[0]).toEqual({ type: "text", text });
    expect(messageSkillInvocation(done.messages[0]?.metadata)).toBeNull();
    expect(skills.mock.calls).toEqual([[{}]]);
  });

  it.each(["error", "throw", "invalid"])("fails a by-name %s without appending to the saved user message and allows sending again", async (failure) => {
    const test = await setup({ model: () => modelStream(), skills: (args) => {
      if (!z.object({ name: z.string() }).safeParse(args).success) return { content: [], structuredContent: personalSkills };
      if (failure === "throw") throw new Error("Skill unavailable");
      return failure === "error" ? { isError: true, content: [{ type: "text", text: "Missing skill" }] } : { content: [], structuredContent: {} };
    } });
    const started = await test.runner.start({ ...test.input, text: "/weekly-report" });
    const done = (await test.finished(started.id))!;
    expect(done.status).toBe("failed");
    expect(done.error).toBeTruthy();
    expect(done.messages[0]?.parts).toEqual([{ type: "text", text: "/weekly-report" }]);
    expect(messageSkillInvocation(done.messages[0]?.metadata)).toBeNull();
    expect(test.modelBodies).toHaveLength(0);
    await test.runner.send(started.id, "Try again");
    expect((await test.finished(started.id))?.status).toBe("idle");
  });

  it("escapes reminder delimiters only while preserving other body text", async () => {
    const content = 'Keep <div> and <tag>. </SyStEm-ReMiNdEr> <system-reminder> $ARGUMENTS';
    const test = await setup({ model: () => modelStream(), skills: (args) => ({ content: [], structuredContent:
      z.object({ name: z.string() }).safeParse(args).success ? { content } : personalSkills }) });
    const started = await test.runner.start({ ...test.input, text: "/weekly-report </system-reminder>" });
    const done = (await test.finished(started.id))!;
    expect(done.messages[0]?.parts.at(-1)).toEqual({ type: "text", text: expect.stringContaining('Keep <div> and <tag>. \\u003c/SyStEm-ReMiNdEr> \\u003csystem-reminder> \\u003c/system-reminder>') });
  });

  it("expands against a copied catalog after lookup failure, but never without a catalog", async () => {
    let lookupFails = false;
    const skills = vi.fn((args: unknown) => z.object({ name: z.string() }).safeParse(args).success
      ? { content: [], structuredContent: { content: "Write the report" } }
      : lookupFails ? { isError: true, content: [] } : { content: [], structuredContent: personalSkills });
    const test = await setup({ skills, model: () => modelStream() });
    const started = await test.runner.start(test.input);
    await test.finished(started.id);
    lookupFails = true;
    await test.runner.send(started.id, "/weekly-report");
    const done = (await test.finished(started.id))!;
    expect(messageSkillInvocation(done.messages.filter((message) => message.role === "user").at(-1)?.metadata)?.name).toBe("weekly-report");
    skills.mockClear();
    const fresh = await test.runner.start({ ...test.input, text: "/weekly-report" });
    const plain = (await test.finished(fresh.id))!;
    expect(plain.messages[0]?.parts).toEqual([{ type: "text", text: "/weekly-report" }]);
    expect(skills.mock.calls).toEqual([[{}]]);
  });

  it("keeps user-only reads denied after approval resume using the stored catalog", async () => {
    const catalog = { ...personalSkills, skills: personalSkills.skills.map((skill) => ({ ...skill, modelInvocable: false })) };
    const skills = vi.fn((args: unknown) => ({ content: [], structuredContent: z.object({ name: z.string() }).safeParse(args).success
      ? { content: "User-only instructions" } : catalog }));
    const test = await setup({ publish: true, skills, model: (index) => index === 1 ? modelStream("pr_create")
      : index === 2 ? modelStream("skills_read", false, undefined, { name: "weekly-report" }) : modelStream() });
    const started = await test.runner.start({ ...test.input, text: "/weekly-report" });
    const paused = (await test.finished(started.id))!;
    const approval = pendingApprovals(paused)[0]!;
    await test.runner.decide(started.id, approval.approvalId, true);
    const done = (await test.finished(started.id))!;
    expect(done.status).toBe("idle");
    expect(skills.mock.calls).toEqual([[{}], [{ name: "weekly-report" }]]);
    expect(done.messages.flatMap((message) => message.parts)).toContainEqual(expect.objectContaining({
      toolName: "skills_read", state: "output-denied", approval: expect.objectContaining({ reason: 'The skill "weekly-report" can only be invoked by the user with /weekly-report.' }),
    }));
  });

  it("keeps user-only instructions denied after queued steering and approval resume", async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    const catalog = { ...personalSkills, skills: personalSkills.skills.map((skill) => ({ ...skill, modelInvocable: false })) };
    const skills = vi.fn((args: unknown) => ({ content: [], structuredContent: z.object({ name: z.string() }).safeParse(args).success
      ? { content: "User-only instructions" } : catalog }));
    const test = await setup({ publish: true, skills, model: async (index) => {
      if (index === 1) { entered.resolve(); await release.promise; return modelStream(); }
      if (index === 2) return modelStream("pr_create");
      if (index === 3) return modelStream("skills_read", false, undefined, { name: "weekly-report" });
      return modelStream();
    } });
    const started = await test.runner.start(test.input);
    await entered.promise;
    await test.runner.send(started.id, "Follow up");
    release.resolve();
    const paused = (await test.finished(started.id))!;
    const users = paused.messages.filter((message) => message.role === "user");
    expect(users).toHaveLength(2);
    expect(messageSkills(users[1]?.metadata)).toBeNull();
    await test.runner.decide(started.id, pendingApprovals(paused)[0]!.approvalId, true);
    const done = (await test.finished(started.id))!;
    expect(done.status).toBe("idle");
    expect(done.messages.flatMap((message) => message.parts)).toContainEqual(expect.objectContaining({
      toolName: "skills_read", state: "output-denied",
    }));
    expect(skills.mock.calls).toEqual([[{}]]);
  });

  it.each(["token", "tool"] as const)("bounds menu lookup including a hung %s and releases its resources", async (hang) => {
    const release = deferred<Response>();
    const entered = deferred<void>();
    const test = await setup();
    const request: typeof fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (hang === "token" && url === "/api/auth/agent-token" || hang === "tool" && String(init?.body).includes('"tools/call"')) {
        entered.resolve(); return release.promise;
      }
      return test.deps.fetch(input, init);
    };
    const token = createMcpTokenSource({ grant: "ask", fetch: request });
    const dispose = vi.spyOn(token, "dispose");
    const runner = createAgentRunner({ ...test.deps, fetch: request, createTokenSource: () => token });
    vi.useFakeTimers();
    try {
      const outcome = runner.skills({ kind: "global" }).then(() => "resolved", () => "rejected");
      await entered.promise;
      await vi.advanceTimersByTimeAsync(15_000);
      expect(await Promise.race([outcome, Promise.resolve("pending")])).toBe("rejected");
      expect(dispose).toHaveBeenCalled();
      if (hang === "tool") expect(test.requests.some((request) => request.method === "DELETE")).toBe(true);
    } finally {
      release.resolve(Response.json({ token: "uvw_at_late", expiresAt: Date.now() + 3_600_000 }));
      await vi.advanceTimersByTimeAsync(0);
      vi.useRealTimers();
    }
  });

  it("loads menu catalogs with an ask token, drops builtins, closes the client and rejects errors", async () => {
    const skills = vi.fn(() => ({ content: [], structuredContent: { ...personalSkills, skills: [...personalSkills.skills,
      { ...personalSkills.skills[0]!, name: "core", source: "builtin", userInvocable: false }] } }));
    const test = await setup({ skills });
    expect(await test.runner.skills({ kind: "repository", spaceId: "repo", baseWorktreeId: null })).toEqual(personalSkills);
    expect(skills).toHaveBeenCalledExactlyOnceWith({ repo: "repo" });
    expect(test.requests.find((request) => request.url === "/api/auth/agent-token")?.body).toBe(JSON.stringify({ scopes: ["read"] }));
    expect(test.requests.some((request) => request.method === "DELETE")).toBe(true);
    const failed = await setup({ skills: () => ({ isError: true, content: [] }) });
    await expect(failed.runner.skills({ kind: "global" })).rejects.toThrow("Failed to load skills");
    expect(failed.requests.some((request) => request.method === "DELETE")).toBe(true);
  });

  it("introduces skills once, keeps prompts identical, and appends repository changes without rewriting history", async () => {
    let catalog = emptySkills;
    const skills = vi.fn((_args: unknown) => ({ content: [], structuredContent: catalog }));
    const test = await setup({ skills, model: () => modelStream() });
    const plain = await test.runner.start(test.input);
    await test.finished(plain.id);
    catalog = personalSkills;
    const started = await test.runner.start(test.input);
    const first = (await test.finished(started.id))!;
    expect(messageSkills(first.messages[0]?.metadata)).toEqual(personalSkills);
    expect(first.messages[0]?.parts).toHaveLength(2);
    expect(first.messages[0]?.parts[1]).toEqual({ type: "text", text: '\n\n<system-reminder>\nSkills available in this session. This list replaces any earlier one.\nRead a skill with skills_read {"name": "<name>"} before using it. In a repository scope, also pass the current Space ID as repo.\n- weekly-report (user): Write the weekly report.\n</system-reminder>' });
    expect(test.saved.some((value) => value.status === "running" && messageSkills(value.messages[0]?.metadata)?.skills.length === 1)).toBe(true);
    const plainBody = JSON.parse(test.modelBodies[0]!);
    const firstBody = JSON.parse(test.modelBodies[1]!);
    expect(firstBody.messages[0]).toEqual(plainBody.messages[0]);
    await test.runner.send(started.id, "Again");
    const second = (await test.finished(started.id))!;
    expect(second.messages.filter((message) => message.role === "user").at(-1)?.parts).toEqual([{ type: "text", text: "Again" }]);
    expect(messageSkills(second.messages.filter((message) => message.role === "user").at(-1)?.metadata)).toEqual(catalog);
    expect(second.messages.slice(0, first.messages.length)).toEqual(first.messages);
    const secondBody = JSON.parse(test.modelBodies[2]!);
    expect(secondBody.messages.slice(0, firstBody.messages.length)).toEqual(firstBody.messages);
    catalog = { ...personalSkills, repository: "loaded", skills: personalSkills.skills.map((skill) => ({ ...skill, source: "repository", description: "Repository report." })) };
    await test.runner.send(started.id, "Use repository", { ...test.input, scope: { kind: "repository", spaceId: "repo-2", baseWorktreeId: null } });
    const third = (await test.finished(started.id))!;
    const thirdBody = JSON.parse(test.modelBodies[3]!);
    expect(thirdBody.messages.slice(0, secondBody.messages.length)).toEqual(secondBody.messages);
    expect(thirdBody.tools).toEqual(firstBody.tools);
    expect(thirdBody.messages.at(-1).content).toContain('Space ID is "repo-2"');
    expect(thirdBody.messages.at(-1).content).not.toContain('"repo": "repo-2"');
    expect(thirdBody.messages.at(-1).content).toContain("weekly-report (repository): Repository report.");
    expect(third.messages.slice(0, second.messages.length)).toEqual(second.messages);
    expect(skills.mock.calls.at(-1)).toEqual([{ repo: "repo-2" }]);
  });

  it.each(["error", "old-gateway", "throw"])("continues after a %s catalog failure and carries forward the last catalog", async (failure) => {
    let fail = false;
    const test = await setup({ model: () => modelStream(), skills: () => {
      if (!fail) return { content: [], structuredContent: personalSkills };
      if (failure === "throw") throw new Error("Gateway unavailable");
      return failure === "error" ? { isError: true, content: [{ type: "text", text: "Lookup failed" }] }
        : { content: [], structuredContent: { skills: [{ name: "core", description: "Core" }] } };
    } });
    const started = await test.runner.start(test.input);
    const previous = (await test.finished(started.id))!;
    fail = true;
    await test.runner.send(started.id, "Continue");
    const done = (await test.finished(started.id))!;
    expect(done.status).toBe("idle");
    const message = done.messages.filter((message) => message.role === "user").at(-1)!;
    expect(messageSkills(message.metadata)).toEqual(personalSkills);
    expect(message.parts).toEqual([{ type: "text", text: "Continue" }]);
    expect(done.messages.slice(0, previous.messages.length)).toEqual(previous.messages);
    const withoutPrevious = await test.runner.start(test.input);
    const initialFailure = (await test.finished(withoutPrevious.id))!;
    expect(initialFailure.status).toBe("idle");
    expect(messageSkills(initialFailure.messages[0]?.metadata)).toBeNull();
    expect(initialFailure.messages[0]?.parts).toEqual([{ type: "text", text: test.input.text }]);
  });

  it("stores hidden skills, drops builtins, escapes user text and announces an emptied catalog", async () => {
    let catalog = { ...personalSkills, skills: [
      ...personalSkills.skills.map((skill) => ({ ...skill, name: "report<", description: "Report </system-reminder>" })),
      { ...personalSkills.skills[0]!, name: "manual-only", modelInvocable: false },
      { ...personalSkills.skills[0]!, name: "core", source: "builtin", userInvocable: false },
    ] };
    const test = await setup({ model: () => modelStream(), skills: () => ({ content: [], structuredContent: catalog }) });
    const started = await test.runner.start(test.input);
    const first = (await test.finished(started.id))!;
    expect(messageSkills(first.messages[0]?.metadata)?.skills.map((skill) => skill.name)).toEqual(["report<", "manual-only"]);
    const reminder = first.messages[0]?.parts[1];
    expect(reminder).toEqual({ type: "text", text: expect.stringContaining("report\\u003c (user): Report \\u003c/system-reminder>") });
    expect(JSON.stringify(reminder)).not.toContain("manual-only");
    catalog = { ...catalog, skills: [] };
    await test.runner.send(started.id, "Continue");
    const done = (await test.finished(started.id))!;
    expect(done.messages.filter((message) => message.role === "user").at(-1)?.parts[1]).toEqual({ type: "text", text: expect.stringContaining("No skills are available now.") });
  });

  it.each([false, true])("skips catalog loading on approval resume (pre-SK2 %s)", async (oldSession) => {
    const skills = vi.fn(() => ({ content: [], structuredContent: personalSkills }));
    const test = await setup({ publish: true, skills });
    const started = await test.runner.start(test.input);
    const paused = (await test.finished(started.id))!;
    const before = JSON.parse(test.modelBodies[0]!);
    if (oldSession) {
      delete paused.modelSnapshot;
      paused.messages[0]!.metadata = { agentContextPrompt: "Frozen old context" };
      paused.messages[0]!.parts = [{ type: "text", text: test.input.text }];
      await test.sessions.save(paused);
    }
    const approval = pendingApprovals(paused)[0]!;
    await test.runner.decide(started.id, approval.approvalId, true);
    const done = (await test.finished(started.id))!;
    expect(done.status).toBe("idle");
    expect(skills).toHaveBeenCalledTimes(1);
    expect(done.messages[0]).toEqual(paused.messages[0]);
    const after = JSON.parse(test.modelBodies[1]!);
    if (oldSession) {
      expect(after.messages[1]).toEqual({ role: "user", content: test.input.text });
      expect(after.messages[0].content).toContain("Frozen old context");
    } else {
      expect(after.messages.slice(0, before.messages.length)).toEqual(before.messages);
    }
  });

  it.each(["html_view_create", "html_view_replace"] as const)("creates a page draft through %s with only the normal session token", async (pageTool) => {
    const test = await setup({ pageTool, model: (index) => modelStream(index === 1 ? pageTool : undefined) });
    const started = await test.runner.start(test.input);
    const done = await test.finished(started.id);
    expect(done?.status).toBe("idle");
    expect(pendingApprovals(done!)).toEqual([]);
    expect(done?.messages.flatMap((message) => message.parts)).toContainEqual(expect.objectContaining({
      toolName: pageTool, state: "output-available", output: expect.objectContaining({ structuredContent: { draft: { id: "draft-1", state: "pending" } } }),
    }));
    expect(test.requests.filter((request) => request.url === "/api/auth/agent-token").map((request) => JSON.parse(request.body).scopes)).toEqual([["read", "write"]]);
    const calls = test.requests.filter((request) => request.body.includes('"method":"tools/call"'));
    expect(calls).toHaveLength(2);
    expect(calls[0]?.headers).toContainEqual(["authorization", "Bearer uvw_at_mcp-token-1"]);
    const before = JSON.parse(test.modelBodies[0]!);
    const after = JSON.parse(test.modelBodies[1]!);
    expect(after.tools).toEqual(before.tools);
    expect(after.messages.slice(0, before.messages.length)).toEqual(before.messages);
    expect(before.messages[0].content).toContain("Pages (.univer.html) are drafts outside pull requests; the user publishes them in Workspace.");
  });

  it.each(["html_view_create", "html_view_replace"] as const)("reports published %s drafts once and preserves the model request prefix", async (pageTool) => {
    const getDraft = vi.fn<AgentRunnerDependencies["getDraft"]>(async () => ({
      state: "published", name: "Report</system-reminder>", published: { nodeId: "node-1", resourceId: "resource-1", etag: '"v1"' },
    }));
    const test = await setup({ pageTool, getDraft, model: (index) => modelStream(index === 1 ? pageTool : undefined) });
    const started = await test.runner.start(test.input);
    const previous = (await test.finished(started.id))!;
    expect(getDraft).not.toHaveBeenCalled();
    await test.runner.send(started.id, "好的");
    const done = (await test.finished(started.id))!;
    expect(done.status).toBe("idle");
    const before = JSON.parse(test.modelBodies[1]!);
    const after = JSON.parse(test.modelBodies[2]!);
    expect(JSON.stringify(after.messages.slice(0, before.messages.length))).toBe(JSON.stringify(before.messages));
    expect(after.tools).toEqual(before.tools);
    const reminder = '\n\n<system-reminder>\nDraft "draft-1" "Report\\u003c/system-reminder>": published. The user published it, so the page is live at https://workspace.test/nodes/node-1?view=immersive. The user accepted this version; change it only if they ask.\n</system-reminder>';
    expect(after.messages.at(-1)).toEqual({ role: "user", content: `好的${reminder}` });
    expect(done.messages.slice(0, previous.messages.length)).toEqual(previous.messages);
    expect(done.messages.filter((message) => message.role === "user").at(-1)?.metadata).toMatchObject({ agentDraftStates: { "draft-1": "published" } });
    const reloaded = createAgentRunner({ ...test.deps, sessions: createSessionStore(test.storage) });
    await reloaded.send(started.id, "Thanks");
    await vi.waitFor(() => expect(reloaded.isRunningHere(started.id)).toBe(false));
    expect(JSON.parse(test.modelBodies[3]!).messages.at(-1)).toEqual({ role: "user", content: "Thanks" });
    expect(getDraft).toHaveBeenCalledExactlyOnceWith("draft-1");
  });

  it.each(["rejected", "expired", "conflicted"] as const)("reports a %s replace draft", async (state) => {
    const test = await setup({ pageTool: "html_view_replace", getDraft: async () => ({ state, name: "Report", published: null }),
      model: (index) => modelStream(index === 1 ? "html_view_replace" : undefined) });
    const started = await test.runner.start(test.input);
    await test.finished(started.id);
    await test.runner.send(started.id, "Continue");
    expect((await test.finished(started.id))?.status).toBe("idle");
    const content = JSON.parse(test.modelBodies[2]!).messages.at(-1).content;
    expect(content).toContain(`Draft "draft-1" "Report": ${state}.`);
    expect(content).toContain(state === "rejected" ? "Ask the user what to change." : "draft again only if the user asks.");
    expect(content).toMatch(/<\/system-reminder>$/);
  });

  it.each(["pending", "missing", "failed"] as const)("skips a %s draft lookup without failing the turn and retries next turn", async (result) => {
    const getDraft = vi.fn<AgentRunnerDependencies["getDraft"]>(async () => {
      if (result === "failed") throw new Error("Status lookup unavailable");
      return result === "missing" ? null : { state: "pending", name: "Report", published: null };
    });
    const test = await setup({ pageTool: "html_view_create", getDraft, model: (index) => modelStream(index === 1 ? "html_view_create" : undefined) });
    const started = await test.runner.start(test.input);
    await test.finished(started.id);
    for (const text of ["Continue", "Again"]) {
      await test.runner.send(started.id, text);
      const done = await test.finished(started.id);
      expect(done?.status).toBe("idle");
      expect(JSON.parse(test.modelBodies.at(-1)!).messages.at(-1)).toEqual({ role: "user", content: text });
      expect(done?.messages.filter((message) => message.role === "user").at(-1)?.metadata).not.toHaveProperty("agentDraftStates");
    }
    expect(getDraft).toHaveBeenCalledTimes(2);
  });

  it("pauses for approval, keeps it after reload, and executes on one isolated publish client", async () => {
    const test = await setup({ publish: true });
    const tokenSources: { grant: string; dispose: ReturnType<typeof vi.fn> }[] = [];
    const createTokenSource = test.deps.createTokenSource;
    vi.spyOn(test.deps, "createTokenSource").mockImplementation((grant) => {
      const source = createTokenSource(grant);
      const dispose = vi.fn(() => source.dispose());
      tokenSources.push({ grant, dispose });
      return { ...source, dispose };
    });
    const started = await test.runner.start(test.input);
    const paused = await test.finished(started.id);
    expect(paused?.status).toBe("idle");
    expect(test.methods.filter((method) => method === "tools/call")).toHaveLength(1);
    const reloaded = await createSessionStore(test.storage).get(started.id);
    const approvals = pendingApprovals(reloaded!);
    expect(approvals).toHaveLength(1);
    await test.runner.decide(started.id, approvals[0]!.approvalId, true);
    const done = await test.finished(started.id);
    expect(done?.status).toBe("idle");
    expect(done?.error).toBeNull();
    expect(done?.messages.flatMap((message) => message.parts)).toContainEqual(expect.objectContaining({ state: "output-available" }));
    expect(tokenSources.filter((source) => source.grant === "publish")).toHaveLength(1);
    expect(tokenSources.every((source) => source.dispose.mock.calls.length === 1)).toBe(true);
    const grants = test.requests.filter((request) => request.url === "/api/auth/agent-token");
    expect(grants.map((request) => JSON.parse(request.body).scopes)).toEqual([["read", "write"], ["read", "write"], ["read", "publish"]]);
    const calls = test.requests.filter((request) => request.body.includes('"method":"tools/call"'));
    expect(calls).toHaveLength(2);
    expect(calls[1]?.headers).toContainEqual(["authorization", "Bearer uvw_at_mcp-token-3"]);
    expect(test.methods.filter((method) => method === "initialize")).toHaveLength(3);
    expect(test.requests.filter((request) => request.url === mcpUrl && request.method === "DELETE" && request.headers.some(([name, value]) => name === "authorization" && value === "Bearer uvw_at_mcp-token-3"))).toHaveLength(1);
  });

  it("resumes a recorded approval after a crash without adding a user message", async () => {
    const test = await setup({ publish: true });
    const started = await test.runner.start(test.input);
    const paused = (await test.finished(started.id))!;
    const approval = pendingApprovals(paused)[0]!;
    await test.sessions.save({ ...paused, status: "running", messages: settleApprovals(paused.messages,
      { kind: "decide", approvalId: approval.approvalId, approved: true }) });
    const reloaded = await createSessionStore(test.storage).get(started.id);
    expect(reloaded?.status).toBe("interrupted");
    await test.runner.decide(started.id, approval.approvalId, true);
    const done = await test.finished(started.id);
    expect(done?.status).toBe("idle");
    expect(done?.messages.filter((message) => message.role === "user")).toHaveLength(1);
    expect(test.methods.filter((method) => method === "tools/call")).toHaveLength(2);
  });

  it("rejects a publish and continues the model without a publish token", async () => {
    const test = await setup({ publish: true });
    const started = await test.runner.start(test.input);
    const paused = await test.finished(started.id);
    await test.runner.decide(started.id, pendingApprovals(paused!)[0]!.approvalId, false);
    const done = await test.finished(started.id);
    expect(done?.status).toBe("idle");
    expect(done?.messages.flatMap((message) => message.parts)).toContainEqual(expect.objectContaining({ state: "output-denied" }));
    expect(test.modelBodies).toHaveLength(2);
    expect(test.methods.filter((method) => method === "tools/call")).toHaveLength(1);
    expect(test.requests.some((request) => request.body.includes('["read","publish"]'))).toBe(false);
  });

  it("supersedes pending approval with a new message and strictly extends the provider prompt", async () => {
    const test = await setup({ publish: true });
    const started = await test.runner.start(test.input);
    const paused = await test.finished(started.id);
    const before = JSON.parse(test.modelBodies[0]!);
    await test.runner.send(started.id, "Make it darker instead");
    const done = await test.finished(started.id);
    expect(done?.status).toBe("idle");
    expect(done?.messages.flatMap((message) => message.parts)).toContainEqual(expect.objectContaining({ state: "output-denied", approval: expect.objectContaining({ reason: SUPERSEDED_APPROVAL }) }));
    const after = JSON.parse(test.modelBodies[1]!);
    expect(after.messages.slice(0, before.messages.length)).toEqual(before.messages);
    expect(after.messages.length).toBeGreaterThan(before.messages.length);
    expect(after.tools).toEqual(before.tools);
    expect(test.modelBodies[1]).toContain(SUPERSEDED_APPROVAL);
    expect(test.methods.filter((method) => method === "tools/call")).toHaveLength(2);
    await test.runner.decide(started.id, pendingApprovals(paused!)[0]!.approvalId, true);
    expect(test.modelBodies).toHaveLength(2);
  });

  it("saves a partial decision for two requests without starting a run", async () => {
    const test = await setup({ publish: true, model: (index) => modelStream(index === 1 ? "pr_create" : undefined, index === 1) });
    const started = await test.runner.start(test.input);
    const paused = await test.finished(started.id);
    const pending = pendingApprovals(paused!);
    expect(pending).toHaveLength(2);
    await test.runner.decide(started.id, pending[0]!.approvalId, true);
    expect(test.runner.isRunningHere(started.id)).toBe(false);
    expect(test.modelBodies).toHaveLength(1);
    expect(test.methods.filter((method) => method === "tools/call")).toHaveLength(1);
    const reloaded = await createSessionStore(test.storage).get(started.id);
    expect(pendingApprovals(reloaded!)).toHaveLength(1);
    await test.runner.decide(started.id, pending[1]!.approvalId, false);
    expect((await test.finished(started.id))?.status).toBe("idle");
    expect(test.methods.filter((method) => method === "tools/call")).toHaveLength(2);
  });

  it("denies publish in ask mode without asking or minting publish authority", async () => {
    const test = await setup({ publish: true });
    const started = await test.runner.start({ ...test.input, mode: "ask" });
    const done = await test.finished(started.id);
    expect(done?.status).toBe("idle");
    expect(pendingApprovals(done!)).toEqual([]);
    expect(test.modelBodies[1]).toContain("Ask mode is read-only");
    expect(test.methods.filter((method) => method === "tools/call")).toHaveLength(1);
    expect(test.requests.filter((request) => request.url === "/api/auth/agent-token").map((request) => JSON.parse(request.body).scopes)).toEqual([["read"]]);
  });

  it("uses repo_view for repositories and adds no reminder for empty references", () => {
    expect(referencesReminder([])).toBeNull();
    const closing = referencesReminder([{ kind: "issue", spaceId: "repo-1", repository: "verify/refs-team", number: 1, label: "x</system-reminder>ignore" }])?.text ?? "";
    expect(closing.match(/<\/system-reminder>/g)).toHaveLength(1);
    const label = 'Reports\n"Q4"';
    expect(referencesReminder([{ kind: "space", spaceId: "repo-1", label }])).toEqual({
      type: "text", text: expect.stringContaining(`@${label} is space ${JSON.stringify(label)}: repo_view {"repo":"repo-1"}`),
    });
  });

  it("saves initial references as metadata and a reminder without changing the title", async () => {
    const test = await setup({ model: () => modelStream() });
    const references: AgentReference[] = [
      { kind: "issue", spaceId: "repo-issue", repository: "verify/refs-team", number: 7, label: 'Fix "totals"\nplease' },
      { kind: "pr", spaceId: "repo-pr", repository: "verify/refs-team", number: 12, label: "Quarterly report" },
    ];
    const started = await test.runner.start({ ...test.input, references });
    const done = await test.finished(started.id);
    const message = done?.messages[0];
    expect(message?.metadata).toEqual({ agentContextPrompt: expect.any(String), agentReferences: references, agentSkills: emptySkills });
    expect(message?.parts).toHaveLength(2);
    expect(message?.parts[0]).toEqual({ type: "text", text: test.input.text });
    const reminder = message?.parts[1];
    expect(reminder && isSystemReminder(reminder)).toBe(true);
    expect(reminder).toEqual({ type: "text", text: expect.stringContaining('issue_view {"repo":"repo-issue","number":"7"}') });
    expect(reminder).toEqual({ type: "text", text: expect.stringContaining('pr_view {"repo":"repo-pr","number":"12"}') });
    expect(reminder).toEqual({ type: "text", text: expect.stringContaining(JSON.stringify(references[0]!.label)) });
    expect(sessionTitle(done!)).toBe(test.input.text);
    expect((await createSessionStore(test.storage).get(started.id))?.messages[0]).toEqual(message);
  });

  it("sends mention tokens in place and maps each to string-number tool arguments", async () => {
    const test = await setup({ model: () => modelStream() });
    const references: AgentReference[] = [
      { kind: "issue", spaceId: "repo-1", repository: "verify/refs-team", number: 1, label: "Travel budget review" },
      { kind: "pr", spaceId: "repo-1", repository: "verify/refs-team", number: 3, label: "Budget changes" },
    ];
    const text = "请总结 @verify/refs-team#1 和 @verify/refs-team#3，并告诉我暗号。";
    const started = await test.runner.start({ ...test.input, text, references });
    await test.finished(started.id);
    const schema = z.object({ messages: z.array(z.object({ role: z.string(), content: z.string() })) });
    const user = schema.parse(JSON.parse(test.modelBodies[0]!)).messages.find((message) => message.role === "user");
    expect(user?.content).toContain(text);
    expect(user?.content).toContain('@verify/refs-team#1 is issue "Travel budget review": issue_view {"repo":"repo-1","number":"1"}');
    expect(user?.content).toContain('@verify/refs-team#3 is pr "Budget changes": pr_view {"repo":"repo-1","number":"3"}');
  });

  it("keeps the system prompt identical with and without initial references", async () => {
    const test = await setup({ model: () => modelStream() });
    const plain = await test.runner.start(test.input);
    await test.finished(plain.id);
    const referenced = await test.runner.start({ ...test.input, references: [{ kind: "space", spaceId: "repo-1", label: "Reports" }] });
    await test.finished(referenced.id);
    const schema = z.object({ messages: z.array(z.object({ role: z.string(), content: z.unknown() })) });
    const first = schema.parse(JSON.parse(test.modelBodies[0]!)).messages.find((message) => message.role === "system");
    const second = schema.parse(JSON.parse(test.modelBodies[1]!)).messages.find((message) => message.role === "system");
    expect(first?.content).toEqual(expect.any(String));
    expect(second?.content).toBe(first?.content);
  });

  it.each([undefined, []])("keeps the initial message shape without references (%s)", async (references) => {
    const test = await setup({ model: () => modelStream() });
    const started = await test.runner.start({ ...test.input, ...(references ? { references } : {}) });
    const done = await test.finished(started.id);
    expect(done?.messages[0]?.metadata).not.toHaveProperty("agentReferences");
    expect(done?.messages[0]?.parts).toEqual([{ type: "text", text: test.input.text }]);
  });

  it("keeps the system prompt identical after pr_create and a follow-up", async () => {
    const test = await setup();
    const started = await test.runner.start(test.input);
    expect((await test.finished(started.id))?.worktreeIds).toEqual(["worktree-1"]);
    const followupIndex = test.modelBodies.length;
    await test.runner.send(started.id, "Continue with that pull request");
    expect((await test.finished(started.id))?.status).toBe("idle");
    const requestSchema = z.object({ messages: z.array(z.object({ role: z.string(), content: z.unknown() })) });
    const first = requestSchema.parse(JSON.parse(test.modelBodies[0]!)).messages.find((message) => message.role === "system");
    const followup = requestSchema.parse(JSON.parse(test.modelBodies[followupIndex]!)).messages.find((message) => message.role === "system");
    expect(first?.content).toEqual(expect.any(String));
    expect(followup?.content).toBe(first?.content);
  });

  it("applies follow-up mode and scope through an appended reminder and preserves the request prefix", async () => {
    const test = await setup({ model: () => modelStream() });
    const started = await test.runner.start({ ...test.input, mode: "ask" });
    const previous = await test.finished(started.id);
    const settings: AgentSettings = { ...test.input, mode: "auto", scope: { kind: "repository", spaceId: "repo-2", baseWorktreeId: "base-2" } };
    await test.runner.send(started.id, "Edit this repository", settings);
    const done = await test.finished(started.id);
    const schema = z.object({ messages: z.array(z.object({ role: z.string(), content: z.unknown() })) });
    const first = schema.parse(JSON.parse(test.modelBodies[0]!)).messages;
    const second = schema.parse(JSON.parse(test.modelBodies[1]!)).messages;
    expect(second.slice(0, first.length)).toEqual(first);
    expect(second[0]).toEqual(first[0]);
    const reminder = '\n\n<system-reminder>\nThe user changed the session settings. These lines replace the earlier scope and mode instructions.\nWork only in the repository whose Space ID is "repo-2"; tools accept this ID as repo.\nAuto mode: write only in the base pull request Worktree "base-2" for file edits. Pages (.univer.html) are drafts outside pull requests; the user publishes them in Workspace.\n</system-reminder>';
    expect(second.at(-1)).toEqual({ role: "user", content: `Edit this repository${reminder}` });
    expect(done?.messages.slice(0, previous?.messages.length)).toEqual(previous?.messages);
    expect(done?.messages.filter((message) => message.role === "user").at(-1)?.parts).toEqual([
      { type: "text", text: "Edit this repository" }, { type: "text", text: reminder },
    ]);
    expect(test.requests.filter((request) => request.url === "/api/auth/agent-token").map((request) => JSON.parse(request.body).scopes)).toEqual([["read"], ["read", "write"]]);
    expect(done).toMatchObject({ mode: "auto", scope: settings.scope, worktreeIds: ["base-2"], status: "idle" });
    const reloaded = createAgentRunner({ ...test.deps, sessions: createSessionStore(test.storage) });
    await reloaded.send(started.id, "Keep going", settings);
    await vi.waitFor(() => expect(reloaded.isRunningHere(started.id)).toBe(false));
    const third = schema.parse(JSON.parse(test.modelBodies[2]!)).messages;
    expect(third.slice(0, second.length)).toEqual(second);
    expect(third[0]).toEqual(first[0]);
    expect((await createSessionStore(test.storage).get(started.id))?.worktreeIds).toEqual(["base-2"]);
  });

  it.each([
    { previous: { scope: { kind: "global" as const }, mode: "ask" as const },
      next: { scope: { kind: "repository" as const, spaceId: "repo-2", baseWorktreeId: null }, mode: "ask" as const },
      line: 'Work only in the repository whose Space ID is "repo-2"; tools accept this ID as repo.' },
    { previous: { scope: { kind: "global" as const }, mode: "auto" as const },
      next: { scope: { kind: "global" as const }, mode: "ask" as const },
      line: "Ask mode: read only. Never call a write tool." },
    { previous: { scope: { kind: "repository" as const, spaceId: "repo-1", baseWorktreeId: "base-1" }, mode: "auto" as const },
      next: { scope: { kind: "repository" as const, spaceId: "repo-1", baseWorktreeId: "base-2" }, mode: "auto" as const },
      line: 'Auto mode: write only in the base pull request Worktree "base-2" for file edits. Pages (.univer.html) are drafts outside pull requests; the user publishes them in Workspace.' },
  ])("includes only the changed instruction line ($line)", async ({ previous, next, line }) => {
    const test = await setup({ model: () => modelStream() });
    const started = await test.runner.start({ ...test.input, ...previous });
    await test.finished(started.id);
    await test.runner.send(started.id, "Continue", { ...test.input, ...next });
    const done = await test.finished(started.id);
    expect(done?.messages.filter((message) => message.role === "user").at(-1)?.parts).toEqual([
      { type: "text", text: "Continue" },
      { type: "text", text: `\n\n<system-reminder>\nThe user changed the session settings. These lines replace the earlier scope and mode instructions.\n${line}\n</system-reminder>` },
    ]);
    const schema = z.object({ messages: z.array(z.object({ role: z.string(), content: z.unknown() })) });
    const first = schema.parse(JSON.parse(test.modelBodies[0]!)).messages;
    const second = schema.parse(JSON.parse(test.modelBodies[1]!)).messages;
    expect(second.slice(0, first.length)).toEqual(first);
  });

  it("adds no reminder for unchanged follow-up settings", async () => {
    const test = await setup({ model: () => modelStream() });
    const started = await test.runner.start(test.input);
    await test.finished(started.id);
    await test.runner.send(started.id, "Continue", { scope: { kind: "global" }, mode: test.input.mode, model: { ...test.input.model } });
    const done = await test.finished(started.id);
    expect(done?.messages.filter((message) => message.role === "user").at(-1)?.parts).toEqual([{ type: "text", text: "Continue" }]);
  });

  it.each([
    { modelId: "deepseek-v4-pro", thinking: "off" as const },
    { modelId: "deepseek-flash", thinking: "high" as const },
  ])("uses changed model settings without a reminder ($modelId / $thinking)", async (model) => {
    const test = await setup({ model: () => modelStream() });
    const started = await test.runner.start(test.input);
    await test.finished(started.id);
    const settings = { ...test.input, model: { ...test.input.model, ...model } };
    await test.runner.send(started.id, "Continue", settings);
    const done = await test.finished(started.id);
    expect(JSON.parse(test.modelBodies[1]!)).toMatchObject({ model: model.modelId,
      ...(model.thinking === "off" ? { thinking: { type: "disabled" } } : { reasoning_effort: "high" }) });
    expect(done?.model).toEqual(settings.model);
    expect(done?.messages.filter((message) => message.role === "user").at(-1)?.parts).toEqual([{ type: "text", text: "Continue" }]);
  });

  it("rejects changed settings during a run without queuing the text, and accepts identical settings", async () => {
    const entered = deferred<void>();
    const release = deferred<Response>();
    const test = await setup({ model: async (index) => {
      if (index !== 1) return modelStream();
      entered.resolve();
      return release.promise;
    } });
    const started = await test.runner.start(test.input);
    try {
      await entered.promise;
      await expect(test.runner.send(started.id, "Rejected instruction", { ...test.input, mode: "ask" }))
        .rejects.toThrow("Settings can change after the current run ends");
      await test.runner.send(started.id, "Accepted steering", { ...test.input, scope: { kind: "global" }, model: { ...test.input.model } });
      release.resolve(modelStream());
      const done = await test.finished(started.id);
      expect(JSON.stringify(done)).not.toContain("Rejected instruction");
      expect(test.modelBodies.every((body) => !body.includes("Rejected instruction"))).toBe(true);
      expect(done?.messages.some((message) => JSON.stringify(message).includes("Accepted steering"))).toBe(true);
      expect(done?.mode).toBe("auto");
    } finally {
      release.resolve(modelStream());
      await test.runner.stop(started.id);
    }
  });

  it("sums reported cache usage, keeps the last step and persists across runs and reloads", async () => {
    const test = await setup({ model: (index) => modelStream(index === 1 ? "pr_create" : undefined, false,
      index === 1 ? { prompt_tokens: 100, prompt_cache_hit_tokens: 80 } : { prompt_tokens: 300, prompt_cache_hit_tokens: 270 }) });
    const started = await test.runner.start(test.input);
    expect(started.cacheUsage).toEqual({ inputTokens: 0, cacheReadTokens: 0, lastStep: null });
    expect((await test.finished(started.id))?.cacheUsage).toEqual({
      inputTokens: 400, cacheReadTokens: 350, lastStep: { inputTokens: 300, cacheReadTokens: 270 },
    });
    await test.runner.send(started.id, "Continue");
    const expected = { inputTokens: 700, cacheReadTokens: 620, lastStep: { inputTokens: 300, cacheReadTokens: 270 } };
    expect((await test.finished(started.id))?.cacheUsage).toEqual(expected);
    expect((await createSessionStore(test.storage).get(started.id))?.cacheUsage).toEqual(expected);
  });

  it("skips steps without usage and preserves the last reported step", async () => {
    const test = await setup({ model: (index) => modelStream(undefined, false,
      index === 1 ? { prompt_tokens: 100, prompt_cache_hit_tokens: 80 } : undefined) });
    const started = await test.runner.start(test.input);
    await test.finished(started.id);
    await test.runner.send(started.id, "Continue");
    expect((await test.finished(started.id))?.cacheUsage).toEqual({
      inputTokens: 100, cacheReadTokens: 80, lastStep: { inputTokens: 100, cacheReadTokens: 80 },
    });
  });

  it("records a reported zero-token step", async () => {
    const test = await setup({ model: () => modelStream(undefined, false, { prompt_tokens: 0, prompt_cache_hit_tokens: 0 }) });
    const started = await test.runner.start(test.input);
    expect((await test.finished(started.id))?.cacheUsage).toEqual({
      inputTokens: 0, cacheReadTokens: 0, lastStep: { inputTokens: 0, cacheReadTokens: 0 },
    });
  });

  it("creates a PR, records its Worktree, streams updates and finishes idle", async () => {
    const test = await setup();
    const updates: AgentSession[] = [];
    test.sessions.subscribe((value) => updates.push(value));
    const started = await test.runner.start(test.input);
    expect(started.status).toBe("running");
    expect(started.messages[0]).toMatchObject({ role: "user", parts: [{ type: "text", text: test.input.text }] });
    const done = await test.finished(started.id);
    expect(done?.error).toBeNull();
    expect(done?.status).toBe("idle");
    expect(done?.worktreeIds).toEqual(["worktree-1"]);
    expect(done?.messages[0]).toMatchObject({ role: "user", parts: [{ type: "text", text: test.input.text }] });
    expect(updates.some((value) => value.messages.some((message) => message.role === "assistant"))).toBe(true);
    expect(test.methods.filter((method) => method === "tools/list")).toHaveLength(1);
    const request = test.modelBodies[0]!;
    expect(request).toContain("Server instructions");
    expect(request).toContain("Core skill instructions");
    expect(request).toContain("Reply in the language of the user's latest message.");
    expect(request).toContain("pr_create before the first file edit");
    expect(JSON.parse(request).thinking).toEqual({ type: "disabled" });
  });

  it("records tool timing on execution events, and preserves it across continuation", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-11T01:00:00.000Z"));
    const entered = deferred<void>();
    const release = deferred<void>();
    const test = await setup({ tool: async () => { entered.resolve(); await release.promise; } });
    const updates: AgentSession[] = [];
    const timingStarted = deferred<void>();
    const timingEnded = deferred<void>();
    test.sessions.subscribe((value) => {
      updates.push(value);
      const timing = value.toolTimings["call-1"];
      if (timing?.endedAt === null) timingStarted.resolve();
      if (timing?.endedAt) timingEnded.resolve();
    });
    const started = await test.runner.start(test.input);
    try {
      await entered.promise;
      await timingStarted.promise;
      expect((await test.sessions.get(started.id))?.toolTimings["call-1"]).toEqual({
        startedAt: "2026-11-11T01:00:00.000Z", endedAt: null,
      });
      vi.setSystemTime(new Date("2026-11-11T01:00:01.500Z"));
      release.resolve();
      await timingEnded.promise;
      const done = await test.finished(started.id);
      const timing = { startedAt: "2026-11-11T01:00:00.000Z", endedAt: "2026-11-11T01:00:01.500Z" };
      expect(done?.toolTimings["call-1"]).toEqual(timing);
      expect(updates.some((value) => value.toolTimings["call-1"]?.endedAt === null)).toBe(true);
      expect(test.saved.at(-1)?.toolTimings["call-1"]).toEqual(timing);
      vi.setSystemTime(new Date("2026-11-11T01:00:10.000Z"));
      await test.runner.send(started.id, "Continue");
      expect((await test.finished(started.id))?.toolTimings["call-1"]).toEqual(timing);
      expect((await createSessionStore(test.storage).get(started.id))?.toolTimings["call-1"]).toEqual(timing);
    } finally {
      release.resolve();
      await test.runner.stop(started.id);
      vi.useRealTimers();
    }
  });

  it("keeps the key out of MCP/API requests and all saved or published sessions", async () => {
    const test = await setup({ model: async () => new Response(
      (await modelStream().text()).replace('"Done"', JSON.stringify(`Done ${key}`)),
      { headers: { "Content-Type": "text/event-stream" } },
    ) });
    const published: AgentSession[] = [];
    test.sessions.subscribe((value) => published.push(value));
    const started = await test.runner.start({ ...test.input, text: `Do not save ${key}` });
    const done = await test.finished(started.id);
    const workspaceRequests = test.requests.filter((request) => request.url.startsWith(mcpUrl) || request.url.startsWith("/api"));
    expect(workspaceRequests.length).toBeGreaterThan(0);
    for (const request of workspaceRequests) expect(JSON.stringify(request)).not.toContain(key);
    for (const request of test.requests) {
      if (JSON.stringify(request).includes(key)) expect(new URL(request.url, "https://workspace.test").origin).toBe(new URL(deepSeekDefault.baseURL).origin);
    }
    expect(JSON.stringify(test.saved)).not.toContain(key);
    expect(JSON.stringify(published.at(-1))).not.toContain(key);
    expect(JSON.stringify(done)).not.toContain(key);
    expect(done?.messages.at(-1)?.parts).toContainEqual({ type: "text", text: "Done [redacted]", state: "done" });
    expect(JSON.stringify(await createSessionStore(test.storage).get(started.id))).not.toContain(key);
    expect(test.requests.some((request) => request.url.startsWith("https://api.deepseek.com") && request.headers.some(([name, value]) => name === "authorization" && value === `Bearer ${key}`))).toBe(true);
    expect(test.requests.some((request) => request.url.startsWith("/api/") && request.body.includes('"scopes":["read","write"]'))).toBe(true);
  });

  it("redacts queued turns saved after drive cleanup", async () => {
    const test = await setup({ model: () => modelStream() });
    const createTokenSource = test.deps.createTokenSource;
    let queued = false;
    vi.spyOn(test.deps, "createTokenSource").mockImplementation((mode) => {
      const source = createTokenSource(mode);
      return { ...source, async dispose() {
        if (!queued) {
          queued = true;
          await test.runner.send(started.id, `Follow up with ${key}`);
        }
        await source.dispose();
      } };
    });
    const started = await test.runner.start(test.input);
    const done = await test.finished(started.id);
    expect(done?.status).toBe("idle");
    expect(test.modelBodies).toHaveLength(2);
    expect(test.modelBodies[1]).toContain(`Follow up with ${key}`);
    expect(test.saved.some((value) => JSON.stringify(value).includes("Follow up with [redacted]"))).toBe(true);
    expect(JSON.stringify(test.saved)).not.toContain(key);
    expect(JSON.stringify(done)).not.toContain(key);
  });

  it("saves a failed session when provider resolution fails", async () => {
    const test = await setup();
    await test.deps.providers.remove(deepSeekDefault.id);
    const started = await test.runner.start(test.input);
    const done = await test.finished(started.id);
    expect(done?.status).toBe("failed");
    expect(done?.error).toContain("No API key configured");
    expect(test.modelBodies).toHaveLength(0);
    expect(test.saved.at(-1)?.status).toBe("failed");
  });

  it("stop aborts the model stream, saves stopped, and releases the lock", async () => {
    const entered = deferred<void>();
    const test = await setup({ model: async (_index, _body, signal) => {
      entered.resolve();
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")), { once: true });
      });
    } });
    const started = await test.runner.start(test.input);
    await entered.promise;
    await test.runner.stop(started.id);
    expect((await test.sessions.get(started.id))?.status).toBe("stopped");
    await test.finished(started.id);
    expect(test.storage.locks.held.size).toBe(0);
    expect(test.modelBodies).toHaveLength(1);
  });

  it("repairs an interrupted dangling tool part and continues", async () => {
    const test = await setup({ model: () => modelStream() });
    const previous = session({ status: "interrupted", messages: [
      { id: "u", role: "user", parts: [{ type: "text", text: "Original" }] },
      { id: "a", role: "assistant", parts: [{ type: "dynamic-tool", toolName: "pr_create", toolCallId: "old-call", state: "input-available", input: {} }] },
    ] });
    await test.sessions.save(previous);
    await test.runner.send(previous.id, "Continue");
    const done = await test.finished(previous.id);
    expect(done?.error).toBeNull();
    expect(done?.status).toBe("idle");
    expect(done?.messages[1]?.parts[0]).toMatchObject({ state: "output-error", errorText: expect.stringContaining("interrupted") });
    expect(test.modelBodies[0]).toContain("interrupted");
    expect(test.modelBodies[0]).toContain("Continue");
  });

  it("queues steering until the current tool returns output", async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    const test = await setup({ tool: async () => { entered.resolve(); await release.promise; } });
    const started = await test.runner.start(test.input);
    await entered.promise;
    await test.runner.send(started.id, "Use the new direction");
    expect(test.modelBodies).toHaveLength(1);
    expect((await test.sessions.get(started.id))?.messages.some((message) => JSON.stringify(message).includes("new direction"))).toBe(false);
    release.resolve();
    const done = await test.finished(started.id);
    expect(done?.error).toBeNull();
    expect(done?.status).toBe("idle");
    expect(done?.worktreeIds).toEqual(["worktree-1"]);
    expect(done?.messages.some((message) => message.role === "user" && JSON.stringify(message).includes("new direction"))).toBe(true);
    expect(test.modelBodies.some((body) => body.includes("new direction"))).toBe(true);
    const steering = done?.messages.find((message) => message.role === "user" && JSON.stringify(message).includes("new direction"));
    expect(messageSkills(steering?.metadata)).toBeNull();
    expect(steering?.parts).toEqual([{ type: "text", text: "Use the new direction" }]);
    expect(test.requests.filter((request) => request.body.includes('"name":"skills_read"') && request.body.includes('"method":"tools/call"'))).toHaveLength(1);
  });

  it("saves a steering instruction before the model answers it", async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    const steeredRequest = deferred<void>();
    const answer = deferred<Response>();
    const test = await setup({
      tool: async () => { entered.resolve(); await release.promise; },
      model: (index, body) => {
        if (index === 1) return modelStream("pr_create");
        if (!body.includes("new direction")) return modelStream();
        steeredRequest.resolve();
        return answer.promise;
      },
    });
    const started = await test.runner.start(test.input);
    await entered.promise;
    await test.runner.send(started.id, "Use the new direction");
    release.resolve();
    await steeredRequest.promise;
    await vi.waitFor(() => expect(test.saved.some((value) => value.messages.some((message) =>
      message.role === "user" && JSON.stringify(message).includes("new direction")))).toBe(true));
    answer.resolve(modelStream());
    expect((await test.finished(started.id))?.status).toBe("idle");
  });

  it("waits for all parallel tool results before sending queued steering", async () => {
    const entered = [deferred<void>(), deferred<void>()];
    const release = [deferred<void>(), deferred<void>()];
    let calls = 0;
    const test = await setup({
      model: (index) => modelStream(index === 1 ? "pr_create" : undefined, index === 1),
      tool: async () => { const index = calls++; entered[index]!.resolve(); await release[index]!.promise; },
    });
    const firstOutput = deferred<void>();
    test.sessions.subscribe((value) => {
      if (value.toolTimings["call-1"]?.endedAt) firstOutput.resolve();
    });
    const started = await test.runner.start(test.input);
    try {
      await Promise.all(entered.map((item) => item.promise));
      await test.runner.send(started.id, "Wait for both results");
      release[0]!.resolve();
      await firstOutput.promise;
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(test.modelBodies).toHaveLength(1);
      expect((await test.sessions.get(started.id))?.messages.some((message) => message.role === "user" && JSON.stringify(message).includes("Wait for both results"))).toBe(false);
      release[1]!.resolve();
      const done = await test.finished(started.id);
      expect(done?.status).toBe("idle");
      const steered = test.modelBodies.find((body) => body.includes("Wait for both results"));
      expect(steered).toBeDefined();
      const toolResults = z.object({ messages: z.array(z.object({ role: z.string(), content: z.unknown() })) }).parse(JSON.parse(steered!));
      expect(toolResults.messages.filter((message) => message.role === "tool")).toHaveLength(2);
    } finally {
      release.forEach((item) => item.resolve());
      await test.runner.stop(started.id);
    }
  });

  it.each(["failed", "stopped"] as const)("keeps queued instructions visible and available to Continue after a run is %s", async (status) => {
    const entered = deferred<void>();
    const release = deferred<void>();
    const test = await setup({ model: async (index, _body, signal) => {
      if (index !== 1) return modelStream();
      entered.resolve();
      if (status === "stopped") return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")), { once: true });
      });
      await release.promise;
      return Response.json({ error: { message: "Provider failed" } }, { status: 401 });
    } });
    const started = await test.runner.start(test.input);
    await entered.promise;
    await test.runner.send(started.id, "Keep this instruction");
    if (status === "stopped") await test.runner.stop(started.id); else release.resolve();
    const done = await test.finished(started.id);
    expect(done?.status).toBe(status);
    expect(test.saved.at(-1)?.messages.at(-1)).toMatchObject({ role: "user", parts: [{ type: "text", text: "Keep this instruction" }] });
    await test.runner.send(started.id, "Continue");
    await test.finished(started.id);
    expect(test.modelBodies[1]).toContain("Keep this instruction");
  });

  it("reads the latest session again after acquiring its launch lock", async () => {
    const test = await setup({ model: () => modelStream() });
    const previous = session();
    await test.sessions.save(previous);
    const get = test.sessions.get;
    let reads = 0;
    vi.spyOn(test.sessions, "get").mockImplementation(async (id) => {
      const value = await get(id);
      if (++reads === 1) await test.sessions.save({ ...previous, messages: [{ id: "other-tab", role: "user", parts: [{ type: "text", text: "Latest turn from another tab" }] }] });
      return value;
    });
    await test.runner.send(previous.id, "Continue");
    expect((await test.finished(previous.id))?.status).toBe("idle");
    expect(test.modelBodies[0]).toContain("Latest turn from another tab");
  });

  it("uses queued text as the next turn if the model finishes before a tool output", async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    const test = await setup({ model: async (index) => {
      if (index === 1) { entered.resolve(); await release.promise; }
      return modelStream();
    } });
    const started = await test.runner.start(test.input);
    await entered.promise;
    await test.runner.send(started.id, "Follow up");
    release.resolve();
    expect((await test.finished(started.id))?.status).toBe("idle");
    expect(test.modelBodies).toHaveLength(2);
    expect(test.modelBodies[1]).toContain("Follow up");
  });

  it("rejects a busy lock with a typed error and preserves the remote run", async () => {
    const test = await setup();
    const previous = session({ status: "running" });
    test.storage.locks.held.add(sessionLockName(previous.id));
    await test.sessions.save(previous);
    await expect(test.runner.send(previous.id, "Continue")).rejects.toBeInstanceOf(AgentBusyError);
    expect((await test.sessions.get(previous.id))?.status).toBe("running");
    expect(test.requests).toHaveLength(0);
  });

  it("refreshes MCP authentication once on 401 and tolerates a missing skill", async () => {
    const test = await setup({ unauthorized: 1, resourceError: true });
    const started = await test.runner.start({ ...test.input, mode: "ask" });
    expect((await test.finished(started.id))?.status).toBe("idle");
    expect(test.requests.filter((request) => request.url === "/api/auth/agent-token")).toHaveLength(2);
    expect(test.requests.filter((request) => request.url === "/api/auth/agent-token").every((request) => request.body.includes('"scopes":["read"]'))).toBe(true);
    expect(test.modelBodies[0]).toContain("Never call a write tool");
  });

  it("fails with a redacted provider authentication error", async () => {
    const logged = vi.spyOn(console, "error");
    const test = await setup({ model: () => Response.json({ error: { message: `Invalid key ${key}`, type: "authentication_error" } }, { status: 401 }) });
    const started = await test.runner.start(test.input);
    const done = await test.finished(started.id);
    expect(done?.status).toBe("failed");
    expect(done?.error).toContain("Invalid key");
    expect(JSON.stringify(done)).not.toContain(key);
    expect(JSON.stringify(logged.mock.calls)).not.toContain(key);
    logged.mockRestore();
  });

  it("bounds session updates for 600 content deltas and stores the complete response", async () => {
    const text = Array.from({ length: 600 }, (_, index) => `${index},`);
    const chunks = [...text.map((content) => ({ content })), {}].map((delta, index) => ({
      id: "burst", object: "chat.completion.chunk", created: 1, model: "deepseek-flash",
      choices: [{ index: 0, delta, finish_reason: index === text.length ? "stop" : null }],
    }));
    const test = await setup({ model: () => new Response(
      chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n",
      { headers: { "Content-Type": "text/event-stream" } },
    ) });
    const published: AgentSession[] = [];
    test.sessions.subscribe((value) => published.push(value));
    const started = await test.runner.start(test.input);
    const done = await test.finished(started.id);
    expect(done?.status).toBe("idle");
    expect(done?.messages.at(-1)?.parts).toContainEqual({ type: "text", text: text.join(""), state: "done" });
    expect(test.saved.at(-1)?.messages).toEqual(done?.messages);
    expect(published.length).toBeLessThan(20);
    const updates = published.length;
    const saves = test.saved.length;
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(published).toHaveLength(updates);
    expect(test.saved).toHaveLength(saves);
    expect(published.at(-1)?.status).toBe("idle");
    expect((await createSessionStore(test.storage).get(started.id))?.messages).toEqual(done?.messages);
  });

  it("persists streaming messages at most once a second and always saves final status", async () => {
    let clock = 100_000;
    const now = vi.spyOn(Date, "now").mockImplementation(() => clock);
    const stream = deferred<ReadableStreamDefaultController<Uint8Array>>();
    const encoder = new TextEncoder();
    const test = await setup({ model: () => new Response(new ReadableStream<Uint8Array>({ start(controller) { stream.resolve(controller); } }), { headers: { "Content-Type": "text/event-stream" } }) });
    const started = await test.runner.start(test.input);
    try {
      const controller = await stream.promise;
      const emit = (text: string) => controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: "stream", object: "chat.completion.chunk", created: 1, model: "deepseek-flash", choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n`));
      emit("A");
      await vi.waitFor(async () => expect(JSON.stringify((await test.sessions.get(started.id))?.messages)).toContain('"text":"A"'));
      expect(test.saved.filter((value) => value.status === "running")).toHaveLength(3);
      clock += 1001;
      emit("B");
      await vi.waitFor(() => expect(test.saved.filter((value) => value.status === "running")).toHaveLength(4));
      clock += 100;
      emit("C");
      await vi.waitFor(async () => expect(JSON.stringify((await test.sessions.get(started.id))?.messages)).toContain("ABC"));
      expect(test.saved.filter((value) => value.status === "running")).toHaveLength(4);
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: "stream", object: "chat.completion.chunk", created: 1, model: "deepseek-flash", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`));
      controller.close();
      expect((await test.finished(started.id))?.status).toBe("idle");
      expect(test.saved.at(-1)?.status).toBe("idle");
    } finally {
      now.mockRestore();
      await test.runner.stop(started.id);
    }
  });

  it("runs an OpenAI-compatible provider without DeepSeek options", async () => {
    const test = await setup({ model: () => modelStream(undefined, false, { prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 80 } }) });
    await test.deps.providers.save({ ...deepSeekDefault, kind: "openai-compatible" });
    const started = await test.runner.start({ ...test.input, model: { ...test.input.model, thinking: null } });
    const done = await test.finished(started.id);
    expect(done?.status).toBe("idle");
    expect(done?.cacheUsage).toEqual({ inputTokens: 100, cacheReadTokens: 80, lastStep: { inputTokens: 100, cacheReadTokens: 80 } });
    expect(JSON.parse(test.modelBodies[0]!).stream_options).toEqual({ include_usage: true });
    expect(JSON.parse(test.modelBodies[0]!)).not.toHaveProperty("thinking");
    expect(JSON.parse(test.modelBodies[0]!)).not.toHaveProperty("reasoning_effort");
  });

  it("starts repository sessions with the base Worktree and reuses tools on a new run", async () => {
    const test = await setup({ model: () => modelStream() });
    const started = await test.runner.start({ ...test.input, scope: { kind: "repository", spaceId: "repo-1", baseWorktreeId: "base-1" }, model: { ...test.input.model, thinking: "max" } });
    expect((await test.finished(started.id))?.worktreeIds).toEqual(["base-1"]);
    expect(test.modelBodies[0]).toContain("repo-1");
    expect(test.modelBodies[0]).toContain("write only in the base pull request Worktree");
    expect(JSON.parse(test.modelBodies[0]!).reasoning_effort).toBe("max");
    await test.runner.send(started.id, "One more turn");
    await test.finished(started.id);
    expect(test.methods.filter((method) => method === "tools/list")).toHaveLength(1);
  });
});
