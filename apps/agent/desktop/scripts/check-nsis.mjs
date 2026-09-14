import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build, Platform } from 'electron-builder';
import { prepareTracedNsis } from './trace-nsis.mjs';

// Compile both real builder passes with a tiny payload before preparing the
// full runtime. Macro-only fixtures cannot catch builder include/lifecycle bugs.
if (process.platform !== 'win32') throw new Error('Run NSIS integration on native Windows');
const desktop = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const { nsis } = require('../electron-builder.config.cjs');
assert.equal(nsis.script, undefined, 'Keep builder-managed uninstaller generation');
const root = await mkdtemp(join(tmpdir(), 'uwa-nsis-build-'));
try {
  await prepareTracedNsis(desktop);
  const payload = join(root, 'payload');
  await mkdir(join(payload, 'resources'), { recursive: true });
  await writeFile(join(payload, 'NSIS Check.exe'), 'compile-only payload');
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: 'uwa-nsis-check', version: '0.0.1', description: 'NSIS build fixture',
    author: 'DreamNum', main: 'index.js',
  }));
  const artifacts = await build({
    projectDir: root, prepackaged: payload,
    targets: Platform.WINDOWS.createTarget('nsis'), publish: 'never',
    config: {
      appId: 'org.univer.workspace.nsis-check', productName: 'NSIS Check',
      electronVersion: '44.0.0',
      directories: { output: join(root, 'artifacts'), buildResources: join(desktop, 'installer') },
      win: { signAndEditExecutable: false },
      nsis: { ...nsis, include: join(desktop, nsis.include) },
    },
  });
  const installer = artifacts.find(path => path.endsWith('.exe'));
  assert.ok(installer, 'Real NSIS installer was generated');
  assert.ok((await stat(installer)).size > 0);
  console.log('Both builder-managed NSIS compilation passes succeeded');
} finally {
  await rm(root, { recursive: true, force: true });
}
