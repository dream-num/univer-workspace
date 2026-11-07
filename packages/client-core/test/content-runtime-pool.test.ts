import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createWorkspaceContentRuntime,
  type WorkspaceContentRuntime,
  type WorkspaceContentRuntimeOptions,
  type WorkspaceRuntimeTarget,
} from "../src/index.js";

const target: WorkspaceRuntimeTarget = {
  origin: "https://workspace.test",
  revision: 7,
  scope: { kind: "trunk" },
  unitId: "unit-1",
  unitType: "sheet",
};

const runtimes: WorkspaceContentRuntime[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
  delete process.env["POOL_PARENT_SECRET"];
});

function create(pool?: WorkspaceContentRuntimeOptions["pool"]): WorkspaceContentRuntime {
  const runtime = createWorkspaceContentRuntime({
    ...(pool === undefined ? {} : { pool }),
    resolveCredential: () => "cookie",
    resolveLicense: () => "license",
    workerEntry: new URL("./fixtures/runtime-env-worker.mjs", import.meta.url),
  });
  runtimes.push(runtime);
  return runtime;
}

describe("Workspace content runtime worker pool options", () => {
  it("gives the worker child only pool.env, or the parent environment when unset", async () => {
    process.env["POOL_PARENT_SECRET"] = "secret";

    const exact = await create({ env: { FOO: "1" } }).executeRead({ code: "env", target });
    expect(exact.value).toContain("FOO");
    expect(exact.value).not.toContain("POOL_PARENT_SECRET");
    expect(exact.value).not.toContain("PATH");

    const inherited = await create().executeRead({ code: "env", target });
    expect(inherited.value).toContain("POOL_PARENT_SECRET");
  });

  it("applies pool.maxWorkers: a second concurrent key hits the pool capacity error", async () => {
    const marker = join(await mkdtemp(join(tmpdir(), "client-core-pool-")), "held");
    const runtime = create({ maxWorkers: 1 });
    const held = runtime.executeRead({ caller: { userId: "alice" }, code: `hold:${marker}`, target });
    for (let attempt = 0; attempt < 300 && !existsSync(marker); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(existsSync(marker)).toBe(true);

    await expect(
      runtime.executeRead({ caller: { userId: "bob" }, code: "env", target }),
    ).rejects.toMatchObject({ code: "COLLABORATION_POOL_CAPACITY_EXCEEDED" });
    await expect(held).resolves.toBeDefined();
  });
});
