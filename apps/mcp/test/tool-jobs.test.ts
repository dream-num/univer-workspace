import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { readdir, utimes, writeFile } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { ExecutorCallError } from "../src/shared/errors.js";
import { JOB_DEADLINE_MS, requestHeaderSchema } from "../src/shared/executor-protocol.js";
import { ToolJobs } from "../src/gateway/jobs/store.js";
import { JOB_TTL_MS, jobHandleSchema, type JobRecord } from "../src/gateway/jobs/model.js";
import { LocalStagingStore } from "../src/gateway/staging/local.js";
import { testStagingDirectory } from "./staging-directory.js";
import type { ToolResult } from "../src/gateway/tools/definition.js";

const stores: LocalStagingStore[] = [];
afterEach(async () => {
  await Promise.all(stores.splice(0).map((s) => s.close()));
});
function setup(budget = 10, clock?: () => number, directory = testStagingDirectory()) {
  const store = new LocalStagingStore(
    directory,
    "http://mcp.test/mcp",
    clock ? { now: clock } : {},
  );
  stores.push(store);
  return { store, jobs: new ToolJobs(store, budget, clock), directory };
}
function deferred() {
  let resolve!: (result: ToolResult) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<ToolResult>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const result = {
  output: {
    download: {
      url: "http://mcp.test/download",
      expires_at: new Date(Date.now() + JOB_TTL_MS).toISOString(),
      file_name: "Book.xlsx",
      media_type: "application/octet-stream",
      size: 2,
    },
    type: "sheet",
  },
  repo: "space",
};
const fingerprint = "a".repeat(64);
const input = (
  execute: (deadlineAt: number) => Promise<ToolResult>,
  key: string | undefined = "key",
) => ({
  userId: "alice",
  tool: "export" as const,
  key,
  fingerprint,
  execute,
  onDeferred: vi.fn(),
});

it("keeps a synchronous result byte-identical and joins a retry inside its sync budget", async () => {
  const { jobs } = setup(1000);
  const work = deferred();
  const execute = vi.fn(() => work.promise);
  const first = jobs.run(input(execute));
  const retry = jobs.run(input(execute));
  work.resolve(result);
  expect(await first).toEqual(result);
  expect(JSON.stringify(await retry)).toBe(JSON.stringify(result));
  expect(execute).toHaveBeenCalledTimes(1);
});

it("returns a job after the budget, persists the original result, and dedups running and finished calls", async () => {
  const { jobs, store, directory } = setup();
  const work = deferred();
  const args = input(vi.fn(() => work.promise));
  const first = await jobs.run(args);
  const handle = jobHandleSchema.parse(first.output);
  expect(await jobs.get("alice", handle.job_id)).toEqual(handle);
  expect((await jobs.run(args)).output).toEqual(handle);
  expect(args.execute).toHaveBeenCalledTimes(1);
  const completion = args.onDeferred.mock.calls[0]?.[0];
  expect(completion).toBeInstanceOf(Promise);
  work.resolve(result);
  await completion;
  expect(await jobs.get("alice", handle.job_id)).toEqual({
    job_id: handle.job_id,
    status: "succeeded",
    result: result.output,
  });
  expect((await jobs.run(args)).output).toEqual(result.output);
  expect((await store.readJob(handle.job_id))?.expiresAt).toBe(
    Date.parse(result.output.download.expires_at),
  );
  const fresh = new ToolJobs(store);
  expect(await fresh.get("alice", handle.job_id)).toMatchObject({
    status: "succeeded",
    result: result.output,
  });
  expect((await fresh.run(args)).output).toEqual(result.output);
  expect(args.execute).toHaveBeenCalledTimes(1);
  expect((await readdir(directory)).filter((name) => name.endsWith(".job.json"))).toHaveLength(1);
});

it.each(["workspace-job-crashed", "workspace-result-unknown"])(
  "persists failure %s without changing its error",
  async (code) => {
    const { jobs, store, directory } = setup();
    const work = deferred();
    const tool: JobRecord["tool"] = code === "workspace-result-unknown" ? "import" : "export";
    const args = { ...input(() => work.promise), tool };
    const handle = jobHandleSchema.parse((await jobs.run(args)).output);
    const error = new ExecutorCallError({
      code,
      message: "conversion failed",
      detail: { cause: "test" },
      outcome: "tool_error",
    });
    work.reject(error);
    await expect(args.onDeferred.mock.calls[0]?.[0]).rejects.toBe(error);
    expect(await jobs.get("alice", handle.job_id)).toEqual({
      job_id: handle.job_id,
      status: "failed",
      error: { code, message: error.message, detail: { cause: "test" } },
    });
    expect((await store.readJob(handle.job_id))?.key).toBeUndefined();
    const recover = vi.fn(async () => result);
    const foreign = setup(1000, undefined, directory);
    expect((await foreign.jobs.run({ ...input(recover), tool })).output).toEqual(result.output);
    expect(recover).toHaveBeenCalledTimes(1);
    expect(
      (
        await jobs.run({
          ...input(() => {
            throw new Error("Failure retained its key");
          }),
          tool,
        })
      ).output,
    ).toEqual(result.output);
  },
);

it("never dedups exports without a key, and isolates keys by user and tool", async () => {
  const { jobs } = setup(1000);
  const execute = vi.fn(async () => result);
  await jobs.run({ ...input(execute), key: undefined });
  await jobs.run({ ...input(execute), key: undefined });
  await jobs.run({ ...input(execute), userId: "bob" });
  await jobs.run({ ...input(execute), tool: "import" });
  expect(execute).toHaveBeenCalledTimes(4);
});

it("atomically reserves the same key across gateway replicas sharing staging", async () => {
  const first = setup();
  const second = setup(10, undefined, first.directory);
  const work = deferred();
  const execute = vi.fn(() => work.promise);
  const [a, b] = await Promise.all([
    first.jobs.run(input(execute)),
    second.jobs.run(input(execute)),
  ]);
  expect(a.output).toEqual(b.output);
  expect(execute).toHaveBeenCalledTimes(1);
  work.resolve(result);
  await vi.waitFor(async () =>
    expect(await second.jobs.get("alice", jobHandleSchema.parse(a.output).job_id)).toMatchObject({
      status: "succeeded",
    }),
  );
});

it("hides foreign, unknown and expired jobs, sweeps sidecars and allows a new key after expiry", async () => {
  let now = Date.now();
  const { jobs, store, directory } = setup(10, () => now);
  const work = deferred();
  const execute = vi.fn(() => work.promise);
  const args = input(execute);
  const handle = jobHandleSchema.parse((await jobs.run(args)).output);
  work.resolve(result);
  await args.onDeferred.mock.calls[0]?.[0];
  for (const [user, id] of [
    ["bob", handle.job_id],
    ["alice", randomUUID()],
    ["alice", "../../private"],
  ])
    await expect(jobs.get(user!, id!)).rejects.toMatchObject({ code: "workspace-job-not-found" });
  now += JOB_TTL_MS + 1;
  await expect(jobs.get("alice", handle.job_id)).rejects.toMatchObject({
    code: "workspace-job-not-found",
  });
  await store.sweep();
  expect((await readdir(directory)).filter((name) => name.endsWith(".job.json"))).toHaveLength(0);
  await jobs.run(input(execute));
  expect(execute).toHaveBeenCalledTimes(2);
});

it.each(["import", "export", "compile_typst"] as const)(
  "recovers a stale %s record after memory loss with its timeout code",
  async (tool) => {
    const now = Date.now();
    const { jobs, store } = setup(1000, () => now);
    const record: JobRecord = {
      id: randomUUID(),
      userId: "alice",
      tool,
      key: "key",
      fingerprint,
      status: "running",
      createdAt: now - 2000,
      deadlineAt: now - 1,
      expiresAt: now + JOB_TTL_MS,
    };
    await store.writeJob(record);
    expect(await jobs.get("alice", record.id)).toMatchObject({
      status: "failed",
      error: {
        code: tool !== "export" ? "workspace-result-unknown" : "workspace-executor-timeout",
      },
    });
    const execute = vi.fn(async () => result);
    expect((await jobs.run({ ...input(execute), tool })).output).toEqual(result.output);
    expect(execute).toHaveBeenCalledTimes(1);
  },
);

it("allows a long RPC deadline only for conversion operations", () => {
  const header = {
    v: 1,
    op: "exchange.export",
    requestId: "test",
    deadlineMs: 120_000,
    input: {},
    grant: { kind: "session", userId: "alice", session: "secret", expiresAt: Date.now() + 600_000 },
  };
  expect(requestHeaderSchema.safeParse(header).success).toBe(true);
  expect(requestHeaderSchema.safeParse({ ...header, op: "typst.compile" }).success).toBe(true);
  for (const op of ["content.execute", "markdown.compile", "svg.compile"])
    expect(requestHeaderSchema.safeParse({ ...header, op }).success).toBe(false);
  expect(requestHeaderSchema.safeParse({ ...header, deadlineMs: 600_001 }).success).toBe(false);
});

it.each(["workspace-job-crashed", "workspace-result-unknown"])(
  "re-executes a synchronous %s with the same key",
  async (code) => {
    const { jobs } = setup(1000);
    const error = new ExecutorCallError({
      code,
      message: "failed",
      detail: null,
      outcome: "tool_error",
    });
    const execute = vi
      .fn<() => Promise<ToolResult>>()
      .mockRejectedValueOnce(error)
      .mockResolvedValue(result);
    const args = {
      ...input(execute),
      tool: code === "workspace-result-unknown" ? ("import" as const) : ("export" as const),
    };
    await expect(jobs.run(args)).rejects.toBe(error);
    expect((await jobs.run(args)).output).toEqual(result.output);
    expect((await jobs.run(args)).output).toEqual(result.output);
    expect(execute).toHaveBeenCalledTimes(2);
  },
);

it("reads a foreign reservation's settled sidecar and returns the normal result", async () => {
  const { jobs, store } = setup(1000);
  const now = Date.now();
  const running: JobRecord = {
    id: randomUUID(),
    userId: "alice",
    tool: "export",
    key: "key",
    fingerprint,
    status: "running",
    createdAt: now,
    deadlineAt: now + 60_000,
    expiresAt: now + JOB_TTL_MS,
  };
  await store.writeJob(running);
  const reserve = store.reserveJob.bind(store);
  vi.spyOn(store, "reserveJob").mockImplementationOnce(async (candidate) => {
    const reserved = await reserve(candidate);
    await store.writeJob({ ...running, status: "succeeded", result: result.output });
    return reserved;
  });
  const execute = vi.fn(async () => result);
  expect((await jobs.run(input(execute))).output).toEqual(result.output);
  expect(execute).not.toHaveBeenCalled();
});

it("ignores failed legacy sidecars that still contain a key", async () => {
  const { jobs, store } = setup(1000);
  const now = Date.now();
  await store.writeJob({
    id: randomUUID(),
    userId: "alice",
    tool: "export",
    key: "key",
    fingerprint,
    status: "failed",
    error: { code: "workspace-result-unknown", message: "Retry the same key", detail: null },
    createdAt: now,
    deadlineAt: now + 60_000,
    expiresAt: now + JOB_TTL_MS,
  });
  const execute = vi.fn(async () => result);
  expect((await jobs.run(input(execute))).output).toEqual(result.output);
  expect(execute).toHaveBeenCalledTimes(1);
});

it("isolates a corrupt sidecar from other key reservations and reports it as an internal error", async () => {
  const { jobs, directory } = setup(1000);
  const id = randomUUID();
  await writeFile(join(directory, `${id}.job.json`), JSON.stringify({ id }), { mode: 0o600 });
  await expect(jobs.get("alice", id)).rejects.toThrow("Invalid job metadata.");
  expect(await jobs.run(input(async () => result))).toEqual(result);
});

it("lets a replica reuse an expired key after observing another gateway's running job", async () => {
  let now = Date.now();
  const first = setup(10, () => now);
  const second = setup(1000, () => now, first.directory);
  const work = deferred();
  const handle = jobHandleSchema.parse((await first.jobs.run(input(() => work.promise))).output);
  expect(
    (
      await second.jobs.run(
        input(() => {
          throw new Error("Duplicate conversion");
        }),
      )
    ).output,
  ).toEqual(handle);
  work.resolve(result);
  await vi.waitFor(async () =>
    expect(await second.jobs.get("alice", handle.job_id)).toMatchObject({ status: "succeeded" }),
  );
  now += JOB_TTL_MS + 1;
  await first.store.sweep();
  const execute = vi.fn(async () => ({
    ...result,
    output: {
      ...result.output,
      download: { ...result.output.download, expires_at: new Date(now + JOB_TTL_MS).toISOString() },
    },
  }));
  await second.jobs.run(input(execute));
  expect((await second.jobs.run(input(execute))).output).toMatchObject({
    type: "sheet",
    download: { expires_at: new Date(now + JOB_TTL_MS).toISOString() },
  });
  await expect(second.jobs.get("alice", handle.job_id)).rejects.toMatchObject({
    code: "workspace-job-not-found",
  });
  expect(execute).toHaveBeenCalledTimes(1);
});

const other = { fingerprint: "b".repeat(64) };

it.each(["import", "export", "compile_typst"] as const)(
  "rejects a reused %s key with different arguments while running, after success and across replicas",
  async (tool) => {
    const first = setup();
    const second = setup(1000, undefined, first.directory);
    const work = deferred();
    const execute = vi.fn(() => work.promise);
    const handle = jobHandleSchema.parse(
      (await first.jobs.run({ ...input(execute), tool })).output,
    );
    const refuse = vi.fn(async () => result);
    for (const jobs of [first.jobs, second.jobs]) {
      await expect(jobs.run({ ...input(refuse), ...other, tool })).rejects.toMatchObject({
        code: "workspace-idempotency-conflict",
      });
      expect((await jobs.run({ ...input(refuse), tool })).output).toEqual(handle);
    }
    work.resolve(result);
    await first.jobs.get("alice", handle.job_id);
    await args(first.jobs, execute);
    for (const jobs of [first.jobs, second.jobs])
      await expect(jobs.run({ ...input(refuse), ...other, tool })).rejects.toMatchObject({
        code: "workspace-idempotency-conflict",
      });
    expect(refuse).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);

    async function args(jobs: ToolJobs, run: typeof execute) {
      await vi.waitFor(async () =>
        expect((await jobs.run({ ...input(run), tool })).output).toEqual(result.output),
      );
    }
  },
);

it("starts a different intent under a reused key once the first job failed", async () => {
  const { jobs } = setup(1000);
  await expect(
    jobs.run(
      input(async () => {
        throw new Error("boom");
      }),
    ),
  ).rejects.toThrow("boom");
  const execute = vi.fn(async () => result);
  expect((await jobs.run({ ...input(execute), ...other })).output).toEqual(result.output);
  expect(execute).toHaveBeenCalledTimes(1);
});

it("reports running past deadlineAt while this replica holds the unsettled completion, then settles", async () => {
  let now = Date.now();
  const { jobs, store } = setup(10, () => now);
  const work = deferred();
  const execute = vi.fn(() => work.promise);
  const args = input(execute);
  const handle = jobHandleSchema.parse((await jobs.run(args)).output);
  now = (await store.readJob(handle.job_id))!.deadlineAt + 1;
  expect(await jobs.get("alice", handle.job_id)).toEqual(handle);
  expect((await jobs.run(args)).output).toEqual(handle);
  expect(execute).toHaveBeenCalledTimes(1);
  work.resolve(result);
  await args.onDeferred.mock.calls[0]?.[0];
  expect(await jobs.get("alice", handle.job_id)).toMatchObject({
    status: "succeeded",
    result: result.output,
  });
});

it.each(["import", "export", "compile_typst"] as const)(
  "settles a hung %s completion at its deadline with the timeout error and releases the key",
  async (tool) => {
    vi.useFakeTimers();
    try {
      const store = new LocalStagingStore(testStagingDirectory(), "http://mcp.test/mcp");
      stores.push(store);
      const jobs = new ToolJobs(store, 10, Date.now, 60);
      let signalStarted!: () => void;
      const started = new Promise<void>((resolve) => { signalStarted = resolve; });
      const args = {
        ...input(() => {
          signalStarted();
          return new Promise<ToolResult>(() => {});
        }),
        tool,
      };
      const running = jobs.run(args);
      await started;
      await vi.advanceTimersByTimeAsync(10);
      const handle = jobHandleSchema.parse((await running).output);
      const timedOut = expect(args.onDeferred.mock.calls[0]?.[0]).rejects.toMatchObject({
        wire: {
          code: tool !== "export" ? "workspace-result-unknown" : "workspace-executor-timeout",
        },
      });
      await vi.advanceTimersByTimeAsync(49);
      expect(await jobs.get("alice", handle.job_id)).toEqual(handle);
      await vi.advanceTimersByTimeAsync(1);
      await timedOut;
      expect(await jobs.get("alice", handle.job_id)).toMatchObject({ status: "failed" });
      const execute = vi.fn(async () => result);
      expect((await jobs.run({ ...input(execute), tool })).output).toEqual(result.output);
      expect((await new ToolJobs(store, 1000).run({ ...input(execute), tool })).output).toEqual(
        result.output,
      );
      expect(execute).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  },
);

it("caps the job deadline at the grant expiry minus a margin, but never below the synchronous budget", async () => {
  const now = Date.now();
  const { jobs, store } = setup(1000, () => now);
  const deadline = async (key: string, grantExpiresAt: number | undefined) => {
    const args = {
      ...input(async () => result, key),
      ...(grantExpiresAt === undefined ? {} : { grantExpiresAt }),
    };
    await jobs.run(args);
    const entries = (await readdir(store["root"])).filter((name) => name.endsWith(".job.json"));
    const records = await Promise.all(entries.map((name) => store.readJob(name.slice(0, 36))));
    return records.find((record) => record?.key === key)!.deadlineAt;
  };
  expect(await deadline("uncapped", undefined)).toBe(now + JOB_DEADLINE_MS);
  expect(await deadline("capped", now + 60_000)).toBe(now + 55_000);
  expect(await deadline("expiring", now + 1000)).toBe(now + 1000);
});

it("recovers a stale reservation lock left by a crashed gateway", async () => {
  const now = Date.now();
  const { jobs, directory } = setup(1000, () => now);
  const digest = createHash("sha256")
    .update(JSON.stringify(["alice", "export", "key"]))
    .digest("hex");
  const lock = join(
    directory,
    `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}.lock`,
  );
  await writeFile(lock, "crashed", { mode: 0o600 });
  const execute = vi.fn(async () => result);
  await expect(jobs.run(input(execute))).rejects.toMatchObject({ code: "workspace-upload-busy" });
  const old = new Date(now - 11_000);
  await utimes(lock, old, old);
  expect((await jobs.run(input(execute))).output).toEqual(result.output);
  expect(execute).toHaveBeenCalledTimes(1);
});

it("does not leak an unhandled rejection when a start fails or its key is released", async () => {
  const unhandled = vi.fn();
  process.on("unhandledRejection", unhandled);
  try {
    const { jobs, store } = setup(1000);
    vi.spyOn(store, "reserveJob").mockRejectedValueOnce(new Error("disk full"));
    const execute = vi.fn(async () => result);
    await expect(jobs.run(input(execute))).rejects.toThrow("disk full");
    expect((await jobs.run(input(execute))).output).toEqual(result.output);
    const internals = jobs as unknown as {
      keys: Map<string, Promise<unknown>>;
      releaseKey(entry: { record: JobRecord }): void;
    };
    const rejected = Promise.reject(new Error("start failed"));
    internals.keys.set(JSON.stringify(["alice", "export", "key"]), rejected);
    internals.releaseKey({
      record: { ...input(execute), id: randomUUID() } as unknown as JobRecord,
    });
    await new Promise((resolve) => setImmediate(resolve));
    await rejected.catch(() => {});
    expect(unhandled).not.toHaveBeenCalled();
  } finally {
    process.off("unhandledRejection", unhandled);
  }
});

it("settles in memory and releases its in-memory key when the failed sidecar cannot be written", async () => {
  const { jobs, store } = setup(10);
  const work = deferred();
  const args = input(() => work.promise);
  const handle = jobHandleSchema.parse((await jobs.run(args)).output);
  vi.spyOn(store, "writeJob").mockRejectedValue(new Error("disk full"));
  const error = new Error("conversion failed");
  work.reject(error);
  await expect(args.onDeferred.mock.calls[0]?.[0]).rejects.toBe(error);
  expect(await jobs.get("alice", handle.job_id)).toMatchObject({ status: "failed" });
  const keys = (jobs as unknown as { keys: Map<string, unknown> }).keys;
  await vi.waitFor(() => expect(keys.size).toBe(0));
});
