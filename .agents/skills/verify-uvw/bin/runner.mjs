#!/usr/bin/env node
// Runs verify-uvw journeys in disposable Linux containers, each task driven by Claude Code on deepseek-flash, or with
// --no-model only the journeys the helper runs.
// Usage: verify-uvw runner [--no-model] [--jobs N] [--keep] <feature[:ID|mode,...]>... | verify-uvw runner --check [feature[:ID|mode,...]...]
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NEEDS, fold, loadFeatures, plan, readRuns } from './journeys.mjs';

const skill = fileURLToPath(new URL('..', import.meta.url));
const repo = join(skill, '../../..');
const MAX_JOBS = 3;
const FAILED = new Set(['timeout', 'infra-error', 'secret-leak']);
const VERDICTS = ['PASS', 'FAIL', 'DRIFT', 'BLOCKED', 'MISSING'];
const OUTCOMES = ['held', 'broke', 'blocked', 'none'];
const USAGE = 'usage: verify-uvw runner [--no-model] [--jobs 1|2|3] [--keep] <feature[:ID|mode,...]>... | verify-uvw runner --check [feature[:ID|mode,...]...]';

export function parseArgs(argv) {
  let jobs, keep = false, check = false, model = true;
  const specs = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--keep') keep = true;
    else if (argv[i] === '--no-model') model = false;
    else if (argv[i] === '--check') check = true;
    else if (argv[i] === '--jobs') jobs = Number(argv[++i]);
    else if (argv[i].startsWith('-')) throw new Error(`unknown option ${argv[i]}\n${USAGE}`);
    else specs.push(argv[i]);
  }
  if (check && (keep || jobs !== undefined || !model)) throw new Error(`--check takes only tasks\n${USAGE}`);
  if (!specs.length && !check) throw new Error(USAGE);
  const parsed = specs.map((spec) => {
    const [, feature, selectors] = /^([a-z0-9][a-z0-9-]*)(?::([A-Za-z0-9-]+(?:,[A-Za-z0-9-]+)*))?$/.exec(spec)
      ?? (() => { throw new Error(`bad task ${spec}; write feature, feature:ID,ID or feature:mode\n${USAGE}`); })();
    return { feature, selectors: selectors ? selectors.split(',') : [] };
  });
  if (check) return { check, specs: parsed };
  jobs ??= MAX_JOBS;
  if (!Number.isInteger(jobs) || jobs < 1 || jobs > MAX_JOBS) throw new Error(`--jobs takes 1 to ${MAX_JOBS}\n${USAGE}`);
  return { jobs, keep, model, specs: parsed };
}

// One task per mode partition of each spec, with an id that is a valid run id: the feature, `<feature>-<mode>` when
// a spec splits, and a number for a repeat. A spec with no partition is host only, and `host` lists every journey
// the host runs, one entry per instance it needs.
export function expand(specs, features) {
  const tasks = [], hostOnly = [], host = [], used = new Set();
  const unique = (base) => { let id = base; for (let n = 2; used.has(id); n++) id = `${base}-${n}`; used.add(id); return id; };
  for (const { feature: name, selectors } of specs) {
    const feature = features.get(name);
    if (!feature) throw new Error(`no features/${name}.md`);
    const { partitions, host: only } = plan(feature, selectors, { where: 'runner' });
    for (const p of partitions) {
      tasks.push({ id: unique(partitions.length > 1 && p.mode !== 'default' ? `${name}-${p.mode}` : name), feature: name, mode: p.mode, needs: p.needs, selectors: p.selectors, expected: p.journeys });
    }
    if (!partitions.length) hostOnly.push({ id: unique(name), feature: name });
    if (only.length) {
      const again = plan(feature, only.length === feature.journeys.length ? selectors : only.map((j) => j.id));
      host.push(...again.partitions.map((p) => ({ feature: name, selectors: p.selectors })));
    }
  }
  return { tasks, hostOnly, host };
}

export function findKey(env, dotenv) {
  if (env.DEEPSEEK_API_KEY) return { key: env.DEEPSEEK_API_KEY, source: 'environment' };
  const values = [...(dotenv ?? '').matchAll(/^[ \t]*(?:export[ \t]+)?DEEPSEEK_API_KEY[ \t]*=[ \t]*(.*?)[ \t]*\r?$/gm)]
    .map(([, value]) => value.replace(/^(["'])(.*)\1$/, '$2'));
  return values.at(-1) ? { key: values.at(-1), source: '.env' } : null;
}

const keyName = ({ key, source }) => `DEEPSEEK_API_KEY from ${source} (sha256 ${createHash('sha256').update(key).digest('hex').slice(0, 8)})`;

// One 1-token request to the endpoint and model the image gives Claude Code, so a refused key stops a batch before
// it starts. Returns why the key does not work, or null when it does.
async function refusal({ key }) {
  const dockerfile = readFileSync(join(skill, 'runner/Dockerfile'), 'utf8');
  const url = /ANTHROPIC_BASE_URL=(\S+)/.exec(dockerfile)[1], model = /ANTHROPIC_MODEL='?([^'\s[]+)/.exec(dockerfile)[1];
  try {
    const response = await fetch(`${url}/v1/messages`, {
      method: 'POST', signal: AbortSignal.timeout(15_000),
      headers: { authorization: `Bearer ${key}`, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
    });
    const body = await response.text();
    if (response.ok) return null;
    let message = body.slice(0, 300);
    try { message = JSON.parse(body).error?.message ?? message; } catch {}
    return `${model} at ${url} answered HTTP ${response.status}: ${message.replaceAll(key, '<key>')}`;
  } catch (error) {
    return `${model} at ${url} did not answer: ${error.cause?.message ?? error.message}`;
  }
}

// With no model nobody judges, so the result is the checks: 1 when one broke, did not run or was blocked.
export function exitCode(results, { model = true } = {}) {
  if (results.some((r) => FAILED.has(r.status) || (model && r.result === 'INCOMPLETE'))) return 4;
  if (!model && results.some((r) => r.checks === 'BROKE')) return 1;
  return results.some((r) => r.status === 'host-only') ? 3 : 0;
}

// The report is the final result record, with its run paths moved to the batch. The verdicts come from the journals.
// A final record that is Claude Code's own `API Error: …` (a refused key, an empty balance) is an error, not a report.
export function readTranscript(text, runsDir) {
  const record = text.split('\n').filter((line) => line.includes('"type":"result"'))
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .findLast((r) => r?.type === 'result');
  if (!record) return null;
  const report = String(record.result ?? '').replace(/\/tmp\/verify-uvw(?:-[a-z0-9]+)?\//g, `${runsDir}/`);
  const u = record.usage;
  return {
    report,
    error: record.is_error && /^API Error/.test(record.result) ? record.result : null,
    turns: record.num_turns ?? null,
    usage: u ? { input: u.input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, output: u.output_tokens ?? 0 } : null,
  };
}

const fail = (code, message) => { console.error(`verify-uvw runner: ${message}`); process.exit(code); };
const capture = (cmd, args, options = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...options });
const git = (args, env) => {
  const r = capture('git', ['-C', repo, ...args], { env });
  if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr.trim()}`);
  return r.stdout.trim();
};
const run = (args, { log, env } = {}) => new Promise((resolve) => {
  const fd = log ? openSync(log, 'a') : 'ignore';
  const child = spawn('docker', args, { stdio: ['ignore', fd, fd], env });
  const done = (code) => { if (log) closeSync(fd); resolve(code); };
  child.on('error', () => done(-1));
  child.on('close', (code) => done(code ?? -1));
});
const seconds = (since) => Math.round((Date.now() - since) / 1000);

// A commit of the working tree (untracked files in, ignored files out) with HEAD as parent and no ref.
function snapshot(batch) {
  const tmp = mkdtempSync(join(tmpdir(), 'verify-runner-'));
  const who = { GIT_AUTHOR_NAME: 'verify-runner', GIT_AUTHOR_EMAIL: 'verify-runner@localhost' };
  const env = { ...process.env, ...who, GIT_COMMITTER_NAME: who.GIT_AUTHOR_NAME, GIT_COMMITTER_EMAIL: who.GIT_AUTHOR_EMAIL, GIT_INDEX_FILE: join(tmp, 'index') };
  try {
    git(['read-tree', 'HEAD'], env);
    git(['add', '-A'], env);
    return git(['commit-tree', git(['write-tree'], env), '-p', 'HEAD', '-m', `verify-runner snapshot ${batch}`], env);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function holds(dir, needle) {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .some((entry) => entry.isFile() && readFileSync(join(entry.parentPath, entry.name)).includes(needle));
}

// A function that runs the async functions it is given one at a time, in call order, whether or not each one fails.
export function serial() {
  let tail = Promise.resolve();
  return (fn) => {
    const turn = tail.then(fn);
    tail = turn.catch(() => {});
    return turn;
  };
}

export function finish(task, dir, wallSeconds, key, { model = true } = {}) {
  const out = join(dir, task.id);
  const read = (name) => (existsSync(join(out, name)) ? readFileSync(join(out, name), 'utf8') : null);
  const claudeExit = read('claude.exit')?.trim();
  const prepare = read('prepare.failed') === null ? null : (read('prepare.log') ?? '').split('\n').filter((line) => /^(FAIL|verify-uvw:) /.test(line));
  const transcript = readTranscript(read('transcript.jsonl') ?? '', join(out, 'runs'));
  if (transcript) writeFileSync(join(out, 'report.md'), transcript.report.endsWith('\n') ? transcript.report : `${transcript.report}\n`);
  const secretCheckFail = readdirSync(out).filter((name) => name.startsWith('secret-check-') && /^FAIL/m.test(read(name)));
  const status = key && holds(out, key) ? 'secret-leak'
    : claudeExit === '124' ? 'timeout'
      : prepare || (model && (claudeExit === undefined || transcript?.error)) ? 'infra-error'
        : 'finished';
  const { journeys, result: verdict, checks } = fold(task.expected, readRuns(join(out, 'runs')));
  const result = { task: task.id, mode: task.mode, status, result: model ? verdict : null, checks, journeys, turns: transcript?.turns ?? null, wallSeconds, usage: transcript?.usage ?? null, error: transcript?.error ?? null, prepare, secretCheckFail };
  writeFileSync(join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

export function summary({ batch, sha, head, image, key, jobs, dir, results, host, setup, wallSeconds, model = true }) {
  const n = (v) => (v == null ? '' : String(v));
  const tally = (r, outcome) => (r.journeys ? r.journeys.filter((j) => j.checks === outcome).length : '');
  const checked = (r) => OUTCOMES.filter((o) => tally(r, o)).map((o) => `${tally(r, o)} ${o === 'none' ? 'not run' : o}`).join(', ');
  const broken = results.flatMap((r) => (r.journeys ?? []).filter((j) => j.checks && j.checks !== 'held')
    .map((j) => `- ${r.task} ${j.id} ${j.checks === 'none' ? 'did not run' : j.checks}${j.failure ? `: ${j.failure.replace(/\s+/g, ' ')}` : ''}`));
  const errors = results.filter((r) => r.error).map((r) => `- ${r.task}: ${r.error}`);
  const unprepared = results.filter((r) => r.prepare).flatMap((r) => [`- ${r.task}, from ${dir}/${r.task}/prepare.log:`,
    ...(r.prepare.length ? r.prepare : ['(no FAIL line; read the log)']).map((line) => `  ${line}`)]);
  const flagged = results.flatMap((r) => (r.secretCheckFail ?? []).map((name) => `- ${dir}/${r.task}/${name}`));
  const count = (r, verdict) => (r.journeys ? r.journeys.filter((j) => j.verdict === verdict).length : '');
  const open = results.flatMap((r) => (r.journeys ?? []).filter((j) => j.verdict !== 'PASS')
    .map((j) => `- ${r.task} ${j.id} ${j.verdict}${j.note ? `: ${j.note.replace(/\s+/g, ' ')}` : ''}${j.failure ? ` (checks ${j.checks}: ${j.failure.replace(/\s+/g, ' ')})` : ''}`));
  const table = model ? [
    `| Task | Mode | Status | Result | Journeys | ${VERDICTS.join(' | ')} | Checks | Turns | Wall | Input tokens | Cache read tokens | Output tokens |`,
    `|${' --- |'.repeat(VERDICTS.length + 11)}`,
    ...results.map((r) => `| ${r.task} | ${n(r.mode)} | ${r.status} | ${n(r.result)} | ${n(r.journeys?.length)} | ${VERDICTS.map((v) => count(r, v)).join(' | ')} | ${checked(r)} | ${n(r.turns)} | ${r.wallSeconds} s | ${n(r.usage?.input)} | ${n(r.usage?.cacheRead)} | ${n(r.usage?.output)} |`),
    '',
    ...(open.length ? ['Journeys that are not PASS:', '', ...open, ''] : []),
  ] : [
    '| Task | Mode | Status | Checks | Held | Broke | Blocked | Not run | By the agent | Wall |',
    `|${' --- |'.repeat(10)}`,
    ...results.map((r) => `| ${r.task} | ${n(r.mode)} | ${r.status} | ${n(r.checks)} | ${OUTCOMES.map((o) => tally(r, o)).join(' | ')} | ${r.journeys ? r.journeys.filter((j) => !j.checks).length : ''} | ${r.wallSeconds} s |`),
    '',
    ...(broken.length ? ['Checks that did not hold:', '', ...broken, ''] : []),
    'No model ran: nobody read the pass conditions, so held checks are not a PASS, and journeys the agent drives did not run.',
    '',
  ];
  return [
    `# verify runner batch ${batch}`,
    '',
    `Snapshot ${sha} of HEAD ${head}, image ${image}, ${key}, ${jobs} runner(s), ${wallSeconds} s in total.`,
    `Runner setup: ${setup.map((s, k) => `r${k + 1} ${s == null ? 'failed' : `${s} s`}`).join(', ')}.`,
    '',
    ...table,
    `Each task's ${model ? 'report is' : 'helper output is'} ${dir}/<task>/${model ? 'report.md' : 'run-journeys.log'}, and its runs are under ${dir}/<task>/runs/.`,
    ...(unprepared.length ? ['', 'These tasks could not start their instance, so no verifier ran:', '', ...unprepared] : []),
    ...(errors.length ? ['', 'These tasks stopped on an API error:', '', ...errors] : []),
    // A transcript also holds recipe code with credential shapes, so these lines need a person, not a status.
    ...(flagged.length ? ['', 'secret-check printed FAIL lines. Read them before you share these files:', '', ...flagged] : []),
    ...(host.length ? ['', 'Run these on the host, one instance each, as SKILL.md "Hand the driving to another agent" says:', '',
      ...host.map((h) => [h.feature, ...h.selectors].join(' ')).map((spec) => `- \`$V up --for ${spec}\`, then \`$V brief ${spec}\``)] : []),
    '',
  ].join('\n');
}

const readKey = () => findKey(process.env, existsSync(join(repo, '.env')) ? readFileSync(join(repo, '.env'), 'utf8') : '');
const imageTag = () => `uvw-verify-runner:${createHash('sha256').update(readFileSync(join(skill, 'runner/Dockerfile'))).digest('hex').slice(0, 12)}`;

function expanded(specs) {
  try { return expand(specs, loadFeatures()); } catch (error) { return fail(2, error.message); }
}

// What a batch needs, checked without starting anything. SKILL.md chooses between runner and host mode from it.
async function check(specs) {
  const found = readKey();
  const docker = capture('docker', ['info', '--format', '{{.NCPU}}']);
  const { tasks: queue, host } = expanded(specs);
  const refused = found && await refusal(found);
  if (!found) console.log('FAIL  DEEPSEEK_API_KEY not found; set it or add a DEEPSEEK_API_KEY= line to .env');
  else console.log(refused ? `FAIL  ${keyName(found)}: ${refused}` : `ok    ${keyName(found)} works`);
  if (docker.status !== 0) console.log('FAIL  docker is not available');
  else console.log(`ok    docker answers with ${docker.stdout.trim()} CPUs`);
  for (const h of host) console.log(`host  ${h.feature}${h.selectors.length ? `:${h.selectors.join(',')}` : ''} is marked (host only); run it in host mode`);
  const runnable = !specs.length || queue.length;
  if (docker.status === 0 && runnable) {
    const image = imageTag();
    console.log(capture('docker', ['image', 'inspect', image]).status === 0 ? `ok    image ${image} is built`
      : `todo  image ${image} is not built; the next batch builds it, about 2 minutes and 4 GB`);
  }
  process.exitCode = !found || refused ? 5 : docker.status !== 0 || !runnable ? 3 : 0;
}

async function main() {
  let options;
  try { options = parseArgs(process.argv.slice(2)); } catch (error) { fail(2, error.message); }
  if (options.check) return check(options.specs);
  const { keep, model } = options;
  const { tasks, hostOnly, host } = expanded(options.specs);
  const queue = [...tasks];

  const found = model ? readKey() : { key: null };
  if (!found) fail(5, 'DEEPSEEK_API_KEY not found; set it or add it to .env');
  const refused = model && await refusal(found);
  if (refused) fail(5, `${keyName(found)}: ${refused}`);
  const { key } = found;
  const keyText = model ? keyName(found) : 'no model and no key';
  const info = capture('docker', ['info', '--format', '{{.NCPU}}']);
  if (info.status !== 0) fail(3, 'docker is not available; run the journeys in host mode (SKILL.md, "Choose runner or host")');

  if (!queue.length) {
    console.error(`verify-uvw runner: every task runs only on the host:\n${host.map((h) => `  $V up --for ${[h.feature, ...h.selectors].join(' ')}`).join('\n')}`);
    process.exit(3);
  }
  const jobs = Math.min(options.jobs, queue.length);

  const started = Date.now();
  const now = new Date(), two = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  const batch = `${stamp}-${randomBytes(2).toString('hex')}`;
  const dir = join(process.env.VERIFY_UVW_ROOT || '/tmp/verify-uvw', 'runner', batch);
  mkdirSync(dir, { recursive: true });
  const removeContainers = () => {
    const ids = capture('docker', ['ps', '-aq', '--filter', `label=uvw-verify.batch=${batch}`]).stdout.split('\n').filter(Boolean);
    if (ids.length) capture('docker', ['rm', '-f', ...ids]);
  };
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { removeContainers(); process.exit(signal === 'SIGINT' ? 130 : 143); });

  const image = imageTag();
  if (capture('docker', ['image', 'inspect', image]).status !== 0) {
    console.error(`building ${image} (about 95 s); log: ${dir}/image-build.log`);
    const log = openSync(join(dir, 'image-build.log'), 'a');
    if (spawnSync('docker', ['build', '-t', image, '-'], { input: readFileSync(join(skill, 'runner/Dockerfile')), stdio: ['pipe', log, log] }).status !== 0) fail(4, `image build failed; see ${dir}/image-build.log`);
  }
  const sha = snapshot(batch);
  const head = git(['rev-parse', 'HEAD']);
  const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir']);
  console.error(`batch ${batch}: ${queue.length} task(s) on ${jobs} runner(s), snapshot ${sha}, ${keyText}; output ${dir}`);

  // Keep two cores for the host: the runners must never take every CPU at once.
  const cpus = String(Math.max(1, Math.floor((Number(info.stdout) - 2) / jobs)));
  const env = model ? { ...process.env, ANTHROPIC_AUTH_TOKEN: key, DEEPSEEK_API_KEY: key } : process.env;
  const results = new Map(hostOnly.map((t) => [t.id, { task: t.id, status: 'host-only', result: null, turns: null, wallSeconds: 0, usage: null }]));
  const needs = [...new Set(queue.flatMap((t) => t.needs))];
  const setup = Array(jobs).fill(null);
  // Three instances preparing at once took 147 s each where one alone took 20 s, so tasks take turns to prepare;
  // the rest of each task still runs in parallel.
  const prepareOne = serial();
  const runner = async (k) => {
    const name = `uvw-verify-${batch}-r${k + 1}`, log = join(dir, `r${k + 1}-setup.log`), since = Date.now();
    const up = await run(['run', '-d', '--init', '--name', name, '--label', `uvw-verify.batch=${batch}`, '--shm-size=1g', '--cpus', cpus,
      '-v', `${common}:/hostgit:ro`, '-v', 'uvw-verify-runner-pnpm-store:/home/node/.local/share/pnpm', '-v', `${dir}:/batch`,
      image, 'sleep', 'infinity'], { log });
    const built = up === 0 && await run(['exec', name, 'bash', '-c', [
      'set -e', "git config --global --add safe.directory '*'",
      `git init -q ~/repo && cd ~/repo && git fetch -q --depth 1 file:///hostgit ${sha} && git checkout -q FETCH_HEAD`,
      // The store volume is another device than ~/repo, and pnpm keeps a store it is not given on the project's device, so the volume went unused.
      'pnpm install --frozen-lockfile --store-dir ~/.local/share/pnpm/store', "pnpm --filter 'univer-workspace-cli...' build",
      "pnpm --filter '@univerjs/univer-workspace-mcp...' build", ...needs.map((need) => NEEDS[need].setup)].join('\n')], { log }) === 0;
    if (!built) return console.error(`runner r${k + 1} setup failed; see ${log}`);
    setup[k] = seconds(since);
    for (let task; (task = queue.shift());) {
      let begun;
      mkdirSync(join(dir, task.id), { recursive: true });
      const phase = (step, keys) => run(['exec', ...(keys ? ['-e', 'ANTHROPIC_AUTH_TOKEN', '-e', 'DEEPSEEK_API_KEY'] : []), name, 'bash',
        '/home/node/repo/.agents/skills/verify-uvw/runner/task.sh', step, ...(model ? [] : ['--no-model']), task.id, task.feature, ...task.selectors],
      { log: join(dir, task.id, 'task.log'), env });
      const prepared = await prepareOne(() => {
        begun = Date.now();
        console.error(`r${k + 1}: ${task.id} started`);
        return phase('prepare', false);
      });
      if (prepared === 0) await phase('run', model);
      const result = finish(task, dir, seconds(begun), key, { model });
      results.set(task.id, result);
      console.error(`r${k + 1}: ${task.id} ${result.status} ${(model ? result.result : result.checks) ?? ''}`);
    }
  };
  await Promise.all(setup.map((_, k) => runner(k)));
  for (const t of queue) results.set(t.id, { task: t.id, mode: t.mode, status: 'infra-error', result: null, turns: null, wallSeconds: 0, usage: null });

  const ordered = [...tasks, ...hostOnly].map((t) => results.get(t.id));
  const text = summary({ batch, sha, head, image, key: keyText, jobs, dir, results: ordered, host, setup, wallSeconds: seconds(started), model });
  writeFileSync(join(dir, 'summary.md'), text);
  process.stdout.write(text);
  if (keep) console.error(`kept containers; remove them with: docker rm -f $(docker ps -aq --filter label=uvw-verify.batch=${batch})`);
  else removeContainers();
  process.exit(exitCode(ordered, { model }));
}

if (realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
