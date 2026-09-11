import { spawnSync } from "node:child_process";
import { cp, readFile, readdir, readlink, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, delimiter } from "node:path";

/** Seal a fully installed native runtime; also used after retrying a browser download. */
export async function finalizeRuntime({ desktop, runtime, version }) {
  const platform = process.platform,
    arch = process.arch;
  const root = dirname(runtime);
  const browserCache = join(desktop, ".browser-cache");
  process.env.PLAYWRIGHT_BROWSERS_PATH = browserCache;
  const node = join(runtime, "node/bin", platform === "win32" ? "node.exe" : "node");
  const bootstrap = join(runtime, "bootstrap");
  const dsh = join(bootstrap, "node_modules/@deepseek-ai/dsh/lib/bin.js");
  const profile = join(runtime, "home/profiles/univer-workspace-harness");
  const env = {
    ...process.env,
    DSH_HOME: join(runtime, "home"),
    PATH: `${dirname(node)}${delimiter}${join(bootstrap, "node_modules/.bin")}${delimiter}${process.env.PATH ?? ""}`,
  };
  function run(command, args, options) {
    const result = spawnSync(command, args, options);
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error("Installed DSH profile verification failed");
  }
  const { chromium } = await import("playwright");
  const browser = `browsers/${relative(browserCache, chromium.executablePath()).split("\\").join("/")}`;
  await rm(join(runtime, "browsers"), { recursive: true, force: true });
  await cp(browserCache, join(runtime, "browsers"), {
    recursive: true,
    verbatimSymlinks: true,
    filter: (path) => !path.includes("chromium_headless_shell-") && !path.endsWith(".links"),
  });
  const { renderIcon } = await import("./icon.mjs");
  await renderIcon({
    executablePath: chromium.executablePath(),
    source: join(desktop, "assets/icon.svg"),
    output: join(root, "icon.png"),
  });
  await readFile(join(runtime, "render-runtime/index.html"));
  run(node, [dsh, "--profile", "univer-workspace-harness", "--dump-config"], {
    env,
    cwd: profile,
    stdio: "ignore",
  });
  await writeFile(
    join(runtime, "release.json"),
    JSON.stringify(
      {
        version,
        platform,
        arch,
        browser,
        updatesEnabled: process.env.AGENT_DESKTOP_OFFICIAL === "true",
      },
      null,
      2,
    ),
  );
  // No build registry configuration or cache is shipped. Hoisted profile layout
  // avoids pnpm junctions pointing back at the build machine.
  async function sanitize(path) {
    for (const item of await readdir(path, { withFileTypes: true })) {
      const child = join(path, item.name);
      if (
        item.name.endsWith(".map") ||
        item.name === ".npmrc" ||
        item.name === ".cache" ||
        item.name === ".dsh-module-fallback" ||
        child === join(runtime, "home/profiles/node_modules")
      ) {
        await rm(child, { recursive: true, force: true });
      } else if (
        item.isSymbolicLink() &&
        (await readlink(child)).includes(".dsh-module-fallback")
      ) {
        await rm(child, { force: true });
      } else if (item.isDirectory()) await sanitize(child);
    }
  }
  await sanitize(runtime);
  const { trimPtyPrebuilds } = await import("./trim-pty.mjs");
  await trimPtyPrebuilds(join(bootstrap, "node_modules/node-pty"), platform, arch);
  const { runtimeSizeReport, verifySizeReport } = await import("./size-report.mjs");
  const report = await runtimeSizeReport(runtime);
  await writeFile(join(root, "runtime-size.json"), JSON.stringify(report, null, 2));
  verifySizeReport(report);
  const { writeInventory } = await import("./inventory.cjs");
  await writeInventory(runtime);
  console.log(`Prepared ${version} for ${platform}-${arch}`);
}
