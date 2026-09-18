/** Packaged Electron + real local auth routes; only the remote OAuth issuer is mocked. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { _electron } from 'playwright';
import { waitForUsableAgent } from './smoke-ui.mjs';
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(join(tmpdir(), 'uwa-login-smoke-'));
const reports = join(desktop, '.build/startup-logs/login');
await mkdir(reports, { recursive: true });
const codes = new Map();
let exchanged = 0, application;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/auth/authorize') {
      assert.equal(req.headers.cookie, undefined, 'Each login must start without local or previous account cookies');
      res.setHeader('set-cookie', 'fallback-account=old; Path=/; HttpOnly');
      const code = `smoke-code-${codes.size}`;
      codes.set(code, { challenge: url.searchParams.get('code_challenge'), used: false });
      const redirect = new URL(url.searchParams.get('redirect_uri'));
      redirect.search = new URLSearchParams({ state: url.searchParams.get('state'), code }).toString();
      res.writeHead(302, { location: redirect.href }); res.end(); return;
    }
    if (url.pathname === '/api/auth/token') {
      let body = ''; for await (const chunk of req) body += chunk;
      const token = JSON.parse(body), pending = codes.get(token.code);
      assert.ok(pending && !pending.used);
      assert.equal(createHash('sha256').update(token.code_verifier).digest('base64url'), pending.challenge);
      pending.used = true; exchanged++;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ access_token: `mock-session-${exchanged}`, user: { id: `user-${exchanged}`, username: `account-${exchanged}` } })); return;
    }
    if (url.pathname === '/api/spaces') { res.setHeader('content-type', 'application/json'); res.end('{"spaces":[]}'); return; }
    res.writeHead(404); res.end();
  } catch { res.writeHead(500); res.end('Mock issuer validation failed'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const remote = `http://127.0.0.1:${server.address().port}`;
try {
  application = await _electron.launch({
    executablePath: process.env.UWA_SMOKE_EXECUTABLE ?? join(desktop, 'artifacts/linux-unpacked/univer-workspace-agent-desktop'),
    args: ['--lang=en-US', `--user-data-dir=${join(temporary, 'profile')}`,
      ...(process.getuid?.() === 0 || process.argv.includes('--no-sandbox') ? ['--no-sandbox'] : [])],
    env: { ...process.env, XDG_CONFIG_HOME: temporary, XDG_DATA_HOME: join(temporary, 'share'), APPDATA: temporary },
  });
  await application.evaluate(({ shell, dialog }) => {
    globalThis.smokeLoginUrls = []; globalThis.smokeLoginErrors = [];
    shell.openExternal = async url => { globalThis.smokeLoginUrls.push(url); };
    dialog.showErrorBox = (title, message) => { globalThis.smokeLoginErrors.push({ title, message }); };
  });
  const page = await application.firstWindow();
  await page.waitForURL(url => url.origin === 'http://127.0.0.1:3101', { timeout: 60000 });
  await application.evaluate(({ BrowserWindow }) => {
    globalThis.smokeLoginReloads = 0;
    const main = BrowserWindow.getAllWindows()[0];
    const load = main.loadURL.bind(main);
    main.loadURL = async (...args) => {
      const result = await load(...args);
      globalThis.smokeLoginReloads++;
      return result;
    };
  });
  const waitForLoginReload = async count => {
    // Account recovery may reload the renderer before the main-process login
    // controller finishes. Await its final load before dismissing onboarding.
    const completed = await application.evaluate(async (electron, count) => {
      const deadline = Date.now() + 60000;
      while (globalThis.smokeLoginReloads < count && Date.now() < deadline)
        await new Promise(resolve => setTimeout(resolve, 50));
      return globalThis.smokeLoginReloads;
    }, count);
    assert.ok(completed >= count, 'Main-process login did not complete its reload');
  };
  await waitForUsableAgent(page, { onWorkspaceOnboarding: async () => {
    const onboarding = page.getByRole('dialog', { name: 'Connect your Workspace' });
    await onboarding.locator('input[type="url"]').fill(remote);
    await onboarding.getByRole('button', { name: 'Sign in to Workspace', exact: true }).click();
    await onboarding.getByRole('status').waitFor();
  } });
  if (process.platform === 'linux') {
    const { stdout } = await promisify(execFileCallback)('xdg-mime', ['query', 'default', 'x-scheme-handler/univer-workspace'], {
      env: { ...process.env, XDG_CONFIG_HOME: temporary, XDG_DATA_HOME: join(temporary, 'share') }, timeout: 5000,
    });
    assert.equal(stdout.trim(), 'org.univer.workspace.agent.login.desktop');
    const entry = await readFile(join(temporary, 'share/applications', stdout.trim()), 'utf8');
    assert.ok(entry.includes('MimeType=x-scheme-handler/univer-workspace;'));
  } else {
    const protocol = await application.evaluate(async ({ app }) => {
      let handler;
      try { const info = await app.getApplicationInfoForProtocol('univer-workspace://login'); handler = { name: info.name, path: info.path }; }
      catch (error) { handler = { error: error.message }; }
      return { registered: app.isDefaultProtocolClient('univer-workspace'), executable: process.execPath, handler };
    });
    console.log('Installed sign-in protocol:', JSON.stringify(protocol));
    assert.equal(protocol.registered, true,
      `Installed application did not register its sign-in protocol: ${JSON.stringify(protocol)}`);
  }
  // Both layouts must retain the settings owner's deferred onboarding state.
  const expand = page.getByRole('button', { name: 'Expand sidebar', exact: true });
  if (await expand.isVisible()) await expand.click();
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  await expand.click();
  await page.getByRole('tab', { name: 'Files', exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog', { name: 'Connect your Workspace' }).count(), 0,
    'Sidebar toggling must not restart deferred onboarding');
  // Small native runner displays collapse the sidebar into accessible buttons.
  const selectNavigation = name => page.getByRole('tab', { name, exact: true })
    .or(page.getByRole('button', { name, exact: true })).click();
  for (const [tab, title] of [['Files', 'Connect Workspace to manage files'], ['Worktree', 'Connect Workspace to view Worktrees']]) {
    await selectNavigation(tab);
    await page.getByText(title, { exact: true }).waitFor();
    assert.ok(await page.getByRole('button', { name: 'Sign in to Workspace', exact: true }).first().isVisible());
    assert.equal(await page.getByText('workspace_connection_required', { exact: true }).isVisible(), false);
  }
  await selectNavigation('Sessions');
  await page.getByRole('button', { name: 'Choose workspace', exact: true }).click();
  const spacePicker = page.getByRole('dialog', { name: 'Choose Workspace Space' });
  await spacePicker.getByRole('button', { name: 'Sign in to Workspace', exact: true }).waitFor();
  await spacePicker.getByRole('button', { name: 'Cancel', exact: true }).last().click();
  // No browser cookie: the desktop start API must reject an unrelated browser.
  assert.equal((await fetch('http://127.0.0.1:3101/auth/oauth/desktop/start', { method: 'POST', headers: { origin: 'http://127.0.0.1:3101' } })).status, 401);
  const returnToApp = async (transport) => {
    const urls = await application.evaluate(async (electron, count) => {
      const deadline = Date.now() + 10000;
      while (globalThis.smokeLoginUrls.length < count && Date.now() < deadline)
        await new Promise(resolve => setTimeout(resolve, 50));
      return globalThis.smokeLoginUrls;
    }, exchanged + 1);
    assert.equal(urls.length, exchanged + 1);
    const authorization = urls.at(-1);
    assert.equal(new URL(authorization).origin, remote);
    assert.equal(application.windows().length, 1, 'Login must not create an Electron popup');
    // A normal browser follows the issuer's redirect without a local DSH cookie.
    const response = await fetch(authorization);
    const html = await response.text();
    assert.equal(response.status, 200);
    const callback = html.match(/href="(univer-workspace:\/\/login#[^"]+)"/)?.[1].replaceAll('&amp;', '&');
    assert.ok(callback);
    assert.ok(!html.includes('mock-session-'));
    const old = await page.evaluate(() => globalThis.__UWH_CONNECTION_VERSION__);
    await application.evaluate(({ app }, { callback, transport }) => {
      if (transport === 'open-url') app.emit('open-url', { preventDefault() {} }, callback);
      else app.emit('second-instance', {}, ['agent', callback]);
    }, { callback, transport });
    await page.waitForFunction(previous => globalThis.__UWH_CONNECTION_VERSION__ !== previous, old, { timeout: 60000 });
    await waitForLoginReload(exchanged);
    await waitForUsableAgent(page, { firstRun: false });
    const me = await page.evaluate(async () => (await fetch('/api/uwh/me')).json());
    assert.equal(me.identity.userId, `user-${exchanged}`);
    return callback;
  };
  const first = await returnToApp('second-instance');
  assert.equal(exchanged, 1);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('region', { name: 'Workspace connection settings' })
    .getByRole('button', { name: 'Switch account', exact: true }).click();
  await returnToApp('open-url');
  assert.equal(exchanged, 2);
  await application.evaluate(({ app }, url) => app.emit('second-instance', {}, ['agent', url]), first);
  await page.waitForTimeout(200);
  assert.equal(exchanged, 2, 'Replayed callback must not switch back');
  const errors = await application.evaluate(() => globalThis.smokeLoginErrors);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /expired|invalid/);
  // An unavailable OS browser falls back to a fresh Electron browser. Its
  // redirect is handled inside the app, with no synthetic OS callback event.
  await application.evaluate(({ shell }) => {
    shell.openExternal = async () => { throw new Error('No default browser'); };
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    const old = await page.evaluate(() => globalThis.__UWH_CONNECTION_VERSION__);
    await page.evaluate(() => window.workspaceDesktop.login());
    await page.waitForFunction(previous => globalThis.__UWH_CONNECTION_VERSION__ !== previous, old, { timeout: 60000 });
    await waitForLoginReload(exchanged);
    await waitForUsableAgent(page, { firstRun: false });
    const me = await page.evaluate(async () => (await fetch('/api/uwh/me')).json());
    assert.equal(me.identity.userId, `user-${3 + attempt}`);
    assert.equal(application.windows().length, 1, 'Fallback window closes after sign-in');
  }
  assert.equal((await application.evaluate(() => globalThis.smokeLoginErrors)).length, 1);
  console.log('Packaged browser login passed: automatic embedded fallback with fresh cookies, disconnected guidance, external browser, PKCE, both callback transports, account switch, replay rejection.');
} catch (error) {
  await application?.windows()[0]?.screenshot({ path: join(reports, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await application?.close();
  await new Promise(resolve => server.close(resolve));
  await cp(join(temporary, 'profile/logs'), reports, { recursive: true }).catch(() => {});
  await rm(temporary, { recursive: true, force: true });
}
