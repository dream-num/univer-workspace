import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const helper = fileURLToPath(new URL('./verify-uvw', import.meta.url));

test('down closes every browser session of its run and none of a run whose id shares its prefix', () => {
  const root = mkdtempSync(join(process.env.VERIFY_UVW_TEST_ROOT ?? tmpdir(), 'verify-uvw-down-'));
  const tools = join(root, 'tools'), closed = join(root, 'closed.log');
  try {
    mkdirSync(join(root, 'v6'), { recursive: true });
    mkdirSync(tools);
    writeFileSync(join(root, 'v6/run.env'), 'RUN_ID=v6\nWEB_PORT=1\nSERVER_PID=\nWEB_PID=\n');
    const sessions = ['verify-uvw-v6', 'verify-uvw-v6-o', 'verify-uvw-v6-e', 'verify-uvw-v68', 'verify-uvw-v68-e', 'verify-uvw-v6x', 'other'];
    writeFileSync(join(tools, 'agent-browser'), `#!/bin/sh
case "$*" in
  "session list --json") echo '${JSON.stringify({ success: true, data: { sessions } })}' ;;
  close) echo "$AGENT_BROWSER_SESSION" >> '${closed}' ;;
esac
`, { mode: 0o755 });
    const down = spawnSync('bash', [helper, 'down'], {
      env: { ...process.env, PATH: `${tools}:${process.env.PATH}`, VERIFY_UVW_ROOT: root, VERIFY_UVW_RUN: 'v6' }, encoding: 'utf8',
    });
    assert.equal(down.status, 0, down.stderr);
    assert.deepEqual(readFileSync(closed, 'utf8').trim().split('\n').sort(), ['verify-uvw-v6', 'verify-uvw-v6-e', 'verify-uvw-v6-o']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
