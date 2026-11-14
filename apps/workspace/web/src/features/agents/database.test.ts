import { IDBKeyRange, IDBOpenDBRequest, IDBVersionChangeEvent } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { createTrajectoryStore } from "./trajectory/store";
import type { ModelCallRecord } from "./trajectory/record";
import { openAgentDatabase, openIndexedDatabase } from "./database";
import { deferred, session, storageOptions } from "./test-helpers";

describe("agent database open lock", () => {
  it("holds the database-named lock through open and releases it before transactions", async () => {
    const options = storageOptions();
    const name = "univer-workspace-agents-user-a";
    const gate = deferred<void>();
    const held = options.locks.request(name, () => gate.promise);
    await vi.waitFor(() => expect(options.locks.held.has(name)).toBe(true));
    const originalOpen = options.indexedDB.open.bind(options.indexedDB);
    const open = vi.spyOn(options.indexedDB, "open").mockImplementation((databaseName, version) => {
      expect(databaseName).toBe(name);
      expect(options.locks.held.has(name)).toBe(true);
      const request = originalOpen(databaseName, version);
      request.addEventListener("success", () => expect(options.locks.held.has(name)).toBe(true));
      return request;
    });
    const database = openAgentDatabase(options);
    await Promise.resolve();
    expect(open).not.toHaveBeenCalled();
    gate.resolve();
    await held;
    expect(await database.request("sessions", "readonly", (store) => {
      expect(options.locks.held.has(name)).toBe(false);
      return store.getAll();
    })).toEqual([]);
    expect(open).toHaveBeenCalledOnce();
    await database.close();
  });

  it.each(["error", "blocked"])("releases the lock when open receives %s", async (event) => {
    const options = storageOptions();
    const name = "univer-workspace-agents-user-a";
    const request = new IDBOpenDBRequest();
    const error = new Error("Database open failed");
    Object.defineProperty(request, "error", { value: error });
    vi.spyOn(options.indexedDB, "open").mockImplementation(() => {
      expect(options.locks.held.has(name)).toBe(true);
      queueMicrotask(() => request.dispatchEvent(new IDBVersionChangeEvent(event)));
      return request;
    });
    const database = openAgentDatabase(options);
    await expect(database.request("sessions", "readonly", (store) => store.getAll())).rejects.toThrow(
      event === "error" ? error : "Agent database upgrade blocked by another tab",
    );
    expect(options.locks.held.has(name)).toBe(false);
  });
});

describe("agent and trajectory storage", () => {
  it("preserves reads and writes in all three existing stores", async () => {
    const database = openAgentDatabase(storageOptions());
    const rows = { sessions: { id: "session-a", content: "session" }, providers: { id: "provider-a", content: "provider" }, keys: { providerId: "provider-a", content: "secret" } };
    for (const name of ["sessions", "providers", "keys"] as const) {
      await database.request(name, "readwrite", (store) => store.put(rows[name]));
      expect(await database.request(name, "readonly", (store) => store.getAll())).toEqual([rows[name]]);
    }
    await database.close();
  });

  it("isolates trajectory data, validates stored rows, and orders calls per session", async () => {
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    const options = storageOptions();
    const agents = openAgentDatabase(options);
    const trajectory = createTrajectoryStore(options);
    const first: ModelCallRecord = { sessionId: session().id, seq: 0, runId: "run-1", startedAt: "2026-11-14T00:00:00.000Z", endedAt: null,
      outcome: { kind: "running" }, attempts: [], request: { kind: "raw", body: '{"messages":[]}' }, response: null, usage: null, performance: null };
    const second: ModelCallRecord = { ...first, seq: 1, request: { kind: "delta", base: 0, messages: ["next"] } };
    await trajectory.put(second);
    await trajectory.put(first);
    await trajectory.put({ ...first, seq: 3 });
    const raw = openIndexedDatabase(options.indexedDB, options.locks, "univer-workspace-agent-trajectory-user-a", { modelCalls: ["sessionId", "seq"] });
    await raw.request("modelCalls", "readwrite", (store) => store.put({ sessionId: first.sessionId, seq: 2, outcome: "bad" }));
    await raw.request("modelCalls", "readwrite", (store) => store.put({ ...first, sessionId: "other-session" }));
    expect(await trajectory.list(first.sessionId)).toEqual({ records: [first, second, { ...first, seq: 3 }], skippedRecords: 1 });
    expect(await agents.request("sessions", "readonly", (store) => store.getAll())).toEqual([]);
    await agents.request("sessions", "readwrite", (store) => store.put({ id: "session-a" }));
    expect((await trajectory.list(first.sessionId)).records).toHaveLength(3);
    expect(await createTrajectoryStore({ ...options, userId: "other-user" }).list(first.sessionId)).toEqual({ records: [], skippedRecords: 0 });
    await agents.close();
    await raw.close();
    vi.unstubAllGlobals();
  });
});
