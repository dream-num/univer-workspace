import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

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
    tool: 'repo_view',
    args: {},
    auth: 'dev',
    patId: null,
    ...extra.globals,
    protocol: '2026-07-28',
    result: { isError: outcome === 'tool_error', structuredContent: { code } },
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
