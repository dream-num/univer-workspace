import type { Logger } from "pino";
import type { ExecutorConfig } from "../shared/config-executor.js";
import { executorCapabilitiesSchema, PROTOCOL_VERSION } from "../shared/executor-protocol.js";
import { isRendererOpName, type RendererOpName } from "../shared/renderer-protocol.js";

export class RendererCapabilities {
  operations: ReadonlySet<RendererOpName> = new Set();
  readonly ready: Promise<void>;
  private readonly controller = new AbortController();
  private readonly timer: ReturnType<typeof setInterval> | undefined;
  private refreshing: Promise<void> | undefined;

  constructor(
    private readonly config: ExecutorConfig,
    private readonly logger: Logger,
  ) {
    this.ready = this.refresh();
    if (config.MCP_RENDERER_URL) {
      this.timer = setInterval(() => void this.refresh(), 60_000);
      this.timer.unref();
    }
  }

  refresh(): Promise<void> {
    return (this.refreshing ??= this.discover().finally(() => {
      this.refreshing = undefined;
    }));
  }

  private async discover(): Promise<void> {
    if (!this.config.MCP_RENDERER_URL) return;
    try {
      const response = await fetch(`${this.config.MCP_RENDERER_URL}/rpc/v1/capabilities`, {
        headers: { authorization: `Bearer ${this.config.MCP_RENDERER_TOKEN}` },
        signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(5_000)]),
        redirect: "error",
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error("Renderer capability request failed");
      }
      const body = executorCapabilitiesSchema.parse(await response.json());
      this.operations = new Set(
        body.v === PROTOCOL_VERSION ? body.operations.filter(isRendererOpName) : [],
      );
    } catch {
      if (!this.controller.signal.aborted)
        this.logger.warn("Renderer capability refresh failed; retaining last known capabilities");
    }
  }

  close(): void {
    clearInterval(this.timer);
    this.controller.abort();
  }
}
