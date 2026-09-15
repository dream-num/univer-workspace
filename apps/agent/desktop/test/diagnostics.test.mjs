import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDiagnostics, safeEvent, failureInfo } from '../src/diagnostics.cjs';

test('diagnostic snapshots and exports contain selected events, never credentials or raw errors', async t => {
  const root = await mkdtemp(join(tmpdir(), 'uwa-diagnostics-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const logs = join(root, 'logs');
  await mkdir(logs);
  await mkdir(join(root, 'data'));
  await writeFile(join(root, 'data', 'credentials.json'), 'must-not-read-account-data');
  await writeFile(join(logs, 'startup.log'), [
    JSON.stringify({ time: '2026-09-15T01:00:00Z', elapsedMs: 0, phase: 'start', token: 'secret-token' }),
    JSON.stringify({ time: '2026-09-15T01:00:01Z', elapsedMs: 1000, phase: 'backend-ready', error: 'ENOENT secret-path password=secret-password', stack: 'secret-stack' }),
    'incomplete-json',
  ].join('\n'));
  const state = { phase: 'download-error', percent: 42, version: '0.1.0-alpha.9',
    failure: { code: 'UPDATE_HTTP_ERROR', httpStatus: 503 }, notes: 'secret-release-body', signedUrl: 'secret-url' };
  const diagnostics = createDiagnostics({ app: { getPath: () => root, getVersion: () => '0.1.0-alpha.8', isPackaged: true },
    resources: join(root, 'resources'), updatesEnabled: true, getUpdateState: () => state });
  diagnostics.recordUpdate(state);
  const report = await diagnostics.snapshot();
  assert.equal(report.startup.length, 2);
  assert.equal(report.startup[1].code, 'ENOENT');
  assert.equal(report.update.httpStatus, 503);
  assert.equal(report.recentUpdates.at(-1).code, 'UPDATE_HTTP_ERROR');
  assert.equal(JSON.stringify(report).includes('secret'), false);
  const exported = join(root, 'report.json');
  const dialog = { showSaveDialog: async () => ({ canceled: false, filePath: exported }) };
  assert.equal(await diagnostics.exportReport({}, dialog), true);
  const saved = await readFile(exported, 'utf8');
  assert.ok(saved.includes('UPDATE_HTTP_ERROR'));
  assert.equal(saved.includes('secret'), false);
  assert.equal(saved.includes('must-not-read'), false);
  assert.equal(await diagnostics.exportReport({}, { showSaveDialog: async () => ({ canceled: true }) }), false);
  const opened = [];
  await diagnostics.openDirectory('logs', { openPath: async path => { opened.push(path); return ''; } });
  assert.deepEqual(opened, [logs]);
  for (const id of ['../credentials', 'constructor', '__proto__', {}, null])
    await assert.rejects(diagnostics.openDirectory(id, {}), /Unknown/);
});
test('diagnostic event filtering rejects unexpected fields and unsafe strings', () => {
  assert.deepEqual(safeEvent({ phase: 'token=secret', error: 'EBIGSECRET', elapsedMs: Infinity, password: 'secret',
    code: 'https://secret.invalid?token=secret', total: 1 }), { total: 1, code: 'STARTUP_ERROR' });
  assert.deepEqual(failureInfo({ code: 'https://secret.invalid' }), { code: 'UPDATE_ERROR' });
});
