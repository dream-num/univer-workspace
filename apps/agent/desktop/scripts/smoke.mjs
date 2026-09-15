// Start the exact shipped runtime after relocating it outside the checkout.
// This requires no Workspace account and never reuses a user's Agent data.
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import runtimeTools from "../src/runtime.cjs";
import policy from "../src/policy.cjs";
import { prepareRuntimeHome } from "../src/runtime-home.cjs";
import { waitForUsableAgent } from './smoke-ui.mjs';
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = await mkdtemp(join(tmpdir(), "uwa-desktop-smoke with spaces-"));
let child;
try {
  const runtime = join(root, "runtime");
  const packaged = {
    linux: "linux-unpacked/resources/runtime",
    win32: "win-unpacked/resources/runtime",
    darwin: "mac-arm64/Univer Workspace Agent.app/Contents/Resources/runtime",
  };
  const source = process.env.UWA_SMOKE_EXECUTABLE
    ? join(dirname(process.env.UWA_SMOKE_EXECUTABLE), 'resources/runtime')
    : process.argv.includes("--packaged")
    ? join(desktop, "artifacts", packaged[process.platform])
    : join(desktop, ".build/runtime");
  await runtimeTools.installRuntime(source, runtime);
  const inventory = JSON.parse(await readFile(join(runtime, "integrity.json"), "utf8"));
  if (Object.keys(inventory).some((path) => path.endsWith(".map")))
    throw new Error("Desktop runtime must not include source maps");
  const metadata = JSON.parse(await readFile(join(runtime, "release.json"), "utf8"));
  const node = process.env.UWA_SMOKE_EXECUTABLE ?? (process.argv.includes('--packaged')
    ? resolve(source, { darwin: '../../MacOS/Univer Workspace Agent', win32: '../../Univer Workspace Agent.exe', linux: '../../univer-workspace-agent-desktop' }[process.platform])
    : process.env.UWA_SMOKE_ELECTRON ?? (await import('electron')).default);
  const nodeEnvironment = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  const sessions = spawnSync(node, [join(desktop, 'test/packaged-session.cjs'), runtime], {
    cwd: root, encoding: 'utf8', timeout: 120000, env: nodeEnvironment,
  });
  if (sessions.error || sessions.status !== 0)
    throw new Error(`Packaged session/request validation failed: ${sessions.error ?? sessions.stderr}`);
  console.log(sessions.stdout.trim());
  const profileModules = join(runtime, 'host.asar/profile/node_modules');
  const binding = spawnSync(node, ["-e", `
    const { createRequire } = require('node:module');
    const requireHost = createRequire(${JSON.stringify(join(runtime, 'host.asar/profile/package.json'))});
    requireHost('@univerjs-pro/exchange-node-binding');
    const { dirname, join } = require('node:path');
    const { pathToFileURL } = require('node:url');
    const worker = join(dirname(requireHost.resolve('dsh-univer-workspace-plugin')), 'worker.js');
    import(pathToFileURL(worker).href).then(module => {
      if (!module.default) throw new Error('Packaged worker entry is missing');
    }).catch(error => { console.error(error); process.exitCode = 1; });
  `], {
    cwd: join(runtime, "home/profiles/univer-workspace-harness"),
    encoding: "utf8", env: nodeEnvironment,
  });
  if (binding.status !== 0)
    throw new Error(`Packaged Office native binding failed: ${binding.stderr}`);
  const capability = spawnSync(node, [
    join(desktop, 'test/packaged-capability.mjs'),
    join(profileModules, 'dsh-univer-workspace-plugin/lib'),
  ], { encoding: 'utf8', timeout: 60000, env: nodeEnvironment });
  if (capability.error || capability.status !== 0)
    throw new Error(`Packaged lazy capability failed: ${capability.error ?? capability.stderr}`);
  const terminal = spawnSync(node, ["-e", `
    const pty = require(${JSON.stringify(join(runtime, 'host.asar.unpacked/node_modules/node-pty'))}).spawn(${JSON.stringify(join(runtime, 'node/bin', process.platform === 'win32' ? 'node.exe' : 'node'))},
      ['-e', 'console.log("uwa-pty-ready")'], { cols: 80, rows: 24 });
    let output = '';
    const timer = setTimeout(() => { pty.kill(); process.exit(1); }, 15000);
    pty.onData(data => { output += data; });
    pty.onExit(({ exitCode }) => {
      clearTimeout(timer);
      // ConPTY's output worker can keep this isolated probe alive after exit.
      // Both the terminal exit and its output must be observed before success.
      process.exit(exitCode === 0 && output.includes('uwa-pty-ready') ? 0 : 1);
    });
  `], { cwd: runtime, encoding: "utf8", timeout: 20000, env: nodeEnvironment });
  if (terminal.error || terminal.status !== 0)
    throw new Error(`Packaged PTY failed: ${terminal.error ?? terminal.stderr}`);
  const runtimeHome = await prepareRuntimeHome(runtime, join(root, "writable/home"));
  const data = join(root, "data");
  const workspace = join(root, "workspace");
  await mkdir(data);
  await mkdir(workspace);
  const port = await new Promise((done, reject) => {
    const listener = net.createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const port = listener.address().port;
      listener.close(() => done(port));
    });
  });
  const origin = policy.localOrigin(port);
  const env = {
    ...process.env,
    NODE_ENV: "production",
    UWA_DESKTOP: "1",
    UWA_DESKTOP_CLIENT_ROOT: join(runtime, "desktop-client"),
    UWH_BIND_HOST: "127.0.0.1",
    DSH_HOME: runtimeHome,
    UWA_DESKTOP_HOST: join(runtime, "dsh-host.cjs"),
    UWH_DSH_DATA_HOME: data,
    UWH_PUBLIC_ORIGIN: origin,
    UWH_PUBLIC_HOST: "127.0.0.1",
    UWH_MODEL_SETTINGS_ENABLED: "true",
    UWH_RENDER_PAGE_ROOT: join(runtime, "render-runtime"),
    UWH_RENDER_BROWSER: join(runtime, metadata.browser),
  };
  for (const key of [
    "NODE_OPTIONS",
    "NODE_TLS_REJECT_UNAUTHORIZED",
    "NODE_PATH",
    "ELECTRON_RUN_AS_NODE",
    "DSH_PROFILE",
    "UWH_CONNECTION_STATE_PATH",
    "UWH_SHARED_SETTINGS_PATH",
    "UWH_SHARED_CREDENTIALS_PATH",
  ])
    delete env[key];
  env.ELECTRON_RUN_AS_NODE = "1";
  if (process.env.UWA_SMOKE_PROFILE_DIR) {
    env.NODE_OPTIONS = '--require ' + JSON.stringify(join(desktop, 'test/backend-profile.cjs'));
    env.NODE_COMPILE_CACHE = join(root, 'compile-cache');
  }
  child = spawn(
    node,
    [
      join(runtime, "start-local.mjs"),
      "--port",
      String(port),
      "--no-open",
      "--trusted-host",
      "127.0.0.1",
    ],
    {
      cwd: workspace,
      env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  // Retain bounded diagnostics in memory; do not print process tokens or URLs.
  let diagnostics = "";
  child.stderr.on("data", (bytes) => {
    diagnostics = (diagnostics + bytes).slice(-16000);
  });
  const url = await new Promise((done, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Relocated service readiness timed out")),
      120000,
    );
    const finish = (fn) => (value) => {
      clearTimeout(timer);
      fn(value);
    };
    child.once("error", finish(reject));
    child.once(
      "exit",
      finish(() =>
        reject(
          new Error(
            `Relocated service exited before readiness (${diagnostics.replace(/token=[^\s"']+/g, "token=[redacted]")})`,
          ),
        ),
      ),
    );
    child.on("message", (message) => {
      const url = policy.readyUrl(message, origin);
      if (url) finish(done)(url);
    });
  });
  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15000) });
  if (
    response.status !== 303 ||
    !response.headers.get("set-cookie") ||
    !policy.isLocalUrl(new URL(response.headers.get("location"), url).href, origin)
  ) {
    throw new Error("Desktop token handoff did not establish a local browser session");
  }
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    executablePath: join(runtime, metadata.browser),
    headless: true,
  });
  try {
    const page = await browser.newPage({ locale: 'en-US' });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (
        ["script", "stylesheet"].includes(response.request().resourceType()) &&
        response.status() >= 400
      )
        errors.push(`Browser asset returned HTTP ${response.status()}`);
    });
    await page.goto(url);
    let workspaceOnboardingSeen = false;
    await waitForUsableAgent(page, { onWorkspaceOnboarding: async () => {
      await page.getByRole('heading', { name: 'Connect your Workspace' }).waitFor();
      const login = page.getByRole('dialog').getByRole('button', { name: 'Sign in to Workspace', exact: true });
      await login.click({ trial: true });
      await mkdir(join(desktop, '.build/startup-logs'), { recursive: true });
      await page.screenshot({ path: join(desktop, '.build/startup-logs/workspace-onboarding.png') });
      workspaceOnboardingSeen = true;
    } });
    if (!workspaceOnboardingSeen) throw new Error('Fresh installation must offer Workspace sign-in before model setup');
    await page.getByRole('button', { name: 'Sign in to Workspace', exact: true }).click({ trial: true });
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
    await page.screenshot({
      path: join(
        desktop,
        ".build",
        process.argv.includes("--packaged") ? "smoke-packaged.png" : "smoke-runtime.png",
      ),
    });
    // Exercise the first-run form itself: persist a different service URL, then
    // reach the existing OAuth entry. Intercept navigation before any external
    // authorization so this remains an isolated, credential-free smoke.
    await page.reload();
    await page.getByRole('heading', { name: 'Connect your Workspace' }).waitFor();
    const testOrigin = 'http://127.0.0.1:3020';
    await page.getByRole('textbox', { name: 'Workspace service URL' }).fill(testOrigin);
    await page.route('**/auth/oauth/start', route => route.fulfill({ status: 200, contentType: 'text/plain', body: 'OAuth entry reached' }));
    await page.getByRole('dialog').getByRole('button', { name: 'Sign in to Workspace', exact: true }).click();
    await page.waitForURL(current => current.pathname === '/auth/oauth/start');
    const connection = await (await page.request.get(`${origin}/api/uwh/me`)).json();
    if (connection.workspaceOrigin !== testOrigin) throw new Error('Onboarding must save the selected service URL before starting OAuth');
    if (errors.length) throw new Error(`Desktop browser bootstrap errors: ${errors.join("; ")}`);
  } catch (error) {
    const diagnostics = join(desktop, '.build/startup-logs');
    await mkdir(diagnostics, { recursive: true });
    await browser.contexts()[0]?.pages()[0]?.screenshot({ path: join(diagnostics, 'relocated-failure.png') }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
  await runtimeTools.verifyRuntime(runtime);
  console.log(
    "Relocated runtime passed native Office binding, authenticated HTTP, and Chromium bootstrap checks.",
  );
} finally {
  await runtimeTools.stopBackend(child);
  // Windows can briefly retain executable/DLL locks after process termination.
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
