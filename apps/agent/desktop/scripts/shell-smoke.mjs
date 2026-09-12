import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporary =
  process.env.UWA_SMOKE_CONFIG_HOME ?? (await mkdtemp(join(tmpdir(), "uwa-shell-")));
if (!temporary.startsWith(join(tmpdir(), "uwa-shell-")))
  throw new Error("Use a dedicated temporary smoke directory");
let application;
try {
  // Electron's --user-data-dir controls Chromium; use the OS config base as
  // well so app.getPath('userData') cannot read an existing desktop account.
  const env = { ...process.env, XDG_CONFIG_HOME: temporary, APPDATA: temporary };
  // This script is for Linux preview validation under Xvfb. Production never
  // adds --no-sandbox; the explicit flag only lets a restricted CI/container run this test.
  const installed = process.env.UWA_SMOKE_EXECUTABLE;
  const packaged = Boolean(installed) || process.argv.includes("--packaged");
  const args = [
    "-r",
    join(desktop, "test/electron-diagnostics.cjs"),
    ...(packaged ? [] : [desktop]),
    ...(process.getuid?.() === 0 || process.argv.includes("--no-sandbox") ? ["--no-sandbox"] : []),
  ];
  application = await _electron.launch({
    args,
    env,
    timeout: 60000,
    ...(packaged
      ? { executablePath: installed ?? join(desktop, "artifacts/linux-unpacked/univer-workspace-agent-desktop") }
      : {}),
  });
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
  if (!dataPath.startsWith(temporary)) throw new Error("Electron test data is not isolated");
  const page = await application.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.waitForURL((url) => url.origin === "http://127.0.0.1:3101", { timeout: 600000 });
  await page.waitForFunction(() => document.body.innerText.trim().length > 20);
  await page.getByRole("button", { name: /Reconnecting/ }).waitFor({ state: "hidden", timeout: 30000 });
  await page.screenshot({ path: join(desktop, ".build/electron-smoke.png") });
  if (errors.length) throw new Error(`Electron renderer errors: ${errors.join("; ")}`);
  console.log("Electron window loaded the authenticated Agent UI with isolated user data.");
} finally {
  await application?.close();
  const { cp, mkdir } = await import("node:fs/promises");
  const diagnostics = join(desktop, ".build/startup-logs");
  await mkdir(diagnostics, { recursive: true });
  await cp(join(temporary, "Univer Workspace Agent/logs"), diagnostics, { recursive: true }).catch(() => {});
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
