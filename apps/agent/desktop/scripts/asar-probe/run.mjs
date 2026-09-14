import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { _electron } from 'playwright';
import { waitForUsableAgent } from '../smoke-ui.mjs';

const [electronArgument, directoryArgument] = process.argv.slice(2);
if (!electronArgument || !directoryArgument) throw new Error('Usage: node run.mjs <electron-executable> <probe-directory>');
const directory = resolve(directoryArgument);
const started = performance.now();
const application = await _electron.launch({ executablePath: resolve(electronArgument),
  args: [join(directory, 'host.cjs')], timeout: 60000 });
const report = {};
const errors = [];
try {
  const page = await application.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForURL((url) => url.hostname === '127.0.0.1', { timeout: 60000 });
  await waitForUsableAgent(page);
  report.interactiveMs = Math.round(performance.now() - started);
  const boot = await page.evaluate(() => globalThis.__DSH_BOOT__);
  if (!boot?.batches?.length || boot.entries.some((row) => row.id === '@deepseek-ai/dsh-client-hmr'))
    throw new Error('Expected a fixed production client graph');
  if (errors.length) throw new Error(`Renderer errors: ${errors.join('; ')}`);
  report.rendererErrors = errors;
  await page.screenshot({ path: join(directory, 'page.png') });
} catch (error) {
  report.error = error.message.replace(/token=[^\s"']+/g, 'token=[redacted]');
  report.rendererErrors = errors;
  const page = application.windows()[0];
  if (page) {
    report.pageText = (await page.locator('body').innerText().catch(() => '')).slice(0, 2000);
    await page.screenshot({ path: join(directory, 'failure.png') }).catch(() => {});
  }
  throw new Error(report.error);
} finally {
  await application.close();
  report.host = JSON.parse(await readFile(join(directory, 'host-result.json'), 'utf8'));
  await writeFile(join(directory, 'browser-result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
if (report.host.error || report.host.forcedStop || report.host.serviceExitCode !== 0)
  throw new Error('ASAR service did not stop cleanly');
