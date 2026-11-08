import { once } from "node:events";
import { createServer } from "node:http";
import type {
  CollaborationPullResult,
  CollaborationRuntimeState,
  UniverCollaborationRuntimeLease,
  UniverCollaborationRuntimePool,
  UniverCollaborationRuntimePoolOptions,
} from "@univer-cli/univer-collaboration-runtime-pool";
import { UniverCollaborationRuntimePoolError } from "@univer-cli/univer-collaboration-runtime-pool";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWorkspaceContentRuntime,
  getWorkspaceRuntimeFailurePhase,
  type WorkspaceContentRuntimeOptions,
  type WorkspaceContentRuntimeObservation,
  workspaceRuntimeKey,
  type WorkspaceRuntimeTarget,
} from "../src/index.js";

const poolMock = vi.hoisted(() => ({
  options: undefined as UniverCollaborationRuntimePoolOptions | undefined,
  pool: undefined as UniverCollaborationRuntimePool<unknown> | undefined,
}));

vi.mock("@univer-cli/univer-collaboration-runtime-pool", async (importOriginal) => ({
  ...(await importOriginal()),
  createUniverCollaborationRuntimePool: (options: UniverCollaborationRuntimePoolOptions) => {
    poolMock.options = options;
    return poolMock.pool;
  },
}));

const target: WorkspaceRuntimeTarget = {
  origin: "https://workspace.test",
  revision: 7,
  scope: { kind: "worktree", worktreeId: "wt-1" },
  unitId: "unit-1",
  unitType: "sheet",
};

describe("Workspace content runtime owner", () => {
  beforeEach(() => {
    poolMock.options = undefined;
    poolMock.pool = undefined;
  });

  it("replaces a rejected cached init with the current caller under the same-key lock", async () => {
    const old = lease();
    const fresh = lease();
    const acquire = vi
      .fn<UniverCollaborationRuntimePool<unknown>["acquire"]>()
      .mockResolvedValueOnce(old)
      .mockResolvedValueOnce(old)
      .mockResolvedValue(fresh);
    const reuseWorker = vi.fn(() => false);
    const resolveCredential = vi.fn((_target, caller) => String(caller?.grant));
    const runtime = createRuntime({ acquire, resolveCredential, reuseWorker });
    const first = { userId: "alice", grant: "old" };
    const second = { userId: "alice", grant: "new" };
    await runtime.executeRead({ caller: first, code: "1", target });
    await runtime.executeRead({ caller: second, code: "2", target });
    expect(reuseWorker).toHaveBeenCalledWith(first, second);
    expect(old.invalidate).toHaveBeenCalledOnce();
    expect(acquire.mock.calls.at(-1)?.[0].init).toMatchObject({ credential: "new" });
    expect(resolveCredential).toHaveBeenCalledTimes(2);
  });

  it("drops an init that rejects after its credential waiter was cancelled", async () => {
    let rejectCredential!: (error: Error) => void;
    const resolveCredential = vi
      .fn<WorkspaceContentRuntimeOptions["resolveCredential"]>()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectCredential = reject;
          }),
      )
      .mockReturnValue("fresh-cookie");
    const acquire = vi.fn(async () => lease());
    const runtime = createRuntime({ acquire, resolveCredential, reuseWorker: () => false });
    const controller = new AbortController();
    const call = runtime.executeRead({ code: "1", target, signal: controller.signal });
    await vi.waitFor(() => expect(resolveCredential).toHaveBeenCalledOnce());
    const rejected = expect(call).rejects.toMatchObject({ code: "workspace-runtime-not-started" });
    controller.abort();
    await rejected;
    rejectCredential(new Error("credential expired"));
    await new Promise((resolve) => setImmediate(resolve));
    await expect(runtime.executeRead({ code: "2", target })).resolves.toBeDefined();
    expect(resolveCredential).toHaveBeenCalledTimes(2);
    expect(acquire).toHaveBeenCalledOnce();
  });

  it.each([false, true])(
    "aborts queued calls without acquiring a lease (capacity queue %s)",
    async (capacity) => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const current = lease({ executeGate: gate });
      const acquire = vi.fn(async () => current);
      const runtime = createRuntime({
        acquire,
        ...(capacity ? { pool: { maxWorkers: 1, queue: { timeoutMs: 5000 } } } : {}),
      });
      const controller = new AbortController();
      const active = runtime.executeRead({ code: "held", target });
      await vi.waitFor(() => expect(current.execute).toHaveBeenCalledOnce());
      const waiting = runtime.executeAndCommit({
        code: "must not write",
        target: capacity ? { ...target, unitId: "other" } : target,
        signal: controller.signal,
      });
      const rejected = expect(waiting).rejects.toMatchObject({
        code: "workspace-runtime-not-started",
        detail: { started: false, retryable: true },
      });
      controller.abort();
      await rejected;
      const after = runtime.executeRead({ code: "next", target });
      expect(acquire).toHaveBeenCalledOnce();
      release();
      await Promise.all([active, after]);
      expect(acquire).toHaveBeenCalledTimes(2);
      expect(current.execute).not.toHaveBeenCalledWith(
        expect.objectContaining({ code: "must not write" }),
      );
    },
  );

  it("finishes an acquired write despite cancellation and marks only script/commit error boundaries", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const current = lease({
      executeGate: gate,
      writeMutations: [{ id: "edit", data: "{}" }],
      commitResults: [commitResult("confirmed", 8)],
    });
    const runtime = createRuntime({ acquire: vi.fn(async () => current) });
    const controller = new AbortController();
    const active = runtime.executeAndCommit({ code: "edit", target, signal: controller.signal });
    await vi.waitFor(() => expect(current.execute).toHaveBeenCalledOnce());
    controller.abort();
    release();
    await expect(active).resolves.toMatchObject({ committed: true });
    const failure = new TypeError("exact CLI text");
    current.execute = vi.fn().mockRejectedValue(failure);
    await expect(runtime.executeRead({ code: "throw", target })).rejects.toBe(failure);
    expect(getWorkspaceRuntimeFailurePhase(failure)).toBe("script");
    const commitFailure = new Error("commit disconnected");
    const writing = lease({ writeMutations: [{ id: "edit", data: "{}" }] });
    writing.commit = vi.fn().mockRejectedValue(commitFailure);
    const other = createRuntime({ acquire: vi.fn(async () => writing) });
    await expect(other.executeAndCommit({ code: "edit", target })).rejects.toBe(commitFailure);
    expect(getWorkspaceRuntimeFailurePhase(commitFailure)).toBe("commit");
    expect(getWorkspaceRuntimeFailurePhase(new Error("elsewhere"))).toBeUndefined();
  });

  it("resolves worker init once while reusing a revision-independent runtime key", async () => {
    const first = lease();
    const second = lease({ baseRevision: 8 });
    const acquire = vi
      .fn<UniverCollaborationRuntimePool<unknown>["acquire"]>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const resolveCredential = vi.fn(async () => "workspace_session=secret-cookie");
    const resolveLicense = vi.fn(async () => "secret-license");
    const runtime = createRuntime({ acquire, resolveCredential, resolveLicense });

    await runtime.executeRead({ code: "return 1", target });
    await runtime.executeRead({ code: "return 2", target: { ...target, revision: 8 } });

    expect(resolveCredential).toHaveBeenCalledOnce();
    expect(resolveLicense).toHaveBeenCalledOnce();
    expect(acquire).toHaveBeenCalledTimes(2);
    expect(acquire.mock.calls[0]![0]).toEqual(acquire.mock.calls[1]![0]);
    expect(acquire.mock.calls[0]![0]).toEqual({
      key: "workspace:https%3A%2F%2Fworkspace.test:worktree:wt-1:unit-1:sheet",
      init: {
        credential: "workspace_session=secret-cookie",
        license: "secret-license",
        target,
      },
    });
    expect(acquire.mock.calls[0]![0].key).not.toContain("secret");
  });

  it("forwards an opaque grant by identity to resolvers without keying or serializing it", async () => {
    const grant = { token: Symbol("opaque grant") };
    const caller = { userId: "alice", grant };
    const acquire = vi.fn<UniverCollaborationRuntimePool<unknown>["acquire"]>(async () => lease());
    const resolveCredential = vi.fn<WorkspaceContentRuntimeOptions["resolveCredential"]>(
      async () => "cookie",
    );
    const resolveLicense = vi.fn<WorkspaceContentRuntimeOptions["resolveLicense"]>(
      async () => "license",
    );
    const runtime = createRuntime({ acquire, resolveCredential, resolveLicense });

    await runtime.executeRead({ caller, code: "return 1", target });
    await runtime.executeRead({
      caller: { userId: "alice", grant: "rotated" },
      code: "return 2",
      target,
    });

    expect(resolveCredential.mock.calls[0]).toEqual([target, caller]);
    expect(resolveCredential).toHaveBeenCalledOnce();
    expect(resolveLicense).toHaveBeenCalledWith(caller);
    expect(resolveLicense).toHaveBeenCalledOnce();
    expect(workspaceRuntimeKey(target, caller)).toBe(
      workspaceRuntimeKey(target, { userId: "alice" }),
    );
    expect(acquire.mock.calls[0]![0]).toEqual(acquire.mock.calls[1]![0]);
    expect(acquire.mock.calls[0]![0].init).toEqual({
      credential: "cookie",
      license: "license",
      target,
    });
    expect(resolveCredential.mock.calls[0]?.[1]?.grant).toBe(grant);
  });

  it.each(["executeRead", "executeAndCommit", "exportUnitData"] as const)(
    "observes cold and warm %s calls after cleanup, excluding acquisition time",
    async (method) => {
      let now = 0;
      const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
      const current = lease();
      current.release = vi.fn(async () => {
        now += 7;
      });
      const acquire = vi.fn<UniverCollaborationRuntimePool<unknown>["acquire"]>(async () => {
        now += 100;
        return current;
      });
      const runtime = createRuntime({ acquire });
      const observations: WorkspaceContentRuntimeObservation[] = [];
      const observe = vi.fn((observation: WorkspaceContentRuntimeObservation) => {
        expect(current.release).toHaveBeenCalledTimes(observations.length + 1);
        observations.push(observation);
      });
      try {
        await runtime[method]({ code: "return 1", target, observe });
        await runtime[method]({ code: "return 2", target, observe });
        expect(observe).toHaveBeenCalledTimes(2);
        expect(observations).toEqual([
          { coldStart: true, workerMs: 7 },
          { coldStart: false, workerMs: 7 },
        ]);
      } finally {
        clock.mockRestore();
      }
    },
  );

  it.each(["executeRead", "executeAndCommit", "exportUnitData"] as const)(
    "observes a failing %s call exactly once and isolates observer errors",
    async (method) => {
      const error = new Error("content failed");
      const current = lease({ executeError: error, exportError: error });
      const runtime = createRuntime({ acquire: vi.fn(async () => current) });
      const observe = vi.fn(() => {
        throw new Error("telemetry failed");
      });
      await expect(runtime[method]({ code: "throw", target, observe })).rejects.toBe(error);
      expect(observe).toHaveBeenCalledOnce();
      expect(observe).toHaveBeenCalledWith({ coldStart: true, workerMs: expect.any(Number) });
      if (method === "executeAndCommit") expect(current.invalidate).toHaveBeenCalledOnce();
      else expect(current.release).toHaveBeenCalledOnce();
    },
  );

  it("isolates a throwing observer on success and observes failed cleanup", async () => {
    const current = lease();
    const runtime = createRuntime({ acquire: vi.fn(async () => current) });
    const observe = vi.fn(() => {
      throw new Error("telemetry failed");
    });
    await expect(runtime.exportUnitData({ target, observe })).resolves.toEqual({ id: "unit-1" });
    const error = new Error("release failed");
    current.release = vi.fn(async () => {
      throw error;
    });
    await expect(runtime.exportUnitData({ target, observe })).rejects.toBe(error);
    expect(observe).toHaveBeenCalledTimes(2);
  });

  it("does not observe calls that never acquire a lease", async () => {
    const observe = vi.fn();
    const runtime = createRuntime({
      acquire: vi.fn(async () => {
        throw new Error("open failed");
      }),
    });
    await expect(runtime.executeRead({ code: "return 1", target, observe })).rejects.toThrow(
      "open failed",
    );
    await expect(
      runtime.executeAndCommit({
        code: "return 1",
        target: { ...target, scope: { kind: "trunk" } },
        observe,
      }),
    ).rejects.toMatchObject({ code: "WORKSPACE_TARGET_NOT_EDITABLE" });
    expect(observe).not.toHaveBeenCalled();
  });

  it("copies transport into worker init and uploads commit-time images there with the identity origin", async () => {
    const requests: {
      path: string | undefined;
      cookie: string | undefined;
      origin: string | undefined;
    }[] = [];
    const server = createServer((request, response) => {
      requests.push({
        path: request.url,
        cookie: request.headers.cookie,
        origin: request.headers.origin,
      });
      request.resume();
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ FileId: "file-transport" }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (address === null || typeof address === "string")
        throw new Error("Missing test server address");
      const transportOrigin = `http://127.0.0.1:${String(address.port)}`;
      const png = `data:image/png;base64,${Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64")}`;
      const current = lease({
        commitResults: [commitResult("confirmed", 8)],
        writeMutations: [
          { id: "image", data: JSON.stringify({ imageSourceType: "BASE64", source: png }) },
        ],
      });
      const acquire = vi.fn<UniverCollaborationRuntimePool<unknown>["acquire"]>(
        async () => current,
      );
      const runtime = createRuntime({ acquire, transportOrigin });
      await expect(runtime.executeAndCommit({ code: "edit", target })).resolves.toMatchObject({
        committed: true,
        revision: 8,
      });
      expect(acquire.mock.calls[0]?.[0]).toEqual({
        init: { credential: "cookie", license: "license", target, transportOrigin },
        key: workspaceRuntimeKey(target),
      });
      expect(requests).toEqual([
        {
          path: "/universer-api/worktrees/wt-1/stream/file/upload?assign=unit-1&size=8&source=3",
          cookie: "cookie",
          origin: target.origin,
        },
      ]);
      expect(current.replacePendingMutations).toHaveBeenCalledWith([
        {
          id: "image",
          data: JSON.stringify({ imageSourceType: "UUID", source: "file-transport" }),
        },
      ]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error === undefined ? resolve() : reject(error))),
      );
    }
  });

  it("keys workers and credentials per caller and resolves once per caller", async () => {
    const acquire = vi.fn<UniverCollaborationRuntimePool<unknown>["acquire"]>(async () => lease());
    const resolveCredential = vi.fn(
      async (_target: WorkspaceRuntimeTarget, caller?: { readonly userId: string }) =>
        `cookie-of-${caller?.userId ?? "none"}`,
    );
    const resolveLicense = vi.fn(async () => "license");
    const runtime = createRuntime({ acquire, resolveCredential, resolveLicense });
    const alice = { userId: "alice" };
    const bob = { userId: "bob" };

    await runtime.executeRead({ caller: alice, code: "return 1", target });
    await runtime.executeRead({ caller: bob, code: "return 1", target });
    await runtime.executeRead({ caller: alice, code: "return 2", target });

    expect(resolveCredential.mock.calls).toEqual([
      [target, alice],
      [target, bob],
    ]);
    expect(resolveLicense.mock.calls).toEqual([[alice], [bob]]);
    const inputs = acquire.mock.calls.map(([input]) => input);
    expect(inputs[0]!.key).not.toBe(inputs[1]!.key);
    expect(inputs[2]).toEqual(inputs[0]);
    expect(inputs[0]).toMatchObject({ init: { credential: "cookie-of-alice" } });
    expect(inputs[1]).toMatchObject({ init: { credential: "cookie-of-bob" } });
  });

  it("re-resolves dependencies after worker creation fails before a lease forms", async () => {
    const current = lease();
    const acquire = vi
      .fn<UniverCollaborationRuntimePool<unknown>["acquire"]>()
      .mockImplementationOnce(async (input) => {
        poolMock.options?.onEvent?.({ key: input.key, type: "create-start" });
        throw new Error("worker open failed");
      })
      .mockImplementationOnce(async (input) => {
        poolMock.options?.onEvent?.({ key: input.key, type: "create-start" });
        return current;
      });
    const resolveCredential = vi
      .fn<WorkspaceContentRuntimeOptions["resolveCredential"]>()
      .mockResolvedValueOnce("expired-cookie")
      .mockResolvedValueOnce("current-cookie");
    const resolveLicense = vi
      .fn<WorkspaceContentRuntimeOptions["resolveLicense"]>()
      .mockResolvedValueOnce("expired-license")
      .mockResolvedValueOnce("current-license");
    const runtime = createRuntime({ acquire, resolveCredential, resolveLicense });

    await expect(runtime.exportUnitData({ target })).rejects.toThrow("worker open failed");
    await expect(runtime.exportUnitData({ target })).resolves.toEqual({ id: "unit-1" });

    expect(resolveCredential).toHaveBeenCalledTimes(2);
    expect(resolveLicense).toHaveBeenCalledTimes(2);
    expect(acquire.mock.calls.map(([input]) => input.init)).toEqual([
      expect.objectContaining({ credential: "expired-cookie", license: "expired-license" }),
      expect.objectContaining({ credential: "current-cookie", license: "current-license" }),
    ]);
    expect(current.exportUnitData).toHaveBeenCalledOnce();
  });

  it("keeps a pre-failure waiter out of the pool until the failed generation is destroyed", async () => {
    const png = `data:image/png;base64,${Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64")}`;
    const old = lease();
    const fresh = lease({
      commitResults: [commitResult("confirmed", 8)],
      writeMutations: [
        { data: JSON.stringify({ imageSourceType: "BASE64", source: png }), id: "image" },
      ],
    });
    const hit = lease();
    let key = "";
    let oldStarted!: () => void;
    let failOld!: () => void;
    let oldFailed!: () => void;
    let invalidationStarted!: () => void;
    let finishInvalidation!: () => void;
    const oldRunning = new Promise<void>((resolve) => {
      oldStarted = resolve;
    });
    const allowFailure = new Promise<void>((resolve) => {
      failOld = resolve;
    });
    const failureObserved = new Promise<void>((resolve) => {
      oldFailed = resolve;
    });
    const invalidating = new Promise<void>((resolve) => {
      invalidationStarted = resolve;
    });
    const allowInvalidation = new Promise<void>((resolve) => {
      finishInvalidation = resolve;
    });
    old.execute = vi.fn(async () => {
      oldStarted();
      await allowFailure;
      poolMock.options?.onEvent?.({ errorCode: "WORKER_FAILED", key, type: "instance-failed" });
      oldFailed();
      throw new Error("old worker failed");
    });
    old.invalidate = vi.fn(async () => {
      poolMock.options?.onEvent?.({ key, reason: "invalidate", type: "destroy-start" });
      invalidationStarted();
      await allowInvalidation;
      poolMock.options?.onEvent?.({ key, reason: "invalidate", type: "evicted" });
    });
    const acquire = vi
      .fn<UniverCollaborationRuntimePool<unknown>["acquire"]>()
      .mockImplementationOnce(async (input) => {
        key = input.key;
        poolMock.options?.onEvent?.({ key, type: "create-start" });
        return old;
      })
      .mockImplementationOnce(async (input) => {
        poolMock.options?.onEvent?.({ key: input.key, type: "create-start" });
        return fresh;
      })
      .mockImplementationOnce(async (input) => {
        poolMock.options?.onEvent?.({ key: input.key, type: "cache-hit" });
        return hit;
      });
    const resolveCredential = vi
      .fn<WorkspaceContentRuntimeOptions["resolveCredential"]>()
      .mockResolvedValueOnce("old-cookie")
      .mockResolvedValueOnce("new-cookie");
    const resolveLicense = vi
      .fn<WorkspaceContentRuntimeOptions["resolveLicense"]>()
      .mockResolvedValueOnce("old-license")
      .mockResolvedValueOnce("new-license");
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ FileId: "file-1" }), {
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const runtime = createRuntime({ acquire, resolveCredential, resolveLicense });

    const failed = runtime
      .executeAndCommit({ code: "fail", target })
      .catch((error: unknown) => error);
    await oldRunning;
    const preFailureWaiter = runtime.executeAndCommit({ code: "edit", target });
    await Promise.resolve();
    expect(acquire).toHaveBeenCalledOnce();
    expect(resolveCredential).toHaveBeenCalledOnce();
    failOld();
    await failureObserved;
    await invalidating;
    const postFailureWaiter = runtime.executeRead({ code: "return 1", target });
    await Promise.resolve();
    expect(acquire).toHaveBeenCalledOnce();
    expect(resolveCredential).toHaveBeenCalledOnce();
    finishInvalidation();

    expect(await failed).toMatchObject({ message: "old worker failed" });
    await expect(preFailureWaiter).resolves.toMatchObject({ committed: true, revision: 8 });
    await postFailureWaiter;

    expect(resolveCredential).toHaveBeenCalledTimes(2);
    expect(resolveLicense).toHaveBeenCalledTimes(2);
    expect(acquire.mock.calls[1]![0].init).toBe(acquire.mock.calls[2]![0].init);
    expect(acquire.mock.calls[1]![0].init).toMatchObject({
      credential: "new-cookie",
      license: "new-license",
    });
    expect(new Headers(fetcher.mock.calls[0]![1]?.headers).get("cookie")).toBe("new-cookie");
    vi.unstubAllGlobals();
  });

  it.each(["ttl", "lru"] as const)(
    "keeps the new generation canonical across delayed %s eviction completion",
    async (reason) => {
      const old = lease();
      const fresh = lease();
      const hit = lease();
      let key = "";
      const acquire = vi
        .fn<UniverCollaborationRuntimePool<unknown>["acquire"]>()
        .mockImplementationOnce(async (input) => {
          key = input.key;
          poolMock.options?.onEvent?.({ key, type: "create-start" });
          return old;
        })
        .mockImplementationOnce(async (input) => {
          poolMock.options?.onEvent?.({ key: input.key, type: "create-start" });
          return fresh;
        })
        .mockImplementationOnce(async (input) => {
          poolMock.options?.onEvent?.({ key: input.key, type: "cache-hit" });
          return hit;
        });
      const resolveCredential = vi
        .fn<WorkspaceContentRuntimeOptions["resolveCredential"]>()
        .mockResolvedValueOnce("old-cookie")
        .mockResolvedValueOnce("new-cookie");
      const resolveLicense = vi
        .fn<WorkspaceContentRuntimeOptions["resolveLicense"]>()
        .mockResolvedValueOnce("old-license")
        .mockResolvedValueOnce("new-license");
      const runtime = createRuntime({ acquire, resolveCredential, resolveLicense });

      await runtime.executeRead({ code: "first", target });
      poolMock.options?.onEvent?.({ key, reason, type: "destroy-start" });
      await runtime.executeRead({ code: "replacement", target });
      poolMock.options?.onEvent?.({ key, reason, type: "evicted" });
      await runtime.executeRead({ code: "cache hit", target });

      expect(resolveCredential).toHaveBeenCalledTimes(2);
      expect(resolveLicense).toHaveBeenCalledTimes(2);
      expect(acquire.mock.calls[1]![0].init).toBe(acquire.mock.calls[2]![0].init);
      expect(acquire.mock.calls[1]![0].init).toMatchObject({
        credential: "new-cookie",
        license: "new-license",
      });
    },
  );

  it("re-resolves dependencies after an explicit write invalidation", async () => {
    const invalid = lease({
      commitResults: [commitResult("conflict", 7)],
      writeMutations: [{ data: "{}", id: "mutation-1" }],
    });
    const recovered = lease();
    let key = "";
    invalid.invalidate = vi.fn(async () => {
      poolMock.options?.onEvent?.({ key, reason: "invalidate", type: "evicted" });
    });
    const acquire = vi
      .fn<UniverCollaborationRuntimePool<unknown>["acquire"]>()
      .mockImplementationOnce(async (input) => {
        key = input.key;
        poolMock.options?.onEvent?.({ key, type: "create-start" });
        return invalid;
      })
      .mockImplementationOnce(async (input) => {
        poolMock.options?.onEvent?.({ key: input.key, type: "create-start" });
        return recovered;
      });
    const resolveCredential = vi
      .fn<WorkspaceContentRuntimeOptions["resolveCredential"]>()
      .mockResolvedValueOnce("old-cookie")
      .mockResolvedValueOnce("new-cookie");
    const resolveLicense = vi
      .fn<WorkspaceContentRuntimeOptions["resolveLicense"]>()
      .mockResolvedValueOnce("old-license")
      .mockResolvedValueOnce("new-license");
    const runtime = createRuntime({ acquire, resolveCredential, resolveLicense });

    await expect(runtime.executeAndCommit({ code: "edit", target })).rejects.toMatchObject({
      code: "WORKSPACE_RUNTIME_CONFLICT",
    });
    await runtime.executeRead({ code: "return 1", target });

    expect(resolveCredential).toHaveBeenCalledTimes(2);
    expect(resolveLicense).toHaveBeenCalledTimes(2);
    expect(acquire.mock.calls[0]![0].init).toMatchObject({ credential: "old-cookie" });
    expect(acquire.mock.calls[1]![0].init).toMatchObject({ credential: "new-cookie" });
  });

  it("does not start a worker when the credential or license is unavailable", async () => {
    const acquire = vi.fn<UniverCollaborationRuntimePool<unknown>["acquire"]>();
    const withoutCredential = createRuntime({
      acquire,
      resolveCredential: async () => undefined,
      resolveLicense: async () => "license-secret",
    });
    await expect(withoutCredential.exportUnitData({ target })).rejects.toMatchObject({
      code: "workspace-authentication-required",
    });
    const withoutLicense = createRuntime({
      acquire,
      resolveCredential: async () => "cookie-secret",
      resolveLicense: async () => "",
    });
    const error = await withoutLicense
      .exportUnitData({ target })
      .catch((reason: unknown) => reason);
    expect(error).toMatchObject({ code: "workspace-license-required" });
    expect(JSON.stringify(error)).not.toContain("cookie-secret");
    expect(acquire).not.toHaveBeenCalled();
  });

  it("sanitizes a rejected credential resolver before pool or content access", async () => {
    const current = lease();
    const acquire = vi.fn<UniverCollaborationRuntimePool<unknown>["acquire"]>(async () => current);
    const fetcher = vi.spyOn(globalThis, "fetch");
    const runtime = createRuntime({
      acquire,
      resolveCredential: async () => {
        throw new Error("fixture-cookie-secret");
      },
    });

    try {
      const error = await runtime.exportUnitData({ target }).catch((reason: unknown) => reason);
      expect(error).toMatchObject({
        code: "workspace-authentication-required",
        message: "Log in to the current Workspace origin first.",
      });
      expect(`${String(error)}${JSON.stringify(error)}`).not.toContain("fixture-cookie-secret");
      expect(fetcher).not.toHaveBeenCalled();
      expect(acquire).not.toHaveBeenCalled();
      expect(current.getState).not.toHaveBeenCalled();
      expect(current.exportUnitData).not.toHaveBeenCalled();
    } finally {
      fetcher.mockRestore();
    }
  });

  it("sanitizes a rejected license resolver", async () => {
    const acquire = vi.fn<UniverCollaborationRuntimePool<unknown>["acquire"]>();
    const runtime = createRuntime({
      acquire,
      resolveLicense: async () => {
        throw new Error("secret-license-bytes");
      },
    });

    const error = await runtime.exportUnitData({ target }).catch((reason: unknown) => reason);
    expect(error).toMatchObject({ code: "workspace-license-required" });
    expect(`${String(error)}${JSON.stringify(error)}`).not.toContain("secret-license-bytes");
    expect(acquire).not.toHaveBeenCalled();
  });

  it("waits for the runtime pool to close", async () => {
    let settle!: () => void;
    const close = vi.fn(
      async () =>
        await new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    const runtime = createRuntime({ close });
    let closed = false;
    const pending = runtime.close().then(() => {
      closed = true;
    });

    await Promise.resolve();
    expect(close).toHaveBeenCalledOnce();
    expect(closed).toBe(false);
    settle();
    await pending;
    expect(closed).toBe(true);
  });

  it("returns lossless read values and always releases the lease", async () => {
    const value = { nested: [null, false, 0, ""] };
    const current = lease({ executeValue: value });
    const runtime = createRuntime({ acquire: vi.fn(async () => current) });

    await expect(runtime.executeRead({ code: "return value", target })).resolves.toMatchObject({
      value,
    });
    expect(current.execute).toHaveBeenCalledWith({ code: "return value", mode: "read" });
    expect(current.replacePendingMutations).not.toHaveBeenCalled();
    expect(current.commit).not.toHaveBeenCalled();
    expect(current.release).toHaveBeenCalledOnce();
    expect(current.invalidate).not.toHaveBeenCalled();
  });

  it("returns exact UnitData and releases the lease", async () => {
    const unitData = { id: "unit-1", resources: [], sheets: {}, styles: {} };
    const current = lease({ unitData });
    const runtime = createRuntime({ acquire: vi.fn(async () => current) });

    await expect(runtime.exportUnitData({ target })).resolves.toBe(unitData);
    expect(current.exportUnitData).toHaveBeenCalledOnce();
    expect(current.execute).not.toHaveBeenCalled();
    expect(current.release).toHaveBeenCalledOnce();
  });

  it("releases formed read and export leases when content access fails", async () => {
    const read = lease({ executeError: new Error("read failed") });
    const exported = lease({ exportError: new Error("export failed") });
    const acquire = vi
      .fn<UniverCollaborationRuntimePool<unknown>["acquire"]>()
      .mockResolvedValueOnce(read)
      .mockResolvedValueOnce(exported);
    const runtime = createRuntime({ acquire });

    await expect(runtime.executeRead({ code: "throw new Error()", target })).rejects.toThrow(
      "read failed",
    );
    await expect(runtime.exportUnitData({ target })).rejects.toThrow("export failed");
    expect(read.release).toHaveBeenCalledOnce();
    expect(exported.release).toHaveBeenCalledOnce();
    expect(read.invalidate).not.toHaveBeenCalled();
    expect(exported.invalidate).not.toHaveBeenCalled();
  });

  it.each([
    ["pending mutations", { pendingMutationCount: 1 }],
    [
      "awaiting changeset",
      { awaitingChangeset: { baseRevision: 7, mutationCount: 1, revision: 8 } },
    ],
    [
      "conflict state",
      {
        conflict: {
          message: "stale",
          operation: "pull" as const,
          reason: "transform-failed" as const,
        },
      },
    ],
  ])("rejects dirty runtime state before pulling: %s", async (_label, state) => {
    const current = lease({ state });
    const runtime = createRuntime({ acquire: vi.fn(async () => current) });

    await expect(runtime.executeRead({ code: "return 1", target })).rejects.toMatchObject({
      code: "WORKSPACE_RUNTIME_DIRTY",
    });
    expect(current.pull).not.toHaveBeenCalled();
    expect(current.execute).not.toHaveBeenCalled();
    expect(current.release).toHaveBeenCalledOnce();
  });

  it("preserves pull conflict and revision mismatch failures", async () => {
    const conflict = lease({ pullStatus: "conflict" });
    const mismatch = lease({ baseRevision: 6 });
    const acquire = vi
      .fn<UniverCollaborationRuntimePool<unknown>["acquire"]>()
      .mockResolvedValueOnce(conflict)
      .mockResolvedValueOnce(mismatch);
    const runtime = createRuntime({ acquire });

    await expect(runtime.exportUnitData({ target })).rejects.toMatchObject({
      code: "WORKSPACE_RUNTIME_CONFLICT",
      message: "upstream conflict",
    });
    await expect(runtime.exportUnitData({ target })).rejects.toMatchObject({
      code: "workspace-result-mismatch",
    });
    expect(conflict.exportUnitData).not.toHaveBeenCalled();
    expect(mismatch.exportUnitData).not.toHaveBeenCalled();
    expect(conflict.release).toHaveBeenCalledOnce();
    expect(mismatch.release).toHaveBeenCalledOnce();
  });

  it("rejects Trunk before acquiring a write runtime", async () => {
    const acquire = vi.fn<UniverCollaborationRuntimePool<unknown>["acquire"]>();
    const runtime = createRuntime({ acquire });

    await expect(
      runtime.executeAndCommit({
        code: "return null",
        target: { ...target, scope: { kind: "trunk" } },
      }),
    ).rejects.toMatchObject({ code: "WORKSPACE_TARGET_NOT_EDITABLE" });
    expect(acquire).not.toHaveBeenCalled();
  });

  it("releases a reusable runtime when write execution captures no mutations", async () => {
    const current = lease({ writeMutations: [], writeValue: { unchanged: true } });
    const runtime = createRuntime({ acquire: vi.fn(async () => current) });

    await expect(runtime.executeAndCommit({ code: "return value", target })).resolves.toEqual({
      committed: false,
      value: { unchanged: true },
    });
    expect(current.execute).toHaveBeenCalledWith({ code: "return value", mode: "write" });
    expect(current.replacePendingMutations).not.toHaveBeenCalled();
    expect(current.commit).not.toHaveBeenCalled();
    expect(current.release).toHaveBeenCalledOnce();
    expect(current.invalidate).not.toHaveBeenCalled();
  });

  it("externalizes, replaces and confirms mutations exactly once", async () => {
    const mutations = [{ data: JSON.stringify({ value: 1 }), id: "mutation-1" }];
    const current = lease({
      commitResults: [commitResult("confirmed", 9)],
      writeMutations: mutations,
    });
    const runtime = createRuntime({ acquire: vi.fn(async () => current) });

    await expect(runtime.executeAndCommit({ code: "edit", target })).resolves.toEqual({
      committed: true,
      revision: 9,
      status: "committed",
      value: null,
    });
    expect(current.execute).toHaveBeenCalledOnce();
    expect(current.replacePendingMutations).toHaveBeenCalledOnce();
    expect(current.replacePendingMutations).toHaveBeenCalledWith(mutations);
    expect(current.commit).toHaveBeenCalledOnce();
    expect(current.commit).toHaveBeenCalledWith();
    expect(current.release).toHaveBeenCalledOnce();
    expect(current.invalidate).not.toHaveBeenCalled();
  });

  it("retries the same externalized pending changeset without replaying work", async () => {
    const png = `data:image/png;base64,${Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64")}`;
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ FileId: "file-1" }), {
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const current = lease({
      commitResults: [
        commitResult("retry", 7),
        commitResult("unknown", 7),
        commitResult("confirmed", 8),
      ],
      writeMutations: [
        { data: JSON.stringify({ imageSourceType: "BASE64", source: png }), id: "image" },
      ],
      writeValue: "done",
    });
    const runtime = createRuntime({ acquire: vi.fn(async () => current) });

    await expect(runtime.executeAndCommit({ code: "edit", target })).resolves.toEqual({
      committed: true,
      revision: 8,
      status: "committed",
      value: "done",
    });
    expect(current.execute).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(current.replacePendingMutations).toHaveBeenCalledOnce();
    expect(current.commit).toHaveBeenCalledTimes(3);
    expect(current.release).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it.each([
    ["conflict", [commitResult("conflict", 7)], "WORKSPACE_RUNTIME_CONFLICT", 1],
    ["pull-required", [commitResult("pull-required", 7)], "WORKSPACE_RUNTIME_PULL_REQUIRED", 1],
    ["discard", [commitResult("nothing-to-commit", 7)], "WORKSPACE_RUNTIME_COMMIT_INVALID", 1],
    [
      "exhaustion",
      [commitResult("retry", 7), commitResult("unknown", 7), commitResult("retry", 7)],
      "workspace-submit-retry-exhausted",
      3,
    ],
  ])("invalidates after terminal commit outcome: %s", async (_label, results, code, attempts) => {
    const current = lease({
      commitResults: results,
      writeMutations: [{ data: "{}", id: "mutation-1" }],
    });
    const runtime = createRuntime({ acquire: vi.fn(async () => current) });

    await expect(runtime.executeAndCommit({ code: "edit", target })).rejects.toMatchObject({
      code,
    });
    expect(current.commit).toHaveBeenCalledTimes(attempts);
    expect(current.invalidate).toHaveBeenCalledOnce();
    expect(current.release).not.toHaveBeenCalled();
  });

  it.each([
    ["execution", { executeError: new Error("execute failed"), writeMutations: [] }],
    ["malformed result", { malformedWriteResult: true, writeMutations: [{}] }],
    [
      "replacement",
      {
        replaceError: new Error("replace failed"),
        writeMutations: [{ data: "{}", id: "mutation-1" }],
      },
    ],
  ])("invalidates after %s failure without replay", async (_label, options) => {
    const current = lease(options);
    const runtime = createRuntime({ acquire: vi.fn(async () => current) });

    const expectation = expect(runtime.executeAndCommit({ code: "edit", target })).rejects;
    if (_label === "malformed result") {
      await expectation.toMatchObject({ code: "WORKSPACE_RUNTIME_RESULT_INVALID" });
    } else {
      await expectation.toBeDefined();
    }
    expect(current.execute).toHaveBeenCalledOnce();
    expect(current.invalidate).toHaveBeenCalledOnce();
    expect(current.release).not.toHaveBeenCalled();
  });
});

function createRuntime(
  overrides: Partial<UniverCollaborationRuntimePool<unknown>> &
    Partial<WorkspaceContentRuntimeOptions> = {},
) {
  poolMock.pool = {
    acquire: overrides.acquire ?? vi.fn(async () => lease()),
    close: overrides.close ?? vi.fn(async () => undefined),
  };
  return createWorkspaceContentRuntime({
    ...(overrides.pool === undefined ? {} : { pool: overrides.pool }),
    ...(overrides.transportOrigin === undefined
      ? {}
      : { transportOrigin: overrides.transportOrigin }),
    ...(overrides.reuseWorker === undefined ? {} : { reuseWorker: overrides.reuseWorker }),
    resolveCredential: overrides.resolveCredential ?? (async () => "cookie"),
    resolveLicense: overrides.resolveLicense ?? (async () => "license"),
    workerEntry: overrides.workerEntry ?? new URL("file:///package/worker.js"),
  });
}

function lease(
  options: {
    readonly baseRevision?: number;
    readonly commitResults?: readonly unknown[];
    readonly executeError?: Error;
    readonly executeGate?: Promise<void>;
    readonly executeValue?: unknown;
    readonly exportError?: Error;
    readonly malformedWriteResult?: boolean;
    readonly pullStatus?: "conflict" | "pulled";
    readonly replaceError?: Error;
    readonly state?: Partial<CollaborationRuntimeState>;
    readonly unitData?: unknown;
    readonly writeMutations?: readonly unknown[];
    readonly writeValue?: unknown;
  } = {},
): UniverCollaborationRuntimeLease {
  const state: CollaborationRuntimeState = {
    awaitingChangeset: null,
    baseRevision: options.baseRevision ?? 7,
    bufferedChangesetCount: 0,
    conflict: null,
    connection: "online",
    knownHeadRevision: options.baseRevision ?? 7,
    pendingMutationCount: 0,
    ...options.state,
  };
  const pull: CollaborationPullResult =
    options.pullStatus === "conflict"
      ? {
          conflict: { message: "upstream conflict", operation: "pull", reason: "transform-failed" },
          state,
          status: "conflict",
        }
      : {
          appliedChangesets: [],
          fromRevision: state.baseRevision,
          state,
          status: "pulled",
          toRevision: state.baseRevision,
          transformedPendingMutationCount: 0,
        };
  const commits = [...(options.commitResults ?? [])];
  return {
    commit: vi.fn(async () => commits.shift()),
    execute: vi.fn(async (input: { readonly mode: "read" | "write" }) => {
      await options.executeGate;
      if (options.executeError !== undefined) throw options.executeError;
      if (input.mode === "write") {
        if (options.malformedWriteResult === true) return { value: null };
        return {
          mutations: options.writeMutations ?? [],
          state,
          value: options.writeValue ?? null,
        };
      }
      return { state, value: options.executeValue ?? null };
    }),
    exportUnitData: vi.fn(async () => {
      if (options.exportError !== undefined) throw options.exportError;
      return options.unitData ?? { id: "unit-1" };
    }),
    fetch: vi.fn(),
    getPendingMutations: vi.fn(),
    getState: vi.fn(async () => state),
    invalidate: vi.fn(async () => undefined),
    key: "key",
    pull: vi.fn(async () => pull),
    release: vi.fn(async () => undefined),
    replacePendingMutations: vi.fn(async () => {
      if (options.replaceError !== undefined) throw options.replaceError;
      return {
        pendingMutationCount: options.writeMutations?.length ?? 0,
        previousMutationCount: 0,
        state,
      };
    }),
    unitId: "unit-1",
    unitType: 2,
  } as unknown as UniverCollaborationRuntimeLease;
}

function commitResult(status: string, baseRevision: number): unknown {
  const state = {
    awaitingChangeset: null,
    baseRevision,
    bufferedChangesetCount: 0,
    conflict: null,
    connection: "online",
    knownHeadRevision: baseRevision,
    pendingMutationCount: status === "confirmed" ? 0 : 1,
  };
  if (status === "confirmed") {
    return { confirmedChangesets: [], reconciledChangesets: [], state, status };
  }
  if (status === "retry" || status === "unknown") {
    return {
      changeset: {
        baseRevision,
        mutationCount: 1,
        reqId: 2,
        revision: baseRevision + 1,
        sid: "sid-1",
      },
      confirmedChangesets: [],
      state,
      status,
    };
  }
  if (status === "conflict") {
    return {
      conflict: { message: "commit conflict", operation: "commit", reason: "transform-failed" },
      confirmedChangesets: [],
      state,
      status,
    };
  }
  if (status === "pull-required") {
    return {
      baseRevision,
      confirmedChangesets: [],
      knownHeadRevision: baseRevision + 1,
      state,
      status,
    };
  }
  return { state, status };
}

describe("Workspace content runtime slot queue with a fake pool", () => {
  const alice = { userId: "alice" };
  const bob = { userId: "bob" };
  const carol = { userId: "carol" };
  const busy = { code: "workspace-runtime-busy", detail: { retryable: true } };
  const queued = (timeoutMs: number) => ({ maxWorkers: 1, queue: { timeoutMs } });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function gatedLease(options: Parameters<typeof lease>[0] = {}) {
    let open!: () => void;
    const executeGate = new Promise<void>((resolve) => {
      open = resolve;
    });
    return { lease: lease({ ...options, executeGate }), open };
  }

  function capacityError() {
    return new UniverCollaborationRuntimePoolError(
      "COLLABORATION_POOL_CAPACITY_EXCEEDED",
      "capacity exceeded",
    );
  }

  it("releases the slot of a failing operation and admits the waiting key", async () => {
    const failing = gatedLease({ malformedWriteResult: true });
    const acquire = vi
      .fn<UniverCollaborationRuntimePool<unknown>["acquire"]>()
      .mockResolvedValueOnce(failing.lease)
      .mockResolvedValue(lease());
    const runtime = createRuntime({ acquire, pool: queued(60_000) });

    const failed = runtime.executeAndCommit({ caller: alice, code: "x", target });
    const failedSettled = expect(failed).rejects.toMatchObject({
      code: "WORKSPACE_RUNTIME_RESULT_INVALID",
    });
    await vi.advanceTimersByTimeAsync(0);
    const waiting = runtime.exportUnitData({ caller: bob, target });
    await vi.advanceTimersByTimeAsync(100);
    expect(acquire).toHaveBeenCalledOnce();

    failing.open();
    await failedSettled;
    await expect(waiting).resolves.toEqual({ id: "unit-1" });
    expect(failing.lease.invalidate).toHaveBeenCalledOnce();
  });

  it("times out one same-key waiter without disturbing a later waiter of that key", async () => {
    const holder = gatedLease();
    const acquire = vi
      .fn<UniverCollaborationRuntimePool<unknown>["acquire"]>()
      .mockResolvedValueOnce(holder.lease)
      .mockResolvedValue(lease());
    const runtime = createRuntime({ acquire, pool: queued(300) });

    const held = runtime.executeRead({ caller: alice, code: "x", target });
    await vi.advanceTimersByTimeAsync(0);
    const first = runtime.exportUnitData({ caller: bob, target });
    const firstSettled = expect(first).rejects.toMatchObject(busy);
    await vi.advanceTimersByTimeAsync(150);
    const second = runtime.exportUnitData({ caller: bob, target });

    await vi.advanceTimersByTimeAsync(160);
    await firstSettled;
    holder.open();
    await held;

    await expect(second).resolves.toEqual({ id: "unit-1" });
  });

  it("rejects queued and later operations on close and leaves no timer behind", async () => {
    const holder = gatedLease();
    const acquire = vi
      .fn<UniverCollaborationRuntimePool<unknown>["acquire"]>()
      .mockResolvedValueOnce(holder.lease)
      .mockResolvedValue(lease());
    const runtime = createRuntime({ acquire, pool: queued(60_000) });

    const held = runtime.executeRead({ caller: alice, code: "x", target });
    await vi.advanceTimersByTimeAsync(0);
    const closed = { code: "workspace-runtime-closed" };
    const waiters = [bob, carol, bob].map((caller) =>
      expect(runtime.exportUnitData({ caller, target })).rejects.toMatchObject(closed),
    );
    await vi.advanceTimersByTimeAsync(10);

    await runtime.close();
    await Promise.all(waiters);
    expect(vi.getTimerCount()).toBe(0);
    await expect(runtime.exportUnitData({ caller: carol, target })).rejects.toMatchObject(closed);
    await expect(runtime.exportUnitData({ caller: alice, target })).rejects.toMatchObject(closed);
    holder.open();
    await held;
    expect(acquire).toHaveBeenCalledOnce();
  });

  it("retries the pool capacity error after admission, then succeeds", async () => {
    const acquire = vi
      .fn<UniverCollaborationRuntimePool<unknown>["acquire"]>()
      .mockRejectedValueOnce(capacityError())
      .mockRejectedValueOnce(capacityError())
      .mockRejectedValueOnce(capacityError())
      .mockResolvedValue(lease());
    const runtime = createRuntime({ acquire, pool: queued(1000) });

    const result = runtime.exportUnitData({ caller: alice, target });
    await vi.advanceTimersByTimeAsync(500);

    await expect(result).resolves.toEqual({ id: "unit-1" });
    expect(acquire).toHaveBeenCalledTimes(4);
  });

  it("fails with the busy error once the capacity retry passes the deadline, freeing the slot", async () => {
    const acquire = vi
      .fn<UniverCollaborationRuntimePool<unknown>["acquire"]>()
      .mockRejectedValue(capacityError());
    const runtime = createRuntime({ acquire, pool: queued(100) });

    const result = runtime.exportUnitData({ caller: alice, target });
    const settled = expect(result).rejects.toMatchObject(busy);
    await vi.advanceTimersByTimeAsync(500);
    await settled;
    expect(acquire.mock.calls.length).toBeGreaterThan(1);

    acquire.mockReset();
    acquire.mockResolvedValue(lease());
    await expect(runtime.exportUnitData({ caller: bob, target })).resolves.toEqual({
      id: "unit-1",
    });
  });

  it.each([
    ["maxWorkers 0", { maxWorkers: 0, queue: { timeoutMs: 1000 } }],
    ["fractional maxWorkers", { maxWorkers: 1.5, queue: { timeoutMs: 1000 } }],
    ["negative timeoutMs", { maxWorkers: 1, queue: { timeoutMs: -1 } }],
    ["fractional timeoutMs", { maxWorkers: 1, queue: { timeoutMs: 1.5 } }],
    ["NaN timeoutMs", { maxWorkers: 1, queue: { timeoutMs: Number.NaN } }],
    ["Infinity timeoutMs", { maxWorkers: 1, queue: { timeoutMs: Number.POSITIVE_INFINITY } }],
    ["timeoutMs beyond the timer limit", { maxWorkers: 1, queue: { timeoutMs: 2_147_483_648 } }],
    ["missing maxWorkers", { queue: { timeoutMs: 1000 } }],
  ])("rejects %s at construction", (_name, pool) => {
    expect(() => createRuntime({ pool })).toThrow(
      expect.objectContaining({ code: "workspace-argument-invalid" }),
    );
  });

  it("accepts the timer limit and a zero timeout", () => {
    expect(() => createRuntime({ pool: queued(2_147_483_647) })).not.toThrow();
    expect(() => createRuntime({ pool: queued(0) })).not.toThrow();
  });
});
