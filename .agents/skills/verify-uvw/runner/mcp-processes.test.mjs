import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { freePorts } from './mcp-processes.mjs';

const script = fileURLToPath(new URL('./mcp-processes.mjs', import.meta.url));
const helper = fileURLToPath(new URL('../bin/verify-uvw', import.meta.url));
const compose = readFileSync(new URL('../../../../apps/mcp/docker/compose.verify.yml', import.meta.url), 'utf8');
const dockerfile = readFileSync(new URL('../../../../apps/mcp/Dockerfile', import.meta.url), 'utf8');
const browser = { UNIVER_RENDER_BROWSER: '/usr/bin/chromium' };

function makeRun(root, settings = {}, allowlist) {
  const run = join(root, 'run');
  mkdirSync(join(run, 'home'), { recursive: true });
  mkdirSync(join(run, 'logs'));
  const values = { RUN_ID: 'run', SERVER_PORT: '3950', WEB_PORT: '6001', SERVER_PID: '2147483646', WEB_PID: '2147483646', MCP_ENABLED: '1',
    MCP_RENDERER: '1', MCP_PRODUCTION: '0', MCP_SYNC_BUDGET_MS: '30000', MCP_FROM: 'dist', MCP_PORT: '3955',
    MCP_PUBLIC_URL: 'http://127.0.0.1:3955/mcp', MCP_EXECUTORS: '1', MCP_EXECUTOR_PORT: '41001', MCP_RENDERER_PORT: '41002',
    MCP_EXECUTOR_B_PORT: '41003', ...settings };
  writeFileSync(join(run, 'run.env'), Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
  for (const name of ['metrics-token', 'executor-token', 'renderer-token', 'mcp-oauth-secret']) writeFileSync(join(run, 'home', name), `${name}-value\n`);
  if (allowlist !== undefined) writeFileSync(join(run, 'executor-allowed-user-ids'), `${allowlist}\n`);
  return run;
}

function withRun(settings, allowlist, body) {
  const root = mkdtempSync(join(tmpdir(), 'verify-uvw-processes-'));
  try { return body(makeRun(root, settings, allowlist)); } finally { rmSync(root, { recursive: true, force: true }); }
}

const processes = (args, env = {}, file = script) => spawnSync(process.execPath, [file, ...args],
  { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, ...browser, ...env } });

function roleEnv(run, role, env) {
  const result = processes(['exec', run, role, '--', process.execPath, '-e', 'process.stdout.write(JSON.stringify(process.env))'], env);
  assert.equal(result.status, 0, result.stderr);
  // macOS CoreFoundation adds this to the environment of every process that loads it, node included.
  const { __CF_USER_TEXT_ENCODING, ...seen } = JSON.parse(result.stdout);
  return seen;
}

// Variable names under each service's environment, read by indentation; executor-b extends executor.
function composeVariables(text) {
  const services = {}, base = {};
  let inServices = false, service, section;
  for (const line of text.split('\n').filter((l) => l.trim())) {
    const indent = line.length - line.trimStart().length, key = line.trim().split(':')[0];
    if (indent === 0) inServices = key === 'services';
    else if (!inServices) continue;
    else if (indent === 2) services[service = key] = [];
    else if (indent === 4) section = key;
    else if (indent === 6 && section === 'environment') services[service].push(key);
    else if (indent === 6 && section === 'extends' && key === 'service') base[service] = line.split(':')[1].trim();
  }
  for (const [service, from] of Object.entries(base)) services[service].push(...services[from]);
  return services;
}

function drift(composeText, run) {
  return Object.entries(composeVariables(composeText)).flatMap(([service, names]) => {
    const set = Object.keys(roleEnv(run, service)).filter((name) => !['PATH', 'HOME', 'UNIVER_RENDER_BROWSER'].includes(name));
    return [...names.filter((n) => !set.includes(n)).map((n) => `${service} lacks ${n}`), ...set.filter((n) => !names.includes(n)).map((n) => `${service} adds ${n}`)];
  });
}

test('each role sets exactly the variables of its compose.verify.yml service', () => withRun({ MCP_EXECUTORS: '2' }, 'user-a', (run) => {
  assert.match(dockerfile, /^ENV UNIVER_RENDER_BROWSER=/m, 'the image, not compose, sets the renderer browser');
  assert.deepEqual(drift(compose, run), []);
  const added = compose.replace('      RENDERER_MAX_RUNTIMES:', '      RENDERER_IDLE_MS: "1"\n      RENDERER_MAX_RUNTIMES:');
  assert.deepEqual(drift(added, run), ['renderer lacks RENDERER_IDLE_MS']);
}));

test('roles reach each other and Workspace on loopback, with only this run\'s values', () => withRun({ MCP_EXECUTORS: '2' }, undefined, (run) => {
  const pollution = { MCP_RENDERER_URL: 'http://pollution', MCP_DEV_SESSION_PASSTHROUGH: 'pollution', EXECUTOR_MAX_WORKERS: '9', RENDERER_MAX_RUNTIMES: '3' };
  const base = { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'development', HOST: '127.0.0.1', LOG_LEVEL: 'info' };
  const workspace = { WORKSPACE_ORIGIN: 'http://127.0.0.1:6001', WORKSPACE_TRANSPORT_URL: 'http://127.0.0.1:3950' };
  assert.deepEqual(roleEnv(run, 'gateway', pollution), { ...base, ...workspace, MCP_ROLE: 'gateway', PORT: '3955',
    MCP_STAGING_DIRECTORY: join(run, 'staging'), MCP_SYNC_BUDGET_MS: '30000', MCP_DEV_SESSION_PASSTHROUGH: '1',
    MCP_OAUTH_CLIENT_ID: 'univer-workspace-mcp-gateway', MCP_OAUTH_CLIENT_SECRET: 'mcp-oauth-secret-value',
    MCP_EXECUTOR_URLS: 'http://127.0.0.1:41001,http://127.0.0.1:41003', MCP_EXECUTOR_TOKEN: 'executor-token-value',
    MCP_PUBLIC_URL: 'http://127.0.0.1:3955/mcp', METRICS_TOKEN: 'metrics-token-value' });
  assert.deepEqual(roleEnv(run, 'executor-b', pollution), { ...base, ...workspace, MCP_ROLE: 'executor', PORT: '41003',
    MCP_EXECUTOR_CREDENTIALS: 'session', EXECUTOR_MAX_WORKERS: '9', EXECUTOR_IDLE_TTL_MS: '60000', MCP_EXECUTOR_TOKEN: 'executor-token-value',
    MCP_RENDERER_URL: 'http://127.0.0.1:41002', MCP_RENDERER_TOKEN: 'renderer-token-value' });
  assert.deepEqual(roleEnv(run, 'renderer'), { ...base, ...browser, MCP_ROLE: 'renderer', PORT: '41002',
    MCP_RENDERER_TOKEN: 'renderer-token-value', METRICS_TOKEN: 'metrics-token-value', RENDERER_MAX_RUNTIMES: '2' });
  assert.equal(roleEnv(run, 'renderer', pollution).RENDERER_MAX_RUNTIMES, '3');
}));

test('renderer off, production, one executor and an empty allowlist drop their variables', () => {
  withRun({ MCP_RENDERER: '0', MCP_PRODUCTION: '1' }, '', (run) => {
    const executor = roleEnv(run, 'executor'), gateway = roleEnv(run, 'gateway');
    for (const name of ['MCP_RENDERER_URL', 'MCP_RENDERER_TOKEN', 'MCP_EXECUTOR_ALLOWED_USER_IDS']) assert.equal(executor[name], undefined, name);
    for (const name of ['MCP_DEV_SESSION_PASSTHROUGH', 'MCP_EXECUTOR_ALLOWED_USER_IDS']) assert.equal(gateway[name], undefined, name);
    assert.equal(gateway.MCP_EXECUTOR_URLS, 'http://127.0.0.1:41001');
    assert.deepEqual([executor.NODE_ENV, gateway.NODE_ENV], ['production', 'production']);
    for (const role of ['renderer', 'executor-b']) {
      const result = processes(['exec', run, role, '--', 'true']);
      assert.equal(result.status, 1);
      assert.match(result.stderr, new RegExp(`MCP role ${role} is not part of this run`));
    }
  });
  withRun({ MCP_PRODUCTION: '1' }, 'verify-uvw-pending-user', (run) => {
    for (const role of ['gateway', 'executor']) assert.equal(roleEnv(run, role).MCP_EXECUTOR_ALLOWED_USER_IDS, 'verify-uvw-pending-user', role);
    assert.equal(roleEnv(run, 'renderer').MCP_EXECUTOR_ALLOWED_USER_IDS, undefined);
  });
  withRun({}, undefined, (run) => {
    assert.equal(roleEnv(run, 'executor').MCP_EXECUTOR_ALLOWED_USER_IDS, undefined);
    const result = processes(['exec', run, 'renderer', '--', 'true'], { UNIVER_RENDER_BROWSER: '' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /UNIVER_RENDER_BROWSER is not set/);
  });
});

test('ports gives each internal role a distinct free port that the run does not already use', async () => {
  for (const [settings, names] of [[{}, ['MCP_RENDERER_PORT', 'MCP_EXECUTOR_PORT']], [{ MCP_RENDERER: '0', MCP_EXECUTORS: '2' }, ['MCP_EXECUTOR_PORT', 'MCP_EXECUTOR_B_PORT']]]) {
    withRun(settings, undefined, (run) => {
      const result = processes(['ports', run]);
      assert.equal(result.status, 0, result.stderr);
      const lines = result.stdout.trim().split('\n').map((line) => line.split('='));
      assert.deepEqual(lines.map(([name]) => name), names);
      const ports = lines.map(([, port]) => Number(port));
      assert.equal(new Set(ports).size, ports.length);
      for (const port of ports) assert(port > 0 && ![3950, 6001, 3955].includes(port), `port ${port}`);
    });
  }
  const offers = [3955, 6001, 41010, 3950, 41011], closed = [];
  const open = async () => { const port = offers.shift(); return { address: () => ({ port }), close: () => closed.push(port) }; };
  assert.deepEqual(await freePorts(2, [3955, 3950, 6001], open), [41010, 41011]);
  assert.deepEqual(closed, [3955, 6001, 41010, 3950, 41011]);
});

const fakeRole = `
const worker = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
require('node:http').createServer((request, response) => response.end('ok')).listen(Number(process.env.PORT), process.env.HOST, () =>
  console.log(JSON.stringify({ role: process.env.MCP_ROLE, worker: worker.pid, allowlist: process.env.MCP_EXECUTOR_ALLOWED_USER_IDS ?? null, runtimes: process.env.RENDERER_MAX_RUNTIMES ?? null })));
if (process.env.MCP_ROLE === 'renderer') setTimeout(() => console.log('Renderer runtime warmed'), 200);
`;

test('verify-uvw starts, restarts and stops dist roles as whole process groups', async () => {
  const root = mkdtempSync(join(tmpdir(), 'verify-uvw-dist-'));
  const bin = join(root, 'repo/.agents/skills/verify-uvw/bin'), runner = join(root, 'repo/.agents/skills/verify-uvw/runner'), tools = join(root, 'tools');
  for (const dir of [bin, runner, join(root, 'repo/apps/mcp/dist'), tools]) mkdirSync(dir, { recursive: true });
  copyFileSync(script, join(runner, 'mcp-processes.mjs'));
  copyFileSync(helper, join(bin, 'verify-uvw'));
  writeFileSync(join(root, 'repo/apps/mcp/dist/main.js'), fakeRole);
  writeFileSync(join(tools, 'agent-browser'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const [gatewayPort, executorPort, rendererPort] = await freePorts(3, []);
  const run = makeRun(join(root, 'runs'), { MCP_PORT: gatewayPort, MCP_PUBLIC_URL: `http://127.0.0.1:${gatewayPort}/mcp`, MCP_EXECUTOR_PORT: executorPort, MCP_RENDERER_PORT: rendererPort });
  mkdirSync(join(run, 'staging'), { mode: 0o700 });
  const env = { ...process.env, ...browser, PATH: `${tools}:${process.env.PATH}`, VERIFY_UVW_ROOT: join(root, 'runs'), VERIFY_UVW_RUN: 'run' };
  const V = (...args) => spawnSync('bash', [join(bin, 'verify-uvw'), ...args], { env, encoding: 'utf8' });
  const pid = (role) => existsSync(join(run, `mcp-${role}.pid`)) ? Number(readFileSync(join(run, `mcp-${role}.pid`), 'utf8')) : undefined;
  const alive = (target) => { try { process.kill(target, 0); return true; } catch { return false; } };
  const current = () => {
    const lines = V('mcp-logs').stdout.split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line));
    assert.equal(new Set(lines.map((line) => line.role)).size, lines.length, 'mcp-logs shows only the current process of each role');
    return Object.fromEntries(lines.map((line) => [line.role, line]));
  };
  try {
    assert.equal(processes(['start', run], {}, join(runner, 'mcp-processes.mjs')).status, 0);
    const first = { gateway: pid('gateway'), executor: pid('executor'), renderer: pid('renderer') };
    assert(Object.values(first).every(alive), 'every role runs');
    assert.equal((await fetch(`http://127.0.0.1:${gatewayPort}/healthz`)).status, 200);
    const workers = Object.fromEntries(Object.entries(current()).map(([role, line]) => [role, line.worker]));
    assert.deepEqual(Object.keys(workers).sort(), ['executor', 'gateway', 'renderer']);

    const allowed = V('mcp-allow-users', 'user-a');
    assert.equal(allowed.status, 0, allowed.stderr);
    assert.notEqual(pid('executor'), first.executor);
    assert.notEqual(pid('gateway'), first.gateway);
    assert.equal(pid('renderer'), first.renderer);
    for (const role of ['executor', 'gateway']) assert(!alive(-first[role]) && !alive(workers[role]), `${role}'s old process group stopped`);
    const after = current();
    assert.deepEqual([after.executor.allowlist, after.gateway.allowlist, after.renderer.allowlist], ['user-a', 'user-a', null]);
    assert.equal(readFileSync(join(run, 'logs/mcp-executor.log'), 'utf8').match(/"role":"executor"/g).length, 2, 'the log keeps the first process');

    const restarted = V('renderer-restart', '3');
    assert.equal(restarted.status, 0, restarted.stderr);
    assert.match(restarted.stdout, /renderer restarted with RENDERER_MAX_RUNTIMES=3/);
    assert.notEqual(pid('renderer'), first.renderer);
    assert.equal(current().renderer.runtimes, '3');

    const live = ['gateway', 'executor', 'renderer'].map(pid);
    const down = V('down');
    assert.equal(down.status, 0, down.stderr);
    assert.match(down.stdout, /^ok {4}MCP resources removed$/m);
    assert(live.every((leader) => !alive(-leader)), 'down stops every role');
    assert(['gateway', 'executor', 'renderer'].every((role) => pid(role) === undefined) && !existsSync(join(run, 'staging')));
  } finally {
    processes(['stop', run], {}, join(runner, 'mcp-processes.mjs'));
    rmSync(root, { recursive: true, force: true });
  }
});
