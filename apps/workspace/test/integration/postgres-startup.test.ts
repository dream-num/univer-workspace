import { describe, expect, it } from "vitest";
import { openProductDatabase } from "../../server/src/db/index.js";
import { loadConfig } from "../../server/src/config.js";
import { createPostgresTestSchema } from "../support/postgres/schema.js";

const url = process.env.WORKSPACE_TEST_POSTGRES_URL;

it("requires an explicit PostgreSQL provider and connection URL", () => {
  expect(loadConfig({ DATABASE_URL: "postgres://host/db" }).productDatabase.provider).toBe("sqlite");
  expect(() => loadConfig({ PRODUCT_DATABASE_PROVIDER: "other" })).toThrow(/PROVIDER/);
  expect(() => loadConfig({ PRODUCT_DATABASE_PROVIDER: "postgres" })).toThrow(/DATABASE_URL/);
  expect(() => loadConfig({ PRODUCT_DATABASE_PROVIDER: "postgres", DATABASE_URL: "file:///tmp/db" })).toThrow(/DATABASE_URL/);
  expect(loadConfig({ PRODUCT_DATABASE_PROVIDER: "postgres", DATABASE_URL: "postgres://host/db" }).productDatabase)
    .toEqual({ provider: "postgres", connectionString: "postgres://host/db" });
});

describe.skipIf(!url)("PostgreSQL startup", () => {
  it("serializes first starts, preserves rows on restart and rejects version or schema drift", async ({ onTestFinished }) => {
    const schema = await createPostgresTestSchema(url!);
    onTestFinished(schema.close);
    const config = { provider: "postgres" as const, connectionString: schema.connectionString };
    const databases = await Promise.all([openProductDatabase(config), openProductDatabase(config)]);
    await Promise.all(databases.map(db => db.close()));
    await schema.pool.query("INSERT INTO users (id,username,display_name,created_at,updated_at) VALUES ('id','kept','Kept',1,1)");
    const reopened = await openProductDatabase(config);
    try { expect(await reopened.repositories.identity.usernameExists("KEPT")).toBe(true); }
    finally { await reopened.close(); }
    await schema.pool.query("UPDATE workspace_product_schema SET version=2");
    await expect(openProductDatabase(config)).rejects.toThrow(/Unsupported/);
    await schema.pool.query("UPDATE workspace_product_schema SET version=1");
    await schema.pool.query("DROP INDEX users_username");
    await expect(openProductDatabase(config)).rejects.toThrow(/modified/);
    expect((await schema.pool.query("SELECT username FROM users")).rows).toEqual([{ username: "kept" }]);
  });

  it("preserves an unrecognized occupied schema", async ({ onTestFinished }) => {
    const schema = await createPostgresTestSchema(url!);
    onTestFinished(schema.close);
    await schema.pool.query("CREATE TABLE existing(id integer); INSERT INTO existing VALUES (42)");
    await expect(openProductDatabase({ provider: "postgres", connectionString: schema.connectionString })).rejects.toThrow(/empty schema/);
    expect((await schema.pool.query("SELECT * FROM existing")).rows).toEqual([{ id: 42 }]);
  });
});
