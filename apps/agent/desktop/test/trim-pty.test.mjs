import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { trimPtyPrebuilds } from "../scripts/trim-pty.mjs";

for (const [platform, arch] of [["linux", "x64"], ["darwin", "arm64"], ["win32", "x64"]]) {
  test(`PTY cleanup preserves ${platform}-${arch}, local builds and notices`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "uwa-pty-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    for (const os of ["darwin", "linux", "win32"]) {
      for (const cpu of ["arm64", "x64"]) {
        await mkdir(join(root, "prebuilds", `${os}-${cpu}`), { recursive: true });
      }
    }
    for (const cpu of ["arm64", "x64", "ia32"])
      await mkdir(join(root, "third_party/conpty/version", `win10-${cpu}`), { recursive: true });
    await mkdir(join(root, "build/Release"), { recursive: true });
    await writeFile(join(root, "build/Release/pty.node"), "native");
    await writeFile(join(root, "prebuilds/LICENSE"), "notice");
    await trimPtyPrebuilds(root, platform, arch);
    await trimPtyPrebuilds(root, platform, arch);
    assert.deepEqual((await readdir(join(root, "prebuilds"))).sort(), ["LICENSE", `${platform}-${arch}`]);
    assert.deepEqual(await readdir(join(root, "third_party/conpty/version")), platform === "win32" ? [`win10-${arch}`] : []);
    assert.equal(await readFile(join(root, "build/Release/pty.node"), "utf8"), "native");
    assert.equal(await readFile(join(root, "prebuilds/LICENSE"), "utf8"), "notice");
  });
}
