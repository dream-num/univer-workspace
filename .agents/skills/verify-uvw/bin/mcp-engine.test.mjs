import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { supportedEngine } from './mcp-engine.mjs';

test('MCP mode accepts macOS Docker Desktop and OrbStack and nothing else', () => {
  for (const engine of ['Docker Desktop', 'OrbStack']) {
    assert.equal(supportedEngine('darwin', engine), true);
    assert.equal(supportedEngine('linux', engine), false);
  }
  for (const engine of ['', 'Colima', 'Podman Engine', 'Ubuntu 24.04.1 LTS', 'orbstack', 'Docker Desktop 4']) assert.equal(supportedEngine('darwin', engine), false);
});

test('the engine check reads docker info and names what it found', { skip: process.platform !== 'darwin' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'verify-uvw-engine-'));
  // The helper names this file through a symlinked path (/tmp on macOS); the check must still run.
  symlinkSync(fileURLToPath(new URL('.', import.meta.url)), join(root, 'bin'));
  const check = script => {
    writeFileSync(join(root, 'docker'), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
    return spawnSync(process.execPath, [join(root, 'bin/mcp-engine.mjs')], { env: { ...process.env, PATH: `${root}:${process.env.PATH}` }, encoding: 'utf8' });
  };
  try {
    for (const [script, status, stdout] of [['echo OrbStack', 0, 'OrbStack\n'], ["echo 'Docker Desktop'", 0, 'Docker Desktop\n'], ['echo Colima', 1, 'Colima\n'], ['exit 1', 1, 'no running engine\n']]) {
      const result = check(script);
      assert.deepEqual([result.status, result.stdout], [status, stdout]);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
