#!/usr/bin/env node
// The journey contract: the only reader of features/*.md structure and the only writer of a run's journeys.jsonl.
// Usage (through bin/verify-uvw): journeys.mjs list [--run DIR] <feature> [ID...]
//   | journeys.mjs verdict --run DIR <ID> PASS|FAIL|DRIFT|BLOCKED [note]
//   | journeys.mjs brief [--own] --repo DIR --root DIR --run-id ID <feature> [ID...]
import { appendFileSync, existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERDICTS = ['PASS', 'FAIL', 'DRIFT', 'BLOCKED'];
const FEATURES = fileURLToPath(new URL('../features', import.meta.url));
const DRIVE = '## Driving it with agent-browser and uvw';
const JOURNEY = /^### ([A-Z][A-Z0-9]*(?:-\d+|\d+))\. (\S.*?)( \(host only\))?$/;

// Every `###` under DRIVE is a journey, so a heading the grammar does not match fails here instead of going unread.
export function parseFeature(name, markdown) {
  const lines = markdown.split('\n');
  const fail = (i, message) => { throw new Error(`features/${name}.md:${i + 1}: ${message}`); };
  const h1 = /^# (.+)$/.exec(lines[0]) ?? fail(0, 'a feature starts with an H1');
  const hostOnly = h1[1].endsWith(' (host only)');
  const journeys = [];
  let fenced = false, section = null;
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    else if (fenced) return;
    else if (line.startsWith('## ')) section = line;
    else if (section === DRIVE && line.startsWith('### ')) {
      const m = JOURNEY.exec(line) ?? fail(i, `write a journey heading as "### <ID>. <Title>", with an ID such as MS5 or TR2-1: ${line}`);
      journeys.push({ id: m[1], title: m[2], feature: name, line: i + 1, hostOnly: hostOnly || Boolean(m[3]) });
    }
  });
  if (!journeys.length) fail(0, `no "### <ID>. <Title>" journey under "${DRIVE}"`);
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

// The journeys a spec selects, split into the instances that run them here and the ones only the host runs.
export function plan(feature, ids = [], { where = 'host' } = {}) {
  const unknown = ids.filter((id) => !feature.journeys.some((j) => j.id === id));
  if (unknown.length) throw new Error(`no journey ${unknown.join(', ')} in features/${feature.name}.md; it has ${feature.journeys.map((j) => j.id).join(', ')}`);
  const selected = ids.length ? feature.journeys.filter((j) => ids.includes(j.id)) : feature.journeys;
  const host = where === 'runner' ? selected.filter((j) => j.hostOnly) : [];
  const run = selected.filter((j) => !host.includes(j));
  return { partitions: run.length ? [{ feature: feature.name, mode: 'default', journeys: run }] : [], host };
}

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

export function brief({ own, repo, root, runId, feature, ids, plan: { partitions, host } }) {
  const file = `.agents/skills/verify-uvw/features/${feature}.md`;
  const expected = partitions.flatMap((p) => p.journeys.map((j) => j.id));
  const selectors = ids.length ? ` ${ids.join(' ')}` : '';
  const steps = [
    'Read the Drive and Evidence sections of .agents/skills/verify-uvw/SKILL.md, then .agents/skills/verify-uvw/features/README.md.',
    ...(own ? [`Start the instance as the preconditions of ${file} say: \`$V up\`, \`$V user\` and \`$V doctor\`, each in its own shell command. If doctor prints a \`FAIL\` line, record each journey as BLOCKED with those lines, and stop. When the recipe starts another run or restarts the instance, do that too.`] : []),
    `Follow ${file}. Set up its preconditions, then run your journeys in file order, each command as written.${ids.length || host.length ? ' Skip its other journeys.' : ''}`,
    `When a journey ends, compare what happened with its pass condition and record its verdict with \`$V verdict <ID> PASS|FAIL|DRIFT|BLOCKED "<note>"\`.
   - PASS: every step ran and every check held.
   - FAIL: the product differs from the recipe.
   - DRIFT: the recipe is wrong, such as a stale count or a renamed label. Quote the recipe and say what the product does.
   - BLOCKED: the journey could not run, or ran only in part. Say why.
   Every verdict but PASS needs a note with the values you read and the evidence files. Record each verdict as soon as you judge the journey; one command can record several. A later verdict for a journey replaces the earlier one.`,
    `Run \`$V journeys ${feature}${selectors}\`. Record a verdict for each journey it lists as MISSING, until its last line no longer says INCOMPLETE.`,
    `Reply with a short account of every journey that is not PASS, and of anything surprising in a PASS. Give the values you read, not the values the recipe expects.${own ? ` Name each evidence file by its full path, such as ${root}/${runId}/evidence/<file>.` : ''}`,
  ];
  return `${own ? 'Follow a written recipe against a Univer Workspace instance, and record a verdict for each of its journeys. This container is disposable and yours. Start the instance yourself.'
    : 'Follow a written recipe against a Univer Workspace instance that is already running, and record a verdict for each of its journeys.'}

Work from ${repo}. Start every shell command with this line. It selects the instance:

export VERIFY_UVW_ROOT=${root} VERIFY_UVW_RUN=${runId}; V=.agents/skills/verify-uvw/bin/verify-uvw; eval "$($V env${own ? ' 2>/dev/null' : ''})"

Your journeys are the \`### <ID>. <Title>\` sections of ${file} with these IDs: ${expected.join(', ')}. Each needs a verdict.${host.length ? ` Do not run ${host.map((j) => j.id).join(', ')}. Only the host runs ${host.length === 1 ? 'it' : 'them'}.` : ''}

${steps.map((step, k) => `${k + 1}. ${step}`).join('\n')}

${own ? `Leave run ${runId} running when you reply: do not run \`down\` for it. The runner checks its evidence, then stops it. Never print a cookie, token, password or environment variable, for example with \`agent-browser cookies get\` or \`env\`: your transcript is kept, and the runner fails a task whose files hold its API key. `
    : 'Do not run `up`, `down` or `user`. '}Do not edit files in the repository. When the product differs from the recipe, do not work around it or fix it. Record what you saw and go on to the next journey.
`;
}

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
  const planned = (feature, ids, where) => { try { return plan(feature, ids, { where }); } catch (error) { return die(error.message, 2); } };
  // A runner container plans and folds as runner.mjs does: no host-only journeys, every run under the task's evidence root.
  const where = process.env.VERIFY_UVW_RUNNER === '1' ? 'runner' : 'host';

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
    const [name, ...ids] = args;
    if (!name) die('usage: verify-uvw journeys <feature> [journey-id...]', 2);
    const { partitions, host } = planned(named(name), ids, where);
    const expected = partitions.flatMap((p) => p.journeys);
    const width = Math.max(...expected.map((j) => j.id.length));
    const row = (id, text) => `${id.padEnd(width)}  ${text}`.trimEnd();
    const hostLine = host.length ? [`${host.map((j) => j.id).join(', ')} run only on the host`] : [];
    if (!opts.run) {
      console.log([`${name}: ${expected.length} journeys in .agents/skills/verify-uvw/features/${name}.md`,
        ...expected.map((j) => row(j.id, `${j.title}${j.hostOnly ? ' (host only)' : ''}`)), ...hostLine].join('\n'));
      return;
    }
    const evidenceRoot = where === 'runner' && process.env.VERIFY_UVW_EVIDENCE_ROOT;
    const { journeys, result } = fold(expected, evidenceRoot ? readRuns(evidenceRoot) : readJournal(journalFile(opts.run)));
    const done = journeys.filter((j) => j.verdict !== 'MISSING').length;
    console.log([`${name} in run ${basename(opts.run)}: ${done} of ${journeys.length} journeys have a verdict`,
      ...journeys.map((j) => row(j.id, `${j.verdict.padEnd(7)}  ${j.note.replace(/\s+/g, ' ')}`)), ...hostLine, `RESULT: ${result}`].join('\n'));
    if (result === 'INCOMPLETE') process.exitCode = 1;
  } else if (command === 'brief') {
    const [name, ...ids] = args;
    if (!name || !opts.repo || !opts.root || !opts['run-id']) die('usage: verify-uvw brief [--own <run-id>] <feature> [journey-id...]', 2);
    const p = planned(named(name), ids, opts.own ? 'runner' : 'host');
    if (!p.partitions.length) die(`${ids.length ? `${ids.join(', ')} in ${name} run` : `${name} runs`} only on the host`, 3);
    process.stdout.write(brief({ own: opts.own, repo: opts.repo, root: opts.root, runId: opts['run-id'], feature: name, ids, plan: p }));
  } else {
    die('usage: journeys.mjs list|verdict|brief ...', 2);
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
