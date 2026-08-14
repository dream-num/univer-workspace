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
import { createProgram } from "./program.js";
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
await createProgram({
  browserRuntimeRoot: resolve(appRoot, "dist/render-runtime"),
  config: createWorkspaceConfig(env),
  daemonEntry,
  env,
  resourceCacheRoot: workspaceResourceCacheRoot(env),
  resourceManifestPath: require.resolve("@univerjs-pro/cli-assets/manifest.json"),
  socketPath,
  skillDataRoot: resolve(appRoot, "skill-data"),
  write: (text) => process.stdout.write(text),
  writeError: (text) => process.stderr.write(text),
}).parseAsync(process.argv);
