import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    // Child processes, not worker threads: the exchange-node PDF binding (1.1.0, Linux) crashes
    // the process with SIGSEGV when a worker thread that loaded it ends, and the Exchange module
    // loads it for every conversion. The server itself loads it on the main thread.
    pool: "forks",
    include: [
      "web/src/**/*.test.ts",
      "server/src/**/*.test.ts",
      "test/**/*.test.ts",
    ],
  },
});
