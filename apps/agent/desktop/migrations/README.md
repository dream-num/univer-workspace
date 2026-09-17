# Desktop runtime-home migrations

This directory owns Desktop's runtime-home upgrades. It uses only Node APIs and
runs without Electron, DSH, authentication, or application services.
`src/runtime-home.cjs` is the startup adapter; migration decisions belong here.
These scripts ship inside the desktop application archive.

Quit Agent before running the same procedure manually with Node 24:

```bash
node apps/agent/desktop/migrations/run.cjs \
  --resources /path/to/installed/resources/runtime \
  --home /path/to/userData/runtime/home
```

The caller must own the home exclusively. Desktop uses its single-instance lock;
the standalone command must not run alongside Desktop or another migration.

The packaged application also exposes `--migrate-data-only`, with optional
`--migration-headless`, under its normal single-instance lock. The installer and
first-launch UI use this same runner; migration scripts do not import Electron.
See the [entry and failure contract](../README.md#data-upgrade-entry).
The runner's optional `report` callback supplies phase/step progress to its caller.

## Version contract

Desktop-owned runtime-home data has an independent integer `schemaVersion`.
The current version is **1**, declared in `schema.cjs`. The authoritative marker
is `<DSH_HOME>/.desktop-data-version.json`:

```json
{
  "formatVersion": 1,
  "schemaVersion": 1,
  "appliedMigrations": ["v0-to-v1"]
}
```

`formatVersion` describes this record's encoding; `schemaVersion` describes the
Desktop-owned home layout. Neither is the application's release version.
Application updates still compare complete SemVer versions, including `alpha`,
`beta`, and `rc` suffixes. A new release need not change the data version.

- No data-version marker means legacy **v0**, including homes with the older
  `.desktop-migrations.json` execution receipt. Missing means unversioned;
  malformed or unsupported records are errors, never a reason to reset data.
- `v0-to-v1.cjs` adopts the existing layout and ensures the authored-preset root
  exists. It does not rewrite profile configuration or DSH-owned formats.
- Each script declares `{ id, fromVersion, toVersion, run }`. The planner builds
  the complete chain from the stored version to the supported version. File
  names and array order do not determine applicability. Each transition advances
  exactly one version; gaps, duplicate versions, and duplicate IDs are errors.
- A newer stored data version stops startup before resource refresh, even when
  the resource hash is unchanged. Automatic data downgrade is unsupported.
  This protection applies to versions of Agent that implement this mechanism;
  older binaries without the check cannot enforce it.

## Data migration and resource refresh

`run.cjs` checks the data version independently of the installed location and
runtime inventory identity (`.desktop-complete`). An unchanged identity and a
current schema are a no-op. Data-version validation always precedes this fast path.

For a schema-only upgrade, it copies the existing home into staging, preserving
custom profile files, dependencies, and relative links, then runs only outstanding
migrations. Large customized homes may take time and additional disk space to copy.

A changed runtime identity instead uses the independent `runtime/` helpers to
stage the shipped profile and carry authored presets forward. It retains the data
version/history and does not replay already applied data migrations. Any pending
data migrations then run on that candidate. These resource helpers are not
versioned data transformations. The loose-runtime package-link branch applies
only when `host.asar` is absent and can be removed when loose desktop runtimes
are no longer supported.

## Activation and failure semantics

Migration scripts receive `{ resources, home, staging }`. Read the previous home
and installed resources; write only to staging. The data-version marker is written
to the candidate only after all required transitions succeed. It becomes
current together with the data when the candidate is activated. The separate
`.desktop-migrations.json` receipt records resource operations, not schema authority.

The runner records `home.upgrade.json`, retains the old home as
`home.previous-<timestamp>-<uuid>`, and renames the candidate to the stable path.
A step failure leaves the live data and version untouched; retries rebuild staging.
A failed activation restores the previous home. After a process interruption
between the two renames, the next invocation restores the recorded backup before
retrying. If activation already completed, it keeps the active data and version
and removes the journal. Backups are never cleaned up during startup. This covers
process interruption, not power-loss durability.

## Adding a data version

1. Add `vN-to-vN+1.cjs` with a stable unique ID and explicit version bounds.
2. Register it in `schema.cjs` and advance `CURRENT_SCHEMA_VERSION`.
3. Keep the migration's historical conditions in that script. Retain older
   transitions while their source data versions remain supported; users may skip
   releases. Ensure resource refresh preserves every data path owned by the schema.
4. Test old fixtures, skipped versions, retry after failure, repeat startup, and
   rejection of newer data before changing the supported version.

Keep version branches out of startup, login, and plugin-loading code. Run the
regression suite with `pnpm --dir apps/agent/desktop test`.

## Current scope

This schema covers the Desktop-owned runtime home, not DSH's internal session or
credential formats, Workspace server databases, or the separate local workspace.
Those remain owned by their existing components.

When **resources change**, customized profile configuration and dependencies are
still retained in the previous-home backup, not automatically merged or
reinstalled. Automatic custom-plugin upgrade needs a separate migration with
version-conflict handling and validation. A schema-only upgrade preserves the
existing profile; that does not establish plugin compatibility with new resources.
