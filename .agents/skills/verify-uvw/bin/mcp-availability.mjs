#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Acceptance lists are literal and independent of the product registry.
export const expectedTools = {
  'core': [
    'whoami', 'repo_list', 'repo_view', 'issue_list', 'issue_view', 'issue_create', 'issue_edit',
    'issue_comment', 'issue_set_state', 'pr_list', 'pr_view', 'pr_create', 'pr_edit', 'pr_ready', 'search',
    'browse', 'space_browse', 'space_find', 'unit_list', 'unit_add', 'unit_create', 'file_upload_create',
    'execute', 'inspect', 'import', 'export', 'job_get', 'api_find', 'api_show', 'skills_read'
  ],
  'files': [
    'blob_get', 'blob_upload', 'blob_download', 'blob_replace', 'asset_download', 'html_view_validate',
    'html_view_create', 'compile_markdown', 'export_markdown', 'compile_typst', 'compile_svg'
  ],
  'admin': [
    'repo_create', 'repo_edit', 'label_list', 'label_write', 'space_node', 'pr_merge', 'pr_discard',
    'resources_registries', 'resources_find', 'resources_export'
  ],
  'core,files': [
    'whoami', 'repo_list', 'repo_view', 'issue_list', 'issue_view', 'issue_create', 'issue_edit',
    'issue_comment', 'issue_set_state', 'pr_list', 'pr_view', 'pr_create', 'pr_edit', 'pr_ready', 'search',
    'browse', 'space_browse', 'space_find', 'unit_list', 'unit_add', 'unit_create', 'file_upload_create',
    'execute', 'inspect', 'import', 'export', 'job_get', 'api_find', 'api_show', 'skills_read', 'blob_get',
    'blob_upload', 'blob_download', 'blob_replace', 'asset_download', 'html_view_validate',
    'html_view_create', 'compile_markdown', 'export_markdown', 'compile_typst', 'compile_svg'
  ],
  'core,admin': [
    'whoami', 'repo_list', 'repo_view', 'issue_list', 'issue_view', 'issue_create', 'issue_edit',
    'issue_comment', 'issue_set_state', 'pr_list', 'pr_view', 'pr_create', 'pr_edit', 'pr_ready', 'search',
    'browse', 'space_browse', 'space_find', 'unit_list', 'unit_add', 'unit_create', 'file_upload_create',
    'execute', 'inspect', 'import', 'export', 'job_get', 'api_find', 'api_show', 'skills_read', 'repo_create',
    'repo_edit', 'label_list', 'label_write', 'space_node', 'pr_merge', 'pr_discard', 'resources_registries',
    'resources_find', 'resources_export'
  ],
  'files,admin': [
    'blob_get', 'blob_upload', 'blob_download', 'blob_replace', 'asset_download', 'html_view_validate',
    'html_view_create', 'compile_markdown', 'export_markdown', 'compile_typst', 'compile_svg', 'repo_create',
    'repo_edit', 'label_list', 'label_write', 'space_node', 'pr_merge', 'pr_discard', 'resources_registries',
    'resources_find', 'resources_export'
  ],
  'all': [
    'whoami', 'repo_list', 'repo_view', 'issue_list', 'issue_view', 'issue_create', 'issue_edit',
    'issue_comment', 'issue_set_state', 'pr_list', 'pr_view', 'pr_create', 'pr_edit', 'pr_ready', 'search',
    'browse', 'space_browse', 'space_find', 'unit_list', 'unit_add', 'unit_create', 'file_upload_create',
    'execute', 'inspect', 'import', 'export', 'job_get', 'api_find', 'api_show', 'skills_read', 'blob_get',
    'blob_upload', 'blob_download', 'blob_replace', 'asset_download', 'html_view_validate',
    'html_view_create', 'compile_markdown', 'export_markdown', 'compile_typst', 'compile_svg', 'repo_create',
    'repo_edit', 'label_list', 'label_write', 'space_node', 'pr_merge', 'pr_discard', 'resources_registries',
    'resources_find', 'resources_export'
  ],
};
export const restrictedTools = [
  'whoami', 'repo_list', 'repo_view', 'issue_list', 'issue_view', 'issue_create', 'issue_edit',
  'issue_comment', 'issue_set_state', 'pr_list', 'pr_view', 'pr_create', 'pr_edit', 'pr_ready', 'search',
  'browse', 'space_browse', 'space_find', 'unit_list', 'unit_add', 'unit_create', 'file_upload_create',
  'api_find', 'api_show', 'skills_read', 'blob_get', 'blob_upload', 'blob_download', 'blob_replace',
  'asset_download', 'repo_create', 'repo_edit', 'label_list', 'label_write', 'space_node', 'pr_merge',
  'pr_discard', 'resources_registries', 'resources_find', 'resources_export'
];

async function main() {
  const repo = process.cwd(), evidence = process.env.EVIDENCE;
  assert(evidence && process.env.VERIFY_UVW_RUN, 'Load verify-uvw env first');
  const run = join(process.env.VERIFY_UVW_ROOT ?? '/tmp/verify-uvw', process.env.VERIFY_UVW_RUN);
  const settings = Object.fromEntries(readFileSync(join(run, 'run.env'), 'utf8').trim().split('\n').map(line => line.split('=')));
  assert.equal(settings.MCP_RENDERER, '0', 'MB requires VERIFY_UVW_MCP_RENDERER=0 at up');
  assert.equal(settings.MCP_EXECUTORS, '1', 'MB stops the sole executor; launch without replicas');
  const secret = name => readFileSync(join(run, 'home', name), 'utf8').trim();
  const helper = join(repo, '.agents/skills/verify-uvw/bin/verify-uvw');
  const proof = { run: settings.RUN_ID, checks: {} };
  const save = () => writeFileSync(join(evidence, 'mb.json'), JSON.stringify(proof, null, 2) + '\n');
  const passed = (id, detail) => { proof.checks[id] = { status: 'passed', ...detail }; save(); console.log(`PASS ${id}`); };
  const require = createRequire(join(repo, 'apps/mcp/package.json'));
  const { Client, StreamableHTTPClientTransport } = require('@modelcontextprotocol/client');
  const origin = process.env.ORIGIN;
  const identity = await (await fetch(origin + '/api/session', { headers: { cookie: 'workspace_session=' + secret('mcp-session') } })).json();
  assert(identity.authenticated && identity.user.id);
  const command = (args, status = 0) => {
    const result = spawnSync(helper, args, { encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] });
    assert.equal(result.status, status, `${args[0]} ${args[1]} exit ${result.status}; inspect evidence`);
    return result.stdout;
  };
  command(['mcp-allow-users', identity.user.id]);
  proof.allowlistedUser = identity.user.id;
  const connect = async (toolsets, token) => {
    const url = new URL(process.env.MCP_URL); url.searchParams.set('toolsets', toolsets);
    const client = new Client({ name: 'verify-uvw-mb', version: '1.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
    try {
      await client.connect(new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { authorization: 'Bearer ' + token } },
        fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(35_000) }),
      }));
      return client;
    } catch (error) { await client.close(); throw error; }
  };
  for (const [toolsets, expected] of Object.entries(expectedTools)) {
    const client = await connect(toolsets, secret('mcp-token'));
    try {
      const names = (await client.listTools()).tools.map(tool => tool.name);
      const instructions = client.getInstructions();
      writeFileSync(join(evidence, `mb-${toolsets.replaceAll(',', '-')}.json`), JSON.stringify({ names, instructions }, null, 2) + '\n');
      assert.deepEqual(names, expected, `${toolsets} ordered tools`);
      assert.equal(typeof instructions, 'string');
      assert(!/\b(screenshot|print_pdf|lint)\b/.test(instructions), `${toolsets} instructions hide renderer tools`);
    } finally { await client.close(); }
  }
  passed('MB1', { combinations: Object.keys(expectedTools) });
  passed('MB2');

  const registration = await fetch(origin + '/api/auth/password/register', {
    method: 'POST', headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ username: 'mb-' + randomUUID().slice(0, 12), displayName: 'MB restricted', password: randomBytes(24).toString('hex') }),
  });
  assert.equal(registration.status, 201);
  const second = await registration.json();
  const cookie = registration.headers.getSetCookie().map(value => /^workspace_session=[^;]+/.exec(value)?.[0]).find(Boolean);
  assert(cookie);
  const tokenResponse = await fetch(origin + '/api/auth/tokens', {
    method: 'POST', headers: { cookie, origin, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'MB restricted' }),
  });
  assert.equal(tokenResponse.status, 201);
  const { token } = await tokenResponse.json();
  const restricted = await connect('all', token);
  try {
    const names = (await restricted.listTools()).tools.map(tool => tool.name);
    const instructions = restricted.getInstructions();
    assert.deepEqual(names, restrictedTools);
    assert(instructions.includes('Editing document contents is not enabled for this account'));
    const unknown = async name => {
      try { return { result: await restricted.callTool({ name, arguments: {} }) }; }
      catch (error) { return { code: error.code, message: error.message.replaceAll(name, '<tool>') }; }
    };
    const execute = await unknown('execute'), missing = await unknown('mb_nonexistent_tool');
    assert(execute.code !== undefined || execute.result?.isError, 'execute must fail');
    assert.deepEqual(execute, missing, 'hidden execute fails exactly like an unknown tool');
    // A pure HTTP tool remains usable by the restricted user.
    const repos = await restricted.callTool({ name: 'repo_list', arguments: {} });
    assert(!repos.isError && repos.structuredContent.repos.length);
    writeFileSync(join(evidence, 'mb-restricted.json'), JSON.stringify({ userId: second.user.id, names, instructions, execute, missing, repoListSucceeded: true }, null, 2) + '\n');
  } finally { await restricted.close(); }
  passed('MB3', { count: restrictedTools.length });

  const mcp = (label, tool, args, status = 0, event) => {
    command(['mcp', '--auth', 'pat', ...(event ? ['--expect-event', event] : []), label, tool, JSON.stringify(args)], status);
    return JSON.parse(readFileSync(join(evidence, label + '.out'), 'utf8'));
  };
  const space = mcp('mb-mx-repo', 'repo_view', { repo: identity.user.username + '/personal' });
  const key = 'mb-' + randomUUID();
  const pr = mcp('mb-mx-pr', 'pr_create', { repo: space.id, title: 'MB executor readback', idempotency_key: key + '-pr' });
  const { unit } = mcp('mb-mx-unit', 'unit_create', { worktree: pr.id, space: space.id, type: 'sheet', name: 'Executor sheet', idempotency_key: key + '-unit' });
  const target = { worktree: pr.id, unit: unit.unitId };
  const code = 'const ws = workbook.getActiveSheet(); ws.getRange("A1:B2").setValues([["Region","Total"],["North",42]]); return ws.getRange("A1:B2").getValues();';
  const execute = mcp('mb-mx-execute', 'execute', { ...target, code }, 0, '.executor == "cold_start" and .cost.committed_revisions == 1 and .cost.worker_cpu_ms > 0 and .unit_type == "sheet"');
  const inspected = mcp('mb-mx-inspect', 'inspect', { ...target, target: 'range', selectors: ['A1:B2'], worksheet: 'index:1' }, 0, '.executor == "warm" and .cost.committed_revisions == 0 and .unit_type == "sheet"');
  command(['cli', 'mb-mx-inspect-cli', 'inspect', 'range', 'A1:B2', '--worktree', pr.id, '--unit', unit.unitId, '--worksheet', 'index:1', '--json']);
  assert.deepEqual(inspected, JSON.parse(readFileSync(join(evidence, 'mb-mx-inspect-cli.out'), 'utf8')));
  assert.deepEqual(inspected.ranges[0].displayValues, [['Region', 'Total'], ['North', '42']]);
  command(['cli', 'mb-mx-execute-cli', 'execute', '--worktree', pr.id, '--unit', unit.unitId, '--json', '-e', code]);
  const cliExecute = JSON.parse(readFileSync(join(evidence, 'mb-mx-execute-cli.out'), 'utf8'));
  assert.deepEqual(Object.keys(execute).sort(), Object.keys(cliExecute).sort());
  assert.deepEqual(execute.value, cliExecute.value);
  const doctor = command(['doctor']);
  writeFileSync(join(evidence, 'mb-mx-doctor.txt'), doctor);
  assert(!doctor.includes('FAIL'));
  mcp('mb-mx-ready', 'pr_ready', { repo: space.id, number: pr.id });
  const ready = mcp('mb-mx-ready-execute', 'execute', { ...target, code: 'return 1' }, 1);
  assert.equal(ready.code, 'workspace-worktree-not-editable');
  assert.equal(ready.detail.state, 'ready');

  const readiness = async () => {
    const response = await fetch(new URL('/readyz', process.env.MCP_URL), { signal: AbortSignal.timeout(1000) });
    return { status: response.status, body: await response.text() };
  };
  const before = await readiness();
  const missingReadiness = before.status === 404;
  if (!missingReadiness) assert.equal(before.status, 200);
  // Workspace has no stop/restart command; do not kill it without a supported restart path.
  proof.workspaceReadiness = { status: 'not_run', reason: 'verify-uvw has no independent Workspace stop/restart command' };
  const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] });
  const container = docker(['ps', '-q', '--filter', `label=com.docker.compose.project=${settings.MCP_PROJECT}`, '--filter', 'label=com.docker.compose.service=executor']).trim();
  assert(container && !container.includes('\n'));
  let stopped, after;
  try {
    docker(['stop', container]);
    const unavailable = mcp('mb-mx-stopped', 'inspect', { ...target, target: 'workbook' }, 1);
    assert.equal(unavailable.code, 'workspace-executor-unavailable');
    if (!missingReadiness) {
      command(['mcp-gateway-restart']);
      stopped = await readiness();
      assert.equal(stopped.status, 503);
      assert(/executor/i.test(stopped.body));
    }
  } finally { docker(['start', container]); }
  if (!missingReadiness) {
    const deadline = Date.now() + 10_000;
    do {
      after = await readiness().catch(() => ({ status: 0 }));
      if (after.status === 200) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    } while (Date.now() < deadline);
    assert.equal(after.status, 200, 'readyz recovers within ten seconds');
  }
  passed('MB4', { journeys: ['MX1', 'MX2', 'MX3'] });
  proof.checks.MB5 = missingReadiness ? { status: 'not_run', reason: '/readyz returned 404 at this base' } : { status: 'passed', before, stopped, after };
  save();
  console.log(missingReadiness ? 'NOT RUN MB5 /readyz returned 404' : 'PASS MB5');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error('FAIL MB journey; ' + (error instanceof assert.AssertionError ? error.message : 'inspect mb.json and per-call evidence')); process.exitCode = 1; });
}
