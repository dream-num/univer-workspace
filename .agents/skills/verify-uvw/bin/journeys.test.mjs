import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { NEEDS, allowed, fold, loadFeatures, parseFeature, plan, readJournal } from './journeys.mjs';

const helper = fileURLToPath(new URL('./verify-uvw', import.meta.url));
const drive = '## Driving it with agent-browser and uvw';
const recipe = (journeys, h1 = '# Feature') =>
  `${h1}\n\nWhat it does.\n\n## Sub-features\n\n### Not a journey\n\n${drive}\n\nSetup.\n\n\`\`\`bash\n### a comment in a block\n\`\`\`\n\n${journeys}\n\n## Gotchas\n\n### Not one either\n`;
const ids = (journeys) => journeys.map((j) => j.id);

test('every feature file parses into journeys whose ids are unique across features', () => {
  const features = loadFeatures();
  assert.ok(features.size >= 23, `${features.size} features`);
  const all = [...features.values()].flatMap((f) => f.journeys);
  assert.equal(new Set(ids(all)).size, all.length);
  for (const f of features.values()) assert.ok(f.journeys.length, `${f.name} has journeys`);
  const sheet = plan(features.get('sheet-lens'));
  assert.deepEqual(sheet.partitions.map((p) => [p.mode, ids(p.journeys)]), [
    ['default', [...Array(10)].map((_, k) => `SLC${k + 1}`)],
    ['mcp', ['SLM1', 'SLM2', 'SLM3', 'SLM4', 'SLM5', 'SLM6', 'SLM7', 'SLM9', 'SLM10']],
    ['mcp-same-origin', ['SLM8']]], 'sheet-lens gives its MCP half instances of their own');
  const declared = (name) => Object.fromEntries(plan(features.get(name)).partitions.map((p) => [p.mode, [ids(p.journeys).join(' '), p.needs.join(' ')]]));
  assert.deepEqual(declared('pull-requests'), { default: ['PR1 PR2 PR3', ''], mcp: ['PR4 PR5 PR6 PR7 PR8 PR9 PR10', ''] }, 'one mode holds the chain of shared state');
  assert.deepEqual(declared('link-sharing').default[1], 'web-build');
  assert.deepEqual(Object.keys(declared('agent-trajectory')), ['mcp-same-origin']);
});

test('only ### headings under Driving it are journeys, with their title', () => {
  const feature = parseFeature('f', recipe('### A1. First\n\ntext\n\n### A2. Second\n\n### TR2-10. Third'));
  assert.deepEqual(feature.journeys, [
    { id: 'A1', title: 'First', feature: 'f', line: 17, mode: 'default', needs: [], runBy: 'agent', blocks: [] },
    { id: 'A2', title: 'Second', feature: 'f', line: 21, mode: 'default', needs: [], runBy: 'agent', blocks: [] },
    { id: 'TR2-10', title: 'Third', feature: 'f', line: 23, mode: 'default', needs: [], runBy: 'agent', blocks: [] },
  ]);
  assert.throws(() => parseFeature('f', `Feature\n\n${drive}\n\n### A1. First\n`), /^Error: features\/f\.md:1: a feature starts with an H1$/);
});

test('a malformed journey heading, a recipe without journeys, or a reused id fails with file and line', () => {
  for (const heading of ['### MR9 renderer role', '### Typst job verification', '### ms5. Labels', '### MS5.Labels']) {
    assert.throws(() => parseFeature('bad', recipe(`### A1. First\n\n${heading}`)), (e) => e.message.startsWith('features/bad.md:19: '), heading);
  }
  assert.throws(() => parseFeature('empty', recipe('No journeys here.')), /^Error: features\/empty\.md:1: no "### <ID>\. <Title>" journey/);
  const dir = mkdtempSync(join(tmpdir(), 'verify-uvw-journeys-'));
  try {
    writeFileSync(join(dir, 'a.md'), recipe('### X1. One'));
    writeFileSync(join(dir, 'b.md'), recipe('### X2. Two\n\n### X1. Again'));
    writeFileSync(join(dir, 'README.md'), '# Not a feature\n');
    assert.throws(() => loadFeatures(dir), /^Error: features\/b\.md:19: X1 is already the journey at features\/a\.md:17$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a plan selects journeys in file order and refuses unknown ids', () => {
  const feature = parseFeature('f', recipe('### A1. One\n\n### A2. Two\n\n### A3. Three'));
  assert.deepEqual(ids(plan(feature).partitions[0].journeys), ['A1', 'A2', 'A3']);
  assert.deepEqual(ids(plan(feature, ['A3', 'A1']).partitions[0].journeys), ['A1', 'A3']);
  assert.throws(() => plan(feature, ['A4']), /no journey or mode A4 in features\/f\.md; it has A1, A2, A3 in default$/);
});

test('the metadata line under Driving it sets every journey\'s mode, and one under a journey overrides it and adds needs', () => {
  const feature = parseFeature('f', `# F\n\n${drive}\n\nMode: mcp.\n\nSetup.\n\n### A1. One\n\n### A2. Two\n\nNeeds: web-build. Mode: default.\n\nText.\n\n### A3. Three\n\nNeeds: web-build.\n\n\`\`\`bash\nMode: not metadata in a block.\n\`\`\`\n`);
  assert.deepEqual(feature.journeys.map((j) => [j.id, j.mode, j.needs]), [['A1', 'mcp', []], ['A2', 'default', ['web-build']], ['A3', 'mcp', ['web-build']]]);
  const both = parseFeature('f', `# F\n\n${drive}\n\nNeeds: web-build.\n\n### A1. One\n\nNeeds: web-build.\n`);
  assert.deepEqual(both.journeys[0].needs, ['web-build'], 'needs from both scopes add up once');
});

test('a misplaced, malformed or unknown metadata line fails with file and line', () => {
  const misplaced = /^features\/bad\.md:(\d+): a "Mode:", "Needs:" or "Run:" line is the first paragraph under "## Driving it with agent-browser and uvw" or under a journey heading$/;
  for (const [journeys, line] of [
    ['### A1. One\n\nText.\n\nMode: mcp.', 21], // after the journey's first paragraph
    ['### A1. One\n\nMode: mcp.\nNeeds: web-build.', 20], // the second line of the metadata paragraph
    ['### A1. One\n\n```bash\nx\n```\n\nMode: mcp.', 23], // after a block
    ['Mode: mcp.\n\n### A1. One', 17], // after the setup text
  ]) {
    assert.throws(() => parseFeature('bad', recipe(journeys)), (e) => misplaced.test(e.message) && e.message.includes(`bad.md:${line}:`), journeys);
  }
  assert.throws(() => parseFeature('bad', `# F\n\nMode: mcp.\n\n${drive}\n\n### A1. One\n`), /bad\.md:3: a "Mode:"/);
  assert.throws(() => parseFeature('bad', recipe('### A1. One').replace('### Not one either', '### Not one either\n\nMode: mcp.')), /bad\.md:23: a "Mode:"/);
  for (const [meta, why] of [['Mode: docker.', /unknown mode docker; use default, mcp, mcp-same-origin$/], ['Needs: opencode.', /unknown need opencode; use web-build$/],
    ['Mode: mcp, default.', /Mode takes one value/], ['Mode: mcp. Mode: default.', /Mode appears twice/], ['Run: helper, agent.', /Run takes one value/],
    ['Run: model.', /unknown runner model; use helper, agent$/],
    ['Mode: mcp', /write metadata as "Mode: <mode>\.", "Needs: <need>, <need>\." and "Run: helper\|agent\."/], ['Mode: mcp. Runs: helper.', /write metadata as/]]) {
    assert.throws(() => parseFeature('bad', recipe(`### A1. One\n\n${meta}`)), (e) => e.message.startsWith('features/bad.md:19: ') && why.test(e.message), meta);
  }
});

test('a plan has one partition per mode in file order, takes mode names as selectors, and names each partition\'s selectors', () => {
  const feature = parseFeature('f', recipe(['### A1. One', '### A2. Two\n\nMode: mcp.', '### A3. Three\n\nMode: mcp.', '### A4. Four',
    '### A5. Five\n\nMode: mcp-same-origin. Needs: web-build.'].join('\n\n')));
  const parts = (p) => p.partitions.map((q) => [q.mode, ids(q.journeys), q.needs, q.selectors]);
  assert.deepEqual(parts(plan(feature)), [['default', ['A1', 'A4'], [], ['default']], ['mcp', ['A2', 'A3'], [], ['mcp']],
    ['mcp-same-origin', ['A5'], ['web-build'], ['mcp-same-origin']]]);
  assert.deepEqual(parts(plan(feature, ['mcp'])), [['mcp', ['A2', 'A3'], [], ['mcp']]]);
  assert.deepEqual(parts(plan(feature, ['A4', 'A1'])), [['default', ['A1', 'A4'], [], ['A1', 'A4']]]);
  assert.deepEqual(parts(plan(feature, ['A4', 'mcp-same-origin'])), [['default', ['A4'], [], ['A4']], ['mcp-same-origin', ['A5'], ['web-build'], ['A5']]]);
  assert.deepEqual(parts(plan(parseFeature('g', recipe('### B1. One')))), [['default', ['B1'], [], []]], 'a whole one-mode feature needs no selector');
  assert.throws(() => plan(feature, ['mpc']), /no journey or mode mpc in features\/f\.md; it has A1, A2, A3, A4, A5 in default, mcp, mcp-same-origin$/);
});

test('web-build is ready only when the web build exists and nothing under apps/workspace/web is newer', () => {
  const repo = mkdtempSync(join(tmpdir(), 'verify-uvw-needs-'));
  const at = (path, seconds) => { mkdirSync(join(repo, path, '..'), { recursive: true }); writeFileSync(join(repo, path), ''); utimesSync(join(repo, path), seconds, seconds); };
  try {
    at('apps/workspace/web/src/main.tsx', 1000);
    assert.equal(NEEDS['web-build'].ready(repo), 'apps/workspace/dist/public is not built');
    at('apps/workspace/dist/public/index.html', 2000);
    assert.equal(NEEDS['web-build'].ready(repo), null);
    at('apps/workspace/web/src/edited.tsx', 3000);
    assert.equal(NEEDS['web-build'].ready(repo), 'apps/workspace/web/src/edited.tsx is newer than apps/workspace/dist/public');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('a verdict is one of four, and every verdict but PASS needs a note', () => {
  assert.equal(allowed('PASS', ''), null);
  assert.equal(allowed('FAIL', 'MS5 description is ""'), null);
  for (const verdict of ['FAIL', 'DRIFT', 'BLOCKED']) assert.match(allowed(verdict, '  '), /needs a note/);
  for (const verdict of ['pass', 'SKIP', 'MISSING', undefined]) assert.match(allowed(verdict, 'x'), /one of PASS, FAIL, DRIFT, BLOCKED/);
});

test('fold: a journey without an allowed verdict is MISSING and makes the result INCOMPLETE; the last verdict wins', () => {
  const expected = [{ id: 'A1' }, { id: 'A2' }, { id: 'A3' }];
  const v = (journey, verdict, note = '') => ({ kind: 'verdict', journey, verdict, note });
  assert.deepEqual(fold(expected, []), { result: 'INCOMPLETE', checks: null, journeys: expected.map(({ id }) => ({ id, verdict: 'MISSING', note: '', checks: null, failure: '' })) });

  const partial = fold(expected, [v('A1', 'PASS'), v('A2', 'PASS'), v('B9', 'PASS')]);
  assert.equal(partial.result, 'INCOMPLETE', 'a verdict for another journey covers nothing');
  assert.deepEqual(partial.journeys.map((j) => j.verdict), ['PASS', 'PASS', 'MISSING']);

  const all = [v('A1', 'FAIL', 'first look'), v('A2', 'PASS'), v('A3', 'PASS'), v('A1', 'PASS')];
  assert.equal(fold(expected, all).result, 'PASS', 'a later PASS replaces an earlier FAIL');
  const issues = fold(expected, [...all, v('A3', 'DRIFT', 'recipe says 43 tools, product lists 47')]);
  assert.equal(issues.result, 'ISSUES');
  assert.deepEqual(issues.journeys[2], { id: 'A3', verdict: 'DRIFT', note: 'recipe says 43 tools, product lists 47', checks: null, failure: '' });

  const forged = fold(expected, [...all, v('A2', 'BLOCKED')]);
  assert.deepEqual([forged.journeys[1].verdict, forged.result], ['MISSING', 'INCOMPLETE'], 'a journal line the command would refuse counts as no verdict');
});

test('$V verdict records only known journeys and allowed verdicts, and $V journeys prints the plan, then the coverage', () => {
  const root = mkdtempSync(join(tmpdir(), 'verify-uvw-verdict-'));
  const env = { ...process.env, VERIFY_UVW_ROOT: root, VERIFY_UVW_RUN: 'test' };
  const v = (...args) => spawnSync('bash', [helper, ...args], { env, encoding: 'utf8' });
  const journal = join(root, 'test/evidence/journeys.jsonl');
  try {
    const before = v('journeys', 'issues');
    assert.equal(before.status, 0, before.stderr);
    assert.match(before.stdout, /^issues: 5 journeys in \.agents\/skills\/verify-uvw\/features\/issues\.md\ndefault: \$V up --for issues\n {2}IS1 {2}Create repo\n/);
    assert.notEqual(v('journeys', 'issues', 'IS9').status, 0);

    mkdirSync(join(root, 'test/evidence'), { recursive: true });
    writeFileSync(join(root, 'test/run.env'), 'RUN_ID=test\nWEB_PORT=1\n');
    for (const [args, why] of [[['IS9', 'PASS'], /no journey IS9/], [['IS1', 'SKIP'], /one of PASS, FAIL, DRIFT, BLOCKED/],
      [['IS1', 'FAIL'], /FAIL needs a note/], [['IS1', 'BLOCKED', ' '], /BLOCKED needs a note/], [['IS1'], /usage/]]) {
      const refused = v('verdict', ...args);
      assert.notEqual(refused.status, 0, args.join(' '));
      assert.match(refused.stderr, why);
    }
    assert.ok(!existsSync(journal), 'a refused verdict writes nothing');

    assert.equal(v('verdict', 'IS1', 'PASS').status, 0);
    const recorded = v('verdict', 'IS2', 'FAIL', 'number', 'is', '2');
    assert.equal(recorded.status, 0, recorded.stderr);
    assert.equal(recorded.stdout, `recorded IS2 FAIL in ${journal}\n`);
    const partial = v('journeys', 'issues');
    assert.equal(partial.status, 1, 'INCOMPLETE exits 1');
    assert.match(partial.stdout, /^issues in run test: 2 of 5 journeys have a verdict$/m);
    assert.match(partial.stdout, /^IS2 {2}FAIL {5}number is 2$/m);
    assert.match(partial.stdout, /^IS3 {2}MISSING$/m);
    assert.match(partial.stdout, /RESULT: INCOMPLETE\n$/);
    assert.match(v('journeys', 'issues', 'IS1').stdout, /RESULT: PASS\n$/, 'coverage follows the selected journeys');

    for (const id of ['IS3', 'IS4', 'IS5']) assert.equal(v('verdict', id, 'PASS').status, 0);
    const complete = v('journeys', 'issues');
    assert.equal(complete.status, 0);
    assert.match(complete.stdout, /RESULT: ISSUES\n$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('$V journeys prints each mode with its up --for line; up --for and brief take one mode, and brief only the running one', () => {
  const repo = mkdtempSync(join(tmpdir(), 'verify-uvw-modes-'));
  const skill = join(repo, '.agents/skills/verify-uvw');
  const root = join(repo, 'runs');
  mkdirSync(join(skill, 'bin'), { recursive: true });
  mkdirSync(join(skill, 'features'));
  for (const file of ['verify-uvw', 'journeys.mjs', 'secrets.mjs']) copyFileSync(fileURLToPath(new URL(file, import.meta.url)), join(skill, 'bin', file));
  writeFileSync(join(skill, 'features/f.md'), recipe(['### A1. One', '### A2. Two\n\nMode: mcp.', '### A3. Three\n\nMode: mcp-same-origin. Needs: web-build.', '### A4. Four\n\nMode: mcp.'].join('\n\n')));
  const env = { ...process.env, VERIFY_UVW_ROOT: root, VERIFY_UVW_RUN: 't' };
  const v = (...args) => spawnSync('bash', [join(skill, 'bin/verify-uvw'), ...args], { env, encoding: 'utf8' });
  try {
    assert.equal(v('journeys', 'f').stdout, ['f: 4 journeys in .agents/skills/verify-uvw/features/f.md',
      'default: $V up --for f default', '  A1  One',
      'mcp: $V up --for f mcp', '  A2  Two', '  A4  Four',
      'mcp-same-origin, needs web-build: $V up --for f mcp-same-origin', '  A3  Three', ''].join('\n'));
    assert.match(v('journeys', 'f', 'A4', 'A1').stdout, /^default: \$V up --for f A1\n {2}A1 {2}One\nmcp: \$V up --for f A4\n/m);

    const spans = v('up', '--for', 'f', 'A1', 'A2');
    assert.equal(spans.status, 2);
    assert.equal(spans.stderr, 'verify-uvw: f A1 A2 spans 2 modes, and one instance runs one. Start for each:\n  $V up --for f A1\n  $V up --for f A2\n');
    assert.ok(!existsSync(root), 'a refused up starts nothing');
    const unbuilt = v('up', '--for', 'f', 'A3');
    assert.equal(unbuilt.status, 1);
    assert.match(unbuilt.stderr, /^verify-uvw: these journeys need web-build, and apps\/workspace\/dist\/public is not built; run: pnpm --filter '@univerjs\/univer-workspace\^\.\.\.' build && pnpm --filter @univerjs\/univer-workspace build:web\n$/);
    assert.match(v('up', '--for', 'f', 'mcp').stderr, /node_modules is older than pnpm-lock\.yaml/, 'one mode with its needs met goes on to start the instance');
    assert.match(v('up', '--for').stderr, /usage: verify-uvw up \[--reuse\] \[--for <feature>/);
    assert.match(v('up', '--for', 'g').stderr, /no \.agents\/skills\/verify-uvw\/features\/g\.md/);

    mkdirSync(join(root, 't'), { recursive: true });
    writeFileSync(join(root, 't/run.env'), 'RUN_ID=t\nWEB_PORT=1\nMCP_ENABLED=1\nMCP_SAME_ORIGIN=0\n');
    const wrong = v('brief', 'f', 'A1');
    assert.equal(wrong.status, 1);
    assert.equal(wrong.stderr, 'verify-uvw: run t runs in the mcp mode, and these journeys declare default; run `$V down`, then `$V up --for f A1`\n');
    const right = v('brief', 'f', 'mcp');
    assert.equal(right.status, 0, right.stderr);
    assert.match(right.stdout, /^Run t is already running in the `mcp` mode that these journeys declare/m);
    assert.match(right.stdout, /with these IDs: A2, A4\. Each needs a verdict\./);
    assert.match(right.stdout, /Run `\$V journeys f mcp`\./);
    assert.equal(v('brief', 'f').status, 2, 'a brief spanning modes is refused');
    const own = v('brief', '--own', 'f-mcp-same-origin', 'f', 'mcp-same-origin');
    assert.match(own.stdout, /^Run f-mcp-same-origin is already running in the `mcp-same-origin` mode/m, 'the runner brief needs no running instance yet');
    assert.match(own.stdout, /with these IDs: A3\. Each needs a verdict\./);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// A repository with this skill's helper and one feature, and a run whose `$V env` works without a server.
function helperRepo(features) {
  const repo = mkdtempSync(join(tmpdir(), 'verify-uvw-run-'));
  const skill = join(repo, '.agents/skills/verify-uvw');
  mkdirSync(join(skill, 'bin'), { recursive: true });
  mkdirSync(join(skill, 'features'));
  for (const file of ['verify-uvw', 'journeys.mjs', 'secrets.mjs', 'journey-prelude.sh']) copyFileSync(fileURLToPath(new URL(file, import.meta.url)), join(skill, 'bin', file));
  chmodSync(join(skill, 'bin/verify-uvw'), 0o755);
  for (const [name, text] of Object.entries(features)) writeFileSync(join(skill, 'features', `${name}.md`), text);
  const run = join(repo, 'runs/t');
  mkdirSync(join(run, 'evidence'), { recursive: true });
  writeFileSync(join(run, 'run.env'), 'RUN_ID=t\nWEB_PORT=1\n');
  writeFileSync(join(run, 'user.pw'), 'pw-5f0c1e2d3b4a');
  const env = { ...process.env, VERIFY_UVW_ROOT: join(repo, 'runs'), VERIFY_UVW_RUN: 't' };
  const v = (...args) => spawnSync('bash', [join(skill, 'bin/verify-uvw'), ...args], { env, encoding: 'utf8' });
  const checks = () => readJournal(join(run, 'evidence/journeys.jsonl')).filter((e) => e.kind === 'checks');
  return { repo, run, v, checks, done: () => rmSync(repo, { recursive: true, force: true }) };
}
const feature = (...parts) => ['# F', '', 'What it does.', '', drive, '', ...parts, '', '## Gotchas', ''].join('\n');
const bash = (...lines) => ['```bash', ...lines, '```'];
const lineOf = (text, code, after) => {
  const lines = text.split('\n'), from = lines.indexOf(after);
  return `features/f.md:${lines.findIndex((l, i) => i > from && l === code) + 1}`;
};

const semantics = feature('Run: helper.', '',
  ...bash('SEED=seeded', 'ids() { echo "id-$1"; }'), '',
  '### A1. What holds', '', ...bash(
    `printf '{"a":1}\\n' > "$EVIDENCE/a.json"`,
    `jq -e '.a == 1' "$EVIDENCE/a.json"`,
    `jq -e '.a == 2' "$EVIDENCE/a.json"`,
    'test $? -eq 1',
    "sh -c 'exit 3'",
    'rc=$?',
    'if false; then :; fi',
    'false || true',
    'false | cat',
    'jq -s length',
    'cat',
    'read -r line',
    'test $? -eq 1',
    'T=$(ids 7)'), '',
  '### A2. What breaks', '', ...bash(
    `jq -e '.a == 2' "$EVIDENCE/a.json"`,
    'diff <(echo one) <(echo two)',
    'check() {',
    '  echo in check',
    '  test "$1" = yes',
    '}',
    'check no',
    'echo ok | grep -q nope',
    "sh -c 'exit 2'",
    'test $? -eq 1',
    'jq -e \\',
    `  '.a == 2' \\`,
    '  "$EVIDENCE/a.json"'), '',
  '### A3. Driven by the agent', '', 'Run: agent.', '', ...bash('false'), '',
  '### A4. Carried state', '', ...bash('test "$SEED $T" = "seeded id-7"'));

test('run-journeys: a failing command is a broken check unless a condition holds it or the next command reads $?', () => {
  const { run, v, checks, done } = helperRepo({ f: semantics });
  try {
    const started = Date.now();
    const ran = v('run-journeys', 'f');
    assert.ok(Date.now() - started < 20_000, 'commands that read stdin get end of file at once');
    assert.equal(ran.status, 1, ran.stderr);
    const [setup, a1, a2, a4] = checks();
    assert.deepEqual([setup.journey, setup.outcome, a1.journey, a1.outcome, a1.failures], ['setup', 'held', 'A1', 'held', []]);
    assert.deepEqual([a2.journey, a2.outcome, a4.journey, a4.outcome], ['A2', 'broke', 'A4', 'held'], 'the agent journey A3 is not the helper\'s');
    const at = (code) => lineOf(semantics, code, '### A2. What breaks');
    assert.deepEqual(a2.failures.map((f) => [f.line, f.exit]), [
      [at(`jq -e '.a == 2' "$EVIDENCE/a.json"`), 1],
      [at('diff <(echo one) <(echo two)'), 1],
      [at('  test "$1" = yes'), 1],
      [at('echo ok | grep -q nope'), 1],
      [at('test $? -eq 1'), 1],
      [at('jq -e \\'), 1],
    ], 'one failure each: a function returning its failure, and a command spanning lines, count once at their own line');
    assert.match(a2.failures[0].command, /^jq -e '\.a == 2' "\$EVIDENCE\/a\.json"$/, 'the command as the recipe wrote it, unexpanded');
    assert.match(a2.failures[1].tail, /< one\n.*---\n.*> two/s, 'the tail is the output before the check broke');
    assert.equal(a2.log, 'evidence/A2.run.log');
    assert.match(readFileSync(join(run, a2.log), 'utf8'), /in check/);
    assert.match(ran.stdout, /^A2 +broke +\d+ s$/m);
    assert.ok(ran.stdout.includes(`  ${at('diff <(echo one) <(echo two)')}  exit 1\n    diff <(echo one) <(echo two)\n`));
  } finally { done(); }
});

test('run-journeys carries state, first runs the earlier journeys that have not run, and runs a recorded journey again only with --again', () => {
  const { run, v, checks, done } = helperRepo({ f: semantics });
  try {
    const first = v('run-journeys', 'f', 'A4');
    assert.equal(first.status, 0, first.stderr);
    assert.deepEqual(checks().map((e) => [e.journey, e.outcome]), [['setup', 'held'], ['A1', 'held'], ['A2', 'broke'], ['A4', 'held']]);
    assert.match(first.stdout, /^A1 +held +\d+ s +ran first: a later journey needs it$/m);
    assert.ok(existsSync(join(run, 'journeys/state.sh')) && !existsSync(join(run, 'evidence/state.sh')), 'recipe state stays out of evidence');

    const again = v('run-journeys', 'f', 'A4');
    assert.equal(checks().length, 4, 'a recorded journey does not run again');
    assert.match(again.stdout, /^A4 +held +\d+ s +recorded \d{4}-/m);
    assert.equal(v('run-journeys', '--again', 'f', 'A4').status, 0);
    assert.deepEqual(checks().map((e) => e.journey), ['setup', 'A1', 'A2', 'A4', 'A4'], '--again reruns only the named journey, on the carried state');
    assert.match(v('run-journeys', 'f', 'A3').stdout, /^A3: the agent follows its text/m);
  } finally { done(); }
});

test('a broken setup blocks every journey, a timeout blocks one, and a failure tail is redacted and short', () => {
  const broken = helperRepo({ f: feature('Run: helper.', '', ...bash('false'), '', '### A1. One', '', ...bash('true')) });
  try {
    assert.equal(broken.v('run-journeys', 'f').status, 1);
    const [setup, a1] = broken.checks();
    assert.deepEqual([setup.outcome, a1.outcome, a1.reason], ['broke', 'blocked', 'the setup broke at features/f.md:10, so it did not run']);
  } finally { broken.done(); }

  const loud = helperRepo({ f: feature('### A1. Loud', '', 'Run: helper.', '', ...bash(
    'echo "token uvw_pat_0123456789abcdef and $(cat "$RUN/user.pw")"', 'seq 1 3000', 'false')) });
  try {
    loud.v('run-journeys', 'f');
    const [a1] = loud.checks();
    assert.equal(a1.outcome, 'broke');
    const journal = readFileSync(join(loud.run, 'evidence/journeys.jsonl'), 'utf8');
    assert.ok(!journal.includes('uvw_pat_0123') && !journal.includes('pw-5f0c1e2d3b4a'), 'no token or run secret reaches the journal');
    assert.ok(a1.failures[0].tail.length <= 1501 && a1.failures[0].tail.endsWith('3000'), 'the tail keeps the last lines');
    const short = helperRepo({ f: feature('### A1. Loud', '', 'Run: helper.', '', ...bash('echo "uvw_pat_0123456789abcdef $(cat "$RUN/user.pw")"', 'false')) });
    try {
      short.v('run-journeys', 'f');
      assert.equal(short.checks()[0].failures[0].tail, '[REDACTED] [REDACTED]');
    } finally { short.done(); }
  } finally { loud.done(); }
});

test('a timed-out journey is blocked at the line where it stopped', async () => {
  const { runJourneys, parseFeature: parse } = await import('./journeys.mjs');
  const text = feature('### A1. Slow', '', 'Run: helper.', '', ...bash('echo start', 'sleep 30', 'echo never'));
  const { repo, run, done } = helperRepo({ f: text });
  const saved = { ...process.env };
  Object.assign(process.env, { VERIFY_UVW_ROOT: join(repo, 'runs'), VERIFY_UVW_RUN: 't' });
  try {
    const lines = [];
    const { ok, entries } = await runJourneys({ run, feature: parse('f', text), mode: 'default', ids: ['A1'], timeoutSeconds: 1, repo, print: (l) => lines.push(l) });
    assert.equal(ok, false);
    assert.deepEqual([entries[0].outcome, entries[0].reason], ['blocked', `timed out after 1 s at ${lineOf(text, 'sleep 30', '### A1. Slow')}`]);
    assert.match(lines.join('\n'), /^A1 +blocked +\d+ s\n {2}timed out after 1 s/);
  } finally {
    process.env = saved;
    done();
  }
});

test('the helper refuses PASS over checks that broke or did not run, and fold reports the checks', () => {
  for (const checks of ['broke', 'blocked']) assert.match(allowed('PASS', '', checks), new RegExp(`its checks ${checks}; record FAIL, DRIFT or BLOCKED`));
  assert.match(allowed('PASS', '', 'none'), /its checks have not run/);
  assert.equal(allowed('PASS', '', 'held'), null);
  for (const verdict of ['FAIL', 'DRIFT', 'BLOCKED']) assert.equal(allowed(verdict, 'what I saw', 'broke'), null, `${verdict} lowers a broken check`);

  const expected = [{ id: 'H1', runBy: 'helper' }, { id: 'H2', runBy: 'helper' }, { id: 'H3', runBy: 'helper' }, { id: 'G1', runBy: 'agent' }];
  const v = (journey, verdict, note = '') => ({ kind: 'verdict', journey, verdict, note });
  const c = (journey, outcome, failures = [], reason = null) => ({ kind: 'checks', journey, outcome, failures, reason });
  const failure = { line: 'features/f.md:9', exit: 1, command: "jq -e '.ok' x.json", tail: 'false' };
  const folded = fold(expected, [c('H1', 'held'), c('H2', 'broke', [failure, failure]), v('H1', 'PASS'), v('H2', 'PASS'), v('H3', 'PASS'), v('G1', 'PASS')]);
  assert.deepEqual(folded.journeys.map((j) => [j.id, j.verdict, j.checks, j.failure]), [
    ['H1', 'PASS', 'held', ''], ['H2', 'MISSING', 'broke', "features/f.md:9 exit 1: jq -e '.ok' x.json (and 1 more)"],
    ['H3', 'MISSING', 'none', ''], ['G1', 'PASS', null, '']]);
  assert.deepEqual([folded.result, folded.checks], ['INCOMPLETE', 'BROKE'], 'a forged PASS over a broken check counts as no verdict');
  const lowered = fold(expected, [c('H1', 'held'), c('H2', 'broke', [failure]), c('H3', 'blocked', [], 'timed out after 600 s at features/f.md:20'),
    v('H1', 'PASS'), v('H2', 'FAIL', 'x.json has ok: false'), v('H3', 'BLOCKED', 'renderer never answered'), v('G1', 'PASS')]);
  assert.deepEqual([lowered.result, lowered.checks, lowered.journeys[2].failure], ['ISSUES', 'BROKE', 'timed out after 600 s at features/f.md:20']);
  assert.equal(fold(expected.slice(0, 1), [c('H1', 'held'), v('H1', 'PASS')]).checks, 'HELD');
  assert.equal(fold(expected.slice(3), [v('G1', 'PASS')]).checks, null, 'no helper journey, no checks');
});

test('$V verdict refuses PASS for a helper journey whose checks broke or did not run, and $V journeys shows the checks', () => {
  const { v, done } = helperRepo({ f: semantics });
  try {
    const unrun = v('verdict', 'A1', 'PASS');
    assert.equal(unrun.status, 1);
    assert.match(unrun.stderr, /^verify-uvw: A1: its checks have not run/);
    assert.equal(v('run-journeys', 'f').status, 1);
    assert.match(v('verdict', 'A2', 'PASS').stderr, /^verify-uvw: A2: its checks broke; record FAIL, DRIFT or BLOCKED with what you saw$/m);
    for (const [id, verdict, note] of [['A1', 'PASS'], ['A2', 'FAIL', 'a.json has a: 1'], ['A3', 'PASS'], ['A4', 'PASS']]) assert.equal(v('verdict', id, verdict, ...(note ? [note] : [])).status, 0);
    const listed = v('journeys', 'f');
    assert.match(listed.stdout, /^A1 {2}PASS {5}checks held$/m);
    assert.match(listed.stdout, /^A2 {2}FAIL {5}a\.json has a: 1; checks broke: features\/f\.md:\d+ exit 1: jq -e '\.a == 2' "\$EVIDENCE\/a\.json" \(and 5 more\)$/m);
    assert.match(listed.stdout, /^A3 {2}PASS$/m);
    assert.match(listed.stdout, /CHECKS: BROKE\nRESULT: ISSUES\n$/);
    assert.match(v('journeys', 'f').stdout, /RESULT: ISSUES/);
  } finally { done(); }
});

test('a helper journey cannot check with "!", "[[ ]]", "(( ))" or a subshell, which some bash does not trap', () => {
  for (const code of ['! grep -q x f', '[[ -s f ]]', '(( n > 1 ))', '(cd dir && make)']) {
    assert.throws(() => parseFeature('bad', feature('### A1. One', '', 'Run: helper.', '', ...bash('true', code))), (e) => e.message.startsWith('features/bad.md:13: the helper cannot check with'), code);
    assert.equal(parseFeature('ok', feature('### A1. One', '', ...bash(code))).journeys[0].runBy, 'agent', 'an agent journey may');
  }
  const blocks = parseFeature('f', semantics);
  assert.deepEqual(blocks.setup, [{ line: 10, text: 'SEED=seeded\nids() { echo "id-$1"; }' }]);
  assert.deepEqual(blocks.journeys.map((j) => [j.id, j.runBy, j.blocks.length]), [['A1', 'helper', 1], ['A2', 'helper', 1], ['A3', 'agent', 1], ['A4', 'helper', 1]]);
});

test('a brief tells the verifier which journeys the helper ran, to judge their checks, and how to drive the rest', () => {
  const { v, done } = helperRepo({ f: semantics, g: feature('### B1. One', '', ...bash('true')) });
  try {
    const mixed = v('brief', 'f');
    assert.equal(mixed.status, 0, mixed.stderr);
    assert.match(mixed.stdout, /^2\. Read \.agents\/skills\/verify-uvw\/features\/f\.md\. The helper already ran its setup, the text before its first journey, and the code blocks of A1, A2, A4, each exactly as written, and recorded every check that broke\. Do not run or retype those commands\./m);
    assert.match(mixed.stdout, /Run A3 yourself in file order, each command as written, and start each of their shells with `\. "\$RUN\/journeys\/state\.sh"` after the line above/);
    assert.match(mixed.stdout, /The helper refuses PASS when a check broke or did not run/);
    const plain = v('brief', 'g');
    assert.match(plain.stdout, /^2\. Follow \.agents\/skills\/verify-uvw\/features\/g\.md\. Do its setup, the text before its first journey, then run your journeys in file order, each command as written\.$/m, 'a recipe the agent drives keeps its brief');
    assert.doesNotMatch(plain.stdout, /helper/);
  } finally { done(); }
});
