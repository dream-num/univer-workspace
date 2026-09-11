/**
 * ChatAgent Durable Object (DshHost) — Cloudflare Durable Object hosting Cordis Microkernel.
 * Manages Hibernatable WebSockets, 4-Channel Mux Protocol, Official Univer OT Collaboration Protocol,
 * and Reversible Agent Actions.
 */
import { HostBase } from "./host/host-base.ts";
import type { UniverCollabService } from "../plugins/univer-collab.ts";
import type { ActionService } from "../kernel/action.ts";
import { generateDefaultSnapshot } from "../plugins/univer-default-snapshots.ts";
import {
  WORKTREE_CHANGE_FEED_PATH,
  WORKTREE_CHANGE_FEED_READY,
  WORKTREE_CHANGE_NOTIFY_PATH,
  WORKTREES_CHANGED
} from "../integrations/worktree-change-feed.ts";

export interface CollabMemberAttachment {
  kind?: "comb";
  memberID: string;
  userID: string;
  name: string;
  rooms: string[];
}

export interface WorktreeFeedAttachment {
  kind: "worktree-feed";
  userID: string;
}

export class DshHost extends HostBase<any> {
  private sessionTickets = new Map<string, { userID: string; name: string; expiresAt: number }>();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // 1. WebSocket Upgrade handling for /universer-api/comb/connect or /api/remote.mux
    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      if (url.pathname === "/universer-api/comb/connect") {
        const ticket = this.consumeSessionTicket(url.searchParams.get("sessionTicket") || "");
        const memberID = crypto.randomUUID();

        const attachment: CollabMemberAttachment = {
          kind: "comb",
          memberID,
          userID: ticket.userID,
          name: ticket.name,
          rooms: []
        };
        server.serializeAttachment(attachment);

        this.acceptWebSocket(server, ["comb", `member:${memberID}`]);

        return new Response(null, {
          status: 101,
          webSocket: client
        });
      }

      if (url.pathname === WORKTREE_CHANGE_FEED_PATH) {
        const ticket = this.consumeSessionTicket(url.searchParams.get("sessionTicket") || "");
        const attachment: WorktreeFeedAttachment = {
          kind: "worktree-feed",
          userID: ticket.userID
        };
        server.serializeAttachment(attachment);
        this.acceptWebSocket(server, ["worktree-feed", `user:${ticket.userID}`]);
        try {
          server.send(JSON.stringify(WORKTREE_CHANGE_FEED_READY));
        } catch {}

        return new Response(null, {
          status: 101,
          webSocket: client
        });
      }

      // Default Mux WebSocket upgrade
      const tags = ["mux"];
      const unitId = url.searchParams.get("unitId") || url.searchParams.get("docId");
      if (unitId) tags.push(`unit:${unitId}`);

      this.acceptWebSocket(server, tags);

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

      // GET /universer-api/user/session-ticket
      if (url.pathname === "/universer-api/user/session-ticket" && request.method === "GET") {
        const ticket = `ticket_${crypto.randomUUID()}`;
        this.sessionTickets.set(ticket, {
          userID: "user_admin",
          name: "Administrator",
          expiresAt: Date.now() + 300_000
        });

        // Purge expired tickets
        const now = Date.now();
        for (const [k, v] of this.sessionTickets.entries()) {
          if (v.expiresAt <= now) this.sessionTickets.delete(k);
        }

        return new Response(
          JSON.stringify({
            error: { code: 0, message: "" },
            ticket
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

      // GET /universer-api/snapshot/:type/unit/:unitID[/rev/:revision]
      const snapshotRevMatch = url.pathname.match(
        /^\/universer-api\/snapshot\/([^/]+)\/unit\/([^/]+)(?:\/rev\/([^/]+))?$/
      );
      if (snapshotRevMatch && request.method === "GET") {
        const typeNum = parseInt(snapshotRevMatch[1], 10) || 2;
        const unitID = snapshotRevMatch[2];
        const rev = parseInt(snapshotRevMatch[3] || "0", 10);

        let snapshot = collab?.getLatestSnapshot(unitID);
        if (!snapshot) {
          const defaultSnap = generateDefaultSnapshot(unitID, typeNum);
          collab?.createUnit(unitID, typeNum, (defaultSnap as any).workbook?.name || (defaultSnap as any).doc?.name || "Document", defaultSnap);
          snapshot = { rev: 1, data: defaultSnap };
        }

        const changesets = collab?.getChangesetsSince(unitID, rev || snapshot.rev) ?? [];

        return new Response(
          JSON.stringify({
            error: { code: 0, message: "" },
            snapshot: snapshot.data,
            changesets
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      }

      // GET /universer-api/snapshot/:type/unit/:unitID/fetchmissing
      const fetchMissingMatch = url.pathname.match(/^\/universer-api\/snapshot\/([^/]+)\/unit\/([^/]+)\/fetchmissing$/);
      if (fetchMissingMatch && request.method === "GET") {
        const unitID = fetchMissingMatch[2];
        const from = parseInt(url.searchParams.get("from") || "0", 10);
        const to = url.searchParams.get("to") ? parseInt(url.searchParams.get("to")!, 10) : undefined;
        const changesets = collab?.getChangesetsSince(unitID, from, to) ?? [];
        const unit = collab?.getUnit(unitID);

        return new Response(
          JSON.stringify({
            error: { code: 0, message: "" },
            changesets,
            latestRevision: unit?.rev ?? 1
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      }

      // Block endpoints: GET /universer-api/snapshot/:type/unit/:unitID/block/:blockID
      // and /universer-api/snapshot/block/:type/unit/:unitID/block/:blockID
      if (url.pathname.includes("/block/") && request.method === "GET") {
        return new Response(
          JSON.stringify({
            error: { code: 4, message: "Sheet block was not found" }
          }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }

      // POST /universer-api/comb/:type/unit/:unitID/new_changes
      const newChangesMatch = url.pathname.match(/^\/universer-api\/comb\/([^/]+)\/unit\/([^/]+)\/new_changes$/);
      if (newChangesMatch && request.method === "POST") {
        const body = (await request.json().catch(() => ({}))) as any;
        const unitID = newChangesMatch[2];
        const changeset = body.changeset || body;

        if (collab) {
          collab.applyChangeset(changeset, body.memberID);
        }

        // 1. Send ACK back to the author
        if (body.memberID) {
          this.sendToMember(body.memberID, {
            cmd: 6,
            code: 1,
            reason: "success",
            routeKey: unitID,
            collaMsg: {
              eventID: "changeset_ack",
              csAckEvent: {
                cs: changeset
              }
            }
          });
        }

        // 2. Broadcast new changesets to other peers in room
        this.broadcastToRoom(
          unitID,
          {
            cmd: 6,
            code: 1,
            reason: "success",
            routeKey: unitID,
            collaMsg: {
              eventID: "new_changesets",
              newCsEvent: {
                cs: changeset
              }
            }
          },
          body.memberID
        );

        return new Response(
          JSON.stringify({
            error: { code: 0, message: "" }
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      }

      // DELETE /universer-api/snapshot/-/units
      if (url.pathname === "/universer-api/snapshot/-/units" && request.method === "DELETE") {
        return new Response(JSON.stringify({ error: { code: 0, message: "" } }), {
          headers: { "Content-Type": "application/json" }
        });
      }

      // POST /universer-api/snapshot/-/units/recover
      if (url.pathname === "/universer-api/snapshot/-/units/recover" && request.method === "POST") {
        return new Response(JSON.stringify({ error: { code: 0, message: "" } }), {
          headers: { "Content-Type": "application/json" }
        });
      }

      // File endpoints
      if (url.pathname.includes("/sign-url") || url.pathname.includes("/upload")) {
        return new Response(
          JSON.stringify({
            error: { code: 0, message: "" },
            url: "",
            fileID: "file_default"
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      }

      // Legacy / fallback Collab Endpoints
      if (request.method === "GET" && url.pathname === "/universer-api/collab/snapshot") {
        if (!collab) return new Response(JSON.stringify({ error: "Collab service unavailable" }), { status: 503 });
        const unitId = url.searchParams.get("unitId") || "default";
        const snapshot = collab.getLatestSnapshot(unitId);
        return new Response(JSON.stringify(snapshot ?? {}), {
          headers: { "Content-Type": "application/json" }
        });
      }

      if (request.method === "POST" && url.pathname === "/universer-api/collab/snapshot") {
        if (!collab) return new Response(JSON.stringify({ error: "Collab service unavailable" }), { status: 503 });
        const body = (await request.json()) as any;
        const unitId = body.unitId || url.searchParams.get("unitId") || "default";
        collab.saveSnapshot(unitId, body.rev || 0, body.data || body);
        return new Response(JSON.stringify({ success: true, rev: body.rev || 0 }), {
          headers: { "Content-Type": "application/json" }
        });
      }

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

    if (url.pathname === WORKTREE_CHANGE_NOTIFY_PATH && request.method === "POST") {
      await request.json().catch(() => ({}));
      this.broadcast(JSON.stringify(WORKTREES_CHANGED), "worktree-feed");
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" }
      });
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

  private consumeSessionTicket(ticketParam: string): { userID: string; name: string } {
    if (!ticketParam) {
      return { userID: "user_admin", name: "Administrator" };
    }
    const ticketData = this.sessionTickets.get(ticketParam);
    this.sessionTickets.delete(ticketParam);
    if (ticketData && ticketData.expiresAt > Date.now()) {
      return { userID: ticketData.userID, name: ticketData.name };
    }
    return { userID: "user_admin", name: "Administrator" };
  }

  /**
   * Helper to retrieve active room members.
   */
  getRoomMembers(roomID: string): Array<{ memberID: string; userID: string; name: string; avatar: string }> {
    const list: Array<{ memberID: string; userID: string; name: string; avatar: string }> = [];
    for (const s of this.ctx.getWebSockets()) {
      try {
        const att = s.deserializeAttachment() as CollabMemberAttachment | null;
        if (att && Array.isArray(att.rooms) && att.rooms.includes(roomID)) {
          list.push({
            memberID: att.memberID,
            userID: att.userID,
            name: att.name,
            avatar: ""
          });
        }
      } catch {}
    }
    return list;
  }

  /**
   * Broadcasts a message to all members in a given room.
   */
  broadcastToRoom(roomID: string, msg: any, excludeMemberID?: string): void {
    const str = typeof msg === "string" ? msg : JSON.stringify(msg);
    for (const s of this.ctx.getWebSockets()) {
      try {
        const att = s.deserializeAttachment() as CollabMemberAttachment | null;
        if (att && Array.isArray(att.rooms) && att.rooms.includes(roomID)) {
          if (excludeMemberID && att.memberID === excludeMemberID) continue;
          s.send(str);
        }
      } catch {}
    }
  }

  /**
   * Sends a message to a specific member by memberID.
   */
  sendToMember(memberID: string, msg: any): boolean {
    const str = typeof msg === "string" ? msg : JSON.stringify(msg);
    for (const s of this.ctx.getWebSockets()) {
      try {
        const att = s.deserializeAttachment() as CollabMemberAttachment | null;
        if (att && att.memberID === memberID) {
          s.send(str);
          return true;
        }
      } catch {}
    }
    return false;
  }

  /**
   * Hibernation WebSocket message handler with Univer Collaboration Protocol
   * and 4-Channel Multiplexing.
   */
  async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer | ArrayBufferView
  ): Promise<void> {
    try {
      let attachment: WorktreeFeedAttachment | CollabMemberAttachment | null = null;
      try {
        attachment = ws.deserializeAttachment() as WorktreeFeedAttachment | CollabMemberAttachment | null;
      } catch {
        attachment = null;
      }
      if (attachment?.kind === "worktree-feed") {
        return;
      }

      const kernel = await this.ensureKernel();
      let parsed: any;
      if (typeof message === "string") {
        try {
          parsed = JSON.parse(message);
        } catch {
          parsed = { raw: message };
        }
      }

      // 1. Fast-path Univer Collaboration Protocol (CombCmd)
      if (typeof parsed?.cmd === "number") {
        const att = attachment as CollabMemberAttachment | null;
        const memberID = att?.memberID || "unknown";
        const userID = att?.userID || "user_admin";
        const userName = att?.name || "Administrator";
        const routeKey = typeof parsed.routeKey === "string" ? parsed.routeKey : "";

        switch (parsed.cmd) {
          case 1: // HELLO
          case 5: // HEARTBEAT
            ws.send(
              JSON.stringify({
                cmd: parsed.cmd,
                code: 1,
                reason: "success",
                routeKey,
                infoRsp: { memberID }
              })
            );
            return;

          case 2: { // JOIN
            const rooms: string[] = parsed.joinReq?.rooms
              ? parsed.joinReq.rooms.map((r: any) => r.roomID)
              : routeKey
              ? [routeKey]
              : [];

            if (att && Array.isArray(att.rooms)) {
              for (const r of rooms) {
                if (!att.rooms.includes(r)) {
                  att.rooms.push(r);
                }
              }
              ws.serializeAttachment(att);
            }

            const roomInfos: Record<string, any> = {};
            for (const roomID of rooms) {
              const membersInRoom = this.getRoomMembers(roomID);
              roomInfos[roomID] = {
                roomID,
                members: membersInRoom
              };

              this.broadcastToRoom(
                roomID,
                {
                  cmd: 6,
                  code: 1,
                  reason: "success",
                  routeKey: roomID,
                  collaMsg: {
                    eventID: "users_enter",
                    joinEvent: {
                      memberID,
                      userID,
                      name: userName,
                      avatar: ""
                    }
                  }
                },
                memberID
              );
            }

            ws.send(
              JSON.stringify({
                cmd: 2,
                code: 1,
                reason: "success",
                routeKey: routeKey || rooms[0] || "",
                joinRsp: { roomInfos }
              })
            );
            return;
          }

          case 3: { // LEAVE
            const roomID = parsed.leaveReq?.roomID || routeKey;
            if (roomID && att && Array.isArray(att.rooms)) {
              att.rooms = att.rooms.filter((r) => r !== roomID);
              ws.serializeAttachment(att);
              this.broadcastToRoom(
                roomID,
                {
                  cmd: 6,
                  code: 1,
                  reason: "success",
                  routeKey: roomID,
                  collaMsg: {
                    eventID: "users_leave",
                    leaveEvent: {
                      memberID,
                      name: userName
                    }
                  }
                },
                memberID
              );
            }
            return;
          }

          case 4: { // INGEST (Cursor / Presence update)
            if (parsed.collaMsg?.eventID === "update_cursor" && routeKey) {
              this.broadcastToRoom(
                routeKey,
                {
                  cmd: 6,
                  code: 1,
                  reason: "success",
                  routeKey,
                  collaMsg: {
                    eventID: "update_cursor",
                    updateCursorEvent: {
                      unitID: routeKey,
                      memberID,
                      selection: parsed.collaMsg.updateCursorEvent?.selection
                    }
                  }
                },
                memberID
              );
            }
            return;
          }

          default:
            return;
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
      const att = ws.deserializeAttachment() as CollabMemberAttachment | null;
      if (att && Array.isArray(att.rooms)) {
        for (const roomID of att.rooms) {
          this.broadcastToRoom(
            roomID,
            {
              cmd: 6,
              code: 1,
              reason: "success",
              routeKey: roomID,
              collaMsg: {
                eventID: "users_leave",
                leaveEvent: {
                  memberID: att.memberID,
                  name: att.name
                }
              }
            },
            att.memberID
          );
        }
      }

      if (this.kernel) {
        await this.kernel.emit("websocket/close", { ws, code, reason, wasClean });
      }
    } catch (err) {
      console.error("Error handling webSocketClose:", err);
    }
  }
}

export { DshHost as ChatAgent };
