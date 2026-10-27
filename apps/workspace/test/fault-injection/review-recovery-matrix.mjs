// Dedicated child Servers + disk SQLite + real SDK. Hooks only stop execution;
// they never replace a result, Adapter write, snapshot, ACL, or SDK method body.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { writeSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { JSONX, TextXActionType } = require("@univerjs/core");
const { SQLiteDatabaseAdapter } = require("@univerjs-pro/collaboration-database-sqlite");
const {
  SQLiteWorktreeDatabaseAdapter,
} = require("@univerjs-pro/collaboration-worktree-database-sqlite");
const production = process.env.TASK010S_PRODUCTION === "1";
const source = production ? "../../dist/server/" : "../../server/src/";
const extension = production ? "js" : "ts";
const scenarios = [
  ["before-intent", 1],
  ["intent", 1],
  ["merging", 1],
  ["commit", 1],
  ["partial", 2],
  ["merged", 1],
  ["processed", 1],
  ["commit", 2],
  ["merging", 1, "compete"],
  ["partial", 2, "compete"],
  ["commit", 2, "compete"],
  ["intent", 1, "compete"],
  ["intent", 1, "revoke"],
  ["commit", 1, "post-commit-compete"],
  ["merging", 1, "revoke"],
  ["commit", 1, "revoke"],
  ["partial", 2, "revoke"],
  ["merging", 2, "race"],
  ["merging", 1, "bad-proof"],
  ["commit", 1, "none", "doc"],
  ["commit", 1, "none", "local"],
  ["merging", 1, "legacy"],
  ["partial", 2, "legacy"],
  ["commit", 2, "legacy"],
  ["commit", 1, "legacy"],
  ["intent", 1, "legacy"],
  ["commit", 1, "none", "behind"],
  ["commit", 2, "rekill"],
  ["commit", 1, "missing-history"],
  ["intent", 1, "supersede"],
  ["partial", 2, "compete", "mixed"],
  ["partial", 1, "compete", "removed"],
  ["merged", 1, "compete", "removed"],
];
async function request(origin, path, cookie, body, key) {
  const response = await fetch(origin + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      cookie,
      "content-type": "application/json",
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}
if (process.argv[2] === "--child") {
  const [directory, phase, count, variant = "sheet"] = process.argv.slice(3);
  const { createWorkspaceApplication } = await import(source + `app.${extension}`);
  let state;
  const resuming = phase.startsWith("resume");
  const stop = () => {
    writeSync(1, `FAULT:STOP ${phase}\n`);
    process.kill(process.pid, "SIGSTOP");
  };
  if (!resuming) {
    const { WorktreesRepository } = await import(
      source + `modules/worktrees/worktrees.repository.${extension}`
    );
    const validated = WorktreesRepository.prototype.markReviewValidated;
    WorktreesRepository.prototype.markReviewValidated = function (...args) {
      if (phase === "before-intent") stop();
      const result = validated.apply(this, args);
      if (phase === "intent") stop();
      return result;
    };
    const complete = WorktreesRepository.prototype.completeOperation;
    WorktreesRepository.prototype.completeOperation = function (...args) {
      if (phase === "processed" && this.getOperation(args[0])?.kind === "merge_worktree") stop();
      return complete.apply(this, args);
    };
    const { UniverCollabWorktreeService } = require("@univerjs-pro/collaboration-worktree-service");
    const merge = UniverCollabWorktreeService.prototype.mergeWorktree;
    UniverCollabWorktreeService.prototype.mergeWorktree = function (...args) {
      if (args[1]?.userID !== state?.actorId) return merge.apply(this, args);
      const observers = [
        this.on("worktreeStatusChanged", (event) => {
          if (
            (phase === "merging" && event.status === "merging") ||
            (phase === "merged" && event.status === "merged")
          )
            stop();
        }),
        this.on("worktreeUnitMergeResultRecorded", () => {
          if (phase === "partial") stop();
        }),
      ];
      return merge
        .apply(this, args)
        .finally(() => observers.forEach((observer) => observer.dispose()));
    };
    const { UniverCollabService } = require("@univerjs-pro/collaboration-service");
    const submit = UniverCollabService.prototype.submitChangeset;
    UniverCollabService.prototype.submitChangeset = async function (...args) {
      const result = await submit.apply(this, args);
      if (
        phase === "commit" &&
        args[1]?.userID === state?.actorId &&
        args[1]?.customData?.reviewJournal &&
        result.status === "committed"
      )
        stop();
      return result;
    };
    const create = UniverCollabService.prototype.createUnitFromSnapshot;
    UniverCollabService.prototype.createUnitFromSnapshot = async function (...args) {
      const result = await create.apply(this, args);
      if (phase === "commit" && variant === "local" && args[1]?.customData?.reviewJournal) stop();
      return result;
    };
  }
  if (phase === "resume-reconcile") {
    const record = SQLiteWorktreeDatabaseAdapter.prototype.recordUnitMergeResult;
    SQLiteWorktreeDatabaseAdapter.prototype.recordUnitMergeResult = async function (...args) {
      const result = await record.apply(this, args);
      stop();
      return result;
    };
  }
  const app = createWorkspaceApplication({
    host: "127.0.0.1",
    port: 0,
    databaseFilename: join(directory, "product.sqlite"),
    collaborationDatabaseFilename: join(directory, "collaboration.sqlite"),
    secureCookies: false,
    sessionTtlMs: 3600000,
  });
  let control;
  const server = createServer((req, res) => {
    if (req.url !== "/fault/control") {
      app.app(req, res);
      return;
    }
    let input = "";
    req.on("data", (bytes) => {
      input += bytes;
    });
    req.on("end", () =>
      control(JSON.parse(input))
        .then((value) => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(value));
        })
        .catch((error) => {
          console.error(error);
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: error.message }));
        }),
    );
  });
  app.attachWebSocket(server);
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function draft(actorId, cookie, resources, column, value) {
    const tree = (
      await app.worktrees.create(actorId, crypto.randomUUID(), {
        kind: "user",
        name: value,
        summary: null,
      })
    ).body.id;
    const units = [];
    for (let index = 0; index < resources.length; index++) {
      const input = resources[index]
        ? { source: "trunk", resourceId: resources[index] }
        : {
            source: "worktree",
            name: "New reviewed Sheet",
            unitType: "sheet",
            targetSpaceId: state.spaceId,
            targetParentNodeId: null,
          };
      const added = await app.worktrees.addUnit(actorId, tree, crypto.randomUUID(), input);
      const unit = added.body.unit.unitId;
      const comparison = await request(
        origin,
        `/universer-api/worktrees/${tree}/units/${unit}/comparison`,
        cookie,
      );
      assert.equal(comparison.status, 200);
      const data = comparison.body.right.unitData,
        revision = comparison.body.right.revision;
      const doc = Boolean(data.body),
        sheet = data.sheetOrder?.[0];
      const mutation = doc
        ? {
            id: "doc.mutation.rich-text-editing",
            data: JSON.stringify({
              unitId: unit,
              actions: JSONX.getInstance().editOp([
                { t: TextXActionType.INSERT, body: { dataStream: value }, len: value.length },
              ]),
            }),
          }
        : {
            id: "sheet.mutation.set-range-values",
            data: JSON.stringify({
              unitId: unit,
              subUnitId: sheet,
              cellValue: { 0: { [column]: { v: value + index, t: 1 } } },
            }),
          };
      const submit = await app.worktrees.submitChangeset(actorId, tree, unit, {
        changeset: {
          unitID: unit,
          type: doc ? 1 : 2,
          baseRev: revision,
          revision: revision + 1,
          sid: crypto.randomUUID(),
          reqId: 1,
          mutations: [mutation],
        },
      });
      assert.equal(submit.status, "committed");
      units.push({ unit, sheet, resourceId: added.body.unit.resourceId, doc, local: input.source === "worktree" });
    }
    if (variant === "removed" && actorId === state.actorId)
      await app.worktrees.setUnitRemoved(actorId, tree, units[0].unit, { removed: true });
    await app.worktrees.markReady(actorId, tree);
    if (variant === "behind" && actorId === state.actorId) {
      const other = await draft(state.ownerId, state.ownerCookie, resources, 1, "earlier-");
      assert.equal(
        (
          await request(
            origin,
            `/api/worktrees/${other.tree}/merge`,
            state.ownerCookie,
            { reviewToken: other.reviewToken },
            crypto.randomUUID(),
          )
        ).status,
        200,
      );
    }
    const review = await request(origin, `/universer-api/worktrees/${tree}/review`, cookie, {});
    assert.equal(review.status, 200);
    return { tree, units, reviewToken: review.body.reviewToken };
  }
  if (!resuming) {
    const owner = await app.identity.registerWithPassword({
      username: "fault-owner",
      displayName: "Owner",
      password: "disposable-fault-test-password",
    });
    const actor = await app.identity.registerWithPassword({
      username: "fault-editor",
      displayName: "Editor",
      password: "disposable-fault-test-password",
    });
    const ownerId = owner.view.user.id,
      actorId = actor.view.user.id;
    const space = app.spaces.createTeamSpace(ownerId, { name: "Isolated fault database" });
    app.permissions.upsertTeamMember(ownerId, space.id, actorId, { role: variant === "removed" ? "admin" : "editor" });
    state = {
      ownerId,
      actorId,
      spaceId: space.id,
      cookie: `${app.identity.cookieName}=${actor.cookieValue}`,
      ownerCookie: `${app.identity.cookieName}=${owner.cookieValue}`,
      key: crypto.randomUUID(),
    };
    const resources = [];
    for (let index = 0; index < Number(count); index++) {
      if (variant === "local" || (variant === "mixed" && index === 0)) {
        resources.push(null);
        continue;
      }
      const result = await app.resources.create(ownerId, crypto.randomUUID(), {
        kind: "univer",
        spaceId: space.id,
        parentNodeId: null,
        name: "Fault document " + index,
        unitType: variant === "doc" ? "doc" : "sheet",
      });
      assert.equal(result.status, 201);
      resources.push(result.body.node.resource.id);
    }
    Object.assign(state, await draft(actorId, state.cookie, resources, 0, "accepted-"));
    const adapter = new SQLiteWorktreeDatabaseAdapter({
      filename: join(directory, "collaboration.sqlite"),
    });
    state.sid = (
      await adapter.getWorktree({ userID: actorId, customData: {} }, state.tree)
    ).worktree.sid;
    await adapter.dispose();
    await writeFile(join(directory, "private.json"), JSON.stringify(state), { mode: 0o600 });
  } else state = JSON.parse(await readFile(join(directory, "private.json"), "utf8"));
  // Test-only controls are bound only on this ephemeral loopback child.
  control = async (body) => {
    if (body.action === "revoke")
      app.permissions.removeTeamMember(state.ownerId, state.spaceId, state.actorId);
    if (body.action === "restore")
      app.permissions.upsertTeamMember(state.ownerId, state.spaceId, state.actorId, {
        role: "editor",
      });
    if (body.action === "compete" || body.action === "compete-first") {
      const other = await draft(
        state.ownerId,
        state.ownerCookie,
        [body.action === "compete-first" ? state.units[0].resourceId : state.units.at(-1).resourceId],
        1,
        "competing-",
      );
      const merged = await request(
        origin,
        `/api/worktrees/${other.tree}/merge`,
        state.ownerCookie,
        { reviewToken: other.reviewToken },
        crypto.randomUUID(),
      );
      assert.equal(merged.status, 200);
    }
    if (body.action === "legacy")
      app.database.connection
        .prepare(
          "UPDATE operations SET payload_json = json_remove(payload_json, '$.reviewProof') WHERE id = ?",
        )
        .run(state.key);
    if (body.action === "supersede") {
      const fresh = await request(origin, `/universer-api/worktrees/${state.tree}/review`, state.cookie, {});
      assert.equal(fresh.status, 200);
      const winner = await request(origin, `/api/worktrees/${state.tree}/merge`, state.cookie, { reviewToken: fresh.body.reviewToken }, crypto.randomUUID());
      assert.equal(winner.status, 200, JSON.stringify(winner));
    }
    if (body.action === "review-removal") {
      const fresh = await draft(
        state.actorId,
        state.cookie,
        [state.units[0].resourceId],
        0,
        "accepted-",
      );
      const result = await request(
        origin,
        `/api/worktrees/${fresh.tree}/merge`,
        state.cookie,
        { reviewToken: fresh.reviewToken },
        crypto.randomUUID(),
      );
      assert.equal(result.status, 200, JSON.stringify(result));
      assert.equal(app.trash.list(state.ownerId, state.spaceId, {}).items.length, 1);
      return { completed: result.body.operation.state === "completed" };
    }
    if (body.action === "missing-history") {
      const broken = new DatabaseSync(join(directory, "collaboration.sqlite"));
      try {
        broken
          .prepare("DELETE FROM collaboration_changesets WHERE unit_id = ? AND revision = 2")
          .run(state.units[0].unit);
      } finally {
        broken.close();
      }
    }
    if (body.action === "bad-proof")
      app.database.connection
        .prepare(
          `UPDATE operations SET payload_json = json_set(payload_json, '$.reviewProof.units[0].frozen', 'forged') WHERE id = ?`,
        )
        .run(state.key);
    if (body.action === "inspect") {
      const verification = await app.worktrees.create(state.ownerId, crypto.randomUUID(), {
        kind: "user",
        name: "Verification",
        summary: null,
      });
      const content = [];
      for (const unit of state.units) {
        await app.worktrees.addUnit(state.ownerId, verification.body.id, crypto.randomUUID(), {
          source: "trunk",
          resourceId: unit.resourceId,
        });
        const comparison = await request(
          origin,
          `/universer-api/worktrees/${verification.body.id}/units/${unit.unit}/comparison`,
          state.ownerCookie,
        );
        assert.equal(comparison.status, 200);
        content.push(comparison.body.left.unitData);
      }
      return { content };
    }
    const adapter = new SQLiteDatabaseAdapter({
      filename: join(directory, "collaboration.sqlite"),
    });
    const units = [];
    for (const unit of state.units) {
      const record = await adapter.getUnit({ userID: state.ownerId, customData: {} }, unit.unit);
      const changes = record
        ? await adapter.getChangesets({ userID: state.ownerId, customData: {} }, unit.unit, {
            from: 1,
          })
        : [];
      units.push({
        head: record?.headRevision ?? null,
        submissions: changes.filter((change) => change.sid === state.sid).length,
      });
    }
    await adapter.dispose();
    const row = app.database.connection
      .prepare("SELECT state, step, result_json FROM operations WHERE id = ?")
      .get(state.key);
    const data = await app.worktrees.get(state.actorId, state.tree);
    return { units, operation: row, state: data.worktree.state };
  };
  writeSync(1, `FAULT:READY ${origin}\n`);
  process.on("SIGTERM", async () => {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    await app.close();
    process.exit(0);
  });
} else {
  const evidence = resolve(process.env.SPACE_EVIDENCE_DIR);
  await mkdir(evidence, { recursive: true });
  const results = [];
  for (const [phase, count, negative = "none", variant = "sheet"] of scenarios.filter(
    (row) => !process.env.TASK010S_CASE || process.env.TASK010S_CASE.split(",").some(filter => row.join(":").includes(filter)),
  )) {
    const directory = await mkdtemp(join(tmpdir(), "task010s-"));
    let child;
    const label = `${phase}-${count}-${negative}-${variant}`;
    const timeout = (promise, message) =>
      Promise.race([
        promise,
        new Promise((_, reject) => {
          const timer = setTimeout(() => reject(Error(message)), 60000);
          timer.unref();
        }),
      ]);
    function boot(mode) {
      child = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          fileURLToPath(import.meta.url),
          "--child",
          directory,
          mode,
          String(count),
          variant,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let buffer = "",
        ready,
        stopped,
        rejectReady,
        rejectStop;
      const started = new Promise((done, reject) => {
        ready = done;
        rejectReady = reject;
      });
      const stop = new Promise((done, reject) => {
        stopped = done;
        rejectStop = reject;
      });
      // A failed boot must reject both waiters without an unhandled rejection.
      stop.catch(() => {});
      child.stdout.on("data", (bytes) => {
        buffer += bytes;
        for (;;) {
          const at = buffer.indexOf("\n");
          if (at < 0) break;
          const line = buffer.slice(0, at);
          buffer = buffer.slice(at + 1);
          if (line.startsWith("FAULT:READY ")) ready(line.slice(12));
          if (line.startsWith("FAULT:STOP ")) {
            writeSync(1, `${label}: ${line}\n`);
            stopped();
          }
        }
      });
      child.stderr.on("data", (bytes) => process.stderr.write(bytes));
      child.once("exit", (code, signal) => {
        const error = Error(`Child exit ${code}/${signal}`);
        rejectReady(error);
        rejectStop(error);
      });
      return { ready: timeout(started, label + " boot timeout"), stopped: stop };
    }
    async function kill() {
      if (!child || child.exitCode !== null || child.signalCode !== null) return;
      const exiting = new Promise((done) => child.once("exit", done));
      child.kill("SIGKILL");
      await exiting;
    }
    try {
      const first = boot(phase),
        origin = await first.ready;
      const killedPid = child.pid;
      const state = JSON.parse(await readFile(join(directory, "private.json"), "utf8"));
      const path = `/api/worktrees/${state.tree}/merge`,
        body = { reviewToken: state.reviewToken };
      const applying = request(origin, path, state.cookie, body, state.key).catch(() => null);
      await timeout(first.stopped, label + " injection timeout");
      await kill();
      await applying;
      const recovery = boot(negative === "rekill" ? "resume-reconcile" : "resume");
      let restarted = await recovery.ready;
      const recoveryPid = child.pid;
      assert.notEqual(killedPid, recoveryPid);
      const control = (action) =>
        request(restarted, "/fault/control", state.ownerCookie, { action });
      const before = (await control("state")).body;
      if (
        [
          "compete",
          "revoke",
          "bad-proof",
          "post-commit-compete",
          "legacy",
          "missing-history", "supersede",
        ].includes(negative)
      )
        assert.equal(
          (await control(negative === "post-commit-compete" ? "compete" : negative)).status,
          200,
        );
      const preRetry = (await control("state")).body;
      let replay;
      if (negative === "rekill") {
        const retrying = request(restarted, path, state.cookie, body, state.key).catch(() => null);
        await timeout(recovery.stopped, "Recovery reconciliation injection timeout");
        await kill();
        await retrying;
        restarted = await boot("resume").ready;
        replay = await request(restarted, path, state.cookie, body, state.key);
      } else if (negative === "race") {
        const race = await Promise.all([
          request(restarted, path, state.cookie, body, state.key),
          request(restarted, path, state.cookie, body, state.key),
          request(restarted, path, state.cookie, body, crypto.randomUUID()),
        ]);
        assert.deepEqual(race.map((result) => result.status).sort(), [200, 200, 403]);
        replay = race[0];
      } else replay = await request(restarted, path, state.cookie, body, state.key);
      let after = (await control("state")).body;
      if (negative === "supersede") {
        assert.equal(replay.status, 409); assert.equal(after.state, "merged");
        assert.equal(after.operation.state, "failed"); assert.equal(after.operation.step, "superseded");
        assert.deepEqual(after.units, preRetry.units);
      } else if (variant === "removed") {
        assert.equal(replay.status, 409);
        assert.equal(after.state, "merged");
        assert.equal(after.operation.state, "failed");
        assert.deepEqual(after.units, preRetry.units);
        const content = (await control("inspect")).body.content[0];
        assert.equal(content.sheets[state.units[0].sheet].cellData[0][1].v, "competing-0");
        assert.equal((await control("review-removal")).body.completed, true);
        assert.equal((await request(restarted, path, state.cookie, body, state.key)).status, 409);
      } else if (["bad-proof", "missing-history"].includes(negative)) {
        assert.equal(replay.status, 409);
        assert.equal(after.state, "merging");
        assert.deepEqual(after.units, preRetry.units);
        assert.notEqual(after.operation.state, "completed");
      } else if (
        phase === "before-intent" ||
        negative === "compete" ||
        negative === "revoke" ||
        negative === "legacy"
      ) {
        assert.ok([403, 409].includes(replay.status), JSON.stringify(replay));
        assert.deepEqual(
          after.units,
          preRetry.units,
          "Rejected recovery must not add content commits",
        );
        assert.notEqual(after.operation.state, "completed");
        assert.equal(
          after.state,
          (negative === "revoke" && phase === "commit") ||
            (negative === "legacy" && phase === "commit" && count === 1)
            ? "merged"
            : "ready",
        );
        if (negative === "revoke") await control("restore");
        if (after.state === "ready") {
          let fresh = await request(
            restarted,
            `/universer-api/worktrees/${state.tree}/review`,
            state.cookie,
            {},
          );
          assert.equal(fresh.status, 200, JSON.stringify(fresh));
          if (variant === "mixed") {
            assert.equal((await control("compete-first")).status, 200);
            const stale = await request(restarted, path, state.cookie, { reviewToken: fresh.body.reviewToken }, crypto.randomUUID());
            assert.equal(stale.status, 409, "Review must bind the live trunk revision of an already activated Worktree-local Unit");
            fresh = await request(restarted, `/universer-api/worktrees/${state.tree}/review`, state.cookie, {});
            assert.equal(fresh.status, 200);
          }

          const newIntent = await request(
            restarted,
            path,
            state.cookie,
            { reviewToken: fresh.body.reviewToken },
            crypto.randomUUID(),
          );
          assert.equal(newIntent.status, 200, JSON.stringify(newIntent));
          const old = await request(restarted, path, state.cookie, body, state.key);
          assert.equal(old.status, 409, "Old failed intent must not steal a newer result");
        } else {
          assert.equal((await request(restarted, path, state.cookie, body, state.key)).status, 200);
        }
      } else {
        assert.equal(replay.status, 200, JSON.stringify(replay));
        assert.equal(after.state, "merged");
        assert.equal(after.operation.state, "completed");
      }
      if (!["bad-proof", "missing-history"].includes(negative) && variant !== "removed") {
        after = (await control("state")).body;
        assert.ok(
          after.units.every(
            (unit) =>
              unit.head ===
              (variant === "local" ? 1 : variant === "behind" ? 3 : 2) +
                (negative.includes("compete") && unit === after.units.at(-1) ? 1 : 0),
          ),
        );
        assert.ok(
          after.units.every((unit, index) => unit.submissions === (state.units[index].local ? 0 : 1)),
          "Each SDK merge submission commits exactly once",
        );
        const content = (await control("inspect")).body.content;
        for (let index = 0; index < content.length; index++) {
          if (variant === "doc") assert.ok(content[index].body.dataStream.includes("accepted-"));
          else
            assert.equal(
              content[index].sheets[state.units[index].sheet].cellData[0][0].v,
              "accepted-" + index,
            );
        }
        // A second fresh process must replay the completed exact intent without writes.
        const checkpoint = after.units;
        await kill();
        restarted = await boot("resume").ready;
        const finalKey = after.operation.state === "completed" ? state.key : undefined;
        if (finalKey)
          assert.equal((await request(restarted, path, state.cookie, body, finalKey)).status, 200);
        assert.deepEqual((await control("state")).body.units, checkpoint);
      }
      const result = {
        label,
        production,
        killedPid,
        recoveryPid,
        beforeUnits: before.units,
        retryUnits: preRetry.units,
        killed: phase,
        before: before.state,
        retryStatus: replay.status,
        after: after.state,
        operation: after.operation.state,
        units: after.units,
        passed: true,
      };
      results.push(result);
      console.log(JSON.stringify(result));
      await writeFile(
        join(evidence, "review-recovery-matrix.json"),
        JSON.stringify(results, null, 2),
      );
    } finally {
      await kill();
      await rm(directory, { recursive: true, force: true });
    }
  }
  assert.equal(results.length > 0, true);
  console.log(`PASS ${results.length} process-kill recovery cases`);
}
