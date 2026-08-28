import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assemblePackageArtifact,
  assertExactSemver,
} from "./package-artifact.mjs";

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptRoot, "..");
const repositoryRoot = resolve(appRoot, "..", "..");
const packageRoot = join(appRoot, "package-dist");
const version = parseBuildVersion(process.argv.slice(2));
const buildEnv = {
  ...process.env,
  ...(version === undefined ? {} : { UNIVER_WORKSPACE_CLI_BUILD_VERSION: version }),
};

run("pnpm", ["--filter", "univer-workspace-cli^...", "run", "build"], repositoryRoot, buildEnv);
run("pnpm", ["run", "build"], appRoot, buildEnv);
await rm(packageRoot, { force: true, recursive: true });
run("vite", ["build", "--config", "vite.package.config.ts"], appRoot, buildEnv);
await assemblePackageArtifact({ appRoot, packageRoot, version });
run(process.execPath, [join(scriptRoot, "verify-package.mjs"), packageRoot], appRoot, buildEnv);

function parseBuildVersion(argv) {
  const args = argv.filter((argument) => argument !== "--");
  if (args.length === 0) return undefined;
  if (args.length === 1 && args[0].startsWith("--version=")) {
    return assertExactSemver(args[0].slice("--version=".length), "Build version");
  }
  if (args.length === 2 && args[0] === "--version") {
    return assertExactSemver(args[1], "Build version");
  }
  throw new Error("Package build accepts only --version <exact-semver>.");
}

function run(command, args, cwd, env) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    shell: process.platform === "win32",
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
