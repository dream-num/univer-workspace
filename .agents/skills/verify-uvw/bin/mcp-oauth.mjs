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
  console.error(`${message}\nUsage: verify-uvw mcp-oauth login <label> [--guest [--agent-cookie]|--connect-as new_agent|self|<owned-agent-user-id>] [--access read|read_write] [--scope read,write,...] [--client-id <https-url>|--client-name <name>] [--token-resource omit|<url>]\n       verify-uvw mcp-oauth refresh|reuse <label> [--token-resource omit|<url>]\n       verify-uvw mcp-oauth revoke|direct <label>\n       verify-uvw mcp-oauth exchange <label> pat|oauth`);
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
  let clientId, clientName, guest = false, agentCookie = false, connectAs, access;
  while (args.length) {
    const flag = args.shift();
    if (flag === '--guest') { guest = true; continue; }
    if (flag === '--agent-cookie') { agentCookie = true; continue; }
    const value = args.shift();
    if (value === undefined) usage(`Missing value for ${flag}`);
    if (flag === '--scope') scopes = value.split(/[\s,]+/).filter(Boolean);
    else if (flag === '--access' && ['read', 'read_write'].includes(value)) access = value;
    else if (flag === '--connect-as' && (['new_agent', 'self'].includes(value) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value))) connectAs = value;
    else if (flag === '--client-id' && URL.canParse(value) && new URL(value).protocol === 'https:') clientId = value;
    else if (flag === '--client-name' && value.trim() !== '') clientName = value;
    else usage(`Unknown or invalid option ${flag}`);
  }
  if (!guest && !username) usage('No user to sign in as; run verify-uvw user, or pass --guest');
  if (agentCookie && !guest) usage('--agent-cookie gives the browser an agent session before the trial, so it needs --guest');
  if (clientId && clientName) usage('--client-name names a client this login registers, so it takes no --client-id');
  if (guest && (connectAs || access)) usage('--connect-as and --access are for the run user; a guest takes the trial');
  const sessionUser = () => {
    browser('open', `${origin}/api/session`);
    const session = JSON.parse(browser('get', 'text', 'body'));
    return session.authenticated ? { kind: session.user.kind, username: session.user.username } : null;
  };
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
  // A click that lands on the callback must not block the event loop that answers it.
  const browserAsync = (...a) => new Promise((resolve, reject) => execFile('agent-browser', a, { encoding: 'utf8', timeout: 60000 },
    (error, stdout) => (error ? reject(new Error(`agent-browser ${a[0]} failed`)) : resolve(stdout))));
  const evaluate = code => JSON.parse(browser('eval', code));
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
      scope: scopes.join(' '), code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
    browser('cookies', 'clear');
    browser('open', `${origin}/login`);
    browser('storage', 'local', 'set', 'univer-workspace-language', 'en-US');
    browser('reload');
    browser('wait', '--text', 'Username');
    if (agentCookie && JSON.parse(browser('eval', "fetch('/api/auth/guest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(r => r.status)")) !== 201) {
      throw new Error('POST /api/auth/guest did not create an agent in the browser');
    }
    const browserUserBefore = guest ? sessionUser() : undefined;
    const limited = `this address reached an hourly limit: either ${process.env.VERIFY_UVW_AGENT_LIMIT_REASON || 'agent creation, which a higher VERIFY_UVW_AGENT_CREATE_LIMIT before up raises'}, or the server's fixed limit on client metadata checks`;
    if (!guest) {
      browser('find', 'label', 'Username', 'fill', username);
      browser('find', 'label', 'Password', 'fill', readFileSync(join(run, 'user.pw'), 'utf8'));
      browser('click', 'form button[type=submit]');
      browser('wait', '--url', '**/home');
    }
    browser('open', authorize.href);
    if (new URL(browser('get', 'url').trim()).pathname === '/login') {
      throw new Error(`authorize sent the browser to sign in: guest agents are off, or the anonymous metadata fetch was refused because ${limited}`);
    }
    browser('wait', '--text', 'Connect an AI assistant');
    browser('set', 'viewport', '1440', '1500');
    const shownName = evaluate("document.querySelector('.request strong').textContent");
    let page, trial = null, accessRecord = null;
    const trialButton = 'form[action="/api/auth/authorize/guest"] button';
    if (guest) {
      trial = evaluate(`document.querySelector('${trialButton}') ? 'offered' : document.querySelector('button[disabled]') ? 'unavailable' : 'off'`);
      browser('screenshot', `${evidence}-connect.png`);
      if (trial === 'unavailable') throw new Error(`the connect page disables the trial: ${limited}`);
      if (trial === 'off') throw new Error('the connect page offers no trial: guest agents are off on this server');
      page = { state: evaluate("document.querySelector('input[name=consent_token]') === null ? 'signed_out' : 'person'") };
      await browserAsync('click', trialButton);
    } else {
      page = JSON.parse(evaluate("JSON.stringify({ choices: [...document.querySelectorAll('button[name=connect_as]')].map(b => b.value), primary: document.querySelector('button.primary[name=connect_as]')?.value ?? null, toggle: document.querySelector('input[name=access]')?.checked ?? null })"));
      if (access === 'read_write' && page.toggle === null) throw new Error('the connect page has no content switch, because the request names no write');
      if (access !== undefined && page.toggle !== null && page.toggle !== (access === 'read_write')) browser(access === 'read' ? 'uncheck' : 'check', 'input[name=access]');
      const submittedToggle = evaluate("document.querySelector('input[name=access]')?.checked ?? null");
      accessRecord = { offered: page.toggle === null ? 'read_only' : 'toggle', default: page.toggle === null ? null : page.toggle ? 'read_write' : 'read', submitted: submittedToggle === true ? 'read_write' : 'read' };
      const target = connectAs ?? page.primary;
      if (target === null) throw new Error(`the connect page has no main button: the run user owns no agent and a new one is refused, because ${process.env.VERIFY_UVW_AGENT_LIMIT_REASON || 'of the agent creation limit, which a higher VERIFY_UVW_AGENT_CREATE_LIMIT before up raises'}`);
      if (connectAs === 'new_agent' && !page.choices.includes('new_agent')) {
        throw new Error(`the connect page offers no new agent: the run user owns an agent made for a client of this name, or ${process.env.VERIFY_UVW_AGENT_LIMIT_REASON || 'the agent creation limit, which a higher VERIFY_UVW_AGENT_CREATE_LIMIT before up raises'}`);
      }
      if (!page.choices.includes(target)) {
        throw new Error(`the connect page offers no connect_as ${target}; it lists only up to five agents the run user owns and has not stopped, most recently active first`);
      }
      page = { ...page, connect_as: target };
      browser('screenshot', `${evidence}-connect.png`);
      await browserAsync('click', `button[name=connect_as][value="${target}"]`);
    }
    let timer;
    const answer = await Promise.race([received, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('No callback within 30 s')), 30000); })])
      .finally(() => clearTimeout(timer))
      .catch(error => {
        const code = browser('get', 'text', 'body').match(/(?:Error: |"code":")([A-Z_]+)/)?.[1];
        if (code === 'AGENT_CREATE_RATE_LIMITED') throw new Error(`the page says ${limited}`);
        throw code ? new Error(`the page answered ${code} instead of the callback`) : error;
      });
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
    save({ guest, requested_scope: scopes.join(' '), ...(guest
      ? { page: page.state, trial, browser_user_before: browserUserBefore, browser_user_after: browserUserAfter, browser_signed_in_after: browserUserAfter !== null }
      : { choices: page.choices, primary: page.primary, connect_as: page.connect_as, access: accessRecord }),
    client_id: clientId, client_name: shownName, callback_code_present: true, callback_state_matches: true, callback_iss: answer.searchParams.get('iss'), callback_scope: answer.searchParams.get('scope'), token: { ...token, body: shape(token.body) } }, ok);
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
