import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, access, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { prepareInstallerHome } from '../migrations/prepare-install.cjs';

test('installer rollback proof requires unchanged data and is cleared before retry or recovery', async t => {
  const root = await mkdtemp(join(tmpdir(), 'uwa-install-home-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const resources = join(root, 'runtime'), home = join(root, 'home'), receipt = join(root, 'result');
  await mkdir(join(resources, 'home/profiles/univer-workspace-harness'), { recursive: true });
  await mkdir(join(resources, 'home/internal-packages'));
  await writeFile(join(resources, 'home/profiles/univer-workspace-harness/package.json'), '{}');
  await writeFile(join(resources, 'host.asar'), 'archive');
  await writeFile(join(resources, 'integrity.json'), '{}');
  await mkdir(home);
  await writeFile(join(home, '.agent-presets'), 'user data');
  await assert.rejects(prepareInstallerHome(resources, home, { receipt }));
  assert.equal(await readFile(receipt, 'utf8'), 'unchanged');
  assert.equal(await readFile(join(home, '.agent-presets'), 'utf8'), 'user data');
  await rename(join(home, '.agent-presets'), join(home, 'saved-preset'));
  await prepareInstallerHome(resources, home, { receipt });
  await assert.rejects(access(receipt), { code: 'ENOENT' });
  await writeFile(receipt, 'unchanged');
  await writeFile(`${home}.upgrade.json`, JSON.stringify({ version: 1, backup: `1-${randomUUID()}` }));
  await rename(home, `${home}.held`); // Unknown interrupted activation with missing recorded backup.
  await assert.rejects(prepareInstallerHome(resources, home, { receipt }));
  await assert.rejects(access(receipt), { code: 'ENOENT' });
});

test('a failure after activation cannot authorize rollback to old binaries', async t => {
  const root = await mkdtemp(join(tmpdir(), 'uwa-install-activate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const resources = join(root, 'runtime'), home = join(root, 'home'), receipt = join(root, 'result');
  await mkdir(join(resources, 'home/profiles/univer-workspace-harness'), { recursive: true });
  await mkdir(join(resources, 'home/internal-packages'));
  await writeFile(join(resources, 'host.asar'), 'archive');
  await writeFile(join(resources, 'integrity.json'), '{}');
  await prepareInstallerHome(resources, home, { receipt });
  // Force final journal cleanup to fail after the new home is active.
  const { readFile: readSource } = await import('node:fs/promises');
  const vm = await import('node:vm');
  const { createRequire } = await import('node:module');
  const require = createRequire(new URL('../migrations/run.cjs', import.meta.url));
  const fs = require('node:fs/promises');
  const module = { exports: {} };
  const source = await readSource(new URL('../migrations/run.cjs', import.meta.url), 'utf8');
  vm.runInNewContext(source, { module, require: name => name === 'node:fs/promises' ? {
    ...fs, async rm(path, options) {
      if (path === `${home}.upgrade.json`) throw Object.assign(new Error('cleanup denied'), { code: 'EACCES' });
      return fs.rm(path, options);
    },
  } : require(name) });
  await writeFile(join(resources, 'integrity.json'), '{"updated":true}');
  await assert.rejects(module.exports.migrateRuntimeHome(resources, home), error => {
    assert.equal(error.code, 'EACCES');
    assert.notEqual(error.runtimeHomeUnchanged, true);
    return true;
  });
  assert.equal(JSON.parse(await readFile(join(home, '.desktop-data-version.json'))).schemaVersion, 1);
});
