import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { packDesktopHost } from '../scripts/pack-host.mjs';

const require = createRequire(import.meta.url);
const asar = createRequire(require.resolve('electron-builder/package.json'))('@electron/asar');
test('archive preserves package graphs and unpacks native files under a hidden build directory', async (t) => {
  const desktop = await mkdtemp(join(tmpdir(), 'uwa pack host '));
  t.after(() => rm(desktop, { recursive: true, force: true }));
  const runtime = join(desktop, '.build/runtime');
  const files = {
    'bootstrap/package.json': '{}',
    'bootstrap/node_modules/@deepseek-ai/dsh-agent-presets/presets/standard/agent.cordis.yml': '[]',
    'bootstrap/node_modules/node-pty/lib/index.js': 'native helper launcher',
    'bootstrap/node_modules/shared/index.js': 'bootstrap version',
    'bootstrap/node_modules/native/module.node': 'native binding',
    'bootstrap/node_modules/native/library.so.8.18.6': 'versioned library',
    'bootstrap/node_modules/native/spawn-helper': 'terminal helper',
    'home/profiles/univer-workspace-harness/package.json': JSON.stringify({ dsh: { profile: { bundles: ['shared', '@workspace/agent', 'workspace-tools'] } } }),
    'home/profiles/univer-workspace-harness/node_modules/shared/index.js': 'profile version',
    'home/profiles/univer-workspace-harness/node_modules/@workspace/agent/package.json': '{"name":"@workspace/agent","version":"1.0.0"}',
    'home/profiles/univer-workspace-harness/node_modules/workspace-tools/package.json': '{"name":"workspace-tools","version":"1.0.0"}',
  };
  for (const [name, value] of Object.entries(files)) {
    const path = join(runtime, name);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, value);
  }
  await mkdir(join(desktop, 'src'));
  await writeFile(join(desktop, 'src/dsh-host.cjs'), 'host');
  await writeFile(join(desktop, 'src/asar-stats.cjs'), 'stats compatibility');
  await packDesktopHost(desktop, runtime);
  assert.equal(await readFile(join(runtime, 'presets/standard/agent.cordis.yml'), 'utf8'), '[]');
  const archive = join(runtime, 'host.asar');
  assert.equal(asar.extractFile(archive, 'desktop.cordis.yml').toString(), '[]\n');
  assert.equal(asar.extractFile(archive, join('node_modules', 'shared', 'index.js')).toString(), 'bootstrap version');
  assert.equal(asar.extractFile(archive, join('profile', 'node_modules', 'shared', 'index.js')).toString(), 'profile version');
  for (const name of ['module.node', 'library.so.8.18.6', 'spawn-helper']) {
    assert.equal(asar.statFile(archive, join('node_modules', 'native', name)).unpacked, true);
    await access(join(runtime, 'host.asar.unpacked/node_modules/native', name));
  }
  assert.equal(asar.statFile(archive, join('node_modules', 'node-pty', 'lib', 'index.js')).unpacked, true);
  await assert.rejects(access(join(runtime, 'bootstrap')), { code: 'ENOENT' });
  await assert.rejects(access(join(runtime, 'home/profiles/univer-workspace-harness/node_modules')), { code: 'ENOENT' });
  for (const name of ['@workspace/agent', 'workspace-tools']) {
    const link = asar.statFile(archive, join('node_modules', name), false).link;
    assert.equal(link.replaceAll('\\', '/'), `profile/node_modules/${name}`);
    assert.equal(JSON.parse(asar.extractFile(archive, join('node_modules', name, 'package.json'))).name, name);
  }
  assert.ok(JSON.parse(await readFile(join(runtime, 'home/profiles/univer-workspace-harness/package.json'), 'utf8')).dsh);
});
