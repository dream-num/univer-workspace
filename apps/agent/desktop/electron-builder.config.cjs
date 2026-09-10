const { validVersion, releaseChannel } = require("./src/policy.cjs");
const version = process.env.AGENT_DESKTOP_VERSION || "0.1.0";
if (!validVersion(version))
  throw new Error("Desktop version must be X.Y.Z or X.Y.Z-{alpha,beta,rc}.N");
const official = process.env.AGENT_DESKTOP_OFFICIAL === "true";
module.exports = {
  appId: "org.univer.workspace.agent",
  productName: "Univer Workspace Agent",
  icon: ".build/icon.png",
  extraMetadata: { version },
  directories: { output: "artifacts" },
  asar: true,
  files: ["src/**/*.cjs", "package.json"],
  extraResources: [{ from: ".build/runtime", to: "runtime" }],
  artifactName: "Univer-Workspace-Agent-${version}-${os}-${arch}.${ext}",
  publish: [
    {
      provider: "generic",
      channel: releaseChannel(version),
      url: `https://github.com/dream-num/univer-workspace/releases/download/agent-v${version}/`,
    },
  ],
  beforePack: async () => {
    const release = JSON.parse(
      await require("node:fs/promises").readFile(
        require("node:path").join(__dirname, ".build/runtime/release.json"),
        "utf8",
      ),
    );
    if (
      release.version !== version ||
      release.updatesEnabled !== official ||
      release.platform !== process.platform ||
      release.arch !== process.arch
    )
      throw new Error(
        "Prepare runtime with the same version, publication mode and target before packaging",
      );
  },
  afterPack: async (context) => {
    // Seal the actual copied resources: builder filters placeholders such as
    // .gitkeep, and Windows also signs EXEs during this copy. macOS signing
    // refreshes this again when enabled; unsigned previews still need it here.
    const resources = context.electronPlatformName === "darwin"
      ? ["Univer Workspace Agent.app", "Contents", "Resources"]
      : ["resources"];
    await require("./scripts/inventory.cjs").writeInventory(
      require("node:path").join(context.appOutDir, ...resources, "runtime"),
    );
  },
  // Windows is distributed unsigned until a signing certificate is available.
  afterSign: async (context) => {
    if (context.electronPlatformName !== "darwin" || !official) return;
    const { promisify } = require("node:util");
    const execFile = promisify(require("node:child_process").execFile);
    const app = require("node:path").join(
      context.appOutDir, `${context.packager.appInfo.productFilename}.app`,
    );
    await execFile("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
    await execFile("/usr/bin/xcrun", ["stapler", "validate", app]);
  },
  forceCodeSigning: official && process.platform === "darwin",
  mac: {
    sign: require("./scripts/sign-mac.cjs").sign,
    // Like DSH Desktop, seal Chromium PAK data through its enclosing bundle.
    signIgnore: ["\\.pak$"],
    target: [
      { target: "dmg", arch: ["arm64"] },
      { target: "zip", arch: ["arm64"] },
    ],
    category: "public.app-category.productivity",
    hardenedRuntime: true,
    notarize: official,
  },
  win: { target: [{ target: "nsis", arch: ["x64"] }] },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false,
  },
  linux: {
    syncDesktopName: true,
    target: [{ target: "AppImage", arch: ["x64"] }],
    category: "Office",
  },
};
