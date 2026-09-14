import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, delimiter } from "node:path";
import net from "node:net";
import { stopBackend } from "../src/runtime.cjs";
import { prepareRuntimeHome } from "../src/runtime-home.cjs";
import { writeInventory } from "./inventory.cjs";

// These are application profile overlays, not patches to published DSH code.
const production = `- id: hmr\n  disabled: true\n- id: client-hmr\n  disabled: true\n`;
export async function prepareDesktopClient(runtime) {
  const profile = join(runtime, "home/profiles/univer-workspace-harness");
  const manifestPath = join(profile, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.dsh.profile.patchReload = "startup";
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  await writeFile(join(profile, "cordis.patch.yml"), production);
  const scratch = await mkdtemp(join(runtime, "../client-capture-"));
  const output = join(runtime, "desktop-client");
  await rm(output, { recursive: true, force: true });
  await mkdir(join(scratch, "data"));
  // Never let capture credentials, settings or DSH's fallback state enter
  // shipped resources. This preliminary inventory is resealed after capture.
  await writeInventory(runtime);
  const home = await prepareRuntimeHome(runtime, join(scratch, "home"));
  const patch = join(scratch, "capture.patch.yml");
  await writeFile(
    patch,
    `- insert:\n    - id: workspace-desktop-client-capture\n      name: '@univerjs/workspace-agent/desktop-client-capture'\n      config:\n        directory: !!js process.env.UWA_DESKTOP_CLIENT_ROOT\n`,
  );
  const port = await new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolvePort(port));
    });
  });
  const bin = join(runtime, "node/bin");
  const env = {
    ...process.env,
    NODE_ENV: "production",
    UWA_DESKTOP: "1",
    DSH_HOME: home,
    UWH_DSH_DATA_HOME: join(scratch, "data"),
    UWH_BIND_HOST: "127.0.0.1",
    UWH_PUBLIC_HOST: "127.0.0.1",
    UWH_PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
    UWH_MODEL_SETTINGS_ENABLED: "true",
    UWA_DESKTOP_CLIENT_ROOT: output,
    PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
  };
  for (const key of [
    "NODE_OPTIONS",
    "NODE_PATH",
    "ELECTRON_RUN_AS_NODE",
    "UWH_CONNECTION_STATE_PATH",
    "UWH_SHARED_SETTINGS_PATH",
    "UWH_SHARED_CREDENTIALS_PATH",
  ])
    delete env[key];
  const child = spawn(
    join(bin, process.platform === "win32" ? "node.exe" : "node"),
    [
      join(runtime, "bootstrap/node_modules/@deepseek-ai/dsh/lib/bin.js"),
      "--profile",
      "univer-workspace-harness",
      "--patch",
      patch,
      "--port",
      String(port),
      "--no-open",
      "--trusted-host",
      "127.0.0.1",
    ],
    {
      cwd: scratch,
      env,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  let diagnostics = "";
  child.stderr.on("data", (bytes) => {
    diagnostics = (diagnostics + bytes).slice(-16000);
  });
  try {
    await new Promise((done, reject) => {
      const timer = setTimeout(() => reject(new Error("Desktop client capture timed out")), 120000);
      const finish = (error) => {
        clearTimeout(timer);
        error ? reject(error) : done();
      };
      child.once("error", finish);
      child.once("exit", () =>
        finish(
          new Error(
            `Desktop client capture exited: ${diagnostics.replace(/token=[^\s"']+/g, "token=[redacted]")}`,
          ),
        ),
      );
      child.on("message", (message) => {
        if (message?.type === "workspace-desktop-client-captured") finish();
        if (message?.type === "workspace-desktop-client-capture-failed")
          finish(new Error("Desktop client capture failed"));
      });
    });
  } finally {
    await stopBackend(child);
    await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
  // The browser module-system row remains in the captured SDK graph. Only
  // its host-side scanner/composer is replaced by the static carrier.
  await writeFile(
    join(profile, "cordis.patch.yml"),
    production + `- id: modules
  disabled: true
- insert:
    - id: workspace-desktop-client
      name: '@univerjs/workspace-agent/desktop-client'
      config:
        directory: !!js process.env.UWA_DESKTOP_CLIENT_ROOT
`,
  );
}
