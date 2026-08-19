import { chmod, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

export const EXTERNAL_RUNTIME_DEPENDENCIES = [
  "@puppeteer/browsers",
  "@univerjs-pro/cli-assets",
  "@univerjs-pro/doc-typst-native-binding",
  "@univerjs-pro/engine-formula-rust-binding",
  "@univerjs-pro/exchange-node-binding",
  "puppeteer-core",
];

export const PACKAGE_FILES = ["bin", "dist", "skill-data", "README.md"];
export const SOURCE_PACKAGE_VERSION = "0.0.0";
export const PUBLISH_REGISTRY = "https://insider-npm-registry.univer.work/";
const EXACT_SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

export async function assemblePackageArtifact(options) {
  const sourcePackageJson = JSON.parse(
    await readFile(join(options.appRoot, "package.json"), "utf8"),
  );
  const packageJson = createDistributionPackageJson(
    sourcePackageJson,
    resolveExternalRuntimeDependencies(options.appRoot, sourcePackageJson),
    options.version,
  );

  await Promise.all([
    copyCollaborationRuntimeWorkerChild(options.appRoot, options.packageRoot),
    copyDirectory(
      join(options.appRoot, "dist", "render-runtime"),
      join(options.packageRoot, "dist", "render-runtime"),
    ),
    copyDirectory(join(options.appRoot, "skill-data"), join(options.packageRoot, "skill-data")),
    cp(join(options.appRoot, "README.md"), join(options.packageRoot, "README.md")),
  ]);
  await writeFile(
    join(options.packageRoot, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`,
    "utf8",
  );
  await writeLauncher(join(options.packageRoot, "bin", "univer-workspace-cli.js"));
}

async function copyCollaborationRuntimeWorkerChild(appRoot, packageRoot) {
  const appRequire = createRequire(resolve(appRoot, "package.json"));
  const runtimePool = readPackageManifest(
    appRequire,
    "@univer-cli/univer-collaboration-runtime-pool",
  );
  const target = join(packageRoot, "dist", "chunks", "worker-child.mjs");
  await mkdir(dirname(target), { recursive: true });
  await cp(join(dirname(runtimePool.path), "dist", "worker-child.mjs"), target);
}

export function createDistributionPackageJson(source, runtimeDependencies, version = source.version) {
  if (source.version !== SOURCE_PACKAGE_VERSION) {
    throw new Error(
      `Source package version must remain ${SOURCE_PACKAGE_VERSION}, got ${String(source.version)}`,
    );
  }
  const releaseVersion = assertExactSemver(version, "Package version");
  const dependencies = {};
  for (const dependencyName of EXTERNAL_RUNTIME_DEPENDENCIES) {
    const version = runtimeDependencies[dependencyName];
    if (typeof version !== "string" || version === "" || version.startsWith("workspace:")) {
      throw new Error(
        `Published runtime dependency ${dependencyName} must declare an npm version`,
      );
    }
    dependencies[dependencyName] = version;
  }

  return {
    name: source.name,
    version: releaseVersion,
    private: false,
    ...copyMetadata(source),
    type: "module",
    engines: source.engines,
    bin: {
      "univer-workspace-cli": "./bin/univer-workspace-cli.js",
    },
    files: PACKAGE_FILES,
    dependencies,
    publishConfig: {
      registry: PUBLISH_REGISTRY,
    },
  };
}

export function assertExactSemver(version, label = "Version") {
  if (typeof version !== "string" || !EXACT_SEMVER_PATTERN.test(version)) {
    throw new Error(`${label} must be an exact SemVer version: ${String(version)}`);
  }
  return version;
}

export function resolveExternalRuntimeDependencies(appRoot, source) {
  const appRequire = createRequire(resolve(appRoot, "package.json"));
  const renderRuntime = readPackageManifest(appRequire, "@univer-cli/univer-render-runtime");
  const typst = readPackageManifest(appRequire, "@univer-cli/doc-typst-facade");
  const headless = readPackageManifest(appRequire, "@univer-cli/headless-univer");
  const headlessRequire = createRequire(headless.path);
  const formula = readPackageManifest(headlessRequire, "@univerjs-pro/engine-formula-rust");

  return {
    "@puppeteer/browsers": readOwnedDependency(
      renderRuntime.manifest,
      "@puppeteer/browsers",
    ),
    "@univerjs-pro/cli-assets": readOwnedDependency(source, "@univerjs-pro/cli-assets"),
    "@univerjs-pro/doc-typst-native-binding": readOwnedDependency(
      typst.manifest,
      "@univerjs-pro/doc-typst-native-binding",
    ),
    "@univerjs-pro/engine-formula-rust-binding": readOwnedDependency(
      formula.manifest,
      "@univerjs-pro/engine-formula-rust-binding",
    ),
    "@univerjs-pro/exchange-node-binding": readOwnedDependency(
      source,
      "@univerjs-pro/exchange-node-binding",
    ),
    "puppeteer-core": readOwnedDependency(renderRuntime.manifest, "puppeteer-core"),
  };
}

function copyMetadata(source) {
  const metadata = {};
  for (const key of ["description", "keywords", "homepage", "bugs", "repository", "license"]) {
    if (source[key] !== undefined) metadata[key] = source[key];
  }
  return metadata;
}

function readPackageManifest(packageRequire, name) {
  let directory = dirname(packageRequire.resolve(name));
  for (;;) {
    const path = join(directory, "package.json");
    if (existsSync(path)) {
      const manifest = JSON.parse(readFileSync(path, "utf8"));
      if (manifest.name === name) return { manifest, path };
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Unable to locate package manifest for ${name}`);
    directory = parent;
  }
}

function readOwnedDependency(owner, dependencyName) {
  const version = owner.dependencies?.[dependencyName];
  if (typeof version !== "string" || version === "" || version.startsWith("workspace:")) {
    throw new Error(`${dependencyName} must be declared by its owning runtime package`);
  }
  return version;
}

async function copyDirectory(source, target) {
  await mkdir(target, { recursive: true });
  await cp(source, target, {
    recursive: true,
    filter: (path) => !path.endsWith("/.DS_Store"),
  });
}

async function writeLauncher(path) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, '#!/usr/bin/env node\nawait import("../dist/main.js");\n', "utf8");
  await chmod(path, 0o755);
}
