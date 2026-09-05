import { build } from "esbuild";
import { build as viteBuild } from "vite";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

// DSH bundles are consumed from a dsh profile, not from this workspace, so
// every package builds self-contained artifacts: a node ESM host bundle
// (the skin has no host behavior, but the dsh row loader still requires a
// node half) and a classic-script client bundle wrapped in a ModuleLoader
// shell whose `require` resolves React from the DSH page runtime.
const external = ["node:*", "@deepseek-ai/*"];

await rm("lib", { recursive: true, force: true });
await mkdir("lib", { recursive: true });

await build({
  entryPoints: ["src/index.ts"],
  outfile: "lib/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external,
  sourcemap: true,
  logLevel: "info",
});

const packageId = "dsh-univer-workspace-skin-plugin";

await viteBuild({
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
      external: ["react", "react/jsx-runtime", "react-dom"],
      output: {
        inlineDynamicImports: true,
        banner: `var module = { exports: {} }; var exports = module.exports;\nwindow.__ModuleLoader__.load({ id: ${JSON.stringify(packageId)}, factory: (require) => {`,
        footer: "return module.exports; } });",
        assetFileNames: (assetInfo) =>
          assetInfo.name?.endsWith(".css") ? "client.css" : "[name][extname]",
      },
    },
  },
});
