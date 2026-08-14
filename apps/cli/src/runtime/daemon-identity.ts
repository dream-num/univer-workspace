import type { DaemonIdentity } from "@univer-cli/daemon";
import { WORKSPACE_CLI_VERSION } from "../version.js";

export const WORKSPACE_DAEMON_BUILD_ID_ENV = "UNIVER_WORKSPACE_CLI_BUILD_ID";

export function workspaceDaemonIdentity(env: NodeJS.ProcessEnv): DaemonIdentity {
  const buildId = env[WORKSPACE_DAEMON_BUILD_ID_ENV];
  return {
    ...(buildId === undefined || buildId.length === 0 ? {} : { buildId }),
    id: "univer-workspace-cli",
    version: WORKSPACE_CLI_VERSION,
  };
}
