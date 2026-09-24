import { randomUUID } from "node:crypto";
import { getHeapStatistics } from "node:v8";
import { flushLogs, logger } from "./logging.js";

const startupLogger = logger.child({ event: "workspace.startup", startupId: randomUUID() });

export function beginStartupStage(stage: string) {
  const started = performance.now();
  let finished = false;
  const log = (status: "started" | "completed" | "failed", error?: unknown) => {
    if (finished) return;
    finished = status !== "started";
    const level = status === "failed" ? "error" : "info";
    if (!startupLogger.isLevelEnabled(level)) return;
    try {
      startupLogger[level](
        {
          stage,
          status,
          elapsedMs: Math.round(performance.now() - started),
          uptimeMs: Math.round(process.uptime() * 1000),
          memory: process.memoryUsage(),
          heapSizeLimit: getHeapStatistics().heap_size_limit,
          ...(status === "failed" ? { err: error } : {}),
        },
        `Workspace startup ${stage} ${status}`,
      );
      flushLogs();
    } catch {
      // 日志输出失败不能替换原始异常或改变迁移结果。
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
