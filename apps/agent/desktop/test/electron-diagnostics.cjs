// Loaded only by shell-smoke, before main.cjs. Native modal errors otherwise
// block an unattended test and conceal the reason the backend could not boot.
const { app, dialog } = require("electron");
if (process.env.UWA_SMOKE_CONFIG_HOME) {
  const { join } = require("node:path");
  const { mkdirSync } = require("node:fs");
  const directory = join(process.env.UWA_SMOKE_CONFIG_HOME, "Univer Workspace Agent");
  mkdirSync(directory, { recursive: true });
  app.setPath("userData", directory);
}
const childProcess = require("node:child_process");
const redact = (value) => String(value).replace(/token=[^\s"']+/g, "token=[redacted]");
dialog.showErrorBox = (title, detail) => console.error("[desktop-smoke]", title, redact(detail));
const originalSpawn = childProcess.spawn;
childProcess.spawn = function spawn(command, args, options) {
  const backend = args?.[0]?.endsWith("start-local.mjs");
  const child = originalSpawn(
    command,
    args,
    backend ? { ...options, stdio: ["ignore", "pipe", "pipe", "ipc"] } : options,
  );
  if (backend) child.stdout.on("data", (bytes) => console.error("[desktop-smoke]", redact(bytes)));
  if (backend) child.stderr.on("data", (bytes) => console.error("[desktop-smoke]", redact(bytes)));
  return child;
};
