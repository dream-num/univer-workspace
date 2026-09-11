/**
 * ChatAgent Durable Object (DshHost) — Cloudflare Durable Object hosting Cordis Microkernel.
 * Manages Hibernatable WebSockets, 4-Channel Mux Protocol, OT Collaboration, and Reversible Agent Actions.
 */
import { HostBase } from "./host/host-base.ts";
import type { UniverCollabService } from "../plugins/univer-collab.ts";
import type { ActionService } from "../kernel/action.ts";

export class DshHost extends HostBase<any> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // 1. WebSocket Upgrade handling for /api/remote.mux or /universer-api/websocket
    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      const tags = ["mux"];
      const unitId = url.searchParams.get("unitId") || url.searchParams.get("docId");
      if (unitId) tags.push(`unit:${unitId}`);

      this.acceptWebSocket(server, tags);

      // Notify kernel of connection
      try {
        const kernel = await this.ensureKernel();
        await kernel.emit("client/connect", { ws: server, tags });
      } catch (err) {
        console.error("Failed to notify kernel of connect:", err);
      }

      return new Response(null, {
        status: 101,
        webSocket: client
      });
    }

    // 2. Health & Diagnostic endpoint
    if (url.pathname === "/api/health" || url.pathname === "/api/status") {
      try {
        const kernel = await this.ensureKernel();
        return new Response(
          JSON.stringify({
            status: "healthy",
            durableObject: (this.ctx as any).id?.toString(),
            name: (this.ctx as any).id?.name ?? "default",
            timestamp: Date.now()
          }),
          {
            headers: { "Content-Type": "application/json" }
          }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({
            status: "degraded",
            error: err instanceof Error ? err.message : String(err)
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" }
          }
        );
      }
    }

    // 3. Univer Collaboration & Protocol Endpoints (/universer-api/*)
    if (url.pathname.startsWith("/universer-api/")) {
      const kernel = await this.ensureKernel();
      const collab = kernel.get("collab") as UniverCollabService | undefined;

      // GET /universer-api/user
      if (url.pathname === "/universer-api/user" && request.method === "GET") {
        return new Response(
          JSON.stringify({
            error: { code: 0, message: "" },
            user: {
              id: "user_admin",
              name: "Administrator",
              avatar: ""
            }
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      }

      // POST /universer-api/authz/-/object/-/batch_allowed
      if (url.pathname === "/universer-api/authz/-/object/-/batch_allowed" && request.method === "POST") {
        const body = (await request.json().catch(() => ({}))) as any;
        const requests = Array.isArray(body.requests) ? body.requests : [];
        return new Response(
          JSON.stringify({
            error: { code: 0, message: "" },
            objectActions: requests.map(() => [1, 2, 3, 4])
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      }

      // POST /universer-api/authz/:objectType/object/:objectId/allowed
      if (url.pathname.includes("/allowed") && request.method === "POST") {
        return new Response(
          JSON.stringify({
            error: { code: 0, message: "" },
            actions: [1, 2, 3, 4]
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      }

      // GET /universer-api/collab/snapshot
      if (request.method === "GET" && url.pathname === "/universer-api/collab/snapshot") {
        if (!collab) return new Response(JSON.stringify({ error: "Collab service unavailable" }), { status: 503 });
        const unitId = url.searchParams.get("unitId") || "default";
        const snapshot = collab.getLatestSnapshot(unitId);
        return new Response(JSON.stringify(snapshot ?? {}), {
          headers: { "Content-Type": "application/json" }
        });
      }

      // POST /universer-api/collab/snapshot
      if (request.method === "POST" && url.pathname === "/universer-api/collab/snapshot") {
        if (!collab) return new Response(JSON.stringify({ error: "Collab service unavailable" }), { status: 503 });
        const body = (await request.json()) as any;
        const unitId = body.unitId || url.searchParams.get("unitId") || "default";
        collab.saveSnapshot(unitId, body.rev || 0, body.data || body);
        return new Response(JSON.stringify({ success: true, rev: body.rev || 0 }), {
          headers: { "Content-Type": "application/json" }
        });
      }

      // POST /universer-api/collab/changeset
      if (request.method === "POST" && url.pathname === "/universer-api/collab/changeset") {
        if (!collab) return new Response(JSON.stringify({ error: "Collab service unavailable" }), { status: 503 });
        const body = (await request.json()) as any;
        const unitId = body.unitId || url.searchParams.get("unitId") || "default";
        const result = collab.applyChangeset(body);
        this.broadcast(
          { channel: 1, type: "collab.changeset", payload: body },
          `unit:${unitId}`
        );
        return new Response(JSON.stringify(result), {
          headers: { "Content-Type": "application/json" }
        });
      }

      // GET /universer-api/collab/changesets
      if (request.method === "GET" && url.pathname === "/universer-api/collab/changesets") {
        if (!collab) return new Response(JSON.stringify({ error: "Collab service unavailable" }), { status: 503 });
        const unitId = url.searchParams.get("unitId") || "default";
        const since = parseInt(url.searchParams.get("since") || "0", 10);
        const changesets = collab.getChangesetsSince(unitId, since);
        return new Response(JSON.stringify({ changesets }), {
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    // 4. Universal Action Execution Endpoints
    if (url.pathname === "/api/actions/list" && request.method === "GET") {
      const kernel = await this.ensureKernel();
      const actionService = kernel.get("action") as ActionService | undefined;
      return new Response(JSON.stringify({ actions: actionService?.listActions() ?? [] }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    if (url.pathname === "/api/actions/execute" && request.method === "POST") {
      const kernel = await this.ensureKernel();
      const actionService = kernel.get("action") as ActionService | undefined;
      if (!actionService) {
        return new Response(JSON.stringify({ error: "Action service unavailable" }), { status: 503 });
      }
      try {
        const body = (await request.json()) as any;
        const result = await actionService.execute(body.actionId, body.input, body.meta ?? {});
        return new Response(JSON.stringify({ success: true, result }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), { status: 400 });
      }
    }

    return new Response("Not found", { status: 404 });
  }

  /**
   * Hibernation WebSocket message handler with 4-Channel Multiplexing.
   */
  async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer | ArrayBufferView
  ): Promise<void> {
    try {
      const kernel = await this.ensureKernel();
      let parsed: any;
      if (typeof message === "string") {
        try {
          parsed = JSON.parse(message);
        } catch {
          parsed = { raw: message };
        }
      }

      // Fast-path ping/pong
      if (parsed?.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
        return;
      }

      // Channel 0: Control & Host RPC
      if (parsed?.channel === 0 || !parsed?.channel) {
        if (parsed?.type === "session.init") {
          ws.send(
            JSON.stringify({
              channel: 0,
              type: "session.init",
              sessionId: (this.ctx as any).id?.toString(),
              timestamp: Date.now()
            })
          );
          return;
        }

        if (parsed?.type === "client-request") {
          const actionService = kernel.get("action") as ActionService | undefined;
          if (parsed.method === "actions.list") {
            ws.send(
              JSON.stringify({
                channel: 0,
                id: parsed.id,
                result: actionService?.listActions() ?? []
              })
            );
            return;
          }
          if (parsed.method === "actions.execute" && actionService) {
            try {
              const res = await actionService.execute(parsed.params.actionId, parsed.params.input, parsed.params.meta);
              ws.send(JSON.stringify({ channel: 0, id: parsed.id, result: res }));
            } catch (err: any) {
              ws.send(JSON.stringify({ channel: 0, id: parsed.id, error: err.message }));
            }
            return;
          }
        }
      }

      // Channel 1: Univer OT Collab Changeset dispatch
      if (parsed?.channel === 1) {
        const collab = kernel.get("collab") as UniverCollabService | undefined;
        if (collab && parsed.type === "collab.submitChangeset" && parsed.payload) {
          const res = collab.applyChangeset(parsed.payload);
          const unitTag = `unit:${parsed.payload.unitId}`;
          const sockets = this.ctx.getWebSockets(unitTag);
          const broadcastMsg = JSON.stringify({
            channel: 1,
            type: "collab.changeset",
            payload: parsed.payload
          });
          for (const s of sockets) {
            if (s !== ws) {
              try { s.send(broadcastMsg); } catch {}
            }
          }
          ws.send(JSON.stringify({ channel: 1, id: parsed.id, result: res }));
          return;
        }

        if (parsed.type === "collab.cursorSync" && parsed.payload) {
          const unitTag = `unit:${parsed.payload.unitId}`;
          const sockets = this.ctx.getWebSockets(unitTag);
          const msg = JSON.stringify({
            channel: 1,
            type: "collab.cursorSync",
            payload: parsed.payload
          });
          for (const s of sockets) {
            if (s !== ws) {
              try { s.send(msg); } catch {}
            }
          }
          return;
        }
      }

      // Channel 2: Agent Streaming
      if (parsed?.channel === 2) {
        if (parsed.type === "agent.prompt") {
          ws.send(JSON.stringify({
            channel: 2,
            type: "agent.thought",
            content: "Analyzing workspace state and executing requested action..."
          }));
          return;
        }
      }

      // Channel 3: AST CRDT Co-Editing
      if (parsed?.channel === 3 && parsed.payload) {
        if (this.sql) {
          try {
            this.sql.exec(
              `INSERT INTO ast_crdt_journal (id, node_path, operation, payload, inverse_payload, lamport_clock, applied_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              `ast_${crypto.randomUUID()}`,
              parsed.payload.nodePath || "",
              parsed.payload.operation || "replace",
              JSON.stringify(parsed.payload),
              JSON.stringify(parsed.payload.inverse || {}),
              Date.now(),
              Date.now()
            );
          } catch {}
        }
        // Broadcast to peers
        const sockets = this.ctx.getWebSockets("mux");
        const msg = JSON.stringify({ channel: 3, type: "ast.mutation", payload: parsed.payload });
        for (const s of sockets) {
          if (s !== ws) {
            try { s.send(msg); } catch {}
          }
        }
        return;
      }

      // Dispatch general event to Cordis context
      await kernel.emit("websocket/message", { ws, message: parsed ?? message });
    } catch (err) {
      console.error("Error processing webSocketMessage in DshHost:", err);
    }
  }

  /**
   * Hibernation WebSocket close handler.
   */
  async webSocketClose(
    ws: WebSocket,
    code?: number,
    reason?: string,
    wasClean?: boolean
  ): Promise<void> {
    try {
      if (this.kernel) {
        await this.kernel.emit("websocket/close", { ws, code, reason, wasClean });
      }
    } catch (err) {
      console.error("Error handling webSocketClose:", err);
    }
  }
}

export { DshHost as ChatAgent };
