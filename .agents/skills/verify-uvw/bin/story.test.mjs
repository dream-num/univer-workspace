import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { codexConfig, codexTrajectory, opencodeConfig, parseStory, shellSandbox, storyModel, trajectory } from './story.mjs';

test('story options: the prompt is one verbatim argument and the identity defaults to the run user', () => {
  assert.deepEqual(parseStory(['s1', 'mcp', '做一张带公式的预算表并把链接给我']), { as: 'human', oauth: false, label: 's1', client: 'mcp', prompt: '做一张带公式的预算表并把链接给我' });
  assert.deepEqual(parseStory(['--as', 'a1', 's1', 'uvw', '--help me\nplease']), { as: 'a1', oauth: false, label: 's1', client: 'uvw', prompt: '--help me\nplease' });
  assert.deepEqual(parseStory(['--oauth', '--as', 'g1', 's1', 'mcp', 'p']), { as: 'g1', oauth: true, label: 's1', client: 'mcp', prompt: 'p' });
  for (const invalid of [
    [], ['s1', 'mcp'], ['s1', 'mcp', ''], ['s1', 'mcp', 'p', 'extra'], ['../s1', 'mcp', 'p'], ['s1', 'browser', 'p'],
    ['--as', 'Agent One', 's1', 'mcp', 'p'], ['--as'], ['--model'], ['--model', '', 's1', 'mcp', 'p'], ['--model', '#high', 's1', 'mcp', 'p'],
    ['--model', 'x#', 's1', 'codex', 'p'], ['--model', 'x#high#max', 's1', 'codex', 'p'], ['--model', '--oauth', 's1', 'mcp', 'p'],
    ['--oauth', '--as', 'g1', 's1', 'codex', 'p'],
    ['--oauth', 's1', 'mcp', 'p'], ['--oauth', '--as', 'g1', 's1', 'uvw', 'p'],
  ]) assert.throws(() => parseStory(invalid), JSON.stringify(invalid));
});

test('model selection preserves the opencode default and splits Codex model and effort', () => {
  const fallback = 'console-deepseek/deepseek-flash#high';
  assert.deepEqual(storyModel(parseStory(['s1', 'mcp', 'p']), fallback), { model: fallback });
  assert.deepEqual(storyModel(parseStory(['--model', 'console-deepseek/deepseek-flash#max', 's1', 'mcp', 'p']), fallback), { model: 'console-deepseek/deepseek-flash#max' });
  assert.deepEqual(storyModel(parseStory(['s1', 'codex', 'p']), fallback), { model: 'gpt-6.1-sol', effort: 'high' });
  assert.deepEqual(storyModel(parseStory(['--as', 'a1', '--model', 'gpt-6.2-sol#xhigh', 's1', 'codex', 'p']), fallback), { model: 'gpt-6.2-sol', effort: 'xhigh' });
  assert.deepEqual(storyModel(parseStory(['--model', 'gpt-6.2-sol', 's1', 'codex', 'p']), fallback), { model: 'gpt-6.2-sol', effort: 'high' });
});

test('Codex config uses exactly one streamable HTTP server, an environment bearer, and read-only commands without approval', () => {
  const config = codexConfig({ mcpUrl: 'http://127.0.0.1:3938/mcp', model: 'gpt-6.1-sol', effort: 'high' });
  assert.match(config, /^model = "gpt-6.1-sol"\nmodel_reasoning_effort = "high"/);
  assert.match(config, /approval_policy = "never"\nsandbox_mode = "read-only"\nweb_search = "disabled"/);
  assert.match(config, /cli_auth_credentials_store = "file"/);
  assert.match(config, /exclude = \["VERIFY_UVW_MCP_BEARER"\]/);
  assert.deepEqual(config.match(/\[mcp_servers\.[^\]]+\]/g), ['[mcp_servers.univer-workspace]']);
  assert.match(config, /url = "http:\/\/127\.0\.0\.1:3938\/mcp"\nbearer_token_env_var = "VERIFY_UVW_MCP_BEARER"\nrequired = true/);
  assert.match(codexConfig({ mcpUrl: 'http://localhost/mcp?x="quoted"', model: 'custom', effort: 'low' }), /x=\\"quoted\\"/);
});

test('mcp mode gives opencode one server and denies every local tool it can deny', () => {
  const config = opencodeConfig({ client: 'mcp', mcpUrl: 'http://127.0.0.1:3930/mcp', bearer: 'token-1' });
  assert.deepEqual(config.mcp, { 'univer-workspace': { type: 'remote', url: 'http://127.0.0.1:3930/mcp', enabled: true, oauth: false, headers: { Authorization: 'Bearer token-1' } } });
  for (const tool of ['read', 'glob', 'grep', 'list', 'edit', 'write', 'bash', 'shell', 'webfetch', 'websearch', 'question', 'task', 'external_directory']) assert.equal(config.permission[tool], 'deny', tool);
  assert.deepEqual(new Set(Object.values(config.permission)), new Set(['deny']));
  // Without a bearer opencode signs in by OAuth itself.
  assert.deepEqual(opencodeConfig({ client: 'mcp', mcpUrl: 'http://127.0.0.1:3930/mcp' }).mcp['univer-workspace'], { type: 'remote', url: 'http://127.0.0.1:3930/mcp', enabled: true });
});

test('uvw mode has no MCP server, subagents or execute wrapper, keeps the shell, and confines file tools to the working and temp directories', () => {
  const config = opencodeConfig({ client: 'uvw', mcpUrl: 'http://127.0.0.1:3930/mcp', bearer: 'token-1', tmp: '/private/tmp/run/home/stories/uvw-a1/tmp' });
  assert.equal(config.mcp, undefined);
  assert.deepEqual(config.permission, { webfetch: 'deny', websearch: 'deny', question: 'deny', task: 'deny', subagent: 'deny', execute: 'deny', external_directory: { '*': 'deny', '/private/tmp/run/home/stories/uvw-a1/tmp/**': 'allow' } });
});

test('the uvw story shell is denied your home and the run root, then given back only what uvw needs, later rules winning', () => {
  const home = '/private/tmp/root/run/home/stories/uvw-a1';
  const rules = shellSandbox({ root: '/private/tmp/root', realHome: '/Users/dev', home, repo: '/Users/dev/repo', node: '/Users/dev/.nvm/node' }).trim().split('\n');
  assert.deepEqual(rules, [
    '(version 1)',
    '(allow default)',
    '(deny file-read-data file-write* (subpath "/Users/dev") (subpath "/private/tmp/root"))',
    `(allow file-read-data (subpath "/Users/dev/repo") (subpath "/Users/dev/.nvm/node") (subpath "${home}/.local/bin") (subpath "${home}/.local/lib"))`,
    '(deny file-read-data file-write* (subpath "/Users/dev/repo/.data"))',
    `(allow file-read-data file-write* (subpath "${home}/work") (subpath "${home}/tmp") (subpath "${home}/.univer-workspace-cli"))`,
  ]);
  assert.match(shellSandbox({ root: '/r', realHome: '/h', home: '/r/a "b"', repo: '/x', node: '/n' }), /\(subpath "\/r\/a \\"b\\"\/work"\)/);
});

// sandbox-exec matches resolved paths only: a rule spelled /tmp never matches /private/tmp, so story.mjs resolves every path.
test('under the profile zsh cannot read the run root but can read its working directory', { skip: !existsSync('/usr/bin/sandbox-exec') && 'no sandbox-exec' }, () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'verify-uvw-sandbox-')));
  try {
    const home = join(root, 'run/home/stories/uvw-a1');
    mkdirSync(join(home, 'work'), { recursive: true });
    writeFileSync(join(root, 'run/home/canary.txt'), 'denied-canary');
    writeFileSync(join(home, 'work/note.txt'), 'allowed-note');
    const profile = join(root, 'shell.sb');
    writeFileSync(profile, shellSandbox({ root, realHome: realpathSync(homedir()), home, repo: join(root, 'repo'), node: join(root, 'node') }));
    const cat = file => spawnSync('/usr/bin/sandbox-exec', ['-f', profile, '/bin/zsh', '-c', `cat ${JSON.stringify(file)}`], { encoding: 'utf8' });
    const denied = cat(join(root, 'run/home/canary.txt'));
    assert.notEqual(denied.status, 0);
    assert.doesNotMatch(denied.stdout, /denied-canary/);
    const allowed = cat(join(home, 'work/note.txt'));
    assert.deepEqual([allowed.status, allowed.stdout], [0, 'allowed-note']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

const use = (tool, state) => ({ type: 'tool_use', part: { tool, state } });
const text = value => ({ type: 'text', part: { text: value } });

test('trajectory lists MCP calls inside the execute wrapper, shell commands by exit code and refused tools', () => {
  const { lines, answer } = trajectory([
    { type: 'step_start' },
    text('I will look around first.'),
    use('execute', { status: 'completed', input: { code: 'return tools["univer-workspace"].whoami()' }, output: "Unknown tool namespace 'univer-workspace'.", metadata: { metadata: { error: true, toolCalls: [] } } }),
    use('execute', { status: 'completed', input: { code: '...' }, metadata: { metadata: { toolCalls: [
      { tool: 'search', status: 'completed', input: { query: 'whoami' } },
      { tool: 'univer-workspace.whoami', status: 'completed' },
      { tool: 'univer-workspace.api_find', status: 'error', input: { query: 'set\nValues' } },
    ] } } }),
    use('shell', { status: 'completed', input: { command: 'uvw auth guest --json;\n  echo "exit=$?"' }, metadata: { metadata: { exit: 0 } } }),
    use('shell', { status: 'completed', input: { command: 'uvw unit create' }, metadata: { metadata: { exit: 1 } } }),
    use('read', { status: 'error', input: { path: '/tmp/x.png' }, error: 'Permission denied: external_directory' }),
    text('Draft answer before the last call.'),
    use('skill', { status: 'completed', input: { id: 'univer-workspace-cli' } }),
    text('The sheet is ready:'),
    text('http://127.0.0.1:5973/nodes/abc'),
    { type: 'step_finish' },
  ]);
  assert.deepEqual(lines, [
    `error  execute  {"code":"return tools[\\"univer-workspace\\"].whoami()"} -> Unknown tool namespace 'univer-workspace'.`,
    'ok     search  {"query":"whoami"}',
    'ok     univer-workspace.whoami  {}',
    'error  univer-workspace.api_find  {"query":"set\\nValues"}',
    'ok     shell [exit 0]  uvw auth guest --json; echo "exit=$?"',
    'error  shell [exit 1]  uvw unit create',
    'error  read  {"path":"/tmp/x.png"} -> Permission denied: external_directory',
    'ok     skill  {"id":"univer-workspace-cli"}',
  ]);
  assert.equal(answer, 'The sheet is ready:\nhttp://127.0.0.1:5973/nodes/abc');
});

test('a run without tool calls answers with everything the model wrote, and a long input stays on one short line', () => {
  assert.deepEqual(trajectory([text('one'), text('two')]), { lines: [], answer: 'one\ntwo' });
  const [line] = trajectory([use('write', { status: 'completed', input: { content: 'x'.repeat(1000) } })]).lines;
  assert.equal(line.length, 'ok     write  '.length + 300);
});

test('a story refuses bad input and a label that already has evidence before it touches the run', () => {
  const run = mkdtempSync(join(tmpdir(), 'verify-uvw-story-'));
  const story = (...args) => spawnSync(process.execPath, [fileURLToPath(new URL('./story.mjs', import.meta.url)), 'repo', run, 'http://127.0.0.1:1', '', '', 'model', ...args], { encoding: 'utf8' });
  try {
    mkdirSync(join(run, 'evidence/taken'), { recursive: true });
    const taken = story('taken', 'uvw', 'prompt');
    assert.equal(taken.status, 2);
    assert.match(taken.stderr, /story taken already has evidence; a rerun is another attempt and needs its own label/);
    assert.equal(story('s1', 'mcp').status, 2);
    assert.match(story('s1', 'mcp', 'prompt').stderr, /MCP not enabled for this run/);
    assert.match(story('s1', 'codex', 'prompt').stderr, /MCP not enabled for this run/);
    assert.match(story('s1', 'uvw', 'prompt').stderr, existsSync('/usr/bin/sandbox-exec') ? /no user; run: verify-uvw user/ : /a uvw story sandboxes its shell with macOS sandbox-exec, which this machine does not have/);
    assert.deepEqual(readdirSync(run), ['evidence']);
    assert.deepEqual(readdirSync(join(run, 'evidence')), ['taken']);
  } finally { rmSync(run, { recursive: true, force: true }); }
});

const completed = item => ({ type: 'item.completed', item });
test('Codex trajectory records each settled MCP call and command once, errors included, then the final answer', () => {
  const who = { type: 'mcp_tool_call', server: 'univer-workspace', tool: 'whoami', arguments: {}, status: 'completed', result: { content: [] } };
  assert.deepEqual(codexTrajectory([
    { type: 'item.started', item: who },
    completed({ type: 'agent_message', text: 'Checking.' }),
    completed(who),
    completed({ ...who, tool: 'inspect', status: 'failed', error: { message: 'Denied\nby server' } }),
    completed({ type: 'command_execution', command: 'echo\nhello', status: 'completed', exit_code: 0 }),
    completed({ type: 'command_execution', command: 'false', status: 'completed', exit_code: 1 }),
    completed({ type: 'command_execution', command: 'touch blocked', status: 'declined', exit_code: null }),
    completed({ type: 'agent_message', text: 'Verify models' }),
  ]), { lines: [
    'ok     univer-workspace.whoami  {}',
    'error  univer-workspace.inspect  {} -> Denied by server',
    'ok     shell [exit 0]  echo hello',
    'error  shell [exit 1]  false',
    'error  shell [exit ?]  touch blocked',
  ], answer: 'Verify models' });
  assert.deepEqual(codexTrajectory([completed({ type: 'agent_message', text: 'one' }), completed({ type: 'agent_message', text: 'two' })]), { lines: [], answer: 'one\ntwo' });
});

test('Codex stories isolate credentials, select human/principal bearer, and write redacted evidence without a model', () => {
  const run = mkdtempSync(join(tmpdir(), 'verify-uvw-codex-'));
  try {
    for (const path of ['source', 'bin', 'home/principals', 'evidence']) mkdirSync(join(run, path), { recursive: true });
    writeFileSync(join(run, 'source/auth.json'), JSON.stringify({ tokens: { access_token: 'codex-access-secret', refresh_token: 'codex-refresh-secret' } }));
    writeFileSync(join(run, 'home/mcp-token'), 'human-bearer-secret');
    writeFileSync(join(run, 'home/principals/a1.token'), 'principal-bearer-secret');
    writeFileSync(join(run, 'bin/codex'), `#!${process.execPath}
const fs = require('node:fs');
if (process.argv.includes('--version')) { console.log('codex-cli test'); process.exit(0); }
fs.writeFileSync(process.env.HOME + '/observed.json', JSON.stringify({ args: process.argv.slice(2), bearer: process.env.VERIFY_UVW_MCP_BEARER, cwd: process.cwd(), files: fs.readdirSync('.'), home: process.env.CODEX_HOME }));
console.log(JSON.stringify({ type: 'item.completed', item: { type: 'mcp_tool_call', server: 'univer-workspace', tool: 'whoami', arguments: {}, status: 'completed', result: { content: [{ text: process.env.VERIFY_UVW_MCP_BEARER }] } } }));
console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'identity codex-access-secret' } }));
console.error('codex-refresh-secret');
`, { mode: 0o755 });
    for (const as of ['human', 'a1']) {
      const result = spawnSync(process.execPath, [fileURLToPath(new URL('./story.mjs', import.meta.url)), 'repo', run, 'http://127.0.0.1:5981', 'http://127.0.0.1:3938/mcp', 'verify-models', 'old-default#high', '--as', as, `s-${as}`, 'codex', '--verbatim\nprompt'], {
        encoding: 'utf8', env: { ...process.env, PATH: `${join(run, 'bin')}:${process.env.PATH}`, CODEX_HOME: join(run, 'source') },
      });
      assert.equal(result.status, 0, result.stderr);
      const home = join(realpathSync(run), 'home/stories', `codex-${as}`);
      const observed = JSON.parse(readFileSync(join(home, 'observed.json')));
      assert.deepEqual(observed.args, ['--no-daemon', 'exec', '--strict-config', '--skip-git-repo-check', '--ephemeral', '--ignore-rules', '--json', '--color', 'never', '--', '--verbatim\nprompt']);
      assert.equal(observed.bearer, as === 'human' ? 'human-bearer-secret' : 'principal-bearer-secret');
      assert.equal(observed.cwd, join(home, 'work', `s-${as}`));
      assert.deepEqual(observed.files, []);
      assert.equal(observed.home, join(home, '.codex'));
      assert.equal(statSync(join(home, '.codex/auth.json')).mode & 0o777, 0o600);
      const evidence = join(run, 'evidence', `s-${as}`);
      assert.deepEqual(readdirSync(evidence).sort(), ['answer.txt', 'codex-stderr.txt', 'prompt.txt', 'run-meta.json', 'trajectory.txt', 'transcript.jsonl']);
      const meta = JSON.parse(readFileSync(join(evidence, 'run-meta.json')));
      assert.equal(meta.model, 'gpt-6.1-sol');
      assert.equal(meta.effort, 'high');
      assert.equal(meta.client, 'codex');
      assert.equal(meta.identity, as);
      assert.equal(meta.exit_code, 0);
      assert.equal(meta.timed_out, false);
      assert.equal(typeof meta.duration_seconds, 'number');
      assert.equal(readFileSync(join(evidence, 'prompt.txt'), 'utf8'), '--verbatim\nprompt');
      assert.match(readFileSync(join(evidence, 'trajectory.txt'), 'utf8'), /^ok     univer-workspace.whoami  \{\}/);
      for (const file of readdirSync(evidence)) assert.doesNotMatch(readFileSync(join(evidence, file), 'utf8'), /human-bearer-secret|principal-bearer-secret|codex-access-secret|codex-refresh-secret/);
    }
  } finally { rmSync(run, { recursive: true, force: true }); }
});
