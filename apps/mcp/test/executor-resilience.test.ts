import { createWorkspaceContentRuntime } from "@univerjs/univer-workspace-client-core";
import { pino } from "pino";
import { Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createDispatcher } from "../src/executor/dispatch.js";
import { createGrantVerifier, grantCookie, resolveGrant } from "../src/executor/credentials.js";
import { handlers } from "../src/executor/ops/index.js";
import { reuseExecutorWorker, workerEnvironment } from "../src/executor/runtime.js";
import { parseExecutorConfig } from "../src/shared/config-executor.js";
import type { ExecutorGrant } from "../src/shared/executor-protocol.js";

const grant: ExecutorGrant = {
  kind: "session",
  userId: "user-1",
  session: "fresh",
  expiresAt: Date.now() + 600_000,
};
const target = {
  origin: "https://workspace.test",
  revision: 7,
  scope: { kind: "worktree" as const, worktreeId: "wt" },
  unitId: "unit-1",
  unitType: "sheet" as const,
};
const config = parseExecutorConfig({
  WORKSPACE_ORIGIN: target.origin,
  MCP_INTERNAL_TOKEN: "internal-token-".repeat(4),
});
function runtime() {
  return createWorkspaceContentRuntime({
    resolveCredential: (_target, caller) => grantCookie(resolveGrant(caller?.grant)),
    resolveLicense: () => "license",
    reuseWorker: reuseExecutorWorker,
    workerEntry: new URL("./fixtures/resilience-worker.mjs", import.meta.url),
    pool: { env: workerEnvironment },
  });
}
const identity = () =>
  Response.json({ authenticated: true, user: { id: grant.userId, displayName: "Alice" } });
const header = (input: object, current = grant) => ({
  v: 1 as const,
  op: "content.execute",
  requestId: "resilience",
  deadlineMs: 20_000,
  grant: current,
  input,
});

describe("executor reruns with a real worker", () => {
  it.each([
    [false, "stale"],
    [true, "stale"],
    [false, "script-stale"],
    [true, "script-stale"],
  ] as const)(
    "reruns stale grant only, current rejected = %s, worker = %s",
    async (sameGrant, session) => {
      const instance = runtime();
      let logs = "";
      const logger = pino(
        new Writable({
          write(chunk, _encoding, done) {
            logs += chunk;
            done();
          },
        }),
      );
      const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => identity());
      const handler = vi.spyOn(handlers, "content.inspect").mockImplementation(async (ctx) => ({
        output: {
          kind: "workbook",
          unitId: target.unitId,
          credential: (await ctx.runtime.executeRead({ target, code: "read" })).value,
        },
      }));
      try {
        const dispatch = createDispatcher(config, instance, logger);
        const input = { scope: target.scope, unitId: target.unitId, target: "workbook" };
        expect(
          (
            await dispatch(
              "content.inspect",
              header(input, { ...grant, session }),
              new Uint8Array(),
            )
          ).header.ok,
        ).toBe(true);
        const result = await dispatch(
          "content.inspect",
          header(input, sameGrant ? { ...grant, session } : grant),
          new Uint8Array(),
        );
        if (sameGrant) {
          expect(result.header).toMatchObject({
            ok: false,
            error: { code: "workspace-authentication-required" },
          });
          expect(logs).not.toContain('"reason":"auth"');
          expect(handler).toHaveBeenCalledTimes(2);
        } else {
          expect(result.header).toMatchObject({
            ok: true,
            output: { credential: "workspace_session=fresh" },
            meta: { executor: "cold_start" },
          });
          expect(logs.match(/"reason":"auth"/g)).toHaveLength(1);
          expect(await dispatch.metrics.metrics()).toContain(
            'mcp_executor_reruns_total{reason="auth"} 1',
          );
          expect(handler).toHaveBeenCalledTimes(3);
          const before = fetcher.mock.calls.length;
          await dispatch("content.inspect", header(input, { ...grant, session }), new Uint8Array());
          expect(fetcher.mock.calls.length).toBeGreaterThan(before);
        }
      } finally {
        await instance.close();
        handler.mockRestore();
        fetcher.mockRestore();
      }
    },
  );

  it.each([false, true])(
    "reruns pre-script revision mismatch once, repeated = %s",
    async (repeated) => {
      const instance = runtime();
      const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => identity());
      let calls = 0;
      const handler = vi.spyOn(handlers, "content.execute").mockImplementation(async (ctx) => {
        const result = await ctx.runtime.executeAndCommit({
          target: { ...target, revision: repeated || calls++ === 0 ? 6 : 7 },
          code: "write",
        });
        ctx.usage.cost.committed_revisions += result.committed ? 1 : 0;
        return { output: result };
      });
      try {
        const result = await createDispatcher(config, instance, pino({ level: "silent" }))(
          "content.execute",
          header({ worktreeId: "wt", unitId: target.unitId, code: "write" }),
          new Uint8Array(),
        );
        expect(handler).toHaveBeenCalledTimes(2);
        expect(result.header).toMatchObject(
          repeated
            ? {
                ok: false,
                error: { code: "workspace-result-mismatch" },
                meta: { cost: { committed_revisions: 0 } },
              }
            : {
                ok: true,
                output: { committed: true, revision: 8 },
                meta: { cost: { committed_revisions: 1 } },
              },
        );
        expect(result.header.meta.cost.worker_cpu_ms).toBeGreaterThan(0);
      } finally {
        await instance.close();
        handler.mockRestore();
        fetcher.mockRestore();
      }
    },
  );

  it("never reruns an ambiguous 401 commit or a read revision mismatch", async () => {
    const instance = runtime();
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => identity());
    const write = vi.spyOn(handlers, "content.execute").mockImplementation(async (ctx) => ({
      output: await ctx.runtime.executeAndCommit({ target, code: "ambiguous-auth" }),
    }));
    const read = vi.spyOn(handlers, "content.inspect").mockImplementation(async (ctx) => {
      await ctx.runtime.executeRead({ target: { ...target, revision: 6 }, code: "read" });
      return { output: { kind: "workbook", unitId: target.unitId } };
    });
    try {
      const dispatch = createDispatcher(config, instance, pino({ level: "silent" }));
      expect(
        (
          await dispatch(
            "content.execute",
            header({ worktreeId: "wt", unitId: target.unitId, code: "write" }),
            new Uint8Array(),
          )
        ).header,
      ).toMatchObject({ ok: false, error: { code: "workspace-result-unknown" } });
      expect(write).toHaveBeenCalledOnce();
      expect(
        (
          await dispatch(
            "content.inspect",
            header({ scope: target.scope, unitId: target.unitId, target: "workbook" }),
            new Uint8Array(),
          )
        ).header,
      ).toMatchObject({ ok: false, error: { code: "workspace-result-mismatch" } });
      expect(read).toHaveBeenCalledOnce();
    } finally {
      await instance.close();
      write.mockRestore();
      read.mockRestore();
      fetcher.mockRestore();
    }
  });

  it.each(["budget", "script"])("does not rerun a mismatch from %s", async (scenario) => {
    const instance = runtime();
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => identity());
    const handler = vi.spyOn(handlers, "content.execute").mockImplementation(async (ctx) => ({
      output: await ctx.runtime.executeAndCommit({
        target: { ...target, revision: scenario === "budget" ? 6 : 7 },
        code: "script-conflict",
      }),
    }));
    try {
      const dispatch = createDispatcher(config, instance, pino({ level: "silent" }));
      const result = await dispatch(
        "content.execute",
        {
          ...header({ worktreeId: "wt", unitId: target.unitId, code: "write" }),
          deadlineMs: scenario === "budget" ? 4900 : 20_000,
        },
        new Uint8Array(),
      );
      expect(result.header).toMatchObject({
        ok: false,
        error: { code: "workspace-result-mismatch" },
      });
      expect(handler).toHaveBeenCalledOnce();
      expect(await dispatch.metrics.metrics()).not.toContain('reason="revision"');
    } finally {
      await instance.close();
      handler.mockRestore();
      fetcher.mockRestore();
    }
  });

  it("evicts only the verifier entry for the rejected session", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => identity());
    const verify = createGrantVerifier(config, fetcher);
    const stale = { ...grant, session: "stale" };
    await verify(stale, "a");
    await verify(grant, "b");
    verify.invalidate(stale);
    await verify(grant, "c");
    expect(fetcher).toHaveBeenCalledTimes(2);
    await verify(stale, "d");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
