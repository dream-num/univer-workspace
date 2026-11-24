import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const helper = fileURLToPath(new URL('./verify-uvw', import.meta.url));
const listed = (brief) => /with these IDs: ([^.]+)\. Each needs a verdict\./.exec(brief)?.[1].split(', ');

test('both briefs name the run, the feature file and every expected journey id, and ask for a verdict on each', () => {
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
    assert.match(some.stdout, /^Run test is already running in the `default` mode that these journeys declare, with its user signed in .*Do not run `up`, `down` or `user` unless a journey's own text restarts the instance/m);

    const host = call('sheet-lens');
    assert.equal(host.status, 0, host.stderr);
    assert.equal(listed(host.stdout).length, 20, 'the host brief expects host-only journeys too');
    assert.ok(listed(host.stdout).includes('SLM1'));
    assert.doesNotMatch(host.stdout, /Skip its other journeys|Do not run SLM1/);

    const own = call('--own', 'task-1', 'sheet-lens');
    assert.equal(own.status, 0, own.stderr);
    assert.deepEqual(listed(own.stdout), [...Array(10)].map((_, k) => `SLC${k + 1}`).concat([...Array(9)].map((_, k) => `SLM${k + 2}`)));
    assert.match(own.stdout, /Do not run SLM1\. Only the host runs it\./);
    assert.match(own.stdout, /This container is disposable and yours\.\n/);
    assert.ok(own.stdout.includes(`export VERIFY_UVW_ROOT=${root} VERIFY_UVW_RUN=task-1; V=.agents/skills/verify-uvw/bin/verify-uvw; eval "$($V env 2>/dev/null)"`));
    assert.match(own.stdout, /Leave run task-1 running when you reply/);
    assert.match(own.stdout, /Never print a cookie, token, password or environment variable/);
    assert.ok(own.stdout.includes(`Name each evidence file by its full path, such as ${root}/task-1/evidence/<file>.`));
    assert.doesNotMatch(own.stdout + host.stdout, /RESULT: PASS/);

    assert.equal(call('--own', 'task-1', 'mcp-security').status, 3, 'a host-only feature has no runner brief');
    assert.equal(call('--own', 'task-1', 'sheet-lens', 'SLM1').status, 3);
    const mixed = call('--own', 'task-1', 'sheet-lens', 'SLM1', 'SLC1');
    assert.deepEqual(listed(mixed.stdout), ['SLC1']);
    assert.match(mixed.stdout, /Do not run SLM1\./);
    assert.notEqual(call('--own', 'Bad Id', 'issues').status, 0);

    const unknownId = call('issues', 'IS9');
    assert.notEqual(unknownId.status, 0);
    assert.match(unknownId.stderr, /no journey or mode IS9 in features\/issues\.md/);
    const unknown = call('no-such-feature');
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /no \.agents\/skills\/verify-uvw\/features\/no-such-feature\.md/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
