import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { loadFeatures, plan } from './journeys.mjs';
import { exitCode, findKey, finish, parseArgs, readTranscript, summary } from './runner.mjs';

const transcript = readFileSync(fileURLToPath(new URL('../fixtures/runner-transcript.jsonl', import.meta.url)), 'utf8');
const recipe = (h1, ...journeys) => `# ${h1}\n\n## Driving it with agent-browser and uvw\n\n${journeys.map((j) => `### ${j}\n`).join('\n')}`;

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
  assert.deepEqual(parseArgs(['--check']), { check: true, tasks: [] });
  assert.deepEqual(parseArgs(['--check', 'auth']).tasks, [{ id: 'auth', feature: 'auth', journeys: [] }]);
  assert.throws(() => parseArgs(['--check', '--keep', 'auth']), /--check takes only tasks/);
});

test('runner --check names the key source and fingerprint, proves the key with one request, and names the host-only tasks', async () => {
  const root = mkdtempSync(join(tmpdir(), 'verify-uvw-check-'));
  const skill = join(root, '.agents/skills/verify-uvw');
  const bin = join(skill, 'bin');
  const requests = [];
  // Stands in for the Anthropic-compatible endpoint: it accepts good-key and echoes any other key in its refusal.
  const endpoint = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requests.push({ path: req.url, authorization: req.headers.authorization, body: JSON.parse(body) });
      const token = req.headers.authorization?.replace(/^Bearer /, '');
      res.writeHead(token === 'good-key' ? 200 : 401, { 'content-type': 'application/json' });
      res.end(JSON.stringify(token === 'good-key' ? { type: 'message', content: [{ type: 'text', text: 'p' }] }
        : { type: 'error', error: { type: 'authentication_error', message: `Authentication Fails, Your api key: ${token} is invalid` } }));
    });
  });
  try {
    await new Promise((resolve) => endpoint.listen(0, '127.0.0.1', resolve));
    mkdirSync(bin, { recursive: true });
    mkdirSync(join(skill, 'features'));
    mkdirSync(join(skill, 'runner'));
    copyFileSync(fileURLToPath(new URL('./runner.mjs', import.meta.url)), join(bin, 'runner.mjs'));
    copyFileSync(fileURLToPath(new URL('./journeys.mjs', import.meta.url)), join(bin, 'journeys.mjs'));
    writeFileSync(join(skill, 'runner/Dockerfile'), `FROM scratch\nENV ANTHROPIC_BASE_URL=http://127.0.0.1:${endpoint.address().port} \\\n    ANTHROPIC_MODEL='stub-model[1m]' ANTHROPIC_DEFAULT_HAIKU_MODEL=other-model\n`);
    writeFileSync(join(skill, 'features/whole.md'), recipe('Whole feature (host only)', 'W1. One'));
    writeFileSync(join(skill, 'features/plain.md'), recipe('Plain feature', 'P1. One', 'P2. Two (host only)', 'P3. Three (host only)'));
    const node = (args, env) => promisify(execFile)(process.execPath, [join(bin, 'runner.mjs'), ...args],
      { env: { PATH: process.env.PATH, DOCKER_HOST: `unix://${join(root, 'no-docker.sock')}`, ...env } })
      .then((r) => ({ status: 0, ...r }), (e) => ({ status: e.code, stdout: e.stdout, stderr: e.stderr }));
    const check = (env, ...tasks) => node(['--check', ...tasks], env);
    const sha = (key) => createHash('sha256').update(key).digest('hex').slice(0, 8);

    const noKey = await check({});
    assert.equal(noKey.status, 5);
    assert.match(noKey.stdout, /^FAIL {2}DEEPSEEK_API_KEY not found/m);
    assert.match(noKey.stdout, /^FAIL {2}docker is not available$/m);
    assert.equal(requests.length, 0);

    const good = await check({ DEEPSEEK_API_KEY: 'good-key' });
    assert.equal(good.status, 3, 'the key works, Docker is missing');
    assert.ok(good.stdout.includes(`ok    DEEPSEEK_API_KEY from environment (sha256 ${sha('good-key')}) works\n`));
    assert.deepEqual(requests, [{ path: '/v1/messages', authorization: 'Bearer good-key',
      body: { model: 'stub-model', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] } }]);

    writeFileSync(join(root, '.env'), 'DEEPSEEK_API_KEY=good-key\n');
    assert.ok((await check({})).stdout.includes(`ok    DEEPSEEK_API_KEY from .env (sha256 ${sha('good-key')}) works\n`));
    const refused = await check({ DEEPSEEK_API_KEY: 'bad-key' });
    assert.equal(refused.status, 5, 'the environment wins over .env, and a refused key exits 5');
    assert.match(refused.stdout, new RegExp(`^FAIL {2}DEEPSEEK_API_KEY from environment \\(sha256 ${sha('bad-key')}\\): stub-model at http://127\\.0\\.0\\.1:\\d+ answered HTTP 401: Authentication Fails, Your api key: <key> is invalid$`, 'm'));
    assert.doesNotMatch(refused.stdout + refused.stderr, /bad-key/);

    const batch = await node(['plain:P1'], { DEEPSEEK_API_KEY: 'bad-key', VERIFY_UVW_ROOT: join(root, 'runs') });
    assert.equal(batch.status, 5, 'a batch probes the key before it asks Docker for anything');
    assert.match(batch.stderr, /^verify-uvw runner: DEEPSEEK_API_KEY from environment \(sha256 [0-9a-f]{8}\): stub-model at \S+ answered HTTP 401/m);

    const tasks = await check({ DEEPSEEK_API_KEY: 'good-key' }, 'whole', 'plain:P1');
    assert.match(tasks.stdout, /^host {2}whole is marked \(host only\); run it in host mode$/m);
    assert.doesNotMatch(tasks.stdout, /plain/);
    assert.match((await check({ DEEPSEEK_API_KEY: 'good-key' }, 'plain')).stdout, /^host {2}plain:P2,P3 is marked \(host only\); run it in host mode$/m);
    assert.match((await check({ DEEPSEEK_API_KEY: 'good-key' }, 'plain:P1,P3')).stdout, /^host {2}plain:P3 is marked/m);
    assert.equal((await check({ DEEPSEEK_API_KEY: 'good-key' }, 'missing')).status, 2);
    const unknownId = await check({ DEEPSEEK_API_KEY: 'good-key' }, 'plain:P9');
    assert.equal(unknownId.status, 2);
    assert.match(unknownId.stderr, /no journey or mode P9 in features\/plain\.md/);

    await new Promise((resolve) => endpoint.close(resolve));
    const unreachable = await check({ DEEPSEEK_API_KEY: 'good-key' });
    assert.equal(unreachable.status, 5);
    assert.match(unreachable.stdout, /^FAIL {2}DEEPSEEK_API_KEY from environment \(sha256 [0-9a-f]{8}\): stub-model at \S+ did not answer: .*ECONNREFUSED/m);
  } finally {
    endpoint.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('the key comes from the environment first, then from a DEEPSEEK_API_KEY line in .env, and says which', () => {
  assert.deepEqual(findKey({ DEEPSEEK_API_KEY: 'from-env' }, 'DEEPSEEK_API_KEY=from-file\n'), { key: 'from-env', source: 'environment' });
  assert.deepEqual(findKey({}, 'OTHER=1\nDEEPSEEK_API_KEY=from-file\n'), { key: 'from-file', source: '.env' });
  assert.equal(findKey({}, 'DEEPSEEK_API_KEY="double"\n').key, 'double');
  assert.equal(findKey({}, "export DEEPSEEK_API_KEY='single'\r\n").key, 'single');
  assert.equal(findKey({}, '# DEEPSEEK_API_KEY=commented\nDEEPSEEK_API_KEY=real\n').key, 'real');
  assert.equal(findKey({}, '# DEEPSEEK_API_KEY=commented\n'), null);
  assert.equal(findKey({}, 'DEEPSEEK_API_KEY=\n'), null);
  assert.equal(findKey({ DEEPSEEK_API_KEY: '' }, ''), null);
  assert.equal(findKey({}, undefined), null);
});

test('the exit code is 4 for any failed or INCOMPLETE task, then 3 for any host-only task, else 0', () => {
  const as = (...statuses) => statuses.map((status) => ({ status, result: status === 'host-only' ? null : 'PASS' }));
  assert.equal(exitCode(as('finished', 'finished')), 0);
  assert.equal(exitCode([{ status: 'finished', result: 'ISSUES' }]), 0, 'findings with every journey covered are a finished verification');
  assert.equal(exitCode(as('finished', 'host-only')), 3);
  assert.equal(exitCode([...as('host-only'), { status: 'finished', result: 'INCOMPLETE' }]), 4);
  for (const failed of ['timeout', 'infra-error', 'secret-leak']) {
    assert.equal(exitCode(as('finished', failed)), 4, failed);
    assert.equal(exitCode(as('host-only', failed)), 4, `${failed} wins over host-only`);
  }
});

test('a task with an expected journey that has no verdict is INCOMPLETE and exits 4, whatever its report claims', () => {
  const dir = mkdtempSync(join(tmpdir(), 'verify-uvw-coverage-'));
  const expected = plan(loadFeatures().get('issues'), [], { where: 'runner' }).partitions[0].journeys;
  const out = join(dir, 'issues');
  const verdicts = (run, ...entries) => {
    mkdirSync(join(out, 'runs', run, 'evidence'), { recursive: true });
    writeFileSync(join(out, 'runs', run, 'evidence/journeys.jsonl'), entries.map(([at, journey, verdict, note = '']) =>
      `${JSON.stringify({ kind: 'verdict', at, run, feature: 'issues', journey, verdict, note })}\n`).join(''));
  };
  try {
    mkdirSync(out);
    writeFileSync(join(out, 'claude.exit'), '0\n');
    writeFileSync(join(out, 'transcript.jsonl'), `${JSON.stringify({ type: 'result', num_turns: 30, result: 'IS1: PASS\nRESULT: PASS' })}\n`);
    verdicts('issues', ['2026-11-24T10:00:01Z', 'IS1', 'PASS'], ['2026-11-24T10:00:03Z', 'IS2', 'FAIL', 'number is 2'],
      ['2026-11-24T10:00:04Z', 'IS3', 'PASS'], ['2026-11-24T10:00:05Z', 'IS4', 'BLOCKED', 'the Comment\nbutton never rendered']);
    verdicts('other', ['2026-11-24T10:00:02Z', 'IS2', 'PASS']);

    const incomplete = finish({ id: 'issues', expected }, dir, 95, 'the-key');
    assert.deepEqual([incomplete.status, incomplete.result], ['finished', 'INCOMPLETE']);
    assert.deepEqual(incomplete.journeys.map((j) => j.verdict), ['PASS', 'FAIL', 'PASS', 'BLOCKED', 'MISSING'], 'the later FAIL from another run wins');
    assert.equal(exitCode([incomplete]), 4);
    assert.deepEqual(JSON.parse(readFileSync(join(out, 'result.json'), 'utf8')).journeys[4], { id: 'IS5', verdict: 'MISSING', note: '' });

    const text = summary({ batch: 'b', sha: 's', head: 'h', image: 'i', key: 'k', jobs: 1, dir, results: [incomplete], hostOnly: [], setup: [90], wallSeconds: 100 });
    assert.match(text, /^\| Task \| Status \| Result \| Journeys \| PASS \| FAIL \| DRIFT \| BLOCKED \| MISSING \| Turns \|/m);
    assert.match(text, /^\| issues \| finished \| INCOMPLETE \| 5 \| 2 \| 1 \| 0 \| 1 \| 1 \| 30 \| 95 s \|/m);
    assert.match(text, /^Journeys that are not PASS:\n\n- issues IS2 FAIL: number is 2\n- issues IS4 BLOCKED: the Comment button never rendered\n- issues IS5 MISSING\n/m);

    verdicts('late', ['2026-11-24T10:00:06Z', 'IS5', 'PASS']);
    const complete = finish({ id: 'issues', expected }, dir, 95, 'the-key');
    assert.deepEqual([complete.result, exitCode([complete])], ['ISSUES', 0]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a session that ends on an API error is an infra-error, and summary.md shows the error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'verify-uvw-finish-'));
  const task = (id, exit, record) => {
    mkdirSync(join(dir, id));
    writeFileSync(join(dir, id, 'claude.exit'), `${exit}\n`);
    writeFileSync(join(dir, id, 'transcript.jsonl'), `${JSON.stringify({ type: 'result', num_turns: 120, ...record })}\n`);
    return finish({ id, expected: [{ id: 'X1' }] }, dir, 681, 'the-key');
  };
  try {
    const balance = task('sheet-lens', 1, { is_error: true, result: 'API Error: 402 Insufficient Balance (request_id: r-1)' });
    assert.equal(balance.status, 'infra-error');
    assert.equal(balance.error, 'API Error: 402 Insufficient Balance (request_id: r-1)');
    assert.equal(JSON.parse(readFileSync(join(dir, 'sheet-lens/result.json'), 'utf8')).status, 'infra-error');
    assert.equal(exitCode([balance]), 4);
    const quoted = task('auth', 0, { is_error: false, result: 'API Error: 402 was in the log.\nauth: PASS\nRESULT: PASS' });
    assert.deepEqual([quoted.status, quoted.error], ['finished', null], 'a report that quotes an API error is still a report');
    assert.deepEqual([task('issues', 1, { is_error: true, result: 'Reached max turns' }).status, quoted.result], ['finished', 'INCOMPLETE']);

    const text = summary({ batch: 'b', sha: 's', head: 'h', image: 'i', key: 'DEEPSEEK_API_KEY from .env (sha256 0123abcd)', jobs: 1, dir,
      results: [balance, quoted], hostOnly: [], setup: [90], wallSeconds: 700 });
    assert.match(text, /^Snapshot s of HEAD h, image i, DEEPSEEK_API_KEY from \.env \(sha256 0123abcd\), 1 runner/m);
    assert.match(text, /^\| sheet-lens \| infra-error \| INCOMPLETE \| 1 \| 0 \| 0 \| 0 \| 0 \| 1 \| 120 \|/m);
    assert.match(text, /^These tasks stopped on an API error:\n\n- sheet-lens: API Error: 402 Insufficient Balance \(request_id: r-1\)$/m);
    assert.doesNotMatch(text, /- auth:/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the report, turns and usage come from the last result record, with run paths moved to the batch', () => {
  const read = readTranscript(transcript, '/batch/link-sharing/runs');
  assert.equal(read.turns, 18);
  assert.deepEqual(read.usage, { input: 30388, cacheRead: 388864, output: 4708 });
  assert.ok(!read.report.includes('/tmp/verify-uvw/'));
  assert.ok(read.report.includes('`/batch/link-sharing/runs/own1/evidence/share-show.{cmd,out,err,exit}`'));

  assert.equal(readTranscript(transcript.split('\n').filter((line) => !line.includes('"type":"result"')).join('\n'), '/x'), null);
  const record = (result) => JSON.stringify({ type: 'result', result, num_turns: 2 });
  assert.equal(readTranscript(`${record('first')}\n${record('last')}\nnot json\n`, '/x').report, 'last');
  assert.equal(readTranscript(`${record('See /tmp/verify-uvw-slc/slc/evidence/a.png and /tmp/verify-uvw/t/evidence/b.png')}\n`, '/b/runs').report,
    'See /b/runs/slc/evidence/a.png and /b/runs/t/evidence/b.png');
});
