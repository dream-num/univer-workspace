import { cp, mkdtemp, mkdir, rm, realpath, readFile, writeFile, rename, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import { waitForUsableAgent } from './smoke-ui.mjs';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const diagnostics = process.env.UWA_SMOKE_PROFILE_DIR ?? join(desktop, '.build/startup-logs');
const temporary =
  process.env.UWA_SMOKE_CONFIG_HOME ?? (await mkdtemp(join(tmpdir(), "uwa-shell-")));
if (!temporary.startsWith(join(tmpdir(), "uwa-shell-")))
  throw new Error("Use a dedicated temporary smoke directory");
let application;
try {
  // Electron's --user-data-dir controls Chromium; use the OS config base as
  // well so app.getPath('userData') cannot read an existing desktop account.
  const env = { ...process.env, XDG_CONFIG_HOME: temporary, APPDATA: temporary, UWA_SMOKE_CONFIG_HOME: temporary };
  // This script is for Linux preview validation under Xvfb. Production never
  // adds --no-sandbox; the explicit flag only lets a restricted CI/container run this test.
  const installed = process.env.UWA_SMOKE_EXECUTABLE;
  const packaged = Boolean(installed) || process.argv.includes("--packaged");
  const args = [
    `--user-data-dir=${join(temporary, "Univer Workspace Agent")}`,
    "-r",
    join(desktop, "test/electron-diagnostics.cjs"),
    ...(packaged ? [] : [desktop]),
    ...(process.getuid?.() === 0 || process.argv.includes("--no-sandbox") ? ["--no-sandbox"] : []),
  ];
  const launchOptions = {
    args,
    env,
    timeout: 60000,
    ...(packaged
      ? { executablePath: installed ?? join(desktop, "artifacts/linux-unpacked/univer-workspace-agent-desktop") }
      : {}),
  };
  let launchedAt = performance.now();
  application = await _electron.launch(launchOptions);
  application.process().stderr.on("data", (bytes) => {
    if (String(bytes).includes("[desktop-smoke]"))
      process.stderr.write(String(bytes).replace(/token=[^\s"']+/g, "token=[redacted]"));
  });
  await application.evaluate(({ dialog }) => {
    dialog.showErrorBox = (title, detail) => {
      console.error("[desktop-smoke] " + title + ": " + detail);
    };
  });
  const dataPath = await application.evaluate(({ app }) => app.getPath("userData"));
  // Windows can expand RUNNER~1 into its long name; compare canonical paths.
  const canonicalRoot = await realpath(temporary);
  const canonicalData = await realpath(dataPath);
  const inside = relative(canonicalRoot, canonicalData);
  if (inside.startsWith("..") || isAbsolute(inside))
    throw new Error(`Electron test data is not isolated: ${dataPath}; expected ${temporary}`);
  const page = await application.firstWindow();
  let profiler;
  if (process.env.UWA_SMOKE_PROFILE_DIR) {
    profiler = await page.context().newCDPSession(page);
    await profiler.send('Profiler.enable');
    await profiler.send('Profiler.start');
  }
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.waitForURL((url) => url.origin === "http://127.0.0.1:3101", { timeout: 60000 });
  await waitForUsableAgent(page);
  const startupMs = Math.round(performance.now() - launchedAt);
  console.log(`First usable window: ${startupMs} ms`);
  if (profiler) {
    const { profile } = await profiler.send('Profiler.stop');
    for (const node of profile.nodes) node.callFrame.url = node.callFrame.url.replace(/([?&])token=[^&#]*/g, '$1token=[redacted]');
    await mkdir(process.env.UWA_SMOKE_PROFILE_DIR, { recursive: true });
    await writeFile(join(process.env.UWA_SMOKE_PROFILE_DIR, 'renderer.cpuprofile'), JSON.stringify(profile));
    await profiler.detach();
  }
  const browserTiming = await page.evaluate(() => ({
    navigation: performance.getEntriesByType('navigation').map(entry => ({
      responseStart: entry.responseStart,
      responseEnd: entry.responseEnd,
      domInteractive: entry.domInteractive,
      domContentLoadedEventEnd: entry.domContentLoadedEventEnd,
      loadEventEnd: entry.loadEventEnd,
    })),
    scripts: performance.getEntriesByType('resource')
      .filter(entry => entry.initiatorType === 'script' ||
        new URL(entry.name).pathname.startsWith('/plugins/workspace-desktop/'))
      .map(entry => ({
        path: new URL(entry.name).pathname,
        initiatorType: entry.initiatorType,
        startTime: entry.startTime,
        duration: entry.duration,
        transferSize: entry.transferSize,
        decodedBodySize: entry.decodedBodySize,
      })),
  }));
  await mkdir(diagnostics, { recursive: true });
  await writeFile(join(diagnostics, 'browser-performance.json'),
    JSON.stringify({ startupMs, ...browserTiming }, null, 2));
  const failures = [];
  const budget = Number(process.env.UWA_SMOKE_STARTUP_BUDGET_MS ?? 0);
  if (budget && startupMs > budget) failures.push(`First launch ${startupMs} ms exceeded ${budget} ms`);
  const boot = await page.evaluate(() => globalThis.__DSH_BOOT__);
  if (!boot?.batches?.length || boot.entries.some(row => row.id === '@deepseek-ai/dsh-client-hmr'))
    throw new Error('Desktop must use a fixed client graph without HMR');
  for (const batch of boot.batches) {
    if (!batch.url.startsWith('/plugins/workspace-desktop/')) throw new Error('Desktop is using runtime browser composition');
    const response = await page.request.get(new URL(batch.url, page.url()).href);
    if (!response.ok() || /(?:^|\n)\/\/# sourceMappingURL=/.test(await response.text()))
      throw new Error(`Desktop production script failed: HTTP ${response.status()}, URL ${batch.url}`);
    const map = await page.request.get(new URL(batch.url + '.map', page.url()).href);
    if (map.status() !== 404) throw new Error('Desktop must not serve source maps');
  }
  await page.screenshot({ path: join(desktop, ".build/electron-smoke.png") });
  if (errors.length) throw new Error(`Electron renderer errors: ${errors.join("; ")}`);
  if (process.env.UWA_SMOKE_INSTALLER) {
    // Keep a real unrelated Node process alive while updating the running app.
    // This catches broad node.exe kills as well as missing backend teardown.
    const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    await once(unrelated, 'spawn');
    const marker = join(dataPath, 'data', 'upgrade-smoke.txt');
    await writeFile(marker, 'preserve my data');
    const appProcess = application.process();
    const exited = once(appProcess, 'exit', { signal: AbortSignal.timeout(190000) });
    void exited.catch(() => {});
    const updateStarted = performance.now();
    let updateReport;
    try {
      const installer = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', join(desktop, 'scripts/install-windows.ps1'),
        '-Installer', process.env.UWA_SMOKE_INSTALLER,
        '-Destination', dirname(installed), '-Update', '-DeferBudgetFailure',
        '-ReportPath', join(desktop, '.build/startup-logs/update.json')], { stdio: 'inherit', windowsHide: true });
      const [code] = await once(installer, 'exit', { signal: AbortSignal.timeout(190000) });
      if (code !== 0) throw new Error(`Running-app reinstall failed: ${code}`);
      updateReport = JSON.parse((await readFile(join(desktop, '.build/startup-logs/update.json'), 'utf8')).replace(/^\uFEFF/, ''));
      if (updateReport.elapsedMs > updateReport.budgetMs)
        failures.push(`Running-app reinstall ${updateReport.elapsedMs} ms exceeded ${updateReport.budgetMs} ms`);
      await exited;
      application = undefined;
      await new Promise((done, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(3101, '127.0.0.1', () => server.close(done));
      });
      if (unrelated.exitCode !== null || unrelated.signalCode !== null) throw new Error('Installer killed an unrelated Node process');
      if (await readFile(marker, 'utf8') !== 'preserve my data') throw new Error('Update changed application data');
      const backup = `${dirname(installed)}.uwa-previous`;
      await stat(backup);
      launchedAt = performance.now();
      application = await _electron.launch(launchOptions);
      const updatedPage = await application.firstWindow();
      await updatedPage.waitForURL(url => url.origin === 'http://127.0.0.1:3101', { timeout: 60000 });
      await waitForUsableAgent(updatedPage, { firstRun: false });
      const upgradedMs = Math.round(performance.now() - launchedAt);
      updateReport.reopenMs = upgradedMs;
      console.log(`Usable window after running-app reinstall: ${upgradedMs} ms`);
      const cleanupDeadline = Date.now() + 120000;
      for (;;) {
        try { await stat(backup); }
        catch (error) { if (error.code === 'ENOENT') break; throw error; }
        if (Date.now() > cleanupDeadline) throw new Error('Verified old-install cleanup did not finish');
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      updateReport.cleanupComplete = true;
      console.log(`Complete replacement including reopened UI and cleanup: ${Math.round(performance.now() - updateStarted)} ms`);
      if (budget && upgradedMs > budget) failures.push(`Post-update startup ${upgradedMs} ms exceeded ${budget} ms`);
    } catch (error) {
      if (updateReport) updateReport.error = error.message;
      throw error;
    } finally {
      unrelated.kill();
      // Preserve the full duration on failure too; installer process time alone
      // must not pass the update budget when reopening or cleanup times out.
      if (updateReport) {
        updateReport.totalMs = Math.round(performance.now() - updateStarted);
        await writeFile(join(desktop, '.build/startup-logs/update.json'), JSON.stringify(updateReport, null, 2));
      }
    }
  }
  if (process.env.UWA_SMOKE_MAC_DMG) {
    const { installMac } = await import('./install-mac.mjs');
    const bundle = resolve(dirname(installed), '../..');
    const marker = join(dataPath, 'data/upgrade-smoke.txt');
    await writeFile(marker, 'preserve my data');
    const updateStarted = performance.now();
    await application.close();
    application = undefined;
    const shutdownMs = Math.round(performance.now() - updateStarted);
    const reportPath = join(diagnostics, 'update.json');
    const report = await installMac(process.env.UWA_SMOKE_MAC_DMG, bundle, reportPath);
    try {
      const reopenedAt = performance.now();
      application = await _electron.launch(launchOptions);
      const updatedPage = await application.firstWindow();
      await updatedPage.waitForURL(url => url.origin === 'http://127.0.0.1:3101', { timeout: 60000 });
      await waitForUsableAgent(updatedPage, { firstRun: false });
      report.reopenMs = Math.round(performance.now() - reopenedAt);
      if (await readFile(marker, 'utf8') !== 'preserve my data') throw new Error('Update changed account data');
      report.shutdownMs = shutdownMs;
      if (budget && report.reopenMs > budget) failures.push(`Post-update startup ${report.reopenMs} ms exceeded ${budget} ms`);
    } catch (error) {
      report.success = false;
      report.error = error.message;
      await writeFile(reportPath, JSON.stringify(report, null, 2));
      await application?.close(); application = undefined;
      await rename(bundle, `${bundle}.failed`);
      await rename(`${bundle}.previous`, bundle);
      throw error;
    }
    // Cleanup failure must never replace a healthy new app with a partially
    // deleted backup. Its time remains included in replacement acceptance.
    const cleanupAt = performance.now();
    try { await rm(`${bundle}.previous`, { recursive: true }); }
    finally {
      report.cleanupMs = Math.round(performance.now() - cleanupAt);
      report.totalMs = Math.round(performance.now() - updateStarted);
      await writeFile(reportPath, JSON.stringify(report, null, 2));
    }
    if (report.totalMs > 60000) failures.push(`macOS replacement ${report.totalMs} ms exceeded 60000 ms`);
  }
  if (failures.length) throw new Error(failures.join('; '));
  console.log("Electron window loaded the authenticated Agent UI with isolated user data.");
} finally {
  await mkdir(diagnostics, { recursive: true });
  const visiblePage = application?.windows()[0];
  if (visiblePage) await visiblePage.screenshot({ path: join(diagnostics, 'electron-smoke.png') }).catch(() => {});
  await application?.close();
  await cp(join(temporary, "Univer Workspace Agent/logs"), diagnostics, { recursive: true }).catch(() => {});
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
