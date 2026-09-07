import { once } from "node:events";
import { IncomingMessage, ServerResponse, type IncomingHttpHeaders, type RequestListener } from "node:http";
import { Duplex } from "node:stream";
import express from "express";
import { createNodeTransport } from "@univerjs-pro/collaboration-transport-node";
import pino from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../server/src/config.js";
import { createRequestLoggingMiddleware, requestLogger } from "../../server/src/middleware/logging.js";
import {
  createCollaborationMetricsMiddleware,
  createMetricsHandler,
  createMetricsMiddleware,
  httpRequestDurationSeconds,
} from "../../server/src/middleware/metrics.js";

// Exercise real Express and HTTP response lifecycles without binding a port.
async function request(app: RequestListener, url: string, headers: IncomingHttpHeaders = {}) {
  let output = "";
  const socket = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });
  const incoming = new IncomingMessage(socket);
  incoming.method = "GET";
  incoming.url = url;
  incoming.headers = headers;
  const response = new ServerResponse(incoming);
  response.assignSocket(socket);
  try {
    const finished = once(response, "finish");
    app(incoming, response);
    await finished;
    return { status: response.statusCode, headers: response.getHeaders(), output };
  } finally {
    socket.destroy();
  }
}

describe("HTTP observation boundaries", () => {
  beforeEach(() => httpRequestDurationSeconds.reset());

  it("keeps credentials out of completion and request-scoped error logs", async () => {
    let output = "";
    const log = pino({ level: "info" }, { write: (line) => { output += line; } });
    const app = express();
    app.use(createRequestLoggingMiddleware(log));
    app.get("/callback", (req, res) => {
      requestLogger(req).error({ err: new Error("synthetic failure") }, "callback failed");
      res.setHeader("Set-Cookie", "session=response-secret");
      res.redirect("/done?code=redirect-secret");
    });
    const result = await request(app, "/callback?code=oauth-secret&ticket=ticket-secret", {
      cookie: "session=cookie-secret",
      authorization: "Bearer authorization-secret",
      "x-api-key": "api-key-secret",
      "x-request-id": "request-1",
    });
    expect(result.headers["x-request-id"]).toBe("request-1");
    for (const secret of ["response-secret", "redirect-secret", "oauth-secret", "ticket-secret", "cookie-secret", "authorization-secret", "api-key-secret"]) {
      expect(output).not.toContain(secret);
    }
    const lines = output.trim().split("\n").map((line) => JSON.parse(line));
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line.req).toEqual({ id: "request-1", method: "GET", url: "/callback" });
    }
    expect(lines[1].res).toEqual({ statusCode: 302 });
    expect(lines[1].responseTime).toBeTypeOf("number");
  });

  it("filters request data carried by JSON parser errors", async () => {
    let output = "";
    const log = pino({ level: "info" }, { write: (line) => { output += line; } });
    const app = express();
    app.use(createRequestLoggingMiddleware(log));
    app.get("/parser-error", (req, res) => {
      const error = Object.assign(new SyntaxError("Invalid JSON containing secret-input"), {
        type: "entity.parse.failed",
        body: '{"password":"secret-input"}',
      });
      requestLogger(req).error({ err: error }, "unhandled request error");
      res.sendStatus(500);
    });
    await request(app, "/parser-error");
    expect(output).not.toContain("secret-input");
    const diagnostic = output.trim().split("\n").map((line) => JSON.parse(line))
      .find((line) => line.msg === "unhandled request error");
    expect(diagnostic.err).toEqual({ type: "SyntaxError", message: "Invalid JSON request body" });
    expect(diagnostic.req.id).toBeTypeOf("string");
  });

  it("replaces an invalid request ID", async () => {
    const app = express();
    app.use(createRequestLoggingMiddleware(pino({ level: "silent" })));
    app.get("/", (_req, res) => res.end());
    const result = await request(app, "/", { "x-request-id": "x".repeat(129) });
    expect(result.headers["x-request-id"]).toMatch(/^[a-f0-9-]{36}$/);
  });

  it("uses Express route templates for success and asynchronous errors", async () => {
    const app = express();
    app.use(createMetricsMiddleware());
    const router = express.Router();
    router.get("/nodes/:id", async (req, res) => {
      if (req.params.id === "fail") throw new Error("synthetic failure");
      res.end();
    });
    app.use("/api", router);
    const auth = express.Router();
    auth.get("/authorize", async () => { throw new Error("synthetic failure"); });
    app.use("/api/auth", auth);
    app.use(((error, _req, res, _next) => res.status(500).end()) as express.ErrorRequestHandler);
    await request(app, "/api/nodes/ok");
    await request(app, "/api/nodes/fail");
    await request(app, "/api/auth/authorize");
    const counts = (await httpRequestDurationSeconds.get()).values.filter((value) => value.metricName.endsWith("_count"));
    expect(counts.map((value) => value.labels)).toEqual([
      { method: "GET", route: "/nodes/:id", status_code: 200 },
      { method: "GET", route: "/nodes/:id", status_code: 500 },
      { method: "GET", route: "/authorize", status_code: 500 },
    ]);
  });

  it.each([true, false])("records SDK requests once (through Express: %s)", async (throughExpress) => {
    const app = express();
    app.use(createMetricsMiddleware());
    const transport = createNodeTransport();
    transport.use(createCollaborationMetricsMiddleware());
    transport.register({
      register(router) {
        router.get("/universer-api/units/:unitId", async (context) => {
          if (context.params.unitId === "fail") throw new Error("synthetic failure");
          await new Promise<void>((resolve) => setImmediate(resolve));
          context.response.end("ok");
        });
      },
    });
    app.use("/universer-api", (req, res) => {
      req.url = req.originalUrl;
      transport.handleRequest(req, res);
    });
    const handle: RequestListener = throughExpress
      ? app
      : (req, res) => transport.handleRequest(req, res);
    try {
      expect((await request(handle, "/universer-api/units/first?ticket=ignored")).status).toBe(200);
      expect((await request(handle, "/universer-api/units/second")).status).toBe(200);
      expect((await request(handle, "/universer-api/units/fail")).status).toBe(500);
      const counts = (await httpRequestDurationSeconds.get()).values.filter((value) => value.metricName.endsWith("_count"));
      expect(counts).toHaveLength(2);
      expect(counts).toEqual(expect.arrayContaining([
        expect.objectContaining({ value: 2, labels: { method: "GET", route: "/universer-api/units/:unitId", status_code: 200 } }),
        expect.objectContaining({ value: 1, labels: { method: "GET", route: "/universer-api/units/:unitId", status_code: 500 } }),
      ]));
    } finally {
      await transport.dispose();
    }
  });

  it("groups unknown SDK paths and pre-routing rejections as unmatched", async () => {
    const app = express();
    app.use(createMetricsMiddleware());
    const transport = createNodeTransport();
    transport.use(createCollaborationMetricsMiddleware());
    transport.use((context, next) => {
      if (context.incomingMessage.headers["x-deny"]) {
        context.response.statusCode = 401;
        context.response.end();
        return;
      }
      return next();
    });
    transport.register({
      register(router) {
        router.get("/universer-api/units/:unitId", (context) => { context.response.end(); });
      },
    });
    app.use("/universer-api", (req, res) => {
      req.url = req.originalUrl;
      transport.handleRequest(req, res);
    });
    try {
      for (let i = 0; i < 30; i++) {
        expect((await request(app, `/universer-api/comb/type-${i}/unit/id-${i}/suffix-${i}`)).status).toBe(404);
      }
      expect((await request(app, "/universer-api/units/private", { "x-deny": "true" })).status).toBe(401);
      const counts = (await httpRequestDurationSeconds.get()).values.filter((value) => value.metricName.endsWith("_count"));
      expect(counts).toHaveLength(2);
      expect(counts).toEqual(expect.arrayContaining([
        expect.objectContaining({ value: 30, labels: { method: "GET", route: "unmatched", status_code: 404 } }),
        expect.objectContaining({ value: 1, labels: { method: "GET", route: "unmatched", status_code: 401 } }),
      ]));
    } finally {
      await transport.dispose();
    }
  });

  it("keeps Express routes and rejections under the SDK prefix in Express metrics", async () => {
    const app = express();
    app.use(createMetricsMiddleware());
    const transport = createNodeTransport();
    transport.use(createCollaborationMetricsMiddleware());
    transport.register({
      register(router) {
        router.get("/universer-api/units/:unitId", (context) => { context.response.end(); });
      },
    });
    const router = express.Router();
    router.use((req, res, next) => {
      if (req.headers["x-deny"]) { res.sendStatus(401); return; }
      next();
    });
    router.get("/user", (_req, res) => res.end());
    router.use((req, res) => {
      req.url = req.originalUrl;
      transport.handleRequest(req, res);
    });
    app.use("/universer-api", router);
    try {
      await request(app, "/universer-api/user");
      await request(app, "/universer-api/units/private", { "x-deny": "true" });
      const counts = (await httpRequestDurationSeconds.get()).values.filter((value) => value.metricName.endsWith("_count"));
      expect(counts).toHaveLength(2);
      expect(counts).toEqual(expect.arrayContaining([
        expect.objectContaining({ value: 1, labels: { method: "GET", route: "/user", status_code: 200 } }),
        expect.objectContaining({ value: 1, labels: { method: "GET", route: "unmatched", status_code: 401 } }),
      ]));
    } finally {
      await transport.dispose();
    }
  });

  it("disables scraping by default and requires the dedicated bearer token", async () => {
    const token = "test-scrape-token-0123456789abcdef";
    const disabled = express();
    disabled.get("/metrics", createMetricsHandler());
    expect((await request(disabled, "/metrics")).status).toBe(404);
    const enabled = express();
    enabled.use(createMetricsMiddleware());
    enabled.get("/metrics", createMetricsHandler(token));
    for (const headers of [{}, { authorization: "Bearer wrong-token" }, { cookie: `workspace_session=${token}` }]) {
      const response = await request(enabled, "/metrics", headers);
      expect(response.status).toBe(401);
      expect(response.output).not.toContain("http_request_duration_seconds");
    }
    const response = await request(enabled, "/metrics", { authorization: `Bearer ${token}` });
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain;");
    expect(response.headers["content-type"]).toContain("version=0.0.4");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.output).toContain("http_request_duration_seconds");
    const families = [...response.output.matchAll(/# TYPE (\S+) /g)].map((match) => match[1]);
    expect(families).toEqual(["http_request_duration_seconds"]);
  });

  it("validates scrape configuration without making monitoring mandatory", () => {
    expect(loadConfig({}).metricsToken).toBeUndefined();
    expect(() => loadConfig({ METRICS_TOKEN: "short" })).toThrow("at least 32");
    expect(() => loadConfig({ METRICS_TOKEN: " ".repeat(32) })).toThrow("Bearer token");
    const token = "0123456789abcdef".repeat(4);
    expect(loadConfig({ METRICS_TOKEN: token }).metricsToken).toBe(token);
  });
});
