import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    include: [
      "client/src/**/*.test.ts",
      "server/src/**/*.test.ts",
      "test/**/*.test.ts",
    ],
  },
});
