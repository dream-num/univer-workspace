import { defineConfig } from "vite";
import { resolve } from "node:path";

const packageId = "dsh-univer-workspace-plugin";

export default defineConfig({
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: "lib",
    emptyOutDir: false,
    sourcemap: true,
    cssCodeSplit: false,
    lib: {
      entry: resolve("src/client/index.tsx"),
      formats: ["cjs"],
      fileName: () => "client.js",
    },
    rollupOptions: {
      external: [
        "react",
        "react/jsx-runtime",
        "react-dom",
        "react-dom/client",
        "@deepseek-ai/dsh-client-ui-primitives",
      ],
      output: {
        // DSH loads one browser entry through ModuleLoader; do not emit
        // runtime chunks that the profile static bundle cannot address.
        inlineDynamicImports: true,
        banner: `var module = { exports: {} }; var exports = module.exports;\nwindow.__ModuleLoader__.load({ id: ${JSON.stringify(packageId)}, factory: (require) => {`,
        footer: "return module.exports; } });",
        assetFileNames: (assetInfo) =>
          assetInfo.name?.endsWith(".css") ? "client.css" : "[name][extname]",
      },
    },
  },
});
