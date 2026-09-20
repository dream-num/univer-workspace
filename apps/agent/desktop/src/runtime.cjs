// These are external runtime resources; bypass Electron ASAR path interception.
const filesystem = process.versions.electron
  ? require("original-fs").promises
  : require("node:fs/promises");
const { cp, mkdir, readFile, rename, rm, stat } = filesystem;
const { createHash } = require("node:crypto");
const { resolve, join, sep } = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const net = require("node:net");

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (e) {
    if (e.code === "ENOENT") return false;
    throw e;
  }
}
async function verifyRuntime(root, report = () => {}) {
  const manifest = JSON.parse(await readFile(join(root, "integrity.json"), "utf8"));
  if (
    !manifest ||
    Array.isArray(manifest) ||
    typeof manifest !== "object" ||
    !Object.keys(manifest).length
  )
    throw new Error("Invalid runtime inventory");
  const entries = Object.entries(manifest);
  let completed = 0;
  for (const [relative, expected] of entries) {
    report({ phase: "verify", completed, total: entries.length, file: relative });
    const path = resolve(root, relative);
    if (!path.startsWith(resolve(root) + sep) || !/^[a-f0-9]{64}$/.test(expected))
      throw new Error("Invalid runtime inventory");
    const hash = createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
    if (hash !== expected) throw new Error(`Runtime integrity check failed: ${relative}`);
    completed++;
    report({ phase: "verify", completed, total: entries.length, file: relative });
  }
}
async function installRuntime(source, target, report = () => {}) {
  const wanted = await readFile(join(source, "integrity.json"), "utf8");
  const identity = createHash("sha256").update(wanted).digest("hex");
  const backup = `${target}.previous`,
    staging = `${target}.staging`;
  // Recover an interrupted directory activation before using the old runtime.
  if (!(await exists(target)) && (await exists(backup))) await rename(backup, target);
  if (
    (await exists(join(target, ".complete"))) &&
    (await readFile(join(target, ".complete"), "utf8")) === identity
  )
    return;
  report({ phase: "cleanup" });
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    let copied = 0;
    await cp(source, staging, { recursive: true, verbatimSymlinks: true,
      filter: (file) => { report({ phase: "copy", completed: copied++, file }); return true; },
    });
    await verifyRuntime(staging, report);
    report({ phase: "activate" });
    const { writeFile } = filesystem;
    await writeFile(join(staging, ".complete"), identity);
    await rm(backup, { recursive: true, force: true });
    if (await exists(target)) await rename(target, backup);
    try {
      await rename(staging, target);
    } catch (error) {
      if (await exists(backup)) await rename(backup, target);
      throw error;
    }
  } catch (error) {
    report({ phase: "failed", error: error.message, code: error.code, path: error.path });
    throw error;
  }
}
async function assertPortAvailable(port) {
  await new Promise((resolveReady, reject) => {
    const server = net.createServer();
    server.once("error", () =>
      reject(
        new Error(
          `Port ${port} is already in use. Close the other local Agent instance and try again.`,
        ),
      ),
    );
    server.listen(port, "127.0.0.1", () => server.close(resolveReady));
  });
}
async function stopBackend(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    if (child.exitCode !== null || child.signalCode !== null) return;
    // taskkill and the service have independent exit notifications. Even a
    // nonzero taskkill result can precede the service's close event when a
    // process exits during tree traversal. Join the service before deciding.
    let onClose;
    const closed = new Promise((done) => {
      onClose = done;
      child.once("close", onClose);
    });
    try {
      const failure = await new Promise((done, reject) => {
        let output = "";
        const killer = spawn(join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"), ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 8000,
        });
        const capture = bytes => { output = (output + bytes).slice(-8000); };
        killer.stdout.on("data", capture);
        killer.stderr.on("data", capture);
        killer.once("error", reject);
        // close also guarantees the diagnostic pipes have drained.
        killer.once("close", (code, signal) => {
          done(code === 0 ? null : new Error(`Unable to stop the local service process tree (taskkill code ${code}, signal ${signal}): ${output.trim()}`));
        });
      });
      let timer;
      try {
        await Promise.race([
          closed,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(failure ?? new Error("Local service did not close after taskkill")),
              8000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    } finally {
      child.off("close", onClose);
    }
    return;
  }
  // The group can outlive its launcher. Wait for the group, not only the direct
  // child's exit, before deciding that all application-owned tools have stopped.
  const signal = (value) => {
    try {
      process.kill(-child.pid, value);
      return true;
    } catch (error) {
      if (error.code === "ESRCH") return false;
      if (error.code === "EPERM") {
        // macOS can report EPERM while a terminated group is being reaped.
        // Only treat it as stopped when ps confirms no live group members;
        // retain permission failures for any process that could still run.
        const result = spawnSync("/bin/ps", ["-axo", "pgid=,stat="], {
          encoding: "utf8",
          timeout: 2000,
        });
        if (!result.error && result.status === 0 && result.stdout.trim()) {
          const members = result.stdout.trim().split("\n").filter(line => Number(line.trim().split(/\s+/)[0]) === child.pid);
          const live = members.some((line) => {
            const [group, state] = line.trim().split(/\s+/);
            return Number(group) === child.pid && !state?.startsWith("Z");
          });
          if (!live) return false;
          // Darwin's ps appends E for P_WEXIT, including the transient ?<Es
          // state observed in native CI. These processes cannot receive signals
          // but are still releasing resources. Keep waiting for reaping; do not
          // mistake this for permission denial or declare the group stopped.
          if (process.platform === "darwin" && members.every(line => {
            const state = line.trim().split(/\s+/)[1];
            return state?.startsWith("Z") || state?.includes("E");
          })) return true;
          error.message += ` (signal ${value}, group ${child.pid}, members ${JSON.stringify(members)})`;
        } else {
          error.message += ` (unable to inspect group ${child.pid}: ${result.error?.message ?? result.stderr})`;
        }
      }
      throw error;
    }
  };
  if (!signal("SIGTERM")) return;
  let deadline = Date.now() + 8000;
  let forced = false;
  while (signal(0)) {
    if (Date.now() >= deadline) {
      if (forced) throw new Error(`Local service process group ${child.pid} did not stop`);
      if (!signal("SIGKILL")) return;
      forced = true;
      deadline = Date.now() + 2000;
    }
    await new Promise((done) => setTimeout(done, 100));
  }
}
module.exports = { verifyRuntime, installRuntime, assertPortAvailable, stopBackend };
