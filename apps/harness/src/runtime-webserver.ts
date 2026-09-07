/** Stable HTTP listener with a per-document fence for account-owned requests. */
import type { IncomingMessage } from "node:http";
import { WebServer, type WebRoute, type WebUpgradeRoute } from "@deepseek-ai/dsh-host-webserver";

export const CONNECTION_STATUS_PATH = "/auth/connection/status";
export const CONNECTION_HEADER = "x-uwh-connection";

interface ConnectionState {
  connectionVersion(): string;
  runtimeReady(): boolean;
}

export function connectionRequestStatus(
  state: ConnectionState | undefined,
  version: string | undefined,
): 409 | 503 | undefined {
  if (state === undefined || !state.runtimeReady()) return 503;
  return version === state.connectionVersion() ? undefined : 409;
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
      const status = this.requestStatus(req);
      if (status !== undefined) {
        res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify({ error: status === 409 ? "workspace_connection_changed" : "workspace_connection_switching" }));
        return;
      }
      return route.handler(req, res);
    } });
  }

  override registerUpgrade(route: WebUpgradeRoute): () => void {
    if (!accountPath(route.path)) return super.registerUpgrade(route);
    return super.registerUpgrade({ ...route, handler: (req, socket, head) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const status = connectionRequestStatus(this.connectionState(), url.searchParams.get("uwhConnection") ?? undefined);
      if (status !== undefined) {
        socket.end(`HTTP/1.1 ${status} Connection unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
        return;
      }
      return route.handler(req, socket, head);
    } });
  }

  private requestStatus(req: IncomingMessage): 409 | 503 | undefined {
    const value = req.headers[CONNECTION_HEADER];
    const queryVersion = req.method === "GET" || req.method === "HEAD"
      ? new URL(req.url ?? "/", "http://localhost").searchParams.get("uwhConnection") ?? undefined
      : undefined;
    return connectionRequestStatus(this.connectionState(), typeof value === "string" ? value : queryVersion);
  }
}

export default RuntimeWebServer;
