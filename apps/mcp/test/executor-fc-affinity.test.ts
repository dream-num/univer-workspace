import { once } from "node:events";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import {
  AFFINITY_HEADER,
  affinityKey,
  createAffinityTransport,
  createSessionAffinity,
  deriveSessionId,
  isValidAffinityHeaderName,
  isValidAffinityHeaderValue,
  MemoryEpochStore,
  type EpochStore,
} from "../src/executor-fc/index.js";
import {
  FC_DEFAULT_HOST,
  FC_DEFAULT_PORT,
  parseFcExecutorConfig,
} from "../src/executor-fc/executor.js";

const key = affinityKey({ userId: "user-1", scope: "worktree:wt-1", unitId: "unit-1" });
const endpoint = "https://executor.example";

interface RecordedCall {
  readonly url: string;
  readonly headers: Headers;
}

function recorder(handler: (call: RecordedCall, index: number) => Response | Promise<Response>) {
  const calls: RecordedCall[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = input instanceof URL ? input.href : typeof input === "string" ? input : input.url;
    const call = { url, headers: new Headers(init?.headers) };
    calls.push(call);
    return await handler(call, calls.length - 1);
  };
  return { fetcher, calls };
}

function transportFor(
  options: {
    fetcher?: typeof fetch;
    epochs?: EpochStore;
    headerName?: string;
    maxThrottleAttempts?: number;
    sleep?: (ms: number, signal: AbortSignal | undefined) => Promise<void>;
    retryOnSessionError?: (response: Response) => boolean | Promise<boolean>;
  } = {},
) {
  return createAffinityTransport({
    endpoint,
    epochs: options.epochs ?? new MemoryEpochStore(),
    random: () => 0.5,
    ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
    ...(options.headerName === undefined ? {} : { headerName: options.headerName }),
    ...(options.maxThrottleAttempts === undefined
      ? {}
      : { maxThrottleAttempts: options.maxThrottleAttempts }),
    ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
    ...(options.retryOnSessionError === undefined
      ? {}
      : { retryOnSessionError: options.retryOnSessionError }),
  });
}

describe("FC affinity key and header", () => {
  it("derives a header name and value that satisfy the FC HeaderField rules", () => {
    expect(isValidAffinityHeaderName(AFFINITY_HEADER)).toBe(true);
    expect(isValidAffinityHeaderName("abcd")).toBe(false);
    expect(isValidAffinityHeaderName("1-executor-key")).toBe(false);
    expect(isValidAffinityHeaderName("x-fc-executor-key")).toBe(false);

    const sessionId = deriveSessionId(key, 0);
    expect(sessionId).toMatch(/^k[0-9a-f]{32}$/u);
    expect(isValidAffinityHeaderValue(sessionId)).toBe(true);
    expect(isValidAffinityHeaderValue("unit:1")).toBe(false);
    expect(isValidAffinityHeaderValue("a".repeat(65))).toBe(false);
  });

  it("is deterministic across replicas and changes with the epoch", () => {
    expect(deriveSessionId(key, 7)).toBe(deriveSessionId(key, 7));
    expect(deriveSessionId(key, 7)).not.toBe(deriveSessionId(key, 8));
  });

  it("separates keys by user, scope and Unit and keeps a null Unit stable", () => {
    const base = { userId: "user-1", scope: "trunk" };
    expect(affinityKey({ ...base, unitId: null })).toBe("user-1\0trunk\0");
    expect(deriveSessionId(affinityKey({ ...base, unitId: null }), 0)).not.toBe(
      deriveSessionId(affinityKey({ ...base, unitId: "unit-1" }), 0),
    );
    expect(affinityKey({ ...base, unitId: "unit-1" })).not.toBe(
      affinityKey({ userId: "user-2", scope: "trunk", unitId: "unit-1" }),
    );
    // A scope-less operation (diagnostics.probe) routes to the empty-scope bucket, not an error.
    expect(affinityKey({ userId: "user-1", scope: "", unitId: null })).toBe("user-1\0\0");
    expect(() => affinityKey({ userId: "", scope: "trunk", unitId: null })).toThrow(/user ID/u);
  });
});

describe("epoch store", () => {
  it("starts at 0, increments atomically and stays per key", async () => {
    const epochs = new MemoryEpochStore();
    expect(await epochs.get(key)).toBe(0);
    const values = await Promise.all(
      Array.from({ length: 5 }, async () => await epochs.increment(key)),
    );
    expect([...values].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(await epochs.get(key)).toBe(5);
    expect(await epochs.get("other")).toBe(0);
  });

  it("bounds the map by evicting the least recently used key", async () => {
    const epochs = new MemoryEpochStore({ maxKeys: 2 });
    await epochs.increment("a");
    await epochs.increment("b");
    await epochs.increment("c");
    expect(await epochs.get("a")).toBe(0);
    await epochs.get("b");
    await epochs.increment("d");
    expect(await epochs.get("c")).toBe(0);
    expect(await epochs.get("b")).toBe(1);
  });
});

describe("session affinity", () => {
  it("coalesces concurrent renewals into one epoch increment", async () => {
    const base = new MemoryEpochStore();
    let increments = 0;
    const epochs: EpochStore = {
      get: async (name) => await base.get(name),
      increment: async (name) => {
        increments += 1;
        return await base.increment(name);
      },
    };
    const affinity = createSessionAffinity({ epochs });
    expect(await affinity.sessionId(key)).toBe(deriveSessionId(key, 0));
    const [first, second] = await Promise.all([affinity.renew(key), affinity.renew(key)]);
    expect(first).toEqual(second);
    expect(first).toEqual({ epoch: 1, sessionId: deriveSessionId(key, 1) });
    expect(increments).toBe(1);
    expect(await affinity.sessionId(key)).toBe(deriveSessionId(key, 1));
    expect(await affinity.epoch(key)).toBe(1);
  });
});

describe("affinity transport", () => {
  it("sends the derived Session ID on the affinity header and preserves caller headers", async () => {
    const { fetcher, calls } = recorder(() => new Response("{}", { status: 200 }));
    const transport = transportFor({ fetcher });
    const response = await transport.request({
      key,
      path: "/rpc/v1/content.inspect",
      init: { method: "POST", headers: { authorization: "Bearer executor" } },
    });
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${endpoint}/rpc/v1/content.inspect`);
    expect(calls[0]?.headers.get(AFFINITY_HEADER)).toBe(deriveSessionId(key, 0));
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer executor");
  });

  it("omits affinity for requests without a key and does not allocate an epoch", async () => {
    const epochs = new MemoryEpochStore();
    const { fetcher, calls } = recorder(() => new Response("{}", { status: 200 }));
    const transport = transportFor({ fetcher, epochs });
    await transport.request({ path: "/rpc/v1/capabilities", init: { method: "GET" } });
    expect(calls[0]?.headers.has(AFFINITY_HEADER)).toBe(false);
    expect(await epochs.get(key)).toBe(0);
  });

  it("renews the epoch and retries once on a platform Session 401", async () => {
    const epochs = new MemoryEpochStore();
    const { fetcher, calls } = recorder((_call, index) =>
      index === 0 ? new Response("Session not found", { status: 401 }) : new Response("{}"),
    );
    const transport = transportFor({ fetcher, epochs });
    const response = await transport.request({ key, path: "/rpc/v1/x", init: { method: "POST" } });
    expect(response.status).toBe(200);
    expect(calls.map((call) => call.headers.get(AFFINITY_HEADER))).toEqual([
      deriveSessionId(key, 0),
      deriveSessionId(key, 1),
    ]);
    expect(await epochs.get(key)).toBe(1);
  });

  it("does not renew on the executor's own workspace error 401", async () => {
    const epochs = new MemoryEpochStore();
    const body = JSON.stringify({
      error: { code: "workspace-executor-unauthorized", message: "no", detail: null },
    });
    const { fetcher, calls } = recorder(
      () => new Response(body, { status: 401, headers: { "content-type": "application/json" } }),
    );
    const transport = transportFor({ fetcher, epochs });
    const response = await transport.request({ key, path: "/rpc/v1/x", init: { method: "POST" } });
    expect(response.status).toBe(401);
    expect(calls).toHaveLength(1);
    expect(await epochs.get(key)).toBe(0);
  });

  it("returns the second 401 instead of renewing again", async () => {
    const epochs = new MemoryEpochStore();
    const { fetcher, calls } = recorder(() => new Response("gone", { status: 401 }));
    const transport = transportFor({ fetcher, epochs });
    const response = await transport.request({ key, path: "/rpc/v1/x", init: { method: "POST" } });
    expect(response.status).toBe(401);
    expect(calls).toHaveLength(2);
    expect(await epochs.get(key)).toBe(1);
  });

  it("does not retry a 400 for an invalid header value", async () => {
    const { fetcher, calls } = recorder(() => new Response("bad request", { status: 400 }));
    const transport = transportFor({ fetcher });
    const response = await transport.request({ key, path: "/rpc/v1/x", init: { method: "POST" } });
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(1);
  });

  it("backs off and retries 429 with the same Session ID", async () => {
    const sleeps: number[] = [];
    const { fetcher, calls } = recorder((_call, index) =>
      index < 2 ? new Response("throttled", { status: 429 }) : new Response("{}"),
    );
    const transport = transportFor({
      fetcher,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    const response = await transport.request({ key, path: "/rpc/v1/x", init: { method: "POST" } });
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([100, 200]);
    expect(new Set(calls.map((call) => call.headers.get(AFFINITY_HEADER))).size).toBe(1);
  });

  it("gives up on 429 after the attempt limit", async () => {
    const { fetcher, calls } = recorder(() => new Response("throttled", { status: 429 }));
    const transport = transportFor({ fetcher, maxThrottleAttempts: 1, sleep: async () => {} });
    const response = await transport.request({ key, path: "/rpc/v1/x", init: { method: "POST" } });
    expect(response.status).toBe(429);
    expect(calls).toHaveLength(2);
  });

  it("does not spend a backoff that would exceed the caller deadline", async () => {
    const { fetcher, calls } = recorder(() => new Response("throttled", { status: 429 }));
    const transport = transportFor({ fetcher, sleep: async () => {} });
    const response = await transport.request({
      key,
      path: "/rpc/v1/x",
      init: { method: "POST" },
      deadlineAt: Date.now() + 50,
    });
    expect(response.status).toBe(429);
    expect(calls).toHaveLength(1);
  });

  it("honours an explicit platform error predicate and a custom header name", async () => {
    const epochs = new MemoryEpochStore();
    const { fetcher, calls } = recorder((_call, index) =>
      index === 0
        ? new Response("expired", { status: 401, headers: { "x-fc-error": "session" } })
        : new Response("{}"),
    );
    const transport = transportFor({
      fetcher,
      epochs,
      headerName: "x-executor-route",
      retryOnSessionError: (response) => response.headers.get("x-fc-error") === "session",
    });
    expect(transport.headerName).toBe("x-executor-route");
    const response = await transport.request({ key, path: "/rpc/v1/x", init: { method: "POST" } });
    expect(response.status).toBe(200);
    expect(calls[1]?.headers.get("x-executor-route")).toBe(deriveSessionId(key, 1));
    expect(calls[1]?.headers.has(AFFINITY_HEADER)).toBe(false);
  });

  it("rejects a header name FC would refuse", () => {
    expect(() =>
      createAffinityTransport({
        endpoint,
        epochs: new MemoryEpochStore(),
        headerName: "x-fc-bad",
      }),
    ).toThrow(/header name/u);
  });

  it("carries the Session ID over a real HTTP call and renews after a platform 401", async () => {
    const seen: (string | undefined)[] = [];
    const server = createServer((request, response) => {
      const value = request.headers[AFFINITY_HEADER];
      seen.push(Array.isArray(value) ? value[0] : value);
      if (seen.length === 1) {
        response.writeHead(401, { "content-type": "text/plain" }).end("expired");
        return;
      }
      response.writeHead(200, { "content-type": "application/octet-stream" }).end("frame");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Expected a TCP address");
    try {
      const epochs = new MemoryEpochStore();
      const transport = createAffinityTransport({
        endpoint: `http://127.0.0.1:${address.port}`,
        epochs,
      });
      const response = await transport.request({
        key,
        path: "/rpc/v1/content.inspect",
        init: { method: "POST", body: new Uint8Array([1, 2, 3]) },
      });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("frame");
      expect(seen).toEqual([deriveSessionId(key, 0), deriveSessionId(key, 1)]);
    } finally {
      server.close();
      await once(server, "close");
    }
  });
});

describe("FC executor configuration", () => {
  const env = {
    WORKSPACE_ORIGIN: "https://workspace.example",
    MCP_EXECUTOR_TOKEN: "executor-token-".repeat(4),
    MCP_EXECUTOR_ALLOWED_USER_IDS: "workspace",
  };

  it("pins one worker and one conversion job and listens on the FC container address", () => {
    const config = parseFcExecutorConfig({
      ...env,
      EXECUTOR_MAX_WORKERS: "8",
      EXECUTOR_MAX_JOBS: "4",
    });
    expect(config.EXECUTOR_MAX_WORKERS).toBe(1);
    expect(config.EXECUTOR_MAX_JOBS).toBe(1);
    expect(config.HOST).toBe(FC_DEFAULT_HOST);
    expect(config.PORT).toBe(FC_DEFAULT_PORT);
    expect(config.MCP_EXECUTOR_CREDENTIALS).toBe("session");
  });

  it("reads MCP_FC_HOST and MCP_FC_PORT instead of HOST and PORT", () => {
    const config = parseFcExecutorConfig({
      ...env,
      HOST: "127.0.0.1",
      PORT: "3000",
      MCP_FC_HOST: "127.0.0.1",
      MCP_FC_PORT: "9100",
    });
    expect(config.HOST).toBe("127.0.0.1");
    expect(config.PORT).toBe(9100);
  });

  it("rejects an invalid container port", () => {
    expect(() => parseFcExecutorConfig({ ...env, MCP_FC_PORT: "nine" })).toThrow(/MCP_FC_PORT/u);
    expect(() => parseFcExecutorConfig({ ...env, MCP_FC_PORT: "70000" })).toThrow(/MCP_FC_PORT/u);
  });
});
