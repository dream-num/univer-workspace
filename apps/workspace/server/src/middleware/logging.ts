import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import type pino from "pino";
import { pinoHttp } from "pino-http";
import type { Request, RequestHandler } from "express";
import { logger } from "../logging/logger.js";

// Claim codes are secrets, and the handoff page carries one in its path. The
// router also reaches it through doubled slashes and percent escapes. Decoding
// one escape at a time cannot throw on a malformed sequence.
function isClaimPath(path: string): boolean {
  const decoded = path.replace(/%([0-9a-f]{2})/giu, (_escape, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16))
  );
  return /^\/+claim\/./isu.test(decoded);
}

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
        url: isClaimPath(request.path) ? "/claim/:code" : request.path,
      }),
      res: (response: ServerResponse) => ({ statusCode: response.statusCode }),
      err: (error: Error) => ({ type: error.name, message: error.message, stack: error.stack }),
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
