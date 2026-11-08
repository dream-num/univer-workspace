#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(resolve('apps/mcp/package.json'));
const { zipSync } = require('fflate');
const evidence = process.env.EVIDENCE;
assert(evidence && process.env.VERIFY_UVW_RUN, 'Load verify-uvw env first');
const v = resolve('.agents/skills/verify-uvw/bin/verify-uvw');
const prefix = 'mm-markdown';
const repo = `verify-${process.env.VERIFY_UVW_RUN}/personal`;
function call(label, mode, ...args) {
  const result = spawnSync(v, [mode, ...(mode === 'mcp' ? ['--toolsets', 'all'] : []), `${prefix}-${label}`, ...args], { encoding: 'utf8', env: process.env });
  assert.equal(result.status, 0, `${label}: ${result.stderr}\n${result.stdout}`);
  return JSON.parse(readFileSync(join(evidence, `${prefix}-${label}.out`), 'utf8'));
}
const mcp = (label, tool, args) => call(label, 'mcp', tool, JSON.stringify(args));
const cli = (label, ...args) => call(label, 'cli', ...args, '--json');
const space = mcp('repo', 'repo_view', { repo }).id;
const worktree = mcp('pr', 'pr_create', { repo, title: 'Markdown round trip' }).id;
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64');
const markdown = `:::block{#heading}\n# Markdown report\n:::\n\n:::block{#list}\n- First item\n- Second item\n:::\n\n:::block{#table}\n| Name | Value |\n| --- | --- |\n| Example | 42 |\n:::\n\n:::block{#image}\n![Pixel](img/pixel.png)\n:::\n`;
const directory = join(evidence, prefix);
mkdirSync(join(directory, 'img'), { recursive: true });
const file = join(directory, 'report.md');
writeFileSync(file, markdown);
writeFileSync(join(directory, 'img/pixel.png'), image);
const zip = zipSync({ 'img/pixel.png': image });
const upload = mcp('upload', 'file_upload_create', { purpose: 'markdown-assets', file_name: 'assets.zip', media_type: 'application/zip', size: zip.length });
const put = await fetch(upload.upload.upload_url, { method: 'PUT', headers: { 'content-length': String(zip.length) }, body: zip });
writeFileSync(join(evidence, `${prefix}-put.json`), JSON.stringify({ status: put.status, size: zip.length, body: await put.text() }, null, 2));
assert(put.ok, `ZIP PUT failed with ${put.status}`);
const input = { markdown, assets_upload_id: upload.upload.upload_id, title: 'Markdown report', apply: true, worktree, space, idempotency_key: `${prefix}-${worktree}` };
const compiled = mcp('compile', 'compile_markdown', input);
const retried = mcp('retry', 'compile_markdown', input);
assert.equal(retried.targetUnitId, compiled.targetUnitId);
assert.deepEqual(retried.sourceMap, compiled.sourceMap);
const unitsBefore = mcp('units-before', 'unit_list', { worktree });
const fromCli = cli('cli-compile', 'compile-markdown', file, '--title', 'Markdown report', '--apply', '--worktree', worktree, '--space', space, '--idempotency-key', `${prefix}-cli-${worktree}`);
const native = mcp('inspect', 'inspect', { worktree, unit: compiled.targetUnitId, target: 'document' });
const cliNative = cli('cli-inspect', 'inspect', 'document', '--worktree', worktree, '--unit', fromCli.targetUnitId);
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !['id', 'unitId', 'paragraphId', 'objectId'].includes(key)).map(([key, val]) => [key, normalize(val)]));
  return value;
}
assert.deepEqual(normalize(native), normalize(cliNative));
assert.equal(unitsBefore.units.length, 1);
assert.equal(unitsBefore.units[0].unitId, compiled.targetUnitId);
const sourceMapFile = join(directory, 'source-map.json');
writeFileSync(sourceMapFile, JSON.stringify(compiled.sourceMap));
const blocks = ['heading', 'list', 'table', 'image'];
const exported = mcp('export', 'export_markdown', { worktree, unit: compiled.targetUnitId, source_map: compiled.sourceMap, blocks });
const cliOut = join(directory, 'export.md');
const cliExported = cli('cli-export', 'export-markdown', '--worktree', worktree, '--unit', compiled.targetUnitId, '--source-map', sourceMapFile, '--blocks', blocks.join(','), '--out', cliOut);
const normalizePaths = (text) => text.replace(/assets\/native-[a-f0-9]+-/g, 'assets/native-ID-');
assert.equal(normalizePaths(exported.markdown), normalizePaths(readFileSync(cliOut, 'utf8')));
assert.deepEqual(exported.sourceMap, cliExported.sourceMap);
assert(exported.assets.length > 0);
for (const asset of exported.assets) {
  const response = await fetch(asset.download.url);
  assert(response.ok);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.deepEqual(Buffer.from(bytes), image);
  writeFileSync(join(directory, 'downloaded-pixel.png'), bytes);
}
const updated = mcp('update', 'compile_markdown', { markdown: ':::block{#heading}\n# Updated Markdown report\n:::\n', apply: true, worktree, unit: compiled.targetUnitId, source_map: exported.sourceMap, blocks: ['heading'] });
assert.equal(updated.committed, true);
assert(updated.execution.revision > 1);
const after = mcp('inspect-after', 'inspect', { worktree, unit: compiled.targetUnitId, target: 'document' });
assert.match(JSON.stringify(after), /Updated Markdown report/);
assert.match(JSON.stringify(after), /First item/);
writeFileSync(join(evidence, `${prefix}-summary.json`), JSON.stringify({ worktree, unit: compiled.targetUnitId, cliUnit: fromCli.targetUnitId, retrySameUnit: true, nativeInspectionParity: true, markdownAndSourceMapParity: true, assetBytesEqual: true, updateRevision: updated.execution.revision }, null, 2));
console.log('PASS Markdown create, apply retry, CLI inspection/export parity, asset download and block update');
