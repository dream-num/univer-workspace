import { existsSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createWorkspaceContentRuntime,
  type WorkspaceContentRuntime,
  type WorkspaceContentRuntimeOptions,
  type WorkspaceRuntimeTarget,
} from "../src/index.js";

const target: WorkspaceRuntimeTarget = {
  origin: "https://workspace.test",
  revision: 7,
  scope: { kind: "trunk" },
  unitId: "unit-1",
  unitType: "sheet",
};

const runtimes: WorkspaceContentRuntime[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
  delete process.env["POOL_PARENT_SECRET"];
});

function create(pool?: WorkspaceContentRuntimeOptions["pool"]): WorkspaceContentRuntime {
  const runtime = createWorkspaceContentRuntime({
    ...(pool === undefined ? {} : { pool }),
    resolveCredential: () => "cookie",
    resolveLicense: () => "license",
    workerEntry: new URL("./fixtures/runtime-env-worker.mjs", import.meta.url),
  });
  runtimes.push(runtime);
  return runtime;
}

describe("Workspace content runtime worker pool options", () => {
  it("gives the worker child only pool.env, or the parent environment when unset", async () => {
    process.env["POOL_PARENT_SECRET"] = "secret";

    const exact = await create({ env: { FOO: "1" } }).executeRead({ code: "env", target });
    expect(exact.value).toContain("FOO");
    expect(exact.value).not.toContain("POOL_PARENT_SECRET");
    expect(exact.value).not.toContain("PATH");

    const inherited = await create().executeRead({ code: "env", target });
    expect(inherited.value).toContain("POOL_PARENT_SECRET");
  });

  it("applies pool.maxWorkers: a second concurrent key hits the pool capacity error", async () => {
    const marker = join(await mkdtemp(join(tmpdir(), "client-core-pool-")), "held");
    const runtime = create({ maxWorkers: 1 });
    const held = runtime.executeRead({
      caller: { userId: "alice" },
      code: `hold:${marker}`,
      target,
    });
    for (let attempt = 0; attempt < 300 && !existsSync(marker); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(existsSync(marker)).toBe(true);

    await expect(
      runtime.executeRead({ caller: { userId: "bob" }, code: "env", target }),
    ).rejects.toMatchObject({ code: "COLLABORATION_POOL_CAPACITY_EXCEEDED" });
    await expect(held).resolves.toBeDefined();
  });
});

async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 500 && !existsSync(path); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  expect(existsSync(path)).toBe(true);
}

describe("Workspace content runtime queue across runtime keys", () => {
  async function holdAlice(runtime: WorkspaceContentRuntime) {
    const gate = join(await mkdtemp(join(tmpdir(), "client-core-queue-")), "alice");
    const held = runtime.executeRead({ caller: { userId: "alice" }, code: `gate:${gate}`, target });
    await waitForFile(`${gate}.started`);
    return { held, release: () => writeFileSync(`${gate}.release`, "") };
  }

  it("rejects pool.queue without pool.maxWorkers", () => {
    expect(() => create({ queue: { timeoutMs: 1000 } })).toThrow(
      expect.objectContaining({ code: "workspace-argument-invalid" }),
    );
  });

  it("admits a waiting key once the busy key releases its slot before the deadline", async () => {
    const runtime = create({ maxWorkers: 1, queue: { timeoutMs: 10_000 } });
    const alice = await holdAlice(runtime);

    const bob = runtime.executeRead({ caller: { userId: "bob" }, code: "env", target });
    await new Promise((resolve) => setTimeout(resolve, 200));
    alice.release();

    await expect(bob).resolves.toMatchObject({ value: expect.any(Array) });
    await expect(alice.held).resolves.toBeDefined();
  });

  it("fails a waiter with a retryable busy error at the deadline and leaks no slot", async () => {
    const runtime = create({ maxWorkers: 1, queue: { timeoutMs: 300 } });
    const alice = await holdAlice(runtime);

    await expect(
      runtime.executeRead({ caller: { userId: "bob" }, code: "env", target }),
    ).rejects.toMatchObject({ code: "workspace-runtime-busy", detail: { retryable: true } });

    alice.release();
    await alice.held;
    await expect(
      runtime.executeRead({ caller: { userId: "bob" }, code: "env", target }),
    ).resolves.toBeDefined();
    await expect(
      runtime.executeRead({ caller: { userId: "carol" }, code: "env", target }),
    ).resolves.toBeDefined();
  });

  it("runs two operations on the same key with one worker slot without deadlock", async () => {
    const runtime = create({ maxWorkers: 1, queue: { timeoutMs: 300 } });
    const alice = await holdAlice(runtime);
    const second = runtime.executeRead({ caller: { userId: "alice" }, code: "env", target });
    await new Promise((resolve) => setTimeout(resolve, 500));
    alice.release();

    await expect(Promise.all([alice.held, second])).resolves.toHaveLength(2);
  });

  it("admits waiting keys in arrival order", async () => {
    const runtime = create({ maxWorkers: 1, queue: { timeoutMs: 20_000 } });
    const alice = await holdAlice(runtime);
    const settled: string[] = [];
    const waiters = ["bob", "carol", "dave"].map((userId) =>
      runtime
        .executeRead({ caller: { userId }, code: "env", target })
        .then(() => settled.push(userId)),
    );
    alice.release();

    await Promise.all(waiters);
    expect(settled).toEqual(["bob", "carol", "dave"]);
  });
});
