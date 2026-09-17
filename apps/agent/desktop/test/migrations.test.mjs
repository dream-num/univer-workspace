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
import { migrations, readDataVersion, planMigrations } from '../migrations/schema.cjs';

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

test('standalone migration adopts an unversioned home without resetting user edits or dependencies', async t => {
  const { resources, home } = await fixture(t);
  await rm(join(home, '.desktop-data-version.json'));
  await mkdir(join(home, profile, 'node_modules/custom'), { recursive: true });
  await writeFile(join(home, profile, 'node_modules/custom/plugin.cjs'), 'installed plugin');
  const { stdout } = await execute(process.execPath, [
    fileURLToPath(new URL('../migrations/run.cjs', import.meta.url)), '--resources', resources, '--home', home,
  ]);
  assert.equal(stdout.trim(), home);
  assert.equal(await readFile(join(home, profile, 'package.json'), 'utf8'), '{"userPlugin":true}');
  assert.equal(await readFile(join(home, profile, 'node_modules/custom/plugin.cjs'), 'utf8'), 'installed plugin');
  assert.deepEqual(await readDataVersion(home), { formatVersion: 1, schemaVersion: 1, appliedMigrations: ['v0-to-v1'] });
  const before = await readdir(join(home, '..'));
  await migrateRuntimeHome(resources, home);
  assert.deepEqual(await readdir(join(home, '..')), before);
});

test('failed staging preserves the live profile and a retry carries authored presets forward', async t => {
  const { resources, home } = await fixture(t);
  await writeFile(join(resources, 'integrity.json'), '{"generation":2}');
  const shipped = join(resources, 'home', profile);
  await rename(shipped, `${shipped}.held`);
  await assert.rejects(migrateRuntimeHome(resources, home), /stage-shipped-home failed/);
  assert.equal(await readFile(join(home, profile, 'package.json'), 'utf8'), '{"userPlugin":true}');
  await assert.rejects(access(`${home}.upgrade.json`), { code: 'ENOENT' });
  await rename(`${shipped}.held`, shipped);
  await migrateRuntimeHome(resources, home);
  assert.equal(await readFile(join(home, '.agent-presets/custom/agent.cordis.yml'), 'utf8'), 'custom plugin');
  const receipt = JSON.parse(await readFile(join(home, '.desktop-migrations.json'), 'utf8'));
  assert.deepEqual(receipt.completed, ['stage-shipped-home', 'preserve-authored-presets']);
  assert.equal(receipt.identity, await readFile(join(home, '.desktop-complete'), 'utf8'));
  const backup = (await readdir(join(home, '..'))).find(name => name.startsWith('home.previous-'));
  assert.equal(await readFile(join(home, '..', backup, profile, 'package.json'), 'utf8'), '{"userPlugin":true}');
  const before = await readdir(join(home, '..'));
  await migrateRuntimeHome(resources, home);
  assert.deepEqual(await readdir(join(home, '..')), before);
});

test('resource refresh does not replay already applied data migrations', async t => {
  const { resources, home } = await fixture(t);
  const state = await readFile(join(home, '.desktop-data-version.json'), 'utf8');
  await writeFile(join(resources, 'integrity.json'), '{"generation":2}');
  await migrateRuntimeHome(resources, home, { registry: [{ ...migrations[0], run() { throw new Error('must not replay'); } }] });
  assert.equal(await readFile(join(home, '.desktop-data-version.json'), 'utf8'), state);
});

test('skipped data versions migrate in order, independently of resource identity, and roll back on failure', async t => {
  const { resources, home } = await fixture(t);
  const identity = await readFile(join(home, '.desktop-complete'), 'utf8');
  const dataPath = '.agent-presets/custom/state.json';
  await writeFile(join(home, dataPath), JSON.stringify({ oldName: 'user setting' }));
  const v2 = { id: 'v1-to-v2', fromVersion: 1, toVersion: 2, async run({ staging }) {
    const old = JSON.parse(await readFile(join(staging, dataPath), 'utf8'));
    assert.equal(old.oldName, 'user setting');
    await writeFile(join(staging, dataPath), JSON.stringify({ name: old.oldName }));
  } };
  const v3 = { id: 'v2-to-v3', fromVersion: 2, toVersion: 3, async run({ staging }) {
    const old = JSON.parse(await readFile(join(staging, dataPath), 'utf8'));
    assert.equal(old.name, 'user setting');
    await writeFile(join(staging, dataPath), JSON.stringify({ settings: old }));
  } };
  await assert.rejects(migrateRuntimeHome(resources, home, { targetVersion: 3,
    registry: [...migrations, v2, { ...v3, run() { throw new Error('interrupted'); } }],
  }), /v2-to-v3 failed/);
  assert.equal((await readDataVersion(home)).schemaVersion, 1);
  assert.deepEqual(JSON.parse(await readFile(join(home, dataPath))), { oldName: 'user setting' });
  const options = { targetVersion: 3, registry: [v3, ...migrations, v2] };
  await migrateRuntimeHome(resources, home, options);
  assert.deepEqual(JSON.parse(await readFile(join(home, dataPath))), { settings: { name: 'user setting' } });
  assert.equal(await readFile(join(home, profile, 'package.json'), 'utf8'), '{"userPlugin":true}');
  assert.equal(await readFile(join(home, '.desktop-complete'), 'utf8'), identity);
  assert.deepEqual(await readDataVersion(home), {
    formatVersion: 1, schemaVersion: 3, appliedMigrations: ['v0-to-v1', 'v1-to-v2', 'v2-to-v3'],
  });
  const before = await readdir(join(home, '..'));
  await migrateRuntimeHome(resources, home, options);
  assert.deepEqual(await readdir(join(home, '..')), before);
});

test('newer data versions and corrupt metadata fail before modifying home or staging', async t => {
  const { resources, home } = await fixture(t);
  const versionPath = join(home, '.desktop-data-version.json');
  await mkdir(`${home}.staging`);
  await writeFile(join(`${home}.staging`, 'sentinel'), 'untouched');
  for (const refresh of [false, true]) {
    if (refresh) await writeFile(join(resources, 'integrity.json'), '{"generation":2}');
    await writeFile(versionPath, JSON.stringify({ formatVersion: 1, schemaVersion: 2, appliedMigrations: [] }));
    await assert.rejects(migrateRuntimeHome(resources, home), /newer than supported/);
  }
  for (const state of [null, { formatVersion: 2, schemaVersion: 1, appliedMigrations: [] },
    { formatVersion: 1, schemaVersion: -1, appliedMigrations: [] },
    { formatVersion: 1, schemaVersion: 1.5, appliedMigrations: [] }]) {
    await writeFile(versionPath, JSON.stringify(state));
    await assert.rejects(migrateRuntimeHome(resources, home), /Invalid Desktop data version/);
  }
  await writeFile(versionPath, '{broken');
  await assert.rejects(migrateRuntimeHome(resources, home), SyntaxError);
  assert.equal(await readFile(join(home, profile, 'package.json'), 'utf8'), '{"userPlugin":true}');
  assert.equal(await readFile(join(`${home}.staging`, 'sentinel'), 'utf8'), 'untouched');
});

test('missing and ambiguous transitions are rejected instead of skipping data versions', () => {
  assert.throws(() => planMigrations(0, 2, migrations), /Missing Desktop data migration 1 -> 2/);
  assert.throws(() => planMigrations(0, 1, [...migrations, migrations[0]]), /Invalid Desktop migration registry/);
  assert.throws(() => planMigrations(0, 2, [{ ...migrations[0], toVersion: 2 }]), /Invalid Desktop migration registry/);
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
