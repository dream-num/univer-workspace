#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = process.cwd();
const evidence = process.env.EVIDENCE;
const run = process.env.VERIFY_UVW_RUN;
assert.ok(evidence && run, 'Run eval "$(.agents/skills/verify-uvw/bin/verify-uvw env)" first.');
const v = join(root, '.agents/skills/verify-uvw/bin/verify-uvw');
const require = createRequire(join(root, 'apps/mcp/package.json'));
const { zipSync } = require('fflate');
const repo = `verify-${run}/personal`;
const fixture = join(evidence, 'compiler-fixture');
mkdirSync(fixture, { recursive: true });
const read = label => JSON.parse(readFileSync(join(evidence, `${label}.out`), 'utf8'));
function command(args, expected = 0) {
  const result = spawnSync(v, args, { cwd: root, encoding: 'utf8', env: process.env });
  assert.equal(result.status, expected, `${args.slice(0, 5).join(' ')}\n${result.stderr}\n${result.stdout}`);
}
function mcp(label, tool, args, expected = 0) {
  command(['mcp', '--toolsets', 'all', label, tool, JSON.stringify(args)], expected);
  return read(label);
}
async function upload(label, purpose, bytes) {
  const result = mcp(label, 'file_upload_create', { purpose, file_name: `${purpose}.zip`, media_type: 'application/zip', size: bytes.length });
  const upload = result.upload;
  const response = await fetch(upload.upload_url, { method: 'PUT', body: bytes });
  writeFileSync(join(evidence, `${label}.put-status`), `${response.status}\n`);
  assert.equal(response.status, 204);
  return upload.upload_id;
}
if (process.argv[2] === 'typst-jobs') {
  const manifest = { schemaVersion: 1, targetUnitId: `typst-job-${run}`, title: 'Typst job', pages: ['page.typ'] };
  const bytes = zipSync({ 'typst.json': Buffer.from(JSON.stringify(manifest)), 'page.typ': Buffer.from('= Typst job\n\nSurvives the synchronous budget.') });
  const id = await upload('mcp-typst-job-upload', 'typst-bundle', bytes);
  const pr = mcp('mcp-typst-job-pr', 'pr_create', { repo, title: 'Typst job verification', idempotency_key: `typst-job-pr-${run}` });
  const before = mcp('mcp-typst-job-before', 'unit_list', { worktree: pr.id });
  const args = { bundle_upload_id: id, apply: true, worktree: pr.id, space: repo, idempotency_key: `typst-job-apply-${run}` };
  const handle = mcp('mcp-typst-job-apply', 'compile_typst', args);
  assert.equal(handle.status, 'running'); assert.ok(handle.job_id);
  const retry = mcp('mcp-typst-job-retry', 'compile_typst', args);
  if (retry.job_id) assert.equal(retry.job_id, handle.job_id);
  let settled;
  const deadline = Date.now() + 240_000;
  for (let i = 0; Date.now() < deadline; i++) {
    settled = mcp(`mcp-typst-job-poll-${i}`, 'job_get', { job_id: handle.job_id });
    if (settled.status !== 'running') break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.equal(settled?.status, 'succeeded', JSON.stringify(settled));
  assert.equal(settled.result.committed, true); assert.ok(settled.result.unit.unitId);
  if (!retry.job_id) assert.deepEqual(retry, settled.result);
  assert.deepEqual(mcp('mcp-typst-job-finished-retry', 'compile_typst', args), settled.result);
  const listed = mcp('mcp-typst-job-units', 'unit_list', { worktree: pr.id });
  assert.equal(listed.units.length, before.units.length + 1);
  assert.equal(listed.units.filter(unit => unit.unitId === settled.result.unit.unitId).length, 1);
  const inspected = mcp('mcp-typst-job-inspect', 'inspect', { target: 'document', unit: settled.result.unit.unitId, worktree: pr.id });
  assert.ok(JSON.stringify(inspected).includes('Survives the synchronous budget'));
  console.log(`PASS Typst apply job ${handle.job_id}, job_get original result, same-key retry and exactly one new Unit.`);
} else if (process.argv[2] === 'typst') {
  const manifest = { schemaVersion: 1, targetUnitId: `typst-${run}`, title: 'MCP Typst paper', pages: ['page.typ'] };
  const text = '= MCP Typst heading\n\nA paragraph from the compiler journey.\n\n#table(columns: 2, [Name], [Value], [Alpha], [42])\n\n#image("assets/image.png", width: 20pt)\n';
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMwSjnxHwAEiAJeVQbffQAAAABJRU5ErkJggg==', 'base64');
  const files = { 'typst.json': Buffer.from(JSON.stringify(manifest)), 'page.typ': Buffer.from(text), 'assets/image.png': image };
  for (const [path, bytes] of Object.entries(files)) { mkdirSync(dirname(join(fixture, path)), { recursive: true }); writeFileSync(join(fixture, path), bytes); }
  const bytes = zipSync(files);
  const id = await upload('mcp-typst-upload', 'typst-bundle', bytes);
  const compiled = mcp('mcp-typst-compile', 'compile_typst', { bundle_upload_id: id });
  const program = join(fixture, 'compiled.js');
  command(['cli', 'mcp-typst-cli', 'compile-typst', fixture, '--out', program, '--json']);
  assert.equal(compiled.javascript, readFileSync(program, 'utf8'));
  assert.deepEqual(compiled.diagnostics, read('mcp-typst-cli').diagnostics);
  const event = JSON.parse(readFileSync(join(evidence, 'mcp-typst-compile.event.json'), 'utf8'));
  assert.equal(event.executor, 'none'); assert.equal(event.unit_type, null); assert.equal(event.repo, null);
  assert.equal(event.cost.upload_bytes, bytes.length);
  const pr = mcp('mcp-typst-pr', 'pr_create', { repo, title: 'Typst compiler verification', idempotency_key: `typst-pr-${run}` });
  const args = { bundle_upload_id: id, apply: true, worktree: pr.id, space: repo, idempotency_key: `typst-apply-${run}` };
  const applied = mcp('mcp-typst-apply', 'compile_typst', args);
  const retry = mcp('mcp-typst-retry', 'compile_typst', args);
  assert.equal(retry.unit.unitId, applied.unit.unitId);
  const listed = mcp('mcp-typst-units', 'unit_list', { worktree: pr.id });
  assert.equal(listed.units.filter(unit => unit.unitId === applied.unit.unitId).length, 1);
  const inspected = mcp('mcp-typst-inspect', 'inspect', { target: 'document', unit: applied.unit.unitId, worktree: pr.id });
  const native = JSON.stringify(inspected);
  assert.ok(native.includes('MCP Typst heading') && native.includes('paragraph'));
  assert.equal(inspected.features.tables, 1); assert.equal(inspected.features.drawings, 1);
  writeFileSync(join(evidence, 'compiler-agent-input.json'), JSON.stringify({ repo, bundle_upload_id: id }));
  console.log('PASS Typst compile/CLI parity, native Doc readback and same-key retry.');
} else if (process.argv[2] === 'svg') {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240"><rect x="20" y="30" width="150" height="90" fill="#3366cc"/><circle cx="290" cy="75" r="45" fill="#cc6633"/><text x="30" y="180" font-size="24">MCP diagram</text></svg>';
  const file = join(fixture, 'diagram.svg'); writeFileSync(file, svg);
  const compiled = mcp('mcp-svg-compile', 'compile_svg', { svg, estimate_text_size: true, page: 1 });
  command(['cli', 'mcp-svg-cli', 'compile-svg', file, '--estimate-text-size', '--page', '1', '--json']);
  assert.deepEqual(compiled, read('mcp-svg-cli'));
  assert.ok(compiled.lints.some(lint => lint.includes('estimation')));
  const error = mcp('mcp-svg-no-estimate', 'compile_svg', { svg }, 1);
  assert.equal(error.code, 'workspace-text-measure-unavailable');
  const pr = mcp('mcp-svg-pr', 'pr_create', { repo, title: 'SVG compiler verification', idempotency_key: `svg-pr-${run}` });
  const { unit } = mcp('mcp-svg-unit', 'unit_create', { worktree: pr.id, space: repo, type: 'slide', name: 'SVG diagram', idempotency_key: `svg-unit-${run}` });
  const applied = mcp('mcp-svg-apply', 'compile_svg', { svg, estimate_text_size: true, page: 1, apply: true, worktree: pr.id, unit: unit.unitId });
  assert.equal(applied.applied.committed, true);
  const inspected = mcp('mcp-svg-inspect', 'inspect', { target: 'slide', selectors: ['index:1'], worktree: pr.id, unit: unit.unitId });
  assert.ok(JSON.stringify(inspected).includes('MCP diagram'));
  assert.equal(inspected.slides[0].elementCounts.shapes, 3);
  const event = JSON.parse(readFileSync(join(evidence, 'mcp-svg-apply.event.json'), 'utf8'));
  assert.equal(event.unit_type, 'slide'); assert.equal(event.cost.committed_revisions, 1);
  console.log('PASS SVG compile/CLI parity, required estimation and committed Slide readback.');
} else {
  throw new Error('Usage: compiler-journeys.mjs typst|svg|typst-jobs');
}
