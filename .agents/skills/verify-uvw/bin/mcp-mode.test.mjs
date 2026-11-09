import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { expectedTools, restrictedTools } from './mcp-availability.mjs';

const helper = fileURLToPath(new URL('./verify-uvw', import.meta.url));
const compose = fileURLToPath(new URL('../../../../apps/mcp/docker/compose.verify.yml', import.meta.url));

for (const production of [0, 1]) for (const renderer of [0, 1]) {
  test(`allow-users recreates only this run's gateway and executors (production=${production}, renderer=${renderer})`, () => {
    const root = mkdtempSync(join(tmpdir(), 'verify-uvw-mode-'));
    const run = join(root, 'test');
    try {
      mkdirSync(run);
      writeFileSync(join(run, 'run.env'), `RUN_ID=test\nMCP_ENABLED=1\nWEB_PORT=6000\nSERVER_PORT=3950\nMCP_PORT=3955\nMCP_PROJECT=verify-uvw-test\nMCP_IMAGE=test:image\nMCP_PRODUCTION=${production}\nMCP_RENDERER=${renderer}\nMCP_EXECUTORS=2\n`);
      const capture = join(root, 'capture.json');
      writeFileSync(join(root, 'docker'), `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(capture)}, JSON.stringify({args:process.argv.slice(2),env:process.env})+'\\n');\n`, { mode: 0o755 });
      const call = ids => spawnSync('bash', [helper, 'mcp-allow-users', ...ids], {
        env: { ...process.env, PATH: root + ':' + process.env.PATH, VERIFY_UVW_ROOT: root, VERIFY_UVW_RUN: 'test',
          MCP_DEV_SESSION_PASSTHROUGH: 'pollution', MCP_RENDERER_URL: 'http://pollution', MCP_EXECUTOR_ALLOWED_USER_IDS: 'pollution' }, encoding: 'utf8',
      });
      const result = call(['user-a', 'user-b']);
      assert.equal(result.status, 0, result.stderr);
      const calls = readFileSync(capture, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      assert.equal(calls.length, 2);
      assert.deepEqual(calls[0].args.slice(calls[0].args.indexOf('up')), ['up', '-d', '--force-recreate', '--no-deps', '--wait', '--wait-timeout', '60', 'executor', 'executor-b']);
      const captured = calls[1];
      assert.deepEqual(captured.args.slice(captured.args.indexOf('up')), ['up', '-d', '--force-recreate', '--no-deps', '--wait', '--wait-timeout', '60', 'gateway']);
      assert.equal(captured.env.VERIFY_UVW_MCP_PROJECT, 'verify-uvw-test');
      assert.equal(captured.env.MCP_EXECUTOR_ALLOWED_USER_IDS, 'user-a,user-b');
      assert.equal(captured.env.VERIFY_UVW_MCP_NODE_ENV, production ? 'production' : 'development');
      assert.equal(captured.env.MCP_DEV_SESSION_PASSTHROUGH, production ? undefined : '1');
      assert.equal(captured.env.MCP_RENDERER_URL, renderer ? 'http://renderer:3000' : undefined);
      assert.equal(captured.env.COMPOSE_PROFILES, renderer ? 'renderer,replicas' : 'replicas');
      assert.equal(readFileSync(join(run, 'executor-allowed-user-ids'), 'utf8'), 'user-a,user-b\n');
      for (const invalid of [[], [''], ['user-a,user-b'], ['user a'], ['$(id)']]) {
        assert.equal(call(invalid).status, 1);
        assert.equal(readFileSync(join(run, 'executor-allowed-user-ids'), 'utf8'), 'user-a,user-b\n');
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test(`real docker compose config (production=${production}, renderer=${renderer})`, () => {
    const env = { ...process.env, VERIFY_UVW_MCP_PROJECT: 'verify-uvw-config-test', VERIFY_UVW_MCP_IMAGE: 'test:image',
      VERIFY_UVW_ORIGIN: 'http://127.0.0.1:6000', VERIFY_UVW_SERVER_PORT: '3950', VERIFY_UVW_MCP_PORT: '3955',
      VERIFY_UVW_MCP_STAGING_DIRECTORY: '/tmp/verify-uvw-config-test/staging', VERIFY_UVW_INTERNAL_TOKEN: 'test-only',
      VERIFY_UVW_METRICS_TOKEN: 'test-only', VERIFY_UVW_MCP_OAUTH_SECRET: 'test-only',
      VERIFY_UVW_MCP_NODE_ENV: production ? 'production' : 'development', COMPOSE_PROFILES: renderer ? 'renderer' : '' };
    delete env.MCP_DEV_SESSION_PASSTHROUGH;
    delete env.MCP_RENDERER_URL;
    delete env.MCP_EXECUTOR_ALLOWED_USER_IDS;
    if (!production) env.MCP_DEV_SESSION_PASSTHROUGH = '1';
    if (renderer) env.MCP_RENDERER_URL = 'http://renderer:3000';
    if (production) env.MCP_EXECUTOR_ALLOWED_USER_IDS = 'verify-uvw-pending-user';
    const config = JSON.parse(execFileSync('docker', ['compose', '-f', compose, 'config', '--format', 'json'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    assert.deepEqual(Object.keys(config.services).sort(), renderer ? ['executor', 'gateway', 'renderer'] : ['executor', 'gateway']);
    assert.equal(config.services.executor.environment.MCP_RENDERER_URL ?? undefined, renderer ? 'http://renderer:3000' : undefined);
    for (const service of ['gateway', 'executor']) {
      assert.equal(config.services[service].environment.NODE_ENV, production ? 'production' : 'development');
      assert.equal(config.services[service].environment.MCP_EXECUTOR_ALLOWED_USER_IDS ?? undefined, production ? 'verify-uvw-pending-user' : undefined);
    }
    assert.equal(config.services.gateway.environment.MCP_DEV_SESSION_PASSTHROUGH ?? undefined, production ? undefined : '1');
  });
}

test('MB expectations cover all combinations and exclude renderer tools', () => {
  assert.deepEqual(Object.keys(expectedTools), ['core', 'files', 'admin', 'core,files', 'core,admin', 'files,admin', 'all']);
  for (const [sets, names] of Object.entries(expectedTools)) {
    assert(!names.some(name => ['screenshot', 'print_pdf', 'lint'].includes(name)));
    assert.equal(new Set(names).size, names.length);
    if (sets !== 'all') assert.deepEqual(names, expectedTools.all.filter(name => sets.split(',').some(set => expectedTools[set].includes(name))));
  }
  assert.equal(expectedTools.all.length, 51);
  assert.equal(restrictedTools.length, 40);
  assert(restrictedTools.every(name => expectedTools.all.includes(name)));
  assert(!restrictedTools.includes('execute'));
});
