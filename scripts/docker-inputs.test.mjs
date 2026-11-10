import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { posix } from "node:path";
import test from "node:test";

const root = new URL("../", import.meta.url);
const packages = new Map();
for (const parent of ["apps", "packages"]) {
  for (const entry of readdirSync(new URL(`${parent}/`, root), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = `${parent}/${entry.name}`;
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(new URL(`${directory}/package.json`, root), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    packages.set(manifest.name, { directory, ...manifest });
  }
}

function localPackages(name, manifests, visited = new Set()) {
  if (visited.has(name)) return visited;
  const manifest = manifests.get(name);
  assert.ok(manifest, `Unknown local workspace package: ${name}`);
  visited.add(name);
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    for (const [dependency, version] of Object.entries(manifest[field] ?? {})) {
      if (version.startsWith("workspace:")) localPackages(dependency, manifests, visited);
    }
  }
  return visited;
}

function copySources(dockerfile) {
  // Reads only one-line shell COPY in the first build stage; extend it if a covered Dockerfile changes syntax.
  const sources = [];
  const manifests = [];
  let stages = 0;
  let installed = false;
  for (const instruction of dockerfile.split("\n")) {
    const line = instruction.trim();
    if (/^FROM\s/i.test(line) && ++stages > 1) break;
    if (/\bpnpm\s+install\b/.test(line)) installed = true;
    const copy = /^COPY\s+(.+)/i.exec(line);
    if (!copy || /--from=/.test(copy[1])) continue;
    const paths = copy[1]
      .split(/\s+/)
      .filter((part) => !part.startsWith("--"))
      .slice(0, -1)
      .map((source) => posix.normalize(source).replace(/\/$/, ""));
    sources.push(...paths);
    if (!installed) manifests.push(...paths);
  }
  return { manifests, sources };
}

function missingInputs(directory, copies) {
  const includes = (path, sources) =>
    sources.some((source) => source === "." || path === source || path.startsWith(`${source}/`));
  return [
    ...(!includes(`${directory}/package.json`, copies.manifests)
      ? [`${directory}/package.json`]
      : []),
    ...(!includes(directory, copies.sources) ? [directory] : []),
  ];
}

test("walks every workspace dependency field transitively and handles cycles", () => {
  const manifests = new Map([
    ["app", { dependencies: { direct: "workspace:*", external: "1.0.0" } }],
    ["direct", { devDependencies: { dev: "workspace:*" } }],
    ["dev", { peerDependencies: { peer: "workspace:*" } }],
    ["peer", { dependencies: { app: "workspace:*" } }],
  ]);
  assert.deepEqual([...localPackages("app", manifests)], ["app", "direct", "dev", "peer"]);
  assert.throws(
    () => localPackages("missing", manifests),
    /Unknown local workspace package: missing/,
  );
});

test("requires both manifest and source copies, including directory-wide copies", () => {
  const directory = "packages/example";
  const manifestCopy = `COPY ${directory}/package.json ./${directory}/package.json\n`;
  const sourceCopy = `COPY ${directory} ./${directory}\n`;
  const install = "RUN pnpm install --frozen-lockfile\n";
  assert.deepEqual(missingInputs(directory, copySources(manifestCopy + install + sourceCopy)), []);
  assert.deepEqual(missingInputs(directory, copySources(install + sourceCopy)), [
    `${directory}/package.json`,
  ]);
  assert.deepEqual(missingInputs(directory, copySources(manifestCopy + install)), [directory]);
  assert.deepEqual(missingInputs(directory, copySources("COPY packages ./packages")), []);
  assert.deepEqual(missingInputs(directory, copySources("COPY packages/example-other ./other")), [
    `${directory}/package.json`,
    directory,
  ]);
  assert.deepEqual(
    copySources(`FROM node AS build
# COPY packages ./packages
COPY packages/example/package.json ./packages/example/package.json
COPY --chown=node:node ./apps/ ./apps/
COPY --from=other packages ./packages
FROM node AS runtime
COPY packages ./packages`),
    {
      manifests: [`${directory}/package.json`, "apps"],
      sources: [`${directory}/package.json`, "apps"],
    },
  );
});

for (const name of [
  "@univerjs/univer-workspace",
  "@univerjs/univer-workspace-mcp",
  "@univerjs/workspace-agent",
]) {
  const dockerfile = `${packages.get(name).directory}/Dockerfile`;
  test(`${dockerfile} copies its local workspace package manifests and sources`, () => {
    const sources = copySources(readFileSync(new URL(dockerfile, root), "utf8"));
    const missing = [...localPackages(name, packages)].flatMap((dependency) =>
      missingInputs(packages.get(dependency).directory, sources),
    );
    assert.deepEqual(missing, [], `${dockerfile} is missing COPY inputs:\n${missing.join("\n")}`);
  });
}
