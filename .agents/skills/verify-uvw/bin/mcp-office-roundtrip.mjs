#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const format = process.argv[2];
assert(['xlsx', 'docx'].includes(format), 'Usage: mcp-office-roundtrip.mjs xlsx|docx');
const evidence = process.env.EVIDENCE;
assert(evidence && process.env.VERIFY_UVW_RUN, 'Run eval "$(.agents/skills/verify-uvw/bin/verify-uvw env)" first');
const v = resolve('.agents/skills/verify-uvw/bin/verify-uvw');
const prefix = `mx-office-${format}`;
const type = format === 'xlsx' ? 'sheet' : 'doc';
const repo = `verify-${process.env.VERIFY_UVW_RUN}/personal`;
function call(label, ...args) {
  const result = spawnSync(v, [...args.slice(0, 1), `${prefix}-${label}`, ...args.slice(1)], { encoding: 'utf8', env: process.env });
  assert.equal(result.status, 0, `${args[0]} ${label} failed: ${result.stderr}\n${result.stdout}`);
  return JSON.parse(readFileSync(join(evidence, `${prefix}-${label}.out`), 'utf8'));
}
const mcp = (label, tool, args) => call(label, 'mcp', tool, JSON.stringify(args));
const cli = (label, ...args) => call(label, 'cli', ...args, '--json');
const space = mcp('repo', 'repo_view', { repo }).id;
const worktree = mcp('pr', 'pr_create', { repo, title: `Office ${format} round trip` }).id;
const unit = mcp('fixture-unit', 'unit_create', { worktree, space, type, name: `Office ${format} fixture`, idempotency_key: `${prefix}-${worktree}-fixture` }).unit.unitId;
const code = type === 'sheet'
  ? 'const s=workbook.getActiveSheet(); s.setName("Numbers"); s.getRange("A1:B2").setValues([[21,2],[7,3]]); s.getRange("C1").setFormula("=A1*B1"); workbook.create("Second",20,10).getRange("A1").setValue("Two sheets"); return 42;'
  : 'univerAPI.getActiveDocument().insertText(0,"Office round trip hello"); return true;';
cli('fixture-write', 'execute', '--worktree', worktree, '--unit', unit, '-e', code);
const fileName = `${prefix}-fixture.${format}`;
const fixture = join(evidence, fileName);
cli('fixture-export', 'export', fixture, '--worktree', worktree, '--unit', unit);
const media_type = type === 'sheet'
  ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const bytes = readFileSync(fixture);
const upload = mcp('upload', 'file_upload_create', { purpose: 'office-import', file_name: fileName, media_type, ...(format === 'docx' ? { size: bytes.length + 1024 } : {}) });
const put = await fetch(upload.upload.upload_url, { method: 'PUT', headers: { 'content-length': String(bytes.length) }, body: bytes });
writeFileSync(join(evidence, `${prefix}-put.json`), JSON.stringify({ status: put.status, size: bytes.length, body: await put.text() }, null, 2));
assert(put.ok, `Office PUT returned HTTP ${put.status}; retain this evidence if the known base upload defect is present. Do not bypass the route.`);
const imported = mcp('import', 'import', { upload_id: upload.upload.upload_id, worktree, space, idempotency_key: `${prefix}-${worktree}-import` });
const cliImported = cli('cli-import', 'import', '--file', fixture, '--worktree', worktree, '--space', space);
function inspect(label, id) {
  const args = type === 'sheet' ? ['range', 'A1:C2', '--worksheet', 'index:1'] : ['document'];
  return cli(label, 'inspect', ...args, '--worktree', worktree, '--unit', id);
}
const mcpInspect = mcp('inspect', 'inspect', { worktree, unit: imported.unitId, target: type === 'sheet' ? 'range' : 'document', ...(type === 'sheet' ? { selectors: ['A1:C2'], worksheet: 'index:1' } : {}) });
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !['unitId', 'worksheetId', 'sheetId', 'id'].includes(key)).map(([key, val]) => [key, normalize(val)]));
  return value;
}
assert.deepEqual(normalize(mcpInspect), normalize(inspect('cli-import-inspect', cliImported.unitId)));
const exported = mcp('export', 'export', { worktree, unit: imported.unitId, format });
// Document titles derive from filenames; both conversion paths must see the same basename.
const mcpDirectory = join(evidence, `${prefix}-mcp`);
const cliDirectory = join(evidence, `${prefix}-cli`);
mkdirSync(mcpDirectory, { recursive: true });
mkdirSync(cliDirectory, { recursive: true });
const downloaded = join(mcpDirectory, fileName);
const get = await fetch(exported.download.url);
assert(get.ok);
assert.match(get.headers.get('content-disposition'), /^attachment;/);
assert.equal(get.headers.get('x-content-type-options'), 'nosniff');
assert.equal(get.headers.get('content-security-policy'), "sandbox; default-src 'none'");
assert.equal(get.headers.get('cache-control'), 'private, no-store');
writeFileSync(downloaded, new Uint8Array(await get.arrayBuffer()));
writeFileSync(`${downloaded}.headers.json`, JSON.stringify(Object.fromEntries(get.headers), null, 2));
const cliOutput = join(cliDirectory, fileName);
cli('cli-export', 'export', cliOutput, '--worktree', worktree, '--unit', imported.unitId);
const roundMcp = cli('mcp-round-import', 'import', '--file', downloaded, '--worktree', worktree, '--space', space);
const roundCli = cli('cli-round-import', 'import', '--file', cliOutput, '--worktree', worktree, '--space', space);
assert.deepEqual(normalize(inspect('mcp-round-inspect', roundMcp.unitId)), normalize(inspect('cli-round-inspect', roundCli.unitId)));
console.log(`PASS ${format}: staged upload, import/inspect parity, export/download headers and content parity`);
