import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./trajectory-dump.js", import.meta.url), "utf8");
const evaluate = new Function("load", "location", "fetch", "indexedDB", "navigator", `return ${source.replaceAll("import(", "load(")}`);

test("trajectory dump uses the authenticated user and route, and reports expanded calls and skipped rows", async () => {
  const calls = [{ record: { seq: 2, outcome: { kind: "ok" }, attempts: [{ status: 200 }] }, body: '{"messages":[]}', base: 1, rewrite: false }];
  const factory = {};
  const locks = {};
  const load = async (path) => path.endsWith("store.ts") ? {
    createTrajectoryStore(options) {
      assert.deepEqual(options, { userId: "user-a", indexedDB: factory, locks });
      return { async list(id) { assert.equal(id, "session-a"); return { records: calls, skippedRecords: 3 }; } };
    },
  } : { expandRequests: (records) => records };
  const fetch = async (url) => { assert.equal(url, "/api/session"); return Response.json({ authenticated: true, user: { id: "user-a" } }); };
  assert.deepEqual(await evaluate(load, { pathname: "/agents/session-a" }, fetch, factory, { locks }), {
    skippedRecords: 3,
    records: [{ seq: 2, outcome: { kind: "ok" }, attempts: [{ status: 200 }], base: 1, rewrite: false, body: '{"messages":[]}' }],
  });
});

test("trajectory dump rejects a wrong page or an unauthenticated session", async () => {
  const load = async () => ({});
  await assert.rejects(evaluate(load, { pathname: "/agents" }), /Open an \/agents\/<id>/);
  await assert.rejects(evaluate(load, { pathname: "/agents/session-a" }, async () => Response.json({ authenticated: false })), /Sign in/);
});
