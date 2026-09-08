import { build } from "esbuild";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build as viteBuild } from "vite";

// DSH bundles are consumed from a dsh profile, not from this workspace, so
// every package builds self-contained artifacts: a node ESM host bundle and
// worker bundle with the @deepseek-ai/* peers (and zod, owned by
// dsh-storage-domain) left external, plus a Vite-built browser client wrapped
// in a ModuleLoader shell whose `require` resolves React from the DSH page runtime.
const external = [
  "node:*",
  "@deepseek-ai/*",
  "zod",
  "ws",
  // Native addons are installed once by the consuming Harness image. Keep
  // them out of both host and worker bundles so Node resolves the platform
  // package from the plugin's production dependency boundary.
  "@univerjs-pro/engine-formula-rust-binding",
  "@univerjs-pro/exchange-node-binding",
];

await rm("lib", { recursive: true, force: true });
await mkdir("lib", { recursive: true });

// The CLI resource-library manifest is intentionally shipped as a data file,
// not inlined into the host JavaScript bundle (it is a large, versioned
// catalog).  `resources.ts` resolves this sibling at runtime from the packed
// plugin, so copy it as part of every reproducible build.
await copyFile(
  fileURLToPath(import.meta.resolve("@univerjs-pro/cli-assets/manifest.json")),
  fileURLToPath(new URL("../lib/resource-manifest.json", import.meta.url)),
);

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

// Browser UI is built by Vite so TSX, CSS Modules and SCSS share one
// reproducible pipeline. The config preserves the DSH ModuleLoader wrapper
// and externalizes the host-owned React/primitives runtime.
await viteBuild({ configFile: "vite.client.config.mjs" });

// The headless collaboration worker runs in a forked child process and loads
// the whole Univer headless dependency graph. Node builtins stay external; the
// Univer packages are bundled so the worker is self-contained.
await build({
  entryPoints: ["src/runtime/worker.ts"],
  outfile: "lib/worker.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "bundle",
  external: [
    "node:*",
    "@univerjs-pro/engine-formula-rust-binding",
    "@univerjs-pro/exchange-node-binding",
  ],
  sourcemap: true,
  logLevel: "info",
});

// The bundled collaboration-runtime pool forks its IPC bootstrap from the
// directory of the module it was imported from (import.meta.url), which after
// bundling is this package's lib/. Ship the self-contained (zero-import)
// bootstrap beside lib/index.js so the fork resolves.
// The pool package has no subpath export for the bootstrap; resolve the
// public entry (dist/index.mjs) and take its sibling bootstrap.
const poolEntryUrl = import.meta.resolve("@univer-cli/univer-collaboration-runtime-pool");
const poolChildPath = fileURLToPath(new URL("./worker-child.mjs", poolEntryUrl));
await copyFile(
  poolChildPath,
  fileURLToPath(new URL("../lib/worker-child-upstream.mjs", import.meta.url)),
);
await copyFile(
  fileURLToPath(new URL("../src/runtime/worker-child-bootstrap.mjs", import.meta.url)),
  fileURLToPath(new URL("../lib/worker-child.mjs", import.meta.url)),
);
