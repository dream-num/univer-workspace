#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { assertWorkerCount, assertLogsExclude } from './executor-doctor-checks.mjs';
import { join } from 'node:path';

const [repo, run, project, image, imageId, origin, serverPort, mcpPort, executorCount = "1"] = process.argv.slice(2);
const secret = name => readFileSync(join(run, 'home', name), 'utf8').trim();
const env = { ...process.env, VERIFY_UVW_MCP_STAGING_DIRECTORY: join(run, 'staging'), VERIFY_UVW_MCP_PROJECT: project, VERIFY_UVW_MCP_IMAGE: image,
  VERIFY_UVW_ORIGIN: origin, VERIFY_UVW_SERVER_PORT: serverPort, VERIFY_UVW_MCP_PORT: mcpPort,
  VERIFY_UVW_METRICS_TOKEN: secret('metrics-token'), VERIFY_UVW_INTERNAL_TOKEN: secret('internal-token'),
  VERIFY_UVW_MCP_OAUTH_SECRET: secret('mcp-oauth-secret') };
const docker = (args, input) => execFileSync('docker', args, { env, input, encoding: 'utf8', timeout: 25_000, stdio: ['pipe', 'pipe', 'pipe'] });
const compose = (args, input) => docker(['compose', '-p', project, '-f', join(repo, 'apps/mcp/docker/compose.verify.yml'), ...args], input);
const node = (service, code, input) => compose(['exec', '-T', service, 'node', '--input-type=module', '-e', code], input);

try {
  const executors = executorCount === '2' ? ['executor', 'executor-b'] : ['executor'];
  for (const service of executors) {
    const cid = compose(['ps', '-q', service]).trim();
    assert(cid, 'executor container exists');
    const [container] = JSON.parse(docker(['inspect', cid]));
    assert(container.State.Running && container.State.Health?.Status === 'healthy' && container.Image === imageId, 'executor healthy on this run image');
    console.log('ok    MCP executor is healthy and uses this run\'s image');
    assert(Object.values(container.NetworkSettings.Ports ?? {}).every(value => value === null), 'executor has no published ports');
    console.log('ok    MCP executor has no published port');
  }
  node('gateway', `for (const authorization of ['', 'Bearer wrong']) {
    const response = await fetch(new URL('/rpc/v1/diagnostics.probe', process.env.MCP_EXECUTOR_URLS.split(',')[0]), {method:'POST',headers:{authorization}});
    if (response.status !== 401) process.exit(1);
  }`);
  console.log('ok    MCP executor RPC rejects missing and wrong bearer from gateway');
  if (existsSync(join(run, 'home/mcp-session'))) {
    const session = secret('mcp-session');
    const identity = await (await fetch(origin + '/api/session', { headers: { cookie: 'workspace_session=' + session } })).json();
    assert(identity.authenticated && identity.user?.id, 'disposable session authenticates');
    const result = JSON.parse(node('gateway', `
      import { readFileSync } from 'node:fs';
      import { encodeFrame, decodeFrame, FRAME_CONTENT_TYPE } from './dist/shared/frame.js';
      const grant = JSON.parse(readFileSync(0,'utf8'));
      const response = await fetch(new URL('/rpc/v1/diagnostics.probe', process.env.MCP_EXECUTOR_URLS.split(',')[0]), {
        method:'POST', headers:{authorization:'Bearer '+process.env.MCP_INTERNAL_TOKEN,'content-type':FRAME_CONTENT_TYPE,'x-mcp-rpc-version':'1'},
        body:encodeFrame({v:1,op:'diagnostics.probe',requestId:'doctor-probe',deadlineMs:8000,grant,input:{}}), signal:AbortSignal.timeout(10000)
      });
      if (!response.ok) throw new Error('RPC transport rejected');
      console.log(JSON.stringify(decodeFrame(new Uint8Array(await response.arrayBuffer())).header));
    `, JSON.stringify({ kind: 'session', userId: identity.user.id, session, expiresAt: Date.now() + 60_000 })));
    writeFileSync(join(run, 'evidence/executor-probe.json'), JSON.stringify(result, null, 2) + '\n');
    assert(result.ok && result.output.whoami.id === identity.user.id && result.output.ticket && result.output.websocket, 'executor probe authenticates HTTP, ticket and collaboration WebSocket');
    assert.equal(result.output.transport, 'http://host.docker.internal:' + serverPort);
    console.log('ok    MCP executor reaches Workspace HTTP and collaboration WebSocket through transport');
    const mcp = (label, tool, args) => {
      execFileSync(join(repo, '.agents/skills/verify-uvw/bin/verify-uvw'),
        ['mcp', '--auth', 'dev', label, tool, JSON.stringify(args)], { env, cwd: repo, encoding: 'utf8', timeout: 40_000, stdio: ['pipe', 'pipe', 'pipe'] });
      return JSON.parse(readFileSync(join(run, 'evidence', label + '.out'), 'utf8'));
    };
    const space = mcp('doctor-worker-repo', 'repo_list', { type: 'personal' }).repos[0];
    assert(space, 'disposable user has a personal repository');
    const worktree = mcp('doctor-worker-pr', 'pr_create', { repo: space.id, title: 'Executor doctor', idempotency_key: 'executor-doctor-pr' });
    const { unit } = mcp('doctor-worker-unit', 'unit_create', { worktree: worktree.id, space: space.id, type: 'sheet', name: 'Doctor', idempotency_key: 'executor-doctor-unit' });
    mcp('doctor-worker-inspect', 'inspect', { worktree: worktree.id, unit: unit.unitId, target: 'workbook' });

  }
  const children = executors.reduce((total, service) => total + Number(node(service, `
    import { readFileSync, readdirSync } from 'node:fs';
    let checked = 0;
    for (const pid of readdirSync('/proc').filter(p => /^\\d+$/.test(p) && p !== '1' && p !== String(process.pid))) {
      let status, environ;
      try { status=readFileSync('/proc/'+pid+'/status','utf8'); environ=readFileSync('/proc/'+pid+'/environ','utf8'); } catch { continue; }
      if (!/^PPid:\\s+1$/m.test(status)) continue;
      if (environ.split('\\0').some(v => /^(MCP_INTERNAL_TOKEN|METRICS_TOKEN|UNIVER_LICENSE|UNIVER_LICENSE_KEY|MCP_OAUTH_CLIENT_SECRET)=/.test(v))) process.exit(1);
      checked++;
    }
    console.log(checked);
  `).trim()), 0);
  assertWorkerCount(children);
  writeFileSync(join(run, 'evidence/executor-worker-environ.txt'), `Checked ${children} worker children; no inherited secret environment variables. Same-uid workers can still read /proc/1/environ until Stage G.\n`);
  console.log(`ok    MCP executor worker environment excludes inherited secrets (${children} live children)`);
  const logs = compose(['logs', '--no-color', '--no-log-prefix', 'gateway', ...executors]);
  for (const name of ['mcp-session', 'mcp-token', 'internal-token', 'metrics-token', 'mcp-oauth-secret']) {
    if (existsSync(join(run, 'home', name))) assertLogsExclude(logs, [secret(name)]);
  }
  const licenses = await import(pathToFileURL(join(repo, 'apps/cli/dist/license.js')).href);
  const configured = JSON.parse(node('executor', `console.log(JSON.stringify([process.env.UNIVER_LICENSE, process.env.UNIVER_LICENSE_KEY].filter(Boolean)))`));
  assertLogsExclude(logs, [...Object.values(licenses), ...configured]);
  console.log('ok    MCP gateway and executor logs contain no session, PAT, internal token, client secret or license values');
} catch (error) {
  console.error('FAIL  MCP executor verification: ' + (error instanceof assert.AssertionError ? error.message : 'check failed; inspect the run evidence and container state'));
  process.exitCode = 1;
}
