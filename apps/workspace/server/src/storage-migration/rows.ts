import { reportProgress } from "./progress.js";
import { isDeepStrictEqual } from "node:util";
import type { PoolClient } from "pg";

export type Row = Record<string, unknown>;

export function identifier(value: string): string {
  return '"' + value.replaceAll('"', '""') + '"';
}

interface Column {
  name: string;
  type: string;
  identity: boolean;
}

function wireValue(value: unknown, type: string): unknown {
  if (value instanceof Uint8Array)
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value === null) return null;
  if (type === "boolean") {
    if (value !== 0 && value !== 1) throw new Error("Invalid SQLite boolean");
    return value === 1;
  }
  if (type === "bigint") return String(value);
  return value;
}

// Keep one source row in memory, verify PostgreSQL's stored representation, and preserve DB constraints.
export async function importTable(
  client: PoolClient,
  schema: string,
  table: string,
  rows: Iterable<Row> | AsyncIterable<Row>,
): Promise<number> {
  const target = identifier(schema) + "." + identifier(table);
  const { rows: columns } = await client.query<Column>(
    `SELECT column_name AS name, data_type AS type,
    is_identity = 'YES' AS identity FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
    [schema, table],
  );
  if (!columns.length) throw new Error(`Missing target table ${target}`);
  const names = columns.map((column) => identifier(column.name)).join(",");
  const identity = columns.some((column) => column.identity) ? " OVERRIDING SYSTEM VALUE" : "";
  const placeholders = columns.map((_, index) => "$" + (index + 1)).join(",");
  const sql = `INSERT INTO ${target} (${names})${identity} VALUES (${placeholders}) RETURNING ${names}`;
  const progress = reportProgress(`Staged rows in ${target}`);
  console.log(`Importing ${target}`);
  let count = 0;
  for await (const row of rows) {
    if (
      Object.keys(row).length !== columns.length ||
      columns.some((column) => !Object.hasOwn(row, column.name))
    ) {
      throw new Error(`Source columns differ from target ${target}`);
    }
    const values = columns.map((column) => wireValue(row[column.name], column.type));
    const result = await client.query<Row>(sql, values);
    for (const [index, column] of columns.entries()) {
      const value = values[index];
      const expected =
        column.type === "jsonb" && typeof value === "string" ? JSON.parse(value) : value;
      if (!isDeepStrictEqual(result.rows[0]?.[column.name], expected)) {
        throw new Error(`Readback differs for ${target}.${column.name} at row ${count + 1}`);
      }
    }
    progress(++count);
  }
  const stored = await client.query(`SELECT count(*) FROM ${target}`);
  if (Number(stored.rows[0].count) !== count) throw new Error(`Row count differs for ${target}`);
  progress(count, undefined, true);
  return count;
}
