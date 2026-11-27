// Run from apps/workspace: LOG_LEVEL=silent node --expose-gc --import tsx scripts/sqlite/measure-worktree-sdk.mjs --output <file> [flags]
// Boots the real application in-process on newly created temporary SQLite databases only, and never opens an existing database.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { cpus, loadavg, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import { RevertRevisionMutation, transformSnapshotToDocumentData, transformSnapshotToWorkbookData } from "@univerjs-pro/collaboration";
import { JSONX, TextXActionType } from "@univerjs/core";
import { UniverType } from "@univerjs/protocol";
import { InsertRowMutation, RemoveRowMutation, SetRangeValuesMutation } from "@univerjs/sheets";
import { createWorkspaceApplication } from "../../server/src/app.ts";
import { loadConfig } from "../../server/src/config.ts";
import { openProductDatabase } from "../../server/src/db/index.js";
import { openCollaborationDatabase } from "../../server/src/integrations/univer/collaboration-database/open-collaboration-database.ts";
import { blankUnitData, collaborationCallOptions } from "../../server/src/integrations/univer/unit-store.ts";
import { interactivePrincipal } from "../../test/fixtures/principal.ts";

const help = `Usage: LOG_LEVEL=silent node --expose-gc --import tsx scripts/sqlite/measure-worktree-sdk.mjs --output PATH [flags]
Measures the Collaboration SDK Worktree for Agent Mode phase 0 (spec 6.1, A0.1 to A0.4), and
Trunk restore for phase 6 (P6-8a, docs/design/agent-mode/phase-6-restore-probe.zh-CN.md).
Each scenario boots the real application with the real SDK and /universer-api gateway on new
temporary SQLite databases, deletes them afterwards, and never opens an existing database.
  --scenario claims|behind|coldload|memory|restore|all  Default all
  --output PATH         Required. JSON report, rewritten after every scenario and checkpoint
  --quick               Smoke sizes: distances 0,10, 2 trials, loads 0,10, populations 0,1,5
  --trials N            behind: trials per distance and workload, default 5
  --draft-edits N       behind: draft set-range-values edits per Worktree, default 20
  --distances LIST      behind: Trunk revisions between baseline and merge, default 0,10,100,1000
  --structural-p P      behind structural workload: share of Trunk edits that insert or remove a row, default 0.02
  --idle-wait SECONDS   memory: wait, then sample again. The draft service idle timeout is 180 s, so use about 190
  --seed N              Workload random seed, default 1
  --self-test           Check the statistics and workload helpers without booting the application
  --help                Show this text
UNIVER_LICENSE and UNIVER_LICENSE_KEY are read through loadConfig as the server reads them.
Without them the bundled license applies. Progress goes to stderr and the report to stdout.
Expected refusals in claims and restore are observations. errors counts everything else that did not succeed,
including a merge reported as merged whose draft value is missing from Trunk.`;
const defaults = { scenario: "all", trials: 5, "draft-edits": 20, distances: "0,10,100,1000", "structural-p": 0.02, "idle-wait": 0, seed: 1 };
const switches = new Set(), given = {};
for (let i = 2; i < process.argv.length; i++) {
  const argument = process.argv[i], key = argument.replace(/^--/, "");
  assert(argument.startsWith("--"), `Unknown argument ${argument}`);
  if (["help", "self-test", "quick"].includes(key)) { switches.add(key); continue; }
  assert(key in defaults || key === "output", `Unknown flag ${argument}`);
  const value = process.argv[++i];
  assert(value !== undefined && !value.startsWith("--"), `Missing value for ${argument}`);
  given[key] = typeof defaults[key] === "number" ? Number(value) : value;
}
if (switches.has("help")) { console.log(help); process.exit(0); }
const quick = switches.has("quick");
const flags = { ...defaults, ...(quick ? { trials: 2, distances: "0,10" } : {}), ...given, quick };

const SHEET = UniverType.UNIVER_SHEET, DOC = UniverType.UNIVER_DOC;
const ROWS = 100, COLS = 5, DRAFT_ROW = 50, DRAFT_ROWS = 10, DRAFT_COL = 2;
function stats(values) {
  const v = values.toSorted((a, b) => a - b), n = v.length;
  return { n, median: n ? (v[Math.floor((n - 1) / 2)] + v[Math.ceil((n - 1) / 2)]) / 2 : null, min: n ? v[0] : null, max: n ? v.at(-1) : null };
}
function slope(points) {
  if (points.length < 2) return null;
  const mx = points.reduce((s, [x]) => s + x, 0) / points.length, my = points.reduce((s, [, y]) => s + y, 0) / points.length;
  const den = points.reduce((s, [x]) => s + (x - mx) ** 2, 0);
  return den ? points.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0) / den : null;
}
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const tally = values => values.reduce((counts, value) => ({ ...counts, [value]: (counts[value] ?? 0) + 1 }), {});
const cell = (sheet, row, col, v) => ({ id: SetRangeValuesMutation.id, data: JSON.stringify({ unitId: sheet.unitId, subUnitId: sheet.sheetId, cellValue: { [row]: { [col]: { v } } } }) });
const restoreTo = (target, revision) => ({ id: RevertRevisionMutation.id, data: JSON.stringify({ unitId: target.unitId, revision }) });
const docInsert = (doc, text) => ({ id: "doc.mutation.rich-text-editing", data: JSON.stringify({ unitId: doc.unitId, actions: JSONX.getInstance().editOp([{ t: TextXActionType.INSERT, len: text.length, body: { dataStream: text } }]) }) });
function differences(a, b, path = "", out = []) {
  if (out.length >= 20 || isDeepStrictEqual(a, b)) return out;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") out.push({ path: path || "/", a: JSON.stringify(a)?.slice(0, 300), b: JSON.stringify(b)?.slice(0, 300) });
  else for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) differences(a[key], b[key], `${path}/${key}`, out);
  return out;
}
// A restore re-serializes an empty plugin resource as "{}" where the stored snapshot had "".
const empty = ['""', '"{}"'];
const material = list => list.filter(({ path, a, b }) => !(path.startsWith("/resources/") && empty.includes(a) && empty.includes(b)));
const rowMutation = (sheet, mutation, row) => ({ id: mutation.id, data: JSON.stringify({ unitId: sheet.unitId, subUnitId: sheet.sheetId, range: { startRow: row, endRow: row, startColumn: 0, endColumn: COLS - 1 } }) });
function trunkEdit(next, workload, structuralShare, sheet, index) {
  if (workload === "structural" && next() < structuralShare) {
    const row = Math.floor(next() * ROWS);
    return next() < 0.5 ? { kind: "insert", row, mutation: rowMutation(sheet, InsertRowMutation, row) } : { kind: "remove", row, mutation: rowMutation(sheet, RemoveRowMutation, row) };
  }
  const inDraft = next() < 0.1;
  const row = inDraft ? DRAFT_ROW + Math.floor(next() * DRAFT_ROWS) : Math.floor(next() * ROWS);
  return { kind: inDraft ? "value-in-draft-region" : "value", row, mutation: cell(sheet, row, inDraft ? DRAFT_COL : Math.floor(next() * COLS), `trunk-${index}`) };
}

if (switches.has("self-test")) {
  assert.deepEqual(stats([3, 1, 2, 4]), { n: 4, median: 2.5, min: 1, max: 4 });
  assert.deepEqual(stats([]), { n: 0, median: null, min: null, max: null });
  assert.equal(slope([[0, 1], [1, 3], [2, 5]]), 2);
  assert.equal(slope([[1, 1]]), null);
  assert.equal(random(7)(), random(7)());
  assert.deepEqual(tally(["a", "b", "a"]), { a: 2, b: 1 });
  assert.deepEqual([SetRangeValuesMutation.id, InsertRowMutation.id, RemoveRowMutation.id], ["sheet.mutation.set-range-values", "sheet.mutation.insert-row", "sheet.mutation.remove-rows"]);
  const sheet = { unitId: "u", sheetId: "s" };
  assert.deepEqual(JSON.parse(cell(sheet, 3, 1, "x").data), { unitId: "u", subUnitId: "s", cellValue: { 3: { 1: { v: "x" } } } });
  assert.deepEqual(JSON.parse(trunkEdit(() => 0, "structural", 1, sheet, 0).mutation.data).range, { startRow: 0, endRow: 0, startColumn: 0, endColumn: COLS - 1 });
  const next = random(1);
  const structural = Array.from({ length: 20000 }, (_, i) => trunkEdit(next, "structural", 0.02, sheet, i).kind);
  const share = structural.filter(kind => kind === "insert" || kind === "remove").length / structural.length;
  assert(share > 0.015 && share < 0.025, `structural share ${share}`);
  const values = Array.from({ length: 2000 }, (_, i) => trunkEdit(next, "values", 1, sheet, i));
  assert(values.every(edit => edit.kind.startsWith("value") && edit.row >= 0 && edit.row < ROWS));
  const inDraft = values.filter(edit => edit.kind === "value-in-draft-region").length / values.length;
  assert(inDraft > 0.07 && inDraft < 0.13, `draft-region share ${inDraft}`);
  assert.deepEqual(restoreTo(sheet, 4), { id: "univer.mutation.revert-version", data: JSON.stringify({ unitId: "u", revision: 4 }) });
  assert.deepEqual(JSON.parse(docInsert(sheet, "ab").data).actions, ["body", { et: "text-x", e: [{ t: "i", len: 2, body: { dataStream: "ab" } }] }]);
  assert.deepEqual(differences({ a: 1, b: { c: [1, 2] } }, { a: 1, b: { c: [1, 3] }, d: 0 }), [{ path: "/b/c/1", a: "2", b: "3" }, { path: "/d", a: undefined, b: "0" }]);
  assert.deepEqual(differences({ a: 1 }, { a: 1 }), []);
  assert.deepEqual(material(differences({ resources: { X: "" }, v: 1 }, { resources: { X: "{}" }, v: 2 })), [{ path: "/v", a: "1", b: "2" }]);
  console.log("PASS statistics, slope, seeded workload, mutation shape and difference self-check");
  process.exit(0);
}
assert(["claims", "behind", "coldload", "memory", "restore", "all"].includes(flags.scenario), `Unknown scenario ${flags.scenario}`);
for (const key of ["trials", "draft-edits", "seed"]) assert(Number.isInteger(flags[key]) && flags[key] > 0, `--${key} must be a positive integer`);
assert(Number.isInteger(flags["idle-wait"]) && flags["idle-wait"] >= 0, "--idle-wait must be a non-negative integer");
assert(flags["structural-p"] >= 0 && flags["structural-p"] <= 1, "--structural-p must be between 0 and 1");
const distances = flags.distances.split(",").map(Number);
assert(distances.every(d => Number.isInteger(d) && d >= 0), "--distances must be non-negative integers");
assert(flags.output, "--output is required");
const loads = quick ? [0, 10] : [0, 10, 100, 1000];
const reopenRepeats = quick ? 1 : 3;
const populations = quick ? [0, 1, 5] : [0, 1, 5, 10, 20];
const log = message => console.error(`${new Date().toISOString().slice(11, 19)} ${message}`);

const require = createRequire(import.meta.url);
const { UnitSnapshotMaterializer } = require("@univerjs-pro/collaboration-service");
const captured = {};
let bypassProductMiddleware = false, productMiddleware = 0, requiredPermissions = [];
// The gateway's middleware answers before the SDK's own checks, so probes can switch it off to reach the SDK.
for (const [name, pkg, className] of [
  ["trunk", "collaboration-service", "UniverCollabService"],
  ["worktree", "collaboration-worktree-service", "UniverCollabWorktreeService"],
  ["endpoint", "collaboration-endpoint", "UniverCollabEndpoint"],
  ["worktreeEndpoint", "collaboration-worktree-endpoint", "UniverCollabWorktreeEndpoint"],
]) {
  const prototype = require(`@univerjs-pro/${pkg}`)[className].prototype;
  const use = prototype.use;
  prototype.use = function (action, middleware) {
    (captured[name] ??= new Set()).add(this);
    if (!new Error().stack.includes("collaboration-gateway")) return use.call(this, action, middleware);
    productMiddleware++;
    return use.call(this, action, (context, next) => {
      if (action === "commitChangeset") requiredPermissions.push({ service: name, unitID: context.request.changeset.unitID, attempt: context.attempt, revision: context.changeset.revision, required: context.requiredUnitPermissions });
      return bypassProductMiddleware ? next() : middleware(context, next);
    });
  };
}

const workers = new Set();
process.on("worker", worker => {
  workers.add(worker);
  worker.once("exit", () => workers.delete(worker));
});

let app, sdk, origin, materializer;
async function boot(directory) {
  for (const set of Object.values(captured)) set.clear();
  productMiddleware = 0;
  const config = loadConfig({
    DATABASE_FILE: join(directory, "product.sqlite"),
    COLLABORATION_DATABASE_FILE: join(directory, "collaboration.sqlite"),
    BLOB_DIRECTORY: join(directory, "blobs"),
    SESSION_TTL_MS: "86400000",
    UNIVER_LICENSE: process.env.UNIVER_LICENSE,
    UNIVER_LICENSE_KEY: process.env.UNIVER_LICENSE_KEY,
  });
  const product = await openProductDatabase(config.database);
  const collaboration = await openCollaborationDatabase(config, product.unitCreationFacts);
  const application = createWorkspaceApplication(config, product.repositories, collaboration);
  const server = createServer(application.app);
  await application.initialize();
  application.attachWebSocket(server);
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${server.address().port}`;
  const seen = Object.fromEntries(Object.entries(captured).map(([name, set]) => [name, set.size]));
  assert.equal(seen.trunk, 1, `exactly one trunk UniverCollabService after initialize, saw ${JSON.stringify(seen)}`);
  assert.equal(seen.worktree, 1, `exactly one UniverCollabWorktreeService after initialize, saw ${JSON.stringify(seen)}`);
  assert(seen.endpoint >= 1 && seen.worktreeEndpoint >= 1 && productMiddleware > 0, `gateway endpoints and middleware, saw ${JSON.stringify(seen)}`);
  const first = set => set.values().next().value;
  sdk = { trunk: first(captured.trunk), worktree: first(captured.worktree), endpoint: first(captured.endpoint), worktreeEndpoint: first(captured.worktreeEndpoint) };
  app = {
    application,
    collaborationFile: config.database.collaborationFilename,
    async close() {
      await materializer?.dispose();
      materializer = undefined;
      await application.closeRealtime();
      server.closeAllConnections();
      await new Promise(done => server.close(done));
      await application.close();
      await collaboration.close();
      await product.close();
    },
  };
  return { ...seen, productMiddleware };
}

async function http(method, path, actor, body) {
  const started = performance.now();
  const response = await fetch(origin + path, {
    method,
    headers: { ...(actor && { cookie: actor.cookie }), ...(method === "POST" && { "content-type": "application/json", "idempotency-key": randomUUID() }) },
    ...(method === "POST" && { body: JSON.stringify(body ?? {}) }),
    signal: AbortSignal.timeout(600_000),
  });
  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: response.status, body: parsed, ms: performance.now() - started, cookie: response.headers.get("set-cookie")?.split(";")[0] };
}
async function ok(method, path, actor, body) {
  const response = await http(method, path, actor, body);
  if (response.status < 200 || response.status > 299) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(response.body)}`);
  return response;
}
async function settle(call) {
  try { return { ok: true, value: await call() }; }
  catch (error) { return { ok: false, name: error?.name, code: error?.code, message: error?.message, details: error?.details }; }
}
async function withoutProductMiddleware(call) {
  bypassProductMiddleware = true;
  try { return await call(); } finally { bypassProductMiddleware = false; }
}
const submitResult = result => (result.ok ? { status: result.value.status, code: result.value.error?.code, message: result.value.error?.message, revision: result.value.changeset?.revision } : { threw: true, code: result.code, message: result.message });

async function person(username) {
  const issued = await app.application.identity.registerWithPassword({ username, displayName: username, password: randomUUID() });
  return { id: issued.view.user.id, username, cookie: `${app.application.identity.cookieName}=${issued.cookieValue}`, sid: randomUUID(), reqId: 0 };
}
async function team() {
  const H = await person("owner"), E1 = await person("editor-one"), E2 = await person("editor-two"), V = await person("viewer");
  const space = await app.application.spaces.createTeamSpace(interactivePrincipal(H.id), { name: "Agent Mode measurements" });
  for (const [user, role] of [[E1, "editor"], [E2, "editor"], [V, "viewer"]]) await app.application.permissions.upsertTeamMember(interactivePrincipal(H.id), space.id, user.id, { role });
  return { H, E1, E2, V, S: space.id };
}
const changeset = (actor, target, mutations) => ({ unitID: target.unitId, type: target.type ?? SHEET, baseRev: target.head, revision: target.head + 1, sid: actor.sid, reqId: ++actor.reqId, mutations });
const head = async (unitId, type = SHEET) => (await sdk.trunk.getUnitLoadData({ unitID: unitId, type, revision: 0 }, collaborationCallOptions("measure-worktree-sdk"))).targetRevision;
async function sheet(actor, spaceId, name) {
  const data = blankUnitData({ unitId: randomUUID(), unitType: "sheet", name }).data;
  const sheetId = data.sheetOrder[0];
  data.sheets[sheetId].cellData = Object.fromEntries(Array.from({ length: ROWS }, (_, r) => [r, Object.fromEntries(Array.from({ length: COLS }, (_, c) => [c, { v: r * COLS + c }]))]));
  const created = await ok("POST", "/api/resources", actor, { kind: "univer", spaceId, parentNodeId: null, name, unitType: "sheet", initialData: data });
  assert.notEqual(created.status, 202, "Sheet creation stayed pending");
  const { id: resourceId, unitId } = created.body.node.resource;
  return { resourceId, unitId, sheetId, head: await head(unitId) };
}
async function doc(actor, spaceId, name) {
  const data = blankUnitData({ unitId: randomUUID(), unitType: "doc", name }).data;
  data.body = { dataStream: "One\rTwo\r\n", paragraphs: [{ startIndex: 3, paragraphId: "para_1" }, { startIndex: 7, paragraphId: "para_2" }], sectionBreaks: [{ startIndex: 8, sectionId: "s1" }] };
  const created = await ok("POST", "/api/resources", actor, { kind: "univer", spaceId, parentNodeId: null, name, unitType: "doc", initialData: data });
  assert.notEqual(created.status, 202, "Doc creation stayed pending");
  const { id: resourceId, unitId } = created.body.node.resource;
  return { resourceId, unitId, type: DOC, head: await head(unitId, DOC) };
}
async function submitTrunk(actor, value) {
  const options = collaborationCallOptions(actor.id);
  return submitResult(await settle(() => sdk.trunk.submitChangeset({ changeset: { ...value, userID: actor.id, memberID: options.memberID } }, options)));
}
async function trunk(actor, target, mutations) {
  const options = collaborationCallOptions(actor.id);
  const result = await sdk.trunk.submitChangeset({ changeset: { ...changeset(actor, target, mutations), userID: actor.id, memberID: options.memberID } }, options);
  if (result.status !== "committed") throw new Error(`Trunk edit ${result.status}: ${result.error?.code} ${result.error?.message}`);
  target.head = result.changeset.revision;
}
const teamWorktree = async (actor, spaceId) => (await ok("POST", "/api/worktrees", actor, { kind: "team", teamSpaceId: spaceId, visibility: "space", name: "Measurement", summary: null })).body.id;
async function addTrunkUnit(actor, worktreeId, target) {
  const added = await ok("POST", `/api/worktrees/${worktreeId}/units`, actor, { source: "trunk", resourceId: target.resourceId });
  return { unitId: added.body.unit.unitId, head: added.body.unit.draftHeadRevision, type: target.type };
}
async function draft(actor, worktreeId, unit, mutations) {
  const response = await ok("POST", `/api/worktrees/${worktreeId}/units/${unit.unitId}/changesets`, actor, { changeset: changeset(actor, unit, mutations) });
  if (response.body.status !== "committed") throw new Error(`Draft edit ${response.body.status}: ${JSON.stringify(response.body.error)}`);
  unit.head = response.body.changeset.revision;
  return response;
}
async function directDraft(actor, worktreeId, unit, mutations) {
  const options = collaborationCallOptions(actor.id);
  return submitResult(await settle(() => sdk.worktree.submitChangeset({ worktreeID: worktreeId, changeset: { ...changeset(actor, unit, mutations), userID: actor.id, memberID: options.memberID } }, options)));
}
const sdkWorktree = async worktreeId => (await sdk.worktree.getWorktree({ worktreeID: worktreeId }, collaborationCallOptions("measure-worktree-sdk"))).worktree;
const sdkUnit = async (worktreeId, unitId) => (await sdkWorktree(worktreeId)).units.find(unit => unit.unitID === unitId);
const productView = async (actor, worktreeId) => {
  const { state, processedAt, units } = (await ok("GET", `/api/worktrees/${worktreeId}`, actor)).body.worktree;
  return { state, processedAt, units: units.map(({ unitId, change, mergeResult, draftHeadRevision }) => ({ unitId, change, mergeResult, draftHeadRevision })) };
};
async function trunkHas(target, value) {
  const loaded = await sdk.trunk.getUnitLoadDataWithBlocks({ unitID: target.unitId, type: SHEET, revision: 0 }, collaborationCallOptions("measure-worktree-sdk"));
  const { snapshot, sheetBlocks } = await (materializer ??= new UnitSnapshotMaterializer({ execution: { mode: "in-process" } })).materializeSnapshot(loaded);
  const workbook = await transformSnapshotToWorkbookData(snapshot, structuredClone(sheetBlocks));
  for (const [row, columns] of Object.entries(workbook.sheets[target.sheetId]?.cellData ?? {})) {
    for (const [col, data] of Object.entries(columns)) if (data?.v === value) return { row: Number(row), col: Number(col) };
  }
  return null;
}
async function trunkData(target, revision = 0) {
  const type = target.type ?? SHEET;
  const loaded = await sdk.trunk.getUnitLoadDataWithBlocks({ unitID: target.unitId, type, revision }, collaborationCallOptions("measure-worktree-sdk"));
  const { snapshot, sheetBlocks } = await (materializer ??= new UnitSnapshotMaterializer({ execution: { mode: "in-process" } })).materializeSnapshot(loaded);
  const { rev, resources = [], ...data } = type === DOC ? transformSnapshotToDocumentData(snapshot) : await transformSnapshotToWorkbookData(snapshot, structuredClone(sheetBlocks));
  return { revision: loaded.targetRevision, rev, data: { ...data, resources: Object.fromEntries(resources.map(resource => [resource.name, resource.data])) } };
}
async function trunkHistory(target, after) {
  const to = await head(target.unitId, target.type);
  const { changesets } = await sdk.trunk.getChangesets({ unitID: target.unitId, type: target.type ?? SHEET, from: after, to }, collaborationCallOptions("measure-worktree-sdk"));
  return changesets.filter(record => record.revision > after).map(({ revision, baseRev, userID, memberID, sid, reqId, mutations }) => ({ revision, baseRev, userID, memberID, sid, reqId, mutations: mutations.map(mutation => mutation.id) }));
}
async function landed(author, spaceId, target, mutations) {
  const worktreeId = await teamWorktree(author, spaceId);
  const unit = await addTrunkUnit(author, worktreeId, target);
  for (const mutation of mutations) await draft(author, worktreeId, unit, [mutation]);
  await ok("POST", `/api/worktrees/${worktreeId}/ready`, author);
  const preMergeHead = await head(target.unitId, target.type);
  await ok("POST", `/api/worktrees/${worktreeId}/merge`, author);
  const sdkResult = (await sdkUnit(worktreeId, target.unitId))?.mergeResult;
  assert.equal(sdkResult?.status, "merged", `setup merge of ${worktreeId} did not merge: ${JSON.stringify(sdkResult)}`);
  target.head = await head(target.unitId, target.type);
  return { worktreeId, author: author.id, draftChangesets: mutations.length, preMergeHead, sdkResult, productResult: (await productView(author, worktreeId)).units[0]?.mergeResult };
}
function draftRows(worktreeId, unitId) {
  const db = new DatabaseSync(app.collaborationFile, { readOnly: true });
  try {
    const count = table => db.prepare(`SELECT count(*) AS n FROM ${table} WHERE worktree_id = ? AND unit_id = ?`).get(worktreeId, unitId).n;
    return { changesets: count("collaboration_worktree_changesets"), seeds: count("collaboration_worktree_unit_seeds") };
  } finally {
    db.close();
  }
}
async function proposal(owner, spaceId, author, input, value) {
  const target = await sheet(owner, spaceId, value);
  const worktreeId = (await ok("POST", "/api/worktrees", author, { ...input, name: value, summary: null })).body.id;
  const unit = await addTrunkUnit(author, worktreeId, target);
  await draft(author, worktreeId, unit, [cell(target, 10, 1, value)]);
  await ok("POST", `/api/worktrees/${worktreeId}/ready`, author);
  return { target, worktreeId, unit, value };
}
async function directMerge(actor, worktreeId) {
  const result = await settle(() => sdk.worktree.mergeWorktree({ worktreeID: worktreeId }, collaborationCallOptions(actor.id)));
  return result.ok ? { status: result.value.worktree.status, units: result.value.worktree.units.map(unit => unit.mergeResult) } : { threw: true, code: result.code, message: result.message };
}

const verdict = holds => (holds ? "CONFIRMED" : "REFUTED");
function recorder(result, fail) {
  result.records = [];
  return async (id, statement, check) => {
    log(`claim ${id}`);
    try {
      result.records.push({ id, statement, ...(await check()) });
    } catch (error) {
      fail(`claim ${id}`, error);
      result.records.push({ id, statement, verdict: "INCONCLUSIVE", reason: `harness error: ${error.message}` });
    }
  };
}

async function claims({ directory, fail, result }) {
  result.capturedAtInitialize = await boot(directory);
  const { H, E1, E2, V, S } = await team();
  const claim = recorder(result, fail);
  const teamInput = { kind: "team", teamSpaceId: S, visibility: "space" };

  const shallow = await sheet(H, S, "Shallow");
  for (let i = 0; i < 3; i++) await trunk(H, shallow, [cell(shallow, 0, 0, `before-add-${i}`)]);
  const w1 = await teamWorktree(E1, S);
  let baseline;
  await claim("shallow-add", "Adding a Trunk Unit is a shallow reference at the current Trunk head (spec 5.3, A0.4)", async () => {
    const trunkHeadBefore = await head(shallow.unitId);
    const added = await addTrunkUnit(E1, w1, shallow);
    const unit = await sdkUnit(w1, shallow.unitId);
    const rows = draftRows(w1, shallow.unitId);
    const trunkHeadAfter = await head(shallow.unitId);
    baseline = unit?.baselineTrunkRevision;
    return {
      verdict: verdict(added.unitId === shallow.unitId && unit?.unitID === shallow.unitId && unit.baselineTrunkRevision === trunkHeadBefore &&
        unit.draftHeadRevision === unit.baselineTrunkRevision && rows.changesets === 0 && rows.seeds === 0 && trunkHeadAfter === trunkHeadBefore),
      observed: { trunkUnitId: shallow.unitId, productUnitId: added.unitId, sdkUnit: unit, trunkHeadBefore, trunkHeadAfter, draftChangesetRows: rows.changesets, seedRows: rows.seeds },
    };
  });
  await claim("baseline-fixed", "The baseline does not move when Trunk advances, and adding the Unit again keeps it", async () => {
    for (let i = 0; i < 3; i++) await trunk(E2, shallow, [cell(shallow, 1, 0, `after-add-${i}`)]);
    const trunkHead = await head(shallow.unitId);
    const afterAdvance = (await sdkUnit(w1, shallow.unitId)).baselineTrunkRevision;
    const sdkReAdd = await settle(() => sdk.worktree.addUnit({ worktreeID: w1, unitID: shallow.unitId }, collaborationCallOptions(E1.id)));
    const afterSdkReAdd = (await sdkUnit(w1, shallow.unitId)).baselineTrunkRevision;
    const httpReAdd = await http("POST", `/api/worktrees/${w1}/units`, E1, { source: "trunk", resourceId: shallow.resourceId });
    const afterHttpReAdd = (await sdkUnit(w1, shallow.unitId)).baselineTrunkRevision;
    return {
      verdict: verdict(trunkHead > baseline && [afterAdvance, afterSdkReAdd, afterHttpReAdd].every(value => value === baseline)),
      observed: {
        baseline, trunkHead, afterAdvance, afterSdkReAdd, afterHttpReAdd,
        sdkReAdd: sdkReAdd.ok ? { returned: sdkReAdd.value.worktree.units.find(unit => unit.unitID === shallow.unitId) } : sdkReAdd,
        httpReAdd: { status: httpReAdd.status, body: httpReAdd.body },
      },
    };
  });

  const frozen = await sheet(H, S, "Frozen");
  const w3 = await teamWorktree(E1, S);
  const u3 = await addTrunkUnit(E1, w3, frozen);
  await draft(E1, w3, u3, [cell(frozen, 10, 1, "draft-before-ready")]);
  await ok("POST", `/api/worktrees/${w3}/ready`, E1);
  await claim("ready-freezes", "After ready, the SDK rejects a draft submitChangeset by the author", async () => {
    const before = await sdkUnit(w3, frozen.unitId);
    const productHttp = await http("POST", `/api/worktrees/${w3}/units/${frozen.unitId}/changesets`, E1, { changeset: changeset(E1, u3, [cell(frozen, 11, 1, "after-ready-http")]) });
    const withProductMiddleware = await directDraft(E1, w3, u3, [cell(frozen, 11, 1, "after-ready-direct")]);
    const sdkOnly = await withoutProductMiddleware(() => directDraft(E1, w3, u3, [cell(frozen, 11, 1, "after-ready-sdk-only")]));
    const after = await sdkUnit(w3, frozen.unitId);
    return {
      verdict: verdict(sdkOnly.status !== "committed" && after.draftHeadRevision === before.draftHeadRevision),
      observed: { status: (await sdkWorktree(w3)).status, productHttp: { status: productHttp.status, body: productHttp.body }, withProductMiddleware, sdkOnly, draftHeadBefore: before.draftHeadRevision, draftHeadAfter: after.draftHeadRevision, readyDraftHeadRevision: after.readyDraftHeadRevision },
    };
  });
  await claim("merged-frozen", "After merge, the SDK rejects a draft submitChangeset and reopenWorktree", async () => {
    const merged = await http("POST", `/api/worktrees/${w3}/merge`, E1);
    const before = await sdkUnit(w3, frozen.unitId);
    const status = (await sdkWorktree(w3)).status;
    if (merged.status !== 200 || status !== "merged") return { verdict: "INCONCLUSIVE", reason: "the setup merge did not merge", observed: { merge: merged.status, status } };
    const withProductMiddleware = await directDraft(E1, w3, u3, [cell(frozen, 12, 1, "after-merge-direct")]);
    const sdkOnly = await withoutProductMiddleware(() => directDraft(E1, w3, u3, [cell(frozen, 12, 1, "after-merge-sdk-only")]));
    const reopen = await settle(() => sdk.worktree.reopenWorktree({ worktreeID: w3 }, collaborationCallOptions(E1.id)));
    const after = await sdkUnit(w3, frozen.unitId);
    return {
      verdict: verdict(sdkOnly.status !== "committed" && !reopen.ok && after.draftHeadRevision === before.draftHeadRevision && after.mergeResult?.status === "merged"),
      observed: { status: (await sdkWorktree(w3)).status, mergeResult: after.mergeResult, withProductMiddleware, sdkOnly, reopen: reopen.ok ? { status: reopen.value.worktree.status } : reopen, draftHeadBefore: before.draftHeadRevision, draftHeadAfter: after.draftHeadRevision },
    };
  });

  const conflicting = await sheet(H, S, "Partial conflicting"), clean = await sheet(H, S, "Partial clean");
  const w5 = await teamWorktree(E1, S);
  const conflictingUnit = await addTrunkUnit(E1, w5, conflicting), cleanUnit = await addTrunkUnit(E1, w5, clean);
  await draft(E1, w5, conflictingUnit, [cell(conflicting, 10, 1, "partial-conflicting")]);
  await draft(E1, w5, cleanUnit, [cell(clean, 10, 1, "partial-clean")]);
  await trunk(E2, conflicting, [rowMutation(conflicting, RemoveRowMutation, 10)]);
  await trunk(E2, clean, [rowMutation(clean, RemoveRowMutation, 5)]);
  await ok("POST", `/api/worktrees/${w5}/ready`, E1);
  await claim("partial-conflict", "A conflict in one Unit returns the Worktree to ready and keeps the other Unit merged on Trunk. Trunk removed the draft's written row 10 in one Sheet and row 5, above it, in the other", async () => {
    const merge = await http("POST", `/api/worktrees/${w5}/merge`, E1);
    const view = await sdkWorktree(w5);
    const resultOf = target => view.units.find(unit => unit.unitID === target.unitId)?.mergeResult;
    const observed = {
      httpMerge: { status: merge.status, state: merge.body?.worktree?.state, operation: merge.body?.operation?.state },
      sdkStatus: view.status, conflictingUnit: resultOf(conflicting), cleanUnit: resultOf(clean),
      cleanValueOnTrunk: await trunkHas(clean, "partial-clean"), conflictingValueOnTrunk: await trunkHas(conflicting, "partial-conflicting"),
      product: await productView(E1, w5),
    };
    if (observed.conflictingUnit?.status !== "conflict") return { verdict: "INCONCLUSIVE", reason: `the Trunk remove-rows did not conflict, Unit result ${observed.conflictingUnit?.status}`, observed };
    return { verdict: verdict(view.status === "ready" && observed.cleanUnit?.status === "merged" && observed.cleanValueOnTrunk !== null && observed.conflictingValueOnTrunk === null), observed };
  });

  await claim("non-author-merge-editor", "An editor who did not author a Team Worktree can merge it through the SDK, and Trunk records the merger", async () => {
    const p = await proposal(H, S, E1, teamInput, "merged-by-editor-two");
    const merge = await directMerge(E2, p.worktreeId);
    const trunkRevision = merge.units?.[0]?.trunkRevision;
    const changesets = trunkRevision ? (await sdk.trunk.getChangesets({ unitID: p.target.unitId, type: SHEET, from: trunkRevision - 1, to: trunkRevision }, collaborationCallOptions(E2.id))).changesets : [];
    const merged = changesets.find(record => record.revision === trunkRevision);
    const observed = { merge, author: E1.id, merger: E2.id, trunkChangeset: merged && { revision: merged.revision, userID: merged.userID, memberID: merged.memberID, mutations: merged.mutations.length }, valueOnTrunk: await trunkHas(p.target, p.value) };
    return { verdict: verdict(merge.status === "merged" && merged?.userID === E2.id && observed.valueOnTrunk !== null), observed };
  });
  await claim("non-author-merge-viewer", "Trunk's collaboration service checks the merger's edit permission, so a viewer's merge does not land (spec 5.4)", async () => {
    const p = await proposal(H, S, E1, teamInput, "merged-by-viewer");
    const trunkHeadBefore = await head(p.target.unitId);
    const byViewer = await directMerge(V, p.worktreeId);
    const afterViewer = { status: (await sdkWorktree(p.worktreeId)).status, trunkHead: await head(p.target.unitId), valueOnTrunk: await trunkHas(p.target, p.value) };
    const sdkOnly = await withoutProductMiddleware(() => directMerge(V, p.worktreeId));
    const afterSdkOnly = { trunkHead: await head(p.target.unitId), valueOnTrunk: await trunkHas(p.target, p.value) };
    const landed = afterViewer.valueOnTrunk !== null || afterViewer.trunkHead !== trunkHeadBefore;
    return {
      verdict: verdict(!landed),
      observed: { viewer: V.id, trunkHeadBefore, byViewer, afterViewer, sdkOnlyRetry: sdkOnly, afterSdkOnly, refusedBy: landed ? null : afterSdkOnly.valueOnTrunk !== null ? "product gateway Trunk middleware" : "SDK" },
    };
  });
  await claim("non-author-merge-claimer", "The person who claimed an agent merges the agent's User Worktree over the product HTTP route", async () => {
    const guest = await ok("POST", "/api/auth/guest", null, {});
    const agent = { cookie: guest.cookie, sid: randomUUID(), reqId: 0 };
    agent.id = (await ok("GET", "/api/session", agent)).body.user.id;
    const claimer = await person("claimer");
    const { code } = (await ok("POST", "/api/agents/claim-codes", agent)).body;
    await ok("POST", "/api/agents/claim", claimer, { code });
    const personal = (await ok("GET", "/api/spaces", agent)).body.spaces.find(space => space.type === "personal").id;
    const p = await proposal(agent, personal, agent, { kind: "user", visibility: "private" }, "merged-by-claimer");
    const merge = await http("POST", `/api/worktrees/${p.worktreeId}/merge`, claimer);
    const observed = { agent: agent.id, claimer: claimer.id, http: { status: merge.status, state: merge.body?.worktree?.state, error: merge.body?.error }, sdk: await sdkWorktree(p.worktreeId), valueOnTrunk: await trunkHas(p.target, p.value) };
    return { verdict: verdict(merge.status === 200 && observed.sdk.status === "merged" && observed.valueOnTrunk !== null), observed };
  });
}

async function behind({ directory, fail, result, save }) {
  result.capturedAtInitialize = await boot(directory);
  const { H, E1, E2, S } = await team();
  const next = random(flags.seed);
  result.summary = [];
  result.trials = [];
  for (const workload of ["values", "structural"]) {
    for (const distance of distances) {
      const rows = [];
      for (let trial = 0; trial < flags.trials; trial++) {
        const tag = `${workload}-${distance}-${trial}`;
        log(`behind ${tag}`);
        try {
          const target = await sheet(H, S, tag);
          const worktreeId = await teamWorktree(E1, S);
          const unit = await addTrunkUnit(E1, worktreeId, target);
          const baseline = unit.head;
          for (let i = 0; i < flags["draft-edits"]; i++) await draft(E1, worktreeId, unit, [cell(target, DRAFT_ROW + (i % DRAFT_ROWS), DRAFT_COL, `${tag}-draft-${i}`)]);
          const edits = [];
          for (let j = 0; j < distance; j++) {
            const edit = trunkEdit(next, workload, flags["structural-p"], target, j);
            edits.push(edit.kind);
            await trunk(E2, target, [edit.mutation]);
          }
          if (target.head - baseline !== distance) throw new Error(`behind by ${target.head - baseline}, expected ${distance}`);
          await ok("POST", `/api/worktrees/${worktreeId}/ready`, E1);
          const evaluateStarted = performance.now();
          const evaluation = await settle(() => sdk.worktree.evaluateWorktreeUnitMerge({ worktreeID: worktreeId, unitID: target.unitId }, collaborationCallOptions(E1.id)));
          const evaluateMs = performance.now() - evaluateStarted;
          const merge = await ok("POST", `/api/worktrees/${worktreeId}/merge`, E1);
          const view = await sdkWorktree(worktreeId);
          const outcome = view.units[0]?.mergeResult;
          const product = await productView(E1, worktreeId);
          const landedAt = outcome?.status === "merged" ? await trunkHas(target, `${tag}-draft-${flags["draft-edits"] - 1}`) : null;
          if (outcome?.status === "merged" && !landedAt) fail(tag, new Error("merge reported merged but the draft's last value is not on Trunk"));
          if (view.status !== "merged") await ok("POST", `/api/worktrees/${worktreeId}/discard`, E1);
          const row = {
            workload, distance, trial, trunkEdits: tally(edits),
            evaluate: { ms: evaluateMs, kind: evaluation.ok ? evaluation.value.status : "threw", code: evaluation.ok ? evaluation.value.error?.code : evaluation.code },
            merge: { ms: merge.ms, outcome: outcome?.status ?? "missing", code: outcome?.error?.code, message: outcome?.error?.message, sdkStatus: view.status, productState: product.state, productUnit: product.units[0]?.mergeResult, processed: product.processedAt !== null },
            landedAt,
          };
          rows.push(row);
          result.trials.push(row);
        } catch (error) {
          fail(tag, error);
        }
      }
      const outcomes = rows.map(row => row.merge.outcome);
      result.summary.push({
        workload, distance, draftEdits: flags["draft-edits"], trials: rows.length,
        merged: outcomes.filter(o => o === "merged").length, conflict: outcomes.filter(o => o === "conflict").length, failed: outcomes.filter(o => o === "failed").length,
        failedCodes: tally(rows.filter(row => row.merge.outcome === "failed").map(row => row.merge.code)),
        conflictCodes: tally(rows.filter(row => row.merge.outcome === "conflict").map(row => row.merge.code)),
        mergeMs: stats(rows.map(row => row.merge.ms)), evaluateMs: stats(rows.map(row => row.evaluate.ms)), evaluateKinds: tally(rows.map(row => row.evaluate.kind)),
      });
      save();
    }
  }
}

async function coldload({ directory, fail, result, save }) {
  result.capturedAtInitialize = await boot(directory);
  const { H, E1, S } = await team();
  const targets = [];
  for (const count of loads) {
    log(`coldload seeding N=${count}`);
    const target = await sheet(H, S, `cold-${count}`);
    const worktreeId = await teamWorktree(E1, S);
    const unit = await addTrunkUnit(E1, worktreeId, target);
    for (let i = 0; i < count; i++) await draft(E1, worktreeId, unit, [cell(target, i % ROWS, DRAFT_COL, `cold-${count}-${i}`)]);
    targets.push({ count, worktreeId, unit, target });
  }
  // Private SDK fields here and in memory are read only as evidence that a draft service exists.
  const running = worktreeId => sdk.worktree._draftServices?.has?.(worktreeId) ?? null;
  result.samples = [];
  for (let repeat = 0; repeat < reopenRepeats; repeat++) {
    for (const order of ["load-first", "edit-first"]) {
      await app.close();
      app = undefined;
      result.capturedAtInitialize = await boot(directory);
      log(`coldload reopened, repeat ${repeat} ${order}`);
      for (const { count, worktreeId, unit, target } of targets) {
        const sample = { count, order, repeat };
        try {
          for (const step of order === "load-first" ? ["load", "edit"] : ["edit", "load"]) {
            const draftServiceRunning = running(worktreeId);
            if (step === "load") {
              const loaded = await ok("GET", `/universer-api/worktrees/${worktreeId}/snapshot/${SHEET}/unit/${unit.unitId}/rev/0`, E1);
              sample.load = { ms: loaded.ms, draftServiceRunning, changesets: loaded.body.changesets?.length, snapshotRevision: loaded.body.snapshot?.rev };
            } else {
              const edited = await draft(E1, worktreeId, unit, [cell(target, 0, DRAFT_COL + 1, `cold-edit-${repeat}-${order}`)]);
              sample.edit = { ms: edited.ms, draftServiceRunning, revision: unit.head };
            }
          }
          result.samples.push(sample);
        } catch (error) {
          fail(`coldload N=${count} ${order} ${repeat}`, error);
        }
      }
      save();
    }
  }
  const of = (count, order, step) => stats(result.samples.filter(s => s.count === count && s.order === order && s[step]).map(s => s[step].ms));
  result.summary = loads.map(count => ({
    count,
    coldLoadMs: of(count, "load-first", "load"), editAfterLoadMs: of(count, "load-first", "edit"),
    coldEditMs: of(count, "edit-first", "edit"), loadAfterEditMs: of(count, "edit-first", "load"),
    changesetsReturned: tally(result.samples.filter(s => s.count === count).map(s => s.load?.changesets)),
  }));
}

async function memory({ directory, result, save }) {
  assert.equal(typeof global.gc, "function", "memory needs node --expose-gc");
  result.capturedAtInitialize = await boot(directory);
  const { H, E1, S } = await team();
  const shared = await sheet(H, S, "Memory");
  await trunk(H, shared, [cell(shared, 0, 0, "start the Trunk runtime before the baseline")]);
  const license = () => ({
    trunkService: (({ status, editingConnectionsLimit, nodesLimit, expiresAt }) => ({ status, editingConnectionsLimit, nodesLimit, expiresAt }))(sdk.trunk.license),
    worktreeService: (({ status, editingConnectionsLimit }) => ({ status, editingConnectionsLimit }))(sdk.worktree.license),
    trunkEndpoint: (({ limit, used, remaining }) => ({ limit, used, remaining }))(sdk.endpoint.license.editingConnections),
    otherEndpointsUsed: tally([...captured.endpoint].slice(1).map(endpoint => endpoint.license.editingConnections.used)),
  });
  const usage = () => {
    global.gc();
    global.gc();
    return process.memoryUsage();
  };
  const sample = async population => {
    const started = performance.now();
    let previous, current = usage();
    // Worker threads boot in the background, so read rss only once it stops moving.
    for (let tries = 0; tries < 30 && (!previous || Math.abs(current.rss - previous.rss) > 4 * 2 ** 20); tries++) {
      await sleep(1000);
      [previous, current] = [current, usage()];
    }
    const { rss, heapUsed, external } = current;
    const heaps = await Promise.all([...workers].map(worker => worker.getHeapStatistics().catch(() => null)));
    return {
      population, rss, heapUsed, external, settleMs: performance.now() - started,
      workerThreads: workers.size, workerHeapUsed: heaps.reduce((sum, heap) => sum + (heap?.used_heap_size ?? 0), 0), workerHeapTotal: heaps.reduce((sum, heap) => sum + (heap?.total_heap_size ?? 0), 0),
      draftServices: sdk.worktree._draftServices?.size ?? null, scopedEndpoints: sdk.worktreeEndpoint._scopedEndpoints?.size ?? null,
    };
  };
  const slopes = samples => Object.fromEntries(["rss", "heapUsed", "external", "workerThreads", "workerHeapUsed", "workerHeapTotal"].map(key => [key, slope(samples.map(s => [s.population, s[key]]))]));
  result.license = { beforeDraftEdits: license() };
  for (const variant of ["idle", "active"]) {
    const samples = [];
    let created = 0;
    for (const population of populations) {
      while (created < population) {
        const worktreeId = await teamWorktree(E1, S);
        const unit = await addTrunkUnit(E1, worktreeId, shared);
        if (variant === "active") await draft(E1, worktreeId, unit, [cell(shared, created % ROWS, 0, `memory-${created}`)]);
        created++;
      }
      samples.push(await sample(population));
      log(`memory ${variant} K=${population} rss=${Math.round(samples.at(-1).rss / 2 ** 20)} MiB`);
    }
    result[variant] = { samples, bytesPerWorktree: slopes(samples), bytesPerWorktreeFromK1: slopes(samples.filter(s => s.population >= 1)) };
    save();
  }
  result.license.afterDraftEdits = license();
  if (flags["idle-wait"] > 0) {
    log(`memory waiting ${flags["idle-wait"]} s for idle draft services`);
    await sleep(flags["idle-wait"] * 1000);
    result.afterIdleWait = { seconds: flags["idle-wait"], ...(await sample(populations.at(-1))), license: license() };
  }
}

async function restore({ directory, fail, result }) {
  result.capturedAtInitialize = await boot(directory);
  const { H, E1, E2, V, S } = await team();
  const claim = recorder(result, fail);
  const restoreAt = (actor, target, revision, base) => ({ ...changeset(actor, target, [restoreTo(target, revision)]), baseRev: base, revision: base + 1 });
  async function restored(actor, target, revision, base) {
    const value = restoreAt(actor, target, revision, base ?? await head(target.unitId, target.type));
    requiredPermissions = [];
    const submitted = await submitTrunk(actor, value);
    const requiredUnitPermissions = requiredPermissions.splice(0);
    target.head = await head(target.unitId, target.type);
    return { restoreTo: revision, baseRev: value.baseRev, submitted, headAfter: target.head, requiredUnitPermissions };
  }

  const A = await sheet(H, S, "Restore after merge");
  const mergeA = await landed(E1, S, A, [cell(A, 10, 1, "merged-1"), cell(A, 11, 1, "merged-2")]);
  await claim("restore-after-merge", "A Sheet restore to the revision before a Worktree merge appends one Trunk revision whose content equals the pre-merge content, and Trunk history keeps the merge and the restore (plan 2.1, spec 6.7)", async () => {
    const preMerge = await trunkData(A, mergeA.preMergeHead), before = await trunkData(A);
    const restore = await restored(E2, A, mergeA.preMergeHead);
    const after = await trunkData(A), history = await trunkHistory(A, mergeA.preMergeHead);
    const observed = { merge: mergeA, restore, revisions: { preMerge: preMerge.revision, beforeRestore: before.revision, afterRestore: after.revision }, mergedValueAfter: await trunkHas(A, "merged-2"), differencesFromPreMerge: differences(preMerge.data, after.data), differencesFromBeforeRestore: differences(before.data, after.data), history };
    return { verdict: verdict(restore.submitted.status === "committed" && after.revision === before.revision + 1 && material(observed.differencesFromPreMerge).length === 0 && history.length === 2 && history[0].memberID === "worktree-merge" && history[1].mutations.join() === RevertRevisionMutation.id), observed };
  });

  const B = await sheet(H, S, "Restore over a later edit");
  const mergeB = await landed(E1, S, B, [cell(B, 10, 1, "merged")]);
  await trunk(E2, B, [cell(B, 20, 2, "later-edit")]);
  await claim("restore-overwrites-later-edit", "Restoring to the pre-merge revision after another member edited the Unit also removes that later edit, because a restore replaces the whole Unit (plan 2.4)", async () => {
    const preMerge = await trunkData(B, mergeB.preMergeHead);
    const restore = await restored(H, B, mergeB.preMergeHead);
    const observed = { merge: mergeB, restore, laterEditAfter: await trunkHas(B, "later-edit"), mergedValueAfter: await trunkHas(B, "merged"), differencesFromPreMerge: differences(preMerge.data, (await trunkData(B)).data), history: await trunkHistory(B, mergeB.preMergeHead) };
    return { verdict: verdict(restore.submitted.status === "committed" && observed.laterEditAfter === null && observed.mergedValueAfter === null && material(observed.differencesFromPreMerge).length === 0), observed };
  });

  for (const [kind, make, edit] of [["sheet", sheet, (target, value, row) => cell(target, row, 0, value)], ["doc", doc, (target, value) => docInsert(target, value)]]) {
    const T = await make(H, S, `Concurrent ${kind}`);
    await trunk(H, T, [edit(T, "first ", 3)]);
    const goal = T.head;
    await trunk(H, T, [edit(T, "second ", 4)]);
    const stale = T.head;
    await trunk(E1, T, [edit(T, "concurrent ", 5)]);
    await claim(`restore-stale-base-${kind}`, kind === "sheet"
      ? "A Sheet restore submitted at a stale base revision, after another edit landed, is transformed and commits like an ordinary edit at the same base (plan 2.1: Sheets have a restore transform)"
      : "A Doc restore submitted at a stale base revision, after another edit landed, does not commit, and the same restore resubmitted at head commits (plan 2.4: no Doc restore transform, submit at head and retry)", async () => {
      const ordinaryAtStaleBase = await submitTrunk(E2, { ...changeset(E2, T, [edit(T, "ordinary ", 8)]), baseRev: stale, revision: stale + 1 });
      const goalData = await trunkData(T, goal), headData = await trunkData(T);
      const restore = await restored(E2, T, goal, stale);
      const afterStale = await trunkData(T);
      const atHead = restore.submitted.status === "committed" ? null : await restored(E2, T, goal);
      const after = await trunkData(T);
      const observed = { goal, staleBase: stale, ordinaryAtStaleBase, headBefore: headData.revision, restore, differencesFromGoalAfterStale: differences(goalData.data, afterStale.data), differencesFromHeadBeforeAfterStale: differences(headData.data, afterStale.data), atHead, differencesFromGoalAfterAll: differences(goalData.data, after.data), history: await trunkHistory(T, goal) };
      if (ordinaryAtStaleBase.status !== "committed") return { verdict: "INCONCLUSIVE", reason: "an ordinary edit at the same stale base did not commit either", observed };
      return { verdict: verdict(kind === "sheet" ? restore.submitted.status === "committed" : restore.submitted.status !== "committed" && afterStale.revision === headData.revision && atHead?.submitted.status === "committed"), observed };
    });
    await trunk(H, T, [edit(T, "third ", 6)]);
    const base = T.head;
    await claim(`stale-edit-over-restore-${kind}`, `An ordinary ${kind} edit submitted at the base revision a restore just replaced commits on top of the restored content`, async () => {
      const goalData = await trunkData(T, goal);
      const restore = await restored(H, T, goal, base);
      const late = await submitTrunk(E1, { ...changeset(E1, T, [edit(T, "late ", 7)]), baseRev: base, revision: base + 1 });
      const after = await trunkData(T);
      const observed = { goal, base, restore, late, headAfter: after.revision, differencesFromGoal: differences(goalData.data, after.data), history: await trunkHistory(T, base) };
      return { verdict: verdict(restore.submitted.status === "committed" && late.status === "committed"), observed };
    });
  }

  const R = await sheet(H, S, "Resubmit a restore");
  await trunk(H, R, [cell(R, 0, 0, "kept")]);
  const goalR = R.head;
  await trunk(H, R, [cell(R, 1, 0, "restored away")]);
  await claim("restore-resubmit", "Resubmitting a restore changeset with the same sid and reqId after it applied does not apply it again (plan 2.3: deduplicated or refused)", async () => {
    const value = { ...restoreAt(E2, R, goalR, await head(R.unitId)), sid: `revert-operation-${randomUUID()}`, reqId: 1 };
    const first = await submitTrunk(E2, value);
    const afterFirst = await head(R.unitId);
    const identical = await submitTrunk(E2, value);
    const afterIdentical = await head(R.unitId);
    R.head = afterIdentical;
    await trunk(E1, R, [cell(R, 2, 0, "edit after the restore")]);
    const afterLaterEdit = R.head;
    const identicalAfterLaterEdit = await submitTrunk(E2, value);
    const sameIdsAtHead = await submitTrunk(E2, { ...value, baseRev: afterLaterEdit, revision: afterLaterEdit + 1 });
    await app.close();
    app = undefined;
    result.capturedAfterRestart = await boot(directory);
    const identicalAfterRestart = await submitTrunk(E2, value);
    const afterRetries = await head(R.unitId);
    const laterEditKept = await trunkHas(R, "edit after the restore");
    const nextReqId = await submitTrunk(E2, { ...value, reqId: 2, baseRev: afterRetries, revision: afterRetries + 1 });
    const observed = { goal: goalR, sid: value.sid, first, afterFirst, identical, afterIdentical, afterLaterEdit, identicalAfterLaterEdit, sameIdsAtHead, identicalAfterRestart, afterRetries, laterEditKept, nextReqIdControl: { ...nextReqId, laterEditAfter: await trunkHas(R, "edit after the restore") }, history: await trunkHistory(R, goalR) };
    return { verdict: verdict(first.status === "committed" && afterIdentical === afterFirst && identicalAfterRestart.status === "already-committed" && afterRetries === afterLaterEdit && laterEditKept !== null), observed };
  });

  const D = await doc(H, S, "Restore a Doc");
  const mergeD = await landed(E1, S, D, [docInsert(D, "merged ")]);
  await claim("restore-doc-after-merge", "A Doc restore to the revision before a Worktree merge appends one Trunk revision whose content equals the pre-merge content", async () => {
    const preMerge = await trunkData(D, mergeD.preMergeHead), before = await trunkData(D);
    const restore = await restored(E2, D, mergeD.preMergeHead);
    const after = await trunkData(D);
    const observed = { merge: mergeD, restore, dataStream: { preMerge: preMerge.data.body?.dataStream, beforeRestore: before.data.body?.dataStream, afterRestore: after.data.body?.dataStream }, revisions: { preMerge: preMerge.revision, beforeRestore: before.revision, afterRestore: after.revision }, differencesFromPreMerge: differences(preMerge.data, after.data), history: await trunkHistory(D, mergeD.preMergeHead) };
    return { verdict: verdict(restore.submitted.status === "committed" && after.revision === before.revision + 1 && material(observed.differencesFromPreMerge).length === 0), observed };
  });

  const P = await sheet(H, S, "Protected range");
  const unprotected = P.head;
  const rule = (await ok("POST", "/universer-api/authz/3/object", H, { objectType: 3, selectRangeObject: { unitID: P.unitId, name: "B2", collaborators: [], scope: { read: 1, edit: 2 } } })).body.objectID;
  await trunk(H, P, [{ id: "sheet.mutation.add-range-protection", data: JSON.stringify({ unitId: P.unitId, subUnitId: P.sheetId, rules: [{ id: "protected-b2", permissionId: rule, unitId: P.unitId, subUnitId: P.sheetId, unitType: 3, ranges: [{ startRow: 1, endRow: 1, startColumn: 1, endColumn: 1 }], viewState: "othersCanView", editState: "onlyMe" }] }) }]);
  const protectedAt = P.head;
  requiredPermissions = [];
  const directB2 = { ...(await submitTrunk(E2, changeset(E2, P, [cell(P, 1, 1, "editor-two-b2")]))), requiredUnitPermissions: requiredPermissions.splice(0) };
  await trunk(E1, P, [cell(P, 0, 0, "unprotected-later")]);
  await claim("restore-protected-untouched", "A restore by an editor who may not edit a protected range commits when the restored content leaves that range unchanged", async () => {
    const restore = await restored(E2, P, protectedAt);
    return { verdict: verdict(directB2.status !== "committed" && restore.submitted.status === "committed"), observed: { rule, protectedAt, directB2ByEditorTwo: directB2, restore, a1After: await trunkHas(P, "unprotected-later") } };
  });
  const restorePoint = P.head;
  await trunk(H, P, [cell(P, 1, 1, "owner-b2")]);
  await trunk(E1, P, [cell(P, 0, 0, "unprotected-again")]);
  await claim("restore-protected-range", "A restore that would change a protected range the submitter may not edit is refused whole by the product's commitChangeset middleware, and the same restore by the range owner commits (plan 2.4 inference)", async () => {
    const byViewer = await restored(V, P, restorePoint);
    const headBefore = await head(P.unitId);
    const byEditor = await restored(E2, P, restorePoint);
    const afterEditor = { head: await head(P.unitId), b2: await trunkHas(P, "owner-b2"), a1: await trunkHas(P, "unprotected-again") };
    const byOwner = await restored(H, P, restorePoint);
    const afterOwner = { head: await head(P.unitId), b2: await trunkHas(P, "owner-b2"), a1: await trunkHas(P, "unprotected-again") };
    const observed = { restorePoint, byViewer, headBefore, byEditor, afterEditor, byOwner, afterOwner };
    if (byViewer.submitted.status === "committed") return { verdict: "INCONCLUSIVE", reason: "the product middleware let a viewer restore, so it did not run", observed };
    return { verdict: verdict(byEditor.submitted.status !== "committed" && afterEditor.head === headBefore && afterEditor.a1 !== null && byOwner.submitted.status === "committed" && afterOwner.b2 === null), observed };
  });
  await claim("restore-removes-protection", "A restore by an editor to a revision before the range protection existed, which would remove the rule, is refused", async () => {
    const protection = async () => Object.fromEntries(Object.entries((await trunkData(P)).data.resources).filter(([name]) => name.includes("PROTECTION")));
    const protectionBefore = await protection();
    const byEditor = await restored(E2, P, unprotected);
    const protectionAfter = await protection();
    const directB2After = await submitTrunk(E2, changeset(E2, P, [cell(P, 1, 1, "editor-two-b2-after-restore")]));
    return { verdict: verdict(byEditor.submitted.status !== "committed"), observed: { unprotected, protectionBefore, byEditor, protectionAfter, directB2ByEditorTwoAfter: { ...directB2After, valueOnTrunk: await trunkHas(P, "editor-two-b2-after-restore") } } };
  });

  const Q = await sheet(H, S, "Find the pre-merge revision");
  const firstMerge = await landed(E1, S, Q, [cell(Q, 10, 1, "w1-a"), cell(Q, 11, 1, "w1-b"), cell(Q, 12, 1, "w1-c")]);
  await trunk(H, Q, [cell(Q, 0, 0, "between the merges")]);
  const secondMerge = await landed(E2, S, Q, [cell(Q, 13, 1, "w2")]);
  await claim("pre-merge-revision", "Public reads give, per Unit, the Trunk revision before a Worktree merge: each merge is one Trunk revision at mergeResult.trunkRevision, so the restore target is the set's first trunkRevision - 1, and the revisions after it name every later author (plan 2.3)", async () => {
    const history = await trunkHistory(Q, firstMerge.preMergeHead);
    const set = new Map([firstMerge, secondMerge].map(merge => [merge.sdkResult.trunkRevision, merge.worktreeId]));
    const merges = history.filter(record => record.memberID === "worktree-merge");
    const observed = {
      firstMerge, secondMerge, history,
      restoreTarget: Math.min(...set.keys()) - 1,
      laterAuthors: history.filter(record => !set.has(record.revision)).map(({ revision, userID, memberID }) => ({ revision, userID, memberID })),
      mergeSids: merges.map(record => ({ revision: record.revision, sid: record.sid, reqId: record.reqId, worktreeId: set.get(record.revision), sidContainsWorktreeId: Boolean(record.sid?.includes(set.get(record.revision))) })),
    };
    return { verdict: verdict([firstMerge, secondMerge].every(merge => merge.sdkResult.trunkRevision === merge.preMergeHead + 1) && merges.length === set.size && merges.every(record => set.has(record.revision)) && observed.restoreTarget === firstMerge.preMergeHead), observed };
  });

  const L = await sheet(H, S, "Restore limits");
  const created = L.head;
  await trunk(H, L, [cell(L, 0, 0, "l-1")]);
  await trunk(H, L, [cell(L, 0, 0, "l-2")]);
  await claim("restore-limits", "The SDK accepts a restore changeset only alone and only for a revision between 1 and its base revision (plan finding 1, read from minified code)", async () => {
    const at = async build => {
      const base = await head(L.unitId);
      return { base, ...(await submitTrunk(E2, { ...changeset(E2, L, build(base)), baseRev: base, revision: base + 1 })) };
    };
    const mixed = await at(base => [restoreTo(L, base - 1), cell(L, 5, 0, "mixed")]);
    const zero = await at(() => [restoreTo(L, 0)]);
    const atBase = await at(base => [restoreTo(L, base)]);
    const future = await at(base => [restoreTo(L, base + 1)]);
    const createdData = await trunkData(L, created);
    const toCreation = await restored(E2, L, created);
    const observed = { created, mixed, zero, atBase, future, toCreation, differencesFromCreation: differences(createdData.data, (await trunkData(L)).data), history: await trunkHistory(L, created) };
    return { verdict: verdict(mixed.status !== "committed" && zero.status !== "committed" && future.status !== "committed" && toCreation.submitted.status === "committed"), observed };
  });
  await claim("restore-in-worktree-draft", "A restore changeset submitted to a Worktree draft through the product HTTP route is accepted, and merging the Worktree lands the restore on Trunk", async () => {
    const worktreeId = await teamWorktree(E1, S);
    const unit = await addTrunkUnit(E1, worktreeId, L);
    const response = await http("POST", `/api/worktrees/${worktreeId}/units/${L.unitId}/changesets`, E1, { changeset: changeset(E1, unit, [restoreTo(L, created + 1)]) });
    const observed = { worktreeId, baseline: unit.head, restoreTo: created + 1, draftSubmit: { status: response.status, body: response.body } };
    if (response.status !== 200 || response.body.status !== "committed") return { verdict: "REFUTED", observed };
    const ready = await http("POST", `/api/worktrees/${worktreeId}/ready`, E1), merge = await http("POST", `/api/worktrees/${worktreeId}/merge`, E1);
    Object.assign(observed, { ready: ready.status, merge: { status: merge.status, error: merge.body?.error }, sdkResult: (await sdkUnit(worktreeId, L.unitId))?.mergeResult, l1OnTrunk: await trunkHas(L, "l-1") });
    return { verdict: verdict(observed.sdkResult?.status === "merged" && observed.l1OnTrunk !== null), observed };
  });
}

const outputFile = resolve(flags.output);
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const report = {
  schemaVersion: 1, startedAt: new Date().toISOString(),
  scriptSha256: createHash("sha256").update(readFileSync(new URL(import.meta.url))).digest("hex"),
  gitHead: git("rev-parse", "HEAD"), gitDirty: git("status", "--porcelain").length > 0,
  nodeVersion: process.version, cpuCount: cpus().length, cpuModel: cpus()[0]?.model, loadAverageAtStart: loadavg(),
  flags, license: process.env.UNIVER_LICENSE ? "environment" : "bundled", scenarios: {},
};
const save = () => writeFileSync(outputFile, JSON.stringify(report, null, 2) + "\n");
const scenarios = { claims, behind, coldload, memory, restore };
for (const name of flags.scenario === "all" ? Object.keys(scenarios) : [flags.scenario]) {
  const result = { errors: 0, errorDetails: [] };
  report.scenarios[name] = result;
  const fail = (where, error) => {
    result.errors++;
    result.errorDetails.push({ where, message: error?.message ?? String(error) });
    log(`ERROR ${where}: ${error?.stack ?? error}`);
  };
  const directory = mkdtempSync(join(tmpdir(), `worktree-sdk-${name}-`));
  const started = performance.now();
  log(`scenario ${name} in ${directory}`);
  try {
    await scenarios[name]({ directory, fail, result, save });
  } catch (error) {
    fail(name, error);
  } finally {
    try { await app?.close(); } catch (error) { fail(`${name} close`, error); }
    app = undefined;
    rmSync(directory, { recursive: true, force: true });
    result.durationMs = performance.now() - started;
    save();
  }
}
report.errors = Object.values(report.scenarios).reduce((sum, scenario) => sum + scenario.errors, 0);
report.finishedAt = new Date().toISOString();
save();
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.errors ? 1 : 0;
