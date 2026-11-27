import assert from 'node:assert/strict';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { existsSync, globSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const helper = fileURLToPath(new URL('./verify-uvw', import.meta.url));
const cliMain = fileURLToPath(new URL('../../../../apps/cli/dist/main.js', import.meta.url));
const origin = 'http://127.0.0.1:1';

test('uvw runs only against the run origin, never the CLI default', { skip: !existsSync(cliMain) && "needs a built CLI: pnpm --filter 'univer-workspace-cli...' build" }, () => {
  const root = mkdtempSync(join(process.env.VERIFY_UVW_TEST_ROOT ?? tmpdir(), 'verify-uvw-origin-'));
  const run = join(root, 'test');
  const call = (...args) => spawnSync('bash', [helper, ...args], {
    env: { ...process.env, VERIFY_UVW_ROOT: root, VERIFY_UVW_RUN: 'test' }, encoding: 'utf8',
  });
  try {
    mkdirSync(join(run, 'evidence'), { recursive: true });
    writeFileSync(join(run, 'run.env'), 'RUN_ID=test\nWEB_PORT=1\n');

    for (const args of [['cli', 'unset', 'config', 'get', 'workspace.origin'], ['uvw', 'config', 'get', 'workspace.origin']]) {
      const refused = call(...args);
      assert.notEqual(refused.status, 0, `${args[0]} ran with no workspace.origin`);
      assert.match(refused.stderr, /refusing uvw/);
      assert.doesNotMatch(refused.stdout, /space\.univer\.ai/);
    }
    assert.doesNotMatch(readFileSync(join(run, 'evidence/unset.out'), 'utf8'), /space\.univer\.ai/);

    execFileSync(process.execPath, [cliMain, 'config', 'set', 'workspace.origin', 'https://example.invalid'], { env: { ...process.env, UNIVER_HOME: join(run, 'home') } });
    assert.notEqual(call('cli', 'other', 'config', 'get', 'workspace.origin').status, 0, 'cli ran against another origin');

    execFileSync(process.execPath, [cliMain, 'config', 'set', 'workspace.origin', origin], { env: { ...process.env, UNIVER_HOME: join(run, 'home') } });
    const allowed = call('cli', 'own', 'config', 'get', 'workspace.origin', '--json');
    assert.equal(allowed.status, 0, allowed.stderr);
    assert.equal(JSON.parse(allowed.stdout).entry.value, origin);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('user signs the run user in as the browser does, and person runs uvw with that session', { skip: !existsSync(cliMain) && "needs a built CLI: pnpm --filter 'univer-workspace-cli...' build" }, async () => {
  const root = mkdtempSync(join(process.env.VERIFY_UVW_TEST_ROOT ?? tmpdir(), 'verify-uvw-person-'));
  const run = join(root, 'test');
  const cookies = [];
  const sessions = { '/api/auth/cli/password/login': 'cli-session-0000', '/api/auth/password/login': 'browser-session-0000' };
  const server = createServer((request, response) => {
    cookies.push(`${request.method} ${request.url} ${request.headers.cookie ?? ''}`);
    request.resume().on('end', () => {
      const session = sessions[request.url];
      response.writeHead(request.url === '/api/auth/password/register' ? 201 : 200, {
        'content-type': 'application/json', ...(session ? { 'set-cookie': `workspace_session=${session}; Path=/; HttpOnly` } : {}),
      });
      response.end(JSON.stringify({ authenticated: true, user: { id: 'u1', username: 'verify-test', displayName: 'Verify test' } }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const web = `http://127.0.0.1:${server.address().port}`;
  const env = { ...process.env, VERIFY_UVW_ROOT: root, VERIFY_UVW_RUN: 'test' };
  const call = (...args) => promisify(execFile)('bash', [helper, ...args], { env, encoding: 'utf8' }).then(() => 0, (error) => error);
  const stored = (home) => globSync(join(run, home, 'distributions/*/workspace-cli/session.json'))
    .flatMap((file) => Object.values(JSON.parse(readFileSync(file, 'utf8')).sessions).map((entry) => entry.cookie));
  try {
    mkdirSync(join(run, 'evidence'), { recursive: true });
    mkdirSync(join(run, 'logs'));
    writeFileSync(join(run, 'run.env'), `RUN_ID=test\nWEB_PORT=${server.address().port}\n`);
    execFileSync(process.execPath, [cliMain, 'config', 'set', 'workspace.origin', web], { env: { ...process.env, UNIVER_HOME: join(run, 'home') } });

    assert.match((await call('person', 'early', 'auth', 'status', '--json')).stderr, /no browser session; run: verify-uvw user/);
    assert.equal(await call('user'), 0);
    assert.equal(readFileSync(join(run, 'home/browser-session'), 'utf8'), 'browser-session-0000');
    assert.deepEqual(stored('home'), ['workspace_session=cli-session-0000'], 'uvw keeps its own login');
    assert.deepEqual(stored('home/person'), ['workspace_session=browser-session-0000']);

    cookies.length = 0;
    await call('cli', 'as-cli', 'auth', 'status', '--json');
    await call('person', 'as-person', 'auth', 'status', '--json');
    assert.deepEqual([...new Set(cookies.map((line) => line.split(' ')[2]))], ['workspace_session=cli-session-0000', 'workspace_session=browser-session-0000']);
    assert.ok(existsSync(join(run, 'evidence/as-person.exit')), 'person records evidence as cli does');
  } finally {
    server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
