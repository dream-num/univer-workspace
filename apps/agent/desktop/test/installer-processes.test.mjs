import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('Windows installer closes only the exact application and its descendants', {
  skip: process.platform !== 'win32',
  timeout: 60000,
}, () => {
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', fileURLToPath(new URL('./installer-processes.ps1', import.meta.url)),
  ], { encoding: 'utf8', timeout: 55000, windowsHide: true });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
