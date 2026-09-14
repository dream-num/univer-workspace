import { beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeManager, runtimeFailureMessage } from "../src/runtime/manager.ts";

const mocked = vi.hoisted(() => {
  const lease = {
    getState: async () => ({ pendingMutationCount: 0, awaitingChangeset: null, conflict: null }),
    pull: async () => ({ status: 'applied', state: { baseRevision: 0 } }),
    exportUnitData: async () => ({ id: 'unit-1' }),
    release: async () => {}, invalidate: async () => {},
  };
  const pool = { acquire: vi.fn(async () => lease), close: vi.fn(async () => {}) };
  return { pool, create: vi.fn(() => pool) };
});
vi.mock('@univer-cli/univer-collaboration-runtime-pool', () => ({ createUniverCollaborationRuntimePool: mocked.create }));

describe('document runtime initialization', () => {
  const target = { origin: 'http://workspace.invalid', unitType: 'sheet' as const, unitId: 'unit-1',
    revision: 0, scope: { kind: 'trunk' as const }, sessionToken: 'test', license: 'test' };
  beforeEach(() => vi.clearAllMocks());

  it('does not initialize document engines for an unused account scope', async () => {
    const manager = new RuntimeManager(new URL('file:///worker.js'));
    await manager.close();
    expect(mocked.create).not.toHaveBeenCalled();
  });

  it('shares initialization across simultaneous first document operations', async () => {
    const manager = new RuntimeManager(new URL('file:///worker.js'));
    expect(await Promise.all([manager.exportUnitData(target), manager.exportUnitData(target)]))
      .toEqual([{ id: 'unit-1' }, { id: 'unit-1' }]);
    expect(mocked.create).toHaveBeenCalledTimes(1);
    expect(mocked.pool.acquire).toHaveBeenCalledTimes(2);
    await manager.close();
    expect(mocked.pool.close).toHaveBeenCalledTimes(1);
  });

  it('account shutdown joins pending initialization without acquiring a worker afterward', async () => {
    const manager = new RuntimeManager(new URL('file:///worker.js'));
    const operation = expect(manager.exportUnitData(target)).rejects.toThrow('closed');
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

    expect(runtimeFailureMessage("inspect", target, error, undefined, "diag-1"))
      .toContain("Invalid horizontal alignment: 2");
  });

  it("keeps direct worker errors without requiring an event code", () => {
    expect(runtimeFailureMessage("write", target, new Error("Worksheet name is required"), undefined, "diag-2"))
      .toContain("Worksheet name is required");
  });
});
