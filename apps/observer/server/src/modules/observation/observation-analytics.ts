import { statSync } from "node:fs";
import type { ObserverConfig } from "../../config.js";
import { ApplicationError } from "../../errors.js";
import type { ProductDatabaseReader } from "../../product-database-reader.js";
import {
  ChangesetQueryTimeoutError,
  queryChangesets,
} from "./changeset-reader.js";
import type {
  ActivityRank,
  ChangesetQuery,
  ChangesetQueryResult,
} from "./changeset-query-types.js";

export class ObservationAnalytics {
  private _activeChangesetQueries = 0;

  constructor(
    private readonly _database: ProductDatabaseReader,
    private readonly _config: ObserverConfig,
    private readonly _startedAt: number,
    private readonly _queryChangesets: typeof queryChangesets = queryChangesets
  ) {}

  overview(): object {
    const count = (table: string) =>
      (this._database.connection.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { readonly count: number }).count;
    return {
      observerVersion: process.env.OBSERVER_VERSION ?? process.env.npm_package_version ?? "development",
      workspaceVersion: this._config.workspaceVersion ?? null,
      startedAt: this._startedAt,
      uptimeMs: Date.now() - this._startedAt,
      databaseBytes: {
        product: fileSize(this._config.productDatabaseFilename),
        collaboration: fileSize(this._config.collaborationDatabaseFilename),
        observer: fileSize(this._config.observerDatabaseFilename),
      },
      counts: {
        users: count("users"),
        spaces: count("spaces"),
        resources: count("resources"),
        worktrees: count("worktrees"),
        nodes: count("nodes"),
      },
      generatedAt: Date.now(),
    };
  }

  operations(): object {
    const now = Date.now();
    const summary = this._database.connection.prepare(
      `SELECT
         SUM(CASE WHEN state = 'pending' AND lease_expires_at > ? THEN 1 ELSE 0 END) AS executing,
         SUM(CASE WHEN state = 'pending' AND next_attempt_at > ? AND (lease_expires_at IS NULL OR lease_expires_at <= ?) THEN 1 ELSE 0 END) AS waiting,
         SUM(CASE WHEN state = 'pending' AND next_attempt_at <= ? AND (lease_expires_at IS NULL OR lease_expires_at <= ?) THEN 1 ELSE 0 END) AS due_backlog,
         SUM(CASE WHEN state = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM operations`
    ).get(now, now, now, now, now) as Record<string, number | null>;
    const errors = this._database.connection.prepare(
      `SELECT kind, COALESCE(last_error_code, 'UNKNOWN') AS error_code, COUNT(*) AS count
       FROM operations WHERE state = 'failed'
       GROUP BY kind, COALESCE(last_error_code, 'UNKNOWN')
       ORDER BY count DESC, kind, error_code`
    ).all() as unknown as readonly { readonly kind: string; readonly error_code: string; readonly count: number }[];
    return {
      executing: summary.executing ?? 0,
      waiting: summary.waiting ?? 0,
      dueBacklog: summary.due_backlog ?? 0,
      failed: summary.failed ?? 0,
      errors: errors.map((row) => ({ kind: row.kind, errorCode: row.error_code, count: row.count })),
      generatedAt: now,
    };
  }

  storage(): object {
    const row = this._database.connection.prepare(
      `SELECT
        (SELECT COUNT(*) FROM blob_resources) AS blob_count,
        (SELECT COALESCE(SUM(byte_size), 0) FROM blob_resources) AS blob_bytes,
        (SELECT COUNT(*) FROM blob_resources WHERE availability = 'quarantined') AS quarantined,
        (SELECT COUNT(*) FROM blob_upload_sessions WHERE state NOT IN ('completed', 'failed', 'expired', 'aborted')) AS active_uploads,
        (SELECT COUNT(*) FROM object_deletion_jobs) AS pending_deletions,
        (SELECT COUNT(*) FROM univer_assets) AS asset_count,
        (SELECT COALESCE(SUM(byte_size), 0) FROM univer_assets) AS asset_bytes`
    ).get() as Record<string, number>;
    return {
      blobCount: row.blob_count,
      blobBytes: row.blob_bytes,
      quarantinedCount: row.quarantined,
      activeUploadCount: row.active_uploads,
      pendingDeletionCount: row.pending_deletions,
      univerAssetCount: row.asset_count,
      univerAssetBytes: row.asset_bytes,
      generatedAt: Date.now(),
    };
  }

  configSummary(): object {
    return {
      host: this._config.host,
      port: this._config.port,
      secureCookies: this._config.secureCookies,
      sessionTtlMs: this._config.sessionTtlMs,
      queryTimeoutMs: this._config.queryTimeoutMs,
      maxConcurrentQueries: this._config.maxConcurrentQueries,
      githubOAuthConfigured: Boolean(this._config.githubOAuth),
      setupTokenConfigured: Boolean(this._config.setupToken),
      paths: {
        productDatabase: redactPath(this._config.productDatabaseFilename),
        collaborationDatabase: redactPath(this._config.collaborationDatabaseFilename),
        observerDatabase: redactPath(this._config.observerDatabaseFilename),
        blobDirectory: redactPath(this._config.blobDirectory),
      },
      generatedAt: Date.now(),
    };
  }

  filterOptions(search: string): object {
    const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
    const users = this._database.connection.prepare(
      `SELECT id, username, display_name, avatar_url
       FROM users
       WHERE ? = '' OR id LIKE ? ESCAPE '\\' OR username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\'
       ORDER BY display_name, id LIMIT 100`
    ).all(search, pattern, pattern, pattern) as unknown as readonly {
      readonly id: string;
      readonly username: string;
      readonly display_name: string;
      readonly avatar_url: string | null;
    }[];
    const units = this._database.connection.prepare(
      `SELECT unit_id, name, space_name, unit_type FROM (
         SELECT ur.unit_id, n.name, s.name AS space_name, ur.unit_type
         FROM univer_resources ur
         JOIN resources r ON r.id = ur.resource_id
         JOIN nodes n ON n.id = r.node_id
         JOIN spaces s ON s.id = n.space_id
         UNION ALL
         SELECT wi.unit_id, wi.name, s.name AS space_name, wi.unit_type
         FROM worktree_node_intents wi
         JOIN spaces s ON s.id = wi.target_space_id
       )
       WHERE ? = '' OR unit_id LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR space_name LIKE ? ESCAPE '\\'
       GROUP BY unit_id
       ORDER BY name, unit_id LIMIT 100`
    ).all(search, pattern, pattern, pattern) as unknown as readonly {
      readonly unit_id: string;
      readonly name: string;
      readonly space_name: string;
      readonly unit_type: string;
    }[];
    return {
      users: users.map((row) => ({
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
      })),
      units: units.map((row) => ({
        id: row.unit_id,
        name: row.name,
        spaceName: row.space_name,
        unitType: row.unit_type,
      })),
    };
  }

  async changesets(query: ChangesetQuery): Promise<object> {
    if (this._activeChangesetQueries >= this._config.maxConcurrentQueries) {
      throw new ApplicationError(
        "QUERY_BUSY",
        503,
        "Observer changeset query capacity is currently exhausted."
      );
    }
    this._activeChangesetQueries += 1;
    const totalStart = performance.now();
    try {
      const collaborationStart = performance.now();
      const activity = await this._queryChangesets(
        this._config.collaborationDatabaseFilename,
        query,
        this._config.queryTimeoutMs
      );
      const collaborationQueryMs = performance.now() - collaborationStart;
      const enrichmentStart = performance.now();
      const enriched = this.enrich(activity);
      const productEnrichmentMs = performance.now() - enrichmentStart;
      const totalServerMs = performance.now() - totalStart;
      return {
        query,
        ...activity,
        users: enriched.users,
        units: enriched.units,
        meta: {
          collaborationQueryMs: roundMs(collaborationQueryMs),
          productEnrichmentMs: roundMs(productEnrichmentMs),
          totalServerMs: roundMs(totalServerMs),
          generatedAt: new Date().toISOString(),
          latestChangesetTime: activity.latestChangesetTime === null
            ? null
            : new Date(activity.latestChangesetTime).toISOString(),
        },
      };
    } catch (error) {
      if (error instanceof ChangesetQueryTimeoutError) {
        throw new ApplicationError(
          "QUERY_TIMEOUT",
          504,
          `Changeset query exceeded the ${error.timeoutMs} ms limit.`
        );
      }
      throw error;
    } finally {
      this._activeChangesetQueries -= 1;
    }
  }

  private enrich(activity: ChangesetQueryResult): {
    readonly users: readonly object[];
    readonly units: readonly object[];
  } {
    const userLabels = new Map<string, { username: string; displayName: string; avatarUrl: string | null }>();
    const userIds = activity.users.map((row) => row.id);
    if (userIds.length > 0) {
      const placeholders = userIds.map(() => "?").join(",");
      const rows = this._database.connection.prepare(
        `SELECT id, username, display_name, avatar_url FROM users WHERE id IN (${placeholders})`
      ).all(...userIds) as unknown as readonly { readonly id: string; readonly username: string; readonly display_name: string; readonly avatar_url: string | null }[];
      for (const row of rows) userLabels.set(row.id, { username: row.username, displayName: row.display_name, avatarUrl: row.avatar_url });
    }

    const unitLabels = new Map<string, { name: string; spaceName: string | null; unitType: string | null }>();
    const unitIds = activity.units.map((row) => row.id);
    if (unitIds.length > 0) {
      const placeholders = unitIds.map(() => "?").join(",");
      const trunk = this._database.connection.prepare(
        `SELECT ur.unit_id, ur.unit_type, n.name, s.name AS space_name
         FROM univer_resources ur
         JOIN resources r ON r.id = ur.resource_id
         JOIN nodes n ON n.id = r.node_id
         JOIN spaces s ON s.id = n.space_id
         WHERE ur.unit_id IN (${placeholders})`
      ).all(...unitIds) as unknown as readonly { readonly unit_id: string; readonly unit_type: string; readonly name: string; readonly space_name: string }[];
      for (const row of trunk) unitLabels.set(row.unit_id, { name: row.name, spaceName: row.space_name, unitType: row.unit_type });
      const local = this._database.connection.prepare(
        `SELECT wi.unit_id, wi.unit_type, wi.name, s.name AS space_name
         FROM worktree_node_intents wi
         JOIN spaces s ON s.id = wi.target_space_id
         WHERE wi.unit_id IN (${placeholders})`
      ).all(...unitIds) as unknown as readonly { readonly unit_id: string; readonly unit_type: string; readonly name: string; readonly space_name: string }[];
      for (const row of local) if (!unitLabels.has(row.unit_id)) unitLabels.set(row.unit_id, { name: row.name, spaceName: row.space_name, unitType: row.unit_type });
    }

    return {
      users: activity.users.map((row) => ({ ...row, ...(userLabels.get(row.id) ?? { username: null, displayName: null, avatarUrl: null }) })),
      units: activity.units.map((row) => ({ ...row, ...(unitLabels.get(row.id) ?? { name: null, spaceName: null, unitType: null }) })),
    };
  }
}

function fileSize(filename: string): number | null {
  try { return statSync(filename).size; } catch { return null; }
}

function redactPath(filename: string): string {
  const segments = filename.split(/[\\/]/);
  return segments.at(-1) ?? filename;
}

function roundMs(value: number): number {
  return Math.round(value * 100) / 100;
}
