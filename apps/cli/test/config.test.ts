import { describe, expect, it } from "vitest";
import {
  resolveUniverLicense,
  UNIVER_LICENSE_ENV,
  workspaceCliHome,
  workspaceDaemonSocketPath,
  workspaceResourceCacheRoot,
  workspaceSessionPath,
} from "../src/config.js";
import { UNIVER_LICENSE } from "../src/license.js";

describe("Workspace CLI application paths", () => {
  it("uses the production Workspace CLI home by default", () => {
    const env = { HOME: "/home/alice" };

    expect(workspaceCliHome(env)).toBe("/home/alice/.univer-workspace-cli");
    expect(workspaceDaemonSocketPath(env)).toBe(
      "/home/alice/.univer-workspace-cli/daemon/daemon.sock",
    );
    expect(workspaceSessionPath(env)).toBe(
      "/home/alice/.univer-workspace-cli/workspace-cli/session.json",
    );
    expect(workspaceResourceCacheRoot(env)).toBe(
      "/home/alice/.univer-workspace-cli/cache/resources",
    );
  });

  it("isolates an explicit UNIVER_HOME as the Workspace CLI distribution", () => {
    const env = { HOME: "/unused", UNIVER_HOME: "/runtime-base" };

    expect(workspaceCliHome(env)).toBe(
      "/runtime-base/distributions/univer-workspace-cli",
    );
    expect(workspaceDaemonSocketPath(env)).toBe(
      "/runtime-base/distributions/univer-workspace-cli/daemon/daemon.sock",
    );
  });

  it("rejects an environment without a user home", () => {
    expect(() => workspaceCliHome({})).toThrow(
      "Cannot resolve home directory for Workspace CLI distribution",
    );
  });

  it("uses a stable fallback when the Unix socket path would be too long", () => {
    const socketPath = workspaceDaemonSocketPath({
      UNIVER_HOME: `/tmp/${"long-home-segment-".repeat(6)}`,
    });

    expect(socketPath).toMatch(/^\/tmp\/univer-[a-f0-9]{16}\.sock$/u);
  });

  it("uses a stable named pipe on Windows", () => {
    const socketPath = workspaceDaemonSocketPath(
      { HOME: "C:\\Users\\alice" },
      "win32",
    );

    expect(socketPath).toMatch(/^\\\\\.\\pipe\\univer-daemon-[a-f0-9]{16}$/u);
  });
});

describe("Workspace CLI Univer license", () => {
  it("uses the bundled license when the environment does not provide one", () => {
    expect(resolveUniverLicense({})).toBe(UNIVER_LICENSE);
    expect(resolveUniverLicense({ [UNIVER_LICENSE_ENV]: "  " })).toBe(UNIVER_LICENSE);
    expect(UNIVER_LICENSE).toMatch(/^2088168239728517120-/u);
  });

  it("allows a non-empty environment value to override the bundled license", () => {
    expect(resolveUniverLicense({ [UNIVER_LICENSE_ENV]: "custom-license" })).toBe("custom-license");
  });
});
