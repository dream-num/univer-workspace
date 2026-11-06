import type { DatabaseSync } from "node:sqlite";
import { expect } from "vitest";
import type { WriteSource } from "../../server/src/modules/identity/index.js";

export function expectSessionSource(database: DatabaseSync, token: string, source: WriteSource | null): void {
  const value = token.replace(/^workspace_session=/, "");
  const id = value.split(".", 1)[0];
  expect(database.prepare("SELECT write_source FROM login_sessions WHERE id = ?").get(id))
    .toEqual({ write_source: source });
}
