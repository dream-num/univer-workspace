import { once } from "node:events";
import { Writable } from "node:stream";
import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";
import {
  workspaceRuntimeKey,
  type WorkspaceContentRuntime,
} from "@univerjs/univer-workspace-client-core";
import { createBearerCheck } from "../src/shared/bearer.js";
import { parseExecutorConfig } from "../src/shared/config-executor.js";
import { parseGatewayConfig } from "../src/shared/config.js";
import { decodeFrame, encodeFrame, FRAME_CONTENT_TYPE } from "../src/shared/frame.js";
import {
  opSpecs,
  requestHeaderSchema,
  type ExecutorGrant,
} from "../src/shared/executor-protocol.js";
import { credentialRedactions } from "../src/shared/logging.js";
import { zeroCost } from "../src/shared/usage.js";
import { bindRuntime, workerEnvironment } from "../src/executor/runtime.js";
import { resolveGrant } from "../src/executor/credentials.js";
import { mapRuntimeError } from "../src/executor/errors.js";
import { handlers } from "../src/executor/ops/index.js";
import { createExecutor } from "../src/executor/server.js";
import {
  classifyFetchFailure,
  ExecutorRouter,
  rendezvous,
} from "../src/gateway/executor/router.js";
import { callExecutor } from "../src/gateway/executor/client.js";

const token = "internal-token-".repeat(4);
const grant: ExecutorGrant = {
  kind: "session",
  userId: "user-1",
  session: "secret-session",
  expiresAt: Date.now() + 600_000,
};
const config = () =>
  parseExecutorConfig({ WORKSPACE_ORIGIN: "https://workspace.test", MCP_INTERNAL_TOKEN: token });

describe("executor protocol boundaries", () => {
  it("round trips JSON and binary payloads and refuses truncated frames", () => {
    const bytes = new Uint8Array([0, 255, 1]);
    const frame = encodeFrame({ text: "中文", input: { code: "return 1" } }, bytes);
    expect(decodeFrame(frame)).toEqual({
      header: { text: "中文", input: { code: "return 1" } },
      payload: Buffer.from(bytes),
    });
    for (const invalid of [Buffer.alloc(0), Buffer.alloc(3), Buffer.from([0, 0, 0, 50, 123])])
      expect(() => decodeFrame(invalid)).toThrow();
    expect(Object.keys(handlers)).toEqual(Object.keys(opSpecs));
    for (const [name, spec] of Object.entries(opSpecs)) expect(spec.name).toBe(name);
    expect(Object.values(opSpecs).every((op) => op.rerun.length === 0)).toBe(true);
  });

  it("checks bearer digests and production/configuration guards", () => {
    const check = createBearerCheck(token);
    expect(check(`Bearer ${token}`)).toBe(true);
    for (const value of [null, "", "Bearer wrong", `Bearer ${token} `])
      expect(check(value)).toBe(false);
    expect(() => parseExecutorConfig({ NODE_ENV: "production" })).toThrow(/session grants/);
    expect(() =>
      parseExecutorConfig({
        WORKSPACE_ORIGIN: "https://workspace.test",
        MCP_INTERNAL_TOKEN: "short",
      }),
    ).toThrow();
    expect(() =>
      parseGatewayConfig({
        MCP_DEV_SESSION_PASSTHROUGH: "1",
        WORKSPACE_ORIGIN: "https://workspace.test",
        MCP_PUBLIC_URL: "https://mcp.test/mcp",
        MCP_EXECUTOR_URLS: "http://executor:3000",
      }),
    ).toThrow(/together/);
  });

  it("requires caller identity and redacts grant secrets", () => {
    expect(() =>
      requestHeaderSchema.parse({
        v: 1,
        op: "content.execute",
        requestId: "request",
        deadlineMs: 100,
        grant: { ...grant, userId: undefined },
        input: {},
      }),
    ).toThrow();
    expect(() => resolveGrant({ ...grant, expiresAt: 1 })).toThrow(/grant/);
    let output = "";
    const logger = pino(
      { redact: credentialRedactions },
      new Writable({
        write(chunk, _encoding, done) {
          output += chunk.toString();
          done();
        },
      }),
    );
    logger.info({ grant, nested: { session: grant.session }, MCP_INTERNAL_TOKEN: token });
    expect(output).not.toContain(grant.session);
    expect(output).not.toContain(token);
    expect(workerEnvironment).toEqual({ NODE_ENV: "production" });
  });

  it("binds distinct caller keys for two users on the same Unit", async () => {
    const keys = new Set<string>();
    const runtime: WorkspaceContentRuntime = {
      executeRead: async (input) => {
        expect(input.caller?.grant).toBeDefined();
        keys.add(workspaceRuntimeKey(input.target, input.caller));
        input.observe?.({ coldStart: true, workerMs: 5 });
        return {
          value: null,
          state: {
            connection: "online" as const,
            baseRevision: 1,
            knownHeadRevision: 1,
            pendingMutationCount: 0,
            bufferedChangesetCount: 0,
            awaitingChangeset: null,
            conflict: null,
          },
        };
      },
      executeAndCommit: async () => ({ committed: false, value: null }),
      exportUnitData: async () => {
        throw new Error("unused");
      },
      close: async () => {},
    };
    const target = {
      origin: "https://workspace.test",
      scope: { kind: "trunk" as const },
      unitId: "unit",
      unitType: "sheet" as const,
      revision: 0,
    };
    for (const userId of ["alice", "bob"])
      await bindRuntime(
        runtime,
        { ...grant, userId },
        { executor: "none", cost: { ...zeroCost } },
        new AbortController().signal,
      ).executeRead({ target, code: "1" });
    expect([...keys].map((key) => key.split(":caller:")[1])).toEqual(["alice", "bob"]);
  });

  it("preserves detail and maps timeout phases without rerunning writes", () => {
    for (const [code, effect, expected] of [
      ["COLLABORATION_WORKER_OPEN_TIMEOUT", "write", "workspace-executor-timeout"],
      ["COLLABORATION_WORKER_OPERATION_TIMEOUT", "write", "workspace-result-unknown"],
      ["COLLABORATION_WORKER_OPERATION_TIMEOUT", "read", "workspace-executor-timeout"],
      ["COLLABORATION_WORKER_CRASHED", "write", "workspace-result-unknown"],
      ["COLLABORATION_POOL_CAPACITY_EXCEEDED", "write", "workspace-runtime-busy"],
    ] as const)
      expect(mapRuntimeError(Object.assign(new Error("failure"), { code }), effect).code).toBe(
        expected,
      );
    expect(
      mapRuntimeError(
        Object.assign(new Error("Ready"), {
          code: "workspace-worktree-not-editable",
          detail: { state: "ready" },
        }),
        "write",
      ),
    ).toMatchObject({ detail: { state: "ready" } });
  });

  it("returns unavailable when no executor is configured", async () => {
    await expect(
      callExecutor(null, opSpecs["content.execute"], {
        input: { worktreeId: "wt", unitId: "unit", code: "return 1" },
      }),
    ).rejects.toMatchObject({ wire: { code: "workspace-executor-unavailable" } });
  });

  it("routes stably and fails over only before delivery", async () => {
    const urls = ["http://one.test", "http://two.test", "http://three.test"];
    const ordered = rendezvous(urls, "user\0worktree:wt\0unit");
    expect(rendezvous([...urls].reverse(), "user\0worktree:wt\0unit")).toEqual(ordered);
    expect(
      rendezvous(
        urls.filter((url) => url !== ordered[2]),
        "user\0worktree:wt\0unit",
      )[0],
    ).toBe(ordered[0]);
    expect(
      classifyFetchFailure(
        new TypeError("fetch failed", {
          cause: Object.assign(new Error(), { code: "ECONNREFUSED" }),
        }),
      ),
    ).toBe("not-delivered");
    expect(classifyFetchFailure(Object.assign(new Error(), { code: "ECONNRESET" }))).toBe(
      "unknown",
    );
    const fetcher = vi.spyOn(globalThis, "fetch");
    const connection = () => ({
      router: new ExecutorRouter(urls),
      internalToken: token,
      grant,
      requestId: "routing",
      deadlineAt: Date.now() + 30_000,
    });
    try {
      fetcher
        .mockRejectedValueOnce(Object.assign(new Error(), { code: "ECONNREFUSED" }))
        .mockResolvedValueOnce(
          new Response(
            new Uint8Array(
              encodeFrame({
                ok: true,
                output: { committed: true, revision: 1, status: "committed", value: 2 },
                meta: { executor: "warm", cost: { ...zeroCost, committed_revisions: 1 } },
              }),
            ),
          ),
        );
      await expect(
        callExecutor(connection(), opSpecs["content.execute"], {
          input: { worktreeId: "wt", unitId: "unit", code: "1" },
        }),
      ).resolves.toMatchObject({ output: { value: 2 } });
      expect(fetcher).toHaveBeenCalledTimes(2);
      fetcher.mockReset().mockRejectedValue(Object.assign(new Error(), { code: "ECONNRESET" }));
      await expect(
        callExecutor(connection(), opSpecs["content.execute"], {
          input: { worktreeId: "wt", unitId: "unit", code: "1" },
        }),
      ).rejects.toMatchObject({ wire: { code: "workspace-result-unknown" } });
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      fetcher.mockRestore();
    }
  });

  it("rejects missing bearer and caller before dispatch over real HTTP", async () => {
    const runtime: WorkspaceContentRuntime = {
      executeRead: vi.fn(),
      executeAndCommit: vi.fn(),
      exportUnitData: vi.fn(),
      close: async () => {},
    };
    const executor = createExecutor(config(), { runtime, logger: pino({ level: "silent" }) });
    executor.server.listen(0, "127.0.0.1");
    await once(executor.server, "listening");
    const address = executor.server.address();
    if (!address || typeof address === "string") throw new Error("Missing address");
    const url = `http://127.0.0.1:${address.port}/rpc/v1/content.execute`;
    try {
      for (const authorization of ["", "Bearer wrong"])
        expect((await fetch(url, { method: "POST", headers: { authorization } })).status).toBe(401);
      const response = await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": FRAME_CONTENT_TYPE,
          "x-mcp-rpc-version": "1",
        },
        body: new Uint8Array(
          encodeFrame({
            v: 1,
            op: "content.execute",
            requestId: "test",
            deadlineMs: 500,
            grant: { ...grant, userId: undefined },
            input: {},
          }),
        ),
      });
      expect(response.status).toBe(400);
      const wrongVersion = await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": FRAME_CONTENT_TYPE,
          "x-mcp-rpc-version": "1",
        },
        body: new Uint8Array(
          encodeFrame({
            v: 2,
            op: "content.execute",
            requestId: "test",
            deadlineMs: 500,
            grant,
            input: {},
          }),
        ),
      });
      expect(wrongVersion.status).toBe(426);
      expect(runtime.executeAndCommit).not.toHaveBeenCalled();
    } finally {
      await executor.close();
    }
  });
});
