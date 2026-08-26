import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";

// DSH bundles are consumed from a dsh profile, not from this workspace, so
// every package builds self-contained artifacts: a node ESM host bundle
// with the @deepseek-ai/* peers (and zod, owned by dsh-storage-domain) left
// external, and a classic-script client bundle wrapped in a ModuleLoader
// shell whose `require` resolves React from the DSH page runtime.
const external = ["node:*", "@deepseek-ai/*", "zod"];

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

const packageId = "@univerjs/univer-workspace-harness";

await build({
  entryPoints: ["src/client/index.tsx"],
  outfile: "lib/client.js",
  bundle: true,
  platform: "browser",
  format: "cjs",
  target: "es2022",
  jsx: "transform",
  jsxFactory: "createElement",
  jsxFragment: "Fragment",
  external: ["react", "react-dom"],
  sourcemap: true,
  logLevel: "info",
  banner: {
    js: `var module = { exports: {} }; var exports = module.exports;\nwindow.__ModuleLoader__.load({ id: ${JSON.stringify(packageId)}, factory: (require) => {`,
  },
  footer: {
    js: "return module.exports; } });",
  },
});
