import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { EXTERNAL_RUNTIME_DEPENDENCIES } from "./scripts/package-artifact.mjs";
import { injectNodeCommonjsGlobals } from "./scripts/node-commonjs-globals.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const sourcePackageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  readonly version: string;
};
const nodeBuiltins = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: {
        main: resolve(root, "src/main.ts"),
        "runtime/daemon": resolve(root, "src/runtime/daemon.ts"),
        "runtime/worker": resolve(root, "src/runtime/worker.ts"),
      },
      formats: ["es"],
    },
    minify: "oxc",
    outDir: resolve(root, "package-dist/dist"),
    rollupOptions: {
      external: (id) => isExternal(id),
      output: {
        chunkFileNames: "chunks/[name]-[hash].js",
        entryFileNames: "[name].js",
        format: "es",
        manualChunks: (id) =>
          /[\\/]@univer-cli[\\/]univer-collaboration-runtime-pool[\\/]/u.test(id)
            ? "runtime-pool"
            : undefined,
      },
    },
    sourcemap: false,
    target: "node22",
  },
  define: {
    __UNIVER_WORKSPACE_CLI_VERSION__: JSON.stringify(sourcePackageJson.version),
    __UNIVER_RUST_FORMULA_LOCAL_BINDING_FALLBACKS__: "false",
  },
  plugins: [provideNodeGlobalsForBundledCommonjs()],
  resolve: {
    conditions: ["node", "import", "default"],
  },
  ssr: {
    noExternal: true,
  },
});

function provideNodeGlobalsForBundledCommonjs(): Plugin {
  return {
    name: "provide-node-globals-for-bundled-commonjs",
    renderChunk(code) {
      const transformed = injectNodeCommonjsGlobals(code);
      return transformed === undefined ? null : { code: transformed, map: null };
    },
  };
}

function isExternal(id: string): boolean {
  if (nodeBuiltins.has(id) || id.startsWith("node:")) return true;
  return EXTERNAL_RUNTIME_DEPENDENCIES.some(
    (dependency) => id === dependency || id.startsWith(`${dependency}/`),
  );
}
