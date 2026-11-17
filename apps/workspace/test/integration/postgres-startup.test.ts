import { describe, expect, it } from "vitest";
import { openProductDatabase } from "../../server/src/db/index.js";
import { loadConfig } from "../../server/src/config.js";
import { createPostgresTestSchema } from "../support/postgres/schema.js";

const url = process.env.WORKSPACE_TEST_POSTGRES_URL;

it("requires an explicit PostgreSQL provider and connection URL", () => {
  expect(loadConfig({ DATABASE_URL: "postgres://host/db" }).database.provider).toBe("sqlite");
  expect(() => loadConfig({ PRODUCT_DATABASE_PROVIDER: "postgres" })).toThrow(/Remove PRODUCT_DATABASE_PROVIDER/);
  expect(() => loadConfig({ DATABASE_PROVIDER: "other" })).toThrow(/PROVIDER/);
  expect(() => loadConfig({ DATABASE_PROVIDER: "postgres" })).toThrow(/DATABASE_URL/);
  expect(() => loadConfig({ DATABASE_PROVIDER: "postgres", DATABASE_URL: "file:///tmp/db" })).toThrow(/DATABASE_URL/);
  expect(() => loadConfig({ DATABASE_PROVIDER: "postgres", DATABASE_URL: "postgres://host/db" })).toThrow(/BLOB_STORE=s3/);
  expect(loadConfig({ DATABASE_PROVIDER: "postgres", DATABASE_URL: "postgres://host/db", BLOB_STORE: "s3", BLOB_S3_BUCKET: "test" }).database)
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
    await schema.pool.query("UPDATE workspace_product_schema SET version=3");
    await expect(openProductDatabase(config)).rejects.toThrow(/Unsupported/);
    await schema.pool.query("UPDATE workspace_product_schema SET version=2");
    await schema.pool.query("DROP INDEX users_username");
    await expect(openProductDatabase(config)).rejects.toThrow(/modified/);
    expect((await schema.pool.query("SELECT username FROM users")).rows).toEqual([{ username: "kept" }]);
  });

  it("upgrades version 1 by repairing display names and default Personal Space names once", async ({ onTestFinished }) => {
    const schema = await createPostgresTestSchema(url!);
    onTestFinished(schema.close);
    const config = { provider: "postgres" as const, connectionString: schema.connectionString };
    await (await openProductDatabase(config)).close();
    await schema.pool.query(`
      INSERT INTO users (id, username, display_name, created_at, updated_at) VALUES
        ('google', 'alice', 'alice@example.com', 1, 2), ('hostile', 'carol', E'Carol\\u202Eevil\\nname', 1, 2),
        ('filler', 'dave', E'\\u3164', 1, 2), ('custom', 'erin', 'Erin <erin@example.com>', 1, 2), ('plain', 'grace', 'Grace', 1, 2);
      INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES
        ('s-google', 'personal', 'alice@example.com 的个人空间', 'google', 3, 4), ('s-hostile', 'personal', E'Carol\\u202Eevil\\nname 的个人空间', 'hostile', 3, 4),
        ('s-filler', 'personal', E'\\u3164 的个人空间', 'filler', 3, 4), ('s-custom', 'personal', 'Erin''s drafts', 'custom', 3, 4),
        ('s-plain', 'personal', 'Grace 的个人空间', 'plain', 3, 4);
      UPDATE workspace_product_schema SET version = 1;
    `);
    const owners = [
      ["blank", "\u1160", "\u3164"],
      ...["\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466} Smith", "Sam ❤\uFE0F", "نامه\u200Cای", "क्\u200Dष", " Ann  Lee "]
        .map((name, index) => [`kept${index}`, `kept${index}`, name]),
    ];
    for (const [id, username, name] of owners) {
      await schema.pool.query("INSERT INTO users (id, username, display_name, created_at, updated_at) VALUES ($1, $2, $3, 1, 2)", [id, username, name]);
      await schema.pool.query("INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES ($1, 'personal', $2, $3, 3, 4)", [`s-${id}`, `${name} 的个人空间`, id]);
    }
    const kept = <T extends { id: string }>(rows: T[]) => rows.filter(({ id }) => id.includes("kept"));
    const repaired = <T extends { id: string }>(rows: T[]) => rows.filter(({ id }) => !id.includes("kept"));
    const snapshot = async () => ({
      users: (await schema.pool.query("SELECT id, display_name, updated_at FROM users ORDER BY id")).rows,
      spaces: (await schema.pool.query("SELECT id, name, updated_at FROM spaces ORDER BY id")).rows,
      schema: (await schema.pool.query("SELECT * FROM workspace_product_schema")).rows,
    });
    const before = await snapshot();
    await (await openProductDatabase(config)).close();
    const after = await snapshot();
    expect(repaired(after.users)).toEqual([
      { id: "blank", display_name: "Workspace User", updated_at: "2" },
      { id: "custom", display_name: "Erin <erin>", updated_at: "2" }, { id: "filler", display_name: "dave", updated_at: "2" },
      { id: "google", display_name: "alice", updated_at: "2" }, { id: "hostile", display_name: "Carolevil name", updated_at: "2" },
      { id: "plain", display_name: "Grace", updated_at: "2" },
    ]);
    expect(repaired(after.spaces)).toEqual([
      { id: "s-blank", name: "Workspace User 的个人空间", updated_at: "4" },
      { id: "s-custom", name: "Erin's drafts", updated_at: "4" }, { id: "s-filler", name: "dave 的个人空间", updated_at: "4" },
      { id: "s-google", name: "alice 的个人空间", updated_at: "4" }, { id: "s-hostile", name: "Carolevil name 的个人空间", updated_at: "4" },
      { id: "s-plain", name: "Grace 的个人空间", updated_at: "4" },
    ]);
    expect(kept(after.users)).toEqual(kept(before.users));
    expect(kept(after.spaces)).toEqual(kept(before.spaces));
    expect(kept(after.users)).toHaveLength(5);
    expect(after.schema).toEqual([{ ...before.schema[0], version: 2 }]);

    await (await openProductDatabase(config)).close();
    expect(await snapshot()).toEqual(after);
    await schema.pool.query("UPDATE workspace_product_schema SET version = 1");
    await (await openProductDatabase(config)).close();
    expect(await snapshot()).toEqual(after);
  });

  it("preserves an unrecognized occupied schema", async ({ onTestFinished }) => {
    const schema = await createPostgresTestSchema(url!);
    onTestFinished(schema.close);
    await schema.pool.query("CREATE TABLE existing(id integer); INSERT INTO existing VALUES (42)");
    await expect(openProductDatabase({ provider: "postgres", connectionString: schema.connectionString })).rejects.toThrow(/empty schema/);
    expect((await schema.pool.query("SELECT * FROM existing")).rows).toEqual([{ id: 42 }]);
  });
});
