import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  base: "./",
  build: {
    outDir: resolve(root, "../dist/render-runtime"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 20_000,
    sourcemap: false,
  },
  define: {
    "process.env": "{}",
  },
});
