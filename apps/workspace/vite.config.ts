import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  envDir: "..",
  // Private workspace packages export source and keep React 18 development
  // installs for their standalone Harness-compatible tests. The Workspace
  // browser itself owns React 19, so all source imports must resolve through
  // this composition root instead of bundling a second React dispatcher.
  resolve: {
    // The shared engine also imports SDK peers; resolve them in this application
    // so its services and plugins use the same React 19 / Redi context.
    dedupe: [
      "react",
      "react-dom",
      "@univerjs-labs/html-view",
      "@univerjs-labs/html-view-renderer",
      "@univerjs-labs/binding-engine",
      "@univerjs/core",
      "@univerjs-pro/engine-formula",
      "@univerjs/docs",
      "@univerjs/sheets",
      "@univerjs/sheets-formula",
      "@univerjs/engine-render",
      "@univerjs/network",
      "@univerjs-pro/collaboration",
      "@univerjs-pro/collaboration-client",
      "@univerjs-pro/collaboration-client-ui",
      "@univerjs-pro/license",
    ],
  },
  plugins: [
    tanstackRouter({
      target: "react",
      routesDirectory: "./src/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
    }),
    react(),
    tailwindcss(),
  ],
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3020",
        ws: true,
      },
      "/api-docs": "http://127.0.0.1:3020",
      "/openapi.yaml": "http://127.0.0.1:3020",
      "/universer-api": {
        target: "http://127.0.0.1:3020",
        ws: true,
      },
    },
  },
  build: {
    outDir: "../dist/public",
    emptyOutDir: true,
  },
});
