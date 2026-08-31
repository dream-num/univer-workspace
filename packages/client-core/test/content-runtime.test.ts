import type {
  CollaborationPullResult,
  CollaborationRuntimeState,
  UniverCollaborationRuntimeLease,
  UniverCollaborationRuntimePool,
  UniverCollaborationRuntimePoolOptions,
} from "@univer-cli/univer-collaboration-runtime-pool";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWorkspaceContentRuntime,
  type WorkspaceContentRuntimeOptions,
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
    expect(acquire.mock.calls[0]![0]).toMatchObject({
      init: {
        credential: "workspace_session=secret-cookie",
        license: "secret-license",
        target,
      },
    });
    expect(acquire.mock.calls[0]![0].key).not.toContain("secret");
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
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ FileId: "file-1" }), {
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const runtime = createRuntime({ acquire, resolveCredential, resolveLicense });

    const failed = runtime.executeAndCommit({ code: "fail", target }).catch((error: unknown) => error);
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
    const error = await withoutLicense.exportUnitData({ target }).catch((reason: unknown) => reason);
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
    ["awaiting changeset", { awaitingChangeset: { baseRevision: 7, mutationCount: 1, revision: 8 } }],
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

    await expect(
      runtime.executeAndCommit({ code: "return value", target }),
    ).resolves.toEqual({ committed: false, value: { unchanged: true } });
    expect(current.execute).toHaveBeenCalledWith({ code: "return value", mode: "write" });
    expect(current.replacePendingMutations).not.toHaveBeenCalled();
    expect(current.commit).not.toHaveBeenCalled();
    expect(current.release).toHaveBeenCalledOnce();
    expect(current.invalidate).not.toHaveBeenCalled();
  });

  it("externalizes, replaces and confirms mutations exactly once", async () => {
    const mutations = [{ data: JSON.stringify({ value: 1 }), id: "mutation-1" }];
    const current = lease({ commitResults: [commitResult("confirmed", 9)], writeMutations: mutations });
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
    expect(current.release).toHaveBeenCalledOnce();
    expect(current.invalidate).not.toHaveBeenCalled();
  });

  it("retries the same externalized pending changeset without replaying work", async () => {
    const png = `data:image/png;base64,${Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64")}`;
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ FileId: "file-1" }), {
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const current = lease({
      commitResults: [commitResult("retry", 7), commitResult("unknown", 7), commitResult("confirmed", 8)],
      writeMutations: [{ data: JSON.stringify({ imageSourceType: "BASE64", source: png }), id: "image" }],
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

    await expect(runtime.executeAndCommit({ code: "edit", target })).rejects.toMatchObject({ code });
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
    resolveCredential: overrides.resolveCredential ?? (async () => "cookie"),
    resolveLicense: overrides.resolveLicense ?? (async () => "license"),
    workerEntry: overrides.workerEntry ?? new URL("file:///package/worker.js"),
  });
}

function lease(options: {
  readonly baseRevision?: number;
  readonly commitResults?: readonly unknown[];
  readonly executeError?: Error;
  readonly executeValue?: unknown;
  readonly exportError?: Error;
  readonly malformedWriteResult?: boolean;
  readonly pullStatus?: "conflict" | "pulled";
  readonly replaceError?: Error;
  readonly state?: Partial<CollaborationRuntimeState>;
  readonly unitData?: unknown;
  readonly writeMutations?: readonly unknown[];
  readonly writeValue?: unknown;
} = {}): UniverCollaborationRuntimeLease {
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
      return { pendingMutationCount: options.writeMutations?.length ?? 0, previousMutationCount: 0, state };
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
      changeset: { baseRevision, mutationCount: 1, reqId: 2, revision: baseRevision + 1, sid: "sid-1" },
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
    return { baseRevision, confirmedChangesets: [], knownHeadRevision: baseRevision + 1, state, status };
  }
  return { state, status };
}
