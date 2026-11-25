import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const helper = fileURLToPath(new URL('./verify-uvw', import.meta.url));
const repo = resolve(fileURLToPath(new URL('../../../..', import.meta.url)));
const spec = 'A={"x":1} opencode --standalone';
const secret = '{"x":1}';
const screen = 'opencode\n\n  Model Flash · high\n';

// Answers as herdr 0.9.5 does: JSON on stdout, or an error code on stderr with a non-zero exit.
const fakeHerdr = `const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_HERDR_LOG, JSON.stringify(args) + '\\n');
const fail = (code) => { console.error(JSON.stringify({ error: { code, message: code } })); process.exit(1); };
const verb = args.slice(0, 2).join(' ');
if (verb === 'tab create') console.log(JSON.stringify({ result: { tab: { tab_id: 'w9:t9' }, root_pane: { pane_id: 'w9:pB' } } }));
else if (verb === 'agent get') { if (process.env.FAKE_HERDR_ALIVE !== '1') fail('agent_not_found'); console.log('{"result":{}}'); }
else if (verb === 'agent prompt') {
  const file = /printf ok > (\\S+)/.exec(args[3])?.[1];
  if (file && process.env.FAKE_HERDR_RUNS_COMMAND === '1') fs.writeFileSync(file, 'ok');
  const status = process.env.FAKE_HERDR_STATUS ?? 'done';
  if (status === 'timeout') fail('timeout');
  console.log(JSON.stringify({ result: { agent: { agent_status: status } } }));
} else if (verb === 'agent start') {
  const starts = fs.readFileSync(process.env.FAKE_HERDR_LOG, 'utf8').split('\\n').filter((line) => line.startsWith('["agent","start"')).length;
  if (starts <= Number(process.env.FAKE_HERDR_BUSY ?? 0)) fail('agent_pane_busy');
  console.log('{"result":{}}');
} else if (verb === 'agent read') process.stdout.write(${JSON.stringify(screen)});
else console.log('{"result":{}}');
`;

// Answers as opencode 2.4.1 does, with one session in this repository that recorded the prompt herdr sent last.
const fakeOpencode = `const fs = require('node:fs');
const args = process.argv.slice(2);
if (process.env.A !== '{"x":1}') { console.error('opencode: started without the spec env'); process.exit(1); }
const prompt = fs.readFileSync(process.env.FAKE_HERDR_LOG, 'utf8').trim().split('\\n').map((line) => JSON.parse(line)).findLast((call) => call[1] === 'prompt')[3];
const secret = fs.readFileSync(process.env.VERIFY_UVW_ROOT + '/test/user.pw', 'utf8');
if (args[1] === 'list') console.log(JSON.stringify([{ id: 'ses_test', created: Date.now(), directory: ${JSON.stringify(realpathSync(repo))} }]));
else console.log(JSON.stringify({ info: { model: { id: 'model-x', providerID: 'provider-y' } }, messages: [
  { type: 'user', text: prompt }, { type: 'assistant', content: [{ type: 'text', text: 'Recorded LS1 as user ' + secret }] },
] }));
`;
const password = 'pw-delegate-secret';

function fixture(t) {
  const root = mkdtempSync(join(process.env.VERIFY_UVW_TEST_ROOT ?? tmpdir(), 'verify-uvw-delegate-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tools = join(root, 'tools'), log = join(root, 'herdr.log'), run = join(root, 'test');
  mkdirSync(join(run, 'evidence'), { recursive: true });
  mkdirSync(tools);
  writeFileSync(join(run, 'run.env'), 'RUN_ID=test\nWEB_PORT=1\nSERVER_PORT=1\nSERVER_PID=\nWEB_PID=\nGIT_HEAD=\n');
  writeFileSync(join(run, 'user.pw'), password);
  for (const [name, source] of [['herdr', fakeHerdr], ['opencode', fakeOpencode]]) {
    writeFileSync(join(tools, `fake-${name}.cjs`), source);
    writeFileSync(join(tools, name), `#!/bin/sh\nexec node '${join(tools, `fake-${name}.cjs`)}' "$@"\n`, { mode: 0o755 });
  }
  writeFileSync(join(tools, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const base = {
    ...process.env, PATH: `${tools}:${process.env.PATH}`, VERIFY_UVW_ROOT: root, VERIFY_UVW_RUN: 'test',
    XDG_CONFIG_HOME: join(root, 'config'), FAKE_HERDR_LOG: log, HERDR_ENV: '1', HERDR_WORKSPACE_ID: 'w9', VERIFY_UVW_VERIFIER: null,
  };
  const v = (args, env = {}) => spawnSync('bash', [helper, ...args], {
    env: Object.fromEntries(Object.entries({ ...base, ...env }).filter(([, value]) => value != null)), encoding: 'utf8',
  });
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : []);
  return { run, file: join(root, 'config/verify-uvw/verifier'), v, calls };
}

const verbs = (calls) => calls.map((args) => args.slice(0, 2).join(' '));
const after = (args, flag) => args[args.indexOf(flag) + 1];
const spoken = (result) => result.stdout + result.stderr;

test('verifier saves a spec only after its agent ran the smoke command and stopped, names its transcript, and shows it without env values', (t) => {
  const { run, file, v, calls } = fixture(t);
  const none = v(['verifier']);
  assert.equal(none.status, 1);
  assert.equal(none.stdout, 'verifier: none\n');

  const saved = v(['verifier', spec], { FAKE_HERDR_RUNS_COMMAND: '1' });
  assert.equal(saved.status, 0, saved.stderr);
  assert.equal(readFileSync(file, 'utf8').split('\n').find((line) => line.trim() && !line.startsWith('#')), spec);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.ok(saved.stdout.includes('  Model Flash · high\n'), 'the verifier screen shows its model');
  assert.ok(saved.stdout.includes('\ntranscript: opencode session ses_test\n'), saved.stdout);
  assert.ok(saved.stdout.endsWith(`verifier: opencode --standalone (env A) from ${file}\n`));
  assert.ok(!spoken(saved).includes(secret));
  const smoke = calls();
  assert.equal(after(smoke[0], '--env'), 'A={"x":1}', 'the smoke test runs with the spec env');
  assert.equal(after(smoke[0], '--label'), 'vu:setup');
  assert.equal(smoke.find((args) => args[1] === 'start')[2], 'setup-pb');
  const target = /printf ok > (\S+)/.exec(smoke.find((args) => args[1] === 'prompt')[3])[1];
  assert.ok(dirname(target).startsWith(`${dirname(run)}/verifier-smoke.`), 'the smoke file is under the run root, where evidence goes');
  assert.ok(!existsSync(dirname(target)), 'the smoke directory is removed');
  assert.deepEqual(smoke.at(-1), ['pane', 'close', 'w9:pB']);

  const before = readFileSync(file, 'utf8');
  for (const [env, reason] of [
    [{ FAKE_HERDR_RUNS_COMMAND: '0' }, /did not run the command; the screen above says why/],
    [{ FAKE_HERDR_RUNS_COMMAND: '1', FAKE_HERDR_STATUS: 'blocked' }, /waits for approval/],
    [{ FAKE_HERDR_RUNS_COMMAND: '1', FAKE_HERDR_STATUS: 'timeout' }, /did not stop within 5 minutes/],
  ]) {
    const n = calls().length;
    const failed = v(['verifier', 'B=2 codex --other'], env);
    assert.equal(failed.status, 1, failed.stdout);
    assert.match(failed.stderr, reason);
    assert.equal(readFileSync(file, 'utf8'), before, 'a failed smoke test keeps the saved verifier');
    assert.deepEqual(calls().slice(n).at(-1), ['pane', 'close', 'w9:pB']);
  }

  const override = v(['verifier'], { VERIFY_UVW_VERIFIER: 'B=2 codex --yolo' });
  assert.equal(override.stdout, 'verifier: codex --yolo (env B) from VERIFY_UVW_VERIFIER\n');
  const outside = v(['verifier'], { HERDR_ENV: null });
  assert.equal(outside.stdout, `verifier: opencode --standalone (env A) from ${file}; outside a herdr pane, delegate refuses\n`);
  assert.equal(v(['doctor']).stdout.trimEnd().split('\n').at(-1), `info  verifier: opencode --standalone (env A) from ${file}`);

  const unread = v(['verifier', 'aider --yes'], { FAKE_HERDR_RUNS_COMMAND: '1' });
  assert.equal(unread.status, 0, unread.stderr);
  assert.match(unread.stdout, /^transcript: unavailable \(no transcript reader for aider agents\); delegate saves the screen instead$/m);
  assert.ok(unread.stdout.endsWith(`verifier: aider --yes from ${file}\n`));

  const off = v(['verifier', 'off']);
  assert.equal(off.status, 0, off.stderr);
  assert.equal(off.stdout, 'verifier: none\n');
  assert.ok(!existsSync(file));
  assert.equal(v(['doctor']).stdout.trimEnd().split('\n').at(-1), 'info  verifier: none');
});

test('delegate refuses outside herdr, without a verifier, and when the brief refuses, all before it opens a tab', (t) => {
  const { v, calls } = fixture(t);
  const outside = v(['delegate', 'link-sharing', 'LS1'], { HERDR_ENV: null, VERIFY_UVW_VERIFIER: spec });
  assert.equal(outside.status, 1);
  assert.match(outside.stderr, /inside a herdr pane, or hand \$V brief to a subagent/);
  const none = v(['delegate', 'link-sharing', 'LS1']);
  assert.equal(none.status, 1);
  assert.match(none.stderr, /\$V verifier '<spec>'.*references\/delegate\.md#set-up/);
  const spans = v(['delegate', 'sheet-lens'], { VERIFY_UVW_VERIFIER: spec });
  assert.equal(spans.status, 2, 'sheet-lens spans three modes, and a brief takes one');
  assert.deepEqual(calls(), []);
});

test('delegate hands the saved verifier the brief unchanged, keeps its session transcript, closes its tab and prints coverage', (t) => {
  const { run, file, v, calls } = fixture(t);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `# a comment\n\n${spec}\n`);
  assert.equal(v(['verdict', 'LS1', 'PASS']).status, 0);
  const brief = v(['brief', 'link-sharing', 'LS1']);
  assert.equal(brief.status, 0, brief.stderr);

  const done = v(['delegate', 'link-sharing', 'LS1'], { FAKE_HERDR_BUSY: '2' });
  const journeys = v(['journeys', 'link-sharing', 'LS1']);
  assert.equal(journeys.status, 0);
  assert.match(journeys.stdout, /RESULT: PASS/);
  assert.equal(done.status, journeys.status, done.stderr);
  assert.equal(done.stdout, `verifier test-link-sharing-pb in tab "vu:test" (pane w9:pB): opencode --standalone (env A) from ${file}\n${journeys.stdout}`);
  assert.ok(!spoken(done).includes(secret));

  const seen = calls();
  const [tab] = seen;
  assert.equal(verbs([tab])[0], 'tab create');
  assert.equal(after(tab, '--workspace'), 'w9');
  assert.equal(after(tab, '--cwd'), repo);
  assert.equal(after(tab, '--label'), 'vu:test');
  assert.equal(after(tab, '--env'), 'A={"x":1}');
  assert.ok(tab.includes('--no-focus'), "the caller's tab keeps focus");
  assert.equal(verbs(seen).filter((verb) => verb === 'agent start').length, 3, 'a start the new shell refused is tried again');
  const start = seen.findLast((args) => args[1] === 'start');
  assert.equal(start[2], 'test-link-sharing-pb');
  assert.equal(after(start, '--kind'), 'opencode');
  assert.equal(after(start, '--pane'), 'w9:pB');
  assert.deepEqual(start.slice(start.indexOf('--')), ['--', '--standalone']);
  const prompt = seen.find((args) => args[1] === 'prompt');
  assert.equal(prompt[2], 'test-link-sharing-pb');
  assert.equal(prompt[3], brief.stdout, 'the verifier gets $V brief byte for byte');
  assert.deepEqual(verbs(seen.slice(seen.indexOf(prompt) + 1)), ['pane close'], 'the transcript needs no screen');
  assert.deepEqual(seen.at(-1), ['pane', 'close', 'w9:pB']);
  const transcript = readFileSync(join(run, 'evidence/test-link-sharing-pb.transcript.md'), 'utf8');
  assert.ok(transcript.startsWith('# opencode session ses_test\n'), transcript);
  assert.ok(transcript.includes(`**Brief:** identical to \`$V brief\` (${Buffer.byteLength(brief.stdout)} bytes)`), transcript);
  assert.ok(transcript.includes('Recorded LS1 as user [REDACTED]'), 'the transcript is evidence, so run secrets are redacted');
  assert.ok(!existsSync(join(run, 'evidence/test-link-sharing-pb.screen.txt')));
});

test('delegate saves the screen of a verifier whose agent kind has no transcript reader', (t) => {
  const { run, v, calls } = fixture(t);
  const done = v(['delegate', 'link-sharing', 'LS1'], { VERIFY_UVW_VERIFIER: 'aider --yes' });
  assert.match(done.stderr, /^warning: no transcript reader for aider agents; saving the verifier's screen instead$/m);
  assert.match(done.stdout, /^link-sharing in run test/m, 'coverage still prints');
  assert.equal(readFileSync(join(run, 'evidence/test-link-sharing-pb.screen.txt'), 'utf8'), screen);
  assert.ok(!existsSync(join(run, 'evidence/test-link-sharing-pb.transcript.md')));
  const read = calls().find((args) => args[1] === 'read');
  assert.equal(after(read, '--source'), 'recent-unwrapped');
  assert.deepEqual(calls().at(-1), ['pane', 'close', 'w9:pB']);
});

test('delegate keeps the tab of a verifier that did not stop, and refuses a second verifier while the first lives', (t) => {
  const { v, calls } = fixture(t);
  const env = { VERIFY_UVW_VERIFIER: spec };
  const blocked = v(['delegate', 'link-sharing', 'LS1'], { ...env, FAKE_HERDR_STATUS: 'blocked' });
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /waits for approval in tab "vu:test".*herdr pane close w9:pB/);
  assert.ok(!verbs(calls()).includes('pane close'));

  let n = calls().length;
  const second = v(['delegate', 'link-sharing', 'LS1'], { ...env, FAKE_HERDR_ALIVE: '1' });
  assert.equal(second.status, 1);
  assert.match(second.stderr, /verifier test-link-sharing-pb still drives run test/);
  assert.deepEqual(calls().slice(n), [['agent', 'get', 'test-link-sharing-pb']], 'no second tab opens');

  n = calls().length;
  const timedOut = v(['delegate', 'link-sharing', 'LS1'], { ...env, FAKE_HERDR_STATUS: 'timeout' });
  assert.equal(timedOut.status, 1);
  assert.ok(timedOut.stderr.includes(screen), 'the visible screen shows why');
  assert.match(timedOut.stderr, /herdr agent wait test-link-sharing-pb/);
  const later = verbs(calls().slice(n));
  assert.ok(later.includes('tab create'), 'a verifier that is gone no longer holds the run');
  assert.ok(!later.includes('pane close'));
});

test('delegate keeps the tab and exits 1 when the verifier stops while a story it started still runs', (t) => {
  const { run, v, calls } = fixture(t);
  const story = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)', join(dirname(helper), 'story.mjs'), repo, run, 'http://127.0.0.1:1', '', 'verify-test', 'model-x', '--as', 'b3', 'mp12-b3', 'mcp', 'prompt'], { stdio: 'ignore' });
  t.after(() => story.kill());
  const stopped = v(['delegate', 'link-sharing', 'LS1'], { VERIFY_UVW_VERIFIER: spec });
  assert.equal(stopped.status, 1);
  assert.match(stopped.stderr, new RegExp(`^ *${story.pid} .*story\\.mjs .* mp12-b3 mcp prompt$`, 'm'), stopped.stderr);
  assert.match(stopped.stderr, /stopped while the stories above still run; the tab stays open.*herdr pane close w9:pB/);
  assert.ok(!verbs(calls()).includes('pane close'), 'closing the tab would kill the story');
  assert.ok(!existsSync(join(run, 'evidence/test-link-sharing-pb.transcript.md')));
});

test('delegate names each verifier agent after its run and feature within herdr agent-name rules', (t) => {
  const { run, v, calls } = fixture(t);
  const names = {};
  for (const id of ['20261125-101500', 'amt-agent-mode-tasks-retry-2', 'AMC.run+1']) {
    const dir = join(dirname(run), `run-${id.length}`);
    mkdirSync(join(dir, 'evidence'), { recursive: true });
    writeFileSync(join(dir, 'run.env'), `RUN_ID='${id}'\nWEB_PORT=1\nSERVER_PORT=1\nSERVER_PID=\nWEB_PID=\nGIT_HEAD=\n`);
    const done = v(['delegate', 'link-sharing', 'LS1'], { VERIFY_UVW_VERIFIER: spec, VERIFY_UVW_RUN: `run-${id.length}` });
    assert.match(done.stdout, /^verifier \S+ in tab /, done.stderr);
    assert.equal(after(calls().findLast((args) => args[1] === 'create'), '--label'), `vu:${id}`);
    names[id] = calls().findLast((args) => args[1] === 'start')[2];
  }
  assert.deepEqual(names, {
    '20261125-101500': 'v20261125-101500-link-sharing-pb',
    'amt-agent-mode-tasks-retry-2': 'amt-agent-mode-tasks-retry-2-pb',
    'AMC.run+1': 'amc-run-1-link-sharing-pb',
  });
});
