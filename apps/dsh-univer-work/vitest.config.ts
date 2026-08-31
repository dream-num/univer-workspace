import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["test/**/*.test.ts"],
    reporters: ["default", "./scripts/parity-safety-reporter.mjs"],
  },
});
