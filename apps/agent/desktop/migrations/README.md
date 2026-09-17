# Desktop runtime-home migrations

This directory owns Desktop's runtime-home upgrade procedure. It uses only Node
APIs and can run without Electron, DSH, authentication, or application services.
`src/runtime-home.cjs` is the startup adapter; migration decisions belong here.
The directory is included in the desktop application archive.

Quit Agent before running the same procedure manually with Node 24:

```bash
node apps/agent/desktop/migrations/run.cjs \
  --resources /path/to/installed/resources/runtime \
  --home /path/to/userData/runtime/home
```

The caller must own the home exclusively. Desktop uses its single-instance lock;
the standalone command must not run alongside Desktop or another migration.

## Procedure and failure semantics

- `run.cjs` compares the installed location and runtime inventory with the home's
  `.desktop-complete` marker. An unchanged installation is a no-op, including
  homes created before this runner existed; user edits remain untouched.
- On first installation or a changed runtime, the explicit ordered registry runs
  every applicable step against a fresh `home.staging`. These are per-upgrade
  transformations, not globally once-only database migrations.
- `001-stage-shipped-home.cjs` stages the shipped profile and package links.
  Its loose-runtime compatibility branch applies only when `host.asar` is absent;
  it can be removed when loose desktop runtimes are no longer supported.
- `002-preserve-authored-presets.cjs` carries `.agent-presets` into that candidate.
  Missing presets are normal on first installation; copy errors abort migration.
- Only after all steps succeed does the runner write `.desktop-migrations.json`
  (runtime identity and completed step IDs) and the completion marker. It records
  `home.upgrade.json`, retains the old home as `home.previous-<timestamp>-<uuid>`,
  and renames the candidate to the stable home path.
- A step failure leaves the live home untouched. A failed activation restores it.
  If the process exits between the two renames, the next invocation restores the
  backup named by the journal before retrying. If activation already completed,
  it keeps the active home and removes the journal. Backups are never cleaned up
  during startup. This covers process interruption, not power-loss durability.

Each step exports `{ id, run({ resources, home, staging }) }`. Read the previous
home and installed resources; write only to staging. Keep historical conditions
and exit criteria inside the relevant step. Add independent steps and fixtures
for new migrations rather than adding version branches to startup, login, or
plugin-loading code. Steps must tolerate first installation and skipped releases;
retries rebuild staging from the unchanged previous home.

## Current scope

Account data and local workspaces live outside this home and are not migrated by
these scripts. Customized profile configuration and dependencies are still
retained in the previous-home backup, not automatically merged or reinstalled.
Automatic custom-plugin upgrade needs a separate step with dependency/version
conflict handling and validation. Do not copy an old `node_modules` over a new
packaged profile and treat that as an upgrade.

Run the regression suite with `pnpm --dir apps/agent/desktop test`.
