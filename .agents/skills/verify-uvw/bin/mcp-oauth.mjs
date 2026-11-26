#!/usr/bin/env node
// verify-uvw mcp-oauth <login|refresh|reuse|revoke|direct|exchange> <label> [options]
// Tokens live in home/ (mode 0600). Evidence keeps only redacted shapes, never a token, code, verifier or state.
import { createHash, randomBytes } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { redact as redactSecrets, runSecrets } from './secrets.mjs';

const [run, origin, mcpUrl, username, command, label, ...args] = process.argv.slice(2);
const usage = message => {
  console.error(`${message}\nUsage: verify-uvw mcp-oauth login <label> [--guest|--guest-card [--agent-cookie]|--connect-as new_agent|self] [--scopes read,write,...] [--client-id <https-url>|--client-name <name>] [--token-resource omit|<url>]\n       verify-uvw mcp-oauth refresh|reuse <label> [--token-resource omit|<url>]\n       verify-uvw mcp-oauth revoke|direct <label>\n       verify-uvw mcp-oauth exchange <label> pat|oauth`);
  process.exit(2);
};
if (!['login', 'refresh', 'reuse', 'revoke', 'direct', 'exchange'].includes(command) || !/^[A-Za-z0-9._-]{1,64}$/.test(label ?? '')) usage('Invalid command or label');
// The token request's `resource`: the MCP URL by default, left out with `omit`, or another URL to test a mismatch.
const at = args.indexOf('--token-resource');
const [, tokenResourceValue] = at < 0 ? [] : args.splice(at, 2);
if (at >= 0 && (!['login', 'refresh', 'reuse'].includes(command) || !(tokenResourceValue === 'omit' || URL.canParse(tokenResourceValue ?? '')))) usage('--token-resource takes omit or a URL, with login, refresh or reuse');
const tokenResource = tokenResourceValue === 'omit' ? {} : { resource: tokenResourceValue ?? mcpUrl };
const home = name => join(run, 'home', name);
const secret = name => readFileSync(home(name), 'utf8').trim();
const keep = (name, value) => writeFileSync(home(name), value, { mode: 0o600 });
const evidence = join(run, 'evidence', label);
const redact = text => redactSecrets(text, runSecrets(run));
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
  let clientId, clientName, guest = false, card = false, agentCookie = false, connectAs;
  while (args.length) {
    const flag = args.shift();
    if (flag === '--guest') { guest = true; continue; }
    if (flag === '--guest-card') { guest = card = true; continue; }
    if (flag === '--agent-cookie') { agentCookie = true; continue; }
    const value = args.shift();
    if (value === undefined) usage(`Missing value for ${flag}`);
    if (flag === '--scopes') scopes = value.split(',').filter(Boolean);
    else if (flag === '--connect-as' && ['new_agent', 'self'].includes(value)) connectAs = value;
    else if (flag === '--client-id' && URL.canParse(value) && new URL(value).protocol === 'https:') clientId = value;
    else if (flag === '--client-name' && value.trim() !== '') clientName = value;
    else usage(`Unknown or invalid option ${flag}`);
  }
  if (!guest && !username) usage('No user to sign in as; run verify-uvw user, or pass --guest');
  if (card && clientId) usage('--guest-card registers its own client, so it takes no --client-id');
  if (agentCookie && !card) usage('--agent-cookie gives the browser an agent session before the guest card, so it needs --guest-card');
  if (clientId && clientName) usage('--client-name names a client this login registers, so it takes no --client-id');
  // A guest connects only as itself. Without --connect-as the run user keeps what the page preselects: the agent it
  // owns that was made for a client of this name, else a new agent.
  if (guest && connectAs) usage('--connect-as is for the run user; a guest connects as itself');
  const noPage = guest && !card;
  const sessionUser = () => {
    browser('open', `${origin}/api/session`);
    const session = JSON.parse(browser('get', 'text', 'body'));
    return session.authenticated ? { kind: session.user.kind, username: session.user.username } : null;
  };
  const callback = createServer();
  await new Promise(resolve => callback.listen(0, '127.0.0.1', resolve));
  // A loopback callback gets a signed-out browser a guest code with no page, so the card needs a callback that is not loopback.
  const redirectUri = card ? 'https://verify-uvw.invalid/callback' : `http://127.0.0.1:${callback.address().port}/callback`;
  const received = new Promise(resolve => callback.on('request', (request, response) => {
    response.end('verify-uvw received the authorization response');
    resolve(new URL(request.url, redirectUri));
  }));
  // Arguments carry the password and the authorize URL with its state, so a failure names only the subcommand.
  const browser = (...a) => {
    try { return execFileSync('agent-browser', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000 }); }
    catch { throw new Error(`agent-browser ${a[0]} failed`); }
  };
  // An `open` that lands on the callback must not block the event loop that answers it.
  const browserAsync = (...a) => new Promise((resolve, reject) => execFile('agent-browser', a, { encoding: 'utf8', timeout: 60000 },
    (error, stdout) => (error ? reject(new Error(`agent-browser ${a[0]} failed`)) : resolve(stdout))));
  try {
    if (clientId === undefined) {
      const registration = await fetch(`${origin}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_name: clientName ?? `verify-uvw ${label}`, redirect_uris: [redirectUri], grant_types: ['authorization_code', 'refresh_token'], token_endpoint_auth_method: 'none' }) });
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
    // An agent's cookie, as `uvw auth guest` gets it, which authorize must treat as signed out.
    if (agentCookie && JSON.parse(browser('eval', "fetch('/api/auth/guest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(r => r.status)")) !== 201) {
      throw new Error('POST /api/auth/guest did not create an agent in the browser');
    }
    const browserUserBefore = guest ? sessionUser() : undefined;
    const limited = `this address reached an hourly limit: either ${process.env.VERIFY_UVW_AGENT_LIMIT_REASON || 'agent creation, which a higher VERIFY_UVW_AGENT_CREATE_LIMIT before up raises'}, or the server's fixed limit on client metadata checks`;
    if (noPage) {
      await browserAsync('open', authorize.href);
      if (browser('get', 'text', 'body').includes('AGENT_CREATE_RATE_LIMITED')) throw new Error(`authorize says ${limited}`);
    } else if (card) {
      // The login page offers the guest agent card only when it was reached from an authorize request.
      browser('network', 'route', 'https://verify-uvw.invalid/**', '--body', '{}');
      browser('open', authorize.href);
      browser('wait', '--text', 'Continue as a guest agent');
      browser('screenshot', `${evidence}-guest-card.png`);
      browser('find', 'role', 'button', 'click', '--name', 'Continue as a guest agent');
      browser('wait', '1500');
      if (browser('get', 'text', 'body').includes('hourly limit for guest agent requests')) throw new Error(`the guest card says ${limited}`);
    } else {
      browser('find', 'label', 'Username', 'fill', username);
      browser('find', 'label', 'Password', 'fill', readFileSync(join(run, 'user.pw'), 'utf8'));
      browser('click', 'form button[type=submit]');
      browser('wait', '--url', '**/home');
      browser('open', authorize.href);
    }
    let shownName = null, offered = null, submitted = null, choices = null, preselected = null, submittedAs = null;
    if (!guest) {
      browser('wait', '--text', 'Connect an AI assistant');
      const readChecks = () => JSON.parse(JSON.parse(browser('eval', "JSON.stringify(Object.fromEntries([...document.querySelectorAll('input[name=scope]')].map(i => [i.value, i.checked])))")));
      shownName = JSON.parse(browser('eval', "document.querySelector('.request strong').textContent"));
      offered = readChecks();
      for (const scope of Object.keys(offered)) if (!scopes.includes(scope)) browser('click', `input[name=scope][value="${scope}"]`);
      submitted = readChecks();
      choices = JSON.parse(JSON.parse(browser('eval', "JSON.stringify([...document.querySelectorAll('input[name=connect_as]')].map(i => i.value))")));
      preselected = JSON.parse(browser('eval', "document.querySelector('input[name=connect_as]:checked')?.value ?? null"));
      if (connectAs === 'new_agent' && JSON.parse(browser('eval', "document.querySelector('input[name=connect_as][value=new_agent]').disabled"))) {
        throw new Error(`the consent page disables the new-agent option at the agent creation limit: ${process.env.VERIFY_UVW_AGENT_LIMIT_REASON || 'a higher VERIFY_UVW_AGENT_CREATE_LIMIT before up raises it'}`);
      }
      if (connectAs) browser('click', `input[name=connect_as][value=${connectAs}]`);
      submittedAs = connectAs ?? preselected;
      browser('screenshot', `${evidence}-consent.png`);
      browser('find', 'role', 'button', 'click', '--name', 'Allow', '--exact');
    }
    let timer;
    // The card sends the browser straight to the callback; a consent page would leave this wait to time out.
    const answer = card
      ? (browser('wait', '--url', 'https://verify-uvw.invalid/callback?*'), new URL(browser('get', 'url').trim()))
      : await Promise.race([received, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('No callback within 30 s')), 30000); })]).finally(() => clearTimeout(timer));
    if (card) browser('network', 'unroute');
    // A guest code leaves the browser's session as it was: none, or the agent cookie from before.
    const browserUserAfter = guest ? sessionUser() : undefined;
    const browserKept = !guest || JSON.stringify(browserUserAfter) === JSON.stringify(browserUserBefore);
    if (answer.searchParams.get('state') !== state || !answer.searchParams.get('code')) throw new Error(`Callback carried ${answer.searchParams.get('error') ?? 'no code'} or a wrong state`);
    if (answer.searchParams.get('iss') !== origin) throw new Error('Callback issuer does not match Workspace');
    const token = await form('/api/auth/token', { grant_type: 'authorization_code', client_id: clientId, code: answer.searchParams.get('code'),
      code_verifier: verifier, redirect_uri: redirectUri, ...tokenResource });
    const ok = token.status === 200 && typeof token.body.access_token === 'string' && browserKept && (!guest || agentCookie === (browserUserBefore?.kind === 'agent'));
    if (ok) {
      keepGrant(token.body);
      keep('mcp-oauth-client-id', clientId);
    }
    save({ guest, ...(guest ? { page: noPage ? 'none' : 'guest card', browser_user_before: browserUserBefore, browser_user_after: browserUserAfter, browser_signed_in_after: browserUserAfter !== null } : { choices, preselected, connect_as: submittedAs }), client_id: clientId, client_name: shownName, callback_code_present: true, callback_state_matches: true, callback_iss: answer.searchParams.get('iss'), offered, submitted, callback_scope: answer.searchParams.get('scope'), token: { ...token, body: shape(token.body) } }, ok);
  } finally {
    callback.close();
  }
} else if (command === 'refresh' || command === 'reuse') {
  const refresh = secret(command === 'refresh' ? 'mcp-oauth-refresh' : 'mcp-oauth-refresh-previous');
  const token = await form('/api/auth/token', { grant_type: 'refresh_token', client_id: secret('mcp-oauth-client-id'), refresh_token: refresh, ...tokenResource });
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
