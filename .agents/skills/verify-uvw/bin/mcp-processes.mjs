#!/usr/bin/env node
// The MCP roles as local processes for the dist start mode, which runs only inside the verify runner.
// Usage: mcp-processes.mjs ports <run> | start <run> [role...] | stop <run> [role...] | pid <run> <role>
//        | exec <run> <role> -- <command...> | logs <run> [role...]
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const mcpDir = fileURLToPath(new URL('../../../../apps/mcp/', import.meta.url));
const START = '--- verify-uvw mcp-processes start ';
const loopback = (port) => `http://127.0.0.1:${port}`;
const fail = (message) => { throw new Error(message); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const production = (c) => c.run.MCP_PRODUCTION === '1';
const rendererOn = (run) => (run.MCP_RENDERER || '1') === '1';
const shared = (c) => ({ NODE_ENV: production(c) ? 'production' : 'development', HOST: '127.0.0.1', LOG_LEVEL: 'info' });
const workspace = (c) => ({ WORKSPACE_ORIGIN: `http://127.0.0.1:${c.run.WEB_PORT}`, WORKSPACE_TRANSPORT_URL: loopback(c.run.SERVER_PORT) });
// An empty MCP_EXECUTOR_ALLOWED_USER_IDS fails the executor's configuration, so an empty allowlist is no variable.
const allowlist = (c) => (c.allowlist ? { MCP_EXECUTOR_ALLOWED_USER_IDS: c.allowlist } : {});
const executor = (port) => (c) => ({
  ...allowlist(c), MCP_ROLE: 'executor', ...shared(c), MCP_EXECUTOR_CREDENTIALS: 'session',
  EXECUTOR_MAX_WORKERS: c.env.EXECUTOR_MAX_WORKERS || '4', EXECUTOR_IDLE_TTL_MS: c.env.EXECUTOR_IDLE_TTL_MS || '60000',
  MCP_EXECUTOR_TOKEN: c.secret('executor-token'),
  ...(rendererOn(c.run) ? { MCP_RENDERER_URL: loopback(c.run.MCP_RENDERER_PORT), MCP_RENDERER_TOKEN: c.secret('renderer-token') } : {}),
  PORT: c.run[port], ...workspace(c),
});

// One entry per role in start order. Each env mirrors its service in apps/mcp/docker/compose.verify.yml and
// mcp_compose in verify-uvw, with service names and host.docker.internal replaced by this run's loopback ports.
const roles = [
  { name: 'renderer', port: 'MCP_RENDERER_PORT', enabled: rendererOn, env: (c) => ({
    MCP_ROLE: 'renderer', ...shared(c), MCP_RENDERER_TOKEN: c.secret('renderer-token'), METRICS_TOKEN: c.secret('metrics-token'),
    RENDERER_MAX_RUNTIMES: c.env.RENDERER_MAX_RUNTIMES || '2', PORT: c.run.MCP_RENDERER_PORT,
    // apps/mcp/Dockerfile sets this for the image; the runner image sets it for this process.
    UNIVER_RENDER_BROWSER: c.env.UNIVER_RENDER_BROWSER || fail('UNIVER_RENDER_BROWSER is not set; the renderer needs the path of a Chromium executable'),
  }) },
  { name: 'executor', port: 'MCP_EXECUTOR_PORT', enabled: () => true, env: executor('MCP_EXECUTOR_PORT') },
  { name: 'executor-b', port: 'MCP_EXECUTOR_B_PORT', enabled: (run) => run.MCP_EXECUTORS === '2', env: executor('MCP_EXECUTOR_B_PORT') },
  { name: 'gateway', port: 'MCP_PORT', enabled: () => true, env: (c) => ({
    MCP_STAGING_DIRECTORY: join(c.dir, 'staging'), MCP_SYNC_BUDGET_MS: c.run.MCP_SYNC_BUDGET_MS || '30000', ...allowlist(c),
    MCP_ROLE: 'gateway', ...shared(c), ...(production(c) ? {} : { MCP_DEV_SESSION_PASSTHROUGH: '1' }),
    MCP_OAUTH_CLIENT_ID: 'univer-workspace-mcp-gateway', MCP_OAUTH_CLIENT_SECRET: c.secret('mcp-oauth-secret'),
    MCP_EXECUTOR_URLS: active(c.run).filter((role) => role.name.startsWith('executor')).map((role) => loopback(c.run[role.port])).join(','),
    MCP_EXECUTOR_TOKEN: c.secret('executor-token'), PORT: c.run.MCP_PORT, ...workspace(c),
    MCP_PUBLIC_URL: c.run.MCP_PUBLIC_URL || `http://127.0.0.1:${c.run.MCP_PORT}/mcp`, METRICS_TOKEN: c.secret('metrics-token'),
  }) },
];

const active = (run) => roles.filter((role) => role.enabled(run));

function context(dir) {
  const run = Object.fromEntries(readFileSync(join(dir, 'run.env'), 'utf8').split('\n').filter((line) => line.includes('='))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
  const file = join(dir, 'executor-allowed-user-ids');
  return { dir, run, env: process.env, allowlist: existsSync(file) ? readFileSync(file, 'utf8').trim() : '',
    secret: (name) => readFileSync(join(dir, 'home', name), 'utf8').trim() };
}

function select(run, names) {
  const live = active(run);
  return names.length ? names.map((name) => live.find((role) => role.name === name) ?? fail(`MCP role ${name} is not part of this run`)) : live;
}

// Only PATH, HOME and the role's own variables, as each compose container sees only its own environment.
const processEnv = (role, c) => ({ PATH: process.env.PATH, HOME: process.env.HOME, ...role.env(c) });
const pidFile = (dir, name) => join(dir, `mcp-${name}.pid`);
const logFile = (dir, name) => join(dir, 'logs', `mcp-${name}.log`);
const signal = (pid, name) => { try { process.kill(pid, name); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
async function gone(pid, ms) {
  for (const end = Date.now() + ms; alive(pid); await sleep(100)) if (Date.now() > end) return false;
  return true;
}

// Holds every port until all are chosen, so they differ, and skips the ports this run already uses.
export async function freePorts(count, reserved, open = listenLoopback) {
  const held = [], ports = [];
  try {
    while (ports.length < count) {
      const server = await open();
      held.push(server);
      if (!reserved.includes(server.address().port)) ports.push(server.address().port);
    }
  } finally { for (const server of held) server.close(); }
  return ports;
}
const listenLoopback = () => new Promise((resolve, reject) => {
  const server = createServer();
  server.once('error', reject).listen(0, '127.0.0.1', () => resolve(server));
});

async function ports(dir) {
  const { run } = context(dir);
  const internal = active(run).filter((role) => role.port !== 'MCP_PORT');
  const chosen = await freePorts(internal.length, ['MCP_PORT', 'SERVER_PORT', 'WEB_PORT', 'AGENT_PORT'].map((key) => Number(run[key])).filter(Boolean));
  for (const [i, role] of internal.entries()) console.log(`${role.port}=${chosen[i]}`);
}

async function stop(dir, name) {
  if (!existsSync(pidFile(dir, name))) return;
  const pid = Number(readFileSync(pidFile(dir, name), 'utf8'));
  if (!Number.isInteger(pid) || pid <= 1) fail(`${pidFile(dir, name)} holds no process id`);
  // Each role leads its own process group, so its workers stop with it. Chromium leads its own group; the renderer closes it on SIGTERM.
  signal(-pid, 'SIGTERM');
  if (!(await gone(-pid, 5000))) {
    signal(-pid, 'SIGKILL');
    if (!(await gone(-pid, 2000))) fail(`MCP ${name} process group ${pid} survived SIGKILL`);
  }
  rmSync(pidFile(dir, name));
}

async function start(dir, names) {
  const c = context(dir);
  for (const role of select(c.run, names)) {
    const env = processEnv(role, c);
    await stop(dir, role.name);
    appendFileSync(logFile(dir, role.name), `${START}${role.name} ${new Date().toISOString()}\n`);
    const log = openSync(logFile(dir, role.name), 'a');
    const child = spawn(process.execPath, ['--disable-sigusr1', 'dist/main.js'], { cwd: mcpDir, env, detached: true, stdio: ['ignore', log, log] });
    closeSync(log);
    let exited = false;
    child.once('exit', () => { exited = true; });
    child.unref();
    writeFileSync(pidFile(dir, role.name), `${child.pid}\n`);
    if (!(await healthy(env.PORT, () => exited))) fail(`MCP ${role.name} did not answer /healthz within 60 s; see ${logFile(dir, role.name)}`);
  }
}

async function healthy(port, exited) {
  for (const end = Date.now() + 60_000; !exited() && Date.now() < end; await sleep(250)) {
    if (await fetch(`${loopback(port)}/healthz`, { signal: AbortSignal.timeout(1000) }).then((r) => r.ok, () => false)) return true;
  }
  return false;
}

// What the role's current process wrote: earlier processes of a restarted role stay in the file, as evidence.
function logs(dir, names) {
  for (const name of names.length ? names : roles.map((role) => role.name)) {
    if (!existsSync(logFile(dir, name))) continue;
    const text = readFileSync(logFile(dir, name), 'utf8'), at = text.lastIndexOf(START);
    process.stdout.write(at < 0 ? text : text.slice(text.indexOf('\n', at) + 1));
  }
}

async function main([command, dir, ...rest]) {
  const usage = () => fail('usage: mcp-processes.mjs ports|start|stop|logs <run> [role...] | pid <run> <role> | exec <run> <role> -- <command...>');
  if (!dir || !existsSync(join(dir, 'run.env'))) usage();
  if (command === 'ports') await ports(dir);
  else if (command === 'start') await start(dir, rest);
  else if (command === 'stop') for (const name of rest.length ? rest : roles.map((role) => role.name).reverse()) await stop(dir, name);
  else if (command === 'logs') logs(dir, rest);
  else if (command === 'pid' && rest.length === 1) {
    const file = pidFile(dir, rest[0]), pid = existsSync(file) ? Number(readFileSync(file, 'utf8')) : 0;
    if (pid > 1 && alive(pid)) console.log(pid);
  } else if (command === 'exec' && rest.length > 2 && rest[1] === '--') {
    const c = context(dir), [role] = select(c.run, [rest[0]]);
    const result = spawnSync(rest[2], rest.slice(3), { cwd: mcpDir, env: processEnv(role, c), stdio: 'inherit' });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } else usage();
}

if (realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2)).catch((error) => {
    console.error(`verify-uvw: ${error.message}`);
    process.exitCode = 1;
  });
}
