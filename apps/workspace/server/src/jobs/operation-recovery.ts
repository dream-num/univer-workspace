import { randomUUID } from "node:crypto";
import type { ResourcesModule } from "../modules/resources/index.js";

export interface OperationRecovery {
  dispose(): Promise<void>;
}

export function startOperationRecovery(
  resources: ResourcesModule,
  options: {
    readonly intervalMs?: number;
    readonly onError?: (error: unknown) => void;
  } = {}
): OperationRecovery {
  const workerId = randomUUID();
  const intervalMs = options.intervalMs ?? 2_000;
  const onError = options.onError ?? console.error;
  let disposed = false;
  let running: Promise<void> | null = null;

  const run = () => {
    if (disposed || running) return;
    running = resources
      .resumeDue(workerId)
      .then(() => undefined)
      .catch(onError)
      .finally(() => {
        running = null;
      });
  };
  const timer = setInterval(run, intervalMs);
  timer.unref();
  run();

  return {
    async dispose() {
      if (disposed) return;
      disposed = true;
      clearInterval(timer);
      await running;
    },
  };
}
