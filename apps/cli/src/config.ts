import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { configCodecs, createFileConfig, defineConfig, type Config } from "@univer-cli/config";
import { UNIVER_LICENSE } from "./license.js";

export const DEFAULT_ORIGIN = "https://workspace.univer.plus/";
export const UNIVER_LICENSE_ENV = "UNIVER_LICENSE";
export const UNIVER_HOME_ENV = "UNIVER_HOME";
export const WORKSPACE_ORIGIN_CONFIG_KEY = "workspace.origin";

const WORKSPACE_CLI_DISTRIBUTION_ID = "univer-workspace-cli";
const MAX_PREFERRED_SOCKET_PATH_LENGTH = 70;
const WINDOWS_NAMED_PIPE_PREFIX = "\\\\.\\pipe\\";

const DEFINITIONS = defineConfig({
  [WORKSPACE_ORIGIN_CONFIG_KEY]: {
    codec: configCodecs.httpOrigin(),
    defaultValue: DEFAULT_ORIGIN,
    description: "Workspace HTTP origin used by remote commands.",
  },
});

export function createWorkspaceConfig(env: NodeJS.ProcessEnv): Config {
  return createFileConfig({
    definitions: DEFINITIONS,
    path: join(workspaceCliHome(env), "config.json"),
  });
}

export function resolveUniverLicense(env: NodeJS.ProcessEnv): string {
  const configured = env[UNIVER_LICENSE_ENV];
  return configured === undefined || configured.trim().length === 0
    ? UNIVER_LICENSE
    : configured;
}

export function workspaceCliHome(env: NodeJS.ProcessEnv): string {
  const configured = env[UNIVER_HOME_ENV]?.trim();
  if (configured) {
    return join(resolve(configured), "distributions", WORKSPACE_CLI_DISTRIBUTION_ID);
  }
  const userHome = env["HOME"]?.trim() || env["USERPROFILE"]?.trim();
  if (!userHome) {
    throw new Error("Cannot resolve home directory for Workspace CLI distribution");
  }
  return resolve(userHome, `.${WORKSPACE_CLI_DISTRIBUTION_ID}`);
}

export function workspaceSessionPath(env: NodeJS.ProcessEnv): string {
  return join(workspaceCliHome(env), "workspace-cli", "session.json");
}

export function workspaceResourceCacheRoot(env: NodeJS.ProcessEnv): string {
  return join(workspaceCliHome(env), "cache", "resources");
}

export function workspaceDaemonSocketPath(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): string {
  const preferred = join(workspaceCliHome(env), "daemon", "daemon.sock");
  if (platform === "win32") {
    return `${WINDOWS_NAMED_PIPE_PREFIX}univer-daemon-${hashPath(preferred)}`;
  }
  return preferred.length <= MAX_PREFERRED_SOCKET_PATH_LENGTH
    ? preferred
    : join("/tmp", `univer-${hashPath(preferred)}.sock`);
}

function hashPath(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 16);
}
