import pino from "pino";

const options = { level: process.env.LOG_LEVEL ?? "info" };

export const logger = pino(options, pino.destination({ dest: 1, sync: false }));

// 启动阶段必须同步写入，避免 flushSync 越过尚未完成的异步写入。
export const startupLogger = pino(options, pino.destination({ dest: 1, sync: true }));
