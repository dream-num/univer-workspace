import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withPostgresTransaction } from "./transaction.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("withPostgresTransaction", () => {
  it("replays a transaction whose commit loses a serialization conflict and returns the replay's result", async () => {
    const database = fakeDatabase([failure("40001")]);
    let attempts = 0;

    const outcome = await settle(database.pool, async () => ++attempts);

    expect(outcome).toEqual({ value: 2 });
    expect(database.connections).toEqual([
      { statements: ["BEGIN ISOLATION LEVEL SERIALIZABLE", "COMMIT", "ROLLBACK"], released: true },
      { statements: ["BEGIN ISOLATION LEVEL SERIALIZABLE", "COMMIT"], released: true },
    ]);
  });

  it("replays a transaction chosen as a deadlock victim", async () => {
    const database = fakeDatabase();
    let attempts = 0;

    const outcome = await settle(database.pool, async () => {
      attempts += 1;
      if (attempts === 1) throw failure("40P01");
      return "committed";
    });

    expect(outcome).toEqual({ value: "committed" });
    expect(attempts).toBe(2);
  });

  it("gives up after a bounded number of attempts and rethrows the last failure", async () => {
    const database = fakeDatabase();
    const thrown: Error[] = [];

    const outcome = await settle(database.pool, async () => {
      const error = failure("40001", `attempt ${thrown.length + 1}`);
      thrown.push(error);
      throw error;
    });

    expect(thrown.length).toBeGreaterThan(1);
    expect(thrown.length).toBeLessThanOrEqual(10);
    expect((outcome as { error: unknown }).error).toBe(thrown.at(-1));
    expect(database.connections).toHaveLength(thrown.length);
    expect(database.connections.every((connection) => connection.released)).toBe(true);
  });

  it.each([
    ["a duplicate username", failure("23505", "users_username")],
    ["a missing referenced row", failure("23503", "spaces_owner_user_id_fkey")],
    ["an error without a SQLSTATE", new Error("Workspace rule refused the write")],
  ])("does not replay %s", async (_, error) => {
    const database = fakeDatabase();
    let attempts = 0;

    const outcome = await settle(database.pool, async () => {
      attempts += 1;
      throw error;
    });

    expect((outcome as { error: unknown }).error).toBe(error);
    expect(attempts).toBe(1);
  });

  it("replays a lost number allocation that PostgreSQL reports as a unique violation", async () => {
    const database = fakeDatabase();
    let attempts = 0;

    const outcome = await settle(database.pool, async () => {
      attempts += 1;
      if (attempts === 1) throw failure("23505", "issues_space_id_number_key");
      return attempts;
    });

    expect(outcome).toEqual({ value: 2 });
  });
});

function failure(code: string, detail = code): Error {
  return Object.assign(new Error(`PostgreSQL ${detail}`), { code, constraint: code === "23505" || code === "23503" ? detail : undefined });
}

function fakeDatabase(commitFailures: Error[] = []) {
  const connections: { statements: string[]; released: boolean }[] = [];
  const pool = {
    async connect() {
      const connection = { statements: [] as string[], released: false };
      connections.push(connection);
      return {
        async query(sql: string) {
          connection.statements.push(sql);
          if (sql === "COMMIT" && commitFailures.length) throw commitFailures.shift();
          return { rows: [], rowCount: 0 };
        },
        release() {
          connection.released = true;
        },
      };
    },
  };
  return { pool: pool as unknown as Pool, connections };
}

async function settle<T>(pool: Pool, operation: () => Promise<T>): Promise<{ value: T } | { error: unknown }> {
  const outcome = withPostgresTransaction(pool, operation).then((value) => ({ value }), (error: unknown) => ({ error }));
  await vi.runAllTimersAsync();
  return await outcome;
}
