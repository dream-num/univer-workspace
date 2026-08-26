import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";

// DSH bundles are consumed from a dsh profile, not from this workspace, so
// every package builds self-contained artifacts: a node ESM host bundle
// with the @deepseek-ai/* peers left external, and a classic-script client
// bundle whose ModuleLoader shell is written in the entry source.
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

await build({
  entryPoints: ["src/client/entry.ts"],
  outfile: "lib/client.js",
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2022",
  external: ["react", "react-dom"],
  sourcemap: true,
  logLevel: "info",
});
