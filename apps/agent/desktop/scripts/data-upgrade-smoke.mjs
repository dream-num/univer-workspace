import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { _electron } from 'playwright';
import { waitForUsableAgent } from './smoke-ui.mjs';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const executablePath = process.env.UWA_SMOKE_EXECUTABLE
  ?? join(desktop, 'artifacts/linux-unpacked/univer-workspace-agent-desktop');
const root = await mkdtemp(join(tmpdir(), 'uwa-data-upgrade-smoke-'));
const baseArgs = process.getuid?.() === 0 || process.argv.includes('--no-sandbox') ? ['--no-sandbox'] : [];
const statePath = directory => join(directory, 'runtime/home/.desktop-data-version.json');
const newer = { formatVersion: 1, schemaVersion: 999, appliedMigrations: [] };
let application;
async function launch(directory, extra = []) {
  return _electron.launch({ executablePath, args: [...baseArgs, '--lang=en-US', `--user-data-dir=${directory}`, ...extra] });
}
async function headless(directory, receipt) {
  const child = spawn(executablePath, [...baseArgs, `--user-data-dir=${directory}`, '--migrate-data-only', '--migration-headless', ...(receipt ? [`--migration-result-file=${receipt}`] : [])],
    { stdio: 'ignore', timeout: 30000 });
  const [code] = await once(child, 'exit');
  return code;
}
try {
  const silentHome = join(root, 'silent');
  assert.equal(await headless(silentHome), 0);
  assert.equal(JSON.parse(await readFile(statePath(silentHome))).schemaVersion, 1);
  await writeFile(statePath(silentHome), JSON.stringify(newer));
  const receipt = join(root, 'installer-result');
  assert.equal(await headless(silentHome, receipt), 21);
  assert.equal(await readFile(receipt, 'utf8'), 'unchanged');
  assert.deepEqual(JSON.parse(await readFile(statePath(silentHome))), newer);

  application = await launch(silentHome, ['--migrate-data-only']);
  let page = await application.firstWindow();
  await page.getByRole('heading', { name: 'Local data upgrade could not finish' }).waitFor();
  await page.getByText('This data was created by a newer version', { exact: false }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Retry', exact: true }).isVisible(), false);
  assert.equal(await page.getByRole('button', { name: 'Open logs', exact: true }).isVisible(), true);
  assert.equal(await headless(silentHome), 10, 'Installer must not migrate a profile owned by a running app');
  const exited = once(application.process(), 'exit');
  await page.getByRole('button', { name: 'Exit', exact: true }).click();
  assert.equal((await exited)[0], 20);
  application = undefined;

  const retryHome = join(root, 'retry');
  const presetRoot = join(retryHome, 'runtime/home/.agent-presets');
  await mkdir(dirname(presetRoot), { recursive: true });
  await writeFile(presetRoot, 'user-owned invalid preset root');
  application = await launch(retryHome);
  page = await application.firstWindow();
  await page.getByRole('heading', { name: 'Local data upgrade could not finish' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Retry', exact: true }).isVisible(), true);
  assert.equal(await readFile(presetRoot, 'utf8'), 'user-owned invalid preset root');
  await page.screenshot({ path: join(tmpdir(), 'uwa-data-upgrade-failure.png') });
  await rename(presetRoot, `${presetRoot}.saved`);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.waitForURL(url => url.origin === 'http://127.0.0.1:3101', { timeout: 60000 });
  await waitForUsableAgent(page);
  assert.equal(JSON.parse(await readFile(statePath(retryHome))).schemaVersion, 1);
  console.log('Packaged migration UI: headless results, instance exclusion, guided exit, preserved data, and retry into usable Agent passed.');
} finally {
  if (application) await application.close();
  await rm(root, { recursive: true, force: true });
}
