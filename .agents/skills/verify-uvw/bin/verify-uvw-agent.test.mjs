import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const helper = fileURLToPath(new URL('./verify-uvw', import.meta.url));

test('Agent commands require the registered callback and never stop an unrelated PID', () => {
  const root = mkdtempSync(join(process.env.VERIFY_UVW_TEST_ROOT ?? tmpdir(), 'verify-uvw-agent-'));
  const run = join(root, 'test');
  const unrelated = spawn('sleep', ['60']);
  const call = command => spawnSync('bash', [helper, command], {
    env: { ...process.env, VERIFY_UVW_ROOT: root, VERIFY_UVW_RUN: 'test' }, encoding: 'utf8',
  });
  try {
    mkdirSync(run);
    writeFileSync(join(run, 'run.env'), 'RUN_ID=test\nWEB_PORT=1\n');
    const up = call('agent-up');
    assert.equal(up.status, 1);
    assert.match(up.stderr, /no Agent callback registered/);
    writeFileSync(join(run, 'run.env'), 'RUN_ID=test\nWEB_PORT=1\nAGENT_PORT=3191\n');
    writeFileSync(join(run, 'agent.pid'), String(unrelated.pid));
    const down = call('agent-down');
    assert.equal(down.status, 0, down.stderr);
    assert.match(down.stderr, /skip pid .*: not apps\/agent\/scripts\/start-local.mjs --port 3191/);
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
    assert.equal(call('agent-down').status, 0);
  } finally {
    unrelated.kill();
    rmSync(root, { recursive: true, force: true });
  }
});
