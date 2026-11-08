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
    [false, "stale-403"],
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
            error: {
              code: "workspace-authentication-required",
              detail: { cause: { message: expect.any(String) } },
            },
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

  it.each([
    [false, 6],
    [true, 6],
    [false, 5],
    [true, 5],
  ] as const)(
    "reruns pre-script revision change once, repeated = %s, stale revision = %s",
    async (repeated, staleRevision) => {
      const instance = runtime();
      const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => identity());
      let calls = 0;
      const handler = vi.spyOn(handlers, "content.execute").mockImplementation(async (ctx) => {
        const result = await ctx.runtime.executeAndCommit({
          target: { ...target, revision: repeated || calls++ === 0 ? staleRevision : 7 },
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
                error: {
                  code:
                    staleRevision === 5
                      ? "workspace-runtime-target-stale"
                      : "workspace-result-mismatch",
                },
                meta: { cost: { committed_revisions: 0 } },
              }
            : {
                ok: true,
                output: { committed: true, revision: 8 },
                meta: { cost: { committed_revisions: 1 } },
              },
        );
        if (!(repeated && staleRevision === 5))
          expect(result.header.meta.cost.worker_cpu_ms).toBeGreaterThan(0);
      } finally {
        await instance.close();
        handler.mockRestore();
        fetcher.mockRestore();
      }
    },
  );

  it("never reruns an ambiguous 401 commit", async () => {
    const instance = runtime();
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => identity());
    const write = vi.spyOn(handlers, "content.execute").mockImplementation(async (ctx) => ({
      output: await ctx.runtime.executeAndCommit({ target, code: "ambiguous-auth" }),
    }));
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
    } finally {
      await instance.close();
      write.mockRestore();
      fetcher.mockRestore();
    }
  });

  it.each([
    [1, 6],
    [1, 5],
    [3, 6],
    [3, 5],
    [4, 6],
    [4, 5],
  ] as const)(
    "retries a read with %s revision changes, stale revision = %s",
    async (mismatches, staleRevision) => {
      const instance = runtime();
      const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => identity());
      let calls = 0;
      const read = vi.spyOn(handlers, "content.inspect").mockImplementation(async (ctx) => {
        await ctx.runtime.executeRead({
          target: { ...target, revision: calls++ < mismatches ? staleRevision : 7 },
          code: "read",
        });
        return { output: { kind: "workbook", unitId: target.unitId } };
      });
      try {
        const dispatch = createDispatcher(config, instance, pino({ level: "silent" }));
        const result = await dispatch(
          "content.inspect",
          header({ scope: target.scope, unitId: target.unitId, target: "workbook" }),
          new Uint8Array(),
        );
        expect(read).toHaveBeenCalledTimes(Math.min(mismatches + 1, 4));
        expect(result.header).toMatchObject(
          mismatches <= 3
            ? { ok: true, output: { kind: "workbook", unitId: target.unitId } }
            : {
                ok: false,
                error: {
                  code:
                    staleRevision === 5
                      ? "workspace-runtime-target-stale"
                      : "workspace-result-mismatch",
                },
              },
        );
        expect(await dispatch.metrics.metrics()).toContain(
          `mcp_executor_reruns_total{reason="revision"} ${Math.min(mismatches, 3)}`,
        );
      } finally {
        await instance.close();
        read.mockRestore();
        fetcher.mockRestore();
      }
    },
  );

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

  it.each(["rerun not declared", "deadline floor", "rerun already used"] as const)(
    "keeps a valid session signed in when a stale worker cannot rerun: %s",
    async (scenario) => {
      const instance = runtime();
      const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => identity());
      const probe = scenario === "rerun not declared";
      const name = probe ? "diagnostics.probe" : "content.inspect";
      if (scenario === "rerun already used") {
        const reject = async (input: { caller?: Parameters<typeof reuseExecutorWorker>[1] }) => {
          reuseExecutorWorker(
            { userId: grant.userId, grant: { ...grant, session: "stale" } },
            input.caller,
          );
          throw Object.assign(new Error("Collaboration HTTP request failed with status 401"), {
            code: "COLLABORATION_UNAVAILABLE",
          });
        };
        vi.spyOn(instance, "executeRead")
          .mockImplementationOnce(reject as never)
          .mockImplementationOnce(reject as never);
      }
      const read = async (ctx: Parameters<(typeof handlers)["content.inspect"]>[0]) =>
        (await ctx.runtime.executeRead({ target, code: "read" })).value;
      const handler = vi.spyOn(handlers, name).mockImplementation((async (
        ctx: Parameters<(typeof handlers)["content.inspect"]>[0],
      ) => {
        const credential = await read(ctx);
        return {
          output: probe
            ? { whoami: { id: "u", name: "u" }, ticket: true, websocket: true, transport: "t" }
            : { kind: "workbook", unitId: target.unitId, credential },
        };
      }) as never);
      try {
        const dispatch = createDispatcher(config, instance, pino({ level: "silent" }));
        const input = probe
          ? {}
          : { scope: target.scope, unitId: target.unitId, target: "workbook" };
        const call = (current: ExecutorGrant, deadlineMs = 20_000) =>
          dispatch(name, { ...header(input, current), op: name, deadlineMs }, new Uint8Array());
        if (scenario !== "rerun already used")
          expect((await call({ ...grant, session: "stale" })).header.ok).toBe(true);
        const result = await call(grant, scenario === "deadline floor" ? 4900 : 20_000);
        expect(result.header).toMatchObject({
          ok: false,
          error: {
            code: "workspace-executor-timeout",
            outcome: "timeout",
            detail: {
              retryable: true,
              started: false,
              cause: { code: "COLLABORATION_UNAVAILABLE" },
            },
          },
        });
        const metrics = await dispatch.metrics.metrics();
        if (scenario === "rerun already used")
          expect(metrics).toContain('mcp_executor_reruns_total{reason="auth"} 1');
        else expect(metrics).not.toContain('reason="auth"');
        expect((await call(grant)).header.ok).toBe(true);
      } finally {
        await instance.close();
        handler.mockRestore();
        fetcher.mockRestore();
      }
    },
  );

  it("passes a 403 from the caller's own session through without a rerun", async () => {
    const instance = runtime();
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => identity());
    const handler = vi.spyOn(handlers, "content.inspect").mockImplementation(async (ctx) => ({
      output: {
        kind: "workbook",
        unitId: target.unitId,
        credential: (await ctx.runtime.executeRead({ target, code: "read" })).value,
      },
    }));
    try {
      const dispatch = createDispatcher(config, instance, pino({ level: "silent" }));
      const input = { scope: target.scope, unitId: target.unitId, target: "workbook" };
      const own = { ...grant, session: "stale-403" };
      const call = () =>
        dispatch("content.inspect", header(input, own), new Uint8Array()).then((r) => r.header);
      expect(await call()).toMatchObject({ ok: true });
      expect(await call()).toMatchObject({
        ok: false,
        error: { code: "COLLABORATION_UNAVAILABLE", outcome: "tool_error" },
      });
      expect(handler).toHaveBeenCalledTimes(2);
    } finally {
      await instance.close();
      handler.mockRestore();
      fetcher.mockRestore();
    }
  });

  it("serializes content.execute per Unit and reports a queued timeout as not started", async () => {
    vi.useFakeTimers();
    const instance = runtime();
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => identity());
    let running = 0;
    let peak = 0;
    const started: string[] = [];
    const handler = vi.spyOn(handlers, "content.execute").mockImplementation(async (ctx) => {
      started.push(ctx.requestId);
      peak = Math.max(peak, ++running);
      await new Promise((resolve) => setTimeout(resolve, ctx.requestId === "slow" ? 400 : 50));
      running--;
      return { output: { committed: false, value: null } };
    });
    try {
      const dispatch = createDispatcher(config, instance, pino({ level: "silent" }));
      const call = (unitId: string, requestId: string, deadlineMs = 20_000) =>
        dispatch(
          "content.execute",
          { ...header({ worktreeId: "wt", unitId, code: "write" }), requestId, deadlineMs },
          new Uint8Array(),
        ).then((r) => r.header);
      const serial = Promise.all(["a", "b", "c"].map((id) => call("unit-1", id)));
      await vi.advanceTimersByTimeAsync(150);
      const same = await serial;
      expect(same.every((h) => h.ok)).toBe(true);
      expect(peak).toBe(1);
      expect(started).toEqual(["a", "b", "c"]);
      peak = 0;
      const parallel = Promise.all([call("unit-1", "x"), call("unit-2", "y")]);
      await vi.advanceTimersByTimeAsync(50);
      await parallel;
      expect(peak).toBe(2);
      started.length = 0;
      const waiting = Promise.all([
        call("unit-3", "slow"),
        call("unit-3", "queued", 100),
      ]);
      await vi.advanceTimersByTimeAsync(400);
      const [slow, queued] = await waiting;
      expect(slow.ok).toBe(true);
      expect(queued).toMatchObject({
        ok: false,
        error: { code: "workspace-executor-timeout", detail: { started: false, retryable: true } },
      });
      expect(started).toEqual(["slow"]);
    } finally {
      vi.useRealTimers();
      await instance.close();
      handler.mockRestore();
      fetcher.mockRestore();
    }
  });

  it.each(["same Unit", "different Unit", "different scope", "different user"] as const)(
    "queues inspect behind execute only for the same user, scope and Unit: %s",
    async (scenario) => {
      const instance = runtime();
      const fetcher = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async (_url, options) =>
          new Headers(options?.headers).get("cookie") === "workspace_session=other-user"
            ? Response.json({ authenticated: true, user: { id: "user-2", displayName: "Bob" } })
            : identity(),
        );
      let release = () => {};
      const held = new Promise<void>((resolve) => (release = resolve));
      let markEntered = () => {};
      const entered = new Promise<void>((resolve) => (markEntered = resolve));
      let committed = false;
      const write = vi.spyOn(handlers, "content.execute").mockImplementation(async () => {
        markEntered();
        await held;
        committed = true;
        return { output: { committed: true, revision: 8 } };
      });
      const read = vi
        .spyOn(handlers, "content.inspect")
        .mockImplementation(async (_ctx, input) => ({
          output: { kind: "workbook", unitId: input.unitId, committed },
        }));
      try {
        const dispatch = createDispatcher(config, instance, pino({ level: "silent" }));
        const pending = dispatch(
          "content.execute",
          header({ worktreeId: "wt", unitId: target.unitId, code: "write" }),
          new Uint8Array(),
        );
        await entered;
        const inspected = dispatch(
          "content.inspect",
          header(
            {
              scope: scenario === "different scope" ? { kind: "trunk" } : target.scope,
              unitId: scenario === "different Unit" ? "unit-2" : target.unitId,
              target: "workbook",
            },
            scenario === "different user"
              ? { ...grant, userId: "user-2", session: "other-user" }
              : grant,
          ),
          new Uint8Array(),
        );
        if (scenario === "same Unit") {
          await new Promise((resolve) => setImmediate(resolve));
          expect(read).not.toHaveBeenCalled();
        } else {
          expect((await inspected).header).toMatchObject({
            ok: true,
            output: { committed: false },
          });
        }
        release();
        expect((await pending).header.ok).toBe(true);
        expect((await inspected).header).toMatchObject({
          ok: true,
          output: { committed: scenario === "same Unit" },
        });
        expect(read).toHaveBeenCalledOnce();
      } finally {
        release();
        await instance.close();
        write.mockRestore();
        read.mockRestore();
        fetcher.mockRestore();
      }
    },
  );

  it("times out a queued inspect without starting it and lets the next read proceed", async () => {
    vi.useFakeTimers();
    const instance = runtime();
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => identity());
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    let markEntered = () => {};
    const entered = new Promise<void>((resolve) => (markEntered = resolve));
    const write = vi.spyOn(handlers, "content.execute").mockImplementation(async () => {
      markEntered();
      await held;
      return { output: { committed: true, revision: 8 } };
    });
    const read = vi.spyOn(handlers, "content.inspect").mockImplementation(async () => ({
      output: { kind: "workbook", unitId: target.unitId },
    }));
    try {
      const dispatch = createDispatcher(config, instance, pino({ level: "silent" }));
      const pending = dispatch(
        "content.execute",
        header({ worktreeId: "wt", unitId: target.unitId, code: "write" }),
        new Uint8Array(),
      );
      await entered;
      const inspectHeader = header({
        scope: target.scope,
        unitId: target.unitId,
        target: "workbook",
      });
      const timingOut = dispatch(
        "content.inspect",
        { ...inspectHeader, deadlineMs: 50 },
        new Uint8Array(),
      );
      await vi.advanceTimersByTimeAsync(50);
      const timedOut = await timingOut;
      expect(timedOut.header).toMatchObject({
        ok: false,
        error: { code: "workspace-executor-timeout", detail: { started: false, retryable: true } },
      });
      expect(read).not.toHaveBeenCalled();
      const next = dispatch("content.inspect", inspectHeader, new Uint8Array());
      release();
      expect((await pending).header.ok).toBe(true);
      expect((await next).header.ok).toBe(true);
      expect(read).toHaveBeenCalledOnce();
    } finally {
      release();
      vi.useRealTimers();
      await instance.close();
      write.mockRestore();
      read.mockRestore();
      fetcher.mockRestore();
    }
  });

  it("reports an execute deadline after leaving the Unit queue as an unknown result", async () => {
    vi.useFakeTimers();
    let signalEntered!: () => void;
    const entered = new Promise<void>((resolve) => { signalEntered = resolve; });
    const instance = runtime();
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => identity());
    const handler = vi.spyOn(handlers, "content.execute").mockImplementation(async (ctx) => {
      signalEntered();
      await new Promise<never>((_resolve, reject) => {
        ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason), { once: true });
      });
      return { output: { committed: false } };
    });
    try {
      const pending = createDispatcher(config, instance, pino({ level: "silent" }))(
        "content.execute",
        {
          ...header({ worktreeId: "wt", unitId: target.unitId, code: "write" }),
          deadlineMs: 100,
        },
        new Uint8Array(),
      );
      await entered;
      await vi.advanceTimersByTimeAsync(100);
      const result = await pending;
      expect(handler).toHaveBeenCalledOnce();
      expect(result.header).toMatchObject({
        ok: false,
        error: { code: "workspace-result-unknown", outcome: "timeout" },
      });
      if (!result.header.ok)
        expect(result.header.error.detail).not.toHaveProperty("started", false);
    } finally {
      vi.useRealTimers();
      await instance.close();
      handler.mockRestore();
      fetcher.mockRestore();
    }
  });

  it("recovers Markdown export from a stale worker without replaying Markdown creation", async () => {
    const instance = runtime();
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => identity());
    const exported = vi.spyOn(handlers, "markdown.export").mockImplementation(async (ctx) => {
      await ctx.runtime.executeRead({ target, code: "read" });
      return {
        output: {
          formatVersion: 1,
          unitId: target.unitId,
          blockIds: ["intro"],
          revision: 7,
          markdown: "Hello",
          sourceMap: [],
          diagnostics: [],
          assets: [],
        },
        bytes: new Uint8Array(),
      };
    });
    const created = vi.spyOn(handlers, "markdown.compile").mockImplementation(async (ctx) => {
      ctx.onCreateUnit?.();
      await ctx.runtime.executeRead({ target, code: "read" });
      return {
        output: { committed: true, targetUnitId: target.unitId, sourceMap: [], diagnostics: [] },
      };
    });
    try {
      const dispatch = createDispatcher(config, instance, pino({ level: "silent" }));
      const input = { worktreeId: "wt", unitId: target.unitId, sourceMap: [], blockIds: ["intro"] };
      const exportCall = (current: ExecutorGrant) =>
        dispatch("markdown.export", header(input, current), new Uint8Array());
      expect((await exportCall({ ...grant, session: "stale" })).header.ok).toBe(true);
      const compile = await dispatch(
        "markdown.compile",
        header({
          markdown: "Hello",
          apply: true,
          worktreeId: "wt",
          spaceId: "space",
        }),
        new Uint8Array(),
      );
      expect(compile.header).toMatchObject({
        ok: false,
        error: { code: "workspace-executor-timeout" },
      });
      expect(created).toHaveBeenCalledOnce();
      expect((await exportCall({ ...grant, session: "stale" })).header.ok).toBe(true);
      expect((await exportCall(grant)).header.ok).toBe(true);
      expect(exported).toHaveBeenCalledTimes(4);
    } finally {
      await instance.close();
      exported.mockRestore();
      created.mockRestore();
      fetcher.mockRestore();
    }
  });

  it.each(["compile-only", "before-write", "after-write"] as const)(
    "preserves Markdown %s deadline classification",
    async (scenario) => {
      vi.useFakeTimers();
      let signalEntered!: () => void;
      const entered = new Promise<void>((resolve) => { signalEntered = resolve; });
      const instance = runtime();
      const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => identity());
      const handler = vi.spyOn(handlers, "markdown.compile").mockImplementation(async (ctx) => {
        if (scenario === "after-write") ctx.onCreateUnit?.();
        signalEntered();
        await new Promise<never>((_resolve, reject) => {
          ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason), { once: true });
        });
        throw new Error("unreachable");
      });
      try {
        const input =
          scenario === "compile-only"
            ? { markdown: "Hello" }
            : { markdown: "Hello", apply: true, worktreeId: "wt", spaceId: "space" };
        const pending = createDispatcher(config, instance, pino({ level: "silent" }))(
          "markdown.compile",
          { ...header(input), deadlineMs: 50 },
          new Uint8Array(),
        );
        await entered;
        await vi.advanceTimersByTimeAsync(50);
        const result = await pending;
        expect(result.header).toMatchObject({
          ok: false,
          error:
            scenario === "after-write"
              ? { code: "workspace-result-unknown" }
              : { code: "workspace-executor-timeout", detail: { retryable: true, started: false } },
        });
        expect(handler).toHaveBeenCalledOnce();
      } finally {
        vi.useRealTimers();
        await instance.close();
        handler.mockRestore();
        fetcher.mockRestore();
      }
    },
  );

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

it("queues SVG apply behind execute while compile-only bypasses the Unit FIFO", async () => {
  const instance = runtime();
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => identity());
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  let entered = () => {};
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const order: string[] = [];
  const write = vi.spyOn(handlers, "content.execute").mockImplementation(async () => {
    entered(); await held; order.push("execute");
    return { output: { committed: true, revision: 8 } };
  });
  const svg = vi.spyOn(handlers, "svg.compile").mockImplementation(async (_ctx, input) => {
    order.push(input.apply ? "apply" : "compile");
    return { output: { code: "", lints: [], warnings: [], mode: "replace", textMeasure: "estimate", viewport: { width: 10, height: 10 } } };
  });
  try {
    const dispatch = createDispatcher(config, instance, pino({ level: "silent" }));
    const pending = dispatch("content.execute", header({ worktreeId: "wt", unitId: target.unitId, code: "write" }), new Uint8Array());
    await started;
    const input = { svg: "<svg/>", estimateTextSize: true, apply: true, page: 1, worktreeId: "wt", unitId: target.unitId };
    const applied = dispatch("svg.compile", header(input), new Uint8Array());
    expect((await dispatch("svg.compile", header({ svg: "<svg/>", estimateTextSize: true }), new Uint8Array())).header.ok).toBe(true);
    expect(order).toEqual(["compile"]);
    release();
    expect((await pending).header.ok).toBe(true);
    expect((await applied).header.ok).toBe(true);
    expect(order).toEqual(["compile", "execute", "apply"]);
  } finally {
    release(); await instance.close(); write.mockRestore(); svg.mockRestore(); fetcher.mockRestore();
  }
});

it("keeps a missing Sheet publish failure and pre-upload deadline out of result-unknown", async () => {
  const instance = runtime();
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => String(url).endsWith("/api/session") ? identity() : Response.json({ error: { code: "NOT_FOUND", message: "Sheet not found" } }, { status: 404 }));
  try {
    const dispatch = createDispatcher(config, instance, pino({ level: "silent" }));
    const input = { html: '<output data-univer-cell-text="missing:budget:B2"></output>', spaceId: "space", name: "View", idempotencyKey: "html-missing-123456" };
    expect((await dispatch("htmlView.create", header(input), new Uint8Array())).header).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    const handler = vi.spyOn(handlers, "htmlView.create").mockImplementation(async (ctx) => {
      await new Promise<never>((_resolve, reject) => ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason), { once: true }));
      throw new Error("unreachable");
    });
    try {
      expect((await dispatch("htmlView.create", { ...header(input), deadlineMs: 50 }, new Uint8Array())).header).toMatchObject({ ok: false, error: { code: "workspace-executor-timeout", detail: { retryable: true, started: false } } });
    } finally { handler.mockRestore(); }
  } finally { await instance.close(); fetcher.mockRestore(); }
});
