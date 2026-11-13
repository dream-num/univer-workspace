import { IDBOpenDBRequest, IDBVersionChangeEvent } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { openAgentDatabase } from "./database";
import { deferred, storageOptions } from "./test-helpers";

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
