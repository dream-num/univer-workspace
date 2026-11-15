import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { opencodeConfig, parseStory, shellSandbox, trajectory } from './story.mjs';

test('story options: the prompt is one verbatim argument and the identity defaults to the run user', () => {
  assert.deepEqual(parseStory(['s1', 'mcp', '做一张带公式的预算表并把链接给我']), { as: 'human', oauth: false, label: 's1', client: 'mcp', prompt: '做一张带公式的预算表并把链接给我' });
  assert.deepEqual(parseStory(['--as', 'a1', 's1', 'uvw', '--help me\nplease']), { as: 'a1', oauth: false, label: 's1', client: 'uvw', prompt: '--help me\nplease' });
  assert.deepEqual(parseStory(['--oauth', '--as', 'g1', 's1', 'mcp', 'p']), { as: 'g1', oauth: true, label: 's1', client: 'mcp', prompt: 'p' });
  for (const invalid of [
    [], ['s1', 'mcp'], ['s1', 'mcp', ''], ['s1', 'mcp', 'p', 'extra'], ['../s1', 'mcp', 'p'], ['s1', 'browser', 'p'],
    ['--as', 'Agent One', 's1', 'mcp', 'p'], ['--as'], ['--model', 'x', 's1', 'mcp', 'p'],
    ['--oauth', 's1', 'mcp', 'p'], ['--oauth', '--as', 'g1', 's1', 'uvw', 'p'],
  ]) assert.throws(() => parseStory(invalid), JSON.stringify(invalid));
});

test('mcp mode gives opencode one server and denies every local tool it can deny', () => {
  const config = opencodeConfig({ client: 'mcp', mcpUrl: 'http://127.0.0.1:3930/mcp', bearer: 'token-1' });
  assert.deepEqual(config.mcp, { 'univer-workspace': { type: 'remote', url: 'http://127.0.0.1:3930/mcp', enabled: true, oauth: false, headers: { Authorization: 'Bearer token-1' } } });
  for (const tool of ['read', 'glob', 'grep', 'list', 'edit', 'write', 'bash', 'shell', 'webfetch', 'websearch', 'question', 'task', 'external_directory']) assert.equal(config.permission[tool], 'deny', tool);
  assert.deepEqual(new Set(Object.values(config.permission)), new Set(['deny']));
  // Without a bearer opencode signs in by OAuth itself.
  assert.deepEqual(opencodeConfig({ client: 'mcp', mcpUrl: 'http://127.0.0.1:3930/mcp' }).mcp['univer-workspace'], { type: 'remote', url: 'http://127.0.0.1:3930/mcp', enabled: true });
});

test('uvw mode has no MCP server or subagents, keeps the shell, and confines file tools to the working and temp directories', () => {
  const config = opencodeConfig({ client: 'uvw', mcpUrl: 'http://127.0.0.1:3930/mcp', bearer: 'token-1', tmp: '/private/tmp/run/home/stories/uvw-a1/tmp' });
  assert.equal(config.mcp, undefined);
  assert.deepEqual(config.permission, { webfetch: 'deny', websearch: 'deny', question: 'deny', task: 'deny', subagent: 'deny', external_directory: { '*': 'deny', '/private/tmp/run/home/stories/uvw-a1/tmp/**': 'allow' } });
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
    assert.match(story('s1', 'uvw', 'prompt').stderr, /no user; run: verify-uvw user/);
    assert.deepEqual(readdirSync(run), ['evidence']);
    assert.deepEqual(readdirSync(join(run, 'evidence')), ['taken']);
  } finally { rmSync(run, { recursive: true, force: true }); }
});
