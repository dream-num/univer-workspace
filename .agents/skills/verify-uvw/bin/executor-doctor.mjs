#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [repo, run, project, image, imageId, origin, serverPort, mcpPort] = process.argv.slice(2);
const secret = name => readFileSync(join(run, 'home', name), 'utf8').trim();
const env = { ...process.env, VERIFY_UVW_MCP_PROJECT: project, VERIFY_UVW_MCP_IMAGE: image,
  VERIFY_UVW_ORIGIN: origin, VERIFY_UVW_SERVER_PORT: serverPort, VERIFY_UVW_MCP_PORT: mcpPort,
  VERIFY_UVW_METRICS_TOKEN: secret('metrics-token'), VERIFY_UVW_INTERNAL_TOKEN: secret('internal-token'),
  VERIFY_UVW_MCP_OAUTH_SECRET: secret('mcp-oauth-secret') };
const docker = (args, input) => execFileSync('docker', args, { env, input, encoding: 'utf8', timeout: 25_000, stdio: ['pipe', 'pipe', 'pipe'] });
const compose = (args, input) => docker(['compose', '-p', project, '-f', join(repo, 'apps/mcp/docker/compose.verify.yml'), ...args], input);
const node = (service, code, input) => compose(['exec', '-T', service, 'node', '--input-type=module', '-e', code], input);

try {
  const cid = compose(['ps', '-q', 'executor']).trim();
  assert(cid, 'executor container exists');
  const [container] = JSON.parse(docker(['inspect', cid]));
  assert(container.State.Running && container.State.Health?.Status === 'healthy' && container.Image === imageId, 'executor healthy on this run image');
  console.log('ok    MCP executor is healthy and uses this run\'s image');
  assert(Object.values(container.NetworkSettings.Ports ?? {}).every(value => value === null), 'executor has no published ports');
  console.log('ok    MCP executor has no published port');
  node('gateway', `for (const authorization of ['', 'Bearer wrong']) {
    const response = await fetch('http://executor:3000/rpc/v1/diagnostics.probe', {method:'POST',headers:{authorization}});
    if (response.status !== 401) process.exit(1);
  }`);
  console.log('ok    MCP executor RPC rejects missing and wrong bearer from gateway');
  if (existsSync(join(run, 'home/mcp-session'))) {
    const session = secret('mcp-session');
    const identity = await (await fetch(origin + '/api/session', { headers: { cookie: 'workspace_session=' + session } })).json();
    assert(identity.authenticated && identity.user?.id, 'disposable session authenticates');
    const result = JSON.parse(node('executor', `
      import { readFileSync } from 'node:fs';
      import { encodeFrame, decodeFrame, FRAME_CONTENT_TYPE } from './dist/shared/frame.js';
      const grant = JSON.parse(readFileSync(0,'utf8'));
      const response = await fetch('http://127.0.0.1:3000/rpc/v1/diagnostics.probe', {
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
  }
  const children = node('executor', `
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
  `).trim();
  writeFileSync(join(run, 'evidence/executor-worker-environ.txt'), `Checked ${children} worker children; no secret environment variables.\n`);
  console.log(`ok    MCP executor worker environment excludes secrets (${children} live children)`);
  const logs = compose(['logs', '--no-color', '--no-log-prefix', 'executor']);
  for (const name of ['mcp-session', 'mcp-token', 'internal-token', 'metrics-token', 'mcp-oauth-secret']) {
    if (existsSync(join(run, 'home', name))) assert(!logs.includes(secret(name)), 'executor logs exclude credentials');
  }
  console.log('ok    MCP executor logs contain no session, PAT, internal token or client secret');
} catch (error) {
  console.error('FAIL  MCP executor verification: ' + (error instanceof assert.AssertionError ? error.message : 'check failed; inspect the run evidence and container state'));
  process.exitCode = 1;
}
