import { builtinModules } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const root = dirname(fileURLToPath(import.meta.url));

const runtimeExternals = new Set([
  "@deepseek-ai/cordis",
  "@deepseek-ai/dsh-credentials",
  "@deepseek-ai/dsh-fs",
  "@deepseek-ai/dsh-fs-local",
  "@deepseek-ai/dsh-llm",
  "@deepseek-ai/dsh-sandbox",
  "@deepseek-ai/dsh-sandbox-policy",
  "@deepseek-ai/dsh-skill",
  "@deepseek-ai/dsh-tools",
]);
const nodeBuiltins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
const nativeBindings = new Set([
  "@univerjs-pro/doc-typst-native-binding",
  "@univerjs-pro/engine-formula-rust-binding",
  "@univerjs-pro/exchange-node-binding",
]);
const browserPackages = new Set(["@puppeteer/browsers", "puppeteer-core"]);

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: {
        index: resolve(root, "src/index.ts"),
        "render-result-budget": resolve(root, "src/render-result-budget.ts"),
        worker: resolve(root, "src/worker.ts"),
      },
      formats: ["es"],
    },
    minify: "oxc",
    target: "node22",
    rollupOptions: {
      external: (id) => runtimeExternals.has(id)
        || nodeBuiltins.has(id)
        || [...browserPackages].some((name) => id === name || id.startsWith(`${name}/`))
        || [...nativeBindings].some((binding) => id === binding || id.startsWith(`${binding}/`)),
      preserveEntrySignatures: "strict",
      output: {
        chunkFileNames: "chunks/[name]-[hash].js",
        entryFileNames: ({ name }) => name === "render-result-budget"
          ? "chunks/render-result-budget.js"
          : "[name].js",
        manualChunks: (id) => {
          if (/[\\/]@univer-cli[\\/]univer-collaboration-runtime-pool[\\/]/u.test(id)) {
            return "runtime-pool";
          }
          if (/[\\/]node_modules[\\/]/u.test(id)) return "vendor";
          return undefined;
        },
      },
    },
    sourcemap: false,
  },
  ssr: {
    noExternal: true,
  },
  define: {
    __UNIVER_RUST_FORMULA_LOCAL_BINDING_FALLBACKS__: "false",
  },
  plugins: [provideNodeGlobalsForBundledCommonjs()],
  resolve: {
    conditions: ["node", "import", "default"],
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

function injectNodeCommonjsGlobals(code: string): string | undefined {
  const needsRequire = code.includes("environment that doesn't expose the `require` function")
    && !/\b(?:const|let|var)\s+require\s*=\s*[^;\n]*[Cc]reateRequire/u.test(code);
  const needsFilename = code.includes("__filename")
    && !/\b(?:const|let|var)\s+__filename\b/u.test(code);
  const needsDirname = code.includes("__dirname")
    && !/\b(?:const|let|var)\s+__dirname\b/u.test(code);
  if (!needsRequire && !needsFilename && !needsDirname) return undefined;

  const imports = [
    ...(needsRequire
      ? ['import { createRequire as __univerCreateRequire } from "node:module";']
      : []),
    ...(needsFilename || needsDirname
      ? [
          'import { dirname as __univerPathDirname } from "node:path";',
          'import { fileURLToPath as __univerFileURLToPath } from "node:url";',
        ]
      : []),
  ];
  const declarations = [
    ...(needsRequire ? ["const require = __univerCreateRequire(import.meta.url);"] : []),
    ...(needsFilename || needsDirname
      ? ["const __filename = __univerFileURLToPath(import.meta.url);"]
      : []),
    ...(needsDirname ? ["const __dirname = __univerPathDirname(__filename);"] : []),
  ];
  const importPrefix = code.match(/^(?:import[\s\S]*?;\n)*/u)?.[0] ?? "";
  return `${importPrefix}${imports.join("\n")}\n${declarations.join("\n")}\n${code.slice(importPrefix.length)}`;
}
