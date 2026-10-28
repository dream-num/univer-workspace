import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanRelease } from '../scripts/scan-release.mjs';

test('release scan requires the repository license and confines it to Host configuration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'space-package-license-'));
  const source = await readFile('../../apps/workspace/web/src/features/editor/features/license.ts', 'utf8');
  const license = JSON.parse(source.match(/export const UNIVER_LICENSE\s*=\s*("[^"]+")/)[1]);
  const tarball = join(directory, 'fixture.tgz');
  const pack = () => execFileSync('tar', ['-czf', tarball, '-C', directory, 'package/lib/runtime-license.json', 'package/lib/client.js', 'package/package.json']);
  try {
    await mkdir(join(directory, 'package/lib'), { recursive: true });
    await writeFile(join(directory, 'package/package.json'), JSON.stringify({ dependencies: {} }));
    await writeFile(join(directory, 'package/lib/client.js'), 'export {};');
    await writeFile(join(directory, 'package/lib/runtime-license.json'), JSON.stringify({ scope: 'internal-desktop-test', license }));
    pack();
    assert.equal((await scanRelease(tarball)).licensing, 'internal-desktop-test');
    await writeFile(join(directory, 'package/lib/runtime-license.json'), JSON.stringify({ scope: 'internal-desktop-test', license: '' }));
    pack();
    await assert.rejects(scanRelease(tarball), /missing-desktop-test-license/);
    await writeFile(join(directory, 'package/lib/runtime-license.json'), JSON.stringify({ scope: 'internal-desktop-test', license }));
    await writeFile(join(directory, 'package/lib/client.js'), JSON.stringify(license));
    pack();
    await assert.rejects(scanRelease(tarball), /development-license/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
