import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { trimDevelopmentFiles } from '../scripts/trim-development.mjs';

test('trims declarations and known development trees but retains runtime TypeScript, Skills and notices', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'uwa-trim-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const removed = ['pkg/index.d.ts', 'pkg/index.d.mts', 'pkg/index.d.cts', 'pkg/native.pdb', 'zod/src/test.ts', '@mixmark-io/domino/test/a.js'];
  const retained = ['pkg/index.js', 'pkg/template.ts', 'pkg/LICENSE', 'pkg/skills/SKILL.md', 'pkg/binding.node', 'pkg/types/runtime.js'];
  for (const path of [...removed, ...retained]) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), 'content');
  }
  await trimDevelopmentFiles(root);
  for (const path of removed) await assert.rejects(access(join(root, path)), { code: 'ENOENT' });
  for (const path of retained) await access(join(root, path));
});
