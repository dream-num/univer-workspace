import { UnitScreenshotError } from "@univer-cli/unit-screenshot";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExecutorCallError } from "../src/shared/errors.js";
import { RuntimePool } from "../src/renderer/pool.js";

class FakeRuntime {
  closed = 0;
  constructor(readonly id: number) {}
  close() {
    this.closed++;
    return Promise.resolve();
  }
}

function setup(
  options: { max?: number; queueTimeoutMs?: number; operationTimeoutMs?: number } = {},
) {
  const created: FakeRuntime[] = [];
  const pool = new RuntimePool<FakeRuntime>({
    create: () => Promise.resolve(created[created.push(new FakeRuntime(created.length)) - 1]!),
    max: options.max ?? 2,
    queueTimeoutMs: options.queueTimeoutMs ?? 5_000,
    operationTimeoutMs: options.operationTimeoutMs ?? 25_000,
  });
  return { pool, created };
}
const deferred = () => {
  let resolve = () => {};
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
};
const code = (error: unknown) => (error instanceof ExecutorCallError ? error.wire.code : error);

afterEach(() => vi.useRealTimers());

describe("renderer runtime pool", () => {
  it("reuses one runtime across sequential requests", async () => {
    const { pool, created } = setup();
    const first = await pool.run((runtime) => Promise.resolve(runtime.id));
    const second = await pool.run((runtime) => Promise.resolve(runtime.id));
    expect([first.value, first.cold, second.value, second.cold]).toEqual([0, true, 0, false]);
    expect(created).toHaveLength(1);
    expect(pool.stats).toEqual({ idle: 1, busy: 0 });
  });

  it("queues past the limit and hands the freed runtime to the waiter", async () => {
    const { pool, created } = setup({ max: 1 });
    const gate = deferred();
    const order: string[] = [];
    const first = pool.run(async () => {
      order.push("first");
      await gate.promise;
    });
    await vi.waitFor(() => expect(order).toEqual(["first"]));
    const second = pool.run(() => {
      order.push("second");
      return Promise.resolve();
    });
    await Promise.resolve();
    expect(order).toEqual(["first"]);
    gate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(["first", "second"]);
    expect(created).toHaveLength(1);
  });

  it("fails a request that waits past the queue timeout with a retryable error", async () => {
    vi.useFakeTimers();
    const { pool } = setup({ max: 1, queueTimeoutMs: 100 });
    const gate = deferred();
    const holder = pool.run(() => gate.promise);
    await vi.advanceTimersByTimeAsync(0);
    const waiting = pool.run(() => Promise.resolve()).then(undefined, (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(100);
    const error = await waiting;
    expect(code(error)).toBe("workspace-renderer-busy");
    expect((error as ExecutorCallError).wire.detail).toEqual({ retryable: true });
    gate.resolve();
    await holder;
  });

  it("closes and replaces a runtime after a runtime failure", async () => {
    const { pool, created } = setup();
    await expect(pool.run(() => Promise.reject(new Error("browser crashed")))).rejects.toThrow(
      "browser crashed",
    );
    expect(created[0]!.closed).toBe(1);
    expect(pool.stats).toEqual({ idle: 0, busy: 0 });
    const next = await pool.run((runtime) => Promise.resolve(runtime.id));
    expect([next.value, next.cold]).toEqual([1, true]);
  });

  it("skips the operation and keeps the runtime when the deadline passes during creation", async () => {
    const started = deferred();
    const created: FakeRuntime[] = [];
    const pool = new RuntimePool<FakeRuntime>({
      create: async () => {
        await started.promise;
        return created[created.push(new FakeRuntime(created.length)) - 1]!;
      },
      max: 1,
      queueTimeoutMs: 5_000,
      operationTimeoutMs: 25_000,
    });
    const deadline = new AbortController();
    const operation = vi.fn(() => Promise.resolve("ran"));
    const pending = pool.run(operation, deadline.signal);
    deadline.abort(new Error("deadline"));
    started.resolve();
    await expect(pending).rejects.toThrow("deadline");
    expect(operation).not.toHaveBeenCalled();
    expect(pool.stats).toEqual({ idle: 1, busy: 0 });
    expect(created[0]?.closed).toBe(0);
  });

  it("returns the runtime to the pool after an input error", async () => {
    const { pool, created } = setup();
    await expect(
      pool.run(() => Promise.reject(new UnitScreenshotError("INVALID_INPUT", "bad unit"))),
    ).rejects.toThrow("bad unit");
    expect(created[0]!.closed).toBe(0);
    const next = await pool.run((runtime) => Promise.resolve(runtime.id));
    expect([next.value, next.cold]).toEqual([0, false]);
  });

  it("discards a runtime whose operation exceeds the operation timeout", async () => {
    vi.useFakeTimers();
    const { pool, created } = setup({ operationTimeoutMs: 1_000 });
    const hung = pool
      .run(() => new Promise<never>(() => {}))
      .then(undefined, (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(code(await hung)).toBe("workspace-renderer-timeout");
    expect(created[0]!.closed).toBe(1);
    expect(pool.stats).toEqual({ idle: 0, busy: 0 });
  });

  it("closes every runtime on shutdown and refuses later requests", async () => {
    const { pool, created } = setup({ max: 2 });
    const gate = deferred();
    const running = pool.run(async () => {
      await gate.promise;
    });
    await vi.waitFor(() => expect(created).toHaveLength(1));
    await pool.run(() => Promise.resolve());
    expect(pool.stats).toEqual({ idle: 1, busy: 1 });
    await pool.close();
    expect(created.map((runtime) => runtime.closed)).toEqual([1, 1]);
    gate.resolve();
    await running;
    await expect(pool.run(() => Promise.resolve())).rejects.toSatisfy(
      (error) => code(error) === "workspace-renderer-unavailable",
    );
  });
});
