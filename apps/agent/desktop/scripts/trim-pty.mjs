import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

// node-pty loads only prebuilds/<process.platform>-<process.arch>, or its
// locally compiled build/Release fallback. Preserve both target paths.
export async function trimPtyPrebuilds(packageRoot, platform, arch) {
  const thirdParty = join(packageRoot, "third_party/conpty");
  try {
    for (const version of await readdir(thirdParty, { withFileTypes: true })) {
      if (!version.isDirectory()) continue;
      for (const target of await readdir(join(thirdParty, version.name), { withFileTypes: true })) {
        if (target.isDirectory() && /^win10-(arm64|x64|ia32)$/.test(target.name)
          && (platform !== "win32" || target.name !== `win10-${arch}`))
          await rm(join(thirdParty, version.name, target.name), { recursive: true });
      }
    }
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const root = join(packageRoot, "prebuilds");
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && /^(darwin|linux|win32)-(arm64|x64)$/.test(entry.name)
      && entry.name !== `${platform}-${arch}`) {
      await rm(join(root, entry.name), { recursive: true });
    }
  }
}
