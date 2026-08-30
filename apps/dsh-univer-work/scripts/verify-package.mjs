import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { builtinModules, createRequire } from "node:module";
import { dirname, join, posix } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import {
  ACCEPTED_WORKSPACE_TOOL_NAMES,
  BUNDLED_SKILL_NAMES,
  validateBundledSkillSources,
} from "./skill-contract.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const PACKAGE_LIMITS = Object.freeze({
  entries: 256,
  packedBytes: 16_777_216,
  unpackedBytes: 67_108_864,
});
const FROZEN_PACKAGE_EVIDENCE = Object.freeze({
  entries: 123,
  id: "task7-final-before-doc-projection-gate",
  packedBytes: 12_945_659,
  unpackedBytes: 57_929_107,
});
const checkoutRoot = realpathSync(join(appRoot, "../..")).replaceAll("\\", "/");
const windowsCheckoutRoot = checkoutRoot.replaceAll("/", "\\");
const checkoutRootPattern = new RegExp(
  `${escapeRegExp(checkoutRoot)}|(?:[A-Za-z]:)?${escapeRegExp(windowsCheckoutRoot)}`,
  "u",
);
const localPathPattern = /(?:(?:file|link):(?:\.\.?[/\\]|\/|[A-Za-z]:[/\\])|(?<!\.)\.\.[/\\])/m;
const absoluteSourcePathPattern = /(?:^|[\s"'`(=])(?:\/(?!\/)(?:[-+@._A-Za-z0-9]+\/)+[-+@._A-Za-z0-9]+\.(?:[cm]?[jt]sx?|map)|[A-Za-z]:[/\\](?:[-+@._A-Za-z0-9 ]+[/\\])+[-+@._A-Za-z0-9 ]+\.(?:[cm]?[jt]sx?|map))/mu;
const manifest = JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8"));
const parityManifest = await loadParityManifest();
const expectedReadmeProjection = renderParityReadmeProjection(parityManifest);
assertParityReadmeProjectionNegativeCases(expectedReadmeProjection, parityManifest);
if (process.argv.includes("--docs-only")) {
  assertParityReadmeProjection(
    readFileSync(join(appRoot, "README.md"), "utf8"),
    parityManifest,
    { entryCount: FROZEN_PACKAGE_EVIDENCE.entries },
  );
  console.log("verified README parity projection");
  process.exit(0);
}
for (const allowed of [
  "file://a.xlsx",
  String.raw`file://docs.example`,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`,
]) {
  assert.doesNotMatch(stripDocumentFileAuthority(allowed), localPathPattern);
  assert.doesNotMatch(allowed, absoluteSourcePathPattern);
}
for (const rejected of [
  "file:../source.ts",
  "file:/Users/private/source.ts",
  "file:///tmp/source.ts",
  String.raw`file:C:\private\source.ts`,
  "link:../source.ts",
  "link:/workspace/source.ts",
]) {
  assert.match(stripDocumentFileAuthority(rejected), localPathPattern);
}
for (const rejected of [
  "/private/checkout/src/source.ts",
  String.raw`D:\checkout\packages\source\index.ts`,
]) {
  assert.match(rejected, absoluteSourcePathPattern);
}
assertRenderAssetGraphNegativeCases();
assertPackageInspectionNegativeCases();
const distFiles = findFiles(join(appRoot, "dist")).map((path) => `dist/${path}`);
const hostDistFiles = distFiles.filter((path) => !path.startsWith("dist/render-runtime/"));
assert.equal(
  distFiles.every((path) =>
    path === "dist/index.js"
    || path === "dist/worker.js"
    || path === "dist/chunks/worker-child.mjs"
    || /^dist\/chunks\/[-_A-Za-z0-9]+\.js$/u.test(path)
    || /^dist\/render-runtime\/(?:index\.html|assets\/[-_A-Za-z0-9]+\.(?:css|js|svg|woff2?))$/u.test(path)),
  true,
  "dist contains an unexpected runtime resource",
);
assertRuntimeGraphNegativeCases();
assertDistRuntimeClosure();
assertRenderAssetClosure();
const expectedFiles = [
  "LICENSE",
  "README.md",
  "cordis.patch.yml",
  ...distFiles,
  "package.json",
  "skills/core/SKILL.md",
  ...BUNDLED_SKILL_NAMES.map((name) => `skills/${name}/SKILL.md`),
].sort();

const inspectedPack = inspectPack();
assertPackageInspection(inspectedPack, expectedFiles.filter((path) => path !== "LICENSE"));
assertParityReadmeProjection(
  readFileSync(join(appRoot, "README.md"), "utf8"),
  parityManifest,
  inspectedPack,
);

const packRoot = mkdtempSync(join(tmpdir(), "dsh-univer-work-pack-"));
let packed;
let summary;
let files;
try {
  packed = spawnSync("pnpm", ["--dir", appRoot, "pack", "--pack-destination", packRoot, "--json"], {
    cwd: packRoot,
    encoding: "utf8",
  });

  assert.equal(
    packed.status,
    0,
    `pnpm pack failed\nstdout:\n${packed.stdout}\nstderr:\n${packed.stderr}`,
  );

  summary = JSON.parse(packed.stdout);
  files = summary.files.map(({ path }) => path).sort();
  assert.deepEqual(files, expectedFiles, "packed file closure changed");
  const packedSkills = BUNDLED_SKILL_NAMES.map((name) => {
    const extracted = spawnSync("tar", ["-xOf", summary.filename, `package/skills/${name}/SKILL.md`], {
      cwd: packRoot,
      encoding: "utf8",
    });
    assert.equal(extracted.status, 0, `cannot read packed Skill ${name}: ${extracted.stderr}`);
    return { name, source: extracted.stdout };
  });
  validateBundledSkillSources(packedSkills, ACCEPTED_WORKSPACE_TOOL_NAMES);
} finally {
  rmSync(packRoot, { recursive: true, force: true });
}
assert.equal(existsSync(packRoot), false, "temporary packed artifact root was not removed");

assert.equal(manifest.name, "dsh-univer-work");
assert.equal(manifest.version, "0.0.0");
assert.equal(manifest.private, true);
assert.equal(manifest.dsh.bundle.patch, "./cordis.patch.yml");
assert.equal(manifest.dsh.client, undefined);
assert.equal(manifest.files.includes("skills"), true);
for (const lifecycle of ["preinstall", "install", "postinstall", "prepare"]) {
  assert.equal(manifest.scripts[lifecycle], undefined, `package must not generate Skills during ${lifecycle}`);
}
const packageRequire = createRequire(new URL("../package.json", import.meta.url));
const core = readPackageManifest(packageRequire, "@univerjs/univer-workspace-client-core");
const coreRequire = createRequire(core.path);
const svgFacade = readPhysicalPackageManifest(coreRequire, "@univer-cli/svg-facade");
const renderRuntime = readPhysicalPackageManifest(coreRequire, "@univer-cli/univer-render-runtime");
assert.equal(renderRuntime.manifest.version, "1.0.0-beta.2");
assert.equal(svgFacade.manifest.version, "1.0.0-beta.2");
assert.equal(core.manifest.dependencies?.["@univer-cli/svg-facade"], svgFacade.manifest.version);
assert.equal(manifest.devDependencies["@univer-cli/svg-facade"], undefined);
const renderRuntimeRequire = createRequire(renderRuntime.path);
const browserPackages = [
  readPhysicalPackageManifest(renderRuntimeRequire, "@puppeteer/browsers"),
  readPhysicalPackageManifest(renderRuntimeRequire, "puppeteer-core"),
];
const coreModule = await import(pathToFileURL(packageRequire.resolve("@univerjs/univer-workspace-client-core")));
const collaborationRuntime = coreRequire("@univer-cli/univer-collaboration-runtime");
const collaborationRuntimePool = coreRequire("@univer-cli/univer-collaboration-runtime-pool");
const exchange = readPackageManifest(coreRequire, "@univerjs-pro/exchange-node");
const exchangeRequire = createRequire(exchange.path);
const exchangeModule = await import(pathToFileURL(join(dirname(exchange.path), exchange.manifest.exports["."].import)));
assert.equal(coreModule.CollaborationRuntimeError, collaborationRuntime.CollaborationRuntimeError);
assert.equal(
  coreModule.UniverCollaborationRuntimePoolError,
  collaborationRuntimePool.UniverCollaborationRuntimePoolError,
);
assert.equal(manifest.devDependencies["@univer-cli/univer-collaboration-runtime"], undefined);
assert.equal(manifest.devDependencies["@univer-cli/univer-collaboration-runtime-pool"], undefined);
assert.equal(core.manifest.dependencies?.["@univerjs-pro/exchange-node"], "1.0.0-beta.2");
assert.equal(exchange.manifest.version, "1.0.0-beta.2");
assert.equal(coreModule.ExchangeError, exchangeModule.ExchangeError);
assert.equal(coreModule.ExchangeErrorCode, exchangeModule.ExchangeErrorCode);
const headless = readPackageManifest(coreRequire, "@univer-cli/headless-univer");
const typstFacade = readPhysicalPackageManifest(coreRequire, "@univer-cli/doc-typst-facade");
const typstFacadeRequire = createRequire(typstFacade.path);
const typstBinding = readPhysicalPackageManifest(
  typstFacadeRequire,
  "@univerjs-pro/doc-typst-native-binding",
);
const typstTypeScript = readPhysicalPackageManifest(typstFacadeRequire, "typescript");
const typstBindingVersion = typstFacade.manifest.dependencies?.[
  "@univerjs-pro/doc-typst-native-binding"
];
const typstPlatformPackages = typstBinding.manifest.optionalDependencies;
const formula = readPackageManifest(
  createRequire(headless.path),
  "@univerjs-pro/engine-formula-rust",
);
const bindingVersion = formula.manifest.dependencies?.["@univerjs-pro/engine-formula-rust-binding"];
const exchangeBindingVersion = exchange.manifest.dependencies?.["@univerjs-pro/exchange-node-binding"];
assert.equal(typeof bindingVersion, "string");
assert.equal(typeof exchangeBindingVersion, "string");
assert.equal(
  readPackageManifest(exchangeRequire, "@univerjs-pro/exchange-node-binding").manifest.version,
  exchangeBindingVersion,
);
assert.deepEqual(manifest.dependencies, {
  "@univerjs-pro/cli-assets": "0.1.0",
  "@univerjs-pro/doc-typst-native-binding": typstBindingVersion,
  "@univerjs-pro/exchange-node-binding": exchangeBindingVersion,
  "@univerjs-pro/engine-formula-rust-binding": bindingVersion,
  "@puppeteer/browsers": browserPackages[0].manifest.version,
  "puppeteer-core": browserPackages[1].manifest.version,
});
assert.equal(typstFacade.manifest.version, "1.0.0-beta.2");
assert.equal(typstBinding.manifest.version, typstBindingVersion);
assert.match(typstBindingVersion, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u);
assert.deepEqual(manifest.optionalDependencies, typstPlatformPackages);
const installedTypstPlatforms = Object.keys(typstPlatformPackages).flatMap((name) => {
  try {
    return [readPhysicalPackageManifest(createRequire(typstBinding.path), name)];
  } catch {
    return [];
  }
});
assert.ok(installedTypstPlatforms.some(({ manifest: platformManifest }) =>
  platformManifest.version === typstPlatformPackages[platformManifest.name]
  && platformManifest.os?.includes(process.platform)
  && platformManifest.cpu?.includes(process.arch)),
"current Typst native platform package is absent from the physical owner graph");
for (const browserPackage of browserPackages) {
  assert.match(browserPackage.manifest.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u);
  assert.equal(manifest.dependencies[browserPackage.manifest.name], browserPackage.manifest.version);
}
assert.equal(manifest.devDependencies["@univer-cli/api-reference"], "1.0.0-beta.2");
assert.equal(manifest.devDependencies["@univer-cli/resource-library"], "1.0.0-beta.2");
assert.deepEqual(manifest.peerDependencies, {
  "@deepseek-ai/cordis": "4.0.1",
  "@deepseek-ai/dsh-credentials": "0.1.1-rc.2",
  "@deepseek-ai/dsh-fs": "0.1.1-rc.2",
  "@deepseek-ai/dsh-fs-local": "0.1.1-rc.2",
  "@deepseek-ai/dsh-llm": "0.1.1-rc.2",
  "@deepseek-ai/dsh-sandbox": "0.1.1-rc.2",
  "@deepseek-ai/dsh-sandbox-policy": "0.1.1-rc.2",
  "@deepseek-ai/dsh-skill": "0.1.1-rc.2",
  "@deepseek-ai/dsh-tools": "0.1.1-rc.2",
});
assert.deepEqual(manifest.peerDependenciesMeta, Object.fromEntries(
  Object.keys(manifest.peerDependencies).map((name) => [name, { optional: true }]),
));
assert.equal(
  [...Object.values(manifest.dependencies), ...Object.values(manifest.optionalDependencies),
    ...Object.values(manifest.peerDependencies)].some((version) => version.startsWith("workspace:")),
  false,
  "packed manifest must not contain workspace peers",
);

for (const script of ["preinstall", "install", "postinstall", "prepare"]) {
  assert.equal(manifest.scripts[script], undefined, `${script} must not run at install time`);
}

const targets = [
  manifest.main,
  manifest.dsh.bundle.patch,
  ...Object.values(manifest.exports).filter((value) => typeof value === "string"),
].map((target) => target.replace(/^\.\//, ""));
assert.deepEqual(Object.keys(manifest.exports).sort(), [".", "./cordis.patch.yml", "./package.json"]);
assert.equal(Object.keys(manifest.exports).some((key) => key.includes("chunks")), false);

for (const target of targets) {
  assert.ok(files.includes(target), `manifest target is not packed: ${target}`);
}

assert.equal(files.some((path) => /(^|\/)(src|test|scripts)(\/|$)/i.test(path)), false,
  "source or test files entered the artifact");

for (const path of files.filter((path) => /\.(?:js|json|md|ya?ml)$/.test(path))) {
  const content = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  assertRuntimeSourcePolicy(path, content);
}

assert.ok(files.includes("dist/index.js"));
assert.ok(files.includes("dist/worker.js"));
assert.ok(files.includes("dist/chunks/worker-child.mjs"));
assertWorkerChildClosure();
assertBundledCommonjsNodeGlobals();

const bundle = await readFile(new URL("../dist/index.js", import.meta.url), "utf8");
assert.equal(bundle.match(/["']\.\/worker\.js["']/gu)?.length, 1,
  "Host must contain one package-relative worker entry");
assert.match(bundle, /new URL\([^)]*,\s*import\.meta\.url\)/u,
  "Host worker entry must resolve relative to the installed module");
assert.doesNotMatch(bundle, /data:(?:application|text|video)\//u,
  "Host worker entry must not be transformed into an inline source module");
for (const reachable of [
  "workspace_space_list",
  "workspace_space_browse",
  "workspace_space_find",
  "workspace_node_create",
  "workspace_node_rename",
  "workspace_node_move",
  "workspace_node_trash",
  "/api/spaces",
  "workspace-result-unknown",
  "workspace_worktree_list",
  "workspace_worktree_get",
  "workspace_worktree_create",
  "workspace_worktree_update",
  "workspace_worktree_ready",
  "workspace_worktree_reopen",
  "workspace_worktree_merge",
  "workspace_worktree_discard",
  "workspace_unit_list",
  "workspace_unit_add",
  "workspace_unit_create",
  "workspace_worktree_review_url",
  "/api/worktrees",
  "Operate remote Univer Workspace authentication",
  "workspace_blob_get",
  "workspace_blob_upload",
  "workspace_blob_download",
  "workspace_asset_download",
  "/api/blob-upload-sessions",
  "/sign-url",
  "workspace-local-filesystem-required",
  "workspace-file-policy-denied",
  "workspace_content_inspect",
  "workspace_content_execute",
  "Workspace content execution may change remote Draft content.",
  "workspace-content-partial-side-effect",
  "WORKSPACE_RUNTIME_RESULT_INVALID",
  "workspace_api_find",
  "workspace_api_show",
  "workspace_resource_registries",
  "workspace_resource_find",
  "workspace_resource_export",
  "workspace-discovery-dataset-invalid",
  "workspace-discovery-result-too-large",
  "resource-download-too-large",
  "workspace_office_import",
  "workspace_office_export",
  "workspace-office-conversion-failed",
  "workspace-office-limit-exceeded",
  "workspace-office-output-exists",
  "INVALID_ARGUMENT",
  "UNSUPPORTED_FORMAT",
  "INVALID_FILE",
  "INCOMPLETE_SNAPSHOT",
  "IO_ERROR",
  "NATIVE_LOAD_FAILED",
  "CONVERSION_FAILED",
  "workspace_screenshot",
  "workspace_layout_lint",
  "workspace-screenshot-output-partial",
  "workspace-unit-layout-lint-unit-type-unsupported",
  "workspace_typst_compile",
  "workspace_typst_apply",
  "workspace-typst-artifact-partial",
  "workspace-typst-partial-side-effect",
  "workspace_svg_compile",
  "workspace_svg_apply",
  "workspace-svg-apply-partial",
]) {
  assert.ok(bundle.includes(reachable), `reachable Space/Node code is missing: ${reachable}`);
}
assert.doesNotMatch(bundle, /apps[/\\](?:cli|workspace)|univer-workspace-cli/);

const emitted = hostDistFiles.map((path) => readFileSync(join(appRoot, path), "utf8")).join("\n");
for (const external of Object.keys(manifest.dependencies)) {
  assert.ok(emitted.includes(external), `declared runtime dependency is not reachable: ${external}`);
}
for (const name of BUNDLED_SKILL_NAMES) {
  const source = readFileSync(join(appRoot, "skills", name, "SKILL.md"), "utf8");
  const description = /^description: ([^\r\n]+)$/mu.exec(source)?.[1];
  assert.ok(description, `missing Skill description: ${name}`);
  assert.equal(emitted.includes(description), false, `packed Host inlined Skill source: ${name}`);
}
assert.equal(
  emitted.split("UniverCollaborationRuntimePoolError").length - 1,
  1,
  "packed runtime contains duplicate collaboration error constructor graphs",
);
assert.match(emitted, /@univerjs-pro\/engine-formula-rust-binding/u);
assert.match(emitted, /@univerjs-pro\/exchange-node-binding/u);
assert.match(emitted, /@univerjs-pro\/doc-typst-native-binding/u);
assert.match(emitted, /@univer-cli\+doc-typst-facade@1\.0\.0-beta\.2/u);
assert.match(emitted, /@univer-cli\+svg-facade@1\.0\.0-beta\.2/u);
assert.equal((emitted.match(/SVG_FACADE_COMPILE_FAILED/gu) ?? []).length, 1,
  "packed Host must contain one exact SVG facade error constructor graph");
assert.match(emitted, /@univer-cli\+headless-univer@1\.0\.0-beta\.2/u);
assert.match(emitted, /versionMajorMinor/u);
assert.ok(emitted.includes(`"${typstTypeScript.manifest.version}"`),
  "packed Host does not contain its facade-owned TypeScript printer");
assert.match(emitted, /Generated by @univer-cli\/doc-typst-facade/u);
assert.doesNotMatch(emitted, /__UNIVER_RUST_FORMULA_LOCAL_BINDING_FALLBACKS__/u);
assert.doesNotMatch(emitted, /(?:apps[/\\]cli|runtime[/\\]daemon|univer-workspace-cli|Session file)/iu);
assert.doesNotMatch(emitted, /(?:\b(?:spawn|execFile|exec)\s*\([^\n]{0,160}["'`]typst(?:\.exe)?["'`]|\/usr\/bin\/typst|\\typst\.exe)/iu);
assert.equal((emitted.match(/["']\.\/worker\.js["']/gu) ?? []).length, 1,
  "packed Host must not contain a second Typst worker entry");

const coreSkill = await readFile(new URL("../skills/core/SKILL.md", import.meta.url), "utf8");
assert.ok(coreSkill.includes("workspace_worktree_review_url"));
assert.doesNotMatch(coreSkill, /univer-workspace-cli|workspace_blob_|workspace_asset_download|workspace_content_|workspace_api_|workspace_resource_|workspace_office_|workspace_typst_|workspace_svg_|workspace_render_|screenshot|layout lint|Web Client/i);
validateBundledSkillSources(await Promise.all(BUNDLED_SKILL_NAMES.map(async (name) => ({
  name,
  source: await readFile(new URL(`../skills/${name}/SKILL.md`, import.meta.url), "utf8"),
}))), ACCEPTED_WORKSPACE_TOOL_NAMES);

console.log(`package budget: ${packageMeasurements(inspectedPack)}`);
console.log(`largest packed entries: ${largestEntries(inspectedPack.files)}`);
console.log(`verified ${summary.filename}: ${files.join(", ")}`);

function inspectPack() {
  const inspected = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: appRoot,
    encoding: "utf8",
  });
  assert.equal(
    inspected.status,
    0,
    `npm pack inspection failed\nstdout:\n${inspected.stdout}\nstderr:\n${inspected.stderr}`,
  );
  let parsed;
  try {
    parsed = JSON.parse(inspected.stdout);
  } catch {
    assert.fail(`npm pack inspection returned invalid JSON: ${inspected.stdout}`);
  }
  assert.equal(Array.isArray(parsed) && parsed.length === 1, true,
    "npm pack inspection must return exactly one artifact");
  return parsed[0];
}

function assertPackageInspection(inspected, expected, limits = PACKAGE_LIMITS) {
  assert.equal(typeof inspected, "object", "package inspection is missing");
  assert.notEqual(inspected, null, "package inspection is missing");
  const measured = packageMeasurements(inspected);
  for (const [field, value] of [
    ["size", inspected.size],
    ["unpackedSize", inspected.unpackedSize],
    ["entryCount", inspected.entryCount],
  ]) {
    assert.equal(Number.isSafeInteger(value) && value >= 0, true,
      `package inspection has invalid ${field}; ${measured}`);
  }
  assert.equal(Array.isArray(inspected.files), true, `package inspection files are missing; ${measured}`);
  const entries = inspected.files.map((file) => {
    assert.equal(
      typeof file?.path === "string"
      && file.path !== ""
      && Number.isSafeInteger(file.size)
      && file.size >= 0,
      true,
      `package inspection has an invalid file entry; ${measured}`,
    );
    return { path: file.path, size: file.size };
  });
  assert.equal(entries.length, inspected.entryCount, `package entry count mismatch; ${measured}`);
  assert.equal(entries.reduce((total, file) => total + file.size, 0), inspected.unpackedSize,
    `package unpacked byte total mismatch; ${measured}`);
  assert.deepEqual(entries.map(({ path }) => path).sort(), [...expected].sort(),
    `packed file closure changed; ${measured}`);
  assert.ok(inspected.size <= limits.packedBytes, `packed byte limit exceeded; ${measured}`);
  assert.ok(inspected.unpackedSize <= limits.unpackedBytes, `unpacked byte limit exceeded; ${measured}`);
  assert.ok(inspected.entryCount <= limits.entries, `entry limit exceeded; ${measured}`);
}

function packageMeasurements(inspected) {
  return `packed=${String(inspected?.size)}, unpacked=${String(inspected?.unpackedSize)}, entries=${String(inspected?.entryCount)}`;
}

function largestEntries(files) {
  return [...files]
    .sort((left, right) => right.size - left.size || left.path.localeCompare(right.path))
    .slice(0, 10)
    .map(({ path, size }) => `${path}=${size}`)
    .join(", ");
}

async function loadParityManifest() {
  const source = readFileSync(join(appRoot, "src/parity-manifest.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "parity-manifest.ts",
  }).outputText;
  const loaded = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
  assert.equal(typeof loaded.PARITY_MANIFEST, "object", "PARITY_MANIFEST did not load");
  return loaded.PARITY_MANIFEST;
}

function renderParityReadmeProjection(parity) {
  const rows = parity.outcomes.map((outcome) =>
    `| \`${outcome.id}\` | \`${outcome.owner}\` | ${String(outcome.operations.length)} | ${String(outcome.skills.length)} |`)
    .join("\n");
  const toolCount = parity.outcomes.reduce((total, outcome) => total + outcome.operations.length, 0);
  const skillCount = parity.outcomes.reduce((total, outcome) => total + outcome.skills.length, 0);
  return `<!-- parity-manifest-projection:start -->
Baseline: Workspace \`${parity.baseline.workspaceCommit}\`, Univer SDK
\`${parity.baseline.sdk}\`, DeepSeek Harness \`${parity.baseline.dsh}\` at
\`${parity.baseline.dshCommit}\`.

| Outcome | Owning Change | Tools | Skills |
| --- | --- | ---: | ---: |
${rows}

The manifest contains ${String(parity.outcomes.length)} outcome groups, ${String(toolCount)} tools, and ${String(skillCount)} Skills.

Fixed package limits: ${formatInteger(PACKAGE_LIMITS.packedBytes)} packed bytes,
${formatInteger(PACKAGE_LIMITS.unpackedBytes)} unpacked bytes, and
${String(PACKAGE_LIMITS.entries)} entries. Frozen package evidence
\`${FROZEN_PACKAGE_EVIDENCE.id}\` measured
${formatInteger(FROZEN_PACKAGE_EVIDENCE.packedBytes)} packed bytes,
${formatInteger(FROZEN_PACKAGE_EVIDENCE.unpackedBytes)} unpacked bytes, and
${String(FROZEN_PACKAGE_EVIDENCE.entries)} entries. \`package:verify\` obtains the live
measurement from one \`npm pack --dry-run --json --ignore-scripts\` inspection,
prints it, and enforces the fixed limits. The frozen packed-byte evidence is a
named run, not a self-referential equality constraint on this README's gzip
bytes.

All filesystem and process effects run in the local DSH Host execution world
through its in-process \`LocalFileSystem\`, Agent Session cwd, packaged workers,
native bindings, compilers, and explicitly selected installed browser. Remote
or E2B filesystem path interpretation is outside this contract. Installed
parity tests use isolated loopback authorities; production remote workflows
still call the configured authenticated Workspace origin, and resource export
uses the documented HTTPS registries.

Parity covers Workspace outcomes rather than a second Commander interface.
DSH profile and credential storage, Cordis lifecycle, catalog inspection,
canonical tool values, and operator deployment replace CLI-only configuration,
Session, daemon, presentation, version/help, resource-cache, password-input,
viewer-origin, and browser-installation mechanics. This Change adds no CLI
command or artifact, package publication, Workspace Server, Browser, OpenAPI,
database, deployment, SDK-baseline, or release-workflow contract.
<!-- parity-manifest-projection:end -->`;
}

function assertParityReadmeProjection(readme, parity, inspected) {
  assert.equal(
    inspected.entryCount,
    FROZEN_PACKAGE_EVIDENCE.entries,
    "current package entry count differs from the frozen README evidence",
  );
  const projection = /<!-- parity-manifest-projection:start -->[\s\S]*?<!-- parity-manifest-projection:end -->/u
    .exec(readme)?.[0];
  assert.equal(
    projection,
    renderParityReadmeProjection(parity),
    "README parity projection drifted from PARITY_MANIFEST or package evidence",
  );
}

function assertParityReadmeProjectionNegativeCases(expected, parity) {
  for (const [name, before, after] of [
    ["baseline", parity.baseline.workspaceCommit, "0000000000000000000000000000000000000000"],
    ["owner", parity.outcomes[0].owner, parity.outcomes[1].owner],
    ["catalog", "13 outcome groups, 42 tools, and 8 Skills", "13 outcome groups, 41 tools, and 8 Skills"],
    ["budget", "16,777,216 packed bytes", "16,777,215 packed bytes"],
    ["measurement", "12,945,659 packed bytes", "12,945,658 packed bytes"],
    ["execution world", "local DSH Host execution world", "remote execution world"],
    ["non-goals", "second Commander interface", "Commander-compatible interface"],
  ]) {
    const drifted = expected.replace(before, after);
    assert.notEqual(drifted, expected, `README ${name} negative did not mutate its fixture`);
    assert.throws(
      () => assertParityReadmeProjection(
        drifted,
        parity,
        { entryCount: FROZEN_PACKAGE_EVIDENCE.entries },
      ),
      /README parity projection drifted/u,
      `README ${name} drift was accepted`,
    );
  }
}

function formatInteger(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
}

function assertPackageInspectionNegativeCases() {
  const files = Array.from({ length: PACKAGE_LIMITS.entries }, (_, index) => ({
    path: `dist/chunks/exact-${String(index).padStart(3, "0")}.js`,
    size: index === 0 ? PACKAGE_LIMITS.unpackedBytes : 0,
  }));
  const expected = files.map(({ path }) => path);
  const exact = {
    entryCount: files.length,
    files,
    size: PACKAGE_LIMITS.packedBytes,
    unpackedSize: PACKAGE_LIMITS.unpackedBytes,
  };
  assert.doesNotThrow(() => assertPackageInspection(exact, expected));
  assert.throws(
    () => assertPackageInspection({ ...exact, size: PACKAGE_LIMITS.packedBytes + 1 }, expected),
    /packed byte limit exceeded.*packed=16777217/u,
  );
  const unpackedFiles = files.map((file, index) => index === 0 ? { ...file, size: file.size + 1 } : file);
  assert.throws(
    () => assertPackageInspection({
      ...exact,
      files: unpackedFiles,
      unpackedSize: PACKAGE_LIMITS.unpackedBytes + 1,
    }, expected),
    /unpacked byte limit exceeded.*unpacked=67108865/u,
  );
  const extra = [...files, { path: "dist/chunks/extra.js", size: 0 }];
  assert.throws(
    () => assertPackageInspection({ ...exact, entryCount: extra.length, files: extra }, [...expected, "dist/chunks/extra.js"]),
    /entry limit exceeded.*entries=257/u,
  );
  assert.throws(
    () => assertPackageInspection({
      ...exact,
      entryCount: files.length - 1,
      files: files.slice(1),
      unpackedSize: 0,
    }, expected),
    /packed file closure changed/u,
  );
  assert.throws(
    () => assertPackageInspection({
      ...exact,
      files: [...files.slice(0, -1), { path: "src/unknown.ts", size: 0 }],
    }, expected),
    /packed file closure changed/u,
  );
}

function stripGeneratedRegionProvenance(content) {
  return content.replace(
    /^\/\/#region \.\.\/\.\.\/((?:node_modules\/\.pnpm|packages\/client-core\/dist)\/[^\r\n]*)(?:\r?\n|$)/gmu,
    (line, path) => path.split("/").every((segment) =>
      segment !== "" && segment !== "." && segment !== ".." && /^[-+@._=A-Za-z0-9]+$/u.test(segment))
      ? ""
      : line,
  );
}

function stripDocumentFileAuthority(content) {
  return content.replace(/file:\/\/[-.A-Za-z0-9]+(?=\\?["']|[\s),;]|$)/gu, "document-file-authority");
}

function stripBundledParentTokens(content) {
  return content
    .replace(/(["'])(?:\/?\.\.)+\/?\1/gu, '"bundled-parent-token"')
    .replace(/(["'])file:\/\/\/?\1/gu, '"bundled-file-url-token"');
}

function stripDynamicFileUrlTokens(content) {
  return content.replace(
    /`file:\/\/\$\{[$A-Za-z_][$\w]*\([$A-Za-z_][$\w]*\)\s*===\s*1\s*\?\s*""\s*:\s*"\/"\}\$\{[$A-Za-z_][$\w]*\}`/gu,
    '"typescript-dynamic-file-url"',
  );
}

function stripFacadeVirtualArtifacts(content) {
  return content.replaceAll("/diagnostics/facade-capability-gaps.json", "facade-capability-gaps");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function assertRuntimeSourcePolicy(path, content) {
  const pathScannableContent = stripBundledParentTokens(
    stripFacadeVirtualArtifacts(
      stripDynamicFileUrlTokens(stripDocumentFileAuthority(stripGeneratedRegionProvenance(content))),
    ),
  );
  assert.doesNotMatch(pathScannableContent, localPathPattern, `local checkout path found in ${path}`);
  assert.doesNotMatch(pathScannableContent, checkoutRootPattern, `current checkout path found in ${path}`);
  assert.doesNotMatch(pathScannableContent, absoluteSourcePathPattern, `absolute source path found in ${path}`);
  assert.doesNotMatch(content, /(?:apps[/\\](?:cli|workspace)|(?:runtime[/\\]daemon|daemon[/\\]runtime)|univer-workspace-cli(?:["'/]|$)|Session(?: file|[/\\]file))/iu,
    `CLI, daemon, or Session source entered ${path}`);
  assert.doesNotMatch(content,
    /(?:\b(?:spawn|execFile|exec)\s*\([^\n]{0,160}["'`]typst(?:\.exe)?["'`]|\/usr\/bin\/typst|\\typst\.exe)/iu,
    `system Typst command entered ${path}`);
}

function assertDistRuntimeClosure() {
  const runtimeFiles = new Map(distFiles.map((path) => [path, readFileSync(join(appRoot, path), "utf8")]));
  assertRuntimeGraph(runtimeFiles, [
    "dist/index.js",
    "dist/worker.js",
    "dist/chunks/render-result-budget.js",
    "dist/chunks/worker-child.mjs",
  ]);
}

function assertRuntimeGraph(runtimeFiles, entries) {
  const allowedBare = new Set([
    ...Object.keys(manifest.peerDependencies),
    ...Object.keys(manifest.dependencies),
    ...Object.keys(manifest.optionalDependencies),
    ...builtinModules,
    ...builtinModules.map((name) => `node:${name}`),
  ]);
  const JavaScriptFiles = new Set([...runtimeFiles.keys()].filter((path) =>
    !path.startsWith("dist/render-runtime/") && /\.(?:js|mjs)$/u.test(path)));
  const allowedWorkerTargets = new Set(["dist/worker.js"]);
  const reachable = new Set(entries);
  const pending = [...entries];
  for (const entry of entries) assert.ok(runtimeFiles.has(entry), `runtime entry is missing: ${entry}`);
  while (pending.length > 0) {
    const path = pending.pop();
    const content = runtimeFiles.get(path);
    assertRuntimeSourcePolicy(path, content);
    for (const reference of runtimeReferences(path, content)) {
      const { kind, specifier } = reference;
      assert.doesNotMatch(specifier, /^(?:data:|file:|https?:|\/\/)/iu,
        `${path} has remote runtime reference ${specifier}`);
      if (kind === "worker") {
        const workerPath = specifier.startsWith(".") ? relativeRuntimePath(path, specifier) : undefined;
        assert.ok(workerPath !== undefined && allowedWorkerTargets.has(workerPath),
          `${path} has a non-Content worker entry ${specifier}`);
      }
      if (specifier.startsWith(".") || specifier.startsWith("/")) {
        assert.equal(specifier.startsWith("/"), false, `${path} has absolute runtime reference ${specifier}`);
        const target = kind === "esm"
          ? resolveEsmRuntimeReference(runtimeFiles, path, specifier)
          : kind === "require"
            ? resolveCjsRuntimeReference(runtimeFiles, path, specifier)
            : kind === "url"
              ? resolveUrlRuntimeReference(runtimeFiles, path, specifier)
              : kind === "worker"
                ? resolveExactRuntimeFile(runtimeFiles, path, specifier)
                : undefined;
        assert.ok(target, `missing runtime reference ${specifier} from ${path}`);
        if (
          JavaScriptFiles.has(target)
          && kind !== "url"
          && !reachable.has(target)
        ) {
          reachable.add(target);
          pending.push(target);
        }
        continue;
      }
      if (allowedBare.has(specifier)) continue;
      if (/^[a-z][a-z0-9+.-]*:/iu.test(specifier)) {
        assert.fail(`${path} has unsupported runtime reference ${specifier}`);
      }
      const packageName = specifier.startsWith("@")
        ? specifier.split("/").slice(0, 2).join("/")
        : specifier.split("/")[0];
      assert.notEqual(packageName, "@univerjs/univer-workspace-client-core",
        `${path} has bare Client Core reference ${specifier}`);
      assert.ok(allowedBare.has(specifier) || allowedBare.has(packageName),
        `${path} has undeclared bare reference ${specifier}`);
    }
  }
  assert.deepEqual([...reachable].sort(), [...JavaScriptFiles].sort(),
    "dist contains an unreachable JavaScript chunk");
}

function relativeRuntimePath(sourcePath, specifier) {
  const base = posix.normalize(posix.join(posix.dirname(sourcePath), specifier.split(/[?#]/u, 1)[0]));
  return base.startsWith("../") || base === ".." ? undefined : base;
}

function resolveExactRuntimeFile(runtimeFiles, sourcePath, specifier) {
  const base = relativeRuntimePath(sourcePath, specifier);
  return base !== undefined && runtimeFiles.has(base) ? base : undefined;
}

function resolveEsmRuntimeReference(runtimeFiles, sourcePath, specifier) {
  const base = relativeRuntimePath(sourcePath, specifier);
  if (base === undefined || posix.extname(base) === "") return undefined;
  return runtimeFiles.has(base) ? base : undefined;
}

function resolveCjsRuntimeReference(runtimeFiles, sourcePath, specifier) {
  const base = relativeRuntimePath(sourcePath, specifier);
  if (base === undefined) return undefined;
  const resolveFile = (candidate) => {
    for (const path of [candidate, `${candidate}.js`, `${candidate}.json`, `${candidate}.node`]) {
      if (runtimeFiles.has(path)) return path;
    }
    return undefined;
  };
  const resolveDirectory = (directory, seen = new Set()) => {
    if (seen.has(directory)) return undefined;
    seen.add(directory);
    const manifestPath = `${directory}/package.json`;
    if (runtimeFiles.has(manifestPath)) {
      let packageManifest;
      try {
        packageManifest = JSON.parse(runtimeFiles.get(manifestPath));
      } catch {
        return undefined;
      }
      if (typeof packageManifest.main === "string") {
        const main = relativeRuntimePath(manifestPath, packageManifest.main);
        if (main !== undefined && main.startsWith(`${directory}/`)) {
          const target = resolveFile(main) ?? resolveDirectory(main, seen);
          if (target !== undefined) return target;
        }
      }
    }
    return resolveFile(`${directory}/index`);
  };
  return resolveFile(base) ?? resolveDirectory(base);
}

function resolveUrlRuntimeReference(runtimeFiles, sourcePath, specifier) {
  const base = relativeRuntimePath(sourcePath, specifier);
  if (base === undefined) return undefined;
  if (runtimeFiles.has(base)) return base;
  return [...runtimeFiles.keys()].some((path) => path.startsWith(`${base}/`)) ? base : undefined;
}

function assertRenderAssetClosure() {
  const renderFiles = new Map(distFiles
    .filter((path) => path.startsWith("dist/render-runtime/"))
    .map((path) => [path, readFileSync(join(appRoot, path), "utf8")]));
  assertRenderAssetGraph(renderFiles);
}

function assertRenderAssetGraph(renderFiles) {
  const entry = "dist/render-runtime/index.html";
  assert.ok(renderFiles.has(entry), "render page index is missing");
  const reachable = new Set([entry]);
  const pending = [entry];
  while (pending.length > 0) {
    const path = pending.pop();
    assert.doesNotMatch(path, /(?:\.map$|(?:^|\/)(?:chrome|chromium|browser-cache|cache)(?:\/|$))/iu);
    const content = renderFiles.get(path);
    for (const reference of renderReferences(path, content)) {
      if (reference === "" || reference.startsWith("#") || reference.startsWith("data:")) continue;
      assert.doesNotMatch(reference, /^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/\/)/u, `remote render asset in ${path}`);
      assert.equal(reference.startsWith("/") || reference.startsWith("\\"), false,
        `absolute render asset in ${path}`);
      assert.match(reference, /^\.\.?\//u, `bare render asset in ${path}`);
      const target = posix.normalize(posix.join(posix.dirname(path), reference.split(/[?#]/u, 1)[0]));
      assert.ok(renderFiles.has(target), `missing render asset ${reference} from ${path}`);
      if (!reachable.has(target)) {
        reachable.add(target);
        pending.push(target);
      }
    }
  }
  assert.deepEqual(
    [...reachable].sort(),
    [...renderFiles.keys()].sort(),
    "dist contains an unreachable render asset",
  );
}

function renderReferences(path, content) {
  const references = [];
  const collect = (pattern) => {
    for (const match of content.matchAll(pattern)) {
      references.push(match.groups.specifier ?? match.groups.bareSpecifier);
    }
  };
  if (path.endsWith(".html")) {
    collect(/\b(?:src|href)\s*=\s*(?<quote>["'])(?<specifier>.*?)\k<quote>/gu);
  }
  if (path.endsWith(".js")) {
    collect(/(?:^|;)(?:import\s*(?:[^;]*?\bfrom\s*)?|export\s+[^;]*?\bfrom\s*)(?<quote>["'`])(?<specifier>[^"'`$]*?)\k<quote>/gmu);
    collect(/\bimport\(\s*(?<quote>["'`])(?<specifier>[^"'`$]*?)\k<quote>\s*\)/gu);
    collect(/\bnew URL\(\s*(?<quote>["'`])(?<specifier>[^"'`$]*?)\k<quote>\s*,\s*import\.meta\.url\s*\)/gu);
    if (content.includes("fetch")) {
      const source = ts.createSourceFile(path, content, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
      const visit = (node) => {
        const argument = ts.isCallExpression(node) ? node.arguments[0] : undefined;
        if (
          ts.isCallExpression(node)
          && ts.isIdentifier(node.expression)
          && node.expression.text === "fetch"
          && argument !== undefined
          && ts.isStringLiteralLike(argument)
        ) references.push(argument.text);
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    if (content.includes("sourceMappingURL")) {
      const scanner = ts.createScanner(ts.ScriptTarget.ESNext, false, ts.LanguageVariant.Standard, content);
      for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
        if (token !== ts.SyntaxKind.SingleLineCommentTrivia) continue;
        const match = scanner.getTokenText().match(/^\/\/[#@]\s*sourceMappingURL\s*=\s*(\S+)\s*$/u);
        if (match !== null) references.push(match[1]);
      }
    }
  }
  if (path.endsWith(".css")) {
    collect(/@import\s+(?:url\(\s*)?(?<quote>["'])(?<specifier>.*?)\k<quote>\s*\)?/gu);
    collect(/\burl\(\s*(?:(?<quote>["'])(?<specifier>.*?)\k<quote>|(?<bareSpecifier>[^)'"\s]+))\s*\)/gu);
  }
  return references;
}

function assertRenderAssetGraphNegativeCases() {
  const entry = "dist/render-runtime/index.html";
  const main = "dist/render-runtime/assets/main.js";
  assert.throws(
    () => assertRenderAssetGraph(new Map([
      [entry, '<script type="module" src="./assets/main.js"></script>'],
      [main, "import(`./locale.js`);"],
    ])),
    /missing render asset \.\/locale\.js/u,
  );
  assert.throws(
    () => assertRenderAssetGraph(new Map([
      [entry, '<script type="module" src="./assets/main.js"></script>'],
      [main, ""],
      ["dist/render-runtime/assets/future.js", ""],
    ])),
    /unreachable render asset/u,
  );
  assert.throws(
    () => assertRenderAssetGraph(new Map([
      [entry, '<script type="module" src="./assets/main.js"></script>'],
      [main, 'import "https://cdn.example/future.js";'],
    ])),
    /remote render asset/u,
  );
  assert.throws(
    () => assertRenderAssetGraph(new Map([
      [entry, '<script type="module" src="./assets/main.js"></script>'],
      [main, 'fetch("https://cdn.example/runtime.json");'],
    ])),
    /remote render asset/u,
  );
  assert.doesNotThrow(() => assertRenderAssetGraph(new Map([
    [entry, '<script type="module" src="./assets/main.js"></script>'],
    [main, 'const documentation = "https://docs.example/render";'],
  ])));
  assert.throws(
    () => assertRenderAssetGraph(new Map([
      [entry, '<script type="module" src="./assets/main.js"></script>'],
      [main, "//# sourceMappingURL=./main.js.map"],
    ])),
    /missing render asset/u,
  );
  assert.throws(
    () => assertRenderAssetGraph(new Map([
      [entry, '<script type="module" src="./assets/main.js"></script>'],
      [main, "//# sourceMappingURL=https://cdn.example/main.js.map"],
    ])),
    /remote render asset/u,
  );
  const stylesheet = "dist/render-runtime/assets/main.css";
  assert.throws(
    () => assertRenderAssetGraph(new Map([
      [entry, '<link rel="stylesheet" href="./assets/main.css">'],
      [stylesheet, '@import "./missing.css";'],
    ])),
    /missing render asset \.\/missing\.css/u,
  );
  assert.throws(
    () => assertRenderAssetGraph(new Map([
      [entry, '<link rel="stylesheet" href="./assets/main.css">'],
      [stylesheet, '@import "https://cdn.example/future.css";'],
    ])),
    /remote render asset/u,
  );
  assert.throws(
    () => assertRenderAssetGraph(new Map([
      [entry, '<link rel="stylesheet" href="./assets/main.css">'],
      [stylesheet, 'body { background: url("https://cdn.example/image.png"); }'],
    ])),
    /remote render asset/u,
  );
}

function assertWorkerChildClosure() {
  const users = distFiles.filter((path) =>
    path.endsWith(".js") && readFileSync(join(appRoot, path), "utf8").includes("worker-child.mjs"));
  assert.ok(users.length > 0, "package does not contain the collaboration runtime worker client");
  for (const user of users) {
    assert.ok(
      existsSync(join(dirname(join(appRoot, user)), "worker-child.mjs")),
      `worker-child.mjs is not colocated with ${user}`,
    );
  }
}

function assertBundledCommonjsNodeGlobals() {
  for (const path of distFiles.filter((path) => path.endsWith(".js"))) {
    const code = readFileSync(join(appRoot, path), "utf8");
    assert.equal(
      code.includes("environment that doesn't expose the `require` function") && !code.includes("createRequire"),
      false,
      `${path} lacks a Node require binding`,
    );
    assert.equal(
      code.includes("__filename") && !/\b(?:const|let|var)\s+__filename\b/u.test(code),
      false,
      `${path} lacks a Node __filename binding`,
    );
    assert.equal(
      code.includes("__dirname") && !/\b(?:const|let|var)\s+__dirname\b/u.test(code),
      false,
      `${path} lacks a Node __dirname binding`,
    );
  }
}

function runtimeReferences(path, code) {
  const source = ts.createSourceFile(path, code, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const references = [];
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier !== undefined
      && ts.isStringLiteralLike(node.moduleSpecifier)
    ) references.push({ kind: "esm", specifier: node.moduleSpecifier.text });
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (argument !== undefined && ts.isStringLiteralLike(argument)) {
        references.push({ kind: "esm", specifier: argument.text });
      } else {
        assert.equal(isGeneratedWorkerChildImport(path, argument), true,
          `${path} has a non-literal dynamic import`);
      }
    }
    if (ts.isCallExpression(node)) {
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      const isResolve = ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === "require"
        && node.expression.name.text === "resolve";
      if ((isRequire || isResolve) && isRuntimeRequire(node)) {
        const argument = node.arguments[0];
        assert.ok(argument !== undefined && ts.isStringLiteralLike(argument),
          `${path} has a non-literal ${isResolve ? "require.resolve" : "require"} reference`);
        references.push({ kind: "require", specifier: argument.text });
      }
    }
    if (
      ts.isNewExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === "URL"
      && node.arguments !== undefined
      && node.arguments.length >= 2
      && containsImportMetaUrl(node.arguments[1])
    ) {
      const argument = node.arguments[0];
      if (ts.isStringLiteralLike(argument)) references.push({ kind: "url", specifier: argument.text });
      else {
        const specifier = ts.isIdentifier(argument) ? topLevelStringBinding(source, argument.text) : undefined;
        assert.equal(path === "dist/index.js" && specifier === "./worker.js", true,
          `${path} has a non-literal URL reference`);
        references.push({ kind: "worker", specifier });
      }
    }
    if (
      ts.isNewExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === "Worker"
      && node.arguments !== undefined
      && node.arguments.length >= 1
    ) {
      const argument = node.arguments[0];
      if (ts.isStringLiteralLike(argument)) references.push({ kind: "worker", specifier: argument.text });
      else if (
        ts.isNewExpression(argument)
        && ts.isIdentifier(argument.expression)
        && argument.expression.text === "URL"
        && argument.arguments !== undefined
        && argument.arguments.length >= 2
        && ts.isStringLiteralLike(argument.arguments[0])
        && containsImportMetaUrl(argument.arguments[1])
      ) references.push({ kind: "worker", specifier: argument.arguments[0].text });
      else assert.equal(isGeneratedRuntimePoolWorker(path, argument), true,
        `${path} has a non-literal Worker entry`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return references;
}

function containsImportMetaUrl(node) {
  if (isImportMetaUrl(node)) return true;
  let found = false;
  ts.forEachChild(node, (child) => {
    if (!found && containsImportMetaUrl(child)) found = true;
  });
  return found;
}

function topLevelStringBinding(source, name) {
  const values = [];
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name)
        && declaration.name.text === name
        && declaration.initializer !== undefined
        && ts.isStringLiteralLike(declaration.initializer)
      ) values.push(declaration.initializer.text);
    }
  }
  if (values.length !== 1) return undefined;
  let reassigned = false;
  const visit = (node) => {
    if (
      ts.isBinaryExpression(node)
      && ts.isIdentifier(node.left)
      && node.left.text === name
      && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
      && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) reassigned = true;
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
      && ts.isIdentifier(node.operand)
      && node.operand.text === name
    ) reassigned = true;
    if (!reassigned) ts.forEachChild(node, visit);
  };
  visit(source);
  return reassigned ? undefined : values[0];
}

function isGeneratedWorkerChildImport(path, argument) {
  return path === "dist/chunks/worker-child.mjs"
    && argument !== undefined
    && ts.isPropertyAccessExpression(argument)
    && ts.isIdentifier(argument.expression)
    && argument.name.text === "entry";
}

function isGeneratedRuntimePoolWorker(path, argument) {
  return /^dist\/chunks\/runtime-pool-[-_A-Za-z0-9]+\.js$/u.test(path)
    && argument !== undefined
    && ts.isIdentifier(argument);
}

function isImportMetaUrl(node) {
  return ts.isPropertyAccessExpression(node)
    && node.name.text === "url"
    && ts.isMetaProperty(node.expression)
    && node.expression.keywordToken === ts.SyntaxKind.ImportKeyword
    && node.expression.name.text === "meta";
}

function isRuntimeRequire(call) {
  for (let scope = call.parent; scope !== undefined && !ts.isSourceFile(scope); scope = scope.parent) {
    if (ts.isFunctionLike(scope) && scope.parameters.some((parameter) => bindingContains(parameter.name, "require"))) {
      return false;
    }
    if (ts.isBlock(scope) && scope.statements.some((statement) => statementDeclares(statement, "require"))) {
      return false;
    }
  }
  const source = call.getSourceFile();
  const declarations = source.statements.filter((statement) => statementDeclares(statement, "require"));
  return declarations.length === 0 || declarations.every(isInjectedRuntimeRequire);
}

function bindingContains(name, expected) {
  if (ts.isIdentifier(name)) return name.text === expected;
  return name.elements.some((element) => !ts.isOmittedExpression(element)
    && bindingContains(element.name, expected));
}

function statementDeclares(statement, expected) {
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.some((declaration) =>
      bindingContains(declaration.name, expected));
  }
  return (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement))
    && statement.name?.text === expected;
}

function isInjectedRuntimeRequire(statement) {
  if (!ts.isVariableStatement(statement) || statement.declarationList.declarations.length !== 1) return false;
  const declaration = statement.declarationList.declarations[0];
  const initializer = declaration.initializer;
  return ts.isIdentifier(declaration.name)
    && declaration.name.text === "require"
    && initializer !== undefined
    && ts.isCallExpression(initializer)
    && ts.isIdentifier(initializer.expression)
    && initializer.expression.text === "__univerCreateRequire"
    && initializer.arguments.length === 1
    && isImportMetaUrl(initializer.arguments[0]);
}

function assertRuntimeGraphNegativeCases() {
  const entries = [
    "dist/index.js",
    "dist/worker.js",
    "dist/chunks/render-result-budget.js",
    "dist/chunks/worker-child.mjs",
  ];
  const base = () => new Map(entries.map((path) => [path, ""]));
  const rejected = (code, message) => {
    const files = base();
    files.set("dist/index.js", code);
    assert.throws(() => assertRuntimeGraph(files, entries), message);
  };
  rejected('import "@univerjs/univer-workspace-client-core";', /bare Client Core/u);
  rejected('export * from "undeclared-runtime";', /undeclared bare reference/u);
  rejected('import "./missing.js";', /missing runtime reference/u);
  rejected('import("./missing.js", { with: { type: "json" } });', /missing runtime reference/u);
  rejected('require("./missing.cjs");', /missing runtime reference/u);
  rejected('require.resolve("./missing.node");', /missing runtime reference/u);
  rejected('require.resolve("./missing.js", { paths: [] });', /missing runtime reference/u);
  rejected('new URL("./missing.wasm", import.meta.url);', /missing runtime reference/u);
  const extensionlessEsm = base();
  extensionlessEsm.set("dist/index.js", 'import "./extensionless";');
  extensionlessEsm.set("dist/extensionless.js", "");
  assert.throws(() => assertRuntimeGraph(extensionlessEsm, entries), /missing runtime reference/u);
  rejected(`const source = ${JSON.stringify(`${checkoutRoot}/packages/source/index.ts`)};`, /current checkout path/u);
  rejected(`// ${checkoutRoot}/packages/source/index.ts`.replaceAll("/", "\\"), /current checkout path/u);
  rejected('//# sourceMappingURL=/private/checkout/src/index.js.map', /absolute source path/u);
  rejected('spawn("typst");', /system Typst command/u);
  rejected('const source = "apps/cli/src/session.ts";', /CLI, daemon, or Session/u);
  rejected('const source = "daemon/runtime/worker.js";', /CLI, daemon, or Session/u);
  rejected('const source = "Session/file/credentials.json";', /CLI, daemon, or Session/u);
  rejected('import("https://cdn.example/runtime.js");', /remote runtime reference/u);
  rejected('new Worker(new URL("./typst-worker.js", import.meta.url));', /non-Content worker entry/u);
  rejected('new Worker("typescript", { type: "module" });', /non-Content worker entry/u);
  const alternateWorker = base();
  alternateWorker.set("dist/index.js", 'new Worker(new URL("./alternate.js", import.meta.url), { type: "module" });');
  alternateWorker.set("dist/alternate.js", "");
  assert.throws(() => assertRuntimeGraph(alternateWorker, entries), /non-Content worker entry/u);
  rejected("import(runtimeEntry);", /non-literal dynamic import/u);
  rejected("require(runtimeEntry);", /non-literal require reference/u);
  rejected("new Worker(runtimeEntry, { type: \"module\" });", /non-literal Worker entry/u);
  const esmExact = base();
  esmExact.set("dist/index.js", "import(`./exact.js`, { with: {} });");
  esmExact.set("dist/exact.js", "");
  assert.doesNotThrow(() => assertRuntimeGraph(esmExact, entries));
  for (const [specifier, files] of [
    ["./legacy", [["dist/legacy.js", ""]]],
    ["./legacy-directory", [["dist/legacy-directory/index.js", ""]]],
    ["./legacy-package", [
      ["dist/legacy-package/package.json", JSON.stringify({ main: "main" })],
      ["dist/legacy-package/main.js", ""],
    ]],
    ["./legacy-package-directory", [
      ["dist/legacy-package-directory/package.json", JSON.stringify({ main: "lib" })],
      ["dist/legacy-package-directory/lib/index.js", ""],
    ]],
  ]) {
    const cjs = base();
    cjs.set("dist/index.js", `require(${JSON.stringify(specifier)});`);
    for (const [path, content] of files) cjs.set(path, content);
    assert.doesNotThrow(() => assertRuntimeGraph(cjs, entries));
  }
  const directoryUrl = base();
  directoryUrl.set("dist/index.js", 'new URL("./assets", import.meta.url);');
  directoryUrl.set("dist/assets/runtime.wasm", "");
  assert.doesNotThrow(() => assertRuntimeGraph(directoryUrl, entries));
  const TypeScriptDynamicFileUrl = 'const value = `file://${kind(root) === 1 ? "" : "/"}${root}`;';
  assert.doesNotThrow(() => assertRuntimeGraph(new Map([
    ...base(),
    ["dist/index.js", TypeScriptDynamicFileUrl],
  ]), entries));
  rejected('const value = `file://${kind(root) !== 1 ? "" : "/"}${root}`;', /local checkout path/u);
  assert.deepEqual(runtimeReferences("shadowed.js", '(function(require) { require("private-shadow"); })'), []);
  assert.deepEqual(runtimeReferences("shadowed.js", '{ const require = () => {}; require("private-shadow"); }'), []);
  assert.deepEqual(runtimeReferences(
    "dist/chunks/worker-child.mjs",
    "async function open(message) { await import(message.entry); }",
  ), []);
  assert.deepEqual(runtimeReferences(
    "dist/chunks/runtime-pool-fixture.js",
    "function open(entry) { return new Worker(entry); }",
  ), []);
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

function readPackageManifest(packageRequire, name) {
  let directory = dirname(packageRequire.resolve(name));
  for (;;) {
    const path = join(directory, "package.json");
    if (existsSync(path) && statSync(path).isFile()) {
      const value = JSON.parse(readFileSync(path, "utf8"));
      if (value.name === name) return { manifest: value, path };
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Unable to locate package manifest for ${name}`);
    directory = parent;
  }
}

function readPhysicalPackageManifest(packageRequire, name) {
  const resolved = readPackageManifest(packageRequire, name);
  const path = realpathSync(resolved.path);
  return { manifest: JSON.parse(readFileSync(path, "utf8")), path };
}
