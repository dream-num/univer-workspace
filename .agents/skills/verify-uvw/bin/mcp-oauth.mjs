#!/usr/bin/env node
// verify-uvw mcp-oauth <login|refresh|reuse|revoke|direct|exchange> <label> [options]
// Tokens live in home/ (mode 0600). Evidence keeps only redacted shapes, never a token, code, verifier or state.
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [run, origin, mcpUrl, username, command, label, ...args] = process.argv.slice(2);
const usage = message => {
  console.error(`${message}\nUsage: verify-uvw mcp-oauth login <label> [--scopes read,write,...] [--client-id <https-url>]\n       verify-uvw mcp-oauth refresh|reuse|revoke|direct <label>\n       verify-uvw mcp-oauth exchange <label> pat|oauth`);
  process.exit(2);
};
if (!['login', 'refresh', 'reuse', 'revoke', 'direct', 'exchange'].includes(command) || !/^[A-Za-z0-9._-]{1,64}$/.test(label ?? '')) usage('Invalid command or label');
const home = name => join(run, 'home', name);
const secret = name => readFileSync(home(name), 'utf8').trim();
const keep = (name, value) => writeFileSync(home(name), value, { mode: 0o600 });
const evidence = join(run, 'evidence', label);
const secrets = () => ['mcp-oauth-access', 'mcp-oauth-refresh', 'mcp-oauth-refresh-previous', 'mcp-token', 'mcp-session', 'mcp-oauth-secret']
  .filter(name => existsSync(home(name))).map(secret).filter(Boolean);
const redact = text => secrets().reduce((value, s) => value.split(s).join('[REDACTED]'), text)
  .replace(/uvw_(?:at|rt|pat)_[A-Za-z0-9._~-]+/g, '[REDACTED]');
const shape = body => body && typeof body === 'object'
  ? Object.fromEntries(Object.entries(body).map(([k, v]) => [k, ['access_token', 'refresh_token'].includes(k) && typeof v === 'string' ? `<${v.slice(0, 7)}… ${v.length} chars>` : v]))
  : body;
const save = (record, ok) => {
  writeFileSync(`${evidence}.json`, redact(`${JSON.stringify(record, null, 2)}\n`));
  process.stdout.write(redact(`${JSON.stringify(record)}\n`));
  process.exitCode = ok ? 0 : 1;
};
const form = async (path, fields) => {
  const response = await fetch(origin + path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams(fields) });
  const text = await response.text();
  let body = text;
  try { body = JSON.parse(text); } catch {}
  return { status: response.status, cache_control: response.headers.get('cache-control'), body };
};
const keepGrant = body => {
  keep('mcp-oauth-access', body.access_token);
  keep('mcp-oauth-refresh', body.refresh_token);
};

if (command === 'login') {
  let scopes = ['read', 'write', 'publish', 'worktree:merge'];
  let clientId;
  while (args.length) {
    const flag = args.shift(), value = args.shift();
    if (value === undefined) usage(`Missing value for ${flag}`);
    if (flag === '--scopes') scopes = value.split(',').filter(Boolean);
    else if (flag === '--client-id' && URL.canParse(value) && new URL(value).protocol === 'https:') clientId = value;
    else usage(`Unknown or invalid option ${flag}`);
  }
  const callback = createServer();
  await new Promise(resolve => callback.listen(0, '127.0.0.1', resolve));
  const redirectUri = `http://127.0.0.1:${callback.address().port}/callback`;
  const received = new Promise(resolve => callback.on('request', (request, response) => {
    response.end('verify-uvw received the authorization response');
    resolve(new URL(request.url, redirectUri));
  }));
  // Arguments carry the password and the authorize URL with its state, so a failure names only the subcommand.
  const browser = (...a) => {
    try { return execFileSync('agent-browser', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000 }); }
    catch { throw new Error(`agent-browser ${a[0]} failed`); }
  };
  try {
    if (clientId === undefined) {
      const registration = await fetch(`${origin}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_name: `verify-uvw ${label}`, redirect_uris: [redirectUri], grant_types: ['authorization_code', 'refresh_token'], token_endpoint_auth_method: 'none' }) });
      const client = await registration.json();
      if (registration.status !== 201 || typeof client.client_id !== 'string') throw new Error(`Registration returned ${registration.status}`);
      clientId = client.client_id;
    }
    const verifier = randomBytes(48).toString('base64url'), state = randomBytes(24).toString('base64url');
    const authorize = new URL('/api/auth/authorize', origin);
    authorize.search = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state, resource: mcpUrl,
      scope: 'read write publish worktree:merge', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
    browser('cookies', 'clear');
    browser('open', `${origin}/login`);
    browser('storage', 'local', 'set', 'univer-workspace-language', 'en-US');
    browser('reload');
    browser('wait', '--text', 'Username');
    browser('find', 'label', 'Username', 'fill', username);
    browser('find', 'label', 'Password', 'fill', readFileSync(join(run, 'user.pw'), 'utf8'));
    browser('click', 'form button[type=submit]');
    browser('wait', '--url', '**/home');
    browser('open', authorize.href);
    browser('wait', '--text', 'Connect an AI assistant');
    const readChecks = () => JSON.parse(JSON.parse(browser('eval', "JSON.stringify(Object.fromEntries([...document.querySelectorAll('input[name=scope]')].map(i => [i.value, i.checked])))")));
    const clientName = JSON.parse(browser('eval', "document.querySelector('.request strong').textContent"));
    const offered = readChecks();
    for (const scope of Object.keys(offered)) if (!scopes.includes(scope)) browser('click', `input[name=scope][value="${scope}"]`);
    const submitted = readChecks();
    browser('screenshot', `${evidence}-consent.png`);
    browser('find', 'role', 'button', 'click', '--name', 'Allow', '--exact');
    let timer;
    const answer = await Promise.race([received, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('No callback within 30 s')), 30000); })]).finally(() => clearTimeout(timer));
    if (answer.searchParams.get('state') !== state || !answer.searchParams.get('code')) throw new Error(`Callback carried ${answer.searchParams.get('error') ?? 'no code'} or a wrong state`);
    if (answer.searchParams.get('iss') !== origin) throw new Error('Callback issuer does not match Workspace');
    const token = await form('/api/auth/token', { grant_type: 'authorization_code', client_id: clientId, code: answer.searchParams.get('code'),
      code_verifier: verifier, redirect_uri: redirectUri, resource: mcpUrl });
    const ok = token.status === 200 && typeof token.body.access_token === 'string';
    if (ok) {
      keepGrant(token.body);
      keep('mcp-oauth-client-id', clientId);
    }
    save({ client_id: clientId, client_name: clientName, callback_code_present: true, callback_state_matches: true, callback_iss: answer.searchParams.get('iss'), offered, submitted, callback_scope: answer.searchParams.get('scope'), token: { ...token, body: shape(token.body) } }, ok);
  } finally {
    callback.close();
  }
} else if (command === 'refresh' || command === 'reuse') {
  const refresh = secret(command === 'refresh' ? 'mcp-oauth-refresh' : 'mcp-oauth-refresh-previous');
  const token = await form('/api/auth/token', { grant_type: 'refresh_token', client_id: secret('mcp-oauth-client-id'), refresh_token: refresh, resource: mcpUrl });
  const ok = token.status === 200 && typeof token.body.access_token === 'string';
  if (ok) {
    keep('mcp-oauth-refresh-previous', refresh);
    keepGrant(token.body);
  }
  save({ ...token, body: shape(token.body) }, ok);
} else if (command === 'revoke') {
  const revoked = await form('/api/auth/revoke', { token: secret('mcp-oauth-access'), client_id: secret('mcp-oauth-client-id') });
  save(revoked, revoked.status === 200);
} else if (command === 'direct') {
  // The MCP access token must not work as a Workspace credential, neither as Bearer nor as the session cookie.
  const token = secret('mcp-oauth-access');
  const probe = async headers => (await fetch(`${origin}/api/session`, { headers })).json();
  const record = { bearer: await probe({ authorization: `Bearer ${token}` }), cookie: await probe({ cookie: `workspace_session=${token}` }) };
  save(record, record.bearer.authenticated === false && record.cookie.authenticated === false);
} else {
  const kind = args[0];
  if (!['pat', 'oauth'].includes(kind)) usage('exchange needs pat or oauth');
  const exchanged = await form('/api/auth/token', { grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange', client_id: 'univer-workspace-mcp-gateway',
    client_secret: secret('mcp-oauth-secret'), subject_token: secret(kind === 'pat' ? 'mcp-token' : 'mcp-oauth-access'),
    subject_token_type: 'urn:ietf:params:oauth:token-type:access_token', resource: mcpUrl });
  const ok = exchanged.status === 200;
  if (ok) {
    // The downstream session is a live credential: drop it from the server right away.
    await fetch(`${origin}/api/auth/logout`, { method: 'POST', headers: { cookie: `workspace_session=${exchanged.body.access_token}`, origin } });
  }
  save({ ...exchanged, body: ok ? { ...exchanged.body, access_token: '[REDACTED]' } : exchanged.body }, ok);
}
