import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import workspaceConfig from "../vite.config";

export default defineConfig({
  root: fileURLToPath(new URL("../", import.meta.url)),
  // Match the production React 19 / SDK peer graph in this application-shell fixture.
  resolve: workspaceConfig.resolve ?? {},
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "immersive-fixture-routes",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          // No backend: prevent background SSE reconnects in the actual application shell.
          if (request.url?.startsWith("/api/")) {
            response.statusCode = 204;
            response.end();
            return;
          }
          if (request.url?.startsWith("/nodes/")) request.url = "/test/fixtures/immersive.html";
          next();
        });
      },
    },
  ],
  server: { host: "127.0.0.1", port: 5183, strictPort: true },
});
