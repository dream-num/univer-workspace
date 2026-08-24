import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, resolve } from "node:path";
import { init as initEsmLexer, parse as parseEsmImports } from "es-module-lexer";
import {
  EXTERNAL_RUNTIME_DEPENDENCIES,
  PACKAGE_FILES,
  PUBLISH_REGISTRY,
} from "./package-artifact.mjs";

await initEsmLexer;

const packageRoot = resolve(process.argv[2] ?? "package-dist");
const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));

assertEqual(packageJson.private, false, "private");
assertEqual(packageJson.license, "Apache-2.0", "license");
assertEqual(packageJson.publishConfig?.registry, PUBLISH_REGISTRY, "publish registry");
assertEqual(packageJson.engines?.node, ">=22.12.0", "Node engine");
assertEqual(
  JSON.stringify(packageJson.bin),
  JSON.stringify({ "univer-workspace-cli": "./bin/univer-workspace-cli.js" }),
  "bin",
);
assertEqual(JSON.stringify(packageJson.files), JSON.stringify(PACKAGE_FILES), "files");
assertEqual(
  JSON.stringify(Object.keys(packageJson.dependencies ?? {}).sort()),
  JSON.stringify([...EXTERNAL_RUNTIME_DEPENDENCIES].sort()),
  "runtime dependencies",
);

for (const path of [
  "LICENSE",
  "README.md",
  "bin/univer-workspace-cli.js",
  "dist/main.js",
  "dist/runtime/daemon.js",
  "dist/runtime/worker.js",
  "dist/render-runtime/index.html",
  "skill-data/core/SKILL.md",
  "skill-data/sheet/SKILL.md",
  "skill-data/doc/SKILL.md",
  "skill-data/slide/SKILL.md",
  "skill-data/base/SKILL.md",
  "skill-data/board/SKILL.md",
  "skill-data/embed/SKILL.md",
  "skill-data/cross-unit-formula/SKILL.md",
]) {
  assertFile(path);
}
assertDirectory("dist/render-runtime/assets");
assertWorkerChildClosure();
assertBundledCommonjsNodeGlobals();
if ((statSync(join(packageRoot, "bin/univer-workspace-cli.js")).mode & 0o111) === 0) {
  throw new Error("Package launcher must be executable");
}

const forbidden = findFiles(packageRoot).filter((path) =>
  /(^|\/)(?:src|test)(?:\/|$)|\.d\.ts$|\.map$|\.ts$|\.tsbuildinfo$/u.test(path),
);
if (forbidden.length > 0) {
  throw new Error(`Package contains forbidden files:\n${forbidden.join("\n")}`);
}

const unresolved = findUnresolvedBareImports();
if (unresolved.length > 0) {
  throw new Error(`Package contains unresolved runtime imports:\n${unresolved.join("\n")}`);
}

const packed = spawnSync("npm", ["pack", "--dry-run", "--json"], {
  cwd: packageRoot,
  encoding: "utf8",
  env: { ...process.env, npm_config_update_notifier: "false" },
});
if (packed.status !== 0) throw new Error(packed.stderr || packed.stdout);
const artifacts = JSON.parse(packed.stdout);
if (!Array.isArray(artifacts) || artifacts.length !== 1) {
  throw new Error("npm pack dry-run must produce exactly one artifact");
}
const artifact = artifacts[0];
console.log(
  `[package] files=${String(artifact.entryCount)} packed=${String(artifact.size)} unpacked=${String(artifact.unpackedSize)}`,
);

function findUnresolvedBareImports() {
  const allowed = new Set(Object.keys(packageJson.dependencies ?? {}));
  const builtins = new Set([
    ...builtinModules,
    ...builtinModules.map((name) => `node:${name}`),
  ]);
  const matches = [];
  for (const relativePath of findFiles(packageRoot).filter((path) => path.endsWith(".js"))) {
    const [imports] = parseEsmImports(
      readFileSync(join(packageRoot, relativePath), "utf8"),
      relativePath,
    );
    for (const record of imports) {
      const specifier = record.n;
      if (
        specifier === undefined ||
        specifier.startsWith(".") ||
        specifier.startsWith("/") ||
        /^[a-z][a-z0-9+.-]*:/iu.test(specifier) ||
        builtins.has(specifier)
      ) {
        continue;
      }
      const packageName = specifier.startsWith("@")
        ? specifier.split("/").slice(0, 2).join("/")
        : specifier.split("/")[0];
      if (!allowed.has(packageName)) matches.push(`${relativePath}: ${specifier}`);
    }
  }
  return matches;
}

function assertWorkerChildClosure() {
  const workerChildUsers = findFiles(packageRoot).filter(
    (path) =>
      path.endsWith(".js") &&
      readFileSync(join(packageRoot, path), "utf8").includes("worker-child.mjs"),
  );
  if (workerChildUsers.length === 0) {
    throw new Error("Package does not contain the collaboration runtime worker client");
  }
  for (const user of workerChildUsers) {
    assertFile(join(dirname(user), "worker-child.mjs"));
  }
}

function assertBundledCommonjsNodeGlobals() {
  const brokenChunks = findFiles(packageRoot).filter((path) => {
    if (!path.endsWith(".js")) return false;
    const code = readFileSync(join(packageRoot, path), "utf8");
    return (
      (code.includes("environment that doesn't expose the `require` function") &&
        !code.includes("createRequire")) ||
      (code.includes("__filename") &&
        !/\b(?:const|let|var)\s+__filename\b/u.test(code)) ||
      (code.includes("__dirname") && !/\b(?:const|let|var)\s+__dirname\b/u.test(code))
    );
  });
  if (brokenChunks.length > 0) {
    throw new Error(
      `Bundled CommonJS chunks do not provide Node require:\n${brokenChunks.join("\n")}`,
    );
  }
}

function findFiles(root, relative = "") {
  const files = [];
  for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
    const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) files.push(...findFiles(root, path));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}

function assertFile(relativePath) {
  const path = join(packageRoot, relativePath);
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`Missing package file: ${relativePath}`);
  }
}

function assertDirectory(relativePath) {
  const path = join(packageRoot, relativePath);
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error(`Missing package directory: ${relativePath}`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`Unexpected ${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}
