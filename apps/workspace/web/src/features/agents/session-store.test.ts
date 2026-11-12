import { describe, expect, it, vi } from "vitest";
import { agentSessionIdSchema, sessionLockName, sessionTitle, transition } from "./agent.types";
import type { AgentEvent, AgentSessionStatus } from "./agent.types";
import { openAgentDatabase } from "./database";
import { createSessionStore } from "./session-store";
import { session, storageOptions } from "./test-helpers";

describe("agent session store", () => {
  it("saves, lists newest first and isolates user databases", async () => {
    const options = storageOptions();
    const store = createSessionStore(options);
    const older = session();
    const newer = session({ id: agentSessionIdSchema.parse("newer"), updatedAt: "2026-11-11T01:00:00.000Z" });
    await store.save(older);
    await store.save(newer);
    expect(await createSessionStore(options).list()).toEqual([newer, older]);
    expect(await createSessionStore({ ...options, userId: "user-b" }).list()).toEqual([]);
    await expect(store.save({ ...older, userId: "user-b" })).rejects.toThrow("another user");
  });

  it("reads older sessions without timings as an empty timing record", async () => {
    const options = storageOptions();
    const { toolTimings: _toolTimings, ...legacy } = session();
    await openAgentDatabase(options).request("sessions", "readwrite", (store) => store.put(legacy));
    const store = createSessionStore(options);
    expect((await store.get(legacy.id))?.toolTimings).toEqual({});
    expect((await store.list())[0]?.toolTimings).toEqual({});
  });

  it("reads older sessions without cache usage as zero totals and no last step", async () => {
    const options = storageOptions();
    const { cacheUsage: _cacheUsage, ...legacy } = session();
    await openAgentDatabase(options).request("sessions", "readwrite", (store) => store.put(legacy));
    const store = createSessionStore(options);
    expect((await store.get(legacy.id))?.cacheUsage).toEqual({ inputTokens: 0, cacheReadTokens: 0, lastStep: null });
    expect((await store.list())[0]?.cacheUsage).toEqual({ inputTokens: 0, cacheReadTokens: 0, lastStep: null });
  });

  it("recovers a running session without a lock and persists interruption", async () => {
    const options = storageOptions();
    const running = session({ status: "running" });
    await createSessionStore(options).save(running);
    expect((await createSessionStore(options).get(running.id))?.status).toBe("interrupted");
    expect((await createSessionStore(options).list())[0]?.status).toBe("interrupted");
  });

  it.each(["get", "list"] as const)("%s preserves a run completed between reading and checking its lock", async (method) => {
    const options = storageOptions();
    const running = session({ status: "running" });
    const writer = createSessionStore(options);
    await writer.save(running);
    const idle = { ...running, status: "idle" as const, messages: [{ id: "done", role: "assistant" as const, parts: [{ type: "text" as const, text: "Finished" }] }] };
    vi.spyOn(options.locks, "query").mockImplementationOnce(async () => {
      await writer.save(idle);
      return { held: [], pending: [] };
    });
    const reader = createSessionStore(options);
    const result = method === "get" ? await reader.get(running.id) : (await reader.list())[0];
    expect(result).toEqual(idle);
    expect(await createSessionStore(options).get(running.id)).toEqual(idle);
  });

  it("does not interrupt a run whose lock was acquired after the lock query", async () => {
    const options = storageOptions();
    const running = session({ status: "running" });
    await createSessionStore(options).save(running);
    vi.spyOn(options.locks, "query").mockImplementationOnce(async () => {
      options.locks.held.add(sessionLockName(running.id));
      return { held: [], pending: [] };
    });
    expect((await createSessionStore(options).get(running.id))?.status).toBe("running");
  });

  it("keeps a session running while another tab holds its lock", async () => {
    const options = storageOptions();
    const running = session({ status: "running" });
    options.locks.held.add(sessionLockName(running.id));
    const store = createSessionStore(options);
    await store.save(running);
    expect((await createSessionStore(options).get(running.id))?.status).toBe("running");
    expect((await createSessionStore(options).list())[0]?.status).toBe("running");
  });

  it("publishes immediately without writing to disk, and unsubscribes", async () => {
    const options = storageOptions();
    const store = createSessionStore(options);
    const original = session();
    await store.save(original);
    const updates: string[] = [];
    const unsubscribe = store.subscribe((value) => updates.push(value.updatedAt));
    const update = { ...original, updatedAt: "2026-11-11T02:00:00.000Z" };
    store.publish(update);
    expect(updates).toEqual([update.updatedAt]);
    expect(await store.get(original.id)).toEqual(update);
    expect(await createSessionStore(options).get(original.id)).toEqual(original);
    unsubscribe();
    store.publish(original);
    expect(updates).toHaveLength(1);
  });
});

it("implements every allowed transition and rejects every other event", () => {
  const allowed: [AgentSessionStatus, AgentEvent, AgentSessionStatus][] = [
    ["running", "finish", "idle"], ["running", "stop", "stopped"], ["running", "fail", "failed"], ["running", "interrupt", "interrupted"],
    ["idle", "send", "running"], ["stopped", "send", "running"], ["interrupted", "send", "running"], ["failed", "send", "running"],
  ];
  const statuses: AgentSessionStatus[] = ["running", "idle", "interrupted", "stopped", "failed"];
  const events: AgentEvent[] = ["send", "finish", "stop", "fail", "interrupt"];
  for (const status of statuses) for (const event of events) {
    const entry = allowed.find(([from, action]) => from === status && action === event);
    if (entry) expect(transition(status, event)).toBe(entry[2]);
    else expect(() => transition(status, event)).toThrow("Invalid agent transition");
  }
});

it("derives the title from the first user message", () => {
  expect(sessionTitle(session({ messages: [{ id: "u", role: "user", parts: [{ type: "text", text: "First sentence" }] }] }))).toBe("First sentence");
});
