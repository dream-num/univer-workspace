#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { cpus, loadavg } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';

const help = `Usage: node .agents/skills/verify-uvw/bin/renderer-bench.mjs [flags]
Load verify-uvw env first (needs VERIFY_UVW_MCP=1 and a running stack). Runs against that disposable stack's renderer only,
and recreates the renderer container many times: nothing else on the stack may be in use. Raw JSON goes to --output after every
scenario; render it with renderer-bench-summary.py. Progress goes to stderr.
  --scenario all|cold|warm|throughput|soak|e2e  Default all (e2e needs --e2e-sheet and --e2e-doc)
  --cold-runs N        Fresh renderers per operation, default 5. Each fires two concurrent calls: one lands on the prewarmed
                       runtime, one must start a runtime (cold)
  --warm-blocks N      Blocks of sequential calls per operation, default 5
  --warm-calls N       Calls per block, default 20
  --repeats N          Runs per throughput setting, default 5. Settings alternate order each repeat
  --seconds N          Timed window per throughput run after a 4 s warm-up, default 20
  --concurrency N      Closed-loop callers per throughput run, default 4
  --settings 1,2       RENDERER_MAX_RUNTIMES values compared by the throughput scenario, default 1,2
  --memory-limit MiB   Apply docker update --memory (and no swap) to the renderer after every restart, to see whether a budget holds
  --soak-renders N     Sequential renders on one runtime per soak, default 200
  --soak-every N       Memory sample interval in renders, default 25
  --soak-repeats N     Soaks per operation, default 1
  --e2e-calls N        Warm tool calls per Unit, default 10
  --e2e-sheet UNIT:WORKTREE, --e2e-doc UNIT:WORKTREE   Units for the end-to-end comparison
  --output PATH        Required
  --quiet-load N       Host 1-minute load considered quiet, default cores/2
  --quiet-timeout N    Seconds to wait for quiet before each run, default 0. A run that starts busy is recorded as busy
  --self-test          Check statistics and input shapes without a stack
  --help               Show this text
Operations: screenshot of a 40x8-cell Sheet range, screenshot and print of a 40-paragraph Doc, measureText of one mixed line.
Calls go from inside the executor container to the renderer RPC, so the figures exclude gateway, executor and Workspace time.
Memory is read from /proc inside the renderer (Node process plus one Chromium tree per runtime) and from its cgroup.
The renderer is recreated with RENDERER_MAX_RUNTIMES=2 at the end. This is a local Docker Desktop baseline, not production capacity.`;
const flags = { scenario: 'all', 'cold-runs': 5, 'warm-blocks': 5, 'warm-calls': 20, repeats: 5, seconds: 20, concurrency: 4,
  'soak-renders': 200, 'soak-every': 25, 'soak-repeats': 1, 'e2e-calls': 10, 'quiet-load': cpus().length / 2, 'quiet-timeout': 0, settings: '1,2', 'memory-limit': 0 };
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i].replace(/^--/, '');
  if (key === 'help') { console.log(help); process.exit(0); }
  if (key === 'self-test') { flags[key] = true; continue; }
  assert(process.argv[i].startsWith('--') && (key in flags || ['output', 'e2e-sheet', 'e2e-doc'].includes(key)), `Unknown flag ${process.argv[i]}`);
  assert(process.argv[i + 1] && !process.argv[i + 1].startsWith('--'), `Missing ${key}`);
  flags[key] = typeof flags[key] === 'number' ? Number(process.argv[++i]) : process.argv[++i];
}

function stats(values) {
  const v = values.toSorted((a, b) => a - b), n = v.length;
  return { n, median: n ? (v[Math.floor((n - 1) / 2)] + v[Math.ceil((n - 1) / 2)]) / 2 : null,
    min: n ? v[0] : null, max: n ? v.at(-1) : null, ...(n >= 20 ? { p95: v[Math.ceil(n * .95) - 1] } : {}) };
}

const latin = 'The quick brown fox jumps over the lazy dog while the totals for this region stay near forty units, repeated so that the paragraph wraps onto a second and a third line of the page.';
function docUnit(paragraphs, id) {
  const texts = Array.from({ length: paragraphs }, (_, i) => `Paragraph ${i + 1}: ${latin}`);
  const text = texts.join('\r');
  const starts = []; let at = -1;
  for (const t of texts) { at += t.length + 1; starts.push(at); }
  return {
    id, documentStyle: { pageSize: { width: 595, height: 842 }, marginTop: 72, marginBottom: 72, marginLeft: 72, marginRight: 72 },
    body: { dataStream: `${text}\r\n`, paragraphs: starts.map((startIndex) => ({ startIndex })), sectionBreaks: [{ startIndex: text.length + 1 }],
      textRuns: [{ st: 0, ed: text.length, ts: { fs: 14 } }] },
  };
}
function sheetUnitData(rows, cols) {
  const cellData = {};
  for (let r = 0; r < rows; r++) {
    cellData[r] = {};
    for (let c = 0; c < cols; c++) cellData[r][c] = c === 0 ? { v: `Region ${r + 1} 区域`, t: 1 } : { v: (r + 1) * (c + 1) * 1.5, t: 2 };
  }
  return { id: 'renderer-bench-sheet', name: 'Renderer bench', appVersion: '3.0.0-alpha', locale: 'zhCN', styles: {}, sheetOrder: ['s1'],
    sheets: { s1: { id: 's1', name: 'Sheet1', rowCount: rows + 10, columnCount: cols + 2, defaultColumnWidth: 100, defaultRowHeight: 24, cellData } } };
}
const DOC_PARAGRAPHS = 40, SHEET_ROWS = 40, SHEET_COLUMNS = 8;
const doc = docUnit(DOC_PARAGRAPHS, 'renderer-bench-doc');
const OPERATIONS = {
  'screenshot-sheet': { op: 'screenshot', input: { unitType: 'sheet', unitData: sheetUnitData(SHEET_ROWS, SHEET_COLUMNS), target: { kind: 'sheet-range', range: `A1:H${SHEET_ROWS}` } } },
  'screenshot-doc': { op: 'screenshot', input: { unitType: 'doc', unitData: doc, target: { kind: 'doc-pages' } } },
  'printpdf-doc': { op: 'printPdf', input: { unitType: 'doc', unitData: doc } },
  'measure-text': { op: 'measureText', input: { doc: { ...docUnit(1, 'renderer-bench-measure'), documentStyle: { marginBottom: 0, marginLeft: 0, marginRight: 0, marginTop: 0, pageSize: { height: 1000000, width: 1000000 } } } } },
};
const OP_NAMES = Object.keys(OPERATIONS);
const rotate = (list, by) => list.map((_, i) => list[(i + by) % list.length]);

if (flags['self-test']) {
  assert.deepEqual(stats([3, 1, 2, 4]), { n: 4, median: 2.5, min: 1, max: 4 });
  assert.equal(stats(Array.from({ length: 20 }, (_, i) => i + 1)).p95, 19);
  assert.deepEqual(rotate(['a', 'b', 'c'], 1), ['b', 'c', 'a']);
  for (const [name, { input }] of Object.entries(OPERATIONS)) {
    const body = (input.unitData ?? input.doc).body;
    if (!body) continue;
    for (const p of body.paragraphs) assert.equal(body.dataStream[p.startIndex], '\r', `${name}: paragraph ends on \\r`);
    assert.equal(body.dataStream[body.sectionBreaks[0].startIndex], '\n', `${name}: section break on \\n`);
    assert.equal(body.dataStream.length, body.sectionBreaks[0].startIndex + 1);
  }
  assert.equal(Object.keys(sheetUnitData(3, 2).sheets.s1.cellData[2]).length, 2);
  console.log('PASS statistics and renderer input shape self-check'); process.exit(0);
}

for (const key of ['cold-runs', 'warm-blocks', 'warm-calls', 'repeats', 'seconds', 'concurrency', 'soak-renders', 'soak-every', 'soak-repeats', 'e2e-calls'])
  assert(Number.isInteger(flags[key]) && flags[key] > 0, `${key} must be a positive integer`);
assert(Number.isInteger(flags['quiet-timeout']) && flags['quiet-timeout'] >= 0, 'quiet-timeout must be a non-negative integer');
assert(['all', 'cold', 'warm', 'throughput', 'soak', 'e2e'].includes(flags.scenario), 'Unknown scenario');
assert(flags.output && process.env.VERIFY_UVW_RUN && process.env.VERIFY_UVW_MCP === '1', 'Set --output and load verify-uvw env with VERIFY_UVW_MCP=1');
const root = process.cwd(), runDir = join(process.env.VERIFY_UVW_ROOT ?? '/tmp/verify-uvw', process.env.VERIFY_UVW_RUN);
const settings = Object.fromEntries(readFileSync(join(runDir, 'run.env'), 'utf8').trim().split('\n').map((line) => line.split('=')));
const secret = (name) => readFileSync(join(runDir, 'home', name), 'utf8').trim();
const verifyUvw = join(root, '.agents/skills/verify-uvw/bin/verify-uvw');
const loadScript = readFileSync(join(root, '.agents/skills/verify-uvw/bin/renderer-bench-load.mjs'), 'utf8');
const sampleScript = readFileSync(join(root, '.agents/skills/verify-uvw/bin/renderer-bench-sample.mjs'), 'utf8');
const exec = promisify(execFile);
const command = async (name, args, options = {}) => (await exec(name, args, { encoding: 'utf8', timeout: 180000, maxBuffer: 256 << 20, ...options })).stdout;
const docker = (args, options) => command('docker', args, options);
const names = { executor: `${settings.MCP_PROJECT}-executor-1`, renderer: `${settings.MCP_PROJECT}-renderer-1`, gateway: `${settings.MCP_PROJECT}-gateway-1` };

const outputFile = resolve(flags.output);
const report = { schemaVersion: 1, environment: 'local Docker Desktop baseline, shared with other workloads; not production hardware',
  startedAt: new Date().toISOString(), scriptSha256: createHash('sha256').update(readFileSync(process.argv[1])).digest('hex'),
  flags, run: settings, inputs: { sheet: { rows: SHEET_ROWS, columns: SHEET_COLUMNS }, doc: { paragraphs: DOC_PARAGRAPHS } }, quietChecks: [], scenarios: [] };
const save = () => writeFileSync(outputFile, JSON.stringify(report, null, 2) + '\n');
const info = JSON.parse(await docker(['info', '--format', '{{json .}}']));
const rendererImage = JSON.parse(await docker(['inspect', names.renderer]))[0];
Object.assign(report, { image: { id: rendererImage.Image, name: rendererImage.Config.Image },
  host: { nodeVersion: process.version, cpuCount: cpus().length, cpu: cpus()[0].model, dockerCpus: info.NCPU, dockerMemoryBytes: info.MemTotal,
    gitHead: (await command('git', ['rev-parse', 'HEAD'])).trim(),
    topCpuAtStart: (await command('ps', ['-Aro', '%cpu,comm'])).trim().split('\n').slice(0, 9) } });

async function quiet(label) {
  const started = Date.now();
  for (;;) {
    const observation = { label, at: new Date().toISOString(), uptime: (await command('uptime', [])).trim(), load: loadavg() };
    observation.busy = observation.load[0] > flags['quiet-load'];
    if (!observation.busy || Date.now() - started >= flags['quiet-timeout'] * 1000) { report.quietChecks.push(observation); return observation; }
    await sleep(10000);
  }
}
async function restart(max) {
  const started = performance.now();
  await command(verifyUvw, ['renderer-restart', String(max)], { env: process.env, timeout: 120000 });
  if (flags['memory-limit']) await docker(['update', `--memory=${flags['memory-limit']}m`, `--memory-swap=${flags['memory-limit']}m`, names.renderer]);
  return performance.now() - started;
}
async function load(phases) {
  const child = spawn('docker', ['exec', '-i', names.executor, 'node', '--input-type=module', '-e', loadScript], { stdio: ['pipe', 'pipe', 'pipe'] });
  const out = [], err = [];
  child.stdout.on('data', (c) => out.push(c)); child.stderr.on('data', (c) => err.push(c));
  child.stdin.end(JSON.stringify({ phases }));
  const code = await new Promise((done) => child.on('close', done));
  assert.equal(code, 0, `load runner failed: ${Buffer.concat(err).toString()}`);
  return JSON.parse(Buffer.concat(out).toString()).phases;
}
function sampler(intervalMs = 500) {
  const child = spawn('docker', ['exec', '-i', names.renderer, 'node', '--input-type=module', '-e', sampleScript, String(intervalMs)], { stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = []; let buffer = '';
  child.stdout.on('data', (c) => { buffer += c; const parts = buffer.split('\n'); buffer = parts.pop(); lines.push(...parts); });
  const closed = new Promise((done) => child.on('close', done));
  return { async stop() { child.stdin.end(); await closed; return lines.map((l) => JSON.parse(l)); } };
}
async function snapshots(count = 3) {
  const s = sampler(400); await sleep(400 * count + 150); return (await s.stop()).slice(0, count);
}
async function metrics() {
  const text = await docker(['exec', names.executor, 'node', '--input-type=module', '-e',
    `const r=await fetch(new URL('/metrics',process.env.MCP_RENDERER_URL),{headers:{authorization:'Bearer ${secret('metrics-token')}'}});if(!r.ok)throw Error(r.status);console.log(await r.text())`]);
  return Object.fromEntries(text.split('\n').filter((l) => l.startsWith('mcp_renderer')).map((l) => [l.slice(0, l.lastIndexOf(' ')), Number(l.slice(l.lastIndexOf(' ') + 1))]));
}
const delta = (a, b) => Object.fromEntries(Object.entries(b).filter(([k]) => !k.startsWith('mcp_renderer_runtimes')).map(([k, v]) => [k, v - (a[k] ?? 0)]));
const callSpec = (name, label = name) => ({ label, op: OPERATIONS[name].op, input: OPERATIONS[name].input });
const summary = (rows) => ({ calls: rows.length, errors: rows.filter((r) => !r.ok).length, notReal: rows.filter((r) => r.ok && !r.real).length,
  errorCodes: rows.filter((r) => !r.ok).reduce((n, r) => { const k = r.code ?? `transport-${r.transport}`; n[k] = (n[k] ?? 0) + 1; return n; }, {}) });
async function scenario(entry) { report.scenarios.push(entry); save(); console.error(`${entry.name}: ${entry.calls ?? ''} calls, ${entry.errors ?? 0} errors`); }

async function cold() {
  for (let rep = 0; rep < flags['cold-runs']; rep++) for (const name of rotate(OP_NAMES, rep)) {
    const q = await quiet(`cold-${name}-${rep}`);
    const restartMs = await restart(2);
    const before = await metrics(), idleFresh = await snapshots();
    const [phase] = await load([{ name: 'pair', concurrency: 2, calls: 2, call: callSpec(name) }]);
    await sleep(1000);
    const idleUsed = await snapshots(), after = await metrics();
    await scenario({ name: `cold-${name}-${rep}`, kind: 'cold', op: name, rep, quiet: q, restartMs, ...summary(phase.rows), rows: phase.rows, idleFresh, idleUsed, counters: delta(before, after) });
  }
}
async function warm() {
  await restart(2);
  for (const name of OP_NAMES) await load([{ name: 'warmup', concurrency: 1, calls: 3, call: callSpec(name) }]);
  for (let block = 0; block < flags['warm-blocks']; block++) for (const name of rotate(OP_NAMES, block)) {
    const q = await quiet(`warm-${name}-${block}`), before = await metrics();
    const [phase] = await load([{ name: 'block', concurrency: 1, calls: flags['warm-calls'], call: callSpec(name) }]);
    await scenario({ name: `warm-${name}-${block}`, kind: 'warm', op: name, block, quiet: q, ...summary(phase.rows), rows: phase.rows, counters: delta(before, await metrics()) });
  }
}
async function dockerStatsLoop(stop) {
  const samples = [];
  while (!stop.done) {
    const text = await docker(['stats', '--no-stream', '--format', '{{json .}}', names.renderer, names.executor]);
    samples.push({ at: new Date().toISOString(), containers: text.trim().split('\n').map((l) => JSON.parse(l)) });
  }
  return samples;
}
async function throughput() {
  const sizes = flags.settings.split(',').map(Number);
  assert(sizes.every((n) => Number.isInteger(n) && n > 0 && n <= 8), 'settings must be integers 1..8');
  const ops = ['screenshot-sheet', 'printpdf-doc'];
  for (let rep = 0; rep < flags.repeats; rep++) for (const name of ops) for (const max of rep % 2 ? sizes.toReversed() : sizes) {
    const label = `throughput-${name}-max${max}-${rep}`;
    const q = await quiet(label), restartMs = await restart(max);
    const before = await metrics(), s = sampler(250), stop = { done: false }, stats = dockerStatsLoop(stop);
    let phases;
    try {
      phases = await load([
        { name: 'warmup', concurrency: flags.concurrency, seconds: 4, call: callSpec(name) },
        { name: 'timed', concurrency: flags.concurrency, seconds: flags.seconds, call: callSpec(name) }]);
    } finally { stop.done = true; }
    const memory = await s.stop(), oom = JSON.parse(await docker(['inspect', '--format', '{{json .State}}', names.renderer])), dockerSamples = await stats, after = await metrics(), idleAfter = await snapshots();
    const timed = phases[1], rows = timed.rows.filter((r) => r.endMs <= flags.seconds * 1000);
    await scenario({ name: label, kind: 'throughput', op: name, max, rep, quiet: q, restartMs, concurrency: flags.concurrency, windowSeconds: flags.seconds,
      ...summary(timed.rows), completedInWindow: rows.filter((r) => r.ok && r.real).length, rows: timed.rows, warmupRows: phases[0].rows.length,
      memoryLimitMiB: flags['memory-limit'], oomKilled: oom.OOMKilled, rendererRunning: oom.Running, memory, idleAfter, dockerSamples, counters: delta(before, after) });
  }
}
async function soak() {
  const chunks = Math.floor(flags['soak-renders'] / flags['soak-every']);
  for (let rep = 0; rep < flags['soak-repeats']; rep++) for (const name of ['screenshot-sheet', 'screenshot-doc', 'printpdf-doc']) {
    const label = `soak-${name}-${rep}`, q = await quiet(label);
    await restart(1);
    const before = await metrics(), points = [{ renders: 0, snapshots: await snapshots() }], rows = [];
    for (let chunk = 1; chunk <= chunks; chunk++) {
      const [phase] = await load([{ name: 'chunk', concurrency: 1, calls: flags['soak-every'], call: callSpec(name) }]);
      rows.push(...phase.rows); await sleep(1000);
      points.push({ renders: chunk * flags['soak-every'], snapshots: await snapshots(), chunkMedianMs: stats(phase.rows.map((r) => r.ms)).median });
    }
    const counters = delta(before, await metrics());
    await scenario({ name: label, kind: 'soak', op: name, rep, quiet: q, ...summary(rows), points, counters });
    assert.equal(counters['mcp_renderer_runtime_creations_total'], 0, 'The soak must reuse the prewarmed runtime without creating another');
  }
}
async function e2e() {
  assert(flags['e2e-sheet'] && flags['e2e-doc'], 'e2e needs --e2e-sheet UNIT:WORKTREE and --e2e-doc UNIT:WORKTREE');
  const require = createRequire(join(root, 'apps/mcp/package.json'));
  const { Client, StreamableHTTPClientTransport } = require('@modelcontextprotocol/client');
  await restart(2);
  const url = new URL(`http://127.0.0.1:${settings.MCP_PORT}/mcp`); url.searchParams.set('toolsets', 'all');
  const call = async (args, requestId) => {
    const client = new Client({ name: 'verify-uvw-renderer-bench', version: '1.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
    const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${secret('mcp-token')}`, 'x-request-id': requestId } } });
    const started = performance.now();
    try { await client.connect(transport); const r = await client.callTool({ name: 'screenshot', arguments: args }); return { requestId, ms: performance.now() - started, isError: !!r.isError, output: r.structuredContent }; }
    catch (error) { return { requestId, ms: performance.now() - started, isError: true, output: { message: error.message } }; }
    finally { await client.close().catch(() => {}); }
  };
  for (const [kind, target] of [['sheet', flags['e2e-sheet']], ['doc', flags['e2e-doc']]]) {
    const [unit, worktree] = target.split(':'), prefix = `bench-${randomUUID().slice(0, 8)}`, rows = [];
    const q = await quiet(`e2e-${kind}`), since = new Date().toISOString();
    for (let i = 0; i < flags['e2e-calls'] + 2; i++) rows.push(await call({ unit, worktree, ...(kind === 'sheet' ? { range: `A1:H${SHEET_ROWS}` } : {}) }, `${prefix}-${i}`));
    const logs = async (container) => (await docker(['logs', '--since', since, container])).split('\n').flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
    const events = new Map((await logs(names.gateway)).filter((l) => l.event === 'mcp.tool_call').map((l) => [l.request_id, l]));
    const renderer = new Map((await logs(names.renderer)).filter((l) => l.msg === 'Renderer request completed').map((l) => [l.request_id, l]));
    for (const r of rows) { r.gatewayMs = events.get(r.requestId)?.duration_ms ?? null; r.rendererMs = renderer.get(r.requestId)?.duration_ms ?? null; r.runtimeCold = renderer.get(r.requestId)?.runtime_cold ?? null; r.workerEvent = events.get(r.requestId)?.executor ?? null; }
    await scenario({ name: `e2e-${kind}`, kind: 'e2e', unitKind: kind, quiet: q, calls: rows.length, errors: rows.filter((r) => r.isError).length, rows });
  }
}

try {
  save();
  if (['all', 'cold'].includes(flags.scenario)) await cold();
  if (['all', 'warm'].includes(flags.scenario)) await warm();
  if (['all', 'throughput'].includes(flags.scenario)) await throughput();
  if (['all', 'soak'].includes(flags.scenario)) await soak();
  if (flags.scenario === 'e2e') await e2e();
  report.completedAt = new Date().toISOString(); save();
  console.log(`Wrote ${outputFile}`);
} catch (error) {
  report.failure = { message: error.message, at: new Date().toISOString() }; save(); throw error;
} finally {
  await restart(2).catch((error) => console.error(`Could not restore RENDERER_MAX_RUNTIMES=2: ${error.message}`));
}
