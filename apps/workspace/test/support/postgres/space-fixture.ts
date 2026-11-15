import { randomUUID } from "node:crypto";
import { Client, Pool } from "pg";
import { PostgresSpacesRepository } from "../../../server/src/db/postgres/spaces/spaces.repository.js";
import { PostgresSpacePinsRepository } from "../../../server/src/db/postgres/spaces/space-pins.repository.js";

// Only the relations exercised by the Spaces and Pins repository contract.
const tables = `
  CREATE TABLE users (
    id text PRIMARY KEY, username text NOT NULL, display_name text NOT NULL, kind text NOT NULL,
    created_at bigint NOT NULL, updated_at bigint NOT NULL
  );
  CREATE UNIQUE INDEX users_username ON users (lower(username COLLATE "C"));
  CREATE TABLE agents (
    user_id text PRIMARY KEY REFERENCES users, origin_label text NOT NULL, created_at bigint NOT NULL,
    last_active_at bigint NOT NULL, expires_at bigint, banned_at bigint
  );
  CREATE TABLE spaces (
    id text PRIMARY KEY, type text NOT NULL, name text NOT NULL, owner_user_id text NOT NULL REFERENCES users,
    created_at bigint NOT NULL, updated_at bigint NOT NULL, public_read boolean NOT NULL DEFAULT false,
    description text NOT NULL DEFAULT '', slug text
  );
  CREATE UNIQUE INDEX spaces_owner_slug ON spaces (owner_user_id, lower(slug COLLATE "C")) WHERE slug IS NOT NULL;
  CREATE UNIQUE INDEX spaces_personal_owner ON spaces (owner_user_id) WHERE type = 'personal';
  CREATE TABLE space_members (
    space_id text NOT NULL REFERENCES spaces, user_id text NOT NULL REFERENCES users, role text NOT NULL,
    granted_by text NOT NULL REFERENCES users, created_at bigint NOT NULL, updated_at bigint NOT NULL,
    PRIMARY KEY (space_id, user_id)
  );
  CREATE TABLE space_stars (
    space_id text NOT NULL REFERENCES spaces, user_id text NOT NULL REFERENCES users, created_at bigint NOT NULL,
    PRIMARY KEY (space_id, user_id)
  );
  CREATE TABLE space_pins (
    user_id text NOT NULL REFERENCES users, space_id text NOT NULL REFERENCES spaces, position integer NOT NULL,
    created_at bigint NOT NULL, PRIMARY KEY (user_id, space_id), UNIQUE (user_id, position)
  );
`;

export async function openPostgresSpaceFixture(connectionString: string) {
  const schema = `uvw_spaces_${randomUUID().replaceAll("-", "")}`;
  const scoped = new URL(connectionString);
  // The startup option applies to every connection opened by the pool.
  scoped.searchParams.set("options", `-c search_path=${schema}`);
  const admin = new Client({ connectionString });
  const pool = new Pool({ connectionString: scoped.href });
  let created = false;
  async function close() {
    try {
      await pool.end();
    } finally {
      try {
        if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      } finally {
        await admin.end();
      }
    }
  }

  try {
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    const { rows } = await pool.query<{ name: string }>("SELECT current_schema() AS name");
    if (rows[0]?.name !== schema) throw new Error("PostgreSQL fixture search_path was not applied");
    await pool.query(tables);
    return {
      spaces: new PostgresSpacesRepository(pool),
      pins: new PostgresSpacePinsRepository(pool),
      async exec(sql: string) { await pool.query(sql); },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
