import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { toolOutput } from './mcp-result.mjs';

test('invalid MCP input exits 2 before connecting or writing evidence', () => {
  const run = mkdtempSync(join(tmpdir(), 'verify-uvw-mcp-input-'));
  const internal = ['--repo', run, '--run', run, '--url', 'http://127.0.0.1:1/mcp',
    '--project', 'verify-uvw-input', '--image', 'unused', '--origin', 'http://127.0.0.1:1', '--server-port', '1'];
  try {
    for (const args of [
      ['call', '../outside', 'whoami'],
      ['call', '--protocol', 'unknown', 'input', 'whoami'],
      ['call', '--auth', 'unknown', 'input', 'whoami'],
      ['call', 'input', 'whoami', '[]'],
      ['call', 'input', 'whoami', 'null'],
      ['call', 'input', 'whoami', '{'],
      ['tools', '--auth', 'none', 'input'],
      ['call', '--as', 'Agent One', 'input', 'whoami'],
      ['call', '--as', 'a1', '--auth', 'pat', 'input', 'whoami'],
      ['tools', 'input', 'extra'],
    ]) {
      const result = spawnSync(process.execPath, [fileURLToPath(new URL('./mcp-call.mjs', import.meta.url)), ...internal, ...args], { encoding: 'utf8' });
      assert.equal(result.status, 2, JSON.stringify(args));
      assert.match(result.stderr, /Usage: verify-uvw mcp/);
      assert.equal(result.stdout, '');
      assert.deepEqual(readdirSync(run), []);
    }
  } finally { rmSync(run, { recursive: true, force: true }); }
});

const source = readFileSync(new URL('./mcp-call.mjs', import.meta.url), 'utf8');
const validator = source.slice(source.indexOf('\nfunction eventIssues('));

function validateErrorCode(outcome, code, errorCode, extra = {}) {
  return runInNewContext(`${validator}\neventIssues(event)`, {
    toolOutput,
    tool: 'repo_view',
    args: {},
    auth: 'dev',
    patId: null,
    principalId: undefined,
    ...extra.globals,
    protocol: '2026-07-28',
    result: extra.result ?? (outcome === 'tool_error'
      ? { isError: true, content: [{ type: 'text', text: JSON.stringify({ code, message: 'm' }) }] }
      : { structuredContent: {} }),
    event: {
      event: 'mcp.tool_call', schema_version: 1, ts: '2026-11-07T00:00:00Z',
      request_id: 'test', user_id: 'user-1', auth_kind: 'dev', client_id: 'dev',
      tool: 'repo_view', toolset: 'core', outcome, duration_ms: 1, executor: 'none',
      trace_id: null, client_name: 'verify-uvw', client_version: '1.0.0', repo: null,
      unit_type: null, error_code: errorCode,
      cost: { worker_cpu_ms: 0, worker_peak_rss_mb: 0, render_pages: 0,
        export_bytes: 0, upload_bytes: 0, committed_revisions: 0 },
      ...extra.event,
    },
  });
}

for (const code of ['NOT_FOUND', 'workspace-not-found', 'workspace-internal-error']) {
  test(`tool error event accepts matching ${code}`, () => {
    assert.equal(validateErrorCode('tool_error', code, code).length, 0);
  });
  test(`tool error event rejects a mismatching ${code}`, () => {
    for (const errorCode of [null, 'different-code']) {
      assert.ok(validateErrorCode('tool_error', code, errorCode).includes('Event error_code differs from tool result'));
    }
  });
}

test('successful event requires a null error_code', () => {
  assert.equal(validateErrorCode('ok', undefined, null).length, 0);
  assert.ok(validateErrorCode('ok', undefined, 'NOT_FOUND').includes('Unexpected event error_code'));
});

for (const tool of ['outline', 'read', 'find']) {
  for (const executor of ['none', 'warm']) {
    test(`${tool} accepts Worktree identity with ${executor} for success and tool errors`, () => {
      const globals = { tool, args: { worktree: 'wt-1', unit: 'unit-1' } };
      const event = { tool, repo: 'team-1', unit_type: 'sheet', executor };
      assert.equal(validateErrorCode('ok', undefined, null, { globals, event }).length, 0);
      assert.equal(validateErrorCode('tool_error', 'workspace-sheet-lens-unit-type-unsupported',
        'workspace-sheet-lens-unit-type-unsupported', { globals, event }).length, 0);
    });
  }
}

test('event authentication must match the chosen --auth mode', () => {
  const globals = { auth: 'pat', patId: 'pat-1' };
  assert.ok(validateErrorCode('ok', undefined, null, { globals }).includes('Event authentication differs from --auth pat'));
  assert.ok(validateErrorCode('ok', undefined, null).length === 0);
});

test('executor events require nonnegative cost and none requires zero worker cost', () => {
  const cost = { worker_cpu_ms: 3, worker_peak_rss_mb: 0, render_pages: 0, export_bytes: 0, upload_bytes: 0, committed_revisions: 1 };
  for (const executor of ['cold_start', 'warm']) {
    assert.equal(validateErrorCode('ok', undefined, null, { event: { executor, unit_type: 'sheet', cost } }).length, 0);
  }
  assert.ok(validateErrorCode('ok', undefined, null, { event: { executor: 'none', cost } }).includes('Invalid cost.worker_cpu_ms'));
  assert.ok(validateErrorCode('ok', undefined, null, { event: { executor: 'warm', unit_type: 'sheet', cost: { ...cost, worker_cpu_ms: -1 } } }).includes('Invalid cost.worker_cpu_ms'));
});

test('gateway file transfers record only the appropriate bytes with no executor', () => {
  const zero = { worker_cpu_ms: 0, worker_peak_rss_mb: 0, render_pages: 0, export_bytes: 0, upload_bytes: 0, committed_revisions: 0 };
  for (const tool of ['blob_download', 'asset_download', 'blob_upload', 'blob_replace', 'import', 'export']) {
    const key = ['blob_upload', 'blob_replace', 'import'].includes(tool) ? 'upload_bytes' : 'export_bytes';
    const cost = { ...zero, [key]: 3 };
    const globals = { tool, args: { space: 'space' } };
    assert.equal(validateErrorCode('ok', undefined, null, { globals, event: { tool, repo: 'space', cost } }).length, 0);
  }
  for (const key of ['worker_cpu_ms', 'worker_peak_rss_mb', 'render_pages', 'committed_revisions']) {
    assert.ok(validateErrorCode('ok', undefined, null, {
      globals: { tool: 'blob_download', args: { space: 'space' } },
      event: { tool: 'blob_download', repo: 'space', cost: { ...zero, export_bytes: 3, [key]: 1 } },
    }).includes(`Invalid cost.${key}`));
  }
  assert.ok(validateErrorCode('ok', undefined, null, { event: { cost: { ...zero, export_bytes: 3 } } }).includes('Invalid cost.export_bytes'));
});

test('OAuth transcript redaction preserves JSON strings with escaped quotes', () => {
  const doc = readFileSync(new URL('../features/mcp.md', import.meta.url), 'utf8');
  const code = doc.match(/mo1_redact\(\) \{[\s\S]*?<<'JS'\n([\s\S]*?)\nJS/)[1];
  const run = mkdtempSync(join(tmpdir(), 'verify-uvw-redact-'));
  try {
    const path = join(run, 'transcript.jsonl');
    writeFileSync(path, JSON.stringify({ type: 'tool_use', input: { code: 'return tools["ws"].whoami();', state: 'private-state' }, output: 'ok' }) + '\n');
    const result = spawnSync(process.execPath, ['-', run, path], { input: code, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { type: 'tool_use', input: { code: '[REDACTED]', state: '[REDACTED]' }, output: 'ok' });
  } finally { rmSync(run, { recursive: true, force: true }); }
});

test('an agent principal event is matched by its user, whatever PAT id the gateway reports', () => {
  const globals = { auth: 'pat', patId: undefined, principalId: 'agent-1' };
  const event = { auth_kind: 'pat', client_id: 'pat-id-never-returned', user_id: 'agent-1' };
  assert.equal(validateErrorCode('ok', undefined, null, { globals, event }).length, 0);
  for (const wrong of [{ user_id: 'human-1' }, { auth_kind: 'dev' }]) {
    assert.ok(validateErrorCode('ok', undefined, null, { globals, event: { ...event, ...wrong } }).includes('Event authentication differs from --auth pat'));
  }
});

for (const tool of ['skill_draft_create', 'skill_draft_get']) {
  test(`${tool} attributes a resolved Space without a top-level repo argument`, () => {
    const globals = { tool, args: tool === 'skill_draft_create' ? { destination: { personal: true } } : { draft: 'draft-1' } };
    assert.equal(validateErrorCode('ok', undefined, null, { globals, event: { tool, repo: 'space-1' } }).length, 0);
    assert.ok(validateErrorCode('ok', undefined, null, { globals, event: { tool, repo: null } }).includes('Unexpected repository or Unit identity'));
  });
}

for (const tool of ['fork_view', 'fork_delete']) {
  test(`${tool} attributes the fork's upstream without a repo argument`, () => {
    const globals = { tool, args: { fork: 'agent/fix' } };
    assert.equal(validateErrorCode('ok', undefined, null, { globals, event: { tool, repo: 'space-1' } }).length, 0);
    assert.ok(validateErrorCode('ok', undefined, null, { globals, event: { tool, repo: null } }).includes('Unexpected repository or Unit identity'));
  });
}

test('a read through a fork address records a repository only when it reads the fork\'s Worktree', () => {
  const globals = { tool: 'read', args: { worktree: 'agent/fix', unit: 'u1' } };
  const read = (kind, repo) => validateErrorCode('ok', undefined, null, {
    globals, result: { structuredContent: { scope: { kind } } }, event: { tool: 'read', executor: 'warm', unit_type: 'sheet', repo },
  });
  assert.ok(!read('trunk', null).includes('Unexpected repository or Unit identity'));
  assert.ok(!read('worktree', 'space-1').includes('Unexpected repository or Unit identity'));
  assert.ok(read('worktree', null).includes('Unexpected repository or Unit identity'));
  assert.ok(read('trunk', 'space-1').includes('Unexpected repository or Unit identity'));
});

for (const target of [{ space: 'space-1' }, { page: 'page-1', etag: '"v1"' }, { draft: 'draft-1' }]) {
  test(`HTML View saves resolve repository identity through ${Object.keys(target)[0]}`, () => {
    const globals = { tool: 'html_view_save', args: target };
    const event = { tool: 'html_view_save', repo: 'space-1', cost: {
      worker_cpu_ms: 0, worker_peak_rss_mb: 0, render_pages: 0,
      export_bytes: 0, upload_bytes: 20, committed_revisions: 0,
    } };
    assert.equal(validateErrorCode('ok', undefined, null, { globals, event }).length, 0);
    assert.ok(validateErrorCode('ok', undefined, null, { globals, event: { ...event, repo: null } }).includes('Unexpected repository or Unit identity'));
  });
}

test('HTML View dry runs accept validation without a draft or repository and reject writes', () => {
  const globals = { tool: 'html_view_save', args: { html: '<p>Static</p>', dryRun: true } };
  const result = { structuredContent: { dryRun: true, valid: true, bindings: [], bindingCount: 0 } };
  const validate = (result, costs = {}) => validateErrorCode('ok', undefined, null, {
    globals, result, event: { tool: 'html_view_save', executor: 'warm', cost: {
      worker_cpu_ms: 1, worker_peak_rss_mb: 1, render_pages: 0, export_bytes: 0,
      upload_bytes: 13, committed_revisions: 0, ...costs,
    } },
  });
  assert.equal(validate(result).length, 0);
  assert.ok(validate({ structuredContent: { ...result.structuredContent, draft: {} } }).includes('HTML View dry run must validate without creating a draft'));
  assert.ok(validate(result, { committed_revisions: 1 }).includes('HTML View dry run must validate without creating a draft'));
});

for (const target of [{}, { space: 'space-1', name: 'page' }, { page: 'page-1', etag: '"v1"' }, { draft: 'draft-1' }, { repo: 'owner/repo', pr: '3' }, { repo: 'owner/repo' }]) {
  test(`HTML View dry runs record no repository (${Object.keys(target).join('+') || 'none'})`, () => {
    const globals = { tool: 'html_view_save', args: { html: '<p>Static</p>', dryRun: true, ...target } };
    const result = { structuredContent: { dryRun: true, valid: true, bindings: [], bindingCount: 0 } };
    const event = { tool: 'html_view_save', executor: 'warm', repo: null, cost: {
      worker_cpu_ms: 1, worker_peak_rss_mb: 1, render_pages: 0, export_bytes: 0, upload_bytes: 13, committed_revisions: 0,
    } };
    assert.equal(validateErrorCode('ok', undefined, null, { globals, result, event }).length, 0);
  });
}
