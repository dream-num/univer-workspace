import { randomUUID } from "node:crypto";
import { writeSync } from "node:fs";
import { hostname } from "node:os";
import { getHeapStatistics } from "node:v8";

const startupId = randomUUID();
const host = hostname();

// Startup diagnostics must survive a fatal V8 OOM, including during module
// loading or synchronous migrations. No application imports or buffered writes.
export function beginStartupStage(stage: string) {
  const started = performance.now();
  const log = (status: "started" | "completed" | "failed", error?: unknown) => {
    try {
      writeSync(
        1,
        `${JSON.stringify({
          level: status === "failed" ? 50 : 30,
          time: Date.now(),
          pid: process.pid,
          hostname: host,
          event: "workspace.startup",
          startupId,
          stage,
          status,
          elapsedMs: Math.round(performance.now() - started),
          uptimeMs: Math.round(process.uptime() * 1000),
          memory: process.memoryUsage(),
          heapSizeLimit: getHeapStatistics().heap_size_limit,
          ...(status === "failed"
            ? {
                errorType: error instanceof Error ? error.name : typeof error,
              }
            : {}),
          msg: `Workspace startup ${stage} ${status}`,
        })}\n`,
      );
    } catch {
      // A closed log sink must not change migration or startup semantics.
    }
  };
  log("started");
  return log;
}

export function startupStage<T>(stage: string, operation: () => T): T {
  const log = beginStartupStage(stage);
  try {
    const result = operation();
    log("completed");
    return result;
  } catch (error) {
    log("failed", error);
    throw error;
  }
}

export async function startupStageAsync<T>(stage: string, operation: () => Promise<T>): Promise<T> {
  const log = beginStartupStage(stage);
  try {
    const result = await operation();
    log("completed");
    return result;
  } catch (error) {
    log("failed", error);
    throw error;
  }
}
