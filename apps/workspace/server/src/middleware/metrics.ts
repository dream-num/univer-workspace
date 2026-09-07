import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { NodeHttpTransportMiddleware } from "@univerjs-pro/collaboration-transport-node";
import client from "prom-client";
import type { RequestHandler } from "express";

// Fixed histogram buckets keep memory usage proportional to label combinations.
export const httpRequestDurationSeconds = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.01, 0.05, 0.1, 0.3, 1, 3, 10, 30],
});

// SDK middleware claims requests when they enter Transport. Express then leaves
// their HTTP metrics to the SDK, including requests rejected before SDK routing.
const sdkRequests = new WeakSet<IncomingMessage>();

export function createMetricsMiddleware(): RequestHandler {
  return (request, response, next) => {
    const end = httpRequestDurationSeconds.startTimer();
    response.once("finish", () => {
      if (sdkRequests.has(request)) return;
      const route = request.route?.path;
      end({
        method: request.method,
        route: typeof route === "string" ? route : "unmatched",
        status_code: response.statusCode,
      });
    });
    next();
  };
}

export function createCollaborationMetricsMiddleware(): NodeHttpTransportMiddleware {
  return (context, next) => {
    sdkRequests.add(context.incomingMessage);
    const end = httpRequestDurationSeconds.startTimer();
    context.response.once("finish", () => {
      end({
        method: context.incomingMessage.method ?? "UNKNOWN",
        route: context.route?.path ?? "unmatched",
        status_code: context.response.statusCode,
      });
    });
    return next();
  };
}

export function createMetricsHandler(token?: string): RequestHandler {
  const expected = token ? createHash("sha256").update(`Bearer ${token}`).digest() : null;
  return async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (!expected) {
      response.sendStatus(404);
      return;
    }
    const actual = createHash("sha256")
      .update(request.headers.authorization ?? "")
      .digest();
    if (!timingSafeEqual(actual, expected)) {
      response.setHeader("WWW-Authenticate", "Bearer");
      response.sendStatus(401);
      return;
    }
    response
      .set("Content-Type", client.register.contentType)
      .send(await client.register.metrics());
  };
}
