import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

/** Validation helper only. Uses the official launch-token owner exchange. */
export async function connectHost(
  logFile = process.env.SPACE_DSH_LOG ?? '/tmp/task005-desktop-private.log',
) {
  const log = await readFile(logFile, 'utf8');
  const tokenURL = log.match(/dsh web: (https?:\/\/\S+)/)?.[1];
  if (!tokenURL)
    throw new Error(
      'SPACE_DSH_LOG must name the private Desktop launcher log.',
    );
  const origin = new URL(tokenURL).origin;
  if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname))
    throw new Error('Validation requires a local Host.');
  const admission = await fetch(tokenURL, { redirect: 'manual' });
  const cookie = admission.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  if (!cookie) throw new Error('Official owner authentication failed.');
  const headers = { cookie, 'content-type': 'application/json' };
  const body = (method, payload) =>
    JSON.stringify({
      type: 'client-request',
      rpcId: randomUUID(),
      method,
      payload,
    });
  async function request(method, payload = {}) {
    const response = await fetch(`${origin}/api/${method}`, {
      method: 'POST',
      headers,
      body: body(method, payload),
    });
    if (!response.ok) throw new Error(`Host returned HTTP ${response.status}.`);
    const envelope = await response.json();
    if (!envelope.result.ok) throw new Error(envelope.result.error.message);
    return envelope.result.value;
  }
  return { origin, headers, body, request };
}

/** Test-only browser authorization against an explicitly isolated loopback Server.
 * This exercises real consent + code + PKCE + callback; no credential is supplied
 * to the plugin, and no response/query containing a secret is printed. */
export async function authorizeWorkspace(host, login) {
  const origin = new URL(login.origin);
  if (!['127.0.0.1', 'localhost'].includes(origin.hostname)) throw new Error('Use an isolated local OAuth fixture.');
  let cookie = login.cookie;
  if (!cookie) {
    const signed = await fetch(new URL('/api/auth/password/login', origin), { method: 'POST', redirect: 'error',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: login.username, password: login.password }) });
    if (!signed.ok) throw new Error('Fixture browser sign-in failed.');
    cookie = signed.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
  }
  await host.request('space/configure', { endpoint: origin.origin });
  try {
    const started = await host.request('space/oauth-start', { desktop: false });
    let url = new URL(started.authorizationUrl), response;
    for (let hop = 0; hop < 5; hop++) {
      if (url.origin !== origin.origin) throw new Error('Unexpected OAuth fixture redirect.');
      response = await fetch(url, { redirect: 'manual', headers: { cookie } });
      if (response.status === 200) break;
      const location = response.headers.get('location');
      if (!location) throw new Error('OAuth fixture authorization failed.');
      url = new URL(location, origin);
    }
    const html = await response.text();
    const token = html.match(/name="consent_token" value="([A-Za-z0-9_-]+)"/)?.[1];
    if (!token) throw new Error('OAuth fixture did not serve consent.');
    const consent = await fetch(new URL('/api/auth/authorize/consent', origin), { method: 'POST', redirect: 'manual',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ consent_token: token, decision: 'allow' }) });
    const callback = new URL(consent.headers.get('location'));
    if (callback.origin !== 'http://127.0.0.1:3101' || callback.pathname !== '/auth/oauth/callback') throw new Error('Unexpected fixture callback.');
    const completed = await fetch(callback, { redirect: 'error' });
    if (!completed.ok) throw new Error('OAuth fixture callback failed.');
    return await host.request('space/status');
  } catch (error) {
    await host.request('space/oauth-cancel').catch(() => {});
    throw error;
  }
}

/** Current formal Host Settings route for browser regression scripts. */
export async function openWorkspaceSettings(page) {
  await page.getByRole('button', { name: '账号菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  return page.locator('[aria-label="Workspace settings"]');
}
