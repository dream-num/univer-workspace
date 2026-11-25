// Called by relocated artifact smoke with the shipped standalone Node. This
// verifies lazy chunks and the real fork bootstrap without a Workspace account.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const directory = process.argv[2];
const files = await readdir(directory);
const exchangeName = files.find(name => /^local-exchange-.*\.js$/.test(name));
assert.ok(exchangeName, 'Packaged lazy Office conversion chunk is missing');
const exchange = await import(pathToFileURL(join(directory, exchangeName)).href);
const imported = await exchange.importUnitData(Buffer.from('Name,Value\nPackaged,42\n'), 'probe.csv');
assert.equal(imported.unitType, 'sheet');
const exported = await exchange.exportUnitData(imported.data, 'sheet', 'probe.csv');
assert.match(Buffer.from(exported).toString('utf8'), /Packaged,42/);

// Use the same bundled RuntimeManager as the shipped Workspace provider.
// Generated esbuild chunk names are not a stable runtime boundary.
const { RuntimeManager } = await import(pathToFileURL(join(directory, 'runtime-manager.js')).href);
const scratch = await mkdtemp(join(tmpdir(), 'uwa-worker-probe-'));
let manager;
try {
  const marker = join(scratch, 'worker-started');
  const entry = join(scratch, 'worker.mjs');
  await writeFile(entry, `import { writeFileSync } from 'node:fs';
    export default { createRuntime(init) {
      writeFileSync(init.unitId, 'ready');
      throw new Error('uwa-packaged-worker-probe');
    } };`);
  manager = new RuntimeManager(pathToFileURL(entry));
  await assert.rejects(manager.exportUnitData({
    origin: 'http://127.0.0.1',
    revision: 0,
    scope: { kind: 'trunk' },
    unitId: marker,
    unitType: 'sheet',
    sessionToken: 'packaged-smoke-fixture',
    license: '',
  }), /uwa-packaged-worker-probe/);
  assert.equal(await readFile(marker, 'utf8'), 'ready');
} finally {
  await manager?.close();
  await rm(scratch, { recursive: true, force: true });
}
console.log('Packaged lazy Office roundtrip and worker fork passed.');
