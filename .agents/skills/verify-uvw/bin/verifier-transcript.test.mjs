import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const cli = fileURLToPath(new URL('./verifier-transcript.mjs', import.meta.url));
const brief = 'Follow a written recipe…\n\nRun journeys LS1 and LS2, then stop.\n';
const since = Date.now() - 24 * 60 * 60 * 1000;
const fenced = (text, ticks = '```') => `${ticks}\n${text}\n${ticks}`;

const fakeOpencode = `const fs = require('node:fs');
const args = process.argv.slice(2);
const answer = args[1] === 'list' ? 'list' : args[1] === 'export' ? args.at(-1) : null;
if (!answer) process.exit(1);
process.stdout.write(fs.readFileSync(require('node:path').join(process.env.FAKE_OPENCODE, answer + '.json')));
`;

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'verifier-transcript-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'repo');
  mkdirSync(repo);
  writeFileSync(join(root, 'brief.txt'), brief);
  const run = (kind, env = {}, extra = []) => spawnSync(process.execPath, [
    cli, '--kind', kind, '--repo', repo, '--since', String(since), '--prompt-file', join(root, 'brief.txt'), ...extra,
  ], { encoding: 'utf8', env: { ...process.env, ...env } });
  // The agent records the physical directory, which differs from the temp path on macOS.
  return { root, run, repo: realpathSync(repo) };
}

function opencodeHome(root, sessions) {
  const dir = join(root, 'opencode');
  mkdirSync(dir);
  writeFileSync(join(dir, 'fake-opencode.cjs'), fakeOpencode);
  writeFileSync(join(dir, 'opencode'), `#!/bin/sh\nexec node '${join(dir, 'fake-opencode.cjs')}' "$@"\n`, { mode: 0o755 });
  writeFileSync(join(dir, 'list.json'), JSON.stringify(sessions.map(({ id, created, directory }) => ({ id, title: id, created, updated: created, directory }))));
  for (const { id, messages } of sessions) {
    writeFileSync(join(dir, `${id}.json`), JSON.stringify({ info: { id, model: { id: 'model-x', providerID: 'provider-y', variant: 'high' } }, messages }));
  }
  return { PATH: `${dir}:${process.env.PATH}`, FAKE_OPENCODE: dir };
}

test('opencode: reads the earliest session in the repository that began with the brief, after since', (t) => {
  const { root, run, repo } = fixture(t);
  writeFileSync(join(root, 'user.pw'), 'pw-run-secret-42');
  const said = (text) => [{ type: 'user', text }, { type: 'assistant', content: [{ type: 'text', text: 'Wrong session.' }] }];
  const env = opencodeHome(root, [
    { id: 'ses_later', created: since + 3000, directory: repo, messages: said(brief) },
    { id: 'ses_match', created: since + 2000, directory: repo, messages: [
      { type: 'user', text: `  ${brief.replaceAll(' ', '  ')}\n\n` },
      { type: 'assistant', content: [
        { type: 'reasoning', text: 'Private chain of thought.' },
        { type: 'text', text: 'Starting with LS1.' },
        { type: 'tool', name: 'shell', state: { status: 'completed', input: { command: 'seq 1 45' }, content: [{ type: 'text', text: Array.from({ length: 45 }, (_, i) => i + 1).join('\n') }], metadata: { exit: 0, truncated: false } } },
        { type: 'tool', name: 'read', state: { status: 'completed', input: { path: '/r/SKILL.md' }, content: [{ type: 'text', text: '```bash\nV=1\n```' }, { type: 'image', data: 'iVBORw0KGgoAAAANSUhEUg' }], metadata: { truncated: false } } },
        { type: 'tool', name: 'shell', state: { status: 'completed', input: { command: 'cat user.pw; uvw auth token' }, content: [{ type: 'text', text: 'pw-run-secret-42\nuvw_pat_abcdef0123456789' }], metadata: { exit: 2 } } },
      ] },
      { type: 'synthetic', text: 'The server restarted while you were working.' },
      { type: 'assistant', content: [{ type: 'text', text: 'LS1 and LS2 PASS.' }] },
      { type: 'idle', outcome: 'succeeded' },
    ] },
    { id: 'ses_other_prompt', created: since + 1000, directory: repo, messages: said('Run this shell command, then stop.') },
    { id: 'ses_other_directory', created: since + 500, directory: join(root, 'elsewhere'), messages: said(brief) },
    { id: 'ses_before', created: since - 60000, directory: repo, messages: said(brief) },
  ]);

  const result = run('opencode', env, ['--run', root]);
  assert.equal(result.status, 0, result.stderr);
  const out = result.stdout;
  assert.ok(out.startsWith('# opencode session ses_match\n\nModel: provider-y/model-x#high\n'), out);
  assert.ok(!out.includes('Wrong session.'));
  assert.ok(out.includes(`**Brief:** identical to \`$V brief\` (${Buffer.byteLength(brief)} bytes)`));
  assert.ok(!out.includes('Run journeys LS1'), 'the brief itself is not repeated');
  assert.ok(!out.includes('Private chain of thought.'));
  assert.ok(!out.includes('server restarted'));
  assert.ok(out.includes('Starting with LS1.') && !out.includes('**Final answer:**\n\nStarting'));
  const ones = Array.from({ length: 40 }, (_, i) => i + 1).join('\n');
  assert.ok(out.includes(`**shell** (exit 0)\n\n${fenced('seq 1 45')}\n\n${fenced(ones)}\n… 5 more lines\n`), out);
  assert.ok(out.includes(`**read**\n\n${fenced('{"path":"/r/SKILL.md"}')}\n\n${fenced('```bash\nV=1\n```\n[image]', '````')}`), out);
  assert.ok(!out.includes('iVBORw0KGgo'));
  assert.ok(out.includes('**shell** (exit 2)'));
  assert.ok(!out.includes('pw-run-secret-42') && !out.includes('uvw_pat_abcdef'), 'a run secret and a token are redacted');
  assert.ok(out.endsWith('**Final answer:**\n\nLS1 and LS2 PASS.\n'));
});

test('codex: reads the rollout in the repository that holds the brief after codex instructions, and pairs outputs to calls', (t) => {
  const { root, run, repo } = fixture(t);
  const home = join(root, 'codex');
  const at = (offset) => new Date(since + offset).toISOString();
  const day = (time) => join(home, 'sessions', String(time.getFullYear()), String(time.getMonth() + 1).padStart(2, '0'), String(time.getDate()).padStart(2, '0'));
  const rollout = (dir, id, offset, cwd, items, tail = '') => {
    mkdirSync(dir, { recursive: true });
    const lines = [
      { timestamp: at(offset), type: 'session_meta', payload: { id, timestamp: at(offset), cwd, cli_version: '0.172.0', model_provider: 'provider-y' } },
      { timestamp: at(offset), type: 'turn_context', payload: { cwd, model: 'model-x', effort: 'high' } },
      { timestamp: at(offset), type: 'event_msg', payload: { type: 'task_started' } },
      ...items.map((payload) => ({ timestamp: at(offset), type: 'response_item', payload })),
    ];
    writeFileSync(join(dir, `rollout-${id}.jsonl`), lines.map((line) => JSON.stringify(line)).join('\n') + '\n' + tail);
  };
  const message = (role, text, phase) => ({ type: 'message', role, content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text }], ...(phase && { phase }) });
  const said = (text) => [message('user', text), message('assistant', 'Wrong session.', 'final_answer')];

  rollout(day(new Date(since)), 'before', -60000, repo, said(brief));
  rollout(day(new Date(since)), 'other-directory', 500, join(root, 'elsewhere'), said(brief));
  // A codex that is still writing, such as the orchestrator itself, leaves a torn last line.
  rollout(day(new Date(since)), 'other-prompt', 1000, repo, said('Run this shell command, then stop.'), '{"timestamp":"');
  rollout(day(new Date()), 'a-later', 3000, repo, said(brief));
  rollout(day(new Date()), 'match', 2000, repo, [
    message('developer', 'You are Codex.'),
    message('user', `# AGENTS.md instructions for ${repo}\n\n<INSTRUCTIONS>Read me.</INSTRUCTIONS>`),
    message('user', brief),
    message('developer', 'The approval policy changed.'),
    { type: 'reasoning', summary: [{ type: 'summary_text', text: 'Private chain of thought.' }] },
    message('assistant', 'I will run the journeys.', 'commentary'),
    { type: 'custom_tool_call', call_id: 'c1', name: 'exec', input: 'text(await tools.exec_command({cmd:"seq 1 3"}))\n' },
    { type: 'function_call', call_id: 'c2', name: 'shell', arguments: '{"command":["ls"]}' },
    { type: 'custom_tool_call_output', call_id: 'c1', output: [
      { type: 'input_text', text: 'Script completed\nWall time 0.0 seconds\nOutput:\n' },
      { type: 'input_text', text: JSON.stringify({ chunk_id: 'a1', exit_code: 0, output: '1\n2\n3\n' }) },
    ] },
    { type: 'function_call_output', call_id: 'c2', output: 'file-a\nfile-b' },
    message('assistant', 'LS1 PASS.', 'final_answer'),
  ]);

  const result = run('codex', { CODEX_HOME: home });
  assert.equal(result.status, 0, result.stderr);
  const out = result.stdout;
  assert.ok(out.startsWith('# codex session match\n\nModel: provider-y/model-x#high\n'), out);
  assert.ok(!out.includes('Wrong session.'));
  assert.ok(!out.includes('AGENTS.md instructions') && !out.includes('You are Codex.'));
  assert.ok(!out.includes('approval policy'));
  assert.ok(!out.includes('Private chain of thought.'));
  assert.ok(out.includes(`**Brief:** identical to \`$V brief\` (${Buffer.byteLength(brief)} bytes)\n\nI will run the journeys.\n`), out);
  assert.ok(out.includes(`**exec** (exit 0)\n\n${fenced('text(await tools.exec_command({cmd:"seq 1 3"}))')}\n\n${fenced('1\n2\n3')}\n`), out);
  assert.ok(!out.includes('Script completed'));
  assert.ok(out.includes(`**shell**\n\n${fenced('{"command":["ls"]}')}\n\n${fenced('file-a\nfile-b')}\n`), out);
  assert.ok(out.endsWith('**Final answer:**\n\nLS1 PASS.\n'));
});

test('an agent kind without a reader exits 3, and no matching session exits 1, each with one line on stderr', (t) => {
  const { root, run } = fixture(t);
  for (const kind of ['aider', 'constructor']) {
    const unknown = run(kind);
    assert.equal(unknown.status, 3);
    assert.equal(unknown.stdout, '');
    assert.equal(unknown.stderr, `no transcript reader for ${kind} agents\n`);
  }

  const none = run('opencode', opencodeHome(root, []));
  assert.equal(none.status, 1);
  assert.equal(none.stdout, '');
  assert.match(none.stderr, /^cannot read the opencode session: no opencode session in .+\n$/);
  const empty = run('codex', { CODEX_HOME: join(root, 'no-codex') });
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /^cannot read the codex session: no codex session in .+\n$/);
});
