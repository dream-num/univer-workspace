import { cp, mkdir, readFile, realpath } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(appRoot, "package.json"));
const core = readPackageManifest(require, "@univerjs/univer-workspace-client-core");
const coreRequire = createRequire(core.path);
const renderRuntime = await readPhysicalPackageManifest(
  coreRequire,
  "@univer-cli/univer-render-runtime",
);
const renderRuntimeRequire = createRequire(renderRuntime.path);
const browserPackages = await Promise.all([
  readPhysicalPackageManifest(renderRuntimeRequire, "puppeteer-core"),
  readPhysicalPackageManifest(renderRuntimeRequire, "@puppeteer/browsers"),
]);
const runtimePool = readPackageManifest(coreRequire, "@univer-cli/univer-collaboration-runtime-pool");
const headless = readPackageManifest(coreRequire, "@univer-cli/headless-univer");
const headlessRequire = createRequire(headless.path);
const typstFacade = await readPhysicalPackageManifest(coreRequire, "@univer-cli/doc-typst-facade");
const typstFacadeRequire = createRequire(typstFacade.path);
const typstBinding = await readPhysicalPackageManifest(
  typstFacadeRequire,
  "@univerjs-pro/doc-typst-native-binding",
);
const typstBindingVersion = typstFacade.manifest.dependencies?.[
  "@univerjs-pro/doc-typst-native-binding"
];
const typstPlatformPackages = typstBinding.manifest.optionalDependencies;
const formula = readPackageManifest(headlessRequire, "@univerjs-pro/engine-formula-rust");
const binding = formula.manifest.dependencies?.["@univerjs-pro/engine-formula-rust-binding"];
const exchange = readPackageManifest(coreRequire, "@univerjs-pro/exchange-node");
const exchangeBinding = exchange.manifest.dependencies?.["@univerjs-pro/exchange-node-binding"];
const manifest = JSON.parse(await readFile(join(appRoot, "package.json"), "utf8"));

if (renderRuntime.manifest.version !== "1.0.0-beta.2") {
  throw new Error("The Client Core render runtime must be exact 1.0.0-beta.2.");
}
for (const browserPackage of browserPackages) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(browserPackage.manifest.version)) {
    throw new Error(`${browserPackage.manifest.name} resolved to a non-exact version.`);
  }
  if (manifest.dependencies?.[browserPackage.manifest.name] !== browserPackage.manifest.version) {
    throw new Error(
      `The packed ${browserPackage.manifest.name} version must match the render runtime's physical installed graph.`,
    );
  }
}

if (typeof binding !== "string" || binding.length === 0 || binding.startsWith("workspace:")) {
  throw new Error("The formula runtime must own an exact native binding dependency.");
}
if (manifest.dependencies?.["@univerjs-pro/engine-formula-rust-binding"] !== binding) {
  throw new Error("The packed native binding dependency must match its formula runtime owner.");
}
if (
  exchange.manifest.version !== "1.0.0-beta.2"
  || typeof exchangeBinding !== "string"
  || exchangeBinding.length === 0
  || exchangeBinding.startsWith("workspace:")
) {
  throw new Error("The Client Core Office exchange owner must declare the frozen native binding.");
}
if (manifest.dependencies?.["@univerjs-pro/exchange-node-binding"] !== exchangeBinding) {
  throw new Error("The packed Office native binding must match its exchange-node owner.");
}
if (
  typstFacade.manifest.version !== "1.0.0-beta.2"
  || typeof typstBindingVersion !== "string"
  || !isExactVersion(typstBindingVersion)
  || typstBinding.manifest.version !== typstBindingVersion
  || !isExactDependencyRecord(typstPlatformPackages)
) {
  throw new Error("The Client Core Typst facade must own one frozen native wrapper and platform cohort.");
}
if (manifest.dependencies?.["@univerjs-pro/doc-typst-native-binding"] !== typstBindingVersion) {
  throw new Error("The packed Typst native wrapper must match its facade owner.");
}
if (!sameDependencyRecord(manifest.optionalDependencies, typstPlatformPackages)) {
  throw new Error("The packed Typst platform packages must match the native wrapper owner.");
}
const installedTypstPlatforms = await Promise.all(Object.keys(typstPlatformPackages).map(async (name) => {
  try {
    return await readPhysicalPackageManifest(createRequire(typstBinding.path), name);
  } catch {
    return undefined;
  }
}));
if (!installedTypstPlatforms.some((platformPackage) =>
  platformPackage !== undefined
  && platformPackage.manifest.version === typstPlatformPackages[platformPackage.manifest.name]
  && platformPackage.manifest.os?.includes(process.platform)
  && platformPackage.manifest.cpu?.includes(process.arch))) {
  throw new Error("The current Typst native platform package is missing from the physical installed graph.");
}

const target = join(appRoot, "dist", "chunks", "worker-child.mjs");
await mkdir(dirname(target), { recursive: true });
await cp(join(dirname(runtimePool.path), "dist", "worker-child.mjs"), target);
await cp(
  join(dirname(core.path), "dist", "render-runtime"),
  join(appRoot, "dist", "render-runtime"),
  { recursive: true },
);

async function readPhysicalPackageManifest(packageRequire, name) {
  const resolved = readPackageManifest(packageRequire, name);
  const path = await realpath(resolved.path);
  return { manifest: JSON.parse(await readFile(path, "utf8")), path };
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

function isExactVersion(value) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(value) && !value.startsWith("workspace:");
}

function isExactDependencyRecord(value) {
  return value !== null
    && typeof value === "object"
    && Object.keys(value).length > 0
    && Object.values(value).every((version) => typeof version === "string" && isExactVersion(version));
}

function sameDependencyRecord(left, right) {
  return JSON.stringify(Object.entries(left ?? {}).sort()) === JSON.stringify(Object.entries(right ?? {}).sort());
}
