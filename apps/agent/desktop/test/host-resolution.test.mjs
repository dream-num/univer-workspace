import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire, registerHooks } from 'node:module';
import host from '../src/dsh-host.cjs';

test('host shares equal-version DSH scope identity across profile and installation', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'uwa host resolution '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const archive = join(root, 'host.asar');
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
  const entry = (base, name) => pathToFileURL(join(base, 'node_modules', name, 'index.js')).href;
  const installed = await import(entry(archive, '@deepseek-ai/test-scope'));
  const duplicate = await import(entry(join(archive, 'profile'), '@deepseek-ai/test-scope'));
  assert.equal(duplicate.read(installed.mint()), undefined, 'two physical copies reproduce the missing scope');
  const hook = registerHooks(host.createHostResolveHook(archive, join(root, 'data')));
  try {
    const profile = await import(entry(join(archive, 'profile'), '@deepseek-ai/test-scope'));
    assert.equal(profile.read(installed.mint()), true);
    assert.equal(profile, installed);
    const requireInstalled = createRequire(join(archive, 'package.json'));
    const requireProfile = createRequire(join(archive, 'profile/package.json'));
    assert.equal(requireProfile('@deepseek-ai/test-scope'), requireInstalled('@deepseek-ai/test-scope'));
    assert.equal(requireInstalled('@deepseek-ai/profile-only'), requireProfile('@deepseek-ai/profile-only'));
    for (const name of ['third-party', '@deepseek-ai/different-version']) {
      assert.notEqual(await import(entry(archive, name)), await import(entry(join(archive, 'profile'), name)));
    }
    assert.equal((await import(entry(join(archive, 'profile'), '@deepseek-ai/profile-only'))).available, true);
    assert.throws(() => requireProfile('@deepseek-ai/missing'), { code: 'MODULE_NOT_FOUND' });
  } finally {
    hook.deregister();
  }
});
