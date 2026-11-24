import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { exitCode, findKey, parseArgs, readTranscript } from './runner.mjs';

const helper = fileURLToPath(new URL('./verify-uvw', import.meta.url));
const transcript = readFileSync(fileURLToPath(new URL('../fixtures/runner-transcript.jsonl', import.meta.url)), 'utf8');

test('a task is a feature or a feature with journeys, and repeated features get distinct run ids', () => {
  const { jobs, keep, tasks } = parseArgs(['link-sharing:LS1,LS2', 'auth', 'link-sharing']);
  assert.equal(jobs, 3);
  assert.equal(keep, false);
  assert.deepEqual(tasks, [
    { id: 'link-sharing', feature: 'link-sharing', journeys: ['LS1', 'LS2'] },
    { id: 'auth', feature: 'auth', journeys: [] },
    { id: 'link-sharing-2', feature: 'link-sharing', journeys: [] },
  ]);
  for (const { id } of tasks) assert.match(id, /^[a-z0-9][a-z0-9_-]*$/);
  assert.deepEqual(parseArgs(['--keep', '--jobs', '2', 'auth']).jobs, 2);
  assert.equal(parseArgs(['auth']).jobs, 1);
  assert.equal(parseArgs(['--keep', 'auth']).keep, true);
  assert.throws(() => parseArgs(['--jobs', '4', 'auth']), /--jobs takes 1 to 3/);
  assert.throws(() => parseArgs(['--jobs', 'x', 'auth']), /--jobs takes 1 to 3/);
  assert.throws(() => parseArgs([]), /usage/);
  assert.throws(() => parseArgs(['--fast', 'auth']), /unknown option --fast/);
  assert.throws(() => parseArgs(['Auth']), /bad task Auth/);
  assert.throws(() => parseArgs(['auth:']), /bad task auth:/);
});

test('the key comes from the environment first, then from a DEEPSEEK_API_KEY line in .env', () => {
  assert.equal(findKey({ DEEPSEEK_API_KEY: 'from-env' }, 'DEEPSEEK_API_KEY=from-file\n'), 'from-env');
  assert.equal(findKey({}, 'OTHER=1\nDEEPSEEK_API_KEY=from-file\n'), 'from-file');
  assert.equal(findKey({}, 'DEEPSEEK_API_KEY="double"\n'), 'double');
  assert.equal(findKey({}, "export DEEPSEEK_API_KEY='single'\r\n"), 'single');
  assert.equal(findKey({}, '# DEEPSEEK_API_KEY=commented\nDEEPSEEK_API_KEY=real\n'), 'real');
  assert.equal(findKey({}, '# DEEPSEEK_API_KEY=commented\n'), null);
  assert.equal(findKey({}, 'DEEPSEEK_API_KEY=\n'), null);
  assert.equal(findKey({ DEEPSEEK_API_KEY: '' }, ''), null);
  assert.equal(findKey({}, undefined), null);
});

test('the exit code is 4 for any failed task, then 3 for any host-only task, else 0', () => {
  const as = (...statuses) => statuses.map((status) => ({ status }));
  assert.equal(exitCode(as('reported', 'reported')), 0);
  assert.equal(exitCode(as('reported', 'host-only')), 3);
  for (const failed of ['no-report', 'timeout', 'infra-error', 'secret-leak']) {
    assert.equal(exitCode(as('reported', failed)), 4, failed);
    assert.equal(exitCode(as('host-only', failed)), 4, `${failed} wins over host-only`);
  }
});

test('the report, verdict, turns and usage come from the last result record, with run paths moved to the batch', () => {
  const read = readTranscript(transcript, '/batch/link-sharing/runs');
  assert.equal(read.result, 'PASS');
  assert.equal(read.turns, 18);
  assert.deepEqual(read.usage, { input: 30388, cacheRead: 388864, output: 4708 });
  assert.ok(!read.report.includes('/tmp/verify-uvw/'));
  assert.ok(read.report.includes('`/batch/link-sharing/runs/own1/evidence/share-show.{cmd,out,err,exit}`'));

  assert.equal(readTranscript(transcript.split('\n').filter((line) => !line.includes('"type":"result"')).join('\n'), '/x'), null);
  const record = (result) => JSON.stringify({ type: 'result', result, num_turns: 2 });
  assert.equal(readTranscript(`${record('RESULT: ISSUES')}\n${record('no verdict yet')}\n`, '/x').result, null);
  assert.equal(readTranscript(`${record('MX1: FAIL\nRESULT: ISSUES')}\nnot json\n`, '/x').result, 'ISSUES');
});

test('brief --own refuses a host-only feature or journey set, skips marked journeys, and the host brief ignores marks', () => {
  const root = mkdtempSync(join(tmpdir(), 'verify-uvw-runner-'));
  const skill = join(root, '.agents/skills/verify-uvw');
  const fake = join(skill, 'bin/verify-uvw');
  const feature = (name, text) => writeFileSync(join(skill, 'features', `${name}.md`), text);
  const own = (...args) => spawnSync('bash', [fake, 'brief', '--own', 'task-1', ...args], { encoding: 'utf8', env: { ...process.env, VERIFY_UVW_ROOT: join(root, 'runs') } });
  try {
    mkdirSync(join(skill, 'bin'), { recursive: true });
    mkdirSync(join(skill, 'features'));
    copyFileSync(helper, fake);
    feature('whole', '# Whole feature (host only)\n\n### W1. One\n');
    feature('parts', '# Parts\n\n### P1. Runs anywhere\n### P2. Stops a container (host only)\n### P3. Kills a process (host only)\n');
    feature('plain', '# Plain\n\n### Q1. Runs anywhere\n');

    assert.equal(own('whole').status, 3);
    assert.equal(own('whole', 'W1').status, 3);
    assert.equal(own('parts', 'P2', 'P3').status, 3);

    const all = own('parts');
    assert.equal(all.status, 0, all.stderr);
    assert.match(all.stdout, /then run every step\.\n {3}Do not run P2, P3\. They run only on the host\. Report each as `<id>: SKIP \(host only\)`\./);
    assert.ok(all.stdout.includes(`export VERIFY_UVW_ROOT=${join(root, 'runs')} VERIFY_UVW_RUN=task-1; V=.agents/skills/verify-uvw/bin/verify-uvw; eval "$($V env 2>/dev/null)"`));
    assert.match(all.stdout, /This container is disposable and yours\. Start the instance yourself\./);
    assert.match(all.stdout, /do not run `down` for it/);
    assert.match(all.stdout, /Never print a cookie, token, password or environment variable/);
    assert.ok(all.stdout.includes(`Name each evidence file by its full path, such as ${join(root, 'runs')}/task-1/evidence/<file>.`));

    const mixed = own('parts', 'P1', 'P2');
    assert.equal(mixed.status, 0, mixed.stderr);
    assert.match(mixed.stdout, /then run P1 as written, and skip its other steps\.\n {3}Do not run P2\./);

    const plain = own('plain');
    assert.equal(plain.status, 0, plain.stderr);
    assert.doesNotMatch(plain.stdout, /Do not run/);

    assert.notEqual(own('missing').status, 0);
    assert.notEqual(spawnSync('bash', [fake, 'brief', '--own', 'Bad Id', 'plain']).status, 0);

    mkdirSync(join(root, 'runs/host'), { recursive: true });
    writeFileSync(join(root, 'runs/host/run.env'), 'RUN_ID=host\nWEB_PORT=1\n');
    const host = spawnSync('bash', [fake, 'brief', 'whole'], { encoding: 'utf8', env: { ...process.env, VERIFY_UVW_ROOT: join(root, 'runs'), VERIFY_UVW_RUN: 'host' } });
    assert.equal(host.status, 0, host.stderr);
    assert.match(host.stdout, /features\/whole\.md\. Set up its preconditions, then run every step\./);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
