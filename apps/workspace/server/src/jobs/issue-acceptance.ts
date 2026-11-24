import type { IssuesModule } from "../modules/issues/index.js";
import type { OperationRecovery } from "./operation-recovery.js";

export function startIssueAcceptance(issues: Pick<IssuesModule, "acceptDue">): OperationRecovery {
  let disposed = false;
  let running: Promise<void> | null = null;

  const run = () => {
    if (disposed || running) return;
    running = issues
      .acceptDue(Date.now(), 25)
      .then(() => undefined)
      .catch(console.error)
      .finally(() => {
        running = null;
      });
  };
  const timer = setInterval(run, 60_000);
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
