#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertLogsExclude } from './executor-doctor-checks.mjs';
import { assertInternalOnly, assertUnreachable } from './renderer-doctor-checks.mjs';

const [repo, run, project, image, imageId, origin, serverPort, mcpPort] = process.argv.slice(2);
const secret = name => readFileSync(join(run, 'home', name), 'utf8').trim();
const env = { ...process.env, VERIFY_UVW_MCP_STAGING_DIRECTORY: join(run, 'staging'), VERIFY_UVW_MCP_PROJECT: project, VERIFY_UVW_MCP_IMAGE: image,
  VERIFY_UVW_ORIGIN: origin, VERIFY_UVW_SERVER_PORT: serverPort, VERIFY_UVW_MCP_PORT: mcpPort,
  VERIFY_UVW_METRICS_TOKEN: secret('metrics-token'), VERIFY_UVW_INTERNAL_TOKEN: secret('internal-token'),
  VERIFY_UVW_MCP_OAUTH_SECRET: secret('mcp-oauth-secret') };
const docker = (args, input, timeout = 25_000) => execFileSync('docker', args, { env, input, encoding: 'utf8', timeout, stdio: ['pipe', 'pipe', 'pipe'] });
const compose = (args, input, timeout) => docker(['compose', '-p', project, '-f', join(repo, 'apps/mcp/docker/compose.verify.yml'), ...args], input, timeout);
const node = (service, code, input, timeout) => compose(['exec', '-T', service, 'node', '--input-type=module', '-e', code], input, timeout);
// Prints "reached <status>" or "blocked" so the host can assert on the outcome, whatever the container's fetch error looks like.
const probe = (service, url) => node(service, `
  const outcome = await fetch(${JSON.stringify(url)}, { signal: AbortSignal.timeout(5000) }).then(r => 'reached ' + r.status, () => 'blocked');
  console.log(outcome);
`).trim();

try {
  const cid = compose(['ps', '-q', 'renderer']).trim();
  assert(cid, 'renderer container exists');
  const [container] = JSON.parse(docker(['inspect', cid]));
  assert(container.State.Running && container.State.Health?.Status === 'healthy' && container.Image === imageId, 'renderer healthy on this run image');
  console.log('ok    MCP renderer is healthy and uses this run\'s image');
  assert(Object.values(container.NetworkSettings.Ports ?? {}).every(value => value === null), 'renderer has no published ports');
  console.log('ok    MCP renderer has no published port');
  const networks = Object.keys(container.NetworkSettings.Networks);
  const inspected = Object.fromEntries(networks.map(name => [name, JSON.parse(docker(['network', 'inspect', name]))[0]]));
  assertInternalOnly(inspected);
  console.log('ok    MCP renderer joins only an internal network');

  node('executor', `for (const authorization of ['', 'Bearer wrong']) {
    const response = await fetch(new URL('/rpc/v1/measureText', process.env.MCP_RENDERER_URL), {method:'POST',headers:{authorization}});
    if (response.status !== 401) process.exit(1);
  }`);
  console.log('ok    MCP renderer RPC rejects missing and wrong bearer from the executor');

  const unauthenticated = node('executor', `
    const metrics = new URL('/metrics', process.env.MCP_RENDERER_URL);
    const rejected = await fetch(metrics).then(r => r.status);
    const accepted = await fetch(metrics, { headers: { authorization: 'Bearer ' + ${JSON.stringify(secret('metrics-token'))} } }).then(r => r.status);
    console.log(rejected + ' ' + accepted);
  `).trim();
  assert.equal(unauthenticated, '401 200', 'renderer metrics reject a missing token and accept this run\'s token');
  console.log('ok    MCP renderer metrics reject missing token and accept this run\'s token');

  const result = JSON.parse(node('executor', `
    import { decodeFrame, encodeFrame, FRAME_CONTENT_TYPE } from './dist/shared/frame.js';
    const text = 'Hello 你好';
    const doc = { id: 'doctor-measure', body: { dataStream: text + '\\r\\n', paragraphs: [{ startIndex: text.length }], textRuns: [{ st: 0, ed: text.length, ts: { fs: 12 } }] },
      documentStyle: { marginBottom: 0, marginLeft: 0, marginRight: 0, marginTop: 0, pageSize: { height: 1000000, width: 1000000 } } };
    const response = await fetch(new URL('/rpc/v1/measureText', process.env.MCP_RENDERER_URL), {
      method: 'POST', headers: { authorization: 'Bearer ' + process.env.MCP_INTERNAL_TOKEN, 'content-type': FRAME_CONTENT_TYPE, 'x-mcp-rpc-version': '1' },
      body: encodeFrame({ v: 1, op: 'measureText', requestId: 'doctor-measure', deadlineMs: 9000, input: { doc } }), signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw new Error('RPC transport rejected');
    console.log(JSON.stringify(decodeFrame(new Uint8Array(await response.arrayBuffer())).header));
  `, undefined, 40_000));
  writeFileSync(join(run, 'evidence/renderer-probe.json'), JSON.stringify(result, null, 2) + '\n');
  assert(result.ok && result.output.actualWidth > 0 && result.output.lineCount === 1, 'renderer measures text in the browser');
  console.log('ok    MCP executor reaches the renderer and measures Latin and Chinese text in Chromium');

  const reached = {
    'Workspace transport': probe('renderer', `http://host.docker.internal:${serverPort}/api/session`),
    'public internet': probe('renderer', 'https://example.com/'),
    'gateway': probe('renderer', 'http://gateway:3000/healthz'),
  };
  assertUnreachable(reached);
  writeFileSync(join(run, 'evidence/renderer-isolation.json'), JSON.stringify(reached, null, 2) + '\n');
  console.log('ok    MCP renderer cannot reach the Workspace server, the gateway or the internet');

  const logs = compose(['logs', '--no-color', '--no-log-prefix', 'renderer']);
  for (const name of ['mcp-session', 'mcp-token', 'internal-token', 'metrics-token', 'mcp-oauth-secret']) {
    try { assertLogsExclude(logs, [secret(name)]); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
  console.log('ok    MCP renderer logs contain no session, PAT, internal token or client secret');
} catch (error) {
  console.error('FAIL  MCP renderer verification: ' + (error instanceof assert.AssertionError ? error.message : 'check failed; inspect the run evidence and container state'));
  process.exitCode = 1;
}
