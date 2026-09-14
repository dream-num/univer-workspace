import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access, symlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { retirePreviousInstallation } from '../src/retire-install.cjs';
test('only a verified replacement may retire its marked old installation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'uwa-retire-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const installed = join(root, 'app'), backup = `${installed}.uwa-previous`;
  const resources = join(installed, 'resources/runtime');
  await mkdir(resources, { recursive: true }); await mkdir(backup);
  await writeFile(join(backup, '.uwa-backup-owner'), Buffer.from('\uFEFF' + installed, 'utf16le'));
  await writeFile(join(backup, 'old.exe'), 'old');
  await writeFile(join(root, 'account.json'), 'keep login');
  await writeFile(join(resources, 'integrity.json'), JSON.stringify({ 'code.js': createHash('sha256').update('valid').digest('hex') }));
  await writeFile(join(resources, 'code.js'), 'corrupted');
  await assert.rejects(retirePreviousInstallation(join(installed, 'app.exe'), resources, () => {}), /integrity/);
  assert.equal(await readFile(join(backup, 'old.exe'), 'utf8'), 'old');
  await writeFile(join(resources, 'code.js'), 'valid');
  const phases = [];
  await retirePreviousInstallation(join(installed, 'app.exe'), resources, event => phases.push(event.phase));
  await assert.rejects(access(backup), { code: 'ENOENT' });
  assert.equal(await readFile(join(root, 'account.json'), 'utf8'), 'keep login');
  assert.deepEqual(phases, ['update-verify-start', 'update-verify-complete', 'update-cleanup-start', 'update-cleanup-complete']);
  await mkdir(backup); await writeFile(join(backup, 'unknown'), 'do not delete');
  await retirePreviousInstallation(join(installed, 'app.exe'), resources, () => {});
  assert.equal(await readFile(join(backup, 'unknown'), 'utf8'), 'do not delete');
});

test('Windows cleanup preserves junction targets and resumes after a locked directory', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'uwa-retire-native-'));
  const installed = join(root, 'app & 100%!'), backup = `${installed}.uwa-previous`;
  const resources = join(installed, 'resources/runtime');
  const locked = join(backup, 'locked');
  let child;
  try {
    await mkdir(resources, { recursive: true });
    await writeFile(join(resources, 'code.js'), 'valid');
    await writeFile(join(resources, 'integrity.json'), JSON.stringify({ 'code.js': createHash('sha256').update('valid').digest('hex') }));
    await mkdir(locked, { recursive: true });
    await mkdir(join(root, 'account'));
    await writeFile(join(root, 'account/sentinel'), 'keep');
    await symlink(join(root, 'account'), join(backup, 'account-link'), 'junction');
    await writeFile(join(backup, '.uwa-backup-owner'), Buffer.from('\uFEFF' + installed, 'utf16le'));
    child = spawn(process.execPath, ['-e', 'process.send("ready"); setInterval(() => {}, 1000)'], {
      cwd: locked, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    await once(child, 'message');
    await assert.rejects(retirePreviousInstallation(join(installed, 'app.exe'), resources, () => {}));
    assert.equal(await readFile(join(root, 'account/sentinel'), 'utf8'), 'keep');
    assert.equal((await readFile(`${backup}.owner`, 'utf16le')).replace(/^\uFEFF/, ''), installed);
    const exited = once(child, 'exit'); child.kill(); await exited; child = undefined;
    await retirePreviousInstallation(join(installed, 'app.exe'), resources, () => {});
    await assert.rejects(access(backup), { code: 'ENOENT' });
    await assert.rejects(access(`${backup}.owner`), { code: 'ENOENT' });
    assert.equal(await readFile(join(root, 'account/sentinel'), 'utf8'), 'keep');
  } finally {
    if (child) { const exited = once(child, 'exit'); child.kill(); await exited; }
    await rm(root, { recursive: true, force: true });
  }
});
