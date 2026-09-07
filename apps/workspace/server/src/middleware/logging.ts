import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import pino from "pino";
import { pinoHttp } from "pino-http";
import type { Request, RequestHandler } from "express";

// Write structured JSON logs to stdout for collection by the deployment environment.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
});

// Reuse a valid caller request ID or generate a UUID, and return it in the
// response headers so callers can correlate a response with its logs.
export function createRequestLoggingMiddleware(
  requestLog: pino.Logger = logger
): RequestHandler {
  const middleware = pinoHttp({
    logger: requestLog,
    // Serialize Express metadata directly, using its parsed path.
    wrapSerializers: false,
    serializers: {
      req: (request: Request) => ({
        id: request.id,
        method: request.method,
        url: request.path,
      }),
      res: (response: ServerResponse) => ({ statusCode: response.statusCode }),
      err: (error: Error & { type?: string }) => {
        // JSON parser errors can carry input in body, message and stack.
        if (error.type === "entity.parse.failed") {
          return { type: error.name, message: "Invalid JSON request body" };
        }
        return { type: error.name, message: error.message, stack: error.stack };
      },
    },
    genReqId: (request, response) => {
      const incoming = request.headers["x-request-id"];
      const id =
        typeof incoming === "string" && /^[a-zA-Z0-9._-]{1,128}$/.test(incoming)
          ? incoming
          : randomUUID();
      response.setHeader("x-request-id", id);
      return id;
    },
    // Log request completion or failure with HTTP metadata and elapsed time.
    autoLogging: true,
  });
  return middleware as unknown as RequestHandler;
}

// Use the request-scoped logger to correlate error diagnostics with HTTP logs.
export function requestLogger(request: unknown): pino.Logger {
  const candidate = (request as { log?: pino.Logger }).log;
  return candidate ?? logger;
}
