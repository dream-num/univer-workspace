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
    dedupe: ["react", "react-dom"],
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
