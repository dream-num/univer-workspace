/**
 * Cloudflare Worker Gateway Entry: Durable Object re-exports, D1 Control Plane, R2 Blobs, and WebSocket routing.
 */
import { ControlPlaneDb } from "./control-plane/db.ts";
import { initControlPlaneSchema, seedControlPlane } from "./control-plane/schema.ts";
import { handleControlPlaneRoutes, resolveGatewayContext } from "./control-plane/gateway.ts";
import { handleBlobRoutes, R2BlobStore } from "./integrations/r2-blob-store.ts";

// Re-export Durable Objects
export { DshHost, DshHost as ChatAgent } from "./project/dsh-host.ts";
export { WorkspaceDO } from "./project/workspace-do.ts";

export interface Env {
  ChatAgent: DurableObjectNamespace;
  WorkspaceDO: DurableObjectNamespace;
  DB: D1Database;
  BLOB_BUCKET?: R2Bucket;
  AI?: any;
  ASSETS?: Fetcher;
}

let dbBooted = false;

function applyCorsHeaders(request: Request, response: Response): Response {
  if (response.status === 101 || response.webSocket) return response;
  const origin = request.headers.get("Origin") || "*";
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, Range, If-None-Match, X-Requested-With");
  headers.set("Access-Control-Allow-Credentials", "true");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);
      const pathname = url.pathname;

      // 1. CORS Preflight
      if (request.method === "OPTIONS") {
        const origin = request.headers.get("Origin") || "*";
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, Range, If-None-Match, X-Requested-With",
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Max-Age": "86400"
          }
        });
      }

      // 2. Health & Diagnostic endpoints
      if (pathname === "/healthz") {
        return applyCorsHeaders(
          request,
          new Response(JSON.stringify({ status: "ok", edge: "cloudflare-workers", time: Date.now() }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          })
        );
      }

      // 3. Auto-seed D1 database on initial boot
      if (env.DB && !dbBooted) {
        try {
          await seedControlPlane(env.DB);
          dbBooted = true;
        } catch (err) {
          console.warn("D1 seed warning:", err);
        }
      }

      // 4. Space-Level Live Presence routed to WorkspaceDO
      const spaceLiveMatch = pathname.match(/^\/spaces\/([^/]+)\/live$/);
      if (spaceLiveMatch) {
        const spaceId = spaceLiveMatch[1];
        const id = env.WorkspaceDO.idFromName(spaceId);
        const stub = env.WorkspaceDO.get(id);
        const res = await stub.fetch(request);
        return applyCorsHeaders(request, res);
      }

      // 5. WebSocket Mux & Realtime endpoints routed to ChatAgent Durable Object
      if (
        pathname === "/api/remote.mux" ||
        pathname.startsWith("/agents/") ||
        pathname.startsWith("/universer-api/") ||
        pathname === "/api/health" ||
        pathname === "/api/status" ||
        pathname.startsWith("/api/actions/")
      ) {
        const id = env.ChatAgent.idFromName("univer_collab");
        const stub = env.ChatAgent.get(id);
        const res = await stub.fetch(request);
        return applyCorsHeaders(request, res);
      }

      // 6. Initialize D1 Control Plane and R2 Storage clients
      if (env.DB) {
        const cpDb = new ControlPlaneDb(env.DB);
        const gwCtx = await resolveGatewayContext(request, cpDb);
        const blobStore = new R2BlobStore(env.BLOB_BUCKET);

        // 6a. Blob routes (uploads, downloads, content streaming)
        if (pathname.startsWith("/api/blob-")) {
          const blobRes = await handleBlobRoutes(request, cpDb, blobStore, url, gwCtx.currentUser?.id);
          if (blobRes) return applyCorsHeaders(request, blobRes);
        }

        // 6b. Control plane REST routes (sessions, auth, spaces, nodes, resources, trash, worktrees)
        if (pathname.startsWith("/api/") || pathname.startsWith("/auth/")) {
          const cpRes = await handleControlPlaneRoutes(request, gwCtx, url);
          if (cpRes) return applyCorsHeaders(request, cpRes);
        }
      }

      // 7. API / Backend 404 guard - never fall through to SPA assets for API requests
      if (
        pathname.startsWith("/api/") ||
        pathname.startsWith("/auth/") ||
        pathname.startsWith("/universer-api/") ||
        pathname.startsWith("/agents/")
      ) {
        return applyCorsHeaders(
          request,
          new Response(JSON.stringify({ error: { message: `Not found: ${request.method} ${pathname}` } }), {
            status: 404,
            headers: { "Content-Type": "application/json; charset=utf-8" }
          })
        );
      }

      // 8. Static SPA assets served via Workers Static Assets (dist/public)
      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }

      return applyCorsHeaders(
        request,
        new Response("Univer Workspace Edge Microkernel Active", {
          status: 200,
          headers: { "Content-Type": "text/plain; charset=utf-8" }
        })
      );
    } catch (err: any) {
      console.error("Worker unhandled error:", err);
      return applyCorsHeaders(
        request,
        new Response(JSON.stringify({ error: err?.message || String(err), stack: err?.stack }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        })
      );
    }
  }
};
