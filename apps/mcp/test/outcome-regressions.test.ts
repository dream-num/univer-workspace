import {
  createWorkspaceContentRuntime,
  WorkspaceContentSource,
} from "@univerjs/univer-workspace-client-core";
import { pino } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDispatcher } from "../src/executor/dispatch.js";
import { grantCookie, resolveGrant } from "../src/executor/credentials.js";
import { mapRuntimeError } from "../src/executor/errors.js";
import { handlers } from "../src/executor/ops/index.js";
import { bindRuntime, reuseExecutorWorker, workerEnvironment } from "../src/executor/runtime.js";
import { createAuthenticator } from "../src/gateway/auth.js";
import { parseExecutorConfig } from "../src/shared/config-executor.js";
import { parseGatewayConfig } from "../src/shared/config.js";
import type { ExecutorGrant, RequestHeader } from "../src/shared/executor-protocol.js";
import { zeroCost, type OpMeta } from "../src/shared/usage.js";
import { testStagingDirectory } from "./staging-directory.js";

const config = parseExecutorConfig({
  WORKSPACE_ORIGIN: "https://workspace.test",
  WORKSPACE_TRANSPORT_URL: "https://transport.test",
  MCP_INTERNAL_TOKEN: "internal-token-".repeat(4),
});
const grant: ExecutorGrant = {
  kind: "session",
  userId: "alice",
  session: "dev-session",
  expiresAt: Date.now() + 600_000,
};
const target = {
  origin: config.WORKSPACE_ORIGIN,
  revision: 7,
  scope: { kind: "worktree" as const, worktreeId: "wt" },
  unitId: "unit-1",
  unitType: "sheet" as const,
};
const usage = (): OpMeta => ({ executor: "none", cost: { ...zeroCost } });
const sessionResponse = () =>
  Response.json({
    authenticated: true,
    user: { id: grant.userId, displayName: "Alice" },
  });
const header = (input: unknown, deadlineMs = 1000): RequestHeader => ({
  v: 1,
  op: "content.inspect",
  requestId: "outcome-test",
  deadlineMs,
  grant,
  input,
});
const runtimeWith = (fixture: string) =>
  createWorkspaceContentRuntime({
    resolveCredential: (_target, caller) => grantCookie(resolveGrant(caller?.grant)),
    resolveLicense: () => "license",
    reuseWorker: reuseExecutorWorker,
    workerEntry: new URL(`./fixtures/${fixture}`, import.meta.url),
    pool: { env: workerEnvironment, maxWorkers: 1, queue: { timeoutMs: 1000 } },
  });

afterEach(() => vi.restoreAllMocks());

describe("round-4 audit outcomes", () => {
  it("reuses a dev-passthrough worker after a cold call (S1)", async () => {
    const { authenticate } = createAuthenticator(
      parseGatewayConfig({
        WORKSPACE_ORIGIN: config.WORKSPACE_ORIGIN,
        MCP_STAGING_DIRECTORY: testStagingDirectory(),
        MCP_PUBLIC_URL: "https://mcp.test/mcp",
        MCP_DEV_SESSION_PASSTHROUGH: "1",
      }),
      pino({ level: "silent" }),
      fetch,
    );
    const runtime = runtimeWith("credential-worker.mjs");
    try {
      for (const executor of ["cold_start", "warm", "warm"]) {
        const before = Date.now();
        const authentication = await authenticate(grant.session, "dev-reuse");
        if (authentication === null) throw new Error("Missing dev authentication");
        expect(authentication.expiresAt).toBeGreaterThanOrEqual(before + 600_000);
        expect(authentication.expiresAt).toBeLessThanOrEqual(Date.now() + 600_000);
        const meta = usage();
        const result = await bindRuntime(
          runtime,
          {
            ...grant,
            session: authentication.session,
            expiresAt: authentication.expiresAt,
          },
          meta,
          new AbortController().signal,
        ).executeRead({ code: "credential", target });
        expect(result.value).toBe("workspace_session=dev-session");
        expect(meta.executor).toBe(executor);
      }
    } finally {
      await runtime.close();
    }
  });

  it.each([
    [
      "content.inspect",
      { scope: { kind: "worktree", worktreeId: "wt" }, unitId: "unit-1", target: "workbook" },
    ],
    ["diagnostics.probe", {}],
  ] as const)(
    "returns a retryable read timeout after HTTP abort for %s (S4)",
    async (op, input) => {
      const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
        if (new URL(String(url)).pathname === "/api/session") return sessionResponse();
        return await new Promise<never>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
            once: true,
          });
        });
      });
      const runtime = runtimeWith("credential-worker.mjs");
      try {
        const dispatch = createDispatcher(config, runtime, pino({ level: "silent" }));
        const result = await dispatch(op, { ...header(input, 50), op }, new Uint8Array());
        expect(result.header).toMatchObject({
          ok: false,
          error: {
            code: "workspace-executor-timeout",
            outcome: "timeout",
            detail: { retryable: true },
          },
        });
        expect(
          fetcher.mock.calls.some(([url]) => new URL(String(url)).pathname !== "/api/session"),
        ).toBe(true);
      } finally {
        await runtime.close();
      }
    },
  );

  it("lets a live request finish shared verification after the first request times out (S3)", async () => {
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let finishCheck!: (response: Response) => void;
    const checked = new Promise<Response>((resolve) => {
      finishCheck = resolve;
    });
    let verificationSignal: AbortSignal | null | undefined;
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
      verificationSignal = options?.signal;
      markStarted();
      return await Promise.race([
        checked,
        new Promise<never>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
            once: true,
          });
        }),
      ]);
    });
    const handler = vi.spyOn(handlers, "content.inspect").mockResolvedValue({
      output: { kind: "workbook", unitId: "unit-1" },
    });
    const runtime = runtimeWith("credential-worker.mjs");
    const input = { scope: { kind: "trunk" }, unitId: "unit-1", target: "workbook" };
    try {
      const dispatch = createDispatcher(config, runtime, pino({ level: "silent" }));
      const first = dispatch("content.inspect", header(input, 50), new Uint8Array());
      await started;
      const second = dispatch(
        "content.inspect",
        { ...header(input), requestId: "second" },
        new Uint8Array(),
      );
      const firstResult = await first;
      finishCheck(sessionResponse());
      const secondResult = await second;
      expect(firstResult.header).toMatchObject({
        ok: false,
        error: { code: "workspace-executor-timeout", outcome: "timeout" },
      });
      expect(verificationSignal?.aborted).toBe(false);
      expect(secondResult.header).toMatchObject({
        ok: true,
        output: { kind: "workbook", unitId: "unit-1" },
      });
      expect(handler).toHaveBeenCalledOnce();
      expect(fetcher).toHaveBeenCalledOnce();
      expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("x-request-id")).toBe(
        "outcome-test",
      );
      expect(String(fetcher.mock.calls[0]?.[0])).toBe("https://transport.test/api/session");
    } finally {
      finishCheck(sessionResponse());
      await runtime.close();
    }
  });

  it("logs generated inspection script failures as internal errors (S8)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => sessionResponse());
    vi.spyOn(WorkspaceContentSource.prototype, "resolveTrunkRuntimeTarget").mockResolvedValue({
      ...target,
      scope: { kind: "trunk" },
    });
    const logger = pino({ level: "silent" });
    const logged = vi.spyOn(logger, "error");
    const runtime = runtimeWith("script-worker.mjs");
    try {
      const dispatch = createDispatcher(config, runtime, logger);
      const result = await dispatch(
        "content.inspect",
        header({
          scope: { kind: "trunk" },
          unitId: "unit-1",
          target: "workbook",
        }),
        new Uint8Array(),
      );
      expect(result.header).toMatchObject({
        ok: false,
        error: { code: "workspace-internal-error", outcome: "internal_error" },
      });
      expect(logged).toHaveBeenCalledWith(
        { request_id: "outcome-test", op: "content.inspect", code: "workspace-internal-error" },
        "Executor operation failed",
      );
    } finally {
      await runtime.close();
    }
  });

  it.each([
    "HTTP_500",
    "workspace-result-unknown",
    "workspace-submit-retry-exhausted",
    "COLLABORATION_WORKER_OPEN_TIMEOUT",
    "WORKSPACE_RUNTIME_CONFLICT",
    "WORKSPACE_RUNTIME_PULL_REQUIRED",
    "WORKSPACE_RUNTIME_COMMIT_INVALID",
  ])("preserves commit certainty for %s (S9)", async (code) => {
    const definite = [
      "WORKSPACE_RUNTIME_CONFLICT",
      "WORKSPACE_RUNTIME_PULL_REQUIRED",
      "WORKSPACE_RUNTIME_COMMIT_INVALID",
    ].includes(code);
    const runtime = runtimeWith("script-worker.mjs");
    try {
      const bound = bindRuntime(runtime, grant, usage(), new AbortController().signal);
      const result = await bound
        .executeAndCommit({ target, code: `commit-coded:${code}` })
        .catch((error: unknown) => mapRuntimeError(error, "write"));
      expect(result).toMatchObject({
        code: definite ? code : "workspace-result-unknown",
        outcome: "tool_error",
        ...(definite ? {} : { detail: { cause: code, retryable: false } }),
      });
    } finally {
      await runtime.close();
    }
  });

  it("treats the audit worker's unrecognized commit status as an unknown write (S9)", async () => {
    const runtime = runtimeWith("script-worker.mjs");
    try {
      const result = await bindRuntime(runtime, grant, usage(), new AbortController().signal)
        .executeAndCommit({ target, code: "commit-invalid-status" })
        .catch((error: unknown) => mapRuntimeError(error, "write"));
      expect(result).toMatchObject({
        code: "workspace-result-unknown",
        detail: { cause: "COLLABORATION_WORKER_PROTOCOL_ERROR", retryable: false },
        outcome: "tool_error",
      });
    } finally {
      await runtime.close();
    }
  });
});
