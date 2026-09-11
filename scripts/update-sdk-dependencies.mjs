import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCKFILE_PATH = join(REPO_ROOT, "pnpm-lock.yaml");
const WORKSPACE_CONFIG_PATH = join(REPO_ROOT, "pnpm-workspace.yaml");
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];
// These packages are released on their own schedule. They stay outside the SDK
// baseline but every declaration must remain an exact version.
const INDEPENDENTLY_VERSIONED_PACKAGES = new Set([
  "@univerjs/icons",
  "@univerjs-pro/cli-assets",
  "@univerjs-pro/doc-typst-native-binding",
]);
// Native bindings owned by a wrapper package manifest. The repository consumes
// them through that wrapper, so it never declares them itself.
const TRANSITIVE_BINDING_PACKAGES = new Set([
  "@univerjs-pro/engine-formula-rust-binding",
  "@univerjs-pro/exchange-node-binding",
]);
const SDK_PACKAGE_PATTERN = /^@(?:univer-cli|univerjs|univerjs-pro)\//u;
const EXACT_SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const DEV_VERSION_PATTERN = /^\d+\.\d+\.\d+-dev(?:[.-]|$)/u;
const TOP_LEVEL_KEY_PATTERN = /^([A-Za-z0-9_-]+):(?:\s|$)/u;
const OVERRIDE_ENTRY_PATTERN =
  /^(\s+)(?:"([^"]+)"|'([^']+)'|([^\s#][^:]*?)):\s*(.*?)\s*$/u;

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
  const result = { aligned: 0, removed: 0 };
  for (const field of DEPENDENCY_FIELDS) {
    const declarations = manifest[field];
    if (declarations === undefined) continue;
    for (const [name, specifier] of Object.entries(declarations)) {
      if (workspaceNames.has(name)) {
        if (
          specifier !== "workspace:*" &&
          !isAllowedFileDependency(manifest, field, name, specifier)
        ) {
          throw new Error(`${manifest.name} ${field}.${name} must use workspace:*.`);
        }
        continue;
      }
      if (TRANSITIVE_BINDING_PACKAGES.has(name)) {
        delete declarations[name];
        result.removed += 1;
        continue;
      }
      if (!isSdkPackage(name) || INDEPENDENTLY_VERSIONED_PACKAGES.has(name)) {
        continue;
      }
      assertExactDependency(manifest.name, field, name, specifier);
      if (specifier !== version) {
        declarations[name] = version;
        result.aligned += 1;
      }
    }
  }
  return result;
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
          if (
            specifier !== "workspace:*" &&
            !isAllowedFileDependency(manifest, field, name, specifier)
          ) {
            throw new Error(`${manifest.name} ${field}.${name} must use workspace:*.`);
          }
          continue;
        }
        if (TRANSITIVE_BINDING_PACKAGES.has(name)) {
          throw new Error(
            `${manifest.name} ${field}.${name} is a transitive binding package; declare its wrapper package instead.`
          );
        }
        if (!isSdkPackage(name)) continue;
        assertExactDependency(manifest.name, field, name, specifier);
        if (!INDEPENDENTLY_VERSIONED_PACKAGES.has(name) && specifier !== baselineVersion) {
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

// SDK overrides are a development-scenario mechanism: they let a dev build of
// one collaboration package deviate from the baseline. A release-channel
// override would silently pin an older SDK package, so only dev overrides are
// accepted and the baseline update drops them all.
export function validateWorkspaceSdkOverrides(source) {
  let declarations = 0;
  for (const block of findOverridesBlocks(source.split("\n"))) {
    for (const entry of block.entries) {
      if (!isSdkPackage(entry.name)) continue;
      if (!DEV_VERSION_PATTERN.test(entry.value)) {
        throw new Error(
          `pnpm-workspace.yaml overrides.${entry.name} must pin a dev SDK version, got ${entry.value}.`
        );
      }
      declarations += 1;
    }
  }
  return declarations;
}

export function stripSdkOverrides(source) {
  const lines = source.split("\n");
  const removed = [];
  const dropped = new Set();
  for (const block of findOverridesBlocks(lines)) {
    const sdkEntries = block.entries.filter((entry) => isSdkPackage(entry.name));
    if (sdkEntries.length === 0) continue;
    for (const entry of sdkEntries) {
      dropped.add(entry.lineIndex);
      removed.push(entry.name);
    }
    if (block.entries.length > sdkEntries.length) continue;
    for (let index = block.headerIndex; index < block.endIndex; index += 1) {
      dropped.add(index);
    }
    // Drop the comment block that documents the mapping we just removed.
    let cursor = block.headerIndex - 1;
    while (cursor >= 0 && lines[cursor].trim().startsWith("#")) {
      dropped.add(cursor);
      cursor -= 1;
    }
    while (cursor >= 0 && lines[cursor].trim() === "") {
      dropped.add(cursor);
      cursor -= 1;
    }
  }
  if (removed.length === 0) return { source, removed };
  return {
    source: lines.filter((_, index) => !dropped.has(index)).join("\n"),
    removed,
  };
}

function unquote(value) {
  const quoted = /^(?:"([^"]*)"|'([^']*)')$/u.exec(value);
  return quoted === null ? value : (quoted[1] ?? quoted[2]);
}

function findOverridesBlocks(lines) {
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const header = TOP_LEVEL_KEY_PATTERN.exec(lines[index]);
    if (header === null || header[1] !== "overrides") continue;
    const entries = [];
    let cursor = index + 1;
    while (cursor < lines.length) {
      const line = lines[cursor];
      if (line.trim() === "") {
        let lookahead = cursor;
        while (lookahead < lines.length && lines[lookahead].trim() === "") {
          lookahead += 1;
        }
        if (lookahead >= lines.length || !/^\s/u.test(lines[lookahead])) break;
        cursor = lookahead;
        continue;
      }
      if (!/^\s/u.test(line)) break;
      const entry = OVERRIDE_ENTRY_PATTERN.exec(line);
      if (entry !== null) {
        const name = entry[2] ?? entry[3] ?? entry[4]?.trim();
        if (name !== undefined) {
          entries.push({ name, value: unquote(entry[5]), lineIndex: cursor });
        }
      }
      cursor += 1;
    }
    blocks.push({ headerIndex: index, endIndex: cursor, entries });
    index = cursor - 1;
  }
  return blocks;
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
  const originalWorkspaceConfig = await readFile(WORKSPACE_CONFIG_PATH, "utf8");
  const aligned = { aligned: 0, removed: 0 };
  let workspaceConfig = originalWorkspaceConfig;
  let overrides = [];
  try {
    for (const pkg of packages) {
      const result = alignManifestSdkDependencies(pkg.manifest, version, workspaceNames);
      aligned.aligned += result.aligned;
      aligned.removed += result.removed;
      await writeFile(pkg.packagePath, `${JSON.stringify(pkg.manifest, null, 2)}\n`, "utf8");
    }
    ({ source: workspaceConfig, removed: overrides } = stripSdkOverrides(originalWorkspaceConfig));
    if (overrides.length > 0) {
      await writeFile(WORKSPACE_CONFIG_PATH, workspaceConfig, "utf8");
    }
    run("pnpm", [
      "install",
      "--lockfile-only",
      "--registry=https://registry.npmjs.org/",
    ]);
    const updated = await discoverWorkspacePackages();
    validateWorkspaceSdkDependencies(updated, version);
    validateWorkspaceSdkOverrides(workspaceConfig);
  } catch (error) {
    await Promise.all(packages.map((pkg) => writeFile(pkg.packagePath, pkg.source, "utf8")));
    await writeFile(LOCKFILE_PATH, originalLockfile, "utf8");
    await writeFile(WORKSPACE_CONFIG_PATH, originalWorkspaceConfig, "utf8");
    throw error;
  }
  process.stdout.write(
    `Aligned ${aligned.aligned} SDK dependency declarations across ${packages.length} workspace packages to ${version}, ` +
      `removed ${aligned.removed} transitive binding declarations and ${overrides.length} SDK overrides.\n`
  );
}

// Agent must instantiate this source with React 18 peers, separately from
// Workspace Browser's React 19 workspace link. Keep this single development-only
// copy explicit; do not allow arbitrary file SDKs.
function isAllowedFileDependency(manifest, field, name, specifier) {
  return (
    manifest.name === "dsh-univer-workspace-plugin" &&
    field === "devDependencies" &&
    name === "@univer/unit-comparison-viewer" &&
    specifier === "file:../unit-comparison-viewer"
  );
}

function isSdkPackage(name) {
  return SDK_PACKAGE_PATTERN.test(name);
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
