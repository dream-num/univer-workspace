import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
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
