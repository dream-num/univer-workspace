import { AsyncLocalStorage } from "node:async_hooks";
import { types, type Pool, type PoolClient } from "pg";
import { withPostgresTransaction } from "./transaction.js";

export type QueryValue = string | number | boolean | null;
type Bindings = QueryValue | Readonly<Record<string, QueryValue>>;
type Row = Record<string, QueryValue>;

// Product counters, sizes and epoch milliseconds use safe JS integers in the domain contracts.
const productTypes: typeof types.getTypeParser = (oid, format) => {
  if (oid === types.builtins.INT8 && format !== "binary") return (value: string) => {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw new RangeError("Product integer exceeds the safe integer range");
    return number;
  };
  return types.getTypeParser(oid, format);
};

export class PostgresDatabase {
  private readonly transactionClient = new AsyncLocalStorage<PoolClient>();
  constructor(readonly pool: Pool) {}

  prepare(sql: string): PostgresStatement {
    return new PostgresStatement(this, sql);
  }

  query(text: string, values: readonly QueryValue[]) {
    const client = this.transactionClient.getStore() ?? this.pool;
    return client.query<Row>({ text, values: [...values], types: { getTypeParser: productTypes } });
  }

  transaction<T>(operation: (db: PostgresDatabase) => Promise<T>): Promise<T> {
    if (this.transactionClient.getStore()) throw new Error("Nested product database transactions are not supported");
    return withPostgresTransaction(this.pool, (client) => this.transactionClient.run(client, () => operation(this)));
  }
}

export class PostgresStatement {
  private readonly text: string;
  private readonly names: string[] = [];
  constructor(private readonly database: PostgresDatabase, sql: string) {
    let next = 0;
    // Only repository SQL supplies the statement. Values are always sent separately to pg.
    this.text = sql.replace(/'(?:''|[^'])*'|\?(\d*)|\$([A-Za-z_]\w*)/g, (token, position, name) => {
      if (token.startsWith("'")) return token;
      if (name) {
        if (!this.names.includes(name)) this.names.push(name);
        return "$" + (this.names.indexOf(name) + 1);
      }
      return "$" + (position || ++next);
    });
  }

  private query(params: Bindings[]) {
    const named = params[0];
    if (named !== null && typeof named === "object") {
      return this.database.query(this.text, this.names.map((key) => {
        if (!Object.hasOwn(named, key)) throw new Error("Missing SQL parameter " + key);
        return named[key]!;
      }));
    }
    return this.database.query(this.text, params as QueryValue[]);
  }

  async get(...params: Bindings[]) { return (await this.query(params)).rows[0]; }
  async all(...params: Bindings[]) { return (await this.query(params)).rows; }
  async run(...params: Bindings[]) { return { changes: (await this.query(params)).rowCount ?? 0 }; }
}
