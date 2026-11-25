import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { loadFeatures, plan } from './journeys.mjs';

const helper = fileURLToPath(new URL('./verify-uvw', import.meta.url));
const listed = (brief) => /with these IDs: ([^.]+)\. Each needs a verdict\./.exec(brief)?.[1].split(', ');

test('a brief names the run, the feature file and every expected journey id, and asks for a verdict on each', () => {
  const root = mkdtempSync(join(process.env.VERIFY_UVW_TEST_ROOT ?? tmpdir(), 'verify-uvw-brief-'));
  const call = (...args) => spawnSync('bash', [helper, 'brief', ...args], {
    env: { ...process.env, VERIFY_UVW_ROOT: root, VERIFY_UVW_RUN: 'test' }, encoding: 'utf8',
  });
  try {
    mkdirSync(join(root, 'test'), { recursive: true });
    writeFileSync(join(root, 'test/run.env'), 'RUN_ID=test\nWEB_PORT=1\n');

    const some = call('link-sharing', 'LS2', 'LS1');
    assert.equal(some.status, 0, some.stderr);
    assert.ok(some.stdout.includes(`export VERIFY_UVW_ROOT=${root} VERIFY_UVW_RUN=test; V=.agents/skills/verify-uvw/bin/verify-uvw; eval "$($V env)"`));
    assert.deepEqual(listed(some.stdout), ['LS1', 'LS2']);
    assert.match(some.stdout, /features\/link-sharing\.md\. Do its setup, the text before its first journey, then run your journeys in file order, each command as written\. Skip its other journeys\./);
    assert.match(some.stdout, /`\$V verdict <ID> PASS\|FAIL\|DRIFT\|BLOCKED "<note>"`/);
    assert.match(some.stdout, /Run `\$V journeys link-sharing LS2 LS1`\. .*INCOMPLETE/);
    assert.match(some.stdout, /^Run test is already running in the `default` mode that these journeys declare, with uvw signed in as its user .*Do not run `up`, `down` or `user` unless a journey's own text restarts the instance/m);
    assert.match(some.stdout, /The run's browser starts signed out\. When a journey expects it signed in as that user, sign it in first with the block under \*\*Browser\*\* in the Drive section of \.agents\/skills\/verify-uvw\/SKILL\.md\./);

    assert.equal(call('sheet-lens').status, 2, 'sheet-lens spans three modes, and a brief takes one');
    writeFileSync(join(root, 'test/run.env'), 'RUN_ID=test\nWEB_PORT=1\nMCP_ENABLED=1\nMCP_SAME_ORIGIN=0\n');
    const host = call('sheet-lens', 'mcp');
    assert.equal(host.status, 0, host.stderr);
    assert.deepEqual(listed(host.stdout), plan(loadFeatures().get('sheet-lens'), ['mcp']).partitions[0].journeys.map((j) => j.id), 'a mode selects every journey of that mode');

    assert.match(some.stdout, /^Run every command in the foreground and wait until it exits\. Never start one in the background, and never end your reply while a command you started still runs/m);
    assert.match(some.stdout, /give a story 2400000 ms \(40 minutes\)/);
    assert.match(some.stdout, /Never run `set -x`, and never print a cookie, token, password or environment variable, for example with `agent-browser cookies get` or `env`: your transcript is kept\. /);
    assert.doesNotMatch(host.stdout, /RESULT: PASS/);

    const unknownId = call('issues', 'NOPE1');
    assert.notEqual(unknownId.status, 0);
    assert.match(unknownId.stderr, /no journey or mode NOPE1 in features\/issues\.md/);
    const unknown = call('no-such-feature');
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /no \.agents\/skills\/verify-uvw\/features\/no-such-feature\.md/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
