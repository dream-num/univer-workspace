import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // Test the extracted source, rather than its self-contained production
  // bundle, so the runtime-pool boundary remains mockable in lifecycle tests.
  resolve: { alias: {
    '@univerjs/univer-workspace-agent-runtime/manager': fileURLToPath(new URL('../workspace-agent-runtime/src/manager.ts', import.meta.url)),
    '@univer-cli/univer-collaboration-runtime-pool': fileURLToPath(import.meta.resolve('@univer-cli/univer-collaboration-runtime-pool')),
  } },
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["test/**/*.test.ts"],
  },
});
