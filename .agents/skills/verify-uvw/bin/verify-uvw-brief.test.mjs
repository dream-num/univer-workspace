import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const helper = fileURLToPath(new URL('./verify-uvw', import.meta.url));

test('brief names the run, the feature file and the requested journeys', () => {
  const root = mkdtempSync(join(process.env.VERIFY_UVW_TEST_ROOT ?? tmpdir(), 'verify-uvw-brief-'));
  const call = (...args) => spawnSync('bash', [helper, 'brief', ...args], {
    env: { ...process.env, VERIFY_UVW_ROOT: root, VERIFY_UVW_RUN: 'test' }, encoding: 'utf8',
  });
  try {
    mkdirSync(join(root, 'test'), { recursive: true });
    writeFileSync(join(root, 'test/run.env'), 'RUN_ID=test\nWEB_PORT=1\n');

    const some = call('link-sharing', 'LS1', 'LS2');
    assert.equal(some.status, 0, some.stderr);
    assert.ok(some.stdout.includes(`export VERIFY_UVW_ROOT=${root} VERIFY_UVW_RUN=test; V=.agents/skills/verify-uvw/bin/verify-uvw; eval "$($V env)"`));
    assert.match(some.stdout, /features\/link-sharing\.md\. Set up its preconditions, then run LS1, LS2 as written, and skip its other steps\./);

    assert.match(call('issues').stdout, /then run every step\./);

    const unknown = call('no-such-feature');
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /no \.agents\/skills\/verify-uvw\/features\/no-such-feature\.md/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
