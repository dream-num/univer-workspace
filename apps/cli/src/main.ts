#!/usr/bin/env node
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDaemonControl } from "@univer-cli/daemon";
import {
  createWorkspaceConfig,
  workspaceDaemonSocketPath,
  workspaceResourceCacheRoot,
} from "./config.js";
import { PRODUCT_COMMAND_NAMES } from "./product-commands.js";
import { workspaceDaemonIdentity } from "./runtime/daemon-identity.js";
import { stopLegacyWorkspaceDaemonIfPresent } from "./runtime/legacy-daemon.js";

const env = process.env;
const require = createRequire(import.meta.url);
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const daemonEntry = new URL(/* @vite-ignore */ "./runtime/daemon.js", import.meta.url);
const socketPath = workspaceDaemonSocketPath(env);
const daemonOptions = {
  entry: daemonEntry,
  env,
  identity: workspaceDaemonIdentity(env),
  requestTimeoutMs: 1_000,
  socketPath,
};
await stopLegacyWorkspaceDaemonIfPresent({
  currentStatus: await createDaemonControl(daemonOptions).status(),
  socketPath,
});
const write = (text: string) => process.stdout.write(text);
const writeError = (text: string) => process.stderr.write(text);
const first = process.argv[2] ?? "";
if (PRODUCT_COMMAND_NAMES.has(first) || first === "-v" || first === "--version") {
  // Sign-in, repository, Issue and pull request commands never need the Univer runtime.
  const { createProductProgram } = await import("./product-commands.js");
  await createProductProgram({ config: createWorkspaceConfig(env), env, write, writeError }).parseAsync(
    process.argv,
  );
} else {
  const { createProgram } = await import("./program.js");
  await createProgram({
    renderPageRoot: resolve(appRoot, "dist/render-runtime"),
    config: createWorkspaceConfig(env),
    daemonEntry,
    env,
    resourceCacheRoot: workspaceResourceCacheRoot(env),
    resourceManifestPath: require.resolve("@univerjs-pro/cli-assets/manifest.json"),
    socketPath,
    skillDataRoot: resolve(appRoot, "skill-data"),
    write,
    writeError,
  }).parseAsync(process.argv);
}
