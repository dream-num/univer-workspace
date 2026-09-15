import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire, registerHooks } from 'node:module';
import host from '../src/dsh-host.cjs';

test('host shares equal-version DSH scope identity across profile and installation', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'uwa host resolution '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const archive = join(root, 'host.asar');
  const installedArchive = join(root, 'installed/host.asar');
  await mkdir(installedArchive, { recursive: true });
  // macOS temp paths commonly resolve through /var -> /private/var. Exercise
  // the same alias on every platform, including Windows directory junctions.
  await symlink(installedArchive, archive, process.platform === 'win32' ? 'junction' : 'dir');
  async function packageAt(base, name, version, source) {
    const dir = join(base, 'node_modules', name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name, version, type: 'module',
      exports: { '.': { import: './index.js', require: './index.cjs' } } }));
    await writeFile(join(dir, 'index.js'), source);
    await writeFile(join(dir, 'index.cjs'), 'module.exports = { identity: Symbol() };');
  }
  await packageAt(archive, '@deepseek-ai/cordis-plugin-loader', '4.0.2', 'export {};');
  const scope = 'const key = Symbol("scope"); export const mint = () => ({ [key]: true }); export const read = ctx => ctx[key];';
  for (const base of [archive, join(archive, 'profile')]) {
    await packageAt(base, '@deepseek-ai/test-scope', '1.0.0', scope);
    await packageAt(base, 'third-party', '1.0.0', 'export const identity = Symbol();');
    await packageAt(base, '@deepseek-ai/different-version', base === archive ? '1.0.0' : '2.0.0', 'export const identity = Symbol();');
  }
  await packageAt(join(archive, 'profile'), '@deepseek-ai/profile-only', '1.0.0', 'export const available = true;');
  await packageAt(join(archive, 'profile'), 'workspace-bundle', '1.0.0', 'export const identity = Symbol();');
  await writeFile(join(archive, 'profile/package.json'), JSON.stringify({ dsh: { profile: { bundles: ['workspace-bundle'] } } }));
  await symlink(join(installedArchive, 'profile/node_modules/workspace-bundle'),
    join(archive, 'node_modules/workspace-bundle'), process.platform === 'win32' ? 'junction' : 'dir');
  const entry = (base, name) => pathToFileURL(join(base, 'node_modules', name, 'index.js')).href;
  const installed = await import(entry(archive, '@deepseek-ai/test-scope'));
  const duplicate = await import(entry(join(archive, 'profile'), '@deepseek-ai/test-scope'));
  assert.equal(duplicate.read(installed.mint()), undefined, 'two physical copies reproduce the missing scope');
  const adapter = host.createHostResolveHook(archive, join(root, 'data'));
  // Electron may return an unresolved descendant even though the package
  // directory itself is an ASAR link. Model that result explicitly.
  assert.equal(adapter.resolve('workspace-bundle', {}, () => ({ url: entry(installedArchive, 'workspace-bundle') })).url,
    entry(join(installedArchive, 'profile'), 'workspace-bundle'));
  const hook = registerHooks(adapter);
  try {
    const profile = await import(entry(join(archive, 'profile'), '@deepseek-ai/test-scope'));
    assert.equal(profile.read(installed.mint()), true);
    assert.equal(profile, installed);
    const requireInstalled = createRequire(join(archive, 'package.json'));
    const requireProfile = createRequire(join(archive, 'profile/package.json'));
    assert.equal(requireProfile('@deepseek-ai/test-scope'), requireInstalled('@deepseek-ai/test-scope'));
    assert.equal(requireInstalled('@deepseek-ai/profile-only'), requireProfile('@deepseek-ai/profile-only'));
    assert.equal(requireInstalled('workspace-bundle'), requireProfile('workspace-bundle'));
    for (const name of ['third-party', '@deepseek-ai/different-version']) {
      assert.notEqual(await import(entry(archive, name)), await import(entry(join(archive, 'profile'), name)));
    }
    assert.equal((await import(entry(join(archive, 'profile'), '@deepseek-ai/profile-only'))).available, true);
    assert.throws(() => requireProfile('@deepseek-ai/missing'), { code: 'MODULE_NOT_FOUND' });
  } finally {
    hook.deregister();
  }
});
