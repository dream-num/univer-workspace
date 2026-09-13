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
  const node = join(runtime, "node/bin", process.platform === "win32" ? "node.exe" : "node");
  const binding = spawnSync(node, ["-e", `
    require('@univerjs-pro/exchange-node-binding');
    const { dirname, join } = require('node:path');
    const { pathToFileURL } = require('node:url');
    const worker = join(dirname(require.resolve('dsh-univer-workspace-plugin')), 'worker.js');
    import(pathToFileURL(worker).href).then(module => {
      if (!module.default) throw new Error('Packaged worker entry is missing');
    }).catch(error => { console.error(error); process.exitCode = 1; });
  `], {
    cwd: join(runtime, "home/profiles/univer-workspace-harness"),
    encoding: "utf8",
  });
  if (binding.status !== 0)
    throw new Error(`Packaged Office native binding failed: ${binding.stderr}`);
  const terminal = spawnSync(node, ["-e", `
    const pty = require('node-pty').spawn(process.execPath,
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
  `], { cwd: join(runtime, "bootstrap"), encoding: "utf8", timeout: 20000 });
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
    DSH_BIN: join(runtime, "bootstrap/node_modules/@deepseek-ai/dsh/lib/bin.js"),
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
    const page = await browser.newPage();
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
    await waitForUsableAgent(page);
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
    if (errors.length) throw new Error(`Desktop browser bootstrap errors: ${errors.join("; ")}`);
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
