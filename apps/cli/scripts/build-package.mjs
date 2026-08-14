import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assemblePackageArtifact } from "./package-artifact.mjs";

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptRoot, "..");
const packageRoot = join(appRoot, "package-dist");

run("pnpm", ["run", "build"], appRoot);
await rm(packageRoot, { force: true, recursive: true });
run("vite", ["build", "--config", "vite.package.config.ts"], appRoot);
await assemblePackageArtifact({ appRoot, packageRoot });
run(process.execPath, [join(scriptRoot, "verify-package.mjs"), packageRoot], appRoot);

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    shell: process.platform === "win32",
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
