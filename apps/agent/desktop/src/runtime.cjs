// These are external runtime resources; bypass Electron ASAR path interception.
const filesystem = process.versions.electron
  ? require("original-fs").promises
  : require("node:fs/promises");
const { cp, mkdir, readFile, rename, rm, stat } = filesystem;
const { createHash } = require("node:crypto");
const { resolve, join, sep } = require("node:path");
const { spawn } = require("node:child_process");
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
async function verifyRuntime(root) {
  const manifest = JSON.parse(await readFile(join(root, "integrity.json"), "utf8"));
  if (
    !manifest ||
    Array.isArray(manifest) ||
    typeof manifest !== "object" ||
    !Object.keys(manifest).length
  )
    throw new Error("Invalid runtime inventory");
  for (const [relative, expected] of Object.entries(manifest)) {
    const path = resolve(root, relative);
    if (!path.startsWith(resolve(root) + sep) || !/^[a-f0-9]{64}$/.test(expected))
      throw new Error("Invalid runtime inventory");
    const hash = createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
    if (hash !== expected) throw new Error(`Runtime integrity check failed: ${relative}`);
  }
}
async function installRuntime(source, target) {
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
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    await cp(source, staging, { recursive: true, verbatimSymlinks: true });
    await verifyRuntime(staging);
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
  } finally {
    await rm(staging, { recursive: true, force: true });
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
    // taskkill can exit before Windows releases the terminated process handles.
    let onClose;
    const closed = new Promise((done) => {
      onClose = done;
      child.once("close", onClose);
    });
    try {
      await new Promise((done, reject) => {
        const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
        killer.once("error", reject);
        killer.once("exit", (code) => {
          if (code === 0 || child.exitCode !== null || child.signalCode !== null) done();
          else reject(new Error("Unable to stop the local service process tree"));
        });
      });
      let timer;
      try {
        await Promise.race([
          closed,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Local service did not close after taskkill")),
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
      throw error;
    }
  };
  if (!signal("SIGTERM")) return;
  const deadline = Date.now() + 8000;
  while (signal(0)) {
    if (Date.now() >= deadline) {
      signal("SIGKILL");
      return;
    }
    await new Promise((done) => setTimeout(done, 100));
  }
}
module.exports = { verifyRuntime, installRuntime, assertPortAvailable, stopBackend };
