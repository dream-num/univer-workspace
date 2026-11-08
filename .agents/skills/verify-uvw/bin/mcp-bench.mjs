#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { cpus, loadavg } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';

const help = `Usage: node .agents/skills/verify-uvw/bin/mcp-bench.mjs [flags]
Load verify-uvw env first. Runs against that disposable single-executor stack only.
Writes a JSON report to --output and stdout. Progress goes to stderr.
  --scenario all|cold|warm|memory|writes|profile  Default all (profile is separate)
  --cold-runs N       Distinct cold Units, default 10
  --warm-runs N       Warm inspect and execute calls each, default 50
  --seconds N         Back-to-back write duration per step, default 30
  --repeats N         Repeats per write concurrency, default 5
  --writers 1,2,4,8,16  Distinct-Unit concurrency steps
  --same-unit N       Additional same-Unit writer step, default 8
  --output PATH       Required, persisted after each scenario, even on failure
  --quiet-load N      Maximum host 1-minute load before each run, default cores/2
  --quiet-timeout N   Seconds to wait for quiet, default 3600
  --self-test         Check statistics and readback validation without a stack
  --help             Show this text
Memory samples 1,2,4,8 warm workers, five samples per step. Restarts only this run's
executor to isolate each population. All needs EXECUTOR_MAX_WORKERS >= max(writers,8)
and EXECUTOR_IDLE_TTL_MS >= 300000 at up. Defaults stay unchanged in product.
Latency includes MCP connect, call and close. Gateway event duration and worker
wall time are separate. Every commit gets a unique cell and a final inspect readback.
Stops increasing concurrency on any error or p95 > 5x the preceding step.
Competing-stack waits poll every 120 s; host-only load waits poll every 10 s.
Profile runs a separate 10-second eight-writer step with host and container counters.
This is a local Docker Desktop baseline, not production capacity. Creates draft PRs
and Units only in the disposable run. No credentials are written to the report.`;
const flags = { scenario: 'all', 'cold-runs': 10, 'warm-runs': 50, seconds: 30, repeats: 5,
  writers: '1,2,4,8,16', 'same-unit': 8, 'quiet-load': cpus().length / 2, 'quiet-timeout': 3600 };
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i].replace(/^--/, '');
  if (key === 'help') { console.log(help); process.exit(0); }
  if (key === 'self-test') { flags[key] = true; continue; }
  assert(process.argv[i].startsWith('--') && (key in flags || key === 'output'), `Unknown flag ${process.argv[i]}`);
  assert(process.argv[i + 1] && !process.argv[i + 1].startsWith('--'), `Missing ${key}`);
  flags[key] = typeof flags[key] === 'number' ? Number(process.argv[++i]) : process.argv[++i];
}
function stats(values) {
  const v = values.toSorted((a, b) => a - b), n = v.length;
  return { n, median: n ? (v[Math.floor((n - 1) / 2)] + v[Math.ceil((n - 1) / 2)]) / 2 : null,
    min: n ? v[0] : null, max: n ? v.at(-1) : null,
    ...(n >= 20 ? { p95: v[Math.ceil(n * .95) - 1] } : {}) };
}
function checkCells(output, writes) {
  const cells = output.ranges[0].displayValues;
  const missing = writes.filter(w => String(cells[w.row]?.[w.column] ?? '') !== w.value);
  return { expected: writes.length, matched: writes.length - missing.length, missing: missing.map(w => w.cell) };
}
if (flags['self-test']) {
  assert.deepEqual(stats([3, 1, 2, 4]), { n: 4, median: 2.5, min: 1, max: 4 });
  assert.equal(stats(Array.from({ length: 20 }, (_, i) => i + 1)).p95, 19);
  assert.deepEqual(checkCells({ ranges: [{ displayValues: [['a']] }] }, [{ row: 0, column: 0, value: 'a', cell: 'A1' }]), { expected: 1, matched: 1, missing: [] });
  assert.deepEqual(checkCells({ ranges: [{ displayValues: [] }] }, [{ row: 0, column: 0, value: 'a', cell: 'A1' }]).missing, ['A1']);
  console.log('PASS statistics and committed-cell readback self-check'); process.exit(0);
}
for (const key of ['cold-runs', 'warm-runs', 'seconds', 'repeats', 'same-unit', 'quiet-timeout'])
  assert(Number.isInteger(flags[key]) && flags[key] > 0, `${key} must be a positive integer`);
assert(flags['same-unit'] <= 26, 'same-unit must be at most 26');
assert(Number.isFinite(flags['quiet-load']) && flags['quiet-load'] > 0, 'quiet-load must be positive');
assert(['all', 'cold', 'warm', 'memory', 'writes', 'profile'].includes(flags.scenario), 'Unknown scenario');
const writerCounts = flags.writers.split(',').map(Number);
assert(writerCounts.length && writerCounts.every(n => Number.isInteger(n) && n > 0 && n <= 26), 'writers must be integers 1..26');
assert(flags.output && process.env.VERIFY_UVW_RUN && process.env.MCP_URL, 'Set --output and load verify-uvw env');
const root = process.cwd(), run = join(process.env.VERIFY_UVW_ROOT ?? '/tmp/verify-uvw', process.env.VERIFY_UVW_RUN);
const settings = Object.fromEntries(readFileSync(join(run, 'run.env'), 'utf8').trim().split('\n').map(line => line.split('=')));
assert.equal(settings.MCP_EXECUTORS, '1', 'Benchmark requires exactly one executor');
const secret = name => readFileSync(join(run, 'home', name), 'utf8').trim();
const outputFile = resolve(flags.output), prefix = `bench-${randomUUID().slice(0, 8)}`;
const report = { schemaVersion: 1, environment: 'local Docker Desktop baseline; not production hardware',
  startedAt: new Date().toISOString(), scriptSha256: createHash('sha256').update(readFileSync(process.argv[1])).digest('hex'),
  flags, run: settings, scenarios: [], quietChecks: [] };
const save = () => writeFileSync(outputFile, JSON.stringify(report, null, 2) + '\n');
const exec = promisify(execFile);
async function command(name, args) {
  const { stdout } = await exec(name, args, { encoding: 'utf8', timeout: 60000, maxBuffer: 64 << 20 }); return stdout;
}
const docker = args => command('docker', args);
const inventory = JSON.parse(await docker(['ps', '--format', 'json']).then(s => '[' + s.trim().split('\n').filter(Boolean).join(',') + ']'));
const own = inventory.filter(c => c.Names.startsWith(settings.MCP_PROJECT + '-'));
const executor = own.find(c => c.Names.endsWith('-executor-1'))?.ID;
const gateway = own.find(c => c.Names.endsWith('-gateway-1'))?.ID;
assert(executor && gateway, 'Missing this run executor or gateway');
const container = JSON.parse(await docker(['inspect', executor]))[0];
report.image = { id: container.Image, name: container.Config.Image };
const executorEnv = Object.fromEntries(container.Config.Env.map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)]; }));
report.executorConfig = Object.fromEntries(['EXECUTOR_MAX_WORKERS', 'EXECUTOR_IDLE_TTL_MS', 'EXECUTOR_QUEUE_TIMEOUT_MS'].map(k => [k, executorEnv[k] ?? 'product default']));
if (['all', 'memory', 'writes', 'profile'].includes(flags.scenario)) {
  const needed = ['all', 'writes'].includes(flags.scenario) ? Math.max(8, ...writerCounts) : 8;
  assert(Number(executorEnv.EXECUTOR_MAX_WORKERS) >= needed, 'Raise EXECUTOR_MAX_WORKERS before up');
  assert(Number(executorEnv.EXECUTOR_IDLE_TTL_MS) >= 300000, 'Raise EXECUTOR_IDLE_TTL_MS before up');
}
report.host = { nodeVersion: process.version, cpuCount: cpus().length, cpu: cpus()[0].model, docker: JSON.parse(await docker(['info', '--format', '{{json .}}'])).NCPU,
  dockerMemoryBytes: Number((await docker(['info', '--format', '{{.MemTotal}}'])).trim()),
  gitHead: (await command('git', ['rev-parse', 'HEAD'])).trim() };
const require = createRequire(join(root, 'apps/mcp/package.json'));
const { Client, StreamableHTTPClientTransport } = require('@modelcontextprotocol/client');
let sequence = 0;
async function quiet(label) {
  const started = Date.now();
  for (;;) {
    const containers = await docker(['ps', '--format', '{{.Names}}']);
    const others = containers.trim().split('\n').filter(n => n.startsWith('verify-uvw-') && !n.startsWith(settings.MCP_PROJECT + '-'));
    const observation = { label, at: new Date().toISOString(), uptime: (await command('uptime', [])).trim(), load: loadavg(), containers, others };
    report.quietChecks.push(observation); save();
    if (!others.length && observation.load[0] <= flags['quiet-load']) return observation;
    assert(Date.now() - started < flags['quiet-timeout'] * 1000, `Quiet-machine timeout for ${label}`);
    console.error(`Waiting for quiet machine at ${label}, load=${observation.load[0]}, other stacks=${others.join(',')}`);
    await sleep(others.length ? 120000 : 10000);
  }
}
async function call(tool, args) {
  const requestId = `${prefix}-${sequence++}`, startedAt = new Date().toISOString(), started = performance.now();
  const client = new Client({ name: 'verify-uvw-bench', version: '1.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
  let httpStatus, result;
  const url = new URL(process.env.MCP_URL); url.searchParams.set('toolsets', 'all');
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { authorization: `Bearer ${secret('mcp-token')}`, 'x-request-id': requestId } },
    fetch: async (url, init) => {
      const r = await fetch(url, { ...init, signal: AbortSignal.timeout(35000) }); httpStatus = r.status; return r;
    },
  });
  try { await client.connect(transport); result = await client.callTool({ name: tool, arguments: args }); }
  catch (error) { result = { isError: true, structuredContent: { code: `transport-${httpStatus ?? 'unknown'}`, message: error.message } }; }
  finally { await client.close().catch(() => {}); }
  return { requestId, tool, startedAt, latencyMs: performance.now() - started, httpStatus, isError: !!result.isError, output: result.structuredContent };
}
async function ok(tool, args) {
  const r = await call(tool, args); assert(!r.isError, `${tool}: ${JSON.stringify(r.output)}`); return r.output;
}
let repo;
async function targets(n) {
  repo ??= (await ok('repo_list', { type: 'personal' })).repos[0].id;
  const key = `${prefix}-${sequence}`;
  const pr = await ok('pr_create', { repo, title: key, idempotency_key: key });
  const result = [];
  for (let i = 0; i < n; i++) {
    const { unit } = await ok('unit_create', { worktree: pr.id, space: repo, type: 'sheet', name: `bench-${i}`, idempotency_key: `${key}-u${i}` });
    result.push({ worktree: pr.id, unit: unit.unitId });
  }
  return result;
}
const inspect = (target, range = 'A1:A1') => ({ ...target, target: 'range', selectors: [range], worksheet: 'index:1' });
async function metrics() {
  return await docker(['exec', gateway, 'node', '--input-type=module', '-e', `const r=await fetch(new URL('/metrics', process.env.MCP_EXECUTOR_URLS),{headers:{authorization:'Bearer '+process.env.MCP_INTERNAL_TOKEN}});if(!r.ok)throw Error(r.status);console.log(await r.text());`]);
}
function metricValues(text) {
  return Object.fromEntries(text.split('\n').filter(l => l && !l.startsWith('#')).map(l => [l.slice(0, l.lastIndexOf(' ')), Number(l.slice(l.lastIndexOf(' ') + 1))]));
}
async function evidence(rows, before) {
  const after = await metrics();
  const since = rows.map(r => r.startedAt).sort()[0];
  const logs = (await docker(['logs', '--since', since, gateway])).split('\n').flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
  const byId = new Map(logs.filter(l => l.event === 'mcp.tool_call').map(l => [l.request_id, l]));
  for (const r of rows) r.event = byId.get(r.requestId) ?? null;
  const a = metricValues(after), b = metricValues(before);
  return { before, after, deltas: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v - (b[k] ?? 0)])),
    usageEvents: rows.filter(r => r.event).length, committedRevisions: rows.reduce((n, r) => n + (r.event?.cost.committed_revisions ?? 0), 0),
    missingEvents: rows.filter(r => !r.event).map(r => r.requestId),
    coldEvents: rows.filter(r => r.event?.executor === 'cold_start').length, warmEvents: rows.filter(r => r.event?.executor === 'warm').length };
}
function summary(rows) {
  const errors = rows.filter(r => r.isError || (r.tool === 'execute' && !r.output?.committed));
  const codes = {};
  for (const r of errors) { const code = r.output?.code ?? 'uncommitted'; codes[code] = (codes[code] ?? 0) + 1; }
  return { attempts: rows.length, errors: errors.length, errorCodes: codes, latencyMs: stats(rows.map(r => r.latencyMs)),
    gatewayMs: stats(rows.filter(r => r.event).map(r => r.event.duration_ms)),
    workerWallMs: stats(rows.filter(r => r.event).map(r => r.event.cost.worker_cpu_ms)) };
}
async function restart() {
  await docker(['restart', executor]);
  for (let i = 0; i < 60; i++) {
    if ((await docker(['inspect', '--format', '{{.State.Health.Status}}', executor])).trim() === 'healthy') return;
    await sleep(1000);
  }
  throw Error('Executor did not become healthy after restart');
}
const procScript = `const fs=require('fs');const result=[];for(const pid of fs.readdirSync('/proc').filter(x=>/^\\d+$/.test(x))){try{const status=fs.readFileSync('/proc/'+pid+'/status','utf8');const cmd=fs.readFileSync('/proc/'+pid+'/cmdline','utf8').replaceAll('\\0',' ');if(cmd.includes('dist/main.js')||cmd.includes('/univer-collaboration-runtime-pool/dist/worker-child.mjs'))result.push({pid:Number(pid),ppid:Number(status.match(/^PPid:\\s+(\\d+)/m)[1]),rssKiB:Number(status.match(/^VmRSS:\\s+(\\d+)/m)[1]),cmd});}catch{}}console.log(JSON.stringify(result));`;
async function processes() {
  // Exclude the probe itself, whose command line contains the script's match strings.
  const rows = JSON.parse(await docker(['exec', executor, 'node', '-e', procScript]));
  return rows.filter(p => !p.cmd.includes('const fs='));
}
async function monitor(stop) {
  const samples = [];
  while (!stop.done) {
    const at = new Date().toISOString();
    const host = await command('ps', ['-axo', 'pid=,ppid=,%cpu=,rss=,time=,command=']);
    const relevant = host.split('\n').filter(l => [settings.SERVER_PID, String(process.pid)].includes(l.trim().split(/\s+/)[0]) || l.includes('tsx/dist/') && l.includes('server/src/main.ts'));
    const container = await docker(['stats', '--no-stream', '--format', '{{json .}}', executor, gateway]);
    const active = (await docker(['ps', '--format', '{{.Names}}'])).trim().split('\n');
    const competing = active.filter(n => n.startsWith('verify-uvw-') && !n.startsWith(settings.MCP_PROJECT + '-'));
    samples.push({ at, host: relevant, competing, containers: container.trim().split('\n').map(l => JSON.parse(l)) });
    if (!stop.done) await sleep(1000);
  }
  return samples;
}
async function readback(target, writes, columns = 1) {
  const committed = writes.filter(r => !r.isError && r.output?.committed);
  const rows = Math.max(1, ...writes.map(w => w.row + 1));
  const data = await ok('inspect', inspect(target, `A1:${String.fromCharCode(64 + columns)}${rows}`));
  const proof = checkCells(data, committed);
  assert.equal(proof.missing.length, 0, 'Every confirmed commit must be read back');
  return proof;
}
async function callsScenario(name, targetList, tool, count) {
  const quietCheck = await quiet(name), before = await metrics(), rows = [];
  for (let i = 0; i < count; i++) {
    const target = targetList[i % targetList.length];
    const row = i, value = `${prefix}-${i}`;
    const args = tool === 'inspect' ? inspect(target) : { ...target, code: `workbook.getActiveSheet().getRange('A${i + 1}').setValue(${JSON.stringify(value)});return ${JSON.stringify(value)};` };
    rows.push({ ...await call(tool, args), row, column: 0, cell: `A${i + 1}`, value });
  }
  const counters = await evidence(rows, before);
  const proof = tool === 'execute' ? await readback(targetList[0], rows) : { inspectedUnits: rows.filter(r => !r.isError && Array.isArray(r.output?.ranges)).length };
  if (tool === 'execute') assert.equal(counters.committedRevisions, proof.expected, 'Usage counts every confirmed commit');
  const result = { name, quietCheck, ...summary(rows), counters, readback: proof, rows };
  if (tool === 'inspect') assert.equal(proof.inspectedUnits, count, 'Every inspection returns a Unit range');
  report.scenarios.push(result); save(); console.error(`${name}: ${result.attempts} calls, ${result.errors} errors`);
  assert.equal(counters.missingEvents.length, 0, 'All timed calls need usage events');
  if (name === 'cold') assert.equal(counters.coldEvents, count, 'Every cold call must start a worker');
  else assert.equal(counters.warmEvents, count, 'Every warm call must reuse a worker');
}
async function writeStep(k, sameUnit, repeat, seconds) {
  const name = `${sameUnit ? 'same-unit' : 'distinct'}-${k}-${repeat}`;
  const quietCheck = await quiet(name);
  await restart();
  const ts = await targets(sameUnit ? 1 : k);
  for (const t of ts) await ok('execute', { ...t, code: 'workbook.getActiveSheet().setRowCount(100000);' });
  const before = await metrics(), stop = { done: false };
  const monitored = monitor(stop), started = performance.now(), end = started + seconds * 1000;
  let rows;
  try {
    rows = (await Promise.all(Array.from({ length: k }, (_, writer) => (async () => {
      const writes = [], column = sameUnit ? writer : 0, letter = String.fromCharCode(65 + column), target = ts[sameUnit ? 0 : writer];
      for (let row = 0; performance.now() < end; row++) {
        const cell = `${letter}${row + 1}`, value = `${prefix}-${writer}-${row}`;
        const result = await call('execute', { ...target, code: `workbook.getActiveSheet().getRange('${cell}').setValue(${JSON.stringify(value)});return ${JSON.stringify(value)};` });
        writes.push({ ...result, writer, row, column, cell, value });
      }
      return writes;
    })()))).flat();
  } finally { stop.done = true; }
  const elapsedMs = performance.now() - started, samples = await monitored, counters = await evidence(rows, before);
  const proofs = [];
  for (let i = 0; i < ts.length; i++) proofs.push(await readback(ts[i], sameUnit ? rows : rows.filter(r => r.writer === i), sameUnit ? k : 1));
  const committed = rows.filter(r => !r.isError && r.output?.committed).length;
  const result = { name, k, sameUnit, repeat, rowCount: 100000, durationSeconds: seconds, elapsedMs, quietCheck,
    ...summary(rows), committed, writesPerSecond: committed / (elapsedMs / 1000), writesPerMinute: committed / (elapsedMs / 60000),
    counters, readback: proofs, samples, rows };
  report.scenarios.push(result); save(); console.error(`${name}: ${committed} commits, ${result.errors} errors`);
  assert(samples.every(s => !s.competing.length), 'A competing verify stack appeared during the timed run');
  assert.equal(counters.missingEvents.length, 0, 'All writes need usage events');
  assert.equal(counters.committedRevisions, committed, 'Usage counts every confirmed commit');
  return result;
}
try {
  save();
  if (['all', 'cold'].includes(flags.scenario)) {
    await quiet('cold-preparation'); await restart(); await callsScenario('cold', await targets(flags['cold-runs']), 'inspect', flags['cold-runs']);
  }
  if (['all', 'warm'].includes(flags.scenario)) {
    await quiet('warm-preparation');
    const ts = await targets(1); await ok('inspect', inspect(ts[0]));
    await callsScenario('warm-inspect', ts, 'inspect', flags['warm-runs']);
    await callsScenario('warm-execute', ts, 'execute', flags['warm-runs']);
  }
  if (['all', 'memory'].includes(flags.scenario)) {
    for (const n of [1, 2, 4, 8]) {
      const quietCheck = await quiet(`memory-${n}`);
      await restart(); const ts = await targets(n);
      for (const t of ts) await ok('inspect', inspect(t));
      await sleep(3000);
      const samples = [];
      for (let i = 0; i < 5; i++) { samples.push({ at: new Date().toISOString(), processes: await processes() }); await sleep(1000); }
      const result = { name: `memory-${n}`, population: n, snapshots: 5, errors: 0, errorCodes: {}, quietCheck, samples,
        parentRssMiB: stats(samples.flatMap(s => s.processes.filter(p => p.pid === 1).map(p => p.rssKiB / 1024))),
        workerRssMiB: stats(samples.flatMap(s => s.processes.filter(p => p.ppid === 1 && p.pid !== 1).map(p => p.rssKiB / 1024))) };
      report.scenarios.push(result); save();
      assert(samples.every(s => s.processes.filter(p => p.ppid === 1 && p.pid !== 1).length === n), `Expected ${n} live workers`);
      assert.equal(result.parentRssMiB.n, 5, 'Parent sampled each time');
      console.error(`memory-${n}: ${result.workerRssMiB.median} MiB median worker RSS`);
    }
  }
  if (['all', 'writes'].includes(flags.scenario)) {
    let previous;
    for (const k of writerCounts) {
      const runs = [];
      for (let r = 0; r < flags.repeats; r++) {
        const result = await writeStep(k, false, r, flags.seconds); runs.push(result);
        if (result.errors) break;
      }
      const p95 = stats(runs.map(r => r.latencyMs.p95 ?? r.latencyMs.max)).median;
      if (runs.some(r => r.errors) || (previous && p95 > previous * 5)) {
        report.stop = { k, reason: runs.some(r => r.errors) ? 'errors' : 'p95 exceeds 5x previous step' }; save(); break;
      }
      previous = p95;
    }
    for (let r = 0; r < flags.repeats; r++) await writeStep(flags['same-unit'], true, r, flags.seconds);
  }
  if (flags.scenario === 'profile') await writeStep(8, false, 0, 10);
  report.completedAt = new Date().toISOString(); save(); console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failure = { message: error.message, at: new Date().toISOString() }; save(); throw error;
}
