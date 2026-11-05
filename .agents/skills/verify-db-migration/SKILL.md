---
name: verify-db-migration
description: Prove a Univer Workspace database change cannot break a deployed database. Replays every committed and released product schema.sql through current startup and requires a structure identical to a fresh install, then runs the per-version data, backup, rollback and restart matrix against source and the production build. Use whenever a change touches apps/workspace/server/src/db (schema.sql, migrations, database.ts, initialize.ts), the Collaboration migrations, or the Univer SDK baseline, and before calling such a change done.
---

# verify-db-migration

`apps/workspace/AGENTS.md` owns the migration rules. This skill proves a change meets them.
Work from a full clone (not shallow, tags fetched) after `pnpm install --frozen-lockfile`, and
rebase onto `origin/main` first: a branch behind a newer schema version fails step 2.

## 1. Scope

```bash
git diff --stat origin/main -- apps/workspace/server/src/db \
  apps/workspace/server/src/integrations/univer/migrations pnpm-lock.yaml
```

- Anything under `server/src/db` changed: run steps 2 to 5.
- A changed published structure or constraint in `schema.sql` needs a `PRAGMA user_version`
  bump and a `migrations/v<N-1>-to-v<N>/migrate.ts`. Step 3 applies to a new migration and to
  any changed behavior of an existing one or of `prepare-current-database.ts`,
  `database.ts` or `initialize.ts`.
- Only the SDK baseline or `integrations/univer/migrations` changed: run steps 4 and 5. Step 4
  includes the Collaboration matrix (`test/production-collaboration-migration.ts`).

## 2. Schema parity

```bash
(cd apps/workspace && node --import tsx ../../.agents/skills/verify-db-migration/bin/schema-parity.ts)
```

For every distinct `schema.sql` on the first-parent history of `origin/main` and in every
`v*` tag, the script builds a database, runs `prepareCurrentDatabase`, and compares the result
with a fresh install of the working-tree `schema.sql` before startup re-runs `schema.sql`, and
requires exactly one backup for an older version and none for the current one. Then it opens
the database twice with `openWorkspaceDatabase`, compares again after each start, and fails if
startup throws, changes the structure, or creates a backup. Every line must be `ok`.

It compares `user_version`, column order, each column definition and table constraint as
written (type, collation, default, CHECK, generated expression, foreign key), table options
(`STRICT`, `WITHOUT ROWID`), index keys with collation and order, and the DDL of indexes,
triggers and views. Case, whitespace and comments outside quotes are ignored. Quoted text is
not.

Options. `--base <ref>` replaces `origin/main`. Pass `--ref <commit>` once per commit deployed
from outside `main` (a `sha-<commit>` image), so its schema is replayed too. A `--ref` that is
not a local commit with `schema.sql` is an error; fetch it first.

Read a `FAIL` as:

- `startup threw Unsupported product database version`: the new version has no branch in
  `prepare-current-database.ts`, or `database.ts` still expects the old number.
- `startup threw … fingerprint mismatch`: `assertV<N>Fingerprint` disagrees with what the
  migration produces.
- The committed schema with the working tree's version fails: `schema.sql` changed without a
  version bump. This includes adding only an index or table.
- `column order` differs: the migration appends with `ADD COLUMN`, so declare the new column
  last in `schema.sql`, or rebuild the table in the migration.
- `definitions` differ: copy the column or constraint text from `schema.sql` into the
  migration exactly. A CHECK, collation or foreign key cannot be altered in SQLite, so rebuild
  the table, as `v12-to-v13` does. An equivalent constraint spelled differently also fails.

Parity checks structure on empty databases. It cannot see lost or wrongly rewritten rows, so
step 3 stays mandatory.

## 3. Per-version matrix

Copy the newest `apps/workspace/test/support/v*-migration-checks.ts` into
`v<N-1>-migration-checks.ts`, keep it a function of `open`, and cover:

- empty and seeded V<N-1> databases. Seed every table the migration rewrites, plus unfinished
  recovery state (`operations`, upload sessions, deletion jobs) when it touches them;
- rows after migration: unchanged columns deep-equal; added or remapped columns hold exactly
  the value the documented old-to-new mapping or default gives (`test/support/space-description.ts`
  shows the pattern);
- the new constraint or column behaves as intended on the migrated database;
- `foreign_key_check` is empty and `integrity_check` is `ok`;
- exactly one `.v<N-1>-backup-*.sqlite`, at V<N-1>, holding the original rows;
- restarting does not migrate again or create a second backup;
- a forced failure after the DDL rolls back, and both the database and the backup still read
  as V<N-1> with no leftover rebuild tables.

The V<N-1> fixture must be the previous schema, not the new one. Build it from
`git show origin/main:apps/workspace/server/src/db/schema.sql`, or from the current schema plus a
`v<N>-downgrade.ts` that reproduces that file's structure, as the existing checks do.

Wire it twice: a Vitest case under `test/integration/` with the source `openWorkspaceDatabase`,
and `test/production-v<N-1>-migration.ts` with `../dist/server/db/initialize.js`, appended to
`test:production-import` in `apps/workspace/package.json`. Also update `TARGET_VERSION`, every
`createBackup`/fingerprint version union, the "expected 0 … N" message, and the version
`database.ts` expects. Each V1+ chain in `prepareCurrentDatabase` must end with
`migrateV<N-1>ToV<N>` followed by `assertV<N>Fingerprint`. V0 is different: `legacy-v0/migrate.ts`
applies the current `schema.sql` directly, so update the `user_version` it expects instead of
appending a migration to it.

## 4. Production build

```bash
pnpm --filter @univerjs/univer-workspace build:server
(cd apps/workspace && node --import tsx ../../.agents/skills/verify-db-migration/bin/schema-parity.ts --dist)
pnpm --filter @univerjs/univer-workspace test:production-import
```

`--dist` loads `dist/server/db`, including its copied `schema.sql`. Rebuild first: a stale
`dist` fails parity, before or after startup.

## 5. Repository gates and docs

`pnpm typecheck`, `pnpm test` and `pnpm build` must pass. Then update the documents
`apps/workspace/AGENTS.md` lists for version changes so they name the same version as the code.

## Report

List the parity output for source and `--dist`, the matrix cases you added, the
`test:production-import` result, and any FAIL you accepted with its reason. Name as untested
the rolling upgrade order and concurrent old and new writers; review the release notes'
stop-old, start-one, resume order instead. V0 to V5 and V10 never had a committed
`schema.sql`, so parity skips them. They rely on `test/integration/database-migration.test.ts`,
`test/production-v1-migration.ts` to `v5`, and `test/support/v10-migration-checks.ts`.
