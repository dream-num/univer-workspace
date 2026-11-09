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
  assert.equal(event.executor, 'cold_start'); assert.equal(event.unit_type, null); assert.equal(event.repo, null);
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
  const pr = mcp('mcp-svg-pr', 'pr_create', { repo, title: 'SVG compiler verification', idempotency_key: `svg-pr-${run}-verify` });
  const { unit } = mcp('mcp-svg-unit', 'unit_create', { worktree: pr.id, space: repo, type: 'slide', name: 'SVG diagram', idempotency_key: `svg-unit-${run}-verify` });
  const applied = mcp('mcp-svg-apply', 'compile_svg', { svg, estimate_text_size: true, page: 1, apply: true, worktree: pr.id, unit: unit.unitId });
  assert.equal(applied.applied.committed, true);
  const inspected = mcp('mcp-svg-inspect', 'inspect', { target: 'slide', selectors: ['index:1'], worktree: pr.id, unit: unit.unitId });
  assert.ok(JSON.stringify(inspected).includes('MCP diagram'));
  assert.equal(inspected.slides[0].elementCounts.shapes, 3);
  const event = JSON.parse(readFileSync(join(evidence, 'mcp-svg-apply.event.json'), 'utf8'));
  assert.equal(event.unit_type, 'slide'); assert.equal(event.cost.committed_revisions, 1);
  console.log('PASS SVG estimate compile/CLI parity and committed Slide readback.');
} else if (process.argv[2] === 'svg-real') {
  const slide = (extra = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"><rect width="960" height="540" fill="#ffffff"/><rect x="40" y="130" width="880" height="360" fill="#eef3ff" stroke="#3366cc" stroke-width="2"/><text x="480" y="80" font-size="44" font-family="Arial" font-weight="bold" text-anchor="middle" fill="#111111">Quarterly review 季度回顾</text><text x="60" y="190" font-size="28" font-family="Arial" fill="#222222">Revenue grew 18% 收入同比增长百分之十八</text><text x="900" y="250" font-size="28" font-family="Arial" text-anchor="end" fill="#222222">Risks 风险：供应链与汇率</text><text x="60" y="310" font-size="24" font-family="Arial" fill="#444444">Next steps 下一步：扩大市场并控制成本</text><text x="480" y="440" font-size="32" font-family="Arial" text-anchor="middle" fill="#cc3333">Thank you 谢谢</text>${extra}</svg>`;
  const svg = slide();
  const file = join(fixture, 'real.svg'); writeFileSync(file, svg);
  const shape = value => JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))), (_key, item) => typeof item === 'string' ? item.replace(/-?\d+(\.\d+)?/g, '#') : item);
  const real = mcp('mcp-svg-real-compile', 'compile_svg', { svg, page: 1 });
  command(['cli', 'mcp-svg-real-cli', 'compile-svg', file, '--page', '1', '--json']);
  const cli = read('mcp-svg-real-cli');
  assert.equal(real.textMeasure, 'univer-render-runtime'); assert.equal(cli.textMeasure, real.textMeasure);
  assert.ok(!real.lints.some(lint => lint.includes('estimat')));
  assert.deepEqual(Object.keys(real).sort(), Object.keys(cli).sort());
  assert.ok(shape(real) === shape(cli), 'same structure; numbers differ with the host fonts');
  const estimated = mcp('mcp-svg-real-estimate', 'compile_svg', { svg, estimate_text_size: true, page: 1 });
  assert.equal(estimated.textMeasure, 'builtin-estimate'); assert.ok(estimated.lints.some(lint => lint.includes('estimation')));
  assert.notEqual(estimated.code, real.code);
  const pr = mcp('mcp-svg-real-pr', 'pr_create', { repo, title: 'SVG real-font verification', idempotency_key: `svg-real-pr-${run}-verify` });
  const { unit } = mcp('mcp-svg-real-unit', 'unit_create', { worktree: pr.id, space: repo, type: 'slide', name: 'Real fonts', idempotency_key: `svg-real-unit-${run}-verify` });
  const applied = mcp('mcp-svg-real-apply', 'compile_svg', { svg, page: 1, apply: true, worktree: pr.id, unit: unit.unitId });
  assert.equal(applied.applied.committed, true); assert.equal(applied.textMeasure, 'univer-render-runtime');
  const inspected = mcp('mcp-svg-real-inspect', 'inspect', { target: 'slide', selectors: ['index:1'], worktree: pr.id, unit: unit.unitId });
  assert.ok(JSON.stringify(inspected).includes('季度回顾'));
  const event = JSON.parse(readFileSync(join(evidence, 'mcp-svg-real-apply.event.json'), 'utf8'));
  assert.equal(event.unit_type, 'slide'); assert.equal(event.cost.committed_revisions, 1);
  mcp('mcp-svg-real-shot', 'screenshot', { unit: unit.unitId, worktree: pr.id });
  const lines = Array.from({ length: 50 }, (_, i) => `<text x="${20 + (i % 2) * 470}" y="${24 + Math.floor(i / 2) * 20}" font-size="14" font-family="Arial">Line ${i + 1} 第${i + 1}行 text</text>`).join('');
  const started = Date.now();
  const timed = mcp('mcp-svg-real-50', 'compile_svg', { svg: slide(lines), page: 1 });
  const elapsed = Date.now() - started;
  assert.equal(timed.textMeasure, 'univer-render-runtime');
  writeFileSync(join(evidence, 'mcp-svg-real-50.wall-ms'), `${elapsed}\n`);
  const event50 = JSON.parse(readFileSync(join(evidence, 'mcp-svg-real-50.event.json'), 'utf8'));
  console.log(`PASS real-font SVG compile/CLI structure parity, estimate mode, apply readback and screenshot. 55 text lines: wall ${elapsed} ms (including process spawn), gateway duration ${event50.duration_ms} ms.`);
} else {
  throw new Error('Usage: compiler-journeys.mjs typst|svg|svg-real|typst-jobs');
}
