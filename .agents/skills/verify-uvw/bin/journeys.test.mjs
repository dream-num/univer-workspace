import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { NEEDS, allowed, fold, loadFeatures, parseFeature, plan } from './journeys.mjs';

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
  // The drill's silent skip: a runner task for sheet-lens expects its MCP half, all but the base comparison.
  const sheet = plan(features.get('sheet-lens'), [], { where: 'runner' });
  assert.deepEqual(ids(sheet.partitions[0].journeys), [...Array(10)].map((_, k) => `SLC${k + 1}`).concat([...Array(9)].map((_, k) => `SLM${k + 2}`)));
  assert.deepEqual(ids(sheet.host), ['SLM1']);
});

test('only ### headings under Driving it are journeys, with their title and (host only) mark', () => {
  const feature = parseFeature('f', recipe('### A1. First\n\ntext\n\n### A2. Second (host only)\n\n### TR2-10. Third'));
  assert.deepEqual(feature.journeys, [
    { id: 'A1', title: 'First', feature: 'f', line: 17, hostOnly: false, mode: 'default', needs: [] },
    { id: 'A2', title: 'Second', feature: 'f', line: 21, hostOnly: true, mode: 'default', needs: [] },
    { id: 'TR2-10', title: 'Third', feature: 'f', line: 23, hostOnly: false, mode: 'default', needs: [] },
  ]);
  assert.ok(parseFeature('f', recipe('### A1. First', '# Feature (host only)')).journeys.every((j) => j.hostOnly));
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

test('a plan selects journeys in file order, refuses unknown ids, and keeps host-only journeys out of the runner', () => {
  const feature = parseFeature('f', recipe('### A1. One\n\n### A2. Two (host only)\n\n### A3. Three'));
  assert.deepEqual(ids(plan(feature).partitions[0].journeys), ['A1', 'A2', 'A3']);
  assert.deepEqual(ids(plan(feature, ['A3', 'A1']).partitions[0].journeys), ['A1', 'A3']);
  const runner = plan(feature, [], { where: 'runner' });
  assert.deepEqual([ids(runner.partitions[0].journeys), ids(runner.host)], [['A1', 'A3'], ['A2']]);
  assert.deepEqual(plan(feature, ['A2'], { where: 'runner' }).partitions, []);
  assert.throws(() => plan(feature, ['A4']), /no journey or mode A4 in features\/f\.md; it has A1, A2, A3 in default$/);
});

test('the metadata line under Driving it sets every journey\'s mode, and one under a journey overrides it and adds needs', () => {
  const feature = parseFeature('f', `# F\n\n${drive}\n\nMode: mcp.\n\nSetup.\n\n### A1. One\n\n### A2. Two\n\nNeeds: web-build. Mode: default.\n\nText.\n\n### A3. Three\n\nNeeds: web-build.\n\n\`\`\`bash\nMode: not metadata in a block.\n\`\`\`\n`);
  assert.deepEqual(feature.journeys.map((j) => [j.id, j.mode, j.needs]), [['A1', 'mcp', []], ['A2', 'default', ['web-build']], ['A3', 'mcp', ['web-build']]]);
  const both = parseFeature('f', `# F\n\n${drive}\n\nNeeds: web-build.\n\n### A1. One\n\nNeeds: web-build.\n`);
  assert.deepEqual(both.journeys[0].needs, ['web-build'], 'needs from both scopes add up once');
});

test('a misplaced, malformed or unknown metadata line fails with file and line', () => {
  const misplaced = /^features\/bad\.md:(\d+): a "Mode:" or "Needs:" line is the first paragraph under "## Driving it with agent-browser and uvw" or under a journey heading$/;
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
    ['Mode: mcp, default.', /a journey runs in one mode/], ['Mode: mcp. Mode: default.', /Mode appears twice/],
    ['Mode: mcp', /write metadata as "Mode: <mode>\." and "Needs: <need>, <need>\."/], ['Mode: mcp. Run: helper.', /write metadata as/]]) {
    assert.throws(() => parseFeature('bad', recipe(`### A1. One\n\n${meta}`)), (e) => e.message.startsWith('features/bad.md:19: ') && why.test(e.message), meta);
  }
});

test('a plan has one partition per mode in file order, takes mode names as selectors, and names each partition\'s selectors', () => {
  const feature = parseFeature('f', recipe(['### A1. One', '### A2. Two\n\nMode: mcp.', '### A3. Three (host only)\n\nMode: mcp.', '### A4. Four',
    '### A5. Five\n\nMode: mcp-same-origin. Needs: web-build.'].join('\n\n')));
  const parts = (p) => p.partitions.map((q) => [q.mode, ids(q.journeys), q.needs, q.selectors]);
  assert.deepEqual(parts(plan(feature)), [['default', ['A1', 'A4'], [], ['default']], ['mcp', ['A2', 'A3'], [], ['mcp']],
    ['mcp-same-origin', ['A5'], ['web-build'], ['mcp-same-origin']]]);
  const runner = plan(feature, [], { where: 'runner' });
  assert.deepEqual([parts(runner)[1], ids(runner.host)], [['mcp', ['A2'], [], ['mcp']], ['A3']]);
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
  assert.deepEqual(fold(expected, []), { result: 'INCOMPLETE', journeys: expected.map(({ id }) => ({ id, verdict: 'MISSING', note: '' })) });

  const partial = fold(expected, [v('A1', 'PASS'), v('A2', 'PASS'), v('B9', 'PASS')]);
  assert.equal(partial.result, 'INCOMPLETE', 'a verdict for another journey covers nothing');
  assert.deepEqual(partial.journeys.map((j) => j.verdict), ['PASS', 'PASS', 'MISSING']);

  const all = [v('A1', 'FAIL', 'first look'), v('A2', 'PASS'), v('A3', 'PASS'), v('A1', 'PASS')];
  assert.equal(fold(expected, all).result, 'PASS', 'a later PASS replaces an earlier FAIL');
  const issues = fold(expected, [...all, v('A3', 'DRIFT', 'recipe says 43 tools, product lists 47')]);
  assert.equal(issues.result, 'ISSUES');
  assert.deepEqual(issues.journeys[2], { id: 'A3', verdict: 'DRIFT', note: 'recipe says 43 tools, product lists 47' });

  const forged = fold(expected, [...all, v('A2', 'BLOCKED')]);
  assert.deepEqual([forged.journeys[1].verdict, forged.result], ['MISSING', 'INCOMPLETE'], 'a journal line the command would refuse counts as no verdict');
});

test('$V verdict records only known journeys and allowed verdicts, and $V journeys prints the plan, then the coverage', () => {
  const root = mkdtempSync(join(tmpdir(), 'verify-uvw-verdict-'));
  const env = { ...process.env, VERIFY_UVW_ROOT: root, VERIFY_UVW_RUN: 'test' };
  delete env.VERIFY_UVW_RUNNER;
  delete env.VERIFY_UVW_EVIDENCE_ROOT;
  const v = (...args) => spawnSync('bash', [helper, ...args], { env, encoding: 'utf8' });
  const journal = join(root, 'test/evidence/journeys.jsonl');
  try {
    const before = v('journeys', 'issues');
    assert.equal(before.status, 0, before.stderr);
    assert.match(before.stdout, /^issues: 5 journeys in \.agents\/skills\/verify-uvw\/features\/issues\.md\ndefault: \$V up --for issues\n {2}IS1 {2}Create repo\n/);
    assert.match(v('journeys', 'sheet-lens').stdout, /^ {2}SLM1 +Regression against the base \(host only\)$/m, 'the host plan includes host-only journeys');
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

    // In a runner container, coverage spans every run the task started, as the runner folds it, and skips host-only journeys.
    mkdirSync(join(root, 'slc/evidence'), { recursive: true });
    writeFileSync(join(root, 'slc/run.env'), 'RUN_ID=slc\nWEB_PORT=1\n');
    assert.equal(spawnSync('bash', [helper, 'verdict', 'SLC1', 'PASS'], { env: { ...env, VERIFY_UVW_RUN: 'slc' } }).status, 0);
    assert.equal(v('verdict', 'SLC2', 'PASS').status, 0);
    const runner = spawnSync('bash', [helper, 'journeys', 'sheet-lens'], { env: { ...env, VERIFY_UVW_RUNNER: '1', VERIFY_UVW_EVIDENCE_ROOT: root }, encoding: 'utf8' });
    assert.match(runner.stdout, /^sheet-lens in run test: 2 of 19 journeys have a verdict$/m);
    assert.match(runner.stdout, /^SLM1 run only on the host$/m);
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
  for (const file of ['verify-uvw', 'journeys.mjs']) copyFileSync(fileURLToPath(new URL(file, import.meta.url)), join(skill, 'bin', file));
  writeFileSync(join(skill, 'features/f.md'), recipe(['### A1. One', '### A2. Two\n\nMode: mcp.', '### A3. Three\n\nMode: mcp-same-origin. Needs: web-build.', '### A4. Four\n\nMode: mcp.'].join('\n\n')));
  const env = { ...process.env, VERIFY_UVW_ROOT: root, VERIFY_UVW_RUN: 't' };
  delete env.VERIFY_UVW_RUNNER;
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
