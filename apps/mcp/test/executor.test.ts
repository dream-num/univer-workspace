import { testStagingDirectory } from "./staging-directory.js";
import { once } from "node:events";
import { Writable } from "node:stream";
import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";
import {
  workspaceRuntimeKey,
  createWorkspaceContentRuntime,
  type WorkspaceContentRuntime,
} from "@univerjs/univer-workspace-client-core";
import { createBearerCheck } from "../src/shared/bearer.js";
import { parseExecutorConfig } from "../src/shared/config-executor.js";
import { parseGatewayConfig } from "../src/shared/config.js";
import { decodeFrame, encodeFrame, FRAME_CONTENT_TYPE } from "../src/shared/frame.js";
import {
  PROTOCOL_VERSION,
  opSpecs,
  requestHeaderSchema,
  type ExecutorGrant,
} from "../src/shared/executor-protocol.js";
import { credentialRedactions } from "../src/shared/logging.js";
import { zeroCost } from "../src/shared/usage.js";
import { bindRuntime, workerEnvironment, reuseExecutorWorker } from "../src/executor/runtime.js";
import { createGrantVerifier, grantCookie, resolveGrant } from "../src/executor/credentials.js";
import { mapRuntimeError } from "../src/executor/errors.js";
import { workspaceError } from "@univerjs/univer-workspace-client-core/product";
import { handlers } from "../src/executor/ops/index.js";
import { createExecutor } from "../src/executor/server.js";
import {
  classifyFetchFailure,
  ExecutorRouter,
  rendezvous,
} from "../src/gateway/executor/router.js";
import { callExecutor } from "../src/gateway/executor/client.js";

const token = "executor-token-".repeat(4);
const rendererToken = "renderer-token-".repeat(4);
const grant: ExecutorGrant = {
  kind: "session",
  userId: "user-1",
  session: "secret-session",
  expiresAt: Date.now() + 600_000,
};
const config = () =>
  parseExecutorConfig({ WORKSPACE_ORIGIN: "https://workspace.test", MCP_EXECUTOR_TOKEN: token });

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
    expect(opSpecs["content.execute"].rerun).toEqual(["revision", "auth"]);
    expect(opSpecs["content.inspect"].rerun).toEqual(["auth", "revision"]);
    expect(opSpecs["exchange.import"].rerun).toEqual([]);
    expect(opSpecs["htmlView.validate"].rerun).toEqual(["auth"]);
    expect(opSpecs["htmlView.create"].rerun).toEqual(["auth"]);
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
        MCP_EXECUTOR_TOKEN: "short",
      }),
    ).toThrow();
    expect(() =>
      parseGatewayConfig({
        MCP_DEV_SESSION_PASSTHROUGH: "1",
        WORKSPACE_ORIGIN: "https://workspace.test",
        MCP_STAGING_DIRECTORY: testStagingDirectory(), MCP_PUBLIC_URL: "https://mcp.test/mcp",
        MCP_EXECUTOR_URLS: "http://executor:3000",
      }),
    ).toThrow(/together/);
    expect(() => parseGatewayConfig({
      MCP_DEV_SESSION_PASSTHROUGH: "1", WORKSPACE_ORIGIN: "https://workspace.test",
      MCP_STAGING_DIRECTORY: testStagingDirectory(), MCP_PUBLIC_URL: "https://mcp.test/mcp",
      MCP_EXECUTOR_TOKEN: token,
    })).toThrow(/together/);
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
    logger.info({
      grant,
      nested: { session: grant.session },
      MCP_EXECUTOR_TOKEN: token,
      MCP_RENDERER_TOKEN: rendererToken,
      nestedTokens: { MCP_EXECUTOR_TOKEN: token, MCP_RENDERER_TOKEN: rendererToken },
      executorToken: token,
      rendererToken,
      MCP_EXECUTOR_ALLOWED_USER_IDS: "private-allowlist-id",
    });
    expect(output).not.toContain(grant.session);
    expect(output).not.toContain(token);
    expect(output).not.toContain(rendererToken);
    expect(output).not.toContain("private-allowlist-id");
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
        workspaceError("workspace-worktree-not-editable", "Ready", { state: "ready" }),
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
      executorToken: token,
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

  it.each([undefined, "http://renderer.test"])(
    "authenticates capability discovery and uses declared renderer operations with %s",
    async (rendererUrl) => {
      const nativeFetch = globalThis.fetch;
      const discovery = vi.spyOn(globalThis, "fetch").mockImplementation((url, options) =>
        String(url) === "http://renderer.test/rpc/v1/capabilities"
          ? Promise.resolve(Response.json({ v: 1, operations: ["screenshot", "printPdf", "lint", "measureText"] }))
          : nativeFetch(url, options),
      );
      const executor = createExecutor(
        parseExecutorConfig({
          WORKSPACE_ORIGIN: "https://workspace.test",
          MCP_EXECUTOR_TOKEN: token,
          ...(rendererUrl === undefined ? {} : { MCP_RENDERER_URL: rendererUrl, MCP_RENDERER_TOKEN: rendererToken }),
        }),
        {
          runtime: {
            executeRead: vi.fn(),
            executeAndCommit: vi.fn(),
            exportUnitData: vi.fn(),
            close: async () => {},
          },
          logger: pino({ level: "silent" }),
        },
      );
      executor.server.listen(0, "127.0.0.1");
      await once(executor.server, "listening");
      const address = executor.server.address();
      if (!address || typeof address === "string") throw new Error("Expected TCP address");
      const url = `http://127.0.0.1:${address.port}/rpc/v1/capabilities`;
      try {
        for (const authorization of ["", "Bearer wrong", `Bearer ${rendererToken}`]) {
          expect((await fetch(url.replace("capabilities", "content.execute"), {
            method: "POST", headers: { authorization },
          })).status).toBe(401);
        }
        for (const authorization of ["", "Bearer wrong", `Bearer ${rendererToken}`]) {
          expect((await fetch(url, { headers: { authorization } })).status).toBe(401);
        }
        const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          v: PROTOCOL_VERSION,
          operations: Object.keys(opSpecs).filter(
            (name) => rendererUrl !== undefined || !name.startsWith("render."),
          ),
        });
      } finally {
        await executor.close();
        discovery.mockRestore();
      }
    },
  );

  it("rejects unlisted grant users before Workspace calls or worker starts over real HTTP", async () => {
    const runtime: WorkspaceContentRuntime = {
      executeRead: vi.fn(),
      executeAndCommit: vi.fn(),
      exportUnitData: vi.fn(),
      close: async () => {},
    };
    const executor = createExecutor(
      parseExecutorConfig({
        WORKSPACE_ORIGIN: "https://workspace.test",
        MCP_EXECUTOR_TOKEN: token,
        MCP_EXECUTOR_ALLOWED_USER_IDS: "trusted",
        NODE_ENV: "production",
      }),
      { runtime, logger: pino({ level: "silent" }) },
    );
    executor.server.listen(0, "127.0.0.1");
    await once(executor.server, "listening");
    const address = executor.server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP address");
    const send = fetch;
    const workspace = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Unexpected Workspace call"));
    try {
      const response = await send(`http://127.0.0.1:${address.port}/rpc/v1/content.execute`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": FRAME_CONTENT_TYPE,
          "x-mcp-rpc-version": String(PROTOCOL_VERSION),
        },
        body: new Uint8Array(
          encodeFrame({
            v: PROTOCOL_VERSION,
            op: "content.execute",
            requestId: "unlisted",
            deadlineMs: 500,
            grant,
            input: { worktreeId: "wt", unitId: "unit", code: "return 1" },
          }),
        ),
      });
      expect(response.status).toBe(200);
      const result = decodeFrame(Buffer.from(await response.arrayBuffer()));
      expect(result.header).toMatchObject({
        ok: false,
        error: { code: "workspace-permission-denied", outcome: "tool_error" },
      });
      expect(JSON.stringify(result.header)).not.toContain(grant.userId);
      expect(JSON.stringify(result.header)).not.toContain(grant.session);
      expect(workspace).not.toHaveBeenCalled();
      expect(runtime.executeRead).not.toHaveBeenCalled();
      expect(runtime.executeAndCommit).not.toHaveBeenCalled();
      expect(runtime.exportUnitData).not.toHaveBeenCalled();
    } finally {
      workspace.mockRestore();
      await executor.close();
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

describe("executor regression boundaries", () => {
  it("replaces a near-expiry worker credential with the next grant's session", async () => {
    const runtime = createWorkspaceContentRuntime({
      resolveCredential: (_target, caller) => grantCookie(resolveGrant(caller?.grant)),
      resolveLicense: () => "license",
      reuseWorker: reuseExecutorWorker,
      workerEntry: new URL("./fixtures/credential-worker.mjs", import.meta.url),
      pool: { env: workerEnvironment, maxWorkers: 1, queue: { timeoutMs: 1000 } },
    });
    const target = {
      origin: "http://127.0.0.1:1",
      revision: 7,
      scope: { kind: "trunk" as const },
      unitId: "unit-1",
      unitType: "sheet" as const,
    };
    const call = (session: string, expiresAt: number) =>
      bindRuntime(
        runtime,
        { ...grant, session, expiresAt },
        { executor: "none", cost: { ...zeroCost } },
        new AbortController().signal,
      ).executeRead({ code: "credential", target });
    try {
      expect((await call("old", Date.now() + 60_000)).value).toBe("workspace_session=old");
      expect((await call("fresh", Date.now() + 600_000)).value).toBe("workspace_session=fresh");
      expect((await call("rotated", Date.now() + 600_000)).value).toBe("workspace_session=fresh");
    } finally {
      await runtime.close();
    }
  });

  it("checks allowlisted session ownership once per session, expiry, and 401", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ authenticated: true, user: { id: "user-1", displayName: "Alice" } }),
        ),
      );
    fetcher.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ authenticated: true, user: { id: "user-1", displayName: "Alice" } }),
        ),
    );
    const verify = createGrantVerifier(
      {
        WORKSPACE_ORIGIN: "https://identity.test",
        WORKSPACE_TRANSPORT_URL: "https://transport.test",
        MCP_EXECUTOR_ALLOWED_USER_IDS: new Set(["user-1", "victim"]),
      },
      fetcher,
    );
    await Promise.all([verify(grant, "test"), verify(grant, "test")]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("https://transport.test/api/session");
    await expect(verify({ ...grant, userId: "unlisted" }, "test")).rejects.toMatchObject({
      code: "workspace-permission-denied",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(verify({ ...grant, userId: "victim" }, "test")).rejects.toMatchObject({
      code: "workspace-authentication-required",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const clock = vi.spyOn(Date, "now").mockReturnValue(grant.expiresAt + 1);
    try {
      await verify({ ...grant, expiresAt: grant.expiresAt + 10000 }, "test");
    } finally {
      clock.mockRestore();
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockImplementation(async () => new Response("{}", { status: 401 }));
    await expect(verify({ ...grant, session: "revoked" }, "test")).rejects.toMatchObject({
      code: "workspace-authentication-required",
    });
    fetcher.mockImplementation(async () => Response.json({
      authenticated: true, user: { id: "user-1", displayName: "Alice" },
    }));
    await verify({ ...grant, session: "revoked" }, "test");
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it.each([413, 426, 400, 500, 503])(
    "classifies HTTP %s without failover except 503",
    async (status) => {
      const fetcher = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async () => new Response("{}", { status }));
      const router = new ExecutorRouter(["http://one.test", "http://two.test"]);
      const down = vi.spyOn(router, "notDelivered");
      try {
        await expect(
          callExecutor(
            {
              router,
              executorToken: token,
              grant,
              requestId: "request",
              deadlineAt: Date.now() + 30_000,
            },
            opSpecs["content.execute"],
            { input: { worktreeId: "wt", unitId: "unit", code: "1" } },
          ),
        ).rejects.toMatchObject({
          wire: {
            code:
              status === 413
                ? "workspace-request-too-large"
                : status === 426
                  ? "workspace-executor-version-mismatch"
                  : "workspace-executor-unavailable",
            outcome: status === 413 || status === 426 ? "tool_error" : "internal_error",
          },
        });
        expect(fetcher).toHaveBeenCalledTimes(status === 503 ? 2 : 1);
        expect(down).toHaveBeenCalledTimes(status === 503 ? 2 : 0);
      } finally {
        fetcher.mockRestore();
      }
    },
  );

  it("rejects oversized requests and expired budgets before delivery", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch");
    const connection = {
      router: new ExecutorRouter(["http://one.test"]),
      executorToken: token,
      grant,
      requestId: "request",
      deadlineAt: Date.now() + 30_000,
    };
    try {
      await expect(
        callExecutor(
          connection,
          {
            ...opSpecs["content.execute"],
            limits: { ...opSpecs["content.execute"].limits, requestBytes: 1 },
          },
          { input: { worktreeId: "wt", unitId: "unit", code: "1" } },
        ),
      ).rejects.toMatchObject({
        wire: { code: "workspace-request-too-large", outcome: "tool_error" },
      });
      await expect(
        callExecutor({ ...connection, deadlineAt: 1 }, opSpecs["content.execute"], {
          input: { worktreeId: "wt", unitId: "unit", code: "1" },
        }),
      ).rejects.toMatchObject({
        wire: {
          code: "workspace-executor-timeout",
          outcome: "tool_error",
          detail: { started: false },
        },
      });
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      fetcher.mockRestore();
    }
  });

  it("keeps ambiguous commit errors distinct from not-started deadlines", () => {
    expect(
      mapRuntimeError(workspaceError("workspace-submit-retry-exhausted", "unconfirmed"), "write"),
    ).toMatchObject({
      code: "workspace-result-unknown",
      outcome: "tool_error",
      detail: { cause: "workspace-submit-retry-exhausted" },
    });
    expect(
      mapRuntimeError(workspaceError("workspace-runtime-not-started", "cancelled"), "write"),
    ).toMatchObject({
      code: "workspace-executor-timeout",
      outcome: "timeout",
      detail: { retryable: true, started: false },
    });
    expect(mapRuntimeError(new Error("private detail"), "write")).toMatchObject({
      code: "workspace-internal-error",
      outcome: "internal_error",
    });
  });
});

describe("script and commit failure origins through a real worker", () => {
  it.each([
    ['throw new Error("x")', "x", "Error"],
    ["const = ;", "Unexpected token '='", "SyntaxError"],
    ["workbook.noSuchMethod()", "workbook.noSuchMethod is not a function", "TypeError"],
    ["const x = null; return x.foo", "Cannot read properties of null (reading 'foo')", "TypeError"],
  ])("returns the CLI message for %s", async (code, message, name) => {
    const runtime = createWorkspaceContentRuntime({
      resolveCredential: () => "cookie",
      resolveLicense: () => "license",
      workerEntry: new URL("./fixtures/script-worker.mjs", import.meta.url),
    });
    const target = {
      origin: "http://127.0.0.1:1",
      revision: 7,
      scope: { kind: "worktree" as const, worktreeId: "wt" },
      unitId: "unit-1",
      unitType: "sheet" as const,
    };
    const bound = bindRuntime(
      runtime,
      grant,
      { executor: "none", cost: { ...zeroCost } },
      new AbortController().signal,
    );
    try {
      await expect(bound.executeAndCommit({ code: code!, target })).rejects.toMatchObject({
        wire: {
          code: "workspace-script-failed",
          message,
          detail: { name },
          outcome: "tool_error",
        },
      });
      await expect(
        bound.executeAndCommit({ code: "commit-failure", target }),
      ).rejects.toMatchObject({
        wire: {
          code: "workspace-result-unknown",
          detail: { cause: "workspace-internal-error" },
          outcome: "tool_error",
        },
      });
      await expect(
        bound.executeAndCommit({ code: "commit-timeout", target }),
      ).rejects.toMatchObject({
        wire: {
          code: "workspace-result-unknown",
          outcome: "timeout",
          detail: { cause: "TimeoutError" },
        },
      });
    } finally {
      await runtime.close();
    }
  });
});

describe("dispatcher deadline and grant enforcement", () => {
  it("returns retryable not-started timeout for a queued write and rejects forged callers before dispatch", async () => {
    const { createDispatcher } = await import("../src/executor/dispatch.js");
    vi.useFakeTimers();
    let signalEntered!: () => void;
    const entered = new Promise<void>((resolve) => { signalEntered = resolve; });
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            authenticated: true,
            user: { id: grant.userId, displayName: "Alice" },
          }),
        ),
    );
    const runtime: WorkspaceContentRuntime = {
      executeAndCommit: vi.fn<WorkspaceContentRuntime["executeAndCommit"]>(
        async (input) =>
          await new Promise<never>((_resolve, reject) => {
            signalEntered();
            input.signal?.addEventListener(
              "abort",
              () => reject(workspaceError("workspace-runtime-not-started", "cancelled")),
              { once: true },
            );
          }),
      ),
      executeRead: vi.fn(),
      exportUnitData: vi.fn(),
      close: async () => {},
    };
    const handler = vi.spyOn(handlers, "content.execute").mockImplementation(async (ctx) => ({
      output: await ctx.runtime.executeAndCommit({
        code: "edit",
        target: {
          origin: "https://workspace.test",
          revision: 7,
          scope: { kind: "worktree", worktreeId: "wt" },
          unitId: "unit-1",
          unitType: "sheet",
        },
      }),
    }));
    try {
      const dispatch = createDispatcher(config(), runtime, pino({ level: "silent" }));
      const header = {
        v: 1 as const,
        op: "content.execute",
        requestId: "deadline",
        deadlineMs: 30,
        grant,
        input: { worktreeId: "wt", unitId: "unit-1", code: "edit" },
      };
      const pending = dispatch("content.execute", header, new Uint8Array());
      await entered;
      await vi.advanceTimersByTimeAsync(30);
      expect((await pending).header).toMatchObject({
        ok: false,
        error: {
          code: "workspace-executor-timeout",
          outcome: "timeout",
          detail: { retryable: true, started: false },
        },
        meta: { executor: "none" },
      });
      expect(
        (
          await dispatch(
            "content.execute",
            { ...header, grant: { ...grant, userId: "victim" } },
            new Uint8Array(),
          )
        ).header,
      ).toMatchObject({
        ok: false,
        error: { code: "workspace-authentication-required", outcome: "auth_error" },
      });
      expect(handler).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
      fetcher.mockRestore();
      handler.mockRestore();
    }
  });
});

it("never suggests repeating a write when an oversized RPC response cannot be decoded", async () => {
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () => new Response("x".repeat(100)));
  try {
    await expect(
      callExecutor(
        {
          router: new ExecutorRouter(["http://one.test"]),
          executorToken: token,
          grant,
          requestId: "large-wire",
          deadlineAt: Date.now() + 30_000,
        },
        {
          ...opSpecs["content.execute"],
          limits: { ...opSpecs["content.execute"].limits, responseBytes: 1 },
        },
        { input: { worktreeId: "wt", unitId: "unit", code: "edit" } },
      ),
    ).rejects.toMatchObject({
      wire: {
        code: "workspace-result-unknown",
        outcome: "tool_error",
        detail: { cause: "workspace-result-too-large", retryable: false },
      },
    });
  } finally {
    fetcher.mockRestore();
  }
});

it("declares the rerun policy for every executor operation", () => {
  expect(Object.fromEntries(Object.entries(opSpecs).map(([name, spec]) => [name, spec.rerun]))).toEqual({
    "htmlView.validate": ["auth"], "htmlView.create": ["auth"],
    "markdown.compile": [], "markdown.export": ["auth"],
    "typst.compile": [], "svg.compile": ["auth"],
    "exchange.import": [], "exchange.export": ["auth"],
    "content.execute": ["revision", "auth"], "content.inspect": ["auth", "revision"],
    "render.screenshot": ["auth", "revision"],
    "render.printPdf": ["auth", "revision"], "render.lint": ["auth", "revision"],
    "diagnostics.probe": [],
  });
});
