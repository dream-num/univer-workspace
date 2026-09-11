import { DurableObject } from "cloudflare:workers";
import type { Context } from "@deepseek-ai/cordis";
import type { SqlExec } from "../../kernel/sql.ts";
import { bootKernel } from "../../kernel/boot.ts";

export abstract class HostBase<Env = unknown> extends DurableObject<Env> {
  protected kernel: Context | null = null;
  protected kernelError: Error | null = null;
  private _sqlExec: SqlExec | null = null;

  /**
   * Provides SqlExec interface wrapping this.ctx.storage.sql.
   */
  public getSqlExec(): SqlExec {
    if (this._sqlExec) return this._sqlExec;
    const sql = (this.ctx.storage as any).sql;
    this._sqlExec = {
      exec: (query: string, ...binds: unknown[]) => {
        const cursor = sql.exec(query, ...binds);
        return {
          toArray: () => {
            if (typeof cursor.toArray === "function") {
              return cursor.toArray();
            }
            return Array.from(cursor);
          }
        };
      },
      transactionSync: (fn: () => unknown) => {
        if (typeof (this.ctx.storage as any).transactionSync === "function") {
          return (this.ctx.storage as any).transactionSync(fn);
        }
        return fn();
      }
    };
    return this._sqlExec;
  }

  /**
   * Lazily ensures that the Cordis microkernel is booted from SQLite plugin_tree.
   */
  public async ensureKernel(): Promise<Context> {
    if (this.kernel) return this.kernel;
    if (this.kernelError) throw this.kernelError;

    try {
      const sql = this.getSqlExec();
      const hostDelegate = {
        env: this.env,
        name: (this.ctx as any).id?.name ?? "default",
        sql,
        broadcast: (payload: unknown) => this.broadcast(payload)
      };

      const ctx = await bootKernel({
        sql,
        host: hostDelegate,
        env: this.env as any
      });

      this.kernel = ctx;
      return ctx;
    } catch (err) {
      this.kernelError = err instanceof Error ? err : new Error(String(err));
      throw this.kernelError;
    }
  }

  /**
   * Broadcasts a JSON message to all connected hibernatable WebSockets.
   */
  public broadcast(payload: unknown, tag?: string): void {
    const sockets = tag ? this.ctx.getWebSockets(tag) : this.ctx.getWebSockets();
    const message = typeof payload === "string" ? payload : JSON.stringify(payload);
    for (const ws of sockets) {
      try {
        ws.send(message);
      } catch {
        // Socket may have closed before send; ignored in broadcast loop
      }
    }
  }

  /**
   * Accepts a WebSocket and tags it.
   */
  public acceptWebSocket(ws: WebSocket, tags: string[] = []): void {
    this.ctx.acceptWebSocket(ws, tags);
  }

  /**
   * Durable Object alarm entrypoint delegating to Cordis alarm event.
   */
  async alarm(): Promise<void> {
    try {
      const kernel = await this.ensureKernel();
      await kernel.emit("alarm");
    } catch (error) {
      console.error("Durable Object alarm error:", error);
    }
  }
}
