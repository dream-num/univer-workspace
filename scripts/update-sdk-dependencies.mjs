import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCKFILE_PATH = join(REPO_ROOT, "pnpm-lock.yaml");
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];
const INDEPENDENTLY_VERSIONED_PACKAGES = new Set([
  "@univerjs/icons",
  "@univerjs-pro/cli-assets",
]);
const EXACT_SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

export function parseSdkUpdateVersion(argv) {
  const args = argv.filter((argument) => argument !== "--");
  let version;
  if (args.length === 2 && args[0] === "--sdk_version") {
    version = args[1];
  } else if (args.length === 1 && args[0].startsWith("--sdk_version=")) {
    version = args[0].slice("--sdk_version=".length);
  }
  if (version === undefined || !EXACT_SEMVER_PATTERN.test(version)) {
    throw new Error(
      "SDK update requires --sdk_version <exact-semver> as its only argument.",
    );
  }
  return version;
}

export function alignManifestSdkDependencies(
  manifest,
  version,
  workspaceNames = new Set()
) {
  if (!EXACT_SEMVER_PATTERN.test(version)) {
    throw new Error(`SDK version must be exact SemVer: ${String(version)}`);
  }
  let changed = 0;
  for (const field of DEPENDENCY_FIELDS) {
    for (const [name, specifier] of Object.entries(manifest[field] ?? {})) {
      if (workspaceNames.has(name)) {
        if (specifier !== "workspace:*") {
          throw new Error(`${manifest.name} ${field}.${name} must use workspace:*.`);
        }
        continue;
      }
      if (!isSdkPackage(name) || INDEPENDENTLY_VERSIONED_PACKAGES.has(name)) {
        continue;
      }
      assertExactDependency(manifest.name, field, name, specifier);
      if (specifier !== version) {
        manifest[field][name] = version;
        changed += 1;
      }
    }
  }
  return changed;
}

export function resolveWorkspaceSdkBaseline(packages) {
  const versions = new Set();
  for (const { manifest } of packages) {
    for (const field of DEPENDENCY_FIELDS) {
      const version = manifest[field]?.["@univerjs/core"];
      if (version !== undefined) {
        versions.add(version);
      }
    }
  }
  if (versions.size !== 1) {
    throw new Error(
      `Workspace must declare one @univerjs/core baseline, found: ${[...versions].join(", ") || "none"}`
    );
  }
  const [version] = versions;
  if (!EXACT_SEMVER_PATTERN.test(version)) {
    throw new Error(`Workspace SDK baseline must be exact SemVer: ${String(version)}`);
  }
  return version;
}

export function validateWorkspaceSdkDependencies(packages, baselineVersion) {
  const workspaceNames = new Set(packages.map(({ manifest }) => manifest.name));
  let declarations = 0;
  for (const { manifest } of packages) {
    for (const field of DEPENDENCY_FIELDS) {
      for (const [name, specifier] of Object.entries(manifest[field] ?? {})) {
        if (workspaceNames.has(name)) {
          if (specifier !== "workspace:*") {
            throw new Error(`${manifest.name} ${field}.${name} must use workspace:*.`);
          }
          continue;
        }
        if (!isSdkPackage(name) || INDEPENDENTLY_VERSIONED_PACKAGES.has(name)) {
          continue;
        }
        assertExactDependency(manifest.name, field, name, specifier);
        if (specifier !== baselineVersion) {
          throw new Error(
            `${manifest.name} ${field}.${name} must equal SDK baseline ${baselineVersion}, got ${specifier}.`
          );
        }
        declarations += 1;
      }
    }
  }
  if (declarations === 0) {
    throw new Error("Workspace does not declare any Univer SDK dependencies.");
  }
  return declarations;
}

export async function discoverWorkspacePackages(repoRoot = REPO_ROOT) {
  const result = spawnSync("pnpm", ["list", "-r", "--depth", "-1", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`Unable to discover pnpm workspace packages: ${result.stderr}`);
  }
  const entries = JSON.parse(result.stdout);
  return Promise.all(
    entries.map(async ({ path }) => {
      const packagePath = join(path, "package.json");
      const source = await readFile(packagePath, "utf8");
      return { manifest: JSON.parse(source), packagePath, source };
    })
  );
}

export async function main(argv) {
  const version = parseSdkUpdateVersion(argv);
  const packages = await discoverWorkspacePackages();
  const workspaceNames = new Set(packages.map(({ manifest }) => manifest.name));
  const originalLockfile = await readFile(LOCKFILE_PATH, "utf8");
  let changed = 0;
  try {
    for (const pkg of packages) {
      changed += alignManifestSdkDependencies(pkg.manifest, version, workspaceNames);
      await writeFile(pkg.packagePath, `${JSON.stringify(pkg.manifest, null, 2)}\n`, "utf8");
    }
    run("pnpm", [
      "install",
      "--lockfile-only",
      "--registry=https://registry.npmjs.org/",
    ]);
    const updated = await discoverWorkspacePackages();
    validateWorkspaceSdkDependencies(updated, version);
  } catch (error) {
    await Promise.all(packages.map((pkg) => writeFile(pkg.packagePath, pkg.source, "utf8")));
    await writeFile(LOCKFILE_PATH, originalLockfile, "utf8");
    throw error;
  }
  process.stdout.write(
    `Aligned ${changed} SDK dependency declarations across ${packages.length} workspace packages to ${version}.\n`
  );
}

function isSdkPackage(name) {
  return (
    name.startsWith("@univer-cli/") ||
    name.startsWith("@univerjs/") ||
    name.startsWith("@univerjs-pro/")
  );
}

function assertExactDependency(packageName, field, name, specifier) {
  if (typeof specifier !== "string" || !EXACT_SEMVER_PATTERN.test(specifier)) {
    throw new Error(`${packageName} ${field}.${name} must use an exact SemVer version.`);
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: REPO_ROOT, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}.`);
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main(process.argv.slice(2));
}
