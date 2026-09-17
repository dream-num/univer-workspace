import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rename, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { migrateRuntimeHome } from '../migrations/run.cjs';

const execute = promisify(execFile);
const profile = 'profiles/univer-workspace-harness';
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'uwa migration '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const resources = join(root, 'resources');
  const home = join(root, 'user/runtime/home');
  await mkdir(join(resources, 'home', profile), { recursive: true });
  await mkdir(join(resources, 'home/internal-packages'));
  await writeFile(join(resources, 'host.asar'), 'archive');
  await writeFile(join(resources, 'integrity.json'), '{"generation":1}');
  await writeFile(join(resources, 'home', profile, 'package.json'), '{}');
  await writeFile(join(resources, 'home', profile, 'cordis.patch.yml'), '[]');
  await migrateRuntimeHome(resources, home);
  await mkdir(join(home, '.agent-presets/custom'), { recursive: true });
  await writeFile(join(home, '.agent-presets/custom/agent.cordis.yml'), 'custom plugin');
  await writeFile(join(home, profile, 'package.json'), '{"userPlugin":true}');
  return { root, resources, home };
}

test('standalone migration skips an unchanged legacy home without resetting user edits', async t => {
  const { resources, home } = await fixture(t);
  await rm(join(home, '.desktop-migrations.json'));
  const { stdout } = await execute(process.execPath, [
    fileURLToPath(new URL('../migrations/run.cjs', import.meta.url)), '--resources', resources, '--home', home,
  ]);
  assert.equal(stdout.trim(), home);
  assert.equal(await readFile(join(home, profile, 'package.json'), 'utf8'), '{"userPlugin":true}');
  assert.equal((await readdir(join(home, '..'))).length, 1);
});

test('failed staging preserves the live profile and a retry carries authored presets forward', async t => {
  const { resources, home } = await fixture(t);
  await writeFile(join(resources, 'integrity.json'), '{"generation":2}');
  const shipped = join(resources, 'home', profile);
  await rename(shipped, `${shipped}.held`);
  await assert.rejects(migrateRuntimeHome(resources, home), /001-stage-shipped-home failed/);
  assert.equal(await readFile(join(home, profile, 'package.json'), 'utf8'), '{"userPlugin":true}');
  await assert.rejects(access(`${home}.upgrade.json`), { code: 'ENOENT' });
  await rename(`${shipped}.held`, shipped);
  await migrateRuntimeHome(resources, home);
  assert.equal(await readFile(join(home, '.agent-presets/custom/agent.cordis.yml'), 'utf8'), 'custom plugin');
  const receipt = JSON.parse(await readFile(join(home, '.desktop-migrations.json'), 'utf8'));
  assert.deepEqual(receipt.completed, ['001-stage-shipped-home', '002-preserve-authored-presets']);
  assert.equal(receipt.identity, await readFile(join(home, '.desktop-complete'), 'utf8'));
  const backup = (await readdir(join(home, '..'))).find(name => name.startsWith('home.previous-'));
  assert.equal(await readFile(join(home, '..', backup, profile, 'package.json'), 'utf8'), '{"userPlugin":true}');
  const before = await readdir(join(home, '..'));
  await migrateRuntimeHome(resources, home);
  assert.deepEqual(await readdir(join(home, '..')), before);
});

test('process interruption between activation renames restores user data before retrying upgrade', async t => {
  const { resources, home } = await fixture(t);
  const backup = `1-${randomUUID()}`;
  await writeFile(`${home}.upgrade.json`, JSON.stringify({ version: 1, backup }));
  await rename(home, `${home}.previous-${backup}`);
  await mkdir(`${home}.staging`);
  await writeFile(join(`${home}.staging`, 'incomplete'), 'discard on retry');
  await writeFile(join(resources, 'integrity.json'), '{"generation":2}');
  await migrateRuntimeHome(resources, home);
  assert.equal(await readFile(join(home, '.agent-presets/custom/agent.cordis.yml'), 'utf8'), 'custom plugin');
  await assert.rejects(access(`${home}.upgrade.json`), { code: 'ENOENT' });
  await assert.rejects(access(join(home, 'incomplete')), { code: 'ENOENT' });
  const backups = (await readdir(join(home, '..'))).filter(name => name.startsWith('home.previous-'));
  assert.equal(backups.length, 1);
  assert.equal(await readFile(join(home, '..', backups[0], profile, 'package.json'), 'utf8'), '{"userPlugin":true}');
});

test('process interruption after activation keeps the completed home and previous backup', async t => {
  const { resources, home } = await fixture(t);
  const backup = `2-${randomUUID()}`;
  await mkdir(`${home}.previous-${backup}`);
  await writeFile(join(`${home}.previous-${backup}`, 'sentinel'), 'previous home');
  await writeFile(`${home}.upgrade.json`, JSON.stringify({ version: 1, backup }));
  await migrateRuntimeHome(resources, home);
  assert.equal(await readFile(join(home, profile, 'package.json'), 'utf8'), '{"userPlugin":true}');
  assert.equal(await readFile(join(`${home}.previous-${backup}`, 'sentinel'), 'utf8'), 'previous home');
  await assert.rejects(access(`${home}.upgrade.json`), { code: 'ENOENT' });
});

test('invalid recovery metadata aborts without moving the active home', async t => {
  const { resources, home } = await fixture(t);
  await writeFile(`${home}.upgrade.json`, JSON.stringify({ version: 1, backup: '../other-home' }));
  await assert.rejects(migrateRuntimeHome(resources, home), /Invalid runtime home migration journal/);
  assert.equal(await readFile(join(home, profile, 'package.json'), 'utf8'), '{"userPlugin":true}');
});
