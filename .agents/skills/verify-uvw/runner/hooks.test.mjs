import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { loadFeatures, readJournal } from '../bin/journeys.mjs';

const host = (file) => fileURLToPath(new URL(`../bin/${file}`, import.meta.url));
const helper = host('verify-uvw');

test('up refuses the dist start mode outside the verify runner before it starts anything', () => {
  const root = mkdtempSync(join(tmpdir(), 'verify-uvw-dist-'));
  try {
    for (const [from, runner, message] of [['dist', undefined, 'the dist start mode runs only inside the verify runner'],
      ['dist', '0', 'the dist start mode runs only inside the verify runner'], ['container', '1', 'VERIFY_UVW_MCP_FROM must be image or dist']]) {
      const env = { ...process.env, VERIFY_UVW_ROOT: root, VERIFY_UVW_RUN: 'dist', VERIFY_UVW_MCP: '1', VERIFY_UVW_MCP_FROM: from };
      delete env.VERIFY_UVW_RUNNER;
      if (runner !== undefined) env.VERIFY_UVW_RUNNER = runner;
      const result = spawnSync('bash', [helper, 'up'], { env, encoding: 'utf8' });
      assert.equal(result.status, 1);
      assert.equal(result.stderr, `verify-uvw: ${message}\n`);
      assert.deepEqual(readdirSync(root), [], 'no run directory, so no server, Vite or MCP role');
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('run-journeys never runs a journey in VERIFY_UVW_SKIP_JOURNEYS, not even as an earlier journey a later one needs', () => {
  const repo = mkdtempSync(join(tmpdir(), 'verify-uvw-skip-'));
  const skill = join(repo, '.agents/skills/verify-uvw');
  mkdirSync(join(skill, 'bin'), { recursive: true });
  mkdirSync(join(skill, 'features'));
  for (const file of ['verify-uvw', 'journeys.mjs', 'secrets.mjs', 'journey-prelude.sh']) copyFileSync(host(file), join(skill, 'bin', file));
  chmodSync(join(skill, 'bin/verify-uvw'), 0o755);
  const ran = (id) => ['Run: helper.', '', '```bash', `touch "$EVIDENCE/${id}.ran"`, '```'];
  writeFileSync(join(skill, 'features/f.md'), ['# F', '', '## Driving it with agent-browser and uvw', '',
    '### A1. One', '', ...ran('A1'), '', '### A2. Two', '', ...ran('A2'), '', '### A3. Three', '', ...ran('A3'), ''].join('\n'));
  const runs = join(repo, 'runs');
  const journeys = (run, skip) => {
    mkdirSync(join(runs, run, 'evidence'), { recursive: true });
    writeFileSync(join(runs, run, 'run.env'), `RUN_ID=${run}\nWEB_PORT=1\n`);
    const env = { ...process.env, VERIFY_UVW_ROOT: runs, VERIFY_UVW_RUN: run, VERIFY_UVW_SKIP_JOURNEYS: skip };
    const result = spawnSync('bash', [join(skill, 'bin/verify-uvw'), 'run-journeys', 'f', 'A3'], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return readJournal(join(runs, run, 'evidence/journeys.jsonl')).map((e) => e.journey);
  };
  try {
    assert.deepEqual(journeys('host', ''), ['A1', 'A2', 'A3'], 'without the list, A3 runs A1 and A2 first');
    assert.deepEqual(journeys('runner', 'A2 B9'), ['A1', 'A3']);
    assert.ok(!existsSync(join(runs, 'runner/evidence/A2.ran')), 'A2 left nothing behind');
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('with VERIFY_UVW_EVIDENCE_ROOT, coverage spans every run under it', () => {
  const root = mkdtempSync(join(tmpdir(), 'verify-uvw-evidence-'));
  const v = (run, env, ...args) => spawnSync('bash', [helper, ...args], { env: { ...process.env, VERIFY_UVW_ROOT: root, VERIFY_UVW_RUN: run, ...env }, encoding: 'utf8' });
  try {
    for (const run of ['first', 'second']) {
      mkdirSync(join(root, run, 'evidence'), { recursive: true });
      writeFileSync(join(root, run, 'run.env'), `RUN_ID=${run}\nWEB_PORT=1\n`);
    }
    const issues = loadFeatures().get('issues').journeys;
    assert.equal(v('first', {}, 'verdict', issues[0].id, 'PASS').status, 0);
    assert.equal(v('second', {}, 'verdict', issues[1].id, 'PASS').status, 0);
    const covered = (n) => new RegExp(`^issues in run second: ${n} of ${issues.length} journeys have a verdict$`, 'm');
    assert.match(v('second', {}, 'journeys', 'issues').stdout, covered(1));
    assert.match(v('second', { VERIFY_UVW_EVIDENCE_ROOT: root }, 'journeys', 'issues').stdout, covered(2));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
