import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selectProfileRuntime } from '../src/profile-runtime.cjs';
import { makeProfilePortable } from '../scripts/portable-profile.mjs';

test('portable profile removes build-machine paths from both manifest and lock', async t => {
  const root = await mkdtemp(join(tmpdir(), 'uwa portable '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const profile = join(root, 'profiles/univer-workspace-harness');
  await mkdir(profile, { recursive: true });
  await mkdir(join(root, 'internal-packages'));
  await writeFile(join(root, 'internal-packages/plugin.tgz'), 'package');
  const source = 'file:D:/a/build/internal-packages/plugin.tgz';
  await writeFile(join(profile, 'package.json'), JSON.stringify({ dependencies: {
    '@deepseek-ai/dsh-web-app': '0.1.5-rc.1', plugin: source,
  } }));
  await writeFile(join(profile, 'pnpm-lock.yaml'), `specifier: ${source}\n`);
  await makeProfilePortable(profile);
  const manifest = JSON.parse(await readFile(join(profile, 'package.json')));
  assert.equal(manifest.dependencies.plugin, 'file:../../internal-packages/plugin.tgz');
  assert.equal(manifest.dependencies['@deepseek-ai/dsh'], '0.1.5-rc.1');
  assert.equal(await readFile(join(profile, 'pnpm-lock.yaml'), 'utf8'), 'specifier: file:../../internal-packages/plugin.tgz\n');
});

test('installed plugin profile selects the public DSH launcher and survives restart', async t => {
  const root = await mkdtemp(join(tmpdir(), 'uwa plugin runtime '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const resources = join(root, 'resources');
  const home = join(root, 'home');
  const suffix = 'profiles/univer-workspace-harness';
  for (const base of [join(resources, 'home', suffix), join(home, suffix)]) {
    await mkdir(base, { recursive: true });
    await writeFile(join(base, 'package.json'), '{}');
    await writeFile(join(base, 'cordis.patch.yml'), '[]');
  }
  assert.deepEqual(await selectProfileRuntime(resources, home), { archived: true });
  const patchPath = join(home, suffix, 'cordis.patch.yml');
  await writeFile(patchPath, '- insert:\n    - name: my-plugin\n');
  await assert.rejects(selectProfileRuntime(resources, home), /pnpm install/);
  const dsh = join(home, suffix, 'node_modules/@deepseek-ai/dsh/lib/bin.js');
  await mkdir(join(dsh, '..'), { recursive: true });
  await writeFile(dsh, '// installed DSH');
  for (let restart = 0; restart < 2; restart++) {
    const selected = await selectProfileRuntime(resources, home);
    assert.equal(selected.archived, false);
    assert.equal(selected.dsh, dsh);
    assert.match(await readFile(selected.patch, 'utf8'), /id: modules\n  disabled: false/);
    assert.equal(await readFile(patchPath, 'utf8'), '- insert:\n    - name: my-plugin\n');
  }
});
