// Loaded only by shell-smoke, before main.cjs. Native modal errors otherwise
// block an unattended test and conceal the reason the backend could not boot.
const { dialog } = require("electron");
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
