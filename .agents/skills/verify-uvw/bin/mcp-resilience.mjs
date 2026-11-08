#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const mode = process.argv[2];
assert(['auth', 'html-auth', 'revision', 'burst', 'replicas'].includes(mode), 'Choose auth, html-auth, revision, burst or replicas');
const root = process.cwd();
const evidence = process.env.EVIDENCE;
assert(evidence && process.env.VERIFY_UVW_RUN, 'Load verify-uvw env first');
const run = join(process.env.VERIFY_UVW_ROOT ?? '/tmp/verify-uvw', process.env.VERIFY_UVW_RUN);
const settings = Object.fromEntries(readFileSync(join(run, 'run.env'), 'utf8').trim().split('\n').map(line => line.split('=')));
if (mode === 'replicas' && settings.MCP_EXECUTORS !== '2') {
  console.log('SKIP two-replica journey requires VERIFY_UVW_MCP_EXECUTORS=2 at up');
  process.exit(0);
}
const origin = process.env.ORIGIN;
const secret = name => readFileSync(join(run, 'home', name), 'utf8').trim();
const require = createRequire(join(root, 'apps/mcp/package.json'));
const { Client, StreamableHTTPClientTransport } = require('@modelcontextprotocol/client');
const prefix = `resilience-${mode}-${randomUUID().slice(0, 8)}`;
const proof = { mode, requests: [] };
const save = () => writeFileSync(join(evidence, `resilience-${mode}.json`), JSON.stringify(proof, null, 2) + '\n');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 30_000 });
const services = () => docker(['ps', '-a', '--filter', `label=com.docker.compose.project=${settings.MCP_PROJECT}`, '--format', '{{.ID}} {{.Label "com.docker.compose.service"}}']).trim().split('\n').map(line => line.split(' '));
const containers = () => services().filter(([, service]) => service === 'executor' || service === 'executor-b');
const logs = () => services().flatMap(([id, service]) => docker(['logs', id]).split('\n').flatMap(line => {
  try { const value = JSON.parse(line); return value.request_id?.startsWith(prefix) ? [{ service, ...value }] : []; } catch { return []; }
}));
async function call(label, tool, args, bearer = secret('mcp-token')) {
  const requestId = `${prefix}-${label}`;
  const client = new Client({ name: 'verify-uvw-resilience', version: '1.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
  let status;
  const url = new URL(process.env.MCP_URL);
  url.searchParams.set('toolsets', 'all');
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { authorization: `Bearer ${bearer}`, 'x-request-id': requestId } },
    fetch: async (url, init) => { const response = await fetch(url, { ...init, signal: AbortSignal.timeout(35_000) }); status = response.status; return response; },
  });
  let result;
  try {
    await client.connect(transport);
    result = await client.callTool({ name: tool, arguments: args });
  } catch (error) {
    if (status !== 401) throw error;
    result = { isError: true, structuredContent: { status } };
  } finally { await client.close(); }
  const output = result.structuredContent;
  proof.requests.push({ requestId, tool, status, isError: !!result.isError, output });
  save();
  return { requestId, output, isError: !!result.isError, status };
}
async function ok(label, tool, args, bearer) {
  const result = await call(label, tool, args, bearer);
  assert(!result.isError, `${label} failed with ${JSON.stringify(result.output)}`);
  return result;
}
async function setup() {
  const { repos } = (await ok('repos', 'repo_list', { type: 'personal' })).output;
  const pr = (await ok('pr', 'pr_create', { repo: repos[0].id, title: prefix, idempotency_key: prefix + '-pr' })).output;
  const { unit } = (await ok('unit', 'unit_create', { worktree: pr.id, space: repos[0].id, type: 'sheet', name: prefix, idempotency_key: prefix + '-unit' })).output;
  return { worktree: pr.id, unit: unit.unitId };
}
const inspect = target => ({ ...target, target: 'range', selectors: ['A1:B1'], worksheet: 'index:1' });
const write = (cell, value) => `workbook.getActiveSheet().getRange(${JSON.stringify(cell)}).setValue(${JSON.stringify(value)}); return ${JSON.stringify(value)};`;
try {
  const target = await setup();
  proof.target = target;
  if (mode === 'auth') {
    const pat = async name => {
      const response = await fetch(origin + '/api/auth/tokens', { method: 'POST', headers: { cookie: 'workspace_session=' + secret('mcp-session'), origin, 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
      assert.equal(response.status, 201);
      return await response.json();
    };
    const a = await pat(prefix + '-a'), b = await pat(prefix + '-b');
    await ok('warm-a', 'inspect', inspect(target), a.token);
    const response = await fetch(origin + '/api/auth/tokens/' + a.record.id, { method: 'DELETE', headers: { cookie: 'workspace_session=' + secret('mcp-session'), origin } });
    assert([200, 204].includes(response.status), 'A token revoked through public API');
    await sleep(250);
    const recovered = await ok('inspect-b', 'inspect', inspect(target), b.token);
    const revoked = await call('revoked-a', 'inspect', inspect(target), a.token);
    assert.equal(revoked.status, 401, 'A receives normal authentication error');
    proof.logs = logs();
    assert.equal(proof.logs.filter(log => log.event === 'mcp.executor_rerun' && log.reason === 'auth').length, 1, 'B recovers exactly once');
    const events = proof.logs.filter(log => log.event === 'mcp.tool_call' && log.request_id === recovered.requestId);
    assert.equal(events.length, 1, 'recovery produces one usage event');
    assert(events[0].cost.worker_cpu_ms > 0 && events[0].outcome === 'ok', 'recovery records worker cost and success');
    const [gateway] = services().find(([, service]) => service === 'gateway');
    proof.metrics = JSON.parse(docker(['exec', gateway, 'node', '--input-type=module', '-e', `
      const results = [];
      for (const url of process.env.MCP_EXECUTOR_URLS.split(',')) {
        const endpoint = new URL('/metrics', url);
        if ((await fetch(endpoint)).status !== 401) throw new Error('metrics must require internal bearer');
        const response = await fetch(endpoint, { headers: { authorization: 'Bearer ' + process.env.MCP_INTERNAL_TOKEN } });
        if (response.status !== 200) throw new Error('metrics bearer rejected');
        results.push({ url, metrics: await response.text() });
      }
      console.log(JSON.stringify(results));
    `]));
    assert(proof.metrics.some(result => /mcp_executor_reruns_total\{reason="auth"\} [1-9]/.test(result.metrics)), 'live auth rerun counter is recorded');
  } else if (mode === 'html-auth') {
    const repo = (await ok('repos2', 'repo_list', { type: 'personal' })).output.repos[0].id;
    const pr = (await ok('pr2', 'pr_create', { repo, title: prefix + '-trunk', idempotency_key: prefix + '-pr2' })).output;
    const { unit } = (await ok('unit2', 'unit_create', { worktree: pr.id, space: repo, type: 'sheet', name: prefix + '-data', idempotency_key: prefix + '-unit2' })).output;
    const data = await ok('data', 'execute', { worktree: pr.id, unit: unit.unitId, code: 'const ws = workbook.getActiveSheet(); ws.getRange("A1:B2").setValues([["Region","Total"],["North",42]]); return {sheetId: ws.getSheetId()};' });
    await ok('ready', 'pr_ready', { repo, number: String(pr.number) });
    await ok('merge', 'pr_merge', { repo, number: String(pr.number) });
    const html = `<!DOCTYPE html><html><head><title>Totals</title></head><body><output data-univer-cell-text="${unit.unitId}:${data.output.value.sheetId}:B2"></output></body></html>`;
    proof.html = html;
    const pat = async name => {
      const response = await fetch(origin + '/api/auth/tokens', { method: 'POST', headers: { cookie: 'workspace_session=' + secret('mcp-session'), origin, 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
      assert.equal(response.status, 201);
      return await response.json();
    };
    const revoke = async id => {
      const response = await fetch(origin + '/api/auth/tokens/' + id, { method: 'DELETE', headers: { cookie: 'workspace_session=' + secret('mcp-session'), origin } });
      assert([200, 204].includes(response.status), 'token revoked through public API');
      await sleep(250);
    };
    const a = await pat(prefix + '-a'), b = await pat(prefix + '-b');
    assert((await ok('warm-a', 'html_view_validate', { html }, a.token)).output.valid, 'A validates and warms a worker');
    await revoke(a.record.id);
    const recovered = await ok('validate-b', 'html_view_validate', { html }, b.token);
    assert.equal(recovered.output.bindingCount, 1, 'B validates after A was revoked');
    proof.logs = logs();
    assert.equal(proof.logs.filter(log => log.event === 'mcp.executor_rerun' && log.reason === 'auth' && log.request_id === recovered.requestId).length, 1, 'B recovers with one auth rerun');
    // The gateway budget leaves 25+ seconds for a rerun, so the no-rerun path is driven at the executor RPC with a 4-second deadline.
    await revoke(b.record.id);
    const session = secret('mcp-session');
    const identity = await (await fetch(origin + '/api/session', { headers: { cookie: 'workspace_session=' + session } })).json();
    const grant = { kind: 'session', userId: identity.user.id, session, expiresAt: Date.now() + 60_000 };
    const [gateway] = services().find(([, service]) => service === 'gateway');
    const rpc = (label, deadlineMs) => JSON.parse(execFileSync('docker', ['exec', '-i', gateway, 'node', '--input-type=module', '-e', `
      import { readFileSync } from 'node:fs';
      import { encodeFrame, decodeFrame, FRAME_CONTENT_TYPE } from './dist/shared/frame.js';
      const { grant, html, label, deadlineMs } = JSON.parse(readFileSync(0, 'utf8'));
      const response = await fetch(new URL('/rpc/v1/htmlView.validate', process.env.MCP_EXECUTOR_URLS.split(',')[0]), {
        method: 'POST', headers: { authorization: 'Bearer ' + process.env.MCP_INTERNAL_TOKEN, 'content-type': FRAME_CONTENT_TYPE, 'x-mcp-rpc-version': '1' },
        body: encodeFrame({ v: 1, op: 'htmlView.validate', requestId: label, deadlineMs, grant, input: { html } }), signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error('RPC transport rejected ' + response.status);
      console.log(JSON.stringify(decodeFrame(new Uint8Array(await response.arrayBuffer())).header));
    `], { encoding: 'utf8', timeout: 40_000, input: JSON.stringify({ grant, html, label: `${prefix}-${label}`, deadlineMs }) }));
    const floor = rpc('floor', 4000);
    proof.floor = floor;
    assert(!floor.ok && floor.error.outcome !== 'auth_error' && floor.error.code === 'workspace-executor-timeout' && floor.error.detail.retryable === true && floor.error.detail.started === false, 'no rerun yields a retryable non-auth error');
    const retried = rpc('retry', 20_000);
    proof.retried = retried;
    assert(retried.ok && retried.output.bindingCount === 1, 'the retry succeeds on the replaced worker');
    const next = await ok('bearer-after', 'html_view_validate', { html });
    assert.equal(next.status, 200, 'the primary bearer still works after the no-rerun failure');
  } else if (mode === 'burst') {
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => call('burst-' + i, 'execute', { ...target, code: write('A' + (i + 1), 'burst-' + i) })));
    const committed = results.filter(result => !result.isError && result.output.committed).length;
    proof.burst = { committed, outcomes: results.map(result => result.isError ? result.output.code : 'committed') };
    save();
    const reads = [];
    let writing = true;
    const loop = (async () => {
      for (let i = 0; writing; i++) reads.push(await call('loop-' + i, 'inspect', inspect(target)));
    })();
    for (let i = 0; i < 8; i++) await ok('seq-' + i, 'execute', { ...target, code: write('B' + (i + 1), 'seq-' + i) });
    writing = false;
    await loop;
    const failed = reads.filter(read => read.isError);
    proof.inspectLoop = { calls: reads.length, failures: failed.length, codes: failed.map(read => read.output?.code ?? read.status) };
    proof.logs = logs();
    proof.reruns = proof.logs.filter(log => log.event === 'mcp.executor_rerun').map(log => log.reason);
    console.log(JSON.stringify({ burst: proof.burst, inspectLoop: proof.inspectLoop, reruns: proof.reruns }));
    assert.equal(committed, 5, 'all five parallel writes commit');
    assert.equal(failed.length, 0, 'inspect never fails during sequential writes');
  } else if (mode === 'revision') {
    const first = ok('parallel-a', 'execute', { ...target, code: 'await new Promise(resolve => setTimeout(resolve, 1000)); ' + write('A1', 'first') });
    await sleep(100);
    const second = ok('parallel-b', 'execute', { ...target, code: write('B1', 'second') });
    const results = await Promise.all([first, second]);
    assert(results.every(result => result.output.committed), 'both calls commit');
    const revisions = results.map(result => result.output.revision).sort((a, b) => a - b);
    assert.equal(revisions[1], revisions[0] + 1, 'exactly one revision per write');
    const read = await ok('readback', 'inspect', inspect(target));
    assert(JSON.stringify(read.output).includes('first') && JSON.stringify(read.output).includes('second'), 'both edits persisted');
    proof.logs = logs();
    // The executor queues same-Unit writes, so this pair normally needs no rerun; a rerun is allowed once.
    assert(proof.logs.filter(log => log.event === 'mcp.executor_rerun' && log.reason === 'revision').length <= 1, 'at most one conflict rerun');
  } else {
    const replicas = containers();
    assert.equal(replicas.length, 2);
    for (let i = 0; i < 3; i++) await ok('sticky-' + i, 'inspect', inspect(target));
    let completed = logs().filter(log => log.msg === 'Executor request completed' && log.request_id.includes('sticky-'));
    assert.equal(completed.length, 3);
    assert.equal(new Set(completed.map(log => log.service)).size, 1, 'same user, scope and Unit stay on one replica');
    const selected = replicas.find(([, service]) => service === completed[0].service);
    docker(['stop', selected[0]]);
    try {
      await sleep(500);
      const failover = await ok('failover', 'inspect', inspect(target));
      completed = logs().filter(log => log.request_id === failover.requestId && log.msg === 'Executor request completed');
      assert.equal(completed.length, 1);
      assert.notEqual(completed[0].service, selected[1], 'next call uses surviving replica');
    } finally { docker(['start', selected[0]]); }
    await sleep(5500);
    let started;
    const marker = new Promise(resolve => { started = resolve; });
    const server = createServer((_request, response) => { response.end('ok'); started(); });
    await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
    const port = server.address().port;
    const code = `const range = workbook.getActiveSheet().getRange('A1'); range.setValue(Number(range.getValue() || 0) + 1); await fetch('http://host.docker.internal:${port}/started'); await new Promise(resolve => setTimeout(resolve, 8000)); return range.getValue();`;
    let killed;
    try {
      const pending = call('inflight', 'execute', { ...target, code });
      await Promise.race([marker, sleep(20_000).then(() => { throw new Error('write never reached script'); })]);
      killed = selected[0];
      docker(['kill', killed]);
      const unknown = await pending;
      assert(unknown.isError && unknown.output.code === 'workspace-result-unknown', 'killed in-flight write stays unknown');
      await ok('manual-retry', 'execute', { ...target, code });
      const read = await ok('no-duplicate', 'inspect', inspect(target));
      assert.equal(read.output.ranges[0].displayValues[0][0], '1', 'manual retry committed exactly one increment');
      proof.readback = read.output;
      proof.logs = logs();
      assert.equal(proof.logs.filter(log => log.request_id === unknown.requestId && log.msg === 'Executor request completed').length, 0, 'gateway did not replay ambiguous write');
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      if (killed) docker(['start', killed]);
    }
  }
  save();
  console.log(`PASS ${mode}; evidence ${join(evidence, `resilience-${mode}.json`)}`);
} catch (error) {
  proof.failure = error.message;
  proof.logs = logs();
  save();
  throw error;
}
