#!/usr/bin/env node
// Runs verify-uvw journeys in disposable Linux containers, each task driven by Claude Code on deepseek-flash.
// Usage: verify-uvw runner [--jobs N] [--keep] <feature[:ID,ID]>...
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const skill = fileURLToPath(new URL('..', import.meta.url));
const repo = join(skill, '../../..');
const MAX_JOBS = 3;
const FAILED = new Set(['no-report', 'timeout', 'infra-error', 'secret-leak']);
const USAGE = 'usage: verify-uvw runner [--jobs 1|2|3] [--keep] <feature[:ID,ID]>...';

export function parseArgs(argv) {
  let jobs, keep = false;
  const specs = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--keep') keep = true;
    else if (argv[i] === '--jobs') jobs = Number(argv[++i]);
    else if (argv[i].startsWith('-')) throw new Error(`unknown option ${argv[i]}\n${USAGE}`);
    else specs.push(argv[i]);
  }
  if (!specs.length) throw new Error(USAGE);
  const seen = new Map();
  const tasks = specs.map((spec) => {
    const [, feature, ids] = /^([a-z0-9][a-z0-9-]*)(?::([A-Za-z0-9-]+(?:,[A-Za-z0-9-]+)*))?$/.exec(spec)
      ?? (() => { throw new Error(`bad task ${spec}; write feature or feature:ID,ID\n${USAGE}`); })();
    const n = (seen.get(feature) ?? 0) + 1;
    seen.set(feature, n);
    return { id: n === 1 ? feature : `${feature}-${n}`, feature, journeys: ids ? ids.split(',') : [] };
  });
  jobs ??= Math.min(tasks.length, MAX_JOBS);
  if (!Number.isInteger(jobs) || jobs < 1 || jobs > MAX_JOBS) throw new Error(`--jobs takes 1 to ${MAX_JOBS}\n${USAGE}`);
  return { jobs, keep, tasks };
}

export function findKey(env, dotenv) {
  if (env.DEEPSEEK_API_KEY) return env.DEEPSEEK_API_KEY;
  const values = [...(dotenv ?? '').matchAll(/^[ \t]*(?:export[ \t]+)?DEEPSEEK_API_KEY[ \t]*=[ \t]*(.*?)[ \t]*\r?$/gm)]
    .map(([, value]) => value.replace(/^(["'])(.*)\1$/, '$2'));
  return values.at(-1) || null;
}

export function exitCode(results) {
  if (results.some((r) => FAILED.has(r.status))) return 4;
  return results.some((r) => r.status === 'host-only') ? 3 : 0;
}

// The verdict is the last `RESULT:` line of the final result record; the report's run paths become batch paths.
export function readTranscript(text, runsDir) {
  const record = text.split('\n').filter((line) => line.includes('"type":"result"'))
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .findLast((r) => r?.type === 'result');
  if (!record) return null;
  const report = String(record.result ?? '').replaceAll('/tmp/verify-uvw/', `${runsDir}/`);
  const u = record.usage;
  return {
    report,
    result: [...report.matchAll(/RESULT:\s*(PASS|ISSUES)\b/g)].at(-1)?.[1] ?? null,
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

function finish(task, dir, wallSeconds, key) {
  const out = join(dir, task.id);
  const read = (name) => (existsSync(join(out, name)) ? readFileSync(join(out, name), 'utf8') : null);
  const claudeExit = read('claude.exit')?.trim();
  const transcript = readTranscript(read('transcript.jsonl') ?? '', join(out, 'runs'));
  if (transcript) writeFileSync(join(out, 'report.md'), transcript.report.endsWith('\n') ? transcript.report : `${transcript.report}\n`);
  const secretCheckFail = readdirSync(out).filter((name) => name.startsWith('secret-check-') && /^FAIL/m.test(read(name)));
  const status = holds(out, key) ? 'secret-leak'
    : claudeExit === '124' ? 'timeout'
      : claudeExit === undefined ? 'infra-error'
        : transcript?.result ? 'reported' : 'no-report';
  const result = { task: task.id, status, result: transcript?.result ?? null, turns: transcript?.turns ?? null, wallSeconds, usage: transcript?.usage ?? null, secretCheckFail };
  writeFileSync(join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

function summary({ batch, sha, head, image, jobs, dir, results, hostOnly, setup, wallSeconds }) {
  const n = (v) => (v == null ? '' : String(v));
  const flagged = results.flatMap((r) => (r.secretCheckFail ?? []).map((name) => `- ${dir}/${r.task}/${name}`));
  const rows = results.map((r) => `| ${r.task} | ${r.status} | ${n(r.result)} | ${n(r.turns)} | ${r.wallSeconds} s | ${n(r.usage?.input)} | ${n(r.usage?.cacheRead)} | ${n(r.usage?.output)} |`);
  return [
    `# verify runner batch ${batch}`,
    '',
    `Snapshot ${sha} of HEAD ${head}, image ${image}, ${jobs} runner(s), ${wallSeconds} s in total.`,
    `Runner setup: ${setup.map((s, k) => `r${k + 1} ${s == null ? 'failed' : `${s} s`}`).join(', ')}.`,
    '',
    '| Task | Status | Result | Turns | Wall | Input tokens | Cache read tokens | Output tokens |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    `Each task's report is ${dir}/<task>/report.md, and its runs are under ${dir}/<task>/runs/.`,
    // A transcript also holds recipe code with credential shapes, so these lines need a person, not a status.
    ...(flagged.length ? ['', 'secret-check printed FAIL lines. Read them before you share these files:', '', ...flagged] : []),
    ...(hostOnly.length ? ['', 'Run these on the host, as SKILL.md "Hand the driving to another agent" says:', '',
      ...hostOnly.map((t) => `- \`$V brief ${[t.feature, ...t.journeys].join(' ')}\``)] : []),
    '',
  ].join('\n');
}

async function main() {
  let options;
  try { options = parseArgs(process.argv.slice(2)); } catch (error) { fail(2, error.message); }
  const { keep, tasks } = options;
  for (const t of tasks) if (!existsSync(join(skill, 'features', `${t.feature}.md`))) fail(2, `no features/${t.feature}.md`);

  const key = findKey(process.env, existsSync(join(repo, '.env')) ? readFileSync(join(repo, '.env'), 'utf8') : '');
  if (!key) fail(5, 'DEEPSEEK_API_KEY not found; set it or add it to .env');
  const info = capture('docker', ['info', '--format', '{{.NCPU}}']);
  if (info.status !== 0) fail(3, 'docker is not available; run the journeys on the host (SKILL.md, "Hand the driving to another agent")');

  const hostOnly = [], queue = [];
  for (const t of tasks) {
    const brief = capture('bash', [join(skill, 'bin/verify-uvw'), 'brief', '--own', t.id, t.feature, ...t.journeys]);
    if (brief.status === 3) hostOnly.push(t);
    else if (brief.status === 0) queue.push(t);
    else fail(2, brief.stderr.trim());
  }
  if (!queue.length) {
    console.error(`verify-uvw runner: every task runs only on the host:\n${hostOnly.map((t) => `  $V brief ${[t.feature, ...t.journeys].join(' ')}`).join('\n')}`);
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

  const dockerfile = readFileSync(join(skill, 'runner/Dockerfile'));
  const image = `uvw-verify-runner:${createHash('sha256').update(dockerfile).digest('hex').slice(0, 12)}`;
  if (capture('docker', ['image', 'inspect', image]).status !== 0) {
    console.error(`building ${image} (about 95 s); log: ${dir}/image-build.log`);
    const log = openSync(join(dir, 'image-build.log'), 'a');
    if (spawnSync('docker', ['build', '-t', image, '-'], { input: dockerfile, stdio: ['pipe', log, log] }).status !== 0) fail(4, `image build failed; see ${dir}/image-build.log`);
  }
  const sha = snapshot(batch);
  const head = git(['rev-parse', 'HEAD']);
  const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir']);
  console.error(`batch ${batch}: ${queue.length} task(s) on ${jobs} runner(s), snapshot ${sha}; output ${dir}`);

  // Keep two cores for the host: the runners must never take every CPU at once.
  const cpus = String(Math.max(1, Math.floor((Number(info.stdout) - 2) / jobs)));
  const env = { ...process.env, ANTHROPIC_AUTH_TOKEN: key, DEEPSEEK_API_KEY: key };
  const results = new Map(hostOnly.map((t) => [t.id, { task: t.id, status: 'host-only', result: null, turns: null, wallSeconds: 0, usage: null }]));
  const setup = Array(jobs).fill(null);
  const runner = async (k) => {
    const name = `uvw-verify-${batch}-r${k + 1}`, log = join(dir, `r${k + 1}-setup.log`), since = Date.now();
    const up = await run(['run', '-d', '--init', '--name', name, '--label', `uvw-verify.batch=${batch}`, '--shm-size=1g', '--cpus', cpus,
      '-v', `${common}:/hostgit:ro`, '-v', 'uvw-verify-runner-pnpm-store:/home/node/.local/share/pnpm', '-v', `${dir}:/batch`,
      image, 'sleep', 'infinity'], { log });
    const built = up === 0 && await run(['exec', name, 'bash', '-c', [
      'set -e', "git config --global --add safe.directory '*'",
      `git init -q ~/repo && cd ~/repo && git fetch -q --depth 1 file:///hostgit ${sha} && git checkout -q FETCH_HEAD`,
      'pnpm install --frozen-lockfile', "pnpm --filter 'univer-workspace-cli...' build"].join('\n')], { log }) === 0;
    if (!built) return console.error(`runner r${k + 1} setup failed; see ${log}`);
    setup[k] = seconds(since);
    for (let task; (task = queue.shift());) {
      const begun = Date.now();
      console.error(`r${k + 1}: ${task.id} started`);
      mkdirSync(join(dir, task.id), { recursive: true });
      await run(['exec', '-e', 'ANTHROPIC_AUTH_TOKEN', '-e', 'DEEPSEEK_API_KEY', name, 'bash', '/home/node/repo/.agents/skills/verify-uvw/runner/task.sh',
        task.id, task.feature, ...task.journeys], { log: join(dir, task.id, 'task.log'), env });
      const result = finish(task, dir, seconds(begun), key);
      results.set(task.id, result);
      console.error(`r${k + 1}: ${task.id} ${result.status} ${result.result ?? ''}`);
    }
  };
  await Promise.all(setup.map((_, k) => runner(k)));
  for (const t of queue) results.set(t.id, { task: t.id, status: 'infra-error', result: null, turns: null, wallSeconds: 0, usage: null });

  const ordered = tasks.map((t) => results.get(t.id));
  const text = summary({ batch, sha, head, image, jobs, dir, results: ordered, hostOnly, setup, wallSeconds: seconds(started) });
  writeFileSync(join(dir, 'summary.md'), text);
  process.stdout.write(text);
  if (keep) console.error(`kept containers; remove them with: docker rm -f $(docker ps -aq --filter label=uvw-verify.batch=${batch})`);
  else removeContainers();
  process.exit(exitCode(ordered));
}

if (realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
