#!/usr/bin/env node
// The journey contract: the only reader of features/*.md structure and the only writer of a run's journeys.jsonl.
// Usage (through bin/verify-uvw): journeys.mjs list [--run DIR] <feature> [ID|mode...]
//   | journeys.mjs verdict --run DIR <ID> PASS|FAIL|DRIFT|BLOCKED [note]
//   | journeys.mjs brief --repo DIR --root DIR --run-id ID <feature> [ID|mode...]
//   | journeys.mjs up-env <feature> [ID|mode...]
//   | journeys.mjs run --run DIR [--again] <feature> [ID|mode...]
import { spawn } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redact, runSecrets } from './secrets.mjs';

export const VERDICTS = ['PASS', 'FAIL', 'DRIFT', 'BLOCKED'];
const REPO = fileURLToPath(new URL('../../../..', import.meta.url));
const FEATURES = fileURLToPath(new URL('../features', import.meta.url));
const DRIVE = '## Driving it with agent-browser and uvw';
const JOURNEY = /^### ([A-Z][A-Z0-9]*(?:-\d+|\d+))\. (\S.*)$/;
const METADATA = /^(Mode|Needs|Run):/;
// bash never traps a failing `! command`, and bash 3.2 neither `[[ ]]`, `(( ))` nor `( )`, so a helper journey checks with none.
const UNTRAPPED = /^\s*(!\s|\[\[|\()/;
const PRELUDE = fileURLToPath(new URL('./journey-prelude.sh', import.meta.url));

// The instance shapes a journey can declare, each as the flags `up --for` sets.
export const MODES = {
  default: { VERIFY_UVW_MCP: '0', VERIFY_UVW_MCP_SAME_ORIGIN: '0' },
  mcp: { VERIFY_UVW_MCP: '1', VERIFY_UVW_MCP_SAME_ORIGIN: '0' },
  'mcp-same-origin': { VERIFY_UVW_MCP: '1', VERIFY_UVW_MCP_SAME_ORIGIN: '1' },
};

// What must be built before `up`: `setup` builds it, and `up --for` refuses until `ready` returns null.
export const NEEDS = {
  'web-build': {
    setup: "pnpm --filter '@univerjs/univer-workspace^...' build && pnpm --filter @univerjs/univer-workspace build:web",
    // shortcut: compares only apps/workspace/web with the build, not the workspace packages it bundles; check those too if a stale package ever slips through.
    ready(repo = REPO) {
      const built = join(repo, 'apps/workspace/dist/public/index.html');
      if (!existsSync(built)) return 'apps/workspace/dist/public is not built';
      const since = statSync(built).mtimeMs;
      const newer = readdirSync(join(repo, 'apps/workspace/web'), { withFileTypes: true, recursive: true })
        .find((e) => e.isFile() && statSync(join(e.parentPath, e.name)).mtimeMs > since);
      return newer ? `${relative(repo, join(newer.parentPath, newer.name))} is newer than apps/workspace/dist/public` : null;
    },
  },
};

// Who runs a journey: the helper runs the bash blocks of a "Run: helper." journey as written (`$V run-journeys`), and
// the agent follows the text of every other journey.
const RUN_BY = { helper: 'the helper runs its blocks' };
const KEYS = { Mode: [MODES, 'mode'], Needs: [NEEDS, 'need'], Run: [RUN_BY, 'runner'] };

export const modeOf = (runEnv) => (runEnv.MCP_ENABLED !== '1' ? 'default' : runEnv.MCP_SAME_ORIGIN === '1' ? 'mcp-same-origin' : 'mcp');

// One metadata line, such as "Mode: mcp. Run: helper." -> { Mode: ['mcp'], Run: ['helper'] }; returns an error message when malformed.
function metadata(line) {
  const meta = {};
  for (const clause of line.split(/(?<=\.) /)) {
    const [, key, list] = /^(Mode|Needs|Run): ([a-z0-9-]+(?:, [a-z0-9-]+)*)\.$/.exec(clause) ?? [];
    if (!key) return `write metadata as "Mode: <mode>.", "Needs: <need>, <need>." and "Run: helper.": ${line}`;
    if (meta[key]) return `${key} appears twice: ${line}`;
    const [known, noun] = KEYS[key], values = list.split(', ');
    if (key === 'Run' && values.includes('agent')) return `the agent runs every journey without a "Run:" line, so delete "Run: agent.": ${line}`;
    const unknown = values.filter((v) => !Object.hasOwn(known, v));
    if (unknown.length) return `unknown ${noun} ${unknown.join(', ')}; use ${Object.keys(known).join(', ')}`;
    if (key !== 'Needs' && values.length > 1) return `${key} takes one value: ${line}`;
    meta[key] = values;
  }
  return meta;
}

// Every `###` under DRIVE is a journey, so a heading the grammar does not match fails here instead of going unread.
// The same holds for metadata: it is the first paragraph under DRIVE (feature scope) or under a journey heading, or an error.
export function parseFeature(name, markdown) {
  const lines = markdown.split('\n');
  const fail = (i, message) => { throw new Error(`features/${name}.md:${i + 1}: ${message}`); };
  if (!/^# ./.test(lines[0])) fail(0, 'a feature starts with an H1');
  const journeys = [], setup = [], scope = { feature: {} };
  let fenced = false, section = null, open = null, block = null;
  lines.forEach((line, i) => {
    const first = open;
    if (line.trim()) open = null;
    if (/^\s*(```|~~~)/.test(line)) {
      if (block) (journeys.at(-1)?.blocks ?? setup).push({ line: block.line, text: block.lines.join('\n') });
      block = !fenced && section === DRIVE && /^```(bash|sh)\s*$/.test(line) ? { line: i + 2, lines: [] } : null;
      fenced = !fenced;
    } else if (fenced) block?.lines.push(line);
    else if (METADATA.test(line)) {
      if (!first) fail(i, `a "Mode:", "Needs:" or "Run:" line is the first paragraph under "${DRIVE}" or under a journey heading`);
      const meta = metadata(line);
      if (typeof meta === 'string') fail(i, meta);
      // A feature-scope runner would pass silently to every journey added later, including one that needs a browser or a model.
      if (meta.Run && first === scope.feature) fail(i, `"Run:" goes under a journey heading, not under "${DRIVE}"; mark each journey the helper runs with "Run: helper."`);
      Object.assign(first, meta);
    } else if (line.startsWith('## ')) {
      section = line;
      if (line === DRIVE) open = scope.feature;
    } else if (section === DRIVE && line.startsWith('### ')) {
      const m = JOURNEY.exec(line) ?? fail(i, `write a journey heading as "### <ID>. <Title>", with an ID such as MS5 or TR2-1: ${line}`);
      journeys.push({ id: m[1], title: m[2], feature: name, line: i + 1, blocks: [] });
      open = scope[m[1]] = {};
    }
  });
  if (!journeys.length) fail(0, `no "### <ID>. <Title>" journey under "${DRIVE}"`);
  for (const j of journeys) {
    const own = scope[j.id], feature = scope.feature;
    j.mode = (own.Mode ?? feature.Mode ?? ['default'])[0];
    j.needs = [...new Set([...(feature.Needs ?? []), ...(own.Needs ?? [])])];
    j.runBy = (own.Run ?? ['agent'])[0];
  }
  const run = journeys.filter((j) => j.runBy === 'helper');
  // run-journeys runs these first, so a helper journey runs on their shell state.
  for (const j of run) j.before = run.filter((k) => k.mode === j.mode && k.line < j.line).map((k) => k.id);
  for (const b of [...(run.length ? setup : []), ...run.flatMap((j) => j.blocks)]) {
    b.text.split('\n').forEach((code, k) => {
      if (UNTRAPPED.test(code)) fail(b.line + k - 1, `the helper cannot check with "!", "[[ ]]", "(( ))" or "( )", because bash does not trap their failure everywhere; write "command; test $? -eq 1", "test" or "{ ...; }": ${code.trim()}`);
    });
  }
  return { name, setup, journeys };
}

export function loadFeatures(dir = FEATURES) {
  const features = new Map(), seen = new Map();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md').sort()) {
    const feature = parseFeature(file.slice(0, -3), readFileSync(join(dir, file), 'utf8'));
    for (const j of feature.journeys) {
      if (seen.has(j.id)) throw new Error(`features/${file}:${j.line}: ${j.id} is already the journey at ${seen.get(j.id)}`);
      seen.set(j.id, `features/${file}:${j.line}`);
    }
    features.set(feature.name, feature);
  }
  return features;
}

// The journeys that selectors (journey IDs or mode names) pick, as one partition per mode in file order, each run
// on its own instance. A partition's `selectors` pick it again on its own.
export function plan(feature, selectors = []) {
  const modes = [...new Set(feature.journeys.map((j) => j.mode))];
  const unknown = selectors.filter((s) => !modes.includes(s) && !feature.journeys.some((j) => j.id === s));
  if (unknown.length) throw new Error(`no journey or mode ${unknown.join(', ')} in features/${feature.name}.md; it has ${feature.journeys.map((j) => j.id).join(', ')} in ${modes.join(', ')}`);
  const selected = selectors.length ? feature.journeys.filter((j) => selectors.includes(j.id) || selectors.includes(j.mode)) : feature.journeys;
  const partitions = [];
  for (const j of selected) {
    let p = partitions.find((q) => q.mode === j.mode);
    if (!p) partitions.push(p = { feature: feature.name, mode: j.mode, needs: [], journeys: [] });
    p.journeys.push(j);
    p.needs = [...new Set([...p.needs, ...j.needs])];
  }
  const byId = selectors.some((s) => !modes.includes(s));
  for (const p of partitions) p.selectors = byId ? p.journeys.map((j) => j.id) : selectors.length || partitions.length > 1 ? [p.mode] : [];
  return { partitions };
}

export const upFor = (p) => `$V up --for ${[p.feature, ...p.selectors].join(' ')}`;

export const journalFile = (run) => join(run, 'evidence', 'journeys.jsonl');

export function readJournal(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
}

// Every run's journal under a directory of runs, such as an evidence root, in time order.
export function readRuns(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((run) => readJournal(journalFile(join(dir, run))))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

// One rule for the writer (`verdict`) and the reader (`fold`), so a hand-written journal line gets no more than the command.
// `checks` is a helper journey's last checks outcome, 'none' before it ran, and null for a journey the agent drives.
export function allowed(verdict, note, checks = null) {
  if (!VERDICTS.includes(verdict)) return `the verdict is one of ${VERDICTS.join(', ')}`;
  if (verdict !== 'PASS' && !String(note ?? '').trim()) return `${verdict} needs a note: the values you read and the evidence files, or why it could not run`;
  if (verdict === 'PASS' && checks === 'none') return 'its checks have not run; run `$V run-journeys <feature> <ID>` first';
  if (verdict === 'PASS' && checks && checks !== 'held') return `its checks ${checks}; record FAIL, DRIFT or BLOCKED with what you saw`;
  return null;
}

// A checks entry in one line: where the first check broke, or why the journey could not run; '' when it held.
function told(c) {
  if (!c || c.outcome === 'held') return '';
  if (c.outcome !== 'broke') return String(c.reason ?? c.outcome);
  const [first = {}, ...more] = c.failures ?? [];
  return `${first.line} exit ${first.exit}: ${first.command}${more.length ? ` (and ${more.length} more)` : ''}`;
}

export function fold(expected, entries) {
  const last = (kind, id) => entries.findLast((e) => e?.kind === kind && e.journey === id);
  // The expected journeys ran on the state of those before them, so one of those whose checks did not hold needs a verdict too.
  const selected = new Set(expected.map((j) => j.id));
  const first = [...new Set(expected.flatMap((j) => j.before ?? []))]
    .filter((id) => !selected.has(id) && ['broke', 'blocked'].includes(last('checks', id)?.outcome)).map((id) => ({ id, runBy: 'helper' }));
  const journeys = [...expected, ...first].map((j) => {
    const c = j.runBy === 'helper' ? last('checks', j.id) : undefined;
    const checks = j.runBy === 'helper' ? c?.outcome ?? 'none' : null;
    const v = last('verdict', j.id);
    const counted = v && !allowed(v.verdict, v.note, checks);
    return { id: j.id, verdict: counted ? v.verdict : 'MISSING', note: counted ? v.note ?? '' : '', checks, failure: told(c) };
  });
  const result = journeys.some((j) => j.verdict === 'MISSING') ? 'INCOMPLETE'
    : journeys.every((j) => j.verdict === 'PASS') ? 'PASS' : 'ISSUES';
  const run = journeys.filter((j) => j.checks);
  return { journeys, result, checks: run.length ? (run.every((j) => j.checks === 'held') ? 'HELD' : 'BROKE') : null };
}

// journey-prelude.sh records a failure as F (k, exit, file:line, log offset, command) and a command that reads $?
// as R (k). A failure's records through function returns and `.` follow each other, one DEBUG trap apart, with the
// same exit; an R one DEBUG trap after a failure means the next command read its status, so it is no failure.
export function readFailures(text) {
  const failures = [];
  for (const record of text.split('\n').filter(Boolean)) {
    const [kind, k, exit, at = '', offset, command = ''] = record.split('\t');
    const last = failures.at(-1), n = Number(k);
    if (kind === 'R') { if (last?.end === n - 1) failures.pop(); }
    else if (last?.end === n - 1 && last.exit === Number(exit)) last.end = n;
    else failures.push({ end: n, exit: Number(exit), at, offset: Number(offset), command });
  }
  return failures;
}

const quote = (path) => `'${path.replaceAll("'", "'\\''")}'`;
const clip = (text, max) => (text.length > max ? `${text.slice(0, max)}…` : text);

// One step (the setup or a journey) in its own bash, under the prelude, as a checks entry.
async function execute({ run, feature, step, repo, timeoutSeconds }) {
  const dir = join(run, 'journeys');
  const files = step.blocks.map((b, n) => join(dir, `${step.id}.${n + 1}.sh`));
  step.blocks.forEach((b, n) => writeFileSync(files[n], `${b.text}\n`));
  const driver = join(dir, `${step.id}.sh`), fails = join(dir, `${step.id}.fails`), cur = join(dir, `${step.id}.at`);
  writeFileSync(driver, `${[PRELUDE, ...files].map((f) => `. ${quote(f)}`).join('\n')}\n__vu_save\n`);
  writeFileSync(fails, '');
  writeFileSync(cur, '');
  const log = join(run, 'evidence', `${step.id}.run.log`), fd = openSync(log, 'w'), started = Date.now();
  const child = spawn('bash', [driver], { cwd: repo, detached: true, stdio: ['ignore', fd, fd],
    env: { ...process.env, VU_REPO: repo, VU_STATE: join(dir, 'state.sh'), VU_FAILS: fails, VU_LOG: log, VU_CUR: cur } });
  closeSync(fd);
  let timedOut = false;
  const kill = (signal) => { try { process.kill(-child.pid, signal); } catch {} };
  const timer = setTimeout(() => { timedOut = true; kill('SIGTERM'); setTimeout(() => kill('SIGKILL'), 5000).unref(); }, timeoutSeconds * 1000);
  const [code, signal] = await new Promise((resolve) => child.on('exit', (...exit) => resolve(exit)));
  clearTimeout(timer);

  const where = (at) => {
    const i = at.lastIndexOf(':'), file = at.slice(0, i), line = Number(at.slice(i + 1));
    const n = files.indexOf(file);
    if (n >= 0) return `features/${feature.name}.md:${step.blocks[n].line + line - 1}`;
    if (file === driver && step.blocks[line - 2]) return `features/${feature.name}.md:${step.blocks[line - 2].line}`;
    return i > 0 ? `${basename(file)}:${line}` : 'the prelude';
  };
  const output = readFileSync(log), secrets = runSecrets(run);
  const tail = (end) => clip(redact(output.subarray(Math.max(0, end - 4000), end).toString('utf8').trimEnd().split('\n').slice(-12).join('\n'), secrets), 1500);
  const failures = readFailures(readFileSync(fails, 'utf8')).slice(0, 20)
    .map((f) => ({ line: where(f.at), command: clip(redact(f.command, secrets), 300), exit: f.exit, tail: tail(f.offset) }));
  const at = where(readFileSync(cur, 'utf8').trim());
  const reason = timedOut ? `timed out after ${timeoutSeconds} s at ${at}`
    : signal ? `stopped by ${signal} at ${at}`
      : code === 90 || code === 91 ? `the run's environment did not load: ${tail(output.length)}`
        : null;
  return { kind: 'checks', at: new Date().toISOString(), run: basename(run), feature: feature.name, journey: step.id,
    outcome: reason ? 'blocked' : failures.length ? 'broke' : 'held', failures, reason, seconds: Math.round((Date.now() - started) / 1000),
    log: `evidence/${step.id}.run.log` };
}

// Runs the setup and the helper journeys of one mode of a feature, in file order, up to the last of `ids`, skipping
// those this run already recorded unless `again` names them, and never those in `skip`. Journeys share shell state
// through journeys/state.sh, so an earlier journey runs first; the agent's journeys are not in this chain, so no helper
// journey may need one.
export async function runJourneys({ run, feature, mode, ids, again = false, skip = [], timeoutSeconds = 600, repo = REPO, print = console.log }) {
  const journeys = plan(feature, [mode]).partitions[0]?.journeys ?? [];
  const end = Math.max(...ids.map((id) => journeys.findIndex((j) => j.id === id)));
  const chain = journeys.slice(0, end + 1).filter((j) => j.runBy === 'helper' && !skip.includes(j.id));
  if (!chain.length) return { ok: true, entries: [] };
  if (feature.setup.length) chain.unshift({ id: 'setup', blocks: feature.setup });
  mkdirSync(join(run, 'journeys'), { recursive: true, mode: 0o700 });
  const journal = journalFile(run), done = readJournal(journal).filter((e) => e.kind === 'checks');
  const width = Math.max(...chain.map((s) => s.id.length));
  const show = (e, note) => {
    print(`${e.journey.padEnd(width)}  ${e.outcome.padEnd(7)}  ${e.seconds} s${note ? `  ${note}` : ''}`);
    if (e.reason) print(`  ${e.reason}`);
    for (const f of e.failures ?? []) print([`  ${f.line}  exit ${f.exit}`, `    ${f.command}`, ...f.tail.split('\n').filter(Boolean).map((l) => `    | ${l}`)].join('\n'));
    if (e.outcome !== 'held') print(`  log: ${join(run, e.log)}`);
  };
  const entries = [];
  let broken = null;
  for (const step of chain) {
    const prior = done.findLast((e) => e.journey === step.id);
    let entry = prior;
    if (!prior || (again && ids.includes(step.id))) {
      entry = broken ? { kind: 'checks', at: new Date().toISOString(), run: basename(run), feature: feature.name, journey: step.id, outcome: 'blocked', failures: [],
        reason: `the setup ${broken.outcome}${broken.failures[0] ? ` at ${broken.failures[0].line}` : ''}, so it did not run`, seconds: 0, log: broken.log }
        : await execute({ run, feature, step, repo, timeoutSeconds });
      appendFileSync(journal, `${JSON.stringify(entry)}\n`);
      entries.push(entry);
    }
    show(entry, entry === prior ? `recorded ${entry.at}` : ids.includes(step.id) || step.id === 'setup' ? '' : 'ran first: a later journey needs it');
    if (step.id === 'setup' && entry.outcome !== 'held') broken = entry;
  }
  const last = (id) => [...done, ...entries].findLast((e) => e.journey === id);
  const first = chain.filter((s) => s.id !== 'setup' && !ids.includes(s.id) && last(s.id).outcome !== 'held');
  if (first.length) print(`ran first and did not hold: ${first.map((s) => `${s.id} ${last(s.id).outcome}`).join(', ')}; each needs a verdict too`);
  return { ok: ids.every((id) => !chain.some((s) => s.id === id) || last(id)?.outcome === 'held'), entries };
}

export function brief({ repo, root, runId, feature, selectors, partition }) {
  const file = `.agents/skills/verify-uvw/features/${feature.name}.md`;
  const expected = partition.journeys.map((j) => j.id);
  const others = partition.journeys.length < feature.journeys.length;
  const list = (ids) => ids.join(', ');
  const helper = partition.journeys.filter((j) => j.runBy === 'helper').map((j) => j.id);
  const driven = expected.filter((id) => !helper.includes(id));
  const follow = !helper.length
    ? `Follow ${file}. Do its setup, the text before its first journey, then run your journeys in file order, each command as written.${others ? ' Skip its other journeys.' : ''}`
    : `Read ${file}. The helper already ran its setup, the text before its first journey, and the code blocks of ${list(helper)}, each exactly as written, and recorded every check that broke. Do not run or retype those commands. \`$V journeys ${[feature.name, ...selectors].join(' ')}\` shows each journey's checks, and \`$V run-journeys ${feature.name} <ID>\` prints a journey's broken checks with the end of their output.${driven.length ? ` Run ${list(driven)} yourself in file order, each command as written, and start each of their shells with \`. "$RUN/journeys/state.sh"\` after the line above: it holds the variables and functions of the setup and the helper's journeys.` : ''}${others ? ' Skip the other journeys.' : ''}`;
  const steps = [
    'Read the Drive and Evidence sections of .agents/skills/verify-uvw/SKILL.md, then .agents/skills/verify-uvw/features/README.md.',
    follow,
    `When a journey ends, compare what happened with its pass condition and record its verdict with \`$V verdict <ID> PASS|FAIL|DRIFT|BLOCKED "<note>"\`.${helper.length ? `
   For a journey the helper ran, judge its pass condition from its checks and the evidence files its text names, and open every image it tells you to look at. The helper refuses PASS when a check broke or did not run: then read the failure and its evidence, and record FAIL or DRIFT, or BLOCKED when the journey could not run.` : ''}
   - PASS: every step ran and every check held.
   - FAIL: the product differs from the recipe.
   - DRIFT: the recipe is wrong, such as a stale count or a renamed label. Quote the recipe and say what the product does.
   - BLOCKED: the journey could not run, or ran only in part. Say why. A command that timed out or failed before the product answered, such as an \`agent-browser\` load timeout, is BLOCKED, not FAIL.
   Every verdict but PASS needs a note with the values you read and the evidence files. Record each verdict as soon as you judge the journey; one command can record several. A later verdict for a journey replaces the earlier one.`,
    `Run \`$V journeys ${[feature.name, ...selectors].join(' ')}\`. Record a verdict for each journey it lists as MISSING, until its last line no longer says INCOMPLETE.`,
    `Reply with a short account of every journey that is not PASS, and of anything surprising in a PASS. Give the values you read, not the values the recipe expects.`,
  ];
  return `Follow a written recipe against a Univer Workspace instance, and record a verdict for each of its journeys.

Run ${runId} is already running in the \`${partition.mode}\` mode that these journeys declare, with uvw signed in as its user and a doctor check that found no FAIL line. The run's browser starts signed out. When a journey expects it signed in as that user, sign it in first with the block under **Browser** in the Drive section of .agents/skills/verify-uvw/SKILL.md. Do not run \`up\`, \`down\` or \`user\` unless a journey's own text restarts the instance; then run what that text says.

Work from ${repo}. Start every shell command with this line. It selects the instance:

export VERIFY_UVW_ROOT=${root} VERIFY_UVW_RUN=${runId}; V=.agents/skills/verify-uvw/bin/verify-uvw; eval "$($V env)"

Run every command in the foreground and wait until it exits. Never start one in the background, and never end your reply while a command you started still runs: your session can close as soon as you stop, and the command dies with it. A story (\`$V story\`) can take 30 minutes. When your shell tool takes a timeout, give a story 2400000 ms (40 minutes), because some tools move a command to the background when its timeout passes, as opencode's does after 2 minutes by default.

Your journeys are the \`### <ID>. <Title>\` sections of ${file} with these IDs: ${expected.join(', ')}. Each needs a verdict.

${steps.map((step, k) => `${k + 1}. ${step}`).join('\n')}

Never run \`set -x\`, and never print a cookie, token, password or environment variable, for example with \`agent-browser cookies get\` or \`env\`: your transcript is kept. Do not edit files in the repository. When the product differs from the recipe, do not work around it or fix it. Record what you saw and go on to the next journey.
`;
}

const readEnv = (file) => Object.fromEntries((existsSync(file) ? readFileSync(file, 'utf8') : '').split('\n').map((line) => line.split(/=(.*)/s).slice(0, 2)));

async function main(argv) {
  const die = (message, code = 1) => { console.error(`verify-uvw: ${message}`); process.exit(code); };
  const [command, ...rest] = argv;
  const opts = { again: false }, args = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--again') opts.again = true;
    else if (['--run', '--repo', '--root', '--run-id'].includes(rest[i])) opts[rest[i].slice(2)] = rest[++i];
    else args.push(rest[i]);
  }
  let features;
  try { features = loadFeatures(); } catch (error) { die(error.message, 2); }
  const named = (name) => features.get(name) ?? die(`no .agents/skills/verify-uvw/features/${name}.md`);
  const planned = (feature, selectors) => { try { return plan(feature, selectors); } catch (error) { return die(error.message, 2); } };
  // When up links each run's evidence under VERIFY_UVW_EVIDENCE_ROOT, coverage spans every run there, as runs a recipe starts count too.
  const evidenceRoot = process.env.VERIFY_UVW_EVIDENCE_ROOT;
  const entriesOf = (run) => (evidenceRoot ? readRuns(evidenceRoot) : readJournal(journalFile(run)));
  const runningMode = (run, partition, fix) => {
    const running = modeOf(readEnv(join(run, 'run.env')));
    if (running !== partition.mode) die(`run ${basename(run)} runs in the ${running} mode, and these journeys declare ${partition.mode}; run \`$V down\`, then \`${upFor(partition)}\`${fix}`);
  };
  // The one partition an instance runs; a selection that spans modes names the `up --for` of each.
  const single = ({ partitions }, name, selectors, what) => {
    if (partitions.length > 1) die(`${[name, ...selectors].join(' ')} spans ${partitions.length} modes, and one instance runs one. ${what} for each:\n${partitions.map((p) => `  ${upFor(p)}`).join('\n')}`, 2);
    return partitions[0];
  };

  if (command === 'verdict') {
    const [id, verdict, ...words] = args;
    if (!opts.run || !id || !verdict) die('usage: verify-uvw verdict <journey-id> PASS|FAIL|DRIFT|BLOCKED [note]', 2);
    const journey = [...features.values()].flatMap((f) => f.journeys).find((j) => j.id === id)
      ?? die(`no journey ${id} in .agents/skills/verify-uvw/features/; \`$V journeys <feature>\` lists them`);
    const note = words.join(' ');
    const checks = journey.runBy === 'helper' ? entriesOf(opts.run).findLast((e) => e.kind === 'checks' && e.journey === id)?.outcome ?? 'none' : null;
    const refused = allowed(verdict, note, checks);
    if (refused) die(`${id}: ${refused}`);
    appendFileSync(journalFile(opts.run), `${JSON.stringify({ kind: 'verdict', at: new Date().toISOString(), run: basename(opts.run), feature: journey.feature, journey: id, verdict, note })}\n`);
    console.log(`recorded ${id} ${verdict} in ${journalFile(opts.run)}`);
  } else if (command === 'list') {
    const [name, ...selectors] = args;
    if (!name) die('usage: verify-uvw journeys <feature> [journey-id|mode...]', 2);
    const { partitions } = planned(named(name), selectors);
    const expected = partitions.flatMap((p) => p.journeys);
    // fold may add a journey that ran first.
    const width = Math.max(...expected.flatMap((j) => [j.id, ...(j.before ?? [])]).map((id) => id.length));
    const row = (id, text) => `${id.padEnd(width)}  ${text}`.trimEnd();
    if (!opts.run) {
      console.log([`${name}: ${expected.length} journeys in .agents/skills/verify-uvw/features/${name}.md`,
        ...partitions.flatMap((p) => [`${p.mode}${p.needs.length ? `, needs ${p.needs.join(', ')}` : ''}: ${upFor(p)}`,
          ...p.journeys.map((j) => `  ${row(j.id, `${j.title}${j.runBy === 'helper' ? ', run by the helper' : ''}`)}`)])].join('\n'));
      return;
    }
    const { journeys, result, checks } = fold(expected, entriesOf(opts.run));
    const done = journeys.filter((j) => j.verdict !== 'MISSING').length;
    const said = (j) => [j.note.replace(/\s+/g, ' '), !expected.some((e) => e.id === j.id) && 'ran first', j.checks && `checks ${j.checks}${j.failure ? `: ${j.failure.replace(/\s+/g, ' ')}` : ''}`].filter(Boolean).join('; ');
    console.log([`${name} in run ${basename(opts.run)}: ${done} of ${journeys.length} journeys have a verdict`,
      ...journeys.map((j) => row(j.id, `${j.verdict.padEnd(7)}  ${said(j)}`)), ...(checks ? [`CHECKS: ${checks}`] : []), `RESULT: ${result}`].join('\n'));
    if (result === 'INCOMPLETE') process.exitCode = 1;
  } else if (command === 'brief') {
    const [name, ...selectors] = args;
    if (!name || !opts.repo || !opts.root || !opts['run-id']) die('usage: verify-uvw brief <feature> [journey-id|mode...]', 2);
    const partition = single(planned(named(name), selectors), name, selectors, 'Brief one instance at a time, after');
    runningMode(join(opts.root, opts['run-id']), partition, '');
    process.stdout.write(brief({ repo: opts.repo, root: opts.root, runId: opts['run-id'], feature: named(name), selectors, partition }));
  } else if (command === 'up-env') {
    const [name, ...selectors] = args;
    if (!name) die('usage: verify-uvw up [--reuse] --for <feature> [journey-id|mode...]', 2);
    const partition = single(planned(named(name), selectors), name, selectors, 'Start');
    for (const need of partition.needs) {
      const why = NEEDS[need].ready();
      if (why) die(`these journeys need ${need}, and ${why}; run: ${NEEDS[need].setup}`);
    }
    console.log(Object.entries(MODES[partition.mode]).map(([key, value]) => `${key}=${value}`).join('\n'));
  } else if (command === 'run') {
    const [name, ...selectors] = args;
    if (!opts.run || !name) die('usage: verify-uvw run-journeys [--again] <feature> [journey-id|mode...]', 2);
    const feature = named(name);
    const partition = single(planned(feature, selectors), name, selectors, 'Run them in an instance of each mode, after');
    runningMode(opts.run, partition, ', then run-journeys again');
    const driven = partition.journeys.filter((j) => j.runBy === 'agent' && selectors.includes(j.id)).map((j) => j.id);
    if (driven.length) console.log(`${driven.join(', ')}: the agent follows ${driven.length === 1 ? 'its' : 'their'} text; the helper runs no journey but those marked "Run: helper."`);
    // Journeys this machine cannot run, which the helper leaves out even when a later journey would run them first.
    const skip = (process.env.VERIFY_UVW_SKIP_JOURNEYS ?? '').split(' ');
    const { ok } = await runJourneys({ run: opts.run, feature, mode: partition.mode, ids: partition.journeys.filter((j) => j.runBy === 'helper').map((j) => j.id), again: opts.again, skip });
    process.exitCode = ok ? 0 : 1;
  } else {
    die('usage: journeys.mjs list|verdict|brief|up-env|run ...', 2);
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
