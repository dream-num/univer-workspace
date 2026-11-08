import { createServer } from "node:http";
import type { WorkspaceContentRuntime } from "@univerjs/univer-workspace-client-core";
import { pino, type Logger } from "pino";
import { createBearerCheck } from "../shared/bearer.js";
import type { ExecutorConfig } from "../shared/config-executor.js";
import {
  isOpName,
  opSpecs,
  requestHeaderSchema,
  type OpSpec,
} from "../shared/executor-protocol.js";
import { decodeFrame, encodeFrame, FRAME_CONTENT_TYPE } from "../shared/frame.js";
import { truncateCommittedExecute } from "../shared/execute-result.js";
import { credentialRedactions } from "../shared/logging.js";
import { createDispatcher } from "./dispatch.js";
import { createExecutorRuntime } from "./runtime.js";

export function createExecutor(
  config: ExecutorConfig,
  options: { runtime?: WorkspaceContentRuntime; logger?: Logger } = {},
) {
  const runtime = options.runtime ?? createExecutorRuntime(config);
  const logger = options.logger ?? pino({ level: config.LOG_LEVEL, redact: credentialRedactions });
  const dispatch = createDispatcher(config, runtime, logger);
  const authorized = createBearerCheck(config.MCP_INTERNAL_TOKEN);
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
      if (!authorized(request.headers.authorization ?? null)) {
        reject(401, "workspace-executor-unauthorized");
        return;
      }
      if (draining) {
        reject(503, "workspace-executor-unavailable");
        return;
      }
      const name = request.url?.slice("/rpc/v1/".length) ?? "";
      if (request.method !== "POST" || !request.url?.startsWith("/rpc/v1/") || !isOpName(name)) {
        reject(404, "workspace-executor-operation-unknown");
        return;
      }
      if (request.headers["x-mcp-rpc-version"] !== "1") {
        reject(426, "workspace-executor-version-mismatch");
        return;
      }
      if (request.headers["content-type"] !== FRAME_CONTENT_TYPE) {
        reject(415, "workspace-executor-frame-invalid");
        return;
      }
      const spec: OpSpec = opSpecs[name];
      const limits = spec.limits;
      if (Number(request.headers["content-length"]) > limits.requestBytes) {
        reject(413, "workspace-request-too-large");
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > limits.requestBytes) {
          reject(413, "workspace-request-too-large");
          return;
        }
        chunks.push(bytes);
      }
      let header;
      let payload: Uint8Array;
      try {
        const frame = decodeFrame(Buffer.concat(chunks));
        const parsed = requestHeaderSchema.safeParse(frame.header);
        if (!parsed.success) {
          reject(
            parsed.error.issues.some((issue) => issue.path[0] === "v") ? 426 : 400,
            parsed.error.issues.some((issue) => issue.path[0] === "v")
              ? "workspace-executor-version-mismatch"
              : "workspace-executor-frame-invalid",
          );
          return;
        }
        header = parsed.data;
        payload = frame.payload;
        if (header.op !== name || (spec.payload !== "request" && frame.payload.length !== 0))
          throw new Error("Unexpected operation or payload");
      } catch {
        reject(400, "workspace-executor-frame-invalid");
        return;
      }
      const result = await dispatch(name, header, payload);
      let frame = encodeFrame(result.header, result.payload);
      if (frame.length > limits.responseBytes) {
        const output =
          name === "content.execute" && result.header.ok
            ? truncateCommittedExecute(result.header.output)
            : undefined;
        frame = encodeFrame(
          output
            ? { ok: true, output, meta: result.header.meta }
            : {
                ok: false,
                meta: result.header.meta,
                error: {
                  code: "workspace-result-too-large",
                  message: "Narrow the request; the executor result exceeds its byte limit.",
                  detail: null,
                  outcome: "tool_error",
                },
              },
        );
      }
      response.writeHead(200, { "content-type": FRAME_CONTENT_TYPE }).end(frame);
      logger.info({ request_id: header.requestId, op: name }, "Executor request completed");
    })().catch(() => {
      if (!response.headersSent) reject(500, "workspace-internal-error");
      else response.destroy();
    });
  });
  return {
    server,
    async close() {
      draining = true;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await runtime.close();
    },
  };
}
