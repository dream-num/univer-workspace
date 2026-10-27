import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { WorkspaceOAuth, DEFAULT_WORKSPACE, OAUTH_CLIENT } from '../lib/oauth.js';
import { WorkspaceConnection } from '../lib/workspace.js';

async function fixture() {
  let user = 'alice', saved, exchanges = 0, changed = 0, delay = null, writeDelay = null, verified = 0, now = Date.now();
  const codes = new Map(), tokens = new Map();
  const issuer = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/auth/token') {
      let raw = ''; for await (const part of req) raw += part;
      const body = JSON.parse(raw), entry = codes.get(body.code); exchanges++;
      if (!entry || body.client_id !== OAUTH_CLIENT || body.redirect_uri !== entry.redirect || createHash('sha256').update(body.code_verifier).digest('base64url') !== entry.challenge) { res.writeHead(400); res.end('{}'); return; }
      codes.delete(body.code);
      if (delay) await delay;
      const token = 'test-only-workspace-session-' + entry.user; tokens.set(token, entry.user);
      res.end(JSON.stringify({ access_token: token, user: { id: entry.user, username: entry.user } })); return;
    }
    if (req.url === '/api/auth/logout') { tokens.delete(req.headers.cookie?.split('=')[1]); res.end('{}'); return; }
    const subject = tokens.get(req.headers.cookie?.split('=')[1]);
    if (subject) verified++;
    res.end(JSON.stringify({ authenticated: !!subject, user: subject ? { id: subject, username: subject } : null }));
  });
  issuer.listen(0, '127.0.0.1'); await once(issuer, 'listening');
  const origin = `http://127.0.0.1:${issuer.address().port}`;
  const storage = { read: async () => saved, write: async value => { if (writeDelay) await writeDelay; saved = structuredClone(value); } };
  let connection = new WorkspaceConnection();
  let auth = new WorkspaceOAuth(connection, storage, () => changed++, 0, () => now);
  await auth.configure(origin);
  return {
    origin, storage,
    get auth() { return auth; }, get connection() { return connection; }, get saved() { return saved; }, get exchanges() { return exchanges; }, get verified() { return verified; }, get changed() { return changed; },
    set user(value) { user = value; }, set delay(value) { delay = value; }, set writeDelay(value) { writeDelay = value; },
    tick(ms) { now += ms; },
    async restart() { await auth.dispose(); await connection.dispose(); connection = new WorkspaceConnection(); auth = new WorkspaceOAuth(connection, storage, () => changed++, 0, () => now); },
    async begin() {
      const result = await auth.start(true), url = new URL(result.authorizationUrl);
      assert.equal(url.origin, origin); assert.equal(url.searchParams.get('client_id'), OAUTH_CLIENT);
      assert.equal(url.searchParams.get('scope'), 'identity session');
      assert.match(url.searchParams.get('state'), /^[A-Za-z0-9_-]{43}$/);
      assert.match(url.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
      const redirect = url.searchParams.get('redirect_uri'), code = 'one-use-code-' + codes.size + '-' + Math.random();
      codes.set(code, { user, redirect, challenge: url.searchParams.get('code_challenge') });
      const callback = new URL(redirect); callback.search = new URLSearchParams({ code, state: url.searchParams.get('state'), scope: 'identity session' });
      return callback;
    },
    async close() { await auth.dispose(); await connection.dispose(); issuer.closeAllConnections(); await new Promise(resolve => issuer.close(resolve)); },
  };
}

test('PKCE one-time exchange verifies real session, persists only Host grant and reuses it on restart', async () => {
 const f = await fixture(); try {
  const callback = await f.begin(); const result = await fetch(callback);
  assert.equal(result.status, 200); const html = await result.text();
  assert.ok(html.includes('dsh://open')); assert.ok(!html.includes(callback.searchParams.get('code'))); assert.ok(!html.includes('test-only-workspace-session'));
  assert.equal((await f.auth.status()).user.id, 'alice'); assert.equal(f.exchanges, 1);
  const replay = await fetch(callback).catch(() => null); assert.ok(replay === null || replay.status === 400); assert.equal(f.exchanges, 1);
  await f.restart(); assert.equal((await f.auth.status()).user.id, 'alice'); assert.equal(f.exchanges, 1);
  assert.equal(f.saved.userId, 'alice');
 } finally { await f.close(); }
});

test('forged, duplicate-field, wrong-path and expired callbacks cannot change identity', async () => {
 const f = await fixture(); try {
  let callback = await f.begin(); const forged = new URL(callback); forged.searchParams.set('state', 'forged-state');
  assert.equal((await fetch(forged)).status, 400);
  const duplicate = new URL(callback); duplicate.searchParams.append('state', callback.searchParams.get('state'));
  assert.equal((await fetch(duplicate)).status, 400);
  const path = new URL(callback); path.pathname = '/api/space/sign-out'; assert.equal((await fetch(path)).status, 400);
  assert.equal(f.exchanges, 0); assert.equal((await f.auth.status()).state, 'unauthenticated');
  f.tick(11 * 60_000); assert.equal((await fetch(callback)).status, 400); assert.equal((await f.auth.status()).oauth.phase, 'expired');
  assert.equal(f.saved.token, undefined);
 } finally { await f.close(); }
});

test('denial, explicit cancel and superseded requests recover with a fresh retry', async () => {
 const f = await fixture(); try {
  const denied = await f.begin(); denied.searchParams.delete('code'); denied.searchParams.set('error', 'access_denied');
  assert.equal((await fetch(denied)).status, 400); assert.equal((await f.auth.status()).oauth.phase, 'cancelled');
  const cancelled = await f.begin(); f.auth.cancel(); await assert.rejects(fetch(cancelled));
  const old = await f.begin(), fresh = await f.begin(); await assert.rejects(fetch(old));
  assert.equal((await fetch(fresh)).status, 200); assert.equal((await f.auth.status()).user.id, 'alice');
 } finally { await f.close(); }
});

test('switch account retains old account after bad callback and atomically activates verified new account', async () => {
 const f = await fixture(); try {
  await fetch(await f.begin()); f.user = 'bob'; const callback = await f.begin();
  const forged = new URL(callback); forged.searchParams.set('state','forged'); await fetch(forged);
  assert.equal((await f.auth.status()).user.id, 'alice');
  await fetch(callback); assert.equal((await f.auth.status()).user.id, 'bob');
  await f.auth.signOut(); assert.equal((await f.auth.status()).state, 'unauthenticated'); assert.equal(f.saved.token, undefined);
  await f.restart(); assert.equal((await f.auth.status()).state, 'unauthenticated');
 } finally { await f.close(); }
});

test('cancel during token exchange and duplicate concurrent callback cannot resurrect an account', async () => {
 const f = await fixture(); try {
  let release; f.delay = new Promise(resolve => release = resolve);
  const callback = await f.begin(); const completed = fetch(callback);
  while (!f.exchanges) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await fetch(callback)).status, 400);
  assert.equal((await f.auth.status()).oauth.phase, 'exchanging');
  f.auth.cancel(); release(); await completed;
  assert.equal((await f.auth.status()).state, 'unauthenticated'); assert.equal(f.saved.token, undefined);
 } finally { await f.close(); }
});

test('cancellation during credential persistence is rolled back before restart', async () => {
 const f = await fixture(); try {
  const callback = await f.begin(); let release; f.writeDelay = new Promise(resolve => release = resolve);
  const completed = fetch(callback);
  while (!f.exchanges) await new Promise(resolve => setTimeout(resolve, 5));
  await new Promise(resolve => setTimeout(resolve, 30)); f.auth.cancel(); release(); f.writeDelay = null;
  assert.equal((await completed).status, 400); assert.equal(f.saved.token, undefined);
  await f.restart(); assert.equal((await f.auth.status()).state, 'unauthenticated');
 } finally { await f.close(); }
});

test('server switch rejects old in-flight exchange, clears cookie and saves only the new origin', async () => {
 const f = await fixture(), other = await fixture(); try {
  await fetch(await f.begin()); let release; f.delay = new Promise(resolve => release = resolve);
  f.user = 'bob'; const callback = await f.begin(), completed = fetch(callback);
  while (f.exchanges < 2) await new Promise(resolve => setTimeout(resolve, 5));
  await f.auth.configure(other.origin); release(); await completed;
  assert.equal(f.connection.endpoint, other.origin); assert.equal(f.connection.sessionCookie, ''); assert.equal(f.saved.token, undefined);
  await f.restart(); assert.equal((await f.auth.status()).endpoint, other.origin); assert.equal((await f.auth.status()).state, 'unauthenticated');
 } finally { await f.close(); await other.close(); }
});

test('a cancelled write cannot roll back a newer account that is already queued for persistence', async () => {
 const f = await fixture(); let release;
 try {
  const oldCallback = await f.begin(); f.writeDelay = new Promise(resolve => release = resolve);
  const oldResult = fetch(oldCallback);
  while (f.verified < 1) await new Promise(resolve => setTimeout(resolve, 5));
  f.auth.cancel(); f.user = 'bob';
  const newResult = fetch(await f.begin());
  while (f.verified < 2) await new Promise(resolve => setTimeout(resolve, 5));
  // Let the verified replacement join the serial credential queue before
  // releasing the old blocked write. Its durable record must own the restart.
  await new Promise(resolve => setTimeout(resolve, 30));
  f.writeDelay = null; release();
  assert.equal((await newResult).status, 200); assert.equal((await oldResult).status, 400);
  assert.equal(f.saved.userId, 'bob'); assert.equal((await f.auth.status()).user.id, 'bob');
  await f.restart(); assert.equal((await f.auth.status()).user.id, 'bob');
 } finally { release?.(); await f.close(); }
});

test('unreadable or unsupported credential records keep the default cloud sign-in recoverable', async () => {
 for (const read of [async () => { throw new Error('unavailable storage'); }, async () => ({ version: 2, endpoint: 'http://127.0.0.1:1', token: 'unsupported-record-token', userId: 'other' })]) {
  const connection = new WorkspaceConnection();
  const auth = new WorkspaceOAuth(connection, { read, write: async () => {} }, () => {}, 0);
  try {
   assert.equal((await auth.status()).endpoint, DEFAULT_WORKSPACE);
   const pending = new URL((await auth.start(false)).authorizationUrl);
   assert.equal(pending.origin, DEFAULT_WORKSPACE); assert.equal(connection.sessionCookie, '');
  } finally { await auth.dispose(); await connection.dispose(); }
 }
});
