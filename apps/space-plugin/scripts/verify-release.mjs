import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// package:release has already scanned every entry and produced this inventory.
// Check its hash against the exact tarball before using it for the contract checks.
const [archiveArgument, inventoryArgument] = process.argv.slice(2);
if (!archiveArgument || !inventoryArgument || process.argv.length !== 4)
  throw new Error('Pass the release tarball and its package-inventory.json.');
if (process.env.UNIVER_LICENSE !== undefined)
  throw new Error('Verify the packaged fallback with UNIVER_LICENSE unset.');
const archive = resolve(archiveArgument);
const inventory = JSON.parse(await readFile(inventoryArgument, 'utf8'));
assert.equal(createHash('sha256').update(await readFile(archive)).digest('hex'), inventory.sha256);
assert.equal((await stat(archive)).size, inventory.bytes);
assert.deepEqual(inventory.findings, []);
assert.equal(inventory.licensing, 'internal-desktop-test');

const entries = new Map(inventory.files.map((file) => [file.path, file]));
assert.equal(entries.size, inventory.files.length, 'Duplicate package entries');
const required = [
  'package.json', 'npm-shrinkwrap.json', 'cordis.patch.yml', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.txt',
  'lib/index.js', 'lib/client.js', 'lib/runtime-license.js', 'lib/runtime-license.json',
  'lib/tailwind.css', 'lib/univer-scoped.css', 'lib/base-editor-worker.js',
  'lib/workspace-content-worker.js', 'lib/worker-child.mjs', 'lib/worker-child-upstream.mjs',
  'lib/resource-manifest.json', 'lib/render-runtime/index.html',
  ...['tools', 'editing', 'api-tool', 'creation-tools', 'exchange-tools', 'blob-tool', 'html-view-tool',
    'svg-tool', 'resources-tool', 'issue-tool', 'lint-tool', 'screenshot-tool', 'status-tool', 'unit-tool', 'skills']
    .map((name) => `lib/${name}.js`),
  ...['univer', 'univer-sheet', 'univer-doc', 'univer-slide', 'univer-base', 'univer-board',
    'univer-embed', 'univer-cross-unit-formula', 'univer-html-view'].map((name) => `lib/skills/${name}/SKILL.md`),
];
for (const name of required) assert.ok(entries.get(`package/${name}`)?.bytes > 0, `Missing or empty ${name}`);
assert.ok([...entries.keys()].some((name) => /^package\/lib\/render-runtime\/assets\/.+\.js$/.test(name)), 'Missing render assets');
assert.ok([...entries.keys()].some((name) => /^package\/lib\/skills\/[^/]+\/references\/.+/.test(name)), 'Missing skill references');

const directory = await mkdtemp(join(tmpdir(), 'space-plugin-verify-'));
try {
  execFileSync('tar', ['-xzf', archive, '-C', directory]);
  const root = join(directory, 'package');
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(join(root, 'npm-shrinkwrap.json'), 'utf8'));
  const source = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(manifest.name, 'dsh-space-plugin');
  assert.equal(manifest.version, source.version);
  assert.equal(manifest.main, './lib/index.js');
  assert.equal(manifest.exports?.['.'], './lib/index.js');
  assert.equal(manifest.exports?.['./client'], './lib/client.js');
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml');
  assert.equal(manifest.dsh?.client?.platform, 'web');
  assert.ok(manifest.dsh.client.inject?.length > 0);
  assert.match(await readFile(join(root, 'cordis.patch.yml'), 'utf8'), /name:\s*dsh-space-plugin/);
  assert.deepEqual(manifest.dependencies, source.dependencies);
  assert.equal(manifest.devDependencies, undefined);
  assert.equal(manifest.scripts, undefined);
  assert.equal(lock.name, manifest.name);
  assert.equal(lock.version, manifest.version);
  assert.deepEqual(lock.packages[''].dependencies, manifest.dependencies);
  for (const [name, version] of Object.entries(manifest.dependencies)) {
    assert.equal(lock.packages[`node_modules/${name}`]?.version, version, `Missing locked runtime dependency ${name}`);
  }
  for (const [name, entry] of Object.entries(lock.packages)) {
    assert.ok(!entry.dev && !entry.link && !entry.resolved?.startsWith('file:') && !name.includes('@deepseek-ai/'),
      `Unexpected development or Host dependency in runtime lock: ${name}`);
  }
  JSON.parse(await readFile(join(root, 'lib/resource-manifest.json'), 'utf8'));
  const { readRuntimeLicense } = await import(pathToFileURL(join(root, 'lib/runtime-license.js')).href);
  const licenseSource = await readFile('../../apps/workspace/web/src/features/editor/features/license.ts', 'utf8');
  const match = licenseSource.match(/export const UNIVER_LICENSE\s*=\s*(["'])([^"']+)\1/);
  assert.ok(match && readRuntimeLicense() === match[2], 'Packaged Host license does not match the source');
  console.log(`Verified Space Plugin ${manifest.version}: ${entries.size} scanned files, manifest, dependencies and runtime assets.`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
