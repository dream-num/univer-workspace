import type { Logger } from "pino";
import type { GatewayConfig } from "../../shared/config.js";
import {
  executorCapabilitiesSchema,
  isOpName,
  PROTOCOL_VERSION,
  type OpName,
} from "../../shared/executor-protocol.js";
import { ExecutorRouter } from "./router.js";

export class ExecutorCapabilities {
  readonly router = new ExecutorRouter([]);
  operations: ReadonlySet<OpName> = new Set();
  private readonly replicas = new Map<string, ReadonlySet<OpName>>();
  private readonly controller = new AbortController();
  private readonly timer: ReturnType<typeof setInterval> | undefined;
  private refreshing: Promise<void> | undefined;
  readonly ready: Promise<void>;

  constructor(
    private readonly config: GatewayConfig["executor"],
    private readonly logger: Logger,
  ) {
    this.ready = this.refresh();
    if (config) {
      this.timer = setInterval(() => {
        void this.refresh();
      }, 60_000);
      this.timer.unref();
    }
  }

  get available(): boolean {
    return this.replicas.size > 0;
  }

  refresh(): Promise<void> {
    return (this.refreshing ??= this.discover().finally(() => {
      this.refreshing = undefined;
    }));
  }

  private async discover(): Promise<void> {
    const config = this.config;
    if (!config) return;
    await Promise.all(
      config.urls.map(async (url) => {
        try {
          const response = await fetch(`${url}/rpc/v1/capabilities`, {
            headers: { authorization: `Bearer ${config.internalToken}` },
            signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(5_000)]),
            redirect: "error",
          });
          if (!response.ok) {
            await response.body?.cancel();
            throw new Error("Executor capability request failed");
          }
          const body = executorCapabilitiesSchema.parse(await response.json());
          if (body.v === PROTOCOL_VERSION)
            this.replicas.set(url, new Set(body.operations.filter(isOpName)));
          else this.replicas.delete(url);
        } catch {
          if (!this.controller.signal.aborted)
            this.logger.warn(
              "Executor capability refresh failed; retaining last known capabilities",
            );
        }
      }),
    );
    const replicas = [...this.replicas.values()];
    this.operations = new Set(
      [...(replicas[0] ?? [])].filter((name) => replicas.every((ops) => ops.has(name))),
    );
    this.router.setUrls([...this.replicas.keys()]);
  }

  close(): void {
    clearInterval(this.timer);
    this.controller.abort();
  }
}
