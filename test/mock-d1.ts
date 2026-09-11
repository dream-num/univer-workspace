/**
 * In-memory Mock D1Database for unit testing using node:sqlite DatabaseSync.
 */
import { DatabaseSync } from "node:sqlite";

export function createMockD1(): D1Database {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");

  function makePreparedStatement(query: string, boundValues: unknown[] = []): D1PreparedStatement {
    return {
      bind(...values: unknown[]) {
        return makePreparedStatement(query, values.map((v) => (v === undefined ? null : v)));
      },
      async first<T = unknown>(colName?: string): Promise<T | null> {
        try {
          const stmt = db.prepare(query);
          const row = stmt.get(...(boundValues as any[])) as Record<string, unknown> | undefined;
          if (!row) return null;
          if (colName) return (row[colName] as T) ?? null;
          return row as T;
        } catch (err) {
          console.error("MockD1 first error on query:", query, err);
          throw err;
        }
      },
      async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
        try {
          const stmt = db.prepare(query);
          stmt.run(...(boundValues as any[]));
          return { results: [], success: true };
        } catch (err) {
          console.error("MockD1 run error on query:", query, err);
          throw err;
        }
      },
      async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
        try {
          const stmt = db.prepare(query);
          const rows = stmt.all(...(boundValues as any[]));
          return { results: rows as T[], success: true };
        } catch (err) {
          console.error("MockD1 all error on query:", query, err);
          throw err;
        }
      },
      async raw<T = unknown[]>(): Promise<T[]> {
        const stmt = db.prepare(query);
        const rows = stmt.all(...(boundValues as any[]));
        return rows.map((r: any) => Object.values(r)) as T[];
      }
    };
  }

  return {
    prepare(query: string) {
      return makePreparedStatement(query);
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      const results: D1Result<T>[] = [];
      for (const s of statements) {
        results.push(await s.run());
      }
      return results;
    },
    async exec(query: string): Promise<D1ExecResult> {
      db.exec(query);
      return { count: 1, duration: 0 };
    },
    dump(): Promise<ArrayBuffer> {
      throw new Error("Not implemented in mock");
    }
  };
}
