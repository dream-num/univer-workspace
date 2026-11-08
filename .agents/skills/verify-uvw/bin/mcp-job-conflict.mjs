#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const evidence = process.env.EVIDENCE;
assert(evidence && process.env.VERIFY_UVW_RUN, 'Load verify-uvw env first');
const v = resolve('.agents/skills/verify-uvw/bin/verify-uvw');
const repo = `verify-${process.env.VERIFY_UVW_RUN}/personal`;
function mcp(label, tool, args, status = 0) {
  const run = spawnSync(v, ['mcp', `mx-conflict-${label}`, tool, JSON.stringify(args)], { encoding: 'utf8', env: process.env });
  assert.equal(run.status, status, `${label} exited ${run.status}: ${run.stderr}\n${run.stdout}`);
  return JSON.parse(readFileSync(join(evidence, `mx-conflict-${label}.out`), 'utf8'));
}
const sources = ['mx-office-xlsx-fixture.xlsx', 'mx-office-xlsx-mcp/mx-office-xlsx-fixture.xlsx'].map(name => join(evidence, name));
for (const path of sources) assert(existsSync(path), `Run MX7 first; missing ${path}`);
const media_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
async function upload(label, path, fileName) {
  const bytes = readFileSync(path);
  const reservation = mcp(`upload-${label}`, 'file_upload_create', { purpose: 'office-import', file_name: fileName, media_type });
  const put = await fetch(reservation.upload.upload_url, { method: 'PUT', headers: { 'content-length': String(bytes.length) }, body: bytes });
  assert(put.ok, `PUT ${label} returned HTTP ${put.status}`);
  return reservation.upload.upload_id;
}
const space = mcp('repo', 'repo_view', { repo }).id;
const worktree = mcp('pr', 'pr_create', { repo, title: 'Job key conflict' }).id;
const [a, b] = [await upload('a', sources[0], 'a.xlsx'), await upload('b', sources[1], 'b.xlsx')];
const key = `mx-conflict-${worktree}-import`;
const first = mcp('first', 'import', { upload_id: a, worktree, space, idempotency_key: key });
const before = mcp('before', 'unit_list', { worktree });
const conflict = mcp('different-upload', 'import', { upload_id: b, worktree, space, idempotency_key: key }, 1);
assert.equal(conflict.code, 'workspace-idempotency-conflict');
const after = mcp('after', 'unit_list', { worktree });
assert.deepEqual(after, before, 'A rejected key reuse must not create a Unit');
const replay = mcp('replay', 'import', { upload_id: a, worktree, space, idempotency_key: key });
assert.equal(replay.unitId, first.unitId);
writeFileSync(join(evidence, 'mx-conflict-proof.json'), JSON.stringify({ key, first, conflict, before, after, replay }, null, 2));
console.log(`PASS key reuse with another upload returned ${conflict.code}; Unit list unchanged; same arguments replayed ${replay.unitId}`);
