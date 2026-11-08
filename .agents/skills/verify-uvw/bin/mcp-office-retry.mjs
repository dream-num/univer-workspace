#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const evidence = process.env.EVIDENCE;
assert(evidence && process.env.VERIFY_UVW_RUN, 'Load verify-uvw env first');
const v = resolve('.agents/skills/verify-uvw/bin/verify-uvw');
function mcp(label, tool, args) {
  const run = spawnSync(v, ['mcp', `mx-retry-${label}`, tool, JSON.stringify(args)], { encoding: 'utf8', env: process.env });
  assert.equal(run.status, 0, `${label} failed: ${run.stderr}\n${run.stdout}`);
  return JSON.parse(readFileSync(join(evidence, `mx-retry-${label}.out`), 'utf8'));
}
const previous = JSON.parse(readFileSync(join(evidence, 'mx-office-xlsx-import.out'), 'utf8'));
const reservation = JSON.parse(readFileSync(join(evidence, 'mx-office-xlsx-upload.out'), 'utf8'));
const space = JSON.parse(readFileSync(join(evidence, 'mx-office-xlsx-repo.out'), 'utf8')).id;
const args = { upload_id: reservation.upload.upload_id, worktree: previous.worktreeId, space,
  idempotency_key: `mx-office-xlsx-${previous.worktreeId}-import` };
const before = mcp('before', 'unit_list', { worktree: previous.worktreeId });
await new Promise(resolve => setTimeout(resolve, 1100));
const retried = mcp('again', 'import', args);
assert.equal(retried.job_id, undefined, 'A successful retry must return the original import result directly');
assert.equal(retried.unitId, previous.unitId);
const after = mcp('after', 'unit_list', { worktree: previous.worktreeId });
assert.deepEqual(after, before);
writeFileSync(join(evidence, 'mx-import-retry-proof.json'), JSON.stringify({ args, original: previous, retried, before, after }, null, 2));
console.log(`PASS idempotent import retry returned ${retried.unitId}; Unit list unchanged`);
