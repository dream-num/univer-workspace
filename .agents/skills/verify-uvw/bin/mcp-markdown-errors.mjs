#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(resolve('apps/mcp/package.json'));
const { zipSync } = require('fflate');
const evidence = process.env.EVIDENCE;
assert(evidence && process.env.VERIFY_UVW_RUN, 'Load verify-uvw env first');
const v = resolve('.agents/skills/verify-uvw/bin/verify-uvw');
const prefix = 'mm-errors';
const calls = [];
function args(label, tool, input) {
  return ['mcp', '--toolsets', 'all', `${prefix}-${label}`, tool, JSON.stringify(input)];
}
function read(label, status, expected) {
  assert.equal(status, expected, `${label}: unexpected verify-uvw exit code`);
  const output = JSON.parse(readFileSync(join(evidence, `${prefix}-${label}.out`), 'utf8'));
  const event = JSON.parse(readFileSync(join(evidence, `${prefix}-${label}.event.json`), 'utf8'));
  assert.equal(event.outcome, expected === 1 ? 'tool_error' : 'ok');
  calls.push({ label, outcome: event.outcome, code: output.code, duration_ms: event.duration_ms });
  return output;
}
function mcp(label, tool, input, expected = 0) {
  const result = spawnSync(v, args(label, tool, input), { encoding: 'utf8', env: process.env });
  return read(label, result.status, expected);
}
function concurrent(label, tool, input, expected = 0) {
  return new Promise((accept, reject) => {
    const child = spawn(v, args(label, tool, input), { env: process.env, stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', status => { try { accept(read(label, status, expected)); } catch (error) { reject(error); } });
  });
}
function invalid(label, tool, input, diagnostic) {
  const output = mcp(label, tool, input, 1);
  assert.equal(output.code, 'workspace-markdown-invalid');
  assert(output.message.startsWith(`${diagnostic}:`));
  assert(output.detail.diagnostics.some(entry => entry.code === diagnostic && entry.message));
  return output;
}
const { worktree, unit } = JSON.parse(readFileSync(join(evidence, 'mm-markdown-summary.json'), 'utf8'));
const sourceMap = JSON.parse(readFileSync(join(evidence, 'mm-markdown-export.out'), 'utf8')).sourceMap;
const space = JSON.parse(readFileSync(join(evidence, 'mm-markdown-repo.out'), 'utf8')).id;
const unrelated = zipSync({ 'other.png': new Uint8Array([1]) });
const ready = mcp('unrelated-upload', 'file_upload_create', { purpose: 'markdown-assets', file_name: 'other.zip', media_type: 'application/zip', size: unrelated.length });
assert((await fetch(ready.upload.upload_url, { method: 'PUT', body: unrelated })).ok);
const html = 'Hello <b>html</b>';
const cases = [
  ['html', html, 'MARKDOWN_INLINE'],
  ['footnote', 'a[^x]\n\n[^x]: footnote', 'MARKDOWN_INLINE'],
  ['missing', '![missing](missing.png)', 'MARKDOWN_ASSET'],
  ['missing-zip', '![missing](missing.png)', 'MARKDOWN_ASSET'],
  ['duplicate', ':::block{#a}\none\n:::\n\n:::block{#a}\ntwo\n:::', 'MARKDOWN_DUPLICATE_ID'],
  ...['https://example.test/a.png', '/a.png', '../a.png', 'file:///a.png'].map((path, index) => [`path-${index}`, `![image](${path})`, 'MARKDOWN_ASSET_PATH']),
];
let htmlError;
for (const mode of ['compile', 'create', 'update']) {
  for (const [label, markdown, diagnostic] of cases) {
    const input = { markdown,
      ...(label === 'missing-zip' ? { assets_upload_id: ready.upload.upload_id } : {}),
      ...(mode === 'compile' ? {} : mode === 'create' ? { apply: true, worktree, space }
        : { apply: true, worktree, unit, source_map: sourceMap, blocks: ['heading'] }),
    };
    const output = invalid(`${mode}-${label}`, 'compile_markdown', input, diagnostic);
    if (mode === 'compile' && label === 'html') htmlError = output;
  }
}
const file = join(evidence, `${prefix}-html.md`);
writeFileSync(file, html);
const cli = spawnSync(v, ['cli', `${prefix}-cli-html`, 'compile-markdown', file, '--out', join(evidence, `${prefix}-html.js`)], { encoding: 'utf8', env: process.env });
assert.equal(cli.status, 1);
assert(readFileSync(join(evidence, `${prefix}-cli-html.err`), 'utf8').includes(htmlError.message));
const target = { worktree, unit, source_map: [{}], blocks: ['heading'] };
invalid('update-map', 'compile_markdown', { ...target, markdown: ':::block{#heading}\n# Hello\n:::', apply: true }, 'DOC_MARKDOWN_SOURCE_MAP_INVALID');
invalid('export-map', 'export_markdown', target, 'DOC_MARKDOWN_SOURCE_MAP_INVALID');
invalid('update-block', 'compile_markdown', { worktree, unit, source_map: sourceMap, blocks: ['nope'], markdown: ':::block{#nope}\nHello\n:::', apply: true }, 'DOC_MARKDOWN_UPDATE_INVALID');
invalid('export-block', 'export_markdown', { worktree, unit, source_map: sourceMap, blocks: ['nope'] }, 'DOC_MARKDOWN_READ_INVALID');
const zip = zipSync({ ['a/'.repeat(2000) + 'image.png']: new Uint8Array(1_000_000) });
const upload = mcp('upload', 'file_upload_create', { purpose: 'markdown-assets', file_name: 'deep.zip', media_type: 'application/zip', size: zip.length });
const put = await fetch(upload.upload.upload_url, { method: 'PUT', body: zip });
assert(put.ok, `ZIP PUT failed with ${put.status}`);
writeFileSync(join(evidence, `${prefix}-zip.json`), JSON.stringify({ bytes: zip.length, segments: 2001, put: put.status }));
const inspectInput = { worktree, unit, target: 'document' };
const baseline = mcp('baseline', 'inspect', inspectInput);
const [rejected, inspected] = await Promise.all([
  concurrent('deep-zip', 'compile_markdown', { markdown: '# Safe', assets_upload_id: upload.upload.upload_id }, 1),
  concurrent('concurrent', 'inspect', inspectInput),
]);
assert.equal(rejected.code, 'workspace-argument-invalid');
assert.match(rejected.message, /entry name exceeds/);
assert.deepEqual(inspected, baseline);
const normalMs = calls.find(call => call.label === 'baseline').duration_ms;
const budgetMs = Math.max(2000, normalMs * 5);
for (const label of ['deep-zip', 'concurrent'])
  assert(calls.find(call => call.label === label).duration_ms < budgetMs, `${label} exceeded ${budgetMs} ms`);
writeFileSync(join(evidence, `${prefix}-summary.json`), JSON.stringify({ cliMessageParity: true, diagnosticsPreserved: true, budgetMs, calls }, null, 2));
console.log('PASS Markdown input diagnostics, CLI message parity, bounded ZIP rejection and concurrent executor inspection');
