const { join } = require("node:path");
const { open, readFile, writeFile, mkdir } = require("node:fs/promises");
const { appendFileSync, existsSync, statSync, renameSync, mkdirSync } = require("node:fs");
const { release: osRelease } = require("node:os");

const stringKeys = new Set(["time", "phase", "version", "currentVersion", "platform", "arch", "code"]);
const numberKeys = new Set(["elapsedMs", "completed", "total", "transferred", "percent", "bytesPerSecond", "attempt", "seconds", "httpStatus"]);
function safeEvent(event) {
  const safe = {};
  for (const [key, value] of Object.entries(event)) {
    if (stringKeys.has(key) && typeof value === "string" && /^[\w.:+-]{1,100}$/.test(value)) safe[key] = value;
    if (numberKeys.has(key) && Number.isFinite(value)) safe[key] = value;
  }
  if (event.error) {
    safe.code = /\b(?:ENOENT|EACCES|EPERM|EADDRINUSE|ECONNREFUSED|ETIMEDOUT|ENOSPC|ERR_MODULE_NOT_FOUND|ERR_DLOPEN_FAILED)\b/.exec(String(event.error))?.[0] ?? "STARTUP_ERROR";
  }
  return safe;
}

function failureInfo(error) {
  const candidate = error?.code ?? error?.cause?.code ?? error?.name;
  return { code: typeof candidate === "string" && /^[\w-]{1,80}$/.test(candidate) ? candidate : "UPDATE_ERROR",
    ...(Number.isInteger(error?.httpStatus) ? { httpStatus: error.httpStatus } : {}) };
}

async function readEvents(path) {
  let file;
  try {
    file = await open(path, "r");
    const { size } = await file.stat();
    const length = Math.min(size, 128 * 1024);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await file.read(buffer, 0, length, size - length);
    return buffer.subarray(0, bytesRead).toString("utf8").split("\n").flatMap(line => {
      try { return [safeEvent(JSON.parse(line))]; } catch { return []; }
    }).slice(-100);
  } catch (error) {
    return error.code === "ENOENT" ? [] : [{ phase: "diagnostic-read-failed", code: failureInfo(error).code }];
  } finally { await file?.close(); }
}

function createDiagnostics({ app, resources, updatesEnabled, getUpdateState, getDshHome }) {
  const directories = { logs: join(app.getPath("userData"), "logs"),
    data: join(app.getPath("userData"), "data"), workspace: join(app.getPath("userData"), "workspace"),
    downloads: join(app.getPath("userData"), "update-downloads"), resources };
  Object.defineProperties(directories, {
    dshHome: { enumerable: true, get: () => getDshHome?.() ?? join(app.getPath("userData"), "runtime/home") },
    profile: { enumerable: true, get: () => join(app.getPath("userData"), "runtime/home/profiles/univer-workspace-harness") },
  });
  const log = join(directories.logs, "updates.log");
  const dshVersion = readFile(join(resources, "host.asar/node_modules/@deepseek-ai/dsh/package.json"), "utf8")
    .then(value => {
      const version = JSON.parse(value).version;
      return typeof version === "string" && /^[\w.+-]{1,80}$/.test(version) ? version : null;
    }).catch(() => null);
  let lastKey;
  const recordUpdate = state => {
    const key = `${state.phase}:${Math.floor((state.percent ?? 0) / 5)}:${state.attempt ?? 0}`;
    if (key === lastKey) return;
    lastKey = key;
    try {
      mkdirSync(directories.logs, { recursive: true });
      if (existsSync(log) && statSync(log).size > 256 * 1024) renameSync(log, join(directories.logs, "updates.previous.log"));
      appendFileSync(log, JSON.stringify(safeEvent({ ...state, ...state.failure, time: new Date().toISOString() })) + "\n");
    } catch { /* A logging failure must not break downloading or startup. */ }
  };
  const snapshot = async () => ({
    schemaVersion: 1, collectedAt: new Date().toISOString(),
    application: { version: app.getVersion(), packaged: app.isPackaged, updatesEnabled,
      electron: process.versions.electron, node: process.versions.node, dsh: await dshVersion,
      platform: process.platform, arch: process.arch, osRelease: osRelease() },
    directories,
    update: safeEvent({ ...getUpdateState(), ...getUpdateState().failure }),
    startup: await readEvents(join(directories.logs, "startup.log")),
    previousStartup: await readEvents(join(directories.logs, "startup.previous.log")),
    recentUpdates: [...await readEvents(join(directories.logs, "updates.previous.log")), ...await readEvents(log)].slice(-100),
  });
  const openDirectory = async (id, shell) => {
    if (typeof id !== "string" || !Object.hasOwn(directories, id)) throw new Error("Unknown diagnostic directory");
    if (id !== "resources") await mkdir(directories[id], { recursive: true });
    const error = await shell.openPath(directories[id]);
    if (error) throw new Error("Unable to open directory");
  };
  const exportReport = async (window, dialog) => {
    const result = await dialog.showSaveDialog(window, {
      title: "Export Workspace Agent diagnostics",
      defaultPath: join(app.getPath("downloads"), `workspace-agent-diagnostics-${Date.now()}.json`),
      filters: [{ name: "Diagnostic report", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, JSON.stringify(await snapshot(), null, 2), { mode: 0o600 });
    return true;
  };
  return { snapshot, recordUpdate, openDirectory, exportReport };
}
module.exports = { createDiagnostics, safeEvent, failureInfo, readEvents };
