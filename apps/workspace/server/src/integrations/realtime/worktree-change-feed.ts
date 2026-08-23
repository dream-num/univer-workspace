import type { ISessionTicketStore } from "@univerjs-pro/collaboration-endpoint";
import type {
  NodeTransportConnection,
  NodeTransportEndpoint,
} from "@univerjs-pro/collaboration-transport-node";
import type { WorktreeProductChange } from "../../modules/worktrees/index.js";

export const WORKTREE_CHANGE_FEED_PATH = "/api/worktree-events";

export interface WorktreeChangeFeed {
  endpoint(ticketStore: ISessionTicketStore): NodeTransportEndpoint;
  publish(change: WorktreeProductChange): void;
  dispose(): Promise<void>;
}

export function createWorktreeChangeFeed(): WorktreeChangeFeed {
  const connections = new Map<
    string,
    Map<string, NodeTransportConnection>
  >();
  let disposed = false;
  let endpointCreated = false;

  return {
    endpoint(ticketStore) {
      if (endpointCreated) {
        throw new Error("Worktree change feed endpoint is already created.");
      }
      endpointCreated = true;
      return {
        async handleUpgrade(context, next) {
          const url = new URL(
            context.incomingMessage.url ?? "/",
            "http://localhost"
          );
          if (url.pathname !== WORKTREE_CHANGE_FEED_PATH) {
            await next();
            return;
          }
          if (disposed) {
            context.reject(503, "Worktree change feed is unavailable");
            return;
          }
          const ticket = await ticketStore.consume(
            url.searchParams.get("sessionTicket") ?? ""
          );
          if (!ticket) {
            context.reject(401, "Invalid or expired session ticket");
            return;
          }
          context.accept({
            open({ connection }) {
              const userConnections =
                connections.get(ticket.userID) ?? new Map();
              userConnections.set(connection.id, connection);
              connections.set(ticket.userID, userConnections);
              safeSend(
                connection,
                JSON.stringify({ event: "worktreeChangeFeedReady" })
              );
            },
            message({ connection }) {
              connection.close(1003, "Worktree change feed is server-only");
            },
            close({ connection }) {
              removeConnection(ticket.userID, connection.id);
            },
          });
        },
        dispose: async () => {
          await dispose();
        },
      };
    },

    publish(change) {
      if (disposed) return;
      const message = JSON.stringify({ event: "worktreesChanged" });
      for (const userId of change.audienceUserIds) {
        for (const connection of connections.get(userId)?.values() ?? []) {
          safeSend(connection, message);
        }
      }
    },

    dispose,
  };

  function removeConnection(userId: string, connectionId: string): void {
    const userConnections = connections.get(userId);
    userConnections?.delete(connectionId);
    if (userConnections?.size === 0) connections.delete(userId);
  }

  async function dispose(): Promise<void> {
    if (disposed) return;
    disposed = true;
    for (const userConnections of connections.values()) {
      for (const connection of userConnections.values()) {
        connection.close(1001, "Worktree change feed disposed");
      }
    }
    connections.clear();
  }
}

function safeSend(connection: NodeTransportConnection, message: string): void {
  void Promise.resolve(connection.send(message)).catch(() => {
    connection.close(1011, "Worktree change delivery failed");
  });
}
