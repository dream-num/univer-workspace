import { randomUUID } from "node:crypto";
import type { BlobsModule } from "../modules/blobs/index.js";
import type { HtmlViewDraftsModule } from "../modules/html-view-drafts/index.js";
import type { SkillDraftsModule } from "../modules/skill-drafts/index.js";
import type { OperationRecovery } from "./operation-recovery.js";

export function startBlobMaintenance(
  blobs: Pick<BlobsModule, "runMaintenance">,
  options: {
    readonly intervalMs?: number;
    readonly skillDrafts?: Pick<SkillDraftsModule, "expireDue">;
    readonly drafts?: Pick<HtmlViewDraftsModule, "expireDue">;
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
    running = Promise.resolve()
      .then(async () => {
        await options.drafts?.expireDue(Date.now(), 25);
        await options.skillDrafts?.expireDue(Date.now(), 25);
        await blobs.runMaintenance(workerId);
      })
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
      disposed = true;
      clearInterval(timer);
      await running;
    },
  };
}
