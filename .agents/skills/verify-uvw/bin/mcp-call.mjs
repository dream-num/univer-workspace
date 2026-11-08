#!/usr/bin/env node
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const internal = {};
for (const name of ['repo', 'run', 'url', 'project', 'image', 'origin', 'server-port']) {
  if (argv.shift() !== `--${name}` || !argv.length) usage(`Missing internal --${name}`);
  internal[name] = argv.shift();
}
const mode = argv.shift();
let protocol = '2026-07-28', auth, toolsets, expectEvent;
while (argv[0]?.startsWith('--')) {
  const flag = argv.shift(), value = argv.shift();
  if (value === undefined) usage(`Missing value for ${flag}`);
  if (flag === '--protocol') protocol = value;
  else if (flag === '--auth' && mode !== 'tools') auth = value;
  else if (flag === '--expect-event' && mode === 'call') expectEvent = value;
  else if (flag === '--toolsets') toolsets = value;
  else usage(`Unknown option ${flag}`);
}
const [label, tool, json = '{}'] = argv;
// A run with a PAT authenticates through the gateway's token exchange; without one only the development session works.
auth ??= existsSync(join(internal.run, 'home/mcp-token')) ? 'pat' : 'dev';
const listing = ['tools', 'resources', 'instructions'].includes(mode);
if (!['call', 'tools', 'doctor', 'resources', 'resource', 'instructions'].includes(mode) || !/^[A-Za-z0-9._-]{1,64}$/.test(label ?? '') ||
    !['2026-07-28', '2025-11-25'].includes(protocol) || !['pat', 'dev', 'none', 'invalid'].includes(auth) ||
    (listing ? argv.length !== 1 : mode === 'resource' ? argv.length !== 2 : argv.length < 2 || argv.length > 3)) usage('Invalid command, label, protocol, or authentication mode');
let args;
try { args = JSON.parse(json); } catch { usage('Tool arguments must be a JSON object'); }
if (args === null || typeof args !== 'object' || Array.isArray(args)) usage('Tool arguments must be a JSON object');

function usage(message) {
  console.error(`${message}\nUsage: verify-uvw mcp [--protocol 2026-07-28|2025-11-25] [--auth pat|dev|none|invalid] [--toolsets list] <label> <tool> [json]\n       verify-uvw mcp-tools [--protocol version] [--toolsets list] <label>\n       verify-uvw mcp-resources [--protocol version] [--toolsets list] <label>\n       verify-uvw mcp-resource [--protocol version] [--toolsets list] <label> <uri>\n       verify-uvw mcp-instructions [--protocol version] [--toolsets list] <label>`);
  process.exit(2);
}
const requestId = `${label}.${randomBytes(4).toString('hex')}`;
const url = new URL(internal.url);
if (toolsets !== undefined) url.searchParams.set('toolsets', toolsets);
const base = join(internal.run, 'evidence', label);
const record = mode !== 'doctor';
const save = (suffix, value) => { if (record) writeFileSync(`${base}.${suffix}`, value); };
const pretty = value => `${JSON.stringify(value, null, 2)}\n`;
const command = ['verify-uvw', mode === 'call' ? 'mcp' : `mcp-${mode}`, '--protocol', protocol,
  ...(mode === 'call' ? ['--auth', auth] : []), ...(toolsets === undefined ? [] : ['--toolsets', toolsets]), ...(expectEvent === undefined ? [] : ['--expect-event', expectEvent]),
  label, ...(listing ? [] : mode === 'resource' ? [tool] : [tool, json])];
save('cmd', `${command.map(a => JSON.stringify(a)).join(' ')}\nURL=${url}\nprotocol=${protocol}\nauth=${auth}\n`);
// A repeated label must not retain an event from an earlier call.
save('event.json', '');
if (record && mode !== 'call') {
  const { unlinkSync } = await import('node:fs');
  unlinkSync(`${base}.event.json`);
}
let bearer, patId, client, result, negotiated, output, code = 3;
const errors = [], responses = [];
try {
  bearer = auth === 'dev' ? readFileSync(join(internal.run, 'home/mcp-session'), 'utf8').trim()
    : auth === 'pat' ? readFileSync(join(internal.run, 'home/mcp-token'), 'utf8').trim()
    : auth === 'invalid' ? randomBytes(24).toString('hex') : undefined;
  if (auth === 'dev' && !bearer) throw new Error('Missing MCP session; run verify-uvw user');
  if (auth === 'pat') patId = readFileSync(join(internal.run, 'home/mcp-token-id'), 'utf8').trim();
  const require = createRequire(join(internal.repo, 'apps/mcp/package.json'));
  const { Client, StreamableHTTPClientTransport } = require('@modelcontextprotocol/client');
  client = new Client({ name: 'verify-uvw', version: '1.0.0' }, {
    versionNegotiation: { mode: protocol === '2026-07-28' ? { pin: protocol } : 'legacy' },
  });
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { 'x-request-id': requestId, ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) } },
    fetch: async (input, init) => {
      const response = await fetch(input, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(35000)]) });
      responses.push({ status: response.status, www_authenticate: response.headers.get('www-authenticate'), body: response.ok ? null : await response.clone().text() });
      return response;
    },
  });
  await client.connect(transport);
  negotiated = client.getNegotiatedProtocolVersion();
  if (negotiated !== protocol) throw new Error(`Expected protocol ${protocol}, negotiated ${negotiated}`);
  if (mode === 'instructions') {
    result = { instructions: client.getInstructions() ?? null };
    output = result;
  } else if (mode === 'resources') {
    result = await client.listResources();
    output = result.resources;
  } else if (mode === 'resource') {
    result = await client.readResource({ uri: tool });
    output = result.contents;
  } else {
    result = mode === 'tools' ? await client.listTools() : await client.callTool({ name: tool, arguments: args });
    output = mode === 'tools' ? result.tools.map(({ name, description, annotations, inputSchema, outputSchema }) =>
      ({ name, description, annotations, inputSchema, outputSchema })) : result.structuredContent;
  }
  code = result.isError === true ? 1 : 0;
} catch (error) {
  const http = responses.find(r => r.status === 401) ?? responses.findLast(r => r.status < 200 || r.status >= 300);
  code = http?.status === 401 ? 4 : 3;
  output = http ?? null;
  errors.push(error instanceof Error ? error.message : String(error));
} finally {
  if (client) await client.close().catch(error => errors.push(`Client close failed: ${error.message}`));
}

if (record) {
  let gateway = '', workspace = '';
  let executor = '';
  const parse = line => { try { return JSON.parse(line); } catch { return undefined; } };
  try {
    const tokenPath = join(internal.run, 'home/metrics-token');
    gateway = execFileSync('docker', ['compose', '-p', internal.project, '-f', join(internal.repo, 'apps/mcp/docker/compose.verify.yml'),
      'logs', '--no-color', '--no-log-prefix', 'gateway', 'executor'], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, VERIFY_UVW_MCP_PROJECT: internal.project, VERIFY_UVW_MCP_IMAGE: internal.image,
        VERIFY_UVW_ORIGIN: internal.origin, VERIFY_UVW_SERVER_PORT: internal['server-port'], VERIFY_UVW_MCP_PORT: url.port,
        VERIFY_UVW_METRICS_TOKEN: readFileSync(tokenPath, 'utf8').trim(),
        VERIFY_UVW_INTERNAL_TOKEN: readFileSync(join(internal.run, 'home/internal-token'), 'utf8').trim(),
        VERIFY_UVW_MCP_OAUTH_SECRET: readFileSync(join(internal.run, 'home/mcp-oauth-secret'), 'utf8').trim() } });
  } catch { errors.push('Cannot read gateway logs'); }
  try { workspace = readFileSync(join(internal.run, 'logs/server.log'), 'utf8'); }
  catch { errors.push('Cannot read Workspace logs'); }
  const gatewayLines = gateway.split('\n').filter(line => {
    const value = parse(line);
    return value?.request_id === requestId || value?.req?.id === requestId;
  });
  executor = gatewayLines.filter(line => parse(line)?.msg === 'Executor request completed').join('\n');
  const workspaceLines = workspace.split('\n').filter(line => parse(line)?.req?.id === requestId);
  const events = gatewayLines.map(parse).filter(value => value?.event === 'mcp.tool_call' && value.request_id === requestId);
  const leaked = bearer && gateway.includes(bearer);
  const redact = value => bearer ? value.split(bearer).join('[REDACTED]') : value;
  save('gateway.log', redact(gatewayLines.join('\n') + (gatewayLines.length ? '\n' : '')));
  save('executor.log', redact(executor));
  save('workspace.log', redact(workspaceLines.join('\n') + (workspaceLines.length ? '\n' : '')));
  if (mode === 'call' && events.length) save('event.json', redact(pretty(events.length === 1 ? events[0] : events)));
  if (code === 0 || code === 1) {
    const issues = [];
    if (auth === 'dev' && !workspaceLines.length) issues.push('Workspace correlation log is empty');
    if (leaked) issues.push('Gateway log contains the Bearer credential');
    if (mode === 'call') {
      if (events.length !== 1) issues.push(`Expected one usage event, found ${events.length}`);
      else {
        issues.push(...eventIssues(events[0]));
        if (expectEvent !== undefined) {
          try { execFileSync('jq', ['-e', expectEvent], { input: JSON.stringify(events[0]), stdio: ['pipe', 'ignore', 'pipe'] }); }
          catch { issues.push(`Event does not satisfy --expect-event ${expectEvent}`); }
        }
      }
    }
    if (issues.length) { code = 5; errors.push(...issues); }
  }
}
const redact = value => bearer ? value.split(bearer).join('[REDACTED]') : value;
const out = redact(pretty(output ?? null));
const err = redact(errors.join('\n') + (errors.length ? '\n' : ''));
save('out', out);
save('result.json', redact(pretty({ ...result, protocolVersion: negotiated ?? null, request_id: requestId })));
save('err', err);
save('exit', `${code}\n`);
process.stdout.write(out);
process.stderr.write(err);
if (record) process.stderr.write(`[exit ${code}; evidence ${base}.*]\n`);
process.exitCode = code;

function eventIssues(event) {
  const issues = [];
  const nullable = ['trace_id', 'client_name', 'client_version', 'repo', 'unit_type', 'error_code'];
  const required = ['event', 'schema_version', 'ts', 'request_id', 'user_id', 'auth_kind', 'client_id', 'tool', 'toolset', 'outcome', 'duration_ms', 'executor', 'cost'];
  for (const key of [...nullable, ...required]) {
    if (!(key in event) || (required.includes(key) && event[key] == null)) issues.push(`Missing event field ${key}`);
  }
  if (event.schema_version !== 1 || !['none', 'cold_start', 'warm'].includes(event.executor)) issues.push('Invalid event version or executor');
  const [kind, clientId] = auth === 'pat' ? ['pat', patId] : ['dev', 'dev'];
  if (event.auth_kind !== kind || event.client_id !== clientId) issues.push(`Event authentication differs from --auth ${auth}`);
  for (const key of ['worker_cpu_ms', 'worker_peak_rss_mb', 'render_pages', 'export_bytes', 'upload_bytes', 'committed_revisions']) {
    if (typeof event.cost?.[key] !== 'number' || !Number.isFinite(event.cost[key]) || event.cost[key] < 0 || (event.executor === 'none' && event.cost[key] !== 0)) issues.push(`Invalid cost.${key}`);
  }
  for (const key of ['ts', 'request_id', 'user_id', 'tool', 'toolset']) {
    if (typeof event[key] !== 'string' || !event[key]) issues.push(`Invalid event ${key}`);
  }
  if (Number.isNaN(Date.parse(event.ts)) || typeof event.duration_ms !== 'number' || event.duration_ms < 0) issues.push('Invalid event timestamp or duration');
  if (event.tool !== tool || (result.isError ? !['tool_error', 'timeout', 'internal_error'].includes(event.outcome) : event.outcome !== 'ok')) issues.push('Event does not match tool result');
  for (const key of ['client_name', 'client_version']) {
    if (protocol === '2026-07-28' ? typeof event[key] !== 'string' || !event[key] : event[key] !== null) issues.push(`Invalid ${protocol} ${key}`);
  }
  if (event.trace_id !== null) issues.push('Unexpected trace_id without traceparent');
  // These tools resolve their Space from a Worktree, Resource, Node or created repository instead of a `repo` argument.
  const resolvesRepo = typeof args.repo === 'string' || typeof args.space === 'string' ||
    ['unit_list', 'unit_add', 'blob_get', 'repo_create', 'space_node'].includes(tool) || (['execute', 'inspect'].includes(tool) && typeof args.worktree === 'string');
  if ((event.executor === 'none' ? event.unit_type !== null : typeof event.unit_type !== 'string') || (!resolvesRepo && event.repo !== null) || (resolvesRepo && !result.isError && typeof event.repo !== 'string')) issues.push('Unexpected repository or Unit identity');
  if (event.outcome === 'tool_error' || event.outcome === 'timeout') {
    const resultCode = result.structuredContent?.code;
    if (typeof resultCode !== 'string') issues.push('Error result has no structuredContent.code');
    else if (event.error_code !== resultCode) issues.push('Event error_code differs from tool result');
  } else if (event.error_code !== null) issues.push('Unexpected event error_code');
  return issues;
}
