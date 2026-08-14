import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    maxWorkers: 1,
    server: {
      deps: {
        inline: ["@univerjs-pro/engine-formula-rust"],
      },
    },
  },
});
