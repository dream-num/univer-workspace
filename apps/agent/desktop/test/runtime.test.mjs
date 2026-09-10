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
  await runtime.stopBackend(owned);
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
