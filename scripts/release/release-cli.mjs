import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  discoverWorkspacePackages,
  resolveWorkspaceSdkBaseline,
  validateWorkspaceSdkDependencies,
} from "../update-sdk-dependencies.mjs";
import {
  assertReleaseContext,
  npmTagForRelease,
  parseReleaseArguments,
  RELEASE_PACKAGE_NAME,
  RELEASE_REGISTRY,
  SOURCE_PACKAGE_VERSION,
  validateReleaseManifest,
} from "./policy.mjs";
import { publishPreparedRelease } from "./publisher.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const appRoot = join(repoRoot, "apps", "cli");
const packageRoot = join(appRoot, "package-dist");
const releaseRoot = join(repoRoot, ".release");
const releaseManifestPath = join(releaseRoot, "release-manifest.json");
const options = parseReleaseArguments(process.argv.slice(2));
const npmTag = npmTagForRelease(options.channel, options.version);

assertReleaseContext(options.channel, options.version, process.env);
await assertSourceManifest();
const sourceSha = capture("git", ["rev-parse", "HEAD"], repoRoot);
let sdkVersion;
if (options.channel !== "dev") {
  assertStrictReleaseSource(process.env.BASE_BRANCH);
  const packages = await discoverWorkspacePackages(repoRoot);
  sdkVersion = resolveWorkspaceSdkBaseline(packages);
  validateWorkspaceSdkDependencies(packages, sdkVersion);
}

await rm(releaseRoot, { force: true, recursive: true });
await mkdir(releaseRoot, { recursive: true });
run(
  "pnpm",
  ["package:workspace-cli", "--", `--version=${options.version}`],
  repoRoot,
);
run("pnpm", ["--filter", RELEASE_PACKAGE_NAME, "package:smoke"], repoRoot);

const packed = JSON.parse(
  capture(
    "npm",
    [
      "pack",
      packageRoot,
      "--ignore-scripts",
      "--json",
      "--pack-destination",
      releaseRoot,
    ],
    repoRoot,
    { ...process.env, npm_config_cache: join(releaseRoot, "npm-cache") },
  ),
);
if (!Array.isArray(packed) || packed.length !== 1 || typeof packed[0]?.filename !== "string") {
  throw new Error("npm pack must report exactly one release tarball.");
}
const tarballPath = join(releaseRoot, packed[0].filename);
const tarball = await readFile(tarballPath);
const integrity = `sha512-${createHash("sha512").update(tarball).digest("base64")}`;
if (typeof packed[0].integrity === "string" && packed[0].integrity !== integrity) {
  throw new Error("npm pack integrity differs from the generated tarball.");
}

const packageManifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
if (packageManifest.name !== RELEASE_PACKAGE_NAME || packageManifest.version !== options.version) {
  throw new Error("Packaged CLI identity does not match the requested release.");
}
run(
  "npm",
  [
    "publish",
    "--dry-run",
    tarballPath,
    "--ignore-scripts",
    "--registry",
    RELEASE_REGISTRY,
    "--tag",
    npmTag,
  ],
  repoRoot,
  { ...process.env, npm_config_cache: join(releaseRoot, "npm-cache") },
);

const releaseManifest = validateReleaseManifest({
  channel: options.channel,
  integrity,
  npmTag,
  package: RELEASE_PACKAGE_NAME,
  registry: RELEASE_REGISTRY,
  schemaVersion: 1,
  sourceSha,
  tarball: packed[0].filename,
  version: options.version,
  ...(sdkVersion === undefined ? {} : { sdkVersion }),
});
await writeFile(releaseManifestPath, `${JSON.stringify(releaseManifest, null, 2)}\n`, "utf8");

if (options.mode === "publish") {
  await publishPreparedRelease(releaseManifestPath);
}
process.stdout.write(`${JSON.stringify(releaseManifest, null, 2)}\n`);

async function assertSourceManifest() {
  const manifest = JSON.parse(await readFile(join(appRoot, "package.json"), "utf8"));
  if (manifest.name !== RELEASE_PACKAGE_NAME) {
    throw new Error(`Source package must be ${RELEASE_PACKAGE_NAME}.`);
  }
  if (manifest.version !== SOURCE_PACKAGE_VERSION) {
    throw new Error(
      `Source package version must remain ${SOURCE_PACKAGE_VERSION}, got ${String(manifest.version)}.`,
    );
  }
  if (manifest.private !== true) {
    throw new Error("Source package must remain private.");
  }
}

function assertStrictReleaseSource(baseBranch) {
  const status = capture(
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    repoRoot,
  );
  if (status.length > 0) {
    throw new Error("latest and insiders releases require a clean Git worktree.");
  }
  const baseRef = `refs/remotes/origin/${baseBranch}`;
  const result = spawnSync("git", ["merge-base", "--is-ancestor", "HEAD", baseRef], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`Release commit must be contained in origin/${baseBranch}.`);
  }
}

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    shell: process.platform === "win32",
    stdio: "inherit",
  });
  if (result.error !== undefined) {
    throw new Error(`Unable to run ${command}.`, { cause: result.error });
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${String(result.status)}.`);
  }
}

function capture(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env,
    shell: process.platform === "win32",
  });
  if (result.error !== undefined) {
    throw new Error(`Unable to run ${command}.`, { cause: result.error });
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with status ${String(result.status)}:\n${result.stderr}`,
    );
  }
  return result.stdout.trim();
}
