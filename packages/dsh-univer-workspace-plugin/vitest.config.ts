import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // Test the extracted source, rather than its self-contained production
  // bundle, so the runtime-pool boundary remains mockable in lifecycle tests.
  resolve: { alias: {
    '@univer-cli/univer-render-runtime': fileURLToPath(import.meta.resolve('@univer-cli/univer-render-runtime')),
    '@univer-cli/unit-screenshot': fileURLToPath(import.meta.resolve('@univer-cli/unit-screenshot')),
    '@univer-cli/unit-layout-lint': fileURLToPath(import.meta.resolve('@univer-cli/unit-layout-lint')),
    '@univerjs/univer-workspace-agent-runtime/workspace-screenshot': fileURLToPath(new URL('../workspace-agent-runtime/src/workspace/screenshot-support.ts', import.meta.url)),
    '@univerjs/univer-workspace-agent-runtime/workspace-render': fileURLToPath(new URL('../workspace-agent-runtime/src/workspace/render-operations.ts', import.meta.url)),
    '@univerjs/univer-workspace-agent-runtime/manager': fileURLToPath(new URL('../workspace-agent-runtime/src/manager.ts', import.meta.url)),
    '@univer-cli/univer-collaboration-runtime-pool': fileURLToPath(import.meta.resolve('@univer-cli/univer-collaboration-runtime-pool')),
  } },
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["test/**/*.test.ts"],
  },
});
