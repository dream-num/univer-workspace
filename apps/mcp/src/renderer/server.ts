import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createUniverRenderRuntime } from "@univer-cli/univer-render-runtime";
import { pino, type Logger } from "pino";
import { Counter, Gauge, Registry } from "prom-client";
import { UNIVER_LICENSE } from "../executor/license.js";
import { createBearerCheck } from "../shared/bearer.js";
import type { RendererConfig } from "../shared/config-renderer.js";
import { decodeFrame, encodeFrame, FRAME_CONTENT_TYPE } from "../shared/frame.js";
import { credentialRedactions, safeErrorFields } from "../shared/logging.js";
import {
  isRendererOpName,
  rendererOpSpecs,
  rendererRequestHeaderSchema,
  type RendererOpName,
  type RendererRequestHeader,
} from "../shared/renderer-protocol.js";
import { zeroCost, type OpMeta } from "../shared/usage.js";
import { mapRendererError } from "./errors.js";
import { runOp, type RenderRuntime } from "./ops.js";
import { RuntimePool } from "./pool.js";

const renderPageRoot = fileURLToPath(new URL("../render-runtime", import.meta.url));

export function createRenderer(
  config: RendererConfig,
  options: { createRuntime?: () => Promise<RenderRuntime>; logger?: Logger } = {},
) {
  const logger = options.logger ?? pino({ level: config.LOG_LEVEL, redact: credentialRedactions });
  const metrics = new Registry();
  const jobs = new Counter({
    name: "mcp_renderer_jobs_total",
    help: "Renderer operations by kind and outcome.",
    labelNames: ["kind", "outcome"],
    registers: [metrics],
  });
  const creations = new Counter({
    name: "mcp_renderer_runtime_creations_total",
    help: "Render runtimes (one browser each) launched.",
    registers: [metrics],
  });
  const discards = new Counter({
    name: "mcp_renderer_runtime_discards_total",
    help: "Render runtimes closed after a timeout or runtime failure.",
    registers: [metrics],
  });
  const pool = new RuntimePool<RenderRuntime>({
    create:
      options.createRuntime ??
      (() =>
        createUniverRenderRuntime({
          renderPageRoot,
          license: config.UNIVER_LICENSE ?? UNIVER_LICENSE,
        })),
    max: config.RENDERER_MAX_RUNTIMES,
    queueTimeoutMs: config.RENDERER_QUEUE_TIMEOUT_MS,
    operationTimeoutMs: config.RENDERER_OPERATION_TIMEOUT_MS,
    onCreate: () => creations.inc(),
    onDiscard: () => discards.inc(),
  });
  new Gauge({
    name: "mcp_renderer_runtimes",
    help: "Live render runtimes by state.",
    labelNames: ["state"],
    registers: [metrics],
    collect() {
      this.set({ state: "idle" }, pool.stats.idle);
      this.set({ state: "busy" }, pool.stats.busy);
    },
  });
  const authorized = createBearerCheck(config.MCP_RENDERER_TOKEN);
  const metricsAuthorized = config.METRICS_TOKEN ? createBearerCheck(config.METRICS_TOKEN) : null;

  async function dispatch(name: RendererOpName, header: RendererRequestHeader) {
    const spec = rendererOpSpecs[name];
    const started = Date.now();
    try {
      const input = spec.input.parse(header.input);
      const { value, cold } = await pool.run(
        (runtime, signal) => runOp(name, runtime, input, signal),
        AbortSignal.timeout(header.deadlineMs),
      );
      const meta: OpMeta = {
        executor: cold ? "cold_start" : "warm",
        cost: { ...zeroCost, render_pages: value.renderPages },
      };
      jobs.inc({ kind: name, outcome: "ok" });
      logger.info(
        {
          request_id: header.requestId,
          op: name,
          runtime_cold: cold,
          duration_ms: Date.now() - started,
        },
        "Renderer request completed",
      );
      return {
        header: { ok: true as const, output: spec.output.parse(value.output), meta },
        payload: value.bytes,
      };
    } catch (error) {
      const wire = mapRendererError(error);
      jobs.inc({ kind: name, outcome: wire.outcome });
      if (wire.outcome === "internal_error")
        logger.error(
          { request_id: header.requestId, op: name, code: wire.code, ...safeErrorFields(error) },
          "Renderer operation failed",
        );
      return {
        header: {
          ok: false as const,
          error: wire,
          meta: { executor: "none" as const, cost: { ...zeroCost } },
        },
        payload: undefined,
      };
    }
  }

  let draining = false;
  const server = createServer((request, response) => {
    const reject = (status: number, code: string) => {
      response
        .writeHead(status, { "content-type": "application/json" })
        .end(JSON.stringify({ error: { code, message: code, detail: null } }));
    };
    void (async () => {
      if (request.method === "GET" && request.url === "/healthz") {
        response.end("ok");
        return;
      }
      if (request.method === "GET" && request.url === "/metrics") {
        if (!metricsAuthorized) response.writeHead(404).end("Not found");
        else if (!metricsAuthorized(request.headers.authorization ?? null))
          response.writeHead(401).end("Unauthorized");
        else
          response
            .writeHead(200, { "content-type": metrics.contentType })
            .end(await metrics.metrics());
        return;
      }
      if (!authorized(request.headers.authorization ?? null)) {
        reject(401, "workspace-renderer-unauthorized");
        return;
      }
      if (draining) {
        reject(503, "workspace-renderer-unavailable");
        return;
      }
      const name = request.url?.slice("/rpc/v1/".length) ?? "";
      if (
        request.method !== "POST" ||
        !request.url?.startsWith("/rpc/v1/") ||
        !isRendererOpName(name)
      ) {
        reject(404, "workspace-renderer-operation-unknown");
        return;
      }
      if (request.headers["x-mcp-rpc-version"] !== "1") {
        reject(426, "workspace-renderer-version-mismatch");
        return;
      }
      if (request.headers["content-type"] !== FRAME_CONTENT_TYPE) {
        reject(415, "workspace-renderer-frame-invalid");
        return;
      }
      const limits = rendererOpSpecs[name].limits;
      if (Number(request.headers["content-length"]) > limits.requestBytes) {
        reject(413, "workspace-request-too-large");
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > limits.requestBytes) {
          reject(413, "workspace-request-too-large");
          return;
        }
        chunks.push(bytes);
      }
      let header: RendererRequestHeader;
      try {
        const frame = decodeFrame(Buffer.concat(chunks));
        const parsed = rendererRequestHeaderSchema.safeParse(frame.header);
        if (!parsed.success) {
          const version = parsed.error.issues.some((issue) => issue.path[0] === "v");
          reject(
            version ? 426 : 400,
            version ? "workspace-renderer-version-mismatch" : "workspace-renderer-frame-invalid",
          );
          return;
        }
        header = parsed.data;
        if (header.op !== name || frame.payload.length !== 0)
          throw new Error("Unexpected operation or payload");
      } catch {
        reject(400, "workspace-renderer-frame-invalid");
        return;
      }
      const result = await dispatch(name, header);
      let frame = encodeFrame(result.header, result.payload);
      if (frame.length > limits.responseBytes)
        frame = encodeFrame({
          ok: false,
          meta: result.header.meta,
          error: {
            code: "workspace-result-too-large",
            message: "Narrow the request; the renderer result exceeds its byte limit.",
            detail: null,
            outcome: "tool_error",
          },
        });
      response.writeHead(200, { "content-type": FRAME_CONTENT_TYPE }).end(frame);
    })().catch(() => {
      if (!response.headersSent) reject(500, "workspace-internal-error");
      else response.destroy();
    });
  });
  return {
    server,
    // The first measureText call has a short budget; launching one browser before traffic keeps it
    // from paying the Chromium start. A failure here only means the first request starts it instead.
    async warm() {
      await pool
        .run(() => Promise.resolve())
        .then(
          () => logger.info("Renderer runtime warmed"),
          (error: unknown) =>
            logger.warn({ ...safeErrorFields(error) }, "Renderer warm-up failed"),
        );
    },
    async close() {
      draining = true;
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections();
      });
      await pool.close();
    },
  };
}
