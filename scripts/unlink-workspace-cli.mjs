#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const PACKAGE_NAME = "univer-workspace-cli";

export function runUnlinkWorkspaceCli({
  console = globalThis.console,
  pnpmRootGlobal = defaultPnpmRootGlobal,
  removeGlobalPackage = defaultRemoveGlobalPackage,
} = {}) {
  const notLinkedMessage = `${PACKAGE_NAME} is not globally linked; nothing to unlink.`;
  const globalRootResult = pnpmRootGlobal();
  if (typeof globalRootResult !== "string") return globalRootResult;

  const globalPackageJsonPath = `${dirname(globalRootResult)}/package.json`;
  if (!existsSync(globalPackageJsonPath)) {
    console.log(notLinkedMessage);
    return 0;
  }

  const packageJson = JSON.parse(readFileSync(globalPackageJsonPath, "utf8"));
  if (packageJson.dependencies?.[PACKAGE_NAME] === undefined) {
    console.log(notLinkedMessage);
    return 0;
  }

  return removeGlobalPackage(PACKAGE_NAME);
}

function defaultPnpmRootGlobal() {
  const result = spawnSync("pnpm", ["root", "--global"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    if (result.stderr.trim() !== "") console.error(result.stderr.trim());
    return result.status ?? 1;
  }
  return result.stdout.trim();
}

function defaultRemoveGlobalPackage(packageName) {
  const result = spawnSync("pnpm", ["remove", "--global", packageName], {
    stdio: "inherit",
  });
  return result.status ?? 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runUnlinkWorkspaceCli();
}
