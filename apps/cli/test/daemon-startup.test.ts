import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDaemonClient, createDaemonControl } from "@univer-cli/daemon";
import { expect, it } from "vitest";
import { workspaceDaemonSocketPath } from "../src/config.js";
import { workspaceDaemonIdentity } from "../src/runtime/daemon-identity.js";

async function startFixture(contentSource?: string, trackExit = false) {
  const directory = await mkdtemp(join(tmpdir(), "workspace-daemon-startup-"));
  const marker = join(directory, "content-imported.txt");
  const loader = join(directory, "reject-content-loader.mjs");
  const content = join(directory, "content.mjs");
  const exitTracker = join(directory, "track-exit.mjs");
  if (trackExit)
    await writeFile(
      exitTracker,
      `
import { writeFileSync } from 'node:fs';
import { isMainThread } from 'node:worker_threads';
if (isMainThread) process.once('exit', exitCode => writeFileSync(new URL('./exit-' + process.pid + '.json', import.meta.url), JSON.stringify({ exitCode })));
`,
    );
  if (contentSource !== undefined) await writeFile(content, contentSource);
  const require = createRequire(import.meta.url);
  await writeFile(
    loader,
    `
import { writeFileSync } from 'node:fs';
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@univerjs/univer-workspace-client-core') {
    writeFileSync(${JSON.stringify(marker)}, 'content requested');
    ${
      contentSource === undefined
        ? "throw new Error('DAEMON_CONTENT_MODULE_PROBE');"
        : `return { url: ${JSON.stringify(pathToFileURL(content).href)}, shortCircuit: true };`
    }
  }
  return await nextResolve(specifier, context);
}
`,
  );
  const env = {
    ...process.env,
    UNIVER_HOME: directory,
    NODE_OPTIONS: `--import=${pathToFileURL(require.resolve("tsx")).href} ${trackExit ? `--import=${pathToFileURL(exitTracker).href} ` : ""}--loader=${pathToFileURL(loader).href}`,
  };
  const options = {
    entry: new URL("../src/runtime/daemon.ts", import.meta.url),
    env,
    identity: workspaceDaemonIdentity(env),
    socketPath: workspaceDaemonSocketPath(env),
  };
  const control = createDaemonControl(options);
  return {
    env,
    directory,
    marker,
    control,
    client: createDaemonClient(options),
    async close(): Promise<void> {
      await writeFile(join(directory, "release"), "ready");
      await control.stop();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

it("runs source config and daemon commands without importing content capabilities", async () => {
  const fixture = await startFixture();
  async function run(args: readonly string[]): Promise<unknown> {
    return await new Promise((resolveResult, reject) => {
      const child = spawn(
        process.execPath,
        [fileURLToPath(new URL("../src/main.ts", import.meta.url)), ...args],
        {
          env: fixture.env,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.once("error", reject);
      child.once("close", (exitCode) => {
        if (exitCode !== 0) reject(new Error(`Source CLI exited ${String(exitCode)}: ${stderr}`));
        else {
          try {
            resolveResult(JSON.parse(stdout));
          } catch (error) {
            reject(error);
          }
        }
      });
    });
  }
  try {
    await run(["config", "set", "workspace.origin", "http://127.0.0.1:3020", "--json"]);
    expect(await run(["daemon", "start", "--json"])).toMatchObject({ state: "running" });
    expect(await run(["daemon", "status", "--json"])).toMatchObject({ state: "running" });
    expect(await run(["daemon", "stop", "--json"])).toMatchObject({ state: "stopped" });
    await expect(readFile(fixture.marker, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await fixture.close();
  }
}, 30_000);

it("starts and stops the source daemon without loading content capabilities", async () => {
  const fixture = await startFixture(undefined, true);
  const { control, client, marker } = fixture;
  try {
    const started = await control.start();
    expect(started.state).toBe("running");
    expect((await control.status()).state).toBe("running");
    await expect(readFile(marker, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      client.request("runtime.execute-read", { code: "return 1", target: {} }),
    ).rejects.toThrow("DAEMON_CONTENT_MODULE_PROBE");
    await expect(
      client.request("runtime.execute-read", { code: "return 2", target: {} }),
    ).rejects.toThrow("DAEMON_CONTENT_MODULE_PROBE");
    expect(await readFile(marker, "utf8")).toBe("content requested");
    await control.stop();
    await expect
      .poll(
        async () =>
          JSON.parse(await readFile(join(fixture.directory, `exit-${started.pid}.json`), "utf8"))
            .exitCode,
      )
      .toBe(0);
  } finally {
    await fixture.close();
  }
}, 30_000);

function delayedContent(): string {
  return `
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const path = name => fileURLToPath(new URL(name, import.meta.url));
writeFileSync(path('initializing'), 'started');
while (!existsSync(path('release'))) await new Promise(resolve => setTimeout(resolve, 10));
export const parseWorkspaceRuntimeTarget = value => value;
export function createWorkspaceContentRuntime() {
  appendFileSync(path('created'), 'created\\n');
  return {
    async executeRead(input) {
      appendFileSync(path('executed'), 'executed\\n');
      return { value: input.code };
    },
    async close() { appendFileSync(path('closed'), 'closed\\n'); }
  };
}
`;
}

it("shares one initialization and runtime between concurrent first content requests", async () => {
  const fixture = await startFixture(delayedContent());
  try {
    await fixture.control.start();
    const first = fixture.client.request("runtime.execute-read", { code: "first", target: {} });
    const second = fixture.client.request("runtime.execute-read", { code: "second", target: {} });
    await expect
      .poll(() => readFile(join(fixture.directory, "initializing"), "utf8").catch(() => undefined))
      .toBe("started");
    await writeFile(join(fixture.directory, "release"), "ready");
    expect(await Promise.all([first, second])).toEqual([{ value: "first" }, { value: "second" }]);
    expect(await readFile(join(fixture.directory, "created"), "utf8")).toBe("created\n");
    await fixture.control.stop();
    await expect
      .poll(() => readFile(join(fixture.directory, "closed"), "utf8").catch(() => undefined))
      .toBe("closed\n");
  } finally {
    await fixture.close();
  }
}, 30_000);

it("closes a runtime initialized during shutdown without executing the pending content request", async () => {
  const fixture = await startFixture(delayedContent());
  try {
    await fixture.control.start();
    const pending = fixture.client
      .request("runtime.execute-read", { code: "pending", target: {} })
      .catch((error: unknown) => error);
    await expect
      .poll(() => readFile(join(fixture.directory, "initializing"), "utf8").catch(() => undefined))
      .toBe("started");
    await fixture.control.stop();
    expect(await pending).toBeInstanceOf(Error);
    await writeFile(join(fixture.directory, "release"), "ready");
    await expect
      .poll(() => readFile(join(fixture.directory, "closed"), "utf8").catch(() => undefined))
      .toBe("closed\n");
    expect(await readFile(join(fixture.directory, "created"), "utf8")).toBe("created\n");
    await expect(readFile(join(fixture.directory, "executed"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    await fixture.close();
  }
}, 30_000);
