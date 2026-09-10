import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import policy from "../src/policy.cjs";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(desktop, "../../..");
// The isolated profile must retain the repository's scoped SDK registries.
const userConfig = process.env.NPM_CONFIG_USERCONFIG ?? join(repo, ".npmrc");
process.env.NPM_CONFIG_USERCONFIG = userConfig;
process.env.npm_config_userconfig = userConfig;
const version = process.env.AGENT_DESKTOP_VERSION ?? "0.1.0";
if (!policy.validVersion(version))
  throw new Error("AGENT_DESKTOP_VERSION must be X.Y.Z or X.Y.Z-{alpha,beta,rc}.N");
const platform = process.platform,
  arch = process.arch;
if (!["win32-x64", "darwin-arm64", "linux-x64"].includes(`${platform}-${arch}`))
  throw new Error("Build on the native target: Windows x64, macOS arm64, or Linux x64");
const root = join(desktop, ".build");
const runtime = join(root, "runtime");
const browserCache = join(desktop, ".browser-cache");
// Reuse completed browser downloads across native rebuilds.
try {
  await rename(join(runtime, "browsers"), browserCache);
} catch (error) {
  if (!["ENOENT", "EEXIST", "ENOTEMPTY"].includes(error.code)) throw error;
}
await rm(root, { recursive: true, force: true });
await mkdir(runtime, { recursive: true });
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: repo, stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}
// Resolve the package-manager JS entry so Windows never needs a shell around
// commands containing user-controlled paths. The CI installs this exact pnpm.
const pnpm = process.env.npm_execpath;
if (!pnpm || !/pnpm/i.test(pnpm))
  throw new Error("Run with pnpm --dir apps/agent/desktop prepare:runtime");
run(process.execPath, [
  pnpm,
  "--filter",
  "@univerjs/workspace-agent...",
  "--filter",
  "dsh-univer-workspace-plugin...",
  "--filter",
  "dsh-univer-workspace-skin-plugin...",
  "build",
]);
const packs = join(runtime, "home", "internal-packages");
await mkdir(packs, { recursive: true });
for (const name of [
  "@univerjs/workspace-agent",
  "dsh-univer-workspace-plugin",
  "dsh-univer-workspace-skin-plugin",
]) {
  run(process.execPath, [pnpm, "--filter", name, "pack", "--pack-destination", packs]);
}

// Verify the official standalone Node download before extracting any bytes.
const nodeVersion = "24.17.0";
const target = platform === "win32" ? "win" : platform;
const stem = `node-v${nodeVersion}-${target}-${arch}`;
const archive = `${stem}.${platform === "win32" ? "zip" : "tar.gz"}`;
const base = `https://nodejs.org/dist/v${nodeVersion}/`;
async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok)
    throw new Error(`Download failed: ${new URL(url).pathname} (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}
const checksums = (await download(`${base}SHASUMS256.txt`)).toString();
const expected = checksums
  .split("\n")
  .map((line) => line.trim().split(/\s+/))
  .find((parts) => parts[1] === archive)?.[0];
const bytes = await download(`${base}${archive}`);
if (!expected || createHash("sha256").update(bytes).digest("hex") !== expected)
  throw new Error("Node archive checksum mismatch");
const archivePath = join(root, archive);
await writeFile(archivePath, bytes);
if (platform === "win32") {
  // Paths are passed through environment variables, never interpolated as code.
  run(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "Expand-Archive -LiteralPath $env:UWA_ARCHIVE -DestinationPath $env:UWA_EXTRACT",
    ],
    { env: { ...process.env, UWA_ARCHIVE: archivePath, UWA_EXTRACT: root } },
  );
  await mkdir(join(runtime, "node", "bin"), { recursive: true });
  await cp(join(root, stem, "node.exe"), join(runtime, "node", "bin", "node.exe"));
} else {
  run("tar", ["-xzf", archivePath, "-C", root]);
  await cp(join(root, stem), join(runtime, "node"), { recursive: true, verbatimSymlinks: true });
}
const node = join(runtime, "node", "bin", platform === "win32" ? "node.exe" : "node");
const bootstrap = join(runtime, "bootstrap");
await mkdir(bootstrap, { recursive: true });
await writeFile(
  join(bootstrap, "package.json"),
  JSON.stringify({
    private: true,
    // These client modules are used by our plugins, not supplied by the stock Web bundle.
    dependencies: {
      "@deepseek-ai/dsh": "0.1.5-rc.1",
      "@deepseek-ai/dsh-client-ui-slots": "0.1.5-rc.1",
      "@deepseek-ai/dsh-client-ui-primitives": "0.1.5-rc.1",
      pnpm: "11.24.0",
    },
  }),
);
// npm is taken from the verified Node distribution; bootstrap stays outside
// the workspace and retains its own React 18 dependency graph.
const npm =
  platform === "win32"
    ? join(root, stem, "node_modules/npm/bin/npm-cli.js")
    : join(runtime, "node/lib/node_modules/npm/bin/npm-cli.js");
run(node, [npm, "install", "--prefix", bootstrap, "--no-audit", "--no-fund"], { cwd: bootstrap });
const { delimiter } = await import("node:path");
const env = {
  ...process.env,
  DSH_HOME: join(runtime, "home"),
  PATH: `${dirname(node)}${delimiter}${join(bootstrap, "node_modules", ".bin")}${delimiter}${process.env.PATH ?? ""}`,
};
const profile = join(runtime, "home", "profiles", "univer-workspace-harness");
await mkdir(profile, { recursive: true });
await writeFile(
  join(profile, "pnpm-workspace.yaml"),
  `nodeLinker: hoisted\nenableGlobalVirtualStore: false\nminimumReleaseAge: 0\nallowBuilds:\n  esbuild: true\n  node-pty: true\n  koffi: true\n  node-addon-require-builtin: false\n  protobufjs: false\n  '@google/genai': false\n`,
);
const dsh = join(bootstrap, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
run(
  node,
  [
    dsh,
    "plugin",
    "--profile",
    "univer-workspace-harness",
    "add",
    "@deepseek-ai/dsh-web-app@0.1.5-rc.1",
  ],
  { env, cwd: profile },
);
for (const name of (await readdir(packs)).filter((name) => name.endsWith(".tgz"))) {
  run(
    node,
    [
      dsh,
      "plugin",
      "--profile",
      "univer-workspace-harness",
      "add",
      "--config.auto-install-peers=false",
      `file:../../internal-packages/${name}`,
    ],
    { env, cwd: profile },
  );
}
await cp(join(repo, "apps/agent/scripts/start-local.mjs"), join(runtime, "start-local.mjs"));
await cp(join(repo, "packages/client-core/dist/render-runtime"), join(runtime, "render-runtime"), {
  recursive: true,
});
// Chromium's pinned Playwright revision is downloaded only at build time.
process.env.PLAYWRIGHT_BROWSERS_PATH = browserCache;
run(
  process.execPath,
  [join(desktop, "node_modules/playwright/cli.js"), "install", "chromium", "--no-shell"],
  {
    env: process.env,
  },
);
const { finalizeRuntime } = await import("./finalize.mjs");
await finalizeRuntime({ desktop, runtime, version });
