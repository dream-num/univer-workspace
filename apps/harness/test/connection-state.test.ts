import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readlink, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  connectionIdentityKey,
  parseConnectionState,
  readConnectionState,
  runtimeHomeFor,
  writeConfiguredOrigin,
  writeConnectionState,
  type WorkspaceConnection,
} from "../src/connection-state.ts";

const connection: WorkspaceConnection = {
  origin: "https://workspace.example/path",
  identity: { userId: "user-1", username: "alice", displayName: "Alice" },
  sessionToken: "opaque-session-token",
};
const execFileAsync = promisify(execFile);

describe("local Workspace connection state", () => {
  it("selects one physical runtime per origin and user", () => {
    const aliceA = runtimeHomeFor("/data", connection);
    const bobA = runtimeHomeFor("/data", {
      ...connection,
      identity: { userId: "user-2", username: "bob" },
    });
    const aliceB = runtimeHomeFor("/data", {
      ...connection,
      origin: "https://workspace-b.example",
    });

    expect(runtimeHomeFor("/data", undefined)).toBe("/data/runtimes/bootstrap");
    expect(new Set([aliceA, bobA, aliceB]).size).toBe(3);
    expect(aliceA).toContain(connectionIdentityKey("https://workspace.example", "user-1"));
  });

  it("writes an owner-only atomic state file and reads its normalized origin", async () => {
    const root = await mkdtemp(join(tmpdir(), "uwh-connection-"));
    const path = join(root, "state", "connection.json");
    await writeConnectionState(path, connection);

    await expect(readConnectionState(path)).resolves.toEqual({
      version: 1,
      active: { ...connection, origin: "https://workspace.example" },
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readFile(path, "utf8")).not.toContain("/path");
  });

  it("keeps the shared configured origin when the active identity changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "uwh-connection-"));
    const path = join(root, "connection.json");

    await writeConfiguredOrigin(path, "http://127.0.0.1:3021/path");
    await writeConnectionState(path, connection);

    await expect(readConnectionState(path)).resolves.toEqual({
      version: 1,
      configuredOrigin: "http://127.0.0.1:3021",
      active: { ...connection, origin: "https://workspace.example" },
    });

    await writeConnectionState(path, undefined);
    await expect(readConnectionState(path)).resolves.toEqual({
      version: 1,
      configuredOrigin: "http://127.0.0.1:3021",
    });
  });

  it("reads older version-1 state without a configured origin", () => {
    expect(parseConnectionState({ version: 1, active: connection })).toEqual({
      version: 1,
      active: { ...connection, origin: "https://workspace.example" },
    });
  });

  it("represents logout by removing the active connection", async () => {
    const root = await mkdtemp(join(tmpdir(), "uwh-connection-"));
    const path = join(root, "connection.json");
    await writeConnectionState(path, connection);
    await writeConnectionState(path, undefined);
    await expect(readConnectionState(path)).resolves.toEqual({ version: 1 });
  });

  it("rejects malformed or credential-bearing origins", () => {
    expect(() =>
      parseConnectionState({
        version: 1,
        active: { ...connection, origin: "https://alice:secret@workspace.example" },
      }),
    ).toThrow("must not contain credentials");
    expect(() => parseConnectionState({ version: 2 })).toThrow("Unsupported");
  });

  it("reads version-1 state written by the former local-expiry implementation", () => {
    expect(
      parseConnectionState({
        version: 1,
        active: { ...connection, expiresAt: 1 },
      }),
    ).toEqual({
      version: 1,
      active: { ...connection, origin: "https://workspace.example" },
    });
  });

  it("starts DSH in bootstrap and identity-specific homes while sharing the profile", async () => {
    const root = await mkdtemp(join(tmpdir(), "uwh-launcher-"));
    const installHome = join(root, "install");
    const dataHome = join(root, "data");
    const profileRoot = join(installHome, "profiles");
    const fakeDsh = join(root, "fake-dsh.mjs");
    const output = join(root, "launch.json");
    const statePath = join(dataHome, "connection.json");
    await mkdir(profileRoot, { recursive: true });
    await mkdir(join(dataHome, "runtimes", "bootstrap"), { recursive: true });
    await writeFile(
      join(dataHome, "runtimes", "bootstrap", ".credentials.yaml"),
      "legacy-browser-secret",
      "utf8",
    );
    await writeFile(
      fakeDsh,
      `import { writeFileSync } from "node:fs";\nwriteFileSync(process.env.UWH_TEST_OUTPUT, JSON.stringify({ home: process.env.DSH_HOME, state: process.env.UWH_CONNECTION_STATE_PATH, sharedCredentials: process.env.UWH_SHARED_CREDENTIALS_PATH, origin: process.env.UWH_WORKSPACE_ORIGIN, args: process.argv.slice(2) }));\n`,
      "utf8",
    );

    const run = async (): Promise<Record<string, unknown>> => {
      await execFileAsync(
        process.execPath,
        [new URL("../scripts/start-local.mjs", import.meta.url).pathname],
        {
          env: {
            ...process.env,
            DSH_HOME: installHome,
            DSH_BIN: fakeDsh,
            DSH_PROFILE: "test-profile",
            UWH_DSH_DATA_HOME: dataHome,
            UWH_WORKSPACE_ORIGIN: "https://stale.example",
            UWH_TEST_OUTPUT: output,
          },
        },
      );
      return JSON.parse(await readFile(output, "utf8")) as Record<string, unknown>;
    };

    const bootstrap = await run();
    expect(bootstrap.home).toBe(join(dataHome, "runtimes", "bootstrap"));
    expect(bootstrap.state).toBe(statePath);
    expect(bootstrap.origin).toBeUndefined();
    expect(bootstrap.args).toEqual(["--profile", "test-profile"]);
    expect(bootstrap.sharedCredentials).toBe(join(dataHome, "shared", ".credentials.yaml"));
    expect(await readFile(String(bootstrap.sharedCredentials), "utf8")).toBe(
      "legacy-browser-secret",
    );
    expect(await readlink(join(String(bootstrap.home), "profiles"))).toBe(profileRoot);

    await writeConnectionState(statePath, connection);
    const connected = await run();
    expect(connected.home).toBe(runtimeHomeFor(dataHome, connection));
    expect(connected.origin).toBe("https://workspace.example");
    expect(await readlink(join(String(connected.home), "profiles"))).toBe(profileRoot);
  });

  it("supervises a full DSH restart when the active connection changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "uwh-supervisor-"));
    const installHome = join(root, "install");
    const dataHome = join(root, "data");
    const profileRoot = join(installHome, "profiles");
    const fakeDsh = join(root, "switching-dsh.mjs");
    const output = join(root, "launches.jsonl");
    const counter = join(root, "counter");
    const statePath = join(dataHome, "connection.json");
    await mkdir(profileRoot, { recursive: true });
    await writeFile(
      fakeDsh,
      `import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
const count = existsSync(process.env.UWH_TEST_COUNTER) ? Number(readFileSync(process.env.UWH_TEST_COUNTER, "utf8")) + 1 : 1;
writeFileSync(process.env.UWH_TEST_COUNTER, String(count));
appendFileSync(process.env.UWH_TEST_OUTPUT, JSON.stringify({ count, home: process.env.DSH_HOME, origin: process.env.UWH_WORKSPACE_ORIGIN, marker: process.env.UWH_TEST_MARKER, args: process.argv.slice(2) }) + "\\n");
if (count === 1) {
  setTimeout(() => writeFileSync(process.env.UWH_CONNECTION_STATE_PATH, JSON.stringify({ version: 1, active: { origin: "https://workspace.example", identity: { userId: "user-1", username: "alice" }, sessionToken: "new-token" } })), 30);
  process.on("SIGTERM", () => process.exit(0));
  setInterval(() => {}, 1000);
}
`,
      "utf8",
    );

    await execFileAsync(
      process.execPath,
      [
        new URL("../scripts/start-local.mjs", import.meta.url).pathname,
        "--port",
        "3999",
        "--trusted-host",
        "127.0.0.1",
      ],
      {
        env: {
          ...process.env,
          DSH_HOME: installHome,
          DSH_BIN: fakeDsh,
          DSH_PROFILE: "test-profile",
          UWH_CONNECTION_POLL_MS: "20",
          UWH_DSH_DATA_HOME: dataHome,
          UWH_TEST_MARKER: "preserved-environment",
          UWH_TEST_COUNTER: counter,
          UWH_TEST_OUTPUT: output,
        },
        timeout: 5_000,
      },
    );

    const launches = (await readFile(output, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(launches).toEqual([
      {
        count: 1,
        home: join(dataHome, "runtimes", "bootstrap"),
        marker: "preserved-environment",
        args: ["--profile", "test-profile", "--port", "3999", "--trusted-host", "127.0.0.1"],
      },
      {
        count: 2,
        home: runtimeHomeFor(dataHome, connection),
        origin: "https://workspace.example",
        marker: "preserved-environment",
        args: ["--profile", "test-profile", "--port", "3999", "--trusted-host", "127.0.0.1"],
      },
    ]);
  });
});
