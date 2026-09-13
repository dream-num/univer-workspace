import { _electron } from 'playwright';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitForUsableAgent } from './smoke-ui.mjs';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = join(desktop, '.build/runtime');
const output = join(runtime, 'browser-cache-seed');
const scratch = await mkdtemp(join(tmpdir(), 'uwa-browser-build-'));
const data = join(scratch, 'profile');
const code = join(scratch, 'code');
let application;
try {
  await rm(output, { recursive: true, force: true });
  await mkdir(data);
  application = await _electron.launch({
    args: [desktop, `--user-data-dir=${data}`, ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])],
    env: { ...process.env, XDG_CONFIG_HOME: scratch, APPDATA: scratch },
    timeout: 60000,
  });
  application.process().stderr.on('data', bytes => process.stderr.write(String(bytes).replace(/token=[^\s"']+/g, 'token=[redacted]')));
  const page = await application.firstWindow();
  // Keep only immutable public scripts/assets in the HTTP seed. Authentication,
  // HTML and API responses must never enter an installation's reusable cache.
  await application.evaluate(({ session }, path) => {
    session.defaultSession.setCodeCachePath(path);
    session.defaultSession.webRequest.onHeadersReceived({ urls: ['http://127.0.0.1:3101/*'] }, (details, callback) => {
      const url = new URL(details.url);
      const reusable = url.origin === 'http://127.0.0.1:3101' && !url.search &&
        (url.pathname.startsWith('/plugins/workspace-desktop/') || url.pathname.startsWith('/assets/'));
      const headers = { ...details.responseHeaders };
      if (!reusable) {
        for (const key of Object.keys(headers)) if (key.toLowerCase() === 'cache-control') delete headers[key];
        headers['Cache-Control'] = ['no-store'];
      }
      callback({ responseHeaders: headers });
    });
  }, code);
  await page.waitForURL(url => url.origin === 'http://127.0.0.1:3101', { timeout: 60000 });
  await waitForUsableAgent(page);
  // Chromium's default cache heat check needs repeat loads to persist the
  // compiled factories. Warm up only during the native build.
  for (let count = 0; count < 2; count++) {
    await page.reload();
    await waitForUsableAgent(page, { firstRun: false });
  }
  const electron = await application.evaluate(() => process.versions.electron);
  await application.close();
  application = undefined;
  await mkdir(output);
  await cp(join(data, 'Cache'), join(output, 'Cache'), { recursive: true });
  await cp(code, join(output, 'code'), { recursive: true });
  const artifact = JSON.parse(await readFile(join(runtime, 'desktop-client/manifest.json'), 'utf8'));
  await writeFile(join(output, 'manifest.json'), JSON.stringify({ format: 1, electron, graph: artifact.graph.rev }));
  console.log('Prepared native browser HTTP and compiled-code cache without account storage.');
} finally {
  await cp(join(data, 'logs'), join(desktop, '.build/browser-cache-build-logs'), { recursive: true }).catch(() => {});
  await application?.close();
  await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
