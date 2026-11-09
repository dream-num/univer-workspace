#!/usr/bin/env node
// Stage G isolation baseline for the MCP executor and renderer (features/mcp-security.md).
// Usage: node mcp-security-probes.mjs [--run <run-id>] [--only MG2,MG6,...]
// Prints one JSON line per probe on stdout, details on stderr, evidence under <run>/evidence/mcp-security/.
// Exit 0 whatever the results; 2 only when the stack cannot be reached. Records names and presence, never secret values.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SENSITIVE_NAME = /^(MCP_INTERNAL_TOKEN|UNIVER_LICENSE.*|.*_SECRET|.*_TOKEN|.*_KEY)$/;
export const REQUIREMENTS = {
  MG1: [1, 2], MG2: [1], MG3: [1, 5], MG4: [5], MG5: [1], MG6: [3, 4], MG7: [3, 4], MG8: [3], MG9: [6], MG10: [7], MG11: [1],
};
export const RESERVED = ['MG1', 'MG3'];
export const IMPLEMENTED = Object.keys(REQUIREMENTS).filter(id => !RESERVED.includes(id));


export const sensitiveNames = names => [...new Set(names.filter(n => SENSITIVE_NAME.test(n)))].sort();
export const parseOnly = value => {
  if (value === undefined) return IMPLEMENTED;
  const ids = value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  const bad = ids.filter(id => !IMPLEMENTED.includes(id));
  if (!ids.length || bad.length) throw new Error(`--only takes ${IMPLEMENTED.join(',')}; got ${bad.join(',') || '(nothing)'}`);
  return IMPLEMENTED.filter(id => ids.includes(id));
};
export function classifyMg2({ processes }) {
  const found = Object.entries(processes).map(([where, names]) => [where, sensitiveNames(names)]).filter(([, n]) => n.length);
  return found.length
    ? { result: 'exposed', reason: `sensitive variable names visible in ${found.map(([w, n]) => `${w}: ${n.join(',')}`).join('; ')}` }
    : { result: 'contained', reason: 'no sensitive variable name visible in any readable environment' };
}
export function classifyMg4({ targets }) {
  const reachable = Object.entries(targets).filter(([, v]) => v === 'reachable').map(([k]) => k);
  return reachable.length ? { result: 'exposed', reason: `script reached ${reachable.join(', ')}` } : { result: 'contained', reason: 'no target reachable' };
}
export function classifyMg5({ otherWorkers, bPidVisible, markerSeen }) {
  const why = [bPidVisible && "B's worker pid is visible in /proc", markerSeen && "B's /tmp marker is visible", otherWorkers > 0 && `${otherWorkers} other worker process(es) visible`].filter(Boolean);
  return why.length ? { result: 'exposed', reason: why.join('; ') } : { result: 'contained', reason: 'A sees no trace of B' };
}
export function classifyReclaim({ bOk, reclaimed, survived = true, stopped = true, what }) {
  const why = [!stopped && 'the script ran to its allocation cap, so no memory limit stopped it', !survived && 'executor did not survive', !bOk && "B's concurrent execute failed", !reclaimed && "A's worker was not reclaimed within 30 s of the deadline"].filter(Boolean);
  return why.length ? { result: 'exposed', reason: `${what}: ${why.join('; ')}` } : { result: 'contained', reason: `${what}: B served, A reclaimed` };
}
export const classifyMg8 = ({ bOk }) => bOk
  ? { result: 'contained', reason: 'B was served while A held every slot' }
  : { result: 'exposed', reason: 'B was not served while A held every slot' };

const STANDARD_MOUNT = /^\/(proc(\/.*)?|dev(\/.*)?|sys(\/.*)?|etc\/(hosts|hostname|resolv\.conf))?$/;
const SUSPECT_MOUNT = /staging|data|verify-uvw|workspace|sqlite|blob/i;
export function parseMountinfo(text) {
  return text.split('\n').filter(Boolean).map(line => {
    const f = line.split(' ');
    return { root: f[3], mountpoint: f[4], type: f[f.indexOf('-') + 1] };
  });
}
export const extraMounts = text => parseMountinfo(text).filter(m => !STANDARD_MOUNT.test(m.mountpoint));
export const suspectMounts = text => extraMounts(text).filter(m => SUSPECT_MOUNT.test(m.mountpoint) || SUSPECT_MOUNT.test(m.root));
export function classifyMg9({ places }) {
  const hits = Object.entries(places).filter(([, text]) => text === null || suspectMounts(text).length);
  if (hits.some(([, text]) => text === null)) return { result: 'inconclusive', reason: 'mountinfo not readable in every place' };
  return hits.length
    ? { result: 'exposed', reason: `product data or staging mounted in ${hits.map(([w, t]) => `${w} (${suspectMounts(t).map(m => m.mountpoint).join(',')})`).join('; ')}` }
    : { result: 'contained', reason: 'no Workspace data or staging directory mounted' };
}
export function classifyMg10({ executor, renderer }) {
  const healthy = Object.entries({ executor, renderer }).filter(([, v]) => v.outcome === 'healthy').map(([k]) => k);
  return healthy.length
    ? { result: 'exposed', reason: `${healthy.join(' and ')} became healthy with production settings and today's insecure configuration` }
    : { result: 'contained', reason: 'both roles refused to become healthy' };
}
// roots: browser processes. Each process joins the tree of its nearest browser ancestor.
export function browserTrees(procs) {
  const byPid = new Map(procs.map(p => [p.pid, p]));
  const isBrowser = p => /(^|\/)(chromium|chrome|headless_shell)$/.test(p.cmd.split(' ')[0]) && !p.cmd.includes('--type=');
  const rootOf = p => { for (let q = p, n = 0; q && n < 50; q = byPid.get(q.ppid), n++) if (isBrowser(q)) return q.pid; return undefined; };
  const trees = {};
  for (const p of procs) {
    const root = rootOf(p);
    if (root !== undefined) (trees[root] ??= { ticks: 0, pids: [] }, trees[root].ticks += p.ticks, trees[root].pids.push(p.pid));
  }
  return trees;
}
export function servedBy(before, after) {
  const delta = Object.fromEntries(Object.entries(after).map(([root, t]) => [root, t.ticks - (before[root]?.ticks ?? 0)]));
  const best = Object.entries(delta).sort((a, b) => b[1] - a[1]);
  return best.length && best[0][1] > 0 ? { root: best[0][0], delta } : { root: undefined, delta };
}
export function classifyMg11({ a, b, browsers }) {
  if (a === undefined || b === undefined) return { result: 'inconclusive', reason: 'could not attribute a screenshot to a Chromium browser process' };
  return a === b
    ? { result: 'exposed', reason: `both users were served by Chromium browser pid ${a} (${browsers} browser process(es) in the renderer)` }
    : { result: 'contained', reason: `A used browser pid ${a}, B used ${b}` };
}


const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../../../..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = n => randomBytes(n).toString('hex');
const docker = (args, opts = {}) => execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 1 << 28, timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const code = body => `return (async()=>{${body}})()`;
const worker = ps => ps.split('\n').filter(l => l.includes('worker-child')).map(l => Number(l.trim().split(/\s+/)[0]));

function loadRun(runId) {
  const root = process.env.VERIFY_UVW_ROOT ?? '/tmp/verify-uvw';
  const dir = runId ? join(root, runId) : existsSync(join(root, 'current')) ? join(root, readFileSync(join(root, 'current'), 'utf8').trim()) : '';
  if (!dir || !existsSync(join(dir, 'run.env'))) throw new Error('no verify-uvw run; export VERIFY_UVW_RUN or pass --run');
  const env = Object.fromEntries(readFileSync(join(dir, 'run.env'), 'utf8').split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  if (env.MCP_ENABLED !== '1') throw new Error('MCP is not enabled for this run');
  const secret = name => readFileSync(join(dir, 'home', name), 'utf8').trim();
  if (!existsSync(join(dir, 'home/mcp-token')) || !existsSync(join(dir, 'user.env'))) throw new Error('run has no user; run: verify-uvw user');
  return { dir, env, secret, origin: `http://127.0.0.1:${env.WEB_PORT}`, mcpUrl: new URL(`http://127.0.0.1:${env.MCP_PORT}/mcp`),
    username: readFileSync(join(dir, 'user.env'), 'utf8').match(/USERNAME=(.*)/)[1].trim() };
}

async function api(ctx, path, init = {}) {
  const response = await fetch(ctx.origin + path, { ...init, headers: { 'content-type': 'application/json', origin: ctx.origin, ...init.headers } });
  return response;
}

// User B registers the way `verify-uvw user` does; credentials are kept in the run's home (mode 0600) so a rerun reuses them.
async function ensureUserB(ctx) {
  const username = `verify-${ctx.env.RUN_ID}-b`.slice(0, 40), pw = join(ctx.dir, 'home/mcp-security-b.pw'), tok = join(ctx.dir, 'home/mcp-security-b.token');
  if (existsSync(tok)) return { username, token: readFileSync(tok, 'utf8').trim() };
  if (!existsSync(pw)) {
    const password = rand(16);
    const r = await api(ctx, '/api/auth/password/register', { method: 'POST', body: JSON.stringify({ username, displayName: `Verify ${ctx.env.RUN_ID} B`, password }) });
    if (r.status !== 201) throw new Error(`register user B returned ${r.status}`);
    writeFileSync(pw, password, { mode: 0o600 });
  }
  const login = await api(ctx, '/api/auth/cli/password/login', { method: 'POST', body: JSON.stringify({ username, password: readFileSync(pw, 'utf8') }) });
  if (!login.ok) throw new Error(`login user B returned ${login.status}`);
  const session = login.headers.getSetCookie().map(c => /^workspace_session=([^;]+)/.exec(c)?.[1]).find(Boolean);
  const made = await api(ctx, '/api/auth/tokens', { method: 'POST', headers: { cookie: `workspace_session=${session}` }, body: JSON.stringify({ name: `verify-uvw-${ctx.env.RUN_ID}-b` }) });
  if (made.status !== 201) throw new Error(`PAT for user B returned ${made.status}`);
  const { token } = await made.json();
  writeFileSync(tok, token, { mode: 0o600 });
  return { username, token };
}

async function mcpCall(ctx, user, tool, args) {
  const started = performance.now();
  const { Client, StreamableHTTPClientTransport } = ctx.sdk;
  const client = new Client({ name: 'mcp-security-probes', version: '1.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
  const transport = new StreamableHTTPClientTransport(ctx.mcpUrl, {
    requestInit: { headers: { Authorization: `Bearer ${user.token}` } },
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(90_000)]) }),
  });
  try {
    await client.connect(transport);
    const r = await client.callTool({ name: tool, arguments: args });
    return { ms: Math.round(performance.now() - started), isError: r.isError === true, out: r.structuredContent, content: r.content };
  } catch (error) {
    return { ms: Math.round(performance.now() - started), isError: true, thrown: String(error.message).slice(0, 300) };
  } finally { await client.close().catch(() => {}); }
}

async function need(ctx, user, tool, args) {
  const r = await mcpCall(ctx, user, tool, args);
  if (r.isError) throw new Error(`${tool} failed for ${user.name}: ${JSON.stringify(r.out ?? r.thrown).slice(0, 200)}`);
  return r.out;
}

// One worktree per user holds that user's Units; created lazily, `count` Units at least.
async function units(ctx, user, count) {
  if (!user.worktree) {
    const repoName = `${user.username}/personal`;
    user.space = (await need(ctx, user, 'repo_view', { repo: repoName })).id;
    user.worktree = (await need(ctx, user, 'pr_create', { repo: repoName, title: 'mcp security probes', idempotency_key: `mgprobe-${ctx.suffix}-${user.name}-pr` })).id;
    user.units = [];
  }
  while (user.units.length < count) {
    const n = user.units.length + 1;
    const created = await need(ctx, user, 'unit_create', { worktree: user.worktree, space: user.space, type: 'sheet', name: `mg-${user.name}-${n}`, idempotency_key: `mgprobe-${ctx.suffix}-${user.name}-u${n}` });
    user.units.push(created.unit.unitId);
  }
  return user.units.slice(0, count);
}

const run = (ctx, user, unit, body) => mcpCall(ctx, user, 'execute', { worktree: user.worktree, unit, code: code(body) });
const value = r => r.out?.value;
const container = (ctx, service) => docker(['ps', '-q', '--filter', `label=com.docker.compose.project=${ctx.env.MCP_PROJECT}`, '--filter', `label=com.docker.compose.service=${service}`]).trim().split('\n')[0];
const ps = (ctx, service) => docker(['exec', container(ctx, service), 'ps', '-eo', 'pid,ppid,args']);
const executorState = ctx => docker(['inspect', '-f', '{{.State.StartedAt}}|{{.RestartCount}}|{{.State.OOMKilled}}|{{.State.Status}}', container(ctx, 'executor')]).trim();
const executorHealthy = ctx => { try { docker(['exec', container(ctx, 'executor'), 'node', '-e', "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]); return true; } catch { return false; } };

async function waitGone(ctx, pid, seconds = 30) {
  const started = Date.now();
  while (Date.now() - started < seconds * 1000) {
    if (!worker(ps(ctx, 'executor')).includes(pid)) return Math.round(Date.now() - started);
    await sleep(1000);
  }
  return null;
}


const PROBES = {
  async MG2(ctx) {
    const [u] = await units(ctx, ctx.A, 1);
    const r = await run(ctx, ctx.A, u, `
      const fs=process.getBuiltinModule('fs'), path=process.getBuiltinModule('path');
      const names=e=>e.split('\\0').map(x=>x.split('=')[0]).filter(Boolean);
      const procs={};
      for (const p of fs.readdirSync('/proc').filter(x=>/^\\d+$/.test(x))) {
        let cmd=''; try{cmd=fs.readFileSync('/proc/'+p+'/cmdline','utf8').split('\\0').filter(Boolean).slice(0,2).map(a=>path.basename(a).slice(0,40)).join(' ')}catch{}
        try{procs[p]={cmd,names:names(fs.readFileSync('/proc/'+p+'/environ','utf8'))}}catch(e){procs[p]={cmd,error:e.code}}
      }
      return {self:process.pid,ownEnv:Object.keys(process.env),procs};`);
    const v = value(r);
    if (!v) return { result: 'inconclusive', reason: `execute failed: ${JSON.stringify(r.out ?? r.thrown).slice(0, 200)}`, data: r };
    const processes = { 'own process.env': v.ownEnv, ...Object.fromEntries(Object.entries(v.procs).map(([pid, p]) => [`/proc/${pid}/environ (${p.cmd})`, p.names ?? []])) };
    return { ...classifyMg2({ processes }), data: { self: v.self, ownEnv: v.ownEnv, processes: Object.fromEntries(Object.entries(v.procs).map(([pid, p]) => [pid, { cmd: p.cmd, names: p.names, unreadable: p.error, sensitive: sensitiveNames(p.names ?? []) }])), sensitiveOverall: sensitiveNames(Object.values(processes).flat()) } };
  },

  async MG4(ctx) {
    const [u] = await units(ctx, ctx.A, 1);
    const r = await run(ctx, ctx.A, u, `
      const get=async u=>{try{const r=await fetch(u,{signal:AbortSignal.timeout(4000)});return {state:'reachable',status:r.status}}catch(e){return {state:'unreachable',reason:e.cause?.code||e.name}}};
      const targets={renderer:'http://renderer:3000/healthz',gateway:'http://gateway:3000/healthz',workspaceTransport:${JSON.stringify(`http://host.docker.internal:${ctx.env.SERVER_PORT}/api/session`)},metadata:'http://169.254.169.254/',publicHost:'https://example.com/'};
      const out={};
      await Promise.all(Object.entries(targets).map(async([k,u])=>{out[k]={url:u,...await get(u)}}));
      try{out.publicDns=(await process.getBuiltinModule('dns').promises.lookup('example.com')).address}catch(e){out.publicDns='lookup failed '+e.code}
      return out;`);
    const v = value(r);
    if (!v) return { result: 'inconclusive', reason: `execute failed: ${JSON.stringify(r.out ?? r.thrown).slice(0, 200)}`, data: r };
    const { publicDns, ...probes } = v;
    const fakeIp = /^198\.1[89]\./.test(publicDns);
    return { ...classifyMg4({ targets: Object.fromEntries(Object.entries(probes).map(([k, p]) => [k, p.state])) }), data: { probes, publicDns, publicDnsIsFakeIp: fakeIp, note: 'a 198.18.0.0/15 answer is this Mac\'s fake-IP DNS; reachability is still measured by an HTTP response' } };
  },

  async MG5(ctx) {
    const [ua] = await units(ctx, ctx.A, 1), [ub] = await units(ctx, ctx.B, 1);
    const marker = `mg5-${rand(4)}`;
    const b = await run(ctx, ctx.B, ub, `
      const fs=process.getBuiltinModule('fs'); let wrote=true; try{fs.writeFileSync('/tmp/${marker}','b')}catch(e){wrote=e.code}
      return {pid:process.pid,cwd:process.cwd(),wrote};`);
    const bv = value(b);
    if (!bv) return { result: 'inconclusive', reason: `B's execute failed: ${JSON.stringify(b.out ?? b.thrown).slice(0, 200)}`, data: b };
    const a = await run(ctx, ctx.A, ua, `
      const fs=process.getBuiltinModule('fs'), path=process.getBuiltinModule('path');
      const others=[];
      for (const p of fs.readdirSync('/proc').filter(x=>/^\\d+$/.test(x)&&+x!==process.pid)) {
        let cmd='',cwd='';
        try{cmd=fs.readFileSync('/proc/'+p+'/cmdline','utf8').split('\\0').filter(Boolean).slice(0,2).map(x=>path.basename(x).slice(0,40)).join(' ')}catch{}
        try{cwd=fs.readlinkSync('/proc/'+p+'/cwd')}catch(e){cwd='unreadable '+e.code}
        others.push({pid:+p,cmd,cwd});
      }
      const tmp=fs.readdirSync('/tmp');
      return {self:process.pid,others,tmp,cwd:process.cwd(),cwdNames:fs.readdirSync(process.cwd()).slice(0,60)};`);
    const av = value(a);
    if (!av) return { result: 'inconclusive', reason: `A's execute failed: ${JSON.stringify(a.out ?? a.thrown).slice(0, 200)}`, data: a };
    const otherWorkers = av.others.filter(o => o.cmd.includes('worker-child')).length;
    return { ...classifyMg5({ otherWorkers, bPidVisible: av.others.some(o => o.pid === bv.pid), markerSeen: av.tmp.includes(marker) }),
      data: { b: bv, markerName: marker, a: { self: av.self, otherProcessCount: av.others.length, otherNodeProcesses: av.others.filter(o => /node/.test(o.cmd)), tmp: av.tmp, cwd: av.cwd, cwdNames: av.cwdNames } } };
  },

  async MG6(ctx) {
    const [ua] = await units(ctx, ctx.A, 1), [ub] = await units(ctx, ctx.B, 1);
    const pidA = value(await run(ctx, ctx.A, ua, 'return process.pid'));
    await run(ctx, ctx.B, ub, 'return 1');
    const aCall = run(ctx, ctx.A, ua, 'for(;;){}');
    await sleep(2000);
    const b = await run(ctx, ctx.B, ub, 'return 1');
    const a = await aCall;
    const reclaimedMs = await waitGone(ctx, pidA);
    const next = value(await run(ctx, ctx.A, ua, 'return process.pid'));
    return { ...classifyReclaim({ bOk: !b.isError, reclaimed: reclaimedMs !== null, what: 'runaway CPU' }),
      data: { a: { ms: a.ms, isError: a.isError, code: a.out?.code ?? a.thrown, workerPid: pidA }, b: { ms: b.ms, isError: b.isError, code: b.out?.code }, workerGoneAfterMs: reclaimedMs, nextCallPid: next, nextCallFreshWorker: next !== undefined && next !== pidA } };
  },

  async MG7(ctx) {
    const [ua] = await units(ctx, ctx.A, 1), [ub] = await units(ctx, ctx.B, 1);
    const pidA = value(await run(ctx, ctx.A, ua, 'return process.pid'));
    await run(ctx, ctx.B, ub, 'return 1');
    const before = executorState(ctx);
    // ponytail: capped at 2 GiB of heap so a missing limit cannot take down the shared Docker VM; reaching the cap counts as "no limit enforced".
    const aCall = run(ctx, ctx.A, ua, 'const keep=[]; for(let i=0;i<32;i++){keep.push(new Array(8e6).fill(i+0.5))} return {capReachedMiB:keep.length*64}');
    await sleep(2000);
    const b = await run(ctx, ctx.B, ub, 'return 1');
    const a = await aCall;
    const reclaimedMs = await waitGone(ctx, pidA);
    const after = executorState(ctx), survived = executorHealthy(ctx) && before.split('|')[0] === after.split('|')[0];
    return { ...classifyReclaim({ bOk: !b.isError, reclaimed: reclaimedMs !== null, survived, stopped: a.isError, what: 'memory exhaustion' }),
      data: { a: { ms: a.ms, isError: a.isError, code: a.out?.code ?? a.thrown, value: value(a), workerPid: pidA }, b: { ms: b.ms, isError: b.isError }, workerGoneAfterMs: reclaimedMs, executorBefore: before, executorAfter: after, executorHealthy: survived } };
  },

  async MG8(ctx) {
    const slots = Number(docker(['inspect', '-f', '{{range .Config.Env}}{{println .}}{{end}}', container(ctx, 'executor')]).match(/^EXECUTOR_MAX_WORKERS=(\d+)/m)?.[1] ?? 4);
    const aUnits = await units(ctx, ctx.A, slots), bUnits = await units(ctx, ctx.B, 2);
    const holds = aUnits.map(u => run(ctx, ctx.A, u, 'await new Promise(r=>setTimeout(r,12000)); return process.pid'));
    await sleep(3000);
    const workersHeld = worker(ps(ctx, 'executor')).length;
    // B's second Unit was never opened, so serving it needs a worker slot.
    const b = await run(ctx, ctx.B, bUnits[1], 'return 1');
    const held = await Promise.all(holds);
    return { ...classifyMg8({ bOk: !b.isError }),
      data: { slots, workersObservedWhileHeld: workersHeld, a: held.map(h => ({ ms: h.ms, isError: h.isError, code: h.out?.code })), b: { ms: b.ms, isError: b.isError, code: b.out?.code ?? b.thrown } } };
  },

  async MG9(ctx) {
    const read = (service) => { try { return docker(['exec', container(ctx, service), 'cat', '/proc/self/mountinfo']); } catch { return null; } };
    const [u] = await units(ctx, ctx.A, 1);
    const r = await run(ctx, ctx.A, u, "return process.getBuiltinModule('fs').readFileSync('/proc/self/mountinfo','utf8')");
    const places = { executor: read('executor'), renderer: read('renderer'), 'user script': value(r) ?? null };
    const gateway = read('gateway');
    return { ...classifyMg9({ places }),
      data: { places: Object.fromEntries(Object.entries(places).map(([k, t]) => [k, t === null ? null : { extra: extraMounts(t), suspect: suspectMounts(t) }])),
        control: { note: 'the gateway legitimately mounts /staging; the detector must see it', gatewaySuspect: gateway === null ? null : suspectMounts(gateway) } } };
  },

  async MG10(ctx) {
    const suffix = rand(4), net = `mg10-net-${suffix}`, image = ctx.env.MCP_IMAGE, names = [];
    const base = role => ['run', '-d', '--runtime=runc', '--name', `mg10-${role}-${suffix}`, '--network', net, '-e', `MCP_ROLE=${role}`, '-e', 'NODE_ENV=production',
      '-e', `MCP_INTERNAL_TOKEN=${rand(24)}`, '-e', 'HOST=0.0.0.0', '-e', 'PORT=3000'];
    const start = async (role, extra) => {
      const name = `mg10-${role}-${suffix}`;
      names.push(name);
      docker([...base(role), ...extra, image]);
      for (let i = 0; i < 30; i++) {
        await sleep(1000);
        const [status, exit] = docker(['inspect', '-f', '{{.State.Status}}|{{.State.ExitCode}}', name]).trim().split('|');
        if (status !== 'running') {
          const logs = spawnSync('docker', ['logs', '--tail', '3', name], { encoding: 'utf8' });
          const log = `${logs.stdout}${logs.stderr}`.split('\n').filter(Boolean).pop() ?? '';
          return { outcome: 'refused', exitCode: Number(exit), seconds: i + 1, lastLogLine: log.slice(0, 300) };
        }
        try { docker(['exec', name, 'node', '-e', "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]); return { outcome: 'healthy', seconds: i + 1 }; } catch { /* not yet */ }
      }
      return { outcome: 'never healthy within 30 s' };
    };
    try {
      docker(['network', 'create', '--internal', net]);
      const executor = await start('executor', ['-e', 'MCP_EXECUTOR_CREDENTIALS=session', '-e', 'WORKSPACE_ORIGIN=http://workspace.invalid']);
      const renderer = await start('renderer', []);
      return { ...classifyMg10({ executor, renderer }), data: { settings: 'NODE_ENV=production, MCP_EXECUTOR_CREDENTIALS=session, runc, image default Chromium launch, no published ports, internal network', executor, renderer } };
    } finally {
      for (const name of names) try { docker(['rm', '-f', name]); } catch { /* already gone */ }
      try { docker(['network', 'rm', net]); } catch { /* already gone */ }
    }
  },

  async MG11(ctx) {
    const [ua] = await units(ctx, ctx.A, 1), [ub] = await units(ctx, ctx.B, 1);
    const sample = () => JSON.parse(docker(['exec', container(ctx, 'renderer'), 'node', '-e', `
      const fs=require('fs'),out=[];
      for(const p of fs.readdirSync('/proc').filter(x=>/^\\d+$/.test(x))){try{
        const s=fs.readFileSync('/proc/'+p+'/stat','utf8'),f=s.slice(s.lastIndexOf(')')+2).split(' ');
        const c=fs.readFileSync('/proc/'+p+'/cmdline','utf8').split('\\0');
        out.push({pid:+p,ppid:+f[1],ticks:+f[11]+ +f[12]+ +f[13]+ +f[14],cmd:[c[0],...c.filter(a=>a.startsWith('--type='))].join(' ').slice(0,80)});
      }catch{}}
      console.log(JSON.stringify(out));`]));
    const shot = async (user, unit) => {
      const before = browserTrees(sample());
      const r = await mcpCall(ctx, user, 'screenshot', { unit, worktree: user.worktree, range: 'A1:D4' });
      const after = browserTrees(sample());
      return { r, before, after, ...servedBy(before, after) };
    };
    const a = await shot(ctx.A, ua), b = await shot(ctx.B, ub);
    const browsers = Object.keys(b.after).length;
    return { ...classifyMg11({ a: a.root, b: b.root, browsers }),
      data: { browserProcesses: Object.fromEntries(Object.entries(b.after).map(([k, t]) => [k, t.pids.length])),
        a: { ok: !a.r.isError, ms: a.r.ms, error: a.r.isError ? a.r.out?.code ?? a.r.thrown : undefined, servedByBrowserPid: a.root, cpuTickDelta: a.delta },
        b: { ok: !b.r.isError, ms: b.r.ms, error: b.r.isError ? b.r.out?.code ?? b.r.thrown : undefined, servedByBrowserPid: b.root, cpuTickDelta: b.delta },
        method: 'CPU ticks (own plus reaped children) summed per Chromium browser process tree, before and after each call' } };
  },
};


async function main() {
  const argv = process.argv.slice(2);
  let runId = process.env.VERIFY_UVW_RUN, only;
  while (argv.length) {
    const flag = argv.shift(), v = argv.shift();
    if (flag === '--run') runId = v; else if (flag === '--only') only = v; else throw new Error(`Unknown option ${flag}`);
  }
  const ids = parseOnly(only);
  const ctx = { ...loadRun(runId), suffix: rand(3) };
  docker(['version', '--format', '{{.Server.Version}}']);
  ctx.sdk = createRequire(join(repo, 'apps/mcp/package.json'))('@modelcontextprotocol/client');
  const evidenceDir = join(ctx.dir, 'evidence/mcp-security');
  mkdirSync(evidenceDir, { recursive: true });
  ctx.A = { name: 'a', username: ctx.username, token: ctx.secret('mcp-token') };
  const needsB = ids.some(id => id !== 'MG2' && id !== 'MG4' && id !== 'MG9' && id !== 'MG10');
  if (needsB) ctx.B = { name: 'b', ...await ensureUserB(ctx) };
  for (const id of ids) {
    let outcome;
    try { outcome = await PROBES[id](ctx); }
    catch (error) { outcome = { result: 'inconclusive', reason: `probe error: ${String(error.message).slice(0, 300)}`, data: null }; }
    const evidence = `evidence/mcp-security/${id}.json`;
    writeFileSync(join(ctx.dir, evidence), `${JSON.stringify({ probe: id, requirements: REQUIREMENTS[id], result: outcome.result, reason: outcome.reason, measuredAt: new Date().toISOString(), runId: ctx.env.RUN_ID, data: outcome.data }, null, 2)}\n`);
    console.log(JSON.stringify({ probe: id, requirements: REQUIREMENTS[id], result: outcome.result, evidence }));
    console.error(`${id} ${outcome.result}: ${outcome.reason}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`mcp-security-probes: ${error.message}`); process.exit(2); });
}
