import type { Logger } from "pino";
import type { GatewayConfig } from "../../shared/config.js";
import { safeErrorFields } from "../../shared/logging.js";
import {
  executorCapabilitiesSchema,
  isOpName,
  PROTOCOL_VERSION,
  type OpName,
} from "../../shared/executor-protocol.js";
import type { EpochStore } from "./affinity/epoch-store.js";
import { createAffinityTransport, type AffinityTransport } from "./affinity/transport.js";
import { ExecutorRouter } from "./router.js";

// Discovery runs before the gateway knows which executors advertise `affinity`, so every probe
// carries one stable key; a resident executor ignores it. Without it each probe of an FC executor
// would open a new Session, and session isolation turns each of those into a new instance.
const CAPABILITIES_KEY = "mcp-gateway\0capabilities\0";
// One attempt may not survive an FC cold start: the 5-second request timeout protects readiness,
// so an undiscovered executor is retried shortly instead of waiting for the next minute.
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 15_000;
const DEFAULT_REFRESH_INTERVAL_MS = 60_000;

export class ExecutorCapabilities {
  readonly router = new ExecutorRouter([]);
  operations: ReadonlySet<OpName> = new Set();
  private discovered = false;
  private readonly replicas = new Map<
    string,
    { readonly operations: ReadonlySet<OpName>; readonly affinity: boolean }
  >();
  private readonly controller = new AbortController();
  private readonly timer: ReturnType<typeof setInterval> | undefined;
  private refreshing: Promise<void> | undefined;
  readonly ready: Promise<void>;
  private readonly transport: AffinityTransport | null;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryDelayMs = RETRY_BASE_MS;

  constructor(
    private readonly config: GatewayConfig["executor"],
    private readonly logger: Logger,
    epochs?: EpochStore,
  ) {
    this.transport = epochs === undefined ? null : createAffinityTransport({ epochs, logger });
    this.ready = this.refresh();
    const intervalMs = config?.capabilitiesIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
    if (config && intervalMs > 0) {
      this.timer = setInterval(() => {
        void this.refresh();
      }, intervalMs);
      this.timer.unref();
    }
  }

  get available(): boolean {
    return this.discovered;
  }

  refresh(): Promise<void> {
    return (this.refreshing ??= this.discover().finally(() => {
      this.refreshing = undefined;
      this.scheduleRetry();
    }));
  }

  /** Until the first success, retry with a capped backoff instead of waiting for the minute timer. */
  private scheduleRetry(): void {
    if (!this.config || this.discovered || this.controller.signal.aborted) return;
    if (this.retryTimer !== undefined) return;
    const delay = this.retryDelayMs;
    this.retryDelayMs = Math.min(delay * 2, RETRY_MAX_MS);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.refresh();
    }, delay);
    this.retryTimer.unref();
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
                  url,
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
            this.replicas.set(url, {
              operations: new Set(body.operations.filter(isOpName)),
              affinity: body.affinity === "header",
            });
            this.discovered = true;
            this.retryDelayMs = RETRY_BASE_MS;
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
    const replicas = [...this.replicas.values()].map((replica) => replica.operations);
    this.operations = new Set(
      [...(replicas[0] ?? [])].filter((name) => replicas.every((ops) => ops.has(name))),
    );
    const entries = [...this.replicas];
    this.router.setUrls(
      entries.map(([url]) => url),
      new Set(entries.filter(([, replica]) => replica.affinity).map(([url]) => url)),
    );
  }

  close(): void {
    clearInterval(this.timer);
    clearTimeout(this.retryTimer);
    this.controller.abort();
  }
}
