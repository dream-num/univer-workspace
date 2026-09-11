/**
 * WorkspaceDO — Cloudflare Durable Object for Space-Level Realtime Coordination and Presence.
 * Sharded by space ID (`spaceId`).
 */
import { DurableObject } from "cloudflare:workers";

export interface WorkspaceUserPresence {
  userId: string;
  userName: string;
  avatarUrl?: string | null;
  activeNodeId?: string | null;
  lastSeenAt: number;
}

export class WorkspaceDO extends DurableObject<any> {
  private presences = new Map<WebSocket, WorkspaceUserPresence>();

  constructor(ctx: DurableObjectState, env: any) {
    super(ctx, env);
    this.initSql();
  }

  private initSql(): void {
    try {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS space_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
    } catch (err) {
      console.warn("WorkspaceDO SQL init warning:", err);
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // 1. WebSocket Upgrade for Realtime Space Presence
    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      this.ctx.acceptWebSocket(server, ["space-presence"]);

      return new Response(null, {
        status: 101,
        webSocket: client
      });
    }

    // 2. HTTP: Active Collaborators Presence in Space
    if (url.pathname === "/presence" && request.method === "GET") {
      const activeUsers = this.getActivePresences();
      return new Response(JSON.stringify({ activeUsers }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // 3. HTTP: Broadcast tree update to connected clients
    if (url.pathname === "/broadcast" && request.method === "POST") {
      const body = await request.json();
      this.broadcast(body);
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response("WorkspaceDO active", { status: 200 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;

    try {
      const data = JSON.parse(message);

      if (data.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
        return;
      }

      if (data.type === "presence.update") {
        const presence: WorkspaceUserPresence = {
          userId: data.user?.id || "anonymous",
          userName: data.user?.displayName || data.user?.name || "Anonymous",
          avatarUrl: data.user?.avatarUrl,
          activeNodeId: data.activeNodeId ?? null,
          lastSeenAt: Date.now()
        };
        this.presences.set(ws, presence);
        this.broadcastPresence();
        return;
      }

      if (data.type === "tree.mutation") {
        // Broadcast tree changes to all other peers in the space
        this.broadcast(data, ws);
      }
    } catch (err) {
      console.error("WorkspaceDO webSocketMessage error:", err);
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.presences.delete(ws);
    this.broadcastPresence();
  }

  private getActivePresences(): WorkspaceUserPresence[] {
    const unique = new Map<string, WorkspaceUserPresence>();
    for (const p of this.presences.values()) {
      unique.set(p.userId, p);
    }
    return Array.from(unique.values());
  }

  private broadcastPresence(): void {
    const activeUsers = this.getActivePresences();
    this.broadcast({
      type: "space.presence",
      activeUsers
    });
  }

  private broadcast(payload: unknown, excludeWs?: WebSocket): void {
    const sockets = this.ctx.getWebSockets("space-presence");
    const msg = JSON.stringify(payload);
    for (const s of sockets) {
      if (s !== excludeWs) {
        try {
          s.send(msg);
        } catch {
          // Socket might be dead
        }
      }
    }
  }
}
