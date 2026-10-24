import { describe, expect, it } from "vitest";
import { basename, dirname, join, resolve } from "node:path";
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
    const env = { HOME: resolve("/users/alice") };
    const home = join(env.HOME, ".univer-workspace-cli");

    expect(workspaceCliHome(env)).toBe(home);
    expect(workspaceDaemonSocketPath(env, "linux")).toBe(join(home, "daemon/daemon.sock"));
    expect(workspaceSessionPath(env)).toBe(join(home, "workspace-cli/session.json"));
    expect(workspaceResourceCacheRoot(env)).toBe(join(home, "cache/resources"));
  });

  it("isolates an explicit UNIVER_HOME as the Workspace CLI distribution", () => {
    const env = { HOME: "/unused", UNIVER_HOME: "/runtime-base" };

    const home = join(resolve("/runtime-base"), "distributions/univer-workspace-cli");
    expect(workspaceCliHome(env)).toBe(home);
    expect(workspaceDaemonSocketPath(env, "linux")).toBe(join(home, "daemon/daemon.sock"));
  });

  it("rejects an environment without a user home", () => {
    expect(() => workspaceCliHome({})).toThrow(
      "Cannot resolve home directory for Workspace CLI distribution",
    );
  });

  it("uses a stable fallback when the Unix socket path would be too long", () => {
    const env = {
      UNIVER_HOME: `/tmp/${"long-home-segment-".repeat(6)}`,
    };
    const socketPath = workspaceDaemonSocketPath(env, "linux");

    expect(dirname(socketPath)).toBe(join("/tmp"));
    expect(basename(socketPath)).toMatch(/^univer-[a-f0-9]{16}\.sock$/u);
    expect(workspaceDaemonSocketPath(env, "linux")).toBe(socketPath);
  });

  it("uses a stable named pipe on Windows", () => {
    const socketPath = workspaceDaemonSocketPath({ HOME: "C:\\Users\\alice" }, "win32");

    expect(socketPath).toMatch(/^\\\\\.\\pipe\\univer-daemon-[a-f0-9]{16}$/u);
  });
});

describe("Workspace CLI Univer license", () => {
  it("uses the bundled license when the environment does not provide one", () => {
    expect(resolveUniverLicense({})).toBe(UNIVER_LICENSE);
    expect(resolveUniverLicense({ [UNIVER_LICENSE_ENV]: "  " })).toBe(UNIVER_LICENSE);
    expect(UNIVER_LICENSE).toMatch(/^2101948364242481153-/u);
  });

  it("allows a non-empty environment value to override the bundled license", () => {
    expect(resolveUniverLicense({ [UNIVER_LICENSE_ENV]: "custom-license" })).toBe("custom-license");
  });
});
