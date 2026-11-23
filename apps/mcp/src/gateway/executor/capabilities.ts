import type { Logger } from "pino";
import {
  affinityKey,
  createAffinityTransport,
  type AffinityTransport,
  type EpochStore,
} from "../../executor-fc/index.js";
import type { GatewayConfig } from "../../shared/config.js";
import { safeErrorFields } from "../../shared/logging.js";
import {
  executorCapabilitiesSchema,
  isOpName,
  PROTOCOL_VERSION,
  type OpName,
} from "../../shared/executor-protocol.js";
import { ExecutorRouter } from "./router.js";

// Capability discovery is a gateway concern, not a caller's, so it uses one stable routing key.
// Without a key every refresh would open a new FC Session, and session isolation turns each of
// those into a new instance.
const CAPABILITIES_KEY = affinityKey({
  userId: "mcp-gateway",
  scope: "capabilities",
  unitId: null,
});

export class ExecutorCapabilities {
  readonly router = new ExecutorRouter([]);
  operations: ReadonlySet<OpName> = new Set();
  private discovered = false;
  private readonly replicas = new Map<string, ReadonlySet<OpName>>();
  private readonly controller = new AbortController();
  private readonly timer: ReturnType<typeof setInterval> | undefined;
  private refreshing: Promise<void> | undefined;
  readonly ready: Promise<void>;
  private readonly transport: AffinityTransport | null;

  constructor(
    private readonly config: GatewayConfig["executor"],
    private readonly logger: Logger,
    epochs?: EpochStore,
  ) {
    this.transport = epochs === undefined ? null : createAffinityTransport({ epochs, logger });
    this.ready = this.refresh();
    if (config) {
      this.timer = setInterval(() => {
        void this.refresh();
      }, 60_000);
      this.timer.unref();
    }
  }

  get available(): boolean {
    return this.discovered;
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
          const init: RequestInit = {
            method: "GET",
            headers: { authorization: `Bearer ${config.executorToken}` },
            signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(5_000)]),
            redirect: "error",
          };
          const response =
            this.transport === null
              ? await fetch(`${url}/rpc/v1/capabilities`, init)
              : await this.transport.request({
                  endpoint: url,
                  key: CAPABILITIES_KEY,
                  path: "/rpc/v1/capabilities",
                  init,
                });
          if (!response.ok) {
            const status = response.status;
            await response.body?.cancel();
            throw new Error(`Executor capability request failed with HTTP ${status}`);
          }
          const body = executorCapabilitiesSchema.parse(await response.json());
          if (body.v === PROTOCOL_VERSION) {
            this.replicas.set(url, new Set(body.operations.filter(isOpName)));
            this.discovered = true;
          } else this.replicas.delete(url);
        } catch (error) {
          if (this.controller.signal.aborted) return;
          // The status or network code is what tells 401 (token mismatch), 404 (not the
          // executor) and ECONNREFUSED (wrong host or port) apart.
          this.logger.warn(
            {
              executor: url,
              ...safeErrorFields(error),
              reason: error instanceof Error ? error.message : "unknown error",
            },
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
