import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const signer = require.resolve("@electron/osx-sign");

test("signer handles many files at low descriptor limits and skips Framework aliases", {
  skip: process.platform === "win32",
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "uwa-signing-walk-"));
  try {
    const framework = join(root, "Test.framework");
    const version = join(framework, "Versions", "A");
    await mkdir(version, { recursive: true });
    const binary = join(version, "test.dylib");
    await writeFile(binary, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0]));
    await symlink("A", join(framework, "Versions", "Current"));
    await symlink("Versions/Current/test.dylib", join(framework, "test.dylib"));
    for (let index = 0; index < 2048; index++) {
      await writeFile(join(root, `${index}.js`), "const value = 1;");
    }
    const script = `require(process.argv[1]).walkAsync(process.argv[2]).then(paths => console.log(JSON.stringify(paths))).catch(error => { console.error(error); process.exitCode = 1; });`;
    const result = spawnSync("bash", ["-c", 'ulimit -n 128; exec "$@"', "signing-test", process.execPath, "-e", script, signer, root], {
      encoding: "utf8",
      timeout: 60000,
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.deepEqual(JSON.parse(result.stdout).sort(), [binary, framework].sort());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
