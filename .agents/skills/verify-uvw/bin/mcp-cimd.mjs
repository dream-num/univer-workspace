#!/usr/bin/env node
// MO3 live probes. Credentials stay in home/; evidence contains only assertions and public metadata.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [run, origin, resource, command] = process.argv.slice(2);
assert.ok(['vscode', 'reject', 'disabled'].includes(command), 'Usage: mcp-cimd.mjs <run> <origin> <resource> vscode|reject|disabled');
const claude = 'https://claude.ai/oauth/claude-code-client-metadata';
const vscode = 'https://vscode.dev/oauth/client-metadata.json';
const cookie = `workspace_session=${readFileSync(join(run, 'home/browser-session'), 'utf8').trim()}`;
const evidence = join(run, 'evidence');
const save = (label, record) => {
  writeFileSync(join(evidence, `${label}.json`), JSON.stringify(record, null, 2) + '\n');
  console.log(`${label}: PASS`);
};
const browser = (...args) => {
  try { return execFileSync('agent-browser', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000 }); }
  catch { throw new Error(`agent-browser ${args[0]} failed`); }
};
const authorize = (clientId, redirect = 'http://127.0.0.1:41234/callback') => {
  const url = new URL('/api/auth/authorize', origin);
  url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'code', resource,
    code_challenge_method: 'S256', code_challenge: createHash('sha256').update('verify-uvw-cimd-probe').digest('base64url') }).toString();
  return url;
};
const fetchEvents = () => readFileSync(join(run, 'logs/server.log'), 'utf8').split('\n').flatMap(line => {
  try { const record = JSON.parse(line); return record.event === 'oauth.cimd.fetch' ? [{ client_id: record.client_id, outcome: record.outcome }] : []; } catch { return []; }
});
if (command === 'vscode') {
  const url = authorize(vscode, 'http://127.0.0.1:41234/');
  const response = await fetch(url, { headers: { cookie }, redirect: 'manual' });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /vscode\.dev/);
  browser('open', url.href);
  browser('wait', '--text', 'Connect an AI assistant');
  const text = browser('get', 'text', 'body');
  assert.match(text, /vscode\.dev/);
  browser('screenshot', join(evidence, 'mcp-cimd-vscode.png'));
  save('mcp-cimd-vscode', { status: response.status, page: text });
} else if (command === 'reject') {
  const publicAddresses = await lookup('localtest.me', { all: true });
  const hostname = publicAddresses.some(({address}) => address === '127.0.0.1') ? 'localtest.me' : 'localhost';
  const addresses = await lookup(hostname, { all: true });
  assert.ok(addresses.some(({address}) => address === '127.0.0.1'), 'The DNS probe must resolve to loopback');
  for (const [label, clientId] of [
    ['ipv4', 'https://127.0.0.1/x'], ['ipv6', 'https://[::1]/x'], ['dns-loopback', `https://${hostname}/x`],
    ['query', `${claude}?query=1`], ['mismatch', claude.replace('https://claude.ai/', 'https://CLAUDE.ai/')],
  ]) {
    const url = authorize(clientId);
    const response = await fetch(url, { headers: { cookie }, redirect: 'manual' });
    const body = await response.text();
    assert.equal(response.status, 400, `${label}: ${body}`);
    assert.equal(response.headers.get('location'), null);
    if (label === 'mismatch') assert.match(body, /client_id must match the requested URL exactly/);
    browser('open', url.href);
    browser('screenshot', join(evidence, `mcp-cimd-reject-${label}.png`));
    save(`mcp-cimd-reject-${label}`, { client_id: clientId, status: response.status, location: null, body, ...(label === 'dns-loopback' ? { hostname, addresses, public_domain: 'localtest.me', public_domain_addresses: publicAddresses } : {}) });
  }
  // With nobody signed in, authorize fetches the document anonymously, once, to name the client on the signed-out page.
  const before = fetchEvents();
  const anonymous = {};
  for (const [label, clientId] of [['claude', claude], ['missing', `${claude}/anonymous-probe`]]) {
    const response = await fetch(authorize(clientId), { redirect: 'manual' });
    const body = await response.text();
    await new Promise(resolve => setTimeout(resolve, 100));
    const fetched = fetchEvents().slice(before.length).filter(event => event.client_id === clientId);
    assert.equal(response.headers.get('location'), null, `${label}: a signed-out CIMD authorize answers with a page`);
    assert.ok(fetched.length <= 1, `${label}: one anonymous fetch at most`);
    if (label === 'claude') {
      assert.equal(response.status, 200);
      assert.match(body, /Claude Code \(claude\.ai\)/);
      assert.match(body, /Sign in to connect/);
      assert.doesNotMatch(body, /consent_token/);
      assert.match(response.headers.get('content-security-policy') ?? '', /form-action 'self' http:\/\/127\.0\.0\.1:41234;/);
    } else {
      assert.ok([400, 503].includes(response.status), `${label}: ${response.status}`);
      assert.equal(fetched.length, 1, 'a document missing from the cache is fetched');
      assert.match(body, /The application's metadata document could not be checked\./);
    }
    anonymous[label] = { status: response.status, fetches: fetched };
  }
  // The consent hop is gone: the connect page is the only page authorize serves.
  const hop = await fetch(new URL(`/api/auth/authorize/consent${authorize(claude).search}`, origin), { redirect: 'manual' });
  assert.equal(hop.status, 404);
  save('mcp-cimd-anonymous', { ...anonymous, consent_hop_status: hop.status, fetches_before: before.length, fetches_after: fetchEvents().length });
  save('mcp-cimd-fetch-events', fetchEvents());
} else {
  const metadata = await (await fetch(new URL('/.well-known/oauth-authorization-server', origin))).json();
  assert.equal(metadata.client_id_metadata_document_supported, undefined);
  assert.equal(metadata.authorization_response_iss_parameter_supported, true);
  const response = await fetch(authorize(claude), { headers: { cookie }, redirect: 'manual' });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, 'OAUTH_CLIENT_UNAVAILABLE');
  assert.deepEqual(fetchEvents(), []);
  save('mcp-cimd-disabled', { metadata, status: response.status, body, fetches: 0 });
}
