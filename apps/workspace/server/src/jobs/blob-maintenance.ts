import { randomUUID } from "node:crypto";
import type { BlobsModule } from "../modules/blobs/index.js";
import type { OperationRecovery } from "./operation-recovery.js";

export function startBlobMaintenance(
  blobs: BlobsModule,
  options: {
    readonly intervalMs?: number;
    readonly onError?: (error: unknown) => void;
  } = {}
): OperationRecovery {
  const workerId = randomUUID();
  const intervalMs = options.intervalMs ?? 5_000;
  const onError = options.onError ?? console.error;
  let disposed = false;
  let running: Promise<void> | null = null;

  const run = () => {
    if (disposed || running) return;
    running = blobs
      .runMaintenance(workerId)
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
