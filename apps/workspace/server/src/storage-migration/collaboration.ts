import type { ISnapshot } from "@univerjs/protocol";
import { decode, encode } from "@msgpack/msgpack";
import type { PoolClient } from "pg";
import type { Source } from "./source.js";
import { identifier, importTable, type Row } from "./rows.js";

const coreTables = ["units", "snapshots", "changesets", "sheet_blocks"];
const dataTables = [
  ...coreTables,
  "worktrees",
  "worktree_units",
  "worktree_changesets",
  "history_records",
  "comments",
];
const packed = (value: object) => Buffer.from(encode(value, { ignoreUndefined: true }));
const context = { userID: "", customData: {}, request: {} };

function* snapshots(source: Source): Generator<Row> {
  const db = source.collaboration;
  const block = db.prepare("SELECT 1 FROM collaboration_sheet_blocks WHERE unit_id = ? AND block_id = ?");
  for (const row of db.prepare("SELECT * FROM collaboration_snapshots").iterate()) {
    if (!(row.payload instanceof Uint8Array)) throw new Error("Expected a MessagePack snapshot");
    const snapshot = decode(row.payload) as ISnapshot;
    const ids = Object.values(snapshot.workbook?.blockMeta ?? {}).flatMap(sheet => sheet.blocks);
    for (const id of ids) {
      if (!block.get(String(row.unit_id), id)) throw new Error(`Missing Sheet block ${id} for Unit ${row.unit_id}`);
    }
    yield { ...row, block_ids: ids };
  }
}

async function* worktreeUnits(source: Source): AsyncGenerator<Row> {
  for (const row of source.collaboration
    .prepare("SELECT * FROM collaboration_worktree_units")
    .iterate()) {
    const { metadata_json, merge_result_json, ...unit } = row;
    const worktree = String(unit.worktree_id);
    const id = String(unit.unit_id);
    const seed = await source.worktree.getUnitSeed(context, worktree, id);
    const artifact = await source.worktree.getUnitMergeArtifact(context, worktree, id);
    if (unit.source === "worktree") {
      if (!seed || unit.baseline_trunk_revision !== 1)
        throw new Error("Unexpected SQLite Worktree-created Unit baseline or seed");
      unit.baseline_trunk_revision = null;
    }
    yield {
      ...unit,
      metadata: metadata_json,
      merge_result: merge_result_json,
      seed: seed && packed(seed),
      merge_artifact: artifact && packed(artifact),
    };
  }
}

async function* draftChangesets(source: Source): AsyncGenerator<Row> {
  for (const row of source.collaboration
    .prepare("SELECT * FROM collaboration_worktree_changesets")
    .iterate()) {
    const { metadata_json, payload_json: _payload, ...fields } = row;
    const revision = Number(fields.revision);
    const changes = await source.worktree.getDraftChangesets(
      context,
      String(fields.worktree_id),
      String(fields.unit_id),
      { from: revision - 1, to: revision },
    );
    if (changes?.length !== 1) throw new Error("Missing SQLite Worktree changeset");
    const { metadata: _metadata, ...payload } = changes[0]!;
    yield { ...fields, payload: packed(payload), metadata: metadata_json };
  }
}

function* comments(source: Source): Generator<Row> {
  for (const row of source.collaboration
    .prepare("SELECT * FROM collaboration_comments")
    .iterate()) {
    const { mentions_json, ...fields } = row;
    yield { ...fields, mentions: JSON.parse(String(mentions_json)) };
  }
}

export async function importCollaboration(source: Source, client: PoolClient): Promise<number> {
  const db = source.collaboration;
  // Old SDKs could persist separate resource payloads. The current target has no equivalent.
  const known = new Set(
    [...dataTables, "schema_versions", "worktree_unit_seeds", "worktree_unit_merge_artifacts"].map(
      (table) => "collaboration_" + table,
    ),
  );
  for (const row of db
    .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*'")
    .all()) {
    const name = String(row.name);
    if (!known.has(name) && db.prepare("SELECT 1 FROM " + identifier(name) + " LIMIT 1").get()) {
      throw new Error(`Cannot represent nonempty SQLite table ${name} in PostgreSQL`);
    }
  }
  for (const name of [
    "collaboration_worktree_unit_seeds",
    "collaboration_worktree_unit_merge_artifacts",
  ]) {
    if (
      db
        .prepare(
          `SELECT 1 FROM ${name} WHERE resources_json IS NOT NULL AND json(resources_json) <> '[]' LIMIT 1`,
        )
        .get()
    ) {
      throw new Error(`Cannot represent legacy resource payloads in ${name}`);
    }
  }
  let total = 0;
  for (const table of dataTables) {
    let rows: Iterable<Row> | AsyncIterable<Row>;
    if (table === "snapshots") rows = snapshots(source);
    else if (table === "sheet_blocks") {
      rows = db.prepare("SELECT unit_id, block_id, NULL AS unreferenced_at_ms FROM collaboration_sheet_blocks").iterate();
    } else if (table === "worktree_units") rows = worktreeUnits(source);
    else if (table === "worktree_changesets") rows = draftChangesets(source);
    else if (table === "comments") rows = comments(source);
    else rows = db.prepare("SELECT * FROM " + identifier("collaboration_" + table)).iterate();
    total += await importTable(client, "collaboration", table, rows);
  }
  return total;
}
