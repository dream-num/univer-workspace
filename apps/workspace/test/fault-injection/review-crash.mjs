// Real HTTP/SQLite/SDK process-kill probe. No production SDK file is modified.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

if (process.argv[2] === '--child') {
  const directory = process.argv[3], crash = process.argv[4] === 'crash';
  const { createWorkspaceApplication } = await import('../../server/src/app.ts');
  if (crash) {
    // Observe the public status event after SDK persistence. The wrapper only
    // installs the observer and delegates to the real method, unchanged.
    const { UniverCollabWorktreeService } = createRequire(import.meta.url)('@univerjs-pro/collaboration-worktree-service');
    const merge = UniverCollabWorktreeService.prototype.mergeWorktree;
    UniverCollabWorktreeService.prototype.mergeWorktree = function (...args) {
      const observer = this.on('worktreeStatusChanged', event => {
        if (event.status === 'merging') {
          process.stdout.write('FAULT:MERGING\n');
          process.kill(process.pid, 'SIGSTOP');
        }
      });
      return merge.apply(this, args).finally(() => observer.dispose());
    };
  }
  const app = createWorkspaceApplication({ host: '127.0.0.1', port: 0, databaseFilename: join(directory, 'product.sqlite'), collaborationDatabaseFilename: join(directory, 'collaboration.sqlite'), secureCookies: false, sessionTtlMs: 3600000 });
  const server = createServer(app.app); app.attachWebSocket(server);
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  if (crash) {
    const actor = await app.identity.registerWithPassword({ username: 'crash-probe', displayName: 'Crash probe', password: 'disposable-fault-test-password' });
    const id = actor.view.user.id, space = app.spaces.list(id).spaces[0];
    const created = await app.resources.create(id, crypto.randomUUID(), { kind: 'univer', spaceId: space.id, parentNodeId: null, name: 'Crash probe', unitType: 'sheet' });
    const tree = await app.worktrees.create(id, crypto.randomUUID(), { kind: 'user', name: 'Crash probe', summary: null });
    const worktreeId = tree.body.id;
    const added = await app.worktrees.addUnit(id, worktreeId, crypto.randomUUID(), { source: 'trunk', resourceId: created.body.node.resource.id });
    const unit = added.body.unit.unitId, cookie = `${app.identity.cookieName}=${actor.cookieValue}`;
    const comparison = await (await fetch(`${origin}/universer-api/worktrees/${worktreeId}/units/${unit}/comparison`, { headers: { cookie } })).json();
    const sheet = comparison.right.unitData.sheetOrder[0], revision = comparison.right.revision;
    await app.worktrees.submitChangeset(id, worktreeId, unit, { changeset: { unitID: unit, type: 2, baseRev: revision, revision: revision + 1, sid: crypto.randomUUID(), reqId: 1, mutations: [{ id: 'sheet.mutation.set-range-values', data: JSON.stringify({ unitId: unit, subUnitId: sheet, cellValue: { 0: { 0: { v: 'reviewed-crash-proposal', t: 1 } } } }) }] } });
    await app.worktrees.markReady(id, worktreeId);
    const review = await (await fetch(`${origin}/universer-api/worktrees/${worktreeId}/review`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' })).json();
    const snapshotPath = `/universer-api/snapshot/2/unit/${unit}/rev/0`;
    const trunk = await fetch(origin + snapshotPath, { headers: { cookie } }); assert.equal(trunk.status, 200);
    await writeFile(join(directory, 'private.json'), JSON.stringify({ cookie, worktreeId, unit, sheet, reviewToken: review.reviewToken, key: crypto.randomUUID(), snapshotPath, trunkHash: fingerprint(await trunk.json()) }));
  }
  process.stdout.write('FAULT:READY ' + origin + '\n');
  process.on('SIGTERM', async () => { server.closeAllConnections(); await new Promise(done => server.close(done)); await app.close(); process.exit(0); });
} else {
  const directory = await mkdtemp(join(tmpdir(), 'space-review-crash-'));
  let child;
  const boot = mode => {
    child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), '--child', directory, mode], { stdio: ['ignore', 'pipe', 'pipe'] });
    let pending = '', ready, merging;
    const readyPromise = new Promise(done => { ready = done; });
    const mergingPromise = new Promise(done => { merging = done; });
    child.stdout.on('data', bytes => {
      pending += bytes;
      for (;;) {
        const at = pending.indexOf('\n'); if (at < 0) break;
        const line = pending.slice(0, at); pending = pending.slice(at + 1);
        if (line.startsWith('FAULT:READY ')) ready(line.slice(12));
        if (line === 'FAULT:MERGING') merging();
      }
    });
    child.stderr.on('data', bytes => process.stderr.write(bytes));
    const timeout = (promise, label) => Promise.race([promise, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error(label + ' timed out')), 30000); timer.unref(); })]);
    return { ready: timeout(readyPromise, 'Server boot'), merging: () => timeout(mergingPromise, 'SDK merging event') };
  };
  try {
    const first = boot('crash'), origin = await first.ready;
    const state = JSON.parse(await readFile(join(directory, 'private.json'), 'utf8'));
    const headers = { cookie: state.cookie, 'content-type': 'application/json', 'Idempotency-Key': state.key };
    const path = `/api/worktrees/${state.worktreeId}/merge`, body = JSON.stringify({ reviewToken: state.reviewToken });
    const request = fetch(origin + path, { method: 'POST', headers, body }).catch(() => null);
    await first.merging();
    const stopped = child; stopped.kill('SIGKILL'); await new Promise(done => stopped.once('exit', done)); await request;
    const restarted = await boot('resume').ready;
    const before = await (await fetch(restarted + `/api/worktrees/${state.worktreeId}`, { headers })).json();
    assert.equal(before.worktree.state, 'merging');
    const replay = await fetch(restarted + path, { method: 'POST', headers, body });
    const response = await replay.json();
    const after = await (await fetch(restarted + `/api/worktrees/${state.worktreeId}`, { headers })).json();
    const trunk = await fetch(restarted + state.snapshotPath, { headers }); assert.equal(trunk.status, 200);
    const trunkUnchanged = fingerprint(await trunk.json()) === state.trunkHash;
    const result = { carrier: 'actual SDK / HTTP / disk SQLite, SIGKILL at persisted merging status', before: before.worktree.state, replayStatus: replay.status, error: response.error?.message, after: after.worktree.state, trunkUnchanged, recovered: replay.ok && after.worktree.state === 'merged' };
    const output = resolve(process.env.SPACE_EVIDENCE_DIR); await mkdir(output, { recursive: true });
    await writeFile(join(output, 'review-crash-merging.json'), JSON.stringify(result, null, 2)); console.log(result);
    if (!result.recovered) assert.equal(trunkUnchanged, true, 'A rejected recovery must not publish unreviewed content');
    assert.equal(result.recovered, true, 'Release gate: an accepted merge must recover after a process crash');
    const comparison = await (await fetch(restarted + `/universer-api/worktrees/${state.worktreeId}/units/${state.unit}/comparison`, { headers })).json();
    assert.equal(comparison.left.unitData.sheets[state.sheet].cellData[0][0].v, 'reviewed-crash-proposal', 'Recovered trunk must match the approved proposal');
    assert.equal(trunkUnchanged, false, 'The accepted change must actually reach trunk');
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { const exiting = new Promise(done => child.once('exit', done)); child.kill('SIGKILL'); await exiting; }
    await rm(directory, { recursive: true, force: true });
  }
}
