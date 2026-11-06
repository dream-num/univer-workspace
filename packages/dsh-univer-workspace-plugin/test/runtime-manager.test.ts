import { beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeManager, runtimeFailureMessage } from "../src/runtime/manager.ts";

const mocked = vi.hoisted(() => {
  const lease = {
    getState: async () => ({ pendingMutationCount: 0, awaitingChangeset: null, conflict: null }),
    pull: vi.fn(async () => ({ status: "applied", state: { baseRevision: 0 } })),
    execute: vi.fn(),
    commit: vi.fn(),
    exportUnitData: async () => ({ id: "unit-1" }),
    release: vi.fn(async () => {}),
    invalidate: vi.fn(async () => {}),
  };
  const pool = { acquire: vi.fn(async () => lease), close: vi.fn(async () => {}) };
  return { lease, pool, create: vi.fn(() => pool) };
});
vi.mock("@univer-cli/univer-collaboration-runtime-pool", () => ({
  createUniverCollaborationRuntimePool: mocked.create,
}));

describe("document runtime initialization", () => {
  const target = {
    origin: "http://workspace.invalid",
    unitType: "sheet" as const,
    unitId: "unit-1",
    revision: 0,
    scope: { kind: "trunk" as const },
    sessionToken: "test",
    license: "test",
  };
  beforeEach(() => vi.clearAllMocks());

  it("does not initialize document engines for an unused account scope", async () => {
    const manager = new RuntimeManager(new URL("file:///worker.js"));
    await manager.close();
    expect(mocked.create).not.toHaveBeenCalled();
  });

  it("shares initialization across simultaneous first document operations", async () => {
    const manager = new RuntimeManager(new URL("file:///worker.js"));
    expect(
      await Promise.all([manager.exportUnitData(target), manager.exportUnitData(target)]),
    ).toEqual([{ id: "unit-1" }, { id: "unit-1" }]);
    expect(mocked.create).toHaveBeenCalledTimes(1);
    expect(mocked.pool.acquire).toHaveBeenCalledTimes(2);
    await manager.close();
    expect(mocked.pool.close).toHaveBeenCalledTimes(1);
  });

  it("returns the native read revision instead of the saved model revision", async () => {
    const manager = new RuntimeManager(new URL("file:///worker.js"));
    mocked.lease.pull.mockResolvedValueOnce({ status: "applied", state: { baseRevision: 7 } });
    mocked.lease.execute.mockResolvedValueOnce({
      value: { rev: 1, body: "Native user edit" },
      state: { baseRevision: 7 },
    });
    await expect(
      manager.readWithRevision({ ...target, revision: 7 }, "return doc.save();"),
    ).resolves.toEqual({ value: { rev: 1, body: "Native user edit" }, revision: 7 });
    expect(mocked.lease.execute).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: "read" }),
    );
    await manager.close();
  });

  it("commits writes without custom options and retains the confirmed revision", async () => {
    const manager = new RuntimeManager(new URL("file:///worker.js"));
    mocked.lease.execute.mockResolvedValueOnce({
      value: { sourceMap: [{ id: "intro" }] },
      mutations: [{ id: "doc.mutation.replace", data: "{}" }],
    });
    mocked.lease.commit
      .mockResolvedValueOnce({ status: "retry" })
      .mockResolvedValueOnce({ status: "confirmed", state: { baseRevision: 8 } });
    await expect(
      manager.writeAndCommit(
        { ...target, scope: { kind: "worktree", worktreeId: "wt-1" } },
        "return document.getId();",
      ),
    ).resolves.toEqual({
      committed: true,
      value: { sourceMap: [{ id: "intro" }] },
      revision: 8,
    });
    expect(mocked.lease.execute).toHaveBeenCalledOnce();
    expect(mocked.lease.commit.mock.calls).toEqual([[], []]);
    expect(mocked.lease.release).toHaveBeenCalledOnce();
    expect(mocked.lease.invalidate).not.toHaveBeenCalled();
    await manager.close();
  });

  it("invalidates a failed write without committing or reusing its pending state", async () => {
    const manager = new RuntimeManager(new URL("file:///worker.js"));
    mocked.lease.execute.mockRejectedValueOnce(new Error("Invalid native block boundary"));
    await expect(
      manager.writeAndCommit(
        { ...target, scope: { kind: "worktree", worktreeId: "wt-1" } },
        "return document.getId();",
      ),
    ).rejects.toThrow("Invalid native block boundary");
    expect(mocked.lease.commit).not.toHaveBeenCalled();
    expect(mocked.lease.release).not.toHaveBeenCalled();
    expect(mocked.lease.invalidate).toHaveBeenCalledOnce();
    await manager.close();
  });

  it("keeps the existing Facade aliases on ordinary reads", async () => {
    const manager = new RuntimeManager(new URL("file:///worker.js"));
    mocked.lease.execute.mockResolvedValueOnce({
      value: "Workbook name",
      state: { baseRevision: 0 },
    });
    await expect(manager.read(target, "return workbook.getName();")).resolves.toBe("Workbook name");
    expect(mocked.lease.execute).toHaveBeenLastCalledWith({
      code: expect.stringContaining('const workbook = api.getWorkbook("unit-1")'),
      mode: "read",
    });
    await manager.close();
  });

  it("account shutdown joins pending initialization without acquiring a worker afterward", async () => {
    const manager = new RuntimeManager(new URL("file:///worker.js"));
    const operation = expect(manager.exportUnitData(target)).rejects.toThrow("closed");
    await manager.close();
    await operation;
    expect(mocked.pool.acquire).not.toHaveBeenCalled();
    expect(mocked.pool.close).toHaveBeenCalledTimes(1);
  });
});

describe("runtime failure diagnostics", () => {
  const target = { unitType: "sheet" as const, unitId: "unit-1" };

  it("keeps the worker operation error when the pool crash races its event", () => {
    const error = new Error("Worker exited unexpectedly", {
      cause: new Error("Invalid horizontal alignment: 2"),
    });

    expect(runtimeFailureMessage("inspect", target, error, undefined, "diag-1")).toContain(
      "Invalid horizontal alignment: 2",
    );
  });

  it("keeps direct worker errors without requiring an event code", () => {
    expect(
      runtimeFailureMessage(
        "write",
        target,
        new Error("Worksheet name is required"),
        undefined,
        "diag-2",
      ),
    ).toContain("Worksheet name is required");
  });
});
