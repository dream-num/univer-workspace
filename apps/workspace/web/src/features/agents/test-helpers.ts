import { IDBFactory } from "fake-indexeddb";
import type { AgentSession } from "./agent.types";
import { agentSessionIdSchema } from "./agent.types";
import { deepSeekDefault } from "./providers";

export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export class TestLocks implements LockManager {
  readonly held = new Set<string>();
  async query(): Promise<LockManagerSnapshot> {
    return { held: [...this.held].map((name) => ({ name, mode: "exclusive", clientId: "test" })), pending: [] };
  }
  request<T>(name: string, callback: LockGrantedCallback<T>): Promise<T>;
  request<T>(name: string, options: LockOptions, callback: LockGrantedCallback<T>): Promise<T>;
  request<T>(name: string, options: LockOptions | LockGrantedCallback<T>, callback?: LockGrantedCallback<T>): Promise<T> {
    const handler = typeof options === "function" ? options : callback;
    if (!handler) return Promise.reject(new Error("Lock callback missing"));
    return new Promise<T>((resolve, reject) => {
      queueMicrotask(() => {
        const busy = this.held.has(name);
        if (busy && typeof options !== "function" && !options.ifAvailable) { reject(new Error("Test lock is busy")); return; }
        if (!busy) this.held.add(name);
        Promise.resolve().then(() => handler(busy ? null : { name, mode: "exclusive" }))
          .then(resolve, reject).finally(() => { if (!busy) this.held.delete(name); });
      });
    });
  }
}
export class TestStorage implements Storage {
  private readonly data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.get(key) ?? null; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) { this.data.set(key, value); }
}
export function storageOptions() {
  return { userId: "user-a", indexedDB: new IDBFactory(), locks: new TestLocks(), storage: new TestStorage() };
}
export function session(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: agentSessionIdSchema.parse("session-a"), userId: "user-a", scope: { kind: "global" }, mode: "auto",
    model: { providerId: deepSeekDefault.id, modelId: "deepseek-flash", thinking: "off" },
    status: "idle", worktreeIds: [], messages: [], toolTimings: {}, cacheUsage: { inputTokens: 0, cacheReadTokens: 0, lastStep: null }, error: null,
    createdAt: "2026-11-11T00:00:00.000Z", updatedAt: "2026-11-11T00:00:00.000Z", ...overrides,
  };
}
