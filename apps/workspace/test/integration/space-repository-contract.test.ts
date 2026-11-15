import { beforeEach, describe, expect, it } from "vitest";
import type { SpacesRepository, SpacePinsRepository } from "../../server/src/modules/spaces/index.js";
import { SqliteDatabase } from "../../server/src/db/sqlite/connection.js";
import { SqliteSpacesRepository } from "../../server/src/db/sqlite/spaces/spaces.repository.js";
import { createPostgresTestSchema } from "../support/postgres/schema.js";
import { openProductDatabase } from "../../server/src/db/index.js";

import { SqliteSpacePinsRepository } from "../../server/src/db/sqlite/spaces/space-pins.repository.js";

async function openPostgresSpaceFixture(url: string): Promise<Fixture> {
  const schema = await createPostgresTestSchema(url);
  try {
    const product = await openProductDatabase({ provider: "postgres", connectionString: schema.connectionString });
    return {
      spaces: product.repositories.spaces,
      pins: product.repositories.spacePins,
      async exec(sql) { await schema.pool.query(sql); },
      async close() {
        try { await product.close(); } finally { await schema.close(); }
      },
    };
  } catch (error) {
    await schema.close();
    throw error;
  }
}

interface Fixture {
  spaces: SpacesRepository;
  pins: SpacePinsRepository;
  exec(sql: string): void | Promise<void>;
  close(): void | Promise<void>;
}

function openSqlite(): Fixture {
  const db = new SqliteDatabase(":memory:");
  return {
    spaces: new SqliteSpacesRepository(db),
    pins: new SqliteSpacePinsRepository(db),
    exec: (sql) => db.connection.exec(sql),
    close: () => db.close(),
  };
}

const postgresUrl = process.env.WORKSPACE_TEST_POSTGRES_URL;
const ids = (rows: readonly { id: string }[]) => rows.map((row) => row.id);

const backends = [
  { name: "SQLite", open: openSqlite },
  { name: "PostgreSQL", open: postgresUrl ? () => openPostgresSpaceFixture(postgresUrl) : undefined },
];

for (const { name, open } of backends) {
  describe.skipIf(!open)(`${name} Spaces and Pins contract`, () => {
    let db: Fixture;
    beforeEach(async ({ onTestFinished }) => {
      db = await open!();
      onTestFinished(db.close);
      await db.exec(`
        INSERT INTO users (id, username, display_name, kind, created_at, updated_at) VALUES
          ('alice', 'AlIce', 'Alice', 'human', 1, 1), ('bob', 'Bob', 'Bob', 'human', 1, 1),
          ('bot', 'Böt', 'Bot', 'agent', 1, 1);
        INSERT INTO agents (user_id, origin_label, created_at, last_active_at, expires_at) VALUES ('bot', 'test', 1, 1, 8000000000000);
        INSERT INTO spaces (id, type, name, owner_user_id, slug, public_read, created_at, updated_at) VALUES
          ('home', 'personal', 'Home', 'alice', NULL, false, 1, 1),
          ('own-b', 'team', 'Alpha', 'alice', 'Second', false, 1, 1),
          ('own-a', 'team', 'aLPHA', 'alice', 'First', false, 1, 1),
          ('joined', 'team', 'A member', 'bob', 'joined', false, 1, 1),
          ('hidden', 'team', 'Hidden', 'bob', 'hidden', false, 1, 1),
          ('pub-b', 'team', 'Beta', 'bob', 'beta', true, 1, 1),
          ('pub-a', 'team', 'alpha', 'bob', 'alpha', true, 1, 1),
          ('bot-home', 'personal', 'Agent', 'bot', NULL, false, 1, 1);
        INSERT INTO space_members (space_id, user_id, role, granted_by, created_at, updated_at)
          VALUES ('joined', 'alice', 'admin', 'bob', 1, 1);
      `);
    });

    it("lists mine, explored and starred spaces in their respective orders", async () => {
      const { spaces } = db;
      expect(ids(await spaces.listViews("alice", "mine"))).toEqual(["home", "own-a", "own-b", "joined"]);
      expect(ids(await spaces.listViews("alice", "explore"))).toEqual(["pub-a", "pub-b"]);
      expect(await spaces.findViewByFullName("alice", "ALICE", "pErSoNaL")).toMatchObject({
        id: "home", slug: null, ownerUsername: "AlIce", publicRead: false, memberRole: null,
      });
      expect(await spaces.findViewByFullName("alice", "alice", "FIRST")).toMatchObject({ id: "own-a", slug: "First" });
      expect(await spaces.getView("alice", "joined")).toMatchObject({ memberRole: "admin", publicRead: false });
      expect(await spaces.findViewByFullName("alice", "Bob", "hidden")).toBeNull();

      // These times exceed 32-bit integer range. Repeating a star preserves its original position.
      const at = 1_700_000_000_000;
      expect(await spaces.setStar("alice", "pub-a", true, at)).toEqual({ starred: true, starCount: 1 });
      await spaces.setStar("alice", "pub-b", true, at + 1);
      expect(await spaces.setStar("alice", "pub-a", true, at + 2)).toEqual({ starred: true, starCount: 1 });
      expect(await spaces.setStar("bob", "pub-b", true, at)).toEqual({ starred: true, starCount: 2 });
      expect(ids(await spaces.listViews("alice", "starred"))).toEqual(["pub-b", "pub-a"]);
      expect(ids(await spaces.listViews("alice", "explore"))).toEqual(["pub-b", "pub-a"]);
      expect(await spaces.setStar("alice", "pub-b", false, at)).toEqual({ starred: false, starCount: 1 });
      expect(await spaces.setStar("alice", "hidden", true, at)).toBeNull();
    });

    it("allocates generated slugs at insert and reports explicit per-owner conflicts", async () => {
      const create = { name: "Group", ownerUserId: "alice", createdAt: 1, publicRead: false };
      const generated = await Promise.all(["new-1", "new-2", "new-3"].map((id) =>
        db.spaces.createTeamSpace({ ...create, id, slugBase: "group" })));
      expect(generated.map((space) => space?.slug).sort()).toEqual(["group", "group-2", "group-3"]);
      const explicit = await Promise.all(["BUILD", "build"].map((slug) =>
        db.spaces.createTeamSpace({ ...create, id: slug, slug })));
      expect(explicit.filter(Boolean)).toHaveLength(1);
      expect(explicit).toContain(null);
      expect(await db.spaces.createTeamSpace({ ...create, id: "other-build", slug: "BUILD", ownerUserId: "bob" }))
        .toMatchObject({ id: "other-build" });
    });

    it("patches only supplied settings, preserves conflicting writes and rechecks membership", async () => {
      const { spaces } = db;
      await Promise.all([
        spaces.updateSettings("alice", "joined", { name: "Renamed" }, 2),
        spaces.updateSettings("alice", "joined", { description: "About" }, 2),
      ]);
      expect(await spaces.getView("alice", "joined")).toMatchObject({ name: "Renamed", description: "About", publicRead: false });
      const racing = await Promise.all(["own-a", "own-b"].map((id) =>
        spaces.updateSettings("alice", id, { name: "Winner", slug: "claim" }, 3)));
      expect(racing.filter(Boolean)).toHaveLength(1);
      const loser = racing[0] ? "own-b" : "own-a";
      expect(await spaces.getView("alice", loser)).toMatchObject(
        loser === "own-a" ? { name: "aLPHA", slug: "First" } : { name: "Alpha", slug: "Second" },
      );
      await db.exec("UPDATE space_members SET role = 'viewer' WHERE space_id = 'joined' AND user_id = 'alice'");
      await expect(spaces.updateSettings("alice", "joined", { publicRead: true }, 4)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await db.exec("DELETE FROM space_members WHERE space_id = 'joined' AND user_id = 'alice'");
      await expect(spaces.updateSettings("alice", "joined", { name: "Hidden" }, 5)).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("filters suspended agent spaces and restores existing stars and pins on reactivation", async () => {
      const { spaces, pins } = db;
      await spaces.updateSettings("bot", "bot-home", { publicRead: true }, 1);
      expect(await spaces.findViewByFullName("alice", "böt", "personal")).toMatchObject({ id: "bot-home" });
      expect(await spaces.findViewByFullName("alice", "BÖT", "personal")).toBeNull();
      await spaces.setStar("alice", "bot-home", true, 1);
      const saved = await pins.replacePins("alice", ["bot-home"], 1);
      for (const settings of ["banned_at = 1", "banned_at = NULL, expires_at = 1"]) {
        await db.exec(`UPDATE agents SET ${settings} WHERE user_id = 'bot'`);
        expect(await spaces.getView("alice", "bot-home")).toBeNull();
        expect(await spaces.getStar("alice", "bot-home")).toBeNull();
        expect(await spaces.setStar("alice", "bot-home", false, 2)).toBeNull();
        expect(ids(await spaces.listViews("alice", "explore"))).not.toContain("bot-home");
        expect(await pins.getPins("alice", 1)).toMatchObject({ customized: false, spaces: [{ id: "home" }] });
        expect(await spaces.getView("bot", "bot-home")).toMatchObject({ id: "bot-home" });
      }
      await db.exec("UPDATE agents SET expires_at = 8000000000000 WHERE user_id = 'bot'");
      expect(await spaces.getStar("alice", "bot-home")).toEqual({ starred: true, starCount: 1 });
      expect(await pins.getPins("alice", 1)).toEqual(saved);
    });

    it("keeps custom pin order beyond the default limit and rejects a mixed replacement atomically", async () => {
      const { spaces, pins } = db;
      const defaults = await pins.getPins("alice", 2);
      expect(defaults).toMatchObject({ customized: false, spaces: [{ id: "home" }, { id: "own-a" }] });
      await spaces.setStar("alice", "pub-b", true, 1);
      const order = ["pub-b", "joined", "own-b"];
      const saved = await pins.replacePins("alice", order, 1);
      expect(saved?.customized).toBe(true);
      expect(ids(saved?.spaces ?? [])).toEqual(order);
      for (const ineligible of ["missing", "hidden", "pub-a", "own-a"]) {
        expect(await pins.replacePins("alice", ["own-a", ineligible], 2)).toBeNull();
        expect(await pins.getPins("alice", 2)).toEqual(saved);
      }
      expect((await pins.getPins("bob", 2)).customized).toBe(false);
      expect(await pins.resetPins("alice", 2)).toEqual(defaults);
    });

    it("restores the previous pins if inserting the replacement fails", async () => {
      const { pins } = db;
      const saved = await pins.replacePins("alice", ["home"], 1);
      await db.exec(`
        CREATE UNIQUE INDEX contract_pin_fault ON space_pins(user_id) WHERE space_id IN ('own-a', 'own-b')
      `);
      await expect(pins.replacePins("alice", ["own-a", "own-b"], 2)).rejects.toThrow();
      expect(await pins.getPins("alice", 2)).toEqual(saved);
    });

    it("returns each concurrent replacement or reset as a complete ordered set", async () => {
      const { pins } = db;
      const defaults = await pins.getPins("alice", 2);
      const orders = [["own-b", "home"], ["joined", "own-b", "own-a"]] as const;
      const [first, second, reset] = await Promise.all([
        pins.replacePins("alice", orders[0], 1),
        pins.replacePins("alice", orders[1], 2),
        pins.resetPins("alice", 2),
      ]);
      expect([first, second].map((result) => ids(result?.spaces ?? []))).toEqual(orders);
      expect(reset).toEqual(defaults);
      expect([first, second, reset]).toContainEqual(await pins.getPins("alice", 2));
    });
  });
}
