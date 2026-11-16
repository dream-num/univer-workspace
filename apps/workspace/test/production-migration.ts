import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createProductionTestApplication } from "./support/sqlite/production-application.js";
import {
  createLegacyV0Schema,
  seedRichLegacyV0,
} from "./fixtures/legacy-v0.js";

const directory = mkdtempSync(join(tmpdir(), "workspace-production-migration-"));
const databaseFilename = join(directory, "workspace.sqlite");
try {
  const legacy = new DatabaseSync(databaseFilename);
  createLegacyV0Schema(legacy);
  legacy.exec("PRAGMA journal_mode = WAL");
  seedRichLegacyV0(legacy);
  legacy.close();

  const application = await createProductionTestApplication(
    {
      host: "127.0.0.1",
      port: 0,
      database: { provider: "sqlite", filename: databaseFilename, collaborationFilename: join(directory, "collaboration.sqlite") },
      secureCookies: false,
      sessionTtlMs: 60_000,
    },
    {
      unitStore: {
        createUnit: async (input) => ({
          unitId: input.unitId,
          headRevision: 1,
        }),
      },
    }
  );
  try {
    const version = application.connection
      .prepare("PRAGMA user_version")
      .get() as { readonly user_version: number };
    assert.equal(version.user_version, 21);
    const resource = (await application.nodes.get("alice", "doc-node")).node.resource;
    assert.equal(resource?.kind, "univer");
    assert.equal(resource?.kind === "univer" ? resource.unitType : null, "doc");
    assert.equal(
      readdirSync(directory).filter((name) =>
        name.includes(".v0-backup-")
      ).length,
      1
    );
  } finally {
    await application.close();
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}

console.log("Production build migrated and opened a rich V0 WAL database.");
