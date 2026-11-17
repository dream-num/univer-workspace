# Workspace storage migration and recovery

English | [简体中文](storage-migration.zh-CN.md)

## Migrate SQLite and local files to PostgreSQL and S3

Use one outage to migrate **SQLite + local directory → PostgreSQL + S3**. The command accepts V19, V20 and V21 product databases. Prepare a dedicated empty PostgreSQL database, a private bucket and an empty prefix. See [Workspace configuration](configuration.md#deployment-configurations) for target settings, credentials and bucket permissions.

1. Stop all Workspace writers. Keep a backup of both SQLite databases (including any WAL or journal files) and the file directory from the same recovery point. Keep user traffic closed until validation passes.
2. Supply the target PostgreSQL + S3 settings to the migration process. Point `DATABASE_FILE`, `COLLABORATION_DATABASE_FILE` and `BLOB_DIRECTORY` at the existing source data, or use the [default source paths](configuration.md#databases). A read-only source mount is sufficient. Allow temporary disk space for both databases, upgrade copies and their backups.
3. For a source checkout with dependencies installed, run the following from the repository root. The script reads the Workspace `.env` file.

   ```bash
   cd apps/workspace
   node --env-file-if-exists=.env --import tsx server/src/storage-migration/main.ts
   ```

   With the Workspace image, run a one-off container from the same image. Here `workspace.env` supplies the target database and S3 settings, and the source volume is mounted at the default paths. Use the same network and credentials as the target deployment.

   ```bash
   docker run --rm --network workspace --env-file ./workspace.env \
     -v univer-workspace-data:/app/univer-workspace/.data:ro \
     univer-workspace node dist/server/storage-migration/main.js
   ```

4. Wait for a successful exit and the committed row counts. Start one instance with the target configuration. Through HTTP, sign in with an existing account, check a document, Worktree, history, comments and attachment, edit a document and upload a file. Restart, read back the edit and upload, then reopen traffic.

The command upgrades SQLite copies in a private temporary directory and reads the originals only. It copies local files under their original object keys, reads them back from S3 to verify SHA-256, then imports product data and all four collaboration components in one PostgreSQL transaction. For Units created inside a Worktree, it translates SQLite’s placeholder baseline `1` to PostgreSQL’s `NULL`. Trunk-derived Units retain their actual baseline. Draft revisions, seed snapshots and merge artifacts are preserved.

**Interruption and rollback.** Keep source writers stopped after a failure. Empty target tables and some S3 objects may remain. The database import transaction rolls back as a unit. Fix the cause and rerun with the same source and destination. The command verifies and reuses identical objects and rejects mismatched or unrelated objects and populated target tables. It also rejects legacy collaboration resource data the target SDK cannot represent. If the connection drops during commit, inspect the target before reopening traffic or retrying. Before reopening traffic, you can stop the target and restart the source with its original configuration. After traffic resumes, rollback also requires transferring subsequent writes.

## SQLite upgrades and recovery

Deployments that stay on SQLite upgrade at server startup. The current product schema is V21. Startup supports upgrades from V0 through V20.

1. Stop all Workspace writers. Back up the product database, collaboration database and local files at the same recovery point, including any SQLite WAL or journal files. Avoid opening the databases from the host while the container runs. On Kubernetes, use one replica and the `Recreate` strategy for the rollout.
2. Start one new instance. Allow space for pre-upgrade backups, a staging copy of the collaboration database and a temporary component backup. Startup upgrades the product database, then checks collaboration component versions. When a collaboration upgrade is needed, the server takes an exclusive lock and creates `<collaboration-file>.pre-sdk-migration-<timestamp>-<uuid>.bak` beside the database. The staging copy replaces the original only after schema, foreign-key and integrity checks pass.
3. Check startup, then verify document and Worktree access over HTTP before reopening traffic. Keep backups until validation passes. To roll back, stop the new instance, restore both databases and local files from the same backup, and start the old version.

See the [data model](data-model.md#一次性自动迁移边界) for per-version schema changes and historical data mappings.
