/** Stable listener; account-owned requests wait while the global runtime switches. */
import { WebServer, type WebRoute, type WebUpgradeRoute } from "@deepseek-ai/dsh-host-webserver";

export const CONNECTION_STATUS_PATH = "/auth/connection/status";

interface ConnectionState {
  runtimeReady(): boolean;
}

export function runtimeRequestStatus(state: ConnectionState | undefined): 503 | undefined {
  if (state === undefined || !state.runtimeReady()) return 503;
  return undefined;
}

function accountPath(path: string): boolean {
  return path === "/api" || path.startsWith("/api/") || path === "/univer-workspace" || path.startsWith("/univer-workspace/") || path.startsWith("/auth/device/");
}

export class RuntimeWebServer extends WebServer {
  private connectionState(): ConnectionState | undefined {
    return this.ctx.get("workspaceAuth") as ConnectionState | undefined;
  }

  override register(route: WebRoute): () => void {
    if (!accountPath(route.path)) return super.register(route);
    return super.register({ ...route, handler: (req, res) => {
      const status = runtimeRequestStatus(this.connectionState());
      if (status !== undefined) {
        res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify({ error: "workspace_connection_switching" }));
        return;
      }
      return route.handler(req, res);
    } });
  }

  override registerUpgrade(route: WebUpgradeRoute): () => void {
    if (!accountPath(route.path)) return super.registerUpgrade(route);
    return super.registerUpgrade({ ...route, handler: (req, socket, head) => {
      const status = runtimeRequestStatus(this.connectionState());
      if (status !== undefined) {
        socket.end(`HTTP/1.1 ${status} Connection unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
        return;
      }
      return route.handler(req, socket, head);
    } });
  }
}

export default RuntimeWebServer;
