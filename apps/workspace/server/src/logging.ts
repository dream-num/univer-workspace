import pino from "pino";

const destination = pino.destination({ dest: 1, sync: false });

export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? "info",
  },
  destination,
);

// 阶段边界同步刷出日志，减少阻塞或进程异常退出时丢失诊断的风险。
// 普通 HTTP 日志仍使用异步输出。
export function flushLogs(): void {
  destination.flushSync();
}
