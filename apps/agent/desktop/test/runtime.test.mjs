import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import runtime from "../src/runtime.cjs";
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "uwa-runtime-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source"),
    target = join(root, "target");
  await mkdir(source);
  const bundle = async (text) => {
    await writeFile(join(source, "payload"), text);
    await writeFile(
      join(source, "integrity.json"),
      JSON.stringify({ payload: createHash("sha256").update(text).digest("hex") }),
    );
  };
  await bundle("first");
  return { root, source, target, bundle };
}
test("activates upgrades while preserving the previous verified runtime", async (t) => {
  const { source, target, bundle } = await fixture(t);
  await runtime.installRuntime(source, target);
  await bundle("second");
  await runtime.installRuntime(source, target);
  assert.equal(await readFile(join(target, "payload"), "utf8"), "second");
  assert.equal(await readFile(join(`${target}.previous`, "payload"), "utf8"), "first");
});
test("corruption never replaces the existing runtime", async (t) => {
  const { source, target, bundle } = await fixture(t);
  await runtime.installRuntime(source, target);
  await bundle("second");
  await writeFile(join(source, "payload"), "corrupt");
  await assert.rejects(runtime.installRuntime(source, target), /integrity/);
  assert.equal(await readFile(join(target, "payload"), "utf8"), "first");
});
test("recovers activation interrupted between directory renames", async (t) => {
  const { source, target } = await fixture(t);
  await runtime.installRuntime(source, target);
  await rename(target, `${target}.previous`);
  await runtime.installRuntime(source, target);
  assert.equal(await readFile(join(target, "payload"), "utf8"), "first");
});
test("rejects empty and escaping inventories", async (t) => {
  const { source } = await fixture(t);
  for (const manifest of [{}, null, [], { "../outside": "0".repeat(64) }]) {
    await writeFile(join(source, "integrity.json"), JSON.stringify(manifest));
    await assert.rejects(runtime.verifyRuntime(source), /Invalid runtime inventory/);
  }
});

test("shutdown stops its owned process without touching another process", async (t) => {
  const { spawn } = await import("node:child_process");
  const { once } = await import("node:events");
  const launch = () =>
    spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      detached: true,
      stdio: "ignore",
    });
  const owned = launch(),
    unrelated = launch();
  t.after(() => {
    owned.kill("SIGKILL");
    unrelated.kill("SIGKILL");
  });
  await Promise.all([once(owned, "spawn"), once(unrelated, "spawn")]);
  // OS group termination can precede Node delivery of the child exit event.
  const exited = once(owned, "exit", { signal: AbortSignal.timeout(10000) });
  await runtime.stopBackend(owned);
  await exited;
  assert.ok(owned.signalCode || owned.exitCode !== null);
  assert.equal(unrelated.exitCode, null);
  assert.equal(unrelated.signalCode, null);
});

test(
  "permission errors are ignored only for groups with no live processes",
  { skip: process.platform === "win32" },
  async (t) => {
    const { spawn } = await import("node:child_process");
    const { once } = await import("node:events");
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      detached: true,
      stdio: "ignore",
    });
    t.after(() => child.kill("SIGKILL"));
    await once(child, "spawn");
    const denied = Object.assign(new Error("kill EPERM"), { code: "EPERM" });
    t.mock.method(process, "kill", () => { throw denied; });
    await assert.rejects(runtime.stopBackend(child), { code: "EPERM" });
    const closed = once(child, "close");
    child.kill("SIGKILL");
    await closed;
    await runtime.stopBackend(child);
  },
);

test(
  "relocation preserves relative executable links",
  { skip: process.platform === "win32" },
  async (t) => {
    const { symlink, readlink } = await import("node:fs/promises");
    const { source, target } = await fixture(t);
    await symlink("payload", join(source, "alias"));
    await runtime.installRuntime(source, target);
    assert.equal(await readlink(join(target, "alias")), "payload");
    assert.equal(await readFile(join(target, "alias"), "utf8"), "first");
  },
);

test("reports failed file and preserves staging evidence without activating it", async (t) => {
  const { source, target } = await fixture(t);
  await writeFile(join(source, "integrity.json"), JSON.stringify({ "missing.dll": "0".repeat(64) }));
  const events = [];
  await assert.rejects(runtime.installRuntime(source, target, (event) => events.push(event)), { code: "ENOENT" });
  assert.equal(events.at(-1).phase, "failed");
  assert.ok(events.at(-1).path.endsWith("missing.dll"));
  assert.equal(await readFile(join(`${target}.staging`, "payload"), "utf8"), "first");
  await assert.rejects(readFile(join(target, ".complete")), { code: "ENOENT" });
});

test('Darwin shutdown waits for exiting E processes and still rejects live permission failures', async () => {
  const vm = await import('node:vm');
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const source = await readFile(new URL('../src/runtime.cjs', import.meta.url), 'utf8');
  for (const states of ['42 ?<Es\n42 Z', '42 ?<Es\n42 S']) {
    const calls = [];
    let checks = 0;
    const module = { exports: {} };
    vm.runInNewContext(source, {
      module, setTimeout,
      process: { platform: 'darwin', versions: {}, kill(pid, signal) {
        assert.equal(pid, -42);
        calls.push(signal);
        if (signal === 'SIGTERM') return;
        throw Object.assign(new Error('kill failed'), { code: checks++ === 0 ? 'EPERM' : 'ESRCH' });
      } },
      require: name => name === 'node:child_process' ? {
        ...require(name), spawnSync: () => ({ status: 0, stdout: states }),
      } : require(name),
    });
    const stopped = module.exports.stopBackend({ pid: 42 });
    if (states.endsWith(' S')) {
      await assert.rejects(stopped, { code: 'EPERM' });
      assert.deepEqual(calls, ['SIGTERM', 0]);
    } else {
      await stopped;
      assert.deepEqual(calls, ['SIGTERM', 0, 0], 'Do not return until the exiting group is gone');
    }
  }
});

// The real launcher exits when its DSH child exits. taskkill /T can race that
// exit while walking from the child back to the launcher.
test('Windows shutdown joins a supervisor that exits with its child', { skip: process.platform !== 'win32', timeout: 60000 }, async t => {
  const { spawn } = await import('node:child_process');
  const { once } = await import('node:events');
  for (let attempt = 0; attempt < 20; attempt++) {
    const supervisor = spawn(process.execPath, ['-e', `
      const { spawn } = require('node:child_process');
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });
      child.once('spawn', () => process.send({ pid: child.pid }));
      child.once('exit', () => process.exit(0));
    `], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true });
    const closed = once(supervisor, 'close');
    const [{ pid }] = await once(supervisor, 'message', { signal: AbortSignal.timeout(10000) });
    t.after(() => {
      supervisor.kill();
      try { process.kill(pid); } catch {}
    });
    try { await runtime.stopBackend(supervisor); }
    catch (error) {
      await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 1000))]);
      let childPresent = true;
      try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') childPresent = false; }
      throw new Error(`Supervisor attempt ${attempt}: exit ${supervisor.exitCode}, signal ${supervisor.signalCode}, child still present ${childPresent}`, { cause: error });
    }
    await closed;
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  }
});
