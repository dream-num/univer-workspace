import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const helper = fileURLToPath(new URL('./verify-uvw', import.meta.url));
const cliMain = fileURLToPath(new URL('../../../../apps/cli/dist/main.js', import.meta.url));
const origin = 'http://127.0.0.1:1';

test('uvw runs only against the run origin, never the CLI default', { skip: !existsSync(cliMain) && "needs a built CLI: pnpm --filter 'univer-workspace-cli...' build" }, () => {
  const root = mkdtempSync(join(process.env.VERIFY_UVW_TEST_ROOT ?? tmpdir(), 'verify-uvw-origin-'));
  const run = join(root, 'test');
  const call = (...args) => spawnSync('bash', [helper, ...args], {
    env: { ...process.env, VERIFY_UVW_ROOT: root, VERIFY_UVW_RUN: 'test' }, encoding: 'utf8',
  });
  try {
    mkdirSync(join(run, 'evidence'), { recursive: true });
    writeFileSync(join(run, 'run.env'), 'RUN_ID=test\nWEB_PORT=1\n');

    for (const args of [['cli', 'unset', 'config', 'get', 'workspace.origin'], ['uvw', 'config', 'get', 'workspace.origin']]) {
      const refused = call(...args);
      assert.notEqual(refused.status, 0, `${args[0]} ran with no workspace.origin`);
      assert.match(refused.stderr, /refusing uvw/);
      assert.doesNotMatch(refused.stdout, /space\.univer\.ai/);
    }
    assert.doesNotMatch(readFileSync(join(run, 'evidence/unset.out'), 'utf8'), /space\.univer\.ai/);

    execFileSync(process.execPath, [cliMain, 'config', 'set', 'workspace.origin', 'https://example.invalid'], { env: { ...process.env, UNIVER_HOME: join(run, 'home') } });
    assert.notEqual(call('cli', 'other', 'config', 'get', 'workspace.origin').status, 0, 'cli ran against another origin');

    execFileSync(process.execPath, [cliMain, 'config', 'set', 'workspace.origin', origin], { env: { ...process.env, UNIVER_HOME: join(run, 'home') } });
    const allowed = call('cli', 'own', 'config', 'get', 'workspace.origin', '--json');
    assert.equal(allowed.status, 0, allowed.stderr);
    assert.equal(JSON.parse(allowed.stdout).entry.value, origin);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
