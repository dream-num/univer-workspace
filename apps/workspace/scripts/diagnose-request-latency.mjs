// Run from apps/workspace: LOG_LEVEL=silent node --import tsx scripts/diagnose-request-latency.mjs
// Uses only newly created temporary databases and the installed published SDK.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { deserializeToCombResponse, serializeCombRequest } from "@univerjs-pro/collaboration-client";
import { CombCmd, CmdRspCode, ErrorCode, UniverType } from "@univerjs/protocol";
import { createWorkspaceApplication } from "../server/src/app.ts";
import { AccessRepository } from "../server/src/modules/access/access.repository.ts";

const directory = mkdtempSync(join(tmpdir(), "workspace-latency-"));
const results = [];
const slowSdkCalls = [];
const restoreSdk = [];
// Observe public methods of the same CommonJS SDK instances used by unit-store.
const require = createRequire(import.meta.url);
for (const [pkg, className, methods] of [
  ["collaboration-service", "UniverCollabService", ["submitChangeset"]],
  ["collaboration-service", "UniverUnitRuntime", ["ensureUnit", "applyChangeset", "createSnapshot"]],
  ["collaboration-database-sqlite", "SQLiteDatabaseAdapter", ["commitChangeset", "saveSnapshot"]],
  ["collaboration-history-database-sqlite", "SQLiteHistoryDatabaseAdapter", ["appendRevision"]],
]) {
  const prototype = require(`@univerjs-pro/${pkg}`)[className].prototype;
  for (const name of methods) {
    const original = prototype[name];
    prototype[name] = async function (...args) {
      const start = performance.now();
      const cpu = process.cpuUsage();
      try { return await original.apply(this, args); }
      finally {
        const ms = performance.now() - start;
        if (ms >= 100) {
          const usage = process.cpuUsage(cpu);
          const record = { method: `${className}.${name}`, revision: args[0]?.revision ?? args[0]?.changeset?.revision, ms: +ms.toFixed(2), cpuMs: (usage.user + usage.system) / 1000 };
          slowSdkCalls.push(record);
          console.log(JSON.stringify(record));
        }
      }
    };
    restoreSdk.push(() => { prototype[name] = original; });
  }
}
let accessCalls = 0;
let accessMs = 0;
const restoreAccess = [];
let accessCallsByMethod = {};
for (const name of ["resolveNode", "resolveNodeAuthorization", "resolveOwnedResources"]) {
  const original = AccessRepository.prototype[name];
  AccessRepository.prototype[name] = function (...args) {
    const start = performance.now();
    try { return original.apply(this, args); }
    finally {
      accessCalls++;
      accessCallsByMethod[name] = (accessCallsByMethod[name] ?? 0) + 1;
      accessMs += performance.now() - start;
    }
  };
  restoreAccess.push(() => { AccessRepository.prototype[name] = original; });
}
const application = createWorkspaceApplication({
  host: "127.0.0.1", port: 0,
  databaseFilename: join(directory, "product.sqlite"),
  collaborationDatabaseFilename: join(directory, "collaboration.sqlite"),
  blobDirectory: join(directory, "blobs"),
  secureCookies: false, sessionTtlMs: 3_600_000, oauthClients: null,
});
const server = createServer(application.app);
let socket;
try {
  await application.initialize();
  application.attachWebSocket(server);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const issued = await application.identity.registerWithPassword({
    username: "latency-repro", displayName: "Latency Repro", password: randomUUID(),
  });
  const userId = issued.view.user.id;
  const cookie = `${application.identity.cookieName}=${issued.cookieValue}`;
  const spaceId = application.spaces.list(userId).spaces[0].id;
  async function request(path, body) {
    const response = await fetch(origin + path, {
      method: body ? "POST" : "GET",
      headers: { cookie, "content-type": "application/json", "idempotency-key": randomUUID() },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await response.json();
    assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(data)}`);
    assert.notEqual(response.status, 202, "Unexpected pending operation");
    return data;
  }
  const resourceInput = { kind: "univer", spaceId, parentNodeId: null, name: "Probe", unitType: "sheet" };
  const worktreeInput = { kind: "user", visibility: "private", name: "Probe", summary: null };
  const resources = [];
  for (let i = 0; i < 60; i++) {
    const created = await request("/api/resources", resourceInput);
    resources.push(created.node.resource);
    application.resources.open(userId, created.node.resource.id);
  }
  for (let i = 0; i < 10; i++) {
    const created = await request("/api/worktrees", worktreeInput);
    for (let j = 0; j < 5; j++) {
      await application.worktrees.addUnit(userId, created.id, randomUUID(), {
        source: "trunk", resourceId: resources[j].id,
      });
    }
  }
  const unitId = resources[0].unitId;
  const ticket = await request("/universer-api/user/session-ticket");
  socket = new WebSocket(`${origin.replace("http:", "ws:")}/universer-api/comb/connect?sessionTicket=${encodeURIComponent(ticket.ticket)}`);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  async function comb(body) {
    const response = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Comb response timeout")), 10_000);
      socket.addEventListener("message", event => {
        clearTimeout(timeout);
        try { resolve(deserializeToCombResponse(event)); } catch (error) { reject(error); }
      }, { once: true });
    });
    socket.send(serializeCombRequest(body));
    const result = await response;
    assert.equal(result.code, CmdRspCode.OK);
    return result;
  }
  const hello = await comb({ cmd: CombCmd.HELLO, routeKey: "hello", routeType: "" });
  await comb({ cmd: CombCmd.JOIN, routeKey: unitId, routeType: "", data: { rooms: [{ roomID: unitId, args: "" }] } });
  let revision = 1;
  async function submit() {
    const body = await request(`/universer-api/comb/${UniverType.UNIVER_SHEET}/unit/${unitId}/new_changes`, {
      unitID: unitId, memberID: hello.data.memberID, type: UniverType.UNIVER_SHEET,
      changeset: {
        unitID: unitId, type: UniverType.UNIVER_SHEET,
        baseRev: revision, revision: revision + 1, sid: "latency-repro", reqId: revision,
        userID: userId, memberID: hello.data.memberID, mutations: [], createTime: 1,
      },
    });
    assert.equal(body.error.code, ErrorCode.OK);
    revision++;
  }
  const probes = [
    ["GET recent", () => request("/api/recent-resources")],
    ["GET owned", () => request("/api/owned-by-me")],
    ["GET worktrees", () => request("/api/worktrees")],
    ["POST resource", () => request("/api/resources", resourceInput)],
    ["POST worktree", () => request("/api/worktrees", worktreeInput)],
    ["POST new_changes (empty mutations)", submit],
  ];
  async function measure(stage) {
    const nodeCount = application.database.connection.prepare("SELECT count(*) AS n FROM nodes").get().n;
    for (const [name, run] of probes) {
      const samples = [];
      accessCalls = 0; accessMs = 0; accessCallsByMethod = {};
      for (let i = 0; i < 5; i++) {
        const start = performance.now();
        await run();
        samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      const result = { stage, nodeCount, name, medianMs: +samples[2].toFixed(2), maxMs: +samples[4].toFixed(2), accessCallsPerRequest: accessCalls / 5, accessCallsByMethod, accessMsPerRequest: +(accessMs / 5).toFixed(2) };
      results.push(result);
      console.log(JSON.stringify(result));
    }
  }
  const db = application.database.connection;
  const insertNode = db.prepare("INSERT INTO nodes (id, space_id, parent_id, name, created_by, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?)");
  let seeded = 0;
  const counts = process.env.LATENCY_QUICK === "1" ? [0, 1_000] : [0, 1_000, 10_000, 100_000, 300_000];
  for (const count of counts) {
    application.database.transaction(() => {
      while (seeded < count) {
        const id = `load-${seeded++}`;
        insertNode.run(id, spaceId, id, userId, 1, 1);
      }
    });
    await measure(`folders-${count}`);
  }
  const plans = {
    original: db.prepare("EXPLAIN QUERY PLAN SELECT EXISTS (SELECT 1 FROM nodes AS child WHERE child.parent_id = ? AND child.trash_batch_id IS NULL)").all(resources[0].id),
    spaceScoped: db.prepare("EXPLAIN QUERY PLAN SELECT EXISTS (SELECT 1 FROM nodes AS child WHERE child.space_id = ? AND child.parent_id = ? AND child.trash_batch_id IS NULL)").all(spaceId, resources[0].id),
  };
  // Diagnostic-only index, never applied to an existing application database.
  // This is a causal control, not a proposed schema migration.
  db.exec("CREATE INDEX diagnostic_parent ON nodes(parent_id, trash_batch_id)");
  plans.indexed = db.prepare("EXPLAIN QUERY PLAN SELECT EXISTS (SELECT 1 FROM nodes AS child WHERE child.parent_id = ? AND child.trash_batch_id IS NULL)").all(resources[0].id);
  await measure(`folders-${seeded}-diagnostic-index`);
  const stored = new (await import("node:sqlite")).DatabaseSync(join(directory, "collaboration.sqlite"), { readOnly: true });
  const changes = stored.prepare("SELECT count(*) AS n FROM collaboration_changesets WHERE unit_id = ?").get(unitId);
  stored.close();
  assert.equal(changes.n, revision - 1, "Every submitted changeset must be persisted");
  console.log(JSON.stringify({ plans, submittedRevision: revision, changes }));
  writeFileSync(join(directory, "results.json"), JSON.stringify({ nodeVersion: process.version, results, slowSdkCalls, plans, submittedRevision: revision, changes }, null, 2));
} finally {
  socket?.close();
  await application.closeRealtime();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await application.close();
  for (const restore of restoreAccess) restore();
  for (const restore of restoreSdk) restore();
  console.log(`Diagnostic databases and report: ${directory}`);
}
