#!/usr/bin/env node
// verify-uvw story [--as <identity>] [--oauth] [--model <id[#effort]>] <label> mcp|uvw|codex <prompt>
// Runs one prompt with opencode or Codex in a throwaway home and records it under evidence/<label>/.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { storyCredential } from './opencode-credential.mjs';
import { credentialSecrets, redact, runSecrets } from './secrets.mjs';

// The name the README gives the server, so the model sees what a user who followed it sees.
const SERVER = 'univer-workspace';
const TIMEOUT_MS = 30 * 60_000;

export function parseStory(argv) {
  const rest = [...argv];
  let as = 'human', oauth = false, model;
  while (rest[0]?.startsWith('--')) {
    const flag = rest.shift();
    if (flag === '--oauth') oauth = true;
    else if (flag === '--model' && /^[^\s#]+(?:#[^\s#]+)?$/.test(rest[0] ?? '') && !rest[0].startsWith('-')) model = rest.shift();
    else if (flag === '--as' && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(rest[0] ?? '')) as = rest.shift();
    else throw new Error(`Unknown or invalid option ${flag}`);
  }
  const [label, client, prompt] = rest;
  if (rest.length !== 3 || !/^[A-Za-z0-9._-]{1,64}$/.test(label) || !['mcp', 'uvw', 'codex'].includes(client) || !prompt) throw new Error('Invalid label, client or prompt');
  if (oauth && (client !== 'mcp' || as === 'human')) throw new Error('--oauth signs opencode in as a new guest agent; it needs mcp and a named identity');
  return { as, oauth, label, client, prompt, ...(model ? { model } : {}) };
}

/** Opencode keeps its variant in the model ID; Codex takes effort as a separate config value. */
export function storyModel({ client, model }, fallback) {
  if (client !== 'codex') return { model: model ?? fallback };
  const [name, effort = 'high'] = (model ?? 'gpt-6.1-sol').split('#');
  return { model: name, effort };
}

export function codexConfig({ mcpUrl, model, effort }) {
  return `model = ${JSON.stringify(model)}
model_reasoning_effort = ${JSON.stringify(effort)}
approval_policy = "never"
sandbox_mode = "read-only"
web_search = "disabled"
cli_auth_credentials_store = "file"
project_doc_max_bytes = 0
[shell_environment_policy]
inherit = "core"
exclude = ["VERIFY_UVW_MCP_BEARER"]
[features]
apps = false
plugins = false
multi_agent = false
[mcp_servers.${SERVER}]
url = ${JSON.stringify(mcpUrl)}
bearer_token_env_var = "VERIFY_UVW_MCP_BEARER"
required = true
`;
}

/** An mcp story keeps opencode's `execute` wrapper: it carries the MCP calls, with `fetch`, `search` and `tools.opencode.*` beside them. */
export function opencodeConfig({ client, mcpUrl, bearer, tmp }) {
  const deny = names => Object.fromEntries(names.map(name => [name, 'deny']));
  // Models keep their scripts and screenshots in opencode's temp directory, so file tools may use it too.
  // opencode's built-in explore subagent allows every external directory.
  // Inside `execute`, tools.opencode.session_move changes the working directory, and read and glob then reach any file there.
  if (client === 'uvw') return { $schema: 'https://opencode.ai/config.json', permission: { ...deny(['webfetch', 'websearch', 'question', 'task', 'subagent', 'execute']), external_directory: { '*': 'deny', [`${tmp}/**`]: 'allow' } } };
  return {
    $schema: 'https://opencode.ai/config.json',
    mcp: { [SERVER]: { type: 'remote', url: mcpUrl, enabled: true, ...(bearer ? { oauth: false, headers: { Authorization: `Bearer ${bearer}` } } : {}) } },
    permission: deny(['read', 'glob', 'grep', 'list', 'edit', 'write', 'bash', 'shell', 'webfetch', 'websearch', 'question', 'task', 'subagent', 'skill', 'lsp', 'external_directory']),
  };
}

/**
 * A sandbox-exec profile for the uvw story shell. opencode's per-command shell rules cannot hold it:
 * `uvw "$(< file)"`, `X=$(<file)` and zsh's bare `< file` read files without a denied command.
 * The shell sees its own working, temp and uvw directories, the checkout without `.data`, and node.
 */
export function shellSandbox({ root, realHome, home, repo, node }) {
  const paths = list => list.map(path => `(subpath ${JSON.stringify(path)})`).join(' ');
  return [
    '(version 1)',
    '(allow default)',
    `(deny file-read-data file-write* ${paths([realHome, root])})`,
    `(allow file-read-data ${paths([repo, node, join(home, '.local/bin'), join(home, '.local/lib')])})`,
    `(deny file-read-data file-write* ${paths([join(repo, '.data')])})`,
    `(allow file-read-data file-write* ${paths([join(home, 'work'), join(home, 'tmp'), join(home, '.univer-workspace-cli')])})`,
  ].join('\n') + '\n';
}

/** One line per tool call or shell command, and the text the model wrote after its last call. */
export function trajectory(events) {
  const brief = value => (typeof value === 'string' ? value : JSON.stringify(value ?? {})).replace(/\s+/g, ' ').slice(0, 300);
  const line = (ok, tool, detail) => `${ok ? 'ok   ' : 'error'}  ${tool}  ${detail}`;
  const lines = [];
  let answer = [];
  for (const event of events) {
    if (event.type === 'text') answer.push(event.part?.text ?? '');
    if (event.type !== 'tool_use') continue;
    answer = [];
    const { tool, state = {} } = event.part ?? {};
    // opencode reports a wrapper whose code threw as completed, with metadata.error set.
    const ok = state.status === 'completed' && state.metadata?.metadata?.error !== true;
    // opencode carries MCP calls and its own helpers inside one `execute` call.
    const calls = state.metadata?.metadata?.toolCalls ?? [];
    for (const call of calls) lines.push(line(call.status === 'completed', call.tool, brief(call.input)));
    if (state.input?.command !== undefined) {
      const exit = state.metadata?.metadata?.exit;
      lines.push(line(ok && exit === 0, `${tool} [exit ${exit ?? '?'}]`, brief(state.input.command)));
    } else if (!calls.length || !ok) {
      lines.push(line(ok, tool, `${brief(state.input)}${ok ? '' : ` -> ${brief(state.error ?? state.output)}`}`));
    }
  }
  return { lines, answer: answer.join('\n') };
}

/** Codex emits started/updated/completed items; only settled items belong in the trajectory. */
export function codexTrajectory(events) {
  const lines = [];
  let answer = [];
  const brief = value => (typeof value === 'string' ? value : JSON.stringify(value ?? {})).replace(/\s+/g, ' ').slice(0, 300);
  for (const event of events) {
    if (event.type !== 'item.completed') continue;
    const item = event.item ?? {};
    if (item.type === 'agent_message') answer.push(item.text ?? '');
    if (!['mcp_tool_call', 'command_execution'].includes(item.type)) continue;
    answer = [];
    const ok = item.status === 'completed' && !item.error && (item.type !== 'command_execution' || item.exit_code === 0);
    const tool = item.type === 'mcp_tool_call' ? `${item.server}.${item.tool}` : `shell [exit ${item.exit_code ?? '?'}]`;
    const detail = item.type === 'mcp_tool_call' ? item.arguments : item.command;
    lines.push(`${ok ? 'ok   ' : 'error'}  ${tool}  ${brief(detail)}${item.error ? ` -> ${brief(item.error.message)}` : ''}`);
  }
  return { lines, answer: answer.join('\n') };
}

async function main() {
  const [repo, run, origin, mcpUrl, username, defaultModel, ...argv] = process.argv.slice(2);
  const fail = (message, code = 1) => { console.error(`verify-uvw: ${message}`); process.exit(code); };
  let story;
  try { story = parseStory(argv); } catch (error) { fail(`${error.message}\nusage: verify-uvw story [--as <identity>] [--oauth] [--model <id[#effort]>] <label> mcp|uvw|codex <prompt>`, 2); }
  const { as, oauth, label, client, prompt } = story;
  const { model, effort } = storyModel(story, defaultModel);
  const evidence = join(run, 'evidence', label);
  if (existsSync(evidence)) fail(`story ${label} already has evidence; a rerun is another attempt and needs its own label, for example ${label}-attempt2`, 2);
  if (client !== 'uvw' && !mcpUrl) fail('MCP not enabled for this run; start with VERIFY_UVW_MCP=1');
  if (client === 'uvw' && !existsSync('/usr/bin/sandbox-exec')) fail('a uvw story sandboxes its shell with macOS sandbox-exec, which this machine does not have');
  const secret = name => existsSync(join(run, 'home', name)) ? readFileSync(join(run, 'home', name), 'utf8').trim() : undefined;
  const bearer = client === 'uvw' || oauth ? undefined : secret(as === 'human' ? 'mcp-token' : `principals/${as}.token`);
  if (client !== 'uvw' && !oauth && !bearer) fail(as === 'human' ? 'no PAT for the run user; run: verify-uvw user' : `no principal ${as}; run: verify-uvw principal ${as}${client === 'mcp' ? ", or pass --oauth to sign opencode in as a new guest agent" : ''}`);
  if (oauth && secret(`principals/${as}.token`)) fail(`${as} is a principal with a token; give the OAuth guest another name`);
  if (client === 'uvw' && as === 'human' && !username) fail('no user; run: verify-uvw user');

  // One throwaway HOME per client and identity, so an identity keeps its sign-in across stories.
  mkdirSync(join(run, 'home/stories'), { recursive: true, mode: 0o700 });
  const made = join(run, 'home/stories', `${client}-${as}`);
  mkdirSync(made, { recursive: true, mode: 0o700 });
  // The real path everywhere: opencode confines file tools to the working directory by its resolved spelling.
  const home = realpathSync(made);
  for (const directory of ['.config/opencode', '.local/share', '.local/state', '.cache', 'tmp', 'work']) mkdirSync(join(home, directory), { recursive: true });
  const scratch = join(home, 'work', label);
  if (existsSync(scratch)) fail(`story ${label} already ran as ${as}; a rerun needs its own label`, 2);
  const env = {
    PATH: `${join(home, '.local/bin')}:${process.env.PATH}`, HOME: home, TMPDIR: join(home, 'tmp'), TERM: 'dumb', LANG: process.env.LANG ?? 'en_US.UTF-8',
    XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, '.local/share'), XDG_STATE_HOME: join(home, '.local/state'), XDG_CACHE_HOME: join(home, '.cache'),
    // opencode runs its shell tool as `$SHELL -c <command>`.
    ...(client === 'uvw' ? { UNIVER_HOME: join(home, '.univer-workspace-cli'), SHELL: join(home, '.local/libexec/zsh') } : {}),
  };
  const opencode = (args, options = {}) => spawnSync('opencode', args, { cwd: home, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
  let credential;
  if (client === 'codex') {
    env.CODEX_HOME = join(home, '.codex');
    env.VERIFY_UVW_MCP_BEARER = bearer;
    mkdirSync(env.CODEX_HOME, { recursive: true, mode: 0o700 });
    const credential = join(run, 'home/codex-credential.json');
    const source = existsSync(credential) ? credential : join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'auth.json');
    if (!existsSync(source)) fail('Codex has no auth.json credential; sign in with codex login first');
    let credentials;
    try { credentials = JSON.parse(readFileSync(source, 'utf8')); } catch { fail('Codex auth.json is not valid JSON'); }
    if (!credentialSecrets(credentials).length) fail('Codex auth.json has no stored credential');
    if (!existsSync(credential)) writeFileSync(credential, JSON.stringify(credentials), { mode: 0o600 });
    if (!existsSync(join(env.CODEX_HOME, 'auth.json'))) cpSync(credential, join(env.CODEX_HOME, 'auth.json'));
    chmodSync(join(env.CODEX_HOME, 'auth.json'), 0o600);
    writeFileSync(join(env.CODEX_HOME, 'config.toml'), codexConfig({ mcpUrl, model, effort }), { mode: 0o600 });
  } else {
    writeFileSync(join(home, '.config/opencode/opencode.json'), `${JSON.stringify(opencodeConfig({ client, mcpUrl, bearer, tmp: env.TMPDIR }), null, 2)}\n`, { mode: 0o600 });

    try { credential = storyCredential(run, model); } catch (error) { fail(error.message); }
    // A named variable cannot replace the story's own HOME, PATH or XDG directories.
    Object.assign(env, { ...credential.vars, ...env });
    // A credential already in this HOME is skipped, so a token opencode refreshed here stays.
    if (credential.file && opencode(['auth', 'import', '--standalone', credential.file]).status !== 0) fail('opencode could not import the model credential');
  }

  if (client === 'uvw') {
    // The wrapper names only this home. The link target is the checkout's CLI build, which a determined model can still resolve.
    for (const directory of ['.local/bin', '.local/lib', '.local/libexec']) mkdirSync(join(home, directory), { recursive: true });
    if (!existsSync(join(home, '.local/lib/uvw'))) symlinkSync(join(repo, 'apps/cli/dist'), join(home, '.local/lib/uvw'));
    const node = realpathSync(process.execPath);
    writeFileSync(join(home, '.local/bin/uvw'), `#!/bin/sh\nexec "${node}" "${join(home, '.local/lib/uvw/main.js')}" "$@"\n`, { mode: 0o755 });
    writeFileSync(join(home, '.local/libexec/shell.sb'), shellSandbox({ root: realpathSync(dirname(run)), realHome: realpathSync(homedir()), home, repo: realpathSync(repo), node: dirname(dirname(node)) }));
    writeFileSync(env.SHELL, `#!/bin/sh\nexec /usr/bin/sandbox-exec -f "${join(home, '.local/libexec/shell.sb')}" /bin/zsh "$@"\n`, { mode: 0o755 });
    cpSync(join(repo, 'skills/univer-workspace-cli'), join(home, '.config/opencode/skills/univer-workspace-cli'), { recursive: true });
    const uvw = (args, input) => execFileSync(join(home, '.local/bin/uvw'), args, { env, input, stdio: ['pipe', 'ignore', 'inherit'] });
    const firstStory = !existsSync(env.UNIVER_HOME);
    // An earlier story's model can rewrite this home's config; without an origin uvw targets production.
    uvw(['config', 'set', 'workspace.origin', origin]);
    if (firstStory && as === 'human') uvw(['auth', 'login', '--username', username, '--password-stdin', '--json'], readFileSync(join(run, 'user.pw')));
  }

  mkdirSync(scratch);
  mkdirSync(evidence);
  writeFileSync(join(evidence, 'prompt.txt'), prompt);
  const clean = text => redact(text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ''), runSecrets(run));
  const signedIn = join(run, 'home/stories', `mcp-${as}.oauth`);
  if (oauth && !existsSync(signedIn)) {
    try { await signInAsGuest({ origin, session: `verify-uvw-${basename(run)}-story-${as}`, home, evidence, opencode, env }); }
    catch (error) { fail(`${clean(error.message)}; evidence ${evidence}`); }
    writeFileSync(signedIn, '');
  }

  const started = Date.now();
  const options = { cwd: scratch, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: TIMEOUT_MS, maxBuffer: 1 << 30 };
  const result = client === 'codex'
    ? spawnSync('codex', ['--no-daemon', 'exec', '--strict-config', '--skip-git-repo-check', '--ephemeral', '--ignore-rules', '--json', '--color', 'never', '--', prompt], options)
    : opencode(['run', '--standalone', '--auto', '--format', 'json', '-m', model, '--', prompt], options);
  const seconds = Math.round((Date.now() - started) / 1000);

  // Only redacted text leaves memory.
  const transcript = clean(result.stdout ?? '');
  const { lines, answer } = (client === 'codex' ? codexTrajectory : trajectory)(transcript.split('\n').flatMap(text => { try { return [JSON.parse(text)]; } catch { return []; } }));
  writeFileSync(join(evidence, 'transcript.jsonl'), transcript);
  writeFileSync(join(evidence, client === 'codex' ? 'codex-stderr.txt' : 'opencode-stderr.txt'), clean((result.stderr ?? '') + (result.error ? `\n${result.error.message}` : '')));
  writeFileSync(join(evidence, 'answer.txt'), answer);
  writeFileSync(join(evidence, 'trajectory.txt'), `${lines.join('\n')}\n\n=== final answer ===\n${answer}\n`);
  const meta = {
    label, client, identity: as, auth: client === 'uvw' ? (as === 'human' ? 'uvw session of the run user' : 'uvw with the origin configured; the identity signs in itself') : oauth ? 'opencode OAuth as a new guest agent, with no page' : as === 'human' ? 'PAT of the run user' : 'PAT of the agent principal',
    model, ...(client === 'codex' ? { effort, codex: spawnSync('codex', ['--version'], { env, encoding: 'utf8' }).stdout.trim() } : {
      opencode: opencode(['--version']).stdout.trim(),
      model_credential: credential.file ? `opencode export of ${credential.integration}` : `shell variables ${Object.keys(credential.vars).join(', ')}`,
    }), started_at: new Date(started).toISOString(), duration_seconds: seconds,
    exit_code: result.status, timed_out: result.error?.code === 'ETIMEDOUT',
  };
  writeFileSync(join(evidence, 'run-meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  console.log(`${lines.length} tool calls, exit ${result.status}, ${seconds} s; evidence ${evidence}`);
  process.exitCode = result.status === 0 ? 0 : 1;
}

/** opencode's own `mcp auth`, as a user would run it, in a signed-out browser that gets a guest agent's code with no page. */
async function signInAsGuest({ origin, session, home, evidence, opencode, env }) {
  const browser = (...a) => {
    // Arguments carry the authorize URL with its state, so a failure names only the subcommand.
    try { return execFileSync('agent-browser', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000, env: { ...process.env, AGENT_BROWSER_SESSION: session } }); }
    catch { throw new Error(`agent-browser ${a[0]} failed during the guest agent sign-in`); }
  };
  // `mcp auth` runs in opencode's background service; give this home its own port and stop it afterwards.
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise(resolve => probe.close(resolve));
  if (opencode(['service', 'set', 'port', String(port)]).status !== 0) throw new Error('opencode service set port failed');
  const log = join(home, 'tmp/mcp-auth.log');
  const file = openSync(log, 'w', 0o600);
  const auth = spawn('opencode', ['mcp', 'auth', SERVER, '--print-logs'], { cwd: home, env, stdio: ['ignore', file, file] });
  const exited = new Promise(resolve => auth.on('exit', resolve));
  try {
    let url;
    for (let i = 0; i < 60 && !url; i++) {
      await sleep(1000);
      url = readFileSync(log, 'utf8').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').match(/https?:\/\/[^\s"'<>]+\/api\/auth\/authorize\?[^\s"'<>]+/)?.[0];
    }
    if (!url?.startsWith(`${origin}/`)) throw new Error('opencode mcp auth printed no authorize URL for this run');
    try { browser('close'); } catch {}
    browser('open', `${origin}/login`);
    browser('storage', 'local', 'set', 'univer-workspace-language', 'en-US');
    browser('open', url);
    if (browser('get', 'text', 'body').includes('AGENT_CREATE_RATE_LIMITED')) throw new Error(`authorize says this address reached an hourly limit: either ${process.env.VERIFY_UVW_AGENT_LIMIT_REASON || 'agent creation, which a higher VERIFY_UVW_AGENT_CREATE_LIMIT before up raises'}, or the server's fixed limit on client metadata checks`);
    browser('wait', '--url', 'http://127.0.0.1:*/callback?*');
    const callback = new URL(browser('get', 'url').trim());
    writeFileSync(join(evidence, 'oauth-callback.json'), `${JSON.stringify({ client_id: new URL(url).searchParams.get('client_id'), code_present: callback.searchParams.has('code'), iss: callback.searchParams.get('iss'), scope: callback.searchParams.get('scope'), error: callback.searchParams.get('error') }, null, 2)}\n`);
    await Promise.race([exited, sleep(60000, undefined, { ref: false })]);
  } finally {
    try { browser('close'); } catch {}
    auth.kill();
    closeSync(file);
    opencode(['service', 'stop']);
  }
  const connected = /Connected to /.test(readFileSync(log, 'utf8'));
  // The log holds the authorize URL with its state.
  rmSync(log);
  if (!connected) throw new Error('opencode mcp auth did not connect');
}

// The helper reaches this file through /tmp, which macOS resolves to /private/tmp.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
