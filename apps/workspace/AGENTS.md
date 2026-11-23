# Univer Workspace application

`apps/workspace` runs as deployed instances with persistent data. Treat every schema, migration,
startup, and deployment change as an upgrade of live databases, not of a disposable demo. Normal
start, restart, upgrade, and production recovery keep the database. Disposable instances use a
separate temporary data directory or volume.

## Product database

The product database has a SQLite backend and a PostgreSQL backend with separate schema versions.
Read `docs/data-model.md` before a schema change. It is the authority on both.

- SQLite. `server/src/db/sqlite/schema.sql` defines the current schema and `PRAGMA user_version`
  its version. `server/src/db/sqlite/migrations/prepare-current-database.ts` owns the upgrade path.
  A change to the structure or constraints of a released schema bumps `user_version` and adds a
  versioned migration. Never change only `schema.sql`, and never assume a deployed database is
  empty.
- PostgreSQL. `server/src/db/postgres/schema.sql` defines the current schema, and the
  `workspace_product_schema` table stores its version and structure fingerprint. A structural
  change appends an upgrade to `UPGRADES` in `server/src/db/postgres/initialize.ts`, and the
  upgrade must leave the structure that `schema.sql` creates.
- Migrations run before any business Repository initializes. SQLite migrations take a consistent
  backup first, roll back on failure, and check the schema fingerprint, `foreign_key_check`, and
  `integrity_check`.
- Keep existing business data, object storage identity, and recovery state. When a migration drops
  or rewrites a field, map the old data to the new meaning explicitly. Never discard data that
  startup recovery may still read.
- Never let incompatible old and new processes write the same SQLite file. Release notes state the
  order. Stop the old instance, start one new instance to migrate, confirm success, then resume
  service.

## Verification

- For SQLite, run the `verify-db-migration` skill. It replays released schemas through current
  startup, then runs the data, backup, rollback, and restart matrix against the source and the
  production build.
- For PostgreSQL, run `pnpm --filter @univerjs/univer-workspace test:postgres` with
  `WORKSPACE_TEST_POSTGRES_URL` set to a disposable database. CI runs it in the `postgres` job.
- When the database version, a migration path, or deployment behavior changes, update `README.md`,
  `docs/data-model.md`, `docs/application-design.md`, and the related proposal in the same change.
  The code, tests, current schema, and docs must name the same version.
