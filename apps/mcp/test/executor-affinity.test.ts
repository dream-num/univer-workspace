import { once } from "node:events";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { MemoryEpochStore, type EpochStore } from "../src/gateway/executor/affinity/epoch-store.js";
import {
  createSessionAffinity,
  deriveSessionId,
} from "../src/gateway/executor/affinity/session.js";
import { createAffinityTransport } from "../src/gateway/executor/affinity/transport.js";
import { AFFINITY_HEADER } from "../src/shared/executor-protocol.js";

const key = "user-1\0worktree:wt-1\0unit-1";
const url = "https://executor.example";

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
    maxThrottleAttempts?: number;
    sleep?: (ms: number, signal: AbortSignal | undefined) => Promise<void>;
    retryOnSessionError?: (response: Response) => boolean | Promise<boolean>;
  } = {},
) {
  return createAffinityTransport({
    epochs: options.epochs ?? new MemoryEpochStore(),
    random: () => 0.5,
    ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
    ...(options.maxThrottleAttempts === undefined
      ? {}
      : { maxThrottleAttempts: options.maxThrottleAttempts }),
    ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
    ...(options.retryOnSessionError === undefined
      ? {}
      : { retryOnSessionError: options.retryOnSessionError }),
  });
}

describe("affinity Session ID", () => {
  it("fits the FC HeaderField value rules, is deterministic and changes with the epoch", () => {
    // FC accepts 1-64 characters, a letter first, then letters, digits, `_` and `-`.
    expect(deriveSessionId(key, 0)).toMatch(/^k[0-9a-f]{32}$/u);
    expect(deriveSessionId(key, 7)).toBe(deriveSessionId(key, 7));
    expect(deriveSessionId(key, 7)).not.toBe(deriveSessionId(key, 8));
    expect(() => deriveSessionId(key, -1)).toThrow(/non-negative/u);
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
    const affinity = createSessionAffinity(epochs);
    expect(await affinity.sessionId(key)).toBe(deriveSessionId(key, 0));
    const [first, second] = await Promise.all([affinity.renew(key), affinity.renew(key)]);
    expect(first).toEqual(second);
    expect(first).toEqual({ epoch: 1, sessionId: deriveSessionId(key, 1) });
    expect(increments).toBe(1);
    expect(await affinity.sessionId(key)).toBe(deriveSessionId(key, 1));
  });
});

describe("affinity transport", () => {
  it("sends the derived Session ID on the affinity header and preserves caller headers", async () => {
    const { fetcher, calls } = recorder(() => new Response("{}", { status: 200 }));
    const transport = transportFor({ fetcher });
    const response = await transport.request({
      url,
      key,
      path: "/rpc/v1/content.inspect",
      init: { method: "POST", headers: { authorization: "Bearer executor" } },
    });
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${url}/rpc/v1/content.inspect`);
    expect(calls[0]?.headers.get(AFFINITY_HEADER)).toBe(deriveSessionId(key, 0));
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer executor");
  });

  it("renews the epoch and retries once on a platform Session 401", async () => {
    const epochs = new MemoryEpochStore();
    const { fetcher, calls } = recorder((_call, index) =>
      index === 0 ? new Response("Session not found", { status: 401 }) : new Response("{}"),
    );
    const transport = transportFor({ fetcher, epochs });
    const response = await transport.request({
      url,
      key,
      path: "/rpc/v1/x",
      init: { method: "POST" },
    });
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
    const response = await transport.request({
      url,
      key,
      path: "/rpc/v1/x",
      init: { method: "POST" },
    });
    expect(response.status).toBe(401);
    expect(calls).toHaveLength(1);
    expect(await epochs.get(key)).toBe(0);
  });

  it("returns the second 401 instead of renewing again", async () => {
    const epochs = new MemoryEpochStore();
    const { fetcher, calls } = recorder(() => new Response("gone", { status: 401 }));
    const transport = transportFor({ fetcher, epochs });
    const response = await transport.request({
      url,
      key,
      path: "/rpc/v1/x",
      init: { method: "POST" },
    });
    expect(response.status).toBe(401);
    expect(calls).toHaveLength(2);
    expect(await epochs.get(key)).toBe(1);
  });

  it("does not retry a 400 for an invalid header value", async () => {
    const { fetcher, calls } = recorder(() => new Response("bad request", { status: 400 }));
    const transport = transportFor({ fetcher });
    const response = await transport.request({
      url,
      key,
      path: "/rpc/v1/x",
      init: { method: "POST" },
    });
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
    const response = await transport.request({
      url,
      key,
      path: "/rpc/v1/x",
      init: { method: "POST" },
    });
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([100, 200]);
    expect(new Set(calls.map((call) => call.headers.get(AFFINITY_HEADER))).size).toBe(1);
  });

  it("gives up on 429 after the attempt limit", async () => {
    const { fetcher, calls } = recorder(() => new Response("throttled", { status: 429 }));
    const transport = transportFor({ fetcher, maxThrottleAttempts: 1, sleep: async () => {} });
    const response = await transport.request({
      url,
      key,
      path: "/rpc/v1/x",
      init: { method: "POST" },
    });
    expect(response.status).toBe(429);
    expect(calls).toHaveLength(2);
  });

  it("reports a backoff cut short by the call deadline as not run", async () => {
    const { fetcher, calls } = recorder(() => new Response("throttled", { status: 429 }));
    // The real sleep, so the request's own timeout signal is what ends the wait.
    const transport = createAffinityTransport({ epochs: new MemoryEpochStore(), fetcher });
    await expect(
      transport.request({
        url,
        key,
        path: "/rpc/v1/x",
        init: { method: "POST", signal: AbortSignal.timeout(20) },
      }),
    ).rejects.toMatchObject({
      wire: {
        code: "workspace-executor-unavailable",
        detail: { cause: "throttled", retryable: true },
      },
    });
    expect(calls).toHaveLength(1);
  });

  it("reports any epoch store failure as not run, before or after a send", async () => {
    // A connected Redis that later times out throws plain errors, not a store-specific type.
    const failing: EpochStore = {
      get: async () => {
        throw new Error("Command timed out");
      },
      increment: async () => 1,
    };
    const { fetcher, calls } = recorder(() => new Response("{}"));
    await expect(
      transportFor({ fetcher, epochs: failing }).request({
        url,
        key,
        path: "/rpc/v1/x",
        init: { method: "POST" },
      }),
    ).rejects.toMatchObject({
      wire: { code: "workspace-executor-unavailable", detail: { cause: "epoch-store" } },
    });
    expect(calls).toHaveLength(0);

    const renewFails: EpochStore = {
      get: async () => 0,
      increment: async () => {
        throw new Error("Reached the max retries per request limit");
      },
    };
    const expired = recorder(() => new Response("expired", { status: 401 }));
    await expect(
      transportFor({ fetcher: expired.fetcher, epochs: renewFails }).request({
        url,
        key,
        path: "/rpc/v1/x",
        init: { method: "POST" },
      }),
    ).rejects.toMatchObject({ wire: { detail: { cause: "epoch-store" } } });
    expect(expired.calls).toHaveLength(1);
  });

  it("honours an explicit platform error predicate", async () => {
    const epochs = new MemoryEpochStore();
    const { fetcher, calls } = recorder((_call, index) =>
      index === 0
        ? new Response("expired", { status: 401, headers: { "x-fc-error": "session" } })
        : new Response("{}"),
    );
    const transport = transportFor({
      fetcher,
      epochs,
      retryOnSessionError: (response) => response.headers.get("x-fc-error") === "session",
    });
    const response = await transport.request({
      url,
      key,
      path: "/rpc/v1/x",
      init: { method: "POST" },
    });
    expect(response.status).toBe(200);
    expect(calls[1]?.headers.get(AFFINITY_HEADER)).toBe(deriveSessionId(key, 1));
  });

  it("logs each attempt at debug and a renewal at info", async () => {
    const events: Record<string, unknown>[] = [];
    const record = (level: string) => (fields: object) => {
      events.push({ ...(fields as Record<string, unknown>), level });
    };
    const logger = { debug: record("debug"), info: record("info") };
    const { fetcher } = recorder((_call, index) =>
      index === 0 ? new Response("expired", { status: 401 }) : new Response("{}"),
    );
    const transport = createAffinityTransport({ epochs: new MemoryEpochStore(), fetcher, logger });
    await transport.request({ url, key, path: "/rpc/v1/x", init: { method: "POST" } });
    const sent = events.filter((entry) => entry["event"] === "mcp.executor_request");
    expect(sent).toHaveLength(2);
    expect(sent.every((entry) => entry["level"] === "debug")).toBe(true);
    expect(sent.map((entry) => entry[AFFINITY_HEADER])).toEqual([
      deriveSessionId(key, 0),
      deriveSessionId(key, 1),
    ]);
    const renewed = events.filter((entry) => entry["event"] === "mcp.executor_session_renewed");
    expect(renewed).toHaveLength(1);
    expect(renewed[0]?.["level"]).toBe("info");
    expect(renewed[0]?.[AFFINITY_HEADER]).toBe(deriveSessionId(key, 1));
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
      const transport = createAffinityTransport({ epochs });
      const response = await transport.request({
        url: `http://127.0.0.1:${address.port}`,
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
