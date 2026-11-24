#!/usr/bin/env node
// The journey contract: the only reader of features/*.md structure and the only writer of a run's journeys.jsonl.
// Usage (through bin/verify-uvw): journeys.mjs list [--run DIR] <feature> [ID|mode...]
//   | journeys.mjs verdict --run DIR <ID> PASS|FAIL|DRIFT|BLOCKED [note]
//   | journeys.mjs brief [--own] --repo DIR --root DIR --run-id ID <feature> [ID|mode...]
//   | journeys.mjs up-env <feature> [ID|mode...]
import { appendFileSync, existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERDICTS = ['PASS', 'FAIL', 'DRIFT', 'BLOCKED'];
const REPO = fileURLToPath(new URL('../../../..', import.meta.url));
const FEATURES = fileURLToPath(new URL('../features', import.meta.url));
const DRIVE = '## Driving it with agent-browser and uvw';
const JOURNEY = /^### ([A-Z][A-Z0-9]*(?:-\d+|\d+))\. (\S.*?)( \(host only\))?$/;
const METADATA = /^(Mode|Needs):/;

// The instance shapes a journey can declare, each as the flags `up --for` sets.
export const MODES = {
  default: { VERIFY_UVW_MCP: '0', VERIFY_UVW_MCP_SAME_ORIGIN: '0' },
  mcp: { VERIFY_UVW_MCP: '1', VERIFY_UVW_MCP_SAME_ORIGIN: '0' },
  'mcp-same-origin': { VERIFY_UVW_MCP: '1', VERIFY_UVW_MCP_SAME_ORIGIN: '1' },
};

// What must be built before `up`: the runner runs `setup` once per container, and `up --for` refuses until `ready` returns null.
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

export const modeOf = (runEnv) => (runEnv.MCP_ENABLED !== '1' ? 'default' : runEnv.MCP_SAME_ORIGIN === '1' ? 'mcp-same-origin' : 'mcp');

// One metadata line, such as "Mode: mcp. Needs: web-build." -> { Mode: ['mcp'], Needs: ['web-build'] }; returns an error message when malformed.
function metadata(line) {
  const meta = {};
  for (const clause of line.split(/(?<=\.) /)) {
    const [, key, list] = /^(Mode|Needs): ([a-z0-9-]+(?:, [a-z0-9-]+)*)\.$/.exec(clause) ?? [];
    if (!key) return `write metadata as "Mode: <mode>." and "Needs: <need>, <need>.": ${line}`;
    if (meta[key]) return `${key} appears twice: ${line}`;
    const [known, noun] = key === 'Mode' ? [MODES, 'mode'] : [NEEDS, 'need'], values = list.split(', ');
    const unknown = values.filter((v) => !Object.hasOwn(known, v));
    if (unknown.length) return `unknown ${noun} ${unknown.join(', ')}; use ${Object.keys(known).join(', ')}`;
    if (key === 'Mode' && values.length > 1) return `a journey runs in one mode: ${line}`;
    meta[key] = values;
  }
  return meta;
}

// Every `###` under DRIVE is a journey, so a heading the grammar does not match fails here instead of going unread.
// The same holds for metadata: it is the first paragraph under DRIVE (feature scope) or under a journey heading, or an error.
export function parseFeature(name, markdown) {
  const lines = markdown.split('\n');
  const fail = (i, message) => { throw new Error(`features/${name}.md:${i + 1}: ${message}`); };
  const h1 = /^# (.+)$/.exec(lines[0]) ?? fail(0, 'a feature starts with an H1');
  const hostOnly = h1[1].endsWith(' (host only)');
  const journeys = [], scope = { feature: {} };
  let fenced = false, section = null, open = null;
  lines.forEach((line, i) => {
    const first = open;
    if (line.trim()) open = null;
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    else if (fenced) return;
    else if (METADATA.test(line)) {
      if (!first) fail(i, `a "Mode:" or "Needs:" line is the first paragraph under "${DRIVE}" or under a journey heading`);
      const meta = metadata(line);
      if (typeof meta === 'string') fail(i, meta);
      Object.assign(first, meta);
    } else if (line.startsWith('## ')) {
      section = line;
      if (line === DRIVE) open = scope.feature;
    } else if (section === DRIVE && line.startsWith('### ')) {
      const m = JOURNEY.exec(line) ?? fail(i, `write a journey heading as "### <ID>. <Title>", with an ID such as MS5 or TR2-1: ${line}`);
      journeys.push({ id: m[1], title: m[2], feature: name, line: i + 1, hostOnly: hostOnly || Boolean(m[3]) });
      open = scope[m[1]] = {};
    }
  });
  if (!journeys.length) fail(0, `no "### <ID>. <Title>" journey under "${DRIVE}"`);
  for (const j of journeys) {
    const own = scope[j.id], feature = scope.feature;
    j.mode = (own.Mode ?? feature.Mode ?? ['default'])[0];
    j.needs = [...new Set([...(feature.Needs ?? []), ...(own.Needs ?? [])])];
  }
  return { name, hostOnly, journeys };
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
// on its own instance, and the journeys only the host runs. A partition's `selectors` pick it again on its own.
export function plan(feature, selectors = [], { where = 'host' } = {}) {
  const modes = [...new Set(feature.journeys.map((j) => j.mode))];
  const unknown = selectors.filter((s) => !modes.includes(s) && !feature.journeys.some((j) => j.id === s));
  if (unknown.length) throw new Error(`no journey or mode ${unknown.join(', ')} in features/${feature.name}.md; it has ${feature.journeys.map((j) => j.id).join(', ')} in ${modes.join(', ')}`);
  const selected = selectors.length ? feature.journeys.filter((j) => selectors.includes(j.id) || selectors.includes(j.mode)) : feature.journeys;
  const host = where === 'runner' ? selected.filter((j) => j.hostOnly) : [];
  const partitions = [];
  for (const j of selected.filter((j) => !host.includes(j))) {
    let p = partitions.find((q) => q.mode === j.mode);
    if (!p) partitions.push(p = { feature: feature.name, mode: j.mode, needs: [], journeys: [] });
    p.journeys.push(j);
    p.needs = [...new Set([...p.needs, ...j.needs])];
  }
  const byId = selectors.some((s) => !modes.includes(s));
  for (const p of partitions) p.selectors = byId ? p.journeys.map((j) => j.id) : selectors.length || partitions.length > 1 ? [p.mode] : [];
  return { partitions, host };
}

export const upFor = (p) => `$V up --for ${[p.feature, ...p.selectors].join(' ')}`;

export const journalFile = (run) => join(run, 'evidence', 'journeys.jsonl');

export function readJournal(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
}

// Every run's journal under a directory of runs, in time order: a runner task's runs/, or a runner container's evidence root.
export function readRuns(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((run) => readJournal(journalFile(join(dir, run))))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

// One rule for the writer (`verdict`) and the reader (`fold`), so a hand-written journal line gets no more than the command.
export function allowed(verdict, note) {
  if (!VERDICTS.includes(verdict)) return `the verdict is one of ${VERDICTS.join(', ')}`;
  if (verdict !== 'PASS' && !String(note ?? '').trim()) return `${verdict} needs a note: the values you read and the evidence files, or why it could not run`;
  return null;
}

export function fold(expected, entries) {
  const verdicts = entries.filter((e) => e?.kind === 'verdict');
  const journeys = expected.map((j) => {
    const v = verdicts.findLast((e) => e.journey === j.id);
    return v && !allowed(v.verdict, v.note) ? { id: j.id, verdict: v.verdict, note: v.note ?? '' } : { id: j.id, verdict: 'MISSING', note: '' };
  });
  const result = journeys.some((j) => j.verdict === 'MISSING') ? 'INCOMPLETE'
    : journeys.every((j) => j.verdict === 'PASS') ? 'PASS' : 'ISSUES';
  return { journeys, result };
}

export function brief({ own, repo, root, runId, feature, selectors, partition, host }) {
  const file = `.agents/skills/verify-uvw/features/${feature.name}.md`;
  const expected = partition.journeys.map((j) => j.id);
  const others = partition.journeys.length < feature.journeys.length;
  const steps = [
    'Read the Drive and Evidence sections of .agents/skills/verify-uvw/SKILL.md, then .agents/skills/verify-uvw/features/README.md.',
    `Follow ${file}. Do its setup, the text before its first journey, then run your journeys in file order, each command as written.${others ? ' Skip its other journeys.' : ''}`,
    `When a journey ends, compare what happened with its pass condition and record its verdict with \`$V verdict <ID> PASS|FAIL|DRIFT|BLOCKED "<note>"\`.
   - PASS: every step ran and every check held.
   - FAIL: the product differs from the recipe.
   - DRIFT: the recipe is wrong, such as a stale count or a renamed label. Quote the recipe and say what the product does.
   - BLOCKED: the journey could not run, or ran only in part. Say why.
   Every verdict but PASS needs a note with the values you read and the evidence files. Record each verdict as soon as you judge the journey; one command can record several. A later verdict for a journey replaces the earlier one.`,
    `Run \`$V journeys ${[feature.name, ...selectors].join(' ')}\`. Record a verdict for each journey it lists as MISSING, until its last line no longer says INCOMPLETE.`,
    `Reply with a short account of every journey that is not PASS, and of anything surprising in a PASS. Give the values you read, not the values the recipe expects.${own ? ` Name each evidence file by its full path, such as ${root}/${runId}/evidence/<file>.` : ''}`,
  ];
  return `Follow a written recipe against a Univer Workspace instance, and record a verdict for each of its journeys.${own ? ' This container is disposable and yours.' : ''}

Run ${runId} is already running in the \`${partition.mode}\` mode that these journeys declare, with its user signed in and a doctor check that found no FAIL line. Do not run \`up\`, \`down\` or \`user\` unless a journey's own text restarts the instance; then run what that text says.

Work from ${repo}. Start every shell command with this line. It selects the instance:

export VERIFY_UVW_ROOT=${root} VERIFY_UVW_RUN=${runId}; V=.agents/skills/verify-uvw/bin/verify-uvw; eval "$($V env${own ? ' 2>/dev/null' : ''})"

Your journeys are the \`### <ID>. <Title>\` sections of ${file} with these IDs: ${expected.join(', ')}. Each needs a verdict.${host.length ? ` Do not run ${host.map((j) => j.id).join(', ')}. Only the host runs ${host.length === 1 ? 'it' : 'them'}.` : ''}

${steps.map((step, k) => `${k + 1}. ${step}`).join('\n')}

${own ? `Leave run ${runId} running when you reply: the runner checks its evidence, then stops it. Never print a cookie, token, password or environment variable, for example with \`agent-browser cookies get\` or \`env\`: your transcript is kept, and the runner fails a task whose files hold its API key. ` : ''}Do not edit files in the repository. When the product differs from the recipe, do not work around it or fix it. Record what you saw and go on to the next journey.
`;
}

const readEnv = (file) => Object.fromEntries((existsSync(file) ? readFileSync(file, 'utf8') : '').split('\n').map((line) => line.split(/=(.*)/s).slice(0, 2)));

function main(argv) {
  const die = (message, code = 1) => { console.error(`verify-uvw: ${message}`); process.exit(code); };
  const [command, ...rest] = argv;
  const opts = { own: false }, args = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--own') opts.own = true;
    else if (['--run', '--repo', '--root', '--run-id'].includes(rest[i])) opts[rest[i].slice(2)] = rest[++i];
    else args.push(rest[i]);
  }
  let features;
  try { features = loadFeatures(); } catch (error) { die(error.message, 2); }
  const named = (name) => features.get(name) ?? die(`no .agents/skills/verify-uvw/features/${name}.md`);
  const planned = (feature, selectors, where) => { try { return plan(feature, selectors, { where }); } catch (error) { return die(error.message, 2); } };
  // A runner container plans and folds as runner.mjs does: no host-only journeys, every run under the task's evidence root.
  const where = process.env.VERIFY_UVW_RUNNER === '1' ? 'runner' : 'host';
  // The one partition an instance runs; a selection that spans modes names the `up --for` of each.
  const single = ({ partitions }, name, selectors, what) => {
    if (!partitions.length) die(`${selectors.length ? `${selectors.join(', ')} in ${name} run` : `${name} runs`} only on the host`, 3);
    if (partitions.length > 1) die(`${[name, ...selectors].join(' ')} spans ${partitions.length} modes, and one instance runs one. ${what} for each:\n${partitions.map((p) => `  ${upFor(p)}`).join('\n')}`, 2);
    return partitions[0];
  };

  if (command === 'verdict') {
    const [id, verdict, ...words] = args;
    if (!opts.run || !id || !verdict) die('usage: verify-uvw verdict <journey-id> PASS|FAIL|DRIFT|BLOCKED [note]', 2);
    const journey = [...features.values()].flatMap((f) => f.journeys).find((j) => j.id === id)
      ?? die(`no journey ${id} in .agents/skills/verify-uvw/features/; \`$V journeys <feature>\` lists them`);
    const note = words.join(' ');
    const refused = allowed(verdict, note);
    if (refused) die(`${id}: ${refused}`);
    appendFileSync(journalFile(opts.run), `${JSON.stringify({ kind: 'verdict', at: new Date().toISOString(), run: basename(opts.run), feature: journey.feature, journey: id, verdict, note })}\n`);
    console.log(`recorded ${id} ${verdict} in ${journalFile(opts.run)}`);
  } else if (command === 'list') {
    const [name, ...selectors] = args;
    if (!name) die('usage: verify-uvw journeys <feature> [journey-id|mode...]', 2);
    const { partitions, host } = planned(named(name), selectors, where);
    const expected = partitions.flatMap((p) => p.journeys);
    const width = Math.max(...expected.map((j) => j.id.length));
    const row = (id, text) => `${id.padEnd(width)}  ${text}`.trimEnd();
    const hostLine = host.length ? [`${host.map((j) => j.id).join(', ')} run only on the host`] : [];
    if (!opts.run) {
      console.log([`${name}: ${expected.length} journeys in .agents/skills/verify-uvw/features/${name}.md`,
        ...partitions.flatMap((p) => [`${p.mode}${p.needs.length ? `, needs ${p.needs.join(', ')}` : ''}: ${upFor(p)}`,
          ...p.journeys.map((j) => `  ${row(j.id, `${j.title}${j.hostOnly ? ' (host only)' : ''}`)}`)]), ...hostLine].join('\n'));
      return;
    }
    const evidenceRoot = where === 'runner' && process.env.VERIFY_UVW_EVIDENCE_ROOT;
    const { journeys, result } = fold(expected, evidenceRoot ? readRuns(evidenceRoot) : readJournal(journalFile(opts.run)));
    const done = journeys.filter((j) => j.verdict !== 'MISSING').length;
    console.log([`${name} in run ${basename(opts.run)}: ${done} of ${journeys.length} journeys have a verdict`,
      ...journeys.map((j) => row(j.id, `${j.verdict.padEnd(7)}  ${j.note.replace(/\s+/g, ' ')}`)), ...hostLine, `RESULT: ${result}`].join('\n'));
    if (result === 'INCOMPLETE') process.exitCode = 1;
  } else if (command === 'brief') {
    const [name, ...selectors] = args;
    if (!name || !opts.repo || !opts.root || !opts['run-id']) die('usage: verify-uvw brief [--own <run-id>] <feature> [journey-id|mode...]', 2);
    const p = planned(named(name), selectors, opts.own ? 'runner' : 'host');
    const partition = single(p, name, selectors, 'Brief one instance at a time, after');
    const running = !opts.own && modeOf(readEnv(join(opts.root, opts['run-id'], 'run.env')));
    if (running && running !== partition.mode) die(`run ${opts['run-id']} runs in the ${running} mode, and these journeys declare ${partition.mode}; run \`$V down\`, then \`${upFor(partition)}\``);
    process.stdout.write(brief({ own: opts.own, repo: opts.repo, root: opts.root, runId: opts['run-id'], feature: named(name), selectors, partition, host: p.host }));
  } else if (command === 'up-env') {
    const [name, ...selectors] = args;
    if (!name) die('usage: verify-uvw up [--reuse] --for <feature> [journey-id|mode...]', 2);
    const partition = single(planned(named(name), selectors, where), name, selectors, 'Start');
    for (const need of partition.needs) {
      const why = NEEDS[need].ready();
      if (why) die(`these journeys need ${need}, and ${why}; run: ${NEEDS[need].setup}`);
    }
    console.log(Object.entries(MODES[partition.mode]).map(([key, value]) => `${key}=${value}`).join('\n'));
  } else {
    die('usage: journeys.mjs list|verdict|brief|up-env ...', 2);
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
